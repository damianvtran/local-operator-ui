#!/usr/bin/env node
/**
 * Drive the app's own renderer, headless, and photograph what it paints.
 *
 *     node scripts/renderer-driver.mjs --scene states --out /tmp/frames
 *     node scripts/renderer-driver.mjs --gate-check
 *
 * ## What problem this solves, measured
 *
 * Two review rounds could not look at a real UI flow. The `browser` tool drives
 * the operator's own browser and cannot enter this app's renderer, and loading
 * the renderer under a bare Vite server dies at
 * `Cannot read properties of undefined (reading 'ipcRenderer')` because `App`
 * assumes the preload bridge (`src/renderer/src/app.tsx`). So the flow was read
 * in the source and never walked, and a UX round was recorded as blocked on
 * exactly that.
 *
 * This script is the supported way through, and it uses only the app's own
 * mechanisms:
 *
 * - the BUILT app, launched by its own Electron — the runtime BINARY that
 *   `require("electron")` resolves to, never the `node_modules/.bin/electron`
 *   shim — in the documented `headless` window mode (`src/main/window-mode.ts` —
 *   a window that is never shown, so nothing can steal the operator's focus).
 *   The binary and not the shim is what makes the teardown reach the app; the
 *   comment on `ELECTRON_BIN` carries the measurement that decided it;
 * - the app's own gated dev-driver bridge (`src/main/dev-driver.ts`,
 *   `docs/agent-driver.md`) for the verbs, reached over CDP `Runtime.evaluate`
 *   on the app's OWN debugging port — the same channel AGENTS.md documents for
 *   `pnpm app:headless -- --remote-debugging-port=...`;
 * - `webContents.capturePage()` in main for the pixels, so the frames are the app
 *   photographing itself. No Playwright, no Puppeteer, no downloaded Chromium,
 *   and no `screencapture` (which photographs the frontmost window and would
 *   mean taking the focus this harness exists to avoid).
 *
 * ## Isolation, and why each piece is here
 *
 * This runs on the operator's desktop next to his real app, so every path that
 * could reach his state is redirected:
 *
 * - `HOME` and `LOCAL_OPERATOR_CONFIG_DIR` are both scratch. The config dir alone
 *   is not enough: the app's cache and home roots follow `HOME`, and this repo
 *   has already written 612 rows into the operator's live analytics database
 *   from a run somebody believed was sandboxed.
 * - `--user-data-dir` is scratch, so the Electron profile (cookies, localStorage
 *   where the UI preferences persist) cannot see or touch the real one.
 * - `LOCAL_OPERATOR_LOG_DIR` is scratch. The app's default log directory is its
 *   real home (Electron's `home`, which neither `HOME` nor `--user-data-dir`
 *   redirects), so without the app's own override every run appended to the
 *   operator's own log files — the harness asserts the override took effect
 *   rather than assuming it.
 * - The app is started with its **cwd outside the checkout**, and the scratch cwd
 *   holds its own `.env`. `src/main/backend/config.ts` loads `.env` from
 *   `process.cwd()` with dotenv `override: true`, so the repo's own `.env` is not
 *   read at all and the backend URL this run would use is one this script picked
 *   and verified to be dead. That is the difference between a run that shows a
 *   disconnected app and a run that writes into the operator's live backend.
 * - The frames then cannot contain real data: a scene captures an app that has no
 *   reachable backend. The run also asserts, with `lsof`, that the app process
 *   holds no TCP connection to the URL the RENDERER was built with (the renderer
 *   inlines `VITE_LOCAL_OPERATOR_API_URL`, and a few renderer-direct features —
 *   attachments, the canvas edit API, the updates panel — would use it).
 * - `CMUX_*` and `LOP_*` are removed from the child environment: an inherited
 *   workspace id has already renamed the operator's real cmux workspaces from a
 *   test run in this repository.
 *
 * ## The fail-closed gate, which `--gate-check` measures
 *
 * The bridge exists only when the launch opted in
 * (`LOCAL_OPERATOR_UI_DEV_DRIVER=1` **and** `LOCAL_OPERATOR_UI_DEV_DRIVER_OUT`)
 * and the window mode is not `normal`. `--gate-check` boots the app four times
 * and reports, from the real renderer: absent bridge, refused IPC channel and an
 * empty frames directory in three unarmed launches — nothing set anywhere, a cwd
 * `.env` asking to be armed, and that same file asking while the environment
 * says `=0` — and a present bridge and a real PNG in the armed one. Nothing
 * about that is inferred from a flag this script read in its own process.
 *
 * The `.env` boots exist because `src/main/backend/config.ts` applies a `.env`
 * from the app's cwd with dotenv `override: true`, and the opt-in used to be
 * resolved from `process.env` after that fold: the repository's own gitignored
 * config file could arm a control surface on a trusted process and beat an
 * explicit refusal, with no flag anywhere. Launch facts now come from the
 * pre-dotenv `launchEnv` snapshot, and those two boots are what keep it so.
 *
 * What this harness CANNOT show is in `docs/agent-driver.md`; the short version
 * is that it is not a substitute for the `browser` tool (a page's behaviour in a
 * real browser is a different question), it cannot answer an approval, and it
 * must not be used to claim a page works.
 *
 * Flags:
 *   --scene <states|none>  which built-in scene to run (default: states)
 *   --out <dir>            where frames go; copied out of the scratch tree when given
 *   --gate-check           measure the fail-closed gate on four real boots
 *   --window-size <WxH>    the window to request (default 1380x900)
 *   --keep                 keep the scratch directory even with --clean
 *   --clean                remove the scratch directory at the end; frames given
 *                          with --out live outside it and survive
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = process.cwd();

/**
 * The Electron runtime BINARY, never `node_modules/.bin/electron`.
 *
 * WHY NOT `.bin/electron`: that file is a Node shim (`electron`'s `cli.js`) which
 * spawns the real app as ITS child. Spawning the shim means the pid this script
 * holds belongs to the shim, so the teardown's SIGTERM — and the SIGKILL it
 * escalates to five seconds later — land on the shim and the app it started is
 * re-parented to launchd and survives the run. Measured on this harness: a
 * `--gate-check --clean` run printed "scratch removed" with all four of its
 * booted apps still alive under `ppid 1`, each re-creating the scratch profile
 * the run had just deleted, one still answering `GET /json/version` on its
 * `--remote-debugging-port`.
 *
 * `require("electron")` is the same resolution `bin/local-operator-ui.js` uses,
 * so the harness drives the runtime the app ships against, and `child.pid` is
 * the app's own main process — which is what makes the exact-pid teardown below
 * reach it, and what lets the run say out loud which runtime a frame came from
 * (`electronRuntime()`).
 */
const ELECTRON_BIN = (() => {
	const resolveFromRepo = createRequire(join(ROOT, "package.json"));
	let binary;
	try {
		binary = resolveFromRepo("electron");
	} catch (error) {
		throw new Error(
			`cannot resolve the Electron runtime from ${ROOT}: ${error?.message ?? error}\n` +
				"Install this branch's own dependencies first: pnpm install --frozen-lockfile",
		);
	}
	if (typeof binary !== "string" || !existsSync(binary)) {
		throw new Error(
			`the Electron runtime is not on disk at ${String(binary)}\n` +
				"pnpm install --frozen-lockfile (or `npx install-electron --no`) fetches it.",
		);
	}
	return binary;
})();

/**
 * The Electron version installed here, and the version this branch pins.
 *
 * WHY THE HARNESS CHECKS THEM AGAINST EACH OTHER: a committed frame is only
 * reproducible on the runtime that produced it, and a worktree on this machine
 * inherits a SHARED `node_modules` symlink whose Electron can be stale (35.5.1
 * against this branch's 44.3.0 pin) — measured to differ in the content
 * viewport's height (1380x868 vs 1380x872) and in every pixel hash, which is
 * how a committed evidence pair ended up captured on a runtime nobody following
 * the README would install.
 *
 * `optionalDependencies.electron` is the pin the npm channel installs and that
 * `build.electronVersion` has to move with, so it is the value compared here —
 * in `main()`, as a check, so a run on a stale tree fails the gate instead of
 * quietly producing frames with someone else's binary's geometry.
 */
