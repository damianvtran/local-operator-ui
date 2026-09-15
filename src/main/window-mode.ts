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
 * Naming no mode is not the same as naming `normal`. A launch carrying one of
 * `AGENT_LAUNCH_FLAGS` — a scratch `--user-data-dir`, a
 * `--remote-debugging-port` — has said that it is a run rather than a person
 * using the app, so it resolves to `headless` and the startup line reports the
 * assumption. A launch that says nothing at all is still the operator's own
 * app, and still `normal`.
 *
 * Read once, at module load, from `LOCAL_OPERATOR_UI_WINDOW_MODE` or the
 * `--window-mode=<mode>` argument (the flag wins). The `env` a caller passes
 * must be the environment the process was LAUNCHED with, not `process.env`
 * after `./backend/config` has folded in a `.env` from the working directory —
 * a window mode decides whether the operator's focus is taken, so a file in the
 * checkout must not be able to set one. `src/main/index.ts` passes the
 * `launchEnv` snapshot for exactly that reason. `--window-size=WxH` or
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
 * The switches that mark a launch as agent-driven rather than the operator's,
 * and so as one that must not take their focus.
 *
 * `--user-data-dir` is the strong one: the operator's own app runs on the
 * default profile, while every rig, desktop test and evidence script names a
 * scratch profile so it cannot touch theirs. `--remote-debugging-port` is the
 * weaker of the two, and knowingly so: attaching DevTools to your own app is a
 * normal thing for a person to do, and that launch resolves `headless` as well.
 * `--window-mode=inactive` is the mode for watching a run like that — visible,
 * never activated. The asymmetry is deliberate, and it is the same one the
 * module argues elsewhere: a window hidden from a launch that says it is a run
 * is recoverable and announces itself on stdout, while the focus grab is the
 * interruption this whole default exists to prevent.
 */
export const AGENT_LAUNCH_FLAGS = [
	"--user-data-dir",
	"--remote-debugging-port",
] as const;
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
	/**
	 * Why the mode was ASSUMED rather than named, or null when the caller said
	 * what it wanted and `problems` is the only thing worth reporting.
	 *
	 * Non-null exactly when the launch named no mode at all and one of
	 * `AGENT_LAUNCH_FLAGS` was present, which is what makes `headless` the
	 * default there. The reason travels with the plan so the startup line can
	 * say the run was headless *because* of the scratch profile it named,
	 * rather than leaving a reader to guess whether a mode was typed.
	 */
	assumed: string | null;
	/** What `ready-to-show` does: raise and focus, raise without focusing, or nothing. */
	show: WindowShow;
	/** `BrowserWindow` `focusable`. False only in `headless`. */
	focusable: boolean;
	/** `webPreferences.backgroundThrottling`, true only in `normal`. */
	backgroundThrottling: boolean;
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
	normal: { show: "focus", focusable: true, backgroundThrottling: true },
	inactive: { show: "inactive", focusable: true, backgroundThrottling: false },
	headless: { show: "never", focusable: false, backgroundThrottling: false },
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
	const modeValue = modeFlag.found ? modeFlag.value : env[WINDOW_MODE_ENV];
	/*
	 * A value that names NOTHING is not a named mode. `LOCAL_OPERATOR_UI_WINDOW_MODE=""`
	 * is what a shell with an unset variable produces (`env MODE="$MODE" …`) and
	 * what a harness env block with an empty default produces; reading it as
	 * "somebody chose normal" puts the focus grab this change removes back
	 * through the side door, in a spelling no reader would recognise as a
	 * choice. A whitespace-only value is the same nothing wearing a wart, so
	 * both are folded back to absent before anything decides. A TYPO is not the
	 * same nothing — see the report below, which still tells the caller.
	 */
	const modeRaw =
		typeof modeValue === "string" && modeValue.trim() === ""
			? undefined
			: modeValue;
	const parsedMode = parseWindowMode(modeRaw);
	/*
	 * Nobody named a mode and this is an agent-driven launch, so the mode is
	 * `headless` rather than `normal`.
	 *
	 * Why the default flips here and nowhere else. `normal` stays the default
	 * for a launch that says nothing at all, because that launch is the
	 * operator's own app and hiding its window would be the worse failure. But
	 * a launch that names a scratch profile or a devtools port has already
	 * said, in the only vocabulary a launch has, that it is a run and not a
	 * person — and AGENTS.md's rule that no agent run may take the operator's
	 * focus is enforced only by every caller remembering it, which is a rule
	 * that fails on the next rig somebody writes in a hurry. Measured on this
	 * machine: an afternoon of parallel QA rigs left nine Electron windows in
	 * the dock and took the operator's focus repeatedly, every one of them a
	 * launch that had simply not named a mode.
	 *
	 * A caller who reached for the flag always wins, including with a typo:
	 * `--window-mode` with no value, `--window-mode=` with an empty one, and an
	 * unparsable value each keep the historical `normal` fallback and a report,
	 * because a mistyped `normal` must not become a window somebody cannot find
	 * — and a caller who reached for the flag is asking to be TOLD, not
	 * defaulted. Only a launch that named nothing at all — no flag, and an
	 * environment variable that is absent, empty or blank — is read as "a rig".
	 *
	 * `readFlag(...).found` asks whether the switch is PRESENT, not whether it
	 * is well-formed, so a token that is not really a switch (a value that
	 * happens to be `--user-data-dir`, anything after a `--` separator) counts
	 * and resolves the launch headless. That looseness is deliberate: the false
	 * positive hides a window from a launch that says it is a run — recoverable
	 * by naming a mode, and printed on stdout — while the false negative is the
	 * focus grab this block exists to stop. The asymmetry is the point.
	 */
	const agentFlag =
		!modeFlag.found && modeRaw === undefined
			? AGENT_LAUNCH_FLAGS.find((flag) => readFlag(argv, flag).found)
			: undefined;
	const assumed = agentFlag
		? `${agentFlag} marks an agent-driven launch, and no window mode was named`
		: null;
	if (modeFlag.found && modeFlag.value === undefined) {
		problems.push(
			`${WINDOW_MODE_FLAG} needs a value: ${WINDOW_MODES.join("|")}`,
		);
	} else if (modeValue !== undefined && modeRaw === undefined) {
		/*
		 * Empty and blank name nothing, so the report says exactly that and stops:
		 * the assumption below still decides the mode on this path, and a message
		 * ending "using normal" would be a lie for a rig-shaped launch.
		 */
		problems.push(
			`${modeFlag.found ? WINDOW_MODE_FLAG : WINDOW_MODE_ENV} names no mode (empty value)`,
		);
	} else if (parsedMode === null && modeRaw !== undefined) {
		problems.push(
			`${modeFlag.found ? WINDOW_MODE_FLAG : WINDOW_MODE_ENV}="${modeRaw}" is not one of ${WINDOW_MODES.join("|")}; using normal`,
		);
	}
	const mode = parsedMode ?? (assumed ? "headless" : "normal");

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
		assumed,
		...WINDOW_BEHAVIOUR[mode],
		width,
		height,
		problems,
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
	const assumption = plan.assumed ? ` (assumed: ${plan.assumed})` : "";
	return `window mode ${plan.mode}${assumption}: ${plan.width}x${plan.height}, ${behaviour}, page throttling ${plan.backgroundThrottling ? "on" : "off"}`;
}
