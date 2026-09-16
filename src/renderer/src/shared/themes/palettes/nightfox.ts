import type { ThemeDefinition } from "../palette-contract";

/**
 * Nightfox.
 *
 * Carried from EdenEast/nightfox's `nightfox` variant: the slate-blue ground,
 * the pale azure accent, and the scheme's green, yellow, red and cyan. It is
 * the dark half of the fox pair with `duskfox.ts`, which is the same scheme
 * warmed toward violet.
 *
 * The ground ladder is upstream's own (bg 192330, surface 212e3f, raised
 * 29394f), reordered onto this contract's four grounds and unchanged: its
 * steps measure ΔE00 3.8 / 4.0, which is already a visible step per ground.
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`.
 *
 * Two values move for reasons beyond those rules:
 *
 * - `inkDim` relaxes away from `inkMuted`: the scheme's dim rung sits a step
 *   too close to the muted one for the contract's ΔE00 8 ink step.
 * - `info` is the cyan lifted off 63cdcf. At canonical it sits ΔE00 14.0 from
 *   the scheme's green, under the 15 the contract wants between two semantics a
 *   reader meets alone and has to name.
 */
export const nightfox: ThemeDefinition = {
	id: "nightfox",
	name: "Nightfox",
	description: "Nordfox night: slate blue under a pale azure accent.",
	palette: {
		mode: "dark",

		canvas: "#192330",
		surface: "#212E3F",
		elevated: "#29394F",
		sunken: "#131A24",

		ink: "#CDCECF",
		inkMuted: "#AEAFB0",
		// the scheme's dim rung, relaxed to clear ΔE00 8 from `inkMuted`.
		inkDim: "#94A3B6",
		inkDisabled: "#738091",

		hairline: "#35465C",
		// the scheme's own border blue 6483ad, which is already at 3:1.
		borderControl: "#6483AD",

		// the scheme's pale azure.
		accent: "#8FB1DF",
		accentHover: "#ABC4E7",
		accentActive: "#7AA3D9",
		// ΔE00 10.5 from `accent` and 9.5:1 on surface, where the accent is
		// 6.2:1.
		chartBarHover: "#B6DAFF",
		accentWash: "#20304A",
		onAccent: "#131A24",

		success: "#81B29A",
		successWash: "#26353D",
		successBorder: "#81B29A",

		warning: "#DBC074",
		warningWash: "#2B3236",
		warningBorder: "#DBC074",

		danger: "#DD8B9F",
		dangerWash: "#302F3D",
		dangerBorder: "#DB899D",

		// the scheme's cyan, lifted; see the header.
		info: "#6FD8DA",
		infoWash: "#213541",
		infoBorder: "#63CDCF",

		overlayShadow: "0 12px 32px -12px rgb(10 14 20 / 0.75)",
		scrim: "rgb(10 14 20 / 0.62)",
	},
};
