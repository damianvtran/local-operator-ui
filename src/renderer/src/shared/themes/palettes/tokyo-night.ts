import type { ThemeDefinition } from "../palette-contract";

/**
 * Tokyo Night.
 *
 * Carried from the upstream scheme: background 1A1B26, the raised blue-black,
 * foreground C0CAF5, comment 565F89, the blue and purple accents, and the
 * green, yellow, red and cyan that the scheme already names. The comment
 * colour does triple duty here as inkDisabled, hairline and — lightened —
 * the structural border.
 */
export const tokyoNight: ThemeDefinition = {
	id: "tokyoNight",
	name: "Tokyo Night",
	description: "Deep blue-purple night with a bright blue accent.",
	palette: {
		mode: "dark",

		canvas: "#1A1B26",
		surface: "#24283B",
		elevated: "#2F334D",
		// Upstream bg_dark is 16161E, which measures 1.05:1 against canvas. Two
		// levels deeper for a little more separation.
		sunken: "#14141B",
		/*
		 * The current row's own ground: `surface` stepped up its own blue-purple ramp, and warmed to 1.5x its chroma. ΔE00 4.24 from `surface`,
		 * 2.47 from `elevated` (the same row's hover step, so the pointer cannot
		 * erase the selection) and 12.66 from `sunken`.
		 *
		 * The step was authored at ΔE00 2.18-2.28 from `surface` for a selection the
		 * operator first asked to be SUBTLE; he has since seen it rendered and
		 * reported it as invisible beside a hovered neighbour, so the intent is
		 * inverted and the role now carries 1.5x the surface's chroma at the same
		 * hue. § 3 of `docs/branding.md` names the chroma axis as the cheap one —
		 * a contrast ratio has no chroma term, so separating two grounds by warmth at
		 * a fixed L* spends no ink assertion, while separating them by lightness
		 * spends every one measured against them. A pure lightness step stops at
		 * ΔE00 3.52 here because `ink-dim` reaches 4.72:1 there and `border-control` 3.15:1.
		 *
		 * Ink on this ground: `ink` 8.36:1, `ink-muted` 6.39:1, `ink-dim`
		 * 5.11:1 — every floor in § 3 cleared with headroom above it, because the
		 * caps and the `· lopdev` binding inside a current row are drawn in `ink-dim`
		 * and legibility is not what the mark may spend. The structural edge the row
		 * now carries measures 3.41:1 against it, over the 3:1 that role's floor
		 * asks for. The theme in the operator's own screenshot, where the row measured ΔE00 2.23 and read as no mark at all beside a hovered neighbour at 4.58. `ink` is the tight ink here at 8.36:1 against the 7:1 floor, and the chroma lift is 1.5x at the surface's own hue.
		 */
		highlight: "#262d4a",

		ink: "#C0CAF5",
		inkMuted: "#A9B1D6",
		// The comment blue lightened to clear 4.5:1 on all four grounds; the
		// comment colour itself is inkDisabled.
		inkDim: "#979EBE",
		inkDisabled: "#565F89",

		hairline: "#3D4462",
		// The comment blue lightened again. The old theme used it at 30 percent
		// alpha for both the decorative rule and the input boundary, which put
		// every input at about 1.3:1.
		borderControl: "#757EA9",

		accent: "#7AA2F7",
		accentHover: "#9EBCFF",
		accentActive: "#6D8FDA",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 8.25:1 on surface, where the accent
		// itself is 5.78:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#AAC3FA",
		accentWash: "#262B3F",
		onAccent: "#1A1B26",

		// Upstream Tokyo Night green.
		success: "#9ECE6A",
		successWash: "#2A302E",
		successBorder: "#637D4B",

		// Upstream yellow.
		warning: "#E0AF68",
		warningWash: "#322D2E",
		warningBorder: "#8C704D",

		// Upstream red.
		danger: "#F7768E",
		dangerWash: "#352632",
		dangerBorder: "#AB5D70",

		// Upstream cyan, so this theme needs no invented informational hue.
		info: "#7DCFFF",
		infoWash: "#263140",
		infoBorder: "#507E9D",

		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.7)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
