import type { ThemeDefinition } from "../palette-contract";

/**
 * Outrun.
 *
 * Sunset-grid racing: the midnight-blue ground, the grid cyan, the sun yellow
 * and the sunset orange of the canonical quad, on the family's bluest ramp.
 * Its danger is ORANGE rather than red — the canvas has no red at all, which
 * is what keeps it apart from every sibling — and its warning is a true sun
 * yellow, so the two warm states read as a sunset rather than as a warning and
 * an error.
 *
 * Carried from the TUI's `outrun` ThemeSpec: all four grounds, `fg`, `muted`,
 * `success`, `warning`, `danger`, `signal`, `edge`, `edge-hi` and `dim` (lifted,
 * below) verbatim.
 *
 * Derived, by one rule each, the same across this family: `accentHover`
 * +9 L* and `accentActive` -12 L* on the accent (the pressed step floored
 * where `onAccent` still clears 4.5:1 on it, and where the fill still has a
 * 3:1 edge on `elevated`); `chartBarHover` mixed toward `ink` until it is ΔE00
 * 10.5 from `accent`, then lifted further if that landed closer to `surface`
 * than the accent does; `accentWash` the accent at 13% over `canvas`;
 * `onAccent` the canvas at 42% of its L*, hue held; every semantic wash its hue
 * at 13% over `canvas` and every semantic border its hue at 45%, lifted in L*
 * until it clears 3:1 on `elevated`, the lightest ground it is drawn on;
 * `inkDisabled` the TUI `faint` lifted to 2.3:1 on `elevated` (the one role
 * with no floor, kept a colour rather than a hole); `borderControl` the TUI
 * `edge-hi` lifted to 3:1 on `elevated`; the shadow and scrim `canvas` at 40%,
 * so they carry this palette's cast rather than neutral black.
 *
 * The TUI's `overlay`, `label`, `string` and five `tint-*` tokens have no role
 * here: this contract has no popover ground, no second label hue and no
 * selection tint, so the tints above are derived from the accent instead.
 */
export const outrun: ThemeDefinition = {
	id: "outrun",
	name: "Outrun",
	description: "Sunset magenta and grid cyan racing over midnight blue.",
	palette: {
		mode: "dark",

		canvas: "#0D1029",
		surface: "#141834",
		elevated: "#1B2040",
		sunken: "#080A1E",

		ink: "#E6E6F2",
		inkMuted: "#ADAFD0",
		// The TUI `dim` 7C7FA8 lifted in L* with hue held: 4.11 on `elevated`, under
		// the floor.
		inkDim: "#8588B1",
		// The TUI `faint` 454870 lifted to 2.3:1 on `elevated`.
		inkDisabled: "#555780",

		// The TUI `edge` 262C56, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds.
		hairline: "#262C56",
		// The TUI `edge-hi` 343B6E lifted in L* until it clears 3:1 on `elevated`.
		borderControl: "#676BA3",

		// The canonical magenta FF2975 deepened 9 degrees toward crimson with its
		// chroma raised 10%: the shipped Synth theme's accent FF4081 sits ΔE00 2.8
		// from the canonical pink, and a user choosing between two adjacent neon
		// themes has to be able to tell them apart. The result is ΔE00 4.2 from the
		// published magenta and 6.4 from Synth's. The other three canonical colours —
		// grid cyan 2DE2E6, sun yellow F9C80E, sunset orange FF6C11 — are the
		// published values.
		accent: "#FF1D62",
		accentHover: "#FF4578",
		// Stepped down only 9 L*: this accent is the family's darkest, so the pressed
		// fill is bounded below by the 4.5:1 its near-black label needs.
		accentActive: "#EF0056",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.6 from
		// `accent` and 6.27:1 on `surface`, where the accent measures 4.82:1.
		chartBarHover: "#F76192",
		accentWash: "#2C1230",
		onAccent: "#050522",

		success: "#3FE0A0",
		successWash: "#142B38",
		successBorder: "#327B6B",

		// F9C80E, the sun yellow, and no red in the palette for it to be confused
		// with.
		warning: "#F9C80E",
		warningWash: "#2C2825",
		warningBorder: "#836D28",

		// FF6C11, the sunset orange: the only danger in this family that is not a red.
		// It clears the 15 ΔE00 separation from the sun yellow by hue, not lightness.
		danger: "#FF6C11",
		dangerWash: "#2C1C26",
		dangerBorder: "#A45C3F",

		// 2DE2E6, the TUI's `signal` — the grid the whole theme is racing on.
		info: "#2DE2E6",
		infoWash: "#112B42",
		infoBorder: "#2A7989",

		overlayShadow: "0 12px 32px -12px rgb(5 6 16 / 0.75)",
		scrim: "rgb(5 6 16 / 0.65)",
	},
};
