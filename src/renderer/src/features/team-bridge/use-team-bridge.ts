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
import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
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
import type { AgentMessagesStatus } from "../../../../shared/agent-messages-contract";
import type {
	TeamBridgeConversationList,
	TeamBridgeDirectory,
	TeamBridgeDirectoryMember,
	TeamBridgeMessagePage,
	TeamBridgeNotify,
	TeamBridgeReadState,
	TeamBridgeUnread,
} from "../../../../shared/team-bridge-contract";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeScope,
	withNotificationPreference,
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
		/* A conversation needs to feel live: without a poll an incoming message
		   never appears until the reader clicks away. Eight seconds is Slack's
		   order of immediacy for a background tab without an events stream;
		   `refetchIntervalInBackground` stays false so a hidden window does not
		   poll this. */
		refetchInterval: 8_000,
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
 * Returns the loaded rosters by tenant; a pending or failed read is simply
 * absent, and its senders fall back to the unknown placeholder.
 */
export function useTeamBridgeDirectories(
	tenantIds: readonly string[],
	enabled = true,
	accountId?: string,
): Readonly<Record<string, readonly TeamBridgeDirectoryMember[]>> {
	const client = useQueryClient();
	return useQueries({
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
		combine: (results) => {
			const byTenant: Record<string, readonly TeamBridgeDirectoryMember[]> = {};
			results.forEach((result, index) => {
				if (result.data) byTenant[tenantIds[index]] = result.data.members;
			});
			return byTenant;
		},
	});
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
				expectedAccountId: target.accountId,
			});
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
