/**
 * @file feature-flag-provider.tsx
 * @description
 * Provides a type-safe wrapper around PostHog feature flags.
 * Defines strict typing for feature flag keys and values.
 * Automatically refreshes feature flags every 10 minutes.
 */

import posthog from "posthog-js";
import { useFeatureFlagEnabled } from "posthog-js/react";
import type { FC, ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo } from "react";

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
type FeatureFlagContextType = {
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
const FeatureFlagContext = createContext<FeatureFlagContextType | null>(null);

/**
 * Props for the FeatureFlagProvider component
 */
type FeatureFlagProviderProps = {
	/**
	 * Children to render inside the provider
	 */
	children: ReactNode;
};

/**
 * Provider component for type-safe feature flags
 * Wraps the PostHog provider and provides a type-safe interface
 * Automatically refreshes feature flags every 10 minutes
 */
export const FeatureFlagProvider: FC<FeatureFlagProviderProps> = ({
	children,
}) => {
	/**
	 * Reload feature flags from PostHog
	 * This will update the flags and trigger a re-render
	 */
	const reloadFeatureFlags = useMemo(() => {
		return () => {
			// Call PostHog's reloadFeatureFlags method
			posthog.reloadFeatureFlags();
			// PostHog hooks will automatically re-render when flags change
		};
	}, []);

	// Set up a timer to reload feature flags every 10 minutes
	useEffect(() => {
		// Initial load of feature flags
		reloadFeatureFlags();

		// Set up interval to reload flags every 10 minutes (600000 ms)
		const intervalId = setInterval(
			() => {
				reloadFeatureFlags();
			},
			10 * 60 * 1000,
		);

		// Clean up the interval when the component unmounts
		return () => {
			clearInterval(intervalId);
		};
	}, [reloadFeatureFlags]);

	// Create the context value with type-safe methods
	const contextValue = useMemo<FeatureFlagContextType>(
		() => ({
			isEnabled: <K extends FeatureFlagKey>(
				key: K,
			): FeatureFlags[K] extends boolean ? boolean : never => {
				// PostHog's useFeatureFlagEnabled always returns a boolean
				// This cast is safe because we're constraining the type with the conditional
				return useFeatureFlagEnabled(
					key as string,
				) as FeatureFlags[K] extends boolean ? boolean : never;
			},

			getValue: <K extends FeatureFlagKey>(
				key: K,
			): FeatureFlags[K] | undefined => {
				// Since PostHog React SDK doesn't provide a direct way to get values,
				// we can only check if boolean flags are enabled
				if (typeof useFeatureFlagEnabled(key as string) === "boolean") {
					return useFeatureFlagEnabled(key as string) as
						| FeatureFlags[K]
						| undefined;
				}
				return undefined;
			},

			reloadFeatureFlags,
		}),
		[reloadFeatureFlags],
	);

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
