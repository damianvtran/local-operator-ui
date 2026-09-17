import type { ThemeDefinition } from "../palette-contract";

/**
 * Arcade.
 *
 * A CRT cabinet. The ground is near-neutral black glass — the one ground here
 * with no real cast, because an arcade monitor that is off is glass-grey — and
 * the states are candy primaries, one per meaning: marquee yellow as the
 * accent, 1-up green, bonus-round orange, hit-flash red, ice-level blue,
 * power-up violet. Each state is its own primary so nothing collapses into
 * anything else, and the ink is a warm bone white like a lit dot-matrix score.
 * Where Night City's yellow accent buys a dark violet ground, this one buys a
 * neutral one.
 *
 * Carried from the TUI's `arcade` ThemeSpec: `bg`, `surface`, `raised`, `fg`,
 * `muted`, `dim`, `accent`, `success`, `warning`, `danger`, `signal`, `edge` and
 * `edge-hi`; only `sunken` moved, below.
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
export const arcade: ThemeDefinition = {
	id: "arcade",
	name: "Arcade",
	description: "Candy RGB game states glowing on black CRT glass.",
	palette: {
		mode: "dark",

		canvas: "#0A0A0C",
		surface: "#141417",
		elevated: "#1D1D21",
		// The TUI's 050506 darkened one step to clear the four-ground separation
		// floor: against `canvas` it measured 1.030:1, sitting exactly on the
		// contract's 1.03.
		sunken: "#010102",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.03 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 3.25 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.14 from `surface`, 4.44 from `elevated` and 6 from `sunken`;
		 * the step is 3.38 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.71:1 the ink that binds it.
		 */
		highlight: "#1C1B19",

		ink: "#E8E8E4",
		inkMuted: "#B0B0AC",
		// The TUI `dim` 7C7C7A lifted in L* with hue held: 4.40 on `surface` and 4.02
		// on `elevated`, both under the floor.
		inkDim: "#868683",
		// The TUI `faint` 44444A lifted to 2.3:1 on `elevated`.
		inkDisabled: "#56565C",

		// The TUI `edge` 2A2A30, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds.
		hairline: "#2A2A30",
		// The TUI `edge-hi` 3A3A42 lifted in L* until it clears 3:1 on `elevated`.
		borderControl: "#6B6B73",

		// FFD23F, the marquee yellow — this palette's "insert coin" colour.
		accent: "#FFD23F",
		accentHover: "#FFEB59",
		accentActive: "#DAB113",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.6 from
		// `accent` and 13.64:1 on `surface`, where the accent measures 12.73:1.
		chartBarHover: "#F3DD94",
		accentWash: "#2A2413",
		onAccent: "#040406",

		// 45E055, the 1-up green.
		success: "#45E055",
		successWash: "#122615",
		successBorder: "#35793A",

		// FF9430, the bonus-round orange: distinct from the yellow accent by hue, and
		// from the red danger by the 15 ΔE00 separation floor.
		warning: "#FF9430",
		warningWash: "#2A1C11",
		warningBorder: "#936032",

		// FF5252, the hit flash.
		danger: "#FF5252",
		dangerWash: "#2A1315",
		dangerBorder: "#A65250",

		// 52B4FF, the ice-level blue and the TUI's `signal`.
		info: "#52B4FF",
		infoWash: "#13202C",
		infoBorder: "#456F93",

		overlayShadow: "0 12px 32px -12px rgb(4 4 5 / 0.75)",
		scrim: "rgb(4 4 5 / 0.65)",
	},
};
