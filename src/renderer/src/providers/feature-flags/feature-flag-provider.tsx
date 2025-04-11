/**
 * @file feature-flag-provider.tsx
 * @description
 * Provides a type-safe wrapper around PostHog feature flags.
 * Defines strict typing for feature flag keys and values.
 */

import type { FC, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import { useFeatureFlagEnabled } from "posthog-js/react";

/**
 * Type definition for all available feature flags
 * Add new feature flags here with their expected value types
 */
export type FeatureFlags = {
	/**
	 * Controls whether the Radient Pass onboarding flow is enabled
	 */
	"radient-pass-onboarding": boolean;

	// Add more feature flags here as needed
	// Example:
	// "new-feature": boolean | string | number;
};

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
 */
export const FeatureFlagProvider: FC<FeatureFlagProviderProps> = ({
	children,
}) => {
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
		}),
		[],
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
