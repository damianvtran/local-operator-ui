import type { ThemeDefinition } from "../palette-contract";

/**
 * Iceberg, light.
 *
 * The upstream Iceberg light scheme is the source: background E8E9EC, text
 * 33374C, blue 2D539E, green 668E3D, orange C57339, red CC517A and cyan
 * 3F83A6. The app's old file had already darkened several of these by hand
 * for contrast; now that the floors are measured, each one goes back to its
 * upstream value and is darkened only as far as the arithmetic requires.
 */
export const iceberg: ThemeDefinition = {
	id: "iceberg",
	name: "Iceberg",
	description: "Cool blue-grey paper with the Iceberg navy.",
	palette: {
		mode: "light",

		canvas: "#E8E9EC",
		// Upstream has one background and the old file invented F3F4F7 for paper.
		// Two more grounds are derived on the same cool ramp.
		surface: "#F2F3F6",
		// Canvas is upstream's own background, so the canvas/surface step is fixed
		// at ΔE00 2.11 and surface cannot come down without collapsing it. The only
		// room for a visible surface/elevated step is therefore above surface:
		// FAFAFC read 1.58 apart from it, FDFDFF reads 2.15 on the same +2 blue
		// tint. That is the whole headroom a light ramp has under white.
		elevated: "#FDFDFF",
		// A light ramp has very little room below its page ground: canvas is already
		// a mid-light grey, and every step down costs tertiary-ink headroom. This
		// sits 1.07:1 under canvas, which is what caps inkDim below.
		sunken: "#E1E2E7",

		/*
		 * The current row's own ground: `surface` stepped down its own cool neutral
		 * ramp 4.09 `L*`, carrying 3.31x the panel's chroma. ΔE00 4.12 from `surface`,
		 * 5.88 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 2.53 from `sunken`. The row is 1.111x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#e8e9eb)
		 * stepped 3.52 `L*` off the panel, and this one steps 4.09. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 9.51:1, `ink-muted` 6.64:1, `ink-dim` 5.11:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 5.11:1. KNOWN CAST, RECORDED RATHER THAN HIDDEN: this panel is the least chromatic of
		 * the twelve (C* 1.57), so every step here is a large multiple of it and the row
		 * reads as a lavender band rather than a darker one (design round 1, D4). It is
		 * the one palette whose step is bought on chroma rather than lightness — the
		 * premise that its recessed ground capped the step was wrong (see this file's
		 * neighbours: `sunken` sits 3.75 from `surface` and the row still clears it by
		 * 2.53) — and the fix is the ordering the rule states: spend `L*` first. Not
		 * re-authored in this round, which is scoped to the three palettes the
		 * operator's report is measured on.
		 */
		highlight: "#e5e7f1",

		// Iceberg's own text colour. The old file darkened it to 262A3F for
		// contrast, which is no longer necessary — this measures 9:1 on the darkest
		// ground and 11.2:1 on the lightest.
		ink: "#33374C",
		inkMuted: "#4A4E64",
		// Upstream sub colour, carried verbatim; it clears 4.87:1 on sunken, which
		// is the binding ground for a dark ink in a light theme.
		inkDim: "#5B5F74",
		inkDisabled: "#A0A4B8",

		hairline: "#CBCCD2",
		// Derived. The old theme bounded inputs at 15 percent black, about 1.4:1.
		borderControl: "#787D97",

		accent: "#2D539E",
		accentHover: "#1E3A7D",
		accentActive: "#162E63",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 10.18:1 on surface, where the accent
		// itself is 6.66:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#1F396C",
		tokenCommand: "#316682",
		/* The wire's own `info`, so the command word's rendering does not move. */
		accentWash: "#D5DAE4",
		onAccent: "#F2F5F9",

		// Upstream green 668E3D, darkened to clear 4.5:1 on the light grounds.
		success: "#4C692D",
		successWash: "#DBE0DB",
		successBorder: "#718B57",

		// Upstream orange C57339, darkened for the same reason.
		warning: "#8D5229",
		warningWash: "#E5DDDA",
		warningBorder: "#B87142",

		// Upstream red CC517A, darkened for the same reason. The old file's own
		// error.dark B32D5E was heading the same way by hand.
		danger: "#AB325B",
		dangerWash: "#E5DAE1",
		dangerBorder: "#C76286",

		// Upstream cyan, darkened. Kept as a cyan rather than a second navy so an
		// info callout does not read as a primary one.
		info: "#316682",
		infoWash: "#D7DFE5",
		infoBorder: "#5289A8",

		overlayShadow: "0 12px 32px -12px rgb(38 42 63 / 0.22)",
		scrim: "rgb(38 42 63 / 0.35)",
	},
};
