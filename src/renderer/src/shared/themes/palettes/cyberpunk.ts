import type { ThemeDefinition } from "../palette-contract";

/**
 * Cyberpunk.
 *
 * Night City, and the only theme in this family whose accent is a YELLOW — the
 * 2077 marketing trio lands intact: construction yellow as the primary, glare
 * cyan as the signal, and the logo red as danger, on a violet-black ground no
 * sibling shares (Matrix's black is green, Outrun's is blue). Selection tints
 * are yellow-cast rather than the usual green or blue, because in this theme
 * yellow is the brand's "pay attention" colour.
 *
 * Carried from the TUI's `cyberpunk` ThemeSpec: all four grounds, `fg`, `muted`,
 * `accent`, `success`, `warning`, `signal`, `edge`, `edge-hi`; `danger` and `dim`
 * moved for the floors, below.
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
export const cyberpunk: ThemeDefinition = {
	id: "cyberpunk",
	name: "Cyberpunk",
	description:
		"Construction yellow and glare cyan over violet-black Night City.",
	palette: {
		mode: "dark",

		canvas: "#0E0A16",
		surface: "#16101F",
		elevated: "#1E172A",
		sunken: "#080510",
		/*
		 * The current row's own ground:
		 * `surface` cast toward `accent` and stepped 3.1 on the `L*` axis — branch H of this
		 * port's selection rule, and here the cast is MANDATORY rather than preferred: the
		 * ink floor caps this palette's lightness route at 3.1 `L*` (`inkDim` 4.65:1 there
		 * and under the bound at 3.5), and a 3.1 `L*` step at the panel's own hue is only
		 * ΔE00 1.94 — under the band. So the pair that binds is the ink cap plus the band,
		 * and NOT `elevated`: at the cap the row is already ΔE00 5.74 clear of it.
		 * The first cut of this value let the displacement run to the full ΔE00 10.35 the
		 * rule's fixed fraction produced, which made it 2.3x the loudest row in the tree
		 * against `gruvbox` 4.54; design round 3 (D1) measured the band as reachable at 40%
		 * of that displacement, and this is that point: ΔE00 4.14 from `surface`, 5.74 from
		 * `elevated`, 5.58 from `sunken`, with `inkDim` at 4.65:1 the ink that binds it —
		 * that is the contract's own ratio for this ground, and the raw value is 4.654, so
		 * the margin it keeps is nothing rather than 0.01: this is the palette whose step
		 * is at the ink cap by construction, not by slack.
		 */
		highlight: "#1E171F",

		ink: "#EAE5F2",
		inkMuted: "#B3A8C6",
		// The TUI `dim` 82749C lifted in L* with hue held: 4.37 on `surface` and 4.07
		// on `elevated`, both under the floor.
		inkDim: "#8B7DA5",
		// The TUI `faint` 4A4060 lifted to 2.3:1 on `elevated`.
		inkDisabled: "#5A4F70",

		// The TUI `edge` 2E2340, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds.
		hairline: "#2E2340",
		// The TUI `edge-hi` 3D2F54 lifted in L* until it clears 3:1 on `elevated`.
		borderControl: "#72628A",

		// FCEE0A, the construction yellow — this palette's accent, and the reason it
		// is unmistakable among its siblings.
		accent: "#FCEE0A",
		// The yellow stepped up until it clips in sRGB, which is what a yellow this
		// light does: the hovered button reads as the same yellow, brighter.
		accentHover: "#FFFF34",
		accentActive: "#D7CC00",
		// Mixed toward `ink` to ΔE00 10.6 from `accent` and then lifted in L*, because
		// a yellow at this lightness has no brighter step left: the hovered mark reads
		// as the bars' own hue washed toward white, and still sits further from
		// `surface` (15.86:1) than the accent does (15.40:1).
		chartBarHover: "#F8EF8F",
		accentWash: "#2D2814",
		onAccent: "#070312",

		success: "#3FE07A",
		successWash: "#142623",
		successBorder: "#31764E",

		warning: "#FF9E3D",
		warningWash: "#2D1D1B",
		warningBorder: "#8E5F39",

		// FF003C lifted in L* with hue held (ΔE00 1.8 from the TUI's value) to clear
		// 4.5:1 as text on `elevated`; on the canvas it is the 4.95:1 the TUI
		// measured.
		danger: "#FF2345",
		dangerWash: "#2D0D1C",
		dangerBorder: "#AE4753",

		// 00F0FF, the TUI's `signal` — the glare cyan the marketing artwork pairs with
		// the yellow.
		info: "#00F0FF",
		infoWash: "#0C2834",
		infoBorder: "#0C7481",

		overlayShadow: "0 12px 32px -12px rgb(6 4 9 / 0.75)",
		scrim: "rgb(6 4 9 / 0.65)",
	},
};
