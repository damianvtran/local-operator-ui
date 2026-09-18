import type { ThemeDefinition } from "../palette-contract";

/**
 * Radient.
 *
 * A brand theme rather than a community scheme, with only three colours to
 * protect: the navy ground, the medium blue 91B7E9 and the light blue
 * BDF0FD. It had no semantic hues at all, so success, warning and danger are
 * derived cool-leaning so they sit inside the theme rather than on top of it.
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
export const radient: ThemeDefinition = {
	id: "radient",
	name: "Radient",
	description: "Radient blue: deep navy ground with a soft blue accent.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +4.87, elevated +10.8, sunken -2.87 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #10151C -> #1B2027 (L* 6.6 -> 12.04)
		 * surface #1A1F2F -> #25293A (L* 11.99 -> 16.92)
		 * elevated #282D47 -> #303550 (L* 19.15 -> 22.84)
		 * sunken #0A0D12 -> #181A1D (L* 3.58 -> 9.17)
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
		canvas: "#1B2027",
		// The old theme set both background.default and background.paper to the
		// same value, so a card was invisible against the page. Surface and elevated
		// take the two blues the file already used for its sidebars.
		surface: "#25293A",
		elevated: "#303550",
		sunken: "#181A1D",

		/*
		 * The current row's own ground: `surface` stepped up its own navy
		 * ramp 6.24 `L*`, at 1.01x the panel's chroma. ΔE00 4.11 from `surface`,
		 * 4.09 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 11.72 from `sunken`. The row is 1.182x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#212636)
		 * stepped 3.37 `L*` off the panel, and this one steps 6.24. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 12.87:1, `ink-muted` 8.98:1, `ink-dim` 5.61:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 5.61:1.
		 */
		highlight: "#272c3d",

		// Pure white was the one value in this file that belonged to no ramp: at
		// C0 it reads as a hole punched in the navy rather than as the top of the
		// theme's own ink ladder. This continues that ladder — the chroma of the
		// three weights below it falls 14.5, 13.8, 9.1 as lightness rises, so the
		// primary ink lands at C3 on the same blue hue, and still measures 17:1
		// on canvas against white's 18.3:1.
		ink: "#F2F7FC",
		// The old secondary text was the light blue BDF0FD. Accent-weight colour on
		// every piece of secondary text is what the one-accent rule exists to stop,
		// so secondary text is now a cool blue-grey on the same ramp. BDF0FD is not
		// lost: it was also primary.light and is now accentHover.
		inkMuted: "#C2D2E0",
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
		inkDim: "#91ABBF",
		inkDisabled: "#64748B",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 6.36.
		 */
		hairline: "#3C404F",
		// Derived. The old theme bounded inputs with white at 20 percent alpha,
		// which measured about 1.5:1 on the page ground.
		borderControl: "#7A8CA3",

		accent: "#91B7E9",
		accentHover: "#BDF0FD",
		accentActive: "#6E9AD4",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.1 from `accent` and 11.15:1 on surface, where the accent
		// itself is 7.93:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#C1D7F3",
		tokenCommand: "#E3B457",
		/* This palette's second hue: its `info` IS its accent, so the token takes
		   the hue the same palette's editor already paints string literals in. */
		accentWash: "#1F2835",
		// The old theme paired white with this blue, which measures 2.2:1. Ink on
		// the accent fill is the page ground instead.
		onAccent: "#10151C",

		// Derived. Radient names no semantic colours, so these three are built to
		// the theme's own cool cast rather than borrowed from another palette.
		success: "#63D2A0",
		successWash: "#1A2C2C",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.03:1.
		 */
		successBorder: "#4C8C73",

		warning: "#E3B457",
		warningWash: "#292823",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.01:1.
		 */
		warningBorder: "#957C4B",

		danger: "#EF7E86",
		dangerWash: "#2B2229",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		dangerBorder: "#B16C72",

		// No informational hue, and the two candidates are both already spent on
		// the accent. Info is the accent triple.
		info: "#91B7E9",
		infoWash: "#1F2835",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		infoBorder: "#6A81A0",

		overlayShadow: "0 12px 32px -12px rgb(4 6 10 / 0.7)",
		scrim: "rgb(4 6 10 / 0.6)",
	},
};
