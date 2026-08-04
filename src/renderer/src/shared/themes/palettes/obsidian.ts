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
 */
export const obsidian: ThemeDefinition = {
	id: "obsidian",
	name: "Obsidian",
	description: "Monochrome: zinc near-black with an off-white accent.",
	palette: {
		mode: "dark",

		canvas: "#09090B",
		surface: "#18181B",
		elevated: "#27272A",
		// The old file already used a near-black 060609 for its message view. True
		// black gives the recessed ground a little more separation from zinc 950,
		// which at this darkness is otherwise about 1.03:1.
		sunken: "#000000",

		ink: "#FAFAFA",
		inkMuted: "#A1A1AA",
		// Derived. Zinc 400 D4D4D8 is lighter than zinc 500, so it cannot serve as
		// a dimmer weight; this sits between zinc 500 and zinc 600 instead.
		inkDim: "#8F8F97",
		inkDisabled: "#52525B",

		hairline: "#2F2F31",
		// Zinc 500 measures 2.86:1 on zinc 800, a hair under the structural floor,
		// so it is lifted by one level. The old theme bounded inputs with zinc 50 at
		// 20 percent alpha, about 1.8:1.
		borderControl: "#72727B",

		// In a monochrome theme the accent is the off-white, which is why a primary
		// button here is white with near-black ink.
		accent: "#FAFAFA",
		accentHover: "#FFFFFF",
		accentActive: "#E4E4E7",
		accentWash: "#262628",
		onAccent: "#09090B",

		// Low-chroma by design: about 30 percent saturation, so the semantic states
		// stay legible without turning a deliberately grey theme into a colourful
		// one.
		success: "#86BFA1",
		successWash: "#181F1D",
		successBorder: "#4E6E5F",

		warning: "#CBAF7E",
		warningWash: "#201D19",
		warningBorder: "#75654A",

		danger: "#DE9391",
		dangerWash: "#231A1B",
		dangerBorder: "#885C5C",

		// Info stays the mono accent. Adding a blue here would be the only hue in
		// the theme, which is the opposite of what Obsidian is for.
		info: "#FAFAFA",
		infoWash: "#262628",
		infoBorder: "#8E8E8E",

		overlayShadow: "0 12px 32px -12px rgb(0 0 0 / 0.8)",
		scrim: "rgb(0 0 0 / 0.65)",
	},
};
