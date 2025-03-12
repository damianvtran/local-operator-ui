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
	WELCOME = "welcome",
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
	 * Whether onboarding has been completed
	 */
	isComplete: boolean;

	/**
	 * Current step in the onboarding process
	 */
	currentStep: OnboardingStep;

	/**
	 * Whether onboarding is currently active/visible
	 */
	isActive: boolean;

	/**
	 * Mark onboarding as complete
	 */
	completeOnboarding: () => void;

	/**
	 * Set the current onboarding step
	 * @param step - The step to set as current
	 */
	setCurrentStep: (step: OnboardingStep) => void;

	/**
	 * Activate the onboarding flow
	 */
	activateOnboarding: () => void;

	/**
	 * Deactivate the onboarding flow
	 */
	deactivateOnboarding: () => void;

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
		(set) => ({
			isComplete: false,
			currentStep: OnboardingStep.WELCOME,
			isActive: false,

			completeOnboarding: () => {
				set({
					isComplete: true,
					isActive: false,
				});
			},

			setCurrentStep: (step) => {
				set({ currentStep: step });
			},

			activateOnboarding: () => {
				set({ isActive: true });
			},

			deactivateOnboarding: () => {
				set({ isActive: false });
			},

			resetOnboarding: () => {
				set({
					isComplete: false,
					currentStep: OnboardingStep.WELCOME,
					isActive: false,
				});
			},
		}),
		{
			name: "onboarding-storage",
		},
	),
);
