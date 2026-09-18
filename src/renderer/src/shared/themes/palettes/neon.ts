import type { ThemeDefinition } from "../palette-contract";

/**
 * Neon.
 *
 * Tron-inspired, and the most saturated of the ten. Carried: the two
 * near-black blues, the grey inks, the cyan trio, the cyberpunk pink and the
 * orange the old file already used for its caution highlights. The theme's
 * glow effects live in the base theme, not here — a palette has no shadows.
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
export const neon: ThemeDefinition = {
	id: "neon",
	name: "Neon",
	description: "Tron: near-black blue with cyan and cyberpunk pink.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.53, elevated +8.95, sunken -2.3 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #080C18 -> #1C2029 (L* 3.44 -> 12.22)
		 * surface #0F1524 -> #212737 (L* 6.91 -> 15.75)
		 * elevated #182036 -> #2B324A (L* 12.57 -> 21.17)
		 * sunken #03040A -> #1B1B1F (L* 1.16 -> 9.92)
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
		canvas: "#1C2029",
		// The old grounds 080C18 and 0D1220 measured 1.04:1 apart, close enough to
		// read as one surface. Surface and elevated are spread along the same
		// desaturated blue ramp so a card and a menu are actually distinguishable.
		surface: "#212737",
		elevated: "#2B324A",
		sunken: "#1B1B1F",

		/*
		 * The current row's own ground: `surface` stepped up its own blue
		 * ramp 6.39 `L*`, at 0.95x the panel's chroma. ΔE00 4.04 from `surface`,
		 * 3.44 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 9.94 from `sunken`. The row is 1.147x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#171c2b)
		 * stepped 3.55 `L*` off the panel, and this one steps 6.39. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 12.03:1, `ink-muted` 6.16:1, `ink-dim` 4.69:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 4.69:1.
		 */
		highlight: "#1c2231",

		ink: "#E0E0E0",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 6.9:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#BEBECE",
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#A2A1B4",
		inkDisabled: "#5E5E70",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `surface` is the tightest ground at ΔE00 12.46.
		 */
		hairline: "#1F4050",
		// Derived. The old theme bounded inputs with cyan at 20 percent alpha, about
		// 1.3:1 — a neon outline that was not actually there.
		borderControl: "#6F8F99",

		accent: "#00EFFF",
		accentHover: "#66F7FF",
		accentActive: "#00B8D9",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 15.58:1 on surface, where the accent
		// itself is 12.83:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#B0FAFF",
		tokenCommand: "#FFA500",
		/* This palette's second hue: its `info` IS its accent, so the token takes
		   the hue the same palette's editor already paints string literals in. */
		// The cyan at a faint tint. The theme's own hover fills used the same cyan
		// at 10 to 15 percent, so this is the value it was already reaching for.
		accentWash: "#072734",
		onAccent: "#000E0F",

		// Neon has no green. This one is placed about 37 degrees off the cyan
		// accent, which is far enough that a success state does not read as a
		// primary action — the nearer greens all looked like dim cyan.
		success: "#2BFF88",
		successWash: "#0C2925",
		successBorder: "#1B9256",

		// The orange the old file used for its ask highlights.
		warning: "#FFA500",
		warningWash: "#261E15",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.02:1.
		 */
		warningBorder: "#A47221",

		// The theme's cyberpunk pink, carried verbatim; it clears 4.5:1 on both
		// grounds without a nudge.
		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.51:1.
		 *
		 * LIGHTNESS FIRST, and the chroma comes down only because the required `L*`
		 * leaves sRGB at this chroma: C* 88.19 -> 69.02, hue held. That is the
		 * lift rule's own exception - desaturate only where the gamut forces it - not a
		 * re-pick of the palette's colour.
		 */
		danger: "#FF5EAF",
		dangerWash: "#260B28",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		dangerBorder: "#DB349B",

		// Info is the accent cyan. The theme's only other bright hues are the pink,
		// which is danger, and the orange, which is warning.
		info: "#00EFFF",
		infoWash: "#072734",
		infoBorder: "#048997",

		overlayShadow: "0 12px 32px -12px rgb(0 0 0 / 0.75)",
		scrim: "rgb(2 4 8 / 0.65)",
	},
};
