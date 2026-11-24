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
/*
 * Up to four steps (first-run stage refresh, 2026-11): sign in, confirm the
 * default model, web search, meet Aida. Search and Meet used to be one "extras"
 * step; they are split because the search step now LEAVES THE SEQUENCE when
 * Radient is connected (Radient already provides search), while Meet stays
 * whenever she is available - one step could not be both present and absent.
 *
 * The retired values (`user_profile`, `search_api`, `create_agent`,
 * `congratulations`) are not members any more; a persisted store that still
 * holds one is sent back to the first step by the modal's own "unknown step"
 * guard. `extras` is migrated explicitly (see `migrateLegacyStep`), because a
 * user who quit on the old last step should land on its successor rather than
 * start over.
 */
export enum OnboardingStep {
	CONNECT_PROVIDER = "connect_provider",
	DEFAULT_MODEL = "default_model",
	SEARCH = "search",
	MEET = "meet",
}

/** The value the old combined search-and-Aida step persisted. */
export const LEGACY_EXTRAS_STEP = "extras";

/**
 * Map a persisted step from an older build onto this one.
 *
 * Only `extras` has a successor: it becomes SEARCH, and the modal moves a SEARCH
 * that is not in the live sequence (Radient connected) on to MEET. Every other
 * value passes through untouched so the modal's unknown-step guard still owns
 * the fallback for the values that have none.
 */
export function migrateLegacyStep(step: unknown): unknown {
	return step === LEGACY_EXTRAS_STEP ? OnboardingStep.SEARCH : step;
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
					/*
					 * The walkthrough tour no longer starts itself after setup. It used
					 * to open as a second modal the instant this one closed (UX U9),
					 * which is two dialogs in a row before the first chat. It stays
					 * one click away in Settings > Application tour.
					 */
					isTourComplete: true,
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
				if (rest.currentStep !== undefined) {
					rest.currentStep = migrateLegacyStep(
						rest.currentStep,
					) as OnboardingStep;
				}
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
