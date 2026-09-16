#!/usr/bin/env node
/**
 * Drive the app's own renderer, headless, and photograph what it paints.
 *
 *     node scripts/renderer-driver.mjs --scene states --out /tmp/frames
 *     node scripts/renderer-driver.mjs --scene new-chat --out /tmp/frames
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
 *   --scene <states|new-chat|palette|browser-pane|none>  which built-in scene to run (default: states)
 *   --backend <url>        a live, ISOLATED backend this run owns: the app's own
 *                          transport is pointed at it, so a surface gated on a
 *                          capability can be driven at all. The renderer must have
 *                          been BUILT against the same URL
 *                          (VITE_LOCAL_OPERATOR_API_URL) and the bearer read from
 *                          LOCAL_OPERATOR_DESKTOP_TOKEN; the run asserts both
 *   --backend-records <dir> the serve record that backend wrote for itself, which
 *                          `discovery.ts` needs before it admits the daemon
 *   --seed-onboarding-complete  write the scratch profile's onboarding flags, so a
 *                          fresh profile in front of a fresh backend is not a
 *                          first-run user whose six-step wizard is a modal over
 *                          the window
 *   --out <dir>            where frames go; copied out of the scratch tree when given
 *   --gate-check           measure the fail-closed gate on four real boots
 *   --window-size <WxH>    the window to request (default 1380x900)
 *   --keep                 keep the scratch directory even with --clean
 *   --clean                remove the scratch directory at the end; frames given
 *                          with --out live outside it and survive
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	copyFileSync,
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
import { withNotificationsOff } from "./notifications-off.mjs";

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
			`cannot resolve the Electron runtime from ${ROOT}: ${error?.message ?? error}\nInstall this branch's own dependencies first: pnpm install --frozen-lockfile`,
		);
	}
	if (typeof binary !== "string" || !existsSync(binary)) {
		throw new Error(
			`the Electron runtime is not on disk at ${String(binary)}\npnpm install --frozen-lockfile (or \`npx install-electron --no\`) fetches it.`,
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
/**
 * A live, ISOLATED backend this run owns, if it was given one.
 *
 * Absent is the default and the harness's historical shape: the app is pointed
 * at a port this script picked and verified dead, so a scene captures an app with
 * no reachable backend and every frame is publishable by construction.
 *
 * Set, the app's OWN transport is pointed at that backend (`writeAppCwdEnv`) and
 * two things become checkable that the dead-port shape can only assert by proxy:
 * that the app really reaches a backend at all, and that it reaches ONLY this
 * one. It exists for changes whose subject IS the backend's answer — a surface
 * gated on a capability cannot be driven at all while the capability is
 * unreachable, and "the gate holds with no backend" and "the surface works with
 * one" are two different claims that need two different runs.
 *
 * THE RENDERER MUST HAVE BEEN BUILT AGAINST THIS URL, which the run asserts
 * rather than trusts: the renderer's own copy of the address is inlined at build
 * time (`VITE_LOCAL_OPERATOR_API_URL`), so a tree built for the default would
 * leave the renderer talking to the operator's own backend at 1111 while main
 * talked to this run's. Build with it —
 *
 *     VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<port> pnpm build
 *
 * — and the token
 * is read from `LOCAL_OPERATOR_DESKTOP_TOKEN` in this script's environment, never
 * from argv (a token in a command line lands in the shell's history).
 */
const BACKEND = argValue("--backend", null);
/**
 * The serve records the `--backend` daemon wrote for itself.
 *
 * The app does not attach to a daemon it cannot prove is its own:
 * `src/main/backend/discovery.ts` reads `<config root>/run/serve/*.json`, dials
 * the address each record names, and requires the answering process to report
 * the SAME identity — instance id, pid, version, prefix — before the daemon is
 * admitted. A live daemon that no record describes is rejected
 * (`identity-mismatch`), and the app then behaves as if it had no backend at all:
 * `desktop_available` stays false and every capability-gated surface stays
 * closed, which is the state `--backend` exists to leave.
 *
 * So the run hands the app the records the run's OWN backend wrote, by copying
 * them into the scratch config root the app reads. That is not a bypass of the
 * check: it is the check, fed the file the daemon itself publishes, which is how
 * a daemon announces itself to every instance on the machine. Point it at the
 * backend's `config/run/serve` directory (the `LOCAL_OPERATOR_CONFIG_DIR` that
 * daemon was started with).
 */
const BACKEND_RECORDS = argValue("--backend-records", null);
/**
 * Seed the profile as an EXISTING user before the scene runs.
 *
 * With `--backend` the app is a first-run user by definition — fresh profile,
 * fresh backend, no provider connected — and the six-step wizard that follows is a
 * modal: it covers the rail, it fails the hit tests, and it owns the keyboard
 * while it is up. See `seedOnboardingComplete` for what the run writes.
 */
const SEED_ONBOARDING_COMPLETE = process.argv.includes(
	"--seed-onboarding-complete",
);
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

/*
 * The app's own output, read as patterns rather than as literals inside the
 * checks that use them: `useTopLevelRegex` asks for that, and two of these are
 * asked in more than one scene, so one name is also one place to change.
 *
 * None of them carries `g` or `y`, so none carries a `lastIndex` from one use to
 * the next and hoisting cannot change an answer.
 */

/** Whether a user agent names Electron, which is how a built app is told from a bare Vite page. */
const ELECTRON_USER_AGENT = /Electron/i;

/** Electron's own refusal, for a driver channel this launch never armed. */
const NO_HANDLER_REGISTERED = /no handler registered/i;

/** The line an armed launch prints, read in three places. */
const ARMED_LINE = /\[dev-driver\] ARMED/;

/** The two halves of the refusal a typo gets, in the launch's own words. */
const NOT_AN_OPT_IN = /not an opt-in/;
const DRIVER_STAYED_OFF = /stayed off/;

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
 * The address the app would use if nobody redirected it: the renderer's own
 * default, inlined into the bundle when no `VITE_LOCAL_OPERATOR_API_URL` was set
 * at build time. Named here so a `--backend` run can assert the app is NOT
 * talking to it — the operator's real backend listens there on this machine.
 */
