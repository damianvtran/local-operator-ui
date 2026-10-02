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
 * SEGMENTS, NOT ONE BAR (issue #665). A run's hidden rows are partitioned into
 * ordered disjoint SEGMENTS by `turn-segments.ts`, one bar each, around the rows
 * that must stay on screen: the pinned rows, the ELECTED ANSWER (the last
 * response cycle's close, not the last message emitted) and the trailing
 * statements. A bar therefore never precedes a pinned row that happened before
 * it, and a reply written after the session was disposed is a labelled follow-up
 * bar BELOW the answer instead of a row that takes the answer's place. The
 * run-level `facts` are the TURN's (through the answer); each segment carries its
 * own.
 *
 * EVERYTHING ELSE — counts, failure classification, the hover sentence — is
 * reused from the shipped fold vocabulary (`foldSummary`, `ledgerName`) or
 * stated in ONE function (`isFailedCall`) whose body swaps to the sibling
 * session's shared outcome predicate the day it lands.
 */

import { isPartialDelivery } from "../components/trace/tool-row-model";
import type { TranscriptDisplayMode } from "../transcript-display-mode";
import {
	type FoldableAction,
	foldSummary,
	workedSeconds,
} from "./trace-fold-model";
import {
	type TranscriptRecord,
	isInterruptedFault,
} from "./transcript-reducer";
import {
	type Row,
	type TurnRun,
	isStatementRow,
	ledgerName,
	paintsSomething,
	runsOf,
} from "./transcript-rows";
import {
	type SegmentSpan,
	type TurnCycle,
	boundaryKindOf,
	isTerminalMarker,
	labelOfSegment,
	partitionRun,
	reportsCompletedThought,
	segmentIsCompleted,
} from "./turn-segments";

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
	/*
	 * THE PIN LIST IS THE BOUNDARY VOCABULARY (`boundaryKindOf`): the same
	 * predicate the classifier reads to decide a turn is over, so a marker that
	 * ends a turn is always also a marker that stays on screen - the two rules
	 * used to be copies, and the `closed`/`retired` receipts were the case that
	 * could have drifted between them.
	 */
	return boundaryKindOf(record) !== null;
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
	// The `send` delivery pair: `mailbox` and `unconfirmed` are settled non-failures
	// that draw the amber partial row, so they never count here whatever a producer
	// put on `is_error`. Listed beside the never-sent exclusions below for the same
	// reason they are - this helper's answer is a COUNT's answer.
	if (isPartialDelivery(record.delivery)) return false;
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
 * `durationS` is the WORKED time (`workedSeconds`, `trace-fold-model.ts`): the
 * seconds the span's own calls reported, summed - the SAME quantity the turn's
 * foot states as `Worked for ...`. It used to be a wall span (opening row to the
 * latest end instant), and a ladder of bars beside the foot showed two different
 * quantities 16.7x apart on the operator-shaped journal, with action counts that
 * reconciled exactly inviting the reader to reconcile the durations too (design
 * review round 1 on #708, D1). `Took` (bar) and `Worked for` (foot) are one
 * quantity in two places: the pre-answer bars sum to the foot within rounding.
 * A span whose calls reported nothing, or whose head is not loaded, states none.
 */
export type TurnSummaryFacts = {
	durationS: number | null;
	/** Tool rows in the run: the same unit as the fold's summary and the foot. */
	actions: number;
	/**
	 * Whether `actions` is a MINIMUM rather than the run's count — its opening row
	 * is not in the store, so the rows above the loaded span are still unknown.
	 *
	 * WHY A FACT AND NOT A DERIVATION AT THE BAR (design round 1, D1). The bar is
	 * the turn's only size statement, and a head-cut run's count read exactly like
	 * a complete one: the operator's own screenshot said `97 actions` for a turn of
	 * 423 and nothing on the line distinguished it from a settled total. A run can
	 * stay head-cut for good (one taller than the walk's allowance, or a backend
	 * with the pages gone), so the honest marker has to be part of the statement
	 * the model makes — `planRun` is where `opensWithUserRow` is known, and the bar
	 * renders `N+` and states the same in words.
	 */
	partial: boolean;
	/** Tool rows whose outcome is a genuine error (see `isFailedCall`). */
	failed: number;
	/** The first failed row, for the failure control's jump. */
	firstFailedId: string | null;
	/** The fold-style class sentence (`foldSummary`), or null with no actions. */
	title: string | null;
};

/**
 * One SEGMENT of a run: a maximal contiguous span of hidden rows and the one bar
 * that stands in for it (issue #665).
 *
 * A run's hidden rows used to be ONE bar taking the first hidden row's slot, so a
 * pinned row (a compaction, a stop marker, an incident) between two hidden spans
 * rendered AFTER a bar that preceded it and jumped when the bar opened. Each span
 * is now its own bar in its own slot, in document order, and the pinned rows keep
 * the slots they had - expanding any bar reorders nothing.
 */
export type SegmentPlan = {
	/**
	 * The reader's expansion key for THIS bar (the value `openRuns` holds).
	 *
	 * A KEY NAMES ONE SPAN FOR THE LIFE OF THE CONVERSATION, so it is derived from
	 * the span's OWN anchor row and from nothing else - not from the run's key, and
	 * not from the span's position among its neighbours.
	 *
	 * Two things used to break that, and the second is the operator's jitter:
	 *
	 * - the span nearest the answer inherited the bare run key. A wake after the
	 *   answer makes a NEW span the nearest one, which took the bare key, so a
	 *   reader's stored expansion of the first bar named the second;
	 * - every key was prefixed with `TurnRun.key`, which is the closing answer's id
	 *   (or, while a turn is being written and has none, its LAST row's id). A wake
	 *   reply moves the answer and a streamed row moves the last row, so every bar
	 *   of the run was renamed - its React element remounted and its stored
	 *   expansion dropped - at exactly the moment the agent started thinking again.
	 *
	 * WHICH ROW ANCHORS A SPAN depends on the side of the answer, because rows
	 * only ever arrive at two places: ABOVE the loaded head (a page landing) and
	 * at the TAIL (a live turn). The anchor must be a row that neither of those
	 * moves, and that survives rows INSIDE the span appearing or disappearing (the
	 * cross-session filter hides a receipt and a send row from the span the
	 * moment the setting flips, which moves the span's own last row):
	 *
	 * - a span BEFORE the answer can grow upward when a page lands - the head-cut
	 *   span is exactly that - so its FIRST row is not stable. What ends it is a
	 *   VISIBLE row (a span is a maximal hidden stretch, so a visible row follows
	 *   it), and that row is anchored in place: `seg:<the visible row after it>`.
	 *   A span with nothing after it (an answerless run's tail, which is either
	 *   still in flight - so not a bar - or idle) falls back to its own last row;
	 * - a span AFTER the answer grows at the tail while the follow-up is being
	 *   written and never upward, so its FIRST row is the stable one: `seg:<its
	 *   first row>`.
	 *
	 * A row is in exactly one span, so two spans can never share a key. A key of an
	 * older shape (the run key, or `<run key>#<row>`) never starts `seg:`, so it
	 * names nothing: the bar renders collapsed, which is the safe failure for a
	 * stored expansion whose bar is gone. Expansion state is memory-only
	 * (`turn-collapse-open.ts`), so a new shape simply renders every bar collapsed
	 * once - there is never a key to migrate.
	 *
	 * A span still IN FLIGHT (see `planRun`) is not a bar yet, so no reader can hold
	 * its key; the key it has when it settles is the one it keeps.
	 */
	key: string;
	/** The hidden rows, in order. */
	rows: Row[];
	/** `rows[0]`'s id: the bar's slot and its `data-record-id`. */
	firstId: string;
	/** This segment's ids (the bar's `data-run-ids`, so the reveal opens the right bar). */
	segmentIds: string[];
	/** The bar's margin tier. See `segmentGap`. */
	gap: Row["gap"];
	/** After the answer: a follow-up section (commentary), not work towards it. */
	afterAnswer: boolean;
	/** The word ahead of the clauses (`Wake`, `Peer message`, `Steered`, ...), or null. */
	label: string | null;
	/** A settled follow-up: the bar carries the completion mark. */
	completed: boolean;
	/**
	 * Whether this bar renders (the run condenses AND the focus hold did not stand
	 * this span open). False means its rows are simply drawn in place.
	 */
	collapsed: boolean;
	/**
	 * The turn's ONE stamp, when this bar is the one that carries it: the answer's
	 * instant, on the run's SOLE pre-answer bar (a bar that states the turn's whole
	 * work - the shipped shape, where the bar replaces the answer's foot). With
	 * several pre-answer bars (a pinned row splits the work) no bar states the
	 * turn's totals, so none stamps and the answer's foot keeps the totals and the
	 * stamp. A follow-up bar never stamps - the answer is dated once.
	 */
	stampTs: number | null;
	facts: TurnSummaryFacts;
};

/**
 * One run's plan: what its bars say, and what they hide.
 */
export type RunCollapsePlan = {
	/** The run's stable identity: its closing answer's record id (else its last row's). */
	key: string;
	/** The partition span, in `visible`-row indices. */
	run: TurnRun;
	/** Whether ANY bar renders for this run. */
	collapses: boolean;
	/** Every row of the run, in order. */
	recordIds: string[];
	/**
	 * The rows the bars hide (all segments), in order. Empty when nothing is hidden.
	 *
	 * KEPT, NOT CONSUMED BY `src/` (agent review round 1 on #708, R1-4): the renderer
	 * reads `segments[*]`, `recordIds` and `segment.stampTs`. `hidden`, `gap`,
	 * `answerId` and `stampTs` are the run-level restatement the TWO MODEL SUITES
	 * (`turn-collapse-model.test.mjs`, `turn-segments.test.mjs`) read as the run's
	 * whole-turn contract - 32 property reads written against the pre-segments plan
	 * that still state the turn, not a bar (agent review round 2, NIT-1: no
	 * evidence rig reads a `collapsePlan` result). They are derived from `segments`
	 * in this one function and never independently, so they cannot drift; deleting
	 * them would move those assertions from "the turn" to "flatten the bars" for no
	 * consumer's benefit. Do not add a `src/` reader without asking whether it
	 * wants a bar's value instead.
	 */
	hidden: Row[];
	/** The first bar's margin tier (kept for the same reason as `hidden`). */
	gap: Row["gap"];
	/**
	 * The TURN's facts: what the run did up to and including its ELECTED ANSWER.
	 * Commentary after the answer is not the turn's work, so a follow-up's tool
	 * calls are counted on their own bar and never in this figure - which is what
	 * made the operator's `97 actions` state a total that mixed the answer's work
	 * with the post-dispose chatter.
	 */
	facts: TurnSummaryFacts;
	/** The elected answer's record id, or null when the run handed none over (kept for the suites, see `hidden`). */
	answerId: string | null;
	/** The answer's instant, for the turn's one stamp; null when none (kept for the suites, see `hidden`). */
	stampTs: number | null;
	/** Ordered, disjoint bars (see `SegmentPlan`). */
	segments: SegmentPlan[];
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
 * the working line stands down while a question is pending - that stand-down is
 * deliberate (`WorkingLine` yields to the dock) - so a rule that read only the
 * working line condensed a parked turn, then un-condensed it when the call
 * resumed: a bar appearing and vanishing with no reader action, stating `Took`
 * and counts of a turn that had handed over no answer (the live rig's
 * `parked on the approval` note).
 *
 * WHAT STAYS PUT is decided by the segments module (`partitionRun`): the pinned
 * rows, the ELECTED ANSWER and the run's trailing statements. Everything else in
 * the span hides, as one bar per contiguous span. For a head-cut run the first
 * span starts at the run's first LOADED row, which is exactly what makes an
 * end-loaded bar describe only rows on hand.
 *
 * LIVENESS IS THE IN-FLIGHT CYCLE'S, NOT THE RUN'S (operator report, 2026-10-01:
 * "messages are condensed, and then if a peer message or job completes and the
 * agent goes into thinking, the last condensed sequence suddenly un-condenses").
 * A wake / peer / job result does not open a run - only a `user` row does - so it
 * RE-OPENS the run that had just settled, which is then the newest run and
 * `live`. Spending `live` on the whole run expanded a bar the reader had just
 * read while the agent thought, and condensed it again when the agent stopped.
 * `planRun` now spends it only on the rows after the last SETTLED close (see
 * `settledCloseOf`): everything the reader has already seen settle keeps its bar,
 * and the one thing drawn in place is the cycle still being written. When that
 * cycle settles its span becomes a bar at the TAIL, below everything that was
 * already condensed, so nothing above it reflows.
 *
 * THE FOCUS HOLD (`options.focusHold` / `options.openRuns`). A collapse is a
 * transition the reader did not initiate, and it UNMOUNTS rows - a reader
 * whose keyboard focus sits inside a row this pass would hide loses focus to
 * the body. The caller passes the record id holding focus inside the
 * transcript (or null) and the keys of the bars the reader has opened
 * (`openRuns` holds SEGMENT keys, each derived from the span's own anchor row;
 * a key of an older shape names nothing and simply renders collapsed); a segment
 * that would hide the focused row and is NOT open simply does not collapse this
 * pass. The plan still states what it WOULD hide, and the next pass - focus
 * moved on - folds it. Deliberately narrower than "no collapse while focused":
 * a bar over a run the reader is not in cannot disturb them, and a reader
 * already looking at the rows (the bar is open) is not mid-transition.
 */
/**
 * DEV INSTRUMENTATION (UI perf audit A3): how many times `collapsePlan` runs.
 *
 * The walk's question is asked of a plan, and a transcript update used to ask it
 * by building a SECOND plan over the whole store; this counter is what the
 * before/after bench reads to show the per-update cost. Same shape as C1's
 * `messageInputRenderCount`: a module-level counter the bench reads and nothing
 * else touches at runtime.
 */
export const dbgCollapsePlanCalls = { count: 0 };

export function collapsePlan(
	rows: Row[],
	options: {
		live: boolean;
		focusHold?: string | null;
		openRuns?: ReadonlySet<string>;
		/**
		 * The reader's transcript display mode (issue #756). Threaded VERBATIM to
		 * `partitionRun` and consulted there; this function has no rule of its own
		 * over it, so the plan cannot grow a second opinion about what a mode means.
		 * Omitted is the shipped `by-turn` condensation.
		 */
		mode?: TranscriptDisplayMode;
	},
): CollapsePlan {
	dbgCollapsePlanCalls.count += 1;
	/*
	 * Only the NEWEST run can be the one in flight, and only while the pane says
	 * the turn is unsettled (`live`): every earlier run is a finished turn and
	 * behaves like one even when a later turn is streaming above the reader's
	 * place (§4.5's live rule, which `TraceFold`'s `sectionLive` states for
	 * folds as "a run in an OLDER turn must not open itself because a LATER turn
	 * happens to be running"). Within that run `planRun` spends `live` on the
	 * in-flight CYCLE only, not on the whole run.
	 */
	const runs = runsOf(rows);
	const focusHold = options.focusHold ?? null;
	const openRuns = options.openRuns ?? NO_OPEN_RUNS;
	return {
		runs: runs.map((run, index) =>
			planRun(
				rows,
				run,
				index === runs.length - 1 && options.live,
				focusHold,
				openRuns,
				options.mode,
			),
		),
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
 * Rows the window-top snap may extend by to reach a run the store has PROVEN
 * COMPLETE (loader-continuity 1b, the open frame).
 *
 * WHY A SECOND BOUND EXISTS. The bar's facts are computed over the MOUNTED
 * window, so the snap's ordinary bound (`WINDOW_ALIGN_MAX_EXTRA`, three durable
 * pages) decides how tall a run can be and still state its own count at open.
 * Measured on the operator's journal: the run is 642 rows, the ordinary snap
 * cannot reach it, and the open frame therefore shows 18 actions and no `Took`
 * for a settled turn the reader cannot complete without a gesture — symptom 1
 * itself ("the full set of condensed messages don't load"), with 1a's correct
 * tail guard refusing the widen that could have fixed it.
 *
 * WHAT MAKES THE BIGGER REACH SAFE, given that bound was chosen deliberately: a
 * run this tall is COLLAPSED, and a collapsed run unmounts the rows its bar
 * hides (`planRun`'s hidden span), so the cost of including the whole run is the
 * plan computation and the handful of rows the collapse leaves visible — not the
 * 642 rows. The reader following the tail sees no motion: the extension is
 * entirely above their place, and the anchor hold is what keeps it there.
 *
 * WHY IT REACHES THIS FAR. 720 rows is the widen's own reach
 * (`WIDEN_MAX_STEPS` x the 60-row `WINDOW_STEP`) and about what
 * `ALIGN_WALK_MAX_PAGES` pages of history hold, so the snap and the walk that
 * proves the rows are in the store agree on how tall a run one open may
 * complete. A run taller than this keeps the ordinary snap and its honest
 * partial statement — the bar still condenses, it simply cannot state the whole
 * run's count without the reader's own gesture.
 */
export const WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA = 720;

/**
 * The window's top edge, snapped UP to the opening of the run it lands in.
 *
 * Returns the size unchanged when the edge already sits on a boundary, when
 * the enclosing run's head is cut (nothing to snap to — the load path's
 * `windowTopRunIsHeadCut` case), or when the snap would add more than
 * `maxExtra` rows (a run taller than the bound keeps the shipped cut
 * behaviour rather than mounting itself unbounded).
 *
 * `completedRunMaxExtra` is the allowance above, and it is a SEPARATE bound
 * because it answers a different question: `maxExtra` bounds an ordinary snap
 * (a window edge a few rows inside a run), while this one covers a run the store
 * has PROVEN COMPLETE — the run's own opening row is in the list, which for a
 * tail-first, contiguous page load means every row of the run is in the store.
 * Reaching that row is what lets a settled turn state its true action count and
 * its `Took` clause with no reader gesture; the completion walk (this branch) is
 * what puts the row within reach, and before it only the first two pages were
 * ever fetched, so a run this tall could not get here at all.
 *
 * A snapped window top is a run boundary BY CONSTRUCTION, so every run the
 * list hands to `runsOf` opens with its own user row and every completed one
 * collapses on the first paint — the operator's "fill the screen with user
 * messages, final agent responses, and collapsed sections".
 *
 * `live` IS PART OF THE ALLOWANCE'S OWN PRECONDITION, not an extra guard (agent
 * review round 1, found through the live-run fixture): a run still being written
 * is not a run the store has PROVEN COMPLETE — the answer that would close it
 * does not exist yet — and it never collapses, so reaching its opening row would
 * put the whole streaming prefix on screen. That is exactly the cost the
 * allowance's justification excludes ("a collapsed run unmounts what its bar
 * hides"), so the reach stays ordinary while the pane says a turn is in flight.
 * The caller passes the SAME liveness the collapse plan reads.
 */
export function snapWindowToRunBoundary(
	rows: Row[],
	windowSize: number,
	maxExtra: number,
	completedRunMaxExtra = 0,
	live = false,
	/*
	 * The run under the window's top edge, PRE-COMPUTED when the caller already
	 * has it (agent review round 2, R2-2). `windowTopRun` is a whole-store
	 * partition, and the walk's store confirmation reads the SAME run — so the
	 * render computes it once and hands it here rather than each consumer paying
	 * its own partition per render. Defaulted for every other caller.
	 */
	enclosing: TurnRun | null = windowTopRun(rows, windowSize),
): number {
	const total = rows.length;
	if (total <= windowSize) return windowSize;
	const top = total - windowSize;
	if (enclosing === null) return windowSize;
	const extra = top - enclosing.openingIndex;
	/*
	 * `opensWithUserRow` is the PROOF, not a formality: pages load tail-first and
	 * contiguously, so a run whose opening row is in the list is a run whose every
	 * row is in the store. Only such a run may use the bigger allowance; a
	 * head-cut run refuses both, because there is no boundary to land on yet.
	 */
	const bound =
		enclosing.opensWithUserRow && !live
			? Math.max(maxExtra, completedRunMaxExtra)
			: enclosing.opensWithUserRow
				? maxExtra
				: 0;
	if (extra <= 0 || extra > bound) return windowSize;
	return windowSize + extra;
}

/**
 * The run the window's top edge lands in, or null when the window covers the
 * whole list (or the edge lands between runs).
 *
 * Extracted so the three consumers that need DIFFERENT things from the same
 * question — the snap (the run's opening index), the head-cut test (whether that
 * opening row is loaded) and the walk's per-run budget (the run's stable key) —
 * ask it once. A second copy of `top = total - windowSize` beside this one is
 * how these three would drift apart.
 */
export function windowTopRun(rows: Row[], windowSize: number): TurnRun | null {
	const total = rows.length;
	if (total <= windowSize) return null;
	const top = total - windowSize;
	return (
		runsOf(rows).find(
			(run) => run.openingIndex <= top && top <= run.endIndex,
		) ?? null
	);
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
	return windowTopRun(rows, windowSize)?.opensWithUserRow === false;
}

/**
 * The key of the run a completion walk would be walking — the CONDENSED run whose
 * head the fetched rows cut off — or null when no run needs one.
 *
 * WHY THE KEY AND NOT A COUNTER (loader-continuity 1b, per-run re-arm). The walk
 * spends its budget per RUN: a long-lived conversation settles turn after turn,
 * and each turn's bar must be able to complete itself, so a budget that reset
 * only on a session change would leave every later turn partial. `TurnRun.key` is
 * the stable identity the collapse already remembers runs by (its closing
 * answer's id, else its last row's), so it survives the head arriving and cannot
 * be confused with a raw row count.
 *
 * THE TRIGGER IS A PROPERTY OF THE BAR, NOT OF THE WINDOW EDGE (agent review
 * round 1, R1-1's sibling; QA round 1, Q-2 — the finding that the walk never
 * fired on the journal this PR exists for). The first cut asked
 * `windowTopRunIsHeadCut(rows, windowSize)`, which is `null` in two states that
 * are not "nothing is cut": a list SHORTER than the window (`total <=
 * windowSize` mounts everything, so there is no edge to land anywhere), and an
 * edge sitting exactly on a run's own opening row. Measured on the operator's
 * real-shape journal at the restored fixture: the first page lands 55 rows, the
 * window is 60, the edge query is null, and the bar read `30 actions` of 423 for
 * as long as the reader sat still — the reported symptom, unfixed.
 *
 * The honest question is the one the bar itself answers: is there a run whose bar
 * is PAINTED and whose opening user row is not in the store? Only the OLDEST run
 * of the list can be cut — pages load tail-first and contiguously, so every later
 * run opens with its own user row — and `collapsePlan` is the same function the
 * render paints from, so "condensed" here cannot disagree with what the reader
 * sees. `options.live`/`openRuns` are passed straight through for the same
 * reason: the newest run while a turn is being written never collapses, and a
 * head-cut run the reader has OPEN paints its rows (its bar is a header, not a
 * partial statement) — neither owes a walk.
 */
export function alignWalkRunKey(
	rows: Row[],
	options: { live: boolean; openRuns?: ReadonlySet<string> },
): string | null {
	return alignWalkRunFromPlan(
		collapsePlan(rows, { live: options.live, openRuns: options.openRuns }),
		options.openRuns,
	);
}

/**
 * The same question, asked of a plan the caller ALREADY holds (UI perf audit
 * A3). The completion walk's effect ran on every transcript update and paid a
 * second `collapsePlan` over the whole store to ask it; the render already
 * builds the plan it paints from, so the consumer derives the key from THAT plan
 * and the effect keys on the resulting string instead of on the row array — a
 * flush that moves no run the plan can see no longer re-runs the walk's effect.
 *
 * Split from `alignWalkRunKey` rather than replacing it: the row-taking form
 * stays the one place a row list is turned into the question, so the two
 * callers cannot drift into two opinions about which run owes a walk.
 */
export function alignWalkRunFromPlan(
	plan: CollapsePlan,
	openRuns?: ReadonlySet<string>,
): string | null {
	const cut = plan.runs.find(
		(run) =>
			!run.run.opensWithUserRow &&
			// THE RUN, not one bar: a head-cut run can hold several (a pinned row at
			// its loaded edge splits the first span), and the walk exists to bring in
			// the run's head whichever bar states the partial figure. A run whose every
			// condensed bar the reader has OPEN paints its rows, so its bars are
			// headers rather than partial statements (the `openRuns` treatment
			// `paintedRows` gives them) and owes no walk.
			run.segments.some(
				(segment) => segment.collapsed && !openRuns?.has(segment.key),
			),
	);
	return cut?.key ?? null;
}

/**
 * The walk key a RENDER may act on: the plan's cut-run key, confirmed against
 * the store (agent review round 1, R1).
 *
 * `plan` is built over `visible` - the MOUNTED window, a suffix of the store -
 * so its leading run can read `opensWithUserRow: false` for a reason that is not
 * the store's: a settled run TALLER than the snap's completed-run allowance
 * keeps the ordinary snap, so the raw window edge sits inside it and the plan
 * sees a run whose opening row it cannot show, while the STORE holds that run
 * whole. The walk's own question is "a run whose opening user row is not in the
 * STORE", and only the store can answer it. So the plan's key stands only when
 * the store's run under the SAME edge (the plan's window top) is head-cut too,
 * and names the same run. A null `storeTopRun` means the window covers the whole
 * list, and then the plan IS the store's own view - it needs no second opinion.
 *
 * The caller passes the run rather than the rows on purpose (review round 2,
 * R2-2): the snap above needs the same run, so one `windowTopRun` serves both and
 * the render pays no second whole-store partition.
 *
 * Without this the walk fetched up to `ALIGN_WALK_MAX_PAGES` pages for a run it
 * could never help: a prepend shifts the edge and the run's opening row equally,
 * so `extra` stays past the allowance and the snap still refuses (the same
 * reasoning `WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA` exists for).
 */
export function alignWalkRunKeyConfirmed(
	plan: CollapsePlan,
	/** The store's run under the window's top edge (`windowTopRun`), or null when
	 * the window covers the whole list. */
	storeTopRun: TurnRun | null,
	openRuns?: ReadonlySet<string>,
): string | null {
	const key = alignWalkRunFromPlan(plan, openRuns);
	if (key === null) return null;
	if (storeTopRun === null) return key;
	return !storeTopRun.opensWithUserRow && storeTopRun.key === key ? key : null;
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
 * with the window the component actually mounts. `completedRunMaxExtra` is
 * required for the same reason and is the one that BIT (agent review round 1,
 * R1-1): the completed-run allowance was added to the RENDER's snap and not to
 * this derivation, so a complete run whose opening lay 301-720 rows above the
 * raw edge was mounted whole (render painted 2 of 501) while this metric said 1
 * — and the widen then walked its whole bound for a painted delta of zero. The
 * two bounds travel together or the count is not the reader's currency.
 */
export function paintedRows(
	rows: Row[],
	windowSize: number,
	options: {
		step: number;
		live?: boolean;
		openRuns?: ReadonlySet<string>;
		/**
		 * The reader's transcript display mode (issue #756; agent review round 1, M1,
		 * and QA round 1's Q1 -- the same finding, from the other instrument).
		 * Threaded VERBATIM into the `collapsePlan` below, for the same reason
		 * `completedRunMaxExtra` above is required: this count is the widen's currency,
		 * and a currency the render does not use is not the reader's. The plan's mode
		 * is optional and absent means `by-turn`, so leaving it off would make a
		 * `by-response` render's narration rows read as hidden here while the reader
		 * looks straight at them -- the metric under-reporting the paint by exactly the
		 * rows the mode keeps, which is what let the widen step past the size that
		 * actually revealed a window. Omitted is the shipped `by-turn` condensation,
		 * byte for byte.
		 */
		mode?: TranscriptDisplayMode;
		snapMaxExtra: number;
		completedRunMaxExtra: number;
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
		options.completedRunMaxExtra,
		options.live ?? false,
	);
	const visible = total > alignSize ? rows.slice(total - alignSize) : rows;
	const plan = collapsePlan(visible, {
		live: options.live ?? false,
		openRuns: options.openRuns,
		/*
		 * The reader's own mode, passed straight through: this function has no rule of
		 * its own about what a mode means (see the option's doc).
		 */
		mode: options.mode,
	});
	let hidden = 0;
	for (const run of plan.runs) {
		for (const segment of run.segments) {
			/*
			 * An OPEN bar paints the rows it hides - the render mounts the bar's
			 * children when `open` is set - so they are not hidden for this count, the
			 * same treatment the component gives it. Counted per SEGMENT because a run
			 * can hold several bars and the reader opens them one at a time.
			 */
			if (segment.collapsed && !options.openRuns?.has(segment.key)) {
				hidden += segment.rows.length;
			}
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
 * Start at `mountedSize + step` and keep stepping while the snapped window's
 * painted rows have not grown by `minVisibleRows` (default 8: about half a
 * viewport of ordinary rows, and the smallest reveal a reader can be said to
 * have been shown), stopping at `maxRows` or the transcript. The result is what
 * `widen()` in the transcript commits, so ONE gesture still reveals at most one
 * window — the operator's "it keeps loading in chunks" loop stays closed — but
 * the window it reveals is one with something in it.
 *
 * THE BASELINE IS THE MOUNTED WINDOW (`mountedSize`), NOT the raw `windowSize`
 * the step is committed against (agent review round 1, R1-1). The snap can mount
 * more than the raw size — up to the completed-run allowance — so measuring from
 * the raw number compared two sizes the reader was not looking at: with the raw
 * window at 60 and the mount at 501, every candidate in the search snapped back
 * to the same 501 rows and the function reported a painted delta of zero for a
 * search that ended on the size the mount already had. The caller passes the
 * size it mounts (`alignSize` in the transcript), which is exactly the quantity
 * `paintedRows` models.
 *
 * A MEASURED LIMIT worth stating where the arithmetic lives: for a run that is
 * COLLAPSED and complete, `paintedRows` legitimately does not move with the
 * window — the bar hides what the window adds — so a widen over one walks to its
 * bound and lands on it. That is not the metric failing (the reader is looking at
 * a bar whose text is already complete, and the completed-run snap mounts that
 * run at open); it is the case this function is not for. What it must never do is
 * report a delta for a window the render did not mount, and with both bounds
 * threaded through it no longer can.
 */
export function widenTarget(
	rows: Row[],
	mountedSize: number,
	options: {
		step: number;
		minVisibleRows?: number;
		maxRows?: number;
		live?: boolean;
		openRuns?: ReadonlySet<string>;
		/**
		 * The reader's display mode, forwarded to `paintedRows` unchanged (M1/Q1). It
		 * is declared here so a caller cannot narrow the search's currency to a mode
		 * the render is not painting in -- the stop is a statement about what the
		 * READER sees, and the mode decides which rows those are. Omitted is the
		 * shipped `by-turn`.
		 */
		mode?: TranscriptDisplayMode;
		snapMaxExtra: number;
		completedRunMaxExtra: number;
	},
): number {
	const total = rows.length;
	const minVisibleRows = options.minVisibleRows ?? 8;
	const maxRows = Math.min(total, options.maxRows ?? total);
	const { step } = options;
	/*
	 * The snap is idempotent on an already-snapped size, so this is the mounted
	 * count in the same currency the candidates below are measured in.
	 */
	const before = paintedRows(rows, mountedSize, options);
	/*
	 * `live` and `openRuns` are passed straight through to `paintedRows`: a run
	 * the reader has OPEN paints its rows, and a run still being written is never
	 * collapsed, so a widen must count them as painted or it would overshoot for
	 * a reader who had expanded the very run in the way.
	 */
	let size = Math.min(maxRows, mountedSize + step);
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

/**
 * What the walk remembers, and WHOSE walk it was.
 *
 * The run is part of the state rather than a side ref because the budget is a
 * fact about a run: `key` names the head-cut run the count belongs to, and every
 * consumer reads the pair together. A conversation that outlives its walk is the
 * reason (`alignWalkRunKey`): a later settled turn must be able to complete
 * itself, and the walk for ITS run starts from zero.
 */
export type AlignWalkState = {
	/** `TurnRun.key` of the run this budget belongs to, or null when none is cut. */
	key: string | null;
	/** Pages spent on that run, bounded by `ALIGN_WALK_MAX_PAGES`. */
	spent: number;
	/** That run's walk saw a page that did not apply. */
	halted: boolean;
};

export const initialAlignWalkState = (): AlignWalkState => ({
	key: null,
	spent: 0,
	halted: false,
});

/**
 * Point the memory at the run that owes a walk, resetting only when the run
 * CHANGES.
 *
 * A null key (no head-cut run under the window edge) leaves the memory
 * untouched rather than clearing it: a run's budget is spent once, and a window
 * that momentarily sits elsewhere — the reader scrolls down, a page lands — must
 * not hand the same run a second walk. A DIFFERENT key is a different run, and it
 * starts with a full budget (and a clean `halted`, because one run's failure says
 * nothing about another's).
 */
export function alignWalkStateFor(
	state: AlignWalkState,
	key: string | null,
): AlignWalkState {
	if (key === null || key === state.key) return state;
	return { key, spent: 0, halted: false };
}

/** The span's gap tier: see the comment at its one call site. */
function segmentGap(first: Row, precededByVisibleRow: boolean): Row["gap"] {
	/*
	 * A bar that follows a VISIBLE row (a pinned marker, a previous bar's answer)
	 * is a block boundary of its own, so it takes the block step rather than the
	 * ledger's hairline: built against its old neighbour - often a tool row that
	 * has collapsed - its first hidden row arrives at the trace tier, which would
	 * leave the bar hugging the marker above it by 2px. The bar that follows the
	 * opening user row keeps that row's turn gap (the shipped rule).
	 */
	return precededByVisibleRow && first.gap === "trace" ? "item" : first.gap;
}

function factsOf(
	rows: readonly Row[],
	options: {
		partial: boolean;
		/** Whether the span's own head is loaded (see the duration's gate below). */
		headLoaded: boolean;
	},
): TurnSummaryFacts {
	const actions: FoldableAction[] = [];
	let failed = 0;
	let firstFailedId: string | null = null;
	for (const row of rows) {
		if (row.record.kind !== "tool") continue;
		const failedHere = isFailedCall(row.record);
		actions.push({ name: ledgerName(row.record), failed: failedHere });
		if (failedHere) {
			failed += 1;
			firstFailedId ??= row.record.id;
		}
	}
	const worked = workedSeconds(rows);
	return {
		/*
		 * Shown iff the span's calls reported at least a second - never a `0s`
		 * claim (§4.4) - AND the span's head is REAL: a head-cut span holds only the
		 * rows that happen to be loaded, so a sum over them is a fragment of the
		 * turn's work stated as if it were the turn's (the honesty half of the
		 * end-loaded rule, the same reason its count carries `+`).
		 */
		durationS:
			options.headLoaded && worked !== null && worked >= 1 ? worked : null,
		actions: actions.length,
		/*
		 * The count is a MINIMUM for exactly the reason the duration is absent: the
		 * rows above the loaded span are unknown, so `actions.length` is what has
		 * been LOADED of this turn. The bar says so (`N+ actions`).
		 */
		partial: options.partial,
		failed,
		firstFailedId,
		title: actions.length > 0 ? foldSummary(actions) : null,
	};
}

/**
 * The index (in the run's record list) of the last row the reader has seen
 * SETTLE - everything up to and including it is finished work - or -1 when the
 * run has none (a first turn that has not answered yet: all of it is in flight).
 *
 * THREE KINDS OF ROW SETTLE, and the largest index wins:
 *
 * - a CLOSE of a cycle (`cyclesOf`: an assistant row with no step after it before
 *   the next trigger), except one the provider declared `stopReason: "toolUse"`.
 *   That is the lead-in frame: its prose settles a moment BEFORE its own tool row
 *   paints, and for that moment it is the run's last row, which `cyclesOf` reads
 *   as a close. Treating it as one would condense the cycle's work, then
 *   un-condense it the instant the call arrives - the flip this function exists
 *   to prevent. Absent or any other declaration counts as settled (the
 *   unknown-is-absent rule the segments module states for
 *   `reportsCompletedThought`);
 * - a TERMINAL marker (`isTerminalMarker`: `Stopped with an error`, `Interrupted`,
 *   the `closed` / `retired` receipts, a session incident). A turn that ended in
 *   one has no assistant close at all, so reading only closes left it "all in
 *   flight" the moment a wake or peer message re-opened the run - the operator's
 *   complaint, in the shape of an interrupted or failed turn. It is the segments
 *   module's own boundary vocabulary, not a second list;
 * - an assistant row the provider declared FINISHED (`reportsCompletedThought`).
 *   `partitionRun` already keeps such a row on screen as a settled thing (V4), and
 *   it is not always a close: the todo guardrail re-enters the loop after a
 *   `stop` yield, so `[U T T A(stop) T]` has tool work after it and no new trigger,
 *   which `cyclesOf` reads as narration. Without this clause the idle plan
 *   (`U T T A`) condensed the first span and the live plan (`U T T A T`) drew it
 *   in place again - the same flip, with no wake in it.
 */
function settledCloseOf(
	records: readonly TranscriptRecord[],
	cycles: readonly TurnCycle[],
): number {
	let settled = -1;
	for (let i = cycles.length - 1; i >= 0; i -= 1) {
		const close = records[cycles[i].closeIndex];
		if (close.kind === "assistant" && close.stopReason === "toolUse") continue;
		settled = cycles[i].closeIndex;
		break;
	}
	for (let i = records.length - 1; i > settled; i -= 1) {
		const record = records[i];
		if (
			isTerminalMarker(record) ||
			(paintsSomething(record) && reportsCompletedThought(record))
		) {
			return i;
		}
	}
	return settled;
}

function planRun(
	rows: Row[],
	run: TurnRun,
	live: boolean,
	focusHold: string | null,
	openRuns: ReadonlySet<string>,
	/*
	 * The reader's display mode, threaded straight through to `partitionRun` and
	 * nowhere else: this function owns the key rule, the live split and the stamp,
	 * none of which a mode may move, so it neither reads nor reinterprets the
	 * value. See `collapsePlan`'s option for why the plan keeps no rule of its own.
	 */
	mode?: TranscriptDisplayMode,
): RunCollapsePlan {
	const runRows = rows.slice(run.openingIndex, run.endIndex + 1);
	const records = runRows.map((row) => row.record);
	/*
	 * The span starts just after the opening USER row - or at the list's own
	 * beginning for a run whose head is cut off, where the first row is simply
	 * the oldest one loaded and nothing before it is knowable. A head-cut run
	 * CAN collapse (the end-loaded rule), which is exactly why the duration gate
	 * refuses to read `start` there: this position is the loaded span's edge, not
	 * the turn's own beginning.
	 */
	const from = run.opensWithUserRow ? 1 : 0;
	const partition = partitionRun(records, {
		from,
		paints: paintsSomething,
		isStatement: isStatementRow,
		pinned: staysVisibleWhileCollapsed,
		mode,
	});
	const answerAt = partition.answer?.closeIndex ?? null;
	const answerId = answerAt === null ? null : records[answerAt].id;

	/* The pre-answer span nearest the answer carries the turn's one stamp. */
	let nearest = -1;
	partition.segments.forEach((span, i) => {
		if (answerAt === null || span.to < answerAt) nearest = i;
	});

	const preAnswerCount = partition.segments.filter(
		(span) => answerAt === null || span.to < answerAt,
	).length;
	const collapsible =
		partition.segments.length > 0 &&
		(run.opensWithUserRow || run.closingAnswerId !== null);
	/*
	 * Rows at or after this index belong to the cycle still being written; -1
	 * means nothing is in flight (the pane is not live), so every span may condense.
	 */
	const liveFrom = live ? settledCloseOf(records, partition.cycles) + 1 : -1;

	const segments: SegmentPlan[] = partition.segments.map(
		(span: SegmentSpan, i): SegmentPlan => {
			const segRows = runRows.slice(span.from, span.to + 1);
			const afterAnswer = answerAt !== null && span.from > answerAt;
			/* The key's rule (and the aliasing it prevents) is `SegmentPlan.key`'s. */
			const key = `seg:${
				afterAnswer
					? segRows[0].record.id
					: (runRows[span.to + 1] ?? segRows[segRows.length - 1]).record.id
			}`;

			/*
			 * A span whose head is the loaded edge (the head-cut run's first span) states
			 * no duration; every other span states the worked time of ITS OWN rows, so
			 * the pre-answer bars add up to the foot's figure.
			 */
			const headLoaded = !(span.from === 0 && !run.opensWithUserRow);

			const label = labelOfSegment(records, partition.cycles, span);
			const collapsedHere =
				collapsible &&
				(liveFrom < 0 || span.to < liveFrom) &&
				!(
					focusHold !== null &&
					!openRuns.has(key) &&
					segRows.some((row) => row.record.id === focusHold)
				);
			return {
				key,
				rows: segRows,
				firstId: segRows[0].record.id,
				segmentIds: segRows.map((row) => row.record.id),
				gap: segmentGap(segRows[0], span.from > from),
				afterAnswer,
				label,
				completed: segmentIsCompleted(
					records,
					partition.cycles,
					span,
					answerAt,
					label !== null,
				),
				collapsed: collapsedHere,
				stampTs:
					i === nearest && answerAt !== null && preAnswerCount === 1
						? records[answerAt].ts
						: null,
				facts: factsOf(segRows, { partial: !headLoaded, headLoaded }),
			};
		},
	);

	/* The turn's own totals: the run through its answer, commentary excluded. */
	const turnRows = answerAt === null ? runRows : runRows.slice(0, answerAt + 1);
	const hidden = segments.flatMap((segment) => segment.rows);
	return {
		key: run.key,
		run,
		/*
		 * A bar renders iff there is something to hide, this is not the run a live
		 * turn is being written in, and the run can be honestly summarised: its
		 * opening user row is on hand, OR its closing answer is (the end-loaded
		 * rule - the bar then describes exactly the loaded span; see the header).
		 * The focus hold is applied per segment above.
		 */
		collapses: segments.some((segment) => segment.collapsed),
		recordIds: runRows.map((row) => row.record.id),
		hidden,
		gap: segments[0]?.gap ?? "item",
		facts: factsOf(turnRows, {
			partial: !run.opensWithUserRow,
			headLoaded: run.opensWithUserRow,
		}),
		answerId,
		stampTs: answerAt === null ? null : records[answerAt].ts,
		segments,
	};
}
