import {
	type CommunityAccess,
	communityAccessFrom,
	communityUnreadTotal,
} from "@features/community/community-model";
import {
	useCommunityChannels,
	useCommunityList,
} from "@features/community/use-community";
import {
	type CommunityRecord,
	communityFailure,
} from "@shared/api/local-operator/community-api";
import { FeatureFlagContext } from "@shared/providers/feature-flags/feature-flag-context";
import { useContext, useMemo } from "react";
import {
	type TeamBridgeCommunity,
	asTeamBridgeCommunityId,
} from "./team-bridge-model";

/**
 * The PostHog flag that turns the community surfaces on (RFC v2.4: everything
 * ships dark until the staff pilot). Off - the default for every launch that
 * does not report, and for anyone PostHog does not target - hides the
 * switcher's Communities group entirely, so private Team Bridge is unchanged.
 */
export const TEAM_BRIDGE_COMMUNITY_FLAG = "team-bridge-community";

/** No communities: one stable array, so memoised consumers do not churn. */
const NO_COMMUNITIES: readonly TeamBridgeCommunity[] = Object.freeze([]);

/** No featured communities: stable, like `NO_COMMUNITIES`. */
const NO_RECORDS: readonly CommunityRecord[] = Object.freeze([]);

/**
 * The reader's JOINED communities, the featured joinable ones, and whether the
 * community feature is on.
 *
 * THE LIST READ. Amendment A puts communities on their own server; the desktop
 * reaches it through the daemon's `community.communities.list` op
 * (`features/community/use-community.ts`). The read runs ONLY with the flag on,
 * so a launch with the flag off sends nothing and the switcher is the
 * pre-Amendment one. A failed read (a daemon without the routes answers 404
 * `community_disabled`) leaves the joined list empty and `access`
 * `unavailable`, never an error on the private page.
 *
 * UNREAD. Each community row carries its own count (D21). The member door has
 * no per-community unread aggregate, so the count is the sum of the channel
 * directory's per-channel `unread` - read for the FIRST joined community only,
 * through the same cache entry the community home reads (one request, not two).
 * Further joined communities show 0 until an aggregate exists; there is one
 * community at launch.
 *
 * Communities come ONLY from here, never from the private bridge's tenant list
 * or memberships, which is the other half of keeping them out of the merged
 * "All organizations" view.
 *
 * The provider tolerates a tree without a `FeatureFlagProvider` (isolated
 * component tests and stories that never wrap one) by reading the flag as off:
 * a missing provider must never take the private Team Bridge page down for a
 * dark feature. It reads the context directly from `feature-flag-context`
 * rather than through `useFeatureFlags` (which throws without a provider) and
 * never imports the provider module: that module loads `posthog-js`, which
 * reads `location` at import time and so crashed every node/jsdom test that
 * bundles the Team Bridge page (19 files on this PR's first head).
 */
export function useTeamBridgeCommunities(): {
	communities: readonly TeamBridgeCommunity[];
	enabled: boolean;
	/** Joinable communities the hub features (the D1 card's community). */
	featured: readonly CommunityRecord[];
	/** `community_access` for the featured community (RFC §5.1). */
	access: CommunityAccess;
	loading: boolean;
	/** Re-read the list (the D1 card's Retry after a failed read). */
	retry: () => void;
} {
	const flags = useContext(FeatureFlagContext);
	const enabled = flags?.isEnabled(TEAM_BRIDGE_COMMUNITY_FLAG) ?? false;
	const list = useCommunityList(enabled);
	const joined = enabled ? (list.data?.joined ?? NO_RECORDS) : NO_RECORDS;
	const featured = enabled ? (list.data?.featured ?? NO_RECORDS) : NO_RECORDS;
	const firstJoined = joined[0]?.id ?? null;
	const channels = useCommunityChannels(enabled ? firstJoined : null);
	const unread = communityUnreadTotal(channels.data);
	const communities = useMemo(
		() =>
			joined.length === 0
				? NO_COMMUNITIES
				: joined.map(
						(community): TeamBridgeCommunity => ({
							kind: "community",
							communityId: asTeamBridgeCommunityId(community.id),
							name: community.name,
							unread: community.id === firstJoined ? unread : 0,
						}),
					),
		[joined, firstJoined, unread],
	);
	const access = communityAccessFrom({
		pending: enabled && list.isPending,
		failure: list.isError ? communityFailure(list.error).kind : null,
		joined: joined.length,
		featured: featured.length,
	});
	return {
		communities,
		enabled,
		featured,
		access,
		loading: enabled && list.isPending,
		retry: () => void list.refetch(),
	};
}
