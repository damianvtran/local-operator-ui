import type { ThemeDefinition } from "../palette-contract";

/**
 * Catppuccin Latte — the light flavour, from catppuccin/palette v1.8.0.
 *
 * Latte is the family's daylight member and its ramp runs the other way: base EFF1F5 is the
 * page, mantle E6E9EF and crust DCE0E8 sit BELOW it, and the two raised grounds are derived
 * above the page at ΔE00 2.2 each, because upstream has nothing there — its own surface0/1/2
 * are darker than base and belong to the recessed side of this system, not the raised one.
 * The page is seated a step below upstream's base (E6E9EF → E4E7EE) so that four rungs remain
 * visible at all above the crust.
 *
 * Text 4C4F69 is `ink` (lifted), subtext1 5C5F77 and subtext0 6C6F85 are the two lower
 * weights, reseated so the control rung and the readout rung clear this contract's ΔE00 8 ink
 * step: the scheme's own tiers sit 6.0 apart and both sit close to the 4.5:1 floor on `sunken`.
 * `inkDisabled` is upstream overlay0.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the ink tinted.
 */
export const catppuccinLatte: ThemeDefinition = {
	id: "catppuccinLatte",
	name: "Catppuccin Latte",
	description:
		"The light flavour — cool paper under the same Catppuccin pastels.",
	palette: {
		mode: "light",

		// The page is seated where the ladder can hold four rungs: upstream mantle E6E9EF is
		// eased one step down to E4E7EE, because the two raised grounds above base (EFF1F5,
		// which is only ΔE00 3.5 from white) would otherwise collapse into each other.
		// The scheme's own base EFF1F5 moves up to `surface`.
		canvas: "#E4E7EE",
		// Upstream base, the scheme's own page.
		surface: "#EFF1F5",
		// Derived: upstream stops at base, and this system needs a second raised step.
		// ΔE00 2.23 from `surface`, with the chroma shed as it rises because there is no
		// lightness left between the page and white.
		elevated: "#F8F9FA",
		sunken: "#DCE0E8",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.02 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 5.25 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.1 from `surface`, 6.16 from `elevated` and 2.03 from `sunken`;
		 * the step is -5.36 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.66:1 the ink that binds it.
		 */
		highlight: "#E1E1E9",

		// Canonical text 4C4F69 is 6.04:1 on `sunken` — under the 7:1 body floor. Deepened
		// along the same indigo-blue.
		ink: "#42455E",
		// Canonical subtext1 5C5F77 is 4.73:1 on `sunken` and only ΔE00 6.0 from subtext0,
		// which is under the 8 ink step. Seated deeper along the same slate so the readout
		// rung below it takes a different name.
		inkMuted: "#474A60",
		// Canonical subtext0 6C6F85 is 3.73:1 on `sunken`, well under the 4.5 floor for a
		// readout tone. Deepened along its own slate; still the quietest of the three rungs.
		inkDim: "#5F6177",
		inkDisabled: "#9CA0B0",

		// Derived: upstream's own rules are darker tones meant to sit on the page as panels,
		// not as 1px lines. This holds ΔE00 4.2 from every ground and 1.19-1.49:1 against
		// them.
		hairline: "#CBCED7",
		// Upstream surface2 BCC0CC is 1.37:1 against the grounds — a decorative value
		// in a structural role. The structural edge is the muted tone walked to 3.1:1
		// on the darkest ground.
		borderControl: "#7A7E89",

		// Canonical mauve 8839EF is 4.09:1 on `sunken` (< 4.5). Deepened along the same
		// violet.
		accent: "#802EE6",
		accentHover: "#7A22E0",
		accentActive: "#6C16C9",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#6100B8",
		tokenCommand: "#0B55E4",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#E4ECF9",
		// The page tone. The mauve fill is dark enough that the palette's own lightest
		// neutral is the legible ink on it (4.9:1 at the worst of the three states).
		onAccent: "#EFF1F5",

		// Upstream's green 40A02B is 2.53:1 on `sunken` — a syntax colour, not UI text. The
		// darkened green the port carried is deepened one step further to clear 4.5 on all
		// four grounds.
		success: "#257113",
		successWash: "#DBE1E4",
		successBorder: "#448E35",

		// Canonical yellow DF8E1D is 1.98:1 on `sunken` — unreadable as text on this page; the
		// port's darkened amber deepened one more step to clear 4.5 on all four grounds.
		warning: "#855A00",
		warningWash: "#E0E0E4",
		warningBorder: "#A3762C",

		// Canonical red D20F39 is 4.10:1 on `sunken` (< 4.5). Deepened along the same red.
		danger: "#C60133",
		dangerWash: "#F6DFE1",
		dangerBorder: "#E93A4F",

		// Canonical blue 1E66F5 is 3.71:1 on `sunken` (< 4.5). Deepened along the same blue.
		info: "#0B55E4",
		infoWash: "#E3ECFB",
		infoBorder: "#3276FF",

		// The shadow and scrim are the ink tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(76 79 105 / 0.22)",
		scrim: "rgb(76 79 105 / 0.35)",
	},
};
