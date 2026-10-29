#!/usr/bin/env node
/**
 * Run ONE command against a Storybook this invocation booted, then stop that Storybook
 * on every way out - the lane helper for evidence and QA runs.
 *
 *     node scripts/with-storybook.mjs [--port N] [--ready-timeout-s S] -- <command...>
 *
 * The command sees `STORYBOOK_ORIGIN=http://localhost:<port>`. Storybook's output goes
 * to a log file whose path is printed on stderr (and tailed if the server never comes
 * up), so the wrapped command's own output stays readable. The helper prints
 * `storybook pid=<pid> pgid=<pgid> port=<port>` as soon as it has spawned, so a run
 * that is itself killed leaves the exact ids to clean up by hand.
 *
 * WHY IT EXISTS. Measured 2026-10-28: dozens of `storybook dev` servers left running
 * for days by rigs and sessions that started one "for a moment" and never stopped it -
 * each holding a port, a Vite watcher and a growing cache directory on a disk ~25
 * sessions share. Every one of them was a start-by-hand and forget. The fix is not a
 * reminder: the thing that starts the server has to be the thing that is structurally
 * unable to leave it, which is a wrapper whose exit paths all run the same teardown.
 *
 * THE SHAPE, and why each part is load-bearing:
 *   1. THE SERVER LEADS ITS OWN PROCESS GROUP (`detached: true`). `storybook dev` is a
 *      node process that forks more (the preview builder, esbuild service, a shell
 *      shim), and a signal to the pid alone strands them still holding the port.
 *      Signalling `-pgid` reaches all of them, and only them: the group is one this run
 *      created, so nothing a sibling session started can be in it.
 *   2. EVERY EXIT PATH TEARS DOWN: the command exiting, the command failing to spawn,
 *      a throw, readiness timing out, SIGINT/SIGTERM/SIGHUP to the helper (forwarded to the
 *      command too), and - last resort - a synchronous `exit` handler. The teardown is
 *      `stopAppTree` from `app-tree-teardown.mjs` (SIGTERM the group, SIGKILL after 5 s,
 *      verify the pid answers no more), reused rather than copied so the three rigs that
 *      already depend on it and this one cannot drift into two opinions of "stopped".
 *   3. THE VERDICT IS "GROUP EMPTY AND PORT CLOSED", not "the leader exited": Storybook
 *      can exit while a helper keeps the port. A leak makes the helper exit non-zero
 *      (70) even when the wrapped command passed, so the run that leaks fails rather
 *      than the next run that finds the port taken.
 *   4. NEVER A PATTERN KILL. This only ever signals the pgid it spawned. It does not
 *      look for "any storybook" to reap, because on this machine most of them belong
 *      to other sessions.
 *
 * Exit codes: the command's own (128+n when it died of a signal); 69 server never
 * became ready; 70 teardown could not prove the server gone; 64 bad usage.
 *
 * `WITH_STORYBOOK_BIN` replaces the storybook binary and exists for
 * `with-storybook.test.mjs` only (a stub that serves HTTP, so the test needs no
 * dependency tree); it is invoked as `<bin> dev --ci --no-open --exact-port -p <port>`.
 * `--exact-port` makes a lost race for the picked port a loud failure instead of
 * Storybook quietly moving, which would leave `STORYBOOK_ORIGIN` pointing at someone
 * else's server.
 */

import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	alreadyGone,
	onInterrupted,
	reapOnExit,
	stopAppTree,
} from "./app-tree-teardown.mjs";

export const EXIT_USAGE = 64;
export const EXIT_NOT_READY = 69;
export const EXIT_LEAKED = 70;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
const DEFAULT_READY_TIMEOUT_S = 180; // a cold Vite pre-bundle is the slow case
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Split argv at the first `--`; everything after it is the wrapped command. */
export function parseArgs(argv) {
	const split = argv.indexOf("--");
	const own = split === -1 ? argv : argv.slice(0, split);
	const command = split === -1 ? [] : argv.slice(split + 1);
	const options = {
		port: null,
		readyTimeoutS: DEFAULT_READY_TIMEOUT_S,
		command,
	};
	for (let i = 0; i < own.length; i += 1) {
		if (own[i] === "--port") options.port = Number(own[++i]);
		else if (own[i] === "--ready-timeout-s")
			options.readyTimeoutS = Number(own[++i]);
		else return { error: `unknown argument: ${own[i]}` };
	}
	if (command.length === 0) return { error: "no command after --" };
	if (options.port !== null && !(options.port > 0 && options.port < 65536)) {
		return { error: "--port must be 1-65535" };
	}
	if (!(options.readyTimeoutS > 0)) return { error: "bad --ready-timeout-s" };
	return { options };
}

/** A port the kernel just handed out; the small race to its use is closed by --exact-port. */
function freePort() {
	return new Promise((resolvePort, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address();
			probe.close(() => resolvePort(port));
		});
	});
}

/** Whether something answers a TCP connect on the port (either loopback family). */
async function portAnswers(port) {
	const tryHost = (host) =>
		new Promise((done) => {
			const socket = connect({ port, host });
			socket.once("connect", () => {
				socket.destroy();
				done(true);
			});
			socket.once("error", () => done(false));
		});
	return (await tryHost("127.0.0.1")) || (await tryHost("::1"));
}

async function isReady(origin) {
	try {
		const response = await fetch(origin, { signal: AbortSignal.timeout(3000) });
		return response.status === 200;
	} catch {
		return false;
	}
}