function electronRuntime() {
	const installed = JSON.parse(
		readFileSync(
			join(ROOT, "node_modules", "electron", "package.json"),
			"utf8",
		),
	).version;
	const pinned =
		JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
			.optionalDependencies?.electron ?? null;
	return { installed, pinned };
}

function argValue(name, fallback = null) {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

const SCENE = argValue("--scene", "states");
const OUT_ARG = argValue("--out", null);
const GATE_CHECK = process.argv.includes("--gate-check");
const KEEP = process.argv.includes("--keep");
const CLEAN = process.argv.includes("--clean");
const WINDOW_SIZE = argValue("--window-size", "1380x900");
const [WINDOW_WIDTH, WINDOW_HEIGHT] = WINDOW_SIZE.split("x").map((n) =>
	Number(n),
);

if (!/^\d+x\d+$/.test(WINDOW_SIZE)) {
	console.error(`--window-size expects WxH (got "${WINDOW_SIZE}")`);
	process.exit(2);
}

const SCRATCH_TAG = `lo-renderer-driver-${process.pid}`;
const SCRATCH = join(tmpdir(), SCRATCH_TAG);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
/**
 * The app's own log files, for this run.
 *
 * Set through the app's `LOCAL_OPERATOR_LOG_DIR` override in the child
 * environment, because the default cannot be redirected from outside: Electron's
 * `home` — which `src/main/backend/logger.ts` uses on macOS and Linux — is the OS
 * account's home, so neither the scratch `HOME` above nor `--user-data-dir` moves
 * it. Measured before this was wired up: a run's dead backend port appeared in
 * the operator's `~/Library/Application Support/Local Operator/logs/
 * backend-service.log`, i.e. the one path in this script's isolation list that
 * was not actually redirected.
 */
const LOG_DIR = join(SCRATCH, "logs");
/** The app's cwd. Outside the checkout on purpose: this is where dotenv looks. */
const APP_CWD = join(SCRATCH, "cwd");
const FRAMES = OUT_ARG ? resolve(OUT_ARG) : join(SCRATCH, "frames");

/**
 * The dead backend URL this run points the app at.
 *
 * Set once in `main()` and used by `writeAppCwdEnv`, which is called per boot:
 * the gate's `.env` cases rewrite the scratch `.env` between boots, so the file
 * cannot be written once up front. It is always a port this script picked and
 * verified dead, which is what keeps every frame publishable.
 */
let APP_API_URL = null;

/**
 * The scratch `.env` at the app's cwd, rewritten before every boot.
 *
 * This is what keeps a run off the operator's backend: main loads `.env` from
 * its cwd with dotenv `override: true`, and the cwd is outside the checkout, so
 * the repository's own `.env` is never read. It is also what the gate's `.env`
 * cases put the driver's opt-in into — a file in the working directory must not
 * be able to arm anything, which is a property only a real boot can measure.
 */
function writeAppCwdEnv(extraLines = []) {
	writeFileSync(
		join(APP_CWD, ".env"),
		[
			`# Written by scripts/renderer-driver.mjs. The app loads this with dotenv`,
			`# override:true from its cwd, which is why the harness runs with a cwd`,
			`# outside the checkout: a repo .env would win otherwise.`,
			`VITE_LOCAL_OPERATOR_API_URL=${APP_API_URL}`,
			`VITE_DISABLE_BACKEND_MANAGER=true`,
			...extraLines,
			"",
		].join("\n"),
	);
}

const transcript = [];
let failures = 0;

function say(line) {
	console.log(line);
}

function record(label, body) {
	transcript.push(`### ${label}\n\n\`\`\`\n${body}\n\`\`\`\n`);
}

function check(label, ok, detail) {
	if (!ok) failures += 1;
	const status = ok ? "PASS" : "FAIL";
	say(
		`[${status}] ${label}${detail === undefined ? "" : `\n        ${detail}`}`,
	);
	record(label, `[${status}] ${detail ?? ""}`);
	return ok;
}

function note(label, detail) {
	say(`[note] ${label}${detail === undefined ? "" : `\n        ${detail}`}`);
	record(label, `[note] ${detail ?? ""}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- ports ------------------------------------------------------------------

/** A port nothing is listening on, by binding and immediately releasing it. */
async function pickFreePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolvePort(port));
		});
	});
}

/** Is something accepting connections on this port? The answer bounds what a run can reach. */
async function isListening(port, timeoutMs = 750) {
	return new Promise((resolveAnswer) => {
		const socket = connect({ host: "127.0.0.1", port });
		const done = (answer) => {
			socket.destroy();
			resolveAnswer(answer);
		};
		socket.setTimeout(timeoutMs);
		socket.on("connect", () => done(true));
		socket.on("timeout", () => done(false));
		socket.on("error", () => done(false));
	});
}

// ---- the app -----------------------------------------------------------------

let app = null;

/**
 * The launches this run started and has not stopped yet.
 *
 * Handles rather than pids, because each one owns its own log stream and flush,
 * and because the reaper has to stop a boot the same way the normal path does.
 */
const liveBoots = new Set();

/** Resolve `true` when `promise` settles inside `ms`, `false` when it does not. */
async function settledWithin(promise, ms) {
	let timer = null;
	try {
		return await Promise.race([
			promise.then(() => true),
			new Promise((resolveTimeout) => {
				timer = setTimeout(() => resolveTimeout(false), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Kill by exact pid, never a pattern: a `pkill` would take the operator's app too.
 *
 * The signal goes to the app's OWN main process — the pid `spawn` returned once
 * the shim is gone (see `ELECTRON_BIN`) — and the escalation below targets that
 * same pid. That pairing is the whole fix: a SIGTERM the app does honour, and a
 * SIGKILL that lands on the app rather than on a shim that has already exited.
 * Helper processes (renderer, GPU, utility) are the app's own children and exit
 * with it — asserted rather than assumed, by the leftover probe at the end of
 * this run.
 */
async function stopApp(handle = app) {
	const stopping = handle;
	if (!stopping) return;
	/*
	 * The gate's boots are not the scene's, so `stopApp` has to be told WHICH
	 * launch to stop rather than assuming the module-level one. Leaving the
	 * parameter off is what the scene path does, and it clears `app`; every other
	 * caller passes its own handle, because a `--gate-check` run that relied on
	 * the global would kill nothing and leave one Electron per boot alive on the
	 * operator's machine after the script exited.
	 */
	if (stopping === app) app = null;
	stopping.flush();
	await stopProcess(stopping);
	liveBoots.delete(stopping);
}

/**
 * SIGTERM the pid, then SIGKILL that same pid if it is still there, and wait for
 * the exit either way.
 *
 * WHY THE WAIT IS THE POINT: `--clean` removes the scratch tree, and an app that
 * is still running re-creates the profile directory the run has just deleted
 * (`--user-data-dir` is under it). Waiting for the exit is what makes "scratch
 * removed" true of a tree nothing is writing to.
 */
async function stopProcess(handle, { termMs = 8000, killMs = 5000 } = {}) {
	const { child } = handle;
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
	child.kill("SIGTERM");
	if (await settledWithin(exited, termMs)) return;
	try {
		child.kill("SIGKILL");
	} catch {
		/* exited between the check and the signal */
	}
	await settledWithin(exited, killMs);
}

/**
 * Stop everything this run started, however the run ends.
 *
 * WHY A REAPER BESIDE THE `finally` BLOCKS: those run on the paths this script
 * chooses, and an agent's run is usually stopped by something else — Ctrl+C, a
 * supervisor's SIGTERM, a timeout — which used to leave every app booted so far
 * running headless on the operator's desktop, each holding its scratch profile
 * open. `SIGINT`/`SIGTERM` tear down exactly like the normal path (SIGTERM, then
 * SIGKILL, exact pids only); the `exit` hook is the last-resort synchronous pass
 * for a path that reaches the end without the async one, and can only SIGKILL.
 */
const reaping = { running: false };

async function reapLiveBoots({ code, why }) {
	if (reaping.running) return;
	reaping.running = true;
	const boots = [...liveBoots];
	if (boots.length > 0) {
		say(`\n[${why}] stopping ${boots.length} app(s) this run started`);
	}
	for (const handle of boots) {
		try {
			await stopApp(handle);
		} catch (error) {
			say(`[${why}] teardown threw: ${error?.message ?? error}`);
		}
	}
	process.exit(code);
}

process.on("exit", () => {
	for (const handle of liveBoots) {
		try {
			process.kill(handle.pid, "SIGKILL");
		} catch {
			/* already gone */
		}
	}
});
process.on("SIGINT", () => void reapLiveBoots({ code: 130, why: "SIGINT" }));
process.on("SIGTERM", () => void reapLiveBoots({ code: 143, why: "SIGTERM" }));

/**
 * Every process on the machine whose command line names THIS run's scratch tag.
 *
 * DETECTION ONLY, never a kill list, and the tag is what makes it safe to ask: it
 * contains this script's pid, so a match cannot be another session's process and
 * cannot be the operator's own app. It exists because a pattern is the only way
 * to SEE an orphan — an app re-parented to launchd no longer answers to any pid
 * this run holds, but it still carries the run's tag in `--user-data-dir`. The
 * kills in this file stay exact-pid; a sibling agent's pattern-derived kill on
 * this machine matched eleven orphaned apps from runs that had already finished.
 */
function thisRunsProcesses() {
	const ps = spawnSync("ps", ["-eo", "pid,ppid,etime,command"], {
		encoding: "utf8",
	});
	if (ps.error || ps.status !== 0) {
		return {
			measured: false,
			lines: [],
			detail: ps.error?.message ?? `ps exited ${ps.status}`,
		};
	}
	const lines = String(ps.stdout)
		.split("\n")
		.filter((line) => line.includes(SCRATCH_TAG));
	return { measured: true, lines, detail: `${lines.length} process(es)` };
}

async function launchApp({
	armed,
	apiUrl,
	logName,
	tag,
	/*
	 * Extra lines for the scratch `.env` this boot runs with, and extra variables
	 * for its environment. Both exist for the gate's `.env` cases below, which
	 * measure that a file in the working directory can neither arm the driver
	 * nor beat an explicit off: only the ENVIRONMENT the process was launched
	 * with may carry the opt-in, and these two knobs are how a case puts the
	 * keys where they must be ignored.
	 */
	dotenvLines = [],
	envExtra = {},
}) {
	writeAppCwdEnv(dotenvLines);
	const env = {
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		// No backend manager: this run must not install or start a Local Operator
		// backend in the scratch HOME.
		VITE_DISABLE_BACKEND_MANAGER: "true",
	};
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	/*
	 * The driver's own variables are decided HERE, for every boot, rather than
	 * inherited from whoever ran this script. `armed: false` has to mean not
	 * armed, and an opt-in exported in the operator's shell (or left over in the
	 * environment from a previous command) must not arm the boot that exists to
	 * prove an unarmed launch is inert — which would report a healthy tree as
	 * three FAILs, or arm a boot this script believes is inert. Deleting rather
	 * than overwriting is what makes "the unarmed boot was given no frames
	 * directory at all" true, so the empty-frames assertion below is about the
	 * launch rather than about which directory the harness happened to count.
	 */
	delete env.LOCAL_OPERATOR_UI_DEV_DRIVER;
	delete env.LOCAL_OPERATOR_UI_DEV_DRIVER_OUT;
	if (armed) {
		env.LOCAL_OPERATOR_UI_DEV_DRIVER = "1";
		env.LOCAL_OPERATOR_UI_DEV_DRIVER_OUT = FRAMES;
	}
	Object.assign(env, envExtra);

	const port = await pickFreePort();
	if (await isListening(port)) throw new Error(`picked port ${port} is in use`);

	/*
	 * The BINARY, not `node_modules/.bin/electron` — see `ELECTRON_BIN`. The shim
	 * would make `child.pid` the shim's pid and orphan the app the shim starts.
	 */
	const child = spawn(
		ELECTRON_BIN,
		[
			// The app directory as an argument rather than `.`: argv[1] is what
			// Electron loads, so the cwd can be the scratch directory that the
			// app's own dotenv reads.
			ROOT,
			// A profile directory PER LAUNCH, not one per run. The app takes a
			// single-instance lock (`app.requestSingleInstanceLock`) and the second
			// boot of a `--gate-check` run otherwise finds the first one's lock still
			// held, prints "Another instance is already running. Quitting this
			// instance." and exits without ever creating a window — which looks
			// exactly like a broken driver. Measured on the first two-boot run.
			`--user-data-dir=${USER_DATA}-${tag}`,
			`--remote-debugging-port=${port}`,
			"--window-mode=headless",
			`--window-size=${WINDOW_SIZE}`,
		],
		{ env, cwd: APP_CWD, stdio: ["ignore", "pipe", "pipe"] },
	);

	const logPath = join(SCRATCH, logName);
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const flush = () => writeFileSync(logPath, stream.join(""));
	const timer = setInterval(flush, 500);
	child.on("exit", () => {
		clearInterval(timer);
		flush();
	});

	const handle = {
		child,
		port,
		pid: child.pid,
		logPath,
		stream,
		flush,
		apiUrl,
	};
	/*
	 * Registered before anything can throw, so the reaper above owns every boot
	 * this run started — including one that dies before its first answer.
	 */
	liveBoots.add(handle);
	return handle;
}

async function readAppLog(handle) {
	handle.flush();
	try {
		return readFileSync(handle.logPath, "utf8");
	} catch {
		return "";
	}
}

// ---- the renderer, over the app's own CDP ------------------------------------

/**
 * Wait for the app's own debugging port to answer.
 *
 * The port is not there the moment Electron is spawned, and asking too early is
 * not a hypothetical: the first version of this script fetched `/json/list`
 * immediately and died with a bare `TypeError: fetch failed`, which says nothing
 * about whether the app failed to start or simply had not started. So the wait
 * is bounded, it names what it waited for, and it hands back the app log when
 * the timeout is the answer.
 */
async function waitForDevtools(handle, timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		try {
			const response = await fetch(`http://127.0.0.1:${handle.port}/json/version`);
			if (response.ok) return;
		} catch {
			/* not listening yet */
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				`the app's debugging port ${handle.port} never answered in ${timeoutMs}ms\n` +
					(await readAppLog(handle)).split("\n").slice(-30).join("\n"),
			);
		}
		await wait(250);
	}
}

