/**
 * Whether this launch arms the renderer dev driver, and where its frames go.
 *
 * Why this exists. Reviewers of this app have twice been unable to walk a real
 * UI flow: the `browser` tool drives the operator's own browser and cannot enter
 * the Electron renderer, and loading the renderer in a bare Vite server dies at
 * `Cannot read properties of undefined (reading 'ipcRenderer')` because the app
 * assumes its preload bridge (`src/renderer/src/app.tsx`). So a reviewer could
 * read the JSX and could not see the flow. The dev driver is the supported way
 * through: an opt-in bridge (main -> preload -> renderer) that a test driver
 * reaches with `scripts/renderer-driver.mjs`, plus `webContents.capturePage()`
 * for the pixels. `docs/agent-driver.md` is the contract; this module is the
 * switch.
 *
 * The switch is fail-closed, and this module is deliberately boring about it —
 * it imports nothing from Electron so `scripts/dev-driver-gate.test.mjs` can
 * bundle it and assert the decisions in process, the same reason
 * `window-mode.ts` imports nothing either:
 *
 * - **Off unless asked for.** No environment variable, no flag: `armed: false`,
 *   no problems, nothing registered, nothing exposed. A normal launch (the
 *   operator's own) is byte-for-byte the launch it was before this module
 *   existed — the assertion is not "it looks off", it is that main registers no
 *   `dev-driver-*` channel and the preload exposes no bridge, both of which
 *   `node scripts/renderer-driver.mjs --gate-check` measures on a real boot.
 *
 *   "Asked for" means the ENVIRONMENT THIS PROCESS WAS LAUNCHED WITH, which is
 *   why `src/main/index.ts` passes `launchEnv` rather than `process.env`. The
 *   `environment` here is a snapshot taken by `src/main/backend/config.ts`
 *   before it applies a `.env` from the working directory with dotenv
 *   `override: true`, so a file in the checkout cannot arm this: it can neither
 *   supply the opt-in nor the frames directory, and an explicit
 *   `LOCAL_OPERATOR_UI_DEV_DRIVER=0` at the shell beats whatever such a file
 *   says. Both halves are measured on real boots by `--gate-check`'s `.env`
 *   cases, because this is the difference between an opt-in and a control
 *   surface the repository's own config file can switch on.
 * - **A typo is off, loudly.** `LOCAL_OPERATOR_UI_DEV_DRIVER=yes` is not an
 *   opt-in; it is refused with a problem line naming the accepted values. The
 *   same rule as `window-mode.ts`: a value that was understood and adjusted is
 *   reported rather than silently obeyed or silently ignored. Silence here would
 *   mean a driver run that quietly has no bridge, which reads exactly like a bug
 *   in the harness.
 * - **Both halves are required.** Arming needs the opt-in AND an absolute frames
 *   directory. The opt-in alone does not arm, because an armed driver with
 *   nowhere to put a frame is a run whose only output is "it worked" — and a
 *   driver that is asked for a frame must produce a file or fail.
 * - **Never in a `normal` window.** `normal` is what raises and focuses the
 *   window, and an armed driver behind a window the operator is using is the
 *   confusion this whole area exists to avoid. `headless` and `inactive` arm;
 *   `normal` refuses.
 *
 * What it deliberately is NOT: a way around the operator's approvals, and not a
 * substitute for the `browser` tool. It drives the app's OWN Electron and writes
 * pixels the app captured of itself; it cannot reach the operator's real profile
 * (the harness gives the run a scratch HOME, config dir and `--user-data-dir`),
 * and it says nothing about whether a page behaves in a real browser.
 */

import type { WindowMode } from "./window-mode";

/** The opt-in. Unset (the normal case) means no bridge anywhere in the process. */
export const DEV_DRIVER_ENV = "LOCAL_OPERATOR_UI_DEV_DRIVER";

