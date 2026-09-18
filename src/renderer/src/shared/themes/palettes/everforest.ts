import type { ThemeDefinition } from "../palette-contract";

/**
 * Everforest.
 *
 * Carried from sainnhe/everforest (`palette.md`, dark/medium): the bg_dim to
 * bg2 ground ladder, the signature green, the yellow, the purple and the grey
 * ramp.
 *
 * Everforest is designed for soft contrast, so this is the palette the fourth
 * ground costs the most. The TUI port measures ink against two grounds; this
 * contract measures every ink and semantic against all four, and the lightest —
 * `elevated` 3D484D — is what binds: canonical fg D3C6AA sits at 5.57:1 there
 * and canonical red E67E80 at 3.43:1, both under their floors. The ink ramp is
 * therefore lifted on-hue, and `inkMuted` is taken past its own floor so that
 * it stays visibly a rung above `inkDim` rather than collapsing into it.
 *
 * The other roles follow the derivation rules recorded in `rose-pine.ts`.
 * `accent` is the canonical green rather than upstream's syntax-role name for
 * "blue": the green is this scheme's identity, and spending it on a success
 * glyph while painting the app's most common ink pink is the wrong reading of
 * upstream's token names — the TUI palette maps the same way.
 */
export const everforest: ThemeDefinition = {
	id: "everforest",
	name: "Everforest",
	description: "Low-contrast forest night, moss green over warm slate.",
	palette: {
		mode: "dark",

		canvas: "#2D353B",
		surface: "#343F44",
		elevated: "#3D484D",
		sunken: "#232A2E",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.07 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 3.25 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.17 from `surface`, 3.39 from `elevated` and 9.86 from `sunken`;
		 * the step is 3.27 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.67:1 the ink that binds it.
		 */
		highlight: "#3B4747",

		// fg D3C6AA is 5.57:1 on `elevated`, under the 7:1 floor; lifted.
		ink: "#E6DECD",
		// grey2 9DA9A0 is 3.86:1 on `elevated`, and the 4.5 floor leaves it too
		// close to `inkDim` for the contract's ΔE00 8 ink step.
		inkMuted: "#CFD8D0",
		// grey1 859289 is 2.90:1 on `elevated`.
		inkDim: "#ADB7B0",
		// grey0, the scheme's own inert-hint grey.
		inkDisabled: "#7A8478",

		hairline: "#49545B",
		// bg4 4F585E is 1.29:1 on `elevated` — a ground colour doing a
		// boundary's job. Lifted along the same cool grey.
		borderControl: "#89949C",

		// canonical green.
		accent: "#A7C080",
		accentHover: "#B7D28C",
		// A saturation step, not a darker one: the green is already at 4.70:1
		// on its worst ground, so stepping down in lightness breaks the floor.
		accentActive: "#A0C06D",
		// ΔE00 10.3 from `accent` and 8.3:1 on surface, where the accent is
		// 5.4:1.
		chartBarHover: "#D0EBA9",
		tokenCommand: "#9ACAC3",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#3A4448",
		onAccent: "#2D353B",

		success: "#A7C080",
		successWash: "#3A4442",
		successBorder: "#A7C080",

		// canonical yellow.
		warning: "#DBBC7F",
		warningWash: "#454842",
		warningBorder: "#DBBC7F",

		// canonical red E67E80, lifted for `elevated`.
		danger: "#EEA2A2",
		dangerWash: "#434147",
		dangerBorder: "#ECA0A1",

		// The blue-teal the TUI port maps to `signal`, so `info` is the same role
		// here; Everforest's purple is left to the callout's border rather than
		// doubling the green family in a second hue.
		info: "#9ACAC3",
		infoWash: "#42424C",
		infoBorder: "#DEA3C6",

		overlayShadow: "0 12px 32px -12px rgb(20 25 27 / 0.7)",
		scrim: "rgb(20 25 27 / 0.6)",
	},
};
