import type { Theme } from "@mui/material/styles";

/**
 * Available theme names in the application
 */
export type ThemeName =
	| "localOperatorDark"
	| "localOperatorLight"
	| "dracula"
	| "dune"
	| "sage"
	| "monokai"
	| "tokyoNight"
	| "iceberg"
	| "radient"
	| "neon"
	| "obsidian"
	| "synth";

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
	 * One line, shown under the name in the theme picker. Carried through from
	 * the theme's `ThemeDefinition`.
	 */
	description: string;

	/**
	 * The MUI theme object
	 */
	theme: Theme;
};

/**
 * Collection of all available themes
 */
export type ThemeCollection = Record<ThemeName, ThemeOption>;
