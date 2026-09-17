import type { ThemeDefinition } from "../palette-contract";

/**
 * Synth.
 *
 * Retro synthwave. Carried: the two purple grounds, the darker purple the old
 * file used for tooltips, the pink trio, the neon blue and the bright orange.
 * The pink is the accent, the neon blue is the informational hue, and the
 * orange is the caution — three of the four semantic roles come straight from
 * the theme.
 */
export const synth: ThemeDefinition = {
	id: "synth",
	name: "Synth",
	description: "Synthwave: deep purple night with hot pink and neon blue.",
	palette: {
		mode: "dark",

		canvas: "#120720",
		surface: "#1B0A2F",
		elevated: "#2C1D43",
		sunken: "#06020D",

		/*
		 * The current row's own ground: `surface` stepped up its own neon-purple
		 * ramp 6.08 `L*`, at 1.14x the panel's chroma. ΔE00 4.14 from `surface`,
		 * 2.37 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 17.33 from `sunken`. The row is 1.133x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#231236)
		 * stepped 3.53 `L*` off the panel, and this one steps 6.08. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 14.87:1, `ink-muted` 7.54:1, `ink-dim` 5.29:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 5.29:1.
		 */
		highlight: "#281641",

		// The old file borrowed the generic dark theme's F9FAFB and 9CA3AF for its
		// text, which is a cool grey ramp sitting on a purple one. The inks here are
		// tinted purple to match the grounds; same weights, same legibility.
		ink: "#F7F2FB",
		inkMuted: "#B9AACA",
		inkDim: "#9C8CAE",
		inkDisabled: "#6B5C7D",

		// The pink at a low tint over surface. It has to stay lighter than elevated,
		// or a divider inside a menu disappears — which is what the old sidebar
		// border did once it was flattened.
		hairline: "#5B1946",
		// Derived. The old theme bounded inputs with neon blue at 25 percent alpha,
		// about 1.5:1.
		borderControl: "#8A7BA0",

		accent: "#FF4081",
		accentHover: "#FF79B0",
		accentActive: "#F50057",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.2 from `accent` and 7.65:1 on surface, where the accent
		// itself is 5.57:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FF7BA8",
		accentWash: "#2E0E2C",
		// The old theme paired white with this pink, which measures 3.2:1. Ink on
		// the accent fill is the page ground instead, at 4.8:1.
		onAccent: "#120720",

		// Synth has no green. A mint, placed between the theme's pink and its neon
		// blue so it belongs to the same neon family.
		success: "#4DE8A8",
		successWash: "#192230",
		successBorder: "#32836B",

		// The bright orange the old file used for its ask highlights.
		warning: "#FFA500",
		warningWash: "#2E1A1C",
		warningBorder: "#945E0E",

		// The accent is already pink, so danger moves to red: a destructive action
		// must not read as the primary one. This is the smallest hue rotation that
		// separates them.
		danger: "#FF6B6B",
		dangerWash: "#2E1329",
		dangerBorder: "#A44551",

		// The theme's neon blue, an authentic informational hue.
		info: "#00E5FF",
		infoWash: "#10223B",
		infoBorder: "#08819B",

		overlayShadow: "0 12px 32px -12px rgb(6 2 13 / 0.75)",
		scrim: "rgb(6 2 13 / 0.65)",
	},
};
