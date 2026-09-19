import type { ThemeDefinition } from "../palette-contract";

/**
 * Everforest Light.
 *
 * The daylight half of `everforest.ts`, and a deliberate sibling: the same
 * olive-green accent row, the same yellow, red and blue-teal, over warmed
 * paper. A user who picks Everforest for its low strain should get the same
 * scheme at noon, so only lightness moves between the two files.
 *
 * The ground ladder takes upstream's own four rungs in this contract's order —
 * its bg fdf6e3 as `elevated`, its surface f4f0d9 as `surface`, its
 * highlight-med ddd8be as `sunken` — with `canvas` interpolated between the last
 * two in the ladder's own proportions. Adjacent steps measure ΔE00 2.4 / 3.0 /
 * 7.7, at or above the 2.0 at which the captured frames show a card reading as a
 * separate surface from its canvas.
 *
 * Roles upstream has no value for follow the derivation rules recorded in
 * `rose-pine.ts`. Two notes on the inks: upstream's dim and muted rungs are
 * nearly the same colour here (ΔE00 1.7), so the contract's ΔE00 8 ink step
 * is bought by pulling `inkMuted` toward `ink` — the readout rung has no room
 * of its own, sitting 0.04 above its 4.5:1 floor on the deepest ground.
 * `accent` is the olive upstream spends on its signature green, and `success`
 * is that same green rather than a second hue: the scheme's aqua and its green
 * are one family, and a green a reader cannot name against the accent is not
 * worth a semantic.
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
export const everforestLight: ThemeDefinition = {
	id: "everforestLight",
	name: "Everforest Light",
	description: "Everforest by daylight: warm paper under a soft olive green.",
	palette: {
		mode: "light",

		canvas: "#EAE4C8",
		surface: "#F4EDD4",
		elevated: "#FDF6E3",
		sunken: "#DCD7BC",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #E9E9E1  accent hue, C* 4.13, +1.54 L*, ΔE00 6.69 off `surface`,
		 *                       `inkDim` 5.99:1 on the fill, hue 0.10° off `accent`.
		 * rowSelected #E0E2BA  accent hue, C* 20.70, +4.87 L*, ΔE00 6.97 off
		 *                       `surface` and 11.29 off `rowHover`, `inkDim` 5.48:1, and the
		 *                       2px `accent` bar at 5.01:1 against it.
		 */
		rowHover: "#E9E9E1",
		rowSelected: "#E0E2BA",

		ink: "#394246",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `sunken` binds it at 7.27:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#38413E",
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `sunken` binds it at 5.04:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#4E5952",
		inkDisabled: "#A6B0A0",

		hairline: "#CAC5AC",
		borderControl: "#6E7D6D",

		// upstream's signature green, deepened for ink on this paper.
		accent: "#566201",
		accentHover: "#465001",
		accentActive: "#373E01",
		// ΔE00 10.5 from `accent` and 8.9:1 on surface, where the accent is
		// 5.7:1.
		chartBarHover: "#3A4400",
		tokenCommand: "#235976",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#D9DDCE",
		onAccent: "#FDF6E3",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#A8317E`,
		 * purple, darkened from canonical #DF69BA (2.83:1)), moved onto the floors:
		 * as received it read 4.25:1 as text on `sunken`. The shortfall is paid on
		 * LIGHTNESS at the source hue — L* 41.26 → 39.75 — which is what this port
		 * does to every one of its own tokens. Measured: ΔE00 61.80 from `accent`,
		 * 25.42 from its nearest semantic (`danger`), 4.50:1 on the tightest ground
		 * (`sunken`).
		 */
		accentAlt: "#A42C7A",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 87.45 and C* 7.97, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 17.61 from `accentWash` (the field floor is
		 * 2.0), 4.73:1 for `accentAlt` on it, and 16.60 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#E8D7E0",

		success: "#566201",
		successWash: "#DAD6B2",
		successBorder: "#566201",

		warning: "#795700",
		warningWash: "#DFD6B4",
		warningBorder: "#795700",

		danger: "#B12624",
		dangerWash: "#E5D3B9",
		dangerBorder: "#B12724",

		// The aqua's own hue is carried by `infoBorder` rather than by a second
		// blue-green ink; see the header.
		info: "#235976",
		infoWash: "#E4D3C1",
		infoBorder: "#A7247E",

		overlayShadow: "0 12px 32px -12px rgb(92 106 114 / 0.28)",
		scrim: "rgb(60 68 66 / 0.45)",
	},
};
