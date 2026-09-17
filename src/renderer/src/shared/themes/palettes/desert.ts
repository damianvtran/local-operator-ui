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
 */
export const desert: ThemeDefinition = {
	id: "desert",
	name: "Desert",
	description: "Warm dark sand under a terracotta glow and cactus green.",
	palette: {
		mode: "dark",
		canvas: "#271E12",
		surface: "#31271A",
		elevated: "#3A2F21",
		sunken: "#1D160C",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.07 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 4.5 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.34 from `surface`, 2.9 from `elevated` and 9.94 from `sunken`;
		 * the step is 4.41 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.69:1 the ink that binds it.
		 */
		highlight: "#3F2F20",

		ink: "#F0E6D5",

		// The TUI's muted, lifted 1.1 L*: 6.72:1 on `elevated`, the ground that caps
		// secondary text here.
		inkMuted: "#C7B8A3",

		// The TUI's dim, lifted 8.0 L* to clear 4.5:1 on all four grounds — 4.78:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		inkDim: "#A89B83",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#5B503E",

		hairline: "#4A3C2A",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.21:1 on `elevated`, the ground that caps it.
		borderControl: "#8E7B63",

		accent: "#E59D6A",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#F4AA77",
		accentActive: "#D6905D",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.29 from `accent` and 9.77:1 on surface, where the
		// accent itself is 6.52:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFC993",

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#2F2E18",

		// The theme's own deepest ground, at 6.83:1 on all three accent fills.
		onAccent: "#1D160C",

		// Upstream success, clearing 7.21:1 at its tightest ground.
		success: "#9AC275",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 5.55:1 on this fill.
		successWash: "#3F3B26",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.37:1 at its tightest ground.
		successBorder: "#6C804D",
		warning: "#E2B148",
		warningWash: "#483920",
		warningBorder: "#977632",
		danger: "#F58384",

		// The TUI's own danger tint.
		dangerWash: "#3B2419",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.31:1 at its tightest.
		dangerBorder: "#BD6865",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#84BAD8",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#2C3843",
		infoBorder: "#5F7C89",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(29 22 12 / 0.7)",
		scrim: "rgb(29 22 12 / 0.6)",
	},
};
