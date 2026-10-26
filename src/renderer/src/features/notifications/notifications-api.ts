/**
 * The notifications reel's data layer: query keys, reads, writes and the feed
 * invalidation (notifications contract § 5.2-§ 5.3, § 8).
 *
 * WHY ONE MODULE OWNS EVERY KEY. The page, the sidebar badge, the asks drawer's
 * Updates tab and the transcript's flag lines all read the same store, and the
 * feed's `notifications` frame invalidates all of them at once. Keys spelled in
 * four places would drift into one surface showing a count another has already
 * cleared, which is the two-answers-to-one-number defect the badge exists to
 * avoid. Everything under `["desktop", "notifications"]` is invalidated by the
 * one prefix.
 *
 * FAIL-CLOSED ON THE CAPABILITY. Every read takes `enabled` from
 * `features.notifications`; an older core has no routes, so a disabled query is
 * the honest state, not an empty inbox.
 *
 * TOKEN-BOUND WRITES. Every read/dismiss names the revision the client
 * RENDERED (`items[]`) or a high-water `throughSeq`, never "everything now": an
 * item published after the render must survive the click (R10 in core
 * `docs/ATTENTION.md`, contract § 5.2). The server reports what it skipped and
 * why; the UI repeats that report rather than guessing it.
 */
import {
	retryDesktopMutation,
	retryDesktopQuery,
} from "@shared/api/local-operator/backend-error";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { notificationsFrameRecord } from "@shared/hooks/use-desktop-feed";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import {
	type QueryClient,
	useInfiniteQuery,
	useMutation,
	useQuery,
} from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type {
	DesktopNotificationDetail,
	DesktopNotificationItem,
	DesktopNotificationsCount,
	DesktopNotificationsList,
	DesktopNotificationsWriteResult,
} from "../../../../shared/desktop-control-contract";
import {
	DRAWER_PAGE_WINDOW,
	NOTIFICATIONS_PAGE_WINDOW,
	pinFirstPage,
	slideNotificationWindow,
} from "./notifications-model";

export const notificationKeys = {
	all: ["desktop", "notifications"] as const,
	list: (state: "unread" | "all") =>
		["desktop", "notifications", "list", state] as const,
	session: (sessionId: string) =>
		["desktop", "notifications", "session", sessionId] as const,
	detail: (id: string) => ["desktop", "notifications", "detail", id] as const,
	count: ["desktop", "notifications", "count"] as const,
	/** The reel's list reads, without the per-id detail reads. */
	listRoot: ["desktop", "notifications", "list"] as const,
	/** The per-conversation reads (the drawer, the flag lines). */
	sessionsRoot: ["desktop", "notifications", "session"] as const,
};

/** Whether this backend serves the reel. One spelling for every surface. */
export function useNotificationsEnabled(): boolean {
	const capabilities = useDesktopCapabilities();
	return desktopFeatureEnabled(capabilities.data, "notifications", 1);
}

/**
 * Hold the reel's page window to a bound that keeps OLDER rows reachable (code
 * round 5, R5-1).
 *
 * Trimming from the tail made the cursor's own next page the first thing evicted,
 * so the reel could never reach past its newest window. The window now slides from
 * the head of the scroll run and always keeps page one, whose `waiting` group and
 * counts are the facts the reel and Mark all read enumerate under. `hiddenNewer` is
 * the number of rows dropped above the viewport, which the page renders as the
 * back-to-top affordance.
 */
function useReelWindow(
	client: ReturnType<typeof useOptionalQueryClient>["client"],
	key: readonly unknown[],
	trigger: number | undefined,
	limit: number = NOTIFICATIONS_PAGE_WINDOW,
): { hiddenNewer: number; resetToTop: () => void } {
	const [hiddenNewer, setHiddenNewer] = useState(0);
	/* Cumulative until the operator returns to the top (R5-1): a row dropped two
	   fetches ago is still above the viewport, so the pill keeps counting it. */
	const hiddenSoFar = useRef(0);
	useEffect(() => {
		if (!client || trigger === undefined) return;
		const current = client.getQueryData<{
			pages: { items: readonly unknown[] }[];
			pageParams: unknown[];
		}>([...key]);
		if (!current || current.pages.length <= limit) return;
		const next = slideNotificationWindow(
			current.pages,
			current.pageParams,
			limit,
			hiddenSoFar.current,
		);
		client.setQueryData([...key], {
			pages: next.pages,
			pageParams: next.pageParams,
		});
		hiddenSoFar.current = next.hiddenNewer;
		setHiddenNewer(next.hiddenNewer);
	}, [client, key, trigger, limit]);

	/*
	 * Back to top drops every scroll page and refetches page one, so the operator
	 * lands on the newest rows with fresh counts rather than a stale pinned page.
	 */
	const resetToTop = useCallback(() => {
		if (!client) return;
		const current = client.getQueryData<{
			pages: unknown[];
			pageParams: unknown[];
		}>([...key]);
		if (!current) return;
		client.setQueryData(
			[...key],
			pinFirstPage(current.pages, current.pageParams),
		);
		hiddenSoFar.current = 0;
		setHiddenNewer(0);
		void client.invalidateQueries({ queryKey: [...key] });
	}, [client, key]);

	return { hiddenNewer, resetToTop };
}

