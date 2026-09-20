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

import { displayName } from "../components/trace/tool-row-model";
import type { TranscriptRecord } from "./transcript-reducer";

/**
 * A notice's body split into the line its row paints and the rest of it, if any.
 *
 * The two are returned together because the row and its disclosure must
 * PARTITION the text. `rest` is null exactly when the opening line is the whole
 * notice, and that is the case the row paints as a static line rather than as a
 * trigger that discloses a byte-identical copy of itself (round 2's
 * D7/Q5/R11/U14: a 404-character single-line notice painted all of itself and
 * then repeated it behind the chevron, so the affordance promised material it
 * did not add).
 *
 * It lives here rather than in the view for the reason this module exists: it is
 * a rule with a right answer, asserted directly (`scripts/tool-row.test.mjs`)
 * instead of eyeballed in a frame.
 */
export const splitFirstLine = (
	text: string,
): { headline: string; rest: string | null } => {
	const lines = text.split("\n");
	const at = lines.findIndex((line) => line.trim().length > 0);
	if (at < 0) return { headline: text.trim(), rest: null };
	const rest = lines
		.slice(at + 1)
		.join("\n")
		.trim();
	return { headline: lines[at].trim(), rest: rest || null };
};

/**
 * How much of the model's reasoning one row PAINTS, in the TUI's own units.
 *
 * Both numbers are the TUI's (`tui/widgets/transcript.py`: a 2,000-character
 * bounded tail, of which the last six rows are visible), and they are borrowed
 * rather than re-derived on purpose: the two surfaces answer the same question
 * with the same constraint — reasoning is one frame per token, measured up to
 * 19,355 fragments in a single turn, so a block that grew with the model's
 * thinking would be a block that reflows the answer for as long as the model
 * stays quiet.
 *
 * The CHARACTER cap is what makes the cost per flush O(1) in how long the model
 * has been thinking, and the ROW cap is what makes the paint height bounded —
 * neither implies the other, because a model that emits no newline would render
 * 2,000 characters as one twenty-line paragraph. The reducer holds the whole
 * channel (it appends fragments and nothing else), so this is a paint rule and
 * not a storage one: what the reader loses to it is a tail that was already off
 * the top of the window, and `elided` is how the row says so.
 */
export const REASONING_TAIL_CHARS = 2_000;
export const REASONING_VISIBLE_ROWS = 6;

/**
 * The two cuts `reasoningTail` makes, hoisted because it runs per flush.
 *
 * Reasoning repaints on the animation frame (up to 60 times a second for the
 * length of a model call), and a regex literal inside that path allocates and
 * compiles on every call — which is the cost this module's "bounded tail"
 * exists to avoid. Top-level so neither can be skipped by a later edit.
 */
const FIRST_WHITESPACE = /\s/;
const LEADING_WHITESPACE = /^\s+/;

/**
 * The slice of a reasoning block a row paints, and whether anything was dropped.
 *
 * Split out of the view, and asserted directly (`scripts/tool-row.test.mjs`),
 * for the reason this module exists: which rows a reader sees is a rule with a
 * right answer, and the two failure modes of getting it wrong are both visible
 * ones — a block that paints from the FIRST fragment never moves, and a cut made
 * at an arbitrary character opens mid-word (`and so the arrival time is
 * 20:00` becoming `ime is 20:00`, which reads as a typo rather than as a cut).
 *
 * So the cut lands on a line boundary where the text offers one and on the next
 * whitespace where it does not, and `elided` is returned rather than inferred:
 * the mark is what tells the reader the block is a window and not the whole
 * thought, and inferring it from the length would be wrong for a block that ends
 * exactly at the cap.
 */
export function reasoningTail(reasoning: string): {
	text: string;
	elided: boolean;
} {
	const capped =
		reasoning.length > REASONING_TAIL_CHARS
			? reasoning.slice(-REASONING_TAIL_CHARS)
			: reasoning;
	const dropped = capped.length !== reasoning.length;
	/*
	 * The character cut is the aggressive one, so it is the one that has to be
	 * repaired: start at the next grep-able boundary — the first whitespace —
	 * because a half word is the artifact this function exists to avoid. A tail
	 * with no whitespace at all is one unbroken run and is left whole.
	 */
	let text = capped;
	if (dropped) {
		const boundary = capped.search(FIRST_WHITESPACE);
		if (boundary >= 0) text = capped.slice(boundary + 1);
	}
	const lines = text.split("\n");
	const rows = lines.slice(-REASONING_VISIBLE_ROWS);
	const elided = dropped || rows.length !== lines.length;
	return {
		// Leading blank lines are dropped with the head they belonged to: a tail
		// whose first painted line is empty spends a line of the window on
		// nothing, and mid-stream the model's own paragraph breaks land there.
		text: rows.join("\n").replace(LEADING_WHITESPACE, ""),
		elided,
	};
}

