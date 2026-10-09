/**
 * The generating-image card's view model.
 *
 * ONE module owns three facts, and they live together because they move
 * together when the harness freezes its wire fields:
 *
 *   1. WHICH calls this surface renders as an image generation — the detection
 *      set (`IMAGE_GEN_TOOL_NAMES`). One exported constant per surface, so the
 *      frozen tool-name set is adjusted in one place rather than searched for.
 *   2. How a transcript tool record becomes the card's state
 *      (`imageGenCardView`). The record's field names stop here: the card draws
 *      an `ImageGenCardView` and knows nothing else about the transcript.
 *   3. Which affordances a state offers (`imageGenCardControls`), so "renders
 *      only actions that are provided" is one testable rule rather than a
 *      property spread across JSX.
 *
 * THE STATE VOCABULARY (frozen by the harness lane): queued -> running ->
 * done | failed | cancelled, plus cancelling. `cancelling` is deliberately not
 * a record state: it is the pane's own stop fact (`stopping`, the flag the
 * composer's Stop and the working line's stopping rung already read) folded
 * over an unsettled call, so "shown after Cancel until the interrupt settles"
 * derives from the one state machine that owns the interrupt and clears by
 * itself when the receipt answers or the record settles — a local "pressed"
 * flag in the card would latch forever when a press found nothing to stop.
 *
 * FROZEN-FIELD SLOTS, and what is deliberately absent today. The live progress
 * fields — queue position, progress fraction, log lines, provider error
 * payload, artifact ref — are not frozen on the wire yet, and nothing in the
 * frames this app receives today carries them. So the mapping renders the
 * REDUCED state honestly instead of guessing: `progress` is all-absence
 * (`null` / empty), and the generated image arrives through `record.images` —
 * the attachments lane's existing extraction, which is also what the fold's
 * media counting reads. When the fields freeze they are read HERE and nowhere
 * else; the stories drive those shapes through the view type until then.
 *
 * THE PROVIDER-ERROR SHAPE IS FROZEN (manager, 2026-10-08), and its read is
 * the one that lives here today as a best-available source. A failed
 * generation carries `error` — a stable platform sentence that is safe to
 * render as-is — plus `error_type` (FAL's own structured code where one
 * exists, otherwise one of `media_rejected | media_failed |
 * media_rate_limited | media_unavailable`). The card renders `error`
 * VERBATIM: it never layers a substituted sentence of its own over the text.
 * Until `error` lands on the record, the mapping reads the tool result's own
 * output, which is the only error text that exists today; `error_type` is
 * carried on the view (`errorType`) for structure but stays `null` until the
 * field has a home on the wire.
 *
 * AND ONE CODE IS A RECEIPT RATHER THAN AN ERROR: a cancel against an
 * already-finished job comes back as a conflict with `error_type:
 * media_already_completed`, and the card must state "already finished" rather
 * than paint a failure. That is the done state's `already-finished` receipt
 * below — the guard is a two-line arm at this file's error mapping once the
 * field lands, and the stories carry the receipt's render today.
 */

import type { TranscriptImage, TranscriptRecord } from "./transcript-reducer";

/** The tool-record variant of the transcript union, named for this module. */
export type ImageGenToolRecord = Extract<TranscriptRecord, { kind: "tool" }>;

/**
 * THE DETECTION SET.
 *
 * Every surface that special-cases a generating call keys off a set like this
 * one, so a rename in the harness is one edit per surface and never a hunt for
 * string literals. FROZEN by the harness lane (2026-10-08): there is ONE tool,
 * `generate_image` — the image-to-image edit rides the same tool as a
 * `source_image_path` argument, and `generate_altered_image` will NOT exist.
 * This set was briefly two names; the second was dropped before it ever had a
 * producer.
 */
export const IMAGE_GEN_TOOL_NAMES: ReadonlySet<string> = new Set([
	"generate_image",
]);

/** Whether a tool call is one this surface renders as a generating image. */
export function isImageGenTool(toolName: string): boolean {
	return IMAGE_GEN_TOOL_NAMES.has(toolName);
}

/**
 * The live progress facts, as the card consumes them.
 *
 * EVERY FIELD IS NEGATIVEABLE and every absence renders as a reduced state,
 * never as invented copy: `fraction: null` draws the indeterminate branch,
 * `logs: []` draws no log line at all, `queuePosition: null` states no
 * position. `fraction` is a 0..1 ratio when a producer states one; the
 * queue position is 1-based when one exists.
 */
export type ImageGenProgress = {
	fraction: number | null;
	logs: readonly string[];
	queuePosition: number | null;
};

/**
 * One shared all-absence progress, so "nothing to report" is always the same
 * reference and a card that renders on every stream flush allocates nothing.
 */
