/**
 * Store for managing UI preferences
 *
 * This store keeps track of user interface preferences such as sidebar collapse state,
 * theme selection, and provides methods to update these preferences.
 */

import { DEFAULT_THEME } from "@renderer/themes";
import type { ThemeName } from "@renderer/themes";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Type definition for the UI preferences store state
 */
type UiPreferencesState = {
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
const DEFAULT_CHAT_SIDEBAR_WIDTH = 320;

export const useUiPreferencesStore = create<UiPreferencesState>()(
	persist(
		(set) => ({
			isSidebarCollapsed: false,
			themeName: DEFAULT_THEME,
			canvasWidth: DEFAULT_CANVAS_WIDTH,
			chatSidebarWidth: DEFAULT_CHAT_SIDEBAR_WIDTH,

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
