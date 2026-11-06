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
	useMemo,
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
	type FrozenNotificationSelection,
	type NotificationSelectionPreview,
	inverseNotificationVerb,
	notificationSelectionScope,
	selectedBySnapshot,
} from "./notification-operations";
import {
	applyConfirmedToWindow,
	dismissPlan,
	editFactsForWrite,
	isNewerNotification,
	mergeWindowForReel,
	prependSeenToWindow,
} from "./notifications-model";

export const notificationKeys = {
	all: ["desktop", "notifications"] as const,
	list: (state: "unread" | "all") =>
		["desktop", "notifications", "list", state] as const,
	session: (sessionId: string) =>
		["desktop", "notifications", "session", sessionId] as const,
	detail: (id: string) => ["desktop", "notifications", "detail", id] as const,
	count: ["desktop", "notifications", "count"] as const,
	facts: (state: "unread" | "all") =>
		["desktop", "notifications", "facts", state] as const,
	/** The drawer's page-one facts, one per conversation (same split as the reel). */
	sessionFacts: (sessionId: string) =>
		["desktop", "notifications", "session-facts", sessionId] as const,
	sessionFactsAll: ["desktop", "notifications", "session-facts"] as const,
	/** The reel's list reads, without the per-id detail reads. */
	listRoot: ["desktop", "notifications", "list"] as const,
	/**
	 * Page one's FACTS, apart from the scroll window (code round 6, R6-2).
	 * `useInfiniteQuery` refetches every loaded page forward from page one, so the
	 * interval and every feed frame replaced a deep scroll with the newest page - the
	 * operator was thrown back to the top and the pill grew with rows that were not
	 * new. Facts refetch on the frame and on the interval; the window only moves when
	 * the operator asks it to reveal newest (back to top or scroll to top).
	 */
	factsRoot: ["desktop", "notifications", "facts"] as const,
	/** The per-conversation reads (the drawer, the flag lines). */
	sessionsRoot: ["desktop", "notifications", "session"] as const,
	/**
	 * One conversation's server-walked unread count (the drawer tab and the rail
	 * door). Spelled here rather than at its one reader so an optimistic write can
	 * move it with the rows: a key spelled in two places is the drift this module
	 * exists to prevent.
	 */
	sessionUnread: (sessionId: string | null) =>
		["desktop", "notifications", "session-unread", sessionId] as const,
};

/** Whether this backend serves the reel. One spelling for every surface. */
export function useNotificationsEnabled(): boolean {
	const capabilities = useDesktopCapabilities();
	return desktopFeatureEnabled(capabilities.data, "notifications", 1);
}

/**
 * Page one's facts: the counts, the `waiting` roll-up and the high-water mark, plus
 * the newest rows (R5-1/R6-1 need them to tell "new" from "already here").
 *
 * This is the query that refreshes on the feed frame and on the 30 s backstop. It is
 * deliberately separate from the scroll window: refreshing it must never move what
 * the operator is reading.
 */
export function useNotificationsFacts(
	state: "unread" | "all",
	enabled: boolean,
) {
	useNotificationsFeedInvalidation();
	return useQuery({
		queryKey: notificationKeys.facts(state),
		enabled,
		queryFn: () =>
			desktopResult<DesktopNotificationsList>({
				op: "notifications.list",
				state,
				limit: 100,
			}),
		retry: retryDesktopQuery,
		staleTime: 5_000,
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
	});
}

/**
 * The drawer's page-one facts: counts, `waiting` and the boundary for one conversation.
 * A feed frame and the interval refresh THIS, never the drawer's scroll window.
 */
export function useSessionNotificationsFacts(
	sessionId: string | null,
	enabled: boolean,
) {
	useNotificationsFeedInvalidation();
	return useQuery({
		queryKey: notificationKeys.sessionFacts(sessionId ?? ""),
		enabled: enabled && Boolean(sessionId),
		queryFn: () =>
			desktopResult<DesktopNotificationsList>({
				op: "notifications.list",
				state: "all",
				source: "notify",
				sessionId: sessionId ?? "",
				limit: 100,
			}),
		retry: retryDesktopQuery,
		staleTime: 5_000,
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
	});
}

/**
 * While the list is at its top, write the drawn late arrivals into the cached window
 * (design round 5, D5 / Q15). See `prependSeenToWindow`: without this a row the
 * operator saw at the head was dropped on the next scroll and then counted as "new".
 * Deep in the list nothing is written - those arrivals are what the pill offers.
 * A burst bigger than the facts page resets the window to page one instead (R10-1),
 * so no row is left stranded between the facts and the old head.
 */
