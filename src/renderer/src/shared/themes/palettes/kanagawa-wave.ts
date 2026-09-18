import type { ThemeDefinition } from "../palette-contract";

/**
 * Kanagawa Wave.
 *
 * Carried from rebelot/kanagawa.nvim, the default `wave` variant, resolved
 * through `lua/kanagawa/themes.lua` rather than read off the palette names: the
 * scheme's own `ui.bg` is sumiInk3, with sumiInk4 and sumiInk5 above it and
 * sumiInk0 below, which is exactly the four grounds this contract wants.
 *
 * Kanagawa's ink-wash ground is dark enough that most of the palette clears the
 * floors unmodified — fujiWhite, oldWhite, springGreen, carpYellow and the aqua
 * all ship canonical. Three roles move, each for the reason recorded beside it.
 *
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`.
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
export const kanagawaWave: ThemeDefinition = {
	id: "kanagawaWave",
	name: "Kanagawa Wave",
	description: "Hokusai ink-wash night, muted paper tones on deep sumi.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +4.98, elevated +10.65, sunken -4.59 L*), so the hierarchy the
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #1F1F28 -> #1F1F28 (L* 12.12 -> 12.12)
		 * surface #2A2A37 -> #292936 (L* 17.57 -> 17.1)
		 * elevated #363646 -> #353545 (L* 23.22 -> 22.77)
		 * sunken #16161D -> #16161D (L* 7.53 -> 7.53)
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
		canvas: "#1F1F28",
		surface: "#292936",
		elevated: "#353545",
		sunken: "#16161D",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 4.6 `L*` lighter (branch L of this port's selection rule), and
		 * carrying 1.49x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `ink-dim` at 5.21:1 on
		 * the row's ground. ΔE00 4.4 from `surface`, 2.1 from `elevated`, 11.08 from
		 * `sunken`, 4.52 from `accentWash`; the inks on the ground are 8.61:1,
		 * 6.79:1, 5.21:1. Continuity with the panel: hue 0.69 degrees off the
		 * panel's (the assertion allows 15) and chroma 13.49 where the panel carries
		 * 9.05.
		 */
		highlight: "#323246",

		// fujiWhite, 8.16:1 on the lightest ground.
		ink: "#DCD7BA",
		// oldWhite.
		inkMuted: "#C8C093",
		// springViolet1 938AA9 is 3.64:1 on `elevated`, under the 4.5 floor;
		// lifted on-hue.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `highlight` binds it at 5.15:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#ABA4BA",
		// fujiGray, the scheme's own comment colour.
		inkDisabled: "#727169",

		// sumiInk5 is `elevated` itself; sumiInk6 54546D is 1.62:1 on it — a
		// ground colour, not a rule. Lifted along the same violet-grey.
		hairline: "#424353",
		borderControl: "#7E7E9C",

		// crystalBlue 7E9CD8 is 4.31:1 on `elevated`, and solving at the 4.5
		// floor leaves no room for a darker `accentActive`. Lifted to 5.25:1 so
		// all three accent states separate.
		accent: "#94ADDF",
		accentHover: "#AFC2E7",
		accentActive: "#83A0DA",
		// ΔE00 10.5 from `accent` and 9.6:1 on surface, where the accent is
		// 6.3:1.
		chartBarHover: "#BBD6FF",
		tokenCommand: "#7DAAA1",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#2A2D3A",
		onAccent: "#1F1F28",
		/*
		 * The theme's own second hue, from the TUI's `label` token (`#957FB8`,
		 * canonical oniViolet), moved onto the floors: as received it read 4.10:1
		 * as text on `surface`. The shortfall is paid on LIGHTNESS at the source
		 * hue — L* 57.10 → 60.16 — which is what this port does to every one of its
		 * own tokens. Measured: ΔE00 15.59 from `accent`, 29.18 from its nearest
		 * semantic (`danger`), 4.55:1 on the tightest ground (`surface`).
		 */
		accentAlt: "#9D87C0",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 18.69 and C* 8.99, with the hue moved to
		 * `accentAlt`'s, with the L* walked -1.50 because the chip's own ink floor
		 * binds (`accentAlt` on the wash needs 4.5:1). Measured: ΔE00 4.61 from
		 * `accentWash` (the field floor is 2.0), 4.54:1 for `accentAlt` on it, and
		 * 2.73 from the nearest ground it is painted on.
		 */
		accentAltWash: "#2D2835",

		// springGreen.
		success: "#98BB6C",
		successWash: "#2A2D2E",
		successBorder: "#98BB6C",

		// carpYellow.
		warning: "#E6C384",
		warningWash: "#343032",
		warningBorder: "#E6C384",

		// peachRed FF5D62 is 3.94:1 on `elevated`; lifted on-hue.
		danger: "#FF777A",
		dangerWash: "#32262F",
		dangerBorder: "#FF7478",

		// waveAqua2 7AA89F clears the floor at 4.47:1 on `elevated`, a hair
		// under 4.5; nudged on-hue to 4.59:1.
		info: "#7DAAA1",
		infoWash: "#2C3238",
		infoBorder: "#7CA9A0",

		overlayShadow: "0 12px 32px -12px rgb(12 12 17 / 0.72)",
		scrim: "rgb(12 12 17 / 0.62)",
	},
};
