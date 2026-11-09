/**
 * The Team Bridge page's reads and writes.
 *
 * Two cadences, deliberately different:
 *
 * - the conversation LIST re-reads on window focus and after every write, but
 *   does not poll: a person looking at the page can pull to refresh through the
 *   focus event, and a constant list poll would be a second, redundant traffic
 *   source beside the badge. The ONE exception is the notification watcher,
 *   which mounts its own observer on the same cache entry with a 30 s cadence
 *   (`use-team-bridge-notifications.ts`): a banner needs the membership and
 *   notify fields the list carries, and it has to run while the page is not
 *   mounted. The page's own observer still asks for no interval.
 * - the BADGE (`unread`) polls, because nothing pushes it: the hub has an
 *   events feed for the pair lane, and this surface deliberately reads one
 *   cheap aggregate instead of subscribing per conversation.
 *
 * QUIET WHEN ACTIVE. The badge poll is 60 s while the window is hidden and
 * 3 minutes while it is visible: a foreground list is already on screen, so
 * the poll is only there to catch a message that arrived while the user was in
 * another conversation on the same page. The notification policy is the
 * caller's (`shouldNotify`), not the query's.
 *
 * NO BODY IS CACHED HERE. React Query holds the last answer in memory for the
 * mounted page, which is the renderer's own view state; nothing is written to
 * disk and no message body is included in the unread read at all.
 */
import {
	TeamBridgeApi,
	type TeamBridgeMentionRow,
	requireBridgeWriteAccount,
} from "@shared/api/local-operator/team-bridge-api";
import { usePassiveDesktopFeature } from "@shared/hooks/display-density";
import { observedRadientAuthority } from "@shared/hooks/radient-account-authority";
import {
	type QueryClient,
	type QueryKey,
	type UseMutationOptions,
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AgentMessagesStatus } from "../../../../shared/agent-messages-contract";
import type {
	TeamBridgeConversation,
	TeamBridgeConversationList,
	TeamBridgeDirectory,
	TeamBridgeDirectoryMember,
	TeamBridgeEvent,
	TeamBridgeMemberInput,
	TeamBridgeMessage,
	TeamBridgeMessagePage,
	TeamBridgeNotify,
	TeamBridgeReadState,
	TeamBridgeThreadReadState,
	TeamBridgeUnread,
} from "../../../../shared/team-bridge-contract";
import {
	type ChannelMessages,
	TEAM_BRIDGE_HISTORY_GC_MS,
	TEAM_BRIDGE_HISTORY_STALE_MS,
	TEAM_BRIDGE_PAGE_SIZE,
	channelViewOrder,
	historyReadRetry,
	historyReadRetryDelay,
	mergeChannelPage,
	mergeOlderPageAtCursor,
	rememberChannelView,
	selectChannelEvictions,
	withChannelMessages,
} from "./team-bridge-channel-cache";
import {
	TEAM_BRIDGE_AGENT_PARTICIPATION_VERSION,
	withAgentInvitationAnswer,
	withoutAgentInvitationAnswer,
} from "./team-bridge-invitations-model";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeScope,
	agentNotifyLevel,
	isNotAMemberRefusal,
	ownActiveAgent,
	withAppendedPage,
	withConversationStatus,
	withNotificationPreference,
	withOwnAgentNotify,
	withOwnAgentNotifyRolledBack,
	withServedOwnAgentNotify,
	withoutConversation,
} from "./team-bridge-model";

/**
 * Query keys are SCOPE-KEYED, deliberately.
 *
 * `scope` is a tenant id or the `"all"` sentinel, and it is part of every read
 * key below. A person switching organizations must never see the previous
 * organization's cached rows under the new title: the rail refetches into a
 * different key, and the old one stays warm without being rendered. Messages
 * are keyed by the CONVERSATION'S tenant rather than the rail scope, because a
 * conversation opened from the merged view still belongs to exactly one
 * organization.
 *
 * The two prefix keys exist for invalidation only: a write refreshes every
 * scope that could have shown the row (the merged list and the org list), and
 * the badge aggregate is one cache shared by the sidebar and the page.
 */
import { clearStagedMentions, stagedMentions } from "./mentions/mention-outbox";
import { teamBridgeKeys } from "./team-bridge-keys";
import {
	bridgeOwnerCurrent,
	readForBridgeAccount,
	readForBridgeOwner,
	useBridgeOwner,
	useTeamBridgeAccount,
} from "./team-bridge-owner";
import {
	type TeamBridgeUnreadSnapshot,
	applyTeamBridgeReadCursor,
	cancelTeamBridgeUnreadReads,
	restoreTeamBridgeUnreadSnapshot,
} from "./team-bridge-unread-sync";
export { teamBridgeKeys } from "./team-bridge-keys";
import {
	type CapturedBridgeMutation,
	bindBridgeMutation,
} from "./team-bridge-mutation";

type BridgeWriteTarget = ReturnType<typeof useBridgeOwner> & {
	conversationId: string;
	tenantId?: string;
};

/** Map the UI scope onto the wire's read scope (the only place the sentinel is translated). */
function readScope(scope: TeamBridgeScope) {
	return scope === TEAM_BRIDGE_ALL_SCOPE
		? ("account" as const)
		: { tenantId: scope };
}

/** How long the badge may be stale in each window state. */
export const TEAM_BRIDGE_BADGE_POLL_VISIBLE_MS = 180_000;
export const TEAM_BRIDGE_BADGE_POLL_HIDDEN_MS = 60_000;

function badgeInterval(): number {
	if (typeof document === "undefined") return TEAM_BRIDGE_BADGE_POLL_HIDDEN_MS;
	return document.visibilityState === "visible"
		? TEAM_BRIDGE_BADGE_POLL_VISIBLE_MS
		: TEAM_BRIDGE_BADGE_POLL_HIDDEN_MS;
}

export function useTeamBridgeConversations(
	scope: TeamBridgeScope,
	enabled = true,
	accountId?: string,
): UseQueryResult<TeamBridgeConversationList> {
	const client = useQueryClient();
	return useQuery({
		queryKey: teamBridgeKeys.conversations(
			scope,
			accountId ?? "unresolved-owner",
		),
		queryFn: () =>
			readForBridgeOwner(client, accountId, () =>
				TeamBridgeApi.listConversations(readScope(scope)),
			),
		enabled: enabled && Boolean(accountId),
		staleTime: 15_000,
		refetchOnWindowFocus: true,
	});
}

/**
 * The ARCHIVED half of the conversation list (the "Archived channels" surface).
 *
 * Off until the surface is first opened (`enabled`): archived channels are a
 * rare admin destination, so the page never spends this read on a reader who
 * does not look. The server decides what the caller sees here (their own
 * archived conversations, plus an organization owner/admin's archived
 * tenant-visible channels); the client only asks.
 */
export function useArchivedTeamBridgeConversations(
	scope: TeamBridgeScope,
	enabled = true,
	accountId?: string,
): UseQueryResult<TeamBridgeConversationList> {
	const client = useQueryClient();
	return useQuery({
		queryKey: teamBridgeKeys.archivedConversations(
			scope,
			accountId ?? "unresolved-owner",
		),
		queryFn: () =>
			readForBridgeOwner(client, accountId, () =>
				TeamBridgeApi.listConversations(readScope(scope), "archived"),
			),
		enabled: enabled && Boolean(accountId),
		staleTime: 15_000,
		refetchOnWindowFocus: true,
	});
}

/**
 * "Load more" for the Archived channels view (review round 1, U4).
 *
 * WHY NOT `useInfiniteQuery`. The archive, unarchive and delete writes patch every
 * owned conversation page with `withoutConversation` / `withConversationStatus`,
 * which take the single-page shape. An infinite query's `{pages}` shape would make
 * each of those crash or silently skip the archived list, so the first page stays an
 * ordinary query and this appends the next page into the same cache entry.
 *
 * KNOWN, DELIBERATE LIMIT: any refetch of the archived key (every lifecycle write
 * invalidates it) returns to the first page and "Load more" reappears. Re-walking
 * every loaded page on each refetch would spend one request per page to preserve a
 * scroll position nobody asked to keep; the first page is the server's newest.
 */
export function useLoadMoreArchivedTeamBridgeConversations(
	scope: TeamBridgeScope,
	accountId?: string,
): UseMutationResult<TeamBridgeConversationList, Error, void> {
	const client = useQueryClient();
	const key = teamBridgeKeys.archivedConversations(
		scope,
		accountId ?? "unresolved-owner",
	);
	return useMutation({
		mutationFn: async () => {
			const current = client.getQueryData<TeamBridgeConversationList>(key);
			const cursor = current?.next_cursor;
			if (!current || !cursor) return current ?? { conversations: [] };
			const next = await readForBridgeOwner(client, accountId, () =>
				TeamBridgeApi.listConversations(readScope(scope), "archived", cursor),
			);
			return withAppendedPage(current, next);
		},
		onSuccess: (page) => {
			client.setQueryData(key, page);
		},
	});
}

