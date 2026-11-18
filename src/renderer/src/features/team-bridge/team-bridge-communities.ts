import { FeatureFlagContext } from "@shared/providers/feature-flags/feature-flag-context";
import { useContext } from "react";
import type { TeamBridgeCommunity } from "./team-bridge-model";

/**
 * The PostHog flag that turns the community surfaces on (RFC v2.4: everything
 * ships dark until the staff pilot). Off - the default for every launch that
 * does not report, and for anyone PostHog does not target - hides the
 * switcher's Communities group entirely, so private Team Bridge is unchanged.
 */
export const TEAM_BRIDGE_COMMUNITY_FLAG = "team-bridge-community";

/** No communities: one stable array, so memoised consumers do not churn. */
const NO_COMMUNITIES: readonly TeamBridgeCommunity[] = Object.freeze([]);

/**
 * The reader's JOINED communities, and whether the community feature is on.
 *
 * WHY A PROVIDER THAT IS EMPTY TODAY. Amendment A puts communities on their own
 * server (`/community/v1/communities`), and that client has not landed in this
 * app. The switcher, the typed `TeamBridgeCommunity` and the opening rule all
 * exist now so the private-org half of Amendment A ships on its own; when the
 * community client lands it replaces the body of this hook (its list read,
 * still gated on the flag) and nothing downstream changes shape.
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
} {
	const flags = useContext(FeatureFlagContext);
	const enabled = flags?.isEnabled(TEAM_BRIDGE_COMMUNITY_FLAG) ?? false;
	return { communities: NO_COMMUNITIES, enabled };
}
