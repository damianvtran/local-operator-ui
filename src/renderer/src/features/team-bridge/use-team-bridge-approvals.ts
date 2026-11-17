import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
/**
 * React bindings for Team Bridge approvals: the pending-requests read (shared
 * by the nav badge and the Requests panel), the decision ledger, and the
 * two-step decide (authorize with Touch ID, then decide).
 *
 * The rules live in `team-bridge-approvals-model.ts`; this file only owns the
 * query keys, the account fence and the flow's state.
 */
import {
	type ApprovalOperatorProof,
	TeamBridgeApprovalsApi,
} from "@shared/api/local-operator/team-bridge-approvals-api";
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type ApprovalDecideResult,
	type ApprovalRefusal,
	type ApprovalSelectionItem,
	authorizeNoticesSnapshot,
	mapApprovalRefusal,
	newClientRef,
	subscribeAuthorizeNotices,
} from "./team-bridge-approvals-model";
import { teamBridgeKeys } from "./team-bridge-keys";
import { readForBridgeOwner, useTeamBridgeAccount } from "./team-bridge-owner";
import {
	TEAM_BRIDGE_BADGE_POLL_HIDDEN_MS,
	TEAM_BRIDGE_BADGE_POLL_VISIBLE_MS,
} from "./use-team-bridge";

const approvalsKey = (part: "requests" | "decisions", accountId?: string) =>
	[
		...teamBridgeKeys.all,
		"approvals",
		part,
		accountId ?? "unresolved-owner",
	] as const;

/*
 * A daemon older than #4099 answers 404 for these routes. That is "this build
 * has no approvals", not an error the person can act on: the badge stays
 * quiet, the rail entry is not drawn, and the read is not retried.
 */
export function approvalsUnsupported(error: unknown): boolean {
	return error instanceof DesktopControlError && error.status === 404;
}

function pollInterval(): number {
	if (typeof document === "undefined") return TEAM_BRIDGE_BADGE_POLL_HIDDEN_MS;
	// The same quiet cadence the unread badge keeps; a decision the person makes
	// here invalidates the read directly, so the poll only catches new arrivals.
	return document.visibilityState === "visible"
		? TEAM_BRIDGE_BADGE_POLL_VISIBLE_MS
		: TEAM_BRIDGE_BADGE_POLL_HIDDEN_MS;
}

export function useApprovalRequests(enabled: boolean) {
	const client = useQueryClient();
	const { accountId } = useTeamBridgeAccount();
	return useQuery({
		queryKey: approvalsKey("requests", accountId),
		queryFn: () =>
			readForBridgeOwner(client, accountId, () =>
				TeamBridgeApprovalsApi.requests(accountId as string),
			),
		enabled: enabled && Boolean(accountId),
		staleTime: 30_000,
		refetchInterval: (query) =>
			approvalsUnsupported(query.state.error) ? false : pollInterval(),
		refetchOnWindowFocus: true,
		retry: (count, error) => !approvalsUnsupported(error) && count < 1,
	});
}

export function useApprovalDecisions(enabled: boolean) {
	const client = useQueryClient();
	const { accountId } = useTeamBridgeAccount();
	return useQuery({
		queryKey: approvalsKey("decisions", accountId),
		queryFn: () =>
			readForBridgeOwner(client, accountId, () =>
				TeamBridgeApprovalsApi.decisions(accountId as string),
			),
		enabled: enabled && Boolean(accountId),
		staleTime: 30_000,
		retry: (count, error) => !approvalsUnsupported(error) && count < 1,
	});
}

function invalidateApprovals(client: QueryClient) {
	return client.invalidateQueries({
		queryKey: [...teamBridgeKeys.all, "approvals"],
	});
}

/** The decide flow's visible state. */
export type ApprovalFlowState =
	| { phase: "idle" }
	/* Touch ID is up (or about to be); the daemon holds the request open. */
	| { phase: "authorizing"; items: ApprovalSelectionItem[] }
	| { phase: "deciding"; items: ApprovalSelectionItem[] }
	| { phase: "done"; results: ApprovalDecideResult[] }
	| { phase: "refused"; refusal: ApprovalRefusal };

/**
 * Authorize, then decide. One flow at a time: a second press while a prompt is
 * up is ignored here, and the daemon would refuse it anyway
 * (`operator_prompt_in_flight`). Nothing retries on its own - a dismissed or
 * expired confirmation is the person's to repeat, so a second Touch ID sheet
 * never appears that they did not ask for.
 */
export function useApprovalDecide(names: (messageId: string) => string | null) {
	const client = useQueryClient();
	const { accountId } = useTeamBridgeAccount();
	const [state, setState] = useState<ApprovalFlowState>({ phase: "idle" });
	const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
	const busy = useRef(false);
	const namesRef = useRef(names);
	namesRef.current = names;

	// Re-render once the cooldown elapses so the confirm actions re-enable.
	useEffect(() => {
		if (cooldownUntil === null) return;
		const wait = cooldownUntil - Date.now();
		if (wait <= 0) {
			setCooldownUntil(null);
			return;
		}
		const timer = setTimeout(() => setCooldownUntil(null), wait);
		return () => clearTimeout(timer);
	}, [cooldownUntil]);

	const run = useCallback(
		async (items: ApprovalSelectionItem[]) => {
			if (busy.current || items.length === 0 || !accountId) return;
			busy.current = true;
			setState({ phase: "authorizing", items });
			try {
				const clientRef = newClientRef();
				const authorized = await TeamBridgeApprovalsApi.authorize(
					accountId,
					items,
					clientRef,
				);
				setState({ phase: "deciding", items });
				const proof: ApprovalOperatorProof = authorized.operator_proof;
				const results = await TeamBridgeApprovalsApi.decide(
					accountId,
					items,
					proof,
				);
				setState({ phase: "done", results });
			} catch (error) {
				const refusal = mapApprovalRefusal(error, namesRef.current);
				if (refusal.kind === "cooldown")
					setCooldownUntil(Date.now() + refusal.retryAfterS * 1000);
				setState({ phase: "refused", refusal });
			} finally {
				busy.current = false;
				void invalidateApprovals(client);
			}
		},
		[accountId, client],
	);

	const reset = useCallback(() => setState({ phase: "idle" }), []);
	return { state, run, reset, coolingDown: cooldownUntil !== null };
}

/** The live Touch ID prompt notices (see `applyAuthorizeFrame`). */
export function useAuthorizeNotices() {
	return useSyncExternalStore(
		subscribeAuthorizeNotices,
		authorizeNoticesSnapshot,
		authorizeNoticesSnapshot,
	);
}
