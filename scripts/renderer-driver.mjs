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
 *   --scene <states|new-chat|settings-model|settings-fields|palette|browser-pane|pins|pins-scroll|pins-search|none>
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
 *   --tui-python <path>    (with --scene pins) the interpreter of a checkout whose
 *                          `local_operator.tui.sidebar_pins` is importable. The
 *                          scene runs that module's `toggle_pin` — the exact
 *                          function the terminal's `f10` calls — and then measures
 *                          how long this app takes to show the pin, with nobody
 *                          touching the window
 *   --tui-config <dir>     (with --scene pins) the config root the daemon above is
 *                          serving, which is where that store lives
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
/*
 * Every python this harness starts is handed an environment it has decided about,
 * never `process.env`: an inherited `PYTHONPYCACHEPREFIX` wrote 19 `.pyc` into the
 * operator's installed app once (see `python-child-env.mjs`), and
 * `scripts/python-bytecode-cache.test.mjs` enumerates the sites that may start an
 * interpreter, so a new one has to say so there as well as here.
 */
import { pythonChildEnv } from "./python-child-env.mjs";

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
 * The terminal's own store, for `--scene pins`' cross-surface step.
 *
 * Both halves are required together and neither is guessed: the interpreter must
 * be able to import `local_operator.tui.sidebar_pins`, and the config root must be
 * the one the `--backend` daemon is serving, because that file is the state the
 * two surfaces share. A run that passes one without the other is told so rather
 * than silently skipping the measurement.
 */
const TUI_PYTHON = argValue("--tui-python", null);
/*
 * WHICH THEME THE SCENE RUNS, and it is a flag rather than a loop for a reason that
 * is about the frames: a pass that runs both themes in one launch is a pass whose
 * SECOND theme starts in whatever state the first one left behind - a conversation
 * opened by the first pass's selection step was still open in the light frames, so
 * `pins-unpinned-light` was not the state `pins-unpinned-dark` is (design round 1,
 * D2). One theme per launch gives each theme the state its name claims, and the
 * harness runs the scene once per theme.
 */
const THEME = argValue("--theme", null);
/*
 * The title the search-only scene looks for, and it is a flag because the seeder owns the
 * order: `--generate N` writes its mtimes in sequence, so the oldest titles are the ones the
 * catalogue page drops. Defaulted to the first of that numbering.
 */
const SEARCH_TITLE = argValue("--search-title", "Sweep 001");
const TUI_CONFIG = argValue("--tui-config", null);
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

// ---- the pins scene ----------------------------------------------------------

/**
 * The conversations this app renders, and the pin controls it has mounted.
 *
 * Read out of the DOM in document order, because the claims this scene makes are
 * about ORDER and about WHICH element carries what: that the `Pinned chats`
 * heading is above the sections below it, that the pin control is a SIBLING of the
 * conversation button rather than inside it, and that the control is revealed by
 * the pointer rather than drawn in both states.
 */
function readPins(cdp) {
	return cdp.evaluate(`(() => {
		const text = (node) => node ? node.textContent.replace(/\\s+/g, " ").trim() : null;
		// Keyed on data-tour-tag="chat-session-row" and NOT on data-chat-row: the
		// same marker is on this panel's headings, on its agent and team rows and on
		// the rail, so a read keyed on it would count navigation as conversations.
		// The tour tag is the app's own hook for a conversation row and it exists in
		// both trees, which is what lets this scene run unchanged against the
		// pre-change one.
		const conversationRows = Array.from(document.querySelectorAll('button[data-tour-tag="chat-session-row"]'));
		const rows = conversationRows.map((row) => ({
			label: text(row),
			ariaCurrent: row.getAttribute("aria-current"),
			parentTag: row.parentElement ? row.parentElement.tagName.toLowerCase() : null,
			parentClass: row.parentElement ? String(row.parentElement.className) : null,
			buttonsInParent: row.parentElement ? row.parentElement.querySelectorAll("button").length : 0,
			pinSibling: row.parentElement ? row.parentElement.querySelectorAll("[data-session-pin]").length : 0,
		}));
		const pins = Array.from(document.querySelectorAll("[data-session-pin]")).map((pin) => {
			const box = pin.getBoundingClientRect();
			const style = getComputedStyle(pin);
			return {
				label: pin.getAttribute("aria-label"),
				title: pin.getAttribute("title"),
				pressed: pin.getAttribute("aria-pressed"),
				opacity: style.opacity,
				fill: pin.querySelector("svg") ? pin.querySelector("svg").getAttribute("fill") : null,
				x: box.left + box.width / 2,
				y: box.top + box.height / 2,
				width: box.width,
				height: box.height,
			};
		});
		// Every row-like row in document order, so the SECTION order can be asserted
		// rather than inferred: headings, navigation and conversations.
		const order = Array.from(document.querySelectorAll("button[data-chat-row]")).map((row) => text(row));
		return {
			rows,
			pins,
			order,
			nav: text(document.querySelector("nav")),
			controls: document.querySelectorAll("[data-session-pin]").length,
		};
	})()`);
}

/**
 * Where a row's own click target is, so the scene can put the pointer on it.
 *
 * The conversation BUTTON's box rather than the row wrapper's: the wrapper now
 * contains the pin slot, and a pointer parked on the wrapper's centre could be
 * over either. This is the box the row's own handler owns.
 */
function rowBox(cdp, index) {
	return cdp.evaluate(`(() => {
		const rows = Array.from(document.querySelectorAll('button[data-tour-tag="chat-session-row"]'));
		const row = rows[${index}];
		if (!row) return null;
		const box = row.getBoundingClientRect();
		return {
			label: row.textContent.replace(/\\s+/g, " ").trim(),
			x: box.left + box.width * 0.6,
			y: box.top + box.height / 2,
			left: box.left,
			width: box.width,
		};
	})()`);
}

/**
 * Open one of the panel's sections, then wait for its conversations to exist.
 *
 * The sections are collapsible and `Previous chats` starts CLOSED, so on a store
 * nobody has touched yet the panel draws the heading and none of its rows: a
 * scene that assumed otherwise would photograph an empty list and call it a
 * catalogue. Pressed through the app's own heading, and the wait is on the rows
 * rather than on a timer.
 */
async function openSection(cdp, label, timeoutMs = 5_000) {
	const heading = () =>
		cdp.evaluate(`(() => {
			const wanted = ${JSON.stringify(label)};
			const node = Array.from(document.querySelectorAll("button[data-chat-row]"))
				.find((row) => row.textContent.replace(/\\s+/g, " ").trim().startsWith(wanted));
			if (!node) return null;
			const box = node.getBoundingClientRect();
			return {
				expanded: node.getAttribute("aria-expanded") === "true",
				x: box.left + box.width / 2,
				y: box.top + box.height / 2,
			};
		})()`);
	const started = Date.now();
	for (;;) {
		const at = await heading();
		if (at === null) {
			if (Date.now() - started > timeoutMs)
				throw new Error(`no ${label} heading in the panel`);
			await wait(100);
			continue;
		}
		/*
		 * Whether the section is OPEN is read from the heading's own `aria-expanded`,
		 * not inferred from "some conversation row exists": once anything is pinned the
		 * Pinned section has rows while this one is still closed, so the inferred
		 * version returned early and the scene then read a one-row panel.
		 */
		if (at.expanded) return readPins(cdp);
		/*
		 * Bring the heading into the REGION's view first. A collapsed section whose
		 * heading sits below the region's own fold (a long catalogue does this: the
		 * scroll region is a 45%-height box) has a box the press cannot reach at all -
		 * `elementFromPoint` at those coordinates answers null, and the press is a
		 * no-op that looks like a dead control.
		 */
		await cdp.evaluate(`(() => {
			const wanted = ${JSON.stringify(label)};
			const node = Array.from(document.querySelectorAll("button[data-chat-row]"))
				.find((row) => row.textContent.replace(/\\s+/g, " ").trim().startsWith(wanted));
			if (node) node.scrollIntoView({ block: "center" });
			return true;
		})()`);
		await wait(180);
		const onScreen = await heading();
		await parkPointer(cdp);
		await pressPointer(cdp, onScreen.x, onScreen.y);
		await parkPointer(cdp);
		await wait(150);
		if (Date.now() - started > timeoutMs) {
			const why = await heading();
			const hit = await cdp.evaluate(`(() => {
				const node = document.elementFromPoint(${why.x}, ${why.y});
				return { tag: node ? node.tagName.toLowerCase() : null, text: node ? node.textContent.replace(/\\s+/g, " ").trim().slice(0, 40) : null };
			})()`);
			throw new Error(
				`pressing the ${label} heading did not open it: ${JSON.stringify({ heading: why, hit })}`,
			);
		}
	}
}

/**
 * One real pointer move, through Chromium's own input pipeline.
 *
 * `Input.dispatchMouseEvent` and not a `mouseover` built inside the page, because
 * the claim this scene photographs is `:hover`/`group-hover` — a CSS state only
 * the browser can enter. That is exactly why the hover reveal is a driver scene
 * rather than a Storybook `play` (`quote.stories.tsx` records the same limit), and
 * why a synthetic event would answer the wrong question: it would prove a handler
 * ran, not that the row under the pointer changes.
 */
async function movePointer(cdp, x, y) {
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x,
		y,
		buttons: 0,
	});
}

/** Park the pointer where it hovers nothing in the panel. */
async function parkPointer(cdp) {
	await movePointer(cdp, 2, 2);
	// Longer than the fade-out (`duration-base`), so the next frame is the settled
	// state rather than a partly-faded control.
	await wait(320);
}

/**
 * Press at a point with NO movement before it.
 *
 * WHY THIS EXISTS (UX round 2, U3-unpin, and the round's own instrument note): a press that
 * dispatches `mouseMoved` first re-arms the parked-pointer disarm, which made the PIN
 * direction look broken when it is not. A stationary second press is the gesture the reader
 * actually makes with a double-click, and it is the only way to see whether the glyph under
 * the pointer can still be operated.
 */
async function pressPointerStationary(cdp, x, y) {
	const common = { x, y, button: "left", clickCount: 1 };
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		...common,
		buttons: 1,
	});
	await wait(40);
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		...common,
		buttons: 0,
	});
}

/** Press at a point with a real button-down/button-up pair. */
async function pressPointer(cdp, x, y) {
	const common = { x, y, button: "left", clickCount: 1 };
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...common,
		buttons: 0,
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		...common,
		buttons: 1,
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		...common,
		buttons: 0,
	});
	await wait(120);
}

/**
 * A precondition: reported like a check and FATAL, because every line after it
 * reads the value it just measured. `check` on its own records a failure and
 * carries on, which for a box's coordinates means a crash two steps later that
 * says nothing about why.
 */
function require(label, value, detail) {
	check(label, Boolean(value), detail);
	if (!value) throw new Error(`${label} - ${detail}`);
	return value;
}

/** Wait until the sidebar has a `Pinned chats` section holding `label`. */
async function waitForPinned(cdp, label, timeoutMs = 6_000) {
	const started = Date.now();
	let last = null;
	for (;;) {
		last = await readPins(cdp);
		/*
		 * The section's order is read off `order` — every row-like button in the
		 * panel, document order — because the claim is about SEQUENCE: the
		 * `Pinned chats` heading, then the pinned conversation, then `All chats` and
		 * the sections below it.
		 */
		const headingAt = last.order.findIndex((line) =>
			String(line).startsWith("Pinned chats"),
		);
		const rowAt = last.rows.findIndex((row) => row.label === label);
		const allChatsAt = last.order.findIndex((line) =>
			String(line).startsWith("All chats"),
		);
		/*
		 * THE ORDER THE DESIGN SETTLED ON (design round 1, D1): the nav rows first, then
		 * `Pinned chats`, then the pinned conversation. The first version of this waited
		 * for the section ABOVE `All chats`, which the design round moved: a section at
		 * the top of the region is a section a reader in flat mode has to scroll past the
		 * nav to reach, and design round 1 asked for it below them instead.
		 */
		const rowLineAt = last.order.findIndex((line) => String(line) === label);
		/*
		 * The place is a BRACKET (design round 2, nit): below the `All chats` / `New chat` nav
		 * rows AND above `Active chats`. The first version checked only the lower half, so a
		 * section that had drifted below `Active chats` would still have passed - the guard was
		 * missing the half that the flat mode has no anchor for.
		 */
		const activeAt = last.order.findIndex((line) =>
			String(line).startsWith("Active chats"),
		);
		const worked =
			headingAt >= 0 &&
			rowAt >= 0 &&
			allChatsAt >= 0 &&
			allChatsAt < headingAt &&
			(activeAt === -1 || headingAt < activeAt) &&
			rowLineAt > headingAt;
		const waited = Date.now() - started;
		if (worked || waited > timeoutMs)
			return { worked, waited, headingAt, rowAt, allChatsAt, sidebar: last };
		await wait(100);
	}
}

/**
 * `pins`: durable conversation pinning, driven the way the operator asked for it.
 *
 * ## What this scene is for
 *
 * The operator's ask was "hovering a conversation row reveals a pin icon; clicking
 * pins the conversation; pinned conversations appear in a Pinned chats section
 * above Active Chats; and the state must be the BACKEND's pinned state so pinning
 * in the TUI pins in the app and vice versa". Three of those four are about
 * pixels and about a real pointer:
 *
 * - the **reveal** is a `group-hover` state, which only a real pointer produces
 *   (a Storybook `play` cannot — see `quote.stories.tsx`), so the pointer here is
 *   dispatched through Chromium's input pipeline and the frame is taken with the
 *   pointer genuinely over the row;
 * - the **press** is a real button-down/button-up pair at the control's own
 *   centre, so what the frame shows is what a click does;
 * - the **section** is an order in a scroll region, which is a fact about the
 *   panel rather than about a class string, so the scene reads the DOM and
 *   asserts the heading really is above the sections below it.
 *
 * ## The frames, and the pairs they come in
 *
 * Per theme (two at least, because twelve are user-selectable):
 *
 * | Frame | The state | The "before" it is paired with |
 * | --- | --- | --- |
 * | `pins-unpinned-<theme>` | rows, nothing pinned: NO heading, NO section | — (the before of the next row) |
 * | `pins-hover-<theme>` | the pointer over an unpinned row, pin revealed | `pins-unpinned`, same row at rest |
 * | `pins-populated-<theme>` | one conversation pinned, section above the rest | `pins-unpinned` |
 * | `pins-selected-<theme>` | the pinned row is also the current one, drawn ONCE | `pins-populated` (same row, not current) |
 * | `pins-filter-<theme>` | a query applied: the section is `matching ∩ pinned` | `pins-populated` (unfiltered) |
 *
 * And, when the backend omits `session_pins` (a run against a daemon that predates
 * the pin store), the same scene takes `pins-withdrawn-<theme>` instead of all of
 * the above, asserting the two halves of fail-closed: NO control mounted anywhere,
 * and the row's own element unchanged (no wrapper, no reserved slot) — which is
 * what makes its frames comparable, byte for byte, with the same scene's frames
 * from the tree before this change.
 *
 * ## The cross-surface half (`--tui-python`)
 *
 * With `--tui-python` and `--tui-config` the scene also asks the OTHER surface to
 * pin a conversation: it runs `local_operator.tui.sidebar_pins.toggle_pin` — the
 * exact function the terminal's `f10` calls — against the daemon's own config
 * root, then waits for this app's sidebar to show that conversation in its Pinned
 * section WITHOUT any manual refresh, and reports the latency it measured. The
 * other direction is read the same way, after the press: the store the terminal
 * reads is printed. That is the operator's "pinning in the TUI pins in the app and
 * vice versa" as a measurement rather than as a claim about a shared file.
 */
