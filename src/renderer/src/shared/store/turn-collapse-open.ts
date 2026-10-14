/**
 * The reader's expanded turn summaries, per conversation.
 *
 * WHY THIS EXISTS OUTSIDE THE COMPONENT. A bar's identity is its span's anchor
 * row (`SegmentPlan.key` in `turn-collapse-model.ts`), and a bar legitimately
 * leaves and re-enters the render window while the reader scrolls (the
 * transcript mounts only the newest `WINDOW` rows, and the edge walks).
 * Component-local `useState` would lose the reader's expansion on the scroll
 * back, and the transcript component itself must survive a session switch
 * without dropping it — so the state lives here, keyed by conversation, exactly
 * as the paint cache (`paint-cache.ts`) keeps its per-conversation rows for the
 * renderer's lifetime.
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

export type InternalEpisodeIdentity = {
	key: string;
	segmentIds: readonly string[];
	eligible?: boolean;
};
/** Disclosure keys are bounded by reader ownership, NOT episode ordinals. */
export const INTERNAL_IDENTITY_MAX_EPISODES = 128;
export const INTERNAL_IDENTITY_MAX_IDS = 4096;
export type InternalEpisodeIdentitySnapshot = {
	complete: boolean;
	owners: ReadonlyMap<string, { ordinal: number; order: number }>;
	keys: ReadonlyMap<number, string>;
	reason: string | null;
};
const emptyIdentity = (
	reason: string | null,
): InternalEpisodeIdentitySnapshot => ({
	complete: reason === null,
	owners: new Map(),
	keys: new Map(),
	reason,
});
const isEpisodeKey = (key: string) => key.startsWith("qg:") && key.length > 3;

/**
 * Retain COMPLETE previous ID ownership, including unheld/ineligible groups,
 * so an unheld neighbor cannot disappear from merge exclusion evidence. Only
 * <=128 existing OPEN keys (+one transient focused child) are retained. This
 * metadata never writes/refreshes disclosure LRU. >4096 IDs discards the WHOLE
 * snapshot: keeping an older smaller one would falsely certify later overlap.
 *
 * This is only a bounded overlap improvement, NOT a topology transition
 * certificate. Oversized previous groups, source head loss and same-ID field
 * reclassification remain gate-blocking. No body, epoch or label proves them.
 */
export function captureInternalEpisodeIdentity(
	episodes: readonly InternalEpisodeIdentity[],
	openKeys: ReadonlySet<string>,
	focusedId: string | null = null,
	allCurrentIds: Iterable<string> = [],
): InternalEpisodeIdentitySnapshot {
	const owners = new Map<string, { ordinal: number; order: number }>();
	const keys = new Map<number, string>();
	for (let ordinal = 0; ordinal < episodes.length; ordinal += 1) {
		const episode = episodes[ordinal];
		for (let order = 0; order < episode.segmentIds.length; order += 1) {
			const id = episode.segmentIds[order];
			if (owners.has(id)) return emptyIdentity("duplicate-prior-id");
			if (owners.size === INTERNAL_IDENTITY_MAX_IDS)
				return emptyIdentity("prior-id-limit");
			owners.set(id, { ordinal, order });
		}
		if (
			episode.eligible !== false &&
			isEpisodeKey(episode.key) &&
			openKeys.has(episode.key) &&
			keys.size < INTERNAL_IDENTITY_MAX_EPISODES
		)
			keys.set(ordinal, episode.key);
	}
	// Visible pinned records are exclusion evidence, not candidate disclosures.
	// IDs already owned by a segment are expected in this second projection.
	for (const id of allCurrentIds) {
		if (owners.has(id)) continue;
		if (owners.size === INTERNAL_IDENTITY_MAX_IDS)
			return emptyIdentity("prior-id-limit");
		owners.set(id, { ordinal: -1, order: -1 });
	}
	const focusOwner = focusedId === null ? undefined : owners.get(focusedId);
	if (focusOwner !== undefined && focusOwner.ordinal >= 0) {
		const episode = episodes[focusOwner.ordinal];
		if (episode.eligible !== false && isEpisodeKey(episode.key))
			keys.set(focusOwner.ordinal, episode.key);
	}
	return { complete: true, owners, keys, reason: null };
}

