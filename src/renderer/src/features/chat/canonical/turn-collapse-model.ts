/**
 * The collapsed-turn-summary model: one bar over a completed turn's
 * pre-answer rows (the frozen design's §4, "Option C").
 *
 * WHY A VIEW TIER AND NOT A RECORD. A collapsed run keeps every record id,
 * order and gap tier it had; the bar is a collapsed VIEW of a contiguous
 * slice, exactly as `TraceFold` is a collapsed view of a run of calls
 * (`trace-fold-model.ts:26-34`'s doctrine). So this module is pure — rows in,
 * plan out — and the reducer, the wire and the canonical model are untouched.
 *
 * THE UNIT IS A RUN (`runsOf`), NOT A RECORD OR A FOLD: the rows between the
 * turn's opening user message and the answer it worked towards, with a user
 * message that arrived mid-turn folded in as a steer. That is the same unit
 * the caption rule and the foot line use, which is what stops a steered turn's
 * bar from disagreeing with its own foot (F5 in the design).
 *
 * WHAT COLLAPSES, in one sentence: a run whose head is in the list, that is
 * not the live one, and that has at least one row the reader is not already
 * owed (a hidden row — see `staysVisibleWhileCollapsed` for the pinned ones).
 * A run the window has cut (its opening user row is not loaded) renders as
 * today: a summary may only ever describe rows that are actually on hand.
 *
 * EVERYTHING ELSE — counts, failure classification, the hover sentence — is
 * reused from the shipped fold vocabulary (`foldSummary`, `ledgerName`) or
 * stated in ONE function (`isFailedCall`) whose body swaps to the sibling
 * session's shared outcome predicate the day it lands.
 */

import { type FoldableAction, foldSummary } from "./trace-fold-model";
import type { TranscriptRecord } from "./transcript-reducer";
import { type Row, type TurnRun, ledgerName, runsOf } from "./transcript-rows";

/**
 * Whether a record stays on screen while its run is collapsed.
 *
 * THE PIN LIST, deliberately in ONE function: the design round can flip any
 * single member without touching the partition, the counts or the render pass.
 * Each member is a message the reader is owed rather than a step of the work:
 *
 * - `peer` — a message from another session, addressed to the reader. The fold
 *   tier already refuses to hide receipts for this reason ("a receipt hidden
 *   inside a summary of work would be a message the reader never saw",
 *   `canonical-transcript.tsx`'s fold comment), and a collapse is a bigger
 *   summary than a fold.
 * - `wake` — a scheduled-wake delivery receipt, the same argument one kind
 *   over (`transcript-rows.ts`'s `isStatementRow` counts it as a statement).
 * - `compaction` — the conversation's memory statement: rare, and the §E3
 *   precedent already pins it as a statement so `[user][answer][compaction]`
 *   keeps its caption.
 * - a `notice` with `complete === true` — "Stopped with an error" /
 *   "Interrupted", the transcript's own "this turn is over" records
 *   (`working-line-model.ts`'s two marker texts). These are HOW the interrupted
 *   cases (§5 cases 6-8) stay legible on a collapsed turn.
 * - a `custom` at `level === "error"` — `session_incident`, the reason a turn
 *   died. The row that says why the thing below the bar stopped must not be
 *   one more hidden row.
 *
 * Everything else inside the span hides: tool rows, in-between assistant
 * prose, info-level `custom` receipts (including `job_result`), info notices,
 * subagent-end lines.
 */
export function staysVisibleWhileCollapsed(record: TranscriptRecord): boolean {
	switch (record.kind) {
		case "peer":
		case "wake":
		case "compaction":
			return true;
		case "notice":
			return record.complete === true;
		case "custom":
			return record.level === "error";
		default:
			return false;
	}
}

