import type { ThemeDefinition } from "../palette-contract";

/**
 * Catppuccin Frappé — the third flavour, from catppuccin/palette v1.8.0.
 *
 * The palette supplies its own ground ramp, so the four grounds are upstream's where they
 * fit: base 303446 is the page and mantle 292C3E sits below it. Text C6D0F5, subtext0 A6AECE
 * and overlay0 737994 carry the ink weights.
 *
 * Frappé is the lightest of the three dark flavours, which is what makes it the tightest:
 * the binding ground for every ink is `elevated`, and this is the one flavour whose window
 * between the 4.5:1 readout floor and the 7:1 body floor cannot hold two tone tiers apart —
 * so the control rung takes upstream's own text and the readout rung takes subtext0, skipping
 * subtext1, to clear this contract's ΔE00 8 ink step (the shipped `tokyoNight` carries that
 * pair below the step as a pinned exception; a new palette may not).
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1; a semantic
 * border walks its hue toward the ground to just above the 3:1 edge floor; the shadow and the
 * scrim are the ground tinted.
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
export const catppuccinFrappe: ThemeDefinition = {
	id: "catppuccinFrappe",
	name: "Catppuccin Frappé",
	description: "The middle flavour — warm slate under the Catppuccin pastels.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.15, elevated +6.24, sunken -3.12 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #303446 -> #303445 (L* 22.04 -> 21.99)
		 * surface #363B4E -> #363B4E (L* 25.14 -> 25.14)
		 * elevated #3D4255 -> #3D4255 (L* 28.23 -> 28.23)
		 * sunken #2A2D3E -> #2A2D3E (L* 18.87 -> 18.87)
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
		canvas: "#303445",
		surface: "#363B4E",
		elevated: "#3D4255",
		sunken: "#2A2D3E",
		/*
		 * The current row's own ground, and the one palette class this pass pins:
		 * `surface` stepped 2.4 `L*` lighter at the panel's own hue, under the 3
		 * `L*` the direction floor asks for, because this palette's own inks cap the
		 * lightness route at 2.4 `L*`. The band is paid on the cast at 1.49x the
		 * panel's chroma, which is the shape `HIGHLIGHT_STEP_PINS` records for it.
		 * What binds this one is `ink-dim` at 5.16:1 on the row's ground. ΔE00 5.2
		 * from `surface`, 4.88 from `elevated`, 8.66 from `sunken`, 6.43 from
		 * `accentWash`; the inks on the ground are 7.45:1, 7.18:1, 5.16:1.
		 * Continuity with the panel: hue 8.45 degrees off the panel's (the assertion
		 * allows 15) and chroma 18.8 where the panel carries 12.6.
		 */
		highlight: "#31425E",

		// Canonical text C6D0F5 is 6.52:1 on `elevated` — under the 7:1 body floor. Lifted
		// along the same lavender-white.
		/*
		 * Legibility pass: `ink` is re-seated on the lifted grounds, where its floor
		 * is 7:1 on all six grounds and `highlight` binds it at 7.47:1.
		 *
		 * It also carries the transcript's own 8.0:1 on `canvas`, which is the
		 * surface the operator's report is about.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		ink: "#D4DCFB",
		// Upstream text. It takes the top rung so that the readout rung below it can clear
		// the ink step at all; see the header.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `highlight` binds it at 7.19:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#CED8FD",
		// Canonical subtext0 A6ADCE measures 4.49:1 on `elevated`, a hundredth short of the
		// floor; lifted along the same slate, and the readout tier of the ladder.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.17:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#B0B8D8",
		inkDisabled: "#737994",

		// The port's #464B60 sat ΔE00 3.16 from `elevated`, where a 1px line needs 4.0. This
		// clears it and stays between 1.24:1 and 1.70:1 on the four grounds, so it still
		// divides rather than bounds.
		hairline: "#4A5064",
		// Upstream overlay2, which clears the 3:1 structural floor with room (3.67:1 on
		// the binding ground) where overlay0 — the inactive tone — could not.
		borderControl: "#949CBB",

		accent: "#CA9EE6",
		accentHover: "#DCBEEE",
		accentActive: "#BA82DF",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.4 from `accent`, and 7.5:1 on surface where `accent` is 5.0:1.
		// See `chartBarHover` in the palette contract.
		chartBarHover: "#E9C8FF",
		tokenCommand: "#91AEEF",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		/*
		 * Legibility pass: the wash is a hover and callout tint, not a selection
		 * ground, and it gains one floor - ΔE00 2.0 against every ground it is painted
		 * on - because it reads 1.00-1.24:1, so no ratio assertion can see it.
		 * `surface` is the tightest base at ΔE00 2.05. Lightness only, at the
		 * wash's own hue.
		 */
		accentWash: "#37394E",
		// Upstream crust. The port shipped base 303446 here, which is 4.31:1 on the pressed
		// fill and under the floor; crust takes the worst of the three states to 5.25:1.
		onAccent: "#232634",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#babbf1`,
		 * canonical lavender), moved onto the floors: as received it sat ΔE00 11.38
		 * from `accent`. That is paid on HUE — the hue walked 29.6° off the source
		 * and L* 77.48 → 80.37 — because a value that bought the separation by
		 * darkening would be the same hue at another weight. Measured: ΔE00 23.81
		 * from `accent`, 37.70 from its nearest semantic (`danger`), 6.59:1 on the
		 * tightest ground (`surface`).
		 */
		accentAlt: "#9CCCFD",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 24.60 and C* 13.88, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 8.26 from `accentWash` (the field floor is
		 * 2.0), 6.73:1 for `accentAlt` on it, and 6.26 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#293C4F",

		success: "#A6D189",
		successWash: "#343948",
		successBorder: "#8BC365",

		warning: "#EF9F76",
		warningWash: "#383848",
		warningBorder: "#EB8855",

		// Canonical red E78284 is 3.76:1 on `elevated` (< 4.5). Lifted along the same rose, then
		// nudged a further step so it keeps ΔE00 15 from the peach beside it — the lift alone
		// sat at 14.97.
		danger: "#F1989C",
		dangerWash: "#38384A",
		dangerBorder: "#E67F82",

		info: "#91AEEF",
		infoWash: "#353B4F",
		infoBorder: "#769AEB",

		// The shadow and scrim are the ground tinted, as in every palette here: a shadow
		// that carried its own hue would read as a second palette.
		overlayShadow: "0 12px 32px -12px rgb(35 38 52 / 0.65)",
		scrim: "rgb(35 38 52 / 0.6)",
	},
};
