/**
 * The persisted appearance preferences, and the sanitisers every read goes through.
 *
 * WHAT IS PERSISTED (ui-preferences-storage, v5 - see `migrateUiPreferences`):
 *   contrast       { dark: int, light: int }      -100..100, per mode, default 0.
 *                  Per MODE, not per theme: the slider is "how much contrast I
 *                  want in dark mode", so switching from Dracula to Nord keeps it.
 *   accent         { dark: AccentRef, light: AccentRef }  default { kind: "theme" }.
 *                  Per mode for the same reason, and because a dark theme's accent
 *                  is rarely legible on a light one (measured: up to 62 L* of
 *                  re-solve across modes).
 *   customAccents  Hex[], most recent first, <= 12, de-duplicated - the user's
 *                  own swatches beside the built-in accents.
 *   customThemeId  string | null - which saved custom theme is active (null =
 *                  the built-in `themeName`). When one is active, `themeName`
 *                  still holds its BASE, so a missing custom theme, a downgrade
 *                  and every existing `themeName` reader all fall back to it.
 *
 * The custom themes themselves live in their OWN store (`custom-themes-storage`,
 * `CUSTOM_THEMES_STORAGE_KEY`): the preferences blob is rewritten on every
 * preference write (sidebar drags included), and a corrupt theme list must not be
 * able to take the whole preferences blob down with it. A custom theme stores NO
 * contrast - contrast is applied over whichever theme is active.
 *
 * WHY SANITISE ON EVERY READ. `localStorage` is hand-editable, written by older
 * and newer builds, and occasionally half-written. Each value here is either
 * written into a `<style>` (a colour) or used to index a table (a palette id), so
 * a stored value is never trusted: an unknown shape falls back to the default
 * rather than reaching the engine.
 */

import { normalizeHex } from "./accent.mjs";
import { isSafePaletteValue, isSafeThemeId } from "./css.mjs";

export const MODES = /** @type {const} */ (["dark", "light"]);
export const CUSTOM_ACCENTS_LIMIT = 12;
export const CUSTOM_THEMES_LIMIT = 50;
export const CUSTOM_THEMES_STORAGE_KEY = "custom-themes-storage";
export const CUSTOM_THEME_NAME_MAX = 60;

export const DEFAULT_CONTRAST = Object.freeze({ dark: 0, light: 0 });
export const THEME_ACCENT = Object.freeze({ kind: "theme" });
export const DEFAULT_ACCENT = Object.freeze({
	dark: THEME_ACCENT,
	light: THEME_ACCENT,
});

/** An integer in -100..100, or 0. Rounds a fractional slider value. */
export const sanitizeContrastValue = (value) => {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0;
	return Math.max(-100, Math.min(100, Math.round(value)));
};

/** `{dark, light}` contrast, each sanitised; anything else is the default. */
export const sanitizeContrast = (value) => {
	if (!value || typeof value !== "object") return DEFAULT_CONTRAST;
	return {
		dark: sanitizeContrastValue(value.dark),
		light: sanitizeContrastValue(value.light),
	};
};

/**
 * One `AccentRef`, or the theme's own accent. `isThemeName` decides whether a
 * `{kind:"palette"}` ref still names a built-in (a palette removed in a later
 * build degrades to the theme accent rather than to nothing).
 */
export const sanitizeAccentRef = (value, isThemeName = () => true) => {
	if (!value || typeof value !== "object") return THEME_ACCENT;
	switch (value.kind) {
		case "theme":
			return THEME_ACCENT;
		case "theme-alt":
			return { kind: "theme-alt" };
		case "palette":
			return typeof value.id === "string" && isThemeName(value.id)
				? { kind: "palette", id: value.id }
				: THEME_ACCENT;
		case "custom": {
			const hex = normalizeHex(value.hex);
			return hex ? { kind: "custom", hex } : THEME_ACCENT;
		}
		default:
			return THEME_ACCENT;
	}
};

/** `{dark, light}` accent refs, each sanitised. */
export const sanitizeAccent = (value, isThemeName) => {
	if (!value || typeof value !== "object") return DEFAULT_ACCENT;
	return {
		dark: sanitizeAccentRef(value.dark, isThemeName),
		light: sanitizeAccentRef(value.light, isThemeName),
	};
};

/** Normalised, de-duplicated (case-insensitively), capped, order kept. */
export const sanitizeCustomAccents = (value) => {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const item of value) {
		const hex = normalizeHex(item);
		if (hex && !out.includes(hex)) out.push(hex);
		if (out.length === CUSTOM_ACCENTS_LIMIT) break;
	}
	return out;
};

/** Add `hex` to the front of the custom accents (most recent first). */
export const pushCustomAccent = (list, hex) => {
	const value = normalizeHex(hex);
	if (!value) return sanitizeCustomAccents(list);
	return sanitizeCustomAccents([value, ...(Array.isArray(list) ? list : [])]);
};

/** A custom theme id the overlay sanitiser and `[data-theme]` both accept. */
const CUSTOM_THEME_ID = /^custom-[a-z0-9]{1,30}$/;
export const sanitizeCustomThemeId = (value) =>
	typeof value === "string" && CUSTOM_THEME_ID.test(value) ? value : null;

/**
 * One stored custom theme, or null. Shape (`CustomThemeV1`):
 *   { format: "local-operator-theme", version: 1, id, name, base, seeds,
 *     overrides, updatedAt }
 * `seeds` and `overrides` are sparse role -> hex maps; only hex is accepted, so
 * an imported theme cannot carry free CSS into the injected `<style>`. Unknown
 * keys are dropped. `isThemeName` checks `base`; `isRole` checks role keys.
 */
export const sanitizeCustomTheme = (value, { isThemeName, isRole }) => {
	if (!value || typeof value !== "object") return null;
	if (value.format !== "local-operator-theme" || value.version !== 1)
		return null;
	const id = sanitizeCustomThemeId(value.id);
	if (!id || !isSafeThemeId(id)) return null;
	if (typeof value.base !== "string" || !isThemeName(value.base)) return null;
	const name =
		typeof value.name === "string" && value.name.trim()
			? value.name.trim().slice(0, CUSTOM_THEME_NAME_MAX)
			: null;
	if (!name) return null;
	const roles = (map) => {
		const out = {};
		if (!map || typeof map !== "object") return out;
		for (const [role, raw] of Object.entries(map)) {
			if (!isRole(role)) continue;
			const hex = normalizeHex(raw);
			if (hex && isSafePaletteValue(hex)) out[role] = hex;
		}
		return out;
	};
	return {
		format: "local-operator-theme",
		version: 1,
		id,
		name,
		base: value.base,
		seeds: roles(value.seeds),
		overrides: roles(value.overrides),
		updatedAt:
			typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
				? value.updatedAt
				: 0,
	};
};

/**
 * The custom-themes list: each entry sanitised, invalid ones and duplicate ids
 * dropped, capped at `CUSTOM_THEMES_LIMIT`. A value that is not an array at all
 * is a corrupt store and resets to `[]` - the active built-in base keeps
 * rendering, because `themeName` never pointed at the custom theme.
 */
export const sanitizeCustomThemes = (value, opts) => {
	if (!Array.isArray(value)) return [];
	const out = [];
	const ids = new Set();
	for (const item of value) {
		const theme = sanitizeCustomTheme(item, opts);
		if (!theme || ids.has(theme.id)) continue;
		ids.add(theme.id);
		out.push(theme);
		if (out.length === CUSTOM_THEMES_LIMIT) break;
	}
	return out;
};
