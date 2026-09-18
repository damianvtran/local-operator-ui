import type { ThemeDefinition } from "../palette-contract";

/**
 * Desert.
 *
 * Carried from the TUI's own nature family: sunlit-sand ground, terracotta
 * accent, one stripe of cactus green. The accent and warning share warmth, so
 * warning is pushed yellow and danger toward a clear coral-red — a red that
 * clears the floors on a warm ground is a re-solve rather than a copy, because
 * the sand already carries much of the luminance a cool theme's red relies on
 * for separation.
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
export const desert: ThemeDefinition = {
	id: "desert",
	name: "Desert",
	description: "Warm dark sand under a terracotta glow and cactus green.",
	palette: {
		mode: "dark",
		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas ship as L* offsets from it (surface
		 * +4.52, elevated +7.75, sunken -4.08 L*), which is what every ink, edge
		 * and wash block below is measured against - and the offsets the LEGIBILITY PASS
		 * recorded (surface +4.39, elevated +8.21, sunken -4.22 L*) ARE ITS AUTHORING INPUT, NOT THE SHIPPED
		 * RUNG: the row/hover pass moved `elevated` down to the ladder's floor so the
		 * current row can outrank a hovered neighbour. Measured, both moves:
		 * canvas #271E12 -> #271E13 -> #342A1F  (L* 11.98 -> 12 -> 17.85)
		 * surface #31271A -> #31271A -> #3E3426  (L* 16.4 -> 16.4 -> 22.37)
		 * elevated #392E20 -> #392E20 -> #463B2C  (L* 20.21 -> 19.75 -> 25.60)
		 * sunken #1D160C -> #1D160C -> #29221A  (L* 7.78 -> 7.78 -> 13.77)
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
		canvas: "#342A1F",
		surface: "#3E3426",
		elevated: "#463B2C",
		sunken: "#29221A",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #3F3834  accent hue, C* 4.26, +1.73 L*, ΔE00 5.61 off `surface`,
		 *                       `inkDim` 5.62:1 on the fill, hue 2.08° off `accent`.
		 * rowSelected #513C30  accent hue, C* 13.22, +4.91 L*, ΔE00 7.36 off
		 *                       `surface` and 7.61 off `rowHover`, `inkDim` 5.04:1, and the
		 *                       2px `accent` bar at 4.59:1 against it.
		 */
		rowHover: "#3F3834",
		rowSelected: "#513C30",

		ink: "#F0E6D5",

		// The TUI's muted, lifted 1.1 L*: 6.72:1 on `elevated`, the ground that caps
		// secondary text here.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `highlight` binds it at 7.06:1.
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
		 * 8.20, and it is what sets the value as much as the floor does.
		 */
		inkMuted: "#E2D2BD",

		// The TUI's dim, lifted 8.0 L* to clear 4.5:1 on all four grounds — 4.78:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.16:1.
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
		 * 8.20, and it is what sets the value as much as the floor does.
		 */
		inkDim: "#C1B49B",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#5B503E",

		/*
		 * Register re-solve: `hairline`
		 * The one role whose rule binds at BOTH ends, so it is re-solved against all
		 * four grounds at once: a rule has to be seen (ΔE00 4.0) without becoming a
		 * border (2:1), and the window is walked at the role's own hue. Its ratio
		 * lands at 1.20:1 against `elevated` at its tightest.
		 */
		hairline: "#554634",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.21:1 on `elevated`, the ground that caps it.
		/*
		 * Register re-solve: `borderControl`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.03:1. Lightness only, at the role's own
		 * hue.
		 */
		borderControl: "#97846C",

		accent: "#E59D6A",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#F4AA77",
		accentActive: "#D6905D",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.29 from `accent` and 8.14:1 on surface, where the
		// accent itself is 6.52:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFC993",
		tokenCommand: "#84BAD8",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#3D3B24",

		// The theme's own deepest ground, at 6.83:1 on all three accent fills.
		onAccent: "#1D160C",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#cb9edc`), received unchanged because it already clears
		 * every floor — ΔE00 36.78 from `accent`, 56.94 from its nearest semantic
		 * (`danger`), 6.59:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#cb9edc",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 24.47 and C* 14.98, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 26.65 from `accentWash` (the field floor is
		 * 2.0), 5.13:1 for `accentAlt` on it, and 18.11 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#433549",

		// Upstream success, clearing 5.38:1 at its tightest ground.
		success: "#9AC275",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 5.55:1 on this fill.
		successWash: "#3F3B26",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.37:1 at its tightest ground.
		/*
		 * Register re-solve: `successBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.04:1. Lightness only, at the role's own
		 * hue.
		 */
		successBorder: "#7A8E5A",
		warning: "#E2B148",
		warningWash: "#483920",
		/*
		 * Register re-solve: `warningBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.04:1. Lightness only, at the role's own
		 * hue.
		 */
		warningBorder: "#A4823E",
		danger: "#F88586",

		// The TUI's own danger tint.
		dangerWash: "#3B2419",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.31:1 at its tightest.
		/*
		 * Register re-solve: `dangerBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.01:1. Lightness only, at the role's own
		 * hue.
		 */
		dangerBorder: "#C46E6B",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#84BAD8",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#2C3843",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.07:1.
		 */
		/*
		 * Register re-solve: `infoBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.02:1. Lightness only, at the role's own
		 * hue.
		 */
		infoBorder: "#6E8B98",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(29 22 12 / 0.7)",
		scrim: "rgb(29 22 12 / 0.6)",
	},
};
