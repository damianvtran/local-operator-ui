import type { ThemeDefinition } from "../palette-contract";

/**
 * Dracula.
 *
 * Values come from the upstream Dracula spec — background 282A36, darker
 * background 21222C, selection 44475A, foreground F8F8F2, comment 6272A4,
 * purple, pink, green, orange, red and cyan — and from the app's previous
 * dracula-theme.ts, which carried the same purple trio.
 *
 * The scheme already owns six named hues, so nothing here is invented: the
 * warning is Dracula's orange and the info is Dracula's cyan rather than a
 * fourth colour nobody could name.
 */
export const dracula: ThemeDefinition = {
	id: "dracula",
	name: "Dracula",
	description: "Blue-grey ground with the signature Dracula purple.",
	palette: {
		mode: "dark",

		canvas: "#282A36",
		surface: "#2F3146",
		// The old theme used selection 44475A as its tooltip ground. Nothing that
		// light can carry a third ink weight — inkDim would have to land within a
		// hair of inkMuted to clear 4.5:1 on it — so elevated steps one stop back
		// down the same blue-grey ramp and selection stays available for hovers.
		elevated: "#3D4055",
		sunken: "#21222C",
		/*
		 * The current row's own ground: `surface` stepped up its own blue-grey ramp. ΔE00 4.11 from `surface`,
		 * 2.56 from `elevated` (the same row's hover step, so the pointer cannot
		 * erase the selection) and 11.03 from `sunken`.
		 *
		 * The step was authored at ΔE00 2.18-2.28 from `surface` for a selection the
		 * operator first asked to be SUBTLE; he has since seen it rendered and
		 * reported it as invisible beside a hovered neighbour, so the intent is
		 * inverted and the role now carries 1.2x the surface's chroma at the same
		 * hue. § 3 of `docs/branding.md` names the chroma axis as the cheap one —
		 * a contrast ratio has no chroma term, so separating two grounds by warmth at
		 * a fixed L* spends no ink assertion, while separating them by lightness
		 * spends every one measured against them. A pure lightness step stops at
		 * ΔE00 2.62 here because `elevated` closes to ΔE00 2.37 of it.
		 *
		 * Ink on this ground: `ink` 10.05:1, `ink-muted` 5.82:1, `ink-dim`
		 * 4.74:1 — every floor in § 3 cleared with headroom above it, because the
		 * caps and the `· lopdev` binding inside a current row are drawn in `ink-dim`
		 * and legibility is not what the mark may spend. The structural edge the row
		 * now carries measures 3.17:1 against it, over the 3:1 that role's floor
		 * asks for. The hover step here is 4.87 from `surface`, further than any step this palette's inks allow the row to take, which is why the row carries a structural edge rather than a louder ground.
		 */
		highlight: "#3a3c56",

		ink: "#F8F8F2",
		inkMuted: "#BFBFBF",
		// Dracula's comment blue, lightened until it clears 4.5:1 on all four
		// grounds. Comment itself is inkDisabled, where an inactive tone belongs:
		// inkDisabled is the one role the floors exempt.
		inkDim: "#A3ACC9",
		inkDisabled: "#6272A4",

		hairline: "#4A4C5E",
		// The same comment blue lightened further. The old theme bounded every
		// input with white at 10 percent alpha, which measured about 1.2:1.
		borderControl: "#7D8BB4",

		accent: "#BD93F9",
		accentHover: "#D1AEFF",
		accentActive: "#A884DE",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.2 from `accent` and 7.29:1 on surface, where the accent
		// itself is 5.28:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#D3B8FB",
		accentWash: "#3A374D",
		onAccent: "#282A36",

		success: "#50FA7B",
		successWash: "#2D433E",
		successBorder: "#3E9C5C",

		// Dracula's orange. The scheme's yellow F1FA8C also clears the floors but
		// reads as a highlighter next to the green, not as a caution.
		warning: "#FFB86C",
		warningWash: "#423B3C",
		warningBorder: "#9E7854",

		// Dracula's red is FF5555, which measures 4.05:1 on surface. This is the
		// smallest lift that clears 4.5:1 on surface and on its own wash.
		danger: "#FF7171",
		dangerWash: "#422F3A",
		dangerBorder: "#BE6368",

		// Dracula's cyan, an upstream hue, so this theme needs no invented blue.
		info: "#8BE9FD",
		infoWash: "#34414E",
		infoBorder: "#5E93A3",

		overlayShadow: "0 12px 32px -12px rgb(13 14 20 / 0.65)",
		scrim: "rgb(13 14 20 / 0.6)",
	},
};
