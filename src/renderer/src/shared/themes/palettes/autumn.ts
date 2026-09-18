import type { ThemeDefinition } from "../palette-contract";

/**
 * Autumn.
 *
 * Carried from the TUI's own nature family: dark oak ground, maple-orange
 * accent, harvest amber warning and a lifted maple red, because a cool theme's
 * crimson measures under 3.5:1 on oak. Success is a drying leaf-green rather
 * than a spring green, which is what keeps it apart from the accent beside it.
 *
 * Roles the TUI has no token for take one rule each, applied identically
 * across this port. `accentHover` and `accentActive` are one ~5 L* step of the
 * accent ramp in each direction, hover away from the ground and pressed toward
 * it. `chartBarHover` is a step further from the plot ground than the accent
 * is, never a step along the accent ramp. `onAccent` is the theme's own
 * deepest ground. The washes are the TUI's own `tint-*` where it has one and
 * the state hue at 13% over the well where it does not; each border is that
 * hue pulled toward `canvas` as far as it can go while still reading as an
 * edge. The TUI's `dim` and `edge-hi` move only as far as the floors require,
 * and the overlay tint is the theme's own well.
 */
export const autumn: ThemeDefinition = {
	id: "autumn",
	name: "Autumn",
	description: "Dark oak under maple red and harvest amber.",
	palette: {
		mode: "dark",
		canvas: "#1D1510",
		surface: "#271E17",
		elevated: "#30261E",
		sunken: "#140E09",

		/*
		 * The current row's own ground: `surface` stepped 4.86 `L*` up at the panel's own
		 * hue (3.9 degrees off, inside the 12-degree bound) and carried
		 * 8.24 `C*` against the panel's 7.13 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 3.33, from
		 * `elevated` 0.85, from `sunken` 8.97. Ink on this ground: `ink` 11.01:1,
		 * `ink-muted` 6.57:1, `ink-dim` 4.66:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `1.45x` the panel's
		 * chroma (10.36 `C*` against 7.13), 3 degrees off its hue, ΔE00 4.17 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * THE HOVER STEP IS THE COLLISION: 0.85 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_ADJACENT_PINS` and is
		 * on the row-hover work list.
		 */
		highlight: "#32281F",

		ink: "#EDDFD0",
		inkMuted: "#C0AC97",

		// The TUI's dim, lifted 7.3 L* to clear 4.5:1 on all four grounds — 4.78:1 on
		// `elevated`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		inkDim: "#A1907C",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#55483A",

		hairline: "#42332A",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.19:1 on `elevated`, the ground that caps it.
		borderControl: "#857163",

		accent: "#E08D4F",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#EF9A5B",
		accentActive: "#D18043",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.46 from `accent` and 9.70:1 on surface, where the
		// accent itself is 6.30:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#FFB978",

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#292312",

		// The theme's own deepest ground, at 6.27:1 on all three accent fills.
		onAccent: "#140E09",

		// Upstream success, clearing 7.54:1 at its tightest ground.
		success: "#A2B96A",

		// The TUI has no success or warning tint, so both are the state hue at 13%
		// over the ground — the fraction the TUI's own tints measure at. The hue
		// clears 5.90:1 on this fill.
		successWash: "#373222",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.41:1 at its tightest ground.
		successBorder: "#6D7746",
		warning: "#DDAB35",
		warningWash: "#3F301B",
		warningBorder: "#906F26",
		danger: "#F37F6F",

		// The TUI's own danger tint.
		dangerWash: "#331B14",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.29:1 at its tightest.
		dangerBorder: "#B35F52",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#7FB0D3",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#233140",
		infoBorder: "#597487",

		// The one shadow in the system, tinted with the theme's own well.
		overlayShadow: "0 12px 32px -12px rgb(20 14 9 / 0.7)",
		scrim: "rgb(20 14 9 / 0.6)",
	},
};
