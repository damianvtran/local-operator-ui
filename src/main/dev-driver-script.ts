/**
 * S1: the dev-driver STEP RUNNER - parse a JSON step list and walk it.
 *
 * WHY IT EXISTS. `scripts/mac-proof-capture.mjs` boots the real (often the
 * installed, packaged) app in an `inactive` window and photographs it from the
 * window server with `screencapture -l <id>`, because only that capture carries
 * real vibrancy. Getting the app into the state worth photographing needs the
 * renderer's dev-driver verbs, and calling them without CDP (banned against the
 * operator's desktop) needs an invoker inside the app. This module is that
 * invoker's logic; `src/main/index.ts` supplies the I/O (the IPC pair, the window,
 * the clock) only when `resolveDevDriverScript` in `./dev-driver` passed.
 *
 * WHY IT IS PURE. It imports nothing from Electron (and only types from Node), so
 * `scripts/dev-driver-script-gate.test.mjs` bundles it and walks real step lists
 * against a fake bridge: refusal of unknown verbs, the optional-step rule, the
 * SHUTTER/ack handshake and the DONE line are all asserted without an app.
 *
 * THE STDOUT PROTOCOL is the contract with the harness; every line starts with
 * `[dev-driver-script]`:
 *   - `ready verbs=<n>` once the renderer's verbs are installed;
 *   - `step=<n> verb=<v> ok <json>` / `skipped (optional): <why>` / `error: <why>`;
 *   - `SHUTTER label=<l> media=<id> visible=<b> focused=<b> ack=<path>` for a
 *     window-server capture (the harness photographs, then writes the ack file);
 *   - `SHUTTER label=<l> capture=capturepage path=<p> width=<w> height=<h> ...`
 *     for the in-app capture (no vibrancy claim; what Linux/xvfb exercises);
 *   - `DONE steps=<n>` or `FAILED step=<n>`.
 * The harness aborts on `error:` / `FAILED`, so a step that did not do what it
 * said can never be followed by a frame claiming it did.
 */

/** Hard ceilings on the step list: a rig's scene is a handful of steps. */
export const DEV_DRIVER_SCRIPT_MAX_STEPS = 64;
export const DEV_DRIVER_SCRIPT_MAX_BYTES = 64 * 1024;

/**
 * The run's hard cap, after which main quits whatever state it is in. A
 * containment, not a schedule: the harness's own default run timeout is 180 s,
 * so this only fires when the harness died or hung (the launcher watch covers
 * the first; this covers the second).
 */
export const DEV_DRIVER_SCRIPT_CAP_MS = 300_000;

/**
 * Per-step bound when the step names none. Above the verbs' own internal waits
 * (`press`/`waitFor`/`navigate` wait 10 s by default in `install.ts`), so a verb
 * reports its own, more specific timeout first.
 */
export const DEV_DRIVER_SCRIPT_STEP_TIMEOUT_MS = 30_000;

/** How long the renderer has to install its verbs after the page loaded. */
export const DEV_DRIVER_SCRIPT_READY_MS = 30_000;

/**
 * How long a window-server SHUTTER waits for the harness's ack. The harness's
 * work per frame is one JXA window lookup plus one `screencapture -l`, both
 * sub-second on a Mac; 60 s leaves room for a cold `osascript` without letting a
 * dead harness hold the window up (the launcher watch also ends it).
 */
export const DEV_DRIVER_SCRIPT_ACK_MS = 60_000;

/** The verbs a script may name. Everything else is refused at parse time. */
export const DEV_DRIVER_SCRIPT_VERBS = Object.freeze([
	"navigate",
	"setTheme",
	"press",
	"state",
	"waitFor",
	"openCanvas",
	"skipOnboarding",
	"shutter",
] as const);

export type DevDriverScriptVerb = (typeof DEV_DRIVER_SCRIPT_VERBS)[number];

/** Frame labels become file names; the same rule `dev-driver-ipc.ts` enforces. */
const FRAME_LABEL = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface DevDriverScriptStep {
	verb: DevDriverScriptVerb;
	payload?: unknown;
	/** An optional step's failure is printed and skipped rather than ending the run. */
	optional?: boolean;
	timeoutMs?: number;
}

export interface DevDriverScript {
	steps: DevDriverScriptStep[];
}

/**
 * Parse and validate a step list. Throws with the reason; the caller prints it
 * as `[dev-driver-script] refused: ...` and runs nothing.
 *
 * Shape: `{"steps": [{"verb": "setTheme", "payload": "localOperatorLight"}, ...]}`.
 * A `shutter` step's payload is `{"label": "<frame-label>", "capture":
 * "external" | "capturepage"}`.
 */
