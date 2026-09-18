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
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +4.49, elevated +8.61, sunken -3.33 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #1D1510 -> #261E1A (L* 7.54 -> 12.06)
		 * surface #271E17 -> #312720 (L* 12.1 -> 16.54)
		 * elevated #30261E -> #3A3027 (L* 16.05 -> 20.67)
		 * sunken #140E09 -> #1D1815 (L* 4.36 -> 8.73)
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
		canvas: "#261E1A",
		surface: "#312720",
		elevated: "#3A3027",
		sunken: "#1D1815",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 3.2 `L*` lighter (branch L of this port's selection rule), and
		 * carrying 1.52x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `ink-dim` at 5.16:1 on
		 * the row's ground. ΔE00 4.2 from `surface`, 4.18 from `elevated`, 9.68 from
		 * `sunken`, 9.95 from `accentWash`; the inks on the ground are 10.15:1,
		 * 7.09:1, 5.16:1. Continuity with the panel: hue 7.91 degrees off the
		 * panel's (the assertion allows 12) and chroma 10.93 where the panel carries
		 * 7.21.
		 */
		highlight: "#3D2C23",

		ink: "#EDDFD0",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 6.88:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#CFBAA5",

		// The TUI's dim, lifted 7.3 L* to clear 4.5:1 on all four grounds — 4.78:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.01:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#B09F8A",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#55483A",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 4.47.
		 */
		hairline: "#48382F",

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
		borderControl: "#8B7768",

		accent: "#E08D4F",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#EF9A5B",
		accentActive: "#D18043",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.46 from `accent` and 9.70:1 on surface, where the
		// accent itself is 6.30:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFB978",
		tokenCommand: "#7FB0D3",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#292312",

		// The theme's own deepest ground, at 6.27:1 on all three accent fills.
		onAccent: "#140E09",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#c599d6`), received unchanged because it already clears
		 * every floor — ΔE00 39.04 from `accent`, 28.70 from its nearest semantic
		 * (`danger`), 6.17:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#c599d6",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 13.93 and C* 12.31, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 21.24 from `accentWash` (the field floor is
		 * 2.0), 6.64:1 for `accentAlt` on it, and 12.12 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#2B1F2F",

		// Upstream success, clearing 7.54:1 at its tightest ground.
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
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		successBorder: "#757F4D",
		warning: "#DDAB35",
		warningWash: "#3F301B",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		warningBorder: "#97752C",
		danger: "#F37F6F",

		// The TUI's own danger tint.
		dangerWash: "#331B14",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.29:1 at its tightest.
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.02:1.
		 */
		dangerBorder: "#B76355",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#7FB0D3",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#233140",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.01:1.
		 */
		infoBorder: "#627E91",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(20 14 9 / 0.7)",
		scrim: "rgb(20 14 9 / 0.6)",
	},
};
