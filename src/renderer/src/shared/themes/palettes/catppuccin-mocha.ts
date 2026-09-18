import type { ThemeDefinition } from "../palette-contract";

/**
 * Catppuccin Mocha — the flavour the family is named for, from catppuccin/palette v1.8.0.
 *
 * Base 1E1E2E is the page and mantle 181825 sits below it. Upstream surface0 313244 is ΔE00
 * 6.35 from base on its own — one step where this ladder needs two — so `surface` and
 * `elevated` are seated between them at ΔE00 2.2 and 2.1.
 *
 * Text CDD6F4 is `ink`, subtext1 BAC2DE is `inkMuted` and overlay2 939AB7 is `inkDim`,
 * skipping subtext0 so the control rung and the readout rung clear this contract's ΔE00 8 ink
 * step. `inkDisabled` is upstream overlay0. Mauve CBA6F7 carries the accent and the
 * green/peach/red/blue row is upstream's, unmodified — mocha's ground is dark enough that not
 * one of them needed a lift.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the crust tinted.
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
export const catppuccinMocha: ThemeDefinition = {
	id: "catppuccinMocha",
	name: "Catppuccin Mocha",
	description:
		"The original flavour — the deepest navy under the Catppuccin pastels.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.36, elevated +5.91, sunken -3.12 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #1E1E2E -> #1F1F2F (L* 11.97 -> 12.46)
		 * surface #252535 -> #262636 (L* 15.35 -> 15.82)
		 * elevated #2A2A3D -> #2B2B3F (L* 17.85 -> 18.37)
		 * sunken #181825 -> #191926 (L* 8.83 -> 9.34)
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
		canvas: "#1F1F2F",
		// Seated between base and upstream surface0, which is ΔE00 6.1 from base on its own:
		// one step where this ramp needs two. ΔE00 2.2 and 2.2 up the ladder.
		surface: "#262636",
		elevated: "#2B2B3F",
		sunken: "#191926",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #2C2A2F  accent hue, C* 3.60, +1.62 L*, ΔE00 6.15 off `surface`,
		 *                       `inkDim` 5.69:1 on the fill, hue 3.34° off `accent`.
		 * rowSelected #382E42  accent hue, C* 14.26, +4.96 L*, ΔE00 6.12 off
		 *                       `surface` and 9.18 off `rowHover`, `inkDim` 5.14:1, and the
		 *                       2px `accent` bar at 6.31:1 against it.
		 */
		rowHover: "#2C2A2F",
		rowSelected: "#382E42",

		ink: "#CDD6F4",
		inkMuted: "#BAC2DE",
		// Upstream overlay2, taking the readout rung so the ink step clears (subtext0 is only
		// ΔE00 5.7 from subtext1 and may not).
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
		inkDim: "#9CA3C0",
		inkDisabled: "#6C7086",

		// Upstream surface1, seated at ΔE00 5.6 from `elevated`: a 1px line needs 4.0, and this
		// one stays between 1.21:1 and 1.51:1 on the four grounds so it divides rather than
		// bounds.
		hairline: "#363653",
		// Upstream surface1 45475A is 1.54:1 against the lightest ground — a decorative value
		// in a structural role, and the one role a palette is most likely to get wrong.
		// Walked away from the grounds along the same slate to 3.1:1, which is where every
		// shipped palette's structural edge sits.
		borderControl: "#727589",

		accent: "#CBA6F7",
		accentHover: "#DCC1FF",
		accentActive: "#B691E0",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.3
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#E2CCFF",
		tokenCommand: "#89B4FA",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		/*
		 * Legibility pass: the wash is a hover and callout tint, not a selection
		 * ground, and it gains one floor - ΔE00 2.0 against every ground it is painted
		 * on - because it reads 1.00-1.24:1, so no ratio assertion can see it.
		 * `elevated` is the tightest base at ΔE00 2.13. Lightness only, at the
		 * wash's own hue.
		 */
		accentWash: "#25253B",
		onAccent: "#11111B",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#b4befe`,
		 * canonical lavender), moved onto the floors: as received it sat ΔE00 11.15
		 * from `accent`. That is paid on HUE — the hue walked 15.3° off the source
		 * and L* 78.28 → 62.82 — because a value that bought the separation by
		 * darkening would be the same hue at another weight. Measured: ΔE00 20.16
		 * from `accent`, 35.69 from its nearest semantic (`danger`), 5.15:1 on the
		 * tightest ground (`surface`).
		 */
		accentAlt: "#719AD4",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 15.66 and C* 15.48, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 7.24 from `accentWash` (the field floor is
		 * 2.0), 5.16:1 for `accentAlt` on it, and 6.65 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#18283D",

		success: "#A6E3A1",
		// The scheme has no green tint, so the wash is the green tinted over `canvas` at
		// the strongest alpha (13%) that keeps the green itself at 4.5:1 on it.
		successWash: "#4B5E57",
		successBorder: "#498346",

		warning: "#FAB387",
		// The peach tinted over `canvas`, same rule as the green above.
		warningWash: "#5D4B4C",
		warningBorder: "#A6663B",

		danger: "#F38BA8",
		dangerWash: "#332434",
		// The danger hue walked toward the ground to just above the 3:1 the control's
		// only edge is asked for.
		dangerBorder: "#B75673",

		info: "#89B4FA",
		infoWash: "#213048",
		infoBorder: "#4E76B7",

		// The shadow and scrim are the crust tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
