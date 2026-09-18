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
		 * The current row's own ground: `surface` stepped 6.31 `L*` down at the panel's own
		 * hue (its panel is neutral) and carried
		 * 0.00 `C*` against the panel's 0.00 — the panel's own colour, one step darker, which
		 * is what the operator asked for. ΔE00 from `surface` 3.84, from
		 * `elevated` 6.05, from `sunken` 0.65. Ink on this ground: `ink` 8.75:1,
		 * `ink-muted` 6.70:1, `ink-dim` 4.69:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `202606.66x` the panel's
		 * chroma (3.52 `C*` against 0.00), 88 degrees off its hue, ΔE00 4.03 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 */
		highlight: "#E2E2E2",

		ink: "#383A42",
		// Canonical mono-2 696C77 is 3.97:1 on `sunken` (< 4.5) — darkened along the same
		// neutral, and then seated deeper again so the readout rung below it clears the
		// ΔE00 8 ink step (mono-3 measured 1.6 from it).
		inkMuted: "#494B55",
		// Canonical mono-3 A0A1A7 is 1.96:1 on `sunken`, far under the 4.5 floor for a
		// tertiary weight. Darkened along its own neutral, and kept a distinct rung from
		// `inkMuted` above rather than collapsing the two.
		inkDim: "#616269",
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
		accentWash: "#E5E6EA",
		onAccent: "#EAEAEA",

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
