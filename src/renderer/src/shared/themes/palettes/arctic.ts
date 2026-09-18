import type { ThemeDefinition } from "../palette-contract";

/**
 * Arctic.
 *
 * Carried from the TUI's own nature family: a slate-blue polar ground lit by
 * an aurora-green accent. It does not collide with the app's `iceberg`, which
 * is the other name a reader might reach for here: iceberg is a light
 * blue-grey theme whose accent is a deep muted indigo, while this is a dark
 * slate with a saturated green — opposite polarity, opposite accent, ΔE00 58.6
 * between the two accents. Its nearest neighbour is `ocean`, held apart the
 * way the TUI held the pair: arctic's ground is bluer and a step lighter, and
 * its accent is a green where ocean's is a sea-foam cyan.
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
export const arctic: ThemeDefinition = {
	id: "arctic",
	name: "Arctic",
	description: "Slate-blue polar night lit by an aurora-green accent.",
	palette: {
		mode: "dark",
		canvas: "#1A2431",
		surface: "#232E3D",
		elevated: "#2C3949",
		sunken: "#121A25",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 4.65 `L*` lighter (branch L of this port's selection rule), and
		 * carrying 1.41x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `ink-dim` at 5.19:1 on
		 * the row's ground. ΔE00 4.23 from `surface`, 2.68 from `elevated`, 10.34
		 * from `sunken`, 16.25 from `accentWash`; the inks on the ground are 9.95:1,
		 * 7.13:1, 5.19:1. Continuity with the panel: hue 1.88 degrees off the
		 * panel's (the assertion allows 15) and chroma 15.49 where the panel carries
		 * 11.
		 */
		highlight: "#28384E",

		ink: "#E3ECF4",

		// The TUI's muted, lifted 4.0 L*: 6.75:1 on `elevated`, the ground that caps
		// secondary text here.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `highlight` binds it at 7.08:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#B8CBD9",

		// The TUI's dim, lifted 9.5 L* to clear 4.5:1 on all four grounds — 4.79:1 on
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
		inkDim: "#95AFBF",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#425666",

		// The TUI's decorative edge, moved ΔE00 0.66 into this contract's two-sided
		// window: a rule has to be SEEN (ΔE00 4+ on every ground) without becoming a
		// border (2:1 at most). Here it is 1.20:1 at its quietest.
		hairline: "#33455C",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.19:1 on `elevated`, the ground that caps it.
		borderControl: "#7187A4",

		accent: "#68E0A3",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#77EEB0",
		accentActive: "#59D296",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.27 from `accent` and 11.80:1 on surface, where the
		// accent itself is 8.35:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#A8FFE0",
		tokenCommand: "#7FBDE8",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#1C332F",

		// The theme's own deepest ground, at 9.24:1 on all three accent fills.
		onAccent: "#121A25",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#b0a3e6`), received unchanged because it already clears
		 * every floor — ΔE00 42.11 from `accent`, 27.54 from its nearest semantic
		 * (`danger`), 6.03:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#b0a3e6",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 19.31 and C* 10.22, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 18.77 from `accentWash` (the field floor is
		 * 2.0), 5.89:1 for `accentAlt` on it, and 7.48 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#302D3C",

		// Upstream success, clearing 6.84:1 at its tightest ground.
		success: "#6CC99B",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 5.28:1 on this fill.
		successWash: "#2C4249",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.35:1 at its tightest ground.
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.02:1.
		 */
		successBorder: "#4F8D75",
		warning: "#DCB45E",
		warningWash: "#3B3F41",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.01:1.
		 */
		warningBorder: "#937F50",
		danger: "#F08D90",

		// The TUI's own danger tint.
		dangerWash: "#32262E",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.32:1 at its tightest.
		dangerBorder: "#BD7479",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#7FBDE8",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#22344C",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		infoBorder: "#5D85A6",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(18 26 37 / 0.7)",
		scrim: "rgb(18 26 37 / 0.6)",
	},
};