/**
 * The timeline read's key and reader, shared by the page's observer and the
 * shell's notification watcher.
 *
 * WHY SHARED. A banner used to read the newest message straight through the
 * API, so the page's cached page for that conversation stayed whatever it was
 * when the reader last looked. Clicking the banner then painted that stale page
 * and the message appeared seconds later, on the next poll (operator report,
 * 2026-10-30). The watcher now reads through THIS key and reader, so the entry
 * it writes is exactly the entry the timeline renders. Two literals for one key
 * would drift the first time either side changed, silently reopening the gap.
 *
 * THE READ IS ONE PAGE, ALWAYS. `limit` is the whole point: this route used to
 * be called with no limit at all, so a busy conversation answered with its
 * entire history on every open and every eight-second poll, and the only way
 * back was to mount all of it. The newest page is what a reader opens on;
 * older pages come from `loadOlder` (proximity paging), and the merge keeps
 * whatever the reader has already paged back through
 * (`team-bridge-channel-cache.ts`).
 *
 * MEMBERSHIP EVENTS RIDE THE SAME READ and keep their existing carry: dedupe by
 * id, newest copy wins, bounded by the page that owns them. They live in the
 * entry beside the messages, untouched by paging.
 */
export function teamBridgeMessagesQueryOptions(
	client: QueryClient,
	conversationId: string | null,
	tenantId?: string,
	accountId?: string,
) {
	return {
		queryKey: teamBridgeKeys.messages(
			conversationId ?? "none",
			tenantId,
			accountId ?? "unresolved-owner",
		),
		// Typed explicitly: a plain object returned from a factory has no
		// `useQuery` call site to infer the context from.
		/*
		 * MERGED AT WRITE TIME, NOT AT FETCH TIME (agent review round 1, M1).
		 * `getQueryData` in the argument list would be evaluated BEFORE the
		 * round trip, so whatever landed in the entry while the request was in
		 * flight - an older page from `loadOlder`, a thread-unread patch, the
		 * shell watcher's own read - would be overwritten by a window built from
		 * a stale snapshot (measured: 60 rows lost, `oldestSeq` 881 → 941). The
		 * updater below reads the CURRENT entry at the moment the answer is
		 * written, which is the only place the merge can see everything.
		 */
		queryFn: async ({ queryKey }: { queryKey: QueryKey }) => {
			const page = await readForBridgeOwner(client, accountId, () =>
				TeamBridgeApi.listMessages(conversationId as string, {
					...(tenantId ? { tenantId } : {}),
					limit: TEAM_BRIDGE_PAGE_SIZE,
				}),
			);
			client.setQueryData<ChannelMessages>(queryKey, (current) =>
				mergeChannelPage(current, page, "newest"),
			);
			/* Read back rather than returning the updater's result: `setQueryData`
			 * can answer `undefined` by type, and every reader of this entry must get
			 * one. When it is missing (an entry evicted mid-flight) the page is still
			 * the truth, so build the window from it. */
			return (
				client.getQueryData<ChannelMessages>(queryKey) ??
				mergeChannelPage(undefined, page, "newest")
			);
		},
	} as const;
}

/**
 * What the timeline hook hands the page: the retained WINDOW, not a server page.
 *
 * `messages` is ascending by `seq` and deduped, so every consumer keeps reading
 * history the way it always could; what changed is that it is bounded and that
 * older rows arrive on demand. `items` is deliberately NOT here: `threadItems`
 * depends on the wall clock (today/yesterday labels) and belongs to the
 * renderer, which is why the list still derives it per render.
 */
export type TeamBridgeChannelRead = {
	messages: TeamBridgeMessage[];
	events?: readonly TeamBridgeEvent[];
	isPending: boolean;
	isError: boolean;
	error: Error | null;
	hasOlder: boolean;
	isLoadingOlder: boolean;
	loadOlder: () => void;
	refetch: () => void;
};

export function useTeamBridgeMessages(
	conversationId: string | null,
	tenantId?: string,
	enabled = true,
	accountId?: string,
): TeamBridgeChannelRead {
	const client = useQueryClient();
	const options = teamBridgeMessagesQueryOptions(
		client,
		conversationId,
		tenantId,
		accountId,
	);
	const query = useQuery({
		...options,
		enabled: enabled && Boolean(accountId) && Boolean(conversationId),
		/* Paint the window we already hold, then revalidate: a conversation the
		   reader returns to is on screen in the first frame instead of behind a
		   spinner, and the 8 s poll keeps it live underneath. */
		staleTime: TEAM_BRIDGE_HISTORY_STALE_MS,
		gcTime: TEAM_BRIDGE_HISTORY_GC_MS,
		/* `not_a_member` is a definite answer (an administrator opening an archived
		   channel they never joined), not a blip: retrying it only delays the state
		   that explains it, and polling it every eight seconds only repeats the refusal.
		   A `429 rate_limited` is the hub's shared per-account read bucket saying
		   "come back in N s": the chain waits exactly that and keeps going while the
		   reader is on the channel, instead of three blind 1/2/4 s tries that end in
		   an error (the 7.4 s stuck-skeleton report; see the policy's note in
		   `team-bridge-channel-cache.ts`). It stops once nobody observes the query,
		   even if a `fetchQuery` has rejoined the chain, and after a bounded run. */
		retry: historyReadRetry(client, options.queryKey, isNotAMemberRefusal),
		retryDelay: (failures, error) => historyReadRetryDelay(failures, error),
		/* A conversation needs to feel live: without a poll an incoming message
		   never appears until the reader clicks away. Eight seconds is Slack's
		   order of immediacy for a background tab without an events stream;
		   `refetchIntervalInBackground` stays false so a hidden window does not
		   poll this. The poll reads the NEWEST PAGE only and merges it into the
		   window, so it costs the same whether the reader has paged through one
		   page of history or fifty. */
		refetchInterval: (query) =>
			isNotAMemberRefusal(query.state.error) ? false : 8_000,
		refetchOnWindowFocus: true,
	});
	/*
	 * PROXIMITY PAGING. A mutation on the same key, not an infinite query: the
	 * entry is our own window (`ChannelMessages`), and every other writer on this
	 * key - the notification watcher's banner read, the thread-unread patch, a
	 * send's invalidation - writes that shape. An infinite query would put a
	 * `{pages}` envelope around it and make each of them wrong.
	 *
	 * The cursor is read AT CALL TIME, from the entry, never captured in a
	 * render: a poll that merged a newer page between render and click does not
	 * move it, but a trim does, and asking before the window's oldest row is
	 * exactly the cursor we want.
	 */
	const key = options.queryKey;
	/* One read at a time per conversation, decided synchronously (see `loadOlder`). */
	const inFlight = useRef(false);
	const older = useMutation({
		/*
		 * THE CURSOR IS THE MUTATION'S INPUT (agent review round 3, M4-a). It used to
		 * be re-read inside `mutationFn`, which left `onSuccess` with nothing to
		 * compare against: the write could not tell whether the window it was asked
		 * for is still the window it would be merged into. Passing it makes the page
		 * carry its own identity - and it is read AT CALL TIME from the entry in
		 * `loadOlder`, so a poll or a trim between render and click is still
		 * respected.
		 */
		mutationFn: async (
			beforeSeq: number,
		): Promise<TeamBridgeMessagePage | null> => {
			if (conversationId === null) return null;
			return readForBridgeOwner(client, accountId, () =>
				TeamBridgeApi.listMessages(conversationId, {
					...(tenantId ? { tenantId } : {}),
					limit: TEAM_BRIDGE_PAGE_SIZE,
					beforeSeq,
				}),
			);
		},
		/* One refusal is one answer: the list retries by scrolling, and a retried
		   mutation would spend the same page again on a channel the reader may not
		   read. */
		retry: false,
		onSuccess: (page, beforeSeq) => {
			if (page === null) return;
			/*
			 * THE PAGE BELONGS TO THE WINDOW IT WAS ASKED FOR (agent review round 3,
			 * M4-a). `beforeSeq` is captured when the read is issued; the 8 s poll runs
			 * independently and can replace the window (a `hasNewer` reset) before this
			 * answers. Merging then would put two disjoint stretches in one array,
			 * under the cap so nothing drops and with the hole invisible to the next
			 * poll. A cursor that no longer matches means the window moved: drop it.
			 */
			client.setQueryData<ChannelMessages>(key, (current) =>
				mergeOlderPageAtCursor(current, page, beforeSeq),
			);
		},
	});
	const keyString = JSON.stringify(key);
	const data = query.data;
	/* The view order the eviction policy reads: opening a conversation is what
	   "recently viewed" means, not the order its polls happened to land in. */
	useEffect(() => {
		if (!enabled || conversationId === null) return;
		rememberChannelView(keyString);
	}, [keyString, enabled, conversationId]);
	useEffect(() => {
		if (data === undefined) return;
		sweepTeamBridgeChannelCache(client, keyString);
	}, [client, data, keyString]);
	const loadOlder = useCallback((): Promise<TeamBridgeMessagePage | null> => {
		/* A load already in flight is the same page: the list asks on every scroll
		   frame it is near the top, and answering each of them would be a burst.
		   The fence is a ref, not `older.isPending`: a caller can ask twice in one
		   tick (a walk re-running its effect before the mutation's own state has
		   committed), and both calls would see the stale false. */
		if (inFlight.current || older.isPending) return Promise.resolve(null);
		const current = client.getQueryData<ChannelMessages>(key);
		const beforeSeq = current?.oldestSeq;
		/* No entry, no history cursor or nothing older: there is nothing to read,
		   and saying so is what lets a walk finish. */
		if (current === undefined || !current.hasOlder || beforeSeq === undefined)
			return Promise.resolve(null);
		inFlight.current = true;
		return older
			.mutateAsync(beforeSeq)
			.catch(() => null)
			.finally(() => {
				inFlight.current = false;
			});
	}, [client, key, older.isPending, older.mutateAsync]);
	return {
		messages: data?.messages ?? [],
		events: data?.events,
		isPending: query.isPending,
		isError: query.isError,
		error: query.error ?? null,
		hasOlder: data?.hasOlder ?? false,
		isLoadingOlder: older.isPending,
		loadOlder,
		refetch: () => void query.refetch(),
	};
}

