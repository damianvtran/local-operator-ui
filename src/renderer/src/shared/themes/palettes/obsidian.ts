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
		 * (surface +4.88, elevated +10.56, sunken -2.41 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #09090B -> #202021 (L* 2.51 -> 12.29)
		 * surface #18181B -> #2A2A2D (L* 8.36 -> 17.17)
		 * elevated #27272A -> #353438 (L* 15.75 -> 21.94)
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
		elevated: "#353438",
		// The old file already used a near-black 060609 for its message view, which
		// measures 1.02:1 against zinc 950 — too close to read as a separate
		// ground. This is two levels lower on the same blue-leaning zinc lean
		// (h290, the hue every other neutral here carries) at 1.03:1. True black
		// would clear the separation floor more easily and was what this held, but
		// a C0 value is the absence of the ramp rather than its bottom rung.
		sunken: "#1B1B1E",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are steps
		 * of THIS palette's own neutral ladder at the panel's h290 lean; the retired
		 * role was the same kind of step at a lower strength. The rule, and why a
		 * monochrome palette is a CLASS with its own floors rather than a ledger of
		 * exemptions, are in the two roles' doc in `palette-contract.ts`.
		 *
		 * RE-AUTHORED IN REMEDIATION ROUND 1, and the measurement is why. The pair
		 * that shipped here - #313134 / #36363A - put the hover at ΔE00 2.23 off
		 * `surface`, which is 1.19 BELOW the 3.42 the retired `elevated` step it
		 * replaced measured: on the one palette whose accent (#FAFAFA, C* 0) gives
		 * its hover neither a colour nor a bar to help, the pass made the operator's
		 * first-named complaint worse, and it was the fleet's only hover under 3.0.
		 *
		 * THE CEILING IS THE INK CAP AND THE RANK, not a class. Holding the fills to
		 * this palette's own cast, the legal window runs L* 18.67-22.84: the floor is
		 * the 1.5 L* step above `surface` (L* 17.17), whose first representable value
		 * is `#2E2E2E` at 18.94, and the top is the `inkDim` 5:1 cap on a neutral fill.
		 * The SELECTION binds first, because it must reach that cap AND sit
		 * `ROW_STATE_HOVER_RANK` above the hover: its own ceiling is L* 23.10 (at its
		 * chroma, C* 3.38 at h298), so the hover can rise no higher than
		 * min(22.84, 23.10 - 0.5) = L* 22.60. The endpoints are DERIVED from those two
		 * rules rather than read off the shipped values, which is what this paragraph
		 * exists for (review round 2: it quoted 18.94-22.88 and 22.16 - the shipped
		 * selection's and hover's own L* - so the ceiling read as read-off and the
		 * shipped hover's headroom appeared to be none rather than 0.44 L*).
		 *
		 * Measured at the shipped pair:
		 *
		 * rowHover    #353535  neutral step at the ink cap's shadow, C* 0.00, +4.99
		 *                       L*, ΔE00 4.05 off `surface`, `inkDim` 5.13:1 on the
		 *                       fill. The alternative that keeps the h290 lean
		 *                       (C* 0.67) tops out at ΔE00 3.75 - stated because it
		 *                       is the number the next pass will want, not because
		 *                       it ships: the class asks for the NEUTRAL step, and a
		 *                       castless value is at every hue at once.
		 * rowSelected #37363B  C* 3.38 at h298, +5.72 L*, ΔE00 4.22 off `surface`
		 *                       and 3.56 off `rowHover`, `inkDim` 5.01:1, and the 2px
		 *                       `accent` bar at 11.48:1 against it.
		 *
		 * The pair's 3.56 clears the FLEET's ΔE00 2.0 separation, so this palette no
		 * longer leans on the class's relaxed pair floor; the wash proximity is the
		 * one relaxation the class still carries for it, and the class doc says so.
		 */
		rowHover: "#353535",
		rowSelected: "#37363B",

		ink: "#FAFAFA",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.21:1.
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
		 * is 5:1 on all six grounds and `elevated` binds it at 5.17:1.
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
		 * `elevated` is the tightest ground at ΔE00 4.75.
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
		 * only by a pin in the contract. `elevated` binds it at 3.12:1.
		 */
		successBorder: "#668777",

		warning: "#CBAF7E",
		warningWash: "#201D19",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.09:1.
		 */
		warningBorder: "#8E7D61",

		danger: "#DE9391",
		dangerWash: "#231A1B",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.10:1.
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
