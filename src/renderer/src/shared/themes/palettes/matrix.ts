import type { ThemeDefinition } from "../palette-contract";

/**
 * Matrix.
 *
 * Digital rain, and the family's only fully in-hue ground: a near-black with a
 * green cast, because the cast IS the CRT — a neutral black would leave this
 * just another dark theme with a green accent. Raw phosphor #00FF00 is
 * deliberately absent; the accent is a tamed 22E06A and the body ink a
 * desaturated green-white, so hours of prose do not fatigue the way a screen
 * of #00ff00 does. Its off-hue states (amber, coral, teal, violet) are
 * desaturation-matched to read as glitches in the rain rather than visitors
 * from another theme.
 *
 * Carried from the TUI's `matrix` ThemeSpec: all four grounds, `fg`, `muted`,
 * `dim`, `accent`, `success`, `warning`, `danger`, `signal`, `edge` and `edge-hi`
 * verbatim — the near-black ramp is dark enough that the TUI's own tertiary ink
 * already clears the floors.
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
export const matrix: ThemeDefinition = {
	id: "matrix",
	name: "Matrix",
	description: "Phosphor green rain on a near-black terminal screen.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +2.97, elevated +7.58, sunken -1.62 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #050D07 -> #1C211D (L* 3.03 -> 12.11)
		 * surface #0B160E -> #1F2822 (L* 6.11 -> 15.09)
		 * elevated #122016 -> #212E24 (L* 10.7 -> 17.48)
		 * sunken #020703 -> #1B1D1B (L* 1.55 -> 10.49)
		 *
		 * ONLY LIGHTNESS MOVED. Each value holds its own `a` and `b`, so the theme's
		 * hue and chroma class are exactly what they were and chroma is scaled only
		 * where sRGB forces it - a lift that neutralised a palette to satisfy a floor
		 * would be a different theme, not a lighter one.
		 *
		 * THE COST IS THE BLACK, and it is recorded rather than argued away: this
		 * palette's upstream identity IS near-black, so a user who chose it for that
		 * loses it (`docs/branding.md` § 2 lists the four who pay it). What survives is
		 * the family - the hue, the chroma class and the relative ladder - and the
		 * operator asked for exactly this trade: no page ground in this app sits below
		 * L* 12.
		 *
		 * THE GROUNDS AND THE INKS MOVED TOGETHER, and the header of this file says why:
		 * lifting a dark ground raises the luminance every ink is measured against, so
		 * the inks in this file were re-seated on the same commit rather than after it.
		 */
		canvas: "#1C211D",
		surface: "#1F2822",
		elevated: "#212E24",
		sunken: "#1B1D1B",

		/*
		 * The current row's own ground: the panel's cast at the panel's own hue,
		 * stepped 3.6 `L*` lighter (branch L of this port's selection rule), and
		 * carrying 1.57x the panel's own chroma — the shortfall the ΔE00 4.0 band
		 * needed, and nothing more. What binds this one is `ink-dim` at 5.17:1 on
		 * the row's ground. ΔE00 4.36 from `surface`, 2.02 from `elevated`, 10.08
		 * from `sunken`, 8.06 from `accentWash`; the inks on the ground are 10.5:1,
		 * 6.61:1, 5.17:1. Continuity with the panel: hue 8.25 degrees off the
		 * panel's (the assertion allows 12) and chroma 9.6 where the panel carries
		 * 6.11.
		 */
		highlight: "#203129",

		ink: "#D4E6D6",
		inkMuted: "#99BD9F",
		// The TUI `dim` verbatim: 639C70 clears 4.5:1 on all four grounds, which only
		// this ramp makes possible — it is the family's darkest set of grounds.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.35:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#72AC7F",
		// The TUI `faint` 2F5238 lifted to 2.3:1 on `elevated`.
		inkDisabled: "#3A5E43",

		// The TUI `edge` 1D3524, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds — both measured before
		// the legibility pass moved this palette's ramp, which is why the value
		// below is a step lifted from it rather than that value itself.
		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 7.14.
		 */
		hairline: "#263F2D",
		// The TUI `edge-hi` 2A4A33 lifted in L* until it clears 3:1 on `elevated`; the
		// TUI bounded nothing with it.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3:1. Lightness only, at the role's own hue.
		 */
		borderControl: "#5E8065",

		// 22E06A, the TUI's tamed phosphor — never #00FF00.
		accent: "#22E06A",
		accentHover: "#4DFA82",
		accentActive: "#00BE4B",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.5 from
		// `accent` and 11.96:1 on `surface`, where the accent measures 10.51:1.
		chartBarHover: "#87E3A8",
		tokenCommand: "#3FD0C9",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#092814",
		onAccent: "#000701",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#a08fe0`), received unchanged because it already clears
		 * every floor — ΔE00 51.57 from `accent`, 36.06 from its nearest semantic
		 * (`danger`), 5.42:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#a08fe0",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 13.39 and C* 19.83, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 29.19 from `accentWash` (the field floor is
		 * 2.0), 5.67:1 for `accentAlt` on it, and 17.44 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#241E3A",

		// 3ECF74, the TUI's own green — deliberately a second green rather than a copy
		// of the accent, which the semantic separation floor forces apart.
		success: "#3ECF74",
		successWash: "#0C2615",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.23:1.
		 */
		successBorder: "#428656",

		warning: "#D8C24A",
		warningWash: "#202510",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.23:1.
		 */
		warningBorder: "#817A3F",

		danger: "#FF6B5E",
		dangerWash: "#261912",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.23:1.
		 */
		dangerBorder: "#AB665B",

		// 3FD0C9, the TUI's `signal`, desaturated to sit in the rain rather than
		// beside it.
		info: "#3FD0C9",
		infoWash: "#0D2620",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.21:1.
		 */
		infoBorder: "#40837B",

		overlayShadow: "0 12px 32px -12px rgb(2 5 3 / 0.75)",
		scrim: "rgb(2 5 3 / 0.65)",
	},
};
