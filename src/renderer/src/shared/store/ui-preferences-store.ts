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
	 * @param open - Whether the canvas should be open
	 */
	setCanvasOpen: (open: boolean) => void;

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
const DEFAULT_CHAT_SIDEBAR_WIDTH = 260;

export const useUiPreferencesStore = create<UiPreferencesState>()(
	persist(
		(set) => ({
			isCommandPaletteOpen: false,
			commandPaletteQuery: "",
			isSidebarCollapsed: false,
			themeName: DEFAULT_THEME,
			canvasWidth: DEFAULT_CANVAS_WIDTH,
			chatSidebarWidth: DEFAULT_CHAT_SIDEBAR_WIDTH,
			isCanvasOpen: false,
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

			setTheme: (themeName: ThemeName) => {
				set({
					themeName,
				});
			},

			setCanvasOpen: (open: boolean) => {
				set({
					isCanvasOpen: open,
				});
			},

			setCanvasWidth: (width: number) => {
				set({
					canvasWidth: width,
				});
			},

			setChatSidebarWidth: (width: number) => {
				set({
					chatSidebarWidth: width,
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
