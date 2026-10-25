/**
 * The generating-image card's view model.
 *
 * ONE module owns three facts, and they live together because they move
 * together when the harness freezes its wire fields:
 *
 *   1. WHICH calls this surface renders as a generating-media card — the
 *      detection set (`IMAGE_GEN_TOOL_NAMES`). One exported constant per
 *      surface, so the frozen tool-name set is adjusted in one place rather
 *      than searched for.
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
 * ONE CARD, TWO MATERIALS (video phase, contract §5.4). `generate_video` rides
 * this card's whole six-state machine unchanged — its live life is
 * submit-to-receipt like the image lane's, so the same states render — and the
 * ONLY fact video adds is the MATERIAL NOUN where a sentence names the
 * artifact ("Generating video…", "Generated video", "The video could not be
 * generated."). That fact is `ImageGenMaterial` below, derived from the
 * record's tool name in `imageGenCardView` and carried on the three arms that
 * can render a material word. Every other string renders byte-identically to
 * the imagegen rendering (the design spec's V-delta enumeration is the
 * complete legal list), and the card's Cancel control is deliberately NOT
 * offered on a video call: an in-turn press cannot cancel a detached video
 * job (contract §4.2), so the mount withholds the handler rather than drawing
 * a control whose press would lie (`canonical-transcript.tsx`).
 *
 * FROZEN-FIELD SLOTS, NOW WIRED (harness PR #2089, 2026-10-09). The live
 * progress fields arrive in the canonical payload the record carries as
 * `details` (`transcript-reducer.ts`'s tool record — written from the live
 * `tool_execution_update` frames, a settling result's own details, and the
 * durable row's `provider_payload.details`): `stage`, `queue_position`,
 * `progress_fraction`, `log_lines`, `error`, `error_type`, every key present
 * on every frame with `null` where no producer supplied one. THE FIELD-NAME
 * KNOWLEDGE LIVES HERE — `canonicalProgress` below is the surface's one
 * reader, and the mapping renders the REDUCED state honestly when a frame
 * states nothing (a `null` fraction draws no bar, no log lines draw no tail,
 * no queue depth states none): absence is rendered, never filled in. The
 * generated image still arrives through `record.images` — the attachments
 * lane's extraction, which is also what the fold's media counting reads.
 *
 * THREE WIRE FACTS THIS READ HONOURS, each from the frozen semantics:
 *
 *   - `progress_fraction` stays `null` until a provider reports one —
 *     deliberately never synthesized (elapsed-vs-budget is a TIMEOUT, not
 *     progress). So the determinate bar branch remains story-driven in
 *     practice; the read is here for the day a fraction lands.
 *   - `stage: null` is a MID-WALK FAILURE (a rung failed; the next rung's
 *     `queued` will replace it), and its semantics ride `error`/`error_type`
 *     — "the pair the surfaces branch on". An unsettled call whose latest
 *     frame carries the pair therefore paints the failure's text VERBATIM in
 *     the failed presentation and flips back when the next frame arrives;
 *     the design round ruled the SETTLED failure's copy, not this live arm's,
 *     so it is recorded in the PR body rather than treated as ruled.
 *   - the error sentence renders VERBATIM (a stable platform sentence that is
 *     safe to read as-is; `error_type` labels the refusal above that text).
 *
 * AND ONE CODE IS A RECEIPT RATHER THAN AN ERROR: a cancel against an
 * already-finished job comes back as a conflict with `error_type:
 * media_already_completed` (plus the platform's sentence), and the card
 * states "already finished" rather than painting a failure — the done
 * state's `already-finished` receipt, which the mapping's error arm now
 * routes to. A plain cancel's result states `stage: "cancelled"` with NO
 * `error_type`, and maps to the cancelled state; the receipt text rides the
 * result's own content either way.
 */

import { soundCostCaption } from "./sound-cost-caption";
export { soundCostCaption } from "./sound-cost-caption";
import {
	type SoundBatchItem,
	soundBatchCostCaption,
	soundBatchItems,
	soundBatchNote,
	soundBatchProgress,
	soundBatchSummary,
} from "./sound-batch-model";
import type { TranscriptImage, TranscriptRecord } from "./transcript-reducer";

/** The tool-record variant of the transcript union, named for this module. */
export type ImageGenToolRecord = Extract<TranscriptRecord, { kind: "tool" }>;

