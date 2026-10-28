/**
 * The notifications reel's pure model: filters, grouping, selection plans and
 * the badge number (design.md § 2-§ 7, § 11; contract § 2.3).
 *
 * WHY PURE. The page, its stories and `scripts/notifications-model.test.mjs`
 * compose these functions, so the rules a reader relies on ("a live ask is
 * never in a bulk dismiss", "Waiting on you is always first", "a repeat row
 * dismisses all its updates") are pinned against the SHIPPED module, the
 * `sidebar-destinations.ts` pattern. Nothing here imports React or reads state.
 */
import type {
	DesktopNotificationItem,
	DesktopNotificationPriority,
	DesktopNotificationsCount,
	DesktopNotificationsList,
} from "../../../../shared/desktop-control-contract";

/** The four write verbs the cache updater understands (contract § 5.2). */
export type NotificationVerb = "read" | "unread" | "dismiss" | "undismiss";

export type NotificationKindFilter = "all" | "asks" | "updates";
export type NotificationPriorityFilter = "any" | "high" | "normal_up";
export type NotificationGrouping = "time" | "conversation";

export type NotificationFilters = {
	kind: NotificationKindFilter;
	priority: NotificationPriorityFilter;
	/** A session id, or null for every conversation. */
	from: string | null;
};

export const DEFAULT_FILTERS: NotificationFilters = {
	kind: "all",
	priority: "any",
	from: null,
};

/** Whether any filter is off its default (design § 2: drives "Clear filters"). */
export const filtersActive = (filters: NotificationFilters): boolean =>
	filters.kind !== "all" || filters.priority !== "any" || filters.from !== null;

const PRIORITY_RANK: Record<DesktopNotificationPriority, number> = {
	high: 3,
	normal: 2,
	low: 1,
};

/** Whether an item is an OPEN ask: the one source a reel dismiss never settles. */
export const isLiveAsk = (item: DesktopNotificationItem): boolean =>
	item.source === "ask" &&
	(item.ask?.status === undefined || item.ask.status === "open");

/** Apply the client-side filters over a loaded set (design § 2). */
export function filterItems(
	items: readonly DesktopNotificationItem[],
	filters: NotificationFilters,
): DesktopNotificationItem[] {
	return items.filter((item) => {
		/*
		 * A DISMISSED ROW LEAVES THE REEL (code round 8, R8-4 / Q12). The write path flips
		 * `dismissed` in the cache instead of deleting the row (so Undo is a flip back),
		 * which left it drawn once its exit animation finished - 138 rows standing after
		 * the server had dismissed all 138. The drawer already filtered this way.
		 */
		if (item.dismissed) return false;
		if (filters.kind === "asks" && item.source !== "ask") return false;
		if (filters.kind === "updates" && item.source !== "notify") return false;
		if (filters.priority === "high" && item.priority !== "high") return false;
		if (
			filters.priority === "normal_up" &&
			PRIORITY_RANK[item.priority] < PRIORITY_RANK.normal
		)
			return false;
		if (filters.from !== null && item.session.id !== filters.from) return false;
		return true;
	});
}

/**
 * How long an Undo offer stands (design § 0.8 / § 12.4: 6 s).
 *
 * In the model rather than in the page because the reel AND the transcript
 * drawer both take destructive actions and both must offer the same window
 * (design audit OD3); a constant copied into the drawer would be the second
 * spelling of one product rule.
 */
export const UNDO_WINDOW_MS = 6_000;

export type TimeBucket = "today" | "yesterday" | "week" | "older";

/** Local midnight of the day `ms` falls in. */
const startOfDay = (ms: number): number => {
	const date = new Date(ms);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
};

/**
 * The time group of an item (design § 3). Calendar days in the viewer's zone,
 * not 24-hour windows: "Yesterday" at 00:30 means the day before, which is how
 * a reader scans the list. "Earlier this week" is the six days before
 * yesterday, so the four groups partition every timestamp.
 */
export function timeBucketOf(ms: number, nowMs: number): TimeBucket {
	const today = startOfDay(nowMs);
	if (ms >= today) return "today";
	const yesterday = startOfDay(today - 1);
	if (ms >= yesterday) return "yesterday";
	const weekStart = startOfDay(yesterday - 6 * 86_400_000 + 1);
	if (ms >= weekStart) return "week";
	return "older";
}