/**
 * The panel's list as the SCROLLED state needs it: the region's own metrics, every
 * row's box, its pin and its button, and what is under a given point.
 *
 * WHY THE GEOMETRY AND NOT A COUNT. QA round 1's U1/U2 are about where things are:
 * a pin moves a row between sections, and what went wrong was the panel's SCROLL
 * and the POINTER, neither of which a class assertion can see. The region is found
 * through a row rather than by a selector on the scroll container, so this read
 * does not depend on a utility class staying in place.
 *
 * `point` is optional and answers the one question the pointer case must ask:
 * `document.elementFromPoint` at the coordinates the press used, which is the
 * pointer's own hit test rather than an inference from the DOM order.
 */
function readList(cdp, point = null) {
	return cdp.evaluate(`(() => {
		const rowNodes = Array.from(document.querySelectorAll("[data-session-row]"));
		if (rowNodes.length === 0) return null;
		let list = rowNodes[0].parentElement;
		while (list && !String(list.className).includes("overflow-y-auto")) list = list.parentElement;
		if (!list) return null;
		const text = (node) => node ? node.textContent.replace(/\\s+/g, " ").trim() : null;
		const box = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height }; };
		const rows = rowNodes.map((node) => {
			const pin = node.querySelector("[data-session-pin]");
			const button = node.querySelector('button[data-tour-tag="chat-session-row"]');
			return {
				id: node.getAttribute("data-session-row"),
				label: text(button),
				pinned: pin ? pin.getAttribute("aria-pressed") === "true" : null,
				current: button ? button.getAttribute("aria-current") : null,
				box: box(node),
				button: button ? box(button) : null,
				pin: pin ? box(pin) : null,
				pinFill: pin && pin.querySelector("svg") ? pin.querySelector("svg").getAttribute("fill") : null,
				pinOpacity: pin ? getComputedStyle(pin).opacity : null,
			};
		});
		const listBox = box(list);
		let atPoint = null;
		if (${point === null ? "false" : "true"}) {
			const node = document.elementFromPoint(${point === null ? 0 : point.x}, ${point === null ? 0 : point.y});
			const row = node && node.closest ? node.closest("[data-session-row]") : null;
			const pin = node && node.closest ? node.closest("[data-session-pin]") : null;
			// The control is what a press at these coordinates would ACT on: the button the
			// hit element belongs to, if any. The wrapper between two controls answers null,
			// which is the difference between being over a row and being over something a
			// click would fire (QA round 1, U3).
			const control = node && node.closest ? node.closest("button") : null;
			atPoint = { row: row ? row.getAttribute("data-session-row") : null, pin: pin !== null, tag: node ? node.tagName.toLowerCase() : null, control: control ? { kind: control.hasAttribute("data-session-pin") ? "pin" : control.getAttribute("data-tour-tag") || control.tagName.toLowerCase() } : null };
		}
		return {
			scrollTop: list.scrollTop,
			scrollHeight: list.scrollHeight,
			clientHeight: list.clientHeight,
			listBox,
			rows,
			atPoint,
			activeElement: (() => {
				const active = document.activeElement;
				if (!active) return null;
				const row = active.closest ? active.closest("[data-session-row]") : null;
				return { tag: active.tagName.toLowerCase(), row: row ? row.getAttribute("data-session-row") : null, pin: active.hasAttribute ? active.hasAttribute("data-session-pin") : false, label: active.getAttribute ? active.getAttribute("aria-label") : null };
			})(),
		};
	})()`);
}

/**
 * Scroll one row into the region's view and put the region where a page-down
 * lands, so the scene can drive the state QA measured rather than a viewport-
 * sized list that never scrolls.
 */
async function scrollRowIntoView(cdp, id) {
	await cdp.evaluate(`(() => {
		const node = document.querySelector('[data-session-row="' + ${JSON.stringify(id)} + '"]');
		if (node) node.scrollIntoView({ block: "center" });
		return true;
	})()`);
	await wait(200);
}

/**
 * The SCROLLED state, and the two interactions QA round 1 found broken by the move.
 *
 * WHY THIS IS A SCENE OF ITS OWN. `--scene pins` drives a four-conversation panel
 * whose whole list fits: nothing scrolls, every row is visible, and the claims its
 * frames carry are about the section, the reveal and the press. QA's U1/U2 are about
 * what a pin move does to a panel that does NOT fit - the region's scroll was
 * re-anchored by the browser (275 -> 319, with the `Pinned chats` heading 309 px above
 * the visible top), the pointer was left over a DIFFERENT conversation's row (a second
 * click opens the wrong chat), and the control holding keyboard focus was unmounted
 * with the row, so the next Tab started at the top of the panel.
 *
 *   node scripts/renderer-driver.mjs --scene pins-scroll --backend <url> --out <dir>
 *
 * It needs a store with more conversations than the panel's window holds (the seeder
 * takes `--titles`; a dozen and a half is enough to make the region scroll), and it
 * ASSERTS the scrollability rather than assuming it, because every claim below is
 * meaningless in a panel that fits.
 *
 * Both themes run the same sequence and each pass unpins everything it pinned at the
 * end, so the light frames are a picture of the same state as the dark ones.
 */
