import type { ThemeDefinition } from "../palette-contract";

/**
 * Mint Light.
 *
 * Carried from the TUI's own light family: crisp white with a fresh-mint green
 * accent. The grounds are re-seated on the app's ascending light grammar (the
 * TUI's page is its brightest value) and the mint cast is carried a step
 * deeper than upstream, so the ramp reads as mint rather than as a bleached
 * white beside the app's warm brand papers — that difference in ground
 * temperature is what separates this theme from `localOperatorLight` in a
 * preview, whose accent green is close to this one (ΔE00 2.6) while the two
 * pages are 8.0 apart.
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
export const mintLight: ThemeDefinition = {
	id: "mintLight",
	name: "Mint Light",
	description: "Crisp white with the cool cast of fresh mint.",
	palette: {
		mode: "light",
		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A light page ground is capped at L* 94 here, because `elevated`
		 * at L* 100 is the end of sRGB's ramp and the minimum canvas-to-elevated
		 * spread is 2.5 + 2.5 L*.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +2.64, elevated +5.16, sunken -3.67 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #E5F2E8 -> #E4F1E7 (L* 94.31 -> 93.96)
		 * surface #F1F8F3 -> #F0F7F2 (L* 96.95 -> 96.6)
		 * elevated #FBFDFB -> #FBFDFB (L* 99.11 -> 99.11)
		 * sunken #D6E9DB -> #D5E8DA (L* 90.64 -> 90.29)
		 *
		 * ONLY LIGHTNESS MOVED. Each value holds its own `a` and `b`, so the theme's
		 * hue and chroma class are exactly what they were and chroma is scaled only
		 * where sRGB forces it - a lift that neutralised a palette to satisfy a floor
		 * would be a different theme, not a lighter one.
		 *
		 * THE GROUNDS AND THE INKS MOVED TOGETHER, and the header of this file says why:
		 * lifting a dark ground raises the luminance every ink is measured against, so
		 * the inks in this file were re-seated on the same commit rather than after it.
		 */
		canvas: "#E4F1E7",
		surface: "#F0F7F2",
		elevated: "#FBFDFB",
		sunken: "#D5E8DA",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #E5F5E9  accent hue, C* 8.42, +1.50 L*, ΔE00 4.98 off `surface`,
		 *                       `inkDim` 5.85:1 on the fill, hue 1.43° off `accent`.
		 * rowSelected #D0EFD9  accent hue, C* 15.95, +4.85 L*, ΔE00 11.09 off
		 *                       `surface` and 6.29 off `rowHover`, `inkDim` 5.37:1, and the
		 *                       2px `accent` bar at 4.96:1 against it.
		 */
		rowHover: "#E5F5E9",
		rowSelected: "#D0EFD9",

		ink: "#1C2B21",

		// The TUI's muted, lifted 7.1 L*: 7.01:1 on `sunken`, the ground that caps
		// secondary text here.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `highlight` binds it at 7.48:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#38493E",

		// The TUI's dim, lifted 9.5 L* to clear 4.5:1 on all four grounds — 4.77:1 on
		// `sunken`, the ground that caps it — while staying ΔE00 8+ from `inkMuted`,
		// so a control and a reading stay two inks.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.16:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#4F6155",

		// The TUI's own faint, and the one role exempt from the contrast floors: a
		// disabled control that meets 4.5:1 does not read as disabled.
		inkDisabled: "#A3B5A8",

		// The TUI's decorative edge, moved ΔE00 4.35 into this contract's two-sided
		// window: a rule has to be SEEN (ΔE00 4+ on every ground) without becoming a
		// border (2:1 at most). Here it is 1.21:1 at its quietest.
		hairline: "#C6D4C9",

		// Derived, and the one role the TUI cannot supply. Upstream `edge-hi` is a
		// decorative edge at about 2:1; here it is the only boundary an input, select
		// or outlined button has, so it is lifted until it clears 3:1 on every ground
		// — 3.21:1 on `sunken`, the ground that caps it.
		borderControl: "#6D8373",

		// The TUI's accent, deepened 6.3 L*: on a light ground the deepest surface is
		// what caps a state hue, so the accent has to clear the floor there.
		accent: "#00713F",

		// One ~5 L* step along the accent ramp in each direction: hover away from the
		// ground, pressed toward it.
		accentHover: "#006434",
		accentActive: "#005828",

		// The chart's hover mark, a step AWAY from the plot ground rather than along
		// the accent ramp: ΔE00 11.30 from `accent` and 9.22:1 on surface, where the
		// accent itself is 5.67:1. See `chartBarHover` in the palette contract.
		chartBarHover: "#004E20",
		tokenCommand: "#09649B",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.

		// The TUI's own selection tint, which is where this accent is already spent
		// faintly.
		accentWash: "#DCF2E2",

		// The theme's own paper at the top of the ramp, at 5.98:1 on all three accent
		// fills.
		onAccent: "#FBFDFB",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#77579e`),
		 * moved onto the floors: as received it read 4.50:1 as text on `sunken`.
		 * The shortfall is paid on LIGHTNESS at the source hue — L* 43.07 → 42.67 —
		 * which is what this port does to every one of its own tokens. Measured:
		 * ΔE00 42.68 from `accent`, 32.55 from its nearest semantic (`danger`),
		 * 4.57:1 on the tightest ground (`sunken`).
		 */
		accentAlt: "#76569D",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 93.54 and C* 11.42, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 21.42 from `accentWash` (the field floor is
		 * 2.0), 4.98:1 for `accentAlt` on it, and 12.27 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#F3E9FD",

		// Upstream success, clearing 5.19:1 at its tightest ground; upstream warning,
		// danger and info re-seat the same way, only as far as their own floors
		// require, so the order of loudness is unchanged.
		success: "#1D6A3E",

		// The TUI has no success or warning tint, so both are the state hue at 8% over
		// the ground — the fraction the TUI's own tints measure at. The hue clears
		// 5.47:1 on this fill.
		successWash: "#E0EDE5",

		// The state hue pulled toward `canvas` as far as it can go and still read as
		// an edge: 3.30:1 at its tightest ground.
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.01:1.
		 */
		successBorder: "#528E6C",
		warning: "#7E5800",
		warningWash: "#E8EBE0",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.01:1.
		 */
		warningBorder: "#987F3C",
		danger: "#B0312E",

		// The TUI's own danger tint.
		dangerWash: "#F9E4E0",

		// This one is also drawn on a dialog's ground, where the delete control's edge
		// IS the control: 3.29:1 at its tightest.
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.01:1.
		 */
		dangerBorder: "#BE6A65",

		// The TUI's signal hue, this family's file/reference colour.
		info: "#09649B",

		// The TUI's own attachment tint, and the ground every marker reads on.
		infoWash: "#E6F0F7",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `sunken` binds it at 3.01:1.
		 */
		infoBorder: "#4389AF",

		// The one shadow in the system, tinted with the theme's own ink.
		overlayShadow: "0 12px 32px -12px rgb(28 43 33 / 0.22)",
		scrim: "rgb(28 43 33 / 0.35)",
	},
};