/**
 * Drop whole conversations until the cache fits its bounds.
 *
 * Selection is the pure policy in `team-bridge-channel-cache.ts`; this is the
 * hand that carries it out. Called when any entry's data changes, because a
 * `hasOlder`/byte bound can only be crossed by a write.
 */
export function sweepTeamBridgeChannelCache(
	client: QueryClient,
	activeKey: string | null,
): void {
	const entries = client
		.getQueryCache()
		.findAll({ queryKey: teamBridgeKeys.messagesPrefix })
		.flatMap((query) => {
			const data = query.state.data as ChannelMessages | undefined;
			if (data === undefined) return [];
			return [
				{ key: JSON.stringify(query.queryKey), approxBytes: data.approxBytes },
			];
		});
	const victims = selectChannelEvictions(
		entries,
		channelViewOrder(),
		activeKey,
	);
	for (const key of victims) {
		const query = client
			.getQueryCache()
			.findAll({ queryKey: teamBridgeKeys.messagesPrefix })
			.find((candidate) => JSON.stringify(candidate.queryKey) === key);
		if (query !== undefined) client.removeQueries({ queryKey: query.queryKey });
	}
}

/** A ready status answer must agree with the actual observed auth owner. */
function ownedStatusRead(client: QueryClient, accountId?: string) {
	return readForBridgeAccount(client, accountId, async () => {
		const status = await TeamBridgeApi.status("surface_open");
		if (status.state === "ready" && status.account_id !== accountId)
			throw new Error("Team Bridge status owner changed");
		return status;
	});
}

/** The signed-in hub account id (own-message alignment, DM titles). */
export function useTeamBridgeIdentity(
	enabled = true,
): UseQueryResult<string | null> {
	const client = useQueryClient();
	const { accountId } = useTeamBridgeAccount();
	return useQuery({
		queryKey: teamBridgeKeys.statusFor(accountId),
		queryFn: () => ownedStatusRead(client, accountId),
		select: (status) => status.account_id ?? null,
		enabled: enabled && Boolean(accountId),
		staleTime: 5 * 60_000,
		retry: 1,
	});
}

/**
 * The rail's People section: one organization's active human members.
 *
 * `tenantId` is null in the merged scope, and the query is DISABLED there —
 * the account-wide view has no single roster to show, and the section states
 * that rather than spending a read on an answer it cannot render. A directory
 * failure is this section's own error state: it is a separate query from the
 * conversation list, so a refused directory never blanks the list.
 */
export function useTeamBridgeDirectory(
	tenantId: string | null,
	enabled = true,
	accountId?: string,
): UseQueryResult<TeamBridgeDirectory> {
	const client = useQueryClient();
	return useQuery({
		queryKey: teamBridgeKeys.directory(
			tenantId ?? "none",
			accountId ?? "unresolved-owner",
		),
		queryFn: () =>
			readForBridgeOwner(client, accountId, () =>
				TeamBridgeApi.directory(tenantId as string),
			),
		enabled: enabled && Boolean(accountId) && Boolean(tenantId),
		staleTime: 30_000,
		refetchOnWindowFocus: true,
		retry: 1,
	});
}

/**
 * Every organization's directory, for NAMING senders in the merged view.
 *
 * WHY THE MERGED VIEW READS THEM AFTER ALL. `useTeamBridgeDirectory` is off in
 * the merged scope because there is no single roster to LIST there. But a
 * thread and its DM rows still need names: without a directory, every sender
 * the stored label cannot name renders as unknown, and before agent-server
 * #166 that stored label was the placeholder "Member" for creators and
 * self-joins. One read per organization the reader belongs to (a handful),
 * under the SAME per-tenant key as the People read, so switching into an
 * organization afterwards is a cache hit rather than a second fetch.
 *
 * Returns the loaded rosters by tenant, plus each read's OWN state.
 *
 * WHY THE STATE IS PART OF THE ANSWER (review round 1, F1). Naming a sender can
 * afford to treat "pending" and "failed" identically - both fall back to the
 * unknown placeholder - but the member picker cannot: it renders a roster and a
 * retry, and a roster that never arrives looks like a spinner that never ends.
 * Collapsing the two here meant a failed directory read in the merged view (the
 * default for anyone in more than one organization) presented as "loading
 * forever", and the retry it offered was wired to a DISABLED query, so the
 * button could not do anything either. `retry` therefore addresses ONE tenant's
 * read, which is the one the open conversation belongs to.
 */
export type TeamBridgeDirectoryReads = {
	/** Loaded rosters by tenant; a pending or failed read is absent. */
	members: Readonly<Record<string, readonly TeamBridgeDirectoryMember[]>>;
	/** Per-tenant read state, so a failed read is never drawn as a pending one. */
	state: Readonly<Record<string, "loading" | "error" | "ready">>;
	/**
	 * Per-tenant failure, for the one surface that draws one roster per
	 * organization: a failed organization's group names its own cause (signed out,
	 * plan, transport) instead of borrowing a sibling's or a generic line.
	 */
	errors: Readonly<Record<string, unknown>>;
	/** Re-run one organization's read; a tenant with no mounted read is a no-op. */
	retry: (tenantId: string) => void;
};

export function useTeamBridgeDirectories(
	tenantIds: readonly string[],
	enabled = true,
	accountId?: string,
): TeamBridgeDirectoryReads {
	const client = useQueryClient();
	const results = useQueries({
		queries: tenantIds.map((tenantId) => ({
			queryKey: teamBridgeKeys.directory(
				tenantId,
				accountId ?? "unresolved-owner",
			),
			queryFn: () =>
				readForBridgeOwner(client, accountId, () =>
					TeamBridgeApi.directory(tenantId),
				),
			enabled: enabled && Boolean(accountId),
			staleTime: 30_000,
			refetchOnWindowFocus: true,
			retry: 1,
		})),
	});
	return useMemo(() => {
		const members: Record<string, readonly TeamBridgeDirectoryMember[]> = {};
		const state: Record<string, "loading" | "error" | "ready"> = {};
		const errors: Record<string, unknown> = {};
		const byTenant = new Map<string, () => void>();
		results.forEach((result, index) => {
			const tenantId = tenantIds[index];
			if (result.data) members[tenantId] = result.data.members;
			if (result.isError) errors[tenantId] = result.error;
			state[tenantId] = result.isPending
				? "loading"
				: result.isError
					? "error"
					: "ready";
			byTenant.set(tenantId, () => {
				void result.refetch();
			});
		});
		return {
			members,
			state,
			errors,
			retry: (tenantId: string) => {
				byTenant.get(tenantId)?.();
			},
		};
		// `results` is a fresh array per render; the derivations above are keyed
		// on the tenants and are cheap, so the memo exists to keep ONE object
		// shape for its consumers rather than to memoize the work.
	}, [results, tenantIds]);
}

/**
 * The bridge's platform state, for the page's plan/sign-in cue.
 *
 * Read once per page open (`surface_open`) and kept fresh for a minute. The
 * page HOLDS its first paint on this answer (round-1 U-6): the verdict decides
 * whether the rest of the read set may fire, so the conversation chrome must
 * not be drawn — and its requests not spent — before the gate answers. A
 * failure is not surfaced by itself: the conversation list already has its own
 * error state, and a status read that cannot answer must not invent an
 * ineligible verdict.
 */
export function useTeamBridgeStatus(
	enabled = true,
): UseQueryResult<AgentMessagesStatus> {
	const client = useQueryClient();
	const { accountId } = useTeamBridgeAccount();
	return useQuery({
		queryKey: teamBridgeKeys.statusFor(accountId),
		queryFn: () => ownedStatusRead(client, accountId),
		enabled: enabled && Boolean(accountId),
		staleTime: 60_000,
		refetchOnWindowFocus: true,
		retry: 1,
	});
}

/**
 * The one unread read, shared by the sidebar badge and the page's per-org
 * counts.
 *
 * The BADGE is always the ACCOUNT aggregate: `scope` defaults to `"all"`, which
 * the client maps to the server's single `scope=account` read. The page passes
 * the same default, so its switcher counts come from the payload already in
 * cache instead of one read per organization.
 *
 * `enabled` is the capability gate: a backend without the conversation surface
 * must not be polled for a route it does not have.
 */
