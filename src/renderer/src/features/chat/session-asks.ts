/**
 * One conversation's ask frame, resolved from the two reads that can answer for it.
 *
 * ## The state this module exists to remove
 *
 * A resumed conversation's DURABLE checkpoint deliberately carries no ask claim:
 * the backend's `frontend_state.py` strips `asks` and `asks_open` from the saved
 * copy, and the resumed session republishes them from the ask log on its first
 * refresh. The serializer also POPS the null fields rather than sending them
 * (`frontend_state.py:3548-3558`), so the first snapshot of a cold conversation
 * is a frame whose ask keys are ABSENT while the queue is perfectly readable
 * from the aggregate index.
 *
 * The UI used to read that frame as a capability answer (`ask-queue.ts`'s
 * `askQueuePublished` is false), and a false `published` is the one shape the
 * drawer words as "This runtime doesn't support queued asks." The operator's
 * screenshot is exactly that: "Asks unavailable" on a conversation whose asks
 * were sitting in the index the whole time. Measured on a copied real session
 * with 20 ask rows in the index (no currently-open row at copy time; QA seeds
 * open rows through the store's own append+fold for the visual leg): core emits
 * `open` at 1,457 ms and the snapshot at 1,465 ms with both ask fields absent,
 * and no ask-bearing update follows within 15 s - while `GET /v1/desktop/asks`
 * answers in 6 ms from the derived index, with no session opened and no runtime
 * dialled.
 *
 * ## Two sources, one frame, three answers
 *
 * The canonical frame is the authority whenever it makes a claim: an `asks`
 * array (including an empty one - the wire fix publishes a live-but-empty queue
 * as `asks` absent with `asks_open: 0`, so an array is a list and a zero tally
 * is a count) or an `asks_open` tally. When it does not, the AGGREGATE answers
 * instead: `/v1/desktop/asks` is the index-backed read, uncapped ACROSS
 * conversations and runtime-free, and its rows name their own `session_id`, so
 * the session's slice is a filter rather than a second source. Each
 * conversation's entry is its own fold projection, capped - see
 * {@link ASK_AGGREGATE_SESSION_CAP}.
 *
 * The third answer is the absence of both reads, and the split inside it is the
 * whole point:
 *
 *  - the aggregate has not answered yet (loading, retrying, or a transport
 *    failure): return `null`, which every reader already words as "Reading the
 *    asks…". THE UNAVAILABLE COPY IS UNREACHABLE HERE WHILE A READ IS PENDING;
 *  - the aggregate route itself is ABSENT (a 404 from a backend that predates
 *    it) AND the session's own frame has answered (claimless): return the
 *    resolved claimless frame `{asks: null, asks_open: null}`, the one shape
 *    that may say the runtime does not support queued asks. That is a statement
 *    about the runtime, not about a read in flight, so it waits for the
 *    canonical frame as well as the 404; before that frame arrives the answer
 *    stays `null`.
 *
 * ## Why this is a function rather than an expression at the mount
 *
 * Four surfaces read one conversation's queue - the drawer, the header/rail
 * count, the composer chip, and the open policy - and the bug above was two of
 * them reading one source while the frame said nothing. Resolving once, here,
 * makes them one frame by construction; a second derivation is how they would
 * disagree again. The module is DOM-free and reads no hook, so a plain node test
 * drives every arm of the table (`scripts/session-asks.test.mjs`).
 */

import type {
	CanonicalFrontendState,
	PendingAsk,
} from "../../../../shared/desktop-session-contract";
import { askQueuePublished } from "./ask-queue";

/**
 * The three ask fields a frame carries, and the only ones this module speaks
 * about. Body-compatible with `AskDrawer`'s `frontend` prop and `askQueueView`'s
 * input, so the resolved value is handed on without a cast.
 */
export type SessionAskFrame = Pick<
	CanonicalFrontendState,
	"asks" | "asks_open" | "asks_truncated"
>;

