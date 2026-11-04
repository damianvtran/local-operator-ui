/**
 * The runtime half of the theme composition engine: turn the persisted appearance
 * (`themeName` + per-mode contrast + per-mode accent) into what the document
 * paints.
 *
 * STATUS: plumbing only. Nothing in the app calls `applyAppearance` yet -
 * `ThemeProvider` still calls `applyThemeToDocument(themeName)` - so this module
 * changes no rendered frame. The settings picker that writes the v5 preference
 * fields, and the consumers that key on `themeName` instead of the document
 * (Mermaid's config cache, CodeMirror's mode, the mini-view's storage sync, the
 * approvals overlay's palette name), move onto it in the follow-up. It is a bare
 * internal API here so the engine can be exercised end to end in the built app.
 *
 * HOW A COMPOSED THEME REACHES THE PAGE, and why each step is in this order:
 *   1. `composeTheme` (src/shared/theme-engine/compose.mjs) returns the palette.
 *      At Standard with the theme's own accent it is the BUILT-IN object, and
 *      this module does exactly what `applyThemeToDocument` does: no `<style>`,
 *      `data-theme` is the built-in id. Today's users take today's path.
 *   2. Otherwise ONE `<style id="lo-composed-theme">` is upserted with
 *      `paletteBlock("lo-<hash>", palette)` - the same emitter the build writes
 *      `themes.generated.css` with, so the static and runtime blocks cannot
 *      differ in shape - BEFORE the attribute changes, so there is no frame in
 *      which `data-theme` names a block that does not exist yet.
 *   3. `data-theme` becomes `lo-<hash>`. Because the id changes whenever any
 *      value does, every existing `MutationObserver` on `data-theme` (xterm,
 *      the transcript supplement, the address overlay's cache) re-reads the
 *      colours without knowing composition exists.
 *
 * WHY NOT INLINE CUSTOM PROPERTIES ON `<html>`: `themes.generated.css` re-declares
 * Tailwind's `--color-*` inside `[data-theme]:not(:root)` subtrees so scoped
 * previews work; a block keyed on an attribute value takes part in exactly the
 * same cascade as the static ones, and inline styles would not.
 */

import type { Theme } from "@mui/material/styles";
import type { AccentRef } from "../../../../shared/theme-engine/accent.mjs";
import type { Composition } from "../../../../shared/theme-engine/compose.mjs";
import { composeTheme } from "../../../../shared/theme-engine/compose.mjs";
import { paletteBlock } from "../../../../shared/theme-engine/css.mjs";
import type { ThemeName } from "../types/theme";
import { createBaseTheme } from "./base-theme";
import { definitionOf, getTheme } from "./index";
import type { ThemePalette } from "./palette-contract";

/** The `<style>` element composed palettes are written into. One per document. */
export const COMPOSED_STYLE_ID = "lo-composed-theme";

export type Appearance = {
	themeName: ThemeName;
	contrast: { dark: number; light: number };
	accent: { dark: AccentRef; light: AccentRef };
};

export type ResolvedAppearance = Composition<ThemePalette> & {
	/** The `data-theme` value: the built-in id, or `lo-<hash>`. */
	id: string;
	/** The MUI theme for this palette: the prebuilt one on the identity path. */
	muiTheme: Theme;
};

/*
 * A small cache by `data-theme` id. `createBaseTheme` builds a full MUI theme,
 * and a slider drag recomposes per frame; the last few compositions are what a
 * drag toggles between. Built-ins never enter it - they have their prebuilt
 * theme already.
 */
const MUI_CACHE_LIMIT = 4;
const muiCache = new Map<string, Theme>();
const muiThemeFor = (id: string, palette: ThemePalette): Theme => {
	const hit = muiCache.get(id);
	if (hit) {
		muiCache.delete(id);
		muiCache.set(id, hit);
		return hit;
	}
	const theme = createBaseTheme(palette);
	muiCache.set(id, theme);
	if (muiCache.size > MUI_CACHE_LIMIT) {
		const oldest = muiCache.keys().next().value;
		if (oldest !== undefined) muiCache.delete(oldest);
	}
	return theme;
};

const accentOf = (id: string): string | undefined => {
	const definition = definitionOf(id);
	return definition?.palette.accent;
};

/**
 * Compose the appearance without touching the document. Pure apart from the MUI
 * cache; safe to call per frame.
 */
export const resolveAppearance = (
	appearance: Appearance,
): ResolvedAppearance => {
	const option = getTheme(appearance.themeName);
	const definition = definitionOf(option.id);
	if (!definition) throw new Error(`no palette for theme ${option.id}`);
	const base = definition.palette;
	const mode = base.mode;
	const composition = composeTheme(base, {
		contrast: appearance.contrast[mode] ?? 0,
		accent: appearance.accent[mode],
		id: option.id,
		paletteAccent: accentOf,
	});
	if (composition.identity) {
		return {
			...composition,
			id: option.id,
			muiTheme: option.theme,
		};
	}
	const id = composition.id ?? option.id;
	return {
		...composition,
		id,
		muiTheme: muiThemeFor(id, composition.palette),
	};
};

/**
 * Publish an appearance to `doc`. Returns what it resolved, so a caller can hand
 * the same MUI theme to the provider without composing twice.
 */
export const applyAppearance = (
	appearance: Appearance,
	doc: Document = document,
): ResolvedAppearance => {
	const resolved = resolveAppearance(appearance);
	const root = doc.documentElement;
	const existing = doc.getElementById(COMPOSED_STYLE_ID);
	if (resolved.identity) {
		/* Identity: today's path exactly. A block left over from an earlier
		   composition is removed so the document carries no dead styles. */
		existing?.remove();
	} else {
		const style = existing ?? doc.createElement("style");
		style.id = COMPOSED_STYLE_ID;
		style.textContent = paletteBlock(resolved.id, resolved.palette);
		if (!existing) doc.head.appendChild(style);
	}
	root.dataset.theme = resolved.id;
	/* Mirrors the palette's own mode, as `applyThemeToDocument` does. */
	root.classList.toggle("dark", resolved.palette.mode === "dark");
	return resolved;
};
