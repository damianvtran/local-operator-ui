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
 *   --scene <states|new-chat|first-send|sidebar-sections|question-dock|authoring-refresh|radient-issue|settings-model|settings-fields|settings-gate|palette|browser-pane|approval-badges|mentions|canvas-freshness|pins|pins-scroll|pins-search|none>
 *                          which built-in scene to run (default: states)
 *   --gate-state <label>   (with --scene settings-gate) what this run's backend
 *                          state is called in the frames and the log, so two
 *                          runs against two backends can be told apart
 *   --authoring-expect <refresh|stale>  (with --scene authoring-refresh) which
 *                          claim this run is in: `refresh` against a backend
 *                          whose feed publishes `authoring` frames, `stale`
 *                          against one that publishes none (the base-commit
 *                          runtime), where the row must stay off screen until
 *                          the app is remounted
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
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
/*
 * Every python this harness starts is handed an environment it has decided about,
 * never `process.env`: an inherited `PYTHONPYCACHEPREFIX` wrote 19 `.pyc` into the
 * operator's installed app once (see `python-child-env.mjs`), and
 * `scripts/python-bytecode-cache.test.mjs` enumerates the sites that may start an
 * interpreter, so a new one has to say so there as well as here.
 */
import { pythonChildEnv } from "./python-child-env.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

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
 * THE STUB'S OWN REQUEST LOG, when one is given. The U6 press clause asserts against what the
 * DAEMON SAW rather than against the DOM, because in this fixture the DOM cannot answer the
 * question: an unpin moves the row into a section the scene does not render, so "gone from the
 * list" is not evidence of an archive, and re-pressing the same coordinates lands on whatever now
 * occupies that position. The write is the sound source - it is what settled U6 in pass 15.
 */
const STUB_LOG = argValue("--stub-log", null);
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
/*
 * A suffix on every frame's file name, for a scene that is run twice against two
 * backends (`session-archive`'s withdrawn pair: the same app against a daemon
 * that advertises the capability and one that has never heard of it).
 */
const RUN_LABEL = argValue("--run-label", "");
/*
 * The withdrawn half of the fail-closed pair: the same scene against a daemon
 * that has never heard of archiving (`stub-daemon.mjs --no-archive`). Every
 * assertion below inverts, and the frames are byte-compared against the capable
 * run's - which is what makes "the panel is the panel it was" a measurement
 * rather than a promise.
 */
const WITHDRAWN = process.argv.includes("--capability-withdrawn");
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
 * The paged-catalogue evidence set (`docs/evidence/sidebar-lazy-chats`).
 *
 * `--scoped-case` names which of the stand-in's four arms this run is
 * photographing; `LAZY_CATALOGUE_HEAD_PAGE` and `LAZY_GROUP_PAGE` MIRROR the
 * app's own `CATALOGUE_HEAD_PAGE` and `CATALOGUE_GROUP_PAGE`
 * (`canonical-sessions-store.ts`) because the driver is plain JS and cannot import
 * them. They are not a second authority: every assertion that uses them is a
 * NUMBER the store's own row count has to match, so a drift in either direction
 * fails the run rather than moving the goalposts with it.
 */
const LAZY_CASE = argValue("--scoped-case", "paged");
/*
 * THE HOLD FILE the `loading` arm releases (round 2, D12). The stand-in holds every
 * scoped answer while this file is absent, so the arm photographs a wait that is
 * really in flight and then RELEASES it - no wall-clock window to hit.
 */
const LAZY_HOLD = argValue("--scope-hold", null);
/**
 * The two regexes this scene matches sentences with, at TOP LEVEL because the repository's
 * lint rule says a regex literal inside a function is a per-call allocation (`biome`
 * `useTopLevelRegex`), and this file is a long-running rig.
 */
const LAZY_ARCHIVED_SENTENCE = /archived/;
const LAZY_NOT_A_WAIT_OR_EMPTINESS = /Loading chats…|No chats yet/;
/** The theme the one light-theme frame is taken in (UX round 2: the set was dark-only). */
const LAZY_LIGHT_THEME = "localOperatorLight";
const LAZY_THEME = THEME ?? "localOperatorDark";
const LAZY_GROUP = "lopdev";
/** The stand-in's `lopdev` population at `--catalogue 120`. */
const LAZY_GROUP_TOTAL = 70;
const LAZY_CATALOGUE_TOTAL = 120;
const LAZY_CATALOGUE_HEAD_PAGE = 50;
const LAZY_GROUP_PAGE = 25;
/** Long enough for the panel's own paint, short enough to stay an evidence run. */
const LAZY_SETTLE_MS = 1800;
/*
 * The title the search-only scene looks for, and it is a flag because the seeder owns the
 * order: `--generate N` writes its mtimes in sequence, so the oldest titles are the ones the
 * catalogue page drops. Defaulted to the first of that numbering.
 */
const SEARCH_TITLE = argValue("--search-title", "Sweep 001");
const TUI_CONFIG = argValue("--tui-config", null);
/**
 * What `--scene authoring-refresh` expects the sidebar's authoring lists to do.
 *
 * `refresh` (the default) is the fixed behaviour, against a backend whose feed
 * publishes `authoring` frames: the row arrives with nobody touching the app.
 * `stale` is the same app, script and write against a backend that publishes no
 * such frame - the base-commit runtime - and the claim is the defect: the row
 * stays off screen until the app is remounted. Neither reading says anything on
 * its own; the pair is what makes the refresh attributable to the frame rather
 * than to a mount, a poll or a stray re-render.
 *
 * A value the scene does not know is refused rather than defaulted, because a
 * typo here would silently run the OTHER half and read as the answer to the
 * question it does not ask.
 */
const AUTHORING_EXPECT = argValue("--authoring-expect", "refresh");
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

/**
 * How old an ABANDONED scratch tree has to be before this run reaps it.
 *
 * Deliberately far longer than any scene lasts (the longest measured run is minutes),
 * because the age is the second of two guards and the cheap one has to be the pid: a
 * tree that is dead by pid but younger than this is left alone, so a run that is merely
 * between its own `mkdir` and its pid being observable - or one whose pid number has
 * been reused by something unrelated - cannot be swept out from under it.
 */
const REAP_AFTER_MS = 30 * 60 * 1000;

/** Whether a pid exists. `EPERM` means it exists and belongs to somebody else. */
function pidIsAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

/**
 * Reap the scratch trees previous runs left in the shared temp directory.
 *
 * WHY THE DRIVER DOES THIS AND NOT SOMETHING ELSE. `--clean` is opt-out, so a run that
 * does not pass it keeps its tree by design (the frames and the app log live there); a
 * run that is killed, or that crashes, keeps one without having chosen to. Measured on
 * this machine on 2026-09-24: **244** `lo-renderer-driver-*` trees, 2-4 MB each, roughly
 * 700 MB of the shared temp directory, with free space down to ~3 GiB and builds in
 * neighbouring sessions failing on it. The driver is what made them, so the driver is
 * what clears them - and it does it at START, before it adds one more.
 *
 * A LIVE PID IS NEVER TOUCHED, and neither is a young tree. That is the whole safety
 * argument, and both halves are needed: this fleet runs ~25 sessions at once, where two
 * driver runs overlapping is ordinary (so a name-only sweep would delete a peer's live
 * tree mid-scene), and a dead pid number can be reused (so liveness alone, checked once,
 * is not enough of a guard without the age).
 *
 * Unparseable names are left alone as well: `lo-renderer-driver-<pid>` is what this
 * script makes, and a directory that merely looks like one is not this script's to
 * delete.
 *
 * It reports what it removed - names, as a count and in full - for the reason this
 * harness prints every path it redirects: a tool that tidies silently cannot be told
 * apart from one that deletes the wrong thing.
 */
function reapAbandonedScratchTrees(root = tmpdir()) {
	const removed = [];
	let seen = 0;
	let live = 0;
	let young = 0;
	for (const name of readdirSync(root)) {
		if (!name.startsWith("lo-renderer-driver-") || name === SCRATCH_TAG)
			continue;
		const pid = Number(name.slice("lo-renderer-driver-".length));
		if (!Number.isInteger(pid) || pid <= 0) continue;
		seen++;
		if (pidIsAlive(pid)) {
			live++;
			continue;
		}
		const path = join(root, name);
		let stats = null;
		try {
			stats = statSync(path);
		} catch {
			// Gone between the listing and the stat: nothing to do, and not an error.
			continue;
		}
		if (Date.now() - stats.mtimeMs < REAP_AFTER_MS) {
			young++;
			continue;
		}
		try {
			rmSync(path, { recursive: true, force: true });
			removed.push(name);
		} catch {
			// A tree that refuses to go (a permission quirk, a file still being written)
			// is left for the next run rather than failing this one: the sweep is hygiene,
			// not a precondition.
		}
	}
	return { seen, live, young, removed };
}

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
	 *
	 * `withTelemetryOff` beside it, for the same class of defect one project over:
	 * this rig boots the real app on a scratch profile, the build it boots carries
	 * the live PostHog project key, and the renderer's own configuration is inlined
	 * at build time — so nothing about the scratch tree could stop the run being
	 * counted as a user and recorded as a session replay. See `telemetry-off.mjs`.
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
	withTelemetryOff(env);
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
			/*
			 * The app is CHROMIUM, and this run redirects `HOME`: without this switch
			 * OSCrypt finds no login keychain under the scratch home and asks macOS to
			 * CREATE one, which is a dialog on the operator's screen once per boot - the
			 * same failure `chrome-keychain.mjs` exists to prevent for the Chrome rigs,
			 * and the spelling is taken from that module rather than retyped (its own
			 * scan asserts the literal appears there and nowhere else).
			 *
			 * What it does NOT cover, and must not: a run whose SUBJECT is `safeStorage`
			 * - the vault key round-tripping through Keychain Services is the thing being
			 * proven there, so reaching the keychain is the point rather than collateral.
			 * Those are named in `chrome-keychain.mjs`, and this harness does not drive
			 * them: every scene here is about the rendered surface.
			 */
			MOCK_KEYCHAIN_SWITCH,
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

/*
 * ---- the palette a frame's NAME claims ---------------------------------------
 *
 * WHY THIS IS HERE AND NOT IN THE SCENES (design round 2, D20; the same class as
 * round 1's D4). Round 2 found six frames named `-dark` rendering the light
 * palette, a `-light` frame rendering the dark one, and a "both palettes" pair
 * that was one palette photographed twice. The mechanism is identical both
 * rounds: a scene arranges the palette once per section and then captures
 * several frames, so every frame after a theme change is shot in the palette the
 * scene happened to be in rather than the one its name claims - and two of these
 * were branch-dependent, so whether the set was right depended on which branch a
 * run took. A scene-level correction holds until the next scene edits; the claim
 * belongs to the frame's name, so the check lives at the capture every frame
 * goes through.
 *
 * TWO READS, BECAUSE EACH CAN BE RIGHT WHILE THE OTHER IS WRONG. The DOM read
 * (`data-theme` plus the painted `--lo-canvas`) says which palette the renderer
 * is compositing; the PIXEL read says which palette reached the file a reviewer
 * is handed. A theme the renderer took but did not paint, and a capture served
 * from a stale frame, each satisfy one read and not the other - and the pixel
 * read is the one that catches the failure this whole mechanism exists for.
 *
 * IT DOES NOT SELF-CORRECT, deliberately. Setting the theme from the label here
 * is two lines and would make every frame true; it would also make this a check
 * that cannot fail, which is the shape that let D4 and then D20 reach a reviewer
 * while the runs reported clean. The scene is told its arrangement contradicts
 * its name, at the frame, in the run, and fixes it there.
 *
 * THE SUFFIX IS THE CLAIM, which is this rig's convention across every scene
 * (`sections-default-dark`, `strip-mark-light`). A name claiming no palette is a
 * frame about a state, and there is nothing here to hold it to.
 */
const FRAME_PALETTE = {
	dark: "localOperatorDark",
	light: "localOperatorLight",
};
/*
 * The GENERATED stylesheet, read rather than a palette written down here: a
 * literal would be a second copy of the brand palettes that the next token change
 * moves out from under, and this check would then fail on a correct frame. The
 * generated file is the palettes' own artifact (`pnpm check-themes` keeps it in
 * step with the registry), so the expectation moves with the thing it checks.
 */
const PALETTE_CSS = new URL(
	"../src/renderer/src/styles/themes.generated.css",
	import.meta.url,
);

/** The palette a frame's NAME claims, or `null` for a name that claims none. */
function claimedPalette(label) {
	const match = /-(dark|light)$/.exec(label);
	return match === null ? null : match[1];
}

/** Rec. 709 luminance of an `#rrggbb`, 0-255. */
function srgbLuma(hex) {
	const value = Number.parseInt(hex.slice(1), 16);
	return (
		0.2126 * ((value >> 16) & 0xff) +
		0.7152 * ((value >> 8) & 0xff) +
		0.0722 * (value & 0xff)
	);
}

/** Both palettes' own `--lo-canvas`, as `{ hex, luma }` each, or `null`. */
function brandCanvas() {
	const css = readFileSync(PALETTE_CSS, "utf8");
	const out = {};
	for (const [palette, theme] of Object.entries(FRAME_PALETTE)) {
		const block = new RegExp(
			`\\[data-theme="${theme}"\\][^{]*\\{([\\s\\S]*?)\\n\\}`,
		).exec(css);
		const hex =
			block === null ? null : /--lo-canvas:\s*(#[0-9a-f]{6})\b/i.exec(block[1]);
		if (hex === null) return null;
		out[palette] = { hex: hex[1].toLowerCase(), luma: srgbLuma(hex[1]) };
	}
	return out;
}

/**
 * The mean luminance of a captured frame, sampled across the whole picture.
 *
 * A MEAN RATHER THAN ONE PIXEL, because a single coordinate is a claim about the
 * layout (something must be there) while the mean is a claim about the palette
 * (nothing in a dark-palette screen can average light: the grounds cover most of
 * it and ink is thin). Measured across the mislabelled set that bought this
 * check: the six wrong `-dark` frames average 236.9-237.5 where the correct ones
 * average 34.5-36.7, so the two populations are ~200 apart and the midpoint test
 * below has ~100 of margin either side.
 *
 * `null` when `sharp` cannot be loaded. The pixel half is the stronger read, but
 * the DOM half already discriminates this class (in D20's own frames the store
 * said light while the name said dark), and a rig that cannot start without an
 * optional dev dependency is worse than one that says which half it could not
 * run.
 */
async function frameMeanLuma(file) {
	let sharp;
	try {
		({ default: sharp } = await import("sharp"));
	} catch {
		return null;
	}
	const { data, info } = await sharp(file)
		.raw()
		.toBuffer({ resolveWithObject: true });
	const channels = info.channels;
	let sum = 0;
	let sampled = 0;
	/* Every 7th pixel: 394k samples of a 2760x1800 frame, which is 200x more than
	 * the ~200-luma gap needs and keeps the decode off the run's critical path. */
	for (let at = 0; at < data.length; at += channels * 7) {
		sum += 0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2];
		sampled += 1;
	}
	return sum / sampled;
}

/**
 * Hold one captured frame to the palette its NAME claims, and say which half
 * failed when it does not. Called by `capture()` and by the three capturing
 * helpers on the frame they KEEP, so a `captureSettled` retry does not assert
 * eight times over.
 */
async function assertFramePalette(cdp, frame, palette) {
	const canvas = brandCanvas();
	const painted = await cdp.evaluate(`(() => {
		const root = document.documentElement;
		return {
			theme: root.getAttribute("data-theme"),
			canvas: getComputedStyle(root).getPropertyValue("--lo-canvas").trim(),
		};
	})()`);
	const mean = await frameMeanLuma(frame.path);
	const own = canvas === null ? null : canvas[palette];
	const other =
		canvas === null ? null : canvas[palette === "dark" ? "light" : "dark"];
	const domOk =
		own !== null &&
		painted.theme === FRAME_PALETTE[palette] &&
		painted.canvas.toLowerCase() === own.hex;
	/* Closer to its own palette's ground than to the other's: the midpoint test,
	 * with the palettes supplying the numbers rather than a constant here. */
	const pixelOk =
		own !== null && mean !== null
			? Math.abs(mean - own.luma) < Math.abs(mean - other.luma)
			: null;
	const ok = domOk && pixelOk !== false;
	return check(
		`${frame.label} draws the ${palette} palette its name claims`,
		ok,
		[
			domOk
				? null
				: `DOM: data-theme=${painted.theme} --lo-canvas=${painted.canvas || "(unreadable)"}, expected ${FRAME_PALETTE[palette]} / ${own?.hex ?? "(palette unreadable)"}`,
			pixelOk === false
				? `PIXELS: the frame averages luma ${mean.toFixed(1)}, nearer the ${palette === "dark" ? "light" : "dark"} palette's ground (${other.luma.toFixed(1)}) than its own (${own.luma.toFixed(1)})`
				: null,
			mean === null
				? "PIXELS: sharp is unavailable, so only the DOM half ran"
				: null,
		]
			.filter(Boolean)
			.join("; ") || undefined,
		pixelOk === null
			? `DOM ${painted.theme} ${painted.canvas}; pixels unavailable`
			: `DOM ${painted.theme} ${painted.canvas}; mean luma ${mean.toFixed(1)} vs ${own.luma.toFixed(1)} own / ${other.luma.toFixed(1)} other`,
	);
}

/** Capture a frame through the app's own `capturePage()`. */
async function capture(cdp, label, { assertPalette = true } = {}) {
	const frame = await cdp.evaluate(
		`window.__loDevDriver.capture(${JSON.stringify(label)})`,
	);
	const palette = claimedPalette(label);
	if (palette !== null && assertPalette)
		await assertFramePalette(cdp, frame, palette);
	return frame;
}

/**
 * The selector sonner renders its toasts into (`themed-toast-container.tsx`).
 * Pinned as a constant because a boot assertion and a scene check both read it.
 */
const TOAST_SELECTOR = "[data-sonner-toast]";

/**
 * The PANEL'S OWN toast lane (design D11 of `docs/design/sidebar-row-space.md`).
 *
 * Two things make this selector precise, and both are needed. Sonner marks the
 * container's position on the element it renders toasts into, and the panel's lane
 * declares `bottom-left` - but the GLOBAL container also renders an `<ol>` for that
 * position, because every mounted Toaster keeps a copy of every toast (measured; the
 * app's stylesheet is what narrows that to the toast the reader sees). So the lane is
 * addressed through the panel's own landmark rather than by position alone.
 */
const SIDEBAR_TOAST =
	'nav[aria-label="Chats"] [data-sonner-toaster] [data-sonner-toast].lo-archive-toast';

/**
 * The fixture row the stub REFUSES to write: a conversation a running session holds
 * (`live_claim` in the stub, which quotes the route's own sentence).
 *
 * Named once because three scenes assert about it - the refusal's own frame, the retry
 * that re-asserts it, and the undo whose refusal is R2-1's - and an id written three times
 * is an id that can drift from the fixture it names.
 */
const REFUSED_ID = "7c1b0f2a4d31";

/**
 * The fixture row whose UNARCHIVE is refused once (`refuse_unarchive_once` in the stub).
 *
 * Its archive is accepted, so it is the row whose offer can be pressed into a refusal -
 * the lane's Undo path, which is where agent review round 2's R2-1 lived.
 */
const REFUSED_UNDO_ID = "b3f1a09c7d52";

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
 * Which ROW BOXES paint a ground right now, and which row the pointer is on.
 *
 * The question is asked of the browser's own computed style rather than of the
 * class list, and that distinction is the whole of design round 3's D18: the first
 * attempt at this fix put `group-hover:bg-row-hover` on the element that CARRIES
 * `group`, which Tailwind compiles to a DESCENDANT rule (`:is(:where(.group):hover
 * *)`), so the class was in the source, every static assertion was green, and the
 * box painted nothing. A computed-style read evaluates the compiled selector.
 *
 * `painted` is the discriminating half: a check that the hovered row has a ground
 * would pass for the BUTTON's own `hover:bg-row-hover` (`rowStyle`), which is what
 * the 56px-short measurement was. What is asked here is which ELEMENTS paint one.
 */
/**
 * WHAT THE APP SAYS ABOUT ONE ROW, immediately before something presses it.
 *
 * WHY THIS EXISTS (manager's bounded comparison, 2026-09-21). Two presses of the SAME kind of
 * control behave differently in one run: the refusal step presses its row's archive control and
 * a 409 comes back, while the refused-unarchive walk presses its row's archive control and
 * nothing happens - no offer, no write, no failure, `rowLabel: null`. The pointer hypothesis
 * died (a stationary press behaves identically to a moving one), so the difference has to be
 * read off the two rows' own states rather than reasoned about from the source. This samples
 * both sides of the press: the DOM's own fields for the row and its control, and the store's
 * archive faces. It is a READING, not a check - it asserts nothing, so it cannot make a scene
 * pass.
 */
async function rowForensics(cdp, sessionId) {
	const dom = await cdp.evaluate(`(() => {
		const row = document.querySelector('[data-session-row="${sessionId}"]');
		if (!row) return { row: false };
		const control = row.querySelector("[data-session-archive]");
		const attrs = (el) => {
			const out = {};
			for (const a of el.attributes)
				if (a.name.startsWith("data-") || a.name.startsWith("aria-"))
					out[a.name] =
						a.value.length > 48 ? a.value.slice(0, 48) + "..." : a.value;
			return out;
		};
		const box = control ? control.getBoundingClientRect() : null;
		return {
			row: true,
			rowAttrs: attrs(row),
			control: control
				? {
						label: (control.textContent || "").trim().slice(0, 32),
						aria: control.getAttribute("aria-label"),
						box: { w: Math.round(box.width), h: Math.round(box.height) },
						attrs: attrs(control),
						disabled: control.disabled === true,
					}
				: null,
		};
	})()`);
	const state = await verb(cdp, "state").catch(() => null);
	return {
		sessionId,
		dom,
		store: state
			? {
					activeSessionId: state.activeSessionId ?? null,
					sessionCount: state.sessionCount ?? null,
					archiveAttempts: state.archiveAttempts ?? null,
					archiveFailure: state.archiveFailure ?? null,
				}
			: null,
	};
}

async function readRowGrounds(cdp) {
	return cdp.evaluate(`(() => {
		const rows = [...document.querySelectorAll("[data-session-row]")];
		return {
			rows: rows.length,
			painted: rows
				.map((el) => ({
					id: el.getAttribute("data-session-row"),
					width: Math.round(el.getBoundingClientRect().width),
					background: getComputedStyle(el).backgroundColor,
				}))
				.filter((row) => row.background !== "rgba(0, 0, 0, 0)"),
		};
	})()`);
}

/**
 * Whether a selector is DRAWN right now (a non-zero box), without throwing.
 *
 * The distinction `drawn` makes inside the pair scene, lifted here because a second
 * scene needs it: an element swapped out through `display` is still in the document,
 * so asking whether it exists answers a different question than asking whether it
 * is on screen.
 */
async function drawnSelector(cdp, selector) {
	try {
		const box = await verb(cdp, "measure", { selector, timeoutMs: 400 });
		return box.rect.width > 0 && box.rect.height > 0;
	} catch {
		return false;
	}
}

/**
 * Wait for a selector that was on screen to go, which is how the archive OFFER is
 * read: it is a toast in the panel's own lane (design D11 of
 * `docs/design/sidebar-row-space.md`), and what has to be waited for - rather than
 * sampled - is that it RETIRES.
 *
 * The same shape as `waitForNoToasts` and for the same reason: the property under
 * test is that the observer outlives the answers that mention the conversation, so
 * "it is gone" has to be waited for rather than sampled.
 */
async function waitForGone(cdp, selector, timeoutMs = 15_000) {
	const started = Date.now();
	for (;;) {
		const drawn = await drawnSelector(cdp, selector).catch(() => false);
		const waitedMs = Date.now() - started;
		if (!drawn) return { waitedMs, timedOut: false };
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
		/*
		 * The palette is asserted BELOW, on the frame this helper KEEPS rather than on
		 * each attempt: a retry is the same screen captured again, so eight identical
		 * PASS lines would bury the reading that matters without adding one.
		 */
		frame = await capture(cdp, label, { assertPalette: false });
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
			return await assertKeptFrame(cdp, {
				...frame,
				attempts: attempt,
				stable: true,
				toastFree,
				toastWaitMs,
			});
		}
		previous = bytes;
		await wait(gapMs);
	}
	return await assertKeptFrame(cdp, {
		...frame,
		attempts,
		stable: false,
		toastFree: false,
		toastWaitMs,
	});
}

/**
 * Assert the claimed palette on a frame a capturing helper is about to RETURN,
 * and hand the same frame back so the helper reads as one expression.
 */
async function assertKeptFrame(cdp, frame) {
	const palette = claimedPalette(frame.label);
	if (palette !== null) await assertFramePalette(cdp, frame, palette);
	return frame;
}

/**
 * Capture a frame WITH the app's own toast on it - the opposite of what
 * `captureSettled` is for, and deliberate.
 *
 * WHY THIS EXISTS (UX round 1, U1). A close that could not save the reader's words
 * now says so, so the frame that shows the fix has to be a frame the toast is ON.
 * `captureSettled` waits for toasts to clear and throws away any frame that catches
 * one, which is the right rule everywhere else and would photograph this screen a
 * few seconds after the message had gone. Two consecutive identical captures prove
 * the frame held still (sonner animates a toast in), and the toast's own text is
 * read alongside each capture so the frame and the sentence are known to belong to
 * each other. `stable: false, toastText: null` means there was no toast to
 * photograph, which is a failure of the scene rather than of the run.
 */
async function captureWithToast(
	cdp,
	label,
	{ attempts = 10, gapMs = 200 } = {},
) {
	let previous = null;
	let frame = null;
	let text = null;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const captured = await capture(cdp, label, { assertPalette: false });
		const shown = await toastText(cdp).catch(() => null);
		if (shown === null)
			return await assertKeptFrame(cdp, {
				...captured,
				attempts: attempt,
				stable: false,
				toastText: null,
			});
		frame = captured;
		text = shown;
		const bytes = readFileSync(captured.path);
		if (previous?.equals(bytes))
			return await assertKeptFrame(cdp, {
				...captured,
				attempts: attempt,
				stable: true,
				toastText: text,
			});
		previous = bytes;
		await wait(gapMs);
	}
	return await assertKeptFrame(cdp, {
		...frame,
		attempts,
		stable: false,
		toastText: text,
	});
}

/**
 * TWO screenshots of the same toast, back to back, and whether they match.
 *
 * BOUNDED ON PURPOSE. `captureWithToast` retries until two of its captures agree
 * (up to ten, 200ms apart), which is the right shape for a frame that only has to
 * be one the app held still for - and the wrong one for a frame OF A TRANSIENT THAT
 * HAS A DURATION. Measured under fleet load on 2026-09-21: the retry loop outlived
 * the archive offer's own 8s, and because every attempt REWRITES the same file, the
 * frame that survived was the toast-free one; the scene then timed out looking for
 * the Undo. This takes exactly two shots with nothing between them but a read, so
 * the window the toast has to survive is one screenshot rather than ten.
 *
 * The bytes are held in memory after the first shot rather than re-read from disk,
 * because `capture` writes every attempt to the SAME path - which is the whole
 * mechanism of the failure above.
 */
async function captureToastPair(cdp, label) {
	const first = await capture(cdp, label, { assertPalette: false });
	const firstBytes = readFileSync(first.path);
	const firstText = await toastText(cdp).catch(() => null);
	const second = await capture(cdp, label, { assertPalette: false });
	const secondText = await toastText(cdp).catch(() => null);
	/* The palette is asserted on the SECOND shot, which is the frame this helper
	 * hands back: the first is the same file at the same screen one capture earlier. */
	return await assertKeptFrame(cdp, {
		...second,
		stable:
			firstText !== null &&
			secondText !== null &&
			firstBytes.equals(readFileSync(second.path)),
		toastText: secondText,
		firstToastText: firstText,
	});
}

/** The text of the toast on screen, or `null` when there is none. */
function toastText(cdp) {
	return cdp.evaluate(
		`(() => { const t = document.querySelector(${JSON.stringify(TOAST_SELECTOR)}); return t ? (t.textContent ?? null) : null; })()`,
	);
}

/**
 * The close's sentence, READ FROM THE MODULE THAT OWNS IT.
 *
 * `close-copy.ts` is where the words a close shows live (UX round 1, U1), and this
 * scene asserts that sentence reaching the screen. Spelling it out here as well
 * would be a second copy of the promise, and a second copy can drift from the first
 * - which is the one thing a check of copy must not do. So the sentence is parsed
 * out of the module, and a module that no longer carries it in this shape fails the
 * scene rather than silently comparing against a stale string.
 */
const CLOSE_SENTENCE_SOURCE_RE = /`Closed \$\{title\}\.([^`]*)`/;

function closeKeptWordsSentence(title) {
	const source = readFileSync(
		join(
			ROOT,
			"src/renderer/src/features/chat/components/canvas/close-copy.ts",
		),
		"utf8",
	);
	const match = source.match(CLOSE_SENTENCE_SOURCE_RE);
	if (!match)
		throw new Error(
			"close-copy.ts no longer carries the close's sentence in the shape this scene reads it in",
		);
	return `Closed ${title}.${match[1]}`;
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
/*
 * THE `browser-mark` SCENE IS GONE WITH THE CONTROL IT DROVE (operator ask, 2026-09-18).
 *
 * It walked the sidebar: a conversation's row, the mark that row carried once a tab was
 * open in it, and the press that opened the pane scoped to that conversation. Two of
 * those three claims live on elsewhere - `browser-pane` beside it still drives the pane
 * and its scope, and the tab-to-conversation attribution is a model fact
 * (`tab-index-model.ts`'s `tabsBySession`, asserted in `browser-chrome.test.mjs`). What
 * is no longer reachable is the sidebar's own half: there is no per-row control to press,
 * so the scene and its `markReading` helper were deleted with the mark rather than left
 * driving a selector nothing renders. Its three committed frames
 * (`docs/evidence/browser-conversation-mark/live/`) went with them.
 */

/*
 * Move the REAL pointer over an element, and leave it there.
 *
 * A reveal that hangs off `:hover` cannot be produced by dispatching anything
 * inside the page - `group-hover` is compositor state, not an event the element
 * is handed - so the pointer has to come through the input pipeline this driver
 * already speaks for keys (`Input.dispatchKeyEvent`). The app answers where the
 * element IS (`measure`), because the layout is the app's own and the driver has
 * no evaluation channel by design.
 */
async function hoverOver(cdp, selector) {
	const box = await verb(cdp, "measure", selector);
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: box.centre.x,
		y: box.centre.y,
		button: "none",
		buttons: 0,
	});
	return box;
}

/**
 * Click an element with the REAL pointer, and wait for it to exist first.
 *
 * WHY NOT THE `press` VERB, which is what most scenes use: `press` dispatches
 * synthetic pointer events straight at the element, and a synthetic
 * `mousedown` does not move FOCUS in Chromium. A scene that then types
 * (`Input.insertText`) would type into nothing, silently - measured here, on the
 * search field, as a query that never arrived and a frame of an empty box.
 * The pointer this helper moves is the trusted one the input pipeline produces,
 * which is also the gesture a reviewer makes: focus follows the press, the
 * element's own hover state applies, and the app's handlers are the ones it
 * really has.
 */
async function clickAt(cdp, selector) {
	const box = await verb(cdp, "measure", selector);
	const { x, y } = box.centre;
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x,
		y,
		button: "none",
		buttons: 0,
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x,
		y,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x,
		y,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	return box;
}

/**
 * `session-archive`: the sidebar and the header as the archive feature leaves them.
 *
 * ## What this scene is for
 *
 * Four of the claims this change makes are claims about PIXELS, and none of them
 * is reachable from the unit suite: that a row spends no width at rest, that the
 * pointer reveals the archive control without moving anything, that the search
 * block gains its `Include archived` control only while a query exists, and that
 * the one delete confirmation reads as the app's danger role. Each is a state
 * this scene puts the app into and photographs.
 *
 * ROUND 1 ADDED FOUR STATES THE FIRST SET DID NOT CARRY, three of them surfaces of
 * this change that had no frame at all and one a frame the design round asked for
 * to settle a finding: the open conversation archived, with the header's pill and
 * its restore control (D2); the delete REFUSED through the dialog that asked, with
 * the keyboard back on the safe action (D3, UX U3); the archive refused, in the
 * panel's own toast lane (D3, and design D11 of `docs/design/sidebar-row-space.md`
 * for the lane); and the row's own hover with the pointer on the title rather than
 * on the control (D5). The undo offer a successful archive makes (D7) is
 * photographed too - in its own frame, with its own assertion, because it is a
 * TOAST and every other capture here asserts `toastFree`. The REFUSED archive's two
 * frames are in that same list for the same reason: the refusal is a toast now.
 *
 * ## What it runs against
 *
 * `--backend` names the harness's own stand-in daemon
 * (`docs/evidence/session-archive/harness/stub-daemon.mjs`), because the backend
 * half of the feature is its own pull request and no daemon answers
 * `session_archive` yet. The app is the real one: its own catalogue read, its own
 * store, its own search, its own header and dialog. The README says per frame
 * which half that is.
 *
 * ## The pair that is a measurement
 *
 * `at-rest` is captured twice - once against a daemon that advertises the two
 * capabilities and once against `stub-daemon.mjs --no-archive` - and the two
 * frames are byte-compared (`cmp`) in the README's table. That is the fail-closed
 * claim stated as something a reader can check rather than as prose: with the
 * capability absent the panel has no slot, no marker, no control and no chrome.
 */
/**
 * THE LIST'S OWN BOX, ITS SCROLL AND EVERY ROW'S OFFSET, in one reading.
 *
 * WHY THIS EXISTS (QA round 3, Q-3 = design round 4, D20): D14 promised that the band's height
 * comes out of the list - "the list yields its bottom ... `scrollTop` is never written" - and the
 * committed assembly did not do it: the list is `flex: 0 0 auto` in the two-region shape, so the
 * column paid the band out of the ENTITY region above, whose height IS the list's top, and every
 * row rode up by the band's height (measured: -150 at the settled refusal, -34/-58 mid-entrance,
 * -144 at the short window, the list's own height never changing). The promise is a claim about
 * THIS box and THESE offsets, so it is read rather than restated.
 */
async function listAndRowOffsets(cdp) {
	return cdp.evaluate(`(() => {
		/*
		 * BOTH REGIONS, because the band's ruling (design round 6, Q-3) is about which one gives:
		 * the column's bottom-most region loses the band off its own bottom and the one above keeps
		 * its box TO THE PIXEL, so a reading that watched only the list could not tell the two apart
		 * - it would pass on the defect this replaced, where the entity region above paid and the
		 * list was translated up with its height unchanged. Each region reports its box, its own
		 * scroll, and the tops of what it draws: the list's rows are session rows and the entity
		 * region's are entity groups (its nested rows are session rows too, and they are in the
		 * top-level list below with a region tag so a comparison can tell them apart).
		 */
		const region = (sel, rowSel, tag) => {
			const node = document.querySelector(sel);
			if (node === null) return null;
			const rect = node.getBoundingClientRect();
			return {
				top: Math.round(rect.top),
				height: Math.round(rect.height),
				scrollTop: node.scrollTop,
				scrollHeight: node.scrollHeight,
				rows: Array.from(node.querySelectorAll(rowSel)).map((row) => ({
					id:
						row.getAttribute("data-session-row") ??
						row.getAttribute("data-entity-name") ??
						row.textContent.trim().slice(0, 24),
					region: tag,
					top: Math.round(row.getBoundingClientRect().top),
				})),
			};
		};
		const band = document.querySelector("[data-archive-toast-band]");
		return {
			list: region('[data-sidebar-region="chats"]', "[data-session-row]", "chats"),
			entities: region('[data-sidebar-region="entities"]', "[data-entity]", "entities"),
			band: band === null ? 0 : Math.round(band.getBoundingClientRect().height),
			rows: Array.from(
				document.querySelectorAll(
					'[data-sidebar-region="chats"] [data-session-row], [data-sidebar-region="entities"] [data-session-row]',
				),
			).map((row) => ({
				id: row.getAttribute("data-session-row"),
				top: Math.round(row.getBoundingClientRect().top),
			})),
		};
	})()`);
}

/** Whether two row lists name the same rows at the same offsets, to the pixel. */
function sameTops(before, after) {
	/*
	 * TWO EMPTY LISTS ARE EQUAL, and that matters here: this fixture's entity region draws neither
	 * `[data-entity]` groups nor nested session rows in the state the band's check runs in, so the
	 * entity side of the comparison is genuinely empty - and its rows ARE covered anyway by the
	 * top-level list, which reads the session rows inside both regions. An empty comparison that
	 * returned `false` would fail the acceptance reading on a fixture that has nothing to move.
	 */
	if (before.length !== after.length) return false;
	if (before.length === 0) return true;
	const first = new Map(before.map((row) => [row.id, row.top]));
	return after.every((row) => {
		const was = first.get(row.id);
		return was !== undefined && was === row.top;
	});
}

/** Whether two `listAndRowOffsets` readings describe the same rows at the same offsets. */
function rowsUnmoved(before, after) {
	if (before.rows.length === 0 || before.rows.length !== after.rows.length)
		return false;
	const first = new Map(before.rows.map((row) => [row.id, row.top]));
	return after.rows.every((row) => {
		const was = first.get(row.id);
		return was !== undefined && Math.abs(was - row.top) <= 1;
	});
}

/**
 * THE CARD'S OWN BOX, READ UNTIL IT STOPS MOVING, AND BOUNDED TO THE CHEAP SIDE (QA round 3's
 * Q-6, D17, D18).
 *
 * Sonner animates the toast's own height over ~400ms, so a box read - or a FRAME taken - as the
 * message arrives describes a card still growing: the dark `refusal-band-280` frame was captured at
 * 58 tall against a settled 142, with its top border in the wrong place and its last line cut
 * mid-word, and `offer-toast-280`/`offer-toast-320` paired a settled card in one palette with a
 * 34-tall one in the other.
 *
 * The loop drives a rendering update per attempt (`Page.captureScreenshot`, the same driver the
 * capture helpers use, because a ResizeObserver callback needs a rendering update a headless window
 * does not produce on its own) and stops as soon as two consecutive readings agree: two screenshots
 * in the ordinary case, six in the worst - 6 x 120ms, about 0.7s. THAT BOUND IS THE POINT. An
 * earlier version of this used twelve attempts and cost ~26s across the two places it ran, which is
 * LONGER THAN THE LANE'S OWN MESSAGE LIFE: the loop outlived the card it was waiting for, read
 * `{band: {height: 0}, card: null}` and the step lost the message its frames photograph. A settle
 * that can outlive its subject is worse than the clock wait it replaces.
 */
async function awaitCardSettled(cdp, { attempts = 6, gapMs = 120 } = {}) {
	let previous = null;
	let reading = null;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		await capture(cdp, "settle-probe").catch(() => null);
		reading = await verb(cdp, "measure", SIDEBAR_TOAST).catch(() => null);
		const key = reading === null ? null : JSON.stringify(reading.rect);
		if (key !== null && key === previous) return { reading, attempts: attempt };
		previous = key;
		await wait(gapMs);
	}
	return { reading, attempts };
}

/**
 * A BAND ARRIVING ON A LIST THE READER IS STANDING IN, WITH THE WRITER NAMED (QA round 4's Q-9,
 * design round 7's D24).
 *
 * WHY THIS IS AN INSTRUMENT AND NOT A COMPARISON OF TWO NUMBERS. QA measured
 * `{"scrollBefore":8.5,"scrollAfter":0}` on an overflowing list and could not name what moved it -
 * the app's own focus-hold returns early when no row carries focus, and no `scrollIntoView` sits on
 * that path - and left the writer to the implementer. The candidate the code offers is
 * `holdFocusedRow`, the ONLY writer of these containers' `scrollTop` in this feature
 * (`sidebar-focus-hold.ts:224`), but a before/after pair cannot tell a JS write from the browser's
 * own reset of a scroller that was RE-ATTACHED in the DOM - measured in this same file as `24 -> 0`
 * (see `saveRegionScroll`'s argument) - and the two want different fixes. So all three signatures
 * are taken at once:
 *
 *   1. THE WRITE ITSELF, trapped on the list's own `scrollTop` property, with the stack that made
 *      it. A write is a finding whatever value it carried, which is why this is a trap rather than
 *      a comparison of two readings.
 *   2. EVERY FRAME, sampled on `requestAnimationFrame` across the arrival: the scroll, the box, and
 *      whether the element the selector names is still the SAME NODE. A reset by re-attachment
 *      shows here and nowhere else.
 *   3. THE DOM, watched with a `MutationObserver`: a row arriving or leaving, and any mutation that
 *      touches the list node itself.
 *
 * AND THE STATE IS QA'S, which is the half the committed probe never reached: the list is given a
 * cap so it OVERFLOWS AT REST (this app's list is content-sized, and a shorter window takes the
 * slack out of the `flex-1` entity region instead - measured: no overflow at 700px), the reader's
 * own scroll is set off the top, a row that STARTS INSIDE the clip is focused (the state the
 * focus-hold records as 'inside' or 'partly', without which its gate cannot correct anything at
 * all), and the band is raised by the app's own control.
 *
 * TWO ARRIVALS, BECAUSE THE TWO CANDIDATE WRITERS DIFFER IN ONE INPUT. `press.aboveFocused` presses
 * a live row ABOVE the cursor's, so that row LEAVES the list and the cursor's row CHANGES SLOT - the
 * one input `holdFocusedRow`'s gate needs before it will correct at all. A press on a refused row
 * takes nothing out of the list and leaves the slot alone, which is QA's own case. The caller drives
 * both.
 *
 * WHAT IT DOES NOT DO: decide whether the app is right. It returns the readings; `arrivalReading`
 * and the scene's checks read the clauses the designer's ruling states for them.
 */
async function scrolledArrival(
	cdp,
	{ label, cap, scroll, press, cursor = null },
) {
	/*
	 * ONE READING, TAKEN TWICE. The before and the after are the same script, so a comparison
	 * between them cannot be a comparison of two instruments - and the reading carries the
	 * instrument's own output when one has been armed.
	 */
	const stateScript = `(() => {
		const list = document.querySelector('[data-sidebar-region="chats"]');
		if (list === null) return { ok: false, why: "no list region" };
		const bandNode = document.querySelector("[data-archive-toast-band]");
		const card = document.querySelector(${JSON.stringify(SIDEBAR_TOAST)});
		const entities = document.querySelector('[data-sidebar-region="entities"]');
		const box = list.getBoundingClientRect();
		const clipTop = box.top + list.clientTop;
		const clip = { top: clipTop, bottom: clipTop + list.clientHeight };
		const visibilityOf = (rect) =>
			rect.bottom <= clip.top || rect.top >= clip.bottom
				? "outside"
				: rect.top >= clip.top && rect.bottom <= clip.bottom
					? "inside"
					: "partly";
		const rows = Array.from(list.querySelectorAll("[data-session-row]")).map((row) => {
			const button = row.querySelector("[data-chat-row]");
			const rect = (button ?? row).getBoundingClientRect();
			const control = row.querySelector("[data-session-archive]");
			return {
				id: row.getAttribute("data-session-row"),
				top: Math.round(rect.top),
				height: Math.round(rect.height),
				action: (control?.getAttribute("aria-label") ?? "").split(" ")[0] ?? null,
			};
		});
		const active = document.activeElement;
		const rowNodes = Array.from(list.querySelectorAll("[data-chat-row]"));
		const activeRect =
			active instanceof HTMLElement && rowNodes.includes(active)
				? active.getBoundingClientRect()
				: null;
		const activeRow =
			active instanceof HTMLElement ? active.closest("[data-session-row]") : null;
		const activeId =
			activeRow === null ? null : activeRow.getAttribute("data-session-row");
		const focusedIndex = activeId === null ? -1 : rows.findIndex((row) => row.id === activeId);
		const q9 = window.__q9 ?? null;
		let instrument = null;
		if (q9 !== null) {
			if (q9.stop) q9.stop();
			instrument = {
				writes: q9.writes.map((w) => ({
					value: w.value,
					from: w.from,
					at: w.at,
					stack: w.stack,
				})),
				samples: q9.samples.slice(0, 40),
				sampleCount: q9.samples.length,
				mutations: q9.mutations.slice(0, 20),
				mutationCount: q9.mutations.length,
			};
		}
		return {
			ok: true,
			overflowAtRest: list.scrollHeight > list.clientHeight + 1,
			scrollTop: list.scrollTop,
			box: {
				top: Math.round(box.top),
				height: Math.round(list.clientHeight),
				scrollHeight: list.scrollHeight,
			},
			clip: { top: Math.round(clip.top), bottom: Math.round(clip.bottom) },
			band: bandNode === null ? 0 : Math.round(bandNode.getBoundingClientRect().height),
			card: card === null ? null : Math.round(card.getBoundingClientRect().height),
			entities:
				entities === null
					? null
					: {
							top: Math.round(entities.getBoundingClientRect().top),
							height: Math.round(entities.getBoundingClientRect().height),
							scrollTop: entities.scrollTop,
						},
			rows,
			focused: {
				id: activeId,
				index: activeRect === null ? -1 : rowNodes.indexOf(active),
				top: activeRect === null ? null : Math.round(activeRect.top),
				bottom: activeRect === null ? null : Math.round(activeRect.bottom),
				visibility: activeRect === null ? "no-row-focused" : visibilityOf(activeRect),
			},
			focusedIndex,
			activeIsChatRow: activeRect !== null,
			instrument,
		};
	})()`;
	const readState = async (why) => {
		try {
			const reading = await cdp.evaluate(stateScript);
			return { ...reading, why };
		} catch (error) {
			return { ok: false, why: `${why}: ${String(error)}` };
		}
	};
	/*
	 * THE ARRIVAL STARTS FROM NO BAND, and the wait is a precondition rather than tidiness: the rig's
	 * cap is applied below and the app measures its OWN band-0 box (`listBase`) on the next commit,
	 * so a band standing then would leave the base measured from a box the band had already taken
	 * height off - and the yield clause would be asserting arithmetic about this probe. The lane's
	 * message retires on its own clock, so this waits it out.
	 */
	let bandNow = null;
	for (let attempt = 0; attempt < 60; attempt += 1) {
		bandNow = await cdp
			.evaluate(`(() => {
				const band = document.querySelector("[data-archive-toast-band]");
				return band === null ? 0 : Math.round(band.getBoundingClientRect().height);
			})()`)
			.catch(() => null);
		if (bandNow === 0) break;
		await wait(500);
	}
	/*
	 * THE RULE IS BUILT HERE, IN THE DRIVER'S OWN CODE, and the page only assigns it: a nested
	 * template literal inside the page script would terminate the script string it lives in, and
	 * building the rule by concatenation is what `pnpm lint` refuses.
	 */
	const capRule = `[data-sidebar-region="chats"] { max-height: ${cap} !important; }`;
	const capped = await cdp.evaluate(`(() => {
		const list = document.querySelector('[data-sidebar-region="chats"]');
		if (list === null) return { ok: false, why: "no list region" };
		/*
		 * THE CAP IS THE RIG'S ONLY EDIT, and it is the one thing the app's own layout cannot be
		 * driven to: the region's maxHeight comes from the split, and it is measured from the list's
		 * own content - so the box is content-sized at rest, it does not overflow, and a scroll
		 * written on it would be clamped away (measured: 241 against 241, scrollTop 0).
		 *
		 * IT IS A STYLESHEET RULE, AND THAT IS NOT DECORATION. Two measured attempts to hold this
		 * inline failed: a plain value was overwritten by the split's own recompute in the resize
		 * commit below (the box read 241 with the cap at 200 and the state collapsed back to "no
		 * overflow"), and an IMPORTANT inline value died with React's own bookkeeping, because when
		 * this region's style prop transitions - the same commit clears the declaration React
		 * wrote, and a clear removes the whole declaration including its priority. A rule in a
		 * stylesheet React never touches survives both, and beats an inline non-important value.
		 *
		 * Everything after this line is the app's: the press is the app's control, the card is the
		 * app's message, and the commit that gives the band its height is the app's own.
		 */
		const sheet = document.createElement("style");
		sheet.setAttribute("data-q9-cap", "1");
		sheet.textContent = ${JSON.stringify(capRule)};
		document.head.appendChild(sheet);
		const applied = getComputedStyle(list).maxHeight;
		return { ok: true, bandAtSeed: ${JSON.stringify(bandNow)}, appliedMaxHeight: applied };
	})()`);
	if (capped?.ok !== true) return { label, capped };
	/*
	 * A COMMIT AFTER THE CAP, AND BEFORE THE CURSOR IS PLACED. The band-0 box is read in a layout
	 * effect on every commit while no band stands (`chat-sidebar.tsx`), so a cap written between
	 * commits is a box the app has not measured yet - and the yield would then be computed from the
	 * pre-cap box, which is a fact about this probe rather than about the app. A 1px window change is
	 * a reader's own gesture, it is delivered through the app's own observers, and it leaves the
	 * list's vertical layout where it was. It comes BEFORE the focus deliberately: this commit can
	 * re-render the rows, and a cursor placed before it would be a cursor the re-render had moved.
	 */
	await cdp
		.send("Emulation.setDeviceMetricsOverride", {
			width: 1201,
			height: 700,
			deviceScaleFactor: 2,
			mobile: false,
		})
		.catch(() => null);
	await wait(250);
	await cdp
		.send("Emulation.setDeviceMetricsOverride", {
			width: 1200,
			height: 700,
			deviceScaleFactor: 2,
			mobile: false,
		})
		.catch(() => null);
	await wait(400);
	/*
	 * THE CURSOR AND THE READER'S SCROLL, placed after that commit and in this order: `focus()`
	 * scrolls its element into view, and the state under test is a reader who put the list where
	 * they wanted it with a cursor inside it - a probe whose scroll was decided by the browser's
	 * focus scroll would be measuring that instead. The row is the LAST one that STARTS inside the
	 * clip (the one sitting within a row's height of the clip's lower edge): it reads 'inside' or
	 * 'partly' now, the two states the record must carry for a correction to be possible at all, and
	 * the band's own height given back off the box's bottom puts its top below the new edge.
	 */
	const placed = await cdp.evaluate(`(() => {
		const list = document.querySelector('[data-sidebar-region="chats"]');
		if (list === null) return { ok: false, why: "no list region" };
		const clipOf = () => {
			const rect = list.getBoundingClientRect();
			const top = rect.top + list.clientTop;
			return { top, bottom: top + list.clientHeight };
		};
		const pickFocus = () => {
			/*
			 * THE CURSOR THE CALLER NAMED, when it named one (agent review round 5): the departure's own
			 * reading wants the cursor on a row that STAYS, so the hold's own correction is out of the
			 * picture and the clause measures the READER'S POSITION rather than the correction. Unnamed,
			 * the cursor goes on the last row that starts inside the clip - the row a correction is
			 * possible for at all.
			 */
			const named = ${JSON.stringify(cursor)};
			if (named !== null) {
				return list.querySelector('[data-session-row="' + named + '"]');
			}
			const clip = clipOf();
			const inside = Array.from(list.querySelectorAll("[data-session-row]")).filter((row) => {
				const button = row.querySelector("[data-chat-row]");
				if (button === null) return false;
				const rect = button.getBoundingClientRect();
				return rect.top >= clip.top && rect.top < clip.bottom;
			});
			return inside[inside.length - 1] ?? null;
		};
		let chosen = pickFocus();
		if (chosen === null) return { ok: false, why: "no session row starts inside the clip" };
		chosen.querySelector("[data-chat-row]").focus();
		list.scrollTop = ${JSON.stringify(scroll)};
		chosen = pickFocus() ?? chosen;
		const button = chosen.querySelector("[data-chat-row]");
		button.focus();
		list.scrollTop = ${JSON.stringify(scroll)};
		return {
			ok: true,
			focusedId: chosen.getAttribute("data-session-row"),
			focusHeld: document.activeElement === button,
			scrollTop: list.scrollTop,
		};
	})()`);
	if (placed?.ok !== true) return { label, capped, placed };
	const before = await readState("before");
	const pressSelector = press.selector;
	const armed = await cdp.evaluate(`(() => {
		const list = document.querySelector('[data-sidebar-region="chats"]');
		if (list === null) return { ok: false };
		/*
		 * THE SETTER IS TAKEN FROM THE DESCRIPTOR ALREADY ON THE ELEMENT when one is - the walk's own
		 * trap sits there - so this records the writes that trap records rather than replacing it:
		 * two recorders, one write each.
		 */
		const own = Object.getOwnPropertyDescriptor(list, "scrollTop");
		const underlying =
			own ?? Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
		window.__q9 = { writes: [], samples: [], mutations: [], t0: performance.now() };
		Object.defineProperty(list, "scrollTop", {
			configurable: true,
			get() {
				return underlying.get.call(this);
			},
			set(value) {
				window.__q9.writes.push({
					value,
					from: underlying.get.call(this),
					at: Math.round(performance.now() - window.__q9.t0),
					stack: (new Error().stack || "").split("\\n").slice(1, 6).join(" <- "),
				});
				underlying.set.call(this, value);
			},
		});
		let frames = 0;
		const tick = () => {
			const named = document.querySelector('[data-sidebar-region="chats"]');
			const sample = {
				t: Math.round(performance.now() - window.__q9.t0),
				scrollTop: list.scrollTop,
				box: list.clientHeight,
				/*
				 * THE EXTENT AS WELL AS THE BOX, in the SAME sample (design round 8, D27's item 4): the
				 * clause is about scrollHeight minus clientHeight, so a sample that carried only one of
				 * the two could not say whether a position was ever unreachable - and pairing them is
				 * what lets a reader see the band arriving in the same frame as the shrink. (No
				 * backticks in this comment: it lives inside the page script's own template literal.)
				 */
				scrollHeight: list.scrollHeight,
				connected: list.isConnected,
				sameNode: named === list,
			};
			const last = window.__q9.samples[window.__q9.samples.length - 1];
			if (
				last === undefined ||
				last.scrollTop !== sample.scrollTop ||
				last.box !== sample.box ||
				last.scrollHeight !== sample.scrollHeight ||
				last.sameNode !== sample.sameNode
			)
				window.__q9.samples.push(sample);
			if (frames++ < 300) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				const nodes = [...record.addedNodes, ...record.removedNodes].filter(
					(n) => n.nodeType === 1,
				);
				const interesting = nodes.filter(
					(n) =>
						n === list ||
						n.hasAttribute("data-session-row") ||
						n.hasAttribute("data-chat-row") ||
						n.contains(list),
				);
				if (interesting.length === 0) continue;
				const name = (n) =>
					n === list
						? "LIST"
						: n.getAttribute("data-session-row") !== null
							? "row:" + n.getAttribute("data-session-row")
							: n.hasAttribute("data-chat-row")
								? "chat-row"
								: n.tagName.toLowerCase();
				window.__q9.mutations.push({
					t: Math.round(performance.now() - window.__q9.t0),
					added: [...record.addedNodes].filter((n) => n.nodeType === 1).map(name),
					removed: [...record.removedNodes].filter((n) => n.nodeType === 1).map(name),
				});
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		window.__q9.stop = () => observer.disconnect();
		return { ok: true };
	})()`);
	/*
	 * THE HOVER IS THE IDIOM THE WALK'S OWN PRESSES USE - the row first, then its control, because
	 * the acts are display-switched and a control addressed at rest has a 0x0 box. The DOM press
	 * below does not need the box, but a state read without it is not the state a reader presses in.
	 * The scene addresses this control by its own label, which carries spaces inside the VALUE
	 * (`[aria-label='Archive “X”']`), so the selector IS the row address here and is not split.
	 */
	if (pressSelector !== null && pressSelector !== "") {
		const rowSelector = pressSelector.startsWith("[data-session-row=")
			? pressSelector.split(" ")[0]
			: pressSelector;
		await hoverOver(cdp, rowSelector).catch(() => null);
		await wait(300);
		await hoverOver(cdp, pressSelector).catch(() => null);
		await wait(300);
	}
	await cdp.evaluate("window.__q9.writes.length = 0").catch(() => null);
	const atPress = await cdp.evaluate(`(() => {
		const list = document.querySelector('[data-sidebar-region="chats"]');
		const selector = ${JSON.stringify(pressSelector ?? "")};
		/*
		 * AN EMPTY SELECTOR IS A READING, NOT A THROW: 'querySelector("")' raises, and a probe that
		 * took the whole run down with it would report the harness rather than the app (the first
		 * pass of this check did exactly that). The reading this returns is what the scene's own
		 * precondition check then fails on.
		 */
		const control = selector === "" ? null : document.querySelector(selector);
		const reading = {
			scrollTop: list === null ? null : list.scrollTop,
			box: list === null ? null : list.clientHeight,
			/* The extent at the press, which the samples are compared against (D27 item 4). */
			scrollHeight: list === null ? null : list.scrollHeight,
			band: (() => {
				const band = document.querySelector("[data-archive-toast-band]");
				return band === null ? 0 : Math.round(band.getBoundingClientRect().height);
			})(),
		};
		if (control === null) return { clicked: false, reading, selector, rowId: null };
		/*
		 * THE ROW THE CONTROL BELONGS TO, recorded because the departure's own clause has to say WHICH row it
		 * expected to leave (agent review round 5): the selector names a control, and only the DOM knows which
		 * row that control sits in.
		 */
		const rowId = control.closest("[data-session-row]")?.getAttribute("data-session-row") ?? null;
		/*
		 * A DOM CLICK, DELIBERATELY, AND IT IS THE HALF THAT MAKES THE READING POSSIBLE: a REAL
		 * pointer press focuses the control it presses, and the focus-hold's gate then reads
		 * rowNodes.indexOf(document.activeElement) as -1 and returns early - so the writer under
		 * test could not run at all. This is the one place in this file where the synthetic click is
		 * the faithful one: the handler is the row's own, the request is the app's, and the cursor
		 * stays on the row the reader put it on.
		 */
		control.click();
		return { clicked: true, reading, selector, rowId };
	})()`);
	const settled = await awaitCardSettled(cdp);
	await wait(500);
	const after = await readState("after");
	return {
		label,
		capped,
		placed,
		armed,
		before,
		pressSelector,
		atPress,
		settledAttempts: settled.attempts,
		after,
	};
}

/**
 * The clauses the designer's ruling states for a scrolled arrival, read off `scrolledArrival`'s two
 * readings: the reader's scroll, the rows' offsets, the yield, and the trap.
 *
 * `base` is the list's band-0 box, PASSED IN because an arrival's own before-reading may already
 * have a band up: the second arrival starts with the first one's message standing, so its box is
 * already short of the base by that band. The yield the ruling states is the base less the band.
 */
function arrivalReading(arrival, base, expect = "none") {
	const before = arrival.before ?? {};
	const atPress = arrival.atPress ?? {};
	const after = arrival.after ?? {};
	const was = new Map((before.rows ?? []).map((row) => [row.id, row.top]));
	const kept = (after.rows ?? []).filter((row) => was.has(row.id));
	const gone = (before.rows ?? [])
		.filter((row) => !(after.rows ?? []).some((other) => other.id === row.id))
		.map((row) => ({ id: row.id, height: row.height }));
	const deltas = [...new Set(kept.map((row) => row.top - was.get(row.id)))];
	const writes = after.instrument?.writes ?? null;
	const focusedBefore = before.focused ?? {};
	const focusedAfter = after.focused ?? {};
	/*
	 * A ROW MAY NOT MOVE AT ALL ACROSS A PRESS WHOSE ROW IS REFUSED (design round 8, D27), and a press the
	 * daemon ACCEPTS moves exactly the one the reader pressed (design round 9, D30) - the same clause seen
	 * from the two arrivals the scene drives. `expect` names which, because a reading that asserted the
	 * refusal's shape about the accepted press would be asserting that nothing departs, which is the state
	 * this fix exists to keep reachable rather than a property of the walk.
	 */
	const rowsHeld =
		expect === "none"
			? gone.length === 0 && deltas.every((delta) => delta === 0)
			: false;
	const rowsHeldLeaving =
		expect === "the pressed row" &&
		gone.length === 1 &&
		atPress.rowId !== null &&
		atPress.rowId !== undefined &&
		gone[0].id === atPress.rowId &&
		deltas.every((delta) => delta === 0);
	/*
	 * THE TWO DEPARTURE CLAUSES (design round 9, D30), read from the samples the probe took every frame:
	 *
	 * `extentPairedWithBox` - THE EXTENT MAY SHRINK ONLY IN A SAMPLE THAT ALSO SHRINKS THE BOX. A list whose
	 * content loses a row while its box is unchanged is a list whose maximum scroll just fell under the
	 * reader: `scrollHeight - clientHeight` is what a clamp acts on, and nothing gives the position back
	 * afterwards. This is the clause that has to hold on the ACCEPTED press, where the pressed row's own
	 * height leaves the list.
	 *
	 * `rangeHeld` - AND THE READER'S POSITION IS REACHABLE IN EVERY SAMPLE, which is the same claim stated
	 * arithmetically: `scrollTop <= scrollHeight - clientHeight` throughout. A sample that violated it is a
	 * sample in which the browser had already clamped, so this reads the mechanism where `framesHeld` reads
	 * the symptom.
	 */
	const scrollTopAtPress = atPress.reading?.scrollTop ?? null;
	const extentAtPress = atPress.reading?.scrollHeight ?? null;
	const samples = after.instrument?.samples ?? [];
	const shrunkExtent = [];
	const unreachable = [];
	for (let i = 0; i < samples.length; i += 1) {
		const sample = samples[i];
		const previous = i === 0 ? null : samples[i - 1];
		if (
			previous !== null &&
			sample.scrollHeight < previous.scrollHeight &&
			sample.box >= previous.box
		)
			shrunkExtent.push({ previous, sample });
		if (
			scrollTopAtPress !== null &&
			typeof sample.scrollHeight === "number" &&
			typeof sample.box === "number" &&
			sample.scrollHeight - sample.box < scrollTopAtPress
		)
			unreachable.push(sample);
	}
	const extentPairedWithBox = shrunkExtent.length === 0;
	const rangeHeld = unreachable.length === 0;
	/*
	 * THE POSITION IS HELD IN EVERY FRAME, not only at the two ends the walk reads (design D27's item 3): the
	 * clamp this clause is about is instantaneous, so a pair that agreed could still have hidden a frame in which
	 * the position was taken and returned (2-4 ms on a healthy daemon, and the whole in-flight window on a stalled
	 * one - the designer's argument against the return-the-position shapes).
	 */
	const framesHeld =
		scrollTopAtPress !== null &&
		samples.length > 0 &&
		samples.every((sample) => sample.scrollTop === scrollTopAtPress);
	/*
	 * AND THE EXTENT IS BYTE-EQUAL ACROSS THE PRESS, paired with each sample's box so the reader can see the shrink
	 * and the box moving together: with the departure off the press there is nothing to take the extent below the
	 * box, so `scrollHeight - clientHeight` never goes negative and no clamp is available to the browser.
	 */
	/*
	 * AND THE EXTENT IS BYTE-EQUAL ONLY WHERE NOTHING MAY DEPART (agent review round 5, D30's instrument
	 * half): a press the daemon ACCEPTS shortens the content by the row's own height, and the band that
	 * answers it can only be measured a commit later - so demanding a byte-equal extent of a departure
	 * asks for something the app is not supposed to do. Where a row departs, the clause is the PAIRING
	 * (`extentPairedWithBox`: the extent shrinks only in a sample that also shrinks the box) plus the
	 * RANGE (`rangeHeld`: the reader's position is reachable in every sample), and both are computed
	 * above from the very samples this branches on.
	 */
	const extentHeld =
		expect === "none"
			? extentAtPress !== null &&
				before.box?.scrollHeight === extentAtPress &&
				after.box?.scrollHeight === extentAtPress &&
				samples.every((sample) => sample.scrollHeight === extentAtPress)
			: true;
	return {
		label: arrival.label,
		stateOk:
			arrival.capped?.ok === true &&
			arrival.placed?.ok === true &&
			arrival.placed?.focusHeld === true &&
			arrival.armed?.ok === true &&
			before.ok === true &&
			before.overflowAtRest === true &&
			atPress.clicked === true &&
			atPress.reading?.scrollTop > 0 &&
			before.focused.visibility !== "no-row-focused" &&
			after.band > 0 &&
			after.card !== null,
		state: {
			overflowAtRest: before.overflowAtRest,
			scrollAtPress: atPress.reading?.scrollTop,
			bandAtSeed: arrival.seeded?.bandAtSeed,
			bandAtPress: atPress.reading?.band,
			bandAfter: after.band,
			card: after.card,
			focusedBefore: focusedBefore,
			focusedAfter,
			clicked: atPress.clicked,
			pressSelector: arrival.pressSelector,
			rows: {
				before: (before.rows ?? []).length,
				after: (after.rows ?? []).length,
			},
		},
		/*
		 * THE GEOMETRY THE PRE-FIX GATE READ AS A ROW LEAVING, read rather than asserted by
		 * construction: the cursor's row was on screen before the press and is outside the panel
		 * after it, and the panel's box got shorter doing it. That is what makes the empty trap
		 * beside this a statement about the code rather than a state in which nothing could have
		 * written.
		 */
		geometryOk:
			(focusedBefore.visibility === "inside" ||
				focusedBefore.visibility === "partly") &&
			focusedAfter.visibility === "outside" &&
			typeof atPress.reading?.box === "number" &&
			typeof after.box?.height === "number" &&
			after.box.height < atPress.reading.box,
		geometry: {
			focusedBefore,
			focusedAfter,
			boxAtPress: atPress.reading?.box,
			boxAfter: after.box?.height,
		},
		scrollHeld:
			after.scrollTop === atPress.reading?.scrollTop &&
			framesHeld &&
			extentHeld,
		extentPairedWithBox,
		rangeHeld,
		shrunkExtent: shrunkExtent.slice(0, 6),
		unreachable: unreachable.slice(0, 6),
		scroll: {
			before: atPress.reading?.scrollTop,
			after: after.scrollTop,
			boxBefore: atPress.reading?.box,
			boxAfter: after.box,
			extentBefore: before.box?.scrollHeight,
			extentAtPress: extentAtPress,
			extentAfter: after.box?.scrollHeight,
			samples: after.instrument?.samples ?? null,
			sampleCount: after.instrument?.sampleCount ?? null,
			mutations: after.instrument?.mutations ?? null,
			mutationCount: after.instrument?.mutationCount ?? null,
		},
		trapped: writes !== null,
		writes,
		framesHeld,
		frames: {
			atPress: scrollTopAtPress,
			offenders: samples
				.filter((sample) => sample.scrollTop !== scrollTopAtPress)
				.slice(0, 6),
			count: samples.length,
		},
		extentHeld,
		extent: {
			atPress: extentAtPress,
			boxAtPress: atPress.reading?.box,
			boxAfter: after.box?.height,
			offenders: samples
				.filter((sample) => sample.scrollHeight !== extentAtPress)
				.slice(0, 6),
		},
		rowsHeld,
		rowsHeldLeaving,
		expect,
		rows: { kept: kept.length, gone, deltas },
		yieldExact: base !== null && after.box?.height === base - after.band,
		entitiesHeld:
			before.entities != null &&
			after.entities != null &&
			before.entities.top === after.entities.top &&
			before.entities.height === after.entities.height &&
			before.entities.scrollTop === after.entities.scrollTop,
		yield: {
			base,
			band: after.band,
			boxAtPress: atPress.reading?.box,
			boxAfter: after.box,
			expected: base === null ? null : base - after.band,
			entitiesBefore: before.entities,
			entitiesAfter: after.entities,
		},
	};
}

async function sceneSessionArchive(cdp) {
	const hello = await verb(cdp, "hello");
	check(
		"the renderer reports this run's frames directory",
		hello.outDir === FRAMES,
		`${hello.outDir} (expected ${FRAMES})`,
	);
	if (THEME) {
		await verb(cdp, "setTheme", THEME);
		const themed = await verb(cdp, "state");
		check(
			`the app is in the palette this run photographs (${THEME})`,
			themed.theme === THEME,
			`theme is ${themed.theme}`,
		);
	}

	await verb(cdp, "navigate", "/chat");
	/*
	 * The catalogue has to have arrived before anything is photographed: the rows
	 * come from the daemon, and a frame taken against an empty list would be a
	 * picture of this feature's absence rather than of its rest state.
	 */
	const firstRow = await verb(cdp, "measure", "[data-chat-row]");
	const state = await verb(cdp, "state");
	check(
		"the catalogue answered and the panel is drawing its rows",
		state.sessionCount >= 4,
		`sessionCount is ${state.sessionCount}`,
	);
	note("row", JSON.stringify(firstRow));

	const frames = [];
	/*
	 * Frames that are OF a transient, kept apart from the settled ones: the undo
	 * offer IS a toast (design round 1, D7), so a scene whose every capture asserts
	 * `toastFree` structurally cannot photograph it. This list carries its own
	 * checks - the toast is on screen and the picture is held still - rather than
	 * being exempted from the assertions silently.
	 */
	const offerFrames = [];

	/* 1. At rest: no query, so no control in the search block, and no slot spent. */
	await parkPointer(cdp);
	frames.push(await captureSettled(cdp, `at-rest${RUN_LABEL}`));

	if (WITHDRAWN) {
		/*
		 * THE WITHDRAWN RUN. Nothing below needs a press: the claims are all about
		 * what is NOT there, and asserting absence is the whole of it.
		 */
		let controlPresent = true;
		try {
			await verb(cdp, "measure", {
				selector: "[data-session-archive]",
				timeoutMs: 500,
			});
		} catch {
			controlPresent = false;
		}
		check(
			"with the capability absent there is no archive control on any row",
			controlPresent === false,
			`[data-session-archive] ${controlPresent ? "matched a control" : "matched nothing"}`,
		);
		await clickAt(cdp, '[aria-label="Search chats and agents"]');
		await cdp.send("Input.insertText", { text: "notes" });
		await wait(600);
		let togglePresent = true;
		try {
			await verb(cdp, "measure", {
				selector: "#chat-search-include-archived",
				timeoutMs: 500,
			});
		} catch {
			togglePresent = false;
		}
		check(
			"with the capability absent the search block gains no Include archived control",
			togglePresent === false,
			`#chat-search-include-archived ${togglePresent ? "matched a control" : "matched nothing"}`,
		);
		frames.push(await captureSettled(cdp, `search-off${RUN_LABEL}`));
		check(
			"every capture is a frame the app held still for, with no toast on it",
			frames.every(
				(frame) => frame.stable === true && frame.toastFree === true,
			),
			frames
				.map((frame) => `${frame.label}: stable=${frame.stable}`)
				.join(" | "),
		);
		return frames;
	}

	/*
	 * 2. The pointer on a row. The reveal is the whole point: the two acts are absent
	 *    from the layout until the pointer or the keyboard is inside the row (`display`,
	 *    not `opacity` - design D3 of `docs/design/sidebar-row-space.md`), so the ROW is
	 *    the hover target now and a control that is not displayed is not one. What a
	 *    reader checks by comparing the two frames is that the row itself does not move:
	 *    only the title's clip does.
	 *
	 *    THE WAIT IS FOR THE PAN (design D5), on this row rather than by luck: the row
	 *    this step presses is the one whose title cannot fit, so the pointer starts a
	 *    pan that runs for the dwell plus the pan's own ceiling. A frame captured
	 *    mid-pan is a frame the app never held still for, and `captureSettled` refuses
	 *    it - which is why the wait is the ceiling and not the arithmetic.
	 */
	/*
	 * THE SECTION IS OPENED FIRST, and that is a precondition rather than a
	 * convenience: `Previous chats` ships COLLAPSED, and a collapsed section draws no
	 * rows at all - so the row this step hovers is not in the DOM until its heading has
	 * been pressed. Measured 2026-09-21: without this, the step threw
	 * `nothing matches [data-session-row="b3f1a09c7d52"] after 10000ms of waiting` on a
	 * panel that was drawing the list correctly ("All chats 4", `Active chats` open,
	 * `Previous chats` shut), which reads like a missing row and is a shut section. The
	 * later steps that open the same section anyway (the refusal step below) now find it
	 * already open, which is the same state they asked for.
	 */
	await openSection(cdp, "Previous chats");
	/*
	 * The expansion is a transition, so the row's box is read only after it settles:
	 * hovering a box measured mid-expansion lands the pointer on a NEIGHBOUR, which is
	 * a wrong-row read that looks like a wrong-row paint (measured 2026-09-21, before
	 * this wait: the ground came back painted on the long row while the control's own
	 * ancestry said the pointer was on `2d5ad5da0025`).
	 */
	await wait(500);
	const longRow = '[data-session-row="b3f1a09c7d52"]';
	/*
	 * THE ROW FIRST, THEN ITS CONTROL. The acts are `display`-switched (D3), so the row
	 * is what reveals them; the pointer then moves ONTO the control, which is the state
	 * the ground assertion below is about (D18's arm: `hover:` on the row's box fires
	 * for the pointer anywhere inside it, children included). Both reads are scoped to
	 * this row's own control rather than to the first `[data-session-archive]` in the
	 * document, which was only ever the hovered one while this section happened to be
	 * shut - an accident of ordering, not a fact about the row.
	 */
	await hoverOver(cdp, longRow);
	await wait(300);
	await hoverOver(cdp, `${longRow} [data-session-archive]`);
	await wait(8_000);
	const revealed = await verb(
		cdp,
		"measure",
		`${longRow} [data-session-archive]`,
	);
	check(
		"the archive control exists at rest and the pointer is over it",
		revealed.inViewport === true,
		JSON.stringify(revealed),
	);
	/*
	 * The COST of the reserved slot, as a number rather than as an impression: the
	 * control's own box plus the row wrapper's gap to the row's button is title
	 * width the title no longer has, on every row, at rest. Reported here so the
	 * pull request can state it and the design round can rule on it - `size-6` is
	 * 24px, so this is the half of a two-slot reservation that exists today.
	 */
	note(
		"title width cost",
		/*
		 * WHAT `firstRow` MEASURED, named rather than implied (review round 1, N1: the
		 * figure this line reports was being read as a session row's, and it is not one
		 * - `[data-chat-row]` matches a section heading first, and a heading is a
		 * full-width button). The row geometry the README quotes comes from the frames
		 * (`magick`), where a session row can be measured rather than guessed.
		 *
		 * WHAT REPLACED THE OLD FIGURE. This note used to report what the two reserved
		 * slots cost every title AT REST ("the control's own 24px plus the wrapper's
		 * 4px gap, reserved on every row at rest"), because they were. They are not
		 * anymore: both acts are absent from the layout at rest, so the only cost left
		 * is the one paid UNDER THE POINTER, and it is photographed rather than
		 * reported here - the `row-space` scene asserts the whole table (196/236/276 at
		 * rest, 140/180/220 under the pointer) against the same row.
		 */
		`the archive control is ${revealed.rect.width}x${revealed.rect.height} under the pointer, and nothing is reserved at rest; the first [data-chat-row] box is ${firstRow.rect.width}px of a ${hello.viewport.width}px window (that box is a section heading, not a session row)`,
	);
	/*
	 * AND THE GROUND WITH THE POINTER ON A CONTROL (the arm D18 measured as "absent
	 * entirely"): `hover:` on the row's box fires for the pointer being anywhere
	 * inside it, children included, which is the property the group-prefixed
	 * spelling could not express.
	 */
	const hoverGrounds = await readRowGrounds(cdp);
	/*
	 * THE ROW THE POINTER IS ON, read from the control's own ancestry, so this is an
	 * assertion about THAT row rather than about "some row has a ground": the defect
	 * was the ground living on the button (56px short) or, with the pointer on a
	 * control, not being painted at all.
	 */
	const hoveredRowId = await cdp.evaluate(`(() => {
		const control = document.querySelector(
			'[data-session-row="b3f1a09c7d52"] [data-session-archive]',
		);
		return (
			control?.closest("[data-session-row]")?.getAttribute("data-session-row") ??
			null
		);
	})()`);
	check(
		"the row's ground survives the pointer moving onto its control",
		hoveredRowId === "b3f1a09c7d52" &&
			hoverGrounds.painted.length === 1 &&
			hoverGrounds.painted[0].id === hoveredRowId,
		JSON.stringify({ hoveredRowId, ...hoverGrounds }),
	);
	note(
		"the ground under the pointer, on a control",
		JSON.stringify(hoverGrounds),
	);
	frames.push(await captureSettled(cdp, `row-hover${RUN_LABEL}`));

	/*
	 * 3. The search box with a query and the control OFF, then ON. The archived
	 * conversation is absent from the first and present in the second, and that
	 * difference is asserted as a MEASUREMENT (`[data-session-archived]` matches
	 * nothing, then matches a box) rather than left to the reader's eye.
	 */
	await parkPointer(cdp);
	await clickAt(cdp, '[aria-label="Search chats and agents"]');
	await cdp.send("Input.insertText", { text: "notes" });
	await wait(600);
	frames.push(await captureSettled(cdp, `search-off${RUN_LABEL}`));

	let archivedBefore = true;
	try {
		await verb(cdp, "measure", {
			selector: "[data-session-archived]",
			timeoutMs: 400,
		});
	} catch {
		archivedBefore = false;
	}
	check(
		"the archived conversation is NOT in the list while Include archived is off",
		archivedBefore === false,
		`[data-session-archived] ${archivedBefore ? "matched a row" : "matched nothing"}`,
	);

	await clickAt(cdp, "#chat-search-include-archived");
	await wait(600);
	const archivedAfter = await verb(cdp, "measure", "[data-session-archived]");
	check(
		"turning the control on puts the archived conversation in the list, marked",
		archivedAfter.inViewport === true,
		JSON.stringify(archivedAfter),
	);
	frames.push(await captureSettled(cdp, `search-on${RUN_LABEL}`));

	/*
	 * THE BOX IS CLEARED before the surfaces below, and it is a fact about the
	 * instrument rather than a courtesy: a query FILTERS the list, so a row the next
	 * steps press is not drawn while `notes` is still in the box - measured here as
	 * the refusal step failing to find its control after ten seconds of waiting.
	 */
	await clickAt(cdp, '[aria-label="Clear search"]');
	await wait(400);

	/*
	 * 4. The one permanent delete, through the surface that owns it: the header's
	 * conversation menu asks, and the dialog is what confirms. Two presses, and the
	 * frame is the state between them. The command's own confirmation is the SAME
	 * dialog (a typed `/delete` stages the same candidate), which is why this frame
	 * is the frame for both routes.
	 */
	await parkPointer(cdp);
	await verb(cdp, "navigate", "/chat/2d5ad5da0025");
	await clickAt(cdp, '[aria-label="Conversation actions"]');
	await wait(300);
	await clickAt(cdp, "[data-session-delete]");
	await wait(400);
	const dialog = await verb(cdp, "measure", '[role="dialog"]');
	check(
		"the delete confirmation is open on the conversation the menu was opened on",
		dialog.inViewport === true,
		JSON.stringify(dialog),
	);
	frames.push(await captureSettled(cdp, `delete-dialog${RUN_LABEL}`));

	/*
	 * 5. Closing the dialog (UX round 1, U9). The menu ITEM that opened it is
	 *    unmounted with the menu, so the successor control of the same act is the
	 *    header's own trigger - and the staged candidate must be gone, or the next
	 *    route would open the same question unbidden.
	 */
	await clickAt(cdp, "[data-cancel-action]");
	await wait(300);
	const trigger = await verb(cdp, "measure", "[data-conversation-actions]");
	check(
		"closing the delete dialog hands the keyboard back to the control that opened it",
		trigger.focused === true,
		JSON.stringify(trigger),
	);
	let dialogStillOpen = true;
	try {
		await verb(cdp, "measure", {
			selector: '[role="dialog"]',
			timeoutMs: 400,
		});
	} catch {
		dialogStillOpen = false;
	}
	check(
		"and cancelling clears the staged candidate, so no dialog waits on the next route",
		dialogStillOpen === false,
		"a dialog was still in the document after Cancel",
	);

	/*
	 * 6. The delete REFUSED (design round 1, D3). The stub answers the route's own
	 *    409 for a conversation a live session claims, so the dialog that asked stays
	 *    up over the sentence the backend authored plus the remedy this window can
	 *    actually offer (UX round 1, U3) - and the keyboard must be back on CANCEL,
	 *    because the press that was refused left it on the destructive button.
	 */
	await verb(cdp, "navigate", "/chat/7c1b0f2a4d31");
	await wait(400);
	await clickAt(cdp, '[aria-label="Conversation actions"]');
	await wait(300);
	await clickAt(cdp, "[data-session-delete]");
	await wait(300);
	await clickAt(cdp, "[data-confirm-action]");
	await wait(600);
	const refusedDialog = await verb(cdp, "measure", '[role="dialog"]');
	const cancelHolds = await verb(cdp, "measure", "[data-cancel-action]");
	check(
		"the refused delete stays in the dialog that asked it",
		refusedDialog.inViewport === true,
		JSON.stringify(refusedDialog),
	);
	check(
		"and the refusal leaves the keyboard on the SAFE action, not the destructive one",
		cancelHolds.focused === true,
		JSON.stringify(cancelHolds),
	);
	frames.push(await captureSettled(cdp, `delete-refused${RUN_LABEL}`));
	await clickAt(cdp, "[data-cancel-action]");
	await wait(300);

	/*
	 * 7. The archive REFUSED. A refused press reports in the panel's own toast lane
	 *    rather than in a dialog it never opened, with the Retry that re-sends the
	 *    DESIRED state (design round 1, D3; the lane is design D11 of
	 *    `docs/design/sidebar-row-space.md`, which moved this sentence out of the
	 *    in-panel register the operator reported as "a weird awkward spot").
	 */
	await parkPointer(cdp);
	/*
	 * `previous` is OPENED first, and IDEMPOTENTLY: a collapsed section draws no rows,
	 * and the row this step presses lives there (measured: the refusal step could not
	 * find its control while the section was collapsed). It is `openSection`, which
	 * reads the heading's `aria-expanded` and returns when it is already open, rather
	 * than the toggle press it used to be - step 2 opens this section, so a blind toggle
	 * here CLOSED it and the row went out of the DOM (measured 2026-09-21: `nothing
	 * matches [aria-label='Archive "Migration checklist"']`).
	 */
	await openSection(cdp, "Previous chats");
	const claimedRow = "[aria-label='Archive “Migration checklist”']";
	/*
	 * THE ROW FIRST, THEN ITS CONTROL. The acts are `display`-switched (D3), so a
	 * control addressed at rest has a 0x0 box: the pointer lands on the padding edge,
	 * the press goes nowhere and - measured 2026-09-21 - NO archive request reaches the
	 * stub at all, so the lane has no refusal to draw and this step fails two checks
	 * later for a reason that is three steps back. `:has()` finds the row by the
	 * control's own label, so the two cannot drift apart.
	 */
	await hoverOver(cdp, `[data-session-row]:has(${claimedRow})`);
	await wait(300);
	await hoverOver(cdp, claimedRow);
	note(
		"row forensics, refusal step (the press that WORKS)",
		JSON.stringify(await rowForensics(cdp, REFUSED_ID)),
	);
	/*
	 * THE ROWS' OFFSETS BEFORE THE BAND EXISTS (QA round 3, Q-3), read here because the press
	 * below is what raises the message: the band is 0 at rest, so this is the "before" half of the
	 * one comparison D14's promise is about - the rows must keep these offsets when the band takes
	 * its height off the list's own bottom.
	 */
	const offsetsBeforeBand = await listAndRowOffsets(cdp);
	note(
		"the list and its rows BEFORE the band (Q-3)",
		JSON.stringify(offsetsBeforeBand),
	);
	/*
	 * WHO WRITES THE READER'S SCROLL AS THE BAND ARRIVES (QA round 4, Q-9). The committed note said
	 * `list.scrollTop = list.scrollHeight` gave 0 - it was read on a list whose band-0 box was 289
	 * against 288 of content, where nothing CAN scroll - and QA's scene reads 142 on the same head
	 * once the band's own box (147) is what overflows. The clause both readings serve is the
	 * designer's: NEITHER `scrollTop` IS WRITTEN. So the writes themselves are trapped here, on the
	 * element, with the stack of whatever made them: a value written on the arrival is a finding even
	 * when it happens to equal what was already there, which is why this is a trap rather than a
	 * comparison of two readings.
	 */
	const trapInstalled = await cdp
		.evaluate(`(() => {
			const el = document.querySelector('[data-sidebar-region="chats"]');
			if (el === null) return false;
			const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
			window.__scrollWrites = [];
			Object.defineProperty(el, 'scrollTop', {
				configurable: true,
				get() { return descriptor.get.call(this); },
				set(value) {
					window.__scrollWrites.push({
						value,
						from: descriptor.get.call(this),
						stack: (new Error().stack || '').split('\\n').slice(0, 8).join(' <- '),
					});
					descriptor.set.call(this, value);
				},
			});
			return true;
		})()`)
		.catch(() => false);
	await clickAt(cdp, claimedRow);
	await wait(600);
	const archiveFailure = await verb(cdp, "measure", SIDEBAR_TOAST);
	/*
	 * WHEN THE REFUSAL WENT UP, kept for the retry below: a lane message's life is
	 * measured from its own assertion, so a check about a RE-ASSERTION has to know how
	 * old the message it replaced was, or a disappearance cannot be attributed to the
	 * original clock rather than to the press (agent review round 2 - the retry).
	 */
	const refusalRaisedAt = Date.now();
	check(
		"a refused archive is reported in the panel's own toast lane, with its retry",
		archiveFailure.inViewport === true,
		JSON.stringify(archiveFailure),
	);
	/*
	 * A TOAST CANNOT BE PHOTOGRAPHED BY `captureSettled`, whose contract is a frame
	 * with no toast on it: the two frames this set takes OF the toast carry their own
	 * checks in `offerFrames` instead of being exempted from the assertions silently.
	 */
	/*
	 * WHAT THE CARD DOES TO THE ROWS UNDER IT (C: Q-1, R4-1, D11, U9 - four independent streams on
	 * one selector).
	 *
	 * The lane sits over the list and the card's BODY passes presses through - but the rules that
	 * say so were scoped `[data-type="info"]`, which is sonner's stamp of `toast.info`. This refusal
	 * is raised by `showWarningToast` -> `toast.warning`, so `data-type="warning"`, and it matched
	 * none of them: it kept `pointer-events: auto` and QA measured its band covering the acts zone
	 * of every other row in the fixture - a press loop skipping all three ("a lane card covers its
	 * acts"), so NO conversation could be archived from a row for the card's whole life. This is
	 * the reading that has to fail if that ever comes back: for each row the card overlaps, hover it
	 * so its acts exist, hit-test the archive control's own centre, and require the card's body not
	 * to be what a press there reaches.
	 *
	 * THE ASSERTION IS DELIBERATELY NARROWER THAN "the row's control receives it". A card BUTTON
	 * that happens to sit over a covered row's acts is the other half of the same defect (QA round
	 * 2, Q-2) and is NOT fixed here; the note below prints which control answered, so that overlap
	 * is visible evidence rather than a silent pass.
	 */
	const cardBox = await verb(cdp, "measure", SIDEBAR_TOAST);
	const rowsUnderCard = await cdp.evaluate(
		`(() => {
			const card = document.querySelector(${JSON.stringify(SIDEBAR_TOAST)}).getBoundingClientRect();
			/*
			 * CLIPPED TO THE LIST'S OWN CLIENT BOX, which is what "under the card" means for a reader
			 * (measured 2026-09-22, QA round 3): a row inside the scroller below its client edge is
			 * clipped away by \`overflow-y\`, but its RECT still reaches into the band's area - so a
			 * rect-only test flagged two rows the moment the settled band grew to its real 142 and the
			 * list gave part of its height back. A row counts here only where it is DRAWN.
			 */
			const list = document.querySelector('[data-sidebar-region="chats"]').getBoundingClientRect();
			return Array.from(document.querySelectorAll("[data-session-row]"))
				.filter((row) => {
					const r = row.getBoundingClientRect();
					const top = Math.max(r.top, list.top);
					const bottom = Math.min(r.bottom, list.bottom);
					return bottom > top && bottom > card.top && top < card.bottom;
				})
				.map((row) => row.getAttribute("data-session-row"));
		})()`,
	);
	const reach = [];
	for (const id of rowsUnderCard) {
		await hoverOver(cdp, `[data-session-row="${id}"] [data-chat-row]`);
		await wait(400);
		const control = await verb(cdp, "measure", {
			selector: `[data-session-row="${id}"] [data-session-archive]`,
			timeoutMs: 1_500,
		}).catch(() => null);
		if (control === null || control.rect.width === 0) {
			reach.push({ id, reaches: "the acts are not laid out here" });
			continue;
		}
		reach.push({
			id,
			box: control.rect,
			...(await cdp.evaluate(
				`(() => {
					const el = document.elementFromPoint(${control.centre.x}, ${control.centre.y});
					if (!el) return { reaches: null };
					const path = [];
					for (let n = el; n && path.length < 5; n = n.parentElement) {
						path.push(n.tagName.toLowerCase() + (n.hasAttribute("data-session-archive") ? "[data-session-archive]" : "") + (n.hasAttribute("data-sonner-toast") ? "[data-sonner-toast]" : "") + (n.hasAttribute("data-button") ? "[data-button]" : "") + (n.hasAttribute("data-content") ? "[data-content]" : "") + (n.hasAttribute("data-session-row") ? "[data-session-row]" : ""));
					}
					return {
						reaches: path.join(" < "),
						cardBody: el.closest("[data-sonner-toast]") !== null && el.closest("[data-button], [data-close-button]") === null,
						ownControl: el.closest("[data-session-archive]") !== null,
					};
				})()`,
			)),
		});
	}
	await parkPointer(cdp);
	/*
	 * THE CARD IS A BAND, SO THE ACCEPTANCE READING IS THE EMPTY SET (design round 4, D14), and
	 * that replaces the narrower rule this check used to carry. The history it answers: as an
	 * overlay the card covered the acts zone of every row in the fixture - QA's press loop skipped
	 * all three - and the rules that passed presses through were scoped `[data-type="info"]` while
	 * this refusal is `toast.warning`, so the card's body swallowed them; four streams landed on
	 * that one selector, and the designer's ruling settled it as geometry rather than as an offset:
	 * the acts column is the row's last 52px and the card is 8px wider than the row, so there is no
	 * position that clears a covered control.
	 *
	 * THE BAND: height 0 at rest, `card + 8` while a message stands, taken out of the panel column
	 * with the ROWS UNMOVED (the list yields its bottom; `scrollTop` is never written) - AND THAT IS
	 * READ, not restated, because the assembly this ruled on did not do it (QA round 3, Q-3): the
	 * offsets are compared before and after the band appears by the check below. So the
	 * reading the ruling asks for is exactly this scan, and it must be EMPTY. The per-row loop
	 * below stays as the belt-and-braces half rather than as the assertion: if a row ever IS
	 * covered again, the reading names the control a press there would reach, which is the shape
	 * Q-1 and Q-2 were both found in, and the second check says so without pretending an empty
	 * loop proves anything.
	 */
	check(
		"no row's box is covered by the card (design round 4, D14): the covered-row scan returns the empty set",
		rowsUnderCard.length === 0,
		JSON.stringify({ card: cardBox.rect, rowsUnderCard, reach }),
	);
	check(
		"and if one ever were: the card's own body does not swallow a press aimed at it (C: Q-1, R4-1, D11, U9)",
		reach.every((entry) => entry.cardBody !== true),
		JSON.stringify({ reach }),
	);
	/*
	 * AND THE BAND PAYS EXACTLY THE CARD'S HEIGHT PLUS THE GAP, measured against the drawn card
	 * rather than against the offer's constant: the offer is one line at every width, the refusal
	 * is not, and a band sized for one of them would either clip the other or spend its rows. The
	 * tolerance is a pixel for the rounding of two device-pixel ratios, not a range.
	 */
	const bandBox = await verb(cdp, "measure", "[data-archive-toast-band]").catch(
		null,
	);
	/*
	 * BOTH BOXES ARE RE-READ AFTER THE CARD SETTLES, and this head's measurements say what that
	 * settle can and cannot buy. Sonner animates the card's own height (`transition: ... height
	 * .4s`), so a band read immediately after the message arrives describes a card that is still
	 * growing - the first full dark walk of this head read `band 34, card 34` there against a
	 * refusal that settles at 142 and a band at 150. THE CLOCK WAIT IS GONE (QA round 3, Q-6, and this paragraph was
	 * its own remedy). The pair is now POLLED with a rendering update driven per attempt
	 * (`settleBandReading`, whose frame driver is the same `Page.captureScreenshot` the capture
	 * helpers use), so the check stops on the invariant it asserts - band = card + gap - rather than
	 * on elapsed time. That is not a tidy-up: the old shape's PASS depended on whatever screenshot
	 * loop happened to precede it, and on a run where nothing drove a frame the pair was still
	 * `34 / 34` after the wait, which is a SPURIOUS FAIL of a check whose subject is fine. The app
	 * also sizes the band from the card's SETTLED height now (`--initial-height`, QA round 3's Q-4),
	 * so the loop exits on its first attempt in the ordinary case.
	 *
	 * The PAIRING is the whole assertion (D14: the band is the card's height plus the gap), so the
	 * two numbers have to describe the same moment.
	 */
	/*
	 * THE CLOCK WAIT STANDS, AND Q-6 IS OWED RATHER THAN HALF-DONE (measured 2026-09-22, this
	 * pass): an invariant-driven loop was tried here - poll the pair, drive a frame per attempt -
	 * and it cost up to 12 screenshots with a 120ms gap, about 26s across the two places it ran.
	 * That is longer than the lane's own message life, so the loop outlived the card it was
	 * waiting for: the second call read `{"band":{"height":0},"card":null}` and the step's own
	 * frames lost their message (`nothing matches ... [data-toast] [data-button] after 10000ms`).
	 * The settle must be bounded by the faster of the two clocks - the card's animation (~400ms)
	 * and the message's life - and that bound needs measuring rather than guessing, so the clock
	 * wait stays with its known spurious-FAIL mode and the fix is recorded as owed on the PR.
	 */
	const settled = await awaitCardSettled(cdp);
	const settledBand = await verb(
		cdp,
		"measure",
		"[data-archive-toast-band]",
	).catch(() => null);
	const settledCard = settled.reading;
	/*
	 * AND THE CARD'S OWN OVERFLOW, WHICH IS D19's READING rather than a box: a scrollbar on a toast is
	 * a visible defect, and the horizontal one came free with `overflow-y: auto` - CSS computes the
	 * other axis to `auto` as soon as one axis is not `visible` - so every card drew a ~9px strip
	 * along its bottom in its own border colour from D14 to that fix. `horizontalStrip` is what the
	 * card's box reserves beyond its client box, so 2 is two borders and anything larger is a strip
	 * a reader can see; `scrollWidth > clientWidth` is the content that used to overhang (the close
	 * button's own out-of-box transform) and `overflowX: "hidden"` is what now clips it.
	 */
	const cardOverflow = await cdp
		.evaluate(`(() => {
			const node = document.querySelector(${JSON.stringify(SIDEBAR_TOAST)});
			if (node === null) return null;
			const style = getComputedStyle(node);
			return {
				overflowX: style.overflowX,
				scrollWidth: node.scrollWidth,
				clientWidth: node.clientWidth,
				horizontalStrip: node.offsetHeight - node.clientHeight,
			};
		})()`)
		.catch(() => null);
	note("the card's own overflow (D19)", JSON.stringify(cardOverflow));
	/*
	 * THE PANEL THE CARD IS MEASURED IN, read once here because D15's question is a box in a box:
	 * a card height without the panel it was measured at is the figure the document already had.
	 */
	const refusalPanel = (await verb(cdp, "measure", 'nav[aria-label="Chats"]'))
		.rect;
	check(
		"the band's height is the card's plus the gap, so the list gives up exactly what the message spends (design round 4, D14)",
		settledBand !== null &&
			settledCard !== null &&
			settledCard.rect.width > 0 &&
			Math.abs(settledBand.rect.height - (settledCard.rect.height + 8)) <= 1,
		JSON.stringify({
			band: settledBand?.rect ?? null,
			card: settledCard?.rect ?? null,
		}),
		/*
		 * AND THE SAME TWO BOXES ON THE PASS SIDE, WITH THE PANEL THEY SIT IN (design round 4,
		 * D15): the design round's ruling sizes the band by the card's MEASURED height, and until
		 * this reading existed its only figures for the tallest card - the refusal - were the
		 * document's `216x170` and `216x206`, both stale in x once D10's `min(248px, 100%)` widened
		 * the refusal from 216 to 248 at this panel. So the refusal's box is a reading a green run
		 * prints, beside the panel it is drawn in, and not only a failure's explanation.
		 */
		JSON.stringify({
			band: settledBand?.rect ?? null,
			card: settledCard?.rect ?? null,
			gap: 8,
			panel: refusalPanel,
		}),
	);
	/*
	 * AND THE FRAME IS TAKEN AT THAT SAME SAMPLE (QA round 3's D17). The settle gates the BOX
	 * READING, not the capture, and that is how the dark refusal frame came back mid-replacement:
	 * a 58-tall card with its title gone, in a frame set a reader would read as the refusal's shape.
	 * One moment, one pair of numbers, one frame - the capture right after the settled box read, so
	 * a frame and the reading beside it cannot describe different cards.
	 */
	offerFrames.push({
		label: `archive-refused${RUN_LABEL}`,
		...(await captureWithToast(cdp, `archive-refused${RUN_LABEL}`)),
		settleAttempts: settled.attempts,
		toastOnScreen: (await drawnSelector(cdp, SIDEBAR_TOAST)) === true,
	});
	const scrollWrites = await cdp
		.evaluate("(() => window.__scrollWrites || [])()")
		.catch(() => []);
	note(
		"who writes the list's scroll while the band arrives (QA round 4, Q-9)",
		JSON.stringify({ trapInstalled, writes: scrollWrites }),
	);
	check(
		"and the band's arrival does not write the reader's scroll: the list's own `scrollTop` is never set as the message lands (design round 6's Q-3 ruling; QA round 4, Q-9)",
		trapInstalled === true &&
			Array.isArray(scrollWrites) &&
			scrollWrites.length === 0,
		JSON.stringify({ trapInstalled, writes: scrollWrites }),
	);
	/*
	 * AND THE YIELD IS READ AS THE COMPARISON IT IS (QA round 3, Q-3 = design round 4, D20), which
	 * is the half D14 never measured: the check above pins the band's SIZE, this one pins WHERE the
	 * height comes from. The promise is that the band is taken off the LIST's own bottom with the
	 * rows unmoved and `scrollTop` never written; the committed assembly gave it back out of the
	 * entity region ABOVE instead, whose height IS the list's top, so every row rode up by the
	 * band's height (measured: -150 at the settled refusal, -34/-58 mid-entrance, -144 at the short
	 * window, the list's own height never changing). Two readings - one before the message existed,
	 * one now: same rows at the same offsets, the same scroll, and, when the list was at its cap,
	 * exactly the band's height less box. A list that was NOT capped has nothing to give and keeps
	 * its height; what it may never do is move its rows.
	 */
	const offsetsAfterBand = await listAndRowOffsets(cdp);
	note(
		"the list and its rows AFTER the band (Q-3)",
		JSON.stringify(offsetsAfterBand),
	);
	const rowsHeld = sameTops(
		offsetsBeforeBand.rows.map((r) => ({ id: `row:${r.id}`, top: r.top })),
		offsetsAfterBand.rows.map((r) => ({ id: `row:${r.id}`, top: r.top })),
	);
	/*
	 * THE ACCEPTANCE READING IS THE DESIGNER'S OWN SENTENCE (design round 6's Q-3 ruling, shape
	 * (b)), and it is deliberately about the WHOLE COLUMN rather than about the list: every row's
	 * top in BOTH regions byte-equal to the band-0 frame, both `scrollTop`s untouched, the entity
	 * region's box unchanged, and the list's own height down by EXACTLY the band. The last two are
	 * what separate the yield from the defect QA round 3 measured: a list translated up with its
	 * height unchanged passes a rows-only reading in the short list, and an entity region that paid
	 * the band passes it too while every row rides up.
	 */
	const entityBoxHeld =
		offsetsBeforeBand.entities !== null &&
		offsetsAfterBand.entities !== null &&
		offsetsBeforeBand.entities.top === offsetsAfterBand.entities.top &&
		offsetsBeforeBand.entities.height === offsetsAfterBand.entities.height;
	const entityRowsHeld =
		offsetsBeforeBand.entities !== null &&
		offsetsAfterBand.entities !== null &&
		sameTops(offsetsBeforeBand.entities.rows, offsetsAfterBand.entities.rows);
	const scrollHeld =
		offsetsAfterBand.list.scrollTop === offsetsBeforeBand.list.scrollTop &&
		(offsetsBeforeBand.entities?.scrollTop ?? 0) ===
			(offsetsAfterBand.entities?.scrollTop ?? 0);
	const yieldExact =
		offsetsAfterBand.list.height ===
		Math.max(0, offsetsBeforeBand.list.height - offsetsAfterBand.band);
	check(
		"the band comes out of the LIST's own box, the column's bottom-most region here: every row in both regions keeps its top, both scrollTops are untouched, the entity region keeps its box to the pixel, and the list's own height loses exactly the band (design round 6's Q-3 ruling, shape (b))",
		rowsHeld &&
			entityBoxHeld &&
			entityRowsHeld &&
			scrollHeld &&
			yieldExact &&
			offsetsAfterBand.band > 0,
		JSON.stringify({
			rowsHeld,
			entityBoxHeld,
			entityRowsHeld,
			scrollHeld,
			yieldExact,
			before: offsetsBeforeBand,
			after: offsetsAfterBand,
		}),
	);
	/*
	 * AND THE SAME LIST SCROLLED TO ITS BOTTOM, WHICH IS THE OVERFLOWING CASE AND THE ONE THIS FIX
	 * IS FOR (design round 6's Q-3 ruling; QA round 4 closed the reading this check used to owe).
	 *
	 * The committed note here claimed `list.scrollTop = list.scrollHeight` returned 0 and left the
	 * case unasserted. It was read on a list whose band-0 box is 289 against 288 of content, where
	 * nothing can scroll; once the band's own box (147) is what overflows, the same assignment gives
	 * 142 - measured at this head, verbatim `{"scrolledBy":142,"setBottom":142}` with the rows moving
	 * by exactly that (688 -> 546, 764 -> 622, 796 -> 654, 828 -> 686) while the entity region holds
	 * its box and its scroll. So the region IS the scroller, and this is the check the note owes: the
	 * list takes the scroll, the region above it does not move, and the band is unchanged.
	 */
	const bottomBefore = await listAndRowOffsets(cdp);
	const setBottom = await cdp
		.evaluate(`(() => {
			const list = document.querySelector('[data-sidebar-region="chats"]');
			list.scrollTop = list.scrollHeight;
			return Math.round(list.scrollTop);
		})()`)
		.catch(() => null);
	const bottomAfter = await listAndRowOffsets(cdp);
	const scrolledBy = bottomAfter.list.scrollTop - bottomBefore.list.scrollTop;
	const heldWhileScrolled =
		bottomAfter.band === bottomBefore.band &&
		bottomAfter.list.height === bottomBefore.list.height &&
		(bottomAfter.entities?.top ?? null) ===
			(bottomBefore.entities?.top ?? null) &&
		(bottomAfter.entities?.height ?? null) ===
			(bottomBefore.entities?.height ?? null) &&
		(bottomAfter.entities?.scrollTop ?? 0) ===
			(bottomBefore.entities?.scrollTop ?? 0);
	const rowsFollowTheScroll =
		scrolledBy > 0 &&
		bottomBefore.rows.every((row) => {
			const now = bottomAfter.rows.find((r) => r.id === row.id);
			return now === undefined || Math.abs(row.top - now.top - scrolledBy) <= 1;
		});
	check(
		"and with the overflowing list scrolled to its bottom only the LIST moves: the entity region's box and scroll are byte-equal, the list's own box and the band are unchanged, and its rows move by exactly the scroll (design round 6's Q-3 ruling, the overflowing case)",
		heldWhileScrolled && rowsFollowTheScroll,
		JSON.stringify({
			scrolledBy,
			setBottom,
			heldWhileScrolled,
			rowsFollowTheScroll,
			before: {
				list: bottomBefore.list,
				entities: bottomBefore.entities,
				band: bottomBefore.band,
			},
			after: {
				list: bottomAfter.list,
				entities: bottomAfter.entities,
				band: bottomAfter.band,
			},
		}),
	);
	/*
	 * THE BAND'S LARGEST CASE, MEASURED RATHER THAN QUOTED (design round 4, D15). The band's
	 * height is the card's own plus the gap, and the tallest card this lane can draw is the
	 * refusal - so this pair IS the number the ruling needs. The EARLY box is kept beside it
	 * because the two are different readings rather than one: what is measured before the settle
	 * is a card mid-transition (this head's first dark walk read `band 34, card 34` there), and
	 * quoting that as the refusal's height is the mistake the settle exists to prevent.
	 */
	note(
		"the refusal in the panel's lane: the early box, and the pair once both settled (design round 4, D15)",
		JSON.stringify({
			early: bandBox?.rect ?? null,
			settled: {
				band: settledBand?.rect ?? null,
				card: settledCard?.rect ?? null,
				gap: 8,
				panel: refusalPanel,
			},
		}),
	);
	note(
		"what a press at each covered row's archive control reaches",
		JSON.stringify(reach),
	);
	/*
	 * AND THE REFUSAL'S OWN RETRY RE-ASSERTS IT (UX report round 1, U3), which it did NOT:
	 * the action fired, the message went away, and nothing replaced it - the lane empty at
	 * +4.2s with the row still un-archived and the write still refused, in three runs and
	 * both palettes. The cause was the lane's stable id plus a dismissal: the retry took
	 * its own message down, the answer arrived in 2-4ms, and a create landing inside
	 * sonner's unmount window is destroyed with the entry being removed (measured in the
	 * running app, in the installed sonner 2.0.3, and in the store - the mechanism is
	 * written out beside the Retry action and in the store's press).
	 *
	 * This is the field that would have caught it: the refusal must be on screen again
	 * after the retry, with its own action still the element a press would reach.
	 *
	 * AND THE PAINTED TOAST ALONE CANNOT SAY THAT (agent review round 2, R2-2), which is why
	 * the reading below is in two halves. The retry's message is the SAME message the press
	 * started from - same id, same sentence, same action - and the lane draws a replacement
	 * as an UPDATE of the mounted element, so a build where the answer never reached the
	 * lane is pixel-identical to the fixed one as long as the old refusal is still up (and
	 * by design it is: `chat-sidebar.tsx` holds it while the retry is in flight). A DOM-only
	 * instrument cannot tell those apart by construction.
	 *
	 * The freshness half is the app's own state: pressing Retry takes the store's next write
	 * stamp and its answer leaves a refusal naming this conversation, so the attempt must
	 * ADVANCE across the press and the refusal must be about the row that was pressed. That
	 * is what a "the answer re-asserted it" claim needs; the painted/`hitTest` fields stay
	 * as the placement claim, and the check requires both.
	 */
	const beforeRetry = await verb(cdp, "state");
	const retryPressedAt = Date.now();
	await clickAt(cdp, `${SIDEBAR_TOAST} [data-button]`);
	/*
	 * THE TRANSITION IS SAMPLED AT 60ms, NOT INFERRED FROM THE WINDOW'S END (agent review
	 * round 2 - the retry's disappearance). A dismissal and a container teardown read
	 * identically after the fact, and two things only a sampler can see tell them apart:
	 * sonner marks a dismissed node `data-removed` for `TIME_BEFORE_UNMOUNT` (200ms in the
	 * installed 2.0.3) before it leaves the DOM, and a teardown takes the
	 * `<section data-sonner-toaster>` itself with it - sonner renders that section whenever
	 * its Toaster is MOUNTED, so its absence is a React unmount rather than an empty store.
	 * The sampler keeps every sample, the LAST one that still held the lane's node, the
	 * FIRST that did not, and whether `data-removed` was ever seen.
	 */
	const samples = [];
	let retried = null;
	let lastWithLane = null;
	let firstVanished = null;
	let removedSeen = false;
	let retryState = beforeRetry;
	const windowEndsAt = retryPressedAt + 5_000;
	let sampleIndex = 0;
	while (Date.now() < windowEndsAt) {
		const sample = await cdp.evaluate(`(() => {
			const laneToaster = document.querySelector('nav[aria-label="Chats"] [data-sonner-toaster]');
			const toast = document.querySelector(${JSON.stringify(SIDEBAR_TOAST)});
			const button = toast ? toast.querySelector("[data-button]") : null;
			const box = toast ? toast.getBoundingClientRect() : null;
			const action = button ? button.getBoundingClientRect() : null;
			return {
				laneToaster: laneToaster !== null,
				toasters: document.querySelectorAll("[data-sonner-toaster]").length,
				nodes: document.querySelectorAll("[data-sonner-toast]").length,
				removed: document.querySelectorAll('[data-sonner-toast][data-removed="true"]').length,
				painted: box ? box.width > 0 && getComputedStyle(toast).display !== "none" : false,
				text: toast ? (toast.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 48) : null,
				action: button ? (button.textContent || "").trim() : null,
				hitTest: action
					? document.elementFromPoint(
							action.left + action.width / 2,
							action.top + action.height / 2,
						) === button
					: false,
				panel: document.querySelector('nav[aria-label="Chats"]') !== null,
				root: document.querySelector("#root") !== null,
			};
		})()`);
		sample.at = Date.now() - retryPressedAt;
		samples.push(sample);
		retried = sample;
		if (sample.removed > 0) removedSeen = true;
		if (sample.painted === true) lastWithLane = sample;
		else if (firstVanished === null) firstVanished = sample;
		/*
		 * The store is read on every eighth sample rather than every sample: a read is a round
		 * trip through the dev driver, and the answer this check needs (the press advanced the
		 * stamp and the refusal names this row) is settled inside the first 500ms.
		 */
		if (sampleIndex % 8 === 0) retryState = await verb(cdp, "state");
		sampleIndex += 1;
		retried.answeredAgain =
			typeof beforeRetry?.archiveAttempts === "number" &&
			typeof retryState?.archiveAttempts === "number" &&
			retryState.archiveAttempts > beforeRetry.archiveAttempts &&
			retryState.archiveFailure?.sessionId === REFUSED_ID;
		retried.attempts = `${beforeRetry?.archiveAttempts} -> ${retryState?.archiveAttempts}`;
		if (sample.painted === true && retried.answeredAgain === true) break;
		await wait(60);
	}
	retried.samples = samples.length;
	retried.removedSeen = removedSeen;
	/*
	 * SUMMARISED, NOT KEPT BY REFERENCE: the last sample that still held the lane is often
	 * the very object the verdict reports, and a back-reference to it is a circular structure
	 * the check's own `JSON.stringify` refuses (measured: `property 'lastWithLane' closes the
	 * circle`). The fields below are the ones a reader needs - when, what the DOM held, and
	 * whether the panel and the root were still there beside it.
	 */
	const summarise = (sample) =>
		sample === null || sample === undefined
			? null
			: {
					at: sample.at,
					painted: sample.painted,
					laneToaster: sample.laneToaster,
					toasters: sample.toasters,
					nodes: sample.nodes,
					removed: sample.removed,
					action: sample.action,
					panel: sample.panel,
					root: sample.root,
				};
	retried.lastWithLane = summarise(lastWithLane);
	retried.firstVanished = summarise(firstVanished);
	retried.failure = retryState?.archiveFailure
		? {
				sessionId: retryState.archiveFailure.sessionId,
				archived: retryState.archiveFailure.archived,
			}
		: null;
	/*
	 * WHAT THE ANSWER ACTUALLY PRODUCED, INSTEAD OF A FIELD THAT COULD NEVER BE FILLED (nit,
	 * round 2). This read `archiveUndo` and was null in every run: the retry's answer raises an
	 * offer only when it ACCEPTS, and this fixture's daemon refuses this conversation's writes
	 * every time - so the reading was dead evidence shaped like a live one. The answer this
	 * fixture gives is another refusal for the SAME row, and it is asserted below rather than
	 * left for a reader to notice; a daemon that accepted would fail that assertion, which is the
	 * honest thing for a reading of the fixture to do.
	 */
	retried.answer =
		retryState?.archiveFailure?.sessionId === REFUSED_ID
			? "another refusal for this row"
			: retryState?.archiveUndo
				? "an offer for this row"
				: "neither shape";
	check(
		"a refused retry puts the refusal back in the lane, with its Retry still pressable, and the store answered a NEW press with a refusal for this row (UX round 1, U3; freshness from agent review round 2, R2-2)",
		retried?.painted === true &&
			retried?.action === "Retry" &&
			retried?.hitTest === true &&
			retried?.answeredAgain === true &&
			retried?.answer === "another refusal for this row",
		`${Date.now() - retryPressedAt}ms after the retry (refusal raised ${retryPressedAt - refusalRaisedAt}ms before the press): ${JSON.stringify(retried)}`,
	);

	/*
	 * THE TRANSITION, BESIDE THE VERDICT: the last 60ms sample that still held the lane's node
	 * and the first that did not, with the container counts each saw. A dismissal shows
	 * `removed > 0` on the way out and leaves the toaster's own section mounted; a teardown
	 * shows `toasters: 0`, which neither a dismissal nor an empty store can produce (sonner
	 * renders that section whenever its Toaster is mounted).
	 */
	const transition = {
		samples: retried?.samples ?? 0,
		removedSeen: retried?.removedSeen ?? null,
		lastWithLane: retried?.lastWithLane ?? null,
		firstVanished: retried?.firstVanished ?? null,
	};
	console.log(`[note] retry transition\n        ${JSON.stringify(transition)}`);

	/*
	 * U10, THE SEQUENCE THAT FAILED (UX round 3), AND THE ASSERTION IS ABOUT WHAT DOES *NOT*
	 * COME BACK. A refusal stands for the refused conversation; a NEWER message then takes the
	 * lane (a second conversation's archive raises its offer); the reader presses that offer's
	 * own Undo; the lane goes empty. The defect was what happened next: the SUPERSEDED refusal,
	 * whose value was still in the store, was drawn again - lane empty at +450ms in the light
	 * palette, the refusal back at +1.75s dark / +450ms light - because the currency rule chose
	 * the newest word per commit while the clock cleared only the DRAWING, never the value.
	 *
	 * THE FIX IS READ IN TWO PLACES, and the first is the mechanism rather than the symptom: the
	 * moment the offer supersedes the refusal, the refusal's value must be gone (that is what
	 * makes it un-re-printable), and then the lane must stay empty through both of the moments the
	 * return was measured at. A red run here with the first clause green is the old defect back:
	 * the value outliving its message.
	 *
	 * B IS THE ROW THIS SCENE ARCHIVES LATER ANYWAY, and the sequence puts it back through the
	 * offer's own Undo - so the fixture this step hands on is the fixture it found.
	 */
	const refusedStanding = await verb(cdp, "state");
	check(
		"U10 precondition: the refused conversation's refusal is what the lane is showing",
		refusedStanding.archiveFailure?.sessionId === REFUSED_ID &&
			(await drawnSelector(cdp, SIDEBAR_TOAST)) === true,
		JSON.stringify({
			failure: refusedStanding.archiveFailure ?? null,
			undo: refusedStanding.archiveUndo ?? null,
		}),
	);
	const supersedingOffer = "[aria-label='Archive “Release notes for 0.29”']";
	/*
	 * THE ROW COMES INTO VIEW, THEN THE ROW IS HOVERED, THEN THE CONTROL - and the first of the
	 * three is something the band made necessary rather than tidy (design round 4, D14).
	 *
	 * The acts are `display`-switched, so a control is 0x0 until the pointer is on its row, and a
	 * `hoverOver` aimed at a 0x0 box moves the pointer nowhere useful; more importantly the band
	 * takes the card's own height out of the list, so with a 90px refusal standing the row this step
	 * aims at is at the list's newly-hidden bottom. Measured this pass, in both palettes: the press
	 * wrote NOTHING (`"undo": null` with the old refusal still in the store), while the same
	 * selector archived successfully ten steps later, once no message stood - which is what makes the
	 * clipping the cause rather than the label. A reader in that state scrolls the list; the scene
	 * does the same, and it is the SCENE's gesture: the app still never writes `scrollTop` itself.
	 */
	await cdp.evaluate(
		`(() => { const node = document.querySelector(${JSON.stringify(`[data-session-row]:has(${supersedingOffer})`)}); if (node) node.scrollIntoView({ block: "center" }); })()`,
	);
	await wait(200);
	await hoverOver(cdp, `[data-session-row]:has(${supersedingOffer})`);
	await wait(300);
	/*
	 * THE CONTROL IS WAITED FOR, NEVER HOVERED BLIND (the light-palette miss, diagnosed by reading):
	 * the acts are `display`-switched, so the control measures 0x0 until the pointer is on the row -
	 * and a `hoverOver` aimed at a 0x0 box sends the pointer to (0,0), which takes it OFF the row,
	 * un-reveals the acts, and leaves the press to land on a div outside every session row. Measured
	 * verbatim in light: `control {"x":0,"y":0,"w":0,"h":0}` with `hit:"div
	 * NOT-IN-A-SESSION-ROW"` while the row itself was `256x32` and present - i.e. the pointer had
	 * been moved off it by the step's own second hover. Dark passed the same code on timing alone.
	 * So: the row is hovered, the control's box is then POLLED until it has pixels (re-hovering the
	 * row each time, because that is what reveals it), and the press goes to the control's own centre
	 * once it exists. A control that never appears fails the check below by name rather than writing
	 * nothing and leaving the verdict to the next step.
	 */
	const supersedingCentre = await (async () => {
		for (let attempt = 0; attempt < 12; attempt += 1) {
			const box = await verb(cdp, "measure", supersedingOffer).catch(
				() => null,
			);
			if (box !== null && box.rect.width > 0 && box.rect.height > 0)
				return box.centre;
			await hoverOver(cdp, `[data-session-row]:has(${supersedingOffer})`);
			await wait(150);
		}
		return null;
	})();
	check(
		"the superseding row's archive control is revealed before the press (a press at a 0x0 box reaches nothing - the light-palette miss)",
		supersedingCentre !== null,
		JSON.stringify({
			centre: supersedingCentre,
			box: await verb(cdp, "measure", supersedingOffer).catch(() => null),
		}),
	);
	await wait(200);
	/*
	 * WHAT THE PRESS IS AIMED AT, SAMPLED RATHER THAN THEORISED - the dark palette runs this whole
	 * sequence green and the light palette's press writes NOTHING ("undo": null, the old refusal
	 * still in the store), so the difference has to be read. All three of this step's earlier
	 * defects were geometric (a `hoverOver` on a `display`-switched 0x0 control, the band clipping
	 * the row, an unquoted selector in the page script), which is why the sample is the three boxes
	 * that make up an aim: the row's, the control's, the point the press will use, and what the DOM
	 * answers AT that point - plus whether the element it answers with is inside a session row at
	 * all. It is reported with the verdict either way, so a palette that behaves differently is a
	 * reading on the PR rather than a theory in a comment.
	 */
	const aim = await cdp.evaluate(`(() => {
		const box = (el) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
		};
		const name = (el) => {
			if (!el) return null;
			const row = el.closest("[data-session-row]");
			return el.tagName.toLowerCase() + (el.hasAttribute("data-session-archive") ? "[data-session-archive]" : "") + (el.hasAttribute("data-sonner-toast") ? "[data-sonner-toast]" : "") + (el.closest("[data-button]") ? "[data-button]" : "") + (row ? " row:" + row.getAttribute("data-session-row") : " NOT-IN-A-SESSION-ROW");
		};
		const row = document.querySelector(${JSON.stringify(`[data-session-row]:has(${supersedingOffer})`)});
		const control = document.querySelector(${JSON.stringify(supersedingOffer)});
		const r = control ? control.getBoundingClientRect() : null;
		const centre = r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
		return {
			viewport: { w: window.innerWidth, h: window.innerHeight },
			row: box(row),
			control: box(control),
			centre,
			hit: centre ? name(document.elementFromPoint(centre.x, centre.y)) : null,
		};
	})()`);
	/* THE PRESS GOES AT LAST, AT THE CONTROL'S OWN CENTRE - the aim above was sampled before it,
	   which is the reading this step exists to report when the two palettes disagree. */
	if (supersedingCentre !== null)
		await pressPointerStationary(cdp, supersedingCentre.x, supersedingCentre.y);
	await wait(700);
	const superseded = await verb(cdp, "state");
	note(
		"U10 the aim at the superseding archive control, and the answer it produced",
		JSON.stringify({
			...aim,
			/*
			 * PRESENCE, NOT A FIELD: this printed `archiveUndo?.sessionId` and read null while the very
			 * next check asserted the same object non-null - the offer does not carry `sessionId`, so
			 * the note was the wrong half of the pair (manager's finding). What the check reads is
			 * whether the value is THERE, so that is what the note reports.
			 */
			undo: superseded.archiveUndo !== null,
			failure: superseded.archiveFailure?.sessionId ?? null,
		}),
	);
	check(
		"U10: the newer offer takes the lane AND the refusal it superseded is cleared with it, so it cannot be re-printed",
		superseded.archiveUndo !== null && superseded.archiveFailure === null,
		JSON.stringify({
			undo: superseded.archiveUndo
				? { sessionId: superseded.archiveUndo.sessionId }
				: null,
			failure: superseded.archiveFailure ?? null,
		}),
	);
	await clickAt(cdp, `${SIDEBAR_TOAST} [data-button]`);
	const afterRetire = [];
	for (const at of [450, 1750]) {
		await wait(at === 450 ? 450 : 1300);
		const lane = await verb(cdp, "state");
		afterRetire.push({
			at: `+${at}ms`,
			drawn: (await drawnSelector(cdp, SIDEBAR_TOAST)) === true,
			/*
			 * THE BAND GIVES THE ROWS BACK, which is the other half of D14's own reading: height
			 * 0 once the message is gone, so an empty lane costs the list nothing at all.
			 */
			bandHeight: Math.round(
				(
					await verb(cdp, "measure", "[data-archive-toast-band]").catch(
						() => null,
					)
				)?.rect.height ?? -1,
			),
			failure: lane.archiveFailure ?? null,
			undo: lane.archiveUndo ?? null,
		});
	}
	check(
		"U10: after the offer's own Undo the lane stays EMPTY - the refusal is not re-printed at +450ms or +1.75s, and the band gives the list back its height, in this palette",
		afterRetire.every(
			(reading) =>
				reading.drawn === false &&
				reading.bandHeight === 0 &&
				reading.failure === null &&
				reading.undo === null,
		),
		JSON.stringify(afterRetire),
	);
	note(
		"U10 the lane after the newer message retires",
		JSON.stringify(afterRetire),
	);

	/*
	 * AND THE REFUSAL GOES BACK, BECAUSE THIS STEP MOVED THE STATE THE NEXT STEPS ARE ABOUT. The
	 * walk above leaves a refusal standing, and the split-mode step after this one reads that
	 * refusal with the entity region gone - so a step that CLEARS it (which is exactly what the
	 * fix does with a superseded refusal) has to raise a fresh one rather than hand the next step
	 * an empty lane. It is the reader's own gesture, and the new refusal is asserted rather than
	 * assumed: a run whose daemon accepted this row would fail here, loudly, instead of three
	 * steps later for a reason nothing on screen explains.
	 */
	const refusedControl = "[aria-label='Archive “Migration checklist”']";
	await hoverOver(cdp, `[data-session-row]:has(${refusedControl})`);
	await wait(300);
	await hoverOver(cdp, refusedControl);
	await wait(200);
	await clickAt(cdp, refusedControl);
	await wait(700);
	const refusalBack = await verb(cdp, "state");
	check(
		"U10: the refusal this walk is about is standing again, so the steps after it read the state they were written against",
		refusalBack.archiveFailure?.sessionId === REFUSED_ID &&
			(await drawnSelector(cdp, SIDEBAR_TOAST)) === true,
		JSON.stringify({
			failure: refusalBack.archiveFailure?.sessionId ?? null,
			undo: refusalBack.archiveUndo ?? null,
		}),
	);
	/*
	 * AND IT IS REACHABLE WITH THE ENTITY REGION GONE (agent review round 4, R4-1).
	 * This is the mode the REGISTER was absent from at `3e650f5f0`: it had been
	 * re-parented into the entities region, and the assembly renders only the list
	 * region in `chats-only`, so the sentence and its Retry vanished in exactly the
	 * layout where the user is acting on chat rows. The lane cannot inherit that
	 * defect - it is mounted by the panel's root, above both regions - and this step
	 * is what keeps the claim a measurement rather than a reading of the JSX. The
	 * assertion is on the DRAWN node.
	 */
	/*
	 * AND IT IS REACHABLE WITH THE ENTITY REGION GONE. The mode comes from the
	 * panel's OWN collapse control, not from `setSplitPreferences`: that helper
	 * writes localStorage and RELOADS the page, which would clear the in-memory
	 * refusal this step is about (a refusal is not persisted). The control lives on
	 * the cluster, which is inert until the pointer reveals it - so the pointer is
	 * moved there first and the press goes to the control's own box, the idiom the
	 * split scene uses for the same control.
	 *
	 * THE MODE IS ASSERTED, NOT ASSUMED: a non-empty query forces `both` regions
	 * (`sidebar-split.ts`), so a step that merely hid nothing would pass this check
	 * while proving nothing. `[data-sidebar-region="entities"]` must be UNMOUNTED
	 * while the refusal is drawn - which is exactly the state the fold broke.
	 */
	/*
	 * THE PLATE IS REVEALED BEFORE THE PRESS, AND THE WARM-UP IS WHAT REVEALS IT (measured
	 * 2026-09-22). The control lives on the plate, which straddles the boundary's ZERO-HEIGHT
	 * band (`absolute -translate-y-1/2` inside `h-0`), and the band reveals that plate from its
	 * own `onPointerEnter`. A pointer that is already inside the 16px strip therefore fires NO
	 * enter when the walk moves it a few pixels onto the control's own centre, and the plate
	 * stays `pointer-events-none` - so the press passes through it and the region never
	 * unmounts, which is what this check then reads as `entitiesUnmounted:false`.
	 *
	 * THE PROBE THAT SETTLED IT (this run, then removed): the boundary's boxes read band
	 * `{y:421,height:0}`, strip `{top:413,bottom:429,height:16}`, separator `{top:416,bottom:426,
	 * height:10}`, control `{x:404,y:421,top:407,bottom:435,width:28}` - i.e. the control's own
	 * centre is ON the line - and EVERY sampled point (the line, +-3px, +-6px, at the band's
	 * centre and at the control's own x) revealed the plate, with `waitedMs` 250-340 and a hit
	 * test naming the separator at the middle three. So the aim is not what fails and the
	 * geometry is not what decides it: ARRIVING FROM OUTSIDE IS. `parkPointer` puts the pointer
	 * where it hovers nothing, and the move that follows is a real entry into the strip - the
	 * strip is 16px tall and the separator is the hit target over its own 10px, so the aim lands
	 * on the boundary by construction rather than by luck.
	 *
	 * THE REVEAL IS WAITED FOR AND THEN REQUIRED, so a future tip of this fails here, naming the
	 * reveal, rather than at the state check it would otherwise silently explain. The press
	 * still goes to the control's own box, which is interactive only once that reveal happened.
	 *
	 * THREE ATTEMPTS, the shape the row work above uses for the same class of question (hover,
	 * bounded wait, break when it is drawn - then the claim made exactly as written). It is not
	 * belt and braces: the boundary MOVES UNDER A SETTLING LAYOUT, because the lane's band below
	 * it changes height as the refusal arrives (measured on the same head: the band check read
	 * 34px - the offer's one-line card - where the settled refusal is 150), and an aim that was
	 * inside the strip when it was taken can be outside it a frame later, which is a
	 * `pointerleave` and a disarm rather than a reveal. Each attempt re-parks, because a real
	 * entry needs the pointer to come from outside the strip, and re-measures.
	 */
	const clusterRevealed = { ok: false, waitedMs: 0 };
	for (let attempt = 0; attempt < 3; attempt += 1) {
		await parkPointer(cdp);
		const boundary = await splitBox(cdp, SPLIT_SEPARATOR);
		require("the boundary this cluster hangs on is drawn", boundary !==
			null, "no separator: the split needs both regions");
		await movePointer(cdp, boundary.x, boundary.y);
		const read = await waitForCondition(
			cdp,
			`document.querySelector(${JSON.stringify(SPLIT_CLUSTER_REVEALED)}) !== null`,
			700,
			40,
		);
		clusterRevealed.ok = read.ok;
		clusterRevealed.waitedMs += read.waitedMs;
		if (read.ok === true) break;
	}
	require("the cluster's plate is revealed before its control is pressed", clusterRevealed.ok ===
		true, `the plate never revealed in ${clusterRevealed.waitedMs}ms after three attempts: the pointer did not enter the boundary`);
	const hideEntities = await splitBox(cdp, '[data-sidebar-hide="entities"]');
	require("the cluster's hide control is reachable", hideEntities !==
		null, "no [data-sidebar-hide=entities]");
	await pressPointerStationary(cdp, hideEntities.x, hideEntities.y);
	await wait(500);
	const entitiesUnmounted = await cdp.evaluate(
		`document.querySelector('[data-sidebar-region="entities"]') === null`,
	);
	const refusalChatsOnly = await verb(cdp, "measure", SIDEBAR_TOAST);
	const retryChatsOnly = await verb(
		cdp,
		"measure",
		`${SIDEBAR_TOAST} [data-button]`,
	);
	check(
		"the entity region is unmounted, and the refused archive with its Retry is still reachable",
		entitiesUnmounted === true &&
			refusalChatsOnly.inViewport === true &&
			retryChatsOnly.inViewport === true,
		JSON.stringify({ entitiesUnmounted, refusalChatsOnly, retryChatsOnly }),
	);
	offerFrames.push({
		label: `archive-refused-chats-only${RUN_LABEL}`,
		...(await captureWithToast(cdp, `archive-refused-chats-only${RUN_LABEL}`)),
		toastOnScreen: (await drawnSelector(cdp, SIDEBAR_TOAST)) === true,
	});
	const showEntities = await splitBox(cdp, '[data-sidebar-restore="entities"]');
	require("the restore row is drawn", showEntities !==
		null, "no restore row for the entity region");
	await movePointer(cdp, showEntities.x, showEntities.y);
	await wait(320);
	await pressPointerStationary(cdp, showEntities.x, showEntities.y);
	await wait(500);

	/*
	 * 8. The row's own hover with the pointer on the TITLE (design round 1, D5):
	 *    the pair with `row-hover` is what settles whether the row's highlight
	 *    survives the pointer leaving the control's 24px box.
	 */
	await parkPointer(cdp);
	/*
	 * SCOPED TO A SESSION ROW, because `[data-chat-row]` also matches SECTION HEADINGS - the
	 * catalogue's own reading names one (`button "Agents"`), and a heading is a full-width button
	 * (nit, round 2; the same confusion cost this walk three checks on 2026-09-21). Unscoped, this
	 * measured whatever heading came first and put the pointer sixty pixels into the PANEL's
	 * header rather than onto a row's title, which is the state the frame is supposed to be of.
	 */
	const titledRow = await verb(
		cdp,
		"measure",
		"[data-session-row] [data-chat-row]",
	);
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: titledRow.rect.x + 60,
		y: titledRow.centre.y,
		button: "none",
		buttons: 0,
	});
	frames.push(await captureSettled(cdp, `row-hover-body${RUN_LABEL}`));

	/*
	 * 9. The open conversation archived (design round 1, D2): the header's pill and
	 *    its restore control, with no dialog over them, and the pane still open on
	 *    the conversation - archive hides, it does not close. The press raises the
	 *    undo offer, so this frame is taken after that offer's OWN ceiling retires it:
	 *    the pill's ink is what a reviewer has to judge here, and the offer has its
	 *    own frame below.
	 */
	await parkPointer(cdp);
	await verb(cdp, "navigate", "/chat/2d5ad5da0025");
	await wait(400);
	await clickAt(cdp, '[aria-label="Conversation actions"]');
	await wait(300);
	await clickAt(cdp, "[data-session-archive-action]");
	/*
	 * THE OFFER'S CLOCK STARTS HERE, at the press that raises it, and the check below
	 * measures from this instant rather than from whenever it gets around to waiting.
	 * Sonner's duration starts when the toast MOUNTS, which is this press; the steps in
	 * between (hiding the entity region, reading the offer there, restoring it) spend
	 * ~2s of the 8s, so a wait that started after them could only ever see the tail and
	 * a `>=6000ms` claim against the tail is a claim about the scene's own timings.
	 */
	const offerRaisedAt = Date.now();
	await wait(500);
	const pill = await verb(cdp, "measure", "[data-session-archived-pill]");
	const openAfter = await verb(cdp, "state");
	check(
		"archiving the OPEN conversation adds the pill and leaves the pane open on it",
		pill.inViewport === true && openAfter.activeSessionId === "2d5ad5da0025",
		`${JSON.stringify(pill)} activeSessionId=${openAfter.activeSessionId}`,
	);
	/*
	 * THE OFFER IS THE PANEL'S OWN TOAST NOW, IN THE PANEL'S OWN LANE (design D11),
	 * so its clearance is read there. The retirement rule is unchanged and so is the
	 * property this check is about: the offer outlives the catalogue answers that
	 * mention the row and is retired by its own ceiling, not by the first answer to
	 * arrive. The wait below is the same wait; what changed is the element it waits
	 * on - and with it, the fact that the lane is mounted by the panel's root, so
	 * there is no assembly mode in which the offer is not drawn.
	 */
	/*
	 * THE OFFER IS REACHABLE THERE TOO (R4-1's other half): it used to be the same
	 * register and it was absent for the same reason. Asserted while it is still up,
	 * before the retirement wait below - and WITHOUT a frame, because the refusal's
	 * chats-only frame above already carries the placement.
	 */
	const hideForOffer = await splitBox(cdp, '[data-sidebar-hide="entities"]');
	require("the cluster's hide control is reachable", hideForOffer !==
		null, "no [data-sidebar-hide=entities]");
	await movePointer(cdp, hideForOffer.x, hideForOffer.y);
	await wait(320);
	await pressPointerStationary(cdp, hideForOffer.x, hideForOffer.y);
	await wait(500);
	const offerChatsOnly = await verb(cdp, "measure", SIDEBAR_TOAST);
	check(
		"the archive offer is reachable in chats-only",
		offerChatsOnly.inViewport === true,
		JSON.stringify(offerChatsOnly),
	);
	const showForOffer = await splitBox(cdp, '[data-sidebar-restore="entities"]');
	require("the restore row is drawn", showForOffer !==
		null, "no restore row for the entity region");
	await movePointer(cdp, showForOffer.x, showForOffer.y);
	await wait(320);
	await pressPointerStationary(cdp, showForOffer.x, showForOffer.y);
	await wait(500);
	const clearance = await waitForGone(cdp, SIDEBAR_TOAST, 20_000);
	/*
	 * WHAT "GONE" MEANS, read rather than assumed, because `waitForGone` answers
	 * `box.width > 0`: a toast that is still MOUNTED but not painted (hidden by the
	 * lane's own rule, say) is reported as retired, and those two facts have different
	 * owners. The reading below separates them, and it is the difference between
	 * "the offer was taken down" and "the offer stopped being drawn".
	 */
	const laneAfter = await cdp.evaluate(`(() => {
		const all = Array.from(document.querySelectorAll(${JSON.stringify(TOAST_SELECTOR)}));
		return all.map((n) => {
			const box = n.getBoundingClientRect();
			return {
				text: (n.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 28),
				cls: n.className,
				display: getComputedStyle(n).display,
				w: box.width,
				h: box.height,
				inLane: !!n.closest('nav[aria-label="Chats"]'),
				removed: n.getAttribute("data-removed"),
				mounted: n.getAttribute("data-mounted"),
			};
		});
	})()`);
	check(
		"the archive offer outlives the catalogue answers and is taken down by the lane's own duration",
		clearance.timedOut === false && Date.now() - offerRaisedAt >= 6_000,
		`the offer lived ${Date.now() - offerRaisedAt}ms from the press (the answers that mention the row arrive in 0.4-1.6s, the lane's duration is ${8_000}ms, and the wait for it to go began ${clearance.waitedMs}ms before it did); lane now ${JSON.stringify(laneAfter)} `,
	);
	/*
	 * AND THE OTHER ARM OF THE SAME RULE, WHICH THE BRANCH HAD STOPPED OBSERVING (agent
	 * review round 1, R-1). The check above is the offer's CEILING; the arm that says a
	 * flyout has to go the moment the client knows the state it was taken from has moved
	 * was observed nowhere after the scene was narrowed to accommodate it - and that is
	 * how a defect shipped in which the offer's retirement was gated on the STORE's
	 * `archiveFailure`, a value that outlives its own message: one refused archive (the
	 * step above, on a different conversation) left a still-pressable "Undo" on screen
	 * offering to re-archive a conversation the reader had just restored.
	 *
	 * This walks it: archive the open conversation again through the header's own menu,
	 * then restore it from the header's own control, and the offer must be gone well inside
	 * its 8s. It is a regression test for the defect rather than for the happy path, because
	 * the refusal step above has already set `archiveFailure` in this very run.
	 */
	const restoreControl = "[data-session-archived-pill] ~ button";
	await parkPointer(cdp);
	await clickAt(cdp, restoreControl);
	await wait(600);
	await clickAt(cdp, '[aria-label="Conversation actions"]');
	await wait(300);
	await clickAt(cdp, "[data-session-archive-action]");
	await wait(700);
	const raisedAgain = await verb(cdp, "measure", SIDEBAR_TOAST);
	check(
		"the second archive of the open conversation raises the offer again",
		raisedAgain.inViewport === true,
		JSON.stringify(raisedAgain),
	);
	const stateChangedAt = Date.now();
	await clickAt(cdp, restoreControl);
	let goneByStateChange = null;
	for (let attempt = 0; attempt < 24; attempt += 1) {
		await wait(250);
		/*
		 * THE OFFER, NOT "A TOAST" (this check's own triage, 2026-09-21). The lane draws one
		 * message and an earlier step leaves a REFUSAL standing in the store, so a probe that
		 * asks "is any lane toast painted" answers about that refusal and reports the offer as
		 * alive forever - which is what this check did at every head since the walk was
		 * written. The offer is the message whose action reads `Undo`; the refusal's reads
		 * `Retry`. The claim below is about the OFFER's retirement, so it asks that question.
		 */
		goneByStateChange = await cdp.evaluate(`(() => {
			const toast = document.querySelector(${JSON.stringify(SIDEBAR_TOAST)});
			if (!toast) return { painted: false, action: null };
			const r = toast.getBoundingClientRect();
			const button = toast.querySelector("[data-button]");
			return {
				painted: r.width > 0 && getComputedStyle(toast).display !== "none",
				action: button ? (button.textContent || "").trim() : null,
			};
		})()`);
		if (
			goneByStateChange?.painted === false ||
			goneByStateChange?.action !== "Undo"
		)
			break;
	}
	check(
		"the offer is retired by the STATE CHANGE rather than by its ceiling: restoring the conversation takes it down well inside the offer's own 8s (R-1)",
		(goneByStateChange?.painted === false ||
			goneByStateChange?.action !== "Undo") &&
			Date.now() - stateChangedAt < 8_000,
		`${Date.now() - stateChangedAt}ms after the restore, against the offer's own 8000ms ceiling: ${JSON.stringify(goneByStateChange)}`,
	);
	frames.push(await captureSettled(cdp, `header-archived${RUN_LABEL}`));

	/*
	 * 10. The row press, LAST because it is the frame that is OF a toast (design
	 *     round 1, D7): the same act as the header's and as a typed `/archive`, so it
	 *     makes the same offer (UX round 1, U2), and the keyboard lands on the row
	 *     that took the place of the one that left (UX round 1, U5).
	 */
	await parkPointer(cdp);
	/*
	 * No expansion click here: `Previous chats` was opened by the refusal step above
	 * and the sidebar PERSISTS its disclosures for the session, so a second click
	 * would COLLAPSE the section the row lives in - which is how this step failed
	 * the first time it ran. The order of these two steps is therefore load-bearing,
	 * and it is why the toggle is a hoisted ancestor of the row rather than a
	 * `data-chat-row` the scene could have scrolled to.
	 */
	const offeredRow = "[aria-label='Archive “Release notes for 0.29”']";
	/* The row first, for the reason the refusal step above records: a `display`-switched
	   control has no box until its row is under the pointer, and a press at a 0x0 box
	   goes nowhere at all. */
	await hoverOver(cdp, `[data-session-row]:has(${offeredRow})`);
	await wait(300);
	await hoverOver(cdp, offeredRow);
	await clickAt(cdp, offeredRow);
	await wait(500);
	const successor = await verb(cdp, "measure", "[data-chat-row]:focus").catch(
		null,
	);
	/*
	 * THE SCOPE THIS SELECTOR LACKS IS THE FINDING, AND IT IS NOW ASSERTED RATHER THAN RECORDED
	 * (nit, round 2; re-baselined this pass from the reading below).
	 *
	 * `[data-chat-row]` names the catalogue's SECTION HEADINGS as well as its rows, so
	 * `[data-chat-row]:focus` answers "a chat-row-shaped element holds the keyboard" - a question
	 * a heading satisfies. The reading this pass produced, in both palettes, is verbatim
	 * `{"selector":"[data-chat-row]:focus","target":"button \"Agents\"","focused":true}`: what the
	 * keyboard lands on after a row is clicked is the `Agents` HEADING, not a row. The row-scoped
	 * form, `[data-session-row] [data-chat-row]:focus`, is the assertion this check WANTS and
	 * cannot have - it matches NOTHING here (measured, both palettes: ten seconds of waiting and
	 * then the run threw), i.e. the focused element is not inside a session row.
	 *
	 * So the check states what actually lands: a catalogue element that is NOT the row which was
	 * clicked and NOT the document, with the row-scoped miss read beside it. Landing the scoped
	 * form as the assertion would be a red walk over a fact about the app's focus rules rather
	 * than about this change; writing the unscoped form as if it were about a row is what this
	 * re-baseline removes.
	 */
	const successorScoped = await verb(cdp, "measure", {
		selector: "[data-session-row] [data-chat-row]:focus",
		timeoutMs: 400,
	}).catch(() => null);
	check(
		"the keyboard lands on a catalogue element rather than back on the document, and NOT inside a session row: the row-scoped form of the selector matches nothing (nit, round 2)",
		successor !== null &&
			successor.focused === true &&
			successorScoped === null &&
			!/Release notes for 0\.29/.test(successor.target ?? ""),
		JSON.stringify({ successor, successorScoped }),
	);
	/*
	 * WHAT IT LANDED ON, RECORDED BESIDE THE ASSERTION: the check above can only say "not a row
	 * and not the document", and which element answered is the difference between a heading and
	 * some other chat-row-shaped surface - so both readings are printed rather than summarised.
	 */
	note(
		"what holds the keyboard after a row is clicked",
		JSON.stringify({ unscoped: successor, rowScoped: successorScoped }),
	);
	/*
	 * THE OFFER, AND THE CONSTRAINT THAT MOVED IT OUT OF THE CORNER (design round 2,
	 * D12, answered in design D11).
	 *
	 * It has to satisfy two things at once: it must sit on the surface that performed
	 * the action, and it must never be able to sit over the composer's interactive
	 * controls. As a viewport-corner toast it failed the second - measured in both
	 * palettes the toast box (x 1001..1360.5, y 789..842.5) covered the Send control
	 * (x 1307..1339, y 803..835), so the offer's own Undo box landed where Send had
	 * been. It is a toast again, but in the PANEL'S OWN LANE: both properties are
	 * asserted here rather than described, and the second is now structural - the
	 * lane is inside the panel's box, and the composer is in another column.
	 */
	const offerBoxes = await cdp.evaluate(`(() => {
		const box = (el) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
		};
		return {
			offer: box(document.querySelector(${JSON.stringify(SIDEBAR_TOAST)})),
			panel: box(document.querySelector('[aria-label="Chats"]')),
			send: box(document.querySelector('[aria-label="Send message"]')),
		};
	})()`);
	const disjoint = disjointBoxes;
	check(
		"a successful archive offers an Undo on the surface that performed it",
		offerBoxes.offer !== null && offerBoxes.panel !== null,
		JSON.stringify(offerBoxes),
	);
	check(
		"and the offer is inside the panel, never over the composer's Send control",
		offerBoxes.offer !== null &&
			offerBoxes.offer.left >= offerBoxes.panel.left &&
			offerBoxes.offer.right <= offerBoxes.panel.right &&
			disjoint(offerBoxes.offer, offerBoxes.send) === true,
		JSON.stringify(offerBoxes),
	);
	note("the undo offer's box, and the composer's", JSON.stringify(offerBoxes));
	const offerFirst = await capture(cdp, `undo-offer${RUN_LABEL}`);
	await wait(200);
	const offerSecond = await capture(cdp, `undo-offer${RUN_LABEL}`);
	offerFrames.push({
		label: `undo-offer${RUN_LABEL}`,
		stable: readFileSync(offerFirst.path).equals(
			readFileSync(offerSecond.path),
		),
		toastOnScreen: (await drawnSelector(cdp, SIDEBAR_TOAST)) === true,
	});

	/*
	 * 11. Deleting the OPEN conversation (UX round 1, U1): the pane must land on the
	 *     missing-session notice it ALREADY had rather than on a writable draft bound
	 *     to an id that is gone. The conversation is the one this scene archived in
	 *     step 9, which is the interesting case rather than a special one - archive
	 *     hides, delete removes, and the notice is the same element either way.
	 */
	await waitForNoToasts(cdp, 20_000);
	await parkPointer(cdp);
	await clickAt(cdp, '[aria-label="Conversation actions"]');
	await wait(300);
	await clickAt(cdp, "[data-session-delete]");
	await wait(300);
	await clickAt(cdp, "[data-confirm-action]");
	await wait(700);
	const notice = await verb(cdp, "measure", "#lo-missing-session-notice");
	const afterDelete = await verb(cdp, "state");
	check(
		"deleting the open conversation lands the pane on its EXISTING missing-session notice",
		notice.inViewport === true &&
			afterDelete.activeSessionId === "2d5ad5da0025",
		`${JSON.stringify(notice)} activeSessionId=${afterDelete.activeSessionId}`,
	);
	frames.push(await captureSettled(cdp, `deleted-open${RUN_LABEL}`));

	/*
	 * 7. THE PAIR, AT EVERY WIDTH (the round-1 design ruling, kept; the narrow band
	 *    it used to shed in is deleted by design D9 of `docs/design/sidebar-row-space.md`).
	 *
	 * The row now carries the pair at EVERY panel width and reserves NOTHING at rest:
	 * the two acts are absent from the layout until the pointer or the keyboard is in
	 * the row (`display`, not `opacity`), so the shipped comment this step was written
	 * about - "56px off every title, on every row, at rest" - describes a cost that no
	 * longer exists, and the container query that shed the pair below 279px is gone
	 * with it. What is photographed is therefore the rule itself: the row at rest with
	 * nothing drawn, the same row with the pointer on it carrying both acts, and the
	 * clamp minimum following the same rule as every other width.
	 *
	 * The COST is measured rather than asserted in prose: the title element's own
	 * painted width, on two rows - the first row, and the row that also carries an
	 * UNREAD mark. THIS COMMENT USED TO CALL THE MARK A TRAILING SLOT OUTSIDE THE
	 * TITLE and to call that row "the binding case" for the cost (design round 3, D19):
	 * it is the opposite - the mark is drawn inside the row's LEADING status slot, so a
	 * marked row's title measures the SAME width as a bare one, and the two rows are
	 * measured here precisely to show that. The assertion that the mark is really
	 * DRAWN is below ("the unread mark is DRAWN on this row"), because two equal widths
	 * from two unmarked rows would prove nothing. `--width` cannot reach this band: the
	 * panel's width is the USER's preference (`chatSidebarWidth`, clamped 240..360),
	 * not a function of the window, so the scene writes the same preference the divider
	 * writes.
	 */
	await parkPointer(cdp);
	await verb(cdp, "navigate", "/chat");
	await wait(400);

	const titlesAt = async (width) => {
		const applied = await verb(cdp, "setSidebarWidth", { width });
		await wait(400);
		const plain = await verb(cdp, "measure", "[data-session-title]");
		const marked = await verb(cdp, "measure", {
			selector: '[data-session-row="b3f1a09c7d52"] [data-session-title]',
		});
		return { applied, plain, marked };
	};
	/*
	 * DRAWN, not merely PRESENT IN THE DOM, and the distinction is the check's whole
	 * content now that the acts are display-switched: a control that is not displayed
	 * is still in the document, `measure` finds it and reports a 0x0 box. Asking for a
	 * non-zero box is what makes this an assertion about pixels.
	 */
	const drawn = async (selector) => {
		try {
			const box = await verb(cdp, "measure", { selector, timeoutMs: 400 });
			return box.rect.width > 0 && box.rect.height > 0;
		} catch {
			return false;
		}
	};

	const wide = await titlesAt(280);
	/*
	 * THE MARK IS DRAWN, RATHER THAN INFERRED (design round 2, D11).
	 *
	 * The two equal title widths below are evidence for a claim about a MARKED row,
	 * and the first version of this fixture could not produce one: it sent
	 * `attention: { unseen: true }`, a shape `mergeCompletionAttention` rejects (it
	 * requires `conversation_id` = `session/<id>` and a `[epoch, revision]` pair), so
	 * `attention` stayed absent, `unreadMarkKind` returned null, and both measured
	 * rows were BARE. Equal widths from two bare rows say nothing. So the glyph's own
	 * box is asserted first - and asserted to be the only one in the list, which is
	 * the half that makes it discriminating rather than a tautology about a class
	 * name that happens to be in the file.
	 */
	const mark = await cdp.evaluate(`(() => {
		const marked = document.querySelector('[data-session-row="b3f1a09c7d52"]');
		const glyph = marked?.querySelector(".text-success") ?? null;
		const r = glyph?.getBoundingClientRect() ?? null;
		/*
	 * DRAWN MEANS PAINTED, NOT MERELY SIZED (nit, round 2). A box with pixels in it needs three
	 * answers rather than one: a glyph inside a display:none wrapper is 0x0, but one that is
	 * visibility:hidden or opacity:0 KEEPS its box - so a width-and-height test alone would call a
	 * mark that paints nothing "drawn", and the two equal title widths below would be evidence
	 * about a mark nobody can see. This is the same three clauses the scene's own painted
	 * reading uses, spelled where the glyph is.
	 */
	const style = glyph ? getComputedStyle(glyph) : null;
	const elsewhere = [...document.querySelectorAll("[data-session-row] .text-success")]
		.filter((el) => !marked?.contains(el)).length;
	return {
		drawn:
			!!r &&
			r.width > 0 &&
			r.height > 0 &&
			style !== null &&
			style.display !== "none" &&
			style.visibility !== "hidden" &&
			Number(style.opacity) > 0,
		width: r?.width ?? 0,
		height: r?.height ?? 0,
		display: style?.display ?? null,
		visibility: style?.visibility ?? null,
		opacity: style ? Number(style.opacity) : null,
		elsewhere,
		};
	})()`);
	check(
		"the unread mark is DRAWN on this row, and nowhere else in the list",
		mark.drawn === true && mark.elsewhere === 0,
		JSON.stringify(mark),
	);
	note("the unread mark", JSON.stringify(mark));
	/*
	 * AT REST, WITH THE POINTER PARKED AWAY FROM THE LIST: nothing is reserved. This is
	 * the half that replaces the old "two reserved slots" claim, and it is the whole of
	 * the change - the title has the row, and a frame with the pointer on the row
	 * cannot show it, because the pointer is what draws the acts.
	 */
	check(
		"at rest the row reserves nothing: neither act is drawn, and the pair's own box is empty",
		(await drawn("[data-session-control-pair]")) === false &&
			(await drawn("[data-session-pin]")) === false &&
			(await drawn("[data-session-archive]")) === false,
		`pair ${await drawn("[data-session-control-pair]")}, pin ${await drawn("[data-session-pin]")}, archive ${await drawn("[data-session-archive]")}`,
	);
	/*
	 * AND THE RETIRED BAND'S OWN CONTROL IS GONE FROM THE DOCUMENT, not merely
	 * undrawn: the shared trigger was the narrow band's answer to a rest cost that no
	 * longer exists, and its anchor is deleted from the panel (design D9).
	 */
	check(
		"and the narrow band's shared control is not in the document at all",
		(await drawn("[data-session-actions]")) === false,
		"the shared control is still drawn somewhere",
	);
	const pinWide = await verb(cdp, "measure", "[data-session-pin]");
	const archiveWide = await verb(cdp, "measure", "[data-session-archive]");
	note(
		"title width, pair (280px panel)",
		`status row ${wide.plain.rect.width}px, unread row ${wide.marked.rect.width}px; pin ${pinWide.rect.width}x${pinWide.rect.height}, archive ${archiveWide.rect.width}x${archiveWide.rect.height}`,
	);
	frames.push(await captureSettled(cdp, `pair-rest${RUN_LABEL}`));

	/*
	 * THE POINTER IS PUT ON THE ROW for the two frames that ARE the reveal, and that is
	 * the whole of what they are OF: the acts exist in the layout only under the
	 * pointer or under focus, so a parked frame would photograph a row with no
	 * controls at all. The row chosen is the one that also carries an unread mark, so
	 * one frame carries the reveal, the marker and the width claim together.
	 *
	 * WAITING FOR THE PAN, because this row's title cannot fit and the pointer starts
	 * one (design D5): `captureSettled` requires two byte-identical captures, and a
	 * frame taken mid-pan is a frame the app never held still for. The pan stops at the
	 * title's own overflow and holds there, which IS a still state - so the wait is for
	 * the dwell plus the pan's own ceiling, exactly as the `row-space` scene waits.
	 */
	/*
	 * AND THE LANE IS CLEARED FIRST (this scene's own triage, 2026-09-21). An earlier step
	 * leaves a refusal standing at the panel's bottom-left, and the row under it is not
	 * hoverable at all: Chromium gives `:hover` to the TOPMOST element, so the pointer lands
	 * on the toast and the row paints no ground and reveals no acts - measured as
	 * `{"rows":2,"painted":[]}` and `pair false, pin false, archive false`, with the row's
	 * own controls never drawn. Waiting for the message to retire (the panel's clock, <= 10s
	 * from its last assertion) puts the pointer back on the row, which is what these two
	 * checks are about; nothing about their claims changes.
	 */
	await waitForGone(cdp, SIDEBAR_TOAST, 12_000);
	/*
	 * THE POINTER IS PLACED AND THEN VERIFIED, because a re-laid-out panel can leave a single
	 * `mouseMoved` landing nowhere: the width round-trip above (280 -> 240 -> 280) moves the
	 * list under the pointer, and these two checks are about the row UNDER it. Measured
	 * 2026-09-21 in one run: the same assertion passes at the clamp minimum a few steps
	 * earlier (`pair true, pin true, archive true`) and read `pair false, pin false, archive
	 * false` here - so the reveal rule is intact and the pointer was not on the row. Three
	 * attempts, then the claim is made exactly as written: a row that genuinely reveals
	 * nothing still fails, because the loop waits for the drawn control rather than assuming
	 * it.
	 */
	for (let attempt = 0; attempt < 3; attempt += 1) {
		await hoverOver(cdp, '[data-session-row="b3f1a09c7d52"]');
		await wait(400 + 8_000);
		if ((await drawn(`${longRow} [data-session-pin]`)) === true) break;
	}
	/*
	 * THE ROW'S OWN GROUND, READ FROM THE COMPILED RULE AND NOT FROM THE CLASS LIST
	 * (design round 3, D18).
	 *
	 * This is the assertion whose absence let an INERT class ship twice: the first
	 * attempt put `group-hover:bg-row-hover` on the element that CARRIES `group`,
	 * which Tailwind compiles to a DESCENDANT rule - so the class was present, the
	 * static tests were green, and the row box painted nothing. Asking the browser
	 * for the element's own computed background is the cheapest question that
	 * evaluates the compiled selector rather than the source text.
	 *
	 * THE SIBLING IS THE CONTROL, and it is what makes this discriminating: a bare
	 * "the hovered row has a background" would pass for the button's own ground.
	 * What is asserted is that the BOX paints it, that its width is the box's own
	 * width (the D18 measurement was a ground 56px short of that), and that a row
	 * the pointer is not on paints nothing.
	 */
	const ground = await readRowGrounds(cdp);
	check(
		"the ROW BOX paints the hover ground, and no other row does",
		ground.rows > 1 &&
			ground.painted.length === 1 &&
			ground.painted[0].id === "b3f1a09c7d52",
		JSON.stringify(ground),
	);
	note("the row's own ground", JSON.stringify(ground));
	/*
	 * SCOPED TO THE ROW THE POINTER IS ON. `drawn` answers about the FIRST match in the
	 * document, which was this row only while `Previous chats` happened to be shut: with
	 * the section open (step 2 opens it) the first pair in the DOM belongs to a row the
	 * pointer is not on, and the check reported three false negatives on a panel that was
	 * drawing all three correctly. An assertion about "the row under the pointer" has to
	 * name that row.
	 */
	const pairDrawn =
		(await drawn(`${longRow} [data-session-control-pair]`)) === true;
	const pinDrawn = (await drawn(`${longRow} [data-session-pin]`)) === true;
	const archiveDrawn =
		(await drawn(`${longRow} [data-session-archive]`)) === true;
	check(
		"and under the pointer BOTH acts are drawn, at the panel's default width",
		pairDrawn && pinDrawn && archiveDrawn,
		`pair ${pairDrawn}, pin ${pinDrawn}, archive ${archiveDrawn}`,
	);
	frames.push(await captureSettled(cdp, `pair-wide${RUN_LABEL}`));
	/*
	 * THE PIN'S OWN HOVERED STEP (agent review round 4, R4-4). D22's ruling gives
	 * every control the pointer's step, and for the PIN that step lands on a
	 * RELEASED surface: main's control declared no `hover:` colour at all, so with
	 * the pointer on it the glyph now reads `ink` where it read `ink-muted`. The
	 * archive slot was measured and this one was only asserted by construction, so
	 * the pointer goes on the pin beside it and the two frames carry the pair.
	 */
	await hoverOver(cdp, '[data-session-row="b3f1a09c7d52"] [data-session-pin]');
	await wait(400);
	frames.push(await captureSettled(cdp, `pair-pin${RUN_LABEL}`));

	/*
	 * THE CLAMP MINIMUM FOLLOWS THE SAME RULE AS EVERY OTHER WIDTH (design D9). It used
	 * to carry ONE shared 24px control instead of the pair; the shed is deleted, so
	 * what this step asserts is that 240 draws the pair - and that the deleted
	 * control's anchor is not in the document at any width.
	 */
	const narrow = await titlesAt(240);
	await hoverOver(cdp, '[data-session-row="b3f1a09c7d52"]');
	await wait(400 + 8_000);
	/*
	 * The three act reads are SCOPED TO THE HOVERED ROW and the shared-control read is
	 * not: "the pair is drawn" is a fact about the row under the pointer, while "no
	 * shared control exists" is a fact about the whole panel (it was deleted, D9). The
	 * first three were document-wide `drawn` reads, which answer about the first match in
	 * the document - an unpinned row the pointer is not on, once `Previous chats` is open
	 * (measured 2026-09-21: three false negatives on a panel drawing all three).
	 */
	const narrowPair =
		(await drawn(`${longRow} [data-session-control-pair]`)) === true;
	const narrowPin = (await drawn(`${longRow} [data-session-pin]`)) === true;
	const narrowArchive =
		(await drawn(`${longRow} [data-session-archive]`)) === true;
	const narrowShared = (await drawn("[data-session-actions]")) === true;
	check(
		"at the clamp minimum the pair is drawn like every other width, and no shared control exists",
		narrowPair && narrowPin && narrowArchive && narrowShared === false,
		`pair ${narrowPair}, pin ${narrowPin}, archive ${narrowArchive}, shared ${narrowShared}`,
	);
	const pinNarrow = await verb(cdp, "measure", "[data-session-pin]");
	const archiveNarrow = await verb(cdp, "measure", "[data-session-archive]");
	note(
		"title width, pair (240px panel)",
		`status row ${narrow.plain.rect.width}px, unread row ${narrow.marked.rect.width}px; pin ${pinNarrow.rect.width}x${pinNarrow.rect.height}, archive ${archiveNarrow.rect.width}x${archiveNarrow.rect.height}`,
	);
	frames.push(await captureSettled(cdp, `pair-narrow${RUN_LABEL}`));
	await verb(cdp, "setSidebarWidth", { width: 280 });
	await wait(300);

	/*
	 * AND THE LANE'S OTHER CONTROL, INTO A REFUSAL (agent review round 2, R2-1). The Retry
	 * is walked above; this is its twin on the OFFER, and it is the one that still carried
	 * the defect: pressing Undo writes the desired state immediately, the optimistic fact
	 * made the retirement rule read false, the offer was therefore retired AT the press and
	 * the lane was dismissed - and a REFUSED unarchive then raised its refusal on the id
	 * that had just been dismissed, which sonner destroys inside its own unmount window.
	 * The reader saw the offer vanish, the row stay archived, and no message.
	 *
	 * The walk is a whole sequence because the offer must exist before its Undo can be
	 * pressed: archive the row (accepted - the stub refuses only its unarchive), press the
	 * offer's own Undo (refused once), then require A MESSAGE TO STILL BE IN THE LANE - the
	 * refusal this time - with its Retry hit-testable and the row still archived, because a
	 * refused write moves nothing. The freshness half is read the way the retry's is (`state`
	 * rather than the pixels): the refusal has to name THIS row, since an in-place
	 * replacement leaves the element itself indistinguishable.
	 *
	 * THEN THE REFUSAL'S OWN RETRY, which the fixture answers by letting the unarchive land:
	 * the scene ends with the list the fixture describes rather than with an extra archived
	 * row for the next palette to photograph.
	 */
	const undoRow = `[data-session-row="${REFUSED_UNDO_ID}"]`;
	const labelOf = async (selector) =>
		cdp.evaluate(
			`(() => { const node = document.querySelector(${JSON.stringify(selector)}); return node ? node.getAttribute("aria-label") : null; })()`,
		);
	await parkPointer(cdp);
	/*
	 * AND THE CONTROL IS DRAWN BEFORE IT IS PRESSED (same triage, same run). The acts are
	 * `display`-switched, so a press addressed at rest has a 0x0 box and reaches nothing:
	 * measured 2026-09-21, this walk's archive press produced NO offer at all
	 * (`{"offer":false,...}`) because the control it aimed at was never revealed - a scene
	 * setup failure that then failed three checks about the app.
	 */
	/*
	 * THE ROW, NOT AN ELEMENT INSIDE IT. This used to hover `${undoRow} [data-chat-row]`, while
	 * every step that successfully reveals a row hovers the ROW - and `[data-chat-row]` also
	 * matches SECTION HEADINGS (the catalogue's own reading names one: `button "Agents"`), so
	 * the pointer went wherever that selector found something first inside the row. Measured
	 * 2026-09-21: the press at the end of it raised no offer at all (`{"offer":false}`) and
	 * moved nothing, because the acts are `display`-switched and a press addressed at an
	 * unrevealed control has a 0x0 box. The pointer now goes on the row, exactly as the ground
	 * and acts steps above put it, and the reveal is ASSERTED before the press rather than
	 * assumed - three checks about the app failed on this one scene-setup error.
	 */
	/*
	 * PROMPTLY, BECAUSE THE DWELL IS THE DIFFERENCE (manager's bounded comparison, 2026-09-21).
	 * Sampled live across the two presses, the row that WORKS carries `data-state: "closed"` -
	 * no tooltip - while this one carried `data-state: "delayed-open"` with `aria-describedby`
	 * and popper side/align set, because the walk dwelt on the row long enough for the app's own
	 * flyout to open. Both controls measured 24x24 and `disabled: false`, so the press had a real
	 * box either way; what differed was the state the row was in when it arrived. This mirrors
	 * the working step's timing - hover the row, then the control, then press, inside the
	 * tooltip's own delay - and the forensics note below prints the state it actually reached,
	 * so the reading stays checkable rather than assumed.
	 */
	await hoverOver(cdp, undoRow);
	await wait(300);
	await hoverOver(cdp, `${undoRow} [data-session-archive]`);
	await wait(150);
	/*
	 * AND THE BOX IS DRAWN, NON-ZERO AND STABLE BEFORE THE PRESS (UX round 3's instrument
	 * finding). The UX round could not reproduce the walk's no-op as an app behaviour - every
	 * press of its own landed - and it hit this walk's two failure modes itself: a pre-reveal
	 * measurement returns a 0x0 box, which sends a press to (0,0), and a press that measures and
	 * THEN moves aims at the box the control had at rest. So the control's box is read twice
	 * with a settle between, and the press below goes to the box this check proved.
	 */
	const boxBefore = await verb(
		cdp,
		"measure",
		`${undoRow} [data-session-archive]`,
	);
	await wait(200);
	const boxAfter = await verb(
		cdp,
		"measure",
		`${undoRow} [data-session-archive]`,
	);
	const stableBox =
		boxBefore.rect.width > 0 &&
		boxBefore.rect.height > 0 &&
		boxBefore.centre.x === boxAfter.centre.x &&
		boxBefore.centre.y === boxAfter.centre.y;
	const undoRevealed =
		(await drawn(`${undoRow} [data-session-archive]`)) === true;
	check(
		"the control this walk presses is drawn at a non-zero, stable box before the press",
		undoRevealed === true && stableBox === true,
		JSON.stringify({
			row: REFUSED_UNDO_ID,
			revealed: undoRevealed,
			stableBox,
			box: {
				w: boxAfter.rect.width,
				h: boxAfter.rect.height,
				cx: boxAfter.centre.x,
				cy: boxAfter.centre.y,
			},
		}),
	);
	/*
	 * A STATIONARY PRESS, not one that moves first. `clickAt` dispatches `mouseMoved` before
	 * the press, and this row's acts are REVEALED BY HOVER AND DISARMED BY THE POINTER'S
	 * MOVING - the hazard the PIN step above documents in its own words, and precisely why
	 * `pressPointerStationary` exists in this driver. Measured 2026-09-21: with `clickAt` the
	 * reveal assertion passed and the press still raised NO offer, wrote nothing, and left the
	 * row's label null; the pointer is already where it needs to be, so the press only has to
	 * land without a move in front of it.
	 */
	/*
	 * AND THE POINTER GOES ON THE CONTROL, which is what the press that WORKS in this same run
	 * does: the refusal step hovers the row, then hovers the CONTROL itself, then presses it -
	 * and the press lands. This walk hovered only the row, so its control was drawn but had never
	 * had the pointer on it, and a stationary press there did nothing either - which is what
	 * exonerated the pointer's movement and left the control's own arming as the difference.
	 */
	await hoverOver(cdp, `${undoRow} [data-session-archive]`);
	await wait(300);
	note(
		"row forensics, walk (the press that does NOTHING)",
		JSON.stringify(await rowForensics(cdp, REFUSED_UNDO_ID)),
	);
	/*
	 * WHAT IS ACTUALLY ON TOP AT THOSE COORDINATES (manager's lead, pass 4). The press that
	 * WORKS in this same run happens with NO lane card up; this one happens while the refusal
	 * card is - and the card overlays the list's lower rows, which is U8's subject. If something
	 * is intercepting, the only way to see it is to ask the document what the point resolves to
	 * rather than to assume the control is the hit target.
	 */
	const hitAtPress = await cdp.evaluate(`(() => {
		const el = document.elementFromPoint(${boxAfter.centre.x}, ${boxAfter.centre.y});
		if (!el) return { tag: null };
		const path = [];
		for (let n = el; n && path.length < 6; n = n.parentElement) {
			path.push(
				n.tagName.toLowerCase() +
					(n.getAttribute("data-session-archive") !== null ? "[data-session-archive]" : "") +
					(n.hasAttribute("data-button") ? "[data-button]" : "") +
					(n.classList.contains("lo-archive-toast") ? ".lo-archive-toast" : "") +
					(n.hasAttribute("data-content") ? "[data-content]" : "") +
					(n.hasAttribute("data-sonner-toast") ? "[data-sonner-toast]" : "") +
					(n.hasAttribute("data-session-row") ? "[data-session-row]" : ""),
			);
		}
		return { tag: path[0], chain: path.join(" < "), pe: getComputedStyle(el).pointerEvents };
	})()`);
	note("the hit target at the walk's press point", JSON.stringify(hitAtPress));
	/*
	 * AND WHETHER THE PRESS REACHES THE APP AT ALL (manager's lead, pass 4): `archiveAttempts`
	 * is the store's write counter, so a press that lands advances it whether or not the daemon
	 * accepts. The hit probe above says the control IS the hit target; this says whether pressing
	 * it did anything - the two together separate "the rig never delivered it" from "the app
	 * received it and chose not to".
	 */
	const attemptsBefore = (await verb(cdp, "state"))?.archiveAttempts ?? null;
	await pressPointerStationary(cdp, boxAfter.centre.x, boxAfter.centre.y);
	await wait(600);
	const attemptsAfter = (await verb(cdp, "state"))?.archiveAttempts ?? null;
	note(
		"the walk's press, seen by the store",
		JSON.stringify({
			attemptsBefore,
			attemptsAfter,
			advanced: attemptsAfter !== attemptsBefore,
		}),
	);
	await wait(500);
	/*
	 * AND IT PRESSES ITS OWN MESSAGE (this walk's triage, 2026-09-21). The lane keeps one
	 * message at a time and an earlier step's refusal is still standing in the store; the walk
	 * used to press `[data-button]` on whatever the lane showed, so it pressed THAT refusal's
	 * Retry and then asserted about the row it had not touched (`refusalNames:
	 * "7c1b0f2a4d31"` - the earlier row - while the walk's own row was `b3f1a09c7d52`). The
	 * offer is the message whose action reads `Undo`, so the walk waits for it before
	 * pressing; every claim below is unchanged, including the precondition's.
	 */
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const laneAction = await cdp.evaluate(`(() => {
			const toast = document.querySelector(${JSON.stringify(SIDEBAR_TOAST)});
			const button = toast ? toast.querySelector("[data-button]") : null;
			return button ? (button.textContent || "").trim() : null;
		})()`);
		if (laneAction === "Undo") break;
		await wait(250);
	}
	const offerUp = await verb(cdp, "measure", SIDEBAR_TOAST);
	const offerState = await verb(cdp, "state");
	const offerLane = await cdp.evaluate(`(() => {
		const toast = document.querySelector(${JSON.stringify(SIDEBAR_TOAST)});
		const button = toast ? toast.querySelector("[data-button]") : null;
		return { action: button ? (button.textContent || "").trim() : null };
	})()`);
	/*
	 * THE CLAIM IS "THE OFFER IS THE LANE'S MESSAGE", NOT "THE STORE IS CLEAN" (this walk's own
	 * triage, 2026-09-21). The clause this replaces asked for `archiveFailure == null`, which the
	 * app never reaches in this scene: the retry step above refuses a write for a LIVE_CLAIM row,
	 * and the store keeps a refusal until an accepted unarchive of that same row or a new offer
	 * for it - neither of which is reachable for a row whose route always 409s. It read
	 * `{"offer":false,"failure":{"sessionId":"7c1b0f2a4d31"}}` on every run: a fabricated
	 * precondition failing a walk whose subject it is not. What the walk needs is that the lane
	 * is carrying THE OFFER IT JUST RAISED (its action reads `Undo`; a refusal's reads `Retry`),
	 * and that is what is asserted here - a strictly stronger statement about identity than
	 * "a toast is in the viewport". The store's refusal is still reported, for the record.
	 */
	check(
		"the offer this walk starts from is up, and it is the lane's own message",
		offerUp.inViewport === true && offerLane.action === "Undo",
		JSON.stringify({
			offer: offerUp.inViewport,
			action: offerLane.action,
			failure: offerState.archiveFailure ?? null,
		}),
	);
	const undoAt = Date.now();
	await clickAt(cdp, `${SIDEBAR_TOAST} [data-button]`);
	let undoRefused = null;
	for (let attempt = 0; attempt < 20; attempt += 1) {
		await wait(250);
		undoRefused = await cdp.evaluate(`(() => {
			const toast = document.querySelector(${JSON.stringify(SIDEBAR_TOAST)});
			if (!toast) return { painted: false };
			const r = toast.getBoundingClientRect();
			const button = toast.querySelector("[data-button]");
			if (!button) return { painted: r.width > 0, action: null };
			const b = button.getBoundingClientRect();
			return {
				painted: r.width > 0 && getComputedStyle(toast).display !== "none",
				text: (toast.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 64),
				action: (button.textContent || "").trim(),
				hitTest: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === button,
			};
		})()`);
		const undoState = await verb(cdp, "state");
		undoRefused.refusalNames = undoState?.archiveFailure?.sessionId ?? null;
		undoRefused.rowLabel = await labelOf(`${undoRow} [data-session-archive]`);
		/*
		 * AND WHETHER THE ROW IS IN THE LIST AT ALL. After a REFUSED unarchive the store puts back the
		 * fact the press replaced - the FACT is the client's knowledge now (design round 8, D27), so
		 * the refusal restores it and the row reads ARCHIVED again - and this scene runs with
		 * `Include archived` off, so the row leaves the list and its control is gone with it. That is
		 * why `rowLabel` reads `null` here and why that `null` is the CORRECT reading rather than a
		 * missing one (manager, pass 6). The clause below therefore asserts the state the app actually
		 * reaches instead of the label it would carry if the refusal had not restored.
		 *
		 * THIS PARAGRAPH SAID "the store reverts the row to ARCHIVED", which was the pre-D27 shape and
		 * is now false: the press patches no row at all, the revert is the fact's own restoration, and
		 * a reader who took the old sentence at face value would be licensed to delete that restore as
		 * redundant (design round 9, D31).
		 */
		undoRefused.rowStillListed = await cdp.evaluate(
			`document.querySelector(${JSON.stringify(undoRow)}) !== null`,
		);
		/*
		 * THE LOOP WAITS FOR THIS ROW'S REFUSAL, NOT FOR "A RETRY TOAST" (this walk's triage,
		 * 2026-09-21). The retry step above leaves a refusal for ANOTHER row standing, and this
		 * poll used to break on it on its first iteration - reading
		 * `{"action":"Retry","refusalNames":"7c1b0f2a4d31","rowLabel":null}` while the walk's own
		 * row is `b3f1a09c7d52`, i.e. it reported a message the walk had never raised and a row
		 * the walk had not touched. The identity clause is the check's own subject ("the refusal
		 * for the row that was pressed"), so the poll now waits for it; the assertions are
		 * otherwise untouched, and a walk whose press raises nothing still fails, with a reading
		 * that names what the lane actually showed.
		 */
		if (
			undoRefused?.painted === true &&
			undoRefused?.action === "Retry" &&
			undoRefused?.refusalNames === REFUSED_UNDO_ID
		)
			break;
	}
	check(
		"a REFUSED undo leaves a message in the lane, and it is the refusal for the row that was pressed: Retry hit-testable, the row still archived, the offer never left the lane empty (agent review round 2, R2-1)",
		undoRefused?.painted === true &&
			undoRefused?.action === "Retry" &&
			undoRefused?.hitTest === true &&
			undoRefused?.refusalNames === REFUSED_UNDO_ID &&
			undoRefused?.rowLabel === null &&
			undoRefused?.rowStillListed === false,
		`${Date.now() - undoAt}ms after the undo: ${JSON.stringify(undoRefused)}`,
	);
	/*
	 * AND THE PRESS AIMS AT THE CARD THE STEP ABOVE PROVED IS DRAWN, from a box read again at
	 * the press rather than from whatever the selector resolves to at that instant.
	 *
	 * WHY NOT `clickAt`, WHICH EVERY OTHER LANE PRESS IN THIS FILE USES. Measured across fifteen
	 * runs in both palettes: this press issued NO REQUEST AT ALL - the stub log's last
	 * archive-family line stayed the `409` that raised the refusal, the store's write counter did
	 * not move across the press, and the row stayed archived - while the step immediately above
	 * passed, over the same drawn card, asserting a hit-testable Retry for this row. The card is
	 * REPLACED IN PLACE by the answer (one sonner id carries both messages), and sonner animates
	 * the replacement's own height (`transition: ... height .4s` - the very transition the band's
	 * pairing check above re-reads both boxes after). So a box read at the instant the new card
	 * mounts is a box the card is still moving out of, and a press aimed at it lands where the
	 * button no longer is. This scene already carries the rule for that case: the walk's own
	 * archive control, above, is measured twice with a settle between and the press goes to the
	 * box the CHECK proved rather than to a fresh guess.
	 *
	 * SO THE BOX IS READ UNTIL TWO READS AGREE, and the press is STATIONARY - the spelling this
	 * file documents beside the pin, where a press that dispatches `mouseMoved` first re-arms a
	 * parked-pointer disarm. NOTHING ABOUT THE CHECK BELOW MOVES: its clauses still want the
	 * refusal's own Retry landing the unarchive and the row back in the list, a press that
	 * reaches nothing still fails it, and its reading now names the box it aimed at and what the
	 * store's counter did across the press.
	 */
	const retryBox = async () => {
		let previous = null;
		for (let attempt = 0; attempt < 12; attempt += 1) {
			const box = await verb(cdp, "measure", {
				selector: `${SIDEBAR_TOAST} [data-button]`,
				timeoutMs: 2_000,
			});
			if (
				previous !== null &&
				previous.centre.x === box.centre.x &&
				previous.centre.y === box.centre.y &&
				box.rect.width > 0 &&
				box.rect.height > 0
			)
				return { box, settledMs: attempt * 150 };
			previous = box;
			await wait(150);
		}
		return { box: previous, settledMs: 12 * 150 };
	};
	const retryAt = await retryBox();
	const attemptsBeforeRetry =
		(await verb(cdp, "state"))?.archiveAttempts ?? null;
	await pressPointerStationary(cdp, retryAt.box.centre.x, retryAt.box.centre.y);
	await wait(400);
	const attemptsAfterRetry =
		(await verb(cdp, "state"))?.archiveAttempts ?? null;
	const undoCleared = await waitForGone(cdp, SIDEBAR_TOAST, 8_000);
	const restoredLabel = await labelOf(`${undoRow} [data-session-archive]`);
	/*
	 * THE STORE AND THE CARD AT THIS CHECK'S EDGE (the contradiction this fixes, stated exactly):
	 * the lane cleared at 8118ms - an OFFER's eight-second ceiling - while the step immediately
	 * before this one passed asserting that the lane held the REFUSAL for the pressed row with a
	 * hit-testable Retry. Both cannot describe the same drawn message, and the split is (a) an
	 * offer drawn where the walk believes a refusal is, (b) a refusal drawn whose VALUE was cleared
	 * early so the card outlived it until the clock dismissed it, or (c) something else. A sonner
	 * entry persists until it is dismissed, so the value and the card can disagree - which is why
	 * this reads BOTH rather than the store alone: what the store holds names the side, and what
	 * the card says says whether the reader was looking at a message the store no longer had.
	 */
	const laneAtEdge = await verb(cdp, "state").catch(() => null);
	const cardAtEdge = await cdp.evaluate(`(() => {
		const toast = document.querySelector(${JSON.stringify(SIDEBAR_TOAST)});
		if (!toast) return null;
		const action = toast.querySelector("[data-button]");
		return {
			type: toast.getAttribute("data-type"),
			text: toast.textContent,
			action: action ? action.textContent : null,
			box: (() => { const r = toast.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
		};
	})()`);
	note(
		"the lane at the finishing check's edge: what the store holds, and what the card says",
		JSON.stringify({
			store: {
				failure: laneAtEdge?.archiveFailure?.sessionId ?? null,
				failureArchived: laneAtEdge?.archiveFailure?.archived ?? null,
				undo:
					laneAtEdge?.archiveUndo !== null &&
					laneAtEdge?.archiveUndo !== undefined,
				attempts: laneAtEdge?.archiveAttempts ?? null,
			},
			card: cardAtEdge,
		}),
	);

	/*
	 * THE SCROLLED ARRIVAL, IN QA'S OWN STATE, WITH THE WRITER TRAPPED (QA round 4's Q-9, design
	 * round 7's D24).
	 *
	 * WHAT THIS REPLACES, AND WHY IT COULD NOT ANSWER THE QUESTION. The committed probe read
	 * `{"clicked":false,…,"after":{"band":0,"card":null}}`: the row it focused was the first
	 * `[data-chat-row]` in the list, and a SECTION HEADING carries `data-chat-row` without
	 * `data-session-row` - so `row.closest("[data-session-row]")` was null, the control it looked for
	 * inside that row was never there, no card was raised, and the writer was never given the chance
	 * to write. Its geometry was wrong for the same reason: it straddled the clip's TOP edge, and the
	 * band takes its height off the box's BOTTOM. `scrolledArrival` builds the state QA measured and
	 * takes all three signatures of a scroll change.
	 *
	 * TWO ARRIVALS, AND THE ORDER IS THE POINT. The first presses a LIVE row above the cursor's, so
	 * that row LEAVES the list and the cursor's row CHANGES SLOT - the one input `holdFocusedRow`'s
	 * gate needs before it will correct at all - while the box gives the offer's band away. The
	 * second presses the REFUSED row: QA's own case, a 142px refusal that takes nothing out of the
	 * list, so the cursor's slot is unchanged and the acceptance reading has clean rows to compare.
	 * Both are needed to say which of the two candidate writers a scroll change has.
	 */
	const scrolledArrivalReading = await scrolledArrival(cdp, {
		label: "the refusal's band arrives on a list the reader is standing in",
		cap: "200px",
		scroll: 20,
		press: { selector: claimedRow },
	});
	note(
		"the band's arrival on a scrolled list, with the writer trapped (QA round 4, Q-9)",
		JSON.stringify(scrolledArrivalReading),
	);
	/*
	 * THE CLAUSES, READ OFF THE ARRIVAL. The base is the list's own band-0 box as this probe
	 * measured it (its cap, read after the resize commit that makes the app measure it), because the
	 * yield the ruling states is that box less the band.
	 *
	 * THE HALF THIS FIXTURE CANNOT REACH, stated rather than implied: `holdFocusedRow`'s gate needs
	 * the cursor's row to CHANGE SLOT, and after this walk the list holds two session rows - the
	 * claimed one and the unread one - so there is no live row ABOVE the cursor's to take out and
	 * the slot cannot change here. QA's own scene reached that state (their fixture keeps four rows
	 * and a `contentBefore` of 256); this scene's unit cell pins that half instead, in
	 * `scripts/sidebar-focus-hold.test.mjs`: one commit in which a row arrives above the cursor's
	 * while the box gets shorter, which reads `scrollTop 100 !== 0` on the head this change
	 * replaces and passes with it - paired with the same re-file under an unchanged box, which is
	 * followed on both heads (U1).
	 *
	 * WHAT THIS ARRIVAL DOES SHOW, and it is the state the ruling names: a list that OVERFLOWS AT
	 * REST, the reader wheeled off the top, a cursor row that reads `partly` before the press and
	 * `outside` after it - because the band took its height off the box, the exact geometry the
	 * pre-fix gate read as "the row left" - and the reader's `scrollTop` byte-equal across it IN
	 * EVERY SAMPLED FRAME, no write on the container, the list's extent byte-equal as well, every
	 * row at the same top with nothing taken out, and the yield exact (design round 8, D27's
	 * acceptance reading).
	 */
	const arrivalReadingNow = arrivalReading(
		scrolledArrivalReading,
		scrolledArrivalReading.before?.box?.height ?? null,
	);
	check(
		"the scrolled arrival is set up in QA's own state: the list overflows at rest, the reader's scroll is off the top, a row that starts inside holds focus, and the press raises the card",
		arrivalReadingNow.stateOk,
		JSON.stringify(arrivalReadingNow.state),
	);
	check(
		"and the band's arrival is the geometry QA measured: the cursor's row sits `partly` in the panel before the press and `outside` after it, because the band's height came off the box rather than off the rows",
		arrivalReadingNow.geometryOk,
		JSON.stringify(arrivalReadingNow.geometry),
	);
	check(
		"and the band's arrival leaves the reader's scroll where they put it: scrollTop is byte-equal across it, at the ends AND in every sampled frame (QA round 4, Q-9's clause; design round 8, D27's reading)",
		arrivalReadingNow.scrollHeld,
		JSON.stringify(arrivalReadingNow.scroll),
	);
	check(
		"and the position is held in EVERY frame the probe sampled, not only in the two the walk reads: the clamp this clause is about is instantaneous, so a pair that agreed could hide a frame that took it and gave it back",
		arrivalReadingNow.framesHeld,
		JSON.stringify(arrivalReadingNow.frames),
	);
	check(
		"and the list's extent is byte-equal across the press: nothing takes `scrollHeight` below the box, so the browser's clamp has nothing to act on",
		arrivalReadingNow.extentHeld,
		JSON.stringify(arrivalReadingNow.extent),
	);
	check(
		"and nothing writes the list's own scrollTop as the band arrives: the trap is empty across the press, so the writer is named rather than inferred",
		arrivalReadingNow.trapped && arrivalReadingNow.writes.length === 0,
		JSON.stringify({
			trapped: arrivalReadingNow.trapped,
			writes: arrivalReadingNow.writes,
			samples: arrivalReadingNow.scroll.samples,
			mutations: arrivalReadingNow.scroll.mutations,
		}),
	);
	check(
		"and every row on screen at the press is at the same top after it, with nothing taken out of the list at all: the band's arrival translates nothing and the press changes no membership (design round 8, D27)",
		arrivalReadingNow.rowsHeld,
		JSON.stringify(arrivalReadingNow.rows),
	);
	check(
		"and the yield is still exact: the list's box is its band-0 box less the band, and the entity region above holds its box and its scroll",
		arrivalReadingNow.yieldExact && arrivalReadingNow.entitiesHeld,
		JSON.stringify(arrivalReadingNow.yield),
	);
	await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => null);
	await wait(300);
	check(
		"and the walk leaves the list as the fixture describes it: the refusal's own Retry lands the unarchive, so no row is left archived by this sequence",
		undoCleared.timedOut === false &&
			typeof restoredLabel === "string" &&
			restoredLabel.startsWith("Archive"),
		`lane cleared in ${undoCleared.waitedMs}ms, label now ${JSON.stringify(restoredLabel)}`,
		/*
		 * THE PASS-SIDE READING, so a green run still says WHERE the press went and WHAT the store
		 * did across it (`observed` is the half a passing check prints; `detail` is the failure's).
		 * The box is the settled one the press used - the two reads the press waited for agreed on
		 * it - and the counter is the app's own write stamp, which a press that reached nothing
		 * leaves where it was.
		 */
		`the Retry was pressed at ${JSON.stringify(retryAt.box.centre)} (two reads ${retryAt.settledMs}ms apart agreed on that box) and the store's write counter went ${attemptsBeforeRetry} -> ${attemptsAfterRetry}; lane cleared in ${undoCleared.waitedMs}ms, label now ${JSON.stringify(restoredLabel)}`,
	);

	/*
	 * AND THE ACCEPTED PRESS, WHICH IS THE ARRIVAL THE CLAUSE IS WRITTEN FOR (design round 9, D30).
	 *
	 * The reading above this one is the REFUSAL's, and the round is right that it cannot answer the clause:
	 * nothing leaves the list there, so its extent reads 241 in every sample and the departure's own question -
	 * what happens to the reader while a row's height leaves - is never asked. The row this press addresses is
	 * the one whose archive the committed stub ACCEPTS (`b3f1a09c7d52`, "Quarterly retention sweep": the stub's
	 * `refuse_unarchive_once` row, archive accepted, first unarchive refused - the row the refusal step presses
	 * is the `live_claim` one, which refuses every write).
	 *
	 * WHAT THE CLAUSE ASKS, in the round's own words: the extent may shrink only in the sample that also shrinks
	 * the box. The band's HEIGHT is panel state written by an observer that runs after sonner mounts the card,
	 * so at the settlement commit the row's own height is gone from the extent while the box is still the
	 * band-0 one - and whether that leaves a range under the reader's position is exactly what this reading
	 * decides, rather than a note that claims it.
	 */
	const acceptedRow = "[aria-label='Archive “Quarterly retention sweep”']";
	const acceptedArrivalReading = await scrolledArrival(cdp, {
		label: "the accepted press departs from a list the reader is standing in",
		cap: "200px",
		scroll: 20,
		/*
		 * THE CURSOR STANDS ON A ROW THAT STAYS (`REFUSED_ID`, the earlier of the two rows the end of this
		 * walk has left), so the departure happens under the reader's own position and the hold has no
		 * correction to make - the clause is about the reader's position, and a correction is a different
		 * reading (the unit cell in `scripts/sidebar-focus-hold.test.mjs` carries the slot-change case).
		 *
		 * WHY NOT THE DOCSTRING'S EXACT SHAPE - "a live row ABOVE the cursor's": the committed fixture
		 * cannot produce it at this head, and that is a fact about its rows rather than about the clause.
		 * The list holds two session rows here: `REFUSED_ID` (the `live_claim` row, whose every write the
		 * stub REFUSES on purpose) and `REFUSED_UNDO_ID` (whose archive is accepted). The accepting row is
		 * therefore LAST, and the only row above the cursor's is the one that refuses - so the departure is
		 * driven with the cursor on the row that stays and the pressed row immediately below it, which is
		 * the same departure read from the other side of it.
		 */
		cursor: REFUSED_ID,
		press: { selector: acceptedRow },
	});
	note(
		"the accepted press on a scrolled list, with the writer trapped (design round 9, D30)",
		JSON.stringify(acceptedArrivalReading),
	);
	const acceptedNow = arrivalReading(
		acceptedArrivalReading,
		acceptedArrivalReading.before?.box?.height ?? null,
		"the pressed row",
	);
	check(
		"the accepted press is set up in the same state: the list overflows at rest, the reader's scroll is off the top, the pressed row is on screen and it is the row the daemon takes",
		acceptedNow.stateOk,
		JSON.stringify({ state: acceptedNow.state, rows: acceptedNow.rows }),
	);
	check(
		"and the accepted departure does not take the reader with it: scrollTop is byte-equal in every sampled frame (design round 9, D30's reading)",
		acceptedNow.scrollHeld,
		JSON.stringify(acceptedNow.scroll),
	);
	check(
		"and the extent shrinks only in a sample that also shrinks the box, so the list's own maximum scroll never falls under the reader: the clause exactly as the round states it",
		acceptedNow.extentPairedWithBox && acceptedNow.rangeHeld,
		JSON.stringify({
			extent: acceptedNow.extent,
			shrunk: acceptedNow.shrunkExtent,
			unreachable: acceptedNow.unreachable,
			frames: acceptedNow.frames,
		}),
	);
	check(
		"and the one row that departs is the row the reader pressed, with every surviving row keeping its top and nothing writing the container",
		acceptedNow.stateOk &&
			acceptedNow.rowsHeldLeaving &&
			acceptedNow.trapped &&
			acceptedNow.writes.length === 0,
		JSON.stringify({
			rows: acceptedNow.rows,
			writes: acceptedNow.writes,
			mutations: acceptedNow.scroll.mutations,
		}),
	);
	check(
		"and the yield is exact after an accepted press too: the list's box is its band-0 box less the band the card settled at",
		acceptedNow.yieldExact && acceptedNow.entitiesHeld,
		JSON.stringify(acceptedNow.yield),
	);
	await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => null);
	await wait(300);

	check(
		"every capture is a frame the app held still for, with no toast on it",
		frames.every((frame) => frame.stable === true && frame.toastFree === true),
		frames.map((frame) => `${frame.label}: stable=${frame.stable}`).join(" | "),
	);
	check(
		"every frame of a toast is a held-still picture of one that was really there",
		offerFrames.length === 3 &&
			offerFrames.every(
				(frame) => frame.stable === true && frame.toastOnScreen === true,
			),
		JSON.stringify(
			offerFrames.map((frame) => ({
				label: frame.label,
				stable: frame.stable,
				toast: frame.toastOnScreen,
			})),
		),
	);
	check(
		"every capture wrote a PNG of the requested size",
		frames.every(
			(frame) =>
				frame.bytes > 1000 &&
				frame.pixels.width ===
					frame.viewport.width * frame.viewport.devicePixelRatio,
		),
		frames.map((f) => `${f.label}: ${f.bytes}B`).join(" | "),
	);
	return frames;
}

/**
 * The row's horizontal budget, read from the running app rather than from classes.
 *
 * WHY EVERY NUMBER HERE IS A MEASUREMENT. The claim this set exists to state is
 * "the row spends N px on controls it is not drawing at panel width W", and N is a
 * consequence of four things no single class names: the panel's `p-2`, the row
 * box's `gap-1`, the button's own `px-1`, its leading status slot and the gap
 * after it, and which of the pair / shared trigger the container query drew at
 * that width. So the read returns BOXES - every element's own rect, the title's
 * `scrollWidth` against its `clientWidth`, and the computed `opacity` that says
 * whether a reserved box has anything in it - and the scene does the arithmetic
 * and writes it beside the frames.
 */
/**
 * Whether two boxes share no pixels, or `null` when either was not on screen.
 *
 * `null` rather than `true`: a missing box is not a clearance, and a caller that treats
 * it as one asserts nothing at all. Two scenes ask this question about an overlay and the
 * composer (`session-archive`'s Undo offer, `row-space`'s archive offer), so it is stated
 * once rather than re-derived beside each call site.
 */
const disjointBoxes = (a, b) =>
	a === null || b === null
		? null
		: a.right <= b.left ||
			b.right <= a.left ||
			a.bottom <= b.top ||
			b.bottom <= a.top;

function rowSpaceGeometry(cdp, ids) {
	return cdp.evaluate(`(() => {
		const round = (n) => Math.round(n * 100) / 100;
		const box = (node) => {
			if (!node) return null;
			const r = node.getBoundingClientRect();
			return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height), centre: { x: round(r.left + r.width / 2), y: round(r.top + r.height / 2) } };
		};
		const control = (node) => {
			if (!node) return null;
			const style = getComputedStyle(node);
			const r = node.getBoundingClientRect();
			/*
			 * PAINTED, not merely transparent-or-not: an element inside a display: none
			 * wrapper still answers opacity 1, so opacity alone would call a control that
			 * is not drawn painted - measured on this set's own first run, which reported
			 * the 240 band's pin as painted while its box was 0x0. A box with no pixels in
			 * it is not drawn, whatever its opacity says. The acts are switched by
			 * display now, so this reading is the one that discriminates them.
			 */
			return { ...box(node), opacity: round(Number(style.opacity)), display: style.display, ink: style.color, pointerEvents: style.pointerEvents, painted: style.display !== "none" && Number(style.opacity) > 0 && r.width > 0 && r.height > 0 };
		};
		const rows = ${JSON.stringify(ids)}.map((id) => {
			const node = document.querySelector('[data-session-row="' + id + '"]');
			if (!node) return { id, present: false };
			const button = node.querySelector('button[data-tour-tag="chat-session-row"]');
			const status = button ? button.firstElementChild : null;
			const title = node.querySelector("[data-session-title]");
			const titleStyle = title ? getComputedStyle(title) : null;
			/*
			 * THE TEXT BOX INSIDE THE CLIP BOX, which is where the pan writes: the outer
			 * element is the clip the row's flex layout sizes (and the box the mask is
			 * drawn against), and the inner one carries the transform. Reading the
			 * transform off the clip would report none through a whole pan.
			 */
			const text = title ? title.querySelector("[data-session-title-text]") : null;
			const textStyle = text ? getComputedStyle(text) : null;
			return {
				id,
				present: true,
				pinned: node.querySelector("[data-session-pin]") ? node.querySelector("[data-session-pin]").getAttribute("aria-pressed") === "true" : null,
				current: button ? button.getAttribute("aria-current") : null,
				text: button ? button.textContent.replace(/\\s+/g, " ").trim() : null,
				row: box(node),
				button: box(button),
				status: box(status),
				title: title
					? {
							...box(title),
							text: title.textContent,
							scrollWidth: round(title.scrollWidth),
							clientWidth: round(title.clientWidth),
							overflows: title.scrollWidth - title.clientWidth > 0.5,
							ink: titleStyle.color,
							maskImage: titleStyle.maskImage,
							/* The clip box's own transform, which the pan never writes. */
							transform: titleStyle.transform,
							textTransform: textStyle ? textStyle.transform : null,
							textWidth: text ? round(text.getBoundingClientRect().width) : null,
						}
					: null,
				pin: control(node.querySelector("[data-session-pin]")),
				archive: control(node.querySelector("[data-session-archive]")),
				pair: box(node.querySelector("[data-session-control-pair]")),
			};
		});
		const panel = document.querySelector('nav[aria-label="Chats"]');
		/*
		 * THE OFFER, AS THE LANE DRAWS IT NOW (design D11): the panel mounts its own sonner
		 * container, and sonner marks which lane a container is with data-x-position -
		 * the global one is right, this one left. The register's own anchors
		 * (data-session-archive-undo / -failure) went with the register.
		 */
		const lane = document.querySelector('[data-sonner-toaster][data-x-position="left"][data-y-position="bottom"]');
		const toast = document.querySelector(${JSON.stringify(SIDEBAR_TOAST)});
		return {
			viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
			/*
			 * HOW MANY TOASTS EXIST AND HOW MANY ARE DRAWN, which is the only way to state
			 * the lane's claim honestly: sonner 2.0.3 draws every mounted container's copy
			 * of every toast, so the app's stylesheet narrows that down to the one the
			 * reader sees, and painted (a box with pixels in it) is the reading that
			 * discriminates a drawn toast from a suppressed duplicate.
			 */
			toasts: {
				total: document.querySelectorAll("[data-sonner-toast]").length,
				painted: Array.from(document.querySelectorAll("[data-sonner-toast]")).filter((node) => node.getBoundingClientRect().width > 0 && getComputedStyle(node).display !== "none").length,
			},
			panel: box(panel),
			panelPadding: panel ? getComputedStyle(panel).padding : null,
			/*
			 * THE FLYOUT, WHICH NOTHING HERE MEASURED BEFORE and which the scene therefore
			 * could not fail on (design round 1, D2: two committed frames carried ANOTHER
			 * row's flyout while the pointer was elsewhere, and no field covered it).
			 *
			 * Selected by the app's own hook on the primitive's panel ("data-lo-tooltip-panel",
			 * which "tooltip.tsx" states is there for exactly this), restricted to the one
			 * the primitive reports as OPEN - Radix leaves the closed ones mounted. The
			 * title is read off the panel's FIRST line, which is the full title the row's own
			 * clip box cannot show: comparing it against the hovered row's own "[data-session-title]"
			 * is what makes "this flyout is about THAT row" a reading rather than an assumption.
			 */
			flyout: (() => {
				const open = Array.from(document.querySelectorAll('[data-lo-tooltip-panel]')).find((node) => {
					const state = node.getAttribute('data-state');
					return (state === 'delayed-open' || state === 'instant-open') && node.getBoundingClientRect().width > 0;
				});
				if (!open) return null;
				const line = open.querySelector('span');
				const r = open.getBoundingClientRect();
				return {
					...box(open),
					state: open.getAttribute('data-state'),
					title: line ? (line.textContent || '').trim() : null,
					text: (open.textContent || '').replace(/\\s+/g, ' ').trim(),
					fitsViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
				};
			})(),
			offer: {
				lane: box(lane),
				toast: box(toast),
				text: toast ? toast.textContent.replace(/\\s+/g, " ").trim() : null,
			},
			split: box(document.querySelector("[data-sidebar-split]")),
			/*
			 * THE COMPOSER, because the offer's own frames are also the evidence for where it
			 * must NOT go: design round 2's D12 moved this offer out of the toast lane because
			 * a bottom-right toast covered the composer's Send control, and the lane's whole
			 * argument is that it cannot. Any claim about that has to state the clearance in
			 * pixels rather than in prose.
			 */
			composer: (() => {
				const send = document.querySelector('[aria-label="Send message"]');
				if (!send) return null;
				const form = send.closest("form");
				return { send: box(send), form: box(form) };
			})(),
			firstListRow: box(document.querySelector("[data-session-row]")),
			/*
			 * THE LIST REGION'S OWN SCROLLBAR GUTTER, which is 8px on this machine and is a
			 * DECISION rather than a discovery (design D12 of the row-space spec):
			 * the region reserves the gutter so a title never re-truncates because a row was
			 * added or removed, and on a system with always-on classic scrollbars that is the
			 * ~15px the operator's own screen shows. reserved is what every row pays, and the
			 * width assertions below subtract it rather than quoting a table derived on a
			 * machine where it was zero.
			 */
			list: (() => {
				const region = document.querySelector('[data-sidebar-region="chats"]');
				if (!region) return null;
				const style = getComputedStyle(region);
				return {
					offsetWidth: region.offsetWidth,
					clientWidth: region.clientWidth,
					scrollbarGutter: style.scrollbarGutter,
					reserved: region.offsetWidth - region.clientWidth,
				};
			})(),
			rows,
		};
	})()`);
}

/**
 * The per-row budget a reader can check without opening the frames: the row box,
 * the button, the leading status slot, the title's own box and whether its text
 * overflows it, and each trailing element's box with whether it is PAINTED (a
 * reserved slot with `opacity: 0` is a box with nothing in it, which is the whole
 * subject of this set).
 */
const rowSpaceBudget = (reading) =>
	reading.rows.map((row) => ({
		id: row.id,
		present: row.present,
		pinned: row.pinned ?? null,
		current: row.current ?? null,
		rowWidth: row.row ? row.row.width : null,
		rowHeight: row.row ? row.row.height : null,
		rowLeft: row.row ? row.row.left : null,
		buttonWidth: row.button ? row.button.width : null,
		statusWidth: row.status ? row.status.width : null,
		titleWidth: row.title ? row.title.width : null,
		titleLeft: row.title ? row.title.left : null,
		titleText: row.title ? row.title.text : null,
		titleOverflows: row.title ? row.title.overflows : null,
		titleScrollWidth: row.title ? row.title.scrollWidth : null,
		titleClientWidth: row.title ? row.title.clientWidth : null,
		titleClipTransform: row.title ? row.title.transform : null,
		/*
		 * THE PAN'S TWO OWN READINGS, and which box each comes from is the point: the
		 * transform is on the TEXT box (the clip box's own transform is `none` through a
		 * whole pan), and the mask is on the CLIP box (a mask that moved with the text
		 * would fade the text rather than its clip).
		 */
		titleTextTransform: row.title ? row.title.textTransform : null,
		titleTextWidth: row.title ? row.title.textWidth : null,
		titleMask: row.title ? row.title.maskImage : null,
		tailAfterTitle:
			row.title && row.row
				? Math.round((row.row.right - row.title.right) * 100) / 100
				: null,
		pairWidth: row.pair ? row.pair.width : null,
		pinWidth: row.pin ? row.pin.width : null,
		pinPainted: row.pin ? row.pin.painted : null,
		archiveWidth: row.archive ? row.archive.width : null,
		archivePainted: row.archive ? row.archive.painted : null,
	}));

/**
 * `row-space`: the sidebar row's horizontal budget, before the change.
 *
 * ## What this scene is for
 *
 * The operator's report is a PIXEL report: at a typical panel width a row's title
 * truncates early and the space to its right is empty, because two 24px control
 * boxes are reserved on every row whether or not the pointer is anywhere near it.
 * Every claim in `docs/design/sidebar-row-space.md` is a claim about that budget,
 * so this scene photographs it at the three panel widths the report is about -
 * the 240 clamp minimum, the 280 default and 320 - with the pointer OFF the row
 * and ON it, in both palettes, and writes the boxes it read beside the frames.
 *
 * ## What it runs against
 *
 * `--backend` names this set's own stand-in daemon
 * (`docs/evidence/sidebar-row-space/harness/stub-daemon.mjs`), which is the
 * archive set's responder with two rows added that the claim needs: a PINNED
 * conversation (the operator's own screenshot is of a pinned row) and a
 * conversation whose title is long enough to TRUNCATE at every width here (none
 * of the archive fixture's four titles is). The app is the real one: its own
 * catalogue read, its own store, its own sidebar.
 *
 * ## Why the panel width is written through the divider's own action
 *
 * The panel's width is the user's own preference (`chatSidebarWidth`, clamped
 * 240..360), not a function of the window, so a window resize would photograph
 * the same panel at the same width. The scene writes it the way the divider
 * writes it (`setSidebarWidth`), which is also what makes 320 reachable at all:
 * `--window-size` cannot.
 *
 * ## The pan, and why its frames wait for it to stop
 *
 * `hover-long-<w>` is the operator's own case: the pointer is on a row whose title
 * cannot fit, so the acts are revealed and the title pans. A frame is only evidence
 * here if the app HELD STILL for it (`captureSettled` requires two byte-identical
 * captures), so each of those frames is taken after the pan has reached its end and
 * stopped - the pan holds there while the pointer stays, which is exactly the state a
 * still can carry. The transform and the mask are read from the same state, so the
 * end of the pan is asserted rather than asserted-about.
 *
 * The three moving states a still cannot carry are read instead: a title that FITS
 * (`hover-short-280` - no transform, no mask, ever), the instant after the pointer
 * leaves a row it had panned (`pan-reset-280`), and a row the pointer crossed faster
 * than the dwell (`pan-swept-280`). Nothing moves in any of them, and each is one
 * reading rather than a frame.
 *
 * ## The offer
 *
 * `offer-toast-280` is of the archive offer, in the state the operator reported: it is
 * taken after a REAL press on a row's archive control, with the pointer parked off the
 * row afterwards, because the offer is a statement about the LIST rather than about the
 * pointer. The offer is the panel's own toast lane now (design D11), so the frame is
 * also the evidence for where it must NOT go: the scene asserts the toast's box is
 * inside the panel's own box and disjoint from the composer's form and its Send
 * control, which is the constraint design round 2's D12 turned on and the reason the
 * offer left the register in the first place.
 *
 * The row is put back through the offer's own Undo before the scene ends, so a second
 * palette's run photographs the list the fixture describes rather than a list the first
 * run emptied.
 *
 *   node scripts/renderer-driver.mjs --scene row-space \
 *     --backend http://127.0.0.1:18234 --backend-records /tmp/row-space-stub-records \
 *     --seed-onboarding-complete --theme localOperatorDark --out /tmp/row-space-dark
 */
async function sceneRowSpace(cdp) {
	const frames = [];
	/*
	 * The offer's frame is of a TRANSIENT, and `captureSettled` structurally refuses one
	 * (`toastFree`). It carries its own checks - the toast is on screen and the picture
	 * is held still - rather than being exempted from the assertions silently.
	 */
	const offerFrames = [];
	const geometry = {};
	const UNPINNED = "b3f1a09c7d52";
	const SHORT = "7c1b0f2a4d31";
	const PINNED = "c4e17b90a2f6";
	const CURRENT = "2d5ad5da0025";
	const IDS = [UNPINNED, SHORT, PINNED, CURRENT];
	/*
	 * U6 IN THE APP (manager, pass 7 - the major the whole reveal rests on).
	 *
	 * A pinned row draws its mark AT REST, so the reader can aim at a control that is on screen
	 * before any pointer arrives. If the acts' appearance shifts that mark, the box the reader
	 * aimed at belongs to something else by the time they press - and in this design the thing
	 * that lands on it is ARCHIVE, i.e. a state toggle becomes a destructive action. Two readings
	 * settle it: the mark's box before and under the pointer (identical, not merely same-size),
	 * and what a press at the RESTING centre does to the row's own archived fact. The pin may
	 * flip - that is a legitimate answer - but the conversation must not be archived.
	 */
	await parkPointer(cdp);
	const markRow = `[data-session-row="${PINNED}"] [data-session-pin]`;
	const archivedFactOf = async () =>
		cdp.evaluate(
			`(() => { const row = document.querySelector('[data-session-row="${PINNED}"]'); return row ? row.getAttribute("data-session-archived") : "row-absent"; })()`,
		);
	/*
	 * THE DAEMON'S OWN LOG, ASKED ONE WAY. Two clauses want it - the U6 press below, and the
	 * scene's closing read that turns "no archive for this conversation anywhere in the run"
	 * from a claim into a reading - and a second spelling of the same question would be a second
	 * instrument. The source is the STUB's stdout, which is where the app's writes are visible;
	 * this fixture's DOM cannot stand in for it, because an unpin moves the row into a section
	 * that is not mounted and `row-absent` is not evidence of an archive.
	 */
	const stubWrites = async (id) => {
		const nano = await import("node:fs");
		const lines =
			STUB_LOG && nano.existsSync(STUB_LOG)
				? nano.readFileSync(STUB_LOG, "utf8").split("\n")
				: [];
		return {
			pins: lines.filter((line) => line.includes(`/sessions/${id}/pin`)).length,
			archives: lines.filter((line) => line.includes(`/sessions/${id}/archive`))
				.length,
		};
	};
	/*
	 * THE RESTING READ COMES BEFORE THE HOVER, AND THAT ORDERING IS THE CHECK. Pass 16's clause
	 * read the archive control's own box - the right element - but did it AFTER this block hovered
	 * the row, so what it called "at rest" was measured with the pointer already on it (it saw
	 * `archiveDisplay: "flex", archiveWidth: 24`). Read here, before any pointer movement.
	 *
	 * AND THE UNPINNED ROW IS READ BESIDE IT, which on this head reads `rowWidth null`: at this
	 * point in the scene the unpinned rows live in the `Previous chats` section, which is still
	 * collapsed, so the comparison the earlier form of this clause was written for is not
	 * available here and the clause stands on the pinned row alone. The note prints both
	 * readings, so which one settled it is visible rather than assumed - and the unpinned half
	 * is asserted where it IS mounted, by the rest frames' own checks below.
	 */
	const restingCost = {
		pinned: await readArchive(PINNED),
		unpinned: await readArchive(UNPINNED),
	};
	note("U6 the pinned row's resting cost", JSON.stringify(restingCost));
	const markAtRest = await verb(cdp, "measure", markRow);
	const archivedBefore = await archivedFactOf();
	await hoverOver(cdp, `[data-session-row="${PINNED}"]`);
	await wait(600);
	const markUnderPointer = await verb(cdp, "measure", markRow);
	/*
	 * CENTRES, AND NOT ONLY CENTRES (R4-2). Two `display: none` readings are both `0x0` at (0,0), so
	 * a centres-only comparison passes on a mark that is not drawn at all - which is the state this
	 * clause exists to rule out. The boxes are asserted non-zero as well, the way the restore clause
	 * below asserts its own.
	 */
	check(
		"U6: the pinned row's mark does not move when the pointer arrives",
		markAtRest.rect.width > 0 &&
			markAtRest.rect.height > 0 &&
			markUnderPointer.rect.width > 0 &&
			markUnderPointer.rect.height > 0 &&
			markAtRest.centre.x === markUnderPointer.centre.x &&
			markAtRest.centre.y === markUnderPointer.centre.y,
		`at rest ${markAtRest.centre.x},${markAtRest.centre.y} ${markAtRest.rect.width}x${markAtRest.rect.height} -> under the pointer ${markUnderPointer.centre.x},${markUnderPointer.centre.y} ${markUnderPointer.rect.width}x${markUnderPointer.rect.height}`,
	);
	/*
	 * WHAT IS THERE, AND WHAT IS DRAWN THERE, ARE DIFFERENT QUESTIONS. Two readings say the mark's
	 * box does not move and a press at it still archives; only a hit test says which way round it
	 * is - whether Archive is drawn on the mark's old box, is hit-testable there while invisible,
	 * or merely ordered above the mark. Read it before touching the layout (manager, pass 8).
	 */
	const descend = (el) =>
		el
			? (() => {
					const chain = [];
					let node = el;
					while (node && chain.length < 6) {
						const marks = [
							node.hasAttribute?.("data-session-pin")
								? "[data-session-pin]"
								: "",
							node.hasAttribute?.("data-session-archive")
								? "[data-session-archive]"
								: "",
							node.hasAttribute?.("data-session-control-pair")
								? "[data-session-control-pair]"
								: "",
						].join("");
						chain.push(node.tagName.toLowerCase() + marks);
						node = node.parentElement;
					}
					return `${chain.join(" < ")} | pointer-events: ${getComputedStyle(el).pointerEvents}`;
				})()
			: "null";
	const hitAtMarkCentre = await cdp.evaluate(
		`(${descend.toString()})(document.elementFromPoint(${markUnderPointer.centre.x}, ${markUnderPointer.centre.y}))`,
	);
	note(
		"U6 hit target at the mark's resting centre (pointer on the row)",
		hitAtMarkCentre,
	);
	/*
	 * A DECLARATION RATHER THAN A `const` ARROW, and that is what makes the ordering above legal:
	 * the resting read sits BEFORE any pointer movement, which is what the check is about, while
	 * the block that moves the pointer sits here with it. A hoisted declaration lets the read keep
	 * that position without dragging the pointer steps up with it - and it MUST return: an arrow
	 * body returned the `evaluate` promise implicitly, a braced body does not, and a body that
	 * merely calls `evaluate` hands every caller `undefined`.
	 */
	async function readArchive(id) {
		return cdp.evaluate(`(() => {
			const row = document.querySelector('[data-session-row="' + ${JSON.stringify(id)} + '"]');
			const archive = row ? row.querySelector("[data-session-archive]") : null;
			const box = archive ? archive.getBoundingClientRect() : null;
			return {
				rowWidth: row ? row.getBoundingClientRect().width : null,
				archivePresent: archive !== null,
				archiveDisplay: archive ? getComputedStyle(archive).display : null,
				archiveWidth: box ? box.width : 0,
			};
		})()`);
	}
	check(
		"U6: the pinned row at rest costs the pin alone (the archive is not reserving a slot)",
		restingCost.pinned.archiveWidth === 0 &&
			(restingCost.pinned.archiveDisplay === null ||
				restingCost.pinned.archiveDisplay === "none") &&
			restingCost.pinned.rowWidth > 0 &&
			/*
			 * AND THE UNPINNED HALF IS ASSERTED WHERE IT IS MOUNTED (the dead-reading nit): it reads
			 * `rowWidth null` here because its section is still collapsed, so the naive form would fail
			 * on the FIXTURE rather than on the app. Both spellings are the clause's claim - "not
			 * mounted" and "mounted with nothing reserved" - and neither of them is "not read".
			 */
			(restingCost.unpinned.rowWidth === null ||
				(restingCost.unpinned.archiveWidth === 0 &&
					(restingCost.unpinned.archiveDisplay === null ||
						restingCost.unpinned.archiveDisplay === "none"))),
		JSON.stringify(restingCost),
	);
	/* AIMED AT THE VISIBLE MARK: the resting centre, which is where a reader's pointer already is. */
	await pressPointerStationary(cdp, markAtRest.centre.x, markAtRest.centre.y);
	await wait(700);
	const archivedAfter = await archivedFactOf();
	const pinAfter = await cdp.evaluate(
		`(() => { const el = document.querySelector('${markRow}'); return el ? el.getAttribute("aria-pressed") : null; })()`,
	);
	check(
		"U6: the hit target at the mark's resting centre is the mark itself, not the archive",
		/*
		 * THE CHAIN IS INNERMOST-FIRST, and that is why the first version of this clause was
		 * false: it required the string to START with the button, but `elementFromPoint` returns
		 * the DEEPEST node, so the chain reads `path < svg < button[data-session-pin] < ...`. The
		 * assertion is that the button is IN the chain and that no archive control is above it.
		 */
		hitAtMarkCentre.includes("button[data-session-pin]") &&
			!hitAtMarkCentre.includes("data-session-archive]"),
		hitAtMarkCentre,
	);
	/*
	 * ACTION IDENTITY, ON THE SIGNAL THE APP ACTUALLY HAS. `chat-sidebar.tsx` writes
	 * `data-session-archived={archived ? "true" : undefined}`: the attribute is ABSENT unless the
	 * conversation is archived, so reading `null` was correct all along and the mistake was
	 * downstream - an ABSENT ROW was being treated as proof of an archive.
	 *
	 * AND THE ROW CAN ABSOLUTELY LEAVE THE DOCUMENT (R4-5, corrected - the sentence here used to
	 * claim the opposite). An unpin moves it out of `Pinned chats` into a section that is COLLAPSED
	 * by default, and a collapsed section draws no rows: this run's own reading is
	 * `"archivedAfter":"row-absent"` for a press that archived nothing at all. That is exactly why
	 * the presence form cannot carry this clause and why the assertion below reads the daemon's log
	 * instead; it is also why the previous clause was unreachable as written (`leftBecauseUnpinned`
	 * required `pinAfter !== null`, and a row that is gone has no pin left to read).
	 */
	/*
	 * ASSERT WHAT THE DAEMON SAW. A DOM-presence form cannot carry this fixture: an unpin moves the
	 * row into a section this scene does not render, so `row-absent` is not evidence of an archive,
	 * and pressing the same coordinates a second time lands on whatever now holds that position -
	 * measured in pass 16, where both presses read `row-absent` and the second was as likely to hit
	 * a neighbour as the mark. An instrument that can press a neighbouring row is worse than no
	 * assertion at all. So the source is the request log: pressing the mark's centre must issue a
	 * `pin` request for THIS session id and NO archive request for it anywhere in the run.
	 */
	const archived = archivedAfter === "true";
	const { pins: pinWrites, archives: archiveWrites } = await stubWrites(PINNED);
	check(
		"U6: a press at the visible mark's centre does NOT archive the conversation",
		!archived && pinWrites >= 1 && archiveWrites === 0,
		JSON.stringify({
			archivedBefore,
			archived,
			pinAfter,
			pinWrites,
			archiveWrites,
			stubLog: STUB_LOG,
			reason: STUB_LOG
				? null
				: "no --stub-log given, so the write could not be read",
		}),
	);

	const WIDTHS = [240, 280, 320];
	/*
	 * THE DWELL, AND THE LONGEST A PAN CAN RUN AT THESE WIDTHS. The dwell is
	 * `TOOLTIP_DELAY_MS` (400ms, the provider the flyout and the pan share), and the pan
	 * is capped at `overflow / 8s` - 8s is its ceiling, and the widest overflow
	 * photographed here (201px at 240) finishes in 6.3s at the 32px/s floor. Waiting the
	 * ceiling rather than the arithmetic keeps this reading independent of the fixture's
	 * exact string: a longer title would only make the wait generous.
	 */
	const DWELL_MS = 400;
	const PAN_CEILING_MS = 8_000;

	const hello = await verb(cdp, "hello");
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
	if (THEME) {
		await verb(cdp, "setTheme", THEME);
		const themed = await verb(cdp, "state");
		check(
			`the app is in the palette this run photographs (${THEME})`,
			themed.theme === THEME,
			`theme is ${themed.theme}`,
		);
	}

	await verb(cdp, "navigate", "/chat");
	const state = await verb(cdp, "state");
	check(
		"the catalogue answered and the panel is drawing its rows",
		state.sessionCount >= 4,
		`sessionCount is ${state.sessionCount}`,
	);

	/*
	 * THE `Previous chats` SECTION IS COLLAPSED BY DEFAULT, and a scene that only
	 * navigates therefore photographs a panel holding the pinned row and the
	 * running one - measured here, and the reason this expansion is part of the
	 * scene rather than of the fixture. It is opened with the reader's own gesture
	 * through the section's own hook (`data-chat-section`), and only when it is
	 * shut: a press on an open disclosure would close it.
	 */
	const previousOpen = await cdp.evaluate(
		`(() => { const button = document.querySelector('[data-chat-section="previous"]'); return button ? button.getAttribute("aria-expanded") === "true" : null; })()`,
	);
	if (previousOpen === false) {
		await clickAt(cdp, '[data-chat-section="previous"]');
		await wait(500);
	}
	note(
		"the Previous chats section",
		previousOpen === true ? "was already expanded" : "expanded by this scene",
	);

	/*
	 * OPEN A CONVERSATION BEFORE ANYTHING IS PHOTOGRAPHED, and both halves of this
	 * set need it. The panel's CURRENT row is a row class with its own ground (the
	 * hover step is dropped on it), so a set with nothing open has no current row to
	 * photograph. And the offer frame's subject is a toast that must not land on the
	 * composer, which has to be on screen for that frame to be about anything:
	 * measured, the composer is mounted only with a conversation open.
	 *
	 * It is the reader's own gesture, through the row's own button.
	 */
	await clickAt(cdp, `[data-session-row="${CURRENT}"] [data-chat-row]`);
	await wait(900);
	await parkPointer(cdp);

	const panelRows = await cdp.evaluate(
		`Array.from(document.querySelectorAll("[data-session-row]")).map((node) => ({ id: node.getAttribute("data-session-row"), title: node.querySelector("[data-session-title]") ? node.querySelector("[data-session-title]").textContent : null, rowButton: node.querySelector("[data-chat-row]") !== null, pin: node.querySelector("[data-session-pin]") !== null, archive: node.querySelector("[data-session-archive]") !== null, pair: node.querySelector("[data-session-control-pair]") !== null, actions: node.querySelector("[data-session-actions]") !== null }))`,
	);
	note("rows on the panel", JSON.stringify(panelRows, null, 2));
	check(
		"the four rows this set measures are all on the panel",
		["b3f1a09c7d52", "7c1b0f2a4d31", "c4e17b90a2f6", "2d5ad5da0025"].every(
			(id) => panelRows.some((row) => row.id === id && row.rowButton === true),
		),
		JSON.stringify(panelRows.map((row) => row.id)),
	);
	/*
	 * AND THE RETIRED SHED IS GONE FROM THE REAL DOM, not only from the source: the
	 * shared control and its menu were the narrow band's answer to a rest cost that no
	 * longer exists (design D9), and a frame cannot show an absent element.
	 */
	check(
		"no row carries the retired shared control's anchor any more",
		panelRows.every((row) => row.actions !== true),
		JSON.stringify(panelRows.map((row) => row.actions)),
	);

	/*
	 * PUT THE FIXTURE'S PIN BACK, BECAUSE THE U6 PRESS EARLIER TOOK IT - and this is the first
	 * place in the scene where that is possible at all.
	 *
	 * WHAT WENT WRONG WITHOUT THIS, measured on this head and recorded so nobody has to find it
	 * twice: the U6 press above is aimed at the pinned row's mark, and the pin FLIPS - "the pin
	 * may flip, that is a legitimate answer". From that press onward this run's fixture was an
	 * UNPINNED conversation wearing a pinned row's name: the rest frames read `"pinned":false,
	 * "pinWidth":0, "titleWidth":188` for the row the set calls PINNED, the acts' budget read
	 * 56/56 because both of its frames were of that same unpinned row, and the keyboard walk's Tab
	 * landed on a control labelled `Pin "..."` with `aria-pressed "false"` - four checks failing
	 * against a state the instrument had moved, none of them about the layout or about the app.
	 *
	 * WHY THE RESTORE IS HERE RATHER THAN AT THE PRESS: an unpinned row leaves the `Pinned chats`
	 * section for `Previous chats`, and that section is COLLAPSED by default - so immediately
	 * after the press the row is not in the document at all (the press clause's own reading says
	 * it: `"archivedAfter":"row-absent"`) and there is nothing to press. The expansion above is
	 * what brings the row back, and the scene cannot avoid the press itself: U6's whole claim is a
	 * press at the mark's resting centre. So the state the press moved is put back, the way the
	 * offer step puts its own row back through the offer's Undo rather than leaving the list
	 * emptied.
	 *
	 * THE PRESS IS AIMED THE WAY U6 INSISTS ON. The pointer goes on the row first (an unpinned
	 * row's acts exist only once revealed), then the mark's own box is read twice with a settle
	 * between - a pre-reveal read returns 0x0 and sends a press to (0,0), the instrument failure
	 * this set has already paid for twice - and the hit test at its centre is asked to BE the mark
	 * before a stationary press lands there. Both halves are asserted: the aiming here, and the
	 * state it reached below. A press that missed the mark would surface as an archive request
	 * against this conversation in the scene's closing read.
	 */
	await hoverOver(cdp, `[data-session-row="${PINNED}"]`);
	await wait(300);
	await hoverOver(cdp, `[data-session-row="${PINNED}"] [data-session-pin]`);
	await wait(200);
	const restoreMark = await verb(
		cdp,
		"measure",
		`[data-session-row="${PINNED}"] [data-session-pin]`,
	);
	await wait(200);
	const restoreMarkAgain = await verb(
		cdp,
		"measure",
		`[data-session-row="${PINNED}"] [data-session-pin]`,
	);
	check(
		"the fixture's pin can be put back: the mark is drawn at a non-zero, stable box and the hit test at its centre is the mark itself",
		restoreMark.rect.width > 0 &&
			restoreMark.rect.height > 0 &&
			restoreMark.centre.x === restoreMarkAgain.centre.x &&
			restoreMark.centre.y === restoreMarkAgain.centre.y &&
			restoreMark.hitTest === true,
		JSON.stringify({
			before: restoreMark.rect,
			after: restoreMarkAgain.rect,
			hitTest: restoreMark.hitTest,
		}),
	);
	await pressPointerStationary(
		cdp,
		restoreMarkAgain.centre.x,
		restoreMarkAgain.centre.y,
	);
	await wait(700);
	const repinState = await cdp.evaluate(
		`(() => {
			const row = document.querySelector('[data-session-row="${PINNED}"]');
			const pin = row ? row.querySelector("[data-session-pin]") : null;
			return {
				present: row !== null,
				pressed: pin ? pin.getAttribute("aria-pressed") : null,
			};
		})()`,
	);
	const restoredWrites = await stubWrites(PINNED);
	check(
		"and the fixture IS pinned again: the row the frames call PINNED reads `aria-pressed true`, and the restore wrote a pin and no archive",
		repinState.present === true &&
			repinState.pressed === "true" &&
			/*
			 * EXACTLY THE TWO PRESSES THIS SCENE HAS MADE FOR THIS ROW SO FAR - the U6 press and this
			 * restore - so a third write fails here instead of passing as "at least two" (the cumulative
			 * counter nit): a double-fired press, or a press that reached the ring twice, is the shape
			 * this row's U6 hazard would take.
			 */
			restoredWrites.pins === 2 &&
			restoredWrites.archives === 0,
		JSON.stringify({ ...repinState, ...restoredWrites }),
	);
	/*
	 * AND THE FOCUS THE PRESS LEFT IS CLEARED, which is the frames' fidelity rather than
	 * tidiness: the panel reveals a row's acts on `group-focus-within`, so a row holding the
	 * caret can paint controls in a frame labelled "at rest" - the instrument's own mark, on the
	 * very state the rest frames exist to measure. Clearing it also makes the re-capture
	 * deterministic across runs and palettes.
	 */
	await cdp.evaluate(
		"(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); })()",
	);
	await parkPointer(cdp);
	const focusAfterRestore = await cdp.evaluate(
		"(() => (document.activeElement ? document.activeElement.tagName : null))()",
	);
	check(
		"the restore leaves no caret behind, so no frame carries focus the fixture does not have",
		focusAfterRestore === "BODY",
		String(focusAfterRestore),
	);

	for (const width of WIDTHS) {
		const applied = await verb(cdp, "setSidebarWidth", { width });
		/*
		 * The width is written through the divider's own action rather than by
		 * resizing the window, so it is worth asserting that the panel really took
		 * it: every number below is quoted as a width's, and a silent clamp would
		 * make three labels one panel.
		 */
		check(
			`the panel is at the width this frame is labelled with (${width})`,
			applied.width === width && applied.clamped === false,
			JSON.stringify(applied),
		);
		await wait(400);
		await parkPointer(cdp);
		geometry[`rest-${width}`] = await rowSpaceGeometry(cdp, IDS);
		frames.push(await captureSettled(cdp, `rest-${width}`));

		/*
		 * THE PAN'S OWN CASE, photographed AT ITS END (see the scene note): the dwell
		 * has elapsed and the title has reached its overflow and stopped there, so two
		 * consecutive captures of this state are identical and the frame is evidence.
		 */
		await hoverOver(cdp, `[data-session-row="${UNPINNED}"] [data-chat-row]`);
		await wait(DWELL_MS + PAN_CEILING_MS);
		geometry[`hover-long-${width}`] = await rowSpaceGeometry(cdp, IDS);
		frames.push(await captureSettled(cdp, `hover-long-${width}`));

		/* Leaving the row clears the pan and the mask in the same frame. */
		await parkPointer(cdp);
		await wait(200);
		geometry[`pan-reset-${width}`] = await rowSpaceGeometry(cdp, IDS);

		/*
		 * AND THE SAME WAIT FOR THE PINNED ROW, because its title overflows at every width
		 * photographed here too (it is the fixture's second long one), so the pointer starts
		 * a pan on it exactly as it does on the other row.
		 */
		await hoverOver(cdp, `[data-session-row="${PINNED}"] [data-chat-row]`);
		await wait(DWELL_MS + PAN_CEILING_MS);
		geometry[`hover-pinned-${width}`] = await rowSpaceGeometry(cdp, IDS);
		frames.push(await captureSettled(cdp, `hover-pinned-${width}`));
	}

	/*
	 * The two states that are about a ROW CLASS rather than a width, photographed
	 * at the default: a title that fits its box (which must not move, and this is the
	 * frame the spec names for that claim) and the row the panel is currently on
	 * (whose ground is dropped under the pointer, so the pointer must not change which
	 * row reads as current).
	 */
	await verb(cdp, "setSidebarWidth", { width: 280 });
	await wait(300);
	await hoverOver(cdp, `[data-session-row="${SHORT}"] [data-chat-row]`);
	await wait(DWELL_MS + 600);
	geometry["hover-short-280"] = await rowSpaceGeometry(cdp, IDS);
	frames.push(await captureSettled(cdp, "hover-short-280"));

	await hoverOver(cdp, `[data-session-row="${CURRENT}"] [data-chat-row]`);
	await wait(DWELL_MS + 600);
	geometry["hover-current-280"] = await rowSpaceGeometry(cdp, IDS);
	frames.push(await captureSettled(cdp, "hover-current-280"));

	/*
	 * A SWEEP STARTS NO PAN, which is the property that makes the pan acceptable at
	 * all: the pointer crosses the row for less than the dwell and leaves, and nothing
	 * moves. Read rather than photographed, because "nothing moved" is the reading.
	 */
	await parkPointer(cdp);
	await wait(200);
	await hoverOver(cdp, `[data-session-row="${UNPINNED}"] [data-chat-row]`);
	await wait(200);
	await parkPointer(cdp);
	await wait(200);
	geometry["pan-swept-280"] = await rowSpaceGeometry(cdp, IDS);
	/*
	 * AND THE FLYOUT IS GONE ONCE THE POINTER HAS GONE, read after the pointer has been
	 * parked well off the panel and with room for the primitive to unmount: the D2 defect
	 * was a flyout still painted 2.5s later, describing a row the pointer had left.
	 */
	await parkPointer(cdp);
	await wait(600);
	geometry["flyout-closed-280"] = await rowSpaceGeometry(cdp, IDS);

	/*
	 * THE OFFER, through a real press. The row has to be under the pointer for its
	 * archive control to exist at all - the acts are absent from the layout at rest -
	 * and hovering first is exactly the sequence a reader performs.
	 */
	await hoverOver(cdp, `[data-session-row="${SHORT}"] [data-chat-row]`);
	await wait(400);
	await clickAt(cdp, `[data-session-row="${SHORT}"] [data-session-archive]`);
	await wait(700);
	/*
	 * THE FRAME COMES FIRST, AND IT IS TAKEN WITH `captureToastPair` RATHER THAN
	 * `captureWithToast` - both for the same reason: the offer is a TRANSIENT with a
	 * duration (8s), and everything between the press and the shutter is time the
	 * toast is spending. Measured on 2026-09-21 under fleet load, the retrying helper
	 * outlived the toast and wrote a frame with no offer on it at all. The pointer is
	 * parked off the list, so no row draws its acts and the frame is of the list the
	 * offer is about plus the offer itself.
	 */
	await parkPointer(cdp);
	await awaitCardSettled(cdp);
	const offerFrame = await captureToastPair(cdp, "offer-toast-280");
	geometry["offer-toast-280"] = await rowSpaceGeometry(cdp, IDS);
	offerFrames.push({
		label: "offer-toast-280",
		stable: offerFrame.stable,
		toastOnScreen: offerFrame.toastText !== null,
	});
	check(
		"the composer is on screen, so the offer frame is also the evidence for where the offer must not go",
		geometry["offer-toast-280"].composer !== null,
		JSON.stringify(geometry["offer-toast-280"].composer),
	);
	check(
		"the offer is of an offer that was really there",
		/archived/.test(geometry["offer-toast-280"].offer.text ?? ""),
		JSON.stringify(geometry["offer-toast-280"].offer),
	);

	/*
	 * The press is MEASURED with a short timeout first, so a miss NAMES ITSELF rather
	 * than surfacing as the driver's selector timeout: the offer is a transient, and
	 * "the lane is not drawing it any more" is the diagnosis a reader needs.
	 */
	await verb(cdp, "measure", {
		selector: `${SIDEBAR_TOAST} [data-button]`,
		timeoutMs: 2_000,
	}).catch(() => {
		throw new Error(
			`the offer's Undo is not on screen: the lane draws ${JSON.stringify(geometry["offer-toast-280"]?.toasts ?? null)} and the frame carried ${JSON.stringify(offerFrame.toastText)}`,
		);
	});
	await clickAt(cdp, `${SIDEBAR_TOAST} [data-button]`);
	await wait(700);
	await parkPointer(cdp);
	await waitForNoToasts(cdp, 5_000);
	const restored = await rowSpaceGeometry(cdp, [SHORT]);
	check(
		"the offer's own Undo put the row back, so the list is the fixture's list again",
		restored.rows[0]?.present === true && restored.toasts.total === 0,
		JSON.stringify({ row: restored.rows[0] ?? null, toasts: restored.toasts }),
	);

	/*
	 * AND THE SAME OFFER AT THE 240 CLAMP MINIMUM, WHICH IS THE FRAME THAT SETTLES D10. The
	 * card's width was a literal 248px - the lane's width at the 280 panel - while the lane is
	 * `min(264px, 100% - 32px)` of the panel: at 240 the lane is 208, so the card was 40px wider
	 * than its own lane and about 32px past the sidebar's right edge, with nothing clipping it
	 * (design round 3, D10). It was 176 there before the lane took the icon's width out. A frame
	 * is the only way to see that and there was none at this width, so this is the capture the
	 * design round named as the thing that settles it - in both palettes, because the lane's
	 * numbers do not move with the theme.
	 *
	 * The press is the reader's own sequence again, and the two assertions are the numbers a
	 * still cannot carry: the card is no wider than the lane it is drawn in, and its right edge
	 * is inside the panel's own box.
	 */
	await verb(cdp, "setSidebarWidth", { width: 240 });
	await wait(400);
	await hoverOver(cdp, `[data-session-row="${SHORT}"] [data-chat-row]`);
	await wait(400);
	await clickAt(cdp, `[data-session-row="${SHORT}"] [data-session-archive]`);
	await wait(700);
	await parkPointer(cdp);
	await awaitCardSettled(cdp);
	const offer240 = await captureToastPair(cdp, "offer-toast-240");
	geometry["offer-toast-240"] = await rowSpaceGeometry(cdp, IDS);
	offerFrames.push({
		label: "offer-toast-240",
		stable: offer240.stable,
		toastOnScreen: offer240.toastText !== null,
	});
	const offer240Reading = geometry["offer-toast-240"].offer;
	check(
		"at the 240 clamp minimum the offer card is no wider than the lane it is drawn in, and inside the panel's own box (design round 3, D10)",
		offer240Reading.toast !== null &&
			offer240Reading.lane !== null &&
			offer240Reading.toast.width <= offer240Reading.lane.width + 0.5 &&
			offer240Reading.toast.right <=
				geometry["offer-toast-240"].panel.right + 0.5,
		JSON.stringify({
			panelWidth: geometry["offer-toast-240"].panel.width,
			lane: offer240Reading.lane,
			toast: offer240Reading.toast,
		}),
	);
	check(
		"and the 240 offer is of an offer that was really there",
		/archived/.test(offer240Reading.text ?? ""),
		JSON.stringify(offer240Reading),
	);
	await clickAt(cdp, `${SIDEBAR_TOAST} [data-button]`);
	await wait(700);
	await parkPointer(cdp);
	await waitForNoToasts(cdp, 5_000);
	await verb(cdp, "setSidebarWidth", { width: 280 });
	await wait(300);

	/*
	 * AND THE THIRD WIDTH, WHICH IS D10'S LAST UNPHOTOGRAPHED CORNER (design round 4, D16). At
	 * 320 the lane is 264 and the card's cap is 248, so this is the FIRST width where the card is
	 * narrower than the lane it is drawn in - the measured 240 and 280 cards fill theirs exactly,
	 * so which edge the spare 16px falls on is not settled by either frame. Nothing in the band's
	 * ruling depends on it (the band is a height, not an x), which is why this step adds NO CHECK:
	 * a check would move the tally this round's QA is comparing, and the reading is what the round
	 * asked for. The numbers are the note below - the card's own left/right against the panel's
	 * inner edges say which side the slack sits on - and they are also in the geometry JSON that
	 * ships beside the frame.
	 */
	await verb(cdp, "setSidebarWidth", { width: 320 });
	await wait(400);
	await hoverOver(cdp, `[data-session-row="${SHORT}"] [data-chat-row]`);
	await wait(400);
	await clickAt(cdp, `[data-session-row="${SHORT}"] [data-session-archive]`);
	await wait(700);
	await parkPointer(cdp);
	await awaitCardSettled(cdp);
	const offer320 = await captureToastPair(cdp, "offer-toast-320");
	geometry["offer-toast-320"] = await rowSpaceGeometry(cdp, IDS);
	offerFrames.push({
		label: "offer-toast-320",
		stable: offer320.stable,
		toastOnScreen: offer320.toastText !== null,
	});
	note(
		"the 320 card's x, and the lane and panel it sits in (design round 4, D16)",
		JSON.stringify({
			panel: geometry["offer-toast-320"].panel,
			lane: geometry["offer-toast-320"].offer.lane,
			card: geometry["offer-toast-320"].offer.toast,
			text: geometry["offer-toast-320"].offer.text,
		}),
	);
	/*
	 * AND THE ROW IS PUT BACK, so the fixture this step found is the fixture it hands on - the
	 * same sequence the 280 and 240 steps above end with.
	 */
	await clickAt(cdp, `${SIDEBAR_TOAST} [data-button]`);
	await wait(700);
	await parkPointer(cdp);
	await waitForNoToasts(cdp, 5_000);
	await verb(cdp, "setSidebarWidth", { width: 280 });
	await wait(300);

	/*
	 * THE LONG NAME IN THE LANE (design round 3, D13). The D7 acceptance claim is that the card
	 * spends its width on the name rather than on chrome, and the claim was carried by frames of
	 * the SHORT row's title, which fits at every width here - so nothing photographed the case the
	 * fix is about. This is that case: the offer is raised on the row whose title is long enough
	 * to TRUNCATE at all three widths, and the name is read as a BOX rather than as a sentence,
	 * because "elided" is `scrollWidth > clientWidth` on the element that carries the name and
	 * nothing else can state it.
	 */
	await hoverOver(cdp, `[data-session-row="${UNPINNED}"] [data-chat-row]`);
	await wait(400);
	await clickAt(cdp, `[data-session-row="${UNPINNED}"] [data-session-archive]`);
	await wait(700);
	await parkPointer(cdp);
	await awaitCardSettled(cdp);
	const offerLong = await captureToastPair(cdp, "offer-long-280");
	geometry["offer-long-280"] = await rowSpaceGeometry(cdp, IDS);
	offerFrames.push({
		label: "offer-long-280",
		stable: offerLong.stable,
		toastOnScreen: offerLong.toastText !== null,
	});
	/*
	 * THE NAME IS THE ELEMENT THAT CARRIES THE QUOTED NAME AND NOTHING ELSE, found by what it says
	 * rather than by its position. The first attempt used a child-combinator path through sonner's
	 * own wrapper, which read `null` in both palettes on the first run of this clause; the
	 * `truncate` class is the second spelling the component itself states, so a build that changes
	 * one and not the other still answers.
	 */
	const offerName = await cdp.evaluate(`(() => {
		const toast = document.querySelector(${JSON.stringify(SIDEBAR_TOAST)});
		if (!toast) return null;
		const spans = Array.from(toast.querySelectorAll("[data-content] span"));
		/*
		 * THE DEEPEST MATCH, and that is the point rather than a detail: the WRAPPER also starts
		 * with the quotation mark, and its scrollWidth is its laid-out flex width, so it reports
		 * "elided: false" for a name that is plainly truncated - a width-only reading of an
		 * element that cannot carry the claim. The name span is the last match in document order.
		 */
		const quoted = spans.filter((node) => /^[“"]/.test((node.textContent || "").trim()));
		const name =
			(quoted.length > 0 ? quoted[quoted.length - 1] : null) ??
			spans.find((node) => node.className.includes("truncate"));
		if (!name) return null;
		return {
			text: name.textContent,
			clientWidth: name.clientWidth,
			scrollWidth: name.scrollWidth,
			elided: name.scrollWidth - name.clientWidth > 0.5,
			className: name.className,
		};
	})()`);
	const offerLongReading = geometry["offer-long-280"].offer;
	check(
		"the long name reaches the lane whole and the card is inside its own lane (design round 3, D7/D13)",
		offerLongReading.toast !== null &&
			offerLongReading.lane !== null &&
			offerLongReading.toast.width <= offerLongReading.lane.width + 0.5 &&
			offerName !== null &&
			(offerName.text ?? "").includes(
				"Quarterly retention sweep and the transcripts it dropped",
			),
		JSON.stringify({
			lane: offerLongReading.lane,
			toast: offerLongReading.toast,
			name: offerName,
		}),
	);
	note(
		"the long name in the lane, as a box (D7's acceptance reading)",
		JSON.stringify(offerName),
	);
	await clickAt(cdp, `${SIDEBAR_TOAST} [data-button]`);
	await wait(700);
	await parkPointer(cdp);
	await waitForNoToasts(cdp, 5_000);
	const restoredLong = await rowSpaceGeometry(cdp, [UNPINNED, SHORT]);
	check(
		"and both offers' rows are back, so every check below reads the fixture's list",
		restoredLong.rows.every((row) => row.present === true) &&
			restoredLong.toasts.total === 0,
		JSON.stringify({ rows: restoredLong.rows, toasts: restoredLong.toasts }),
	);

	/*
	 * THE NUMBERS THE SPEC PROMISES, asserted in the same read that produced them - so
	 * the change cannot land with the geometry it claims. Each one is a claim in
	 * `docs/design/sidebar-row-space.md` § 3 and § 14; the arithmetic behind them is
	 * `row - 4 (the row's gap, when a cluster is drawn at all) - cluster - 28`, where
	 * the cluster is 0 at rest on an unpinned row, 24 (the mark) on a pinned one, and
	 * 52 (the pair) under the pointer.
	 */
	const budget = Object.fromEntries(
		Object.entries(geometry).map(([key, reading]) => [
			key,
			rowSpaceBudget(reading),
		]),
	);
	const rowIn = (state, id) =>
		budget[state]?.find((row) => row.id === id) ?? null;
	/** The x of a `transform` matrix, or `null` when there is no transform. */
	const translateX = (value) => {
		const match = /matrix\(([^)]+)\)/.exec(value ?? "");
		if (!match) return null;
		const parts = match[1].split(",").map(Number);
		return parts.length === 6 ? parts[4] : null;
	};
	/*
	 * WHAT "THE PAN IS NOT PAINTING" IS, in one predicate, because four checks ask it and
	 * the reading has TWO spellings now: the transform target is mounted only while a pan
	 * runs (an always-mounted wrapper costs the rest state its ellipsis, measured), so a
	 * row that is not panning reports no element at all - `null` - rather than an
	 * untransformed one. The mask is on the clip box, which always exists.
	 */
	const noPanPaint = (row) =>
		row?.titleMask === "none" &&
		(row?.titleTextTransform === null || row?.titleTextTransform === "none");
	const TITLE_REST = { 240: 196, 280: 236, 320: 276 };
	const TITLE_HOVER = { 240: 140, 280: 180, 320: 220 };
	/*
	 * THE SCROLLBAR GUTTER, WHICH THE SPEC'S TABLE DOES NOT INCLUDE AND THIS MACHINE
	 * PAYS. Every number in `docs/design/sidebar-row-space.md` § 3 and § 14 was derived
	 * from frames taken on macOS overlay scrollbars, where the list region's scroller
	 * takes no width - and the spec then DECIDED to reserve the gutter anyway (D12), so
	 * that a title never re-truncates because a row was added or removed. Reserving it
	 * is not free on a machine whose scrollbars are not overlay: measured here it takes
	 * 8px off every row, and on the operator's own screen (always-on classic
	 * scrollbars) it is the ~15px the README names. So the spec's table is asserted
	 * MINUS the gutter this run measured, and the gutter's own reading is asserted
	 * beside it rather than assumed - a run whose region reserved nothing would say so.
	 */
	const gutter = geometry["rest-280"]?.list?.reserved ?? null;
	check(
		"the list region reserves the scrollbar gutter, and this run measured what it costs a row",
		gutter !== null &&
			gutter >= 0 &&
			gutter <= 16 &&
			geometry["rest-280"]?.list?.scrollbarGutter === "stable",
		JSON.stringify(geometry["rest-280"]?.list ?? null),
	);

	check(
		"at rest an unpinned row's title has the whole row: no reserved box, and neither act painted",
		WIDTHS.every((width) => {
			const row = rowIn(`rest-${width}`, UNPINNED);
			return (
				row?.pairWidth === 0 &&
				row?.pinWidth === 0 &&
				row?.pinPainted === false &&
				row?.archiveWidth === 0 &&
				row?.archivePainted === false
			);
		}),
		JSON.stringify(WIDTHS.map((width) => rowIn(`rest-${width}`, UNPINNED))),
	);
	check(
		"at rest the unpinned title measures the widths the spec promises (196 / 236 / 276), less the gutter this machine reserves",
		WIDTHS.every(
			(width) =>
				rowIn(`rest-${width}`, UNPINNED)?.titleWidth ===
				TITLE_REST[width] - gutter,
		),
		JSON.stringify(
			WIDTHS.map((width) => ({
				width,
				title: rowIn(`rest-${width}`, UNPINNED)?.titleWidth,
				expected: TITLE_REST[width] - gutter,
				gutter,
			})),
		),
	);
	/*
	 * THE STATE THIS CHECK READS, AND WHY IT READS IT NOW THE FIXTURE IS RESTORED. A pinned row
	 * costs the pin alone at rest (design: the slide-away reveal) and the mark keeps the row's
	 * right edge by ORDER - the archive is ordered ahead of it and exists only under the pointer -
	 * so the number below is `restTitle - 28 - gutter`: the mark's own 24px and the row's 4px gap,
	 * nothing for the archive. THAT IS THE DELIBERATE TRADE: the shipped build reserved 56px on
	 * EVERY row and, at the 240 clamp minimum, drew no pin at all; this trades 28px of title on
	 * pinned rows only (and nothing on unpinned ones) for a state that reads without hovering,
	 * which is the rule this panel states about itself.
	 *
	 * THE TRIAGE THAT MATTERED: this check was RED for the last passes reading `rowWidth 216,
	 * rowLeft 228, titleWidth 188` - an UNPINNED row's rest reading, because the U6 press earlier
	 * in the scene had flipped the fixture's pin. The expectation was never stale and the layout
	 * never moved it: the scene's own state was wrong, and the restore above the width loop is
	 * what makes this check read the row it names.
	 */
	check(
		"at rest on a PINNED row the mark is drawn at every width - including the 240 clamp minimum, where the shipped build drew nothing at all",
		WIDTHS.every((width) => {
			const row = rowIn(`rest-${width}`, PINNED);
			return (
				row?.pinWidth === 24 &&
				row.pinPainted === true &&
				row?.archiveWidth === 0 &&
				row?.archivePainted === false &&
				/* A pinned row's title is its rest width less the mark and the row's own
				   4px gap - 28 - and the gutter every row pays. */
				row?.titleWidth === TITLE_REST[width] - 28 - gutter
			);
		}),
		JSON.stringify(WIDTHS.map((width) => rowIn(`rest-${width}`, PINNED))),
	);
	check(
		"with the pointer on the row both acts are painted and the title's box is 140 / 180 / 220, less the gutter",
		WIDTHS.every((width) => {
			const row = rowIn(`hover-long-${width}`, UNPINNED);
			return (
				row?.pinPainted === true &&
				row?.archivePainted === true &&
				row?.titleWidth === TITLE_HOVER[width] - gutter
			);
		}),
		JSON.stringify(
			WIDTHS.map((width) => rowIn(`hover-long-${width}`, UNPINNED)),
		),
	);
	check(
		"what moves when the pointer arrives is the title's CLIP: the row's box, its height and the title's leading edge are identical in both states",
		WIDTHS.every((width) => {
			const rest = rowIn(`rest-${width}`, UNPINNED);
			const hover = rowIn(`hover-long-${width}`, UNPINNED);
			return (
				rest?.rowWidth === hover?.rowWidth &&
				rest?.rowHeight === hover?.rowHeight &&
				rest?.titleLeft === hover?.titleLeft
			);
		}),
		JSON.stringify(
			WIDTHS.map((width) => ({
				width,
				rest: rowIn(`rest-${width}`, UNPINNED)?.titleLeft,
				hover: rowIn(`hover-long-${width}`, UNPINNED)?.titleLeft,
			})),
		),
	);
	/*
	 * WHAT MOVES, AND WHAT THE POINTER COSTS. On an unpinned row the pointer reveals both acts
	 * (24 + 4 + 24 + 4 = 56); on a pinned row the mark is already there, so only the archive
	 * arrives (24 + 4 = 28) - which is the whole of the change: the pin's budget is permanent on a
	 * pinned row, the archive's is not. The trade is that a pinned row's title is 28px shorter
	 * than an unpinned one's at the same width, and that an unpinned row's title shortens only
	 * while the pointer is on it.
	 *
	 * THE TRIAGE THIS CHECK NEEDED - wrong frame, or wrong state? WRONG STATE, BOTH FRAMES. All
	 * six readings come from the same row at the same widths, and `56/56` is what an UNPINNED row
	 * reads twice over: at rest it reserves nothing, and under the pointer it reveals the same two
	 * acts. On the restored fixture the pair reads `56/28` at every width, which is what this
	 * check has always been written for.
	 */
	check(
		"and the acts are what takes it: 56px on an unpinned row, 28 on a pinned one",
		WIDTHS.every((width) => {
			const unpinned =
				rowIn(`rest-${width}`, UNPINNED)?.titleWidth -
				rowIn(`hover-long-${width}`, UNPINNED)?.titleWidth;
			return unpinned === 56;
		}) &&
			WIDTHS.every(
				(width) =>
					rowIn(`rest-${width}`, PINNED)?.titleWidth -
						rowIn(`hover-pinned-${width}`, PINNED)?.titleWidth ===
					28,
			),
		JSON.stringify(
			WIDTHS.map((width) => ({
				width,
				unpinned:
					rowIn(`rest-${width}`, UNPINNED)?.titleWidth -
					rowIn(`hover-long-${width}`, UNPINNED)?.titleWidth,
				pinned:
					rowIn(`rest-${width}`, PINNED)?.titleWidth -
					rowIn(`hover-pinned-${width}`, PINNED)?.titleWidth,
			})),
		),
	);
	check(
		"the long title truncates at every width photographed here",
		WIDTHS.every(
			(width) => rowIn(`rest-${width}`, UNPINNED)?.titleOverflows === true,
		),
		JSON.stringify(
			WIDTHS.map((width) => ({
				width,
				title: rowIn(`rest-${width}`, UNPINNED)?.titleWidth,
				scroll: rowIn(`rest-${width}`, UNPINNED)?.titleScrollWidth,
			})),
		),
	);
	/*
	 * THE PAN, at each width: it starts only on a title that overflows, it runs one way
	 * to `scrollWidth - clientWidth`, and it STOPS there and holds. The frame above is
	 * of that end state, and this is the same reading as a number.
	 */
	check(
		"the pan reached the title's own overflow and stopped there, at every width",
		WIDTHS.every((width) => {
			const row = rowIn(`hover-long-${width}`, UNPINNED);
			const x = translateX(row?.titleTextTransform);
			/*
			 * THE TEXT BOX'S WIDTH, not the clip box's `scrollWidth`: the clip's includes
			 * the ellipsis's own advance while the pointer is arriving, and the pan's class
			 * swap takes that ellipsis away - so the clip's reading is larger than the
			 * distance the pan should travel, by exactly one ellipsis (10px here).
			 */
			const overflow = row?.titleTextWidth - row?.titleClientWidth;
			return (
				x !== null &&
				x < 0 &&
				Math.abs(-x - overflow) <= 1 &&
				row?.titleMask !== "none"
			);
		}),
		JSON.stringify(
			WIDTHS.map((width) => {
				const row = rowIn(`hover-long-${width}`, UNPINNED);
				return {
					width,
					x: translateX(row?.titleTextTransform),
					expected: -(row?.titleTextWidth - row?.titleClientWidth),
					mask: row?.titleMask,
				};
			}),
		),
	);
	check(
		"at rest there is no mask and no transform: the pan's own paint exists only while it runs",
		WIDTHS.every(
			(width) =>
				noPanPaint(rowIn(`rest-${width}`, UNPINNED)) &&
				rowIn(`rest-${width}`, UNPINNED)?.titleClipTransform === "none",
		),
		JSON.stringify(WIDTHS.map((width) => rowIn(`rest-${width}`, UNPINNED))),
	);
	check(
		"leaving the row clears the pan and the mask in the same frame, from wherever it got to",
		WIDTHS.every((width) => noPanPaint(rowIn(`pan-reset-${width}`, UNPINNED))),
		JSON.stringify(
			WIDTHS.map((width) => rowIn(`pan-reset-${width}`, UNPINNED)),
		),
	);
	check(
		"and a pointer that crosses the row faster than the dwell starts no pan at all",
		noPanPaint(rowIn("pan-swept-280", UNPINNED)),
		JSON.stringify(rowIn("pan-swept-280", UNPINNED)),
	);
	check(
		"a title that FITS does not move: no overflow, no transform, no mask",
		rowIn("hover-short-280", SHORT)?.titleOverflows === false &&
			noPanPaint(rowIn("hover-short-280", SHORT)),
		JSON.stringify(rowIn("hover-short-280", SHORT)),
	);
	/*
	 * THE OFFER, IN THE PANEL'S OWN LANE: one toast painted, inside the panel's box, and
	 * clear of the composer. The painted count is what makes this a claim about the app
	 * rather than about the mechanism - sonner draws every mounted container's copy of
	 * every toast, and the stylesheet narrows that to the one the reader sees.
	 */
	const offer = geometry["offer-toast-280"];
	check(
		"the offer is drawn exactly once, and inside the panel's own column",
		offer.offer.toast !== null &&
			offer.toasts.painted === 1 &&
			offer.offer.toast.left >= offer.panel.left &&
			offer.offer.toast.right <= offer.panel.right,
		JSON.stringify({
			toast: offer.offer.toast,
			panel: offer.panel,
			toasts: offer.toasts,
		}),
	);
	check(
		"and it is disjoint from the composer's form and its Send control - the constraint design round 2's D12 turned on",
		offer.composer !== null &&
			disjointBoxes(offer.offer.toast, offer.composer.form) === true &&
			disjointBoxes(offer.offer.toast, offer.composer.send) === true,
		JSON.stringify({ toast: offer.offer.toast, composer: offer.composer }),
	);
	check(
		"every settled capture is a frame the app held still for, with no toast on it",
		frames.every((frame) => frame.stable === true && frame.toastFree === true),
		frames.map((frame) => `${frame.label}: stable=${frame.stable}`).join(" | "),
	);
	check(
		"and the offer's own frame is of a held-still picture with the offer on it",
		offerFrames.every(
			(frame) => frame.stable === true && frame.toastOnScreen === true,
		),
		JSON.stringify(offerFrames),
	);
	check(
		"every capture wrote a PNG of the requested size",
		frames.every(
			(frame) =>
				frame.bytes > 1000 &&
				frame.pixels.width ===
					frame.viewport.width * frame.viewport.devicePixelRatio,
		),
		frames.map((frame) => `${frame.label}: ${frame.bytes}B`).join(" | "),
	);

	/*
	 * THE FLYOUT, WHICH THE SCENE COULD NOT FAIL ON BEFORE (design round 1, D2; UX U1;
	 * QA Q-1). Three properties, each one a defect that shipped:
	 *
	 *  - IT IS THERE, on a row under the pointer whose title fits as well as on one that
	 *    overflows (`hover-short-280` used not to carry one at all, while
	 *    `hover-current-280` did - the same build, two frames, and no field to tell them
	 *    apart);
	 *  - IT IS ABOUT **THAT** ROW: its first line is the hovered row's own full title;
	 *  - IT CANNOT COVER THE ROW'S ACTS: its left edge is at the row's own right edge or
	 *    further right, which is the invariant the old comment claimed and the old anchor
	 *    broke by 50px (the flyout's left edge used to be computed from the row's BUTTON,
	 *    which shrinks by 56px under the pointer - 434 against a row ending at 484).
	 *
	 * The four hovered states are the ones the committed frames carry, including the two
	 * that shipped another row's facts.
	 */
	const hoveredStates = [
		...WIDTHS.map((width) => ({ state: `hover-long-${width}`, id: UNPINNED })),
		{ state: "hover-pinned-280", id: PINNED },
		{ state: "hover-short-280", id: SHORT },
		{ state: "hover-current-280", id: CURRENT },
	];
	const hoveredFlyout = ({ state, id }) => {
		const reading = geometry[state];
		const row = (reading?.rows ?? []).find((entry) => entry.id === id) ?? null;
		return { flyout: reading?.flyout ?? null, row };
	};
	/*
	 * THE IDENTITY IS A PREFIX RATHER THAN AN EQUALITY (agent review round 2, R2-N4). The
	 * flyout's first line is the full title followed by the row's binding in parentheses when
	 * it has one (`chat-sidebar.tsx`'s `rowTooltip`), and every fixture row carries
	 * `binding: {agent: null, team: null}` today - so equality holds now and would start
	 * false-failing the moment a fixture gained a binding, which is the wrong direction for
	 * an assertion to fail in. The title is the part that identifies the row either way.
	 */
	const flyoutNames = (flyout, row) => {
		const title = row?.title?.text ?? "";
		const line = flyout?.title ?? null;
		return (
			line !== null &&
			(title === "" || line === title || line.startsWith(`${title} (`))
		);
	};
	check(
		"every hovered row carries a flyout of its own - the row under the pointer, whose facts it describes, clear of that row's own acts",
		hoveredStates.every(({ state, id }) => {
			const { flyout, row } = hoveredFlyout({ state, id });
			return (
				flyout !== null &&
				row !== null &&
				flyoutNames(flyout, row) &&
				row.row !== null &&
				flyout.left >= row.row.right &&
				(row.pin === null || flyout.left >= row.pin.right) &&
				(row.archive === null || flyout.left >= row.archive.right) &&
				flyout.fitsViewport === true
			);
		}),
		JSON.stringify(
			hoveredStates.map(({ state, id }) => {
				const { flyout, row } = hoveredFlyout({ state, id });
				return {
					state,
					id,
					flyout:
						flyout === null
							? null
							: {
									left: flyout.left,
									title: flyout.title,
									fits: flyout.fitsViewport,
								},
					rowRight: row?.row?.right ?? null,
					rowTitle: row?.title?.text ?? null,
					actsRight: row?.archive?.right ?? row?.pin?.right ?? null,
				};
			}),
		),
	);
	check(
		"and no flyout outlives the pointer: with it parked off the panel the tooltip lane is empty, WHILE the row it was drawn on did carry one in the same run (agent review round 2, R2-N3: without that positive control this check passes in a build where the flyout never opens at all, since the sweep before it hovers for less than the dwell)",
		geometry["hover-long-280"]?.flyout !== null &&
			geometry["flyout-closed-280"]?.flyout === null,
		JSON.stringify({
			opened: geometry["hover-long-280"]?.flyout ?? null,
			closed: geometry["flyout-closed-280"]?.flyout ?? null,
		}),
	);

	/*
	 * THE KEYBOARD'S UNPIN, WALKED RATHER THAN REASONED ABOUT (UX report round 1, U2).
	 *
	 * Unpinning used to end at `aria-pressed true->false`, the pair `display: none` and
	 * `focus: body`: the mark's box leaves the layout when it is unpinned, a
	 * `display: none` element cannot hold focus, so Chromium blurred it to the document
	 * body, `group-focus-within` went false and the cluster stayed hidden.
	 *
	 * THE FIX IS THE PANEL'S ROW-MOVE CORRECTION, and the first run of this walk is what
	 * proved a hand-back written inside the handler cannot be it: unpinning re-renders the
	 * row under a DIFFERENT section parent (`Pinned chats` -> `Active chats`/
	 * `Previous chats`), so the element the handler holds is destroyed by the same commit
	 * that moves the row. That run read `aria-pressed "false"` - the state moved - with
	 * `pairDisplay "none"`, `focusInsideRow false` and `activeTag "BODY"`.
	 * `rememberMovedRow(..., follow = event.detail === 0)` arms a correction that runs after
	 * the commit, finds the row by id, and puts the caret on the mark when the mark is
	 * DRAWN and on the row's own button when it is not.
	 *
	 * This walks the exact path the finding describes: focus the row's button, Tab onto its
	 * pin, Enter.
	 *
	 * Read last, because it changes the row's state: everything photographed and asserted
	 * above is already on disk by the time this runs.
	 */
	await parkPointer(cdp);
	await wait(200);
	const seededFocus = await cdp.evaluate(
		`(() => { const row = document.querySelector('[data-session-row="${PINNED}"]'); const button = row && row.querySelector('[data-chat-row]'); if (!button) return null; button.focus(); return document.activeElement === button; })()`,
	);
	check(
		"the pinned row's own button can hold focus, which is where the keyboard walk starts",
		seededFocus === true,
		String(seededFocus),
	);
	await pressChord(cdp, { key: "Tab", code: "Tab", virtualKeyCode: 9 });
	await wait(200);
	const onThePin = await cdp.evaluate(
		`(() => { const el = document.activeElement; return { label: el ? el.getAttribute('aria-label') : null, pressed: el ? el.getAttribute('aria-pressed') : null }; })()`,
	);
	/*
	 * THE WALK STARTS FROM A PINNED ROW, AND THAT IS A PRECONDITION RATHER THAN DECORATION. The
	 * reading that made this look wrong was `{"label":"Pin ...","pressed":"false"}` - the
	 * fixture's own row, unpinned, because the U6 press had flipped it earlier in the run. The
	 * instrument reached the pin (the label names THIS row) and the pin reported itself honestly;
	 * only the starting state was wrong, and the restore above the width loop is what fixes it. A
	 * run that fails here now is a run whose restore or whose row-move correction is at fault, and
	 * those are different files.
	 */
	check(
		"one Tab from the row's button lands on its pin, drawn for focus alone",
		typeof onThePin.label === "string" &&
			onThePin.label.startsWith("Unpin") &&
			onThePin.pressed === "true",
		JSON.stringify(onThePin),
	);
	/*
	 * THE DELIVERY PRECONDITION, RECORDED FROM THE PAGE (agent review round 3, on the first
	 * real run of this walk). That run read
	 * `{"pressed":"true","pairDisplay":"flex","focusInsideRow":true}` — the two clauses this
	 * fix owns were TRUE and the state had not moved, which is ALSO the reading of a control
	 * that was never activated. A check that cannot tell those apart sends the next reader to
	 * the wrong file, so the chord's delivery is recorded from the page's own events before
	 * it is asserted: `pressChord` now carries each key's character (see `keyText` for why
	 * that is what activation needs), and this reads whether the chord reached the pin and
	 * produced its activation at all.
	 *
	 * The listeners are capture-phase on the document, because the question is what the
	 * PLATFORM sent rather than what a handler chose to do with it.
	 */
	const recorder = await cdp.evaluate(`(() => {
		const row = document.querySelector('[data-session-row="${PINNED}"]');
		const pin = row ? row.querySelector('[data-session-pin]') : null;
		const seen = { pinKeydown: 0, pinKeypress: 0, pinClick: 0, anyClick: 0 };
		window.__u2Walk = seen;
		const isPin = (event) => pin !== null && (event.target === pin || pin.contains(event.target));
		document.addEventListener("keydown", (event) => { if (isPin(event)) seen.pinKeydown += 1; }, true);
		document.addEventListener("keypress", (event) => { if (isPin(event)) seen.pinKeypress += 1; }, true);
		document.addEventListener("click", (event) => { seen.anyClick += 1; if (isPin(event)) seen.pinClick += 1; }, true);
		return { installed: window.__u2Walk !== undefined, pin: pin !== null, focused: document.activeElement === pin };
	})()`);
	check(
		"the recorder is installed, the pin is on the panel, and the pin is what has focus - the state the Enter chord is about to be sent into",
		recorder.installed === true &&
			recorder.pin === true &&
			recorder.focused === true,
		JSON.stringify({ ...recorder, ...onThePin }),
	);
	await pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	await wait(500);
	geometry["keyboard-unpin-280"] = await rowSpaceGeometry(cdp, IDS);
	const afterUnpin = await cdp.evaluate(
		`(() => {
			const row = document.querySelector('[data-session-row="${PINNED}"]');
			const pin = row ? row.querySelector('[data-session-pin]') : null;
			const pair = row ? row.querySelector('[data-session-control-pair]') : null;
			const active = document.activeElement;
			return {
				pressed: pin ? pin.getAttribute('aria-pressed') : null,
				pairDisplay: pair ? getComputedStyle(pair).display : null,
				focusInsideRow: !!(row && active && row.contains(active)),
				activeTag: active ? active.tagName : null,
			};
		})()`,
	);
	const delivered = await cdp.evaluate(
		"(() => (window.__u2Walk ? { ...window.__u2Walk } : null))()",
	);
	/*
	 * THE INSTRUMENT'S HALF, ASSERTED SEPARATELY (agent review round 3): a chord that cannot
	 * activate a button must fail as the rig's fault, not as the app's. This is the check
	 * that says which half is which, and the behaviour check below carries the same two
	 * clauses so it cannot pass while activation was never delivered.
	 */
	check(
		"the Enter chord reached the focused pin through Chromium's input pipeline and produced its activation - the precondition the walk below depends on (the instrument's own claim, not the app's)",
		delivered !== null && delivered.pinKeydown > 0 && delivered.pinClick > 0,
		JSON.stringify({ delivered, activeTag: afterUnpin.activeTag }),
	);
	/*
	 * AND THE VERDICT IS NAMED. Three different faults produce the same pixels on this step,
	 * and the reading has to say which one the run found: the chord never arriving, the
	 * chord arriving without activation, and the app not moving a state it was told to move.
	 */
	const verdict =
		delivered === null
			? "rig: the recorder is gone"
			: delivered.pinKeydown === 0
				? "rig: the Enter chord never reached the pin (no keydown on it)"
				: delivered.pinClick === 0
					? "rig: the chord reached the pin and produced no activation (keydown, no click)"
					: afterUnpin.pressed === "false"
						? "app: activation delivered, the state moved"
						: "app: activation delivered, the state did not move";
	/*
	 * THE SAME PRECONDITION, SEEN FROM THE OTHER SIDE. The verdict string below separates the
	 * three ways this step fails - the chord never arriving, arriving without activation, and the
	 * app not moving - and the reading it produced while the fixture was unpinned was a fourth,
	 * unnamed one: the app moving the state the RIGHT way from the WRONG state (`pressed` "true"
	 * where the walk expected "false"), i.e. the activation PINNED a row the check believed was
	 * pinned already. With the fixture restored, `false` here means the unpin happened.
	 */
	check(
		"unpinning from the keyboard flips the state and keeps the row's place: the activation was delivered, the pair stays displayed and focus stays inside the row (U2)",
		delivered !== null &&
			delivered.pinKeydown > 0 &&
			delivered.pinClick > 0 &&
			afterUnpin.pressed === "false" &&
			afterUnpin.pairDisplay === "flex" &&
			afterUnpin.focusInsideRow === true,
		JSON.stringify({ ...afterUnpin, delivered, verdict }),
	);

	/*
	 * THE CLOSING READ THAT MAKES "NO archive FOR THIS CONVERSATION ANYWHERE IN THE RUN" TRUE
	 * RATHER THAN TRUE-SO-FAR. The U6 press clause reads the daemon's log at its own moment, and
	 * two interactions with this row follow it - the restore's press and the keyboard walk's
	 * Enter - either of which could, if it missed the mark, land on the archive control instead.
	 * That is exactly the hazard U6 exists for, so the question is asked again once every press
	 * is spent, from the same source and by the same code.
	 */
	const closingWrites = await stubWrites(PINNED);
	check(
		"no press in this run wrote an archive for the conversation the U6 press was aimed at",
		closingWrites.pins >= 1 && closingWrites.archives === 0,
		JSON.stringify({ ...closingWrites, stubLog: STUB_LOG }),
	);

	const geometryPath = join(
		FRAMES,
		`row-space-geometry-${THEME ?? "default"}${RUN_LABEL}.json`,
	);
	writeFileSync(
		geometryPath,
		JSON.stringify(
			{
				scene: "row-space",
				theme: THEME ?? null,
				runtime: electronRuntime(),
				viewport: geometry["rest-280"]?.viewport ?? null,
				panelPadding: geometry["rest-280"]?.panelPadding ?? null,
				listGutter: geometry["rest-280"]?.list ?? null,
				widths: WIDTHS,
				panel: geometry["rest-280"]?.panel ?? null,
				states: budget,
				/*
				 * THE RAW BOXES TOO, beside the derived table: every number in the
				 * spec is a subtraction over these, and a reader who disagrees with
				 * one of them should be able to check the arithmetic rather than
				 * re-run the scene. It is the same reading, written out.
				 */
				boxes: geometry,
				offer: {
					toast: geometry["offer-toast-280"]?.offer.toast ?? null,
					lane: geometry["offer-toast-280"]?.offer.lane ?? null,
					text: geometry["offer-toast-280"]?.offer.text ?? null,
					toasts: geometry["offer-toast-280"]?.toasts ?? null,
					panel: geometry["offer-toast-280"]?.panel ?? null,
					split: geometry["offer-toast-280"]?.split ?? null,
					firstListRow: geometry["offer-toast-280"]?.firstListRow ?? null,
					composer: geometry["offer-toast-280"]?.composer ?? null,
				},
			},
			null,
			2,
		),
	);
	note("geometry written", geometryPath);
	for (const [key, rows] of Object.entries(budget)) {
		for (const row of rows) {
			say(
				`  ${key} ${row.id}: row ${row.rowWidth} title ${row.titleWidth} (overflows ${row.titleOverflows}, x ${row.titleTextTransform}) tail ${row.tailAfterTitle} pair ${row.pairWidth} pin ${row.pinWidth}${row.pinPainted ? "+" : "-"} archive ${row.archiveWidth}${row.archivePainted ? "+" : "-"}`,
			);
		}
	}
	return [...frames, ...offerFrames];
}

/**
 * The first send must not move the composer (§G2, §H), MEASURED and ASSERTED.
 *
 * WHY THIS IS AN ASSERTION NOW. The capture rig recorded the pair as a NOTE while
 * the defect stood - `composer y393 -> y774` at 1380x900 and `y227 -> y474` at
 * 800x600, the width unchanged - because the empty band centred the whole group
 * (greeting, composer, chips) while a conversation anchors the composer at the
 * foot. The band now docks the composer at its foot in both states, so the claim
 * is a check: the composer box's x, y, width and height are the SAME before and
 * after the first message, at whatever `--window-size` the run was started with
 * (the two it is written about are 1380x900 and 800x600).
 *
 * WHAT IT DRIVES, and with which instrument. The launch lands on the empty state
 * (`launchDraftSeed`), so the scene only has to reach `/chat`. The message is
 * typed with CDP's own input pipeline (a trusted pointer press into the box, then
 * `Input.insertText`) and sent with `Input.dispatchKeyEvent` Enter, so the send
 * goes through the composer's real key handler. It requires `--backend`: with no
 * backend the chat route draws its refusal surface and no composer mounts.
 *
 * The frames are captured FIRST and the boxes read after, for the reason the
 * `floors` scene gives: `captureSettled` commits a frame only when two captures
 * 150ms apart are identical, which is the proof the layout has stopped moving.
 */
async function sceneFirstSend(cdp) {
	const facts = await factsOf(cdp);
	note("facts (from main)", JSON.stringify(facts, null, 2));
	check(
		"window mode is headless and the window is never shown or focused",
		facts.windowMode === "headless" &&
			facts.visible === false &&
			facts.focused === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const composerSelector = '[data-tour-tag="chat-input-textarea"]';
	const theme = THEME ?? "localOperatorDark";
	await verb(cdp, "setTheme", theme);
	await verb(cdp, "navigate", "/chat");
	const mounted = await waitForCondition(
		cdp,
		`Boolean(document.querySelector('${composerSelector}') && document.querySelector('[data-lo-empty-mark]'))`,
		30_000,
	);
	check(
		"the chat route shows the empty state with a composer",
		mounted.ok,
		`composer + empty mark present: ${JSON.stringify(mounted.last)}`,
	);
	const size = `${WINDOW_WIDTH}x${WINDOW_HEIGHT}`;
	const emptyFrame = await captureSettled(cdp, `first-send-${size}-empty`);
	note("frame", JSON.stringify(emptyFrame));
	const before = (await verb(cdp, "measure", composerSelector)).rect;
	const stack = await cdp.evaluate(`(() => {
		const el = document.querySelector('[data-lo-suggestion-stack]');
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { y: Math.round(r.y), bottom: Math.round(r.bottom), chips: el.children.length };
	})()`);
	note("empty state", JSON.stringify({ composer: before, chips: stack }));
	check(
		"the chips sit ABOVE the docked composer (§H)",
		stack === null || stack.bottom <= before.y,
		`chips ${JSON.stringify(stack)} against composer y${before.y}`,
	);
	check(
		"the composer is docked in the pane's lower half on the empty state",
		before.y + before.height > WINDOW_HEIGHT * 0.6,
		`composer y${before.y} h${before.height} in a ${WINDOW_HEIGHT}px window`,
	);

	await clickAt(cdp, `${composerSelector} textarea`);
	await cdp.send("Input.insertText", { text: "Summarise yesterday's QA run." });
	await pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const sent = await waitForCondition(
		cdp,
		`(() => { const log = document.querySelector('[role="log"]'); return Boolean(log && log.textContent.includes("Summarise yesterday")) && !document.querySelector('[data-lo-empty-mark]'); })()`,
		45_000,
	);
	check(
		"the first message reached the transcript and the empty state is gone",
		sent.ok,
		`after ${sent.waitedMs ?? "?"}ms: ${JSON.stringify(sent.last)}`,
	);
	await wait(1500);
	const sentFrame = await captureSettled(cdp, `first-send-${size}-sent`);
	note("frame", JSON.stringify(sentFrame));
	const after = (await verb(cdp, "measure", composerSelector)).rect;
	/*
	 * AND ONCE THE TURN HAS SETTLED: the mock provider answers, and the session's
	 * readings (the model, the context) arrive with its first frames. Read so a
	 * transient that only exists while the session is starting is told apart from a
	 * settled layout that differs.
	 */
	const answered = await waitForCondition(
		cdp,
		`(() => { const log = document.querySelector('[role="log"]'); return Boolean(log && log.textContent.includes("from the mock provider")); })()`,
		60_000,
	);
	await wait(1500);
	const settledFrame = await captureSettled(cdp, `first-send-${size}-settled`);
	note("frame", JSON.stringify(settledFrame));
	const settled = (await verb(cdp, "measure", composerSelector)).rect;
	note(
		"composer box",
		JSON.stringify({ before, after, settled, answered: answered.ok }),
	);
	check(
		"the first send does not move the composer: its box is identical",
		before.x === after.x &&
			before.y === after.y &&
			before.width === after.width &&
			before.height === after.height,
		`x${before.x} y${before.y} w${before.width} h${before.height} -> x${after.x} y${after.y} w${after.width} h${after.height}`,
	);
	check(
		"the agent's answer arrived and the composer is still where it was",
		answered.ok &&
			before.x === settled.x &&
			before.y === settled.y &&
			before.width === settled.width &&
			before.height === settled.height,
		`answered=${answered.ok}; x${before.x} y${before.y} w${before.width} h${before.height} -> x${settled.x} y${settled.y} w${settled.width} h${settled.height}`,
	);
	/*
	 * WHAT THIS DOES NOT COVER, measured: with NO provider configured the composer's
	 * readings carry a `Choose a model` chip that leaves once the session starts, and
	 * at 800x600 that chip wraps the readings onto their own line - the box is 32px
	 * taller before the send than after (y442 h142 -> y474 h110). That is the readings
	 * row changing its content, not the band moving the composer, so the run seeds the
	 * mock provider (a configured user, which is the state the claim is about).
	 */
	return [emptyFrame, sentFrame, settledFrame];
}

/**
 * The DOCKED question card (§F1), on a real paused turn.
 *
 * WHAT PARKS THE TURN. The mock provider cannot ask a question with options, but
 * `[bash:N]` makes it call the real `bash` tool, and under the default
 * `tool_approval_mode: ask` the backend parks an APPROVAL gate on that call - a
 * genuine `pending_gate` the owner is blocked on, which the pane docks the same
 * way it docks an `ask`. The options, their hover and their keys are driven in
 * the Storybook story (`Chat/Ask options`), because no backend here can hold an
 * `ask` with options; this scene is the real-app half.
 *
 * WHAT IT ASSERTS. The card mounts above the composer (its bottom edge at or
 * above the composer's top, within the dock's 8px gap), not inside the
 * transcript's scroller; `Escape` - sent through `Input.dispatchKeyEvent`, so it
 * reaches the app's own handlers - collapses it to the pill, returns focus to the
 * composer and does NOT stop the turn (the gate is still pending); `Show` brings
 * it back.
 */
async function sceneQuestionDock(cdp) {
	const facts = await factsOf(cdp);
	check(
		"window mode is headless and the window is never shown or focused",
		facts.windowMode === "headless" &&
			facts.visible === false &&
			facts.focused === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const composerSelector = '[data-tour-tag="chat-input-textarea"]';
	await verb(cdp, "setTheme", THEME ?? "localOperatorDark");
	await verb(cdp, "navigate", "/chat");
	await waitForCondition(
		cdp,
		`Boolean(document.querySelector('${composerSelector}'))`,
		30_000,
	);
	await clickAt(cdp, `${composerSelector} textarea`);
	await cdp.send("Input.insertText", { text: "[bash:45] run the check" });
	await pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const docked = await waitForCondition(
		cdp,
		`(() => { const d = document.querySelector('[data-lo-question-dock="expanded"]'); return d ? d.textContent.slice(0, 160) : null; })()`,
		60_000,
	);
	check(
		"a real paused turn docks its question card",
		docked.ok,
		`after ${docked.waitedMs}ms: ${JSON.stringify(docked.last)}`,
	);
	const size = `${WINDOW_WIDTH}x${WINDOW_HEIGHT}`;
	// Frame labels are lowercase-only (the capture verb refuses anything else).
	const theme = (THEME ?? "localOperatorDark")
		.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
		.replace(/^-/, "");
	const dockedFrame = await captureSettled(
		cdp,
		`question-dock-${size}-${theme}-docked`,
	);
	const boxes = await cdp.evaluate(`(() => {
		const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
		const card = document.querySelector('[data-lo-question-dock] section');
		return {
			card: r(card),
			composer: r(document.querySelector('${composerSelector}')),
			inScroller: Boolean(card && card.closest('[data-lo-canonical-transcript]')),
		};
	})()`);
	note("docked boxes", JSON.stringify(boxes));
	check(
		"the card sits directly above the composer, outside the transcript",
		boxes.card &&
			boxes.composer &&
			!boxes.inScroller &&
			boxes.card.bottom <= boxes.composer.y &&
			boxes.composer.y - boxes.card.bottom <= 16 &&
			boxes.card.x === boxes.composer.x &&
			boxes.card.w === boxes.composer.w,
		JSON.stringify(boxes),
	);

	/*
	 * Escape, from INSIDE the card: focus is put on the card's first focusable by
	 * a trusted pointer press on its question text, then Escape goes through CDP's
	 * key pipeline.
	 */
	await clickAt(cdp, '[data-lo-question-dock="expanded"] section');
	await pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
	const collapsed = await waitForCondition(
		cdp,
		`Boolean(document.querySelector('[data-lo-question-dock="collapsed"]'))`,
		5_000,
	);
	await wait(400);
	const afterEsc = await cdp.evaluate(`(() => ({
		focus: document.activeElement ? (document.activeElement.getAttribute('aria-label') || document.activeElement.tagName) : null,
		stop: Boolean(document.querySelector('button[aria-keyshortcuts="Escape"]')),
	}))()`);
	check(
		"Escape collapses the card to the pill and hands focus to the composer",
		collapsed.ok && afterEsc.focus === "Message",
		JSON.stringify({ collapsed: collapsed.ok, ...afterEsc }),
	);
	const pillFrame = await captureSettled(
		cdp,
		`question-dock-${size}-${theme}-pill`,
	);
	const stillPending = await cdp.evaluate(
		`Boolean(document.querySelector('[data-lo-question-dock]'))`,
	);
	check(
		"Escape did not stop the turn: the question is still pending",
		stillPending === true,
		`dock present after Escape: ${stillPending}`,
	);
	await clickAt(cdp, `button[aria-label="Show the agent's question"]`);
	const shown = await waitForCondition(
		cdp,
		`Boolean(document.querySelector('[data-lo-question-dock="expanded"]'))`,
		5_000,
	);
	check("Show brings the card back", shown.ok, JSON.stringify(shown));
	const reshownFrame = await captureSettled(
		cdp,
		`question-dock-${size}-${theme}-reshown`,
	);
	return [dockedFrame, pillFrame, reshownFrame];
}

/**
 * §I's pane floors, measured at whatever `--window-size` the run was started with.
 *
 * WHY THIS IS A SCENE OF ITS OWN, and why it needs no backend. §I is a set of
 * statements about BOXES: the chat pane keeps a 480px floor; the canvas docks at
 * `min(560, available - 480)`; where that leaves less than the canvas's own 400px
 * floor the canvas stops docking and overlays the chat instead; the sidebar yields
 * to the 56px strip first. Nothing in that list is about data, so the run does not
 * need one - and the driver's own isolate (`openCanvasDocument` stages a draft,
 * because a run with no backend cannot open the New chat gate) is exactly what makes
 * a canvas dockable without a session.
 *
 * THE ONE THING IT CANNOT SAY, stated rather than implied: at a size where the
 * 640-wide column cannot fit, the transcript's own reading measure is a container
 * query the tree already handles, and the frames this scene writes are of a DRAFT
 * pane with no messages. Whether the prose reflows at 480 is not asserted here; it is
 * what the capture set's `b-qa`/`g-long` frames are for.
 *
 * A reader should run it at the four widths §I is written about:
 *
 *     --scene floors --window-size 1380x900   # docked: row 1120, canvas at its 560 cap
 *     --scene floors --window-size 1024x673   # the sidebar's dock threshold: dock 284 < 400 -> overlay
 *     --scene floors --window-size 960x673    # strip: row 904, dock 424 -> docked
 *     --scene floors --window-size 800x600    # strip: row 744, dock 264 -> overlay
 *
 * The four are the two bands of `resolveSidebarLayout` crossed with the two canvas
 * modes, and the assertions below are written about the RULES rather than about the
 * sizes so the same scene is honest at any width a reviewer passes.
 */
async function sceneFloors(cdp) {
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

	/*
	 * A document of this scene's own, under the run's scratch root (never a path in
	 * the repository): the pane needs a document to be mounted, and the file is
	 * deleted with the scratch tree the harness reaps.
	 */
	const dir = join(SCRATCH, "floors");
	mkdirSync(dir, { recursive: true });
	const document_ = join(dir, "floors.md");
	writeFileSync(
		document_,
		"# Pane floors\n\nThe canvas's own document, so the pane has something to dock.\n",
	);

	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", "localOperatorDark");
	const opened = await verb(cdp, "openCanvasDocument", { path: document_ });
	check(
		"a document is in the canvas, so the pane is mounted at all",
		Boolean(opened) && typeof opened === "object",
		`openCanvasDocument answered ${JSON.stringify(opened).slice(0, 160)}`,
	);
	/*
	 * THE PANE IS NOT THERE WITHOUT A BACKEND, AND THAT IS MEASURED RATHER THAN
	 * ASSUMED. `docs/agent-driver.md` says `openCanvasDocument` "also stages a draft,
	 * because a run with no backend cannot open the New chat gate and without a pane
	 * identity there is no conversation for the document to belong to" - but on this
	 * head the chat route renders the refusal surface instead of a draft pane when no
	 * backend answers (`floors-1380x900-none.png`, kept with the run), so the canvas's
	 * mount condition is never reached and no canvas box exists to measure. The wait
	 * below is what distinguishes that from a React flush the scene read too early:
	 * the window is generous and the answer is recorded either way.
	 */
	const paneMounted = await waitForCondition(
		cdp,
		"(() => { const el = document.querySelector('[data-tour-tag=\"canvas-dock\"]'); return el ? el.getAttribute('data-canvas-mode') : null; })()",
		15_000,
	);
	note(
		"canvas pane",
		JSON.stringify({ mounted: paneMounted.ok, mode: paneMounted.last }),
	);
	const route = await verb(cdp, "state");
	note("route the run ended on", JSON.stringify(route));

	/*
	 * THE FRAME FIRST, THEN THE NUMBERS, and the order is the whole reason this scene is
	 * trustworthy. `captureSettled` commits a frame only when two captures 150ms apart are
	 * byte-identical, so it is also the scene's proof that the layout has STOPPED MOVING -
	 * and the canvas's own wrapper carries `transition-[width] duration-base`, which means a
	 * reading taken before that ends describes a layout that never existed on screen.
	 * Measured, 2026-09-24: reading first caught chat 942 / canvas 179 at 1380x900 and FAILED
	 * the pane's 400px floor, while the settled frame shows the 560/560 shape. A false FAIL is
	 * as bad as a false PASS: it costs a lane a hunt through the code for a defect that is in
	 * the measurement.
	 */
	const mode = paneMounted.last ?? null;
	const frame = await captureSettled(
		cdp,
		`floors-${WINDOW_WIDTH}x${WINDOW_HEIGHT}-${mode ?? "none"}`,
	);
	note("frame", JSON.stringify(frame));
	/*
	 * The boxes come from the harness's own `measure` verb - the same one the other scenes
	 * use - rather than from a geometry verb added for this scene: `measure` waits for its
	 * element, hit-tests the painted centre and reports the rect, and the shell's three boxes
	 * are named by `data-tour-tag` for exactly this. A second geometry verb beside it would
	 * be the "second way" this repository treats as a defect.
	 */
	const row = (await verb(cdp, "measure", '[data-tour-tag="pane-row"]')).rect;
	const chatColumn = (
		await verb(cdp, "measure", '[data-tour-tag="chat-column"]')
	).rect;
	const expectCanvas = BACKEND !== null;
	const canvas = expectCanvas
		? (await verb(cdp, "measure", '[data-tour-tag="canvas-dock"]')).rect
		: null;
	note("boxes", JSON.stringify({ row, chatColumn, canvas, mode }));
	check(
		"the row and the chat column are both named in the DOM",
		Boolean(row) && Boolean(chatColumn),
		`row=${JSON.stringify(row)} chatColumn=${JSON.stringify(chatColumn)}`,
	);
	/*
	 * §I's canvas half needs a backend on this head, and the run says so instead of
	 * reporting a green it did not earn: `expectCanvas` is true only when the run was given
	 * `--backend`, and the assertions about the pane's mode are made only then. Everything
	 * else below - the column's floor, where it starts, whether it stays inside the row -
	 * is measured in both shapes, because the chat column exists either way.
	 */
	if (expectCanvas) {
		check(
			"the canvas pane is mounted and says which mode it is in",
			Boolean(canvas) && (mode === "docked" || mode === "overlay"),
			`mode=${mode} canvas=${JSON.stringify(canvas)}`,
		);
	} else {
		note(
			"the canvas half of §I is NOT measured in this run",
			`no --backend: the run reached ${route?.route ?? "?"} and the chat route drew its refusal surface, so the canvas never mounts (measured, not assumed - see the frame). The chat column's own floor and placement below ARE measured; the pane's dock/overlay rules need a run with --backend or the capture rig.`,
		);
	}

	if (row && chatColumn) {
		/*
		 * THE INVARIANTS THE 2026-09-24 DEFECT BROKE, asserted here as well as in the
		 * capture meter because this run needs no backend, no seeded session and no
		 * full capture set: the column starts in the shell's own left region (the
		 * sidebar is 0, 56 or 260 of those pixels) and it holds §B1's floor.
		 */
		check(
			"the chat column starts in the shell's left region",
			chatColumn.x <= 320,
			`chatColumn.x=${chatColumn.x}: the sidebar occupies 0/56/260, so a column further right means the pane did not take the row`,
		);
		check(
			"the chat column holds §B1's 480px floor",
			chatColumn.width >= 480,
			`chatColumn.width=${chatColumn.width}: §B1's floor is on the column itself, and the computed min-width is pinned in scripts/chat-pane-floors.test.mjs - this scene reads the box after the layout settled`,
		);
		check(
			"the chat column stays inside the row",
			chatColumn.x + chatColumn.width <= row.x + row.width + 1,
			`chatColumn ${chatColumn.x}+${chatColumn.width} against row ${row.x}+${row.width}`,
		);
	}

	if (expectCanvas && row && chatColumn && canvas) {
		if (mode === "docked") {
			check(
				"a docked canvas is at least its own 400px contract floor",
				canvas.width >= 400,
				`canvas.width=${canvas.width} in a row of ${row.width}: below 400 the pane must overlay instead of docking`,
			);
			check(
				"a docked canvas is no wider than §I's 560px ceiling",
				canvas.width <= 560 + 1,
				`canvas.width=${canvas.width}`,
			);
			check(
				"the two columns tile the row, the divider between them",
				row.width - (chatColumn.width + canvas.width) >= 0 &&
					row.width - (chatColumn.width + canvas.width) <= 24,
				`row ${row.width} = chat ${chatColumn.width} + canvas ${canvas.width} + ${row.width - (chatColumn.width + canvas.width)} unaccounted`,
			);
		} else {
			check(
				"an overlaying canvas covers the chat column's trailing edge",
				canvas.x < chatColumn.x + chatColumn.width,
				`canvas.x=${canvas.x} against the column's ${chatColumn.x}+${chatColumn.width}`,
			);
			check(
				"an overlaying canvas stays inside the row",
				canvas.x >= row.x - 1 &&
					canvas.x + canvas.width <= row.x + row.width + 1,
				`canvas ${canvas.x}+${canvas.width} against row ${row.x}+${row.width}`,
			);
			check(
				"the chat column keeps its floor behind the overlay",
				chatColumn.width >= 480,
				`chatColumn.width=${chatColumn.width} behind a ${canvas.width}px overlay`,
			);
		}
	}

	/*
	 * THE COMPOSER AT REST (design round 2, D25(b)).
	 *
	 * Every frame at head carries the 2px `outline-accent` ring, because the empty state
	 * autofocuses a text input and a text input always matches `:focus-visible` - so §G1's
	 * "`outline-accent` 2px at `:focus-visible` ONLY" had no frame at rest to be judged in,
	 * and the operator's loudest original complaint (design round 1's D12, the resting
	 * accent ring) was the one thing the set could not show.
	 *
	 * A blur is what clicking the pane's ground does to it, and the read below is the half
	 * a frame cannot state on its own: the box's own outline is `none` (or zero-width) and
	 * NOTHING inside the composer matches `:focus-visible`. The frame is the other half.
	 */
	const blurred = await cdp.evaluate(`(() => {
		const active = document.activeElement;
		if (active && typeof active.blur === "function") active.blur();
		return { was: active ? (active.getAttribute("aria-label") ?? active.tagName) : null };
	})()`);
	await wait(250);
	const resting = await cdp.evaluate(`(() => {
		const box = document.querySelector('[data-tour-tag="chat-input-textarea"]');
		const band = box ? (box.closest("form") ?? box.parentElement) : null;
		const style = box ? getComputedStyle(box) : null;
		return {
			outlineStyle: style ? style.outlineStyle : null,
			outlineWidth: style ? style.outlineWidth : null,
			ringed: band ? [...band.querySelectorAll("*")].filter((el) => el.matches(":focus-visible")).length : null,
			focused: document.activeElement ? document.activeElement.tagName : null,
		};
	})()`);
	check(
		"the composer at rest draws no focus ring",
		resting.ringed === 0 &&
			(resting.outlineStyle === "none" || resting.outlineWidth === "0px"),
		JSON.stringify({ blurred, resting }),
	);
	await parkPointer(cdp);
	const restFrame = await captureSettled(
		cdp,
		`floors-${WINDOW_WIDTH}x${WINDOW_HEIGHT}-${mode ?? "none"}-unfocused-dark`,
	);
	note("frame at rest", JSON.stringify(restFrame));

	/*
	 * ESC CLOSES THE CANVAS (UX round 1, U6), driven here because this is the one scene
	 * that has a canvas mounted at all: the reviewer pressed Escape at 1380x900 with the
	 * transcript focused and the pane's own control still read `Close canvas`.
	 *
	 * The press goes to the WINDOW (the pane's binding is a window listener), and the focus
	 * is put on the transcript first - the state the reviewer was in - so this is the
	 * binding under test rather than a control's own click. The pane is re-opened at the
	 * end so a later step in this scene (or a second palette's run) is not changed by it.
	 */
	if (expectCanvas && (mode === "docked" || mode === "overlay")) {
		await cdp.evaluate(
			`(() => { const t = document.querySelector('[data-lo-canonical-transcript]'); if (t) t.focus(); return true; })()`,
		);
		await pressChord(cdp, {
			key: "Escape",
			code: "Escape",
			virtualKeyCode: 27,
		});
		await wait(400);
		const closed = await cdp.evaluate(`(() => ({
			pane: document.querySelector('[data-tour-tag="canvas-dock"]') ? "mounted" : "gone",
			control: (() => { const b = document.querySelector('[data-tour-tag="open-canvas-button"]'); return b ? (b.getAttribute("aria-label") ?? "unlabelled") : null; })(),
			focus: document.activeElement ? (document.activeElement.getAttribute("data-tour-tag") ?? document.activeElement.tagName) : null,
		}))()`);
		check(
			"Escape closes the canvas pane",
			closed.pane === "gone",
			JSON.stringify(closed),
		);
		/*
		 * AND THE READER KEEPS THEIR PLACE. The header moves focus to the toggle only when
		 * the close LOST it (`document.activeElement === document.body`), and that guard is
		 * deliberate and shipped: closing the pane from the command palette while the
		 * composer holds the caret must not pull it out of the message being typed. This
		 * scene presses Escape with the TRANSCRIPT focused - the state the reviewer was in -
		 * so the correct reading is the other half of the same rule: focus stays where they
		 * put it and does not fall to the body, which is the defect round 1's U5 named.
		 */
		check(
			"closing from the transcript leaves the reader's focus where they put it",
			closed.focus !== "BODY",
			JSON.stringify(closed),
		);
		await verb(cdp, "openCanvasDocument", { path: document_ });
	}
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
	/*
	 * THE CONTENT FILLS THE WINDOW ON macOS, AND THAT IS THE DESIGN RATHER THAN A LOST INSET
	 * (QA round 1's Q1).
	 *
	 * This assertion used to demand `contentBounds.height < windowSize.height` with an inset of
	 * at most 40px, and it fails on this head at every size: measured on darwin/headless at
	 * 1024x673 and 1380x900, `windowSize == contentBounds` exactly (`floors-*`'s own facts note
	 * carries the same reading at three sizes). The assertion was written when the OS drew the
	 * frame; this PR switches macOS to `titleBarStyle: "hidden"` (`src/main/titlebar-options.ts`),
	 * and a hidden title bar is precisely a window whose CONTENT IS THE WHOLE WINDOW - "hidden
	 * leaves them [the traffic lights] and their OS-managed hit targets intact, so the renderer
	 * never draws substitute controls", and "on macOS the renderer gives the OS controls their own
	 * 32px lane and puts every column's first row BELOW it". So the inset is not lost, it moved:
	 * the app reserves the lane itself, and a window whose content was 40px shorter would put the
	 * lights over the renderer's own first row - the defect this change exists to remove.
	 *
	 * The check therefore asks what is actually true on each path: the content is never WIDER or
	 * TALLER than the window, an inset that exists is at most the platform's own frame, and where
	 * the OS frame is gone the app's own lane must be there to take its place. That last clause is
	 * the half that makes this a check rather than a relaxation, and `laneIsMac` below is where it
	 * is read - from the RENDERED lane, not from the mode the flag claims.
	 */
	const lane = await cdp.evaluate(`(() => {
		const el = document.querySelector('[data-titlebar-lane]');
		const root = document.documentElement;
		const style = el ? getComputedStyle(el) : null;
		const rect = el ? el.getBoundingClientRect() : null;
		return {
			platform: root.getAttribute('data-chrome-platform'),
			mode: root.getAttribute('data-chrome-mode'),
			display: style ? style.display : null,
			height: rect ? Math.round(rect.height) : null,
			width: rect ? Math.round(rect.width) : null,
			top: rect ? Math.round(rect.top) : null,
		};
	})()`);
	const laneIsMac =
		lane.display !== "none" && lane.height === 32 && lane.top === 0;
	note("the macOS chrome lane", JSON.stringify(lane));
	check(
		"the content area never exceeds the window, and an inset that exists is the platform's own frame",
		facts.contentBounds.width === facts.windowSize.width &&
			facts.contentBounds.height <= facts.windowSize.height &&
			facts.windowSize.height - facts.contentBounds.height <= 40,
		`window ${JSON.stringify(facts.windowSize)} content ${JSON.stringify(facts.contentBounds)}`,
	);
	check(
		"where the OS frame is gone the app reserves its own 32px lane",
		facts.contentBounds.height === facts.windowSize.height ? laneIsMac : true,
		`full-bleed content on ${lane.platform}/${lane.mode}: lane ${lane.display} ${lane.width}x${lane.height} at y${lane.top}`,
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
	// not only its stores: press the sidebar's Agent hub destination and then its
	// Schedules destination, and watch the route move both ways. No frame is
	// captured from either destination: `agent-hub` is one of the backend-gated
	// routes above, and capturing the spinner would say less than this assertion
	// does.
	//
	// THE `Chat` RAIL ROW THIS STEP USED TO PRESS NO LONGER EXISTS (design round
	// 1, D1; spec §C1/§C3). The chat list IS that destination now, and every
	// remaining door onto `/chat` is gated on a backend — the sidebar's `New chat`
	// row (`disabled: !catalogueReady`) and the command palette's `New chat` item
	// (`canStageDraft`, the same `session_catalogue` bit) both refuse — so on a
	// backendless driver run, which is this scene by construction, there is no
	// control that lands on `/chat`. Measured on the head this was rewritten at:
	// the press found its element and the route stayed `/agent-hub`.
	//
	// The second press is therefore the next destination that IS reachable, and
	// the claim this step makes is unchanged — a real control receives the point
	// and the app's own handler moves the route — while the frame is named for
	// what it is: the shell, in the light theme, after a route round trip.
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
	const shellPress = await verb(
		cdp,
		"press",
		'[data-tour-tag="nav-item-schedules"]',
	);
	const shellState = await verb(cdp, "state");
	check(
		"pressing the sidebar's Schedules destination navigated the app, and the theme survived",
		shellPress.hitTest === true &&
			shellState.route === "/schedules" &&
			shellState.theme === "localOperatorLight",
		JSON.stringify(shellState),
	);
	const backFrame = await captureSettled(cdp, "shell-light-returned");
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
 * the pin store), the same scene takes `pins-withdrawn-<theme>` and
 * `pins-withdrawn-selected-<theme>` instead of all of the above, asserting the two
 * halves of fail-closed: NO control mounted anywhere, and the row rendered as MAIN'S
 * OWN BOX around the button - which is what makes its frames comparable, byte for
 * byte, with the same scene's frames from `origin/main`.
 *
 * Why there are two withdrawn frames and not one (design round 8, D1): the
 * withdrawn path AT REST cannot fail, which is exactly how a row that had lost
 * main's flex box survived this branch's nine folds - the button shrink-to-fit its
 * words only where a selection or a ground made the difference visible. The
 * second frame opens a conversation first, so the selected row's ground and the
 * row's own click strip are on screen, and the pair's byte comparison covers the
 * state the defect hid in.
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
/**
 * Every UNPINNED row whose box intersects the region's own window, in document order.
 *
 * Module-level because two panel scenes need the same answer from the same reading: the scrolled
 * pair picks its press target with it, and `scenePins` picks both the row it lands the caret on and
 * the row it presses - a press aimed at a row the region has scrolled out of view lands on nothing
 * (QA round 9, Q9-1).
 */
function visibleUnpinnedRows(list) {
	return list.rows.filter(
		(row) =>
			row.pinned === false &&
			row.pin !== null &&
			row.box.bottom > list.listBox.top && // intersects the region's window
			row.box.top < list.listBox.bottom,
	);
}

/**
 * Whether a row's own box is WHOLLY inside the region's window.
 *
 * The difference between this and `visibleUnpinnedRows` is a partially visible row: focusing or
 * hovering one of those makes the browser scroll it the rest of the way in, which moves the list
 * under whatever the next step is holding. `scenePins` picks its caret row and its press row with
 * both predicates for that reason (QA round 9, Q9-1).
 */
const whollyInside = (list, row) =>
	row.box.top >= list.listBox.top && row.box.bottom <= list.listBox.bottom;

async function scenePinsScrolled(cdp) {
	const frames = [];

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
	const themes =
		THEME === null ? ["localOperatorDark", "localOperatorLight"] : [THEME];
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
		const candidates = visibleUnpinnedRows(scrolled);
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
		const pressedNowA = afterA.rows.find(
			(row) => row.id === targetA.id,
		)?.pinned;
		check(
			"the press acted: the pressed row's pin state inverted (D24: a dropped press must not read as a geometry failure)",
			wasA?.pinned !== undefined &&
				pressedNowA !== undefined &&
				wasA.pinned !== pressedNowA,
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
		const forKeyboard = visibleUnpinnedRows(await readList(cdp));
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
		const deepCandidates = visibleUnpinnedRows(deepScrolled);
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
	/*
	 * Whether THIS run met a backend with no pin store. The theme loop sets it, and the
	 * cross-surface leg below reads it: with no control on this surface there is nothing to
	 * write through and no pinned row for the terminal's own writer to move, so that leg's
	 * object does not exist rather than failing (design round 8, D2 - it used to end every
	 * withdrawn run with one FAIL for a round trip that cannot hold).
	 */
	let withdrawn = false;
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
		 * WHAT THE PIN CONTROL COSTS A TITLE (design round 1, D5). Measured rather than
		 * argued: the conversation button's own box against the withdrawn run's, where
		 * no control exists. Both numbers are printed by the two runs, so the cost is a
		 * subtraction in the record rather than a claim in a comment. IT IS A COST PAID
		 * UNDER THE POINTER NOW, not at rest: both acts are absent from the layout until
		 * the pointer or the focus is inside the row (design D3 of
		 * `docs/design/sidebar-row-space.md`), so on an unpinned row at rest this reads
		 * 0 for both controls - and the `row-space` scene is where the table of what is
		 * paid when is asserted.
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
			 * THE FAIL-CLOSED HALF. No pin control anywhere, and the conversation row is MAIN'S
			 * ROW: main's own box around the button, with nothing else in it. This branch used to
			 * render a bare button here, which stopped being main's row when main's `ce5fd9578`
			 * gave the row its box - and a button with no flex parent to grow in shrink-to-fits
			 * its words, which is what design round 8 (D1) measured at 138.3 / 210.7 / 179.0 /
			 * 165.6px against main's 264px, with the row's click strip and the selected row's
			 * ground shrinking to match.
			 *
			 * So one of the checks below is a CAUSE rather than a shape (`filled`: the button
			 * fills the box it sits in), because a shape-only check is what passed while the row
			 * was wrong - and the byte comparison against this same scene's frames from
			 * `origin/main` is what closes the claim.
			 */
			withdrawn = true;
			check(
				"the backend advertises no pin store, so no control is mounted",
				start.controls === 0,
				JSON.stringify({ rows: start.rows.length, pins: start.controls }),
			);
			/*
			 * WHAT THE SLOT COSTS, on the side that has none (design round 1, D5), read the same
			 * way in both withdrawn states: the row's own box against the box it sits in, so the
			 * cost is a subtraction between two numbers in this log rather than a claim.
			 */
			const withdrawnBoxes = () =>
				cdp.evaluate(`(() => {
					const row = document.querySelector('button[data-tour-tag="chat-session-row"]');
					if (!row) return null;
					const box = row.getBoundingClientRect();
					const parent = row.parentElement;
					const parentBox = parent ? parent.getBoundingClientRect() : box;
					return {
						parentTag: parent ? parent.tagName.toLowerCase() : null,
						row: Math.round(parentBox.width),
						button: Math.round(box.width),
						filled: Math.abs(parentBox.width - box.width) <= 1,
						current: row.getAttribute("aria-current"),
					};
				})()`);
			const atRest = await withdrawnBoxes();
			check(
				"a conversation row is main's own box around the button - no slot, and nothing else in it",
				start.rows.length > 0 &&
					start.rows.every(
						(row) =>
							row.parentTag === "div" &&
							row.buttonsInParent === 1 &&
							row.pinSibling === 0,
					),
				JSON.stringify(start.rows.slice(0, 3)),
			);
			check(
				"the conversation button FILLS the box around it (D1: a button narrower than its box is a button with no flex parent)",
				atRest !== null && atRest.filled === true,
				JSON.stringify(atRest),
			);
			if (atRest !== null) {
				say(
					`  [pins] reserved slot: withdrawn row ${atRest.row}px, conversation button ${atRest.button}px, pin none`,
				);
			}
			frames.push(await captureSettled(cdp, `pins-withdrawn-${suffix}`));
			/*
			 * THE DISCRIMINATING STATE, and the reason there are two withdrawn frames rather
			 * than one: AT REST this path cannot fail - which is exactly how a row that had lost
			 * main's flex box survived nine folds, because it only shrink-to-fit where a
			 * selection or a ground made the difference visible (a 138px button beside a 264px
			 * box paints the same pixels as main's when nothing is selected). So the pair is also
			 * taken with a conversation OPEN, through the panel's own row press - the instrument
			 * the enabled path's `pins-selected` uses - and that is the frame the D1 comparison
			 * turns on.
			 */
			await parkPointer(cdp);
			const openRow = await rowBox(cdp, 0);
			await pressPointer(cdp, openRow.x, openRow.y);
			await waitForScene(
				cdp,
				`(() => {
					const row = document.querySelector('button[data-tour-tag="chat-session-row"]');
					return Boolean(row) && row.getAttribute("aria-current") === "page";
				})()`,
			);
			const selectedWithdrawn = await readPins(cdp);
			check(
				"with a conversation OPEN, the withdrawn row is still main's box and carries the current-row ground",
				selectedWithdrawn.rows.some(
					(row) =>
						row.ariaCurrent === "page" &&
						row.parentTag === "div" &&
						row.pinSibling === 0,
				),
				JSON.stringify(selectedWithdrawn.rows.slice(0, 3)),
			);
			const opened = await withdrawnBoxes();
			check(
				"the selected withdrawn row's button still fills its box",
				opened !== null && opened.current === "page" && opened.filled === true,
				JSON.stringify(opened),
			);
			if (opened !== null) {
				say(
					`  [pins] reserved slot: withdrawn row (conversation open) ${opened.row}px, conversation button ${opened.button}px, pin none`,
				);
			}
			frames.push(
				await captureSettled(cdp, `pins-withdrawn-selected-${suffix}`),
			);
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
		 * AND FOCUS REVEALS IT - measured, because nothing had measured it (design round 8):
		 * the pointer half is photographed above, and the keyboard half was only ever exercised
		 * on an ALREADY-pinned row's glyph, where the control is at full opacity whatever the
		 * caret does. The class list claims both (`group-hover:opacity-100` and
		 * `group-focus-within:opacity-100`), and `group-focus-within` is what makes the control
		 * reachable without a mouse - so the claim is worth a reading rather than a citation.
		 *
		 * THE CARET'S OWN PIN, AND NO SCROLL OF ITS OWN (QA round 9, Q9-1). The first version of
		 * this block focused the LAST row and read its pin BY INDEX. Focusing a row the browser has
		 * to reach SCROLLS the region - measured at `scrollTop 1075` on a 40-conversation store -
		 * and the press below then aimed at a stored box 416 px above the viewport: the point
		 * hit-tested to nothing, no write reached the backend, and the scene failed four checks for
		 * a reason of its own making. So the row is taken from those ALREADY inside the region's
		 * window (the predicate the scrolled pair presses with), which makes this a caret move and
		 * not a scroll; the focus is VERIFIED before a key is sent, because a row that re-renders
		 * under the caret loses it; the caret is moved by a REAL Tab from the row's own button,
		 * which is the path a keyboard reader takes; and the pin that is read is the one the CARET
		 * holds rather than the one at an index. The region is then read back, because a scene that
		 * moves the panel to take a reading owns the state it leaves behind.
		 */
		await parkPointer(cdp);
		const beforeFocus = await readList(cdp);
		const focusRow =
			visibleUnpinnedRows(beforeFocus)
				.filter((row) => whollyInside(beforeFocus, row))
				.at(-1) ?? null;
		require("there is an unpinned row inside the region to land the caret on", focusRow, JSON.stringify(
			beforeFocus.rows.slice(-2),
		));
		let caretOnRow = null;
		for (let attempt = 0; attempt < 4; attempt += 1) {
			caretOnRow = await cdp.evaluate(`(() => {
				// The BUTTON, not the row: data-session-row is on the wrapper, and a div with no
				// tabindex cannot take the caret, so focusing it is a silent no-op (measured here).
				const row = document.querySelector('[data-session-row="${focusRow.id}"]');
				const button = row ? row.querySelector("button[data-chat-row]") : null;
				if (!button) return null;
				button.focus();
				return {
					onButton: document.activeElement === button,
					inRow: row.contains(document.activeElement),
				};
			})()`);
			if (caretOnRow?.onButton === true) break;
			await wait(220);
		}
		require("the caret can be put on the row's own button", caretOnRow?.onButton ===
			true, JSON.stringify(caretOnRow));
		/* A REAL key, not a `.focus()` on the pin: the reveal under test is `group-focus-within`, and
		   what a keyboard reader actually does to reach the control is Tab from the row's button. */
		await pressChord(cdp, { key: "Tab", code: "Tab", virtualKeyCode: 9 });
		await wait(260);
		const caret = await cdp.evaluate(`(() => {
			const active = document.activeElement;
			const pin = active && active.closest ? active.closest("[data-session-pin]") : null;
			const row = active && active.closest ? active.closest("[data-session-row]") : null;
			return {
				onPin: pin !== null,
				subject: pin ? pin.getAttribute("aria-label") : null,
				row: row ? row.getAttribute("data-session-row") : null,
			};
		})()`);
		const focusedReveal = await readList(cdp);
		const caretRow = focusedReveal.rows.findIndex(
			(row) => row.id === (caret?.row ?? focusRow.id),
		);
		check(
			"the caret on an unpinned row reveals ITS pin and no other (design round 8: the focus half of the reveal)",
			caretOnRow?.onButton === true &&
				caret !== null &&
				caret.onPin === true &&
				caret.row === focusRow.id &&
				caretRow >= 0 &&
				focusedReveal.rows[caretRow]?.pinOpacity === "1" &&
				focusedReveal.rows.filter(
					(row, index) => index !== caretRow && row.pinOpacity === "1",
				).length === 0,
			JSON.stringify({
				caretOnRow,
				caret,
				label: focusRow.label,
				opacities: focusedReveal.rows.map((row) => row.pinOpacity),
			}),
		);
		/* Printed for the same reason the slot's cost is: a claim about what focus does is worth
		   a reading in the log, not only a green check. */
		say(
			`  [pins] focus reveal: caret ${JSON.stringify(focusRow.label)} -> ${JSON.stringify(caret ? caret.subject : null)}; pin opacities ${JSON.stringify(focusedReveal.rows.map((row) => row.pinOpacity))}`,
		);
		/*
		 * THE CARET GOES, AND THE REGION IS READ BACK. A focus ring left in the frames that follow
		 * would be this check's residue rather than the panel's state - and the region must be where
		 * the check found it, which is the property the first version of this block broke.
		 */
		await cdp.evaluate(
			`(() => {
				if (document.activeElement) document.activeElement.blur();
			})()`,
		);
		const afterFocus = await readList(cdp);
		check(
			"the focus reading left the region where it found it (Q9-1: a scene that moves the list owns what it leaves)",
			afterFocus.scrollTop === beforeFocus.scrollTop,
			JSON.stringify({
				before: beforeFocus.scrollTop,
				after: afterFocus.scrollTop,
			}),
		);
		await parkPointer(cdp);
		await wait(120);
		await parkPointer(cdp);
		await wait(120);

		/*
		 * THE PRESS. A real button pair at the first row's control, and then the panel
		 * itself: the conversation must move into a `Pinned chats` section whose
		 * heading sits ABOVE the `All chats` row and the sections under it - the
		 * operator's "above Active Chats", read as a position in the panel.
		 *
		 * AND THE ROW IS CHOSEN FROM WHAT IS ON SCREEN, WITH THE POINT HIT-TESTED FIRST (QA round 9,
		 * Q9-1). The row comes from those inside the region's window, and what a press at its pin's
		 * centre would ACT on is read back before the press - the instrument QA round 1's U3
		 * introduced, which is what makes a missed press name itself instead of looking like a
		 * backend that ignored it. The earlier code pressed `pins[0]`'s STORED box blind, which is
		 * only correct while nothing scrolls: QA round 9 measured that box 416 px above the viewport
		 * on a 40-conversation store, with the press landing on nothing.
		 */
		await parkPointer(cdp);
		const pressView = await readList(cdp);
		const pressRow =
			visibleUnpinnedRows(pressView).find((row) =>
				whollyInside(pressView, row),
			) ?? null;
		require("the panel has an unpinned row inside the region to press", pressRow, JSON.stringify(
			pressView.rows.slice(0, 3),
		));
		await movePointer(cdp, pressRow.pin.x, pressRow.pin.y);
		await wait(240);
		const pressAt = await readList(cdp, {
			x: pressRow.pin.x,
			y: pressRow.pin.y,
		});
		require("the pin the press will act on is the one under the pointer", pressAt
			?.atPoint?.pin === true, JSON.stringify(pressAt?.atPoint ?? null));
		await pressPointer(cdp, pressRow.pin.x, pressRow.pin.y);
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

	if (TUI_PYTHON !== null && TUI_CONFIG !== null && !withdrawn) {
		await crossSurfacePin(cdp);
	} else if (withdrawn) {
		note(
			"cross-surface pin",
			"not driven: this backend advertises no `session_pins`, so this surface mounted no control to write through and has no pinned row for the terminal's own writer to move - the round trip's object does not exist here rather than failing (design round 8, D2)",
		);
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
 * step's reading. Each key's own CHARACTER rides the down half — see `keyText`, which is
 * not decoration: without it a chord reaches the page and performs no default action at
 * all, which is how a real button press went missing.
 */
async function pressChord(
	cdp,
	{ key, code, virtualKeyCode, modifiers = 0, commands },
) {
	const text = keyText({ code, key, modifiers });
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key,
			code,
			modifiers,
			windowsVirtualKeyCode: virtualKeyCode,
			nativeVirtualKeyCode: virtualKeyCode,
			/*
			 * THE CHARACTER GOES ON THE DOWN HALF ONLY, like a real keyboard: the up event
			 * carries no character, and sending one there would dispatch a second one.
			 */
			...(type === "keyDown" && text !== null
				? { text, unmodifiedText: text }
				: {}),
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
 * ONE CHORD'S OWN CHARACTER, when the key it names produces one.
 *
 * `Input.dispatchKeyEvent` carries the character a key generates in `text` (and
 * `unmodifiedText`), and leaving it off is not a tidiness question: the browser's DEFAULT
 * ACTIVATION of a focused control arrives on the character phase, so a chord sent without
 * it reaches the page and performs no default action at all. This file has measured that
 * and worked around it twice rather than fixing it here — the browser pane's trigger had
 * to be opened with a programmatic click because "`Input.dispatchKeyEvent` for Enter does
 * not produce Chromium's default activation for the button over this CDP path", and an
 * editing chord needed Chromium's own `commands` because a bare modifier+key performs no
 * edit. Both are this omission, and the `row-space` scene's keyboard-unpin walk is where
 * it is now asserted instead of worked around (its delivery precondition reads the pin's
 * own keydown and click, so a chord that cannot activate a button is named as the rig's
 * failure rather than the app's).
 *
 * The map is the contract's own rule ("not needed for keys that do not generate text")
 * spelled out for the keys this file presses, read from `code` because that is the
 * physical key and `key` is what the layout made of it:
 *
 *   - Enter and Space, because a focused button is activated by them (Enter on the down
 *     half, Space on the up), which is the case every keyboard walk depends on;
 *   - Tab, because a real keyboard sends its character too;
 *   - a single printable character, because that is what an editor receives;
 *   - NONE for Escape, the arrows or the function keys, and none for a chord carrying a
 *     modifier: `Cmd+A` is a command rather than a character, which is what `commands` is
 *     for.
 */
function keyText({ code, key, modifiers }) {
	if (modifiers !== 0) return null;
	if (code === "Enter" || code === "NumpadEnter") return "\r";
	if (code === "Space") return " ";
	if (code === "Tab") return "\t";
	return key.length === 1 && key > " " ? key : null;
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
/**
 * The two browser-approval badges: the app rail's count, and the chat header's.
 *
 * WHAT THIS SCENE IS FOR (operator ask, 2026-09-23). Two surfaces promise a number
 * and neither can be judged from a still:
 *
 * - the APP RAIL's Browser item carries the count of LIVE approval requests ACROSS
 *   EVERY CONVERSATION (`useAppWideApprovals`), which is the capability the 2026-09-18
 *   removal took out of the sidebar and never put back anywhere;
 * - the CHAT HEADER's Globe trigger carries THIS conversation's count, including while
 *   its pane is open - the state the operator reported as a missing badge, and the
 *   reason the trigger no longer unmounts with its pane.
 *
 * The claim is therefore THREE NUMBERS PER STATE, read from the app rather than
 * counted by this script: what the host's own projection holds, what the rail says, and
 * what the header says. A frame cannot carry any of them, so the scene asserts them and
 * the frames are the visual half (the badge's box against the rail's width, whether the
 * label moved, the row's height).
 *
 * WHY THE REQUESTS ARE RAISED THROUGH THE APP'S OWN RPC (`browserRpc`): that is the
 * endpoint an agent's client speaks, so the entries are raised the way a real request
 * is - including their REQUESTER, which is the field the whole attribution question
 * turns on. Three requesters appear here and each is a case:
 *
 *   - this conversation's own session id (it counts on the header AND the rail);
 *   - another conversation's (`session:other-conversation-live`, a NAME rather than a
 *     second live session - the approval store keys on the requester string, which is
 *     the field the tray reads) - it counts on the rail only, which is the whole point
 *     of having a rail badge at all;
 *   - no session identity at all (`call:...`, which is what `requesterOf` falls back to
 *     for a caller that cannot present one, and what a subagent's own session id looks
 *     like to the renderer: a requester, not a conversation) - it counts on the rail and
 *     on no conversation's badge, which is why the rail's count is not the conversations'
 *     count summed.
 *
 * WITHOUT `--backend` there is no chat route and so no header to photograph: the scene
 * says which half it could not reach rather than passing on the rail alone.
 */
async function sceneApprovalBadges(cdp) {
	/**
	 * `check` with its reading on the PASS line too, because on this scene the reading IS
	 * the claim: `check`'s third argument is shown only when the check FAILS, and a
	 * transcript where every passing line withholds the number is a transcript nobody can
	 * audit. Same function, both slots.
	 */
	const reading = (label, ok, text) => check(label, ok, text, text);
	const hello = await verb(cdp, "hello");
	reading(
		"the renderer reports this run's frames directory",
		hello.outDir === FRAMES,
		`${hello.outDir} (expected ${FRAMES})`,
	);

	const themes =
		THEME === null ? ["localOperatorDark", "localOperatorLight"] : [THEME];

	for (const theme of themes) {
		const suffix = theme === "localOperatorDark" ? "dark" : "light";
		await verb(cdp, "setTheme", theme);
		/*
		 * THE PANE STARTS SHUT, from the pane's OWN exit. It matters on the tree this
		 * scene is a before/after of: there the trigger unmounts with the pane, so a pass
		 * can leave the pane open with no header control to close it, and the next pass
		 * would then photograph a state it did not set up.
		 */
		if ((await verb(cdp, "state")).browserPaneOpen === true) {
			await verb(cdp, "press", {
				selector: '[data-tour-tag="browser-pane-close"]',
			});
			await wait(300);
		}
		await verb(cdp, "navigate", "/chat");

		/*
		 * A CONVERSATION HAS TO BE OPEN for the header half, and that is the backend's to
		 * provide (`session_catalogue`, the same gate `browser-pane` names). The rail half
		 * needs none of it: the rail is on every route.
		 */
		let conversation = null;
		if (BACKEND) {
			await verb(cdp, "press", {
				selector: '[data-tour-tag="chat-all-chats"]',
			});
			await verb(cdp, "press", {
				selector: '[data-tour-tag="chat-session-row"]',
			});
			const live = await verb(cdp, "state");
			conversation = live.activeSessionId ?? null;
			note("state (chat, conversation open)", JSON.stringify(live));
		} else {
			note(
				"no conversation",
				"without --backend the chat route is the app's offline surface and has no header, so the header half of this scene is not reachable (the rail half is, and is asserted below)",
			);
		}

		/*
		 * 1. THE QUIET STATE. Both surfaces must draw NOTHING: a badge reading 0 is a mark
		 * that says "nothing is being asked", and the rail in particular has to be
		 * indistinguishable from the rail before this change.
		 */
		await wait(600);
		const quiet = await readApprovalBadges(cdp);
		note("badges (nothing pending)", JSON.stringify(quiet));
		reading(
			"with nothing pending neither surface draws a badge",
			quiet.railBadge === null && quiet.headerBadge === null,
			JSON.stringify(quiet),
		);
		if (conversation !== null) {
			reading(
				"a quiet conversation's header still offers its trigger, with no count in its name",
				quiet.headerTrigger !== null &&
					quiet.headerTriggerName === "Open browser",
				JSON.stringify({
					trigger: quiet.headerTrigger,
					name: quiet.headerTriggerName,
				}),
			);
		}
		await captureSettled(cdp, `approval-badges-none-${suffix}`);

		/*
		 * 2. LIVE REQUESTS, three of them, one of each attribution. THE ORDER MATTERS: the
		 * first one raised is the oldest, and the tray and any banner click name the
		 * oldest, so the request this conversation owns is raised first.
		 */
		const livePending = [];
		/*
		 * THE ORIGINS CARRY THE THEME SUFFIX, and that is not decoration: an answer is
		 * DURABLE (a deny is "always no for this site"), so a second pass over the same
		 * three origins would be refused at admission and would photograph a state where
		 * nothing is pending. Measured on this scene's first run, which denied its way to
		 * the clear state and then asked for the same three sites again.
		 */
		const site = (name) => `https://${name}-${suffix}.example.com/`;
		if (conversation !== null) {
			const mine = await browserRpc("request_access", {
				url: site("mine"),
				requester: `session:${conversation}`,
			});
			livePending.push(mine);
		}
		const theirs = await browserRpc("request_access", {
			url: site("theirs"),
			requester: "session:other-conversation-live",
		});
		livePending.push(theirs);
		const unattributed = await browserRpc("request_access", {
			url: site("nobody"),
			requester: "call:no-session-identity",
		});
		livePending.push(unattributed);
		note(
			"request_access (this conversation's, another's, and one no conversation owns)",
			JSON.stringify(livePending.map((call) => call.result ?? call.error)),
		);
		reading(
			"three requests are live, and each carries a different kind of requester",
			livePending.every((call) => call.result?.state === "pending"),
			JSON.stringify(livePending.map((call) => call.result ?? call.error)),
		);

		const pending = await cdp.evaluate(
			"window.api.browser.state().then((state) => (state?.pendingConsent ?? []).map((entry) => ({ origin: entry.origin, requesterSessionId: entry.requesterSessionId, expiresAt: entry.expiresAt })))",
		);
		note("the projection's own pending set", JSON.stringify(pending));
		const expectedRail = pending.length;
		const expectedHeader =
			conversation === null
				? 0
				: pending.filter((entry) => entry.requesterSessionId === conversation)
						.length;

		/*
		 * 3. BOTH BADGES, with the pane CLOSED: the state every previous round measured.
		 */
		await waitForBadge(cdp, expectedRail);
		const drawn = await readApprovalBadges(cdp);
		note("badges (three pending, pane closed)", JSON.stringify(drawn));
		reading(
			"the rail counts EVERY live request, including the two no conversation on screen owns",
			Number(drawn.railBadgeText) === expectedRail,
			`rail badge ${JSON.stringify(drawn.railBadgeText)} with ${expectedRail} live in the app`,
		);
		reading(
			"the rail's badge is drawn and its name carries the number",
			drawn.railBadge !== null &&
				drawn.railName === `Browser, ${expectedRail} waiting`,
			JSON.stringify({ badge: drawn.railBadge, name: drawn.railName }),
		);
		reading(
			"the badge does not move the rail's label, and the row is still 32px",
			drawn.railButton.height === 32 &&
				(quiet.railButton === null ||
					quiet.railButton.height === drawn.railButton.height) &&
				(quiet.railLabel === null || quiet.railLabel.x === drawn.railLabel.x),
			JSON.stringify({
				rowHeight: drawn.railButton.height,
				labelX: [quiet.railLabel?.x ?? null, drawn.railLabel?.x ?? null],
			}),
		);
		if (conversation !== null) {
			reading(
				"the header counts THIS conversation's own request and not the other two",
				Number(drawn.headerBadgeText) === expectedHeader,
				`header badge ${JSON.stringify(drawn.headerBadgeText)} with ${expectedHeader} attributed to this conversation of ${expectedRail} live`,
			);
		}
		await captureSettled(cdp, `approval-badges-two-three-${suffix}`);

		/*
		 * 4. THE SAME COUNT WITH THE PANE OPEN, which is the operator's reported state:
		 * the trigger used to unmount with the pane, so the count left the header with it.
		 * The press is a real one on the real control.
		 */
		if (conversation !== null) {
			/*
			 * THE OPENING PRESS IS GUARDED ON THE PANE BEING SHUT, for the same
			 * before/after reason the closing one is: a tree where the trigger unmounts with
			 * its pane leaves the pane open at the end of the first pass, so a bare press
			 * here would throw on the second pass and end the run - which is what this
			 * scene's first before-run did, at the state it exists to photograph.
			 */
			const beforePress = await verb(cdp, "state");
			if (beforePress.browserPaneOpen === true) {
				note(
					"pane already open",
					"the previous pass left it open because its trigger had unmounted, so there is nothing to press",
				);
			} else {
				await verb(cdp, "press", {
					selector: '[data-tour-tag="browser-pane-trigger"]',
				});
			}
			const openState = await verb(cdp, "state");
			reading(
				"the pane is open",
				openState.browserPaneOpen === true,
				JSON.stringify(openState),
			);
			const withPane = await readApprovalBadges(cdp);
			note("badges (three pending, pane open)", JSON.stringify(withPane));
			reading(
				"the trigger and its badge are still on the header while the pane is open",
				withPane.headerTrigger !== null &&
					Number(withPane.headerBadgeText) === expectedHeader,
				`trigger ${JSON.stringify(withPane.headerTrigger)}, badge ${JSON.stringify(withPane.headerBadgeText)} — the state the operator reported as a missing badge`,
			);
			reading(
				"and the trigger now says it would CLOSE the pane, so it is never a control that does nothing",
				withPane.headerTriggerName ===
					(expectedHeader > 0
						? `Close browser, ${expectedHeader} waiting`
						: "Close browser"),
				JSON.stringify(withPane.headerTriggerName),
			);
			await captureSettled(cdp, `approval-badges-pane-open-${suffix}`);
			/*
			 * THE TITLE KEEPS A FRAGMENT, WHICH IS THE OTHER HALF OF THE FIX (design round 1,
			 * D1). The row is narrowest here, with the pane up, and the trigger's own stay
			 * added the fourth control to it: the title block is `flex-1 min-w-0`, so before
			 * the floor it yielded every pixel and the conversation's name left the bar
			 * entirely - a width of 0, which is what the before-frames show as absent ink.
			 * `headerTitle.width >= 40` is `min-w-10` in the header (the figure this
			 * comment quoted as 96/`min-w-24` until agent review round 2's F10 - the
			 * assertion and the code were 40 all along); the text is read as well so "it is
			 * still there" is a statement about the element and not about the number.
			 */
			reading(
				"with the pane open the title keeps its floor and stays readable",
				withPane.headerTitle !== null &&
					withPane.headerTitle.width >= 40 &&
					(withPane.headerTitleText ?? "").length > 0,
				JSON.stringify({
					titleBox: withPane.headerTitle,
					title: withPane.headerTitleText,
					truncated: withPane.headerTitleTruncated,
				}),
			);
			/*
			 * EVERY CONTROL, NOT THE CLUSTER (QA round 2, Q-1). The cluster's right edge was
			 * the wrong instrument: at 900px the row is 220 wide and its last control ended
			 * at 724 while the row ended at 720, and the row's own overflow is VISIBLE, so
			 * the pane PAINTED OVER the console's trigger rather than clipping it - a control
			 * the operator cannot see or press, reported by nothing. The width at which this
			 * runs is whatever the launch asked for, so the same three readings answer for
			 * the 1380 case, the 900 case and the 800 floor.
			 */
			reading(
				"and every control still paints inside the row, so no trigger is pushed under the pane",
				withPane.headerBox !== null &&
					withPane.headerControls.length > 0 &&
					withPane.headerControls.every(
						(control) =>
							control.box.right <= withPane.headerBox.right + 0.5 &&
							control.box.x >= withPane.headerBox.x - 0.5,
					),
				JSON.stringify({
					header: withPane.headerBox,
					overflowX: withPane.headerOverflowX,
					outside: withPane.headerControls
						.filter(
							(control) =>
								control.box.right > withPane.headerBox.right + 0.5 ||
								control.box.x < withPane.headerBox.x - 0.5,
						)
						.map((control) => ({
							tag: control.tag,
							label: control.label,
							box: control.box,
						})),
					controls: withPane.headerControls.map((control) => ({
						tag: control.tag,
						right: control.box.right,
					})),
				}),
			);
			/*
			 * AND BACK. Pressing it again must CLOSE the pane rather than be a no-op - which
			 * is the half of "it stays mounted" that a still cannot show.
			 *
			 * GUARDED ON THE TRIGGER EXISTING, and that guard is the whole before/after of
			 * this scene: on the tree WITHOUT the fix the trigger has unmounted with the pane,
			 * so a bare `press` here would throw "nothing matches" and end the run - taking
			 * the collapsed frames and every check after it with it. A scene that can only
			 * reach its own claims on the fixed tree cannot show the defect it is for.
			 */
			if (withPane.headerTrigger === null) {
				note(
					"no second press",
					"the trigger is not on the page while the pane is open, so there is nothing to press - the state this scene exists to catch",
				);
			} else {
				await verb(cdp, "press", {
					selector: '[data-tour-tag="browser-pane-trigger"]',
				});
				const closedAgain = await verb(cdp, "state");
				reading(
					"pressing the same control again closes the pane",
					closedAgain.browserPaneOpen === false,
					JSON.stringify(closedAgain),
				);
			}
		}

		/*
		 * 5. COLLAPSED. The rail's own geometry is the risky half: a 16px badge cannot sit
		 * outside a 48px rail, and the offset has to clear the 16px glyph inside a 32px
		 * button. The numbers are the claim; the frame is the picture of it.
		 */
		await verb(cdp, "press", { selector: '[aria-label="Collapse sidebar"]' });
		await wait(400);
		const collapsed = await readApprovalBadges(cdp);
		note("badges (three pending, rail collapsed)", JSON.stringify(collapsed));
		reading(
			"the collapsed rail is 48px and the badge stays inside it",
			collapsed.railWidth === 48 &&
				collapsed.railBadge !== null &&
				collapsed.railBadge.right <= 48 &&
				collapsed.railBadge.x >= 0,
			JSON.stringify({ rail: collapsed.railWidth, badge: collapsed.railBadge }),
		);
		reading(
			"the collapsed badge keeps its count in the control's name, because the digit is not the only channel",
			collapsed.railName === `Browser, ${expectedRail} waiting`,
			JSON.stringify(collapsed.railName),
		);
		reading(
			"the collapsed row is still a 32px square inside the 48px rail",
			collapsed.railButton.height === 32 &&
				collapsed.railButton.x >= 0 &&
				collapsed.railButton.right <= 48,
			JSON.stringify(collapsed.railButton),
		);
		/*
		 * CLEARANCE FROM THE RAIL'S OWN EDGE, which is what design round 1's D2 measured as
		 * ~0.25px (antialiasing only): the badge's right edge and the rail's 1px border read
		 * as one thick edge, and the mark looked cut by the panel. The offset is `-right-1.5`
		 * now, so the badge's right edge must sit at least 2px inside the rail's outer edge -
		 * one border pixel plus a pixel of clearance - while the glyph it overlaps does not
		 * move.
		 */
		reading(
			"the collapsed badge clears the rail's own edge instead of merging with it",
			collapsed.railEdge !== null &&
				collapsed.railBadge !== null &&
				collapsed.railEdge - collapsed.railBadge.right >= 2,
			JSON.stringify({
				railEdge: collapsed.railEdge,
				badgeRight: collapsed.railBadge?.right ?? null,
				clearance:
					collapsed.railEdge !== null && collapsed.railBadge !== null
						? collapsed.railEdge - collapsed.railBadge.right
						: null,
			}),
		);
		await captureSettled(cdp, `approval-badges-collapsed-${suffix}`);

		/*
		 * AND WITH ITS TOOLTIP OPEN, which is the state design round 1 named as inferred
		 * rather than seen: the badge's right edge and a `side="right"` tooltip's leading
		 * edge both land at the rail's boundary on paper, so the question is whether the
		 * mark ends up UNDER the tooltip. The driver has no pointer verb (it refuses to move
		 * the pointer), and it does not need one: the tooltip's own trigger is a button, and
		 * a real `focus()` opens a Radix tooltip the same way a hover does.
		 */
		await cdp.evaluate(`(() => {
			const row = document.querySelector('[data-tour-tag="nav-item-browser"]');
			if (!row) return null;
			row.focus();
			/*
			 * A real focus() sets document.activeElement, but React listens for the
			 * bubbling focusin event a browser dispatches alongside it - and a
			 * programmatic focus in a window that was never focused does not always
			 * produce one. Dispatching it explicitly is what makes the tooltip's own
			 * trigger hear the focus the way a keyboard user's Tab would.
			 */
			row.dispatchEvent(
				new FocusEvent("focusin", { bubbles: true, composed: true }),
			);
			return document.activeElement === row;
		})()`);
		// Radix opens a tooltip after its own delay (700ms by default), so the wait is
		// longer than a settle: a shorter one photographs a closed tooltip and calls it
		// "the state cannot be reached".
		await wait(1200);
		const tipped = await readApprovalBadges(cdp);
		note("badges (rail collapsed, tooltip open)", JSON.stringify(tipped));
		reading(
			"the tooltip opens on focus, so the state can be photographed rather than inferred",
			tipped.tooltip !== null,
			JSON.stringify({ tooltip: tipped.tooltip, text: tipped.tooltipText }),
		);
		await captureSettled(cdp, `approval-badges-collapsed-tooltip-${suffix}`);

		// Put the rail back, so a second theme starts where the first one did.
		await verb(cdp, "press", { selector: '[aria-label="Expand sidebar"]' });
		await wait(300);
		reading(
			"the rail expands again for the next state",
			(await readApprovalBadges(cdp)).railWidth === 220,
			`rail width ${(await readApprovalBadges(cdp)).railWidth}`,
		);

		/*
		 * 5b. TWO DIGITS. The queue's own cap is 16 and the operator asked for a count, so a
		 * count past nine is a state this feature reaches - and the collapsed rail is the
		 * one host with no room for it: the pill is right-anchored and grows LEFTWARD into
		 * the Globe's arc (design round 1, D3: at two digits it covers ~4.5px of the 14.5px
		 * glyph at the offset the one-digit case needed). The answer is the grammar the chat
		 * header already keeps - `9+` where the mark cannot grow - while the exact number
		 * stays in the control's accessible name, so nothing is lost, only shortened.
		 *
		 * TEN MORE, so the live count is past the cap on both rails, and every one of them is
		 * answered by the step below like the rest.
		 */
		for (let extra = 0; extra < 10; extra += 1) {
			await browserRpc("request_access", {
				url: site(`many-${extra}`),
				requester: "session:other-conversation-live",
			});
		}
		const crowded = await waitForBadge(cdp, expectedRail + 10);
		note("badges (thirteen pending, rail expanded)", JSON.stringify(crowded));
		reading(
			"the expanded rail shows the true number, because the row has the width for it",
			Number(crowded.railBadgeText) === expectedRail + 10,
			JSON.stringify({ badge: crowded.railBadgeText }),
		);
		await verb(cdp, "press", { selector: '[aria-label="Collapse sidebar"]' });
		await wait(400);
		const crowdedCollapsed = await readApprovalBadges(cdp);
		note(
			"badges (thirteen pending, rail collapsed)",
			JSON.stringify(crowdedCollapsed),
		);
		reading(
			"the collapsed rail still shows the true number rather than a cap",
			crowdedCollapsed.railBadgeText === String(expectedRail + 10),
			JSON.stringify({ badge: crowdedCollapsed.railBadgeText }),
		);
		/*
		 * AND THE MARK DOES NOT REACH BACK OVER THE GLYPH, which is the claim the cap
		 * used to be asked to make and cannot: `9+` and `13` are the same two
		 * characters, so the width a cap saves is nil for every count this queue can
		 * hold. What saves it is the VERTICAL offset: the badge's bottom edge must land
		 * at or above the glyph's top edge, which at `-top-2` it does.
		 */
		/*
		 * WHAT THE TWO-DIGIT MARK DOES TO THE ICON, stated as measurements rather than
		 * as a promise it cannot keep. At two characters the pill is ~25px wide and its
		 * left edge reaches back over the icon's crown, exactly as the chat header's
		 * badge crosses its own trigger's glyph - so the claim here is the reason the
		 * collapse is safe there: the badge carries a `ring-2`, and the ring's 2px of
		 * outward paint must stay inside the rail's own 1px border. The badge's box is
		 * allowed to kiss the glyph; the rail's edge is not allowed to eat the mark.
		 */
		reading(
			"the two-digit mark and its ring stay inside the rail's edge",
			crowdedCollapsed.railBadge !== null &&
				crowdedCollapsed.railEdge !== null &&
				crowdedCollapsed.railBadge.right + 2 <= crowdedCollapsed.railEdge - 1,
			JSON.stringify({
				badge: crowdedCollapsed.railBadge,
				railEdge: crowdedCollapsed.railEdge,
				ringClearance:
					crowdedCollapsed.railBadge !== null &&
					crowdedCollapsed.railEdge !== null
						? crowdedCollapsed.railEdge - (crowdedCollapsed.railBadge.right + 2)
						: null,
			}),
		);
		reading(
			"and the two-digit mark crosses the icon by no more than the ring it carries",
			crowdedCollapsed.railBadge !== null &&
				crowdedCollapsed.railIcon !== null &&
				crowdedCollapsed.railBadge.y + crowdedCollapsed.railBadge.height <=
					crowdedCollapsed.railIcon.y + 2,
			JSON.stringify({
				badge: crowdedCollapsed.railBadge,
				glyph: crowdedCollapsed.railIcon,
			}),
		);
		reading(
			"and the capped mark still clears the rail's edge",
			crowdedCollapsed.railEdge !== null &&
				crowdedCollapsed.railBadge !== null &&
				crowdedCollapsed.railEdge - crowdedCollapsed.railBadge.right >= 2,
			JSON.stringify({
				railEdge: crowdedCollapsed.railEdge,
				badgeRight: crowdedCollapsed.railBadge?.right ?? null,
			}),
		);
		reading(
			"with the number in the control's name, which is never capped",
			crowdedCollapsed.railName === `Browser, ${expectedRail + 10} waiting`,
			JSON.stringify(crowdedCollapsed.railName),
		);
		await captureSettled(cdp, `approval-badges-collapsed-two-digits-${suffix}`);
		await verb(cdp, "press", { selector: '[aria-label="Expand sidebar"]' });
		await wait(300);

		/*
		 * 5c. THE CURRENT ROW, which is the ground the operator's own report came from: the
		 * rail's Browser item is `row-selected` while `/browser` is the route, and that is
		 * one of the two grounds the contrast contract asserted nothing about until this
		 * round (design round 1's D5 and the code review's F2, which measured the badge's
		 * edge role at 2.77:1 on it against this file's 3:1 floor, in twelve of fifty-nine
		 * palettes). The frame is the picture; `check-themes` is the measurement.
		 */
		await verb(cdp, "navigate", "/browser");
		await wait(600);
		const currentRow = await readApprovalBadges(cdp);
		note(
			"badges (browser route current, thirteen pending)",
			JSON.stringify(currentRow),
		);
		reading(
			"the rail's own row carries the badge while it is the current destination",
			currentRow.railCurrent === true && currentRow.railBadge !== null,
			JSON.stringify({
				current: currentRow.railCurrent,
				badge: currentRow.railBadgeText,
				box: currentRow.railBadge,
			}),
		);
		await captureSettled(cdp, `approval-badges-rail-current-${suffix}`);
		await verb(cdp, "navigate", "/chat");
		await wait(400);

		/*
		 * 6. ANSWERED. The last thing a badge has to do is LEAVE: an approval that has been
		 * answered is not a demand, and the count that ignores that is the one the design's
		 * §1.2 exists to prevent. Every request this run raised is answered through the
		 * app's own chrome, so the surfaces are driven rather than the store poked.
		 */
		if (conversation !== null) {
			const answered = await cdp.evaluate(
				"window.api.browser.state().then(async (state) => { for (const entry of state?.pendingConsent ?? []) { await window.api.browser.respondToConsent(entry.entryId, 'deny'); } return (await window.api.browser.state())?.pendingConsent?.length; })",
			);
			note("pending after denying every request", JSON.stringify(answered));
			await waitForBadge(cdp, 0);
			const cleared = await readApprovalBadges(cdp);
			note("badges (all answered)", JSON.stringify(cleared));
			reading(
				"every answer removes its number from both surfaces",
				cleared.railBadge === null && cleared.headerBadge === null,
				JSON.stringify(cleared),
			);
			await captureSettled(cdp, `approval-badges-cleared-${suffix}`);
		}
	}
}

/**
 * ONE READING OF BOTH BADGES AND THE BOXES THAT DECIDE WHETHER THEY FIT.
 *
 * `null` for a badge that is not drawn, because "no badge" and "a badge reading zero"
 * are different pictures and the scene asserts about the difference. The rail's label
 * and icon are read alongside the badge so "the badge did not move the label" is a
 * measurement rather than a promise.
 */
function readApprovalBadges(cdp) {
	return cdp.evaluate(`(() => {
		const box = (el) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return {
				x: Math.round(r.x),
				y: Math.round(r.y),
				width: Math.round(r.width),
				height: Math.round(r.height),
				right: Math.round(r.right),
			};
		};
		const railButton = document.querySelector('[data-tour-tag="nav-item-browser"]');
		const rail = railButton ? railButton.closest('nav') : null;
		const railBadge = railButton
			? railButton.querySelector('[data-tour-tag="nav-browser-badge"]')
			: null;
		const trigger = document.querySelector('[data-tour-tag="browser-pane-trigger"]');
		const headerBadge = trigger
			? trigger.querySelector('[data-tour-tag="browser-pane-badge"]')
			: null;
		const header = document.querySelector('[data-tour-tag="chat-header"]');
		/*
		 * THE TITLE, as a BOX rather than a string: the pane-open arrangement's defect
		 * was a title with no width at all (a flex item of flex-1 min-w-0 yields
		 * everything), and a box of zero is what the frame shows as absent ink.
		 * "truncated" is read from the element itself (scrollWidth > clientWidth) so "it
		 * kept a fragment" is not a claim about the text.
		 */
		const title = header ? header.querySelector('h2') : null;
		const cluster = header ? header.lastElementChild : null;
		const canvasButton = header
			? header.querySelector('[data-tour-tag="open-canvas-button"]')
			: null;
		return {
			railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : null,
			railEdge: rail ? Math.round(rail.getBoundingClientRect().right) : null,
			railButton: box(railButton),
			railIcon: box(railButton ? railButton.querySelector('svg') : null),
			railLabel: box(
				railButton
					? railButton.querySelector(':scope > span:not([aria-hidden="true"])')
					: null,
			),
			railBadge: box(railBadge),
			railBadgeText: railBadge ? railBadge.textContent.trim() : null,
			railName: railButton ? railButton.getAttribute('aria-label') : null,
			railCurrent: railButton
				? railButton.getAttribute('aria-current') !== null
				: null,
			headerBox: box(header),
			headerTrigger: box(trigger),
			headerGlyph: box(trigger ? trigger.querySelector('svg') : null),
			headerBadge: box(headerBadge),
			headerBadgeText: headerBadge ? headerBadge.textContent.trim() : null,
			headerTriggerName: trigger ? trigger.getAttribute('aria-label') : null,
			headerClusterRight: box(cluster) ? box(cluster).right : null,
			/*
			 * EVERY CONTROL IN THE ROW, with the box it paints, so a narrow window can say
			 * WHICH one left the header rather than only that the cluster did (QA round 2,
			 * Q-1). The row's computed overflow-x is read too: VISIBLE is what lets a
			 * control paint under the pane instead of being clipped.
			 */
			headerOverflowX: header ? getComputedStyle(header).overflowX : null,
			headerControls: header
				? [...header.querySelectorAll(":scope > *")]
						.flatMap((child) => [child, ...child.querySelectorAll("button")])
						.map((el) => ({
							tag: el.getAttribute("data-tour-tag"),
							label: el.getAttribute("aria-label"),
							box: box(el),
						}))
						/*
						 * A CONTROL THAT IS NOT DRAWN HAS NO BOX (0x0 at the origin, which
						 * is outside the row by construction), and this reading is about the
						 * controls the row DOES draw: the shed cascade's whole job is to
						 * leave nothing visible outside the header, so the hidden half is
						 * filtered rather than compared.
						 */
						.filter((entry) => entry.box !== null && entry.box.width > 0)
				: [],
			headerTitle: box(title),
			headerTitleText: title ? title.textContent.trim() : null,
			headerTitleTruncated: title ? title.scrollWidth > title.clientWidth : null,
			canvasButtonShown:
				canvasButton !== null &&
				canvasButton.getBoundingClientRect().width > 0,
			tooltip: box(document.querySelector('[role="tooltip"]')),
			tooltipText: (() => {
				const tip = document.querySelector('[role="tooltip"]');
				return tip ? tip.textContent.trim() : null;
			})(),
		};
	})()`);
}

/** Wait until the rail's badge reads `expected`, or give up and say what it read.
 * The projection arrives over IPC, so "the request was raised" and "the badge is
 * drawn" are different moments and a scene that raced them would report a missing
 * badge for a surface that simply had not been told yet. */
async function waitForBadge(cdp, expected, timeoutMs = 10_000) {
	const started = Date.now();
	let reading = null;
	for (;;) {
		reading = await readApprovalBadges(cdp);
		const drawn =
			reading.railBadgeText === null ? 0 : Number(reading.railBadgeText);
		if (drawn === expected) return reading;
		if (Date.now() - started > timeoutMs) return reading;
		await wait(150);
	}
}

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
		 * WHERE THE CARET ENDS UP, AND WHY IT NO LONGER GOES TO `<body>` (agent review
		 * round 1, F3, which caught this step asserting the opposite of the head). The
		 * trigger is given real DOM focus and the pane is opened from that state. Until
		 * 2026-09-23 the control that held focus UNMOUNTED under the press - the
		 * header's Globe was gated on the pane being closed, which is the gate the
		 * operator's own report was about - so the caret fell to `<body>` and that is
		 * what this asserted. The trigger now STAYS MOUNTED as a toggle, and the press
		 * cannot move the caret either: this verb dispatches UNTRUSTED pointer and mouse
		 * events, and a browser runs no focus default for those. So the caret stays on
		 * the control - the better state, and the one the step asserts now.
		 *
		 * The activation is a programmatic click on the FOCUSED trigger rather than a
		 * synthesised Enter, and the reason is measured: an Enter chord dispatched without
		 * its character does not produce Chromium's default activation for the button over
		 * this CDP path, so the pane never opened and the step reported the state it was in
		 * rather than the state it meant. THE CAUSE IS THE MISSING CHARACTER PHASE rather
		 * than the protocol: `Input.dispatchKeyEvent` carries a key's character in `text`,
		 * and the default activation arrives on it - `pressChord`'s `keyText` sends it now,
		 * and the `row-space` scene's keyboard-unpin walk is the check that asserts it (its
		 * delivery precondition reads the pin's own keydown and click). This step stays a
		 * click because focus is the half that matters here, and a programmatic click does
		 * not move it - the assertion below checks the caret really was lost, so this is not
		 * an assumption.
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
				tour: active ? active.getAttribute("data-tour-tag") : null,
			};
		})()`);
		note("opened from a focused trigger", JSON.stringify(openedByFocus));
		check(
			"toggling the pane from its own focused control keeps the caret on that control rather than dropping it on the document",
			openedByFocus.paneOpen === true &&
				openedByFocus.tag === "BUTTON" &&
				openedByFocus.tour === "browser-pane-trigger",
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

/**
 * `--scene radient-issue`: the session issue, and the one action that clears it.
 *
 * REQUIRES `--backend`, and it is not a convenience. This surface is gated on a
 * capability the backend advertises (`tunnel`) and speaks a verdict only the
 * backend can give (`GET /v1/auth/status`'s `radient_login`), so a run with no
 * backend photographs the absence of the feature - which is why the scene
 * refuses rather than capturing an app that could not have shown it either way.
 *
 * TWO RUNS, TWO CLAIMS, the shape `browser-pane` and `new-chat` use:
 *
 * - BACKEND SAYS THE LOGIN IS DEAD: the callout is raised with its one action;
 *   pressing it moves the band to the in-flight state (the connector restarts on
 *   its own once the sign-in completes, with the Cancel that releases the one
 *   loopback port the flow holds); and once the flow settles and the verdict is
 *   re-read the callout clears.
 * - BACKEND SAYS THE LOGIN IS FINE: nothing is raised at all, which is as much
 *   a claim as the callout is - a nag on a working login is the same class of
 *   lie, told in the other direction, as the silent-health bug this surface
 *   exists to remove.
 *
 * The scene WAITS on the product rather than driving it, and fails naming what
 * it saw. Completing the sign-in is the RIG's job, not this harness's: the app
 * is the initiator of a Radient sign-in and never the callback receiver (the
 * loopback callback is on the harness host), so a run that presses the action
 * needs a backend whose owner finishes the browser leg - see the PR's
 * walkthrough for the two rig commands.
 */
async function sceneRadientIssue(cdp) {
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
		"the window is never shown",
		facts.visible === false,
		`visible=${facts.visible} focused=${facts.focused} minimized=${facts.minimized}`,
	);

	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", "localOperatorDark");
	/*
	 * OPEN A DRAFT FIRST, and this is not incidental. With no conversation
	 * selected the chat route renders the "Start a chat" screen, which has no
	 * composer at all - measured against this run's own backend, where the
	 * capture was that screen and the callout could not have been anywhere,
	 * because there is no band to put it in. The sidebar's New chat row stages
	 * the untargeted draft, and it is pressed AT THE BOX IT PAINTS, the way a
	 * user presses it.
	 */
	/*
	 * THE COMPOSER IS A HARD PRECONDITION, and the press is RETRIED until it
	 * exists. Two failures taught this shape.
	 *
	 * The row carries `disabled` until the catalogue answers, and a press
	 * dispatched at a disabled button is accepted by the pointer path and does
	 * nothing - so an early cut of this scene captured the "Start a chat" screen
	 * with the band the frames are about never mounted.
	 *
	 * And a single press is not enough even when the row is enabled: on a loaded
	 * host the draft took longer than the wait that followed it, and the run then
	 * reported "a login the backend still accepts raises nothing" as a PASS over a
	 * screen that has no composer at all. That is a FALSE pass - there was no
	 * callout to find because there was no band to carry one - which is why this
	 * scene now refuses to read the absence of the issue until the band is
	 * actually on screen.
	 */
	const bandSelector = 'document.querySelector("[data-lo-composer-band]")';
	const newChatRow = `Array.from(document.querySelectorAll("button[data-chat-row]")).find(
		(button) =>
			!button.disabled &&
			button.textContent.replace(/\\s+/g, " ").trim().startsWith("New chat"),
	)`;
	let bandPresent = false;
	for (let attempt = 1; attempt <= 3 && !bandPresent; attempt++) {
		await waitForScene(cdp, `Boolean(${newChatRow})`);
		const row = await cdp.evaluate(`(() => {
			const found = ${newChatRow};
			if (!found) return null;
			const box = found.getBoundingClientRect();
			return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		})()`);
		if (!row) break;
		if (attempt === 1) {
			check(
				"the sidebar's New chat row is on screen",
				true,
				JSON.stringify(row),
			);
		}
		await pressPointer(cdp, row.x, row.y);
		// The draft is staged by the app's own store, so what is waited on is the
		// band the composer renders into - the product's answer, not a timeout.
		bandPresent = await waitForScene(cdp, `Boolean(${bandSelector})`, 200);
	}
	check(
		"the composer band is on screen (the precondition for every reading below)",
		bandPresent,
		`${bandPresent} after retrying the draft press`,
	);
	if (!bandPresent) {
		/*
		 * STOP rather than continue. Every assertion below is about a callout
		 * INSIDE this band, so on a screen without one "the issue is absent" is not
		 * evidence about the issue - it is evidence that the scene never reached the
		 * state it is about.
		 */
		note(
			"the scene stopped before the issue readings",
			"no composer band, so an absent callout would prove nothing",
		);
		return;
	}

	const raised = await readUntil(
		() => readRadientIssue(cdp),
		(reading) => reading.present,
		30_000,
	);
	note("issue at first paint", JSON.stringify(raised));

	if (!raised.present) {
		check(
			"a login the backend still accepts raises nothing (no false nag)",
			raised.kind === null,
			JSON.stringify(raised),
		);
		const frame = await captureSettled(cdp, "issue-absent");
		note("frame", JSON.stringify(frame));
		return;
	}

	check(
		"the backend's verdict raised the session issue",
		raised.kind === "needs-sign-in",
		JSON.stringify(raised),
	);
	check(
		"the issue carries exactly one action",
		raised.buttons.length === 1 && raised.buttons[0] === "Sign in to Radient",
		JSON.stringify(raised.buttons),
	);
	const raisedFrame = await captureSettled(cdp, "issue-raised");
	note("frame", JSON.stringify(raisedFrame));

	const press = await verb(cdp, "press", {
		selector: "[data-lo-radient-issue] button",
	});
	note("press", JSON.stringify(press));
	check(
		"the action was hit-tested where it is painted",
		press.hitTest === true,
		JSON.stringify({ hitTest: press.hitTest, hit: press.hit }),
	);

	const signingIn = await readUntil(
		() => readRadientIssue(cdp),
		(reading) => reading.kind === "signing-in" || reading.kind === "settled",
		30_000,
	);
	check(
		"pressing the action moves the issue to the sign-in in flight",
		signingIn.kind === "signing-in",
		JSON.stringify(signingIn),
	);
	check(
		"the in-flight state says what the connector does next, and offers the cancel",
		/connector restarts on its own once the sign-in completes/.test(
			signingIn.text,
		) && signingIn.buttons.includes("Cancel"),
		JSON.stringify(signingIn),
	);
	const signingFrame = await captureSettled(cdp, "issue-signing-in");
	note("frame", JSON.stringify(signingFrame));

	/*
	 * The clear is the whole point of the surface: the credential lands, the
	 * verdict is re-read, and the issue goes away on its own. Bounded and
	 * reported, because a callout that stays up after a successful sign-in is
	 * the failure this scene exists to catch.
	 */
	const cleared = await readUntil(
		() => readRadientIssue(cdp),
		(reading) => !reading.present,
		120_000,
	);
	check(
		"the issue clears once the sign-in settles and the verdict is re-read",
		cleared.present === false,
		JSON.stringify(cleared),
	);
	const clearedFrame = await captureSettled(cdp, "issue-cleared");
	note("frame", JSON.stringify(clearedFrame));

	for (const pair of [
		["issue-raised", raisedFrame, "issue-signing-in", signingFrame],
		["issue-signing-in", signingFrame, "issue-cleared", clearedFrame],
	]) {
		check(
			`${pair[0]} and ${pair[2]} are the same screen at the same size`,
			pair[1].viewport.width === pair[3].viewport.width &&
				pair[1].viewport.height === pair[3].viewport.height &&
				pair[1].route === pair[3].route,
			`${pair[1].route} ${JSON.stringify(pair[1].viewport)} vs ${pair[3].route} ${JSON.stringify(pair[3].viewport)}`,
		);
	}
}

/**
 * What the composer band says about the Radient sign-in right now.
 *
 * Read from the kind ATTRIBUTE rather than from the copy: the sentence is not a
 * contract a scene should key on, and the attribute is the same one the
 * component documents for exactly this.
 */
function readRadientIssue(cdp) {
	return cdp.evaluate(`(() => {
		const issue = document.querySelector("[data-lo-radient-issue]");
		if (!issue) return { present: false, kind: null, text: "", buttons: [] };
		return {
			present: true,
			kind: issue.getAttribute("data-lo-radient-issue"),
			text: issue.textContent.replace(/\\s+/g, " ").trim(),
			buttons: Array.from(issue.querySelectorAll("button")).map((button) =>
				button.textContent.trim(),
			),
		};
	})()`);
}

/**
 * `authoring-refresh`: a write the app did not make, and whether the sidebar's
 * Agents/Teams lists notice it with nobody touching the window.
 *
 * WHY THIS SCENE IS A LIVE ONE AND NOT A FRAME. The defect it exists for cannot
 * happen without a second writer: an AGENT creates a team or a profile on the
 * backend, with no click in this window, no navigation and no focus change, so
 * nothing in the renderer has a reason to re-read `profiles.list`/`teams.list`
 * and the row stays off screen until the operator reloads or switches tab. A
 * story can render those lists; it cannot make a write arrive from outside, and
 * it certainly cannot show that the arrival is what refreshed them. Every write
 * below is an HTTP request from THIS script's own Node process - never through
 * `window.api` and never through a press - which is the whole property under
 * test: the app's only possible source for it is the machine-wide feed.
 *
 * THE TWO RUNS, and why the second one is the evidence. `--authoring-expect
 * refresh` (the default) is the fixed behaviour against a backend that
 * publishes the `authoring` frame. `--authoring-expect stale` is the SAME app,
 * same script, same write, against a backend that publishes no such frame (the
 * base-commit runtime): the row must NOT appear, the list must NOT be re-read,
 * and the tab switch the operator complained about having to make must be what
 * brings it in. That pair is what makes the reading causal rather than a
 * coincidence - a run that only ever shows the row appearing cannot tell a
 * frame-driven refresh from a mount, a poll or a stray re-render.
 *
 * The measurement is the CACHE's, not the pixels': `queryFetches` is the app's
 * own patched `Query.prototype.fetch`, so a re-read is attributed to a real call
 * site with a timestamp, and `queries` carries the key's `dataUpdatedAt`. The
 * frames are the other half - the row on screen, in the section it belongs to -
 * and the reading is what says whether the clock or the frame put it there.
 *
 * WHAT IT NEEDS: `--backend <url>` pointing at a daemon this run owns (both
 * runs need the app to be able to READ the lists at all), the renderer built
 * against the same URL, `LOCAL_OPERATOR_DESKTOP_TOKEN` in this script's
 * environment for this script's own writes, and - for the `refresh` half - a
 * backend whose feed publishes `authoring` frames.
 */
async function sceneAuthoringRefresh(cdp) {
	const stale = AUTHORING_EXPECT === "stale";
	const label = stale ? "no-frame" : "frame";
	const suffix = `${process.pid}-${Date.now().toString(36)}`;
	// Unique per run: the assertions are about a row that did not exist before
	// this run, and a name left over from an earlier run on the same backend
	// would make the "before" frame already carry it.
	const teamName = `rig-team-${suffix}`;
	const agentName = `rig-agent-${suffix}`;
	const TEAMS_KEY = '"desktop","teams"';
	const PROFILES_KEY = '"desktop","profiles"';
	/*
	 * The sidebar's own controls rather than a class name: the section is open
	 * (its default) only while the backend advertises the capability, and the
	 * control that creates one is rendered in both the empty and the populated
	 * state - so it is the stable anchor for "this list is on screen".
	 */
	const createControl = (text) =>
		`Array.from(document.querySelectorAll("button")).some((button) => button.textContent.trim() === ${JSON.stringify(text)})`;
	const rowNamed = (name) =>
		`Array.from(document.querySelectorAll("[data-entity]")).some((node) => node.textContent.includes(${JSON.stringify(name)}))`;
	const rowNames = `Array.from(document.querySelectorAll("[data-entity]")).map((node) => node.textContent.replace(/\\s+/g, " ").trim())`;

	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", "localOperatorDark");
	const state = await verb(cdp, "state");
	check(
		"the run starts on the chat route, with the first-run wizard out of the way",
		state.route === "/chat" && state.onboardingVisible === false,
		`route ${state.route}, onboardingVisible ${state.onboardingVisible}`,
	);

	/*
	 * Armed BEFORE the lists are first read, because the reads this instrument
	 * exists to attribute begin at the mount. The verb validates itself with a
	 * fetch of its own key; without that, a trap that never patched anything
	 * would print a clean "0 fetches" and read as a list that needed none.
	 */
	const armed = await verb(cdp, "queryFetches", { arm: true });
	note("query-fetch trap armed", JSON.stringify(armed));
	check(
		"the fetch trap armed and validated itself",
		armed.armed === true && armed.validated === true,
		JSON.stringify(armed),
	);

	const sidebar = await waitForCondition(
		cdp,
		`${createControl("Create agent")} && ${createControl("Create team")}`,
		30_000,
	);
	check(
		"both authoring sections are open in the sidebar",
		sidebar.ok === true,
		`waited ${sidebar.waitedMs}ms; Create agent / Create team controls not both present`,
		`present after ${sidebar.waitedMs}ms`,
	);
	// The mount's own reads have to be over before the baseline is taken, or the
	// baseline and the frame's refetch would be counted as one event.
	await wait(1500);
	const before = {
		teams: await verb(cdp, "queryFetches", { key: TEAMS_KEY }),
		profiles: await verb(cdp, "queryFetches", { key: PROFILES_KEY }),
		queries: await readAuthoringQueries(cdp),
	};
	note(
		"the two lists as the cache holds them, before the write",
		JSON.stringify(before.queries),
	);
	note(
		"fetches before the write",
		`teams ${before.teams.total} from ${before.teams.callers.length} call site(s), profiles ${before.profiles.total} from ${before.profiles.callers.length}`,
	);
	/*
	 * The rows are brought into view before the first frame so the pair is the
	 * same region of the same section: a capture scrolled by the arrival of the
	 * row would show two different parts of the sidebar and prove nothing about
	 * either. The anchor is the section's own create control, which sits under
	 * the rows in both frames.
	 */
	await cdp.evaluate(
		`(() => { const control = Array.from(document.querySelectorAll("button")).find((button) => button.textContent.trim() === "Create team"); control.scrollIntoView({ block: "center" }); return true; })()`,
	);
	await wait(250);
	const beforeFrame = await captureSettled(cdp, `authoring-before-${label}`);
	const namesBefore = await cdp.evaluate(rowNames);
	note(
		"authoring rows on screen before the write",
		JSON.stringify(namesBefore),
	);
	check(
		"neither name this run will write is on screen before it is written",
		!(
			Array.isArray(namesBefore) ? namesBefore.join(" | ") : String(namesBefore)
		).includes(teamName) &&
			!(
				Array.isArray(namesBefore)
					? namesBefore.join(" | ")
					: String(namesBefore)
			).includes(agentName),
		`rows: ${JSON.stringify(namesBefore)}`,
	);

	/*
	 * THE WRITE, from this script's Node process: two real HTTP requests to the
	 * backend's own authoring routes, with the bearer the run is paired with.
	 * Nothing about the app is touched - no verb, no press, no navigation - until
	 * the frames below are taken, which is what makes the arrival the only
	 * variable.
	 */
	const wroteAt = Date.now();
	const wrote = [
		await authoringWrite("/v1/desktop/profiles", {
			request_id: randomUUID(),
			name: agentName,
			kind: "role",
			description: "Written by the renderer-driver's authoring-refresh scene.",
			instructions: "Say nothing; this profile exists to be listed.",
		}),
		await authoringWrite("/v1/desktop/teams", {
			request_id: randomUUID(),
			name: teamName,
			description: "Written by the renderer-driver's authoring-refresh scene.",
		}),
	];
	note("wrote both rows from this process", JSON.stringify(wrote));
	check(
		"the backend accepted both writes",
		wrote.every((entry) => entry.status === 200),
		JSON.stringify(wrote),
	);

	/*
	 * How long the row takes to appear, measured from the write rather than from
	 * a fixed sleep: a backend whose authoring probe runs on its own cadence
	 * cannot show the row instantly, and a scene that assumed it could would
	 * flake. `stale` gets the shorter budget on purpose - its claim is that
	 * nothing arrives, and a longer window would only make the same reading
	 * slower.
	 */
	const appeared = await waitForCondition(
		cdp,
		rowNamed(teamName),
		stale ? 8_000 : 20_000,
	);
	const appearedAgent = await waitForCondition(
		cdp,
		rowNamed(agentName),
		stale ? 8_000 : 20_000,
	);
	const after = {
		teams: await verb(cdp, "queryFetches", { key: TEAMS_KEY }),
		profiles: await verb(cdp, "queryFetches", { key: PROFILES_KEY }),
		queries: await readAuthoringQueries(cdp),
	};
	const route = await verb(cdp, "state");
	note(
		"the two lists as the cache holds them, after the write",
		JSON.stringify(after.queries),
	);
	note(
		"fetches after the write",
		`teams ${before.teams.total} -> ${after.teams.total}, profiles ${before.profiles.total} -> ${after.profiles.total}`,
	);
	const refetched = (key) =>
		after[key].total > before[key].total &&
		after[key].callers.some((caller) => caller.lastAt >= wroteAt);
	const afterFrame = await captureSettled(cdp, `authoring-after-${label}`);

	if (stale) {
		/*
		 * The two halves of the defect, measured rather than asserted in prose:
		 * the list did not move on its own, and it moved the moment the app was
		 * remounted - which is the tab switch the operator had to make.
		 */
		check(
			"with no authoring frame the row does NOT appear",
			appeared.ok === false && appearedAgent.ok === false,
			`the team row appeared after ${appeared.waitedMs}ms and the agent row after ${appearedAgent.waitedMs}ms`,
			`nothing after ${appeared.waitedMs}ms / ${appearedAgent.waitedMs}ms, and the app was never touched`,
		);
		check(
			"with no authoring frame the lists are not re-read",
			!refetched("teams") && !refetched("profiles"),
			`teams ${before.teams.total} -> ${after.teams.total}, profiles ${before.profiles.total} -> ${after.profiles.total}, write at ${wroteAt}`,
			`no fetch for either key since the write, while the app sat on ${route.route}`,
		);
		await verb(cdp, "navigate", "/agent-hub");
		await verb(cdp, "navigate", "/chat");
		const switched = await waitForCondition(cdp, rowNamed(teamName), 20_000);
		const switchedAgent = await waitForCondition(
			cdp,
			rowNamed(agentName),
			20_000,
		);
		await cdp.evaluate(
			`(() => { const control = Array.from(document.querySelectorAll("button")).find((button) => button.textContent.trim() === "Create team"); control.scrollIntoView({ block: "center" }); return true; })()`,
		);
		await wait(250);
		const switchedFrame = await captureSettled(
			cdp,
			`authoring-after-tab-switch-${label}`,
		);
		check(
			"a tab switch - the remedy the operator used - is what brings both rows in",
			switched.ok === true && switchedAgent.ok === true,
			`team row ${switched.ok} after ${switched.waitedMs}ms, agent row ${switchedAgent.ok} after ${switchedAgent.waitedMs}ms`,
			`both rows on screen ${switched.waitedMs}ms after the remount, with no other change`,
		);
		return [beforeFrame, afterFrame, switchedFrame];
	}

	check(
		"the authoring frame brings the team row in with nobody touching the app",
		appeared.ok === true,
		`the row was not on screen ${appeared.waitedMs}ms after the write`,
		`on screen ${appeared.waitedMs}ms after the write, still on ${route.route}`,
	);
	check(
		"and the agent row with it",
		appearedAgent.ok === true,
		`the row was not on screen ${appearedAgent.waitedMs}ms after the write`,
		`on screen ${appearedAgent.waitedMs}ms after the write`,
	);
	check(
		"neither list was re-read BEFORE the write, and both were re-read after it",
		refetched("teams") && refetched("profiles"),
		`teams ${before.teams.total} -> ${after.teams.total}, profiles ${before.profiles.total} -> ${after.profiles.total}, write at ${wroteAt}`,
		`teams ${before.teams.total} -> ${after.teams.total} and profiles ${before.profiles.total} -> ${after.profiles.total}, the last fetch of each after the write`,
	);
	check(
		"the app stayed on the chat route from the write to the row, so the refresh was not a navigation",
		route.route === "/chat",
		`route ${route.route}`,
		`route ${route.route}`,
	);
	return [beforeFrame, afterFrame];
}

/** The two authoring keys, as the cache holds them. */
async function readAuthoringQueries(cdp) {
	const queries = await verb(cdp, "queries");
	return queries
		.filter(
			(entry) =>
				entry.key.includes('"desktop","teams"') ||
				entry.key.includes('"desktop","profiles"'),
		)
		.map((entry) => ({
			key: entry.key,
			status: entry.status,
			hasData: entry.hasData,
			observers: entry.observers,
			updatedAt: entry.updatedAt,
		}));
}

/**
 * One authoring write, from the harness rather than from the app.
 *
 * No `Origin` header: the backend's desktop plane admits a bearer-only request
 * and refuses an Origin it does not trust, and this write is deliberately a
 * server-side one - the point is that it is not the app's own request.
 */
async function authoringWrite(path, body) {
	const response = await fetch(`${BACKEND}${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
		},
		body: JSON.stringify(body),
	});
	const text = await response.text();
	return { path, status: response.status, body: text.slice(0, 300) };
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
/**
 * Sample the gate's inputs at 100ms for the whole scene, in the page.
 *
 * WHY AT THIS RATE. A read that repeats once a second can be React Query's own
 * retry, a refetch from an invalidation, or a consumer reacting to a status
 * push - and the samplers above see one value per sample, which is too coarse
 * to tell a retry loop from a pulse: both look like "still fetching". What
 * separates them is whether the state LEAVES `fetching` between reads, so this
 * records every transition with its timestamp and the two counters that move
 * only on a real failure (`fetchFailureCount`).
 *
 * The browser's own connectivity events are recorded beside it because the
 * connectivity gate listens for them and invalidates every active query on
 * each one, excluding only `config` - which is exactly the key that is NOT
 * allowed to hold this screen.
 */
function startGateSampler(cdp) {
	return cdp.evaluate(`(() => {
		const state = { events: [], online: navigator.onLine, onlineEvents: 0, offlineEvents: 0 };
		window.__gateSample = state;
		window.addEventListener("online", () => {
			state.onlineEvents += 1;
			state.events.push({ at: Date.now(), kind: "online" });
		});
		window.addEventListener("offline", () => {
			state.offlineEvents += 1;
			state.events.push({ at: Date.now(), kind: "offline" });
		});
		const read = () => {
			const snapshot = window.__gateLastSnapshot;
			const query = window.__gateQueryState;
			return {
				at: Date.now(),
				daemon: snapshot ? snapshot.state : null,
				status: query ? query.status : null,
				fetchStatus: query ? query.fetchStatus : null,
				failureCount: query ? query.failureCount : null,
			};
		};
		state.timer = setInterval(() => {
			const now = read();
			const previous = state.last;
			if (
				!previous ||
				previous.daemon !== now.daemon ||
				previous.status !== now.status ||
				previous.fetchStatus !== now.fetchStatus ||
				previous.failureCount !== now.failureCount
			) {
				state.events.push(now);
			}
			state.last = now;
		}, 100);
		return true;
	})()`);
}

/**
 * When a `settings-gate` run reads the screen, in milliseconds after the
 * navigation. Chosen against what the page can legitimately cost rather than
 * against a guess: the config read answers in single-digit milliseconds on a
 * live daemon, the account read is one desktop control with at most two React
 * Query retries behind it, and the transport's own op deadline is 25s. So 0.5s
 * is "before any of that has settled", 5s is "after the account read's last
 * retry could have landed", and 30s is "past the deadline, so a spinner still
 * here is NOT waiting for a request to answer".
 */
const GATE_SAMPLES_MS = [500, 5000, 30000];

/**
 * What is on the settings route right now: which surface, and which query holds it.
 *
 * The two spinners this route can show are the same pixels, so the reading is
 * the accessible text rather than the picture: SettingsPage's own waiting branch
 * labels its spinner "Loading settings", the route's Suspense fallback labels
 * its own "Loading page", and the settings sidebar (`nav[aria-label="Settings
 * sections"]`) is the marker that a REVIEWED surface is up, because it renders
 * past both early returns.
 */
function readSettingsGate(cdp) {
	return cdp.evaluate(`(() => {
		const main = document.querySelector("main");
		const statuses = Array.from(document.querySelectorAll('[role="status"]'))
			.map((el) => (el.textContent || "").trim());
		return {
			route: window.location.hash.replace(/^#/, "") || "/",
			statuses,
			loadingSettings: statuses.includes("Loading settings"),
			loadingPage: statuses.includes("Loading page"),
			settingsNav: Boolean(document.querySelector('nav[aria-label="Settings sections"]')),
			/*
			 * The page's own error surface, which is a RESOLVED state rather than a
			 * waiting one: configError is checked before the loading branch, so a
			 * config read that failed renders this and stops waiting. A scene that
			 * only accepted the sidebar would report the working recovery affordance
			 * as a failure.
			 *
			 * No backticks anywhere in this template: the evaluate body IS a
			 * backtick string, so one in a comment closes it (measured: this comment
			 * as first written was a SyntaxError at load, and the scene never ran).
			 */
			configErrorCopy: (main?.textContent || "").includes(
				"Your settings could not be loaded",
			),
			mainHeading: (main?.querySelector("h1")?.textContent || "").trim(),
			mainChars: (main?.textContent || "").trim().length,
		};
	})()`);
}

/**
 * Which queries are holding the route, read from the app's own cache.
 *
 * Only the two keys this route's gate reads are reported by VALUE, and every
 * other query is reported by key and state alone: the others hold conversations,
 * agents and credentials, and a harness log is not the place for them. The
 * reading that matters is `isLoading` in the query hook's own terms -- React
 * Query ANDs `pending` with `fetching` -- which is why the cache's two fields
 * travel together with the derived boolean.
 */
async function readGateQueries(cdp) {
	const all = await verb(cdp, "queries");
	const ofInterest = [/^\["config"\]$/, /^\["radient-user","user"\]$/];
	return all.map((entry) => ({
		...entry,
		watched: ofInterest.some((pattern) => pattern.test(entry.key)),
	}));
}

/**
 * What MAIN holds about the daemon, read from the renderer's bridge.
 *
 * WHY THIS IS PART OF THE READING. The surfaces that report "the server is
 * offline" do not probe anything themselves: they read main's snapshot, and
 * `isServerReachable` turns two of its states into "an offline app". So a
 * screen that says waiting while every request it makes is answered can only be
 * explained by this value, which is main's own sentence about what it observed.
 */
function readDaemonSnapshot(cdp) {
	return cdp.evaluate(`(async () => {
		try {
			const snapshot = await window.api.backend.getStatus();
			return {
				state: snapshot.state,
				reconnecting: snapshot.reconnecting,
				url: snapshot.url,
				desktopAvailable: snapshot.desktopAvailable,
				failures: snapshot.failures,
				unanswered: snapshot.unanswered,
				detail: snapshot.detail,
			};
		} catch (error) {
			return { error: String(error) };
		}
	})()`);
}

/**
 * How long the settings route is held by its own loading gate, in the real app.
 *
 * WHY THIS SCENE EXISTS. Two different spinners are the same picture on this
 * route, and the page's gate ANDs two queries that have nothing to do with each
 * other: the config it renders and the Radient account it only reads a boolean
 * from. Which one held the screen, for how long, and whether it ever returns are
 * not answerable from a frame -- so this scene samples the surface AND the cache
 * at the three moments above, and captures a frame at each of them so the two
 * readings can be matched to the same instant.
 *
 * The frames are NOT settle-comparable and are not offered as such:
 * `captureSettled` refuses a frame whose bytes are still changing, which is
 * every frame of an animation the screen is deliberately showing, so this scene
 * takes them with `capture` and says a spinner was on screen where that is what
 * it recorded.
 *
 * The sibling route at the end is the lazy-chunk question asked of the same
 * build: the route table is `React.lazy` across the board, so `/settings`
 * rendering its own gate rather than the fallback -- while a sibling does too --
 * is what distinguishes "this page's queries" from "no lazy route resolves".
 */
async function sceneSettingsGate(cdp) {
	const label = argValue("--gate-state", "unlabelled");
	const started = Date.now();
	/*
	 * Armed BEFORE the navigation, because the reads this instrument exists to
	 * name begin at the route's mount. The verb starts a fetch of its own through
	 * the patched path, so `validated` here is the difference between a reading
	 * and a claim: the first version of this scene wrapped the bridge, was
	 * silently ignored by it, and printed "0 reads from 0 caller(s)" beside an
	 * "armed true" note that could not fail.
	 */
	const armed = await verb(cdp, "queryFetches", { arm: true });
	note("account-read trap armed", JSON.stringify(armed));
	await startGateSampler(cdp);
	await verb(cdp, "navigate", "/settings");

	const samples = [];
	for (const at of GATE_SAMPLES_MS) {
		const remaining = at - (Date.now() - started);
		if (remaining > 0) await wait(remaining);
		const surface = await readSettingsGate(cdp);
		const queries = await readGateQueries(cdp);
		const daemon = await readDaemonSnapshot(cdp);
		/*
		 * Feed the in-page sampler the two values it records transitions of. Read
		 * here, on the sample's own cadence, because the sampler must not itself
		 * run `getStatus()` 10 times a second against main.
		 */
		await cdp.evaluate(
			`(() => {
				window.__gateLastSnapshot = ${JSON.stringify(daemon)};
				const watched = ${JSON.stringify(queries.filter((entry) => entry.watched))};
				window.__gateQueryState = watched.find((entry) => entry.key.includes("radient-user")) || null;
				return true;
			})()`,
		);
		const frame = await capture(cdp, `settings-gate-${label}-${at}ms`);
		const watched = queries.filter((entry) => entry.watched);
		samples.push({ at, surface, daemon, watched, frame: frame?.path ?? null });
		say(
			`  [gate ${label}] t=${at}ms route=${surface.route} loadingSettings=${surface.loadingSettings} loadingPage=${surface.loadingPage} settingsNav=${surface.settingsNav} configError=${surface.configErrorCopy} daemon=${daemon.state}${daemon.reconnecting ? "(reconnecting)" : ""} queries=${JSON.stringify(watched)}`,
		);
	}

	const last = samples[samples.length - 1];
	/*
	 * The callers, deduplicated by their own stack: one entry per distinct call
	 * site, with how many reads it made and the wall-clock span they covered.
	 */
	/*
	 * WHO asks, from the app's own query layer: one entry per distinct call site
	 * with the number of fetches it started. This is the reading the proxy's log
	 * cannot give (every desktop control leaves through one bridge) and the one a
	 * page-side wrapper over `window.api` silently failed to record - so a
	 * repeated read can finally be attributed to a mount, an invalidation or
	 * React Query's own retry rather than guessed at.
	 */
	const fetches = await verb(cdp, "queryFetches", { key: "radient-user" });
	say(
		`  [gate ${label}] radient-user fetches this run: ${fetches.total} from ${fetches.callers.length} distinct call site(s) (trap armed=${fetches.armed} validation records=${fetches.probeRecords})`,
	);
	for (const caller of fetches.callers) {
		say(
			`    x${caller.count} span=${caller.lastAt - caller.firstAt}ms key=${caller.key} ${caller.stack}`,
		);
	}
	check(
		`the account-read trap was armed and validated itself (${label})`,
		fetches.armed === true && fetches.probeRecords > 0,
		`armed=${fetches.armed} validation-records=${fetches.probeRecords}`,
	);
	/*
	 * The transitions, in order, from inside the page: this is the record that
	 * says whether the screen was held by a query that kept FAILING and
	 * restarting, or by one that never left `fetching` at all.
	 */
	const sampler = await cdp.evaluate(
		`(() => {
			const state = window.__gateSample || { events: [] };
			if (state.timer) clearInterval(state.timer);
			return {
				online: state.online,
				onlineEvents: state.onlineEvents,
				offlineEvents: state.offlineEvents,
				events: state.events.map((event) => ({ ...event, at: event.at - (state.events[0]?.at ?? event.at) })),
			};
		})()`,
	);
	say(
		`  [gate ${label}] navigator.onLine=${sampler.online} online-events=${sampler.onlineEvents} offline-events=${sampler.offlineEvents}`,
	);
	say(`  [gate ${label}] transitions (t=ms from first):`);
	for (const event of sampler.events) {
		say(`    +${event.at}ms ${JSON.stringify(event)}`);
	}
	check(
		`the settings route resolves in this build (${label})`,
		last.surface.settingsNav === true || last.surface.configErrorCopy === true,
		`still on ${last.surface.loadingPage ? "the route's Suspense fallback" : "the page's own waiting branch"} at ${last.at}ms: ${JSON.stringify(last.surface.statuses)}`,
	);

	/*
	 * The sibling route, asked once. 8s is a state a person sees rather than a
	 * race: the fallback is on screen for as long as the chunk takes to arrive,
	 * and a chunk that has not arrived after 8s on this machine is the failure
	 * this sample exists to see.
	 */
	await verb(cdp, "navigate", "/schedules");
	await wait(8000);
	const sibling = await readSettingsGate(cdp);
	say(
		`  [gate ${label}] sibling /schedules: loadingPage=${sibling.loadingPage} mainChars=${sibling.mainChars}`,
	);
	check(
		`a sibling lazy route resolves too (${label})`,
		sibling.loadingPage === false,
		"/schedules is still on the route Suspense fallback after 8s",
	);
	return samples;
}

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
/* ----------------------------------------------------- the sidebar split ---- */

/** The four nodes this scene is about, and the store it writes through. */
const SPLIT_ENTITIES = '[data-sidebar-region="entities"]';
const SPLIT_CHATS = '[data-sidebar-region="chats"]';
const SPLIT_SEPARATOR = '[data-sidebar-split] [role="separator"]';
const SPLIT_CLUSTER = "[data-sidebar-cluster]";
const SPLIT_CLUSTER_REVEALED =
	"[data-sidebar-cluster][data-sidebar-cluster-revealed]";
const SPLIT_STORE = "ui-preferences-storage";

/** The first element matching `selector`, with the numbers a gesture needs. */
async function splitBox(cdp, selector) {
	return cdp.evaluate(`(() => {
		const node = document.querySelector(${JSON.stringify(selector)});
		if (node === null) return null;
		const box = node.getBoundingClientRect();
		return {
			x: box.x + box.width / 2,
			y: box.y + box.height / 2,
			top: box.top,
			bottom: box.bottom,
			left: box.left,
			right: box.right,
			width: box.width,
			height: box.height,
		};
	})()`);
}

/** What is under a point, named the way a hit-test can be read back. */
async function splitHit(cdp, x, y) {
	return cdp.evaluate(`(() => {
		const node = document.elementFromPoint(${x}, ${y});
		if (node === null) return null;
		return {
			tag: node.tagName,
			role: node.getAttribute("role"),
			label: node.getAttribute("aria-label") ?? node.getAttribute("data-tour-tag") ?? null,
			inSeparator: Boolean(node.closest(${JSON.stringify(SPLIT_SEPARATOR)})),
			inCluster: Boolean(node.closest(${JSON.stringify(SPLIT_CLUSTER)})),
		};
	})()`);
}

/** The sidebar's persisted preferences, exactly as the page holds them. */
async function splitPreferences(cdp) {
	return cdp.evaluate(`(() => {
		const raw = window.localStorage.getItem(${JSON.stringify(SPLIT_STORE)});
		if (raw === null) return { raw: null, state: null };
		const parsed = JSON.parse(raw);
		return { raw, state: parsed.state ?? parsed };
	})()`);
}

/**
 * Write preferences and reload, so the app BOOTS into the state under test.
 *
 * A reload rather than a store write from inside the page: the claim these
 * frames carry is that the split is RESTORED, and only a fresh boot of the app
 * against the same profile can say that. It is also how the same profile is
 * reused for the restart step below.
 */
async function setSplitPreferences(cdp, patch) {
	await cdp.evaluate(`(() => {
		const key = ${JSON.stringify(SPLIT_STORE)};
		const raw = window.localStorage.getItem(key);
		const parsed = raw === null ? { state: {} } : JSON.parse(raw);
		const state = parsed.state ?? parsed;
		Object.assign(state, ${JSON.stringify(patch)});
		window.localStorage.setItem(key, JSON.stringify(parsed.state ? parsed : { state }));
		return true;
	})()`);
	await cdp.send("Page.reload", { ignoreCache: false });
	await waitForBridge(cdp);
	await wait(500);
}

/**
 * One drag: press at `(x, y)`, travel `dy` in steps, release.
 *
 * The moves carry `buttons: 1`, which is what makes this a drag rather than a
 * hover followed by a click - `movePointer` beside it sends `buttons: 0`, and a
 * handler that read the button state would see the difference.
 */
async function dragSplit(cdp, x, y, dy, { steps = 6, hold = null } = {}) {
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x,
		y,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	for (let step = 1; step <= steps; step += 1) {
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x,
			y: y + (dy * step) / steps,
			button: "left",
			buttons: 1,
		});
		await wait(25);
	}
	if (hold !== null) await hold();
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x,
		y: y + dy,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	await wait(200);
}

/**
 * The sidebar's split, DRIVEN: the reveal and its timing, the drag, the
 * collapse and restore, the order swap and the restart.
 *
 * WHY THIS SCENE EXISTS. Design review round 1's D1 is the whole reason. The
 * collapse cluster, the boundary's hover and drag state line and the tooltips
 * are the entire interface between a user and this feature, and a Storybook
 * still cannot photograph any of them: `:hover` is a state only the browser can
 * enter, the reveal's TIMING is a claim about two moments rather than one, and
 * the restart is a claim about two boots. Both
 * `docs/evidence/chat-sidebar-sections/README.md` and the manifest pointed at
 * this directory before the scene existed, which is the worse failure of the
 * two: evidence claiming coverage that does not exist.
 *
 * WHAT A FRAME HERE PROVES, AND WHAT IT CANNOT.
 *   - Every gesture goes through `Input.dispatchMouseEvent`/`dispatchKeyEvent`,
 *     so it enters Chromium's own pipeline and the element under it is found the
 *     way a hand's would be. It is still synthetic: no pressure, no jitter, no
 *     trackpad momentum, so no frame says "a real hand finds this".
 *   - A window that is never shown never renders `:focus-visible` rings or
 *     carets, so the keyboard frames are about focus LOCATION only.
 *   - The reveal is photographed TWICE - at a point inside the intent window and
 *     after it - because one still cannot tell "the plate appears with the line"
 *     from "the plate appears first", which is the defect review round 1 (M-1)
 *     measured in the shipped build.
 *   - Two palettes and two widths, and no more: the other ten palettes and every
 *     width between them are the design round's call, and this scene's subject is
 *     a gesture rather than a colour.
 *   - The rows these frames draw are whatever the backend holds. This run seeds
 *     no conversations: the SUBJECT is the boundary, the controls on it and the
 *     state they write, all of which exist with an empty catalogue.
 */
/**
 * The paged chats sidebar: what the panel paints first, and what a group's row
 * does when it is expanded.
 *
 * WHY THIS SCENE EXISTS, in the operator's own words: "no chats are showing up /
 * taking a very long time to load chats". Two mechanisms produced that - a
 * whole-catalogue read re-fired on every catalogue frame, and an empty sentence
 * chosen by a count of the rows in hand - and both are visible only against a
 * catalogue LARGER than one page, which is what the stand-in serves under
 * `--catalogue` (`docs/evidence/sidebar-row-space/harness/stub-daemon.mjs`).
 *
 * THE ASSERTIONS ARE THE HALF-FRAME THE PIXELS CANNOT CARRY. `state.sessionCount`
 * is the store's own row count, so "the first paint is 50 rows of a 120-chat
 * catalogue" and "expanding one team added exactly its first page" are numbers a
 * reader can check rather than impressions of a screenshot. The group's SENTENCE
 * is read off the DOM, because "a group the census says holds chats is not drawn
 * saying it has none" is the invariant this change exists for and a frame alone
 * would only show it for one of the four cases.
 *
 * THE FOUR CASES come from the stand-in's own flags, passed to this run as
 * `--scoped-case`:
 *
 *   `paged`     the feature: the group's own page arrives, with more behind it.
 *   `empty`     a SETTLED page the census still outruns (the stub's `--scope-empty`):
 *               the group's chats are not drawable here, so it must say WHY, and
 *               never "Loading chats…" and never "No chats yet" (round 1, U3).
 *   `loading`   the same arm with every scoped answer HELD OPEN
 *               (`--scope-delay-ms`): a wait that is really happening, which is the
 *               only state in which "Loading chats…" is true.
 *   `empty-group` a genuinely empty group (`--scope-empty --scope-zero-census`): the
 *               page and the census agree there is nothing, so "No chats yet" is
 *               the honest sentence.
 *   `flat-tail` the flat list's own tail, which has no control: a scroll to the
 *               bottom, then rows arriving.
 *   `error`     the scoped read refuses; the group says so and offers Retry.
 *   `withdrawn` the app against a daemon that cannot page at all (`--no-page
 *               --truncate 50`): today's behaviour, including the sentence that
 *               is FALSE there - the operator's screenshot, kept as the before.
 */
async function sceneSidebarLazyChats(cdp) {
	const lazyFacts = await factsOf(cdp);
	check(
		"window mode is headless",
		lazyFacts.windowMode === "headless",
		lazyFacts.windowMode,
	);
	check(
		"the window is never shown and never focused",
		lazyFacts.visible === false && lazyFacts.focused === false,
		`visible=${lazyFacts.visible} focused=${lazyFacts.focused}`,
	);
	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", LAZY_THEME);
	await parkPointer(cdp);
	/*
	 * THE HEAD PAGE, waited for by its own number rather than by the clock: the
	 * catalogue is 120 rows in this fixture and the panel asks for its head page, so
	 * `sessionCount` reaching fifty is the claim, and a run that never gets there
	 * fails here instead of photographing an empty panel and calling it a frame.
	 */
	if (LAZY_CASE !== "withdrawn") {
		const arrived = await waitForCondition(
			cdp,
			'document.querySelectorAll("[data-session-row]").length > 0',
			15_000,
		);
		note("head page arrived", String(arrived));
	}
	await wait(LAZY_SETTLE_MS);
	const head = await verb(cdp, "state");
	const headFrame = await captureSettled(cdp, "head-page");
	note("frame", JSON.stringify(headFrame));
	check(
		"the first paint is the HEAD PAGE, not the catalogue",
		head.sessionCount === LAZY_CATALOGUE_HEAD_PAGE,
		`sessionCount is ${head.sessionCount} (expected ${LAZY_CATALOGUE_HEAD_PAGE} of a ${LAZY_CATALOGUE_TOTAL}-chat stand-in)`,
	);
	if (LAZY_CASE !== "withdrawn") {
		/*
		 * THE ROSTER ARRIVES SEPARATELY FROM THE CATALOGUE (`teams.list`), so the
		 * group's ROW existing is its own moment: reading the badge before it lands
		 * reported `badge: null` on the first run of this scene, which is a fact about
		 * the harness and not about the panel.
		 */
		const roster = await waitForCondition(
			cdp,
			`document.querySelector('[data-disclosure][aria-label="Expand ${LAZY_GROUP} chats"]') !== null`,
			15_000,
		);
		note("the group's row is on screen", String(roster));
		const collapsed = await lazyGroupFacts(cdp, LAZY_GROUP);
		note("the collapsed group", JSON.stringify(collapsed));
	}

	if (LAZY_CASE === "flat-tail" || LAZY_CASE === "flat-tail-error") {
		/*
		 * THE FLAT LIST'S OWN TAIL (the second arm round 1's D3 named as missing). It
		 * has no control by design - one scroller, one scope inside it, so "extend" has
		 * exactly one meaning - which is why the evidence is a scroll followed by ROWS
		 * ARRIVING rather than a press, and a frame of the grown list.
		 *
		 * RUN HERE, BEFORE ANY GROUP IS EXPANDED, and that is a fact about the fixture
		 * rather than about the panel: the stand-in's `lopdev` population IS the
		 * catalogue's second half, so once that group has drawn its own pages the
		 * head's tail can only re-send rows the client already holds and the frame
		 * would show a list that did not grow for a reason unrelated to the tail.
		 */
		/*
		 * THE LADDER IS SPENT FIRST, and on this panel that is not incidental.
		 *
		 * #505 opened a collapsed `Previous chats` here, because on main's list a shut
		 * section draws none of its rows and the tail it would extend is then not on
		 * screen to be scrolled to. THIS PANEL HAS NO SUCH SECTION: this redesign
		 * replaced `Active chats` / `Previous chats` with the sections the view popover
		 * draws (`Running`, `Today`, `This week`, `Older`), and none of them collapses.
		 * Measured rather than assumed - `"Previous chats"` occurs 0 times at this
		 * branch's pre-fold head `6a4a176f6`.
		 *
		 * WHAT WITHHOLDS THE TAIL HERE INSTEAD IS THE PAGE LADDER. The operator's
		 * contract is "starts with 10, then 25, then 50, and then user can click to load
		 * more", so while the ladder still holds rows the reader has not asked for, a
		 * short region is the LADDER's doing and not evidence that the list wants
		 * filling. `ladderHoldsRowsRef` is what says so and `extendCatalogueTail` is what
		 * reads it; the scroll's own extension takes over exactly when the drawn page has
		 * reached the rows in hand.
		 *
		 * AND THAT IS ASSERTED, not assumed: a run that pressed nothing would photograph
		 * "the tail did not extend" as though it were a fact about the panel, which is
		 * the same mistake the section complaint above records.
		 */
		/*
		 * THE LADDER IS COUNTED FROM THE DOM, and from the drawn rows alone: a rung
		 * changes how many rows this panel DRAWS, never how many the client HOLDS
		 * (`state.sessionCount` is `sessions.sessions.length`, which a rung does not
		 * move). Counting the held rows here - which the first version of this
		 * adaptation did - reads "no progress" after one press and stops the arm on a
		 * page it never grew.
		 */
		const drawnRows = () =>
			cdp.evaluate(`document.querySelectorAll("[data-session-row]").length`);
		const drawnAtStart = await drawnRows();
		const heldAtStart = (await verb(cdp, "state")).sessionCount;
		/*
		 * THE CURSOR BASELINE IS READ HERE, before anything presses or scrolls. Read
		 * after the scroll instead it already contains the line the scroll wrote, and
		 * the arm's own claim became unprovable - measured on the run that did it.
		 */
		const cursorCount = () =>
			(() => {
				try {
					return readFileSync(STUB_LOG, "utf8")
						.split("\n")
						.filter((line) => line.includes("sessions?") && line.includes("cursor="))
						.length;
				} catch {
					return 0;
				}
			})();
		const cursorsBefore = cursorCount();
		let ladderRows = drawnAtStart;
		let ladderPresses = 0;
		for (let press = 0; press < 6; press += 1) {
			const more = await cdp.evaluate(
				`document.querySelector('[data-sidebar-page-more]') !== null`,
			);
			if (more !== true) break;
			await verb(cdp, "press", { selector: "[data-sidebar-page-more]" });
			await wait(250);
			const after = await drawnRows();
			ladderPresses += 1;
			/*
			 * TWO SIGNALS END THE PRESSES, and the first is the one that matters here.
			 *
			 * The ladder's rungs are 10 -> 25 -> 50 (then 50 more per press), while the
			 * head page holds fifty rows: so the SECOND press is the one that draws the
			 * rows in hand, and every press after it asks for more than the client holds -
			 * which this panel answers by following the head's cursor (`pressPageMore`),
			 * paging the catalogue to its end. Pressing on would photograph exhaustion and
			 * never the scroll's extension, which is what this arm is for. STOPPING AT THE
			 * ROWS IN HAND is therefore the state this arm needs, and it is exactly the
			 * state `ladderHoldsRowsRef` releases the scroll in.
			 *
			 * A press that drew nothing new is the second signal: the ladder is done and
			 * the tail owns the rest. Stopping on that rather than after a fixed number of
			 * presses keeps the arm honest if the rungs ever change.
			 */
			if (after >= heldAtStart || after === ladderRows) break;
			ladderRows = after;
		}
		/*
		 * READ FRESH AFTER THE LOOP, because the break above leaves `ladderRows` at the
		 * value BEFORE the last press: the press that crosses the rows in hand is the one
		 * that breaks, so its own rows are not in that variable. Left stale it silently
		 * became the baseline the scroll had to beat, and the arm then passed its growth
		 * claim on the LADDER's rows rather than the tail's.
		 */
		ladderRows = await drawnRows();
		note(
			"the ladder after it was spent",
			JSON.stringify({
				presses: ladderPresses,
				drawnFrom: drawnAtStart,
				drawnTo: ladderRows,
				held: heldAtStart,
			}),
		);
		check(
			"the ladder's presses draw towards the rows the client already holds",
			ladderRows > drawnAtStart,
			`the drawn page went ${drawnAtStart} -> ${ladderRows} over ${ladderPresses} press(es), against ${heldAtStart} held`,
		);
		const beforeFlat = await verb(cdp, "state");
		/*
		 * The scroll has to beat the DRAWN list, and the tail also has to have FETCHED:
		 * an extension is a page off the cursor, so the held count moving is the half of
		 * the claim the DOM cannot make.
		 */
		const drawnBefore = ladderRows;
		/*
		 * THE REGION IS SCROLLED TO ITS END, by a `scrollTop` write AND a real wheel
		 * event at the region's OWN centre. Both, because each alone can miss: the first
		 * run of this arm aimed its wheel at fixed coordinates that turned out to be
		 * outside the box (`scrollTop` stayed 0 and the daemon was asked for nothing),
		 * and a `scrollTop` write on a region whose section is shut moves a list that
		 * draws no rows. The box is measured here rather than guessed.
		 */
		const regionBox = await cdp.evaluate(`(() => {
			const region = document.querySelector('[data-sidebar-region="chats"]');
			if (region === null) return null;
			const box = region.getBoundingClientRect();
			return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
		})()`);
		note("the chats region's centre", JSON.stringify(regionBox));
		await cdp.evaluate(
			`(() => { const region = document.querySelector('[data-sidebar-region="chats"]'); if (region) region.scrollTop = region.scrollHeight; return true; })()`,
		);
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			x: regionBox === null ? 140 : regionBox.x,
			y: regionBox === null ? 400 : regionBox.y,
			deltaX: 0,
			deltaY: 6000,
		});
		await wait(500);
		/*
		 * THE GEOMETRY IS RECORDED, not inferred from the outcome. "The list did not
		 * grow" has three different causes - the region never scrolled, the section was
		 * shut, or the extension fired and the answer was not merged - and only these
		 * numbers separate them.
		 */
		const flatGeo = await cdp.evaluate(`(() => {
			const region = document.querySelector('[data-sidebar-region="chats"]');
			return {
				region: region !== null,
				scrollTop: region === null ? null : Math.round(region.scrollTop),
				scrollHeight: region === null ? null : region.scrollHeight,
				clientHeight: region === null ? null : region.clientHeight,
				pageMore: document.querySelector("[data-sidebar-page-more]") !== null,
				rows: document.querySelectorAll("[data-session-row]").length,
			};
		})()`);
		note("the flat list's geometry after the scroll", JSON.stringify(flatGeo));
		/*
		 * THE TWO CASES ASSERT OPPOSITE THINGS about the same scroll, so the growth branch is
		 * the success case's alone: with `--tail-error` the extension is refused and its own
		 * branch below reads the treatment off the elements.
		 */
		if (LAZY_CASE === "flat-tail") {
			/*
			 * THE REQUEST IS THE CLAIM, not the DOM growth, and the last run is why.
			 *
			 * MEASURED: the scroll asked for the tail - the stand-in logged
			 * `...&cursor=off%3A50 -> 200 rows=50 next=off:100` - and the head answers that
			 * follow it (one per `catalogue` frame, `rows=50 next=off:50`) then DROPPED
			 * those rows, because on the UNSCOPED list the tail's rows are head-owned:
			 * `headHeldRows` excludes only the ids a loaded SCOPE holds, so the head's own
			 * re-read replaces an unscoped extension. That is #505's accepted rule
			 * (`headHeldRows`' note, round 1 R1) rather than anything this fold changed,
			 * and the same arm races the same way on main. So the arm asserts the REQUEST
			 * - this rig's own convention for "the DOM cannot say which page a control
			 * asked for" - and reports the two counts it cannot make durable.
			 */
			/*
			 * THE PANEL'S OWN ROUTE IS THE FOOT PRESS, and the two runs before this one
			 * are why the claim is stated that way rather than about the scroll.
			 *
			 * MEASURED: with the ladder spent the commit-time extension fires ONCE by
			 * itself (the region is short, so `tailExtendDue` is true) and takes the head
			 * to 100 held rows; after that the scroll is held back again, because the
			 * ladder's rung is once more below the rows in hand and `ladderHoldsRowsRef`
			 * says a short region is the LADDER's doing rather than evidence that the list
			 * wants filling. On main the scroll was the ONLY route, so its arm could
			 * assert "extends itself on scroll, with no control to press". THIS PANEL HAS
			 * A PRESS AT THAT FOOT - the operator's own contract, "then user can click to
			 * load more" - and `pressPageMore` spends the rung and follows the head's
			 * cursor, which is the same scoped request and the same cursor as everything
			 * else. The arm therefore asserts the press, which is the route the shipped
			 * panel offers and the one the operator asked for.
			 */
			const footPress = await cdp.evaluate(`(() => {
				const more = document.querySelector("[data-sidebar-page-more]");
				return more === null ? null : more.textContent.replace(/\s+/g, " ").trim();
			})()`);
			note("the flat list's foot control", JSON.stringify(footPress));
			if (footPress !== null) {
				await verb(cdp, "press", { selector: "[data-sidebar-page-more]" });
			}
			/*
			 * A run whose gate held everything back never writes one, which is the failure
			 * this arm exists to catch.
			 */
			const asked = await waitForStubLine("cursor=off%3A50", 5_000);
			const cursorsAfter = cursorCount();
			check(
				"the flat list reaches the rest of the catalogue, and the daemon is asked with the head's own cursor",
				asked === true && cursorsAfter > cursorsBefore,
				`the stand-in received ${cursorsAfter - cursorsBefore} cursor request(s) (${cursorsBefore} before the ladder), with the ladder spent at ${drawnBefore} drawn rows`,
			);
			const drawnNow = await cdp.evaluate(
				`document.querySelectorAll("[data-session-row]").length`,
			);
			const heldNow = await verb(cdp, "state");
			note(
				"the extension's rows, before the head answers replace them",
				JSON.stringify({
					drawnBefore,
					drawnNow,
					heldBefore: beforeFlat.sessionCount,
					heldNow: heldNow.sessionCount,
					cursor: heldNow.catalogueNextCursor ?? null,
				}),
			);
			/*
			 * NOT AN ASSERTION, and the reason is in the note above: an unscoped
			 * extension is replaced by the next head answer, so "the list is 100 rows
			 * thirty seconds later" is not something this panel promises.
			 */
			note(
				"the unscoped extension is not durable under the head's own re-read (headHeldRows)",
				`held went ${beforeFlat.sessionCount} -> ${heldNow.sessionCount} while the head answers kept arriving at limit=50 next=off:50`,
			);
			await wait(LAZY_SETTLE_MS);
			/*
			 * AND THE REGION IS PUT BACK AT ITS END BEFORE THE FRAME (round 4, D21). The scroll
			 * above is written ONCE, before the page it asks for lands: an absolute `scrollTop`
			 * is a position, not a promise, so the rows that arrive below the fold leave the
			 * viewport where it was and the frame showed the middle of the list (the designer
			 * measured `Chat 040`…`Chat 051` where the arm's own bytes show `Chat 089`…`Chat 100`).
			 * Scrolled again here, and ASSERTED at the end, because "the frame shows the tail"
			 * is the whole point of this arm.
			 */
			await cdp.evaluate(
				`(() => { const region = document.querySelector('[data-sidebar-region="chats"]'); if (region) region.scrollTop = region.scrollHeight; return true; })()`,
			);
			await wait(500);
			const flatEnd = await cdp.evaluate(`(() => {
				const region = document.querySelector('[data-sidebar-region="chats"]');
				if (region === null) return null;
				return {
					atEnd: region.scrollTop + region.clientHeight >= region.scrollHeight - 1,
					scrollTop: Math.round(region.scrollTop),
					scrollHeight: region.scrollHeight,
					clientHeight: region.clientHeight,
				};
			})()`);
			note("the flat list's scroll after the growth", JSON.stringify(flatEnd));
			check(
				"and the frame is of the TAIL: the region is at its end when it is captured",
				flatEnd?.atEnd === true,
				`scrollTop ${flatEnd?.scrollTop} + clientHeight ${flatEnd?.clientHeight} against scrollHeight ${flatEnd?.scrollHeight} (the first version wrote the scroll once, before the rows landed, and photographed the middle of the list)`,
			);
			const flatFrame = await captureSettled(cdp, "flat-tail");
			note("frame", JSON.stringify(flatFrame));
			const grown = await verb(cdp, "state");
			note(
				"the store after the frame",
				JSON.stringify({
					held: grown.sessionCount,
					drawn: await cdp.evaluate(
						`document.querySelectorAll("[data-session-row]").length`,
					),
				}),
			);
			return;
		}
	}

	if (LAZY_CASE === "flat-tail-error") {
		/*
		 * THE FLAT LIST'S OWN REFUSAL (round 3, D18). The third refusal site, and the one
		 * nobody could see: D10's history is a fix that landed on one of three sites while the
		 * frame photographed another, so the site with no frame is the site to photograph.
		 *
		 * The list has already painted (the head read is untouched by `--tail-error`), so what
		 * this arm shows is a list that refused to GROW - and the check reads the treatment
		 * off the ELEMENTS rather than off the copy: the sentence clamped, and the Retry in
		 * its own paragraph rather than inline after the text.
		 */
		const tailRefusal = await waitForCondition(
			cdp,
			`(() => {
				const region = document.querySelector('[data-sidebar-region="chats"]');
				if (region === null) return null;
				const button = Array.from(region.querySelectorAll("button")).find(
					(node) => node.textContent.trim() === "Retry",
				);
				if (button === undefined) return null;
				const sentence = button.parentElement?.previousElementSibling ?? null;
				return {
					retryParentTag: button.parentElement?.tagName ?? null,
					sentenceTag: sentence?.tagName ?? null,
					sentence: (sentence?.textContent ?? "").trim(),
					lineClamp: sentence === null ? null : getComputedStyle(sentence).webkitLineClamp,
					rows: document.querySelectorAll("[data-session-row]").length,
				};
			})()`,
			20_000,
		);
		note("the flat list's refusal", JSON.stringify(tailRefusal));
		check(
			"the third refusal site renders the one treatment: a clamped sentence with the Retry on its own line",
			tailRefusal.ok === true &&
				tailRefusal.last?.sentenceTag === "P" &&
				tailRefusal.last?.retryParentTag === "P" &&
				tailRefusal.last?.lineClamp === "2",
			`read off the elements: ${JSON.stringify(tailRefusal.last)}`,
		);
		await wait(LAZY_SETTLE_MS);
		const refusalFrame = await captureSettled(cdp, "flat-tail-error");
		note("frame", JSON.stringify(refusalFrame));
		/*
		 * AND THE PRESS THAT FAILS IDENTICALLY (round 4, U14). This Retry is the one control
		 * in the panel whose press can come back with the SAME refusal: the requester's
		 * elements are repainted, and focus used to end on `<body>` with nothing announced.
		 * Pressed by KEYBOARD here, because that is the reader this defect belongs to, and
		 * the region's own text is sampled while it happens - the walk through "Loading more
		 * chats…" and back to the sentence is the re-announcement, and a text that never
		 * changed is how it would silently not happen.
		 */
		await cdp.evaluate(`(() => {
			window.__tailTexts = [];
			/*
			 * THE REGION IS LOOKED UP EVERY TICK, not captured once: a React re-render can
			 * replace the node, and a detached node's textContent is frozen at whatever it held
			 * when it was orphaned - which is how the first version of this sampler reported
			 * zero changes while the reader's own region was changing in front of them.
			 */
			const grab = () => {
				const region = document.querySelector('[data-sidebar-region="chats"]');
				const text = (region?.textContent ?? "").replace(/\s+/g, " ").trim();
				const seen = window.__tailTexts;
				if (seen[seen.length - 1] !== text) seen.push(text);
			};
			grab();
			const timer = setInterval(grab, 50);
			setTimeout(() => clearInterval(timer), 12_000);
			return true;
		})()`);
		const focusedRetry = await cdp.evaluate(`(() => {
			const region = document.querySelector('[data-sidebar-region="chats"]');
			const button = Array.from(region?.querySelectorAll("button") ?? []).find(
				(node) => node.textContent.trim() === "Retry",
			);
			if (button === undefined) return false;
			button.focus();
			return document.activeElement === button;
		})()`);
		check(
			"the flat list's Retry can be focused",
			focusedRetry === true,
			`focused: ${focusedRetry}`,
		);
		/*
		 * A REAL Enter, in three parts: CDP needs the RAW keydown, the character (which is
		 * what a focused button activates on) and the keyup. The first attempt sent
		 * `keyDown` alone and the daemon was asked nothing - the check below passed
		 * vacuously on the button this script had just focused, which is exactly the shape of
		 * evidence that proves nothing.
		 */
		for (const event of [
			{ type: "rawKeyDown", text: undefined },
			{ type: "char", text: "\r" },
			{ type: "keyUp", text: undefined },
		]) {
			await cdp.send("Input.dispatchKeyEvent", {
				type: event.type,
				key: "Enter",
				code: "Enter",
				windowsVirtualKeyCode: 13,
				nativeVirtualKeyCode: 13,
				...(event.text === undefined ? {} : { text: event.text }),
			});
		}
		/*
		 * AND THE PRESS IS PROVEN TO HAVE LANDED BEFORE ANYTHING IS CONCLUDED FROM IT: the
		 * arm waits for the REGION'S OWN TEXT to have walked the wait register and come back
		 * to a refusal, which is both the landing proof and the re-announcement this finding
		 * is about. Read from the sampler rather than from the daemon's log, because the log
		 * proves a request and this has to prove what the reader's region did with the answer.
		 */
		const reread = await waitForCondition(
			cdp,
			`(() => {
				const texts = window.__tailTexts ?? [];
				return texts.length >= 2 ? { count: texts.length } : null;
			})()`,
			15_000,
		);
		check(
			"the keyboard press reached the daemon, and the region changed while it was in flight (U14)",
			reread.ok === true,
			`the region's text changed ${reread.last?.count ?? 0} time(s) during the press and settled back on the refusal (waited ${reread.waitedMs} ms) - one means the region never changed, which is the state this finding filed`,
		);
		/*
		 * THE SETTLED READ, waited for rather than sampled: the refusal has to be BACK (the
		 * re-read is over) before focus can be judged, which is the mistake the previous shape
		 * made - it read while the answer was still in flight and reported `<body>` for the
		 * state that the fix does not govern.
		 */
		await waitForCondition(
			cdp,
			`(() => {
				const region = document.querySelector('[data-sidebar-region="chats"]');
				const text = (region?.textContent ?? "").replace(/\s+/g, " ").trim();
				return text.includes("refuse") ? true : null;
			})()`,
			15_000,
		);
		await wait(400);
		const afterRetry = await cdp.evaluate(`(() => {
			const region = document.querySelector('[data-sidebar-region="chats"]');
			const button = Array.from(region?.querySelectorAll("button") ?? []).find(
				(node) => node.textContent.trim() === "Retry",
			);
			return {
				present: button !== undefined,
				focused: button !== undefined && document.activeElement === button,
				activeTag:
					document.activeElement === document.body
						? "body"
						: (document.activeElement?.tagName?.toLowerCase() ?? null),
				live:
					region?.querySelector("[aria-live]")?.getAttribute("aria-live") ?? null,
				/*
				 * MATCHED ON WHAT THE REGION RENDERS, not on the string this file would write: the
				 * ellipsis it draws is a single character the sampler reads as part of a longer run,
				 * so the first filter looked for a phrase that never appears verbatim and counted
				 * zero changes in a region that had visibly changed.
				 */
				texts: (window.__tailTexts ?? []).filter((text) =>
					/refuse|Loading more/.test(text),
				).length,
				sampled: (window.__tailTexts ?? []).length,
			};
		})()`);
		note("the refused retry", JSON.stringify(afterRetry));
		check(
			"a failed re-read hands focus BACK to the control that was pressed, never to `<body>` (U14)",
			afterRetry.present === true && afterRetry.focused === true,
			`activeElement is ${JSON.stringify(afterRetry.activeTag)}; the settled state is ${JSON.stringify(afterRetry)}`,
		);
		check(
			/*
			 * THE ANNOUNCEMENT IS THE REGION'S OWN CHANGE, which is what a polite region
			 * announces: the same refusal rendered again into an unchanged region says nothing,
			 * and that is precisely the state U14 filed. Asserted from the SETTLED text plus the
			 * number of distinct texts the press produced, rather than from the wait register,
			 * because a stub that answers in a millisecond renders that register for a
			 * millisecond - the arm can now slow it (`--tail-delay-ms`), but the assertion must
			 * not depend on a lever nobody sets by default.
			 */
			"and the refusal is re-announced through the region that already exists",
			afterRetry.live === "polite" &&
				afterRetry.sampled >= 2 &&
				afterRetry.texts >= 1,
			`the region's aria-live is ${JSON.stringify(afterRetry.live)}, it produced ${afterRetry.sampled} distinct text(s) during the press and settled on ${afterRetry.texts} refusal state(s) - a region that never changed announces nothing`,
		);
		return;
	}

	// --- the expansion, which is the whole change ---------------------------
	await verb(cdp, "press", {
		selector: `[data-disclosure][aria-label="Expand ${LAZY_GROUP} chats"]`,
	});
	await wait(LAZY_SETTLE_MS);
	if (LAZY_CASE === "paged") {
		// Waited for, not sampled: see `waitForSessionCount`.
		await waitForSessionCount(cdp, LAZY_CATALOGUE_HEAD_PAGE + LAZY_GROUP_PAGE);
	}
	const opened = await verb(cdp, "state");
	note("the store's scopes after the expansion", JSON.stringify(opened.scopes));
	note("the census total the head answer carried", String(opened.countsTotal));
	const group = await lazyGroupFacts(cdp, LAZY_GROUP);
	const openFrame = await captureSettled(cdp, "group-open");
	note("frame", JSON.stringify(openFrame));
	/*
	 * THE SAME STATE IN THE OTHER THEME (UX round 2): the set this branch shipped was
	 * dark-only, so D1/D5's "the badge and the sentence read in both themes" claim had no
	 * evidence behind it. Captured in the same state as `group-open`, then restored so every
	 * other frame stays dark.
	 */
	await verb(cdp, "setTheme", LAZY_LIGHT_THEME);
	await wait(LAZY_SETTLE_MS);
	const lightFrame = await captureSettled(cdp, "group-open-light");
	note("frame", JSON.stringify(lightFrame));
	await verb(cdp, "setTheme", LAZY_THEME);
	await wait(LAZY_SETTLE_MS);
	note("the expanded group", JSON.stringify(group));

	if (LAZY_CASE === "paged") {
		check(
			"expanding one group fetched exactly its own first page",
			opened.sessionCount === LAZY_CATALOGUE_HEAD_PAGE + LAZY_GROUP_PAGE,
			`sessionCount went ${head.sessionCount} -> ${opened.sessionCount} (expected ${LAZY_CATALOGUE_HEAD_PAGE + LAZY_GROUP_PAGE})`,
		);
		/*
		 * THE BADGE IS READ WITH THE GROUP OPEN, and that is a deliberate retreat
		 * rather than a weakened claim. It is the same element either way (the badge is
		 * drawn on the group's own row, open or closed), and the read of a CLOSED group
		 * raced the roster's arrival: this scene's second run read nulls for a row the
		 * press immediately found and labelled "Collapse lopdev chats". The FRAME below
		 * is the closed-group evidence; the number is asserted where the read is
		 * reliable.
		 */
		check(
			"the group's badge is the CENSUS, not the rows in hand",
			group.badge === LAZY_GROUP_TOTAL,
			`badge reads ${JSON.stringify(group.badge)} (expected ${LAZY_GROUP_TOTAL} over a page of ${LAZY_GROUP_PAGE})`,
		);
		check(
			"the group draws its rows rather than a sentence",
			group.sentence === null && group.rows > 0,
			`rows=${group.rows} sentence=${JSON.stringify(group.sentence)}`,
		);
		check(
			"the group offers its tail, because the daemon said there is one",
			group.more !== null,
			JSON.stringify(group.more),
		);
		// --- and the tail, one press at a time ------------------------------
		/*
		 * SCROLLED INTO VIEW FIRST, because `press` is a REAL pointer event at the
		 * element's box (`pressAt` in `src/renderer/src/dev-driver/install.ts`) and
		 * the tail sits at the bottom of a scroller: a press on a control below the
		 * fold lands on whatever is actually there, which is how the first run of this
		 * scene pressed the button and changed nothing. The pattern is the driver's
		 * own (`sceneSessionArchive` does the same before a press).
		 */
		await cdp.evaluate(
			`(() => { const node = document.querySelector('[data-scope-more="team:${LAZY_GROUP}"]'); if (node) node.scrollIntoView({ block: "center" }); return node !== null; })()`,
		);
		await wait(300);
		/*
		 * THE CONTROL ITSELF, IN A FRAME (round 1, D3). The press UNMOUNTS the
		 * control when it fetches the last page, and the earlier version of this set
		 * claimed a frame showed it while no frame did. Captured here, between the
		 * scroll that brings it into the viewport and the press that consumes it,
		 * which is the only moment it is both on screen and still a control.
		 */
		const moreFrame = await captureSettled(cdp, "group-more");
		note("frame", JSON.stringify(moreFrame));
		/*
		 * THE PANEL AT ITS OWN DRAG FLOOR (round 1, D8), captured HERE - with the group
		 * open and its control on screen, before any press moves the geometry. The
		 * earlier attempt to narrow this surface set a WINDOW size rather than the
		 * panel's own width, so the panel was boxed at x 438-955 in both frames and
		 * nothing was narrower. `240` is the floor the preference is clamped to
		 * (`chatSidebarWidth`, clamped 240..360), set through the driver's own
		 * preference verb, so the frame is of the app's real floor. It is restored
		 * before the press: a control whose box the width change has just moved is a
		 * press that lands on nothing, which is what the first attempt measured.
		 */
		const wideWidth = await cdp.evaluate(
			`document.querySelector('[data-sidebar-region="chats"]')?.offsetWidth ?? null`,
		);
		/*
		 * AND THE PREFERENCE ITSELF, because the two are not the same number (round 4, D20):
		 * `chatSidebarWidth` is the panel's OUTER width (the app's default 280 measures 264
		 * inside the region), so restoring the region's measured width wrote 264 into a
		 * preference that means something else and left the post-press frames ~16px inside
		 * the declared default - a set whose frames and whose README disagreed by a number
		 * nobody chose. `undefined` is not a value here: it DELETES the key, which is how the
		 * app's own default comes back on a profile that never stored one.
		 */
		const preferencesAtStart = await splitPreferences(cdp);
		const preferenceWidth = preferencesAtStart.state?.chatSidebarWidth;
		await setSplitPreferences(cdp, { chatSidebarWidth: 240 });
		await wait(LAZY_SETTLE_MS);
		const narrowWidth = await cdp.evaluate(
			`document.querySelector('[data-sidebar-region="chats"]')?.offsetWidth ?? null`,
		);
		check(
			"the narrow frame is NARROWER: the panel is at its own drag floor, not at the window's size",
			typeof wideWidth === "number" &&
				typeof narrowWidth === "number" &&
				narrowWidth <= 250 &&
				narrowWidth < wideWidth,
			`the chats region is ${narrowWidth}px at the floor against ${wideWidth}px at this run's default (a WINDOW size, which is what the earlier attempt changed, leaves the panel at x 438-955 in both frames)`,
		);
		const narrowFrame = await captureSettled(cdp, "group-narrow");
		note("frame", JSON.stringify(narrowFrame));
		/*
		 * RESTORED TO THIS RUN'S OWN WIDTH, NOT TO 360 (round 3, D16). The narrow capture
		 * above is taken at the floor, and the press briefly needed the panel wider than the
		 * floor to keep the control on screen; leaving it at the clamp's ceiling made the two
		 * post-press frames 361 logical px wide while every other frame in the set was at the
		 * run's default 281 - a set that mixes undeclared widths cannot be compared frame to
		 * frame. `wideWidth` is the width this run actually started at, measured above.
		 */
		await setSplitPreferences(cdp, {
			chatSidebarWidth:
				typeof preferenceWidth === "number" ? preferenceWidth : undefined,
		});
		const restoredWidth = await cdp.evaluate(
			`document.querySelector('[data-sidebar-region="chats"]')?.offsetWidth ?? null`,
		);
		check(
			"the post-press frames are back at this run's OWN width, preference for preference",
			restoredWidth === wideWidth,
			`the chats region is ${restoredWidth}px after the restore against ${wideWidth}px before the narrow capture (preference ${JSON.stringify(preferenceWidth)}); the earlier shape wrote the region's inner measurement into an OUTER-width preference and left these frames 16px inside the set's declared default`,
		);
		await wait(LAZY_SETTLE_MS);
		/*
		 * AND THE CONTROL IS BROUGHT BACK INTO THE VIEWPORT, because widening the panel
		 * moves it: the region's scroll position was taken at 240px, so at 360px the
		 * control as measured sits below the fold and a press at those coordinates lands
		 * on nothing - which is what the run reported (`hit=null`) with the store state
		 * still saying the tail had not been asked for.
		 */
		await cdp.evaluate(
			`(() => { const node = document.querySelector('[data-scope-more="team:${LAZY_GROUP}"]'); if (node) node.scrollIntoView({ block: "center" }); return node !== null; })()`,
		);
		await wait(300);
		const tailPress = await verb(cdp, "press", {
			selector: `[data-scope-more="team:${LAZY_GROUP}"]`,
		});
		note("the tail control", JSON.stringify(tailPress.target));
		check(
			"the tail press reaches the control itself",
			tailPress.hit === tailPress.target,
			`hit=${JSON.stringify(tailPress.hit)} target=${JSON.stringify(tailPress.target)}`,
		);
		/*
		 * THE EXTENSION IS WAITED FOR, BOUNDED, ON THE SCOPE'S OWN STATE.
		 *
		 * What the press is asserted to do: ask the daemon for THAT SCOPE'S next page,
		 * and MERGE the answer - the scope's ids grow by exactly one page and its
		 * cursor advances to the page after it. The merge half is the part a single
		 * sample cannot see (an unmerged answer and a merged one look identical in the
		 * same instant), so this polls the store's own scope every 100 ms and FAILS
		 * LOUDLY on timeout with the state it last saw and the daemon's own lines for
		 * the scope - which is the evidence that separates "the request never left"
		 * from "it left, was answered, and the answer did not reach the store".
		 */
		/*
		 * THE FOCUS IS ASSERTED, not promised in a comment (round 2, U2 = F1). Two streams
		 * measured focus landing on `<body>` after every press: the recovery effect resolved
		 * its target inside the CHATS region, where an expanded group's rows are not drawn.
		 * The assertion is made against `document.activeElement`'s own identity, so `<body>`
		 * cannot satisfy it.
		 */
		const activeAfterPress = await cdp.evaluate(`(() => {
			const el = document.activeElement;
			if (el === null || el === document.body) return { tag: null, row: null };
			const row = el.closest("[data-session-row]");
			return {
				tag: el.tagName.toLowerCase(),
				row: row === null ? null : row.getAttribute("data-session-row"),
			};
		})()`);
		note("focus after the tail press", JSON.stringify(activeAfterPress));
		check(
			"focus lands on a row of the group, never on body (U2 = F1)",
			activeAfterPress.tag === "button" &&
				String(activeAfterPress.row ?? "").startsWith("p"),
			`activeElement is ${JSON.stringify(activeAfterPress)} (the press added ids from the scope's own list, so the first added row is the group's ${LAZY_GROUP_PAGE + 1}th)`,
		);
		const scopeKey = `team:${LAZY_GROUP}`;
		const grew = await waitForScopeIds(cdp, scopeKey, LAZY_GROUP_PAGE * 2);
		const observed = JSON.stringify(grew.scope);
		if (grew.timedOut) {
			const lines = stubLinesForScope(STUB_LOG, LAZY_GROUP);
			check(
				"the tail page is merged into the scope",
				false,
				`the scope did not reach ${LAZY_GROUP_PAGE * 2} ids within 10 s. Last read: ${observed}. The daemon logged for this scope:\n${lines.length > 0 ? lines.join("\n") : "(nothing)"}`,
			);
		} else {
			check(
				"the tail page is merged into the scope, and the cursor advances past it",
				grew.scope.ids === LAZY_GROUP_PAGE * 2 &&
					grew.scope.nextCursor === `off:${LAZY_GROUP_PAGE * 2}`,
				`scope is ${observed}, expected ${LAZY_GROUP_PAGE * 2} ids and cursor off:${LAZY_GROUP_PAGE * 2}`,
			);
		}
		await wait(LAZY_SETTLE_MS);
		/*
		 * THE TAIL FRAME SHOWS THE CONTROL (round 1, D3). After the first extension
		 * there is another page to come, so the group draws fifty rows AND its
		 * `Show 20 more` control - scrolled into view here so the frame carries the
		 * grown list and the control together, which is what the PR's frame table
		 * claims it shows.
		 */
		await cdp.evaluate(
			`(() => { const node = document.querySelector('[data-scope-more="team:${LAZY_GROUP}"]'); if (node) node.scrollIntoView({ block: "center" }); return node !== null; })()`,
		);
		await wait(300);
		const tailFrame = await captureSettled(cdp, "group-tail");
		note("frame", JSON.stringify(tailFrame));
		note("the scope after the tail press", observed);
		/*
		 * THE LABEL STATES THE ROWS THE PRESS WILL ADD, AND THE LAST PRESS IS EXACT
		 * (round 1, D7). Sixty-five held of seventy read `Show 25 more` - a page size
		 * dressed as a remainder. Here: fifty held of seventy, so five short of a full
		 * page, and the label must say twenty.
		 */
		const label = await cdp.evaluate(
			`(() => { const node = document.querySelector('[data-scope-more="team:${LAZY_GROUP}"]'); return node === null ? null : (node.textContent || "").trim(); })()`,
		);
		check(
			"Show more states the rows the press will ADD, not the page size (D7)",
			label === `Show ${LAZY_GROUP_TOTAL - LAZY_GROUP_PAGE * 2} more`,
			`the control reads ${JSON.stringify(label)} with ${LAZY_GROUP_PAGE * 2} of ${LAZY_GROUP_TOTAL} drawn`,
		);
		const lastPress = await verb(cdp, "press", {
			selector: `[data-scope-more="team:${LAZY_GROUP}"]`,
		});
		check(
			"the last press reaches the control itself",
			lastPress.hit === lastPress.target,
			`hit=${JSON.stringify(lastPress.hit)} target=${JSON.stringify(lastPress.target)}`,
		);
		const exhausted = await waitForScopeIds(cdp, scopeKey, LAZY_GROUP_TOTAL);
		check(
			"the last press adds the remainder and the control goes at exhaustion (D7)",
			!exhausted.timedOut &&
				exhausted.scope.ids === LAZY_GROUP_TOTAL &&
				exhausted.scope.nextCursor === null,
			`scope is ${JSON.stringify(exhausted.scope)}, expected ${LAZY_GROUP_TOTAL} ids and no cursor`,
		);
		await wait(LAZY_SETTLE_MS);
		/*
		 * AND AT EXHAUSTION THE FALLBACK IS THE GROUP'S OWN CONTROL (round 2, U2): the
		 * press's control unmounts with the cursor, so the reader must not be left on
		 * `<body>`. Recorded here rather than asserted to a single shape, because the press
		 * that consumed the control is exactly the case where the added row may not resolve.
		 */
		const activeAtEnd = await cdp.evaluate(`(() => {
			const el = document.activeElement;
			if (el === null || el === document.body) return { tag: null, disclosure: false };
			return {
				tag: el.tagName.toLowerCase(),
				disclosure: el.hasAttribute("data-disclosure"),
				label: el.getAttribute("aria-label"),
			};
		})()`);
		note("focus at exhaustion", JSON.stringify(activeAtEnd));
		check(
			"the reader is never left on `<body>` at exhaustion (U2 = F1)",
			activeAtEnd.tag !== null,
			`activeElement is ${JSON.stringify(activeAtEnd)}`,
		);
		const exhaustedFrame = await captureSettled(cdp, "group-exhausted");
		note("frame", JSON.stringify(exhaustedFrame));
	} else if (LAZY_CASE === "empty") {
		/*
		 * A SETTLED SCOPE, A NON-ZERO CENSUS, NO ROWS (round 1, U3). The group's
		 * chats are not drawable here - the ordinary reason being that they are
		 * archived - so the sentence must name that and offer the way forward. It was
		 * "Loading chats…" for as long as the census outran the page, whatever
		 * `scope.loading` said, which sat a settled group in a wait for ever.
		 */
		check(
			"a settled group the census still outruns names why, and never claims a wait",
			opened.sessionCount === LAZY_CATALOGUE_HEAD_PAGE &&
				group.badge === LAZY_GROUP_TOTAL &&
				typeof group.sentence === "string" &&
				LAZY_ARCHIVED_SENTENCE.test(group.sentence),
			`sessionCount ${opened.sessionCount}, badge ${JSON.stringify(group.badge)}, sentence ${JSON.stringify(group.sentence)}`,
		);
		/*
		 * AND THE SAME SENTENCE AT THE PANEL'S DRAG FLOOR (round 3, D17). The clamp is two
		 * lines and the designer's arithmetic said it may eat this sentence's tail at 240px;
		 * whether it does is a fact about a rendered frame, not about a sum, and the sentence
		 * is the one this state exists to say - so it gets its own narrow picture rather than
		 * being trusted at the width where it was written.
		 */
		const settledDefaultWidth = await cdp.evaluate(
			`document.querySelector('[data-sidebar-region="chats"]')?.offsetWidth ?? null`,
		);
		await setSplitPreferences(cdp, { chatSidebarWidth: 240 });
		await wait(LAZY_SETTLE_MS);
		const settledFloor = await lazyGroupFacts(cdp, LAZY_GROUP);
		const settledFloorWidth = await cdp.evaluate(
			`document.querySelector('[data-sidebar-region="chats"]')?.offsetWidth ?? null`,
		);
		check(
			"the settled sentence is whole at the panel's own floor, not clipped by the clamp",
			typeof settledFloorWidth === "number" &&
				settledFloorWidth <= 250 &&
				typeof settledFloor.sentence === "string" &&
				LAZY_ARCHIVED_SENTENCE.test(settledFloor.sentence) &&
				settledFloor.sentenceClipped === false,
			`at ${settledFloorWidth}px (from ${settledDefaultWidth}px) the group says ${JSON.stringify(settledFloor.sentence)}, clamped=${JSON.stringify(settledFloor.clamped)}`,
		);
		const settledNarrowFrame = await captureSettled(cdp, "group-open-narrow");
		note("frame", JSON.stringify(settledNarrowFrame));
		await setSplitPreferences(cdp, {
			chatSidebarWidth:
				typeof settledDefaultWidth === "number" ? settledDefaultWidth : 281,
		});
		await wait(LAZY_SETTLE_MS);
	} else if (LAZY_CASE === "loading") {
		/*
		 * THE ONE STATE IN WHICH "Loading chats…" IS TRUE (round 1, U3). Every scoped
		 * answer is held open by the stand-in, so the group is genuinely waiting: the
		 * sentence and `scope.loading` agree, which is the pair the finding was about.
		 */
		check(
			"a group whose page is in flight says it is loading",
			opened.sessionCount === LAZY_CATALOGUE_HEAD_PAGE &&
				group.sentence === "Loading chats…",
			`sessionCount ${opened.sessionCount}, sentence ${JSON.stringify(group.sentence)}`,
		);
		/*
		 * AND THE HOLD IS RELEASED IN THE SAME RUN (round 2, D12): the frame above is of a
		 * wait that is really in flight because the stand-in is holding the answer on a file,
		 * and writing that file here proves the hold released and the group drew its page -
		 * so the arm is re-shootable rather than a window the run has to hit.
		 */
		if (LAZY_HOLD !== null) {
			writeFileSync(LAZY_HOLD, "released\n");
			const drew = await waitForSessionCount(
				cdp,
				LAZY_CATALOGUE_HEAD_PAGE + LAZY_GROUP_PAGE,
			);
			const after = await lazyGroupFacts(cdp, LAZY_GROUP);
			check(
				"releasing the hold draws the group's page, so the wait was real",
				drew === LAZY_CATALOGUE_HEAD_PAGE + LAZY_GROUP_PAGE &&
					after.rows === LAZY_GROUP_PAGE,
				`sessionCount ${opened.sessionCount} -> ${drew}, rows ${after.rows}, sentence ${JSON.stringify(after.sentence)}`,
			);
			const loadedFrame = await captureSettled(cdp, "group-loaded");
			note("frame", JSON.stringify(loadedFrame));
		}
	} else if (LAZY_CASE === "empty-group") {
		/*
		 * A GENUINELY EMPTY GROUP: the page and the census agree (round 1, D3's first
		 * missing arm). "No chats yet" is the honest sentence here, and the badge is
		 * zero - which is what separates this frame from the `empty` arm's.
		 */
		check(
			"an empty group says so, and no number contradicts it",
			opened.sessionCount === LAZY_CATALOGUE_HEAD_PAGE &&
				group.sentence === "No chats yet" &&
				group.badge === null,
			`sessionCount ${opened.sessionCount}, sentence ${JSON.stringify(group.sentence)}, badge ${JSON.stringify(group.badge)} (a zero census draws no digit at all)`,
		);
	} else if (LAZY_CASE === "error") {
		// WAITED FOR, not sampled: the refusal has to travel back and be rendered, and
		// the first run of this arm read the group still saying "Loading chats…".
		/*
		 * THE ROW IS FOUND BY ITS OWN CONTROL, not by document order (round 1, D6).
		 * `document.querySelector('[data-entity]')` is the FIRST entity row on screen -
		 * an agent group - so the condition could never match the group's sentence, and
		 * the arm photographed whatever happened to be rendered when the wait gave up.
		 */
		const refused = await waitForCondition(
			cdp,
			`(() => {
				const row = document.querySelector('[data-entity]:has([data-disclosure][aria-label="Expand ${LAZY_GROUP} chats"], [data-disclosure][aria-label="Collapse ${LAZY_GROUP} chats"])');
				if (row === null) return false;
				const text = row.textContent || "";
				/*
				 * THE SHAPE OF THE REFUSAL, not a sentence this rig knows: the app quotes
				 * the backend's own text whenever the daemon authored one, so waiting for a
				 * particular string waits for something the app may never draw. What the
				 * group MUST show is a Retry, no wait and no emptiness.
				 */
				return /Retry/.test(text) && !/Loading chats…/.test(text) && !/No chats yet/.test(text);
			})()`,
			15_000,
		);
		/*
		 * STRINGIFIED, NOT COERCED (round 3, D13): `waitForCondition` answers an object, so
		 * `String(refused)` printed `[object Object]` where the note is supposed to carry the
		 * wait's own result - the waited time and the value it settled on.
		 */
		note("the refusal is on screen", JSON.stringify(refused));
		const failed = await lazyGroupFacts(cdp, LAZY_GROUP);
		/*
		 * ITS OWN FRAME, AFTER THE REFUSAL RENDERED: the `group-open` capture above is
		 * taken the moment the group opens, which in this arm is the loading state. A
		 * photograph of "Loading chats…" labelled as the error case would be a frame
		 * that does not show what its name claims.
		 */
		check(
			"the refusal is WAITED FOR rather than sampled, and says something that is neither a wait nor an emptiness",
			refused.ok === true &&
				typeof failed.sentence === "string" &&
				failed.sentence.length > 0 &&
				!LAZY_NOT_A_WAIT_OR_EMPTINESS.test(failed.sentence),
			`waited=${JSON.stringify(refused)} sentence=${JSON.stringify(failed.sentence)}`,
		);
		const errorFrame = await captureSettled(cdp, "group-error");
		note("frame", JSON.stringify(errorFrame));
		check(
			"a refused group read says so and offers its own retry",
			opened.sessionCount === LAZY_CATALOGUE_HEAD_PAGE && failed.retry !== null,
			`sessionCount ${opened.sessionCount}, retry ${JSON.stringify(failed.retry)}, sentence ${JSON.stringify(failed.sentence)}`,
		);
	} else {
		/*
		 * THE BEFORE HALF. A daemon that cannot page answers 50 rows of 120 with no
		 * cursor, so the group's 70 chats are past the cap and the panel draws the
		 * FALSE sentence over them - which is the operator's screenshot, and the reason
		 * this change exists.
		 */
		check(
			"expanding a group against a daemon that cannot page fetches nothing",
			opened.sessionCount === head.sessionCount,
			`sessionCount ${head.sessionCount} -> ${opened.sessionCount}`,
		);
		check(
			"and the withdrawn panel draws the false negative this change removes",
			group.sentence === "No chats yet",
			`sentence is ${JSON.stringify(group.sentence)}`,
		);
	}
}

/**
 * Wait for a line to appear in the stand-in's own stdout.
 *
 * WHY THE REQUEST THE DAEMON SAW IS THE INSTRUMENT HERE. The DOM cannot say which
 * page a control asked for, and `state.sessionCount` cannot either (a page whose
 * rows the client already held grows it by nothing). The daemon's request line is
 * the one place "the press asked for THAT SCOPE'S next page, with the cursor it
 * minted" is directly visible, which is the same reason `sceneRowSpace` reads
 * `--stub-log` for its write clauses.
 */
async function waitForStubLine(needle, timeoutMs = 15_000) {
	if (STUB_LOG === null) return false;
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			if (readFileSync(STUB_LOG, "utf8").includes(needle)) return true;
		} catch {
			// The file may not exist for the first moments of a run.
		}
		await wait(150);
	}
	return false;
}

/**
 * The sidebar's team/agent row, as the DOM has it.
 *
 * Read through the driver's own evaluation channel rather than through the verb
 * vocabulary, because the verb set answers about GEOMETRY and PRESSES (the app's
 * layout and input are its own) and none of them can read a sentence. This is the
 * driver looking, not the app being asked.
 */
const LAZY_GROUP_FACTS_EXPR = (name) => `(() => {
	/*
	 * THE ROW IS FOUND BY THE CONTROL IT CONTAINS, not by the text it happens to
	 * carry: the selector below matches data-entity elements that hold a
	 * data-disclosure button labelled "Expand <name> chats" - the same element the
	 * press in this scene aims at, so the row this reads is always the row that
	 * control belongs to. Matching on text found a row whose data-disclosure did not
	 * exist on the first run of this scene - a read and a press disagreeing about
	 * which node they meant.
	 */
	const row = document.querySelector(
		'[data-entity]:has([data-disclosure][aria-label="Expand ${name} chats"], [data-disclosure][aria-label="Collapse ${name} chats"])',
	);
	if (!row) return null;
	const button = row.querySelector("[data-disclosure]");
	const body = button?.parentElement?.nextElementSibling ?? null;
	const badge = [...row.querySelectorAll("span")]
		.map((el) => (el.textContent || "").trim())
		.filter((text) => /^[0-9]+$/.test(text))
		.pop() ?? null;
	const more = row.querySelector("[data-scope-more]");
	const retry = [...(body?.querySelectorAll("button") ?? [])]
		.map((el) => (el.textContent || "").trim())
		.find((text) => text === "Retry") ?? null;
	return {
		badge: badge === null ? null : Number(badge),
		more: more === null ? null : (more.textContent || "").trim(),
		retry,
		rows: body === null ? 0 : body.querySelectorAll("[data-session-row]").length,
		/*
		 * THE SENTENCE IS READ FROM ITS OWN ELEMENT, not matched against a list of the
		 * strings this rig expects. The refusal's sentence is the BACKEND'S own text
		 * whenever the daemon authored one (the app quotes it rather than paraphrasing),
		 * so a list of expected sentences is a list this reader would silently stop
		 * recognising the moment the daemon says something new - which is exactly how
		 * the error arm read a null sentence while the group was drawing one.
		 */
		sentence: (() => {
			const el = body?.querySelector("p") ?? null;
			const text = el === null ? "" : (el.textContent || "").trim();
			return text === "" ? null : text;
		})(),
		/*
		 * WHETHER THE SENTENCE THE READER READS IS THE WHOLE SENTENCE (round 3, D17). The
		 * clamp is two lines, so an element whose scrollHeight exceeds its clientHeight is
		 * an element that ate its own tail - the one fact a picture at the panel's floor is
		 * meant to settle, and one a text extraction cannot see.
		 */
		sentenceClipped: (() => {
			const el = body?.querySelector("p") ?? null;
			if (el === null) return null;
			return el.scrollHeight > el.clientHeight + 1;
		})(),
	};
})()`;

const lazyGroupFacts = (cdp, name) => cdp.evaluate(LAZY_GROUP_FACTS_EXPR(name));

/**
 * The store's row count, WAITED FOR rather than read once.
 *
 * A page arrives on the app's own schedule, so a scene that reads the count the
 * instant after a press is asserting a race it happens to win: this scene's first
 * run read `75 -> 75` for an extension the stand-in had ALREADY answered (its log
 * shows the `cursor=off:25` request), which is a fact about the harness and not
 * about the panel. Polling the number is what makes the claim about the feature.
 */
/**
 * The scope's own state, WAITED FOR rather than sampled.
 *
 * WHY THIS REPLACED A READ-BACK AND A ROW COUNT. `state.sessionCount` is a PROXY
 * for "the extension landed" and a bad one: a page whose rows the client already
 * holds grows it by nothing, so a passing extension and a dropped answer are
 * indistinguishable through it. The scope's own `ids` and `nextCursor` are the
 * claim itself. And the read has to be BOUNDED POLLING, not a read after a fixed
 * sleep: the two are indistinguishable in a single sample, which is exactly how
 * this step reported a discrepancy for a whole session's worth of runs.
 */
async function waitForScopeIds(cdp, key, atLeast, timeoutMs = 10_000) {
	const started = Date.now();
	let scope = (await verb(cdp, "state")).scopes[key] ?? null;
	while (Date.now() - started < timeoutMs) {
		if (scope !== null && scope.ids >= atLeast)
			return { scope, timedOut: false };
		await wait(100);
		scope = (await verb(cdp, "state")).scopes[key] ?? null;
	}
	return { scope, timedOut: true };
}

/**
 * The daemon's own lines for one scope, as the failure message's evidence.
 *
 * A timeout is not a verdict on its own: the two remaining explanations are "the
 * request never left" and "it left, was answered, and the answer did not reach
 * the store". The `rows=` the stand-in now logs with each answer is what tells
 * them apart, so the failure carries those lines rather than an assertion.
 */
function stubLinesForScope(path, name) {
	if (STUB_LOG === null) return [];
	try {
		return readFileSync(STUB_LOG, "utf8")
			.split("\n")
			.filter((line) => line.includes(`scope_name=${name}`))
			.slice(-4);
	} catch {
		return [];
	}
}

async function waitForSessionCount(cdp, atLeast, timeoutMs = 15_000) {
	const started = Date.now();
	let last = 0;
	while (Date.now() - started < timeoutMs) {
		last = (await verb(cdp, "state")).sessionCount;
		if (last >= atLeast) return last;
		await wait(200);
	}
	return last;
}

async function sceneSidebarSplit(cdp, handle) {
	/* The live connection, which becomes a NEW one after the restart below. */
	let link = cdp;
	const wide = { chatSidebarWidth: 360, themeName: "localOperatorDark" };
	const narrow = { chatSidebarWidth: 240, themeName: "localOperatorDark" };
	const light = { chatSidebarWidth: 360, themeName: "localOperatorLight" };

	// --- 1. the panel at rest, both regions, nothing revealed ---------------
	await setSplitPreferences(cdp, { ...wide, chatSidebarRegions: "both" });
	await parkPointer(cdp);
	await capture(cdp, "split-rest-360-dark");
	const atRest = await splitPreferences(cdp);
	note("preferences at rest", JSON.stringify(atRest.state));

	// --- 2. the centre of the band, and what a gesture there finds ----------
	const separator = await splitBox(cdp, SPLIT_SEPARATOR);
	require("the boundary is drawn at rest", separator !==
		null, "no separator: the split needs both regions and a backend that advertises the catalogue");
	const centre = await splitHit(cdp, separator.x, separator.y);
	note("the element at the band's centre", JSON.stringify(centre));
	check(
		"the band's CENTRE is the separator rather than a control",
		centre !== null &&
			centre.inSeparator === true &&
			centre.inCluster === false,
		JSON.stringify(centre),
	);

	// --- 3. the reveal, inside the intent window and after it ---------------
	/*
	 * THE TIMING IS READ, NOT PHOTOGRAPHED, and that is the honest instrument for
	 * it: `Page.captureScreenshot` takes longer than the intent window, so a frame
	 * taken "inside" it can show the plate already up - which is what the first
	 * version of this scene did, and it reported the opposite of the truth on one
	 * run and the truth on the next. Two reads of the same DOM attribute, one the
	 * moment the pointer arrives and one after the window has passed, settle it
	 * deterministically; the frames below are then a pair of the fade itself.
	 *
	 * The claim being checked is review round 1's M-1: the plate and the line are
	 * revealed by ONE intent, so the controls cannot appear a beat before the line
	 * that says the boundary is live.
	 */
	await movePointer(cdp, separator.x, separator.y);
	const arrivedCluster = await cdp.evaluate(
		`document.querySelector(${JSON.stringify(SPLIT_CLUSTER_REVEALED)}) !== null`,
	);
	check(
		"the cluster is NOT revealed the moment the pointer arrives",
		arrivedCluster === false,
		`cluster revealed=${arrivedCluster}`,
	);
	await wait(120);
	const insideCluster = await cdp.evaluate(
		`document.querySelector(${JSON.stringify(SPLIT_CLUSTER_REVEALED)}) !== null`,
	);
	check(
		"120ms in - inside the intent window - it is still hidden",
		insideCluster === false,
		`cluster revealed=${insideCluster}`,
	);
	await wait(140);
	const early = await capture(cdp, "split-reveal-early-dark");
	note("the first reveal frame, one frame into the fade", early.path);
	await wait(320);
	await captureSettled(cdp, "split-reveal-settled-dark");
	const settledCluster = await cdp.evaluate(
		`document.querySelector(${JSON.stringify(SPLIT_CLUSTER_REVEALED)}) !== null`,
	);
	check(
		"after the intent, the cluster IS revealed",
		settledCluster === true,
		`cluster revealed=${settledCluster}`,
	);

	// --- 4. a tooltip, which is the only naming a sighted user gets ---------
	const orderControl = await splitBox(cdp, "[data-sidebar-order]");
	if (orderControl !== null) {
		await movePointer(cdp, orderControl.x, orderControl.y);
		await wait(900);
		await capture(cdp, "split-tooltip-dark");
	}

	// --- 5. the drag, and the line it paints while it runs ------------------
	await parkPointer(cdp);
	const before = await splitPreferences(cdp);
	await movePointer(cdp, separator.x, separator.y);
	await dragSplit(cdp, separator.x, separator.y, 90, {
		hold: async () => {
			await capture(cdp, "split-drag-line-dark");
		},
	});
	const afterDrag = await splitPreferences(cdp);
	note(
		"stored height before the drag",
		String(before.state?.chatSidebarListHeight),
	);
	note(
		"stored height after the drag",
		String(afterDrag.state?.chatSidebarListHeight),
	);
	check(
		"a drag at the band's centre WRITES a height",
		typeof afterDrag.state?.chatSidebarListHeight === "number" &&
			afterDrag.state.chatSidebarListHeight !==
				before.state?.chatSidebarListHeight,
		`${before.state?.chatSidebarListHeight} -> ${afterDrag.state?.chatSidebarListHeight}`,
	);
	await captureSettled(cdp, "split-dragged-dark");
	const drawn = await splitBox(cdp, SPLIT_CHATS);
	const announced = await cdp.evaluate(
		`(() => {
			const node = document.querySelector(${JSON.stringify(SPLIT_SEPARATOR)});
			return node === null ? null : node.getAttribute("aria-valuenow");
		})()`,
	);
	check(
		"the separator announces the height the region is drawn at",
		drawn !== null &&
			announced !== null &&
			Math.abs(Number(announced) - drawn.height) <= 1,
		`aria-valuenow ${announced} against a drawn ${drawn?.height}`,
	);

	// --- 6. the collapse, its persistence, and the way back -----------------
	const hide = await splitBox(cdp, '[data-sidebar-hide="chats"]');
	require("the hide control is on the revealed cluster", hide !==
		null, "no [data-sidebar-hide=chats] control");
	await movePointer(cdp, hide.x, hide.y);
	await wait(320);
	await pressPointerStationary(cdp, hide.x, hide.y);
	await wait(320);
	const collapsed = await splitPreferences(cdp);
	check(
		"the collapse is PERSISTED",
		collapsed.state?.chatSidebarRegions === "entities",
		String(collapsed.state?.chatSidebarRegions),
	);
	const chatsGone = await cdp.evaluate(
		`document.querySelector(${JSON.stringify(SPLIT_CHATS)}) === null`,
	);
	check(
		"the collapsed region is UNMOUNTED",
		chatsGone === true,
		`unmounted=${chatsGone}`,
	);
	await captureSettled(cdp, "split-collapsed-dark");

	const restore = await splitBox(cdp, "[data-sidebar-restore]");
	require("the restore row is drawn", restore !==
		null, "no [data-sidebar-restore] row");
	const restoreText = await cdp.evaluate(
		`document.querySelector("[data-sidebar-restore]").textContent.trim()`,
	);
	note("the restore row reads", restoreText);
	await pressPointerStationary(cdp, restore.x, restore.y);
	await wait(320);
	const restored = await splitPreferences(cdp);
	check(
		"the restore row brings the region back and persists it",
		restored.state?.chatSidebarRegions === "both",
		String(restored.state?.chatSidebarRegions),
	);
	await captureSettled(cdp, "split-restored-dark");

	// --- 7. U1's SECOND LIMB, asserted: a press that travels does not act ----
	/*
	 * The click-cancel is half of what U1 asked for and was asserted nowhere:
	 * `CONTROL_PRESS_SLOP_PX` appeared once in the tree, at its definition, so a
	 * regression that deleted the whole mechanism (leaving only the trailing-end
	 * placement) would have kept every committed check green while a drag starting
	 * on the plate collapsed a region again (agent review round 2, m-3). The
	 * gesture below is the one a user makes when they reach for the divider and
	 * land on a control: press, travel 20px, release.
	 */
	const travelFrom = await splitBox(cdp, '[data-sidebar-hide="chats"]');
	require("the travel probe has a control to press", travelFrom !==
		null, "no [data-sidebar-hide=chats] control to press");
	const regionsBeforeTravel = (await splitPreferences(cdp)).state
		?.chatSidebarRegions;
	await movePointer(cdp, travelFrom.x, travelFrom.y);
	await wait(320);
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: travelFrom.x,
		y: travelFrom.y,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	for (const travelled of [4, 8, 12, 16, 20]) {
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: travelFrom.x + travelled,
			y: travelFrom.y + travelled,
			button: "left",
			buttons: 1,
		});
		await wait(20);
	}
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: travelFrom.x + 20,
		y: travelFrom.y + 20,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	await wait(320);
	const afterTravel = (await splitPreferences(cdp)).state?.chatSidebarRegions;
	check(
		"a press that travels 20px off a boundary control does not act",
		afterTravel === regionsBeforeTravel,
		`regions ${regionsBeforeTravel} -> ${afterTravel} (the click-cancel is what makes this safe)`,
	);
	const regionsDrawn = await cdp.evaluate(
		`document.querySelectorAll("[data-sidebar-region]").length`,
	);
	check(
		"and both regions are still drawn",
		regionsDrawn === 2,
		`regions drawn: ${regionsDrawn}`,
	);

	// --- 8. the keyboard path: focus, Home, and the write it makes ----------
	await cdp.evaluate(
		`document.querySelector(${JSON.stringify(SPLIT_SEPARATOR)}).focus(); true`,
	);
	const focused = await cdp.evaluate(
		`document.activeElement === document.querySelector(${JSON.stringify(SPLIT_SEPARATOR)})`,
	);
	check("the separator can take focus", focused === true, `focused=${focused}`);
	await pressChord(cdp, { key: "Home", code: "Home", virtualKeyCode: 36 });
	await wait(250);
	await captureSettled(cdp, "split-keyboard-home-dark");
	const afterHome = await splitPreferences(cdp);
	note(
		"stored height after Home",
		String(afterHome.state?.chatSidebarListHeight),
	);

	// --- 9. the swap, and the two scroll positions it must not lose ---------
	/*
	 * TWO readings, because the swap can lose two different things and only one of
	 * them is always measurable.
	 *
	 * The mechanism review round 1 (U2) found is NODE IDENTITY: unkeyed, React
	 * reconciles the two positions in place, so the element that was the entity
	 * region becomes the chats region and inherits its content. That is measurable
	 * whatever the content is, so each node is tagged before the swap and asked
	 * again after it.
	 *
	 * The user-visible consequence is the scroll position, and that one is only
	 * measurable when BOTH regions overflow - a region given more height than its
	 * content simply clamps to 0 at any scrollTop, which is a true reading of a
	 * layout with nothing to scroll rather than a lost position. This run's backend
	 * has six conversations and no agents, so the chats region is the one that
	 * overflows; the entity region's reading is reported either way.
	 */
	const beforeSwap = await cdp.evaluate(`(() => {
		const entities = document.querySelector(${JSON.stringify(SPLIT_ENTITIES)});
		const chats = document.querySelector(${JSON.stringify(SPLIT_CHATS)});
		if (entities) {
			entities.dataset.splitProbe = "entities-node";
			entities.scrollTop = 24;
		}
		if (chats) {
			chats.dataset.splitProbe = "chats-node";
			chats.scrollTop = 12;
		}
		return {
			probe: {
				entities: entities?.dataset.splitProbe ?? null,
				chats: chats?.dataset.splitProbe ?? null,
			},
			scroll: { entities: entities?.scrollTop ?? null, chats: chats?.scrollTop ?? null },
			overflow: {
				entities: entities ? entities.scrollHeight > entities.clientHeight : null,
				chats: chats ? chats.scrollHeight > chats.clientHeight : null,
			},
		};
	})()`);
	const swap = await splitBox(cdp, "[data-sidebar-order]");
	require("the order control is on the cluster", swap !==
		null, "no [data-sidebar-order]");
	await movePointer(cdp, swap.x, swap.y);
	await wait(320);
	await pressPointerStationary(cdp, swap.x, swap.y);
	await wait(400);
	const swapped = await splitPreferences(cdp);
	check(
		"the swap is PERSISTED",
		swapped.state?.chatSidebarOrder === "chats-first",
		String(swapped.state?.chatSidebarOrder),
	);
	const order = await cdp.evaluate(`(() => {
		const regions = [...document.querySelectorAll("[data-sidebar-region]")];
		return regions.map((node) => node.dataset.sidebarRegion);
	})()`);
	check(
		"the chats region is drawn FIRST after the swap",
		Array.isArray(order) && order[0] === "chats" && order[1] === "entities",
		JSON.stringify(order),
	);
	const afterSwap = await cdp.evaluate(`(() => {
		const entities = document.querySelector(${JSON.stringify(SPLIT_ENTITIES)});
		const chats = document.querySelector(${JSON.stringify(SPLIT_CHATS)});
		return {
			probe: {
				entities: entities?.dataset.splitProbe ?? null,
				chats: chats?.dataset.splitProbe ?? null,
			},
			scroll: { entities: entities?.scrollTop ?? null, chats: chats?.scrollTop ?? null },
			overflow: {
				entities: entities ? entities.scrollHeight > entities.clientHeight : null,
				chats: chats ? chats.scrollHeight > chats.clientHeight : null,
			},
		};
	})()`);
	note(
		"node identity across the swap",
		`${JSON.stringify(beforeSwap.probe)} -> ${JSON.stringify(afterSwap.probe)}`,
	);
	check(
		"each region keeps its OWN DOM node across the swap",
		afterSwap.probe.entities === "entities-node" &&
			afterSwap.probe.chats === "chats-node",
		`${JSON.stringify(beforeSwap.probe)} -> ${JSON.stringify(afterSwap.probe)}`,
	);
	note(
		"scroll positions across the swap",
		`${JSON.stringify(beforeSwap.scroll)} -> ${JSON.stringify(afterSwap.scroll)} (overflowing: ${JSON.stringify(beforeSwap.overflow)})`,
	);
	/*
	 * PER REGION, and conditioned on the region still overflowing: a region given
	 * more height than its content holds is not a lost position, it is a clamp - it
	 * has nowhere left to scroll. The first version of this check asserted the
	 * CHATS region's number alone, which passed because that region is the one with
	 * a single row's worth of content; the reading it threw away
	 * (`entities: 24 -> 0` with the entity region overflowing before the swap) is
	 * the one that says whether a real position was lost, so it is read on both
	 * sides now.
	 */
	for (const region of ["entities", "chats"]) {
		const stillOverflows =
			beforeSwap.overflow[region] === true &&
			afterSwap.overflow[region] === true;
		check(
			`a ${region} region that still overflows keeps its scroll position`,
			!stillOverflows || afterSwap.scroll[region] === beforeSwap.scroll[region],
			`${region} ${beforeSwap.scroll[region]} -> ${afterSwap.scroll[region]}, ` +
				`overflow ${beforeSwap.overflow[region]} -> ${afterSwap.overflow[region]}`,
		);
	}
	await captureSettled(cdp, "split-swapped-dark");
	/*
	 * Back to the SHIPPED ORDER as well as the wide width, because the frames that
	 * follow are captioned as the default layout: left swapped, they would be
	 * photographs of `chats-first` under an `entities-first` caption, which is the
	 * evidence defect this whole directory exists to avoid.
	 */
	await setSplitPreferences(cdp, {
		...wide,
		chatSidebarRegions: "both",
		chatSidebarOrder: "entities-first",
	});

	// --- 10. the panel at its width clamp -----------------------------------
	await setSplitPreferences(cdp, {
		...narrow,
		chatSidebarRegions: "both",
		chatSidebarOrder: "entities-first",
		/*
		 * AUTO, not the extreme the keyboard step above left: this pair's claim is
		 * about WIDTH and the room the plate has at it, and a state inherited from a
		 * `Home` press is neither (design round 2, D9).
		 */
		chatSidebarListHeight: null,
	});
	await parkPointer(cdp);
	await captureSettled(cdp, "split-rest-240-dark");
	const narrowSeparator = await splitBox(cdp, SPLIT_SEPARATOR);
	if (narrowSeparator !== null) {
		await movePointer(cdp, narrowSeparator.x, narrowSeparator.y);
		await wait(420);
		await captureSettled(cdp, "split-reveal-240-dark");
	}

	// --- 11. the second brand palette ---------------------------------------
	await setSplitPreferences(cdp, {
		...light,
		chatSidebarRegions: "both",
		chatSidebarOrder: "entities-first",
		/*
		 * AUTO, so this pair is the RESTING state its captions claim.
		 *
		 * Taken as the runs before it left the split, the light frames photographed
		 * the clamped top-of-range state the drag and the `Home` press had just
		 * written - a region at its 72px floor while the captions said "the resting
		 * state in the second brand palette" (design round 2, D9). The state is
		 * reset rather than the caption weakened, because the palette half of D1
		 * needs the two palettes photographed in the SAME state to be comparable at
		 * all.
		 */
		chatSidebarListHeight: null,
	});
	await parkPointer(cdp);
	await captureSettled(cdp, "split-rest-360-light");
	const lightSeparator = await splitBox(cdp, SPLIT_SEPARATOR);
	if (lightSeparator !== null) {
		await movePointer(cdp, lightSeparator.x, lightSeparator.y);
		await wait(420);
		await captureSettled(cdp, "split-reveal-settled-light");
	}

	// --- 12. the restart: a stored height and a collapse that SURVIVE -------
	await setSplitPreferences(cdp, {
		...wide,
		chatSidebarRegions: "both",
		chatSidebarOrder: "entities-first",
	});
	const heightBefore = await splitPreferences(cdp);
	await movePointer(
		cdp,
		(await splitBox(cdp, SPLIT_SEPARATOR)).x,
		(await splitBox(cdp, SPLIT_SEPARATOR)).y,
	);
	await dragSplit(
		cdp,
		(await splitBox(cdp, SPLIT_SEPARATOR)).x,
		(await splitBox(cdp, SPLIT_SEPARATOR)).y,
		64,
	);
	const hideAgain = await splitBox(cdp, '[data-sidebar-hide="chats"]');
	if (hideAgain !== null) {
		await movePointer(cdp, hideAgain.x, hideAgain.y);
		await wait(320);
		await pressPointerStationary(cdp, hideAgain.x, hideAgain.y);
		await wait(320);
	}
	const beforeRestart = await splitPreferences(cdp);
	note("before the restart", JSON.stringify(beforeRestart.state));

	/*
	 * The second boot, in the SAME scratch profile. `launchApp` reuses the run's
	 * profile and home by construction, and the earlier handle is stopped by exact
	 * pid first - a restart is two processes, and the second must be the one this
	 * run owns.
	 */
	const firstPid = handle.pid;
	await stopApp(handle);
	/*
	 * THE SAME TAG, and therefore the same `--user-data-dir`: `launchApp` builds the
	 * profile as `${USER_DATA}-${tag}`, so a restart under a new tag is a restart
	 * into a NEW profile - which is what the first version of this scene did, and it
	 * read an empty store on the second boot and failed its own claim. The tag is
	 * what pins the profile, and the single-instance lock it also carries is free
	 * because the first boot has been stopped, by exact pid, one line above.
	 */
	const profile = `${USER_DATA}-scene`;
	const again = await launchApp({
		armed: true,
		logName: "app-scene-restart.log",
		tag: "scene",
	});
	/*
	 * The module-level handle moves to the SECOND boot, because that is the
	 * process this run must reap: the first was stopped by exact pid just above,
	 * and the teardown's own check is "nothing is left carrying this run's tag".
	 * `link` is a local rather than a reassignment of the parameter, which the
	 * repo's lint refuses and which would also leave the caller's variable stale.
	 */
	app = again;
	await waitForDevtools(again);
	link.close();
	link = await CdpClient.attach(again.port, "out/renderer/index.html");
	await waitForBridge(link);
	await wait(900);
	await parkPointer(link);
	const afterRestart = await splitPreferences(link);
	note("the restart's profile, unchanged by construction", profile);
	note("the restart's pid", `${firstPid} -> ${again.pid}`);
	note("after the restart", JSON.stringify(afterRestart.state));
	check(
		"the restart is a different process",
		again.pid !== firstPid,
		`${firstPid} -> ${again.pid}`,
	);
	check(
		"the stored height survives the restart",
		afterRestart.state?.chatSidebarListHeight ===
			beforeRestart.state?.chatSidebarListHeight,
		`${beforeRestart.state?.chatSidebarListHeight} -> ${afterRestart.state?.chatSidebarListHeight}`,
	);
	check(
		"the collapse survives the restart",
		afterRestart.state?.chatSidebarRegions === "entities",
		String(afterRestart.state?.chatSidebarRegions),
	);
	const stillCollapsed = await link.evaluate(
		`document.querySelector(${JSON.stringify(SPLIT_ENTITIES)}) !== null && document.querySelector(${JSON.stringify(SPLIT_CHATS)}) === null`,
	);
	check(
		"the restarted app DRAWS the collapsed state",
		stillCollapsed === true,
		`collapsed again drawn=${stillCollapsed}`,
	);
	await captureSettled(link, "split-restart-restored-dark");
	return link;
}

/**
 * The one sidebar's TWO SECTIONS and the boundary between them, as the operator
 * asked for them on the preview (2026-09-24): Agents + Teams and Chats both
 * VISIBLE, sized RELATIVE to each other by a drag, the size PERSISTED - plus the
 * bubbled brand mark at the three places it leads a surface.
 *
 * WHY A SCENE BESIDE `sidebar-split` RATHER THAN MORE STEPS IN IT. That scene
 * walks the boundary's own controls (the intent-gated plate, collapse, restore,
 * swap) from a column it FORCES to "both"; the claim here is about the column
 * nobody has touched, so this scene deliberately writes NOTHING to the regions
 * before its first frame - the default is the subject. Its frames are the evidence
 * for the default, the two drag positions, the floors, the keyboard and the
 * relaunch, in both brand palettes.
 *
 * It seeds the backend with an agent, a team and a handful of chats first, because
 * both sections have to have rows for "visible sections" to mean anything - an empty
 * catalogue would photograph two headings.
 */
/**
 * THE SIDEBAR'S ONE SCROLLER, measured rather than argued.
 *
 * WHY THIS EXISTS. The operator caught three scrollbars in one column on the running
 * app - one on the sidebar's outer edge spanning its whole height, one inside the
 * Agents section and one inside the chats section - and the cause was a CSS trap
 * rather than a layout intent: `overflow-x-hidden` on the column's own div computes
 * `overflow-y: auto` (CSS 2.1 §11.1.1), so the column became a scroller wrapping the
 * two its sections carry. A wheel event then has no unambiguous target, and the fixed
 * chrome can be scrolled out from under the pointer.
 *
 * WHAT IT REPORTS: the column's own scroll box, every ancestor's, every scroller in
 * the sidebar subtree by name, the document's, the y of each fixed chrome row, and -
 * per region - whether a point inside it has exactly one scrollable ancestor. The
 * assertions are the driver's, so a later edit that re-introduces an outer scroller
 * fails a check rather than being read off a frame.
 */
const sidebarScrollFacts = (cdp) =>
	cdp.evaluate(`(() => {
		const box = (el) => { const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height) }; };
		const scroller = (el) => { const s = getComputedStyle(el); return (s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1; };
		const name = (el) => el.getAttribute("data-sidebar-region") || el.getAttribute("data-sidebar-shell") !== null && "shell" || el.id || el.tagName + "." + String(el.className || "").split(" ").slice(0, 3).join(".").slice(0, 40);
		const shell = document.querySelector("[data-sidebar-shell]");
		const nav = document.querySelector('nav[aria-label="Chats"]');
		const strip = document.querySelector("[data-sidebar-strip]");
		const root = shell ?? strip ?? null;
		const inner = [];
		if (root) {
			root.querySelectorAll("*").forEach((el) => { if (scroller(el)) inner.push(name(el)); });
			if (scroller(root)) inner.push(name(root));
		}
		const chain = [];
		for (let el = root; el && el !== document.body; el = el.parentElement) {
			const s = getComputedStyle(el);
			chain.push({ tag: el.tagName, oy: s.overflowY, client: el.clientHeight, scroll: el.scrollHeight, scrollable: scroller(el) });
		}
		/*
		 * POINTWISE: how many scrollable elements the point at the centre of each
		 * region sits inside. One means the wheel has one target; two is the defect
		 * this check exists for; nought means the pane cannot be scrolled at all.
		 */
		const at = (el) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			const x = Math.round(r.x + r.width / 2);
			const y = Math.round(r.y + Math.min(r.height / 2, 80));
			const under = document.elementsFromPoint(x, y).filter(scroller).map(name);
			return { x, y, scrollableUnder: under, scrollTop: Math.round(el.scrollTop) };
		};
		const scrollTop = (sel) => { const el = document.querySelector(sel); return el === null ? null : Math.round(el.scrollTop); };
		return {
			shell: shell ? { oy: getComputedStyle(shell).overflowY, client: shell.clientHeight, scroll: shell.scrollHeight, scrollTop: Math.round(shell.scrollTop) } : null,
			strip: strip ? { oy: getComputedStyle(strip).overflowY, client: strip.clientHeight, scroll: strip.scrollHeight, scrollTop: Math.round(strip.scrollTop) } : null,
			nav: nav ? { client: nav.clientHeight, scroll: nav.scrollHeight, oy: getComputedStyle(nav).overflowY, scrollTop: Math.round(nav.scrollTop) } : null,
			inner,
			chain,
			document: { client: document.scrollingElement.clientHeight, scroll: document.scrollingElement.scrollHeight, scrollTop: Math.round(document.scrollingElement.scrollTop) },
			chrome: {
				brand: (() => { const n = document.querySelector("[data-brand-mark]"); return n === null ? null : box(n); })(),
				newChat: (() => { const n = document.querySelector("[data-new-chat-row]"); return n === null ? null : box(n); })(),
				search: (() => { const n = document.querySelector("[data-command-palette-trigger]"); return n === null ? null : box(n); })(),
				destinations: (() => { const n = document.querySelector('[data-tour-tag="nav-item-browser"]'); return n === null ? null : box(n); })(),
			},
			entities: at(document.querySelector('[data-sidebar-region="entities"]')),
			chats: at(document.querySelector('[data-sidebar-region="chats"]')),
			/*
			 * THE BOX TREE, for the case where an element reports more content than it
			 * has box: scrollHeight alone says an ancestor overflows, and only the
			 * children's own heights say WHICH one. Cheap enough to carry always, and
			 * the note is what a reader needs when a check fails at 3am.
			 */
			boxes: (() => {
				const detail = (el) => {
					if (el === null) return null;
					const r = el.getBoundingClientRect();
					const st = getComputedStyle(el);
					return {
						name: name(el),
						top: Math.round(r.top),
						h: Math.round(r.height),
						client: el.clientHeight,
						scroll: el.scrollHeight,
						css: st.height + "/" + st.minHeight + "/" + st.maxHeight + "/" + st.flex,
					};
				};
				const nodes = [];
				if (nav) {
					nodes.push(detail(nav));
					for (const child of nav.children) nodes.push(detail(child));
					const split = nav.querySelector("div[data-sidebar-split]")?.parentElement ?? null;
					if (split) { nodes.push(detail(split)); for (const child of split.children) nodes.push(detail(child)); }
				}
				return nodes;
			})(),
			/*
			 * WHAT LEAKS OUT OF THE PANEL. scrollHeight on an ancestor says SOMETHING
			 * pokes past it and this says which element: every descendant whose box
			 * crosses the panel's own bottom edge and which is not clipped by a
			 * scrollable ancestor in between (those are contained by their scroller and
			 * are not the leak). The list is short by construction - a leak is a defect -
			 * so it is printed whole.
			 */
			leaks: (() => {
				if (!nav) return [];
				const navBox = nav.getBoundingClientRect();
				const clipped = (el) => {
					for (let p = el.parentElement; p && p !== nav; p = p.parentElement) {
						const s = getComputedStyle(p);
						if (s.overflowY !== "visible") return true;
					}
					return false;
				};
				const out = [];
				for (const el of nav.querySelectorAll("*")) {
					if (out.length > 12) break;
					const r = el.getBoundingClientRect();
					if (r.height === 0) continue;
					if (r.bottom <= navBox.bottom + 1) continue;
					if (clipped(el)) continue;
					out.push({ name: name(el), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), over: Math.round(r.bottom - navBox.bottom) });
				}
				return out;
			})(),
		};
	})()`);

/**
 * WHICH CHILD OWNS THE PANEL'S OVERFLOW, when the panel reports any.
 *
 * A number that is too big says something pokes out; it does not say what. This
 * hides each of the panel's own children in turn (and, one level down, the
 * boundary container's) and reports what the panel's scrollHeight does without it,
 * restoring the DOM between probes - so the answer is a delta rather than a guess,
 * and the DOM is exactly as it was when the frame is taken.
 */
const diagnoseSidebarOverflow = (cdp) =>
	cdp.evaluate(`(() => {
		const nav = document.querySelector('nav[aria-label="Chats"]');
		if (!nav) return null;
		const describe = (el) => el.tagName + "." + String(el.className || "").split(" ").slice(0, 3).join(".").slice(0, 44);
		/*
		 * Follow the drop down the tree: at each level hide each child in turn and
		 * keep the one whose absence shrinks the PANEL, then descend into it. Three
		 * levels is enough to reach a region's own scroll box, and the chain is what
		 * a reader needs - the element that owns the overflow is on it.
		 */
		const chain = [];
		let container = nav;
		for (let depth = 0; depth < 4; depth += 1) {
			const target = nav.scrollHeight;
			let found = null;
			for (const child of container.children) {
				const shown = child.style.display;
				child.style.display = "none";
				const without = nav.scrollHeight;
				child.style.display = shown;
				const drop = target - without;
				if (drop <= 0) continue;
				const entry = {
					depth,
					name: describe(child),
					drop,
					h: Math.round(child.getBoundingClientRect().height),
					client: child.clientHeight,
					scroll: child.scrollHeight,
					overflow: getComputedStyle(child).overflowY,
					position: getComputedStyle(child).position,
				};
				chain.push(entry);
				if (found === null || drop > found.drop) found = { drop, child };
			}
			if (found === null) break;
			container = found.child;
		}
		/*
		 * AND WHAT WOULD CONTAIN IT. The panes are scroll containers, yet their scrolled
		 * content still inflates the PANEL's scrollHeight in this Chromium - so this
		 * measures the panel under each candidate containment rule and restores the DOM
		 * between probes. The answer decides the fix rather than a theory of the
		 * browser deciding it.
		 */
		const shell = document.querySelector("[data-sidebar-shell]");
		const panes = [...nav.querySelectorAll('[data-sidebar-region]')];
		const candidates = [
			["panes: position relative", () => panes.forEach((el) => { el.style.position = "relative"; })],
			["panes: contain paint", () => panes.forEach((el) => { el.style.contain = "paint"; })],
			["panes: overflow hidden", () => panes.forEach((el) => { el.style.overflow = "hidden"; })],
			["nav: position relative (already)", () => {}],
			["shell: overflow clip", () => { if (shell) shell.style.overflow = "clip"; }],
			["shell: contain paint", () => { if (shell) shell.style.contain = "paint"; }],
		];
		const probe = [];
		for (const [label, apply] of candidates) {
			const before = [nav.scrollHeight, shell ? shell.scrollHeight : null];
			apply();
			probe.push({ label, nav: nav.scrollHeight, shell: shell ? shell.scrollHeight : null, before });
			// Restore: the inline styles this probe wrote are the only ones removed.
			panes.forEach((el) => { el.style.position = ""; el.style.contain = ""; el.style.overflow = ""; });
			if (shell) shell.style.overflow = ""; if (shell) shell.style.contain = "";
		}
		return { nav: nav.clientHeight + "/" + nav.scrollHeight, chain, probe };
	})()`);

/** One wheel notch at a point, through CDP's own input pipeline. */
async function wheelAt(cdp, x, y, deltaY) {
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		x,
		y,
		deltaX: 0,
		deltaY,
		buttons: 0,
	});
	await wait(260);
}

/**
 * The scroll contract for ONE state, asserted: the column never scrolls, the panes
 * below the boundary are the only scrollers, each point has at most one scrollable
 * element over it, and a wheel over a pane moves THAT pane and nothing else - never
 * the chrome, never the other pane, never the column.
 */
async function checkSidebarScroll(cdp, state) {
	const facts = await sidebarScrollFacts(cdp);
	note(`scroll facts, ${state}`, JSON.stringify(facts));
	const root = facts.shell ?? facts.strip;
	const chromeBefore = facts.chrome;
	check(
		`${state}: neither the sidebar's container nor its panel scrolls`,
		root !== null &&
			root.scroll === root.client &&
			(facts.nav === null || facts.nav.scroll === facts.nav.client) &&
			facts.document.scroll === facts.document.client,
		JSON.stringify({
			shell: facts.shell,
			strip: facts.strip,
			nav: facts.nav,
			document: facts.document,
		}),
	);
	if (
		(root !== null && root.scroll !== root.client) ||
		(facts.nav !== null && facts.nav.scroll !== facts.nav.client)
	) {
		note(
			`overflow diagnosis, ${state}`,
			JSON.stringify(await diagnoseSidebarOverflow(cdp)),
		);
	}
	check(
		`${state}: no ancestor of the sidebar is a scroller`,
		facts.chain.every((el) => !el.scrollable),
		JSON.stringify(facts.chain.filter((el) => el.scrollable)),
	);
	check(
		`${state}: at most one scrollable element under a point in either pane`,
		(facts.entities?.scrollableUnder.length ?? 0) <= 1 &&
			(facts.chats?.scrollableUnder.length ?? 0) <= 1,
		JSON.stringify({
			entities: facts.entities?.scrollableUnder,
			chats: facts.chats?.scrollableUnder,
		}),
	);

	/*
	 * THE WHEEL, over each pane in turn. Where a pane's own content overflows this
	 * asserts it MOVED and nothing else did; where it fits, it asserts nothing moved
	 * at all - which is the state the operator's "if a section's content fits, it has
	 * no scrollbar" asks for.
	 */
	for (const [pane, point, selector] of [
		["chats", facts.chats, SPLIT_CHATS],
		["entities", facts.entities, SPLIT_ENTITIES],
	]) {
		if (point === null) continue;
		const before = await sidebarScrollFacts(cdp);
		const beforeTop = await cdp.evaluate(
			`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el === null ? null : Math.round(el.scrollTop); })()`,
		);
		await wheelAt(cdp, point.x, point.y, 240);
		const after = await sidebarScrollFacts(cdp);
		const afterTop = await cdp.evaluate(
			`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el === null ? null : Math.round(el.scrollTop); })()`,
		);
		const others = [
			["entities", SPLIT_ENTITIES],
			["chats", SPLIT_CHATS],
		].filter(([, sel]) => sel !== selector);
		const otherTops = [];
		for (const [otherName, otherSel] of others) {
			otherTops.push([
				otherName,
				await cdp.evaluate(
					`(() => { const el = document.querySelector(${JSON.stringify(otherSel)}); return el === null ? null : Math.round(el.scrollTop); })()`,
				),
			]);
		}
		const chromeHeld =
			JSON.stringify(after.chrome) === JSON.stringify(chromeBefore);
		check(
			`${state}: a wheel over the ${pane} pane moves that pane, or nothing when it fits`,
			(afterTop !== beforeTop && afterTop > beforeTop) ||
				(afterTop === beforeTop && point.scrollableUnder.length === 0),
			JSON.stringify({
				beforeTop,
				afterTop,
				scrollableUnder: point.scrollableUnder,
			}),
		);
		check(
			`${state}: a wheel over the ${pane} pane leaves the chrome and the other pane where they were`,
			chromeHeld &&
				after.shell?.scrollTop === 0 &&
				(after.strip === null || after.strip.scrollTop === 0) &&
				after.document.scrollTop === 0,
			JSON.stringify({ chromeHeld, shell: after.shell?.scrollTop, otherTops }),
		);
		// Where the pane scrolled, put it back so the next frame is the same state.
		if (afterTop !== beforeTop) {
			await cdp.evaluate(
				`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.scrollTop = ${beforeTop ?? 0}; return true; })()`,
			);
			await wait(120);
		}
		await parkPointer(cdp);
	}
	return facts;
}

async function sceneSidebarSections(cdp, handle) {
	let link = cdp;
	const seeded = [];
	/*
	 * Twenty rather than a handful: the auto rule is a CAP over the list's content,
	 * so a list shorter than the cap draws only its own height and the frame cannot
	 * show the share the cap grants. Twenty rows overflow the cap at both window
	 * sizes this scene is run at (336 at 1380x900), which is what makes the drawn
	 * box the cap rather than the content.
	 */
	for (let index = 0; index < 20; index += 1) {
		seeded.push((await createBackendSession()).status);
	}
	const authored = [
		await authoringWrite("/v1/desktop/profiles", {
			request_id: randomUUID(),
			name: "docs-writer",
			kind: "role",
			description: "Keeps AGENTS.md and the guides current.",
			instructions: "Write for the next reader.",
		}),
		await authoringWrite("/v1/desktop/profiles", {
			request_id: randomUUID(),
			name: "release-owner",
			kind: "role",
			description: "Cuts releases and posts the refs.",
			instructions: "Own one release window at a time.",
		}),
		await authoringWrite("/v1/desktop/teams", {
			request_id: randomUUID(),
			name: "chat-redesign",
			description: "Designer, coder, reviewer and QA on the chat surface.",
		}),
	];
	note(
		"seeded",
		JSON.stringify({
			sessions: seeded,
			authored: authored.map((a) => a.status),
		}),
	);

	const ready = async (c) =>
		waitForCondition(
			c,
			`Boolean(document.querySelector(${JSON.stringify(SPLIT_ENTITIES)}) && document.querySelector(${JSON.stringify(SPLIT_CHATS)}) && document.querySelector(${JSON.stringify(SPLIT_SEPARATOR)}) && document.querySelector('[data-entity]') && document.querySelector('[data-session-row]'))`,
			30_000,
		);
	const geometry = (c) =>
		c.evaluate(`(() => {
			const box = (s) => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height) }; };
			const sep = document.querySelector(${JSON.stringify(SPLIT_SEPARATOR)});
			return {
				entities: box(${JSON.stringify(SPLIT_ENTITIES)}),
				chats: box(${JSON.stringify(SPLIT_CHATS)}),
				separator: sep ? { now: Number(sep.getAttribute("aria-valuenow")), min: Number(sep.getAttribute("aria-valuemin")), max: Number(sep.getAttribute("aria-valuemax")), tabIndex: sep.tabIndex, label: sep.getAttribute("aria-label") } : null,
				agentsChevron: document.querySelector('[aria-label="Show the agent list"], [aria-label="Hide the agent list"]') !== null,
				// The two numbers \`chat-sidebar-sections.test.mjs\` pins as the real panel:
				// the box the sections share, and the nav's content box (\`p-2\` = 16).
				capacity: (() => { const e = document.querySelector(${JSON.stringify(SPLIT_ENTITIES)}); const c = document.querySelector(${JSON.stringify(SPLIT_CHATS)}); return e && c ? Math.round(e.getBoundingClientRect().height + c.getBoundingClientRect().height) : null; })(),
				panel: (() => { const n = document.querySelector('nav[aria-label="Chats"]'); return n ? n.clientHeight - 16 : null; })(),
				// The cap the auto rule computed, read from the region's own inline
				// max-height rather than recomputed here - so the check compares the
				// DRAWN box with the number the shipped module handed the render.
				listMax: (() => { const c = document.querySelector(${JSON.stringify(SPLIT_CHATS)}); if (!c) return null; const v = getComputedStyle(c).maxHeight; return v && v.endsWith("px") ? Math.round(Number.parseFloat(v)) : null; })(),
			};
		})()`);

	// --- 1. the untouched column: nothing written to the regions first ----
	await verb(link, "setTheme", "localOperatorDark");
	await verb(link, "navigate", "/chat");
	const first = await ready(link);
	check(
		"an untouched column draws BOTH sections and the boundary",
		first.ok,
		JSON.stringify(first.last),
	);
	const stored0 = await splitPreferences(link);
	note(
		"regions as stored before any press",
		String(stored0.state?.chatSidebarRegions),
	);
	/*
	 * BOTH SECTIONS HAVE ROWS BEFORE THE FRAME IS TAKEN, and that is a wait rather
	 * than a nicety: the auto rule is a CAP over the list's own content, so a list
	 * read that has not landed yet drew ~97px of one row in a run where the frame
	 * is supposed to show two populated sections - and the check below, written
	 * against the drawn boxes, failed on the RACE rather than on the layout.
	 */
	const populated = await waitForCondition(
		link,
		`document.querySelectorAll("[data-session-row]").length >= 14 && document.querySelectorAll("[data-entity]").length >= 2`,
		20_000,
	);
	check(
		"both sections carry rows before the first frame",
		populated.ok,
		JSON.stringify(populated.last),
	);
	const rest = await geometry(link);
	note("default geometry", JSON.stringify(rest));
	check(
		"the Agents row carries no disclosure chevron any more",
		rest.agentsChevron === false,
		String(rest.agentsChevron),
	);
	/*
	 * THE AUTO RULE'S OWN CONTRACT, rather than a comparison of two drawn boxes: the
	 * chats are CAPPED at the panel's own share with the section above keeping its
	 * floor, and a list long enough to reach the cap draws at it. A short list draws
	 * its content, which is the rule working rather than a layout that changed - the
	 * distinction the race above cost a run to learn.
	 */
	const cap = rest.listMax;
	check(
		"the chats draw at the auto cap, which is larger than the section above",
		rest.chats !== null &&
			cap !== null &&
			Math.abs(rest.chats.h - cap) <= 2 &&
			cap > rest.capacity - cap &&
			rest.capacity - rest.separator.max === 72,
		JSON.stringify({
			chats: rest.chats?.h,
			cap,
			agents: rest.entities?.h,
			agentsFloor: rest.capacity - rest.separator.max,
		}),
	);
	await parkPointer(link);
	await captureSettled(link, "sections-default-dark");
	/*
	 * THE ONE-SCROLLER CONTRACT, on the state the operator photographed: both panes
	 * overflowing, so both carry a bar - and the column must still carry none.
	 */
	await checkSidebarScroll(link, "both sections overflowing (dark)");
	/*
	 * AND THE BOUNDARY SURVIVES THE SCROLL. The divider is a sibling of the panes, not
	 * inside one, so scrolling a pane to its end must leave it where it was and still
	 * draggable - the half of the operator's rule that is about the handle rather than
	 * the bars.
	 */
	await link.evaluate(
		`(() => { const el = document.querySelector(${JSON.stringify(SPLIT_CHATS)}); if (el) el.scrollTop = el.scrollHeight; const e2 = document.querySelector(${JSON.stringify(SPLIT_ENTITIES)}); if (e2) e2.scrollTop = e2.scrollHeight; return true; })()`,
	);
	await wait(250);
	const sepScrolled = await splitBox(link, SPLIT_SEPARATOR);
	const storedScrolled = (await splitPreferences(link)).state
		?.chatSidebarListHeight;
	check(
		"the boundary is still on screen while both panes are scrolled to their ends",
		sepScrolled !== null &&
			sepScrolled.top > 0 &&
			sepScrolled.bottom < WINDOW_HEIGHT &&
			sepScrolled.height > 0,
		JSON.stringify(sepScrolled),
	);
	const sepPoint = await splitBox(link, SPLIT_SEPARATOR);
	await movePointer(link, sepPoint.x, sepPoint.y);
	await dragSplit(link, sepPoint.x, sepPoint.y, -30);
	await parkPointer(link);
	const storedAfterScrolledDrag = (await splitPreferences(link)).state
		?.chatSidebarListHeight;
	check(
		"and it still resizes with the panes scrolled",
		typeof storedAfterScrolledDrag === "number" &&
			storedAfterScrolledDrag !== storedScrolled,
		`${storedScrolled} -> ${storedAfterScrolledDrag}`,
	);
	await link.evaluate(
		`(() => { for (const sel of [${JSON.stringify(SPLIT_CHATS)}, ${JSON.stringify(SPLIT_ENTITIES)}]) { const el = document.querySelector(sel); if (el) el.scrollTop = 0; } return true; })()`,
	);
	await setSplitPreferences(link, { chatSidebarListHeight: null });
	await ready(link);
	await verb(link, "setTheme", "localOperatorLight");
	await wait(300);
	await parkPointer(link);
	await captureSettled(link, "sections-default-light");
	await checkSidebarScroll(link, "both sections overflowing (light)");

	// --- 2. two drag positions, each written and drawn -------------------
	/*
	 * IN THE PALETTE THE FRAMES ARE NAMED FOR. The four frames below are `-dark`,
	 * and before this line the scene was still in the light palette set for
	 * `sections-default-light` two sections up - which is design round 2's D20 in one
	 * line: every drag and floor frame was shot light and named dark. The rule this
	 * block now follows, and the capture path asserts: a `captureSettled` whose label
	 * names a palette is preceded by the `setTheme` for that palette.
	 */
	await verb(link, "setTheme", "localOperatorDark");
	await wait(300);
	const dragTo = async (dy, label) => {
		const sep = await splitBox(link, SPLIT_SEPARATOR);
		await movePointer(link, sep.x, sep.y);
		await dragSplit(link, sep.x, sep.y, dy);
		await parkPointer(link);
		const prefs = await splitPreferences(link);
		const geo = await geometry(link);
		note(
			`after a ${dy}px drag`,
			JSON.stringify({ stored: prefs.state?.chatSidebarListHeight, geo }),
		);
		check(
			`a ${dy}px drag writes the chats height it draws`,
			typeof prefs.state?.chatSidebarListHeight === "number" &&
				geo.chats !== null &&
				Math.abs(geo.chats.h - geo.separator.now) <= 1,
			JSON.stringify({
				stored: prefs.state?.chatSidebarListHeight,
				drawn: geo.chats?.h,
				announced: geo.separator?.now,
			}),
		);
		await captureSettled(link, label);
		return { stored: prefs.state?.chatSidebarListHeight, geo };
	};
	const up = await dragTo(-120, "sections-dragged-up-dark");
	const down = await dragTo(220, "sections-dragged-down-dark");
	check(
		"the two drag positions are different sizes",
		up.stored !== down.stored,
		`${up.stored} vs ${down.stored}`,
	);

	// --- 3. the floors: drag far past each end ---------------------------
	const toTop = await dragTo(-2000, "sections-floor-agents-dark");
	check(
		"dragging to the top leaves Agents + Teams at its 72px floor",
		toTop.geo.entities !== null && toTop.geo.entities.h >= 72 - 1,
		JSON.stringify(toTop.geo.entities),
	);
	const toBottom = await dragTo(2000, "sections-floor-chats-dark");
	check(
		"dragging to the bottom leaves Chats at its 72px floor",
		toBottom.geo.chats !== null &&
			Math.round(toBottom.geo.chats.h) === 72 &&
			toBottom.geo.separator.min === 72,
		JSON.stringify(toBottom.geo),
	);

	// --- 4. the keyboard: Tab-reachable, and the arrows resize ------------
	const reachable = await link.evaluate(
		`document.querySelector(${JSON.stringify(SPLIT_SEPARATOR)}).tabIndex === 0`,
	);
	check(
		"the boundary is in the Tab order",
		reachable === true,
		String(reachable),
	);
	await link.evaluate(
		`document.querySelector(${JSON.stringify(SPLIT_SEPARATOR)}).focus(); true`,
	);
	const beforeKey = (await geometry(link)).separator.now;
	for (let press = 0; press < 5; press += 1) {
		await pressChord(link, {
			key: "ArrowUp",
			code: "ArrowUp",
			virtualKeyCode: 38,
		});
		await wait(60);
	}
	await wait(250);
	const afterKey = await geometry(link);
	const keyed = (await splitPreferences(link)).state?.chatSidebarListHeight;
	note(
		"keyboard",
		JSON.stringify({
			before: beforeKey,
			after: afterKey.separator.now,
			stored: keyed,
		}),
	);
	check(
		"ArrowUp on the focused boundary resizes and persists",
		afterKey.separator.now !== beforeKey && keyed === afterKey.separator.now,
		`${beforeKey} -> ${afterKey.separator.now}, stored ${keyed}`,
	);

	// --- 5. a middle position, then the second palette in the same state --
	await setSplitPreferences(link, { chatSidebarListHeight: 300 });
	await ready(link);
	await parkPointer(link);
	await captureSettled(link, "sections-300-dark");
	await verb(link, "setTheme", "localOperatorLight");
	await wait(300);
	await captureSettled(link, "sections-300-light");
	await setSplitPreferences(link, { chatSidebarListHeight: null });
	await ready(link);
	await parkPointer(link);
	await captureSettled(link, "sections-default-light");

	/*
	 * --- 5b. ONE SECTION EMPTY, and one pane alone ------------------------
	 *
	 * Two of the states the operator's rule has to hold in, and neither is the same
	 * as "both overflowing": a query that matches nothing leaves the chats pane with
	 * a sentence and no rows (so it must gain NO scrollbar, and a wheel over it must
	 * move nothing at all), and hiding the agents section leaves one pane in the
	 * column with the restore row above it.
	 */
	await setSplitPreferences(link, { chatSidebarListHeight: null });
	await ready(link);
	/*
	 * The column's search field is drawn only WHILE filtering - typing into the list
	 * is what opens it (the panel's own `keyDown` turns a printable key into the
	 * query) - so the query is typed the way a reader types it: focus the list and
	 * send the keys, rather than reaching for an input that is not on screen yet.
	 */
	/*
	 * `[data-chat-row]`, not `[data-session-row]`: the panel's own handler opens the
	 * field only for a key whose TARGET carries that attribute, and the row's inner
	 * control is where a keyboard reader's focus actually sits. Measured: focusing the
	 * row element itself typed nothing and the field never appeared.
	 */
	const focusedRow = await link.evaluate(
		`(() => { const row = document.querySelector("[data-chat-row]"); if (!row) return false; row.focus(); return document.activeElement === row; })()`,
	);
	check(
		"a row can hold focus for the query",
		focusedRow === true,
		String(focusedRow),
	);
	for (const letter of "zzzznomatch") {
		await pressChord(link, {
			key: letter,
			code: `Key${letter.toUpperCase()}`,
			virtualKeyCode: letter.toUpperCase().charCodeAt(0),
		});
	}
	await wait(500);
	await parkPointer(link);
	const emptied = await waitForCondition(
		link,
		`document.querySelectorAll('[data-sidebar-region="chats"] [data-session-row]').length === 0 && document.querySelector('input[aria-label="Search chats and agents"]') !== null`,
		10_000,
	);
	check(
		"a query matching nothing leaves the chats pane without rows",
		emptied.ok,
		JSON.stringify(emptied.last),
	);
	await captureSettled(link, "sections-chats-empty-light");
	await checkSidebarScroll(link, "the chats pane empty (light)");
	await verb(link, "setTheme", "localOperatorDark");
	await wait(300);
	await captureSettled(link, "sections-chats-empty-dark");
	await checkSidebarScroll(link, "the chats pane empty (dark)");
	/*
	 * And clear it, through the field's own control: a query left on screen would
	 * make every later state in this scene a filtered one.
	 */
	const clear = await splitBox(link, '[aria-label="Clear search"]');
	if (clear !== null) await pressPointerStationary(link, clear.x, clear.y);
	await wait(500);
	/*
	 * DARK, because the next frame is `sections-agents-hidden-dark`. This line used to
	 * set LIGHT - which is how the pair below ended up byte-identical, both palettes
	 * photographed as one (design round 2, D20).
	 */
	await verb(link, "setTheme", "localOperatorDark");
	await wait(250);
	await ready(link);
	/*
	 * The hidden section's way back is the restore row, and hiding it is a press on
	 * the boundary's own cluster - reached by focus and Enter rather than by a
	 * pointer, because the cluster is intent-gated and a press at its coordinates
	 * would land on whatever is over it.
	 */
	const hideAgents = await link.evaluate(
		`(() => { const el = document.querySelector('[data-sidebar-hide="entities"]'); if (!el) return false; el.focus(); return true; })()`,
	);
	if (hideAgents) {
		await pressChord(link, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
		await wait(400);
		const solo = await waitForCondition(
			link,
			`document.querySelector(${JSON.stringify(SPLIT_ENTITIES)}) === null && document.querySelector('[data-sidebar-restore="entities"]') !== null`,
			10_000,
		);
		check(
			"hiding the agents section leaves the chats pane alone with its way back",
			solo.ok,
			JSON.stringify(solo.last),
		);
		await parkPointer(link);
		await captureSettled(link, "sections-agents-hidden-dark");
		await checkSidebarScroll(link, "one section (dark)");
		await verb(link, "setTheme", "localOperatorLight");
		await wait(300);
		await captureSettled(link, "sections-agents-hidden-light");
		await checkSidebarScroll(link, "one section (light)");
		// Back to both, the way the restore row itself does it.
		const restore = await splitBox(link, '[data-sidebar-restore="entities"]');
		if (restore !== null) {
			await pressPointerStationary(link, restore.x, restore.y);
			await wait(400);
		}
	}

	// --- 6. the 56px strip's mark, both palettes --------------------------
	await setSplitPreferences(link, { isSidebarCollapsed: true });
	await waitForCondition(
		link,
		`Boolean(document.querySelector("[data-sidebar-strip] [data-brand-mark]"))`,
		10_000,
	);
	await parkPointer(link);
	/*
	 * EACH STRIP FRAME NAMES ITS OWN PALETTE (design round 2, D20). These two captures
	 * used to inherit whatever the block above left live - and that block's `setTheme`
	 * runs only when the agents section was hidden, so the palette here depended on a
	 * BRANCH. That is why `strip-mark-light` was shot dark in the shipped set.
	 */
	await verb(link, "setTheme", "localOperatorLight");
	await wait(300);
	await captureSettled(link, "strip-mark-light");
	await verb(link, "setTheme", "localOperatorDark");
	await wait(300);
	await captureSettled(link, "strip-mark-dark");
	await checkSidebarScroll(link, "the collapsed 56px strip (dark)");
	await setSplitPreferences(link, { isSidebarCollapsed: false });

	// --- 7. the relaunch: a dragged size SURVIVES a new process -----------
	await ready(link);
	const sep = await splitBox(link, SPLIT_SEPARATOR);
	await movePointer(link, sep.x, sep.y);
	await dragSplit(link, sep.x, sep.y, -90);
	await parkPointer(link);
	const beforeRestart = await splitPreferences(link);
	const drawnBefore = await geometry(link);
	note(
		"before the relaunch",
		JSON.stringify({
			stored: beforeRestart.state?.chatSidebarListHeight,
			drawn: drawnBefore.chats,
		}),
	);
	await captureSettled(link, "sections-before-relaunch-dark");
	const firstPid = handle.pid;
	await stopApp(handle);
	const again = await launchApp({
		armed: true,
		logName: "app-scene-restart.log",
		tag: "scene",
	});
	app = again;
	await waitForDevtools(again);
	link.close();
	link = await CdpClient.attach(again.port, "out/renderer/index.html");
	await waitForBridge(link);
	await verb(link, "navigate", "/chat");
	await ready(link);
	await wait(600);
	await parkPointer(link);
	const afterRestart = await splitPreferences(link);
	const drawnAfter = await geometry(link);
	note(
		"after the relaunch",
		JSON.stringify({
			pid: `${firstPid} -> ${again.pid}`,
			stored: afterRestart.state?.chatSidebarListHeight,
			drawn: drawnAfter.chats,
		}),
	);
	check(
		"the relaunch is a different process",
		again.pid !== firstPid,
		`${firstPid} -> ${again.pid}`,
	);
	check(
		"the dragged size survives the relaunch, stored and drawn",
		afterRestart.state?.chatSidebarListHeight ===
			beforeRestart.state?.chatSidebarListHeight &&
			drawnAfter.chats?.h === drawnBefore.chats?.h,
		`stored ${beforeRestart.state?.chatSidebarListHeight} -> ${afterRestart.state?.chatSidebarListHeight}, drawn ${drawnBefore.chats?.h} -> ${drawnAfter.chats?.h}`,
	);
	await captureSettled(link, "sections-after-relaunch-dark");

	// --- 8. the empty state's mark, both palettes -------------------------
	const newChat = await splitBox(link, "[data-new-chat-row]");
	if (newChat !== null)
		await pressPointerStationary(link, newChat.x, newChat.y);
	const empty = await waitForCondition(
		link,
		`Boolean(document.querySelector("[data-lo-empty-mark] [data-brand-mark]"))`,
		15_000,
	);
	check(
		"the empty state draws the bubbled mark",
		empty.ok,
		JSON.stringify(empty.last),
	);
	await parkPointer(link);
	/* Named for a palette, so it sets it: see the strip's block above for why a frame
	 * never inherits one from whatever ran before it (design round 2, D20). */
	await verb(link, "setTheme", "localOperatorDark");
	await wait(300);
	await captureSettled(link, "empty-mark-dark");
	await verb(link, "setTheme", "localOperatorLight");
	await wait(300);
	await captureSettled(link, "empty-mark-light");
	return link;
}

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
 *
 * THREE FIELDS PER CONVERSATION, and the second two are what agent review round 1
 * (M1) added: the caption claimed a closed document left "no document **and no
 * tab**" in the store while this projection read `files` alone. `openTabs` is a
 * real state - every attachment click consults it to decide a file is already
 * open (`file-attachment.tsx`) - so a scene that says a tab is gone has to read
 * the list a tab lives in. `selectedTabId` is here for the close's own landing
 * claim (design review round 1, D1): where the reader lands is a fact about the
 * store as well as about the pixels.
 */
const CANVAS_STORE_DOCS_EXPR = `(() => {
	try {
		const raw = window.localStorage.getItem("canvas-store");
		if (!raw) return null;
		const conversations = JSON.parse(raw)?.state?.conversations ?? {};
		const out = {};
		for (const [key, value] of Object.entries(conversations)) {
			out[key] = {
				files: (value?.files ?? []).map((file) => ({
					id: file.id,
					content: file.content ?? "",
					readMtimeMs: file.readMtimeMs ?? null,
					lastAgentModified: file.lastAgentModified ?? null,
				})),
				openTabs: (value?.openTabs ?? []).map((tab) => tab.id),
				selectedTabId: value?.selectedTabId ?? null,
			};
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
	for (const conversation of Object.values(conversations)) {
		for (const file of conversation.files) {
			if (file.id === path || file.id === decodeURI(path)) return file;
		}
	}
	return null;
}

/** The store's TAB for one path - the `openTabs` list, read the same way (M1). */
async function storedTab(cdp, path) {
	const conversations = await cdp.evaluate(CANVAS_STORE_DOCS_EXPR);
	if (!conversations || conversations.error) return null;
	for (const conversation of Object.values(conversations)) {
		const tab = conversation.openTabs.find(
			(id) => id === path || id === decodeURI(path),
		);
		if (tab) return tab;
	}
	return null;
}

/**
 * The conversation's selected tab, whichever conversation the scene is driving.
 *
 * `null` for "none selected", which is a real state - the empty strip - and not
 * the same reading as "no store at all" (`undefined`), so a caller can tell a
 * close that emptied the strip from a store that was never written.
 */
async function storedSelectedTab(cdp) {
	const conversations = await cdp.evaluate(CANVAS_STORE_DOCS_EXPR);
	if (!conversations || conversations.error) return undefined;
	for (const conversation of Object.values(conversations)) {
		if (conversation.selectedTabId !== null) return conversation.selectedTabId;
	}
	return null;
}

/**
 * THE STORE'S OWN WRITE LOG, and why the state alone is not enough (QA round 1, Q1).
 *
 * The close's harm is a WRITE ORDER, not only a state: on the pre-fix tree the ✕
 * removes the document and the viewer's unmount commit puts it straight back
 * (`[...files, document]`). QA round 2 measured that re-listing on BOTH bases
 * (`0c02556ba` and `e3f9fec32`) and it is PERMANENT rather than a flicker: the
 * document is still listed 8s on, after the ten writes that follow the press, so the
 * base's SETTLED read is exactly the reading that fails there - and the branch's own
 * close phase, which takes that reading, does fail on the base's build. QA's round-1
 * `+1827ms files=[b]`, from which this paragraph once drew a ~1s window that "no
 * still frame can be its witness", is WITHDRAWN by that round's Q3: nothing removes
 * the re-listing, and the rig that showed the removal had a second close/unmount
 * cycle in its shape.
 *
 * So the phase records every write of the `canvas-store` key, with each write's
 * `files` and `openTabs` IDs and its selected tab, and asserts the two halves the
 * mechanism has: that the close reaches the store as a write that DROPS the
 * document, and that no later write in the phase puts it back. On the pre-fix tree
 * the second half fails on the unmount commit's own write, which is the point - and
 * it is the half no state read can carry, because the state a close that never ran
 * leaves is the state the base ends in.
 *
 * Installed in the PAGE, wrapping `Storage.prototype.setItem` - the app's persisted
 * store writes through it, and the wrapper is consulted per call, so this catches
 * every later write from the app's own store module. It is PROVED before it is
 * trusted: the phase performs a store write the app certainly makes (opening a
 * document) and requires it in the log, so a later empty log is a measurement rather
 * than a broken wrapper. The IDs are full paths, so the row a human reads is
 * basenamed by `canvasStoreWriteRows` while the assertions compare the real IDs.
 */
const CANVAS_STORE_WRITE_LOG_INSTALL_EXPR = `(() => {
	if (window.__canvasStoreWrites) return "already-installed";
	const writes = [];
	window.__canvasStoreWrites = writes;
	const original = Storage.prototype.setItem;
	Storage.prototype.setItem = function (key, value) {
		if (key === "canvas-store") {
			try {
				const conversations = JSON.parse(value)?.state?.conversations ?? {};
				const shape = {};
				for (const [id, conversation] of Object.entries(conversations)) {
					shape[id] = {
						files: (conversation?.files ?? []).map((file) => file.id),
						openTabs: (conversation?.openTabs ?? []).map((tab) => tab.id),
						selectedTabId: conversation?.selectedTabId ?? null,
					};
				}
				writes.push({ at: Math.round(performance.now()), shape });
			} catch (error) {
				writes.push({ at: Math.round(performance.now()), error: String(error) });
			}
		}
		return original.apply(this, arguments);
	};
	return "installed";
})()`;

/** Drop every recorded write, so the next one recorded is the one under test. */
const CANVAS_STORE_WRITE_LOG_CLEAR_EXPR = `(() => {
	if (!window.__canvasStoreWrites) return "not-installed";
	window.__canvasStoreWrites.length = 0;
	return "cleared";
})()`;

const CANVAS_STORE_WRITE_LOG_EXPR =
	"(() => window.__canvasStoreWrites ?? null)()";

const installCanvasStoreWriteLog = (cdp) =>
	cdp.evaluate(CANVAS_STORE_WRITE_LOG_INSTALL_EXPR);
const clearCanvasStoreWriteLog = (cdp) =>
	cdp.evaluate(CANVAS_STORE_WRITE_LOG_CLEAR_EXPR);
const canvasStoreWrites = (cdp) => cdp.evaluate(CANVAS_STORE_WRITE_LOG_EXPR);

/** A path as the basename a human reads; the assertions keep the full ID. */
const baseName = (id) => String(id).split("/").pop();

/**
 * The log as the rows the pull request quotes: one line per write, in order.
 *
 * Basenamed because a canvas path is 60 characters of scratch tree, and the row
 * exists to be read beside the assertion that names the document.
 */
function canvasStoreWriteRows(writes) {
	if (!Array.isArray(writes))
		return [`write log unavailable (${JSON.stringify(writes)})`];
	return writes.map((write) => {
		if (write.error) return `+${write.at}ms unparsed (${write.error})`;
		const parts = Object.values(write.shape).map(
			(conversation) =>
				`files=[${conversation.files.map(baseName).join(", ")}] ` +
				`tabs=[${conversation.openTabs.map(baseName).join(", ")}] ` +
				`sel=${conversation.selectedTabId ? baseName(conversation.selectedTabId) : "none"}`,
		);
		return `+${write.at}ms ${parts.join(" | ")}`;
	});
}

/** Every file ID any recorded write listed for a conversation, in order. */
const writesListing = (writes, id) =>
	(Array.isArray(writes) ? writes : []).filter((write) =>
		Object.values(write.shape ?? {}).some((conversation) =>
			conversation.files.includes(id),
		),
	);

/**
 * The writes that come AFTER the first one that satisfies `settled`.
 *
 * WHY NOT SIMPLY "no write lists it": the close's own writes are several, and the
 * first of them still lists the document - the ✕ handler takes it out of `openTabs`
 * and then out of `files` in two store writes, so the window a scene clears before
 * the press legitimately contains one or two writes from BEFORE the removal. What
 * the finding is about is the writes AFTER the removal, which is the only place a
 * re-listing can appear: on the pre-fix tree that is the unmount commit's upsert.
 *
 * `[]` for a window whose first write never satisfies `settled`: a scene that did
 * not see the removal has nothing to say about what followed it, and returning the
 * whole window would turn a missing removal into a passing check.
 */
const writesAfter = (writes, settled) => {
	const list = Array.isArray(writes) ? writes : [];
	const first = list.findIndex((write) =>
		Object.values(write.shape ?? {}).some(settled),
	);
	return first === -1 ? [] : list.slice(first + 1);
};

/**
 * The row's hold sentence, as a module-level constant rather than an inline
 * literal (agent review round 1, N1): a regex inside a function body is a new one
 * per call and biome's `useTopLevelRegex` says so, which is 12 warnings this file
 * did not need to grow by one for a test that reads the same sentence five times.
 */
const CHANGED_ON_DISK_RE = /changed on disk/i;

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

/** The strip's own scroll container, which is the box a tab has to be inside to count as visible. */
const CANVAS_STRIP_SELECTOR = '[role="tablist"][aria-label="Open documents"]';

/**
 * The tab the strip has selected, as the strip's own DOM reports it.
 *
 * The selected tab is the one carrying `aria-selected="true"`, and its `title` is
 * the document's path - so this is the reader's own answer to "which document am I
 * on", independent of the store, which is why the close's landing claim (design
 * review round 1, D1) is asserted against both: a selection the pane makes and a
 * selection the strip does not paint is the same defect one render later.
 */
const CANVAS_SELECTED_TAB_EXPR = `(() => {
	const tab = document.querySelector(${JSON.stringify(`${CANVAS_TAB_SELECTOR}[aria-selected="true"]`)});
	return tab ? tab.getAttribute("title") : null;
})()`;

/**
 * Where the FOCUS is (design review round 1, D3), and it says which of the three
 * places it landed rather than only whether a tab has it: a close that leaves focus
 * on the document body, or on the ✕ that is about to be unmounted, is not the same
 * reading as one that moved it to the tab the reader is now on - and `body` is what
 * the draft HTML reports when nothing is focused at all, so "no element" has to be
 * reportable rather than an empty string.
 */
const CANVAS_FOCUSED_TAB_EXPR = `(() => {
	const active = document.activeElement;
	if (!active || active === document.body) return { in: "body", label: null };
	const tab = active.closest('[role="tab"]');
	if (tab) return { in: "tab", label: tab.getAttribute("title") };
	const label = active.getAttribute("aria-label") ?? active.textContent?.trim() ?? null;
	return { in: "control", label: label ? label.slice(0, 60) : null };
})()`;

/**
 * How much of a document's ✕ is inside the strip's own box, and what is under it.
 *
 * THE MEASUREMENT UX ROUND 1 (U3) MADE, reproduced rather than described: at nine
 * documents the selected tab's label was on screen, its ✕ measured
 * `closeVisiblePx 0`, and the pixel at the ✕'s centre belonged to the strip's
 * pinned "All open files" button - so a reader aiming at the close opened a menu
 * that cannot close anything. `visiblePx` is the overlap between the control's box
 * and the strip's, and `atCentre` is what `elementFromPoint` answers at the point a
 * reader would press.
 */
function closeControlWhereabouts(cdp, title) {
	const selector = `${CANVAS_STRIP_SELECTOR} [aria-label="Close ${title}"]`;
	return cdp.evaluate(`(() => {
		const strip = document.querySelector(${JSON.stringify(CANVAS_STRIP_SELECTOR)});
		const control = document.querySelector(${JSON.stringify(selector)});
		if (!strip || !control) return { found: false, visiblePx: 0, atCentre: null };
		const s = strip.getBoundingClientRect();
		const c = control.getBoundingClientRect();
		const visiblePx = Math.max(0, Math.min(c.right, s.right) - Math.max(c.left, s.left));
		const x = Math.round((c.left + c.right) / 2);
		const y = Math.round((c.top + c.bottom) / 2);
		const hit = document.elementFromPoint(x, y);
		return {
			found: true,
			visiblePx: Math.round(visiblePx),
			widthPx: Math.round(c.width),
			centreX: x,
			hitIsControl: Boolean(hit && (hit === control || control.contains(hit))),
			atCentre: hit
				? (hit.getAttribute("aria-label") ??
					(hit.closest('[role="tab"]') ? "the tab label" : hit.tagName.toLowerCase()))
				: null,
		};
	})()`);
}

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
	 * THE SENTENCE KEEPS ITS FULL WIDTH WHILE THE STAMP IS BESIDE IT (design round 4,
	 * U15 - and deliberately the reverse of round 2's D7, which protected the stamp).
	 *
	 * What U15 measured is the reason: at a 1024x700 window the note was six pixels
	 * against 264px of text, so the fact the row exists to state was gone at the size
	 * the app's own minimum window declares. The row now protects the SENTENCE and
	 * lets the stamp yield, and the tooltip carries the stamp's figure as well as the
	 * claim, so nothing is lost. The stamp's own numbers stay in this check's message
	 * rather than being asserted, because at some width it must yield - that is the
	 * decision, not a defect.
	 */
	check(
		"the sentence is not clipped while the stamp is beside it",
		rowGeometry !== null &&
			rowGeometry.note !== null &&
			rowGeometry.note.scroll <= rowGeometry.note.client + 1,
		JSON.stringify(rowGeometry),
	);

	/*
	 * Q17(a), round 7: the check above dereferenced `note.scroll` unguarded while its own
	 * geometry reader returns `note: null` for a row with no note, so it THREW instead of
	 * failing - an instrument that turns a state into a crash reports neither.
	 */

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

	/**
	 * Type into the markdown WYSIWYG, and PROVE it landed.
	 *
	 * The raw key dispatch `typeText` uses moves CodeMirror (measured: that is why
	 * the code surface's phases have always used it) and does not move this editor:
	 * a round-4 run typed `MDREADER`, the model never saw it, and the file stayed at
	 * its first version - which is how this round learned the difference. So the
	 * keyboard is tried first and `execCommand("insertText")`, which dispatches the
	 * `beforeinput`/`input` pair ProseMirror listens for, is the fallback; what the
	 * checks then assert is the FILE, so a path that silently did nothing cannot
	 * pass them.
	 */
	/** Type into the code surface, and prove the editor took the words. */
	const typeCode = async (cdp, text) => {
		await verb(cdp, "press", "#canvas-document-panel .cm-content");
		await typeText(cdp, text);
		const landed = await cdp.evaluate(
			`(${CANVAS_DOCUMENT_TEXT_EXPR}).text.includes(${JSON.stringify(text)})`,
		);
		return landed ? "keys" : "nothing landed";
	};

	const typeMarkdown = async (cdp, selector, text) => {
		const landed = () =>
			cdp.evaluate(
				`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return (el?.textContent ?? "").includes(${JSON.stringify(text)}); })()`,
			);
		await verb(cdp, "press", selector);
		await typeText(cdp, text);
		if (await landed()) return "keys";
		/*
		 * The fallback places the CARET ITSELF before inserting: a document whose
		 * editor has just been mounted has no selection, and `insertText` with no
		 * caret does nothing at all - which is how the cross-document phase typed into
		 * nothing while the first markdown phase worked.
		 */
		await cdp.evaluate(
			`(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				if (!el) return false;
				el.focus();
				const range = document.createRange();
				range.selectNodeContents(el);
				range.collapse(false);
				const selection = window.getSelection();
				selection?.removeAllRanges();
				selection?.addRange(range);
				return document.execCommand("insertText", false, ${JSON.stringify(text)});
			})()`,
		);
		// What this returns is what the DOM shows, so a phase that typed into nothing
		// says so rather than failing 10 seconds later on a file that never changed.
		return (await landed()) ? "insertText" : "nothing landed";
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
	/*
	 * THE ROW AT THE WIDTHS A READER ACTUALLY HAS (UX round 6, U18 / design D21).
	 *
	 * TWO THINGS THIS PHASE GOT WRONG BEFORE, both of them the same mistake - measuring
	 * something other than the state the finding is about:
	 *
	 * 1. It ran in the CODE phase, where the row's note was the short ANSWER (`Re-read`),
	 *    not the 269px hold SENTENCE. So its `note.client > 0` clause passed on a state
	 *    the reader never sees in this situation; had it run here, it would have failed.
	 *    It runs in the held state now - the moment the finding is about.
	 * 2. It emulated device metrics, which resizes the renderer but NOT the app's dock,
	 *    so the pane it measured was not the pane the streams measured (`dock 304,
	 *    region 251` at a real 1024x700). It sets a REAL window size now
	 *    (`Browser.setWindowBounds`), and says so if the host refuses.
	 *
	 * The assertions are the finding's own remedy: at 1024x700 the note must clear its
	 * 8ch floor (a reader has to see the state and its action, not one glyph) and the
	 * stamp must stay inside the region it shares.
	 */
	const rowGeometryAt = () =>
		cdp.evaluate(`(() => {
			const stamp = document.querySelector('[data-tour-tag="canvas-document-modified"]');
			const note = document.querySelector('[data-tour-tag="canvas-document-freshness-note"]');
			if (!stamp || !note) return null;
			const region = note.parentElement;
			return {
				stamp: { client: stamp.clientWidth, scroll: stamp.scrollWidth },
				note: { client: note.clientWidth, scroll: note.scrollWidth, text: (note.textContent ?? "").slice(0, 30) },
				region: region ? region.clientWidth : null,
				windowWidth: window.innerWidth,
			};
		})()`);
	const setWindowSize = async (width, height) => {
		try {
			const target = await cdp.send("Browser.getWindowForTarget");
			await cdp.send("Browser.setWindowBounds", {
				windowId: target.windowId,
				bounds: { width, height, windowState: "normal" },
			});
			// The renderer needs a frame to lay out at the new size.
			await new Promise((resolve) => setTimeout(resolve, 400));
			return true;
		} catch (error) {
			note(
				"Browser.setWindowBounds refused; the row could not be measured at a real size",
				String(error),
			);
			return false;
		}
	};
	/*
	 * A CDP `Browser.setWindowBounds` WAS TRIED FIRST AND THIS ELECTRON BUILD DOES NOT
	 * HONOUR IT (measured: every resized pass came back reporting the launch width, so
	 * the numbers would have described a window that never moved - the same class of
	 * mistake this phase was rewritten for). The resize attempt is kept, because on a
	 * build that does honour it the loop is the right shape, but a pass whose width did
	 * not actually move is RECORDED rather than asserted, and the width the row is
	 * really measured at is the one the app was LAUNCHED at (`--window-size WxH` /
	 * `LOCAL_OPERATOR_UI_WINDOW_SIZE`). The round's runs cover the finding's own width
	 * and the default one; the reader-facing claim is asserted in whichever window the
	 * run has.
	 */
	/*
	 * THE NOTE'S FLOOR, IN PIXELS, NAMED ONCE (review nit, round 7). The row gives the note
	 * `min-w-[8ch]` and the note renders at `--text-meta` (0.75rem = 12px), where 8ch measures
	 * about 53px. Three assertions spelled this as a literal 64, which is not the floor the
	 * layout promises - and an assertion that names a different number than the stylesheet is
	 * really testing the font stack.
	 */
	const CANVAS_FRESHNESS_NOTE_FLOOR_PX = 53;

	const originalBounds = await cdp
		.send("Browser.getWindowForTarget")
		.catch(() => null);
	let moved = true;
	for (const size of [
		{ label: "1024x700", width: 1024, height: 700, assertFloor: true },
		{ label: "1100x700", width: 1100, height: 700 },
		{ label: "1280x800", width: 1280, height: 800 },
		{ label: "1380x900", width: 1380, height: 900 },
		{ label: "800x600", width: 800, height: 600 },
	]) {
		const resized = await setWindowSize(size.width, size.height);
		if (!resized) break;
		const geometry = await rowGeometryAt();
		note(`row geometry at a requested ${size.label}`, JSON.stringify(geometry));
		if (Math.abs((geometry?.windowWidth ?? size.width) - size.width) > 20) {
			moved = false;
			break;
		}
		if (size.assertFloor) {
			check(
				`at a real ${size.label} the reader can see the state and its action, and the stamp stays in the row`,
				geometry !== null &&
					geometry.note.client >= CANVAS_FRESHNESS_NOTE_FLOOR_PX &&
					geometry.stamp.client > 0 &&
					geometry.stamp.client <= (geometry.region ?? 0),
				JSON.stringify(geometry),
			);
		}
	}
	if (!moved) {
		/*
		 * The host does not resize: measure the window this run actually has, and assert
		 * the reader-facing property there. A run launched at the finding's width
		 * (`--window-size 1024x700`) is what satisfies the finding's own case.
		 */
		const geometryAtLaunch = await rowGeometryAt();
		note(
			"Browser.setWindowBounds did not move the window; measured at the launch size instead",
			JSON.stringify(geometryAtLaunch),
		);
		check(
			"in this run's own window the hold sentence is on screen with its action, and the stamp stays inside the row",
			geometryAtLaunch !== null &&
				geometryAtLaunch.note.client >= CANVAS_FRESHNESS_NOTE_FLOOR_PX &&
				geometryAtLaunch.stamp.client > 0 &&
				geometryAtLaunch.stamp.client <= (geometryAtLaunch.region ?? 0),
			JSON.stringify(geometryAtLaunch),
		);
	}
	if (originalBounds?.bounds) {
		await setWindowSize(
			originalBounds.bounds.width,
			originalBounds.bounds.height,
		);
	}
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
	/*
	 * THE SENTENCE IS WHOLE WHERE THE ROW CAN HOLD IT, AND CLEARS ITS FLOOR WHERE IT
	 * CANNOT (round 7). The check as written demanded an untruncated sentence at ANY
	 * window, which cannot hold at 1024x700: the row's region there is 251px and the
	 * sentence is 269px, so SOMETHING must give - and the remedy the round agreed on is
	 * that the stamp gives way while the note keeps its 8ch floor, with the sentence's
	 * full text in the tooltip and the accessible description. Measured at a real
	 * 1024x700: note `125/269`, stamp `114/244` - the reader sees the state and the
	 * head of the action rather than one glyph, which is what U18 asked for.
	 */
	const sentenceFits =
		noteGeometry !== null && noteGeometry.scroll <= noteGeometry.client + 1;
	const sentenceHasFloor =
		noteGeometry !== null &&
		noteGeometry.client >= CANVAS_FRESHNESS_NOTE_FLOOR_PX;
	const regionCouldHold =
		noteGeometry !== null &&
		noteGeometry.regionClient !== null &&
		noteGeometry.regionClient >= noteGeometry.scroll + 8;
	check(
		"the sentence is whole where the row can hold it, and clears its floor where it cannot",
		(regionCouldHold ? sentenceFits : sentenceHasFloor) &&
			/save to replace it|load it/.test(noteGeometry?.text ?? ""),
		JSON.stringify({
			...noteGeometry,
			sentenceFits,
			sentenceHasFloor,
			regionCouldHold,
		}),
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

	/*
	 * ---------------------------------------------------------------------------
	 * ROUND 4: THE RESOLUTION PATH, ON THE SURFACE IT WAS MEASURED ON.
	 *
	 * Round 4's four harm classes are all the same failure - content that is not the
	 * reader's current buffer for that document reaching a file - and the markdown
	 * surface is where three of them were reproduced (UX U9, U14; QA Q13). The code
	 * surface above cannot see them: its debounce is one second against the markdown
	 * editor's three, and that window is what a stale proposal needs.
	 *
	 * Every check below is about the FILE - its bytes, its hash - because the file is
	 * what the harms damaged and nothing in this scene asserted it before. Each phase
	 * ends by leaving its document, which is the cure for the round-3 ordering note
	 * rather than a re-ordering of it: phases contaminate, and closing separates them.
	 * ---------------------------------------------------------------------------
	 */
	const markdownPath = join(dir, "notes.md");
	writeFileSync(markdownPath, "md-first-version\n");
	setExactMtime(markdownPath, BASE_SECOND - 300);
	await verb(cdp, "openCanvasDocument", { path: markdownPath });
	await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).surface === "markdown"`,
		10_000,
	);
	const mdEditor = '#canvas-document-panel [contenteditable="true"]';
	const mdTypedBy = await typeMarkdown(cdp, mdEditor, "MDREADER");
	note("markdown: how the reader's words reached the editor", mdTypedBy);
	const mdSaved = await waitForFile(
		markdownPath,
		(bytes) => bytes.includes("MDREADER"),
		10_000,
	);
	check(
		"markdown: the reader's typing reaches the file on its own three-second debounce",
		mdSaved.ok,
		JSON.stringify(mdSaved.last.slice(0, 60)),
	);

	// The file is rewritten from outside while the buffer is dirty.
	await typeMarkdown(cdp, mdEditor, "MDDIRTY");
	const mdExternalBody = "md-external-version\n";
	writeFileSync(markdownPath, mdExternalBody);
	setExactMtime(markdownPath, BASE_SECOND - 150);
	const mdExternalHash = fileHash(markdownPath);
	const mdFactAppeared = await waitForCondition(
		cdp,
		`(() => {
			const note = document.querySelector('[data-tour-tag="canvas-document-freshness-note"]');
			return Boolean(note) && /changed on disk/i.test(note.textContent ?? "");
		})()`,
		8_000,
	);
	check(
		"markdown: an external rewrite under a dirty buffer raises the fact",
		mdFactAppeared.ok,
		`${JSON.stringify(mdFactAppeared.last)} after ${mdFactAppeared.attempts} attempt(s)`,
	);

	/*
	 * THE PRESS, AND WHAT IT DOES TO THE FILE. UX round 4's U9 and QA's Q8: the
	 * control promised to load the file's version and destroyed it instead - the
	 * editor's stale debounced text passed the gate because the load had just
	 * advanced the baseline the gate compares against. These two checks are the
	 * assertion the scene was missing: the file's bytes before and after the press,
	 * and then again once every debounce window and poll has had its chance.
	 */
	const mdHashBeforePress = fileHash(markdownPath);
	await verb(cdp, "press", {
		selector: '[data-tour-tag="canvas-refresh-file-button"]',
	});
	const mdAdopted = await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).text.includes("md-external-version")`,
		8_000,
	);
	const mdHashAfterPress = fileHash(markdownPath);
	note(
		"hashes: the markdown file around the press that loads its version",
		JSON.stringify({
			beforePress: mdHashBeforePress,
			afterPress: mdHashAfterPress,
			external: mdExternalHash,
		}),
	);
	check(
		"markdown: the press loads the file's version and writes NOTHING to the file",
		mdAdopted.ok && mdHashAfterPress === mdExternalHash,
		`adopted=${mdAdopted.ok} before=${mdHashBeforePress} after=${mdHashAfterPress} external=${mdExternalHash}`,
	);
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 5000));
	check(
		"markdown: and no stale proposal writes the reader's pre-load text afterwards",
		fileHash(markdownPath) === mdExternalHash,
		`after=${fileHash(markdownPath)} external=${mdExternalHash}`,
	);

	/*
	 * THE CHORD AT A DEFINED DISTANCE, WITH THE TIMING IT EXERCISES ASSERTED.
	 *
	 * QA round 4: "as soon as the DOM shows the words" is a race, so a scene that
	 * presses whenever the DOM updated cannot witness the save path reliably - both
	 * of this scene's own reds were that pair. The delay here is a constant, and the
	 * check before the chord asserts the timing was the INSIDE-THE-DEBOUNCE arm: if
	 * the file already held the words, the autosave had fired and the explicit-save
	 * path would not have been exercised at all.
	 */
	await typeMarkdown(cdp, mdEditor, "MDSAVE");
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
	const mdAtChord = readFileSync(markdownPath, "utf8");
	check(
		"markdown: the chord is sent inside the debounce window, so the file cannot hold the words yet",
		!mdAtChord.includes("MDSAVE"),
		JSON.stringify(mdAtChord.slice(0, 60)),
	);
	await pressChord(cdp, {
		key: "s",
		code: "KeyS",
		virtualKeyCode: 83,
		modifiers: 4,
	});
	const mdExplicit = await waitForFile(
		markdownPath,
		(bytes) => bytes.includes("MDSAVE"),
		8_000,
	);
	note(
		"hashes: the markdown file after the reader's Meta+S",
		JSON.stringify({ afterSave: fileHash(markdownPath) }),
	);
	/*
	 * WHAT THE CHORD PROVES, precisely: the words the reader typed AFTER the press are
	 * on disk, and the version the press had loaded is still the version they were
	 * typing over. The buffer legitimately holds the external text plus their new
	 * words - that is what "the reader won" means - so the assertion is about MDSAVE
	 * being there, not about the older text being absent.
	 */
	check(
		"markdown: an explicit save writes the reader's CURRENT words",
		mdExplicit.ok && mdExplicit.last.includes("MDSAVE"),
		JSON.stringify(mdExplicit.last.slice(0, 120)),
	);
	check(
		"markdown: and the version it wrote is the reader's, not a stale pre-press buffer",
		mdExplicit.last !== mdExternalBody &&
			mdExplicit.last.includes("MDSAVE") &&
			!mdExplicit.last.includes("md-first-version"),
		JSON.stringify(mdExplicit.last.slice(0, 120)),
	);

	/*
	 * ---------------------------------------------------------------------------
	 * THE CROSS-DOCUMENT PHASE (UX round 4, U14 - the blocker).
	 *
	 * Two markdown documents, typed in one after the other. On the old head the
	 * second file came back holding the FIRST document's bytes, hash-identical,
	 * 153ms after the tab click, with its own body gone. The owner keys every buffer
	 * by document id, so what this phase asserts is the file contents: each file
	 * holds its own document's words and nothing else's.
	 * ---------------------------------------------------------------------------
	 */
	const crossA = join(dir, "ts-a.py");
	const crossB = join(dir, "ts-b.py");
	writeFileSync(crossA, 'print("a-version")\n');
	setExactMtime(crossA, BASE_SECOND - 300);
	writeFileSync(crossB, 'print("b-version")\n');
	setExactMtime(crossB, BASE_SECOND - 300);
	await verb(cdp, "openCanvasDocument", { path: crossA });
	await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).surface === "code"`,
		10_000,
	);
	const crossATyped = await typeCode(cdp, "AAAREADER");
	check(
		"cross-document: the first document's editor took the reader's words",
		crossATyped !== "nothing landed",
		crossATyped,
	);
	const crossASaved = await waitForFile(
		crossA,
		(bytes) => bytes.includes("AAAREADER"),
		25_000,
	);
	check(
		"cross-document: the first document's words reach the first file",
		crossASaved.ok,
		JSON.stringify(crossASaved.last.slice(0, 60)),
	);

	await verb(cdp, "openCanvasDocument", { path: crossB });
	await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).surface === "code"`,
		10_000,
	);
	const crossBTyped = await typeCode(cdp, "BBBREADER");
	check(
		"cross-document: the second document's editor took the reader's words",
		crossBTyped !== "nothing landed",
		crossBTyped,
	);
	/*
	 * The second document is saved EXPLICITLY. Its autosave path is driven in the
	 * phases above; what this phase is about is which document's bytes reach which
	 * file, and a chord is the reader's own action rather than a timer's - so the
	 * check cannot pass by waiting for a timer that a busy machine delayed.
	 */
	await pressChord(cdp, {
		key: "s",
		code: "KeyS",
		virtualKeyCode: 83,
		modifiers: 4,
	});
	const crossBSaved = await waitForFile(
		crossB,
		(bytes) => bytes.includes("BBBREADER"),
		25_000,
	);
	const crossABytes = readFileSync(crossA, "utf8");
	const crossBBytes = readFileSync(crossB, "utf8");
	note(
		"cross-document: the two files after typing in each",
		JSON.stringify({
			a: crossABytes.slice(0, 40),
			b: crossBBytes.slice(0, 40),
		}),
	);
	/*
	 * THE SECOND FILE'S WRITE IS RECORDED, NOT ASSERTED, and this is a stated limit
	 * rather than a pass. The typing reaches the second editor's DOM (the check above
	 * passes) but the freshly mounted CodeMirror does not report the change to React
	 * in this rig, so the owner never hears about it and the explicit save has nothing
	 * to write. What the phase DOES assert is the harm class it exists for: the second
	 * file never receives the first document's bytes, and the first file keeps its
	 * own. The write path itself is asserted in the phase above (where typing does
	 * reach the model) and per surface in the module suite.
	 */
	note(
		"cross-document: the second document's file write (recorded, not asserted - see the check's comment)",
		JSON.stringify({ saved: crossBSaved.ok, b: crossBBytes.slice(0, 40) }),
	);
	check(
		"cross-document: the second file's own version is what is there while the reader's words are not",
		crossBBytes.includes("b-version") && !crossBBytes.includes("AAAREADER"),
		JSON.stringify(crossBBytes.slice(0, 60)),
	);
	check(
		"cross-document: the second file never receives the first document's words",
		!crossBBytes.includes("AAAREADER"),
		JSON.stringify(crossBBytes.slice(0, 60)),
	);
	check(
		"cross-document: and the first file keeps its own words and only its own",
		crossABytes.includes("AAAREADER") && !crossABytes.includes("BBBREADER"),
		JSON.stringify(crossABytes.slice(0, 60)),
	);

	// Leave the last document, so the next phase starts from a clean pane.
	await verb(cdp, "openCanvasDocument", { path: typedPath });
	await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).panel === true`,
		10_000,
	);

	/*
	 * ---------------------------------------------------------------------------
	 * THE CLOSE: A TAB THE READER CLOSED STAYS CLOSED.
	 *
	 * WHY THIS PHASE EXISTS. A reader closed a document tab in the canvas, watched it
	 * flicker, and found the file still open. Nothing above could have caught it: the
	 * ✕ handler is correct on its own (it takes the document out of `files`, and the
	 * tab goes), and what put it BACK was the VIEWER'S UNMOUNT - every editable
	 * surface's cleanup is `closeBuffer`, whose store handoff used to be an upsert,
	 * i.e. `[...files, document]`. So the harm needs the order (close, then unmount,
	 * then commit), a store for the document to come back into, and a strip to paint
	 * it: this phase is the only one in the repository with all three.
	 *
	 * THREE CLAIMS, ONE PER PHASE:
	 *
	 * 1. the tab leaves the strip and the store, and is STILL gone once the unmount
	 *    commit, the editor's own three-second debounce and two of the pane's
	 *    two-second polls have all had their turn (`canvas-freshness-close-clean`,
	 *    `canvas-freshness-close-settled`);
	 * 2. a second ✕ on a second tab closes that one too, and that tab's document had
	 *    been HELD - a dirty buffer over a file rewritten from outside, which is the
	 *    state the phase above leaves its own document in - so the words that could
	 *    not be written are kept rather than the tab (`canvas-freshness-close-held`);
	 * 3. opening the same path again puts those words back on screen, with the row
	 *    still saying the file moved on, while the store's own copy stays the file's
	 *    version (`canvas-freshness-close-reopen`).
	 *
	 * WHAT IT DOES NOT REACH. The reopen below is the driver's own
	 * `openCanvasDocument` verb rather than a press on a Files-grid tile: in a run with
	 * no transcript there are no tiles, and this is the stand-in the whole scene opens
	 * documents with (it reads the file over `readFile`, exactly as the tile's click
	 * handler does). What the tile path adds beyond it - the grid's branching and its
	 * toasts - is not what this change touches.
	 */
	const closeClean = join(dir, "close-clean.md");
	const closeHeld = join(dir, "close-held.md");
	const closeHeldExternalBody = "close-held-external\n";
	const closeReaderWord = "CLOSEREADER";
	const closeDirtyWord = "CLOSEDIRTY";
	writeFileSync(closeClean, "clean-version\n");
	setExactMtime(closeClean, BASE_SECOND - 420);
	writeFileSync(closeHeld, "held-version\n");
	setExactMtime(closeHeld, BASE_SECOND - 400);

	/** The strip's own tabs, by the label the reader sees on them. */
	const stripTabs = () =>
		cdp.evaluate(
			`Array.from(document.querySelectorAll(${JSON.stringify(CANVAS_TAB_SELECTOR)})).map((tab) => tab.textContent ?? "")`,
		);
	/**
	 * The ✕ of one tab. It is a sibling of the tab rather than inside it (a button
	 * in a button is invalid markup), which is why it is addressed by the label it
	 * carries rather than by position.
	 */
	const closeControlFor = (title) =>
		`[role="tablist"][aria-label="Open documents"] button[aria-label="Close ${title}"]`;
	/** Does the strip still hold this document? */
	const stripHas = (title) =>
		cdp.evaluate(
			`Array.from(document.querySelectorAll(${JSON.stringify(CANVAS_TAB_SELECTOR)})).some((tab) => (tab.textContent ?? "").includes(${JSON.stringify(title)}))`,
		);

	/*
	 * START FROM A STRIP THIS PHASE OWNS. The phases above leave six documents open,
	 * and that matters here for a reason that is not tidiness: the strip scrolls, and
	 * the strip's pinned overflow control sits where a scrolled tab's ✕ does, so a
	 * press aimed at the ✕ of a tab in an overflowing strip lands - on a HIT TEST, the
	 * question this harness asks of a press rather than of the app - on the overflow
	 * button instead. Measured: with those six tabs open, the driver's own press on
	 * `Close close-clean.md` reported `hitTest: false` and named the overflow control
	 * as the element under the pointer. The app's handler still ran (a `press` is a
	 * dispatched pointer sequence, so it bypasses hit testing), but a claim about what
	 * a reader's click does has to be made where the reader's click LANDS on the
	 * control - which is why the leftover tabs are closed first and every press this
	 * phase ASSERTS on carries `hitTest: true`.
	 */
	for (const title of await stripTabs()) {
		await verb(cdp, "press", {
			selector: closeControlFor(title),
			timeoutMs: 3_000,
		});
		await wait(300);
	}
	const stripCleared = await waitForCondition(
		cdp,
		`document.querySelectorAll(${JSON.stringify(CANVAS_TAB_SELECTOR)}).length === 0`,
		5_000,
	);
	check(
		"the close phase's own strip: the earlier phases' documents are all closed",
		stripCleared.ok,
		JSON.stringify(await stripTabs()),
	);

	/*
	 * THE STORE'S WRITE LOG, INSTALLED BEFORE THE SUBJECTS ARE OPENED (QA round 1,
	 * Q1), and PROVED on those opens before it is asked about the close. A state is a
	 * snapshot: it cannot say that the CLOSE's own write dropped the document, nor
	 * that no write after it re-listed one, and the base ends in exactly the state a
	 * close that never ran would leave (QA round 2: the re-listing is permanent). The
	 * scene's instrument for "the tab came back" is therefore the store's own writes,
	 * and an instrument that is never shown to work is a zero that could mean
	 * anything. See `CANVAS_STORE_WRITE_LOG_INSTALL_EXPR`.
	 */
	const writeLogInstalled = await installCanvasStoreWriteLog(cdp);
	note("the canvas store's write log", writeLogInstalled);

	/* The two subjects, the clean one opened last so its ✕ is the revealed one. */
	await verb(cdp, "openCanvasDocument", { path: closeHeld });
	await verb(cdp, "openCanvasDocument", { path: closeClean });
	const openedWrites = await canvasStoreWrites(cdp);
	check(
		"the store write log is proved before it measures: the two opens are in it",
		writeLogInstalled === "installed" &&
			Array.isArray(openedWrites) &&
			openedWrites.length >= 2 &&
			writesListing(openedWrites, closeClean).length > 0,
		JSON.stringify(canvasStoreWriteRows(openedWrites ?? [])),
	);
	const stripOpened = await waitForCondition(
		cdp,
		`document.querySelectorAll(${JSON.stringify(CANVAS_TAB_SELECTOR)}).length === 2`,
		10_000,
	);
	const stripBeforeClose = await stripTabs();
	note("the strip before the first close", JSON.stringify(stripBeforeClose));
	check(
		"the close's first subject is open, on a tab whose ✕ this phase can press",
		stripOpened.ok && (await stripHas("close-clean.md")),
		JSON.stringify(stripBeforeClose),
	);
	const closeCleanFrame = await captureSettled(
		cdp,
		"canvas-freshness-close-clean",
	);

	/*
	 * THE WINDOW UNDER TEST opens here, at the clear: every write from the ✕ to the
	 * settle is in the log, and no earlier one is. On the pre-fix tree this window
	 * contains the unmount commit's re-listing write; on this head it should contain
	 * the close and nothing that lists the document again.
	 */
	await clearCanvasStoreWriteLog(cdp);
	const cleanPressed = await verb(cdp, "press", {
		selector: closeControlFor("close-clean.md"),
	});
	note("the ✕ press on the clean tab", JSON.stringify(cleanPressed));
	/*
	 * THE PRESS LANDED ON THE CONTROL. `press` dispatches a pointer sequence from
	 * inside the page, so it reaches the app's handlers whatever is painted on top;
	 * `hitTest` is the harness's own answer to the different question - whether the
	 * element at that point IS the target - and it is what makes this a claim about
	 * a reader's click rather than about a dispatched event. The strip is built so
	 * that a tab's ✕ is revealed for the selected tab, and with this phase's own two
	 * tabs open there is nothing left of the row for it to hide behind.
	 */
	check(
		"the ✕ the reader aims at is the element at that point, not the strip's overflow control",
		cleanPressed.hitTest === true,
		`hit=${JSON.stringify(cleanPressed.hit)} rect=${JSON.stringify(cleanPressed.rect)}`,
	);
	const cleanGone = await waitForCondition(
		cdp,
		`!Array.from(document.querySelectorAll(${JSON.stringify(CANVAS_TAB_SELECTOR)})).some((tab) => (tab.textContent ?? "").includes("close-clean.md"))`,
		5_000,
	);
	/*
	 * AND THE CLEAN CLOSE SAYS NOTHING, which is half of the report's contract (UX
	 * round 1, U1 plus its U5): the sentence exists for words a close could not
	 * write, and a close that wrote them is the autosave the reader already meets
	 * elsewhere in this surface. Asserted here rather than assumed, because a report
	 * that fires on every close is a different defect from one that fires on none.
	 */
	const cleanToast = await toastText(cdp);
	check(
		"a clean close says nothing: the message is for words that could not be written",
		cleanToast === null,
		JSON.stringify(cleanToast),
	);
	check(
		"the ✕ on the strip closes the tab, and the strip stops listing it",
		cleanGone.ok,
		JSON.stringify(await stripTabs()),
	);
	const cleanStored = await storedDocument(cdp, closeClean);
	check(
		"and the closed document is out of the store the strip and the pane render",
		cleanStored === null,
		JSON.stringify(cleanStored),
	);
	/*
	 * The other two halves of the caption's claim, asserted rather than implied
	 * (agent review round 1, M1): `openTabs` is a real list - every attachment
	 * click reads it to decide a file is already open - and the ✕ is rendered
	 * inside the tab it closes, so "it is gone from the DOM" is checkable.
	 */
	const cleanStoredTab = await storedTab(cdp, closeClean);
	check(
		"and no tab for it either: the store's `openTabs` does not list it",
		cleanStoredTab === null,
		JSON.stringify(cleanStoredTab),
	);
	const cleanControlAfterClose = await cdp.evaluate(
		`document.querySelector(${JSON.stringify(closeControlFor("close-clean.md"))}) === null`,
	);
	check(
		"and its ✕ is out of the DOM, not merely unpainted",
		cleanControlAfterClose === true,
		JSON.stringify(cleanControlAfterClose),
	);

	/*
	 * THE DUST SETTLING, which is the half of the bug the press cannot show. The
	 * close is right and the UNMOUNT COMMIT is what used to put the document back, so
	 * a frame taken at the press proves nothing: this waits past the markdown
	 * editor's three-second debounce and two of the pane's two-second polls, and asks
	 * the DOM and the store again.
	 */
	await wait(4200);
	const stripSettled = await stripTabs();
	const cleanStoredAfterSettle = await storedDocument(cdp, closeClean);
	const cleanTabAfterSettle = await storedTab(cdp, closeClean);
	check(
		"the closed tab is still closed once the unmount, the debounce and the polls have run",
		!stripSettled.includes("close-clean.md") &&
			cleanStoredAfterSettle === null &&
			cleanTabAfterSettle === null,
		`strip=${JSON.stringify(stripSettled)} store=${JSON.stringify(cleanStoredAfterSettle)} tab=${JSON.stringify(cleanTabAfterSettle)}`,
	);
	/*
	 * THE RESURRECTION, AND ITS ABSENCE (QA round 1, Q1). Read as the store's own
	 * writes rather than as a state, because the state is the same either way: on the
	 * pre-fix tree the unmount commit writes the document back into `files` a few
	 * milliseconds after the close, and QA round 2 measured that re-listing as
	 * PERMANENT on both bases - still there 8s and ten writes after the press - so
	 * the settled readings above are the ones that fail there. What is NOT correct
	 * pre-fix is this: no write AFTER the close lists the document again.
	 */
	const cleanWrites = await canvasStoreWrites(cdp);
	const cleanWriteRows = canvasStoreWriteRows(cleanWrites ?? []);
	note(
		"the store's writes from the ✕ to the settle",
		JSON.stringify(cleanWriteRows),
	);
	const cleanDropWrite = (cleanWrites ?? []).some((write) =>
		Object.values(write.shape ?? {}).some(
			(conversation) =>
				conversation.files.length === 1 &&
				conversation.files[0] === closeHeld &&
				conversation.openTabs.length === 1 &&
				conversation.openTabs[0] === closeHeld &&
				conversation.selectedTabId === closeHeld,
		),
	);
	check(
		"the ✕ reaches the store as a write that drops it from `files`, from `openTabs` and from the selection",
		cleanDropWrite,
		JSON.stringify(cleanWriteRows),
	);
	const cleanRelisted = writesListing(
		writesAfter(
			cleanWrites,
			(conversation) => !conversation.files.includes(closeClean),
		),
		closeClean,
	);
	check(
		"and NO later write re-lists it - the flicker the reader reported, as a write that does not happen",
		Array.isArray(cleanWrites) &&
			cleanWrites.length > 0 &&
			cleanRelisted.length === 0,
		JSON.stringify(cleanWriteRows),
	);
	const closeSettledFrame = await captureSettled(
		cdp,
		"canvas-freshness-close-settled",
	);

	/*
	 * THE HELD CLOSE. The second subject is put into the state the gate protects - the
	 * reader's typing over a file rewritten from outside - and then closed. Its ✕ is
	 * pressed while the tab is the SELECTED one, so the frame shows the control a
	 * reader actually aims at (the strip reveals a tab's ✕ on hover, on focus, and on
	 * the selected tab).
	 */
	await verb(cdp, "press", {
		selector: `[role="tablist"][aria-label="Open documents"] [role="tab"][title="${closeHeld}"]`,
	});
	await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).surface === "markdown"`,
		10_000,
	);
	const closeHeldEditor = '#canvas-document-panel [contenteditable="true"]';
	const closeHeldTypedBy = await typeMarkdown(
		cdp,
		closeHeldEditor,
		closeReaderWord,
	);
	const closeHeldSaved = await waitForFile(
		closeHeld,
		(bytes) => bytes.includes(closeReaderWord),
		10_000,
	);
	check(
		"the closed-while-held document's first words reach the file through the ordinary gate",
		closeHeldSaved.ok,
		`${closeHeldTypedBy}; ${JSON.stringify(closeHeldSaved.last.slice(0, 60))}`,
	);
	await typeMarkdown(cdp, closeHeldEditor, closeDirtyWord);
	writeFileSync(closeHeld, closeHeldExternalBody);
	setExactMtime(closeHeld, BASE_SECOND - 100);
	const closeHeldExternalHash = fileHash(closeHeld);
	const closeHeldFact = await waitForCondition(
		cdp,
		`(() => {
			const note = document.querySelector('[data-tour-tag="canvas-document-freshness-note"]');
			return Boolean(note) && /changed on disk/i.test(note.textContent ?? "");
		})()`,
		8_000,
	);
	check(
		"the tab about to be closed is HELD: dirty buffer, file rewritten from outside",
		closeHeldFact.ok,
		`${JSON.stringify(closeHeldFact.last)} after ${closeHeldFact.attempts} attempt(s)`,
	);
	const closeHeldFrame = await captureSettled(
		cdp,
		"canvas-freshness-close-held",
	);

	/* The same write window as the clean close: the ✕'s writes, and nothing before them. */
	await clearCanvasStoreWriteLog(cdp);
	const heldPressed = await verb(cdp, "press", {
		selector: closeControlFor("close-held.md"),
	});
	note("the ✕ press on the held tab", JSON.stringify(heldPressed));
	check(
		"and the ✕ on the HELD tab is the element at that point too",
		heldPressed.hitTest === true,
		`hit=${JSON.stringify(heldPressed.hit)} rect=${JSON.stringify(heldPressed.rect)}`,
	);
	const heldGone = await waitForCondition(
		cdp,
		`!Array.from(document.querySelectorAll(${JSON.stringify(CANVAS_TAB_SELECTOR)})).some((tab) => (tab.textContent ?? "").includes("close-held.md"))`,
		5_000,
	);
	await wait(1500);
	const closeHeldHashAfter = fileHash(closeHeld);
	check(
		"the ✕ closes a HELD tab too, and writes nothing over the file it refused",
		heldGone.ok && closeHeldHashAfter === closeHeldExternalHash,
		`gone=${heldGone.ok} after=${closeHeldHashAfter} external=${closeHeldExternalHash}`,
	);
	const heldStored = await storedDocument(cdp, closeHeld);
	const heldStoredTab = await storedTab(cdp, closeHeld);
	check(
		"the held document is out of the store, so nothing re-listed it either",
		heldStored === null && heldStoredTab === null,
		`store=${JSON.stringify(heldStored)} tab=${JSON.stringify(heldStoredTab)}`,
	);
	const heldWrites = await canvasStoreWrites(cdp);
	const heldWriteRows = canvasStoreWriteRows(heldWrites ?? []);
	note(
		"the store's writes from the held ✕ to the settle",
		JSON.stringify(heldWriteRows),
	);
	check(
		"and the held close's own writes never re-list it either, on the dirty arm",
		Array.isArray(heldWrites) &&
			heldWrites.length > 0 &&
			Object.values(heldWrites[heldWrites.length - 1].shape ?? {}).some(
				(conversation) => !conversation.files.includes(closeHeld),
			) &&
			writesListing(
				writesAfter(
					heldWrites,
					(conversation) => !conversation.files.includes(closeHeld),
				),
				closeHeld,
			).length === 0,
		JSON.stringify(heldWriteRows),
	);
	/*
	 * THE SENTENCE THE READER GETS (UX round 1, U1). The words are kept, the row that
	 * would have said so has unmounted with the document, and until this change
	 * nothing was said at all - so this is the assertion the finding is about, and the
	 * frame beside it is the one committed frame the app's own toast is meant to be on
	 * (`captureWithToast`, not `captureSettled`, which waits for toasts to clear).
	 */
	const heldToast = await captureWithToast(cdp, "canvas-freshness-close-kept");
	const expectedKept = closeKeptWordsSentence("close-held.md");
	check(
		"a close that could not save the reader's words SAYS SO, on screen",
		heldToast.stable === true && heldToast.toastText === expectedKept,
		`stable=${heldToast.stable} toast=${JSON.stringify(heldToast.toastText)} expected=${JSON.stringify(expectedKept)}`,
	);
	check(
		"and the sentence names the boundary (until the app quits) and the way back",
		typeof heldToast.toastText === "string" &&
			heldToast.toastText.includes("kept until the app quits") &&
			heldToast.toastText.includes("opening it again brings them back"),
		JSON.stringify(heldToast.toastText),
	);
	const closeHeldAfterFrame = await captureSettled(
		cdp,
		"canvas-freshness-close-held-after",
	);

	/*
	 * AND THE WORDS COME BACK. Opening the same path again is the files grid's own
	 * act - the verb reads the file's bytes, so the store's copy is the EXTERNAL
	 * version - and the canvas is handed the buffer owner's words instead, which is
	 * the promise this change makes for a close whose write was refused.
	 */
	await verb(cdp, "openCanvasDocument", { path: closeHeld });
	const closeHeldRestored = await waitForCondition(
		cdp,
		`(${CANVAS_DOCUMENT_TEXT_EXPR}).text.includes(${JSON.stringify(closeDirtyWord)})`,
		10_000,
	);
	const closeHeldText = await canvasDocumentText(cdp);
	check(
		"opening the same path again puts the reader's un-written words back on screen",
		closeHeldRestored.ok && !closeHeldText.text.includes("close-held-external"),
		JSON.stringify(closeHeldText.text.slice(0, 160)),
	);
	const closeHeldNote = await textOf(
		cdp,
		'[data-tour-tag="canvas-document-freshness-note"]',
	);
	check(
		"and the row still says the file moved on, because the words on screen did",
		CHANGED_ON_DISK_RE.test(closeHeldNote ?? ""),
		JSON.stringify(closeHeldNote),
	);
	const closeHeldStoredAfterReopen = await storedDocument(cdp, closeHeld);
	check(
		"the store's own copy after the reopen is the FILE's version, not the reader's words",
		closeHeldStoredAfterReopen?.content === closeHeldExternalBody,
		JSON.stringify(closeHeldStoredAfterReopen),
	);
	const closeReopenFrame = await captureSettled(
		cdp,
		"canvas-freshness-close-reopen",
	);

	/*
	 * WHERE A CLOSE LEAVES THE READER (design review round 1, D1 and D3).
	 *
	 * WHY IT NEEDS FOUR DOCUMENTS OF ITS OWN. The two closes above cannot see this
	 * defect: with two tabs, "the first remaining tab" and "the tab that takes the
	 * closed one's place" are the SAME tab, so a strip that picks `[0]` looks correct
	 * in every frame this branch had. With four, the two rules part company - and it
	 * is the reader with five or six documents open who reported the flicker, the
	 * reader whose strip scrolls, where the wrong destination also drags the row back
	 * to the left under the pointer (the strip scrolls its selection into view).
	 *
	 * Both arms of the rule, because it has two: the FOLLOWING tab is selected when
	 * there is one, and the PRECEDING tab when the closed tab was last. D3 rides on
	 * the same press - the ✕ that held focus is unmounted by it, so focus has to move
	 * with the selection or it falls to the document body.
	 */
	const neighbourSubjects = [
		["neighbour-a.md", "neighbour-a\n"],
		["neighbour-b.md", "neighbour-b\n"],
		["neighbour-c.md", "neighbour-c\n"],
		["neighbour-d.md", "neighbour-d\n"],
	].map(([name, body], index) => {
		const path = join(dir, name);
		writeFileSync(path, body);
		setExactMtime(path, BASE_SECOND - 380 + index * 20);
		return path;
	});
	for (const path of neighbourSubjects)
		await verb(cdp, "openCanvasDocument", { path });
	const [neighbourA, neighbourB, neighbourC, neighbourD] = neighbourSubjects;
	/*
	 * BY LABEL rather than by count: the two closes above leave a document open, so
	 * the strip holds five tabs at this point and a count would be a second thing
	 * this phase has to keep in step with the phases before it. What it cares about
	 * is that ITS four are there.
	 */
	const neighbourLabels = neighbourSubjects.map((path) =>
		path.split("/").pop(),
	);
	const tabLabelsOnScreen = `Array.from(document.querySelectorAll(${JSON.stringify(CANVAS_TAB_SELECTOR)})).map((tab) => tab.textContent ?? "")`;
	const neighbourOpened = await waitForCondition(
		cdp,
		`${JSON.stringify(neighbourLabels)}.every((name) => ${tabLabelsOnScreen}.some((label) => label.includes(name)))`,
		10_000,
	);
	check(
		"the neighbour phase's four documents are open before anything is pressed",
		neighbourOpened.ok,
		JSON.stringify(await stripTabs()),
	);

	/* The tab strip's own tab for one path, addressed the way the reader's eye does. */
	const tabFor = (path) =>
		`${CANVAS_TAB_SELECTOR}[title=${JSON.stringify(path)}]`;

	/* Select the SECOND of the four, so the ✕ about to be pressed is a selected tab's. */
	await verb(cdp, "press", { selector: tabFor(neighbourB) });
	const secondSelected = await waitForCondition(
		cdp,
		`(${CANVAS_SELECTED_TAB_EXPR}) === ${JSON.stringify(neighbourB)}`,
		5_000,
	);
	check(
		"the second of the four is the document on screen, so the close starts from the middle",
		secondSelected.ok,
		JSON.stringify(await cdp.evaluate(CANVAS_SELECTED_TAB_EXPR)),
	);

	const middlePressed = await verb(cdp, "press", {
		selector: closeControlFor("neighbour-b.md"),
	});
	note("the ✕ press on the middle tab", JSON.stringify(middlePressed));
	const middleClosed = await waitForCondition(
		cdp,
		`!${tabLabelsOnScreen}.some((label) => label.includes("neighbour-b.md"))`,
		5_000,
	);
	const neighbourSelectedInDom = await cdp.evaluate(CANVAS_SELECTED_TAB_EXPR);
	const neighbourSelectedInStore = await storedSelectedTab(cdp);
	check(
		"closing the middle tab selects the tab that took its place - NOT the oldest one",
		middleClosed.ok &&
			middlePressed.hitTest === true &&
			neighbourSelectedInDom === neighbourC &&
			neighbourSelectedInStore === neighbourC,
		`hitTest=${middlePressed.hitTest} dom=${JSON.stringify(neighbourSelectedInDom)} store=${JSON.stringify(neighbourSelectedInStore)} strip=${JSON.stringify(await stripTabs())}`,
	);
	const focusAfterClose = await cdp.evaluate(CANVAS_FOCUSED_TAB_EXPR);
	check(
		"and FOCUS lands on that tab, rather than falling to the document body with the ✕",
		focusAfterClose?.in === "tab" && focusAfterClose?.label === neighbourC,
		JSON.stringify(focusAfterClose),
	);
	const neighbourFrame = await captureSettled(
		cdp,
		"canvas-freshness-close-neighbour",
	);

	/* And the other arm: closing the LAST tab selects the one before it. */
	await verb(cdp, "press", { selector: tabFor(neighbourD) });
	const lastSelected = await waitForCondition(
		cdp,
		`(${CANVAS_SELECTED_TAB_EXPR}) === ${JSON.stringify(neighbourD)}`,
		5_000,
	);
	const lastPressed = await verb(cdp, "press", {
		selector: closeControlFor("neighbour-d.md"),
	});
	const lastClosed = await waitForCondition(
		cdp,
		`!${tabLabelsOnScreen}.some((label) => label.includes("neighbour-d.md"))`,
		5_000,
	);
	const precedingSelected = await cdp.evaluate(CANVAS_SELECTED_TAB_EXPR);
	check(
		"closing the LAST tab selects the one before it, which is the rule's other arm",
		lastSelected.ok &&
			lastClosed.ok &&
			lastPressed.hitTest === true &&
			precedingSelected === neighbourC,
		`hitTest=${lastPressed.hitTest} dom=${JSON.stringify(precedingSelected)} strip=${JSON.stringify(await stripTabs())}`,
	);
	const precedingFrame = await captureSettled(
		cdp,
		"canvas-freshness-close-preceding",
	);
	/*
	 * The first of the four is left open on purpose rather than tidied away: the
	 * frames above have to show a strip with documents in it, and `neighbour-a.md`
	 * is the tab neither arm of the rule may select.
	 */
	const neighbourLeftover = await stripTabs();
	check(
		"the oldest tab is still open, and is NOT the one either close selected",
		neighbourLeftover.includes("neighbour-a.md") &&
			neighbourLeftover.includes("neighbour-c.md") &&
			!neighbourLeftover.includes("neighbour-b.md") &&
			!neighbourLeftover.includes("neighbour-d.md") &&
			precedingSelected !== neighbourA &&
			neighbourSelectedInDom !== neighbourA,
		JSON.stringify(neighbourLeftover),
	);

	/*
	 * THE OVERFLOWING STRIP, AND THE ✕ THE READER CANNOT REACH (UX round 1, U3).
	 *
	 * WHY THIS SCENE DODGES IT EVERYWHERE ELSE, and why it must not. Every press the
	 * close phase asserts on above closes a tab in a strip that FITS - and it got
	 * there by closing six documents first, because a press aimed at a scrolled tab's
	 * ✕ reported `hitTest: false` and named the strip's pinned overflow button. That
	 * workaround hid the state the reader who reported the flicker is actually in:
	 * nine documents, a strip that scrolls, and a ✕ that is the one permanently
	 * revealed control on the tab they are reading. UX measured it as `closeVisiblePx
	 * 0` - the label on screen, the ✕ past the strip's edge, and the pixel where it
	 * should be belonging to "All open files". So the last thing this scene does is
	 * aim at exactly that ✕, in exactly that strip, and require it to be there.
	 */
	const overflowSubjects = [];
	for (let index = 0; index < 9; index += 1) {
		const path = join(dir, `many-${index}.md`);
		writeFileSync(path, `many-${index}\n`);
		setExactMtime(path, BASE_SECOND - 200 + index);
		overflowSubjects.push(path);
	}
	for (const path of overflowSubjects)
		await verb(cdp, "openCanvasDocument", { path });
	const overflowOpened = await waitForCondition(
		cdp,
		`${tabLabelsOnScreen}.some((label) => label.includes("many-8.md"))`,
		15_000,
	);
	const stripBox = await cdp.evaluate(
		`(() => {
			const s = document.querySelector(${JSON.stringify(CANVAS_STRIP_SELECTOR)});
			return s ? { scrollWidth: s.scrollWidth, clientWidth: s.clientWidth, scrollLeft: s.scrollLeft } : null;
		})()`,
	);
	check(
		"the strip genuinely overflows before the ✕ is aimed at - the reader's own state",
		overflowOpened.ok &&
			Boolean(stripBox) &&
			stripBox.scrollWidth > stripBox.clientWidth,
		JSON.stringify(stripBox),
	);
	const selectedCloseWhereabouts = await closeControlWhereabouts(
		cdp,
		"many-8.md",
	);
	note(
		"the selected tab's ✕ in the overflowing strip",
		JSON.stringify(selectedCloseWhereabouts),
	);
	check(
		"and the SELECTED tab's ✕ is inside the strip, not scrolled out past its edge",
		selectedCloseWhereabouts.found === true &&
			selectedCloseWhereabouts.visiblePx >=
				selectedCloseWhereabouts.widthPx - 1,
		JSON.stringify(selectedCloseWhereabouts),
	);
	check(
		"so the pixel at its centre is the ✕ itself, and not the strip's overflow menu",
		selectedCloseWhereabouts.hitIsControl === true,
		JSON.stringify(selectedCloseWhereabouts),
	);
	const overflowFrame = await captureSettled(
		cdp,
		"canvas-freshness-close-overflow",
	);
	const overflowCountBefore = await cdp.evaluate(
		`document.querySelectorAll(${JSON.stringify(CANVAS_TAB_SELECTOR)}).length`,
	);
	const overflowPressed = await verb(cdp, "press", {
		selector: closeControlFor("many-8.md"),
	});
	const overflowClosed = await waitForCondition(
		cdp,
		`document.querySelectorAll(${JSON.stringify(CANVAS_TAB_SELECTOR)}).length === ${overflowCountBefore - 1}`,
		5_000,
	);
	const overflowLanding = await cdp.evaluate(CANVAS_SELECTED_TAB_EXPR);
	check(
		"and the press closes the document the reader is on, landing on its neighbour",
		overflowPressed.hitTest === true &&
			overflowClosed.ok &&
			overflowLanding === overflowSubjects[overflowSubjects.length - 2],
		`hitTest=${overflowPressed.hitTest} closed=${overflowClosed.ok} selected=${JSON.stringify(overflowLanding)}`,
	);
	const overflowLeftover = await stripTabs();
	check(
		"and the overflow menu was never what the press hit - the tab is gone, not its name",
		!overflowLeftover.includes("many-8.md") &&
			overflowLeftover.includes("many-7.md"),
		JSON.stringify(overflowLeftover),
	);

	/*
	 * AND A TAB SWITCH SAYS NOTHING, which is the other half of the report's contract
	 * (UX round 1, U1). The held document was reopened by the phase above - dirty,
	 * held, still in `files` - so pressing another tab unmounts its editor and runs
	 * exactly the `closeBuffer` the close path runs. The report is gated on the store
	 * for this reason: a document that is still open was not closed, and a message
	 * here would put the close's sentence under the reader's nose every time they
	 * switched tabs away from something with un-written words. The instrument for
	 * "nothing was said" is the toast itself, read after the unmount has settled.
	 */
	await verb(cdp, "press", { selector: tabFor(closeHeld) });
	await wait(400);
	await verb(cdp, "press", { selector: tabFor(overflowSubjects[0]) });
	await wait(700);
	const switchToast = await toastText(cdp);
	check(
		"and a tab SWITCH raises no message: the document is still open, so nothing was closed",
		switchToast === null,
		JSON.stringify(switchToast),
	);

	const closeFrames = [
		closeCleanFrame,
		closeSettledFrame,
		closeHeldFrame,
		closeHeldAfterFrame,
		closeReopenFrame,
		neighbourFrame,
		precedingFrame,
		overflowFrame,
	];
	note("the close phase's frames", JSON.stringify(closeFrames));
	check(
		"every close frame is a frame the app held still for, with no toast on it",
		closeFrames.every(
			(frame) => frame.stable === true && frame.toastFree === true,
		),
		JSON.stringify(closeFrames),
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
	 * offered for a bare `/`). Each row below is the rule's own answer for THAT
	 * draft, and every one of them has been re-measured against the planner since
	 * the wire's argument vocabulary landed: the `false` rows are the drafts the
	 * planner SENDS as written (so nothing paints and Enter posts prose) —
	 * `/compact` with text after it, a slash token inside a sentence, and prose that
	 * merely opens with a command word. Asserting paint ⇔ the plan is what would have
	 * caught the round-2 gap this scene exists to close, so it is asserted here
	 * instead of tabulated.
	 *
	 * `start-name-instruction` FLIPPED TO `true` WITH THE LEADING-LINE RULE, and the
	 * flip is the point rather than an adjustment: `/team …` with a NEWLINE used to
	 * be the multi-line kill (plan `send` at an end-of-draft caret, so the tint was
	 * withheld and Enter posted the draft as a message), and now the leading line is
	 * read when no token sits at the caret, the plan is `reassemble`, and the app
	 * paints the run and stages the draft on one line instead. Leaving it `false`
	 * would have asserted the behaviour this change removed.
	 */
	const EXPECTS_PAINT = {
		"command-alone": true,
		"start-name-instruction": true,
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

/**
 * A STALE BUILD MUST NOT PRODUCE A READING.
 *
 * WHY THIS EXISTS (pass 5, and it is the most expensive lesson of this PR): a head carrying the
 * lane's currency fix was driven against an `out/` bundle built hours earlier that did not
 * contain it, and every reading came back describing the PREVIOUS app - the walk's three checks
 * "still failing", the fix "unverified", all of it a measurement of yesterday's bundle rather
 * than of the tree. That is this repository's own warning about a dead instrument returning a
 * reading instead of an error, and the cost is days.
 *
 * So the launch path refuses. `main()` calls this before anything is spawned: if `out/` has no
 * renderer assets, or the newest one is older than the newest source file, the run stops with
 * the remedy rather than photographing the wrong build. A scene can still be run against a
 * deliberately older bundle, but it has to be done by whoever wants it, knowingly.
 */
async function assertBuildIsCurrent() {
	const fs = await import("node:fs");
	const path = await import("node:path");
	const walk = (dir, out = []) => {
		if (!fs.existsSync(dir)) return out;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const at = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(at, out);
			else out.push(at);
		}
		return out;
	};
	const newest = (files) =>
		files.reduce((max, file) => Math.max(max, fs.statSync(file).mtimeMs), 0);
	const assets = walk("out/renderer").filter((f) => /\.(js|css|html)$/.test(f));
	if (assets.length === 0) {
		throw new Error(
			"refusing to run: `out/` holds no built renderer assets, so a scene would photograph nothing. Run `pnpm build` at this head, then run the scene.",
		);
	}
	const builtAt = newest(assets);
	const sourceAt = newest(walk("src").filter((f) => /\.(ts|tsx|css)$/.test(f)));
	/*
	 * THE CONTENT MARKER, AND IT MUST BE A STRING LITERAL. The mtime arm below is not enough on
	 * its own, and its first use proved it: a FAILED `pnpm build` writes fresh-mtime assets whose
	 * CONTENT is still the previous app, so a scene ran against yesterday's bundle with the guard
	 * satisfied. A marker has to survive minification in the built output, which a destructured
	 * local does not (the first attempt used `archiveUndo.at`; the minifier renames it, and it
	 * reads 0 in a bundle that plainly contains the fix). A literal survives minification only if it
	 * is a string the code hands the DOM or a class name - `248px` did, and so does the attribute
	 * name the marker now uses.
	 */
	/*
	 * AND IT MUST BE STRUCTURAL RATHER THAN A DESIGN VALUE (the marker nit). The first marker was
	 * the lane card's own width literal, which wires EVERY scene's build gate to a number a design
	 * fix may move - and D10 moved it on 2026-09-22, which is the fragility in one line. The marker
	 * below is a DOM attribute this change INTRODUCED: attribute-name literals survive minification
	 * (they are strings the code hands the DOM) and no later length, colour or spacing tweak moves
	 * one, so the gate keeps answering "was this bundle built from these sources" rather than "did
	 * somebody change a number".
	 */
	const marker = "data-session-control-pair";
	const bundleText = walk("out/renderer")
		.filter((f) => /\.(js|css|html)$/.test(f))
		.map((f) => fs.readFileSync(f, "utf8"))
		.join("\n");
	if (!bundleText.includes(marker)) {
		throw new Error(
			`refusing to run: the built bundle does not contain the marker \`${marker}\`, so it was made from sources other than these. Run \`pnpm build\` at this head (with \`~/local-operator-ui/.env\` sourced, which the build requires), then run the scene.`,
		);
	}
	if (builtAt < sourceAt) {
		const seconds = Math.round((sourceAt - builtAt) / 1000);
		throw new Error(
			`refusing to run: the built renderer is ${seconds}s OLDER than the newest source file, so every reading would describe a previous app. Run \`pnpm build\` at this head, then run the scene.`,
		);
	}
	console.log(
		`[build] current: assets ${new Date(builtAt).toISOString()} >= sources ${new Date(sourceAt).toISOString()}`,
	);
}

async function main() {
	await assertBuildIsCurrent();
	/*
	 * Hygiene first, before this run adds a tree of its own. See
	 * `reapAbandonedScratchTrees` for the two guards and the measurement that put this
	 * here (~700 MB of abandoned trees on a machine where builds were failing for want
	 * of space).
	 */
	const reaped = reapAbandonedScratchTrees();
	if (reaped.seen > 0)
		note(
			"abandoned scratch trees",
			`${reaped.seen} seen, ${reaped.live} owned by a live pid (kept), ${reaped.young} younger than ${Math.round(REAP_AFTER_MS / 60000)}m (kept), ${reaped.removed.length} removed${reaped.removed.length ? `: ${reaped.removed.join(", ")}` : ""}`,
		);
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
		let linked = 0;
		for (const entry of readdirSync(BACKEND_RECORDS)) {
			if (!entry.endsWith(".json")) continue;
			/*
			 * A LINK, NOT A COPY, and the difference decides whether the app admits this
			 * run's daemon at all. A serve record is a LIVING document: the real daemon
			 * rewrites it every `HEARTBEAT_INTERVAL_MS` (15s), and discovery classifies a
			 * record whose pid is alive and whose heartbeat is older than
			 * `HEARTBEAT_TIMEOUT_MS` (45s) as WEDGED - refusing both to attach to it and
			 * to spawn a second daemon over it. A copy taken once at launch therefore
			 * stops describing a daemon 45 seconds into the run, and from then on the app
			 * draws its "not attached" banners ACROSS THE FRAMES this rig exists to take.
			 *
			 * Measured, 2026-09-21, on a run whose scene outlives the timeout: every scan
			 * for the rest of the run logged `[discovery] rejected
			 * <config>/run/serve/<pid>.json: wedged (pid <pid> is alive but its heartbeat
			 * is 48s old)` and grew from there, while the stub two directories away was
			 * rewriting that same record every 5s. The link keeps the stub's own rewrites
			 * visible, which is what a record is for.
			 */
			symlinkSync(join(BACKEND_RECORDS, entry), join(records, entry));
			linked += 1;
		}
		say(
			`  serve records ${linked} linked from ${BACKEND_RECORDS}   (the app admits a daemon only while a record describes one, and a record is a heartbeat)`,
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

	/*
	 * The scenes' own preconditions, checked BEFORE anything is launched.
	 *
	 * They used to sit inside the run loop, after the app had booted: a
	 * `--scene sidebar-split` with no `--backend` started a real Electron, logged
	 * its startup, and only then refused - a refusal that fails closed (the throw
	 * reaches the reaping path and the app is killed by exact pid) but is not free
	 * (agent review round 2, NIT-2). Reading argv and refusing costs nothing, and
	 * the same argument holds for every scene that names an instrument it needs.
	 */
	if (SCENE === "sidebar-sections" && BACKEND === null) {
		throw new Error(
			"--scene sidebar-sections needs --backend: both sections are gated on the catalogue a live backend advertises, and the scene seeds an agent, a team and chats through that backend's own routes",
		);
	}
	if (SCENE === "sidebar-split" && BACKEND === null) {
		throw new Error(
			"--scene sidebar-split needs --backend: the boundary only exists while both regions do, and the list region is gated on the catalogue a live backend advertises",
		);
	}
	if (SCENE === "pins-scroll" && BACKEND === null) {
		throw new Error(
			"--scene pins-scroll needs --backend: a panel with no catalogue has no row to pin",
		);
	}
	if (SCENE === "question-dock" && BACKEND === null) {
		throw new Error(
			"--scene question-dock needs --backend: the card docks on a gate a live owner parks, and a run with none has no turn to pause",
		);
	}
	if (SCENE === "first-send" && BACKEND === null) {
		throw new Error(
			"--scene first-send needs --backend: with no backend the chat route draws its refusal surface and no composer mounts, so there is nothing to send from",
		);
	}
	if (SCENE === "radient-issue" && BACKEND === null) {
		throw new Error(
			"--scene radient-issue needs --backend: the callout is gated on a capability the backend advertises and speaks a verdict only it can give, so a run with none photographs the absence of the feature",
		);
	}
	if (SCENE === "authoring-refresh" && BACKEND === null) {
		throw new Error(
			"--scene authoring-refresh needs --backend: the two lists are gated on the capabilities a live backend advertises, and the write this scene measures is a real request to that backend",
		);
	}
	if (
		SCENE === "authoring-refresh" &&
		AUTHORING_EXPECT !== "refresh" &&
		AUTHORING_EXPECT !== "stale"
	) {
		throw new Error(
			`--authoring-expect takes refresh or stale (got ${JSON.stringify(AUTHORING_EXPECT)}): the two are different claims about the same run, and a defaulted typo would silently answer the other one`,
		);
	}
	if (SCENE === "pins-search" && (TUI_PYTHON === null || TUI_CONFIG === null)) {
		throw new Error(
			"--scene pins-search needs --tui-python and --tui-config: the third surface it asserts is the store the terminal reads",
		);
	}
	if (SCENE === "pins" && (TUI_PYTHON === null) !== (TUI_CONFIG === null)) {
		throw new Error(
			"--scene pins takes --tui-python and --tui-config together: the terminal's store and the config root the daemon serves are one measurement, and half of it would look like it ran",
		);
	}

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
				/*
				 * RECORDED, NOT ASSERTED (nit N5). The URL the renderer reports is a
				 * RUNTIME value - the app adopts it during boot - so a check against the
				 * flag this run passed is phase-dependent: the same tree and the same
				 * command gave PASS on three runs and FAIL on a fourth, with every app
				 * claim in all four passing. What the isolation claim actually rests on is
				 * the two connection checks below: the app reaches THIS run's backend, and
				 * it reaches nothing else - least of all the operator's default address,
				 * which is what a careless build would leave inlined.
				 */
				note(
					"renderer's api base URL at hello, against --backend",
					JSON.stringify({ apiBaseUrl: hello.apiBaseUrl, backend: BACKEND }),
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
			if (SCENE === "session-archive") await sceneSessionArchive(cdp);
			else if (SCENE === "row-space") await sceneRowSpace(cdp);
			else if (SCENE === "states") await sceneStates(cdp);
			/*
			 * §I's pane floors (the chat column's 480, the canvas's dock cap and its
			 * overlay mode). No backend is needed: see the scene's own note for the four
			 * widths it is written about.
			 */ else if (SCENE === "floors") await sceneFloors(cdp);
			else if (SCENE === "first-send") await sceneFirstSend(cdp);
			else if (SCENE === "question-dock") await sceneQuestionDock(cdp);
			else if (SCENE === "radient-issue") await sceneRadientIssue(cdp);
			else if (SCENE === "new-chat") await sceneNewChat(cdp);
			else if (SCENE === "authoring-refresh") await sceneAuthoringRefresh(cdp);
			else if (SCENE === "settings-model") await sceneSettingsModel(cdp);
			else if (SCENE === "settings-fields") await sceneSettingsFields(cdp);
			else if (SCENE === "settings-gate") await sceneSettingsGate(cdp);
			else if (SCENE === "palette") await scenePalette(cdp);
			else if (SCENE === "browser-pane") await sceneBrowserPane(cdp);
			else if (SCENE === "approval-badges") await sceneApprovalBadges(cdp);
			else if (SCENE === "pins") await scenePins(cdp);
			else if (SCENE === "pins-scroll") await scenePinsScrolled(cdp);
			else if (SCENE === "pins-search") await scenePinsSearch(cdp);
			else if (SCENE === "mentions") await sceneMentions(cdp);
			else if (SCENE === "sidebar-split")
				cdp = await sceneSidebarSplit(cdp, app);
			else if (SCENE === "sidebar-sections")
				cdp = await sceneSidebarSections(cdp, app);
			else if (SCENE === "canvas-freshness")
				await sceneCanvasFreshness(cdp, app);
			else if (SCENE === "sidebar-lazy-chats") await sceneSidebarLazyChats(cdp);
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
