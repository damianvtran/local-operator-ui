import { t } from "@shared/i18n";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { StepOptions } from "shepherd.js";
import { TOUR_BODIES, renderTourBody } from "./tour-copy";

/**
 * The element carrying a tour tag that the user can actually see.
 *
 * Two controls can carry the same tag when a surface collapses responsively -
 * the agents header renders either its three buttons or a single overflow
 * trigger, never both - so a plain `querySelector` can return the hidden one
 * and leave the spotlight attached to a `display:none` element. `offsetParent`
 * is null for exactly that case, which is what the collapse uses.
 */
const visibleTourTarget = (tag: string): HTMLElement | null => {
	const carriers = Array.from(
		document.querySelectorAll<HTMLElement>(`[data-tour-tag="${tag}"]`),
	);
	return carriers.find((el) => el.offsetParent !== null) ?? carriers[0] ?? null;
};

/**
 * Press the control that performs a tour action, visible or not.
 *
 * Separate from `visibleTourTarget` because the two questions have different
 * answers when a surface collapses: the agents header shows either its wide
 * "Upload to hub" button or an overflow trigger, and only the wide one opens
 * the dialog - the trigger just opens a menu. The spotlight must follow what
 * the user can see; the action must follow what does the work. `click()` does
 * not require visibility, so pressing the hidden carrier is legitimate and is
 * what the tour did before it had two carriers to choose between.
 */
const pressTourAction = (action: string): void => {
	document
		.querySelector<HTMLElement>(`[data-tour-action="${action}"]`)
		?.click();
};

/**
 * Build the walkthrough's steps in the active language.
 *
 * WHY THIS IS A FACTORY, NOT A MODULE-SCOPE ARRAY. `t()` resolves at call
 * time; a module-scope array would freeze the first language the module was
 * imported in and never follow a language switch. `startTour` calls this while
 * starting, so every tour opens in the language current at that moment.
 *
 * The copy and body structure live in `./tour-copy`; this module owns the
 * mechanics — spotlights, navigation, and the action each step's buttons run.
 */
