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
} from "../../../../shared/desktop-control-contract";

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
