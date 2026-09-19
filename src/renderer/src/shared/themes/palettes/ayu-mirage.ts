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
export const ayuMirage: ThemeDefinition = {
	id: "ayuMirage",
	name: "Ayu Mirage",
	description: "Ayu's mirage: blue-grey ground with the same azure accent.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +4.97, elevated +9.94, sunken -5.85 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #242936 -> #242936 (L* 16.64 -> 16.64)
		 * surface #2E3544 -> #2D3442 (L* 22.1 -> 21.61)
		 * elevated #39404F -> #353C4B (L* 27.02 -> 25.25)
		 * sunken #191D27 -> #191D27 (L* 10.79 -> 10.79)
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
		canvas: "#242936",
		surface: "#2D3442",
		elevated: "#353C4B",
		sunken: "#191D27",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #2F393F  accent hue, C* 5.71, +1.70 L*, ΔE00 5.91 off `surface`,
		 *                       `inkDim` 5.69:1 on the fill, hue 1.30° off `accent`.
		 * rowSelected #274251  accent hue, C* 13.39, +4.90 L*, ΔE00 8.54 off
		 *                       `surface` and 6.13 off `rowHover`, `inkDim` 5.10:1, and the
		 *                       2px `accent` bar at 6.15:1 against it.
		 */
		rowHover: "#2F393F",
		rowSelected: "#274251",

		ink: "#D6D5CE",
		// upstream's blue-tinted muted rung.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `highlight` binds it at 7.17:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#BED6ED",
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.17:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#A4B6CA",
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
		tokenCommand: "#DFBFFF",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#2A3949",
		onAccent: "#1F2430",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#FFAD66`,
		 * canonical keyword), moved onto the floors: as received it sat ΔE00 13.81
		 * from `warning`. That is paid on HUE — the hue walked 14.7° off the source
		 * and L* 77.35 → 65.78 — because a value that bought the separation by
		 * darkening would be the same hue at another weight. Measured: ΔE00 48.59
		 * from `accent`, 15.02 from its nearest semantic (`warning`), 4.76:1 on the
		 * tightest ground (`surface`).
		 */
		accentAlt: "#CA973E",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 23.34 and C* 11.85, with the hue moved to
		 * `accentAlt`'s, with the L* walked -0.50 because the chip's own ink floor
		 * binds (`accentAlt` on the wash needs 4.5:1). Measured: ΔE00 19.20 from
		 * `accentWash` (the field floor is 2.0), 4.57:1 for `accentAlt` on it, and
		 * 17.67 from the nearest ground it is painted on.
		 */
		accentAltWash: "#403525",

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