/**
 * Is this tool row a genuine FAILURE?
 *
 * THE SIBLING CONTRACT (session 3d5d52c85ba2 owns interrupted-vs-failed): the
 * bar counts ONLY `error`, and aborted (`stopped`), never-sent
 * (`neverSent`/`notRunReason`) and skipped calls are excluded — a call the
 * user stopped did not fail, and a call no tool ever received has no outcome.
 * The bar shows no "interrupted" wording in v1; the aborted answer's own
 * `Stopped before finishing` caption carries that fact where it already does.
 *
 * ONE LOCAL HELPER on purpose: the sibling's shared outcome predicate is not
 * exported yet, so this is the single place to swap when it is. Their
 * interrupted-vs-failed fix HAS LANDED (PR #613): a durable `skipped` row now
 * clears `isError` and sets `stopped`, and a live end event with
 * `__fault` in {skipped, aborted} does the same - so this helper's exclusions
 * read the settled state rather than working around it, and the count is
 * genuine `error` only. The planning-fault never-run kinds (`denied`,
 * `gate_failed`, ...) stay excluded here because the frozen contract excludes
 * every never-sent call; their rows keep their own failure treatment.
 */
export function isFailedCall(record: TranscriptRecord): boolean {
	if (record.kind !== "tool") return false;
	if (record.neverSent === true) return false;
	if (record.notRunReason !== null && record.notRunReason !== undefined) {
		return false;
	}
	if (record.stopped === true) return false;
	return record.isError === true;
}

/**
 * The bar's facts, in the order a reader needs them.
 *
 * `durationS` is the WALL span (§4.4): opening user row to the latest end
 * instant in the run, null when the span is under a second or the clocks
 * disagree. It is deliberately NOT the foot's quantity — the foot SUMS tool
 * seconds and excludes model time, while "Took" is wall clock — and only one
 * of the two is ever on screen for a run (the bar suppresses the foot).
 */
export type TurnSummaryFacts = {
	durationS: number | null;
	/** Tool rows in the run: the same unit as the fold's summary and the foot. */
	actions: number;
	/** Tool rows whose outcome is a genuine error (see `isFailedCall`). */
	failed: number;
	/** The first failed row, for the failure control's jump. */
	firstFailedId: string | null;
	/** The fold-style class sentence (`foldSummary`), or null with no actions. */
	title: string | null;
};

/**
 * The latest instant a row states, for the run's span (§4.4).
 *
 * Assistant → its `settledAt` (stamped by the reducer when the record
 * settles), falling back to `ts`; durable rows have no `settledAt` and their
 * `ts` IS the completion commit. Tool → `endedAt`, falling back to `ts`
 * (durable tool rows carry `duration_s` and no stamps, so their commit instant
 * is the honest end). Anything else → its `ts`.
 */
function endInstant(record: TranscriptRecord): number {
	switch (record.kind) {
		case "assistant":
			return record.settledAt ?? record.ts;
		case "tool":
			return record.endedAt ?? record.ts;
		default:
			return record.ts;
	}
}

/**
 * One run's plan: what the bar says, and what it hides.
 */
export type RunCollapsePlan = {
	/** The run's stable identity: its opening user row's record id. */
	key: string;
	/** The partition span, in `visible`-row indices. */
	run: TurnRun;
	/** Whether the bar renders for this run. */
	collapses: boolean;
	/** Every row of the run, in order (the bar's `data-run-ids`). */
	recordIds: string[];
	/** The rows the bar hides, in order. Empty when nothing is hidden. */
	hidden: Row[];
	/** The bar's margin tier: the FIRST hidden row's gap (the fold's own rule). */
	gap: Row["gap"];
	facts: TurnSummaryFacts;
	/** The closing answer's instant, for the bar's stamp; null when none. */
	stampTs: number | null;
};

export type CollapsePlan = {
	runs: RunCollapsePlan[];
};

