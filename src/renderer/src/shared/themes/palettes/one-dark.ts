import type { ThemeDefinition } from "../palette-contract";

/**
 * One Dark — Atom's official syntax theme, from atom/one-dark-syntax (styles/colors.less).
 *
 * Upstream defines this palette in HSL, so the values here are that source converted: mono-1
 * hsl(220,13%,18%) = 282C34 as the page, mono-2 = 2D3139 and mono-3 = 333842 as the two raised
 * grounds, mono-0 = 21252B as the well below; hue-1 cyan 56B6C2, hue-2 blue 61AFEF, hue-3
 * purple C678DD, hue-4 green 98C379, hue-5 red E06C75, hue-6-2 orange E5C07B.
 *
 * One Dark is tuned for syntax on charcoal, where a token only has to be readable beside its
 * neighbours and nothing has to clear 7:1: the foreground lands at 5.95:1 on the raised ground
 * and the red at 3.26:1, so both are lifted along their own hues, with the miss recorded at the
 * role. The blue takes the accent, unmodified, and the cyan keeps `info` so a callout does not
 * read as a primary action.
 *
 * The two lower ink weights are the third solve, and it is a contrast one rather than an ink
 * step: the scheme's comment grey is a syntax tone at 2.84:1 on the raised ground, so both are
 * lifted along the same neutral — the quieter one to the floor corner, and the pair ends up
 * ΔE00 8.2 apart, which the ink step asks for anyway.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the ground tinted.
 */
export const oneDark: ThemeDefinition = {
	id: "oneDark",
	name: "One Dark",
	description: "Atom's night standard — cool charcoal with the One accent row.",
	palette: {
		mode: "dark",

		// Upstream mono-1, the page.
		canvas: "#282C34",
		// Upstream mono-2, and `elevated` is mono-3: the scheme's own two raised tones.
		// ΔE00 2.2 and 2.4 up the ladder, with the well one step under mono-0.
		surface: "#2F343D",
		elevated: "#3A404B",
		sunken: "#21252B",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.08 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 4 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.05 from `surface`, 2.35 from `elevated` and 8.64 from `sunken`;
		 * the step is 4.16 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.79:1 the ink that binds it.
		 */
		highlight: "#333E4B",

		// Canonical mono-4 BEC4D0 is 5.95:1 on `elevated` — the 7:1 body floor is more than a
		// reach for a syntax foreground. Lifted along the same cool neutral.
		ink: "#CED5E1",
		// The scheme's lighter comment tier lifted to clear 4.5:1, and seated above its own tone
		// so the readout rung below it keeps the ΔE00 8 ink step.
		inkMuted: "#C3CCDA",
		// The comment grey 7D8695 is 2.84:1 on `elevated` (< 4.5) — it is a syntax comment,
		// not a UI metadata tone. Lifted along its own neutral to the floor corner.
		inkDim: "#A3ADBC",
		inkDisabled: "#5C6370",

		// Derived: the scheme has no rule colour. Holds ΔE00 4.1 from every ground and
		// 1.21-1.79:1 against them, so it divides rather than bounds.
		hairline: "#464C58",
		// Upstream gutter 4B5263 is 1.36:1 against the grounds — a decorative value in
		// a structural role. Lifted along the same neutral to 3.1:1 on the lightest
		// ground.
		borderControl: "#848B9E",

		accent: "#61AFEF",
		accentHover: "#8DCBFF",
		accentActive: "#4F9DDC",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#9ED2FF",
		accentWash: "#28333C",
		onAccent: "#21252B",

		success: "#98C379",
		successWash: "#3E4943",
		successBorder: "#6E974E",

		warning: "#E5C07B",
		warningWash: "#555048",
		warningBorder: "#A98641",

		// Canonical red E06C75 is 3.26:1 on `elevated` (< 4.5), the widest miss here. Lifted
		// along the same red, which keeps it a syntax token and a danger callout at once.
		danger: "#FF8990",
		dangerWash: "#362A31",
		dangerBorder: "#DA6870",

		info: "#56B6C2",
		infoWash: "#263647",
		infoBorder: "#3498A4",

		// The shadow and scrim are the ground tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
