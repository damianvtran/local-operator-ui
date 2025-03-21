import type { Theme } from "@mui/material/styles";

/**
 * Available theme names in the application
 */
export type ThemeName =
	| "localOperatorDark"
	| "localOperatorLight"
	| "dracula"
	| "sage"
	| "monokai";

/**
 * Theme option interface for the theme selector
 */
export type ThemeOption = {
	/**
	 * Display name of the theme
	 */
	name: string;

	/**
	 * Unique identifier for the theme
	 */
	id: ThemeName;

	/**
	 * The MUI theme object
	 */
	theme: Theme;
};

/**
 * Collection of all available themes
 */
export type ThemeCollection = Record<ThemeName, ThemeOption>;
