import type { ThemeDefinition } from "../palette-contract";

/**
 * Paper.
 *
 * Carried from the TUI's own light family: warm cream papers and brown ink, an
 * open book in good light. The TUI's light ramp runs the opposite way to this
 * app's — upstream the page is the brightest value and the panels step down it
 * — so the four grounds are re-seated on the app's own grammar, which lifts
 * toward white: the TUI's surface becomes the page, its page becomes the card,
 * and its deeper sheets become the well. The hue and the temperature are
 * upstream's; only the polarity is the app's.
 *
 * Roles the TUI has no token for take one rule each, applied identically
 * across this port. `accentHover` and `accentActive` are one ~5 L* step of the
 * accent ramp in each direction — darker, because a light ground's ramp
 * descends — `chartBarHover` is a step further from the plot ground than the
 * accent is, `onAccent` is the top of the ground ramp, and the washes sit just
 * off the paper with the state hue at 8%. Each border is the state hue pulled
 * toward `canvas` as far as it can go while still reading as an edge. Upstream
 * `dim`, `edge-hi` and the state hues re-seat only as far as the floors
 * require: in a light theme it is the deepest ground that caps them, not the
 * brightest.
 *
 * ## The legibility pass, and what this file's numbers mean
 *
 * The grounds, ink weights and edges in this file were re-authored against the
 * pass's floors (see `docs/branding.md` § 2-3 and `scripts/contrast-contract.mjs`,
 * which asserts all of them): no page ground below L* 12 in a dark theme or above
 * L* 94 in a light one, a `surface` 2.5-5.0 L* above the canvas, an `elevated`
 * 2.5-6.0 above that, a `sunken` 1.5-6.0 below it, and the three ink weights at
 * 7.0 / 5.5 / 5.0:1 on all SIX grounds - the four elevation steps plus the two
 * that carry state, `accentWash` and `highlight`.
 *
 * Every other measurement quoted below was taken when the role above it was
 * authored, against the ground values as they stood THEN - a measurement is of a
 * moment, and this repository keeps the reading rather than silently refreshing
 * it. The pass's own values are the numbers in the blocks it added; the ones it
 * did not touch are unchanged and still measure what they say.
 */
export const paper: ThemeDefinition = {
	id: "paper",
	name: "Paper",
	description: "Warm cream paper with brown ink, an open book in good light.",
	palette: {
		mode: "light",
		canvas: "#E8E0CD",
		surface: "#EFE8D9",
		elevated: "#F9F3E6",
		sunken: "#DFD7C1",

		/*
		 * The current row's own ground:
		 * `surface` stepped 6.25 on the `L*` axis in the mode's direction — the
		 * neutral step, branch L of this port's selection rule; the ramp affords it here,
		 * so the row takes no cast. ΔE00 4.03 from `surface`, 6.34 from
		 * `elevated` and 3.06 from `sunken`; the step is -6.34 `L*`, and the band
		 * this branch raised to ΔE00 4.0 is met without a cast.
		 */
		highlight: "#DDD6C8",

		ink: "#332B20",

		// The TUI's muted, lifted 9.8 L*: 7.11:1 on `sunken`, the ground that caps
		// secondary text here.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `highlight` binds it at 7.5:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#443C31",

		// The TUI's dim, lifted 11.7 L* to clear 4.5:1 on all four grounds — 4.80:1 on
		// `sunken`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.15:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#5D5445",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#B2A78F",

		// The TUI's decorative edge, moved ΔE00 5.04 into this contract's two-sided
		// window: a rule has to be SEEN (ΔE00 4+ on every ground) without becoming a
		// border (2:1 at most). Here it is 1.21:1 at its quietest.
		hairline: "#CDC4AE",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.19:1 on `sunken`, the ground that caps it.
		borderControl: "#7F7559",

		accent: "#884928",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#7A3D1D",
		accentActive: "#6C3212",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.40 from `accent` and 9.61:1 on surface, where the
		// accent itself is 5.68:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#602707",
		tokenCommand: "#125C8C",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#ECE9CA",

		// The theme's own paper at the top of the ramp, at 6.27:1 on all three accent
		// fills.
		onAccent: "#F9F3E6",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#7d5799`),
		 * moved onto the floors: as received it read 3.96:1 as text on `sunken` and
		 * one more ground. The shortfall is paid on LIGHTNESS at the source hue —
		 * L* 43.47 → 39.42 — which is what this port does to every one of its own
		 * tokens. Measured: ΔE00 34.59 from `accent`, 32.37 from its nearest
		 * semantic (`danger`), 4.60:1 on the tightest ground (`sunken`).
		 */
		accentAlt: "#734D8E",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 91.85 and C* 15.99, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 28.83 from `accentWash` (the field floor is
		 * 2.0), 5.35:1 for `accentAlt` on it, and 20.23 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#F3E1FE",

		// Upstream success, re-seated 9.1 L* to hold 4.98:1 on the deepest ground;
		// upstream warning, danger and info re-seat the same way, only as far as their
		// own floors require, so the order of loudness is unchanged.
		success: "#336318",

		// The TUI has no success or warning tint, so both are the state hue at 8% over
		// the ground — the fraction the TUI's own tints measure at. The hue clears
		// 5.23:1 on this fill.
		successWash: "#E0DDCA",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.34:1 at its tightest ground.
		successBorder: "#608245",
		warning: "#775000",
		warningWash: "#E5DCC8",
		warningBorder: "#947535",
		danger: "#A02F22",

		// The TUI's own danger tint.
		dangerWash: "#F3DDCD",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.30:1 at its tightest.
		dangerBorder: "#B56254",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#125C8C",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#E7EBE2",
		infoBorder: "#4A7E9D",

		// The one shadow in the system, tinted with the theme's own ink.
		overlayShadow: "0 12px 32px -12px rgb(51 43 32 / 0.22)",
		scrim: "rgb(51 43 32 / 0.35)",
	},
};
