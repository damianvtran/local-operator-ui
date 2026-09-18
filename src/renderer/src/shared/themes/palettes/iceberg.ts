import type { ThemeDefinition } from "../palette-contract";

/**
 * Iceberg, light.
 *
 * The upstream Iceberg light scheme is the source: background E8E9EC, text
 * 33374C, blue 2D539E, green 668E3D, orange C57339, red CC517A and cyan
 * 3F83A6. The app's old file had already darkened several of these by hand
 * for contrast; now that the floors are measured, each one goes back to its
 * upstream value and is darkened only as far as the arithmetic requires.
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
export const iceberg: ThemeDefinition = {
	id: "iceberg",
	name: "Iceberg",
	description: "Cool blue-grey paper with the Iceberg navy.",
	palette: {
		mode: "light",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A light page ground is capped at L* 94 here, because `elevated`
		 * at L* 100 is the end of sRGB's ramp and the minimum canvas-to-elevated
		 * spread is 2.5 + 2.5 L*.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.49, elevated +7.01, sunken -2.76 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #E8E9EC -> #E8E9EC (L* 92.35 -> 92.35)
		 * surface #F2F3F6 -> #F2F3F6 (L* 95.84 -> 95.84)
		 * elevated #FDFDFF -> #FDFDFF (L* 99.36 -> 99.36)
		 * sunken #E1E2E7 -> #E0E1E6 (L* 89.94 -> 89.59)
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
		canvas: "#E8E9EC",
		// Upstream has one background and the old file invented F3F4F7 for paper.
		// Two more grounds are derived on the same cool ramp.
		surface: "#F2F3F6",
		// Canvas is upstream's own background, so the canvas/surface step is fixed
		// at ΔE00 2.11 and surface cannot come down without collapsing it. The only
		// room for a visible surface/elevated step is therefore above surface:
		// FAFAFC read 1.58 apart from it, FDFDFF reads 2.15 on the same +2 blue
		// tint. That is the whole headroom a light ramp has under white.
		elevated: "#FDFDFF",
		// A light ramp has very little room below its page ground: canvas is already
		// a mid-light grey, and every step down costs tertiary-ink headroom. This
		// sits 1.07:1 under canvas, which is what caps inkDim below.
		sunken: "#E0E1E6",

		/*
		 * The current row's own ground: `surface` stepped down its own cool neutral
		 * ramp 4.09 `L*`, carrying 3.31x the panel's chroma. ΔE00 4.12 from `surface`,
		 * 5.88 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 2.53 from `sunken`. The row is 1.111x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#e8e9eb)
		 * stepped 3.52 `L*` off the panel, and this one steps 4.09. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 9.51:1, `ink-muted` 6.64:1, `ink-dim` 5.11:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 5.11:1. KNOWN CAST, RECORDED RATHER THAN HIDDEN: this panel is the least chromatic of
		 * the twelve (C* 1.57), so every step here is a large multiple of it and the row
		 * reads as a lavender band rather than a darker one (design round 1, D4). It is
		 * the one palette whose step is bought on chroma rather than lightness — the
		 * premise that its recessed ground capped the step was wrong (see this file's
		 * neighbours: `sunken` sits 3.75 from `surface` and the row still clears it by
		 * 2.53) — and the fix is the ordering the rule states: spend `L*` first. Not
		 * re-authored in this round, which is scoped to the three palettes the
		 * operator's report is measured on.
		 */
		highlight: "#e5e7f1",

		// Iceberg's own text colour. The old file darkened it to 262A3F for
		// contrast, which is no longer necessary — this measures 9:1 on the darkest
		// ground and 11.2:1 on the lightest.
		ink: "#33374C",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `accentWash` binds it at 7.27:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#3C4056",
		// Upstream sub colour, carried verbatim; it clears 4.87:1 on sunken, which
		// is the binding ground for a dark ink in a light theme.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `accentWash` binds it at 5:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#54586D",
		inkDisabled: "#A0A4B8",

		hairline: "#CBCCD2",
		// Derived. The old theme bounded inputs at 15 percent black, about 1.4:1.
		borderControl: "#787D97",

		accent: "#2D539E",
		accentHover: "#1E3A7D",
		accentActive: "#162E63",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 10.18:1 on surface, where the accent
		// itself is 6.66:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#1F396C",
		tokenCommand: "#316682",
		/* The wire's own `info`, so the command word's rendering does not move. */
		accentWash: "#D5DAE4",
		onAccent: "#F2F5F9",
		/*
		 * No second hue to carry: this palette is desktop-only, so it has no TUI
		 * `label` token and the hue is a ROTATION of `accent` rather than a value
		 * that already existed — Δh 160° at `accent`'s own L*, its chroma walked
		 * down from 46.61 to the first that clears every floor (C* 41.61).
		 * Measured: ΔE00 48.02 from `accent`, 15.10 from its nearest semantic
		 * (`warning`), 5.69:1 on the tightest ground (`sunken`).
		 */
		accentAlt: "#6A520A",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 86.94 and C* 5.49, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 10.01 from `accentWash` (the field floor is
		 * 2.0), 5.30:1 for `accentAlt` on it, and 7.42 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#DFD9CF",

		// Upstream green 668E3D, darkened to clear 4.5:1 on the light grounds.
		/*
		 * Legibility pass: `success` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.52:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		success: "#4B682C",
		successWash: "#DBE0DB",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.02:1.
		 */
		successBorder: "#6F8855",

		// Upstream orange C57339, darkened for the same reason.
		/*
		 * Legibility pass: `warning` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.51:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		warning: "#8C5129",
		warningWash: "#E5DDDA",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.01:1.
		 */
		warningBorder: "#B66F41",

		// Upstream red CC517A, darkened for the same reason. The old file's own
		// error.dark B32D5E was heading the same way by hand.
		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.54:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		danger: "#AA315B",
		dangerWash: "#E5DAE1",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3:1.
		 */
		dangerBorder: "#C46084",

		// Upstream cyan, darkened. Kept as a cyan rather than a second navy so an
		// info callout does not read as a primary one.
		/*
		 * Legibility pass: `info` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.53:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		info: "#306581",
		infoWash: "#D7DFE5",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3:1.
		 */
		infoBorder: "#5087A6",

		overlayShadow: "0 12px 32px -12px rgb(38 42 63 / 0.22)",
		scrim: "rgb(38 42 63 / 0.35)",
	},
};