/**
 * What the aggregate read can answer, as `useFleetAsks` publishes it.
 *
 * `capability` is the route's own three-way fact, not `isError`: a 503 from a
 * backend that is merely busy or restarting says nothing about whether the
 * route exists, and reading it as absence is the same misreading as the one
 * this module fixes, one layer up. Only a 404 is `absent`.
 */
export type SessionAskAggregateAnswer = {
	/** The aggregate's rows, or `null` while it has not answered. */
	rows: readonly PendingAsk[] | null;
	/** Whether the route answered that it does not exist (`live`/`absent`/`unknown`). */
	capability: "live" | "absent" | "unknown";
};

/**
 * How many of these rows are still WAITING on an answer.
 *
 * `status === "open"` is the one waitable state (`ask-queue.ts`'s `waiting` and
 * `canAnswer`; the rail's copy note states the same rule - a lapsed ask is
 * read-only and not counted). The aggregate always carries a `status`: it is a
 * required field of `PendingAsk`, and `index_asks` writes the backend's log fold
 * for every row. Where a malformed value did slip through, `askQueueView`
 * classifies it as `"unknown"` - not answerable - so defaulting a missing status
 * to open here would make THIS tally disagree with the rows beside it. The value
 * is only read for the rowless shape anyway: when `asks` is an array every reader
 * derives its count from the rows.
 */
const openCount = (rows: readonly PendingAsk[]): number =>
	rows.filter((row) => row.status === "open").length;

/** This session's rows, by the aggregate's own identity field. */
const rowsForSession = (
	rows: readonly PendingAsk[],
	sessionId: string,
): PendingAsk[] =>
	rows.filter(
		(row) => typeof row.session_id === "string" && row.session_id === sessionId,
	);

/**
 * The ONE ask frame a session's surfaces paint, or `null` while it is still
 * being read.
 *
 * The table, in the order the arms are checked (the first match wins):
 *
 * | canonical frame                   | aggregate            | result                          |
 * |-----------------------------------|----------------------|---------------------------------|
 * | `asks` is an array                | anything             | canonical; aggregate ignored    |
 * | tally-only, count > 0             | this session's rows  | canonical tally + those rows    |
 * | tally-only, count 0               | anything             | canonical (live-but-empty)      |
 * | claimless / absent                | rows answered        | aggregate slice (empty -> 0)    |
 * | claimless (present)               | route absent (404)   | resolved unavailable frame      |
 * | canonical not arrived yet         | route absent (404)   | `null` (still reading)          |
 * | claimless / absent                | in flight / failure  | `null` (loading)                |
 *
 * The tally-only row exists for the wire's BOUND: `_bound_asks_in_place` drops
 * the row list while deliberately keeping `asks_open`, so a frame can state a
 * count and carry no card. When the aggregate has this session's rows, the
 * cards are filled in beside the count (the count stays the frame's own - review
 * R1-2); when it does not, the tally-only frame is passed through unchanged
 * (the drawer's own `N outstanding` clause is the honest reading of it).
 */
