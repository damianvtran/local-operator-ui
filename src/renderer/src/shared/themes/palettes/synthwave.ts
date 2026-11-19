import type { ThemeDefinition } from "../palette-contract";

/**
 * Synthwave '84.
 *
 * Synthwave '84, and this family's reference point for restraint inside neon:
 * every canonical hue of the published scheme clears the floors on the
 * canonical ground, so the theme is fidelity rather than invention. What makes
 * it itself is the purple-violet ramp — Outrun's grounds are midnight blue,
 * Vaporwave's a lighter mall-purple, Matrix's green-black — and a LIGHT neon
 * pink accent, ΔE00 17 from the shipped Synth theme's FF4081 and 61 from
 * Neon's cyan, so the three pink-and-cyan themes in this app do not read as
 * one screen with one different accent.
 *
 * Carried from the TUI's `synthwave` ThemeSpec: all four grounds, `fg`, `muted`,
 * `accent`, `success`, `warning`, `signal`, `edge`, `edge-hi` and the comment
 * violet (`dim`) verbatim.
 *
 * Derived, by one rule each, the same across this family: `accentHover`
 * +9 L* and `accentActive` -12 L* on the accent (the pressed step floored
 * where `onAccent` still clears 4.5:1 on it, and where the fill still has a
 * 3:1 edge on `elevated`); `chartBarHover` mixed toward `ink` until it is ΔE00
 * 10.5 from `accent`, then lifted further if that landed closer to `surface`
 * than the accent does; `accentWash` the accent at 13% over `canvas`;
 * `onAccent` the canvas at 42% of its L*, hue held; every semantic wash its hue
 * at 13% over `canvas` and every semantic border its hue at 45%, lifted in L*
 * until it clears 3:1 on `elevated`, the lightest ground it is drawn on;
 * `inkDisabled` the TUI `faint` lifted to 2.3:1 on `elevated` (the one role
 * with no floor, kept a colour rather than a hole); `borderControl` the TUI
 * `edge-hi` lifted to 3:1 on `elevated`; the shadow and scrim `canvas` at 40%,
 * so they carry this palette's cast rather than neutral black.
 *
 * `accentAlt`, from the same change, is this family's own `label` token — the one
 * non-neutral hue the port dropped — taken unchanged where it already clears the
 * floors and otherwise walked off its own hue, which each palette's note below
 * says by how much; `accentAltWash` is that hue carrying `accentWash`'s own `L*`
 * and `C*`, which is what "the same treatment" means once the two hues have
 * different chroma available at that lightness. Both roles are decorative: no
 * interaction, no selection ground and no semantic may take them — the divider
 * is in `palette-contract.ts` and `docs/branding.md` § 2.
 *
 * The TUI's `overlay`, `string` and five `tint-*` tokens have no role here: this
 * contract has no popover ground and no selection tint, so the tints above are
 * derived from the accent instead. Its `label` token is the one that does land,
 * as `accentAlt` above.
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
export const synthwave: ThemeDefinition = {
	id: "synthwave",
	name: "Synthwave '84",
	descriptionKey: "ui.settings.appearance.theme.synthwave",
	palette: {
		mode: "dark",

		/*
		 * THE DARKER-GROUNDS PASS (2026-11-03, `docs/branding.md` § 2) supersedes the
		 * earlier L* 12 dark floor: the dark band is now L* 9-15 (target 9-13), and
		 * the canvas maps by `L*_new = 9 + 0.6 x (L*_old - 12)`, a map that preserves
		 * the fleet's order (re-solves may move a canvas off it, up to +-1.04 L*).
		 * Here every ground-class role (the grounds, the row states, the two fills,
		 * the washes and the hairlines) moved by the canvas's own ΔL* holding its `a`
		 * and `b`; inks, accents and `borderControl` did not move.
		 * Measured:
		 * canvas #262335 -> #1E1B2D (L* 14.80 -> 10.92)
		 * surface #2D2A41 -> #242138 (L* 18.34 -> 14.11)
		 * elevated #332F4A -> #2A2640 (L* 20.95 -> 16.74)
		 * sunken #1E1B2A -> #161322 (L* 10.76 -> 6.79)
		 * Re-solved off the uniform shift, because a contract floor refused it there:
		 * `messageSurface`. `pnpm check-themes` is the measurement for each.
		 */
		canvas: "#1E1B2D",
		surface: "#242138",
		elevated: "#2A2640",
		sunken: "#161322",

		// The user block's fill: ΔE00 4.10 off the canvas, where `surface` alone
		// measures 3.08 - a step toward `elevated` to clear the role's 4.0 floor,
		// which the block carries because the fill IS its boundary.
		messageSurface: "#28253d",
		// The media slot's well: ΔE00 4.18 off the canvas, where `sunken` alone
		// measures 2.86 - a step away from the canvas to clear the role's 4.0
		// floor, which the tile carries because the fill IS its resting extent.
		// Lifted #130f1d -> #15111e (L* 5.14 -> 5.91) once Team Bridge's
		// inline images and file chips began to paint this well (#1659): as far
		// toward L* 6 as the media floor allows (ΔE00 4.06 off canvas; chip hosts >= 3.0).
		mediaSurface: "#15111e",
		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are a
		 * step of THIS palette's own panel at the panel's own hue; they used to be
		 * tints of `accent`, whose hue is more than 45 degrees off the panel on 25 of
		 * the 59 themes - the off-colour the operator reported. The rule, and why the
		 * fill now carries the ranking the 2px `accent` bar used to, are in the two
		 * roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #33313F  panel hue, C* 9.53,
		 *                       the rule's 0.60 x the panel's 15.94; +2.71 L*,
		 *                       ΔE00 4.78 off `surface`, `inkDim` 5.28:1.
		 * rowSelected #363250  panel hue, C* 20.21,
		 *                       the panel's cast + 4.0, floored at 5.0; +4.12 L*,
		 *                       ΔE00 3.78 off `surface` and 6.92 off
		 *                       `rowHover`; the pair ranks 1.41 `L*` and 10.7 `C*`,
		 *                       `inkDim` 5.04:1.
		 */
		rowHover: "#2A2836",
		rowSelected: "#2D2946",

		ink: "#F2EFF8",
		inkMuted: "#BCB3D4",
		// The TUI `dim` 848BBD lifted in L* with hue held: it measured 4.22 on
		// `surface` and 3.78 on `elevated`, and this app draws tertiary text on both.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `accentWash` binds it at 5.01:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#9DA4D6",
		// The TUI `faint` 575071 lifted to 2.37:1 on `elevated`.
		inkDisabled: "#6D6688",

		// The TUI `edge` 443F5E, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds.
		hairline: "#3B3654",
		// `hairline` stepped toward `inkDim`, so it reads on this palette's own
		// `sunken`: 1.84:1 there against `hairline`'s 1.70:1.
		hairlineStrong: "#3F3B5A",
		// The TUI `edge-hi` 544E72 lifted in L* until it clears 3:1 on `elevated`, the
		// lightest ground it is drawn against.
		borderControl: "#837CA2",

		accent: "#FF7EDB",
		accentHover: "#FF97F5",
		accentActive: "#DB5DBA",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.7 from
		// `accent` and 8.17:1 on `surface`, where the accent measures 6.10:1.
		chartBarHover: "#F9B0E8",
		tokenCommand: "#36F9F6",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#392641",
		// The canvas at 42% of its L*: this accent is far too light for a light label
		// to clear 4.5:1 on it.
		onAccent: "#151123",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#b893ce`),
		 * moved onto the floors: as received it sat ΔE00 13.89 from `accent`. That
		 * is paid on HUE — the hue walked 14.5° off the source and L* 66.15 → 65.57
		 * — because a value that bought the separation by darkening would be the
		 * same hue at another weight. Measured: ΔE00 19.95 from `accent`, 31.78
		 * from its nearest semantic (`danger`), 5.24:1 on the tightest ground
		 * (`surface`).
		 */
		accentAlt: "#A397D6",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 22.65 and C* 20.30, with the hue moved to
		 * `accentAlt`'s, with the L* walked -3.50 because the chip's own ink floor
		 * binds (`accentAlt` on the wash needs 4.5:1). Measured: ΔE00 5.64 from
		 * `accentWash` (the field floor is 2.0), 5.08:1 for `accentAlt` on it, and
		 * 2.06 from the nearest ground it is painted on.
		 */
		/*
		 * LIFTED #27223E -> #342E4C (L* 15.08 -> 20.85, hue and chroma held) for
		 * Team Bridge's person plates (visual refresh, contract C2; design round 1,
		 * D1): the plate is borderless, so its fill must clear ΔE00 3.0 off every
		 * ground it sits on. It measured 1.52; it now measures 3.13 at worst
		 * (`elevated`), with `accentAlt` 4.85:1 on it.
		 */
		accentAltWash: "#342E4C",

		// 72F1B8, published — the same value the TUI uses for `string`.
		success: "#72F1B8",
		successWash: "#27353D",
		successBorder: "#538B7A",

		// FEDE5D, published.
		warning: "#FEDE5D",
		warningWash: "#393231",
		warningBorder: "#90804F",

		// The published red FE4450 measures 3.63:1 as text on `elevated`, the dialog
		// ground a required-mark or a destructive label is drawn on, so it is lifted
		// in L* with hue and chroma held to 4.61:1 — ΔE00 7.7 from the published red.
		// Darkening `elevated` instead cannot work: the floor needs a ground darker
		// than `canvas` itself, which would collapse the four-step ramp.
		/*
		 * Legibility pass: `danger` is drawn as text on all six grounds, so it keeps
		 * 4.5:1 on every one of them and moves with them; `accentWash` binds it there at
		 * 4.52:1.
		 *
		 * Lightness only, along the role's own hue: the palette's identity, not its
		 * legibility, is what the ramp change was allowed to keep.
		 */
		danger: "#FF7173",
		dangerWash: "#392434",
		dangerBorder: "#B36D76",

		// 36F9F6, the TUI's `signal` — the published scheme's cyan, and the only other
		// bright hue it names that is not the accent.
		info: "#36F9F6",
		infoWash: "#1E3645",
		infoBorder: "#378C95",

		overlayShadow: "0 12px 32px -12px rgb(15 14 21 / 0.75)",
		scrim: "rgb(15 14 21 / 0.65)",
	},
};
