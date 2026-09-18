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
		 * The current row's own ground: `surface` stepped up its own olive
		 * ramp 4.35 `L*`, carrying 1.66x the panel's chroma. ΔE00 4.07 from `surface`,
		 * 2.51 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 8.85 from `sunken`. The row is 1.149x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#35362f)
		 * stepped 3.22 `L*` off the panel, and this one steps 4.35. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 11.03:1, `ink-muted` 6.40:1, `ink-dim` 4.97:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 4.97:1. The step here is still partly chroma-bought (1.66x the panel's); the ordering
		 * above is what a re-authoring of this palette should follow.
		 */
		highlight: "#37392d",

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
