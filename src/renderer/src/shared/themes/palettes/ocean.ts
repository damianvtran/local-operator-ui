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
 */
export const ocean: ThemeDefinition = {
	id: "ocean",
	name: "Ocean",
	description: "Deep-sea blue-green under a pale sea-foam accent.",
	palette: {
		mode: "dark",
		canvas: "#0C1A20",
		surface: "#132630",
		elevated: "#1B2E39",
		sunken: "#081218",

		/*
		 * The current row's own ground:
		 * a cast of `surface`'s chroma plane toward `accent` at alpha
		 * 0.055, L* held — branch H, taken because no step on this
		 * palette's lightness ladder clears `elevated` inside the band.
		 * ΔE00 2.30 from `surface`, 3.57 from `elevated` and 7.88 from
		 * `sunken`.
		 */
		highlight: "#10272F",

		ink: "#DCEBEE",
		inkMuted: "#A4BEC5",

		// The TUI's dim, lifted 4.1 L* to clear 4.5:1 on all four grounds — 4.77:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		inkDim: "#7B9CA5",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#3E565F",

		hairline: "#254049",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.21:1 on `elevated`, the ground that caps it.
		borderControl: "#5C7E89",

		accent: "#84E0CF",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#92EEDD",
		accentActive: "#76D2C1",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.29 from `accent` and 14.13:1 on surface, where the
		// accent itself is 10.05:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#C2FFFF",

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#12302C",

		// The theme's own deepest ground, at 10.59:1 on all three accent fills.
		onAccent: "#081218",

		// Upstream success, clearing 7.77:1 at its tightest ground.
		success: "#6CC99B",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 5.97:1 on this fill.
		successWash: "#1F3B3E",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.50:1 at its tightest ground.
		successBorder: "#46836A",
		warning: "#D9B45C",
		warningWash: "#2D3836",
		warningBorder: "#877644",
		danger: "#EF8B85",

		// The TUI's own danger tint.
		dangerWash: "#26212A",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.31:1 at its tightest.
		dangerBorder: "#AB6967",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#72B6E4",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#1A2C42",
		infoBorder: "#4A7998",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(8 18 24 / 0.7)",
		scrim: "rgb(8 18 24 / 0.6)",
	},
};