/**
 * THE DETECTION SET.
 *
 * Every surface that special-cases a generating call keys off a set like this
 * one, so a rename in the harness is one edit per surface and never a hunt for
 * string literals. The image half is FROZEN by the harness lane (2026-10-08):
 * `generate_image` — the image-to-image edit rides the same tool as a
 * `source_image_path` argument, and `generate_altered_image` will NOT exist.
 * The video phase adds the second member (contract §1.0): `generate_video`
 * registers a detached `AsyncJob` and returns a receipt in milliseconds, so
 * its card paints only the submit-to-receipt frames (the minutes-long motif is
 * the run-details Jobs row and the completion row, §5.4) — but it is the same
 * card, and THIS is the one edit that routes it there.
 *
 * The video member is a named constant because exactly one string may spell
 * it: the set routes the card, and `isVideoGenTool` below is the material
 * fact every noun branch reads. Two literals would be two edits at rename
 * time, which is the class of drift this set exists to prevent.
 */
export const VIDEO_GEN_TOOL_NAME = "generate_video";

/**
 * The two audio members of the detection set (sound phase, 2026-10-17), named
 * here because exactly one string may spell each one: the set routes the card
 * (`isImageGenTool`), and `imageGenMaterial` below is the noun fact every copy
 * branch reads. Two literals would be two edits at rename time.
 *
 * These calls ride the card's whole six-state machine unchanged — their live
 * life is submit-to-receipt like the image lane's — and the facts that differ
 * from the image lane are the MATERIAL NOUN and the artifact render (a sound
 * through `CanonicalAudio`, mounted from the done body by the entry's kind).
 * Nothing about their state vocabulary, progress fields or settling rules is
 * new: the harness registers them as ordinary tool calls, so the card that
 * already speaks the record's `details` wire reads them as-is.
 *
 * vs VIDEO's mount rule, `imageGenCardMountActions` below spells the one
 * behavioural difference: a video call is a detached job an in-turn press
 * cannot cancel, so it draws no Cancel; the audio tools are interruptible
 * (`interruptible=True` in the frozen tool schema), so an unsettled one keeps
 * the pane's interrupt exactly as an image call does.
 */
export const VOICEOVER_GEN_TOOL_NAME = "generate_voiceover";
export const SOUND_EFFECT_GEN_TOOL_NAME = "generate_sound_effect";

export const IMAGE_GEN_TOOL_NAMES: ReadonlySet<string> = new Set([
	"generate_image",
	VIDEO_GEN_TOOL_NAME,
	VOICEOVER_GEN_TOOL_NAME,
	SOUND_EFFECT_GEN_TOOL_NAME,
]);

/** Whether a tool call is one this surface renders as a generating-media card. */
export function isImageGenTool(toolName: string): boolean {
	return IMAGE_GEN_TOOL_NAMES.has(toolName);
}

/** Whether a tool call is the video lane's generating call. */
export function isVideoGenTool(toolName: string): boolean {
	return toolName === VIDEO_GEN_TOOL_NAME;
}

/**
 * Whether a tool call is one of the two AUDIO calls, whose settlement can
 * arrive later on its own journal row (`audio_settle_v1`).
 *
 * A separate predicate from `isImageGenTool` because the settlement link is
 * a fact about the audio lifecycle only: images and videos have no
 * bounded-poll settlement row, so nothing there can retire a clause.
 */
export function isSoundGenTool(toolName: string): boolean {
	return (
		toolName === VOICEOVER_GEN_TOOL_NAME ||
		toolName === SOUND_EFFECT_GEN_TOOL_NAME
	);
}

/**
 * Which artifact a card's sentence names when it names one.
 *
 * ONE fact, derived once from the record's tool name in `imageGenCardView` and
 * carried on the arms that can render a material word — never re-derived at a
 * call site, so the state line and the failure fallback cannot come to disagree
 * about what an artifact is. The enumeration of strings it may steer is the
 * design spec's V-list (§4) extended by the sound phase's own delta: the two
 * audio arms name their artifact and nothing else about the card moves.
 */
export type ImageGenMaterial = "image" | "video" | "voiceover" | "sound-effect";

/** The material fact for one tool call. */
export function imageGenMaterial(toolName: string): ImageGenMaterial {
	if (toolName === VIDEO_GEN_TOOL_NAME) return "video";
	if (toolName === VOICEOVER_GEN_TOOL_NAME) return "voiceover";
	if (toolName === SOUND_EFFECT_GEN_TOOL_NAME) return "sound-effect";
	return "image";
}