async function scenePinsScrolled(cdp) {
	const frames = [];
	const themes =
		THEME === null ? ["localOperatorDark", "localOperatorLight"] : [THEME];
	/** Every unpinned row whose box is wholly inside the region, in document order. */
	const visibleUnpinned = (list) =>
		list.rows.filter(
			(row) =>
				row.pinned === false &&
				row.pin !== null &&
				row.box.bottom > list.listBox.top && // intersects the region's window
				row.box.top < list.listBox.bottom,
		);
	/**
	 * Bring a row into the region's window by SCROLLING THE REGION.
	 *
	 * `scrollRowIntoView` scrolls whatever ancestor is scrollable first, which on this panel is
	 * the region itself only after the window has finished moving - and the scrolled pair read a
	 * region at scrollTop 280 with its target row 1200 px further down, i.e. an untouched region.
	 * The scroll goes through the region the scene measured, by its own offsetTop.
	 */
	const scrollRegionToRow = (id) =>
		cdp.evaluate(`(() => {
			const row = document.querySelector('[data-session-row="${id}"]');
			let list = row ? row.parentElement : null;
			while (list && !String(list.className).includes("overflow-y-auto")) list = list.parentElement;
			if (!list || !row) return null;
			list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2);
			return list.scrollTop;
		})()`);

	/** Press one row's pin by id, scrolling it into view first. */
	const pressPin = async (id) => {
		await parkPointer(cdp);
		await scrollRegionToRow(id);
		await wait(180);
		const row = (await readList(cdp)).rows.find((item) => item.id === id);
		require(`the row ${id} has a pin to press`, row?.pin, JSON.stringify(row));
		/*
		 * The control must be UNDER the pointer before the press: an unpinned row's glyph is
		 * hidden until the row is hovered, and a press on a control that is not there lands on the
		 * row's own button instead - which OPENS the conversation and takes the list off screen.
		 * Checked rather than assumed, so a mis-press names itself.
		 */
		/*
		 * The box is re-read on each attempt: hovering a row and a settling list both move it, and
		 * a press at a stale box lands on the row's own button - which opens the conversation and
		 * takes the list off screen entirely.
		 */
		let over = null;
		for (let attempt = 0; attempt < 4; attempt += 1) {
			const fresh = (await readList(cdp)).rows.find((item) => item.id === id);
			require(`the row ${id} has a pin to press`, fresh?.pin, JSON.stringify(
				fresh,
			));
			await movePointer(cdp, fresh.pin.x, fresh.pin.y);
			await wait(220);
			over = await readList(cdp, { x: fresh.pin.x, y: fresh.pin.y });
			if (over?.atPoint?.pin === true) {
				await pressPointer(cdp, fresh.pin.x, fresh.pin.y);
				await wait(360);
				return;
			}
		}
		throw new Error(
			`the pin of ${id} never came under the pointer: ${JSON.stringify({ atPoint: over ? over.atPoint : null })}`,
		);
	};

	for (const theme of themes) {
		const suffix = theme === "localOperatorDark" ? "dark" : "light";
		await verb(cdp, "setTheme", theme);
		await wait(300);
		/*
		 * Both disclosure sections OPEN, through their own headings: a collapsed
		 * section draws no rows at all, so a scene that read the list first would see
		 * one row and conclude the store was empty.
		 */
		await openSection(cdp, "Previous chats");
		await openSection(cdp, "Active chats");
		const start = await readList(cdp);
		require("the panel's list has more rows than a page", start &&
			start.rows.length >= 12, JSON.stringify({
			rows: start ? start.rows.length : null,
		}));
		check(
			"the panel's list scrolls, so a row can be pinned off the top of it",
			start.scrollHeight > start.clientHeight + 40,
			JSON.stringify({
				scrollHeight: start.scrollHeight,
				clientHeight: start.clientHeight,
				rows: start.rows.length,
			}),
		);
		/*
		 * THREE PINS through the daemon's own route, because what this frame is for is
		 * the STATE - a pinned set taller than the region's window (design round 1, D4)
		 * - and the section it draws is the app's rendering of the backend's answer. The
		 * two interactions this scene exists to drive (the pointer case and the keyboard
		 * case below) press their own pins, through the control, and are the only presses
		 * the scene has to make land.
		 */
		const catalogue = await readBackendSessions();
		/*
		 * FOURTEEN pins, not three (design round 2, D7). The design's claim is a pinned set
		 * TALLER than the region's window - the state a reader with a real pin list has - and
		 * three pins photograph a set that fits, which refutes the claim the frames were taken
		 * to support. Fourteen rows at the panel's own 32 CSS px exceed the 382 px window, and
		 * the assertion below reads that off the DOM rather than trusting the arithmetic.
		 */
		const seeded = catalogue.slice(-14);
		require("the catalogue has fourteen rows to seed pins on", seeded.length ===
			14, JSON.stringify(catalogue.map((row) => row.id)));
		for (const row of seeded) await setBackendPin(row.id, true);
		const pinnedIds = new Set(seeded.map((row) => row.id));
		const startedPins = Date.now();
		let drawn = null;
		for (;;) {
			const now = await readList(cdp);
			if (now.rows.filter((row) => row.pinned === true).length >= 14) {
				drawn = now;
				break;
			}
			if (Date.now() - startedPins > 8_000) break;
			await wait(150);
		}
		/*
		 * Both disclosure sections are opened AGAIN here: the fourteen pins arrive through the
		 * catalogue's own doorbell, and a section that collapses with the re-render draws no
		 * rows at all - which is how a scene reads "no unpinned rows" off a panel that has
		 * plenty of them.
		 */
		await openSection(cdp, "Previous chats");
		await openSection(cdp, "Active chats");
		check(
			"the fourteen pins the daemon holds are drawn as a Pinned set",
			drawn !== null,
			JSON.stringify({
				wanted: [...pinnedIds],
				rows: (drawn ? drawn.rows : []).map((row) => [row.id, row.pinned]),
			}),
		);

		/*
		 * THE STATE QA MEASURED: the region scrolled away from the top, with a window of
		 * six rows and the pins above the fold.
		 */
		/*
		 * Scroll so that UNPINNED rows fill the window: at the region's own middle the
		 * three pins just made are what is on screen, and the assertions below are about
		 * pressing a row that is not pinned yet.
		 */
		const afterSeeding = await readList(cdp);
		const unpinned = afterSeeding.rows.filter((row) => row.pinned === false);
		require("the catalogue still has unpinned rows to scroll to", unpinned.length >
			2, JSON.stringify({
			rows: afterSeeding.rows.map((row) => [row.label, row.pinned]),
			order: afterSeeding.rows.length,
		}));
		/*
		 * A MODEST scroll: a quarter of the region's range. That is the reader's state
		 * the move can be corrected FROM, and the two assertions below say why - a row
		 * pinned from DEEPER than the `Pinned chats` section is tall cannot be returned
		 * to the line it was pressed on, because its new home then has less content above
		 * it than the reader had scrolled. Measured on this panel with the deeper scroll:
		 * a press from scrollTop 334 into a section 29 px from the content's top needs a
		 * target of -187, which clamps to 0 and leaves the row at the region's top edge
		 * instead of on its line. The scene asserts the reachable case and PRINTS both
		 * numbers, so the clamped case is visible rather than mistaken for the passing one.
		 */
		/*
		 * THREE PINS FOR THE PROMISE CASES, THEN FOURTEEN AGAIN FOR THE BOUNDARY.
		 *
		 * The scene has two jobs that pull in opposite directions, and round 2 ran them at the
		 * same depth: the D7 state (a pinned set taller than the region's window) is what the
		 * frames are for, and it is also deep enough that the pressed row's new home is off the
		 * window - so the promise cases below were being asserted in the one geometry where they
		 * cannot hold, and failed.
		 *
		 * So they are separated, and the trim comes FIRST because everything after it depends on
		 * the geometry: the scroll, the candidate rows, and the depth the promise is asserted at.
		 * The fourteen-pin state comes back afterwards for the boundary case and the frames.
		 */
		for (const row of seeded.slice(3)) await setBackendPin(row.id, false);
		const backToThree = Date.now();
		for (;;) {
			const now = await readList(cdp);
			if (now.rows.filter((row) => row.pinned === true).length <= 3) break;
			if (Date.now() - backToThree > 8_000) break;
			await wait(150);
		}
		require("the promise cases run with a section short enough for its new home to be in view", (
			await readList(cdp)
		).rows.filter((row) => row.pinned === true).length <= 3, JSON.stringify(
			(await readList(cdp)).rows.map((row) => [row.id, row.pinned]),
		));

		/*
		 * The region goes to the FIRST unpinned row's own line - the top of the unpinned set, just
		 * below the section - rather than to a fraction of its range. Two reasons, both measured:
		 * a quarter of the range lands inside a tall pinned tower (so the scene read "no unpinned
		 * rows to scroll to" off a panel with twenty-six of them), and the promise cases need a
		 * depth shallow enough that a row pinned here comes back into the window rather than out
		 * of it.
		 */
		/*
		 * THE PROMISE CASES RUN AT THE TOP OF THE REGION, and that is a decision rather than a
		 * convenience. A pinned row's new home is the `Pinned chats` section, which is drawn at
		 * the top of the content; a reader whose region is scrolled to the top therefore SEES the
		 * row arrive, and one who is deep in the list does not (UX round 2's residual, and the
		 * boundary case at the end of this scene). Scrolling to the "first unpinned row" is not
		 * the top: entity groups sit above it, and it landed the window 620 px down - measured,
		 * and the reason the earlier version of this step asserted a depth it then failed at.
		 */
		await cdp.evaluate(`(() => {
			const rows = document.querySelectorAll("[data-session-row]");
			let list = rows[0].parentElement;
			while (list && !String(list.className).includes("overflow-y-auto")) {
				list = list.parentElement;
			}
			if (list) list.scrollTop = 0;
			return list ? list.scrollTop : null;
		})()`);
		await parkPointer(cdp);
		await wait(240);
		const scrolled = await readList(cdp);
		const pinnedShown = scrolled.rows.filter(
			(row) =>
				row.pinned === true &&
				row.box.bottom > scrolled.listBox.top &&
				row.box.top < scrolled.listBox.bottom,
		);
		check(
			"the promise cases run where a pinned row's new home is in view: the section is in the window",
			pinnedShown.length > 0,
			JSON.stringify({
				scrollTop: scrolled.scrollTop,
				pinned: pinnedShown.map((row) => row.id),
				list: scrolled.listBox,
			}),
		);
		const candidates = visibleUnpinned(scrolled);
		say(
			`  [pins] scrolled state: scrollTop ${scrolled.scrollTop} of ${scrolled.scrollHeight - scrolled.clientHeight}, region ${Math.round(scrolled.listBox.top)}..${Math.round(scrolled.listBox.bottom)}, rows ${JSON.stringify(scrolled.rows.map((row) => [row.id.slice(0, 4), Math.round(row.box.top), row.pinned]))}`,
		);
		require("two unpinned rows are visible in the scrolled list", candidates.length >=
			2, JSON.stringify(candidates.map((row) => row.label)));

		/* ---- CASE A: the POINTER (U1, U3) ------------------------------- */
		const targetA = candidates[candidates.length - 2];
		/* The row the pointer will be left beside: the one BELOW the pressed row, which is
		   the row that slides up into the vacated slot if the correction is not made. */
		const targetIndex = scrolled.rows.findIndex((row) => row.id === targetA.id);
		const neighbourA =
			scrolled.rows[targetIndex + 1] ?? scrolled.rows[targetIndex - 1];
		require("the pressed row has a neighbour to measure", neighbourA, JSON.stringify(
			scrolled.rows.map((row) => row.id),
		));
		await movePointer(cdp, targetA.pin.x, targetA.pin.y);
		await wait(240);
		const beforeA = await readList(cdp, {
			x: targetA.pin.x,
			y: targetA.pin.y,
		});
		check(
			"the pointer is over the target row's pin before the press",
			beforeA.atPoint?.pin === true && beforeA.atPoint?.row === targetA.id,
			JSON.stringify(beforeA.atPoint),
		);
		await pressPointer(cdp, targetA.pin.x, targetA.pin.y);
		await wait(420);
		const afterA = await readList(cdp, {
			x: targetA.pin.x,
			y: targetA.pin.y,
		});
		const wasA = beforeA.rows.find((row) => row.id === targetA.id);
		check(
			"the pressed row left its place and is in the Pinned section",
			afterA.rows.find((row) => row.id === targetA.id)?.pinned === true,
			JSON.stringify({
				rows: afterA.rows.slice(0, 3).map((row) => [row.id, row.pinned]),
			}),
		);
		/*
		 * D24: A WITNESS THAT THE PRESS ACTED, so a dropped press cannot read as a geometry result.
		 * The parked-pointer guard drops a repeat press inside its 6px slop, and a dropped press
		 * produces `delta 0` on the neighbour below - the SAME number a held anchor produces - so
		 * without this the scene reported its own dropped presses as boundary failures (design
		 * round 7: three of ten scripted presses). The press's own effect is the discriminator:
		 * the store's pin for the pressed row must have inverted, or nothing downstream measured
		 * anything. Kept as a `check` rather than a `require` so a drop is reported as a drop.
		 */
		const pressedNowA = afterA.rows.find((row) => row.id === targetA.id)?.pinned;
		check(
			"the press acted: the pressed row's pin state inverted (D24: a dropped press must not read as a geometry failure)",
			wasA?.pinned !== undefined && pressedNowA !== undefined && wasA.pinned !== pressedNowA,
			JSON.stringify({ pin_before: wasA?.pinned, pin_after: pressedNowA }),
		);
		/*
		 * D25: THE ANCHOR IS A PROMISE ABOUT THE LIST, NOT ABOUT THE VIEWPORT.
		 * Two corrections, both from design round 7's three-boot measurement:
		 *   (a) the neighbour's line is measured in CONTENT coordinates (box.top + scrollTop).
		 *       Measured in viewport tops, a shift of the panel's own chrome - the designer's boots
		 *       varied the region top by 256.5px - pass as an anchor failure, which is a defect in
		 *       the instrument rather than in the panel;
		 *   (b) the region's own scrollTop is asserted, because that IS the property the correction
		 *       protects: if the list scrolled under the pointer, the neighbour's content position
		 *       can hold while the reader's view moved.
		 * The row ABOVE the pressed row is deliberately not asserted: it moves exactly one pitch by
		 * construction - the pressed row left its slot - and the source's own neighbour selection
		 * (`rows[index + 1] ?? rows[index - 1]`) says so. Asserting both sides would make the check
		 * fail on correct behaviour, which is how a check stops being read.
		 */
		const neighbourAfterA = afterA.rows.find((row) => row.id === neighbourA.id);
		const neighbourContentDelta =
			(neighbourAfterA?.box.top ?? Number.NaN) +
			afterA.scrollTop -
			(neighbourA.box.top + beforeA.scrollTop);
		check(
			"the list did not move under the pointer: the row BELOW the pressed one keeps its line in CONTENT coordinates (U1, D25)",
			Math.abs(neighbourContentDelta) <= 2,
			JSON.stringify({
				neighbour: neighbourA.id,
				top_before_viewport: neighbourA.box.top,
				top_after_viewport: neighbourAfterA?.box.top,
				scroll_before: beforeA.scrollTop,
				scroll_after: afterA.scrollTop,
				content_delta: neighbourContentDelta,
			}),
		);
		check(
			"the region did not scroll under the pointer (U1, D25: the promise in its own terms)",
			Math.abs(afterA.scrollTop - beforeA.scrollTop) <= 1,
			JSON.stringify({
				scroll_before: beforeA.scrollTop,
				scroll_after: afterA.scrollTop,
			}),
		);
		/*
		 * U3 AS THE PROMISE, NOT AS THE INSTRUMENT. The check here used to require that NO
		 * control sat under the parked pointer, which is one way to keep a repeat press off the
		 * row that slid into place - and the way that also swallowed the reader's own repeat
		 * press on the control they meant (QA round 2, Qr2-1). What must hold is about the pin
		 * set: a repeat press at these coordinates, with the pointer having gone nowhere, may
		 * only ever change the conversation whose control is under it, and must change nothing
		 * at all when that control belongs to a row the reader never pointed at.
		 */
		const underAt = await readList(cdp, {
			x: targetA.pin.x,
			y: targetA.pin.y,
		});
		const underId = underAt.atPoint?.row ?? null;
		const heldBeforeRepeat = tuiStoreReading().pins;
		await pressPointerStationary(cdp, targetA.pin.x, targetA.pin.y);
		await wait(420);
		const heldAfterRepeat = tuiStoreReading().pins;
		const changed = [
			...heldBeforeRepeat.filter((id) => !heldAfterRepeat.includes(id)),
			...heldAfterRepeat.filter((id) => !heldBeforeRepeat.includes(id)),
		];
		check(
			"a repeat press on a parked pointer changes only the conversation under it (U3)",
			// The row the reader pressed may still be under the pointer, in which case the
			// repeat is that row's own control and may act on it. Anything else - nothing
			// there, or a conversation the pointer never went to - must be inert.
			underId === targetA.id
				? changed.every((id) => id === targetA.id)
				: changed.length === 0,
			JSON.stringify({
				underId,
				target: targetA.id,
				changed,
				heldBefore: heldBeforeRepeat,
				heldAfter: heldAfterRepeat,
				atPoint: underAt.atPoint,
			}),
		);
		/*
		 * THE CHECK THAT CAN FAIL (review round 2, m2). The neighbour-line assertion above is
		 * the correction's own statement and cannot fail on its own terms: the neighbour is the
		 * row the correction anchors on, so of course it keeps its line. The row UNDER THE
		 * POINTER is the reader's question: whoever ends up under the parked coordinates must be
		 * a row whose OWN line did not move. If the region let the browser re-anchor - the
		 * 275 -> 319 shift QA measured, or the 44 px the design round measured on the nav rows -
		 * the row at those coordinates would be a different one whose line had moved by that.
		 */
		/*
		 * WHAT SURVIVES THE PRESS AND WHAT DOES NOT (review round 2's m2, answered by measuring
		 * instead of strengthening an unsatisfiable claim).
		 *
		 * The check here used to require that the row left under the parked pointer kept its own
		 * line. It cannot: the pressed row leaves the list and joins `Pinned chats` at the top of
		 * the content, so the section above the pointer grows by a row and the rows ABOVE the
		 * pressed row shift by exactly that much - while the rows BELOW it hold. That is the
		 * measured residual of the anchor strategy, not a defect in the correction, and the two
		 * sides are now separated: the rows BELOW the pressed row are asserted (they are what the
		 * correction anchors on, and what the reader is looking at), and the rows ABOVE are
		 * printed with their delta so the motion is a number in the log rather than a claim in a
		 * comment. The hazard the pointer is exposed to - acting on the row that slid into the
		 * vacated line - is separately closed by the guard, checked immediately below.
		 */
		const pressedIndexA = beforeA.rows.findIndex(
			(row) => row.id === targetA.id,
		);
		const belowA = beforeA.rows
			.filter((row, index) => index > pressedIndexA && row.pinned === false)
			.slice(0, 3);
		const belowMoved = belowA.map((row) => [
			row.id,
			Math.round(row.box.top),
			Math.round(
				afterA.rows.find((item) => item.id === row.id)?.box.top ?? Number.NaN,
			),
		]);
		const aboveMoved = beforeA.rows
			.filter((row, index) => index < pressedIndexA && row.pinned === false)
			.slice(-3)
			.map((row) => [
				row.id,
				Math.round(row.box.top),
				Math.round(
					afterA.rows.find((item) => item.id === row.id)?.box.top ?? Number.NaN,
				),
			]);
		check(
			"the rows below the pressed one keep their lines through the press (U1, the side the correction anchors)",
			belowMoved.length > 0 &&
				belowMoved.every(([, before, after]) => Math.abs(after - before) <= 2),
			JSON.stringify({ below: belowMoved, above: aboveMoved }),
		);
		const underNow = afterA.atPoint?.row ?? null;
		say(
			`  [pins] m2 measured: under the parked pointer is ${underNow}; below ${JSON.stringify(belowMoved)}; above ${JSON.stringify(aboveMoved)}`,
		);
		/*
		 * WHAT THE CORRECTION CAN AND CANNOT DO, asserted as what it is.
		 *
		 * A pointer press moves the pressed row OUT of the list - into `Pinned chats`, at the top
		 * of the content - so that row cannot be put back on the reader's line: the correction
		 * anchors the row BESIDE it instead (checked above) so the content the reader is looking
		 * at does not slide, and the press guard (checked below) is what keeps a repeat press off
		 * whatever ends up under the parked pointer. What DEPTH decides is whether the pressed
		 * row's new home is still on screen, and the two sides are asserted in opposite
		 * directions: here, at a section short enough for its new home to be in view, it must be
		 * inside the region's window; at the deep state at the end of the scene it must be off it.
		 * Measured both ways, so the boundary cannot move silently in either direction.
		 */
		const pressedA = afterA.rows.find((row) => row.id === targetA.id);
		check(
			"at a shallow state the pressed row's new home is still inside the region's window (the near side of UX round 2's boundary)",
			pressedA !== undefined &&
				pressedA.box.top >= afterA.listBox.top - 1 &&
				pressedA.box.bottom <= afterA.listBox.bottom + 1,
			JSON.stringify({
				row: targetA.id,
				box: pressedA ? pressedA.box : null,
				list: afterA.listBox,
				scroll: afterA.scrollTop,
			}),
		);
		/*
		 * WHAT THE PRESS DID TO THE ROWS ABOVE THE SECTION (design round 2, D6). The design round
		 * measured the two nav rows moving 44 CSS px up on a press at this head, where the round-1
		 * head moved them 32 px down. That motion is the anchor's price: the correction scrolls the
		 * region to keep the pressed row's neighbourhood still, and a scroll moves everything,
		 * including the rows above the section. Recorded as a measurement, not argued away.
		 */
		const navLine = async () =>
			cdp.evaluate(`(() => {
				const node = Array.from(document.querySelectorAll("button[data-chat-row]"))
					.find((row) => row.textContent.replace(/\\s+/g, " ").trim().startsWith("All chats"));
				return node ? Math.round(node.getBoundingClientRect().top * 10) / 10 : null;
			})()`);
		const navBefore = await navLine();
		const around = (state) =>
			state.rows
				.filter(
					(row) =>
						row.box.bottom > targetA.pin.y - 70 &&
						row.box.top < targetA.pin.y + 70,
				)
				.map((row) => [
					row.id,
					Math.round(row.box.top),
					Math.round(row.box.bottom),
					row.pinned,
				]);
		say(
			`  [pins] scrolled pin: press at y=${Math.round(targetA.pin.y)} on ${targetA.id}; scroll ${beforeA.scrollTop} -> ${afterA.scrollTop}; neighbour ${neighbourA.id} top ${Math.round(neighbourA.box.top)} -> ${Math.round(afterA.rows.find((row) => row.id === neighbourA.id)?.box.top ?? Number.NaN)}`,
		);
		const navAfter = await navLine();
		say(
			`  [pins] D6 nav rows (All chats) top ${navBefore} -> ${navAfter} CSS px (delta ${navBefore === null || navAfter === null ? "n/a" : Math.round((navAfter - navBefore) * 10) / 10})`,
		);
		say(
			`  [pins] rows at the pointer BEFORE ${JSON.stringify(around(beforeA))}`,
		);
		say(
			`  [pins] rows at the pointer AFTER  ${JSON.stringify(around(afterA))}`,
		);
		say(`  [pins] under the pointer: ${JSON.stringify(afterA.atPoint)}`);

		/* ---- CASE A2: the UNPIN press, where the correction has a JOB ---- */
		/*
		 * REVIEW ROUND 3, MAJOR 1. The press above is held by arithmetic rather than by the
		 * correction: the pressed row leaves the list while `Pinned chats` grows by exactly one
		 * pitch above the pointer, so the rows below it cannot move and the correction computes
		 * `delta === 0` - and at `scrollTop 0` it has nothing to add even if it did not. Delete
		 * the pointer branch and that check still passes, which is round 2's m2 again.
		 *
		 * This case gives the correction real work and moves the region off the top so it can
		 * act: a PINNED row's glyph is pressed, so the row leaves `Pinned chats` for a section
		 * further down and the rows BETWEEN the two places genuinely move up by one pitch. Two
		 * things are then asserted, and the mutation that deletes the branch turns both red:
		 * the neighbouring row keeps its line, and the region's own `scrollTop` CHANGES - the
		 * second is what says the branch did the work rather than the layout cancelling itself.
		 */
		const pinnable = (await readList(cdp)).rows.filter(
			(row) =>
				row.pinned === true && row.pin && row.box.top > scrolled.listBox.top,
		);
		require("the promise state still has a pinned row to unpin", pinnable.length >
			0, JSON.stringify(
			(await readList(cdp)).rows.map((row) => [row.id, row.pinned]),
		));
		/*
		 * A DEPTH THE CORRECTION CAN ACT FROM, set directly rather than by centring a row:
		 * `scrollRegionToRow` clamps against the bottom of a tall list, and the section that has
		 * to stay in the window sits at the top of the content. A small scroll keeps a pinned row
		 * inside the window AND leaves room above for the correction to move the region up.
		 */
		await cdp.evaluate(`(() => {
			const rows = document.querySelectorAll("[data-session-row]");
			let list = rows[0] && rows[0].parentElement;
			while (list && !String(list.className).includes("overflow-y-auto")) {
				list = list.parentElement;
			}
			if (list) list.scrollTop = 140;
			return list ? list.scrollTop : null;
		})()`);
		await wait(320);
		const deepEnough = await readList(cdp);
		const unpinTarget = deepEnough.rows.find(
			(row) =>
				row.pinned === true &&
				row.pin &&
				row.box.top >= deepEnough.listBox.top - 1 &&
				row.box.bottom <= deepEnough.listBox.bottom + 1,
		);
		require("the unpin press has a pinned row inside the window, with the region scrolled off the top", unpinTarget &&
			deepEnough.scrollTop > 40, JSON.stringify({
			scrollTop: deepEnough.scrollTop,
			pinned: pinnable.map((row) => row.id),
		}));
		const unpinIndex = deepEnough.rows.findIndex(
			(row) => row.id === unpinTarget.id,
		);
		const belowNeighbour = deepEnough.rows[unpinIndex + 1];
		require("the unpin press has a row below it, in the same section, to measure", belowNeighbour &&
			belowNeighbour.pinned === true, JSON.stringify(
			deepEnough.rows
				.slice(unpinIndex, unpinIndex + 3)
				.map((row) => [row.id, row.pinned]),
		));
		await movePointer(cdp, unpinTarget.pin.x, unpinTarget.pin.y);
		await wait(260);
		const beforeUnpin = await readList(cdp, {
			x: unpinTarget.pin.x,
			y: unpinTarget.pin.y,
		});
		await pressPointer(cdp, unpinTarget.pin.x, unpinTarget.pin.y);
		await wait(520);
		const afterUnpin = await readList(cdp);
		const neighbourNow = afterUnpin.rows.find(
			(row) => row.id === belowNeighbour.id,
		);
		check(
			"an unpin press the correction can act on: the row below the pressed one keeps its line (review round 3, MAJOR 1)",
			Math.abs(
				(neighbourNow?.box.top ?? Number.NaN) - belowNeighbour.box.top,
			) <= 2,
			JSON.stringify({
				neighbour: belowNeighbour.id,
				top_before: belowNeighbour.box.top,
				top_after: neighbourNow?.box.top ?? null,
				scroll_before: beforeUnpin.scrollTop,
				scroll_after: afterUnpin.scrollTop,
			}),
		);
		check(
			"the correction moved the region to do it, rather than the layout cancelling out",
			afterUnpin.scrollTop !== beforeUnpin.scrollTop,
			JSON.stringify({
				scroll_before: beforeUnpin.scrollTop,
				scroll_after: afterUnpin.scrollTop,
				pressed: unpinTarget.id,
			}),
		);
		check(
			"the unpin press left the pinned set, as the control said it would",
			afterUnpin.rows.find((row) => row.id === unpinTarget.id)?.pinned ===
				false,
			JSON.stringify({
				rows: afterUnpin.rows.slice(0, 4).map((row) => [row.id, row.pinned]),
			}),
		);
		say(
			`  [pins] A2 unpin press: pressed ${unpinTarget.id}; scroll ${beforeUnpin.scrollTop} -> ${afterUnpin.scrollTop}; neighbour ${belowNeighbour.id} ${Math.round(belowNeighbour.box.top)} -> ${Math.round(neighbourNow?.box.top ?? Number.NaN)}`,
		);

		/* ---- CASE B: the KEYBOARD (U2) ---------------------------------- */
		const forKeyboard = visibleUnpinned(await readList(cdp));
		require("an unpinned row is visible for the keyboard case", forKeyboard.length >=
			1, JSON.stringify(forKeyboard.map((row) => row.label)));
		const targetB = forKeyboard[forKeyboard.length - 1];
		const focusedOnPin = await cdp.evaluate(`(() => {
			const row = document.querySelector('[data-session-row="${targetB.id}"]');
			const pin = row && row.querySelector("[data-session-pin]");
			if (!pin) return null;
			pin.focus();
			return document.activeElement === pin;
		})()`);
		require("the caret can be put on the pin", focusedOnPin ===
			true, JSON.stringify(focusedOnPin));
		await pressChord(cdp, { key: " ", code: "Space", virtualKeyCode: 32 });
		await wait(420);
		const afterB = await readList(cdp);
		const movedB = afterB.rows.find((row) => row.id === targetB.id);
		check(
			"Space pinned the conversation the caret was on",
			movedB !== undefined && movedB.pinned === true,
			JSON.stringify(movedB),
		);
		check(
			"focus follows the moved row: the caret is on the same pin (U2)",
			afterB.activeElement?.pin === true &&
				afterB.activeElement?.row === targetB.id,
			JSON.stringify(afterB.activeElement),
		);
		check(
			"the row the keyboard moved is still inside the list's view",
			movedB !== undefined &&
				movedB.box.top >= afterB.listBox.top - 1 &&
				movedB.box.bottom <= afterB.listBox.bottom + 1,
			JSON.stringify({ row: movedB?.box, list: afterB.listBox }),
		);
		/* ---- CASE C: the BOUNDARY (UX round 2's measured residual) ------ */
		/*
		 * THE RESIDUAL AS A BOUNDARY RATHER THAN A FAILURE. With the pinned set taller than the
		 * region's window, the correction's target clamps and the pressed row cannot be brought
		 * back to the reader's line - UX round 2 measured that as user-visible past roughly 30 %
		 * of the region's range. What must still hold is the anchor: the pressed row's
		 * neighbourhood keeps its lines. Both directions are asserted, so the check fails if the
		 * boundary moves the wrong way - if a deep press starts returning the row, or if the
		 * anchor stops holding at depth.
		 */
		for (const row of seeded) await setBackendPin(row.id, true);
		const deepAgain = Date.now();
		for (;;) {
			const now = await readList(cdp);
			if (now.rows.filter((row) => row.pinned === true).length >= 14) break;
			if (Date.now() - deepAgain > 8_000) break;
			await wait(150);
		}
		const deepStart = await readList(cdp);
		require("the deep state is back for the boundary case", deepStart.rows.filter(
			(row) => row.pinned === true,
		).length >= 14, JSON.stringify(
			deepStart.rows.map((row) => [row.id, row.pinned]),
		));
		/*
		 * The region is scrolled to an unpinned row's own line first: at this depth the window is
		 * pinned rows top to bottom (that is the point of the state), so a scene that read the
		 * visible rows only would find no candidate and report a store problem that is not there.
		 */
		const anyUnpinned = deepStart.rows.find(
			(row) => row.pinned === false && row.pin,
		);
		require("the deep state has an unpinned row somewhere", anyUnpinned, JSON.stringify(
			deepStart.rows.map((row) => [row.id, row.pinned]),
		));
		await scrollRegionToRow(anyUnpinned.id);
		await wait(240);
		const deepScrolled = await readList(cdp);
		const deepCandidates = visibleUnpinned(deepScrolled);
		const deepView = deepScrolled.rows;
		const targetC = deepCandidates[Math.floor(deepCandidates.length / 2)];
		require("the deep state has an unpinned row to press", targetC, JSON.stringify(
			deepView.map((row) => [row.id, row.pinned]),
		));
		const targetCIndex = deepView.findIndex((row) => row.id === targetC.id);
		const neighbourC = deepView[targetCIndex + 1] ?? deepView[targetCIndex - 1];
		await movePointer(cdp, targetC.pin.x, targetC.pin.y);
		await wait(240);
		const beforeC = await readList(cdp, { x: targetC.pin.x, y: targetC.pin.y });
		await pressPointer(cdp, targetC.pin.x, targetC.pin.y);
		await wait(460);
		const afterC = await readList(cdp);
		const pressedC = afterC.rows.find((row) => row.id === targetC.id);
		const neighbourCAfter = afterC.rows.find((row) => row.id === neighbourC.id);
		check(
			"at the deep state the anchor still holds: the neighbouring row keeps its line",
			Math.abs((neighbourCAfter?.box.top ?? Number.NaN) - neighbourC.box.top) <=
				2,
			JSON.stringify({
				neighbour: neighbourC.id,
				top_before: neighbourC.box.top,
				top_after: neighbourCAfter?.box.top ?? null,
			}),
		);
		check(
			"at a deep state the pressed row's new home is OFF the region's window (the far side of UX round 2's boundary)",
			pressedC !== undefined &&
				(pressedC.box.bottom < afterC.listBox.top - 1 ||
					pressedC.box.top > afterC.listBox.bottom + 1),
			JSON.stringify({
				row: targetC.id,
				top_before: targetC.box.top,
				top_after: pressedC?.box.top ?? null,
				scroll_before: beforeC.scrollTop,
				scroll_after: afterC.scrollTop,
				scroll_max: afterC.scrollHeight - afterC.clientHeight,
			}),
		);
		say(
			`  [pins] the boundary: pressed ${targetC.id} at y=${Math.round(targetC.box.top)} -> ${Math.round(pressedC?.box.top ?? Number.NaN)}; scroll ${beforeC.scrollTop} -> ${afterC.scrollTop} of ${afterC.scrollHeight - afterC.clientHeight}; neighbour ${neighbourC.id} ${Math.round(neighbourC.box.top)} -> ${Math.round(neighbourCAfter?.box.top ?? Number.NaN)}`,
		);

		/*
		 * PARK THE POINTER BEFORE THE FRAME (review round 2): the scrolled pair was captured with
		 * the pointer where the keyboard case left it, which drew a hovered heading.
		 */
		await parkPointer(cdp);
		await wait(240);
		{
			/*
			 * THE FRAME HAS TO SHOW THE CLAIM. The boundary case above leaves the region scrolled
			 * deep into the unpinned rows, where the pinned section is off the top of the window
			 * entirely - so a frame taken there asserts "the set is taller than the window" from a
			 * photograph in which no pinned row appears at all. The region goes back to the top of
			 * the list first, where the section is clipped by the window's own edge, which is what
			 * the check below is about and what a reader with a real pin list sees.
			 */
			/*
			 * SETTLE FIRST, THEN SET THE SCROLL, THEN READ THE STATE THE FRAME CARRIES.
			 *
			 * The reset used to be undone: the boundary press above arms the move correction,
			 * the effect runs after the NEXT render rather than at the press, and the reset
			 * landed in between - so the region went back to the depth the correction wanted
			 * (`scrollTop 1036`) while the log printed `0`, and the committed frames were taken
			 * at ~92% of the range with no pinned row in them (design round 3, D11: the caption
			 * described a state the bytes did not carry). The wait below lets the correction
			 * finish before the scroll is set, and the checks that follow assert the state at
			 * the moment of capture rather than the state this line asked for.
			 */
			await wait(700);
			await cdp.evaluate(`(() => {
				const rows = document.querySelectorAll("[data-session-row]");
				let list = rows[0].parentElement;
				while (list && !String(list.className).includes("overflow-y-auto")) {
					list = list.parentElement;
				}
				if (list) list.scrollTop = 0;
				return list ? list.scrollTop : null;
			})()`);
			await wait(420);
			const shown = await readList(cdp);
			const pinnedShown = shown.rows.filter((row) => row.pinned === true);
			const pinnedVisible = pinnedShown.filter(
				(row) =>
					row.box.bottom > shown.listBox.top &&
					row.box.top < shown.listBox.bottom,
			);
			check(
				"the frame is taken at the top of the region, with the pinned set in the window it cannot fit (design round 3, D11)",
				shown.scrollTop <= 40 && pinnedVisible.length > 0,
				JSON.stringify({
					scrollTop: shown.scrollTop,
					pinned_rows: pinnedShown.length,
					pinned_visible: pinnedVisible.length,
					list: shown.listBox,
				}),
			);
			const inside = pinnedShown.filter(
				(row) =>
					row.box.top >= shown.listBox.top - 1 &&
					row.box.bottom <= shown.listBox.bottom + 1,
			);
			/*
			 * THE CLAIM THESE FRAMES ARE FOR (design round 2, D7): the pinned set is taller than the
			 * region's window, so the section cannot be seen whole from here. The three-pin version
			 * photographed a set that fit, which refuted the claim it was taken for.
			 */
			check(
				"the pinned set is taller than the region's window, so the section cannot be whole",
				pinnedShown.length >= 14 && inside.length < pinnedShown.length,
				JSON.stringify({
					pinned: pinnedShown.length,
					wholly_inside: inside.length,
					scrollTop: shown.scrollTop,
					scrollHeight: shown.scrollHeight,
					clientHeight: shown.clientHeight,
				}),
			);
			say(
				`  [pins] capture-time scroll: scrollTop ${shown.scrollTop} of ${shown.scrollHeight - shown.clientHeight} (clientHeight ${shown.clientHeight}), pinned rows ${pinnedShown.length}, wholly inside ${inside.length}`,
			);
		}
		frames.push(await captureSettled(cdp, `pins-scrolled-${suffix}`));

		/* ---- D3: the pointer ON an already-pinned glyph ---------------- */
		/*
		 * A pinned row INSIDE the region's window: the deep boundary case above leaves the region
		 * scrolled past the top of a tall pinned section, and a row read from the document but
		 * drawn above the window has negative viewport coordinates - a pointer moved there leaves
		 * the page entirely (`elementFromPoint` answers null), which is what this scene measured
		 * before the window test was added.
		 */
		await scrollRegionToRow(
			(await readList(cdp)).rows.find((row) => row.pinned === true && row.pin)
				?.id ?? "",
		);
		await wait(240);
		const parked = await readList(cdp);
		const pinnedTarget = parked.rows.find(
			(row) =>
				row.pinned === true &&
				row.pin &&
				row.box.top >= parked.listBox.top - 1 &&
				row.box.bottom <= parked.listBox.bottom + 1,
		);
		require("a pinned row with a pin control is visible", pinnedTarget, JSON.stringify(
			parked.rows.map((row) => [row.id, row.pinned]),
		));
		await movePointer(cdp, pinnedTarget.pin.x, pinnedTarget.pin.y);
		await wait(280);
		const onGlyph = await readList(cdp, {
			x: pinnedTarget.pin.x,
			y: pinnedTarget.pin.y,
		});
		check(
			"the pointer is on the pinned row's own glyph",
			onGlyph.atPoint?.pin === true && onGlyph.atPoint?.row === pinnedTarget.id,
			JSON.stringify(onGlyph.atPoint),
		);
		check(
			"the glyph under the pointer is FILLED, so the state reads without the reveal",
			onGlyph.rows.find((row) => row.id === pinnedTarget.id)?.pinFill ===
				"currentColor",
			JSON.stringify(onGlyph.rows.find((row) => row.id === pinnedTarget.id)),
		);
		frames.push(await captureSettled(cdp, `pins-pinned-hover-${suffix}`));

		await parkPointer(cdp);
		const pinnedNow = await readList(cdp);
		/*
		 * HOUSEKEEPING, through the daemon's own route. This loop exists so the next theme starts
		 * from the state this one found, and it must not depend on pointer geometry: a row at the
		 * top of a tall pinned section sits under the section's own heading, where a press lands on
		 * the heading's button rather than on the glyph (measured: `d0a7477ff229` never came under
		 * the pointer at any of four attempts on either theme), and the press guard correctly drops
		 * a chain of presses that never move the pointer. Neither fact should be able to leave pins
		 * behind for the next pass, and the promise that matters - the control unpins the row it
		 * pinned - is asserted where a reader makes it: CASE A above, and `--scene pins-search`.
		 */
		for (const row of pinnedNow.rows.filter((item) => item.pinned === true)) {
			await setBackendPin(row.id, false);
		}
		/*
		 * RE-READ AND REPEAT, because a press made moments earlier can land in the store after
		 * this loop has read the list: the boundary case's own press is one, and a stale read is
		 * how a single pin survived here (`e79ebe96485c`, on the first run of this loop). The
		 * assertion below is still an assertion - the loop just gets to see its own work settle.
		 */
		for (let settled = 0; settled < 3; settled += 1) {
			await wait(600);
			const stillPinned = (await readList(cdp)).rows.filter(
				(item) => item.pinned === true,
			);
			if (stillPinned.length === 0) break;
			for (const row of stillPinned) await setBackendPin(row.id, false);
		}
		const cleared = await readList(cdp);
		check(
			`${suffix}: the pass leaves no pins behind for the next theme`,
			cleared.rows.every((row) => row.pinned !== true),
			JSON.stringify(
				cleared.rows.filter((row) => row.pinned).map((row) => row.id),
			),
		);
	}
	return frames;
}

