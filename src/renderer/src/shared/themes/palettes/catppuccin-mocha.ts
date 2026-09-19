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
		 * The three grounds around the canvas ship as L* offsets from it (surface
		 * +3.33, elevated +5.78, sunken -2.98 L*), which is what every ink, edge
		 * and wash block below is measured against - and the offsets the LEGIBILITY PASS
		 * recorded (surface +3.36, elevated +5.91, sunken -3.12 L*) ARE ITS AUTHORING INPUT, NOT THE SHIPPED
		 * RUNG: the row/hover pass moved `elevated` down to the ladder's floor so the
		 * current row can outrank a hovered neighbour. Measured, both moves:
		 * canvas #1E1E2E -> #1F1F2F -> #2A2A3B  (L* 11.97 -> 12.46 -> 17.75)
		 * surface #252535 -> #262636 -> #323142  (L* 15.35 -> 15.82 -> 21.09)
		 * elevated #2A2A3D -> #2B2B3F -> #37364B  (L* 17.85 -> 18.37 -> 23.53)
		 * sunken #181825 -> #191926 -> #242432  (L* 8.83 -> 9.34 -> 14.77)
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
		canvas: "#2A2A3B",
		// Seated between base and upstream surface0, which is ΔE00 6.1 from base on its own:
		// one step where this ramp needs two. ΔE00 2.2 and 2.2 up the ladder.
		surface: "#323142",
		elevated: "#37364B",
		sunken: "#242432",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are a
		 * step of THIS palette's own panel at the panel's own hue; they used to be
		 * tints of `accent`, whose hue is more than 45 degrees off the panel on 25 of
		 * the 59 themes - the off-colour the operator reported. The rule, and why the
		 * fill now carries the ranking the 2px `accent` bar used to, are in the two
		 * roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #3A3943  panel hue, C* 6.64,
		 *                       the rule's 0.60 x the panel's 11.52; +3.33 L*,
		 *                       ΔE00 4.39 off `surface`, `inkDim` 5.30:1.
		 * rowSelected #3C3B53  panel hue, C* 15.77,
		 *                       the panel's cast + 4.0, floored at 5.0; +4.81 L*,
		 *                       ΔE00 4.43 off `surface` and 6.52 off
		 *                       `rowHover`; the pair ranks 1.48 `L*` and 9.1 `C*`,
		 *                       `inkDim` 5.03:1.
		 */
		rowHover: "#3A3943",
		rowSelected: "#3C3B53",

		/*
		 * Register re-solve: `ink`
		 * The transcript's ink re-seats with the band, at its own hue. Its floor is
		 * 8:1 on `canvas` and 7:1 on all SEVEN grounds; `rowSelected` binds it at
		 * 7.73:1.
		 */
		ink: "#D0D9F7",
		/*
		 * Register re-solve: `inkMuted`
		 * Re-seated a second time, with the band, and lightness is still the only
		 * axis: the floor is 5.5:1 on all SEVEN grounds (the four elevation
		 * steps, `accentWash` and the two row states), and `rowSelected` binds it at
		 * 7.08:1.
		 * The contract's 8 ΔE00 step down to `inkDim` measures
		 * 8.19, and it is what sets the value as much as the floor does.
		 */
		inkMuted: "#C8D0EC",
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
		/*
		 * Register re-solve: `inkDim`
		 * Re-seated a second time, with the band, and lightness is still the only
		 * axis: the floor is 5:1 on all SEVEN grounds (the four elevation
		 * steps, `accentWash` and the two row states), and `rowSelected` binds it at
		 * 5.06:1.
		 * The contract's 8 ΔE00 step up to `inkMuted` measures
		 * 8.19, and it is what sets the value as much as the floor does.
		 */
		inkDim: "#A9B0CD",
		inkDisabled: "#6C7086",

		// Upstream surface1, seated at ΔE00 5.6 from `elevated`: a 1px line needs 4.0, and this
		// one stays between 1.21:1 and 1.51:1 on the four grounds so it divides rather than
		// bounds.
		/*
		 * Register re-solve: `hairline`
		 * The one role whose rule binds at BOTH ends, so it is re-solved against all
		 * four grounds at once: a rule has to be seen (ΔE00 4.0) without becoming a
		 * border (2:1), and the window is walked at the role's own hue. Its ratio
		 * lands at 1.16:1 against `elevated` at its tightest.
		 */
		hairline: "#3F3F5D",
		// Upstream surface1 45475A is 1.54:1 against the lightest ground — a decorative value
		// in a structural role, and the one role a palette is most likely to get wrong.
		// Walked away from the grounds along the same slate to 3.1:1, which is where every
		// shipped palette's structural edge sits.
		/*
		 * Register re-solve: `borderControl`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.01:1. Lightness only, at the role's own
		 * hue.
		 */
		borderControl: "#7D8094",

		accent: "#CBA6F7",
		accentHover: "#DCC1FF",
		accentActive: "#B691E0",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.3
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#E2CCFF",
		tokenCommand: "#8CB7FD",
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
		accentWash: "#303047",
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
		accentAlt: "#739CD6",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 20.82 and C* 15.59, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 6.52 from `accentWash` (the field floor is
		 * 2.0), 4.52:1 for `accentAlt` on it, and 6.52 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#253349",

		success: "#A6E3A1",
		// The scheme has no green tint, so the wash is the green tinted over `canvas` at
		// the strongest alpha (13%) that keeps the green itself at 4.5:1 on it.
		successWash: "#4B5E57",
		/*
		 * Register re-solve: `successBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.07:1. Lightness only, at the role's own
		 * hue.
		 */
		successBorder: "#569052",

		warning: "#FAB387",
		// The peach tinted over `canvas`, same rule as the green above.
		warningWash: "#5D4B4C",
		/*
		 * Register re-solve: `warningBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.03:1. Lightness only, at the role's own
		 * hue.
		 */
		warningBorder: "#B47246",

		danger: "#F38BA8",
		dangerWash: "#332434",
		// The danger hue walked toward the ground to just above the 3:1 the control's
		// only edge is asked for.
		/*
		 * Register re-solve: `dangerBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.03:1. Lightness only, at the role's own
		 * hue.
		 */
		dangerBorder: "#C5627F",

		info: "#8CB7FD",
		infoWash: "#213048",
		/*
		 * Register re-solve: `infoBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.08:1. Lightness only, at the role's own
		 * hue.
		 */
		infoBorder: "#5D83C5",

		// The shadow and scrim are the crust tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
