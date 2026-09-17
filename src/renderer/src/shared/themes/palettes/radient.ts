import type { ThemeDefinition } from "../palette-contract";

/**
 * Radient.
 *
 * A brand theme rather than a community scheme, with only three colours to
 * protect: the navy ground, the medium blue 91B7E9 and the light blue
 * BDF0FD. It had no semantic hues at all, so success, warning and danger are
 * derived cool-leaning so they sit inside the theme rather than on top of it.
 */
export const radient: ThemeDefinition = {
	id: "radient",
	name: "Radient",
	description: "Radient blue: deep navy ground with a soft blue accent.",
	palette: {
		mode: "dark",

		canvas: "#10151C",
		// The old theme set both background.default and background.paper to the
		// same value, so a card was invisible against the page. Surface and elevated
		// take the two blues the file already used for its sidebars.
		surface: "#1A1F2F",
		elevated: "#282D47",
		sunken: "#0A0D12",
		/*
		 * The current row's own ground: `surface` stepped up its own navy
		 * ramp 6.24 `L*`, at 1.01x the panel's chroma. ΔE00 4.11 from `surface`,
		 * 4.09 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 11.72 from `sunken`. The row is 1.182x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#212636)
		 * stepped 3.37 `L*` off the panel, and this one steps 6.24. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 12.87:1, `ink-muted` 8.98:1, `ink-dim` 5.61:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 5.61:1.
		 */
		highlight: "#272c3d",

		// Pure white was the one value in this file that belonged to no ramp: at
		// C0 it reads as a hole punched in the navy rather than as the top of the
		// theme's own ink ladder. This continues that ladder — the chroma of the
		// three weights below it falls 14.5, 13.8, 9.1 as lightness rises, so the
		// primary ink lands at C3 on the same blue hue, and still measures 17:1
		// on canvas against white's 18.3:1.
		ink: "#F2F7FC",
		// The old secondary text was the light blue BDF0FD. Accent-weight colour on
		// every piece of secondary text is what the one-accent rule exists to stop,
		// so secondary text is now a cool blue-grey on the same ramp. BDF0FD is not
		// lost: it was also primary.light and is now accentHover.
		inkMuted: "#C2D2E0",
		inkDim: "#8FA8BC",
		inkDisabled: "#64748B",

		hairline: "#343847",
		// Derived. The old theme bounded inputs with white at 20 percent alpha,
		// which measured about 1.5:1 on the page ground.
		borderControl: "#7A8CA3",

		accent: "#91B7E9",
		accentHover: "#BDF0FD",
		accentActive: "#6E9AD4",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.1 from `accent` and 11.15:1 on surface, where the accent
		// itself is 7.93:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#C1D7F3",
		accentWash: "#1F2835",
		// The old theme paired white with this blue, which measures 2.2:1. Ink on
		// the accent fill is the page ground instead.
		onAccent: "#10151C",

		// Derived. Radient names no semantic colours, so these three are built to
		// the theme's own cool cast rather than borrowed from another palette.
		success: "#63D2A0",
		successWash: "#1A2C2C",
		successBorder: "#3E7D65",

		warning: "#E3B457",
		warningWash: "#292823",
		warningBorder: "#846C3C",

		danger: "#EF7E86",
		dangerWash: "#2B2229",
		dangerBorder: "#9C5960",

		// No informational hue, and the two candidates are both already spent on
		// the accent. Info is the accent triple.
		info: "#91B7E9",
		infoWash: "#1F2835",
		infoBorder: "#576E8D",

		overlayShadow: "0 12px 32px -12px rgb(4 6 10 / 0.7)",
		scrim: "rgb(4 6 10 / 0.6)",
	},
};
