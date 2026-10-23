import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef } from "react";
import type { AgentMessagesStatus } from "../../../../shared/agent-messages-contract";
import { teamBridgeKeys } from "./team-bridge-keys";

/** Capture DATA ownership once. Never derive a retry's owner from today's status.
 * This renderer fence stops stale continuations; the runtime must separately bind
 * expected_account_id to the very OAuth access object sent upstream. */
export function bridgeOwnerCurrent(
	client: QueryClient,
	accountId: string | undefined,
) {
	const status = client.getQueryData<AgentMessagesStatus>(
		teamBridgeKeys.status,
	);
	return Boolean(
		accountId &&
			status?.account_id === accountId &&
			status.state === "ready" &&
			status.local.enabled &&
			!status.read_only,
	);
}

/** Read-only access is legitimate; account binding is independent of write permission. */
export function assertBridgeReadOwner(
	client: QueryClient,
	accountId: string | undefined,
) {
	const status = client.getQueryData<AgentMessagesStatus>(
		teamBridgeKeys.status,
	);
	if (!accountId || status?.account_id !== accountId)
		throw new Error("Team Bridge read owner changed");
}

/** A delayed answer is admitted only to the owner snapshot that started it.
 * Checking only at render time would warm A's cache with a read settled after
 * B took over; A returning later could then see that incorrectly attributed data. */
export async function readForBridgeOwner<T>(
	client: QueryClient,
	accountId: string | undefined,
	read: () => Promise<T>,
): Promise<T> {
	assertBridgeReadOwner(client, accountId);
	const authority = client.getQueryData(teamBridgeKeys.status);
	const result = await read();
	assertBridgeReadOwner(client, accountId);
	if (client.getQueryData(teamBridgeKeys.status) !== authority)
		throw new Error("Team Bridge read authority changed");
	return result;
}

export function assertBridgeOwner(
	client: QueryClient,
	accountId: string | undefined,
) {
	if (!bridgeOwnerCurrent(client, accountId))
		throw new Error("Team Bridge write authority changed");
}

/** A mount lifetime is also a fence: A→B→A must not revive A's old callbacks. */
export function useBridgeOwner(accountId?: string) {
	const client = useQueryClient();
	const status = client.getQueryData<AgentMessagesStatus>(
		teamBridgeKeys.status,
	);
	const captured = useRef({
		accountId: accountId ?? status?.account_id ?? undefined,
		tenantId: status?.tenant_id,
	}).current;
	const mounted = useRef(true);
	useLayoutEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const isReadCurrent = () => {
		const live = client.getQueryData<AgentMessagesStatus>(
			teamBridgeKeys.status,
		);
		return (
			mounted.current &&
			Boolean(captured.accountId) &&
			live?.account_id === captured.accountId &&
			live?.tenant_id === captured.tenantId
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
