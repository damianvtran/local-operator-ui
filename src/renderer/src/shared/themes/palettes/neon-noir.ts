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
 * The TUI's `overlay`, `label`, `string` and five `tint-*` tokens have no role
 * here: this contract has no popover ground, no second label hue and no
 * selection tint, so the tints above are derived from the accent instead.
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
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.94, elevated +8.14, sunken -2.47 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #15171C -> #1D2025 (L* 7.73 -> 12.14)
		 * surface #1C1F26 -> #25282F (L* 11.73 -> 16.09)
		 * elevated #242830 -> #2D313A (L* 16.03 -> 20.28)
		 * sunken #101216 -> #191B1E (L* 5.43 -> 9.67)
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
		canvas: "#1D2025",
		surface: "#25282F",
		elevated: "#2D313A",
		sunken: "#191B1E",

		/*
		 * The current row's own ground:
		 * `surface` cast 0.06 toward `accent` — branch H of this port's selection rule
		 * — and then stepped 3.25 on the `L*` axis in the mode's direction, so the mark
		 * is a LIGHTNESS step and the cast pays only what the ramp could not. ΔE00
		 * 4.03 from `surface`, 3.15 from `elevated` and 7.12 from `sunken`;
		 * the step is 3.35 `L*`, in the band this branch raised to 4.0, with
		 * inkDim at 4.76:1 the ink that binds it.
		 */
		highlight: "#1E272E",

		ink: "#DCDFE4",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 6.91:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#B7BDCA",
		// The TUI `dim` 767E8C lifted in L* with hue held: it measured 4.38 on
		// `canvas` and 3.61 on `elevated`, the worst miss in this family, because this
		// ink and these grounds are both near-neutral.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.04:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#98A2B0",
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
		hairline: "#383E48",
		// The TUI `edge-hi` 3A414E lifted in L* until it clears 3:1 on `elevated`.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3.01:1. Lightness only, at the role's own hue.
		 */
		borderControl: "#727A88",

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
		accentWash: "#1F2D34",
		onAccent: "#090C13",

		success: "#6CC49A",
		successWash: "#202D2C",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		successBorder: "#578271",

		warning: "#CFAE62",
		warningWash: "#2D2B25",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.02:1.
		 */
		warningBorder: "#887857",

		// E07A8A, the TUI's rose: a neon sign seen through a wet window rather than a
		// saturated red.
		danger: "#E07A8A",
		dangerWash: "#2F242A",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3:1.
		 */
		dangerBorder: "#9D6C76",

		// 7AA8D8, the TUI's `signal` — rain blue, kept distinct from the dim cyan
		// accent.
		info: "#7AA8D8",
		infoWash: "#222A34",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.03:1.
		 */
		infoBorder: "#667C96",

		overlayShadow: "0 12px 32px -12px rgb(8 9 11 / 0.75)",
		scrim: "rgb(8 9 11 / 0.65)",
	},
};
