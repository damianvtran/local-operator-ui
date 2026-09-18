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
		 * The current row's own ground: `surface` stepped 5.55 `L*` up at the panel's own
		 * hue (2.0 degrees off, inside the 12-degree bound) and carried
		 * 11.87 `C*` against the panel's 11.00 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 3.97, from
		 * `elevated` 1.35, from `sunken` 10.33. Ink on this ground: `ink` 9.61:1,
		 * `ink-muted` 6.60:1, `ink-dim` 4.68:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `0.91x` the panel's
		 * chroma (10.05 `C*` against 11.00), 11 degrees off its hue, ΔE00 4.12 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * THE HOVER STEP IS THE COLLISION: 1.35 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_ADJACENT_PINS` and is
		 * on the row-hover work list.
		 */
		highlight: "#2F3A4B",

		ink: "#E3ECF4",

		// The TUI's muted, lifted 4.0 L*: 6.75:1 on `elevated`, the ground that caps
		// secondary text here.
		inkMuted: "#B4C7D5",

		// The TUI's dim, lifted 9.5 L* to clear 4.5:1 on all four grounds — 4.79:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		inkDim: "#90A9B9",

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

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#1C332F",

		// The theme's own deepest ground, at 9.24:1 on all three accent fills.
		onAccent: "#121A25",

		// Upstream success, clearing 6.84:1 at its tightest ground.
		success: "#6CC99B",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 5.28:1 on this fill.
		successWash: "#2C4249",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.35:1 at its tightest ground.
		successBorder: "#4C8972",
		warning: "#DCB45E",
		warningWash: "#3B3F41",
		warningBorder: "#8E7A4C",
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
		infoBorder: "#5881A1",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(18 26 37 / 0.7)",
		scrim: "rgb(18 26 37 / 0.6)",
	},
};
