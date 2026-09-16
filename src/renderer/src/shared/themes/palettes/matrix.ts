import type { ThemeDefinition } from "../palette-contract";

/**
 * Matrix.
 *
 * Digital rain, and the family's only fully in-hue ground: a near-black with a
 * green cast, because the cast IS the CRT — a neutral black would leave this
 * just another dark theme with a green accent. Raw phosphor #00FF00 is
 * deliberately absent; the accent is a tamed 22E06A and the body ink a
 * desaturated green-white, so hours of prose do not fatigue the way a screen
 * of #00ff00 does. Its off-hue states (amber, coral, teal, violet) are
 * desaturation-matched to read as glitches in the rain rather than visitors
 * from another theme.
 *
 * Carried from the TUI's `matrix` ThemeSpec: all four grounds, `fg`, `muted`,
 * `dim`, `accent`, `success`, `warning`, `danger`, `signal`, `edge` and `edge-hi`
 * verbatim — the near-black ramp is dark enough that the TUI's own tertiary ink
 * already clears the floors.
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
export const matrix: ThemeDefinition = {
	id: "matrix",
	name: "Matrix",
	description: "Phosphor green rain on a near-black terminal screen.",
	palette: {
		mode: "dark",

		canvas: "#050D07",
		surface: "#0B160E",
		elevated: "#122016",
		sunken: "#020703",

		ink: "#D4E6D6",
		inkMuted: "#99BD9F",
		// The TUI `dim` verbatim: 639C70 clears 4.5:1 on all four grounds, which only
		// this ramp makes possible — it is the family's darkest set of grounds.
		inkDim: "#639C70",
		// The TUI `faint` 2F5238 lifted to 2.3:1 on `elevated`.
		inkDisabled: "#3A5E43",

		// The TUI `edge` 1D3524, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds.
		hairline: "#1D3524",
		// The TUI `edge-hi` 2A4A33 lifted in L* until it clears 3:1 on `elevated`; the
		// TUI bounded nothing with it.
		borderControl: "#517359",

		// 22E06A, the TUI's tamed phosphor — never #00FF00.
		accent: "#22E06A",
		accentHover: "#4DFA82",
		accentActive: "#00BE4B",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.5 from
		// `accent` and 11.96:1 on `surface`, where the accent measures 10.51:1.
		chartBarHover: "#87E3A8",
		accentWash: "#092814",
		onAccent: "#000701",

		// 3ECF74, the TUI's own green — deliberately a second green rather than a copy
		// of the accent, which the semantic separation floor forces apart.
		success: "#3ECF74",
		successWash: "#0C2615",
		successBorder: "#34784A",

		warning: "#D8C24A",
		warningWash: "#202510",
		warningBorder: "#736C32",

		danger: "#FF6B5E",
		dangerWash: "#261912",
		dangerBorder: "#9C584E",

		// 3FD0C9, the TUI's `signal`, desaturated to sit in the rain rather than
		// beside it.
		info: "#3FD0C9",
		infoWash: "#0D2620",
		infoBorder: "#32766E",

		overlayShadow: "0 12px 32px -12px rgb(2 5 3 / 0.75)",
		scrim: "rgb(2 5 3 / 0.65)",
	},
};
