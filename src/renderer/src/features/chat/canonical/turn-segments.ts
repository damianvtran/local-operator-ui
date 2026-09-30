/**
 * Which message is a turn's ANSWER, and how a run's hidden span partitions into
 * SEGMENTS around the rows that must stay on screen (issue #665; loader-continuity
 * PR 2).
 *
 * PURE, STRUCTURAL, AND IN ONE MODULE. Rows in, classification out: no React, no
 * DOM, no clock, and NO TEXT HEURISTICS. The classifier reads record KINDS and the
 * two facts the reducer already decided (`customType`, `level`/`complete`), because
 * the alternatives were measured and lose: `stop_reason` reads `"stop"` on every
 * durable stop-then-step pair (549 of 549 in the journals sampled), the completion
 * marker's anchor is absent for wake-triggered turns, and "does it read like an
 * answer" breaks on a three-word reply. The caption (`closingAnswerIds`), the
 * foot line, the bar's facts and the render walk all read THIS module's answer, so
 * they cannot disagree about which row the turn is handing over - the defect this
 * replaces was one wrong closure that was wrong in five places at once.
 *
 * WHAT WAS WRONG (the operator's own journal, kinds only). A turn is closed by the
 * LAST settled assistant row. In the journal behind the operator's screenshot the
 * agent answered (row 1196), the session was disposed, and a later peer note made
 * it write one more short reply (row 1229). The old rule elected 1229, so the
 * bar swallowed the real answer and the reader was handed a status snippet.
 *
 * THE MODEL, in the vocabulary the rest of this file uses:
 *
 * - a STEP row is a `tool` row: work the turn did;
 * - a TRIGGER row says why the agent is about to act: a `user` row, a `peer`
 *   message, a `wake` delivery, or a `custom` `job_result` / `hub_message` /
 *   `monitor_prompt`. Every other statement (`notice`, `compaction`, the other
 *   `custom` rows) is neither;
 * - a CLOSE row is a settled, text-bearing assistant row that is NOT followed by a
 *   step row before the next trigger or the run's end. Text followed by a step is
 *   narration ("Checking the ledger first."), and narration is not a close;
 * - a CYCLE is one agent response: the rows since the previous close, ending at
 *   this close. A run is a chain of cycles.
 *
 * Each cycle is a RESPONSE (the agent answering the reader, directly or by
 * finishing work it had started) or COMMENTARY (the agent reacting to something
 * ambient after the answer was already handed over). The turn's ANSWER is the
 * close of the LAST response cycle - not the last message emitted.
 */

import type { TranscriptRecord } from "./transcript-reducer";

export type TriggerKind =
	| "user"
	| "peer"
	| "wake"
	| "job_result"
	| "hub_message"
	| "monitor_prompt";

export type CycleClass = "response" | "commentary";

/**
 * Why a cycle has the class it has. Diagnostic (it names fixtures and failure
 * messages); `class` is what renders.
 */
export type CycleWhy = "user" | "continuation" | "post-terminal" | "head-cut";

export type TurnCycle = {
	/** Index (in the run's record list) of the cycle's first record. */
	start: number;
	/** Index of the cycle's close row: the message that ends this response. */
	closeIndex: number;
	class: CycleClass;
	why: CycleWhy;
	/** What set the cycle going, in order, as far as the journal shows it. */
	initiators: TriggerKind[];
};

/**
 * The custom row types that start a cycle of work the agent had already begun.
 * A job's result, a hub relay and a monitor's prompt are the agent finishing
 * something it owns, so the cycle they open INHERITS the previous cycle's class
 * rather than being ambient chatter.
 */
const CONTINUATION_CUSTOMS: ReadonlySet<string> = new Set([
	"job_result",
	"hub_message",
	"monitor_prompt",
]);

/** The trigger a record is, or null when it starts nothing. */
export function triggerOf(record: TranscriptRecord): TriggerKind | null {
	switch (record.kind) {
		case "user":
			return "user";
		case "peer":
			return "peer";
		case "wake":
			return "wake";
		case "custom":
			return CONTINUATION_CUSTOMS.has(record.customType)
				? (record.customType as TriggerKind)
				: null;
		default:
			return null;
	}
}