/**
 * The search-only conversation, and the parked pointer's second press.
 *
 * WHY THIS IS A SCENE OF ITS OWN. The panel's catalogue read is a PAGE (up to 500 sessions);
 * the search answer is asked of the WHOLE store. A conversation outside the page therefore
 * reaches this panel only as a HIT - and that row is the one QA round 2 pinned and could not
 * unpin (Qr2-1): the store's optimistic write mapped over rows it did not hold, so the panel
 * kept drawing the cached wire hit and the press re-sent the state already applied.
 *
 * It carries the other half of the parked-pointer story too (UX round 2, U3-unpin): a
 * genuinely STATIONARY second press on a pinned row's glyph - the instrument the round warned
 * about, since a `mouseMoved` between the two clicks re-arms the disarm and makes the pin
 * direction look broken when it is not - and the 3 px wobble variant of the same gesture.
 *
 *   node scripts/renderer-driver.mjs --scene pins-search --backend <url> \
 *     --tui-python <python> --tui-config <config-root> --out <dir>
 *
 * It needs a store with more sessions than the client's page holds (568 seeded: the page
 * reads 500) and the terminal's own interpreter, because the third surface - the store the
 * TUI reads - is what says whether the press actually landed anywhere.
 */
async function scenePinsSearch(cdp) {
	const frames = [];
	for (const theme of sceneThemes()) {
		const suffix = theme === "localOperatorDark" ? "dark" : "light";
		await verb(cdp, "setTheme", theme);
		await wait(300);
		await openSection(cdp, "Previous chats");
		await openSection(cdp, "Active chats");

		/* ---- 1. a conversation the client's page does not hold ---------- */
		/*
		 * WHICH conversation is outside the page. The route caps `limit` at the page's own
		 * size, so the store cannot be listed past it - the seeder owns the order instead:
		 * `--generate N` writes its mtimes in sequence, so the OLDEST titles are the ones the
		 * page drops, and `--search-title` names one of them. The check that it really is
		 * outside the page is the DOM read below, which is the fact this scene is about.
		 */
		const page = await readBackendSessions(500);
		const wantedTitle = SEARCH_TITLE;
		require("the page does not hold the title this scene is searching for", !page.some(
			(row) => row.title === wantedTitle,
		), JSON.stringify({
			page: page.length,
			wanted: wantedTitle,
			first: page.slice(0, 3).map((row) => row.title),
		}));
		const outside = { id: null, title: wantedTitle };
		const listedBefore = await cdp.evaluate(`(() => {
			const wanted = ${JSON.stringify(`Recent${wantedTitle}`)};
			return Array.from(document.querySelectorAll("[data-session-row]"))
				.some((row) => row.textContent.replace(/\\s+/g, " ").trim() === wanted ||
					row.textContent.includes(${JSON.stringify(wantedTitle)}));
		})()`);
		check(
			"the page does not list it, so the search answer is the only way it can arrive",
			listedBefore === false,
			JSON.stringify({ title: wantedTitle, listedBefore }),
		);

		/* ---- 2. ask for it through the panel's own search box ----------- */
		const focused = await cdp.evaluate(`(() => {
			const field = document.querySelector('input[aria-label="Search chats and agents"]');
			if (!field) return null;
			field.focus();
			return document.activeElement === field;
		})()`);
		require("the caret is in the search field", focused ===
			true, JSON.stringify(focused));
		/*
		 * The query is the WHOLE title, not its first word: every seeded title begins with
		 * "Sweep", so a one-word query matches the client's own page and the hit-only row the
		 * scene is about never appears. Measured - the first version of this searched "Sweep"
		 * and the panel answered with 98 listed rows.
		 */
		const token = String(wantedTitle);
		await cdp.send("Input.insertText", { text: token });
		await wait(900);
		const found = (await readList(cdp)).rows.find((row) =>
			row.label.includes(wantedTitle),
		);
		/*
		 * The id comes from the ROW, not from a listing: the store cannot be listed past the
		 * page, and the hit is the only place this conversation's id exists on this side.
		 */
		if (found) outside.id = found.id;
		note(
			"the panel after the query",
			JSON.stringify({
				token,
				order: (await readPins(cdp)).order.slice(0, 14),
				rows: (await readList(cdp)).rows.map((row) => [
					row.id,
					row.label,
					row.pinned,
				]),
			}),
		);
		require("the search answer is drawn as a row", found, JSON.stringify({
			token,
			rows: (await readList(cdp)).rows.map((row) => [
				row.id,
				row.label,
				row.pinned,
			]),
		}));
		check(
			"the hit is drawn, with a pin control, and the wire says it is unpinned",
			found !== undefined && found.pin !== null && found.pinned === false,
			JSON.stringify({
				token,
				found: found ?? null,
				rows: (await readList(cdp)).rows.map((row) => [row.id, row.pinned]),
			}),
		);

		/* ---- 3. PIN from that row, and watch all three surfaces --------- */
		const storeBefore = tuiStoreReading().pins;
		await pressPointer(cdp, found.pin.x, found.pin.y);
		await wait(600);
		const afterPin = (await readList(cdp)).rows.find(
			(row) => row.id === outside.id,
		);
		const wirePinned = (await readBackendSearch(token)).sessions.find(
			(row) => row.id === outside.id,
		);
		const storePinned = tuiStoreReading().pins;
		const pinnedAtPress = afterPin?.pin ?? null;
		check(
			"the row follows the press: it is pinned, from a row the store did not hold",
			afterPin?.pinned === true,
			JSON.stringify({
				row: afterPin ?? null,
				rows: (await readList(cdp)).rows.map((item) => [item.id, item.pinned]),
			}),
		);
		check(
			"the wire the search answers from says pinned, on the hit itself",
			wirePinned?.pinned === true,
			JSON.stringify({ wirePinned, token }),
		);
		check(
			"the store the terminal reads holds it",
			storePinned.includes(outside.id),
			JSON.stringify({ storeBefore, storePinned }),
		);
		frames.push(await captureSettled(cdp, `pins-search-pinned-${suffix}`));

		/* ---- 4. UNPIN from the same row (round 1's Q1, reverse) -------- */
		const rowForUnpin = (await readList(cdp)).rows.find(
			(row) => row.id === outside.id,
		);
		require("the pinned row is still on screen to unpin from", rowForUnpin?.pin, JSON.stringify(
			(await readList(cdp)).rows.map((row) => [row.id, row.pinned]),
		));
		/*
		 * WHERE THE CONTROL IS when the unpin press is made, and where it was when the pin press
		 * was made. The row moves between the two (it joins the Pinned section), and the reveal's
		 * disarm ends on a movement rather than on a tremor - so this pair is what says whether
		 * the second press is a gesture a reader could make at all.
		 */
		say(
			`  [pins] the pinned row's glyph: ${JSON.stringify(rowForUnpin.pin)} (was ${JSON.stringify(pinnedAtPress)})`,
		);
		await pressPointer(cdp, rowForUnpin.pin.x, rowForUnpin.pin.y);
		const timeline = [];
		for (const step of [150, 400, 900]) {
			await wait(step);
			const now = (await readList(cdp)).rows.find(
				(row) => row.id === outside.id,
			);
			const wire = (await readBackendSearch(token)).sessions.find(
				(row) => row.id === outside.id,
			);
			timeline.push({
				at: step,
				dom: now ? now.pinned : null,
				wire: wire ? wire.pinned : null,
				store: tuiStoreReading().pins.length,
			});
		}
		say(`  [pins] unpin timeline: ${JSON.stringify(timeline)}`);
		await wait(300);
		const afterUnpin = (await readList(cdp)).rows.find(
			(row) => row.id === outside.id,
		);
		const wireUnpinned = (await readBackendSearch(token)).sessions.find(
			(row) => row.id === outside.id,
		);
		const storeUnpinned = tuiStoreReading().pins;
		check(
			"the SAME row unpins what it pinned: the store's state is what the control inverts",
			afterUnpin?.pinned === false && wireUnpinned?.pinned === false,
			JSON.stringify({ row: afterUnpin ?? null, wireUnpinned }),
		);
		check(
			"the store the terminal reads has dropped it",
			!storeUnpinned.includes(outside.id),
			JSON.stringify({ storePinned, storeUnpinned }),
		);
		frames.push(await captureSettled(cdp, `pins-search-unpinned-${suffix}`));

		/* ---- 4b. the query CLEARED, and the pin the page cannot carry -- */
		/*
		 * DESIGN ROUND 3, D12. Both directions above are photographed with the query still in
		 * the box, so the state one click later - the pin held by the store for a conversation
		 * the catalogue page does not carry - was in no frame and in no check. It is the state
		 * the durability claim has to show itself in: `pinFacts` is a record of booleans with no
		 * title, and the ordinary list path returns the page's rows unchanged once the query is
		 * empty, so what the panel can draw there is the question this frame answers.
		 */
		const repin = (await readList(cdp)).rows.find(
			(row) => row.id === outside.id,
		);
		require("the row is back on screen to re-pin", repin?.pin, JSON.stringify(
			(await readList(cdp)).rows.map((row) => [row.id, row.pinned]),
		));
		await pressPointer(cdp, repin.pin.x, repin.pin.y);
		await wait(520);
		check(
			"the third press pins the row again, from the same control",
			(await readList(cdp)).rows.find((row) => row.id === outside.id)
				?.pinned === true,
			JSON.stringify(
				(await readList(cdp)).rows.map((row) => [row.id, row.pinned]),
			),
		);
		const clearAgain = await cdp.evaluate(`(() => {
			const clear = document.querySelector('button[aria-label="Clear search"]');
			if (!clear) return null;
			const box = clear.getBoundingClientRect();
			return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		})()`);
		await parkPointer(cdp);
		require("the panel offers the clear-search control", clearAgain, "none");
		await pressPointer(cdp, clearAgain.x, clearAgain.y);
		await wait(600);
		const clearedState = await readList(cdp);
		const clearedPinned = clearedState.rows.filter(
			(row) => row.pinned === true,
		);
		const heldByTerminal = tuiStoreReading().pins;
		/*
		 * THE HELD PIN MUST BE A ROW, above the other sections, and its section must count it
		 * (design round 4, D17; UX round 4, U14). The state this asserts is the one D12
		 * photographed as a near-absence: the backend and the terminal both holding a pin and
		 * the app drawing no row, no heading and no count for a conversation that is genuinely
		 * in the shared pinned set. Read from the DOM by id, and read against the SAME store
		 * the terminal reads, so the two surfaces are compared in one assertion.
		 */
		const panel = await cdp.evaluate(`(() => {
			const heading = Array.from(
				document.querySelectorAll("button[data-chat-row]"),
			).find((button) =>
				(button.textContent || "").trim().startsWith("Pinned chats"),
			);
			const active = Array.from(
				document.querySelectorAll("button[data-chat-row]"),
			).find((button) => (button.textContent || "").trim().startsWith("Active chats"));
			const row = document.querySelector('[data-session-row="${outside.id}"]');
			return {
				heading: heading ? (heading.textContent || "").trim() : null,
				headingTop: heading ? heading.getBoundingClientRect().top : null,
				activeTop: active ? active.getBoundingClientRect().top : null,
				rowId: row ? row.getAttribute("data-session-row") : null,
				rowText: row ? (row.textContent || "").trim() : null,
				rowTop: row ? row.getBoundingClientRect().top : null,
			};
		})()`);
		say(
			`  [pins] D12 after the query is cleared: pinned rows drawn ${JSON.stringify(clearedPinned.map((row) => row.id))}; rows ${clearedState.rows.length}; terminal holds ${JSON.stringify(heldByTerminal)}; panel ${JSON.stringify(panel)}`,
		);
		check(
			"the pin the page cannot carry is DRAWN as a row above Active chats, and its section counts it (design round 4, D17; UX round 4, U14)",
			clearedPinned.some((row) => row.id === outside.id) &&
				panel.rowId === outside.id &&
				panel.heading !== null &&
				panel.activeTop !== null &&
				panel.rowTop !== null &&
				panel.rowTop < panel.activeTop,
			JSON.stringify({ drawn: clearedPinned.map((row) => row.id), panel }),
		);
		check(
			"the terminal still holds the pin with the query cleared - the durable half of D12",
			heldByTerminal.includes(outside.id),
			JSON.stringify({
				heldByTerminal,
				drawn: clearedPinned.map((row) => row.id),
			}),
		);
		frames.push(await captureSettled(cdp, `pins-search-cleared-${suffix}`));

		/* ---- 4c. the OTHER surface removes it, and the next ANSWER says so */
		/*
		 * ROUND 3'S MAJOR 2, LIVE. The fact is a client-side memory, and a memory that outranks
		 * every later answer is the defect the review named: pin here, remove it on the other
		 * surface, ask the search again, and a row that still reads pinned would send the state
		 * the backend already holds. The removal goes through the daemon's own route (the
		 * terminal's store), and the re-ask is the reader's own gesture - the query re-typed -
		 * so the sequence is what a second surface does, not a synthetic poke.
		 */
		await setBackendPin(outside.id, false);
		const reAsk = await cdp.evaluate(`(() => {
			const field = document.querySelector('input[aria-label="Search chats and agents"]');
			if (!field) return null;
			field.focus();
			return document.activeElement === field;
		})()`);
		require("the caret is back in the search field", reAsk ===
			true, JSON.stringify(reAsk));
		/*
		 * A DIFFERENT string, so the request is genuinely new: react-query serves the same query
		 * inside its `staleTime` from cache and the `queryFn` - where the answer's currency is
		 * taken - does not run at all. The claim is about the next ANSWER, and only a fresh
		 * request produces one; a cached answer is not newer than the press and correctly leaves
		 * the client's memory alone.
		 */
		await cdp.send("Input.insertText", { text: token.slice(0, -1) });
		/*
		 * WAIT FOR THE ANSWER, not for a number of milliseconds. The property is "the next
		 * ANSWER settles it", so the instrument has to observe an answer rather than a delay
		 * chosen on an idle machine - this read is what a loaded host made a false failure out
		 * of (a 1.4 s wait that the debounce, the request and the doorbell had to fit inside).
		 */
		/*
		 * A READ THAT ANSWERS NOTHING IS NOT AN ANSWER: `readList` returns null while the
		 * renderer is mid-navigation, and reading `.rows` off it threw here on a loaded host
		 * (the same shape twice in one pass). The loop tolerates the empty read and asks again,
		 * which is what it was already doing for the answer it is waiting for.
		 */
		let afterRemoval = null;
		for (let attempt = 0; attempt < 24; attempt++) {
			await wait(250);
			const state = await readList(cdp);
			if (state === null) continue;
			afterRemoval = state;
			const row = state.rows.find((item) => item.id === outside.id);
			if (row !== undefined && row.pinned === false) break;
		}
		require("the panel answered the re-asked search", afterRemoval !==
			null, "the list never answered a read");
		const rowAfterRemoval = afterRemoval.rows.find(
			(row) => row.id === outside.id,
		);
		check(
			"a pin removed on the other surface stops reading pinned on the next answer (round 3, MAJOR 2)",
			rowAfterRemoval !== undefined && rowAfterRemoval.pinned === false,
			JSON.stringify({
				row: rowAfterRemoval ?? null,
				rows: afterRemoval.rows.map((row) => [row.id, row.pinned]),
			}),
		);
		frames.push(
			await captureSettled(cdp, `pins-search-resuperseded-${suffix}`),
		);

		/* ---- 5. the STATIONARY second press, and the 3 px wobble ------- */
		/*
		 * RELEASE THE QUERY FIRST, through the panel's own clear control. With a query in the
		 * box this panel draws the matching hits only, so the two conversations about to be
		 * pinned are not rows at all - and the step below then looks for a pinned row it cannot
		 * see. (Measured: the first version of this scene kept the query and read `[]`.)
		 */
		const clearBox = await cdp.evaluate(`(() => {
			const clear = document.querySelector('button[aria-label="Clear search"]');
			if (!clear) return null;
			const box = clear.getBoundingClientRect();
			return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		})()`);
		require("the panel offers a clear-search control", clearBox, "none");
		await parkPointer(cdp);
		await pressPointer(cdp, clearBox.x, clearBox.y);
		await wait(400);
		await openSection(cdp, "Active chats");
		await openSection(cdp, "Previous chats");
		const seeds = (await readBackendSessions()).slice(0, 2);
		for (const row of seeds) await setBackendPin(row.id, true);
		const started = Date.now();
		let pinnedRow = null;
		for (;;) {
			const now = await readList(cdp);
			pinnedRow = now.rows.find((row) => row.pinned === true && row.pin);
			if (pinnedRow) break;
			if (Date.now() - started > 8_000) break;
			await wait(150);
		}
		require("a pinned row with a glyph is on screen", pinnedRow, JSON.stringify(
			(await readList(cdp)).rows.map((row) => [row.id, row.pinned]),
		));
		await parkPointer(cdp);
		await movePointer(cdp, pinnedRow.pin.x, pinnedRow.pin.y);
		await wait(260);
		/*
		 * The gesture QA's repro is made of: press the glyph, then press the SAME control again
		 * with the pointer parked exactly where it is. The first press acts on this row; the
		 * repeat is a press the reader made ON THIS CONTROL, so it acts on it too - and the
		 * point of the check is that it acts on nothing ELSE. Reading the row under the pointer
		 * at each press is what separates the two cases the round turned on: a control the
		 * reader is pointing at (act on it) and a row that merely slid into place under a
		 * parked pointer (drop the press, which is the `pins` scene's hazard check).
		 */
		const beforeRepeat = tuiStoreReading().pins;
		await pressPointerStationary(cdp, pinnedRow.pin.x, pinnedRow.pin.y);
		await wait(360);
		const afterFirst = tuiStoreReading().pins;
		/*
		 * Read the control under the pointer BEFORE the press: a pin press moves a row out of
		 * its section, so `elementFromPoint` afterwards describes where the pointer ended up,
		 * not what it was aimed at. (The first version of this read it afterwards and reported
		 * `under: null` for a press that had just acted on the row under it.)
		 */
		const underBeforeRepeat = await readList(cdp, {
			x: pinnedRow.pin.x,
			y: pinnedRow.pin.y,
		});
		const underId = underBeforeRepeat.atPoint?.row ?? null;
		await pressPointerStationary(cdp, pinnedRow.pin.x, pinnedRow.pin.y);
		await wait(460);
		const afterRepeat = tuiStoreReading().pins;
		const changedByRepeat = [
			...afterFirst.filter((id) => !afterRepeat.includes(id)),
			...afterRepeat.filter((id) => !afterFirst.includes(id)),
		];
		/*
		 * BOTH HALVES, so the check can fail in both directions (review round 3, MINOR 1; UX
		 * round 3, U10). The pre-state change is asserted first - otherwise `.every()` over an
		 * empty diff is satisfied by a press that did nothing at all - and the repeat is then
		 * required to act on the row under the pointer when that row is the pressed one, and to
		 * change nothing at all when it is not. The same-identity reading is unreachable by
		 * POINTER on this panel (a toggle moves the glyph about 105 px, out of any slop), so the
		 * reader's own repeat is exercised where it can happen - by keyboard, below - and this
		 * check claims only what the pointer can show.
		 */
		check(
			"the first press of the pair acted on the row it was aimed at (U3-unpin)",
			afterFirst.length === beforeRepeat.length - 1 &&
				!afterFirst.includes(pinnedRow.id),
			JSON.stringify({ beforeRepeat, afterFirst, pressed: pinnedRow.id }),
		);
		check(
			"a stationary repeat press acts on the row under the pointer and on no other (U3-unpin)",
			underId === pinnedRow.id
				? changedByRepeat.length === 1 && changedByRepeat[0] === pinnedRow.id
				: changedByRepeat.length === 0,
			JSON.stringify({
				pressed: pinnedRow.id,
				underId,
				beforeRepeat,
				afterFirst,
				afterRepeat,
				changedByRepeat,
			}),
		);
		/*
		 * ...and a 3 px tremor is the same gesture: the pointer has still not gone anywhere, so
		 * the guard still measures it against the press it repeats. If the row under it is the
		 * one the reader pressed, that row's control acts; if it is not, nothing does.
		 */
		await movePointer(cdp, pinnedRow.pin.x + 3, pinnedRow.pin.y);
		const underBeforeWobble = await readList(cdp, {
			x: pinnedRow.pin.x + 3,
			y: pinnedRow.pin.y,
		});
		await pressPointerStationary(cdp, pinnedRow.pin.x + 3, pinnedRow.pin.y);
		await wait(460);
		const afterWobble = tuiStoreReading().pins;
		const changedByWobble = [
			...afterRepeat.filter((id) => !afterWobble.includes(id)),
			...afterWobble.filter((id) => !afterRepeat.includes(id)),
		];
		check(
			"a 3 px wobble is the same gesture: it never reaches a row the pointer is not on",
			(underBeforeWobble.atPoint?.row ?? null) === pinnedRow.id
				? changedByWobble.every((id) => id === pinnedRow.id)
				: changedByWobble.length === 0,
			JSON.stringify({
				pressed: pinnedRow.id,
				under: underBeforeWobble.atPoint?.row ?? null,
				afterRepeat,
				afterWobble,
				changedByWobble,
			}),
		);
		frames.push(await captureSettled(cdp, `pins-stationary-${suffix}`));

		/*
		 * THE READER'S OWN REPEAT, BY KEYBOARD (UX round 3, U10). The same control pressed twice
		 * in a row is a toggle - that is what unpinning from the row you just pinned is - and by
		 * pointer it is unreachable on this panel, because the row moves out of the slop between
		 * the two presses. The keyboard has no slop and no pointer, so the property is real here:
		 * focus the row's own glyph and toggle it twice, asserting the store follows both ways.
		 */
		const keyboardTarget = (await readList(cdp)).rows.find(
			(row) => row.pinned === true && row.pin,
		);
		require("the keyboard case has a pinned row to toggle", keyboardTarget, JSON.stringify(
			(await readList(cdp)).rows.map((row) => [row.id, row.pinned]),
		));
		const focusable = await cdp.evaluate(`(() => {
			const row = document.querySelector('[data-session-row="${keyboardTarget.id}"]');
			const pin = row && row.querySelector("[data-session-pin]");
			if (!pin) return false;
			pin.focus();
			return document.activeElement === pin;
		})()`);
		require("the caret can be put on the pinned row's own glyph", focusable ===
			true, JSON.stringify(focusable));
		const beforeKeyboard = tuiStoreReading().pins;
		await pressChord(cdp, { key: " ", code: "Space", virtualKeyCode: 32 });
		await wait(420);
		const afterKeyboardFirst = tuiStoreReading().pins;
		await pressChord(cdp, { key: " ", code: "Space", virtualKeyCode: 32 });
		await wait(420);
		const afterKeyboardSecond = tuiStoreReading().pins;
		check(
			"the reader's own repeat works by keyboard: the first press removes it, the second puts it back (U10)",
			!afterKeyboardFirst.includes(keyboardTarget.id) &&
				afterKeyboardSecond.includes(keyboardTarget.id) &&
				afterKeyboardSecond.length === beforeKeyboard.length,
			JSON.stringify({
				row: keyboardTarget.id,
				beforeKeyboard,
				afterKeyboardFirst,
				afterKeyboardSecond,
			}),
		);

		/* ---- 6. the TERMINAL pins an OLDER conversation the app never watched (U15) ---- */
		/*
		 * UX round 5's U15, end to end. A pin the app never watched being made - a fresh boot,
		 * or the terminal's `f10` - drew no row, no count and no trace for 11.2 s and beyond,
		 * because the only read channel was the `pinned` flag on a row of the client's own
		 * 500-row page and the operator's store holds thousands. The backend increment closes
		 * it: the list route appends every pinned conversation below the newest `limit` rows,
		 * so the panel's ordinary row path draws it with no merge path of its own.
		 *
		 * The pin is written by the TERMINAL'S OWN WRITER in a separate process, on a
		 * conversation that is not on the page at all, and the app is not touched: no reload,
		 * no focus, no refetch. What is measured is how long the operator would wait, and then
		 * the same row is unpinned from that surface and must leave.
		 */
		const u15Clear = await cdp.evaluate(`(() => {
			const clear = document.querySelector('button[aria-label="Clear search"]');
			if (!clear) return null;
			const box = clear.getBoundingClientRect();
			return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		})()`);
		if (u15Clear) {
			await pressPointer(cdp, u15Clear.x, u15Clear.y);
			await wait(400);
		}
		const pageIds = new Set(
			(await readBackendSessions(500)).map((row) => row.id),
		);
		const listed = spawnSync(
			TUI_PYTHON,
			[
				"-c",
				"import json,os,sys;print(json.dumps(sorted(os.listdir(os.path.join(sys.argv[1],'sessions')))))",
				TUI_CONFIG,
			],
			{ encoding: "utf8", env: pythonChildEnv({}) },
		);
		const terminalIds = JSON.parse(listed.stdout || "[]");
		const offPage = terminalIds.filter((id) => !pageIds.has(id));
		require("the store has conversations beyond the client's own page for the terminal to pin", offPage.length >
			0, JSON.stringify({
			page: pageIds.size,
			terminal: terminalIds.length,
			sample: terminalIds.slice(0, 3),
		}));
		const offPageTarget = offPage[0];
		const pinWriter = [
			"import json,sys",
			"from local_operator.tui.sidebar_pins import read_pins, toggle_pin",
			"root = sys.argv[1]",
			"session_id = sys.argv[2]",
			"toggle_pin(root, session_id)",
			"print(json.dumps({'pins': list(read_pins(root))}))",
		].join("\n");
		const pinnedIt = spawnSync(
			TUI_PYTHON,
			["-c", pinWriter, TUI_CONFIG, offPageTarget],
			{ encoding: "utf8", env: pythonChildEnv({}) },
		);
		check(
			"the terminal's own writer pinned a conversation the page does not carry",
			pinnedIt.status === 0 && tuiStoreReading().pins.includes(offPageTarget),
			JSON.stringify({
				status: pinnedIt.status,
				stdout: pinnedIt.stdout,
				stderr: pinnedIt.stderr,
			}),
		);
		const startedAt = Date.now();
		let offPageRow = null;
		for (let attempt = 0; attempt < 48; attempt++) {
			await wait(250);
			/*
			 * An empty read is not an absence: `readList` answers null while the renderer is
			 * mid-navigation, and the wait here is for a ROW, so an empty read asks again
			 * rather than throwing (review round 6, r6-1: the same shape this commit fixed
			 * in the re-ask below, twice over).
			 */
			const state = await readList(cdp);
			if (state === null) continue;
			offPageRow = state.rows.find((row) => row.id === offPageTarget) ?? null;
			if (offPageRow !== null) break;
		}
		const waitedMs = Date.now() - startedAt;
		const offPagePanel = await cdp.evaluate(`(() => {
			const heading = Array.from(
				document.querySelectorAll("button[data-chat-row]"),
			).find((button) => (button.textContent || "").trim().startsWith("Pinned chats"));
			const row = document.querySelector('[data-session-row="${offPageTarget}"]');
			return {
				heading: heading ? (heading.textContent || "").trim() : null,
				rowText: row ? (row.textContent || "").trim() : null,
			};
		})()`);
		const offPageTerminal = tuiStoreReading().pins;
		say(
			`  [pins] U15 off-page pin: ${offPageTarget} (of ${terminalIds.length} in the store, ${pageIds.size} on the page) drawn after ${waitedMs} ms; panel ${JSON.stringify(offPagePanel)}`,
		);
		check(
			"a pin the terminal made on a conversation the page does not carry is DRAWN, named, pinned at rest and counted (UX round 5, U15)",
			offPageRow !== null &&
				offPageRow.pinned === true &&
				offPageTerminal.includes(offPageTarget) &&
				offPagePanel.heading !== null &&
				(offPagePanel.rowText || "").trim().length > 0,
			JSON.stringify({
				waitedMs,
				row: offPageRow,
				panel: offPagePanel,
				terminal: offPageTerminal,
			}),
		);
		frames.push(await captureSettled(cdp, `pins-tui-offpage-${suffix}`));
		const unpinned = spawnSync(
			TUI_PYTHON,
			["-c", pinWriter, TUI_CONFIG, offPageTarget],
			{ encoding: "utf8", env: pythonChildEnv({}) },
		);
		let left = false;
		for (let attempt = 0; attempt < 48; attempt++) {
			await wait(250);
			/* The same empty read, and the same answer: ask again. */
			const state = await readList(cdp);
			if (state === null) continue;
			if (!state.rows.some((row) => row.id === offPageTarget)) {
				left = true;
				break;
			}
		}
		check(
			"and the row LEAVES when the terminal unpins it, rather than being held by this client's memory",
			unpinned.status === 0 && left,
			JSON.stringify({
				status: unpinned.status,
				left,
				terminal: tuiStoreReading().pins,
			}),
		);

		/* Leave the store as the theme found it, so the next pass starts clean. */
		for (const row of (await readBackendSessions()).filter((r) => r.pinned)) {
			await setBackendPin(row.id, false);
		}
		await parkPointer(cdp);
		await wait(200);
	}
	return frames;
}