/**
 * THE TWO CANCEL SENTENCES (security round 1, 2026-10-17), and the rule they
 * exist to enforce: STOP IS A REQUEST, GUARANTEED ONLY WHILE QUEUED.
 *
 * The frozen contract is explicit that cancellation is best-effort — once the
 * vendor is IN_PROGRESS there is no cancel endpoint, `cancellation.vendor_
 * stopped` is `false`, and the generation continues and bills if it produces
 * audio. So the card may make the no-charge claim ONLY for a stop pressed
 * before the provider was called, and must state the request (with its cost
 * consequence) for anything that had started. Showing the queued sentence for
 * an in-flight cancel is the one wording error that would read as a promise the
 * platform cannot keep.
 *
 * COPIED VERBATIM from the security round's ruling (and its server follow-up,
 * PR #139): these two sentences are product copy, reviewed as such, and are
 * asserted byte-for-byte by the card's own suite.
 *
 * THE RUNNING SENTENCE'S LAST CLAUSE IS A PENDING-SETTLEMENT STATE, not a
 * hedge: after a running cancel the harness bounded-polls the provider for up
 * to ~2 minutes and may later append a settlement notice with the billed cost
 * and the completed artifact. The card therefore claims "checking", never a
 * final no-charge, and the later notice renders as an ordinary custom row
 * (no second player path: a settled artifact enters the session index the
 * Files/Highlights surfaces already read).
 */
export const CANCEL_QUEUED_COPY =
	"Stopped before the provider was called; you will not be charged.";

export const CANCEL_RUNNING_COPY =
	"Stop requested. The provider has no cancellation endpoint; the generation continues and will be charged if it produces audio. Checking for settlement.";

/**
 * THE RATE-LIMITED SENTENCE (sound phase, 2026-10-17). The server's fixed copy
 * for `audio_rate_limited`: a submit-time 429 the harness backs off from, or a
 * vendor 429 that settles the job as an error at zero cost. Retryable by
 * calling again — NOT by a control that promises the next call will succeed.
 *
 * Used only when the record names the TYPE and states no sentence: a tool
 * result's own message always wins (the failure arm's verbatim rule), and this
 * sentence is the absence's copy rather than a replacement for supplied text.
 */
export const AUDIO_RATE_LIMITED_COPY =
	"Audio generation is busy right now. Wait a moment and try again.";

/**
 * The material's noun, as the card's sentences spell it.
 *
 * One spelling per material, beside `imageGenMaterial` so a sentence that
 * wants a noun cannot invent a second spelling of one ("sound effect" vs
 * "sound-effect" vs "sfx"): the state line, the done receipt and the failure
 * fallback all read THIS function.
 */
export function imageGenMaterialNoun(material: ImageGenMaterial): string {
	switch (material) {
		case "video":
			return "video";
		case "voiceover":
			return "voiceover";
		case "sound-effect":
			return "sound effect";
		default:
			return "image";
	}
}

/**
 * The live progress facts, as the card consumes them.
 *
 * EVERY FIELD IS NEGATIVEABLE and every absence renders as a reduced state,
 * never as invented copy: `fraction: null` draws the indeterminate branch,
 * `logs: []` draws no log line at all, `queuePosition: null` states no
 * queue depth. `fraction` is a 0..1 ratio when a producer states one;
 * `queuePosition` keeps the wire's name but COUNTS REQUESTS AHEAD of this
 * one (0 = nothing ahead), not a 1-based rank — the card words it "N ahead".
 */
export type ImageGenProgress = {
	fraction: number | null;
	logs: readonly string[];
	queuePosition: number | null;
};

/**
 * The canonical payload, as this adapter reads it — THE ONE PLACE its field
 * names are spelled. Every value is normalised to its absence: a key that is
 * not the type the contract states (a free-form-JSON stray) reads as `null`,
 * never as a value the mapping could render.
 */
type CanonicalProgress = {
	stage: string | null;
	fraction: number | null;
	logs: readonly string[];
	queuePosition: number | null;
	error: string | null;
	errorType: string | null;
};

/** The `log_lines` messages, in order — malformed entries dropped, not guessed. */
function logMessages(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];
	const lines: string[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const message = (entry as Record<string, unknown>).message;
		if (typeof message === "string" && message) lines.push(message);
	}
	return lines;
}

