import type { ThemeDefinition } from "../palette-contract";

/**
 * Gruvbox Light (medium contrast) — morhetz's own light mode, from colors/gruvbox.vim.
 *
 * light0 FBF1C7 is the page, light0_soft F2E5BC the well below it, fg1/dark1 3C3836 the ink,
 * dark3 665C54 and dark4 7C6F64 the lower ink weights and light4 A89984 the inactive tone.
 * The FADED accent set is what gruvbox actually paints light mode with — faded_blue 076678,
 * faded_green 79740E, faded_yellow B57614, faded_red 9D0006 — because the bright set belongs to
 * the dark ramp and is unreadable here. Gruvbox's light mode has no accent of its own: yellow
 * is the scheme's face on the dark ramp but far too light to carry a state on cream, so
 * faded_blue takes the primary role and the darkened yellow keeps `warning`, the role its
 * meaning already fits.
 *
 * Two things the mobile-web port could not do for this contract. Its cream ramp separated by
 * chroma alone — ΔE00 2.26 but 1.02:1, under the 1.03:1 every two grounds owe each other — so
 * the two raised grounds are re-seated with a lightness step as well. And its two lower ink
 * weights sat ΔE00 5.6 apart, under the 8 ink step, so `inkMuted` takes a deeper seat and
 * `inkDim` stays on the floor corner.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over the page (stepping in lightness at low chroma where a tint would sit at the
 * ink's own luminance, as the olive does); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the ink tinted.
 */
export const gruvboxLight: ThemeDefinition = {
	id: "gruvboxLight",
	name: "Gruvbox Light",
	description: "Retro groove by daylight, warm cream and faded ink.",
	palette: {
		mode: "light",

		canvas: "#FBF1C7",
		// Upstream defines light0_soft F2E5BC and light1 EBDBB2 BELOW the page, not above
		// it, so both raised grounds are derived: they shed the cream's chroma as they rise,
		// and take a lightness step too, because chroma alone measured 1.02:1 — under the
		// 1.03:1 floor two grounds owe each other.
		surface: "#FDF6D8",
		elevated: "#FFFCE8",
		// Upstream light0_soft, the scheme's own recessed tone.
		sunken: "#F2E5BC",

		ink: "#3C3836",
		// Canonical dark3 665C54 is 5.18:1 on `sunken` and only ΔE00 5.6 from dark4, under
		// the 8 ink step. Seated deeper along the same warm grey so the readout rung below
		// it takes a different name.
		inkMuted: "#574E47",
		// Canonical dark4 7C6F64 measures 3.87:1 on `sunken`, under the 4.5 floor for a
		// tertiary weight. Darkened minimally along its own warm gray; dark4 itself still
		// serves as the structural border below, where the floor is 3:1 and it clears with
		// room.
		inkDim: "#70645A",
		inkDisabled: "#A89984",

		hairline: "#DFD4B1",
		// Canonical dark4, which clears the 3:1 structural floor on every ground where
		// the lighter rules could not.
		borderControl: "#7C6F64",

		accent: "#076678",
		accentHover: "#04414D",
		accentActive: "#022026",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#004755",
		accentWash: "#F0EBC3",
		onAccent: "#FBF1C7",

		// Canonical faded_green 79740E is 3.87:1 on `sunken`; this is the smallest darkening
		// along the same olive that clears 4.5:1 on all four grounds.
		success: "#6E6800",
		successWash: "#EFEFE4",
		successBorder: "#847E0F",

		// Canonical faded_yellow B57614 is 3.00:1 on `sunken` — the largest miss in this
		// palette. Darkened along the same amber.
		warning: "#8E5B03",
		warningWash: "#F1EDE7",
		warningBorder: "#AA6E12",

		danger: "#9D0006",
		dangerWash: "#F8E9C0",
		dangerBorder: "#BC0007",

		// faded_aqua rather than faded_orange: the orange sat only ΔE00 10.8 from `danger`'s
		// faded_red — both dark red-orange on cream, so an error message and an informational
		// path read as one colour. Aqua is equally canonical, darkened one step to clear 4.5:1
		// on all four grounds.
		info: "#3B7050",
		infoWash: "#F8EFD1",
		infoBorder: "#588D6C",

		// The shadow and scrim are the ink tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(60 56 54 / 0.22)",
		scrim: "rgb(60 56 54 / 0.35)",
	},
};
