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
 * Two callers ask the same question — "does this status still stand for the
 * authority the read was admitted under?": the predicate `bridgeOwnerCurrent`
 * (evaluated on its own) and the post-read fence in `readForBridgeOwner`
 * (compared against the snapshot taken before the read). They share this
 * projection so the two can never drift into different notions of "same
 * authority": a field added here changes both, and a field left out is one
 * neither may act on.
 *
 * WHY NOT THE CACHED OBJECT'S IDENTITY — the defect this replaced. The status
 * query refetches on window focus, and every refetch installs a FRESH object
 * even when the authority is unchanged (a session id rotates, the server adds a
 * note). Comparing object identity therefore refused reads that crossed no
 * authority change, and the owner-audit queries (`retry: false`, `gcTime: 0` by
 * design — a private read is not retried over a changed authority) kept one
 * such trip forever as "Audited messages could not be loaded."
 *
 * `read_only` is optional in the contract: absent and false both mean writable,
 * so it is normalized here — a runtime that starts spelling out `false` must
 * not read as an authority change.
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
	const status = bridgeStatusAuthority(
		client.getQueryData<AgentMessagesStatus>(
			teamBridgeKeys.statusFor(accountId),
		),
	);
	const result = await readForBridgeAccount(client, accountId, read);
	assertBridgeReadOwner(client, accountId);
	/* Compare what the snapshot MEANS, not which object it is: a focus refetch
	 * hands over a new object for the same authority (see `bridgeStatusAuthority`). */
	if (
		bridgeStatusAuthorityChanged(
			status,
			bridgeStatusAuthority(
				client.getQueryData<AgentMessagesStatus>(
					teamBridgeKeys.statusFor(accountId),
				),
			),
		)
	)
		throw new Error("Team Bridge read authority changed");
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
