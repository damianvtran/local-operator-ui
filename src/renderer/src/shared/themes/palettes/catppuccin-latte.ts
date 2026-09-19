import type { ThemeDefinition } from "../palette-contract";

/**
 * Catppuccin Latte — the light flavour, from catppuccin/palette v1.8.0.
 *
 * Latte is the family's daylight member and its ramp runs the other way: base EFF1F5 is the
 * page, mantle E6E9EF and crust DCE0E8 sit BELOW it, and the two raised grounds are derived
 * above the page at ΔE00 2.2 each, because upstream has nothing there — its own surface0/1/2
 * are darker than base and belong to the recessed side of this system, not the raised one.
 * The page is seated a step below upstream's base (E6E9EF → E4E7EE) so that four rungs remain
 * visible at all above the crust.
 *
 * Text 4C4F69 is `ink` (lifted), subtext1 5C5F77 and subtext0 6C6F85 are the two lower
 * weights, reseated so the control rung and the readout rung clear this contract's ΔE00 8 ink
 * step: the scheme's own tiers sit 6.0 apart and both sit close to the 4.5:1 floor on `sunken`.
 * `inkDisabled` is upstream overlay0.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
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
export const catppuccinLatte: ThemeDefinition = {
	id: "catppuccinLatte",
	name: "Catppuccin Latte",
	description:
		"The light flavour — cool paper under the same Catppuccin pastels.",
	palette: {
		mode: "light",

		// The page is seated where the ladder can hold four rungs: upstream mantle E6E9EF is
		// eased one step down to E4E7EE, because the two raised grounds above base (EFF1F5,
		// which is only ΔE00 3.5 from white) would otherwise collapse into each other.
		// The scheme's own base EFF1F5 moves up to `surface`.
		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A light page ground is capped at L* 94 here, because `elevated`
		 * at L* 100 is the end of sRGB's ramp and the minimum canvas-to-elevated
		 * spread is 2.5 + 2.5 L*.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.5, elevated +6.27, sunken -3.22 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #E4E7EE -> #E4E7EE (L* 91.6 -> 91.6)
		 * surface #EFF1F5 -> #EFF1F5 (L* 95.1 -> 95.1)
		 * elevated #F8F9FA -> #F8F9FA (L* 97.88 -> 97.88)
		 * sunken #DCE0E8 -> #DADEE6 (L* 89.09 -> 88.38)
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
		canvas: "#E4E7EE",
		// Upstream base, the scheme's own page.
		surface: "#EFF1F5",
		// Derived: upstream stops at base, and this system needs a second raised step.
		// ΔE00 2.23 from `surface`, with the chroma shed as it rises because there is no
		// lightness left between the page and white.
		elevated: "#F8F9FA",
		sunken: "#DADEE6",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #F0EAF5  accent hue, C* 6.07, +1.66 L*, ΔE00 5.60 off `surface`,
		 *                       `inkDim` 5.72:1 on the fill, hue 0.39° off `accent`.
		 * rowSelected #EBDEF6  accent hue, C* 13.33, +4.98 L*, ΔE00 11.50 off
		 *                       `surface` and 6.16 off `rowHover`, `inkDim` 5.24:1, and the
		 *                       2px `accent` bar at 4.73:1 against it.
		 */
		rowHover: "#F0EAF5",
		rowSelected: "#EBDEF6",

		// Canonical text 4C4F69 is 6.04:1 on `sunken` — under the 7:1 body floor. Deepened
		// along the same indigo-blue.
		/*
		 * Legibility pass: `ink` is re-seated on the lifted grounds, where its floor
		 * is 7:1 on all six grounds and `sunken` binds it at 7.74:1.
		 *
		 * It also carries the transcript's own 8.0:1 on `canvas`, which is the
		 * surface the operator's report is about.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		ink: "#3B3E57",
		// Canonical subtext1 5C5F77 is 4.73:1 on `sunken` and only ΔE00 6.0 from subtext0,
		// which is under the 8 ink step. Seated deeper along the same slate so the readout
		// rung below it takes a different name.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `sunken` binds it at 7.19:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#404359",
		// Canonical subtext0 6C6F85 is 3.73:1 on `sunken`, well under the 4.5 floor for a
		// readout tone. Deepened along its own slate; still the quietest of the three rungs.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `sunken` binds it at 5:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#585A70",
		inkDisabled: "#9CA0B0",

		// Derived: upstream's own rules are darker tones meant to sit on the page as panels,
		// not as 1px lines. This holds ΔE00 4.2 from every ground and 1.19-1.49:1 against
		// them.
		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `sunken` is the tightest ground at ΔE00 4.29.
		 */
		hairline: "#CACCD5",
		// Upstream surface2 BCC0CC is 1.37:1 against the grounds — a decorative value
		// in a structural role. The structural edge is the muted tone walked to 3.1:1
		// on the darkest ground.
		borderControl: "#7A7E89",

		// Canonical mauve 8839EF is 4.09:1 on `sunken` (< 4.5). Deepened along the same
		// violet.
		accent: "#802EE6",
		accentHover: "#7A22E0",
		accentActive: "#6C16C9",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#6100B8",
		tokenCommand: "#0B55E4",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#E4ECF9",
		// The page tone. The mauve fill is dark enough that the palette's own lightest
		// neutral is the legible ink on it (4.9:1 at the worst of the three states).
		onAccent: "#EFF1F5",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#5265d8`,
		 * canonical lavender #7287fd: 2.81:1 (< 4)), moved onto the floors: as
		 * received it read 3.70:1 as text on all three text grounds (`sunken` is
		 * the tightest); sat under the reduced ΔE00 8 floor from `info`. That is
		 * paid on HUE — the hue walked 35.1° off the source and L* 47.05 → 35.53 —
		 * because a value that bought the separation by darkening would be the same
		 * hue at another weight. Measured: ΔE00 15.07 from `accent`, 27.51 from its
		 * nearest semantic (`danger`), 5.66:1 on the tightest ground (`sunken`).
		 */
		accentAlt: "#911D8B",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 93.16 and C* 7.19, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 9.48 from `accentWash` (the field floor is
		 * 2.0), 6.43:1 for `accentAlt` on it, and 7.63 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#F5E8F2",

		// Upstream's green 40A02B is 2.53:1 on `sunken` — a syntax colour, not UI text. The
		// darkened green the port carried is deepened one step further to clear 4.5 on all
		// four grounds.
		success: "#257113",
		successWash: "#DBE1E4",
		successBorder: "#448E35",

		// Canonical yellow DF8E1D is 1.98:1 on `sunken` — unreadable as text on this page; the
		// port's darkened amber deepened one more step to clear 4.5 on all four grounds.
		warning: "#855A00",
		warningWash: "#E0E0E4",
		warningBorder: "#A3762C",

		// Canonical red D20F39 is 4.10:1 on `sunken` (< 4.5). Deepened along the same red.
		danger: "#C60133",
		dangerWash: "#F6DFE1",
		dangerBorder: "#E93A4F",

		// Canonical blue 1E66F5 is 3.71:1 on `sunken` (< 4.5). Deepened along the same blue.
		info: "#0B55E4",
		infoWash: "#E3ECFB",
		infoBorder: "#3276FF",

		// The shadow and scrim are the ink tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(76 79 105 / 0.22)",
		scrim: "rgb(76 79 105 / 0.35)",
	},
};