export type NotificationGroup =
	| {
			kind: "waiting";
			key: "waiting";
			items: DesktopNotificationItem[];
	  }
	| {
			kind: "time";
			key: TimeBucket;
			items: DesktopNotificationItem[];
	  }
	| {
			kind: "conversation";
			key: string;
			sessionId: string;
			title: string;
			items: DesktopNotificationItem[];
	  };

const newestFirst = (a: DesktopNotificationItem, b: DesktopNotificationItem) =>
	b.updated_at - a.updated_at || b.seq - a.seq;

/**
 * The reel's groups, in render order.
 *
 * WAITING ON YOU IS ALWAYS FIRST, in either grouping (design § 2-§ 3): a live
 * ask is a turn that is blocked on the reader. The waiting set is the route's
 * own `waiting` array when the caller passes it, so an ask is never listed
 * twice: an id that is in `waiting` is removed from the rest.
 *
 * TIME GROUPS are Today / Yesterday / Earlier this week / Older, each newest
 * first. CONVERSATION GROUPS are one per session, sorted by each group's newest
 * item (design § 3), carrying the session id for "Dismiss all n".
 */
export function groupItems(
	items: readonly DesktopNotificationItem[],
	waiting: readonly DesktopNotificationItem[],
	grouping: NotificationGrouping,
	nowMs: number,
): NotificationGroup[] {
	const waitingIds = new Set(waiting.map((item) => item.id));
	const rest = items
		.filter((item) => !waitingIds.has(item.id) && !isLiveAsk(item))
		.sort(newestFirst);
	const pinned = [
		...waiting,
		...items.filter((item) => !waitingIds.has(item.id) && isLiveAsk(item)),
	].sort(newestFirst);
	const groups: NotificationGroup[] = [];
	if (pinned.length > 0)
		groups.push({ kind: "waiting", key: "waiting", items: pinned });
	if (grouping === "time") {
		const order: TimeBucket[] = ["today", "yesterday", "week", "older"];
		const buckets = new Map<TimeBucket, DesktopNotificationItem[]>();
		for (const item of rest) {
			const bucket = timeBucketOf(item.updated_at, nowMs);
			const list = buckets.get(bucket) ?? [];
			list.push(item);
			buckets.set(bucket, list);
		}
		for (const bucket of order) {
			const list = buckets.get(bucket);
			if (list && list.length > 0)
				groups.push({ kind: "time", key: bucket, items: list });
		}
		return groups;
	}
	const bySession = new Map<string, DesktopNotificationItem[]>();
	for (const item of rest) {
		const list = bySession.get(item.session.id) ?? [];
		list.push(item);
		bySession.set(item.session.id, list);
	}
	const sessions = [...bySession.entries()].sort(([, a], [, b]) =>
		newestFirst(a[0], b[0]),
	);
	for (const [sessionId, list] of sessions) {
		groups.push({
			kind: "conversation",
			key: `session:${sessionId}`,
			sessionId,
			title: list[0].session.title,
			items: list,
		});
	}
	return groups;
}

/** The flat row order the keyboard walks: groups in order, rows in order. */
export const rowOrder = (
	groups: readonly NotificationGroup[],
): DesktopNotificationItem[] => groups.flatMap((group) => group.items);

/**
 * What a bulk dismiss over a selection does (design § 6, contract § 2.3).
 * Live asks are SKIPPED, and the count of them is what the selection bar's
 * "N asks stay until they're answered" note states before the press; the
 * server's own `skipped` list is what the receipt states after it.
 */
export function dismissPlan(selected: readonly DesktopNotificationItem[]): {
	dismissable: DesktopNotificationItem[];
	asksStaying: number;
} {
	const dismissable = selected.filter((item) => !isLiveAsk(item));
	return { dismissable, asksStaying: selected.length - dismissable.length };
}

/**
 * The items a "Dismiss all from this conversation" names for its confirm copy:
 * every non-ask row of that session in the loaded set. The WRITE itself is
 * `sessionId` + `throughSeq` (the server is the authority on what is in it);
 * this count is only what the confirmation promises.
 */
