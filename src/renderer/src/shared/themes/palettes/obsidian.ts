import type { ThemeDefinition } from "../palette-contract";

/**
 * Obsidian.
 *
 * A monochrome shadcn-style theme. Carried straight from the old file: zinc
 * 950, 900 and 800 as the three upper grounds, zinc 50 as both ink and
 * accent, zinc 500 as secondary text and zinc 600 as the inactive tone.
 *
 * The interesting problem here is that a monochrome theme still has to signal
 * danger. The four semantic hues are the lowest-chroma tints that clear the
 * floors, so they read as tinted greys rather than as candy dropped onto a
 * grey theme — and info stays fully monochrome.
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
export const obsidian: ThemeDefinition = {
	id: "obsidian",
	name: "Obsidian",
	description: "Monochrome: zinc near-black with an off-white accent.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +4.88, elevated +10.56, sunken -2.41 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #09090B -> #202021 (L* 2.51 -> 12.29)
		 * surface #18181B -> #2A2A2D (L* 8.36 -> 17.17)
		 * elevated #27272A -> #37363A (L* 15.75 -> 22.85)
		 * sunken #030307 -> #1B1B1E (L* 0.9 -> 9.88)
		 *
		 * ONLY LIGHTNESS MOVED. Each value holds its own `a` and `b`, so the theme's
		 * hue and chroma class are exactly what they were and chroma is scaled only
		 * where sRGB forces it - a lift that neutralised a palette to satisfy a floor
		 * would be a different theme, not a lighter one.
		 *
		 * THE COST IS THE BLACK, and it is recorded rather than argued away: this
		 * palette's upstream identity IS near-black, so a user who chose it for that
		 * loses it (`docs/branding.md` § 2 lists the four who pay it). What survives is
		 * the family - the hue, the chroma class and the relative ladder - and the
		 * operator asked for exactly this trade: no page ground in this app sits below
		 * L* 12.
		 *
		 * THE GROUNDS AND THE INKS MOVED TOGETHER, and the header of this file says why:
		 * lifting a dark ground raises the luminance every ink is measured against, so
		 * the inks in this file were re-seated on the same commit rather than after it.
		 */
		canvas: "#202021",
		surface: "#2A2A2D",
		elevated: "#37363A",
		// The old file already used a near-black 060609 for its message view, which
		// measures 1.02:1 against zinc 950 — too close to read as a separate
		// ground. This is two levels lower on the same blue-leaning zinc lean
		// (h290, the hue every other neutral here carries) at 1.03:1. True black
		// would clear the separation floor more easily and was what this held, but
		// a C0 value is the absence of the ramp rather than its bottom rung.
		sunken: "#1B1B1E",

		/*
		 * The current row's own ground: `surface` stepped up its own violet-tinted neutral
		 * ramp 5.58 `L*`, carrying 1.90x the panel's chroma. ΔE00 4.01 from `surface`,
		 * 2.36 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 8.37 from `sunken`. The row is 1.134x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#1f1f22)
		 * stepped 3.51 `L*` off the panel, and this one steps 5.58. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 14.97:1, `ink-muted` 6.10:1, `ink-dim` 4.87:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 4.87:1. The step here is still partly chroma-bought (1.90x the panel's, a faint violet
		 * on a near-black neutral); the ordering above is what a re-authoring should
		 * follow.
		 */
		highlight: "#232329",

		ink: "#FAFAFA",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#C5C5CE",
		// Derived. Zinc 400 D4D4D8 is lighter than zinc 500, so it cannot serve as
		// a dimmer weight; this sits between zinc 500 and zinc 600 instead.
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
		inkDim: "#A7A7AF",
		inkDisabled: "#52525B",

		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 4.14.
		 */
		hairline: "#424244",
		// Zinc 500 measures 2.86:1 on zinc 800, a hair under the structural floor,
		// so it is lifted by one level. The old theme bounded inputs with zinc 50 at
		// 20 percent alpha, about 1.8:1.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3.02:1. Lightness only, at the role's own hue.
		 */
		borderControl: "#7F7F88",

		// In a monochrome theme the accent is the off-white, which is why a primary
		// button here is white with near-black ink.
		accent: "#FAFAFA",
		// Zinc 50 is already the top of the ramp, so the interaction ladder can
		// only run downwards — the same direction shadcn's own zinc dark theme
		// takes with `primary/90`, and the same direction the light palettes take.
		// The previous pure white differed from the accent by ΔE00 1.0, a hover
		// state nobody could see; zinc 200 is 4.85 and zinc 300 a further 3.65.
		// Both still clear 15:1 for `accentHover` used as a link ink.
		accentHover: "#E4E4E7",
		accentActive: "#D4D4D8",
		// The one palette whose accent is its brightest value, so this role cannot
		// be a lightness step at all: it is a CHROMA step into the hue the palette
		// already owns (`warning` #CBAF7E, lightened to the edge of visibility), which
		// keeps the ground ratio (17.03:1 against the accent's 16.97:1) while still
		// measuring ΔE00 10.0 from it. The window is narrow by construction: brighter is
		// ΔE00 1.0 away, and more chroma falls below the accent's own ground ratio.
		chartBarHover: "#FCFCE4",
		tokenCommand: "#FAFAFA",
		/* Monochrome: pinned to `ink` with the painted weight step carrying the run
		   (see the role's note in `palette-contract.ts`) — no semibold, and one
		   constant stroke width at every raster. */
		/*
		 * Legibility pass: the wash is a hover and callout tint, not a selection
		 * ground, and it gains one floor - ΔE00 2.0 against every ground it is painted
		 * on - because it reads 1.00-1.24:1, so no ratio assertion can see it.
		 * `surface` is the tightest base at ΔE00 2.02. Lightness only, at the
		 * wash's own hue.
		 */
		accentWash: "#303032",
		onAccent: "#09090B",
		/*
		 * No second hue to carry: this palette is desktop-only, so it has no TUI
		 * `label` token and the hue is a ROTATION of `accent` rather than a value
		 * that already existed — Δh 310° at `accent`'s own L*, its chroma walked
		 * down from 40.00 to the first that clears every floor (C* 40.00) — and it
		 * is the only palette in the set that gains a hue it never had, its accent
		 * being the greyscale `#FAFAFA` at C* 0, so the walk starts from the chroma
		 * floor of 40 rather than from the accent's own. Measured: ΔE00 21.43 from
		 * `accent`, 20.43 from its nearest semantic (`warning`), 13.70:1 on the
		 * tightest ground (`surface`).
		 */
		accentAlt: "#FDFFAF",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 19.93 and C* 1.36, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 2.87 from `accentWash` (the field floor is
		 * 2.0), 12.66:1 for `accentAlt` on it, and 4.03 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#30302E",

		// Low-chroma by design: about 30 percent saturation, so the semantic states
		// stay legible without turning a deliberately grey theme into a colourful
		// one.
		success: "#86BFA1",
		successWash: "#181F1D",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.02:1.
		 */
		successBorder: "#668777",

		warning: "#CBAF7E",
		warningWash: "#201D19",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		warningBorder: "#8E7D61",

		danger: "#DE9391",
		dangerWash: "#231A1B",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		dangerBorder: "#A17473",

		// Info stays the mono accent. Adding a blue here would be the only hue in
		// the theme, which is the opposite of what Obsidian is for.
		info: "#FAFAFA",
		infoWash: "#262628",
		infoBorder: "#8E8E8E",

		// Tinted to the ramp for the same reason the grounds are: a pure black
		// scrim over a blue-leaning near-black shifts the whole view neutral.
		overlayShadow: "0 12px 32px -12px rgb(3 3 7 / 0.8)",
		scrim: "rgb(3 3 7 / 0.65)",
	},
};