const OPERATOR_BACKEND_URL = "http://localhost:1111";

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
			"# Written by scripts/renderer-driver.mjs. The app loads this with dotenv",
			"# override:true from its cwd, which is why the harness runs with a cwd",
			"# outside the checkout: a repo .env would win otherwise.",
			`VITE_LOCAL_OPERATOR_API_URL=${APP_API_URL}`,
			"VITE_DISABLE_BACKEND_MANAGER=true",
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
 *
 * THE TAG IS MATCHED WITH A TRAILING `/`, and that is not cosmetic: a bare
 * `lo-renderer-driver-647` is a PREFIX of `lo-renderer-driver-6479`, so two runs
 * whose pids happened to share a prefix would each see the other's apps and report
 * a survivor that is not theirs. It fails in the safe direction (a spurious FAIL
 * of the "nothing outlived its boot" check, and `--clean` then keeps a tree that
 * held nothing), but a red that names a process the run never started is the kind
 * of unexplained evidence that gets a real orphan dismissed later. Every path this
 * tag appears in is a path — the profile is `--user-data-dir=${USER_DATA}-${tag}`
 * under the scratch tree — so the separator is always there to match on.
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
	const needle = `${SCRATCH_TAG}/`;
	const lines = String(ps.stdout)
		.split("\n")
		.filter((line) => line.includes(needle));
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
	/*
	 * `withNotificationsOff`: this rig boots the real app, whose backend
	 * announces a parked gate through `osascript` on macOS — a banner in the
	 * operator's Notification Center from a harness run. The window mode below
	 * silences the app's own banner and has no reach into the backend's, so the
	 * switch goes into the environment this child is handed. See
	 * `notifications-off.mjs`.
	 */
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		// No backend manager: this run must not install or start a Local Operator
		// backend in the scratch HOME.
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
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
	 *
	 * `undefined` rather than the `delete` operator, which is what these were
	 * while `noDelete` allowed it: Node omits an `env` value that is `undefined`
	 * (measured on 22.22.0 and 24.18.1 — the child sees no key at all, exactly as
	 * it does after a removal), so an arming exported in whoever ran the harness
	 * still cannot reach this boot. The app's own gate takes only `1` and `true`
	 * and reports anything else as a TYPO, so even a runtime that spelled the
	 * value through could not arm an unarmed launch.
	 */
	env.LOCAL_OPERATOR_UI_DEV_DRIVER = undefined;
	env.LOCAL_OPERATOR_UI_DEV_DRIVER_OUT = undefined;
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
			// single-instance lock PER PROFILE (`app.requestSingleInstanceLock`), so two
			// boots sharing one `--user-data-dir` collide: the second prints "Another
			// instance is already running. Quitting this instance." and exits without
			// ever creating a window — which looks exactly like a broken driver.
			// Measured on the first two-boot run, which reused one profile directory
			// for both boots. Different profiles coexist (a peer session booted two apps
			// at once on separate profiles, and on the same HOME/config with different
			// profiles, with no collision), so what this buys is one profile per launch
			// rather than a machine-wide exclusion — the harness does not serialise.
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
			const response = await fetch(
				`http://127.0.0.1:${handle.port}/json/version`,
			);
			if (response.ok) return;
		} catch {
			/* not listening yet */
		}
		if (Date.now() - started > timeoutMs) {
			const tail = (await readAppLog(handle)).split("\n").slice(-30).join("\n");
			throw new Error(
				`the app's debugging port ${handle.port} never answered in ${timeoutMs}ms\n${tail}`,
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

	/**
	 * Attach to the app's renderer page, WAITING for it to exist.
	 *
	 * `waitForDevtools` only proves the browser endpoint is up
	 * (`/json/version`), which happens before the app has created its window;
	 * the page target appears later, and how much later is not constant: a
	 * launch that has a daemon to validate — `--backend`, where the app dials the
	 * discovered daemon and checks its identity before painting — reaches
	 * `/json/list` with an EMPTY list for a stretch, measured on this machine as
	 * three runs in a row failing `no renderer target …: []` against runs with no
	 * backend to validate, which attached on the first query.
	 *
	 * So the wait belongs here rather than being inferred from a longer
	 * `waitForDevtools`: the thing being waited FOR is a target, and the same
	 * call that reads the list is the one that has to retry. The timeout keeps
	 * the failure mode the harness had — a clear message naming the port and the
	 * targets it did see — instead of hanging.
	 */
	static async attach(port, targetUrlPart, timeoutMs = 60_000) {
		const started = Date.now();
		for (;;) {
			const list = await (
				await fetch(`http://127.0.0.1:${port}/json/list`)
			).json();
			const target = list.find(
				(entry) => entry.type === "page" && entry.url.includes(targetUrlPart),
			);
			if (target) {
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
			if (Date.now() - started > timeoutMs) {
				const seen = JSON.stringify(
					list.map((e) => ({ type: e.type, url: e.url })),
				);
				throw new Error(
					`no renderer target for ${targetUrlPart} on port ${port} after ${timeoutMs}ms: ${seen}`,
				);
			}
			await wait(250);
		}
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

/** How many RPC envelopes this run has sent, for their ids. */
let rpcSequence = 0;

/**
 * A CALL ON THE APP'S OWN LOOPBACK BROWSER RPC.
 *
 * WHY A SCENE SPEAKS THIS PROTOCOL AT ALL: this endpoint is the ONLY door an
 * agent's tools have into the app, so a request raised through it is the same
 * request the agent's own `request_access` raises - the approval store, the
 * projection's `requesterSessionId`, the tab registry's ownership and the tray's
 * rows are all the product's code paths, and the only thing that needs a model is
 * the agent's decision to browse at all. The endpoint and its key come from the
 * app's own discovery record (`src/main/browser/state-file.ts`: `host.json`, 0600,
 * under this run's scratch config root), which is how the Python session client
 * finds the host too - there is no test-only door here.
 */
async function browserRpc(method, params) {
	let record;
	try {
		record = JSON.parse(
			readFileSync(join(CONFIG_DIR, "run", "ui-browser", "host.json"), "utf8"),
		);
	} catch (error) {
		return {
			error: `no host record: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	rpcSequence += 1;
	const response = await fetch(`http://127.0.0.1:${record.port}/rpc`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-bridge-key": record.session_key,
		},
		body: JSON.stringify({
			id: `driver-${rpcSequence}`,
			method,
			params,
		}),
	});
	return response.json();
}

/**
 * A SECOND CONVERSATION, created on this run's own backend.
 *
 * The switch's own checks need two conversations to move between, and a
 * conversation is the backend's to create (`POST /v1/desktop/sessions` is the same
 * call the desktop UI makes). The shape is read tolerantly because a field name is
 * not what this asserts: the caller reports what it got and skips the step when
 * there is no id in it.
 */
async function createBackendSession() {
	const response = await fetch(`${BACKEND}/v1/desktop/sessions`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
		},
		// The backend validates `request_id` as a UUID, which is the same shape the
		// desktop UI sends; a hand-made string is a 422 with no session in it.
		body: JSON.stringify({
			request_id: randomUUID(),
			cwd: SCRATCH,
		}),
	});
	const body = await response.json();
	return {
		status: response.status,
		body,
		id:
			body?.session_id ??
			body?.session?.session_id ??
			body?.result?.session_id ??
			body?.id ??
			null,
	};
}

/** The pane's tray as a person reads it: the sentence, the chips, whatever it has
 * moved to its resolved list (where a false `Withdrawn by the agent` appears), and
 * which side of the switch is showing. */
function readTray(cdp) {
	return cdp.evaluate(`(() => {
		const text = (selector) => {
			const node = document.querySelector(selector);
			return node ? node.textContent.replace(/\\s+/g, " ").trim() : null;
		};
		const all = (selector) =>
			Array.from(document.querySelectorAll(selector)).map((node) =>
				node.textContent.replace(/\\s+/g, " ").trim(),
			);
		const active = document.querySelector(
			'[data-tour-tag^="browser-pane-scope-"][data-state="active"]',
		);
		return {
			count: text('[data-tour-tag="browser-approvals-tray-count"]'),
			chips: all('[data-tour-tag="browser-approvals-tray-chip"]'),
			resolved: all('[data-tour-tag="browser-approvals-resolved"] li'),
			side: active ? active.textContent.replace(/\\s+/g, " ").trim() : null,
			badge: text('[data-tour-tag="browser-pane-badge"]'),
		};
	})()`);
}

/** The strip's rows against the scroller they live in: how many there are, how many
 * are WHOLE, and what the pinned control says about the rest. The scroller is the
 * rows' own parent, so this reads the box the product scrolls rather than one the
 * script guessed at. */
function readStrip(cdp) {
	return cdp.evaluate(`(() => {
		const rows = Array.from(document.querySelectorAll("[data-tab-id]"));
		if (rows.length === 0) return { rows: 0, whole: 0, control: null };
		const scroller = rows[0].parentElement;
		const view = scroller.getBoundingClientRect();
		const whole = rows.filter((row) => {
			const box = row.getBoundingClientRect();
			return box.left >= view.left - 1 && box.right <= view.right + 1;
		}).length;
		const control = document.querySelector(
			'[data-tour-tag="browser-tab-overflow"]',
		);
		return {
			rows: rows.length,
			whole,
			scroller: {
				clientWidth: Math.round(scroller.clientWidth),
				scrollWidth: Math.round(scroller.scrollWidth),
			},
			control: control
				? {
						text: control.textContent.replace(/\\s+/g, " ").trim(),
						label: control.getAttribute("aria-label"),
					}
				: null,
		};
	})()`);
}

/** Poll a reader until its predicate holds, so a scene waits on the product rather
 * than on a timeout. Returns whatever the reader last saw. */
async function readUntil(reader, done, timeoutMs = 15_000) {
	const started = Date.now();
	let last = await reader();
	while (!done(last)) {
		if (Date.now() - started > timeoutMs) return last;
		await wait(250);
		last = await reader();
	}
	return last;
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
		/*
		 * `?.` for the explicit `previous !== null &&`, and the two agree on every
		 * value this variable actually holds: it is `null` before the first
		 * capture and a Buffer after one, and an optional call answers the same
		 * way for both. `undefined` is the one state where they differ, and it is
		 * unreachable here - the declaration below starts at `null` and the only
		 * assignment is a Buffer - but it differs in the safe direction: the
		 * explicit form would have thrown a TypeError there, while this one
		 * answers `undefined`, which is falsy and simply keeps waiting.
		 */
		if (previous?.equals(bytes)) {
			return {
				...frame,
				attempts: attempt,
				stable: true,
				toastFree,
				toastWaitMs,
			};
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
		ELECTRON_USER_AGENT.test(hello.userAgent),
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
		`${themeAction.settledAfterMs}ms${themeAction.settleTimedOut ? ` — TIMED OUT: this frame is mid-transition and is not evidence. Still running when the bound expired: ${(themeAction.settlePending ?? []).join(" | ") || "(the renderer named none)"}` : ""}`,
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

// ---- the keyboard scene ------------------------------------------------------

/**
 * The modifier bits `Input.dispatchKeyEvent` takes.
 *
 * CDP's own mask (Alt 1, Ctrl 2, Meta 4, Shift 8), which is a different spelling
 * of the DOM's `metaKey`/`shiftKey` booleans a listener reads back — the point of
 * sending it this way is that the renderer produces those booleans itself.
 */
const MODIFIER = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

/**
 * One chord, dispatched the way a keyboard sends one.
 *
 * `Input.dispatchKeyEvent` rather than a `KeyboardEvent` built inside the page:
 * a synthetic event proves only that SOME listener is registered and skips
 * everything between the key and the listener, which is the half of the claim a
 * shortcut has to earn. This goes through Chromium's input pipeline, so what the
 * renderer receives is what the platform sends — the same reason
 * `mentioned-files-app-proof.mjs` drives its Escape this way.
 *
 * `keyUp` follows every press, because a held key is a different case the app
 * answers differently (`repeat`) and a chord left down would leak into the next
 * step's reading.
 */
async function pressChord(cdp, { key, code, virtualKeyCode, modifiers = 0 }) {
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key,
			code,
			modifiers,
			windowsVirtualKeyCode: virtualKeyCode,
			nativeVirtualKeyCode: virtualKeyCode,
		});
	}
}