const sceneThemes = () =>
	THEME === null ? ["localOperatorDark", "localOperatorLight"] : [THEME];

async function scenePins(cdp) {
	const hello = await verb(cdp, "hello");
	check(
		"the renderer reports this run's frames directory",
		hello.outDir === FRAMES,
		`${hello.outDir} (expected ${FRAMES})`,
	);
	const facts = await factsOf(cdp);
	check(
		"window mode is headless",
		facts.windowMode === "headless",
		facts.windowMode,
	);
	check(
		"the window is never shown and never focused",
		facts.visible === false && facts.focused === false,
		`visible=${facts.visible} focused=${facts.focused}`,
	);
	if (BACKEND === null) {
		/*
		 * Refused rather than run. Without a backend there is no catalogue, so there
		 * are no rows to pin and no capability to read: every frame this scene would
		 * write would be a picture of an empty panel, which is a state that says
		 * nothing about pinning.
		 */
		throw new Error(
			"--scene pins needs --backend <url>: the pin store is the backend's, and a run with none has no rows to pin",
		);
	}
	await verb(cdp, "navigate", "/chat");
	const route = await waitForRoute(cdp, "/chat");
	check(
		"the scene is on the chat route",
		route.route === "/chat",
		JSON.stringify(route),
	);

	const themes =
		THEME === null ? ["localOperatorDark", "localOperatorLight"] : [THEME];
	const frames = [];
	for (const theme of themes) {
		const applied = await verb(cdp, "setTheme", theme);
		check(
			`the theme change to ${theme} settled before any frame`,
			applied.settleTimedOut === false,
			JSON.stringify(applied),
		);
		const suffix = theme === "localOperatorDark" ? "dark" : "light";
		await parkPointer(cdp);
		/*
		 * `Previous chats` starts CLOSED, so on a store nobody has opened yet the
		 * panel draws its heading and none of its rows. The scene opens it through
		 * the panel's own heading and waits for the rows rather than assuming a timer
		 * is enough.
		 */
		const start = await openSection(cdp, "Previous chats");
		/*
		 * WHAT THE RESERVED SLOT COSTS A TITLE (design round 1, D5). Measured rather
		 * than argued: the conversation button's own box against the withdrawn run's,
		 * where no slot exists. Both numbers are printed by the two runs, so the cost is
		 * a subtraction in the record rather than a claim in a comment.
		 */
		const measured = await readList(cdp);
		if (measured && measured.rows.length > 0) {
			const first = measured.rows[0];
			say(
				`  [pins] reserved slot: present row ${Math.round(first.box.width)}px, conversation button ${first.button ? Math.round(first.button.width) : "none"}px, pin ${first.pin ? Math.round(first.pin.width) : "none"}px`,
			);
		}

		if (start.controls === 0) {
			/*
			 * THE FAIL-CLOSED HALF. No pin control anywhere, and the conversation row is
			 * the PRE-CHANGE row: its own parent is the section, with no wrapper element
			 * introduced between them and no reserved slot to find. Both are asserted
			 * before the frame, because a frame of a withdrawn capability that still
			 * moved the row by 28px would be a picture of the bug rather than of the
			 * fallback - and the byte comparison against this same scene's frames from
			 * the tree before this change is what closes the claim.
			 */
			check(
				"the backend advertises no pin store, so no control is mounted",
				start.controls === 0,
				JSON.stringify({ rows: start.rows.length, pins: start.controls }),
			);
			check(
				"a conversation row is one button in its own section, as it was before this change",
				start.rows.length > 0 &&
					start.rows.every(
						(row) => row.parentTag === "section" && row.pinSibling === 0,
					),
				JSON.stringify(start.rows.slice(0, 3)),
			);
			/*
			 * WHAT THE SLOT COSTS, on the side that has none (design round 1, D5): the same
			 * measurement the capability-present branch prints, so the cost is a
			 * subtraction between two numbers in this log rather than a claim.
			 */
			const withdrawnWidth = await cdp.evaluate(`(() => {
				const row = document.querySelector('button[data-tour-tag="chat-session-row"]');
				if (!row) return null;
				const box = row.getBoundingClientRect();
				const parent = row.parentElement;
				return {
					row: Math.round(parent ? parent.getBoundingClientRect().width : box.width),
					button: Math.round(box.width),
				};
			})()`);
			if (withdrawnWidth !== null) {
				say(
					`  [pins] reserved slot: withdrawn row ${withdrawnWidth.row}px, conversation button ${withdrawnWidth.button}px, pin none`,
				);
			}
			frames.push(await captureSettled(cdp, `pins-withdrawn-${suffix}`));
			continue;
		}

		/*
		 * The rows this scene drives are the panel's conversations. The FIRST is the
		 * one that gets pinned; the second is the one the pointer reveals.
		 */
		check(
			"the sidebar has conversations to pin",
			start.rows.length >= 2,
			`${start.rows.length} rows: ${JSON.stringify(start.rows.map((row) => row.label))}`,
		);
		check(
			"the pin control is a SIBLING of the conversation button, not inside it",
			start.rows.every(
				(row) =>
					row.parentTag === "div" &&
					row.buttonsInParent === 2 &&
					row.pinSibling === 1,
			),
			JSON.stringify(start.rows.slice(0, 3)),
		);
		check(
			"the pin slot is reserved at rest, so the reveal cannot reflow the row",
			start.pins.every((pin) => pin.width > 0 && pin.height > 0) &&
				start.pins.length === start.rows.length,
			JSON.stringify(start.pins.slice(0, 2)),
		);
		check(
			"nothing is pinned yet: no heading anywhere, and an unpinned control is invisible at rest",
			!start.order.some((line) => String(line).startsWith("Pinned chats")) &&
				start.pins.every(
					(pin) => pin.pressed === "false" && pin.opacity === "0",
				),
			JSON.stringify({
				pinnedHeadings: start.order.filter((line) =>
					String(line).startsWith("Pinned chats"),
				),
				pins: start.pins.map((pin) => `${pin.pressed}/${pin.opacity}`),
			}),
		);
		frames.push(await captureSettled(cdp, `pins-unpinned-${suffix}`));

		/*
		 * THE REVEAL. The pointer goes to the second row's own box, and the control
		 * must become visible WITH THE POINTER STILL THERE - which is the whole
		 * difference between this frame and the one above.
		 */
		const hoverRow = require("the pointer has a second conversation to hover", await rowBox(
			cdp,
			1,
		), "the panel drew fewer than two conversation rows");
		/*
		 * THE POINTER GOES ON THE GLYPH, not on the row (design round 2, D8). Round 1's D3 asked
		 * for the state between hovering the row and pressing: with the pointer parked at the
		 * row's centre the frame showed a revealed control the pointer was nowhere near, and the
		 * claim "the reveal is the pointer's" was therefore not photographed. The pin's own box
		 * is where the pointer has to be to press it, which is the state worth a frame.
		 */
		const hoverTarget = (await readPins(cdp)).pins[1];
		require("the second conversation has a pin to hover", hoverTarget, JSON.stringify(
			(await readPins(cdp)).pins,
		));
		await movePointer(cdp, hoverTarget.x, hoverTarget.y);
		await wait(260);
		const hovered = await readPins(cdp);
		const hoverAtPoint = await cdp.evaluate(`(() => {
			const node = document.elementFromPoint(${Math.round(hoverTarget.x)}, ${Math.round(hoverTarget.y)});
			return {
				tag: node ? node.tagName.toLowerCase() : null,
				pin: !!(node && node.closest && node.closest("[data-session-pin]")),
			};
		})()`);
		check(
			"the pointer is ON the glyph it revealed, not merely on the row (D8)",
			hoverAtPoint.pin === true,
			JSON.stringify({ hoverAtPoint, hoverRow }),
		);
		check(
			"the pointer over an unpinned row reveals ITS pin, and nothing else",
			hovered.pins.length > 1 &&
				hovered.pins[1].opacity === "1" &&
				hovered.pins.filter((pin, index) => index !== 1 && pin.opacity === "1")
					.length === 0,
			JSON.stringify(hovered.pins.map((pin) => pin.opacity)),
		);
		frames.push(await captureSettled(cdp, `pins-hover-${suffix}`));

		/*
		 * THE PRESS. A real button pair at the first row's control, and then the panel
		 * itself: the conversation must move into a `Pinned chats` section whose
		 * heading sits ABOVE the `All chats` row and the sections under it - the
		 * operator's "above Active Chats", read as a position in the panel.
		 */
		const pressRow = await rowBox(cdp, 0);
		const target = await readPins(cdp);
		await pressPointer(cdp, target.pins[0].x, target.pins[0].y);
		const pinned = await waitForPinned(cdp, pressRow.label);
		check(
			"pressing the pin moves the conversation into a Pinned chats section above the rest",
			pinned.worked,
			JSON.stringify(pinned),
		);
		check(
			"the pinned conversation is drawn in the Pinned section, ahead of every other row",
			pinned.rowAt === 0,
			JSON.stringify({ rows: pinned.sidebar.rows.map((row) => row.label) }),
		);
		const pressedPin = pinned.sidebar.pins.find(
			(pin) => pin.pressed === "true",
		);
		if (theme === themes[0] && TUI_PYTHON !== null && TUI_CONFIG !== null) {
			/*
			 * THE OTHER DIRECTION, with the TERMINAL'S OWN reader: the app has just
			 * pinned from this surface, and the store the terminal reads is asked what it
			 * holds. `read_pins` is the function the TUI's sidebar calls, so this is not a
			 * second way of asking - and the ID comes from the backend's own catalogue
			 * rather than from the press, so the assertion is about the state the
			 * backend settled on.
			 */
			const pressed = (await readBackendSessions()).find((row) => row.pinned);
			const storeRead = tuiStoreReading();
			check(
				"a pin made in this app is in the store the terminal reads",
				pressed !== undefined && storeRead.pins.includes(pressed.id),
				JSON.stringify({ pressed, storeRead }),
			);
		}
		{
			/*
			 * THE SEARCH-HIT HALF of the same wire: a hit is asked of the whole store, so
			 * the row a client's page does not list is exactly the row that reaches the
			 * panel through this route. If its pin state were absent, that row would land
			 * under `Previous chats` with an unfilled glyph while the backend held it
			 * pinned - the panel under-reporting its own set.
			 */
			const backendRows = await readBackendSessions();
			const pressedRow = backendRows.find((row) => row.pinned === true);
			require("the pinned conversation is on the backend's wire to search for", pressedRow, JSON.stringify(
				backendRows.map((row) => [row.id, row.pinned]),
			));
			/*
			 * The title's own words, longest first, because the route answers per TOKEN and
			 * this assertion is about the pin state on a hit rather than about which query
			 * the search accepts: the first token that returns anything is the one whose
			 * hits are read.
			 */
			const tokens = String(pressedRow.title ?? "")
				.split(/\s+/)
				.filter((word) => word.length > 3)
				.sort((a, b) => b.length - a.length);
			let search = null;
			let hit = undefined;
			for (const token of tokens) {
				const answer = await readBackendSearch(token);
				if (answer.sessions.length > 0) {
					search = answer;
					hit = answer.sessions.find((row) => row.id === pressedRow.id);
					break;
				}
				if (search === null) search = answer;
			}
			check(
				"a search HIT carries the pin state, so a row outside the client's page is drawn pinned",
				search !== null &&
					search.sessions.length > 0 &&
					search.sessions.every((row) => "pinned" in row) &&
					hit !== undefined &&
					hit.pinned === true,
				JSON.stringify({
					tokens,
					wanted: pressedRow.id,
					answer: search,
				}),
			);
		}
		check(
			"the pinned control reports its state and stays legible at rest",
			pressedPin !== undefined && pressedPin.opacity === "1",
			JSON.stringify(pinned.sidebar.pins),
		);
		check(
			"the pinned glyph is FILLED, so the state reads without hovering",
			pressedPin !== undefined && pressedPin.fill === "currentColor",
			JSON.stringify(pressedPin),
		);
		check(
			"the press asked the BACKEND for the state, and the answer is what is drawn",
			typeof pressedPin?.title === "string" &&
				pressedPin.title.startsWith("Unpin"),
			JSON.stringify(pressedPin),
		);
		frames.push(await captureSettled(cdp, `pins-populated-${suffix}`));

		/*
		 * PINNED AND SELECTED. The pinned row is opened, and the claim is that it is
		 * drawn ONCE - in the Pinned section - carrying `aria-current`. A lift-and-copy
		 * would show it twice here, which is the duplication the partition exists to
		 * prevent.
		 */
		await parkPointer(cdp);
		const selectRow = await rowBox(cdp, 0);
		await pressPointer(cdp, selectRow.x, selectRow.y);
		const selected = await waitForPinned(cdp, selectRow.label);
		const currentRows = selected.sidebar.rows.filter(
			(row) => row.ariaCurrent === "page",
		);
		const copies = selected.sidebar.rows.filter(
			(row) => row.label === selectRow.label,
		);
		check(
			"the pinned row that is also current is drawn exactly once",
			copies.length === 1,
			JSON.stringify(copies),
		);
		check(
			"the current row carries aria-current, and it is the one in the Pinned section",
			currentRows.length === 1 &&
				copyIndex(selected.sidebar.rows, selectRow.label) === selected.rowAt,
			JSON.stringify({
				currentRows,
				rowAt: selected.rowAt,
				headingAt: selected.headingAt,
			}),
		);
		frames.push(await captureSettled(cdp, `pins-selected-${suffix}`));

		/*
		 * THE FILTER. The panel's own search box, typed into through the browser's
		 * input pipeline, with a query that matches the PINNED conversation only: the
		 * Pinned section keeps it, and the other sections empty. A pinned row the
		 * filter excludes is absent - it is not kept "because it is pinned".
		 */
		const search = await verb(
			cdp,
			"press",
			// The panel's field carries an aria-label rather than a `type="search"`:
			// its own accessible name is the stable hook, and the one a reader would
			// use to find it.
			'input[aria-label="Search chats and agents"]',
		);
		check(
			"the search field took the press",
			search.hitTest === true,
			JSON.stringify(search),
		);
		/*
		 * The pointer press is the user's action; the FOCUS it leaves is the browser's.
		 * A synthetic pointer event does not move focus, so the caret is placed on the
		 * field the press hit - named as an exposed action rather than hidden, because
		 * a scene that typed into whatever happened to be focused would be reading its
		 * own accident.
		 */
		const focused = await cdp.evaluate(`(() => {
			const field = document.querySelector('input[aria-label="Search chats and agents"]');
			if (!field) return null;
			field.focus();
			return document.activeElement === field;
		})()`);
		require("the caret is in the search field", focused ===
			true, JSON.stringify(focused));
		/*
		 * The query is the conversation's TITLE as the store holds it, not the row's
		 * rendered text: a row draws a status word ("Recent", "Not sent yet") ahead of
		 * the title, and searching the rendered string asks the panel for a
		 * conversation whose name begins with "Recent".
		 */
		const pinnedTitle = (await readBackendSessions()).find(
			(row) => row.pinned,
		)?.title;
		const wanted = require("the pinned conversation's own title was read out of the backend", pinnedTitle
			? pinParts(pinnedTitle)
			: null, JSON.stringify(await readBackendSessions()));
		await cdp.send("Input.insertText", { text: wanted });
		await wait(600);
		const filtered = await readPins(cdp);
		check(
			"the Pinned section survives a filter that matches only its row",
			filtered.rows.length === 1 && filtered.rows[0].label === selectRow.label,
			JSON.stringify({
				query: wanted,
				rows: filtered.rows.map((row) => row.label),
				order: filtered.order,
			}),
		);
		frames.push(await captureSettled(cdp, `pins-filter-${suffix}`));

		/*
		 * THE FLAT MODE. The design's open question is where the section sits when the
		 * panel is in `All chats` mode, where there is no `Active chats` anchor for it
		 * to be above at all. This frame is what the design round judges that from, so
		 * it is captured rather than argued.
		 */
		const cleared = await clearSearch(cdp);
		check(
			"Escape cleared the query through the panel's own handler",
			cleared,
			JSON.stringify(await readPins(cdp)),
		);
		const allChats = await cdp.evaluate(`(() => {
			const toggle = Array.from(document.querySelectorAll("button[data-chat-row]"))
				.find((row) => row.textContent.replace(/\\s+/g, " ").trim().startsWith("All chats"));
			if (!toggle) return null;
			const box = toggle.getBoundingClientRect();
			return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		})()`);
		check(
			"the All chats toggle is in the panel",
			allChats !== null,
			JSON.stringify(allChats),
		);
		await pressPointer(cdp, allChats.x, allChats.y);
		await wait(300);
		const flat = await waitForPinned(cdp, selectRow.label);
		check(
			"the Pinned chats section is drawn in the flat list too, still above it",
			flat.worked && flat.rowAt === 0,
			JSON.stringify({ order: flat.sidebar.order, rows: flat.sidebar.rows }),
		);
		frames.push(await captureSettled(cdp, `pins-flat-${suffix}`));
		/*
		 * Back to the split view, so the next theme starts where this one did - and
		 * through a FRESH read of the toggle's box, because the row moved as the list
		 * changed and a stale point would press whatever took its place.
		 */
		const back = await cdp.evaluate(`(() => {
			const toggle = Array.from(document.querySelectorAll("button[data-chat-row]"))
				.find((row) => row.textContent.replace(/\\s+/g, " ").trim().startsWith("All chats"));
			if (!toggle) return null;
			const box = toggle.getBoundingClientRect();
			return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		})()`);
		await pressPointer(cdp, back.x, back.y);
		await wait(300);
		const split = await readPins(cdp);
		check(
			"the panel is back in the split view before the next theme",
			split.order.some((line) => String(line).startsWith("Active chats")),
			JSON.stringify({ order: split.order }),
		);

		/*
		 * UNPIN, and restore the panel to the state this theme's first frame showed.
		 * Two reasons, and neither is tidiness: the press is a TOGGLE in the product's
		 * own terms (the terminal's `f10` verb), so the inverse is a real path the
		 * frames would otherwise never exercise; and the next theme's `pins-unpinned`
		 * frame has to be the same state as this one's, or the pair is a picture of
		 * two different panels. The store this touches is this run's own.
		 */
		await parkPointer(cdp);
		const pinnedNow = await readPins(cdp);
		const unpinIndex = pinnedNow.pins.findIndex(
			(pin) => pin.pressed === "true",
		);
		require("the conversation this pass pinned is still pinned", unpinIndex >=
			0, JSON.stringify(pinnedNow.pins));
		await pressPointer(
			cdp,
			pinnedNow.pins[unpinIndex].x,
			pinnedNow.pins[unpinIndex].y,
		);
		await wait(400);
		const unpinned = await readPins(cdp);
		check(
			"pressing the pinned control again unpins, and the section goes with it",
			!unpinned.order.some((line) => String(line).startsWith("Pinned chats")) &&
				unpinned.pins.every((pin) => pin.pressed === "false"),
			JSON.stringify({
				order: unpinned.order,
				pins: unpinned.pins.map((pin) => `${pin.pressed}/${pin.opacity}`),
			}),
		);
	}

	if (TUI_PYTHON !== null && TUI_CONFIG !== null) {
		await crossSurfacePin(cdp);
	} else {
		note(
			"cross-surface pin",
			"not driven: pass --tui-python <interpreter> and --tui-config <the daemon's config root> to have the terminal's own store write a pin and this app show it",
		);
	}

	return frames;
}

