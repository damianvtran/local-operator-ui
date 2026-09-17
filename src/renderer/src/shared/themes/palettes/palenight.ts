import type { ThemeDefinition } from "../palette-contract";

/**
 * Palenight.
 *
 * Carried from Material Palenight — the Material Theme's blue-violet night:
 * the navy ground, the soft violet accent, and the scheme's green, orange, red
 * and cyan.
 *
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`. Three values need more than those rules, and each is the
 * reason recorded beside it:
 *
 * - `danger` is upstream's own red f07178, lifted. At the lifted pink the port
 *   first carried it sat ΔE00 12.2 from the scheme's orange, under the 15 the
 *   contract wants between two semantics a reader meets alone and has to name.
 * - `onAccent` is the page ground stepped darker. Palenight's accent ramp runs
 *   from C792EA to D9B4F1 — all of it far LIGHTER than the ground — so unlike
 *   every other dark palette here, the label on a contained button cannot be
 *   the canvas colour and still clear 4.5:1 on the fill.
 */
export const palenight: ThemeDefinition = {
	id: "palenight",
	name: "Palenight",
	description: "Material Palenight: deep navy under a soft violet accent.",
	palette: {
		mode: "dark",

		canvas: "#292D3E",
		surface: "#2F3446",
		elevated: "#353B4E",
		sunken: "#232736",

		/*
		 * The current row's own ground:
		 * a cast of `surface`'s chroma plane toward `accent` at alpha
		 * 0.050, L* held — branch H, taken because no step on this
		 * palette's lightness ladder clears `elevated` inside the band.
		 * ΔE00 2.38 from `surface`, 3.47 from `elevated` and 5.10 from
		 * `sunken`.
		 */
		highlight: "#313348",

		ink: "#EEFFFF",
		inkMuted: "#BBC2E3",
		inkDim: "#A0A5BE",
		inkDisabled: "#676E95",

		hairline: "#43475B",
		borderControl: "#8287A8",

		accent: "#C792EA",
		accentHover: "#D9B4F1",
		accentActive: "#B874E4",
		// ΔE00 10.4 from `accent` and 7.6:1 on surface, where the accent is
		// 5.1:1.
		chartBarHover: "#EEB8FF",
		accentWash: "#2F3145",
		onAccent: "#252939",

		success: "#C3E88D",
		successWash: "#2D3240",
		successBorder: "#AADF5E",

		warning: "#F78C6C",
		warningWash: "#303040",
		warningBorder: "#F5724B",

		// upstream's red, lifted; see the header.
		danger: "#FF7E96",
		dangerWash: "#303041",
		dangerBorder: "#FF7E96",

		info: "#89DDFF",
		infoWash: "#2C3345",
		infoBorder: "#50CCFF",

		overlayShadow: "0 12px 32px -12px rgb(32 35 49 / 0.65)",
		scrim: "rgb(32 35 49 / 0.6)",
	},
};
