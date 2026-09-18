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
export const rosePineMoon: ThemeDefinition = {
	id: "rosePineMoon",
	name: "Rosé Pine Moon",
	description: "Rosé Pine lifted: the same rose and pine over a softer violet.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.11, elevated +8.97, sunken -4.13 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #232136 -> #232136 (L* 13.89 -> 13.89)
		 * surface #2a273f -> #2A273F (L* 17 -> 17)
		 * elevated #393552 -> #373350 (L* 23.75 -> 22.86)
		 * sunken #1b192a -> #1B192A (L* 9.76 -> 9.76)
		 *
		 * ONLY LIGHTNESS MOVED. Each value holds its own `a` and `b`, so the theme's
		 * hue and chroma class are exactly what they were and chroma is scaled only
		 * where sRGB forces it - a lift that neutralised a palette to satisfy a floor
		 * would be a different theme, not a lighter one.
		 *
		 * THE GROUNDS AND THE INKS MOVED TOGETHER, and the header of this file says why:
		 * lifting a dark ground raises the luminance every ink is measured against, so
		 * the inks in this file were re-seated on the same commit rather than after it.
		 */
		canvas: "#232136",
		surface: "#2a273f",
		elevated: "#373350",
		sunken: "#1b192a",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.02 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 5.75 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.01 from `surface`, 2.03 from `elevated` and 8.99 from `sunken`;
		 * the step is 5.71 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.82:1 the ink that binds it.
		 */
		highlight: "#38334B",

		ink: "#e0def4",
		inkMuted: "#c9c6e0",
		inkDim: "#aaa7c3",
		inkDisabled: "#6e6a86",

		hairline: "#414057",
		borderControl: "#8f8ba9",

		accent: "#eaaca9",
		accentHover: "#f2c2bf",
		accentActive: "#d69793",
		// ΔE00 10.3 from `accent` and 10.8:1 on surface, where the accent is
		// 7.5:1.
		chartBarHover: "#FFD6D2",
		tokenCommand: "#A0D4DD",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
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
