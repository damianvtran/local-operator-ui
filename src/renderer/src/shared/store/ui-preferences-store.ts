/**
 * Store for managing UI preferences
 *
 * This store keeps track of user interface preferences such as sidebar collapse state,
 * theme selection, and provides methods to update these preferences.
 */

import { DEFAULT_THEME } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Type definition for the UI preferences store state
 */
type UiPreferencesState = {
	/**
	 * Whether the command palette is open
	 */
	isCommandPaletteOpen: boolean;

	/**
	 * The current query in the command palette
	 */
	commandPaletteQuery: string;

	/**
	 * Opens the command palette
	 */
	openCommandPalette: () => void;

	/**
	 * Closes the command palette
	 */
	closeCommandPalette: () => void;

	/**
	 * Toggles the command palette visibility
	 */
	toggleCommandPalette: () => void;

	/**
	 * Sets the command palette query
	 * @param query - The query string
	 */
	setCommandPaletteQuery: (query: string) => void;

	/**
	 * Whether the canvas is open (global, not per conversation)
	 */
	isCanvasOpen: boolean;

	/**
	 * Set the canvas open state
	 *
	 * Opening the canvas CLOSES the run panel. See `setRunPanelOpen` for why the
	 * pair is excluded by construction rather than by one union field.
	 *
	 * @param open - Whether the canvas should be open
	 */
	setCanvasOpen: (open: boolean) => void;

	/**
	 * Whether the run panel is open (global, not per conversation)
	 *
	 * Global and persisted for the same reason `isCanvasOpen` is: the pane is a
	 * property of the window's right slot rather than of one conversation, so
	 * switching conversations keeps it open on the new session's data. What is
	 * NOT global is the reader's open child, which belongs to one session's
	 * lineage and is therefore the panel component's own state.
	 */
	isRunPanelOpen: boolean;

	/**
	 * Set the run panel open state
	 *
	 * One right pane at a time: opening the run panel closes the canvas. The two
	 * states are separate booleans whose SETTERS own the exclusion, rather than
	 * one `rightPane: "canvas" | "run" | null` field, because `setCanvasOpen(true)`
	 * is called from eleven sites that mean "show me this file" and a union field
	 * would churn all of them for no behavioural gain.
	 *
	 * @param open - Whether the run panel should be open
	 */
	setRunPanelOpen: (open: boolean) => void;

	/**
	 * The width of the run panel in pixels.
	 *
	 * 420 rather than the canvas's 800: a roster plus a prose transcript does not
	 * need a document pane's room, and 420 is wide enough for the roster's fixed
	 * segments plus the row's hover ground and the wider activity line.
	 */
	runPanelWidth: number;

	/**
	 * Set the width of the run panel
	 * @param width - The new width in pixels
	 */
	setRunPanelWidth: (width: number) => void;

	/**
	 * Restore the run panel width to its default value
	 */
	restoreDefaultRunPanelWidth: () => void;

	/**
	 * Whether the create agent dialog is open
	 */
	isCreateAgentDialogOpen: boolean;

	/**
	 * Opens the create agent dialog
	 */
	openCreateAgentDialog: () => void;

	/**
	 * Closes the create agent dialog
	 */
	closeCreateAgentDialog: () => void;

	/**
	 * Whether the navigation sidebar is collapsed
	 */
	isSidebarCollapsed: boolean;

	/**
	 * Whether agent reasoning (thinking, plan and reflection turns) is shown.
	 *
	 * Default false per docs/branding.md § 7: reasoning is the agent talking to
	 * itself, and rendering it at prose weight is what makes the app read as a
	 * developer tool. When false, reasoning turns are hidden entirely — a
	 * collapsed "Reasoning" disclosure would still be chrome on every turn,
	 * which is the weight this preference exists to remove.
	 */
	showAgentReasoning: boolean;

	/**
	 * Set whether agent reasoning is shown.
	 *
	 * Written only by the Appearance switch in `settings-page.tsx`. That is the
	 * preference's sole control, and for a while it did not exist: the flag, the
	 * grouping rule that honours it and the disclosure that renders it all
	 * shipped with nothing able to turn them on, so `AgentReasoning` returned
	 * null unconditionally and the whole feature was dead in the product while
	 * looking alive in the source. Keep a control reachable, or delete the rest.
	 *
	 * @param show - Whether reasoning turns should be visible
	 */
	setShowAgentReasoning: (show: boolean) => void;

	/**
	 * The currently selected theme
	 */
	themeName: ThemeName;

	/**
	 * The width of the canvas area in pixels
	 */
	canvasWidth: number;

	/**
	 * The width of the chat sidebar in pixels
	 */
	chatSidebarWidth: number;

	/**
	 * Toggle the sidebar collapse state
	 */
	toggleSidebar: () => void;

	/**
	 * Set the sidebar collapse state
	 * @param collapsed - Whether the sidebar should be collapsed
	 */
	setSidebarCollapsed: (collapsed: boolean) => void;

	/**
	 * Set the current theme
	 * @param themeName - The name of the theme to set
	 */
	setTheme: (themeName: ThemeName) => void;

	/**
	 * Set the width of the canvas area
	 * @param width - The new width in pixels
	 */
	setCanvasWidth: (width: number) => void;

	/**
	 * Set the width of the chat sidebar
	 * @param width - The new width in pixels
	 */
	setChatSidebarWidth: (width: number) => void;

	/**
	 * Restore the canvas width to its default value
	 */
	restoreDefaultCanvasWidth: () => void;

	/**
	 * Restore the chat sidebar width to its default value
	 */
	restoreDefaultChatSidebarWidth: () => void;
};

