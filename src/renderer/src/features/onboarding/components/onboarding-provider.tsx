import { useOnboardingStore } from "@shared/store/onboarding-store";
import React, { useEffect } from "react";
import {
	ShepherdJourneyContext,
	ShepherdJourneyProvider,
} from "react-shepherd";
import { useOnboardingTour } from "../hooks/use-onboarding-tour";
import { useAgents } from "@shared/hooks/use-agents";
import type { AgentListResult } from "@shared/api/local-operator/types";

import "shepherd.js/dist/css/shepherd.css";

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
	}, [isModalComplete, isTourComplete, shepherdContext, initiateTourFromHook, agentsData]);

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