function useKeepSeenInWindow(
	client: ReturnType<typeof useOptionalQueryClient>["client"],
	queryKey: readonly unknown[],
	scroll: { atTop: boolean } | undefined,
	facts: DesktopNotificationsList | undefined,
) {
	const keyId = JSON.stringify(queryKey);
	const atTopOwner = scroll?.atTop === true;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `keyId` is the key's identity; the array is rebuilt every render.
	useEffect(() => {
		const factsItems = facts?.items;
		if (!client || !atTopOwner || !factsItems) return;
		const data = client.getQueryData<{ pages?: unknown[] }>(queryKey);
		if (!data || !Array.isArray(data.pages)) return;
		const pages = prependSeenToWindow(
			data.pages as { items: DesktopNotificationItem[] }[],
			factsItems,
			Boolean(facts.next_cursor),
		);
		/* Seen asks need the same membership memory as seen updates, otherwise
		 * scrolling away relabels an ask already drawn at the head as new. The
		 * facts object is stable between reads; avoid a cache-write render loop. */
		const first = data.pages[0] as DesktopNotificationsList | undefined;
		const waitingChanged = first && first.waiting !== facts.waiting;
		if (pages === null && !waitingChanged) return;
		if (pages === "reset") {
			void client.resetQueries({ queryKey });
			return;
		}
		const retained = pages ?? data.pages;
		client.setQueryData(queryKey, {
			...data,
			pages: waitingChanged
				? [
						{ ...first, ...(retained[0] as object), waiting: facts.waiting },
						...retained.slice(1),
					]
				: retained,
		});
	}, [client, keyId, atTopOwner, facts]);
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
	/*
	 * Only the surface that OWNS the scroll passes this (the reel, the drawer). Other
	 * readers of the same key - the flag lines, the unread count - leave it undefined:
	 * they draw as if at the top, but must never write the shared window (D5 / R10-1),
	 * or a deep drawer would have rows inserted above its viewport and lose its pill.
	 */
	scroll?: { atTop: boolean },
) {
	useNotificationsFeedInvalidation();
	const { client } = useOptionalQueryClient();
	const facts = useNotificationsFacts(state, enabled);
	const [windowResetAt, setWindowResetAt] = useState(0);
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
		/* Deduplicate across a cursor boundary; keep the freshest token per id. */
		select: (answer): DesktopNotificationsList => {
			const first = answer.pages[0] as DesktopNotificationsList;
			const items = new Map<string, DesktopNotificationItem>();
			for (const page of answer.pages)
				for (const item of page.items) {
					const previous = items.get(item.id);
					if (!previous || isNewerNotification(item, previous))
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
		/*
		 * NO CAP AND NO INTERVAL (code round 7 decision). The window keeps every page it
		 * fetched - ~35 KB per 100 rows, so 5,000 rows is about 1.75 MB - and page one's
		 * facts in their own query are what the frame and the interval refresh. Refetching
		 * this query walks every loaded page forward from page one, which is what used to
		 * snap a deep scroll back to the top.
		 */
		refetchInterval: false,
		refetchIntervalInBackground: false,
	});
	useKeepSeenInWindow(client, notificationKeys.list(state), scroll, facts.data);
	const merged = mergeWindowForReel(
		facts.data,
		answer.data as DesktopNotificationsList | undefined,
		scroll?.atTop ?? true,
	);
	return {
		...answer,
		data: merged,
		dataUpdatedAt: Math.max(
			answer.dataUpdatedAt,
			facts.dataUpdatedAt as number,
		),
		newerCount: merged?.newerCount ?? 0,
		/* Refresh facts without discarding the reader's cursor window. Only the
		 * new-items chip is an intentional request to reveal page one. */
		refresh: facts.refetch,
		// Only an explicit page-one reset moves the viewport; pagination and facts
		// updates keep the operator's deep scroll position.
		windowResetAt,
		/** Back to top: page one again, with fresh facts, so the pill clears. */
		/*
		 * BACK TO TOP RESETS PAGE ONE (code round 8, Q13). Invalidating the window key
		 * refetched all 32 loaded pages; resetting it drops them, so the next read is page
		 * one with fresh facts - and the pill's count is cleared with them.
		 */
		resetToTop: () => {
			setWindowResetAt((at) => at + 1);
			void client?.resetQueries({ queryKey: notificationKeys.list(state) });
			return facts.refetch();
		},
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
	/*
	 * Only the surface that OWNS the scroll passes this (the reel, the drawer). Other
	 * readers of the same key - the flag lines, the unread count - leave it undefined:
	 * they draw as if at the top, but must never write the shared window (D5 / R10-1),
	 * or a deep drawer would have rows inserted above its viewport and lose its pill.
	 */
	scroll?: { atTop: boolean },
) {
	useNotificationsFeedInvalidation();
	const { client } = useOptionalQueryClient();
	const facts = useSessionNotificationsFacts(sessionId, enabled);
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
			const first = answer.pages[0] as DesktopNotificationsList;
			const items = new Map<string, DesktopNotificationItem>();
			for (const page of answer.pages)
				for (const item of page.items) {
					const previous = items.get(item.id);
					if (!previous || isNewerNotification(item, previous))
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
		/* Same policy as the reel: no cap, no interval, facts refresh separately. */
		refetchInterval: false,
		refetchIntervalInBackground: false,
	});
	useKeepSeenInWindow(
		client,
		notificationKeys.session(sessionId ?? ""),
		scroll,
		facts.data,
	);
	const merged = mergeWindowForReel(
		facts.data,
		answer.data as DesktopNotificationsList | undefined,
		scroll?.atTop ?? true,
	);
	return {
		...answer,
		data: merged,
		dataUpdatedAt: Math.max(
			answer.dataUpdatedAt,
			facts.dataUpdatedAt as number,
		),
		newerCount: merged?.newerCount ?? 0,
		resetToTop: () => {
			void client?.resetQueries({
				queryKey: notificationKeys.session(sessionId ?? ""),
			});
			return facts.refetch();
		},
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
		/*
		 * A FRAME REFRESHES FACTS, NEVER A SCROLL WINDOW (code round 8, R8-2). This used to
		 * invalidate `sessionsRoot`, which is the DRAWER's window: one frame refetched every
		 * page of every open drawer. Both windows are fed by their own facts key now.
		 */
		void client.invalidateQueries({ queryKey: notificationKeys.factsRoot });
		void client.invalidateQueries({
			queryKey: notificationKeys.sessionFactsAll,
		});
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
		/*
		 * OPTIMISTIC, FROM THE SHARED CACHE (the drawer's "click twice" defect). The
		 * row, the counts and the sidebar badge move on the click; the rollback is
		 * removal of this gesture's intent. Remaining intents are projected over the
		 * latest authoritative rows/counts, so refusal never undoes another write.
		 */
		onMutate: ({ verb, target }) =>
			"items" in target
				? beginOptimisticWrite(client, verb, target.items)
				: undefined,
		onError: (_error, _variables, rollback) => rollback?.(),
		mutationFn: ({
			verb,
			target,
		}: {
			verb: NotificationsVerb;
			target: NotificationsTarget;
		}) => writeNotifications(verb, target),
		retry: retryDesktopMutation,
		onSuccess: (result, variables, optimistic) => {
			if (optimistic) {
				optimistic.settle(result);
				// The ledger has already applied revision-bound accepted rows. A second
				// id-only edit here would clear a newer revision the server skipped.
				void client?.invalidateQueries({
					queryKey: notificationKeys.factsRoot,
				});
				void client?.invalidateQueries({
					queryKey: notificationKeys.sessionFactsAll,
				});
				void client?.invalidateQueries({ queryKey: notificationKeys.count });
			} else applyConfirmedWrite(client, variables.verb, result.changed);
		},
	});
}

