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
import { useEffect, useSyncExternalStore } from "react";
import type {
	DesktopNotificationDetail,
	DesktopNotificationItem,
	DesktopNotificationsCount,
	DesktopNotificationsList,
	DesktopNotificationsWriteResult,
} from "../../../../shared/desktop-control-contract";

export const notificationKeys = {
	all: ["desktop", "notifications"] as const,
	list: (state: "unread" | "all") =>
		["desktop", "notifications", "list", state] as const,
	session: (sessionId: string) =>
		["desktop", "notifications", "session", sessionId] as const,
	detail: (id: string) => ["desktop", "notifications", "detail", id] as const,
	count: ["desktop", "notifications", "count"] as const,
};

/** Whether this backend serves the reel. One spelling for every surface. */
export function useNotificationsEnabled(): boolean {
	const capabilities = useDesktopCapabilities();
	return desktopFeatureEnabled(capabilities.data, "notifications", 1);
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
	return useInfiniteQuery({
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
		 * A BOUNDED WINDOW OF PAGES (code audit DC5). `useInfiniteQuery` refetches
		 * EVERY loaded page on invalidate, and the feed invalidates on every frame -
		 * so after scrolling a thousand rows, each frame cost ten sequential reads
		 * and a full re-render of the merged map. Five pages (500 rows) is the
		 * window this list reconciles; older rows come back when the operator scrolls
		 * there again, which is when they are read anyway.
		 */
		maxPages: 5,
	});
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
	return useInfiniteQuery({
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
		/* Same bounded window as the reel (DC5), so an invalidate does not fan
		   out into an unbounded sequential refetch of a session's whole history. */
		maxPages: 10,
	});
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
		client.setQueryData<DesktopNotificationsCount>(notificationKeys.count, {
			unread_count: frame.unreadCount,
			waiting_count: frame.waitingCount,
			waiting_unread_count: frame.waitingUnreadCount,
			high_water: frame.revision,
		});
		void client.invalidateQueries({ queryKey: notificationKeys.all });
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

/** The one page shape this counter asks for: notify rows under a fixed boundary. */
export type SessionCountPageRequest = {
	state: "all";
	source: "notify";
	limit: number;
	throughSeq: number;
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
