/**
 * The transcript's vertical rhythm: which records become rows, and how much
 * air sits above each one.
 *
 * Split out of `canonical-transcript.tsx` for the same reason `tool-row-model`
 * is split out of `tool-row.tsx` — these are pure rules with a right answer, so
 * they are asserted directly (`scripts/tool-row.test.mjs`) rather than eyeballed
 * in a frame. The frames prove the pitch is uniform TODAY; these rules are what
 * keep it uniform.
 */

import type { TranscriptRecord } from "./transcript-reducer";

export type Row = {
	record: TranscriptRecord;
	showAvatar: boolean;
	/** Vertical tier before this row. */
	gap: "turn" | "item" | "trace" | "first";
};

/**
 * Does this record paint anything the reader can see?
 *
 * For an assistant record the answer is its TEXT, and nothing else. An empty
 * one paints nothing whether it is finished or still streaming. Both halves of
 * that are deliberate: the streaming case is the "Writing" row discussed below,
 * and the SETTLED case — a finished assistant record that never carried prose,
 * because its tool rows were the whole turn — is the invisible-row trap
 * immediately below. One predicate covers both because they are the same fact:
 * a record with nothing in it.
 *
 * THE INVISIBLE-ROW TRAP, because this is exactly the kind of thing that gets
 * reintroduced. The reducer deliberately KEEPS an assistant record that carried
 * only tool calls: it has no prose to show — its tool rows carry the turn — but
 * it still owns its backend id so a live echo of the same turn coalesces onto
 * it instead of duplicating it (see the reducer's durable branch, "An assistant
 * row that only carried tool calls has no prose to show… It still occupies its
 * id"). Deleting it there is not an option.
 *
 * So it must exist in the RECORD list and must never reach the ROW list. When
 * it did, it cost the transcript twice over: it minted a wrapper carrying a top
 * margin for a box of zero height, AND — because the gap tier is decided from
 * the PREVIOUS record — it broke the trace-adjacency chain, so the next tool
 * row fell back to the wider `item` tier. Measured on the shipped build: two
 * adjacent tool rows 48px apart where a tight pair was 28px, at exactly the
 * points where the model happened to emit a prose-free tool turn. That is the
 * "extra space randomly inserted which doesn't look very uniform" in the
 * operator's report — the gap had no visible cause because its cause was
 * invisible.
 *
 * ## Why `streaming` is NOT a reason to paint
 *
 * It used to be. A streaming record with no text yet is the gap between
 * `message_start` and the first token, and the transcript minted a row for it
 * that read "Writing" — which put a second liveness element directly above the
 * working line, where that line was already saying `thinking`. Two elements for
 * one fact, and the redundant one sat in the ANSWER's register rather than on
 * the ledger, so it read as the turn having started when nothing had been
 * written.
 *
 * The TUI has one aggregate liveness element and no per-record equivalent
 * (`WorkingBlock`, `tui/widgets/transcript.py`), and the working line here is
 * the port of it: its `thinking` → `composing N calls` → `running` →
 * `responding` ladder already covers every state this row could have described,
 * including composing tool calls, which paint as `composing · N B` on their own
 * tool rows. So liveness has ONE channel, and a record with nothing in it
 * paints nothing.
 *
 * ### The safety net that went with it, and why it is not needed
 *
 * The old `|| record.streaming` branch also covered a DESYNC: if a record said
 * it was streaming while the working line was suppressed, the "Writing" row was
 * the only thing left moving. That state is unreachable, and the reason is that
 * the two are not derived from the same thing by accident — the working line's
 * visibility keys on the SESSION-level `frontend.streaming` flag
 * (`chat-page.tsx` reads `canonical.frontend?.streaming` into `busy`, which
 * arrives here as `waiting` via `chat-content.tsx`), not on
 * any record in the list, so it is live for the whole provider call regardless
 * of what the record list currently holds. `agent_end` settles the record and
 * that flag together, and `dropLiveRecords` clears live records on a gap, so
 * there is no ordering in the normal event path that leaves one true and the
 * other false (UX review round 1, U2: the state had to be forced by hand and
 * could not be reached by walking the app). If a future change derives
 * `waiting` from the record list instead, this net has to come back with it.
 *
 * ### The 46.4px step at the first token, accepted deliberately
 *
 * Removing the row unmasked a real motion: before the first token the working
 * line is alone in the column, and at the first token the avatar and the first
 * line of prose appear ABOVE it, so the working line drops from top 96.4 to
 * 142.8 at 1024 — 46.4px in one frame (design review round 1, D5, measured
 * across the two consecutive states). This is accepted, not overlooked.
 *
 * It is legible rather than glitchy: what pushes the status line down is the
 * answer the reader is waiting for, and a status line yielding to content is an
 * event with a cause on screen. The alternative — showing the avatar before the
 * first token so the gutter is already occupied — removes only the horizontal
 * half of the step, adds an avatar that then has to move again when the prose
 * row mounts under it, and the version that removes the step entirely is the
 * avatar taking a real flex slot, which is the row restructure
 * `message-container.tsx` documents as deliberately deferred with a measured
 * collision. Paying that for 46.4px is the wrong trade; if the step is ever
 * reported, fix it there rather than by reinstating a row.
 *
 * Adjacency and spacing are therefore computed over what the reader can SEE,
 * never over what the record list contains. `AssistantRow` returns `null` on
 * this same predicate rather than on a copy of the condition, because two
 * copies of it are how the row comes back.
 */
