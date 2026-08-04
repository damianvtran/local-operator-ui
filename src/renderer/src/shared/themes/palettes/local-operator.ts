import type { ThemeDefinition } from "../palette-contract";

/**
 * The two brand palettes, and the reference implementation of the role
 * contract.
 *
 * These carry the values from the Local Operator design kit verbatim — the
 * same warm ramp, accent and semantic triples the marketing site ships, so a
 * user moving from local-operator.com into the app lands on the same surface.
 * Every other palette in this directory is a community or third-party identity
 * and only has to *satisfy* the contract; these two *are* the brand, so when
 * the two disagree, these win.
 *
 * ## The warm neutral rule
 *
 * The ramp holds `R > G > B` in light and `R >= G > B` in dark. That is what
 * makes it read as paper and ink rather than as grey, and it is the one
 * structural property a palette cannot fake with a hue rotation. A theme does
 * not have to be warm, but its neutrals must be *consistently* tinted in one
 * direction — mixed-temperature neutrals are what make a palette look
 * accidental.
 *
 * @see docs/branding.md § 2 — the ramp and why it is tinted
 */

/** Verified 2026-08-04 against docs/design-kit/tokens.json in the site repo. */
export const localOperatorDark: ThemeDefinition = {
	id: "localOperatorDark",
	name: "Local Operator Dark",
	description: "The default. Warm near-black with the brand green.",
	palette: {
		mode: "dark",

		canvas: "#16130e",
		surface: "#1e1a14",
		elevated: "#282318",
		sunken: "#0f0c08",

		ink: "#f1eee6",
		inkMuted: "#b5afa2",
		inkDim: "#918b7d",
		inkDisabled: "#5f5a4e",

		hairline: "#2b2619",
		borderControl: "#837c6d",

		accent: "#38c96a",
		accentHover: "#5ad584",
		accentActive: "#2bb25c",
		accentWash: "#16281d",
		onAccent: "#16130e",

		success: "#57c785",
		successWash: "#16281d",
		successBorder: "#417557",
		warning: "#e0b04b",
		warningWash: "#2a2213",
		warningBorder: "#857036",
		danger: "#ef8078",
		dangerWash: "#2e1b18",
		dangerBorder: "#9e5a51",
		// The kit has no `info` role: on the site, "informational" is carried by
		// the accent, because a fourth semantic hue is a hue nobody can name.
		// The app needs one anyway — `palette.info` is read by application code
		// and by MUI's own Alert — so it is defined here as the accent's own
		// triple rather than as a new blue. That keeps "one accent, spent about
		// three times per screen" true, and it is why an info Alert in this app
		// is green rather than the blue MUI would otherwise have supplied.
		info: "#38c96a",
		infoWash: "#16281d",
		infoBorder: "#4a8160",

		overlayShadow: "0 12px 32px -12px rgb(0 0 0 / 0.6)",
		scrim: "rgb(0 0 0 / 0.6)",
	},
};

/** Verified 2026-08-04 against docs/design-kit/tokens.json in the site repo. */
export const localOperatorLight: ThemeDefinition = {
	id: "localOperatorLight",
	name: "Local Operator Light",
	description: "Warm paper and ink, with the brand green.",
	palette: {
		mode: "light",

		/*
		 * The four grounds are a lightness ladder, and on a light theme the top
		 * of it is cramped: `elevated` is already a shade off white, so there is
		 * almost no headroom above `surface`. `surface` was #fcfbf7, which left
		 * only 1.0267:1 against `elevated` - below the 1.03 separation floor,
		 * and passing only because the gate rounded before comparing. Popovers
		 * and dropdowns were relying on their shadow alone to be a different
		 * surface.
		 *
		 * #faf9f5 spends the room evenly instead of scraping the floor on one
		 * side: 1.0420 against `canvas` below and 1.0446 against `elevated`
		 * above. Change one of these four and re-run `pnpm check-themes`; they
		 * are a ladder and only make sense relative to each other.
		 */
		canvas: "#f7f4ee",
		surface: "#faf9f5",
		elevated: "#fffefb",
		sunken: "#efece3",

		ink: "#211e18",
		inkMuted: "#565147",
		inkDim: "#6c675c",
		inkDisabled: "#9a9488",

		hairline: "#e5e0d5",
		// #857f70 against #fffefb is 3.06:1 — it clears the 3:1 structural floor
		// on the lightest ground in the ramp, which is the binding case. The
		// previous light theme used `rgba(0,0,0,0.1)` here, which measured
		// 1.25:1 and was the sole boundary of every input in the app.
		borderControl: "#857f70",

		accent: "#177b45",
		accentHover: "#116036",
		accentActive: "#0c4b2a",
		accentWash: "#e7f1e8",
		onAccent: "#ffffff",

		success: "#1e7b4e",
		successWash: "#e6f1ea",
		successBorder: "#3e6b4e",
		warning: "#8a5800",
		warningWash: "#f5ecd9",
		warningBorder: "#7a5a1e",
		danger: "#b23a31",
		dangerWash: "#f7e7e4",
		dangerBorder: "#96544c",
		info: "#177b45",
		infoWash: "#e7f1e8",
		infoBorder: "#47795b",

		overlayShadow: "0 12px 32px -12px rgb(20 17 12 / 0.25)",
		scrim: "rgb(20 17 12 / 0.35)",
	},
};
