import type { ThemeDefinition } from "../palette-contract";

/**
 * Tron.
 *
 * The Grid. The one theme here whose accent is a bright electric cyan and
 * whose DANGER is orange — the franchise's own error colour, the Rinzler suit
 * — with the warning shifted to gold so the two warm states cannot collapse.
 * That orange is what keeps it apart from the shipped Neon theme, which is
 * also cyan on a blue-black: Neon's danger is pink and its ink ramp is near-
 * neutral, while this canvas is colder and deeper and the accent is ΔE00 8.9
 * from Neon's. Success is a sea-glass teal-green cool enough to belong on the
 * Grid.
 *
 * Carried from the TUI's `tron` ThemeSpec: `bg`, `surface`, `raised`, `fg`,
 * `muted`, `dim`, `accent`, `success`, `warning`, `danger`, `signal`, `edge` and
 * `edge-hi`; only `sunken` moved, below.
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
export const tron: ThemeDefinition = {
	id: "tron",
	name: "Tron",
	description: "Electric cyan circuitry on the Grid's blue-black.",
	palette: {
		mode: "dark",

		/*
		 * The legibility pass re-solves this palette's ramp, and this is the block it
		 * touches. A dark page ground is floored at L* 12 here, because below that
		 * the ladder above it and the three ink weights stop fitting above each
		 * other without one of them breaking its own floor.
		 *
		 * The three grounds around the canvas are authored as L* offsets from it
		 * (surface +3.29, elevated +7.94, sunken -2.37 L*), so the hierarchy the THE `elevated` OFFSET ABOVE IS THE LIFT'S AUTHORING INPUT, NOT THE SHIPPED RUNG, since the row/hover pass: the ground was moved down to the ladder's floor so the current row can outrank a hovered neighbour, and the measured line below carries the `L*` this file ships.
		 * hover states and the borders depend on survives the move. Measured:
		 * canvas #060B12 -> #1D2025 (L* 2.91 -> 12.14)
		 * surface #0C1420 -> #1F2734 (L* 6.17 -> 15.44)
		 * elevated #131E2D -> #232D3D (L* 10.97 -> 18.24)
		 * sunken #000207 -> #1A1B1E (L* 0.53 -> 9.78)
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
		canvas: "#1D2025",
		surface: "#1F2734",
		elevated: "#232D3D",
		// The TUI's 03060B darkened one step to clear the four-ground separation
		// floor: against `canvas` it measured 1.029:1, under the contract's 1.03. The
		// cast is unchanged, so the Grid still reads blue-black.
		sunken: "#1A1B1E",

		/*
		 * ROW STATES, and `highlight` retired in the same change. Both roles are a
		 * step of THIS palette's own panel at the panel's own hue; they used to be
		 * tints of `accent`, whose hue is more than 45 degrees off the panel on 25 of
		 * the 59 themes - the off-colour the operator reported. The rule, and why the
		 * fill now carries the ranking the 2px `accent` bar used to, are in the two
		 * roles' doc in `palette-contract.ts`.
		 *
		 * rowHover    #282D35  panel hue, C* 5.86,
		 *                       the rule's 0.60 x the panel's 9.59; +2.86 L*,
		 *                       ΔE00 3.41 off `surface`, `inkDim` 5.29:1.
		 * rowSelected #243043  panel hue, C* 13.53,
		 *                       the panel's cast + 4.0, floored at 5.0; +4.18 L*,
		 *                       ΔE00 3.83 off `surface` and 5.47 off
		 *                       `rowHover`; the pair ranks 1.32 `L*` and 7.7 `C*`,
		 *                       `inkDim` 5.08:1.
		 */
		rowHover: "#282D35",
		rowSelected: "#243043",

		ink: "#D8E6F2",
		/*
		 * Legibility pass: `inkMuted` is re-seated on the lifted grounds, where its floor
		 * is 5.5:1 on all six grounds and `elevated` binds it at 7.20:1.
		 *
		 * The contract's ΔE00 8 step from `inkDim` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkMuted: "#A5BED2",
		// The TUI `dim` 6A89A3 lifted by ΔE00 0.4 only — it missed 4.5:1 on `elevated`
		// by four hundredths.
		/*
		 * Legibility pass: `inkDim` is re-seated on the lifted grounds, where its floor
		 * is 5:1 on all six grounds and `elevated` binds it at 5.30:1.
		 *
		 * The contract's ΔE00 8 step to `inkMuted` is what set this
		 * value as much as the floor did.
		 *
		 * LIGHTNESS ONLY, at the role's own `a` and `b`: the value keeps the theme's
		 * hue and chroma class, and chroma is scaled only where sRGB forces it.
		 */
		inkDim: "#83A4BE",
		// The TUI `faint` 33485C lifted to 2.3:1 on `elevated`.
		inkDisabled: "#44596D",

		// The TUI `edge` 1E3245, already inside the hairline's 1.15-2.0:1 band and
		// clear of its ΔE00 4.0 floor on all four grounds — both measured before
		// the legibility pass moved this palette's ramp, which is why the value
		// below is a step lifted from it rather than that value itself.
		/*
		 * Legibility pass: a hairline is the one role that has to move when its grounds
		 * do. It keeps ΔE00 4.0 against every ground and its ratio inside the
		 * 1.15-2.0:1 band, because a separator that shouted would be a border.
		 * `elevated` is the tightest ground at ΔE00 5.69.
		 */
		hairline: "#283C4F",
		// The TUI `edge-hi` 2A4660 lifted in L* until it clears 3:1 on `elevated`.
		/*
		 * Legibility pass: `borderControl` is the sole boundary of every input in the
		 * app, so it keeps its 3:1 floor on all four grounds and moves with them - it
		 * is the lower of the two bounds on how far the ramp could lift. `elevated`
		 * binds it at 3.02:1. Lightness only, at the role's own hue.
		 */
		borderControl: "#617C98",

		accent: "#00D8FF",
		accentHover: "#48F2FF",
		accentActive: "#00B7DD",
		// A step AWAY from the plot ground: mixed toward `ink` to ΔE00 10.6 from
		// `accent` and 13.17:1 on `surface`, where the accent measures 10.79:1.
		chartBarHover: "#A8E3F5",
		tokenCommand: "#7AB8FF",
		// The palette's own `info`, which is the role this composer's command
		// word already resolved to: the tint moves no pixel the palette did not
		// already choose. The role and its floors are in `palette-contract.ts`.
		accentWash: "#052631",
		onAccent: "#00050D",
		/*
		 * The theme's own second hue, and the port had dropped it: the TUI's
		 * `label` token (`#a496ff`), received unchanged because it already clears
		 * every floor — ΔE00 33.14 from `accent`, 45.10 from its nearest semantic
		 * (`success`), 6.00:1 as text on the tightest ground (`surface`).
		 */
		accentAlt: "#a496ff",
		/*
		 * `accentAlt`'s faintest tint, mirroring the treatment the wash above
		 * receives: `accentWash`'s own L* 13.47 and C* 12.79, with the hue moved to
		 * `accentAlt`'s. Measured: ΔE00 16.70 from `accentWash` (the field floor is
		 * 2.0), 6.33:1 for `accentAlt` on it, and 7.56 from the nearest ground it
		 * is painted on.
		 */
		accentAltWash: "#232032",

		success: "#3FE0B0",
		successWash: "#0D2727",
		/*
		 * Legibility pass: `successBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.21:1.
		 */
		successBorder: "#3D8673",

		// E8C14A, the TUI's gold: with an orange danger, a second warm state can only
		// be distinguished by hue, and gold clears the 15 ΔE00 semantic separation.
		warning: "#E8C14A",
		warningWash: "#232319",
		/*
		 * Legibility pass: `warningBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.18:1.
		 */
		warningBorder: "#887844",

		// FF7A2F — orange, not red. The Grid's own error colour, and the reason this
		// theme does not need a red at all.
		danger: "#FF7A2F",
		dangerWash: "#261916",
		/*
		 * Legibility pass: `dangerBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.20:1.
		 */
		dangerBorder: "#A96A49",

		// 7AB8FF, the TUI's `signal` — the Grid's day-cycle blue, distinct from the
		// cyan accent by hue rather than by lightness.
		info: "#7AB8FF",
		infoWash: "#152131",
		/*
		 * Legibility pass: `infoBorder` is the edge of a semantic callout, so it keeps the
		 * structural 3:1 floor on all four grounds - the pair that used to be covered
		 * only by a pin in the contract. `elevated` binds it at 3.19:1.
		 */
		infoBorder: "#5E7BA1",

		overlayShadow: "0 12px 32px -12px rgb(2 4 7 / 0.75)",
		scrim: "rgb(2 4 7 / 0.65)",
	},
};