/**
 * The reel's list read. The page loads up to the route's 100-row page and the
 * `waiting` group; the client applies kind/priority/from/grouping over that set
 * (design § 2: filters are client-side over the loaded set).
 *
 * `refetchInterval` is the backstop the design asks for (§ 5 "Refreshing"): the
 * feed frame is the live path, and 30 s bounds staleness when the feed is down
 * (contract § 6.3 "Feed down"). Not retried beyond the house rule: a failure
 * keeps the previous data, which is what the stale-list error state draws.
 */
export function useNotificationsList(
	state: "unread" | "all",
	enabled: boolean,
) {
	useNotificationsFeedInvalidation();
	const { client } = useOptionalQueryClient();
	const answer = useInfiniteQuery({
		queryKey: notificationKeys.list(state),
		enabled,
		initialPageParam: undefined as
			| { cursor: string; throughSeq: number }
			| undefined,
		queryFn: ({ pageParam }) =>
			desktopResult<DesktopNotificationsList>({
				op: "notifications.list",
				state,
				limit: 100,
				...(pageParam ?? {}),
			}),
		getNextPageParam: (last) =>
			last.next_cursor
				? { cursor: last.next_cursor, throughSeq: last.high_water }
				: undefined,
		// Only page one carries waiting. Deduplicate keyed items across a cursor
		// boundary if content changed between reads, retaining the freshest token.
		select: (answer): DesktopNotificationsList => {
			const first = answer.pages[0];
			const items = new Map<string, DesktopNotificationItem>();
			for (const page of answer.pages)
				for (const item of page.items) {
					const previous = items.get(item.id);
					if (!previous || item.revision > previous.revision)
						items.set(item.id, item);
				}
			return {
				...first,
				items: [...items.values()],
				next_cursor: answer.pages.at(-1)?.next_cursor,
			};
		},
		retry: retryDesktopQuery,
		staleTime: 5_000,
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
		/*
		 * NO LIBRARY CAP: THE WINDOW IS BOUNDED FROM THE TAIL (code round 4, R4-4).
		 * `maxPages` evicts the OLDEST page, and here that is page one - the newest
		 * rows, the only page carrying `waiting`, the counts and the boundary. A deep
		 * scroll therefore lost the waiting asks, hid late arrivals and left Mark all
		 * read blind to unread asks. `trimNotificationPages` keeps the head instead.
		 */
	});
	const reel = useReelWindow(
		client,
		notificationKeys.list(state),
		answer.dataUpdatedAt,
	);
	return {
		...answer,
		hiddenNewer: reel.hiddenNewer,
		resetToTop: reel.resetToTop,
	};
}

/**
 * One conversation's items, read and unread (contract § 6.5: the drawer tab).
 *
 * PAGED, NOT FIRST-100-ONLY (code audit DC6). This one read feeds three things:
 * the drawer tab, the door's unread badge, and the flag lines for older anchors.
 * At `limit:100` with no cursor a wake-driven session silently lost everything
 * past the first page - the badge under-counted, old rows were unreachable, and
 * a flag line for an older anchor fell back to a plain tool row. The list is
 * enumerated under the FIRST page's boundary (`throughSeq`), so the set is
 * consistent even if the session keeps writing while we page.
 */
