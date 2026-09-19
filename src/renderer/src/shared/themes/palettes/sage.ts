import type { ThemeDefinition } from "../palette-contract";

/**
 * Sage.
 *
 * A light theme, and the hardest of the ten to raise to the floors, because
 * its identity colour — celadon B2CEB3 — is lighter than the paper it has to
 * be legible on. The ramp and the accent both had to move; the celadon
 * itself survives as the accent wash, which is where it was already doing
 * most of its work.
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
		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A light page ground is capped at L* 94 here, because `elevated`
		 * at L* 100 is the end of sRGB's ramp and the minimum canvas-to-elevated
		 * spread is 2.5 + 2.5 L*.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.11, elevated +5.8, sunken -4.18 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #F3EEE0 -> #F2EDE0 (L* 94.14 -> 93.81)
		 * surface #FBF7EC -> #FAF6EB (L* 97.26 -> 96.92)
		 * elevated #FFFEF9 -> #FFFEF9 (L* 99.61 -> 99.61)
		 * sunken #E9E2D0 -> #E8E1CF (L* 89.99 -> 89.63)
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
		canvas: "#F2EDE0",
		surface: "#FAF6EB",
		elevated: "#FFFEF9",
		sunken: "#E8E1CF",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #ECF4EC  accent hue, C* 5.01, +1.51 L*, ΔE00 5.44 off `surface`,
		 *                       `inkDim` 5.87:1 on the fill, hue 0.78° off `accent`.
		 * rowSelected #DBEDDB  accent hue, C* 11.38, +4.90 L*, ΔE00 10.24 off
		 *                       `surface` and 6.06 off `rowHover`, `inkDim` 5.38:1, and the
		 *                       2px `accent` bar at 4.83:1 against it.
		 */
		rowHover: "#ECF4EC",
		rowSelected: "#DBEDDB",

		ink: "#222C1F",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `sunken` binds it at 7.25:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#404935",
		// Sage's ash gray 677657, darkened to clear 4.5:1 on sunken. In a light
		// theme the darkest ground is what caps the tertiary ink, not the lightest.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.19:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#556147",
		inkDisabled: "#96A088",

		hairline: "#D5D3C5",
		// Sage's darker sage 8DA985, darkened to clear 3:1 on the lightest ground.
		// The old theme bounded inputs at 12 percent black, about 1.2:1.
		borderControl: "#68865F",

		// Neither celadon B2CEB3 nor the darker sage 8DA985 can be read as text on
		// near-white paper — they measure about 2.0:1 and 2.6:1. This is the
		// theme's own deeper green, which its old file already used for icons.
		/*
		 * Legibility pass: `accent` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `sunken` binds it there at
		 * 4.53:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		accent: "#476D49",
		accentHover: "#35563A",
		accentActive: "#294229",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.3 from `accent` and 8.37:1 on surface, where the accent
		// itself is 5.46:1. See `chartBarHover` in the palette contract.
		/*
		 * Legibility pass: `chartBarHover` follows `accent` - the ramp is one control seen
		 * three times and the chart's hover mark has to stay ΔE00 10 clear of the
		 * resting mark, so both move at their own hue rather than letting the accent
		 * pull away from them.
		 */
		chartBarHover: "#334F35",
		tokenCommand: "#3A659F",
		/* The wire's own `info`, so the command word's rendering does not move. */
		// The celadon, at the faintest tint that still lets the accent clear 4.5:1
		// on it. This is where Sage's signature colour still shows.
		accentWash: "#E6E9D8",
		onAccent: "#F4F6F4",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#c39ede`),
		 * moved onto the floors: as received it read 1.74:1 as text on all three
		 * text grounds (`sunken` is the tightest). The shortfall is paid on
		 * LIGHTNESS at the source hue — L* 70.41 → 42.54 — which is what this port
		 * does to every one of its own tokens. Measured: ΔE00 36.53 from `accent`,
		 * 31.18 from its nearest semantic (`danger`), 4.51:1 on the tightest ground
		 * (`sunken`).
		 */
		accentAlt: "#785791",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 91.71 and C* 8.84, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 18.88 from `accentWash` (the field floor is
		 * 2.0), 4.77:1 for `accentAlt` on it, and 12.59 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#EEE4F4",

		success: "#446F26",
		successWash: "#E9EBD3",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.01:1.
		 */
		successBorder: "#5F8D32",

		// Sage's yellow-green 8EA604 sits about 24 degrees from its success green
		// and the two are hard to tell apart at callout size, so warning rotates to
		// ochre and keeps the theme's muted saturation.
		warning: "#825C06",
		warningWash: "#EAE2CC",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3:1.
		 */
		warningBorder: "#967E42",

		// Sage has no red. A low-chroma brick, warm like the rest of the ramp.
		danger: "#A8402F",
		dangerWash: "#EDDED0",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.01:1.
		 */
		dangerBorder: "#B76D5C",

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
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.02:1.
		 */
		infoBorder: "#6181B7",

		overlayShadow: "0 12px 32px -12px rgb(34 44 31 / 0.22)",
		scrim: "rgb(34 44 31 / 0.35)",
	},
};
