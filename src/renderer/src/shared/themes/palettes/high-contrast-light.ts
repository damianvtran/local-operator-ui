import type { ThemeDefinition } from "../palette-contract";

/**
 * High Contrast Light.
 *
 * The named promise, kept: near-black ink on near-white, every state at 6:1 or
 * better on the grounds it is drawn on. Two consequences of that promise are
 * the only places this file departs from the TUI's tokens. The grounds step
 * further apart than the TUI's own ramp does, because elevation here is a
 * lightness step and a high-contrast theme rendering four
 * near-indistinguishable near-whites would have forgotten its one job. And
 * each state hue is re-seated downward to hold its 6:1 promise on that deeper
 * well — the TUI's own light family documents the same move, and every state
 * keeps its hue and its place in the order.
 *
 * Its grounds sit in the band `iceberg` occupies and cannot be moved out of
 * it: a chroma-free ramp needs about nine L* above its page for three visible
 * steps, and white is the ceiling, so the page lands at L* 91 whatever it is
 * seated against. The separation is carried by everything else in a preview
 * tile — ink ΔE00 17.4 (this is the only near-black ink in the set), accent
 * 6.4 with far more chroma than iceberg's muted navy, wash 5.5, sidebar 3.7,
 * and state hues that are all darker and more saturated than that theme's.
 *
 * Roles the TUI has no token for take one rule each, applied identically
 * across this port. `accentHover` and `accentActive` are one ~4 L* step of the
 * accent ramp in each direction — darker, because a light ground's ramp
 * descends — `chartBarHover` is a step further from the plot ground than the
 * accent is, `onAccent` is the top of the ground ramp, and the washes sit just
 * off the paper with the state hue at 8%. Each border is the state hue pulled
 * toward `canvas` as far as it can go while still reading as an edge. Upstream
 * `dim`, `edge-hi` and the state hues re-seat only as far as the floors
 * require: in a light theme it is the deepest ground that caps them, not the
 * brightest.
 */
export const highContrastLight: ThemeDefinition = {
	id: "highContrastLight",
	name: "High Contrast Light",
	description: "Near-black ink on near-white, every state well past its floor.",
	palette: {
		mode: "light",
		canvas: "#E6E6E6",
		surface: "#F2F2F2",
		elevated: "#FFFFFF",
		sunken: "#D6D6D6",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 6.5 `L*` darker (branch L of this port's selection rule), and
		 * carrying nullx the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is the ΔE00 4.09-to-4 band
		 * on `surface`. ΔE00 4.09 from `surface`, 6.72 from `elevated`, 2.06 from
		 * `sunken`, 9.58 from `accentWash`; the inks on the ground are 14.86:1,
		 * 8.93:1, 5.96:1. Continuity with the panel: hue 0 degrees off the panel's
		 * (the assertion allows 15) and chroma 0 where the panel carries 0.
		 */
		highlight: "#DFDFDF",

		ink: "#0A0A0A",

		// The TUI's muted, lifted 2.7 L*: 8.19:1 on `sunken`, the ground that caps
		// secondary text here.
		inkMuted: "#373737",

		// The TUI's dim, lifted 3.4 L* to clear 4.5:1 on all four grounds — 5.46:1 on
		// `sunken`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		inkDim: "#515151",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#8F8F8F",

		// The TUI's decorative edge, moved ΔE00 1.00 into this contract's two-sided
		// window: a rule has to be SEEN (ΔE00 4+ on every ground) without becoming a
		// border (2:1 at most). Here it is 1.20:1 at its quietest.
		hairline: "#C4C4C4",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.61:1 on `sunken`, the ground that caps it.
		borderControl: "#6C6C6C",

		accent: "#0846C1",

		// One ~4 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#003BB3",
		accentActive: "#0030A5",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.24 from `accent` and 11.29:1 on surface, where the
		// accent itself is 7.06:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#002393",
		tokenCommand: "#004A8C",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#D6E6FB",

		// The theme's own paper at the top of the ramp, at 7.91:1 on all three accent
		// fills.
		onAccent: "#FFFFFF",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#6a1f9e`, deep violet, 8.9:1), received unchanged because
		 * it already clears every floor — ΔE00 16.20 from `accent`, 39.60 from its
		 * nearest semantic (`danger`), 6.28:1 as text on the tightest ground
		 * (`sunken`).
		 */
		accentAlt: "#6a1f9e",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 90.71 and C* 12.02, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 13.23 from `accentWash` (the field floor is
		 * 2.0), 7.22:1 for `accentAlt` on it, and 11.37 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#EEE0F5",

		// Upstream success, re-seated 7.6 L* to hold 6.09:1 on the deepest ground;
		// upstream warning, danger and info re-seat the same way, only as far as their
		// own floors require, so the order of loudness is unchanged.
		success: "#005713",

		// The TUI has no success or warning tint, so both are the state hue at 8% over
		// the ground — the fraction the TUI's own tints measure at. The hue clears
		// 6.97:1 on this fill.
		successWash: "#DFE6E0",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.79:1 at its tightest ground.
		successBorder: "#438050",
		warning: "#6B4000",
		warningWash: "#E7E4DF",
		warningBorder: "#8D6E40",
		danger: "#9A0000",

		// The TUI's own danger tint.
		dangerWash: "#FCD9D9",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.73:1 at its tightest.
		dangerBorder: "#B75757",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#004A8C",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#E3EDF9",
		infoBorder: "#4579A7",

		// The one shadow in the system, tinted with the theme's own ink.
		overlayShadow: "0 12px 32px -12px rgb(10 10 10 / 0.22)",
		scrim: "rgb(10 10 10 / 0.35)",
	},
};
