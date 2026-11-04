import type { ThemeDefinition } from "../palette-contract";

/**
 * Palenight.
 *
 * Carried from Material Palenight — the Material Theme's blue-violet night:
 * the navy ground, the soft violet accent, and the scheme's green, orange, red
 * and cyan.
 *
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`. Three values need more than those rules, and each is the
 * reason recorded beside it:
 *
 * - `danger` is upstream's own red f07178, lifted. At the lifted pink the port
 *   first carried it sat ΔE00 12.2 from the scheme's orange, under the 15 the
 *   contract wants between two semantics a reader meets alone and has to name.
 * - `onAccent` is the page ground stepped darker. Palenight's accent ramp runs
 *   from C792EA to D9B4F1 — all of it far LIGHTER than the ground — so unlike
 *   every other dark palette here, the label on a contained button cannot be
 *   the canvas colour and still clear 4.5:1 on the fill.
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
export const palenight: ThemeDefinition = {
	id: "palenight",
	name: "Palenight",
	descriptionKey: "ui.settings.appearance.theme.palenight",
	palette: {
		mode: "dark",

		/*
		 * THE DARKER-GROUNDS PASS (2026-11-03, `docs/branding.md` § 2) supersedes the
		 * earlier L* 12 dark floor: the dark band is now L* 9-15 (target 9-13), and
		 * the canvas maps by `L*_new = 9 + 0.6 x (L*_old - 12)`, a map that preserves
		 * the fleet's order (re-solves may move a canvas off it, up to +-1.04 L*).
		 * Here every ground-class role (the grounds, the row states, the two fills,
		 * the washes and the hairlines) moved by the canvas's own ΔL* holding its `a`
		 * and `b`; inks, accents and `borderControl` did not move.
		 * Measured:
		 * canvas #292D3E -> #1D2132 (L* 18.78 -> 13.10)
		 * surface #2F3446 -> #23283A (L* 21.95 -> 16.41)
		 * elevated #353B4E -> #272E40 (L* 25.06 -> 19.04)
		 * sunken #232736 -> #171B2A (L* 15.87 -> 10.05)
		 * Re-solved off the uniform shift, because a contract floor refused it there:
		 * `accentWash`. `pnpm check-themes` is the measurement for each.
		 */
		canvas: "#1D2132",
		surface: "#23283A",
		elevated: "#272E40",
		sunken: "#171B2A",

		// The user block's fill: ΔE00 4.21 off the canvas, where `surface` alone
		// measures 2.26 - a step toward `elevated` to clear the role's 4.0 floor,
		// which the block carries because the fill IS its boundary.
		messageSurface: "#282e40",
		// The media slot's well: ΔE00 4.01 off the canvas, where `sunken` alone
		// measures 2.13 - a step away from the canvas to clear the role's 4.0
		// floor, which the tile carries because the fill IS its resting extent.
		mediaSurface: "#111522",
		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are a
		 * step of THIS palette's own panel at the panel's own hue; they used to be
		 * tints of `accent`, whose hue is more than 45 degrees off the panel on 25 of
		 * the 59 themes - the off-colour the operator reported. The rule, and why the
		 * fill now carries the ranking the 2px `accent` bar used to, are in the two
		 * roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #363843  panel hue, C* 7.34,
		 *                       the rule's 0.60 x the panel's 12.19; +1.78 L*,
		 *                       ΔE00 3.66 off `surface`, `inkDim` 5.24:1.
		 * rowSelected #333A53  panel hue, C* 16.60,
		 *                       the panel's cast + 4.0, floored at 5.0; +2.86 L*,
		 *                       ΔE00 3.43 off `surface` and 6.20 off
		 *                       `rowHover`; the pair ranks 1.08 `L*` and 9.3 `C*`,
		 *                       `inkDim` 5.06:1.
		 */
		rowHover: "#2A2C37",
		rowSelected: "#272E46",

		ink: "#EEFFFF",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 6.87:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#C3CAEB",
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.01:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#A8ADC6",
		inkDisabled: "#676E95",

		hairline: "#363A4E",

		// `hairline` stepped toward `inkDim`, so it reads on this palette's own

		// `sunken`: 1.75:1 there against `hairline`'s 1.62:1.

		hairlineStrong: "#3B3F53",
		borderControl: "#8287A8",

		accent: "#C792EA",
		accentHover: "#D9B4F1",
		accentActive: "#B874E4",
		// ΔE00 10.4 from `accent` and 7.6:1 on surface, where the accent is
		// 5.1:1.
		chartBarHover: "#EEB8FF",
		tokenCommand: "#89DDFF",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#20243A",
		onAccent: "#252939",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#82aaff`, canonical blue), received unchanged because it
		 * already clears every floor — ΔE00 20.98 from `accent`, 37.54 from its
		 * nearest semantic (`danger`), 5.38:1 as text on the tightest ground
		 * (`surface`).
		 */
		accentAlt: "#82aaff",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 20.94 and C* 13.54, with the hue moved to
		 * `accentAlt`'s, with the L* walked -4.00 because the chip's own ink floor
		 * binds (`accentAlt` on the wash needs 4.5:1). Measured: ΔE00 3.60 from
		 * `accentWash` (the field floor is 2.0), 6.29:1 for `accentAlt` on it, and
		 * 2.11 from the nearest ground it is painted on.
		 */
		accentAltWash: "#161D30",

		success: "#C3E88D",
		successWash: "#212634",
		successBorder: "#AADF5E",

		warning: "#F78C6C",
		warningWash: "#242434",
		warningBorder: "#F5724B",

		// upstream's red, lifted; see the header.
		danger: "#FF7E96",
		dangerWash: "#242435",
		dangerBorder: "#FF7E96",

		info: "#89DDFF",
		infoWash: "#202739",
		infoBorder: "#50CCFF",

		overlayShadow: "0 12px 32px -12px rgb(32 35 49 / 0.65)",
		scrim: "rgb(32 35 49 / 0.6)",
	},
};
