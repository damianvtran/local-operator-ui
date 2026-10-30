import {
	observedRadientAuthority,
	readForRadientAccount,
	useObservedRadientAuthority,
} from "@shared/hooks/radient-account-authority";
import { useRadientUserQuery } from "@shared/hooks/use-radient-user-query";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef } from "react";
import type { AgentMessagesStatus } from "../../../../shared/agent-messages-contract";
import { teamBridgeKeys } from "./team-bridge-keys";

/** Mount the actual shared auth read, then observe its synchronous credential
 * transition fence. Team Bridge status alone cannot establish the live account:
 * it may still say A after the app's actual auth completion has installed B. */
export function useTeamBridgeAccount() {
	useRadientUserQuery();
	return useObservedRadientAuthority();
}

/**
 * THE AUTHORITY-BEARING FIELDS OF A STATUS SNAPSHOT, and nothing else.
 *
 * Three callers ask the same question — "does this status still stand for the
 * authority the work was started under?": the predicate `bridgeOwnerCurrent`
 * (evaluated on its own), the post-read fence in `readForBridgeOwner`, and the
 * banner delivery predicate in `use-team-bridge-notifications.ts` (both
 * compared against a snapshot taken before their await, via
 * `captureBridgeStatusAuthority`). They share this projection so they can never
 * drift into different notions of "same authority": a field added here changes
 * all of them, and a field left out is one none may act on.
 *
 * WHY NOT THE CACHED OBJECT'S IDENTITY — the defect this replaced. The status
 * query refetches on window focus (staleTime 60 s). React Query's structural
 * sharing keeps the old reference only for a DEEP-EQUAL answer, and the
 * runtime's status payload is never deep-equal twice: it carries `checked_at`,
 * `fetched_at`, `from_cache` and the `delivery_hold` count, which move on every
 * check of an unchanged authority. So every refetch that landed during a read
 * broke identity and refused a read that crossed no authority change, and the
 * owner-audit queries (`retry: false`, `gcTime: 0` by design — a private read is
 * not retried over a changed authority) kept one such trip forever as "Audited
 * messages could not be loaded." In All organizations the rail runs one read per
 * organization concurrently, so the window was N times as wide.
 *
 * `read_only` is optional in the contract: absent and false both mean writable,
 * so it is normalized here — a runtime that starts spelling out `false` must
 * not read as an authority change.
 *
 * WHAT IS DELIBERATELY NOT HERE, so a later reader can tell a decision from an
 * oversight. The same status payload carries four fields that look
 * authority-bearing at a glance, and none of them authorizes a private read:
 *
 * - `tenant_id` is the *selected* organization, i.e. the answer's default view.
 *   Every audit read names its own organization in its own request, so this
 *   field moving re-targets a default, not the read already in flight.
 * - `local.enrolled` is this DEVICE's own claim (the account, tenant and
 *   endpoint it has already accepted), so it says whether this machine may act
 *   rather than whose data a read may address; `local.enabled` is the read gate
 *   the projection keeps.
 * - `boundary` is the request's view selector (which read family the caller
 *   asked for), not an endpoint or an account switch.
 * - `surface_state` is a projection of `state` + `localEnabled` + `readOnly`; a
 *   read that gated on it too would fire twice on one change and learn no
 *   authority the three fields do not already carry.
 *
 * WHAT THIS FENCE IS, AND WHAT SITS BESIDE IT. The comparison looks narrower
 * than the object identity it replaced, so its scope is stated rather than
 * implied: it compares two OBSERVATIONS of ONE dimension — the authority in the
 * status row before the await against the authority in that row after it. The
 * CREDENTIAL dimension is fenced separately, by `readForRadientAccount`, whose
 * snapshot is `[epoch, accountId]`: a same-account re-auth that mints a new
 * token mid-read throws "Account authority changed" there. That split is
 * deliberate, and this is NOT a fence by timestamp — reading `checked_at` /
 * `fetched_at` to infer a credential move would let a server- or client-set
 * clock stand in for an authorization decision, and a timestamp is not authority.
 */
type BridgeStatusAuthority = {
	accountId: string | null;
	state: AgentMessagesStatus["state"];
	readOnly: boolean;
	localEnabled: boolean;
};

