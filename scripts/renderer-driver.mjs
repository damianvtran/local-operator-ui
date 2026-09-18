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
 *   --scene <states|new-chat|settings-model|settings-fields|palette|browser-pane|browser-mark|mentions|canvas-freshness|none>
 *                          which built-in scene to run (default: states)
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
	realpathSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
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

function check(label, ok, detail, observed) {
	if (!ok) failures += 1;
	const status = ok ? "PASS" : "FAIL";
	/*
	 * `detail` says what went WRONG, so it is printed only when something did.
	 * It used to print unconditionally, which put a failure explanation on a PASS
	 * line - a reader grepping the log for the reason a check failed could not
	 * tell the two apart, and the tell was the sentence itself (QA round 1, Q3).
	 * What a PASS observed belongs in `observed`, which is where a check states
	 * the thing it actually read rather than the thing it would have said.
	 */
	const extra = ok ? observed : detail;
	say(`[${status}] ${label}${extra === undefined ? "" : `\n        ${extra}`}`);
	record(label, `[${status}] ${extra ?? detail ?? ""}`);
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

/**
 * Wait a moment for this run's processes to go, then kill what is left.
 *
 * WHY A WAIT AND A KILL RATHER THAN A SINGLE LOOK. A renderer helper can outlive
 * its browser process by a moment - the app is SIGTERMed, the helper re-parents
 * to launchd before it notices, and it is gone a second later - and a leaked one
 * sits on the operator's screen for as long as nobody looks. Measured on this
 * scene's own run: one `Electron Helper (Renderer)` with this run's
 * `--user-data-dir` on its command line, seconds after the app was stopped and
 * re-parented to pid 1. So the reap is bounded (five seconds), and it escalates
 * by EXACT PID - never by pattern, because a `pkill` would take the operator's
 * own running app with it - and the caller still reports what it had to kill, so
 * a rig that starts leaking loudly keeps saying so.
 */
async function reapStrays({ graceMs = 5000 } = {}) {
	const started = Date.now();
	for (;;) {
		const seen = thisRunsProcesses();
		const pids = seen.lines
			.map((line) => Number(line.trim().split(/\s+/)[0]))
			.filter((pid) => Number.isInteger(pid) && pid > 0);
		if (pids.length === 0) {
			return { killed: [], waitedMs: Date.now() - started };
		}
		if (Date.now() - started > graceMs) {
			for (const pid of pids) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					// Already gone between the listing and the kill.
				}
			}
			return { killed: pids, waitedMs: Date.now() - started };
		}
		await wait(250);
	}
}

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
	 * A SECOND, SEPARATE port for the MAIN process's Node inspector.
	 *
	 * Nothing about the app's behaviour changes with it - it is the same switch a
	 * Node process takes - and what it buys is the only instrument this harness has
	 * for the claims about TIME: the probe counts are `fs` calls main itself makes,
	 * and main is the one process a page-level wrapper cannot reach (see
	 * `CdpClient.attachNode`). It is a distinct port from the renderer's own
	 * `--remote-debugging-port` because they are two different debuggers on two
	 * different targets, and the run asserts which one it attached to.
	 */
	const inspectPort = await pickFreePort();
	if (await isListening(inspectPort))
		throw new Error(`picked inspect port ${inspectPort} is in use`);

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
			`--inspect=${inspectPort}`,
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
		inspectPort,
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

/**
 * Let this run's backend be framed, in the BUILD OUTPUT only.
 *
 * WHY THIS IS NEEDED AT ALL, and why it is not a change to the app. The renderer's
 * CSP is a meta tag in `src/renderer/index.html`, and its `frame-src` names
 * `http://localhost:1111` and `http://127.0.0.1:1111` - the operator's own
 * backend. A driver run points the app at an ISOLATED backend on a port picked
 * for it, so the HTML viewer's iframe is refused before a request is ever made:
 * measured on this scene's first attempt, the pane painted blank and the
 * renderer's request log stayed empty, which looks exactly like "the viewer did
 * not re-read the file".
 *
 * The accommodation is the one this repo's `mentioned-files-app` rig records for
 * its media frames: the directive is widened in the BUILD OUTPUT (`out/` is
 * gitignored) and `src/` is untouched, so no committed file knows this harness
 * exists. It is applied only when `--backend` was given, it says what it did in
 * the run's own output, and the run asserts the app is talking to that backend
 * and no other.
 */
