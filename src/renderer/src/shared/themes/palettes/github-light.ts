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

		ink: "#1F2328",
		// fg.subtle 6E7781 is 3.49:1 on `sunken`, so the readout rung darkens to clear the 4.5
		// floor — which lands it ΔE00 1.3 from fg.muted, and the two are then one colour. The
		// control rung is seated deeper along the same cool grey so they take different names
		// (ΔE00 8.2 apart).
		inkMuted: "#444D57",
		// fg.subtle 6E7781 is 3.49:1 on `sunken` (< 4.5). Darkened along its own cool grey to
		// the floor corner.
		inkDim: "#5C646E",
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
		accentWash: "#DDF4FF",
		onAccent: "#FFFFFF",

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
