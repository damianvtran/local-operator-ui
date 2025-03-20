import darkTheme from "./dark-theme";
import lightTheme from "./light-theme";
import type { ThemeCollection, ThemeName, ThemeOption } from "./types";

/**
 * Collection of all available themes
 */
export const themes: ThemeCollection = {
	localOperatorDark: {
		name: "Local Operator Dark",
		id: "localOperatorDark",
		theme: darkTheme,
	},
	localOperatorLight: {
		name: "Local Operator Light",
		id: "localOperatorLight",
		theme: lightTheme,
	},
};

/**
 * Default theme name
 */
export const DEFAULT_THEME: ThemeName = "localOperatorDark";

/**
 * Get a theme by name
 * @param themeName The name of the theme to get
 * @returns The theme option or the default theme if not found
 */
export const getTheme = (themeName: ThemeName): ThemeOption => {
	return themes[themeName] || themes[DEFAULT_THEME];
};

export type { ThemeName, ThemeOption };
export { darkTheme, lightTheme };