/**
 * Whether the reel should pay for a COMPLETE per-conversation enumeration.
 *
 * WHY THIS EXISTS (QA round 3, Q-lie): the detail's "Dismiss all N" and the
 * confirm dialog behind it must name the same number as the write will cover, and
 * that write is bounded by `through_seq` over the whole conversation, not by the
 * page on screen. The count was only enabled while the reel was grouped by
 * conversation, so under Time grouping - the default - the detail fell back to
 * counting the LOADED page: QA measured the button saying 93 then 92 while its own
 * confirm enumerated 130 then 131. The write was right; only the advertised number
 * was wrong, which is the worse half to get wrong because it is the number the
 * operator agrees to.
 *
 * The enumeration is a bounded walk, so it is bought only when something actually
 * prints its result: the conversation-grouped header, or an open detail.
 */
/**
 * The boundary a printed per-conversation count must be counted under.
 *
 * THE LIVE ONE, ALWAYS (round-3 review R1, kept by round 4). The confirm walks the
 * session with `observeNotificationScope` bounded by the high-water mark it reads
 * AT THE CLICK, and the store re-stamps a row's seq on every read or dismiss - so a
 * count taken at any earlier mark describes a different set of rows than the dialog
 * it opens. It is stated here, as a function the reader must call, so the rule has a
 * name and a test rather than being an inline argument somebody can quietly freeze.
 */
/**
 * How many pages of the reel the client keeps in memory, and WHICH ones.
 *
 * PAGE ONE IS NEVER THE ONE TO GO (code round 4, R4-4). The reel pages in cursor
 * order - page one is the newest rows, and it is the only page carrying `waiting`,
 * the counts and the high-water mark. `useInfiniteQuery`'s own `maxPages` evicts
 * from the FRONT, so with a cap of five a deep scroll silently dropped page one:
 * the waiting asks vanished, a late arrival stayed hidden (the store at 701 while
 * the reel still showed 600), and Mark all read could not see unread asks. So the
 * library cap is gone and this policy bounds the window from the TAIL instead -
 * the oldest pages go, and the head is always kept.
 */
/**
 * Apply this window's CONFIRMED reads to rows the list is only now supplying.
 *
 * WHY THIS IS IN THE MODEL (code audit DC7, and the test round 4 asked for). The
 * reel keeps a map of read tokens it has a receipt for, because a mark-all or an
 * Undo can confirm ids that were not on the loaded page; a synthetic row cannot be
 * drawn from a token (no title, time or conversation), so the token waits and is
 * merged when the real row arrives. The rule is small and load-bearing - a confirmed
 * read must not flip back to unread, and a NEWER revision the operator never saw must
 * not be forced read - so it is a pure function with its own test rather than a line
 * buried in a component.
 */
export const mergeConfirmedReads = (
	items: readonly DesktopNotificationItem[],
	confirmed: ReadonlyMap<string, number>,
): DesktopNotificationItem[] =>
	items.map((item) => {
		const revision = confirmed.get(item.id);
		return revision !== undefined && revision >= item.revision
			? { ...item, read: true, read_via: "explicit" as const }
			: item;
	});

/*
 * NO EVICTION, NO SLIDING WINDOW (code round 7 decision).
 *
 * Eviction answered DC5, a MINOR memory concern, and every major since round 4 came
 * from it: maxPages -> tail trim -> slide -> facts split -> a window that snapped back
 * to the top. The memory it saved is small - ~35 KB per 100-row page, so 5,000 loaded
 * rows is about 1.75 MB - and the real cost (refetching every loaded page on each
 * background refresh) is gone now that page one's facts live in their own query. The
 * window therefore keeps everything it fetched: no cap, no trim, no slide, and nothing
 * falls out of the list while the operator is reading it.
 */

/**
 * Which drawn rows a successful write removes (QA round 3, Q12): the ids the server
 * confirmed that this window is actually drawing.
 */
export const coveredByWrite = (
	drawnIds: ReadonlySet<string>,
	changed: readonly string[],
): Set<string> => new Set(changed.filter((id) => drawnIds.has(id)));

