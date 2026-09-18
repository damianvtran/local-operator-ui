import type { ThemeDefinition } from "../palette-contract";

/**
 * Tokyo Night Day — the light variant, completing the set beside the `tokyoNight` this app
 * already ships, and sharing its hues so the pair reads as one scheme in two modes.
 *
 * Unlike every other palette in this directory there is no published hex table to be faithful
 * to: upstream GENERATES `day` by inverting the `night` palette programmatically (lua/
 * tokyonight/colors/day.lua calls `Util.invert`). The values below are upstream's own generated
 * artifacts — extras/kitty/tokyonight_day.conf and extras/wezterm/tokyonight_day.toml, which
 * agree hex for hex: background E1E2E7, foreground 3760BF, blue 2E7DE9, red F52A65, green
 * 587539, yellow 8C6C3E, purple 9854F1, cyan 007197. Treat them as upstream's output rather
 * than as a spec — a retune of `night` moves all of them.
 *
 * Inversion preserves hue, not contrast, and this is the one palette here where nearly every
 * generated value misses: the generated foreground is 4.19:1 on the darkest ground where the
 * body floor is 7, and the six accents land between 2.78:1 and 3.95:1 against the 4.5 floor.
 * Each is re-solved along its own hue by the minimum that clears all four grounds, and the
 * measured miss is recorded per role below.
 *
 * The two lower ink weights are the exception to that minimum, and the reason is the ink step
 * this contract measures between them: the generated comment and dark5 are ΔE00 5.1 apart, so
 * `inkMuted` is seated deeper — still the generated comment's own indigo — until the readout
 * rung below it takes a different name.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1; a semantic
 * border walks its hue toward the ground to just above the 3:1 edge floor; the shadow and the
 * scrim are the ink tinted.
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
export const tokyoNightDay: ThemeDefinition = {
	id: "tokyoNightDay",
	name: "Tokyo Night Day",
	description: "Tokyo Night at noon — cool paper under the same neon hues.",
	palette: {
		mode: "light",

		canvas: "#E1E2E7",
		// Generated inactive-tab C4C8DA sits far below the page and would cost every ink
		// two thirds of its headroom on the binding ground. The two raised grounds are seated
		// one visible step above the page instead (ΔE00 2.2 and 2.1).
		surface: "#EAEBEE",
		elevated: "#F3F4F5",
		// Generated inactive-tab C4C8DA is ΔE00 6.3 under the page — a well rather than a
		// recess. This is one just-visible step under canvas (ΔE00 2.06).
		sunken: "#D8DAE1",
		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 4.95 `L*` darker (branch L of this port's selection rule), and
		 * carrying 3.32x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `ink-dim` at 5.16:1 on
		 * the row's ground. ΔE00 4.54 from `surface`, 6.39 from `elevated`, 2.35
		 * from `sunken`, 2.3 from `accentWash`; the inks on the ground are 7.66:1,
		 * 6.97:1, 5.16:1. Continuity with the panel: hue 14.65 degrees off the
		 * panel's (the assertion allows 15) and chroma 5.25 where the panel carries
		 * 1.58.
		 */
		highlight: "#D7DEE7",

		// Generated foreground 3760BF is 4.19:1 on `sunken` — a syntax blue, not a body ink,
		// which is what the 7:1 floor is for. Deepened along the same indigo to 7.33:1.
		/*
		 * Legibility pass: `ink` is re-seated on the lifted grounds, where its floor
		 * is 7:1 on all six grounds and `sunken` binds it at 7.44:1.
		 *
		 * It also carries the transcript's own 8.0:1 on `canvas`, which is the
		 * surface the operator's report is about.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		ink: "#223D7B",
		// Generated comment 6172B0 is 3.31:1 on `sunken` (< 4.5). Deepened, and then
		// deepened again so the generated dark5 below it clears the ΔE00 8 ink step — the
		// two generated tones sit only 5.1 apart.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `sunken` binds it at 6.77:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#34427D",
		// Generated dark5 8990B3 is 2.24:1 on `sunken` (< 4.5), the largest miss of the ink
		// weights. Deepened along its own hue, and kept a distinct rung from `inkMuted` above
		// rather than collapsing the two.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `sunken` binds it at 5.01:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#4F577F",
		inkDisabled: "#8990B3",

		hairline: "#C5C9DB",
		// The generated comment blue, which clears the 3:1 structural floor (3.31:1 on
		// the binding ground) where it could not clear 4.5 as text.
		borderControl: "#6172B0",

		// Generated blue 2E7DE9 is 2.88:1 on `sunken` (< 4.5). Deepened along the same blue.
		accent: "#135BBE",
		accentHover: "#104895",
		accentActive: "#0C3671",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#003F90",
		tokenCommand: "#016689",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		/*
		 * Legibility pass: the wash is a hover and callout tint, not a selection
		 * ground, and it gains one floor - ΔE00 2.0 against every ground it is painted
		 * on - because it reads 1.00-1.24:1, so no ratio assertion can see it.
		 * `sunken` is the tightest base at ΔE00 2.06. Lightness only, at the
		 * wash's own hue.
		 */
		accentWash: "#DEE1EB",
		onAccent: "#E1E2E7",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#8635ee`,
		 * generated purple #9854f1 is 3.33:1 (< 4)), moved onto the floors: as
		 * received it read 4.00:1 as text on `sunken` and one more ground. The
		 * shortfall is paid on LIGHTNESS at the source hue — L* 43.93 → 40.36 —
		 * which is what this port does to every one of its own tokens. Measured:
		 * ΔE00 19.67 from `accent`, 34.06 from its nearest semantic (`danger`),
		 * 4.57:1 on the tightest ground (`sunken`).
		 */
		accentAlt: "#7B2AE4",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 89.57 and C* 5.28, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 4.27 from `accentWash` (the field floor is
		 * 2.0), 4.88:1 for `accentAlt` on it, and 4.41 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#E5DFE9",

		// Generated green 587539 is 3.74:1 on `sunken` (< 4.5). Deepened along the same
		// green.
		success: "#4E6632",
		successWash: "#DADCDE",
		successBorder: "#5B783A",

		// Generated yellow 8C6C3E is 3.47:1 on `sunken` (< 4.5). Deepened along the same
		// amber.
		warning: "#755A33",
		warningWash: "#DBDADC",
		warningBorder: "#896A3D",

		// Generated red F52A65 is 2.78:1 on `sunken` — the largest miss here. Deepened along
		// the same red.
		danger: "#BE063D",
		dangerWash: "#E0DDE3",
		dangerBorder: "#DC0A47",

		// Generated cyan 007197 is 3.95:1 on `sunken`, the narrowest miss of the six; deepened
		// one step along the same cyan.
		info: "#016689",
		infoWash: "#D8DDE3",
		infoBorder: "#0078A1",

		// The shadow and scrim are the ink tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(37 65 128 / 0.22)",
		scrim: "rgb(37 65 128 / 0.35)",
	},
};