export function useTeamBridgeUnread(
	enabled: boolean,
	scope: TeamBridgeScope = TEAM_BRIDGE_ALL_SCOPE,
	options: {
		accountId?: string;
		/**
		 * Override the badge's own cadence. The notification watcher asks for 30 s
		 * so a banner arrives on the order of a message rather than a badge
		 * refresh; the sidebar and page pass nothing and keep the quiet cadence.
		 */
		refetchInterval?: number;
		/**
		 * Keep the interval running while the window is hidden. The notification
		 * watcher sets this: a minimised or occluded window is exactly when a
		 * banner is useful, and main owns the quiet decision.
		 */
		refetchIntervalInBackground?: boolean;
	} = {},
): UseQueryResult<TeamBridgeUnread> {
	const client = useQueryClient();
	return useQuery({
		queryKey: teamBridgeKeys.unread(
			scope,
			options.accountId ?? "unresolved-owner",
		),
		queryFn: () =>
			readForBridgeOwner(client, options.accountId, () =>
				TeamBridgeApi.unread(readScope(scope)),
			),
		enabled: enabled && Boolean(options.accountId),
		staleTime: 30_000,
		refetchInterval: options.refetchInterval ?? badgeInterval(),
		refetchIntervalInBackground: options.refetchIntervalInBackground,
		refetchOnWindowFocus: true,
		// A failed badge read is not an error the user can act on; the next poll
		// is the retry. The page shows its own error state for the list.
		retry: 1,
	});
}

/**
 * Refetch what a successful send changes: the thread, the conversation lists
 * (the row may be in the merged list and in its org's list, and both caches
 * must stop claiming stale unread state) and the badge. Shared by the send
 * mutation and the page's optimistic send, which posts straight to the API so
 * a retry is bound to the conversation it was typed in, not to whatever is
 * selected when it runs.
 */
export async function refreshAfterSend(
	client: QueryClient,
	conversationId: string,
	tenantId?: string,
	isCurrent: () => boolean = () => true,
): Promise<void> {
	// Each invalidation awaits a read; ownership can change between them. A
	// stale write must not refresh the next account's shared feed prefixes.
	if (!isCurrent()) return;
	await client.invalidateQueries({
		queryKey: teamBridgeKeys.messages(conversationId, tenantId),
	});
	// Prefix invalidation: see above.
	if (!isCurrent()) return;
	await client.invalidateQueries({
		queryKey: teamBridgeKeys.conversationsPrefix,
	});
	if (!isCurrent()) return;
	await client.invalidateQueries({
		queryKey: teamBridgeKeys.unreadPrefix,
	});
}

export function useSendTeamBridgeMessage(
	conversationId: string,
	tenantId?: string,
): UseMutationResult<
	unknown,
	Error,
	{
		clientRef: string;
		body: string;
		attachmentIds?: readonly string[];
		files?: readonly string[];
		mentions?: readonly TeamBridgeMentionRow[];
	}
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	type Input = {
		clientRef: string;
		body: string;
		/* A staged image set this message binds; omitted (never `[]`) for text. */
		attachmentIds?: readonly string[];
		files?: readonly string[];
		/*
		 * The @-mentions the caller captured at the PRESS (review MINOR-1 on #1663).
		 * A picture send reaches this request only after its upload, and while it
		 * uploads an optimistic text send of the same words can land and clear the
		 * shared outbox entry, so a read here would post the picture without its
		 * mentions. The key being PRESENT is the capture, even when its value is
		 * undefined (nothing was staged); only an input without the key falls back
		 * to the outbox, for a caller that never captured.
		 */
		mentions?: readonly TeamBridgeMentionRow[];
	};
	const mutation = useMutation<
		unknown,
		Error,
		CapturedBridgeMutation<Input, BridgeWriteTarget>
	>({
		mutationFn: ({ input, target }) => {
			target.assertCurrent();
			return TeamBridgeApi.send(target.conversationId, {
				...input,
				tenantId: target.tenantId,
				expectedAccountId: requireBridgeWriteAccount(target.accountId),
				// The composer's @-mentions for exactly this text (`mention-outbox`).
				mentions:
					"mentions" in input
						? input.mentions
						: stagedMentions(target.conversationId, input.body),
			});
		},
		onSuccess: (_data, { input, target }) => {
			clearStagedMentions(target.conversationId, input.body);
			return refreshAfterSend(
				client,
				target.conversationId,
				target.tenantId,
				target.isCurrent,
			);
		},
	});
	return bindBridgeMutation(mutation, () => ({
		...owner,
		conversationId,
		tenantId,
	}));
}
/** A join naming its conversation (a rail row's menu, not the selection). */
export type TeamBridgeJoinVariables = {
	conversationId: string;
	tenantId: string;
};

/**
 * Join a discoverable channel (or accept an invitation).
 *
 * The conversation stays SELECTED across the refetch: the container's
 * `selectedId` is the selection, and this mutation only invalidates the data
 * behind it. The list (the row's `member` flag and count), the history (now
 * readable) and the badge are all refetched — a join changes all three, and a
 * cache left claiming "preview" would keep the banner over a readable thread.
 */
export function useJoinTeamBridgeConversation(
	conversationId: string,
	tenantId?: string,
): UseMutationResult<unknown, Error, TeamBridgeJoinVariables | undefined> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	const mutation = useMutation<
		unknown,
		Error,
		CapturedBridgeMutation<
			TeamBridgeJoinVariables | undefined,
			BridgeWriteTarget
		>
	>({
		/* A rail row's menu joins a row that is NOT the selection, so the
		   conversation may ride in the variables; absent, it is the selection the
		   hook was mounted for (the preview banner's Join). */
		mutationFn: ({ input, target }) => {
			target.assertCurrent();
			return TeamBridgeApi.join(
				input?.conversationId ?? target.conversationId,
				input ? input.tenantId : target.tenantId,
				target.accountId,
			);
		},
		onSuccess: (_data, { input, target }) =>
			refreshAfterSend(
				client,
				input?.conversationId ?? target.conversationId,
				input ? input.tenantId : target.tenantId,
				target.isCurrent,
			),
	});
	return bindBridgeMutation(mutation, () => ({
		...owner,
		conversationId,
		tenantId,
	}));
}
/** The rollback snapshot carried from `onMutate` to `onError`. */
export type TeamBridgeNotifyMutationContext = {
	snapshots: Array<[QueryKey, TeamBridgeConversationList | undefined]>;
};

/**
 * What one notify write names: the conversation it belongs to is part of the
 * variables, not only the closure.
 *
 * A refusal can settle AFTER the reader has moved to another conversation. The
 * in-flight mutation keeps the options it started with, but the mounted hook
 * keeps its latest mutation's variables — so the page can compare the failing
 * write's `conversationId` with the current selection and refuse to show A's
 * error under B. Without this, a stale settlement re-arms `notifyFailed` under
 * whatever conversation is on screen.
 */
export type TeamBridgeNotifyMutationVariables = {
	conversationId: string;
	tenantId?: string;
	notify: TeamBridgeNotify;
};

/**
 * The notify mutation's options, separated from the hook.
 *
 * `useSetTeamBridgeNotify` is a one-line wrapper: these options are the object
 * React Query actually runs, and keeping them callable lets the test that owns
 * the rollback claim drive `onMutate`/`onError` against a real cache without a
 * DOM. The hook passes its query client, so the cache the options read is the
 * one the page renders from.
 */
export function notifyMutationOptions(
	client: QueryClient,
	isCurrent?: () => boolean,
): UseMutationOptions<
	TeamBridgeReadState,
	Error,
	TeamBridgeNotifyMutationVariables,
	TeamBridgeNotifyMutationContext
> {
	const { accountId, epoch } = observedRadientAuthority(client);
	const current = () =>
		bridgeOwnerCurrent(client, accountId) && (isCurrent?.() ?? true);
	const check = () => {
		if (!current()) throw new Error("Team Bridge write authority changed");
	};
	const owned = {
		queryKey: teamBridgeKeys.conversationsPrefix,
		predicate: (query: { queryKey: QueryKey }) =>
			query.queryKey.at(-1) === accountId &&
			query.queryKey.at(-2) === "account",
	};
	return {
		mutationKey: teamBridgeKeys.notifyMutation(accountId, epoch),
		mutationFn: ({ conversationId, notify, tenantId }) => {
			check();
			return TeamBridgeApi.setNotify(
				conversationId,
				notify,
				tenantId,
				accountId,
			);
		},
		onMutate: async ({ conversationId, notify, tenantId }) => {
			check();
			await client.cancelQueries(owned);
			check();
			const snapshots =
				client.getQueriesData<TeamBridgeConversationList>(owned);
			client.setQueriesData<TeamBridgeConversationList>(owned, (current) =>
				current === undefined
					? current
					: withNotificationPreference(
							current,
							conversationId,
							notify,
							tenantId,
						),
			);
			return { snapshots };
		},
		onError: (_error, _variables, context) => {
			if (!current()) return;
			for (const [key, data] of context?.snapshots ?? []) {
				client.setQueryData(key, data);
			}
		},
		onSettled: async () => {
			if (!current()) return;
			await client.invalidateQueries(owned);
			if (!current()) return;
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.unreadPrefix,
			});
		},
	};
}

/**
 * Set one conversation's notification preference, optimistically.
 *
 * The menu is a control a reader uses repeatedly; waiting for a round trip to
 * paint the checkmark would make every choice feel ignored. The update patches
 * every cached conversation page that holds the row (the merged list and its
 * org's list), and a refusal restores the exact snapshots taken before the
 * patch. `onSettled` then re-reads the truth, so a server that canonicalises a
 * value cannot leave the optimistic guess in place.
 */
