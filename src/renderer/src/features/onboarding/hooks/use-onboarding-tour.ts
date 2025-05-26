import { useContext } from 'react';
import { ShepherdJourneyContext } from 'react-shepherd';
import type { Tour, StepOptions } from 'shepherd.js';
import { useOnboardingStore } from '@shared/store/onboarding-store';

const tourSteps: StepOptions[] = [
  {
    id: 'welcome',
    title: 'Welcome to Local Operator!',
    text: 'Local Operator helps you get things done with AI agents that can do things for you on your computer and use the internet. Let\'s explore how it works!',
    buttons: [
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'agent-list',
    attachTo: { element: '[data-tour-tag="agent-list-panel"]', on: 'right' },
    title: 'Your Agents',
    text: 'On the left, you\'ll see a list of your available AI agents. You can select an agent to start a conversation or manage its settings.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'select-agent',
    // Targets the first AgentListItemButton within the AgentsList using the new data-tour-tag
    attachTo: { element: 'ul[class*="AgentsList-root"] > li:first-child [data-tour-tag="agent-list-item-button"]', on: 'right' },
    title: 'Select an Agent',
    text: 'Click on an agent to open the chat window and start interacting with it.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'chat-input',
    attachTo: { element: 'textarea[data-tour-tag="chat-input-textarea"]', on: 'top' },
    title: 'Ask Your Agent Anything',
    text: 'Type your request here. Agents can answer questions, perform tasks, search the web, and much more. Notice the suggested prompts above for ideas!',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'agent-capabilities',
    attachTo: { element: '[data-tour-tag="chat-utilities-header"]', on: 'top' },
    title: 'More Than Just Chat',
    text: 'Local Operator agents are different from simple chatbots. They can perform actions on your computer, like creating files, running code, or browsing the web, based on your instructions. You\'ll see them use "tools" to get things done!',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'agent-options',
    attachTo: { element: 'button[data-tour-tag="agent-options-button"]', on: 'bottom' },
    title: 'Agent Options',
    text: 'Click here to see options for the currently selected agent, like viewing its settings, exporting it, or deleting it.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'click-view-settings-from-chat',
    // Assumes Agent Options menu is open from the previous step
    attachTo: { element: '[role="menuitem"][data-tour-tag="view-agent-settings-menu-item"]', on: 'bottom' },
    title: 'View Configuration',
    text: 'Click "View Agent Settings" to see and change how this agent works.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'view-agent-settings',
    // Targets the DetailsPaper component in AgentSettings
    attachTo: { element: 'div[data-tour-tag="agent-settings-details-paper"]', on: 'left' },
    title: 'Agent Configuration',
    text: 'This is where you can configure your agent. You can change its name, description, the AI model it uses, its temperature for creativity, and other chat settings.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'create-new-agent',
    attachTo: { element: 'button[data-tour-tag="create-new-agent-button"]', on: 'bottom' },
    title: 'Create a New Agent',
    text: 'Click the "+" button to create a brand new agent from scratch. You can then customize its behavior and capabilities.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'navigate-agent-hub',
    // Targets the NavItemButton for Agent Hub via its icon's aria-label
    attachTo: { element: 'button[data-tour-tag="nav-item-agent-hub"]', on: 'right' },
    title: 'Discover More Agents',
    text: 'Let\'s visit the Agent Hub to find community-created agents. Click on the "Agent Hub" icon in the navigation bar.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'agent-hub-view',
    // Targets the SidebarContainer in AgentHubPage that wraps AgentCategoriesSidebar
    attachTo: { element: 'div[data-tour-tag="agent-hub-sidebar-container"]', on: 'right' },
    title: 'The Agent Hub',
    text: 'Here you can browse agents by category or search for specific ones. These agents are shared by the community and can perform various specialized tasks.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'download-agent',
    // Targets the first download button using its data-testid, assuming it's within the first relevant card context
    attachTo: { element: 'button[data-tour-tag="agent-hub-download-button"]', on: 'bottom' },
    title: 'Download an Agent',
    text: 'Find an agent that interests you and click the "Download" button to add it to your local agent list.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'upload-agent-hub',
    // Targets the "Upload to Hub" menu item, assuming the parent menu is open
    attachTo: { element: '[role="menuitem"][data-tour-tag="upload-to-hub-menu-item"]', on: 'bottom' },
    title: 'Share Your Agents (Optional)',
    text: 'If you create a useful agent, you can also share it with the community by uploading it to the Hub from the Agent Options menu.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'navigate-schedules',
    attachTo: { element: 'button[data-tour-tag="nav-item-schedules"]', on: 'right' },
    title: 'Automate Tasks with Schedules',
    text: 'Local Operator can run tasks for you on a regular basis. Let\'s check out the Schedules section.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'create-schedule',
    // Targets the "Create Schedule" button within the PageHeader
    attachTo: { element: 'button[data-tour-tag="create-schedule-button"]', on: 'bottom' },
    title: 'Set Up a Recurring Task',
    text: 'Click "Create Schedule" to ask an agent to perform a task for you regularly, like sending a daily report or checking for news updates.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'navigate-settings',
    attachTo: { element: 'button[data-tour-tag="nav-item-settings"]', on: 'right' },
    title: 'Personalize Your Experience',
    text: 'Now, let\'s explore the Settings menu to customize Local Operator to your liking.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'general-settings',
    // Targets the "General Settings" item in settings sidebar via its icon
    attachTo: { element: 'div[data-tour-tag="settings-sidebar-general"]', on: 'right' },
    title: 'General Settings',
    text: 'Here you can update your user profile, configure model settings (like default hosting provider and model), and adjust history settings for conversations and learnings.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'radient-account-settings',
    attachTo: { element: 'div[data-tour-tag="settings-sidebar-radient-account"]', on: 'right' },
    title: 'Radient Account',
    text: 'Connect your Radient Account to access your Radient Pass details, credits, and unlock unified access to models and tools.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'integrations-settings',
    attachTo: { element: 'div[data-tour-tag="settings-sidebar-integrations"]', on: 'right' },
    title: 'Connect Your Services',
    text: 'Enhance your agents\' capabilities by connecting your Google services like Gmail, Calendar, and Drive. This allows agents to access and manage your information with your permission.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'appearance-settings',
    attachTo: { element: 'div[data-tour-tag="settings-sidebar-appearance"]', on: 'right' },
    title: 'Customize Appearance',
    text: 'Choose from various themes to change the look and feel of Local Operator. Find one that suits your style!',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'api-credentials-settings',
    attachTo: { element: 'div[data-tour-tag="settings-sidebar-api-credentials"]', on: 'right' },
    title: 'Manage API Keys',
    text: 'Configure API keys for various services and AI models here. This allows your agents to access external tools and capabilities.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'application-updates-settings',
    attachTo: { element: 'div[data-tour-tag="settings-sidebar-application-updates"]', on: 'right' },
    title: 'Stay Up-to-Date',
    text: 'Check for updates to Local Operator here to ensure you have the latest features and improvements. You can see your current version information below.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary' },
      { text: 'Next', classes: 'shepherd-button-primary' },
    ],
  },
  {
    id: 'tour-complete',
    title: 'Tour Complete!',
    text: 'You\'ve now seen the main features of Local Operator. Feel free to explore further and discover all the ways your AI agents can assist you. Happy automating!',
    buttons: [
      { text: 'Finish', classes: 'shepherd-button-primary' },
    ],
  },
];

