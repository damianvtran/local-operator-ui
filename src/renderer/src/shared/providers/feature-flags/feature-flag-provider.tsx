/**
 * @file feature-flag-provider.tsx
 * @description
 * The app's feature-flag provider: every flag at its default, ALWAYS.
 *
 * WHY NO POSTHOG FLAGS AT ALL (review round 2, Q4; 2026-11-24). Telemetry is
 * opt-in and promises that no session details leave the machine. Evaluating a
 * PostHog flag means posthog-js POSTing `/decide/`, and in 1.235.6 that body
 * carries `person_properties` built from the stored initial props
 * (`$initial_current_url`, `$initial_pathname`): the `file://` path, which can
 * hold the user's name, and the `#/chat/<id>` route. That request bypasses
 * `before_send`, so the event allow-list cannot guard it. The analytics client
 * is therefore initialised with `advanced_disable_decide` (see
 * `buildPosthogOptions` in `shared/analytics/telemetry-controller.ts`), and
 * this provider never reads a PostHog flag, whether or not the user opted in.
 * It also does not import `posthog-js`, so nothing on this path can construct
 * or poke the client.
 *
 * `isEnabled` returning `false` IS the default, not a stub: a flag is off
 * unless something turns it on, so every gated surface stays dark exactly as it
 * did for a user whose flags failed to load. The only reader today is Team
 * Bridge's community group (`features/team-bridge/team-bridge-communities.ts`),
 * which ships dark by design and treats "off" as its safe default. If a flag
 * must ever be turned on again, it needs a source that sends no client
 * properties (a build-time constant, or a server fetch reviewed for what it
 * carries), not a revert to `/decide/`.
 */

import type { FC, ReactNode } from "react";
import { useContext, useMemo } from "react";

import {
	FeatureFlagContext,
	type FeatureFlagContextType,
} from "./feature-flag-context";

export type { FeatureFlagKey, FeatureFlags } from "./feature-flag-context";

/**
 * Props for the FeatureFlagProvider component
 */
type FeatureFlagProviderProps = {
	/**
	 * Children to render inside the provider
	 */
	children: ReactNode;
};

/** Every flag off; nothing to reload. Shared so the context value is stable. */
const DEFAULT_FLAGS: FeatureFlagContextType = {
	isEnabled: () => false,
	getValue: () => undefined,
	reloadFeatureFlags: () => {},
};

/**
 * Provider component for feature flags: every flag at its default (see the
 * module comment for why no flag is ever read from PostHog).
 */
export const FeatureFlagProvider: FC<FeatureFlagProviderProps> = ({
	children,
}) => {
	const contextValue = useMemo(() => DEFAULT_FLAGS, []);
	return (
		<FeatureFlagContext.Provider value={contextValue}>
			{children}
		</FeatureFlagContext.Provider>
	);
};

/**
 * Hook to access feature flags in a type-safe manner
 * @returns Object with methods to check and get feature flag values
 * @throws Error if used outside of a FeatureFlagProvider
 */
export const useFeatureFlags = (): FeatureFlagContextType => {
	const context = useContext(FeatureFlagContext);

	if (!context) {
		throw new Error(
			"useFeatureFlags must be used within a FeatureFlagProvider",
		);
	}

	return context;
};
