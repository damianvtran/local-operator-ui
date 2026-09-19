import type { ThemeDefinition } from "../palette-contract";

/**
 * Gruvbox Light (medium contrast) — morhetz's own light mode, from colors/gruvbox.vim.
 *
 * light0 FBF1C7 is the page, light0_soft F2E5BC the well below it, fg1/dark1 3C3836 the ink,
 * dark3 665C54 and dark4 7C6F64 the lower ink weights and light4 A89984 the inactive tone.
 * The FADED accent set is what gruvbox actually paints light mode with — faded_blue 076678,
 * faded_green 79740E, faded_yellow B57614, faded_red 9D0006 — because the bright set belongs to
 * the dark ramp and is unreadable here. Gruvbox's light mode has no accent of its own: yellow
 * is the scheme's face on the dark ramp but far too light to carry a state on cream, so
 * faded_blue takes the primary role and the darkened yellow keeps `warning`, the role its
 * meaning already fits.
 *
 * Two things the mobile-web port could not do for this contract. Its cream ramp separated by
 * chroma alone — ΔE00 2.26 but 1.02:1, under the 1.03:1 every two grounds owe each other — so
 * the two raised grounds are re-seated with a lightness step as well. And its two lower ink
 * weights sat ΔE00 5.6 apart, under the 8 ink step, so `inkMuted` takes a deeper seat and
 * `inkDim` stays on the floor corner.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over the page (stepping in lightness at low chroma where a tint would sit at the
 * ink's own luminance, as the olive does); a semantic border walks its hue toward the ground to
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
export const gruvboxLight: ThemeDefinition = {
	id: "gruvboxLight",
	name: "Gruvbox Light",
	description: "Retro groove by daylight, warm cream and faded ink.",
	palette: {
		mode: "light",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A light page ground is capped at L* 94 here, because `elevated`
		 * at L* 100 is the end of sRGB's ramp and the minimum canvas-to-elevated
		 * spread is 2.5 + 2.5 L*.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +2.8, elevated +5.52, sunken -3.95 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #FBF1C7 -> #F8EEC4 (L* 94.97 -> 93.92)
		 * surface #FDF6D8 -> #FDF6D8 (L* 96.72 -> 96.72)
		 * elevated #FFFCE8 -> #FFFEF2 (L* 98.71 -> 99.44)
		 * sunken #F2E5BC -> #EFE2B9 (L* 91.03 -> 89.97)
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
		canvas: "#F8EEC4",
		// Upstream defines light0_soft F2E5BC and light1 EBDBB2 BELOW the page, not above
		// it, so both raised grounds are derived: they shed the cream's chroma as they rise,
		// and take a lightness step too, because chroma alone measured 1.02:1 — under the
		// 1.03:1 floor two grounds owe each other.
		surface: "#FDF6D8",
		elevated: "#FFFEF2",
		// Upstream light0_soft, the scheme's own recessed tone.
		sunken: "#EFE2B9",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #E9F3F6  accent hue, C* 3.77, +1.53 L*, ΔE00 13.99 off `surface`,
		 *                       `inkDim` 5.74:1 on the fill, hue 0.67° off `accent`.
		 * rowSelected #CEEDF6  accent hue, C* 11.31, +4.88 L*, ΔE00 19.19 off
		 *                       `surface` and 7.05 off `rowHover`, `inkDim` 5.26:1, and the
		 *                       2px `accent` bar at 5.37:1 against it.
		 */
		rowHover: "#E9F3F6",
		rowSelected: "#CEEDF6",

		ink: "#3C3836",
		// Canonical dark3 665C54 is 5.18:1 on `sunken` and only ΔE00 5.6 from dark4, under
		// the 8 ink step. Seated deeper along the same warm grey so the readout rung below
		// it takes a different name.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `sunken` binds it at 7.12:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#4F4640",
		// Canonical dark4 7C6F64 measures 3.87:1 on `sunken`, under the 4.5 floor for a
		// tertiary weight. Darkened minimally along its own warm gray; dark4 itself still
		// serves as the structural border below, where the floor is 3:1 and it clears with
		// room.
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
		inkDim: "#685C53",
		inkDisabled: "#A89984",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `sunken` is the tightest ground at ΔE00 4.09.
		 */
		hairline: "#DDD2B0",
		// Canonical dark4, which clears the 3:1 structural floor on every ground where
		// the lighter rules could not.
		borderControl: "#7C6F64",

		accent: "#076678",
		accentHover: "#04414D",
		accentActive: "#022026",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#004755",
		tokenCommand: "#3B7050",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#F0EBC3",
		onAccent: "#FBF1C7",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#8f3f71`, canonical faded_purple), received unchanged
		 * because it already clears every floor — ΔE00 41.68 from `accent`, 27.78
		 * from its nearest semantic (`danger`), 5.21:1 as text on the tightest
		 * ground (`sunken`).
		 */
		accentAlt: "#8f3f71",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 92.52 and C* 20.61, with the hue moved to
		 * `accentAlt`'s, and the chroma capped at C* 12.65 where sRGB runs out at
		 * that L*. Measured: ΔE00 27.84 from `accentWash` (the field floor is 2.0),
		 * 5.57:1 for `accentAlt` on it, and 19.23 from the nearest ground it is
		 * painted on.
		 */
		accentAltWash: "#FEE2F1",

		// Canonical faded_green 79740E is 3.87:1 on `sunken`; this is the smallest darkening
		// along the same olive that clears 4.5:1 on all four grounds.
		/*
		 * Legibility pass: `success` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `sunken` binds it there at
		 * 4.53:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		success: "#6D6701",
		successWash: "#EFEFE4",
		successBorder: "#847E0F",

		// Canonical faded_yellow B57614 is 3.00:1 on `sunken` — the largest miss in this
		// palette. Darkened along the same amber.
		/*
		 * Legibility pass: `warning` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `sunken` binds it there at
		 * 4.52:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		warning: "#8D5A02",
		warningWash: "#F1EDE7",
		warningBorder: "#AA6E12",

		danger: "#9D0006",
		dangerWash: "#F8E9C0",
		dangerBorder: "#BC0007",

		// faded_aqua rather than faded_orange: the orange sat only ΔE00 10.8 from `danger`'s
		// faded_red — both dark red-orange on cream, so an error message and an informational
		// path read as one colour. Aqua is equally canonical, darkened one step to clear 4.5:1
		// on all four grounds.
		/*
		 * Legibility pass: `info` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `sunken` binds it there at
		 * 4.54:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		info: "#3B6F50",
		infoWash: "#F8EFD1",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.02:1.
		 */
		infoBorder: "#578C6C",

		// The shadow and scrim are the ink tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(60 56 54 / 0.22)",
		scrim: "rgb(60 56 54 / 0.35)",
	},
};
