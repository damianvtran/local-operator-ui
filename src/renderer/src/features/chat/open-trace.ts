/**
 * THE CONVERSATION-OPEN TRACE: one line per switch, readable from the shipped app.
 *
 * WHY THIS EXISTS. The operator reported 5-10 s to open a conversation from the
 * sidebar and asked for < 500 ms. The timing that existed could not answer that:
 * its only start mark (`lop:open:requested`) is written by the NATIVE entrance
 * (`app.tsx`, a notification/dock click), never by a sidebar open, and its end
 * mark is a layout effect - a DOM commit, not a paint and not "the composer
 * sends". Both live in `performance` entries, which a shipped build exposes to
 * nobody: DevTools are dev-only. So this module records the stages of every open
 * with a per-switch token and writes ONE compact line when the switch ends.
 *
 * WHERE THE LINE LANDS. `console.warn`, deliberately: the main process forwards
 * renderer warnings and errors - and only those - to the app's durable log
 * (`src/main/index.ts`, `console-message` -> `LogFileType.BACKEND`), which on
 * macOS is `~/Library/Application Support/Local Operator/logs/backend-service.log`
 * with a `[renderer] ` prefix. That is the established renderer-to-file channel;
 * `console.info` is dropped there by design, and a new IPC op for a diagnostic
 * line would be a second channel to maintain. The cost is that the line is
 * written at warn level - it is a developer log line, prefixed `[open-trace]`
 * so a reader can grep it, and stays English (not user copy, so not i18n).
 *
 * WHAT EACH STAGE MEANS (milliseconds from the trace's start, `-` = not reached):
 *   - `routed`   the transcript pane committed with the target session id.
 *   - `snapshot` the session stream's first `snapshot` frame for the target was
 *                received and parsed (before it is folded into state).
 *   - `content`  the first React commit that put a transcript row on the DOM
 *                (the same layout effect as the older `lop:open:first-row`).
 *   - `painted`  the animation frame AFTER `content`. A PAINT PROXY, not a paint
 *                measurement: a rAF callback runs before the next frame is
 *                composited, so this bounds "the browser has had its chance to
 *                paint the committed rows", within one frame (~16 ms).
 *   - `sendable` the store has the target active with its validation window
 *                closed (`validatingSessionId` released), i.e. a send would not
 *                be refused for "still checking this conversation".
 *   - `settled`  the later of `painted` and `sendable`: the switch is done.
 *
 * OUTCOMES. `settled`; `superseded` (a newer open began before this one settled -
 * its stages so far are recorded, and the line names the token that replaced it,
 * so an A->B burst never reports A's time as B's latency); `missing` (the stream
 * reported the session gone); `left` (the view moved off the target without a
 * new open - New chat, a staged draft, a rollback); `timeout` (not settled within `OPEN_TRACE_TIMEOUT_MS`,
 * e.g. an empty conversation, which has no row to paint).
 *
 * WHAT IT DOES NOT DO. It changes nothing about the open: every hook is an
 * observer that records a timestamp and returns. It records no conversation
 * content and no titles - only the token, the session id (shape-checked, never
 * free text), the entrance label from a fixed set, numbers and the outcome. A
 * re-click of the row already on screen starts no trace: the store treats it as
 * a no-op (`openSession`), so there is no load to time.
 */

export type OpenEntrance = "sidebar" | "open" | "native";
export type OpenStage =
	| "routed"
	| "snapshot"
	| "content"
	| "painted"
	| "sendable";
export type OpenOutcome =
	| "settled"
	| "superseded"
	| "missing"
	| "left"
	| "timeout";

/** Stage order as printed; `settled` is derived and appended. */
export const OPEN_STAGES: readonly OpenStage[] = [
	"routed",
	"snapshot",
	"content",
	"painted",
	"sendable",
];

/**
 * Long enough that a genuinely slow open (the report's 5-10 s, and the 25-32 s
 * reads measured earlier) is still reported as its real number rather than a
 * timeout; short enough that a trace whose stage never arrives cannot sit open
 * and absorb a later switch's marks.
 */
export const OPEN_TRACE_TIMEOUT_MS = 60_000;

export const OPEN_TRACE_PREFIX = "[open-trace]";

/**
 * Session ids are opaque tokens (hex / uuid-ish). Anything else is printed as
 * `?` so a caller handing in the wrong string can never leak text into the log.
 */
const SESSION_ID_SHAPE = /^[A-Za-z0-9_-]{1,80}$/;
const ENTRANCES: readonly OpenEntrance[] = ["sidebar", "open", "native"];

export interface OpenTraceDeps {
	now(): number;
	nextFrame(callback: () => void): void;
	log(line: string): void;
	setTimer(callback: () => void, ms: number): unknown;
	clearTimer(handle: unknown): void;
}

interface Trace {
	token: number;
	sessionId: string;
	entrance: OpenEntrance;
	start: number;
	stages: Partial<Record<OpenStage, number>>;
	timer: unknown;
	frameRequested: boolean;
}

export interface OpenTracer {
	/** Starts a trace; ends (as `superseded`) any trace still open. Returns its token. */
	begin(sessionId: string, entrance: OpenEntrance): number;
	/** Records a stage for `sessionId` if it is the open trace's target; first write wins. */
	note(sessionId: string | null | undefined, stage: OpenStage): void;
	/** Ends the open trace for `sessionId` with a terminal non-settled outcome. */
	fail(sessionId: string | null | undefined, outcome: "missing" | "left"): void;
	/** The open trace's target, for observers that must not do work otherwise. */
	activeSessionId(): string | null;
	/** The open trace's token, so an observer can tell its own trace from a newer one. */
	currentToken(): number | null;
}

