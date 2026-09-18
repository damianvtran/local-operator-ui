import type { ThemeDefinition } from "../palette-contract";

/**
 * Ayu Dark.
 *
 * Carried from ayu-theme's `dark` variant: the near-black blue ground, the
 * bright azure accent, and the green, orange, red and violet semantics. Ayu is
 * a family of three — `ayu-mirage.ts` and `ayu-light.ts` are the other two —
 * and all three carry the same accent hue, so a user switching between them
 * sees one scheme change temperature rather than identity.
 *
 * Ayu's ground ladder is upstream's own (bg 0f1419, surface 141821, raised
 * 161a24), reordered onto this contract's four grounds, with `sunken` one step
 * below; its steps measure ΔE00 2.3 against the 2.0 field floor. Roles the
 * scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`.
 *
 * `inkDim` is the one ink that moves: the scheme's dim rung sits a step too
 * close to `inkMuted` for the contract's ΔE00 8 ink step, so the readout rung
 * relaxes away from it rather than the control rung collapsing into `ink`.
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
export const ayuDark: ThemeDefinition = {
	id: "ayuDark",
	name: "Ayu Dark",
	description: "Ayu's night: near-black blue with a bright azure accent.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +4.37, elevated +9.88, sunken -3.41 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #10141C -> #1C2028 (L* 6.27 -> 12.18)
		 * surface #181D27 -> #242934 (L* 10.7 -> 16.55)
		 * elevated #222834 -> #2F3541 (L* 16.03 -> 22.06)
		 * sunken #080A0F -> #18191C (L* 2.74 -> 8.77)
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
		canvas: "#1C2028",
		surface: "#242934",
		elevated: "#2F3541",
		sunken: "#18191C",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 4.85 `L*` lighter (branch L of this port's selection rule), and
		 * carrying 1.48x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `ink-dim` at 5.17:1 on
		 * the row's ground. ΔE00 4.25 from `surface`, 2.63 from `elevated`, 10.97
		 * from `sunken`, 7.14 from `accentWash`; the inks on the ground are 7.23:1,
		 * 7.19:1, 5.17:1. Continuity with the panel: hue 2.5 degrees off the panel's
		 * (the assertion allows 15) and chroma 11.7 where the panel carries 7.9.
		 */
		highlight: "#2C3344",

		/*
		 * Legibility pass: `ink` is re-seated on the lifted grounds, where its floor
		 * is 7:1 on all six grounds and `elevated` binds it at 7.05:1.
		 *
		 * It also carries the transcript's own 8.0:1 on `canvas`, which is the
		 * surface the operator's report is about.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		ink: "#C6C4BC",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.01:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#BAC5CE",
		// the scheme's dim rung, relaxed to clear ΔE00 8 from `inkMuted`.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.04:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#9DA7B2",
		inkDisabled: "#565B66",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 4.08.
		 */
		hairline: "#3B414B",
		// upstream's ui line 2B3038 is 1.11:1 on `elevated` — a ground colour
		// doing a boundary's job. Lifted along the same blue-grey.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3.02:1. Lightness only, at the role's own hue.
		 */
		borderControl: "#727F91",

		// upstream's accent, the family's signature azure.
		accent: "#59C2FF",
		accentHover: "#7DCFFF",
		accentActive: "#09A5FF",
		// ΔE00 10.5 from `accent` and 11.1:1 on surface, where the accent is
		// 8.5:1.
		chartBarHover: "#77DFFF",
		tokenCommand: "#D2A6FF",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#152431",
		onAccent: "#0D1017",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#FF8F40`,
		 * canonical keyword), moved onto the floors: as received it sat ΔE00 12.26
		 * from `warning`. That is paid on HUE — the hue walked 29.7° off the source
		 * and L* 70.37 → 65.32 — because a value that bought the separation by
		 * darkening would be the same hue at another weight. Measured: ΔE00 56.14
		 * from `accent`, 15.04 from its nearest semantic (`warning`), 5.47:1 on the
		 * tightest ground (`surface`).
		 */
		accentAlt: "#C19A02",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 13.49 and C* 10.67, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 18.07 from `accentWash` (the field floor is
		 * 2.0), 5.94:1 for `accentAlt` on it, and 11.20 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#282214",

		success: "#AAD94C",
		successWash: "#181F1F",
		successBorder: "#AAD94C",

		warning: "#FFB454",
		warningWash: "#232120",
		warningBorder: "#FFB454",

		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.5:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		danger: "#F4757C",
		dangerWash: "#221B23",
		dangerBorder: "#F07178",

		info: "#D2A6FF",
		infoWash: "#222232",
		infoBorder: "#D2A6FF",

		overlayShadow: "0 12px 32px -12px rgb(5 6 9 / 0.8)",
		scrim: "rgb(5 6 9 / 0.65)",
	},
};