export function useSessionNotifications(
	sessionId: string | null,
	enabled: boolean,
) {
	useNotificationsFeedInvalidation();
	const { client } = useOptionalQueryClient();
	const answer = useInfiniteQuery({
		queryKey: notificationKeys.session(sessionId ?? ""),
		enabled: enabled && Boolean(sessionId),
		initialPageParam: undefined as
			| { cursor: string; throughSeq: number }
			| undefined,
		queryFn: ({ pageParam }) =>
			desktopResult<DesktopNotificationsList>({
				op: "notifications.list",
				state: "all",
				sessionId: sessionId ?? "",
				source: "notify",
				limit: 100,
				...(pageParam ?? {}),
			}),
		getNextPageParam: (last) =>
			last.next_cursor
				? { cursor: last.next_cursor, throughSeq: last.high_water }
				: undefined,
		select: (answer): DesktopNotificationsList => {
			const first = answer.pages[0];
			const items = new Map<string, DesktopNotificationItem>();
			for (const page of answer.pages)
				for (const item of page.items) {
					const previous = items.get(item.id);
					if (!previous || item.revision > previous.revision)
						items.set(item.id, item);
				}
			return {
				...first,
				items: [...items.values()],
				next_cursor: answer.pages.at(-1)?.next_cursor,
			};
		},
		retry: retryDesktopQuery,
		staleTime: 5_000,
		/* Same policy as the reel (code round 4, R4-4): bound from the tail, never
		   evict the head, so the door's badge and the flag lines keep page one. */
	});
	const drawer = useReelWindow(
		client,
		notificationKeys.session(sessionId ?? ""),
		answer.dataUpdatedAt,
		DRAWER_PAGE_WINDOW,
	);
	return {
		...answer,
		hiddenNewer: drawer.hiddenNewer,
		resetToTop: drawer.resetToTop,
	};
}

/**
 * How many updates in this conversation are unread, from the server, not the page.
 *
 * WHY A WALK AND NOT `items.filter(...)` (code round 4, R4-6). The drawer reads its
 * conversation through a paged query, so counting the LOADED rows made the door's
 * badge say 100 while the conversation held 450 unread. The read is bounded and
 * stops as soon as a page reports no cursor; it asks for unread rows only, so the
 * cost is proportional to the unread count rather than to the conversation.
 */
export async function readSessionUnreadCount(
	sessionId: string,
	readPage: (
		request: SessionCountPageRequest,
	) => Promise<DesktopNotificationsList> = (request) =>
		desktopResult<DesktopNotificationsList>({
			op: "notifications.list",
			...request,
		}),
): Promise<number> {
	let cursor: string | undefined;
	let unread = 0;
	const seen = new Set<string>();
	for (;;) {
		const answer = await readPage({
			state: "unread",
			source: "notify",
			sessionId,
			limit: 100,
			...(cursor ? { cursor } : {}),
		});
		unread += answer.items.filter(
			(item) => !item.read && !item.dismissed,
		).length;
		const next = answer.next_cursor ?? undefined;
		if (!next || seen.has(next)) return unread;
		seen.add(next);
		cursor = next;
	}
}

export function useNotificationDetail(id: string | null, enabled: boolean) {
	return useQuery({
		queryKey: notificationKeys.detail(id ?? ""),
		enabled: enabled && Boolean(id),
		queryFn: () =>
			desktopResult<DesktopNotificationDetail>({
				op: "notifications.get",
				id: id ?? "",
			}),
		retry: retryDesktopQuery,
		staleTime: 5_000,
	});
}

/**
 * The sidebar badge's number: unread updates plus waiting asks the operator has
 * not marked read (design § 11). The cheap count route, refetched on the feed
 * frame; the frame's own counts are applied straight into the cache so the
 * badge moves on the frame, not on the refetch.
 */
export function useNotificationsCount(enabled: boolean) {
	useNotificationsFeedInvalidation();
	return useQuery({
		queryKey: notificationKeys.count,
		enabled,
		queryFn: () =>
			desktopResult<DesktopNotificationsCount>({ op: "notifications.count" }),
		retry: retryDesktopQuery,
		staleTime: 5_000,
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
	});
}

