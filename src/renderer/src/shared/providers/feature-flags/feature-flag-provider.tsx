/**
 * @file feature-flag-provider.tsx
 * @description
 * Provides a type-safe wrapper around PostHog feature flags.
 * Defines strict typing for feature flag keys and values.
 * Automatically refreshes feature flags every 10 minutes.
 */

import { telemetryEnabled } from "@shared/config";
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
 * The PostHog-backed provider, in the launches that send telemetry.
 *
 * Wraps the PostHog provider and provides a type-safe interface, and reloads the
 * flags once on mount and every 10 minutes after that.
 */
const PostHogFeatureFlags: FC<FeatureFlagProviderProps> = ({ children }) => {
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
 * The provider a launch that does not report gets: every flag at its default.
 *
 * WHY A SECOND IMPLEMENTATION RATHER THAN A BRANCH INSIDE THE FIRST. The whole
 * point of switching telemetry off is that no PostHog client exists, and this
 * component is the only other place in the renderer that reaches for one:
 * `posthog.reloadFeatureFlags()` on a client that was never initialized is at
 * best a no-op that logs from inside the library and at worst a call that
 * initializes it, and the hooks below it subscribe to the same client. So the
 * off path must not call any of them at all rather than call them and hope they
 * are inert.
 *
 * `isEnabled` returning `false` IS the default branch, not a stub: a flag is off
 * unless PostHog says otherwise, so a launch that sends nothing evaluates every
 * gated surface as not-enabled, exactly as a user whose flags failed to load
 * would. Which implementation runs is a LAUNCH constant, so this choice cannot
 * change during a mount and the hook order inside either one is stable.
 *
 * `src/renderer/src/shared/config/telemetry.ts` owns the rule; a rig or harness
 * gets it off through the app's launch switch, never from inside here.
 */
const DefaultFeatureFlags: FC<FeatureFlagProviderProps> = ({ children }) => {
	const contextValue = useMemo<FeatureFlagContextType>(
		() => ({
			isEnabled: () => false,
			getValue: () => undefined,
			reloadFeatureFlags: () => {},
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
 * Provider component for type-safe feature flags.
 *
 * Picks the implementation from this launch's telemetry decision: the
 * PostHog-backed one when the launch may report, and the all-defaults one when
 * it may not.
 */
export const FeatureFlagProvider: FC<FeatureFlagProviderProps> = (props) =>
	telemetryEnabled ? (
		<PostHogFeatureFlags {...props} />
	) : (
		<DefaultFeatureFlags {...props} />
	);

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