const NO_PROGRESS: ImageGenProgress = Object.freeze({
	fraction: null,
	logs: [],
	queuePosition: null,
});

/**
 * The card's state, as the mapping produces it.
 *
 * Discriminated rather than one object with optional fields, so a state can
 * only carry facts that exist in it — a clock cannot leak onto a cancellation,
 * and the done state cannot be drawn without its images array.
 */
export type ImageGenCardView =
	| {
			state: "queued";
			/**
			 * The model is still DICTATING the request (the record's `composing`
			 * phase), as opposed to `queued` proper. The distinction is the row's
			 * own quirk (`toolRecordSummary`): only `composing` may claim the
			 * model is still writing, and the byte count is the only honest
			 * progress signal while it is.
			 */
			composing: boolean;
			argumentBytes: number;
			/**
			 * The LIVE queue position (1-based) of a waiting call, or `null` while
			 * no frame states one — the same negativeable slot every progress fact
			 * gets (see `ImageGenProgress`): the card draws no position rather than
			 * a zero. No frame carries it today; when the harness freezes the
			 * field, its read lands in `imageGenCardView` below and the state
			 * line's datum slot is its one consumer (round-1 QA Q-1).
			 */
			queuePosition: number | null;
	  }
	| {
			state: "running";
			/**
			 * Wall-clock ms the call started executing, or `null` when the frame
			 * stated none. `null` draws the state line WITHOUT a clock — the
			 * absence is rendered, not filled in.
			 */
			startedAtMs: number | null;
			progress: ImageGenProgress;
	  }
	| {
			state: "cancelling";
			/** The call had already started executing when the stop was pressed. */
			generating: boolean;
			startedAtMs: number | null;
			progress: ImageGenProgress;
	  }
	| {
			state: "done";
			images: readonly TranscriptImage[];
			/** The backend's measured duration, or `null` for a replayed row. */
			durationS: number | null;
			/**
			 * Which receipt the line states. `already-finished` is the frozen
			 * `media_already_completed` arm (see the header): the generation completed
			 * before a cancel could act, so the card states the finish — never an
			 * error, and never a cancellation that did not happen.
			 */
			receipt: "generated" | "already-finished";
	  }
	| {
			state: "failed";
			/**
			 * The error sentence VERBATIM — the frozen `error` field, or today the
			 * tool result's own output, which is the only error text that exists —
			 * and `null` when none was stated (the card then falls back to its own
			 * absence sentence rather than inventing a detail). Rendered as-is: the
			 * card never wraps it in a sentence this app substituted for the
			 * provider's.
			 */
			message: string | null;
			/**
			 * The frozen `error_type` once the field lands (FAL's structured code or
			 * a `media_*` platform code), carried for structure rather than display.
			 * `null` today: the field has no home on the wire yet.
			 */
			errorType: string | null;
	  }
	| { state: "cancelled" };

/** The state tag alone, for callers that switch on it without the payload. */
export type ImageGenCardState = ImageGenCardView["state"];

/**
 * Which arm of the state vocabulary a record is in.
 *
 * THE ORDER OF THE ARMS IS THE MAPPING. An interruption outranks everything
 * (a call the user stopped mid-run did not fail, and must not be reported as
 * one); a verdict outranks `neverSent` because it is the richer fact; and
 * `isError` outranks the phase because a settled error is a failure whatever
 * the phase column last said.
 */
