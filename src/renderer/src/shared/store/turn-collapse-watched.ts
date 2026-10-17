/**
 * THE SETTLE LATCH: the run each conversation's pane has WATCHED live.
 *
 * WHY THIS EXISTS OUTSIDE THE COMPONENT. The model's `watchedRunId` option
 * (`turn-collapse-model.ts`) anchors a watched run's settledness reading against
 * liveness flips, and the flips this answers - the runtime's `frontend.streaming`
 * dipping at tool-segment boundaries while the turn is mid-flight - arrive while
 * the transcript is mounted and keep arriving across a session switch back.
 * Component-local state would reset on the switch and hand the reader a fold the
 * moment they came back; the latch therefore lives in a store keyed by
 * conversation, exactly as the reader's expansions (`turn-collapse-open.ts`) and
 * the paint cache (`paint-cache.ts`) do.
 *
 * WHAT IT HOLDS. Per conversation, the id of the newest run's LEADING VISIBLE
 * ROW while `live` was true - the run's opening row when the window covered it,
 * the cut edge when the window cut its head (the model's read is containment
 * over the run's own rows, so both are carried; see `collapsePlan`'s
 * `watchedRunId` option for why the distinction is load-bearing). One string per
 * conversation, not a set: only the newest run is ever watched, and a later run
 * replaces the record wholesale.
 *
 * THE RESET SEMANTICS, stated so the model's trade is spelled out in one place:
 *
 * - a NEW RUN in the conversation replaces the latch (the pane watches the new
 *   run's first live pass and writes its id), so the previous run is no longer
 *   "watched" and its finished shape is derived as ever;
 * - a SESSION SWITCH keeps each conversation's latch under its own key - coming
 *   back to a mid-flight conversation restores the protection it had;
 * - a FRESH CONVERSATION (or a reload) holds no latch, so a finished transcript
 *   arrives collapsed exactly as today;
 * - `forgetWatchedRun` drops one conversation's entry on the same event that
 *   forgets the reader's expansions (the 404 drop in `use-canonical-session.ts`),
 *   and the session cap below evicts least-recently-written conversations so the
 *   map cannot grow.
 *
 * NOT RELOAD-PERSISTENT, deliberately: a reload is a fresh pane, and a fresh
 * pane's first read of a finished transcript is today's collapsed shape.
 */

/**
 * Conversations whose latch is remembered, most recently written last.
 *
 * The sibling cap is eight, and the reasoning transfers verbatim: the value of
 * the store is entirely in surviving a switch BACK, eight covers the handful of
 * conversations a reader is switching between, and the cap makes a leak
 * impossible. The payload is one string per conversation, so the cap is about
 * bookkeeping, not bytes.
 */
const MAX_SESSIONS = 8;

/**
 * The key a null session (stories, the child reader without one) shares.
 *
 * The transcript reads `frontend?.session_id ?? null`; a story or an unattached
 * pane is still one conversation on screen, so it gets one bucket rather than
 * being unstateful - the same rule `turn-collapse-open.ts` states.
 */
const NO_SESSION = "";

const store = new Map<string, string>();

const keyOf = (sessionId: string | null): string => sessionId ?? NO_SESSION;

/** The opening row id of the run this conversation's pane has watched, if any. */
export function watchedRunOf(sessionId: string | null): string | null {
	return store.get(keyOf(sessionId)) ?? null;
}

/**
 * Record the newest run this pane has now watched live.
 *
 * Idempotent: called on every pass that could set it rather than only on the
 * pass that changes it, so the caller needs no "has it changed" branch. The
 * delete-before-set re-inserts the session at the map's end, which is what makes
 * the cap evict the conversation least recently written - the same eviction-order
 * rule `turn-collapse-open.ts` and the paint cache document.
 */
export function writeWatchedRun(sessionId: string | null, runId: string): void {
	const key = keyOf(sessionId);
	store.delete(key);
	store.set(key, runId);
	while (store.size > MAX_SESSIONS) {
		const oldest = store.keys().next().value;
		if (oldest === undefined) break;
		store.delete(oldest);
	}
}

/** Forget one conversation. The sibling of `forgetTurnCollapseOpen`. */
export function forgetWatchedRun(sessionId: string | null): void {
	store.delete(keyOf(sessionId));
}

/** Drop everything. Test-only; nothing in the app needs to empty the store. */
export function __resetWatchedRuns(): void {
	store.clear();
}
