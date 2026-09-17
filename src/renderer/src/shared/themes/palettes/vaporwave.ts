import type { ThemeDefinition } from "../palette-contract";

/**
 * Vaporwave.
 *
 * Mall at closing time. The ground family is synthwave's purple, but every
 * state hue is pulled toward chalk — dusty pink accent, washed teal, sherbet
 * amber, soft coral — so the theme reads soft-focus exactly where synthwave
 * reads laser-sharp. It is the only member of this family with no fully
 * saturated colour anywhere, and that restraint is the aesthetic rather than a
 * compromise: the pastels start bright enough that no contrast floor forced
 * any of them down.
 *
 * Carried from the TUI's `vaporwave` ThemeSpec: all four grounds, `fg`, `muted`,
 * `accent`, `success`, `warning`, `danger`, `dim`, `edge`, `edge-hi`; the
 * informational hue is the TUI's `signal`, moved by 18 degrees, below.
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
export const vaporwave: ThemeDefinition = {
	id: "vaporwave",
	name: "Vaporwave",
	description: "Dusty pink and faded teal pastels on deep mall-purple.",
	palette: {
		mode: "dark",

		canvas: "#1F1730",
		surface: "#271E3B",
		elevated: "#2F2547",
		sunken: "#181128",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.17 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 3.25 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.26 from `surface`, 3.76 from `elevated` and 8.12 from `sunken`;
		 * the step is 3.35 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.66:1 the ink that binds it.
		 */
		highlight: "#362241",

		ink: "#EDE8F2",
		inkMuted: "#C0B2D4",
		// The TUI `dim` 9184AE lifted in L* with hue held: 4.14 on `elevated`, under
		// the floor.
		inkDim: "#9A8CB7",
		// The TUI `faint` 5A4E74 lifted to 2.3:1 on `elevated`.
		inkDisabled: "#685B82",

		// The TUI `edge` 3C3158, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds.
		hairline: "#3C3158",
		// The TUI `edge-hi` 4C3F6C lifted in L* until it clears 3:1 on `elevated`.
		borderControl: "#7E6F9F",

		accent: "#F7A8D8",
		accentHover: "#FFC1F2",
		accentActive: "#D488B7",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.6 from
		// `accent` and 10.96:1 on `surface`, where the accent measures 8.65:1.
		chartBarHover: "#F1CDE7",
		accentWash: "#3B2A46",
		onAccent: "#150824",

		success: "#8FE6C0",
		successWash: "#2E3243",
		successBorder: "#5A7E7A",

		warning: "#F0CD8A",
		warningWash: "#3A2F3C",
		warningBorder: "#877361",

		danger: "#F2808A",
		dangerWash: "#3A253C",
		dangerBorder: "#A16678",

		// The TUI `signal` 7FD8D4 rotated 18 degrees toward blue: the pastel mint
		// success and this teal sat ΔE00 11.7 apart, under the contract's 15 semantic
		// separation floor, and one of the two had to move. A slightly bluer aqua
		// keeps the template sunset's faded-teal identity and cannot be confused with
		// a mint.
		info: "#7BD7E3",
		infoWash: "#2B3047",
		infoBorder: "#577C90",

		overlayShadow: "0 12px 32px -12px rgb(12 9 19 / 0.75)",
		scrim: "rgb(12 9 19 / 0.65)",
	},
};
