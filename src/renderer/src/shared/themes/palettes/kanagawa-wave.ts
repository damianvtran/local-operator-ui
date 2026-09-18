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
		 * The current row's own ground: `surface` stepped 5.97 `L*` up at the panel's own
		 * hue (0.4 degrees off, inside the 12-degree bound) and carried
		 * 8.65 `C*` against the panel's 9.02 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 4.17, from
		 * `elevated` 1.53, from `sunken` 10.94. Ink on this ground: `ink` 8.07:1,
		 * `ink-muted` 6.37:1, `ink-dim` 4.81:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `1.28x` the panel's
		 * chroma (11.53 `C*` against 9.02), 10 degrees off its hue, ΔE00 4.04 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * THE HOVER STEP IS THE COLLISION: 1.53 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_HOVER_PINS` and is
		 * on the row-hover work list.
		 */
		highlight: "#373744",

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
