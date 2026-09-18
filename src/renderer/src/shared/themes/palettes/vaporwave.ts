import type { ThemeDefinition } from "../palette-contract";

/**
 * Vaporwave.
 *
 * Mall at closing time. The ground family is synthwave's purple, but every
 * state hue is pulled toward chalk — dusty pink accent, washed teal, sherbet
 * amber, soft coral — so the theme reads soft-focus exactly where synthwave
 * reads laser-sharp. It is the only member of this family with no fully
 * saturated colour anywhere, and that restraint is the aesthetic rather than a
 * compromise: the pastels start bright enough that no contrast floor forced
 * any of them down.
 *
 * Carried from the TUI's `vaporwave` ThemeSpec: all four grounds, `fg`, `muted`,
 * `accent`, `success`, `warning`, `danger`, `dim`, `edge`, `edge-hi`; the
 * informational hue is the TUI's `signal`, moved by 18 degrees, below.
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
export const vaporwave: ThemeDefinition = {
	id: "vaporwave",
	name: "Vaporwave",
	description: "Dusty pink and faded teal pastels on deep mall-purple.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.68, elevated +7.61, sunken -3.3 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #1F1730 -> #241B35 (L* 9.93 -> 12.06)
		 * surface #271E3B -> #2C2240 (L* 13.68 -> 15.75)
		 * elevated #2F2547 -> #342A4C (L* 17.38 -> 19.67)
		 * sunken #181128 -> #1C152D (L* 6.76 -> 8.76)
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
		canvas: "#241B35",
		surface: "#2C2240",
		elevated: "#342A4C",
		sunken: "#1C152D",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.17 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 3.25 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.26 from `surface`, 3.76 from `elevated` and 8.12 from `sunken`;
		 * the step is 3.35 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.66:1 the ink that binds it.
		 */
		highlight: "#362241",

		ink: "#EDE8F2",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `accentWash` binds it at 6.87:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#C4B6D8",
		// The TUI `dim` 9184AE lifted in L* with hue held: 4.14 on `elevated`, under
		// the floor.
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
		inkDim: "#A89AC5",
		// The TUI `faint` 5A4E74 lifted to 2.3:1 on `elevated`.
		inkDisabled: "#685B82",

		// The TUI `edge` 3C3158, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds — both measured before
		// the legibility pass moved this palette's ramp, which is why the value
		// below is a step lifted from it rather than that value itself.
		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 4.11.
		 */
		hairline: "#40355D",
		// The TUI `edge-hi` 4C3F6C lifted in L* until it clears 3:1 on `elevated`.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3:1. Lightness only, at the role's own hue.
		 */
		borderControl: "#8070A1",

		accent: "#F7A8D8",
		accentHover: "#FFC1F2",
		accentActive: "#D488B7",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.6 from
		// `accent` and 10.96:1 on `surface`, where the accent measures 8.65:1.
		chartBarHover: "#F1CDE7",
		tokenCommand: "#7BD7E3",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#3B2A46",
		onAccent: "#150824",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#c5a3f0`),
		 * moved onto the floors: as received it sat ΔE00 13.99 from `accent`. That
		 * is paid on HUE — the hue walked 14.9° off the source and L* 72.47 → 71.92
		 * — because a value that bought the separation by darkening would be the
		 * same hue at another weight. Measured: ΔE00 21.44 from `accent`, 31.64
		 * from its nearest semantic (`danger`), 6.89:1 on the tightest ground
		 * (`surface`).
		 */
		accentAlt: "#A8A9F9",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 20.16 and C* 20.30, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 6.86 from `accentWash` (the field floor is
		 * 2.0), 6.04:1 for `accentAlt` on it, and 4.22 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#2D2E4C",

		success: "#8FE6C0",
		successWash: "#2E3243",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.01:1.
		 */
		successBorder: "#5A7F7B",

		warning: "#F0CD8A",
		warningWash: "#3A2F3C",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.03:1.
		 */
		warningBorder: "#897562",

		danger: "#F2808A",
		dangerWash: "#3A253C",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		dangerBorder: "#A26779",

		// The TUI `signal` 7FD8D4 rotated 18 degrees toward blue: the pastel mint
		// success and this teal sat ΔE00 11.7 apart, under the contract's 15 semantic
		// separation floor, and one of the two had to move. A slightly bluer aqua
		// keeps the template sunset's faded-teal identity and cannot be confused with
		// a mint.
		info: "#7BD7E3",
		infoWash: "#2B3047",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.01:1.
		 */
		infoBorder: "#587D91",

		overlayShadow: "0 12px 32px -12px rgb(12 9 19 / 0.75)",
		scrim: "rgb(12 9 19 / 0.65)",
	},
};
