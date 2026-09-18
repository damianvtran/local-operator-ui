import type { ThemeDefinition } from "../palette-contract";

/**
 * Nord — Arctic Ice Studio's scheme, built from four fixed ramps: Polar Night for grounds,
 * Snow Storm for ink, Frost for state and Aurora for meaning.
 *
 * Polar Night supplies the ladder: nord0 2E3440 is the page, nord1 3B4252 the raised ground
 * and nord2-flavoured 343B49 the step between them; the well below is a step under nord0,
 * because nord2 434C5E is lighter than nord1 and belongs above this ladder, not below it. The
 * ink weights are Snow Storm — nord6 ECEFF4 as the body, nord4 D8DEE9 as the control rung and
 * the scheme's dim tier as the readout, and nord3's shade 616E88 as the inactive tone.
 *
 * Frost nord8 88C0D0 is the accent, unmodified. The Aurora row is the semantics — nord14 green,
 * nord13 yellow, nord11 red, nord9 blue — with the red lifted a step, because nord11 BF616A is
 * 3.74:1 on `elevated` and a callout's own text has to clear 4.5.
 *
 * One value is deliberately not a Frost hex. The readout ink sheds a quarter of its chroma so
 * that it and the lifted nord9 blue beside it — the palette's `info`, and a syntax token in the
 * editor — take different names; at full chroma the pair measures ΔE00 6.9, under this
 * contract's 8 floor for a token next to a comment. Nord's own neutrals are all blue-greys, so
 * this is the same move one step further.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the ground tinted.
 */
export const nord: ThemeDefinition = {
	id: "nord",
	name: "Nord",
	description: "Arctic blue-grey with a frost cyan accent.",
	palette: {
		mode: "dark",

		canvas: "#2E3440",
		// A step between nord0 and nord1: nord2 434C5E sits above nord1 and a fifth ground
		// would only cost every ink headroom.
		surface: "#343B49",
		elevated: "#3B4252",
		// A step under nord0. Nord has no recessed tone of its own — nord2 is lighter than
		// nord1 — so the well is derived, and nord3 4C566A is far too light to be a well.
		sunken: "#272C36",

		/*
		 * The current row's own ground: `surface` stepped 2.58 `L*` up at the panel's own
		 * hue (1.7 degrees off, inside the 12-degree bound) and carried
		 * 10.86 `C*` against the panel's 9.57 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 2.14, from
		 * `elevated` 1.09, from `sunken` 7.21. Ink on this ground: `ink` 8.92:1,
		 * `ink-muted` 7.61:1, `ink-dim` 4.66:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `1.13x` the panel's
		 * chroma (10.80 `C*` against 9.57), 18 degrees off its hue, ΔE00 4.35 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * AND IT IS BELOW THE FLOOR: ΔE00 2.14 is under the 2.5 every palette must hold.
		 * Hue-faithfully there is no value that reaches it — the row cannot rise further
		 * without putting this palette's own body ink under its floor, and buying it back
		 * on chroma or hue is the defect this round removes. It is on the NAMED LIST in
		 * `HIGHLIGHT_CAP_PINS` (`subFloor`), with its numbers, and the structural fix is the
		 * row-hover split rather than a louder mark here.
		 *
		 * THE HOVER STEP IS THE COLLISION: 1.09 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_HOVER_PINS` and is
		 * on the row-hover work list.
		 */
		highlight: "#384151",

		ink: "#ECEFF4",
		inkMuted: "#D8DEE9",
		// The scheme's dim tier, lifted to the 4.5:1 corner on the binding ground and then
		// stripped of a quarter of its chroma so it separates (ΔE00 8.2) from the Frost blue
		// it sits beside in the editor, where the same hue at full chroma measured 6.9.
		inkDim: "#A7AFBE",
		inkDisabled: "#616E88",

		// Nord has no rule colour. This holds ΔE00 4.1 from every ground and 1.21-1.68:1
		// against them: a 1px line, not a border.
		hairline: "#474E5F",
		// Nord3 4C566A is 1.36:1 against the grounds — an inactive-tone value in a
		// structural role. Lifted along the same blue-grey to 3.1:1 on the lightest
		// ground.
		borderControl: "#848FA4",

		accent: "#88C0D0",
		accentHover: "#A4DCED",
		accentActive: "#73AABA",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.3
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#B1EBFB",
		accentWash: "#2E3D40",
		onAccent: "#272C36",

		success: "#A3BE8C",
		successWash: "#3E484C",
		successBorder: "#7C9665",

		warning: "#EBCB8B",
		warningWash: "#595754",
		warningBorder: "#A88A4B",

		// Aurora nord11 BF616A is 2.46:1 on `elevated` — the widest miss here. Lifted along
		// the same red, which is what the aurora red is for.
		danger: "#F3959F",
		dangerWash: "#3D323C",
		dangerBorder: "#CE747E",

		// Frost nord9 81A1C1 is 3.74:1 on the binding ground; lifted along the same blue to
		// clear 4.5 on all four.
		info: "#88A9C9",
		infoWash: "#2B3B4E",
		infoBorder: "#7191B1",

		// The shadow and scrim are the ground tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
