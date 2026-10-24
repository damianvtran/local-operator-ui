import tourAgenticSequenceImage from "@assets/images/tour/agentic-sequence.png";
import tourCanvasCodeInlineEditImage from "@assets/images/tour/canvas-code-inline-edit.png";
import tourCanvasOverviewImage from "@assets/images/tour/canvas-overview.png";
import tourCanvasVariablesImage from "@assets/images/tour/canvas-variables-view.png";
import tourChatAttachmentsImage from "@assets/images/tour/chat-attachments.png";
import tourChatFullViewImage from "@assets/images/tour/chat-full-view.png";
import tourChatInputImage from "@assets/images/tour/chat-input.png";
import tourInlineEditCanvasImage from "@assets/images/tour/inline-edit-canvas.png";
import { paletteDoorLabel } from "@features/command-palette/palette-shortcut";
import { t } from "@shared/i18n";
import { useOnboardingStore } from "@shared/store/onboarding-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { ShepherdJourneyContext } from "react-shepherd";
import type { StepOptions, Tour } from "shepherd.js";

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

// Build at tour start: module-scope messages freeze the bootstrap locale and a
// live language switch would otherwise leave Shepherd holding the old catalogue.
export const createTourSteps = (): StepOptions[] => [
	{
		id: "welcome",
		title: t("ui.onboarding.tour.welcome.title"),
		text: t("ui.onboarding.tour.welcome.body", {
			chat_full_view_image: `<img src="${tourChatFullViewImage}" alt="${t("ui.onboarding.tour.alt.welcome")}" style="width: 100%; height: 350px; object-fit: contain; border-radius: 8px;"/>`,
		}),
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
		text: t("ui.onboarding.tour.agent_list.body"),
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
		text: t("ui.onboarding.tour.select_agent.body"),
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
		text: t("ui.onboarding.tour.chat_input.body", {
			chat_input_image: `<img src="${tourChatInputImage}" alt="${t("ui.onboarding.tour.alt.chat_input")}" style="width: 100%; height: 200px; object-fit: contain; border-radius: 8px;"/>`,
		}),
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
		text: t("ui.onboarding.tour.attachments.body", {
			chat_attachments_image: `<img src="${tourChatAttachmentsImage}" alt="${t("ui.onboarding.tour.alt.attachments")}" style="width: 100%; height: 200px; object-fit: contain; border-radius: 8px;"/>`,
		}),
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
		text: t("ui.onboarding.tour.agent_capabilities.body", {
			agentic_sequence_image: `<img src="${tourAgenticSequenceImage}" alt="${t("ui.onboarding.tour.alt.agent_capabilities")}" style="width: 100%; height: 350px; object-fit: contain; border-radius: 8px;"/>`,
		}),
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
		text: t("ui.onboarding.tour.pre_command_palette_open_canvas.body", {
			everything_mac: paletteDoorLabel("everything", true),
			everything_windows: paletteDoorLabel("everything", false),
			chats_mac: paletteDoorLabel("chats", true),
			chats_windows: paletteDoorLabel("chats", false),
			commands_mac: paletteDoorLabel("commands", true),
			commands_windows: paletteDoorLabel("commands", false),
		}),
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
		text: t("ui.onboarding.tour.canvas_open_button.body"),
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
		text: t("ui.onboarding.tour.canvas_feature.body", {
			canvas_overview_image: `<img src="${tourCanvasOverviewImage}" alt="${t("ui.onboarding.tour.alt.canvas_feature")}" style="width: 100%; height: 300px; object-fit: contain; border-radius: 8px;"/>`,
		}),
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
		text: t("ui.onboarding.tour.canvas_documents_view.body", {
			inline_edit_canvas_image: `<img src="${tourInlineEditCanvasImage}" alt="${t("ui.onboarding.tour.alt.canvas_documents_view")}" style="width: 100%; height: 200px; object-fit: contain; border-radius: 8px;"/>`,
			canvas_code_inline_edit_image: `<img src="${tourCanvasCodeInlineEditImage}" alt="${t("ui.onboarding.tour.alt.canvas_documents_view")}" style="width: 100%; height: 200px; object-fit: cover; object-position: top; border-radius: 8px;"/>`,
		}),
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
		text: t("ui.onboarding.tour.canvas_files_view.body"),
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
		text: t("ui.onboarding.tour.canvas_variables_view.body", {
			canvas_variables_image: `<img src="${tourCanvasVariablesImage}" alt="${t("ui.onboarding.tour.alt.canvas_variables_view")}" style="width: 100%; height: 350px; object-fit: contain; border-radius: 8px;"/>`,
		}),
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
		text: t("ui.onboarding.tour.agent_options.body"),
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
		text: t("ui.onboarding.tour.click_view_settings_from_chat.body"),
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
		text: t("ui.onboarding.tour.view_agent_settings.body"),
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
		text: t("ui.onboarding.tour.select_provider.body"),
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
		text: t("ui.onboarding.tour.select_model.body"),
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
		text: t("ui.onboarding.tour.modify_security_prompt.body"),
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
		text: t("ui.onboarding.tour.modify_agent_prompt.body"),
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
		text: t("ui.onboarding.tour.create_new_agent.body"),
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
		text: t("ui.onboarding.tour.agent_naming_guidelines.body"),
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
		text: t("ui.onboarding.tour.navigate_agent_hub.body"),
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
		text: t("ui.onboarding.tour.agent_hub_view.body"),
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
		text: t("ui.onboarding.tour.download_agent.body"),
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
		text: t("ui.onboarding.tour.upload_agent_hub.body"),
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
		text: t("ui.onboarding.tour.upload_agent_hub_dialog.body"),
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
		text: t("ui.onboarding.tour.navigate_schedules.body"),
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
		text: t("ui.onboarding.tour.schedules_overview.body"),
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
		text: t("ui.onboarding.tour.create_schedule.body"),
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
		text: t("ui.onboarding.tour.create_schedule_dialog.body"),
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
		text: t("ui.onboarding.tour.navigate_settings.body"),
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
		text: t("ui.onboarding.tour.general_settings.body"),
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
		text: t("ui.onboarding.tour.appearance_settings.body"),
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
		text: t("ui.onboarding.tour.radient_account_settings.body"),
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
		text: t("ui.onboarding.tour.integrations_settings.body"),
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
		text: t("ui.onboarding.tour.application_updates_settings.body"),
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
		text: t("ui.onboarding.tour.tour_complete.body"),
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
