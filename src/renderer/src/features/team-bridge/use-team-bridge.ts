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
	requireBridgeWriteAccount,
} from "@shared/api/local-operator/team-bridge-api";
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
import { useMemo, useRef } from "react";
import type { AgentMessagesStatus } from "../../../../shared/agent-messages-contract";
import type {
	TeamBridgeConversation,
	TeamBridgeConversationList,
	TeamBridgeDirectory,
	TeamBridgeDirectoryMember,
	TeamBridgeMemberInput,
	TeamBridgeMessagePage,
	TeamBridgeNotify,
	TeamBridgeReadState,
	TeamBridgeUnread,
} from "../../../../shared/team-bridge-contract";
import {
	TEAM_BRIDGE_AGENT_PARTICIPATION_VERSION,
	withAgentInvitationAnswer,
	withoutAgentInvitationAnswer,
} from "./team-bridge-invitations-model";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeScope,
	isNotAMemberRefusal,
	withAppendedPage,
	withConversationStatus,
	withNotificationPreference,
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

export function useTeamBridgeMessages(
	conversationId: string | null,
	tenantId?: string,
	enabled = true,
	accountId?: string,
): UseQueryResult<TeamBridgeMessagePage> {
	const client = useQueryClient();
	return useQuery({
		queryKey: teamBridgeKeys.messages(
			conversationId ?? "none",
			tenantId,
			accountId ?? "unresolved-owner",
		),
		queryFn: () =>
			readForBridgeOwner(client, accountId, () =>
				TeamBridgeApi.listMessages(conversationId as string, { tenantId }),
			),
		enabled: enabled && Boolean(accountId) && Boolean(conversationId),
		staleTime: 5_000,
		/* `not_a_member` is a definite answer (an administrator opening an archived
		   channel they never joined), not a blip: retrying it only delays the state
		   that explains it, and polling it every eight seconds only repeats the refusal. */
		retry: (failures, error) => !isNotAMemberRefusal(error) && failures < 3,
		/* A conversation needs to feel live: without a poll an incoming message
		   never appears until the reader clicks away. Eight seconds is Slack's
		   order of immediacy for a background tab without an events stream;
		   `refetchIntervalInBackground` stays false so a hidden window does not
		   poll this. */
		refetchInterval: (query) =>
			isNotAMemberRefusal(query.state.error) ? false : 8_000,
		refetchOnWindowFocus: true,
	});
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
		const byTenant = new Map<string, () => void>();
		results.forEach((result, index) => {
			const tenantId = tenantIds[index];
			if (result.data) members[tenantId] = result.data.members;
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
	{ clientRef: string; body: string; attachmentIds?: readonly string[] }
> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	type Input = {
		clientRef: string;
		body: string;
		/* A staged image set this message binds; omitted (never `[]`) for text. */
		attachmentIds?: readonly string[];
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
				mentions: stagedMentions(target.conversationId, input.body),
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
): UseMutationResult<unknown, Error, void> {
	const client = useQueryClient();
	const owner = useBridgeOwner();
	const mutation = useMutation<
		unknown,
		Error,
		CapturedBridgeMutation<void, BridgeWriteTarget>
	>({
		mutationFn: ({ target }) => {
			target.assertCurrent();
			return TeamBridgeApi.join(
				target.conversationId,
				target.tenantId,
				target.accountId,
			);
		},
		onSuccess: (_data, { target }) =>
			refreshAfterSend(
				client,
				target.conversationId,
				target.tenantId,
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

/** One invitation answer: which conversation, in which org, and the choice. */
export type TeamBridgeInvitationAnswer = {
	conversationId: string;
	tenantId: string;
	decision: "accept" | "decline";
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
		mutationFn: ({ conversationId, tenantId, decision }) =>
			TeamBridgeApi.answerAgentInvitation({
				conversationId,
				tenantId,
				decision,
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
		CapturedBridgeMutation<{ seq: number }, BridgeWriteTarget>
	>({
		mutationFn: ({ input, target }) => {
			target.assertCurrent();
			return TeamBridgeApi.markRead(target.conversationId, {
				...input,
				tenantId: target.tenantId,
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
	return bindBridgeMutation(mutation, () => ({
		...owner,
		conversationId,
		tenantId,
	}));
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
