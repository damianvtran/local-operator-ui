import type { ThemeDefinition } from "../palette-contract";

/**
 * Alucard.
 *
 * Dracula's daylight counterpart — the same scheme with the ground inverted, so
 * it is deliberately a sibling of `dracula.ts` in this directory: the purple
 * accent, the red, the orange and the blue are the same hues, and only the
 * paper under them changed.
 *
 * Alucard's own ladder (bg fffbeb, surface fbf6e2, raised f5efd6,
 * highlight-med d9d4bd) cannot supply this contract's four grounds as it
 * stands: its top step measures ΔE00 1.81, under the 2.0 at which the captured
 * theme frames show a card reading as a separate surface from its canvas. It
 * is re-solved at the brand light pair's proportions, keeping `canvas` within
 * ΔE00 1.2 of upstream's bg.
 *
 * Roles Alucard has no value for follow the derivation rules recorded in
 * `rose-pine.ts`. Two deviations on top of them:
 *
 * - `borderControl` is upstream's `dim` rung rather than `edge-hi` d9d4bd,
 *   which is a ground colour doing a boundary's job: it bounds an input at
 *   1.5:1 against `elevated`, i.e. with no perceivable edge at all.
 * - `warning` steps deeper off the canonical orange a34d14. Alucard's orange
 *   and its red cb3a2a sit ΔE00 13.2 apart, under the 15 the contract wants
 *   between two semantics a reader meets alone and has to name.
 */
export const alucard: ThemeDefinition = {
	id: "alucard",
	name: "Alucard",
	description: "Dracula's daylight: warm parchment under an indigo accent.",
	palette: {
		mode: "light",

		canvas: "#F9F5E5",
		surface: "#FCF9EE",
		elevated: "#FFFEF9",
		sunken: "#F1ECD9",

		ink: "#1F1F1F",
		inkMuted: "#4F4A37",
		inkDim: "#6C664B",
		inkDisabled: "#9B937A",

		hairline: "#DDD8C6",
		borderControl: "#6C664B",

		accent: "#644AC9",
		accentHover: "#4E35B0",
		accentActive: "#402B91",
		// ΔE00 10.4 from `accent` and 9.4:1 on surface, where the accent is
		// 5.9:1.
		chartBarHover: "#4A27A6",
		accentWash: "#FAF5EA",
		onAccent: "#FFFBEB",

		success: "#14710A",
		successWash: "#F8F7E4",
		successBorder: "#17830C",

		// canonical orange, stepped deeper; see the header.
		warning: "#843200",
		warningWash: "#FBF3E1",
		warningBorder: "#954100",

		// canonical red cb3a2a, lifted to clear 4.5:1 on the deepest ground.
		danger: "#C53324",
		dangerWash: "#FDF4E4",
		dangerBorder: "#D85041",

		info: "#036A96",
		infoWash: "#F5F5E8",
		infoBorder: "#037BAE",

		overlayShadow: "0 12px 32px -12px rgb(31 31 31 / 0.22)",
		scrim: "rgb(31 31 31 / 0.35)",
	},
};
