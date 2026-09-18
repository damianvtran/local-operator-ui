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
 *
 * ## The legibility pass, and what this file's numbers mean
 *
 * The grounds, ink weights and edges in this file were re-authored against the
 * pass's floors (see `docs/branding.md` § 2-3 and `scripts/contrast-contract.mjs`,
 * which asserts all of them): no page ground below L* 12 in a dark theme or above
 * L* 94 in a light one, a `surface` 2.5-5.0 L* above the canvas, an `elevated`
 * 2.5-6.0 above that, a `sunken` 1.5-6.0 below it, and the three ink weights at
 * 7.0 / 5.5 / 5.0:1 on all SIX grounds - the four elevation steps plus the two
 * that carry state, `accentWash` and `highlight`.
 *
 * Every other measurement quoted below was taken when the role above it was
 * authored, against the ground values as they stood THEN - a measurement is of a
 * moment, and this repository keeps the reading rather than silently refreshing
 * it. The pass's own values are the numbers in the blocks it added; the ones it
 * did not touch are unchanged and still measure what they say.
 */
export const rosePine: ThemeDefinition = {
	id: "rosePine",
	name: "Rosé Pine",
	description: "Dusty rose and muted pine on a deep plum night.",
	palette: {
		mode: "dark",

		canvas: "#201e2b",
		surface: "#262436",
		elevated: "#2B283F",
		sunken: "#191822",
		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #312727  accent hue, C* 4.99, +1.58 L*, ΔE00 10.30 off `surface`,
		 *                       `inkDim` 5.29:1 on the fill, hue 3.60° off `accent`.
		 * rowSelected #3F2727  accent hue, C* 12.23, +3.43 L*, ΔE00 13.49 off
		 *                       `surface` and 6.75 off `rowHover`, `inkDim` 5.01:1, and the
		 *                       2px `accent` bar at 8.12:1 against it.
		 */
		rowHover: "#312727",
		rowSelected: "#3F2727",

		ink: "#e0def4",
		// subtle, lifted; see the header. Canonical muted 6e6a86 is the inert
		// rung further down.
		inkMuted: "#c5c2dd",
		inkDim: "#9d99b7",
		inkDisabled: "#6e6a86",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `surface` is the tightest ground at ΔE00 6.19.
		 */
		hairline: "#363644",
		// highlight-med 403d52 lifted to clear 3:1 on `elevated`.
		borderControl: "#8b87a3",

		accent: "#ebbcba",
		accentHover: "#f2cfcd",
		accentActive: "#d9a5a3",
		// ΔE00 10.5 from `accent` and 13.8:1 on surface, where the accent is
		// 9.8:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFE5E2",
		tokenCommand: "#9ccfd8",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#2e2430",
		onAccent: "#191724",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#c4a7e7`, iris), received unchanged because it already
		 * clears every floor — ΔE00 21.62 from `accent`, 23.24 from its nearest
		 * semantic (`danger`), 7.23:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#c4a7e7",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 15.78 and C* 9.63, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 2.05 from `accentWash` (the field floor is
		 * 2.0), 7.10:1 for `accentAlt` on it, and 3.02 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#2B2532",

		// pine #31748f measures 3.38:1 on base and 3.16:1 on surface — the only
		// canonical accent under the floor on this ground. Lifted on-hue.
		success: "#5f9bb8",
		successWash: "#1a2730",
		successBorder: "#417d99",

		// gold, upstream's warnings colour.
		warning: "#f6c177",
		warningWash: "#2b2419",
		warningBorder: "#8c7241",

		// love, upstream's terminal red. The border is the danger button's only
		// edge until hover, so it clears 3:1 on the dialog ground too.
		danger: "#eb6f92",
		dangerWash: "#2e1c26",
		dangerBorder: "#aa5f73",

		// foam, upstream's "object keys, info, git add" hue.
		info: "#9ccfd8",
		infoWash: "#1a2a2e",
		infoBorder: "#4f8189",

		overlayShadow: "0 12px 32px -12px rgb(14 12 20 / 0.7)",
		scrim: "rgb(14 12 20 / 0.6)",
	},
};
