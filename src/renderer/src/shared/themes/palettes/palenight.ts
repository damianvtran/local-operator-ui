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
		 * The current row's own ground: `surface` stepped 2.40 `L*` up at the panel's own
		 * hue (1.3 degrees off, inside the 12-degree bound) and carried
		 * 15.31 `C*` against the panel's 12.19 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 2.64, from
		 * `elevated` 1.94, from `sunken` 6.62. Ink on this ground: `ink` 11.07:1,
		 * `ink-muted` 6.48:1, `ink-dim` 4.68:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `1.15x` the panel's
		 * chroma (13.97 `C*` against 12.19), 2 degrees off its hue, ΔE00 2.12 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * THIS PALETTE IS THE EXCEPTION, AND THE FLOOR IS WHY. Its own `ink-dim` caps
		 * the step at 2.50 `L*`, and with the band's whole ceiling spent that reaches only
		 * ΔE00 2.12 — under the 2.5 floor every palette must hold, which is the
		 * operator's EARLIER report ("way too subtle... make it brighter/more contrasted")
		 * returning on a theme he has not looked at yet. The band is the default, not the
		 * ceiling on the floor: this value adds 1.29 `C*` past the band's ceiling — 3.12 over
		 * the panel, at the panel's own hue, with the step unchanged at 2.40 `L*` — and that is
		 * what reaches ΔE00 2.64. It is the SMALLEST chroma that does, pinned by name in
		 * `HIGHLIGHT_OVER_BAND_PINS` and re-derived by `pnpm check-themes`, so the exception
		 * cannot drift into a licence to be loud.
		 *
		 * THE HOVER STEP IS THE COLLISION: 1.94 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_ADJACENT_PINS` and is
		 * on the adjacent-role work list.
		 */
		highlight: "#333950",

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
