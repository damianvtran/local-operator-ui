import type { ThemeDefinition } from "../palette-contract";

/**
 * Ocean.
 *
 * Carried from the TUI's own nature family: the deep-sea blue-green ramp, the
 * pale sea-foam accent, and the kelp-green success that keeps "live" and
 * "succeeded" two different things. The sea around the accent is what this
 * theme is, so the accent is used as upstream wrote it and only the roles the
 * TUI has no token for are solved.
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
export const ocean: ThemeDefinition = {
	id: "ocean",
	name: "Ocean",
	description: "Deep-sea blue-green under a pale sea-foam accent.",
	palette: {
		mode: "dark",
		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas ship as L* offsets from it (surface
		 * +4.84, elevated +7.43, sunken -3.48 L*), which is what every ink, edge
		 * and wash block below is measured against - and the offsets the LEGIBILITY PASS
		 * recorded (surface +4.71, elevated +8.78, sunken -3.42 L*) ARE ITS AUTHORING INPUT, NOT THE SHIPPED
		 * RUNG: the row/hover pass moved `elevated` down to the ladder's floor so the
		 * current row can outrank a hovered neighbour. Measured, both moves:
		 * canvas #0C1A20 -> #142228 -> #1D2A31  (L* 8.32 -> 12.26 -> 16.20)
		 * surface #132630 -> #1A2C37 -> #223540  (L* 14.05 -> 16.97 -> 21.04)
		 * elevated #1B2E39 -> #1E323C -> #273B45  (L* 17.84 -> 19.57 -> 23.63)
		 * sunken #081218 -> #131A20 -> #1A2228  (L* 4.97 -> 8.84 -> 12.71)
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
		canvas: "#1D2A31",
		surface: "#223540",
		elevated: "#273B45",
		sunken: "#1A2228",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #303835  accent hue, C* 4.17, +1.66 L*, ΔE00 8.47 off `surface`,
		 *                       `inkDim` 5.45:1 on the fill, hue 10.64° off `accent`.
		 * rowSelected #28403B  accent hue, C* 10.66, +4.01 L*, ΔE00 10.95 off
		 *                       `surface` and 6.79 off `rowHover`, `inkDim` 5.04:1, and the
		 *                       2px `accent` bar at 7.18:1 against it.
		 */
		rowHover: "#303835",
		rowSelected: "#28403B",

		ink: "#DCEBEE",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.20:1.
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
		 * 6.96:1.
		 * The contract's 8 ΔE00 step down to `inkDim` measures
		 * 8.12, and it is what sets the value as much as the floor does.
		 */
		inkMuted: "#B7D1D8",

		// The TUI's dim, lifted 4.1 L* to clear 4.5:1 on all four grounds — 4.77:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.24:1.
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
		 * 5.04:1.
		 * The contract's 8 ΔE00 step up to `inkMuted` measures
		 * 8.12, and it is what sets the value as much as the floor does.
		 */
		inkDim: "#93B4BD",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#3E565F",

		/*
		 * Register re-solve: `hairline`
		 * The one role whose rule binds at BOTH ends, so it is re-solved against all
		 * four grounds at once: a rule has to be seen (ΔE00 4.0) without becoming a
		 * border (2:1), and the window is walked at the role's own hue. Its ratio
		 * lands at 1.16:1 against `elevated` at its tightest.
		 */
		hairline: "#2B464F",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.21:1 on `elevated`, the ground that caps it.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3.02:1. Lightness only, at the role's own hue.
		 */
		/*
		 * Register re-solve: `borderControl`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.02:1. Lightness only, at the role's own
		 * hue.
		 */
		borderControl: "#648792",

		accent: "#84E0CF",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#92EEDD",
		accentActive: "#76D2C1",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.29 from `accent` and 11.53:1 on surface, where the
		// accent itself is 10.05:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#C2FFFF",
		tokenCommand: "#72B6E4",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#1B3935",

		// The theme's own deepest ground, at 10.59:1 on all three accent fills.
		onAccent: "#081218",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#ab9ce0`), received unchanged because it already clears
		 * every floor — ΔE00 35.30 from `accent`, 39.28 from its nearest semantic
		 * (`danger`), 5.87:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#ab9ce0",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 21.64 and C* 12.45, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 21.68 from `accentWash` (the field floor is
		 * 2.0), 5.11:1 for `accentAlt` on it, and 12.42 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#363142",

		// Upstream success, clearing 5.82:1 at its tightest ground.
		success: "#6CC99B",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 5.97:1 on this fill.
		successWash: "#1F3B3E",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.50:1 at its tightest ground.
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		/*
		 * Register re-solve: `successBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.04:1. Lightness only, at the role's own
		 * hue.
		 */
		successBorder: "#508E74",
		warning: "#D9B45C",
		warningWash: "#2D3836",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		/*
		 * Register re-solve: `warningBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.00:1. Lightness only, at the role's own
		 * hue.
		 */
		warningBorder: "#91804D",
		danger: "#EF8B85",

		// The TUI's own danger tint.
		dangerWash: "#26212A",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.31:1 at its tightest.
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		/*
		 * Register re-solve: `dangerBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.01:1. Lightness only, at the role's own
		 * hue.
		 */
		dangerBorder: "#B36F6D",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#72B6E4",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#1A2C42",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.14:1.
		 */
		/*
		 * Register re-solve: `infoBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.03:1. Lightness only, at the role's own
		 * hue.
		 */
		infoBorder: "#5987A7",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(8 18 24 / 0.7)",
		scrim: "rgb(8 18 24 / 0.6)",
	},
};