/**
 * A CDP client for ONE target, over Node's built-in WebSocket.
 *
 * Requests are resolved by their own id, so a later call cannot read an earlier
 * call's reply — the bug `scripts/browser-host-proof.mjs` documents having hit
 * when it resolved on "the first message after sending".
 */
class CdpClient {
	constructor(socket) {
		this.socket = socket;
		this.nextId = 1;
		this.pending = new Map();
		this.console = [];
		socket.addEventListener("message", (event) => {
			let message = null;
			try {
				message = JSON.parse(event.data);
			} catch {
				return;
			}
			if (message.method === "Runtime.consoleAPICalled") {
				this.console.push(
					(message.params?.args ?? [])
						.map((a) => String(a.value ?? a.description ?? ""))
						.join(" "),
				);
			}
			if (message.id !== undefined && this.pending.has(message.id)) {
				this.pending.get(message.id)(message);
				this.pending.delete(message.id);
			}
		});
	}

	static async attach(port, targetUrlPart) {
		const list = await (
			await fetch(`http://127.0.0.1:${port}/json/list`)
		).json();
		const target = list.find(
			(entry) => entry.type === "page" && entry.url.includes(targetUrlPart),
		);
		if (!target) {
			throw new Error(
				`no renderer target for ${targetUrlPart} on port ${port}: ` +
					JSON.stringify(list.map((e) => ({ type: e.type, url: e.url }))),
			);
		}
		const socket = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((resolveOpen, rejectOpen) => {
			socket.addEventListener("open", resolveOpen, { once: true });
			socket.addEventListener("error", rejectOpen, { once: true });
		});
		const client = new CdpClient(socket);
		client.send("Runtime.enable").catch(() => {});
		client.send("Page.enable").catch(() => {});
		return client;
	}