/**
 * What the reel draws, given page one's facts and the scrolled window (round 7, Q13).
 *
 * At the top the facts' rows are the head of the list, so a late arrival is simply
 * drawn. Scrolled away from the top they are NOT inserted above the viewport (that
 * would shift what the operator is reading); `newerCount` says how many there are and
 * the pill offers them. It counts only ids the window does not hold, so it cannot grow
 * with rows that were already there.
 */
export function mergeWindowForReel(
	facts: DesktopNotificationsList | undefined,
	windowAnswer: DesktopNotificationsList | undefined,
	atTop: boolean,
): (DesktopNotificationsList & { newerCount: number }) | undefined {
	if (!windowAnswer) return facts ? { ...facts, newerCount: 0 } : undefined;
	if (!facts) return { ...windowAnswer, newerCount: 0 };
	const known = new Set(windowAnswer.items.map((item) => item.id));
	const newerCount = facts.items.filter((item) => !known.has(item.id)).length;
	if (!atTop)
		/*
		 * THE WINDOW KEEPS ITS ROWS; THE FACTS KEEP THE FACTS (code round 8, R8-3). Deep
		 * scrolling used to take the ugly half of both: the rows came from the window AND
		 * `waiting`, the counts and the boundary came from the window's stale page one, so
		 * Mark all read missed an ask that had arrived while the operator was reading.
		 */
		return {
			...facts,
			items: windowAnswer.items,
			next_cursor: windowAnswer.next_cursor,
			newerCount,
		};
	const items = new Map<string, DesktopNotificationItem>();
	for (const item of windowAnswer.items) items.set(item.id, item);
	for (const item of facts.items) {
		const previous = items.get(item.id);
		if (!previous || item.revision >= previous.revision)
			items.set(item.id, item);
	}
	return {
		...facts,
		/* Newest first: the facts' late arrivals belong at the head of the reel. */
		items: [...items.values()].sort((left, right) => right.seq - left.seq),
		next_cursor: windowAnswer.next_cursor,
		newerCount: 0,
	};
}

/**
 * Keep the rows the operator SAW at the top in the window (design round 5, D5 / Q15).
 *
 * At the top, `mergeWindowForReel` draws the facts' late arrivals at the head, but only
 * in the merged answer: the cached window never learnt them. Scrolling away then
 * switched to window rows, the seen arrival left the list, and the pill counted it as
 * "1 new" - history relabelled as news. Writing the drawn arrivals into the window's
 * first page while at the top makes "newer" mean "not yet presented".
 *
 * Returns `null` when there is nothing to add, so a caller can skip the cache write
 * (and the re-render it would cause) on every frame that changes nothing.
 *
 * Returns `"reset"` when the facts page is NOT CONTIGUOUS with the window (code round
 * 10, R10-1): the facts carry only the newest page, so a burst larger than that page
 * leaves no facts row the window already holds and more rows behind it
 * (`factsHasMore`). Prepending would strand the rows between the facts' tail and the
 * window's old head - never drawn, never counted. The caller resets the window to page
 * one instead, which reads every row in order. A short facts page with nothing known
 * is still contiguous (the window's head is right after it), so it prepends.
 */
export function prependSeenToWindow<
	Page extends { items: DesktopNotificationItem[] },
>(
	pages: readonly Page[],
	factsItems: readonly DesktopNotificationItem[],
	factsHasMore = false,
): Page[] | "reset" | null {
	const [first, ...rest] = pages;
	if (!first) return null;
	const known = new Set(pages.flatMap((page) => page.items.map((i) => i.id)));
	const unseen = factsItems.filter((item) => !known.has(item.id));
	if (unseen.length === 0) return null;
	if (factsHasMore && unseen.length === factsItems.length) return "reset";
	/* Newest first, the window's own order, so the head stays the head. */
	const head = [...unseen].sort((left, right) => right.seq - left.seq);
	return [{ ...first, items: [...head, ...first.items] }, ...rest];
}

/**
 * Apply a CONFIRMED write to the cached window rows (round 7, R7-1).
 *
 * The window is no longer invalidated by a write: that refetched every loaded page and,
 * before the facts split, replaced a deep scroll. The receipt names the ids the server
 * actually changed, so the cache is edited in place. Dismiss flips `dismissed` rather
 * than deleting the row, which is also what makes Undo a flag flip with no refetch.
 */
