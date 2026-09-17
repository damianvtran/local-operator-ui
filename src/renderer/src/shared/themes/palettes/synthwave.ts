import type { ThemeDefinition } from "../palette-contract";

/**
 * Synthwave '84.
 *
 * Synthwave '84, and this family's reference point for restraint inside neon:
 * every canonical hue of the published scheme clears the floors on the
 * canonical ground, so the theme is fidelity rather than invention. What makes
 * it itself is the purple-violet ramp — Outrun's grounds are midnight blue,
 * Vaporwave's a lighter mall-purple, Matrix's green-black — and a LIGHT neon
 * pink accent, ΔE00 17 from the shipped Synth theme's FF4081 and 61 from
 * Neon's cyan, so the three pink-and-cyan themes in this app do not read as
 * one screen with one different accent.
 *
 * Carried from the TUI's `synthwave` ThemeSpec: all four grounds, `fg`, `muted`,
 * `accent`, `success`, `warning`, `signal`, `edge`, `edge-hi` and the comment
 * violet (`dim`) verbatim.
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
export const synthwave: ThemeDefinition = {
	id: "synthwave",
	name: "Synthwave '84",
	description: "Hot pink and cyan on a deep purple-navy night drive.",
	palette: {
		mode: "dark",

		canvas: "#262335",
		surface: "#2D2A41",
		elevated: "#35314C",
		sunken: "#1E1B2A",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.06 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 3 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.52 from `surface`, 3.2 from `elevated` and 9.39 from `sunken`;
		 * the step is 3.04 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.69:1 the ink that binds it.
		 */
		highlight: "#3A2E4A",

		ink: "#F2EFF8",
		inkMuted: "#BCB3D4",
		// The TUI `dim` 848BBD lifted in L* with hue held: it measured 4.22 on
		// `surface` and 3.78 on `elevated`, and this app draws tertiary text on both.
		inkDim: "#949BCD",
		// The TUI `faint` 575071 lifted to 2.3:1 on `elevated`.
		inkDisabled: "#6D6688",

		// The TUI `edge` 443F5E, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds.
		hairline: "#443F5E",
		// The TUI `edge-hi` 544E72 lifted in L* until it clears 3:1 on `elevated`, the
		// lightest ground it is drawn against.
		borderControl: "#837CA2",

		accent: "#FF7EDB",
		accentHover: "#FF97F5",
		accentActive: "#DB5DBA",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.7 from
		// `accent` and 8.17:1 on `surface`, where the accent measures 6.10:1.
		chartBarHover: "#F9B0E8",
		accentWash: "#422F4B",
		// The canvas at 42% of its L*: this accent is far too light for a light label
		// to clear 4.5:1 on it.
		onAccent: "#151123",

		// 72F1B8, published — the same value the TUI uses for `string`.
		success: "#72F1B8",
		successWash: "#303E46",
		successBorder: "#538B7A",

		// FEDE5D, published.
		warning: "#FEDE5D",
		warningWash: "#423B3A",
		warningBorder: "#90804F",

		// The published red FE4450 measures 3.63:1 as text on `elevated`, the dialog
		// ground a required-mark or a destructive label is drawn on, so it is lifted
		// in L* with hue and chroma held to 4.61:1 — ΔE00 7.7 from the published red.
		// Darkening `elevated` instead cannot work: the floor needs a ground darker
		// than `canvas` itself, which would collapse the four-step ramp.
		danger: "#FF7072",
		dangerWash: "#422D3D",
		dangerBorder: "#B36D76",

		// 36F9F6, the TUI's `signal` — the published scheme's cyan, and the only other
		// bright hue it names that is not the accent.
		info: "#36F9F6",
		infoWash: "#283F4E",
		infoBorder: "#378C95",

		overlayShadow: "0 12px 32px -12px rgb(15 14 21 / 0.75)",
		scrim: "rgb(15 14 21 / 0.65)",
	},
};
