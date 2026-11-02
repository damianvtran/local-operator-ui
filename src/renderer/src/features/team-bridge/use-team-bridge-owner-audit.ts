import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	type OwnerAuditScope,
	TeamBridgeOwnerAuditApi,
} from "@shared/api/local-operator/team-bridge-owner-audit-api";
import {
	observedRadientAuthority,
	radientAuthoritySnapshot,
	subscribeRadientAuthority,
	useObservedRadientAuthority,
} from "@shared/hooks/radient-account-authority";
import {
	CancelledError,
	type InfiniteData,
	isCancelledError,
	useInfiniteQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { AgentMessagesStatus } from "../../../../shared/agent-messages-contract";
import { teamBridgeKeys } from "./team-bridge-keys";
import { bridgeStatusAuthority, readForBridgeOwner } from "./team-bridge-owner";

/** Classification only observes: recovery and presentation consume authored
 * metadata without echoing or replacing the original refusal. The durable
 * diagnostic below deliberately does NOT serialize this richer classifier. */
const AUDIT_ERROR_CODES = new Set([
	"conversation_not_found",
	"account_mismatch",
	"expected_account_mismatch",
	"deadline_exceeded",
	"owner_audit_unavailable",
]);

export function auditFailureMetadata(error: unknown) {
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

export type AuditFailureState =
	| "auth"
	| "permission"
	| "not-found"
	| "unavailable"
	| "error";

/** Presentation consumes the shared diagnostic taxonomy, never error prose or
 * an unvetted server code. Unknown transport/status/schema failures stay unknown. */
export function auditFailureState(error: unknown): AuditFailureState {
	const failure = auditFailureMetadata(error);
	if (
		failure.category === "credential-authority" ||
		failure.status === 401 ||
		failure.code === "account_mismatch" ||
		failure.code === "expected_account_mismatch"
	)
		return "auth";
	if (failure.status === 403) return "permission";
	if (failure.status === 404 || failure.code === "conversation_not_found")
		return "not-found";
	if (failure.status !== null && failure.status >= 500) return "unavailable";
	return "error";
}

/** One extra attempt for an HTTP server failure, regardless of body code. The
 * transport can synthesize an unfamiliar code for an uncoded 503; that must not
 * downgrade the numeric 5xx signal. A null status is NOT proof of a transient
 * network fault. In particular, a 401 may only commission a NEW
 * epoch-qualified read after real credential settlement; retry never does that. */
export function retryOwnerAuditRead(
	failureCount: number,
	error: unknown,
): boolean {
	const failure = auditFailureMetadata(error);
	return (
		failureCount < 1 &&
		failure.category === "desktop" &&
		failure.status !== null &&
		failure.status >= 500
	);
}

export const AUDIT_RETRY_DELAY_MS = 250;
export const AUDIT_AUTH_SETTLEMENT_MS = 1000;

/** Observe, never manufacture, a credential transition. Time out without
 * changing auth state or calling a renderer-owned refresh (none exists). */
export function waitForAuditAuthoritySettlement(
	client: ReturnType<typeof useQueryClient>,
	epoch: number,
): Promise<boolean> {
	return new Promise((resolve) => {
		let unsubscribe = () => {};
		const finish = (settled: boolean) => {
			clearTimeout(timeout);
			unsubscribe();
			resolve(settled);
		};
		const check = () => {
			const current = observedRadientAuthority(client);
			if (current.epoch > epoch && current.accountId) finish(true);
		};
		const timeout = setTimeout(() => finish(false), AUDIT_AUTH_SETTLEMENT_MS);
		unsubscribe = subscribeRadientAuthority(client, check);
		check();
	});
}

/** No member query keys, persistence, polling, unread counts or read markers.
 * gcTime zero releases private bodies when their human-only panel unmounts.
 * The owner epoch fence rejects a late A→B→A settlement as well as a new account;
 * expected_account_id additionally binds the actual server request. */
function useAuditRead(
	scope: OwnerAuditScope,
	operation: "conversations" | "messages" | "replies",
) {
	const client = useQueryClient();
	const authority = useObservedRadientAuthority();
	const subscribe = useCallback(
		(listener: () => void) => client.getQueryCache().subscribe(listener),
		[client],
	);
	const snapshot = useCallback(
		() =>
			JSON.stringify(
				bridgeStatusAuthority(
					client.getQueryData<AgentMessagesStatus>(
						teamBridgeKeys.statusFor(scope.accountId),
					),
				),
			),
		[client, scope.accountId],
	);
	const bridgeToken = useSyncExternalStore(subscribe, snapshot, snapshot);
	const authorityToken = `${authority.token}:${bridgeToken}`;
	const enabled =
		authority.accountId === scope.accountId &&
		Boolean(scope.tenantId) &&
		client.getQueryData<AgentMessagesStatus>(
			teamBridgeKeys.statusFor(scope.accountId),
		)?.account_id === scope.accountId;
	// Keep diagnostics bounded per scope and operation without logging scope IDs.
	// Authority rebinds retain the budget, so recovery cannot amplify the log.
	const diagnostic = useMemo(
		() => ({
			accountId: scope.accountId,
			tenantId: scope.tenantId,
			operation,
			remaining: 20,
		}),
		[scope.accountId, scope.tenantId, operation],
	);
	const unauthorized = useRef(0);
	const read = async <T>(
		request: () => Promise<T>,
		signal: AbortSignal,
	): Promise<T> => {
		const token = authority.token;
		// Consume the query's signal so its last observer leaving cancels the
		// retryer immediately. gcTime:0 alone cannot remove a fetching query:
		// a remount would inherit this departed mount's promise, whose fence
		// rejection reverts it to pending/idle with nothing left to settle it.
		// Use the QUERY lifetime, not one observer's mounted ref: if two readers
		// share a key, either can leave without invalidating the other's read.
		// IPC invoke cannot be aborted; the signal abandons its result instead.
		const isCurrent = () =>
			!signal.aborted &&
			radientAuthoritySnapshot(client) === token &&
			observedRadientAuthority(client).accountId === scope.accountId &&
			snapshot() === bridgeToken;
		/* Capture READ authority per query generation, rather than once for the
		 * component's lifetime: a real credential transition must commission a
		 * fresh closure without reviving the old one. Observer/account/epoch fences
		 * remain, and readForBridgeOwner keeps its original admission/settlement
		 * checks. Do not use the write fence's !read_only requirement here: state
		 * F is deliberately readable (original agent review round 1, m1). */
		try {
			if (!isCurrent()) throw new Error("Owner audit authority changed");
			const answer = await readForBridgeOwner(client, scope.accountId, request);
			if (!isCurrent()) throw new Error("Owner audit authority changed");
			unauthorized.current = 0;
			return answer;
		} catch (error) {
			/* The only durable fields are operation and statusClass. Never log
			 * error prose, stacks, codes, message bodies, IDs, tokens, query keys,
			 * or the classifier object. Read an own numeric status without invoking
			 * accessors/coercion/toJSON; unknown failures stay unattributed. */
			if (diagnostic.remaining > 0) {
				diagnostic.remaining -= 1;
				const status =
					error instanceof DesktopControlError
						? Object.getOwnPropertyDescriptor(error, "status")?.value
						: undefined;
				const statusClass =
					typeof status === "number" &&
					Number.isInteger(status) &&
					status >= 100 &&
					status <= 599
						? `${Math.floor(status / 100)}xx`
						: "unknown";
				try {
					console.warn(
						"[owner-audit-read]",
						JSON.stringify({ operation, statusClass }),
					);
				} catch {
					// Observability must not replace a refusal or alter recovery.
				}
			}
			// A rejection can arrive late too; it must not start a retry or an
			// auth wait on behalf of credentials that no longer own the panel.
			if (!isCurrent()) throw new CancelledError({ revert: true });
			const failure = auditFailureMetadata(error);
			// Cancellation is not a presentation error class: it is the action
			// triggered by a rejected authority. The subscribed token changes the
			// query key and commissions a fresh closure; NEVER retry the old one.
			if (
				[
					"cancelled",
					"audit-owner",
					"bridge-owner",
					"bridge-authority",
					"credential-authority",
				].includes(failure.category)
			) {
				throw new CancelledError({ revert: true });
			}
			if (failure.status === 401 && ++unauthorized.current === 1) {
				if (await waitForAuditAuthoritySettlement(client, authority.epoch)) {
					throw new CancelledError({ revert: true });
				}
			}
			throw error;
		}
	};
	return { read, authorityToken, enabled };
}

export function useOwnerAuditConversations(scope: OwnerAuditScope) {
	const { read, authorityToken, enabled } = useAuditRead(
		scope,
		"conversations",
	);
	const query = useInfiniteQuery({
		queryKey: [
			"team-bridge",
			"owner-audit",
			scope.accountId,
			scope.tenantId,
			authorityToken,
			"conversations",
		],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam, signal }) =>
			read(
				() => TeamBridgeOwnerAuditApi.conversations(scope, pageParam),
				signal,
			),
		getNextPageParam: (last, _pages, previous) =>
			last.has_more && last.next_cursor && last.next_cursor !== previous
				? last.next_cursor
				: undefined,
		enabled,
		gcTime: 0,
		retry: retryOwnerAuditRead,
		retryDelay: AUDIT_RETRY_DELAY_MS,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retryOnMount: false,
	});
	return { ...query, auditAuthRequired: !enabled };
}

