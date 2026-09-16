import type { ThemeDefinition } from "../palette-contract";

/**
 * Mint Light.
 *
 * Carried from the TUI's own light family: crisp white with a fresh-mint green
 * accent. The grounds are re-seated on the app's ascending light grammar (the
 * TUI's page is its brightest value) and the mint cast is carried a step
 * deeper than upstream, so the ramp reads as mint rather than as a bleached
 * white beside the app's warm brand papers — that difference in ground
 * temperature is what separates this theme from `localOperatorLight` in a
 * preview, whose accent green is close to this one (ΔE00 2.6) while the two
 * pages are 8.0 apart.
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
export const mintLight: ThemeDefinition = {
	id: "mintLight",
	name: "Mint Light",
	description: "Crisp white with the cool cast of fresh mint.",
	palette: {
		mode: "light",
		canvas: "#E5F2E8",
		surface: "#F1F8F3",
		elevated: "#FBFDFB",
		sunken: "#D6E9DB",

		ink: "#1C2B21",

		// The TUI's muted, lifted 7.1 L*: 7.01:1 on `sunken`, the ground that caps
		// secondary text here.
		inkMuted: "#3C4E42",

		// The TUI's dim, lifted 9.5 L* to clear 4.5:1 on all four grounds — 4.77:1 on
		// `sunken`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		inkDim: "#54675A",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#A3B5A8",

		// The TUI's decorative edge, moved ΔE00 4.35 into this contract's two-sided
		// window: a rule has to be SEEN (ΔE00 4+ on every ground) without becoming a
		// border (2:1 at most). Here it is 1.21:1 at its quietest.
		hairline: "#C6D4C9",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.21:1 on `sunken`, the ground that caps it.
		borderControl: "#6D8373",

		// The TUI's accent, deepened 6.3 L*: on a light ground the deepest surface is
		// what caps a state hue, so the accent has to clear the floor there.
		accent: "#00713F",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#006434",
		accentActive: "#005828",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.30 from `accent` and 9.22:1 on surface, where the
		// accent itself is 5.67:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#004E20",

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#DCF2E2",

		// The theme's own paper at the top of the ramp, at 5.98:1 on all three accent
		// fills.
		onAccent: "#FBFDFB",

		// Upstream success, clearing 5.19:1 at its tightest ground; upstream warning,
		// danger and info re-seat the same way, only as far as their own floors
		// require, so the order of loudness is unchanged.
		success: "#1D6A3E",

		// The TUI has no success or warning tint, so both are the state hue at 8% over
		// the ground — the fraction the TUI's own tints measure at. The hue clears
		// 5.47:1 on this fill.
		successWash: "#E0EDE5",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.30:1 at its tightest ground.
		successBorder: "#538F6C",
		warning: "#7E5800",
		warningWash: "#E8EBE0",
		warningBorder: "#99803C",
		danger: "#B0312E",

		// The TUI's own danger tint.
		dangerWash: "#F9E4E0",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.29:1 at its tightest.
		dangerBorder: "#C06B66",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#09649B",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#E6F0F7",
		infoBorder: "#448AB0",

		// The one shadow in the system, tinted with the theme's own ink.
		overlayShadow: "0 12px 32px -12px rgb(28 43 33 / 0.22)",
		scrim: "rgb(28 43 33 / 0.35)",
	},
};
