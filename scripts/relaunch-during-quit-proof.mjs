#!/usr/bin/env node
/**
 * Before/after proof for a relaunch that lands while the previous instance is
 * still shutting down (the operator's report, issue #636).
 *
 * THE DEFECT. Cmd+Q closes the window while the process keeps tearing down:
 * `before-quit` can hold the quit for the session-cookie snapshot (bounded at
 * 1500 ms), the window closes next, and `will-quit` then waits on the owned
 * backend's stop — seconds of it on this machine. The single-instance lock is
 * held for the whole of it, so a relaunch inside that window loses the lock and
 * forwards its request to the dying instance. Before this fix that instance
 * answered the request with a window of its own (an undeclared relaunch resolves
 * `focus`; the rig below declares `inactive` — see *Why B declares a mode*),
 * which appeared over a teardown that killed it again seconds later. "The
 * relaunched app opens onto the app still shutting down."
 *
 * THE FIX. `before-quit`'s first entry sets a quit-in-progress state, and both
 * answer sites consult it: the `second-instance` path refuses the request whole
 * (`window-raise.ts::reportSkippedWhileQuitting` — nothing created, nothing
 * raised, nothing parked, one `applied=skipped+quitting` line) and the macOS
 * `activate` handler refuses a Dock click the same way. The next launch — the
 * one that finds the process gone — opens normally, which the third instance
 * below measures.
 *
 * THE COMPLETION (#755). The refusal stays whole; the dying process now also
 * RECORDS what was refused and, at the quit's terminal, schedules ONE successor
 * instance (`app.relaunch`, `src/main/relaunch-pending.ts`) that boots after
 * this process exits, takes the freed lock and opens under the recorded plan.
 * This rig proves it end to end: B carries an `--inspect=<S>` port in its argv,
 * B's argv is what the record replays, so the SUCCESSOR becomes observable on
 * that same port once A is gone — the replay contract is proven by S being
 * observable at all. The rig also pins the negatives: nothing listens on that
 * port and only A is on the scratch profile while A still tears down (no
 * successor exists before the old process exits, i.e. nothing was spawned at
 * refusal time). `--no-reopen` runs the control arm: a quit with nothing
 * refused spawns nothing — no process on the scratch profile, the designated
 * port stays closed, and no `reopen=deferred` line exists — and the next launch
 * opens normally.
 *
 * WHAT THIS RIG DRIVES, so the evidence is about the shipped path and not about
 * this script:
 *   - instance A: the BUILT app, headless, on a scratch profile, with the state
 *     a real user has — it starts and owns its backend, which is what makes the
 *     teardown a window wide enough for the relaunch to land in;
 *   - A's quit: `app.quit()` evaluated in A's MAIN PROCESS over its own
 *     `--inspect` port. That is the same chain Cmd+Q takes (`before-quit`'s
 *     hold, the windows closing, `will-quit`'s owned cleanup, process exit) —
 *     this rig cannot send a real AppleEvent (it would have to address the app
 *     by name, and `Electron` on this machine is every unpackaged session's
 *     app), and the inspector is how the app's own dev harness already reaches
 *     main (`scripts/renderer-driver.mjs`);
 *   - instance B: the relaunch, anchored on the READING "A's window is gone"
 *     rather than on a sleep, sharing A's scratch profile so it loses the
 *     single-instance lock exactly as a double-click on the Dock icon would;
 *     B's argv carries an `--inspect` port so its replayed successor is
 *     observable (see THE COMPLETION);
 *   - instance S (#755): the successor A's quit terminal schedules — a NEW
 *     process that takes the freed lock after A exits, opens under the recorded
 *     (inactive) plan, and is read over the replayed inspect port;
 *   - instance C: after A is gone and S has lived and quit, the NEXT launch —
 *     the control that a refusal is a refusal and not a permanent state: C is
 *     expected to open and show its window.
 *
 * WHY B DECLARES A MODE. An undeclared relaunch is a person double-clicking the
 * app, and its plan is `focus` — `show()` + `focus()` for the window A creates.
 * Taking the operator's focus is the one thing this repository's rigs may not do
 * (AGENTS.md, *Running the app without taking the operator's focus*), so B names
 * `inactive`: the same request through the same code path, whose presentation is
 * `showInactive()` — visible, never activated. A headless B would be a different
 * request (`never` creates nothing even before the fix) and would prove nothing.
 *
 * WHAT IT CANNOT PROVE, said so the frames are not over-read: it drives the
 * quit through the inspector rather than through a real Cmd+Q keystroke, so the
 * EVIDENCE for the menu path is that the chain entered is the same one
 * (`before-quit` → window close → `will-quit` → exit, read from A's own log),
 * not that a keystroke was synthesized. And it measures one machine's teardown
 * timing: the window it needs is the owned backend's stop, which takes seconds
 * here and could be near-empty on a machine with nothing to stop.
 *
 * ISOLATION, the same discipline as `scripts/session-cookie-restart-proof.mjs`:
 * HOME, `LOCAL_OPERATOR_CONFIG_DIR`, `LOCAL_OPERATOR_LOG_DIR` and the Electron
 * `--user-data-dir` are all scratch, and so is the backend address
 * (`VITE_LOCAL_OPERATOR_API_URL` on a free port), which is what keeps the app
 * from probing, adopting or stopping the operator's own daemon. The app's
 * WORKING DIRECTORY is scratch too, and that half is QA round 1's Q1:
 * `src/main/backend/config.ts` folds a `.env` from the process's working
 * directory over the launch environment (`override: true`), so running the app
 * from a checkout whose root `.env` pins `VITE_DISABLE_BACKEND_MANAGER` or
 * `VITE_LOCAL_OPERATOR_API_URL` — the shape a normal dev checkout carries —
 * used to override the free-port assignment and turn the run into read-only
 * probes of whatever the machine has on its real port, while the failure
 * arrived as a premise check needing interpretation. The app is launched with
 * an ABSOLUTE app path (`APP_ROOT` below), so Electron still finds this tree's
 * `package.json`/`out` while `process.cwd()` inside the app stays in the run's
 * scratch tree, where no `.env` exists. The app's remaining
 * working-directory reads are its first-run install's `resources/` lookups
 * (never reached here: the premise is a machine whose backend is already
 * present, the state a real user has) and the requester `cwd` a second launch
 * reports, which is diagnostic. The notification
 * and telemetry kill switches are applied through their own helpers, every
 * `CMUX_*`/`LOP_*` variable is stripped, and every child is killed by EXACT pid
 * (SIGTERM, then SIGKILL on that same pid; the process group as the fallback) so
 * no app survives the run. Nothing is shown, focused or screenshotted: the
 * frame this rig commits, when there is one, is `capturePage()` from the app
 * itself.
 *
 * THE INSPECTOR SOCKET IS CLOSED AS SOON AS THE WINDOW IS GONE, and that is not
 * tidiness: an attached inspector socket has been observed to keep the quitting
 * app from exiting (one 180 s non-exit while attached, against clean exits of
 * 5-19 s with the socket closed on this machine). The re-attach below opens a NEW
 * socket, reads the window state, and closes again.
 *
 * NOTHING ELSE IS OPENED AGAINST THE APP on either side of the quit except that
 * socket: the rig's window reading is a CDP evaluation, and everything else it
 * reports (the raise line, the teardown, the exit) comes from the app's own log
 * files and the process table.
 *
 * Usage:
 *   node scripts/relaunch-during-quit-proof.mjs [--window-wait <ms>]
 *     [--keep] [--record <path>] [--label <name>] [--no-reopen]
 *
 * `--no-reopen` runs the control arm instead of the main one: A quits with no
 * relaunch during its teardown, and the rig asserts nothing is ever spawned
 * (the negative that proves a successor only follows a refused reopen).
 *
 * `--record` writes the transcript to a file as well as stdout (the committed
 * artifacts under docs/evidence/relaunch-during-quit are two such files, one
 * per tree). The scratch tree is removed on a clean run unless `--keep` — it
 * survives an interrupt, and its path is printed, so the log can be read.
 */

