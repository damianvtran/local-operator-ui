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
		 * The current row's own ground: `surface` stepped 2.99 `L*` up at the panel's own
		 * hue (0.4 degrees off, inside the 12-degree bound) and carried
		 * 13.76 `C*` against the panel's 11.07 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 2.65, from
		 * `elevated` 0.75, from `sunken` 8.32. Ink on this ground: `ink` 14.22:1,
		 * `ink-muted` 7.81:1, `ink-dim` 4.67:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `1.11x` the panel's
		 * chroma (12.32 `C*` against 11.07), 2 degrees off its hue, ΔE00 2.05 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * THIS PALETTE IS THE EXCEPTION, AND THE FLOOR IS WHY. Its own `ink-dim` caps
		 * the step at 3.10 `L*`, and with the band's whole ceiling spent that reaches only
		 * ΔE00 2.32 — under the 2.5 floor every palette must hold, which is the
		 * operator's EARLIER report ("way too subtle... make it brighter/more contrasted")
		 * returning on a theme he has not looked at yet. The band is the default, not the
		 * ceiling on the floor: this value adds 1.03 `C*` past the band's ceiling — 2.69 over
		 * the panel, at the panel's own hue, with the step unchanged at 2.99 `L*` — and that is
		 * what reaches ΔE00 2.65. It is the SMALLEST chroma that does, pinned by name in
		 * `HIGHLIGHT_OVER_BAND_PINS` and re-derived by `pnpm check-themes`, so the exception
		 * cannot drift into a licence to be loud.
		 *
		 * THE HOVER STEP IS THE COLLISION: 0.75 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_ADJACENT_PINS` and is
		 * on the adjacent-role work list.
		 */
		highlight: "#1C1628",

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
