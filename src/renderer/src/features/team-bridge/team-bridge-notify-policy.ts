import type { QueryClient } from "@tanstack/react-query";
import type { TeamBridgeNotifyOwner } from "../../../../shared/team-bridge-notify";
import { teamBridgeKeys } from "./team-bridge-keys";

/** An optimistic mute is not a confirmed decision to consume a notification.
 * Observe the actual mutation lifecycle: error restores the cache before it
 * settles, and success invalidates/refetches it before it settles. No policy
 * copy, message cache, or second HTTP polling loop belongs to this boundary. */
export function teamBridgeNotifyPolicyPending(
	client: QueryClient,
	owner: TeamBridgeNotifyOwner,
	conversationId: string,
	tenantId: string,
): boolean {
	return client
		.getMutationCache()
		.findAll({
			mutationKey: teamBridgeKeys.notifyMutation(owner.accountId, owner.epoch),
			exact: true,
			status: "pending",
		})
		.some((mutation) => {
			const variables = mutation.state.variables as
				| {
						conversationId?: string;
						tenantId?: string;
				  }
				| undefined;
			return (
				variables?.conversationId === conversationId &&
				(variables.tenantId === undefined || variables.tenantId === tenantId)
			);
		});
}

/** Wake the already-planned delivery, not the planner: its seq was consumed
 * exactly once. Abort releases the listener on auth changes/disable/unmount;
 * no candidate or private preview is written to a retry cache. */
export function waitForTeamBridgeNotifyPolicy(
	client: QueryClient,
	owner: TeamBridgeNotifyOwner,
	conversationId: string,
	tenantId: string,
	signal: AbortSignal,
): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			unsubscribe();
			signal.removeEventListener("abort", done);
			resolve();
		};
		const check = () => {
			if (
				signal.aborted ||
				!teamBridgeNotifyPolicyPending(client, owner, conversationId, tenantId)
			)
				done();
		};
		const unsubscribe = client.getMutationCache().subscribe(check);
		signal.addEventListener("abort", done, { once: true });
		check();
	});
}
