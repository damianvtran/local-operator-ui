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
 * WHAT COLLAPSES, in one sentence: a run that is not the live one, that has
 * at least one row the reader is not already owed (a hidden row — see
 * `staysVisibleWhileCollapsed` for the pinned ones), and that either opens
 * with its own user row in the list or has its CLOSING ANSWER in it.
 *
 * THE SECOND HALF IS THE END-LOADED RULE (operator report, 2026-09-29): a run
 * whose head lies a few fetched pages above the window still condenses from the
 * LOADED span — the bar describes exactly the rows on hand — instead of
 * rendering head-cut until the reader pulls the head in. The old rule ("a
 * summary may only ever describe rows that are actually on hand") reached for
 * the right property and refused too much: the counts below already read
 * nothing but the rows in the list, and a bar over a head-cut run states NO
 * duration rather than one fabricated from the first loaded row. The window
 * snap and the bounded align fetch (`snapWindowToRunBoundary`,
 * `alignWalkDecision`) stay as refinements that bring the head in when it is
 * cheap; neither is a precondition any more.
 *
 * EVERYTHING ELSE — counts, failure classification, the hover sentence — is
 * reused from the shipped fold vocabulary (`foldSummary`, `ledgerName`) or
 * stated in ONE function (`isFailedCall`) whose body swaps to the sibling
 * session's shared outcome predicate the day it lands.
 */

import { type FoldableAction, foldSummary } from "./trace-fold-model";
import {
	type TranscriptRecord,
	isInterruptedFault,
} from "./transcript-reducer";
import { type Row, type TurnRun, ledgerName, runsOf } from "./transcript-rows";

/**
 * Whether a record stays on screen while its run is collapsed.
 *
 * THE PIN LIST, deliberately in ONE function: the design round can flip any
 * single member without touching the partition, the counts or the render pass.
 * Each member is a row a collapsed turn cannot be read without:
 *
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
 * NARROWED FOR THE OPERATOR'S FEEDBACK (2026-09-29, issue #5): `peer` and
 * `wake` delivery receipts were pinned in v1 under the fold tier's argument
 * ("a receipt hidden inside a summary of work would be a message the reader
 * never saw", `canonical-transcript.tsx`'s fold comment). Real use overrides
 * it: inside a completed turn these receipts are the bulk of the visual weight
 * — "the sends and receives within these periods ... stick out and take up
 * space/distract visually" — and they are IN-TURN evidence of the work rather
 * than a message between turns; the reader who wants them is one press away on
 * the bar's own expansion. The pin list now keeps only the rows a collapsed
 * turn cannot be read without: the memory statement, the death markers and the
 * incident reason.
 *
 * Everything else inside the span hides: tool rows, in-between assistant
 * prose, peer and wake receipts, info-level `custom` receipts (including
 * `job_result`), info notices, subagent-end lines.
 */
export function staysVisibleWhileCollapsed(record: TranscriptRecord): boolean {
	switch (record.kind) {
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
 * ONE LOCAL HELPER on purpose: this is the single place the bar's count is
 * read, so the switch to a shared exported predicate (if one is ever cut) is
 * mechanical. It consumes the sibling's landed facts rather than re-deriving
 * them (their interrupted-vs-failed fix, PR #613): `isInterruptedFault` is
 * their exported class binding for the wire's `not_run_kind`, and the reducer
 * sets `stopped` / clears `isError` from `__fault` in {skipped, aborted} on
 * both the end and the durable arms - so an interrupted call is excluded by
 * the wire's own state and this helper never re-sniffs a reason string. The
 * never-sent exclusions stay even though the fold chip and foot count
 * `isError` alone: the frozen contract keeps every never-sent call out of the
 * SUMMARY counts (v1), and their rows keep their own failure treatment. The
 * planning-fault kinds (`denied`, `gate_failed`, ...) therefore stay excluded
 * here by the same never-sent contract when they arrive with a verdict.
 */
export function isFailedCall(record: TranscriptRecord): boolean {
	if (record.kind !== "tool") return false;
	if (record.isError !== true) return false;
	if (record.neverSent === true) return false;
	if (record.notRunReason !== null && record.notRunReason !== undefined) {
		return false;
	}
	if (record.stopped === true) return false;
	// The class arm: a never-run row that states an interrupted kind is an
	// interrupt even where a producer set neither the stop window nor the
	// reason pair - the same reading their reducer and row ladder make.
	if (isInterruptedFault(record.notRunKind)) return false;
	return true;
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
 * PENDING QUESTION IS NOT A SETTLED TURN (design review round 1, D3). `live`
 * is the newest run's UNSETTLEDNESS, and the caller composes it from both
 * halves of that fact: the working line's predicate (a turn being written) and
 * the reader gate (a turn PARKED on a question). The gate half exists because
 * the working line stands down while a question is pending — that stand-down is
 * deliberate (`WorkingLine` yields to the dock) — so a rule that read only the
 * working line condensed a parked turn, then un-condensed it when the call
 * resumed: a bar appearing and vanishing with no reader action, stating `Took`
 * and counts of a turn that had handed over no answer (the live rig's
 * `parked on the approval` note).
 *
 * The tail — rows the bar must NOT hide — is the run's closing answer and
 * everything after it: the collapse summarises the PREFIX of the turn, and the
 * row the reader is being handed stays where it is. Hidden rows are everything
 * between the opening user row and that tail that is not pinned; for a
 * head-cut run they start at the run's first LOADED row, which is exactly what
 * makes an end-loaded bar describe only rows on hand.
 *
 * THE FOCUS HOLD (`options.focusHold` / `options.openRuns`). A collapse is a
 * transition the reader did not initiate, and it UNMOUNTS rows — a reader
 * whose keyboard focus sits inside a row this pass would hide loses focus to
 * the body. The caller passes the record id holding focus inside the
 * transcript (or null) and the keys of the runs the reader has opened; a run
 * that would hide the focused row and is NOT open simply does not collapse
 * this pass. The plan still states what it WOULD hide, and the next pass —
 * focus moved on — folds it. Deliberately narrower than "no collapse while
 * focused": a bar over a run the reader is not in cannot disturb them, and a
 * reader already looking at the rows (the run is open) is not mid-transition.
 */
export function collapsePlan(
	rows: Row[],
	options: {
		live: boolean;
		focusHold?: string | null;
		openRuns?: ReadonlySet<string>;
	},
): CollapsePlan {
	/*
	 * Only the NEWEST run can be the one in flight, and only while the pane says
	 * the turn is unsettled (`live`): every earlier run is a finished turn and
	 * behaves like one even when a later turn is streaming above the reader's
	 * place (§4.5's live rule, which `TraceFold`'s `sectionLive` states for
	 * folds as "a run in an OLDER turn must not open itself because a LATER turn
	 * happens to be running").
	 */
	const runs = runsOf(rows);
	const focusHold = options.focusHold ?? null;
	const openRuns = options.openRuns ?? NO_OPEN_RUNS;
	return {
		runs: runs.map((run, index) => {
			const planned = planRun(
				rows,
				run,
				index === runs.length - 1 && options.live,
			);
			if (
				focusHold !== null &&
				planned.collapses &&
				!openRuns.has(planned.key) &&
				planned.hidden.some((row) => row.record.id === focusHold)
			) {
				return { ...planned, collapses: false };
			}
			return planned;
		}),
	};
}

/** The empty set `collapsePlan` reads when the caller hands it no `openRuns`. */
const NO_OPEN_RUNS: ReadonlySet<string> = new Set();

/*
 * THE ON-LOAD ALIGNMENT (operator report, 2026-09-28: "the messages don't seem
 * to be collapsed on previous collapsible segments immediately on load ...").
 *
 * The render window is a raw row count, and a raw count lands wherever it
 * lands — often inside a completed run. A run cut by the window's top edge has
 * no opening user row in the list, so it cannot collapse (the window-cut rule
 * above), and the reader who opened a long conversation saw in-between rows
 * until they scrolled the head in. These two helpers let the consumer move the
 * window's edge ONTO a run boundary, and — when the boundary is not loaded at
 * all — say so, so the load path can fetch it. Both are pure functions of the
 * row list, so the window stays a derivation rather than state that can race
 * the first paint.
 *
 * Both read only the row list and the window size — no liveness — because they
 * are consumed ABOVE the point where this component derives whether the newest
 * run is live; a window edge inside the newest run is aligned like any other,
 * which at worst mounts the turn the reader is already watching stream.
 */

/**
 * The window's top edge, snapped UP to the opening of the run it lands in.
 *
 * Returns the size unchanged when the edge already sits on a boundary, when
 * the enclosing run's head is cut (nothing to snap to — the load path's
 * `windowTopRunIsHeadCut` case), or when the snap would add more than
 * `maxExtra` rows (a run taller than the bound keeps the shipped cut
 * behaviour rather than mounting itself unbounded).
 *
 * A snapped window top is a run boundary BY CONSTRUCTION, so every run the
 * list hands to `runsOf` opens with its own user row and every completed one
 * collapses on the first paint — the operator's "fill the screen with user
 * messages, final agent responses, and collapsed sections".
 */
export function snapWindowToRunBoundary(
	rows: Row[],
	windowSize: number,
	maxExtra: number,
): number {
	const total = rows.length;
	if (total <= windowSize) return windowSize;
	const top = total - windowSize;
	const runs = runsOf(rows);
	const enclosing = runs.find(
		(run) => run.openingIndex <= top && top <= run.endIndex,
	);
	if (enclosing === undefined) return windowSize;
	if (!enclosing.opensWithUserRow) return windowSize;
	const extra = top - enclosing.openingIndex;
	if (extra <= 0 || extra > maxExtra) return windowSize;
	return windowSize + extra;
}

/**
 * Whether the run the window's top edge lands in has its head cut off the
 * LOADED rows — the case a fetch can fix and a snap cannot.
 *
 * True only when the row list itself starts mid-run (the first run of the
 * fetched set, `openingUserIndex === null`) and the window edge is inside it;
 * the consumer pairs this with `hasMore` to fetch the missing head.
 */
export function windowTopRunIsHeadCut(
	rows: Row[],
	windowSize: number,
): boolean {
	const total = rows.length;
	if (total <= windowSize) return false;
	const top = total - windowSize;
	const runs = runsOf(rows);
	const enclosing = runs.find(
		(run) => run.openingIndex <= top && top <= run.endIndex,
	);
	if (enclosing === undefined) return false;
	return !enclosing.opensWithUserRow;
}

/**
 * What a window of this size actually PUTS ON SCREEN, in rows.
 *
 * THE READER'S CURRENCY (operator report, 2026-09-29: "the full set of condensed
 * messages don't load"). The render window is a RAW row count, but a completed
 * run collapses to one bar, so a raw step reveals a fraction of what it claims:
 * measured against the operator's real-shape journal, one 618-row run painted
 * 4-7 rows across window 60..300 — ten gestures of nothing while the count in
 * the slot grew by hundreds. Every rule that reasons about "did the reader see
 * it" has to reason in PAINTED rows, and this is that number.
 *
 * It is DERIVED, not a second copy of the render pass: the snap and the collapse
 * are the same two functions the component calls, so a change to either moves
 * this count with it. `hiddenRows` (the slot's raw count) is a different
 * quantity and is deliberately untouched.
 *
 * `snapMaxExtra` is REQUIRED rather than defaulted, and that is on purpose: the
 * snap's bound belongs to the consumer (`WINDOW_ALIGN_MAX_EXTRA` in the
 * transcript), and a default here would let a caller's paint count disagree
 * with the window the component actually mounts.
 */
export function paintedRows(
	rows: Row[],
	windowSize: number,
	options: {
		step: number;
		live?: boolean;
		openRuns?: ReadonlySet<string>;
		snapMaxExtra: number;
	},
): number {
	const total = rows.length;
	/*
	 * Below the total the window is a tail slice of the SNAPPED size, exactly as
	 * the component derives it; at or above it the whole list is mounted either
	 * way, so the snap is skipped rather than asked to align a list it cannot cut.
	 */
	const alignSize = snapWindowToRunBoundary(
		rows,
		windowSize,
		options.snapMaxExtra,
	);
	const visible = total > alignSize ? rows.slice(total - alignSize) : rows;
	const plan = collapsePlan(visible, {
		live: options.live ?? false,
		openRuns: options.openRuns,
	});
	let hidden = 0;
	for (const run of plan.runs) {
		/*
		 * An OPEN run paints the rows its bar hides - the render mounts the bar's
		 * children when `open` is set - so it is not hidden for this count, the
		 * same treatment the component gives it.
		 */
		if (run.collapses && !options.openRuns?.has(run.key)) {
			hidden += run.hidden.length;
		}
	}
	return visible.length - hidden;
}

/**
 * How many widen steps one act may search before it settles for what it has.
 *
 * The bound `MAX_CHAIN_WIDEN` states for the reveal CHAIN, restated for the
 * single act that picks a window size: twelve steps of `WINDOW_STEP` rows is
 * 720 rows, past any viewport, and the point of a bound is that a bug in the
 * arithmetic cannot walk an unbounded conversation into memory on one gesture.
 */
export const WIDEN_MAX_STEPS = 12;

/**
 * The next window size, chosen by what the reader will SEE rather than by a raw
 * row count. See `paintedRows` for why the difference matters.
 *
 * Start at `windowSize + step` and keep stepping while the snapped window's
 * painted rows have not grown by `minVisibleRows` (default 8: about half a
 * viewport of ordinary rows, and the smallest reveal a reader can be said to
 * have been shown), stopping at `maxRows` or the transcript. The result is what
 * `widen()` in the transcript commits, so ONE gesture still reveals at most one
 * window — the operator's "it keeps loading in chunks" loop stays closed — but
 * the window it reveals is one with something in it.
 *
 * The snap's `maxExtra` is the consumer's (see `paintedRows`) and `live`/
 * `openRuns` are passed straight through: a run the reader has OPEN paints its
 * rows, and a run still being written is never collapsed, so a widen must count
 * them as painted or it would overshoot for a reader who had expanded the very
 * run in the way.
 */
export function widenTarget(
	rows: Row[],
	windowSize: number,
	options: {
		step: number;
		minVisibleRows?: number;
		maxRows?: number;
		live?: boolean;
		openRuns?: ReadonlySet<string>;
		snapMaxExtra: number;
	},
): number {
	const total = rows.length;
	const minVisibleRows = options.minVisibleRows ?? 8;
	const maxRows = Math.min(total, options.maxRows ?? total);
	const { step } = options;
	const before = paintedRows(rows, windowSize, options);
	let size = Math.min(maxRows, windowSize + step);
	/*
	 * `while`, not a single test: over a transcript of finished turns the first
	 * several steps are all invisible (the metric above is about a run's own
	 * head and tail, not about raw rows), so a one-step overshoot would fix
	 * nothing. Each iteration is bounded by `WIDEN_MAX_STEPS` steps from the
	 * caller's `maxRows`.
	 */
	while (
		size < maxRows &&
		paintedRows(rows, size, options) - before < minVisibleRows
	) {
		size = Math.min(maxRows, size + step);
	}
	return size;
}

/**
 * Durable pages ONE open may walk at the alignment (loader-continuity 1b,
 * design spec section 7).
 *
 * WAS `ALIGN_FETCH_MAX = 2`, and two pages was the whole of the operator's
 * symptom 1: a turn whose head lay further up the journal than two pages could
 * never state its own size. Measured on the real-shape journal, the bar at open
 * read "30 actions" against a run of 423 calls, and it only grew as pages
 * arrived by hand ("97 actions" in the operator's own screenshot is the same
 * fact, one fetch budget deeper). A settled turn must be able to COMPLETE ITS
 * OWN CONDENSATION, and the honest quantity that bounds that is one act's worth
 * of pages -- the same `JUMP_MAX_PAGES` a rail jump walks, whose own test pins
 * the two equal so the reader's chain and the jump cannot disagree.
 */
export const ALIGN_WALK_MAX_PAGES = 12;

/**
 * Whether the completion walk spends one more page, and the counter it leaves.
 *
 * EVERY TERM IS A REASON TO STOP, and they are the design's section 7 clauses:
 * the window's top run is still head-cut and the backend has more (there is
 * something to complete), no page is in flight (the walk never queues behind
 * itself), the reader is following the tail and has been quiet for the settle
 * window (`mayWalk`, computed by the paging hook from the SAME geometry and
 * input clock every other spend uses -- the walk must not re-derive them), and
 * every page so far APPLIED (a non-`applied` outcome halts the walk rather than
 * counting against it: one failure already owns the failed row, and a walk that
 * kept asking would be the operator's "keeps loading in chunks" loop).
 *
 * WHY A PURE FUNCTION. The bound is the property that keeps an open from
 * walking an unbounded conversation into memory, and inside an effect it could
 * only be observed by re-mounting a component -- a harness whose own
 * double-mount made the reading ambiguous (measured: a per-instance cap of two
 * read as three across a strict-mode remount). Here the table is decided by
 * construction.
 */
export function alignWalkDecision(
	spent: number,
	context: {
		hasMore: boolean;
		loadingOlder: boolean;
		headCut: boolean;
		mayWalk: boolean;
		halted: boolean;
	},
): { fetch: boolean; spent: number } {
	if (
		spent >= ALIGN_WALK_MAX_PAGES ||
		context.halted ||
		context.loadingOlder ||
		!context.hasMore ||
		!context.headCut ||
		!context.mayWalk
	) {
		return { fetch: false, spent };
	}
	return { fetch: true, spent: spent + 1 };
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
	 * the oldest one loaded and nothing before it is knowable. A head-cut run
	 * CAN collapse now (the end-loaded rule), which is exactly why the duration
	 * gate below refuses to read `start` there: this position is the loaded
	 * span's edge, not the turn's own beginning.
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
		 * The bar exists iff there is something to hide, this is not the run a
		 * live turn is being written in, and the run can be honestly summarised:
		 * its opening user row is on hand, OR its closing answer is (the
		 * end-loaded rule — the bar then describes exactly the loaded span; see
		 * the header). The focus hold is already applied by `collapsePlan`.
		 */
		collapses:
			hidden.length > 0 &&
			(run.opensWithUserRow || run.closingAnswerId !== null) &&
			!live,
		recordIds: runRows.map((row) => row.record.id),
		hidden,
		/* The fold's placement rule: the bar takes the first hidden row's slot+gap. */
		gap: hidden[0]?.gap ?? "item",
		facts: {
			/*
			 * Shown iff the span is at least a second — never a `0s` claim (§4.4) —
			 * AND the span is the run's REAL one: a head-cut run's `start` is its
			 * first LOADED row, and a duration stated from there would be a number
			 * the turn never had (the honesty half of the end-loaded rule).
			 */
			durationS: run.opensWithUserRow && span >= 1000 ? span / 1000 : null,
			actions: actions.length,
			failed,
			firstFailedId,
			title: actions.length > 0 ? foldSummary(actions) : null,
		},
		stampTs: closingRow?.record.ts ?? null,
	};
}
