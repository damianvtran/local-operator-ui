import type { ThemeDefinition } from "../palette-contract";

/**
 * Kanagawa Wave.
 *
 * Carried from rebelot/kanagawa.nvim, the default `wave` variant, resolved
 * through `lua/kanagawa/themes.lua` rather than read off the palette names: the
 * scheme's own `ui.bg` is sumiInk3, with sumiInk4 and sumiInk5 above it and
 * sumiInk0 below, which is exactly the four grounds this contract wants.
 *
 * Kanagawa's ink-wash ground is dark enough that most of the palette clears the
 * floors unmodified — fujiWhite, oldWhite, springGreen, carpYellow and the aqua
 * all ship canonical. Three roles move, each for the reason recorded beside it.
 *
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`.
 */
export const kanagawaWave: ThemeDefinition = {
	id: "kanagawaWave",
	name: "Kanagawa Wave",
	description: "Hokusai ink-wash night, muted paper tones on deep sumi.",
	palette: {
		mode: "dark",

		canvas: "#1F1F28",
		surface: "#2A2A37",
		elevated: "#363646",
		sunken: "#16161D",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.14 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 4.25 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.04 from `surface`, 2.66 from `elevated` and 10.56 from `sunken`;
		 * the step is 4.34 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 5.08:1 the ink that binds it.
		 */
		highlight: "#2F3445",

		// fujiWhite, 8.16:1 on the lightest ground.
		ink: "#DCD7BA",
		// oldWhite.
		inkMuted: "#C8C093",
		// springViolet1 938AA9 is 3.64:1 on `elevated`, under the 4.5 floor;
		// lifted on-hue.
		inkDim: "#A9A3B8",
		// fujiGray, the scheme's own comment colour.
		inkDisabled: "#727169",

		// sumiInk5 is `elevated` itself; sumiInk6 54546D is 1.62:1 on it — a
		// ground colour, not a rule. Lifted along the same violet-grey.
		hairline: "#424353",
		borderControl: "#7E7E9C",

		// crystalBlue 7E9CD8 is 4.31:1 on `elevated`, and solving at the 4.5
		// floor leaves no room for a darker `accentActive`. Lifted to 5.25:1 so
		// all three accent states separate.
		accent: "#94ADDF",
		accentHover: "#AFC2E7",
		accentActive: "#83A0DA",
		// ΔE00 10.5 from `accent` and 9.6:1 on surface, where the accent is
		// 6.3:1.
		chartBarHover: "#BBD6FF",
		tokenCommand: "#7DAAA1",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#2A2D3A",
		onAccent: "#1F1F28",

		// springGreen.
		success: "#98BB6C",
		successWash: "#2A2D2E",
		successBorder: "#98BB6C",

		// carpYellow.
		warning: "#E6C384",
		warningWash: "#343032",
		warningBorder: "#E6C384",

		// peachRed FF5D62 is 3.94:1 on `elevated`; lifted on-hue.
		danger: "#FF777A",
		dangerWash: "#32262F",
		dangerBorder: "#FF7478",

		// waveAqua2 7AA89F clears the floor at 4.47:1 on `elevated`, a hair
		// under 4.5; nudged on-hue to 4.59:1.
		info: "#7DAAA1",
		infoWash: "#2C3238",
		infoBorder: "#7CA9A0",

		overlayShadow: "0 12px 32px -12px rgb(12 12 17 / 0.72)",
		scrim: "rgb(12 12 17 / 0.62)",
	},
};