/**
 * THE SHARED READ-STATE API: the one door any surface uses to change read or
 * dismissed state, so every list, count and the sidebar badge agree on the click.
 *
 *     const readState = useNotificationReadState();
 *     readState.markRead(rows);   readState.markUnread(rows);
 *     readState.dismiss(rows);    readState.restore(rows);
 *
 * Each takes the rows AS RENDERED (id + revision: core refuses a write naming an
 * older revision, so a row revised since the render is never cleared by it) and
 * returns the mutation's promise of the server's receipt, whose `changed` ids are
 * what an Undo should invert. Behaviour, all inherited from `useNotificationsWrite`:
 *
 *  - OPTIMISTIC: rows, page-one facts, the per-conversation unread count and the
 *    badge move before the server answers (`beginOptimisticWrite`);
 *  - OWNED INTENTS: refusal/skipped receipts retire only that gesture; counts are
 *    recomputed from authoritative baselines and remaining intents, not inverses;
 *  - CONFIRMED RECONCILIATION: the receipt's `changed` ids are written into every
 *    cached window and facts answer by the revision-bound intent ledger; later
 *    fetches are reconciled by revision AND seq (read changes don't bump revision).
 *
 * This hook takes explicit rows. Frozen compact selections use beginOptimisticWrite
 * with scope totals and settleCompact; that shared ledger never infers changed IDs
 * from an aggregate count. Ask rows are authoritative-only; waitingUnreadDelta may
 * project their badge, never waiting_count or a pending ask's actual decision.
 */
export function useNotificationReadState() {
	const write = useNotificationsWrite();
	return useMemo(() => {
		const run =
			(verb: NotificationsVerb) =>
			(rows: readonly Pick<DesktopNotificationItem, "id" | "revision">[]) =>
				write.mutateAsync({ verb, target: { items: tokensOf(rows) } });
		return {
			markRead: run("read"),
			markUnread: run("unread"),
			dismiss: run("dismiss"),
			restore: run("undismiss"),
			isPending: write.isPending,
		};
	}, [write.mutateAsync, write.isPending]);
}

/**
 * Edit the cached rows a confirmed write touched, and refresh only the FACTS (R7-1).
 *
 * A write used to invalidate `notificationKeys.all`, which refetched every loaded page
 * of the reel and of every open drawer - the same refetch that once snapped a deep
 * scroll back to the top. The receipt names exactly which ids the server changed, so
 * the cached window is edited in place (`applyConfirmedToWindow`: read/unread flip the
 * flag, dismiss/undismiss flip `dismissed`, which Undo reverses without a row body).
 * Only the facts, the detail and the count are invalidated: they are small reads that
 * the server answers authoritatively.
 */
const editFacts = (
	data: DesktopNotificationsList | undefined,
	changed: readonly string[],
	verb: NotificationsVerb,
) => editFactsForWrite(data, changed, verb);

/**
 * Every row the cache holds, newest revision per id: the facts and the windows.
 * The optimistic write decides from these what the click changes.
 */
function cachedRows(client: QueryClient): Map<string, DesktopNotificationItem> {
	const rows = new Map<string, DesktopNotificationItem>();
	const keep = (item: DesktopNotificationItem) => {
		const previous = rows.get(item.id);
		if (!previous || isNewerNotification(item, previous))
			rows.set(item.id, item);
	};
	for (const root of [
		notificationKeys.factsRoot,
		notificationKeys.sessionFactsAll,
		notificationKeys.listRoot,
		notificationKeys.sessionsRoot,
	])
		for (const [, data] of client.getQueriesData<{
			items?: DesktopNotificationItem[];
			waiting?: DesktopNotificationItem[];
			pages?: {
				items?: DesktopNotificationItem[];
				waiting?: DesktopNotificationItem[];
			}[];
		}>({ queryKey: root })) {
			for (const item of [...(data?.items ?? []), ...(data?.waiting ?? [])])
				keep(item);
			for (const page of data?.pages ?? [])
				for (const item of [...(page?.items ?? []), ...(page?.waiting ?? [])])
					keep(item);
		}
	return rows;
}