	send(method, params = {}) {
		const id = this.nextId++;
		this.socket.send(JSON.stringify({ id, method, params }));
		return new Promise((resolveReply, rejectReply) => {
			this.pending.set(id, resolveReply);
			setTimeout(() => {
				if (this.pending.delete(id)) {
					rejectReply(new Error(`CDP ${method} timed out`));
				}
			}, 30_000);
		});
	}

	/**
	 * Evaluate in the app's renderer and return the value, or throw.
	 *
	 * A CDP-level error and a thrown exception in the page are both failures of
	 * the run: reading only `result.result.value` is how a torn-down context reads
	 * as `undefined` and a real refusal looks like a missing feature.
	 */
	async evaluate(expression) {
		const reply = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (reply.error) throw new Error(`CDP: ${reply.error.message}`);
		if (reply.result?.exceptionDetails) {
			throw new Error(
				reply.result.exceptionDetails.exception?.description ??
					reply.result.exceptionDetails.text ??
					"threw",
			);
		}
		return reply.result?.result?.value;
	}

	close() {
		try {
			this.socket.close();
		} catch {
			/* already closed */
		}
	}
}

/** Wait until the app's own renderer has loaded and mounted its root. */
async function waitForPage(cdp, timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		const state = await cdp
			.evaluate(
				"({ ready: document.readyState, mounted: Boolean(document.getElementById('app')?.childElementCount), title: document.title })",
			)
			.catch(() => null);
		if (state?.ready === "complete" && state.mounted) return state;
		if (Date.now() - started > timeoutMs) {
			throw new Error(`the renderer never painted: ${JSON.stringify(state)}`);
		}
		await wait(250);
	}
}

async function waitForBridge(cdp, timeoutMs = 90_000) {
	const started = Date.now();
	for (;;) {
		const verbs = await cdp
			.evaluate(
				"typeof window.__loDevDriver?.verbs === 'function' ? window.__loDevDriver.verbs() : null",
			)
			.catch(() => null);
		if (Array.isArray(verbs) && verbs.includes("hello")) return verbs;
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				`the renderer never registered the dev driver verbs (last: ${JSON.stringify(verbs)})`,
			);
		}
		await wait(250);
	}
}

/** Call a registered scene verb. */
function verb(cdp, name, payload) {
	return cdp.evaluate(
		`window.__loDevDriver.call(${JSON.stringify(name)}, ${JSON.stringify(payload ?? null)})`,
	);
}

/** Capture a frame through the app's own `capturePage()`. */
function capture(cdp, label) {
	return cdp.evaluate(`window.__loDevDriver.capture(${JSON.stringify(label)})`);
}

/**
 * The selector sonner renders its toasts into (`themed-toast-container.tsx`).
 * Pinned as a constant because a boot assertion and a scene check both read it.
 */
const TOAST_SELECTOR = "[data-sonner-toast]";

/** How many toasts are on screen right now, asked of the app's own DOM. */
function toastsOnScreen(cdp) {
	return cdp.evaluate(
		`document.querySelectorAll(${JSON.stringify(TOAST_SELECTOR)}).length`,
	);
}

/**
 * Wait until no toast is on screen, or give up and say so.
 *
 * WHY A FRAME HAS TO BE TOAST-FREE. A driver run has no backend, so the app's
 * queries fail: `/chat` mounts, React Query's agent list answers 503, and the app
 * raises its own toast in the bottom-right corner — a real screen of a real
 * state, but one that appears and auto-dismisses on a clock that has nothing to
 * do with what the scene is photographing. Measured: two `--scene states` runs on
 * the same build produced `chat-dark.png` differing in exactly that corner, one
 * with `List agents request failed: 503` up and one without, 2.1% of pixels — so
 * without this wait a committed frame is a coin-flip on whether a transient
 * banner happened to be on screen, and the caption (which names the rail, the
 * offline banner and the chat list's error row) would not describe it.
 *
 * Error toasts here auto-dismiss (sonner's default, and `toast-manager.ts`
 * handles `onAutoClose`), so waiting is enough and no dismissal is forced: the
 * scene does not reach into the app's toasts, it waits for the app to take its
 * own down. A toast that outlives the bound is reported rather than waited
 * through forever, and the caller fails the frame instead of committing it.
 */
async function waitForNoToasts(cdp, timeoutMs = 15_000) {
	const started = Date.now();
	for (;;) {
		const count = await toastsOnScreen(cdp).catch(() => 0);
		const waitedMs = Date.now() - started;
		if (count === 0) return { waitedMs, timedOut: false };
		if (waitedMs > timeoutMs) return { waitedMs, timedOut: true };
		await wait(200);
	}
}

/**
 * Capture a frame the app is HOLDING, with no transient toast on it.
 *
 * WHY TWO CAPTURES, when the theme verb already waits the transitions out. The
 * settle inside the app cannot see a transition that starts after it looked, and
 * it has been wrong exactly that way on this build: two `--scene states` runs on
 * Electron 44.3.0 produced a `chat-light.png` whose rail pill and banner `Retry`
 * were 46% of the way through their colour transition (srgb(122,133,124) between
 * the dark srgb(26,40,30) and the settled srgb(233,241,233)) in a run whose verb
 * answered `timedOut: false` after 175ms. The verb now requires three consecutive
 * quiet frames, and this is the harness-side check on the same property, measured
 * on the pixels rather than on the app's bookkeeping: two captures `gapMs` apart
 * are the same bytes only if nothing was animating between them.
 *
 * The file the scene compares is the SECOND capture, so what a reviewer opens is
 * what was held. `stable` and `toastFree` are reported rather than rounded up —
 * the scene checks both, because a frame the app never held still for, or one
 * with a transient banner on it, is not evidence.
 */
async function captureSettled(cdp, label, { attempts = 8, gapMs = 150 } = {}) {
	let previous = null;
	let frame = null;
	let toastWaitMs = 0;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const clearance = await waitForNoToasts(cdp);
		toastWaitMs += clearance.waitedMs;
		frame = await capture(cdp, label);
		const bytes = readFileSync(frame.path);
		// A toast that arrived while the frame was being taken is not this frame:
		// the run throws the capture away and starts the comparison again.
		const toastFree = (await toastsOnScreen(cdp).catch(() => 0)) === 0;
		if (!toastFree || clearance.timedOut) {
			previous = null;
			await wait(gapMs);
			continue;
		}
		if (previous !== null && previous.equals(bytes)) {
			return { ...frame, attempts: attempt, stable: true, toastFree, toastWaitMs };
		}
		previous = bytes;
		await wait(gapMs);
	}
	return { ...frame, attempts, stable: false, toastFree: false, toastWaitMs };
}

