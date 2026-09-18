import type { ThemeDefinition } from "../palette-contract";

/**
 * Solarized Light — Ethan Schoonover's Solarized, light variant, and the daylight half of the
 * pair with `solarizedDark`: the same sixteen tones, the same accent set, the ground moved to
 * base3 FDF6E3 with base2 EEE8D5 as the well below it.
 *
 * Solarized's light mode is deliberately warm — base3 is a cream, not a white — and the two
 * raised grounds it has no token for are DERIVED by shedding that cream's chroma as they rise,
 * which keeps the warmth in the page and still leaves four visible steps. Base02 073642 is the
 * body ink, base01 586E75 and base00 657B83 the lower weights.
 *
 * As on the dark side, the scheme's precision is in its hue relationships rather than in
 * contrast against a hard floor: base01 as the control ink is 4.39:1 on the darkest ground and
 * base00 as the readout ink is 3.64:1, both under 4.5, and the accents land between 3.8:1 and
 * 4.5:1. Each is moved along its own hue by the minimum that clears all four grounds, and every
 * measured miss is recorded at its role below.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over the page at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the ink tinted.
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
export const solarizedLight: ThemeDefinition = {
	id: "solarizedLight",
	name: "Solarized Light",
	description:
		"Schoonover's precision light — warm paper with the Solarized hues.",
	palette: {
		mode: "light",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A light page ground is capped at L* 94 here, because `elevated`
		 * at L* 100 is the end of sRGB's ramp and the minimum canvas-to-elevated
		 * spread is 2.5 + 2.5 L*.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +2.7, elevated +5.44, sunken -5.02 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #FDF6E3 -> #F4EDDB (L* 96.96 -> 93.85)
		 * surface #FEFAEE -> #F9F5E9 (L* 98.28 -> 96.55)
		 * elevated #FFFEFA -> #FEFDF9 (L* 99.63 -> 99.28)
		 * sunken #EEE8D5 -> #E5DFCC (L* 92 -> 88.82)
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
		canvas: "#F4EDDB",
		// Derived: upstream stops at base3 and this system needs two raised grounds above
		// the page. Both shed the cream's chroma as they rise (ΔE00 2.86 and 3.64), because
		// a ramp this close to white has almost no lightness left to spend.
		surface: "#F9F5E9",
		elevated: "#FEFDF9",
		// Upstream base2, the scheme's own recessed tone.
		sunken: "#E5DFCC",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.05 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 5 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4 from `surface`, 4.52 from `elevated` and 4.98 from `sunken`;
		 * the step is -5.15 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.71:1 the ink that binds it.
		 */
		highlight: "#EBECE4",

		ink: "#073642",
		// Canonical base01 586E75 is 4.39:1 on `sunken` — under the 4.5 floor, and only
		// ΔE00 3.2 from base00, under the 8 ink step. Seated deeper along the same
		// grey-teal, which solves both at once.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `sunken` binds it at 7.23:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#33484F",
		// Canonical base00 657B83 is 3.64:1 on `sunken`. Deepened along its own grey-teal to
		// the floor corner; it is the quietest of the three weights and the one the editor
		// paints comments in.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `sunken` binds it at 5.03:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#4B5F67",
		inkDisabled: "#93A1A1",

		// Derived: base2 is a panel fill, not a 1px line. Holds ΔE00 4.1 from every ground
		// and 1.18-1.43:1 against them.
		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `sunken` is the tightest ground at ΔE00 4.02.
		 */
		hairline: "#D6CFB8",
		// The scheme's own rules are cream tones: edge-hi D5CDAE is 1.30:1 against the page, and
		// base2 is 1.14:1, so neither can be a control's only edge. The structural role is that
		// rule tone walked away from the grounds to 3.1:1 instead.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `sunken`
		 * binds it at 3.01:1. Lightness only, at the role's own hue.
		 */
		borderControl: "#867F63",

		// Upstream blue 268BD2 deepened, and then deepened once more for the 4.5 floor on this
		// ground (4.49:1 on the recessed step). The scheme's defining blue, kept.
		/*
		 * Legibility pass: `accent` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `sunken` binds it there at
		 * 4.5:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		accent: "#12689E",
		accentHover: "#155B8A",
		accentActive: "#0F4770",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.5
		// from `accent`. See `chartBarHover` in the palette contract.
		/*
		 * Legibility pass: `chartBarHover` follows `accent` - the ramp is one control seen
		 * three times and the chart's hover mark has to stay ΔE00 10 clear of the
		 * resting mark, so both move at their own hue rather than letting the accent
		 * pull away from them.
		 */
		chartBarHover: "#024B78",
		tokenCommand: "#007469",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#EAEFD2",
		onAccent: "#FFFEFA",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#5f64bb`,
		 * violet, darkened from canonical #6c71c4 (3.57:1 surf)), moved onto the
		 * floors: as received it read 3.91:1 as text on `sunken` and one more
		 * ground; sat ΔE00 14.10 from `accent`. That is paid on HUE — the hue
		 * walked 14.7° off the source and L* 45.82 → 41.87 — because a value that
		 * bought the separation by darkening would be the same hue at another
		 * weight. Measured: ΔE00 23.50 from `accent`, 36.69 from its nearest
		 * semantic (`danger`), 4.52:1 on the tightest ground (`sunken`).
		 */
		accentAlt: "#7651A4",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 93.40 and C* 15.00, with the hue moved to
		 * `accentAlt`'s, and the chroma capped at C* 12.62 where sRGB runs out at
		 * that L*. Measured: ΔE00 26.92 from `accentWash` (the field floor is 2.0),
		 * 5.12:1 for `accentAlt` on it, and 14.16 from the nearest ground it is
		 * painted on.
		 */
		accentAltWash: "#F4E8FF",

		// Upstream green 859900 is 2.62:1 on `sunken`. Darkened along the same olive, and kept
		// distinct from the yellow below.
		/*
		 * Legibility pass: `success` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `sunken` binds it there at
		 * 4.51:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 52.85 -> 51.28, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		success: "#5A6A01",
		successWash: "#EDE9CF",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.03:1.
		 */
		successBorder: "#758629",

		// Upstream yellow B58900 is 2.62:1 on `sunken`. Darkened along the same amber, and kept
		// distinct from the olive above.
		/*
		 * Legibility pass: `warning` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `sunken` binds it there at
		 * 4.52:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 50.97 -> 49.78, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		warning: "#7E5E00",
		warningWash: "#F2E8D0",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.01:1.
		 */
		warningBorder: "#9C7A2A",

		// Upstream red DC322F is 3.77:1 on `sunken` (< 4.5). Darkened along the same red.
		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `sunken` binds it there at
		 * 4.52:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		danger: "#C5131C",
		dangerWash: "#FCEFE6",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3:1.
		 */
		dangerBorder: "#E8413C",

		// Upstream cyan 2AA198 is 2.58:1 on `sunken`. Darkened along the same teal — the cyan
		// rather than a second blue, so an info callout does not read as a primary action.
		/*
		 * Legibility pass: `info` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `sunken` binds it there at
		 * 4.55:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 30.47 -> 29.3, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		info: "#016F65",
		infoWash: "#E4ECEC",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.01:1.
		 */
		infoBorder: "#2D8D82",

		// The shadow and scrim are the ink tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(7 54 66 / 0.22)",
		scrim: "rgb(7 54 66 / 0.35)",
	},
};
