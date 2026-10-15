import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { retryDesktopQuery } from "./backend-error";
import { desktopResult } from "./desktop-api";
import type { HubLink, HubLinkPolicyPatch, HubLinks } from "./hub-links";
import { guardHubMutation, useHubMutationSafety } from "./hub-mutation-safety";

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
 * What the PATCH returns: the link's id and its new policy snapshot, and NOTHING
 * else. Core's `desktop_hub.py` patch route answers `{link_id, policy}` — a
 * revision-checked write touches policy alone, so it does not re-emit the whole
 * `HubLink`. Reading this as `{link: HubLink}` (the earlier assumption) would
 * leave `link` undefined on a real answer and throw on `link.link_id`.
 */
export type HubPolicyWriteResult = {
	link_id: string;
	policy: { subscribe: boolean; auto_push: boolean; revision: string };
};

/**
 * No optimistic preferences: an ON glyph promises a durable service ack. Use the
 * captured revision for this press and refresh after conflicts/errors too, so an
 * external config edit is shown rather than silently overwritten on retry. The
 * component owning this mutation keeps its error beside the responsible link.
 */
export function useHubLinkPolicy() {
	const client = useQueryClient();
	const safety = useHubMutationSafety();
	const mutation = useMutation({
		mutationFn: ({ link, patch }: HubPolicyWrite) =>
			guardHubMutation(
				() =>
					desktopResult<HubPolicyWriteResult>({
						op: "hub.policy",
						requestId: crypto.randomUUID(),
						linkId: link.link_id,
						expectedPolicyRevision: link.policy.revision,
						...(patch.subscribe !== undefined
							? { subscribe: patch.subscribe }
							: {}),
						...(patch.auto_push !== undefined
							? { autoPush: patch.auto_push }
							: {}),
						...(patch.confirm_public_egress !== undefined
							? { confirmPublicEgress: patch.confirm_public_egress }
							: {}),
					}),
				safety.snapshot,
			),
		onSuccess: ({ link_id, policy }) => {
			/*
			 * PATCH the row's POLICY IN PLACE, never replace the row: only policy
			 * is returned, so a replacement built from the answer would drop every
			 * other field (name, source, directions, eligibility). The new
			 * `policy.revision` is what the next press's `expectedPolicyRevision`
			 * must carry, which is why it is written into the cache here.
			 */
			client.setQueryData<HubLinks>(hubLinksKey, (previous) =>
				previous
					? {
							...previous,
							links: previous.links.map((row) =>
								row.link_id === link_id ? { ...row, policy } : row,
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
	return { ...mutation, ...safety };
}
