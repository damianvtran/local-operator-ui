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
type Authority = {
	epoch: number;
	pending: boolean;
	accountId?: string;
	/** A deliberate sign-out is a KNOWN absence, not an unresolved read. */
	signedOut?: boolean;
};
const authorities = new WeakMap<QueryClient, Authority>();
const subscribers = new WeakMap<QueryClient, Set<() => void>>();

/** Notification retention distinguishes unresolved credentials from sign-out;
 * neither state admits a new banner, but only settled sign-out withdraws one. */
export function radientAuthorityPending(client: QueryClient): boolean {
	const authority = authorities.get(client);
	if (!authority)
		return client.getQueryState(radientUserKeys.user())?.status !== "success";
	// A deliberate sign-out is settled absence: the account is gone on purpose,
	// so a cached result from the departing account must not read as "resolving"
	// and must not hold that account's banners on screen.
	if (authority.signedOut) return false;
	const committedAccount = client.getQueryData<UserInfoResult | null>(
		radientUserKeys.user(),
	)?.account?.id;
	// Settlement announces before QueryClient commits its result. That gap is
	// still unresolved, not a sign-out that should withdraw retained banners.
	return authority.pending || authority.accountId !== committedAccount;
}

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

/** A DELIBERATE sign-out, announced as already settled.
 *
 * A credential refresh must hold banners and clicks (the person is usually the
 * same account), which is why `beginRadientAuthorityTransition` publishes
 * pending. A press of Sign out is the opposite: identity is KNOWN gone, so
 * holding the departing account's previews until a follow-up read answers - and
 * longer still if that read fails - is retention nobody asked for. Main sees a
 * settled absence and withdraws immediately. */
export function beginRadientAuthoritySignOut(client: QueryClient): void {
	authorities.set(client, {
		epoch: radientAuthorityEpoch(client) + 1,
		pending: false,
		signedOut: true,
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
	authorities.set(client, {
		epoch,
		pending: false,
		accountId,
		// Settling to "no account" after a sign-out stays a known absence; a
		// restored account ends it.
		signedOut:
			accountId === undefined ? authorities.get(client)?.signedOut : false,
	});
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
			authority?.signedOut ||
			authority?.pending ||
			(authority && authority.accountId !== accountId)
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
