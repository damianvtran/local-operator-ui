import type { ThemeDefinition } from "../palette-contract";

/**
 * Ayu Mirage.
 *
 * The middle of the Ayu family — `ayu-dark.ts` below it, `ayu-light.ts` above —
 * and the same scheme at a warmer temperature: the ground is a blue-grey slate
 * rather than a near-black blue, and the accent, green, orange, red and violet
 * are Ayu's own. That shared accent row is what keeps the three recognisable as
 * one family, so none of it is re-derived here.
 *
 * Mirage's ladder is upstream's own at its own spacing (bg 242936 to raised
 * 2e3544 measures ΔE00 3.9), which already clears this contract's field floor.
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`.
 */
export const ayuMirage: ThemeDefinition = {
	id: "ayuMirage",
	name: "Ayu Mirage",
	description: "Ayu's mirage: blue-grey ground with the same azure accent.",
	palette: {
		mode: "dark",

		canvas: "#242936",
		surface: "#2E3544",
		elevated: "#39404F",
		sunken: "#191D27",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.08 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 4 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.14 from `surface`, 2.95 from `elevated` and 11.3 from `sunken`;
		 * the step is 4.02 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.73:1 the ink that binds it.
		 */
		highlight: "#313F50",

		ink: "#D6D5CE",
		// upstream's blue-tinted muted rung.
		inkMuted: "#B8CFE6",
		inkDim: "#9DAEC2",
		inkDisabled: "#707A8C",

		hairline: "#414B60",
		borderControl: "#7E8BA4",

		// the family's azure.
		accent: "#73D0FF",
		accentHover: "#97DCFF",
		accentActive: "#23B5FF",
		// ΔE00 10.6 from `accent` and 9.1:1 on surface, where the accent is
		// 7.1:1.
		chartBarHover: "#8EECFF",
		accentWash: "#2A3949",
		onAccent: "#1F2430",

		success: "#D5FF80",
		successWash: "#2F363A",
		successBorder: "#D5FF80",

		warning: "#FFD173",
		warningWash: "#38383B",
		warningBorder: "#FFD173",

		danger: "#F39185",
		dangerWash: "#39333E",
		dangerBorder: "#F39185",

		info: "#DFBFFF",
		infoWash: "#3A3A4D",
		infoBorder: "#DFBFFF",

		overlayShadow: "0 12px 32px -12px rgb(16 19 26 / 0.72)",
		scrim: "rgb(16 19 26 / 0.6)",
	},
};
