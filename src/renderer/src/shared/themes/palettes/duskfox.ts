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
	description: "Nordfox at dusk: the same slate warmed into violet plum.",
	palette: {
		mode: "dark",

		canvas: "#232136",
		surface: "#2D2A45",
		elevated: "#373354",
		sunken: "#191726",

		/*
		 * The current row's own ground:
		 * `surface` stepped 6 on the `L*` axis in the mode's direction — the
		 * neutral step, branch L of this port's selection rule; the ramp affords it here,
		 * so the row takes no cast. ΔE00 4.26 from `surface`, 2.18 from
		 * `elevated` and 11.64 from `sunken`; the step is 6.04 `L*`, and the band
		 * this branch raised to ΔE00 4.0 is met without a cast.
		 */
		highlight: "#3B3753",

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

		hairline: "#463F5C",
		borderControl: "#887BA3",

		// the scheme's teal-blue accent, shared with Nightfox.
		accent: "#72AFC6",
		accentHover: "#8BBDD0",
		accentActive: "#68A9C2",
		// ΔE00 10.5 from `accent` and 8.7:1 on surface, where the accent is
		// 5.7:1.
		chartBarHover: "#98D7EE",
		tokenCommand: "#9CCFD8",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#2E354A",
		onAccent: "#191726",

		success: "#A3BE8C",
		successWash: "#31323F",
		successBorder: "#A3BE8C",

		warning: "#F6C177",
		warningWash: "#38313C",
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
		dangerWash: "#3C2C43",
		dangerBorder: "#ED7C9C",

		info: "#9CCFD8",
		infoWash: "#323649",
		infoBorder: "#9CCFD8",

		overlayShadow: "0 12px 32px -12px rgb(14 12 22 / 0.75)",
		scrim: "rgb(14 12 22 / 0.62)",
	},
};