type ReadOperation = {
	owner: symbol;
	verb: NotificationsVerb;
	revision: number;
	confirmedAt?: number;
};
type ReadLedgerRow = {
	base: DesktopNotificationItem;
	/** Retain the row at older count fences until those count reads catch up. */
	history: DesktopNotificationItem[];
	operations: ReadOperation[];
};
type CountBaseline = { count: number; seq: number };
/** Frozen TOTAL selection deltas, not a second copy of the loaded-row delta. */
export type NotificationOptimisticScope = {
	throughSeq: number;
	unreadDelta: number;
	/** Ask unread is a badge contribution, never actionable waiting_count. */
	waitingUnreadDelta?: number;
	sessionUnreadDeltas: Readonly<Record<string, number>>;
};
type PendingScope = NotificationOptimisticScope & {
	knownDelta: number;
	knownSessionDeltas: Map<string, number>;
};
type NotificationLedger = {
	rows: Map<string, ReadLedgerRow>;
	global?: CountBaseline;
	waiting?: CountBaseline;
	sessions: Map<string, CountBaseline>;
	scopes: Map<symbol, PendingScope>;
	/** Keep absent metadata fenced against older fetches completing afterwards. */
	absent: Map<string, number>;
	publishing: boolean;
};
const readLedgers = new WeakMap<QueryClient, NotificationLedger>();
const isUnread = (row: DesktopNotificationItem) =>
	Number(!row.read && !row.dismissed);

/** At a count watermark only confirmed intents at/below that watermark are included. */
function projectReadRow(
	entry: ReadLedgerRow,
	at?: number,
): DesktopNotificationItem {
	let row =
		at === undefined
			? entry.base
			: ([...entry.history, entry.base]
					.filter((candidate) => candidate.seq <= at)
					.at(-1) ??
				entry.history[0] ??
				entry.base);
	for (const operation of entry.operations) {
		if (
			operation.revision !== row.revision ||
			(at !== undefined &&
				(operation.confirmedAt === undefined || operation.confirmedAt > at)) ||
			(operation.confirmedAt !== undefined && row.seq >= operation.confirmedAt)
		)
			continue;
		row = applyConfirmedToWindow(
			[{ items: [row] }],
			[row.id],
			operation.verb,
		)[0].items[0];
	}
	return row;
}

function acceptCount(
	previous: CountBaseline | undefined,
	count: number,
	seq: number,
): CountBaseline {
	return !previous || seq >= previous.seq ? { count, seq } : previous;
}

/** All list facts carry GLOBAL unread_count, including session-filtered answers. */
function ingestNotificationAnswer(
	ledger: NotificationLedger,
	key: readonly unknown[],
	data: unknown,
): void {
	if (!data || key[0] !== "desktop" || key[1] !== "notifications") return;
	if (key[2] === "session-unread" && typeof data === "number") {
		const session = String(key[3]);
		ledger.sessions.set(
			session,
			acceptCount(ledger.sessions.get(session), data, Number(key[4]) || 0),
		);
		return;
	}
	const answer = data as Partial<DesktopNotificationsList> & {
		pages?: DesktopNotificationsList[];
	};
	if (
		["facts", "session-facts", "count"].includes(String(key[2])) &&
		typeof answer.unread_count === "number"
	)
		ledger.global = acceptCount(
			ledger.global,
			answer.unread_count,
			answer.high_water ?? 0,
		);
	if (
		["facts", "session-facts", "count"].includes(String(key[2])) &&
		typeof answer.waiting_unread_count === "number"
	)
		ledger.waiting = acceptCount(
			ledger.waiting,
			answer.waiting_unread_count,
			answer.high_water ?? 0,
		);
	for (const row of [
		...(answer.items ?? []),
		...(answer.pages ?? []).flatMap((page) => page.items),
	]) {
		const entry = ledger.rows.get(row.id);
		if (
			entry &&
			(row.revision > entry.base.revision || row.seq > entry.base.seq)
		) {
			entry.history.push(entry.base);
			entry.base = row;
		}
	}
}

/** Recompute projections, not inverse arithmetic against whichever answer arrived last. */
function publishNotificationLedger(
	client: QueryClient,
	ledger: NotificationLedger,
): void {
	if (ledger.publishing) return;
	ledger.publishing = true;
	try {
		const countAt = (baseline: CountBaseline, session?: string) => {
			let delta = 0;
			for (const entry of ledger.rows.values()) {
				if (session && entry.base.session.id !== session) continue;
				delta +=
					isUnread(projectReadRow(entry)) -
					isUnread(projectReadRow(entry, baseline.seq));
			}
			for (const scope of ledger.scopes.values())
				delta += session
					? (scope.sessionUnreadDeltas[session] ?? 0) -
						(scope.knownSessionDeltas.get(session) ?? 0)
					: scope.unreadDelta - scope.knownDelta;
			return Math.max(0, baseline.count + delta);
		};
		const waitingUnread = ledger.waiting
			? Math.max(
					0,
					ledger.waiting.count +
						[...ledger.scopes.values()].reduce(
							(sum, scope) => sum + (scope.waitingUnreadDelta ?? 0),
							0,
						),
				)
			: undefined;
		const updateRows = (rows: DesktopNotificationItem[]) =>
			rows
				.filter((row) => row.seq > (ledger.absent.get(row.id) ?? -1))
				.map((row) => {
					const entry = ledger.rows.get(row.id);
					if (!entry) return row;
					const next = projectReadRow(entry);
					return isNewerNotification(next, row)
						? {
								...row,
								read: next.read,
								read_via: next.read_via,
								dismissed: next.dismissed,
							}
						: row;
				});
		for (const root of [
			notificationKeys.listRoot,
			notificationKeys.sessionsRoot,
		])
			client.setQueriesData<{ pages: DesktopNotificationsList[] }>(
				{ queryKey: root },
				(data) =>
					data?.pages
						? {
								...data,
								pages: data.pages.map((page) => ({
									...page,
									items: updateRows(page.items),
									...(page.waiting
										? { waiting: updateRows(page.waiting) }
										: {}),
								})),
							}
						: data,
			);
		for (const root of [
			notificationKeys.factsRoot,
			notificationKeys.sessionFactsAll,
		])
			client.setQueriesData<DesktopNotificationsList>(
				{ queryKey: root },
				(data) =>
					data?.items
						? {
								...data,
								items: updateRows(data.items),
								...(data.waiting ? { waiting: updateRows(data.waiting) } : {}),
								waiting_unread_count:
									waitingUnread ?? data.waiting_unread_count,
								unread_count: ledger.global
									? countAt(ledger.global)
									: data.unread_count,
							}
						: data,
			);
		client.setQueryData<DesktopNotificationsCount>(
			notificationKeys.count,
			(data) =>
				data && ledger.global
					? {
							...data,
							unread_count: countAt(ledger.global),
							waiting_unread_count: waitingUnread ?? data.waiting_unread_count,
						}
					: data,
		);
		for (const [session, baseline] of ledger.sessions)
			client.setQueriesData<number>(
				{ queryKey: notificationKeys.sessionUnread(session) },
				(data) =>
					typeof data === "number" ? countAt(baseline, session) : data,
			);
	} finally {
		ledger.publishing = false;
	}
}