export const useOnboardingTour = () => {
  const { completeTourOnboarding } = useOnboardingStore();
  // Using 'any' for shepherdContext as ShepherdContextType might be incomplete or not exported.
  // The actual context value might be the tour instance itself or an object containing it.
  // biome-ignore lint/suspicious/noExplicitAny: ShepherdContextType is not exported by react-shepherd, making it difficult to type precisely.
  const shepherdContext = useContext(ShepherdJourneyContext) as any;

  // These are Shepherd.js tour options.
  // The `when` part is handled by attaching event listeners manually.
  const defaultStepOptions: StepOptions = { // Use StepOptions type
    cancelIcon: { enabled: true },
    scrollTo: { behavior: 'smooth', block: 'center' },
  };
  const useModalOverlay = true;

  type StartTourOptions = {
    /**
     * If true, the tour will attempt to start even if the store's isModalComplete is false.
     * Useful for scenarios like a manual "Resume Tour" button where modal completion is implied.
     */
    forceModalCompleted?: boolean;
  };

  const startTour = (options?: StartTourOptions) => {
    const currentStoreState = useOnboardingStore.getState(); // Get the latest state

    // Check modal completion unless forced
    if (!options?.forceModalCompleted && !currentStoreState.isModalComplete) {
      console.log('Onboarding modal not completed (checked via store). Tour will not start.');
      return;
    }

    // If the tour is already complete, don't restart it automatically,
    // unless it's being forced (e.g. from a resume button that should always work if visible).
    // The visibility of such a button should already be gated by !isTourComplete.
    if (currentStoreState.isTourComplete) {
      // Allow starting if forced (e.g. resume button) or if tour is somehow active but marked complete.
      // This primarily prevents automatic re-triggering by TourInitiator.
      if (!options?.forceModalCompleted && !shepherdContext?.tour?.isActive()) {
         console.log('Onboarding tour already completed. Not starting again automatically.');
         return;
      }
       // If forced, or active, proceed to potentially re-add steps and start.
    }

    const shepherdService = shepherdContext?.Shepherd;

    if (!shepherdService) {
      console.warn('Shepherd service (Shepherd.Shepherd) not available on context.', shepherdContext);
      return;
    }

    let tourInstance: Tour | undefined = shepherdService.activeTour;

    if (!tourInstance && shepherdService.Tour) {
      console.log("No active Shepherd tour found. Creating a new one.");
      const tourCreationOptions = {
        useModalOverlay,
        defaultStepOptions,
      };
      tourInstance = new shepherdService.Tour(tourCreationOptions);
      // It's crucial that this new tour instance is managed by react-shepherd,
      // or that react-shepherd's provider is designed to work with tours created this way.
      // If ShepherdJourneyProvider expects to solely manage activeTour, this might need adjustment
      // based on react-shepherd's specific API for setting the active tour.
      // For now, we assume creating and starting it is sufficient.
    }

    if (!tourInstance) {
      console.warn('Failed to get or create a Shepherd tour instance.', shepherdContext);
      return;
    }

    // Ensure tour options are set
    // Note: Modifying tourInstance.options directly is standard for Shepherd.js
    tourInstance.options.defaultStepOptions = {
      ...(tourInstance.options.defaultStepOptions || {}),
      ...defaultStepOptions,
    };
    tourInstance.options.useModalOverlay = useModalOverlay;

    // Attach event listeners
    tourInstance.off('complete', completeTourOnboarding); // Remove first to prevent duplicates
    tourInstance.on('complete', completeTourOnboarding);
    tourInstance.off('cancel', completeTourOnboarding); // Remove first
    tourInstance.on('cancel', completeTourOnboarding);

    // Manage steps:
    // If forcing (e.g., "Resume Tour" button) or if the tour isn't active (fresh start),
    // clear existing steps and add the current `tourSteps`.
    // This ensures the tour always starts with the defined steps in these scenarios.
    if (options?.forceModalCompleted || !tourInstance.isActive()) {
      // Clear existing steps before adding new ones to prevent duplication/errors
      // Create a copy of the steps array to iterate over, as removing steps modifies the original array
      const currentStepsCopy = [...tourInstance.steps];
      for (const step of currentStepsCopy) {
        if (step.id) { // Ensure step has an ID before trying to remove
          tourInstance.removeStep(step.id);
        }
      }
      tourInstance.addSteps(tourSteps);
    } else if (tourInstance.steps.length === 0) {
      // If the tour is somehow active but has no steps (e.g., after cancellation and restart logic elsewhere)
      tourInstance.addSteps(tourSteps);
    }
    // If the tour is active and already has steps, and not forced, Shepherd's start() should resume.

    if (typeof tourInstance.start === 'function') {
      tourInstance.start();
    } else {
      console.warn('Shepherd tour instance does not have a start method.', tourInstance);
    }
  };

  return {
    startTour,
  };
};
