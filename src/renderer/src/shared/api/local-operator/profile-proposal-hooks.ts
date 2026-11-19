/**
 * The Agents proposal read/write hooks. One list cache drives the nav badge,
 * tree-row dots and detail panel; the detail read is only mounted for a card
 * the person is viewing. The list is a cheap local store read and polls every
 * 15 s while visible, so a proposal filed by a conversation reaches Agents
 * without the person having to visit/reload the page.
 *
 * `enabled` is the caller's `ready && profile_proposals` capability test. No
 * call may reach an older backend, where these routes do not exist.
 *
 * Mutations never auto-retry: a request has its own idempotency id, but a
 * failure can mean "applied and answer lost". Instead the lists and detail are
 * re-read on settle, and the panel leaves the answer sentence next to the
 * control. Accept also invalidates the profile/team lists AND detail keys so
 * the editor beneath the panel immediately shows what was written (the same
 * cache keys `profile-hooks.ts` / the hub actions invalidate).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { retryDesktopQuery } from "./backend-error";
import { desktopResult } from "./desktop-api";
import {
	PROFILE_PROPOSAL_POLL_MS,
	profileProposalAcceptSchema,
	profileProposalDetailSchema,
	profileProposalListSchema,
	profileProposalRejectSchema,
} from "./profile-proposals";

export const profileProposalKeys = {
	all: ["desktop", "profile-proposals"] as const,
	list: ["desktop", "profile-proposals", "list"] as const,
	detail: (id: string) =>
		["desktop", "profile-proposals", "detail", id] as const,
};

export function useProfileProposals(enabled: boolean) {
	return useQuery({
		queryKey: profileProposalKeys.list,
		enabled,
		queryFn: async () =>
			profileProposalListSchema.parse(
				await desktopResult<unknown>({
					op: "profileProposals.list",
					state: "pending",
				}),
			),
		staleTime: 10_000,
		retry: retryDesktopQuery,
		refetchInterval: enabled ? PROFILE_PROPOSAL_POLL_MS : false,
		refetchIntervalInBackground: false,
	});
}

/**
 * The card's full diff, not the badge's summary. `enabled` is explicit rather
 * than inferred from `id`: a stale deep link against an old backend must not
 * send a read the old backend cannot serve.
 */
export function useProfileProposal(id: string, enabled = true) {
	return useQuery({
		queryKey: profileProposalKeys.detail(id),
		enabled: enabled && Boolean(id),
		queryFn: async () =>
			profileProposalDetailSchema.parse(
				await desktopResult<unknown>({
					op: "profileProposals.get",
					proposalId: id,
				}),
			),
		staleTime: 10_000,
		retry: retryDesktopQuery,
	});
}

type AcceptInput = {
	id: string;
	after?: Record<string, unknown>;
};

export function useAcceptProposal() {
	const client = useQueryClient();
	return useMutation({
		retry: false,
		mutationFn: async ({ id, after }: AcceptInput) =>
			profileProposalAcceptSchema.parse(
				await desktopResult<unknown>({
					op: "profileProposals.accept",
					proposalId: id,
					requestId: crypto.randomUUID(),
					...(after ? { after } : {}),
				}),
			),
		onSuccess: (answer) => {
			client.setQueryData(
				profileProposalKeys.detail(answer.proposal.id),
				answer.proposal,
			);
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: profileProposalKeys.all });
			for (const key of ["profiles", "teams", "profile", "team"])
				void client.invalidateQueries({ queryKey: ["desktop", key] });
		},
	});
}

export function useRejectProposal() {
	const client = useQueryClient();
	return useMutation({
		retry: false,
		mutationFn: async ({ id, note }: { id: string; note?: string }) =>
			profileProposalRejectSchema.parse(
				await desktopResult<unknown>({
					op: "profileProposals.reject",
					proposalId: id,
					requestId: crypto.randomUUID(),
					...(note ? { note } : {}),
				}),
			),
		onSuccess: (answer) => {
			client.setQueryData(
				profileProposalKeys.detail(answer.proposal.id),
				answer.proposal,
			);
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: profileProposalKeys.all });
		},
	});
}
