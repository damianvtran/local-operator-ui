import type { ThemeDefinition } from "../palette-contract";

/**
 * One Dark — Atom's official syntax theme, from atom/one-dark-syntax (styles/colors.less).
 *
 * Upstream defines this palette in HSL, so the values here are that source converted: mono-1
 * hsl(220,13%,18%) = 282C34 as the page, mono-2 = 2D3139 and mono-3 = 333842 as the two raised
 * grounds, mono-0 = 21252B as the well below; hue-1 cyan 56B6C2, hue-2 blue 61AFEF, hue-3
 * purple C678DD, hue-4 green 98C379, hue-5 red E06C75, hue-6-2 orange E5C07B.
 *
 * One Dark is tuned for syntax on charcoal, where a token only has to be readable beside its
 * neighbours and nothing has to clear 7:1: the foreground lands at 5.95:1 on the raised ground
 * and the red at 3.26:1, so both are lifted along their own hues, with the miss recorded at the
 * role. The blue takes the accent, unmodified, and the cyan keeps `info` so a callout does not
 * read as a primary action.
 *
 * The two lower ink weights are the third solve, and it is a contrast one rather than an ink
 * step: the scheme's comment grey is a syntax tone at 2.84:1 on the raised ground, so both are
 * lifted along the same neutral — the quieter one to the floor corner, and the pair ends up
 * ΔE00 8.2 apart, which the ink step asks for anyway.
 *
 * Roles the scheme has no token for follow one rule each: `chartBarHover` steps the accent
 * away from the plot ground until it clears ΔE00 10 from `accent`; a semantic wash is the hue
 * tinted over `canvas` at the strongest alpha that keeps its own ink at 4.5:1 (the scheme's own
 * tints stand in where they clear it); a semantic border walks its hue toward the ground to
 * just above the 3:1 edge floor; the shadow and the scrim are the ground tinted.
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
export const oneDark: ThemeDefinition = {
	id: "oneDark",
	name: "One Dark",
	description: "Atom's night standard — cool charcoal with the One accent row.",
	palette: {
		mode: "dark",

		// Upstream mono-1, the page.
		canvas: "#282C34",
		// Upstream mono-2, and `elevated` is mono-3: the scheme's own two raised tones.
		// ΔE00 2.2 and 2.4 up the ladder, with the well one step under mono-0.
		surface: "#2F343D",
		elevated: "#353B46",
		sunken: "#21252B",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 4.2 `L*` lighter (branch L of this port's selection rule), and
		 * carrying 1.61x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is the ΔE00 4.08-to-4 band
		 * on `surface`. ΔE00 4.08 from `surface`, 2.02 from `elevated`, 8.84 from
		 * `sunken`, 5.59 from `accentWash`; the inks on the ground are 7.83:1,
		 * 7.31:1, 5.26:1. Continuity with the panel: hue 2.06 degrees off the
		 * panel's (the assertion allows 12) and chroma 10.24 where the panel carries
		 * 6.36.
		 */
		highlight: "#353D4C",

		// Canonical mono-4 BEC4D0 is 5.95:1 on `elevated` — the 7:1 body floor is more than a
		// reach for a syntax foreground. Lifted along the same cool neutral.
		/*
		 * Legibility pass: `ink` is re-seated on the lifted grounds, where its floor
		 * is 7:1 on all six grounds and `elevated` binds it at 8.07:1.
		 *
		 * It also carries the transcript's own 8.0:1 on `canvas`, which is the
		 * surface the operator's report is about.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		ink: "#D3DBE7",
		// The scheme's lighter comment tier lifted to clear 4.5:1, and seated above its own tone
		// so the readout rung below it keeps the ΔE00 8 ink step.
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.54:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#CBD4E3",
		// The comment grey 7D8695 is 2.84:1 on `elevated` (< 4.5) — it is a syntax comment,
		// not a UI metadata tone. Lifted along its own neutral to the floor corner.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.42:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#AAB5C4",
		inkDisabled: "#5C6370",

		// Derived: the scheme has no rule colour. Holds ΔE00 4.1 from every ground and
		// 1.21-1.79:1 against them, so it divides rather than bounds.
		hairline: "#464C58",
		// Upstream gutter 4B5263 is 1.36:1 against the grounds — a decorative value in
		// a structural role. Lifted along the same neutral to 3.1:1 on the lightest
		// ground.
		borderControl: "#848B9E",

		/*
		 * Legibility pass: `accent` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.51:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		accent: "#63B1F1",
		accentHover: "#8DCBFF",
		accentActive: "#4F9DDC",
		// A step AWAY from the plot ground rather than along the accent ramp: ΔE00 10.2
		// from `accent`. See `chartBarHover` in the palette contract.
		/*
		 * Legibility pass: `chartBarHover` follows `accent` - the ramp is one control seen
		 * three times and the chart's hover mark has to stay ΔE00 10 clear of the
		 * resting mark, so both move at their own hue rather than letting the accent
		 * pull away from them.
		 */
		chartBarHover: "#A0D3FF",
		tokenCommand: "#5ABAC6",
		// The signal lifted in L* to clear 4.5:1 on `elevated` (it measured 4.40), at a
		// cost of ΔE00 1.12 from the signal itself; 5.52:1 on `surface`.
		accentWash: "#28333C",
		onAccent: "#21252B",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#c678dd`,
		 * canonical purple), moved onto the floors: as received it read 4.25:1 as
		 * text on `surface`. The shortfall is paid on LIGHTNESS at the source hue —
		 * L* 62.22 → 64.20 — which is what this port does to every one of its own
		 * tokens. Measured: ΔE00 33.97 from `accent`, 25.83 from its nearest
		 * semantic (`danger`), 4.53:1 on the tightest ground (`surface`).
		 */
		accentAlt: "#CC7DE3",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 20.62 and C* 7.46, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 11.32 from `accentWash` (the field floor is
		 * 2.0), 4.67:1 for `accentAlt` on it, and 7.53 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#372F39",

		success: "#98C379",
		successWash: "#3E4943",
		successBorder: "#6E974E",

		warning: "#E5C07B",
		warningWash: "#555048",
		warningBorder: "#A98641",

		// Canonical red E06C75 is 3.26:1 on `elevated` (< 4.5), the widest miss here. Lifted
		// along the same red, which keeps it a syntax token and a danger callout at once.
		danger: "#FF8990",
		dangerWash: "#362A31",
		dangerBorder: "#DA6870",

		/*
		 * Legibility pass: `info` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `elevated` binds it there at
		 * 4.5:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		info: "#58B8C4",
		infoWash: "#263647",
		infoBorder: "#3498A4",

		// The shadow and scrim are the ground tinted, as in every palette here.
		overlayShadow: "0 12px 32px -12px rgb(9 9 14 / 0.65)",
		scrim: "rgb(9 9 14 / 0.6)",
	},
};