/**
 * The record's `details` carrier, read into the contract's vocabulary. The
 * negativeable shape every fact shares: anything the frame did not state is
 * `null` (or an empty list), and the card's reduced branches render that
 * absence rather than a stand-in.
 */
function canonicalProgress(
	details: Record<string, unknown> | null | undefined,
): CanonicalProgress {
	const frame = details ?? {};
	return {
		stage: typeof frame.stage === "string" ? frame.stage : null,
		fraction:
			typeof frame.progress_fraction === "number" &&
			Number.isFinite(frame.progress_fraction)
				? frame.progress_fraction
				: null,
		logs: logMessages(frame.log_lines),
		queuePosition:
			typeof frame.queue_position === "number" &&
			Number.isInteger(frame.queue_position)
				? frame.queue_position
				: null,
		error: typeof frame.error === "string" && frame.error ? frame.error : null,
		errorType:
			typeof frame.error_type === "string" && frame.error_type
				? frame.error_type
				: null,
	};
}

/**
 * The progress facts a view carries, with the all-absence case returned as the
 * one shared frozen reference (`NO_PROGRESS`) — a card that renders on every
 * stream flush allocates nothing while a frame states nothing.
 */
function progressFrom(canonical: CanonicalProgress): ImageGenProgress {
	if (
		canonical.fraction === null &&
		canonical.logs.length === 0 &&
		canonical.queuePosition === null
	)
		return NO_PROGRESS;
	return {
		fraction: canonical.fraction,
		logs: canonical.logs,
		queuePosition: canonical.queuePosition,
	};
}

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
			 * Which artifact this call will produce. Carried on the queued arm so a
			 * queued SOUND can draw its own seat (`SoundGeneratingTile`'s queued
			 * state) instead of falling back to no tile at all; a picture's seat is
			 * still only drawn once it exists (the image card's own rule).
			 */
			material: ImageGenMaterial;
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
			 * The LIVE queue depth of a waiting call — the number of requests AHEAD
			 * of it, so 0 is a real reading ("nothing ahead"), not a rank — or
			 * `null` while no frame states one — the same negativeable slot every
			 * progress fact gets (see `ImageGenProgress`): the card draws nothing
			 * rather than an invented count. Read from the canonical carrier's
			 * `queue_position` (the wire's name for it); the state
			 * line's datum slot is its one consumer (round-1 QA Q-1).
			 */
			queuePosition: number | null;
	  }
	| {
			state: "running";
			batchProgress?: { total: number; note: string | null };
			/**
			 * Which artifact this call produces — the one fact the state line's noun
			 * branches on ("Generating image…" / "Generating video…"). The failure
			 * fallback and the done sentence read the same fact, from the same
			 * derivation.
			 */
			material: ImageGenMaterial;
			/**
			 * Wall-clock ms the call started executing, or `null` when the frame
			 * stated none. `null` draws the state line WITHOUT a clock — the
			 * absence is rendered, not filled in.
			 */
			startedAtMs: number | null;
			progress: ImageGenProgress;
			/**
			 * The interim's account of the last frame (design round 1, D1): the wire's
			 * mid-walk failure sentence (`stage: null` plus the error pair, on a call
			 * that continues), or `null` while no frame states one. A NOTE rather than
			 * a state — a failure latch would misreport recovery — so it disappears
			 * with the frame that carried it and paints nothing the wire did not
			 * claim; the card renders it under the live body, the failed arm's
			 * verbatim text.
			 */
			note: string | null;
	  }
	| {
			state: "cancelling";
			/** The call had already started executing when the stop was pressed. */
			generating: boolean;
			/** The artifact the call was making; lets the seat pick the sound band. */
			material: ImageGenMaterial;
			startedAtMs: number | null;
			progress: ImageGenProgress;
	  }
	| {
			state: "done";
			/** A result-backed receipt, never a quote relabelled as a charge. */
			costCaption?: string | null;
			/** Additive batch receipts; null retains the approved single-player body. */
			batch?: SoundBatchItem[] | null;
			batchSummary?: string;
			batchNote?: string | null;
			images: readonly TranscriptImage[];
			/** The material noun this receipt names ("Generated image" / "Generated video"). */
			material: ImageGenMaterial;
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
			batch?: SoundBatchItem[] | null;
			batchSummary?: string;
			batchNote?: string | null;
			costCaption?: string | null;
			/** The material noun the absence sentence names when no text was stated. */
			material: ImageGenMaterial;
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
			 * Human-readable sound/planning failure class, or null for other media
			 * and when the unchanged error sentence already opens with that class.
			 * The raw wire discriminator stays in `canonicalProgress` for state
			 * selection; identifiers must not leak into the reader-facing label.
			 */
			errorType: string | null;
	  }
	| {
			state: "cancelled";
			material?: ImageGenMaterial;
			batch?: SoundBatchItem[] | null;
			batchSummary?: string;
			batchNote?: string | null;
			costCaption?: string | null;
			settlementCaption?: string | null;
			/**
			 * Whether a TERMINAL settlement for this call exists somewhere else in
			 * the transcript - the `audio_settle_v1` journal row that arrives after
			 * the cancelled call and renders as its own receipt.
			 *
			 * Distinct from `settlementCaption`, which is the same fact carried on
			 * the call's own details. Both retire the cancelled line's
			 * "Checking for settlement." clause (design D7, UX U9); only the
			 * caption also paints the amount under the call.
			 */
			settled?: boolean;
			/**
			 * Whether the call had started executing when it was stopped. The
			 * settled receipt's sentence follows the same queued/running split the
			 * cancelling line does: an in-flight stop never reads as a no-charge
			 * cancellation (`CANCEL_RUNNING_COPY`), because the vendor has no
			 * cancellation endpoint and may have produced (and charged for) audio.
			 */
			generating: boolean;
			/**
			 * The tool/server detail for the stop — the result's own content when
			 * it stated one. Preferred over either canned sentence: the wire's
			 * own words are the receipt (`media_already_completed`'s sibling rule).
			 */
			message: string | null;
	  };

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
	{
		stopping = false,
		settled = false,
	}: {
		stopping?: boolean;
		/**
		 * A terminal settlement row for this call exists later in the transcript.
		 * Read by the cancelled arms only, and only to retire the pending clause -
		 * the receipt itself is that row's to paint.
		 */
		settled?: boolean;
	} = {},
): ImageGenCardView {
	/* The canonical payload, read once for every arm below that branches on it. */
	const canonical = canonicalProgress(record.details);
	/*
	 * The material fact, derived ONCE from the call's own tool name — the one
	 * input every noun branch below reads (see `ImageGenMaterial`). A branch
	 * that wants to know what artifact this call makes asks THIS value, never
	 * the tool name again.
	 */
	const material = imageGenMaterial(record.toolName);
	const sound = material === "voiceover" || material === "sound-effect";
	const batch =
		sound && record.phase === "done"
			? soundBatchItems(record.details, record.images ?? [])
			: null;
	const batchProgress = sound
		? soundBatchProgress(record.args, record.details)
		: null;
	const batchFields = batch
		? {
				batch,
				batchSummary: soundBatchSummary(record.details, batch),
				batchNote: soundBatchNote(record.details, record.output),
			}
		: {};
	const settlementCaption = sound
		? soundSettlementCaption(record.details)
		: null;
	/*
	 * ARM 1, the interrupts. `stopped` is the call that was running when the
	 * turn was aborted; `skipped`/`aborted` are the harness's verdicts that the
	 * turn itself (steering, a stop) kept the call from running. Both are the
	 * interrupt class the ledger already spells `interrupted`, and the card's
	 * `cancelled` is the same claim: no image was produced, and nothing failed.
	 */
	if (record.stopped === true)
		return {
			state: "cancelled",
			generating: record.startedAt !== null,
			message: canonical.error ?? record.output,
			...(batch
				? {
						...batchFields,
						material,
						costCaption: soundBatchCostCaption(record.details),
					}
				: {}),
			...(settlementCaption ? { settlementCaption } : {}),
			...(settlementCaption || settled ? { settled: true } : {}),
		};
	if (record.notRunKind === "skipped" || record.notRunKind === "aborted")
		return { state: "cancelled", generating: false, message: record.output };
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
		return {
			state: "failed",
			material,
			message: record.notRunReason,
			errorType: sound
				? humanErrorClass(record.notRunKind, record.notRunReason)
				: null,
		};
	/*
	 * ARM 3, the turn that died while the call was still being dictated: the
	 * harness's `never sent` fact with no verdict at all. Nothing failed and
	 * nothing was measured, so this is a cancellation in the plain sense — the
	 * restart affordance is the honest one, and no error sentence is invented.
	 */
	if (record.neverSent === true)
		return { state: "cancelled", generating: false, message: record.output };
	// An all-failed batch is one failed call, but its individual server errors
	// are still the product. Keep them instead of collapsing to one text blob.
	if (batch && record.isError)
		return {
			state: "failed",
			material,
			message: canonical.error ?? record.output,
			errorType: humanErrorClass(
				canonical.errorType,
				canonical.error ?? record.output,
			),
			...batchFields,
			costCaption: soundBatchCostCaption(record.details),
		};
	/*
	 * ARM 4, the tool's own error result — three readings, in this order:
	 *
	 *   - the CONFLICT receipt: `media_already_completed` is a cancel that lost
	 *     its race with the finish, so the card states the finish (the done
	 *     state's `already-finished` receipt) rather than painting a failure;
	 *   - a PLAIN CANCEL: the result states `stage: "cancelled"` with no
	 *     `error_type` — the wire's own line between "stopped" and "failed" —
	 *     and maps to the cancelled state (the interrupt arms above catch the
	 *     stopped records; this arm catches the result's own self-description);
	 *   - a FAILURE: the message is the frozen `error` field VERBATIM, falling
	 *     back to the result's output — the error text as it reached the
	 *     transcript — and `null` when the result carried neither, which the
	 *     card renders as its own absence sentence rather than a substitute for
	 *     supplied text. `stopping` does NOT override a settled failure: the
	 *     interrupt's overlay belongs to an unsettled call (below), and a
	 *     receipt answering `idle` over a failed record must not reopen it.
	 */
	if (record.isError === true) {
		if (canonical.errorType === "media_already_completed")
			return {
				state: "done",
				images: record.images ?? [],
				material,
				durationS: record.durationS ?? null,
				receipt: "already-finished",
			};
		if (canonical.stage === "cancelled" && canonical.errorType === null)
			return {
				state: "cancelled",
				/*
				 * The result calls itself cancelled; whether that was a queued or
				 * an in-flight stop is the START fact, which the record carries.
				 */
				generating: record.startedAt !== null,
				message: canonical.error ?? record.output,
				...(settlementCaption ? { settlementCaption } : {}),
				...(settlementCaption || settled ? { settled: true } : {}),
			};
		return {
			state: "failed",
			material,
			/*
			 * The sentence precedence, in the card's own order: the wire's error
			 * text, then the tool result's own content, and only then the fixed
			 * copy for a type that states nothing to read. `audio_rate_limited` is
			 * the one type the server authors a reader sentence for; every other
			 * absence keeps the card's generic fallback.
			 */
			message:
				canonical.error ??
				record.output ??
				(canonical.errorType === "audio_rate_limited"
					? AUDIO_RATE_LIMITED_COPY
					: null),
			errorType: sound
				? humanErrorClass(canonical.errorType, canonical.error ?? record.output)
				: null,
		};
	}
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
					material,
					startedAtMs: null,
					progress: NO_PROGRESS,
				};
			return {
				state: "queued",
				material,
				composing: record.phase === "composing",
				argumentBytes: record.argumentBytes ?? 0,
				/*
				 * The live field's one render (see the header): the last frame's stated
				 * position, or `null` — which the card's datum slot renders as the byte
				 * count's absence rather than a stand-in number.
				 */
				queuePosition: canonical.queuePosition,
			};
		}
		case "running": {
			const startedAtMs = record.startedAt ?? null;
			if (stopping)
				return {
					state: "cancelling",
					generating: true,
					material,
					startedAtMs,
					progress: progressFrom(canonical),
				};
			/*
			 * THE MID-WALK FAILURE rides as the interim's NOTE (design round 1, D1 —
			 * this arm's first ruling; the PR body's "recorded, not ruled" note is
			 * retired by it): the wire's `stage: null` frame names a rung failure on
			 * a call that CONTINUES, so the call keeps its live presentation (tile,
			 * state line, clock, Cancel) and states the pair's sentence as a note
			 * line under the body — the failed arm's own text, VERBATIM, replaced
			 * when the next frame arrives. Deliberately NOT a latch of the failure:
			 * holding the note through a recovering run would misreport it, so
			 * nothing the wire does not claim is painted, and the un-say is just
			 * the note's absence on the next frame. The stopping overlay above
			 * outranks it because the stop is the newer fact.
			 */
			return {
				state: "running",
				material,
				startedAtMs,
				progress: progressFrom(canonical),
				note: canonical.error,
				...(batchProgress ? { batchProgress } : {}),
			};
		}
		case "done": {
			const cost = sound
				? soundCostCaption(record.details, record.output)
				: null;
			/*
			 * THE SETTLED SUCCESS. `images` is what the row's own media block renders
			 * from — the card mounts each entry by its KIND (a picture through
			 * `CanonicalImage`, a video through the digest-fed player) — and what
			 * `foldImages` counts PICTURES in, so the card and the condensed strip
			 * cannot disagree about whether a picture exists.
			 */
			return {
				state: "done",
				images: record.images ?? [],
				material,
				durationS: record.durationS ?? null,
				receipt: "generated",
				batch,
				...batchFields,
				costCaption: batch ? soundBatchCostCaption(record.details) : cost,
			};
		}
	}
}

