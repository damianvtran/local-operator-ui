import type { ThemeDefinition } from "../palette-contract";

/**
 * Catppuccin Frappé — the third flavour, from catppuccin/palette v1.8.0.
 *
 * The palette supplies its own ground ramp, so the four grounds are upstream's where they
 * fit: base 303446 is the page and mantle 292C3E sits below it. Text C6D0F5, subtext0 A6AECE
 * and overlay0 737994 carry the ink weights.
 *
 * Frappé is the lightest of the three dark flavours, which is what makes it the tightest:
 * the binding ground for every ink is `elevated`, and this is the one flavour whose window
 * between the 4.5:1 readout floor and the 7:1 body floor cannot hold two tone tiers apart —
 * so the control rung takes upstream's own text and the readout rung takes subtext0, skipping
 * subtext1, to clear this contract's ΔE00 8 ink step (the shipped `tokyoNight` carries that
 * pair below the step as a pinned exception; a new palette may not).
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1; a semantic
 * border walks its hue toward the ground to just above the 3:1 edge floor; the shadow and the
 * scrim are the ground tinted.
 */
export const catppuccinFrappe: ThemeDefinition = {
	id: "catppuccinFrappe",
	name: "Catppuccin Frappé",
	description: "The middle flavour — warm slate under the Catppuccin pastels.",
	palette: {
		mode: "dark",

		canvas: "#303446",
		surface: "#363B4E",
		elevated: "#3D4255",
		sunken: "#2A2D3E",
		/*
		 * The current row's own ground: `surface` stepped 2.66 `L*` up at the panel's own
		 * hue (0.9 degrees off, inside the 12-degree bound) and carried
		 * 15.05 `C*` against the panel's 12.60 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 2.51, from
		 * `elevated` 1.71, from `sunken` 6.85. Ink on this ground: `ink` 7.22:1,
		 * `ink-muted` 6.62:1, `ink-dim` 4.66:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `1.14x` the panel's
		 * chroma (14.37 `C*` against 12.60), 0 degrees off its hue, ΔE00 2.29 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * THIS PALETTE IS THE EXCEPTION, AND THE FLOOR IS WHY. Its own `ink-dim` caps
		 * the step at 2.60 `L*`, and with the band's whole ceiling spent that reaches only
		 * ΔE00 2.29 — under the 2.5 floor every palette must hold, which is the
		 * operator's EARLIER report ("way too subtle... make it brighter/more contrasted")
		 * returning on a theme he has not looked at yet. The band is the default, not the
		 * ceiling on the floor: this value adds 0.56 `C*` past the band's ceiling — 2.45 over
		 * the panel, at the panel's own hue, with the step unchanged at 2.66 `L*` — and that is
		 * what reaches ΔE00 2.51. It is the SMALLEST chroma that does, pinned by name in
		 * `HIGHLIGHT_OVER_BAND_PINS` and re-derived by `pnpm check-themes`, so the exception
		 * cannot drift into a licence to be loud.
		 *
		 * THE HOVER STEP IS THE COLLISION: 1.71 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_ADJACENT_PINS` and is
		 * on the adjacent-role work list.
		 */
		highlight: "#3A4158",

		// Canonical text C6D0F5 is 6.52:1 on `elevated` — under the 7:1 body floor. Lifted
		// along the same lavender-white.
		ink: "#D1D9F8",
		// Upstream text. It takes the top rung so that the readout rung below it can clear
		// the ink step at all; see the header.
		inkMuted: "#C6D0F5",
		// Canonical subtext0 A6ADCE measures 4.49:1 on `elevated`, a hundredth short of the
		// floor; lifted along the same slate, and the readout tier of the ladder.
		inkDim: "#A7AFCF",
		inkDisabled: "#737994",

		// The port's #464B60 sat ΔE00 3.16 from `elevated`, where a 1px line needs 4.0. This
		// clears it and stays between 1.24:1 and 1.70:1 on the four grounds, so it still
		// divides rather than bounds.
		hairline: "#4A5064",
		// Upstream overlay2, which clears the 3:1 structural floor with room (3.67:1 on
		// the binding ground) where overlay0 — the inactive tone — could not.
		borderControl: "#949CBB",

		accent: "#CA9EE6",
		accentHover: "#DCBEEE",
		accentActive: "#BA82DF",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.4 from `accent`, and 7.5:1 on surface where `accent` is 5.0:1.
		// See `chartBarHover` in the palette contract.
		chartBarHover: "#E9C8FF",
		accentWash: "#37394D",
		// Upstream crust. The port shipped base 303446 here, which is 4.31:1 on the pressed
		// fill and under the floor; crust takes the worst of the three states to 5.25:1.
		onAccent: "#232634",

		success: "#A6D189",
		successWash: "#343948",
		successBorder: "#8BC365",

		warning: "#EF9F76",
		warningWash: "#383848",
		warningBorder: "#EB8855",

		// Canonical red E78284 is 3.76:1 on `elevated` (< 4.5). Lifted along the same rose, then
		// nudged a further step so it keeps ΔE00 15 from the peach beside it — the lift alone
		// sat at 14.97.
		danger: "#F1989C",
		dangerWash: "#38384A",
		dangerBorder: "#E67F82",

		info: "#91AEEF",
		infoWash: "#353B4F",
		infoBorder: "#769AEB",

		// The shadow and scrim are the ground tinted, as in every palette here: a shadow
		// that carried its own hue would read as a second palette.
		overlayShadow: "0 12px 32px -12px rgb(35 38 52 / 0.65)",
		scrim: "rgb(35 38 52 / 0.6)",
	},
};
