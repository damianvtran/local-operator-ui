import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	type OwnerAuditScope,
	TeamBridgeOwnerAuditApi,
} from "@shared/api/local-operator/team-bridge-owner-audit-api";
import { isCancelledError, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { readForBridgeOwner, useBridgeOwner } from "./team-bridge-owner";

/** Query rejections are consumed by React Query, so neither React nor the
 * packaged renderer console reports them. The durable diagnostic must explain
 * an HTTP-200-then-error without copying any error prose, keys, stacks or data:
 * a Zod error's message/stack can contain the rejected private audit payload.
 * All non-numeric fields below are authored enums. Unknown codes stay unknown.
 * This is observation only: the original error is rethrown, never retried. */
const AUDIT_ERROR_CODES = new Set([
	"conversation_not_found",
	"account_mismatch",
	"expected_account_mismatch",
	"deadline_exceeded",
	"owner_audit_unavailable",
]);

function auditFailureMetadata(error: unknown) {
	const message = error instanceof Error ? error.message : "";
	const category = isCancelledError(error)
		? "cancelled"
		: message === "Owner audit authority changed"
			? "audit-owner"
			: message === "Team Bridge read owner changed"
				? "bridge-owner"
				: message === "Team Bridge read authority changed"
					? "bridge-authority"
					: message === "Account authority changed" ||
							message === "Account authority unresolved"
						? "credential-authority"
						: error instanceof Error && error.name === "ZodError"
							? "schema"
							: error instanceof DesktopControlError
								? "desktop"
								: "other";
	// A TypeScript annotation is not a runtime privacy boundary. Read only an
	// own data value: neither a status accessor nor coercion/toJSON may run.
	const status =
		error instanceof DesktopControlError
			? Object.getOwnPropertyDescriptor(error, "status")?.value
			: undefined;
	return {
		category,
		errorClass: isCancelledError(error)
			? "CancelledError"
			: error instanceof DesktopControlError
				? "DesktopControlError"
				: error instanceof Error && error.name === "ZodError"
					? "ZodError"
					: error instanceof Error
						? "Error"
						: "unknown",
		status:
			typeof status === "number" &&
			Number.isInteger(status) &&
			status >= 100 &&
			status <= 599
				? status
				: null,
		code:
			error instanceof DesktopControlError && error.code
				? AUDIT_ERROR_CODES.has(error.code)
					? error.code
					: "other"
				: null,
	};
}

/** No member query keys, persistence, polling, unread counts or read markers.
 * gcTime zero releases private bodies when their human-only panel unmounts.
 * The owner epoch fence rejects a late A→B→A settlement as well as a new account;
 * expected_account_id additionally binds the actual server request. */
function useAuditRead(scope: OwnerAuditScope) {
	const client = useQueryClient();
	const owner = useBridgeOwner(scope.accountId);
	return async <T>(read: () => Promise<T>): Promise<T> => {
		/*
		 * THE READ FENCE, NOT THE WRITE ONE. `isCurrent()` is `bridgeOwnerCurrent`,
		 * which also demands `!status.read_only`: that flag governs WRITING to the
		 * agent's surface, and surface state F is deliberately readable. Gating a
		 * read on it rendered the section and then refused every read inside it
		 * (agent review round 1, m1). `isReadCurrent()` keeps the part this read
		 * actually needs — the captured account and the credential epoch.
		 */
		if (!owner.isReadCurrent())
			throw new Error("Owner audit authority changed");
		const answer = (await readForBridgeOwner(
			client,
			scope.accountId,
			read,
		)) as T;
		if (!owner.isReadCurrent())
			throw new Error("Owner audit authority changed");
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
