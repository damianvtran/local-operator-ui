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
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
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
	});
}

/** One conversation's items, read and unread (contract § 6.5: the drawer tab). */
export function useSessionNotifications(
	sessionId: string | null,
	enabled: boolean,
) {
	useNotificationsFeedInvalidation();
	return useQuery({
		queryKey: notificationKeys.session(sessionId ?? ""),
		enabled: enabled && Boolean(sessionId),
		queryFn: () =>
			desktopResult<DesktopNotificationsList>({
				op: "notifications.list",
				state: "all",
				sessionId: sessionId ?? "",
				source: "notify",
				limit: 100,
			}),
		retry: retryDesktopQuery,
		staleTime: 5_000,
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
 */
export function useNotificationsFeedInvalidation() {
	const { notificationsRevision } = useDesktopFeed();
	const { client, provided } = useOptionalQueryClient();
	useEffect(() => {
		if (!provided || !notificationsRevision) return;
		client.setQueryData<DesktopNotificationsCount>(notificationKeys.count, {
			unread_count: notificationsRevision.unreadCount,
			waiting_count: notificationsRevision.waitingCount,
			waiting_unread_count: notificationsRevision.waitingUnreadCount,
			high_water: notificationsRevision.revision,
		});
		void client.invalidateQueries({ queryKey: notificationKeys.all });
	}, [notificationsRevision, client, provided]);
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
	items: { id: string; revision: number; anchorId: string }[];
	evidence: {
		sessionId: string;
		inputKind: "pointer" | "key" | "wheel" | "focus";
		inputAtMs: number;
		visibleSinceMs: number;
	};
}): Promise<DesktopNotificationsWriteResult> {
	return desktopResult<DesktopNotificationsWriteResult>({
		op: "notifications.seen",
		...input,
	});
}