/**
 * The draft the session store has staged, read from the store's OWN persistence.
 *
 * `canonical-sessions-storage` is where `stageDraft` lands (`activeDraftKey` and
 * `drafts` are both in the persisted slice), so this reads the app's state rather
 * than this harness's idea of it — and it does so without adding a verb, which is
 * the difference between observing the app and widening the surface it exposes.
 */
function stagedDraft(cdp) {
	return cdp.evaluate(`(() => {
		try {
			const raw = localStorage.getItem("canonical-sessions-storage");
			return raw ? (JSON.parse(raw)?.state?.activeDraftKey ?? null) : null;
		} catch {
			return "(unreadable)";
		}
	})()`);
}

/**
 * Wait for the app's route to become `route`, and hand back where it actually is.
 *
 * A condition rather than a fixed sleep: `navigate("/chat")` lands in the
 * press's own frame, but the router committing it is a render, and a scene that
 * slept would either be slower than it needs to be or wrong on a loaded machine.
 * The answer is returned rather than asserted, so the failing case reports the
 * route the app is really on.
 */
async function waitForRoute(cdp, route, timeoutMs = 5000) {
	const started = Date.now();
	for (;;) {
		const state = await verb(cdp, "state");
		const waited = Date.now() - started;
		if (state.route === route || waited > timeoutMs)
			return { route: state.route, waited };
		await wait(50);
	}
}

/**
 * `new-chat`: the app-wide `⌘N`, and the presses that are deliberately not it.
 *
 * WHY THIS SCENE EXISTS, and why it is not a Storybook frame. `⌘N` starts a new
 * chat from anywhere in the app. Two things about that cannot be read off the
 * source: that the binding is REGISTERED on the built app's document at all — a
 * listener that never mounts is the failure mode a unit test cannot see, because
 * the unit test calls the predicate directly — and that the chord reaches it
 * through the platform's own input path rather than only through a synthetic
 * event. Both are properties of the running app.
 *
 * The app's state is read from the store's own persistence (`stagedDraft`) and
 * from what the router is showing (`state.route`), so the scene asserts the two
 * things the row's click does: a FRESH draft is staged, and the app lands on the
 * chat route.
 *
 * The negatives get the same treatment as the positive, and for the same reason:
 * `⌘⇧N` is another app's chord and a bare `n` belongs to whatever text field has
 * focus, so a binding that answered either would be wrong in a way a passing
 * positive case cannot see.
 *
 * TWO RUNS, TWO CLAIMS, and the scene asserts whichever one the run is in. The
 * shortcut takes the New chat row's own gate — the session catalogue — so a run
 * with `--backend` present proves the FEATURE (the press stages a fresh draft and
 * lands on the chat route, and the modified chords are refused there), while a
 * run without one proves the GATE (the same press changes nothing, because the
 * app is in exactly the state that gate exists for). Neither run can prove the
 * other's claim, which is why both are quoted in the evidence README.
 *
 * WHAT IT CANNOT SHOW: the screens it moves between. The before route is one of
 * the BACKEND-GATED ones this harness documents, and with no backend the chat
 * route it lands on is the app's offline surface; what the frames are evidence
 * about is the ROUTE the chord moved and the state of the store, not those two
 * screens. The row and its key caps are photographed against a real backend in
 * `docs/evidence/new-chat-shortcut/`.
 */
/**
 * Write the onboarding completion flags into the profile, then reload.
 *
 * WHY, precisely: `decideFirstTimeUser` (`shared/hooks/first-time-user.ts`)
 * answers "returning" when the onboarding store says the modal was completed, and
 * otherwise asks the provider census — which an isolated backend answers "nothing
 * connected", so every `--backend` run opens the six-step wizard. That wizard is a
 * modal with the window to itself, and a scene that needs to press a document
 * chord after the app has settled cannot run behind it.
 *
 * `Page.addScriptToEvaluateOnNewDocument` is what makes this safe AFTER the app
 * has booted: the script is registered on the page's own session and runs before
 * every subsequent document's scripts, so the store's `persist` rehydrates from
 * the seeded value rather than racing the write. Reloading gives the app one clean
 * boot with the flag present; clicking through six wizard screens instead would be
 * six presses of UI the scene is not about. This is the state a real user of the
 * feature is in — the wizard is a one-time surface, the shortcut is not.
 */
async function seedOnboardingComplete(cdp) {
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (error) { /* a profile without storage is not a reason to fail the boot */ }',
	});
	await cdp.send("Page.reload", { ignoreCache: false });
	await wait(1500);
}

/**
 * The conversation-scoped browser pane, driven the way a user opens it.
 *
 * WHAT THIS SCENE IS FOR, and why nothing else can carry it: the pane's own
 * stories render `BrowserPane` as the whole viewport against a stubbed bridge
 * (`browser-pane.stories.tsx` states that limit), so the two things they cannot
 * photograph are the ones this scene asserts — that a REAL press on the chat
 * header's Globe trigger opens the pane in the real app, and that the pane then
 * takes the right slot, narrowing the conversation rather than covering it, with
 * the native page following the reported rectangle.
 *
 * TWO RUNS, TWO CLAIMS, the same shape `new-chat` uses. The chat route (and so
 * the header the trigger lives in) renders only with the backend's
 * `session_catalogue` capability, so:
 *
 * - WITHOUT `--backend` this scene proves the GATE: the trigger is absent because
 *   the route is the app's offline surface, and the frame says which screen that
 *   is.
 * - WITH `--backend` it proves the FEATURE: the press opens the pane, the slot
 *   narrows the column, the scope switch changes the strip, the pane's own dock
 *   opens at the pane's width, and the host handover leaves the page visible
 *   exactly once.
 *
 * The `--backend` half needs a build made with `VITE_LOCAL_OPERATOR_API_URL` and
 * a bearer, per the isolation notes at the top of this file; the run asserts both
 * before the scene starts, so a mis-built app cannot report a false pass.
 */
