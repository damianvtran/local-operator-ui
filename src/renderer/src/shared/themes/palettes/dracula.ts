import type { ThemeDefinition } from "../palette-contract";

/**
 * Dracula.
 *
 * Values come from the upstream Dracula spec — background 282A36, darker
 * background 21222C, selection 44475A, foreground F8F8F2, comment 6272A4,
 * purple, pink, green, orange, red and cyan — and from the app's previous
 * dracula-theme.ts, which carried the same purple trio.
 *
 * The scheme already owns six named hues, so nothing here is invented: the
 * warning is Dracula's orange and the info is Dracula's cyan rather than a
 * fourth colour nobody could name.
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
export const dracula: ThemeDefinition = {
	id: "dracula",
	name: "Dracula",
	description: "Blue-grey ground with the signature Dracula purple.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.66, elevated +9.4, sunken -3.81 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #282A36 -> #282A36 (L* 17.34 -> 17.34)
		 * surface #2F3146 -> #2F3146 (L* 20.99 -> 20.99)
		 * elevated #3D4055 -> #3B3E53 (L* 27.61 -> 26.73)
		 * sunken #21222C -> #21222C (L* 13.53 -> 13.53)
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
		canvas: "#282A36",
		surface: "#2F3146",
		// The old theme used selection 44475A as its tooltip ground. Nothing that
		// light can carry a third ink weight — inkDim would have to land within a
		// hair of inkMuted to clear 4.5:1 on it — so elevated steps one stop back
		// down the same blue-grey ramp and selection stays available for hovers.
		elevated: "#3B3E53",
		sunken: "#21222C",

		/*
		 * The current row's own ground: `surface` stepped up its own blue-grey
		 * ramp 5.17 `L*`, at 1.20x the panel's chroma. ΔE00 4.11 from `surface`,
		 * 2.56 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 11.03 from `sunken`. The row is 1.189x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#36384d)
		 * stepped 3.16 `L*` off the panel, and this one steps 5.17. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 10.05:1, `ink-muted` 5.82:1, `ink-dim` 4.74:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 4.74:1. The step here is still partly chroma-bought (1.20x the panel's); the ordering
		 * above is what a re-authoring of this palette should follow.
		 */
		highlight: "#3a3c56",

		ink: "#F8F8F2",
		inkMuted: "#BFBFBF",
		// Dracula's comment blue, lightened until it clears 4.5:1 on all four
		// grounds. Comment itself is inkDisabled, where an inactive tone belongs:
		// inkDisabled is the one role the floors exempt.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.19:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#ABB4D1",
		inkDisabled: "#6272A4",

		hairline: "#4A4C5E",
		// The same comment blue lightened further. The old theme bounded every
		// input with white at 10 percent alpha, which measured about 1.2:1.
		borderControl: "#7D8BB4",

		/*
		 * Legibility pass: `accent` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.5:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		accent: "#C096FC",
		accentHover: "#D1AEFF",
		accentActive: "#A884DE",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.2 from `accent` and 7.29:1 on surface, where the accent
		// itself is 5.28:1. See `chartBarHover` in the palette contract.
		/*
		 * Legibility pass: `chartBarHover` follows `accent` - the ramp is one control seen
		 * three times and the chart's hover mark has to stay ΔE00 10 clear of the
		 * resting mark, so both move at their own hue rather than letting the accent
		 * pull away from them.
		 */
		chartBarHover: "#D6BBFE",
		tokenCommand: "#8BE9FD",
		/* The wire's own `info`, so the command word's rendering does not move. */
		accentWash: "#3A374D",
		onAccent: "#282A36",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#ff79c6`, canonical pink; purple is spent on accent),
		 * received unchanged because it already clears every floor — ΔE00 18.21
		 * from `accent`, 19.69 from its nearest semantic (`danger`), 5.34:1 as text
		 * on the tightest ground (`surface`).
		 */
		accentAlt: "#ff79c6",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 24.22 and C* 14.67, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 10.10 from `accentWash` (the field floor is
		 * 2.0), 4.79:1 for `accentAlt` on it, and 12.43 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#4C3240",

		success: "#50FA7B",
		successWash: "#2D433E",
		successBorder: "#3E9C5C",

		// Dracula's orange. The scheme's yellow F1FA8C also clears the floors but
		// reads as a highlighter next to the green, not as a caution.
		warning: "#FFB86C",
		warningWash: "#423B3C",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.01:1.
		 */
		warningBorder: "#A8825D",

		// Dracula's red is FF5555, which measures 4.05:1 on surface. This is the
		// smallest lift that clears 4.5:1 on surface and on its own wash.
		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.53:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 60.47 -> 50.37, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		danger: "#FF8784",
		dangerWash: "#422F3A",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.01:1.
		 */
		dangerBorder: "#CB6E73",

		// Dracula's cyan, an upstream hue, so this theme needs no invented blue.
		info: "#8BE9FD",
		infoWash: "#34414E",
		infoBorder: "#5E93A3",

		overlayShadow: "0 12px 32px -12px rgb(13 14 20 / 0.65)",
		scrim: "rgb(13 14 20 / 0.6)",
	},
};
