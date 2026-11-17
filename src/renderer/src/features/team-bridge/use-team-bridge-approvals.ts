import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
/**
 * React bindings for Team Bridge approvals: the pending-requests read (shared
 * by the nav badge and the Requests panel), the decision ledger, and the
 * two-step decide (authorize with Touch ID, then decide).
 *
 * The rules live in `team-bridge-approvals-model.ts`; this file only owns the
 * query keys, the account fence and the flow's state.
 */
import { TeamBridgeApprovalsApi } from "@shared/api/local-operator/team-bridge-approvals-api";
import { useObservedRadientAuthority } from "@shared/hooks/radient-account-authority";
import { t } from "@shared/i18n";
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
	type DecidedSnapshot,
	authorizeNoticesSnapshot,
	foreignPromptTraces,
	mapApprovalRefusal,
	rememberDecided,
	resultLine,
	retainDecidedFor,
	runApprovalFlow,
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

/*
 * `panel`: the Requests panel's own observer (QA Q2, round 2). A query whose
 * read failed with no data is always stale, so a mounting observer would
 * refetch it - and a fetch on a no-data query resets it to `pending` with no
 * error, which used to unmount the very slot that mounted the panel: a loop of
 * about two reads a second against the hub. The panel therefore never fetches
 * on mount while the read is in error; its Retry is the only read it starts.
 * The page's observer keeps the ordinary poll, which is how the badge recovers.
 */
export function useApprovalRequests(
	enabled: boolean,
	{ panel = false }: { panel?: boolean } = {},
) {
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
		/* Both switches are needed: TanStack Query v5 fetches a NO-DATA query
		   on mount through `retryOnMount` (`shouldLoadOnMount`), and only a
		   query that HAS data through `refetchOnMount`. */
		...(panel
			? {
					retryOnMount: false,
					refetchOnMount: (query: { state: { status: string } }) =>
						query.state.status !== "error",
				}
			: {}),
		retry: (count, error) => !approvalsUnsupported(error) && count < 1,
	});
}

/**
 * Keeps the in-memory decided-excerpt store tied to the signed-in account
 * (review R2-02): an account switch or a sign-out forgets it. Mounted once,
 * app-wide, beside the authorize notices; it only observes the auth read.
 */
export function useDecidedStoreOwner() {
	const { accountId } = useObservedRadientAuthority();
	useEffect(() => {
		retainDecidedFor(accountId);
	}, [accountId]);
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
	/*
	 * `labels` is each item's sender as its row showed them WHEN THE PERSON
	 * PRESSED, captured at the start: the decide's refetch drops every decided
	 * row from the list, so the results cannot be read off live rows (agent
	 * review R1-02, QA Q1). They stay until Dismiss.
	 */
	| {
			phase: "done";
			results: ApprovalDecideResult[];
			labels: Record<string, string>;
	  }
	| { phase: "refused"; refusal: ApprovalRefusal };

/** What the container knows about a listed request at decide time. */
export type ApprovalRowLookup = (messageId: string) => DecidedSnapshot | null;

/**
 * Authorize, then decide. One flow at a time: a second press while a prompt is
 * up is ignored here, and the daemon would refuse it anyway
 * (`operator_prompt_in_flight`). Nothing retries on its own - a dismissed or
 * expired confirmation is the person's to repeat, so a second Touch ID sheet
 * never appears that they did not ask for (`runApprovalFlow`).
 */
export function useApprovalDecide(lookup: ApprovalRowLookup) {
	const client = useQueryClient();
	const { accountId } = useTeamBridgeAccount();
	const [state, setState] = useState<ApprovalFlowState>({ phase: "idle" });
	const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
	/*
	 * PRESENCE-REQUIRED IS A PROPERTY OF THIS MAC, NOT AN EVENT (design D5). Once
	 * the daemon says batch deciding needs Touch ID it does not have, every
	 * further press is certain to be refused the same way, so Dismiss must not
	 * bring the batch controls back. It holds for the life of the panel; a
	 * remount (the person came back later, perhaps with the key enrolled) asks
	 * again.
	 */
	const [presenceRequired, setPresenceRequired] = useState(false);
	const busy = useRef(false);
	const lookupRef = useRef(lookup);
	lookupRef.current = lookup;

	// Clear the cooldown when it elapses so the actions re-enable, and retire a
	// cooldown banner with it: its countdown has nothing left to say (D4, Q3).
	useEffect(() => {
		if (cooldownUntil === null) return;
		const end = () => {
			setCooldownUntil(null);
			setState((current) =>
				current.phase === "refused" && current.refusal.kind === "cooldown"
					? { phase: "idle" }
					: current,
			);
		};
		const wait = cooldownUntil - Date.now();
		if (wait <= 0) {
			end();
			return;
		}
		const timer = setTimeout(end, wait);
		return () => clearTimeout(timer);
	}, [cooldownUntil]);

	const run = useCallback(
		async (items: ApprovalSelectionItem[]) => {
			if (busy.current || items.length === 0 || !accountId) return;
			busy.current = true;
			// Captured BEFORE anything can refetch the list.
			const snapshots = new Map(
				items.map((item) => [
					item.message_id,
					lookupRef.current(item.message_id),
				]),
			);
			const nameOf = (id: string) => snapshots.get(id)?.sender ?? null;
			setState({ phase: "authorizing", items });
			try {
				const outcome = await runApprovalFlow({
					accountId,
					items,
					authorize: TeamBridgeApprovalsApi.authorize,
					decide: TeamBridgeApprovalsApi.decide,
					onDeciding: () => setState({ phase: "deciding", items }),
				});
				if (outcome.ok) {
					const labels: Record<string, string> = {};
					for (const item of items)
						labels[item.message_id] =
							nameOf(item.message_id) ??
							t("ui.teamBridge.approvals.unknown_sender");
					for (const result of outcome.results) {
						const snap = snapshots.get(result.message_id);
						if (snap && resultLine(result).tone === "done")
							rememberDecided(accountId, result.message_id, snap);
					}
					setState({ phase: "done", results: outcome.results, labels });
					return;
				}
				const refusal = mapApprovalRefusal(
					outcome.error,
					nameOf,
					outcome.stage,
				);
				if (refusal.kind === "cooldown")
					setCooldownUntil(Date.now() + refusal.retryAfterS * 1000);
				if (refusal.kind === "presence_required") setPresenceRequired(true);
				setState({ phase: "refused", refusal });
			} finally {
				busy.current = false;
				void invalidateApprovals(client);
			}
		},
		[accountId, client],
	);

	const reset = useCallback(() => setState({ phase: "idle" }), []);
	return {
		state,
		run,
		reset,
		coolingDown: cooldownUntil !== null,
		cooldownUntil,
		presenceRequired,
	};
}

/** The live Touch ID prompt notices (see `applyAuthorizeFrame`). */
export function useAuthorizeNotices() {
	return useSyncExternalStore(
		subscribeAuthorizeNotices,
		authorizeNoticesSnapshot,
		authorizeNoticesSnapshot,
	);
}

/** Ended prompts this window did not start (UX review U7). */
export function useForeignPromptTraces() {
	return useSyncExternalStore(
		subscribeAuthorizeNotices,
		foreignPromptTraces,
		foreignPromptTraces,
	);
}