/**
 * Spend the feed's `notifications` frame: every key under the reel's prefix is
 * invalidated for EVERY frame. The notification-store sequence does not cover
 * ask-queue changes: a same-count ask replacement or an ask read mark can carry
 * the same numeric revision. Frame identity, not that sequence, is the signal
 * (R1/Q1). The frame's counts paint immediately, then queries reconcile.
 *
 * OPENS NO SUBSCRIPTION OF ITS OWN. It reads the module-scope frame record the
 * app's existing feed subscriptions publish to (`notificationsFrameRecord` in
 * `use-desktop-feed.ts`, which says why), so mounting it on the rail, the page,
 * the drawer and every transcript adds no IPC listener, and a server render
 * (the transcript paint tests) reads the record's null server snapshot instead
 * of touching `window`.
 *
 * ONE APPLICATION PER FRAME PER CLIENT. Every mounted consumer sees the same
 * record; the first effect to run applies it and the rest find it applied, so
 * N consumers cost one invalidation rather than N cancel-and-refetch cycles.
 */
const appliedNotificationsFrame = new WeakMap<QueryClient, string>();

/**
 * One trailing list invalidation per frame burst (code round 4, R4-5).
 *
 * Frames arrive on the store's own churn; a burst of three is three chances to
 * refetch the same five pages. The timer collapses them into one read pass, and it
 * deliberately does NOT touch `notificationKeys.detail`: a count frame changes no
 * item body, and refetching every open detail was part of the same waste.
 */
const pendingInvalidation = new WeakMap<
	object,
	ReturnType<typeof setTimeout>
>();
const INVALIDATE_COALESCE_MS = 750;

function invalidateSoon(
	client: ReturnType<typeof useOptionalQueryClient>["client"],
) {
	if (!client) return Promise.resolve();
	const previous = pendingInvalidation.get(client);
	if (previous) clearTimeout(previous);
	const timer = setTimeout(() => {
		pendingInvalidation.delete(client);
		void client.invalidateQueries({ queryKey: notificationKeys.listRoot });
		void client.invalidateQueries({ queryKey: notificationKeys.sessionsRoot });
	}, INVALIDATE_COALESCE_MS);
	pendingInvalidation.set(client, timer);
	return Promise.resolve();
}

export function useNotificationsFeedInvalidation() {
	const frame = useSyncExternalStore(
		notificationsFrameRecord.subscribe,
		notificationsFrameRecord.snapshot,
		notificationsFrameRecord.serverSnapshot,
	);
	const { client, provided } = useOptionalQueryClient();
	useEffect(() => {
		if (!provided || !frame) return;
		if (appliedNotificationsFrame.get(client) === frame.key) return;
		appliedNotificationsFrame.set(client, frame.key);
		/*
		 * THE COUNT IS WRITTEN, NOT REFETCHED, and the lists are coalesced
		 * (code round 4, R4-5). A wake loop can deliver a frame every few seconds, and
		 * every one of them invalidated EVERY notification query - the reel's five
		 * pages plus each session's pages plus the detail - so three frames cost twenty
		 * sequential reads. The count comes from the frame itself (no read at all), the
		 * detail is not refreshed by a count frame, and the list/session reads are
		 * collapsed into one trailing invalidation per frame burst.
		 */
		client.setQueryData<DesktopNotificationsCount>(notificationKeys.count, {
			unread_count: frame.unreadCount,
			waiting_count: frame.waitingCount,
			waiting_unread_count: frame.waitingUnreadCount,
			high_water: frame.revision,
		});
		void invalidateSoon(client);
	}, [frame, client, provided]);
}

/** The target half of a write, as the contract's request schema spells it. */
export type NotificationsTarget =
	| { items: { id: string; revision: number }[] }
	| {
			sessionId: string;
			throughSeq: number;
			observed: { id: string; revision: number }[];
	  }
	| {
			all: true;
			throughSeq: number;
			observed: { id: string; revision: number }[];
	  };

export type NotificationsVerb = "read" | "unread" | "dismiss" | "undismiss";

/** The item tokens a write names: the revision each row was RENDERED at. */
export const tokensOf = (
	items: readonly Pick<DesktopNotificationItem, "id" | "revision">[],
): { id: string; revision: number }[] =>
	items.map((item) => ({ id: item.id, revision: item.revision }));

/**
 * One write. Read/unread ride `notifications.read` (main's foreground guard
 * covers it: a read claims a human saw the item), dismiss/undismiss ride
 * `notifications.dismiss` (not a "seen" claim, unguarded).
 */