function notificationLedger(client: QueryClient): NotificationLedger {
	const existing = readLedgers.get(client);
	if (existing) return existing;
	const ledger: NotificationLedger = {
		rows: new Map(),
		sessions: new Map(),
		scopes: new Map(),
		absent: new Map(),
		publishing: false,
	};
	readLedgers.set(client, ledger);
	for (const [key, data] of client.getQueriesData({
		queryKey: notificationKeys.all,
	}))
		ingestNotificationAnswer(ledger, key, data);
	// A pre-click request is cancelled, but a feed-triggered request can start later.
	// Rebase its authoritative answer then replay still-pending intents immediately;
	// an older count/row never erases the visible click. Self-published projections
	// are excluded so they cannot become authoritative baselines.
	client.getQueryCache().subscribe((event) => {
		if (
			ledger.publishing ||
			event.type !== "updated" ||
			event.action.type !== "success" ||
			event.query.queryKey[0] !== "desktop" ||
			event.query.queryKey[1] !== "notifications"
		)
			return;
		ingestNotificationAnswer(
			ledger,
			event.query.queryKey,
			event.query.state.data,
		);
		publishNotificationLedger(client, ledger);
	});
	return ledger;
}

/**
 * A reversible intent, not an inverse verb. rollback() retires this intent;
 * settle(fullReceipt) commits changed IDs and retires skipped IDs. Bulk callers
 * must settle the FULL receipt, never applyConfirmedWrite(changed) afterwards.
 */
/** V2 metadata consumed by the shared store; mutation counts are never row IDs. */
export type CompactNotificationReceipt = Pick<
	DesktopNotificationsWriteResult,
	"unread_count" | "waiting_count" | "waiting_unread_count" | "high_water"
> & {
	selection_version?: 2;
	counts_high_water?: number;
	session_counts?: Record<string, { unread_count?: number }>;

	reconciliation?: {
		items: DesktopNotificationItem[];
		absent_ids: string[];
		high_water: number;
	};
};

export type OptimisticNotificationWrite = (() => void) & {
	settle: (receipt: DesktopNotificationsWriteResult) => void;
	settleCompact: (receipt: CompactNotificationReceipt) => void;
};

/**
 * Shared revision-bound transaction. Tokens are preferred; IDs retain compatibility
 * for callers whose frozen rows are already loaded. Frozen scope deltas are TOTALS,
 * including known rows; only their off-page remainder supplements row projections.
 * Rollback derives from the newest authoritative count baseline plus remaining
 * intents, never by negating the originally captured delta after a concurrent read.
 * The scalar scope is NOT proof of any individual success: compact settlement must
 * retire it and use authoritative response aggregates and bounded reconciliation.
 */
