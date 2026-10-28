import {
	type OwnerAuditScope,
	TeamBridgeOwnerAuditApi,
} from "@shared/api/local-operator/team-bridge-owner-audit-api";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { readForBridgeOwner, useBridgeOwner } from "./team-bridge-owner";

/** No member query keys, persistence, polling, unread counts or read markers.
 * gcTime zero releases private bodies when their human-only panel unmounts.
 * The owner epoch fence rejects a late A→B→A settlement as well as a new account;
 * expected_account_id additionally binds the actual server request. */
function useAuditRead(scope: OwnerAuditScope) {
	const client = useQueryClient();
	const owner = useBridgeOwner(scope.accountId);
	return async <T>(read: () => Promise<T>): Promise<T> => {
		if (!owner.isCurrent()) throw new Error("Owner audit authority changed");
		const answer = await readForBridgeOwner(client, scope.accountId, read);
		if (!owner.isCurrent()) throw new Error("Owner audit authority changed");
		return answer;
	};
}

export function useOwnerAuditConversations(scope: OwnerAuditScope) {
	const read = useAuditRead(scope);
	return useInfiniteQuery({
		queryKey: [
			"team-bridge",
			"owner-audit",
			scope.accountId,
			scope.tenantId,
			"conversations",
		],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) =>
			read(() => TeamBridgeOwnerAuditApi.conversations(scope, pageParam)),
		getNextPageParam: (last, _pages, previous) =>
			last.has_more && last.next_cursor && last.next_cursor !== previous
				? last.next_cursor
				: undefined,
		gcTime: 0,
		retry: false,
	});
}

export function useOwnerAuditMessages(
	scope: OwnerAuditScope,
	conversationId: string,
) {
	const read = useAuditRead(scope);
	return useInfiniteQuery({
		queryKey: [
			"team-bridge",
			"owner-audit",
			scope.accountId,
			scope.tenantId,
			conversationId,
			"messages",
		],
		initialPageParam: undefined as number | undefined,
		queryFn: ({ pageParam }) =>
			read(() =>
				TeamBridgeOwnerAuditApi.messages(scope, conversationId, pageParam),
			),
		getNextPageParam: (last, _pages, previous) =>
			last.has_more &&
			last.next_before_seq != null &&
			(previous === undefined || last.next_before_seq < previous)
				? last.next_before_seq
				: undefined,
		gcTime: 0,
		retry: false,
	});
}

export function useOwnerAuditReplies(
	scope: OwnerAuditScope,
	conversationId: string,
	rootId: string,
) {
	const read = useAuditRead(scope);
	return useInfiniteQuery({
		queryKey: [
			"team-bridge",
			"owner-audit",
			scope.accountId,
			scope.tenantId,
			conversationId,
			"replies",
			rootId,
		],
		initialPageParam: undefined as number | undefined,
		queryFn: ({ pageParam }) =>
			read(() =>
				TeamBridgeOwnerAuditApi.replies(
					scope,
					conversationId,
					rootId,
					pageParam,
				),
			),
		getNextPageParam: (last, _pages, previous) =>
			last.has_more &&
			last.next_after_seq != null &&
			(previous === undefined || last.next_after_seq > previous)
				? last.next_after_seq
				: undefined,
		gcTime: 0,
		retry: false,
	});
}