export function parseDevDriverScript(text: string): DevDriverScript {
	if (Buffer.byteLength(text, "utf8") > DEV_DRIVER_SCRIPT_MAX_BYTES)
		throw new Error(
			`the step list is larger than ${DEV_DRIVER_SCRIPT_MAX_BYTES} bytes`,
		);
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`the step list is not JSON (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	const steps = (parsed as { steps?: unknown } | null)?.steps;
	if (!Array.isArray(steps) || steps.length === 0)
		throw new Error('the step list needs a non-empty "steps" array');
	if (steps.length > DEV_DRIVER_SCRIPT_MAX_STEPS)
		throw new Error(
			`the step list has ${steps.length} steps; the cap is ${DEV_DRIVER_SCRIPT_MAX_STEPS}`,
		);
	const labels = new Set<string>();
	return {
		steps: steps.map((raw, index): DevDriverScriptStep => {
			const at = `step ${index + 1}`;
			if (!raw || typeof raw !== "object" || Array.isArray(raw))
				throw new Error(`${at} is not an object`);
			const step = raw as Record<string, unknown>;
			const verb = step.verb;
			if (
				typeof verb !== "string" ||
				!(DEV_DRIVER_SCRIPT_VERBS as readonly string[]).includes(verb)
			)
				throw new Error(
					`${at} names verb ${JSON.stringify(verb)}; allowed: ${DEV_DRIVER_SCRIPT_VERBS.join(", ")}`,
				);
			const timeoutMs = step.timeoutMs;
			if (
				timeoutMs !== undefined &&
				(typeof timeoutMs !== "number" ||
					!Number.isInteger(timeoutMs) ||
					timeoutMs <= 0 ||
					timeoutMs > DEV_DRIVER_SCRIPT_CAP_MS)
			)
				throw new Error(
					`${at} timeoutMs must be a positive integer up to ${DEV_DRIVER_SCRIPT_CAP_MS}`,
				);
			if (step.optional !== undefined && typeof step.optional !== "boolean")
				throw new Error(`${at} optional must be a boolean`);
			if (verb === "shutter") {
				const payload = step.payload as
					| { label?: unknown; capture?: unknown }
					| undefined;
				const label = payload?.label;
				if (typeof label !== "string" || !FRAME_LABEL.test(label))
					throw new Error(
						`${at} shutter label must match ${FRAME_LABEL} (lowercase, digits, dash, underscore)`,
					);
				if (labels.has(label))
					throw new Error(`${at} repeats shutter label ${label}`);
				labels.add(label);
				if (
					payload?.capture !== "external" &&
					payload?.capture !== "capturepage"
				)
					throw new Error(
						`${at} shutter capture must be "external" or "capturepage"`,
					);
				// A frame is the claim; an optional frame would be a claim that may
				// silently not exist, which "refuse, don't fake" rules out.
				if (step.optional === true)
					throw new Error(`${at} a shutter step cannot be optional`);
			}
			return {
				verb: verb as DevDriverScriptVerb,
				...(step.payload !== undefined ? { payload: step.payload } : {}),
				...(step.optional === true ? { optional: true } : {}),
				...(timeoutMs !== undefined ? { timeoutMs: timeoutMs as number } : {}),
			};
		}),
	};
}

/** Everything the runner touches outside itself, injected so a test can fake it. */
export interface DevDriverScriptDeps {
	/** The verbs the renderer has installed so far (preload `bridge.verbs()`). */
	verbs: () => Promise<string[]>;
	/** Call one renderer verb through the preload (`bridge.call`). */
	call: (verb: string, payload: unknown) => Promise<unknown>;
	/** The in-app capture through the existing `dev-driver-capture` channel. */
	capture: (
		label: string,
	) => Promise<{ path: string; pixels: { width: number; height: number } }>;
	/** `BrowserWindow.getMediaSourceId()`: `window:<CGWindowID>:0` on macOS. */
	mediaSourceId: () => string;
	windowFacts: () => { visible: boolean; focused: boolean };
	/** Absolute directory the gate already validated (`DEV_DRIVER_OUT`). */
	outDir: string;
	ackExists: (path: string) => boolean;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	log: (line: string) => void;
	/** Test seams; production uses the module constants. */
	readyMs?: number;
	ackMs?: number;
	stepTimeoutMs?: number;
}

const PREFIX = "[dev-driver-script]";
const TRAILING_SLASH = /\/$/;

/** Results are printed for the harness to read, bounded so one verb cannot flood stdout. */
const RESULT_PRINT_CAP = 4096;

function printable(value: unknown): string {
	let text: string;
	try {
		text = JSON.stringify(value) ?? "null";
	} catch {
		text = '"<unserializable>"';
	}
	return text.length > RESULT_PRINT_CAP
		? `${text.slice(0, RESULT_PRINT_CAP)}...<truncated>`
		: text;
}

function oneLine(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).replace(
		/\s+/g,
		" ",
	);
}

async function withTimeout<T>(
	work: Promise<T>,
	ms: number,
	what: string,
	deps: DevDriverScriptDeps,
): Promise<T> {
	let timedOut = false;
	const timer = deps.sleep(ms).then(() => {
		timedOut = true;
	});
	const result = await Promise.race([work, timer]);
	if (timedOut) throw new Error(`${what} did not answer within ${ms} ms`);
	return result as T;
}

/**
 * Walk the steps. Resolves `{ok}` and never throws: every outcome is a printed
 * line, because the harness reads stdout and a thrown error inside main would be
 * an unprinted death the harness can only time out on.
 */
export async function runDevDriverScript(
	script: DevDriverScript,
	deps: DevDriverScriptDeps,
): Promise<{ ok: boolean; failedStep: number | null }> {
	const readyMs = deps.readyMs ?? DEV_DRIVER_SCRIPT_READY_MS;
	const ackMs = deps.ackMs ?? DEV_DRIVER_SCRIPT_ACK_MS;
	const defaultStepMs = deps.stepTimeoutMs ?? DEV_DRIVER_SCRIPT_STEP_TIMEOUT_MS;
	const needed = [
		...new Set(
			script.steps.map((s) => s.verb).filter((verb) => verb !== "shutter"),
		),
	];

	// Readiness: the renderer installs its verbs after it mounts, which is after
	// `did-finish-load`. Poll rather than guess a delay.
	const readyBy = deps.now() + readyMs;
	let installed: string[] = [];
	for (;;) {
		try {
			installed = await withTimeout(deps.verbs(), 2_000, "verbs", deps);
		} catch {
			installed = [];
		}
		if (needed.every((verb) => installed.includes(verb))) break;
		if (deps.now() >= readyBy) {
			const missing = needed.filter((verb) => !installed.includes(verb));
			deps.log(
				`${PREFIX} step=0 verb=ready error: the renderer did not install ${missing.join(", ")} within ${readyMs} ms`,
			);
			deps.log(`${PREFIX} FAILED step=0`);
			return { ok: false, failedStep: 0 };
		}
		await deps.sleep(100);
	}
	deps.log(`${PREFIX} ready verbs=${installed.length}`);

	for (const [index, step] of script.steps.entries()) {
		const n = index + 1;
		const timeoutMs = step.timeoutMs ?? defaultStepMs;
		try {
			if (step.verb === "shutter") {
				const { label, capture } = step.payload as {
					label: string;
					capture: "external" | "capturepage";
				};
				const facts = deps.windowFacts();
				if (capture === "capturepage") {
					const shot = await withTimeout(
						deps.capture(label),
						timeoutMs,
						"capture",
						deps,
					);
					deps.log(
						`${PREFIX} SHUTTER label=${label} capture=capturepage path=${shot.path} width=${shot.pixels.width} height=${shot.pixels.height} visible=${facts.visible} focused=${facts.focused}`,
					);
				} else {
					const ack = `${deps.outDir.replace(TRAILING_SLASH, "")}/${label}.ack`;
					deps.log(
						`${PREFIX} SHUTTER label=${label} media=${deps.mediaSourceId()} visible=${facts.visible} focused=${facts.focused} ack=${ack}`,
					);
					const ackBy = deps.now() + ackMs;
					while (!deps.ackExists(ack)) {
						if (deps.now() >= ackBy)
							throw new Error(
								`no ack at ${ack} within ${ackMs} ms (the harness did not confirm the capture)`,
							);
						await deps.sleep(100);
					}
				}
				deps.log(`${PREFIX} step=${n} verb=shutter ok {"label":"${label}"}`);
				continue;
			}
			const value = await withTimeout(
				deps.call(step.verb, step.payload),
				timeoutMs,
				step.verb,
				deps,
			);
			deps.log(`${PREFIX} step=${n} verb=${step.verb} ok ${printable(value)}`);
		} catch (error) {
			if (step.optional) {
				deps.log(
					`${PREFIX} step=${n} verb=${step.verb} skipped (optional): ${oneLine(error)}`,
				);
				continue;
			}
			deps.log(
				`${PREFIX} step=${n} verb=${step.verb} error: ${oneLine(error)}`,
			);
			deps.log(`${PREFIX} FAILED step=${n}`);
			return { ok: false, failedStep: n };
		}
	}
	deps.log(`${PREFIX} DONE steps=${script.steps.length}`);
	return { ok: true, failedStep: null };
}