export function applyConfirmedToWindow<
	Page extends { items: DesktopNotificationItem[] },
>(
	pages: readonly Page[],
	changed: readonly string[],
	verb: NotificationVerb,
): Page[] {
	const ids = new Set(changed);
	const flipped = (item: DesktopNotificationItem): DesktopNotificationItem => {
		if (!ids.has(item.id)) return item;
		if (verb === "read") return { ...item, read: true, read_via: "explicit" };
		if (verb === "unread") return { ...item, read: false, read_via: null };
		if (verb === "dismiss") return { ...item, dismissed: true };
		return { ...item, dismissed: false };
	};
	return pages.map((page) => ({ ...page, items: page.items.map(flipped) }));
}

/** One row an optimistic write flips, and what that does to the unread figures. */
export type OptimisticFlip = { id: string; sessionId: string; unread: number };

/**
 * Which of `ids` a write would actually change, from the rows the client holds.
 *
 * WHY THE MODEL DECIDES THIS (the drawer's "click twice" defect). An optimistic
 * write must move the row, the drawer's unread count and the sidebar badge by
 * the same amount, and must undo exactly that amount if the server refuses. A
 * row already in the target state, or one the client never loaded, moves
 * nothing, so it contributes no delta - the server's receipt then settles it.
 * `unread` is the change to the unread figure: -1 when an unread row is read or
 * dismissed, +1 when a read row is unread or an unread row comes back.
 */
export function optimisticFlips(
	known: ReadonlyMap<string, DesktopNotificationItem>,
	ids: readonly string[],
	verb: NotificationVerb,
): OptimisticFlip[] {
	const flips: OptimisticFlip[] = [];
	for (const id of new Set(ids)) {
		const item = known.get(id);
		if (!item || item.source !== "notify") continue;
		const unreadNow = !item.read && !item.dismissed;
		const changes =
			verb === "read"
				? !item.read
				: verb === "unread"
					? item.read
					: verb === "dismiss"
						? !item.dismissed
						: item.dismissed;
		if (!changes) continue;
		const unreadAfter =
			verb === "read"
				? false
				: verb === "unread"
					? !item.dismissed
					: verb === "dismiss"
						? false
						: !item.read;
		flips.push({
			id,
			sessionId: item.session.id,
			unread: Number(unreadAfter) - Number(unreadNow),
		});
	}
	return flips;
}

/**
 * Apply a write to a page-one FACTS answer: the rows, and the unread figure by
 * the flips' delta. Facts are a plain list answer, not an infinite query, so
 * they need their own edit (`applyConfirmedToWindow` takes pages).
 */
export function editFactsForWrite(
	data: DesktopNotificationsList | undefined,
	ids: readonly string[],
	verb: NotificationVerb,
	unreadDelta = 0,
): DesktopNotificationsList | undefined {
	if (!data || !Array.isArray(data.items)) return data;
	const [page] = applyConfirmedToWindow([data], ids, verb);
	return {
		...page,
		unread_count: Math.max(0, data.unread_count + unreadDelta),
	};
}

export const scopeCountBoundary = (
	highWaterMark: number | undefined,
): number | undefined => highWaterMark;

/**
 * What the scope count is keyed by, so it re-walks only when THIS conversation
 * changed (code round 5, R5-2).
 *
 * The walk is bought under the live high-water mark because the confirm enumerates
 * under it (R4-1). Keying the query on that mark made every frame - and every mark
 * anywhere in the store - re-walk: 3 marks over 900 rows cost 30 page reads. A mark
 * in another conversation cannot change this conversation's answer, so the key is
 * this conversation's own rows: their ids and revisions, which move only when one
 * of them is read, dismissed or updated.
 */
export const scopeCountSignature = (
	items: readonly DesktopNotificationItem[],
	sessionId: string,
): string =>
	items
		/* An empty scope means every visible conversation: the conversation-grouped
		   header prints one number over all of them, so any of them changing re-walks. */
		.filter((item) => !sessionId || item.session.id === sessionId)
		/* Rows kept on screen after a read are drawn rows too: their state moved even
		   though the server's list no longer returns them. */
		.map(
			(item) =>
				`${item.id}@${item.revision}:${item.read ? 1 : 0}${item.dismissed ? "d" : ""}`,
		)
		.sort()
		.join(",");

