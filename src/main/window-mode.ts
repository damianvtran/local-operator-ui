/**
 * How the app's window behaves at launch, resolved before any window exists.
 *
 * Why this exists. This app is driven by agents on the operator's own desktop:
 * a QA harness launches the built app and drives it over CDP, a renderer change
 * gets checked with `pnpm dev`, and every one of those runs used to end at
 * `ready-to-show` with `show()` — which activates the app and takes the
 * operator's keyboard focus. A QA matrix of seven cycles is seven interruptions
 * of whatever they were doing. The window mode is the switch that lets those
 * runs happen without the grab: `headless` creates the window and never shows
 * it, `inactive` shows it without activating the app.
 *
 * Read once, at module load, from `LOCAL_OPERATOR_UI_WINDOW_MODE` or the
 * `--window-mode=<mode>` argument (the flag wins). `--window-size=WxH` or
 * `LOCAL_OPERATOR_UI_WINDOW_SIZE` sets the size, which is what makes a headless
 * capture the same shape as a shown window: at 1380x900 the content area is
 * 1380x872 either way, and `capturePage` returns the same 2760x1744 pixels at
 * devicePixelRatio 2.
 *
 * This module deliberately imports nothing from Electron. It decides policy
 * from plain strings so the decisions are unit-testable in-process, and
 * `index.ts` applies the result to `BrowserWindow` as the only place that
 * knows Electron exists.
 */

/** The window modes, in the order they are documented in AGENTS.md. */
export const WINDOW_MODES = ["normal", "headless", "inactive"] as const;

export type WindowMode = (typeof WINDOW_MODES)[number];

/** What the window does once its first frame is ready. */
export type WindowShow = "focus" | "inactive" | "never";

export const WINDOW_MODE_ENV = "LOCAL_OPERATOR_UI_WINDOW_MODE";
export const WINDOW_SIZE_ENV = "LOCAL_OPERATOR_UI_WINDOW_SIZE";
export const WINDOW_MODE_FLAG = "--window-mode";
export const WINDOW_SIZE_FLAG = "--window-size";

/**
 * The opt-out from the launcher watch below, for a run that MEANS to detach.
 *
 * It exists because the watch is a default, not a law: a harness that
 * deliberately outlives its launcher (`setsid`, `nohup`, a CI step that hands a
 * built app to something else) says so here rather than having to defeat the
 * watch by pointing it at a process it cannot observe.
 */
export const LAUNCHER_KEEP_ALIVE_ENV = "LOCAL_OPERATOR_UI_HEADLESS_KEEP_ALIVE";

/**
 * How often a headless run asks whether its launcher is still there. Two
 * seconds is a compromise between the cost of asking (a `kill(pid, 0)`, which
 * is a syscall and no scheduling) and how long an abandoned instance is allowed
 * to hold ~150 MB and a Dock tile after the harness that started it died.
 */
export const LAUNCHER_POLL_INTERVAL_MS = 2_000;

/**
 * How long a headless run may take to leave after its launcher goes, before it
 * exits without waiting for the owned backend cleanup. The graceful path is
 * still tried first (`app.quit()`); this is only the bound on it, because the
 * failure this whole module guards against is an instance that never leaves.
 */
export const LAUNCHER_EXIT_DEADLINE_MS = 10_000;

/**
 * The layout is verified at these dimensions and not below: the app rail, the
 * per-route list pane and the canvas each have their own minimum, and past
 * 800x600 they start taking room from each other rather than from the window.
 * The floor lives here because this module is what decides how large the
 * window will actually be — a requested size under it is reported as clamped
 * rather than silently becoming 800x600 underneath an 400x300 label.
 */
export const WINDOW_MIN_WIDTH = 800;
export const WINDOW_MIN_HEIGHT = 600;

/**
 * Chromium will not build a window larger than this, so a larger request is a
 * typo rather than an intention. The ceiling is also what keeps a nonsense
 * value out of `--window-size`, where an absurd width would otherwise turn into
 * an allocation the operator pays for.
 */
export const WINDOW_MAX_EDGE = 16384;

export const DEFAULT_WINDOW_WIDTH = 1380;
export const DEFAULT_WINDOW_HEIGHT = 900;

