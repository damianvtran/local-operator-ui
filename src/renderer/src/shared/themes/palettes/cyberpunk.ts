import type { ThemeDefinition } from "../palette-contract";

/**
 * Cyberpunk.
 *
 * Night City, and the only theme in this family whose accent is a YELLOW — the
 * 2077 marketing trio lands intact: construction yellow as the primary, glare
 * cyan as the signal, and the logo red as danger, on a violet-black ground no
 * sibling shares (Matrix's black is green, Outrun's is blue). Selection tints
 * are yellow-cast rather than the usual green or blue, because in this theme
 * yellow is the brand's "pay attention" colour.
 *
 * Carried from the TUI's `cyberpunk` ThemeSpec: all four grounds, `fg`, `muted`,
 * `accent`, `success`, `warning`, `signal`, `edge`, `edge-hi`; `danger` and `dim`
 * moved for the floors, below.
 *
 * Derived, by one rule each, the same across this family: `accentHover`
 * +9 L* and `accentActive` -12 L* on the accent (the pressed step floored
 * where `onAccent` still clears 4.5:1 on it, and where the fill still has a
 * 3:1 edge on `elevated`); `chartBarHover` mixed toward `ink` until it is ΔE00
 * 10.5 from `accent`, then lifted further if that landed closer to `surface`
 * than the accent does; `accentWash` the accent at 13% over `canvas`;
 * `onAccent` the canvas at 42% of its L*, hue held; every semantic wash its hue
 * at 13% over `canvas` and every semantic border its hue at 45%, lifted in L*
 * until it clears 3:1 on `elevated`, the lightest ground it is drawn on;
 * `inkDisabled` the TUI `faint` lifted to 2.3:1 on `elevated` (the one role
 * with no floor, kept a colour rather than a hole); `borderControl` the TUI
 * `edge-hi` lifted to 3:1 on `elevated`; the shadow and scrim `canvas` at 40%,
 * so they carry this palette's cast rather than neutral black.
 *
 * `accentAlt`, from the same change, is this family's own `label` token — the one
 * non-neutral hue the port dropped — taken unchanged where it already clears the
 * floors and otherwise walked off its own hue, which each palette's note below
 * says by how much; `accentAltWash` is that hue carrying `accentWash`'s own `L*`
 * and `C*`, which is what "the same treatment" means once the two hues have
 * different chroma available at that lightness. Both roles are decorative: no
 * interaction, no selection ground and no semantic may take them — the divider
 * is in `palette-contract.ts` and `docs/branding.md` § 2.
 *
 * The TUI's `overlay`, `string` and five `tint-*` tokens have no role here: this
 * contract has no popover ground and no selection tint, so the tints above are
 * derived from the accent instead. Its `label` token is the one that does land,
 * as `accentAlt` above.
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
export const cyberpunk: ThemeDefinition = {
	id: "cyberpunk",
	name: "Cyberpunk",
	description:
		"Construction yellow and glare cyan over violet-black Night City.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +2.53, elevated +6.28, sunken -1.72 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #0E0A16 -> #211F28 (L* 3.33 -> 12.33)
		 * surface #16101F -> #282332 (L* 5.78 -> 14.86)
		 * elevated #1E172A -> #312A3E (L* 9.45 -> 18.61)
		 * sunken #080510 -> #1D1C22 (L* 1.78 -> 10.61)
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
		canvas: "#211F28",
		surface: "#282332",
		elevated: "#312A3E",
		sunken: "#1D1C22",
		/*
		 * The current row's own ground, and the one palette class this pass pins:
		 * `surface` stepped 2.9 `L*` lighter at the panel's own hue, under the 3
		 * `L*` the direction floor asks for, because this palette's own inks cap the
		 * lightness route at 3 `L*`. The band is paid on the cast at 1.20x the
		 * panel's chroma, which is the shape `HIGHLIGHT_STEP_PINS` records for it.
		 * What binds this one is `ink-dim` at 5.15:1 on the row's ground. ΔE00 4.24
		 * from `surface`, 3.05 from `elevated`, 9.77 from `sunken`, 23.49 from
		 * `accentWash`; the inks on the ground are 11.38:1, 6.92:1, 5.15:1.
		 * Continuity with the panel: hue 14.28 degrees off the panel's (the
		 * assertion allows 15) and chroma 13.12 where the panel carries 10.9.
		 */
		highlight: "#342738",

		ink: "#EAE5F2",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 6.74:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#BCB1CF",
		// The TUI `dim` 82749C lifted in L* with hue held: 4.37 on `surface` and 4.07
		// on `elevated`, both under the floor.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.02:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#A496BF",
		// The TUI `faint` 4A4060 lifted to 2.3:1 on `elevated`.
		inkDisabled: "#5A4F70",

		// The TUI `edge` 2E2340, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds — both measured before
		// the legibility pass moved this palette's ramp, which is why the value
		// below is a step lifted from it rather than that value itself.
		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 5.06.
		 */
		hairline: "#3D3250",
		// The TUI `edge-hi` 3D2F54 lifted in L* until it clears 3:1 on `elevated`.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3.02:1. Lightness only, at the role's own hue.
		 */
		borderControl: "#7F6F97",

		// FCEE0A, the construction yellow — this palette's accent, and the reason it
		// is unmistakable among its siblings.
		accent: "#FCEE0A",
		// The yellow stepped up until it clips in sRGB, which is what a yellow this
		// light does: the hovered button reads as the same yellow, brighter.
		accentHover: "#FFFF34",
		accentActive: "#D7CC00",
		// Mixed toward `ink` to ΔE00 10.6 from `accent` and then lifted in L*, because
		// a yellow at this lightness has no brighter step left: the hovered mark reads
		// as the bars' own hue washed toward white, and still sits further from
		// `surface` (15.86:1) than the accent does (15.40:1).
		chartBarHover: "#F8EF8F",
		tokenCommand: "#00F0FF",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#2D2814",
		onAccent: "#070312",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#b98aff`), received unchanged because it already clears
		 * every floor — ΔE00 75.63 from `accent`, 35.07 from its nearest semantic
		 * (`danger`), 5.91:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#b98aff",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 16.14 and C* 14.02, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 24.49 from `accentWash` (the field floor is
		 * 2.0), 5.73:1 for `accentAlt` on it, and 2.01 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#2D2438",

		success: "#3FE07A",
		successWash: "#142623",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		successBorder: "#3E835A",

		warning: "#FF9E3D",
		warningWash: "#2D1D1B",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		warningBorder: "#9C6B44",

		// FF003C lifted in L* with hue held (ΔE00 1.8 from the TUI's value) to clear
		// 4.5:1 as text on `elevated`; on the canvas it is the 4.95:1 the TUI
		// measured.
		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.52:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 87.09 -> 70.01, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		danger: "#FF5B60",
		dangerWash: "#2D0D1C",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		dangerBorder: "#BD545F",

		// 00F0FF, the TUI's `signal` — the glare cyan the marketing artwork pairs with
		// the yellow.
		info: "#00F0FF",
		infoWash: "#0C2834",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.01:1.
		 */
		infoBorder: "#24818E",

		overlayShadow: "0 12px 32px -12px rgb(6 4 9 / 0.75)",
		scrim: "rgb(6 4 9 / 0.65)",
	},
};
