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

/**
 * Read `--name=value` or `--name value` from an argument vector, the last
 * VALUED occurrence winning.
 *
 * Last-wins is the rule the rest of this app's flags state
 * (`shared/open-session.ts`), and here it is what makes an appended argument an
 * override: `pnpm app:headless` names `--window-mode=headless` on its own command
 * line, and `pnpm app:headless --window-mode=inactive` APPENDS to that line — a
 * launcher that appends rather than replaces must not be overruled by the default
 * it was appending to, which is a silent downgrade of an explicit request.
 *
 * A VALUELESS OCCURRENCE NEVER CLEARS A VALUED ONE (review round 1). Under plain
 * last-wins, `--window-mode=headless --window-mode` resolved to `normal` — the
 * same silent downgrade, from an argument nobody writes on purpose and which
 * could not be told apart from a typo. So an occurrence with no value (the flag
 * at the end of argv, or followed by another flag) is IGNORED, `valueless`
 * reports it so the caller can still say so out loud, and the value kept is the
 * last one that actually had one.
 */
function readFlag(
	argv: readonly string[],
	name: string,
): { found: boolean; value: string | undefined; valueless: boolean } {
	let found = false;
	let valueless = false;
	let value: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === name) {
			const next = argv[index + 1];
			found = true;
			if (next === undefined || next.startsWith("--")) {
				valueless = true;
				continue;
			}
			value = next;
			continue;
		}
		if (argument.startsWith(`${name}=`)) {
			found = true;
			value = argument.slice(name.length + 1);
		}
	}
	return { found, value, valueless };
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
	} else if (modeFlag.valueless) {
		/*
		 * A malformed occurrence beside a usable one: report it and keep the value.
		 * Plain last-wins would have let the empty occurrence CLEAR an explicit
		 * `--window-mode=headless`, which is the same silent downgrade this reader
		 * exists to prevent (review round 1), and nobody writes this argv on
		 * purpose, so the line is how it is told apart from a typo.
		 */
		problems.push(
			`${WINDOW_MODE_FLAG} was given with no value; keeping "${modeRaw}"`,
		);
	} else if (modeValue !== undefined && modeRaw === undefined) {
		/*
		 * Empty and blank name nothing, so the report says exactly that:
		 * `LOCAL_OPERATOR_UI_WINDOW_MODE=""` is a caller mistake worth a line.
		 *
		 * The outcome is stated only when the assumption did NOT take over. On the
		 * rig-shaped path a message ending "using normal" would be a lie, since
		 * that launch resolves `headless`; on the plain path there is no assumption
		 * to explain the silence, so the caller is told the outcome they were told
		 * before this change and the line stays useful rather than merely true.
		 */
		problems.push(
			`${modeFlag.found ? WINDOW_MODE_FLAG : WINDOW_MODE_ENV} names no mode (empty value)${assumed ? "" : "; using normal"}`,
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
	} else if (sizeFlag.valueless) {
		problems.push(
			`${WINDOW_SIZE_FLAG} was given with no value; keeping "${String(sizeRaw)}"`,
		);
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
 * The key a second launch uses to carry its window intent to the instance that
 * already holds the single-instance lock.
 *
 * WHY THE INTENT HAS TO BE CARRIED AT ALL, and why it cannot be read from the
 * running instance's own environment: `second-instance` is delivered to the
 * process that WON the lock, and it hands over the losing process's argv and
 * whatever that process attached to its `requestSingleInstanceLock` call. The
 * environment of the losing process is not part of either, and the documented
 * agent launches (`pnpm app:headless` is `LOCAL_OPERATOR_UI_WINDOW_MODE=headless
 * electron .`) put the mode in exactly that environment. So a second launch
 * forwards the mode it resolved, on the request that lost, and the winner
 * answers with the requester's intent instead of its own plan.
 *
 * The key is namespaced because the payload crosses a process boundary that
 * Electron does not police: anything else a future caller attaches to that call
 * arrives in the same object.
 */
export const WINDOW_INTENT_KEY = "localOperatorWindowMode";

/**
 * What a launch that lost the single-instance lock hands to the one that won it.
 *
 * The MODE rather than the resolved `WindowShow`, deliberately: the receiver
 * validates through `parseWindowMode` and applies its own behaviour table, so a
 * payload cannot smuggle in a show value this build does not model, and two
 * builds that disagree about what `inactive` means cannot disagree silently
 * about what it does.
 *
 * `pid` and `cwd` ride along for the LOG LINE only, and are never read for a
 * decision: they are what the losing process says about itself, which is the
 * difference between "a second launch did it" and "pid 9182 in
 * /Users/someone/project did it" on a machine where several agents and scripts
 * launch this app at once (UX review U2). A payload that carries them is still
 * just data — an unrecognised mode in it is ignored, as ever.
 */
export function windowIntentPayload(
	mode: WindowMode,
	requester: { pid?: number; cwd?: string } = {},
): Record<string, unknown> {
	return {
		[WINDOW_INTENT_KEY]: {
			mode,
			...(requester.pid === undefined ? {} : { pid: requester.pid }),
			...(requester.cwd === undefined ? {} : { cwd: requester.cwd }),
		},
	};
}

/** The intent a payload carried, or null when it carried none this build reads. */
export interface WindowIntent {
	mode: WindowMode;
	pid?: number;
	cwd?: string;
}

/** The longest declared path this build will print, in characters. */
const MAX_DECLARED_CWD = 200;

/**
 * WHAT CAN BREAK A LINE, and therefore what has to be flattened before a declared
 * field reaches the log. The forgeries come from line breaks, so every class that
 * can end a line is covered rather than the ASCII controls alone (review round 3,
 * NIT-2):
 *
 *  - C0, `\u0000`-`\u001f` (LF and CR among them);
 *  - DEL, `\u007f`;
 *  - C1, `\u0080`-`\u009f` — where NEL `\u0085` lives, a break to any terminal
 *    that honours it;
 *  - the Unicode LINE and PARAGRAPH SEPARATORS, `\u2028`/`\u2029`, which
 *    JavaScript's own grammar treats as terminators.
 *
 * A path is what a requester declares here and a POSIX path cannot contain any of
 * them, so nothing legitimate is lost; a `cwd` that uses one is a `cwd` trying to
 * write a second line.
 */
const DECLARED_FIELD_BREAKS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * A DECLARED field, made safe to print on a line-oriented log.
 *
 * Untrusted input even though nothing is decided from it: every line-breaking
 * class above is flattened to a space and the value is capped, so one raise is one
 * line whatever the requester declares. An empty result is absence, not an empty
 * field, so the line omits it rather than printing `cwd=` with nothing after it.
 */
function declaredField(value: unknown): string | undefined {
	if (typeof value !== "string" || value === "") return undefined;
	const flat = value.replace(DECLARED_FIELD_BREAKS, " ").trim();
	if (flat === "") return undefined;
	return flat.length > MAX_DECLARED_CWD
		? `${flat.slice(0, MAX_DECLARED_CWD)}...`
		: flat;
}

/**
 * The intent a second launch carried, or null when it carried none this build
 * understands. Null is the ordinary case rather than an error: an older release
 * on either side of the boundary attaches nothing, and a value that is not one
 * of `WINDOW_MODES` is treated as absent instead of being guessed at.
 *
 * TWO SHAPES ARE READ. A bare mode string is what the first cut of this channel
 * sent; an object is what it sends now that the raise line names its requester.
 * A build that predates the object form still gets its mode honoured rather than
 * silently downgraded to the undeclared behaviour, which is the direction that
 * costs the operator a window.
 */
export function readWindowIntent(additionalData: unknown): WindowIntent | null {
	if (typeof additionalData !== "object" || additionalData === null)
		return null;
	const value = (additionalData as Record<string, unknown>)[WINDOW_INTENT_KEY];
	if (typeof value === "string") {
		const mode = parseWindowMode(value);
		return mode === null ? null : { mode };
	}
	if (typeof value !== "object" || value === null) return null;
	const fields = value as Record<string, unknown>;
	const mode =
		typeof fields.mode === "string" ? parseWindowMode(fields.mode) : null;
	if (mode === null) return null;
	return {
		mode,
		/*
		 * A pid is a safe integer or it is not a pid. The DECLARED fields are made
		 * safe for a line-oriented log (review round 2, NIT-2): the payload is
		 * whatever the losing process chose to say about itself, and a `cwd` with a
		 * newline in it — legal on POSIX — would forge a second `[window-raise]` line.
		 * Nothing is ever DECIDED from either field, which is why the validation is
		 * about the log rather than about trust.
		 */
		...(typeof fields.pid === "number" && Number.isSafeInteger(fields.pid)
			? { pid: fields.pid }
			: {}),
		...(declaredField(fields.cwd) === undefined
			? {}
			: { cwd: declaredField(fields.cwd) }),
	};
}

/**
 * How far a SECOND launch may bring this process's window forward.
 *
 * This is the fix for a defect the operator reported as "the app steals my focus
 * whenever a chat completes": a launch that shared the operator's profile was
 * refused by the single-instance lock, and the RUNNING instance answered by
 * applying ITS OWN plan — `show()` + `focus()` for the ordinary `normal` app — so
 * an agent's deliberately invisible `headless` run yanked the operator's window
 * to the front. Measured on this machine before the fix: frontmost went from the
 * operator's app to the agent's, and back.
 *
 * The rule is that the WINDOW comes forward only as far as the request that
 * asked for it:
 *
 * - `never` (a `headless` request) raises nothing at all;
 * - `inactive` (an `inactive` request) may `showInactive()` — visible, never
 *   activated;
 * - `focus` is what an UNDECLARED launch gets, which is the person double-
 *   clicking the app while it runs, and must keep the behaviour it has today.
 *
 * TWO SOURCES, in this order. The carried intent is more informed than the
 * command line: it is the mode the losing launch itself resolved from its own
 * environment, argv and size floor, so a rig-shaped launch is covered by
 * whatever that launch's own policy said. The command line is the fallback, read
 * through `resolveWindowLaunchPlan` — the same reader the launching process used
 * — because a launch can reach the window server through paths that drop the
 * environment (a LaunchServices `open --args`), and `--window-mode` is what
 * survives those.
 *
 * The fallback is `focus` rather than `never`. The two directions are not
 * symmetric, for the reason `resolveWindowLaunchPlan` gives for falling back to
 * `normal`: a launch nobody declared is far more often a person than an agent,
 * and answering a person's double-click with silence is the failure mode that
 * looks like a broken app.
 */
export function resolveSecondLaunchShow(input: {
	argv?: readonly string[];
	additionalData?: unknown;
}): WindowShow {
	const carried = readWindowIntent(input.additionalData);
	if (carried !== null) return WINDOW_BEHAVIOUR[carried.mode].show;
	return resolveWindowLaunchPlan({ argv: input.argv ?? [] }).show;
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
