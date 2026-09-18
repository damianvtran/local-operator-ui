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
		 * The current row's own ground: `surface` stepped up its own blue
		 * ramp 5.09 `L*`, at 0.76x the panel's chroma, i.e. less tinted than the ground it sits on. ΔE00 4.09 from `surface`,
		 * 4.74 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 10.53 from `sunken`. The row is 1.167x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#2b2f42)
		 * stepped 3.26 `L*` off the panel, and this one steps 5.09. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 7.73:1, `ink-muted` 5.91:1, `ink-dim` 4.72:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 4.72:1. The theme in the operator's own screenshot, where the row measured ΔE00 2.23 and read as no mark at all beside a hovered neighbour at 4.58.
		 * The chroma-only step this one also replaces (#262d4a, ΔE00 4.24) bought the band
		 * with 1.50x the panel's chroma at a 2.61 `L*` step — less light than the value
		 * before it, which is the state he had already seen.
		 */
		highlight: "#313342",

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
		tokenCommand: "#7DCFFF",
		/* The wire's own `info`, so the command word's rendering does not move. */
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
