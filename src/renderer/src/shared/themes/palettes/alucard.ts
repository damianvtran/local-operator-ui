import type { ThemeDefinition } from "../palette-contract";

/**
 * Alucard.
 *
 * Dracula's daylight counterpart — the same scheme with the ground inverted, so
 * it is deliberately a sibling of `dracula.ts` in this directory: the purple
 * accent, the red, the orange and the blue are the same hues, and only the
 * paper under them changed.
 *
 * Alucard's own ladder (bg fffbeb, surface fbf6e2, raised f5efd6,
 * highlight-med d9d4bd) cannot supply this contract's four grounds as it
 * stands: its top step measures ΔE00 1.81, under the 2.0 at which the captured
 * theme frames show a card reading as a separate surface from its canvas. It
 * is re-solved at the brand light pair's proportions, keeping `canvas` within
 * ΔE00 1.2 of upstream's bg.
 *
 * Roles Alucard has no value for follow the derivation rules recorded in
 * `rose-pine.ts`. Two deviations on top of them:
 *
 * - `borderControl` is upstream's `dim` rung rather than `edge-hi` d9d4bd,
 *   which is a ground colour doing a boundary's job: it bounds an input at
 *   1.5:1 against `elevated`, i.e. with no perceivable edge at all.
 * - `warning` steps deeper off the canonical orange a34d14. Alucard's orange
 *   and its red cb3a2a sit ΔE00 13.2 apart, under the 15 the contract wants
 *   between two semantics a reader meets alone and has to name.
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
export const alucard: ThemeDefinition = {
	id: "alucard",
	name: "Alucard",
	description: "Dracula's daylight: warm parchment under an indigo accent.",
	palette: {
		mode: "light",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A light page ground is capped at L* 94 here, because `elevated`
		 * at L* 100 is the end of sRGB's ramp and the minimum canvas-to-elevated
		 * spread is 2.5 + 2.5 L*.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +2.56, elevated +5.32, sunken -3.07 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #F9F5E5 -> #F1EEDE (L* 96.45 -> 93.94)
		 * surface #FCF9EE -> #F8F5EA (L* 97.88 -> 96.49)
		 * elevated #FFFEF9 -> #FEFDF8 (L* 99.61 -> 99.26)
		 * sunken #F1ECD9 -> #EAE5D2 (L* 93.32 -> 90.86)
		 *
		 * ONLY LIGHTNESS MOVED. Each value holds its own `a` and `b`, so the theme's
		 * hue and chroma class are exactly what they were and chroma is scaled only
		 * where sRGB forces it - a lift that neutralised a palette to satisfy a floor
		 * would be a different theme, not a lighter one.
		 *
		 * THE GROUNDS AND THE INKS MOVED TOGETHER, and the header of this file says why:
		 * lifting a dark ground raises the luminance every ink is measured against, so
		 * the inks in this file were re-seated on the same commit rather than after it.
		 */
		canvas: "#F1EEDE",
		surface: "#F8F5EA",
		elevated: "#FEFDF8",
		sunken: "#EAE5D2",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.03 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 6.25 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.11 from `surface`, 4.86 from `elevated` and 4.97 from `sunken`;
		 * the step is -6.18 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.67:1 the ink that binds it.
		 */
		highlight: "#EAE7E0",

		ink: "#1F1F1F",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `sunken` binds it at 7.13:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#4E4937",
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.19:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#655F45",
		inkDisabled: "#9B937A",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `sunken` is the tightest ground at ΔE00 4.12.
		 */
		hairline: "#D8D3C2",
		borderControl: "#6C664B",

		accent: "#644AC9",
		accentHover: "#4E35B0",
		accentActive: "#402B91",
		// ΔE00 10.4 from `accent` and 9.4:1 on surface, where the accent is
		// 5.9:1.
		chartBarHover: "#4A27A6",
		tokenCommand: "#036A96",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		/*
		 * Legibility pass: the wash is a hover and callout tint, not a selection
		 * ground, and it gains one floor - ΔE00 2.0 against every ground it is painted
		 * on - because it reads 1.00-1.24:1, so no ratio assertion can see it.
		 * `surface` is the tightest base at ΔE00 2.14. Lightness only, at the
		 * wash's own hue.
		 */
		accentWash: "#F1ECE2",
		onAccent: "#FFFBEB",

		success: "#14710A",
		successWash: "#F8F7E4",
		successBorder: "#17830C",

		// canonical orange, stepped deeper; see the header.
		warning: "#813100",
		warningWash: "#FBF3E1",
		warningBorder: "#954100",

		// canonical red cb3a2a, lifted to clear 4.5:1 on the deepest ground.
		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `sunken` binds it there at
		 * 4.5:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		danger: "#C12F21",
		dangerWash: "#FDF4E4",
		dangerBorder: "#D85041",

		info: "#036A96",
		infoWash: "#F5F5E8",
		infoBorder: "#037BAE",

		overlayShadow: "0 12px 32px -12px rgb(31 31 31 / 0.22)",
		scrim: "rgb(31 31 31 / 0.35)",
	},
};
