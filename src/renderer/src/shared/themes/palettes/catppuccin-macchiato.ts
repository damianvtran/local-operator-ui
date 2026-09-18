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
		 * The current row's own ground: `surface` stepped 2.44 `L*` up at the panel's own
		 * hue (0.8 degrees off, inside the 12-degree bound) and carried
		 * 16.18 `C*` against the panel's 14.41 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 2.03, from
		 * `elevated` 0.53, from `sunken` 6.17. Ink on this ground: `ink` 8.44:1,
		 * `ink-muted` 6.95:1, `ink-dim` 4.67:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `1.32x` the panel's
		 * chroma (19.01 `C*` against 14.41), 8 degrees off its hue, ΔE00 4.00 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * AND IT IS BELOW THE FLOOR: ΔE00 2.03 is under the 2.5 every palette must hold.
		 * Hue-faithfully there is no value that reaches it — the row cannot rise further
		 * without putting this palette's own body ink under its floor, and buying it back
		 * on chroma or hue is the defect this round removes. It is on the NAMED LIST in
		 * `HIGHLIGHT_CAP_PINS` (`subFloor`), with its numbers, and the structural fix is the
		 * row-hover split rather than a louder mark here.
		 *
		 * THE HOVER STEP IS THE COLLISION: 0.53 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_HOVER_PINS` and is
		 * on the row-hover work list.
		 */
		highlight: "#2F324A",

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