export type Row = {
	record: TranscriptRecord;
	showAvatar: boolean;
	/** Vertical tier before this row. */
	gap: "turn" | "item" | "trace" | "mark" | "first";
	/**
	 * Is this row the answer its turn was working towards? See
	 * `closingAnswerIds` for what qualifies and why the caption is gated on it
	 * rather than on `!record.streaming` alone.
	 */
	closesTurn: boolean;
};

/**
 * The one row per turn that carries the answer caption.
 *
 * The caption used to be gated on `!record.streaming` alone, which is a fact
 * about a RECORD and not about a turn — so a turn that narrates between calls
 * ("Checking the ledger first.", a call, "Four were late.", a call, "Writing
 * the summary.") painted one clock per paragraph, four identical stamps in a
 * single turn, the worst shape being two clocks 56px apart with one sentence
 * between them (round 1's D1/Q-2, measured on the frames). The operator's
 * wording is narrower than that and is the rule here: "just the final
 * responses, not the in-progress tool intent/response".
 *
 * So the caption belongs to the row the reader is being HANDED, and there are
 * two conditions for it, both about the turn rather than the record:
 *
 * 1. the row is the turn's LAST row that paints anything the turn itself did — a
 *    turn that ends on a ledger row has not handed the reader its answer yet, and
 *    a turn ending on prose that is still streaming has not either, so neither is
 *    captioned. A STATEMENT row at the end is not the turn's work at all, so the
 *    answer before it still closes the turn and keeps its caption
 *    (`isStatementRow`, design round 2's D2-1);
 * 2. that row is a settled assistant record with TEXT in it — prose, which is
 *    `paintsSomething` plus the liveness bit plus the ANSWER bit. An unfinished
 *    answer closes a turn without being an answer, and so does a row whose only
 *    content is the model's reasoning: `paintsSomething` counts a reasoning block
 *    as content (an interrupted call keeps the thinking it was stopped during),
 *    but that block is not the answer this caption stamps, so the text test is
 *    stated here rather than inherited from the paint predicate.
 *
 * A turn is the records between two user records. The user turn itself is never
 * a candidate: its bubble carries the caption on the other rail.
 *
 * It lives here rather than in the view for the reason this module exists — it
 * is a rule with a right answer, asserted directly
 * (`scripts/turn-timestamp.test.mjs`) instead of eyeballed in a frame.
 */
export function closingAnswerIds(
	records: TranscriptRecord[],
): ReadonlySet<string> {
	const closing = new Set<string>();
	/** The last record in the still-open turn that paints and is not a statement. */
	let last: TranscriptRecord | null = null;
	for (const record of records) {
		if (record.kind === "user") {
			if (
				last !== null &&
				last.kind === "assistant" &&
				!last.streaming &&
				last.text
			) {
				closing.add(last.id);
			}
			last = null;
			continue;
		}
		if (paintsSomething(record) && !isStatementRow(record)) last = record;
	}
	if (
		last !== null &&
		last.kind === "assistant" &&
		!last.streaming &&
		last.text
	) {
		closing.add(last.id);
	}
	return closing;
}

/**
 * Is this row a STATEMENT rather than a row of the turn's own work?
 *
 * These are the rows that report something ABOUT the conversation — a session
 * incident, a model switch, a peer message's receipt, a wake delivery — and the
 * closing answer is found past them rather than through them (design round 2,
 * D2-1). The distinction matters because of the three ways a turn can end:
 *
 * - on a LEDGER row the agent is still working, and stripping the caption is
 *   right: the answer it will end on has not been written yet;
 * - on a STREAMING answer the answer has not settled, and stripping it is right
 *   for the same reason;
 * - on a STATEMENT the answer HAS been handed over, and the statement is not a
 *   reason to take its time away — worse, the time becomes unrecoverable, because
 *   a notice and a receipt paint no `<time>` of their own and have no disclosure
 *   to open. Measured on the frames: `[user][answer][notice]` painted nothing at
 *   all on screen.
 *
 * `tool` is deliberately NOT in this set, for the first reason above. `compaction` IS: a compaction
 * receipt renders exactly like a notice - receipt line, no `<time>`, no disclosure to open - so
 * `[user][answer][compaction]` had the same unrecoverable loss (design round 3, D3-1, measured by the
 * designer: 0 captions before, 1 after, at left 102, with the four controls unchanged).
 */
