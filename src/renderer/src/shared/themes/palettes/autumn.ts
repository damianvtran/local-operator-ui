import type { ThemeDefinition } from "../palette-contract";

/**
 * Autumn.
 *
 * Carried from the TUI's own nature family: dark oak ground, maple-orange
 * accent, harvest amber warning and a lifted maple red, because a cool theme's
 * crimson measures under 3.5:1 on oak. Success is a drying leaf-green rather
 * than a spring green, which is what keeps it apart from the accent beside it.
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
export const autumn: ThemeDefinition = {
	id: "autumn",
	name: "Autumn",
	description: "Dark oak under maple red and harvest amber.",
	palette: {
		mode: "dark",
		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas ship as L* offsets from it (surface
		 * +4.50, elevated +7.08, sunken -3.24 L*), which is what every ink, edge
		 * and wash block below is measured against - and the offsets the LEGIBILITY PASS
		 * recorded (surface +4.49, elevated +8.61, sunken -3.33 L*) ARE ITS AUTHORING INPUT, NOT THE SHIPPED
		 * RUNG: the row/hover pass moved `elevated` down to the ladder's floor so the
		 * current row can outrank a hovered neighbour. Measured, both moves:
		 * canvas #1D1510 -> #261E1A -> #2C2420  (L* 7.54 -> 12.06 -> 14.96)
		 * surface #271E17 -> #312720 -> #382D26  (L* 12.1 -> 16.54 -> 19.46)
		 * elevated #30261E -> #362D24 -> #3D332A  (L* 16.05 -> 19.18 -> 22.04)
		 * sunken #140E09 -> #1D1815 -> #231E1B  (L* 4.36 -> 8.73 -> 11.72)
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
		canvas: "#2C2420",
		surface: "#382D26",
		elevated: "#3D332A",
		sunken: "#231E1B",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are a
		 * step of THIS palette's own panel at the panel's own hue; they used to be
		 * tints of `accent`, whose hue is more than 45 degrees off the panel on 25 of
		 * the 59 themes - the off-colour the operator reported. The rule, and why the
		 * fill now carries the ranking the 2px `accent` bar used to, are in the two
		 * roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #3A342F  panel hue, C* 4.44,
		 *                       the rule's 0.60 x the panel's 7.42; +2.70 L*,
		 *                       ΔE00 3.58 off `surface`, `inkDim` 5.25:1.
		 * rowSelected #453429  panel hue, C* 11.47,
		 *                       the panel's cast + 4.0, floored at 5.0; +3.81 L*,
		 *                       ΔE00 4.12 off `surface` and 6.17 off
		 *                       `rowHover`; the pair ranks 1.11 `L*` and 7.0 `C*`,
		 *                       `inkDim` 5.06:1.
		 */
		rowHover: "#3A342F",
		rowSelected: "#453429",

		ink: "#EDDFD0",
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
		 * 6.97:1.
		 * The contract's 8 ΔE00 step down to `inkDim` measures
		 * 8.18, and it is what sets the value as much as the floor does.
		 */
		inkMuted: "#D9C4AF",

		// The TUI's dim, lifted 7.3 L* to clear 4.5:1 on all four grounds — 4.78:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
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
		/*
		 * Register re-solve: `inkDim`
		 * Re-seated a second time, with the band, and lightness is still the only
		 * axis: the floor is 5:1 on all SEVEN grounds (the four elevation
		 * steps, `accentWash` and the two row states), and `rowSelected` binds it at
		 * 5.02:1.
		 * The contract's 8 ΔE00 step up to `inkMuted` measures
		 * 8.18, and it is what sets the value as much as the floor does.
		 */
		inkDim: "#B8A792",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#55483A",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 4.47.
		 */
		/*
		 * Register re-solve: `hairline`
		 * The one role whose rule binds at BOTH ends, so it is re-solved against all
		 * four grounds at once: a rule has to be seen (ΔE00 4.0) without becoming a
		 * border (2:1), and the window is walked at the role's own hue. Its ratio
		 * lands at 1.16:1 against `elevated` at its tightest.
		 */
		hairline: "#4B3B32",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.19:1 on `elevated`, the ground that caps it.
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
		borderControl: "#8E7A6B",

		accent: "#E08D4F",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#EF9A5B",
		accentActive: "#D18043",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.46 from `accent` and 7.93:1 on surface, where the
		// accent itself is 6.30:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFB978",
		tokenCommand: "#7FB0D3",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#302918",

		// The theme's own deepest ground, at 6.27:1 on all three accent fills.
		onAccent: "#140E09",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#c599d6`), received unchanged because it already clears
		 * every floor — ΔE00 39.05 from `accent`, 54.99 from its nearest semantic
		 * (`danger`), 6.17:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#c599d6",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 16.89 and C* 12.34, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 20.84 from `accentWash` (the field floor is
		 * 2.0), 6.13:1 for `accentAlt` on it, and 12.03 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#322535",

		// Upstream success, clearing 5.68:1 at its tightest ground.
		success: "#A2B96A",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 5.90:1 on this fill.
		successWash: "#373222",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.41:1 at its tightest ground.
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
		successBorder: "#798351",
		warning: "#DDAB35",
		warningWash: "#3F301B",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.14:1.
		 */
		/*
		 * Register re-solve: `warningBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.03:1. Lightness only, at the role's own
		 * hue.
		 */
		warningBorder: "#9B7930",
		danger: "#F37F6F",

		// The TUI's own danger tint.
		dangerWash: "#331B14",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.29:1 at its tightest.
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.16:1.
		 */
		/*
		 * Register re-solve: `dangerBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.01:1. Lightness only, at the role's own
		 * hue.
		 */
		dangerBorder: "#BA6658",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#7FB0D3",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#233140",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		/*
		 * Register re-solve: `infoBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.00:1. Lightness only, at the role's own
		 * hue.
		 */
		infoBorder: "#658194",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(20 14 9 / 0.7)",
		scrim: "rgb(20 14 9 / 0.6)",
	},
};