/**
 * Where captured frames are written. Absolute; required when arming.
 *
 * Named as an environment variable rather than derived from the app's own paths
 * because the frames must NOT land in the operator's userData: mixing evidence
 * output into a real profile directory is how a later "clean up the profile"
 * step deletes the thing you were asked to keep.
 */
export const DEV_DRIVER_OUT_ENV = "LOCAL_OPERATOR_UI_DEV_DRIVER_OUT";

/**
 * How main tells the preload it armed. Passed as an `additionalArguments` entry
 * on the window's `webPreferences`, which Electron appends to the renderer
 * process's `process.argv` — so the preload reads it synchronously, with no IPC.
 *
 * Why not a `sendSync` handshake, which was the first version: `ipcRenderer
 * .sendSync` to a channel with no listener NEVER ANSWERS, so the unarmed launch —
 * every normal launch — blocked inside the preload and the window never painted.
 * Measured, not inferred: the app's log carried
 * `called ipcRenderer.sendSync() with 'dev-driver-handshake' channel without
 * listeners`, the page target's title was still `index.html` nine seconds later,
 * and CDP answered nothing at all. A gate that breaks the thing it protects is
 * worse than no gate, and `--gate-check` now fails on that symptom.
 *
 * `additionalArguments` cannot be set from outside: main composes it from its own
 * arming decision, and an environment variable or command-line switch cannot
 * forge a renderer's argv. It is belt to the channels' braces in any case — the
 * REAL boundary is that main registers nothing when unarmed, which the gate check
 * measures by calling the channel and reading Electron's refusal.
 */
export const DEV_DRIVER_ARG = "--lo-dev-driver";

/**
 * The channels the driver uses, in one place.
 *
 * Main registers them only when armed, so an unarmed process refuses a stray
 * call with Electron's own "No handler registered" rather than serving it.
 */
export const DEV_DRIVER_CAPTURE = "dev-driver-capture";
export const DEV_DRIVER_FACTS = "dev-driver-facts";

/** The world key the preload exposes. Namespaced so it cannot collide with the app's own. */
export const DEV_DRIVER_WORLD_KEY = "__loDevDriver";

/**
 * S1's address-overlay probe channel, handled by the BROWSER namespace's IPC
 * (`browser/ipc.ts`) because the overlay it operates belongs to the browser
 * host. Registered only when the launch gate passed; the bridge below exists
 * only in an armed launch, so an ordinary run has neither half.
 */
export const DEV_DRIVER_ADDRESS_OVERLAY = "dev-driver-address-overlay";

/**
 * S2's two channels, both inside the same armed-launch branch as the S1 probe:
 *
 * - `...-project` is renderer → main (`ipcMain.handle`), carrying a validated
 *   display projection (never a URL or code);
 * - `...-event` is main → renderer, carrying only `{type:"commit", seq, index}`
 *   for a row the child actually painted.
 *
 * Both are registered only when the S2 gate passed, so an ordinary or S1-only
 * launch has neither, and stop/retry unregisters the handler like every other
 * channel in the browser namespace.
 */
export const DEV_DRIVER_ADDRESS_OVERLAY_PROJECT =
	"dev-driver-address-overlay-project";
export const DEV_DRIVER_ADDRESS_OVERLAY_EVENT =
	"dev-driver-address-overlay-event";

/** The complete input vocabulary, re-exported so main's handler and the preload
 * wrapper cannot drift on a spelling. `click`/`measure` are probe-only: they
 * operate the child's own input/layout from the gated harness, never from a
 * product path. */
export type AddressOverlayProbeAction =
	| "show"
	| "hide"
	| "facts"
	| "click"
	| "measure"
	| "key";

/** Values that count as "yes". Anything else that is set is a typo, not an opt-in. */
const TRUTHY = new Set(["1", "true"]);

export interface DevDriverArming {
	/** True only when every requirement held. False is the answer for a normal launch. */
	armed: boolean;
	/** The absolute directory frames are written to, when armed. */
	outDir: string | null;
	/**
	 * Set-but-refused or adjusted input, in the same spirit as
	 * `WindowLaunchPlan.problems`. Nothing here prints, so a test can assert on
	 * them; `index.ts` logs them.
	 */
	problems: string[];
}