/**
 * The bridge's own methods, which are NOT scene verbs: `facts()` (window facts
 * from main) and `capture()` live on `window.__loDevDriver` itself, while the
 * verbs the app registers are reached through `call(name)`. The two surfaces are
 * deliberately separate — `capture` and `facts` are main's, and the verbs are the
 * app's — which is also why a scene verb table is enumerable: calling one that
 * does not exist answers with what does.
 */
function factsOf(cdp) {
	return cdp.evaluate("window.__loDevDriver.facts()");
}

// ---- isolation probes --------------------------------------------------------

/**
 * Does the app process hold a connection to the URL the renderer was built with?
 *
 * `lsof` is asked per pid, so this cannot report some other process's traffic as
 * this run's. When `lsof` is unavailable the probe says so rather than answering
 * "no connections" — an unmeasured isolation claim is the failure mode here.
 */
function connectionsTo(pid, url) {
	let host = null;
	let port = null;
	try {
		const parsed = new URL(url);
		host = parsed.hostname;
		port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
	} catch {
		return { measured: false, detail: `cannot parse ${url}` };
	}
	return new Promise((resolveProbe) => {
		const probe = spawn(
			"/usr/sbin/lsof",
			["-a", "-p", String(pid), "-i", "-n", "-P"],
			{
				stdio: ["ignore", "pipe", "ignore"],
			},
		);
		if (probe.error) {
			resolveProbe({ measured: false, detail: "lsof unavailable" });
			return;
		}
		const out = [];
		probe.stdout.on("data", (chunk) => out.push(chunk.toString()));
		probe.on("error", () =>
			resolveProbe({ measured: false, detail: "lsof unavailable" }),
		);
		probe.on("exit", () => {
			const text = out.join("");
			const matches = text
				.split("\n")
				.filter((line) => line.includes(`:${port}`) && line.includes(host));
			resolveProbe({ measured: true, matches, text });
		});
	});
}

// ---- scenes ------------------------------------------------------------------

/**
 * `states`: the before/after pair this harness exists to produce, plus a second
 * surface. The theme change is made by PRESSING the settings control (the same
 * element a user presses), not by writing the store, and the frames either side
 * of it are the same screen — which is the shape a visual-change review needs.
 */
async function sceneStates(cdp) {
	const hello = await verb(cdp, "hello");
	note("hello", JSON.stringify(hello, null, 2));
	check(
		"the renderer reports this run's frames directory",
		hello.outDir === FRAMES,
		`${hello.outDir} (expected ${FRAMES})`,
	);
	check(
		"the renderer sees the built app, not a bare Vite page",
		/Electron/i.test(hello.userAgent),
		hello.userAgent,
	);

	const facts = await factsOf(cdp);
	note("facts (from main)", JSON.stringify(facts, null, 2));
	check(
		"window mode is headless",
		facts.windowMode === "headless",
		facts.windowMode,
	);
	check(
		"the window is never shown",
		facts.visible === false,
		`visible=${facts.visible} focused=${facts.focused} minimized=${facts.minimized}`,
	);
	check(
		"the window never has focus",
		facts.focused === false,
		`focused=${facts.focused}`,
	);
	check(
		"the requested window size is the size that exists",
		facts.windowSize.width === WINDOW_WIDTH &&
			facts.windowSize.height === WINDOW_HEIGHT,
		`${JSON.stringify(facts.windowSize)} for a requested ${WINDOW_SIZE}`,
	);
	check(
		"the content area is smaller than the window by the platform's chrome only",
		facts.contentBounds.width === facts.windowSize.width &&
			facts.contentBounds.height < facts.windowSize.height &&
			facts.windowSize.height - facts.contentBounds.height <= 40,
		`window ${JSON.stringify(facts.windowSize)} content ${JSON.stringify(facts.contentBounds)}`,
	);

	/*
	 * The surfaces are chosen to need no backend, because a driver run has none
	 * (see the isolation notes at the top). What is deliberately NOT captured
	 * here is any route whose content is backend-gated — `settings`, `agents`,
	 * `agent-hub` and `schedules` are lazy routes that sit on a spinner until
	 * React Query gives up — because a frame of a spinner is a real frame of a
	 * real state and not one a reviewer can judge a layout by. The run says so
	 * rather than presenting one as evidence; a driver whose backend IS up gets
	 * those screens normally.
	 */

	// 1. The chat screen in the default (dark) palette.
	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", "localOperatorDark");
	const before = await verb(cdp, "state");
	note("state before", JSON.stringify(before));
	const beforeFrame = await captureSettled(cdp, "chat-dark");
	note("frame", JSON.stringify(beforeFrame));

	// 2. The same screen in another palette: the before/after pair a visual
	// change is reviewed against. Driven by the app's own theme action (the one
	// the settings picker and the `/theme` picker call), not by writing the DOM.
	const themeAction = await verb(cdp, "setTheme", "localOperatorLight");
	const after = await verb(cdp, "state");
	/*
	 * Recorded because it is the difference between an after frame that is the
	 * light palette and one that is a blend of the two: the verb waits out the
	 * `transition-colors duration-fast` (120ms) the change starts, and a reader
	 * comparing a fresh run against the committed frame needs to know the wait
	 * happened and that it did not hit its bound.
	 *
	 * It FAILS on a bound it hit, rather than noting it beside the frame. A settle
	 * that timed out means the frame this run is about to commit is mid-transition
	 * — the exact defect this wait was added for, when `chat-light.png` was once
	 * captured one `nextFrame()` after the theme action and varied run to run — and
	 * a `[note]` next to an invalid frame is how that defect stayed invisible in a
	 * run that reported "ALL CHECKS PASSED". A settle that reports no duration at
	 * all is the same failure wearing a pass: `Number.isFinite` refuses it.
	 */
	check(
		"the theme change settled before the frame",
		themeAction.settleTimedOut === false &&
			Number.isFinite(themeAction.settledAfterMs),
		`${themeAction.settledAfterMs}ms${themeAction.settleTimedOut ? " — TIMED OUT: this frame is mid-transition and is not evidence" : ""}`,
	);
	check(
		"the theme action changed the app's own theme state",
		after.theme === "localOperatorLight",
		`theme ${before.theme} -> ${after.theme}`,
	);
	const afterFrame = await captureSettled(cdp, "chat-light");
	note("frame", JSON.stringify(afterFrame));
	check(
		"the before/after pair is the same screen at the same size",
		beforeFrame.viewport.width === afterFrame.viewport.width &&
			beforeFrame.viewport.height === afterFrame.viewport.height &&
			before.route === after.route,
		`${before.route} ${JSON.stringify(beforeFrame.viewport)} vs ${after.route} ${JSON.stringify(afterFrame.viewport)}`,
	);
	/*
	 * ...and it has to be TWO renders.
	 *
	 * Every other assertion about this pair — same route, same viewport, and the
	 * theme state the app reports — is satisfied by the same bytes written twice,
	 * which is exactly what once shipped: `chat-light.png` was a byte copy of
	 * `chat-dark.png`, so the "before/after pair" tabled in the README as the
	 * light palette showed the dark screen twice, and nothing here noticed. The
	 * check is on the FILES ON DISK rather than on `bytes` or the app's state,
	 * because a frame is only evidence if what a reviewer opens is what the theme
	 * action produced. The hashes are printed so a reader can compare a committed
	 * frame against a fresh run without trusting either this script's summary or
	 * the file's size.
	 */
	const darkBytes = readFileSync(join(FRAMES, "chat-dark.png"));
	const lightBytes = readFileSync(join(FRAMES, "chat-light.png"));
	const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
	check(
		"the before/after pair is two different renders, not one frame twice",
		!darkBytes.equals(lightBytes),
		`chat-dark.png ${darkBytes.length}B ${sha(darkBytes).slice(0, 16)}… vs chat-light.png ${lightBytes.length}B ${sha(lightBytes).slice(0, 16)}…`,
	);

	// 3. Real controls, to prove the driver reaches the app's own handlers and
	// not only its stores: press the rail's Agent hub button (the selector the
	// onboarding tour clicks) and then the Chat button, and watch the route move
	// both ways. No frame is captured from either destination: `agent-hub` is one
	// of the backend-gated routes above, and capturing the spinner would say less
	// than this assertion does.
	const hubPress = await verb(
		cdp,
		"press",
		'[data-tour-tag="nav-item-agent-hub"]',
	);
	note("press", JSON.stringify(hubPress));
	check(
		"the pressed control received the point (hit test)",
		hubPress.hitTest === true,
		JSON.stringify({
			hitTest: hubPress.hitTest,
			hit: hubPress.hit,
			target: hubPress.target,
		}),
	);
	const hubState = await verb(cdp, "state");
	check(
		"pressing the rail's Agent hub button navigated the app",
		hubState.route === "/agent-hub",
		JSON.stringify(hubState),
	);
	const chatPress = await verb(cdp, "press", '[data-tour-tag="nav-item-chat"]');
	const chatState = await verb(cdp, "state");
	check(
		"pressing the rail's Chat button navigated back, and the theme survived",
		chatPress.hitTest === true &&
			chatState.route === "/chat" &&
			chatState.theme === "localOperatorLight",
		JSON.stringify(chatState),
	);
	const backFrame = await captureSettled(cdp, "chat-light-returned");
	note("frame", JSON.stringify(backFrame));

	const frames = [beforeFrame, afterFrame, backFrame];
	/*
	 * The settle is a claim about the app's own animations; this is the same claim
	 * measured on the pixels, and it is the one a reader can check against the
	 * committed file. A frame that never stopped changing is reported as unstable
	 * and fails the scene, because committing it is how the earlier rounds shipped
	 * a caption that did not match its bytes.
	 */
	check(
		"every capture is a frame the app held still for, with no toast on it",
		frames.every((frame) => frame.stable === true && frame.toastFree === true),
		frames
			.map(
				(frame) =>
					`${frame.label}: ${frame.stable === true ? `held still after ${frame.attempts} capture(s)` : `never held still in ${frame.attempts} capture(s)`}, toast-free ${frame.toastFree === true}, waited ${frame.toastWaitMs}ms for toasts`,
			)
			.join(" | "),
	);
	check(
		"every capture wrote a PNG of the requested size",
		frames.every(
			(frame) =>
				frame.bytes > 1000 &&
				frame.pixels.width ===
					frame.viewport.width * frame.viewport.devicePixelRatio &&
				frame.pixels.height ===
					frame.viewport.height * frame.viewport.devicePixelRatio,
		),
		frames
			.map(
				(f) => `${f.label}: ${f.pixels.width}x${f.pixels.height}, ${f.bytes}B`,
			)
			.join(" | "),
	);
	return frames;
}

