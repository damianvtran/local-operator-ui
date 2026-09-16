import type { ThemeDefinition } from "../palette-contract";

/**
 * Rosewood.
 *
 * Carried from the TUI's own nature family: dark rosewood grounds, a
 * dried-rose accent and a brass-amber warning. It is the family's warm-red
 * member, and the one theme here whose accent and danger are neighbours in
 * hue; they are separated by lightness and chroma rather than by hue, which is
 * how the TUI solved that pair.
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
export const rosewood: ThemeDefinition = {
	id: "rosewood",
	name: "Rosewood",
	description: "Dark rosewood with dried-rose reds and a glint of brass.",
	palette: {
		mode: "dark",
		canvas: "#201314",
		surface: "#2A1C1D",
		elevated: "#332425",
		sunken: "#170C0D",

		ink: "#EEE0DC",
		inkMuted: "#C2ABA6",

		// The TUI's dim, lifted 7.0 L* to clear 4.5:1 on all four grounds — 4.78:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		inkDim: "#A38E8A",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#584745",

		hairline: "#453130",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.20:1 on `elevated`, the ground that caps it.
		borderControl: "#886F6C",

		accent: "#E895B5",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#F7A3C3",
		accentActive: "#D988A8",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.30 from `accent` and 11.13:1 on surface, where the
		// accent itself is 7.33:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFC4E4",

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#2B2318",

		// The theme's own deepest ground, at 7.34:1 on all three accent fills.
		onAccent: "#170C0D",

		// Upstream success, clearing 7.68:1 at its tightest ground.
		success: "#94BD80",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 6.00:1 on this fill.
		successWash: "#38312A",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.46:1 at its tightest ground.
		successBorder: "#667955",
		warning: "#D8AB58",
		warningWash: "#412F25",
		warningBorder: "#8E6E3D",
		danger: "#EA8378",

		// The TUI's own danger tint.
		dangerWash: "#371C1C",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.35:1 at its tightest.
		dangerBorder: "#AF635B",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#82B1D4",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#263140",
		infoBorder: "#5C7389",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(23 12 13 / 0.7)",
		scrim: "rgb(23 12 13 / 0.6)",
	},
};