/**
 * The rows that are a BOUNDARY of a turn rather than a step of it, and which
 * kind - the ONE place the transcript decides it.
 *
 * WHY ONE FUNCTION. Four things used to keep their own list of "the rows that
 * mark where something ended": the collapse's pin list (what stays on screen),
 * the classifier's terminal test (what makes a later wake ambient), the run
 * partition's `sawMarker`, and the rows' own paint. They agreed by copy, which is
 * how a `closed` receipt could be pinned and yet not count as the end of a turn.
 * Now both consumers below are one-line reads of this, so a new marker (a
 * `retired` receipt was the last one added) joins every rule the day it joins
 * this switch.
 *
 * - `compaction` - the conversation's memory statement. It changes what the agent
 *   remembers but does not end anything, so it pins (stays where it happened)
 *   without making a later message ambient;
 * - `terminal` - the transcript's own "this turn is over": a completion `notice`
 *   (`Stopped with an error`, `Interrupted`, and the neutral `closed` / `retired`
 *   receipts, all of which carry `complete === true`) and an error-level `custom`
 *   (a `session_incident`, the reason a turn died). It is the operator's dispose,
 *   verbatim.
 */
export type BoundaryKind = "compaction" | "terminal";

export function boundaryKindOf(record: TranscriptRecord): BoundaryKind | null {
	switch (record.kind) {
		case "compaction":
			return "compaction";
		case "notice":
			return record.complete === true ? "terminal" : null;
		case "custom":
			return record.level === "error" ? "terminal" : null;
		default:
			return null;
	}
}

/** Does this boundary declare the turn over? See `boundaryKindOf`. */
export function isTerminalMarker(record: TranscriptRecord): boolean {
	return boundaryKindOf(record) === "terminal";
}

/**
 * A run's cycles, in order, each classified.
 *
 * `records` is ONE RUN's records (the caller owns the run partition). `paints`
 * is `paintsSomething`, injected rather than imported: `transcript-rows.ts`
 * imports this module for `closingAnswerIds`, and a second copy of the predicate
 * is how the invisible-row trap comes back.
 *
 * The decision table, one forward pass because the continuation rule depends on
 * the previous cycle:
 *
 * | what set the cycle going                                   | class          | why           |
 * |------------------------------------------------------------|----------------|---------------|
 * | a `user` row (the request, or a steer)                     | response       | user          |
 * | only job_result / hub_message / monitor_prompt             | previous cycle | continuation  |
 * | wake / peer, and a terminal marker lies since the last close | commentary     | post-terminal |
 * | wake / peer, no terminal marker                            | previous cycle | continuation  |
 * | nothing visible                                            | previous cycle | continuation  |
 * | no previous cycle exists                                   | response       | head-cut      |
 *
 * The "wake carried the answer" shape is real and common (1265 wake-triggered
 * cycles in the journals sampled ARE the turn's answer), so inheritance is the
 * default and `commentary` needs positive evidence: a terminal marker between
 * the previous close and the ambient trigger. That is a wake or a peer note
 * arriving AFTER the turn was declared over.
 */
