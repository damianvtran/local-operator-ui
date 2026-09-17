import type { ThemeDefinition } from "../palette-contract";

/**
 * Sage.
 *
 * A light theme, and the hardest of the ten to raise to the floors, because
 * its identity colour — celadon B2CEB3 — is lighter than the paper it has to
 * be legible on. The ramp and the accent both had to move; the celadon
 * itself survives as the accent wash, which is where it was already doing
 * most of its work.
 */
export const sage: ThemeDefinition = {
	id: "sage",
	name: "Sage",
	description: "Light and green: floral white paper with a deep sage ink.",
	palette: {
		mode: "light",

		// The old theme paired a FDF9F1 page with FFFFFF paper. Elevation here is a
		// lightness step and white is the ceiling, so that ramp has no room for the
		// two grounds above surface. The whole floral-white ramp is re-seated one
		// step lower, which buys four distinguishable grounds and keeps the paper
		// warm rather than grey.
		// Elevated is already within a hair of white, so the canvas/surface step has
		// to be bought from below: F5F0E2 sat ΔE00 1.91 from surface, and two units
		// down the same warm ramp reads 2.24 while keeping 3.04 down to sunken.
		canvas: "#F3EEE0",
		surface: "#FBF7EC",
		elevated: "#FFFEF9",
		sunken: "#E9E2D0",

		/*
		 * The current row's own ground: `surface` stepped down its own green-grey
		 * ramp 6.62 `L*`, at 0.93x the panel's chroma. ΔE00 4.02 from `surface`,
		 * 5.89 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 3.25 from `sunken`. The row is 1.186x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#f0ede2)
		 * stepped 3.56 `L*` off the panel, and this one steps 6.62. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 11.42:1, `ink-muted` 6.80:1, `ink-dim` 4.75:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 4.75:1.
		 */
		highlight: "#e8e4da",

		ink: "#222C1F",
		inkMuted: "#454F3A",
		// Sage's ash gray 677657, darkened to clear 4.5:1 on sunken. In a light
		// theme the darkest ground is what caps the tertiary ink, not the lightest.
		inkDim: "#5A674C",
		inkDisabled: "#96A088",

		hairline: "#D5D3C5",
		// Sage's darker sage 8DA985, darkened to clear 3:1 on the lightest ground.
		// The old theme bounded inputs at 12 percent black, about 1.2:1.
		borderControl: "#68865F",

		// Neither celadon B2CEB3 nor the darker sage 8DA985 can be read as text on
		// near-white paper — they measure about 2.0:1 and 2.6:1. This is the
		// theme's own deeper green, which its old file already used for icons.
		accent: "#476E49",
		accentHover: "#35563A",
		accentActive: "#294229",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.3 from `accent` and 8.37:1 on surface, where the accent
		// itself is 5.46:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#345035",
		// The celadon, at the faintest tint that still lets the accent clear 4.5:1
		// on it. This is where Sage's signature colour still shows.
		accentWash: "#E6E9D8",
		onAccent: "#F4F6F4",

		success: "#446F26",
		successWash: "#E9EBD3",
		successBorder: "#669438",

		// Sage's yellow-green 8EA604 sits about 24 degrees from its success green
		// and the two are hard to tell apart at callout size, so warning rotates to
		// ochre and keeps the theme's muted saturation.
		warning: "#825C06",
		warningWash: "#EAE2CC",
		warningBorder: "#9E8549",

		// Sage has no red. A low-chroma brick, warm like the rest of the ramp.
		danger: "#A8402F",
		dangerWash: "#EDDED0",
		dangerBorder: "#BF7462",

		// This theme has no informational hue of its own, and a blue is the only
		// cool colour in it — which is why `info` used to be the accent triple.
		// That made it the accent green exactly, ΔE00 0 from `accent` and 8.4
		// from `success`: the same defect this file already fixed one row up,
		// where `warning` rotated to ochre because a yellow-green 24 degrees
		// from the success green could not be told apart at callout size. A
		// semantic that cannot be told from another semantic is not a semantic.
		//
		// So it is a blue, and the warmest one available: Lab hue 276 leans to
		// the red side rather than toward cyan, and C*36 sits between the muted
		// accent (27) and the fuller success/warning/danger (45-53), so it
		// reads as a member of this palette rather than a swatch borrowed from
		// a cooler one. Now ΔE00 46.9 from `success` and 36.8 from `accent`.
		info: "#3A659F",
		// The wash and the border are seated by loudness, not by eye. Sage's other
		// four washes sit ΔE00 3.98-5.70 from `canvas` — the tightest family among
		// the palettes that shipped with it (bar the light brand ramp, at 3.69),
		// because each is a warm tint of a warm paper and hue costs nothing when the
		// hue already matches. The first blue wash tried here sat at 13.75: 2.4x the
		// loudest of the family it had just joined, so the one callout that means
		// "nothing is wrong" shouted over the one that means "this failed".
		//
		// On paper this warm, that loudness is bought entirely by hue, not by
		// lightness or chroma — the old wash was already at the family's L* and
		// chroma. Measured against this canvas, a wash at b* 0 costs 6.16 and
		// b* -1 costs 7.10, both already over the family's ceiling. So the fill
		// stops at the coolest point the budget reaches (b* +1.0, ΔE00 5.52,
		// between `successWash` 5.54 and `dangerWash` 5.70) and reads cool by
		// being neutral beside cream rather than by being blue. The blue moves
		// to the border, which is where `warning` already keeps its ochre.
		infoWash: "#E9E9E7",
		// Lab hue 276, the same as `info` itself, at L*56.4 and 3.09:1 against
		// canvas — the family's own border lightness (56.4/56.6/56.5) and its
		// own contrast (3.09/3.07/3.08). It carries more chroma than the border
		// it replaces, not less: with the fill neutral the edge is what says
		// which callout this is, and its ΔE00 from canvas is unchanged at 38.
		infoBorder: "#6888BE",

		overlayShadow: "0 12px 32px -12px rgb(34 44 31 / 0.22)",
		scrim: "rgb(34 44 31 / 0.35)",
	},
};
