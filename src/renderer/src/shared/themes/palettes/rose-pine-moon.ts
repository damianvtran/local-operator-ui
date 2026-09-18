import type { ThemeDefinition } from "../palette-contract";

/**
 * Rosé Pine Moon.
 *
 * The same scheme as `rose-pine.ts`, one step up in ground lightness. It is a
 * sibling of Rosé Pine rather than a different palette — the same rose, pine,
 * gold, love and foam hues — so the family relationship is preserved in the
 * roles that carry the identity: `accent` is still rose and `danger` is still
 * love here, exactly as in the dark variant.
 *
 * Derived by the same rules as `rose-pine.ts` (grounds, ink ramp, hairline as
 * one step outside the ladder, `chartBarHover` stepping away from the plot
 * ground, `onAccent` as the page ground); the deviations below are the ones
 * Moon needs on top of them:
 *
 * - `success` is pine lifted for the lightest ground, `elevated` 393552.
 * - `info` is foam lifted: at canonical 9ccfd8 it sits ΔE00 14.6 from the
 *   lifted pine, under the contract's 15 for two semantics a reader has to
 *   tell apart by name.
 */
export const rosePineMoon: ThemeDefinition = {
	id: "rosePineMoon",
	name: "Rosé Pine Moon",
	description: "Rosé Pine lifted: the same rose and pine over a softer violet.",
	palette: {
		mode: "dark",

		canvas: "#232136",
		surface: "#2a273f",
		elevated: "#393552",
		sunken: "#1b192a",

		/*
		 * The current row's own ground: `surface` stepped 6.01 `L*` up at the panel's own
		 * hue (0.6 degrees off, inside the 12-degree bound) and carried
		 * 16.78 `C*` against the panel's 16.79 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 4.17, from
		 * `elevated` 1.64, from `sunken` 9.22. Ink on this ground: `ink` 9.04:1,
		 * `ink-muted` 7.18:1, `ink-dim` 4.78:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `0.97x` the panel's
		 * chroma (16.24 `C*` against 16.79), 2 degrees off its hue, ΔE00 4.01 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * THE HOVER STEP IS THE COLLISION: 1.64 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_ADJACENT_PINS` and is
		 * on the row-hover work list.
		 */
		highlight: "#37344D",

		ink: "#e0def4",
		inkMuted: "#c9c6e0",
		inkDim: "#A4A1BD",
		inkDisabled: "#6e6a86",

		hairline: "#414057",
		borderControl: "#8f8ba9",

		accent: "#eaaca9",
		accentHover: "#f2c2bf",
		accentActive: "#d69793",
		// ΔE00 10.3 from `accent` and 10.8:1 on surface, where the accent is
		// 7.5:1.
		chartBarHover: "#FFD6D2",
		accentWash: "#382b38",
		onAccent: "#232136",

		// pine, lifted for `elevated`.
		success: "#4eadd9",
		successWash: "#22303c",
		successBorder: "#4B8AA9",

		warning: "#f6c177",
		warningWash: "#37301f",
		warningBorder: "#9A8050",

		// The danger border is the danger button's only edge until hover, so it
		// clears 3:1 on the dialog ground as well as on canvas and surface.
		danger: "#f97a9e",
		dangerWash: "#38222e",
		dangerBorder: "#B86C85",

		// foam, lifted off 9ccfd8 to clear ΔE00 15 from the lifted pine above.
		info: "#A0D4DD",
		infoWash: "#23343a",
		infoBorder: "#5B8A94",

		overlayShadow: "0 12px 32px -12px rgb(20 18 32 / 0.7)",
		scrim: "rgb(20 18 32 / 0.6)",
	},
};
