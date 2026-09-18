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
		 * The three grounds around the canvas ship as L* offsets from it (surface
		 * +4.74, elevated +7.67, sunken -3.50 L*), which is what every ink, edge
		 * and wash block below is measured against - and the offsets the LEGIBILITY PASS
		 * recorded (surface +4.9, elevated +10.31, sunken -3.57 L*) ARE ITS AUTHORING INPUT, NOT THE SHIPPED
		 * RUNG: the row/hover pass moved `elevated` down to the ladder's floor so the
		 * current row can outrank a hovered neighbour. Measured, both moves:
		 * canvas #1A1B26 -> #1E1F2A -> #2A2A35  (L* 10.13 -> 12.11 -> 17.48)
		 * surface #24283B -> #25293C -> #313448  (L* 16.54 -> 17.01 -> 22.22)
		 * elevated #2F334D -> #2A2E48 -> #363A55  (L* 21.97 -> 19.70 -> 25.16)
		 * sunken #14141B -> #18181F -> #23232A  (L* 6.58 -> 8.54 -> 13.98)
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
		canvas: "#2A2A35",
		surface: "#313448",
		elevated: "#363A55",
		// Upstream bg_dark is 16161E, which measures 1.05:1 against canvas. Two
		// levels deeper for a little more separation.
		sunken: "#23232A",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #363940  accent hue, C* 4.79, +1.72 L*, ΔE00 7.05 off `surface`,
		 *                       `inkDim` 5.59:1 on the fill, hue 5.93° off `accent`.
		 * rowSelected #333F5F  accent hue, C* 21.05, +4.75 L*, ΔE00 5.98 off
		 *                       `surface` and 10.76 off `rowHover`, `inkDim` 5.03:1, and the
		 *                       2px `accent` bar at 4.23:1 against it.
		 */
		rowHover: "#363940",
		rowSelected: "#333F5F",

		/*
		 * Register re-solve: `ink`
		 * The transcript's ink re-seats with the band, at its own hue. Its floor is
		 * 8:1 on `canvas` and 7:1 on all SEVEN grounds; `rowSelected` binds it at
		 * 7.69:1.
		 * It gives up 4.59 C* (22.95 -> 18.36), because the ladder's own
		 * ΔE00 2 step above `inkMuted` puts the value at L* 88.23, where this hue
		 * sustains at most C* 18.52 - R2's `or the maximum its own hue sustains`
		 * clause, measured on the lattice rather than assumed.
		 */
		ink: "#D5DCFF",
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
		/*
		 * Register re-solve: `inkMuted`
		 * Re-seated a second time, with the band, and lightness is still the only
		 * axis: the floor is 5.5:1 on all SEVEN grounds (the four elevation
		 * steps, `accentWash` and the two row states), and `rowSelected` binds it at
		 * 7.12:1.
		 * The contract's 8 ΔE00 step down to `inkDim` measures
		 * 8.45, and it is what sets the value as much as the floor does.
		 */
		inkMuted: "#CCD4FA",
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
		/*
		 * Register re-solve: `inkDim`
		 * Re-seated a second time, with the band, and lightness is still the only
		 * axis: the floor is 5:1 on all SEVEN grounds (the four elevation
		 * steps, `accentWash` and the two row states), and `rowSelected` binds it at
		 * 5.03:1.
		 * The contract's 8 ΔE00 step up to `inkMuted` measures
		 * 8.45, and it is what sets the value as much as the floor does.
		 */
		inkDim: "#ACB3D4",
		inkDisabled: "#565F89",

		/*
		 * Register re-solve: `hairline`
		 * The one role whose rule binds at BOTH ends, so it is re-solved against all
		 * four grounds at once: a rule has to be seen (ΔE00 4.0) without becoming a
		 * border (2:1), and the window is walked at the role's own hue. Its ratio
		 * lands at 1.20:1 against `elevated` at its tightest.
		 */
		hairline: "#3F4664",
		// The comment blue lightened again. The old theme used it at 30 percent
		// alpha for both the decorative rule and the input boundary, which put
		// every input at about 1.3:1.
		/*
		 * Register re-solve: `borderControl`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.01:1. Lightness only, at the role's own
		 * hue.
		 */
		borderControl: "#7A83AF",

		accent: "#7CA4F9",
		accentHover: "#9EBCFF",
		accentActive: "#6D8FDA",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 8.25:1 on surface, where the accent
		// itself is 5.78:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#B3CBFF",
		tokenCommand: "#7DCFFF",
		/* The wire's own `info`, so the command word's rendering does not move. */
		/*
		 * Legibility pass: the wash is a hover and callout tint, not a selection
		 * ground, and it gains one floor - ΔE00 2.0 against every ground it is painted
		 * on - because it reads 1.00-1.24:1, so no ratio assertion can see it.
		 * `surface` is the tightest base at ΔE00 2.04. Lightness only, at the
		 * wash's own hue.
		 */
		accentWash: "#363A50",
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
		 * receives: `accentWash`'s own L* 24.92 and C* 14.54, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 5.98 from `accentWash` (the field floor is
		 * 2.0), 4.85:1 for `accentAlt` on it, and 5.77 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#40374D",

		// Upstream Tokyo Night green.
		success: "#9ECE6A",
		successWash: "#2A302E",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.31:1.
		 */
		/*
		 * Register re-solve: `successBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.04:1. Lightness only, at the role's own
		 * hue.
		 */
		successBorder: "#738E5B",

		// Upstream yellow.
		warning: "#E0AF68",
		warningWash: "#322D2E",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.29:1.
		 */
		/*
		 * Register re-solve: `warningBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.03:1. Lightness only, at the role's own
		 * hue.
		 */
		warningBorder: "#9D815D",

		// Upstream red.
		danger: "#FE7C94",
		dangerWash: "#352632",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.29:1.
		 */
		/*
		 * Register re-solve: `dangerBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.03:1. Lightness only, at the role's own
		 * hue.
		 */
		dangerBorder: "#BE6E80",

		// Upstream cyan, so this theme needs no invented informational hue.
		info: "#7DCFFF",
		infoWash: "#263140",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.30:1.
		 */
		/*
		 * Register re-solve: `infoBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.03:1. Lightness only, at the role's own
		 * hue.
		 */
		infoBorder: "#5D8BAA",

		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.7)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