function bridgeStatusAuthority(
	status: AgentMessagesStatus | undefined,
): BridgeStatusAuthority | null {
	if (!status) return null;
	return {
		accountId: status.account_id,
		state: status.state,
		readOnly: Boolean(status.read_only),
		localEnabled: status.local.enabled,
	};
}

/** A missing snapshot on either side counts as a change: the authority that
 * admitted the read is no longer on record to vouch for it. */
function bridgeStatusAuthorityChanged(
	before: BridgeStatusAuthority | null,
	after: BridgeStatusAuthority | null,
): boolean {
	if (!before || !after) return true;
	return (
		before.accountId !== after.accountId ||
		before.state !== after.state ||
		before.readOnly !== after.readOnly ||
		before.localEnabled !== after.localEnabled
	);
}

/**
 * Snapshot the status authority NOW and return a check that it still holds.
 *
 * The one shape both pre/post fences use (`readForBridgeOwner` and the banner
 * delivery predicate): capture before the await, ask after it. A status row
 * that vanishes, or appears where none was, counts as changed.
 */
export function captureBridgeStatusAuthority(
	client: QueryClient,
	accountId: string | undefined,
): () => boolean {
	const read = () =>
		bridgeStatusAuthority(
			client.getQueryData<AgentMessagesStatus>(
				teamBridgeKeys.statusFor(accountId),
			),
		);
	const before = read();
	return () => !bridgeStatusAuthorityChanged(before, read());
}

export function bridgeOwnerCurrent(
	client: QueryClient,
	accountId: string | undefined,
) {
	const live = observedRadientAuthority(client);
	const status = bridgeStatusAuthority(
		client.getQueryData<AgentMessagesStatus>(
			teamBridgeKeys.statusFor(accountId),
		),
	);
	return Boolean(
		accountId &&
			live.accountId === accountId &&
			status?.accountId === accountId &&
			status.state === "ready" &&
			status.localEnabled &&
			!status.readOnly,
	);
}
export function assertBridgeReadOwner(
	client: QueryClient,
	accountId: string | undefined,
) {
	const status = client.getQueryData<AgentMessagesStatus>(
		teamBridgeKeys.statusFor(accountId),
	);
	if (
		!accountId ||
		observedRadientAuthority(client).accountId !== accountId ||
		status?.account_id !== accountId
	)
		throw new Error("Team Bridge read owner changed");
}

/** Bootstrap the owner-qualified status/identity read from live auth, not from
 * its own stale answer. This is observed-client fencing, NOT atomic hub auth. */
export const readForBridgeAccount = readForRadientAccount;

/** Refuse late results before they can warm any private cache. Resetting caches
 * alone is insufficient: a still-running A request can settle after the reset. */
export async function readForBridgeOwner<T>(
	client: QueryClient,
	accountId: string | undefined,
	read: () => Promise<T>,
): Promise<T> {
	assertBridgeReadOwner(client, accountId);
	const authorityHolds = captureBridgeStatusAuthority(client, accountId);
	const result = await readForBridgeAccount(client, accountId, read);
	assertBridgeReadOwner(client, accountId);
	/* Compare what the snapshot MEANS, not which object it is: a focus refetch
	 * hands over a new object for the same authority (see `bridgeStatusAuthority`). */
	if (!authorityHolds()) throw new Error("Team Bridge read authority changed");
	return result;
}

/** Capture data ownership once; mount lifetime and auth epoch both fence retry
 * and settlement. A→B→A never revives an old closure. The runtime separately
 * binds expected_account_id to the same OAuth access object sent upstream. */
export function useBridgeOwner(accountId?: string) {
	const client = useQueryClient();
	const live = observedRadientAuthority(client);
	const captured = useRef({
		accountId: accountId ?? live.accountId,
		epoch: live.epoch,
	}).current;
	const mounted = useRef(true);
	useLayoutEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const isReadCurrent = () => {
		const current = observedRadientAuthority(client);
		return (
			mounted.current &&
			Boolean(captured.accountId) &&
			current.accountId === captured.accountId &&
			current.epoch === captured.epoch
		);
	};
	const isCurrent = () =>
		isReadCurrent() && bridgeOwnerCurrent(client, captured.accountId);
	const assertCurrent = () => {
		if (!isCurrent()) throw new Error("Team Bridge write authority changed");
	};
	return {
		accountId: captured.accountId,
		isCurrent,
		isReadCurrent,
		assertCurrent,
	};
}
