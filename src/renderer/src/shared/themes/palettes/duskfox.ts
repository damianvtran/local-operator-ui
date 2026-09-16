import type { ThemeDefinition } from "../palette-contract";

/**
 * Duskfox.
 *
 * Carried from EdenEast/nightfox's `duskfox` variant, and deliberately a
 * sibling of `nightfox.ts`: the same accent, green, yellow, red and cyan hues
 * over a ground warmed into violet. A user picking between the two is choosing
 * a temperature, not a scheme, so the accent row is the same one.
 *
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`; the ground ladder takes the same proportions as Nightfox's,
 * for the same reason — four grounds, each a visible step from the next.
 */
export const duskfox: ThemeDefinition = {
	id: "duskfox",
	name: "Duskfox",
	description: "Nordfox at dusk: the same slate warmed into violet plum.",
	palette: {
		mode: "dark",

		canvas: "#232136",
		surface: "#2D2A45",
		elevated: "#373354",
		sunken: "#191726",

		/*
		 * The current row's own ground:
		 * `surface` stepped +7/+7/+6 on R/G/B toward white — the neutral step the
		 * twelve use, and branch L of this port's selection rule; the ramp
		 * affords it here, so the row takes no cast. ΔE00 2.27 from `surface`,
		 * 2.68 from `elevated` and 9.50 from `sunken`.
		 */
		highlight: "#34314B",

		ink: "#E0DEF4",
		inkMuted: "#CDCBE0",
		inkDim: "#A9A4C4",
		inkDisabled: "#6E6A86",

		hairline: "#463F5C",
		borderControl: "#887BA3",

		// the scheme's teal-blue accent, shared with Nightfox.
		accent: "#72AFC6",
		accentHover: "#8BBDD0",
		accentActive: "#68A9C2",
		// ΔE00 10.5 from `accent` and 8.7:1 on surface, where the accent is
		// 5.7:1.
		chartBarHover: "#98D7EE",
		accentWash: "#2E354A",
		onAccent: "#191726",

		success: "#A3BE8C",
		successWash: "#31323F",
		successBorder: "#A3BE8C",

		warning: "#F6C177",
		warningWash: "#38313C",
		warningBorder: "#F6C177",

		danger: "#EF7D9D",
		dangerWash: "#3C2C43",
		dangerBorder: "#ED7C9C",

		info: "#9CCFD8",
		infoWash: "#323649",
		infoBorder: "#9CCFD8",

		overlayShadow: "0 12px 32px -12px rgb(14 12 22 / 0.75)",
		scrim: "rgb(14 12 22 / 0.62)",
	},
};
