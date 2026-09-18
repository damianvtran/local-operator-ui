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

		canvas: "#15171C",
		surface: "#1C1F26",
		elevated: "#242830",
		sunken: "#101216",

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
		inkMuted: "#A6ACB8",
		// The TUI `dim` 767E8C lifted in L* with hue held: it measured 4.38 on
		// `canvas` and 3.61 on `elevated`, the worst miss in this family, because this
		// ink and these grounds are both near-neutral.
		inkDim: "#88919F",
		// The TUI `faint` 454B56 lifted to 2.3:1 on `elevated`.
		inkDisabled: "#595F6A",

		// The TUI `edge` 2B303A raised two L* so the rule clears the hairline's ΔE00
		// 4.0 floor against `elevated`: in a grey ramp, where ΔE00 has no chroma to
		// spend, the rule is carried entirely by lightness.
		hairline: "#30353F",
		// The TUI `edge-hi` 3A414E lifted in L* until it clears 3:1 on `elevated`.
		borderControl: "#6D7583",

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
		successBorder: "#537D6C",

		warning: "#CFAE62",
		warningWash: "#2D2B25",
		warningBorder: "#827252",

		// E07A8A, the TUI's rose: a neon sign seen through a wet window rather than a
		// saturated red.
		danger: "#E07A8A",
		dangerWash: "#2F242A",
		dangerBorder: "#976771",

		// 7AA8D8, the TUI's `signal` — rain blue, kept distinct from the dim cyan
		// accent.
		info: "#7AA8D8",
		infoWash: "#222A34",
		infoBorder: "#607690",

		overlayShadow: "0 12px 32px -12px rgb(8 9 11 / 0.75)",
		scrim: "rgb(8 9 11 / 0.65)",
	},
};
