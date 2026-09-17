import type { Theme } from "@mui/material/styles";

/**
 * Available theme names in the application. Written in the registry's own
 * presentation order (`shared/themes/index.ts`), because this union is the
 * list a reader checks the registry against: a member missing here is a
 * palette that cannot be selected at all, and an order that disagreed with the
 * array would make the two lists impossible to diff by eye once the set is
 * large. See that file for the family rule that decides where a new palette
 * goes.
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
	| "synth"
	/* classics */
	| "catppuccinMocha"
	| "catppuccinLatte"
	| "tokyoNightStorm"
	| "gruvbox"
	| "nord"
	| "oneDark"
	| "solarizedDark"
	/* rose pine */
	| "rosePine"
	| "rosePineMoon"
	| "rosePineDawn"
	/* companions */
	| "alucard"
	| "gruvboxLight"
	| "tokyoNightDay"
	| "oneLight"
	| "catppuccinFrappe"
	| "catppuccinMacchiato"
	| "palenight"
	/* modern */
	| "everforest"
	| "everforestLight"
	| "kanagawaWave"
	| "kanagawaLotus"
	| "ayuDark"
	| "ayuMirage"
	| "ayuLight"
	| "nightfox"
	| "duskfox"
	/* neon/retro */
	| "synthwave"
	| "matrix"
	| "tron"
	| "cyberpunk"
	| "vaporwave"
	| "outrun"
	| "neonNoir"
	| "arcade"
	/* nature */
	| "forest"
	| "ocean"
	| "desert"
	| "autumn"
	| "lavender"
	| "arctic"
	| "rosewood"
	/* lights */
	| "solarizedLight"
	| "githubLight"
	| "paper"
	| "linen"
	| "highContrastLight"
	| "mintLight";

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
