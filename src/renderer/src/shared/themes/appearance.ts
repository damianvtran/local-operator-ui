/**
 * The runtime half of the theme composition engine: turn the persisted appearance
 * (`themeName` + per-mode contrast + per-mode accent) into what the document
 * paints.
 *
 * STATUS: `ThemeProvider` publishes every theme through `applyAppearance`. No
 * setting writes the v5 contrast/accent fields yet, so every profile takes the
 * identity path and no rendered frame changes. The settings picker that writes
 * them, and the consumers that still key on `themeName` instead of the document
 * (Mermaid's config cache, CodeMirror's mode, the mini-view's storage sync, the
 * approvals overlay's palette name), move onto it in the follow-up.
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
import { paletteHash } from "../../../../shared/theme-engine/compose.mjs";
import {
	isSafePaletteValue,
	isSafeThemeId,
	paletteBlock,
} from "../../../../shared/theme-engine/css.mjs";
import type { ThemeName } from "../types/theme";
import { createBaseTheme } from "./base-theme";
import { definitionOf, getTheme } from "./index";
import type { ThemePalette } from "./palette-contract";

/** The `<style>` element composed palettes are written into. One per document. */
export const COMPOSED_STYLE_ID = "lo-composed-theme";

export type Appearance = {
	themeName: ThemeName;
	/** The active saved theme's id. Its palette is NOT looked up here: this
	 * module stays free of the theme library and the preferences store so the
	 * composition engine can be bundled (and tested) without either. Callers
	 * with a library pass the derived palette as `resolveAppearance`'s second
	 * argument. */
	customThemeId?: string | null;
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
 * and toggling between a few appearances (snap points, accents) is the common
 * pattern. Built-ins never enter it - they have their prebuilt
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

/*
 * Compositions by INPUT (theme, the mode's contrast, the mode's accent ref).
 * `composeTheme` is deterministic, so the same input always yields the same
 * palette, and a cache hit is the whole cost of a re-render that did not change
 * the appearance. Small: the slider's snap points and the last accents tried are
 * what a session revisits.
 */
const COMPOSITION_CACHE_LIMIT = 16;
const compositionCache = new Map<string, Composition<ThemePalette>>();

/**
 * Compose the appearance without touching the document. Pure apart from the
 * caches.
 *
 * NOT CHEAP ON A MISS - NOT A PER-FRAME CALL (agent review round 1, m2 on #1674).
 * A non-Standard composition runs the contract's evaluator inside a repair search;
 * measured on the M-series dev host (Node 24, cold): githubLight Soft ~1.6 s,
 * obsidian Soft ~1.2 s, arcade with a custom accent ~105 ms; the identity path
 * ~1 ms. Repeats of one input are cache hits. The slider in the follow-up must
 * commit on release (or debounce, or compose in a worker) - never recompose on
 * every pointer move.
 */
export const resolveAppearance = (
	appearance: Appearance,
	/** A saved theme's DERIVED palette, when one is active. */
	customPalette?: ThemePalette,
	/** Its base palette id: the contract's pins are keyed by it. */
	customBaseId?: ThemeName,
): ResolvedAppearance => {
	const option = getTheme(appearance.themeName);
	const definition = definitionOf(option.id);
	if (!definition) throw new Error(`no palette for theme ${option.id}`);
	const base = customPalette ?? definition.palette;
	const mode = base.mode;
	const baseId = customBaseId ?? option.id;
	const contrast = appearance.contrast[mode] ?? 0;
	const accent = appearance.accent[mode];
	const key = JSON.stringify([
		option.id,
		customBaseId ?? null,
		// A library revision changes no preference field. Hash ALL authored roles
		// so same-base themes and edits to the active ID cannot reuse old paint.
		customPalette ? paletteHash(customPalette) : null,
		contrast,
		accent ?? null,
	]);
	let composition = compositionCache.get(key);
	if (composition) {
		compositionCache.delete(key);
	} else {
		composition = composeTheme(base, {
			contrast,
			accent,
			id: baseId,
			preserveSecondary: customPalette !== undefined,
			paletteAccent: accentOf,
		});
	}
	compositionCache.set(key, composition);
	if (compositionCache.size > COMPOSITION_CACHE_LIMIT) {
		const oldest = compositionCache.keys().next().value;
		if (oldest !== undefined) compositionCache.delete(oldest);
	}
	if (composition.identity && !customBaseId) {
		return {
			...composition,
			id: option.id,
			muiTheme: option.theme,
		};
	}
	const id = `lo-${paletteHash(composition.palette)}`;
	return {
		...composition,
		id,
		identity: false,
		muiTheme: muiThemeFor(id, composition.palette),
	};
};

/*
 * THE WRITE IS VALIDATED HERE, NOT TRUSTED FROM THE CALLER (agent review round
 * 1, m4 on #1674). `paletteBlock` writes values verbatim into a stylesheet, so a
 * value like `red; } body { display: none` would become a rule. Today every
 * composed value is a hex the engine produced; a future caller (custom themes)
 * might not have checked. So before `textContent` is written, the id and every
 * value must pass the CSS grammar in `css.mjs`; anything else FAILS TO IDENTITY:
 * the built-in is published exactly as on the Standard path, and the refusal is
 * logged. Never a partial block.
 */
const safeToWrite = (id: string, palette: ThemePalette): boolean =>
	isSafeThemeId(id) &&
	Object.entries(palette).every(
		([role, value]) => role === "mode" || isSafePaletteValue(value),
	) &&
	(palette.mode === "dark" || palette.mode === "light");

/**
 * Publish an appearance to `doc`. Returns what it resolved, so a caller can hand
 * the same MUI theme to the provider without composing twice.
 */
export const applyAppearance = (
	appearance: Appearance,
	doc: Document = document,
	/** A saved theme's derived palette (see `resolveAppearance`). */
	customPalette?: ThemePalette,
	customBaseId?: ThemeName,
	/* Injected for tests only: the composition to publish. */
	resolve: (a: Appearance) => ResolvedAppearance = (a) =>
		resolveAppearance(a, customPalette, customBaseId),
): ResolvedAppearance => {
	let resolved = resolve(appearance);
	if (!resolved.identity && !safeToWrite(resolved.id, resolved.palette)) {
		console.error(
			`[theme] refused to publish composed theme ${JSON.stringify(resolved.id).slice(0, 60)}: an id or value is outside the CSS grammar; showing the built-in theme`,
		);
		const option = getTheme(appearance.themeName);
		const definition = definitionOf(option.id);
		if (!definition) throw new Error(`no palette for theme ${option.id}`);
		resolved = {
			identity: true,
			palette: definition.palette,
			id: option.id,
			effectiveContrast: 0,
			requestedContrast: resolved.requestedContrast,
			accentApplied: false,
			accentAdjusted: 0,
			muiTheme: option.theme,
		};
	}
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

/**
 * The appearance tuple out of the preferences state. One picker for every
 * caller (provider, boot, mini-view, consumers) so no surface composes from a
 * different subset of fields - the bug class this follow-up exists to close was
 * exactly that: readers keyed on `themeName` alone while the document painted a
 * composition.
 */
export const appearanceOf = (state: Appearance): Appearance => ({
	themeName: state.themeName,
	customThemeId: state.customThemeId ?? null,
	contrast: state.contrast,
	accent: state.accent,
});

/**
 * A stable string for "did the appearance change": what the mini-view compares
 * across documents (its `storage` listener), and what a consumer can key a cache
 * on without composing. Two equal tuples always compose to the same palette
 * (`composeTheme` is deterministic), so equal keys mean equal paint.
 */
export const appearanceKey = (appearance: Appearance): string =>
	JSON.stringify([
		appearance.themeName,
		appearance.contrast?.dark ?? 0,
		appearance.contrast?.light ?? 0,
		appearance.accent?.dark ?? null,
		appearance.accent?.light ?? null,
		appearance.customThemeId ?? null,
	]);

/**
 * The composed role values the document is painting, for a SEPARATE document
 * that cannot read this one's injected `<style>` (the browser approvals card,
 * whose CSP forbids inline styles). Null on the identity path: there the
 * built-in's name alone is enough, because the card's static stylesheet carries
 * every built-in block.
 */
export const composedPaletteVars = (
	appearance: Appearance,
	customPalette?: ThemePalette,
	customBaseId?: ThemeName,
): Record<string, string> | null => {
	const resolved = resolveAppearance(appearance, customPalette, customBaseId);
	if (resolved.identity) return null;
	const { mode: _mode, ...roles } = resolved.palette;
	return roles as Record<string, string>;
};