export function useSetTeamBridgeNotify(): UseMutationResult<
	TeamBridgeReadState,
	Error,
	TeamBridgeNotifyMutationVariables
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	return useMutation(notifyMutationOptions(client, owner.isCurrent));
}

/**
 * What an agent-level write needs to undo itself: the account it patched under
 * and the level it replaced (null when the row carried none). Not page
 * snapshots: see `withOwnAgentNotifyRolledBack`.
 */
export type TeamBridgeAgentNotifyMutationContext = {
	self: string;
	previous: TeamBridgeNotify | null;
};

/** One agent wake-level write: which conversation, in which org, and the level. */
export type TeamBridgeAgentNotifyVariables = {
	conversationId: string;
	tenantId: string;
	notify: TeamBridgeNotify;
};

/**
 * The reader's own agent's wake level, optimistically, separated from the
 * hook for the same reason as `notifyMutationOptions` (a DOM-free test drives
 * the phases against a real cache).
 *
 * Same owner discipline as the reader's own notify write: the account is
 * captured once and re-checked in every phase, so a sign-out mid-flight can
 * neither land the level under the next account nor roll back into their
 * cache. The snapshots restore exactly the pages this write patched.
 *
 * On success the route's answer is folded into the cache before the refetch
 * (`withServedOwnAgentNotify`, review round 1 R1-1): the answer is the one view
 * sure to carry the stored level, so the checked row survives even if a list
 * refetch came back without it.
 *
 * WIRE ORDER PER CONVERSATION (R1-4, corrected in round 2 as R2-1). A
 * mutation scope keyed by the conversation makes the query client send B only
 * after A has settled, so the hub stores the picks in the order they were
 * made. It orders `mutationFn` only: TanStack (5.73) awaits `onMutate` before
 * the scope's `canRun` gate, so B's optimistic patch lands while A is still in
 * flight. That is why a failure does not restore page snapshots. It undoes
 * only its own row, and only while the row still holds its value
 * (`withOwnAgentNotifyRolledBack`), so A failing never erases B. Different
 * conversations still run in parallel. Owner and tenant are in the scope id
 * too, so a sign-out never chains one account's write behind another's.
 *
 * The scope is fixed when the options are built, not per call (TanStack reads
 * `options.scope` from the mutation), hence the `target` parameter. The same
 * target is in `mutationKey`: when the selection moves, the observer's key
 * changes and TanStack RESETS the observer instead of re-pointing a pending
 * mutation's options, whose scope would then no longer match the queue it
 * was filed under.
 */
export function agentNotifyMutationOptions(
	client: QueryClient,
	target: { conversationId: string; tenantId: string } | null,
	isCurrent?: () => boolean,
): UseMutationOptions<
	TeamBridgeConversation,
	Error,
	TeamBridgeAgentNotifyVariables,
	TeamBridgeAgentNotifyMutationContext
> {
	const { accountId } = observedRadientAuthority(client);
	const current = () =>
		bridgeOwnerCurrent(client, accountId) && (isCurrent?.() ?? true);
	const check = () => {
		if (!current() || !accountId)
			throw new Error("Team Bridge write authority changed");
		return accountId;
	};
	const owned = {
		queryKey: teamBridgeKeys.conversationsPrefix,
		predicate: (query: { queryKey: QueryKey }) =>
			query.queryKey.at(-1) === accountId &&
			query.queryKey.at(-2) === "account",
	};
	// A write for a conversation other than the one this queue serialises would
	// escape the per-conversation ordering; refuse it before any cache patch.
	const onTarget = (variables: {
		conversationId: string;
		tenantId: string;
	}) => {
		if (
			target?.conversationId !== variables.conversationId ||
			target.tenantId !== variables.tenantId
		)
			throw new Error("Team Bridge agent-notify target changed");
	};
	const serial = [
		"agent-notify",
		accountId ?? "unresolved-owner",
		target?.tenantId ?? "unknown-tenant",
		target?.conversationId ?? "no-conversation",
	] as const;
	return {
		mutationKey: [...teamBridgeKeys.all, ...serial],
		scope: { id: serial.join(":") },
		mutationFn: ({ conversationId, tenantId, notify }) => {
			onTarget({ conversationId, tenantId });
			return TeamBridgeApi.setAgentNotify({
				conversationId,
				tenantId,
				notify,
				accountId: check(),
			});
		},
		onMutate: async (variables) => {
			onTarget(variables);
			const self = check();
			await client.cancelQueries(owned);
			check();
			// The level this write replaces, read from the first cached page that
			// holds the row: every owned page carries the same served value.
			let previous: TeamBridgeNotify | null = null;
			for (const [, page] of client.getQueriesData<TeamBridgeConversationList>(
				owned,
			)) {
				const row = page?.conversations.find(
					(candidate) =>
						candidate.id === variables.conversationId &&
						candidate.tenant_id === variables.tenantId,
				);
				const agent = row ? ownActiveAgent(row, self) : null;
				if (agent) {
					previous = agentNotifyLevel(agent);
					break;
				}
			}
			client.setQueriesData<TeamBridgeConversationList>(owned, (page) =>
				page === undefined
					? page
					: withOwnAgentNotify(page, variables, self, variables.notify),
			);
			return { self, previous };
		},
		onSuccess: (answer) => {
			if (!current() || !accountId) return;
			client.setQueriesData<TeamBridgeConversationList>(owned, (page) =>
				page === undefined
					? page
					: withServedOwnAgentNotify(page, answer, accountId),
			);
		},
		onError: (_error, variables, context) => {
			if (!current() || !context) return;
			client.setQueriesData<TeamBridgeConversationList>(owned, (page) =>
				page === undefined
					? page
					: withOwnAgentNotifyRolledBack(
							page,
							variables,
							context.self,
							variables.notify,
							context.previous,
						),
			);
		},
		onSettled: async () => {
			if (!current()) return;
			await client.invalidateQueries(owned);
		},
	};
}

/**
 * Set the reader's own agent's wake level in the SELECTED conversation; writes
 * to that conversation are serialised (see `agentNotifyMutationOptions`).
 */
export function useSetTeamBridgeAgentNotify(
	conversationId: string | undefined,
	tenantId: string | undefined,
): UseMutationResult<
	TeamBridgeConversation,
	Error,
	TeamBridgeAgentNotifyVariables
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	return useMutation(
		agentNotifyMutationOptions(
			client,
			conversationId && tenantId ? { conversationId, tenantId } : null,
			owner.isCurrent,
		),
	);
}

/** One invitation answer: which conversation, in which org, and the choice. */
export type TeamBridgeInvitationAnswer = {
	conversationId: string;
	tenantId: string;
	decision: "accept" | "decline";
	/** Pins one of the owner's agent rows (members panel decline); optional. */
	endpointId?: string;
};

/**
 * The invitation-answer mutation's options, separated from the hook for the
 * same reason as `notifyMutationOptions`: the test that owns the optimistic and
 * rollback claims drives `onMutate`/`onError` against a real cache, no DOM.
 *
 * OPTIMISTIC. The rail count and the row's outcome move the moment the owner
 * answers (the agent row turns `active`/`removed` in every cached page that
 * holds it). A refusal applies the INVERSE patch to that one row
 * (`withoutAgentInvitationAnswer`; review round 1, R3: whole-page snapshots
 * are wrong when two answers interleave), and `onSettled` re-reads the truth
 * either way, so a row answered elsewhere (`invalid_transition`) shows the
 * server's state. The patch never touches `notify`, so accepting cannot unmute.
 *
 * The owner is captured ONCE, at construction, and every phase re-checks it: a
 * sign-out or account switch while the request is in flight must neither land
 * the answer under the next account nor write its rollback into their cache.
 */
export function invitationAnswerMutationOptions(
	client: QueryClient,
	isCurrent?: () => boolean,
): UseMutationOptions<
	TeamBridgeConversation,
	Error,
	TeamBridgeInvitationAnswer
> {
	const { accountId } = observedRadientAuthority(client);
	const current = () =>
		bridgeOwnerCurrent(client, accountId) && (isCurrent?.() ?? true);
	const check = () => {
		if (!current() || !accountId)
			throw new Error("Team Bridge write authority changed");
		return accountId;
	};
	const owned = {
		queryKey: teamBridgeKeys.conversationsPrefix,
		predicate: (query: { queryKey: QueryKey }) =>
			query.queryKey.at(-1) === accountId &&
			query.queryKey.at(-2) === "account",
	};
	return {
		mutationFn: ({ conversationId, tenantId, decision, endpointId }) =>
			TeamBridgeApi.answerAgentInvitation({
				conversationId,
				tenantId,
				decision,
				endpointId,
				accountId: check(),
				consentVersion: TEAM_BRIDGE_AGENT_PARTICIPATION_VERSION,
			}),
		onMutate: async (variables) => {
			const self = check();
			await client.cancelQueries(owned);
			check();
			client.setQueriesData<TeamBridgeConversationList>(owned, (page) =>
				page === undefined
					? page
					: withAgentInvitationAnswer(
							page,
							variables,
							self,
							variables.decision,
						),
			);
		},
		onError: (_error, variables) => {
			if (!current() || !accountId) return;
			client.setQueriesData<TeamBridgeConversationList>(owned, (page) =>
				page === undefined
					? page
					: withoutAgentInvitationAnswer(
							page,
							variables,
							accountId,
							variables.decision,
						),
			);
		},
		onSettled: async () => {
			if (!current()) return;
			await client.invalidateQueries(owned);
		},
	};
}

