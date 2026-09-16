import type { ThemeDefinition } from "../palette-contract";

/**
 * Dune.
 *
 * This one is the app's own theme rather than a community spec, so the
 * identity to preserve is narrower: the orange trio, the two warm near-black
 * grounds and the warm secondary text. Everything else is derived on the
 * theme's own ramp.
 */
export const dune: ThemeDefinition = {
	id: "dune",
	name: "Dune",
	description: "Desert night: warm near-black with a vivid orange.",
	palette: {
		mode: "dark",

		canvas: "#0F0D0B",
		surface: "#1A1714",
		elevated: "#261E17",
		// The old theme had no recessed ground. 050403 sits far enough below canvas
		// to stay distinguishable — at this darkness a step of one or two levels
		// measures under the 1.03:1 separation floor.
		sunken: "#050403",
		/*
		 * The current row's own ground: `surface` stepped up its own warm ramp. ΔE00 4.08 from `surface`,
		 * 4.09 from `elevated` (the same row's hover step, so the pointer cannot
		 * erase the selection) and 8.41 from `sunken`.
		 *
		 * The step was authored at ΔE00 2.18-2.28 from `surface` for a selection the
		 * operator first asked to be SUBTLE; he has since seen it rendered and
		 * reported it as invisible beside a hovered neighbour, so the intent is
		 * inverted and the role now carries unchanged the surface's chroma at the same
		 * hue. § 3 of `docs/branding.md` names the chroma axis as the cheap one —
		 * a contrast ratio has no chroma term, so separating two grounds by warmth at
		 * a fixed L* spends no ink assertion, while separating them by lightness
		 * spends every one measured against them. A pure lightness step stops at
		 * ΔE00 6.07 here because `ink-dim` reaches 4.68:1 there.
		 *
		 * Ink on this ground: `ink` 13.98:1, `ink-muted` 7.51:1, `ink-dim`
		 * 5.07:1 — every floor in § 3 cleared with headroom above it, because the
		 * caps and the `· lopdev` binding inside a current row are drawn in `ink-dim`
		 * and legibility is not what the mark may spend. The structural edge the row
		 * now carries measures 3.85:1 against it, over the 3:1 that role's floor
		 * asks for. Lightness alone would run to ΔE00 6.07 here before an ink floor objected, so this palette's chroma is left exactly as authored and the mark is bought entirely with the lightness step.
		 */
		highlight: "#272421",

		// The old primary text was F9FAFB, a blue-white. Every other neutral here
		// holds R greater than G greater than B, and one cool value in an otherwise
		// warm ramp is what makes a palette look accidental, so the primary ink is
		// warmed to match. Same lightness, same legibility.
		ink: "#F8F3EC",
		inkMuted: "#BFB3A7",
		inkDim: "#9E9285",
		inkDisabled: "#6B6055",

		hairline: "#3A2B11",
		// Derived. The old theme bounded inputs with orange at 10 percent alpha,
		// which measured about 1.1:1 on the page ground.
		borderControl: "#8A7D6E",

		accent: "#FF8C38",
		accentHover: "#FFA75C",
		accentActive: "#E67016",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 10.12:1 on surface, where the accent
		// itself is 7.70:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFB27A",
		accentWash: "#2C1C10",
		// The old theme paired white with this orange, which measures 2.32:1 — a
		// primary button nobody could read. Ink on the accent fill is the page
		// ground instead, at 8.4:1.
		onAccent: "#0F0D0B",

		// Dune has no semantic hues at all. These three are derived inside the
		// theme's own desert range — olive for success, amber for warning, burnt
		// red for danger — so none of them reads as a foreign import.
		success: "#A3C46B",
		successWash: "#212317",
		successBorder: "#607240",

		warning: "#E8C15A",
		warningWash: "#292314",
		warningBorder: "#867036",

		danger: "#E5604C",
		dangerWash: "#291713",
		dangerBorder: "#A74A3B",

		// Dune has no informational hue, and a blue would be the only cool colour
		// in the theme. Info is the accent triple, as in the brand palettes.
		info: "#FF8C38",
		infoWash: "#2C1C10",
		infoBorder: "#985625",

		overlayShadow: "0 12px 32px -12px rgb(5 4 3 / 0.7)",
		scrim: "rgb(5 4 3 / 0.6)",
	},
};
