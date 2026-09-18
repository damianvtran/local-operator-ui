import type { ThemeDefinition } from "../palette-contract";

/**
 * Monokai.
 *
 * Upstream Monokai is unusually complete for this contract: background
 * 272822, line highlight 3E3D32, foreground F8F8F2, comment 75715E, plus a
 * green, an orange, a yellow, a pink and a blue. Only the recessed ground,
 * the structural border and the wash tints are derived.
 */
export const monokai: ThemeDefinition = {
	id: "monokai",
	name: "Monokai",
	description: "The Monokai scheme: olive-black ground with the acid green.",
	palette: {
		mode: "dark",

		canvas: "#272822",
		// Canvas and elevated are upstream's background and line highlight; surface
		// is the derived step between them, so it is the one that moves. 2D2E27 sat
		// ΔE00 1.95 from canvas — a card edge that is not there. One unit up the
		// same olive ramp reads 2.26, and still leaves 5.05 up to elevated.
		surface: "#2E2F28",
		elevated: "#3E3D32",
		sunken: "#1E1F1A",

		/*
		 * The current row's own ground: `surface` stepped 5.90 `L*` up at the panel's own
		 * hue (0.7 degrees off, inside the 12-degree bound) and carried
		 * 5.27 `C*` against the panel's 4.80 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 4.19, from
		 * `elevated` 1.87, from `sunken` 9.28. Ink on this ground: `ink` 10.47:1,
		 * `ink-muted` 6.07:1, `ink-dim` 4.72:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `1.66x` the panel's
		 * chroma (7.98 `C*` against 4.80), 1 degrees off its hue, ΔE00 4.07 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * THE HOVER STEP IS THE COLLISION: 1.87 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_ADJACENT_PINS` and is
		 * on the row-hover work list.
		 */
		highlight: "#3B3C34",

		ink: "#F8F8F2",
		inkMuted: "#BFBFBF",
		// Monokai's comment 75715E, lightened until it clears 4.5:1 on the line
		// highlight ground. The comment colour itself stays as inkDisabled.
		inkDim: "#ACA998",
		inkDisabled: "#75715E",

		hairline: "#464740",
		// The comment colour lightened further, so a structural boundary is legally
		// distinct from the decorative hairline above it.
		borderControl: "#8E8A73",

		accent: "#A6E22E",
		accentHover: "#B6E94E",
		accentActive: "#8BC220",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 10.65:1 on surface, where the accent
		// itself is 8.72:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#D0F090",
		accentWash: "#363E23",
		onAccent: "#272822",

		// The same green as the accent. Monokai has exactly one green, and a second
		// one invented to fill this role would be a colour no Monokai user
		// recognises. A green success next to a green primary button is the honest
		// reading of this scheme.
		success: "#A6E22E",
		successWash: "#363E23",
		successBorder: "#6D8E29",

		// Monokai's orange.
		warning: "#FD971F",
		warningWash: "#413522",
		warningBorder: "#A76C22",

		// Monokai's pink is F92672, which measures 4.19:1 on canvas. This is the
		// smallest lift that clears 4.5:1 on both grounds and on its own wash.
		danger: "#FB6097",
		dangerWash: "#40282C",
		dangerBorder: "#D04573",

		// Monokai's blue.
		info: "#66D9EF",
		infoWash: "#2F3D3B",
		infoBorder: "#4A8993",

		overlayShadow: "0 12px 32px -12px rgb(15 15 12 / 0.65)",
		scrim: "rgb(15 15 12 / 0.6)",
	},
};