type OptIn = { asked: false; value: null } | { asked: true; value: string };

/**
 * ONE way in: the environment variable, and no launch flag beside it.
 *
 * `--window-mode` needs a flag because a person types it at a terminal; the
 * driver is started by a script. Two spellings of one opt-in is one more thing
 * for the gate to get wrong, so `resolveDevDriverArming` does not take an argv at
 * all — there is no command line it could be talked into by, which
 * `scripts/dev-driver-gate.test.mjs` relies on being true of the signature.
 */
function readOptIn(env: Record<string, string | undefined>): OptIn {
	const raw = env[DEV_DRIVER_ENV];
	if (raw === undefined || raw.trim() === "")
		return { asked: false, value: null };
	return { asked: true, value: raw.trim() };
}

/**
 * Resolve the arming decision from plain values.
 *
 * Pure by construction: the caller passes the environment and the
 * already-resolved window mode, so a test can ask "what does a normal launch
 * do" without an app, a window or an Electron.
 */
export function resolveDevDriverArming(input: {
	env: Record<string, string | undefined>;
	windowMode: WindowMode;
}): DevDriverArming {
	const off = (problems: string[] = []): DevDriverArming => ({
		armed: false,
		outDir: null,
		problems,
	});

	const optIn = readOptIn(input.env);
	if (!optIn.asked) return off();

	if (!TRUTHY.has(optIn.value.toLowerCase())) {
		return off([
			`${DEV_DRIVER_ENV}=${optIn.value} is not an opt-in (accepted: 1, true); the renderer dev driver stayed off`,
		]);
	}

	if (input.windowMode !== "headless" && input.windowMode !== "inactive") {
		return off([
			`the renderer dev driver refused to arm in a "${input.windowMode}" window; it never raises one, so use --window-mode=headless (or inactive)`,
		]);
	}

	const outDir = input.env[DEV_DRIVER_OUT_ENV]?.trim() ?? "";
	if (outDir === "" || !outDir.startsWith("/")) {
		return off([
			`${DEV_DRIVER_ENV} was set but ${DEV_DRIVER_OUT_ENV} is ${outDir === "" ? "missing" : `"${outDir}"`}; an absolute frames directory is required, so the driver did not arm`,
		]);
	}

	return { armed: true, outDir, problems: [] };
}

/**
 * Whether this launch creates the mini view as a HEADLESS EXERCISER for the
 * rigs.
 *
 * WHY IT EXISTS (quick-send design §I.3; manager remediation, M-B1). The mini
 * view otherwise exists only in a `normal` launch, so a headless rig has no
 * window the app OWNS — and the desktop plane's gate admits by frame
 * (`desktop-ipc.ts`), so the window a scene builds by hand is refused before
 * any request leaves the app, which is why the live send path could not be
 * exercised at all. Arming the dev driver is the opt-in that says "a rig owns
 * this boot"; `headless` is the only mode where a window can exist and never
 * be shown (`inactive` is *visible by design*).
 *
 * WHAT IT IS NOT: a right to REGISTER or to SHOW. Registration stays
 * `hotkeysAllowed`'s alone — nothing here can answer the operator's keyboard —
 * and every presentation path stays `presentMiniView`'s gate, which a headless
 * plan refuses. The window this permits is created hidden and disposed on quit
 * like the ordinary one.
 */
export function headlessExerciserAllowed(input: {
	arming: DevDriverArming;
	windowMode: WindowMode;
}): boolean {
	return input.arming.armed && input.windowMode === "headless";
}

export const OWNER_AUDIT_STARTUP_SCENE = "team-bridge-owner-audit" as const;
const DEV_DRIVER_SCENE_ARG = "--lo-dev-driver-scene";

/** One fixed native-QA scene, not a navigation or execution API. Paths are
 * realpath-canonicalized by main against ACTUAL Electron userData after backend
 * discovery. Missing isolation or a default/live daemon fails closed. Keeping
 * this decision pure lets negative cases run without showing a window. */
