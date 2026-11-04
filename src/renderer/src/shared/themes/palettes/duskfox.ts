import type { ThemeDefinition } from "../palette-contract";

/**
 * Duskfox.
 *
 * Carried from EdenEast/nightfox's `duskfox` variant, and deliberately a
 * sibling of `nightfox.ts`: the same accent, green, yellow, red and cyan hues
 * over a ground warmed into violet. A user picking between the two is choosing
 * a temperature, not a scheme, so the accent row is the same one.
 *
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`; the ground ladder takes the same proportions as Nightfox's,
 * for the same reason — four grounds, each a visible step from the next.
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
export const duskfox: ThemeDefinition = {
	id: "duskfox",
	name: "Duskfox",
	descriptionKey: "ui.settings.appearance.theme.duskfox",
	palette: {
		mode: "dark",

		/*
		 * THE DARKER-GROUNDS PASS (2026-11-03, `docs/branding.md` § 2) supersedes the
		 * earlier L* 12 dark floor: the dark band is now L* 9-15 (target 9-13), and
		 * the canvas maps by `L*_new = 9 + 0.6 x (L*_old - 12)`, which keeps this
		 * palette's place in the fleet. Here every ground-class role (the grounds, the
		 * row states, the two fills, the washes and the hairlines) moved by the
		 * canvas's own ΔL* holding its `a` and `b`; inks, accents and `borderControl` did
		 * not move.
		 * Measured:
		 * canvas #232136 -> #1B192E (L* 13.89 -> 10.00)
		 * surface #2D2A45 -> #25223C (L* 18.56 -> 14.75)
		 * elevated #373354 -> #2F2B4B (L* 23.07 -> 19.39)
		 * sunken #191726 -> #120F1F (L* 8.65 -> 5.14)
		 * accent #72AFC6 -> #569FBA: the scheme's own `blue` (#569fba,
		 * EdenEast/nightfox duskfox palette): C* 22.5 -> 25.8.
		 * `accentActive` steps 5 L* below the new accent on the same cast, so the
		 * press stays ΔE00 >= 2 from rest.
		 */
		canvas: "#1B192E",
		surface: "#25223C",
		elevated: "#2F2B4B",
		sunken: "#120F1F",

		// The user block's fill: ΔE00 4.06 off the canvas, where `surface` alone
		// measures 3.80 - a step toward `elevated` to clear the role's 4.0 floor,
		// which the block carries because the fill IS its boundary.
		messageSurface: "#26233e",
		// The media slot's well: `sunken` itself, which already clears the
		// role's floor off this canvas (measured ΔE00 4.14, 5.24 L*).
		mediaSurface: "#120F1F",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are a
		 * step of THIS palette's own panel at the panel's own hue; they used to be
		 * tints of `accent`, whose hue is more than 45 degrees off the panel on 25 of
		 * the 59 themes - the off-colour the operator reported. The rule, and why the
		 * fill now carries the ranking the 2px `accent` bar used to, are in the two
		 * roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #353243  panel hue, C* 11.55,
		 *                       the rule's 0.60 x the panel's 18.65; +3.18 L*,
		 *                       ΔE00 4.98 off `surface`, `inkDim` 5.67:1.
		 * rowSelected #383456  panel hue, C* 22.71,
		 *                       the panel's cast + 4.0, floored at 5.0; +5.01 L*,
		 *                       ΔE00 4.13 off `surface` and 6.75 off
		 *                       `rowHover`; the pair ranks 1.83 `L*` and 11.2 `C*`,
		 *                       `inkDim` 5.33:1.
		 */
		rowHover: "#2D2A3B",
		rowSelected: "#302C4D",

		ink: "#E0DEF4",
		inkMuted: "#CDCBE0",
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.15:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#B1ABCC",
		inkDisabled: "#6E6A86",

		hairline: "#3E3754",

		// `hairline` stepped toward `inkDim`, so it reads on this palette's own

		// `sunken`: 1.93:1 there against `hairline`'s 1.78:1.

		hairlineStrong: "#423B59",
		borderControl: "#887BA3",

		// the scheme's teal-blue accent, shared with Nightfox.
		accent: "#569FBA",
		accentHover: "#8BBDD0",
		accentActive: "#4892AC",
		// ΔE00 10.5 from `accent` and 8.7:1 on surface, where the accent is
		// 5.7:1.
		chartBarHover: "#98D7EE",
		tokenCommand: "#9CCFD8",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#262D42",
		onAccent: "#191726",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#C4A7E7`, iris), received unchanged because it already
		 * clears every floor — ΔE00 24.61 from `accent`, 21.37 from its nearest
		 * semantic (`danger`), 6.56:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#C4A7E7",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 22.38 and C* 14.22, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 7.54 from `accentWash` (the field floor is
		 * 2.0), 5.79:1 for `accentAlt` on it, and 4.71 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#332A3E",

		success: "#A3BE8C",
		successWash: "#292A37",
		successBorder: "#A3BE8C",

		warning: "#F6C177",
		warningWash: "#302934",
		warningBorder: "#F6C177",

		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `highlight` binds it there at
		 * 4.5:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		danger: "#F2809F",
		dangerWash: "#34243B",
		dangerBorder: "#ED7C9C",

		info: "#9CCFD8",
		infoWash: "#2A2E41",
		infoBorder: "#9CCFD8",

		overlayShadow: "0 12px 32px -12px rgb(14 12 22 / 0.75)",
		scrim: "rgb(14 12 22 / 0.62)",
	},
};
