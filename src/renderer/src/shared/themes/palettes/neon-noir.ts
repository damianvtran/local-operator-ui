import type { ThemeDefinition } from "../palette-contract";

/**
 * Neon Noir.
 *
 * Neon through rain, and deliberately the quietest member of this family. It
 * is the only theme here with a near-neutral ground — a cool charcoal, no hue
 * cast at all — and every sign colour is knocked back to wet-pavement
 * saturation: dim cyan accent, rose danger, sodium amber, rain-blue signal.
 * Nothing in it is at the saturation its siblings are, which is the whole
 * point: it should feel like the city at 3am, two blocks from the signs.
 *
 * Carried from the TUI's `neon-noir` ThemeSpec: all four grounds, `fg`, `muted`,
 * `accent`, `success`, `warning`, `danger`, `signal` and `dim` (lifted, below);
 * `edge` moved by two L*, below.
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
export const neonNoir: ThemeDefinition = {
	/* The id is camelCase like every other palette's, even though this one's
	   file name is hyphenated: the id is a `ThemeName` union member and a
	   `[data-theme="…"]` selector, and one hyphenated member beside
	   fifty-eight camelCase ones is a spelling nobody remembers when they
	   come to grep for it. */
	id: "neonNoir",
	name: "Neon Noir",
	description: "Rain-dimmed cyan and magenta signs over 3am charcoal.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas ship as L* offsets from it (surface
		 * +3.85, elevated +6.52, sunken -2.40 L*), which is what every ink, edge
		 * and wash block below is measured against - and the offsets the LEGIBILITY PASS
		 * recorded (surface +3.94, elevated +8.14, sunken -2.47 L*) ARE ITS AUTHORING INPUT, NOT THE SHIPPED
		 * RUNG: the row/hover pass moved `elevated` down to the ladder's floor so the
		 * current row can outrank a hovered neighbour. Measured, both moves:
		 * canvas #15171C -> #1D2025 -> #23262B  (L* 7.73 -> 12.14 -> 15.05)
		 * surface #1C1F26 -> #25282F -> #2B2E35  (L* 11.73 -> 16.09 -> 18.91)
		 * elevated #242830 -> #2A2E37 -> #2F343D  (L* 16.03 -> 18.89 -> 21.57)
		 * sunken #101216 -> #191B1E -> #1F2124  (L* 5.43 -> 9.67 -> 12.65)
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
		canvas: "#23262B",
		surface: "#2B2E35",
		elevated: "#2F343D",
		sunken: "#1F2124",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are a
		 * step of THIS palette's own panel at the panel's own hue; they used to be
		 * tints of `accent`, whose hue is more than 45 degrees off the panel on 25 of
		 * the 59 themes - the off-colour the operator reported. The rule, and why the
		 * fill now carries the ranking the 2px `accent` bar used to, are in the two
		 * roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #333539  panel hue, C* 2.81,
		 *                       the rule's 0.60 x the panel's 4.95; +3.20 L*,
		 *                       ΔE00 2.91 off `surface`, `inkDim` 5.29:1.
		 * rowSelected #323846  panel hue, C* 9.55,
		 *                       the panel's cast + 4.0, floored at 5.0; +4.60 L*,
		 *                       ΔE00 4.77 off `surface` and 5.46 off
		 *                       `rowHover`; the pair ranks 1.39 `L*` and 6.7 `C*`,
		 *                       `inkDim` 5.05:1.
		 */
		rowHover: "#333539",
		rowSelected: "#323846",

		ink: "#DCDFE4",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.22:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		/*
		 * Register re-solve: `inkMuted`
		 * Re-seated a second time, with the band, and lightness is still the only
		 * axis: the floor is 5.5:1 on all SEVEN grounds (the four elevation
		 * steps, `accentWash` and the two row states), and `rowSelected` binds it at
		 * 6.97:1.
		 * The contract's 8 ΔE00 step down to `inkDim` measures
		 * 8.14, and it is what sets the value as much as the floor does.
		 */
		inkMuted: "#C2C8D5",
		// The TUI `dim` 767E8C lifted in L* with hue held: it measured 4.38 on
		// `canvas` and 3.61 on `elevated`, the worst miss in this family, because this
		// ink and these grounds are both near-neutral.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.26:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		/*
		 * Register re-solve: `inkDim`
		 * Re-seated a second time, with the band, and lightness is still the only
		 * axis: the floor is 5:1 on all SEVEN grounds (the four elevation
		 * steps, `accentWash` and the two row states), and `rowSelected` binds it at
		 * 5.03:1.
		 * The contract's 8 ΔE00 step up to `inkMuted` measures
		 * 8.14, and it is what sets the value as much as the floor does.
		 */
		inkDim: "#A1ABB9",
		// The TUI `faint` 454B56 lifted to 2.3:1 on `elevated`.
		inkDisabled: "#595F6A",

		// The TUI `edge` 2B303A raised two L* so the rule clears the hairline's ΔE00
		// 4.0 floor against `elevated`: in a grey ramp, where ΔE00 has no chroma to
		// spend, the rule is carried entirely by lightness.
		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 4.22.
		 */
		/*
		 * Register re-solve: `hairline`
		 * The one role whose rule binds at BOTH ends, so it is re-solved against all
		 * four grounds at once: a rule has to be seen (ΔE00 4.0) without becoming a
		 * border (2:1), and the window is walked at the role's own hue. Its ratio
		 * lands at 1.22:1 against `elevated` at its tightest.
		 */
		hairline: "#3B414B",
		// The TUI `edge-hi` 3A414E lifted in L* until it clears 3:1 on `elevated`.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3.01:1. Lightness only, at the role's own hue.
		 */
		/*
		 * Register re-solve: `borderControl`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.01:1. Lightness only, at the role's own
		 * hue.
		 */
		borderControl: "#757D8B",

		// 5FC4D4 — a dim cyan, not a neon. The one accent here that would look
		// underpowered in any other theme in the family, and the reason this one reads
		// as reflected light.
		accent: "#5FC4D4",
		accentHover: "#7ADDED",
		accentActive: "#38A3B3",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.6 from
		// `accent` and 10.47:1 on `surface`, where the accent measures 8.11:1.
		chartBarHover: "#ACD5DE",
		tokenCommand: "#7AA8D8",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#26333B",
		onAccent: "#090C13",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#b48ec6`), received unchanged because it already clears
		 * every floor — ΔE00 35.82 from `accent`, 39.44 from its nearest semantic
		 * (`danger`), 5.36:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#b48ec6",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 20.42 and C* 7.46, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 11.26 from `accentWash` (the field floor is
		 * 2.0), 4.65:1 for `accentAlt` on it, and 5.86 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#363039",

		success: "#6CC49A",
		successWash: "#202D2C",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.13:1.
		 */
		/*
		 * Register re-solve: `successBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.00:1. Lightness only, at the role's own
		 * hue.
		 */
		successBorder: "#5A8574",

		warning: "#CFAE62",
		warningWash: "#2D2B25",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.15:1.
		 */
		/*
		 * Register re-solve: `warningBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.02:1. Lightness only, at the role's own
		 * hue.
		 */
		warningBorder: "#8B7B5A",

		// E07A8A, the TUI's rose: a neon sign seen through a wet window rather than a
		// saturated red.
		danger: "#E47D8D",
		dangerWash: "#2F242A",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.13:1.
		 */
		/*
		 * Register re-solve: `dangerBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.00:1. Lightness only, at the role's own
		 * hue.
		 */
		dangerBorder: "#A06F79",

		// 7AA8D8, the TUI's `signal` — rain blue, kept distinct from the dim cyan
		// accent.
		info: "#7AA8D8",
		infoWash: "#222A34",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.17:1.
		 */
		/*
		 * Register re-solve: `infoBorder`
		 * Structural, so it keeps the 3:1 floor on all four grounds and moves with
		 * them: `elevated` binds it at 3.04:1. Lightness only, at the role's own
		 * hue.
		 */
		infoBorder: "#697F99",

		overlayShadow: "0 12px 32px -12px rgb(8 9 11 / 0.75)",
		scrim: "rgb(8 9 11 / 0.65)",
	},
};