/**
 * Clear the panel's query through the app's own Escape, and wait for the list to
 * come back — rather than reaching into the input's value, which would leave the
 * panel in a state no keystroke produced.
 */
async function clearSearch(cdp, timeoutMs = 5_000) {
	await pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
	const started = Date.now();
	for (;;) {
		const now = await readPins(cdp);
		if (now.rows.length > 1) return true;
		if (Date.now() - started > timeoutMs) return false;
		await wait(100);
	}
}

/** The index of a conversation row by its label, or -1. */
function copyIndex(rows, label) {
	return rows.findIndex((row) => row.label === label);
}

/**
 * A query that matches exactly one conversation: the first few words of its label.
 *
 * Read off the row rather than hard-coded, because the catalogue is the backend's
 * and this scene must work against whatever it seeded. Three words is enough to
 * separate a seeded conversation from its neighbours and short enough that the
 * panel's own 256-character bound is never in play.
 */
function pinParts(label) {
	return label
		.replace(/[^\p{L}\p{N} ]+/gu, " ")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 3)
		.join(" ");
}

/**
 * What the terminal's own store holds, read through the terminal's own module.
 *
 * `read_pins` is the function the TUI's sidebar calls on every refresh, run in a
 * real interpreter against the daemon's config root — the same file the desktop's
 * `pinned` flag is projected from. A failure to run it is reported rather than
 * swallowed: a store that cannot be read is not the same finding as a pin that is
 * not there.
 */
