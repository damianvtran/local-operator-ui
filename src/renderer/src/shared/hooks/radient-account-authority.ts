import type { UserInfoResult } from "@shared/api/radient/types";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

/** The account read stays one shared query; private consumers additionally need
 * its credential-write epoch. Invalidating alone retains A's data while B's
 * credential is already installed. This journal carries no token or user body. */
export const radientUserKeys = {
	all: ["radient-user"] as const,
	user: () => ["radient-user", "user"] as const,
};
type Authority = { epoch: number; pending: boolean; accountId?: string };
const authorities = new WeakMap<QueryClient, Authority>();
const subscribers = new WeakMap<QueryClient, Set<() => void>>();

export function radientAuthorityEpoch(client: QueryClient): number {
	return authorities.get(client)?.epoch ?? 0;
}
function announce(client: QueryClient) {
	for (const listener of subscribers.get(client) ?? []) listener();
}

/** Run synchronously BEFORE cancelling/invalidation at actual auth completion.
 * Late private reads/writes compare this epoch even if A later signs in again. */
export function beginRadientAuthorityTransition(client: QueryClient): void {
	authorities.set(client, {
		epoch: radientAuthorityEpoch(client) + 1,
		pending: true,
	});
	announce(client);
}

/** Only the real account query may finish a commissioned credential transition.
 * A cancelled old query cannot restore its former owner after a newer write. */
export function settleRadientAuthority(
	client: QueryClient,
	epoch: number,
	accountId?: string,
): void {
	if (epoch !== radientAuthorityEpoch(client)) return;
	authorities.set(client, { epoch, pending: false, accountId });
	announce(client);
}

export function observedRadientAuthority(client: QueryClient): {
	epoch: number;
	accountId?: string;
} {
	const authority = authorities.get(client);
	const accountId = client.getQueryData<UserInfoResult | null>(
		radientUserKeys.user(),
	)?.account?.id;
	return {
		epoch: authority?.epoch ?? 0,
		// Settlement precedes QueryClient's result commit. Never use A's retained
		// query value during that gap, nor invent an account from a Team Bridge read.
		accountId:
			authority?.pending || (authority && authority.accountId !== accountId)
				? undefined
				: accountId,
	};
}

export function radientAuthoritySnapshot(client: QueryClient): string {
	const { epoch, accountId } = observedRadientAuthority(client);
	return JSON.stringify([epoch, accountId ?? null]);
}
export function subscribeRadientAuthority(
	client: QueryClient,
	listener: () => void,
): () => void {
	let listeners = subscribers.get(client);
	if (!listeners) {
		listeners = new Set();
		subscribers.set(client, listeners);
	}
	listeners.add(listener);
	const unsubscribe = client.getQueryCache().subscribe((event) => {
		if (
			(event.type === "updated" || event.type === "removed") &&
			event.query.queryKey.length === 2 &&
			event.query.queryKey[0] === "radient-user" &&
			event.query.queryKey[1] === "user"
		)
			listener();
	});
	const registered = listeners;
	return () => {
		registered.delete(listener);
		unsubscribe();
	};
}

/** Consumers mount the real auth query themselves; this hook only observes it. */
export function useObservedRadientAuthority() {
	const client = useQueryClient();
	const subscribe = useCallback(
		(listener: () => void) => subscribeRadientAuthority(client, listener),
		[client],
	);
	const snapshot = useCallback(
		() => radientAuthoritySnapshot(client),
		[client],
	);
	const token = useSyncExternalStore(subscribe, snapshot, snapshot);
	return { ...observedRadientAuthority(client), token };
}

/** The read cannot outlive the credential epoch that commissioned it. This is
 * client-observed admission, not a claim that the hub bound the read atomically. */
export async function readForRadientAccount<T>(
	client: QueryClient,
	accountId: string | undefined,
	read: () => Promise<T>,
): Promise<T> {
	if (!accountId || observedRadientAuthority(client).accountId !== accountId)
		throw new Error("Account authority unresolved");
	const token = radientAuthoritySnapshot(client);
	const result = await read();
	if (
		radientAuthoritySnapshot(client) !== token ||
		observedRadientAuthority(client).accountId !== accountId
	)
		throw new Error("Account authority changed");
	return result;
}