export interface WindowLaunchPlan {
	/** Resolved mode: the documented value, never the raw input. */
	mode: WindowMode;
	/** What `ready-to-show` does: raise and focus, raise without focusing, or nothing. */
	show: WindowShow;
	/** `BrowserWindow` `focusable`. False only in `headless`. */
	focusable: boolean;
	/** `webPreferences.backgroundThrottling`, true only in `normal`. */
	backgroundThrottling: boolean;
	/**
	 * `app.dock.hide()` on macOS: true only in `headless`.
	 *
	 * A `headless` run is not an app the operator is using, and a Dock tile
	 * says otherwise — it is an icon that cannot be clicked into anything (the
	 * window is never shown) and that a matrix of boots multiplies. Measured on
	 * this repo, one evidence session left ~30 running apps in the Dock, all of
	 * them headless runs whose launcher had gone; the tile is the half of that
	 * the operator sees first.
	 */
	hideDock: boolean;
	/** The window size that will actually exist, after the floor and ceiling. */
	width: number;
	height: number;
	/**
	 * Input that was set but not understood, or understood and adjusted. The
	 * caller logs these; nothing here prints, so a test can assert on them.
	 */
	problems: string[];
}

interface WindowBehaviour {
	show: WindowShow;
	focusable: boolean;
	backgroundThrottling: boolean;
	hideDock: boolean;
}

/**
 * The per-mode behaviour, in one table so a mode cannot be half-applied.
 *
 * `headless` is also `focusable: false`. Nothing is shown, so it could not be
 * focused in any case; declaring it means a stray `show()` — from the notifier,
 * a future call site, a plugin — cannot grab the operator's focus by accident.
 * `backgroundThrottling` is off in both non-normal modes for the same reason:
 * a test run's whole value is that it renders like a real one, so the page is
 * held at full rate explicitly rather than inheriting whatever the platform
 * decides about windows nobody is looking at.
 */
const WINDOW_BEHAVIOUR: Record<WindowMode, WindowBehaviour> = {
	normal: {
		show: "focus",
		focusable: true,
		backgroundThrottling: true,
		hideDock: false,
	},
	inactive: {
		show: "inactive",
		focusable: true,
		backgroundThrottling: false,
		// Visible on purpose, so it keeps its tile: a run somebody wants to
		// watch has to be findable in the Dock.
		hideDock: false,
	},
	headless: {
		show: "never",
		focusable: false,
		backgroundThrottling: false,
		hideDock: true,
	},
};

/** Read `--name=value` or `--name value` from an argument vector. */
function readFlag(
	argv: readonly string[],
	name: string,
): { found: boolean; value: string | undefined } {
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === name) {
			const next = argv[index + 1];
			// A following `--flag` is a missing value, not the value itself.
			return { found: true, value: next?.startsWith("--") ? undefined : next };
		}
		if (argument.startsWith(`${name}=`)) {
			return { found: true, value: argument.slice(name.length + 1) };
		}
	}
	return { found: false, value: undefined };
}

/**
 * `normal` | `headless` | `inactive`, case- and whitespace-insensitively, or
 * null when the input is anything else. Null is a caller problem, not a policy
 * decision: see `resolveWindowLaunchPlan` for why the fallback is `normal`.
 */
export function parseWindowMode(value: string | undefined): WindowMode | null {
	if (value === undefined) return null;
	const normalized = value.trim().toLowerCase();
	return (WINDOW_MODES as readonly string[]).includes(normalized)
		? (normalized as WindowMode)
		: null;
}

/**
 * `1380x900` (either case, `x` or `×`), or null. Values outside the floor and
 * ceiling are not rejected here — they are clamped in `resolveWindowLaunchPlan`
 * so the returned plan always describes the window that will exist, and so the
 * message names the clamp rather than pretending the value was not a size at
 * all. The pattern is hoisted because Biome's `useTopLevelRegex` asks for it.
 */
const WINDOW_SIZE_PATTERN = /^(\d+)\s*[x×]\s*(\d+)$/i;

export function parseWindowSize(
	value: string | undefined,
): { width: number; height: number } | null {
	if (value === undefined) return null;
	const match = value.trim().match(WINDOW_SIZE_PATTERN);
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (width <= 0 || height <= 0) return null;
	return { width, height };
}

