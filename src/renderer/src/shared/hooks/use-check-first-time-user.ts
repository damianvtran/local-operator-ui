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

import { CredentialsApi } from "@shared/api/local-operator";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
	useDesktopProviders,
} from "@shared/api/local-operator/desktop-hooks";
import { apiConfig } from "@shared/config";
import { useOnboardingStore } from "@shared/store/onboarding-store";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import {
	type CensusInput,
	type LegacyCredentialsInput,
	decideFirstTimeUser,
} from "./first-time-user";
import { useConnectivityGate } from "./use-connectivity-gate";

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
	const { shouldEnableQuery } = useConnectivityGate();
	// The desktop bearer transport 503s every non-capabilities op when this
	// app did not start the backend. Unmanaged `/v1/credentials` is open,
	// so the first-run fallback reads it directly rather than through
	// `useCredentials()`. Never fetch this while the census is advertised:
	// a 5xx there must stay pending (MINOR-1), not invent first_time from
	// an empty env-file list.
	const openCredentials = useQuery({
		queryKey: ["open-credentials"],
		enabled:
			!censusEnabled &&
			!capabilities.isPending &&
			shouldEnableQuery({ bypassInternetCheck: true }),
		queryFn: () => CredentialsApi.listOpenCredentials(apiConfig.baseUrl),
		staleTime: 5000,
		retry: false,
	});
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
		// Advertised and then 5xx'd. Not "old backend", not "no providers".
		census = { status: "failed" };
	} else {
		census = { status: "loading" };
	}

	let legacy: LegacyCredentialsInput;
	if (censusEnabled || capabilities.isPending) {
		// Census path owns the decision; the open list is not consulted.
		legacy = { status: "loading" };
	} else if (openCredentials.isSuccess && openCredentials.data) {
		legacy = { status: "ready", keys: openCredentials.data.keys };
	} else if (openCredentials.isError) {
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
