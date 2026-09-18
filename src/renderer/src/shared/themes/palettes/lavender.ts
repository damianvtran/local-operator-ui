import type { ThemeDefinition } from "../palette-contract";

/**
 * Lavender.
 *
 * Carried from the TUI's own nature family: a purple-grey dusk ramp and a soft
 * lavender accent. This is the family's violet-neutral member — the ground is
 * a desaturated purple rather than a slate, and the accent is the one
 * saturated value in it — so nothing here is re-hued, only seated.
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
export const lavender: ThemeDefinition = {
	id: "lavender",
	name: "Lavender",
	description: "Purple-grey dusk lit by a soft lavender glow.",
	palette: {
		mode: "dark",
		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +4.04, elevated +8.07, sunken -3.39 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #191623 -> #211E2B (L* 8.15 -> 12.13)
		 * surface #211E2E -> #292637 (L* 12.28 -> 16.17)
		 * elevated #2A2638 -> #302B3D (L* 16.33 -> 18.77)
		 * sunken #110F19 -> #191821 (L* 4.8 -> 8.74)
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
		canvas: "#211E2B",
		surface: "#292637",
		elevated: "#302B3D",
		sunken: "#191821",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 3.15 `L*` lighter (branch L of this port's selection rule), and
		 * carrying 1.44x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `ink-dim` at 5.16:1 on
		 * the row's ground. ΔE00 4.19 from `surface`, 3.04 from `elevated`, 10.34
		 * from `sunken`, 7.39 from `accentWash`; the inks on the ground are 10.58:1,
		 * 7.03:1, 5.16:1. Continuity with the panel: hue 2.75 degrees off the
		 * panel's (the assertion allows 12) and chroma 17.36 where the panel carries
		 * 12.02.
		 */
		highlight: "#312B44",

		ink: "#E6E2F0",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.13:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#BEB8D1",

		// The TUI's dim, lifted 7.5 L* to clear 4.5:1 on all four grounds — 4.79:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.23:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#A49CBB",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#4C4762",

		// The TUI's decorative edge, moved ΔE00 0.32 into this contract's two-sided
		// window: a rule has to be SEEN (ΔE00 4+ on every ground) without becoming a
		// border (2:1 at most). Here it is 1.20:1 at its quietest.
		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 6.62.
		 */
		hairline: "#3C3656",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.21:1 on `elevated`, the ground that caps it.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3.03:1. Lightness only, at the role's own hue.
		 */
		borderControl: "#7D749E",

		accent: "#B9A3E8",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#C7B0F6",
		accentActive: "#AB96DA",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.46 from `accent` and 11.22:1 on surface, where the
		// accent itself is 7.34:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#E4CDFF",
		tokenCommand: "#7DB2E2",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#1F2333",

		// The theme's own deepest ground, at 7.33:1 on all three accent fills.
		onAccent: "#110F19",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#cf94d8`,
		 * pinker violet than accent), moved onto the floors: as received it sat
		 * ΔE00 8.58 from `accent`. That is paid on HUE — the hue walked 14.9° off
		 * the source and L* 69.04 → 78.58 — because a value that bought the
		 * separation by darkening would be the same hue at another weight.
		 * Measured: ΔE00 15.10 from `accent`, 16.12 from its nearest semantic
		 * (`danger`), 8.30:1 on the tightest ground (`surface`).
		 */
		accentAlt: "#FCA8E2",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 14.01 and C* 11.46, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 10.52 from `accentWash` (the field floor is
		 * 2.0), 8.83:1 for `accentAlt` on it, and 6.90 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#2F1E2A",

		// Upstream success, clearing 8.26:1 at its tightest ground.
		success: "#7FC98F",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 6.40:1 on this fill.
		successWash: "#2D343B",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.66:1 at its tightest ground.
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		successBorder: "#578365",
		warning: "#DCAE54",
		warningWash: "#393133",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		warningBorder: "#927543",
		danger: "#EF8595",

		// The TUI's own danger tint.
		dangerWash: "#2B1A26",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.35:1 at its tightest.
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.14:1.
		 */
		dangerBorder: "#AE6372",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#7DB2E2",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#1C2740",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		infoBorder: "#5D7C9E",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(17 15 25 / 0.7)",
		scrim: "rgb(17 15 25 / 0.6)",
	},
};