/**
 * Store for managing UI preferences
 *
 * Uses zustand's persist middleware to save the state to localStorage
 */
/**
 * Default values for canvas and chat sidebar widths
 */
const DEFAULT_CANVAS_WIDTH = 800;
const DEFAULT_CHAT_SIDEBAR_WIDTH = 280;
const DEFAULT_RUN_PANEL_WIDTH = 420;

export const useUiPreferencesStore = create<UiPreferencesState>()(
	persist(
		(set) => ({
			isCommandPaletteOpen: false,
			commandPaletteQuery: "",
			isSidebarCollapsed: false,
			showAgentReasoning: false,
			themeName: DEFAULT_THEME,
			canvasWidth: DEFAULT_CANVAS_WIDTH,
			chatSidebarWidth: DEFAULT_CHAT_SIDEBAR_WIDTH,
			isCanvasOpen: false,
			isRunPanelOpen: false,
			runPanelWidth: DEFAULT_RUN_PANEL_WIDTH,
			isCreateAgentDialogOpen: false,

			openCreateAgentDialog: () => {
				set({ isCreateAgentDialogOpen: true });
			},

			closeCreateAgentDialog: () => {
				set({ isCreateAgentDialogOpen: false });
			},

			openCommandPalette: () => {
				set({ isCommandPaletteOpen: true });
			},

			closeCommandPalette: () => {
				set({ isCommandPaletteOpen: false, commandPaletteQuery: "" });
			},

			toggleCommandPalette: () => {
				set((state) => ({
					isCommandPaletteOpen: !state.isCommandPaletteOpen,
					commandPaletteQuery: !state.isCommandPaletteOpen
						? ""
						: state.commandPaletteQuery, // Clear query if opening, retain if closing (though it's cleared by closeCommandPalette)
				}));
			},

			setCommandPaletteQuery: (query: string) => {
				set({ commandPaletteQuery: query });
			},

			toggleSidebar: () => {
				set((state) => ({
					isSidebarCollapsed: !state.isSidebarCollapsed,
				}));
			},

			setSidebarCollapsed: (collapsed: boolean) => {
				set({
					isSidebarCollapsed: collapsed,
				});
			},

			setShowAgentReasoning: (show: boolean) => {
				set({
					showAgentReasoning: show,
				});
			},

			setTheme: (themeName: ThemeName) => {
				set({
					themeName,
				});
			},

			setCanvasOpen: (open: boolean) => {
				set(
					open
						? { isCanvasOpen: true, isRunPanelOpen: false }
						: { isCanvasOpen: false },
				);
			},

			setRunPanelOpen: (open: boolean) => {
				set(
					open
						? { isRunPanelOpen: true, isCanvasOpen: false }
						: { isRunPanelOpen: false },
				);
			},

			setRunPanelWidth: (width: number) => {
				set({
					runPanelWidth: width,
				});
			},

			restoreDefaultRunPanelWidth: () => {
				set({
					runPanelWidth: DEFAULT_RUN_PANEL_WIDTH,
				});
			},

			setCanvasWidth: (width: number) => {
				set({
					canvasWidth: width,
				});
			},

			setChatSidebarWidth: (width: number) => {
				set({
					chatSidebarWidth: Math.min(360, Math.max(240, width)),
				});
			},

			restoreDefaultCanvasWidth: () => {
				set({
					canvasWidth: DEFAULT_CANVAS_WIDTH,
				});
			},

			restoreDefaultChatSidebarWidth: () => {
				set({
					chatSidebarWidth: DEFAULT_CHAT_SIDEBAR_WIDTH,
				});
			},
		}),
		{
			name: "ui-preferences-storage",
		},
	),
);
