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
	RADIENT_CHOICE = "radient_choice",
	RADIENT_SIGNIN = "radient_signin",
	USER_PROFILE = "user_profile",
	MODEL_CREDENTIAL = "model_credential",
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
			// Default to RADIENT_CHOICE; the modal will redirect if needed
			currentStep: OnboardingStep.RADIENT_CHOICE,
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
					// Reset to RADIENT_CHOICE as well
					currentStep: OnboardingStep.RADIENT_CHOICE,
					isModalActive: false,
				});
			},
		}),
		{
			name: "onboarding-storage",
			onRehydrateStorage: () => (state, error) => {
				if (error) {
					console.error("Failed to rehydrate onboarding store:", error);
				} else if (state) {
					// Check for the old 'isComplete' key from a previous version of the store state
					// This is a simplified one-time migration logic.
					// biome-ignore lint/suspicious/noExplicitAny: checking for old state shape
					const rawPersistedState = JSON.parse(
						localStorage.getItem("onboarding-storage") || "{}",
					) as any;

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