async function sceneBrowserPane(cdp) {
	const hello = await verb(cdp, "hello");
	check(
		"the renderer reports this run's frames directory",
		hello.outDir === FRAMES,
		`${hello.outDir} (expected ${FRAMES})`,
	);

	await verb(cdp, "setTheme", "localOperatorDark");
	await verb(cdp, "navigate", "/chat");
	/*
	 * OPEN A CONVERSATION FIRST, and this is not incidental: with no conversation
	 * selected the chat route renders its "Start a chat" draft screen, which has no
	 * header at all - measured against this run's own backend, where the frame was
	 * that screen with one session already in the catalogue. The chat header (and
	 * with it the right slot's three triggers) exists only once a session is open,
	 * so the scene widens the sidebar list and presses the first conversation, the
	 * way a user does.
	 */
	await verb(cdp, "press", {
		selector: '[data-tour-tag="chat-all-chats"]',
	});
	await verb(cdp, "press", {
		selector: '[data-tour-tag="chat-session-row"]',
	});
	const before = await verb(cdp, "state");
	note("state (chat, before)", JSON.stringify(before));

	/*
	 * Asked of the DOM rather than with `press`, because the absence of the
	 * trigger is a RESULT in the gated run and a thrown "nothing matches" would
	 * end the scene instead of reporting it.
	 */
	const triggerPresent = await cdp.evaluate(
		"Boolean(document.querySelector('[data-tour-tag=\"browser-pane-trigger\"]'))",
	);
	note("the header's trigger is present", String(triggerPresent));

	if (!BACKEND) {
		check(
			"without a backend the chat route is the offline surface, so the trigger has no header to sit in",
			triggerPresent === false,
			`trigger present: ${triggerPresent} — the gate this scene documents is not where it was`,
		);
		const frame = await captureSettled(cdp, "browser-pane-gated");
		note("frame", JSON.stringify(frame));
		note(
			"not shown",
			"the pane in the app: a press needs the header, the header needs `session_catalogue`, and that needs --backend (see this scene's doc block)",
		);
		return;
	}

	check(
		"with a backend the chat route renders its header, and the trigger with it",
		triggerPresent === true,
		"the trigger is absent even though a backend answered — the press below would prove nothing",
	);

	// 1. THE PRESS, which is the whole claim: a real click on the real control.
	const pressed = await verb(cdp, "press", {
		selector: '[data-tour-tag="browser-pane-trigger"]',
	});
	note("pressed", JSON.stringify(pressed));
	const opened = await verb(cdp, "state");
	check(
		"the press opens the pane, in the store the slot reads",
		opened.browserPaneOpen === true,
		`browserPaneOpen=${opened.browserPaneOpen} after a press on the trigger`,
	);
	const openFrame = await captureSettled(cdp, "browser-pane-open");
	note("frame", JSON.stringify(openFrame));

	/*
	 * THE SLOT'S GEOMETRY, read off the elements the product marks for exactly
	 * this (`data-tour-tag="browser-pane-slot"` in `chat-content.tsx`, and the
	 * surface's own `browser-content`). "The conversation narrows rather than
	 * being covered" is a claim about two numbers, so the scene takes both.
	 */
	const geometry = await cdp.evaluate(`(() => {
		const rect = (selector) => {
			const element = document.querySelector(selector);
			if (!element) return null;
			const box = element.getBoundingClientRect();
			return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
		};
		return {
			slot: rect('[data-tour-tag="browser-pane-slot"]'),
			content: rect('[data-tour-tag="browser-content"]'),
			window: { width: window.innerWidth, height: window.innerHeight },
		};
	})()`);
	note("geometry", JSON.stringify(geometry));
	check(
		"the pane occupies the right slot",
		geometry.slot !== null && geometry.slot.width > 0,
		JSON.stringify(geometry.slot),
	);
	check(
		"the pane takes its width OUT of the column rather than covering it: the slot ends at the window's right edge and the column keeps the rest",
		geometry.slot !== null &&
			geometry.slot.x + geometry.slot.width === geometry.window.width &&
			geometry.slot.x > 0,
		`slot ${JSON.stringify(geometry.slot)} in a ${geometry.window.width}px window`,
	);
	check(
		"the page area inside the pane is a real rectangle, not a zero-width one",
		geometry.content !== null && geometry.content.width >= 240,
		JSON.stringify(geometry.content),
	);

	// 2. The scope switch, pressed for real: the strip's list is the switch's.
	const scopeBefore = await cdp.evaluate(
		"Array.from(document.querySelectorAll('[data-tab-id]')).map((node) => node.getAttribute('data-tab-id'))",
	);
	await verb(cdp, "press", {
		selector: '[data-tour-tag="browser-pane-scope-all"]',
	});
	const scopeFrame = await captureSettled(cdp, "browser-pane-scope-all");
	const scopeAfter = await cdp.evaluate(
		"Array.from(document.querySelectorAll('[data-tab-id]')).map((node) => node.getAttribute('data-tab-id'))",
	);
	note(
		"strip before/after the scope switch",
		JSON.stringify({ scopeBefore, scopeAfter }),
	);
	note("frame", JSON.stringify(scopeFrame));

	// 3. The pane's own dock, opened from the URL bar's Approvals control.
	const approvals = await cdp.evaluate(
		"Boolean(document.querySelector('[data-tour-tag=\"browser-approvals\"]'))",
	);
	if (approvals) {
		await verb(cdp, "press", {
			selector: '[data-tour-tag="browser-approvals"]',
		});
		const dockFrame = await captureSettled(cdp, "browser-pane-dock");
		note("frame", JSON.stringify(dockFrame));
	} else {
		note(
			"dock not opened",
			"no Approvals control on this projection: the dock is only reachable when the host has a request to show",
		);
	}

	/*
	 * 4. THE HOST HANDOVER, which is the one state where the page can go
	 * invisible while the layout still looks right: exactly one host may be
	 * mounted at a time (`use-browser-chrome.ts`'s unmount contract), because two
	 * rect reporters would fight over the same native view, and a null rectangle
	 * delivered by the outgoing host AFTER the incoming host's first report
	 * leaves the view with no bounds. So: to the route with the pane open, and
	 * back, asserting at each step that the page's rectangle is still a rectangle.
	 */
	await verb(cdp, "navigate", "/browser");
	const onRoute = await cdp.evaluate(`(() => {
		const rect = (selector) => {
			const element = document.querySelector(selector);
			if (!element) return null;
			const box = element.getBoundingClientRect();
			return { x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height) };
		};
		return {
			route: rect('[data-tour-tag="browser-route"]'),
			content: rect('[data-tour-tag="browser-content"]'),
			paneSlot: rect('[data-tour-tag="browser-pane-slot"]'),
		};
	})()`);
	note("the route's own geometry with the pane open", JSON.stringify(onRoute));
	check(
		"the handover mounts one host: the route's surface is there and the pane's slot is gone",
		onRoute.route !== null && onRoute.paneSlot === null,
		JSON.stringify(onRoute),
	);
	check(
		"and the page still has a rectangle after the handover",
		onRoute.content !== null && onRoute.content.width > 0,
		JSON.stringify(onRoute.content),
	);
	const routeFrame = await captureSettled(cdp, "browser-pane-handover-route");

	await verb(cdp, "navigate", "/chat");
	const backOnChat = await verb(cdp, "state");
	const backGeometry = await cdp.evaluate(`(() => {
		const element = document.querySelector('[data-tour-tag="browser-content"]');
		if (!element) return null;
		const box = element.getBoundingClientRect();
		return { x: Math.round(box.x), width: Math.round(box.width) };
	})()`);
	check(
		"the pane is still open after the round trip, and its page has bounds again",
		backOnChat.browserPaneOpen === true &&
			backGeometry !== null &&
			backGeometry.width > 0,
		`paneOpen=${backOnChat.browserPaneOpen} content=${JSON.stringify(backGeometry)}`,
	);
	const backFrame = await captureSettled(cdp, "browser-pane-handover-back");
	note("frames", JSON.stringify({ routeFrame, backFrame }));

	// 5. The badge, in the header, at whatever this conversation is waiting on.
	const badge = await cdp.evaluate(`(() => {
		const node = document.querySelector('[data-tour-tag="browser-pane-badge"]');
		return node ? node.textContent : null;
	})()`);
	note(
		"the header's badge",
		badge === null
			? "no badge: this conversation has no live request (the trigger is still there, unpressed)"
			: badge,
	);

	/*
	 * 6. THE SWITCH WITH REQUESTS OUTSTANDING (QA round 1, Q1; UX round 1, U1).
	 *
	 * The defect lived in exactly this state: the surface fed the switch's scope to
	 * the request filter as well as the tab filter, so on All tabs the pane counted
	 * another conversation's approval as this conversation's, under a sentence that
	 * denied it - and, worse, pressing back took that request out of the queue
	 * model's input while it was still pending, which the model reports as
	 * `Withdrawn by the agent`.
	 *
	 * Both requests are raised through the app's own RPC (see `browserRpc`): this
	 * conversation's, and one whose requester is another conversation. The second
	 * requester is a NAME rather than a second live session - the approval store
	 * keys on the requester string, which is the field the tray reads - and the
	 * frame says so.
	 */
	const liveState = await verb(cdp, "state");
	const conversation = liveState.activeSessionId ?? null;
	const OTHER_CONVERSATION = "session:other-conversation-live";
	if (conversation === null) {
		note(
			"requests not raised",
			"no conversation is open, so a request has nothing to be attributed to",
		);
	} else {
		/*
		 * TWO from this conversation and one from another, which is the shape the
		 * defect needs: the tray's own header row - the count and the chips - renders
		 * only when the queue it disambiguates holds more than one request, so a
		 * single request would leave the state this check is about invisible
		 * (`browser-approvals-tray.tsx`: `rows.length > 1 || dockOpen`).
		 */
		const mine = await browserRpc("request_access", {
			url: "https://mine.example.com/",
			requester: `session:${conversation}`,
		});
		const mineTwo = await browserRpc("request_access", {
			url: "https://mine-two.example.com/",
			requester: `session:${conversation}`,
		});
		const theirs = await browserRpc("request_access", {
			url: "https://theirs.example.net/",
			requester: OTHER_CONVERSATION,
		});
		note(
			"request_access (two for this conversation, one for another)",
			JSON.stringify({
				mine: mine.result ?? mine.error,
				mineTwo: mineTwo.result ?? mineTwo.error,
				theirs: theirs.result ?? theirs.error,
			}),
		);
		check(
			"three requests are live, two from this conversation and one from another",
			mine.result?.state === "pending" &&
				mineTwo.result?.state === "pending" &&
				theirs.result?.state === "pending",
			JSON.stringify({ mine, mineTwo, theirs }),
		);
		await verb(cdp, "press", {
			selector: '[data-tour-tag="browser-pane-scope-conversation"]',
		});
		const scoped = await readUntil(
			() => readTray(cdp),
			(tray) => tray.chips.length === 1,
		);
		note("tray (This conversation)", JSON.stringify(scoped));
		check(
			"on This conversation the tray shows this conversation's two requests",
			scoped.chips.length === 2 &&
				(scoped.count ?? "").startsWith("2 approvals") &&
				scoped.resolved.length === 0,
			JSON.stringify(scoped),
		);
		// ONE PRESS. The tabs widen to every tab; the requests must not move.
		await verb(cdp, "press", {
			selector: '[data-tour-tag="browser-pane-scope-all"]',
		});
		const widened = await readUntil(
			() => readTray(cdp),
			(tray) => tray.side === "All tabs",
		);
		// The wait is on the tray having read the projection at all, not on the
		// switch: the claim below is that the OTHER conversation's request never
		// appears in this list, and a stale read would pass it for the wrong reason.
		await wait(750);
		const widenedFrame = await captureSettled(
			cdp,
			"browser-pane-requests-scope-all",
		);
		note("tray (All tabs)", JSON.stringify(widened));
		check(
			"on All tabs the tray still shows this conversation's two requests, not the three the app holds",
			widened.chips.length === 2 &&
				widened.count === scoped.count &&
				widened.resolved.length === 0,
			JSON.stringify({ scoped, widened }),
		);
		note("frame", JSON.stringify(widenedFrame));
		// AND BACK. The other conversation's request is still pending in the app, so
		// the pane must not have attributed a withdrawal to anyone.
		await verb(cdp, "press", {
			selector: '[data-tour-tag="browser-pane-scope-conversation"]',
		});
		const narrowed = await readUntil(
			() => readTray(cdp),
			(tray) => tray.side === "This conversation",
		);
		const pending = await cdp.evaluate(
			"window.api.browser.state().then((state) => (state?.pendingConsent ?? []).map((entry) => entry.origin))",
		);
		const narrowedFrame = await captureSettled(
			cdp,
			"browser-pane-requests-scope-conversation",
		);
		note(
			"tray (back on This conversation)",
			JSON.stringify({ tray: narrowed, pending }),
		);
		check(
			"narrowing the switch does not report the other conversation's live request as withdrawn",
			narrowed.resolved.length === 0 &&
				Array.isArray(pending) &&
				pending.length === 3,
			JSON.stringify({ tray: narrowed, pending }),
		);
		note("frame", JSON.stringify(narrowedFrame));
	}

	/*
	 * 7. THE STRIP AT THE PANE'S OWN WIDTH: what fits, and what the pinned control
	 * says about the rest (design round 1, D1's remainder; QA round 1, Q2).
	 *
	 * Tabs are opened through the same RPC an agent uses, in THIS conversation, so
	 * the pane's conversation scope holds all of them and the arithmetic is the
	 * pane's arithmetic rather than a filter's.
	 */
	if (conversation !== null) {
		/*
		 * THE TRACK'S RING, MEASURED RATHER THAN ASSUMED (design round 1's D3,
		 * re-checked in round 2 because it never painted). The list is Radix's
		 * `Tabs.List`, whose `RovingFocusGroup` root writes
		 * `style: { outline: "none", ... }` on the element it renders - and with
		 * `asChild` that element IS the list. An inline declaration beats every class,
		 * so the ring's classes were in the DOM and in the stylesheet while
		 * `outline-style` computed to `none`, and not one pixel of the ring was drawn
		 * in any frame. The ring is drawn by a wrapper Radix does not own now; this
		 * reads both elements so the claim is about what paints rather than about what
		 * is declared.
		 */
		const ring = await cdp.evaluate(`(() => {
			const track = document.querySelector('[data-tour-tag="browser-pane-scope-track"]');
			if (!track) return null;
			const list = track.querySelector('[role="tablist"]');
			const computed = getComputedStyle(track);
			return {
				style: computed.outlineStyle,
				width: computed.outlineWidth,
				color: computed.outlineColor,
				listInline: list ? list.getAttribute("style") : null,
				listStyle: list ? getComputedStyle(list).outlineStyle : null,
			};
		})()`);
		note("the scope switch's track", JSON.stringify(ring));
		check(
			"the track's ring PAINTS: a solid outline of the control role, on an element the primitive does not own",
			ring !== null &&
				ring.style === "solid" &&
				Number.parseFloat(ring.width) >= 1,
			JSON.stringify(ring),
		);
		check(
			"and the primitive's own suppression stays on the LIST, where it is meant, rather than on the track",
			ring !== null &&
				ring.listStyle === "none" &&
				(ring.listInline ?? "").includes("outline"),
			JSON.stringify(ring),
		);

		/*
		 * THE STRIP'S HEIGHT ACROSS THE EMPTY AND POPULATED CASES (design round 2,
		 * D9): the design round measured the page stepping 32px between them, because
		 * the row's height came from the tabs in it and with none it collapsed to its
		 * own padding. Measured here with nothing of this conversation open, and again
		 * the moment one tab exists.
		 */
		const stripRow = () =>
			cdp.evaluate(`(() => {
				const row = document.querySelector('[data-tour-tag="browser-tab-strip-row"]');
				if (!row) return null;
				const box = row.getBoundingClientRect();
				return {
					height: Math.round(box.height),
					rows: row.querySelectorAll("[data-tab-id]").length,
				};
			})()`);
		const emptyStrip = await readUntil(
			() => stripRow(),
			(state) => state !== null && state.rows === 0,
		);
		/*
		 * WITH NO URL, DELIBERATELY, and it is the only shape that works here: a
		 * navigation to an origin the user has not approved is refused by the gate
		 * (`origin_not_allowed` - measured), and `about:blank` is refused by the
		 * URL's own scheme check ("only http:// and https:// can be opened" -
		 * measured). An `open` with no URL creates the tab and leaves it blank, which
		 * is what the agent's first `open` does before it navigates; the tab carries
		 * the same `Agent` chip as any other, and that is what the strip's arithmetic
		 * reads.
		 */
		const firstTab = await browserRpc("open", {
			requester: `session:${conversation}`,
		});
		note("open", JSON.stringify(firstTab.result ?? firstTab.error));
		const oneTabStrip = await readUntil(
			() => stripRow(),
			(state) => state !== null && state.rows === 1,
		);
		const oneTabFrame = await captureSettled(cdp, "browser-pane-strip-one");
		note(
			"the strip's height, empty and with one tab",
			JSON.stringify({ empty: emptyStrip, oneTab: oneTabStrip }),
		);
		note("frame", JSON.stringify(oneTabFrame));
		check(
			"the strip's height does not step when the first tab arrives (D9): at most 2px between the empty row and one tab",
			emptyStrip !== null &&
				oneTabStrip !== null &&
				emptyStrip.rows === 0 &&
				oneTabStrip.rows === 1 &&
				Math.abs(emptyStrip.height - oneTabStrip.height) <= 2,
			JSON.stringify({ empty: emptyStrip, oneTab: oneTabStrip }),
		);
		check(
			"and the empty strip is a real row rather than a collapsed one",
			emptyStrip !== null && emptyStrip.height >= 32,
			JSON.stringify(emptyStrip),
		);
		for (let index = 0; index < 3; index += 1) {
			const openedTab = await browserRpc("open", {
				requester: `session:${conversation}`,
			});
			note("open", JSON.stringify(openedTab.result ?? openedTab.error));
		}
		await verb(cdp, "press", {
			selector: '[data-tour-tag="browser-pane-scope-conversation"]',
		});
		const four = await readUntil(
			() => readStrip(cdp),
			(strip) => strip.rows >= 4,
		);
		const fourFrame = await captureSettled(cdp, "browser-pane-strip-four");
		note("strip at the pane's default width, four tabs", JSON.stringify(four));
		note("frame", JSON.stringify(fourFrame));
		check(
			"four tabs fit the pane's own width WHOLE, so the state D1 filed is not reachable there",
			four.rows >= 4 && four.whole === four.rows && four.control === null,
			JSON.stringify(four),
		);
		for (let index = 0; index < 2; index += 1) {
			await browserRpc("open", { requester: `session:${conversation}` });
		}
		const six = await readUntil(
			() => readStrip(cdp),
			(strip) => strip.rows >= 6 && strip.control !== null,
		);
		const sixFrame = await captureSettled(cdp, "browser-pane-strip-overflow");
		note("strip at the pane's default width, six tabs", JSON.stringify(six));
		note("frame", JSON.stringify(sixFrame));
		check(
			"past that, the pinned control appears and its own text is the count of tabs that are not shown",
			six.control !== null &&
				/\(\+\d+\)|\+\d+/.test(six.control.text) &&
				(six.control.label ?? "").includes("not shown"),
			JSON.stringify({ six, control: six.control }),
		);
		check(
			"and the count is the number the boxes say, not the tab count",
			six.control !== null &&
				six.control.text.replace(/[^0-9]/g, "") ===
					String(six.rows - six.whole),
			JSON.stringify({ six, offScreen: six.rows - six.whole }),
		);
	}

	/*
	 * 8. THE SAME TABS ON THE ROUTE, which is the other half of the measurement (QA
	 * round 1, Q2: the control was drawn at this width with nothing off screen, so
	 * its presence said nothing at all). What is asserted here is the INVARIANT
	 * rather than this run's accident: the control is on screen exactly when a tab
	 * is not, on both hosts, at whatever width each of them has.
	 */
	await verb(cdp, "navigate", "/browser");
	const routeStrip = await readUntil(
		() => readStrip(cdp),
		(strip) => strip.rows > 0,
	);
	const routeStripFrame = await captureSettled(cdp, "browser-route-strip");
	note("strip on the route", JSON.stringify(routeStrip));
	note("frame", JSON.stringify(routeStripFrame));
	check(
		"on the route the control is present exactly when a tab is off screen",
		routeStrip.rows - routeStrip.whole > 0 === (routeStrip.control !== null),
		JSON.stringify(routeStrip),
	);

	/*
	 * 9. THE LENS SURVIVES A CONVERSATION SWITCH (UX round 1, U3). The pane stays
	 * open on the new session's content; the CHOICE has to stay with it, which it
	 * cannot do from a `useState` inside a component the switch remounts.
	 *
	 * The second conversation is created on this run's backend, and the switch is a
	 * route change to it and back - the same remount a sidebar press produces.
	 */
	if (conversation !== null && BACKEND) {
		const other = await createBackendSession();
		note("a second conversation", JSON.stringify(other));
		if (other.id === null) {
			note(
				"the switch's own check not run",
				`the backend's session create returned no id: ${JSON.stringify(other.body)}`,
			);
		} else {
			await verb(cdp, "navigate", "/chat");
			await verb(cdp, "press", {
				selector: '[data-tour-tag="browser-pane-scope-all"]',
			});
			const beforeSwitch = await readTray(cdp);
			await verb(cdp, "navigate", `/chat/${other.id}`);
			await verb(cdp, "navigate", `/chat/${conversation}`);
			const afterSwitch = await readUntil(
				() => readTray(cdp),
				(tray) => tray.side !== null,
			);
			const switchFrame = await captureSettled(
				cdp,
				"browser-pane-lens-after-switch",
			);
			note(
				"the switch's side before and after a conversation switch",
				JSON.stringify({
					beforeSwitch: beforeSwitch.side,
					afterSwitch: afterSwitch.side,
				}),
			);
			check(
				"All tabs survives a conversation switch, so the pane does not make the user choose again",
				beforeSwitch.side === "All tabs" && afterSwitch.side === "All tabs",
				JSON.stringify({ before: beforeSwitch.side, after: afterSwitch.side }),
			);
			note("frame", JSON.stringify(switchFrame));
		}
	} else {
		note(
			"the switch's own check not run",
			"it needs a backend to create the second conversation in",
		);
	}

	/* 10. THE CARET COMES BACK (UX round 1, U2): the pane's two neighbours put focus
	 * back on their own trigger when they close, and the third occupant of the slot
	 * has to as well. The pane is closed by its own control, which is how a user
	 * closes it after arriving from the keyboard. */
	// Step 8 left the app on the route, where the pane is not mounted at all.
	await verb(cdp, "navigate", "/chat");
	const closePresent = await cdp.evaluate(
		"Boolean(document.querySelector('[data-tour-tag=\"browser-pane-close\"]'))",
	);
	if (closePresent) {
		/*
		 * THE CARET IS LOST THE WAY A KEYBOARD USER LOSES IT: the trigger is given
		 * real DOM focus, the pane is opened from that state, and the control that
		 * held focus unmounts under it - which is what UX round 1 (U2) walked with
		 * Enter and what leaves `document.activeElement` on `<body>`.
		 *
		 * The activation is a programmatic click on the FOCUSED trigger rather than a
		 * synthesised Enter, and the reason is measured: `Input.dispatchKeyEvent` for
		 * Enter does not produce Chromium's default activation for the button over
		 * this CDP path, so the pane never opened and the step reported the state it
		 * was in rather than the state it meant. Focus is the half that matters here,
		 * and a programmatic click does not move it - the assertion below checks the
		 * caret really was lost, so this is not an assumption.
		 */
		await verb(cdp, "press", {
			selector: '[data-tour-tag="browser-pane-close"]',
		});
		await cdp.evaluate(
			"document.querySelector('[data-tour-tag=\"browser-pane-trigger\"]').focus()",
		);
		await verb(cdp, "press", {
			selector: '[data-tour-tag="browser-pane-trigger"]',
		});
		const openedByFocus = await cdp.evaluate(`(() => {
			const active = document.activeElement;
			return {
				paneOpen: Boolean(document.querySelector('[data-tour-tag="browser-pane-slot"]')),
				tag: active ? active.tagName : null,
			};
		})()`);
		note("opened from a focused trigger", JSON.stringify(openedByFocus));
		check(
			"opening the pane from its own focused control leaves the caret on the document, which is the state the check below is about",
			openedByFocus.paneOpen === true && openedByFocus.tag === "BODY",
			JSON.stringify(openedByFocus),
		);
		await verb(cdp, "press", {
			selector: '[data-tour-tag="browser-pane-close"]',
		});
		const afterClose = await cdp.evaluate(`(() => {
			const active = document.activeElement;
			return {
				tag: active ? active.tagName : null,
				tour: active ? active.getAttribute("data-tour-tag") : null,
				paneOpen: Boolean(document.querySelector('[data-tour-tag="browser-pane-slot"]')),
			};
		})()`);
		const closedFrame = await captureSettled(cdp, "browser-pane-closed-focus");
		note("after closing the pane", JSON.stringify(afterClose));
		check(
			"closing the pane puts the caret back on the control that opened it",
			afterClose.paneOpen === false &&
				afterClose.tour === "browser-pane-trigger",
			JSON.stringify(afterClose),
		);
		// The badge, read where it lives: on the trigger, with the pane closed.
		const badge = await readTray(cdp);
		note(
			"the header's badge with the pane closed",
			JSON.stringify(badge.badge),
		);
		const stillPending = await cdp.evaluate(
			"window.api.browser.state().then((state) => (state?.pendingConsent ?? []).length)",
		);
		note(
			"pending in the app, from the header",
			JSON.stringify({ badge: badge.badge, stillPending }),
		);
		check(
			"the badge counts this conversation's two requests while the app holds three",
			badge.badge === "2" && stillPending === 3,
			`badge ${badge.badge} with ${stillPending} pending — this conversation raised two of the three`,
		);
		note("frame", JSON.stringify(closedFrame));
	} else {
		note(
			"the caret check not run",
			"no close control on this projection, so the pane was not closed by a press",
		);
	}
}