function widenCspForBackend(backendUrl) {
	const file = join(ROOT, "out/renderer/index.html");
	if (!existsSync(file)) return "no built renderer to widen";
	const origin = backendUrl.replace(/\/$/, "");
	const before = readFileSync(file, "utf8");
	if (before.includes(origin)) return `already widened for ${origin}`;
	const widened = before
		.replace(
			/frame-src ([^"]*?)"/,
			(_m, list) => `frame-src ${list.trim()} ${origin}"`,
		)
		.replace(
			/media-src ([^"]*?)"/,
			(_m, list) => `media-src ${list.trim()} ${origin}"`,
		);
	if (widened === before) return "no frame-src/media-src directive to widen";
	writeFileSync(file, widened);
	return `out/renderer/index.html: ${origin} added to frame-src and media-src (build output only; src/ untouched)`;
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
		/*
		 * Every URL the target requested, for the one claim in the canvas-freshness
		 * scene that is ABOUT a request rather than about the page: the HTML viewer
		 * renders a backend URL in an iframe, so "the fresh bytes reached the screen"
		 * is observable as a NEW request for that URL, and nothing else is. The
		 * iframe is cross-origin from the app, so its DOM cannot be read back - the
		 * request is the honest instrument (`Network.enable` is asked for below).
		 */
		this.requests = [];
		socket.addEventListener("message", (event) => {
			let message = null;
			try {
				message = JSON.parse(event.data);
			} catch {
				return;
			}
			if (message.method === "Network.requestWillBeSent") {
				this.requests.push({
					at: Date.now(),
					url: message.params?.request?.url ?? "",
				});
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
				client.send("Network.enable").catch(() => {});
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
	 * Attach to the app's MAIN process, over its Node inspector.
	 *
	 * WHY THIS EXISTS AT ALL, and why the page could not do it instead. The canvas
	 * freshness checks are claims about TIME, and the instrument that makes them
	 * measurable is a count of the probes the app made. The renderer cannot be
	 * counted from the page: `window.api` is a `contextBridge` object, so a wrapper
	 * assigned over one of its properties is silently ignored (measured - the first
	 * version of this scene installed one and read zero for a run in which probes
	 * demonstrably happened), and Electron 44 never replays
	 * `Runtime.executionContextCreated`, so the preload's own `ipcRenderer` cannot
	 * be reached either.
	 *
	 * Main has neither problem: it is a Node process with a Node inspector, and the
	 * counter below wraps the `fs` calls the probe handler itself makes. The run
	 * VALIDATES it before measuring anything (a probe issued from the renderer must
	 * appear in the log), so a later zero is a zero rather than a broken wrapper.
	 *
	 * The inspector is launched for this run only (`--inspect=<port>`), on a port
	 * picked free for it, and the app is otherwise untouched: no switch changes what
	 * the app does, only what can be observed about it.
	 */
	static async attachNode(port, timeoutMs = 60_000) {
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
				const client = new CdpClient(socket);
				client.send("Runtime.enable").catch(() => {});
				return client;
			}
			if (Date.now() - started > timeoutMs) {
				throw new Error(
					`no main-process inspector target on port ${port} after ${timeoutMs}ms`,
				);
			}
			await wait(250);
		}
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
async function createBackendSession(cwd = SCRATCH) {
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
			cwd,
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
		/*
		 * THE TITLES, MEASURED RATHER THAN INFERRED (design review round 2, D1). The
		 * floor is a promise about the box the title span gets, so it is read from that
		 * box: the narrow tier's rungs were raised for exactly this number, and a frame
		 * can show a squeezed title while a check that only counts rows stays green.
		 */
		const titles = rows.map((row) => {
			const title = row.querySelector('[data-tour-tag="browser-tab-title"]');
			return title
				? {
						text: title.textContent.trim(),
						width: Math.round(title.getBoundingClientRect().width),
					}
				: null;
		});
		return {
			rows: rows.length,
			whole,
			titles,
			narrowestTitle: Math.min(
				...titles.filter(Boolean).map((title) => title.width),
			),
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
/**
 * The conversation's browser, from its own sidebar row (design R2, R1).
 *
 * WHAT ONLY THIS SCENE CAN SHOW. Three claims meet on one row, and none of them is
 * visible in a Storybook frame: that a tab opened in a conversation is ATTRIBUTED to it
 * (R1, the fix that made "New tab" put a tab where the user can find it again), that the
 * row then carries a MARK saying so (R2), and that pressing that mark opens the pane
 * scoped to that conversation (open question 7 — the lens is set, not inherited). The
 * three are one flow: each step's preconditions are the previous step's result, so a
 * frame of any one of them alone would leave the other two to trust.
 *
 * IT NEEDS A BACKEND, like the pane scene beside it: the chat route's sidebar list is
 * behind `session_catalogue`, so without one there is no row to press and the scene says
 * so rather than pretending.
 */
async function sceneBrowserMark(cdp) {
	note(
		"scene",
		"the conversation mark: absent, then drawn from a real tab, then the press that opens the pane scoped to it",
	);
	await verb(cdp, "press", { selector: '[data-tour-tag="nav-item-chat"]' });
	await wait(400);
	await verb(cdp, "press", { selector: '[data-tour-tag="chat-all-chats"]' });
	await wait(400);
	await verb(cdp, "press", { selector: '[data-tour-tag="chat-session-row"]' });
	await wait(700);
	const conversation = await cdp.evaluate(
		`(() => document.querySelector('[data-chat-row][aria-current="page"]')?.getAttribute('title') ?? location.hash)()`,
	);
	note("the conversation the walk opened", String(conversation));
	/** The conversation's session id, which is the key every mark and every projection
	 * field is written under: `#/chat/<id>` is the route's own spelling of it. */
	const sessionId = await cdp.evaluate(
		"(() => location.hash.split('/')[2] ?? '')()",
	);

	const absent = await markReading(cdp);
	/** The walked conversation's own mark, read BEFORE anything is open in it: the pair of
	 * readings below (this one and the one after a tab exists) is what pins the label's
	 * grammar without this scene having to know how the app spells the row's name. */
	const quietLabel =
		absent.marks.find((mark) => mark.sessionId === sessionId)?.label ?? "";
	check(
		"EVERY conversation row draws the mark, and a conversation with nothing open draws it in its quiet state (R2's first row; review round 1, D2/A4)",
		absent.marks.length > 0 &&
			absent.rows > 0 &&
			absent.marks.length === absent.rows &&
			absent.marks.every(
				(mark) =>
					mark.label.startsWith('Open the browser for "') &&
					mark.label.endsWith('"'),
			) &&
			quietLabel !== "" &&
			!quietLabel.includes(" — "),
		`${absent.marks.length} mark(s) on ${absent.rows} row(s): ${JSON.stringify(absent.marks)}`,
	);
	const absentFrame = await captureSettled(cdp, "browser-mark-absent");
	note("frame", JSON.stringify(absentFrame));

	// The pane, from the header, then a tab opened inside it — the user's own path.
	await verb(cdp, "press", {
		selector: '[data-tour-tag="browser-pane-trigger"]',
	});
	await wait(700);
	/** The pool before the press, so the attribution below is about ONE new tab rather
	 * than about the whole pool. Needed because the host opens a blank tab of its own on
	 * a fresh profile (`host.ts:803`: a first run gets one unattributed tab), which is
	 * why this check used to require a pool of exactly one and could never pass (review
	 * round 1, Q1a). */
	const poolBefore = JSON.parse(
		await cdp.evaluate(
			"window.api.browser.state().then((s) => JSON.stringify(s.tabs.map((tab) => tab.tabId)))",
		),
	);
	await verb(cdp, "press", {
		selector: '[data-tour-tag="browser-surface-new-tab"]',
	});
	await wait(1500);
	const opened = await cdp.evaluate(
		`window.api.browser.state().then((s) => JSON.stringify({ tabs: s.tabs.map((tab) => ({ id: tab.tabId, sessionId: tab.sessionId })), scope: document.querySelector('[data-tour-tag="browser-pane-scope-conversation"]')?.getAttribute('data-state') }))`,
	);
	const openedTabs = JSON.parse(opened);
	/** The tab this press created: the one in the pool that was not there before. */
	const createdTab = openedTabs.tabs.find(
		(tab) => !poolBefore.includes(tab.id),
	);
	check(
		"a tab opened from the pane belongs to the conversation the pane is for (R1 — the whole point of the attribution fix)",
		createdTab !== undefined &&
			openedTabs.tabs.length === poolBefore.length + 1 &&
			typeof createdTab.sessionId === "string" &&
			createdTab.sessionId === sessionId &&
			openedTabs.scope === "active",
		`created ${JSON.stringify(createdTab)}; pool ${JSON.stringify(openedTabs.tabs)} (was ${JSON.stringify(poolBefore)}), scope=conversation is ${openedTabs.scope}`,
	);

	// Close the pane, so the mark is read on a resting list rather than beside the
	// surface that explains it.
	await verb(cdp, "press", {
		selector: '[data-tour-tag="browser-pane-close"]',
	});
	await wait(700);
	const drawn = await markReading(cdp);
	const walked = drawn.marks.find((mark) => mark.sessionId === sessionId);
	check(
		"with a tab open in it, that row's mark counts it — and the other rows stay quiet (R2)",
		walked !== undefined &&
			walked.label === `${quietLabel} — 1 tab` &&
			drawn.marks.filter((mark) => mark.label.includes("tab")).length === 1,
		`quiet ${JSON.stringify(quietLabel)} then ${JSON.stringify(walked)}; all ${JSON.stringify(drawn.marks)}`,
	);
	const drawnFrame = await captureSettled(cdp, "browser-mark-drawn");
	note("frame", JSON.stringify(drawnFrame));

	// The press: select + set the lens + open, all three from one control.
	await verb(cdp, "press", { selector: "[data-browser-mark]" });
	await wait(900);
	const after = await cdp.evaluate(`(() => ({
		pane: Boolean(document.querySelector('[data-tour-tag="browser-pane"]')),
		scope: document.querySelector('[data-tour-tag="browser-pane-scope-conversation"]')?.getAttribute('data-state'),
		allScope: document.querySelector('[data-tour-tag="browser-pane-scope-all"]')?.getAttribute('data-state'),
		scopeKey: document.querySelector('[data-tour-tag="browser-pane-scope-track"]')?.getAttribute('data-scope'),
		tabs: [...document.querySelectorAll('[data-tour-tag="browser-tab"]')].length,
	}))()`);
	check(
		"the press opens the pane with the lens ON that conversation, not on whatever it was left showing (open question 7)",
		after.pane === true &&
			after.scope === "active" &&
			after.allScope === "inactive" &&
			after.tabs === 1,
		`pane=${after.pane}, conversation lens=${after.scope}, all lens=${after.allScope}, ${after.tabs} row(s) in the scoped strip`,
	);
	const pressedFrame = await captureSettled(cdp, "browser-mark-pressed");
	note("frame", JSON.stringify(pressedFrame));

	/*
	 * THE DISCLOSURE STATE, READ IN THE STATE THAT MAKES IT INTERESTING (design review
	 * round 2, U8). The mark toggles (U6, ruled), so its accessible state has to name
	 * which of the two things the next press does. The control that read
	 * `aria-expanded="false"` over "Open the browser for …" one press ago must read
	 * `"true"` over the close's own words now, and the two labels must differ in the verb
	 * and nothing else — the counts are a fact about the conversation, not about the pane.
	 * Read at the same selector the press used, so the words, the attribute and the press
	 * cannot describe different states.
	 */
	const openMark = await markReading(cdp);
	const markedOpen = openMark.marks.find(
		(mark) => mark.sessionId === sessionId,
	);
	const closeLabel = walked.label.replace(
		"Open the browser",
		"Close the browser",
	);
	check(
		'while the pane is open on that conversation its mark says so in both channels: aria-expanded="true" and the close\u2019s own words (U8)',
		markedOpen !== undefined &&
			markedOpen.expanded === "true" &&
			markedOpen.label === closeLabel,
		`expanded ${JSON.stringify(markedOpen?.expanded ?? null)}, label ${JSON.stringify(markedOpen?.label ?? null)} (expected ${JSON.stringify(closeLabel)}); the closed reading it replaces was ${JSON.stringify(walked)}`,
	);

	/*
	 * THE SECOND PRESS IS THE TOGGLE (design review round 2, U6, ruled). A press on the
	 * mark while the pane is already open ON THAT CONVERSATION closes it — the state a
	 * second press used to leave untouched, which is indistinguishable from a press that
	 * never registered. Read from the DOM rather than inferred, and read at the same
	 * selector the check above used, so the two readings are one surface.
	 */
	await verb(cdp, "press", { selector: "[data-browser-mark]" });
	await wait(900);
	const toggled = await cdp.evaluate(
		`(() => ({
			pane: Boolean(document.querySelector('[data-tour-tag="browser-pane"]')),
			mark: Boolean(document.querySelector('[data-browser-mark]')),
			strip: document.querySelectorAll('[data-tour-tag="browser-tab"]').length,
		}))()`,
	);
	check(
		"and a second press on the same mark CLOSES the pane it opened (U6)",
		toggled.pane === false && toggled.mark === true,
		`after the toggle: ${JSON.stringify(toggled)}`,
	);
	const closedMark = await markReading(cdp);
	const markedClosed = closedMark.marks.find(
		(mark) => mark.sessionId === sessionId,
	);
	check(
		'and the mark goes back with it: aria-expanded="false" and the open\u2019s own words again (U8)',
		markedClosed !== undefined &&
			markedClosed.expanded === "false" &&
			markedClosed.label === walked.label,
		`expanded ${JSON.stringify(markedClosed?.expanded ?? null)}, label ${JSON.stringify(markedClosed?.label ?? null)} (expected ${JSON.stringify(walked.label)})`,
	);

	note(
		"not shown",
		"the mark's loading and approvals states: both need a live agent leg and a live request, which the browser-chrome proof drives against the real host rather than through the chat route",
	);
}

/** Every mark on the sidebar, with the words each one would announce, the conversation
 * it belongs to, and how many CONVERSATION rows the list holds — so a check can say "a
 * mark per conversation" rather than "one mark".
 *
 * `[data-chat-row]` ALONE IS NOT "the conversations": the agent, team, draft and palette
 * rows carry it too, so the count is taken over `chat-session-row` — the tour tag the two
 * things this check compares share, the row `sessionRow` renders and the mark inside it.
 * That distinction is what this scene got wrong on its first driven runs: 2 marks against
 * 12 `data-chat-row` elements, ten of them the agent catalogue, and then 2 against 6 once
 * entity rows were excluded (the rest were draft and palette rows).
 */
async function markReading(cdp) {
	return await cdp.evaluate(`(() => {
		const marks = [...document.querySelectorAll('[data-browser-mark]')];
		const rows = [...document.querySelectorAll('[data-tour-tag="chat-session-row"]')];
		return {
			rows: rows.length,
			marks: marks.map((mark) => ({
				sessionId: mark.getAttribute('data-browser-mark') ?? '',
				label: mark.getAttribute('aria-label') ?? '',
				/** The disclosure state (design review round 2, U8): which of the two things the
				 * next press does. Read as the ATTRIBUTE rather than as a boolean so an absent
				 * one is distinguishable from the string "false" — the defect U8 filed was
				 * that the control carried none at all. */
				expanded: mark.getAttribute('aria-expanded'),
			})),
		};
	})()`);
}

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
async function pressChord(
	cdp,
	{ key, code, virtualKeyCode, modifiers = 0, commands },
) {
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key,
			code,
			modifiers,
			windowsVirtualKeyCode: virtualKeyCode,
			nativeVirtualKeyCode: virtualKeyCode,
			/*
			 * An EDITING chord needs Chromium's own editing command. A bare
			 * modifier+key pair reaches the page and performs no edit, so `Cmd+A`
			 * selected nothing and the next insert appended at the caret — measured
			 * here, where it turned the scene's query into a concatenation (QA round
			 * 2, Q5).
			 */
			...(type === "keyDown" && commands ? { commands } : {}),
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
		/*
		 * THE DETAIL STATES THE READING, NOT THE FAILURE (QA round 2, Q3). It used to be a
		 * sentence written for the failing branch — "the trigger is absent even though a
		 * backend answered" — which is what a passing run also printed under its own
		 * `[PASS]`, so the transcript's evidence line described a state the run had just
		 * refuted. Same class of defect as the ones this change already fixed: a check's
		 * own line has to be true whichever way it came out.
		 */
		`trigger present: ${triggerPresent} (the press below asserts the pane it opens, so an absent trigger here would prove nothing about it)`,
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
		/*
		 * THE WAIT'S PREDICATE IS THE CHECK'S OWN CONDITION, and it has to be: this
		 * conversation holds TWO live requests, so the settled state after the press is
		 * two chips. Waiting for one - the state that is briefly true between the two
		 * projections - returned a one-chip tray from the first read and then failed the
		 * check below on a race, and on a slower run it could not be satisfied at all
		 * and burned the whole timeout before asserting anyway (review round 2, MINOR 1).
		 */
		const scoped = await readUntil(
			() => readTray(cdp),
			(tray) => tray.chips.length === 2,
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
		/*
		 * WHAT THE RAISED NARROW RUNGS CHANGED HERE, and it is the cost the ruling was
		 * accepted with (design review round 2, D1, option 1): four agent tabs no longer fit
		 * the pane's own 640px WHOLE, because the floor a one-chip row needs there is 192px
		 * inactive and 260px active rather than 132/120. The four-tab state this used to
		 * assert as "not overflowing" is now the state the pinned control exists for, so the
		 * check asserts the new arithmetic instead of the old: the rows overflow, the control
		 * is on screen, and the count it carries is the difference.
		 */
		check(
			"every title in the pane's own strip keeps the 85px floor the ruling was written for (D1)",
			four.rows >= 4 &&
				Number.isFinite(four.narrowestTitle) &&
				four.titles.filter(Boolean).every((title) => title.width >= 85),
			`measured at the pane's own width: ${JSON.stringify(four.titles)}`,
		);
		check(
			"four tabs overflow the pane's OWN width now, and the pinned control is what makes them reachable (D1's accepted cost)",
			four.rows >= 4 &&
				four.whole < four.rows &&
				four.control !== null &&
				four.control.text.replace(/[^0-9]/g, "") ===
					String(four.rows - four.whole),
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
				/^\d+$/.test(six.control.text.trim()) &&
				// THE WORDS ARE `not shown` (design review round 2, D10): the count is measured
				// from the rows' boxes, so a row clipped at its right edge is counted, and
				// "more tabs" read as a count of tabs with no visible trace at all.
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

	/*
	 * 8. A TAB OPENED FROM THIS CONVERSATION BELONGS TO IT (design R1).
	 *
	 * The pane's own `New tab` used to create a tab with `sessionId: null`, and null
	 * is a tab no conversation's scope will ever show — the field the scope filter
	 * reads (`tabsInScope`) was the one field the control did not set. All three
	 * user-facing ways to open a tab did it, so the control that exists INSIDE a
	 * conversation produced a tab that conversation could not see.
	 *
	 * This is the pane's own control, pressed for real, read out of the same
	 * projection the pane reads. The strip's `+` is the control: the empty state's
	 * button only renders when the conversation has no tabs, which is not this run's
	 * state by the time this step is reached.
	 *
	 * The step re-opens the pane first: the block above closed it to read the
	 * caret's return, which is the state a user's last action left behind.
	 */
	if (conversation !== null) {
		const reopen = await verb(cdp, "state");
		if (reopen.browserPaneOpen !== true) {
			await verb(cdp, "press", {
				selector: '[data-tour-tag="browser-pane-trigger"]',
			});
		}
		// The pane's own lens, so the tab this opens is one the pane MUST show rather
		// than one that merely exists in the pool.
		await verb(cdp, "press", {
			selector: '[data-tour-tag="browser-pane-scope-conversation"]',
		});
		const tabsNow = () =>
			cdp.evaluate(
				"window.api.browser.state().then((state) => (state?.tabs ?? []).map((tab) => ({ tabId: tab.tabId, sessionId: tab.sessionId ?? null, owner: tab.owner })))",
			);
		const before = await tabsNow();
		/*
		 * THE LABEL IS THE DISCLOSURE (R1's copy rule, and the reason the two hosts
		 * differ): a `+` labelled `New tab` in both would leave where the tab lands to
		 * be discovered by switching the scope and finding it gone. Read off the
		 * control rather than out of the source, because the claim is about what a
		 * screen reader announces.
		 */
		const newTabLabel = await cdp.evaluate(
			`document.querySelector('[data-tour-tag="browser-new-tab"]')?.getAttribute('aria-label') ?? null`,
		);
		await verb(cdp, "press", {
			selector: '[data-tour-tag="browser-new-tab"]',
		});
		const opened = await readUntil(
			tabsNow,
			(tabs) => tabs.length === before.length + 1,
		);
		const created = opened.find(
			(tab) => !before.some((was) => was.tabId === tab.tabId),
		);
		const strip = await cdp.evaluate(
			`Array.from(document.querySelectorAll('[data-tab-id]')).map((node) => Number(node.getAttribute('data-tab-id')))`,
		);
		const frame = await captureSettled(cdp, "browser-pane-new-tab-attributed");
		note(
			"new tab in the pane's conversation scope",
			JSON.stringify({
				conversation,
				newTabLabel,
				before,
				opened,
				created,
				strip,
			}),
		);
		check(
			"a tab the user opens in a conversation is attributed to it, and the strip in that scope shows it (R1)",
			created !== undefined &&
				created.sessionId === conversation &&
				created.owner === "user" &&
				strip.includes(created.tabId),
			`conversation ${conversation}; created ${JSON.stringify(created)}; strip ${JSON.stringify(strip)}`,
		);
		check(
			"and the control said where the tab would land",
			newTabLabel === "New tab in this conversation",
			`aria-label ${JSON.stringify(newTabLabel)}`,
		);
		note("frame", JSON.stringify(frame));
	} else {
		note(
			"the attribution check not run",
			"no conversation is open, so there is nothing for a new tab to be attributed to",
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
 * `settings-model`: the settings registry's provider and model fields, with
 * their searchable list OPEN.
 *
 * ## Why this scene exists, and why no story can carry it
 *
 * These two rows shipped as bare `<Input>`s with no placeholder and no
 * affordance, and the whole of the operator's report is about what they become:
 * a field that OFFERS the providers and models the app actually has. The two
 * claims that matter are not visual and not fixture-shaped:
 *
 *   1. the provider list is the WHOLE login registry — every provider the app
 *      knows, signed in or not — because `hosting` is where a user names the
 *      provider they intend to boot on, which may be one they have not logged
 *      into yet;
 *   2. the model list comes from `models.catalogue`, so it is the same rows the
 *      `/model` picker shows.
 *
 * Both come from the desktop ops, so this scene needs a live, ISOLATED backend
 * (`--backend`, plus a renderer built against the same URL) and a scratch
 * profile whose onboarding wizard is already complete
 * (`--seed-onboarding-complete`): without the first the settings section paints
 * its offline surface, and without the second a first-run modal covers it.
 *
 * ## What it asserts that a frame cannot show
 *
 * - the placeholder, which is the one thing the row never had and which a
 *   pixel cannot be read for (the wire sends no `placeholder`, so it is
 *   supplied client-side from the row's source — see
 *   `features/settings/backend-setting-combos.ts`);
 * - that the list is OPEN (`aria-expanded`, a real `role="listbox"` in the DOM)
 *   and that the option rows are the ones the backend sent, counted;
 * - that typing narrows it, that Escape reverts the text, and that Enter on text
 *   matching nothing COMMITS it — the "suggestions assist, they do not
 *   constrain" contract, which is precisely the rule a combobox is most likely
 *   to break;
 * - that the row is never disabled while a list is unavailable, and that the
 *   stored value a listing does not contain is still rendered.
 *
 * ## What it does not prove
 *
 * The pixels of a FOCUS state: a `headless` window is never shown and cannot be
 * focused, so the field's focus ring is not what a user sees while typing (see
 * `docs/agent-driver.md`, "What it cannot prove"). Nothing here depends on it —
 * every assertion above is a DOM or state fact, not a ring.
 */

/** The row's own field, by the registry key it belongs to. */
const settingField = (key) =>
	`[data-setting-key="${key}"] input[role="combobox"]`;

/**
 * Poll a page expression until it is true, and report whether it ever was.
 *
 * A scene that sleeps a fixed interval instead is the shape that commits a
 * frame of the state before the change (or after it has gone) and calls it
 * evidence; every wait in this scene is therefore a predicate with a bound, and
 * the bound being hit is asserted rather than absorbed.
 */
async function waitForScene(cdp, expression, attempts = 150) {
	for (let i = 0; i < attempts; i++) {
		if ((await cdp.evaluate(expression)) === true) return true;
		await wait(20);
	}
	return false;
}

/**
 * Put the caret in a field.
 *
 * The PRESS below is still the pointer path a user takes, but a synthetic
 * pointer sequence cannot move focus — `dispatchEvent` does not activate an
 * element the way a real click does, which the palette scene records for the
 * same reason — so keystrokes sent through CDP's input pipeline would land on
 * nothing without this.
 */
async function focusField(cdp, selector) {
	return cdp.evaluate(`(() => {
		const input = document.querySelector(${JSON.stringify(selector)});
		if (!input) return false;
		input.focus();
		return document.activeElement === input;
	})()`);
}

/** What the row and its open list actually are, read from the page. */
async function readSettingField(cdp, key) {
	return cdp.evaluate(`(() => {
		const row = document.querySelector(${JSON.stringify(`[data-setting-key="${key}"]`)});
		if (!row) return { row: false };
		const input = row.querySelector('input[role="combobox"]');
		const list = document.querySelector('ul[role="listbox"]');
		return {
			row: true,
			value: input ? input.value : null,
			placeholder: input ? input.placeholder : null,
			ariaLabel: input ? input.getAttribute('aria-label') : null,
			describedBy: input ? input.getAttribute('aria-describedby') : null,
			expanded: input ? input.getAttribute('aria-expanded') : null,
			disabled: input ? input.disabled : null,
			listOpen: Boolean(list),
			/*
			 * The row's NAME, which is the option's whole identity: for a model it
			 * is the provider/model selector the row stores a bare id beside, and
			 * for a provider it is the registry's own name. Read off the name span
			 * rather than the row's whole text, because the row also carries a
			 * sub-line with the credential state and concatenating the two would
			 * make every assertion about the offered rows a substring match.
			 */
			/*
			 * This template is PAGE-SIDE source, so no backticks in a comment here.
			 * The rows the LISTING produced: the typed-text row carries
			 * role="option" as well, because the arrow keys reach it, and it is not
			 * a match - counting it made the no-match assertion "1 === 0" for every
			 * query (QA round 2, Q5). The data-combobox-row="typed" hook is what
			 * tells the two apart.
			 */
			options: list
				? Array.from(
						list.querySelectorAll(
							'[role="option"]:not([data-combobox-row="typed"])',
						),
					).map((node) => {
						const name = node.querySelector('span');
						return ((name ? name.textContent : node.textContent) || '')
							.replace(/\\s+/g, ' ')
							.trim();
					})
				: [],
			headings: list
				? Array.from(list.querySelectorAll('[role="presentation"]')).map((node) =>
						(node.textContent || '').replace(/\\s+/g, ' ').trim(),
					)
				: [],
		};
	})()`);
}

async function sceneSettingsModel(cdp) {
	const hello = await verb(cdp, "hello");
	const facts = await factsOf(cdp);
	note("facts (from main)", JSON.stringify(facts, null, 2));
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
	check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	/*
	 * The scene needs a backend, and says so rather than photographing the
	 * offline surface and calling it the feature: the whole of these rows is the
	 * options they offer, and with no daemon there are none.
	 */
	check(
		"this scene is running against a live, isolated backend",
		Boolean(BACKEND),
		"pass --backend <url> with the renderer built against the same URL, plus --seed-onboarding-complete",
	);
	if (!BACKEND) return [];

	/*
	 * The registry's own deep link, which is how a reader lands on this row from
	 * a search hit or the command palette — and the reason the control has to
	 * contain a real `<input>`: the reveal loop focuses
	 * `[data-setting-control] :is(input, …)` and scrolls the row into view, and
	 * the scroll sits in the SUCCESS branch, so a combobox whose editable part is
	 * not an input loses both the focus and the scroll with no error anywhere.
	 */
	await verb(cdp, "navigate", "/settings?setting=hosting");
	await verb(cdp, "setTheme", "localOperatorDark");
	/*
	 * Wait for the registry to arrive rather than for a fixed interval: the
	 * section is a React Query consumer, and a frame taken before it answers is a
	 * picture of the offline surface.
	 */
	const ready = await waitForScene(
		cdp,
		`Boolean(document.querySelector('[data-setting-key="hosting"] input[role="combobox"]'))`,
	);
	check(
		"the registry rendered, with the provider row as a combobox",
		ready === true,
		"no [data-setting-key=hosting] combobox appeared",
	);
	if (ready !== true) return [];

	const revealed = await cdp.evaluate(`(() => {
		const row = document.querySelector('[data-setting-key="hosting"]');
		const input = row ? row.querySelector('input[role="combobox"]') : null;
		if (!row || !input) return null;
		const box = row.getBoundingClientRect();
		return {
			focused: document.activeElement === input,
			onScreen: box.top >= 0 && box.bottom <= window.innerHeight,
			top: Math.round(box.top),
			viewport: window.innerHeight,
		};
	})()`);
	note("the deep link's landing", JSON.stringify(revealed));
	check(
		"the deep link focused the combobox's own input",
		revealed?.focused === true,
		`activeElement is the row's input: ${revealed?.focused}`,
	);
	check(
		"and scrolled the row into view",
		revealed?.onScreen === true,
		`row top ${revealed?.top} of ${revealed?.viewport}`,
	);

	const keystroke = async (key, code, virtualKeyCode) => {
		for (const type of ["keyDown", "keyUp"]) {
			await cdp.send("Input.dispatchKeyEvent", {
				type,
				key,
				code,
				windowsVirtualKeyCode: virtualKeyCode,
				nativeVirtualKeyCode: virtualKeyCode,
			});
		}
	};

	/* ---------------------------------------------------------------- */
	/* 1. The rows at rest                                               */
	/* ---------------------------------------------------------------- */

	const atRest = await readSettingField(cdp, "hosting");
	note("hosting at rest", JSON.stringify(atRest));
	check(
		"the provider field carries a placeholder, which is what these rows never had",
		atRest.placeholder === "Search providers",
		`placeholder is ${JSON.stringify(atRest.placeholder)}`,
	);
	check(
		"the field is named by the registry row's own label and described by its help",
		atRest.ariaLabel === "Default provider" &&
			typeof atRest.describedBy === "string" &&
			atRest.describedBy.startsWith("setting-help-hosting"),
		`aria-label=${JSON.stringify(atRest.ariaLabel)} aria-describedby=${JSON.stringify(atRest.describedBy)}`,
	);
	check(
		"an unset field is offered, not disabled",
		atRest.disabled === false && atRest.value === "",
		`disabled=${atRest.disabled} value=${JSON.stringify(atRest.value)}`,
	);
	const restFrame = await captureSettled(cdp, "settings-hosting-rest");

	/* ---------------------------------------------------------------- */
	/* 2. The list open: the whole login registry                        */
	/* ---------------------------------------------------------------- */

	const pressed = await verb(cdp, "press", settingField("hosting"));
	note("pressed the provider field", JSON.stringify(pressed));
	const focused = await focusField(cdp, settingField("hosting"));
	check("the provider field took the caret", focused === true, `${focused}`);
	/*
	 * Waits for ROWS, not merely for the popover: the list paints inside the
	 * gesture that asked for it, so a frame taken the moment the popover exists
	 * is a picture of a spinner or of an empty list — which is the state this
	 * whole change exists to remove.
	 */
	const opened = await waitForScene(
		cdp,
		`document.querySelectorAll('ul[role="listbox"] [role="option"]').length > 0`,
	);
	const openRead = await readSettingField(cdp, "hosting");
	note("hosting open", JSON.stringify(openRead));
	check(
		"pressing the field opened a real listbox",
		opened === true &&
			openRead.listOpen === true &&
			openRead.expanded === "true",
		`expanded=${openRead.expanded} list=${openRead.listOpen}`,
	);
	/*
	 * The centralised-login-state claim, as a number and two ids. Both halves
	 * matter: a provider with no credential must be OFFERED — a user may be about
	 * to sign into it, and `hosting` is where they name the provider they intend
	 * to boot on — and a local server must be offered too, described as needing
	 * no key rather than as connected.
	 */
	check(
		"the provider list is the whole login registry, not the signed-in subset",
		openRead.options.length >= 17 &&
			openRead.options.includes("DeepSeek") &&
			openRead.options.includes("Ollama"),
		`${openRead.options.length} rows; deepseek=${openRead.options.includes("DeepSeek")} ollama=${openRead.options.includes("Ollama")}`,
	);
	check(
		"the credential state is shown rather than used to filter",
		openRead.headings.includes("Needs sign-in") &&
			openRead.headings.includes("Needs a running server"),
		`headings: ${JSON.stringify(openRead.headings)}`,
	);
	const openFrame = await captureSettled(cdp, "settings-hosting-open");

	/* ---------------------------------------------------------------- */
	/* 3. Typing narrows it, Escape puts it back                          */
	/* ---------------------------------------------------------------- */

	await cdp.send("Input.insertText", { text: "oll" });
	const narrowed = await waitForScene(
		cdp,
		`document.querySelectorAll('ul[role="listbox"] [role="option"]').length < ${openRead.options.length}`,
	);
	const narrowedRead = await readSettingField(cdp, "hosting");
	note("hosting filtered", JSON.stringify(narrowedRead));
	check(
		"typing narrows the list to the rows whose name contains the query",
		narrowed === true &&
			narrowedRead.options.length > 0 &&
			narrowedRead.options.every((row) => /oll/i.test(row)),
		`${narrowedRead.options.length} rows: ${JSON.stringify(narrowedRead.options)}`,
	);
	const filteredFrame = await captureSettled(cdp, "settings-hosting-filtered");

	await keystroke("Escape", "Escape", 27);
	const dismissed = await waitForScene(
		cdp,
		`document.querySelector('ul[role="listbox"]') === null`,
	);
	const revertedRead = await readSettingField(cdp, "hosting");
	check(
		"the first Escape dismisses the list and reverts the text to the stored value",
		dismissed === true &&
			revertedRead.listOpen === false &&
			revertedRead.value === atRest.value,
		`value ${JSON.stringify(atRest.value)} -> ${JSON.stringify(revertedRead.value)}`,
	);

	/* ---------------------------------------------------------------- */
	/* 4. Picking a provider stores its ID and shows its NAME             */
	/* ---------------------------------------------------------------- */

	await focusField(cdp, settingField("hosting"));
	await cdp.send("Input.insertText", { text: "anthropic" });
	await waitForScene(
		cdp,
		`document.querySelectorAll('ul[role="listbox"] [role="option"]').length === 1`,
	);
	// The highlight is moved by a real key event, and Enter accepts it: the
	// pointer path is asserted above, the keyboard path here.
	await keystroke("ArrowDown", "ArrowDown", 40);
	await keystroke("Enter", "Enter", 13);
	const picked = await waitForScene(
		cdp,
		`(() => {
			const input = document.querySelector('[data-setting-key="hosting"] input[role="combobox"]');
			return Boolean(input) && input.value.startsWith("Anthropic");
		})()`,
	);
	const pickedRead = await readSettingField(cdp, "hosting");
	note("hosting after picking the Anthropic row", JSON.stringify(pickedRead));
	check(
		"picking a row shows the provider's NAME and closes the list",
		picked === true && pickedRead.listOpen === false,
		`value=${JSON.stringify(pickedRead.value)} list=${pickedRead.listOpen}`,
	);
	/*
	 * The stored value is asserted through what it DOES rather than read from the
	 * page, because the page shows the name: the model list beside it is scoped by
	 * the hosting row's DRAFT, and the only way it can be scoped to `anthropic/`
	 * rows is if the draft holds the bare id `anthropic`. That is the whole reason
	 * this control separates `option.id` from `option.name`, and the reason the
	 * scoping is draft-aware at all — the draft is dirty and unsaved.
	 *
	 * The predicate is the row's SAVE control, and it is read by its label rather
	 * than by "does this row contain a button". The old predicate was satisfied by
	 * any button at all — the clear affordance a picked value always renders, and
	 * the advanced-row disclosure chevron — so it passed on a row that had saved
	 * on select, which is the one thing it existed to rule out (QA round 1, Q2).
	 * `Save` is rendered only when the row is dirty (`backend-setting-row.tsx`),
	 * which is exactly the claim.
	 */
	const hostingButtons = await cdp.evaluate(
		`Array.from(document.querySelectorAll('[data-setting-key="hosting"] button')).map((b) => b.textContent.trim())`,
	);
	check(
		"the pick wrote a draft rather than saving",
		hostingButtons.includes("Save"),
		"no Save control appeared on the hosting row, so the pick saved on select",
		`the hosting row's controls read ${JSON.stringify(hostingButtons)}`,
	);

	/* ---------------------------------------------------------------- */
	/* 5. The model list, scoped by the effective hosting                 */
	/* ---------------------------------------------------------------- */

	const modelPressed = await verb(cdp, "press", settingField("model_name"));
	note("pressed the model field", JSON.stringify(modelPressed));
	await focusField(cdp, settingField("model_name"));
	/*
	 * The model catalogue is fetched on FIRST OPEN, so this wait is the one that
	 * spans the fetch: the popover exists before the rows do, and a frame taken
	 * between the two would be a spinner.
	 */
	const modelOpened = await waitForScene(
		cdp,
		`document.querySelectorAll('ul[role="listbox"] [role="option"]').length > 0`,
	);
	const modelRead = await readSettingField(cdp, "model_name");
	note("model_name open", JSON.stringify(modelRead));
	check(
		"the model field offers rows, from the same op the /model picker reads",
		modelOpened === true && modelRead.options.length > 0,
		`${modelRead.options.length} rows`,
	);
	check(
		"the model field states its own placeholder and accessible name",
		modelRead.placeholder === "Search models" &&
			modelRead.ariaLabel === "Default model",
		`placeholder=${JSON.stringify(modelRead.placeholder)} aria-label=${JSON.stringify(modelRead.ariaLabel)}`,
	);
	/*
	 * Scoping is asserted as a PROPERTY rather than as a count or a fixture list:
	 * every offered row must belong to the effective hosting, except the field's
	 * own stored value, which is the rescue and is allowed to sit outside the
	 * scope. A frame cannot tell a correctly scoped list from a long one, and a
	 * count is a fixture.
	 */
	const outside = modelRead.options.filter(
		(name) => name !== modelRead.value && !name.startsWith("anthropic/"),
	);
	check(
		"every model row belongs to the effective hosting, apart from the field's own value",
		modelRead.options.length > 0 && outside.length === 0,
		`outside scope: ${JSON.stringify(outside)}`,
	);
	const modelFrame = await captureSettled(cdp, "settings-model-open");

	/* ---------------------------------------------------------------- */
	/* 6. Enter takes the row the list is showing, not the query           */
	/* ---------------------------------------------------------------- */

	/*
	 * The reported gesture, end to end: type a filter that leaves rows on
	 * screen, press Enter, and see which value is committed. It used to be the
	 * three characters — a stored hosting no registry had ever heard of, with
	 * nothing on the page saying so (UX round 1, U1).
	 *
	 * The list is read BEFORE the key so the check can name what the answer
	 * should have been, rather than asserting "not the query".
	 */
	await readSettingField(cdp, "model_name");
	await cdp.send("Input.insertText", { text: "clau" });
	const narrowedForFilter = await waitForScene(
		cdp,
		`document.querySelector('ul[role="listbox"]') !== null`,
	);
	const filterRead = await readSettingField(cdp, "model_name");
	/*
	 * The mark is the visible half of the fix: with no arrow key pressed, the
	 * first row the query admits already carries it, so the user can see what
	 * Enter is about to take.
	 */
	const markedCount = await cdp.evaluate(
		`document.querySelectorAll('ul[role="listbox"] li[role="option"].outline-control').length`,
	);
	check(
		"a narrowed list already marks the row Enter would take",
		narrowedForFilter === true && markedCount === 1,
		`marked rows: ${markedCount}`,
		`${filterRead.options.length} rows offered, ${markedCount} marked`,
	);
	await captureSettled(cdp, "settings-model-typed-row");

	await keystroke("Enter", "Enter", 13);
	const afterEnter = await waitForScene(
		cdp,
		`(() => {
			const input = document.querySelector('[data-setting-key="model_name"] input[role="combobox"]');
			return Boolean(input) && input.value !== "clau" && input.value !== "";
		})()`,
	);
	const enterRead = await readSettingField(cdp, "model_name");
	note("model_name after Enter on a filter", JSON.stringify(enterRead));
	check(
		"Enter on a filter commits the row the list was showing",
		afterEnter === true &&
			enterRead.listOpen === false &&
			filterRead.options.includes(enterRead.value) &&
			enterRead.value !== "clau",
		`committed ${JSON.stringify(enterRead.value)} from ${JSON.stringify(filterRead.options.slice(0, 3))}`,
	);

	/* ---------------------------------------------------------------- */
	/* 7. Text that matches nothing still commits                         */
	/* ---------------------------------------------------------------- */

	await verb(cdp, "press", settingField("model_name"));
	await waitForScene(
		cdp,
		`document.querySelector('ul[role="listbox"]') !== null`,
	);
	/*
	 * Replace the buffer before typing. Step 6 ends by committing a picked row, so
	 * the field holds its selector — and `Input.insertText` inserts AT THE CARET,
	 * which turned this query into `anthropic/claude-opus-5zzzz-no-such-model` and
	 * made every assertion below about a string nobody typed (QA round 2, Q5).
	 * `Cmd+A` then typing is the gesture a user makes.
	 */
	await pressChord(cdp, {
		key: "a",
		code: "KeyA",
		virtualKeyCode: 65,
		modifiers: MODIFIER.meta,
		commands: ["selectAll"],
	});
	await cdp.send("Input.insertText", { text: "zzzz-no-such-model" });
	/*
	 * The typed-text row is a `role="option"` too, so the wait is for a list
	 * whose ONLY row is that one — which is the state this check is about: no
	 * listing knows the query, and the list offers to commit it as typed
	 * instead of closing or claiming a result.
	 */
	const empty = await waitForScene(
		cdp,
		`(() => {
			const rows = document.querySelectorAll('ul[role="listbox"] li[role="option"]');
			const typed = document.querySelectorAll('ul[role="listbox"] li[data-combobox-row="typed"]');
			return rows.length === 1 && typed.length === 1 && typed[0].textContent.includes("zzzz-no-such-model");
		})()`,
	);
	const emptyRead = await readSettingField(cdp, "model_name");
	note("model_name with no matches", JSON.stringify(emptyRead));
	check(
		"a query matching nothing still commits, through a row that says so",
		empty === true &&
			emptyRead.listOpen === true &&
			emptyRead.options.length === 0,
		`list open=${emptyRead.listOpen} rows=${JSON.stringify(emptyRead.options)}`,
		`the only row reads ${JSON.stringify(emptyRead.headings.slice(-1))}`,
	);
	const noMatchFrame = await captureSettled(cdp, "settings-model-no-match");

	await keystroke("Enter", "Enter", 13);
	const committed = await waitForScene(
		cdp,
		`(() => {
			const input = document.querySelector('[data-setting-key="model_name"] input[role="combobox"]');
			return Boolean(input) && input.value === "zzzz-no-such-model";
		})()`,
	);
	const committedRead = await readSettingField(cdp, "model_name");
	note("model_name after Enter", JSON.stringify(committedRead));
	check(
		"Enter on text no listing matches commits it verbatim, and the row goes dirty",
		committed === true &&
			committedRead.listOpen === false &&
			committedRead.value === "zzzz-no-such-model",
		`value=${JSON.stringify(committedRead.value)}`,
	);
	const freeTextFrame = await captureSettled(cdp, "settings-model-free-text");

	/* ---------------------------------------------------------------- */
	/* 7. The stored value that no listing contains                       */
	/* ---------------------------------------------------------------- */

	/*
	 * Re-opened by a PRESS rather than by a focus: the field still holds the
	 * caret from the commit above, and `focus()` on an already-focused element
	 * fires no event — which is also why the pointer path, not the focus path, is
	 * the one a user who has just typed reaches for.
	 */
	await verb(cdp, "press", settingField("model_name"));
	const rescueOpened = await waitForScene(
		cdp,
		`document.querySelectorAll('ul[role="listbox"] [role="option"]').length > 0`,
	);
	const rescueRead = await readSettingField(cdp, "model_name");
	note("model_name re-opened", JSON.stringify(rescueRead));
	check(
		"a stored value no listing contains is listed, under its own heading",
		rescueOpened === true &&
			rescueRead.headings.includes("Current value") &&
			rescueRead.options.includes("zzzz-no-such-model"),
		`headings=${JSON.stringify(rescueRead.headings)} options=${JSON.stringify(rescueRead.options.slice(-3))}`,
	);
	check(
		"and it is not badged with a sign-in state the payload cannot support",
		!rescueRead.options.some((name) => /signed in/i.test(name)),
		JSON.stringify(rescueRead.options.slice(-3)),
	);
	/*
	 * Scrolled to the end before the frame, because the rescued row is appended
	 * LAST — it is the one row here that is not in the scope — and a popover
	 * showing its first nine rows would photograph the assertion rather than its
	 * subject.
	 */
	await cdp.evaluate(
		`(() => { const list = document.querySelector('ul[role="listbox"]'); if (list) list.scrollTop = list.scrollHeight; return true; })()`,
	);
	const rescueFrame = await captureSettled(cdp, "settings-model-unknown-value");

	const frames = [
		restFrame,
		openFrame,
		filteredFrame,
		modelFrame,
		noMatchFrame,
		freeTextFrame,
		rescueFrame,
	];
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
 * `settings-fields`: the registry's provider and model fields AT REST, captured
 * from whichever tree is being run.
 *
 * WHY A SECOND SCENE, when `settings-model` already photographs these rows: this
 * one is deliberately blind to the component. It waits for a field in each row —
 * any input, not a combobox — so the SAME scene runs against a tree that has the
 * searchable control and against one that does not, and the two frames it writes
 * carry the same labels. That is the shape the operator's before/after rule
 * asks for, and it is why the pair is comparable at all: a scene that asserted
 * the combobox would refuse to photograph the tree the change is measured
 * against.
 *
 * Run it against a build of the base commit and against a build of the branch,
 * with the same command in each tree (see `docs/evidence/settings-model-combobox/`):
 *
 *   node scripts/renderer-driver.mjs --scene settings-fields --backend <url> \
 *     --seed-onboarding-complete --out <dir>
 */
async function sceneSettingsFields(cdp) {
	const hello = await verb(cdp, "hello");
	const facts = await factsOf(cdp);
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
	check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	check(
		"this scene is running against a live, isolated backend",
		Boolean(BACKEND),
		"the registry renders its offline surface without a daemon, so the pair needs --backend",
	);
	if (!BACKEND) return [];

	/*
	 * The registry's own deep link, so both trees photograph the SAME row: the
	 * plain page renders the section below the fold, and a frame of the top of
	 * the page would be a picture of the General section's legacy pair (which
	 * this change deliberately leaves alone) rather than of the rows it changes.
	 */
	await verb(cdp, "navigate", "/settings?setting=hosting");
	await verb(cdp, "setTheme", "localOperatorDark");
	/*
	 * Waits for an input in the row, whatever that input is: a combobox on this
	 * branch, a bare text field on the base commit.
	 */
	const ready = await waitForScene(
		cdp,
		`Boolean(document.querySelector('[data-setting-key="hosting"] input'))`,
	);
	check(
		"the registry rendered, with a field on the provider row",
		ready === true,
		"no [data-setting-key=hosting] input appeared",
	);
	if (ready !== true) return [];

	const rest = await readSettingsFields(cdp);
	note("the two fields at rest", JSON.stringify(rest));
	const restFrame = await captureSettled(cdp, "settings-hosting-rest");

	/*
	 * The second state, and the only one the base commit can render for it: the
	 * model row holding a value no listing contains. On this branch that value
	 * arrives through the combobox; on the base commit the field is plain text
	 * and typing is the only way in. Both frames therefore show the same
	 * QUESTION — what does this row look like when it holds a value nothing
	 * knows — and the difference between them is the change.
	 */
	// By ROW rather than by combobox: the base commit's field has no `role`.
	await focusField(cdp, '[data-setting-key="model_name"] input');
	await cdp.send("Input.insertText", { text: "deepseek/deepseek-chat" });
	await wait(150);
	const typed = await readSettingsFields(cdp);
	note(
		"the model field holding a value no listing contains",
		JSON.stringify(typed),
	);
	check(
		"the model field holds the value it was given",
		typed.model?.value === "deepseek/deepseek-chat",
		`model field reads ${JSON.stringify(typed.model)}`,
	);
	const typedFrame = await captureSettled(cdp, "settings-model-typed");

	const frames = [restFrame, typedFrame];
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
 * Both registry fields as a reader sees them, without assuming which control
 * they are.
 *
 * `role` is read rather than required: on this branch these are comboboxes and
 * on the base commit they are plain inputs, and the pair's whole point is that
 * one scene describes both.
 */
async function readSettingsFields(cdp) {
	return cdp.evaluate(`(() => {
		const read = (key) => {
			const row = document.querySelector(${JSON.stringify('[data-setting-key="PLACEHOLDER"]')}.replace("PLACEHOLDER", key));
			const input = row ? row.querySelector('input') : null;
			return input
				? { value: input.value, placeholder: input.placeholder, role: input.getAttribute('role') }
				: null;
		};
		return { hosting: read('hosting'), model: read('model_name') };
	})()`);
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
	 * change the twelve-theme story sweep cannot reach: the rail prints the chord
	 * on its own `sunken` ground, and a contrast question about it is only
	 * answerable in more than one ground (design round 1, D4). It is the app's key
	 * cap now rather than the plain monospace this scene was written against —
	 * the cap carries no fill, which is what made a cap possible on this ground at
	 * all — and the pair of frames is kept because the rail is still the one
	 * surface where a cap sits on `sunken`.
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
	 * The panel rows are gated on what the row NEEDS. `/info`, `/usage` and
	 * `/analytics` describe the machine and read no conversation, so they are
	 * offered wherever the backend is live — a shell host presents them on any
	 * route, and no pane is required. `/session` reads a conversation, so it needs
	 * a pane that can present it. THIS run has no backend, so neither condition
	 * holds: the chat route paints its connecting state, `canStageDraft` is false,
	 * and the palette offers no panel row at all — a row there would close the
	 * palette and open nothing, which is the dead control the palette refuses to
	 * offer.
	 *
	 * (Before the panels became readable without a conversation the single gate for
	 * all four was "can a pane present one". It is now two conditions over two
	 * kinds, and what this scene still pins is the liveness half: with nothing to
	 * read, the rows are absent rather than dead. The pane-vs-shell split is
	 * exercised against a live backend in the QA pass — no driver scene can reach
	 * it without pointing this harness at the operator's own daemon.)
	 */
	await verb(cdp, "press", "[data-command-palette-trigger]");
	await cdp.send("Input.insertText", { text: "provider usage" });
	const offline = await cdp.evaluate(
		"({ palette: Boolean(document.querySelector('[data-tour-tag=\"command-palette-dialog\"]')), rows: document.querySelectorAll('#command-palette-results [role=\"option\"]').length, text: (document.querySelector('[data-tour-tag=\"command-palette-dialog\"]')?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) })",
	);
	note("a panel query with no backend to answer it", JSON.stringify(offline));
	check(
		"no panel row is offered while nothing can answer one",
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

// ---- the composer's @ mentions -------------------------------------------------

/*
 * THE `@` PICKER AND ITS INLINE CHIPS, DRIVEN BY REAL KEYSTROKES ON THE BUILT APP.
 *
 * WHAT THIS SCENE IS FOR, and what Storybook cannot answer. The chip layer draws
 * rectangles measured from the field's own text, and the picker offers rows read
 * over the app's own IPC — two claims whose truth depends on a real `readdir`, a
 * real `stat`, a real textarea's layout and real keystrokes reaching the field.
 * A story hands all four in as fixtures; this run has none of them faked.
 *
 * THE FIXTURE IS A REAL DIRECTORY, and it is a directory THIS RUN OWNS: the pane is
 * a session created on this run's own backend with an explicit `cwd` inside the
 * scratch tree, the fixture files are written into that directory, and
 * `list-directory` resolves `.` against the session's cwd exactly as `probe-files`
 * resolves every other local path. So the rows a frame shows are entries that exist
 * on this machine, listed by the shipped IPC handler, and they are this run's
 * entries rather than the operator's — the first pass of this scene listed the
 * operator's own home and that is not a frame this set may publish.
 *
 * THE CLAIM THIS RUN EXISTS FOR is the one the harness's own picker got wrong:
 * a query that stops matching must NOT move the composer. PR #1220 measures that
 * defect at +17px across one keystroke, because its no-match branch closes the
 * list; here the notice row holds the picker open and every anchor in the band
 * has to read the same as it did while the list matched. The numbers are read
 * back from the page — the field's rect, the send button's rect and the
 * suggestion stack's rect — because a still cannot show "nothing moved" and a
 * note beside a frame is not a check.
 *
 * WHAT IT CANNOT REACH, and says so rather than pretending: the needs-approval
 * fill needs a reference that resolves OUTSIDE the session's directory, and every
 * token this scene types names a fixture inside `src/` — so every chip here is the
 * ordinary one. That state is photographed by the `chat-mention-chips` story set,
 * where the fact comes from a fixture rather than from a real containment verdict.
 *
 * AND THE CAPABILITY, WHICH IS THE OTHER HALF OF REACHING THIS FLOW AT ALL (UX
 * round 2, U14b). The scene used to throw at its own composer precondition — with
 * a live backend attached — because `/chat` mounts no composer without a session,
 * and staging one is exactly what it did not do. So it stages a session now, and
 * then asserts the capability as a precondition before it types anything: NO
 * harness advertises `references`, so on an ordinary backend the `@` affordance is
 * dark by design and there is no list to drive. The refusal names the rig in full —
 * a backend whose `/v1/capabilities` carries `features.references = 1`, i.e. a
 * loopback proxy in front of a live daemon that injects that one field (the shape
 * QA round 2 ran). That is a statement about the harness, not a defect in this
 * scene, and it is the honest answer while the key does not exist.
 *
 * AND THE ORIGIN IT HAS TO BE SERVED FROM, which is a requirement of its own and
 * cost a QA round its whole diagnosis (QA round 3, Q-6). `src/renderer/index.html`
 * pins the page's `connect-src` to `1111` and `8080` plus three vendor origins and
 * nothing computes it at runtime (`grep -rn "connect-src" src/main src/preload` is
 * empty), so a `--backend` rig on any OTHER loopback port is refused by the page
 * itself: the app's log says
 * `Connecting to 'http://127.0.0.1:<port>/v1/credentials' violates the following
 * Content Security Policy`, the chat route never gets a pane, and this scene throws
 * its composer refusal while the daemon behind the proxy is up and answering —
 * which reads as the wrong cause. ONLY THE SCENE needs this: the picker and the
 * chip are served over main-process IPC, which no CSP touches (measured — QA's
 * round-3 rows were green at 8080 and the port was the only difference). So run the
 * proxy on an allowed port (8080 is what QA used for the green run) and build the
 * renderer with `VITE_LOCAL_OPERATOR_API_URL` set to that same URL.
 */
async function sceneMentions(cdp) {
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
	check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);

	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", "localOperatorDark");

	const FIELD = 'textarea[aria-label="Message"]';
	const anchors = `(() => {
		const field = document.querySelector(${JSON.stringify(FIELD)});
		const box = (el) => (el ? { top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right } : null);
		return {
			field: box(field),
			box: box(field?.parentElement),
			send: box(document.querySelector('[aria-label="Send message"]')),
			focus: document.activeElement?.tagName ?? null,
			focusedIsField: document.activeElement === field,
			value: field?.value ?? null,
		};
	})()`;

	const closed = await cdp.evaluate(anchors);
	note("the band with an empty draft", JSON.stringify(closed));
	/*
	 * STAGE A PANE FIRST, ON THIS RUN'S OWN BACKEND AND IN THIS RUN'S OWN DIRECTORY
	 * (UX round 2, U14b).
	 *
	 * WHY THE COMPOSER IS NOT ALREADY THERE: `/chat` with a live backend and no
	 * session or staged draft mounts NO composer — the route opens on the empty-chat
	 * surface — and the scene used to look for the field and throw its "this scene
	 * needs a live backend" refusal while the app was in fact attached to one. That
	 * is why the live half of this evidence set was unrunnable by anyone.
	 *
	 * WHY A SESSION AND NOT THE ⌘N CHORD, which the first version of this fix used:
	 * a NEW DRAFT's working directory is the BACKEND'S ACCOUNT HOME, and the chip's
	 * `~` does NOT mean this run's scratch `HOME` — measured on the first pass that
	 * got this far, the picker listed the OPERATOR'S OWN home (129 rows: `Music`,
	 * `Documents`, `Library`, and every scratch directory on the machine), which is
	 * the one thing this rig exists to keep out of a frame. So the pane is a session
	 * created with an explicit `cwd` — the same `POST /v1/desktop/sessions` the
	 * desktop UI makes, and the same call `sceneBrowserPane` already uses — and the
	 * directory is a workspace inside this run's scratch tree. The fixtures below are
	 * then written into the directory the picker is actually reading.
	 */
	const workspace = join(SCRATCH, "mentions-workspace");
	mkdirSync(workspace, { recursive: true });
	if (BACKEND) {
		const staged = await createBackendSession(workspace);
		note(
			"the session this scene lists from",
			JSON.stringify({ id: staged.id, status: staged.status }),
		);
		if (staged.id) await verb(cdp, "navigate", `/chat/${staged.id}`);
	}
	const fieldMounted = () =>
		cdp.evaluate(`document.querySelector(${JSON.stringify(FIELD)}) !== null`);
	for (let attempt = 0; attempt < 60 && !(await fieldMounted()); attempt++) {
		await wait(100);
	}
	const stagedBand = await cdp.evaluate(anchors);
	note("the band with the staged pane", JSON.stringify(stagedBand));
	if (stagedBand.field === null) {
		throw new Error(
			"no composer on screen and `POST /v1/desktop/sessions` did not produce a pane " +
				"with one: this scene needs a live, ISOLATED backend this run owns " +
				"(`--backend <url>` plus `--seed-onboarding-complete`, per docs/agent-driver.md), " +
				"because a session (and with it the composer) is the backend's to create. " +
				"Without one the chat route paints its offline card and there is nothing to drive. " +
				"IF THE BACKEND IS IN FACT UP, check the port against the page's own origin " +
				"allowlist before anything else (QA round 3, Q-6): `src/renderer/index.html` pins " +
				"`connect-src` to `1111` and `8080` plus three vendor origins and nothing computes " +
				"it at runtime, so a rig on any other loopback port is refused BY THE PAGE and looks " +
				"exactly like this (`/v1/credentials ... violates the following Content Security " +
				"Policy` in the app's own log). Serve the proxy on an allowed port - 8080 is the one " +
				"QA round 3's green run used - and build the renderer with " +
				"`VITE_LOCAL_OPERATOR_API_URL` set to that same URL.",
		);
	}
	check(
		"the composer's field is on screen and holds the caret",
		stagedBand.focusedIsField === true,
		JSON.stringify(stagedBand),
	);

	/*
	 * THE CAPABILITY FIRST, before a single fixture file is written (UX round 2,
	 * U14b).
	 *
	 * The composer withholds the whole `@` affordance unless the backend advertises
	 * `features.references`, and NO harness does yet — the key is what the harness
	 * half must add. So on an ordinary backend this scene has nothing to drive, and
	 * saying that here is the difference between "the scene is broken" and "the
	 * harness cannot do this yet": the run has to be handed a backend that presents
	 * the capability. The answer is read from the backend rather than inferred from
	 * the app, because it is the same answer the app's gate reads.
	 */
	const capabilities = await fetch(`${BACKEND}/v1/capabilities`, {
		headers: {
			authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
		},
	})
		.then((response) => response.json())
		.catch(() => null);
	const references = capabilities?.result?.features?.references ?? null;
	const expandable =
		capabilities?.result?.desktop_available === true &&
		typeof references === "number" &&
		references >= 1;
	note(
		"whether the backend advertises file references",
		JSON.stringify({ references, expandable }),
	);
	if (!expandable) {
		throw new Error(
			`the backend does not advertise \`features.references\` in /v1/capabilities (read: ${JSON.stringify(
				references,
			)}), so the composer withholds the whole \`@\` affordance by design and there is no list to drive. This is a statement about the harness, not a defect in this scene: NO released harness carries the key. TO RUN IT, present the capability - a loopback proxy in front of a live daemon this run owns that injects \`result.features.references = 1\` into /v1/capabilities and forwards every other byte (SSE included) unchanged, then pass the PROXY's URL to --backend and build the renderer with VITE_LOCAL_OPERATOR_API_URL set to the same URL. That is the rig QA round 2 ran, and the proxy has to be on a port the PAGE allows (1111 or 8080, per src/renderer/index.html's connect-src) or the composer never mounts and the refusal above is the one you get instead (QA round 3, Q-6).`,
		);
	}

	/*
	 * The fixture the picker will list, written into the working directory the
	 * composer is ACTUALLY in — read off the control row's own cwd chip rather than
	 * assumed, because with a backend that directory is the session's and not this
	 * process's. Names chosen so the frames answer the states the design names: a
	 * directory to drill into, a nested one to read a parent column from, a common
	 * file the pool boosts, and a name with a space (the quoted form's only reason
	 * to exist).
	 *
	 * THE PATH COMES FROM THE CHIP'S OWN DATA ATTRIBUTE (`data-lo-cwd-path`, on all
	 * three of its branches), which is the value the composer resolves against; the
	 * accessible names are kept in the note because that is what a reader of the run
	 * sees on screen.
	 *
	 * AND IT HAS TO BE INSIDE THIS RUN'S OWN SCRATCH TREE, because the four lines
	 * under this comment WRITE files: a brand-new draft's cwd is the account home
	 * (which this run redirects with its own scratch `HOME`), a `~`-spelled path is
	 * resolved against that same scratch home here, and anything outside the scratch
	 * root is refused BEFORE a byte is written — otherwise the first successful run
	 * of this scene against a session in the operator's workspace would scribble
	 * fixture files into it.
	 */
	const readCwdChip = () =>
		cdp.evaluate(`(() => {
		const paths = [...document.querySelectorAll("[data-lo-cwd-path]")]
			.map((el) => el.getAttribute("data-lo-cwd-path"));
		const labels = [...document.querySelectorAll("[aria-label]")]
			.map((el) => el.getAttribute("aria-label"))
			.filter((label) => typeof label === "string" && label.startsWith("Working directory"));
		return { paths, labels };
	})()`);
	/*
	 * AND THE CHIP IS WAITED FOR, because it is a property of the SESSION and not of
	 * the pane: the control row renders it only once the composer knows which
	 * directory it is in, which arrives with the session's own status read. Reading it
	 * in the same tick as the field's mount measures that read, not the surface —
	 * measured, this is exactly what the first session-based pass did (`paths: []`).
	 */
	let cwdChip = await readCwdChip();
	for (let attempt = 0; attempt < 60 && cwdChip.paths.length === 0; attempt++) {
		await wait(100);
		cwdChip = await readCwdChip();
	}
	note(
		"the composer's working directory, as the control row names it",
		JSON.stringify(cwdChip),
	);
	const spelled =
		cwdChip.paths.find(
			(value) => typeof value === "string" && value.length > 0,
		) ?? null;
	const cwd = spelled;
	if (!cwd) {
		throw new Error(
			`the composer's chip names no working directory (${JSON.stringify(cwdChip.paths)}), so this scene cannot place its fixture files where the picker will list them`,
		);
	}
	/*
	 * AND IT IS AN ABSOLUTE PATH INSIDE THIS RUN'S SCRATCH TREE, with no `~`
	 * translation: a `~` here is the BACKEND'S home and this script cannot know what
	 * that is, which is exactly how the first pass listed the operator's own home.
	 * Anything outside the scratch root is refused before a byte is written.
	 *
	 * BOTH SIDES RESOLVED, and that is not tidiness: `tmpdir()` answers
	 * `/var/folders/...` on macOS while the app's own path for the same directory is
	 * `/private/var/folders/...`, so an unresolved comparison refuses the very
	 * directory this run just created (measured: `the composer's working directory
	 * /private/var/folders/…/mentions-workspace is outside this run's scratch tree
	 * /var/folders/…`). The same rule the containment check itself applies to both
	 * sides of a path.
	 */
	if (!realpathSync(cwd).startsWith(realpathSync(SCRATCH) + sep)) {
		throw new Error(
			`the composer's working directory ${cwd} is outside this run's scratch tree ${SCRATCH}: this scene WRITES its fixture files there, so it refuses a directory it does not own. Start the run against an isolated backend whose session cwd is this run's own scratch (see docs/agent-driver.md), or point it at a directory you are willing to have four fixture files written into.`,
		);
	}
	note("where the fixtures will be written", cwd);
	mkdirSync(join(cwd, "src", "components"), { recursive: true });
	writeFileSync(join(cwd, "README.md"), "# listing fixture\n");
	writeFileSync(join(cwd, "my file.txt"), "a name with a space\n");
	writeFileSync(join(cwd, "src", "app.py"), "print('hi')\n");
	writeFileSync(join(cwd, "src", "components", "button.tsx"), "export {}\n");

	/*
	 * `@` alone: the whole-directory listing. Typed through the browser's own input
	 * pipeline into whatever the page has focused, the same domain the palette
	 * scene types through.
	 *
	 * AND THE ROWS ARE WAITED FOR, because the listing is an ASYNC IPC round trip on
	 * a debounce: reading the list in the same tick as the keystroke measures the
	 * debounce, not the surface. The first runnable pass is what showed it — the
	 * check read `rows: 0` here and the same listing answered 129 rows a moment
	 * later.
	 */
	await cdp.send("Input.insertText", { text: "@" });
	const readOpened = () =>
		cdp.evaluate(`(() => {
		const list = document.querySelector('[role="listbox"][aria-label="Files"]');
		const rows = list ? [...list.querySelectorAll('[role="option"]')] : [];
		return {
			list: Boolean(list),
			rows: rows.length,
			names: rows.slice(0, 8).map((row) => row.textContent),
			header: list?.firstElementChild?.textContent ?? null,
			footer: list?.lastElementChild?.textContent ?? null,
			controls: document.querySelector(${JSON.stringify(FIELD)})?.getAttribute("aria-controls") ?? null,
			expanded: document.querySelector(${JSON.stringify(FIELD)})?.getAttribute("aria-expanded") ?? null,
		};
	})()`);
	let opened = await readOpened();
	for (let attempt = 0; attempt < 40 && opened.rows === 0; attempt++) {
		await wait(100);
		opened = await readOpened();
	}
	note("after typing @", JSON.stringify(opened));
	check(
		"typing @ opens the file list over the composer",
		opened.list === true,
		JSON.stringify(opened),
	);
	check(
		"the list is populated from the working directory over the real IPC",
		opened.rows > 0 &&
			opened.names.some((name) => name.includes("README.md")) &&
			opened.names.some((name) => name.includes("src")),
		JSON.stringify(opened.names),
	);
	check(
		"the listbox is named by the field it belongs to, with aria-controls and aria-expanded",
		typeof opened.controls === "string" && opened.expanded === "true",
		JSON.stringify(opened),
	);
	const openFrame = await captureSettled(cdp, "mentions-list-dark");

	// The drill: a trailing slash is the grammar's own deepening gesture.
	await cdp.send("Input.insertText", { text: "src/" });
	const readDrilled = () =>
		cdp.evaluate(`(() => {
		const list = document.querySelector('[role="listbox"][aria-label="Files"]');
		const rows = list ? [...list.querySelectorAll('[role="option"]')] : [];
		return {
			header: list?.firstElementChild?.textContent ?? null,
			names: rows.map((row) => row.textContent),
			count: list?.lastElementChild?.lastElementChild?.textContent ?? null,
		};
	})()`);
	let drilled = await readDrilled();
	for (
		let attempt = 0;
		attempt < 40 && !drilled.names.some((name) => name.includes("app.py"));
		attempt++
	) {
		await wait(100);
		drilled = await readDrilled();
	}
	note("after drilling into src/", JSON.stringify(drilled));
	check(
		"a trailing slash lists that directory, and the header says which",
		drilled.header === "src/",
		JSON.stringify(drilled),
	);
	check(
		"the drilled listing is that directory's entries",
		drilled.names.some((name) => name.includes("app.py")) &&
			drilled.names.some((name) => name.includes("components")),
		JSON.stringify(drilled.names),
	);

	/*
	 * THE NO-MATCH STATE, and the assertion this whole scene is for. The query
	 * below matches nothing in `src/`, so the picker paints its notice row — and
	 * every anchor in the band has to be where it was while the list matched.
	 */
	const beforeNoMatch = await cdp.evaluate(anchors);
	await cdp.send("Input.insertText", { text: "zzzz" });
	const readNoMatch = () =>
		cdp.evaluate(`(() => {
		const list = document.querySelector('[role="listbox"][aria-label="Files"]');
		return {
			list: Boolean(list),
			options: list ? list.querySelectorAll('[role="option"]').length : -1,
			notice: document.querySelector("[data-mention-notice]")?.textContent ?? null,
		};
	})()`);
	let noMatch = await readNoMatch();
	for (
		let attempt = 0;
		attempt < 40 && typeof noMatch.notice !== "string";
		attempt++
	) {
		await wait(100);
		noMatch = await readNoMatch();
	}
	const afterNoMatch = await cdp.evaluate(anchors);
	note("no-match state", JSON.stringify(noMatch));
	note("the band while nothing matched", JSON.stringify(afterNoMatch));
	check(
		"the picker HOLDS with a notice row instead of closing",
		noMatch.list === true && noMatch.options === 0,
		JSON.stringify(noMatch),
	);
	check(
		'the notice distinguishes "nothing here matches" from "this folder is empty"',
		typeof noMatch.notice === "string" &&
			noMatch.notice.includes('No files match "zzzz" in src/.'),
		JSON.stringify(noMatch.notice),
	);
	check(
		"the field does not move a single pixel between the matching and no-match states",
		beforeNoMatch.field.top === afterNoMatch.field.top &&
			beforeNoMatch.field.height === afterNoMatch.field.height,
		`matched ${JSON.stringify(beforeNoMatch.field)} vs no-match ${JSON.stringify(afterNoMatch.field)}`,
	);
	check(
		"nothing else in the band moves either",
		JSON.stringify(beforeNoMatch.box) === JSON.stringify(afterNoMatch.box) &&
			JSON.stringify(beforeNoMatch.send) === JSON.stringify(afterNoMatch.send),
		`box ${JSON.stringify(afterNoMatch.box)} send ${JSON.stringify(afterNoMatch.send)}`,
	);
	const noMatchFrame = await captureSettled(cdp, "mentions-no-match-dark");

	/*
	 * Escape closes the list and leaves the draft alone: the picker is a list over
	 * the text, and dismissing it must not edit what the user wrote.
	 */
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
	}
	const afterEscape = await cdp.evaluate(`(() => {
		const field = document.querySelector(${JSON.stringify(FIELD)});
		return {
			list: Boolean(document.querySelector('[role="listbox"][aria-label="Files"]')),
			value: field?.value ?? null,
		};
	})()`);
	note("after Escape", JSON.stringify(afterEscape));
	check(
		"Escape closes the list and the token it was opened on is still there",
		afterEscape.list === false && afterEscape.value === "@src/zzzz",
		JSON.stringify(afterEscape),
	);

	/*
	 * A hand-typed, resolvable mention: the chip is derived from the field's own
	 * value, so a newline and the path below are all it takes — the picker is an
	 * accelerator, never a requirement.
	 *
	 * The line starts at the buffer's only newline, and the caret is at the end,
	 * which is exactly the "mention at the very end of the text" state.
	 */
	await cdp.send("Input.insertText", { text: "\nlook at @README.md" });
	const readChip = () =>
		cdp.evaluate(`(() => {
		const chips = [...document.querySelectorAll("[data-mention-chip]")];
		const tokens = [...document.querySelectorAll("[data-mention-token]")];
		const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top * 100) / 100, left: Math.round(r.left * 100) / 100, right: Math.round(r.right * 100) / 100, width: Math.round(r.width * 100) / 100, height: Math.round(r.height * 100) / 100 }; };
		return {
			chips: chips.map((el) => ({ kind: el.dataset.mentionChip, span: el.dataset.mentionSpan, ...rect(el) })),
			tokens: tokens.map((el) => ({ span: el.dataset.mentionToken, ...rect(el) })),
		};
	})()`);
	let chip = await readChip();
	for (let attempt = 0; attempt < 40 && chip.chips.length === 0; attempt++) {
		await wait(100);
		chip = await readChip();
	}
	note(
		"the chip and the run it was measured from",
		JSON.stringify(chip, null, 2),
	);
	check(
		"a hand-typed path that resolves paints exactly one chip",
		chip.chips.length === 1 && chip.chips[0].kind === "plain",
		JSON.stringify(chip.chips),
	);
	const chipToken = chip.tokens.find(
		(token) => token.span === chip.chips[0]?.span,
	);
	check(
		"the chip is drawn on its own glyph run, inside the tolerance",
		chip.chips.length === 1 &&
			chipToken !== undefined &&
			Math.abs(
				chip.chips[0].top -
					(chipToken.top + (chipToken.height - chip.chips[0].height) / 2),
			) <= 1 &&
			Math.abs(chip.chips[0].left - (chipToken.left - 6)) <= 1 &&
			Math.abs(chip.chips[0].right - (chipToken.right + 6)) <= 1,
		JSON.stringify({
			fill: chip.chips[0],
			run: chipToken,
			allTokens: chip.tokens,
		}),
	);
	check(
		"the fill is the design's height and overhang, to within half a pixel",
		chip.chips.length === 1 &&
			chipToken !== undefined &&
			Math.abs(chip.chips[0].height - 17.7) <= 0.5 &&
			Math.abs(chip.chips[0].width - (chipToken.width + 12)) <= 0.5,
		JSON.stringify(chip.chips[0]),
	);
	check(
		"the chip's fill is wider than the glyphs it sits behind",
		chip.chips.length === 1 &&
			chipToken !== undefined &&
			chip.chips[0].width > chipToken.width,
		JSON.stringify({ fill: chip.chips[0]?.width, run: chipToken?.width }),
	);
	const chipFrame = await captureSettled(cdp, "mentions-chip-dark");

	/*
	 * TWO MENTIONS, which is the adjacency case the grammar makes reachable: a
	 * token opens only at a boundary, so true adjacency is impossible and the pair
	 * is separated by the space's own advance. The fills must never touch.
	 */
	await cdp.send("Input.insertText", { text: " and @src/app.py" });
	const readPair = () =>
		cdp.evaluate(`(() => {
		const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, height: r.height }; };
		return [...document.querySelectorAll("[data-mention-chip]")].map(rect);
	})()`);
	/*
	 * AND THE SECOND FILL IS WAITED FOR: the chip is derived from a PROBE, which is
	 * debounced, so reading in the same tick as the keystroke sees the previous
	 * draft's one chip (measured — the first pass reported a single fill here).
	 */
	let pair = await readPair();
	for (let attempt = 0; attempt < 40 && pair.length < 2; attempt++) {
		await wait(100);
		pair = await readPair();
	}
	note("two mentions on one line", JSON.stringify(pair));
	check(
		"two mentions paint two fills that do not touch",
		pair.length === 2 && pair[1].left > pair[0].right,
		JSON.stringify(pair),
	);
	const pairFrame = await captureSettled(cdp, "mentions-pair-dark");

	/*
	 * A LIGHT THEME, because the fill step's two thinnest palettes are the light
	 * ones (`iceberg` 2.15, `localOperatorLight` 2.25 for the `elevated` candidate;
	 * `sunken` carries 3.75 at its worst) and the whole set's contrast question is
	 * asked where it is worst.
	 */
	await verb(cdp, "setTheme", "localOperatorLight");
	const pairLight = await captureSettled(cdp, "mentions-pair-light");

	const frames = [openFrame, noMatchFrame, chipFrame, pairFrame, pairLight];
	check(
		"every capture is a frame the app held still for, with no toast on it",
		frames.every((frame) => frame.stable === true && frame.toastFree === true),
		frames
			.map(
				(frame) =>
					`${frame.label}: stable ${frame.stable}, toast-free ${frame.toastFree}`,
			)
			.join(" | "),
	);
	return frames;
}

// ---- the canvas freshness scene ----------------------------------------------

/**
 * A file rewritten on disk while its canvas tab is open, in the BUILT app.
 *
 * WHAT IT IS EVIDENCE FOR, and why it cannot be a unit test. The headless suite
 * (`scripts/canvas-file-freshness.test.mjs`) drives the decisions - the mtime
 * comparison, the identical-bytes backstop, the dirty suppression, the in-flight
 * de-duplication - against the same modules the app runs, but every one of those
 * runs against a FAKE bridge. What is left unproved by that is the half this
 * scene exists for: that a real `statSync` in main and a real `readFile` over IPC
 * reach a real viewer, on a real mount, through the app's own store, and that the
 * panel a user is looking at changes without them doing anything.
 *
 * THE FILE IS REWRITTEN BY THIS SCRIPT, from outside the app, which is the only
 * way to produce the event the feature exists for - an agent, an editor or a
 * shell writing the file while the window sits there. Its mtime is set
 * explicitly, so the three claims below are exact rather than clock-dependent:
 *
 *   1. a write with a NEW mtime is picked up with no interaction, and the
 *      document's own line goes with it;
 *   2. a write with the SAME mtime is not - which is what makes the mtime the
 *      thing that decides - and the refresh control applies it anyway, which is
 *      the control's whole job and the one case a probe cannot see;
 *   3. a tab that is NOT on screen is left alone while it is off screen, and
 *      switching to it is what applies what changed.
 *
 * WHY THE CLAIMS ABOUT TIME ARE PROVEN THROUGH THE STORE RATHER THAN BY COUNTING
 * IPC CALLS. The first version of this scene wrapped `window.api.probeFiles` to
 * count probes, and it measured nothing: the bridge is a `contextBridge` object,
 * so assigning to one of its properties is silently ignored - the counter read
 * zero for a run in which probes demonstrably happened. What replaces it is the
 * app's own persisted state. `canvas-store` is the store's `localStorage` entry,
 * so the scene can read the document the app is HOLDING (content, mtime baseline)
 * for any tab, including one that is not on screen. That is a better instrument
 * than a call count anyway, because it answers the question the design is really
 * about: a file whose mtime differed and which the app had checked would have
 * been applied, so "the off-screen tab's held bytes did not move for five
 * seconds" is evidence that nothing checked it - and the same reading immediately
 * after the switch, moved, is evidence that the switch is what did.
 */
const CANVAS_FRESHNESS_POLL_MS = 2000;

/**
 * The document the app is holding for one path, from its own store.
 *
 * `canvas-store` is zustand's `persist` entry: `{ state: { conversations: { … } } }`,
 * one `files` array per conversation. Read as JSON with a try/catch because a
 * torn read of a store mid-write is not what this scene is about, and `null` for
 * "nothing holds this path yet" rather than an empty object, so a caller can tell
 * "not there" from "there and empty".
 */
const CANVAS_STORE_DOCS_EXPR = `(() => {
	try {
		const raw = window.localStorage.getItem("canvas-store");
		if (!raw) return null;
		const conversations = JSON.parse(raw)?.state?.conversations ?? {};
		const out = {};
		for (const [key, value] of Object.entries(conversations)) {
			out[key] = (value?.files ?? []).map((file) => ({
				id: file.id,
				content: file.content ?? "",
				readMtimeMs: file.readMtimeMs ?? null,
				lastAgentModified: file.lastAgentModified ?? null,
			}));
		}
		return out;
	} catch (error) {
		return { error: String(error) };
	}
})()`;

/**
 * The store's entry for one path, whichever conversation holds it.
 *
 * Across conversations on purpose: which key the app filed the document under is
 * the app's business (a draft key until the session exists, a session id after),
 * and a scene that asserted the key would be asserting the app's routing rather
 * than the freshness.
 */
async function storedDocument(cdp, path) {
	const conversations = await cdp.evaluate(CANVAS_STORE_DOCS_EXPR);
	if (!conversations || conversations.error) return null;
	for (const files of Object.values(conversations)) {
		for (const file of files) {
			if (file.id === path || file.id === decodeURI(path)) return file;
		}
	}
	return null;
}

/**
 * The editor's own text, whichever of the two document surfaces is mounted.
 *
 * SCOPED TO THE CANVAS PANEL, and CodeMirror's own content first. Both editors
 * are contenteditable - CodeMirror's `.cm-content` carries
 * `contenteditable="true"` - so asking for a contenteditable and calling it
 * "markdown" reads a code editor's text under the wrong name, and asking the
 * whole document finds whatever else in the app is editable. The panel is
 * `#canvas-document-panel`, which is also the element the tab strip's
 * `aria-controls` names.
 */
const CANVAS_DOCUMENT_TEXT_EXPR = `(() => {
	const panel = document.querySelector("#canvas-document-panel");
	if (!panel) return { surface: null, text: "", panel: false };
	const cm = panel.querySelector(".cm-content");
	if (cm) return { surface: "code", text: cm.textContent ?? "", panel: true };
	const editable = panel.querySelector('[contenteditable="true"]');
	if (editable) return { surface: "markdown", text: editable.textContent ?? "", panel: true };
	const body = panel.querySelector('[data-tour-tag="canvas-document-freshness"]');
	return { surface: null, text: body ? body.textContent ?? "" : "", panel: true };
})()`;

/** The canvas's own tab strip, named by its own accessible label. */
const CANVAS_TAB_SELECTOR =
	'[role="tablist"][aria-label="Open documents"] [role="tab"]';

/** The document on screen, as its own editor renders it. */
function canvasDocumentText(cdp) {
	return cdp.evaluate(CANVAS_DOCUMENT_TEXT_EXPR);
}

/** The text of one node, or null when it is not on screen. */
function textOf(cdp, selector) {
	return cdp.evaluate(
		`(() => { const node = document.querySelector(${JSON.stringify(selector)}); return node ? node.textContent : null; })()`,
	);
}

/** Wait for a condition the page answers, or give up and report the last answer. */
async function waitForCondition(cdp, expr, timeoutMs, everyMs = 50) {
	const started = Date.now();
	let last = null;
	for (;;) {
		last = await cdp.evaluate(expr);
		if (last) return { ok: true, waitedMs: Date.now() - started, last };
		if (Date.now() - started > timeoutMs) {
			return { ok: false, waitedMs: Date.now() - started, last };
		}
		await wait(everyMs);
	}
}

/**
 * Set a file's mtime to an exact second and read back what the filesystem
 * recorded.
 *
 * Read back rather than assumed: the whole scene rests on the app's `mtimeMs`
 * equalling this number exactly, and the only process that can answer for the
 * volume is the one holding the file. Seconds are what `utimesSync` takes, so
 * whole seconds are what is set.
 */
function setExactMtime(path, seconds) {
	utimesSync(path, seconds, seconds);
	return statSync(path).mtimeMs;
}

/**
 * Count the app's own `fs` calls for this run's scratch root, in MAIN.
 *
 * WHY HERE AND NOT IN THE PAGE: the claims this scene makes about time are
 * claims about the app's work - "the poll probed the document on screen three
 * times in six seconds", "the tab that is off screen was not probed at all" -
 * and the page cannot be counted. `window.api` is a `contextBridge` object, so a
 * wrapper assigned over one of its properties is silently ignored: the first
 * version of this scene installed one and read zero for a run in which probes
 * demonstrably happened, and the store reading that replaced it proves
 * non-APPLICATION rather than non-probing, which are different claims. Main is a
 * Node process with an inspector, so the counter wraps the `fs` calls the probe
 * handler itself makes and the scene's numbers are the app's own.
 *
 * The instrument is VALIDATED before it is used, by every run: a probe issued
 * from the renderer through `window.api.probeFiles` must appear in the log. A
 * count of zero after that is a measurement, not a broken wrapper.
 */
function installProbeCounter(main, root) {
	return main.evaluate(`(() => {
		if (globalThis.__probeLog) return "already installed";
		const log = [];
		globalThis.__probeLog = log;
		const fs = process.mainModule?.require("node:fs") ?? globalThis.require?.("node:fs");
		if (!fs) return "unreachable: process.mainModule is " + String(process.mainModule);
		for (const name of ["statSync", "lstatSync", "readFileSync"]) {
			const original = fs[name];
			if (typeof original !== "function") continue;
			fs[name] = function (target, ...rest) {
				if (typeof target === "string" && target.startsWith(${JSON.stringify(root)})) {
					log.push({ at: Date.now(), fn: name, path: target });
				}
				return original.apply(this, [target, ...rest]);
			};
		}
		return "installed";
	})()`);
}

/**
 * How many times main touched one path since an instant.
 *
 * `statSync`/`lstatSync` are the probes (`probe-files` answers from a `statSync`
 * with `throwIfNoEntry: false`); `readFileSync` is a read, and the two are
 * counted separately because "did not look" and "did not read" are different
 * claims - the check that a document is not being worked on behind the reader's
 * back is about LOOKING.
 */
function mainCalls(main, path, sinceMs, { reads = false } = {}) {
	const names = reads ? '["readFileSync"]' : '["statSync", "lstatSync"]';
	return main.evaluate(
		`globalThis.__probeLog.filter((entry) => entry.at >= ${sinceMs} && ${names}.includes(entry.fn) && entry.path === ${JSON.stringify(path)}).length`,
	);
}

/**
 * Prove the counter counts, by making the app probe a path through its own
 * bridge and watching the log move. Every run does this before it measures
 * anything, so a later zero is a zero.
 */
async function validateProbeCounter(main, cdp, path) {
	const before = await mainCalls(main, path, 0);
	await cdp.evaluate(
		`window.api.probeFiles([${JSON.stringify(path)}]).then((answers) => answers.length)`,
	);
	await wait(250);
	const after = await mainCalls(main, path, 0);
	return { before, after, counted: after === before + 1 };
}

async function sceneCanvasFreshness(cdp, app) {
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
		`visible=${facts.visible} focused=${facts.focused}`,
	);
	check(
		"the window never has focus",
		facts.focused === false,
		`focused=${facts.focused}`,
	);
	check(
		"the renderer is looking at a visible document, which is what the poll requires",
		hello.visibilityState === "visible",
		hello.visibilityState,
	);

	/*
	 * The subject. Two files, because the scene has to be able to ask "what
	 * happens to a tab that is NOT the one on screen" - and a document that is
	 * never opened is not a tab.
	 */
	const dir = join(SCRATCH, "canvas-freshness");
	mkdirSync(dir, { recursive: true });
	const markdown = join(dir, "notes.md");
	const code = join(dir, "report.py");
	/*
	 * A FIXED epoch, not `Date.now()`. These mtimes are what the frames render on
	 * the document's line, so a run-relative base would print a different minute in
	 * every set - and "re-taken on the rebased head, byte-identical" is a claim
	 * this repo asks for and a claim a clock base makes unprovable. A file's mtime
	 * is a fact that can be set, so it is set.
	 */
	const BASE_SECOND = 1_760_000_000;
	const MARKDOWN_T0 = BASE_SECOND;
	const MARKDOWN_T1 = BASE_SECOND + 60;
	const MARKDOWN_T2 = BASE_SECOND + 150;
	const CODE_T0 = BASE_SECOND - 30;

	const markdownBody = (marker) => `# Canvas freshness\n\n${marker}\n`;
	writeFileSync(markdown, markdownBody("first-version"));
	const markdownMtime0 = setExactMtime(markdown, MARKDOWN_T0);
	writeFileSync(code, 'print("code-first-version")\n');
	const codeMtime0 = setExactMtime(code, CODE_T0);
	note(
		"the two subject files",
		`${markdown} mtimeMs=${markdownMtime0}\n${code} mtimeMs=${codeMtime0}`,
	);

	/*
	 * The chat route first. Nothing else in this scene can be reached from
	 * wherever the app opens: the canvas is a dock beside a conversation, and a
	 * run whose catalogue gate is closed has no panel to open a document in.
	 */
	await verb(cdp, "navigate", "/chat");
	const routed = await verb(cdp, "state");
	note("the route the scene works on", JSON.stringify(routed));

	/*
	 * The instrument, installed and PROVED before anything is measured. See
	 * `installProbeCounter`: the page cannot count the app's probes and this can,
	 * and a count of zero from a wrapper nobody validated would be worth nothing.
	 */
	const main = await CdpClient.attachNode(app.inspectPort);
	const counter = await installProbeCounter(main, SCRATCH);
	note("probe counter (in main)", `${counter}, root ${SCRATCH}`);
	check(
		"the probe counter is installed in the process the probes run in",
		counter === "installed",
		counter,
	);

	/*
	 * ---- the markdown document: the poll, the mtime gate, the control --------
	 */
	const opened = await verb(cdp, "openCanvasDocument", { path: markdown });
	note("openCanvasDocument", JSON.stringify(opened));
	check(
		"the document was opened at the mtime the file actually has",
		opened.readMtimeMs === markdownMtime0,
		`document baseline ${opened.readMtimeMs} against file mtime ${markdownMtime0}`,
	);
	check(
		"the document's bytes were read into the canvas, not left to a viewer",
		opened.contentLength === markdownBody("first-version").length,
		`${opened.contentLength} characters for a ${markdownBody("first-version").length}-character file`,
	);

	const proof = await validateProbeCounter(main, cdp, markdown);
	note("the counter's own proof", JSON.stringify(proof));
	check(
		"the counter counts a probe this run made through the app's own bridge",
		proof.counted,
		`${proof.before} -> ${proof.after} probe(s) for the document`,
	);

	const first = await canvasDocumentText(cdp);
	note("what the canvas mounted", JSON.stringify(first));
	check(
		"the markdown editor is showing the file",
		first.panel === true &&
			first.surface === "markdown" &&
			first.text.includes("first-version"),
		`${first.surface}: ${JSON.stringify(first.text.slice(0, 120))}`,
	);
	const held = await storedDocument(cdp, markdown);
	check(
		"the app's own store holds the file's bytes and its mtime baseline",
		held?.content === markdownBody("first-version") &&
			held?.readMtimeMs === markdownMtime0,
		JSON.stringify(held),
	);

	const stampBefore = await textOf(
		cdp,
		'[data-tour-tag="canvas-document-modified"]',
	);
	note("the document's line", stampBefore);
	/*
	 * The local-time claim, asked of the page rather than of this script: the
	 * renderer's own locale and timezone are what "local" means here, so the
	 * expectation is computed in the page from the same instant. The zone is
	 * reported beside it, and the hour is compared with UTC's so a run on a UTC
	 * machine says so instead of appearing to prove something.
	 */
	const stampFacts = await cdp.evaluate(`(() => {
		const at = new Date(${markdownMtime0});
		const options = { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" };
		return {
			expected: at.toLocaleString(navigator.language, options),
			locale: navigator.language,
			zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			offsetMinutes: -at.getTimezoneOffset(),
			localHour: at.getHours(),
			utcHour: at.getUTCHours(),
		};
	})()`);
	note("the stamp's claim", JSON.stringify(stampFacts));
	check(
		"the document's line states the file's last modification in the renderer's local time",
		stampBefore === `Modified ${stampFacts.expected}`,
		`${JSON.stringify(stampBefore)} against ${JSON.stringify(`Modified ${stampFacts.expected}`)}`,
	);
	check(
		"the instant rendered is the local one, not UTC's",
		stampFacts.localHour === stampFacts.utcHour ||
			stampFacts.offsetMinutes !== 0,
		`local hour ${stampFacts.localHour}, UTC hour ${stampFacts.utcHour}, offset ${stampFacts.offsetMinutes} min, zone ${stampFacts.zone}`,
	);

	/*
	 * The layout claim, measured rather than eyeballed: the line is 28px and it
	 * comes out of the document's own box rather than being laid over it or
	 * pushing the panel past the window.
	 */
	const geometry = await cdp.evaluate(`(() => {
		const line = document.querySelector('[data-tour-tag="canvas-document-freshness"]');
		const panel = document.querySelector('[data-tour-tag="canvas-container"]');
		const editor = document.querySelector("#canvas-document-panel .cm-editor") ??
			document.querySelector('#canvas-document-panel [contenteditable="true"]');
		if (!line || !panel || !editor) return null;
		const lineRect = line.getBoundingClientRect();
		const panelRect = panel.getBoundingClientRect();
		const editorRect = editor.getBoundingClientRect();
		return {
			lineHeight: lineRect.height,
			panelHeight: panelRect.height,
			editorHeight: editorRect.height,
			editorBottomPastPanel: editorRect.bottom - panelRect.bottom,
			viewportHeight: window.innerHeight,
			documentScrollHeight: document.documentElement.scrollHeight,
		};
	})()`);
	note("geometry", JSON.stringify(geometry));
	check(
		"the document's line is one 32px row, the tab strip's own height",
		geometry !== null && Math.abs(geometry.lineHeight - 32) < 0.5,
		JSON.stringify(geometry),
	);
	check(
		"the document's own box is what shrank, not the panel",
		geometry !== null && geometry.editorBottomPastPanel <= 0.5,
		JSON.stringify(geometry),
	);

	const before = await captureSettled(cdp, "canvas-freshness-before");
	check(
		"the before frame is stable and toast-free",
		before.stable && before.toastFree,
		`attempts=${before.attempts} stable=${before.stable} toastFree=${before.toastFree}`,
	);

	/*
	 * (1) A write with a NEW mtime, and nothing else. The app is not told; the
	 * only thing that can notice is the mtime probe.
	 */
	const write2At = Date.now();
	writeFileSync(markdown, markdownBody("second-version"));
	const markdownMtime1 = setExactMtime(markdown, MARKDOWN_T1);
	const applied = await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).text.includes("second-version")`,
		CANVAS_FRESHNESS_POLL_MS * 4,
	);
	const appliedLatencyMs = Date.now() - write2At;
	check(
		"a file written on disk while its tab is open appears with no interaction",
		applied.ok,
		`waited ${appliedLatencyMs}ms (poll every ${CANVAS_FRESHNESS_POLL_MS}ms); last text ${JSON.stringify(String(applied.last).slice(0, 120))}`,
	);
	const probesSinceWrite = await mainCalls(main, markdown, write2At);
	check(
		"and the poll is what picked it up: the app probed the path, then read it",
		applied.ok &&
			probesSinceWrite >= 1 &&
			appliedLatencyMs <= CANVAS_FRESHNESS_POLL_MS * 2 + 500,
		`applied ${appliedLatencyMs}ms after the write on ${probesSinceWrite} probe(s) - a free-running ${CANVAS_FRESHNESS_POLL_MS}ms poll, so the latency is its phase and not a delay (the lower bound this check used to assert was wrong for that reason: QA round 1, Q2)`,
	);

	/*
	 * The idle interval, counted rather than asserted: three ticks of a document
	 * nobody is touching. This is the number the "efficient" half of the request
	 * rests on - one `statSync` per two seconds, and no read at all.
	 */
	const idleSince = Date.now();
	await wait(CANVAS_FRESHNESS_POLL_MS * 3);
	const idleProbes = await mainCalls(main, markdown, idleSince);
	const idleReads = await mainCalls(main, markdown, idleSince, { reads: true });
	check(
		"an idle on-screen document costs one probe per tick and no read",
		idleProbes >= 2 && idleProbes <= 4 && idleReads === 0,
		`${idleProbes} probe(s) and ${idleReads} read(s) in ${Date.now() - idleSince}ms`,
	);
	const stampAfterApply = await textOf(
		cdp,
		'[data-tour-tag="canvas-document-modified"]',
	);
	const expectedStamp1 = await cdp.evaluate(
		`new Date(${markdownMtime1}).toLocaleString(navigator.language, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })`,
	);
	check(
		"the document's line moved with the file",
		stampAfterApply === `Modified ${expectedStamp1}`,
		`${JSON.stringify(stampAfterApply)} against ${JSON.stringify(`Modified ${expectedStamp1}`)}`,
	);

	/*
	 * (2) A write with the SAME mtime. The bytes differ; the file's metadata does
	 * not - a `cp -p` over the same path, a save that restored a timestamp, two
	 * writes inside one filesystem tick. Nothing may change, which is what makes
	 * the mtime the thing that decides - and it is also the case the refresh
	 * control exists for, because no probe can see it.
	 */
	writeFileSync(markdown, markdownBody("third-version"));
	setExactMtime(markdown, MARKDOWN_T1);
	await wait(CANVAS_FRESHNESS_POLL_MS * 2 + 1000);
	const afterSameMtime = await canvasDocumentText(cdp);
	const heldWhileSame = await storedDocument(cdp, markdown);
	check(
		"a rewrite that leaves the mtime alone is not treated as a change",
		afterSameMtime.text.includes("second-version") &&
			!afterSameMtime.text.includes("third-version"),
		`the editor still says ${JSON.stringify(afterSameMtime.text.slice(0, 120))}, the store holds ${JSON.stringify(String(heldWhileSame?.content).slice(0, 120))}`,
	);

	/*
	 * (3) The control, which exists for exactly that case. Nothing else can apply
	 * this: the poll has had ten chances and taken none, so a change here is the
	 * press's by construction rather than by timing.
	 */
	/*
	 * WAIT FOR THE CONTROL TO BE TAKING THE POINTER, and this is the answer to
	 * QA round 2's rig question rather than a cosmetic wait.
	 *
	 * The control is `disabled` for the ~11ms a forced check takes, and in this
	 * design system a disabled control is `pointer-events: none` - so a hit test
	 * landing inside that window returns the control's PARENT while the centre of
	 * its box is exactly where the button is, and a synthetic `dispatchEvent`
	 * still reaches the button and presses it. That is the shape QA saw twice
	 * (`hitTest: false`, `hit: div ""` = `div.ml-auto.shrink-0`, with the very next
	 * check passing): the instrument was racing a real transient state, and its
	 * report could not say which. Two runs here reported 48/48 because the press
	 * happened to land between windows; QA's landed inside one. What made it
	 * deliverable as a "failure" was the report, not the app.
	 *
	 * So the scene waits for the state the check is about to assert - an enabled
	 * control - and the check reports the whole stack and the disabled flag
	 * (`pressAt`), so the next reader can tell a broken control from a broken
	 * instrument in one line.
	 */
	const controlReady = await waitForCondition(
		cdp,
		`(() => {
			const button = document.querySelector('[data-tour-tag="canvas-refresh-file-button"]');
			return Boolean(button) && button.disabled === false;
		})()`,
		5000,
	);
	const pressed = await verb(cdp, "press", {
		selector: '[data-tour-tag="canvas-refresh-file-button"]',
	});
	check(
		"the refresh control is enabled, and is a real hit target while it is enabled",
		controlReady.ok && pressed.hitTest === true && pressed.disabled === false,
		JSON.stringify({ ready: controlReady.ok, ...pressed }),
	);
	const rowGeometry = await cdp.evaluate(`(() => {
		const stamp = document.querySelector('[data-tour-tag="canvas-document-modified"]');
		const note = document.querySelector('[data-tour-tag="canvas-document-freshness-note"]');
		const control = document.querySelector('[data-tour-tag="canvas-refresh-file-button"]');
		const row = document.querySelector('[data-tour-tag="canvas-document-freshness"]');
		const region = stamp ? stamp.parentElement : null;
		if (!stamp || !control || !row) return null;
		return {
			stamp: { client: stamp.clientWidth, scroll: stamp.scrollWidth },
			note: note ? { client: note.clientWidth, scroll: note.scrollWidth, text: note.textContent.slice(0, 40) } : null,
			controlRight: Math.round(control.getBoundingClientRect().right),
			/*
			 * The ROW is the width the dock clips; the id the scene first measured
			 * against reports a zero-width box here, so that comparison was between
			 * two different things and failed a control that is plainly inside. The
			 * inset is asserted too, because it is D1's own claim: the control's right
			 * edge is short of the row's by the panel's 8px chrome inset.
			 */
			rowRight: Math.round(row.getBoundingClientRect().right),
			region: region ? { client: region.clientWidth, scroll: region.scrollWidth } : null,
		};
	})()`);
	/*
	 * THE STAMP KEEPS ITS FULL WIDTH WHILE A SENTENCE IS ON SCREEN (design round 2,
	 * D7). Round 1 made both text elements shrinkable and flex shrank them in
	 * proportion to their width, so the LONG sentence pushed the STAMP into
	 * ellipsis - the fact the row exists to state, gone before the sentence beside
	 * it. This is the measurement that says the row now does the opposite.
	 */
	check(
		"the stamp is not clipped while the sentence is beside it",
		rowGeometry !== null &&
			rowGeometry.stamp.scroll <= rowGeometry.stamp.client,
		JSON.stringify(rowGeometry),
	);
	check(
		"and the control is inside the row, on the panel's own 8px chrome inset",
		rowGeometry !== null &&
			rowGeometry.controlRight <= rowGeometry.rowRight &&
			rowGeometry.rowRight - rowGeometry.controlRight <= 12,
		JSON.stringify({
			controlRight: rowGeometry?.controlRight,
			rowRight: rowGeometry?.rowRight,
			inset: rowGeometry
				? rowGeometry.rowRight - rowGeometry.controlRight
				: null,
		}),
	);
	const refreshed = await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).text.includes("third-version")`,
		6000,
	);
	const refreshedStore = await storedDocument(cdp, markdown);
	check(
		"the refresh control re-reads the file the poll had left alone",
		refreshed.ok,
		`the editor says ${JSON.stringify(String(refreshed.last).slice(0, 60))}; the store holds ${JSON.stringify(String(refreshedStore?.content).slice(0, 60))}`,
	);
	check(
		"the press is what re-read it, and the file's own mtime is untouched by it",
		refreshed.ok && refreshedStore?.readMtimeMs === markdownMtime1,
		`baseline ${refreshedStore?.readMtimeMs}, file mtime ${markdownMtime1}`,
	);

	const after = await captureSettled(cdp, "canvas-freshness-after");
	check(
		"the after frame is stable and toast-free",
		after.stable && after.toastFree,
		`attempts=${after.attempts} stable=${after.stable} toastFree=${after.toastFree}`,
	);

	/*
	 * ---- the second document: a background tab is not polled ------------------
	 *
	 * Opening it makes IT the document on screen, which is what puts the first
	 * one into the state this half is about: a tab that is open, whose file keeps
	 * changing, that nothing is looking at. The instrument is the app's own
	 * store, because the app's bridge cannot be wrapped from the page (a
	 * `contextBridge` object ignores the assignment silently) and because the
	 * store answers the question that matters: did the app's held bytes move.
	 */
	const secondOpen = await verb(cdp, "openCanvasDocument", { path: code });
	note("openCanvasDocument (second)", JSON.stringify(secondOpen));
	const onCode = await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).text.includes("code-first-version")`,
		5000,
	);
	check(
		"the second document opened in its own tab and became the one on screen",
		onCode.ok,
		JSON.stringify(secondOpen),
	);

	const backgroundSince = Date.now();
	writeFileSync(markdown, markdownBody("fourth-version"));
	const markdownMtime2 = setExactMtime(markdown, MARKDOWN_T2);
	await wait(CANVAS_FRESHNESS_POLL_MS * 2 + 1000);
	const backgroundHeld = await storedDocument(cdp, markdown);
	const backgroundShown = await canvasDocumentText(cdp);
	const backgroundProbes = await mainCalls(main, markdown, backgroundSince);
	const onScreenProbes = await mainCalls(main, code, backgroundSince);
	check(
		"a tab that is off screen is NOT PROBED - the app does not look at it at all",
		backgroundProbes === 0,
		`${backgroundProbes} probe(s) for the off-screen document and ${onScreenProbes} for the one on screen, in ${Date.now() - backgroundSince}ms`,
	);
	check(
		"and nothing was applied to it either, so the two claims agree",
		backgroundHeld?.content.includes("fourth-version") === false,
		`the store holds ${JSON.stringify(String(backgroundHeld?.content).slice(0, 60))} for a file whose mtime moved about ${Date.now() - markdownMtime2}ms ago`,
	);
	check(
		"and the tab that IS on screen is still the other document",
		backgroundShown.text.includes("code-first-version"),
		`${backgroundShown.surface}: ${JSON.stringify(backgroundShown.text.slice(0, 60))}`,
	);

	/*
	 * Switching to it is the activation the design leans on: the check happens on
	 * the switch, within a moment, rather than whenever the poll next came round.
	 */
	const switchAt = Date.now();
	const switched = await verb(cdp, "press", { selector: CANVAS_TAB_SELECTOR });
	const activated = await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).text.includes("fourth-version")`,
		CANVAS_FRESHNESS_POLL_MS,
	);
	const activationLatencyMs = Date.now() - switchAt;
	const activatedStore = await storedDocument(cdp, markdown);
	check(
		"switching to the tab applies what changed while it was off screen",
		activated.ok && activatedStore?.content === markdownBody("fourth-version"),
		`applied ${activationLatencyMs}ms after the switch; the store now holds ${JSON.stringify(String(activatedStore?.content).slice(0, 60))}`,
	);
	const switchProbes = await mainCalls(main, markdown, switchAt);
	check(
		"and the switch is what paid for it: it probed the path, inside one poll interval",
		activated.ok &&
			activationLatencyMs < CANVAS_FRESHNESS_POLL_MS &&
			switchProbes >= 1,
		`applied ${activationLatencyMs}ms after the switch on ${switchProbes} probe(s), against a ${CANVAS_FRESHNESS_POLL_MS}ms poll`,
	);
	const stampOnSwitch = await textOf(
		cdp,
		'[data-tour-tag="canvas-document-modified"]',
	);
	const expectedStamp2 = await cdp.evaluate(
		`new Date(${markdownMtime2}).toLocaleString(navigator.language, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })`,
	);
	check(
		"the line moved with the file the switch applied",
		stampOnSwitch === `Modified ${expectedStamp2}`,
		`${JSON.stringify(stampOnSwitch)} against ${JSON.stringify(`Modified ${expectedStamp2}`)}`,
	);
	note(
		"the tab the switch pressed",
		JSON.stringify(
			await cdp.evaluate(`(() => {
				const tabs = Array.from(document.querySelectorAll(${JSON.stringify(CANVAS_TAB_SELECTOR)}));
				const active = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
				return {
					tabs: tabs.map((tab) => tab.textContent),
					active: active ? active.textContent : null,
					target: ${JSON.stringify(switched.target)},
				};
			})()`),
		),
	);

	const activation = await captureSettled(cdp, "canvas-freshness-activation");
	check(
		"the activation frame is stable and toast-free",
		activation.stable && activation.toastFree,
		`attempts=${activation.attempts} stable=${activation.stable} toastFree=${activation.toastFree}`,
	);

	/*
	 * ---- the HTML document: the one viewer whose bytes the BACKEND fetches ----
	 *
	 * WHY IT GETS ITS OWN HALF (code review round 1, M1). Every other viewer is
	 * reachable from a store write: the text kinds re-read from `document.content`
	 * and the byte kinds re-key an object URL. `html` renders a URL the backend
	 * serves, inside an iframe, and the store write alone changed nothing on
	 * screen - so this was the one kind where the freshness line moved, the store
	 * held the file's new bytes, and the reader kept looking at the old document.
	 *
	 * HOW IT IS MEASURED. The iframe is cross-origin from the app, so its DOM
	 * cannot be read back; what CAN be observed is the request it makes, and that
	 * is exactly the claim - the preview fetched the new bytes rather than keeping
	 * the document it was showing. The renderer client records every request
	 * (`Network.enable` in `CdpClient.attach`).
	 */
	const htmlPath = join(dir, "panel.html");
	const htmlBody = (marker) =>
		`<!doctype html>\n<html>\n<body>\n<p id="marker">${marker}</p>\n</body>\n</html>\n`;
	writeFileSync(htmlPath, htmlBody("html-first-version"));
	const htmlMtime0 = setExactMtime(htmlPath, BASE_SECOND - 300);
	const htmlOpen = await verb(cdp, "openCanvasDocument", { path: htmlPath });
	note("openCanvasDocument (html)", JSON.stringify(htmlOpen));
	const htmlMounted = await waitForCondition(
		cdp,
		`Boolean(document.querySelector('#canvas-document-panel iframe'))`,
		10_000,
	);
	const htmlRequests = () =>
		cdp.requests.filter((entry) => entry.url.includes("panel.html")).length;
	const htmlPanelState = await cdp.evaluate(`(() => {
		const tabs = Array.from(document.querySelectorAll(${JSON.stringify(CANVAS_TAB_SELECTOR)}));
		const active = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
		const stamp = document.querySelector('[data-tour-tag="canvas-document-modified"]');
		return {
			tabs: tabs.map((tab) => tab.textContent),
			active: active ? active.textContent : null,
			iframe: Boolean(document.querySelector("#canvas-document-panel iframe")),
			codeMirror: Boolean(document.querySelector("#canvas-document-panel .cm-content")),
			freshnessRow: Boolean(
				document.querySelector('[data-tour-tag="canvas-document-freshness"]'),
			),
			stamp: stamp ? stamp.textContent : null,
		};
	})()`);
	check(
		"the html document opened in its own viewer, at the mtime the file has",
		htmlMounted.ok && htmlOpen.readMtimeMs === htmlMtime0,
		`${htmlOpen.readMtimeMs} against ${htmlMtime0}; iframe mounted=${htmlMounted.ok}; panel=${JSON.stringify(htmlPanelState)}`,
	);
	const htmlRequestsBefore = await htmlRequests();
	const htmlBefore = await captureSettled(cdp, "canvas-freshness-html-before");
	check(
		"the html preview's before frame is stable and toast-free",
		htmlBefore.stable && htmlBefore.toastFree,
		`attempts=${htmlBefore.attempts} stable=${htmlBefore.stable} toastFree=${htmlBefore.toastFree}`,
	);

	writeFileSync(htmlPath, htmlBody("html-second-version"));
	const htmlMtime1 = setExactMtime(htmlPath, BASE_SECOND - 200);
	const htmlApplied = await waitForCondition(
		cdp,
		`(() => { const raw = window.localStorage.getItem("canvas-store"); return raw ? raw.includes("html-second-version") : false; })()`,
		CANVAS_FRESHNESS_POLL_MS * 4,
	);
	const htmlRequestsAfter = await htmlRequests();
	check(
		"a file written on disk while its html tab is open reaches the store",
		htmlApplied.ok,
		`waited ${CANVAS_FRESHNESS_POLL_MS * 4}ms; the store says ${String(htmlApplied.last)}`,
	);
	check(
		"and the preview FETCHED it again - the viewer the store write alone could not reach",
		htmlRequestsAfter > htmlRequestsBefore,
		`${htmlRequestsAfter - htmlRequestsBefore} new request(s) for panel.html (before ${htmlRequestsBefore}, after ${htmlRequestsAfter})`,
	);
	const htmlAfter = await captureSettled(cdp, "canvas-freshness-html-after");
	check(
		"the html preview's after frame is stable and toast-free",
		htmlAfter.stable && htmlAfter.toastFree,
		`attempts=${htmlAfter.attempts} stable=${htmlAfter.stable} toastFree=${htmlAfter.toastFree}`,
	);
	const htmlStamp = await textOf(
		cdp,
		'[data-tour-tag="canvas-document-modified"]',
	);
	const expectedHtmlStamp = await cdp.evaluate(
		`new Date(${htmlMtime1}).toLocaleString(navigator.language, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })`,
	);
	check(
		"and the html document's line moved with the file",
		htmlStamp === `Modified ${expectedHtmlStamp}`,
		`${JSON.stringify(htmlStamp)} against ${JSON.stringify(`Modified ${expectedHtmlStamp}`)}`,
	);
	/*
	 * ---- the dirty document: the hold, and what a press does to the FILE ----
	 *
	 * WHY THIS PHASE EXISTS (UX round 3, U9; QA round 3, Q9). The scene was 50/50
	 * green while a press that promised to LOAD the file's version destroyed it
	 * instead: every check above reads the editor and the store, and not one of them
	 * read the FILE. A defect that overwrites the reader's file - or the external
	 * version they were told about - is exactly the kind that leaves a green scene
	 * looking healthy, so this half asserts bytes and hashes on disk after every
	 * step, and a press that writes when it should only read now fails here.
	 *
	 * It also drives the gate (QA Q9): the editor's debounce is 1s and the poll is
	 * 2s, so a file rewritten on disk just before a debounce fires is the ordering no
	 * timer can cover. The gate is inside the write, and this is where that shows.
	 */
	const fileHash = (path) =>
		createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
	/*
	 * A node-side wait, because every claim in this phase is about the FILE and
	 * `waitForCondition` evaluates in the page. Reads the bytes repeatedly rather
	 * than sleeping a fixed time, so a slow write is waited for and a fast one is not
	 * slept through.
	 */
	const waitForFile = async (path, predicate, timeoutMs) => {
		const started = Date.now();
		let last = "";
		while (Date.now() - started < timeoutMs) {
			try {
				last = readFileSync(path, "utf8");
			} catch {
				last = "";
			}
			if (predicate(last)) return { ok: true, last };
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
		}
		return { ok: false, last };
	};
	const typeText = async (cdp, text) => {
		/*
		 * Chromium's own input pipeline, one character at a time. `Input.insertText`
		 * was measured not to move the WYSIWYG model (QA round 3), so the same shape
		 * the app receives from a keyboard is what this uses.
		 */
		for (const char of text) {
			await cdp.send("Input.dispatchKeyEvent", {
				type: "keyDown",
				text: char,
				key: char,
				unmodifiedText: char,
			});
			await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: char });
		}
	};

	const typedPath = join(dir, "typing.py");
	const readerWord = "READER";
	const externalBody = 'print("external-rewrite")\n';
	writeFileSync(typedPath, 'print("first-version")\n');
	const typedMtime0 = setExactMtime(typedPath, BASE_SECOND - 240);
	const typedOpen = await verb(cdp, "openCanvasDocument", { path: typedPath });
	note("openCanvasDocument (typing)", JSON.stringify(typedOpen));
	await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).surface === "code"`,
		10_000,
	);

	// The reader's typing reaches the file through the ordinary autosave and the
	// gate, which is the path every keystroke in this app takes.
	await verb(cdp, "press", "#canvas-document-panel .cm-content");
	await typeText(cdp, readerWord);
	const typedSaved = await waitForFile(
		typedPath,
		(bytes) => bytes.includes(readerWord),
		6_000,
	);
	check(
		"the reader's typing reached the file through the gate, and the baseline followed it",
		typedSaved.ok,
		`file=${JSON.stringify(typedSaved.last.slice(0, 60))}`,
	);
	const hashBeforeExternal = fileHash(typedPath);

	// Now the file is rewritten from OUTSIDE, while the document is dirty.
	const dirtyWord = "DIRTY";
	await verb(cdp, "press", "#canvas-document-panel .cm-content");
	await typeText(cdp, dirtyWord);
	writeFileSync(typedPath, externalBody);
	setExactMtime(typedPath, BASE_SECOND - 120);
	const externalHash = fileHash(typedPath);

	const factAppeared = await waitForCondition(
		cdp,
		`(() => {
			const note = document.querySelector('[data-tour-tag="canvas-document-freshness-note"]');
			return Boolean(note) && /changed on disk/i.test(note.textContent ?? "");
		})()`,
		8_000,
	);
	check(
		"a file rewritten under a dirty buffer raises the sticky fact",
		factAppeared.ok,
		`${JSON.stringify(factAppeared.last)} after ${factAppeared.attempts} attempt(s)`,
	);

	/*
	 * THE HOLD, MEASURED ON THE FILE. Four seconds is two polls and four debounce
	 * windows: if any of them wrote, the bytes below would be the reader's.
	 */
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 4200));
	const hashWhileHeld = fileHash(typedPath);
	note(
		"hashes: the file's sha256 before the external rewrite, the external version, and after 4.2s of held ticks",
		JSON.stringify({
			beforeExternal: hashBeforeExternal,
			external: externalHash,
			afterHoldWindow: hashWhileHeld,
		}),
	);
	check(
		"no in-app write reached the file while the fact stood",
		hashWhileHeld === externalHash,
		`held=${hashWhileHeld} external=${externalHash} (before the external rewrite: ${hashBeforeExternal})`,
	);

	/*
	 * A FRAME OF THE HELD STATE, because the sentence is the thing this round
	 * changed and no committed frame had ever shown a fact rather than an answer:
	 * design round 3 measured its 694px against the pane from a rig of its own, and
	 * the reader's half of the same finding (U10) was measured the same way.
	 */
	const heldFrame = await captureSettled(cdp, "canvas-freshness-held");
	check(
		"the held state is a frame the app held still for, with no toast on it",
		heldFrame.stable === true && heldFrame.toastFree === true,
		JSON.stringify(heldFrame),
	);

	// The sentence a reader has to act on has to be ON SCREEN (D10).
	const noteGeometry = await cdp.evaluate(`(() => {
		const note = document.querySelector('[data-tour-tag="canvas-document-freshness-note"]');
		if (!note) return null;
		return {
			client: note.clientWidth,
			scroll: note.scrollWidth,
			text: note.textContent,
			regionClient: note.parentElement ? note.parentElement.clientWidth : null,
			regionScroll: note.parentElement ? note.parentElement.scrollWidth : null,
		};
	})()`);
	check(
		"the sentence fits the row: no ellipsis, and the way out is on screen",
		noteGeometry !== null &&
			noteGeometry.scroll <= noteGeometry.client &&
			/save to replace it/.test(noteGeometry.text ?? ""),
		JSON.stringify(noteGeometry),
	);

	/*
	 * THE PRESS, AND ITS EFFECT ON THE FILE (UX U9). The control says it loads the
	 * file's version and discards the unsaved edits; the assertion that matters is
	 * that the file is UNTOUCHED by it, and that what the reader now sees is what the
	 * file holds.
	 */
	const hashBeforePress = fileHash(typedPath);
	const typedPress = await verb(cdp, "press", {
		selector: '[data-tour-tag="canvas-refresh-file-button"]',
	});
	const adopted = await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).text.includes("external-rewrite")`,
		8_000,
	);
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
	const hashAfterPress = fileHash(typedPath);
	note(
		"hashes: the file around the press that loads its version",
		JSON.stringify({
			beforePress: hashBeforePress,
			afterPress: hashAfterPress,
			external: externalHash,
			identical:
				hashAfterPress === hashBeforePress && hashAfterPress === externalHash,
		}),
	);
	check(
		"the press loaded the file's version and did not write to the file",
		adopted.ok && hashAfterPress === hashBeforePress,
		`adopted=${adopted.ok} before=${hashBeforePress} after=${hashAfterPress} external=${externalHash} press=${JSON.stringify(typedPress)}`,
	);
	check(
		"and the file the press loaded is the EXTERNAL version, not the reader's",
		hashAfterPress === externalHash,
		`after=${hashAfterPress} external=${externalHash}`,
	);

	/*
	 * THE EXPLICIT SAVE, the other route out, on the surface that had none (QA Q10,
	 * code review A): a real Meta+S must put the reader's bytes on disk and the row
	 * must say what they replaced.
	 */
	await verb(cdp, "press", "#canvas-document-panel .cm-content");
	await typeText(cdp, "SAVED");
	const typedLanded = await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).text.includes("SAVED")`,
		4_000,
	);
	/*
	 * PROVE THE TYPING LANDED, or the checks below measure nothing. The first draft
	 * of this phase pressed Meta+S on a buffer whose click had not focused the
	 * editor, so the "reader's save" wrote the file's own bytes back: the row said
	 * "replaced", the file was unchanged, and only the hash assertions caught it.
	 */
	check(
		"the reader's second round of typing reached the editor this time",
		typedLanded.ok,
		JSON.stringify(typedLanded.last),
	);
	writeFileSync(typedPath, 'print("second-external")\n');
	setExactMtime(typedPath, BASE_SECOND - 90);
	await waitForCondition(
		cdp,
		`(() => {
			const note = document.querySelector('[data-tour-tag="canvas-document-freshness-note"]');
			return Boolean(note) && /changed on disk/i.test(note.textContent ?? "");
		})()`,
		8_000,
	);
	await pressChord(cdp, {
		key: "s",
		code: "KeyS",
		virtualKeyCode: 83,
		modifiers: 4,
	});
	const savedOver = await waitForCondition(
		cdp,
		`(() => {
			const note = document.querySelector('[data-tour-tag="canvas-document-freshness-note"]');
			return Boolean(note) && /replaced/i.test(note.textContent ?? "");
		})()`,
		8_000,
	);
	note(
		"hashes: the file after the reader's Meta+S",
		JSON.stringify({
			afterSave: fileHash(typedPath),
			external: externalHash,
			readerWon: fileHash(typedPath) !== externalHash,
		}),
	);
	const savedBytes = await waitForFile(
		typedPath,
		(bytes) => bytes.includes("SAVED"),
		6_000,
	);
	const fileAfterSave = savedBytes.last;
	check(
		"Meta+S on a held document writes the reader's bytes, and the row says what they replaced",
		savedOver.ok && savedBytes.ok,
		`note=${JSON.stringify(savedOver.last)} file=${JSON.stringify(fileAfterSave.slice(0, 60))}`,
	);
	check(
		"and the file the reader's save replaced is not the one the press loaded",
		fileAfterSave !== externalBody,
		JSON.stringify(fileAfterSave.slice(0, 60)),
	);
}

// ---- gate-check --------------------------------------------------------------

/**
 * The `Log path: …` lines the app itself wrote, from this run's scratch logs.
 *
 * Read from the file rather than from the variable this script exported: the
 * question is where the app RESOLVED its logs, and a run whose lines land in the
 * operator's directory is not isolated however many other paths are redirected.
 */
/**
 * The composer's syntax highlight, measured rather than described.
 *
 * The highlight is a `<textarea>` whose own text is transparent over a mirror
 * that paints the glyphs, so the ONLY thing that makes it a highlight rather
 * than a smear is that the two layers wrap at the same character. That is a
 * metric property, and this scene is where it is measured: the mirror's
 * `clientWidth` against the textarea's, the computed `font` string of each, the
 * row count of a wrapped draft, the y of each painted run against the mirror's
 * own first line box, and the right-padding correction the scrollbar forces.
 *
 * It needs a composer to measure, and without `--backend` (see the isolation
 * notes above) the pane mounts none: the branch below records that rather than
 * reporting an empty pass, and the same numbers are measured in the Storybook
 * harness, which has the command vocabulary this surface requires.
 *
 * The drafts are the four shapes the rule has to keep apart, driven through the
 * app's real input pipeline (`Input.insertText` after a React-compatible clear,
 * the same domain `--scene palette` types through): a recognised command bar, a
 * start command whose instruction spans lines, a slash token inside a sentence,
 * and the operator's own prose draft that merely OPENS with a command word.
 * Each is measured in both brand palettes, one is measured in a narrowed
 * composer, and one is measured with a CLASSIC scrollbar forced onto the field
 * — the state the padding correction exists for, and the one macOS overlay
 * scrollbars would otherwise hide on this machine (stated as a limit rather
 * than implied to have been reproduced).
 *
 * The numbers land in `composer-geometry.json` beside the frames, because a
 * frame shows that the tint is somewhere near the word and only the numbers say
 * whether it is ON it.
 */
/**
 * The y term of a computed `transform`, in px, and 0 for `none`.
 *
 * The mirror's window is kept on the textarea's by writing `translateY(-scrollTop)`
 * straight to the node, so the value under test is that term: `matrix(a, b, c, d,
 * tx, ty)` keeps it last, and `translateY(y)` — which Chromium resolves to a matrix
 * for any non-`none` value but need not in principle — has it first.
 */
function translateYOf(transform) {
	if (!transform || transform === "none") return 0;
	const parts = transform
		.slice(transform.indexOf("(") + 1, transform.lastIndexOf(")"))
		.split(",");
	return Number.parseFloat(parts.length >= 6 ? parts[5] : parts[0]) || 0;
}

async function sceneComposer(cdp) {
	const hello = await verb(cdp, "hello");
	note("hello", JSON.stringify(hello, null, 2));
	const facts = await factsOf(cdp);
	note("facts (from main)", JSON.stringify(facts, null, 2));
	check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);

	/*
	 * IS THERE A COMPOSER AT ALL? A run WITHOUT `--backend` has no backend, and the
	 * chat pane says so: it renders its unreachable-backend state, in which the
	 * composer is not mounted (measured — see the frame this branch captures). That
	 * is not a failure of this scene and must not be reported as one: the
	 * highlight's vocabulary comes from the backend's `commands.list`, so with no
	 * backend there is nothing for the composer to recognise and nothing to
	 * measure. The geometry is measured where a vocabulary exists — the Storybook
	 * harness (`Chat/Slash highlight`, whose `geometry` story prints this same
	 * readback into the frame) — and this branch records the fact rather than an
	 * empty pass.
	 *
	 * WITH `--backend` THE COMPOSER MOUNTS, and the scene now REACHES that state
	 * rather than describing it. QA round 2 Q2 is the reason this is code and not a
	 * comment: the flag's contract is that the renderer was built against the same
	 * `VITE_LOCAL_OPERATOR_API_URL` and that the run OWNS the daemon, but a fresh
	 * profile in front of a fresh daemon sits on `/chat` with NO session — and the
	 * chat pane mounts no composer until one is open, so `composerPresent` was false
	 * by construction, the geometry below was unreachable from this rig's own entry
	 * points, and a 30px clip-window displacement (also QA round 2, Q1) shipped
	 * through a green scene claiming to measure exactly that state. The round-1
	 * correction landed in this comment; it belongs in the path, so with `--backend`
	 * the scene now does what a user does: create a conversation on the run's OWN
	 * daemon, open the chat route, widen the sidebar's list and press the
	 * conversation's row.
	 *
	 * The scene's other value is unchanged: it proves the absence branch and the
	 * window-mode checks, and it holds the predicates the Storybook readback's
	 * numbers must satisfy so the two rigs cannot drift. Its two predicates were
	 * rewritten after round 1, because each could never pass where this scene runs:
	 * `mirrorClientWidth === textareaClientWidth` is false by exactly the scrollbar
	 * gutter, and the run-top origin was `paddingTop` rather than the line's own
	 * inline box.
	 */
	if (BACKEND) {
		/*
		 * The conversation is created over the desktop API the app itself uses, with
		 * the run's own bearer: a session that already exists is fine too, which is
		 * why the row press below is guarded on the row being there rather than on
		 * the POST's shape.
		 */
		const created = await createBackendSession();
		note("a conversation on this run's own backend", JSON.stringify(created));
		check(
			"the composer's own state is reachable: a conversation exists on this run's backend",
			Boolean(created.id),
			JSON.stringify(created),
		);
		await verb(cdp, "navigate", "/chat");
		/*
		 * Asked of the DOM before pressing: `press` throws on a selector that matches
		 * nothing, and a scene that died here would report nothing about the state it
		 * was trying to reach. These are the two controls the browser-pane scene
		 * already opens a conversation with, so this is the app's own path rather than
		 * a test door.
		 */
		const visible = async (selector) =>
			cdp.evaluate(
				`Boolean(document.querySelector(${JSON.stringify(selector)}))`,
			);
		const row = '[data-tour-tag="chat-session-row"]';
		if (await visible('[data-tour-tag="chat-all-chats"]')) {
			await verb(cdp, "press", {
				selector: '[data-tour-tag="chat-all-chats"]',
			});
		}
		/*
		 * AND THE ROW IS WAITED FOR, which the first form of this path got wrong: the
		 * conversation was created (status 200, an id) and the app had it in its
		 * catalogue (`sessionCount: 1`) while the list had not painted a row yet, so a
		 * single 400ms look found nothing, nothing was pressed, and the scene quietly
		 * took the absence branch with `activeSessionId: null` — the exact failure QA
		 * round 2 Q2 named, one layer in. The list is fed by the app's own poll, so the
		 * wait is bounded and its expiry is REPORTED rather than silently passing.
		 */
		let rowPressed = false;
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			if (await visible(row)) {
				await verb(cdp, "press", { selector: row });
				rowPressed = true;
				break;
			}
			await wait(500);
		}
		/*
		 * A ROW THAT NEVER PAINTED IS A FAILURE (review round 3 MINOR 1). It was a
		 * `note`, and `note` does not fail the run: the scene then fell into the
		 * absence branch below, wrote a readback that says "no backend" about a run
		 * whose backend had just answered, and exited 0 with none of the geometry
		 * checks it exists for executed. That is QA round 2 Q2's failure mode one
		 * layer in, and it is Q2's own lesson that a path which cannot fail is not a
		 * gate — so the reachability of the state is asserted here, on the composer
		 * this time rather than on the POST.
		 */
		check(
			"the conversation catalogue painted a row for this run's conversation, so the composer can mount",
			rowPressed,
			`${row} never appeared within 20s — the conversation exists on the backend and the chat pane mounts no composer without an open one`,
		);
		if (rowPressed) await wait(600);
		note(
			"state (chat, after the conversation press)",
			JSON.stringify(await verb(cdp, "state")),
		);
	}
	const composerPresent = await cdp.evaluate(
		`Boolean(document.querySelector('textarea[aria-label="Message"]'))`,
	);
	if (!composerPresent) {
		const frame = await captureSettled(cdp, "composer-absent-no-backend");
		/*
		 * TWO ABSENCES, TWO SENTENCES (review round 3 MINOR 1). "No backend" and "the
		 * backend answered but the catalogue never painted a row" leave the same
		 * `composerPresent: false` behind and had one sentence between them, which is
		 * how a scene can report the wrong cause on a path it also exited 0 from. The
		 * difference does not live in the state string above: it is `rowPressed`.
		 */
		const readback = {
			note: BACKEND
				? "This run HAS an isolated backend and its conversation was created, but the chat pane never painted a conversation row within 20s, so no composer mounted and no draft could be typed into one. That is a failure of the state this scene asserts (see the check above), not an absence of a backend."
				: "A driver run has no backend: the chat pane renders its unreachable-backend state, no composer is mounted, and no draft can be typed into one. The highlight's geometry is measured in the Storybook harness (`Chat/Slash highlight` -> `geometry`), the only surface with a command vocabulary. Recorded here rather than reported as a pass.",
			measuredAt: new Date().toISOString(),
			windowSize: facts.windowSize,
			composerPresent: false,
			frame: frame.path,
		};
		writeFileSync(
			join(FRAMES, "composer-geometry.json"),
			`${JSON.stringify(readback, null, 2)}\n`,
		);
		note("composer halted", JSON.stringify(readback));
		return;
	}
	note(
		"composer present",
		"the chat pane mounted a composer, so this run measures it",
	);

	const geometryOf = () =>
		cdp.evaluate(`(() => {
			const ta = document.querySelector('textarea[aria-label="Message"]');
			if (!ta) return { missing: "textarea" };
			const t = getComputedStyle(ta);
			const lineHeight = Number.parseFloat(t.lineHeight);
			const padTop = Number.parseFloat(t.paddingTop);
			const padBottom = Number.parseFloat(t.paddingBottom);
			const out = {
				draft: ta.value,
				mirrorRendered: false,
				textareaColor: t.color,
				caretColor: t.caretColor,
				textareaClientWidth: ta.clientWidth,
				textareaOffsetWidth: ta.offsetWidth,
				scrollbarGutter: ta.offsetWidth - ta.clientWidth,
				textareaPaddingRight: Number.parseFloat(t.paddingRight),
				textareaPaddingTop: padTop,
				textareaFont: t.font,
				lineHeight,
				textareaRows: Math.round((ta.scrollHeight - padTop - padBottom) / lineHeight),
				scrollTop: ta.scrollTop,
			};
			const mirror = document.querySelector('[data-composer-mirror]');
			/*
			 * The GLYPH layer, one node in from the clip window. The split is the fix for
			 * QA round 2 Q1 and this readback has to keep the two apart: the transform and
			 * the text metrics belong to the glyph layer, the box that clips belongs to
			 * the window, and moving the transform onto the clip node displaces the window
			 * with the paint (the field's bottom line unpainted, the mirror painting above
			 * the composer's top edge).
			 */
			const paint = document.querySelector('[data-composer-mirror-paint]');
			if (!mirror || !paint) return out;
			const m = getComputedStyle(paint);
			const box = paint.getBoundingClientRect();
			const clip = mirror.getBoundingClientRect();
			const field = ta.getBoundingClientRect();
			let before = "";
			const runs = [];
			for (const node of paint.childNodes) {
				if (node.nodeType === 3) { before += node.textContent || ""; continue; }
				const text = node.textContent || "";
				if (node.dataset && node.dataset.slashRun) {
					const rect = node.getBoundingClientRect();
					runs.push({
						kind: node.dataset.slashRun,
						text,
						newlinesBefore: before.split("\\n").length - 1,
						top: rect.top - box.top,
						left: rect.left - box.left,
						height: rect.height,
					});
				}
				before += text;
			}
			return {
				...out,
				mirrorRendered: true,
				mirrorClientWidth: paint.clientWidth,
				mirrorOffsetWidth: paint.offsetWidth,
				mirrorPaddingRight: Number.parseFloat(m.paddingRight),
				mirrorPaddingTop: Number.parseFloat(m.paddingTop),
				/*
				 * WHICH BOX CLIPS WHAT IS PAINTED, the assertion the old one-node reading
				 * could not make (QA round 2 Q1): the clip window's top against the field's
				 * own, and the paint's top against the clip window's (the transform, i.e.
				 * glyphs moving inside a window that does not). A displaced window satisfies
				 * translateY == -scrollTop and equal content heights while hiding the line
				 * the caret is on.
				 */
				clipBoxOffsetFromField: clip.top - field.top,
				paintBoxOffsetFromClip: box.top - clip.top,
				mirrorClipHeight: clip.height,
				/*
				 * The inline box the runs are measured AGAINST. paddingTop is the
				 * wrong origin and this scene asserted against it: an inline element's
				 * rect is its FONT's content box, half a leading below the line box, so
				 * a run's top sits ~2.5px under paddingTop for a 14px font on a 21.7px
				 * line — twelve "failures" that were how inline boxes are measured
				 * rather than any drift (QA round 1 Q2). The mirror's own first text
				 * node is the honest origin: both are inline boxes on the line the tint
				 * names. (No backticks in here: this whole block is inside a template
				 * literal.)
				 */
				mirrorFirstLineTop: (() => {
					const node = paint.firstChild;
					if (!node) return null;
					const range = document.createRange();
					range.selectNodeContents(node);
					const rect = range.getBoundingClientRect();
					return rect.top - box.top;
				})(),
				mirrorFont: m.font,
				mirrorRows: Math.round((paint.scrollHeight - Number.parseFloat(m.paddingTop) - Number.parseFloat(m.paddingBottom)) / Number.parseFloat(m.lineHeight)),
				mirrorScrollHeight: paint.scrollHeight,
				textareaScrollHeight: ta.scrollHeight,
				mirrorTransform: getComputedStyle(paint).transform,
				runs,
			};
		})()`);

	/** A React-compatible clear, then the app's own input pipeline types. */
	const setDraft = async (text) => {
		await cdp.evaluate(`(() => {
			const ta = document.querySelector('textarea[aria-label="Message"]');
			if (!ta) return "no textarea";
			ta.focus();
			const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
			setter.call(ta, "");
			ta.dispatchEvent(new Event("input", { bubbles: true }));
			return "cleared";
		})()`);
		if (text) await cdp.send("Input.insertText", { text });
		await wait(120);
	};

	const DRAFTS = [
		// A recognised command bar. The mirror is on and the run is the word.
		["command-alone", "/compact"],
		// The operator's own shape: a start command whose instruction set spans
		// lines, with the name tinted separately from the prose tail.
		[
			"start-name-instruction",
			"/team frontend-guild review the queue\nand then ship it",
		],
		// A slash token inside a sentence: no run, so no mirror — the field keeps
		// its native rendering.
		["mid-sentence-token", "fix this /usage"],
		// The screenshot: prose that merely OPENS with a command word.
		[
			"prose-leading-command-word",
			"/mcp logout seems to cause a crash on the TUI,\ncan you review and fix that issue",
		],
		// A single line long enough to wrap in the composer: the row-count parity
		// check, and the case the scrollbar correction exists for.
		[
			"wrapped-command-line",
			"/compact please summarise the failing tests in the TUI crash report and then stop",
		],
	];
	/**
	 * WHICH DRAFTS THE PLAN SAYS CARRY A RUN, and therefore which must render the
	 * mirror — asserted per state below rather than declared and ignored.
	 *
	 * WHY THIS REPLACED A TABLE NOBODY READ (QA round 3 Q1): the old `_EXPECTS_RUN`
	 * was dead code that claimed two rows paint that do not, and the scene passed
	 * them with `with no command vocabulary the field keeps its native ink` — a
	 * message whose stated cause is false wherever a backend answers (39 options are
	 * offered for a bare `/`). The three `false` rows are the rule's own answers,
	 * measured on this scene's drafts: `/compact` with text after it is a draft the
	 * planner sends as written (so nothing paints and Enter posts prose), and
	 * `/team …` with a newline is the multi-line kill. Asserting paint ⇔ the plan is
	 * what would have caught the round-2 gap this scene exists to close, so it is
	 * asserted here instead of tabulated.
	 */
	const EXPECTS_PAINT = {
		"command-alone": true,
		"start-name-instruction": false,
		"mid-sentence-token": false,
		"prose-leading-command-word": false,
		"wrapped-command-line": false,
	};

	const readback = {
		note: "Beat 1 measured by --scene composer; mirror/text parity, run geometry and the scrollbar correction.",
		measuredAt: new Date().toISOString(),
		windowSize: facts.windowSize,
		themes: {},
		probes: {},
	};
	const frames = [];

	for (const theme of ["localOperatorDark", "localOperatorLight"]) {
		await verb(cdp, "setTheme", theme);
		const seen = [];
		for (const [label, draft] of DRAFTS) {
			await setDraft(draft);
			const geometry = await geometryOf();
			seen.push({ label, ...geometry });
			if (theme === "localOperatorDark" && label !== "wrapped-command-line") {
				const frame = await captureSettled(cdp, `composer-${label}`);
				frames.push({ label, path: frame.path, stable: frame.stable });
			}
		}
		readback.themes[theme] = seen;
	}

	/*
	 * The narrow composer. The driver's window is one size for the whole run, so
	 * the column is narrowed on the box itself and the mirror is asked to survive
	 * it: a narrower text column wraps earlier, which is exactly when a padding
	 * or font disagreement moves the tint off its glyph.
	 */
	await verb(cdp, "setTheme", "localOperatorDark");
	await setDraft(
		"/compact please summarise the failing tests in the TUI crash report and then stop",
	);
	const narrow = await cdp.evaluate(`(() => {
		const box = document.querySelector('[data-tour-tag="chat-input-textarea"]');
		if (!box) return "no composer box";
		box.style.width = "360px";
		window.dispatchEvent(new Event("resize"));
		return box.getBoundingClientRect().width;
	})()`);
	await wait(150);
	readback.probes.narrowColumn = {
		boxWidthCssPx: narrow,
		geometry: await geometryOf(),
	};
	const narrowFrame = await captureSettled(
		cdp,
		"composer-wrapped-command-narrow",
	);
	frames.push({
		label: "wrapped-command-narrow",
		path: narrowFrame.path,
		stable: narrowFrame.stable,
	});
	await cdp.evaluate(`(() => {
		const box = document.querySelector('[data-tour-tag="chat-input-textarea"]');
		if (box) box.style.width = "";
		window.dispatchEvent(new Event("resize"));
		return true;
	})()`);

	/*
	 * The scrollbar probe. macOS overlay scrollbars measure a 0px gutter, so the
	 * correction the mirror applies would be unexercised on this machine; forcing
	 * a CLASSIC scrollbar onto the field (a style the platform toggle produces)
	 * makes the arithmetic real, and the row-count parity below is what says the
	 * correction is what keeps the wrap points equal. Stated as a forced probe
	 * rather than a reproduction of the OS setting.
	 */
	await setDraft(
		"/compact please summarise the failing tests in the TUI crash report and then stop",
	);
	const forced = await cdp.evaluate(`(() => {
		const ta = document.querySelector('textarea[aria-label="Message"]');
		if (!ta) return "no textarea";
		ta.style.overflowY = "scroll";
		window.dispatchEvent(new Event("resize"));
		return { gutter: ta.offsetWidth - ta.clientWidth, clientWidth: ta.clientWidth };
	})()`);
	await wait(150);
	readback.probes.forcedScrollbar = { ...forced, geometry: await geometryOf() };
	const scrollFrame = await captureSettled(cdp, "composer-forced-scrollbar");
	frames.push({
		label: "forced-scrollbar",
		path: scrollFrame.path,
		stable: scrollFrame.stable,
	});
	await cdp.evaluate(`(() => {
		const ta = document.querySelector('textarea[aria-label="Message"]');
		if (ta) ta.style.overflowY = "";
		window.dispatchEvent(new Event("resize"));
		return true;
	})()`);

	readback.frames = frames;

	/*
	 * THE SCROLLED PARITY (code review round 1 MINOR 1).
	 *
	 * The mirror's window is kept on the textarea's by `translateY(-scrollTop)`,
	 * written per scroll frame, and nothing in either rig read it: the Storybook
	 * probes measured a box that was not scrolled, and this scene did not run at
	 * all. The failure it guards is a tint frozen one line behind its own glyphs
	 * while the user drags the scrollbar, so the state has to be produced — the
	 * composer scrolls its caret into view, so a draft taller than the box arrives
	 * scrolled, and this probe writes the offset explicitly because a caret-driven
	 * scroll can land at the bottom with the tinted first row already out of view.
	 *
	 * The draft is one logical line of the shape that PAINTS — a start command with
	 * its name list — because the check below is about the MIRROR's window and a
	 * draft the planner sends as written mounts no mirror at all (`/compact` with
	 * text after it is prose: measured in this scene's own Enter-parity table, QA
	 * round 2 Q4; a probe that dropped the mirror here would silently take the
	 * no-vocabulary branch instead of asserting anything). It wraps past the box's
	 * own `max-h-28`.
	 */
	await setDraft(
		"/team frontend-guild review every file in this queue, note which of the failing cases are flaky and which are deterministic, summarise the crash reports from the TUI in the order they were filed and say which of them share a cause, call out the two wrappers that disagree about the line they paint and say which one of them is right, then hand the whole summary to the reviewer together with the commands that reproduce each of the failing cases, the backend version each of those commands was taken against, and the theme that was active at the time, so that nothing is lost in the handover and the next reader can start where this one left off without asking a question about what came before it or which of the two wrappers was telling the truth, and keep the instruction short enough that the box scrolls only a little rather than to its end",
	);
	const scrolled = await cdp.evaluate(`(() => {
		const ta = document.querySelector('textarea[aria-label="Message"]');
		if (!ta) return { missing: "textarea" };
		const max = ta.scrollHeight - ta.clientHeight;
		if (max <= 0) return { canScroll: false, maxScroll: 0, scrollTop: 0 };
		/* One line down, so the tinted first row is still in the frame. */
		ta.scrollTop = Math.min(Number.parseFloat(getComputedStyle(ta).lineHeight), max);
		return { canScroll: true, maxScroll: max, scrollTop: ta.scrollTop };
	})()`);
	await wait(150);
	readback.probes.scrolled = { ...scrolled, geometry: await geometryOf() };
	const scrolledFrame = await captureSettled(cdp, "composer-scrolled-draft");
	frames.push({
		label: "scrolled-draft",
		path: scrolledFrame.path,
		stable: scrolledFrame.stable,
	});

	const readbackPath = join(FRAMES, "composer-geometry.json");
	writeFileSync(readbackPath, `${JSON.stringify(readback, null, 2)}\n`);
	note("geometry readback", readbackPath);

	/*
	 * The assertions, over the numbers just written.
	 *
	 * THE MIRROR IS NOT EXPECTED IN A BACKEND-LESS RUN, and that is a fact about this
	 * harness rather than about the change: the highlight's vocabulary comes from the
	 * backend's `commands.list`, a run without `--backend` has none (see the
	 * isolation notes at the top), so the composer recognises no command and paints
	 * nothing. What the scene can hold the app to is the state that follows from
	 * that — the field keeps its native ink, its own font and its own rows — and the
	 * mirror's parity is measured where a vocabulary exists: the Storybook harness
	 * (`Chat/Slash highlight`, whose `geometry` story prints the same readback into
	 * the frame) and this scene's own probes on a run whose backend HAS a session
	 * (QA round 1 Q2). A mirror that appears here without a vocabulary would mean one
	 * arrived from somewhere this run did not expect; its geometry is then checked
	 * rather than excused.
	 */
	const geometryChecks = [];
	for (const [theme, seen] of Object.entries(readback.themes)) {
		for (const entry of seen)
			geometryChecks.push([`${theme}/${entry.label}`, entry]);
	}
	geometryChecks.push([
		"localOperatorDark/wrapped-command-line@360px",
		readback.probes.narrowColumn.geometry,
	]);
	geometryChecks.push([
		"localOperatorDark/wrapped-command-line@classic-scrollbar",
		readback.probes.forcedScrollbar.geometry,
	]);
	geometryChecks.push([
		"localOperatorDark/tall-command-line@scrolled",
		readback.probes.scrolled.geometry,
	]);

	let mirrorsSeen = 0;
	for (const [where, geometry] of geometryChecks) {
		check(
			`${where}: the field is a real textarea with a text column`,
			geometry.textareaClientWidth > 0 && geometry.lineHeight > 0,
			`clientWidth=${geometry.textareaClientWidth} lineHeight=${geometry.lineHeight}`,
		);
		check(
			`${where}: the textarea's font is the composer's own`,
			/\d+(\.\d+)?px/.test(geometry.textareaFont),
			geometry.textareaFont,
		);
		/*
		 * PAINT ⇔ PLAN, PER STATE (QA round 3 Q1). The draft's label is the tail of
		 * `where` (`<theme>/<label>`, or `<theme>/<label>@<probe>` for the derived
		 * probes), and `EXPECTS_PAINT` above is the plan's own answer for each draft
		 * this scene types. This is the assertion the scene's dead table should have
		 * been: a mirror without a run is the tint lying about Enter, and a run
		 * without a mirror is the defect class QA round 1 Q1 measured.
		 */
		const draftLabel = where.split("/")[1]?.split("@")[0] ?? "";
		const expectsPaint = EXPECTS_PAINT[draftLabel];
		if (expectsPaint !== undefined) {
			check(
				`${draftLabel}: the mirror is mounted exactly where the plan says a run exists`,
				geometry.mirrorRendered === expectsPaint,
				`mirrorRendered=${geometry.mirrorRendered} expected=${expectsPaint}`,
			);
		}
		if (!geometry.mirrorRendered) {
			check(
				`${where}: an unpainted draft keeps the field's native ink`,
				geometry.textareaColor !== "rgba(0, 0, 0, 0)" &&
					geometry.textareaColor !== "transparent",
				`color=${geometry.textareaColor}`,
			);
			continue;
		}
		mirrorsSeen += 1;
		/*
		 * The mirror is not scrollable, so it spans the CONTENT box while the
		 * textarea loses the scrollbar's width from its client box. Equality of the
		 * two numbers is therefore false by exactly the gutter whenever one exists
		 * — which is the case the `forced-scrollbar` probe of this scene exists for
		 * (measured: `mirror=798 textarea=790`; QA round 1 Q2). What holds, and is
		 * what wrap parity needs, is that the mirror spans the textarea's box plus
		 * its gutter, with the padding-right correction asserted just below.
		 */
		check(
			`${where}: the layer that clips is the field's own viewport`,
			Math.abs(geometry.clipBoxOffsetFromField) <= 0.5,
			`clip box ${geometry.clipBoxOffsetFromField}px off the field's top (the box the window is: ${geometry.mirrorClipHeight}px) — the transform belongs to the glyph layer, or the scroll moves the clip window with the paint (QA round 2 Q1)`,
		);
		check(
			`${where}: the paint moves inside a window that does not`,
			Math.abs(geometry.paintBoxOffsetFromClip + geometry.scrollTop) <= 0.5,
			`paint box ${geometry.paintBoxOffsetFromClip}px from the clip box at scrollTop ${geometry.scrollTop}`,
		);
		check(
			`${where}: the mirror spans the textarea's content box, gutter included`,
			geometry.mirrorFirstLineTop === null ||
				Math.abs(
					geometry.mirrorClientWidth -
						(geometry.textareaClientWidth + geometry.scrollbarGutter),
				) <= 1,
			`mirror=${geometry.mirrorClientWidth} textarea=${geometry.textareaClientWidth} gutter=${geometry.scrollbarGutter}`,
		);
		check(
			`${where}: the two layers compute the same font`,
			geometry.mirrorFont === geometry.textareaFont,
			`mirror=${geometry.mirrorFont} textarea=${geometry.textareaFont}`,
		);
		check(
			`${where}: the textarea's own text is transparent and its caret is not`,
			(geometry.textareaColor === "rgba(0, 0, 0, 0)" ||
				geometry.textareaColor === "transparent") &&
				geometry.caretColor !== geometry.textareaColor,
			`color=${geometry.textareaColor} caret=${geometry.caretColor}`,
		);
		check(
			`${where}: the mirror's rows match the textarea's`,
			geometry.mirrorRows === geometry.textareaRows,
			`mirror=${geometry.mirrorRows} textarea=${geometry.textareaRows}`,
		);
		/*
		 * Compare the mirror's CONTENT height, not only its row count: this is the
		 * pair QA round 1 Q1 was measured in (34px against 55px), and the two can
		 * disagree inside one row's worth of rounding without the row counts
		 * differing. The mirror paints every glyph, so a mirror even a fraction of a
		 * row taller is a mirror wrapping a character the textarea did not.
		 */
		check(
			`${where}: the mirror's content height is the textarea's`,
			Math.abs(geometry.mirrorScrollHeight - geometry.textareaScrollHeight) <=
				1,
			`mirror=${geometry.mirrorScrollHeight} textarea=${geometry.textareaScrollHeight}`,
		);
		/*
		 * And the scrolled half of the same claim: the mirror's window is the
		 * textarea's, by the transform the writer keeps in step with the scroll.
		 */
		check(
			`${where}: the mirror's window follows the textarea's scroll`,
			geometry.scrollTop === 0 ||
				Math.abs(translateYOf(geometry.mirrorTransform) + geometry.scrollTop) <=
					0.5,
			`scrollTop=${geometry.scrollTop} transform=${geometry.mirrorTransform}`,
		);
		check(
			`${where}: the right padding is the textarea's plus its scrollbar`,
			Math.abs(
				geometry.mirrorPaddingRight -
					(geometry.textareaPaddingRight + geometry.scrollbarGutter),
			) < 0.5,
			`mirror=${geometry.mirrorPaddingRight} textarea=${geometry.textareaPaddingRight} gutter=${geometry.scrollbarGutter}`,
		);
		for (const run of geometry.runs) {
			/* See `mirrorFirstLineTop`: the origin is the line's own first inline
			   box, not `paddingTop`, and a run on the first content line shares it. */
			const expected = geometry.mirrorFirstLineTop;
			check(
				`${where}: run "${run.text}" sits on the line it names`,
				expected === null || Math.abs(run.top - expected) <= 0.5,
				`top=${run.top} line=${expected}`,
			);
		}
	}
	note(
		"mirrors painted by this run",
		`${mirrorsSeen} of ${geometryChecks.length} states painted — and the count is NOT the claim: the plan decides per draft, so the states that paint are the ones whose draft carries a run (this scene's \`command-alone\` and its two derived scroll probes), and the rest are prose the planner sends as written or the multi-line kill. A run without \`--backend\` has no vocabulary at all and paints in none`,
	);
	note(
		"scrollbar gutters measured",
		JSON.stringify({
			overlay: readback.themes.localOperatorDark.map(
				(entry) => entry.scrollbarGutter,
			),
			forcedClassic: readback.probes.forcedScrollbar.gutter,
		}),
	);
}

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
	if (BACKEND) note("csp for this run's backend", widenCspForBackend(BACKEND));

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
			else if (SCENE === "settings-model") await sceneSettingsModel(cdp);
			else if (SCENE === "settings-fields") await sceneSettingsFields(cdp);
			else if (SCENE === "palette") await scenePalette(cdp);
			else if (SCENE === "browser-pane") await sceneBrowserPane(cdp);
			else if (SCENE === "mentions") await sceneMentions(cdp);
			else if (SCENE === "browser-mark") await sceneBrowserMark(cdp);
			else if (SCENE === "canvas-freshness")
				await sceneCanvasFreshness(cdp, app);
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
	const strays = await reapStrays();
	if (strays.killed.length > 0) {
		note(
			"orphans this run killed by exact pid",
			`${strays.killed.join(", ")} after ${strays.waitedMs}ms`,
		);
	}
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
