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
 * A document that renders app components without this directory's
 * `ThemeProvider` — Storybook, and any surface that paints before the provider
 * mounts — would otherwise carry no `data-theme` at all, and every Tailwind
 * role utility would resolve to nothing. Guarded on the attribute being absent
 * so the React provider, which runs later and knows the user's choice, always
 * wins; the installer entry calls `applyThemeToDocument` itself for the same
 * reason, before its first render.
 */
if (
	typeof document !== "undefined" &&
	!document.documentElement.dataset.theme
) {
	applyThemeToDocument(DEFAULT_THEME);
}

export type { ThemeName, ThemeOption };

/*
 * There is no named export for a single palette, and there should not be.
 *
 * The onboarding Radient steps do paint in Radient blue whichever theme the
 * user picked — they brand a third-party account, not the app — but they get
 * there with `data-theme="radient"` on the branded subtree, because the
 * `[data-theme="<id>"]` blocks in themes.generated.css are plain attribute
 * selectors and re-point `--lo-*` for their descendants alone. Reaching into
 * one theme object to read a hex out of it is what that replaced.
 */
