/**
 * Onboarding Store
 *
 * Manages the state of the first-time setup experience using Zustand.
 * Tracks whether onboarding is complete and which step the user is on.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Onboarding steps enum
 */
export enum OnboardingStep {
	CONNECT_PROVIDER = "connect_provider",
	USER_PROFILE = "user_profile",
	SEARCH_API = "search_api",
	DEFAULT_MODEL = "default_model",
	CREATE_AGENT = "create_agent",
	CONGRATULATIONS = "congratulations",
}

/**
 * Onboarding store state interface
 */
type OnboardingState = {
	/**
	 * Whether the onboarding modal has been completed
	 */
	isModalComplete: boolean;
	/**
	 * Whether the onboarding tour has been completed
	 */
	isTourComplete: boolean;
	/**
	 * Current step in the onboarding process
	 */
	currentStep: OnboardingStep;
	/**
	 * Whether onboarding modal is currently active/visible
	 */
	isModalActive: boolean;
	/**
	 * Mark onboarding modal as complete
	 */
	completeModalOnboarding: () => void;
	/**
	 * Mark onboarding tour as complete
	 */
	completeTourOnboarding: () => void;
	/**
	 * Set the current onboarding step
	 * @param step - The step to set as current
	 */
	setCurrentStep: (step: OnboardingStep) => void;
	/**
	 * Activate the onboarding modal
	 */
	activateModalOnboarding: () => void;
	/**
	 * Deactivate the onboarding modal
	 */
	deactivateModalOnboarding: () => void;
	/**
	 * Reset the onboarding state (for testing/development)
	 */
	resetOnboarding: () => void;
};

/**
 * Onboarding store implementation using Zustand with persistence
 * Stores onboarding state in localStorage
 */
export const useOnboardingStore = create<OnboardingState>()(
	persist(
		(set, _) => ({
			isModalComplete: false,
			isTourComplete: false,
			// Default to the provider grid; the modal no longer gates on Radient.
			currentStep: OnboardingStep.CONNECT_PROVIDER,
			isModalActive: false,

			completeModalOnboarding: () => {
				set({
					isModalComplete: true,
					isModalActive: false, // Modal is no longer active once completed
				});
			},

			completeTourOnboarding: () => {
				set({
					isTourComplete: true,
				});
			},

			setCurrentStep: (step) => {
				set({ currentStep: step });
			},

			activateModalOnboarding: () => {
				set({ isModalActive: true });
			},

			deactivateModalOnboarding: () => {
				set({ isModalActive: false });
			},

			resetOnboarding: () => {
				set({
					isModalComplete: false,
					isTourComplete: false,
					// Reset to the provider grid as well
					currentStep: OnboardingStep.CONNECT_PROVIDER,
					isModalActive: false,
				});
			},
		}),
		{
			name: "onboarding-storage",
			// `isModalActive` is a session fact, not a preference: it is derived
			// on every launch from whether a provider is connected. Persisting
			// it meant one launch that (wrongly) opened setup pinned the modal
			// open on every later launch, even after the decision was fixed --
			// which is exactly how 0.15.0 users who saw onboarding once would
			// keep seeing it. Only the completion flags and the step persist.
			partialize: (state) => ({
				isModalComplete: state.isModalComplete,
				isTourComplete: state.isTourComplete,
				currentStep: state.currentStep,
			}),
			// A 0.15.0 install already wrote `isModalActive: true`; partialize
			// stops new writes but rehydration would still merge the old value
			// in, so it is dropped here too.
			merge: (persisted, current) => {
				const { isModalActive: _stale, ...rest } = (persisted ??
					{}) as Partial<OnboardingState>;
				return { ...current, ...rest };
			},
			onRehydrateStorage: () => (state, error) => {
				if (error) {
					console.error("Failed to rehydrate onboarding store:", error);
				} else if (state) {
					// Check for the old 'isComplete' key from a previous version of the store state
					// This is a simplified one-time migration logic.
					const rawPersistedState = JSON.parse(
						localStorage.getItem("onboarding-storage") || "{}",
					);

					if (
						rawPersistedState?.state?.isComplete === true &&
						!state.isModalComplete
					) {
						console.log(
							"Migrating old 'isComplete:true' state to 'isModalComplete:true'",
						);
						// Directly update the state that will be applied to the store
						// This ensures that if the old key indicated modal completion, the new key reflects it.
						state.isModalComplete = true;
					}
				}
			},
		},
	),
);