export function paintsSomething(record: TranscriptRecord): boolean {
	if (record.kind !== "assistant") return true;
	return Boolean(record.text);
}

/**
 * Rows that share the machine-voice ledger tier, and so sit tight against each
 * other. Prose and user turns are a different register and take real air.
 */
export function isTraceLike(record: TranscriptRecord): boolean {
	return (
		record.kind === "tool" ||
		record.kind === "notice" ||
		record.kind === "compaction" ||
		record.kind === "custom"
	);
}

/**
 * Row wrappers are reused across builds when the record AND its layout facts
 * (avatar, gap) are unchanged. The reducer already hands back the same record
 * object for untouched rows; without this pass every commit would still mint
 * a fresh wrapper per row and defeat the memo on `TranscriptRow`, which is
 * exactly what the render counter showed (rows x commits, not 1 per delta).
 */
export function buildRows(
	records: TranscriptRecord[],
	previousRows: Row[],
): Row[] {
	const reusable = new Map(previousRows.map((row) => [row.record.id, row]));
	const rows: Row[] = [];
	// The last record that PAINTED, not the last record. An invisible record
	// never becomes `previous`, so it can neither contribute a margin of its own
	// nor downgrade the gap tier of the row after it.
	let previous: TranscriptRecord | null = null;
	for (const record of records) {
		if (!paintsSomething(record)) continue;
		const traceLike = isTraceLike(record);
		const previousTrace = previous !== null && isTraceLike(previous);
		const agentSide = record.kind !== "user";
		const previousAgent = previous !== null && previous.kind !== "user";
		const showAvatar = agentSide && !previousAgent;
		let gap: Row["gap"] = "item";
		if (!previous) gap = "first";
		else if (record.kind === "user" || previous.kind === "user") gap = "turn";
		else if (traceLike && previousTrace) gap = "trace";
		const prior = reusable.get(record.id);
		rows.push(
			prior &&
				prior.record === record &&
				prior.showAvatar === showAvatar &&
				prior.gap === gap
				? prior
				: { record, showAvatar, gap },
		);
		previous = record;
	}
	return rows;
}

/**
 * The vertical ladder, `[comfortable, small view]`.
 *
 * Four tiers, and the DISTANCE BETWEEN TIERS is the information: a reader tells
 * "still the same run" from "a new turn started" by the size of the gap alone,
 * because nothing else on the surface marks a boundary (§ 2: remove a border
 * before you tighten the spacing — there are no borders left here to remove).
 *
 * - `trace` is ZERO. Adjacent ledger rows butt against each other so a run
 *   reads as one block the eye runs down rather than as a list of separated
 *   items, which is the operator's "much too wide" and the TUI reference's
 *   ~20.4px per line. The row's own height IS the pitch: the tool row's dense
 *   trigger is 20px, so a run measures 20px per row with no gap arithmetic on
 *   top. Uniformity is then structural rather than lucky — every adjacent like
 *   pair is the same distance apart because that distance is zero.
 * - `item` separates the two REGISTERS (prose and ledger) inside one agent
 *   turn. Small, but non-zero: proportional prose sitting flush on a monospace
 *   row reads as one wrapped paragraph.
 * - `turn` is deliberately left wide. Tightening a run is only correct if the
 *   turn boundary survives it, and the contrast is what carries the hierarchy —
 *   24px against 0px inside a run, where it used to be 24px against 4px.
 */
export const GAP: Record<Row["gap"], [string, string]> = {
	first: ["", ""],
	turn: ["mt-6", "mt-4"],
	item: ["mt-2", "mt-1.5"],
	trace: ["", ""],
};
