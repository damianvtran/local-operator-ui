import type { ThemeDefinition } from "../palette-contract";

/**
 * Tokyo Night Day — the light variant, completing the set beside the `tokyoNight` this app
 * already ships, and sharing its hues so the pair reads as one scheme in two modes.
 *
 * Unlike every other palette in this directory there is no published hex table to be faithful
 * to: upstream GENERATES `day` by inverting the `night` palette programmatically (lua/
 * tokyonight/colors/day.lua calls `Util.invert`). The values below are upstream's own generated
 * artifacts — extras/kitty/tokyonight_day.conf and extras/wezterm/tokyonight_day.toml, which
 * agree hex for hex: background E1E2E7, foreground 3760BF, blue 2E7DE9, red F52A65, green
 * 587539, yellow 8C6C3E, purple 9854F1, cyan 007197. Treat them as upstream's output rather
 * than as a spec — a retune of `night` moves all of them.
 *
 * Inversion preserves hue, not contrast, and this is the one palette here where nearly every
 * generated value misses: the generated foreground is 4.19:1 on the darkest ground where the
 * body floor is 7, and the six accents land between 2.78:1 and 3.95:1 against the 4.5 floor.
 * Each is re-solved along its own hue by the minimum that clears all four grounds, and the
 * measured miss is recorded per role below.
 *
 * The two lower ink weights are the exception to that minimum, and the reason is the ink step
 * this contract measures between them: the generated comment and dark5 are ΔE00 5.1 apart, so
 * `inkMuted` is seated deeper — still the generated comment's own indigo — until the readout
 * rung below it takes a different name.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1; a semantic
 * border walks its hue toward the ground to just above the 3:1 edge floor; the shadow and the
 * scrim are the ink tinted.
 */
export const tokyoNightDay: ThemeDefinition = {
	id: "tokyoNightDay",
	name: "Tokyo Night Day",
	description: "Tokyo Night at noon — cool paper under the same neon hues.",
	palette: {
		mode: "light",

		canvas: "#E1E2E7",
		// Generated inactive-tab C4C8DA sits far below the page and would cost every ink
		// two thirds of its headroom on the binding ground. The two raised grounds are seated
		// one visible step above the page instead (ΔE00 2.2 and 2.1).
		surface: "#EAEBEE",
		elevated: "#F3F4F5",
		// Generated inactive-tab C4C8DA is ΔE00 6.3 under the page — a well rather than a
		// recess. This is one just-visible step under canvas (ΔE00 2.06).
		sunken: "#D8DAE1",

		/*
		 * The current row's own ground:
		 * `surface` stepped -11 on every channel toward black — the neutral step the
		 * twelve use, and branch L of this port's selection rule; the ramp
		 * affords it here, so the row takes no cast. ΔE00 2.40 from `surface`,
		 * 4.39 from `elevated` and 2.35 from `sunken`.
		 */
		highlight: "#DFE0E3",

		// Generated foreground 3760BF is 4.19:1 on `sunken` — a syntax blue, not a body ink,
		// which is what the 7:1 floor is for. Deepened along the same indigo to 7.33:1.
		ink: "#233E7C",
		// Generated comment 6172B0 is 3.31:1 on `sunken` (< 4.5). Deepened, and then
		// deepened again so the generated dark5 below it clears the ΔE00 8 ink step — the
		// two generated tones sit only 5.1 apart.
		inkMuted: "#3A4883",
		// Generated dark5 8990B3 is 2.24:1 on `sunken` (< 4.5), the largest miss of the ink
		// weights. Deepened along its own hue, and kept a distinct rung from `inkMuted` above
		// rather than collapsing the two.
		inkDim: "#555D85",
		inkDisabled: "#8990B3",

		hairline: "#C5C9DB",
		// The generated comment blue, which clears the 3:1 structural floor (3.31:1 on
		// the binding ground) where it could not clear 4.5 as text.
		borderControl: "#6172B0",

		// Generated blue 2E7DE9 is 2.88:1 on `sunken` (< 4.5). Deepened along the same blue.
		accent: "#135BBE",
		accentHover: "#104895",
		accentActive: "#0C3671",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#003F90",
		accentWash: "#DADDE6",
		onAccent: "#E1E2E7",

		// Generated green 587539 is 3.74:1 on `sunken` (< 4.5). Deepened along the same
		// green.
		success: "#4E6632",
		successWash: "#DADCDE",
		successBorder: "#5B783A",

		// Generated yellow 8C6C3E is 3.47:1 on `sunken` (< 4.5). Deepened along the same
		// amber.
		warning: "#755A33",
		warningWash: "#DBDADC",
		warningBorder: "#896A3D",

		// Generated red F52A65 is 2.78:1 on `sunken` — the largest miss here. Deepened along
		// the same red.
		danger: "#BE063D",
		dangerWash: "#E0DDE3",
		dangerBorder: "#DC0A47",

		// Generated cyan 007197 is 3.95:1 on `sunken`, the narrowest miss of the six; deepened
		// one step along the same cyan.
		info: "#016689",
		infoWash: "#D8DDE3",
		infoBorder: "#0078A1",

		// The shadow and scrim are the ink tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(37 65 128 / 0.22)",
		scrim: "rgb(37 65 128 / 0.35)",
	},
};