/** Answer one agent invitation, optimistically (see the options above). */
export function useAnswerTeamBridgeInvitation(): UseMutationResult<
	TeamBridgeConversation,
	Error,
	TeamBridgeInvitationAnswer
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	return useMutation(invitationAnswerMutationOptions(client, owner.isCurrent));
}

export function useMarkTeamBridgeRead(
	conversationId: string,
	tenantId?: string,
): UseMutationResult<TeamBridgeReadState, Error, { seq: number }> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	const mutation = useMutation<
		TeamBridgeReadState,
		Error,
		CapturedBridgeMutation<{ seq: number }, BridgeWriteTarget>,
		TeamBridgeUnreadSnapshot
	>({
		mutationFn: ({ input, target }) => {
			target.assertCurrent();
			return TeamBridgeApi.markRead(target.conversationId, {
				...input,
				tenantId: target.tenantId,
				expectedAccountId: target.accountId,
			});
		},
		/*
		 * READ CLEARS THE ROW AND THE BADGE IN ONE UPDATE. The row's count and the
		 * nav badge used to wait for two separate refetches with different
		 * cadences, so one could still claim unread after the other cleared. The
		 * optimistic patch writes every cache that renders this conversation's
		 * unread in the same synchronous pass; the invalidations below still
		 * reconcile with the server, and a refusal restores the exact snapshots.
		 */
		onMutate: ({ input, target }) => {
			if (!target.isCurrent() || !target.accountId || !target.tenantId)
				return undefined;
			/*
			 * CANCEL FIRST, IN THIS SAME PASS (review round 1, m1). A read dispatched
			 * before this click - the unread poll, a list refetch - answers with a
			 * count computed before the clear and carries a later timestamp than the
			 * patches below keep, so it would win the merge and bounce the row and
			 * the badge back. Cancelling here means nothing is left in flight to
			 * land on top of the patch.
			 */
			cancelTeamBridgeUnreadReads(client, target.accountId);
			return applyTeamBridgeReadCursor(client, target.accountId, {
				tenantId: target.tenantId,
				conversationId: target.conversationId,
				seq: input.seq,
			});
		},
		onError: async (_error, { target }, snapshot) => {
			if (!target.isCurrent() || !snapshot) return;
			restoreTeamBridgeUnreadSnapshot(client, snapshot);
			/*
			 * THEN ASK THE SERVER (review round 1, m2). A refusal means the cached
			 * numbers were never ours to rewind: with no success invalidation, a
			 * restored count could stand for up to the next poll. The refetch is the
			 * one answer that cannot be stale.
			 */
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
			if (!target.isCurrent()) return;
			await client.invalidateQueries({ queryKey: teamBridgeKeys.unreadPrefix });
		},
		onSuccess: async (_data, { target }) => {
			if (!target.isCurrent()) return;
			// Same guard as `onMutate`, so neither caller has to invent an owner.
			if (!target.accountId) return;
			/*
			 * CANCEL AGAIN AT SETTLEMENT (agent review round 2, R2-m1). The
			 * click-time cancel only covers reads dispatched BEFORE the click; a
			 * poll dispatched after it answers with a count computed before the
			 * server recorded the clear, and would land with a newer timestamp than
			 * the patch and bounce row and badge back to the old count. Cancelling
			 * at the head of the success path closes that window, before the
			 * invalidations below dispatch their own, post-clear reads.
			 */
			cancelTeamBridgeUnreadReads(client, target.accountId);
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
			if (!target.isCurrent()) return;
			await client.invalidateQueries({ queryKey: teamBridgeKeys.unreadPrefix });
		},
	});
	return bindBridgeMutation(mutation, () => ({
		...owner,
		conversationId,
		tenantId,
	}));
}
/**
 * Write one root's viewer-scoped thread unread into this ACCOUNT's cached
 * timeline pages of its conversation, in one synchronous pass, so the thread
 * row's badge moves the moment a read lands instead of on the next 8s poll.
 *
 * OWNER-SCOPED (review round 1, F2): the account tail on the key keeps a write
 * from reaching a page another signed-in account cached for the same
 * tenant/conversation.
 *
 * ABSENT STAYS ABSENT: a root whose page came from a hub without thread reads
 * carries no `thread_unread_count`, and writing a number there would invent a
 * claim the hub never made.
 */
export function setCachedThreadUnread(
	client: QueryClient,
	target: {
		conversationId: string;
		tenantId: string;
		accountId: string;
		rootId: string;
	},
	count: number,
	seq: number,
) {
	client.setQueriesData<ChannelMessages>(
		{
			queryKey: teamBridgeKeys.messages(
				target.conversationId,
				target.tenantId,
				target.accountId,
			),
		},
		(page) => {
			if (!page) return page;
			let changed = false;
			const messages = page.messages.map((message) => {
				if (
					message.id !== target.rootId ||
					message.thread_unread_count === undefined ||
					message.thread_unread_count === count
				)
					return message;
				changed = true;
				return {
					...message,
					thread_unread_count: count,
					thread_last_read_seq: Math.max(
						seq,
						message.thread_last_read_seq ?? 0,
					),
				};
			});
			/* Through the window's own writer: the entry carries a byte estimate and a
			   retention bound, and a hand-written `{...page, messages}` would leave the
			   estimate stale until the next merge. */
			return changed ? withChannelMessages(page, messages) : page;
		},
	);
}

/**
 * Which count the row may show right after an acknowledgement of `seq`, or
 * `undefined` for "leave it to the refetch".
 *
 * NO OPTIMISTIC ZERO ON A PARTIAL READ (review round 1, F1). The pane
 * acknowledges incrementally while a long unread thread scrolls past, so
 * writing 0 after every acknowledgement made the badge blink off and back to
 * the hub's remainder once per step. In order of authority:
 * 1. the hub's own answer to a TR1 thread read;
 * 2. 0, only when `seq` reaches the newest reply the pane knows is the live
 *    tail (`newestReplySeq`, `undefined` when the window is not at the tail);
 * 3. otherwise nothing: the messages invalidation brings the hub's number.
 */
export function threadUnreadAfterRead(
	answer: { thread_unread_count?: number } | undefined,
	seq: number,
	newestReplySeq: number | undefined,
): number | undefined {
	// TR1 names the thread remainder explicitly; `unread_count` belongs to the
	// conversation and must never replace this thread's badge (F7).
	const echoed = answer?.thread_unread_count;
	if (echoed !== undefined) return echoed;
	if (newestReplySeq !== undefined && seq >= newestReplySeq) return 0;
	return undefined;
}

/**
 * THE THREAD PANE'S ONE READ CALL SITE. Isolated so the hub's thread-read
 * route (slice TR1) swaps in here and nowhere else.
 *
 * - `features.team_bridge_thread_reads >= 1` (the same `>= 1` key test the
 *   attention service applies to `team_bridge_unread_events`): acknowledge
 *   against the THREAD's cursor. The hub rolls that into the conversation
 *   unread and bumps the unread revision, so the conversation list and the
 *   rail badge are invalidated to recompute.
 * - Otherwise: exactly today's behaviour, the conversation read with the reply
 *   seq (`useMarkTeamBridgeRead`, optimistic rail clear included). The hub's
 *   compat rule counts replies against max(conversation, thread cursor), so
 *   this still clears a TR1 hub's thread count for a build that never posts a
 *   thread read. Its answer is the CONVERSATION's state, so only rule 2 of
 *   `threadUnreadAfterRead` applies to it.
 *
 * `newestReplySeq` is read at settlement, not captured at dispatch, so a reply
 * that arrived while the read was in flight keeps its badge.
 */