/** The clause `withoutSettlementClause` retires; top-level so it compiles once. */
const SETTLEMENT_PENDING_CLAUSE = /\s*Checking for settlement\.?\s*$/;

/**
 * The cancelled line minus the clause a settlement row answers.
 *
 * ONE FACT, ONE ROW (design D7, UX U8/U9). "Checking for settlement." is a
 * present-tense claim about work still outstanding; once a pending row or a
 * billed receipt exists it IS the answer, so keeping the clause above it
 * either repeats it (pending) or contradicts it (settled). Only the trailing
 * clause is retired - the sentence's own stop facts stay as the wire wrote
 * them, and a row with no settlement row is untouched.
 */
export function withoutSettlementClause(sentence: string): string {
	return sentence.replace(SETTLEMENT_PENDING_CLAUSE, "").trimEnd();
}

/** A cancelled request can still be billed: retain the server's unknowns. */
function soundSettlementCaption(details: unknown): string | null {
	if (!details || typeof details !== "object") return null;
	const result = details as Record<string, unknown>;
	const cost = result.cost as Record<string, unknown> | null;
	if (result.settled === true) return soundCostCaption(details);
	return result.settled === null &&
		result.cost_usd === null &&
		cost?.basis === "quote"
		? "Settlement pending — the final charge will appear once the provider reports it."
		: null;
}

