import type { ThemeDefinition } from "../palette-contract";

/**
 * Kanagawa Lotus.
 *
 * The daylight half of `kanagawa-wave.ts`: the same Hokusai ink-wash palette
 * over the `lotus` variant's yellowed paper, so the pair stays recognisably one
 * scheme. The spring green, the carp yellow, the peach red and the wave aqua
 * are the same hues as in Wave; only their lightness and the ground changed.
 *
 * The ground ladder takes upstream's own rungs in this contract's order — its
 * bg f2ecbc as `elevated`, its overlay d5cea3 as `sunken` — with the two middle
 * steps interpolated in the ladder's own proportions. Adjacent steps measure
 * ΔE00 2.7 / 2.3 / 7.5, at or above the 2.0 at which the captured frames show a
 * card reading as a separate surface from its canvas.
 *
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`.
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
export const kanagawaLotus: ThemeDefinition = {
	id: "kanagawaLotus",
	name: "Kanagawa Lotus",
	description:
		"Hokusai by daylight: yellowed paper under indigo and lotus pink.",
	palette: {
		mode: "light",

		canvas: "#DFD7A8",
		surface: "#E9E2B6",
		elevated: "#F2ECBC",
		sunken: "#D3CB9C",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.02 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 6.25 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.06 from `surface`, 6.21 from `elevated` and 2.14 from `sunken`;
		 * the step is -6.16 `L*`, in the band this branch raised to 4.0, with
		 * inkMuted at 4.84:1 the ink that binds it.
		 */
		highlight: "#D6D1A7",

		/*
		 * Legibility pass: `ink` is re-seated on the lifted grounds, where its floor
		 * is 7:1 on all six grounds and `sunken` binds it at 7.13:1.
		 *
		 * It also carries the transcript's own 8.0:1 on `canvas`, which is the
		 * surface the operator's report is about.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		ink: "#353556",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `sunken` binds it at 5.53:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#484757",
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `sunken` binds it at 5.04:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#514E4A",
		inkDisabled: "#8A8980",

		hairline: "#C2BA8E",
		borderControl: "#716E61",

		// crystalBlue, deepened for ink on this paper — the same hue family as
		// the Wave accent.
		accent: "#384C70",
		accentHover: "#2C3C58",
		accentActive: "#3F557E",
		// ΔE00 10.4 from `accent` and 10.6:1 on surface, where the accent is
		// 6.6:1.
		chartBarHover: "#1A2C4E",
		tokenCommand: "#5F4A7F",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#CFCEA9",
		onAccent: "#F2ECBC",

		success: "#495933",
		successWash: "#D2CC9E",
		successBorder: "#4A5B34",

		warning: "#6B4F13",
		warningWash: "#D5CB9B",
		warningBorder: "#6D5115",

		danger: "#992B3B",
		dangerWash: "#D9C89E",
		dangerBorder: "#9B2C3C",

		// `label` from the TUI port — Kanagawa spends its violet on metadata,
		// which this contract renders as `info`.
		info: "#5F4A7F",
		infoWash: "#D3CAA4",
		infoBorder: "#614B81",

		overlayShadow: "0 12px 32px -12px rgb(84 84 100 / 0.3)",
		scrim: "rgb(67 67 108 / 0.45)",
	},
};
