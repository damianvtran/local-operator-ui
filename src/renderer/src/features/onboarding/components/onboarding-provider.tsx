import React, { useEffect } from 'react';
import { ShepherdJourneyProvider, ShepherdJourneyContext } from 'react-shepherd';
import { useOnboardingStore } from '@shared/store/onboarding-store';
import { useOnboardingTour } from '../hooks/use-onboarding-tour';

import 'shepherd.js/dist/css/shepherd.css';

type OnboardingProviderProps = {
  children: React.ReactNode;
};

// Helper component to consume the context and initiate the tour
const TourInitiator: React.FC = () => {
  const { isComplete: isTourPreviouslyCompleted } = useOnboardingStore();
  // useOnboardingTour provides the startTour function which itself uses the context.
  const { startTour: initiateTourFromHook } = useOnboardingTour();
  const shepherdContext = React.useContext(ShepherdJourneyContext);

  useEffect(() => {
    if (!isTourPreviouslyCompleted && shepherdContext) {
      const timer = setTimeout(() => {
        initiateTourFromHook();
      }, 200);

      return () => clearTimeout(timer);
    }

    return undefined;
  }, [isTourPreviouslyCompleted, shepherdContext, initiateTourFromHook]);

  return null; // This component does not render any UI itself
};

export const OnboardingProvider: React.FC<OnboardingProviderProps> = ({ children }) => {
  // ShepherdJourneyProvider does not take steps or tourOptions as props.
  // These are configured via the context or tour instance obtained from the context.
  return (
    <ShepherdJourneyProvider>
      {children}
      <TourInitiator />
    </ShepherdJourneyProvider>
  );
};
