import type { ThemeDefinition } from "../palette-contract";

/**
 * Nightfox.
 *
 * Carried from EdenEast/nightfox's `nightfox` variant: the slate-blue ground,
 * the pale azure accent, and the scheme's green, yellow, red and cyan. It is
 * the dark half of the fox pair with `duskfox.ts`, which is the same scheme
 * warmed toward violet.
 *
 * The ground ladder is upstream's own (bg 192330, surface 212e3f, raised
 * 29394f), reordered onto this contract's four grounds and unchanged: its
 * steps measure ΔE00 3.8 / 4.0, which is already a visible step per ground.
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`.
 *
 * Two values move for reasons beyond those rules:
 *
 * - `inkDim` relaxes away from `inkMuted`: the scheme's dim rung sits a step
 *   too close to the muted one for the contract's ΔE00 8 ink step.
 * - `info` is the cyan lifted off 63cdcf. At canonical it sits ΔE00 14.0 from
 *   the scheme's green, under the 15 the contract wants between two semantics a
 *   reader meets alone and has to name.
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
export const nightfox: ThemeDefinition = {
	id: "nightfox",
	name: "Nightfox",
	description: "Nordfox night: slate blue under a pale azure accent.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +4.7, elevated +10.18, sunken -4.33 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #192330 -> #192330 (L* 13.36 -> 13.36)
		 * surface #212E3F -> #202D3E (L* 18.52 -> 18.06)
		 * elevated #243449 -> #243449 (L* 23.55 -> 21.25)
		 * sunken #131A24 -> #131A24 (L* 9.03 -> 9.03)
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
		canvas: "#192330",
		surface: "#202D3E",
		elevated: "#243449",
		sunken: "#131A24",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #2C3035  accent hue, C* 3.80, +1.60 L*, ΔE00 6.50 off `surface`,
		 *                       `inkDim` 5.67:1 on the fill, hue 5.94° off `accent`.
		 * rowSelected #1E3855  accent hue, C* 20.54, +4.80 L*, ΔE00 5.65 off
		 *                       `surface` and 11.02 off `rowHover`, `inkDim` 5.12:1, and the
		 *                       2px `accent` bar at 5.43:1 against it.
		 *
		 * NAMED EXCEPTION, recorded in `ROW_STATE_PINS` in `scripts/contrast-contract.mjs`
		 * with its measured ceiling and the ink that binds it: this palette cannot hold
		 * the rule's set inside the chroma ceiling, and the floor is NOT widened to fit it.
		 */
		rowHover: "#2C3035",
		rowSelected: "#1E3855",

		ink: "#CDCECF",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 5.95:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#B1B2B3",
		// the scheme's dim rung, relaxed to clear ΔE00 8 from `inkMuted`.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.39:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#9BABBE",
		inkDisabled: "#738091",

		hairline: "#35465C",
		// the scheme's own border blue 6483ad, which is already at 3:1.
		borderControl: "#6483AD",

		// the scheme's pale azure.
		accent: "#8FB1DF",
		accentHover: "#ABC4E7",
		accentActive: "#7AA3D9",
		// ΔE00 10.5 from `accent` and 9.5:1 on surface, where the accent is
		// 6.2:1.
		chartBarHover: "#B6DAFF",
		tokenCommand: "#6FD8DA",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#20304A",
		onAccent: "#131A24",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#9D79D6`,
		 * canonical magenta), moved onto the floors: as received it read 4.08:1 as
		 * text on `surface`. The shortfall is paid on LIGHTNESS at the source hue —
		 * L* 57.75 → 60.81 — which is what this port does to every one of its own
		 * tokens. Measured: ΔE00 17.73 from `accent`, 23.00 from its nearest
		 * semantic (`danger`), 4.52:1 on the tightest ground (`surface`).
		 */
		accentAlt: "#A581DF",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 19.70 and C* 18.26, with the hue moved to
		 * `accentAlt`'s, with the L* walked -2.00 because the chip's own ink floor
		 * binds (`accentAlt` on the wash needs 4.5:1). Measured: ΔE00 10.87 from
		 * `accentWash` (the field floor is 2.0), 4.55:1 for `accentAlt` on it, and
		 * 12.26 from the nearest ground it is painted on.
		 */
		accentAltWash: "#312740",

		success: "#81B29A",
		successWash: "#26353D",
		successBorder: "#81B29A",

		warning: "#DBC074",
		warningWash: "#2B3236",
		warningBorder: "#DBC074",

		danger: "#DD8B9F",
		dangerWash: "#302F3D",
		dangerBorder: "#DB899D",

		// the scheme's cyan, lifted; see the header.
		info: "#6FD8DA",
		infoWash: "#213541",
		infoBorder: "#63CDCF",

		overlayShadow: "0 12px 32px -12px rgb(10 14 20 / 0.75)",
		scrim: "rgb(10 14 20 / 0.62)",
	},
};