export function imageGenCardView(
	record: ImageGenToolRecord,
	{ stopping = false }: { stopping?: boolean } = {},
): ImageGenCardView {
	/*
	 * ARM 1, the interrupts. `stopped` is the call that was running when the
	 * turn was aborted; `skipped`/`aborted` are the harness's verdicts that the
	 * turn itself (steering, a stop) kept the call from running. Both are the
	 * interrupt class the ledger already spells `interrupted`, and the card's
	 * `cancelled` is the same claim: no image was produced, and nothing failed.
	 */
	if (record.stopped === true) return { state: "cancelled" };
	if (record.notRunKind === "skipped" || record.notRunKind === "aborted")
		return { state: "cancelled" };
	/*
	 * ARM 2, the planning verdicts (`unknown_tool`, `invalid_arguments`,
	 * `duplicate_id`, `denied`, `gate_failed`): the harness's own reason is the
	 * whole content of the fact, so it IS the failed state's text — rendered
	 * as-is, like every failure text (the frozen shape supplies sentences that
	 * are safe to render; nothing here layers one of its own over them).
	 * TRUTHINESS rather than `!== null` for the reason the transcript's own
	 * reader gives: a record built by hand (a test fixture, a story) carries no
	 * `notRunReason` key at all, and an absent key must not read as a verdict.
	 */
	if (record.notRunReason)
		return { state: "failed", message: record.notRunReason, errorType: null };
	/*
	 * ARM 3, the turn that died while the call was still being dictated: the
	 * harness's `never sent` fact with no verdict at all. Nothing failed and
	 * nothing was measured, so this is a cancellation in the plain sense — the
	 * restart affordance is the honest one, and no error sentence is invented.
	 */
	if (record.neverSent === true) return { state: "cancelled" };
	/*
	 * ARM 4, the tool's own error result. The message is the frozen `error`
	 * field once it lands on the record; until then it is the result's output
	 * VERBATIM — the error text as it reached the transcript — and `null` when
	 * the result carried none, which the card renders as its own absence
	 * sentence rather than a substitute for supplied text. `stopping` does NOT
	 * override a settled failure: the interrupt's overlay belongs to an
	 * unsettled call (below), and a receipt answering `idle` over a failed
	 * record must not reopen it.
	 */
	if (record.isError === true)
		return { state: "failed", message: record.output, errorType: null };
	/*
	 * ARM 5, the unsettled phases. `stopping` (the pane's stop in flight) turns
	 * both into the cancelling step — for `running` the call is still executing
	 * and the generating body stays; for `composing`/`queued` nothing was
	 * generating yet, so the card must not grow a generating tile OR a progress
	 * bar the state never had (the bar joined the tile's rule in round-1
	 * remediation, F3; the component holds both behind one predicate).
	 */
	switch (record.phase) {
		case "composing":
		case "queued": {
			if (stopping)
				return {
					state: "cancelling",
					generating: false,
					startedAtMs: null,
					progress: NO_PROGRESS,
				};
			return {
				state: "queued",
				composing: record.phase === "composing",
				argumentBytes: record.argumentBytes ?? 0,
				/*
				 * The frozen-field slot (see the header): nothing on today's records
				 * carries a queue position, so the mapping states the absence — the
				 * record's field names stop at this module, and when the wire freezes
				 * the field its read is HERE.
				 */
				queuePosition: null,
			};
		}
		case "running": {
			const startedAtMs = record.startedAt ?? null;
			if (stopping)
				return {
					state: "cancelling",
					generating: true,
					startedAtMs,
					progress: NO_PROGRESS,
				};
			return { state: "running", startedAtMs, progress: NO_PROGRESS };
		}
		case "done":
			/*
			 * THE SETTLED SUCCESS. `images` is what the row's own media block
			 * renders from and what `foldImages` counts, so the card and the
			 * condensed strip cannot disagree about whether a picture exists.
			 */
			return {
				state: "done",
				images: record.images ?? [],
				durationS: record.durationS ?? null,
				receipt: "generated",
			};
	}
}

/** Which affordance a control is. */
export type ImageGenActionKind = "cancel" | "restart" | "editRestart";

/**
 * The handlers an integration may wire. THE CARD RENDERS ONLY WHAT IS
 * PROVIDED: an absent handler is an absent control, never a dead button.
 *
 * The restart and edit-restart slots are deliberately unwired in v1 — the
 * harness has not named the regenerate op, and a press that fakes it would
 * invent a mechanism (interrupt-and-re-call is the v1 shape, but the named op
 * is not this round's to define). Stories demonstrate them with stub handlers
 * so the design round can review the affordances; integration passes none.
 */
export type ImageGenCardActions = {
	onCancel?: () => void;
	onRestart?: () => void;
	onEditRestart?: () => void;
};

export type ImageGenCardControl = {
	kind: ImageGenActionKind;
	/**
	 * Drawn, but not pressable. Only `cancel` is ever disabled: while the stop
	 * is in flight the control stays in place (the composer holds its slot for
	 * the same reason) and re-enables if the interrupt does not take.
	 */
	disabled: boolean;
};

/**
 * The controls to draw for a state, given what the caller wired.
 *
 * - `cancel` while the call is unsettled (queued, running, cancelling); it
 *   binds to the existing turn-interrupt path, so it is offered exactly where
 *   that press has something to act on.
 * - `restart` / `editRestart` once the state is terminal without an image
 *   (failed, cancelled). A DONE card offers neither: the artifact is there,
 *   and the design’s regenerate affordance has no named op yet.
 */
export function imageGenCardControls(
	view: ImageGenCardView,
	actions?: ImageGenCardActions,
): ImageGenCardControl[] {
	const controls: ImageGenCardControl[] = [];
	const unsettled =
		view.state === "queued" ||
		view.state === "running" ||
		view.state === "cancelling";
	if (actions?.onCancel && unsettled)
		controls.push({ kind: "cancel", disabled: view.state === "cancelling" });
	const terminalWithoutImage =
		view.state === "failed" || view.state === "cancelled";
	if (actions?.onRestart && terminalWithoutImage)
		controls.push({ kind: "restart", disabled: false });
	if (actions?.onEditRestart && terminalWithoutImage)
		controls.push({ kind: "editRestart", disabled: false });
	return controls;
}
