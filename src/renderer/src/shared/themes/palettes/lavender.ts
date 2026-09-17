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
 */
export const lavender: ThemeDefinition = {
	id: "lavender",
	name: "Lavender",
	description: "Purple-grey dusk lit by a soft lavender glow.",
	palette: {
		mode: "dark",
		canvas: "#191623",
		surface: "#211E2E",
		elevated: "#2A2638",
		sunken: "#110F19",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.13 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 4.5 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.11 from `surface`, 2.08 from `elevated` and 10.24 from `sunken`;
		 * the step is 4.46 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.73:1 the ink that binds it.
		 */
		highlight: "#2C263C",

		ink: "#E6E2F0",
		inkMuted: "#B3ADC6",

		// The TUI's dim, lifted 7.5 L* to clear 4.5:1 on all four grounds — 4.79:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		inkDim: "#978FAE",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#4C4762",

		// The TUI's decorative edge, moved ΔE00 0.32 into this contract's two-sided
		// window: a rule has to be SEEN (ΔE00 4+ on every ground) without becoming a
		// border (2:1 at most). Here it is 1.20:1 at its quietest.
		hairline: "#373151",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.21:1 on `elevated`, the ground that caps it.
		borderControl: "#79709A",

		accent: "#B9A3E8",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#C7B0F6",
		accentActive: "#AB96DA",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.46 from `accent` and 11.22:1 on surface, where the
		// accent itself is 7.34:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#E4CDFF",

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#1F2333",

		// The theme's own deepest ground, at 7.33:1 on all three accent fills.
		onAccent: "#110F19",

		// Upstream success, clearing 8.26:1 at its tightest ground.
		success: "#7FC98F",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 6.40:1 on this fill.
		successWash: "#2D343B",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.66:1 at its tightest ground.
		successBorder: "#568164",
		warning: "#DCAE54",
		warningWash: "#393133",
		warningBorder: "#8E7140",
		danger: "#EF8595",

		// The TUI's own danger tint.
		dangerWash: "#2B1A26",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.35:1 at its tightest.
		dangerBorder: "#AD6372",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#7DB2E2",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#1C2740",
		infoBorder: "#557496",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(17 15 25 / 0.7)",
		scrim: "rgb(17 15 25 / 0.6)",
	},
};
