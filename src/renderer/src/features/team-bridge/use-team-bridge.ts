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
const ROOT = ["team-bridge"] as const;

// Admission belongs to an account as well as a tenant. Append the owner so
// existing invalidation prefixes still work, without exposing another account's
// cached private rows while its own request is pending or refused.
const readOwner = (accountId?: string) =>
	accountId ? ["account", accountId] : [];

export const teamBridgeKeys = {
	all: ROOT,
	conversations: (scope: TeamBridgeScope, accountId?: string) =>
		[...ROOT, "conversations", scope, ...readOwner(accountId)] as const,
	conversationsPrefix: [...ROOT, "conversations"] as const,
	messages: (conversationId: string, tenantId?: string, accountId?: string) =>
		[
			...ROOT,
			"messages",
			tenantId ?? "unknown-tenant",
			conversationId,
			...readOwner(accountId),
		] as const,
	unread: (scope: TeamBridgeScope, accountId?: string) =>
		[...ROOT, "unread", scope, ...readOwner(accountId)] as const,
	unreadPrefix: [...ROOT, "unread"] as const,
	/*
	 * The People section's two reads. The directory is keyed by TENANT (the
	 * section only exists for one organization), so switching scope refetches
	 * into a different key and a previous organization's roster is never shown
	 * under the new title. The status read is one key: the platform state does
	 * not vary by scope.
	 */
	directory: (tenantId: string, accountId?: string) =>
		[...ROOT, "directory", tenantId, ...readOwner(accountId)] as const,
	status: [...ROOT, "status"] as const,
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
	return useQuery({
		queryKey: teamBridgeKeys.conversations(scope, accountId),
		queryFn: () => TeamBridgeApi.listConversations(readScope(scope)),
		enabled,
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
	return useQuery({
		queryKey: teamBridgeKeys.messages(
			conversationId ?? "none",
			tenantId,
			accountId,
		),
		queryFn: () =>
			TeamBridgeApi.listMessages(conversationId as string, { tenantId }),
		enabled: enabled && Boolean(conversationId),
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

/** The signed-in hub account id (own-message alignment, DM titles). */
export function useTeamBridgeIdentity(
	enabled = true,
): UseQueryResult<string | null> {
	return useQuery({
		queryKey: [...teamBridgeKeys.all, "identity"] as const,
		queryFn: () => TeamBridgeApi.identity(),
		enabled,
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
	return useQuery({
		queryKey: teamBridgeKeys.directory(tenantId ?? "none", accountId),
		queryFn: () => TeamBridgeApi.directory(tenantId as string),
		enabled: enabled && Boolean(tenantId),
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
	return useQueries({
		queries: tenantIds.map((tenantId) => ({
			queryKey: teamBridgeKeys.directory(tenantId, accountId),
			queryFn: () => TeamBridgeApi.directory(tenantId),
			enabled,
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
export function useTeamBridgeStatus(): UseQueryResult<AgentMessagesStatus> {
	return useQuery({
		queryKey: teamBridgeKeys.status,
		queryFn: () => TeamBridgeApi.status("surface_open"),
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
	return useQuery({
		queryKey: teamBridgeKeys.unread(scope, options.accountId),
		queryFn: () => TeamBridgeApi.unread(readScope(scope)),
		enabled,
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
): UseMutationResult<unknown, Error, { clientRef: string; body: string }> {
	const client = useQueryClient();
	return useMutation({
		mutationFn: ({ clientRef, body }) =>
			TeamBridgeApi.send(conversationId, { clientRef, body, tenantId }),
		onSuccess: () => refreshAfterSend(client, conversationId, tenantId),
	});
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
	return useMutation({
		mutationFn: () => TeamBridgeApi.join(conversationId, tenantId),
		onSuccess: async () => {
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.messages(conversationId, tenantId),
			});
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.unreadPrefix,
			});
		},
	});
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
): UseMutationOptions<
	TeamBridgeReadState,
	Error,
	TeamBridgeNotifyMutationVariables,
	TeamBridgeNotifyMutationContext
> {
	return {
		mutationFn: ({ conversationId, notify, tenantId }) =>
			TeamBridgeApi.setNotify(conversationId, notify, tenantId),
		onMutate: async ({ conversationId, notify }) => {
			await client.cancelQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
			const snapshots = client.getQueriesData<TeamBridgeConversationList>({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
			client.setQueriesData<TeamBridgeConversationList>(
				{ queryKey: teamBridgeKeys.conversationsPrefix },
				(current) =>
					current === undefined
						? current
						: withNotificationPreference(current, conversationId, notify),
			);
			return { snapshots };
		},
		onError: (_error, _variables, context) => {
			for (const [key, data] of context?.snapshots ?? []) {
				client.setQueryData(key, data);
			}
		},
		onSettled: async () => {
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
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
	return useMutation(notifyMutationOptions(client));
}

export function useMarkTeamBridgeRead(
	conversationId: string,
	tenantId?: string,
): UseMutationResult<TeamBridgeReadState, Error, { seq: number }> {
	const client = useQueryClient();
	return useMutation({
		mutationFn: ({ seq }) =>
			TeamBridgeApi.markRead(conversationId, { seq, tenantId }),
		onSuccess: async () => {
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.unreadPrefix,
			});
		},
	});
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
	return useMutation({
		mutationFn: (input) => {
			if (!isCurrent()) throw new Error("Team Bridge write authority changed");
			return TeamBridgeApi.startConversation({ ...input, tenantId });
		},
		onSuccess: async () => {
			// The caller's continuation runs AFTER this hook. Guard here too or
			// a stale create refreshes another account before that caller can stop it.
			if (!isCurrent()) return;
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversationsPrefix,
			});
		},
	});
}
