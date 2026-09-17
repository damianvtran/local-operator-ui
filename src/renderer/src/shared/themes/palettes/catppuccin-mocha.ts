import type { ThemeDefinition } from "../palette-contract";

/**
 * Catppuccin Mocha — the flavour the family is named for, from catppuccin/palette v1.8.0.
 *
 * Base 1E1E2E is the page and mantle 181825 sits below it. Upstream surface0 313244 is ΔE00
 * 6.35 from base on its own — one step where this ladder needs two — so `surface` and
 * `elevated` are seated between them at ΔE00 2.2 and 2.1.
 *
 * Text CDD6F4 is `ink`, subtext1 BAC2DE is `inkMuted` and overlay2 939AB7 is `inkDim`,
 * skipping subtext0 so the control rung and the readout rung clear this contract's ΔE00 8 ink
 * step. `inkDisabled` is upstream overlay0. Mauve CBA6F7 carries the accent and the
 * green/peach/red/blue row is upstream's, unmodified — mocha's ground is dark enough that not
 * one of them needed a lift.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the crust tinted.
 */
export const catppuccinMocha: ThemeDefinition = {
	id: "catppuccinMocha",
	name: "Catppuccin Mocha",
	description:
		"The original flavour — the deepest navy under the Catppuccin pastels.",
	palette: {
		mode: "dark",

		canvas: "#1E1E2E",
		// Seated between base and upstream surface0, which is ΔE00 6.1 from base on its own:
		// one step where this ramp needs two. ΔE00 2.2 and 2.2 up the ladder.
		surface: "#252535",
		elevated: "#2A2A3D",
		sunken: "#181825",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.05 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 5.25 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.19 from `surface`, 2.19 from `elevated` and 8.34 from `sunken`;
		 * the step is 5.11 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.66:1 the ink that binds it.
		 */
		highlight: "#312F44",

		ink: "#CDD6F4",
		inkMuted: "#BAC2DE",
		// Upstream overlay2, taking the readout rung so the ink step clears (subtext0 is only
		// ΔE00 5.7 from subtext1 and may not).
		inkDim: "#939AB7",
		inkDisabled: "#6C7086",

		// Upstream surface1, seated at ΔE00 5.6 from `elevated`: a 1px line needs 4.0, and this
		// one stays between 1.21:1 and 1.51:1 on the four grounds so it divides rather than
		// bounds.
		hairline: "#363653",
		// Upstream surface1 45475A is 1.54:1 against the lightest ground — a decorative value
		// in a structural role, and the one role a palette is most likely to get wrong.
		// Walked away from the grounds along the same slate to 3.1:1, which is where every
		// shipped palette's structural edge sits.
		borderControl: "#727589",

		accent: "#CBA6F7",
		accentHover: "#DCC1FF",
		accentActive: "#B691E0",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.3
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#E2CCFF",
		accentWash: "#28283E",
		onAccent: "#11111B",

		success: "#A6E3A1",
		// The scheme has no green tint, so the wash is the green tinted over `canvas` at
		// the strongest alpha (13%) that keeps the green itself at 4.5:1 on it.
		successWash: "#4B5E57",
		successBorder: "#498346",

		warning: "#FAB387",
		// The peach tinted over `canvas`, same rule as the green above.
		warningWash: "#5D4B4C",
		warningBorder: "#A6663B",

		danger: "#F38BA8",
		dangerWash: "#332434",
		// The danger hue walked toward the ground to just above the 3:1 the control's
		// only edge is asked for.
		dangerBorder: "#B75673",

		info: "#89B4FA",
		infoWash: "#213048",
		infoBorder: "#4E76B7",

		// The shadow and scrim are the crust tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