export function cyclesOf(
	records: readonly TranscriptRecord[],
	paints: (record: TranscriptRecord) => boolean,
): TurnCycle[] {
	const n = records.length;
	const isClose: boolean[] = new Array(n).fill(false);
	/*
	 * Backward pass: an assistant row is a close when NO step row follows it
	 * before the next trigger. Walking from the end keeps it linear.
	 */
	let stepAhead = false;
	for (let i = n - 1; i >= 0; i -= 1) {
		const record = records[i];
		if (triggerOf(record) !== null) stepAhead = false;
		else if (record.kind === "tool") stepAhead = true;
		else if (
			record.kind === "assistant" &&
			!record.streaming &&
			paints(record) &&
			!stepAhead
		) {
			isClose[i] = true;
		}
	}

	const cycles: TurnCycle[] = [];
	let start = 0;
	let terminalSinceClose = false;
	for (let i = 0; i < n; i += 1) {
		const record = records[i];
		if (isTerminalMarker(record)) terminalSinceClose = true;
		if (!isClose[i]) continue;

		let firstStepIndex = -1;
		const initiators: TriggerKind[] = [];
		for (let j = start; j < i; j += 1) {
			const trigger = triggerOf(records[j]);
			if (firstStepIndex === -1 && records[j].kind === "tool") {
				firstStepIndex = j;
			}
			// Initiators are what preceded the work, except that a `user` row
			// anywhere in the cycle is a request (a steer arrives mid-work).
			if (trigger !== null && (firstStepIndex === -1 || trigger === "user")) {
				initiators.push(trigger);
			}
		}

		const previous = cycles.at(-1) ?? null;
		let cls: CycleClass;
		let why: CycleWhy;
		if (previous === null) {
			// The run's first cycle is a response whatever set it going: it is
			// either the user's own (the request opens the run) or the head of a
			// run whose opener is not loaded, which must still elect an answer.
			cls = "response";
			why = initiators.includes("user") ? "user" : "head-cut";
		} else if (initiators.includes("user")) {
			cls = "response";
			why = "user";
		} else if (
			initiators.some((kind) => kind === "wake" || kind === "peer") &&
			terminalSinceClose
		) {
			cls = "commentary";
			why = "post-terminal";
		} else {
			cls = previous.class;
			why = "continuation";
		}

		cycles.push({
			start,
			closeIndex: i,
			class: cls,
			why,
			initiators,
		});
		start = i + 1;
		terminalSinceClose = false;
	}
	return cycles;
}

/**
 * The predicates the classifier borrows from `transcript-rows.ts`, INJECTED.
 *
 * `transcript-rows.ts` imports this module (for `closingAnswerIds`), so importing
 * `paintsSomething` / `isStatementRow` back would be a cycle; and a second copy of
 * either predicate is how the invisible-row trap comes back. The caller passes the
 * one definition each.
 */
export type RowPredicates = {
	/** `paintsSomething`: a record with nothing to show is not a close. */
	paints: (record: TranscriptRecord) => boolean;
	/** `isStatementRow`: a record ABOUT the conversation, not the turn's own work. */
	isStatement: (record: TranscriptRecord) => boolean;
};

/**
 * The elected answer of a run: its LAST response cycle, or null when the run has
 * not handed anything over.
 *
 * NULL IS THE OLD RULE'S GATE, KEPT ON PURPOSE. A run whose last piece of work is
 * a tool row, or an answer that is still streaming, has not handed the reader its
 * answer yet - stripping the caption there is right (the answer it will end on has
 * not been written), and electing an earlier close would put the foot on a row the
 * next token is about to demote. So the run's last painting, non-statement record
 * must be a settled assistant; only then is there an answer to elect, and it is
 * the last RESPONSE cycle's close rather than that final row itself. Statements
 * after it (a receipt, a notice) do not count as work, exactly as
 * `isStatementRow` has always said.
 */
export function electAnswer(
	records: readonly TranscriptRecord[],
	cycles: readonly TurnCycle[],
	predicates: RowPredicates,
): TurnCycle | null {
	const lastClose =
		cycles.length > 0 ? cycles[cycles.length - 1].closeIndex : -1;
	let terminalAfterClose = false;
	for (let i = records.length - 1; i > lastClose; i -= 1) {
		if (isTerminalMarker(records[i])) terminalAfterClose = true;
	}
	for (let i = records.length - 1; i >= 0; i -= 1) {
		const record = records[i];
		// A user row is never the run's "last content" (a steer is not work the
		// turn did), and a record that paints nothing is invisible to the reader.
		if (record.kind === "user" || !predicates.paints(record)) continue;
		if (predicates.isStatement(record)) continue;
		/*
		 * The one refinement of the old gate: work that trails the last close AND
		 * is followed by a terminal marker is a follow-up that DIED (a wake's work
		 * cut by the disposal), not an answer still being written. The answer that
		 * was handed over before it is still the answer; refusing to elect it would
		 * hide the reader's answer behind a bar for the sake of a turn that is over.
		 */
		if (record.kind === "assistant" && !record.streaming) break;
		if (record.kind !== "assistant" && terminalAfterClose) break;
		return null;
	}
	for (let i = cycles.length - 1; i >= 0; i -= 1) {
		if (cycles[i].class === "response") return cycles[i];
	}
	return null;
}

