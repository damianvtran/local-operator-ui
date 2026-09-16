import type { ThemeDefinition } from "../palette-contract";

/**
 * Solarized Dark — Ethan Schoonover's Solarized, dark variant, from the scheme's own published
 * palette (base03 002B36 as the page, base02 073642 as the raised step, base01 586E75, base0
 * 839496, base1 93A1A1, and the accent set cyan 2AA198, green 859900, yellow B58900, red
 * DC322F, blue 268BD2).
 *
 * Solarized is a precision palette: its whole argument is that a fixed set of sixteen tones
 * renders correctly on two grounds, and it was never asked to clear a 7:1 body floor. Three
 * consequences, all measured at the role below. Its body ink is a syntax tone at 6.1:1 and had
 * to be lifted; its lower weights are the same tone family packed within ΔE00 4 of each other,
 * so they are re-seated to hold this contract's 8 ink step; and every accent needed a lift of
 * between 0.3 and 1.1 contrast points along its own hue to clear 4.5:1 as UI text.
 *
 * The ladder needs one derived ground that upstream does not have: base03 to base02 is ΔE00
 * 3.4 in total and two 2.0 steps do not fit inside it, so `elevated` sits one step above base02
 * and the rest of the ramp is upstream's own.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the ground tinted.
 */
export const solarizedDark: ThemeDefinition = {
	id: "solarizedDark",
	name: "Solarized Dark",
	description:
		"Schoonover's precision dark — deep teal-black with a cyan accent.",
	palette: {
		mode: "dark",

		canvas: "#002B36",
		// A step between base03 and base02, because the scheme's own two ground tones are
		// ΔE00 3.4 apart and this ladder needs a rung in between.
		surface: "#05333F",
		// A step ABOVE base02: base03 to base02 measures ΔE00 3.4 in total, so two 2.0
		// steps cannot fit inside upstream's ramp and the top ground is derived.
		elevated: "#0D3C49",
		sunken: "#00252E",

		/*
		 * The current row's own ground:
		 * a cast of `surface`'s chroma plane toward `accent` at alpha
		 * 0.135, L* held — branch H, taken because no step on this
		 * palette's lightness ladder clears `elevated` inside the band.
		 * ΔE00 2.44 from `surface`, 3.55 from `elevated` and 5.06 from
		 * `sunken`.
		 */
		highlight: "#00343D",

		// Upstream base1 93A1A1 — the tone the scheme paints body text with — is 6.13:1 on
		// `elevated`, under the 7:1 floor. Lifted along the same grey-teal.
		ink: "#BECACA",
		// Base1 and base0 sit ΔE00 4.5 apart, so the readout rung below could not hold the
		// 8 ink step against upstream's control tone. This is base1's own grey-teal seated a
		// step up, which keeps the readout rung quiet and still distinct.
		inkMuted: "#B1C0C0",
		// Base0 839496 is 3.77:1 on `elevated` (< 4.5) and only ΔE00 4 from base1. Lifted
		// along the same grey-teal to the floor corner, which is also what separates it from
		// the control rung above.
		inkDim: "#91A4A6",
		inkDisabled: "#586E75",

		// Derived: the scheme's recessed tones are panel fills, not 1px lines. Holds ΔE00
		// 4.2 from every ground and 1.22-1.64:1 against them.
		hairline: "#1E4955",
		// Base01 586E75 is 1.14:1 against the grounds — an inactive-tone value in a
		// structural role. Lifted along the same grey-teal to 3.1:1 on the lightest
		// ground.
		borderControl: "#5B8893",

		// Upstream cyan 2AA198 is 3.78:1 on `elevated` (< 4.5). Lifted along the same cyan;
		// the scheme's defining hue, kept.
		accent: "#32A79D",
		accentHover: "#53C3B8",
		// A step toward the ground from the accent: the pressed fill has to stay an edge on
		// the lightest ground and keep the page tone legible on itself.
		accentActive: "#249D94",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		chartBarHover: "#5CCBC0",
		accentWash: "#01333D",
		onAccent: "#00252E",

		// Upstream green 859900 is 3.72:1 on `elevated` (< 4.5). Lifted along the same
		// olive.
		success: "#8BA013",
		successWash: "#0B3338",
		successBorder: "#778A01",

		// Upstream yellow B58900 is 3.72:1 on `elevated` (< 4.5). Lifted along the same
		// amber.
		warning: "#C79A27",
		warningWash: "#223B3A",
		warningBorder: "#A37B02",

		// The scheme's red DC322F is unreadable as UI text on this ground (2.58:1); lifted
		// along the same red, which is the one hue Solarized uses for a warning about real
		// failure.
		danger: "#FF776B",
		dangerWash: "#2A2028",
		dangerBorder: "#DA554C",

		// Upstream blue 268BD2 is 3.24:1 on `elevated` (< 4.5). Lifted along the same blue,
		// and kept distinct from the cyan accent so a callout does not read as a primary
		// action.
		info: "#3D9DE3",
		infoWash: "#023241",
		infoBorder: "#2087CB",

		// The shadow and scrim are the ground tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