function tuiStoreReading() {
	const script = [
		"import json,sys",
		"from local_operator.tui.sidebar_pins import read_pins",
		"print(json.dumps({'pins': list(read_pins(sys.argv[1]))}))",
	].join("\n");
	const env = pythonChildEnv({});
	const read = spawnSync(TUI_PYTHON, ["-c", script, TUI_CONFIG], {
		encoding: "utf8",
		env,
	});
	if (read.status !== 0) {
		throw new Error(
			`the terminal's store could not be read: ${JSON.stringify({ status: read.status, stderr: read.stderr })}`,
		);
	}
	return JSON.parse(read.stdout);
}

/**
 * THE OTHER SURFACE'S HALF: a pin written by the terminal's own store.
 *
 * `toggle_pin` is the function the terminal's `f10` calls (`action_toggle_pin`
 * hands it to a thread), and the config root is the daemon's own — the same file
 * this app's `pinned` flag is projected from. So this is not a second way of
 * writing a pin; it is the other surface's way.
 *
 * What is measured is the LATENCY the operator would feel: how long after that
 * write the app's sidebar shows the conversation, with nobody touching the window
 * (no refetch, no focus, no reload). The bound the design states is ~1.5 s — the
 * feed's 1 Hz catalogue probe plus one client fetch, with the 30 s safety poll as
 * the drift insurance behind it — and the measurement is printed rather than
 * asserted at a threshold, because a loaded machine is not a regression.
 */