export function resolveDevDriverStartupScene(input: {
	env: Record<string, string | undefined>;
	armed: boolean;
	packaged: boolean;
	windowMode: WindowMode;
	backendManagerDisabled: boolean;
	selectedBackendUrl: string;
	paths: {
		root: string;
		home: string;
		config: string;
		requestedUserData: string;
		actualUserData: string;
	} | null;
}): typeof OWNER_AUDIT_STARTUP_SCENE | null {
	if (
		input.env.LOCAL_OPERATOR_UI_DEV_DRIVER_SCENE !==
			OWNER_AUDIT_STARTUP_SCENE ||
		!input.armed ||
		input.packaged ||
		input.windowMode !== "headless" ||
		input.env.VITE_DISABLE_BACKEND_MANAGER !== "true" ||
		!input.backendManagerDisabled ||
		!input.paths
	)
		return null;
	const p = input.paths;
	if (
		!p.root.startsWith("/") ||
		p.root === "/" ||
		p.root.endsWith("/") ||
		![p.home, p.config, p.requestedUserData, p.actualUserData].every((v) =>
			v.startsWith(`${p.root}/`),
		) ||
		p.actualUserData !== p.requestedUserData
	)
		return null;
	try {
		const asked = new URL(input.env.VITE_LOCAL_OPERATOR_API_URL ?? "");
		const selected = new URL(input.selectedBackendUrl);
		if (
			asked.href !== selected.href ||
			asked.protocol !== "http:" ||
			!["127.0.0.1", "localhost", "[::1]"].includes(asked.hostname) ||
			!asked.port ||
			asked.port === "1111" ||
			asked.username ||
			asked.password ||
			asked.pathname !== "/" ||
			asked.search ||
			asked.hash
		)
			return null;
		return OWNER_AUDIT_STARTUP_SCENE;
	} catch {
		return null;
	}
}

export function devDriverSceneArgument(
	scene: typeof OWNER_AUDIT_STARTUP_SCENE,
): string {
	return `${DEV_DRIVER_SCENE_ARG}=${scene}`;
}

/**
 * The `additionalArguments` entry that carries the frames directory to a preload.
 *
 * Pure so the preload's reader and this writer cannot drift: the same function
 * is what `scripts/dev-driver-gate.test.mjs` bundles and asserts on.
 */
export function devDriverArgument(outDir: string): string {
	return `${DEV_DRIVER_ARG}=${outDir}`;
}

/**
 * Read the arming argument out of a renderer process's `argv`.
 *
 * Returns null for anything that is not exactly this launch's argument — no
 * argument, a bare `--lo-dev-driver` with no directory, or a directory that is
 * not absolute. A preload that cannot read a frames directory has nothing to
 * expose, so "unintelligible" and "absent" are deliberately the same answer.
 */
export function readDevDriverArgument(argv: readonly string[]): {
	outDir: string;
	startupScene?: typeof OWNER_AUDIT_STARTUP_SCENE;
	/** Present only when main's S1 script gate passed (see `resolveDevDriverScript`). */
	script?: true;
} | null {
	const prefix = `${DEV_DRIVER_ARG}=`;
	const match = argv.find((entry) => entry.startsWith(prefix));
	if (match === undefined) return null;
	const outDir = match.slice(prefix.length);
	if (outDir === "" || !outDir.startsWith("/")) return null;
	return {
		outDir,
		...(argv.includes(devDriverSceneArgument(OWNER_AUDIT_STARTUP_SCENE))
			? { startupScene: OWNER_AUDIT_STARTUP_SCENE }
			: {}),
		// Exact match, never a prefix: the frames argument above is
		// `--lo-dev-driver=<dir>`, so the two spellings cannot be confused.
		...(argv.includes(DEV_DRIVER_SCRIPT_ARG) ? { script: true as const } : {}),
	};
}

