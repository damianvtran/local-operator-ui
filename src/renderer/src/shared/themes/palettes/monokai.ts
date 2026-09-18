import type { ThemeDefinition } from "../palette-contract";

/**
 * Monokai.
 *
 * Upstream Monokai is unusually complete for this contract: background
 * 272822, line highlight 3E3D32, foreground F8F8F2, comment 75715E, plus a
 * green, an orange, a yellow, a pink and a blue. Only the recessed ground,
 * the structural border and the wash tints are derived.
 *
 * ## The legibility pass, and what this file's numbers mean
 *
 * The grounds, ink weights and edges in this file were re-authored against the
 * pass's floors (see `docs/branding.md` § 2-3 and `scripts/contrast-contract.mjs`,
 * which asserts all of them): no page ground below L* 12 in a dark theme or above
 * L* 94 in a light one, a `surface` 2.5-5.0 L* above the canvas, an `elevated`
 * 2.5-6.0 above that, a `sunken` 1.5-6.0 below it, and the three ink weights at
 * 7.0 / 5.5 / 5.0:1 on all SIX grounds - the four elevation steps plus the two
 * that carry state, `accentWash` and `highlight`.
 *
 * Every other measurement quoted below was taken when the role above it was
 * authored, against the ground values as they stood THEN - a measurement is of a
 * moment, and this repository keeps the reading rather than silently refreshing
 * it. The pass's own values are the numbers in the blocks it added; the ones it
 * did not touch are unchanged and still measure what they say.
 */
export const monokai: ThemeDefinition = {
	id: "monokai",
	name: "Monokai",
	description: "The Monokai scheme: olive-black ground with the acid green.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.26, elevated +8.85, sunken -4.33 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #272822 -> #272822 (L* 15.82 -> 15.82)
		 * surface #2E2F28 -> #2E2F28 (L* 19.09 -> 19.09)
		 * elevated #3E3D32 -> #3C3B31 (L* 25.54 -> 24.67)
		 * sunken #1E1F1A -> #1E1F1A (L* 11.49 -> 11.49)
		 *
		 * ONLY LIGHTNESS MOVED. Each value holds its own `a` and `b`, so the theme's
		 * hue and chroma class are exactly what they were and chroma is scaled only
		 * where sRGB forces it - a lift that neutralised a palette to satisfy a floor
		 * would be a different theme, not a lighter one.
		 *
		 * THE GROUNDS AND THE INKS MOVED TOGETHER, and the header of this file says why:
		 * lifting a dark ground raises the luminance every ink is measured against, so
		 * the inks in this file were re-seated on the same commit rather than after it.
		 */
		canvas: "#272822",
		// Canvas and elevated are upstream's background and line highlight; surface
		// is the derived step between them, so it is the one that moves. 2D2E27 sat
		// ΔE00 1.95 from canvas — a card edge that is not there. One unit up the
		// same olive ramp reads 2.26, and still leaves 5.05 up to elevated.
		surface: "#2E2F28",
		elevated: "#3C3B31",
		sunken: "#1E1F1A",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 4.7 `L*` lighter (branch L of this port's selection rule), and
		 * carrying 1.52x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `ink-dim` at 5.18:1 on
		 * the row's ground. ΔE00 4.04 from `surface`, 2.07 from `elevated`, 8.97
		 * from `sunken`, 7.42 from `accentWash`; the inks on the ground are 10.86:1,
		 * 6.29:1, 5.18:1. Continuity with the panel: hue 1.28 degrees off the
		 * panel's (the assertion allows 12) and chroma 7.31 where the panel carries
		 * 4.8.
		 */
		highlight: "#383a2f",

		ink: "#F8F8F2",
		inkMuted: "#BFBFBF",
		// Monokai's comment 75715E, lightened until it clears 4.5:1 on the line
		// highlight ground. The comment colour itself stays as inkDisabled.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `accentWash` binds it at 5.03:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#B1AE9C",
		inkDisabled: "#75715E",

		hairline: "#464740",
		// The comment colour lightened further, so a structural boundary is legally
		// distinct from the decorative hairline above it.
		borderControl: "#8E8A73",

		accent: "#A6E22E",
		accentHover: "#B6E94E",
		accentActive: "#8BC220",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 10.65:1 on surface, where the accent
		// itself is 8.72:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#D0F090",
		tokenCommand: "#66D9EF",
		/* The wire's own `info`, so the command word's rendering does not move. */
		accentWash: "#363E23",
		onAccent: "#272822",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#ae81ff`), received unchanged because it already clears
		 * every floor — ΔE00 83.41 from `accent`, 25.77 from its nearest semantic
		 * (`danger`), 4.75:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#ae81ff",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 24.80 and C* 17.82, with the hue moved to
		 * `accentAlt`'s, with the L* walked -4.00 because the chip's own ink floor
		 * binds (`accentAlt` on the wash needs 4.5:1). Measured: ΔE00 33.37 from
		 * `accentWash` (the field floor is 2.0), 4.52:1 for `accentAlt` on it, and
		 * 20.95 from the nearest ground it is painted on.
		 */
		accentAltWash: "#382D47",

		// The same green as the accent. Monokai has exactly one green, and a second
		// one invented to fill this role would be a colour no Monokai user
		// recognises. A green success next to a green primary button is the honest
		// reading of this scheme.
		success: "#A6E22E",
		successWash: "#363E23",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.02:1.
		 */
		successBorder: "#6E8F2A",

		// Monokai's orange.
		warning: "#FD971F",
		warningWash: "#413522",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		warningBorder: "#B3772D",

		// Monokai's pink is F92672, which measures 4.19:1 on canvas. This is the
		// smallest lift that clears 4.5:1 on both grounds and on its own wash.
		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.5:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 63.64 -> 56, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		danger: "#FF77A3",
		dangerWash: "#40282C",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.01:1.
		 */
		dangerBorder: "#DE527E",

		// Monokai's blue.
		info: "#66D9EF",
		infoWash: "#2F3D3B",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		infoBorder: "#4F8D97",

		overlayShadow: "0 12px 32px -12px rgb(15 15 12 / 0.65)",
		scrim: "rgb(15 15 12 / 0.6)",
	},
};