const groupAlive = (pgid) => {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM"; // exists, not ours: still "alive"
	}
};

/** Run the whole lane; resolves to the process exit code. */
export async function runLane(options, env = process.env) {
	const port = options.port ?? (await freePort());
	const origin = `http://localhost:${port}`;
	const bin =
		env.WITH_STORYBOOK_BIN ||
		join(REPO_ROOT, "node_modules", ".bin", "storybook");
	const logPath = join(
		mkdtempSync(join(tmpdir(), "with-storybook-")),
		"storybook.log",
	);
	const logFd = openSync(logPath, "a");

	let serverExited = false;
	const server = spawn(
		bin,
		["dev", "--ci", "--no-open", "--exact-port", "-p", String(port)],
		{
			cwd: REPO_ROOT,
			env,
			detached: true,
			stdio: ["ignore", logFd, logFd],
		},
	);
	closeSync(logFd);
	server.once("exit", () => {
		serverExited = true;
	});
	server.once("error", () => {
		serverExited = true;
	});
	if (!server.pid) {
		console.error(`storybook failed to spawn (${bin}); log: ${logPath}`);
		return EXIT_NOT_READY;
	}
	const pid = server.pid;
	// A detached child leads a group whose id is its pid.
	console.error(`storybook pid=${pid} pgid=${pid} port=${port} log=${logPath}`);

	let command = null;
	let interruptedBy = null;
	let interruptedExit = null;
	reapOnExit({ pid, userData: null, groupOutlivesLeader: true });

	/** Stop the server and say whether it is provably gone. */
	const teardown = async () => {
		// The leader can exit while group members live on, and stopAppTree skips the
		// signal once the leader is gone, so address the group directly first.
		if (serverExited && groupAlive(pid)) {
			try {
				process.kill(-pid, "SIGTERM");
			} catch {
				// Gone between the check and the signal.
			}
		}
		const stopped = await stopAppTree({
			pid,
			userData: null,
			isExited: () => serverExited,
		});
		const deadline = Date.now() + 5000;
		while (groupAlive(pid) && Date.now() < deadline) await sleep(100);
		if (groupAlive(pid)) {
			try {
				process.kill(-pid, "SIGKILL");
			} catch {
				// Already gone.
			}
			await sleep(500);
		}
		const empty = !groupAlive(pid) && alreadyGone(pid);
		const closed = !(await portAnswers(port));
		const clean = stopped.clean && empty && closed;
		console.error(
			`storybook teardown: pid ${empty ? "gone" : "STILL ALIVE"}, port ${port} ${closed ? "closed" : "STILL OPEN"}${stopped.escalated ? " (needed SIGKILL)" : ""}`,
		);
		return clean;
	};

	onInterrupted(
		async (signal) => {
			interruptedBy = signal;
			if (command && command.exitCode === null && command.signalCode === null) {
				try {
					command.kill(signal);
				} catch {
					// Already exiting.
				}
			}
			interruptedExit = (async () => {
				const clean = await teardown();
				return clean ? 128 + SIGNAL_NUMBERS[signal] : EXIT_LEAKED;
			})();
			return interruptedExit;
		},
		["SIGINT", "SIGTERM", "SIGHUP"],
	);

	let code;
	try {
		const deadline = Date.now() + options.readyTimeoutS * 1000;
		let ready = false;
		while (Date.now() < deadline && !serverExited && !interruptedBy) {
			if (await isReady(origin)) {
				ready = true;
				break;
			}
			await sleep(500);
		}
		if (!ready) {
			let tail = "";
			try {
				tail = readFileSync(logPath, "utf8").split("\n").slice(-15).join("\n");
			} catch {
				// No log to show.
			}
			console.error(
				`storybook never answered 200 on ${origin} (${serverExited ? "it exited" : "timeout"}); log tail:\n${tail}`,
			);
			code = EXIT_NOT_READY;
		} else {
			console.error(`storybook ready at ${origin}`);
			code = await new Promise((done) => {
				command = spawn(options.command[0], options.command.slice(1), {
					stdio: "inherit",
					env: { ...env, STORYBOOK_ORIGIN: origin },
				});
				command.once("error", (error) => {
					console.error(
						`could not run ${options.command[0]}: ${error.message}`,
					);
					done(EXIT_USAGE);
				});
				command.once("exit", (status, signal) =>
					done(status ?? 128 + (signal ? 15 : 0)),
				);
			});
		}
	} catch (error) {
		console.error(`with-storybook: ${error?.stack ?? error}`);
		code = 1;
	} finally {
		// try/finally covers a throw; the explicit awaited teardown is what the exit
		// code depends on, because process.exit() runs no finally block.
		if (!interruptedBy) {
			const clean = await teardown();
			if (!clean) code = EXIT_LEAKED;
		}
	}
	// An interruption forwards the signal to the wrapped command, which then ends this
	// body first with its own (signal) status; the interrupt handler's teardown is still
	// running and owns the exit code, so wait for it rather than exit over it.
	if (interruptedExit) return await interruptedExit;
	return code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const parsed = parseArgs(process.argv.slice(2));
	if (parsed.error) {
		console.error(
			`with-storybook: ${parsed.error}\nusage: node scripts/with-storybook.mjs [--port N] -- <command...>`,
		);
		process.exit(EXIT_USAGE);
	}
	process.exit(await runLane(parsed.options));
}