/** The one line an armed (or refused) launch prints, and nothing at all when off. */
export function describeDevDriverArming(
	arming: DevDriverArming,
): string | null {
	if (arming.armed) {
		return `[dev-driver] ARMED; frames are written to ${arming.outDir}`;
	}
	if (arming.problems.length === 0) return null;
	return `[dev-driver] not armed: ${arming.problems.join("; ")}`;
}

/*
 * ---------------------------------------------------------------------------
 * S1: the dev-driver STEP RUNNER's gate (mac proof capture).
 * ---------------------------------------------------------------------------
 *
 * WHY IT EXISTS. `scripts/mac-proof-capture.mjs` photographs the INSTALLED app on
 * a real Mac with real vibrancy, which only a window-server capture
 * (`screencapture -l <id>`) of a shown window can see. The verbs that put the app
 * in a state worth photographing (`setTheme`, `navigate`, `openCanvas`, ...)
 * already ship in the armed renderer; what was missing is a way to CALL them
 * without CDP, which the operator's rules ban against his own desktop. The runner
 * is that invoker: main reads a JSON step list, calls the verbs over one dedicated
 * IPC pair and prints one line per step, so the harness reads stdout instead of
 * attaching a debugger. It is an IPC verb TABLE, not `executeJavaScript`, so the
 * review question "what can this reach" keeps the answer the verb table gives.
 *
 * WHY IT IS ITS OWN GATE and not an extension of the owner-audit startup scene:
 * that scene refuses packaged builds and port 1111 on purpose, while this runner
 * exists precisely to drive a packaged bundle. Its isolation comes from a
 * different place - a scratch `--user-data-dir` that must not be (or sit inside,
 * or contain) the app's default userData - so a launch sharing the operator's
 * profile can never run a script, whatever else it was told.
 *
 * Pure, like everything in this module: the caller passes realpath and the
 * candidate default roots, so `scripts/dev-driver-script-gate.test.mjs` asserts
 * every refusal without Electron.
 */

/** The opt-in: an ABSOLUTE path to the JSON step list. Read from `launchEnv`. */
export const DEV_DRIVER_SCRIPT_ENV = "LOCAL_OPERATOR_UI_DEV_DRIVER_SCRIPT";

/**
 * How main tells the preload to listen for script steps: an `additionalArguments`
 * entry, for the reason `DEV_DRIVER_ARG` gives (a renderer's argv cannot be forged
 * from outside, and a sync handshake hung the unarmed renderer once).
 */
export const DEV_DRIVER_SCRIPT_ARG = "--lo-dev-driver-script";

/** main -> preload: `{id, verb, payload}`. Registered only when the gate passed. */
export const DEV_DRIVER_SCRIPT_STEP = "dev-driver-script-step";
/** preload -> main: `{id, ok, value | error}`. Registered only when the gate passed. */
export const DEV_DRIVER_SCRIPT_RESULT = "dev-driver-script-result";

export interface DevDriverScriptGate {
	/** True only when every condition held; the runner starts only then. */
	honoured: boolean;
	/** The absolute script path, when honoured. */
	scriptPath: string | null;
	/** Set when the opt-in was given and refused; printed as one line. Null when not asked. */
	refusal: string | null;
}

/** True when `child` is `parent` or sits anywhere below it. Both already realpath'd. */
function within(child: string, parent: string): boolean {
	if (child === parent) return true;
	const prefix = parent.endsWith("/") ? parent : `${parent}/`;
	return child.startsWith(prefix);
}

