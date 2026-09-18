/**
 * The palette role contract.
 *
 * Every theme in this app supplies one `ThemePalette` and nothing else. All
 * non-colour decisions — type scale, spacing, radii, motion, component
 * anatomy — live once in `createBaseTheme` and in the Tailwind `@theme` block,
 * never in a theme file.
 *
 * ## Why this exists
 *
 * Before this contract, every theme was a standalone `createTheme()` of
 * 209–252 lines, and only ~33% of those lines were colour. The other ~67% —
 * breakpoints, typography, and the `MuiAppBar` / `MuiListItemButton` /
 * `MuiIconButton` / `MuiButton` / `MuiCard` / `MuiContainer` overrides — was
 * copied into every one of them. A type-scale change was a diff across every
 * theme file, and the last file is the one that gets missed.
 *
 * Worse, eleven of the twelve themes that existed then never authored
 * `divider`, `action`, `success`, `warning`, `info`, `grey` or `common` at
 * all, while application code reads those 409 times. Those values were coming
 * from MUI's stock palette — a blue `info` and a red `error` that appeared in
 * no theme file and that no theme author had ever seen, let alone checked for
 * contrast. Making the roles mandatory here is what closes that hole: a
 * palette that omits one no longer compiles.
 *
 * ## Roles, not hexes
 *
 * The app cannot adopt the brand palette wholesale, because users pick their
 * own theme and a "Dracula" theme is a promise to a user. Overriding community
 * palettes with brand green would break exactly the users who chose them. So
 * the brand system ports as *roles with contrast floors* rather than as
 * values: `docs/branding.md` § 3 owns the floors, and
 * `scripts/contrast-contract.mjs` fails the build on a palette that cannot be
 * read.
 *
 * @see docs/branding.md — the human-readable version of this contract
 * @see scripts/contrast-contract.mjs — the executable version
 */

/*
 * The role set, and the one place it has two of something.
 *
 * 33 roles today, and exactly one of them is a second hue: `accentAlt` /
 * `accentAltWash` sit beside `accent` / `accentWash` as the theme's decorative
 * pair, while every STATE role — hover, selection, checked, focus, in-flight —
 * stays on the primary accent. The split is deliberate and is what `docs/
 * branding.md` § 2's may/may-not list exists to hold: an app with two accents has
 * two vocabularies unless one of them is barred from saying anything. Read the
 * `accentAlt` doc below before spending either.
 */

/*
 * Type-only, so `themes/palette-contract.ts` and `types/theme.ts` still share
 * no runtime code: the registry is built from the palette directory, and the
 * union this file is checked against is erased at compile time.
 */
import type { ThemeName } from "../types/theme";

/**
 * A theme's complete colour surface.
 *
 * Grouped by role rather than by MUI key, because the MUI mapping is an
 * implementation detail of `createBaseTheme` and the Tailwind mapping is an
 * implementation detail of `theme.css`. Both read from here.
 */
