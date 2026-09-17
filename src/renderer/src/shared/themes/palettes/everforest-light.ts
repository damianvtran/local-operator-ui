import type { ThemeDefinition } from "../palette-contract";

/**
 * Everforest Light.
 *
 * The daylight half of `everforest.ts`, and a deliberate sibling: the same
 * olive-green accent row, the same yellow, red and blue-teal, over warmed
 * paper. A user who picks Everforest for its low strain should get the same
 * scheme at noon, so only lightness moves between the two files.
 *
 * The ground ladder takes upstream's own four rungs in this contract's order —
 * its bg fdf6e3 as `elevated`, its surface f4f0d9 as `surface`, its
 * highlight-med ddd8be as `sunken` — with `canvas` interpolated between the last
 * two in the ladder's own proportions. Adjacent steps measure ΔE00 2.4 / 3.0 /
 * 7.7, at or above the 2.0 at which the captured frames show a card reading as a
 * separate surface from its canvas.
 *
 * Roles upstream has no value for follow the derivation rules recorded in
 * `rose-pine.ts`. Two notes on the inks: upstream's dim and muted rungs are
 * nearly the same colour here (ΔE00 1.7), so the contract's ΔE00 8 ink step
 * is bought by pulling `inkMuted` toward `ink` — the readout rung has no room
 * of its own, sitting 0.04 above its 4.5:1 floor on the deepest ground.
 * `accent` is the olive upstream spends on its signature green, and `success`
 * is that same green rather than a second hue: the scheme's aqua and its green
 * are one family, and a green a reader cannot name against the accent is not
 * worth a semantic.
 */
export const everforestLight: ThemeDefinition = {
	id: "everforestLight",
	name: "Everforest Light",
	description: "Everforest by daylight: warm paper under a soft olive green.",
	palette: {
		mode: "light",

		canvas: "#EAE4C8",
		surface: "#F4EDD4",
		elevated: "#FDF6E3",
		sunken: "#DCD7BC",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.08 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 5.25 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.03 from `surface`, 6.91 from `elevated` and 2.16 from `sunken`;
		 * the step is -5.21 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.89:1 the ink that binds it.
		 */
		highlight: "#E4DFC0",

		ink: "#394246",
		inkMuted: "#3D4743",
		inkDim: "#546058",
		inkDisabled: "#A6B0A0",

		hairline: "#CAC5AC",
		borderControl: "#6E7D6D",

		// upstream's signature green, deepened for ink on this paper.
		accent: "#566201",
		accentHover: "#465001",
		accentActive: "#373E01",
		// ΔE00 10.5 from `accent` and 8.9:1 on surface, where the accent is
		// 5.7:1.
		chartBarHover: "#3A4400",
		accentWash: "#D9DDCE",
		onAccent: "#FDF6E3",

		success: "#566201",
		successWash: "#DAD6B2",
		successBorder: "#566201",

		warning: "#795700",
		warningWash: "#DFD6B4",
		warningBorder: "#795700",

		danger: "#B12624",
		dangerWash: "#E5D3B9",
		dangerBorder: "#B12724",

		// The aqua's own hue is carried by `infoBorder` rather than by a second
		// blue-green ink; see the header.
		info: "#235976",
		infoWash: "#E4D3C1",
		infoBorder: "#A7247E",

		overlayShadow: "0 12px 32px -12px rgb(92 106 114 / 0.28)",
		scrim: "rgb(60 68 66 / 0.45)",
	},
};