/**
 * Plan the collapse over a visible row list.
 *
 * `live` is the pane's own liveness (the working line's predicate): the NEWEST
 * run is the one a live turn is being written in, so it never collapses — the
 * same rule `TraceFold` reads as `sectionLive` ("nothing condenses while a
 * call in it is still running"), which is why a running turn renders exactly
 * as today and condenses once, at the turn end.
 *
 * The tail — rows the bar must NOT hide — is the run's closing answer and
 * everything after it: the collapse summarises the PREFIX of the turn, and the
 * row the reader is being handed stays where it is. Hidden rows are everything
 * between the opening user row and that tail that is not pinned.
 */
export function collapsePlan(
	rows: Row[],
	options: { live: boolean },
): CollapsePlan {
	/*
	 * Only the NEWEST run can be the one in flight, and only while the pane says
	 * a turn is running: every earlier run is a finished turn and behaves like
	 * one even when a later turn is streaming above the reader's place (§4.5's
	 * live rule, which `TraceFold`'s `sectionLive` states for folds as "a run in
	 * an OLDER turn must not open itself because a LATER turn happens to be
	 * running").
	 */
	const runs = runsOf(rows);
	return {
		runs: runs.map((run, index) =>
			planRun(rows, run, index === runs.length - 1 && options.live),
		),
	};
}

function planRun(rows: Row[], run: TurnRun, live: boolean): RunCollapsePlan {
	const runRows = rows.slice(run.openingIndex, run.endIndex + 1);
	/*
	 * Where the tail starts: the closing answer and everything after it stays put
	 * (the collapse summarises the PREFIX of the turn, not its hand-over). A run
	 * with no closing answer — the interrupted/dead residual cases — has no tail,
	 * so every non-pinned row after the opening one is eligible to hide.
	 */
	let tailFrom = run.endIndex + 1;
	if (run.closingAnswerId !== null) {
		const at = runRows.findIndex(
			(row) => row.record.id === run.closingAnswerId,
		);
		if (at !== -1) tailFrom = run.openingIndex + at;
	}
	const hidden: Row[] = [];
	/*
	 * The span starts just after the opening USER row — or at the list's own
	 * beginning for a run whose head is cut off, where the first row is simply
	 * the oldest one loaded and nothing before it is knowable. (That run never
	 * collapses anyway; this keeps `hidden` describing the same span the bar
	 * would take.)
	 */
	const spanFrom = run.opensWithUserRow
		? run.openingIndex + 1
		: run.openingIndex;
	for (let index = spanFrom; index <= run.endIndex; index += 1) {
		if (index >= tailFrom) break;
		const row = rows[index];
		if (staysVisibleWhileCollapsed(row.record)) continue;
		hidden.push(row);
	}

	const actions: FoldableAction[] = [];
	let failed = 0;
	let firstFailedId: string | null = null;
	for (const row of runRows) {
		if (row.record.kind !== "tool") continue;
		const failedHere = isFailedCall(row.record);
		actions.push({ name: ledgerName(row.record), failed: failedHere });
		if (failedHere) {
			failed += 1;
			firstFailedId ??= row.record.id;
		}
	}

	const start = rows[run.openingIndex].record.ts;
	let end = start;
	for (const row of runRows) end = Math.max(end, endInstant(row.record));
	const span = end - start;

	const closingRow =
		run.closingAnswerId === null
			? null
			: (runRows.find((row) => row.record.id === run.closingAnswerId) ?? null);

	return {
		key: run.key,
		run,
		/*
		 * The bar exists iff there is something to hide, the head of the run is
		 * loaded, and this is not the run a live turn is being written in.
		 */
		collapses: hidden.length > 0 && run.opensWithUserRow && !live,
		recordIds: runRows.map((row) => row.record.id),
		hidden,
		/* The fold's placement rule: the bar takes the first hidden row's slot+gap. */
		gap: hidden[0]?.gap ?? "item",
		facts: {
			/* Shown iff the span is at least a second — never a `0s` claim (§4.4). */
			durationS: span >= 1000 ? span / 1000 : null,
			actions: actions.length,
			failed,
			firstFailedId,
			title: actions.length > 0 ? foldSummary(actions) : null,
		},
		stampTs: closingRow?.record.ts ?? null,
	};
}