export function formatOpenTraceLine(
	trace: Pick<Trace, "token" | "sessionId" | "entrance" | "start" | "stages">,
	outcome: OpenOutcome,
	supersededBy?: number,
): string {
	const id = SESSION_ID_SHAPE.test(trace.sessionId) ? trace.sessionId : "?";
	const entrance = ENTRANCES.includes(trace.entrance) ? trace.entrance : "open";
	const ms = (at: number | undefined) =>
		at === undefined ? "-" : String(Math.max(0, Math.round(at - trace.start)));
	const { painted, sendable } = trace.stages;
	const settled =
		painted !== undefined && sendable !== undefined
			? Math.max(painted, sendable)
			: undefined;
	const parts = [
		OPEN_TRACE_PREFIX,
		`t=${trace.token}`,
		`session=${id}`,
		`via=${entrance}`,
		`outcome=${outcome}`,
		...OPEN_STAGES.map((stage) => `${stage}=${ms(trace.stages[stage])}`),
		`settled=${ms(settled)}`,
	];
	if (supersededBy !== undefined) parts.push(`by=t${supersededBy}`);
	return parts.join(" ");
}

export function createOpenTracer(deps: OpenTraceDeps): OpenTracer {
	let seq = 0;
	let current: Trace | null = null;

	const finish = (outcome: OpenOutcome, supersededBy?: number) => {
		const trace = current;
		if (!trace) return;
		current = null;
		deps.clearTimer(trace.timer);
		deps.log(formatOpenTraceLine(trace, outcome, supersededBy));
	};

	const record = (trace: Trace, stage: OpenStage) => {
		if (trace.stages[stage] !== undefined) return;
		trace.stages[stage] = deps.now();
		if (
			trace.stages.painted !== undefined &&
			trace.stages.sendable !== undefined
		)
			finish("settled");
	};

	return {
		begin(sessionId, entrance) {
			seq += 1;
			const token = seq;
			if (current) finish("superseded", token);
			const trace: Trace = {
				token,
				sessionId,
				entrance,
				start: deps.now(),
				stages: {},
				timer: undefined,
				frameRequested: false,
			};
			trace.timer = deps.setTimer(() => {
				if (current === trace) finish("timeout");
			}, OPEN_TRACE_TIMEOUT_MS);
			current = trace;
			return token;
		},
		note(sessionId, stage) {
			const trace = current;
			if (!trace || !sessionId || trace.sessionId !== sessionId) return;
			if (stage === "content" && !trace.frameRequested) {
				trace.frameRequested = true;
				record(trace, "content");
				// The token check, not the session id: an A->B->A burst must not
				// let the first A's frame stamp the second A's trace.
				deps.nextFrame(() => {
					if (current === trace) record(trace, "painted");
				});
				return;
			}
			// `painted` is only ever derived from `content`'s frame above.
			if (stage === "painted" || stage === "content") return;
			record(trace, stage);
		},
		fail(sessionId, outcome) {
			if (!current || !sessionId || current.sessionId !== sessionId) return;
			finish(outcome);
		},
		activeSessionId() {
			return current?.sessionId ?? null;
		},
		currentToken() {
			return current?.token ?? null;
		},
	};
}

/*
 * The app's one tracer. Guarded for non-DOM hosts (node tests import modules
 * that import this one) so that loading the module never throws.
 */
const hasDom = typeof window !== "undefined";
export const openTrace: OpenTracer = createOpenTracer({
	now: () => performance.now(),
	nextFrame: (callback) => {
		if (hasDom && typeof requestAnimationFrame === "function")
			requestAnimationFrame(() => callback());
		else setTimeout(callback, 0);
	},
	log: (line) => console.warn(line),
	setTimer: (callback, ms) => setTimeout(callback, ms),
	clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

/**
 * The `sendable` stage, observed from the store rather than written into it.
 *
 * Takes the store's two fields rather than importing the store, so this module
 * stays free of the store's dependency graph (it is imported by the stream hook
 * and the transcript, both hot paths). Called by `openConversation` and the
 * native entrance after `begin`, with the store's own `subscribe`.
 */
export function watchSendable(
	tracer: OpenTracer,
	token: number,
	read: () => {
		activeSessionId: string | null;
		validatingSessionId: string | null;
	},
	subscribe: (listener: () => void) => () => void,
): void {
	// Whether this switch's commit has been observed. `begin` runs BEFORE the
	// store write (so the click is the start), and until that write lands the
	// store is legitimately on the conversation being left.
	let sawTarget = false;
	let unsubscribe: (() => void) | null = null;
	const check = () => {
		const target = tracer.activeSessionId();
		// The trace this watcher belongs to ended (settled, superseded, timed
		// out); a later trace installs its own watcher.
		if (target === null || tracer.currentToken() !== token) {
			unsubscribe?.();
			unsubscribe = null;
			return;
		}
		const state = read();
		if (state.activeSessionId !== target) {
			// The view moved off the target with no new open (a new open would
			// already have superseded this trace): New chat, a staged draft, the
			// store's own rollback.
			if (sawTarget) tracer.fail(target, "left");
			return;
		}
		sawTarget = true;
		// `openSession` commits the target and opens its window in ONE write, so
		// the first observation of the target already sees the window and this
		// waits for it to close. The native entrance's `setActiveSession` opens
		// no window, so it is sendable on commit - which is what the store says.
		if (state.validatingSessionId !== target) tracer.note(target, "sendable");
	};
	unsubscribe = subscribe(check);
	check();
}