// ---- gate-check --------------------------------------------------------------

/**
 * The `Log path: …` lines the app itself wrote, from this run's scratch logs.
 *
 * Read from the file rather than from the variable this script exported: the
 * question is where the app RESOLVED its logs, and a run whose lines land in the
 * operator's directory is not isolated however many other paths are redirected.
 */
function resolvedLogPaths() {
	const lines = [];
	for (const file of ["backend-installer.log", "backend-service.log"]) {
		const path = join(LOG_DIR, file);
		if (!existsSync(path)) continue;
		for (const line of readFileSync(path, "utf8").split("\n")) {
			if (line.includes("Log path:")) lines.push(line.trim());
		}
	}
	return [...new Set(lines)];
}

/**
 * The checks ONE launch that did not ask for the driver must pass: the app
 * paints normally, exposes no bridge, has main refuse the capture channel,
 * writes no frame, and prints no banner.
 *
 * The paint assertion comes first on purpose. The first cut of this gate used
 * an `ipcRenderer.sendSync` handshake, which never answers on a channel with no
 * listener, so an ordinary launch hung inside the preload and never painted —
 * and "the bridge is absent" would have passed while the app was broken.
 *
 * Factored out because the gate has FOUR boots that must all be inert except
 * the last: the plain one, one whose cwd `.env` carries the opt-in, one whose
 * `.env` carries it while the launch environment explicitly refuses, and the
 * armed one. Four hand-copied versions of this list is how one of them quietly
 * stops asserting.
 */
async function inertBootChecks(
	cdp,
	handle,
	prefix,
	framesDir,
	{ refusalExpected = false, logDirFromFile = null } = {},
) {
	const results = [];
	const page = await waitForPage(cdp);
	results.push(
		check(
			`${prefix}: the app loaded and painted normally`,
			page.mounted === true && page.title === "Local Operator",
			JSON.stringify(page),
		),
	);
	const bridgeType = await cdp.evaluate("typeof window.__loDevDriver");
	results.push(
		check(
			`${prefix}: the renderer has no dev-driver bridge`,
			bridgeType === "undefined",
			`typeof window.__loDevDriver === ${bridgeType}`,
		),
	);
	const refused = await cdp.evaluate(`(async () => {
		try {
			await window.electron.ipcRenderer.invoke("dev-driver-capture", "gate-check-probe");
			return "resolved";
		} catch (error) { return String(error?.message ?? error); }
	})()`);
	results.push(
		check(
			`${prefix}: main refuses the capture channel`,
			/no handler registered/i.test(refused),
			refused,
		),
	);
	/*
	 * Counted in the directory THIS boot could have written to, not in the
	 * harness's own frames directory: those are the same place for the plain
	 * unarmed boot and different ones for the `.env` cases, which name a
	 * directory of their own in the file that asks to be armed. An ambient
	 * `LOCAL_OPERATOR_UI_DEV_DRIVER_OUT` in the caller's shell is no longer a
	 * third answer, because `launchApp` deletes the variable rather than
	 * inheriting it.
	 */
	const framesBefore = readdirSync(framesDir).filter((f) => f.endsWith(".png"));
	results.push(
		check(
			`${prefix}: no frame was written`,
			framesBefore.length === 0,
			`${framesBefore.length} PNG(s) in ${framesDir}`,
		),
	);
	/*
	 * The log directory is the one launch fact a file in the working directory
	 * must not be able to move, and this boot is what keeps that true: the
	 * override is read from the pre-dotenv `launchEnv` snapshot, so the file's own
	 * `LOCAL_OPERATOR_LOG_DIR` is resolved to nothing and the run's scratch tree is
	 * what the app names in its own `Log path:` line. It only behaved that way by
	 * IMPORT ORDER before (the `Logger` singleton is constructed while
	 * `logger.ts` is evaluated, which is before `backend/config.ts` folds the
	 * file), so a lazy `getInstance()` would have quietly handed the operator's
	 * log directory to a `.env` — measured by review round 2 as an asymmetry, with
	 * `dotenv-logs` never created.
	 */
	if (logDirFromFile !== null) {
		const resolved = resolvedLogPaths();
		const honouredTheFile = existsSync(logDirFromFile);
		const namedTheRunsTree = resolved.some((line) =>
			line.includes(`Log path: ${LOG_DIR}`),
		);
		results.push(
			check(
				`${prefix}: the log directory did not move`,
				namedTheRunsTree && !honouredTheFile,
				`${resolved.join(" / ") || "no Log path: line"}${honouredTheFile ? `; the file's ${logDirFromFile} was created` : ""}`,
			),
		);
	}
	const log = await readAppLog(handle);
	const driverLines = log
		.split("\n")
		.filter((line) => line.includes("[dev-driver]"));
	/*
	 * "Not armed" and "silent" are different claims, and which one is right
	 * depends on what the LAUNCH was given.
	 *
	 * A launch whose environment said nothing about the driver must be silent:
	 * that is the property a normal launch has, and it is also what a `.env`
	 * asking to be armed must not change. The boot that sets `=0` explicitly is
	 * the exception, because a value that was set and refused is REPORTED rather
	 * than ignored — `=0` is not one of the accepted opt-ins (`1`, `true`), so
	 * the launch prints the refusal below. Both are asserted here, in those
	 * words, rather than with one loose "it did not say ARMED", so a boot that
	 * stopped reporting a refusal would fail this check instead of passing it.
	 */
	const armedLines = driverLines.filter((line) =>
		/\[dev-driver\] ARMED/.test(line),
	);
	results.push(
		refusalExpected
			? check(
					`${prefix}: the launch refused the driver out loud`,
					armedLines.length === 0 &&
						/not an opt-in/.test(driverLines.join(" / ")) &&
						/stayed off/.test(driverLines.join(" / ")),
					driverLines.join(" / ") || "no [dev-driver] line",
				)
			: check(
					`${prefix}: the launch said nothing about the driver`,
					driverLines.length === 0,
					driverLines.join(" / ") || "no [dev-driver] line",
				),
	);
	return results;
}

