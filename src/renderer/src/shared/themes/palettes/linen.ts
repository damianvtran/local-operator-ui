import type { ThemeDefinition } from "../palette-contract";

/**
 * Linen.
 *
 * Carried from the TUI's own light family: a cool off-white weave whose ramp
 * holds G above R above B, with states in soft dusty pastels. Two things here
 * are deliberate. The grounds are re-seated on the app's ascending light
 * grammar (the TUI's page is its brightest value), and the whole ramp stays on
 * the cool side of the paper axis — against `paper`, whose ground sits at the
 * same lightness (ΔL* 0.4) but 8.1 b* points warmer, this is the softer of the
 * pair rather than a second cream.
 *
 * Roles the TUI has no token for take one rule each, applied identically
 * across this port. `accentHover` and `accentActive` are one ~5 L* step of the
 * accent ramp in each direction — darker, because a light ground's ramp
 * descends — `chartBarHover` is a step further from the plot ground than the
 * accent is, `onAccent` is the top of the ground ramp, and the washes sit just
 * off the paper with the state hue at 8%. Each border is the state hue pulled
 * toward `canvas` as far as it can go while still reading as an edge. Upstream
 * `dim`, `edge-hi` and the state hues re-seat only as far as the floors
 * require: in a light theme it is the deepest ground that caps them, not the
 * brightest.
 */
export const linen: ThemeDefinition = {
	id: "linen",
	name: "Linen",
	description: "Cool off-white linen with soft dusty-pastel states.",
	palette: {
		mode: "light",
		canvas: "#DEE0DB",
		surface: "#E8E9E6",
		elevated: "#F4F4F1",
		sunken: "#D3D5D0",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.07 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 5 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.02 from `surface`, 6.27 from `elevated` and 2.32 from `sunken`;
		 * the step is -4.98 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 5.07:1 the ink that binds it.
		 */
		highlight: "#D6DCD8",

		ink: "#2B2E2C",

		// The TUI's muted, lifted 12.0 L*: 7.07:1 on `sunken`, the ground that caps
		// secondary text here.
		inkMuted: "#3B413D",

		// The TUI's dim, lifted 14.1 L* to clear 4.5:1 on all four grounds — 4.77:1 on
		// `sunken`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		inkDim: "#545A56",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#A9B0AA",

		// The TUI's decorative edge, moved ΔE00 6.47 into this contract's two-sided
		// window: a rule has to be SEEN (ΔE00 4+ on every ground) without becoming a
		// border (2:1 at most). Here it is 1.20:1 at its quietest.
		hairline: "#C1C3BF",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.21:1 on `sunken`, the ground that caps it.
		borderControl: "#71746F",

		// The TUI's accent, deepened 7.6 L*: on a light ground the deepest surface is
		// what caps a state hue, so the accent has to clear the floor there.
		accent: "#236256",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#14564A",
		accentActive: "#014A3F",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.21 from `accent` and 9.78:1 on surface, where the
		// accent itself is 5.83:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#003F35",

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#E4E9E2",

		// The theme's own paper at the top of the ramp, at 6.45:1 on all three accent
		// fills.
		onAccent: "#F4F4F1",

		// Upstream success, re-seated 10.8 L* to hold 4.99:1 on the deepest ground;
		// upstream warning, danger and info re-seat the same way, only as far as their
		// own floors require, so the order of loudness is unchanged.
		success: "#335F3C",

		// The TUI has no success or warning tint, so both are the state hue at 8% over
		// the ground — the fraction the TUI's own tints measure at. The hue clears
		// 5.42:1 on this fill.
		successWash: "#DADED8",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.36:1 at its tightest ground.
		successBorder: "#5E7F64",
		warning: "#6E5117",
		warningWash: "#DEDDD5",
		warningBorder: "#8B764A",
		danger: "#8A3F3B",

		// The TUI's own danger tint.
		dangerWash: "#F0E1DE",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.31:1 at its tightest.
		dangerBorder: "#A16A66",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#3C5876",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#E5E9EC",
		infoBorder: "#667B90",

		// The one shadow in the system, tinted with the theme's own ink.
		overlayShadow: "0 12px 32px -12px rgb(43 46 44 / 0.22)",
		scrim: "rgb(43 46 44 / 0.35)",
	},
};
