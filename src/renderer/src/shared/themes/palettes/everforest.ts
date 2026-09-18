import type { ThemeDefinition } from "../palette-contract";

/**
 * Everforest.
 *
 * Carried from sainnhe/everforest (`palette.md`, dark/medium): the bg_dim to
 * bg2 ground ladder, the signature green, the yellow, the purple and the grey
 * ramp.
 *
 * Everforest is designed for soft contrast, so this is the palette the fourth
 * ground costs the most. The TUI port measures ink against two grounds; this
 * contract measures every ink and semantic against all four, and the lightest —
 * `elevated` 3D484D — is what binds: canonical fg D3C6AA sits at 5.57:1 there
 * and canonical red E67E80 at 3.43:1, both under their floors. The ink ramp is
 * therefore lifted on-hue, and `inkMuted` is taken past its own floor so that
 * it stays visibly a rung above `inkDim` rather than collapsing into it.
 *
 * The other roles follow the derivation rules recorded in `rose-pine.ts`.
 * `accent` is the canonical green rather than upstream's syntax-role name for
 * "blue": the green is this scheme's identity, and spending it on a success
 * glyph while painting the app's most common ink pink is the wrong reading of
 * upstream's token names — the TUI palette maps the same way.
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
export const everforest: ThemeDefinition = {
	id: "everforest",
	name: "Everforest",
	description: "Low-contrast forest night, moss green over warm slate.",
	palette: {
		mode: "dark",

		canvas: "#2D353B",
		surface: "#343F44",
		elevated: "#3D484D",
		sunken: "#232A2E",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 5.65 `L*` lighter (branch L of this port's selection rule), and
		 * carrying 1.32x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `ink-dim` at 5.16:1 on
		 * the row's ground. ΔE00 4.78 from `surface`, 2.4 from `elevated`, 11.46
		 * from `sunken`, 2.06 from `accentWash`; the inks on the ground are 7.22:1,
		 * 7.22:1, 5.16:1. Continuity with the panel: hue 4.96 degrees off the
		 * panel's (the assertion allows 15) and chroma 7.33 where the panel carries
		 * 5.56.
		 */
		highlight: "#3D4D53",

		// fg D3C6AA is 5.57:1 on `elevated`, under the 7:1 floor; lifted.
		/*
		 * Legibility pass: `ink` is re-seated on the lifted grounds, where its floor
		 * is 7:1 on all six grounds and `accentWash` binds it at 7.03:1.
		 *
		 * It also carries the transcript's own 8.0:1 on `canvas`, which is the
		 * surface the operator's report is about.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		ink: "#F0E8D6",
		// grey2 9DA9A0 is 3.86:1 on `elevated`, and the 4.5 floor leaves it too
		// close to `inkDim` for the contract's ΔE00 8 ink step.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `accentWash` binds it at 7.03:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#E2EBE3",
		// grey1 859289 is 2.90:1 on `elevated`.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `accentWash` binds it at 5.03:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#BEC9C1",
		// grey0, the scheme's own inert-hint grey.
		inkDisabled: "#7A8478",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 4.64.
		 */
		hairline: "#4A555C",
		// bg4 4F585E is 1.29:1 on `elevated` — a ground colour doing a
		// boundary's job. Lifted along the same cool grey.
		borderControl: "#89949C",

		// canonical green.
		/*
		 * Legibility pass: `accent` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.51:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		accent: "#ABC584",
		accentHover: "#B7D28C",
		// A saturation step, not a darker one: the green is already at 4.70:1
		// on its worst ground, so stepping down in lightness breaks the floor.
		accentActive: "#A0C06D",
		// ΔE00 10.3 from `accent` and 8.3:1 on surface, where the accent is
		// 5.4:1.
		/*
		 * Legibility pass: `chartBarHover` follows `accent` - the ramp is one control seen
		 * three times and the chart's hover mark has to stay ΔE00 10 clear of the
		 * resting mark, so both move at their own hue rather than letting the accent
		 * pull away from them.
		 */
		chartBarHover: "#D4F0AD",
		tokenCommand: "#9ACAC3",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		/*
		 * Legibility pass: the wash is a hover and callout tint, not a selection
		 * ground, and it gains one floor - ΔE00 2.0 against every ground it is painted
		 * on - because it reads 1.00-1.24:1, so no ratio assertion can see it.
		 * `elevated` is the tightest base at ΔE00 2.1. Lightness only, at the
		 * wash's own hue.
		 */
		accentWash: "#434E52",
		onAccent: "#2D353B",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#D699B6`,
		 * canonical purple), moved onto the floors: as received it sat ΔE00 12.02
		 * from `danger`. That is paid on HUE — the hue walked 14.8° off the source
		 * and L* 69.79 → 70.30 — because a value that bought the separation by
		 * darkening would be the same hue at another weight. Measured: ΔE00 47.47
		 * from `accent`, 15.56 from its nearest semantic (`danger`), 4.76:1 on the
		 * tightest ground (`surface`).
		 */
		accentAlt: "#CE9DC3",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 32.37 and C* 5.11, with the hue moved to
		 * `accentAlt`'s, with the L* walked -5.00 because the chip's own ink floor
		 * binds (`accentAlt` on the wash needs 4.5:1). Measured: ΔE00 12.29 from
		 * `accentWash` (the field floor is 2.0), 4.54:1 for `accentAlt` on it, and
		 * 10.44 from the nearest ground it is painted on.
		 */
		accentAltWash: "#463E44",

		/*
		 * Legibility pass: `success` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.51:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		success: "#ABC584",
		successWash: "#3A4442",
		successBorder: "#A7C080",

		// canonical yellow.
		warning: "#DBBC7F",
		warningWash: "#454842",
		warningBorder: "#DBBC7F",

		// canonical red E67E80, lifted for `elevated`.
		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.51:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		danger: "#F5A8A8",
		dangerWash: "#434147",
		dangerBorder: "#ECA0A1",

		// The blue-teal the TUI port maps to `signal`, so `info` is the same role
		// here; Everforest's purple is left to the callout's border rather than
		// doubling the green family in a second hue.
		info: "#9ACAC3",
		infoWash: "#42424C",
		infoBorder: "#DEA3C6",

		overlayShadow: "0 12px 32px -12px rgb(20 25 27 / 0.7)",
		scrim: "rgb(20 25 27 / 0.6)",
	},
};
