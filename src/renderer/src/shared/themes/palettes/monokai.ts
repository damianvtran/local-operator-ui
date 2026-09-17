import type { ThemeDefinition } from "../palette-contract";

/**
 * Monokai.
 *
 * Upstream Monokai is unusually complete for this contract: background
 * 272822, line highlight 3E3D32, foreground F8F8F2, comment 75715E, plus a
 * green, an orange, a yellow, a pink and a blue. Only the recessed ground,
 * the structural border and the wash tints are derived.
 */
export const monokai: ThemeDefinition = {
	id: "monokai",
	name: "Monokai",
	description: "The Monokai scheme: olive-black ground with the acid green.",
	palette: {
		mode: "dark",

		canvas: "#272822",
		// Canvas and elevated are upstream's background and line highlight; surface
		// is the derived step between them, so it is the one that moves. 2D2E27 sat
		// ΔE00 1.95 from canvas — a card edge that is not there. One unit up the
		// same olive ramp reads 2.26, and still leaves 5.05 up to elevated.
		surface: "#2E2F28",
		elevated: "#3E3D32",
		sunken: "#1E1F1A",
		/*
		 * The current row's own ground: `surface` stepped up its own olive
		 * ramp 4.35 `L*`, carrying 1.66x the panel's chroma. ΔE00 4.07 from `surface`,
		 * 2.51 from `elevated` (the same row's hover step, so the pointer cannot erase
		 * the selection) and 8.85 from `sunken`. The row is 1.149x the panel's relative
		 * luminance.
		 *
		 * THE `L*` STEP IS THE MARK, AND CHROMA PAYS ONLY THE REMAINDER. The role was
		 * authored at ΔE00 2.18-2.28 for a selection the operator had asked to be
		 * SUBTLE, and he has since seen that band rendered and reported the row as
		 * invisible beside a hovered neighbour; the value this one replaces (#35362f)
		 * stepped 3.22 `L*` off the panel, and this one steps 4.35. That ordering —
		 * lightness first, chroma only for what is left over, never the other way
		 * round — is the rule `docs/branding.md` § 2 states in full, and its DIRECTION
		 * is asserted in `scripts/contrast-contract.mjs`, so no palette can satisfy
		 * the band while landing darker on a dark theme.
		 *
		 * Ink on this ground: `ink` 11.03:1, `ink-muted` 6.40:1, `ink-dim` 4.97:1 — every floor
		 * in § 3 cleared with headroom, because the caps and the `· lopdev` binding
		 * inside a current row are drawn on it and legibility is not what the mark may
		 * spend. `ink-dim` is the binder at 4.97:1. The step here is still partly chroma-bought (1.66x the panel's); the ordering
		 * above is what a re-authoring of this palette should follow.
		 */
		highlight: "#37392d",

		ink: "#F8F8F2",
		inkMuted: "#BFBFBF",
		// Monokai's comment 75715E, lightened until it clears 4.5:1 on the line
		// highlight ground. The comment colour itself stays as inkDisabled.
		inkDim: "#ACA998",
		inkDisabled: "#75715E",

		hairline: "#464740",
		// The comment colour lightened further, so a structural boundary is legally
		// distinct from the decorative hairline above it.
		borderControl: "#8E8A73",

		accent: "#A6E22E",
		accentHover: "#B6E94E",
		accentActive: "#8BC220",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 10.65:1 on surface, where the accent
		// itself is 8.72:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#D0F090",
		accentWash: "#363E23",
		onAccent: "#272822",

		// The same green as the accent. Monokai has exactly one green, and a second
		// one invented to fill this role would be a colour no Monokai user
		// recognises. A green success next to a green primary button is the honest
		// reading of this scheme.
		success: "#A6E22E",
		successWash: "#363E23",
		successBorder: "#6D8E29",

		// Monokai's orange.
		warning: "#FD971F",
		warningWash: "#413522",
		warningBorder: "#A76C22",

		// Monokai's pink is F92672, which measures 4.19:1 on canvas. This is the
		// smallest lift that clears 4.5:1 on both grounds and on its own wash.
		danger: "#FB6097",
		dangerWash: "#40282C",
		dangerBorder: "#D04573",

		// Monokai's blue.
		info: "#66D9EF",
		infoWash: "#2F3D3B",
		infoBorder: "#4A8993",

		overlayShadow: "0 12px 32px -12px rgb(15 15 12 / 0.65)",
		scrim: "rgb(15 15 12 / 0.6)",
	},
};