export function resolveSessionAskFrame(
	sessionId: string | null | undefined,
	canonical: SessionAskFrame | null | undefined,
	aggregate: SessionAskAggregateAnswer,
): SessionAskFrame | null {
	if (askQueuePublished(canonical)) {
		/*
		 * AN ARRAY IS A LIST, EVEN WHEN EMPTY. A live-but-empty queue is published
		 * as `asks` ABSENT with `asks_open: 0`, so an array - `[]` included - is the
		 * frame's own table of rows and the aggregate has nothing to add to it.
		 */
		if (Array.isArray(canonical?.asks)) {
			return {
				asks: canonical.asks,
				asks_open:
					typeof canonical.asks_open === "number"
						? canonical.asks_open
						: openCount(canonical.asks),
				asks_truncated: canonical.asks_truncated ?? null,
			};
		}
		/*
		 * TALLY-ONLY. A nonzero count with rows available from the index is the
		 * bound's own state, and the rows belong to the frame that stated the count
		 * - fill them rather than making the drawer say it cannot show any. THE
		 * CANONICAL TALLY IS KEPT, not recomputed from the filled rows: the count is
		 * the frame's own statement of record (review R1-2), and the rows are a
		 * convenience beside it.
		 */
		const tally = canonical?.asks_open;
		if (typeof tally === "number" && tally > 0 && aggregate.rows !== null) {
			const mine = sessionId ? rowsForSession(aggregate.rows, sessionId) : [];
			if (mine.length > 0) return aggregateFrame(mine, tally);
		}
		return {
			asks: null,
			asks_open: typeof tally === "number" ? tally : null,
			asks_truncated: canonical?.asks_truncated ?? null,
		};
	}
	/*
	 * NO CLAIM ON THE CANONICAL FRAME - the resumed-checkpoint state, or a session
	 * whose snapshot has not arrived yet. The aggregate answers for it.
	 *
	 * No session id means no slice to take (a draft has no queue of its own), so
	 * there is nothing to resolve: `null` keeps every reader in its loading state
	 * rather than asserting an empty queue about a conversation that does not
	 * exist yet.
	 */
	if (!sessionId) return null;
	if (aggregate.rows !== null) {
		return aggregateFrame(rowsForSession(aggregate.rows, sessionId));
	}
	/*
	 * THE ONE UNSUPPORTED FRAME - and it waits for BOTH reads (review R1-1). A 404
	 * is a statement about the runtime, but the module's own rule is that no
	 * terminal claim is made while a read is pending: `canonical == null` is the
	 * stream before its first snapshot, when the drawer must keep reading. Only
	 * after the session's own frame has answered (claimless) does the route's
	 * absence become the resolved unsupported reading. A transient failure
	 * (500/503/transport) deliberately falls through to `null` below.
	 */
	if (canonical != null && aggregate.capability === "absent") {
		return { asks: null, asks_open: null, asks_truncated: false };
	}
	return null;
}

/**
 * How many rows one conversation's aggregate entry can carry.
 *
 * NOT A UI LIMIT: it is the core's own per-session projection cap. `index_asks`
 * folds each session's ask log into its index entry with `PROJECTION_CAP = 20`
 * (`local_operator/asks/queue.py:1856`) and publishes no truncation marker, and
 * the TUI treats exactly-at-cap as possibly truncated for that reason
 * (`local_operator/tui/app.py:27875-27901`: a split computed from the rows a
 * frame happens to carry would let a prefix pass for the whole queue). So a
 * slice at the cap cannot be known complete; the conservative flag costs
 * nothing here because open rows sort first (`queue.py:1846-1855`), which keeps
 * the counts the surfaces read.
 */
export const ASK_AGGREGATE_SESSION_CAP = 20;

/**
 * The aggregate's slice as a frame.
 *
 * AN EMPTY SLICE IS AN ANSWER, not an absence: it is published as `asks: null`
 * with `asks_open: 0` - the wire's own live-but-empty shape - so the drawer
 * paints its designed empty sentence instead of the unsupported one. `asks` is
 * `null` rather than `[]` only because that is how the wire spells an empty
 * queue; the siblings read both the same way (`askQueuePublished`), and the
 * distinction that matters here is vs. `null` on BOTH fields.
 *
 * `asks_open` is the caller's tally when it has one (the tally-only arm keeps
 * the canonical count), otherwise this slice's own open-row count.
 *
 * `asks_truncated` is CONSERVATIVE, not false (review R1-6): the entry is a
 * capped projection, so a slice that reaches {@link ASK_AGGREGATE_SESSION_CAP}
 * may be a prefix. Below the cap the list is the whole population and the flag
 * is false.
 */
function aggregateFrame(
	rows: readonly PendingAsk[],
	asksOpen?: number,
): SessionAskFrame {
	return {
		asks: rows.length > 0 ? [...rows] : null,
		asks_open: asksOpen ?? openCount(rows),
		asks_truncated: rows.length >= ASK_AGGREGATE_SESSION_CAP,
	};
}