export function isStatementRow(record: TranscriptRecord): boolean {
	return (
		record.kind === "notice" ||
		record.kind === "compaction" ||
		record.kind === "custom" ||
		record.kind === "peer" ||
		record.kind === "wake"
	);
}

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
 * the port of it: its `thinking` → `composing N calls` → `waiting to run N
 * calls` → `running` → `responding` ladder already covers every state this row
 * could have described, including composing tool calls, which paint as
 * `composing · N B` on their own tool rows, a call whose dictation has finished
 * and which nothing has started (`queued · N B`), and a call the harness will
 * never run (`never sent · N composed`) — by the harness's own verdict, or
 * because the turn ended while the call was still being dictated or waiting to
 * run, which the TUI settles with the same record. So liveness has ONE channel,
 * and a record with nothing in it paints nothing.
 *
 * ### The safety net that went with it, and why it is not needed
 *
 * The old `|| record.streaming` branch also covered a DESYNC: if a record said
 * it was streaming while the working line was suppressed, the "Writing" row was
 * the only thing left moving. The two are not derived from the same thing by
 * accident — the working line's visibility keys on the SESSION-level
 * `frontend.streaming` flag (`chat-page.tsx` reads
 * `canonical.frontend?.streaming` into `busy`, which arrives here as `waiting`
 * via `chat-content.tsx`), not on
 * any record in the list, so it is live for the whole provider call regardless
 * of what the record list currently holds — and `agent_end` settles the record
 * and that flag together. What USED to be offered as the second half of that
 * argument no longer holds, and is restated here rather than left standing
 * (code review round 1, R1-4): the claim was that `dropLiveRecords` cleared live
 * records on every gap, so nothing could leave one true and the other false.
 * A gap now KEEPS its streaming rows and marks them uncertain
 * (`markLiveRecordsTruncated`), so "a row says it is streaming while the
 * session-level flag says it is not" IS reachable by the normal event path: the
 * gap drops `frontend` to `null` — which is what the pane's reconnecting state
 * reads — while the row it was writing stays on screen, and it is the intended
 * state rather than a desync (the row keeps the text this viewer received; the
 * pane stops claiming a session state it cannot prove). The row is therefore NOT
 * painted from a per-record liveness rule: it is a real row with real text, and
 * the working line is suppressed independently of it. If a future change derives
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
	/*
	 * Reasoning paints, and it is the one addition to the rule that is not a
	 * counterexample to the section above it.
	 *
	 * What that section removed was a row that said "Writing" — a second liveness
	 * label for a fact the working line was already stating, in the answer's own
	 * register. Reasoning is not a label about the work: it is the model's own
	 * words, arriving one fragment at a time, and while it is arriving there is
	 * nothing else on screen at all. It is the one thing this row can paint before
	 * it has an answer.
	 *
	 * The consequence is deliberate and is why the paint is bounded: a call whose
	 * reasoning is the only content it has left (an interrupted turn) is a row, so
	 * a reader who stops a long-thinking turn keeps the thinking instead of
	 * watching it vanish. On a settled row with neither prose nor reasoning — the
	 * tool-only assistant row the invisible-row trap is about — this is still
	 * false, and the row still paints nothing.
	 */
	return Boolean(record.text || record.reasoning);
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
		record.kind === "custom" ||
		// A peer message and a wake delivery are receipts on the same ledger as
		// the calls around them (the TUI draws both as ledger rows —
		// `PeerMessageBlock` and `WakeBlock` in `tui/widgets/transcript.py`), so
		// they take the ledger's gap tier rather than prose's air. A note that
		// arrived mid-run belongs to the run.
		record.kind === "peer" ||
		record.kind === "wake"
	);
}

/**
 * The name this record paints in the ledger's shared name column, or `""` for a
 * record that has no ledger row at all.
 *
 * The column is sized to the longest name ON SCREEN, so a `peer` or `wake` row
 * that kept its name out of that set would break the column for every row around
 * it. Its own name is its kind — the record carries no `toolName`, because these
 * are not tool calls and a field that only ever repeats the kind would be a
 * second way of saying one thing.
 */
