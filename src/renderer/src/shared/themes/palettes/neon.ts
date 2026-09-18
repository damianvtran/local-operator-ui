import type { ThemeDefinition } from "../palette-contract";

/**
 * Neon.
 *
 * Tron-inspired, and the most saturated of the ten. Carried: the two
 * near-black blues, the grey inks, the cyan trio, the cyberpunk pink and the
 * orange the old file already used for its caution highlights. The theme's
 * glow effects live in the base theme, not here — a palette has no shadows.
 */
export const neon: ThemeDefinition = {
	id: "neon",
	name: "Neon",
	description: "Tron: near-black blue with cyan and cyberpunk pink.",
	palette: {
		mode: "dark",

		canvas: "#080C18",
		// The old grounds 080C18 and 0D1220 measured 1.04:1 apart, close enough to
		// read as one surface. Surface and elevated are spread along the same
		// desaturated blue ramp so a card and a menu are actually distinguishable.
		surface: "#0F1524",
		elevated: "#182036",
		sunken: "#03040A",

		/*
		 * The current row's own ground: `surface` stepped 6.45 `L*` up at the panel's own
		 * hue (0.2 degrees off, inside the 12-degree bound) and carried
		 * 11.62 `C*` against the panel's 11.44 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 4.05, from
		 * `elevated` 2.91, from `sunken` 10.29. Ink on this ground: `ink` 12.01:1,
		 * `ink-muted` 6.15:1, `ink-dim` 4.68:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `0.95x` the panel's
		 * chroma (10.93 `C*` against 11.44), 1 degrees off its hue, ΔE00 4.04 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 */
		highlight: "#1C2232",

		ink: "#E0E0E0",
		inkMuted: "#A0A0B0",
		inkDim: "#8A8A9C",
		inkDisabled: "#5E5E70",

		hairline: "#0D3140",
		// Derived. The old theme bounded inputs with cyan at 20 percent alpha, about
		// 1.3:1 — a neon outline that was not actually there.
		borderControl: "#6F8F99",

		accent: "#00EFFF",
		accentHover: "#66F7FF",
		accentActive: "#00B8D9",
		// The chart's hover mark, a step AWAY from the plot ground rather than along the
		// accent ramp: ΔE00 10.0 from `accent` and 15.58:1 on surface, where the accent
		// itself is 12.83:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#B0FAFF",
		// The cyan at a faint tint. The theme's own hover fills used the same cyan
		// at 10 to 15 percent, so this is the value it was already reaching for.
		accentWash: "#072734",
		onAccent: "#000E0F",

		// Neon has no green. This one is placed about 37 degrees off the cyan
		// accent, which is far enough that a success state does not read as a
		// primary action — the nearer greens all looked like dim cyan.
		success: "#2BFF88",
		successWash: "#0C2925",
		successBorder: "#1B9256",

		// The orange the old file used for its ask highlights.
		warning: "#FFA500",
		warningWash: "#261E15",
		warningBorder: "#90600B",

		// The theme's cyberpunk pink, carried verbatim; it clears 4.5:1 on both
		// grounds without a nudge.
		danger: "#FF00A0",
		dangerWash: "#260B28",
		dangerBorder: "#C00784",

		// Info is the accent cyan. The theme's only other bright hues are the pink,
		// which is danger, and the orange, which is warning.
		info: "#00EFFF",
		infoWash: "#072734",
		infoBorder: "#048997",

		overlayShadow: "0 12px 32px -12px rgb(0 0 0 / 0.75)",
		scrim: "rgb(2 4 8 / 0.65)",
	},
};
