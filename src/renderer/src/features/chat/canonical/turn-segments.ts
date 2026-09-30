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

/**
 * A durable COMPLETION MARKER: the notice the transcript paints for a completion
 * attention record (`Stopped with an error`, `Interrupted`, and the neutral
 * `closed` / `retired` receipts). The run partition's "a marker closes this run"
 * test and the working line's "the turn stopped" test read this too, so the three
 * consumers of "a marker was seen" are one definition rather than three copies of
 * `kind === "notice" && complete === true`.
 */
export function isCompletionMarker(record: TranscriptRecord): boolean {
	return record.kind === "notice" && record.complete === true;
}

export function boundaryKindOf(record: TranscriptRecord): BoundaryKind | null {
	switch (record.kind) {
		case "compaction":
			return "compaction";
		case "notice":
			return isCompletionMarker(record) ? "terminal" : null;
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
 * ordinary bar (whose copy - `Took ...`, `N actions` - is unchanged and needs no
 * word).
 *
 * ONE WORD PER CONCEPT, IN THE APP'S OWN NOUNS (design review round 1 on #708,
 * D2/D3). The first cut split the same trigger by position (`Woken` before the
 * answer, `Followed up` after; `Noted` / `Peer note`) and mixed three grammatical
 * registers. Position is already visible - the bar is above or below the answer -
 * so the word names only WHAT OPENED the cycle, as the noun the rest of the app
 * uses: the TUI's own labels for these rows are `wake` and `peer`, and the receipt
 * row prints the sender rather than a sentence about it.
 *
 * THE WORD COMES FROM THE CYCLE THE SEGMENT ENDS IN, not from any trigger row
 * that happens to lie inside it. A long user-opened turn is full of `job_result`
 * receipts between its steps; reading "the last trigger in the span" labelled that
 * whole bar `Job result`, which is not what it is. A cycle's INITIATORS are only
 * what preceded its first step, so a mid-work receipt cannot name the bar.
 *
 * | what the bar hides                         | label          |
 * |--------------------------------------------|----------------|
 * | a user row of the reader's own (a steer)   | Steered        |
 * | a cycle opened by a wake / monitor prompt  | Wake           |
 * | a cycle opened by a peer / hub message     | Peer message   |
 * | a cycle opened by a job result             | Job result     |
 * | anything else (the reader's own request)   | none           |
 *
 * `Steered` COMES FIRST AND IS THE REASON THIS TAKES THE RECORDS (agent review
 * round 1 on #708, R1-2). A steer is an ordinary user row inside a run, and the
 * partition hides it with the work it steered (pinning it would split every
 * steered turn into two bars - more reshaping than the segments change should
 * carry). A reader's OWN message disappearing behind an unlabelled bar is the
 * failure, so the bar must say so, and the word outranks the others because it is
 * the one row in the span the reader wrote. A follow-up the reader opened with a
 * visible message needs no word: the message above the bar already says it.
 */
export function labelOfSegment(
	records: readonly TranscriptRecord[],
	cycles: readonly TurnCycle[],
	span: SegmentSpan,
): string | null {
	for (let i = span.from; i <= span.to; i += 1) {
		if (records[i].kind === "user") return "Steered";
	}
	const cycle = cycles.find(
		(candidate) =>
			candidate.start <= span.to && span.to <= candidate.closeIndex,
	);
	/*
	 * A CYCLE THAT NEVER CLOSED (a follow-up that died mid-work, or is still
	 * running) has no entry in `cycles` - a cycle is defined by its close - so its
	 * opener is read the same way a cycle's initiators are: the triggers between
	 * the previous close and the first step row.
	 */
	let opener: TriggerKind | null = cycle?.initiators.at(-1) ?? null;
	if (cycle === undefined) {
		const previous = cycles.filter(
			(candidate) => candidate.closeIndex < span.from,
		);
		for (
			let i = (previous.at(-1)?.closeIndex ?? -1) + 1;
			i <= span.to && records[i].kind !== "tool";
			i += 1
		) {
			opener = triggerOf(records[i]) ?? opener;
		}
	}
	switch (opener) {
		case "wake":
		case "monitor_prompt":
			return "Wake";
		case "peer":
		case "hub_message":
			return "Peer message";
		case "job_result":
			return "Job result";
		default:
			return null;
	}
}

/**
 * Did this segment RUN TO A REAL END: does its bar earn the completion mark?
 *
 * WHAT THE MARK SAYS, AND WHERE IT APPEARS (design review round 1 on #708, D4;
 * agent review R1-3). The mark says "this section finished" - the closed-disposal
 * receipt without a card. It is carried by every bar that is a SECTION of the turn
 * rather than the ordinary work under the answer: a bar after the answer, and a
 * labelled bar (`Wake`, `Peer message`, `Job result`, `Steered`) before it. The
 * ordinary unlabelled bar sits directly above the answer, and the answer IS the
 * statement that it finished, so a mark there would be constant on every condensed
 * turn in the transcript (the default state the design was approved without one)
 * and carry no information. The rule is therefore the same on both sides of the
 * answer; only the constant case is exempt.
 *
 * COMPLETION NEEDS A REAL CLOSER, AND A CYCLE THAT CLOSED. The segment's last
 * row must be a settled assistant message or a finished call -- and the segment
 * must end inside a cycle at all. `cyclesOf` builds a cycle only around a close
 * row, so a span whose last row is a bare trigger or an unfinished stretch of
 * work belongs to NO cycle: nothing in it ever handed over, and its bar wears no
 * mark whatever its last row happens to be (review round 2, MINOR-2: a wake that
 * never closed but ended on a finished tool call wore the check -- `U T A M W T`
 * -> `Wake ✓` over a section that only ever started). A span the next terminal
 * marker CUT OFF is in the same class for the same reason: it ended in that
 * state, not in success, so no green mark sits over `Stopped with an error`.
 */
export function segmentIsCompleted(
	records: readonly TranscriptRecord[],
	cycles: readonly TurnCycle[],
	span: SegmentSpan,
	answerCloseIndex: number | null,
	labelled: boolean,
): boolean {
	if (answerCloseIndex === null) return false;
	const afterAnswer = span.from > answerCloseIndex;
	if (!afterAnswer && !labelled) return false;
	if (
		!cycles.some(
			(cycle) => cycle.start <= span.to && span.to <= cycle.closeIndex,
		)
	)
		return false;
	const last = records[span.to];
	const settled =
		last.kind === "assistant"
			? !last.streaming
			: last.kind === "tool"
				? last.phase === "done"
				: false;
	if (!settled) return false;
	const next = span.to + 1 < records.length ? records[span.to + 1] : null;
	return next === null || boundaryKindOf(next) !== "terminal";
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
		/*
		 * A SEGMENT ABOVE THE SPAN (agent review round 1 on #708, R1-1). `from` is
		 * the first row a span may hold - just below the run's opening user row, or
		 * the loaded edge - and the cover loop below starts there, so a segment that
		 * swallowed the opening row was invisible to it.
		 */
		if (segment.from < options.from) {
			problems.push(
				`segment ${s} starts at row ${segment.from}, above the span's first row ${options.from}`,
			);
		}
		/*
		 * MAXIMALITY: one bar per CONTIGUOUS hidden span. A hidden row right after a
		 * segment that is not part of it means one span was split into two adjacent
		 * bars (two stacked bars with nothing between them, and a press that opens
		 * half a span). The ownership check above catches a row in TWO segments and
		 * the cover check a row in none; only this catches a row split ACROSS them.
		 */
		if (
			segment.to + 1 < records.length &&
			!partition.visible.has(segment.to + 1)
		) {
			problems.push(
				`segment ${s} is not maximal: row ${segment.to + 1} is hidden too`,
			);
		}
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
