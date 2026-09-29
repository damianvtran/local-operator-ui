/**
 * The checkpoint rail's pure half: the tick placement arithmetic and the
 * fallback text rules.
 *
 * Extracted from the rail component so the decision can be exercised directly
 * (`scripts/checkpoint-model.test.mjs` bundles this module), for the reason
 * `working-line-model.ts` gives one directory over: a rule that is only
 * eyeballed in a story is a rule that drifts silently when the surface around
 * it changes.
 *
 * The WIRE DTOs live in `src/shared/desktop-contract.ts` beside the op that
 * answers with them (`sessions.checkpoints`); this module imports them rather
 * than holding a second definition that could drift from the schema. What it
 * adds is the two things a wire shape cannot carry: the placement arithmetic
 * and the copy rules. One unit note survives the move because this file is
 * where it is spent: `ts` is the JOURNAL's own epoch SECONDS (the same unit
 * every durable transcript entry carries), converted once in
 * `checkpointClockLabel` the way `transcript-reducer.ts` converts a durable
 * `entry.ts`. Nothing else in this module reads a clock.
 */

import type {
	Checkpoint,
	CheckpointManifest,
	CheckpointNamingState,
	CheckpointOutcome,
} from "../../../../../shared/desktop-contract";

/** The card's line while a completion's name is still being generated. */
export const CHECKPOINT_GENERATING_NAME = "Generating name…";

/**
 * One mark's visual state, as the rail derives it (dsh ladder, 2026-09-29).
 *
 * `rest` and `preview` are the pointer/focus ladder (dsh: scaleX 0.6 -> 0.9);
 * `active` is the turn the reader is ON (scaleX 1, primary ink); `unloaded` is
 * a checkpoint whose turn is not in the resident window yet (scaleX 0.4 at 60%
 * opacity) - the state that tells a reader a jump will have to load first.
 */
export type CheckpointMarkState = "rest" | "preview" | "active" | "unloaded";

/**
 * The mark's class per state, as ONE table so the ladder has one home.
 *
 * `bg-ink-dim` appears on the rest and unloaded rows on purpose: it is the
 * role the contrast contract floors on canvas (`checkpoint rail tick`), so a
 * repaint that would erase the affordance fails a gate rather than shipping.
 * The transforms are the dsh ladder; the `duration-fast` token's transition
 * (120 ms - the rendered value, D3) and the
 * reduce-motion off-switch live on the caller (`motion-reduce:transition-none`
 * plus the media query in `styles/index.css`) rather than here, because this
 * module is deliberately DOM-free.
 */
export const CHECKPOINT_MARK_CLASS: Record<CheckpointMarkState, string> = {
	rest: "scale-x-60 bg-ink-dim",
	preview: "scale-x-90 bg-ink-muted",
	active: "scale-x-100 bg-ink",
	/*
	 * 75% is the measured floor: the composite is ink-dim over canvas, and at
	 * 60% the light themes fell to 2.42:1 (rosePineDawn) / 2.46:1
	 * (localOperatorLight) - under the 3:1 non-text floor. At 75% every theme
	 * in themes.generated.css clears it (rosePineDawn 3.17:1, worst case), so
	 * the "not loaded" arm stays quiet without going under.
	 */
	unloaded: "scale-x-40 bg-ink-dim opacity-75",
};

/**
 * One mark's state, given the three ids the rail holds.
 *
 * Precedence is active > preview > unloaded > rest: the reading position wins
 * over a passing pointer (a hovered mark beside the active turn must not take
 * the primacy the reader's eye is parked on), and a previewed mark whose turn
 * is not resident still previews - the pointer is asking a question the mark
 * can answer with its shape while the fill stays the quiet one. `loaded`
 * defaults to true so a caller that has no resident window (the stories, this
 * slice's first cut before the loader lands) renders the pre-loader ladder.
 */
export function checkpointMarkState(options: {
	id: string;
	previewId: string | null;
	activeId: string | null;
	loaded?: boolean;
}): CheckpointMarkState {
	if (options.id === options.activeId) return "active";
	if (options.id === options.previewId) return "preview";
	if (options.loaded === false) return "unloaded";
	return "rest";
}

/**
 * One tick's place on the rail, as a fraction of the track's height.
 *
 * SEQ-PROPORTIONAL, not ordinal-uniform (D5): `(seq - min) / (max - min)` so
 * the rail shows progress through the CONVERSATION — unloaded rows included —
 * rather than restating the spacing of the loaded window. A conversation's
 * journal ordinals grow monotonically, so the fraction is in [0, 1] by
 * construction and needs no clamp.
 */
/**
 * The completion checkpoint's fallback title: its name, or `Turn N`.
 *
 * `Turn N` is the FALLBACK rather than a placeholder to be replaced later
 * because it is true: the turn ordinal is structural, the backend assigned it,
 * and the reader can match it against the transcript's own turn numbering.
 * While naming is pending the card shows exactly this text plus the
 * "Generating name…" line (D5), so the jump is never blocked on a model call.
 */
export function checkpointTitle(checkpoint: Checkpoint): string {
	const name =
		checkpoint.naming?.state === "ready" ? checkpoint.naming.name?.trim() : "";
	return name || `Turn ${checkpoint.turn}`;
}

