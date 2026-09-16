import type { ThemeDefinition } from "../palette-contract";

/**
 * Forest.
 *
 * Carried from the TUI's own nature family: the pine-shadow ground ramp, the
 * moss accent and the stream blue exactly as that file solved them. Three
 * greens are in play, and they are held apart by temperature rather than by
 * hue distance alone — the accent is a yellow-moss, success a cooler leaf, the
 * string token sits between — so the scheme still reads as pine rather than as
 * "green".
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
export const forest: ThemeDefinition = {
	id: "forest",
	name: "Forest",
	description: "Deep pine shadow lit by moss-green light through the canopy.",
	palette: {
		mode: "dark",
		canvas: "#0F1A13",
		surface: "#17231B",
		elevated: "#1F2C23",
		sunken: "#0A120D",

		/*
		 * The current row's own ground:
		 * a cast of `surface`'s chroma plane toward `accent` at alpha
		 * 0.075, L* held — branch H, taken because no step on this
		 * palette's lightness ladder clears `elevated` inside the band.
		 * ΔE00 2.84 from `surface`, 3.53 from `elevated` and 8.52 from
		 * `sunken`.
		 * This is one of the three casts that overshoot the band's 2.5 top:
		 * a hex step at this strength is wider than the band, and the step
		 * below it measures under the rule's own 2.17 floor.
		 */
		highlight: "#162417",

		ink: "#DDE8DD",
		inkMuted: "#A8BBA9",

		// The TUI's dim, lifted 4.6 L* to clear 4.5:1 on all four grounds — 4.77:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		inkDim: "#849987",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#465547",

		hairline: "#2C3D31",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.18:1 on `elevated`, the ground that caps it.
		borderControl: "#657B6A",

		accent: "#8FBF68",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#9DCD75",
		accentActive: "#82B15B",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.24 from `accent` and 12.12:1 on surface, where the
		// accent itself is 7.60:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#BCED93",

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#1A2A1A",

		// The theme's own deepest ground, at 7.59:1 on all three accent fills.
		onAccent: "#0A120D",

		// Upstream success, clearing 7.82:1 at its tightest ground.
		success: "#7CC487",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 6.04:1 on this fill.
		successWash: "#243829",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.54:1 at its tightest ground.
		successBorder: "#508059",
		warning: "#D8AE52",
		warningWash: "#303522",
		warningBorder: "#887339",
		danger: "#E58579",

		// The TUI's own danger tint.
		dangerWash: "#28211C",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.31:1 at its tightest.
		dangerBorder: "#A9675C",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#6FB3C9",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#1C2E38",
		infoBorder: "#4A7782",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(10 18 13 / 0.7)",
		scrim: "rgb(10 18 13 / 0.6)",
	},
};
