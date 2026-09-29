/**
 * The caller's own organization memberships — the org selector's one source.
 *
 * `memberships.list` (design §4.1) answers the account's OWN rows, each with its
 * plan summary, so the hub can tell an org it may use from one whose membership
 * is pending or whose plan lapsed WITHOUT a second call per org. That is the
 * whole reason the list carries `plan` at all: the alternative — one
 * `GET /v1/tenants/:id/plan` per org — would put the selector's first paint
 * behind N+1 round trips to answer a question this route already answered.
 *
 * ## Why the read is authenticated-only, and why that is not a silent failure
 *
 * There is no membership without a signed-in account: a signed-out viewer has
 * none by construction, so the query is DISABLED rather than issued, and the
 * selector renders the public hub alone. That is the honest reading — the org
 * scope is a scope a viewer cannot have — and it is not the same state as a read
 * that failed, which is why `isError` is reported rather than folded into an
 * empty list.
 *
 * ## A failure here degrades to PUBLIC, never to a wrong org
 *
 * A failed read leaves `memberships` empty, so the selector offers the public hub
 * and the publish picker offers no org target. The publish picker's copy says
 * when that is what happened, because "no organizations" and "we could not read
 * your organizations" are different facts to a user about to publish.
 */

import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { listMemberships } from "@shared/api/radient/agents-api";
import type {
	MembershipSummary,
	MembershipsResult,
} from "@shared/api/radient/types";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useQuery } from "@tanstack/react-query";

/**
 * One key, no parameters: the rows are the account's own and the request takes
 * nothing. Anything that wants to reach this cache invalidates the prefix.
 */
export const membershipKeys = {
	all: ["memberships"] as const,
};

export const useMembershipsQuery = ({
	enabled = true,
}: { enabled?: boolean } = {}) => {
	const { isAuthenticated } = useRadientAuth();

	const query = useQuery<MembershipsResult, Error>({
		queryKey: membershipKeys.all,
		queryFn: async () => {
			const response = await listMemberships();
			// `?? {memberships: []}` rather than trusting the envelope: an empty
			// result and an absent one are the same answer here (this account holds
			// no memberships), and a `result` that came back null would otherwise
			// reach the selector as `undefined` and crash the read.
			return response.result ?? { memberships: [] };
		},
		// Signed-out is not a failure and must not be a request: `memberships.list`
		// spends the stored bearer, which a signed-out viewer does not have.
		enabled: enabled && isAuthenticated,
		// The same five-minute courtesy the hub's own list uses, and the same
		// deliberately-off focus refetch: a membership read that refired on every
		// window focus would re-run the whole org surface's reads.
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		refetchOnWindowFocus: false,
		// The house policy for this transport: one more attempt for a server that
		// answered, none for one that never answered.
		retry: retryDesktopQuery,
	});

	return {
		...query,
		memberships: (query.data?.memberships ?? []) as MembershipSummary[],
	};
};
