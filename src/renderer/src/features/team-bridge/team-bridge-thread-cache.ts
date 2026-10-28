import {
	observedRadientAuthority,
	readForRadientAccount,
	subscribeRadientAuthority,
} from "@shared/hooks/radient-account-authority";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import type { TeamBridgeThreadPage } from "../../../../shared/team-bridge-contract";
import { teamBridgeKeys } from "./team-bridge-keys";
import { type ThreadTarget, loadThreadPage } from "./team-bridge-thread-read";

/**
 * The thread cache's isolation: WHO a thread page belongs to, and when it stops
 * belonging to anyone.
 *
 * WHY THIS MODULE EXISTS. The thread surface was held closed
 * (`TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD`) because its read, cache and
 * retry paths carried cross-account defects inherited from #1304: the pane
 * cached thread pages under tenant/conversation/root alone, read without any
 * owner fence, and its polling and retries kept running across a sign-in. #1360
 * fenced the timeline at auth transitions and explicitly left the dormant
 * thread paths out. This is that missing half, in three layers:
 *
 * 1. KEY. A thread page is keyed by the signed-in account AND the credential
 *    epoch that commissioned it (`teamBridgeKeys.replies`). B never reads A's
 *    key, and A's second session (A -> B -> A) never reads its first's.
 * 2. READ FENCE. `ownedThreadPage` refuses to start unless the captured owner is
 *    the live one, and refuses to SETTLE if the epoch moved while it was in
 *    flight, so a delayed answer or an automatic retry cannot write a frame.
 *    The runtime adds the atomic half: the read carries `expected_account_id`
 *    and is refused (409 `account_mismatch`) if the bearer it would dispatch
 *    with belongs to someone else.
 * 3. CLEAR. `useTeamBridgeThreadCacheFence` cancels and removes every thread
 *    page not owned by the current epoch the moment the credential journal
 *    announces a transition, so no prior account's thread bodies stay in memory
 *    for a later observer, devtools or a gc-time window.
 */

/** The owner a thread read is commissioned for: captured once, never re-read. */
export type ThreadOwner = { accountId: string; epoch: number };

/** The live owner, or null while auth is unresolved/signed out (no thread read). */
export function currentThreadOwner(client: QueryClient): ThreadOwner | null {
	const { accountId, epoch } = observedRadientAuthority(client);
	return accountId ? { accountId, epoch } : null;
}

/**
 * Read one thread page as `owner`, or refuse.
 *
 * Refuses BEFORE the request if `owner` is no longer the live account/epoch
 * (a retry scheduled under A that fires after the switch sends nothing), and
 * refuses AFTER it if the epoch moved while it was in flight (the answer is
 * dropped, never cached). `readForRadientAccount` compares the account and the
 * epoch-bearing authority snapshot on both sides.
 */
export async function ownedThreadPage(
	client: QueryClient,
	owner: ThreadOwner,
	target: ThreadTarget,
	afterSeq?: number,
): Promise<TeamBridgeThreadPage> {
	if (observedRadientAuthority(client).epoch !== owner.epoch)
		throw new Error("Team Bridge thread owner changed");
	return readForRadientAccount(client, owner.accountId, () =>
		loadThreadPage(target, owner.accountId, afterSeq),
	);
}

/**
 * Drop every cached thread page that the CURRENT owner does not own.
 *
 * Cancel first, then remove: cancelling stops an in-flight read (and its retry
 * chain) from settling into a query that is about to be removed, and removing
 * takes the bodies out of the cache rather than merely marking them stale. A
 * page owned by the current account and epoch is kept, so this is safe to run
 * on every authority announcement, including the settle that confirms the
 * transition's new owner.
 */
export function clearForeignThreadPages(client: QueryClient): void {
	const owner = currentThreadOwner(client);
	const foreign = (queryKey: readonly unknown[]) => {
		// [..."team-bridge", "replies", tenant, conversation, root, "account", id, "epoch", n]
		const accountId = queryKey[6];
		const epoch = queryKey[8];
		return !owner || accountId !== owner.accountId || epoch !== owner.epoch;
	};
	const filters = {
		queryKey: teamBridgeKeys.repliesPrefix,
		predicate: (query: { queryKey: readonly unknown[] }) =>
			foreign(query.queryKey),
	};
	void client.cancelQueries(filters);
	client.removeQueries(filters);
}

/**
 * Mount ONCE, in the app shell (`useTeamBridgeNotifications`), so the clear
 * runs whether or not the Team Bridge page is open: a thread page cached under
 * A outlives the page's own unmount by the query gc window.
 *
 * A LAYOUT effect subscribing to the credential journal directly, the same way
 * the shell publishes authority to main: `beginRadientAuthorityTransition`
 * announces synchronously, before React re-renders, so the clear lands before
 * any component can render under the new owner.
 */
export function useTeamBridgeThreadCacheFence(): void {
	const client = useQueryClient();
	useLayoutEffect(() => {
		const clear = () => clearForeignThreadPages(client);
		const unsubscribe = subscribeRadientAuthority(client, clear);
		clear();
		return unsubscribe;
	}, [client]);
}
