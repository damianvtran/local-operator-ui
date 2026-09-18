import type { ThemeDefinition } from "../palette-contract";

/**
 * One Light — Atom's official light syntax theme, and the daylight half of the pair with
 * `oneDark`; the same converted HSL source, the same accent row, the ground moved.
 *
 * Upstream (atom/one-light-syntax, styles/colors.less) defines this palette in HSL rather than
 * hex, so the values here are that source converted: mono-1 hsl(230,8%,24%) = 383A42, mono-2 =
 * 696C77, mono-3 = A0A1A7, hue-1 cyan 0184BC, hue-2 blue 4078F2, hue-3 purple A626A4, hue-4
 * green 50A14F, hue-5 red E45649, hue-6-2 orange C18401.
 *
 * One Light is tuned for syntax on white, where a hue only has to be distinguishable from its
 * neighbours; as UI state colours the accents land between 2.43:1 and 3.17:1 against the 4.5
 * floor. Each is darkened along its own hue, with the measured miss recorded per role.
 *
 * Upstream's page is FAFAFA — hsl(230,1%,98%), two percent off white — and a four-ground
 * ladder cannot be built upward from there: FAFAFA to pure white is ΔE00 1.00 in total, against
 * the ~2 per step this system sets as the visible threshold. So the ladder is seated lower and
 * upstream's own white sits at the TOP of it, the same move `localOperatorLight` makes. The
 * theme still reads as One Light because the ink and accent row carry the identity; the page
 * ground is the one value that has to move for elevation to be visible at all.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over the page at the strongest alpha that keeps its own ink at 4.5:1; a semantic
 * border walks its hue toward the ground to just above the 3:1 edge floor; the shadow and the
 * scrim are the ink tinted.
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
export const oneLight: ThemeDefinition = {
	id: "oneLight",
	name: "One Light",
	description: "Atom's daylight standard, cool white with the One accent row.",
	palette: {
		mode: "light",

		// Upstream's own white sits at the top of the ladder and the page is seated one
		// visible step below it, as the header explains. Steps measure ΔE00 2.20 / 2.10 /
		// 2.22.
		canvas: "#EAEAEA",
		surface: "#F4F4F4",
		elevated: "#FFFFFF",
		sunken: "#E1E0E0",
		/*
		 * The current row's own ground:
		 * `surface` cast 0.05 toward `accent` and stepped 3.18 on the `L*` axis — branch H
		 * of this port's selection rule. The cast is not decoration here: this palette's
		 * `accentWash` (the app's active-row tint, `bg-accent-wash`) sits close enough to its
		 * panel that a ground carrying only the band was ΔE00 **0.70** from the wash — the
		 * same mark as the app's other selected row — so the row ground has to separate from
		 * it by the contract's field floor: measured 2.92 here. ΔE00 4.03 from `surface`,
		 * 5.44 from `elevated`, 4.62 from `sunken`, `inkDim` 5.09:1.
		 */
		highlight: "#E5ECF1",

		ink: "#383A42",
		// Canonical mono-2 696C77 is 3.97:1 on `sunken` (< 4.5) — darkened along the same
		// neutral, and then seated deeper again so the readout rung below it clears the
		// ΔE00 8 ink step (mono-3 measured 1.6 from it).
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `sunken` binds it at 7.24:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#43454F",
		// Canonical mono-3 A0A1A7 is 1.96:1 on `sunken`, far under the 4.5 floor for a
		// tertiary weight. Darkened along its own neutral, and kept a distinct rung from
		// `inkMuted` above rather than collapsing the two.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `sunken` binds it at 5.05:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#5B5C63",
		inkDisabled: "#A0A1A7",

		hairline: "#CECED1",
		// Canonical mono-2, which clears the 3:1 structural floor on all four grounds
		// where it could not clear 4.5 as text.
		borderControl: "#696C77",

		// Canonical hue-2 blue 4078F2 is 3.07:1 on `sunken` (< 4.5). Darkened along the same
		// blue.
		accent: "#0E54EA",
		accentHover: "#0D46C1",
		accentActive: "#0A389B",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.3
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#0039B6",
		tokenCommand: "#006996",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#E5E6EA",
		onAccent: "#EAEAEA",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#a626a4`, canonical hue-3 purple — 5.86:1, untouched),
		 * received unchanged because it already clears every floor — ΔE00 24.22
		 * from `accent`, 35.23 from its nearest semantic (`danger`), 4.64:1 as text
		 * on the tightest ground (`sunken`).
		 */
		accentAlt: "#a626a4",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 91.32 and C* 2.09, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 2.39 from `accentWash` (the field floor is
		 * 2.0), 4.90:1 for `accentAlt` on it, and 2.71 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#E9E5E8",

		// Canonical hue-4 green 50A14F is 2.43:1 on `sunken` (< 4.5). Darkened along the
		// same green.
		success: "#376E36",
		successWash: "#E2E5E2",
		successBorder: "#41813F",

		// Canonical hue-6-2 orange C18401 is 2.43:1 on `sunken` (< 4.5). Darkened along the
		// same amber.
		warning: "#845A00",
		warningWash: "#E5E4E0",
		warningBorder: "#996901",

		// Canonical hue-5 red E45649 is 2.78:1 on `sunken` (< 4.5). Darkened along the same
		// red.
		danger: "#BC281A",
		dangerWash: "#E9E4E4",
		dangerBorder: "#DA3020",

		// Canonical hue-1 cyan 0184BC is 3.17:1 on `sunken` (< 4.5). Kept as the cyan rather
		// than a second blue so an info callout does not read as a primary action.
		info: "#006996",
		infoWash: "#E1E5E7",
		infoBorder: "#017AAE",

		// The shadow and scrim are the ink tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(56 58 66 / 0.22)",
		scrim: "rgb(56 58 66 / 0.35)",
	},
};
