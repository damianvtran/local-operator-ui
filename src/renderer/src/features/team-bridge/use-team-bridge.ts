/**
 * The Team Bridge page's reads and writes.
 *
 * Two cadences, deliberately different:
 *
 * - the conversation LIST re-reads on window focus and after every write, but
 *   does not poll: a person looking at the page can pull to refresh through the
 *   focus event, and a constant list poll would be a second, redundant traffic
 *   source beside the badge.
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
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type {
	TeamBridgeConversationList,
	TeamBridgeMessagePage,
	TeamBridgeReadState,
	TeamBridgeUnread,
} from "../../../../shared/team-bridge-contract";

export const teamBridgeKeys = {
	all: ["team-bridge"] as const,
	conversations: (tenantId?: string) =>
		[...teamBridgeKeys.all, "conversations", tenantId ?? "default"] as const,
	messages: (conversationId: string, tenantId?: string) =>
		[
			...teamBridgeKeys.all,
			"messages",
			tenantId ?? "default",
			conversationId,
		] as const,
	unread: (tenantId?: string) =>
		[...teamBridgeKeys.all, "unread", tenantId ?? "default"] as const,
};

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
	tenantId?: string,
): UseQueryResult<TeamBridgeConversationList> {
	return useQuery({
		queryKey: teamBridgeKeys.conversations(tenantId),
		queryFn: () => TeamBridgeApi.listConversations(tenantId),
		staleTime: 15_000,
		refetchOnWindowFocus: true,
	});
}

export function useTeamBridgeMessages(
	conversationId: string | null,
	tenantId?: string,
): UseQueryResult<TeamBridgeMessagePage> {
	return useQuery({
		queryKey: teamBridgeKeys.messages(conversationId ?? "none", tenantId),
		queryFn: () =>
			TeamBridgeApi.listMessages(conversationId as string, { tenantId }),
		enabled: Boolean(conversationId),
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
export function useTeamBridgeIdentity(): UseQueryResult<string | null> {
	return useQuery({
		queryKey: [...teamBridgeKeys.all, "identity"] as const,
		queryFn: () => TeamBridgeApi.identity(),
		staleTime: 5 * 60_000,
		retry: 1,
	});
}

/**
 * The one badge read. `enabled` is the capability gate: a backend without the
 * conversation surface must not be polled for a route it does not have.
 */
export function useTeamBridgeUnread(
	enabled: boolean,
	tenantId?: string,
): UseQueryResult<TeamBridgeUnread> {
	return useQuery({
		queryKey: teamBridgeKeys.unread(tenantId),
		queryFn: () => TeamBridgeApi.unread(tenantId),
		enabled,
		staleTime: 30_000,
		refetchInterval: badgeInterval(),
		refetchOnWindowFocus: true,
		// A failed badge read is not an error the user can act on; the next poll
		// is the retry. The page shows its own error state for the list.
		retry: 1,
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
		onSuccess: async () => {
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.messages(conversationId, tenantId),
			});
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversations(tenantId),
			});
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.unread(tenantId),
			});
		},
	});
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
				queryKey: teamBridgeKeys.conversations(tenantId),
			});
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.unread(tenantId),
			});
		},
	});
}

export function useCreateTeamBridgeConversation(
	tenantId?: string,
): UseMutationResult<
	unknown,
	Error,
	Parameters<typeof TeamBridgeApi.startConversation>[0]
> {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input) =>
			TeamBridgeApi.startConversation({ ...input, tenantId }),
		onSuccess: async () => {
			await client.invalidateQueries({
				queryKey: teamBridgeKeys.conversations(tenantId),
			});
		},
	});
}
