/**
 * Hook to check if the user is a first-time user
 *
 * Determines if the onboarding flow should be shown based on:
 * 1. Whether the onboarding has been explicitly completed before
 * 2. Whether any non-local provider is connected, per the backend's provider
 *    census (`GET /v1/auth/providers`), falling back to the legacy credential
 *    key list only when the backend has no census to give.
 *
 * The rule itself lives in `first-time-user.ts`; this file only wires the
 * two data sources and the onboarding store to it.
 */

import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
	useDesktopProviders,
} from "@shared/api/local-operator/desktop-hooks";
import { useOnboardingStore } from "@shared/store/onboarding-store";
import { useEffect } from "react";
import {
	type CensusInput,
	type LegacyCredentialsInput,
	decideFirstTimeUser,
} from "./first-time-user";
import { useCredentials } from "./use-credentials";

/**
 * Hook to check if the user is a first-time user and activate onboarding if needed
 *
 * @returns Object containing isFirstTimeUser flag and functions to control onboarding
 */
export const useCheckFirstTimeUser = () => {
	const capabilities = useDesktopCapabilities();
	const censusEnabled = desktopFeatureEnabled(capabilities.data, "auth");
	// Only fetched once the backend has advertised the census; asking an older
	// backend would 404 and the fallback below handles that case anyway.
	const providers = useDesktopProviders(censusEnabled);
	const credentials = useCredentials();
	const {
		isModalComplete: isOnboardingComplete,
		isModalActive: isOnboardingActive,
		activateModalOnboarding: activateOnboarding,
		deactivateModalOnboarding: deactivateOnboarding,
		resetOnboarding,
	} = useOnboardingStore();

	let census: CensusInput;
	if (capabilities.isPending) {
		census = { status: "loading" };
	} else if (!censusEnabled) {
		census = { status: "unavailable" };
	} else if (providers.isSuccess) {
		census = { status: "ready", providers: providers.data };
	} else if (providers.isError) {
		// The backend advertised the census and then failed to serve it. That
		// is not "no providers"; leave it to the legacy probe rather than
		// invent an answer.
		census = { status: "unavailable" };
	} else {
		census = { status: "loading" };
	}

	let legacy: LegacyCredentialsInput;
	if (credentials.isSuccess && credentials.data) {
		legacy = { status: "ready", keys: credentials.data.keys };
	} else if (credentials.isError) {
		legacy = { status: "error" };
	} else {
		// Includes the connectivity-gated "pending, never fetching" shape: the
		// server is not yet known to be up, so nothing is decided.
		legacy = { status: "loading" };
	}

	const decision = decideFirstTimeUser({
		onboardingComplete: isOnboardingComplete,
		census,
		legacy,
	});
	const isFirstTimeUser = decision === "first_time";

	// Automatically activate onboarding for first-time users
	useEffect(() => {
		if (isFirstTimeUser && !isOnboardingActive) {
			activateOnboarding();
		}
	}, [isFirstTimeUser, isOnboardingActive, activateOnboarding]);

	return {
		isFirstTimeUser,
		isOnboardingActive,
		activateOnboarding,
		deactivateOnboarding,
		resetOnboarding,
	};
};
