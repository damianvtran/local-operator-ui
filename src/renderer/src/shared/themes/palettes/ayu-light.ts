import type { ThemeDefinition } from "../palette-contract";

/**
 * Ayu Light.
 *
 * The light end of the Ayu family — `ayu-dark.ts` and `ayu-mirage.ts` are the
 * other two — and the same scheme again: the azure accent, the green, orange,
 * red and violet are Ayu's own, deepened for ink on a white-grey paper rather
 * than hue-shifted. That shared accent row is what makes the three one family,
 * so a user switching between them sees the temperature change and nothing
 * else.
 *
 * The ground ladder is upstream's rungs in this contract's order — its bg fcfcfc
 * as `elevated` — over a blue-tinted paper rather than the near-white itself,
 * which would leave no room for a visible step above `canvas`. Adjacent steps
 * measure ΔE00 2.5 / 3.4 / 7.5. Roles the scheme has no value for follow the
 * derivation rules recorded in `rose-pine.ts`.
 *
 * One note on the inks: adding the fourth ground leaves the scheme's dim rung
 * 0.02 above its 4.5:1 floor, so the contract's ΔE00 8 ink step is bought by
 * pulling `inkMuted` toward `ink` rather than by moving the readout rung.
 */
export const ayuLight: ThemeDefinition = {
	id: "ayuLight",
	name: "Ayu Light",
	description: "Ayu's daylight: white-grey paper with a deep azure accent.",
	palette: {
		mode: "light",

		canvas: "#E7EEF5",
		surface: "#F2F8FC",
		elevated: "#FFFFFF",
		sunken: "#DBE4EB",

		/*
		 * The current row's own ground:
		 * `surface` stepped -11 on every channel toward black — the neutral step the
		 * twelve use, and branch L of this port's selection rule; the ramp
		 * affords it here, so the row takes no cast. ΔE00 2.29 from `surface`,
		 * 4.92 from `elevated` and 2.61 from `sunken`.
		 */
		highlight: "#E7EDF1",

		ink: "#45494D",
		inkMuted: "#505357",
		inkDim: "#5B6675",
		inkDisabled: "#9AA3AF",

		hairline: "#CBD2D6",
		borderControl: "#758295",

		// the family's azure, deepened for ink on this paper.
		accent: "#125F94",
		accentHover: "#0E4B74",
		accentActive: "#1468A3",
		// ΔE00 10.6 from `accent` and 9.9:1 on surface, where the accent is
		// 6.4:1.
		chartBarHover: "#004073",
		accentWash: "#D5E2EC",
		onAccent: "#FFFFFF",

		success: "#526D00",
		successWash: "#DBE4E1",
		successBorder: "#536E00",

		warning: "#885C00",
		warningWash: "#E0E3E3",
		warningBorder: "#895C00",

		danger: "#B43738",
		dangerWash: "#E4E1E8",
		dangerBorder: "#B53838",

		info: "#8148B8",
		infoWash: "#DFE1F0",
		infoBorder: "#8149B9",

		overlayShadow: "0 12px 32px -12px rgb(92 97 102 / 0.25)",
		scrim: "rgb(69 73 77 / 0.45)",
	},
};
