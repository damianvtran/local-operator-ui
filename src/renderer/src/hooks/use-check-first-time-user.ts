/**
 * Hook to check if the user is a first-time user
 *
 * Determines if the onboarding flow should be shown based on:
 * 1. Whether any credentials are set up
 * 2. Whether the onboarding has been explicitly completed before
 */

import { useOnboardingStore } from "@renderer/store/onboarding-store";
import { useEffect } from "react";
import { useCredentials } from "./use-credentials";

/**
 * Hook to check if the user is a first-time user and activate onboarding if needed
 *
 * @returns Object containing isFirstTimeUser flag and functions to control onboarding
 */
export const useCheckFirstTimeUser = () => {
	const { data: credentialsData, isLoading: isLoadingCredentials } =
		useCredentials();
	const {
		isComplete: isOnboardingComplete,
		isActive: isOnboardingActive,
		activateOnboarding,
		deactivateOnboarding,
		resetOnboarding,
	} = useOnboardingStore();

	// Check if user is a first-time user based on credentials and onboarding state
	const isFirstTimeUser =
		!isOnboardingComplete &&
		!isLoadingCredentials &&
		(!credentialsData || credentialsData.keys.length === 0);

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
