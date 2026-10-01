/**
 * The reader's expanded turn summaries, per conversation.
 *
 * WHY THIS EXISTS OUTSIDE THE COMPONENT. A bar's React identity is its run's
 * key (`TurnRun.key`: the opening user row when it is loaded), and that row legitimately leaves and re-enters the render
 * window while the reader scrolls (the transcript mounts only the newest
 * `WINDOW` rows, and the edge walks). Component-local `useState` would lose the
 * reader's expansion on the scroll back, and the transcript component itself
 * must survive a session switch without dropping it — so the state lives here,
 * keyed by conversation, exactly as the paint cache (`paint-cache.ts`) keeps
 * its per-conversation rows for the renderer's lifetime.
 *
 * WHAT IT IS NOT: not reload-persistent. A reload returns to the shipped
 * default (collapsed) — the confirmed design's choice (`turn-summary` bars
 * arrive collapsed; expansion persistence would be a ui-preferences-shaped
 * follow-up). And not unbounded: the same reasoning the paint cache states for
 * its byte bound applies to a growing map of sets, so the store keeps the
 * most-recently-written sessions and drops whole conversations beyond the cap
 * rather than accumulating one entry per conversation ever opened.
 */

/**
 * Conversations whose expansions are remembered, most recently written last.
 *
 * Eight because the map holds a few run ids per conversation — bytes, not the
 * paint cache's megabytes — and the value of the store is entirely in
 * surviving a scroll or a switch BACK; eight covers "the handful of
 * conversations a reader is switching between" and makes a leak impossible.
 * Exceeding it evicts the least recently written conversation, whose bars
 * simply arrive collapsed again.
 */
const MAX_SESSIONS = 8;

/**
 * Runs remembered per conversation.
 *
 * A conversation expands a bar at a time; a hundred is already far past any
 * real reading session, and the cap exists so a synthetic transcript (a rig,
 * a test) cannot grow one entry without bound. Oldest-inserted goes first.
 */
const MAX_RUNS_PER_SESSION = 128;

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The key a null session (stories, the child reader without one) shares.
 *
 * The transcript reads `frontend?.session_id ?? null`; a story or an
 * unattached pane is still one conversation on screen, so it gets one bucket
 * rather than being unstateful — which is also what lets a Storybook press
 * behave like a real one.
 */
const NO_SESSION = "";

const store = new Map<string, Set<string>>();

const keyOf = (sessionId: string | null): string => sessionId ?? NO_SESSION;

/** The runs the reader has expanded in this conversation. Treat as immutable. */
export function expandedRunsOf(sessionId: string | null): ReadonlySet<string> {
	return store.get(keyOf(sessionId)) ?? EMPTY;
}

/**
 * Record the reader's expansion of one run, and return the new readable set.
 *
 * Copy-on-write: the caller puts the returned set in React state, so a render
 * can read a stable identity per write. Re-inserting the SESSION on every
 * write is deliberate (a `Map` preserves insertion order, so the cap evicts
 * the conversation least recently touched — the same eviction-order rule the
 * paint cache documents).
 */
export function writeRunExpanded(
	sessionId: string | null,
	runKey: string,
	open: boolean,
): ReadonlySet<string> {
	const key = keyOf(sessionId);
	const current = store.get(key) ?? new Set<string>();
	const next = new Set(current);
	if (open) {
		// Delete before add so the key is re-inserted at the set's end: the
		// per-session cap's eviction order is then "the oldest expansion", not
		// "whichever id happened to be added first at insert time".
		next.delete(runKey);
		next.add(runKey);
		while (next.size > MAX_RUNS_PER_SESSION) {
			const oldest = next.values().next().value;
			if (oldest === undefined) break;
			next.delete(oldest);
		}
	} else {
		next.delete(runKey);
	}
	store.delete(key);
	if (next.size > 0) store.set(key, next);
	while (store.size > MAX_SESSIONS) {
		const oldest = store.keys().next().value;
		if (oldest === undefined) break;
		store.delete(oldest);
	}
	return store.get(key) ?? EMPTY;
}

/**
 * Re-state the reader's expansions under new keys, and return the new set.
 *
 * WHY (the run identity change, `TurnRun.key`): a run's key moves once, when the
 * head of a head-cut run lands, and the expansion the reader made before that must
 * follow it. `rewrite` maps each stored key to the key it should have (identity for
 * keys it does not know, which is the stale-key rule: left alone, they match no
 * bar). Order is preserved so the per-session cap still evicts the oldest
 * expansion first, and nothing is written when nothing changed, so a caller can
 * run this on every commit without churning the set's identity.
 */
export function rewriteRunExpanded(
	sessionId: string | null,
	rewrite: (runKey: string) => string,
): ReadonlySet<string> {
	const key = keyOf(sessionId);
	const current = store.get(key);
	if (current === undefined) return EMPTY;
	let changed = false;
	const next = new Set<string>();
	for (const runKey of current) {
		const moved = rewrite(runKey);
		if (moved !== runKey) changed = true;
		next.add(moved);
	}
	if (!changed) return current;
	store.set(key, next);
	return next;
}

/** Forget one conversation. The sibling of `dropPaint`, for the same events. */
export function forgetTurnCollapseOpen(sessionId: string | null): void {
	store.delete(keyOf(sessionId));
}

/** Drop everything. Test-only; nothing in the app needs to empty the store. */
export function __resetTurnCollapseOpen(): void {
	store.clear();
}

/** Introspection for tests: how many conversations and run ids are held. */
export function __turnCollapseOpenStats(): {
	sessions: number;
	runs: number;
} {
	let runs = 0;
	for (const set of store.values()) runs += set.size;
	return { sessions: store.size, runs };
}
