import type { ThemeDefinition } from "../palette-contract";

/**
 * Gruvbox (medium contrast) — morhetz's own dark mode, from colors/gruvbox.vim.
 *
 * bg0 282828 is the page, bg0_h 1D2021 is the well below it and bg1 3C3836 is the raised
 * ground; bg2 504945 is ΔE00 6.1 above bg1, which is a step this ladder does not need, so
 * `surface` is seated between bg0 and bg1 and the remaining separation is left to the
 * structural role below. The ink weights are the scheme's own warm greys — fg1 EBDBB2 as the
 * body, fg2 D5C4A1 as the control rung and fg3 BDAE93 as the readout, with fg4/gray 928374 as
 * the inactive tone.
 *
 * Gruvbox's identity is its BRIGHT accent set, and it is carried unmodified: yellow FABD2F as
 * the accent, green B8BB26, orange FE8019, neutral aqua 83A598 as `info`. The one content value
 * that had to move is the bright red FB4934, which is 3.37:1 on `elevated` — under the 4.5
 * floor — and is lifted along its own hue, the only recorded miss in the palette.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the ground tinted.
 */
export const gruvbox: ThemeDefinition = {
	id: "gruvbox",
	name: "Gruvbox",
	description:
		"Retro groove after dark — warm charcoal under the gruvbox brights.",
	palette: {
		mode: "dark",

		canvas: "#282828",
		// Seated between bg0 and bg1: bg2 504945 is a step this ladder does not need, and
		// spending it here would cost every ink headroom on the binding ground.
		surface: "#32302F",
		elevated: "#3C3836",
		sunken: "#1D2021",

		/*
		 * The current row's own ground:
		 * `surface` stepped 6.25 on the `L*` axis in the mode's direction — the
		 * neutral step, branch L of this port's selection rule; the ramp affords it here,
		 * so the row takes no cast. ΔE00 4.54 from `surface`, 2.24 from
		 * `elevated` and 10.39 from `sunken`; the step is 6.33 `L*`, and the band
		 * this branch raised to ΔE00 4.0 is met without a cast.
		 */
		highlight: "#403E3D",

		ink: "#EBDBB2",
		// Canonical fg2 D5C4A1 is 6.76:1 on `elevated` and only ΔE00 6.3 from fg3, which is
		// under the 8 ink step. Lifted one step along the same warm grey so the readout rung
		// below it takes a different name.
		inkMuted: "#DECDA9",
		inkDim: "#BDAE93",
		inkDisabled: "#928374",

		// A rule seated in the window a 1px line has: ΔE00 4.1 from every ground and
		// 1.21-1.71:1 against them. It divides rather than bounds, which is what keeps it
		// from competing with the edge below.
		hairline: "#494442",
		// Bg2 504945 is 1.31:1 against the grounds, far under the 3:1 a control's only
		// edge is asked for. Lifted along the same warm grey to 3.1:1 on the lightest
		// ground.
		borderControl: "#89827D",

		accent: "#FABD2F",
		accentHover: "#FFD75F",
		accentActive: "#D79921",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.3
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFD78C",
		accentWash: "#32321C",
		onAccent: "#1D2021",

		success: "#B8BB26",
		successWash: "#464730",
		successBorder: "#868902",

		warning: "#FE8019",
		warningWash: "#45352C",
		warningBorder: "#D06503",

		// Upstream bright red FB4934 is 3.37:1 on `elevated` — the largest miss in the
		// palette, and the only accent that could not ship as drawn. Lifted along the same
		// red.
		danger: "#FF7C67",
		dangerWash: "#3B2723",
		dangerBorder: "#DA5B48",

		info: "#83A598",
		infoWash: "#28353A",
		infoBorder: "#698B7E",

		// The shadow and scrim are the ground tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
