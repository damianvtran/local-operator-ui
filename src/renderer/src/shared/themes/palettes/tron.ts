import type { ThemeDefinition } from "../palette-contract";

/**
 * Tron.
 *
 * The Grid. The one theme here whose accent is a bright electric cyan and
 * whose DANGER is orange — the franchise's own error colour, the Rinzler suit
 * — with the warning shifted to gold so the two warm states cannot collapse.
 * That orange is what keeps it apart from the shipped Neon theme, which is
 * also cyan on a blue-black: Neon's danger is pink and its ink ramp is near-
 * neutral, while this canvas is colder and deeper and the accent is ΔE00 8.9
 * from Neon's. Success is a sea-glass teal-green cool enough to belong on the
 * Grid.
 *
 * Carried from the TUI's `tron` ThemeSpec: `bg`, `surface`, `raised`, `fg`,
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
export const tron: ThemeDefinition = {
	id: "tron",
	name: "Tron",
	description: "Electric cyan circuitry on the Grid's blue-black.",
	palette: {
		mode: "dark",

		canvas: "#060B12",
		surface: "#0C1420",
		elevated: "#131E2D",
		// The TUI's 03060B darkened one step to clear the four-ground separation
		// floor: against `canvas` it measured 1.029:1, under the contract's 1.03. The
		// cast is unchanged, so the Grid still reads blue-black.
		sunken: "#000207",

		ink: "#D8E6F2",
		inkMuted: "#9FB8CC",
		// The TUI `dim` 6A89A3 lifted by ΔE00 0.4 only — it missed 4.5:1 on `elevated`
		// by four hundredths.
		inkDim: "#6A8AA4",
		// The TUI `faint` 33485C lifted to 2.3:1 on `elevated`.
		inkDisabled: "#44596D",

		// The TUI `edge` 1E3245, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds.
		hairline: "#1E3245",
		// The TUI `edge-hi` 2A4660 lifted in L* until it clears 3:1 on `elevated`.
		borderControl: "#536E8A",

		accent: "#00D8FF",
		accentHover: "#48F2FF",
		accentActive: "#00B7DD",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.6 from
		// `accent` and 13.17:1 on `surface`, where the accent measures 10.79:1.
		chartBarHover: "#A8E3F5",
		accentWash: "#052631",
		onAccent: "#00050D",

		success: "#3FE0B0",
		successWash: "#0D2727",
		successBorder: "#2E7765",

		// E8C14A, the TUI's gold: with an orange danger, a second warm state can only
		// be distinguished by hue, and gold clears the 15 ΔE00 semantic separation.
		warning: "#E8C14A",
		warningWash: "#232319",
		warningBorder: "#7A6A37",

		// FF7A2F — orange, not red. The Grid's own error colour, and the reason this
		// theme does not need a red at all.
		danger: "#FF7A2F",
		dangerWash: "#261916",
		dangerBorder: "#9A5C3C",

		// 7AB8FF, the TUI's `signal` — the Grid's day-cycle blue, distinct from the
		// cyan accent by hue rather than by lightness.
		info: "#7AB8FF",
		infoWash: "#152131",
		infoBorder: "#506D93",

		overlayShadow: "0 12px 32px -12px rgb(2 4 7 / 0.75)",
		scrim: "rgb(2 4 7 / 0.65)",
	},
};
