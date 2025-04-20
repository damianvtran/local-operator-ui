import type { ThemeCollection, ThemeName, ThemeOption } from "../types/theme";
import darkTheme from "./dark-theme";
import draculaTheme from "./dracula-theme";
import duneTheme from "./dune-theme";
import icebergTheme from "./iceberg-theme";
import lightTheme from "./light-theme";
import monokaiTheme from "./monokai-theme";
import radientTheme from "./radient-theme";
import sageTheme from "./sage-theme";
import tokyoNightTheme from "./tokyo-night-theme";

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
	dune: {
		name: "Dune",
		id: "dune",
		theme: duneTheme,
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
	iceberg: {
		name: "Iceberg",
		id: "iceberg",
		theme: icebergTheme,
	},
	radient: {
		name: "Radient",
		id: "radient",
		theme: radientTheme,
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
	duneTheme,
	icebergTheme,
	lightTheme,
	monokaiTheme,
	radientTheme,
	sageTheme,
	tokyoNightTheme,
};
