import type { ThemeDefinition } from "../palette-contract";

/**
 * Rosewood.
 *
 * Carried from the TUI's own nature family: dark rosewood grounds, a
 * dried-rose accent and a brass-amber warning. It is the family's warm-red
 * member, and the one theme here whose accent and danger are neighbours in
 * hue; they are separated by lightness and chroma rather than by hue, which is
 * how the TUI solved that pair.
 *
 * Roles the TUI has no token for take one rule each, applied identically
 * across this port. `accentHover` and `accentActive` are one ~5 L* step of the
 * accent ramp in each direction, hover away from the ground and pressed toward
 * it. `chartBarHover` is a step further from the plot ground than the accent
 * is, never a step along the accent ramp. `onAccent` is the theme's own
 * deepest ground. The washes are the TUI's own `tint-*` where it has one and
 * the state hue at 13% over the well where it does not; each border is that
 * hue pulled toward `canvas` as far as it can go while still reading as an
 * edge. The TUI's `dim` and `edge-hi` move only as far as the floors require,
 * and the overlay tint is the theme's own well.
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
export const rosewood: ThemeDefinition = {
	id: "rosewood",
	name: "Rosewood",
	description: "Dark rosewood with dried-rose reds and a glint of brass.",
	palette: {
		mode: "dark",
		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas ship as L* offsets from it (surface
		 * +4.22, elevated +7.73, sunken -3.21 L*), which is what every ink, edge
		 * and wash block below is measured against - and the offsets the LEGIBILITY PASS
		 * recorded (surface +4.44, elevated +8.61, sunken -3.16 L*) ARE ITS AUTHORING INPUT, NOT THE SHIPPED
		 * RUNG: the row/hover pass moved `elevated` down to the ladder's floor so the
		 * current row can outrank a hovered neighbour. Measured, both moves:
		 * canvas #201314 -> #2A1C1D -> #302122  (L* 7.44 -> 12.03 -> 14.58)
		 * surface #2A1C1D -> #342526 -> #392A2B  (L* 12.03 -> 16.47 -> 18.80)
		 * elevated #332425 -> #3A2C2D -> #403232  (L* 16 -> 19.60 -> 22.31)
		 * sunken #170C0D -> #201718 -> #251C1D  (L* 4.28 -> 8.87 -> 11.36)
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
		canvas: "#302122",
		surface: "#392A2B",
		elevated: "#403232",
		sunken: "#251C1D",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #383033  accent hue, C* 4.28, +2.00 L*, ΔE00 4.07 off `surface`,
		 *                       `inkDim` 5.42:1 on the fill, hue 2.16° off `accent`.
		 * rowSelected #493039  accent hue, C* 13.02, +4.29 L*, ΔE00 6.48 off
		 *                       `surface` and 8.41 off `rowHover`, `inkDim` 5.03:1, and the
		 *                       2px `accent` bar at 5.32:1 against it.
		 */
		rowHover: "#383033",
		rowSelected: "#493039",

		ink: "#EEE0DC",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.17:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		/*
		 * Register re-solve: `inkMuted`
		 * Re-seated a second time, with the band, and lightness is still the only
		 * axis: the floor is 5.5:1 on all SEVEN grounds (the four elevation
		 * steps, `accentWash` and the two row states), and `rowSelected` binds it at
		 * 6.97:1.
		 * The contract's 8 ΔE00 step down to `inkDim` measures
		 * 8.05, and it is what sets the value as much as the floor does.
		 */
		inkMuted: "#D9C1BC",

		// The TUI's dim, lifted 7.0 L* to clear 4.5:1 on all four grounds — 4.78:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.18:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		/*
		 * Register re-solve: `inkDim`
		 * Re-seated a second time, with the band, and lightness is still the only
		 * axis: the floor is 5:1 on all SEVEN grounds (the four elevation
		 * steps, `accentWash` and the two row states), and `rowSelected` binds it at
		 * 5.03:1.
		 * The contract's 8 ΔE00 step up to `inkMuted` measures
		 * 8.05, and it is what sets the value as much as the floor does.
		 */
		inkDim: "#B9A49F",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#584745",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 4.36.
		 */
		/*
		 * Register re-solve: `hairline`
		 * The one role whose rule binds at BOTH ends, so it is re-solved against all
		 * four grounds at once: a rule has to be seen (ΔE00 4.0) without becoming a
		 * border (2:1), and the window is walked at the role's own hue. Its ratio
		 * lands at 1.16:1 against `elevated` at its tightest.
		 */
		hairline: "#4F3A39",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.20:1 on `elevated`, the ground that caps it.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3.03:1. Lightness only, at the role's own hue.
		 */
		/*
		 * Register re-solve: `borderControl`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.03:1. Lightness only, at the role's own
		 * hue.
		 */
		borderControl: "#927975",

		accent: "#E895B5",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#F7A3C3",
		accentActive: "#D988A8",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.30 from `accent` and 9.27:1 on surface, where the
		// accent itself is 7.33:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFC4E4",
		tokenCommand: "#82B1D4",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#31281D",

		// The theme's own deepest ground, at 7.34:1 on all three accent fills.
		onAccent: "#170C0D",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#c99bd2`),
		 * moved onto the floors: as received it sat ΔE00 11.50 from `accent`. That
		 * is paid on HUE — the hue walked 14.8° off the source and L* 69.83 → 69.77
		 * — because a value that bought the separation by darkening would be the
		 * same hue at another weight. Measured: ΔE00 17.06 from `accent`, 29.06
		 * from its nearest semantic (`danger`), 6.32:1 on the tightest ground
		 * (`surface`).
		 */
		accentAlt: "#B7A0DD",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 16.79 and C* 9.07, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 14.19 from `accentWash` (the field floor is
		 * 2.0), 6.27:1 for `accentAlt` on it, and 7.30 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#2D2733",

		// Upstream success, clearing 5.73:1 at its tightest ground.
		success: "#94BD80",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 6.00:1 on this fill.
		successWash: "#38312A",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.46:1 at its tightest ground.
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.10:1.
		 */
		/*
		 * Register re-solve: `successBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.01:1. Lightness only, at the role's own
		 * hue.
		 */
		successBorder: "#718460",
		warning: "#D8AB58",
		warningWash: "#412F25",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.11:1.
		 */
		/*
		 * Register re-solve: `warningBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.01:1. Lightness only, at the role's own
		 * hue.
		 */
		warningBorder: "#997947",
		danger: "#EA8378",

		// The TUI's own danger tint.
		dangerWash: "#371C1C",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.35:1 at its tightest.
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.11:1.
		 */
		/*
		 * Register re-solve: `dangerBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.01:1. Lightness only, at the role's own
		 * hue.
		 */
		dangerBorder: "#B66961",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#82B1D4",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#263140",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.11:1.
		 */
		/*
		 * Register re-solve: `infoBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.02:1. Lightness only, at the role's own
		 * hue.
		 */
		infoBorder: "#698197",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(23 12 13 / 0.7)",
		scrim: "rgb(23 12 13 / 0.6)",
	},
};
