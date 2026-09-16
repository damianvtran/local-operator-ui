import type { ThemeDefinition } from "../palette-contract";

/**
 * Solarized Light — Ethan Schoonover's Solarized, light variant, and the daylight half of the
 * pair with `solarizedDark`: the same sixteen tones, the same accent set, the ground moved to
 * base3 FDF6E3 with base2 EEE8D5 as the well below it.
 *
 * Solarized's light mode is deliberately warm — base3 is a cream, not a white — and the two
 * raised grounds it has no token for are DERIVED by shedding that cream's chroma as they rise,
 * which keeps the warmth in the page and still leaves four visible steps. Base02 073642 is the
 * body ink, base01 586E75 and base00 657B83 the lower weights.
 *
 * As on the dark side, the scheme's precision is in its hue relationships rather than in
 * contrast against a hard floor: base01 as the control ink is 4.39:1 on the darkest ground and
 * base00 as the readout ink is 3.64:1, both under 4.5, and the accents land between 3.8:1 and
 * 4.5:1. Each is moved along its own hue by the minimum that clears all four grounds, and every
 * measured miss is recorded at its role below.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over the page at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the ink tinted.
 */
export const solarizedLight: ThemeDefinition = {
	id: "solarizedLight",
	name: "Solarized Light",
	description:
		"Schoonover's precision light — warm paper with the Solarized hues.",
	palette: {
		mode: "light",

		canvas: "#FDF6E3",
		// Derived: upstream stops at base3 and this system needs two raised grounds above
		// the page. Both shed the cream's chroma as they rise (ΔE00 2.86 and 3.64), because
		// a ramp this close to white has almost no lightness left to spend.
		surface: "#FEFAEE",
		elevated: "#FFFEFA",
		// Upstream base2, the scheme's own recessed tone.
		sunken: "#EEE8D5",

		ink: "#073642",
		// Canonical base01 586E75 is 4.39:1 on `sunken` — under the 4.5 floor, and only
		// ΔE00 3.2 from base00, under the 8 ink step. Seated deeper along the same
		// grey-teal, which solves both at once.
		inkMuted: "#3F545B",
		// Canonical base00 657B83 is 3.64:1 on `sunken`. Deepened along its own grey-teal to
		// the floor corner; it is the quietest of the three weights and the one the editor
		// paints comments in.
		inkDim: "#566B73",
		inkDisabled: "#93A1A1",

		// Derived: base2 is a panel fill, not a 1px line. Holds ΔE00 4.1 from every ground
		// and 1.18-1.43:1 against them.
		hairline: "#DED7C0",
		// The scheme's own rules are cream tones: edge-hi D5CDAE is 1.30:1 against the page, and
		// base2 is 1.14:1, so neither can be a control's only edge. The structural role is that
		// rule tone walked away from the grounds to 3.1:1 instead.
		borderControl: "#8B8467",

		// Upstream blue 268BD2 deepened, and then deepened once more for the 4.5 floor on this
		// ground (4.49:1 on the recessed step). The scheme's defining blue, kept.
		accent: "#1A6CA2",
		accentHover: "#155B8A",
		accentActive: "#0F4770",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.5
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#004E7C",
		accentWash: "#EAEFD2",
		onAccent: "#FFFEFA",

		// Upstream green 859900 is 2.62:1 on `sunken`. Darkened along the same olive, and kept
		// distinct from the yellow below.
		success: "#5E6E00",
		successWash: "#EDE9CF",
		successBorder: "#7A8B2E",

		// Upstream yellow B58900 is 2.62:1 on `sunken`. Darkened along the same amber, and kept
		// distinct from the olive above.
		warning: "#836201",
		warningWash: "#F2E8D0",
		warningBorder: "#A17F2F",

		// Upstream red DC322F is 3.77:1 on `sunken` (< 4.5). Darkened along the same red.
		danger: "#CB1C20",
		dangerWash: "#FCEFE6",
		dangerBorder: "#EE4640",

		// Upstream cyan 2AA198 is 2.58:1 on `sunken`. Darkened along the same teal — the cyan
		// rather than a second blue, so an info callout does not read as a primary action.
		info: "#007469",
		infoWash: "#E4ECEC",
		infoBorder: "#339286",

		// The shadow and scrim are the ink tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(7 54 66 / 0.22)",
		scrim: "rgb(7 54 66 / 0.35)",
	},
};