/**
 * Stream ALL current segments; retain no N-sized current owner index. Prior
 * ordinals may exceed128 because their complete IDs still fit4096. Generic
 * arrays use bounded duplicate checking and refuse >4096 unless the caller's
 * existing canonical projection supplies uniqueness authority. That authority
 * is ONLY current-ID uniqueness, never historical segmentation/topology proof.
 * Matched duplicates and key collisions are rejected even with that authority.
 */
export function retainInternalEpisodeKeys<T extends InternalEpisodeIdentity>(
	previous: InternalEpisodeIdentitySnapshot,
	current: readonly T[],
	options: {
		currentIdsUnique?: boolean;
		/** Already-visible records outside candidate segments detect reclassification. */
		outsideCurrentIds?: Iterable<string>;
	} = {},
): { episodes: T[]; reason: string | null } {
	const refuse = (reason: string) => ({ episodes: [...current], reason });
	if (!previous.complete) return refuse(previous.reason ?? "incomplete-prior");
	if (previous.owners.size > INTERNAL_IDENTITY_MAX_IDS)
		return refuse("prior-id-limit");
	const matched = new Set<string>(); // <=P, never all current IDs
	const genericSeen =
		options.currentIdsUnique === true ? null : new Set<string>();
	const state = new Map<
		number,
		{
			current: number;
			many: boolean;
			lastOrder: number;
			reordered: boolean;
			outside: boolean;
		}
	>();
	const candidates = new Map<number, { owner: number; key: string }>(); // <=H
	const touch = (owner: number, at: number, order: number) => {
		const prior = state.get(owner);
		if (prior === undefined)
			state.set(owner, {
				current: at,
				many: false,
				lastOrder: order,
				reordered: false,
				outside: false,
			});
		else {
			if (prior.current !== at) prior.many = true;
			if (order <= prior.lastOrder) prior.reordered = true;
			prior.lastOrder = order;
		}
	};
	for (let at = 0; at < current.length; at += 1) {
		const episode = current[at];
		let incoming: number | null = null;
		let multiple = false;
		for (const id of episode.segmentIds) {
			if (genericSeen !== null) {
				if (genericSeen.has(id)) return refuse("duplicate-current-id");
				if (genericSeen.size === INTERNAL_IDENTITY_MAX_IDS)
					return refuse("current-uniqueness-unproved");
				genericSeen.add(id);
			}
			const old = previous.owners.get(id);
			if (old === undefined) continue;
			if (matched.has(id)) return refuse("duplicate-current-id");
			matched.add(id);
			touch(old.ordinal, at, old.order);
			if (incoming === null) incoming = old.ordinal;
			else if (incoming !== old.ordinal) multiple = true;
		}
		if (
			episode.eligible === false ||
			multiple ||
			incoming === null ||
			incoming < 0
		)
			continue;
		const key = previous.keys.get(incoming);
		if (key !== undefined) candidates.set(at, { owner: incoming, key });
	}
	for (const id of options.outsideCurrentIds ?? []) {
		const old = previous.owners.get(id);
		if (old === undefined || matched.has(id)) continue;
		const group = state.get(old.ordinal);
		if (group !== undefined) group.outside = true;
	}
	for (const [at, candidate] of candidates) {
		const group = state.get(candidate.owner);
		// A qg suffix is an opaque canonical anchor (colons inside are retained).
		// If it truly vanished, surviving tail witnesses cannot prove head loss.
		const anchor = candidate.key.slice(3);
		if (
			group === undefined ||
			group.many ||
			group.reordered ||
			group.outside ||
			!matched.has(anchor)
		)
			candidates.delete(at);
	}
	const held = new Set(previous.keys.values());
	const projectedOwners = new Set<string>(); // <=H; unrelated keys are not retained
	for (let at = 0; at < current.length; at += 1) {
		const key = candidates.get(at)?.key ?? current[at].key;
		if (!held.has(key)) continue;
		if (projectedOwners.has(key)) return refuse("key-collision");
		projectedOwners.add(key);
	}
	return {
		episodes: current.map((item, at) => {
			const candidate = candidates.get(at);
			return candidate === undefined ? item : { ...item, key: candidate.key };
		}),
		reason: null,
	};
}
