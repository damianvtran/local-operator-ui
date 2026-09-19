import type { ThemeDefinition } from "../palette-contract";

/**
 * GitHub Light — GitHub's own light theme, built from the Primer colour primitives: gray-0
 * F6F8FA, gray-1 EAEEF2, white, fg.default 1F2328, fg.muted 57606A, fg.subtle 6E7781, blue
 * 0969DA, green 1A7F37, attention 9A6700, red CF222E and accent deep blue 0550AE.
 *
 * GitHub's own ramp puts white at the TOP — canvas.default is #FFFFFF and the panels sit below
 * it — which is the opposite of this system, where a raised surface is lighter than the page.
 * One Light solved the same problem by seating the ladder lower, and this palette does the same:
 * the page is seated one step under gray-1 at E6EAEE and white becomes the raised ground, so a
 * card still reads as raised and every ground is a Primer grey.
 *
 * Two values move for this contract and both are recorded below: the Primer blue 0969DA is
 * 3.99:1 as text on the recessed ground where the floor is 4.5, and fg.subtle 6E7781 is
 * 3.49:1 — darkening it to clear the floor lands the readout rung on top of fg.muted, so the
 * control rung is seated deeper and the two take different names.
 *
 * `info` is Primer's accent deep blue 0550AE — the tone the scheme itself uses for factual
 * chrome — which sits a shade below the lifted primary rather than beside it, so an info callout
 * is not mistaken for a primary action.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over the page at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the ink tinted.
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
export const githubLight: ThemeDefinition = {
	id: "githubLight",
	name: "GitHub Light",
	description: "GitHub's daylight canvas, white panels and Primer blue.",
	palette: {
		mode: "light",

		// Seated at gray-1 so that white can be the raised ground: GitHub paints white as its
		// page and its panels below it, which is the inverse of this system's ladder. From
		// here the ramp ascends ΔE00 2.4 and 2.8 to white.
		canvas: "#E6EAEE",
		surface: "#F2F5F8",
		// Primer's canvas.default — the scheme's own white, taking the top of the ladder as
		// the header explains.
		elevated: "#FFFFFF",
		// The scheme's own recessed grey, one step under the page.
		sunken: "#DDE2E8",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are tints of
		 * THIS palette's own `accent` hue at two strengths; the retired role was a step
		 * toward the panel's cast, which on the dark family is the axis the operator
		 * reported as spent. The rule, and why neither role is a neutral step, are in the
		 * two roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #EEEFFD  accent hue, C* 7.19, +1.65 L*, ΔE00 5.60 off `surface`,
		 *                       `inkDim` 5.74:1 on the fill, hue 0.61° off `accent`.
		 * rowSelected #E3E5FF  accent hue, C* 13.47, +4.89 L*, ΔE00 10.23 off
		 *                       `surface` and 4.87 off `rowHover`, `inkDim` 5.28:1, and the
		 *                       2px `accent` bar at 4.83:1 against it.
		 */
		rowHover: "#EEEFFD",
		rowSelected: "#E3E5FF",

		ink: "#1F2328",
		// fg.subtle 6E7781 is 3.49:1 on `sunken`, so the readout rung darkens to clear the 4.5
		// floor — which lands it ΔE00 1.3 from fg.muted, and the two are then one colour. The
		// control rung is seated deeper along the same cool grey so they take different names
		// (ΔE00 8.2 apart).
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `sunken` binds it at 7.22:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#3F4751",
		// fg.subtle 6E7781 is 3.49:1 on `sunken` (< 4.5). Darkened along its own cool grey to
		// the floor corner.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `sunken` binds it at 5.03:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#575E68",
		inkDisabled: "#A8B1BB",

		// Primer's border.default D0D7DE is 1.12:1 against the recessed ground, under the
		// 1.15:1 a 1px line is held to. This holds ΔE00 4.2 from every ground and
		// 1.19-1.55:1 against them.
		hairline: "#CBD0D6",
		// Primer's border.muted AFB8C1 is 1.54:1 against the grounds, and
		// border.default is no better in a structural role. The edge is walked to 3.1:1
		// on the darkest ground instead.
		borderControl: "#788089",

		// Primer blue 0969DA is 3.99:1 as text on the recessed ground (< 4.5). Deepened along
		// the same blue, and kept the scheme's own hue so the primary action still reads as
		// GitHub's blue.
		accent: "#015FCB",
		accentHover: "#0757B3",
		accentActive: "#05448F",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.4
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#004497",
		tokenCommand: "#0048A4",
		// The signal lifted in L* (hue and chroma held) to ΔE00 8.6 from this
		// palette's accent, which the signal itself sat 5.9 from; ΔE00 2.8 from the
		// signal, 7.79:1 on `surface` and 8.53:1 on `elevated`.
		accentWash: "#DDF4FF",
		onAccent: "#FFFFFF",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#8250df`,
		 * done.fg (the merged-PR purple)), moved onto the floors: as received it
		 * read 3.87:1 as text on `sunken` and one more ground. The shortfall is
		 * paid on LIGHTNESS at the source hue — L* 46.72 → 42.29 — which is what
		 * this port does to every one of its own tokens. Measured: ΔE00 16.72 from
		 * `accent`, 39.06 from its nearest semantic (`danger`), 4.56:1 on the
		 * tightest ground (`sunken`).
		 */
		accentAlt: "#7545D2",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 94.86 and C* 9.48, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 14.93 from `accentWash` (the field floor is
		 * 2.0), 5.21:1 for `accentAlt` on it, and 9.14 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#F5EDFF",

		// Primer green 1A7F37 is 3.90:1 on `sunken` (< 4.5). Deepened along the same green.
		success: "#01732C",
		successWash: "#DAE3E2",
		successBorder: "#329048",

		// Primer attention 9A6700 is 3.74:1 on `sunken` (< 4.5). Deepened along the same
		// amber.
		warning: "#885A01",
		warningWash: "#E1E2E2",
		warningBorder: "#A6762D",

		// Primer red CF222E is 4.11:1 on `sunken` (< 4.5). Deepened along the same red.
		danger: "#C61226",
		dangerWash: "#FFEBE9",
		dangerBorder: "#E93F43",

		// Primer accent deep blue 0550AE, the scheme's own factual chrome tone, which clears
		// 4.5:1 on every ground without a lift.
		info: "#0550AE",
		infoWash: "#EEF2F8",
		infoBorder: "#3C7EE1",

		// The shadow and scrim are the ink tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(31 35 40 / 0.22)",
		scrim: "rgb(31 35 40 / 0.35)",
	},
};
