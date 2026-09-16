import type { ThemeCollection, ThemeName, ThemeOption } from "../types/theme";
import { createBaseTheme } from "./base-theme";
import type { ThemeDefinition } from "./palette-contract";
import { alucard } from "./palettes/alucard";
import { arcade } from "./palettes/arcade";
import { arctic } from "./palettes/arctic";
import { autumn } from "./palettes/autumn";
import { ayuDark } from "./palettes/ayu-dark";
import { ayuLight } from "./palettes/ayu-light";
import { ayuMirage } from "./palettes/ayu-mirage";
import { catppuccinFrappe } from "./palettes/catppuccin-frappe";
import { catppuccinLatte } from "./palettes/catppuccin-latte";
import { catppuccinMacchiato } from "./palettes/catppuccin-macchiato";
import { catppuccinMocha } from "./palettes/catppuccin-mocha";
import { cyberpunk } from "./palettes/cyberpunk";
import { desert } from "./palettes/desert";
import { dracula } from "./palettes/dracula";
import { dune } from "./palettes/dune";
import { duskfox } from "./palettes/duskfox";
import { everforest } from "./palettes/everforest";
import { everforestLight } from "./palettes/everforest-light";
import { forest } from "./palettes/forest";
import { githubLight } from "./palettes/github-light";
import { gruvbox } from "./palettes/gruvbox";
import { gruvboxLight } from "./palettes/gruvbox-light";
import { highContrastLight } from "./palettes/high-contrast-light";
import { iceberg } from "./palettes/iceberg";
import { kanagawaLotus } from "./palettes/kanagawa-lotus";
import { kanagawaWave } from "./palettes/kanagawa-wave";
import { lavender } from "./palettes/lavender";
import { linen } from "./palettes/linen";
import {
	localOperatorDark,
	localOperatorLight,
} from "./palettes/local-operator";
import { matrix } from "./palettes/matrix";
import { mintLight } from "./palettes/mint-light";
import { monokai } from "./palettes/monokai";
import { neon } from "./palettes/neon";
import { neonNoir } from "./palettes/neon-noir";
import { nightfox } from "./palettes/nightfox";
import { nord } from "./palettes/nord";
import { obsidian } from "./palettes/obsidian";
import { ocean } from "./palettes/ocean";
import { oneDark } from "./palettes/one-dark";
import { oneLight } from "./palettes/one-light";
import { outrun } from "./palettes/outrun";
import { palenight } from "./palettes/palenight";
import { paper } from "./palettes/paper";
import { radient } from "./palettes/radient";
import { rosePine } from "./palettes/rose-pine";
import { rosePineDawn } from "./palettes/rose-pine-dawn";
import { rosePineMoon } from "./palettes/rose-pine-moon";
import { rosewood } from "./palettes/rosewood";
import { sage } from "./palettes/sage";
import { solarizedDark } from "./palettes/solarized-dark";
import { solarizedLight } from "./palettes/solarized-light";
import { synth } from "./palettes/synth";
import { synthwave } from "./palettes/synthwave";
import { tokyoNight } from "./palettes/tokyo-night";
import { tokyoNightDay } from "./palettes/tokyo-night-day";
import { tokyoNightStorm } from "./palettes/tokyo-night-storm";
import { tron } from "./palettes/tron";
import { vaporwave } from "./palettes/vaporwave";