/** A maximal contiguous span of hidden records, inclusive, in run indices. */
export type SegmentSpan = { from: number; to: number };

export type RunPartition = {
	cycles: TurnCycle[];
	answer: TurnCycle | null;
	/** Ordered, disjoint hidden spans (see the invariants in `violationsOf`). */
	segments: SegmentSpan[];
	/** Run indices that stay mounted while the run is collapsed. */
	visible: ReadonlySet<number>;
};

/**
 * Partition one run into the rows that stay and the SEGMENTS that hide.
 *
 * WHAT STAYS VISIBLE, in one sentence: every pinned row (compaction, a
 * completion marker, an error incident - `pinned`), the ANSWER row itself, and
 * the run's trailing statements (a receipt or notice after the last close, which
 * the reader is owed exactly as before). EVERYTHING ELSE in the span hides - the
 * turn's work, its narration, and every commentary cycle - and hides as
 * SEGMENTS: the maximal contiguous hidden spans between the visible rows.
 *
 * WHY SEGMENTS AND NOT ONE BAR. A pinned row between two hidden spans (40% of the
 * runs in the journals sampled) used to render AFTER a bar that stood where the
 * first hidden row was, and jumped when the bar opened. Each span is its own bar
 * in its own slot, so a pinned row can never be reordered by expanding anything.
 *
 * `from` is the first index the span may start at: just after the opening user
 * row, or 0 for a run whose head is cut off.
 */
export function partitionRun(
	records: readonly TranscriptRecord[],
	options: RowPredicates & {
		from: number;
		pinned: (record: TranscriptRecord) => boolean;
	},
): RunPartition {
	const cycles = cyclesOf(records, options.paints);
	const answer = electAnswer(records, cycles, options);
	const visible = new Set<number>();
	records.forEach((record, index) => {
		if (index >= options.from && options.pinned(record)) visible.add(index);
	});
	if (answer !== null) {
		visible.add(answer.closeIndex);
		/*
		 * The trailing statements: whatever follows the LAST close and does no work
		 * (no tool, no assistant text). The old rule kept everything from the
		 * answer onward, so `[user][answer][notice]` and a receipt after the
		 * answer stayed on screen; the walk stops at the first row that is work.
		 */
		const lastClose = cycles[cycles.length - 1].closeIndex;
		for (let i = records.length - 1; i > lastClose; i -= 1) {
			const record = records[i];
			if (!options.isStatement(record)) break;
			visible.add(i);
		}
	}

	const segments: SegmentSpan[] = [];
	let open: number | null = null;
	for (let i = options.from; i < records.length; i += 1) {
		if (visible.has(i)) {
			if (open !== null) segments.push({ from: open, to: i - 1 });
			open = null;
		} else if (open === null) {
			open = i;
		}
	}
	if (open !== null) segments.push({ from: open, to: records.length - 1 });
	return { cycles, answer, segments, visible };
}

/**
 * What a segment's bar says about itself ahead of its clauses, or null for the
 * ordinary work-before-the-answer bar (whose copy - `Took ...`, `N actions` - is
 * unchanged and needs no word).
 *
 * THE WORD COMES FROM THE CYCLE THE SEGMENT ENDS IN, not from any trigger row
 * that happens to lie inside it. A long user-opened turn is full of `job_result`
 * receipts between its steps; reading "the last trigger in the span" labelled that
 * whole bar `Job result`, which is not what it is. A cycle's INITIATORS are only
 * what preceded its first step, so a mid-work receipt cannot name the bar, and a
 * cycle the reader's own request opened is the ordinary bar.
 *
 * | cycle opened by      | before the answer | after the answer |
 * |----------------------|-------------------|------------------|
 * | user (or head-cut)   | none              | Followed up      |
 * | wake / monitor       | Woken             | Followed up      |
 * | peer / hub           | Noted             | Peer note        |
 * | job result           | Job result        | Job result       |
 *
 * A segment after the answer with no cycle of its own (work that never closed) is
 * still a follow-up: position alone says it happened after the hand-over.
 */
