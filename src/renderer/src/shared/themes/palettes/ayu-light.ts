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
		 * The current row's own ground: `surface` stepped 6.10 `L*` down at the panel's own
		 * hue (0.3 degrees off, inside the 12-degree bound) and carried
		 * 4.37 `C*` against the panel's 2.89 — the panel's own colour, one step darker, which
		 * is what the operator asked for. ΔE00 from `surface` 3.93, from
		 * `elevated` 6.85, from `sunken` 0.81. Ink on this ground: `ink` 7.24:1,
		 * `ink-muted` 6.17:1, `ink-dim` 4.65:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `2.21x` the panel's
		 * chroma (6.38 `C*` against 2.89), 2 degrees off its hue, ΔE00 4.12 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 */
		highlight: "#DEE7ED",

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
