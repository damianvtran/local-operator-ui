import { useMutation, useQueryClient } from "@tanstack/react-query";
import { desktopResult } from "./desktop-api";
import { useHubActionStore } from "./hub-action-store";
import { hubLinksKey } from "./hub-link-hooks";
import type { HubLinkDirection, HubLinkKind, HubLinks } from "./hub-links";
import type { HubMergeReport, HubUpdates } from "./hub-updates";

/** Core-owned wrapper binds the exact reviewed server projection, not raw pins. */
export type HubPushPreview = {
	preview_receipt: string;
	link_id: string;
	direction: "push";
	hub_source: string;
	visibility: "public" | "org";
	tenant_id: string | null;
	local_fingerprint: string;
	expected_policy_revision: string;
	expected_remote_revision: string;
	proposal_fingerprint: string;
	expires_at: string;
	proposal: { kind: HubLinkKind; fields: Record<string, unknown> };
	warnings: string[];
	can_confirm: boolean;
	reason: string | null;
};
export type HubPullPreview = Omit<
	HubPushPreview,
	"direction" | "expected_remote_revision"
> & {
	direction: "pull";
	expected_remote_revision: string | null;
	remote_fingerprint: string;
	choices: {
		prefer: "local" | "remote" | null;
		acknowledge_unknown_baseline: boolean;
		replace: "local" | "remote" | null;
		confirm_replace: boolean;
	};
};
export type HubDirectionalReport = Omit<HubMergeReport, "kind"> & {
	kind: HubLinkKind;
	link_id: string;
	direction: HubLinkDirection;
	operation_id: string | null;
	remote_revision: string | null;
	model_used: string | null;
};
export type HubLinkActionResponse = {
	reports: HubDirectionalReport[];
	status: HubUpdates;
	links: HubLinks;
	preview?: HubPullPreview | HubPushPreview | null;
};
export type HubLinkAction =
	| { action: "check"; linkId: string }
	| {
			action: "apply";
			linkId: string;
			preview?: boolean;
			prefer?: "local" | "remote";
			acknowledgeUnknownBaseline?: boolean;
			previewReceipt?: string;
			confirmApply?: true;
	  }
	| { action: "retry"; linkId: string; direction: HubLinkDirection }
	| { action: "preview"; linkId: string }
	| { action: "confirm"; linkId: string; previewReceipt: string };

/**
 * Every intentional press gets a receipt ID; transport replay keeps that same
 * request. Confirmation cannot silently ask for a new proposal and publish it:
 * it sends ONLY the immutable receipt the user just viewed and acknowledged.
 */
export function useHubLinkActions(linkId: string) {
	const client = useQueryClient();
	const key = `link:${linkId}`;
	const sharedPending = useHubActionStore((state) => state.pending.has(key));
	const mutation = useMutation({
		onMutate: (input: HubLinkAction) => {
			const store = useHubActionStore.getState();
			if (input.linkId !== linkId || store.pending.has(key))
				throw new Error("hub-action-busy");
			// Sidebar/detail are one pending operation, not two independently busy
			// hooks. This is UI serialization only; core still owns the writer lease.
			store.begin(key);
			return key;
		},
		mutationFn: (input: HubLinkAction) => {
			const requestId = crypto.randomUUID();
			switch (input.action) {
				case "check":
					return desktopResult<HubLinkActionResponse>({
						op: "hub.check",
						requestId,
						linkId: input.linkId,
					});
				case "apply":
					return desktopResult<HubLinkActionResponse>({
						op: "hub.apply",
						requestId,
						linkId: input.linkId,
						direction: "pull",
						...(input.preview ? { dryRun: true } : {}),
						...(input.prefer ? { prefer: input.prefer } : {}),
						...(input.acknowledgeUnknownBaseline
							? { acknowledgeUnknownBaseline: true }
							: {}),
						...(input.previewReceipt
							? { previewReceipt: input.previewReceipt }
							: {}),
						...(input.confirmApply ? { confirmApply: true } : {}),
					});
				case "retry":
					return desktopResult<HubLinkActionResponse>({
						op: "hub.retry",
						requestId,
						linkId: input.linkId,
						direction: input.direction,
					});
				case "preview":
					return desktopResult<HubLinkActionResponse>({
						op: "hub.push",
						requestId,
						linkId: input.linkId,
						direction: "push",
						dryRun: true,
					});
				case "confirm":
					return desktopResult<HubLinkActionResponse>({
						op: "hub.push",
						requestId,
						linkId: input.linkId,
						direction: "push",
						dryRun: false,
						previewReceipt: input.previewReceipt,
						confirmPublish: true,
					});
			}
		},
		onSuccess: (response) => {
			client.setQueryData(hubLinksKey, response.links);
			client.setQueryData(["desktop", "hub-updates"], response.status);
			if (response.reports.some((report) => report.applied)) {
				for (const key of ["profiles", "teams", "skills"])
					void client.invalidateQueries({ queryKey: ["desktop", key] });
			}
		},
		onSettled: (_data, _error, _input, pendingKey) => {
			if (pendingKey) useHubActionStore.getState().end(pendingKey);
			void client.invalidateQueries({ queryKey: hubLinksKey });
		},
	});
	return { ...mutation, isPending: mutation.isPending || sharedPending };
}
