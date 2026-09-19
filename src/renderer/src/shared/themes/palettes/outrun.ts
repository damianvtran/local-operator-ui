import type { ThemeDefinition } from "../palette-contract";

/**
 * Outrun.
 *
 * Sunset-grid racing: the midnight-blue ground, the grid cyan, the sun yellow
 * and the sunset orange of the canonical quad, on the family's bluest ramp.
 * Its danger is ORANGE rather than red — the canvas has no red at all, which
 * is what keeps it apart from every sibling — and its warning is a true sun
 * yellow, so the two warm states read as a sunset rather than as a warning and
 * an error.
 *
 * Carried from the TUI's `outrun` ThemeSpec: all four grounds, `fg`, `muted`,
 * `success`, `warning`, `danger`, `signal`, `edge`, `edge-hi` and `dim` (lifted,
 * below) verbatim.
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
export const outrun: ThemeDefinition = {
	id: "outrun",
	name: "Outrun",
	description: "Sunset magenta and grid cyan racing over midnight blue.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.81, elevated +7.97, sunken -2.35 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #0D1029 -> #1A1E37 (L* 5.57 -> 12.12)
		 * surface #141834 -> #232543 (L* 9.4 -> 15.93)
		 * elevated #1B2040 -> #262B4B (L* 13.45 -> 18.57)
		 * sunken #080A1E -> #171A2B (L* 3.27 -> 9.76)
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
		canvas: "#1A1E37",
		surface: "#232543",
		elevated: "#262B4B",
		sunken: "#171A2B",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are a
		 * step of THIS palette's own panel at the panel's own hue; they used to be
		 * tints of `accent`, whose hue is more than 45 degrees off the panel on 25 of
		 * the 59 themes - the off-colour the operator reported. The rule, and why the
		 * fill now carries the ranking the 2px `accent` bar used to, are in the two
		 * roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #2C2C3E  panel hue, C* 12.38,
		 *                       the rule's 0.60 x the panel's 21.02; +2.80 L*,
		 *                       ΔE00 5.46 off `surface`, `inkDim` 5.22:1.
		 * rowSelected #2B2D51  panel hue, C* 24.47,
		 *                       the panel's cast + 4.0, floored at 5.0; +4.05 L*,
		 *                       ΔE00 3.23 off `surface` and 6.88 off
		 *                       `rowHover`; the pair ranks 1.25 `L*` and 12.1 `C*`,
		 *                       `inkDim` 5.02:1.
		 */
		rowHover: "#2C2C3E",
		rowSelected: "#2B2D51",

		ink: "#E6E6F2",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.09:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#B6B8D9",
		// The TUI `dim` 7C7FA8 lifted in L* with hue held: 4.11 on `elevated`, under
		// the floor.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.24:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#9A9DC7",
		// The TUI `faint` 454870 lifted to 2.3:1 on `elevated`.
		inkDisabled: "#555780",

		// The TUI `edge` 262C56, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds — both measured before
		// the legibility pass moved this palette's ramp, which is why the value
		// below is a step lifted from it rather than that value itself.
		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 5.11.
		 */
		hairline: "#323762",
		// The TUI `edge-hi` 343B6E lifted in L* until it clears 3:1 on `elevated`.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3.03:1. Lightness only, at the role's own hue.
		 */
		borderControl: "#7175AD",

		// The canonical magenta FF2975 deepened 9 degrees toward crimson with its
		// chroma raised 10%: the shipped Synth theme's accent FF4081 sits ΔE00 2.8
		// from the canonical pink, and a user choosing between two adjacent neon
		// themes has to be able to tell them apart. The result is ΔE00 4.2 from the
		// published magenta and 6.4 from Synth's. The other three canonical colours —
		// grid cyan 2DE2E6, sun yellow F9C80E, sunset orange FF6C11 — are the
		// published values.
		/*
		 * Legibility pass: `accent` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.5:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 83.07 -> 64.8, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		accent: "#FF607B",
		accentHover: "#FF4578",
		// Stepped down only 9 L*: this accent is the family's darkest, so the pressed
		// fill is bounded below by the 4.5:1 its near-black label needs.
		/*
		 * Legibility pass: `accentActive` follows `accent` - the ramp is one control seen
		 * three times and the chart's hover mark has to stay ΔE00 10 clear of the
		 * resting mark, so both move at their own hue rather than letting the accent
		 * pull away from them.
		 */
		accentActive: "#EF0156",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.6 from
		// `accent` and 6.27:1 on `surface`, where the accent measures 4.82:1.
		/*
		 * Legibility pass: `chartBarHover` follows `accent` - the ramp is one control seen
		 * three times and the chart's hover mark has to stay ΔE00 10 clear of the
		 * resting mark, so both move at their own hue rather than letting the accent
		 * pull away from them.
		 * Its chroma comes down with the accent's (C* 61.57 -> 48.6), which is
		 * the same gamut exception: the required `L*` leaves sRGB at the old chroma.
		 */
		chartBarHover: "#FF88A9",
		tokenCommand: "#2DE2E6",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#2C1230",
		onAccent: "#050522",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#a48fff`), received unchanged because it already clears
		 * every floor — ΔE00 32.82 from `accent`, 48.45 from its nearest semantic
		 * (`danger`), 5.61:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#a48fff",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 10.42 and C* 23.91, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 7.23 from `accentWash` (the field floor is
		 * 2.0), 6.41:1 for `accentAlt` on it, and 4.66 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#1D1838",

		success: "#3FE0A0",
		successWash: "#142B38",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.14:1.
		 */
		successBorder: "#3D8575",

		// F9C80E, the sun yellow, and no red in the palette for it to be confused
		// with.
		warning: "#F9C80E",
		warningWash: "#2C2825",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		warningBorder: "#8D7731",

		// FF6C11, the sunset orange: the only danger in this family that is not a red.
		// It clears the 15 ΔE00 separation from the sun yellow by hue, not lightness.
		danger: "#FF6C11",
		dangerWash: "#2C1C26",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		dangerBorder: "#AF6648",

		// 2DE2E6, the TUI's `signal` — the grid the whole theme is racing on.
		info: "#2DE2E6",
		infoWash: "#112B42",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		infoBorder: "#368393",

		overlayShadow: "0 12px 32px -12px rgb(5 6 16 / 0.75)",
		scrim: "rgb(5 6 16 / 0.65)",
	},
};
