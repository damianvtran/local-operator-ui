import { useContext } from 'react';
import { ShepherdJourneyContext } from 'react-shepherd';
import type { Tour, StepOptions } from 'shepherd.js';
import { useOnboardingStore } from '@shared/store/onboarding-store';

const tourSteps: StepOptions[] = [
  {
    id: 'welcome',
    title: 'Welcome to Local Operator!',
    text: 'Local Operator is an AI agents platform that allows you to create a team of proactive AI agents that support you and help to reduce your daily workload.<br/><br/>These agents are different from simple chatbots because they can actually do things for you on your computer like create files, run code and analytics, edit images, videos, and PDFs, organize your system, and much more.<br/><br/>In this walkthrough we\'ll cover:<ul><li>Creating agents</li><li>Making agents do things</li><li>The canvas workspace</li><li>Customizing agents</li><li>Agent Hub for sharing and collaborating</li><li>Schedules for proactive agents</li><li>Settings for customization</li></ul>Let\'s explore how it works!',
    buttons: [
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'agent-list',
    attachTo: { element: '[data-tour-tag="agent-list-panel"]', on: 'right' },
    title: 'Your Agents',
    text: 'On the left, you\'ll see a list of your available AI agents. You can select an agent to start a conversation or manage its settings.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'select-agent',
    // Targets the first AgentListItemButton within the AgentsList using the new data-tour-tag
    attachTo: { element: '[data-tour-tag="agent-list-item-button-0"]', on: 'right' },
    title: 'Select an Agent',
    text: 'Click on an agent to open the chat window and start interacting with it.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { 
        const button = document.querySelector('[data-tour-tag="agent-list-item-button-0"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => { this.next(); }, 500);
      } },
    ],
  },
  {
    id: 'chat-input',
    attachTo: { element: 'textarea[data-tour-tag="chat-input-textarea"]', on: 'top' },
    title: 'Ask Your Agent Anything',
    text: 'Type your request here. Agents can answer questions, perform tasks, search the web, and much more. When you create a new agent, you\'ll see suggested prompts for ideas!<br /><br />Some powerful requests that you can try:<br /><br /><ul><li>"Create a spreadsheet in my Documents folder with all the major cities in Canada."</li><li>"Search the web for the latest news on AI and make a thorough report."</li><li>Select an attachment and then "translate this document to French."</li></ul>',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'attachments',
    attachTo: { element: 'button[data-tour-tag="chat-input-attach-file-button"]', on: 'top' },
    title: 'Attach Files to Your Message',
    text: 'You can attach any files, images, or documents to your message by clicking this paperclip button, there are no limitations on the file types. Your agent can process, analyze, or translate these attachments as part of your request.<br /><br />Try attaching a PDF, image, or text file and then ask your agent to summarize, translate, or extract information from it!<br /><br />Images like PNGs, JPGs, and PDFs are natively streamed into the model context window, so they can understand them directly without needing to run any code.  Other files like Excel, Word, and CSV files are included as file paths on your device to direct the model\'s attention to work with them using code.  You can attach massive files like million line CSVs and have the agent work with them using code.<br /><br />You can also paste images into the chat input, and attach multiple files at once to achieve more complex tasks.  Try taking a screenshot of a website and then asking your agent to try to code it!',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'agent-capabilities',
    attachTo: { element: '[data-tour-tag="chat-header"]', on: 'top' },
    title: 'More Than Just Chat',
    text: 'Local Operator agents are different from simple chatbots. They can perform actions on your computer, like creating files, running code, or browsing the web, based on your instructions. You\'ll see them use "tools" like reading, writing, and executing code to get things done!  Agents have memory of the conversation, previous steps, learnings, and even store the execution variables of previous steps in code to be able to use them later in the conversation.<br /><br />Local Operator agents are extremely flexible, so they can bounce back and forth with you for simple chatting, and know when they need to embark on a work journey to get things done in multiple steps with tool use!',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'canvas-open-button',
    attachTo: { element: 'button[data-tour-tag="open-canvas-button"]', on: 'left' },
    title: 'Open the Canvas',
    text: 'Click here to open the Canvas, a workspace for files and dynamic visualizations where you can organize, plan, and interact with your agents in a more flexible way.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { 
        text: 'Next', 
        classes: 'shepherd-button-primary', 
        action: function() { 
          const button = document.querySelector('button[data-tour-tag="open-canvas-button"]');
          if (button) {
            (button as HTMLButtonElement).click();
          }
          setTimeout(() => { this.next(); }, 500);
        } 
      },
    ],
  },
  {
    id: 'canvas-feature',
    attachTo: { element: '[data-tour-tag="canvas-container"]', on: 'left' },
    title: 'The Canvas: Your Visual Workspace',
    text: 'This is the Canvas, your workspace for files and dynamic visualizations where you can organize, plan, and interact with your agents in a more flexible way.  Any files that your agents create on your device can be opened here by clicking on the file icons that you see as they work.<br/><br/>Agents can make dynamic visualizations like games, charts, maps, and more in HTML files.  Any HTML files you open will be rendered dynamically in an iframe.  Any markdown files that you open will be rendered in full markdown viewer with support for code blocks, tables, mermaid diagrams, and more.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { 
        const button = document.querySelector('[data-tour-tag="close-canvas-button"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        setTimeout(() => { this.back(); }, 500);
      } },
      { 
        text: 'Next', 
        classes: 'shepherd-button-primary', 
        action: function() { 
          const button = document.querySelector('button[data-tour-tag="close-canvas-button"]');
          if (button) {
            (button as HTMLButtonElement).click();
          }
          setTimeout(() => { this.next(); }, 500);
        } 
      },
    ],
  },
  {
    id: 'agent-options',
    attachTo: { element: 'button[data-tour-tag="agent-options-button"]', on: 'right' },
    title: 'Agent Options',
    text: 'Click here to see options for the currently selected agent, like viewing its settings, exporting it, or deleting it.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { 
        const button = document.querySelector('button[data-tour-tag="open-canvas-button"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        setTimeout(() => { this.back(); }, 500);
      } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { 
        const button = document.querySelector('[data-tour-tag="agent-options-button"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the menu to open before clicking the next button
        setTimeout(() => {
          this.next();
        }, 500);
      } },
    ],
  },
  {
    id: 'click-view-settings-from-chat',
    // Assumes Agent Options menu is open from the previous step
    attachTo: { element: '[role="menuitem"][data-tour-tag="view-agent-settings-menu-item"]', on: 'right' },
    title: 'View Configuration',
    text: 'Click "View Agent Settings" to see and change how this agent works.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { 
        const button = document.querySelector('[role="menuitem"][data-tour-tag="view-agent-settings-menu-item"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => {
          this.next();
        }, 500);
      } },
    ],
  },
  {
    id: 'view-agent-settings',
    // Targets the DetailsPaper component in AgentSettings
    attachTo: { element: 'div[data-tour-tag="agent-settings-details-paper"]', on: 'left' },
    title: 'Agent Configuration',
    text: 'This is where you can customize and configure your agent. You can change its name, description, the AI model it uses, its temperature for creativity, and other chat settings.<br /><br />The agents will already have default settings that work well for most use cases, but if you want to roll up your sleeves and customize, you can do so here!',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { 
        const button = document.querySelector('[data-tour-tag="nav-item-chat"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }

        setTimeout(() => {
          const settingsButton = document.querySelector('button[data-tour-tag="agent-options-button"]');
          if (settingsButton) {
            (settingsButton as HTMLButtonElement).click();
          }
        }, 500);

        // Wait for the menu to open before clicking the back button
        setTimeout(() => {
          this.back();
        }, 1000);
      } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'create-new-agent',
    attachTo: { element: 'button[data-tour-tag="create-new-agent-button"]', on: 'bottom' },
    title: 'Create a New Agent',
    text: 'Click the "+" button to create a brand new agent from scratch. You can then customize its behavior and capabilities.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() {
        const button = document.querySelector('[data-tour-tag="create-new-agent-button"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => {
          this.next();
        }, 1000);
      } },
    ],
  },
  {
    id: 'agent-naming-guidelines',
    attachTo: { element: '[data-tour-tag="create-agent-dialog"]', on: 'right' },
    title: 'Naming and Describing Your Agent',
    text: `Give your agent a clear, descriptive name that reflects its purpose (e.g., "File Organizer" or "Web Researcher"). 
A good description helps you and others understand what the agent does and any special instructions. The descriptions are also used by other agents to help them understand how to tag each other in for certain tasks.<br /><br />If you want this agent to be part of the agent-to-agent communication network, it will need to have a description that captures its purpose and capabilities.  Be concise and specific!`,
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { 
        const button = document.querySelector('[data-tour-tag="create-agent-dialog-cancel-button"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => { this.back(); }, 500);
      } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { 
        const button = document.querySelector('[data-tour-tag="create-agent-dialog-cancel-button"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => { this.next(); }, 500);
      } },
    ],
  },
  {
    id: 'navigate-agent-hub',
    // Targets the NavItemButton for Agent Hub via its icon's aria-label
    attachTo: { element: '[data-tour-tag="nav-item-agent-hub"]', on: 'right' },
    title: 'Discover More Agents',
    text: 'Let\'s visit the Agent Hub to find community-created agents. Click on the "Agent Hub" icon in the navigation bar.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { 
        const button = document.querySelector('[data-tour-tag="nav-item-agents"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => { this.back(); }, 500);
      } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() {
        const button = document.querySelector('[data-tour-tag="nav-item-agent-hub"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => { this.next(); }, 500);
      } },
    ],
  },
  {
    id: 'agent-hub-view',
    // Targets the SidebarContainer in AgentHubPage that wraps AgentCategoriesSidebar
    attachTo: { element: '[data-tour-tag="agent-hub-sidebar-container"]', on: 'right' },
    title: 'The Agent Hub',
    text: 'Here you can browse agents by category or search for specific ones. These agents are shared by the community and can perform various specialized tasks.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'download-agent',
    // Targets the first download button using its data-testid, assuming it's within the first relevant card context
    attachTo: { element: 'button[data-tour-tag="agent-hub-download-button"]', on: 'bottom' },
    title: 'Download an Agent',
    text: 'Find an agent that interests you and click the "Download" button to add it to your local agent list.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { 
        const button = document.querySelector('[data-tour-tag="nav-item-agents"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        setTimeout(() => { this.next(); }, 1000);
      } },
    ],
  },
  {
    id: 'upload-agent-hub',
    // Targets the "Upload to Hub" menu item, assuming the parent menu is open
    attachTo: { element: 'button[data-tour-tag="upload-to-hub-header-button"]', on: 'bottom' },
    title: 'Share Your Agents',
    text: 'If you create a useful agent, you can also share it with the community by uploading it to the Hub from the Agent Options menu.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { 
        const button = document.querySelector('button[data-tour-tag="upload-to-hub-header-button"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        setTimeout(() => { this.next(); }, 500);
      } },
    ],
  },
  {
    id: 'upload-agent-hub-dialog',
    // Targets the UploadAgentDialog modal, which should be open after clicking "Upload to Hub"
    attachTo: { element: '[data-tour-tag="upload-agent-dialog"]', on: 'right' },
    title: 'Upload Agent to Hub',
    text: 'This dialog allows you to share your agent with the community. You can review the agent details and confirm the upload. Make sure your agent meets the required criteria before submitting.  Also be aware that any conversation history and learnings for this agent will be part of its training and will be visible to the public.  So don\'t share agents publicly that know sensitive information!',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { 
        const button = document.querySelector('button[data-tour-tag="upload-agent-dialog-cancel-button"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => { this.back(); }, 500);
      } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { 
        const button = document.querySelector('button[data-tour-tag="upload-agent-dialog-cancel-button"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => { this.next(); }, 500);
      } },
    ],
  },
  {
    id: 'navigate-schedules',
    attachTo: { element: '[data-tour-tag="nav-item-schedules"]', on: 'right' },
    title: 'Automate Tasks with Schedules',
    text: 'Local Operator can run tasks for you on a regular basis. Let\'s check out the Schedules section.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { 
        const button = document.querySelector('[data-tour-tag="nav-item-agents"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        setTimeout(() => {
          const uploadAgentsButton = document.querySelector('[data-tour-tag="upload-to-hub-header-button"]');
          if (uploadAgentsButton) {
            (uploadAgentsButton as HTMLButtonElement).click();
          }
        }, 500);
        setTimeout(() => { this.back(); }, 1000);
      } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() {
        const button = document.querySelector('[data-tour-tag="nav-item-schedules"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => { this.next(); }, 500);
      } },
    ],
  },
  {
    id: 'schedules-overview',
    title: 'Proactive Agents with Schedules',
    text: 'A powerful feature of Local Operator is the ability to ask agents to perform tasks on their own on a recurring basis.  This turns them from reactive agent bots to proactive agents that work on their own in the background to support you without you needing to continually ask them to do things.<br /><br />You can simply ask any agent to do something at some point in the future, or to handle some daily task at a certain time, and it will create a prompt for itself that will be executed at the specified times.<br /><br />Here, you can view, create, and manage all your scheduled tasks in one place to streamline your workflow and ensure important actions happen automatically.',
    buttons: [
      {
        text: 'Back',
        classes: 'shepherd-button-secondary',
        action: function() {
          this.back();
        }
      },
      {
        text: 'Next',
        classes: 'shepherd-button-primary',
        action: function() {
          this.next();
        }
      }
    ],
  },
  {
    id: 'create-schedule',
    // Targets the "Create Schedule" button within the PageHeader
    attachTo: { element: 'button[data-tour-tag="create-schedule-button"]', on: 'bottom' },
    title: 'Set Up a Recurring Task',
    text: 'Click "Create Schedule" to ask an agent to perform a task for you regularly, like sending a daily report or checking for news updates.<br /><br />You can also create one-off tasks that only run once at some point in the future.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { 
        this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { 
        const button = document.querySelector('button[data-tour-tag="create-schedule-button"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        setTimeout(() => { this.next(); }, 500);
      } },
    ],
  },
  {
    id: 'create-schedule-dialog',
    attachTo: { element: '[data-tour-tag="create-schedule-dialog"]', on: 'right' },
    title: 'Configure Your Schedule',
    text: 'While it is often much easier to simply ask the agent to do a task on a recurring basis for you, you can also manually set up a schedule for a task here or update existing tasks.<br /><br />The prompt is the message that will be sent to the agent at the predefined schedule.  You can update the time of day in your local timezone, the frequency of the task, and even specify a specific date or time that the task should stop running at.<br /><br />You can also schedule one-off tasks that only run once at some point in the future.',
    buttons: [
      { 
        text: 'Back', 
        classes: 'shepherd-button-secondary', 
        action: function() { 
          // Close dialog if open, then go back
          const closeButton = document.querySelector(
            '[data-tour-tag="create-schedule-dialog-cancel-button"]'
          );
          if (closeButton) {
            (closeButton as HTMLButtonElement).click();
          }
          setTimeout(() => { this.back(); }, 500);
        } 
      },
      { 
        text: 'Next', 
        classes: 'shepherd-button-primary', 
        action: function() { 
          // Optionally close dialog before moving on
          const closeButton = document.querySelector(
            '[data-tour-tag="create-schedule-dialog-cancel-button"]'
          );
          if (closeButton) {
            (closeButton as HTMLButtonElement).click();
          }
          setTimeout(() => { this.next(); }, 500);
        } 
      },
    ],
  },
  {
    id: 'navigate-settings',
    attachTo: { element: '[data-tour-tag="nav-item-settings"]', on: 'right' },
    title: 'Personalize Your Experience',
    text: 'Now, let\'s explore the Settings menu to customize Local Operator to your liking.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { 
        const button = document.querySelector('[data-tour-tag="nav-item-schedules"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => { this.back(); }, 500);
      } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() {
        const button = document.querySelector('[data-tour-tag="nav-item-settings"]');
        if (button) {
          (button as HTMLButtonElement).click();
        }
        // Wait for the navigation to complete before clicking the next button
        setTimeout(() => { this.next(); }, 500);
      } },
    ],
  },
  {
    id: 'general-settings',
    // Targets the "General Settings" item in settings sidebar via its icon
    attachTo: { element: 'div[data-tour-tag="settings-general-section"]', on: 'right' },
    title: 'General Settings',
    text: 'Here you can update your user profile, configure model settings (like default hosting provider and model), and adjust history settings for conversations and learnings.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'radient-account-settings',
    attachTo: { element: '[data-tour-tag="settings-radient-account-section"]', on: 'right' },
    title: 'Radient Account',
    text: 'Connect your Radient Account to access your Radient Pass details, credits, and unlock unified access to models and tools.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'integrations-settings',
    attachTo: { element: '[data-tour-tag="settings-integrations-section"]', on: 'right' },
    title: 'Connect Your Services',
    text: 'Enhance your agents\' capabilities by connecting your Google services like Gmail, Calendar, and Drive. This allows agents to access and manage your information with your permission.<br /><br />You need to be logged in to a Radient account to use this feature, however it is free to use and doesn\'t cost any additional Radient Credits per action.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'appearance-settings',
    attachTo: { element: '[data-tour-tag="settings-appearance-section"]', on: 'right' },
    title: 'Customize Appearance',
    text: 'Choose from various themes to change the look and feel of Local Operator. Find one that suits your style!',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'api-credentials-settings',
    attachTo: { element: '[data-tour-tag="settings-api-credentials-section"]', on: 'right' },
    title: 'Manage API Keys',
    text: 'Configure API keys for various services and AI models here. This allows your agents to access external tools and capabilities.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'application-updates-settings',
    attachTo: { element: '[data-tour-tag="settings-app-updates-section"]', on: 'right' },
    title: 'Stay Up-to-Date',
    text: 'Check for updates to Local Operator here to ensure you have the latest features and improvements. You can see your current version information below.',
    buttons: [
      { text: 'Back', classes: 'shepherd-button-secondary', action: function() { this.back(); } },
      { text: 'Next', classes: 'shepherd-button-primary', action: function() { this.next(); } },
    ],
  },
  {
    id: 'tour-complete',
    title: 'Tour Complete!',
    text: 'You\'ve now seen the main features of Local Operator. Feel free to explore further and discover all the ways your AI agents can assist you. Happy automating!',
    buttons: [
      { text: 'Finish', classes: 'shepherd-button-primary', action: function() { this.complete(); } },
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
