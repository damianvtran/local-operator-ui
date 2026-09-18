import type { ThemeDefinition } from "../palette-contract";

/**
 * Ayu Mirage.
 *
 * The middle of the Ayu family — `ayu-dark.ts` below it, `ayu-light.ts` above —
 * and the same scheme at a warmer temperature: the ground is a blue-grey slate
 * rather than a near-black blue, and the accent, green, orange, red and violet
 * are Ayu's own. That shared accent row is what keeps the three recognisable as
 * one family, so none of it is re-derived here.
 *
 * Mirage's ladder is upstream's own at its own spacing (bg 242936 to raised
 * 2e3544 measures ΔE00 3.9), which already clears this contract's field floor.
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`.
 */
export const ayuMirage: ThemeDefinition = {
	id: "ayuMirage",
	name: "Ayu Mirage",
	description: "Ayu's mirage: blue-grey ground with the same azure accent.",
	palette: {
		mode: "dark",

		canvas: "#242936",
		surface: "#2E3544",
		elevated: "#39404F",
		sunken: "#191D27",

		/*
		 * The current row's own ground: `surface` stepped 4.48 `L*` up at the panel's own
		 * hue (0.2 degrees off, inside the 12-degree bound) and carried
		 * 11.42 `C*` against the panel's 10.36 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 3.33, from
		 * `elevated` 0.98, from `sunken` 11.14. Ink on this ground: `ink` 7.17:1,
		 * `ink-muted` 6.59:1, `ink-dim` 4.66:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `1.17x` the panel's
		 * chroma (12.12 `C*` against 10.36), 10 degrees off its hue, ΔE00 4.14 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * THE HOVER STEP IS THE COLLISION: 0.98 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_ADJACENT_PINS` and is
		 * on the row-hover work list.
		 */
		highlight: "#373F50",

		ink: "#D6D5CE",
		// upstream's blue-tinted muted rung.
		inkMuted: "#B8CFE6",
		inkDim: "#9DAEC2",
		inkDisabled: "#707A8C",

		hairline: "#414B60",
		borderControl: "#7E8BA4",

		// the family's azure.
		accent: "#73D0FF",
		accentHover: "#97DCFF",
		accentActive: "#23B5FF",
		// ΔE00 10.6 from `accent` and 9.1:1 on surface, where the accent is
		// 7.1:1.
		chartBarHover: "#8EECFF",
		accentWash: "#2A3949",
		onAccent: "#1F2430",

		success: "#D5FF80",
		successWash: "#2F363A",
		successBorder: "#D5FF80",

		warning: "#FFD173",
		warningWash: "#38383B",
		warningBorder: "#FFD173",

		danger: "#F39185",
		dangerWash: "#39333E",
		dangerBorder: "#F39185",

		info: "#DFBFFF",
		infoWash: "#3A3A4D",
		infoBorder: "#DFBFFF",

		overlayShadow: "0 12px 32px -12px rgb(16 19 26 / 0.72)",
		scrim: "rgb(16 19 26 / 0.6)",
	},
};