export function useMarkTeamBridgeThreadRead(
	conversationId: string,
	tenantId: string,
	rootId: string,
	newestReplySeq: () => number | undefined = () => undefined,
): { mutateAsync: (input: { seq: number }) => Promise<unknown> } {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	/* PASSIVE: the app root already owns the capabilities poll; a pane adding
	   its own observer would add a refetch interval per open thread for an
	   answer already in the cache. Absent/unknown reads false = today's path. */
	const threadReads = usePassiveDesktopFeature("team_bridge_thread_reads");
	const conversationRead = useMarkTeamBridgeRead(conversationId, tenantId);
	const threadRead = useMutation<
		TeamBridgeThreadReadState,
		Error,
		CapturedBridgeMutation<{ seq: number }, BridgeWriteTarget>
	>({
		mutationFn: ({ input, target }) => {
			target.assertCurrent();
			if (!target.accountId || !target.tenantId)
				throw new Error("Team Bridge write owner and tenant required");
			return TeamBridgeApi.markThreadRead(target.conversationId, rootId, {
				seq: input.seq,
				tenantId: target.tenantId,
				expectedAccountId: target.accountId,
			});
		},
		onSuccess: async (_data, { target }) => {
			if (!target.isCurrent() || !target.accountId) return;
			cancelTeamBridgeUnreadReads(client, target.accountId);
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
			if (!target.isCurrent()) return;
			await client.invalidateQueries({ queryKey: teamBridgeKeys.unreadPrefix });
		},
	});
	const boundThreadRead = bindBridgeMutation(threadRead, () => ({
		...owner,
		conversationId,
		tenantId,
	}));
	/* Latest-ref, so `mutateAsync` keeps one identity: the pane's viewport
	   observer is keyed on it, and a fresh closure per render would tear the
	   observer down and re-observe every reply on each poll. */
	const latest = useRef({
		threadReads,
		boundThreadRead,
		conversationRead,
		newestReplySeq,
		owner,
	});
	latest.current = {
		threadReads,
		boundThreadRead,
		conversationRead,
		newestReplySeq,
		owner,
	};
	const mutateAsync = useCallback(
		async (input: { seq: number }) => {
			const current = latest.current;
			const viaThread = current.threadReads;
			const answer = await (viaThread
				? current.boundThreadRead.mutateAsync(input)
				: current.conversationRead.mutateAsync(input));
			const accountId = current.owner.accountId;
			const count = threadUnreadAfterRead(
				viaThread ? (answer as TeamBridgeThreadReadState) : undefined,
				input.seq,
				latest.current.newestReplySeq(),
			);
			if (accountId && count !== undefined && current.owner.isCurrent())
				setCachedThreadUnread(
					client,
					{ conversationId, tenantId, accountId, rootId },
					count,
					input.seq,
				);
			// Reconcile with the hub's own per-viewer count either way.
			void client.invalidateQueries({
				queryKey: teamBridgeKeys.messages(conversationId, tenantId),
			});
			return answer;
		},
		[client, conversationId, tenantId, rootId],
	);
	return useMemo(() => ({ mutateAsync }), [mutateAsync]);
}

/** The member routes need the captured owner and nothing else: the
 * conversation and tenant travel in the variables, so one hook can serve any
 * conversation the dialog is opened on. */
type MemberWriteTarget = ReturnType<typeof useBridgeOwner>;

export type TeamBridgeMemberMutationVariables = {
	conversationId: string;
	tenantId: string;
	key: string;
};

export type TeamBridgeAddMembersVariables =
	TeamBridgeMemberMutationVariables & {
		members: TeamBridgeMemberInput[];
	};

export type TeamBridgeRemoveMemberVariables =
	TeamBridgeMemberMutationVariables & {
		accountId: string;
	};

/**
 * Invite without optimistic activation. The response's member states replace
 * every cached copy of the conversation; a later refetch reconciles any other
 * members' changes. An invited agent never becomes active in this write path.
 */
export function useAddTeamBridgeMembers(): UseMutationResult<
	TeamBridgeConversation,
	Error,
	TeamBridgeAddMembersVariables
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	const mutation = useMutation<
		TeamBridgeConversation,
		Error,
		CapturedBridgeMutation<TeamBridgeAddMembersVariables, MemberWriteTarget>
	>({
		mutationFn: ({ input, target }) => {
			target.assertCurrent();
			return TeamBridgeApi.addMembers({
				conversationId: input.conversationId,
				tenantId: input.tenantId,
				expectedAccountId: target.accountId,
				members: input.members,
			});
		},
		onSuccess: async (updated, { target }) => {
			if (!target.isCurrent()) return;
			replaceCachedConversation(client, target.accountId, updated);
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
		},
	});
	return bindBridgeMutation(mutation, () => owner);
}

/** Remove only the named member; no optimistic departure is fabricated. */
export function useRemoveTeamBridgeMember(): UseMutationResult<
	TeamBridgeConversation,
	Error,
	TeamBridgeRemoveMemberVariables
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	const mutation = useMutation<
		TeamBridgeConversation,
		Error,
		CapturedBridgeMutation<TeamBridgeRemoveMemberVariables, MemberWriteTarget>
	>({
		mutationFn: ({ input, target }) => {
			target.assertCurrent();
			return TeamBridgeApi.removeMember({
				conversationId: input.conversationId,
				tenantId: input.tenantId,
				expectedAccountId: target.accountId,
				accountId: input.accountId,
			});
		},
		onSuccess: async (updated, { target }) => {
			if (!target.isCurrent()) return;
			replaceCachedConversation(client, target.accountId, updated);
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
		},
	});
	return bindBridgeMutation(mutation, () => owner);
}

export type TeamBridgeLeaveVariables = {
	conversationId: string;
	tenantId: string;
};

/**
 * Leave a conversation as the signed-in person (the members panel's "Leave").
 *
 * NOT OPTIMISTIC, unlike archive: leaving changes what the reader may READ,
 * and only the server knows the post-state (a private group disappears from
 * the list, a channel turns into a discoverable preview). The page moves the
 * selection off the room on success, the way remove-self and archive already
 * do; every conversation and unread read is refetched so the rail and the
 * badge agree with the server about where the reader still is.
 */
export function useLeaveTeamBridgeConversation(): UseMutationResult<
	unknown,
	Error,
	TeamBridgeLeaveVariables
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	const mutation = useMutation<
		unknown,
		Error,
		CapturedBridgeMutation<TeamBridgeLeaveVariables, MemberWriteTarget>
	>({
		/*
		 * NEVER RETRIED (QA round 1, Q2), like group create below: one click is
		 * one request. The shared client's `retry: 1` re-sent a refused leave, and
		 * a retry after a committed leave whose answer was lost draws a
		 * not-a-member refusal, so the panel would say "not saved" for a change
		 * the hub made.
		 */
		retry: 0,
		mutationFn: ({ input, target }) => {
			target.assertCurrent();
			return TeamBridgeApi.leaveConversation({
				conversationId: input.conversationId,
				tenantId: input.tenantId,
				expectedAccountId: target.accountId,
			});
		},
		onSuccess: async (_data, { target }) => {
			if (!target.isCurrent()) return;
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
			if (!target.isCurrent()) return;
			await client.invalidateQueries({ queryKey: teamBridgeKeys.unreadPrefix });
		},
	});
	return bindBridgeMutation(mutation, () => owner);
}

export type TeamBridgeWithdrawAgentVariables =
	TeamBridgeMemberMutationVariables & {
		endpointId?: string;
	};

/**
 * Take the reader's OWN ACTIVE agent out of one conversation (consent
 * `withdraw`). Only that endpoint's row leaves; the owner's own membership is
 * untouched. The answer is not written into the cache: it is rendered from
 * the agent's member key on some hubs (see `withServedOwnAgentNotify`), so a
 * refetch, not the answer, is what the panel re-renders from.
 */
export function useWithdrawTeamBridgeAgent(): UseMutationResult<
	TeamBridgeConversation,
	Error,
	TeamBridgeWithdrawAgentVariables
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	const mutation = useMutation<
		TeamBridgeConversation,
		Error,
		CapturedBridgeMutation<TeamBridgeWithdrawAgentVariables, MemberWriteTarget>
	>({
		/* NEVER RETRIED (QA round 1, Q2): a retried withdraw after a lost answer
		   draws `409 not_active` for a change that was saved. */
		retry: 0,
		mutationFn: ({ input, target }) => {
			target.assertCurrent();
			if (!target.accountId)
				throw new Error("Team Bridge write authority changed");
			return TeamBridgeApi.withdrawAgent({
				conversationId: input.conversationId,
				tenantId: input.tenantId,
				accountId: target.accountId,
				endpointId: input.endpointId,
			});
		},
		onSuccess: async (_updated, { target }) => {
			if (!target.isCurrent()) return;
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
		},
	});
	return bindBridgeMutation(mutation, () => owner);
}

/** Keep live and merged lists in the same membership state after a write. */
function replaceCachedConversation(
	client: QueryClient,
	accountId: string | undefined,
	updated: TeamBridgeConversation,
): void {
	const owned = {
		queryKey: teamBridgeKeys.conversationsPrefix,
		predicate: (query: { queryKey: QueryKey }) =>
			query.queryKey.at(-1) === accountId &&
			query.queryKey.at(-2) === "account",
	};
	client.setQueriesData<TeamBridgeConversationList>(owned, (page) =>
		page === undefined
			? page
			: {
					...page,
					conversations: page.conversations.map((conversation) =>
						conversation.id === updated.id &&
						conversation.tenant_id === updated.tenant_id
							? updated
							: conversation,
					),
				},
	);
}

export function useCreateTeamBridgeConversation(
	tenantId?: string,
	isCurrent: () => boolean = () => true,
): UseMutationResult<
	unknown,
	Error,
	Parameters<typeof TeamBridgeApi.startConversation>[0]
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	type Input = Parameters<typeof TeamBridgeApi.startConversation>[0];
	const mutation = useMutation<
		unknown,
		Error,
		CapturedBridgeMutation<Input, BridgeWriteTarget>
	>({
		/*
		 * NEVER RETRIED (#1511 review round 7 m1 / QA round 5 Q1). A group create is
		 * not find-or-create, so the shared client's `retry: 1` turns any failure
		 * after the server committed - a receipt that fails to parse, a transport
		 * error on the way back - into a second group. The failed row's Retry is
		 * the explicit second attempt.
		 */
		retry: 0,
		mutationFn: ({ input, target }) => {
			target.assertCurrent();
			if (!target.isCurrent())
				throw new Error("Team Bridge write authority changed");
			return TeamBridgeApi.startConversation({
				...input,
				tenantId: target.tenantId,
				expectedAccountId: target.accountId,
			});
		},
		onSuccess: async (_data, { target }) => {
			// Save the returned receipt even if stale; only effects need current authority.
			if (!target.isCurrent()) return;
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
		},
	});
	return bindBridgeMutation(mutation, () => ({
		...owner,
		conversationId: "",
		tenantId,
		isCurrent: () => owner.isCurrent() && isCurrent(),
	}));
}

