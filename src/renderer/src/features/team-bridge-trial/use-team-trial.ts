/**
 * The Team Bridge trial's reads and its one write (teams-trial §9 Lane F).
 *
 * ACCOUNT-OWNED KEYS. Every answer here is private to the signed-in Radient
 * account, so each key carries the observed account id and each read runs
 * through `readForRadientAccount` (the fence the memberships read uses): an
 * answer that lands after a sign-in switch is discarded rather than painted
 * under the new account.
 *
 * AFTER A START the page needs three things to become true, in order: the
 * daemon's cached Bridge status dropped (the core proxy does that on a
 * successful start, local-operator PR #3386), the status re-read, so the
 * runtime's status discipline performs the default-on enrolment for the now
 * eligible member (design §9 Lane E, `team_bridge/client.py`), and the
 * memberships read refreshed so the rail names the organization. This hook
 * invalidates the renderer's copies of exactly those reads; it adds no
 * enrolment call of its own.
 */
import { membershipKeys } from "@features/agent-hub/hooks/use-memberships-query";
import {
	type TeamTrialEligibility,
	type TeamTrialStartInput,
	type TeamTrialStatus,
	teamTrialApi,
	trialUnavailable,
} from "@shared/api/local-operator/team-trial-api";
import {
	readForRadientAccount,
	useObservedRadientAuthority,
} from "@shared/hooks/radient-account-authority";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { teamBridgeKeys } from "../team-bridge/team-bridge-keys";

export const teamTrialKeys = {
	all: ["team-trial"] as const,
	eligibility: (accountId?: string) =>
		["team-trial", "eligibility", accountId ?? "unresolved-owner"] as const,
	status: (tenantId: string | null | undefined, accountId?: string) =>
		[
			"team-trial",
			"status",
			tenantId ?? "none",
			accountId ?? "unresolved-owner",
		] as const,
};

/**
 * The eligibility read, only while the page is on its no-organization branch.
 * `retry: false` on purpose: an older backend's 422 and an agent-server
 * without the route (404) are answers, not blips, and retrying them only
 * delays the unchanged page they lead to.
 */
export function useTeamTrialEligibility(enabled: boolean) {
	const client = useQueryClient();
	const { accountId } = useObservedRadientAuthority();
	const query = useQuery<TeamTrialEligibility, Error>({
		queryKey: teamTrialKeys.eligibility(accountId),
		queryFn: () =>
			readForRadientAccount(client, accountId, () =>
				teamTrialApi.eligibility(),
			),
		enabled: enabled && Boolean(accountId),
		staleTime: 60_000,
		retry: false,
	});
	return {
		...query,
		/** Any failure keeps the page as it was; see `trialEmptyView`. */
		unavailable: query.isError,
		olderServer: query.isError && trialUnavailable(query.error),
	};
}

/**
 * The selected organization's trial state, for the paused banner and the
 * "Trial active until" note. Only asked for a single organization the page is
 * showing. An older server (404/422) reads as "no trial fact" (`null`). Any
 * other refusal, such as a 403 `not_a_member` for someone who is no longer in
 * the organization, is a query ERROR; the note hook reads no fact from it
 * either, so the page stays as it was. Since agent-server #296 (X3) the read
 * admits active AND disabled members, so a member the trial end disabled
 * still gets the ended state rather than that 403.
 */
export function useTeamTrialStatus(tenantId: string | null | undefined) {
	const client = useQueryClient();
	const { accountId } = useObservedRadientAuthority();
	return useQuery<TeamTrialStatus | null, Error>({
		queryKey: teamTrialKeys.status(tenantId, accountId),
		queryFn: async () => {
			try {
				return await readForRadientAccount(client, accountId, () =>
					teamTrialApi.status(tenantId as string),
				);
			} catch (error) {
				if (trialUnavailable(error)) return null;
				throw error;
			}
		},
		enabled: Boolean(tenantId) && Boolean(accountId),
		staleTime: 60_000,
		retry: false,
	});
}

export function useStartTeamTrial() {
	const client = useQueryClient();
	const { accountId } = useObservedRadientAuthority();
	return useMutation({
		mutationFn: (input: TeamTrialStartInput) => teamTrialApi.start(input),
		onSuccess: async () => {
			await Promise.all([
				client.invalidateQueries({
					queryKey: teamBridgeKeys.statusFor(accountId),
				}),
				client.invalidateQueries({ queryKey: membershipKeys.all }),
				client.invalidateQueries({ queryKey: teamTrialKeys.all }),
			]);
		},
	});
}
