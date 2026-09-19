import type { ThemeDefinition } from "../palette-contract";

/**
 * Synth.
 *
 * Retro synthwave. Carried: the two purple grounds, the darker purple the old
 * file used for tooltips, the pink trio, the neon blue and the bright orange.
 * The pink is the accent, the neon blue is the informational hue, and the
 * orange is the caution — three of the four semantic roles come straight from
 * the theme.
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
export const synth: ThemeDefinition = {
	id: "synth",
	name: "Synth",
	description: "Synthwave: deep purple night with hot pink and neon blue.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +2.62, elevated +8.56, sunken -2.36 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #120720 -> #231C32 (L* 3.48 -> 12.08)
		 * surface #1B0A2F -> #2E1D42 (L* 5.92 -> 14.7)
		 * elevated #2C1D43 -> #36274D (L* 14.51 -> 19.10)
		 * sunken #06020D -> #1C1A20 (L* 1 -> 9.72)
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
		canvas: "#231C32",
		surface: "#2E1D42",
		elevated: "#36274D",
		sunken: "#1C1A20",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are a
		 * step of THIS palette's own panel at the panel's own hue; they used to be
		 * tints of `accent`, whose hue is more than 45 degrees off the panel on 25 of
		 * the 59 themes - the off-colour the operator reported. The rule, and why the
		 * fill now carries the ranking the 2px `accent` bar used to, are in the two
		 * roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #32273E  panel hue, C* 16.63,
		 *                       the rule's 0.60 x the panel's 26.83; +3.12 L*,
		 *                       ΔE00 5.81 off `surface`, `inkDim` 5.45:1.
		 * rowSelected #39294A  panel hue, C* 23.37,
		 *                       the panel's cast + 4.0, floored at 5.0; +5.15 L*,
		 *                       ΔE00 3.84 off `surface` and 4.06 off
		 *                       `rowHover`; the pair ranks 2.03 `L*` and 6.7 `C*`,
		 *                       `inkDim` 5.13:1.
		 *
		 * ITS CAST FLOOR IS UNREACHABLE, and the reason is geometry rather than a
		 * value: this panel carries C* 26.83, past the rule's flat cap of 24, so no
		 * authored fill can hold the panel's own cast here and the selection sits at
		 * the cap. The row is named in `scripts/contrast-contract.mjs`'s
		 * `ROW_STATE_FLOOR_UNREACHABLE` with the flat cap as the constraint that
		 * refuses it, and it is re-measured every run.
		 */
		rowHover: "#32273E",
		rowSelected: "#39294A",

		// The old file borrowed the generic dark theme's F9FAFB and 9CA3AF for its
		// text, which is a cool grey ramp sitting on a purple one. The inks here are
		// tinted purple to match the grounds; same weights, same legibility.
		ink: "#F7F2FB",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.26:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#C7B8D8",
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.25:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#AB9BBD",
		inkDisabled: "#6B5C7D",

		// The pink at a low tint over surface. It has to stay lighter than elevated,
		// or a divider inside a menu disappears — which is what the old sidebar
		// border did once it was flattened.
		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 13.03.
		 */
		hairline: "#64224E",
		// Derived. The old theme bounded inputs with neon blue at 25 percent alpha,
		// about 1.5:1.
		borderControl: "#8A7BA0",

		/*
		 * Legibility pass: `accent` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.51:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 74.77 -> 64, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		accent: "#FF618E",
		accentHover: "#FF79B0",
		accentActive: "#F50057",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.2 from `accent` and 7.65:1 on surface, where the accent
		// itself is 5.57:1. See `chartBarHover` in the palette contract.
		/*
		 * Legibility pass: `chartBarHover` follows `accent` - the ramp is one control seen
		 * three times and the chart's hover mark has to stay ΔE00 10 clear of the
		 * resting mark, so both move at their own hue rather than letting the accent
		 * pull away from them.
		 * Its chroma comes down with the accent's (C* 54.67 -> 44.98), which is
		 * the same gamut exception: the required `L*` leaves sRGB at the old chroma.
		 */
		chartBarHover: "#FF92B5",
		tokenCommand: "#00E5FF",
		/* The wire's own `info`, so the command word's rendering does not move. */
		accentWash: "#2E0E2C",
		// The old theme paired white with this pink, which measures 3.2:1. Ink on
		// the accent fill is the page ground instead, at 4.8:1.
		onAccent: "#120720",
		/*
		 * No second hue to carry: this palette is desktop-only, so it has no TUI
		 * `label` token and the hue is a ROTATION of `accent` rather than a value
		 * that already existed — Δh 150° at `accent`'s own L*, its chroma walked
		 * down from 64.00 to the first that clears every floor (C* 49.00).
		 * Measured: ΔE00 72.50 from `accent`, 15.21 from its nearest semantic
		 * (`success`), 5.35:1 on the tightest ground (`surface`).
		 */
		accentAlt: "#3AAC75",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 9.62 and C* 24.80, with the hue moved to
		 * `accentAlt`'s, and the chroma capped at C* 17.68 where sRGB runs out at
		 * that L*. Measured: ΔE00 32.00 from `accentWash` (the field floor is 2.0),
		 * 6.04:1 for `accentAlt` on it, and 20.40 from the nearest ground it is
		 * painted on.
		 */
		accentAltWash: "#002010",

		// Synth has no green. A mint, placed between the theme's pink and its neon
		// blue so it belongs to the same neon family.
		success: "#4DE8A8",
		successWash: "#192230",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.16:1.
		 */
		successBorder: "#37886F",

		// The bright orange the old file used for its ask highlights.
		warning: "#FFA500",
		warningWash: "#2E1A1C",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		warningBorder: "#A76E21",

		// The accent is already pink, so danger moves to red: a destructive action
		// must not read as the primary one. This is the smallest hue rotation that
		// separates them.
		danger: "#FF6B6B",
		dangerWash: "#2E1329",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.16:1.
		 */
		dangerBorder: "#BE5C66",

		// The theme's neon blue, an authentic informational hue.
		info: "#00E5FF",
		infoWash: "#10223B",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		infoBorder: "#1585A0",

		overlayShadow: "0 12px 32px -12px rgb(6 2 13 / 0.75)",
		scrim: "rgb(6 2 13 / 0.65)",
	},
};