export type ThemePalette = {
	/** Drives MUI's `palette.mode` and the `dark` class Tailwind keys off. */
	mode: "light" | "dark";

	/* ---- grounds: four steps, distinguishable without a shadow ---------- */

	/**
	 * The page ground. The furthest-back surface in the app.
	 *
	 * Elevation in this system is a lightness step, not a shadow — see
	 * `docs/branding.md` § 5. These four values must be visually distinct from
	 * each other, because they are the only elevation signal available.
	 *
	 * ## The legibility floors, which bind all four grounds
	 *
	 * A page ground is not a taste call. It is the surface the transcript is read
	 * on for hours, so it is FLOORED at **L\* 12 in a dark theme** - one rung above
	 * GitHub Dark's `#0D1117` (L\* 4.95) and exactly VS Code Dark+'s `#1E1E1E`, and
	 * deliberately above GitHub's default - and **CAPPED at L\* 94 in a light one**,
	 * because `elevated` at L\* 100 is the end of sRGB's ramp and the minimum
	 * canvas-to-elevated spread is 2.5 + 2.5 L\*. The top of the ladder is capped at
	 * **`elevated` L\* 30** (a dark theme's `canvas` also has a hard ceiling of
	 * L\* 22, past which it stops being off-black), because at `elevated` L\* 34 an
	 * `inkDim` at its floor needs L\* 85 and the ink/hover distinction disappears
	 * into the top of the ramp.
	 *
	 * The four grounds are then authored as L\* OFFSETS FROM THE CANVAS, and both
	 * ends of each step are asserted:
	 *
	 * | step | band |
	 * |---|---|
	 * | `canvas` -> `surface` | +2.5 to +5.0 L\* |
	 * | `surface` -> `elevated` | +2.5 to +6.0 L\* |
	 * | `canvas` -> `sunken` (down) | 1.5 to 6.0 L\* |
	 *
	 * with every adjacent pair at **ΔE00 >= 2.0 AND ratio >= 1.03:1** (the first is
	 * `docs/branding.md` § 3's observed threshold at which two grounds read as two
	 * grounds; the second is the older gate floor, which a 1px line needs but a
	 * field does not).
	 *
	 * ## Lifting a ramp moves LIGHTNESS ONLY
	 *
	 * A ground is re-solved by holding its own `a` and `b` at a new `L*`, so the
	 * theme's hue and chroma class are exactly what they were and chroma is scaled
	 * only where sRGB forces it. Lifting a near-black palette therefore changes how
	 * BLACK it is, not what colour it is, and that is the whole point: a user who
	 * chose `obsidian` for monochrome zinc still gets monochrome zinc. The cost is
	 * recorded rather than argued away - the four palettes whose upstream identity
	 * IS near-black (`obsidian`, `tron`, `matrix`, `dune`) lose the black, and keep
	 * the hue, the chroma class and the relative ladder.
	 *
	 * The grounds do not move alone. Raising a dark ground raises the luminance
	 * every ink is measured against, so an ink that cleared its floor before the
	 * lift can fail it after: `localOperatorDark`'s `inkDim` measures 4.61:1 on
	 * `elevated` as shipped, 3.86:1 on that same ink once the ground rises, and
	 * 5.02:1 only because the ink is re-authored with it - and `borderControl`, the
	 * sole boundary of every input, fails 3:1 on a lifted `elevated` in eight
	 * palettes. The grounds, the ink weights and `borderControl` therefore land in
	 * the same commit or not at all, which is a rule about this system rather than
	 * about one palette.
	 *
	 * ## The measured ceiling on any further band move (2026-09-18)
	 *
	 * The "some themes feel a lot more grey now" report is real and it is
	 * measured: the pass above solved 23 palettes onto the same L* 12 floor, so
	 * 9.47 L* of authored depth came to occupy 0.46 L*, and the dark fleet's
	 * `canvas` spread fell from 19.5 to 10.0 L*. The rule for undoing it - the
	 * four depth registers, cast spent rather than withdrawn - was solved in full
	 * and then WITHDRAWN, because this fleet cannot pay for it. The numbers, so
	 * the next pass starts from them rather than rediscovering them:
	 *
	 * - **The band's own headroom is 0 to +2.94 L*, and +0 on seven palettes.**
	 *   Past that, one of the roles this file already asserts goes under its floor
	 *   - `infoBorder`/`dangerBorder`/`warningBorder`/`accent` at 3:1 on
	 *   `elevated`, `success`/`danger`/`info`/`accent` at 4.5:1 as text, `inkDim`
	 *   at 5:1. Each sits 0.01-0.06:1 above its own floor today, so the fleet is
	 *   at the ceiling that §1.3's registers (L* 14.5-18.4) are above.
	 * - **The row window caps it lower still, and that is the binding one.** The
	 *   row states live between `surface` and the ink cap, and the ladder's
	 *   `surface -> elevated` step is only 2-3 L*; once `surface` passes ~L* 13
	 *   the selection cannot reach ΔE00 6.0 off it inside the cap. Respecting
	 *   both, the movers have 0.09-0.20 L* to spend - i.e. nothing.
	 * - **The fleet is at its edge on every axis.** The lowest `canvas -> surface`
	 *   ΔE00 is 2.08 against a 2.0 floor, the lowest `canvas -> sunken` is 2.02
	 *   against 2.0, and the lowest `canvas` L* is 12.00 against the band's 12.0,
	 *   so a cast change alone (`catppuccinMacchiato`, `rosePine`,
	 *   `rosePineMoon`, `obsidian`, `autumn`, `vaporwave`) breaks a step floor.
	 *   "Cast is spent, never withdrawn" is available in principle and not in
	 *   this fleet's state.
	 * - **The un-taken route, named so it is a decision and not an oversight:**
	 *   authorizing the four semantic tones and the four `*Border` roles to move
	 *   WITH the band is the only way to the registers, and it re-authors what
	 *   green, red and amber mean on ~16 palettes. It is one approval away and it
	 *   is deliberately not taken here.
	 *
	 * What this leaves is a fleet that is legible, spread where spread is free,
	 * and honest about the axis it can no longer buy.
	 */
	canvas: string;
	/** One step raised: cards, panels, inputs, the message paper. */
	surface: string;
	/** Two steps raised: menus, popovers, tooltips, hovered rows. */
	elevated: string;
	/**
	 * One step recessed: wells, tracks, code grounds, footers.
	 *
	 * ## Its second job: the active row of a dialog's list
	 *
	 * `sunken` is also the ground a SELECTION takes inside a popup, where the
	 * dialog's own `bg-elevated` is what the row would otherwise be painted on.
	 * `picker-host.tsx` established it for the keyboard's row and the command
	 * palette's active row takes it for the same reason: it is the one ground that
	 * steps perceptibly away from `elevated` in every palette (measured ΔE00
	 * 6.07-16.18 across all fifty-nine), where the accent wash collapses onto the
	 * dialog ground (`obsidian` ΔE00 0.77) and reads 1.00-1.24:1.
	 *
	 * A selection therefore takes this ground AND a non-colour mark beside it -
	 * `outline-control` on the row, or the 2px accent bar the slash popup uses -
	 * because in nineteen of the fifty-nine palettes the accent's hue is more than
	 * 45 degrees off the panel it tints, so a tint can never be the state's only
	 * signal. `accentWash` is a hover and callout tint and not a selection ground;
	 * see its own doc below for the floor it carries instead.
	 */
	sunken: string;
	/**
	 * The row the POINTER is on. A STATE of a list row, not a ground.
	 *
	 * ## The state/ground boundary, which is why this role exists at all
	 *
	 * `row*` roles are painted ONLY on an element that is one of a set of sibling
	 * rows in a list or rail - it carries the row's own text and has a selected
	 * counterpart in the same list - and never on a container's own background.
	 * The grounds (`canvas`, `surface`, `elevated`, `sunken`) may not be used as a
	 * row's hover or selection, and a `hover:`/`active:` variant on a control
	 * primitive (button, chip, icon button) is that primitive's state and keeps its
	 * own role. Before this pair, one word did both jobs: 47 sites read
	 * `hover:bg-elevated` as a STATE while 57 files read `bg-elevated` as a GROUND.
	 *
	 * ## WHY IT IS NOT `elevated`, and why the retired role was on the wrong axis
	 *
	 * `elevated` is a ground - dialogs, sheets, popovers, menus, footers, tooltips
	 * and the ladder's own rung read it - so it cannot be raised to meet a hover;
	 * and on the dark family it needs no raising, because it is already at its
	 * ceiling. A hue-faithful raised fill cannot rise past `inkDim` at its floor
	 * plus this file's headroom, which is worth ΔE00 1.49-4.54 across the 41 dark
	 * palettes, while the app's own hover floor is ΔE00 2.0: the two states
	 * therefore had a legal window of 0.53 ΔE00 on the median dark palette and a
	 * CLOSED one on 19 of 41. That is the shape of the operator's twice-reported
	 * "whisper", and no pair of values in that role could fix it.
	 *
	 * The retired `highlight` was the panel's OWN cast, one step off `surface`. On
	 * the dark family it measured 4.01-6.05 ΔE00 off the panel with a separation of
	 * 2.02-5.35 from the hovered rung - and on `neon` the two marks sat 1.80 ΔE
	 * apart while each was ~6.2 ΔE off the panel, so the reader saw *a* state and
	 * could not see *which*. Hue is the one axis the lightness budget does not
	 * consume: at a 1.5 `L*` step the panel's own hue and chroma buys ΔE00 0.92-1.08
	 * and the panel's + 4 chroma still only reaches the floor on 1 of 41, whereas
	 * the accent's hue at C* 4 reaches it on 35 of 41.
	 *
	 * ## THE HUE IS THE PALETTE'S OWN `accent`
	 *
	 * The hue the theme already spends on its primary action, its links and its
	 * focus ring - so the mark cannot become a colour the theme does not have. It
	 * must sit within **12 degrees** of `accent` (or, where the accent is greyscale
	 * - `obsidian` alone, `#FAFAFA` at C* 0 - of the panel's own hue). An earlier
	 * round shipped rows rotated 155-160 degrees off the panel and the operator
	 * reported the cast as wrong.
	 *
	 * ## THE RULE
	 *
	 * Take the `accent`'s hue; a whisper of strength - the SMALLEST chroma at or
	 * above C* 4 that reaches ΔE00 **4.0** off `surface`, at an `L*` step of
	 * **1.5** in the mode's raised direction (lighter on a dark palette, darker on
	 * a light one) - and bound the chroma above at min(0.6 x C*(accent), 24). The
	 * value is authored as the hex the triple resolves to, with its measurement
	 * beside it, never computed at runtime and never derived from a mix percentage.
	 *
	 * Chroma is NOT a fixed quantity: it is the smallest that clears the floor,
	 * and on the 54 palettes that hold this rule it lands at C* 4-12.4. The
	 * chroma is a TINT, never a fill, and the ceiling is what keeps a state from
	 * growing into a saturated plane beside the panel - the 3.60x over-cast an
	 * earlier port shipped.
	 *
	 * ## FLOORS, and what is not one
	 *
	 * Asserted: the ΔE00 band above; an `L*` floor of 1.5 in the raised direction;
	 * the hue bound; the chroma ceiling; and the three ink weights at their own
	 * floors on the fill (`ink` 7.0:1, `inkMuted` 5.5:1, `inkDim` 5.0:1 - the caps
	 * and the `· lopdev` binding INSIDE a row are drawn in `inkDim`, which is the
	 * binder). NOT asserted: any luminance ratio between the fill and its panel.
	 * WCAG contrast is luminance-only, and the default palette once passed a
	 * ΔE00 7.14 band while reading **1.003:1** "because the entire difference was
	 * hue" - the axis this design deliberately spends.
	 */
	rowHover: string;

	/**
	 * The row the READER is on. The same accent hue as `rowHover`, one strength
	 * louder, plus a NON-COLOUR mark: the leading-edge bar below.
	 *
	 * ## THE SHAPE
	 *
	 * The smallest chroma at or above C* 8 that clears ΔE00 **6.0** off `surface`
	 * AND ΔE00 **6.0** off `rowHover`, at the largest `L*` step in [3.0, 5.0] that
	 * holds at that chroma, and at least 0.5 `L*` beyond the hover's on the same
	 * raised side. Its chroma ceiling is min(0.75 x C*(accent), 24).
	 *
	 * The separation is a floor in its own right, and it is the half the operator's
	 * second report is about: a reader who sees two marks and cannot rank them has
	 * not been given a state. On the light family - the one he accepted - the
	 * separation ran 5.59-8.44 ΔE00, so the 6.0 floor sits just under behaviour he
	 * has already approved.
	 *
	 * ## THE BAR IS THE SECOND SIGNAL, and it is not decoration
	 *
	 * Both fills are one hue at two strengths, so their last increment of
	 * legibility is a non-colour one:
	 *
	 *     before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent
	 *
	 * a 2px `accent` bar on the row's leading edge, drawn with a `before:`
	 * pseudo-element so it costs no layout and cannot shift the label, plus the
	 * `font-medium` the row already carried. `accent` measures 4.5-11.8:1 against
	 * its own selected ground across all 59, so the 3:1 non-text floor holds
	 * everywhere. The same idiom and the same argument are already in
	 * `at-picker.tsx` and `slash-commands.tsx`, where the popup's active row takes
	 * the bar precisely because "the row Enter will apply was carried by hue
	 * alone". The sidebar was the only selection in the app without one.
	 *
	 * The row must ALSO restate `hover:bg-row-selected` on the selected element:
	 * a `hover:` variant outranks a bare background in the cascade, so without it
	 * the pointer repaints the selected row as the hover - one state painted as
	 * the other.
	 *
	 * ## WHAT IT MAY NOT BECOME
	 *
	 * A `sunken` well (a selection is not a hole), a ring or a four-sided border
	 * (retired by design round 1 - it rendered as the search field above the list,
	 * and `outline-control` is the sole boundary of a control), or an `accentAlt`
	 * tint (a state stays on the primary accent; `docs/branding.md` section 2).
	 *
	 * ## THE NAMED EXCEPTIONS
	 *
	 * Five palettes cannot hold this set inside the ceiling and are recorded, with
	 * their measured ceiling and the ink that binds them, in `ROW_STATE_PINS` in
	 * `scripts/contrast-contract.mjs` rather than being granted a wider bound:
	 * `nightfox`, `tokyoNightStorm`, `ayuLight` and `rosePineDawn` (the search runs
	 * out of chroma before the separation is reached) and `obsidian` (a greyscale
	 * accent, so it takes the panel's own cast at the ink cap plus the near-white
	 * bar). A floor is never widened to fit a palette: a row the reader cannot find
	 * is the defect this pair exists to answer, and the ledger is what keeps the
	 * failure visible.
	 */
	rowSelected: string;

	/* ---- ink: four weights, each with a floor --------------------------- */

	/**
	 * Primary text. Floor: **7:1 on the seven grounds, and 8:1 on `canvas`**.
	 *
	 * The seven are the four elevation steps plus the three grounds that carry
	 * text as a STATE: `accentWash` (the hover/selection tint, chips, callouts,
	 * find-match), `rowHover` and `rowSelected` (the two states of a list row).
	 * The three state grounds were not measured before the pass that added them,
	 * which is how a keycap on a selected row and a reading button on a hover
	 * could fail with every gate green. `canvas` takes the extra 1:1 because it is the transcript - the one
	 * surface in this app read for hours at arm's length.
	 */
	ink: string;
	/** Secondary text. Floor: **5.5:1 on all six grounds** — SC 1.4.3 asks 4.5, and
	 * this weight is used at 11-13px, where 4.5:1 is not 4.5:1 at 14px. */
	inkMuted: string;
	/** Tertiary text — captions, metadata, placeholders. Floor: **5.0:1** on all
	 * six grounds, for the same reason as `inkMuted` and one step behind it. */
	inkDim: string;
	/**
	 * Inactive control text. The single exemption from the contrast floors,
	 * because a disabled control that meets 4.5:1 does not read as disabled.
	 *
	 * Disabled state changes *colour*, never opacity: an opacity-faded control
	 * fades its own background too, so it lands on a different colour over
	 * `surface` than over `sunken`.
	 *
	 * ## The one ceiling in the system
	 *
	 * It has no floor, and it does have a **ceiling: `ratio(inkDisabled, g) <= 0.8
	 * x ratio(inkDim, g)` on every ground**. That relation is what keeps the state
	 * legible AS a state, and it is asserted rather than assumed: making `inkDim`
	 * lighter threatens the disabled state from below, and both inks sit on the
	 * same side of every ground, so the ceiling reduces to a fact about the two
	 * inks and moves only when the pair itself collapses.
	 */
	inkDisabled: string;

	/**
	 * ## The ink ladder, in one place
	 *
	 * The three weights are a hierarchy, not three independent floors: three inks
	 * each at their floor can be the same colour. So each step is asserted too -
	 * `deltaE(inkMuted, inkDim) >= 8` (the contract's comment-versus-code floor,
	 * which a live chip beside an inert reading has to beat) and
	 * `deltaE(ink, inkMuted) >= 2.0`.
	 *
	 * Only `inkDim` was ever the flag: it bottoms out on the lighter grounds, and
	 * raising it is what collapses the step, so the step is paid on LIGHTNESS -
	 * `inkMuted` rises with it rather than letting the pair converge. This is why
	 * the five palettes that used to pin that step (`tokyoNight`, `obsidian`,
	 * `iceberg`, `neon`, `localOperatorLight`) carry no pin any more.
	 */

	/* ---- lines: the decorative/structural split ------------------------- */

	/**
	 * Decorative 1px rule — section dividers, table rules, list separators.
	 * Carries no information, so it has no contrast floor.
	 */
	hairline: string;
	/**
	 * Structural 1px boundary — the sole visual boundary of an input, select,
	 * checkbox or outlined button. Floor: 3:1 on all four grounds.
	 *
	 * This is the role most likely to be missing from an existing palette,
	 * because most palettes have exactly one border colour and use it for
	 * both jobs. Adding a second, legally distinct border value was the single
	 * highest-return accessibility change in this port: the previous light
	 * theme bounded every input at 1.25:1.
	 *
	 * It is also the LOWER of the two bounds on how far a dark ramp can rise. A
	 * lifted `elevated` costs the edge contrast, so this role moves WITH the
	 * grounds in the same commit: left where it stood, it fails 3:1 on the lifted
	 * `elevated` in eight palettes (the worst is `obsidian` at 2.49:1), and the
	 * same is true of each semantic's own `*Border` role on the same ground.
	 */
	borderControl: string;

	/* ---- accent: two hues, and only one of them is spent by a control ----
	 *
	 * `accent` is the app's INTERACTION hue — the primary button, the focus ring,
	 * each checked control, the selection and hover ground, links, the agent's
	 * question. `accentAlt` is the theme's IDENTITY AND CATEGORY hue, spent at two
	 * decorative sites and barred from every state role; the split is the whole
	 * point of the pair, and `docs/branding.md` § 2 owns the may/may-not list.
	 */

	/**
	 * Primary action, active state, focus ring. Floor: **4.5:1 as text on all six
	 * grounds**, and **3:1 as a ring on all four** — the focus ring is
	 * `outline: 2px solid var(--color-accent)`, so SC 1.4.11 applies to it as a
	 * non-text graphic as well as SC 1.4.3 to its type.
	 *
	 * The ground list is what makes the accent a legibility role and not only a
	 * brand one: it is a link colour, a dialog's affordance and a chart mark's
	 * sibling, so it is measured on `elevated`, `accentWash` and both row states too,
	 * not just the three grounds that happen to carry the page's own text.
	 *
	 * It is also the ONLY hue any interaction may spend. Everything below that
	 * reads as a state — hover, selection, checked, focus, in-flight — stays on
	 * this role and its ramp, and `accentAlt` is barred from all of it.
	 */
	accent: string;
	accentHover: string;
	accentActive: string;
	/**
	 * The faintest accent tint: hover fills, callout grounds, chips, find-match.
	 *
	 * ## A HOVER TINT, NOT A SELECTION GROUND
	 *
	 * This role is the app's pointer feedback and its callout wash, and it is
	 * deliberately no longer what an active ROW is painted with. A selection is a
	 * state the reader has to find while scanning a list, and a tint of the accent
	 * cannot carry that: on the dialog's own `elevated` it measures ΔE00 0.77 in
	 * `obsidian` and 1.51 in `catppuccinMocha`, at a luminance ratio of
	 * 1.00-1.24:1, so no contrast assertion in the system can see the failure - and
	 * on the default palette the operator's own screenshot PASSED the separation
	 * band at ΔE00 7.14 while reading 1.003:1, because the entire difference was
	 * hue. A selected row therefore takes a step of its own (`sunken` inside a
	 * dialog, `rowSelected` on a panel) plus a non-colour mark.
	 *
	 * What it does carry is its own floor: **ΔE00 >= 2.0 against every ground it is
	 * painted on**. It fails that in eleven palettes at the scope this pass
	 * measured (`catppuccinMacchiato` 0.80 on `surface`, `obsidian` 0.77 on
	 * `elevated`, `tokyoNightDay` 1.13 on `sunken`), so those washes were
	 * re-authored on lightness at their own hue rather than the floor being set
	 * where the existing values happened to sit.
	 */
	accentWash: string;
	/** Ink that sits on the accent fill. Floor: 4.5:1 on `accent`. */
	onAccent: string;
	/**
	 * The theme's SECOND decorative hue: identity and category, never interaction.
	 *
	 * ## Why the role exists
	 *
	 * A theme with two signature colours could not show the second one anywhere.
	 * The picker's miniature drew one accent, and the app's one categorical ramp
	 * (mermaid's `fillType0..7`) started on the SEMANTIC washes, so a diagram's
	 * second category was painted the colour that everywhere else means "here is a
	 * fact" (`mermaid-diagram.tsx` says so in its own comment). This is the hue
	 * that was missing. It is spent at exactly two sites — the picker's miniature
	 * and mermaid's categorical fills — and the may-not list below is what keeps
	 * it from growing into a second control accent.
	 *
	 * ## Where the value comes from: the token the port dropped
	 *
	 * These palettes are ports of the TUI's `ThemeSpec`, whose token set names
	 * three non-neutral hues per theme: `accent`, `signal` (which the port mapped
	 * to `info`) and `label` — the "violet meta" hue — which the port had **no
	 * role for and dropped**. `accentAlt` is that `label` hue. For 52 of the 59
	 * palettes it is therefore the scheme's own second colour, already authored and
	 * canonical upstream (kanagawa's oniViolet, everforest's purple, ayuDark's
	 * keyword orange); 24 of those clear every floor as received, and the other 28
	 * are moved ONTO them, with the measurement in the palette file. The remaining
	 * seven (`dune`, `iceberg`, `localOperatorDark`, `localOperatorLight`, `neon`,
	 * `obsidian`, `synth`) are the desktop-only membership with no TUI `label` at
	 * all, so theirs is a ROTATION of `accent`: the accent's own `L*`, the hue
	 * moved to the first Δh in the fixed order 150°, 160°, 170° … 500° whose
	 * chroma, walked down from `max(C*(accent), 40)` to 15 in steps of 5, clears
	 * every floor. `obsidian` is the one palette that gains a hue it never had —
	 * its accent is a greyscale `#FAFAFA` at C* 0 — and it resolves at Δh 310°.
	 *
	 * ## How a value that fails is moved, and on which axis
	 *
	 * The shortfall is paid on the axis that carries it: a TEXT floor is paid on
	 * **lightness** at the source hue — the idiom this port already applies to its
	 * own tokens ("canonical mauve `8839EF` is 4.09:1 on `sunken`, deepened along
	 * the same violet") — and a collision with `accent`, a semantic or `info` is
	 * paid on **hue**, because a value that bought ΔE00 by darkening would be the
	 * same hue at another weight rather than a second hue. 14 palettes are moved
	 * on lightness and 14 on hue. Both values are AUTHORED, never computed at
	 * runtime, exactly as the semantics are: `pnpm check-themes` has to be able to
	 * measure them.
	 *
	 * ## What it must clear — `scripts/contrast-contract.mjs` asserts all of it
	 *
	 * - **4.5:1 as text on `canvas`, `surface` and `sunken`** (`FLOOR.text`).
	 *   Only the three grounds: this hue is not painted inside a dialog or on a
	 *   state ground by either of its two sites.
	 * - **ΔE00 >= 15 from `accent`** (`SEPARATION_FLOOR`). The two are compared at
	 *   the sizes this one is drawn at — a 1px bar in a 40px miniature, a 6px mark
	 *   in a diagram — so the number that applies is the contract's own "difference
	 *   of category, not of shade", which is argued for recall rather than for
	 *   side-by-side comparison.
	 * - **ΔE00 >= 15 from `success`, `warning` and `danger`.** This is the
	 *   change's riskiest part, and the one a frame catches better than a number:
	 *   a decorative hue a reader can mistake for "something broke" costs them
	 *   something real. Four of the 52 source hues fail it as received —
	 *   `everforest`'s label is ΔE00 12.0 from its `danger`, `ayuMirage` 13.8 and
	 *   `ayuDark` 12.3 from their `warning`, `kanagawaLotus` 14.1 — and those are
	 *   moved rather than accepted, because the faithful port of a theme's own
	 *   token is not an argument against the reader's ability to tell a
	 *   decoration from a failure.
	 * - **ΔE00 >= 8 from `info`**, deliberately the lighter floor. `info` is the
	 *   cool counterweight the port mapped `signal` onto, so on the palettes whose
	 *   second hue is in that family 15 would fail BY CONSTRUCTION rather than by
	 *   defect: the tightest are `catppuccinMocha` 8.01, `catppuccinMacchiato`
	 *   8.58 and `catppuccinFrappe` 8.60 - the three whose second hue sits in
	 *   `info`'s own family (2.68, 19.42 and 17.02 degrees off it, in that order) -
	 *   then `localOperatorDark` 12.57 and `ayuLight` 13.57. 8 is the file's
	 *   "reliably take different names rather than scraping the side-by-side
	 *   threshold" floor (`SYNTAX_COMMENT_FLOOR`).
	 * - **C* >= 15.** The second accent has to be a hue and not a second grey.
	 *   Chroma is the axis a value can be drained along while every ΔE00 floor
	 *   above stays green — the same lesson the retired `highlight` taught on the
	 *   lightness axis: assert the axis, not just the distance. (Measured today: the lowest
	 *   is `radient` at C* 16.78.)
	 *
	 * There is a sixth property, asserted as a relation rather than as a floor:
	 * **the two accents must be two HUES**. Every value here sits at least 18.6° of
	 * hue from its own `accent` (tightest: `catppuccinLatte`, whose source hue sat
	 * 1.7° from its accent and had to leave that neighbourhood entirely), so no
	 * palette satisfies the 15 by darkening alone. A greyscale accent has no hue to
	 * be near, which is why `obsidian`'s rotation is judged on the floors alone.
	 *
	 * ## What may spend it — and the may-not list, which is the longer one
	 *
	 * MAY: the theme picker's miniature (`theme-selector.tsx`'s `ThemeSwatch`, a
	 * `bg-accent-alt` bar beside the `bg-accent` one) and mermaid's categorical
	 * fills (`accentAltWash` at index 1 of the wash cycle). The sibling legibility
	 * spec's identity sites — an agent/entity glyph, a provider label, a
	 * tab-strip mark — are the same kind of use and each brings its own `CONTROLS`
	 * row when it lands.
	 *
	 * MAY NOT, and the reason fits in a sentence: **interaction, selection and
	 * semantics stay on `accent`.** Every selection and hover ground, the focus
	 * ring and the caret, primary/ghost/outline buttons and chips, links, the
	 * agent's question callout, checked and indeterminate controls, progress and
	 * proportion bars, the liveness marks, charts, syntax tokens, the semantic
	 * triples and the brand mark keep the roles they have. A selection is a STATE
	 * and this app has exactly one state vocabulary: a reader looking at a
	 * selected row must never have to work out which accent means "current" —
	 * and the selection ground is the most fragile role in the tree (ΔE00 0.77
	 * against `elevated` in `obsidian`), so it must not become a function of two
	 * hues' relationship. `docs/branding.md` § 2 carries the list in full.
	 *
	 * ## The hard rule until `onAccentAlt` exists
	 *
	 * **`bg-accent-alt` may not become a text-bearing fill anywhere.** Ink on a
	 * solid `accentAlt` fill is an unmeasured pair: there is no `onAccentAlt`
	 * companion, no palette has authored a value for it and no `CONTROLS` row
	 * asserts it. Both sites above carry no text — the miniature's marks are
	 * 1px-2.5px bars, and mermaid's categorical fills keep the `ink` labels they
	 * already had — and a site that paints ink on the fill adds the role and an
	 * `ink on fill >= 4.5:1` row to `CONTROLS` in the same change.
	 */
	accentAlt: string;
	/**
	 * `accentAlt`'s faintest tint: the same relationship `accentWash` has to
	 * `accent`, carried onto the second hue.
	 *
	 * Authored per palette as the palette's own wash — its `L*` and `C*` — at
	 * `accentAlt`'s hue, with the `L*` moved only where the chip row's ink floor
	 * binds. Stating it as the wash's own lightness rather than as a mix is what
	 * keeps the two washes siblings in a ramp: the palettes that took their
	 * `accentWash` from the TUI's own selection tint (rather than from a
	 * percentage of the accent) have no mix to mirror, and a value derived from a
	 * fitted percentage would be a different tint from the one beside it.
	 *
	 * Floors, and the second is why the first is not merely aesthetic:
	 *
	 * - **ΔE00 >= 2.0 against `accentWash`** (`FIELD_SEPARATION_FLOOR`): the two
	 *   washes sit adjacent in one categorical ramp, so a step the eye cannot see
	 *   is not a step. Measured today the tightest is `rosePine` at 2.05; a palette
	 *   that cannot reach the floor on the wash axis — where near-neutral palettes
	 *   run out of chroma — is pinned in the contract's `EXCEPTIONS` with its
	 *   measured ΔE00 and a reason rather than the assertion being dropped.
	 * - **the `accent wash chip` row mirrored for this fill**: `accentAlt` as ink
	 *   on it at 4.5:1, and `accentAlt` also its border, at 3:1 against `canvas`
	 *   and `surface`. That row exists for `accentWash` because a chip is a real
	 *   component triple; the alt chip is asserted for the same reason.
	 *
	 * It is NOT a selection or hover ground, and it is not `accentAlt`'s only
	 * consumer: mermaid's ramp is the one that ships today. Like its solid
	 * sibling, it is decorative — a state role that took it would be the defect
	 * the pair exists to avoid.
	 */
	accentAltWash: string;
	/**
	 * The chart mark under the pointer.
	 *
	 * A first-class role rather than a reuse of `accentHover`, because the two
	 * answer different questions. `accentHover` is a step on the ACCENT RAMP: it
	 * is the primary button's own fill as the pointer crosses it, authored to be
	 * separable from `accent` (ΔE00 >= 2.0) with no promise about the surface
	 * behind it. That is fine for a button, whose shape and position say what it
	 * is, and wrong for a chart mark the reader has to FIND among its siblings.
	 * Obsidian is where it showed: its accent is the palette's brightest value, so
	 * its ramp can only walk downwards, and the hovered bar receded toward the
	 * ground instead of standing out (16.97:1 at rest, 13.96:1 under the pointer).
	 *
	 * Both properties below are asserted per palette by `check-themes`
	 * (`scripts/contrast-contract.mjs`, the "chart bar (hover)" block): at least
	 * ΔE00 10 from `accent`, and never closer to the plot ground than `accent` is.
	 * The 10 is the contract's own separation floor for this role, sitting between
	 * the syntax tokens' 8 and the semantics' 15 — read that block for the argument
	 * and for the names of the two constants, and re-measure before changing a value
	 * here; obsidian's window is narrow by construction, and tokyoNight's sits two
	 * thousandths above the floor.
	 */
	chartBarHover: string;

	/**
	 * The composer's STRUCTURED-TOKEN ink: the leading `/word` a user typed.
	 *
	 * Its own role rather than `info`, and the reason is measured rather than
	 * stylistic: the token sits INSIDE the draft, beside prose `ink`, and the
	 * composer already spends `accent` three times on the same screen (focus
	 * ring, send button, popup selection). Across the palettes that shipped when
	 * this role was authored, `info` is the accent's twin in three of them (dune,
	 * neon, radient read ΔE00 0.0) and `ink`'s twin in a fourth (obsidian, also
	 * 0.0), so no shipped text role could carry this run. It is the desktop's
	 * counterpart of the TUI's `$lo-signal`, whose own file states the rule
	 * ("`$lo-accent` is deliberately NOT used here … a recognized command word is
	 * structure, not activity").
	 *
	 * FLOORS (`scripts/contrast-contract.mjs`, the "command token" block): at
	 * least 4.5:1 as text on `surface` and on `elevated`; at least ΔE00 8 from
	 * `ink`, from `accent` and from `success` — the three inks this run is read
	 * against in one line of the composer. obsidian is the single pinned
	 * exception, and it is the app's recorded monochrome case: its `info` IS its
	 * `ink`, so `code-mirror-theme.ts` already separates tokens by WEIGHT there
	 * and `tokenCommand` is bound to `ink` with the composer's own painted weight
	 * step carrying the run (`slash-run-bold` — a text stroke, which thickens the
	 * glyph without moving its advance; a real `font-weight` here moved the
	 * MIRROR's wrap points off the textarea's and hid the tail of the draft behind
	 * the mirror's overflow, QA round 1 Q1). Its width is ONE constant, `0.5px`, at
	 * every raster: a raster-query floor was tried in round 2 (D6, on a proxy
	 * measurement that a real 1x build falsified — the 0.5px stroke paints at half
	 * strength there, not nothing) and withdrawn in round 3, because below 2dppx it
	 * doubled the run's stem against prose's 1 device pixel and closed this row's
	 * counters (D8). So this row's separation is the stroke as it has always been,
	 * at every display.
	 *
	 * The TUI port's palettes author it as their own `info` where that value
	 * clears the floors, which is most of them; the five that missed by a hair
	 * record a lift of that signal and its measured cost in the palette file.
	 * Re-measure before changing a value here.
	 */
	tokenCommand: string;

	/* ---- semantic: each with a wash and a border ------------------------ */

	/**
	 * Semantic triples. All three parts are required rather than derived,
	 * because deriving them is what makes MUI's `augmentColor` invent an
	 * Alert's appearance from a single hex — twelve times, differently.
	 *
	 * Both floors are stated once here and apply to all four roles: the tone is
	 * **4.5:1 as text on all six grounds** (it labels a callout, a status row and a
	 * syntax token), and its `*Border` is **3:1 on all four** (it is the callout's
	 * edge). `elevated`, `accentWash` and the row states joined those lists with the
	 * legibility pass, which is what retired the eleven `danger`/`dangerBorder`
	 * exceptions the contract used to carry for this family: they existed because
	 * the pair drawn on a dialog's `elevated` was the one no ground list reached,
	 * and the fix is the value, not the pin.
	 */
	success: string;
	successWash: string;
	successBorder: string;
	warning: string;
	warningWash: string;
	warningBorder: string;
	danger: string;
	dangerWash: string;
	dangerBorder: string;
	info: string;
	infoWash: string;
	infoBorder: string;

	/* ---- overlay -------------------------------------------------------- */

	/**
	 * The one shadow in the system, used by the four MUI overlay elevations
	 * (AppBar 4, Menu/Popover 8, Drawer 16, Dialog 24) and nothing else. An
	 * arbitrary `<Paper elevation={6}>` gets no shadow, which is the intent.
	 */
	overlayShadow: string;
	/** Scrim behind modals and drawers. */
	scrim: string;
};

/** A palette plus the identity the theme picker shows. */
export type ThemeDefinition = {
	/**
	 * The theme's id, typed as the union rather than `string` on purpose.
	 *
	 * A `string` here compiled anything: a palette whose `id` disagreed with its
	 * `ThemeName` member still shipped a `[data-theme="…"]` block under that
	 * spelling (the CSS generator reads this directory, not the union), still
	 * rendered a tile (the picker maps over this array), and `getTheme` returned
	 * the default for it in silence. Widening the set from twelve hand-typed ids
	 * to fifty-nine is what made that trap worth closing, and it closes here
	 * rather than in the registry: with `ThemeName` on the field, a mismatch
	 * between a file's id and the union is a compile error, and `index.ts` no
	 * longer needs a cast to build `ThemeCollection` out of it (review round 1,
	 * M-1). A type-only import, so the two modules still share no runtime code.
	 */
	id: ThemeName;
	name: string;
	/** One line, shown under the name in the theme picker. */
	description: string;
	palette: ThemePalette;
};
