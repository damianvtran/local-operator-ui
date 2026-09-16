import type { ThemeDefinition } from "../palette-contract";

/**
 * Ayu Dark.
 *
 * Carried from ayu-theme's `dark` variant: the near-black blue ground, the
 * bright azure accent, and the green, orange, red and violet semantics. Ayu is
 * a family of three — `ayu-mirage.ts` and `ayu-light.ts` are the other two —
 * and all three carry the same accent hue, so a user switching between them
 * sees one scheme change temperature rather than identity.
 *
 * Ayu's ground ladder is upstream's own (bg 0f1419, surface 141821, raised
 * 161a24), reordered onto this contract's four grounds, with `sunken` one step
 * below; its steps measure ΔE00 2.3 against the 2.0 field floor. Roles the
 * scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`.
 *
 * `inkDim` is the one ink that moves: the scheme's dim rung sits a step too
 * close to `inkMuted` for the contract's ΔE00 8 ink step, so the readout rung
 * relaxes away from it rather than the control rung collapsing into `ink`.
 */
export const ayuDark: ThemeDefinition = {
	id: "ayuDark",
	name: "Ayu Dark",
	description: "Ayu's night: near-black blue with a bright azure accent.",
	palette: {
		mode: "dark",

		canvas: "#10141C",
		surface: "#181D27",
		elevated: "#222834",
		sunken: "#080A0F",

		ink: "#BFBDB6",
		inkMuted: "#ACB6BF",
		// the scheme's dim rung, relaxed to clear ΔE00 8 from `inkMuted`.
		inkDim: "#88919C",
		inkDisabled: "#565B66",

		hairline: "#30353F",
		// upstream's ui line 2B3038 is 1.11:1 on `elevated` — a ground colour
		// doing a boundary's job. Lifted along the same blue-grey.
		borderControl: "#667284",

		// upstream's accent, the family's signature azure.
		accent: "#59C2FF",
		accentHover: "#7DCFFF",
		accentActive: "#09A5FF",
		// ΔE00 10.5 from `accent` and 11.1:1 on surface, where the accent is
		// 8.5:1.
		chartBarHover: "#77DFFF",
		accentWash: "#152431",
		onAccent: "#0D1017",

		success: "#AAD94C",
		successWash: "#181F1F",
		successBorder: "#AAD94C",

		warning: "#FFB454",
		warningWash: "#232120",
		warningBorder: "#FFB454",

		danger: "#F07178",
		dangerWash: "#221B23",
		dangerBorder: "#F07178",

		info: "#D2A6FF",
		infoWash: "#222232",
		infoBorder: "#D2A6FF",

		overlayShadow: "0 12px 32px -12px rgb(5 6 9 / 0.8)",
		scrim: "rgb(5 6 9 / 0.65)",
	},
};
