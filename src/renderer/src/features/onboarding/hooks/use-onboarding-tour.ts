import { useOnboardingStore } from "@shared/store/onboarding-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { ShepherdJourneyContext } from "react-shepherd";
import type { StepOptions, Tour } from "shepherd.js";

const tourSteps: StepOptions[] = [
	{
		id: "welcome",
		title: "Welcome to Local Operator!",
		text: "Local Operator is an AI agents platform that allows you to create a team of proactive AI agents that support you and help to reduce your daily workload.<br/><br/>These agents are different from simple chatbots because they can actually do things for you on your computer like create files, run code and analytics, edit images, videos, and PDFs, organize your system, and much more.<br/><br/>In this walkthrough we'll cover:<ul><li>Creating agents</li><li>Making agents do things</li><li>The canvas workspace</li><li>Customizing agents</li><li>Agent Hub for sharing and collaborating</li><li>Schedules for proactive agents</li><li>Settings for customization</li></ul>Let's explore how it works!",
		buttons: [
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "agent-list",
		attachTo: { element: '[data-tour-tag="agent-list-panel"]', on: "right" },
		title: "Your Agents",
		text: "On the left, you'll see a list of your available AI agents. You can select an agent to start a conversation or manage its settings.  Think of this as your WhatsApp chat list, but for AI agents!  There are no limits to how many agents you can have, so create as many as you need to handle all your daily tasks.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "select-agent",
		// Targets the first AgentListItemButton within the AgentsList using the new data-tour-tag
		attachTo: {
			element: '[data-tour-tag="agent-list-item-button-0"]',
			on: "right",
		},
		title: "Select an Agent",
		text: "Click on an agent to open the chat window to pull up your conversation with it.  This will show the messages that you have sent them and the responses and actions that they have taken.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="agent-list-item-button-0"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "chat-input",
		attachTo: {
			element: 'textarea[data-tour-tag="chat-input-textarea"]',
			on: "top",
		},
		title: "Ask Your Agent Anything",
		text: 'Type your request here. Agents can answer questions, perform tasks, search the web, and much more. When you create a new agent, you\'ll see suggested prompts for ideas!<br /><br />Some powerful requests that you can try:<br /><br /><ul><li>"Create a spreadsheet in my Documents folder with all the major cities in Canada."</li><li>"Search the web for the latest news on AI and make a thorough report."</li><li>Select an attachment and then "translate this document to French."</li></ul>',
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "attachments",
		attachTo: {
			element: 'button[data-tour-tag="chat-input-attach-file-button"]',
			on: "top",
		},
		title: "Attach Files to Your Message",
		text: "You can attach any files, images, or documents to your message by clicking this paperclip button, there are no limitations on the file types. Your agent can process, analyze, or translate these attachments as part of your request.<br /><br />Try attaching a PDF, image, or text file and then ask your agent to summarize, translate, or extract information from it!<br /><br />Images like PNGs, JPGs, and PDFs are natively streamed into the model context window, so they can understand them directly without needing to run any code.  Other files like Excel, Word, and CSV files are included as file paths on your device to direct the model's attention to work with them using code.  You can attach massive files like million line CSVs and have the agent work with them using code.<br /><br />You can also paste images into the chat input, and attach multiple files at once to achieve more complex tasks.  Try taking a screenshot of a website and then asking your agent to try to code it!",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "agent-capabilities",
		attachTo: { element: '[data-tour-tag="chat-header"]', on: "top" },
		title: "More Than Just Chat",
		text: 'Local Operator agents are different from simple chatbots. They can perform actions on your computer, like creating files, running code, or browsing the web, based on your instructions. You\'ll see them use "tools" like reading, writing, and executing code to get things done!  Agents have memory of the conversation, previous steps, learnings, and even store the execution variables of previous steps in code to be able to use them later in the conversation.<br /><br />Local Operator agents are extremely flexible, so they can bounce back and forth with you for simple chatting, and know when they need to embark on a work journey to get things done in multiple steps with tool use!',
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const { openCommandPalette } = useUiPreferencesStore.getState();

					openCommandPalette();
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "pre-command-palette-open-canvas",
		title: "Command Palette",
		attachTo: {
			element: '[data-tour-tag="command-palette-dialog"]',
			on: "right",
		},
		text: "Let's quickly look at another powerful feature: the Command Palette. You can open it anywhere in the app by pressing <code>Cmd+P</code> on Mac and <code>Ctrl+P</code> on Windows or Linux. This is a helpful window that you can open from anywhere in the app to be able to access agents, settings, pages, and much more using your keyboard.  It can often be faster to access sections in the app this way instead of clicking through menus.  You can type an agent's name to find the chat for that agent, and then hit Enter to open it.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const { closeCommandPalette } = useUiPreferencesStore.getState();

					closeCommandPalette();
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const { closeCommandPalette } = useUiPreferencesStore.getState();

					closeCommandPalette();
					setTimeout(() => {
						this.next();
					}, 500); // Wait for canvas and palette to open
				},
			},
		],
	},
	{
		id: "canvas-open-button",
		attachTo: {
			element: 'button[data-tour-tag="open-canvas-button"]',
			on: "left",
		},
		title: "Open the Canvas",
		text: "Click here to open the Canvas, a workspace for files and dynamic visualizations where you can organize, plan, and interact with your agents in a more flexible way.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const { openCommandPalette } = useUiPreferencesStore.getState();

					openCommandPalette();
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="open-canvas-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "canvas-feature",
		attachTo: { element: '[data-tour-tag="canvas-container"]', on: "left" },
		title: "The Canvas: Your Visual Workspace",
		text: "This is the Canvas, your workspace for files and dynamic visualizations where you can organize, plan, and interact with your agents in a more flexible way.  Any files that your agents create on your device can be opened here by clicking on the file icons that you see as they work.<br/><br/>Agents can make dynamic visualizations like games, charts, maps, and more in HTML files.  Any HTML files you open will be rendered dynamically in an iframe.  Any markdown files that you open will be rendered in full markdown viewer with support for code blocks, tables, mermaid diagrams, and more.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="close-canvas-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="canvas-documents-view-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "canvas-documents-view",
		attachTo: {
			element: 'button[data-tour-tag="canvas-documents-view-button"]',
			on: "top",
		},
		title: "Documents View",
		text: "The Documents view shows all your open markdown, code, and HTML documents as tabs. You can switch between documents and see dynamic visualizations in HTML created by your agents. Use this view to work with your notes, reports, and agent-generated content.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="canvas-files-view-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "canvas-files-view",
		attachTo: {
			element: 'button[data-tour-tag="canvas-files-view-button"]',
			on: "top",
		},
		title: "Files View",
		text: "The Files view lets you browse and open files that your agents have created or that are relevant to your current conversation. Use this to quickly access, preview, and open files in the Canvas workspace.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="canvas-documents-view-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="canvas-variables-view-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "canvas-variables-view",
		attachTo: {
			element: 'button[data-tour-tag="canvas-variables-view-button"]',
			on: "top",
		},
		title: "Variables View",
		text: 'The Variables view displays the "code memory" that agents have stored during their work. These are technical variables that include results, intermediate values, and other data that agents use to perform tasks. You can inspect and manage these variables here.<br /><br />This section will be most helpful for more technical users who want to understand how agents are working and what they are doing.',
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="canvas-files-view-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const closeButton = document.querySelector(
						'button[data-tour-tag="close-canvas-button"]',
					);
					if (closeButton) {
						(closeButton as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "agent-options",
		attachTo: {
			element: 'button[data-tour-tag="agent-options-button"]',
			on: "right",
		},
		title: "Agent Options",
		text: "Click here to see options for the currently selected agent, like viewing its settings, exporting it, or deleting it.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="open-canvas-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="agent-options-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the menu to open before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "click-view-settings-from-chat",
		// Assumes Agent Options menu is open from the previous step
		attachTo: {
			element:
				'[role="menuitem"][data-tour-tag="view-agent-settings-menu-item"]',
			on: "right",
		},
		title: "View Configuration",
		text: 'Click "View Agent Settings" to see and change how this agent works and change things like its name, description, hosting provider, and AI model.',
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[role="menuitem"][data-tour-tag="view-agent-settings-menu-item"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "view-agent-settings",
		// Targets the DetailsPaper component in AgentSettings
		attachTo: {
			element: 'div[data-tour-tag="agent-settings-details-paper"]',
			on: "left",
		},
		title: "Agent Configuration",
		text: "This is where you can customize and configure your agent. You can change its name, description, the AI model it uses, its temperature for creativity, and other chat settings.<br /><br />The agents will already have default settings that work well for most use cases, but if you want to roll up your sleeves and customize, you can do so here!",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-chat"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}

					setTimeout(() => {
						const settingsButton = document.querySelector(
							'button[data-tour-tag="agent-options-button"]',
						);
						if (settingsButton) {
							(settingsButton as HTMLButtonElement).click();
						}
					}, 500);

					// Wait for the menu to open before clicking the back button
					setTimeout(() => {
						this.back();
					}, 1000);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			}, // Will go to select-provider
		],
	},
	{
		id: "select-provider",
		attachTo: {
			element: '[data-tour-tag="agent-settings-hosting-select"]',
			on: "left",
		},
		title: "Select Hosting Provider",
		text: 'Choose an AI provider for your agent. If you don\'t pick one here, then the default provider from the Settings Page will be used.  Providers offer different AI models and pricing. Radient is recommended for Local Operator as its "Automatic" mode is optimized for the lowest cost and best performance.',
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to view-agent-settings
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			}, // Goes to select-model
		],
	},
	{
		id: "select-model",
		attachTo: {
			element: '[data-tour-tag="agent-settings-model-select"]',
			on: "left",
		},
		title: "Select AI Model",
		text: "After selecting a provider, choose an AI model. Models marked with a star (⭐) are 'Recommended' and known to work well with Local Operator. Non-starred models might have inconsistent performance. If a model you expect to be recommended isn't listed, please let us know if it works well for you in Local Operator via GitHub Issues or email.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to select-provider
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			}, // Goes to modify-security-prompt
		],
	},
	{
		id: "modify-security-prompt",
		attachTo: {
			element: '[data-tour-tag="agent-settings-security"]',
			on: "left",
		}, // Attaching to the broader "Model Settings" card as a proxy
		title: "Customize Security Behaviors",
		text: "This prompt provides separate instructions to the security agent that reviews this agent's work. You can explicitly allow certain actions that would normally be blocked. If you encounter frequent security interventions, consider adding a note here for the security agent.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to select-model
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			}, // Goes to modify-agent-prompt
		],
	},
	{
		id: "modify-agent-prompt",
		attachTo: {
			element: '[data-tour-tag="agent-settings-system-prompt"]',
			on: "left",
		},
		title: "Customize the Agent's Behavior",
		text: "This prompt allows you to customize the baseline behavior of the agent. While most customization can happen by talking to the agent (it records learnings in its notebook), you can provide specific workflow instructions here that will be followed separately.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to modify-security-prompt
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "create-new-agent",
		attachTo: {
			element: 'button[data-tour-tag="create-new-agent-button"]',
			on: "bottom",
		},
		title: "Create a New Agent",
		text: 'Click the "+" button to create a brand new agent from scratch. You can then customize its behavior and capabilities.',
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					// We are on the main page (agent list/chat). Need to go to agent settings page.
					// This assumes an agent is selected and we can navigate to its settings.
					// Attempt to click the first agent to ensure context, then options, then settings.
					const agentButton = document.querySelector(
						'[data-tour-tag="agent-list-item-button-0"]',
					);
					if (agentButton) {
						// Check if we are already on the chat page for this agent, if not, click it.
						// This logic might need refinement based on actual app state management.
						// For now, we assume clicking it is safe or sets the context.
						(agentButton as HTMLButtonElement).click();
					}

					setTimeout(() => {
						const agentOptionsButton = document.querySelector(
							'button[data-tour-tag="agent-options-button"]',
						);
						if (agentOptionsButton) {
							(agentOptionsButton as HTMLButtonElement).click();
						}
					}, 500); // Wait for agent selection/navigation

					setTimeout(() => {
						const viewSettingsMenuItem = document.querySelector(
							'[role="menuitem"][data-tour-tag="view-agent-settings-menu-item"]',
						);
						if (viewSettingsMenuItem) {
							(viewSettingsMenuItem as HTMLButtonElement).click();
						}
					}, 1000); // Wait for options menu

					setTimeout(() => {
						this.back();
					}, 1500); // Go to modify-agent-prompt (now on agent settings page)
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="create-new-agent-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 1000);
				},
			},
		],
	},
	{
		id: "agent-naming-guidelines",
		attachTo: { element: '[data-tour-tag="create-agent-dialog"]', on: "right" },
		title: "Naming and Describing Your Agent",
		text: `Give your agent a clear, descriptive name that reflects its purpose (e.g., "File Organizer" or "Web Researcher"). 
A good description helps you and others understand what the agent does and any special instructions. The descriptions are also used by other agents to help them understand how to tag each other in for certain tasks.<br /><br />If you want this agent to be part of the agent-to-agent communication network, it will need to have a description that captures its purpose and capabilities.  Be concise and specific!`,
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="create-agent-dialog-cancel-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="create-agent-dialog-cancel-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "navigate-agent-hub",
		// Targets the NavItemButton for Agent Hub via its icon's aria-label
		attachTo: { element: '[data-tour-tag="nav-item-agent-hub"]', on: "right" },
		title: "Discover More Agents",
		text: 'Let\'s visit the Agent Hub to find community-created agents. Click on the "Agent Hub" icon in the navigation bar.',
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-agents"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						const newAgentButton = document.querySelector(
							'[data-tour-tag="create-new-agent-button"]',
						);
						if (newAgentButton) {
							(newAgentButton as HTMLButtonElement).click();
						}
					}, 500);
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.back();
					}, 1000);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-agent-hub"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "agent-hub-view",
		// Targets the SidebarContainer in AgentHubPage that wraps AgentCategoriesSidebar
		attachTo: {
			element: '[data-tour-tag="agent-hub-sidebar-container"]',
			on: "right",
		},
		title: "The Agent Hub",
		text: "Here you can browse agents by category or search for specific ones. These agents are shared by the community and can perform various specialized tasks.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "download-agent",
		// Targets the first download button using its data-testid, assuming it's within the first relevant card context
		attachTo: {
			element: 'button[data-tour-tag="agent-hub-download-button"]',
			on: "bottom",
		},
		title: "Download an Agent",
		text: 'Find an agent that interests you and click the "Download" button to add it to your local agent list.',
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-agents"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 1000);
				},
			},
		],
	},
	{
		id: "upload-agent-hub",
		// Targets the "Upload to Hub" menu item, assuming the parent menu is open
		attachTo: {
			element: 'button[data-tour-tag="upload-to-hub-header-button"]',
			on: "bottom",
		},
		title: "Share Your Agents",
		text: "If you create a useful agent, you can also share it with the community by uploading it to the Hub from the Agent Options menu.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-agent-hub"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="upload-to-hub-header-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "upload-agent-hub-dialog",
		// Targets the UploadAgentDialog modal, which should be open after clicking "Upload to Hub"
		attachTo: { element: '[data-tour-tag="upload-agent-dialog"]', on: "right" },
		title: "Upload Agent to Hub",
		text: "This dialog allows you to share your agent with the community. You need to have a Radient Account to upload an agent, which is free to create and doesn't cost anything per upload.  You can review the agent details and confirm the upload. Make sure your agent meets the required criteria before submitting.  Also be aware that any conversation history and learnings for this agent will be part of its training and will be visible to the public.  So don't share agents publicly that know sensitive information!",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="upload-agent-dialog-cancel-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="upload-agent-dialog-cancel-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "navigate-schedules",
		attachTo: { element: '[data-tour-tag="nav-item-schedules"]', on: "right" },
		title: "Automate Tasks with Schedules",
		text: "Local Operator can run tasks for you on a regular basis. Let's check out the Schedules section.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-agents"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						const uploadAgentsButton = document.querySelector(
							'[data-tour-tag="upload-to-hub-header-button"]',
						);
						if (uploadAgentsButton) {
							(uploadAgentsButton as HTMLButtonElement).click();
						}
					}, 500);
					setTimeout(() => {
						this.back();
					}, 1000);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-schedules"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "schedules-overview",
		title: "Proactive Agents with Schedules",
		text: "A powerful feature of Local Operator is the ability to ask agents to perform tasks on their own on a recurring basis.  This turns them from reactive agent bots to proactive agents that work on their own in the background to support you without you needing to continually ask them to do things.<br /><br />You can simply ask any agent to do something at some point in the future, or to handle some daily task at a certain time, and it will create a prompt for itself that will be executed at the specified times.<br /><br />Here, you can view, create, and manage all your scheduled tasks in one place to streamline your workflow and ensure important actions happen automatically.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "create-schedule",
		// Targets the "Create Schedule" button within the PageHeader
		attachTo: {
			element: 'button[data-tour-tag="create-schedule-button"]',
			on: "bottom",
		},
		title: "Set Up a Recurring Task",
		text: 'Click "Create Schedule" to ask an agent to perform a task for you regularly, like sending a daily report or checking for news updates.<br /><br />You can also create one-off tasks that only run once at some point in the future.',
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'button[data-tour-tag="create-schedule-button"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "create-schedule-dialog",
		attachTo: {
			element: '[data-tour-tag="create-schedule-dialog"]',
			on: "right",
		},
		title: "Configure Your Schedule",
		text: "While it is often much easier to simply ask the agent to do a task on a recurring basis for you, you can also manually set up a schedule for a task here or update existing tasks.<br /><br />The prompt is the message that will be sent to the agent at the predefined schedule.  You can update the time of day in your local timezone, the frequency of the task, and even specify a specific date or time that the task should stop running at.<br /><br />You can also schedule one-off tasks that only run once at some point in the future.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					// Close dialog if open, then go back
					const closeButton = document.querySelector(
						'[data-tour-tag="create-schedule-dialog-cancel-button"]',
					);
					if (closeButton) {
						(closeButton as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.back();
					}, 500);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					// Optionally close dialog before moving on
					const closeButton = document.querySelector(
						'[data-tour-tag="create-schedule-dialog-cancel-button"]',
					);
					if (closeButton) {
						(closeButton as HTMLButtonElement).click();
					}
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "navigate-settings",
		attachTo: { element: '[data-tour-tag="nav-item-settings"]', on: "right" },
		title: "Personalize Your Experience",
		text: "Now, let's explore the Settings menu to customize Local Operator to your liking.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-schedules"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						const button = document.querySelector(
							'button[data-tour-tag="create-schedule-button"]',
						);
						if (button) {
							(button as HTMLButtonElement).click();
						}
					}, 500);
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.back();
					}, 1000);
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-settings"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					// Wait for the navigation to complete before clicking the next button
					setTimeout(() => {
						this.next();
					}, 500);
				},
			},
		],
	},
	{
		id: "general-settings",
		// Targets the "General Settings" item in settings sidebar via its icon
		attachTo: {
			element: 'div[data-tour-tag="settings-general-section"]',
			on: "right",
		},
		title: "General Settings",
		text: "Here you can update your user profile, configure model settings (like default hosting provider and model), and adjust history settings for conversations and learnings.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "radient-account-settings",
		attachTo: {
			element: '[data-tour-tag="settings-radient-account-section"]',
			on: "right",
		},
		title: "Radient Account",
		text: "Connect your Radient Account to access your Radient Pass details, credits, and unlock unified access to models and tools.  Radient is the best way to use Local Operator since it powers the AI models, web search, image generation, and much more with a single integration.  You get free credits when you sign up to try it out and bonus credits when you top up!<br /><br />When you sign in for the first time, it will automatically create a Radient Pass for you and save it securely to your computer.  This will power your Local Operator agents with Radient Automatic, which mixes and matches AI models to get you the best balance of speed, accuracy, and cost in every step of your agents' workflows.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "integrations-settings",
		attachTo: {
			element: '[data-tour-tag="settings-integrations-section"]',
			on: "right",
		},
		title: "Connect Your Services",
		text: "Enhance your agents' capabilities by connecting your Google services like Gmail, Calendar, and Drive. This allows agents to access and manage your information with your permission.<br /><br />You need to be logged in to a Radient account to use this feature, however it is free to use and doesn't cost any additional Radient Credits per action.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "appearance-settings",
		attachTo: {
			element: '[data-tour-tag="settings-appearance-section"]',
			on: "right",
		},
		title: "Customize Appearance",
		text: "Choose from various themes to change the look and feel of Local Operator. Find one that suits your style!",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "api-credentials-settings",
		attachTo: {
			element: '[data-tour-tag="settings-api-credentials-section"]',
			on: "right",
		},
		title: "Manage API Keys",
		text: "Configure API keys for various services and AI models here. This allows your agents to access external tools and capabilities.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "application-updates-settings",
		attachTo: {
			element: '[data-tour-tag="settings-app-updates-section"]',
			on: "right",
		},
		title: "Stay Up-to-Date",
		text: "Check for updates to Local Operator here to ensure you have the latest features and improvements. You can see your current version information below.",
		buttons: [
			{
				text: "Back",
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: "Next",
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "tour-complete",
		title: "Tour Complete!",
		text: "You've now seen the main features of Local Operator. Feel free to explore further and discover all the ways your AI agents can assist you. Happy automating!",
		buttons: [
			{
				text: "Finish",
				classes: "shepherd-button-primary",
				action: function () {
					this.complete();
				},
			},
		],
	},
];

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