export async function beginOptimisticWrite(
	client: ReturnType<typeof useOptionalQueryClient>["client"],
	verb: NotificationsVerb,
	tokens: readonly (
		| string
		| Pick<DesktopNotificationItem, "id" | "revision">
	)[],
	scope?: NotificationOptimisticScope,
): Promise<OptimisticNotificationWrite | undefined> {
	if (!client || (!tokens.length && !scope)) return undefined;
	await client.cancelQueries({ queryKey: notificationKeys.all });
	const ledger = notificationLedger(client);
	const known = cachedRows(client);
	const owner = Symbol("notification-write");
	const ids: string[] = [];
	let knownDelta = 0;
	const knownSessionDeltas = new Map<string, number>();
	for (const token of tokens) {
		const id = typeof token === "string" ? token : token.id;
		const row = known.get(id);
		if (!row || row.source !== "notify" || ids.includes(id)) continue;
		let entry = ledger.rows.get(id);
		if (
			!entry ||
			row.revision > entry.base.revision ||
			row.seq > entry.base.seq
		) {
			entry = {
				base: row,
				history: entry ? [...entry.history, entry.base] : [],
				operations: entry?.operations ?? [],
			};
			ledger.rows.set(id, entry);
		}
		const before = projectReadRow(entry);
		entry.operations.push({
			owner,
			verb,
			revision: typeof token === "string" ? row.revision : token.revision,
		});
		const delta = isUnread(projectReadRow(entry)) - isUnread(before);
		knownDelta += delta;
		knownSessionDeltas.set(
			row.session.id,
			(knownSessionDeltas.get(row.session.id) ?? 0) + delta,
		);
		ids.push(id);
	}
	if (scope)
		ledger.scopes.set(owner, {
			...scope,
			sessionUnreadDeltas: { ...scope.sessionUnreadDeltas },
			knownDelta,
			knownSessionDeltas,
		});
	publishNotificationLedger(client, ledger);
	let settled = false;
	const finish = (receipt?: DesktopNotificationsWriteResult) => {
		if (settled) return;
		settled = true;
		ledger.scopes.delete(owner);
		const changed = new Set(receipt?.changed ?? []);
		for (const id of ids) {
			const entry = ledger.rows.get(id);
			if (!entry) continue;
			entry.operations = entry.operations.flatMap((operation) => {
				if (operation.owner !== owner) return [operation];
				return changed.has(id)
					? [
							{
								...operation,
								confirmedAt: receipt?.high_water ?? Number.POSITIVE_INFINITY,
							},
						]
					: [];
			});
		}
		if (receipt) {
			ledger.global = acceptCount(
				ledger.global,
				receipt.unread_count,
				receipt.high_water,
			);
			ledger.waiting = acceptCount(
				ledger.waiting,
				receipt.waiting_unread_count,
				receipt.high_water,
			);
			// V1 has no authoritative per-session aggregate. Its accepted known rows
			// remain overlays until the session count walk supplies a newer watermark.
		}
		publishNotificationLedger(client, ledger);
	};
	return Object.assign(() => finish(), {
		settle: (receipt: DesktopNotificationsWriteResult) => finish(receipt),
		settleCompact: (receipt: CompactNotificationReceipt) => {
			if (settled) return;
			// Compact changed_count cannot identify skipped rows. Retire this intent,
			// then adopt separately fenced authoritative metadata (including replays).
			finish();
			ledger.global = acceptCount(
				ledger.global,
				receipt.unread_count,
				receipt.high_water,
			);
			ledger.waiting = acceptCount(
				ledger.waiting,
				receipt.waiting_unread_count,
				receipt.high_water,
			);
			for (const [session, counts] of Object.entries(
				receipt.session_counts ?? {},
			))
				if (
					typeof receipt.counts_high_water === "number" &&
					typeof counts.unread_count === "number"
				)
					ledger.sessions.set(
						session,
						acceptCount(
							ledger.sessions.get(session),
							counts.unread_count,
							receipt.counts_high_water,
						),
					);
			const reconciliation = receipt.reconciliation;
			if (reconciliation) {
				const current = cachedRows(client);
				const fresh = new Map(
					reconciliation.items
						.filter((row) => {
							const previous = current.get(row.id);
							return !previous || isNewerNotification(row, previous);
						})
						.map((row) => [row.id, row]),
				);
				const absent = new Set(
					reconciliation.absent_ids.filter(
						(id) => (current.get(id)?.seq ?? 0) <= reconciliation.high_water,
					),
				);
				for (const [id, row] of fresh) {
					const entry = ledger.rows.get(id);
					if (entry) {
						entry.history.push(entry.base);
						entry.base = row;
					}
				}
				for (const id of absent) {
					ledger.rows.delete(id);
					ledger.absent.set(id, reconciliation.high_water);
				}
				const reconcileRows = (rows: DesktopNotificationItem[]) =>
					rows
						.filter((row) => !absent.has(row.id))
						.map((row) => fresh.get(row.id) ?? row);
				ledger.publishing = true;
				try {
					for (const root of [
						notificationKeys.factsRoot,
						notificationKeys.sessionFactsAll,
					])
						client.setQueriesData<DesktopNotificationsList>(
							{ queryKey: root },
							(data) =>
								data?.items
									? {
											...data,
											items: reconcileRows(data.items),
											...(data.waiting
												? { waiting: reconcileRows(data.waiting) }
												: {}),
										}
									: data,
						);
					for (const root of [
						notificationKeys.listRoot,
						notificationKeys.sessionsRoot,
					])
						client.setQueriesData<{ pages: DesktopNotificationsList[] }>(
							{ queryKey: root },
							(data) =>
								data?.pages
									? {
											...data,
											pages: data.pages.map((page) => ({
												...page,
												items: reconcileRows(page.items),
												...(page.waiting
													? { waiting: reconcileRows(page.waiting) }
													: {}),
											})),
										}
									: data,
						);
				} finally {
					ledger.publishing = false;
				}
			} else {
				// Older servers: refresh active page-one facts only, never an infinite
				// window's whole history. V2 callers request <=500 visible/cached IDs so
				// deep windows ordinarily settle from SAME-response metadata above.
				void client.refetchQueries({
					queryKey: notificationKeys.factsRoot,
					type: "active",
				});
				void client.refetchQueries({
					queryKey: notificationKeys.sessionFactsAll,
					type: "active",
				});
			}
			if (
				reconciliation &&
				(receipt.counts_high_water === undefined ||
					Object.values(receipt.session_counts ?? {}).some(
						(counts) => counts.unread_count === undefined,
					))
			)
				void client.refetchQueries({
					queryKey: notificationKeys.sessionFactsAll,
					type: "active",
				});
			publishNotificationLedger(client, ledger);
		},
	});
}

