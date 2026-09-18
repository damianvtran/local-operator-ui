import type { ThemeDefinition } from "../palette-contract";

/**
 * Ayu Light.
 *
 * The light end of the Ayu family — `ayu-dark.ts` and `ayu-mirage.ts` are the
 * other two — and the same scheme again: the azure accent, the green, orange,
 * red and violet are Ayu's own, deepened for ink on a white-grey paper rather
 * than hue-shifted. That shared accent row is what makes the three one family,
 * so a user switching between them sees the temperature change and nothing
 * else.
 *
 * The ground ladder is upstream's rungs in this contract's order — its bg fcfcfc
 * as `elevated` — over a blue-tinted paper rather than the near-white itself,
 * which would leave no room for a visible step above `canvas`. Adjacent steps
 * measure ΔE00 2.5 / 3.4 / 7.5. Roles the scheme has no value for follow the
 * derivation rules recorded in `rose-pine.ts`.
 *
 * One note on the inks: adding the fourth ground leaves the scheme's dim rung
 * 0.02 above its 4.5:1 floor, so the contract's ΔE00 8 ink step is bought by
 * pulling `inkMuted` toward `ink` rather than by moving the readout rung.
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
export const ayuLight: ThemeDefinition = {
	id: "ayuLight",
	name: "Ayu Light",
	description: "Ayu's daylight: white-grey paper with a deep azure accent.",
	palette: {
		mode: "light",

		canvas: "#E7EEF5",
		surface: "#F2F8FC",
		elevated: "#FFFFFF",
		sunken: "#DBE4EB",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 5.7 `L*` darker (branch L of this port's selection rule), and
		 * carrying 1.68x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `sunken` at ΔE00 2.07
		 * against its 2.0 field floor. ΔE00 4.19 from `surface`, 7.23 from
		 * `elevated`, 2.07 from `sunken`, 3.01 from `accentWash`; the inks on the
		 * ground are 7.69:1, 6.98:1, 5.47:1. Continuity with the panel: hue 12.98
		 * degrees off the panel's (the assertion allows 12, this palette being one of the measured exceptions `HIGHLIGHT_CONTINUITY_EXCEPTIONS` carries past it, under the 15-degree outer bound) and chroma 4.86 where
		 * the panel carries 2.89.
		 */
		highlight: "#DDE9EE",

		/*
		 * Legibility pass: `ink` is re-seated on the lifted grounds, where its floor
		 * is 7:1 on all six grounds and `accentWash` binds it at 7.08:1.
		 *
		 * It also carries the transcript's own 8.0:1 on `canvas`, which is the
		 * surface the operator's report is about.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		ink: "#42464A",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `accentWash` binds it at 6.43:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#494C4F",
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `accentWash` binds it at 5.04:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#525C6B",
		inkDisabled: "#9AA3AF",

		hairline: "#CBD2D6",
		borderControl: "#758295",

		// the family's azure, deepened for ink on this paper.
		accent: "#125F94",
		accentHover: "#0E4B74",
		accentActive: "#1468A3",
		// ΔE00 10.6 from `accent` and 9.9:1 on surface, where the accent is
		// 6.4:1.
		chartBarHover: "#004073",
		tokenCommand: "#8148B8",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		/*
		 * Legibility pass: the wash is a hover and callout tint, not a selection
		 * ground, and it gains one floor - ΔE00 2.0 against every ground it is painted
		 * on - because it reads 1.00-1.24:1, so no ratio assertion can see it.
		 * `sunken` is the tightest base at ΔE00 2. Lightness only, at the
		 * wash's own hue.
		 */
		accentWash: "#D3E0EA",
		onAccent: "#FFFFFF",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#CD4C00`,
		 * keyword, darkened from canonical #FF7E33 (2.47:1)), moved onto the
		 * floors: as received it read 3.52:1 as text on all three text grounds
		 * (`sunken` is the tightest). The shortfall is paid on LIGHTNESS at the
		 * source hue — L* 49.68 → 42.75 — which is what this port does to every one
		 * of its own tokens. Measured: ΔE00 40.07 from `accent`, 26.53 from its
		 * nearest semantic (`danger`), 4.53:1 on the tightest ground (`sunken`).
		 */
		accentAlt: "#B8139A",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 88.50 and C* 6.81, with the hue moved to
		 * `accentAlt`'s, with the L* walked +1.50 because the chip's own ink floor
		 * binds (`accentAlt` on the wash needs 4.5:1). Measured: ΔE00 12.45 from
		 * `accentWash` (the field floor is 2.0), 4.53:1 for `accentAlt` on it, and
		 * 9.78 from the nearest ground it is painted on.
		 */
		accentAltWash: "#ECDFE8",

		/*
		 * Legibility pass: `success` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.52:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		success: "#516B00",
		successWash: "#DBE4E1",
		successBorder: "#536E00",

		/*
		 * Legibility pass: `warning` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.51:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 51.8 -> 50.71, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		warning: "#855A01",
		warningWash: "#E0E3E3",
		warningBorder: "#895C00",

		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.52:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		danger: "#B23537",
		dangerWash: "#E4E1E8",
		dangerBorder: "#B53838",

		/*
		 * Legibility pass: `info` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.52:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		info: "#7F46B6",
		infoWash: "#DFE1F0",
		infoBorder: "#8149B9",

		overlayShadow: "0 12px 32px -12px rgb(92 97 102 / 0.25)",
		scrim: "rgb(69 73 77 / 0.45)",
	},
};