/** Boot a launch that must be inert, measure it, and stop it by its own pid. */
async function inertBoot({
	prefix,
	logName,
	tag,
	framesDir,
	dotenvLines = [],
	envExtra = {},
	refusalExpected = false,
	logDirFromFile = null,
}) {
	const handle = await launchApp({
		armed: false,
		logName,
		tag,
		dotenvLines,
		envExtra,
	});
	let cdp = null;
	try {
		await waitForDevtools(handle);
		cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
		return await inertBootChecks(cdp, handle, prefix, framesDir, {
			refusalExpected,
			logDirFromFile,
		});
	} finally {
		cdp?.close();
		await stopApp(handle);
	}
}

/**
 * The fail-closed proof, on four real boots: three launches that must be
 * indistinguishable from the app as it was — no bridge, no channel, no frames —
 * and one armed launch that must produce all three.
 *
 * The three inert boots are not redundant. One has nothing set anywhere; one is
 * asked to arm by a `.env` in its own working directory; and one is asked to arm
 * by that same file while its environment says `=0`. Those are the two ways the
 * gate could be defeated without a flag — a control surface the repository's own
 * config file can switch on, and an explicit refusal a file can override — and
 * both were real before this round: measured, a `.env` carrying the opt-in armed
 * a launch with no driver variable in the child environment at all, and an
 * explicit `LOCAL_OPERATOR_UI_DEV_DRIVER=0` in the shell still armed it and
 * wrote a real PNG.
 */
async function gateCheck() {
	const results = [];

	// --- 1. unarmed, nothing set anywhere ---
	results.push(
		...(await inertBoot({
			prefix: "unarmed",
			logName: "app-unarmed.log",
			tag: "unarmed",
			framesDir: FRAMES,
		})),
	);

	/*
	 * --- 2. the cwd `.env` asks to be armed, and is ignored ---
	 *
	 * `src/main/backend/config.ts` folds a `.env` from the app's cwd into
	 * `process.env` with dotenv `override: true` at import time. The driver's
	 * opt-in (and the window mode) is resolved from `launchEnv`, the snapshot
	 * taken before that fold, so the same keys in the file must do nothing — and
	 * this boot is what keeps it that way. The window mode is named in the file
	 * here for the same reason it is a launch fact in the code: a file that could
	 * set it could turn a deliberate headless run into one that raises a window
	 * over the operator's work, and this script's only consent to show a window
	 * is the `--window-mode` flag it passes.
	 */
	const dotenvFrames = join(SCRATCH, "dotenv-frames");
	const dotenvOffFrames = join(SCRATCH, "dotenv-off-frames");
	// The directory the `.env` below asks the app to log into. The launch exports
	// `LOCAL_OPERATOR_LOG_DIR` as this run's scratch `logs/`, so a boot that
	// honoured the file would leave this directory behind instead — see the check
	// `inertBootChecks` makes when it is given this path.
	const dotenvLogs = join(SCRATCH, "dotenv-logs");
	mkdirSync(dotenvFrames, { recursive: true });
	mkdirSync(dotenvOffFrames, { recursive: true });
	results.push(
		...(await inertBoot({
			prefix: "a cwd .env cannot arm",
			logName: "app-dotenv.log",
			tag: "dotenv",
			framesDir: dotenvFrames,
			dotenvLines: [
				"LOCAL_OPERATOR_UI_DEV_DRIVER=1",
				`LOCAL_OPERATOR_UI_DEV_DRIVER_OUT=${dotenvFrames}`,
				"LOCAL_OPERATOR_UI_WINDOW_MODE=headless",
				`LOCAL_OPERATOR_LOG_DIR=${dotenvLogs}`,
			],
			logDirFromFile: dotenvLogs,
		})),
	);

	/*
	 * --- 3. an explicit off in the environment beats the file ---
	 *
	 * The other half of the same property, and the one a person relies on: while
	 * a `.env` line is present, `LOCAL_OPERATOR_UI_DEV_DRIVER=0` on the command
	 * line has to mean no. This is the boot that would have armed before the fix.
	 */
	results.push(
		...(await inertBoot({
			prefix: "an explicit off beats the .env",
			logName: "app-dotenv-off.log",
			tag: "dotenv-off",
			framesDir: dotenvOffFrames,
			dotenvLines: [
				"LOCAL_OPERATOR_UI_DEV_DRIVER=1",
				`LOCAL_OPERATOR_UI_DEV_DRIVER_OUT=${dotenvOffFrames}`,
			],
			envExtra: { LOCAL_OPERATOR_UI_DEV_DRIVER: "0" },
			// `=0` is not one of the accepted opt-ins, so this launch reports the
			// refusal rather than staying silent — see `inertBootChecks`.
			refusalExpected: true,
		})),
	);

	// --- 4. armed: the opt-in AND a frames directory, in the environment ---
	const handle = await launchApp({
		armed: true,
		logName: "app-armed.log",
		tag: "armed",
	});
	let cdp = null;
	try {
		await waitForDevtools(handle);
		cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
		const verbs = await waitForBridge(cdp);
		results.push(
			check(
				"armed: the renderer has the bridge and its verbs",
				Array.isArray(verbs) && verbs.length > 0,
				JSON.stringify(verbs),
			),
		);
		const frame = await capture(cdp, "gate-check-armed");
		results.push(
			check(
				"armed: capture wrote a real PNG",
				frame.bytes > 1000 && frame.path.endsWith("gate-check-armed.png"),
				JSON.stringify(frame),
			),
		);
		const log = await readAppLog(handle);
		results.push(
			check(
				"armed: the launch said so on stdout",
				/\[dev-driver\] ARMED/.test(log),
				log
					.split("\n")
					.filter((l) => l.includes("[dev-driver]"))
					.join(" / ") || "no [dev-driver] line",
			),
		);
		/*
		 * The leftover-process probe, asserted while the app IS running.
		 *
		 * Without this direction the "nothing outlived its boot" check at the end
		 * of the run could pass for a tag that never matches anything — the shape
		 * the previous round's false claim had. Both halves are in the transcript so
		 * a reader can see the probe find an app and then find none.
		 */
		const whileArmed = thisRunsProcesses();
		results.push(
			check(
				"armed: the leftover probe sees this boot while it runs",
				whileArmed.measured && whileArmed.lines.length > 0,
				whileArmed.lines.join("\n") ||
					`${whileArmed.detail}, none matching ${SCRATCH_TAG}`,
			),
		);
	} finally {
		cdp?.close();
		await stopApp(handle);
	}

	return results;
}

// ---- main --------------------------------------------------------------------