/** Labels are for sound/planning failures only; never repeat the opening sentence. */
function humanErrorClass(
	kind: string | null | undefined,
	message?: string | null,
): string | null {
	if (!kind) return null;
	const words = kind.replace(/_/g, " ");
	if (message?.toLowerCase().startsWith(words.toLowerCase())) return null;
	return words.charAt(0).toUpperCase() + words.slice(1);
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

/**
 * The actions a transcript mount passes to a card of this call — the ONE
 * mount-level affordance rule, beside the state-level one it feeds.
 *
 * A VIDEO call gets NO action at all (R4, contract §4.2): an in-turn press
 * cannot cancel a detached job — the card paints the submit-to-receipt frames
 * and the job outlives the call — so a Cancel drawn there would lie in its
 * accessibility hint and do nothing at the wire. The cancel rail for a video
 * job is the run-details Jobs row, which addresses the job rather than the
 * call. An IMAGE call keeps the pane's interrupt on the same press it always
 * had, and a mount with no interrupt wired passes nothing either way — the
 * card renders only what it is provided, so the withheld handler IS the
 * absence, and this rule is the one place a later wiring pass would have to
 * edit to (wrongly) re-open it.
 */
export function imageGenCardMountActions(
	toolName: string,
	onInterruptTurn: (() => void) | undefined,
): ImageGenCardActions | undefined {
	if (isVideoGenTool(toolName)) return undefined;
	/*
	 * AND THE AUDIO CALLS KEEP THE INTERRUPT — the only cancel affordance this
	 * card may draw for them, because it is the only one that cannot lie. The
	 * frozen tool schema registers `generate_voiceover`/`generate_sound_effect`
	 * as `interruptible=True`, so the pane's own interrupt is a real press on
	 * the wire (the harness cancels the call), which is exactly the claim the
	 * control's hint makes. What the card must NOT grow is a per-job "stop the
	 * vendor" button: cancellation is best-effort once the vendor is mid-flight
	 * (`cancellation.vendor_stopped:false` in the frozen contract), so a control
	 * promising a guaranteed stop would lie about the sound, and a control whose
	 * hint had to hedge ("may stop") would be a question where a button belongs.
	 */
	return onInterruptTurn ? { onCancel: onInterruptTurn } : undefined;
}
