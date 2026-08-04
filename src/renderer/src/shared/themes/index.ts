import type { ThemeCollection, ThemeName, ThemeOption } from "../types/theme";
import { createBaseTheme } from "./base-theme";
import type { ThemeDefinition } from "./palette-contract";
import { dracula } from "./palettes/dracula";
import { dune } from "./palettes/dune";
import { iceberg } from "./palettes/iceberg";
import {
	localOperatorDark,
	localOperatorLight,
} from "./palettes/local-operator";
import { monokai } from "./palettes/monokai";
import { neon } from "./palettes/neon";
import { obsidian } from "./palettes/obsidian";
import { radient } from "./palettes/radient";
import { sage } from "./palettes/sage";
import { synth } from "./palettes/synth";
import { tokyoNight } from "./palettes/tokyo-night";

/**
 * The theme registry.
 *
 * A theme is a `ThemeDefinition` — an id, a picker label, a one-line
 * description and a `ThemePalette` — run through `createBaseTheme`. There is
 * no per-theme MUI configuration and no place to put any: everything that is
 * not colour lives in the factory, so a change to the type scale or to a
 * component's anatomy is a one-file diff instead of a twelve-file one.
 *
 * @see base-theme.ts — every non-palette decision
 * @see palettes/local-operator.ts — the reference palette
 */
const definitions: readonly ThemeDefinition[] = [
	localOperatorDark,
	localOperatorLight,
	dracula,
	dune,
	sage,
	monokai,
	tokyoNight,
	iceberg,
	radient,
	neon,
	obsidian,
	synth,
];

/**
 * Collection of all available themes, keyed by id.
 *
 * Built by mapping rather than written out, so adding a palette to the array
 * above is the whole of adding a theme.
 */
export const themes: ThemeCollection = Object.fromEntries(
	definitions.map((definition) => [
		definition.id,
		{
			id: definition.id as ThemeName,
			name: definition.name,
			description: definition.description,
			theme: createBaseTheme(definition.palette),
		},
	]),
) as ThemeCollection;

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

/**
 * Publish a theme id to the document element.
 *
 * `themes.generated.css` emits one `[data-theme="<id>"]` block per theme,
 * carrying that palette's `--lo-*` custom properties and its `color-scheme`.
 * Every Tailwind role utility in the app resolves through those variables, so
 * a document with no `data-theme` renders the ported half of a screen with no
 * colours at all while the MUI half looks correct — a failure mode that is
 * easy to mistake for an unfinished component.
 *
 * @param themeName the theme to publish; unknown names fall back to the default
 */
export const applyThemeToDocument = (themeName: ThemeName): void => {
	const option = getTheme(themeName);
	const root = document.documentElement;
	root.dataset.theme = option.id;
	/* Mirrors the palette's own mode, so a `dark:` variant agrees with the
	   chosen theme rather than with the OS setting. */
	root.classList.toggle("dark", option.theme.palette.mode === "dark");
};

/*
 * The default palette, published at import.
 *
 * The installer window mounts MUI's own `ThemeProvider` with `DEFAULT_THEME`
 * rather than this directory's `ThemeProvider`, so nothing there would ever
 * set the attribute. Guarded on the attribute being absent so the React
 * provider, which runs later and knows the user's choice, always wins.
 */
if (
	typeof document !== "undefined" &&
	!document.documentElement.dataset.theme
) {
	applyThemeToDocument(DEFAULT_THEME);
}

export type { ThemeName, ThemeOption };

/**
 * The Radient theme as a bare MUI theme.
 *
 * The onboarding Radient sign-in and choice steps paint themselves in Radient
 * blue regardless of which theme the user has picked, because they are
 * branding a third-party account, not the app. That is the only reason a
 * single theme is exported by name.
 */
export const radientTheme = themes.radient.theme;
