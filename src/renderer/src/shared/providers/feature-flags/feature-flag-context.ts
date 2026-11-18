/**
 * @file feature-flag-context.ts
 * @description
 * The feature-flag context and its types, WITHOUT the PostHog SDK.
 *
 * WHY A SEPARATE MODULE. `posthog-js` reads `location` while it is being
 * imported, so any module graph that imports the provider cannot even be
 * loaded outside a browser window. A feature that only needs to READ a flag
 * (Team Bridge's dark community group, `useTeamBridgeCommunities`) imports
 * this module instead and reads the context with `useContext`: the provider
 * still supplies the value in the app, and a tree without one (node/jsdom
 * page tests, isolated stories) reads `null` - "flag off" - instead of
 * pulling the SDK in and crashing at import time. The provider re-exports
 * everything here, so existing imports are unchanged.
 */

import { createContext } from "react";

/**
 * Type definition for all available feature flags
 * Add new feature flags here with their expected value types
 */
export type FeatureFlags = Record<string, boolean>;

/**
 * Type for feature flag keys, derived from the FeatureFlags type
 */
export type FeatureFlagKey = keyof FeatureFlags;

/**
 * Context for accessing feature flags in a type-safe manner
 */
export type FeatureFlagContextType = {
	/**
	 * Check if a boolean feature flag is enabled
	 * @param key - The feature flag key
	 * @returns Whether the feature flag is enabled
	 */
	isEnabled: <K extends FeatureFlagKey>(
		key: K,
	) => FeatureFlags[K] extends boolean ? boolean : never;

	/**
	 * Get the value of a feature flag
	 * @param key - The feature flag key
	 * @returns The value of the feature flag, or undefined if not set
	 * @deprecated PostHog React SDK only provides boolean flag checking
	 */
	getValue: <K extends FeatureFlagKey>(key: K) => FeatureFlags[K] | undefined;

	/**
	 * Manually reload feature flags from PostHog
	 * This is called automatically every 10 minutes, but can be called manually if needed
	 */
	reloadFeatureFlags: () => void;
};

// Create the context with a default value
export const FeatureFlagContext = createContext<FeatureFlagContextType | null>(
	null,
);
