import darkTheme from "./dark-theme";
import draculaTheme from "./dracula-theme";
import lightTheme from "./light-theme";
import monokaiTheme from "./monokai-theme";
import sageTheme from "./sage-theme";
import tokyoNightTheme from "./tokyo-night-theme";
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
	dracula: {
		name: "Dracula",
		id: "dracula",
		theme: draculaTheme,
	},
	sage: {
		name: "Sage",
		id: "sage",
		theme: sageTheme,
	},
	monokai: {
		name: "Monokai",
		id: "monokai",
		theme: monokaiTheme,
	},
	tokyoNight: {
		name: "Tokyo Night",
		id: "tokyoNight",
		theme: tokyoNightTheme,
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
export {
	darkTheme,
	draculaTheme,
	lightTheme,
	monokaiTheme,
	sageTheme,
	tokyoNightTheme,
};
