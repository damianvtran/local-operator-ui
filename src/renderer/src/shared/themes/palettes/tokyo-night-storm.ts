import type { ThemeDefinition } from "../palette-contract";

/**
 * Tokyo Night Storm — the same scheme as the `tokyoNight` this app already ships, one step
 * lighter, and a sibling to it rather than a second theme.
 *
 * Upstream generates `storm` from `night` by lightening the ground and leaving the hues alone,
 * so the accent 7AA2F7, the hover 9EBCFF, the pressed 6D8FDA and the whole green/yellow/red/
 * cyan row are the SAME values `tokyo-night.ts` carries, and this file exists to move the
 * ground: page 24283B, surface 2B3048 and raised 333955 are upstream's own storm tones, and
 * sunken is the storm background-dark.
 *
 * The ground moving is the whole of the cost. Storm's page is what `night` uses as its
 * `surface`, so every ink here reads against a lighter plane: the readout tone `night` ships
 * measures 4.28:1 on storm's `elevated` — under the 4.5 floor — so `inkDim` is lifted a step,
 * `ink` needed a lift of a thousandth and the red a lift of a step. Each is recorded above its
 * own role.
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
export const tokyoNightStorm: ThemeDefinition = {
	id: "tokyoNightStorm",
	name: "Tokyo Night Storm",
	description:
		"The brighter night — indigo storm skies under the same neon accents.",
	palette: {
		mode: "dark",

		canvas: "#24283B",
		surface: "#2B3048",
		elevated: "#333955",
		sunken: "#1D2032",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 3.55 `L*` lighter (branch L of this port's selection rule), and
		 * carrying 1.38x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `ink-dim` at 5.18:1 on
		 * the row's ground. ΔE00 4.16 from `surface`, 2.16 from `elevated`, 9.33
		 * from `sunken`, 5.2 from `accentWash`; the inks on the ground are 7.93:1,
		 * 7.25:1, 5.18:1. Continuity with the panel: hue 0.56 degrees off the
		 * panel's (the assertion allows 15) and chroma 22.6 where the panel carries
		 * 16.33.
		 */
		highlight: "#2F3759",

		// Upstream fg C0CAF5 is 7.00:1 on `elevated` — exactly the floor, with no room for
		// rounding. Lifted along the same periwinkle.
		/*
		 * Legibility pass: `ink` is re-seated on the lifted grounds, where its floor
		 * is 7:1 on all six grounds and `elevated` binds it at 7.74:1.
		 *
		 * It also carries the transcript's own 8.0:1 on `canvas`, which is the
		 * surface the operator's report is about.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		ink: "#CAD4FF",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.07:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#C1CBF5",
		// The sibling's `inkDim` measures 4.28:1 on storm's lighter `elevated` — under the 4.5
		// floor. Lifted along the same comment blue.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.16:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#A1ACD5",
		inkDisabled: "#565F89",

		// The sibling's rule lightened by the same step the ground took, so it still holds
		// ΔE00 4.3 from every ground and 1.22-1.74:1 against them.
		hairline: "#3F4662",
		// Upstream fg_gutter 3B4261 is 1.36:1 against the grounds — a decorative value
		// in a structural role. Walked to 3.1:1 on the lightest ground, the value every
		// shipped palette's structural edge sits at.
		borderControl: "#7B84AB",

		/*
		 * Legibility pass: `accent` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.5:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		accent: "#7BA2F8",
		accentHover: "#9EBCFF",
		accentActive: "#6D8FDA",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#AAC6FF",
		tokenCommand: "#7DCFFF",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#283349",
		onAccent: "#1D2032",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#bb9af7`, canonical magenta), received unchanged because
		 * it already clears every floor — ΔE00 15.86 from `accent`, 26.91 from its
		 * nearest semantic (`danger`), 5.61:1 as text on the tightest ground
		 * (`surface`).
		 */
		accentAlt: "#bb9af7",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 21.21 and C* 15.22, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 8.81 from `accentWash` (the field floor is
		 * 2.0), 5.49:1 for `accentAlt` on it, and 5.76 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#372F45",

		success: "#9ECE6A",
		successWash: "#40504B",
		successBorder: "#65922C",

		warning: "#E0AF68",
		warningWash: "#4C4649",
		warningBorder: "#AB7D34",

		// Upstream red F7768E is 4.27:1 on `elevated` (< 4.5) — the one content value storm's
		// lighter ground pushes under the floor. Lifted along the same rose.
		danger: "#FE7C94",
		dangerWash: "#3A2C3D",
		dangerBorder: "#D95B74",

		info: "#7DCFFF",
		infoWash: "#263A52",
		infoBorder: "#398DBA",

		// The shadow and scrim are the ground tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
