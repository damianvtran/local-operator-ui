import type { ThemeDefinition } from "../palette-contract";

/**
 * Paper.
 *
 * Carried from the TUI's own light family: warm cream papers and brown ink, an
 * open book in good light. The TUI's light ramp runs the opposite way to this
 * app's — upstream the page is the brightest value and the panels step down it
 * — so the four grounds are re-seated on the app's own grammar, which lifts
 * toward white: the TUI's surface becomes the page, its page becomes the card,
 * and its deeper sheets become the well. The hue and the temperature are
 * upstream's; only the polarity is the app's.
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
export const paper: ThemeDefinition = {
	id: "paper",
	name: "Paper",
	description: "Warm cream paper with brown ink, an open book in good light.",
	palette: {
		mode: "light",
		canvas: "#E8E0CD",
		surface: "#EFE8D9",
		elevated: "#F9F3E6",
		sunken: "#DFD7C1",

		/*
		 * The current row's own ground:
		 * `surface` stepped 6.25 on the `L*` axis in the mode's direction — the
		 * neutral step, branch L of this port's selection rule; the ramp affords it here,
		 * so the row takes no cast. ΔE00 4.03 from `surface`, 6.34 from
		 * `elevated` and 3.06 from `sunken`; the step is -6.34 `L*`, and the band
		 * this branch raised to ΔE00 4.0 is met without a cast.
		 */
		highlight: "#DDD6C8",

		ink: "#332B20",

		// The TUI's muted, lifted 9.8 L*: 7.11:1 on `sunken`, the ground that caps
		// secondary text here.
		inkMuted: "#484034",

		// The TUI's dim, lifted 11.7 L* to clear 4.5:1 on all four grounds — 4.80:1 on
		// `sunken`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		inkDim: "#62594A",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#B2A78F",

		// The TUI's decorative edge, moved ΔE00 5.04 into this contract's two-sided
		// window: a rule has to be SEEN (ΔE00 4+ on every ground) without becoming a
		// border (2:1 at most). Here it is 1.21:1 at its quietest.
		hairline: "#CDC4AE",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.19:1 on `sunken`, the ground that caps it.
		borderControl: "#7F7559",

		accent: "#884928",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#7A3D1D",
		accentActive: "#6C3212",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.40 from `accent` and 9.61:1 on surface, where the
		// accent itself is 5.68:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#602707",

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#ECE9CA",

		// The theme's own paper at the top of the ramp, at 6.27:1 on all three accent
		// fills.
		onAccent: "#F9F3E6",

		// Upstream success, re-seated 9.1 L* to hold 4.98:1 on the deepest ground;
		// upstream warning, danger and info re-seat the same way, only as far as their
		// own floors require, so the order of loudness is unchanged.
		success: "#336318",

		// The TUI has no success or warning tint, so both are the state hue at 8% over
		// the ground — the fraction the TUI's own tints measure at. The hue clears
		// 5.23:1 on this fill.
		successWash: "#E0DDCA",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.34:1 at its tightest ground.
		successBorder: "#608245",
		warning: "#775000",
		warningWash: "#E5DCC8",
		warningBorder: "#947535",
		danger: "#A02F22",

		// The TUI's own danger tint.
		dangerWash: "#F3DDCD",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.30:1 at its tightest.
		dangerBorder: "#B56254",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#125C8C",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#E7EBE2",
		infoBorder: "#4A7E9D",

		// The one shadow in the system, tinted with the theme's own ink.
		overlayShadow: "0 12px 32px -12px rgb(51 43 32 / 0.22)",
		scrim: "rgb(51 43 32 / 0.35)",
	},
};