import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

// The real Electron binary, not the `node_modules/.bin` shim: the shim is a
// shell -> node -> Electron chain, so a pid held from it is the shim's.
const electronPath = createRequire(join(process.cwd(), "package.json"))(
	"electron",
);

const KEEP = process.argv.includes("--keep");
/*
 * #755's second arm: the no-reopen control. A quit with nothing refused must
 * spawn nothing at all — that is the negative that gives the main arm's
 * successor reading its meaning (see the header).
 */
const NO_REOPEN = process.argv.includes("--no-reopen");
const flagValue = (flag, fallback) => {
	const at = process.argv.indexOf(flag);
	return at === -1 ? fallback : process.argv[at + 1];
};
const RECORD = flagValue("--record", null);
const LABEL = flagValue("--label", "run");

const SCRATCH = join(tmpdir(), `lo-relaunch-during-quit-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const LOG_DIR = join(SCRATCH, "logs");
const USER_DATA = join(SCRATCH, "userdata");
/*
 * The app is LOADED from this tree (the absolute path Electron gets, so its
 * `package.json`/`out` resolve no matter where the process runs) and RUNS with
 * its working directory in the run's own scratch tree — which is what makes a
 * checkout's root `.env` unreachable to the app's dotenv fold. Both halves are
 * the QA-round-1 (Q1) fix; see ISOLATION in the header, and
 * `scripts/relaunch-during-quit-proof.test.mjs`, which pins them.
 */
const APP_ROOT = process.cwd();
const APP_CWD = join(SCRATCH, "app-cwd");

const transcript = [];
let failures = 0;

const say = (line) => {
	console.log(line);
	transcript.push(line);
};
const check = (label, ok, detail) => {
	failures += ok ? 0 : 1;
	say(
		`[${ok ? "PASS" : "FAIL"}] ${label}${detail === undefined ? "" : `\n        ${detail}`}`,
	);
	return ok;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});
}

/**
 * A CDP client over a Node inspector socket — the slice of
 * `scripts/renderer-driver.mjs`'s client this rig needs, copied for the same
 * reason that file copies `browser-host-proof.mjs`'s plumbing: these are scripts,
 * not modules.
 */
class CdpClient {
	constructor(socket) {
		this.socket = socket;
		this.nextId = 1;
		this.pending = new Map();
		this.closed = false;
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id && this.pending.has(message.id)) {
				this.pending.get(message.id)(message);
				this.pending.delete(message.id);
			}
		});
		socket.addEventListener("close", () => {
			this.closed = true;
		});
	}
	send(method, params = {}) {
		if (this.closed) return Promise.reject(new Error("socket closed"));
		const id = this.nextId++;
		this.socket.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => {
			this.pending.set(id, resolve);
			setTimeout(() => {
				if (this.pending.delete(id))
					reject(new Error(`CDP ${method} timed out`));
			}, 8_000);
		});
	}
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
	static async attach(port, timeoutMs = 60_000) {
		const started = Date.now();
		for (;;) {
			let list = [];
			try {
				list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			} catch {
				list = [];
			}
			const target = list.find((entry) => entry.type === "node");
			if (target) {
				const socket = new WebSocket(target.webSocketDebuggerUrl);
				await new Promise((resolveOpen, rejectOpen) => {
					socket.addEventListener("open", resolveOpen, { once: true });
					socket.addEventListener("error", rejectOpen, { once: true });
				});
				return new CdpClient(socket);
			}
			if (Date.now() - started > timeoutMs) {
				throw new Error(`no main-process inspector target on port ${port}`);
			}
			await sleep(200);
		}
	}
	close() {
		try {
			this.socket.close();
		} catch {
			// Already closed.
		}
	}
}

const pidAlive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** Every app this rig launched, so a reaper can stop all of them by pid. */
const launched = [];

function reapByPid(child, signal) {
	// The GROUP, then the pid: a wedged tree is hit whole, and every kill is by a
	// pid this rig created. Used for the last-resort kills only — a GRACEFUL stop
	// signals the app's own process instead, because a group signal also kills
	// Chromium's helpers and makes the teardown it is waiting on fail (measured in
	// `scripts/session-cookie-restart-proof.mjs`, whose header carries the pair).
	try {
		process.kill(-child.pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			// Already gone.
		}
	}
}

async function stopApp(child, { sigkill = false } = {}) {
	if (!pidAlive(child.pid)) return;
	try {
		child.kill(sigkill ? "SIGKILL" : "SIGTERM");
	} catch {
		// Already gone.
	}
	const deadline = Date.now() + 10_000;
	while (pidAlive(child.pid) && Date.now() < deadline) await sleep(100);
	if (pidAlive(child.pid)) reapByPid(child, "SIGKILL");
}

const reapAll = () => {
	for (const child of launched) {
		// Only a pid this rig created, and only while it is still alive: pid reuse
		// on a busy machine is a real thing, and a group SIGKILL aimed at a reused
		// pid is a kill of somebody else's tree.
		if (!pidAlive(child.pid)) continue;
		try {
			reapByPid(child, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
};
process.on("SIGINT", () => {
	reapAll();
	process.exit(130);
});
process.on("SIGTERM", () => {
	reapAll();
	process.exit(143);
});

/** The backend address A serves on; B and C reuse it. */
let backendPort = null;

/*
 * The lines this rig greps for, at module scope so the literals are compiled
 * once (the lint rule, and one reading of what this file looks for).
 */
const DAEMON_REGISTERED_LINE = /Registered this app's own daemon: (\S+)/;
const RAISE_SECOND_INSTANCE_LINE = /\[window-raise\] trigger=second-instance/;
const APPLIED_SKIPPED_WHILE_QUITTING = /applied=skipped\+quitting/;
const SECOND_INSTANCE_LOSER_LINE =
	/\[second-instance\] this launch did not start a window of its own/;
/*
 * #755's readings. The completion token is the refusal line's half of the
 * contract (`reopen=deferred` says a successor will complete this refusal), the
 * schedule line is the dying process saying it arranged one, and the successor
 * names itself on the replay port — with the initial-present raise and the
 * launcher policy arriving in the same log. Kept as literals here so the rig's
 * vocabulary matches the product's and a wording change is one diff.
 */
const REOPEN_DEFERRED = /reopen=deferred/;
const SUCCESSOR_SCHEDULED_LINE = /\[relaunch\] successor scheduled/;
const RAISE_INITIAL_PRESENT_INACTIVE =
	/\[window-raise\] trigger=initial-present mode=inactive/;
const LAUNCHER_INACTIVE_LINE =
	/\[window-mode\] window mode inactive is not launcher-bound/;
/* Top-level so the scan below is not compiling them per row (the lint rule). */
const PS_ROW = /^(\d+)\s+(\d+)\s+(.*)$/;
const DAEMON_REGISTERED_ALL = /Registered this app's own daemon/g;

/** The environment every launch below is handed. */
function makeEnv() {
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		LOCAL_OPERATOR_UI_TELEMETRY: "off",
		// A free address of this run's own, so A SPAWNS AND OWNS its backend — the
		// stop of that owned child is the teardown window this bug lives in. Left
		// unset, the app would probe the operator's own 1111/8080 first and the
		// run's shape would depend on what is listening on the machine. It cannot
		// be overridden by a checkout `.env`: the app's working directory is in
		// scratch (see ISOLATION) — before that, QA round 1's Q1 was this override.
		...(backendPort === null
			? {}
			: { VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${backendPort}` }),
	});
	withTelemetryOff(env);
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	return env;
}

