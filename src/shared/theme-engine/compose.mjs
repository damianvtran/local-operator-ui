/**
 * `composeTheme`: one built-in palette -> the palette the app paints, in the
 * fixed order THEME -> CONTRAST -> ACCENT.
 *
 * WHY THAT ORDER. Contrast moves the grounds and re-solves every ink over them;
 * accent then solves ONE colour over those composed grounds. The other order would
 * solve the accent against grounds that are about to move, and contrast would
 * re-solve the user's accent as if it were the theme's - the accent the user
 * picked would not be the accent they got.
 *
 * THE IDENTITY GUARANTEE IS STRUCTURAL, NOT NUMERIC. At Standard contrast with the
 * theme's own accent, `composeTheme` returns `{ identity: true, palette: base }`
 * with `palette === base` - the built-in object itself. The runtime then does
 * nothing new: no `<style>` is injected, `data-theme` stays the built-in id, MUI
 * gets the prebuilt theme. So every user who never touches the new controls runs
 * exactly today's code path, and the static CSS is the whole of their theme.
 *
 * THE LEGIBILITY GUARANTEE. Neither layer returns a palette the contract's
 * per-palette assertions reject (`evaluate.mjs`, the code `pnpm check-themes`
 * runs). Contrast that cannot be reached is CAPPED (`effectiveContrast`, nearer 0
 * than asked); an accent that cannot be made legible is NOT APPLIED
 * (`accentApplied: false`). Both are reported so the UI can say so - nothing is
 * silently swapped.
 *
 * CONSTRAINTS. Pure, deterministic, and never mutates `base` (a built-in palette
 * object is shared app-wide and the design kit pins the two brand ones). A custom
 * theme stores no contrast: contrast is a per-mode preference applied over
 * whichever theme is active, so `composeTheme` takes it as an argument and the
 * slider keeps its value across theme switches.
 */

import { applyAccent } from "./accent.mjs";
import { applyContrast } from "./contrast.mjs";

/**
 * 8 base-36 characters of FNV-1a over the composed palette. A composition's
 * `data-theme` id is `lo-<hash>`, so it CHANGES whenever any value changes -
 * which is what makes every existing `MutationObserver` on `data-theme` (the
 * console's xterm theme, the transcript supplement, the address overlay's cache
 * key) re-read the colours without being told about composition at all. The
 * `lo-` prefix and the alphabet keep it inside the approvals overlay's
 * `/^[A-Za-z0-9_-]{1,40}$/` theme-name sanitiser.
 */
export const paletteHash = (palette) => {
	const text = JSON.stringify(
		Object.keys(palette)
			.sort()
			.map((k) => [k, palette[k]]),
	);
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(36).padStart(7, "0").slice(-8);
};

/**
 * Compose `base` (a built-in palette, by reference) at `contrast` with `accent`.
 *
 * Options:
 *   contrast       integer -100..100, default 0 (Standard)
 *   accent         an `AccentRef` (see accent.mjs), default `{ kind: "theme" }`
 *   id             the built-in's id - the contract's pins are keyed by it
 *   paletteAccent  (id) => hex, resolves `{ kind: "palette" }` refs
 *
 * Returns `{ identity, palette, id, effectiveContrast, requestedContrast,
 * accentApplied, accentAdjusted }`. `id` is the built-in id on the identity path
 * and `lo-<hash>` otherwise.
 */
export const composeTheme = (
	base,
	{
		contrast = 0,
		accent = { kind: "theme" },
		id,
		paletteAccent,
		preserveSecondary = false,
	} = {},
) => {
	const themeAccent = !accent || accent.kind === "theme";
	if (contrast === 0 && themeAccent) {
		return {
			identity: true,
			palette: base,
			id,
			effectiveContrast: 0,
			requestedContrast: 0,
			accentApplied: true,
			accentAdjusted: 0,
		};
	}
	const contrasted = applyContrast(base, contrast, { id });
	let palette = contrasted.palette;
	let accentApplied = true;
	let accentAdjusted = 0;
	if (!themeAccent) {
		const result = applyAccent(palette, accent, {
			authored: base,
			id,
			paletteAccent,
			preserveSecondary,
		});
		palette = result.palette;
		accentApplied = result.applied;
		accentAdjusted = result.adjusted;
	}
	/* A capped contrast with an accent that could not be used can land back on the
	   built-in: report that as identity too, so the runtime does nothing. */
	if (palette === base) {
		return {
			identity: true,
			palette: base,
			id,
			effectiveContrast: 0,
			requestedContrast: contrast,
			accentApplied,
			accentAdjusted,
		};
	}
	return {
		identity: false,
		palette,
		id: `lo-${paletteHash(palette)}`,
		effectiveContrast: contrasted.effectiveContrast,
		requestedContrast: contrast,
		accentApplied,
		accentAdjusted,
	};
};