/**
 * Resolve the launch plan from an environment and an argument vector.
 *
 * An unrecognised value falls back to `normal` and is reported in `problems`
 * rather than guessed at. `normal` is the honest default: the two directions
 * are not symmetric. A typo in `headless` that silently became `normal` costs
 * the operator one interruption they can see and fix, while a typo in `normal`
 * that silently became `headless` costs someone a window they cannot find, and
 * a shipped release that renders nothing.
 */
export function resolveWindowLaunchPlan(
	input: {
		env?: Record<string, string | undefined>;
		argv?: readonly string[];
	} = {},
): WindowLaunchPlan {
	const env = input.env ?? {};
	const argv = input.argv ?? [];
	const problems: string[] = [];

	const modeFlag = readFlag(argv, WINDOW_MODE_FLAG);
	const modeRaw = modeFlag.found ? modeFlag.value : env[WINDOW_MODE_ENV];
	const parsedMode = parseWindowMode(modeRaw);
	if (modeFlag.found && modeFlag.value === undefined) {
		problems.push(
			`${WINDOW_MODE_FLAG} needs a value: ${WINDOW_MODES.join("|")}`,
		);
	} else if (parsedMode === null && modeRaw !== undefined) {
		problems.push(
			`${modeFlag.found ? WINDOW_MODE_FLAG : WINDOW_MODE_ENV}="${modeRaw}" is not one of ${WINDOW_MODES.join("|")}; using normal`,
		);
	}
	const mode = parsedMode ?? "normal";

	const sizeFlag = readFlag(argv, WINDOW_SIZE_FLAG);
	const sizeRaw = sizeFlag.found ? sizeFlag.value : env[WINDOW_SIZE_ENV];
	const parsedSize = parseWindowSize(sizeRaw);
	if (sizeFlag.found && sizeFlag.value === undefined) {
		problems.push(`${WINDOW_SIZE_FLAG} needs a value: <width>x<height>`);
	} else if (parsedSize === null && sizeRaw !== undefined) {
		problems.push(
			`${sizeFlag.found ? WINDOW_SIZE_FLAG : WINDOW_SIZE_ENV}="${sizeRaw}" is not <width>x<height>; using ${DEFAULT_WINDOW_WIDTH}x${DEFAULT_WINDOW_HEIGHT}`,
		);
	}
	const requested = parsedSize ?? {
		width: DEFAULT_WINDOW_WIDTH,
		height: DEFAULT_WINDOW_HEIGHT,
	};
	// Clamp to what Electron will actually give us instead of letting the
	// window come out at the floor while the plan says otherwise: an evidence
	// frame labelled 400x300 that is really 800x600 is worse than a refusal,
	// and the label is written from this plan.
	const width = Math.min(
		Math.max(requested.width, WINDOW_MIN_WIDTH),
		WINDOW_MAX_EDGE,
	);
	const height = Math.min(
		Math.max(requested.height, WINDOW_MIN_HEIGHT),
		WINDOW_MAX_EDGE,
	);
	if (width !== requested.width || height !== requested.height) {
		problems.push(
			`window size ${requested.width}x${requested.height} clamped to ${width}x${height} (floor ${WINDOW_MIN_WIDTH}x${WINDOW_MIN_HEIGHT}, ceiling ${WINDOW_MAX_EDGE})`,
		);
	}

	return {
		mode,
		...WINDOW_BEHAVIOUR[mode],
		width,
		height,
		problems,
	};
}

