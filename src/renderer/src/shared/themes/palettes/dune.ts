import type { ThemeDefinition } from "../palette-contract";

/**
 * Dune.
 *
 * This one is the app's own theme rather than a community spec, so the
 * identity to preserve is narrower: the orange trio, the two warm near-black
 * grounds and the warm secondary text. Everything else is derived on the
 * theme's own ramp.
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
export const dune: ThemeDefinition = {
	id: "dune",
	name: "Dune",
	description: "Desert night: warm near-black with a vivid orange.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +4.15, elevated +8.3, sunken -2.92 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #0F0D0B -> #21201E (L* 3.74 -> 12.29)
		 * surface #1A1714 -> #2C2825 (L* 7.98 -> 16.44)
		 * elevated #261E17 -> #362D25 (L* 11.97 -> 19.20)
		 * sunken #050403 -> #1B1A1A (L* 1.14 -> 9.37)
		 *
		 * ONLY LIGHTNESS MOVED. Each value holds its own `a` and `b`, so the theme's
		 * hue and chroma class are exactly what they were and chroma is scaled only
		 * where sRGB forces it - a lift that neutralised a palette to satisfy a floor
		 * would be a different theme, not a lighter one.
		 *
		 * THE COST IS THE BLACK, and it is recorded rather than argued away: this
		 * palette's upstream identity IS near-black, so a user who chose it for that
		 * loses it (`docs/branding.md` § 2 lists the four who pay it). What survives is
		 * the family - the hue, the chroma class and the relative ladder - and the
		 * operator asked for exactly this trade: no page ground in this app sits below
		 * L* 12.
		 *
		 * THE GROUNDS AND THE INKS MOVED TOGETHER, and the header of this file says why:
		 * lifting a dark ground raises the luminance every ink is measured against, so
		 * the inks in this file were re-seated on the same commit rather than after it.
		 */
		canvas: "#21201E",
		surface: "#2C2825",
		elevated: "#362D25",
		// The old theme had no recessed ground at all; this one was authored as
		// 050403, a step far enough below the canvas to stay distinguishable, and
		// the legibility pass then moved it with the rest of the ramp (see the
		// block above). It keeps that job: at this darkness a step of one or two
		// levels measures under the 1.03:1 separation floor.
		sunken: "#1B1A1A",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are a
		 * step of THIS palette's own panel at the panel's own hue; they used to be
		 * tints of `accent`, whose hue is more than 45 degrees off the panel on 25 of
		 * the 59 themes - the off-colour the operator reported. The rule, and why the
		 * fill now carries the ranking the 2px `accent` bar used to, are in the two
		 * roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #322E2B  panel hue, C* 2.82,
		 *                       the rule's 0.60 x the panel's 2.89; +2.81 L*,
		 *                       ΔE00 1.91 off `surface`, `inkDim` 5.25:1.
		 * rowSelected #393029  panel hue, C* 6.57,
		 *                       the panel's cast + 4.0, floored at 5.0; +4.17 L*,
		 *                       ΔE00 4.35 off `surface` and 3.48 off
		 *                       `rowHover`; the pair ranks 1.36 `L*` and 3.7 `C*`,
		 *                       `inkDim` 5.03:1.
		 *
		 * THE HOVER'S BAND OFF `surface` IS 1.91, under the 2.0 field floor: the
		 * panel carries C* 2.9, so the fill cannot be more coloured than the rule's
		 * own 2.5, and the remaining axis is lightness — this palette's whole legal
		 * step is 2.77 L*. Named in `contrast-contract.mjs`'s
		 * `ROW_STATE_MEASURED_SHORTFALL`.
		 */
		rowHover: "#322E2B",
		rowSelected: "#393029",

		// The old primary text was F9FAFB, a blue-white. Every other neutral here
		// holds R greater than G greater than B, and one cool value in an otherwise
		// warm ramp is what makes a palette look accidental, so the primary ink is
		// warmed to match. Same lightness, same legibility.
		ink: "#F8F3EC",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.25:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#C9BCB0",
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.26:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#ACA092",
		inkDisabled: "#6B6055",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 9.14.
		 */
		hairline: "#49391E",
		// Derived. The old theme bounded inputs with orange at 10 percent alpha,
		// which measured about 1.1:1 on the page ground.
		borderControl: "#8A7D6E",

		accent: "#FF8C38",
		accentHover: "#FFA75C",
		accentActive: "#E67016",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 10.12:1 on surface, where the accent
		// itself is 7.70:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFB27A",
		tokenCommand: "#E8C15A",
		/* This palette's second hue: its `info` IS its accent, so the token takes
		   the hue the same palette's editor already paints string literals in. */
		accentWash: "#2C1C10",
		// The old theme paired white with this orange, which measures 2.32:1 — a
		// primary button nobody could read. Ink on the accent fill is the page
		// ground instead, at 8.4:1.
		onAccent: "#0F0D0B",
		/*
		 * No second hue to carry: this palette is desktop-only, so it has no TUI
		 * `label` token and the hue is a ROTATION of `accent` rather than a value
		 * that already existed — Δh 150° at `accent`'s own L*, its chroma walked
		 * down from 71.97 to the first that clears every floor (C* 36.97).
		 * Measured: ΔE00 49.13 from `accent`, 33.16 from its nearest semantic
		 * (`success`), 6.33:1 on the tightest ground (`surface`).
		 */
		accentAlt: "#21BCC9",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 11.98 and C* 12.53, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 23.60 from `accentWash` (the field floor is
		 * 2.0), 7.10:1 for `accentAlt` on it, and 13.34 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#002427",

		// Dune has no semantic hues at all. These three are derived inside the
		// theme's own desert range — olive for success, amber for warning, burnt
		// red for danger — so none of them reads as a foreign import.
		success: "#A3C46B",
		successWash: "#212317",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		successBorder: "#6E814E",

		warning: "#E8C15A",
		warningWash: "#292314",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		warningBorder: "#8E783D",

		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.51:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		danger: "#F66F59",
		dangerWash: "#291713",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.14:1.
		 */
		dangerBorder: "#BE5E4D",

		// Dune has no informational hue, and a blue would be the only cool colour
		// in the theme. Info is the accent triple, as in the brand palettes.
		info: "#FF8C38",
		infoWash: "#2C1C10",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.14:1.
		 */
		infoBorder: "#AF6937",

		overlayShadow: "0 12px 32px -12px rgb(5 4 3 / 0.7)",
		scrim: "rgb(5 4 3 / 0.6)",
	},
};