async function sceneNewChat(cdp) {
	/*
	 * Start anywhere but the chat route: `navigate("/chat")` is 80% of what this
	 * shortcut does, and a press that started from `/chat` would leave the same
	 * screen behind. `/agent-hub` is a rail item the gate's own scene already
	 * presses, so the route is one the app really has.
	 */
	await verb(cdp, "navigate", "/agent-hub");
	await verb(cdp, "setTheme", "localOperatorDark");
	const before = await verb(cdp, "state");
	const beforeDraft = await stagedDraft(cdp);
	note("state before the press", JSON.stringify(before));
	check(
		"the scene starts on a route that is not the chat route",
		before.route === "/agent-hub",
		`route is ${before.route}`,
	);
	check(
		"no draft is staged before the press",
		beforeDraft === null,
		`activeDraftKey is ${JSON.stringify(beforeDraft)}`,
	);
	const beforeFrame = await captureSettled(cdp, "before-cmd-n");
	note("frame", JSON.stringify(beforeFrame));

	// The chord itself: `⌘N` on macOS, and CDP's Meta bit is the same key on
	// every platform this harness runs on (Ctrl is `MODIFIER.ctrl`).
	await pressChord(cdp, {
		key: "n",
		code: "KeyN",
		virtualKeyCode: 78,
		modifiers: MODIFIER.meta,
	});
	const landed = await waitForRoute(cdp, "/chat");
	const afterDraft = await stagedDraft(cdp);
	/*
	 * WHAT THIS PRESS IS ASSERTED TO DO depends on whether the run has a backend,
	 * and the difference is the point rather than a convenience. The shortcut takes
	 * the New chat row's own gate — the session catalogue — so with `--backend`
	 * absent the app is in the state that gate exists for, and the claim is that
	 * the chord is INERT there rather than quietly staging a draft the UI says it
	 * cannot start. With a backend, the same press is the feature.
	 */
	if (BACKEND) {
		check(
			"⌘N moved the app to the chat route",
			landed.route === "/chat",
			`route is ${landed.route} after ${landed.waited}ms`,
		);
		check(
			"⌘N staged a fresh draft, which is what the New chat row stages",
			typeof afterDraft === "string" && afterDraft.startsWith("draft:"),
			`activeDraftKey is ${JSON.stringify(afterDraft)} (was ${JSON.stringify(beforeDraft)})`,
		);
	} else {
		check(
			"with no backend ⌘N is inert, exactly as the New chat row is disabled on the same capability",
			landed.route === "/agent-hub" && afterDraft === beforeDraft,
			`route ${landed.route} after ${landed.waited}ms, activeDraftKey ${JSON.stringify(beforeDraft)} -> ${JSON.stringify(afterDraft)}`,
		);
	}
	const afterFrame = await captureSettled(cdp, "after-cmd-n");
	note("frame", JSON.stringify(afterFrame));

	/*
	 * The presses that must NOT start a chat, each against a route the positive case
	 * just proved it can leave — so a refusal here cannot be a route that happened
	 * not to be listening. Skipped without a backend, where EVERY press is refused
	 * by the gate above and a refusal assertion would prove nothing about the
	 * modifiers it names.
	 */
	if (BACKEND) {
		const refusals = [
			{
				name: "⌘⇧N",
				press: { key: "N", modifiers: MODIFIER.meta | MODIFIER.shift },
			},
			{
				name: "a bare n",
				press: { key: "n", modifiers: 0 },
			},
		];
		for (const refusal of refusals) {
			await verb(cdp, "navigate", "/agent-hub");
			const stagedBefore = await stagedDraft(cdp);
			await pressChord(cdp, {
				key: refusal.press.key,
				code: "KeyN",
				virtualKeyCode: 78,
				modifiers: refusal.press.modifiers,
			});
			await wait(300);
			const settled = await verb(cdp, "state");
			const stagedAfter = await stagedDraft(cdp);
			check(
				`${refusal.name} does not start a new chat`,
				settled.route === "/agent-hub" && stagedAfter === stagedBefore,
				`route ${settled.route}, activeDraftKey ${JSON.stringify(stagedBefore)} -> ${JSON.stringify(stagedAfter)}`,
			);
		}
	}

	const frames = [beforeFrame, afterFrame];
	check(
		"every capture is a frame the app held still for, with no toast on it",
		frames.every((frame) => frame.stable === true && frame.toastFree === true),
		frames
			.map(
				(frame) =>
					`${frame.label}: ${frame.stable === true ? `held still after ${frame.attempts} capture(s)` : `never held still in ${frame.attempts} capture(s)`}, toast-free ${frame.toastFree === true}`,
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

/**
 * `palette`: the command palette, driven the way it is actually opened.
 *
 * ## Why this scene exists, and what it is evidence for
 *
 * The palette's visual states are captured from Storybook
 * (`docs/evidence/command-palette-commandpalette/`, twelve themes per story),
 * and a story cannot show the two things this surface is: it is opened by a
 * press on the rail's Search row, and it is driven by the keyboard. So this
 * scene presses that row in the BUILT app, types into the field through CDP's
 * own input pipeline (`Input.insertText`, the same domain `click-proof.mjs`
 * dispatches through — not a synthetic DOM event from inside the page), walks
 * nothing by hand, and photographs the result.
 *
 * It also asserts what the frames cannot: that Escape closed the dialog and
 * that focus came back to the row that opened it. That last one is a defect the
 * surface shipped with — Radix's modal dialog ends by focusing its trigger, and
 * this palette has no trigger, so focus landed on `document.body` and a user
 * who pressed Escape had to click before the keyboard worked again.
 *
 * What it does NOT show: the conversation and settings-registry groups, which
 * need a backend (a driver run has none), and the chat route's own rows. Those
 * are in the live-app evidence instead.
 */
async function scenePalette(cdp) {
	const hello = await verb(cdp, "hello");
	note("hello", JSON.stringify(hello, null, 2));
	check(
		"the renderer reports this run's frames directory",
		hello.outDir === FRAMES,
		`${hello.outDir} (expected ${FRAMES})`,
	);
	check(
		"the renderer sees the built app, not a bare Vite page",
		ELECTRON_USER_AGENT.test(hello.userAgent),
		hello.userAgent,
	);
	/*
	 * The harness's own invariants, which `--scene states` states in full. This
	 * scene repeats the two that would make its frames a different app than the
	 * one they claim to be (a window that is shown or a mode that fell back to
	 * `normal` is an interruption, and a frame from it is not reproducible).
	 */
	const facts = await factsOf(cdp);
	note("facts (from main)", JSON.stringify(facts, null, 2));
	check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);

	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", "localOperatorDark");

	/*
	 * Before: the rail, with the palette's own door on it. The frame is what shows
	 * the door exists at all and where it was put — above the account row, below
	 * the destinations — which is the half of this change a palette-only capture
	 * could not show.
	 */
	const before = await captureSettled(cdp, "palette-rail-dark");
	/*
	 * The same row in a LIGHT theme, because it is the one treatment in this
	 * change the twelve-theme story sweep cannot reach: the rail's chord is plain
	 * monospace on a `sunken` ground rather than the panel's key caps, and a
	 * contrast question about it is only answerable in more than one ground
	 * (design round 1, D4).
	 */
	await verb(cdp, "setTheme", "localOperatorLight");
	const railLight = await captureSettled(cdp, "palette-rail-light");
	await verb(cdp, "setTheme", "localOperatorDark");

	// The open itself: a real pointer sequence at the row's painted centre, the
	// same element a user clicks. `press` reports what it hit, and the scene fails
	// on a press that landed somewhere else.
	/*
	 * The press is a pointer SEQUENCE dispatched at the row's own box, and one
	 * thing it deliberately does not do is move focus: `dispatchEvent` cannot,
	 * where a real click on macOS Chromium focuses the button. That makes this
	 * the harder case rather than the easier one - the palette opens with
	 * `document.activeElement` on the body - and the assertion after Escape holds
	 * the app to landing focus somewhere real anyway, because `Cmd+K` with
	 * nothing focused reaches the same state.
	 */
	const opened = await verb(cdp, "press", "[data-command-palette-trigger]");
	note("pressed the rail's Search row", JSON.stringify(opened));
	check(
		"the rail's Search row is what received the press",
		opened.hitTest === true,
		JSON.stringify(opened),
	);
	const openedState = await cdp.evaluate(
		"({ active: document.activeElement?.id ?? null, dialog: Boolean(document.querySelector('[data-tour-tag=\"command-palette-dialog\"]')) })",
	);
	note("after the press", JSON.stringify(openedState));
	check(
		"pressing it opened the palette",
		openedState.dialog === true,
		JSON.stringify(openedState),
	);
	check(
		"focus is in the query field, not left on the row",
		openedState.active === "command-palette-input",
		JSON.stringify(openedState),
	);
	const browse = await captureSettled(cdp, "palette-browse-dark");

	// Typed through the browser's own input pipeline into whatever the page has
	// focused — the query field, which the assertion above just proved.
	await cdp.send("Input.insertText", { text: "setting" });
	const query = await cdp.evaluate(
		"document.querySelectorAll('#command-palette-results [role=\"option\"]').length",
	);
	note("rows the query admitted", query);
	check(
		"typing in the field narrows the list",
		typeof query === "number" && query > 0,
		`${query} rows`,
	);
	const filtered = await captureSettled(cdp, "palette-query-dark");

	// Escape, dispatched as a real key event rather than by calling the handler.
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
	}
	const afterEscape = await cdp.evaluate(
		"({ dialog: Boolean(document.querySelector('[data-tour-tag=\"command-palette-dialog\"]')), focusReturned: document.activeElement?.hasAttribute('data-command-palette-trigger') === true, active: document.activeElement?.tagName ?? null })",
	);
	note("after Escape", JSON.stringify(afterEscape));
	check("Escape closed the palette", afterEscape.dialog === false);
	check(
		"focus went back to the row that opened it",
		afterEscape.focusReturned === true,
		JSON.stringify(afterEscape),
	);
	const dismissed = await captureSettled(cdp, "palette-dismissed-dark");

	/*
	 * The panel rows, and why this run has none.
	 *
	 * `/info`, `/usage`, `/analytics` and `/session` are presented by the CHAT PANE,
	 * whose adapters need that pane's session handle, command catalogue and rebind
	 * path - so the palette does not open them, it ASKS (`chat-panel-request-store`)
	 * and the pane answers. This run has no backend, so the chat route paints its
	 * connecting state with no pane behind it, and the palette offers no panel row at
	 * all: a row there would close the palette and open nothing. That is the gate
	 * working, not a capture missing, and the assertion says so rather than leaving a
	 * reader to wonder why `provider usage` finds nothing.
	 *
	 * The panels themselves are exercised against a live backend in the QA pass; no
	 * driver scene can reach them, and pretending otherwise would mean pointing this
	 * harness at the operator's own daemon.
	 */
	await verb(cdp, "press", "[data-command-palette-trigger]");
	await cdp.send("Input.insertText", { text: "provider usage" });
	const offline = await cdp.evaluate(
		"({ palette: Boolean(document.querySelector('[data-tour-tag=\"command-palette-dialog\"]')), rows: document.querySelectorAll('#command-palette-results [role=\"option\"]').length, text: (document.querySelector('[data-tour-tag=\"command-palette-dialog\"]')?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) })",
	);
	note("a panel query with no pane to present it", JSON.stringify(offline));
	check(
		"no panel row is offered while no pane can present one",
		offline.palette === true && offline.rows === 0,
		JSON.stringify(offline),
	);

	const frames = [before, railLight, browse, filtered, dismissed];
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
	/*
	 * The pair has to be two renders. The same check `--scene states` makes, for
	 * the same reason: a before/after that is one frame written twice is exactly
	 * what once shipped as `chat-light.png` being a byte copy of `chat-dark.png`.
	 */
	check(
		"the rail frame and the palette frame are different renders",
		!readFileSync(before.path).equals(readFileSync(browse.path)),
		`${before.bytes}B vs ${browse.bytes}B`,
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
			NO_HANDLER_REGISTERED.test(refused),
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
	const armedLines = driverLines.filter((line) => ARMED_LINE.test(line));
	results.push(
		refusalExpected
			? check(
					`${prefix}: the launch refused the driver out loud`,
					armedLines.length === 0 &&
						NOT_AN_OPT_IN.test(driverLines.join(" / ")) &&
						DRIVER_STAYED_OFF.test(driverLines.join(" / ")),
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
				ARMED_LINE.test(log),
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
	const deadApiUrl = `http://127.0.0.1:${deadApiPort}`;
	/*
	 * A named backend REPLACES the dead port in the scratch `.env` — the app's own
	 * transport then uses it — and the run refuses to start without the bearer the
	 * backend was started with, rather than booting an app that answers "offline"
	 * for a reason the run would have to guess.
	 */
	const apiUrl = BACKEND ?? deadApiUrl;
	if (BACKEND && !process.env.LOCAL_OPERATOR_DESKTOP_TOKEN) {
		say(
			"--backend needs LOCAL_OPERATOR_DESKTOP_TOKEN in this script's environment: export it from the backend this run started, and never pass it as an argument",
		);
		process.exit(2);
	}
	APP_API_URL = apiUrl;
	writeAppCwdEnv();
	if (BACKEND_RECORDS) {
		const records = join(CONFIG_DIR, "run", "serve");
		mkdirSync(records, { recursive: true });
		let copied = 0;
		for (const entry of readdirSync(BACKEND_RECORDS)) {
			if (!entry.endsWith(".json")) continue;
			copyFileSync(join(BACKEND_RECORDS, entry), join(records, entry));
			copied += 1;
		}
		say(
			`  serve records ${copied} copied from ${BACKEND_RECORDS}   (the app admits a daemon only when a record describes it)`,
		);
	}

	say("local-operator-ui renderer driver");
	say(`  repo          ${ROOT}`);
	say(`  scratch       ${SCRATCH}`);
	say(`  frames        ${FRAMES}`);
	say(`  app cwd       ${APP_CWD}   (scratch: the repo's .env is not read)`);
	say(
		BACKEND
			? `  backend url   ${apiUrl}   (--backend: a live isolated backend this run owns)`
			: `  backend url   ${apiUrl}   (dead port; the run cannot reach a backend)`,
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
	say(
		`  electron pin  ${runtime.pinned}   (package.json optionalDependencies)`,
	);
	const onThePinnedRuntime = check(
		"the harness is driving the Electron this branch pins",
		runtime.installed === runtime.pinned,
		`installed ${runtime.installed} at ${ELECTRON_BIN}, pinned ${runtime.pinned}`,
	);
	/*
	 * AND IT STOPS HERE, before the first boot, when the answer is no.
	 *
	 * WHY A FAILING CHECK WAS NOT ENOUGH: a FAIL increments the counter and the run
	 * carried on, so a worktree on a stale shared `node_modules` still booted, still
	 * captured and still left a pair in `--out` — it simply exited non-zero. That is
	 * the defect the pin exists to prevent wearing the fix's clothes: the frames in
	 * the directory look exactly like evidence, and whoever reached for them is
	 * looking at a directory, not at an exit code. Committed frames are only
	 * reproducible on the runtime that made them (a 35.x build renders this window as
	 * a 1380x872 viewport against 44.3.0's 1380x868, and every pixel hash differs), so
	 * the strong property is that an unpinned tree cannot populate a frames directory
	 * AT ALL. Nothing has booted at this point, so refusing costs nothing but the
	 * scratch tree this run just created.
	 */
	if (!onThePinnedRuntime) {
		say(
			`\n[refusing] this tree is not on the pinned runtime (${runtime.installed} installed, ${runtime.pinned} pinned).`,
		);
		say(
			"            Nothing was booted and no frame was captured. Reinstall with",
		);
		say("            `pnpm install --frozen-lockfile` and run this again.");
		if (CLEAN && !KEEP) rmSync(SCRATCH, { recursive: true, force: true });
		else say(`            scratch: ${SCRATCH}`);
		process.exit(1);
	}

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
				ARMED_LINE.test(await readAppLog(handle)),
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
			if (BACKEND) {
				/*
				 * With a live backend the isolation claim is stated DIRECTLY instead of by
				 * proxy. The dead-port shape asserts "no connection to the URL the renderer
				 * was built with", which is only an isolation claim because that URL is
				 * the operator's own backend; here the renderer's built URL is this run's
				 * backend, so the two halves are asked separately: the app DOES reach the
				 * backend this run started, and it reaches NOTHING else — least of all the
				 * operator's default address, which is what a careless build would leave
				 * inlined.
				 */
				check(
					"the renderer was built against the backend this run started",
					hello.apiBaseUrl === BACKEND,
					`the renderer reports ${hello.apiBaseUrl}, --backend is ${BACKEND} — build with VITE_LOCAL_OPERATOR_API_URL=${BACKEND}`,
				);
				const mine = await connectionsTo(handle.pid, BACKEND);
				const theirs = await connectionsTo(handle.pid, OPERATOR_BACKEND_URL);
				if (mine.measured && theirs.measured) {
					check(
						`the app holds a connection to this run's backend (${BACKEND})`,
						mine.matches.length > 0,
						mine.matches.join("\n") ||
							"no connection: the app's transport is not reaching the backend this run started",
					);
					check(
						`the app holds NO connection to the operator's own backend (${OPERATOR_BACKEND_URL})`,
						theirs.matches.length === 0,
						theirs.matches.join("\n") || "no connection",
					);
				} else {
					note(
						"isolation probe unavailable",
						mine.measured ? theirs.detail : mine.detail,
					);
				}
			} else {
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
			}
			if (SEED_ONBOARDING_COMPLETE) {
				await seedOnboardingComplete(cdp);
				await waitForBridge(cdp);
				note(
					"profile seeded",
					"onboarding-storage marks the modal complete, so the app is an existing user rather than a first-run one",
				);
			}
			if (SCENE === "states") await sceneStates(cdp);
			else if (SCENE === "new-chat") await sceneNewChat(cdp);
			else if (SCENE === "palette") await scenePalette(cdp);
			else if (SCENE === "browser-pane") await sceneBrowserPane(cdp);
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
	say(
		`app log: ${join(SCRATCH, GATE_CHECK ? "app-armed.log" : "app-scene.log")}`,
	);

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