/**
 * Decide whether this launch may run a dev-driver script.
 *
 * Honoured only if ALL hold, each refusal naming itself:
 * - the opt-in is set (unset is silent: a normal launch prints nothing);
 * - the dev driver is ARMED (opt-in + absolute frames dir + headless|inactive);
 * - the window mode is headless or inactive (re-checked here so a future change
 *   to the arming rules cannot quietly widen this one);
 * - the script path is absolute;
 * - realpath(userData) is not a default userData root, not inside one, and does
 *   not contain one. "Contains" matters because `--user-data-dir=~/Library` would
 *   otherwise pass a naive equality check while every profile lives under it.
 *
 * `realpath` is injected so a test can model symlinks; the shipped caller passes
 * `fs.realpathSync` wrapped to fall back to the input for a missing path (a
 * missing default root cannot be the profile in use).
 *
 * `caseInsensitive` (main passes `process.platform === "darwin"`): macOS's
 * default APFS volume folds case and `fs.realpathSync` keeps the caller's
 * spelling, so `--user-data-dir=~/Library/Application Support/local operator`
 * IS the default profile there although the strings differ. The comparison then
 * folds case and Unicode normalisation; Linux stays exact, its filesystems
 * being case-sensitive (review r1 R1-3 on PR #1936).
 */
export function resolveDevDriverScript(input: {
	env: Record<string, string | undefined>;
	armed: boolean;
	windowMode: WindowMode;
	userData: string;
	defaultUserData: readonly string[];
	realpath: (path: string) => string;
	caseInsensitive?: boolean;
}): DevDriverScriptGate {
	const raw = input.env[DEV_DRIVER_SCRIPT_ENV]?.trim() ?? "";
	if (raw === "") return { honoured: false, scriptPath: null, refusal: null };
	const refuse = (reason: string): DevDriverScriptGate => ({
		honoured: false,
		scriptPath: null,
		refusal: reason,
	});
	if (!input.armed)
		return refuse(
			`${DEV_DRIVER_SCRIPT_ENV} needs the dev driver armed (${DEV_DRIVER_ENV}=1 and an absolute ${DEV_DRIVER_OUT_ENV})`,
		);
	if (input.windowMode !== "headless" && input.windowMode !== "inactive")
		return refuse(
			`a dev-driver script never runs in a "${input.windowMode}" window; use --window-mode=inactive or headless`,
		);
	if (!raw.startsWith("/"))
		return refuse(`${DEV_DRIVER_SCRIPT_ENV} must be an absolute path`);
	if (!input.userData.startsWith("/"))
		return refuse("the profile path is not absolute");
	const fold = (path: string): string =>
		input.caseInsensitive ? path.normalize("NFC").toLowerCase() : path;
	const profile = fold(input.realpath(input.userData));
	for (const candidate of input.defaultUserData) {
		if (!candidate.startsWith("/")) continue;
		const root = fold(input.realpath(candidate));
		if (within(profile, root) || within(root, profile))
			return refuse(
				"the profile is the app's default user data (or inside/containing it); a script runs only in a scratch --user-data-dir",
			);
	}
	return { honoured: true, scriptPath: raw, refusal: null };
}

/** The one line the gate prints when it was asked, and nothing when it was not. */
export function describeDevDriverScript(
	gate: DevDriverScriptGate,
): string | null {
	if (gate.honoured)
		return `[dev-driver-script] ARMED; steps from ${gate.scriptPath}`;
	if (gate.refusal) return `[dev-driver-script] refused: ${gate.refusal}`;
	return null;
}

/** The preload's argument for a launch whose script gate passed. */
export function devDriverScriptArgument(): string {
	return DEV_DRIVER_SCRIPT_ARG;
}

/**
 * S3: why the update service stays quiet in this launch, or null for every
 * ordinary launch.
 *
 * WHY. An armed run of the SHIPPED bundle (the mac proof harness execs
 * `/Applications/Local Operator.app` directly) would otherwise run the start-up
 * seal repair 15 s in, which may delete files inside the bundle the operator is
 * running, and an "update available" card could land in an evidence frame. An
 * armed run is a rig's boot by definition (opt-in + scratch frames dir + a
 * non-normal window), so nothing the operator relies on is lost: his own launch
 * is never armed.
 */
export function devDriverQuietUpdatesReason(
	arming: DevDriverArming,
): string | null {
	return arming.armed
		? "the renderer dev driver is armed (a rig's boot): start-up seal repair and app-initiated update checks are skipped"
		: null;
}