/**
 * Which process ends this run, if any — the second half of the launch policy.
 *
 * Why this exists. A `headless` run is launched by a harness: the dev driver, a
 * QA rig, a shell that boots the built app and drives it over CDP. Nothing in
 * the app used to tie its life to the launcher's, and the app cannot be closed
 * the way a window can — the window is never shown, and macOS keeps a
 * windowless process alive by design (`window-all-closed` is a no-op there). So
 * a harness that died, or that stopped the launcher wrapper rather than the app
 * (the `node` process the pnpm shim `exec`s — which is what `stopApp()` in
 * `scripts/renderer-driver.mjs` signals), left the app running with no launcher
 * and no driver. Measured on this repo: one QA round's 13 boots left 13
 * survivors, all `ppid 1`, and an evidence matrix left ~30 of them holding a
 * Dock tile each.
 *
 * The watch is deliberately narrow. It applies only to `headless` — the mode an
 * agent-driver run uses — and only when there is a launcher to outlive, so:
 *
 * - a human's `normal` app is never affected, even launched from a terminal;
 * - a run that detached on purpose (`ppid 1` at startup, so it has no launcher
 *   to watch) is left alone rather than guessed at, with
 *   `LOCAL_OPERATOR_UI_HEADLESS_KEEP_ALIVE` as the explicit way to say so;
 * - the smoke-test path exits before any of this runs, so its marker line and
 *   exit code are unchanged.
 */
export interface LauncherWatchPlan {
	/** True when this run must not outlive the process that launched it. */
	watch: boolean;
	/** The pid to watch, or null when there is nothing to outlive. */
	launcherPid: number | null;
	/**
	 * One line for the startup log. Set even when `watch` is false, so a rig
	 * reading stdout can tell why a run is not launcher-bound instead of
	 * assuming the watch is broken.
	 */
	reason: string;
}

/** Values of `LOCAL_OPERATOR_UI_HEADLESS_KEEP_ALIVE` that ask for detachment. */
const KEEP_ALIVE_VALUES = ["1", "true", "yes", "on"];

/**
 * Decide whether a run watches its launcher. Pure: the caller supplies the
 * launch mode, the launcher pid and the environment, so the policy is testable
 * without a process, a parent or Electron.
 */
export function resolveLauncherWatchPlan(input: {
	mode: WindowMode;
	launcherPid: number;
	env?: Record<string, string | undefined>;
}): LauncherWatchPlan {
	const env = input.env ?? {};
	const keepAlive = (env[LAUNCHER_KEEP_ALIVE_ENV] ?? "").trim().toLowerCase();
	if (KEEP_ALIVE_VALUES.includes(keepAlive)) {
		return {
			watch: false,
			launcherPid: null,
			reason: `${LAUNCHER_KEEP_ALIVE_ENV}=${keepAlive} was set, so this run outlives its launcher`,
		};
	}
	if (input.mode !== "headless") {
		return {
			watch: false,
			launcherPid: null,
			reason: `window mode ${input.mode} is not launcher-bound: a person can close it`,
		};
	}
	if (!Number.isInteger(input.launcherPid) || input.launcherPid <= 1) {
		return {
			watch: false,
			launcherPid: null,
			reason: "headless run already detached (no launcher to outlive)",
		};
	}
	return {
		watch: true,
		launcherPid: input.launcherPid,
		reason: `headless run launched by pid ${input.launcherPid}; it quits when that process goes`,
	};
}

/**
 * One line naming what the window will do, for the startup log. Rigs read the
 * process's stdout, so this is how a run says out loud that it is headless
 * rather than looking identical to one that popped a window.
 *
 * It reports the WINDOW size and deliberately not a content size: the CSS
 * viewport is the window minus whatever chrome the platform draws, so it has
 * to be read from the page (`innerWidth`/`innerHeight`, or the frame's own
 * pixels) rather than derived here from a constant that is only true on one
 * platform.
 */
export function describeWindowLaunch(plan: WindowLaunchPlan): string {
	const behaviour =
		plan.show === "never"
			? "window created and never shown"
			: plan.show === "inactive"
				? "window shown without activating the app"
				: "window shown and focused";
	/*
	 * The two properties a rig cannot see for itself are named here: a run that
	 * takes no Dock tile, and a run that is expected to leave with its launcher.
	 * A reviewer reading a harness's stdout should not have to know `headless`
	 * implies either of them.
	 */
	const extras = [
		plan.hideDock ? "no Dock tile" : null,
		plan.mode === "headless" ? "quits when its launcher goes" : null,
	].filter((part): part is string => part !== null);
	const suffix = extras.length === 0 ? "" : `, ${extras.join(", ")}`;
	return `window mode ${plan.mode}: ${plan.width}x${plan.height}, ${behaviour}, page throttling ${plan.backgroundThrottling ? "on" : "off"}${suffix}`;
}
