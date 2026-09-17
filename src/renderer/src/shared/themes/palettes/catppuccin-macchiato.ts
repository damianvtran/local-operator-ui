import type { ThemeDefinition } from "../palette-contract";

/**
 * Catppuccin Macchiato — the fourth flavour, from catppuccin/palette v1.8.0.
 *
 * Every content value is canonical and unmodified: base 24273A, mantle 1E2132, text CAD3F5,
 * subtext1 B8C0E0, overlay0 6E738D, and the mauve/green/peach/red/blue accent row. Macchiato's
 * darker base gives every hue more room than frappé's does — the weakest value in the palette
 * is the red at 5.01:1 across all four grounds, against frappé's 3.76 for the same role — so
 * nothing here needed a solve.
 *
 * Frappé and macchiato are close cousins, and the risk in shipping both is shipping one theme
 * twice. Upstream separates them at the GROUND (base 303446 vs 24273A, ΔE00 4.22) and this
 * keeps that separation rather than splitting the difference: each ramp is built from its own
 * flavour's base and mantle, so the two ladders stay 3.5-4.2 apart at every rung instead of
 * converging on a shared mid-slate.
 *
 * The one rung that is not upstream's own tone is `inkDim`: subtext0 A5ADCB sits ΔE00 5.2 from
 * subtext1, under this contract's 8 ink step, so the readout tier skips it for overlay2 — which
 * is upstream's next tone down, lifted a hundredth to hold 4.5:1 on the binding ground.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1; a semantic
 * border walks its hue toward the ground to just above the 3:1 edge floor; the shadow and the
 * scrim are the ground tinted.
 */
export const catppuccinMacchiato: ThemeDefinition = {
	id: "catppuccinMacchiato",
	name: "Catppuccin Macchiato",
	description: "The deep flavour — cool navy-slate under the same pastels.",
	palette: {
		mode: "dark",

		canvas: "#24273A",
		surface: "#2A2D42",
		elevated: "#30334A",
		sunken: "#1E2132",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.12 toward `accent`, then stepped 1.75 on the `L*`
		 * axis — branch H of this port's selection rule — and this palette's OWN ink is
		 * what put it there: the ink floor on the row's ground caps the lightness route
		 * at 2.5 `L*` here (inkDim reaches its floor with the 0.15 of
		 * headroom at 4.67:1 on this ground), so the band is paid on the cast.
		 * ΔE00 4 from `surface`, 3.38 from `elevated` and 7.23 from
		 * `sunken`; the step of 1.74 `L*` is short of the 3 `L*` floor and is pinned in
		 * `scripts/contrast-contract.mjs` with that ink number rather than dropped.
		 */
		highlight: "#312F4B",

		ink: "#CAD3F5",
		inkMuted: "#B8C0E0",
		// Upstream overlay2 939AB7, lifted a hundredth: the tone sits at 4.55:1 on the binding
		// ground, and it is the next rung the ink step can reach (subtext0 is 5.2 away from
		// subtext1 and may not be).
		inkDim: "#969DBA",
		inkDisabled: "#6E738D",

		hairline: "#3C4056",
		borderControl: "#939AB7",

		accent: "#C6A0F6",
		accentHover: "#DCC5FA",
		accentActive: "#B27FF3",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.4 from `accent`, and 8.8:1 on surface where `accent` is 6.3:1.
		// See `chartBarHover` in the palette contract.
		chartBarHover: "#DEC7FF",
		accentWash: "#2A2C42",
		onAccent: "#24273A",

		success: "#A6DA95",
		successWash: "#292D3D",
		successBorder: "#88CD71",

		warning: "#F5A97F",
		warningWash: "#2B2C3C",
		warningBorder: "#F2925D",

		danger: "#ED8796",
		dangerWash: "#2B2A3D",
		dangerBorder: "#E96C7F",

		info: "#8AADF4",
		infoWash: "#292E43",
		infoBorder: "#6E99F1",

		// The shadow and scrim are the ground tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(24 25 38 / 0.65)",
		scrim: "rgb(24 25 38 / 0.6)",
	},
};
