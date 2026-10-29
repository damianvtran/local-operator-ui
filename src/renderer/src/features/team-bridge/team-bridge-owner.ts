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

export function bridgeOwnerCurrent(
	client: QueryClient,
	accountId: string | undefined,
) {
	const live = observedRadientAuthority(client);
	const status = client.getQueryData<AgentMessagesStatus>(
		teamBridgeKeys.statusFor(accountId),
	);
	return Boolean(
		accountId &&
			live.accountId === accountId &&
			status?.account_id === accountId &&
			status.state === "ready" &&
			status.local.enabled &&
			!status.read_only,
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
	const status = client.getQueryData(teamBridgeKeys.statusFor(accountId));
	const result = await readForBridgeAccount(client, accountId, read);
	assertBridgeReadOwner(client, accountId);
	if (client.getQueryData(teamBridgeKeys.statusFor(accountId)) !== status)
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