function launchApp({ mode, inspectPort, label }) {
	const stdoutPath = join(SCRATCH, `${label}.stdout.log`);
	const stderrPath = join(SCRATCH, `${label}.stderr.log`);
	const child = spawn(
		electronPath,
		[
			/*
			 * THE APP PATH IS ABSOLUTE and the working directory below is the run's
			 * scratch tree — both halves of the QA-round-1 (Q1) isolation fix. A
			 * relative `.` resolves against `cwd`, and `cwd` must NOT be the
			 * checkout: the app folds a `.env` from its working directory over the
			 * launch environment (`override: true`), so a dev checkout's own file
			 * would beat every assumption this rig makes — the free port it
			 * assigned, the spawn it waits for. Electron reads its app root from
			 * THIS argument instead, so the tree is still found.
			 */
			APP_ROOT,
			`--user-data-dir=${USER_DATA}`,
			`--window-mode=${mode}`,
			// The mode is named AND the switch rides along: the launch is a run by
			// shape anyway (no terminal), and naming it keeps the startup line honest
			// whatever that assumption would have said.
			...(inspectPort === null ? [] : [`--inspect=${inspectPort}`]),
		],
		{
			env: makeEnv(),
			cwd: APP_CWD,
			stdio: ["ignore", openSync(stdoutPath, "a"), openSync(stderrPath, "a")],
			detached: true,
		},
	);
	const state = { child, label, stdoutPath, exitedAt: null, exitCode: null };
	child.on("exit", (code, signal) => {
		state.exitedAt = Date.now();
		state.exitCode = code;
		state.exitSignal = signal;
	});
	launched.push(child);
	return state;
}