/** Whether the card should say a name is still being generated. */
export function checkpointNamingPending(checkpoint: Checkpoint): boolean {
	return (
		checkpoint.kind === "completion" && checkpoint.naming?.state === "pending"
	);
}

/** The summary sentence, when a ready name carries one. */
export function checkpointSummary(checkpoint: Checkpoint): string | null {
	const summary =
		checkpoint.naming?.state === "ready" ? checkpoint.naming.summary : null;
	return summary?.trim() ? summary : null;
}

/** The highest turn ordinal in the manifest, for "Turn N of M". */
export function checkpointTurnCount(
	checkpoints: readonly Checkpoint[],
): number {
	let turns = 0;
	for (const checkpoint of checkpoints) {
		if (checkpoint.turn > turns) turns = checkpoint.turn;
	}
	return turns;
}

/**
 * The visible word for each outcome, sentence case.
 *
 * The card pairs the icon with this word rather than drawing the icon alone:
 * the shape is the first channel and the word is the second, so a reader who
 * cannot separate the glyphs (or a theme whose `-wash` grounds flatten them)
 * still gets the state as text. "Open" is the backend's own word for a tail
 * turn nothing has resolved — deliberately not "in progress", which would be
 * a liveness claim the manifest cannot make about an abandoned turn.
 */
export const CHECKPOINT_OUTCOME_LABELS: Record<CheckpointOutcome, string> = {
	complete: "Complete",
	error: "Error",
	interrupted: "Interrupted",
	open: "Open",
};

/**
 * The clock a user checkpoint's label carries, e.g. "3:42 PM".
 *
 * `ts` is epoch seconds (see the header) and the conversion to milliseconds
 * happens exactly here. 12-hour with an AM/PM marker by request — the same
 * `h:mm a` shape `formatMessageDateTime` uses for a message seen today, so
 * the rail and the transcript do not disagree about what a time looks like.
 * A malformed or zero `ts` yields `""` rather than "12:00 AM", so a label
 * built from it simply omits the time half instead of lying about it.
 */
export function checkpointClockLabel(ts: number): string {
	if (!Number.isFinite(ts) || ts <= 0) return "";
	const date = new Date(ts * 1000);
	if (Number.isNaN(date.getTime())) return "";
	const hours = date.getHours();
	const minutes = date.getMinutes().toString().padStart(2, "0");
	const hour12 = hours % 12 === 0 ? 12 : hours % 12;
	const meridiem = hours < 12 ? "AM" : "PM";
	return `${hour12}:${minutes} ${meridiem}`;
}

/**
 * A tick's accessible name (D5's two frozen forms).
 *
 * The completion form carries the SAME title the card shows, fallback
 * included, so a keyboard reader who never sees the card still hears which
 * turn they are on. A user form with no clock drops the time half rather
 * than printing a phantom one.
 */
export function checkpointAriaLabel(checkpoint: Checkpoint): string {
	if (checkpoint.kind === "user") {
		const clock = checkpointClockLabel(checkpoint.ts);
		return clock ? `Jump to your message, ${clock}` : "Jump to your message";
	}
	return `Jump to completion: ${checkpointTitle(checkpoint)}`;
}

/**
 * The naming state the manifest currently shows for one REQUESTED id.
 *
 * `warm` echoes the ids the caller sent, and the caller's ids are checkpoint
 * ids — but the naming lives on the COMPLETION checkpoint of the turn, so a
 * user id hovers a tick whose answer is filed under its turn's closing
 * checkpoint. That mapping is why this is a lookup rather than a property
 * read: a hover on "your message" still has to resolve to the completion it
 * started.
 *
 * `null` means the manifest cannot speak for this id — it was not found, or
 * its turn has no completion yet (nothing will be named). Callers treat that
 * as "not pending", because the poll's only question is whether anything is
 * still owed.
 */
export function checkpointNamingStateFor(
	manifest: CheckpointManifest,
	id: string,
): CheckpointNamingState | null {
	const checkpoint = manifest.checkpoints.find((entry) => entry.id === id);
	if (!checkpoint) return null;
	if (checkpoint.kind === "completion") {
		return checkpoint.naming?.state ?? null;
	}
	const completion = manifest.checkpoints.find(
		(entry) => entry.kind === "completion" && entry.turn === checkpoint.turn,
	);
	return completion?.naming?.state ?? null;
}

/**
 * Which of the requested ids the manifest still shows as pending.
 *
 * This is the poll's whole stop condition (D2: poll while any requested id is
 * pending): the hook holds the set, hands it here after every fresh manifest,
 * and stops when the answer is empty. An id the manifest cannot resolve is
 * dropped for the same reason it is not "pending" above — the poll may not
 * wait forever on something nothing will ever answer.
 */
export function checkpointPendingIds(
	manifest: CheckpointManifest,
	ids: Iterable<string>,
): string[] {
	const stillPending: string[] = [];
	for (const id of ids) {
		if (checkpointNamingStateFor(manifest, id) === "pending") {
			stillPending.push(id);
		}
	}
	return stillPending;
}
