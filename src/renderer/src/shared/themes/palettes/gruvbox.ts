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
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #39332B  accent hue, C* 6.14, +1.59 L*, ΔE00 4.57 off `surface`,
		 *                       `inkDim` 6.06:1 on the fill, hue 2.21° off `accent`.
		 * rowSelected #473923  accent hue, C* 16.24, +4.88 L*, ΔE00 11.59 off
		 *                       `surface` and 7.18 off `rowHover`, `inkDim` 5.43:1, and the
		 *                       2px `accent` bar at 6.60:1 against it.
		 */
		rowHover: "#39332B",
		rowSelected: "#473923",

		ink: "#EBDBB2",
		// Canonical fg2 D5C4A1 is 6.76:1 on `elevated` and only ΔE00 6.3 from fg3, which is
		// under the 8 ink step. Lifted one step along the same warm grey so the readout rung
		// below it takes a different name.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `highlight` binds it at 7.14:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#E3D2AD",
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.16:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#C2B397",
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
		tokenCommand: "#88AB9E",
		// The signal lifted in L* to clear 4.5:1 on `elevated` (it measured 4.31), at a
		// cost of ΔE00 1.79 from the signal itself; 5.23:1 on `surface`.
		accentWash: "#32321C",
		onAccent: "#1D2021",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#d3869b`, canonical bright purple), received unchanged
		 * because it already clears every floor — ΔE00 44.00 from `accent`, 17.21
		 * from its nearest semantic (`danger`), 4.78:1 as text on the tightest
		 * ground (`surface`).
		 */
		accentAlt: "#d3869b",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 20.22 and C* 14.63, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 24.95 from `accentWash` (the field floor is
		 * 2.0), 4.74:1 for `accentAlt` on it, and 13.11 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#452930",

		success: "#B8BB26",
		successWash: "#464730",
		successBorder: "#868902",

		/*
		 * Legibility pass: `warning` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `highlight` binds it there at
		 * 4.52:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 81.57 -> 74.1, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		warning: "#FF8A32",
		warningWash: "#45352C",
		warningBorder: "#D06503",

		// Upstream bright red FB4934 is 3.37:1 on `elevated` — the largest miss in the
		// palette, and the only accent that could not ship as drawn. Lifted along the same
		// red.
		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `highlight` binds it there at
		 * 4.51:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 59.54 -> 54.52, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		danger: "#FF8671",
		dangerWash: "#3B2723",
		dangerBorder: "#DA5B48",

		/*
		 * Legibility pass: `info` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `highlight` binds it there at
		 * 4.5:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		info: "#8EB0A3",
		infoWash: "#28353A",
		infoBorder: "#698B7E",

		// The shadow and scrim are the ground tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