export function writeNotifications(
	verb: NotificationsVerb,
	target: NotificationsTarget,
): Promise<DesktopNotificationsWriteResult> {
	if (verb === "read" || verb === "unread") {
		return desktopResult<DesktopNotificationsWriteResult>({
			op: "notifications.read",
			verb,
			target,
		});
	}
	return desktopResult<DesktopNotificationsWriteResult>({
		op: "notifications.dismiss",
		verb,
		target,
	});
}

/**
 * The mutation every surface uses. Settles by invalidating the reel's prefix,
 * so the list, the count and the drawer move together.
 */
export function useNotificationsWrite() {
	const { client } = useOptionalQueryClient();
	return useMutation({
		mutationFn: ({
			verb,
			target,
		}: {
			verb: NotificationsVerb;
			target: NotificationsTarget;
		}) => writeNotifications(verb, target),
		retry: retryDesktopMutation,
		onSettled: () => {
			void client.invalidateQueries({ queryKey: notificationKeys.all });
		},
	});
}

/** The per-item in-view evidence write (contract § 6.4). */
export function postNotificationsSeen(input: {
	items: {
		id: string;
		revision: number;
		anchorId: string;
		/** When THIS anchor became visible; the server checks it per row (D13). */
		visibleSinceMs: number;
	}[];
	evidence: {
		sessionId: string;
		/** No `"focus"`: a window focus-gain is never an input edge (D12). */
		inputKind: "pointer" | "key" | "wheel";
		inputAtMs: number;
		visibleSinceMs: number;
	};
}): Promise<DesktopNotificationsWriteResult> {
	return desktopResult<DesktopNotificationsWriteResult>({
		op: "notifications.seen",
		...input,
	});
}

/**
 * The one page shape these counters ask for: notify rows, optionally unread only,
 * under a fixed boundary (`throughSeq` is optional for the unread walk, which is
 * already bounded by the state the server applies).
 */
export type SessionCountPageRequest = {
	state: "all" | "unread";
	source: "notify";
	limit: number;
	sessionId?: string;
	throughSeq?: number;
	cursor?: string;
};

/**
 * How many rows each conversation would actually lose to "Dismiss all from this
 * conversation".
 *
 * WHY THIS EXISTS RATHER THAN A COUNT OVER THE LOADED PAGE. The confirm dialog
 * freezes the FULL scope of the conversation (contract § 5.2: `sessionId` +
 * `through_seq` + every observed token), so a header that counted only the rows
 * this page happens to hold promised a smaller number than the dialog then
 * applied — the header and its own dialog disagreed (code round 2, minor 2).
 * One enumeration under the same boundary the write will use answers both, so
 * the number an operator reads before clicking is the number they are shown at
 * confirmation.
 *
 * The count is per conversation and deliberately scoped like the write: notify
 * rows that are not dismissed and not keyset-collapsed. An open ask is never
 * dismissed from the reel (contract § 2.3), so it is never counted.
 */
export async function readSessionDismissCounts(
	throughSeq: number,
	/*
	 * The page reader is a parameter for the same reason
	 * `observeNotificationScope` takes one: the counting rule is what a test
	 * needs to pin, and a hit-testable seam is not.
	 */
	readPage: (
		request: SessionCountPageRequest,
	) => Promise<DesktopNotificationsList> = (request) =>
		desktopResult<DesktopNotificationsList>({
			op: "notifications.list",
			...request,
		}),
): Promise<Record<string, number>> {
	const counts: Record<string, number> = {};
	let cursor: string | undefined;
	const seen = new Set<string>();
	/*
	 * THE WALK STAYS COMPLETE, because the number is a promise: the header and
	 * the confirm dialog must name the same scope (round 2, minor 2), and a
	 * capped walk would silently under-promise the one case that matters most -
	 * a conversation with more rows than the cap. The load problem this used to
	 * cause (DC4) is answered WHERE it is called from: only in conversation
	 * grouping, behind a 30 s staleness window, not on every frame.
	 */
	for (;;) {
		const answer = await readPage({
			state: "all",
			source: "notify",
			limit: 100,
			throughSeq,
			...(cursor ? { cursor } : {}),
		});
		for (const item of answer.items) {
			if (item.dismissed || item.source === "ask") continue;
			counts[item.session.id] = (counts[item.session.id] ?? 0) + 1;
		}
		const next = answer.next_cursor ?? undefined;
		if (!next) return counts;
		// A cursor that does not advance would loop forever on a server bug.
		if (seen.has(next)) return counts;
		seen.add(next);
		cursor = next;
	}
}
