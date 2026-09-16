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

		ink: "#363557",
		inkMuted: "#545363",
		inkDim: "#57544F",
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