async function crossSurfacePin(cdp) {
	// Back to the theme this scene's first frames were taken in, so the frame this
	// step writes is a picture of the same panel state at the same theme - and so
	// its name is true.
	await verb(cdp, "setTheme", "localOperatorDark");
	const before = await readPins(cdp);
	/*
	 * The conversation the TERMINAL will pin: a real catalogue row that is not the
	 * one this app just pinned, so what the frame shows is a pin this run did not
	 * make from this surface. Its id and its title come from the backend, and the
	 * DOM row is then identified by matching the title — a row's rendered text
	 * carries a status word ahead of the title, so the two are not the same string.
	 */
	const catalogue = await readBackendSessions();
	const chosen = catalogue.find((row) => !row.pinned);
	require("the backend has an unpinned conversation for the terminal's own store to pin", chosen, JSON.stringify(
		catalogue,
	));
	require("that conversation is drawn in this panel", before.rows.some((row) =>
		row.label.includes(chosen.title),
	), JSON.stringify({
		title: chosen.title,
		rows: before.rows.map((row) => row.label),
	}));
	const script = [
		"import json,sys",
		"from local_operator.tui.sidebar_pins import read_pins, toggle_pin",
		"root = sys.argv[1]",
		"session_id = sys.argv[2]",
		"toggle_pin(root, session_id)",
		"print(json.dumps({'pins': read_pins(root)}))",
	].join("\n");
	const wrote = spawnSync(TUI_PYTHON, ["-c", script, TUI_CONFIG, chosen.id], {
		encoding: "utf8",
		env: pythonChildEnv({}),
	});
	check(
		"the terminal's own store wrote the pin",
		wrote.status === 0,
		JSON.stringify({
			status: wrote.status,
			stdout: wrote.stdout,
			stderr: wrote.stderr,
		}),
	);
	note("tui store after its own f10 write", (wrote.stdout ?? "").trim());

	/*
	 * Whether the app's own feed is connected, read from the panel's own sentence
	 * rather than inferred: the sidebar says "Not connected to the backend — showing
	 * the last known state." exactly when the feed is expected and is not there
	 * (`chat-sidebar.tsx`), and a run whose doorbell is silent because nothing is
	 * subscribed is a different finding from a doorbell that rang and was ignored.
	 */
	const feedOffline = await cdp.evaluate(
		'document.body.innerText.includes("Not connected to the backend")',
	);
	note(
		"app feed state before the terminal's write",
		feedOffline
			? "the panel says it is not connected to the backend, so the doorbell has no subscriber"
			: "the panel is connected to the backend",
	);

	const started = Date.now();
	let shown = null;
	for (;;) {
		const now = await readPins(cdp);
		const headingAt = now.order.findIndex((line) =>
			String(line).startsWith("Pinned chats"),
		);
		const rowAt = now.rows.findIndex((row) => row.label.includes(chosen.title));
		if (headingAt >= 0 && rowAt >= 0) {
			shown = now;
			break;
		}
		// Past the panel's own 30 s safety poll, so a run that never reproduces the
		// doorbell still reports the bound the poll gives instead of nothing.
		if (Date.now() - started > 40_000) break;
		await wait(100);
	}
	const latencyMs = Date.now() - started;
	check(
		"a pin written by the terminal appears in this app without a manual refresh",
		shown !== null,
		JSON.stringify({
			waited: latencyMs,
			rows: (shown ?? (await readPins(cdp))).rows.map((row) => row.label),
		}),
	);
	say(
		`  [pins] terminal pin -> this app's sidebar: ${latencyMs}ms (the design's bound with the feed connected: ~1.5s; the panel's own safety poll is 30s)`,
	);
	const after = await captureSettled(cdp, "pins-from-tui-dark");
	note("frame", JSON.stringify(after));
}

/**
 * The catalogue as the BACKEND holds it: id, title, and the pin flag.
 *
 * Read from the daemon's own route rather than from the DOM, because two things
 * this scene needs are not in the DOM: a session ID (which the terminal's store
 * takes) and a title free of the row's own status word. The client's persisted
 * store is not an option, and the reason is worth writing down: it persists drafts
 * and the active session, NOT the catalogue, so `localStorage` answers with no rows
 * at all — a scene that read it would report a live store as empty.
 */
/**
 * Pin or unpin through the daemon's own route, for the states a FRAME needs rather
 * than for the interactions under test: a scrolled frame showing a pinned set larger
 * than the panel's window is a picture of the app rendering the backend's state, and
 * seeding it this way keeps the scene's two real presses - the pointer case and the
 * keyboard case - the only interactions it has to make land.
 */
async function setBackendPin(sessionId, pinned) {
	const response = await fetch(
		`${BACKEND}/v1/desktop/sessions/${sessionId}/pin`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
			},
			body: JSON.stringify({ pinned: pinned }),
		},
	);
	if (!response.ok) {
		throw new Error(
			`the daemon refused a pin write: ${response.status} ${await response.text()}`,
		);
	}
	return response.json();
}

/**
 * The SEARCH answer, which is a different read of the same store: a hit is asked of the
 * whole store, so a pinned conversation the client's page does not list arrives here and
 * nowhere else. `pinned` on a hit is what lets the panel draw that row in the right
 * section instead of under `Previous chats` with an unfilled glyph (backend
 * `cffdedfbd` carries it on every row; the client still hides the affordance on a hit
 * that does not describe it, rather than offering a press that cannot be repaired).
 */
async function readBackendSearch(query) {
	const response = await fetch(
		`${BACKEND}/v1/desktop/sessions/search?q=${encodeURIComponent(query)}&limit=10`,
		{
			headers: {
				authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
			},
		},
	);
	if (!response.ok) {
		throw new Error(
			`the daemon refused a search: ${response.status} ${await response.text()}`,
		);
	}
	const body = await response.json();
	return body.result ?? body;
}

async function readBackendSessions(limit = 50) {
	const response = await fetch(
		`${BACKEND}/v1/desktop/sessions?limit=${limit}`,
		{
			headers: {
				authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
			},
		},
	);
	const body = await response.json();
	const rows = body?.result?.sessions ?? body?.sessions ?? [];
	return rows.map((row) => ({
		id: row.id,
		title: String(row.name ?? ""),
		pinned: row.pinned === true,
	}));
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
	const beforeEnter = await readSettingField(cdp, "model_name");
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
	const typedRowFrame = await captureSettled(cdp, "settings-model-typed-row");

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
			if (SCENE === "pins-scroll" && BACKEND === null) {
				throw new Error(
					"--scene pins-scroll needs --backend: a panel with no catalogue has no row to pin",
				);
			}
			if (
				SCENE === "pins-search" &&
				(TUI_PYTHON === null || TUI_CONFIG === null)
			) {
				throw new Error(
					"--scene pins-search needs --tui-python and --tui-config: the third surface it asserts is the store the terminal reads",
				);
			}
			if (SCENE === "pins" && (TUI_PYTHON === null) !== (TUI_CONFIG === null)) {
				throw new Error(
					"--scene pins takes --tui-python and --tui-config together: the terminal's store and the config root the daemon serves are one measurement, and half of it would look like it ran",
				);
			}
			if (SCENE === "states") await sceneStates(cdp);
			else if (SCENE === "new-chat") await sceneNewChat(cdp);
			else if (SCENE === "settings-model") await sceneSettingsModel(cdp);
			else if (SCENE === "settings-fields") await sceneSettingsFields(cdp);
			else if (SCENE === "palette") await scenePalette(cdp);
			else if (SCENE === "browser-pane") await sceneBrowserPane(cdp);
			else if (SCENE === "pins") await scenePins(cdp);
			else if (SCENE === "pins-scroll") await scenePinsScrolled(cdp);
			else if (SCENE === "pins-search") await scenePinsSearch(cdp);
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
