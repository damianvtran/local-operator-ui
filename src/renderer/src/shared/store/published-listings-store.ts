/**
 * Published Listings Store
 *
 * Which hub listing each local agent was published as.
 *
 * WHY THIS EXISTS IN THE APP AND NOT IN THE BACKEND. A republish must name the
 * hub listing to update (`PUT /v1/agents/{id}/publish` with `hub_agent_id`), and
 * nothing on this side keeps that link: the local registry has no field for it,
 * and the published document has no field for it either — deliberately, since
 * everything a document carries is public content and a listing id is not. So the
 * link is this app's to remember, and this store is where it is remembered.
 *
 * WHAT IT IS NOT. It is a HINT, never an authority. It is written only from a
 * publication the hub accepted, it is per local agent id, and every use of it is
 * inside a flow whose refusals are already handled: a listing that was delisted
 * elsewhere comes back as `agent_not_found` and one published by another account
 * as `not_owner`, both of which the dialog renders and neither of which this
 * store can prevent. Losing it (a fresh profile, another machine) costs the
 * "Update listing" offer, not the ability to publish — which is why it is not
 * worth a backend field of its own.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** What the app knows about one published listing. */
export type PublishedListingRecord = {
	/** The hub's id for the listing, the only handle a republish can address. */
	hubAgentId: string;
	/** The name the hub holds, which is what a later publication must not re-claim. */
	name: string;
	/** ISO timestamp of the publication this app performed, for a stale-row hint. */
	publishedAt: string;
};

type PublishedListingsState = {
	/** Local agent id to the listing it was last published as. */
	listings: Record<string, PublishedListingRecord>;
	/** Record a publication the hub accepted. */
	remember: (agentId: string, listing: PublishedListingRecord) => void;
	/** Forget one — the listing is gone, or it turned out not to be this app's. */
	forget: (agentId: string) => void;
};

export const usePublishedListingsStore = create<PublishedListingsState>()(
	persist(
		(set) => ({
			listings: {},

			remember: (agentId, listing) => {
				set((state) => ({
					listings: { ...state.listings, [agentId]: listing },
				}));
			},

			forget: (agentId) => {
				set((state) => {
					if (!(agentId in state.listings)) return state;
					const listings = { ...state.listings };
					delete listings[agentId];
					return { listings };
				});
			},
		}),
		{ name: "published-listings-storage" },
	),
);

/**
 * The listing this local agent was published as, if this app published it.
 *
 * A selector rather than a property read so a component re-renders on the entry
 * it uses rather than on every publication anywhere.
 */
export const usePublishedListing = (
	agentId: string | null,
): PublishedListingRecord | null =>
	usePublishedListingsStore((state) =>
		agentId ? (state.listings[agentId] ?? null) : null,
	);