export function labelOfSegment(
	cycles: readonly TurnCycle[],
	span: SegmentSpan,
	answerCloseIndex: number | null,
): string | null {
	const after = answerCloseIndex !== null && span.from > answerCloseIndex;
	const cycle = cycles.find(
		(candidate) =>
			candidate.start <= span.to && span.to <= candidate.closeIndex,
	);
	const opener = cycle?.initiators.at(-1) ?? null;
	switch (opener) {
		case "wake":
		case "monitor_prompt":
			return after ? "Followed up" : "Woken";
		case "peer":
		case "hub_message":
			return after ? "Peer note" : "Noted";
		case "job_result":
			return "Job result";
		default:
			return after ? "Followed up" : null;
	}
}

/**
 * Is this segment a COMPLETED piece of follow-up work: entirely after the answer
 * and settled to its last row?
 *
 * The checkmark it earns is the disposal receipt the operator asked for, said
 * without a card: "that is over". A segment before the answer is never marked (the
 * answer below it is the statement that it finished), and a segment whose last row
 * is still streaming or still running is not over.
 */
export function segmentIsCompleted(
	records: readonly TranscriptRecord[],
	span: SegmentSpan,
	answerCloseIndex: number | null,
): boolean {
	if (answerCloseIndex === null || span.from <= answerCloseIndex) return false;
	const last = records[span.to];
	if (last.kind === "assistant") return !last.streaming;
	if (last.kind === "tool") return last.phase === "done";
	return true;
}

/**
 * Everything wrong with a partition, as sentences; empty means it is sound.
 *
 * AN INVARIANT THAT AN EMPTY PLAN CANNOT SATISFY. The check is a COVER, not a
 * bounds test: every index in the span must be accounted for exactly once,
 * either visible or inside one segment. A plan that hid nothing while a tool row
 * sat in the span would leave that index uncovered and fail here, so "no
 * segments" is only ever valid for a span that has nothing to hide - the property
 * a bare "every segment is inside the span" assertion lacks, since an empty list
 * satisfies it vacuously. Tests pair this with an independent expectation of how
 * many rows the fixture hides.
 */
export function violationsOf(
	records: readonly TranscriptRecord[],
	partition: RunPartition,
	options: { from: number; pinned: (record: TranscriptRecord) => boolean },
): string[] {
	const problems: string[] = [];
	const owner = new Map<number, number>();
	partition.segments.forEach((segment, s) => {
		if (segment.from > segment.to) problems.push(`segment ${s} is empty`);
		if (s > 0 && segment.from <= partition.segments[s - 1].to) {
			problems.push(`segment ${s} overlaps or precedes segment ${s - 1}`);
		}
		for (let i = segment.from; i <= segment.to; i += 1) {
			if (owner.has(i)) problems.push(`row ${i} is in two segments`);
			owner.set(i, s);
			if (partition.visible.has(i)) {
				problems.push(`row ${i} is both visible and hidden`);
			}
			if (options.pinned(records[i])) {
				problems.push(`row ${i} is pinned but sits in segment ${s}`);
			}
		}
	});
	for (let i = options.from; i < records.length; i += 1) {
		if (!partition.visible.has(i) && !owner.has(i)) {
			problems.push(`row ${i} is neither visible nor in a segment`);
		}
	}
	if (partition.answer !== null) {
		const at = partition.answer.closeIndex;
		if (owner.has(at)) problems.push("the answer row is hidden");
		if (partition.answer.class !== "response") {
			problems.push("the answer cycle is not a response");
		}
	}
	if (partition.cycles.length > 0 && partition.cycles[0].class !== "response") {
		problems.push("a run's first cycle must be a response");
	}
	return problems;
}