async function main() {
	mkdirSync(HOME_DIR, { recursive: true });
	mkdirSync(CONFIG_DIR, { recursive: true });
	mkdirSync(APP_CWD, { recursive: true });
	mkdirSync(FRAMES, { recursive: true });

	// The scratch `.env` at the app's cwd: this is what keeps the run off the
	// operator's backend, because main loads `.env` from cwd with `override: true`.
	// Written per boot by `writeAppCwdEnv`, which the gate's `.env` cases vary.
	const deadApiPort = await pickFreePort();
	const apiUrl = `http://127.0.0.1:${deadApiPort}`;
	APP_API_URL = apiUrl;
	writeAppCwdEnv();

	say("local-operator-ui renderer driver");
	say(`  repo          ${ROOT}`);
	say(`  scratch       ${SCRATCH}`);
	say(`  frames        ${FRAMES}`);
	say(`  app cwd       ${APP_CWD}   (scratch: the repo's .env is not read)`);
	say(
		`  backend url   ${apiUrl}   (dead port; the run cannot reach a backend)`,
	);

	/*
	 * Which runtime these frames come from, and whether it is the one the branch
	 * pins. A frame is only reproducible on the binary that produced it: the
	 * committed pair was once captured on this machine's stale shared install
	 * (Electron 35.5.1) while the README told a reader on 44.3.0 to compare
	 * hashes against it, and a worktree here inherits that install through a
	 * `node_modules` symlink. So the version is printed AND asserted, not assumed.
	 */
	const runtime = electronRuntime();
	say(`  electron      ${runtime.installed}   (${ELECTRON_BIN})`);
	say(`  electron pin  ${runtime.pinned}   (package.json optionalDependencies)`);
	check(
		"the harness is driving the Electron this branch pins",
		runtime.installed === runtime.pinned,
		`installed ${runtime.installed} at ${ELECTRON_BIN}, pinned ${runtime.pinned}`,
	);

	const dead = await isListening(deadApiPort);
	check(
		"the scratch backend port is dead",
		dead === false,
		`127.0.0.1:${deadApiPort} listening=${dead}`,
	);
	const defaultBackend = await isListening(1111);
	note(
		"the app's default backend port (127.0.0.1:1111)",
		defaultBackend
			? "a listener is up: this run's main process points elsewhere, and the check below proves the app holds no connection to the URL the RENDERER was built with"
			: "nothing listening",
	);

	if (GATE_CHECK) {
		say(
			"\n[gate-check] four real boots: three inert (nothing set, a cwd .env asking, and an explicit off) and one armed\n",
		);
		await gateCheck();
	} else {
		const handle = await launchApp({
			armed: true,
			logName: "app-scene.log",
			tag: "scene",
		});
		app = handle;
		let cdp = null;
		try {
			await waitForDevtools(handle);
		cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
			const verbs = await waitForBridge(cdp);
			note("verbs registered by the renderer", JSON.stringify(verbs));
			check(
				"the armed launch said so on stdout",
				/\[dev-driver\] ARMED/.test(await readAppLog(handle)),
				(await readAppLog(handle))
					.split("\n")
					.filter((line) => line.includes("[dev-driver]"))
					.join(" / "),
			);
			/*
			 * Isolation, on the one path that used to escape it.
			 *
			 * The app's log directory is its real home unless the launch overrode
			 * it, so this reads the line the app itself wrote at logger init ("Log
			 * path: …") rather than trusting that the variable was passed: what
			 * matters is where the app RESOLVED it, not what this script exported. A
			 * run whose logs land in the operator's directory is not isolated, however
			 * many other paths are redirected.
			 */
			const installerLog = join(LOG_DIR, "backend-installer.log");
			const installerText = existsSync(installerLog)
				? readFileSync(installerLog, "utf8")
				: "";
			check(
				"the app's logs went to this run's scratch tree, not the operator's",
				installerText.includes(`Log path: ${LOG_DIR}`),
				installerText
					.split("\n")
					.filter((line) => line.includes("Log path:"))
					.join(" / ") || `${installerLog} is missing or names no log path`,
			);
			const hello = await verb(cdp, "hello");
			const probe = await connectionsTo(handle.pid, hello.apiBaseUrl);
			if (probe.measured) {
				check(
					`the app holds no connection to the renderer's built API URL (${hello.apiBaseUrl})`,
					probe.matches.length === 0,
					probe.matches.join("\n") || "no connection",
				);
			} else {
				note("isolation probe unavailable", probe.detail);
			}
			if (SCENE === "states") await sceneStates(cdp);
			else if (SCENE !== "none") throw new Error(`unknown scene "${SCENE}"`);
			for (const line of cdp.console.slice(-20)) say(`  [renderer] ${line}`);
		} finally {
			if (cdp) cdp.close();
		}
	}

	// One teardown for both branches, by exact pid (never a pattern: a `pkill`
	// would take the operator's own running app with it).
	if (app) {
		const handle = app;
		const log = await readAppLog(handle);
		await stopApp();
		if (failures > 0) {
			say("\n---- app log (tail) ----");
			say(log.split("\n").slice(-40).join("\n"));
		}
	}

	/*
	 * The leftover-process check, part of the evidence rather than a claim beside
	 * it. Every boot this run started has been stopped by now (the gate's four and
	 * the scene's one both come through `stopApp`), so anything still carrying
	 * this run's tag is an orphan — an app re-parented to launchd, which is what
	 * `ps` reported four of after a "successful" `--gate-check --clean` run before
	 * the teardown reached the app's own pid. It is checked in BOTH directions: the
	 * armed boot asserts the probe sees an app while it runs, and this asserts
	 * nothing survived — a probe that never matches anything would otherwise pass
	 * this forever, which is how the claim above outlived its truth for a round.
	 */
	const leftovers = thisRunsProcesses();
	if (leftovers.measured) {
		check(
			"no process from this run outlived its boot",
			leftovers.lines.length === 0,
			leftovers.lines.join("\n") || `0 processes matching ${SCRATCH_TAG}`,
		);
	} else {
		note("the leftover-process probe is unavailable", leftovers.detail);
	}

	const frames = readdirSync(FRAMES)
		.filter((f) => f.endsWith(".png"))
		.sort();
	say(`\nframes: ${frames.length === 0 ? "(none)" : frames.join(", ")}`);
	say(`frames directory: ${FRAMES}`);
	say(`app log: ${join(SCRATCH, GATE_CHECK ? "app-armed.log" : "app-scene.log")}`);

	/*
	 * Two flags, one decision, and the frames are never the casualty: `--out`
	 * writes them outside the scratch tree, so `--clean` can remove the tree
	 * without removing the evidence. `--keep` is for an agent debugging a run that
	 * wants the profile, the app log and the scratch `.env` to still be there.
	 *
	 * The removal waits for the check above: a surviving app re-creates the
	 * profile directory under this tree the moment it is deleted (measured — the
	 * four directories came back with fresh mtimes after "scratch removed" was
	 * printed), so a tree with something still running in it is kept and reported
	 * instead of deleted and quietly repopulated.
	 */
	if (CLEAN && !KEEP) {
		if (leftovers.measured && leftovers.lines.length > 0) {
			say(
				`scratch kept: ${SCRATCH} — ${leftovers.lines.length} process(es) from this run are still alive, and deleting the tree would not remove their profile`,
			);
		} else {
			rmSync(SCRATCH, { recursive: true, force: true });
			say("scratch removed (--clean)");
		}
	} else {
		say(
			`scratch kept: ${SCRATCH}${OUT_ARG ? " (the frames are also in --out)" : ""}`,
		);
	}

	say(
		`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
	);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
	say(`\n[FAIL] the run threw: ${error?.stack ?? error}`);
	const handle = app;
	if (handle) {
		const log = await readAppLog(handle);
		say("\n---- app log (tail) ----");
		say(log.split("\n").slice(-40).join("\n"));
	}
	// Every boot, not just the scene's: a throw in the middle of the gate's four
	// leaves whichever ones are still up, and the reaper is the one path that
	// knows all of them.
	await reapLiveBoots({ code: 1, why: "the run threw" });
});
