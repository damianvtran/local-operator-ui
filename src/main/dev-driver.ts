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
export function readDevDriverArgument(
	argv: readonly string[],
): { outDir: string } | null {
	const prefix = `${DEV_DRIVER_ARG}=`;
	const match = argv.find((entry) => entry.startsWith(prefix));
	if (match === undefined) return null;
	const outDir = match.slice(prefix.length);
	if (outDir === "" || !outDir.startsWith("/")) return null;
	return { outDir };
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
