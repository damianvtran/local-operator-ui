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
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +4.71, elevated +8.78, sunken -3.42 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #0C1A20 -> #142228 (L* 8.32 -> 12.26)
		 * surface #132630 -> #1A2C37 (L* 14.05 -> 16.97)
		 * elevated #1B2E39 -> #1E323C (L* 17.84 -> 19.57)
		 * sunken #081218 -> #131A20 (L* 4.97 -> 8.84)
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
		canvas: "#142228",
		surface: "#1A2C37",
		elevated: "#1E323C",
		sunken: "#131A20",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 2.95 `L*` lighter (branch L of this port's selection rule), and
		 * carrying 1.49x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `ink-dim` at 5.17:1 on
		 * the row's ground. ΔE00 4.11 from `surface`, 3.27 from `elevated`, 10.51
		 * from `sunken`, 11.92 from `accentWash`; the inks on the ground are
		 * 10.72:1, 7.09:1, 5.17:1. Continuity with the panel: hue 3.18 degrees off
		 * the panel's (the assertion allows 12) and chroma 14.97 where the panel
		 * carries 10.07.
		 */
		highlight: "#123444",

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
		inkMuted: "#A9C3CA",

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
		inkDim: "#87A8B1",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#3E565F",

		hairline: "#254049",

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
		borderControl: "#5E818C",

		accent: "#84E0CF",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#92EEDD",
		accentActive: "#76D2C1",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.29 from `accent` and 14.13:1 on surface, where the
		// accent itself is 10.05:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#C2FFFF",
		tokenCommand: "#72B6E4",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#12302C",

		// The theme's own deepest ground, at 10.59:1 on all three accent fills.
		onAccent: "#081218",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#ab9ce0`), received unchanged because it already clears
		 * every floor — ΔE00 35.30 from `accent`, 29.42 from its nearest semantic
		 * (`danger`), 5.87:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#ab9ce0",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 17.57 and C* 12.44, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 21.46 from `accentWash` (the field floor is
		 * 2.0), 5.75:1 for `accentAlt` on it, and 11.65 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#2D293A",

		// Upstream success, clearing 7.77:1 at its tightest ground.
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
		successBorder: "#49876D",
		warning: "#D9B45C",
		warningWash: "#2D3836",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		warningBorder: "#8B7A47",
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
		dangerBorder: "#AC6967",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#72B6E4",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#1A2C42",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.14:1.
		 */
		infoBorder: "#5280A0",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(8 18 24 / 0.7)",
		scrim: "rgb(8 18 24 / 0.6)",
	},
};
