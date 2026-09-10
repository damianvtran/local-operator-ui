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
 * Adjacency and spacing are therefore computed over what the reader can SEE,
 * never over what the record list contains. `AssistantRow` returns `null` on
 * this same predicate rather than on a copy of the condition, because two
 * copies of it are how the row comes back.
 */
export function paintsSomething(record: TranscriptRecord): boolean {
	if (record.kind !== "assistant") return true;
	return Boolean(record.text) || record.streaming;
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