/**
 * The theme registry.
 *
 * A theme is a `ThemeDefinition` — an id, a picker label, a one-line
 * description and a `ThemePalette` — run through `createBaseTheme`. There is
 * no per-theme MUI configuration and no place to put any: everything that is
 * not colour lives in the factory, so a change to the type scale or to a
 * component's anatomy is a one-file diff instead of a fifty-nine-file one.
 *
 * ## Registry order IS presentation order
 *
 * The picker renders this array in order inside each `mode` group, so the
 * order here is a design decision rather than an implementation detail, and
 * the rule is the TUI's own
 * (`local_operator/tui/palettes/__init__.py::all_palettes`, which documents
 * it): the two `localOperator*` brand palettes first because they are the
 * brand and the default; then the palettes this app shipped before the port,
 * in the order they shipped in, so existing users' picker does not reshuffle
 * under them; then every palette the port added, grouped by the family it
 * belongs to — classics, rosé pine, companions, modern, neon/retro, radient,
 * nature, lights — in the TUI's family order and, within a family, in the
 * TUI's own row order.
 *
 * Two properties follow, and they are why the rule is worth stating. A family
 * is contiguous within its mode group (the light half of rosé pine sits under
 * the dark half rather than a screen away, which is the whole point of a
 * "companion" palette), and a new palette has exactly one right place to go,
 * so the next author does not have to guess where to append it.
 *
 * A palette's `id` — not its file name — is what the `[data-theme="…"]`
 * blocks in `themes.generated.css` are keyed on, and every id follows the
 * camelCase of the palette's own file stem, so `palettes/one-dark.ts` is
 * `oneDark`. `neonNoir` is the one that reads oddly: the file is
 * `neon-noir.ts` and the id keeps the family's camelCase spelling rather than
 * the hyphen, because a union member with a hyphen beside fifty-eight without
 * one is a trap for whoever greps for it next.
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

	/* classics — the editor schemes users arrive knowing */
	catppuccinMocha,
	catppuccinLatte,
	tokyoNightStorm,
	gruvbox,
	nord,
	oneDark,
	solarizedDark,

	/* rosé pine — the three flavours, dark then light, as the TUI lists them */
	rosePine,
	rosePineMoon,
	rosePineDawn,

	/*
	 * companions — the daylight half of a darker palette, plus the mid
	 * flavours
	 */
	alucard,
	gruvboxLight,
	tokyoNightDay,
	oneLight,
	catppuccinFrappe,
	catppuccinMacchiato,
	palenight,

	/* modern — the newer non-terminal schemes, several with a light sibling */
	everforest,
	everforestLight,
	kanagawaWave,
	kanagawaLotus,
	ayuDark,
	ayuMirage,
	ayuLight,
	nightfox,
	duskfox,

	/* neon/retro — after dark, and the loudest family in the set */
	synthwave,
	matrix,
	tron,
	cyberpunk,
	vaporwave,
	outrun,
	neonNoir,
	arcade,

	/*
	 * nature — the earth tones. `radient` has no entry here: it is the brand
	 * palette and the TUI's own radient family holds exactly this one ramp,
	 * which already sits above with the palettes that shipped.
	 */
	forest,
	ocean,
	desert,
	autumn,
	lavender,
	arctic,
	rosewood,

	/* lights — the day ramps, last, at the end of a dark terminal's scroll */
	solarizedLight,
	githubLight,
	paper,
	linen,
	highContrastLight,
	mintLight,
];

/**
 * Collection of all available themes, keyed by id.
 *
 * Built by mapping rather than written out, so adding a palette to the array
 * above is the whole of adding a theme.
 *
 * No cast on `definition.id`: `ThemeDefinition.id` is `ThemeName`, so the
 * object literal below already satisfies `ThemeOption` and the registry's
 * exhaustiveness is checked against the union rather than asserted (review
 * round 1, M-1). The trailing cast on the whole expression stays — `Object.
 * fromEntries` is typed with a `string` index signature, and widening that back
 * to the union's exact keys is what the annotation is for.
 */
export const themes: ThemeCollection = Object.fromEntries(
	definitions.map((definition) => [
		definition.id,
		{
			id: definition.id,
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
 * Publish a theme id to the document element. `themes.generated.css` emits one
 * `[data-theme="<id>"]` block per theme, carrying that palette's `--lo-*`
 * custom properties and its `color-scheme`. Every Tailwind role utility in the
 * app resolves through those variables, so a document with no `data-theme`
 * renders the ported half of a screen with no colours at all while the MUI
 * half looks correct — a failure mode that is easy to mistake for an
 * unfinished component. @param themeName the theme to publish; unknown names
 * fall back to the default
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
 * The default palette, published at import. A document that renders app
 * components without this directory's `ThemeProvider` — Storybook, and any
 * surface that paints before the provider mounts — would otherwise carry no
 * `data-theme` at all, and every Tailwind role utility would resolve to
 * nothing. Guarded on the attribute being absent so the React provider, which
 * runs later and knows the user's choice, always wins; the installer entry
 * calls `applyThemeToDocument` itself for the same reason, before its first
 * render.
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
