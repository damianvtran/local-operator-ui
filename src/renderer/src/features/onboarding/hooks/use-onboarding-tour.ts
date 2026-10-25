import { useOnboardingStore } from "@shared/store/onboarding-store";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { ShepherdJourneyContext } from "react-shepherd";
import type { StepOptions, Tour } from "shepherd.js";
import { createTourSteps } from "../tour/tour-steps";

export const useOnboardingTour = () => {
	const navigate = useNavigate();
	const { completeTourOnboarding } = useOnboardingStore();
	// Using 'any' for shepherdContext as ShepherdContextType might be incomplete or not exported.
	// The actual context value might be the tour instance itself or an object containing it.
	// biome-ignore lint/suspicious/noExplicitAny: ShepherdContextType is not exported by react-shepherd, making it difficult to type precisely.
	const shepherdContext = useContext(ShepherdJourneyContext) as any;

	// These are Shepherd.js tour options.
	// The `when` part is handled by attaching event listeners manually.
	const defaultStepOptions: StepOptions = {
		// Use StepOptions type
		cancelIcon: { enabled: true },
		scrollTo: { behavior: "smooth", block: "center" },
	};
	const useModalOverlay = true;

	type StartTourOptions = {
		/**
		 * If true, the tour will attempt to start even if the store's isModalComplete is false.
		 * Useful for scenarios like a manual "Resume Tour" button where modal completion is implied.
		 */
		forceModalCompleted?: boolean;
		/**
		 * The ID of the first agent, to be used as a fallback conversationId.
		 */
		firstAgentId?: string;
	};

	const startTour = (options?: StartTourOptions) => {
		// If react-shepherd's context provides an active tour, and it's running, don't overlap.
		// This is the main guard against multiple active tours.
		if (shepherdContext?.tour?.isActive() && !options?.forceModalCompleted) {
			console.log(
				"Onboarding tour is already active (from context.tour). Not starting another.",
			);
			return;
		}

		const currentStoreState = useOnboardingStore.getState(); // Get the latest state

		// Check modal completion unless forced
		if (!options?.forceModalCompleted && !currentStoreState.isModalComplete) {
			console.log(
				"Onboarding modal not completed (checked via store). Tour will not start.",
			);
			return;
		}

		// If tour is marked complete in store, and we are not forcing it, don't restart.
		// The check for an active tour is handled by the initial guard at the top of the function.
		if (currentStoreState.isTourComplete && !options?.forceModalCompleted) {
			console.log(
				"Onboarding tour already completed in store and not forced. Not starting again.",
			);
			return;
		}

		// Get the tour instance. Prefer react-shepherd's context tour.
		let tourInstance: Tour | undefined = shepherdContext?.tour;
		const shepherdService = shepherdContext?.Shepherd; // Shepherd global/class

		if (!tourInstance && shepherdService) {
			// If context.tour wasn't available, try Shepherd.activeTour
			tourInstance = shepherdService.activeTour;
			if (!tourInstance && shepherdService.Tour) {
				// If still no tour, create one. This part is from original code.
				console.log(
					"No active Shepherd tour found from context or global. Creating a new one.",
				);
				tourInstance = new shepherdService.Tour({
					useModalOverlay,
					defaultStepOptions,
				});
			}
		}

		if (!tourInstance) {
			console.warn(
				"Failed to get or create a Shepherd tour instance.",
				shepherdContext,
			);
			return;
		}

		if (tourInstance.isActive()) {
			console.log("Tour is already active. Not starting again.");
			return;
		}

		// Ensure tour options are set
		// Note: Modifying tourInstance.options directly is standard for Shepherd.js
		tourInstance.options.defaultStepOptions = {
			...(tourInstance.options.defaultStepOptions || {}),
			...defaultStepOptions,
		};
		tourInstance.options.useModalOverlay = useModalOverlay;
		// Pass firstAgentId to tour options so it's accessible in step actions
		if (options?.firstAgentId) {
			// biome-ignore lint/suspicious/noExplicitAny: Shepherd options can be extended
			(tourInstance.options as any).firstAgentId = options.firstAgentId;
		}

		// Attach event listeners
		tourInstance.off("complete", completeTourOnboarding); // Remove first to prevent duplicates
		tourInstance.on("complete", completeTourOnboarding);
		tourInstance.off("cancel", completeTourOnboarding); // Remove first
		tourInstance.on("cancel", completeTourOnboarding);

		// Resolve the copy in the language active at start (see ./tour/tour-steps).
		const tourSteps = createTourSteps();

		// Manage steps:
		// If forcing (e.g., "Resume Tour" button) or if the tour isn't active (fresh start),
		// clear existing steps and add the current `tourSteps`.
		// This ensures the tour always starts with the defined steps in these scenarios.
		if (options?.forceModalCompleted || !tourInstance.isActive()) {
			// Clear existing steps before adding new ones to prevent duplication/errors
			// Create a copy of the steps array to iterate over, as removing steps modifies the original array
			const currentStepsCopy = [...tourInstance.steps];
			for (const step of currentStepsCopy) {
				if (step.id) {
					// Ensure step has an ID before trying to remove
					tourInstance.removeStep(step.id);
				}
			}
			tourInstance.addSteps(tourSteps);
		} else if (tourInstance.steps.length === 0) {
			// If the tour is somehow active but has no steps (e.g., after cancellation and restart logic elsewhere)
			tourInstance.addSteps(tourSteps);
		}

		if (typeof tourInstance.start === "function") {
			// Navigate to home page if all conditions to start the tour are met
			navigate("/");
			tourInstance.start();
		} else {
			console.warn(
				"Shepherd tour instance does not have a start method.",
				tourInstance,
			);
		}
	};

	return {
		startTour,
	};
};
