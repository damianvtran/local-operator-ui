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
		canvas: "#F5F0E2",
		surface: "#FBF7EC",
		elevated: "#FFFEF9",
		sunken: "#E9E2D0",

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
		// The celadon, at the faintest tint that still lets the accent clear 4.5:1
		// on it. This is where Sage's signature colour still shows.
		accentWash: "#E6E9D8",
		onAccent: "#FFFFFF",

		success: "#477229",
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

		// No informational hue in the theme, and a blue would be the only cool
		// colour in it. Info is the accent triple.
		info: "#476E49",
		infoWash: "#E6E9D8",
		infoBorder: "#758F6D",

		overlayShadow: "0 12px 32px -12px rgb(34 44 31 / 0.22)",
		scrim: "rgb(34 44 31 / 0.35)",
	},
};