const stdoutOf = (state) =>
	existsSync(state.stdoutPath) ? readFileSync(state.stdoutPath, "utf8") : "";

/** The app's own log files, newest last, as one string. */
const appLog = () =>
	(existsSync(LOG_DIR)
		? readdirSync(LOG_DIR).filter((name) => name.endsWith(".log"))
		: []
	)
		.map((name) => readFileSync(join(LOG_DIR, name), "utf8"))
		.join("\n");

/**
 * The OUTSIDE view of "which app instances are on this run's scratch profile":
 * a ps scan for the profile path, Chromium's children excluded (`--type=` marks
 * a helper; the main process carries none), so one entry is one app INSTANCE.
 * It is what pins "no successor exists before A exits" and the control arm's
 * "nothing was ever spawned" — a spawn that the product was not supposed to
 * make would appear here whatever port it did or did not open.
 */
function scratchProfileProcesses() {
	const ps = spawnSync("ps", ["-axo", "pid,ppid,command"], {
		encoding: "utf8",
	});
	return (ps.stdout ?? "")
		.split("\n")
		.filter((line) => line.includes(`--user-data-dir=${USER_DATA}`))
		.filter((line) => !line.includes("--type="))
		.map((line) => {
			const match = line.trim().match(PS_ROW);
			return match === null
				? { pid: null, command: line.trim() }
				: { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
		});
}

/**
 * Whether something is LISTENING on a port — a connect probe, never an attach:
 * the socket half of the replay contract. B carried it, the successor replays
 * it, and between B's exit and A's exit nothing may be on it (no successor
 * exists before the old process is gone).
 */
function listeningOn(port) {
	return new Promise((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		const done = (value) => {
			socket.destroy();
			resolve(value);
		};
		socket.setTimeout(1500);
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
		socket.once("timeout", () => done(false));
	});
}

async function waitFor(fn, label, timeoutMs) {
	const started = Date.now();
	for (;;) {
		// `Promise.resolve` rather than `fn().catch(...)`: half this rig's
		// predicates are SYNC (a pid liveness check, a `test()` over the logs), and
		// `.catch` on a boolean throws instantly — which the call site's own
		// `.catch(() => {})` then swallows, so a wait meant to run for seconds
		// returned at once and the line after it killed the process it was waiting
		// for. Measured on this rig: every "A exits (SIGKILL)" reading was this
		// helper, not the app.
		const value = await Promise.resolve(fn()).catch(() => null);
		if (value) return value;
		if (Date.now() - started > timeoutMs) {
			throw new Error(`timed out waiting for ${label}`);
		}
		await sleep(200);
	}
}

const WINDOW_READING =
	"(() => { const { BrowserWindow } = process.mainModule.require('electron'); return BrowserWindow.getAllWindows().map((w) => ({ id: w.id, visible: w.isVisible(), destroyed: w.isDestroyed() })); })()";

/*
 * THE NEXT-LAUNCH CONTROL, shared by both arms (#755): once everything above
 * has settled — A gone, and in the main arm S lived and quit too — a fresh
 * launch opens and shows its window. That is the "a refusal is a refusal, not a
 * permanent state; later launches are ordinary" reading, unchanged from the
 * base; what moved is only WHEN it runs (after the whole hand-off completed).
 */
async function runNextLaunchControl(windowWaitMs) {
	const inspectC = await freePort();
	const c = launchApp({ mode: "inactive", inspectPort: inspectC, label: "c" });
	say(
		`C: ${c.child.pid} (inactive; the next launch after everything above settled)`,
	);
	let cWindow = null;
	try {
		const mainC = await CdpClient.attach(inspectC);
		cWindow = await waitFor(
			async () => {
				const list = await mainC.evaluate(WINDOW_READING).catch(() => null);
				return Array.isArray(list) && list.length === 1 && list[0].visible
					? list
					: null;
			},
			"C's window",
			windowWaitMs,
		);
		check(
			"the next relaunch opens and shows its window",
			cWindow !== null,
			JSON.stringify(cWindow),
		);
		await mainC.evaluate(
			"(() => { process.mainModule.require('electron').app.quit(); return 'quit requested'; })()",
		);
		await waitFor(
			async () => {
				const list = await mainC.evaluate(WINDOW_READING).catch(() => null);
				return Array.isArray(list) && list.length === 0 ? true : null;
			},
			"C's window closing",
			20_000,
		).catch(() => {});
		mainC.close();
	} catch (error) {
		check("the next relaunch opens and shows its window", false, String(error));
	}
	if (c.exitedAt === null) {
		await waitFor(
			() => c.exitedAt !== null || !pidAlive(c.child.pid),
			"C to exit",
			60_000,
		).catch(() => {});
	}
	if (c.exitedAt === null) await stopApp(c.child, { sigkill: true });
}

/** Let the app quit itself through the same chain Cmd+Q takes, then watch. */
async function main() {
	/*
	 * THE REQUIREMENT, CHECKED BY NAME (QA round 1, Q1's remedy): this rig boots
	 * the BUILT app — `out/main/index.js` is what Electron loads — and a missing
	 * build used to surface as whatever failed first, minutes in. It is a
	 * preflight so the message is the requirement.
	 */
	if (!existsSync(join(APP_ROOT, "out", "main", "index.js"))) {
		say(
			`FAILED: ${APP_ROOT} is not a BUILT tree - out/main/index.js is missing. Run \`pnpm build\` here first; this rig boots the built app, not the source.`,
		);
		process.exitCode = 1;
		return;
	}
	rmSync(SCRATCH, { recursive: true, force: true });
	for (const dir of [HOME_DIR, CONFIG_DIR, LOG_DIR, USER_DATA, APP_CWD]) {
		mkdirSync(dir, { recursive: true });
	}
	say(`scratch: ${SCRATCH}`);

	const windowWaitMs = Number(flagValue("--window-wait", "60000"));

	/* ---- A: the app, with its backend, then the quit --------------------- */

	const inspectA = await freePort();
	backendPort = await freePort();
	const a = launchApp({ mode: "headless", inspectPort: inspectA, label: "a" });
	say(`A: ${a.child.pid} (headless, inspector on ${inspectA})`);

	// The window is created before anything else runs in `whenReady`, but the
	// app's startup path also proves the OTHER premise first: an owned backend
	// exists, so the teardown will have real work. Wait for both.
	const mainA = await CdpClient.attach(inspectA);
	await waitFor(
		() =>
			mainA
				.evaluate("typeof process.mainModule !== 'undefined'")
				.catch(() => false),
		"A's main module",
		30_000,
	);
	const windowsUp = await waitFor(
		async () => {
			const list = await mainA.evaluate(WINDOW_READING).catch(() => null);
			return Array.isArray(list) && list.length === 1 ? list : null;
		},
		"A's window",
		windowWaitMs,
	);
	say(`A windows before the quit: ${JSON.stringify(windowsUp)}`);

	// The owned backend is what makes the teardown window wide: its stop is the
	// seconds this bug needs. Waited for, not slept past — and a timeout here is a
	// FAIL rather than an abort, because the check below is also the statement of
	// the premise.
	let ownedDaemon = null;
	await waitFor(
		() => {
			const match = stdoutOf(a).match(DAEMON_REGISTERED_LINE);
			if (match) ownedDaemon = match[1];
			return match;
		},
		"A's owned backend",
		60_000,
	).catch(() => {});
	check(
		"A owns a backend of its own, so its teardown has real work to do",
		ownedDaemon !== null,
		ownedDaemon ?? "(no daemon line in A's log)",
	);
	// And let it settle warm, the state a user's app is in when they hit Cmd+Q.
	await sleep(2000);

	const quitAt = Date.now();
	await mainA.evaluate(
		"(() => { process.mainModule.require('electron').app.quit(); return 'quit requested'; })()",
	);
	// Anchored on the reading, never a sleep: the relaunch must land while A
	// still holds the lock, and the window closing is the first moment of that.
	const windowsGoneAt = await waitFor(
		async () => {
			const list = await mainA.evaluate(WINDOW_READING).catch(() => null);
			if (Array.isArray(list) && list.length === 0) return Date.now();
			if (mainA.closed) return Date.now();
			return null;
		},
		"A's window closing",
		20_000,
	);
	say(`A's window is gone +${windowsGoneAt - quitAt}ms after app.quit()`);
	mainA.close();
	say(
		"inspector socket closed (no wire is held into a process that is tearing itself down)",
	);

	/*
	 * The main arm's relaunch slot and the port its successor will answer on are
	 * reserved here, outside the arm branch, because the successor section below
	 * reads them. The control arm never launches B; for it the SAME port is the
	 * designated port that must stay silent (nothing was ever told about it).
	 */
	let b = null;
	const inspectS = await freePort();

	if (NO_REOPEN) {
		/*
		 * The control arm (#755's `--no-reopen`) has no B: nothing asks for the app
		 * during the teardown, so there is nothing to hand off and nothing to
		 * observe here. The shared A-exit section below and the quiet-window
		 * readings after it are this arm's own evidence.
		 */
	} else {
		/* ---- B: the immediate relaunch, while A is still tearing down ------ */

		/*
		 * B's argv carries `--inspect=<inspectS>` so the SUCCESSOR is observable: the
		 * record replays B's command line, so whatever port B declares is the port
		 * the successor opens — the replay contract is proven by S answering there
		 * at all (#755). The same port is the negative's probe: after B exits and
		 * while A still tears down, nothing may be listening on it.
		 */
		const b2 = launchApp({
			mode: "inactive",
			inspectPort: inspectS,
			label: "b",
		});
		b = b2;
		say(
			`B: ${b2.child.pid} (inactive; its argv carries --inspect=${inspectS}, which its successor replays)`,
		);
		// Long enough for B to boot, lose the lock and be answered, still well inside
		// A's teardown; the alive readings below are the authoritative anchors.
		await sleep(2600);

		const aAliveAtProbe = pidAlive(a.child.pid);
		check(
			"A still holds the single-instance lock while it tears down (the premise)",
			aAliveAtProbe,
			aAliveAtProbe
				? `A alive +${Date.now() - quitAt}ms after app.quit(), its window already closed`
				: "A had already exited, so this run proves nothing about the hand-off",
		);

		let windowsAfter = null;
		let doomedFrame = null;
		if (aAliveAtProbe) {
			try {
				const prober = await CdpClient.attach(inspectA, 5_000);
				windowsAfter = await prober.evaluate(WINDOW_READING);
				if (Array.isArray(windowsAfter) && windowsAfter.length > 0) {
					// The defect's own evidence: the window A was killed for, captured by
					// the app itself (never `screencapture`). Best effort — the window is
					// mid-load and half the time the page is not paintable yet.
					doomedFrame = await prober
						.evaluate(
							"(() => { const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.getAllWindows()[0]; if (!w) return null; return w.webContents.capturePage().then((img) => img.toPNG().toString('base64'), (error) => 'capture failed: ' + String(error)); })()",
						)
						.catch(() => null);
					if (
						typeof doomedFrame === "string" &&
						!doomedFrame.startsWith("capture")
					) {
						writeFileSync(
							join(SCRATCH, "doomed-window.png"),
							Buffer.from(doomedFrame, "base64"),
						);
					}
				}
				prober.close();
			} catch (error) {
				say(`re-attach failed: ${String(error)}`);
			}
		}

		check(
			"A answered the relaunch without creating or raising a window",
			Array.isArray(windowsAfter) && windowsAfter.length === 0,
			windowsAfter === null
				? "no reading could be taken"
				: `A's windows ${Date.now() - quitAt}ms after app.quit(): ${JSON.stringify(windowsAfter)}`,
		);
		if (Array.isArray(windowsAfter) && windowsAfter.length > 0) {
			say(
				"        ^ the defect: that window is A's answer to B's request, and it dies when A exits",
			);
			if (
				doomedFrame !== null ||
				existsSync(join(SCRATCH, "doomed-window.png"))
			) {
				say(
					`        captured by the app itself: ${join(SCRATCH, "doomed-window.png")}`,
				);
			}
		}

		/*
		 * THE NEGATIVE SIDE (#755). B is the last process that may exist before A
		 * exits: wait for it to be gone, then take the outside readings that pin "no
		 * successor exists yet" — and so "nothing was spawned at refusal time" —
		 * while A is still alive. The schedule line is read the same moment: it is
		 * written at the quit's TERMINAL (`will-quit`'s continuation or its catch),
		 * so while A still tears down it cannot legitimately be on the record yet.
		 */
		if (b.exitedAt === null) {
			await waitFor(
				() => b.exitedAt !== null || !pidAlive(b.child.pid),
				"B to exit",
				30_000,
			).catch(() => {});
		}
		const aAliveAtNoSProbe = pidAlive(a.child.pid);
		const noSuccessorReadings = {
			aAlive: aAliveAtNoSProbe,
			portListening: await listeningOn(inspectS),
			scratchProcesses: scratchProfileProcesses(),
		};
		check(
			"no successor exists before A exits (its replay port is closed, and only A is on the scratch profile)",
			noSuccessorReadings.aAlive &&
				noSuccessorReadings.portListening === false &&
				noSuccessorReadings.scratchProcesses.length === 1 &&
				noSuccessorReadings.scratchProcesses[0].pid === a.child.pid,
			`A alive: ${noSuccessorReadings.aAlive}; port ${inspectS} listening: ${noSuccessorReadings.portListening}; scratch-profile processes: ${JSON.stringify(noSuccessorReadings.scratchProcesses)}`,
		);
		check(
			"nothing is scheduled at refusal time (no [relaunch] line while A tears down)",
			!SUCCESSOR_SCHEDULED_LINE.test(appLog()),
			SUCCESSOR_SCHEDULED_LINE.test(appLog())
				? "a [relaunch] successor scheduled line exists while A is still alive — the schedule moved off the terminal"
				: "no [relaunch] line yet; the terminal has not run",
		);

		// A's own record of what it did with B's request.
		await waitFor(
			() => RAISE_SECOND_INSTANCE_LINE.test(appLog()),
			"a window-raise line for B's request",
			10_000,
		).catch(() => {});
		const raiseLine =
			appLog()
				.split("\n")
				.filter((line) => line.includes("trigger=second-instance"))
				.slice(-1)[0] ?? "(none)";
		check(
			"the refusal is on the record (applied=skipped+quitting)",
			APPLIED_SKIPPED_WHILE_QUITTING.test(raiseLine),
			raiseLine,
		);
		check(
			"the refusal carries the completion token (reopen=deferred — one successor will complete it)",
			REOPEN_DEFERRED.test(raiseLine),
			raiseLine,
		);

		check(
			"B never started a window of its own",
			SECOND_INSTANCE_LOSER_LINE.test(stdoutOf(b)),
			stdoutOf(b)
				.split("\n")
				.filter((line) => line.includes("[second-instance]"))
				.join("\n") || "(no second-instance line on B's stdout)",
		);
	}

	// A must leave, and the timing is the reading that shows the window the
	// relaunch landed in.
	await waitFor(
		() => a.exitedAt !== null || !pidAlive(a.child.pid),
		"A to exit",
		60_000,
	).catch(() => {});
	if (a.exitedAt === null && pidAlive(a.child.pid)) {
		await stopApp(a.child, { sigkill: true });
	}
	// The exit EVENT can land a tick after the pid disappears; give it that tick so
	// the check below reads a code rather than a race.
	if (a.exitedAt === null) await sleep(500);
	const teardownMs = a.exitedAt === null ? null : a.exitedAt - quitAt;
	check(
		"A exits cleanly, well inside this rig's bound",
		a.exitedAt !== null && a.exitCode === 0 && teardownMs < 60_000,
		`exit ${a.exitCode}${a.exitSignal ? ` (${a.exitSignal})` : ""} ${teardownMs === null ? "never" : `${teardownMs}ms`} after app.quit()`,
	);
	check(
		"the teardown window was real (A outlived its window by more than a second)",
		teardownMs !== null && teardownMs > 1_000,
		teardownMs === null
			? "A did not exit inside the bound"
			: `window gone +${windowsGoneAt - quitAt}ms, process gone +${teardownMs}ms`,
	);

	/* ---- the completion: S (main arm), or the quiet window (control arm) -- */

	if (NO_REOPEN) {
		/*
		 * ---- the no-reopen control (#755's `--no-reopen` arm) ---------------
		 *
		 * The same quit, with nothing refused: no successor may be spawned at all.
		 * The readings are the negative of the main arm's — any process wrongly
		 * spawned would show on the scratch profile, and anything it replayed would
		 * have to open a listener; the designated port is a fresh one nothing was
		 * ever told about. Both are sampled across the grace window rather than at
		 * one instant, so a late appearance cannot slip past a single glance.
		 */
		/*
		 * The designated port is `inspectS` — the very port B would have carried and
		 * its successor would have opened. In this arm nothing was ever told about
		 * it, so it must stay silent; see the reservation above the arm branch.
		 */
		const designatedPort = inspectS;
		say(
			`no-reopen control: A quit with nothing to complete; port ${designatedPort} and the scratch profile must stay quiet`,
		);
		let quietViolation = null;
		const quietDeadline = Date.now() + 5_000;
		while (Date.now() < quietDeadline && quietViolation === null) {
			const processes = scratchProfileProcesses();
			if (processes.length > 0) {
				quietViolation = `a process appeared on the scratch profile: ${JSON.stringify(processes)}`;
			} else if (await listeningOn(designatedPort)) {
				quietViolation = `something is listening on ${designatedPort}`;
			} else {
				await sleep(250);
			}
		}
		check(
			"no successor appears when no reopen was refused (scratch profile quiet, designated port closed for 5s)",
			quietViolation === null,
			quietViolation ?? "quiet for 5000ms",
		);
		check(
			"nothing was even scheduled (no completion token, no [relaunch] line)",
			!REOPEN_DEFERRED.test(appLog()) &&
				!SUCCESSOR_SCHEDULED_LINE.test(appLog()),
			`reopen=deferred: ${REOPEN_DEFERRED.test(appLog())}; [relaunch] line: ${SUCCESSOR_SCHEDULED_LINE.test(appLog())}`,
		);
	} else {
		/*
		 * ---- S: the successor A's quit terminal spawned (#755) --------------
		 *
		 * A's terminal scheduled ONE successor via `app.relaunch`; its argv replays
		 * B's command line, so it answers on B's inspect port. S starts after A is
		 * fully gone (the relaunch contract, measured by the #755 spike), takes the
		 * freed single-instance lock and opens under the recorded (inactive) plan.
		 * A successor that never started leaves the attach to time out — the
		 * check's detail will say so.
		 */
		let mainS = null;
		try {
			mainS = await CdpClient.attach(inspectS, 30_000);
		} catch (error) {
			say(`successor attach failed: ${String(error)}`);
		}
		check(
			"the successor starts after A exits, on the replayed inspect port",
			mainS !== null,
			mainS === null
				? `nothing answered on 127.0.0.1:${inspectS} within 30s of A's exit — no successor was spawned`
				: `observed on ${inspectS}`,
		);
		let sPid = null;
		if (mainS !== null) {
			sPid = await mainS.evaluate("process.pid").catch(() => null);
			const sArgv = await mainS.evaluate("process.argv").catch(() => null);
			check(
				"the successor is a fresh process (a new pid, not A's or B's)",
				typeof sPid === "number" &&
					sPid !== a.child.pid &&
					sPid !== (b === null ? null : b.child.pid),
				`S pid=${sPid}; A pid=${a.child.pid}; B pid=${b === null ? "?" : b.child.pid}`,
			);
			check(
				"the successor replays B's command line under the recorded plan",
				Array.isArray(sArgv) &&
					sArgv.includes(`--inspect=${inspectS}`) &&
					sArgv.includes("--window-mode=inactive") &&
					sArgv.includes(`--user-data-dir=${USER_DATA}`),
				JSON.stringify(sArgv),
			);
			const sLock = await mainS
				.evaluate(
					"(() => { const { app } = process.mainModule.require('electron'); return app.hasSingleInstanceLock(); })()",
				)
				.catch(() => null);
			check(
				"the successor took the freed single-instance lock (a second spawn would have lost it)",
				sLock === true,
				`hasSingleInstanceLock() = ${sLock}`,
			);
			const sWindow = await waitFor(
				async () => {
					const list = await mainS.evaluate(WINDOW_READING).catch(() => null);
					return Array.isArray(list) && list.length === 1 && list[0].visible
						? list
						: null;
				},
				"S's window",
				windowWaitMs,
			);
			check(
				"the successor opens exactly one visible window under the recorded plan",
				sWindow !== null,
				JSON.stringify(sWindow),
			);
			// The outside view agrees: exactly the successor is on the scratch
			// profile now.
			const sScratch = scratchProfileProcesses();
			check(
				"exactly one app instance is on the scratch profile (the successor)",
				sScratch.length === 1 && sScratch[0].pid === sPid,
				JSON.stringify(sScratch),
			);
			// And the app's own log holds S's lines — a second daemon registration,
			// its initial-present raise, its launcher policy — appended after A
			// exited. A writes no raise (headless raises nothing), B never got that
			// far, and C has not launched: what appears here is the successor's.
			const daemonRegistrationCount = () =>
				(appLog().match(DAEMON_REGISTERED_ALL) ?? []).length;
			await waitFor(
				() => daemonRegistrationCount() >= 2,
				"S's daemon registration",
				60_000,
			).catch(() => {});
			check(
				"the successor's own log lines are on the record (daemon, raise, launcher policy)",
				daemonRegistrationCount() >= 2 &&
					RAISE_INITIAL_PRESENT_INACTIVE.test(appLog()) &&
					LAUNCHER_INACTIVE_LINE.test(appLog()),
				`daemon registrations: ${daemonRegistrationCount()}; initial-present raise: ${RAISE_INITIAL_PRESENT_INACTIVE.test(appLog())}; launcher policy: ${LAUNCHER_INACTIVE_LINE.test(appLog())}`,
			);
			// Second reading of S's window list: it must STAY at one — a second
			// successor would have lost the lock and exited, and nothing else may
			// join it (exactly-once).
			const sWindowAgain = await mainS
				.evaluate(WINDOW_READING)
				.catch(() => null);
			check(
				"the successor's window list stays length 1 (exactly one successor)",
				Array.isArray(sWindowAgain) && sWindowAgain.length === 1,
				JSON.stringify(sWindowAgain),
			);
			// S quits before C: its own quit has no recorded reopen, so it must
			// spawn nothing, and C must find the lock free.
			await mainS
				.evaluate(
					"(() => { process.mainModule.require('electron').app.quit(); return 'quit requested'; })()",
				)
				.catch(() => {});
			await waitFor(
				async () => {
					const list = await mainS.evaluate(WINDOW_READING).catch(() => null);
					return Array.isArray(list) && list.length === 0 ? true : null;
				},
				"S's window closing",
				20_000,
			).catch(() => {});
			mainS.close();
		}
		if (sPid !== null) {
			await waitFor(() => !pidAlive(sPid), "S to exit", 60_000).catch(() => {});
			if (pidAlive(sPid)) {
				/*
				 * Exact-pid reap of a process this run caused to exist (its own launcher,
				 * A, is gone). Only the pid S proved it owns is touched.
				 */
				try {
					process.kill(sPid, "SIGKILL");
				} catch {}
				await waitFor(() => !pidAlive(sPid), "S to reap", 10_000).catch(
					() => {},
				);
			}
			const ghosts = scratchProfileProcesses();
			check(
				"S's own quit spawned nothing (a quit with no recorded reopen completes no successor)",
				ghosts.length === 0,
				JSON.stringify(ghosts),
			);
		}
	}

	await runNextLaunchControl(windowWaitMs);

	/* ---- verdict, reaping, artifacts -------------------------------------- */

	say("");
	say(
		`${failures === 0 ? "OK" : "FAILED"}: ${failures} failing check(s) of this run.`,
	);
	if (existsSync(join(SCRATCH, "doomed-window.png"))) {
		say(`artifact: ${join(SCRATCH, "doomed-window.png")}`);
	}
	if (RECORD !== null) {
		writeFileSync(RECORD, `${transcript.join("\n")}\n`);
		say(`transcript: ${RECORD}`);
	}
	reapAll();
	if (!KEEP) rmSync(SCRATCH, { recursive: true, force: true });
	say(`scratch: ${SCRATCH} (${KEEP ? "kept" : "removed"}; label ${LABEL})`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch(async (error) => {
	say(`ERROR ${error?.stack ?? error}`);
	for (const child of launched) await stopApp(child, { sigkill: true });
	process.exitCode = 1;
});
