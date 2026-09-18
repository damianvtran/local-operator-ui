import type { ThemeDefinition } from "../palette-contract";

/**
 * Rosé Pine Dawn.
 *
 * The daytime half of Rosé Pine, and the reason this scheme is worth porting at
 * all: it is the variant a user picks so that Rosé Pine looks the same at noon
 * as it does at midnight. Preserving that means the accent row stays the
 * scheme's own — rose, pine, gold, love, foam — and only its lightness moves,
 * which is what most of this file is about.
 *
 * ## What the four grounds cost
 *
 * Rosé Pine Dawn defines three grounds and this contract needs four, each
 * measured against every ink. Upstream's ladder (base faf4ed, surface fffaf3,
 * overlay f2e9e1, highlight-med dfdad9) cannot supply them: base-to-surface is
 * ΔE00 1.3 and surface-to-elevated 1.8, under the 2.0 at which the captured
 * theme frames show a card reading as a separate surface from its canvas, and
 * its top is already a shade off white with nothing above it.
 *
 * Deepening in lightness alone is not available either, because every ink in
 * this scheme is a soft one — text 4e4970 is 7.7:1 on upstream's base, not the
 * 13:1 a modern dark ink gets — so each step down costs a floor. So the ladder
 * is re-solved at the brand light pair's own proportions and keeps `canvas`
 * within ΔE00 0.7 of upstream's base: the top sheet goes to near-white, and the
 * three steps below it are spaced by a single step each. Adjacent steps measure
 * ΔE00 2.14 / 2.27, and the deepest ground 6.34 from the top.
 *
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`. `info` is the one value that moves for a second reason: foam
 * 56949f arrives at 3.1:1 on this paper, and once lifted to the floor it
 * measured ΔE00 13.7 from pine — under the 15 the contract wants between two
 * semantics a reader meets alone and has to name. It is pulled toward its green
 * end to 10746E, which holds 15.6.
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
export const rosePineDawn: ThemeDefinition = {
	id: "rosePineDawn",
	name: "Rosé Pine Dawn",
	description: "Rosé Pine by daylight: warm rose paper with pine and gold ink.",
	palette: {
		mode: "light",

		canvas: "#f3ece5",
		surface: "#f9f4f0",
		elevated: "#fdfcfa",
		sunken: "#f2e7da",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.12 toward `accent`, then stepped 2.11 on the `L*`
		 * axis — branch H of this port's selection rule — and this palette's OWN ink is
		 * what put it there: the ink floor on the row's ground caps the lightness route
		 * at 2.75 `L*` here (inkDim reaches its floor with the 0.15 of
		 * headroom at 4.67:1 on this ground), so the band is paid on the cast.
		 * ΔE00 4.09 from `surface`, 6.3 from `elevated` and 4.64 from
		 * `sunken`; the step is 2.11 `L*` in that direction, short of the 3 `L*` floor, and is pinned in
		 * `scripts/contrast-contract.mjs` with that ink number rather than dropped.
		 */
		highlight: "#FDEFEA",

		/*
		 * Legibility pass: `ink` is re-seated on the lifted grounds, where its floor
		 * is 7:1 on all six grounds and `sunken` binds it at 7.69:1.
		 *
		 * It also carries the transcript's own 8.0:1 on `canvas`, which is the
		 * surface the operator's report is about.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		ink: "#464268",
		inkMuted: "#544e6c",
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
		inkDim: "#636071",
		inkDisabled: "#9893a5",

		hairline: "#e1d8d1",
		borderControl: "#8f828a",

		accent: "#9e5350",
		accentHover: "#8b4644",
		accentActive: "#743a38",
		// ΔE00 10.4 from `accent` and 7.8:1 on surface, where the accent is
		// 5.0:1 — the step goes deeper here, because on paper the plot ground is
		// above the mark.
		chartBarHover: "#7e3635",
		tokenCommand: "#10746E",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#fbece8",
		onAccent: "#fffaf3",

		// pine, canonical.
		success: "#286983",
		successWash: "#e4edf1",
		successBorder: "#5c8ba0",

		warning: "#975b00",
		warningWash: "#f6ead6",
		warningBorder: "#a47f41",

		danger: "#9f5069",
		dangerWash: "#fcebef",
		dangerBorder: "#ac7687",

		// foam 56949f measures 3.1:1 on this paper; lifted to the floor and
		// pulled green to clear ΔE00 15 from pine. See the header.
		info: "#10746E",
		infoWash: "#e2eeef",
		infoBorder: "#538f92",

		overlayShadow: "0 12px 32px -12px rgb(87 82 121 / 0.24)",
		scrim: "rgb(87 82 121 / 0.4)",
	},
};