export const createTourSteps = (): StepOptions[] => [
	{
		id: "welcome",
		title: t("ui.onboarding.tour.welcome.title"),
		text: renderTourBody(TOUR_BODIES.welcome),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.agent_list.title"),
		text: renderTourBody(TOUR_BODIES.agent_list),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.select_agent.title"),
		text: renderTourBody(TOUR_BODIES.select_agent),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
			element: '[data-tour-tag="chat-input-textarea"]',
			on: "top",
		},
		title: t("ui.onboarding.tour.chat_input.title"),
		text: renderTourBody(TOUR_BODIES.chat_input),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.attachments.title"),
		text: renderTourBody(TOUR_BODIES.attachments),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.agent_capabilities.title"),
		text: renderTourBody(TOUR_BODIES.agent_capabilities),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.pre_command_palette_open_canvas.title"),
		attachTo: {
			element: '[data-tour-tag="command-palette-dialog"]',
			on: "right",
		},
		text: renderTourBody(TOUR_BODIES.pre_command_palette_open_canvas),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.canvas_open_button.title"),
		text: renderTourBody(TOUR_BODIES.canvas_open_button),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.canvas_feature.title"),
		text: renderTourBody(TOUR_BODIES.canvas_feature),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.canvas_documents_view.title"),
		text: renderTourBody(TOUR_BODIES.canvas_documents_view),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.canvas_files_view.title"),
		text: renderTourBody(TOUR_BODIES.canvas_files_view),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.canvas_variables_view.title"),
		text: renderTourBody(TOUR_BODIES.canvas_variables_view),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.agent_options.title"),
		text: renderTourBody(TOUR_BODIES.agent_options),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.click_view_settings_from_chat.title"),
		text: renderTourBody(TOUR_BODIES.click_view_settings_from_chat),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.view_agent_settings.title"),
		text: renderTourBody(TOUR_BODIES.view_agent_settings),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.select_provider.title"),
		text: renderTourBody(TOUR_BODIES.select_provider),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to view-agent-settings
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.select_model.title"),
		text: renderTourBody(TOUR_BODIES.select_model),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to select-provider
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.modify_security_prompt.title"),
		text: renderTourBody(TOUR_BODIES.modify_security_prompt),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to select-model
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.modify_agent_prompt.title"),
		text: renderTourBody(TOUR_BODIES.modify_agent_prompt),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			}, // Goes to modify-security-prompt
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.create_new_agent.title"),
		text: renderTourBody(TOUR_BODIES.create_new_agent),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.agent_naming_guidelines.title"),
		text: renderTourBody(TOUR_BODIES.agent_naming_guidelines),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.navigate_agent_hub.title"),
		text: renderTourBody(TOUR_BODIES.navigate_agent_hub),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.agent_hub_view.title"),
		text: renderTourBody(TOUR_BODIES.agent_hub_view),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.download_agent.title"),
		text: renderTourBody(TOUR_BODIES.download_agent),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
			element: () => visibleTourTarget("upload-to-hub-header-button"),
			on: "bottom",
		},
		title: t("ui.onboarding.tour.upload_agent_hub.title"),
		text: renderTourBody(TOUR_BODIES.upload_agent_hub),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					pressTourAction("open-upload-dialog");
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
		title: t("ui.onboarding.tour.upload_agent_hub_dialog.title"),
		/*
		 * The same correction the dialog itself carries: this step used to
		 * promise that "any conversation history and learnings for this agent
		 * will be part of its training and will be visible to the public",
		 * which stopped being true when the publish path started shipping an
		 * instruction set and nothing else. Two surfaces describing one
		 * publication cannot disagree about what leaves the machine, and the
		 * wrong one here was the more alarming of the two.
		 */
		text: renderTourBody(TOUR_BODIES.upload_agent_hub_dialog),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.navigate_schedules.title"),
		text: renderTourBody(TOUR_BODIES.navigate_schedules),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					const button = document.querySelector(
						'[data-tour-tag="nav-item-agents"]',
					);
					if (button) {
						(button as HTMLButtonElement).click();
					}
					setTimeout(() => {
						pressTourAction("open-upload-dialog");
					}, 500);
					setTimeout(() => {
						this.back();
					}, 1000);
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.schedules_overview.title"),
		text: renderTourBody(TOUR_BODIES.schedules_overview),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.create_schedule.title"),
		text: renderTourBody(TOUR_BODIES.create_schedule),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.create_schedule_dialog.title"),
		text: renderTourBody(TOUR_BODIES.create_schedule_dialog),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.navigate_settings.title"),
		text: renderTourBody(TOUR_BODIES.navigate_settings),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
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
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.general_settings.title"),
		text: renderTourBody(TOUR_BODIES.general_settings),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.appearance_settings.title"),
		text: renderTourBody(TOUR_BODIES.appearance_settings),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.radient_account_settings.title"),
		text: renderTourBody(TOUR_BODIES.radient_account_settings),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.integrations_settings.title"),
		text: renderTourBody(TOUR_BODIES.integrations_settings),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
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
		title: t("ui.onboarding.tour.application_updates_settings.title"),
		text: renderTourBody(TOUR_BODIES.application_updates_settings),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.back"),
				classes: "shepherd-button-secondary",
				action: function () {
					this.back();
				},
			},
			{
				text: t("ui.onboarding.tour.action.next"),
				classes: "shepherd-button-primary",
				action: function () {
					this.next();
				},
			},
		],
	},
	{
		id: "tour-complete",
		title: t("ui.onboarding.tour.tour_complete.title"),
		text: renderTourBody(TOUR_BODIES.tour_complete),
		buttons: [
			{
				text: t("ui.onboarding.tour.action.finish"),
				classes: "shepherd-button-primary",
				action: function () {
					this.complete();
				},
			},
		],
	},
];