export function applyConfirmedWrite(
	client: ReturnType<typeof useOptionalQueryClient>["client"],
	verb: NotificationsVerb,
	changed: readonly string[],
): void {
	if (!client || changed.length === 0) return;
	const ledger = readLedgers.get(client);
	if (ledger) {
		for (const id of changed) {
			const entry = ledger.rows.get(id);
			if (entry) {
				const pending = [...entry.operations]
					.reverse()
					.find(
						(operation) =>
							operation.verb === verb && operation.confirmedAt === undefined,
					);
				if (pending) pending.confirmedAt = entry.base.seq + 1;
				else
					entry.operations.push({
						owner: Symbol("external-receipt"),
						verb,
						revision: entry.base.revision,
						confirmedAt: entry.base.seq + 1,
					});
			}
		}
		ledger.publishing = true;
	}
	/*
	 * ONLY INFINITE QUERIES CARRY PAGES (code round 8, R8-1). This updater used to run
	 * over `sessionFactsAll` too, whose entries are plain page-one answers with no
	 * `pages` array, so `applyConfirmedToWindow` threw a TypeError inside the write's
	 * onSuccess: the operator saw "Couldn't mark read - nothing changed" (or an uncaught
	 * TypeError) while the server HAD applied the write. The facts are invalidated
	 * below anyway, so they need no edit - and every cached entry is shape-checked so a
	 * future key of a different shape cannot break the write path either.
	 */
	const editWindow = (data?: { pages?: unknown[]; pageParams?: unknown[] }) => {
		if (!data || !Array.isArray(data.pages)) return data;
		return {
			...data,
			pages: applyConfirmedToWindow(
				data.pages as { items: DesktopNotificationItem[] }[],
				changed,
				verb,
			),
		};
	};
	client.setQueriesData({ queryKey: notificationKeys.listRoot }, editWindow);
	client.setQueriesData(
		{ queryKey: notificationKeys.sessionsRoot },
		editWindow,
	);
	/*
	 * THE FACTS ARE EDITED TOO, not only invalidated (the drawer's "click twice"
	 * defect). At the top of a list `mergeWindowForReel` lets page one's facts win
	 * over the window on an EQUAL revision, and core's read/unread moves `seq`, not
	 * `revision` - so until the facts refetch landed, the stale facts row
	 * (`read: false`) was what the drawer and the reel drew, hiding the confirmed
	 * flip. The edit is idempotent, so it is safe after an optimistic one.
	 */
	client.setQueriesData<DesktopNotificationsList>(
		{ queryKey: notificationKeys.factsRoot },
		(data) => editFacts(data, changed, verb),
	);
	client.setQueriesData<DesktopNotificationsList>(
		{ queryKey: notificationKeys.sessionFactsAll },
		(data) => editFacts(data, changed, verb),
	);
	if (ledger) {
		ledger.publishing = false;
		publishNotificationLedger(client, ledger);
	}
	void client.invalidateQueries({ queryKey: notificationKeys.factsRoot });
	void client.invalidateQueries({ queryKey: notificationKeys.sessionFactsAll });
	void client.invalidateQueries({ queryKey: notificationKeys.count });
	for (const id of changed)
		void client.invalidateQueries({
			queryKey: notificationKeys.detail(id),
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

/** Compact receipts keep a select-all over a large result one HTTP write. */
export type NotificationBulkReceipt = {
	changed_count: number;
	skipped_count: number;
	skipped_ask_count: number;
	operation_token: string;
	through_seq: number;
	high_water: number;
	counts_high_water?: number;
	// V1 servers omit the field; the shared facade only recognizes version 2.
	selection_version?: 2;
	changed_update_count?: number;
	changed_ask_count?: number;
	waiting_unread_delta?: number;
	reconciliation?: {
		items: DesktopNotificationItem[];
		absent_ids: string[];
		high_water: number;
	};
	unread_delta: number;
	// `unread_count` is the v2 per-session total, fenced by `counts_high_water`;
	// v1 omits it, and the facade then keeps the session overlay until a walk lands.
	session_counts: Record<
		string,
		{ changed_count: number; unread_delta: number; unread_count?: number }
	>;
	unread_count: number;
	waiting_count: number;
	waiting_unread_count: number;
};

export async function previewNotificationSelection(
	filters: FrozenNotificationSelection["filters"],
	state: "unread" | "all",
	countSessionIds: string[] = [],
	includeAskReads = false,
): Promise<NotificationSelectionPreview> {
	const result = await desktopResult<{
		selection: NotificationSelectionPreview;
	}>({
		op: "notifications.list",
		preview: true,
		state,
		kind: filters.kind,
		bulkPriority: filters.priority,
		countSessionIds,
		...(includeAskReads ? { includeAskReads: true } : {}),
		...(filters.from ? { sessionId: filters.from } : {}),
	});
	return result.selection;
}

/**
 * The same optimistic cache edit as individual writes. A frozen scope is a
 * server token rather than a client-side page walk; the adapter only projects
 * the rows already cached, never manufactures off-page notification bodies.
 * On a partial receipt the projection is withdrawn and authoritative facts are
 * fetched: compact counts cannot identify which individual revisions skipped.
 */

export function useNotificationBulkState(onResetWindows?: () => void) {
	const { client } = useOptionalQueryClient();
	const operations = useRef(
		new Map<
			string,
			{
				verb: "read" | "unread" | "dismiss";
				receipt: NotificationBulkReceipt;
				reconcileIds: string[];
				canReconcile: boolean;
			}
		>(),
	);
	const activeSessionIds = useCallback(
		() =>
			client
				? client
						.getQueryCache()
						.findAll({
							queryKey: notificationKeys.sessionUnread(null).slice(0, -1),
						})
						.filter((query) => query.isActive())
						.map((query) => String(query.queryKey[3]))
						.slice(0, 50)
				: [],
		[client],
	);
	const reconcileIds = useCallback(
		(visible: string[]) => {
			const cached = client ? [...cachedRows(client).keys()] : [];
			// The explicit viewport IDs come first: a deep-scroll row must not be
			// crowded out by hundreds of cached rows above it. Never send all IDs in
			// the server result; these are bounded READ metadata, not selection.
			return [...new Set([...visible, ...cached])].slice(0, 500);
		},
		[client],
	);
	/*
	 * V1 RECEIPTS CARRY NO ROWS. Without `reconciliation`, the shared facade can only
	 * refetch page-one facts, and `mergeWindowForReel` keeps every row the loaded
	 * infinite window already holds, so a select-all dismiss left up to a page of
	 * dismissed rows drawn (and an Undo left them missing). Compact receipts never say
	 * WHICH rows changed, so guessing per-row flips is ruled out. Resetting drops the
	 * loaded pages and refetches page one, the same move as "back to top"
	 * (`resetToTop`). Only v1 settles this way; v2 rows come back in the response.
	 */
	const resetWindows = useCallback(() => {
		if (!client) return;
		if (onResetWindows) onResetWindows();
		else void client.resetQueries({ queryKey: notificationKeys.listRoot });
		void client.resetQueries({ queryKey: notificationKeys.sessionsRoot });
	}, [client, onResetWindows]);
	const apply = useCallback(
		async (
			verb: "read" | "unread" | "dismiss",
			selection: FrozenNotificationSelection,
			visibleIds: string[] = [],
		): Promise<NotificationBulkReceipt> => {
			operations.current.clear();
			const rows = client
				? [...cachedRows(client).values()].filter((item) =>
						selectedBySnapshot(item, selection),
					)
				: [];
			const intent = await beginOptimisticWrite(
				client,
				verb,
				tokensOf(rows),
				notificationSelectionScope(selection, verb),
			);
			const reconciliation = reconcileIds(visibleIds);
			try {
				const target = {
					selectionToken: selection.preview.token,
					excludedIds: [...selection.excluded.keys()],
					...(selection.preview.selection_version === 2
						? { reconcileIds: reconciliation }
						: {}),
				};
				const receipt = await desktopResult<NotificationBulkReceipt>(
					verb === "dismiss"
						? { op: "notifications.dismiss", verb, target }
						: { op: "notifications.read", verb, target },
				);
				intent?.settleCompact(receipt);
				if (selection.preview.selection_version !== 2) resetWindows();
				operations.current.set(receipt.operation_token, {
					verb,
					receipt,
					reconcileIds: reconciliation,
					canReconcile: selection.preview.selection_version === 2,
				});
				return receipt;
			} catch (error) {
				intent?.();
				throw error;
			}
		},
		[client, reconcileIds, resetWindows],
	);
	const applyItems = useCallback(
		async (
			verb: "read" | "unread" | "dismiss",
			items: DesktopNotificationItem[],
			throughSeq: number,
			v2 = false,
			visibleIds: string[] = [],
		): Promise<{
			receipts: NotificationBulkReceipt[];
			pending: number;
			skippedAsks: number;
			error?: unknown;
		}> => {
			operations.current.clear();
			/*
			 * The caller's button check belongs to an earlier render. Filter the actual
			 * frozen array at this last client boundary too, so an ask that arrived after
			 * that check can never be sent to notifications.dismiss. Keep the caller's
			 * requested 500-item batch boundaries; removing asks only shrinks a batch.
			 */
			const plan = verb === "dismiss" ? dismissPlan(items) : null;
			const targets = plan?.dismissable ?? items;
			const skippedAsks = plan?.asksStaying ?? 0;
			const receipts: NotificationBulkReceipt[] = [];
			const reconciliation = reconcileIds(visibleIds);
			for (let offset = 0; offset < targets.length; offset += 500) {
				const batch = targets.slice(offset, offset + 500);
				const intent = await beginOptimisticWrite(
					client,
					verb,
					tokensOf(batch),
				);
				try {
					const target = {
						items: tokensOf(batch),
						throughSeq,
						receipt: true as const,
						...(v2 ? { reconcileIds: reconciliation } : {}),
					};
					const receipt = await desktopResult<NotificationBulkReceipt>(
						verb === "dismiss"
							? { op: "notifications.dismiss", verb, target }
							: { op: "notifications.read", verb, target },
					);
					intent?.settleCompact(receipt);
					if (!v2) resetWindows();
					operations.current.set(receipt.operation_token, {
						verb,
						receipt,
						reconcileIds: reconciliation,
						canReconcile: v2,
					});
					receipts.push(receipt);
				} catch (error) {
					intent?.();
					return {
						receipts,
						pending: targets.length - offset,
						skippedAsks,
						error,
					};
				}
			}
			return { receipts, pending: 0, skippedAsks };
		},
		[client, reconcileIds, resetWindows],
	);
	const undo = useCallback(
		async (operationToken: string) => {
			const original = operations.current.get(operationToken);
			if (!original) throw new Error("No retained notification operation");
			const { receipt: before } = original;
			const sessionUnreadDeltas = Object.fromEntries(
				Object.entries(before.session_counts).map(([id, counts]) => [
					id,
					-counts.unread_delta,
				]),
			);
			// Compact counts do not prove which individual rows the journal changed.
			// A NEW aggregate intent is safe; guessed per-row inverses are not. Rows
			// return from authoritative reconciliation in the same Undo response.
			const intent = await beginOptimisticWrite(
				client,
				inverseNotificationVerb(original.verb),
				[],
				{
					throughSeq: before.counts_high_water ?? before.high_water,
					unreadDelta:
						before.counts_high_water === undefined ? 0 : -before.unread_delta,
					waitingUnreadDelta:
						before.counts_high_water === undefined
							? 0
							: -(before.waiting_unread_delta ?? 0),
					sessionUnreadDeltas:
						before.counts_high_water === undefined ? {} : sessionUnreadDeltas,
				},
			);
			try {
				const receipt = await desktopResult<NotificationBulkReceipt>({
					op: "notifications.read",
					verb: "undo",
					target: {
						operationToken,
						...(original.canReconcile
							? { reconcileIds: original.reconcileIds }
							: {}),
					},
				});
				intent?.settleCompact(receipt);
				if (!original.canReconcile) resetWindows();
				return receipt;
			} catch (error) {
				intent?.();
				throw error;
			}
		},
		[client, resetWindows],
	);
	return { apply, applyItems, undo, activeSessionIds };
}