export function useOwnerAuditMessages(
	scope: OwnerAuditScope,
	conversationId: string,
	canEvictPage?: (
		page: Awaited<ReturnType<typeof TeamBridgeOwnerAuditApi.messages>>,
	) => boolean,
) {
	const { read, authorityToken, enabled } = useAuditRead(scope, "messages");
	const client = useQueryClient();
	const queryKey = [
		"team-bridge",
		"owner-audit",
		scope.accountId,
		scope.tenantId,
		authorityToken,
		conversationId,
		"messages",
	] as const;
	const query = useInfiniteQuery({
		queryKey,
		// Six bounded pages cap private cache and DOM at 300 main-timeline rows.
		// Further upward reads slide the window, never eagerly fetch all history.
		maxPages: 6,
		initialPageParam: undefined as number | undefined,
		queryFn: async ({ pageParam, signal }) => {
			const page = await read(
				() =>
					TeamBridgeOwnerAuditApi.messages(scope, conversationId, pageParam),
				signal,
			);
			const cached = client.getQueryData<InfiniteData<typeof page>>(queryKey);
			// The user may return to the recent page while an older request is in
			// flight. Never evict a visible row merely to admit that late result:
			// cancel/revert this pagination attempt, keeping the six existing pages.
			// A later explicit upward read can retry the same cursor; no auto retry.
			if (
				pageParam !== undefined &&
				cached &&
				cached.pages.length >= 6 &&
				canEvictPage &&
				!canEvictPage(cached.pages[0])
			)
				throw new CancelledError({ revert: true });
			return page;
		},
		getNextPageParam: (last, _pages, previous) =>
			last.has_more &&
			last.next_before_seq != null &&
			(previous === undefined || last.next_before_seq < previous)
				? last.next_before_seq
				: undefined,
		enabled,
		gcTime: 0,
		retry: retryOwnerAuditRead,
		retryDelay: AUDIT_RETRY_DELAY_MS,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retryOnMount: false,
	});
	return {
		...query,
		auditAuthRequired: !enabled,
		// A slid window's oldest retained cursor is not the newest page. Refresh
		// explicitly resets to the uncursored 50-row read, rather than refetching
		// stale middle-history cursors. No bodies outlive this panel's gcTime:0.
		refetchLatest: () => client.resetQueries({ queryKey, exact: true }),
	};
}

export function useOwnerAuditReplies(
	scope: OwnerAuditScope,
	conversationId: string,
	rootId: string,
) {
	const { read, authorityToken, enabled } = useAuditRead(scope, "replies");
	const query = useInfiniteQuery({
		queryKey: [
			"team-bridge",
			"owner-audit",
			scope.accountId,
			scope.tenantId,
			authorityToken,
			conversationId,
			"replies",
			rootId,
		],
		initialPageParam: undefined as number | undefined,
		queryFn: ({ pageParam, signal }) =>
			read(
				() =>
					TeamBridgeOwnerAuditApi.replies(
						scope,
						conversationId,
						rootId,
						pageParam,
					),
				signal,
			),
		getNextPageParam: (last, _pages, previous) =>
			last.has_more &&
			last.next_after_seq != null &&
			(previous === undefined || last.next_after_seq > previous)
				? last.next_after_seq
				: undefined,
		enabled,
		gcTime: 0,
		retry: retryOwnerAuditRead,
		retryDelay: AUDIT_RETRY_DELAY_MS,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retryOnMount: false,
	});
	return { ...query, auditAuthRequired: !enabled };
}
