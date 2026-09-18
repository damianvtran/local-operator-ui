import type { ThemeDefinition } from "../palette-contract";

/**
 * Rosé Pine — the original night.
 *
 * Carried from github.com/rose-pine/palette (`dist/css/rose-pine.css`): base
 * 191724, surface 1f1d2e, overlay 26233a as `elevated`, text e0def4,
 * highlight-med 403d52 as the structural edge, and the scheme's own accent row
 * mapped by upstream's usage table rather than by hue — rose takes `accent`,
 * love `danger`, gold `warning`, pine `success`, foam `info`. `iris` has no
 * role in this contract; the TUI spends it on metadata labels.
 *
 * The TUI port lands this scheme on twenty-three tokens and this contract wants
 * thirty-one, so the roles the scheme has no value for are DERIVED by rule,
 * consistently across this slice:
 *
 * - Grounds: `sunken` is one step below base; Rosé Pine's ladder ends at base.
 * - Inks: `text` stays `ink`, and the two mid rungs are `subtle`/`muted`
 *   lifted together. This contract measures every ink against all four
 *   grounds where the TUI measures two, and the lightest — `elevated` — is
 *   what binds, putting canonical subtle at 4.71:1 and muted at 2.94:1.
 * - `hairline`: one step outside the ladder on the scheme's own highlight
 *   hue. highlight-low sits at 1.1:1 against base, under the 1.15:1 a 1px
 *   rule needs to survive being resampled.
 * - `chartBarHover`: a step AWAY from the plot ground, not along the accent
 *   ramp. The rose is a pastel already at the top of its ramp, so the step is
 *   the palest rose rather than a brighter hex.
 * - `onAccent`: the page ground.
 */
export const rosePine: ThemeDefinition = {
	id: "rosePine",
	name: "Rosé Pine",
	description: "Dusty rose and muted pine on a deep plum night.",
	palette: {
		mode: "dark",

		canvas: "#191724",
		surface: "#1f1d2e",
		elevated: "#26233a",
		sunken: "#12101b",
		/*
		 * The current row's own ground: `surface` stepped 3.16 `L*` up at the panel's own
		 * hue (1.2 degrees off, inside the 12-degree bound) and carried
		 * 14.25 `C*` against the panel's 12.42 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 2.43, from
		 * `elevated` 1.31, from `sunken` 7.81. Ink on this ground: `ink` 11.56:1,
		 * `ink-muted` 8.81:1, `ink-dim` 4.67:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `1.04x` the panel's
		 * chroma (12.97 `C*` against 12.42), 25 degrees off its hue, ΔE00 5.97 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * AND IT IS BELOW THE FLOOR: ΔE00 2.43 is under the 2.5 every palette must hold.
		 * Hue-faithfully there is no value that reaches it — the row cannot rise further
		 * without putting this palette's own body ink under its floor, and buying it back
		 * on chroma or hue is the defect this round removes. It is on the NAMED LIST in
		 * `HIGHLIGHT_CAP_PINS` (`subFloor`), with its numbers, and the structural fix is the
		 * row-hover split rather than a louder mark here.
		 *
		 * THE HOVER STEP IS THE COLLISION: 1.31 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_HOVER_PINS` and is
		 * on the row-hover work list.
		 */
		highlight: "#262337",

		ink: "#e0def4",
		// subtle, lifted; see the header. Canonical muted 6e6a86 is the inert
		// rung further down.
		inkMuted: "#c5c2dd",
		inkDim: "#8F8BA9",
		inkDisabled: "#6e6a86",

		hairline: "#30303E",
		// highlight-med 403d52 lifted to clear 3:1 on `elevated`.
		borderControl: "#8b87a3",

		accent: "#ebbcba",
		accentHover: "#f2cfcd",
		accentActive: "#d9a5a3",
		// ΔE00 10.5 from `accent` and 13.8:1 on surface, where the accent is
		// 9.8:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFE5E2",
		accentWash: "#2e2430",
		onAccent: "#191724",

		// pine #31748f measures 3.38:1 on base and 3.16:1 on surface — the only
		// canonical accent under the floor on this ground. Lifted on-hue.
		success: "#5995b2",
		successWash: "#1a2730",
		successBorder: "#417d99",

		// gold, upstream's warnings colour.
		warning: "#f6c177",
		warningWash: "#2b2419",
		warningBorder: "#8a7040",

		// love, upstream's terminal red. The border is the danger button's only
		// edge until hover, so it clears 3:1 on the dialog ground too.
		danger: "#eb6f92",
		dangerWash: "#2e1c26",
		dangerBorder: "#A45A6E",

		// foam, upstream's "object keys, info, git add" hue.
		info: "#9ccfd8",
		infoWash: "#1a2a2e",
		infoBorder: "#4f8189",

		overlayShadow: "0 12px 32px -12px rgb(14 12 20 / 0.7)",
		scrim: "rgb(14 12 20 / 0.6)",
	},
};