export function ledgerName(record: TranscriptRecord): string {
	if (record.kind === "tool") return displayName(record.toolName);
	if (record.kind === "peer" || record.kind === "wake") {
		return displayName(record.kind);
	}
	return "";
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
	const closingAnswers = closingAnswerIds(records);
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
		/*
		 * A row whose caption says its own text is not the whole answer takes a
		 * between-components gap above it (design round 1, D1). The caption renders
		 * INSIDE the row it describes, and at `item`/`trace` the space between the
		 * row above and the caption is what the eye measures first: 8px (or 2px, after
		 * a tool row) against the caption's own 4px to its chunk, which leaves the
		 * line reading as a note on the paragraph above — a complete answer under it.
		 * `turn` already clears the floor (24px, 16px small) and `first` has no row
		 * above it at all, so neither is touched: the tier is raised, never lowered.
		 */
		const marked =
			record.kind === "assistant" && record.truncated !== undefined;
		if (marked && (gap === "item" || gap === "trace")) gap = "mark";
		const closesTurn = closingAnswers.has(record.id);
		const prior = reusable.get(record.id);
		rows.push(
			prior &&
				prior.record === record &&
				prior.showAvatar === showAvatar &&
				prior.gap === gap &&
				prior.closesTurn === closesTurn
				? prior
				: { record, showAvatar, gap, closesTurn },
		);
		previous = record;
	}
	return rows;
}

/**
 * The vertical ladder, `[comfortable, small view]`.
 *
 * Five tiers, and the DISTANCE BETWEEN TIERS is the information: a reader tells
 * "still the same run" from "a new turn started" by the size of the gap alone,
 * because nothing else on the surface marks a boundary (§ 2: remove a border
 * before you tighten the spacing — there are no borders left here to remove).
 *
 * - `trace` is a 2px HAIRLINE. Adjacent ledger rows read as one block the eye
 *   runs down rather than as a list of separated items — the operator's "much
 *   too wide" and the TUI reference's ~20.4px per line — but they are not
 *   fused: at zero the run was one unbroken column in which a reader looking
 *   for where one call ended and the next began had only the text to go on.
 *   Two pixels is the smallest step that reinstates that boundary, and it is
 *   deliberately NOT four: the designer rendered the same run at both, and at
 *   4px the rows float as separate items again, which is the spacing this
 *   whole tier was tightened away from. So a run of N rows measures
 *   `N × 20px + (N-1) × 2px` — the tool row's dense trigger is 20px — and
 *   uniformity is still structural rather than lucky, because every adjacent
 *   like pair gets the same tier and therefore the same distance.
 * - `item` separates the two REGISTERS (prose and ledger) inside one agent
 *   turn. Small, but four times the hairline: proportional prose sitting flush
 *   on a monospace row reads as one wrapped paragraph.
 * - `turn` is deliberately left wide. Tightening a run is only correct if the
 *   turn boundary survives it, and the contrast is what carries the hierarchy —
 *   24px against 2px inside a run in the comfortable view, where it used to be
 *   24px against 4px. In the SMALL view that contrast is 16px against the same
 *   2px (`turn` is `mt-4` there), which is a smaller ratio but still an order of
 *   magnitude, and it is the narrower column's own doing rather than this tier's.
 * - `mark` attaches a truncated row's own caption TO that row rather than to the
 *   paragraph above it (design round 1, D1). Without it the caption's only
 *   separation from the row above was the 8px `item` gap while its own margin to
 *   the chunk is 4px — a 2:1 ratio between two values that both sit inside a
 *   component's tier, so neither side read as a boundary and the line parsed as a
 *   note on the paragraph above it, which is a COMPLETE answer under it. It takes
 *   the ramp's between-components step, 12px, against the caption's 4px: 3:1, and
 *   a boundary larger than anything inside a paragraph (the prose's own line
 *   pitch is 24px, so the ratio is what has to carry it, not the absolute value).
 *   It is the FIRST tier pinned across both views — 12px is the smallest honest
 *   value and the small view's own `item` is 6px, so shrinking it would put the
 *   caption back below its own floor.
 *
 * The hairline does NOT shrink in the small view, unlike every other tier — it
 * is the only TIER whose two values are equal in the table below (`first` also
 * carries two identical entries, but its pair is empty: it is the absence of a
 * margin, not a width held across both views). The tiers above
 * shrink because they are made of several pixels to spend; 2px is already the
 * floor at which a gap is still a gap, and 1px on a hairline reads as an
 * antialiasing artifact rather than as a boundary. Note that this is therefore
 * not photographable: with one value in both views no frame can distinguish
 * them, and the property is pinned by the test over `GAP.trace`'s two indices
 * instead (`scripts/tool-row.test.mjs`).
 */
export const GAP: Record<Row["gap"], [string, string]> = {
	first: ["", ""],
	turn: ["mt-6", "mt-4"],
	item: ["mt-2", "mt-1.5"],
	// 2px on the 4px ramp, the same step `TraceGroup` composes its lines with.
	trace: ["mt-0.5", "mt-0.5"],
	// 12px, the ramp's between-components step, in both views: see `mark` above.
	mark: ["mt-3", "mt-3"],
};
