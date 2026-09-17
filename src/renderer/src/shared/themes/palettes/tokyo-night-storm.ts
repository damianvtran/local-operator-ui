import type { ThemeDefinition } from "../palette-contract";

/**
 * Tokyo Night Storm — the same scheme as the `tokyoNight` this app already ships, one step
 * lighter, and a sibling to it rather than a second theme.
 *
 * Upstream generates `storm` from `night` by lightening the ground and leaving the hues alone,
 * so the accent 7AA2F7, the hover 9EBCFF, the pressed 6D8FDA and the whole green/yellow/red/
 * cyan row are the SAME values `tokyo-night.ts` carries, and this file exists to move the
 * ground: page 24283B, surface 2B3048 and raised 333955 are upstream's own storm tones, and
 * sunken is the storm background-dark.
 *
 * The ground moving is the whole of the cost. Storm's page is what `night` uses as its
 * `surface`, so every ink here reads against a lighter plane: the readout tone `night` ships
 * measures 4.28:1 on storm's `elevated` — under the 4.5 floor — so `inkDim` is lifted a step,
 * `ink` needed a lift of a thousandth and the red a lift of a step. Each is recorded above its
 * own role.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1; a semantic
 * border walks its hue toward the ground to just above the 3:1 edge floor; the shadow and the
 * scrim are the ground tinted.
 */
export const tokyoNightStorm: ThemeDefinition = {
	id: "tokyoNightStorm",
	name: "Tokyo Night Storm",
	description:
		"The brighter night — indigo storm skies under the same neon accents.",
	palette: {
		mode: "dark",

		canvas: "#24283B",
		surface: "#2B3048",
		elevated: "#333955",
		sunken: "#1D2032",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.14 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 3.5 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.01 from `surface`, 2.1 from `elevated` and 9.2 from `sunken`;
		 * the step is 3.55 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.7:1 the ink that binds it.
		 */
		highlight: "#2D3858",

		// Upstream fg C0CAF5 is 7.00:1 on `elevated` — exactly the floor, with no room for
		// rounding. Lifted along the same periwinkle.
		ink: "#C1CBF6",
		inkMuted: "#B8C2EC",
		// The sibling's `inkDim` measures 4.28:1 on storm's lighter `elevated` — under the 4.5
		// floor. Lifted along the same comment blue.
		inkDim: "#99A4CD",
		inkDisabled: "#565F89",

		// The sibling's rule lightened by the same step the ground took, so it still holds
		// ΔE00 4.3 from every ground and 1.22-1.74:1 against them.
		hairline: "#3F4662",
		// Upstream fg_gutter 3B4261 is 1.36:1 against the grounds — a decorative value
		// in a structural role. Walked to 3.1:1 on the lightest ground, the value every
		// shipped palette's structural edge sits at.
		borderControl: "#7B84AB",

		accent: "#7AA2F7",
		accentHover: "#9EBCFF",
		accentActive: "#6D8FDA",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#AAC6FF",
		accentWash: "#283349",
		onAccent: "#1D2032",

		success: "#9ECE6A",
		successWash: "#40504B",
		successBorder: "#65922C",

		warning: "#E0AF68",
		warningWash: "#4C4649",
		warningBorder: "#AB7D34",

		// Upstream red F7768E is 4.27:1 on `elevated` (< 4.5) — the one content value storm's
		// lighter ground pushes under the floor. Lifted along the same rose.
		danger: "#FE7C94",
		dangerWash: "#3A2C3D",
		dangerBorder: "#D95B74",

		info: "#7DCFFF",
		infoWash: "#263A52",
		infoBorder: "#398DBA",

		// The shadow and scrim are the ground tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
