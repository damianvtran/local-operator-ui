import type { AgentListResult } from "@shared/api/local-operator/types";
import { useAgents } from "@shared/hooks/use-agents";
import { useOnboardingStore } from "@shared/store/onboarding-store";
import React, { useEffect } from "react";
import {
	ShepherdJourneyContext,
	ShepherdJourneyProvider,
} from "react-shepherd";
import { useOnboardingTour } from "../hooks/use-onboarding-tour";

/*
 * Shepherd's stock stylesheet, then our skin over it.
 *
 * Order matters and is the whole reason these sit together: both files carry
 * plain class selectors, so the later import wins. The skin is a stylesheet
 * rather than a React component because Shepherd builds its own DOM outside
 * React, and because this provider wraps the whole app — a tour opened from
 * any surface is already covered, which a component mounted beside the
 * onboarding modal would not be.
 */
import "shepherd.js/dist/css/shepherd.css";
import "../onboarding-tour.css";

type OnboardingProviderProps = {
	children: React.ReactNode;
};

// Helper component to consume the context and initiate the tour
const TourInitiator: React.FC = () => {
	const { isModalComplete, isTourComplete } = useOnboardingStore();
	const { startTour: initiateTourFromHook } = useOnboardingTour();
	const shepherdContext = React.useContext(ShepherdJourneyContext);
	const { data: agentsData } = useAgents(1, 1) as { data?: AgentListResult };

	useEffect(() => {
		// Start the tour if the modal is complete, the tour is NOT yet complete, and shepherd context is available.
		if (isModalComplete && !isTourComplete && shepherdContext) {
			const timer = setTimeout(() => {
				const firstAgentId = agentsData?.agents?.[0]?.id;
				initiateTourFromHook({ firstAgentId });
			}, 500); // Delay to ensure UI elements are rendered

			return () => clearTimeout(timer);
		}

		return undefined;
	}, [
		isModalComplete,
		isTourComplete,
		shepherdContext,
		initiateTourFromHook,
		agentsData,
	]);

	return null; // This component does not render any UI itself
};

export const OnboardingProvider: React.FC<OnboardingProviderProps> = ({
	children,
}) => {
	// ShepherdJourneyProvider does not take steps or tourOptions as props.
	// These are configured via the context or tour instance obtained from the context.
	return (
		<ShepherdJourneyProvider>
			{children}
			<TourInitiator />
		</ShepherdJourneyProvider>
	);
};