/* ------------------------------------------------------------------ */
/* Archive / unarchive / permanent delete                              */
/* ------------------------------------------------------------------ */

/**
 * What one lifecycle write names. The conversation is part of the VARIABLES, not
 * only the closure, for the reason `TeamBridgeNotifyMutationVariables` states: a
 * refusal can settle after the reader has opened another conversation, and the
 * page must not show A's error under B.
 */
export type TeamBridgeLifecycleMutationVariables = {
	conversationId: string;
	tenantId?: string;
};

/** The rollback snapshot carried from `onMutate` to `onError`. */
export type TeamBridgeLifecycleMutationContext = {
	snapshots: Array<[QueryKey, TeamBridgeConversationList | undefined]>;
};

/**
 * Every cached conversation page this account owns, live and archived alike.
 * The account tail is what keeps a write from touching another account's cache
 * (the same predicate the notify write uses).
 */
function ownedConversationPages(accountId?: string) {
	return {
		queryKey: teamBridgeKeys.conversationsPrefix,
		predicate: (query: { queryKey: QueryKey }) =>
			query.queryKey.at(-1) === accountId &&
			query.queryKey.at(-2) === "account",
	};
}

/**
 * Archive, optimistically.
 *
 * WHY OPTIMISTIC. The person has already confirmed in a dialog that states the
 * consequence; making the sidebar wait on a round trip afterwards would feel like
 * the click was ignored. The row leaves every cached page at once and a refusal
 * restores the exact snapshots taken first, so nothing here needs to know how to
 * put a row back. `onSettled` re-reads the truth either way, which is also what
 * fills the archived list.
 */
export function archiveMutationOptions(
	client: QueryClient,
	isCurrent?: () => boolean,
): UseMutationOptions<
	unknown,
	Error,
	TeamBridgeLifecycleMutationVariables,
	TeamBridgeLifecycleMutationContext
> {
	const { accountId, epoch } = observedRadientAuthority(client);
	const current = () =>
		bridgeOwnerCurrent(client, accountId) && (isCurrent?.() ?? true);
	const check = () => {
		if (!current()) throw new Error("Team Bridge write authority changed");
	};
	const owned = ownedConversationPages(accountId);
	return {
		mutationKey: [...teamBridgeKeys.all, "archive", accountId, epoch],
		mutationFn: ({ conversationId, tenantId }) => {
			check();
			return TeamBridgeApi.setArchived(
				conversationId,
				true,
				tenantId,
				accountId,
			);
		},
		onMutate: async ({ conversationId, tenantId }) => {
			check();
			await client.cancelQueries(owned);
			check();
			const snapshots =
				client.getQueriesData<TeamBridgeConversationList>(owned);
			client.setQueriesData<TeamBridgeConversationList>(owned, (page) =>
				page === undefined
					? page
					: withoutConversation(page, conversationId, tenantId),
			);
			return { snapshots };
		},
		onError: (_error, _variables, context) => {
			if (!current()) return;
			for (const [key, data] of context?.snapshots ?? []) {
				client.setQueryData(key, data);
			}
		},
		onSettled: async () => {
			if (!current()) return;
			await client.invalidateQueries(owned);
			if (!current()) return;
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.unreadPrefix,
			});
		},
	};
}

export function useArchiveTeamBridgeConversation(): UseMutationResult<
	unknown,
	Error,
	TeamBridgeLifecycleMutationVariables,
	TeamBridgeLifecycleMutationContext
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	return useMutation(archiveMutationOptions(client, owner.isCurrent));
}

/**
 * Unarchive.
 *
 * The row is flipped to `open` in place rather than removed: the person is
 * usually looking at that very channel (the banner's Unarchive), and removing it
 * from the archived page before the live page has it would leave the pane with
 * nothing to show for a beat. `onSettled` re-reads both pages, which moves the
 * row to its real home.
 */
export function unarchiveMutationOptions(
	client: QueryClient,
	isCurrent?: () => boolean,
): UseMutationOptions<
	unknown,
	Error,
	TeamBridgeLifecycleMutationVariables,
	TeamBridgeLifecycleMutationContext
> {
	const { accountId, epoch } = observedRadientAuthority(client);
	const current = () =>
		bridgeOwnerCurrent(client, accountId) && (isCurrent?.() ?? true);
	const check = () => {
		if (!current()) throw new Error("Team Bridge write authority changed");
	};
	const owned = ownedConversationPages(accountId);
	return {
		mutationKey: [...teamBridgeKeys.all, "unarchive", accountId, epoch],
		mutationFn: ({ conversationId, tenantId }) => {
			check();
			return TeamBridgeApi.setArchived(
				conversationId,
				false,
				tenantId,
				accountId,
			);
		},
		onMutate: async ({ conversationId, tenantId }) => {
			check();
			await client.cancelQueries(owned);
			check();
			const snapshots =
				client.getQueriesData<TeamBridgeConversationList>(owned);
			client.setQueriesData<TeamBridgeConversationList>(owned, (page) =>
				page === undefined
					? page
					: withConversationStatus(page, conversationId, "open", tenantId),
			);
			return { snapshots };
		},
		onError: (_error, _variables, context) => {
			if (!current()) return;
			for (const [key, data] of context?.snapshots ?? []) {
				client.setQueryData(key, data);
			}
		},
		onSettled: async () => {
			if (!current()) return;
			await client.invalidateQueries(owned);
			if (!current()) return;
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.unreadPrefix,
			});
		},
	};
}

export function useUnarchiveTeamBridgeConversation(): UseMutationResult<
	unknown,
	Error,
	TeamBridgeLifecycleMutationVariables,
	TeamBridgeLifecycleMutationContext
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	return useMutation(unarchiveMutationOptions(client, owner.isCurrent));
}

/**
 * PERMANENT delete. Deliberately NOT optimistic.
 *
 * An archive can be undone, so painting it early is safe; a delete cannot, and a
 * rollback after a refused delete would resurrect a row the person believed was
 * gone. The dialog stays open and pending until the server answers, and the row
 * leaves the cache only on success.
 *
 * A `conversation_not_found` answer is NOT, by itself, success (review round 1, U2).
 * The server answers the same opaque 404 to a caller who has lost authority (a
 * demoted admin, a removed member, a channel that was never theirs) as to one who
 * retries a delete that already finished, so treating every 404 as "deleted" told a
 * person their data was wiped when it was not. It is success ONLY for a retry of a
 * delete whose earlier attempt was inconclusive (a 503, which the server uses for a
 * large channel it is still draining, or a transport failure): then the erasure
 * carried on server-side and "gone" is the expected end. Any other 404 is surfaced
 * as an error and the lists refetch (`onSettled`), so a channel that really is gone
 * disappears from the Archived view and one that is not stays visible.
 *
 * `inconclusive` is owned by the hook (a ref), not this options object, because
 * `useMutation` receives a freshly built options object each render.
 */
export function deleteMutationOptions(
	client: QueryClient,
	isCurrent?: () => boolean,
	inconclusive: Set<string> = new Set(),
): UseMutationOptions<unknown, Error, TeamBridgeLifecycleMutationVariables> {
	const { accountId, epoch } = observedRadientAuthority(client);
	const current = () =>
		bridgeOwnerCurrent(client, accountId) && (isCurrent?.() ?? true);
	const check = () => {
		if (!current()) throw new Error("Team Bridge write authority changed");
	};
	const owned = ownedConversationPages(accountId);
	return {
		mutationKey: [...teamBridgeKeys.all, "delete", accountId, epoch],
		mutationFn: async ({ conversationId, tenantId }) => {
			check();
			try {
				return await TeamBridgeApi.deleteConversation(
					conversationId,
					tenantId,
					accountId,
				);
			} catch (error) {
				const failure = error as { code?: string; status?: number | null };
				if (failure.code === "conversation_not_found") {
					if (inconclusive.delete(conversationId)) return { deleted: true };
					throw error;
				}
				// No status = the request never produced an answer; 5xx = the server
				// is mid-drain. Either way the erasure may have carried on.
				if (
					failure.status === null ||
					failure.status === undefined ||
					failure.status >= 500
				)
					inconclusive.add(conversationId);
				throw error;
			}
		},
		onSuccess: (_data, { conversationId, tenantId }) => {
			if (!current()) return;
			client.setQueriesData<TeamBridgeConversationList>(owned, (page) =>
				page === undefined
					? page
					: withoutConversation(page, conversationId, tenantId),
			);
		},
		onSettled: async () => {
			if (!current()) return;
			await client.invalidateQueries(owned);
			if (!current()) return;
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.unreadPrefix,
			});
		},
	};
}

export function useDeleteTeamBridgeConversation(): UseMutationResult<
	unknown,
	Error,
	TeamBridgeLifecycleMutationVariables
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	const inconclusive = useRef(new Set<string>());
	return useMutation(
		deleteMutationOptions(client, owner.isCurrent, inconclusive.current),
	);
}
