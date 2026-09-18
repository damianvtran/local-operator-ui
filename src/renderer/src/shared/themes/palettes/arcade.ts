import type { ThemeDefinition } from "../palette-contract";

/**
 * Arcade.
 *
 * A CRT cabinet. The ground is near-neutral black glass — the one ground here
 * with no real cast, because an arcade monitor that is off is glass-grey — and
 * the states are candy primaries, one per meaning: marquee yellow as the
 * accent, 1-up green, bonus-round orange, hit-flash red, ice-level blue,
 * power-up violet. Each state is its own primary so nothing collapses into
 * anything else, and the ink is a warm bone white like a lit dot-matrix score.
 * Where Night City's yellow accent buys a dark violet ground, this one buys a
 * neutral one.
 *
 * Carried from the TUI's `arcade` ThemeSpec: `bg`, `surface`, `raised`, `fg`,
 * `muted`, `dim`, `accent`, `success`, `warning`, `danger`, `signal`, `edge` and
 * `edge-hi`; only `sunken` moved, below.
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
export const arcade: ThemeDefinition = {
	id: "arcade",
	name: "Arcade",
	description: "Candy RGB game states glowing on black CRT glass.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.46, elevated +8.18, sunken -3.02 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #0A0A0C -> #202021 (L* 2.78 -> 12.29)
		 * surface #141417 -> #27272A (L* 6.42 -> 15.75)
		 * elevated #1D1D21 -> #2D2D31 (L* 10.92 -> 18.61)
		 * sunken #010102 -> #1A1A1A (L* 0.29 -> 9.26)
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
		canvas: "#202021",
		surface: "#27272A",
		elevated: "#2D2D31",
		// The TUI's 050506 darkened one step to clear the four-ground separation
		// floor: against `canvas` it measured 1.030:1, sitting exactly on the
		// contract's 1.03.
		sunken: "#1A1A1A",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #2E2A23  accent hue, C* 5.25, +1.52 L*, ΔE00 6.78 off `surface`,
		 *                       `inkDim` 5.51:1 on the fill, hue 2.42° off `accent`.
		 * rowSelected #3C300E  accent hue, C* 23.04, +4.72 L*, ΔE00 17.83 off
		 *                       `surface` and 11.09 off `rowHover`, `inkDim` 5.00:1, and the
		 *                       2px `accent` bar at 8.97:1 against it.
		 */
		rowHover: "#2E2A23",
		rowSelected: "#3C300E",

		ink: "#E8E8E4",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.35:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#BEBEB9",
		// The TUI `dim` 7C7C7A lifted in L* with hue held: 4.40 on `surface` and 4.02
		// on `elevated`, both under the floor.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.29:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#A1A19E",
		// The TUI `faint` 44444A lifted to 2.3:1 on `elevated`.
		inkDisabled: "#56565C",

		// The TUI `edge` 2A2A30, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds — both measured before
		// the legibility pass moved this palette's ramp, which is why the value
		// below is a step lifted from it rather than that value itself.
		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 5.20.
		 */
		hairline: "#3C3C43",
		// The TUI `edge-hi` 3A3A42 lifted in L* until it clears 3:1 on `elevated`.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3:1. Lightness only, at the role's own hue.
		 */
		borderControl: "#797981",

		// FFD23F, the marquee yellow — this palette's "insert coin" colour.
		accent: "#FFD23F",
		accentHover: "#FFEB59",
		accentActive: "#DAB113",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.6 from
		// `accent` and 13.64:1 on `surface`, where the accent measures 12.73:1.
		chartBarHover: "#F3DD94",
		tokenCommand: "#52B4FF",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#2A2413",
		onAccent: "#040406",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#c792ff`), received unchanged because it already clears
		 * every floor — ΔE00 64.90 from `accent`, 34.98 from its nearest semantic
		 * (`danger`), 6.37:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#c792ff",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 14.41 and C* 12.34, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 21.38 from `accentWash` (the field floor is
		 * 2.0), 6.60:1 for `accentAlt` on it, and 9.92 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#2A2132",

		// 45E055, the 1-up green.
		success: "#45E055",
		successWash: "#122615",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.18:1.
		 */
		successBorder: "#458848",

		// FF9430, the bonus-round orange: distinct from the yellow accent by hue, and
		// from the red danger by the 15 ΔE00 separation floor.
		warning: "#FF9430",
		warningWash: "#2A1C11",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.22:1.
		 */
		warningBorder: "#A46F40",

		// FF5252, the hit flash.
		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.52:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 75.3 -> 67.01, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		danger: "#FF6660",
		dangerWash: "#2A1315",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.19:1.
		 */
		dangerBorder: "#B7615E",

		// 52B4FF, the ice-level blue and the TUI's `signal`.
		info: "#52B4FF",
		infoWash: "#13202C",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.19:1.
		 */
		infoBorder: "#547EA2",

		overlayShadow: "0 12px 32px -12px rgb(4 4 5 / 0.75)",
		scrim: "rgb(4 4 5 / 0.65)",
	},
};
