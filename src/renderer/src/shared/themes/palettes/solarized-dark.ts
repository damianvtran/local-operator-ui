import type { ThemeDefinition } from "../palette-contract";

/**
 * Solarized Dark — Ethan Schoonover's Solarized, dark variant, from the scheme's own published
 * palette (base03 002B36 as the page, base02 073642 as the raised step, base01 586E75, base0
 * 839496, base1 93A1A1, and the accent set cyan 2AA198, green 859900, yellow B58900, red
 * DC322F, blue 268BD2).
 *
 * Solarized is a precision palette: its whole argument is that a fixed set of sixteen tones
 * renders correctly on two grounds, and it was never asked to clear a 7:1 body floor. Three
 * consequences, all measured at the role below. Its body ink is a syntax tone at 6.1:1 and had
 * to be lifted; its lower weights are the same tone family packed within ΔE00 4 of each other,
 * so they are re-seated to hold this contract's 8 ink step; and every accent needed a lift of
 * between 0.3 and 1.1 contrast points along its own hue to clear 4.5:1 as UI text.
 *
 * The ladder needs one derived ground that upstream does not have: base03 to base02 is ΔE00
 * 3.4 in total and two 2.0 steps do not fit inside it, so `elevated` sits one step above base02
 * and the rest of the ramp is upstream's own.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the ground tinted.
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
export const solarizedDark: ThemeDefinition = {
	id: "solarizedDark",
	name: "Solarized Dark",
	description:
		"Schoonover's precision dark — deep teal-black with a cyan accent.",
	palette: {
		mode: "dark",

		canvas: "#002B36",
		// A step between base03 and base02, because the scheme's own two ground tones are
		// ΔE00 3.4 apart and this ladder needs a rung in between.
		surface: "#05333F",
		// A step ABOVE base02: base03 to base02 measures ΔE00 3.4 in total, so two 2.0
		// steps cannot fit inside upstream's ramp and the top ground is derived.
		elevated: "#093A46",
		sunken: "#00252E",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #2A3432  accent hue, C* 4.73, +1.70 L*, ΔE00 9.72 off `surface`,
		 *                       `inkDim` 5.41:1 on the fill, hue 4.54° off `accent`.
		 * rowSelected #203C39  accent hue, C* 11.57, +4.07 L*, ΔE00 8.67 off
		 *                       `surface` and 6.78 off `rowHover`, `inkDim` 5.01:1, and the
		 *                       2px `accent` bar at 4.50:1 against it.
		 */
		rowHover: "#2A3432",
		rowSelected: "#203C39",

		// Upstream base1 93A1A1 — the tone the scheme paints body text with — is 6.13:1 on
		// `elevated`, under the 7:1 floor. Lifted along the same grey-teal.
		/*
		 * Legibility pass: `ink` is re-seated on the lifted grounds, where its floor
		 * is 7:1 on all six grounds and `elevated` binds it at 7.63:1.
		 *
		 * It also carries the transcript's own 8.0:1 on `canvas`, which is the
		 * surface the operator's report is about.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		ink: "#C2CECE",
		// Base1 and base0 sit ΔE00 4.5 apart, so the readout rung below could not hold the
		// 8 ink step against upstream's control tone. This is base1's own grey-teal seated a
		// step up, which keeps the readout rung quiet and still distinct.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.13:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#B9C8C8",
		// Base0 839496 is 3.77:1 on `elevated` (< 4.5) and only ΔE00 4 from base1. Lifted
		// along the same grey-teal to the floor corner, which is also what separates it from
		// the control rung above.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.19:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#98ACAE",
		inkDisabled: "#586E75",

		// Derived: the scheme's recessed tones are panel fills, not 1px lines. Holds ΔE00
		// 4.2 from every ground and 1.22-1.64:1 against them.
		hairline: "#1E4955",
		// Base01 586E75 is 1.14:1 against the grounds — an inactive-tone value in a
		// structural role. Lifted along the same grey-teal to 3.1:1 on the lightest
		// ground.
		borderControl: "#5B8893",

		// Upstream cyan 2AA198 is 3.78:1 on `elevated` (< 4.5). Lifted along the same cyan;
		// the scheme's defining hue, kept.
		/*
		 * Legibility pass: `accent` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.52:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		accent: "#3DB0A5",
		accentHover: "#53C3B8",
		// A step toward the ground from the accent: the pressed fill has to stay an edge on
		// the lightest ground and keep the page tone legible on itself.
		accentActive: "#249D94",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		/*
		 * Legibility pass: `chartBarHover` follows `accent` - the ramp is one control seen
		 * three times and the chart's hover mark has to stay ΔE00 10 clear of the
		 * resting mark, so both move at their own hue rather than letting the accent
		 * pull away from them.
		 */
		chartBarHover: "#66D5C9",
		tokenCommand: "#53A7EB",
		// The signal lifted in L* to clear 4.5:1 on `elevated` (it measured 4.05), at a
		// cost of ΔE00 3.31 from the signal itself; 5.22:1 on `surface`.
		/*
		 * Legibility pass: the wash is a hover and callout tint, not a selection
		 * ground, and it gains one floor - ΔE00 2.0 against every ground it is painted
		 * on - because it reads 1.00-1.24:1, so no ratio assertion can see it.
		 * `surface` is the tightest base at ΔE00 2.22. Lightness only, at the
		 * wash's own hue.
		 */
		accentWash: "#00323B",
		onAccent: "#00252E",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#8489d4`),
		 * moved onto the floors: as received it read 4.20:1 as text on `surface`.
		 * The shortfall is paid on LIGHTNESS at the source hue — L* 59.48 → 61.87 —
		 * which is what this port does to every one of its own tokens. Measured:
		 * ΔE00 32.58 from `accent`, 37.00 from its nearest semantic (`danger`),
		 * 4.54:1 on the tightest ground (`surface`).
		 */
		accentAlt: "#8B8FDB",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 18.35 and C* 15.43, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 19.09 from `accentWash` (the field floor is
		 * 2.0), 4.64:1 for `accentAlt` on it, and 17.32 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#2A2B41",

		// Upstream green 859900 is 3.72:1 on `elevated` (< 4.5). Lifted along the same
		// olive.
		/*
		 * Legibility pass: `success` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.52:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		success: "#94A91F",
		successWash: "#0B3338",
		successBorder: "#778A01",

		// Upstream yellow B58900 is 3.72:1 on `elevated` (< 4.5). Lifted along the same
		// amber.
		warning: "#C79A27",
		warningWash: "#223B3A",
		warningBorder: "#A37B02",

		// The scheme's red DC322F is unreadable as UI text on this ground (2.58:1); lifted
		// along the same red, which is the one hue Solarized uses for a warning about real
		// failure.
		danger: "#FF776B",
		dangerWash: "#2A2028",
		dangerBorder: "#DA554C",

		// Upstream blue 268BD2 is 3.24:1 on `elevated` (< 4.5). Lifted along the same blue,
		// and kept distinct from the cyan accent so a callout does not read as a primary
		// action.
		/*
		 * Legibility pass: `info` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.52:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		info: "#49A6EC",
		infoWash: "#023241",
		infoBorder: "#2087CB",

		// The shadow and scrim are the ground tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
