/**
 * The checkpoint rail's pure half: the wire manifest's shape, the tick
 * placement arithmetic, and the fallback text rules.
 *
 * Extracted from the rail component so the decision can be exercised directly
 * (`scripts/checkpoint-model.test.mjs` bundles this module), for the reason
 * `working-line-model.ts` gives one directory over: a rule that is only
 * eyeballed in a story is a rule that drifts silently when the surface around
 * it changes.
 *
 * THE WIRE SHAPE IS FROZEN (design D9, `sessions.checkpoints`); this module
 * mirrors it rather than re-deriving it, and every field's unit is stated here
 * because the manifest mixes two of them: `ts` is the JOURNAL's own epoch
 * SECONDS (the same unit every durable transcript entry carries, converted
 * once in `checkpointClockLabel` the way `transcript-reducer.ts` converts
 * `entry.ts`), while `built_at` is a cache file's `st_mtime` in the same
 * seconds. Nothing else in this module reads a clock.
 *
 * The manifest deliberately omits fields rather than nulling them, and the
 * types keep that: `outcome` is absent on checkpoints no attention marker
 * resolved (S3's finding 3 - markers only exist from partway through a
 * session's life, so pre-mechanism turns have no outcome to show), and
 * `naming` is present only on COMPLETION checkpoints, because a name is
 * attached to a finished turn. A type that made either required would force
 * the renderer to invent a value the wire never claimed.
 */

/** What a checkpoint marks: the reader's own message, or a finished turn. */
export type CheckpointKind = "user" | "completion";

/**
 * A settled turn's ending, when the journal can prove one.
 *
 * `open` is the live tail: no marker resolves it and no newer settled run
 * followed it (S3 addendum note 2), so the rail draws an in-progress dot
 * rather than staying silent about the turn the reader is sitting in.
 */
export type CheckpointOutcome = "complete" | "error" | "interrupted" | "open";

/**
 * How far a completion checkpoint's naming has got.
 *
 * `unavailable` is a FAILED call inside its cooldown (`checkpoint_naming.py`
 * persists the marker), not a pending one: the card shows the fallback text
 * with no "Generating…" line, because nothing is generating.
 */
export type CheckpointNamingState = "ready" | "pending" | "unavailable";

export type CheckpointNaming = {
	state: CheckpointNamingState;
	/** The model's name, or `null` while pending/unavailable. */
	name: string | null;
	/** One sentence, or `null`; `""` is a ready name that carries no summary. */
	summary: string | null;
};

export type Checkpoint = {
	/** The journal entry id — the jump target (D1) and the warm's handle. */
	id: string;
	kind: CheckpointKind;
	/** 1-based turn ordinal, assigned structurally by the backend. */
	turn: number;
	/** Epoch SECONDS (journal unit); see this file's header. */
	ts: number;
	/** The journal ordinal the tick's position is proportional to. */
	seq: number;
	/** User text, or the turn's closing answer text (flattened, capped). */
	text: string;
	/** Absent when no marker resolved the turn (see the header). */
	outcome?: CheckpointOutcome;
	/** Present on completion checkpoints only. */
	naming?: CheckpointNaming;
};

/**
 * The index's own state, as the manifest reports it.
 *
 * `building` and `stale` both mean "a scan is in flight over a previous
 * answer" — the rail renders whatever checkpoints arrived and pulses its top
 * mark, rather than hiding. `unsupported` is a REMOTE conversation, whose
 * journal is not on this machine (the backend answers it in place of an
 * error, because it is a fact about where the bytes are); the rail hides,
 * which is the same honest degradation as an empty manifest.
 */
export type CheckpointIndexState =
	| "ready"
	| "building"
	| "stale"
	| "error"
	| "unsupported";

export type CheckpointManifest = {
	session_id: string;
	index: {
		state: CheckpointIndexState;
		/** The cache file's mtime, epoch seconds; absent on a cold answer. */
		built_at?: number;
	};
	checkpoints: Checkpoint[];
};

/**
 * The warm op's answer: ids this call took ownership of, and the subset still
 * waiting on a name. An id already named (same digest) or inside its failure
 * cooldown is accepted but not pending — the rail's poll has nothing left to
 * wait for on it.
 */
export type CheckpointWarmAnswer = {
	accepted: string[];
	pending: string[];
};

/** The ids schema's bound and the default selection size (D9/D2). */
export const CHECKPOINT_WARM_MAX_IDS = 16;
export const CHECKPOINT_WARM_DEFAULT_LIMIT = 8;

/** The card's line while a completion's name is still being generated. */
export const CHECKPOINT_GENERATING_NAME = "Generating name…";

/**
 * One tick's place on the rail, as a fraction of the track's height.
 *
 * SEQ-PROPORTIONAL, not ordinal-uniform (D5): `(seq - min) / (max - min)` so
 * the rail shows progress through the CONVERSATION — unloaded rows included —
 * rather than restating the spacing of the loaded window. A conversation's
 * journal ordinals grow monotonically, so the fraction is in [0, 1] by
 * construction and needs no clamp.
 */
export type CheckpointTickPlacement = {
	id: string;
	/** 0 = track top, 1 = track bottom. */
	fraction: number;
};

/**
 * Place every checkpoint on the rail.
 *
 * The degenerate case is ONE distinct seq (a single checkpoint, or a manifest
 * whose checkpoints all carry the same ordinal): the ratio is 0/0, and the
 * honest reading of "one mark" is the middle of the rail, not the top edge —
 * which is also where a tick would sit half-clipped. `0.5` is therefore the
 * rule, not a guard.
 */
export function checkpointTickPlacement(
	checkpoints: readonly Checkpoint[],
): CheckpointTickPlacement[] {
	if (checkpoints.length === 0) return [];
	let minSeq = Number.POSITIVE_INFINITY;
	let maxSeq = Number.NEGATIVE_INFINITY;
	for (const checkpoint of checkpoints) {
		if (checkpoint.seq < minSeq) minSeq = checkpoint.seq;
		if (checkpoint.seq > maxSeq) maxSeq = checkpoint.seq;
	}
	const span = maxSeq - minSeq;
	return checkpoints.map((checkpoint) => ({
		id: checkpoint.id,
		fraction: span > 0 ? (checkpoint.seq - minSeq) / span : 0.5,
	}));
}

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
		checkpoint.kind === "completion" &&
		checkpoint.naming?.state === "pending"
	);
}

/** The summary sentence, when a ready name carries one. */
export function checkpointSummary(checkpoint: Checkpoint): string | null {
	const summary =
		checkpoint.naming?.state === "ready" ? checkpoint.naming.summary : null;
	return summary && summary.trim() ? summary : null;
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
		return clock
			? `Jump to your message, ${clock}`
			: "Jump to your message";
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