/**
 * The conversation's own FACTS, folded into the printed count's key (round 7, R7-2).
 *
 * `scopeCountSignature` sees only the rows this window has loaded, so a conversation
 * whose page has not arrived yet could not move the number: the header showed 9 while
 * its confirm enumerated 10. The session facts query is that conversation's server-side
 * answer - its boundary, its pending asks and its unread count - so a late arrival in a
 * conversation we have not paged to is a change in this string.
 */
export const conversationFactsKey = (
	facts:
		| {
				high_water?: number;
				waiting?: readonly unknown[];
				unread_count?: number;
		  }
		| undefined,
): string =>
	facts
		? `${facts.high_water ?? 0}:${facts.waiting?.length ?? 0}:${facts.unread_count ?? 0}`
		: "";

export const sessionScopeCountsEnabled = (
	grouping: NotificationGrouping,
	detailOpen: boolean,
): boolean => detailOpen || grouping === "conversation";

export const sessionDismissCount = (
	items: readonly DesktopNotificationItem[],
	sessionId: string,
): number =>
	items.filter(
		(item) =>
			item.session.id === sessionId && !isLiveAsk(item) && !item.dismissed,
	).length;

/**
 * Extend a selection to the range between `anchorId` and `id` in row order
 * (shift-click, Shift+arrow). Anchor missing from the order selects just `id`.
 */
export function rangeSelect(
	order: readonly DesktopNotificationItem[],
	anchorId: string | null,
	id: string,
	current: ReadonlySet<string>,
): Set<string> {
	const next = new Set(current);
	const to = order.findIndex((item) => item.id === id);
	const from = anchorId ? order.findIndex((item) => item.id === anchorId) : -1;
	if (to < 0) return next;
	if (from < 0) {
		next.add(id);
		return next;
	}
	const [lo, hi] = from < to ? [from, to] : [to, from];
	for (let index = lo; index <= hi; index += 1) next.add(order[index].id);
	return next;
}

/**
 * The sidebar badge's number (contract § 8.1: `unread_count + waiting_count`).
 * Absent count reads as zero: zero draws no badge, which is the honest render
 * of "nothing known to be waiting".
 */
export const badgeCountOf = (
	count: DesktopNotificationsCount | null | undefined,
): number =>
	count
		? Math.max(0, count.unread_count) + Math.max(0, count.waiting_unread_count)
		: 0;

/** Which provenance mark a READ row draws (design § 17.4). */
export type SeenMark = "live" | "in_view" | null;

export const seenMarkOf = (item: DesktopNotificationItem): SeenMark => {
	if (!item.read) return null;
	if (item.read_via === "watching") return "live";
	if (item.read_via === "in_view") return "in_view";
	return null;
};

/** The relative-time spelling of a row's time column (design § 4). */
export type RowTime =
	| { kind: "now" }
	| { kind: "minutes"; count: number }
	| { kind: "hours"; count: number }
	| { kind: "clock"; at: number }
	| { kind: "date"; at: number };

export function rowTimeOf(ms: number, nowMs: number): RowTime {
	const delta = Math.max(0, nowMs - ms);
	if (delta < 60_000) return { kind: "now" };
	const bucket = timeBucketOf(ms, nowMs);
	if (bucket === "today") {
		if (delta < 3_600_000)
			return { kind: "minutes", count: Math.floor(delta / 60_000) };
		return { kind: "hours", count: Math.floor(delta / 3_600_000) };
	}
	if (bucket === "yesterday") return { kind: "clock", at: ms };
	return { kind: "date", at: ms };
}

/**
 * The "N new" pill (design § 5): ids in `next` that were not in `seen` and sort
 * above the reader's scroll position. A pure set difference; the page decides
 * whether the reader is scrolled.
 */
export const arrivals = (
	seen: ReadonlySet<string>,
	next: readonly DesktopNotificationItem[],
): string[] => next.filter((item) => !seen.has(item.id)).map((item) => item.id);
