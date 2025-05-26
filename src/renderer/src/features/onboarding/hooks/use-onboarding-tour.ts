import { useContext } from 'react';
import { ShepherdJourneyContext } from 'react-shepherd';
import type { Tour, StepOptions } from 'shepherd.js';
import { useOnboardingStore } from '@shared/store/onboarding-store';

const tourSteps: StepOptions[] = [
  {
    id: 'welcome',
    title: 'Welcome to Local Operator!',
    text: 'Local Operator helps you get things done with AI agents that can do things for you on your computer and use the internet. Let\'s explore how it works!',
    buttons: [{ text: 'Next' }],
  },
  {
    id: 'agent-list',
    attachTo: { element: '.agent-list-panel', on: 'right' },
    title: 'Your Agents',
    text: 'On the left, you\'ll see a list of your available AI agents. You can select an agent to start a conversation or manage its settings.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'select-agent',
    attachTo: { element: '.agent-list-item:first-child', on: 'right' },
    title: 'Select an Agent',
    text: 'Click on an agent to open the chat window and start interacting with it.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'chat-input',
    attachTo: { element: 'textarea[placeholder="Ask me for help"]', on: 'top' },
    title: 'Ask Your Agent Anything',
    text: 'Type your request here. Agents can answer questions, perform tasks, search the web, and much more. Notice the suggested prompts above for ideas!',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'agent-capabilities',
    attachTo: { element: '.chat-utilities-button', on: 'top' },
    title: 'More Than Just Chat',
    text: 'Local Operator agents are different from simple chatbots. They can perform actions on your computer, like creating files, running code, or browsing the web, based on your instructions. You\'ll see them use "tools" to get things done!',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'agent-options',
    attachTo: { element: 'button[aria-label="Agent Options"]', on: 'bottom' },
    title: 'Agent Options',
    text: 'Click here to see options for the currently selected agent, like viewing its settings, exporting it, or deleting it.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'view-agent-settings',
    attachTo: { element: '.agent-management-view', on: 'left' },
    title: 'Agent Configuration',
    text: 'This is where you can configure your agent. You can change its name, description, the AI model it uses, its temperature for creativity, and other chat settings.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'create-new-agent',
    attachTo: { element: 'button[aria-label="New Agent"]', on: 'bottom' },
    title: 'Create a New Agent',
    text: 'Click the "+" button to create a brand new agent from scratch. You can then customize its behavior and capabilities.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'navigate-agent-hub',
    attachTo: { element: 'nav a[href="/agent-hub"]', on: 'right' },
    title: 'Discover More Agents',
    text: 'Let\'s visit the Agent Hub to find community-created agents. Click on the "Agent Hub" icon in the navigation bar.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'agent-hub-view',
    attachTo: { element: '.agent-hub-categories', on: 'right' },
    title: 'The Agent Hub',
    text: 'Here you can browse agents by category or search for specific ones. These agents are shared by the community and can perform various specialized tasks.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'download-agent',
    attachTo: { element: '.agent-card .download-button:first-of-type', on: 'bottom' },
    title: 'Download an Agent',
    text: 'Find an agent that interests you and click the "Download" button to add it to your local agent list.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'upload-agent-hub',
    attachTo: { element: 'button[title="Upload to Hub"]', on: 'bottom' },
    title: 'Share Your Agents (Optional)',
    text: 'If you create a useful agent, you can also share it with the community by uploading it to the Hub from the Agent Options menu.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'navigate-schedules',
    attachTo: { element: 'nav a[href="/schedules"]', on: 'right' },
    title: 'Automate Tasks with Schedules',
    text: 'Local Operator can run tasks for you on a regular basis. Let\'s check out the Schedules section.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'create-schedule',
    attachTo: { element: 'button:contains("Create Schedule")', on: 'bottom' },
    title: 'Set Up a Recurring Task',
    text: 'Click "Create Schedule" to ask an agent to perform a task for you regularly, like sending a daily report or checking for news updates.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'navigate-settings',
    attachTo: { element: 'nav a[href="/settings"]', on: 'right' },
    title: 'Personalize Your Experience',
    text: 'Now, let\'s explore the Settings menu to customize Local Operator to your liking.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'general-settings',
    attachTo: { element: '.settings-navigation a:contains("General Settings")', on: 'right' },
    title: 'General Settings',
    text: 'Here you can update your user profile, configure model settings (like default hosting provider and model), and adjust history settings for conversations and learnings.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'radient-account-settings',
    attachTo: { element: '.settings-navigation a:contains("Radient Account")', on: 'right' },
    title: 'Radient Account',
    text: 'Connect your Radient Account to access your Radient Pass details, credits, and unlock unified access to models and tools.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'integrations-settings',
    attachTo: { element: '.settings-navigation a:contains("Integrations")', on: 'right' },
    title: 'Connect Your Services',
    text: 'Enhance your agents\' capabilities by connecting your Google services like Gmail, Calendar, and Drive. This allows agents to access and manage your information with your permission.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'appearance-settings',
    attachTo: { element: '.settings-navigation a:contains("Appearance")', on: 'right' },
    title: 'Customize Appearance',
    text: 'Choose from various themes to change the look and feel of Local Operator. Find one that suits your style!',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'api-credentials-settings',
    attachTo: { element: '.settings-navigation a:contains("API Credentials")', on: 'right' },
    title: 'Manage API Keys',
    text: 'Configure API keys for various services and AI models here. This allows your agents to access external tools and capabilities.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'application-updates-settings',
    attachTo: { element: '.settings-navigation a:contains("Application Updates")', on: 'right' },
    title: 'Stay Up-to-Date',
    text: 'Check for updates to Local Operator here to ensure you have the latest features and improvements. You can see your current version information below.',
    buttons: [{ text: 'Back' }, { text: 'Next' }],
  },
  {
    id: 'tour-complete',
    title: 'Tour Complete!',
    text: 'You\'ve now seen the main features of Local Operator. Feel free to explore further and discover all the ways your AI agents can assist you. Happy automating!',
    buttons: [{ text: 'Finish' }], // Shepherd should infer 'complete' action for the last step's button
  },
];

export const useOnboardingTour = () => {
  const { completeOnboarding } = useOnboardingStore();
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

  const startTour = () => {
    // Try to access the tour instance. It might be shepherdContext.tour or shepherdContext itself.
    const tourInstance: Tour | undefined = shepherdContext?.tour || shepherdContext;

    if (tourInstance && typeof tourInstance.start === 'function') {
      if (tourInstance.options) {
        tourInstance.options.defaultStepOptions = {
          ...(tourInstance.options.defaultStepOptions || {}),
          ...defaultStepOptions,
        };
        tourInstance.options.useModalOverlay = useModalOverlay;
      } else {
        console.warn('Shepherd tour.options not available for modification. Tour options might not be applied.');
      }

      tourInstance.off('complete', completeOnboarding);
      tourInstance.on('complete', completeOnboarding);

      tourInstance.off('cancel', completeOnboarding);
      tourInstance.on('cancel', completeOnboarding);

      if (tourInstance.steps.length === 0) {
        tourInstance.addSteps(tourSteps);
      }
      
      tourInstance.start();
    } else {
      console.warn(
        'Shepherd tour instance or start method not available on context.',
        shepherdContext,
      );
    }
  };

  return {
    startTour,
  };
};
