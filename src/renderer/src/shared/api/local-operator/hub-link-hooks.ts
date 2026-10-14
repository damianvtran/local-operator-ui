import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { retryDesktopQuery } from "./backend-error";
import { desktopResult } from "./desktop-api";
import type { HubLink, HubLinkPolicyPatch, HubLinks } from "./hub-links";

export const hubLinksKey = ["desktop", "hub-links"] as const;

/**
 * A local inventory read, gated by the caller's negotiated hub_links:1. A legacy
 * backend continues to use hub.updates; no feature is inferred from a 404 or an
 * empty list. Refresh retains confirmed rows while a window is visible.
 */
export function useHubLinks(enabled: boolean) {
	return useQuery({
		queryKey: hubLinksKey,
		enabled,
		queryFn: async () => {
			const inventory = await desktopResult<HubLinks>({ op: "hub.links" });
			// Missing diagnostics cannot be treated as an empty healthy inventory:
			// legacy tags may lack a verified API origin and are read-only until
			// explicitly resolved. The capability advertises this complete shape.
			if (
				!Array.isArray(inventory?.links) ||
				!Array.isArray(inventory.unresolved)
			)
				throw new Error("hub-links-inventory-invalid");
			return inventory;
		},
		staleTime: 30_000,
		refetchInterval: 60_000,
		refetchIntervalInBackground: false,
		retry: retryDesktopQuery,
	});
}

export type HubPolicyWrite = {
	link: HubLink;
	patch: HubLinkPolicyPatch;
};

/**
 * No optimistic preferences: an ON glyph promises a durable service ack. Use the
 * captured revision for this press and refresh after conflicts/errors too, so an
 * external config edit is shown rather than silently overwritten on retry. The
 * component owning this mutation keeps its error beside the responsible link.
 */
export function useHubLinkPolicy() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: ({ link, patch }: HubPolicyWrite) =>
			desktopResult<{ link: HubLink }>({
				op: "hub.policy",
				requestId: crypto.randomUUID(),
				linkId: link.link_id,
				expectedPolicyRevision: link.policy.revision,
				...(patch.subscribe !== undefined
					? { subscribe: patch.subscribe }
					: {}),
				...(patch.auto_push !== undefined ? { autoPush: patch.auto_push } : {}),
				...(patch.confirm_public_egress !== undefined
					? { confirmPublicEgress: patch.confirm_public_egress }
					: {}),
			}),
		onSuccess: ({ link }) => {
			client.setQueryData<HubLinks>(hubLinksKey, (previous) =>
				previous
					? {
							...previous,
							links: previous.links.map((row) =>
								row.link_id === link.link_id ? link : row,
							),
						}
					: previous,
			);
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: hubLinksKey });
			void client.invalidateQueries({ queryKey: ["desktop", "hub-updates"] });
		},
	});
}
