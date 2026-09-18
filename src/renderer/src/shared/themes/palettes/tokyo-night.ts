import type { ThemeDefinition } from "../palette-contract";

/**
 * Tokyo Night.
 *
 * Carried from the upstream scheme: background 1A1B26, the raised blue-black,
 * foreground C0CAF5, comment 565F89, the blue and purple accents, and the
 * green, yellow, red and cyan that the scheme already names. The comment
 * colour does triple duty here as inkDisabled, hairline and — lightened —
 * the structural border.
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
export const tokyoNight: ThemeDefinition = {
	id: "tokyoNight",
	name: "Tokyo Night",
	description: "Deep blue-purple night with a bright blue accent.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +4.9, elevated +10.31, sunken -3.57 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #1A1B26 -> #1E1F2A (L* 10.13 -> 12.11)
		 * surface #24283B -> #25293C (L* 16.54 -> 17.01)
		 * elevated #2F334D -> #2A2E48 (L* 21.97 -> 19.70)
		 * sunken #14141B -> #18181F (L* 6.58 -> 8.54)
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
		canvas: "#1E1F2A",
		surface: "#25293C",
		elevated: "#2A2E48",
		// Upstream bg_dark is 16161E, which measures 1.05:1 against canvas. Two
		// levels deeper for a little more separation.
		sunken: "#18181F",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #2B2D34  accent hue, C* 4.88, +1.52 L*, ΔE00 6.42 off `surface`,
		 *                       `inkDim` 5.72:1 on the fill, hue 0.66° off `accent`.
		 * rowSelected #263453  accent hue, C* 21.10, +4.90 L*, ΔE00 6.00 off
		 *                       `surface` and 10.64 off `rowHover`, `inkDim` 5.15:1, and the
		 *                       2px `accent` bar at 4.91:1 against it.
		 */
		rowHover: "#2B2D34",
		rowSelected: "#263453",

		ink: "#C0CAF5",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.63:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#BBC3E8",
		// The comment blue lightened to clear 4.5:1 on all four grounds; the
		// comment colour itself is inkDisabled.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.2:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#9FA6C6",
		inkDisabled: "#565F89",

		hairline: "#3D4462",
		// The comment blue lightened again. The old theme used it at 30 percent
		// alpha for both the decorative rule and the input boundary, which put
		// every input at about 1.3:1.
		borderControl: "#757EA9",

		accent: "#7AA2F7",
		accentHover: "#9EBCFF",
		accentActive: "#6D8FDA",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 8.25:1 on surface, where the accent
		// itself is 5.78:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#AAC3FA",
		tokenCommand: "#7DCFFF",
		/* The wire's own `info`, so the command word's rendering does not move. */
		/*
		 * Legibility pass: the wash is a hover and callout tint, not a selection
		 * ground, and it gains one floor - ΔE00 2.0 against every ground it is painted
		 * on - because it reads 1.00-1.24:1, so no ratio assertion can see it.
		 * `surface` is the tightest base at ΔE00 2.04. Lightness only, at the
		 * wash's own hue.
		 */
		accentWash: "#2A2F44",
		onAccent: "#1A1B26",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#bb9af7`, canonical magenta), received unchanged because
		 * it already clears every floor — ΔE00 16.09 from `accent`, 27.11 from its
		 * nearest semantic (`danger`), 6.21:1 as text on the tightest ground
		 * (`surface`).
		 */
		accentAlt: "#bb9af7",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 19.81 and C* 14.38, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 6.12 from `accentWash` (the field floor is
		 * 2.0), 5.74:1 for `accentAlt` on it, and 5.78 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#342C41",

		// Upstream Tokyo Night green.
		success: "#9ECE6A",
		successWash: "#2A302E",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.31:1.
		 */
		successBorder: "#6C8754",

		// Upstream yellow.
		warning: "#E0AF68",
		warningWash: "#322D2E",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.29:1.
		 */
		warningBorder: "#967A56",

		// Upstream red.
		danger: "#F7768E",
		dangerWash: "#352632",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.29:1.
		 */
		dangerBorder: "#B66779",

		// Upstream cyan, so this theme needs no invented informational hue.
		info: "#7DCFFF",
		infoWash: "#263140",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.30:1.
		 */
		infoBorder: "#5684A3",

		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.7)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
