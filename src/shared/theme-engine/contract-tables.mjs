/**
 * The contrast contract's TABLES - data only, no run state.
 *
 * WHY THIS FILE EXISTS. `scripts/contrast-contract.mjs` is the authority on what
 * every palette must satisfy, and until the theme composition engine its floors
 * lived inside that 8.8k-line script, which has no exports and runs on import. The
 * engine (`compose.mjs`, `evaluate.mjs`) re-solves palettes at a contrast preset in
 * the RENDERER, and has to hold them to the same floors the gate holds the shipped
 * palettes to. Re-typing the numbers would be the drift this repository keeps
 * paying for (D85), so the tables moved here and the contract imports them back.
 *
 * CONSTRAINTS.
 *  - Pure data and pure expressions over other entries in this file. No `fs`, no
 *    mutable Sets, no functions with run state: the renderer imports this module.
 *    The consulted-pin Sets, the `find*` pin lookups and `STRUCTURAL_CALL_SITES`
 *    (which pins SOURCE text, not colours) stay in the contract.
 *  - The comments moved with their rows on purpose: each row's comment is the
 *    reason the row exists. Adding a component with its own fill and border still
 *    means adding a row to `CONTROLS` - here now, not in the contract.
 *  - The move was mechanical (an AST pass over the contract's top-level `const`
 *    declarations), and the contract's output at Standard is byte-identical
 *    before and after it, assertion count included.
 */

/* ---- 1. the floors, from docs/branding.md § 3 -------------------------- */

export const FLOOR = { strongText: 7.0, text: 4.5, nonText: 3.0 };

/* `inkDisabled` is the only exempt foreground: SC 1.4.3 exempts inactive
   controls, and a disabled control that meets 4.5:1 does not read as
   disabled. Every other ink is in scope on every ground. */
export const EXEMPT_INK = new Set(["inkDisabled"]);

/* ---- 4. what the system permits ---------------------------------------- */

/** The four grounds every ink must be legible on. */
export const GROUNDS = ["canvas", "surface", "elevated", "sunken"];

/**
 * Ink roles and the floor each must clear on every ground.
 *
 * These are NOT the WCAG floors. SC 1.4.3 asks 4.5:1 of every one of them, and
the app needs more than that for a reason the standard cannot see: WCAG 2.x
contrast is luminance-only, so 4.5:1 at 11px is not 4.5:1 at 14px, and the
secondary weights are what this app prints metadata in. Every type step here is
normal text except `text-display` (28px) - `text-title` is 20px and not bold at
the role level, so it does not qualify as large text either - which leaves
4.5:1 as the ONLY applicable standard floor and the floors below as this
system's own.

`ink` at 7.0 (AAA) rather than 4.5 because it is the weight names, headings and
the transcript are read in for hours at arm's length, and 8.0:1 on `canvas`
because `canvas` IS that transcript. `inkMuted` 5.5 and `inkDim` 5.0 clear AA by
a step each for the two weights that carry 11-13px type.

These were 7.0 / 4.5 / 4.5, and 4.5 for the two secondary weights was the
measured defect: the floors were met as written and the app still read as "text
a little too grey on grey", because the two secondary weights SAT on the floor
while being used at 11-13px. Measured at the old floors, `inkDim` bottomed at
4.51:1 (`dracula` on `elevated`) and `inkMuted` at 5.33 (`nightfox`), and 36 of
the 41 dark palettes had `inkDim` under 5.0:1 on `elevated`.
*/
export const INKS = [
	["ink", FLOOR.strongText],
	["inkMuted", 5.5],
	["inkDim", 5.0],
];

/* ---- 4a. the legibility pass: the eight grounds, the ladder, the inks ---- */

/**
 * The EIGHT grounds an ink can sit on.
 *
 * `GROUNDS` above is the ELEVATION LADDER - four alternative grounds of one
 * panel, which is what every control's own row is measured against. This one
 * adds the grounds that carry text as a STATE rather than as a surface:
 * `accentWash` (the selection/hover tint, callouts, chips, find-match), the
 * two list-row states `rowHover` and `rowSelected`, which replaced the retired
 * `highlight`, and `messageSurface` - the user message block's fill, which is
 * its own surface rather than a fifth rung of the ladder (see its doc in the
 * palette contract). None of the state grounds was in the ink loop before it
 * was added, which is how a keycap on a selected row and a reading button on a
 * hover could fail with every assertion in this file green: measured at the old
 * scope, `inkDim` was under its floor on `accentWash` in 17 dark and 11 light
 * palettes, and on the row role in 36 dark and 14 light.
 */
export const GROUNDS6 = [
	"canvas",
	"surface",
	"elevated",
	"sunken",
	"accentWash",
	"rowHover",
	"rowSelected",
	"messageSurface",
];

/**
 * The ground contract, authored as L* offsets from the lifted canvas.
 *
 * `canvas` is the page - the furthest-back surface, and the one the operator
 * reads for hours - so a dark theme's page sits in a hard BAND, L* 9-15, with
 * 9-13 as the target. Both ends were set by a report from the operator.
 *
 * The FLOOR answered "the background behind the main text is too dark/black":
 * 20 of the 41 dark palettes once sat below L* 10 and 8 below L* 5 (`obsidian`
 * 2.51 at the bottom). It was L* 12 until 2026-11-03, when the opposite report
 * arrived ("dark mode isn't that dark, it shouldn't be overly dark but it should
 * be maybe a bit darker in tone"), and the median dark canvas measured L* 15.1.
 * The floor is now 9: between Discord's 2025 chat ground #1A1A1E (L* 9.42) and
 * Slack's dark #1A1D21 (L* 10.62), the two apps the request names, still nearly
 * double GitHub Dark's #0D1117 (L* 4.95), and below VS Code Dark+'s #1E1E1E
 * (L* 11.26). Nothing below 9 is a page ground, so the near-black report stays
 * closed; only `sunken` and `mediaSurface` go lower, as recesses.
 *
 * The CEILING of 15 is the old [12, 22] band compressed by ONE proportional map,
 * `L*_new = 9 + 0.6 x (L*_old - 12)`, rather than clamped: a clamp would stack
 * every palette that sat above the new top onto it, which is the "the themes
 * have all gone the same grey" regression the fleet section (5b) exists for. The
 * map preserves order and relative spacing; the hand re-solves move 34
 * canvases off it by up to +-1.04 L* (45 of 820 pairs invert, all held apart by
 * the fleet's pair rules), so theme identity is carried by hue and chroma at
 * the darker L*, not by a shared altitude. The
 * design spec proposed 9-13; 15 is the manager's widening for that reason, and
 * 9-13 remains the target the median (L* 10.96 after the map) sits in.
 *
 * The ladder's ink budget is why the floor can drop without moving an ink:
 * darker grounds only RAISE ink contrast, and at canvas 9 / surface 13 /
 * elevated 18 every ink in the fleet clears its floor unchanged - measured
 * across all 41 dark palettes with this file (0 ink failures after the re-light).
 *
 * The top of the ladder is capped at `elevated` 22 (it was 30) because an
 * unbounded top step is what makes the ink budget unaffordable: at `elevated`
 * L* 34 an `inkDim` at 5.0:1 needs L* 85 and the ink/hover distinction
 * disappears into the top of the ramp, and with the canvas at most 15 the
 * largest legal ladder (+5 then +6) still ends below 26, so 22 holds the ladder
 * to the band's own proportions rather than letting one rung climb back to the
 * old altitude.
 *
 * The light side is capped at `canvas` 94 for the same arithmetic from the
 * other end: `elevated` at L* 100 is the end of sRGB's
 * ramp (four light palettes already sit there), the minimum canvas-to-elevated
 * spread is 2.5 + 2.5, so a canvas above 95 has no room for both steps - 94
 * leaves 1 L* of headroom for 8-bit rounding. `sunken` 80 is the same floor read
 * from the recessed side, and it is what keeps a light theme's keycap from
 * being painted on a well that is not there.
 */
export const LIFT = {
	dark: { canvasMin: 9.0, canvasMax: 15.0, elevatedMax: 22.0 },
	light: { canvasMax: 94.0, sunkenMin: 80.0 },
};

/**
 * The ladder: an elevation step is a LIGHTNESS step, and both ends of each one
 * are asserted.
 *
 * Maximums as well as minimums, because an unbounded step is how the ladder
 * collapses at the top (see `LIFT`) and because a palette that jumps too far
 * loses the state distinctions the steps exist for. `canvasSunken` keeps
 * `sunken` on the recessed side of the canvas in both modes.
 *
 * The 1.5-6.0 depth band replaced an unasserted pair: `matrix` shipped a
 * 1.48 L* depth, and six palettes sat under ΔE00 2.0 between `canvas` and
 * `sunken`, which is a well nobody can see. Those two roles ARE adjacent on
 * screen - `output-block.tsx` and `log-block.tsx` paint `bg-sunken` inside a
 * trace that sits on `canvas` - so the pair is measured here and each of those
 * blocks also carries a `border-hairline`.
 */
export const STEP = {
	canvasSurface: [2.5, 5.0],
	/*
	 * 2.0 rather than 2.5, and the third bound is what moved it (the row/hover
	 * pass): the hovered rung is also the ground a current row has to OUTRANK,
	 * so it is placed as close to the panel as it can legally sit, and on the
	 * dark family the row's own ink cap leaves so little room that a 2.5 floor
	 * and `FIELD_SEPARATION_FLOOR` cannot both hold - `dune` measured ΔE00 1.74
	 * between the row and a 2.5-step hover, under the field floor, so the pair
	 * it is meant to keep apart stopped being a pair at all.
	 *
	 * The L* floor was always a PROXY for "the two grounds do not merge", and the
	 * proxy is now the looser of the two: `ELEVATED_PANEL_DELTA_E` below asserts
	 * the perceptual statement directly on this pair, which this ladder never
	 * did (it measured only the 1.03 ratio here). A floor that is only a proxy
	 * for a perceptual bound, set ABOVE the bound, cannot be met by measuring the
	 * bound - which is what the row/hover ordering needs and what this pass had
	 * to buy.
	 */
	surfaceElevated: [2.0, 6.0],
	canvasSunken: [1.5, 6.0],
};

/** ΔE00 floor for a ground step, and the luminance ratio the file already had. */
export const GROUND_STEP_DELTA_E = 2.0;

export const GROUND_RATIO = 1.03;

/**
 * `ink` on `canvas` gets 8.0:1 rather than the 7.0 it gets elsewhere.
 *
 * `canvas` is the transcript - the one surface in this app that is read for
 * hours at arm's length - so it is the surface the operator's own report is
 * about, and the extra 1.0 moves four palettes. The weakest at the old scope
 * was `rosePineDawn` at 7.53:1.
 */
export const INK_CANVAS_FLOOR = 8.0;

/** The step between the three ink weights, which is what makes them a ladder. */
export const INK_STEP_DELTA_E = 2.0;

/**
 * `inkDisabled` is a CEILING, not a floor - the one role in the system that is
 * constrained from above.
 *
 * SC 1.4.3 exempts inactive controls, and a disabled control that meets 4.5:1
 * does not read as disabled. So it has no floor, and the thing that needs
 * asserting is the relation that keeps the state legible AS a state: the
 * disabled ink must stay at most 0.8 x `inkDim` on every ground.
 *
 * Making `inkDim` lighter therefore threatens the disabled state from below,
 * which is why the relation is asserted rather than assumed. It is a ratio of
 * two ratios, and because both inks sit on the same side of every ground it
 * reduces to a fact about the two inks alone (the ground cancels), so it is
 * measured on all eight grounds and moves only when the pair itself collapses.
 * At the old values the factor ran 0.39-0.54, so 0.80 is generous by design: it
 * catches a collapse rather than policing a margin.
 */
export const DISABLED_CEILING = 0.8;

/**
 * The selection contract.
 *
 * A selection is a STATE the reader has to find while scanning a list, not a
 * surface they read, so its floor is neither the field floor (2.0) nor a text
 * floor. `SELECTION_DELTA_E` 3.0 is anchored on the one role that already
 * works: `highlight` measures 4.00-4.85 against `surface` in all 59 palettes
 * and the operator has not reported it, so 3.0 sits comfortably inside what
 * this codebase already ships and below the role that works - it cannot force
 * that role to move.
 *
 * Why ΔE00 rather than a ratio: the failing cases here are HUE-ONLY and read
 * 1.000:1 on a contrast ratio. `localOperatorDark`'s palette active row - the
 * operator's own screenshot - passed every separation threshold at ΔE00 7.14
 * while reading 1.003:1, because the whole difference was hue (a 154.9° wash
 * over an 82.1° panel). No ratio-based assertion can see that, and no ΔE00
 * threshold alone can either: the row must also be the panel's own colour.
 *
 * `SELECTION_LIGHTNESS_STEP` 2.0 keeps the greyscale half - a chromatic-only
 * step cannot pass by hue alone - and it is stated as a magnitude in the mode's
 * direction, because ΔE00 is a budget a chroma-bought step can spend while
 * moving the wrong way in lightness.
 */
export const SELECTION_DELTA_E = 3.0;

export const SELECTION_LIGHTNESS_STEP = 2.0;

/**
 * The user message block's fill. Its boundary IS the fill (D10), so it needs a
 * findability floor of its own, and the shared `surface` step cannot carry one:
 * on the low palettes it measures 2.05 (`sage`), 2.08 (`catppuccinMacchiato`)
 * and 2.10 (`oneLight`) ΔE00 off the canvas, which is the operator's report -
 * "the contrast between the user message background and the chat background is
 * quite poor on some themes". 4.0 is this file's floor for the smallest mark
 * the eye must find (`LINE_SEPARATION_FLOOR`, a 1px rule). It also sits at or
 * below the step the same column's composer carries (`elevated` over `canvas`,
 * 4.17 at its fleet weakest) on 58 of the 59 palettes - `catppuccinFrappe` is
 * the one exception, the block's 4.26 stepping 0.03 over its composer's 4.23,
 * which is below any perceptual step and that fill is within ΔE00 0.51 of
 * `elevated` anyway - so the block reads as the quietest object on the screen,
 * with that single exception stated rather than rounded away.
 *
 * The lightness half is asserted with it - at least 2.5 `L*`, the ladder's own
 * `canvas` -> `surface` minimum - because ΔE00 is a budget a chroma-only step
 * can spend while the fill vanishes in a greyscale render.
 */
export const MESSAGE_SURFACE_DELTA_E = 4.0;

export const MESSAGE_SURFACE_LIGHTNESS_STEP = 2.5;

/**
 * The media tile's fill. Its extent at rest IS the fill (the borderless tile
 * draws no edge until hover or focus), so it needs a findability floor of its
 * own, and the shared `sunken` well cannot carry one: as a ΔE00 step off the
 * `canvas` it falls below 4.0 on 55 of the 59 palettes - bottoming at 2.00
 * (`iceberg`, `neonNoir`); the 56th mover, `synth`, clears ΔE00 9.03 and moves
 * for the lightness half alone - which is the extent a page-toned picture's
 * tile had. 4.0 is this file's floor for the smallest mark the eye must find
 * (`LINE_SEPARATION_FLOOR`) - and in the worst case the mark IS that small: a
 * picture that fills the slot shows the well only as a ~1px ring at the
 * picture's edge and corners. The lightness half is asserted with it - at
 * least 2.5 `L*` in MAGNITUDE, the half the message block's fill carries -
 * because this fill steps down where that one steps up, and ΔE00 is a budget a
 * chroma-only step can spend while the fill vanishes in a greyscale render.
 *
 * THE WORST REALISED MARGIN IS ROUNDING-THIN: `oneDark` clears by 0.0012 ΔE00
 * after 8-bit rounding, so a single-LSB edit to that palette would flip this
 * assertion - which is why it is re-derived for every palette on every run
 * rather than spot-checked. The returning hover/focus edge is deliberately NOT
 * asserted against this fill: its >= 3:1 is the GROUND relationship
 * (`borderControl` on the four grounds, >= 3.01 across the fleet), the side
 * the tile's silhouette is read against, and against `mediaSurface` the edge
 * falls below 3:1 on 10 light palettes (2.78 worst, `catppuccinLatte`) - an
 * inner pair the cue is not read from (design round 1, D1).
 */
export const MEDIA_SURFACE_DELTA_E = 4.0;

export const MEDIA_SURFACE_LIGHTNESS_STEP = 2.5;

/**
 * The hover tint's own floor: half a selection's, because a hover is transient
 * and is paired with the pointer.
 */
export const HOVER_DELTA_E = 2.0;

/**
 * The keycap's ground against everything it can be painted on.
 *
 * `sunken` is the keycap's ground and a keycap is an annotation on the row a
 * user has just SELECTED, so the pair that decides whether it survives is
 * `sunken` against the state grounds. Measured at the old scope: 1.13 ΔE00
 * on `accentWash` in `tokyoNightDay` and 1.81 in `ayuLight` - a cap whose
 * ground disappears under it on the light themes where it is weakest.
 */
export const KEYCAP_DELTA_E = 2.0;

/**
 * Component triples: the ground a control sits on, its own fill, its border,
 * and its ink. A control is legal when its ink clears the text floor against
 * its own fill, AND its edge is perceivable — fill OR border clearing 3:1
 * against the ground behind it.
 */
export const CONTROLS = [
	// Source confirmation paints its remedy and diagnostic on warningWash;
	// ground-only button/text checks do not cover either of these pairings.
	{
		name: "hub source confirmation remedy",
		on: ["warningWash"],
		fill: "accent",
		border: "accent",
		ink: "onAccent",
	},
	{
		name: "hub source confirmation diagnostic",
		on: ["canvas"],
		fill: "warningWash",
		border: "warningBorder",
		ink: "inkMuted",
	},

	// Find is a chrome-band row, never a DOM panel over WebContentsView. Its
	// standard Input uses the existing input-control contract; this pins the
	// row's elevated ground, control rule and politely announced count.
	{
		name: "browser find row",
		on: ["elevated"],
		fill: "elevated",
		border: "borderControl",
		ink: "inkMuted",
	},
	// The address suggestion list is the second in-flow chrome band: it shares
	// the bar's elevated ground and control rule, and its label/empty notice is
	// muted ink. The rows themselves are already covered by the elevated-ground
	// ink loop and the accent-wash state ground; this pins the container so a
	// future fill/border edit cannot ship an unmeasured combination.
	{
		name: "browser address suggestions",
		on: ["elevated"],
		fill: "elevated",
		border: "borderControl",
		ink: "inkMuted",
	},
	/*
	 * The S6a approvals card: another native child over live page content. Its
	 * ground is the page underneath, which no palette enumeration can know, so
	 * this row pins what the card controls itself — its elevated fill, its
	 * control edge and its muted brand/detail ink — the same way the find row
	 * pins its band. The count's accent ink and the title's `ink` are measured
	 * by the elevated-ground ink loop; without this row a green run would say
	 * nothing about the surface the card paints.
	 */
	{
		name: "browser approvals card",
		on: ["elevated"],
		fill: "elevated",
		border: "borderControl",
		ink: "inkMuted",
	},
	{
		name: "primary button",
		on: GROUNDS,
		fill: "accent",
		border: "accent",
		ink: "onAccent",
	},
	{
		name: "primary button (hover)",
		on: GROUNDS,
		fill: "accentHover",
		border: "accentHover",
		ink: "onAccent",
	},
	{
		/*
		 * The pressed fill is a ground the label sits on for as long as the
		 * pointer is down, and `button.tsx` paints `text-on-accent` on it via
		 * `active:bg-accent-active`. Rest and hover were measured and this was
		 * not, so the one state where the fill is darkest went unchecked.
		 */
		name: "primary button (pressed)",
		on: GROUNDS,
		fill: "accentActive",
		border: "accentActive",
		ink: "onAccent",
	},
	/*
	 * THE TONAL BUTTON: the action inside a floating surface (`button.tsx`,
	 * variant `tonal`). It lives on `elevated` - menus, popovers, dialogs, sheets
	 * are all that ground - and its three states are a ground ramp with `ink` on
	 * top. It draws no border and its fill is a ground STEP off the panel, never a
	 * 3:1 boundary (no ground pair in any palette is), so the rows declare
	 * `edge: false` like the library card and the reaction pills; the step itself
	 * (ΔE00 >= 6.07 `sunken` off `elevated`) is the ground ladder's own assertion.
	 * `STRUCTURAL_CALL_SITES` pins the variant's classes, so a row cannot stay
	 * green about a button that stopped wearing these fills.
	 */
	{
		name: "tonal button",
		on: ["elevated"],
		fill: "sunken",
		border: null,
		ink: "ink",
		edge: false,
	},
	{
		name: "tonal button (hover)",
		on: ["elevated"],
		fill: "surface",
		border: null,
		ink: "ink",
		edge: false,
	},
	{
		name: "tonal button (pressed)",
		on: ["elevated"],
		fill: "hairline",
		border: null,
		ink: "ink",
		edge: false,
	},
	{
		name: "outline control",
		on: GROUNDS,
		fill: null,
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * THE TEAM AVATAR BUBBLE (operator ask, 2026-10-01), RE-ROLED INTO THE BADGE
		 * FAMILY (operator round, 2026-10-02): the compact initials mark the chat
		 * sidebar's session rows and the chat header's team chip draw, the replacement
		 * for a drawn team name that was costing the row's title whatever the name was
		 * long.
		 *
		 * ITS FACE IS THE RAIL'S QUIET COUNT, so this row is deliberately the twin of
		 * "rail approval badge (quiet)" further down - same `elevated` fill, same
		 * `inkDim` ink, same missing edge, same four grounds. The mark composes the
		 * same `badgeVariants({ variant: "attentionQuiet", shape: "pill", size:
		 * "count" })` call the rail makes rather than copying its class string, so a
		 * change to one that is not made to the other fails here instead of in a
		 * reader's eyes. The old row attested `sunken` + `borderControl` + `ink`, which
		 * is the pair the operator's 2026-10-02 report called ugly ("borderless bubble
		 * of the sidebar notification counts ... slight contrast vs backdrop, smaller
		 * more subtle text").
		 *
		 * WHAT IT ASSERTS NOW. The initials' `inkDim` on the mark's own `elevated` -
		 * 5.01:1 at worst over the fifty-nine palettes, the same figure the rail row
		 * quotes - which is the floor that matters because the letters are READ. The
		 * edge is declared away with `edge: false`, for the reason that row states:
		 * the fill provably cannot carry a boundary across every palette: it merges
		 * with a row's own ground at 0.00-0.47 ΔE00 on the row-state grounds at worst
		 * (`arcade` byte-identical on `rowHover`, `duskfox` 0.47 on `rowSelected`; four
		 * of the fifty-nine sit inside ΔE00 2.0 there and sixteen on the selection), so
		 * what keeps the mark legible is the letters' own floor, and what
		 * keeps it a MARK rather than plain label text is that a quiet row draws
		 * nothing at all. The class half - that the mark still wears this composition,
		 * through the component boundary the discovery scan cannot see - is in
		 * `scripts/chat-sidebar-selection.test.mjs`.
		 *
		 * THE FOUR GROUNDS ARE THE HOSTS the mark can be painted on: the chat panel's
		 * `surface` (the session list), the header chip's `canvas`, and the two STATES
		 * the list's rows paint under the pointer and under a selection. They are named
		 * rather than left to `GROUNDS` because the state grounds are not rungs of that
		 * ladder - the same reason the rail's row names them.
		 */
		name: "team avatar bubble",
		on: ["canvas", "surface", "rowSelected", "rowHover"],
		fill: "elevated",
		border: null,
		ink: "inkDim",
		edge: false,
	},
	{
		/*
		 * TEAM BRIDGE'S BORDERLESS INITIAL PLATES (operator ask, 2026-10-26).
		 * The message row, rail, compose suggestions and intro header use the
		 * same fill. `mediaSurface` is the app's borderless-tile role rather than
		 * `sunken`, whose ground step can disappear under a hovered row. The
		 * plate has no control boundary: its initial is the readable mark and its
		 * extent is a ground step, asserted on all four hosts below.
		 *
		 * The rail's account row draws the same plate since its own-avatar
		 * change (design review round 1, D2): `surface` is its ground and
		 * `rowHover` its pointer state, both hosts here.
		 */
		name: "team bridge person initial plate",
		/*
		 * THE FOUR HOSTS THE PLATE IS DRAWN ON, and `elevated` joined them in review
		 * round 1 (M3): the compose suggestion's plate sits in the To: popover, which
		 * is `elevated`, not a page ground. The selected rail row is deliberately NOT
		 * listed: that ground takes `surface` (sibling row below), because this fill
		 * bottoms out at 1.83 there - the design round's D1.
		 */
		on: ["canvas", "surface", "elevated", "rowHover"],
		fill: "mediaSurface",
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	/*
	 * TEAM BRIDGE REACTION PILLS (operator polish round, 2026-10-30): borderless,
	 * "subtly contrasted fill like the sidebar counts", the reader's own reaction
	 * "clearly brighter" (`team-bridge-reactions.tsx`).
	 *
	 * THE THREE HOSTS are the grounds a message row is painted on: the thread
	 * column's `surface` (`team-bridge-page.tsx`), the thread pane's `canvas`
	 * (`team-bridge-thread-pane.tsx`) and `rowHover`, which the row takes under
	 * the pointer - exactly when a reader is about to press a pill.
	 *
	 * WHY `edge: false` ON THE ROLE ROWS. The pill is a COUNT MARK in the sidebar's
	 * quiet-count family (`attentionQuiet`: `elevated`, no ring), and that family
	 * already declares that its fill is a grouping whisper, not a boundary: the
	 * `elevated` fill is ΔE00 0.00 off `rowHover` in arcade, so no quiet
	 * fill-only design can promise 3:1 there, and a border is what the operator asked to remove. What keeps a
	 * pill legible and operable is the INK on its own fill - the emoji and the
	 * count are the content and the target - which these rows assert at 4.5:1 on
	 * every palette, at rest and in the hover step.
	 */
	/*
	 * THE NOTIFICATION-SOUND RADIO (`shared/components/ui/radio-group.tsx`;
	 * notification-sound settings spec §3.4, §9). The ring is the radio's whole
	 * boundary, so it is a control edge with the 3:1 floor, on each ground the
	 * row paints: `canvas` at rest and `rowHover` under the pointer. The row's
	 * label (`ink`) sits on the same ground, which is what the ink half asserts.
	 * There is no selected-row ground by design: `accent` and `borderControl`
	 * both fall under 3:1 on `rowSelected` in several palettes (spec §9).
	 *
	 * The hover row is why the ring steps to `inkMuted` while hovered:
	 * `borderControl` on `rowHover` is under 3:1 in five palettes, so the
	 * component swaps the role rather than this file pinning five exceptions.
	 */
	{
		name: "notification sound radio ring",
		on: ["canvas"],
		fill: null,
		border: "borderControl",
		ink: "ink",
	},
	{
		name: "notification sound radio ring (hover)",
		on: ["rowHover"],
		fill: null,
		border: "inkMuted",
		ink: "ink",
	},
	{
		name: "notification sound radio ring (checked)",
		on: ["canvas", "rowHover"],
		fill: null,
		border: "accent",
		ink: "ink",
	},
	{
		name: "team bridge reaction pill",
		on: ["surface", "canvas", "rowHover"],
		fill: "elevated",
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	{
		name: "team bridge reaction pill (hover)",
		on: ["surface", "canvas", "rowHover"],
		fill: "sunken",
		border: null,
		ink: "ink",
		edge: false,
	},
	/*
	 * TEAM BRIDGE THREAD ROW (`team-bridge-thread-row.tsx`, design round 1 on
	 * #1672, D1/D2). Transparent at rest, so at rest its fill IS the host. Since
	 * the visual refresh (#1668) the hosts are the channel timeline's `canvas`,
	 * the thread pane's `surface`, and the parent message row's inset hover tint
	 * under the pointer: `surface` on the timeline, `elevated` in the compact
	 * pane. `rowHover` stays listed for any host that still paints the old band.
	 * `accentWash` is NOT a host: the inset box a row that mentioned the reader
	 * wore (#1668 C3, #1672 D7) was removed at the operator's request (#1679), so
	 * a mention row rests on the same grounds as any other.
	 * Hover is `sunken` on all of them.
	 * Its inks are the accent "N replies" count and the `inkMuted` "Last reply"
	 * clause; one row per ink, because the checker reads one ink per row.
	 *
	 * `edge: false` for the same reason as the reaction pills above: a fill-only,
	 * borderless bar cannot promise a 3:1 boundary off `rowHover` in every
	 * palette, and the operator asked for no border. What makes the row usable is
	 * its ink on whatever fill it has, which these rows assert at 4.5:1. The
	 * accent-on-`sunken` pair is the tightest (design round 1 measured
	 * solarizedLight at 4.50:1), which is why it has its own row.
	 */
	{
		name: "team bridge thread row (rest, count)",
		on: ["canvas", "surface", "elevated", "rowHover"],
		fill: null,
		border: null,
		ink: "accent",
		edge: false,
	},
	{
		name: "team bridge thread row (rest, last reply)",
		on: ["canvas", "surface", "elevated", "rowHover"],
		fill: null,
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	{
		name: "team bridge thread row (hover, count)",
		on: ["canvas", "surface", "elevated", "rowHover"],
		fill: "sunken",
		border: null,
		ink: "accent",
		edge: false,
	},
	{
		name: "team bridge thread row (hover, last reply)",
		on: ["canvas", "surface", "elevated", "rowHover"],
		fill: "sunken",
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	/*
	 * TEAM BRIDGE ATTACHMENT CHIPS (inline-image refresh, SPEC §3.1 / D1). A
	 * file, a non-image descriptor or a count-only receipt is a borderless
	 * Slack-style chip: `mediaSurface` fill, `ink` name, `inkDim` meta line, an
	 * `elevated` kind tile with an `inkMuted` glyph (`bridge-attachment-group.tsx`,
	 * `CHIP_CLASS`). The operator asked for the bordered card to go, so the fill
	 * is the extent, and the chip is not a control (no hover step, no action).
	 *
	 * THE EXTENT IS A ΔE00 STEP, NOT A 3:1 EDGE, so `edge: false` here and the
	 * claim lives where a ground step is measured: `PERCEPTIBLE`'s "team bridge
	 * attachment chip" row holds the fill ΔE00 3.0 off all three hosts a message
	 * row paints - `rowHover` included. Round 1 shipped an `elevated` fill whose
	 * comment claimed it read on a hovered row; it measured ΔE00 0.00 (arcade),
	 * 1.14 (gruvbox), 1.21 (obsidian), 1.90 (everforest) there and nothing
	 * asserted it (agent review round 1, minor 1). The meta line's `inkDim` is a
	 * caption at 11px, so it is held to the text floor too.
	 */
	{
		name: "team bridge attachment chip name",
		on: ["surface", "canvas", "rowHover"],
		fill: "mediaSurface",
		border: null,
		ink: "ink",
		edge: false,
	},
	{
		name: "team bridge attachment chip meta",
		on: ["surface", "canvas", "rowHover"],
		fill: "mediaSurface",
		border: null,
		ink: "inkDim",
		edge: false,
	},
	{
		name: "team bridge attachment chip kind tile",
		on: ["mediaSurface"],
		fill: "elevated",
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	/*
	 * THE FILE CARD'S RETRYABLE-FAILURE GLYPH (decision a-fdf0; design round 1,
	 * D3). The tile's kind glyph becomes a `danger` alert glyph while a Save
	 * can be retried. `danger` as the card's 11px status TEXT on `mediaSurface`
	 * measured 4.17-4.44:1 in ten light palettes, so the colour moved to the
	 * glyph and onto the tile's own `elevated` fill, held here at the text
	 * floor - stricter than the 3:1 a non-text glyph needs (WCAG 1.4.11).
	 */
	{
		name: "team bridge file card failure glyph",
		on: ["mediaSurface"],
		fill: "elevated",
		border: null,
		ink: "danger",
		edge: false,
	},
	/*
	 * THE INLINE IMAGE ACTION CLUSTER: Open and Save float over the picture's
	 * top corner on hover/focus, an overlay (`shadow-overlay`), so its ground is
	 * the PICTURE - unknowable - and the cluster's own `elevated` fill is what
	 * the icons are read on. Asserted as ink on that fill at rest (`inkMuted`)
	 * and under the pointer (`ink` on `rowHover`); `on: ["mediaSurface"]` is
	 * the tile's own letterbox ground, the one ground the role system knows.
	 */
	{
		name: "team bridge image action cluster",
		on: ["mediaSurface"],
		fill: "elevated",
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	{
		name: "team bridge image action cluster (hover)",
		on: ["elevated"],
		fill: "rowHover",
		border: null,
		ink: "ink",
		edge: false,
	},
	{
		/*
		 * THE READER'S OWN REACTION PILL (visual refresh D11, 2026-11-04):
		 * `accent` on `accent-wash`, in place of the 26% accent-over-surface
		 * `color-mix` it used to derive - a colour no palette authored, mixed
		 * against `surface` even where the pill sat on the `canvas` timeline.
		 * Two roles now, so it is an ordinary triple. Borderless like the
		 * others' pill (operator, 2026-10-30), so `edge: false`: the hue step
		 * off the others' `elevated` pill and the accent count are what read as
		 * "mine". 4.51:1 worst (everforest). The hover is an ink step to
		 * `accentHover` on the same wash (row below).
		 */
		name: "team bridge own reaction pill",
		on: ["canvas", "surface", "rowHover"],
		fill: "accentWash",
		border: null,
		ink: "accent",
		edge: false,
	},
	{
		name: "team bridge own reaction pill (hover)",
		on: ["canvas", "surface", "rowHover"],
		fill: "accentWash",
		border: null,
		ink: "accentHover",
		edge: false,
	},
	{
		/*
		 * TEAM BRIDGE IDENTITY PLATES (visual refresh D4, contract C2 in
		 * `docs/branding.md` § 2 "The second accent"). Every Team Bridge plate -
		 * person, agent, unknown sender, and the workspace tile - is the one
		 * `accentAltWash` disc; kind reads from the INK: `accentAlt` initial for a
		 * person, the `accent` Bot (plus the dog-ear) for an agent, `inkMuted` for
		 * an unknown sender's glyph. The disc is borderless, so its EXTENT is
		 * asserted as well as its inks: the `team bridge identity plate wash`
		 * PERCEPTIBLE row holds the wash ΔE00 >= 3.0 off every ground it sits on
		 * (design round 1, D1 on #1668 - it measured 1.24-2.75 on eight palettes,
		 * radient 1.78, until those washes were lifted on L*). `accentWash` is not
		 * used for agents: it sits within ΔE00 1.4-2.6 of a ground on 15 palettes
		 * and has 60+ other consumers. A SELECTED rail row's plate takes `surface`
		 * instead (`TeamBridgeAvatar`'s `selected`), measured by the inks' own
		 * `surface` floors.
		 */
		name: "team bridge person identity plate",
		on: ["canvas", "surface", "elevated", "rowHover"],
		fill: "accentAltWash",
		border: null,
		ink: "accentAlt",
		edge: false,
	},
	{
		name: "team bridge agent identity plate",
		on: ["canvas", "surface", "elevated", "rowHover"],
		fill: "accentAltWash",
		border: null,
		ink: "accent",
		edge: false,
	},
	{
		/* The unknown sender's `UserRound` glyph on the same disc (agent review
		   round 1, m4a): 5.65:1 worst (kanagawaLotus). */
		name: "team bridge unknown sender plate",
		on: ["canvas", "surface", "elevated", "rowHover"],
		fill: "accentAltWash",
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	{
		/*
		 * THE "NEW" UNREAD DIVIDER'S PILL (visual refresh D10): `onAccent` on a
		 * solid `accent` label at the end of a 1px accent rule, drawn on the
		 * message pane's `canvas` (and the thread pane's `surface`). The fill
		 * IS the label's extent, so the edge is asserted (accent vs ground).
		 */
		name: "team bridge new messages divider pill",
		on: ["canvas", "surface"],
		fill: "accent",
		border: null,
		ink: "onAccent",
	},
	{
		/*
		 * The pills' `+`: a transparent `inkDim` glyph at rest (asserted on the
		 * three grounds by the ground ink loop) that takes the resting pill's
		 * `elevated` fill and full `ink` under the pointer. Same `edge: false`
		 * reasoning as the pills above.
		 */
		name: "team bridge reaction add (hover)",
		on: ["surface", "canvas", "rowHover"],
		fill: "elevated",
		border: null,
		ink: "ink",
		edge: false,
	},
	{
		/*
		 * THE PLATE ON A SELECTED RAIL ROW (design round 1, D1). `mediaSurface` is
		 * the quiet step everywhere else, but a selected row's ground is
		 * `rowSelected`, where it bottoms out at ΔE00 1.83 on the brand light palette
		 * and falls under 3.0 on eight - the plate the design round saw fading into
		 * the selection. `surface` is the role authored against that ground (ΔE00 >=
		 * 3.18 on all 59 palettes) and holds `inkMuted` well clear of the floor, so
		 * the selected row is the one state that steps the other way. No edge: the
		 * operator asked for borderless plates, and this row is what replaces the
		 * ring on the one host where a fill alone was not enough.
		 */
		name: "team bridge plate on a selected rail row",
		on: ["rowSelected"],
		fill: "surface",
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	{
		/*
		 * THE IMAGE ACTIONS TRIGGER (design round 1, D1). It floats over
		 * ARBITRARY PICTURE PIXELS — which this file cannot measure (its own
		 * header: text over an image is out of scope) — so the fix gave it a
		 * ground of its own, `accentWash`, and the pair asserted here is the one
		 * that can be: the glyph on that fill. THE NUMBERS COME IN TWO KINDS, and
		 * they were conflated once (review round 2, R6). The TOKEN PAIR this row
		 * recomputes — `inkMuted` on `accentWash`, across every palette — is
		 * 8.19:1 dark and 7.72:1 light on the two brand palettes, which is the
		 * pair the open state's pattern was argued from. The FIXED FRAMES measure
		 * 7.35:1 light (dots `#474f46` on the chip `#e7f2e9`) and 8.15:1 dark
		 * (`#b1c0b4` on `#17281e`) — design round 2's re-measurement of the
		 * re-captured set, the number a reader of the evidence sees. Both clear
		 * the 3:1 icon floor the old glyph-on-picture reading failed (1.63:1 light
		 * over a dark picture; 1.81:1 inverse). The EDGE half is declared away: the
		 * chip's boundary is not an edge a reader navigates by — it is only visible
		 * while a trigger is revealed over a picture or sits on the viewer chrome
		 * beside ghost siblings — and a 3:1 fill-against-ground floor would demand
		 * a token the design did not ask for.
		 */
		name: "image actions trigger",
		on: GROUNDS,
		fill: "accentWash",
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	{
		name: "input field",
		on: GROUNDS,
		fill: "surface",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * THE COMPOSER THAT REFUSES INPUT, which is a state rather than a second
		 * control: `message-input.tsx` paints the composer box `bg-elevated` with no
		 * edge at rest and, in this state, its ink `ink-disabled`
		 * (`read-only:text-ink-disabled`, `docs/branding.md` § 6's colour step).
		 *
		 * A row of its own because the pairing differs from the row above: the ink
		 * is the floor-exempt disabled role, which is the point of the state - a
		 * refusal has to READ as one - and a row that kept `ink` here would be
		 * attesting a legibility the user never sees while claiming to be evidence
		 * about the state that ships. `AGENTS.md`'s rule is the reason it cannot be
		 * left out instead: green output about a component nobody listed is not
		 * evidence about that component.
		 *
		 * WHAT IT ASSERTS NOW, since chat redesign §G1 removed the edge: the box's own
		 * ground on the ground it renders over (`elevated` on `canvas`) and the fact
		 * that the ink in use IS the exempt one - `EXEMPT_INK` in the loop below.
		 * The EDGE half is declared away with `edge: false`, and that is a move of the
		 * claim rather than a deletion: a refused composer spends the same ground step
		 * an idle one does, and that step is asserted by `PERCEPTIBLE`'s
		 * `canvas` -> `elevated` row and by the palette ladder's own bounds, plus the
		 * `STRUCTURAL_CALL_SITES` pin on the class string. Keeping `border-control`
		 * here would be a row attesting a boundary the component deliberately does not
		 * draw - the exact class of stale evidence this file exists to prevent - and it
		 * is what the row said before §G1 moved the box from `surface` to `elevated`.
		 *
		 * WHY THE EXEMPT INK IS RIGHT HERE, since a number this low deserves its
		 * reason written down (design round 1, D2) and this row is where it becomes
		 * visible: measured on the shipped palettes, the refusal ink is 2.52:1 in
		 * the dark brand, 2.84:1 in the light one, median 2.55 across the 59, worst
		 * 1.80 in `arctic` - and in the EMPTY refusal that ink carries the box's
		 * only sentence ("This conversation is gone"). Two facts make it still
		 * correct. The reader can RETRIEVE what is in the box: it keeps focus, and
		 * its text stays readable, selectable and copyable, which is what `readOnly`
		 * bought and what a `disabled` box could not give, so nothing is lost at
		 * this contrast. And the state's MEANING is not carried by the box's ink:
		 * the transcript above says the sentence in full ("This conversation is no
		 * longer on this machine.", tied to the control by `aria-describedby`) and
		 * holds the way out. A refusal that met 4.5:1 would stop reading as a
		 * refusal, which is the reason `EXEMPT_INK` exists at all. No colour change
		 * is implied: the ink is byte-identical to the base's `disabled` state.
		 *
		 * WHAT THE REFUSAL NO LONGER HAS, named rather than left to be discovered: an
		 * edge of its own. It used to keep `border-control` while its ink went quiet,
		 * which is what the previous version of this comment called "the composer keeps
		 * its boundary while it refuses". §G1 removed the resting border for every
		 * state of this box, so what still marks the refusal is the ink step alone -
		 * and the box's ground step, which the idle composer spends too. That is
		 * enough to read as a refusal (the ink is 2.5:1 in the median palette and the
		 * transcript says the sentence in full), and it is recorded here because a
		 * reviewer comparing this row to the previous one would otherwise read the
		 * change as evidence lost rather than as the design moving.
		 */
		name: "composer (read-only)",
		on: ["canvas"],
		fill: "elevated",
		border: null,
		edge: false,
		ink: "inkDisabled",
	},
	{
		/*
		 * THE WINDOW'S OWN CAPTION GLYPHS (chat redesign §J3, evidence plan U-8).
		 *
		 * Windows and Linux draw the minimize/maximize/close controls INSIDE the client
		 * area and take their colour from `symbolColor`, which this app supplies from
		 * the palette. That makes the OS's controls a component whose ink we choose - the
		 * one non-text UI component in the app that the app does not draw - and WCAG
		 * 1.4.11 asks 3:1 of it. The rows below assert the file's own text floor on the
		 * two grounds the glyphs actually sit on, which is stricter.
		 *
		 * `edge: false` because the buttons have NO edge of their own: on Windows the
		 * overlay is transparent so the app's own pixels are the ground, and on Linux the
		 * overlay colour IS the ground under them. `CONTROLS`' edge floor would demand a
		 * boundary the OS does not draw, and the alternative - leaving the row out -
		 * is the "green output about a component nobody listed" failure this section
		 * opens with. The two grounds are the app's page and the pane toolbars' recessed
		 * strip, which is what `data-chrome-inset-end`'s owner paints under the buttons
		 * when a pane is open.
		 *
		 * `inkMuted` and `inkDim`, not `ink`: the glyphs must read as part of the
		 * header's own quiet icon cluster. `ink` would make the OS's buttons the heaviest
		 * thing in a row of controls, which is the failure mode § 7's liveness rule and
		 * D8 both name. Measured over the fleet, `inkMuted` is 6.23:1 at worst on
		 * `canvas` and `inkDim` 5.0:1 at worst on `sunken`.
		 */
		name: "window caption glyphs (active)",
		on: ["canvas", "sunken"],
		fill: null,
		border: null,
		edge: false,
		ink: "inkMuted",
	},
	{
		/* The inactive state: Microsoft's own guidance dims the glyphs when the window
		   loses activation, and macOS does it to the lights by itself. Reading
		   `isFocused()` is a READ and never a raise - see `window-chrome.ts`. */
		name: "window caption glyphs (inactive)",
		on: ["canvas", "sunken"],
		fill: null,
		border: null,
		edge: false,
		ink: "inkDim",
	},
	{
		/*
		 * The composer's "Insert transcript" control while a dictation records: the
		 * outline button FILLED with `successWash` (design round 1, D4: an empty
		 * bordered square read as a checked checkbox, not a press), wearing
		 * `successBorder` and `success` ink so it reads as the affirmative of
		 * the recording trio, left of a Cancel with a red glyph and the accent Send
		 * recording.
		 * Colour is never the only carrier - the glyph is a check and the name says
		 * "Insert transcript" - so this row holds the ink and edge the pairing
		 * actually draws rather than a state the reader has to decode.
		 */
		name: "composer insert transcript (success outline)",
		on: ["surface"],
		fill: "successWash",
		border: "successBorder",
		ink: "success",
	},
	{
		/*
		 * The composer's "Cancel recording" control: a neutral `borderControl`
		 * outline with the glyph in `danger` (the one colour cue that says this
		 * throws the take away), on the card's `surface` ground. Its hover and
		 * focus face fills with `dangerWash`; both are measured, because the red
		 * fill is the state a pointer is on when it presses.
		 */
		name: "composer cancel recording (danger glyph on outline)",
		on: ["surface"],
		fill: "surface",
		border: "borderControl",
		ink: "danger",
	},
	{
		name: "composer cancel recording (hover / focus, danger wash)",
		on: ["surface"],
		fill: "dangerWash",
		border: "borderControl",
		ink: "danger",
	},
	{
		name: "success callout",
		on: ["canvas", "surface"],
		fill: "successWash",
		border: "successBorder",
		ink: "success",
	},
	{
		name: "warning callout",
		on: ["canvas", "surface"],
		fill: "warningWash",
		border: "warningBorder",
		ink: "warning",
	},
	{
		name: "danger callout",
		on: ["canvas", "surface"],
		fill: "dangerWash",
		border: "dangerBorder",
		ink: "danger",
	},
	{
		/*
		 * The members dialog's inline "Remove {name}" confirm: the outline `danger`
		 * button (no fill of its own, so its fill IS the ground) on the dialog's
		 * `elevated` ground. Design review round 1, D2 measured the same button on
		 * `rowSelected` below both floors in the operator's tokyoNight (label
		 * 4.23:1, edge 2.85:1) and in 6/12 themes, so the armed row stopped painting
		 * that ground; this row keeps the ground it moved to measured, in all 59.
		 */
		name: "members dialog remove confirm (danger sm)",
		on: ["elevated"],
		fill: "elevated",
		border: "dangerBorder",
		ink: "danger",
	},
	{
		name: "info callout",
		on: ["canvas", "surface"],
		fill: "infoWash",
		border: "infoBorder",
		ink: "info",
	},
	{
		/*
		 * THE FAILURE ALERT'S OWN CONTROL, which design round 2 (D10) found
		 * unasserted while it was on screen in two palettes.
		 *
		 * A control painted ON a wash needs its own row: the rows above cover an
		 * outlined control on the four grounds and callouts on `canvas`/`surface`,
		 * and none of them says anything about an edge drawn against `dangerWash`.
		 * The alert's retry was `outline` when this row was written, and an outlined
		 * button's only boundary is `border-control` against that wash - 2.98:1 in
		 * iceberg, under the 3:1 floor, with sage 3.09 and localOperatorLight 3.32
		 * behind it. The alert's control is `primary` now, whose accent fill clears
		 * the wash in all twelve palettes (edge 4.44-16.29, `on-accent` ink
		 * 5.26-19.06), and THIS row is what keeps that true: moving it back to a
		 * variant whose face collapses into the wash fails here rather than in a
		 * theme nobody runs.
		 *
		 * THE NOTICE BANDS ARE NEW CONSUMERS OF THIS SAME PAIRING (the chat pane's
		 * status strip and the backend compatibility banner, this branch's fix):
		 * both draw their remedy as `primary sm` on the band's wash, and both are
		 * pinned at the call site below. The warning-wash counterpart gets its own
		 * row right after this one rather than a `warningWash` entry here: the
		 * wash role differs, so the measured pair differs, and one row cannot state
		 * both.
		 */
		name: "primary button on the danger wash",
		on: ["dangerWash"],
		fill: "accent",
		border: "accent",
		ink: "onAccent",
	},
	{
		/*
		 * The remedy on the WARNING half of the same family: the status strip and
		 * the compatibility banner paint `warning-wash` for every state that is a
		 * transition, a feature limit or an environment fact, and their one filled
		 * control sits on that wash. `accent` against `warningWash` measures 3.46:1
		 * at worst (the `on-accent` ink 5.31-20.27 behind it), so the pairing is
		 * legal everywhere - and this row is what says so, rather than the absence
		 * of a complaint about it.
		 */
		name: "primary remedy on the warning wash",
		on: ["warningWash"],
		fill: "accent",
		border: "accent",
		ink: "onAccent",
	},
	{
		/*
		 * THE STATUS BAND ITSELF, in both severities - the chat pane's strip and
		 * the backend compatibility banner, one row per wash because a wash is the
		 * case § 9.7's own rule says must not ship unasserted: the component has a
		 * fill AND an edge, and both must be measured against the ground it really
		 * sits on.
		 *
		 * WHY THE EDGE IS THE LOAD-BEARING HALF. The wash alone cannot carry a 3:1
		 * boundary against `canvas` by construction, and on four palettes it is
		 * very close to invisible: ΔE00(warningWash, canvas) = 1.01 worst (`paper`;
		 * 3.59 on `localOperatorLight`), against the 25-percentile step a ground
		 * change owes elsewhere in this file. The `-border` role is what draws the
		 * boundary, and it is why the band is a bordered fill rather than a tinted
		 * background - the old strip shipped the wash with no border at all and no
		 * row anywhere said so. ITS WORST DEPENDS ON THE SCOPE, so both are named
		 * (agent review round 1, MINOR-1): over the twelve sweep palettes 3.24:1 /
		 * 3.23:1 (iceberg), and over all 59 the tightest is rosePineDawn at 3.153:1
		 * / 3.150:1 against the canvas - still clear of the 3:1 floor everywhere,
		 * which is what this row asserts per palette rather than as a headline.
		 *
		 * The body ink is `ink` (5.73:1 worst on warningWash, 7.03:1 on
		 * dangerWash), and the washes are deliberately NOT in `GROUNDS6`: that
		 * loop would then demand every ink role clear its floor on them, and the
		 * detail line's `inkMuted` (5.31 / 5.49 worst) is the one pairing the
		 * band actually paints - asserted by the two rows below rather than
		 * implied by a loop that would also pass on pairings nothing renders.
		 */
		name: "status band (warning)",
		on: ["canvas"],
		fill: "warningWash",
		border: "warningBorder",
		ink: "ink",
	},
	{
		name: "status band (danger)",
		on: ["canvas"],
		fill: "dangerWash",
		border: "dangerBorder",
		ink: "ink",
	},
	{
		/*
		 * The band's second line: the strip's `detail` (and its Retry outcome) and
		 * the banner's update-error suffix paint `inkMuted` on the wash, at
		 * `text-meta`. Worst across the palettes: 5.31:1 on warningWash, 5.49:1 on
		 * dangerWash (`kanagawaLotus` - the same figure the browser transfer row's
		 * comment carries for the same wash), both clear of the 4.5:1 floor this
		 * loop applies while staying the quietest line in the band.
		 */
		name: "status band detail line (warning)",
		on: ["canvas"],
		fill: "warningWash",
		border: "warningBorder",
		ink: "inkMuted",
	},
	{
		name: "status band detail line (danger)",
		on: ["canvas"],
		fill: "dangerWash",
		border: "dangerBorder",
		ink: "inkMuted",
	},
	{
		/*
		 * The picker row's pointer mark and in-flight mark.
		 *
		 * A row's edge inside the dialog: the pointer's own position, and the row
		 * an operation is answering about, are both marked with a 1px
		 * `outline-control` edge on top of (not instead of) the pointer's tint.
		 *
		 * This entry is the ROLE half of design D12, and it is here because the
		 * call-site pin alone was the reason the defect survived round 1: the gate
		 * pinned the string `bg-accent-wash` and stayed green while the ROLE it
		 * names collapsed onto the ground it is drawn on — obsidian ΔE00 0.77,
		 * 1.014:1 — so hovering a row in obsidian changed nothing a user could see,
		 * which was the operator's original report surviving intact in a
		 * user-selectable theme. A `structural` edge cannot collapse that way:
		 * `borderControl` is asserted at 3:1 on all four grounds by the loop above,
		 * and this entry asserts the same floor for the row it is painted on.
		 */
		name: "picker row pointer mark",
		on: ["elevated"],
		fill: null,
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The searchable combobox's ACTIVE row — the same problem as the picker's
		 * pointer mark above, on the same ground, and it arrived here for the same
		 * reason: `bg-accent-wash` on `elevated` is dE00 0.77 in obsidian (1.014:1),
		 * so a highlight built from the wash alone is no highlight at all in that
		 * theme and under dE00 4 in three more. The row is listed under its own name
		 * rather than left to the picker's, because "green output about a component
		 * nobody listed is not evidence about that component" (`AGENTS.md`): the
		 * control owns a fill-and-border pair now, and this is where it is asserted.
		 *
		 * `fill` is null because the wash is the TINT, not the boundary the floor is
		 * about: what has to be perceivable is the structural edge, and asserting the
		 * wash as a fill here would be asserting the pairing that is known to
		 * collapse.
		 */
		name: "combobox option active mark",
		on: ["elevated"],
		fill: null,
		border: "borderControl",
		ink: "ink",
	},
	{
		name: "accent wash chip",
		on: ["canvas", "surface"],
		fill: "accentWash",
		border: "accent",
		ink: "accent",
	},
	{
		/*
		 * The second accent's chip — the `accent wash chip` row above, mirrored for
		 * the `accentAlt` pair.
		 *
		 * It exists because the alt hue is spent on a WASH at its one shipping site
		 * (`accentAltWash` in mermaid's categorical ramp), and a chip is the shape
		 * in which a wash acquires a fill, an edge and a label — the same component
		 * triple the accent's own chip asserts. `docs/branding.md` § 2's rule is
		 * explicit: adding a component with its own fill and border means adding a
		 * row, because green output about the rows above is not evidence about this
		 * pair.
		 *
		 * The INK is `accentAlt`, which is the conservative choice and the useful
		 * one: this is the pair that would render if the alt hue were ever given a
		 * label, so asserting it here is what keeps a future label legal rather than
		 * discovering it at 3:1. The alt role today paints NO text (the miniature's
		 * marks are 1px-2.5px bars; mermaid's fills keep their `ink` labels), so this
		 * row measures a pairing the system promises but does not yet paint — and it
		 * is the reason `bg-accent-alt` may not become a text-bearing fill until an
		 * `onAccentAlt` role exists, which `palette-contract.ts` states as the pair's
		 * hard rule.
		 */
		name: "accent alt wash chip",
		on: ["canvas", "surface"],
		fill: "accentAltWash",
		border: "accentAlt",
		ink: "accentAlt",
	},
	{
		/*
		 * The composer's credential pill and mask span (`credential-overlay.tsx`).
		 *
		 * THIS ROW'S ELEMENT IS NOW THE WASH UNDER THE CHIP, not the whole treatment:
		 * the operator reported the pill as square-bracketed marker text and asked for
		 * a real chip (2026-09-17), so `credential-chip-layer.tsx` paints an opaque
		 * chip over the marker run and what is measured here is the ground it sits on
		 * — plus the wrapped run's documented fallback, which keeps this wash and no
		 * chip at all. The chip's own row is below.
		 *
		 * Its ink is `ink`, not a semantic: the pill paints NO VISIBLE TEXT — the
		 * marker's characters are the textarea's, and this element is a
		 * background-only mirror behind them — so what `ink` measures here is the
		 * real pair on screen (the textarea's own ink over the wash the pill puts
		 * behind it). The wash and the edge are the `info` family rather than a new
		 * role: the pill states a FACT ("a credential is referenced here"), which is
		 * what that triple means, and reusing it is what lets this row assert on the
		 * composer's own ground with the rows above.
		 *
		 * The EDGE is painted as a 1px `outline`, not a border, and the measurement
		 * is the same one: an outline does not participate in layout, so the mirror's
		 * line boxes stay byte-identical to the textarea's and the pill cannot drift
		 * off the characters it sits under. A border here costs 2px per line and
		 * misaligns every pill that follows it — measured in the frames.
		 *
		 * `elevated` is the ground the composer box paints (`COMPOSER_BOX`,
		 * `bg-elevated` with no resting edge since chat redesign §G1), and the
		 * `canvas` half covers the same component wherever it is drawn on a bare
		 * page.
		 *
		 * WHICH PAIR MOVES FIRST, named because this is the tightest edge in the table
		 * and the next palette edit needs to know it without re-deriving the row:
		 * sage's `infoBorder` against `canvas` is **3.09:1** against the 3:1 floor,
		 * with the worst-everywhere-else figure (3.14:1 — dune and radient, on
		 * `surface`) beside it. Both were recomputed from the twelve palettes in
		 * design round 2, which is also when the sentence was written: round 1's
		 * disposition claimed this line was already here and it was not (D5).
		 *
		 * The armed token's `warningWash` is deliberately NOT a row here — it has no
		 * boundary and no ink of its own (the textarea paints the glyphs), so it is not
		 * a component triple; the pairs are recorded in the design record instead
		 * (`docs/design/composer-credential-capture.md` §7.1).
		 */
		name: "credential pill",
		on: ["canvas", "elevated"],
		fill: "infoWash",
		border: "infoBorder",
		ink: "ink",
	},
	/*
	 * The not-stored chip's own treatment — the SAME chip, in the warning role
	 * (`credential-overlay.tsx`'s `CREDENTIAL_NOT_STORED_ROLE`, UX round 3, U13).
	 *
	 * A row of its own rather than a second note on the pill's, because it is a
	 * second component triple with its own fill and its own edge (branding.md §
	 * "adding a component with its own fill and border means adding a row"): the
	 * marker text the textarea paints sits on `warningWash` with `warningBorder`
	 * drawn as its 1px outline, and both halves have to clear their floors on the
	 * two grounds the composer can sit on. The pill's row above says nothing about
	 * this pair — a green run over there is not evidence about a chip nobody listed.
	 *
	 * `ink` is the ink for the same reason the pill's is: this element paints no
	 * visible text at all, so `ink` here measures the pair actually on screen — the
	 * textarea's own glyphs over the wash the overlay puts behind them.
	 *
	 * ITS EDGE IS DASHED, and that is a rule of the component rather than a taste
	 * choice the colours can carry (design round 4, D2; code review round 4, MINOR
	 * 2; UX round 4, U17). This row measures two TRIPLES, and the two registers
	 * sitting inside their own floors says nothing about whether a reader can tell
	 * them apart: measured over the twelve palettes, `warningWash` against
	 * `infoWash` is a fill contrast of **1.01-1.11** (ten of the twelve at or below
	 * 1.06), the two edges **1.00-1.72**, and a greyscale reading of the two fills
	 * is **34 vs 35 of 255**. They are separated by hue and almost nothing else, so
	 * the dash is what carries the state for a reader who cannot separate a warm
	 * brown from a cool blue — the same doctrine the TUI's amber is measured
	 * against in the design record's §7.1. A dash is also the only channel here
	 * that survives monochrome without a new token: the armed token shares this
	 * wash and has no edge at all.
	 */
	{
		name: "credential pill (unbacked)",
		on: ["canvas", "elevated"],
		fill: "warningWash",
		border: "warningBorder",
		ink: "ink",
	},
	/*
	 * THE CHIP ITSELF (`credential-chip.tsx`, operator report 2026-09-17).
	 *
	 * Listed separately from the two rows above even though the roles are
	 * identical, because the CONTAINER changed: the pill used to be a wash with no
	 * text of its own, and the chip is a real element with the glyph, the name, the
	 * count and a clear control inside it — ink on that fill is now a pair the
	 * component actually paints rather than one inherited from the textarea behind
	 * it. `branding.md`'s rule is a row per component triple, and "a green run about
	 * a component nobody listed is not evidence about that component" is exactly
	 * what would otherwise apply here: this row is what would fail if someone gave
	 * the chip its own fill later.
	 *
	 * The control's own RESTING ink is a row of its own, below, and that is design round
	 * 1, D3's fix rather than bookkeeping: the `x` used to rest at `text-ink`, so the
	 * only step it could take on hover was a GROUND one (`bg-elevated`), which measures
	 * 1.00-1.33:1 against the chip's own fill - 16 of the 59 palettes at or under
	 * 1.05:1, `obsidian` at ΔE00 0.77, and the default theme greyscale-identical. A
	 * state that rests on hue is the same class of separation the round-4 dash rule
	 * rejected for the two registers. The perceivable step is the INK now
	 * (`inkMuted` -> `ink`), which is also the working-directory chip's own
	 * prune-control idiom, and `hover:bg-elevated active:bg-sunken` stays as the
	 * primitive's ghost pair and as the pressed state the control had none of. Both
	 * registers are listed because both are chipped — a live reference and one nothing
	 * backs — and the transcript draws the same two chips inside the user bubble's
	 * `surface`.
	 */
	{
		name: "credential chip",
		on: ["canvas", "surface"],
		fill: "infoWash",
		border: "infoBorder",
		ink: "ink",
	},
	{
		name: "credential chip (unbacked)",
		on: ["canvas", "surface"],
		fill: "warningWash",
		border: "warningBorder",
		ink: "ink",
	},
	{
		/*
		 * THE CLEAR CONTROL'S RESTING INK (design round 1, D3).
		 *
		 * A pair the component actually paints and no other row asserts: `inkMuted` on
		 * the chip's own wash. `inkDim` is the next step down and it is NOT available
		 * here — 4.07:1 in the weakest palette, under this app's 4.5 text floor — so the
		 * control rests at the lightest role that is legal on this fill and steps TO
		 * `ink` on hover, and the two rows below are what hold that claim across all
		 * fifty-nine palettes. The hover and pressed grounds (`elevated`, `sunken`) need
		 * no row beyond the INKS loop's, which already asserts `ink` on both at the
		 * strong-text floor.
		 */
		name: "credential chip clear",
		on: ["canvas", "surface"],
		fill: "infoWash",
		border: "infoBorder",
		ink: "inkMuted",
	},
	{
		name: "credential chip clear (unbacked)",
		on: ["canvas", "surface"],
		fill: "warningWash",
		border: "warningBorder",
		ink: "inkMuted",
	},
	/*
	 * The `ask` gate's option buttons (`trace/ask-options.tsx`).
	 *
	 * `on: ["canvas"]` is the measurement that shaped the component. These sit
	 * BELOW the accent-washed question callout on the transcript's own ground,
	 * not inside it, because `borderControl` on `accentWash` measures 2.89:1 on
	 * iceberg — under the 3:1 structural floor, so a standard control edge is
	 * not legal inside the wash. The only border role that clears it there is
	 * `accent`, which this card already spends on the callout and which the TUI
	 * refused to spend twice on one frame for the same reason.
	 *
	 * The triple is the `secondary` button's, which is deliberate: an option is
	 * an ordinary control and should not invent a fourth way to draw one. Listed
	 * separately anyway because `on` differs — `secondary` is not asserted on
	 * `canvas` by any other row, and a green run about a component nobody listed
	 * is not evidence about that component.
	 */
	{
		name: "ask option button",
		on: ["canvas", "surface"],
		fill: "surface",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The DOCKED question card (§F1, `trace/question-dock.tsx`): an `elevated`
		 * card on the pane's own ground whose ONE boundary is its 1px `accent`
		 * border - the accent's single spend on the card. Listed because it is a new
		 * component with its own fill and border: `elevated` against `canvas` is a
		 * lightness step and not a boundary, so the accent edge has to clear 3:1 on
		 * its own, and the question's `ink` has to clear the text floor on the card.
		 */
		name: "question dock card",
		on: ["canvas"],
		fill: "elevated",
		border: "accent",
		ink: "ink",
	},
	{
		/* Hover is a colour step, so the stepped fill is its own triple: the
		   label has to clear the text floor on the ground hover moves it to,
		   not merely on the resting one. */
		name: "ask option button (hover)",
		on: ["canvas", "surface"],
		fill: "elevated",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * THE CHANGE-BACK CONTROL (design §10, #1936, `asks/ask-panel.tsx`).
		 *
		 * Listed by this table's own first rule: green output about a component
		 * nobody named is not evidence about that component, and the drawer card's
		 * action row is a surface this file had not asserted. The pairing is
		 * deliberate — `Change answer` is the RESTING control, and `Update answer` is
		 * the same accent triple `Send answer` already wears one button over, so the
		 * resting one is the shape this table has not covered.
		 *
		 * Its edge is a real `border-control`, and the gate is what settled that: the
		 * first version wore the card's own `hairline` and `check-themes` reported 59
		 * violations — "no perceivable edge", fill 1:1 and border ~1.3:1 — in every
		 * theme. That is the contract saying the honest thing rather than splitting a
		 * hair, and it is right about the surface: a button whose only edge is a
		 * decorative rule does not read as pressable, which is the one thing this
		 * control has to be.
		 */
		name: "ask change answer button",
		on: ["surface"],
		fill: "surface",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The mini SHEET (quick-send design §D; design round 1, D5): an
		 * `elevated` box with a 1px `border-control` edge on the summoned
		 * window's `canvas`, whose ink is the base role. RENAMED from "mini
		 * composer field" (design review of the composer-border revert,
		 * 2026-10-17): it was written when the mini had its own box, the mini
		 * moved onto the SHARED composer on 2026-09-30 (52ace4f34), and the row
		 * has described the sheet since - and read as "the composer's edge" to
		 * whoever wanted one, which it must never again: the v0.34.55 edge
		 * cited the field doctrine, not this row, and this row is what invites
		 * the reading. The composer inside the mini ground is
		 * the shared field: no edge at rest (its rule is scanned by
		 * `window-glass-cdp.test.mjs`). A new component with its own fill and
		 * edge has to be LISTED — by this table's own first rule, green output
		 * about surfaces nobody named is not evidence about this one. The same
		 * triple rides under "ask option button (hover)", but that row's
		 * grounds are the pane's, and a summoned window draws on its own canvas.
		 */
		name: "mini sheet",
		on: ["canvas"],
		fill: "elevated",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The browser tab strip's agent marker: the one element that distinguishes a
		 * tab an AGENT opened from one the user opened (design 6.1/11.8).
		 *
		 * The ink is `ink` rather than `accent` as the chip above uses, because this
		 * chip's whole job is to be READ — "Agent" is the label the user is looking for
		 * when they want to know who owns a tab — where the chip above is a pointer
		 * mark. The edge is the accent border, which is what keeps it perceivable on a
		 * tab whose own fill changes with the active state.
		 */
		name: "browser agent marker chip",
		/*
		 * The grounds the chip is DRAWN on. The tab-strip grammar moved them: the chip
		 * renders inside the tab button, whose fills are the page's `elevated` (the active
		 * tab), the strip's `sunken` (an inactive one) and `elevated` (an inactive tab
		 * hovered, focused within, or with its actions row open). `surface` was the fill
		 * a tab used to have and no longer occurs beneath this chip (review round 2, F4:
		 * round 1's correction was not carried to the siblings of the row it was made
		 * on).
		 *
		 * `elevated` was dropped in round 2 and is back in round 3: those three states
		 * are all reachable, the chip now LEADS the title so it is never under the
		 * chrome cluster's opaque band, and the ink has to clear the floor on every
		 * ground it can actually be drawn on (review round 3, MINOR).
		 */
		on: ["sunken", "elevated"],
		fill: "accentWash",
		border: "accent",
		ink: "ink",
	},
	{
		/*
		 * The same chip in its waiting state: a tab parked on an origin with a pending
		 * approval request (design 9.3). The warning WASH marks the state and
		 * `border-control` is the edge, which is the contract's own answer rather than
		 * a preference: `warningBorder` measures 2.51-2.98:1 against `elevated` in
		 * seven palettes, so the semantic border cannot be the boundary of a chip
		 * drawn on a tab whose fill moves with the active state. Measured, not
		 * reasoned — this row failed with `warningBorder` before the change.
		 */
		name: "browser shared marker pill",
		/*
		 * `Shared` and `Restored` gained a `border-control` edge when design round 2's D11
		 * harmonised the five state markers into one pill shape. By this file's first
		 * rule a component with its own edge owns a row, and neither had one (review round
		 * 2, F4) — the same coverage gap as the grounds above, one class down. `fill` is
		 * null because the pill paints no ground of its own: the strip's shows through,
		 * which is why the row asserts the edge against both grounds it can sit on.
		 */
		on: ["sunken", "elevated"],
		fill: null,
		border: "borderControl",
		ink: "inkMuted",
	},
	{
		name: "browser restored marker pill",
		on: ["sunken", "elevated"],
		fill: null,
		border: "borderControl",
		ink: "inkDim",
	},
	{
		name: "browser waiting marker chip",
		/*
		 * The grounds the chip is DRAWN on, which the tab-strip grammar moved (review
		 * round 1, finding 3). It renders inside the tab button, and an inactive tab has
		 * no fill at all any more, so the chip sits on the strip's `sunken`; on the
		 * active tab it sits on the page's own `elevated`. It used to name `surface`,
		 * which no longer occurs beneath it — a row asserting the wrong grounds is the
		 * "green output about a component nobody listed" case.
		 */
		on: ["sunken", "elevated"],
		fill: "warningWash",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The same chip in its failed state: a tab whose main-frame load was refused
		 * (design round 1, D1). The failure PANEL belongs to whichever tab the user is
		 * looking at, so this chip is the only thing that carries the state on a
		 * background tab — which makes it a component with its own fill and edge, and
		 * by this file's own first rule that means a row here. The edge is
		 * `borderControl` for the reason the waiting chip above records, and the row
		 * was added this round because a green `check-themes` said nothing about a chip
		 * nobody had listed (review round 2, D12). The designer measured it clearing
		 * from the generated CSS (ink on `dangerWash` 8.62:1, edge 3.02:1 at worst
		 * across the twelve themes); this row is what keeps that true.
		 */
		name: "browser failed marker chip",
		// The same grammar change as the other two chips: inside the tab button, on
		// `elevated` (active) or the strip's `sunken` (inactive).
		on: ["sunken", "elevated"],
		fill: "dangerWash",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The strip's ACTIVE tab: the PAGE's own ground (`elevated` - the rung the
		 * page below the strip stands on since the drawer's-rung pass, which this
		 * fill and its notch moved with in that pass's remediation) on the strip's
		 * `sunken`, bounded by `border-control` on the three edges it has (design
		 * round 3, D18; re-specified with the tab-strip grammar, spec §6). It has its
		 * own fill and edge, so by this file's first rule it has a row - and the row is
		 * the point: the ground step alone is 1.18:1 at its tightest across the 59
		 * palettes (`cyberpunk`), which is a depth cue rather than a marker, so
		 * `border-control` is what has to clear the 3:1 non-text floor. Measured across
		 * the 59 palettes: `borderControl` on `sunken` is 3.01:1 at worst
		 * (`rosePineDawn`), and `ink` on `elevated` 7.36:1 at worst (`ayuDark`).
		 *
		 * `on` no longer lists `surface`: the INACTIVE tab has no fill any more, so the
		 * only ground this edge borders is the strip's own `sunken`. Keeping a stale
		 * `on` would keep measuring the component against a ground it is not drawn on,
		 * which is the failure mode a green run cannot report.
		 */
		name: "browser active tab",
		on: ["sunken"],
		fill: "elevated",
		border: "borderControl",
		ink: "ink",
	},
	{
		name: "browser dragged tab",
		on: ["sunken"],
		fill: "rowSelected",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The numbered badge on the Approvals control (spec §5.1). `warningWash` is
		 * already this feature's one meaning - "an agent is blocked on you".
		 *
		 * FOUR GROUNDS, and the list grew by MEASUREMENT rather than by argument - twice.
		 * Design round 1's D8 removed `surface` for being fictional ("the chat pane
		 * header's ground when PR 2 puts the control there" - the header is `canvas` in
		 * the shipped tree). The rail put the badge on a real `surface` host (operator
		 * ask, 2026-09-23), and design round 1's D5 plus this round's code review found
		 * the other half of the same mistake: the rail's badge sits in the Browser ROW,
		 * and that row is not always `surface`. It paints `row-selected` when the browser
		 * route is the current destination - which is the state the operator reported
		 * from - and `row-hover` under the pointer. A row that names two of a component's
		 * four grounds is D8's finding read the other way round, so all four are here.
		 *
		 * THE EDGE ROLE MOVED BECAUSE OF THOSE TWO ROWS. `borderControl` - the role this
		 * row asserted until this round - clears 3:1 on `canvas` (3.13 worst) and
		 * `surface` (3.26) but NOT on the row grounds: 2.77:1 on `row-selected` and
		 * 2.92:1 on `row-hover`, with twelve of the fifty-nine palettes under the 3:1
		 * non-text floor. The badge's FILL cannot carry that boundary either (it measures
		 * 1.00-1.19:1 against any of these grounds), so the edge is the whole boundary and
		 * it has to clear the floor on every ground the mark can sit on. `ink-muted` is
		 * the quietest role that does: 6.23 `canvas`, 6.56 `surface`, 5.63 `row-selected`,
		 * 5.91 `row-hover` at worst across all palettes (`ink` would clear it at 7.16
		 * worst, and `accent` at 4.24 - the role is `ink-muted` because a boundary that is
		 * not trying to be read as a message should be the quiet one that passes).
		 * `badge.tsx`'s `attention` variant carries the same role, so the header and the
		 * URL bar move with it - one spelling of this mark, which is the rule that
		 * variant's own docstring states. ("The header" here means the header's
		 * BROWSER trigger, the one control this row's name covers; the header's ask
		 * count moved to the quiet register below on 2026-10-05, so the cluster
		 * carries one spelling of each rather than two of either.)
		 *
		 * MEASURED AT THIS REVISION, all fifty-nine palettes: `ink` on `warningWash`
		 * 5.73:1 at worst (oneDark - ink against a fill does not depend on the ground,
		 * which is why this number has no ground beside it); `ink-muted` 5.63:1 at worst
		 * (nightfox, on `row-selected`, the lowest of the four). Both figures were read
		 * from `scripts/palette-source.mjs` with this file's own ratio, and the earlier
		 * statement of them (8.39:1 and 7.88:1) was neither the worst of its pair nor
		 * reproducible - which is exactly the failure this file exists to refuse. The
		 * `sunken` form D8 mentions is still not a host: nothing draws this badge on the
		 * pane's own strip.
		 */
		name: "browser approvals badge",
		on: ["canvas", "surface", "rowSelected", "rowHover"],
		fill: "warningWash",
		border: "inkMuted",
		ink: "ink",
	},
	{
		/*
		 * THE RAIL'S QUIET COUNT (operator ask, 2026-09-30) — the borderless
		 * register of the approval mark, worn by the sidebar's Browser row and by
		 * Aida's, i.e. on the same four grounds the row above lists, and since
		 * 2026-10-05 also by the conversation header's ask-count badge — which #896
		 * REMOVED: the asks door and its badge moved to the panel rail, where the
		 * count wears the BORDERED `attention` register (the rail's sibling count,
		 * per the issue), so the quiet register's wearers are the marks this row
		 * lists and not the asks count. It is a
		 * separate row rather than a `fill`/`border` change to the row above,
		 * because the two marks differ in what carries them: the bordered mark's
		 * edge WAS its boundary (its wash measured 1.00-1.19:1 on the grounds), so
		 * this one draws no edge at all and the NUMERAL is the whole mark.
		 *
		 * THE INK IS THE MARK, so the ink is what this row asserts: `inkDim` on
		 * `elevated`, 5.01:1 at worst over the fifty-nine palettes (measured from
		 * `scripts/palette-source.mjs` with this file's own ratio, the same way the
		 * row above's figures were) — clear of the 4.5:1 text floor the `CONTROLS`
		 * loop applies to a control's label, which is the floor that matters here
		 * because the numeral is READ rather than merely seen. It is the role the
		 * count lines the operator compared against already wear (11-13px
		 * metadata), and it is deliberately quieter than the bordered mark's `ink`.
		 *
		 * THE EDGE IS DECLARED AWAY, and the declaration is honest rather than a
		 * convenience: the mark provably cannot carry one across every palette.
		 * Its `elevated` fill steps ΔE00 3.29 off `surface` in the dark brand
		 * palette and 2.50 in the light — the ground the user actually sees — and 2.02
		 * at worst over the fifty-nine (arcade), but it falls to 0.47 off `rowSelected`
		 * (duskfox) and 0.00 off `rowHover` (arcade): on a hovered or current row it can
		 * merge into the ground entirely, and no single role fixes that at both ends
		 * (over the four grounds `elevated` spans 0.00-11.64, `sunken` 0.44-14.88). The
		 * old mark's own `warningWash` was not exempt either: its per-ground minima span
		 * 0.87-2.27 across the fifty-nine, and the wash family — all six roles
		 * (`warningWash`, `successWash`, `dangerWash`, `infoWash`, `accentWash`,
		 * `accentAltWash`) over the four grounds — runs 0.53-30.71, so a wash does not
		 * fix the deep rows either. (Scope note, review round 1 F1 and round 2 F7: the
		 * narrower 0.87-2.27 belongs to `warningWash` alone, per ground; the family's
		 * per-(wash, ground) minima span 0.53-2.69 and its whole span is 0.53-30.71 —
		 * 25.83 is the five-role reading, which drops `accentAltWash`, and that is why
		 * the membership is named here rather than left to the reader.) What keeps the count legible is the numeral's own floor above;
		 * what keeps it a MARK rather than plain label text is that a quiet row
		 * draws nothing at all. The step is therefore a cue on the plain grounds and
		 * absent on the deep ones, which is the same deal the sidebar's count lines
		 * strike, and `edge: false` moves the claim to the instrument that can state
		 * it (the ink floor here) rather than inventing a border the design removed
		 * on purpose.
		 *
		 * NOT AS CONTRASTED AS WHAT IT REPLACES, stated as the two steps the
		 * operator compared — in the brand palettes, which is where that comparison was
		 * made: the old bordered mark's `warningWash` stepped ΔE00 5.22 off `surface` in
		 * the dark palette and 5.44 in the light; this one steps 3.29 and 2.50 (2.02 at
		 * worst over the fifty-nine). Same ground, roughly half the separation — the
		 * "slightly contrasted but not as contrasted" the report asked for.
		 */
		name: "rail approval badge (quiet)",
		on: ["canvas", "surface", "rowSelected", "rowHover"],
		fill: "elevated",
		border: null,
		ink: "inkDim",
		edge: false,
	},
	{
		/*
		 * EVERY SIDEBAR ATTENTION COUNT (operator, 2026-10-28): the `emphasis` badge
		 * variant as worn by the shared `AttentionBadge` - Aida, Browser, Mesh, Team
		 * Bridge, Notifications, More's aggregate, and Team Bridge's channel / group
		 * / people / organization unread pills. It began as the Notifications row's
		 * alone (notifications decisions D5, 2026-10-25); the operator reversed D5
		 * and made it the one attention register. A filled pill with no border, so
		 * the EDGE IS CLAIMED: the fill is the whole boundary, and `accent` clears
		 * the 3:1 non-text floor on all four rail grounds (4.24:1 worst, tokyoNight
		 * on `rowSelected`), so this row keeps the default edge check rather than
		 * `edge: false`. The numeral is `onAccent` on `accent`, 4.97:1 worst
		 * (tokyoNightDay) against the 4.5:1 text floor the loop applies. Under the
		 * window glass the fill is opaque, so the digit pair is unchanged, and the
		 * fill against the `canvas` / `surface` glass composites is the same
		 * `accent`-on-composite pair the "glass focus ring" assertion below holds
		 * at 3:1 for every palette, tier and scheme.
		 */
		name: "rail attention badge (emphasis)",
		/*
		 * `elevated` and `accentWash` are the org switcher's MENU grounds: its
		 * per-organization pills render inside `DropdownMenuRadioItem`, on the
		 * menu panel and on the highlighted row (`dropdown-menu.tsx`). Measured
		 * 4.51:1 at worst on both (tokyoNight / everforest, review of #1465 m2);
		 * listed so the 3:1 floor is pinned rather than incidental.
		 */
		on: [
			"canvas",
			"surface",
			"rowSelected",
			"rowHover",
			"elevated",
			"accentWash",
		],
		fill: "accent",
		border: null,
		ink: "onAccent",
	},
	{
		/*
		 * THE SESSION ROW'S OUTSTANDING-ASKS MARK (operator ask, 2026-10-04) — the
		 * sidebar row's "a queued question is waiting" glyph and count
		 * (`chat-session-status.tsx`'s `ChatAsksOutstanding`).
		 *
		 * THE NUMERAL IS READ TEXT, SO THE NUMERAL'S INK IS THE CLAIM, and the split
		 * between the two halves of the mark is the finding (design round 1, D1). The
		 * 14px `MessageCircleQuestion` glyph is a GRAPHIC and keeps the accent the
		 * composer's ask item and the phone's ask chip spend on the same fact,
		 * clearing its 3:1 non-text floor on every ground below (4.24:1 at worst — the
		 * same tokyoNight-on-`rowSelected` figure the browser badge's row above
		 * measures). The 12px count digits beside it cannot: `accent` measures 4.24:1
		 * on `rowSelected` and 4.49:1 on `rowHover` at worst over the fifty-nine, under
		 * SC 1.4.3's 4.5:1, which is the pair the mark was originally drawn in. The
		 * numeral therefore takes `ink-muted` — the role the app's other count lines
		 * wear — which clears the floor with room: 5.63 `rowSelected`, 5.91
		 * `rowHover`, 6.56 `surface` at worst (measured from `scripts/palette-source.mjs`
		 * with this file's own ratio, the way the rows above were). `inkDim` would
		 * clear too (5.02 / 5.20 / 5.48), but this mark is an ATTENTION mark rather
		 * than a quiet one, so it takes the stronger of the two quiet roles.
		 *
		 * THREE GROUNDS, and only the grounds the mark can be drawn on: its row is the
		 * sidebar panel's `surface`, and it paints `rowSelected` on the current
		 * conversation and `rowHover` under the pointer (`chat-sidebar.tsx`'s
		 * `rowStyle`/`rowCurrent`) — the same pair the rail's badge rows list, for the
		 * same reason. Nothing draws this mark on `canvas` or `elevated`.
		 *
		 * THE EDGE IS DECLARED AWAY: the mark draws no fill and no boundary — the glyph
		 * and the digits ARE the mark — so there is nothing for the edge assertion to
		 * measure. The rail's quiet count above takes the same opt-out for the same
		 * reason, and it removes no coverage here either: the glyph's own 3:1 floor is
		 * stated above against these same grounds.
		 */
		name: "session row ask mark",
		on: ["surface", "rowSelected", "rowHover"],
		fill: null,
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	{
		/*
		 * THE PANE'S SCOPE SWITCH (spec §7.2), which is the one control PR 2 adds, and
		 * the reason it needs a row of its own: it is the segmented primitive ON A
		 * `sunken` GROUND, where the primitive's own track role (`sunken`) is the ground
		 * it sits on. Measured this round: the track's fill against its header is
		 * 1.015:1 / dE00 1.00 in the light brand palette and 1.001:1 / 0.83 in the dark
		 * one, so the fill carries no boundary at all and the control's extent is drawn
		 * by its `outline-control` edge instead - which is why the edge is what this row
		 * asserts. A control's boundary is legal if EITHER its fill or its border clears
		 * 3:1, and here it is the border: `control` on `sunken` measures 3.19:1 at worst
		 * across the twelve palettes (the strip's own edge row records the measurement).
		 *
		 * The selected pill's step (`surface` on `sunken`, dE00 4.26 / 4.28) is a
		 * PERCEPTIBLE row rather than this one, and the ink on both sides is covered by
		 * the INKS loop: `ink` on `surface` for the selected label, `ink-muted` on
		 * `sunken` for the unselected one.
		 */
		name: "browser pane scope switch track",
		on: ["sunken"],
		fill: "sunken",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The tray's SELECTED row - the request the card below it answers (spec §4.1).
		 * It steps up a ground rather than gaining a shadow (elevation is a lightness
		 * step) and keeps `border-control`, because the row is what the user is
		 * deciding about and a 1.2:1 ground step is a depth cue, not a boundary.
		 * Measured this round: `ink` on `elevated` 7.64:1 at worst (tokyoNight), edge
		 * 3.65:1 at worst (iceberg) - the fill alone would be 1.05-1.25:1, which is
		 * the number that makes the edge load-bearing rather than decorative.
		 */
		name: "browser approvals tray row (selected)",
		on: ["surface"],
		fill: "elevated",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The approvals dock, whose left edge is the SOLE boundary between the app's
		 * own approvals chrome and a live page (spec §4.2; `border-control` rather
		 * than the canvas dock's `hairline`, which separates two app surfaces). It
		 * holds text, so it is a control row rather than a graphic one. Measured this
		 * round: `borderControl` on `canvas` 3.34:1 at worst (iceberg), `ink` on
		 * `surface` 9.02:1 at worst.
		 */
		name: "browser approvals dock",
		/*
		 * BOTH HOSTS' GROUNDS, and the second one is this pass's edit. The dock is a
		 * control band inside `BrowserSurface`, which the ROUTE mounts on `canvas` and
		 * the chat's pane mounts on the drawer's rung - `elevated` since the pane-slot
		 * pass (`canvas/index.tsx`). Its edge is asserted against both, and it passes
		 * on `elevated` because `borderControl` is authored at 3:1 on the lightest
		 * ground the file asserts (`palette-contract.ts`).
		 */
		on: ["canvas", "elevated"],
		fill: "surface",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The consent band: the surface the per-origin approval prompt renders on, in
		 * the browser's chrome band. A control band rather than a callout, so its
		 * boundary is `border-control` (design 11.2) and its ground is `surface` — see
		 * the component for why the urgency is carried by an icon and words rather
		 * than by a wash no palette assertion would cover.
		 */
		name: "browser consent band",
		on: GROUNDS,
		fill: "surface",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The transfer row (design §16.4): the chrome band's line about a file the
		 * agent downloaded, sent or refused.
		 *
		 * WHY IT NEEDS A ROW OF ITS OWN rather than inheriting the consent band above it.
		 * The SAVED state is the band's own pairing (`surface` fill, `borderControl` edge,
		 * `ink`), and that row already covers it. The REFUSED state is not: it takes
		 * `dangerWash` as its fill and keeps `borderControl` as its edge, which is a
		 * pairing no row asserted before this one - the app's other `dangerWash` surface
		 * is the browser error line, and a wash is exactly the case the consent band's
		 * own comment says must not be added without a row, because the urgency has to
		 * live on a role the contract measures rather than on a colour nobody checks.
		 *
		 * `ink` IS THE ROLE THE COMPONENT PAINTS, and review round 1's D5 is why that
		 * sentence is here rather than assumed: the row declared `ink` while the component
		 * painted `ink-muted`, so this row's green output described a pairing that did
		 * not ship - and `inkMuted` on `dangerWash` measures 5.49:1 in kanagawaLotus,
		 * 0.01 under the 5.5 floor this file sets for that role. The component paints
		 * `ink` now (min 7.03:1) for the refusal's copy and its glyph, so the declaration
		 * and the pixels agree; `dangerWash` is deliberately NOT in `GROUNDS6`, whose ink
		 * loop would then assert every ink on it including the two that fail.
		 *
		 * `on` names every ground rather than one, and that is the measured fact rather
		 * than caution: the row is a sibling of the consent band in the same strip, and
		 * the ground behind the strip is whichever one the route
		 * paints (the pane draws `canvas`, the surface draws `surface`), so the wash is
		 * asserted against all four.
		 */
		name: "browser file-transfer row (refused)",
		on: GROUNDS,
		fill: "dangerWash",
		border: "borderControl",
		ink: "ink",
	},

	/*
	 * The composer's context wheel, one row per rung it can be drawn in.
	 *
	 * Listed because it is a control whose ENTIRE visual body is an edge: a
	 * 1.75px ring with no fill, on the composer's `surface` ground, plus the
	 * monospace reading beside it. There is nothing else for a viewer to see,
	 * so "is the edge perceivable against the ground behind it" is not one
	 * property of this control among several - it is the whole question of
	 * whether the control renders at all.
	 *
	 * `fill: null` is therefore literal rather than a shortcut: the ring paints
	 * no interior, so the script's `fill = ground` fallback is exactly right,
	 * and the ink assertion it produces (`inkMuted` on `surface`) is the real
	 * pairing the percentage beside the ring is read at.
	 *
	 * Three rows rather than one because the ring takes three DIFFERENT border
	 * colours depending on how full the window is - the union of the TUI's
	 * absolute and proportional ladders, mirrored in
	 * `features/chat/session-status/session-context.ts`. A single row naming
	 * one of them would leave the other two unmeasured, which is the same
	 * "green output about a component nobody listed" this section warns about,
	 * one level down.
	 *
	 * Only `elevated` is asserted, and that is not laziness: the wheel has
	 * exactly one mount site, inside `COMPOSER_BOX`, which is `bg-elevated`
	 * (chat redesign §G1; `STRUCTURAL_CALL_SITES` pins the class string).
	 * Listing grounds it never renders on would be asserting a pairing the
	 * design does not promise.
	 */
	/*
	 * `ink: "inkMuted"` on all four rows, while the inert reading and the
	 * `estimate` marker render `inkDim`. That is not a coverage hole: `inkDim`
	 * is asserted against every ground at the text floor by the role loop above,
	 * so the pairing IS measured - just not from here. Noted rather than
	 * duplicated, because a fifth row asserting a pair another loop already
	 * covers is a second place to update when the token moves (review round 1,
	 * R5).
	 */
	{
		name: "context wheel, calm reading",
		on: ["elevated"],
		fill: null,
		border: "info",
		ink: "inkMuted",
	},
	{
		name: "context wheel, worth noticing",
		on: ["elevated"],
		fill: null,
		border: "warning",
		ink: "inkMuted",
	},
	{
		name: "context wheel, compaction due",
		on: ["elevated"],
		fill: null,
		border: "danger",
		ink: "inkMuted",
	},
	{
		/*
		 * The reading buttons' hover state, which is the ONLY place `accentWash`
		 * is a ground for text in the app.
		 *
		 * Round 2 deleted the empty-wheel row for the right reason (it asserted a
		 * structural floor on a decorative line), but that row was carrying two
		 * assertions and only one was replaced: `PERCEPTIBLE` measures the ring
		 * against `accentWash`, and nothing was left measuring INK against it
		 * (reviewer round 3, M1). `READING_BUTTON` is
		 * `hover:bg-accent-wash hover:text-ink`, so the pairing is reachable in
		 * all twelve themes. It passes today; this row is what keeps a future
		 * token move from breaking it silently.
		 */
		name: "reading button, hovered",
		/*
		 * BOTH GROUNDS, and the second one is the point (design review round 2, D8's
		 * contract note): `READING_BUTTON` is worn by the composer's status row as well as
		 * by the session readings, and that row paints on `canvas` — measured
		 * `(21,19,14)` dark / `#f5f0e6` light, identical to the far page margin — while
		 * this row asserted `surface` alone. The pairing is reachable on both, and the
		 * fill's perceptibility on `canvas` is what the designer computed by hand
		 * (ΔE00(accentWash, canvas) = 13.33 dark / 6.75 light); here it is asserted rather
		 * than computed once, so a token move cannot break it silently.
		 */
		on: ["surface", "canvas"],
		fill: "accentWash",
		border: "accent",
		ink: "ink",
	},
	/*
	 * The empty wheel has NO row here, and its absence is the statement.
	 *
	 * Round 1 listed it with `border: "inkDim"` to clear the 3:1 structural
	 * floor on `surface` and the `accentWash` hover. That passed, and it was
	 * the wrong assertion: it treated a decorative line as a control boundary,
	 * which made the empty ring an INK where the populated track is a GROUND -
	 * 4.4-5.6x heavier, ΔE00 38.6-53.8 apart, one component with two identities
	 * (design round 2, D7).
	 *
	 * The ring is now `hairline` when empty, and § 2's decorative rule is that a
	 * hairline owes perceptibility rather than a contrast floor. A floor row
	 * here would re-assert the thing that was wrong. What replaces it is
	 * `PERCEPTIBLE` below, which measures ΔE00 on both grounds AND pins the two
	 * states to one weight - the property D7 was actually about, and one no
	 * pair-or-triple row can express.
	 */
	/*
	 * The console terminal's own well (design 9.4: the pane's chrome is the app's,
	 * and the terminal's ground is one of the app's roles).
	 *
	 * A ROW OF ITS OWN BECAUSE IT HAS BOTH A FILL AND A BORDER, which is what
	 * `AGENTS.md` asks for: the terminal's ground is `sunken` - the same ground the
	 * code editor takes - and `sunken` against the pane's `surface` measures
	 * 1.00-1.03:1 across the palettes, so the ground step alone is NOT a boundary.
	 * The mirror is therefore bounded by `border-control`, and this row is what says
	 * so: the ink the terminal paints sits on a ground that meets the text floor, and
	 * the box around it has a perceivable edge (worst `borderControl` on `surface` is
	 * 3.26:1 in `catppuccinMocha`).
	 *
	 * WHAT IT CANNOT SEE, in this file's own words: the terminal's 16 ANSI colours
	 * are the PROGRAM's palette, resolved at paint from the roles
	 * `terminal-theme.ts` maps them to. This measures the roles; a program's own
	 * `\x1b[38;2;...m` truecolor passes through untouched and is looked at by a
	 * human in the design round's frames (§9.3).
	 */
	{
		/*
		 * THE SELECTION, and it is a row of its own because UX round 3 found it was
		 * covered by nothing: `selectionBackground` was `accentWash`, which the terminal
		 * paints on its own `sunken` ground, and that pair measures **1.11:1** — a
		 * selection a reader cannot see, in the round that wired copy. `accentWash` is a
		 * hover tint by the contract's own words and not a selection ground; the
		 * selection is now `accent` with `onAccent` as its ink, so this row asserts both
		 * halves the finding is about: the fill is perceivable against the terminal's
		 * ground (the 3:1 boundary floor, through the fill) and the selected text is
		 * legible on it (the 4.5:1 text floor).
		 */
		name: "console terminal selection",
		on: ["sunken"],
		fill: "accent",
		border: "accent",
		ink: "onAccent",
	},
	{
		name: "console terminal well",
		on: ["surface"],
		fill: "sunken",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * A device node on the Mesh tab's canvas (`mesh-node.tsx`).
		 *
		 * THE GROUND IS `sunken`, because the canvas is a well: the topology is drawn
		 * inside one recessed region rather than on the page. The node's boundary is
		 * `border-control`, and the number that decides it is this file's own CONTROLS
		 * floor: the edge measures 3.92:1 against the node's `elevated` fill on
		 * `localOperatorLight` and 3.30:1 on `localOperatorDark`, above the 3:1 a control
		 * owes, and the fill's own step off the well (`elevated` on `sunken`) adds ΔE00
		 * 6.85 / 7.71 beside it.
		 *
		 * CORRECTED IN REVIEW ROUND 1 (D1). This row shipped claiming `hairline` on
		 * `elevated` measured ΔE00 1.44 / 1.23, "below the field floor"; re-measured with
		 * this repository's own `deltaE` that pair is **9.19 / 4.80**, i.e. the hairline is
		 * visible, and no role pair in either palette measures 1.44. The edge is right; the
		 * number that justified it was not, and the frames agree with the corrected one.
		 *
		 * The stripe carries REACH, not `state` (mesh redesign, design round's D2): `hairline`
		 * at rest and for the two neutral states (`not-attempted` - the app never dialled -
		 * and `unknown` - no read named it), `warning` when the device was asked and did not
		 * answer, `danger` for a suspect identity, which outranks every probe result. The
		 * stripe used to be keyed on `state`, which painted a device nobody had dialled the
		 * amber of `unreachable`. THIS DEVICE IS A RING RATHER THAN A STRIPE (design round
		 * 1, D6) - `ring-2 ring-accent` - so identity and status are different channels
		 * instead of the accent sharing the stripe the anomalies spend. The ink edge a
		 * selected node takes is state too, measured as ink on this fill, already above its
		 * floor.
		 */
		name: "mesh device node",
		on: ["sunken"],
		fill: "elevated",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * THE SETUP WINDOW'S RAIL, and the row is here because the surface was
		 * unlisted when it mattered (design round 2, D7): the palette half of the
		 * working ring's stroke was always legal, while the CLASS picked the faintest
		 * token in the system - and "green output on an unlisted component is not
		 * evidence about that component" is this file's own warning.
		 *
		 * The rail's three ring markers - the waiting ring, the running step's
		 * marker, and the head mark, the last two being one object - are strokes
		 * with no fill, so their boundary IS the token this row asserts:
		 * `borderControl` against `canvas`, measured 3.13-3.42:1 light /
		 * 3.49-4.00:1 dark on the committed frames. The working marks shipped in
		 * `hairline` and measured 1.22-1.50:1 there - ~2.8x below the rings that
		 * mean "not yet", the faintest object in the column - which is the pair
		 * this row would have failed; the class strings are pinned beside it in
		 * `STRUCTURAL_CALL_SITES` so the token the component picks cannot regress
		 * silently either.
		 *
		 * `ink` is the rail's label (`text-ink` on `canvas`); the markers paint no
		 * text themselves. The accent quadrant and the finished dot spend `accent`
		 * on this ground, the same fill pair the `primary button` row asserts.
		 */
		name: "installer rail ring markers",
		on: ["canvas"],
		fill: null,
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The Mesh canvas's scope layer: the SOLID enclosure around a group of devices whose
		 * published addresses support a claim (`mesh-scope-layer.tsx`).
		 *
		 * WHY THE SOLID TIER NEEDS A ROW AND THE DASHED ONE DOES NOT. The two tiers must not
		 * be told apart by hue, so the difference is the DASH - and that makes the solid
		 * enclosure the only visual marker of a verified grouping, i.e. its removal loses
		 * information. It is therefore structural and takes `border-control` rather than the
		 * decorative `hairline` the dashed tier uses; the dashed tier spends `hairline`
		 * (no floor, decoration) and its `ink-dim` label is measured by this file's ink
		 * floors already (`inkDim` on `sunken` is 5.00:1 at worst, `rosePineDawn`).
		 *
		 * The enclosure has NO FILL - it is a frame around nodes that keep their own
		 * `elevated` fill - so `fill: null` makes the ink assertion "this file's label ink on
		 * the ground it is drawn on", which is what the tier's label is: on `sunken`, beside
		 * the frame, never on a control's own fill.
		 *
		 * MEASURED across the 59 palettes: the edge (`borderControl` on `sunken`) is 4.14:1 on
		 * `localOperatorDark` and 3.20:1 on `localOperatorLight`, 3.01:1 at worst
		 * (`rosePineDawn`) - above the 3:1 a boundary owes. The label (`inkMuted` on `sunken`)
		 * is 9.08 / 7.18, 5.53:1 at worst (`kanagawaLotus`), above its own floor.
		 */
		name: "mesh scope boundary (solid)",
		on: ["sunken"],
		fill: null,
		border: "borderControl",
		ink: "inkMuted",
	},
	/*
	 * THE CODE REVIEW PANE'S STATE PILL (built spec §3, §12): the `Badge` variant
	 * the row's right edge carries for the forge's own state - the state never
	 * truncates, so it is a control's claim in a label's box.
	 *
	 * FOUR ROWS, one per variant, because the VARIANT is the state. The grounds
	 * are the row's two: `elevated` at rest, `surface` under the pointer (the
	 * row button's own hover step since remediation round 1 - the run-detail
	 * rows' token; it replaced `rowHover`, whose 1.001:1 step was the UX round's
	 * U4 finding). MEASURED across the 59 palettes: every ink clears its own
	 * fill (`info` on `infoWash` 4.60:1 at worst, kanagawaLotus; `success` on
	 * `successWash` 4.53:1, everforestLight; `ink` on both grounds far above its
	 * floor), and on `surface` every edge clears the 3:1 floor in every palette
	 * - the twelve `CONTROL_EDGE_PINNED` entries this row used to need on
	 * `rowHover` (2.949-2.998 raw) were deleted once the ground moved and the
	 * run proved they were never consulted again. A design round that wants a
	 * floored boundary rather than this step has a role change to make; no pin
	 * stands here today.
	 */
	{
		name: "code review state pill (open)",
		on: ["elevated", "surface"],
		fill: "infoWash",
		border: "infoBorder",
		ink: "info",
	},
	{
		name: "code review state pill (merged)",
		on: ["elevated", "surface"],
		fill: "successWash",
		border: "successBorder",
		ink: "success",
	},
	{
		name: "code review state pill (draft)",
		on: ["elevated", "surface"],
		fill: null,
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The CLOSED record's pill is the shared `Badge`'s `neutral` variant
		 * (`border-hairline bg-sunken text-ink-muted`), and its boundary is
		 * declared DECORATIVE on purpose: the hairline is § 2's decorative rule
		 * (no contrast floor owed), the `sunken` step under it measures
		 * 1.04-1.34:1 across the fleet, and a closed record is the one state this
		 * pane states quietly - the load-bearing claim is the INK floor
		 * (`inkMuted` on `sunken` 5.53:1 at worst, kanagawaLotus), and the
		 * boundary is the same quiet-mark register as the rail's `attentionQuiet`
		 * count. `edge: false` records that decision rather than muting a
		 * measurement nobody took: the step and the hairline are both under any
		 * boundary floor, and no amount of pinning would make them a boundary.
		 */
		name: "code review state pill (closed)",
		on: ["elevated", "surface"],
		fill: "sunken",
		border: "hairline",
		ink: "inkMuted",
		edge: false,
	},
	/*
	 * THE LIBRARY SURFACE (desktop UI, 2026-10-18). Four triples the feature
	 * actually paints, registered because role reuse alone is not proof: the
	 * card's metadata sits on `surface` over the page's `canvas`, the thumbnail
	 * well is `sunken` with a kind glyph, the origin badge is an opaque
	 * `elevated` mark on the card, and the composer is an `elevated` field on
	 * the preview's `canvas`. The card and composer have no edge at rest (the
	 * hairline is decorative); the badge's edge is declared away for the same
	 * reason the team avatar's is - its fill merges with a card ground on some
	 * palettes, so the letters' own floor is the boundary that matters.
	 */
	{
		name: "library card",
		on: GROUNDS,
		fill: "surface",
		border: null,
		ink: "ink",
		edge: false,
	},
	{
		name: "library card secondary",
		on: ["surface"],
		fill: "surface",
		border: null,
		ink: "inkDim",
		edge: false,
	},
	{
		name: "library thumbnail well",
		on: ["surface", "canvas"],
		fill: "sunken",
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	{
		name: "library origin badge",
		on: ["surface", "sunken"],
		fill: "elevated",
		border: null,
		ink: "inkMuted",
		edge: false,
	},
	{
		name: "library composer field",
		on: ["canvas", "surface"],
		fill: "elevated",
		border: null,
		ink: "ink",
		edge: false,
	},
];

/**
 * Pairs where BOTH sides are foreground roles, so neither is the ground.
 *
 * `CONTROLS` can only express ink-on-fill and edge-against-ground. That is the
 * right shape for a button, and it cannot state the one boundary a dial is made
 * of: the arc against its own TRACK. Round 1 added four `CONTROLS` rows for the
 * context wheel, all of which passed, and none of which measured that pair -
 * which is how an arc at 1.05:1 against its track shipped behind a green gate
 * (design round 1, D1). § 3 says it in the file's own words: green output about
 * a pairing nobody listed is not evidence about that pairing.
 *
 * Listed at the STRUCTURAL floor, because this is an edge that carries meaning
 * by position rather than text that has to be read.
 */
export const ADJACENT = [
	{
		/*
		 * The populated ring only. With no arc the track is measured against the
		 * ground instead, by the `no reading yet` row above - the component
		 * switches its track role with its state precisely because no single
		 * value clears 3:1 from both the arc and the composer ground (that would
		 * need ~9:1 between arc and ground; the best theme has 7.33:1).
		 */
		name: "context wheel arc against its track",
		a: ["info", "warning", "danger"],
		b: "sunken",
		floor: FLOOR.nonText,
	},
];

/**
 * Graphic objects: a fill that carries meaning and holds no text.
 *
 * `CONTROLS` is the wrong table for these and listing them there asserted two
 * things that are not true of them. A control's row demands its INK clear 4.5:1
 * on its own fill — a quota bar paints no text on itself, so that assertion is
 * about a pairing that never renders — and it demands the control's EDGE clear
 * 3:1, which is the floor for something the user operates. A status dot and a
 * meter fill are read, not operated, and WCAG's 3:1 non-text floor applies to
 * the object against what is behind it, which is exactly what this table says.
 *
 * They are listed because `AGENTS.md` is explicit that green output about an
 * unlisted component is not evidence about that component, and the `/usage`
 * view introduced two graphic objects the file had no row for: the bar fill
 * (`h-1`) and the status dot (`size-1.5`). Both are below the size at which the
 * ink floors apply and neither was measured by anything before this.
 *
 * The three semantics are listed SEPARATELY rather than as one row, because a
 * set of semantics that passes on average is not a set of semantics.
 */
export const GRAPHICS = [
	{
		/*
		 * THE SELECTED RAIL ROW'S GLYPH (contract C4): the kind glyph (`#`,
		 * people, `@`) in `accent` on `rowSelected`, the Settings navigation's
		 * local exception extended to the Team Bridge rail. 4.24:1 worst
		 * (tokyoNight) - a 16px glyph, so the 3:1 non-text floor.
		 */
		name: "team bridge selected rail glyph",
		on: ["rowSelected"],
		fg: "accent",
	},
	{
		/*
		 * Team Bridge's agent plate draws a Bot GLYPH, not a text initial, so
		 * this is the 3:1 icon-on-fill pair rather than a control-label row.
		 * Its fill's separation from the hovered row is asserted below.
		 */
		name: "team bridge agent plate glyph",
		/* `accentAltWash` is the plate's fill since the visual refresh (agent
		   review round 1, m4b); `mediaSurface` is kept for the account plate. */
		on: ["mediaSurface", "accentAltWash"],
		fg: "accent",
	},
	{
		/*
		 * THE AGENT MARK'S OWN BOUNDARY (design review round 2, D3). The plate
		 * carries a corner notch in `accent` — the mark that survives a picture —
		 * and nothing measured it: a `bg-accent` -> `bg-hairline` edit, or a plate
		 * fill moved off `mediaSurface`, would have left every row green while the
		 * mark flattened into the plate.
		 *
		 * The floor is the MEASURED worst case, not the 3:1 non-text floor it
		 * clears with room: across the 59 palettes accent against `mediaSurface`
		 * bottoms at 4.17:1 (`catppuccinLatte`), then 4.26 (`tokyoNightDay`,
		 * `oneLight`), 4.27 (`githubLight`), 4.29 (`localOperatorLight`, 4.23 as
		 * rendered); median 7.27, max 17.11. 4.0 is half a step below the worst so
		 * a palette edit that eats the margin fails here rather than silently
		 * becoming the smallest mark in the app. The class string itself is pinned
		 * by the `data-agent-mark` call-site row below, and the glyph's ink stays
		 * the row above.
		 */
		name: "team bridge agent mark (corner notch)",
		/* `surface` as well as `mediaSurface`: a SELECTED rail plate paints
		   `bg-surface` and still carries the mark (round 3, D3/F9). Worst on
		   `surface` today is 4.98:1, so the row was a coverage gap rather than a
		   failure. */
		on: ["mediaSurface", "surface", "accentAltWash"],
		fg: "accent",
		floor: 4.0,
	},
	{
		/*
		 * The completion mark on a follow-up turn bar (`turn-summary.tsx`'s
		 * `CircleCheck`): `success` ink drawn straight on the transcript's canvas,
		 * the pair the checkpoint rail already paints for `complete`.
		 */
		name: "turn bar complete mark",
		on: ["canvas"],
		fg: "success",
	},
	{
		/*
		 * THE RUNNING LANE (`chat-session-status.tsx`'s `BackgroundWorkLane`,
		 * 2026-11-07), which replaced the running-subagent trio of #840: a static
		 * 10x2px accent bar under the status cell (or the avatar) of every sidebar
		 * row whose session still has background work - a subagent, a job, a wait.
		 * It is a graphic object, read at a glance and never operated, so it owes the
		 * SC 1.4.11 3:1 non-text floor against what is behind it.
		 *
		 * THE GROUNDS are the three a sidebar row paints: the panel's `surface`, and
		 * `rowSelected` / `rowHover` (`chat-sidebar.tsx`'s `rowStyle`/`rowCurrent`).
		 * Nothing paints the lane on `canvas` or `elevated`.
		 *
		 * THE INK IS `accent`, the liveness role the `busy` spinner spends and the
		 * trio wore, so the pair is unchanged; it is stated rather than inherited
		 * because a 2px bar has even less to read by than the beads did. Designer's
		 * measurement: localOperatorLight 5.14 / 4.74 / 4.53, localOperatorDark
		 * 7.33 / 6.91 / 6.61 (surface / hover / selected), worst palette duskfox on
		 * rowSelected 4.43:1 - all above the floor.
		 */
		name: "session row running lane",
		on: ["surface", "rowSelected", "rowHover"],
		fg: "accent",
	},
	{
		/*
		 * THE SHARED SPINNER'S TRACK (`spinner.tsx`'s ring - the app's one
		 * indeterminate-progress affordance, dropped onto every ground). Design round 1 on
		 * the composer's acknowledgment measured this pair while the track was the
		 * decorative `hairline`: 1.23:1 dark and 1.44:1 light, i.e. the whole visible
		 * shape of a progress indicator below the floor. The track is `borderControl`
		 * now, and this row is what holds it there. It is HERE rather than in
		 * `CONTROLS` because that table's outline-control row states the same VALUE as a
		 * CONTROL's boundary - a different claim about it - and this file's own note on
		 * the context wheel says what a green gate about an unlisted pairing is worth.
		 */
		name: "spinner track against its ground",
		on: GROUNDS,
		fg: "borderControl",
	},
	...["success", "warning", "danger"].map((role) => ({
		name: `usage bar fill (${role})`,
		/* Drawn inside the track, which is `sunken`. */
		on: ["sunken"],
		fg: role,
	})),
	...["success", "warning", "danger"].map((role) => ({
		name: `usage status dot (${role})`,
		/* The dot sits on the provider block's own card. */
		on: ["surface"],
		fg: role,
	})),
	...["success", "warning", "danger", "info", "inkDim"].map((role) => ({
		/*
		 * Settings > Integrations' row status dot (`integration-row.tsx`). Five
		 * inks: the four states that mean something, plus `inkDim` for Ready,
		 * which is present but asks for nothing. Ready was first drawn in
		 * `borderControl` (the design audit's spec) and this row refused it:
		 * 2.77-2.96:1 on `rowSelected` in eleven palettes. The dot is always paired
		 * with the status words, so it carries no meaning by colour alone, but it
		 * is still a graphic object read at a glance and owes the 3:1 floor.
		 *
		 * Two grounds, because the row has two: the list's own `surface` card, and
		 * `rowSelected` when a `/mcp <name>` deep link revealed it (design D14
		 * moved that highlight off `border-accent` onto this role). A row listing
		 * only `surface` would be blind to exactly the frame the deep link makes.
		 */
		name: `integration status dot (${role})`,
		on: ["surface", "rowSelected"],
		fg: role,
	})),
	{
		/*
		 * The provider row's overflow trigger while its panel is open
		 * (`provider-grid.tsx`): a ghost, icon-only button that paints
		 * `bg-control` in that state, so its glyph rides on `borderControl`
		 * rather than on the row behind it. It shipped with the ghost's own
		 * `text-ink-muted` for an ink -- 59/59 palettes below the 3:1 floor on
		 * that fill (2.19:1 by token, 2.02:1 in the rendered frame). `ink` is not
		 * a remedy either (30/59 below, worst 1.87:1); `onAccent` clears the
		 * floor in every palette (worst 3.53:1) and is what the component now
		 * paints. Listed because this is exactly the case AGENTS.md warns about:
		 * the green run said nothing about a state no row described, which is how
		 * it shipped (design round 6, D1).
		 */
		name: "provider row overflow trigger glyph (open)",
		on: ["borderControl"],
		fg: "onAccent",
	},
	{
		/*
		 * The checked mark's dot in the onboarding search step's mode option
		 * (`search-api-step.tsx`: a `size-2` `bg-on-accent` dot inside the
		 * `accent` fill). A graphic object on a FILL rather than a theme ground,
		 * the same shape as the overflow trigger's glyph row above; the unchecked
		 * ring needs no row of its own because `borderControl` is asserted across
		 * `GROUNDS` by `CONTROLS`' outline-control row. Listed because the option's
		 * selection is carried by this mark as well as by the ground step (design
		 * round 1, D2), and no row described it.
		 */
		name: "search setup mode mark dot (checked)",
		on: ["accent"],
		fg: "onAccent",
	},
	...["danger", "info"].map((role) => ({
		/*
		 * The run pane's trigger dot, which gained a second ink
		 * (`docs/composer-activity-chips.md` § 5): `danger` for the failure ledgers,
		 * `info` for a session working while the pane does not show it. It hangs off a
		 * ghost button in the chat header, and that button has TWO grounds: it paints
		 * none at rest, and it fills with `accentWash` while pressed
		 * (`run-details-trigger.tsx`).
		 *
		 * Both are asserted, and the second one arrived with a review finding rather
		 * than with the ink (agent review round 1, n1): the dot's `-top-0.5 -right-0.5`
		 * leaves about 6 of its 8px inside the button's box, so the pressed state — the
		 * state where `info` is actually drawn, because a pressed trigger means the
		 * pane is open over a live child — put the ink on the wash, not on the canvas.
		 * The first version of this row named `canvas` alone and was therefore blind
		 * exactly where the new ink lives.
		 *
		 * Listed because it was NOT: `AGENTS.md` is explicit that green output about
		 * an unlisted component is not evidence about that component, and this object
		 * has carried `danger` since the pane was a popover with no row here — so the
		 * file was blind to both inks and this change would have added a second
		 * unmeasured one. The two are separate rows for the reason the usage dots are:
		 * a set of semantics that passes on average is not a set of semantics.
		 */
		name: `run panel trigger dot (${role})`,
		/*
		 * THE TRIGGER MOVED TO THE PANEL RAIL (#872), so its grounds moved with it:
		 * the rail is `surface`, and the lit item is `rowSelected` (the dot hangs
		 * 2px past a 32px control, with ~6px of its 8 inside the box, so the lit
		 * ground is where the `info` ink is drawn - the pane is open over a live
		 * child) and `rowHover` under the pointer. `canvas` and `accentWash` stay:
		 * the Storybook harnesses and the docs library still draw the trigger's dot on
		 * those, and a row that dropped a ground the product no longer uses but a
		 * rig still does would be blind exactly there.
		 */
		on: ["canvas", "accentWash", "surface", "rowSelected", "rowHover"],
		fg: role,
	})),
	{
		/*
		 * THE PANEL RAIL'S LIT STATE (#872): the glyph and the 2px bar a lit item
		 * wears. The glyph is `accent` on the sidebar's selected-row ground
		 * (`rowSelected`) and, because the ghost item keeps its ground under a resting
		 * pointer, on `rowHover` too; it is a GRAPHIC, so the 3:1 non-text floor is the
		 * claim (a 16px outline icon, no text). The bar is `accent` on the rail's own
		 * `surface`: it is the item's non-colour second signal, which exists because
		 * an icon-only rail has no weight to change the way the sidebar's rows do, so
		 * it is the one mark that must survive a theme whose `rowSelected` sits close
		 * to `surface` - which is exactly why it is asserted against `surface` and not
		 * against the fill it accompanies.
		 *
		 * ROUND 2 (R8), restated when the rail's hairline came out: the bar no
		 * longer stands beside the control on the rail's ground. Design round 1
		 * (D2/D7) moved it to the rail's leading edge so it clears the focus
		 * ring, which puts its outer edge against the PANE's ground: `elevated`
		 * (the browser, console, run and asks slots) or `canvas` (when no pane is
		 * open, the conversation column). Those two are listed so a palette whose
		 * `accent` sits close to either fails here and not on screen. A `PanelEdge`
		 * seam sits between the rail and the pane again (2026-10-30), and the bar
		 * paints above it (`before:z-25` over the seam's `z-20`), so the bar's outer
		 * pixel is `accent` against the pane's ground - the pair listed here - and
		 * not the seam's 75% blend (design review round 1, D2).
		 */
		name: "panel rail lit glyph and bar",
		on: ["rowSelected", "rowHover", "surface", "elevated", "canvas"],
		fg: "accent",
	},
	{
		/*
		 * THE PANEL RAIL'S IDLE GLYPH (#872): `inkMuted` on the rail's `surface`, and
		 * on `rowHover` while the pointer is on it (the hover step takes the ink to
		 * `ink`, which the INKS x GROUNDS loop already covers). The glyph is the
		 * item's whole label, so this is the pair that decides whether a closed
		 * panel's door can be found at all.
		 */
		name: "panel rail idle glyph",
		on: ["surface", "rowHover"],
		fg: "inkMuted",
	},
	{
		/*
		 * The console's blip and the canvas's files dot, which moved from the header
		 * (`canvas`) to the rail (#872): `accent` while a completion is fresh,
		 * `inkMuted` once it rests, and `inkMuted` for the files dot. Both are
		 * 6px graphics on the item, so they sit on `surface` at rest, `rowHover`
		 * under the pointer and `rowSelected` when the item is lit (the files dot
		 * stays drawn while the canvas is open).
		 */
		name: "panel rail console blip and files dot (inkMuted)",
		on: ["surface", "rowHover", "rowSelected"],
		fg: "inkMuted",
	},
	{
		name: "panel rail console blip (accent)",
		on: ["surface", "rowHover", "rowSelected"],
		fg: "accent",
	},
	{
		/*
		 * The dot for an unmeasurable window, and the dotted rule beside it.
		 *
		 * Both are `inkDim`, and both are information-bearing rather than
		 * decorative: the rule is the WHOLE distinction between "this window
		 * reports nothing" and "this window is at zero", which by § 2's own test
		 * ("would removing it lose information?") makes it structural and puts it
		 * on the 3:1 floor. It shipped in `inkDisabled` — the one role exempt
		 * from any floor — measuring 2.00:1 on card in `localOperatorLight`,
		 * i.e. two thirds of the floor it needed.
		 */
		name: "usage unmeasured mark",
		on: ["surface"],
		fg: "inkDim",
	},
	{
		/*
		 * The checkpoint rail's marks (`checkpoint-model.ts` holds the role
		 * map the rail paints; design D5, dsh rework 2026-09-29).
		 *
		 * A mark that is ALSO a control: each tick is a 3px bar inside a 24x12
		 * invisible hit target, and it has to be findable at a glance — the rail
		 * is the transcript's whole checkpoint navigation — while carrying no
		 * label of its own, so there is no ink-on-fill pair for a `CONTROLS` row
		 * and no edge to assert either. `inkDim` clears the graphic floor on
		 * `canvas`, and the hover/focus step to `ink` needs no second row: it is a
		 * role on a ground, one of the INKS x GROUNDS pairs asserted above. The
		 * row is here because the role a mark PAINTS is the thing no palette
		 * assertion can see — the "usage unmeasured mark" precedent directly
		 * above: that mark shipped in the floor-exempt `inkDisabled` while sitting
		 * under a green run.
		 */
		name: "checkpoint rail tick",
		on: ["canvas"],
		fg: "inkDim",
	},
	/*
	 * The panel share meter's fill, drawn inside the same `border-control` track
	 * `/usage` uses (its geometry is a port of that meter, one primitive instead
	 * of one per panel). It is a fill that carries meaning — the length IS the
	 * datum — so it sits on the graphic-object floor rather than being read as
	 * decoration.
	 */
	{
		name: "panel proportion fill (accent)",
		on: ["sunken"],
		fg: "accent",
	},
	/*
	 * The one chart hue. The frame draws bars on the panel's own ground (a chart
	 * is a region, not a card), and `accent` is the only series colour the design
	 * permits: a second series colour would need a semantic the contract has no
	 * row for, which is why breakdowns are many rows of single-hue bars.
	 */
	{
		name: "panel chart bar (accent)",
		on: ["surface"],
		fg: "accent",
	},
	{
		/*
		 * The link toolbar's own ION: the icon in a hovered action button, which is
		 * `hover:bg-accent-wash hover:text-accent` on `button.tsx`'s ghost variant.
		 *
		 * A graphic object rather than a control triple, and the difference is the
		 * whole reason this row, is here. The hovered button paints a wash and a NEW
		 * ink, and it paints no edge: `accentWash` against the strip's own `elevated`
		 * measures 1.00-1.38:1 across the twelve palettes, so a `CONTROLS` row asking
		 * for its fill or border to clear 3:1 could only pass by inventing an edge the
		 * design does not have - and a hover that grows a border is a state change,
		 * not the colour step § 2 permits.
		 *
		 * What a hovered ICON owes is being legible against the wash it sits on, which
		 * is exactly what `GRAPHICS` asserts: `accent` on `accentWash` measures
		 * 4.53-14.47:1, clear of the 3:1 non-text floor in every palette. The RESTING
		 * ink (`inkDim` on `elevated`) needs no row of its own: it is a role on a
		 * ground, and `INKS` asserts it on all four at the text floor (worst 4.51:1,
		 * obsidian) - the same argument the context-wheel rows already make for not
		 * repeating a pairing another loop covers.
		 */
		name: "link toolbar action icon (hovered)",
		on: ["accentWash"],
		fg: "accent",
	},
	{
		/*
		 * The search overlay's ACTIVE result row: the 2px accent bar on its
		 * leading edge.
		 *
		 * The same pairing the link toolbar's row above asserts (`accent` on
		 * `accentWash`, 4.53:1 at worst), listed under its own name because it is
		 * a new component's mark and this file's rule is that green output about
		 * a component nobody listed is no evidence about that component. The bar
		 * is what distinguishes the row Enter opens from the pointer's own tint
		 * on the ground where the wash alone cannot.
		 */
		name: "search result active bar (accent)",
		on: ["accentWash"],
		fg: "accent",
	},
	/*
	 * THE CODE REVIEW PANE'S ROUND MARKS (built spec §2): the segmented strip
	 * beside each lane, one segment per review round, drawn on the row ground
	 * (`elevated` at rest, `rowHover` under the pointer) with the lane's latest
	 * state as its tone.
	 *
	 * THREE FILLS AND ONE OUTLINE. `warning` (findings open), `inkMuted`
	 * (remediation posted) and `success` (clean/terminal) clear the 3:1 graphic
	 * floor on both grounds fleet-wide (4.52:1 at worst, rosePine's `success` on
	 * `elevated`). `borderControl` - the mark for "a round happened, nothing
	 * stated" - clears `elevated` (3.006:1 at worst, catppuccinMocha) and sits
	 * just under on `rowHover` in five palettes (2.918-2.998 raw), each pinned in
	 * `EXCEPTIONS` with its measurement. The outline tone is what the design's
	 * "claims nothing" state calls for: a border-only mark is the one that
	 * cannot be read as a verdict.
	 */
	{
		name: "code review round mark (findings open)",
		on: ["elevated", "surface"],
		fg: "warning",
	},
	{
		name: "code review round mark (remediation posted)",
		on: ["elevated", "surface"],
		fg: "inkMuted",
	},
	{
		name: "code review round mark (clean)",
		on: ["elevated", "surface"],
		fg: "success",
	},
	{
		name: "code review round mark (verdict not stated)",
		on: ["elevated", "surface"],
		fg: "borderControl",
	},
];

/**
 * Decorative lines, and states of one component that must stay one component.
 *
 * Two assertions neither `CONTROLS` nor `ADJACENT` can make.
 *
 * **Perceptibility, not contrast.** § 2 makes `hairline` the decorative rule
 * and § 3's floors govern controls and text. A decorative line that owes 3:1
 * is a control wearing a hairline's name - which is exactly how round 1 put
 * the empty context ring on `inkDim` and passed. What a hairline owes is being
 * SEEN, measured as ΔE00 against every ground it renders on, at the
 * perceptual threshold § 3 already cites.
 *
 * **Weight parity.** One component in two states must not change weight
 * enough to read as two components. The empty ring was 4.4-5.6x heavier than
 * the populated track and ΔE00 38.6-53.8 from it, so the instrument lost about
 * three quarters of its weight at the moment it gained a reading (design round
 * 2, D7). No pair-or-triple row can state that, because both sides are the
 * same element at different times.
 */
export const PERCEPTIBLE = [
	{
		/*
		 * THE IDENTITY PLATE'S EXTENT (design round 1, D1 on #1668). The Team
		 * Bridge person/agent disc is borderless `accentAltWash`, so this step IS
		 * its boundary on every ground a plate rests on: the rail and thread pane
		 * (`surface`), the timeline (`canvas`), a hovered row or option
		 * (`rowHover`), a popover (`elevated`). 3.0 is the floor the `mediaSurface`
		 * plate it replaced was held to. Eight palettes were lifted on L* (hue and
		 * chroma held) to clear it; their comments carry the before/after.
		 */
		name: "team bridge identity plate wash",
		role: "accentAltWash",
		on: ["canvas", "surface", "elevated", "rowHover"],
		minDeltaE: 3.0,
	},
	{
		/*
		 * The no-border replacement for the message avatar's ring: this is the
		 * assertion the old `border-control` was standing in for. In particular,
		 * `rowHover` is a STATE ground, not a rung of the elevation ladder. The
		 * media role's canvas floor alone would not prove that a hovered message
		 * still shows its avatar.
		 *
		 * THE FLOOR IS THE FILE'S PERCEPTUAL ONE (review round 1, M3: this row shipped
		 * at 1.5, weaker than every sibling). The measured minima across 59 palettes
		 * (re-measured after the darker grounds, #1658) are `canvas` 4.00
		 * (ayuMirage), `surface` 5.81 (obsidian), `elevated` 7.60 (rosewood) and
		 * `rowHover` 3.70 (iceberg). The row used to quote 3.70 as THE
		 * worst case; 3.70 is the worst of the hosts a plate actually rests on, and the
		 * true worst pairing the role reaches is 1.83 against `rowSelected` on the
		 * brand light palette - which is why a selected rail row takes `surface`
		 * instead, asserted by the row above.
		 *
		 * The rail's account plate (`user-profile-sidebar.tsx`) is the same fill
		 * on `surface` and `rowHover` since design review round 1 of the
		 * own-avatar change, D2; it replaced that plate's `border-control` ring.
		 *
		 * SINCE THE TEAM BRIDGE VISUAL REFRESH (2026-11-04, contract C2) the Team
		 * Bridge person and agent plates wear the identity washes instead - the
		 * "team bridge person/agent identity plate" CONTROLS rows - so this row now
		 * holds for the account plate and for the image wells and chips that still
		 * paint `mediaSurface`. The name is kept so its history stays findable.
		 */
		name: "team bridge borderless person and agent plates",
		role: "mediaSurface",
		/* NOT `rowSelected`: that host is where this fill bottoms out (1.83), and the
		   component does not paint a plate there - the selected rail row takes
		   `surface`, asserted by the sibling row above. Listing it here would be a
		   claim about a pairing the app never renders, and it would fail on the eight
		   palettes where the wash and the selection share a rung. */
		on: ["canvas", "surface", "elevated", "rowHover"],
		minDeltaE: 3.0,
	},
	{
		/*
		 * THE ATTACHMENT CHIP'S EXTENT (agent review round 1, minor 1): the chip is
		 * borderless, so its fill's step off each ground a message row paints IS
		 * its boundary, `rowHover` included. Same fill and floor as the plates
		 * above; fleet minima canvas 4.00 (ayuMirage), surface 5.81 (obsidian),
		 * rowHover 3.70 (iceberg), re-measured after the darker grounds (#1658).
		 * The kind tile inside it is `elevated`, 7.60 at worst off this fill
		 * (rosewood).
		 */
		name: "team bridge attachment chip",
		role: "mediaSurface",
		on: ["canvas", "surface", "rowHover", "elevated"],
		minDeltaE: 3.0,
	},
	{
		/*
		 * An option ROW inside the docked question card (§F1), under the pointer or
		 * holding the roving selection. The row draws no edge - the card's accent
		 * border bounds the set - so its state is a GROUND STEP on the card's
		 * `elevated`, and what it owes is being seen.
		 *
		 * `sunken`, not `row-hover`, and the reason is measured: `row-hover` is the
		 * list-row state tuned against `canvas`/`surface`, and against `elevated` it is
		 * ΔE00 0.00 on arcade and under 2.0 on four palettes - a hover nobody can see
		 * on exactly the card the agent is blocked on. `elevated` -> `sunken` is the
		 * step the browser tab strip already uses (the row below), ΔE00 6.07 at worst
		 * (iceberg). The label is `ink`, asserted at 7:1 on `sunken` by the ink loop.
		 */
		name: "question dock option row hover fill",
		role: "sunken",
		on: ["elevated"],
		minDeltaE: 5.0,
		pairedWith: "elevated",
		maxWeightChange: 2.0,
		against: "elevated",
	},
	{
		/*
		 * The onboarding search step's mode option rows (`search-api-step.tsx`):
		 * a control row whose selected state is `bg-sunken` on the dialog's
		 * `elevated` plus a filled mark, the same shape as the dock row above and
		 * the same floor. The mark's half is asserted by `GRAPHICS` below; this
		 * row owns the GROUND STEP, which is what the selection reads as at a
		 * glance (design round 1, D2 - measured 7.71 dark / 6.85 light on the
		 * brand pair when the row was added, but no theme was asserting it).
		 */
		name: "search setup mode option row selected fill",
		role: "sunken",
		on: ["elevated"],
		minDeltaE: 5.0,
		pairedWith: "elevated",
		maxWeightChange: 2.0,
		against: "elevated",
	},
	{
		/*
		 * THE PROVIDER LISTS AND THE EMPTY-CHAT CONNECT CARD (design audit
		 * section 2 and section 6): a `bg-surface rounded-[14px]` container with NO
		 * border, on the page's `canvas` (Settings, the empty chat). Here rather
		 * than in `CONTROLS` because it is not a control: elevation is a lightness
		 * step (`branding.md`), so the container owes being SEEN as one object,
		 * not a 3:1 edge. The controls inside it are the ordinary button rows
		 * `CONTROLS` already asserts on `surface`.
		 */
		name: "provider list / connect card container",
		role: "surface",
		on: ["canvas"],
		minDeltaE: 2.0,
	},
	{
		/*
		 * The same list inside a DIALOG (onboarding step 1, the connect dialog):
		 * `bg-surface` on the dialog's `elevated`, a step DOWN rather than up. Its
		 * own row because the pair differs and a list that vanished into the dialog
		 * would pass the row above.
		 */
		name: "provider list inside a dialog",
		role: "surface",
		on: ["elevated"],
		minDeltaE: 2.0,
	},
	{
		/*
		 * The row's monogram tile: `bg-elevated` two letters on the list's
		 * `surface`. A fill step behind `ink` text, which the `INKS` loop already
		 * asserts on `elevated`; this row asserts only that the tile reads as a tile.
		 */
		name: "provider monogram tile",
		role: "elevated",
		on: ["surface"],
		minDeltaE: 2.0,
	},
	{
		/*
		 * The device-code well: the code in mono on `bg-sunken` inside the
		 * `surface` panel. The code's ink is `ink`, asserted on `sunken` by the
		 * `INKS` loop; this row asserts the well is visible as one.
		 */
		name: "device code well",
		role: "sunken",
		on: ["surface"],
		minDeltaE: 2.0,
	},
	{
		/*
		 * THE HOVER STEP ON A BROWSER TAB, and why it is HERE rather than in
		 * `CONTROLS`. A hovered tab steps its fill to `elevated` on the strip's
		 * `sunken` and changes nothing else - no edge appears, because an edge that
		 * appears on hover is a state change rather than a colour step, and the design
		 * says hover is a colour step and only that (`branding.md` § "nothing lifts,
		 * scales or translates on hover"; spec §6's table). `CONTROLS` asserts the
		 * opposite shape - a control's fill OR border must clear 3:1 against its
		 * ground - and a fill step between two ADJACENT GROUNDS cannot: `elevated` on
		 * `sunken` measures 1.20-1.55:1 across the twelve palettes. Listing it there
		 * would either fail on a property the design deliberately does not have, or
		 * force an edge onto hover to satisfy a gate, which is the gate dictating the
		 * design.
		 *
		 * What a hover owes is being SEEN, which is this table's own question. Measured
		 * on the grounds this branch ships: ΔE00 6.07 at worst (`iceberg`), so the floor
		 * is 5.0 and the worst palette clears it by 1.07. The weight-parity half
		 * compares the hovered fill with the resting one, whose role IS the ground
		 * (`sunken`): the step is 1.19-1.60x either way, so `maxWeightChange` 2.0 states
		 * that hover is a step in one ramp rather than a different control.
		 *
		 * The hovered LABEL's legibility is already covered: `ink` is asserted at 7:1
		 * on every ground, `elevated` among them (the `INKS` loop above), which is
		 * where the hovered title is read.
		 */
		name: "browser tab hover fill",
		role: "elevated",
		on: ["sunken"],
		minDeltaE: 5.0,
		pairedWith: "sunken",
		maxWeightChange: 2.0,
		against: "sunken",
	},
	{
		/*
		 * THE TURN-ANSWER RAIL (`turn-answer-rail.ts`, opt-in `display.turn_answer_rail`):
		 * a 1px `border-hairline` rule beside the elected answer, on the transcript's
		 * `canvas`. It is decorative - the layout already identifies the answer - so
		 * it owes being SEEN rather than a 3:1 floor, and it is the quieter of the
		 * two roles that could carry it (#708 used `ink-dim` at 2px, which the
		 * operator found ugly).
		 *
		 * THE FLOOR IS 4.0, NOT THE PRESET THRESHOLD, and that is the design round's
		 * finding rather than taste: measured across all 59 palettes this pair is
		 * ΔE00 4.42 at its weakest (`rosePineDawn`, 1.20:1 - a rule a reader could
		 * take for a rendering artefact) and 9.39 at the median. A 3.0 floor would
		 * sit 1.4 BELOW the weakest palette that ships today, so it could not catch a
		 * palette drifting toward invisible - which is the only reason to write the
		 * row at all. 4.0 pins what ships with 0.42 of headroom and still leaves the
		 * step to be re-argued if a future palette cannot clear it (design round 1,
		 * D1).
		 */
		name: "turn answer rail",
		role: "hairline",
		on: ["canvas"],
		minDeltaE: 4.0,
	},
	{
		name: "context wheel track, empty state",
		role: "hairline",
		/* Both grounds the empty ring renders on: the composer, and the reading
		   button's hover fill. */
		on: ["surface", "accentWash"],
		/* § 3's own threshold for "a human can tell these apart". Set at 3.0
		   rather than 2.0 because a 1.75px stroke has far less area to carry the
		   difference than a filled region does; the measured worst case is 3.2. */
		minDeltaE: 3.0,
		/* The same element's other state. Sibling weight is the D7 property. */
		pairedWith: "sunken",
		/* Contrast-ratio quotient across the transition, both directions. A
		   value near 1.0 is one ring in two states; round 1 shipped 5.59. */
		maxWeightChange: 2.0,
		against: "surface",
	},
	{
		/*
		 * The empty-chat suggestion chip's hover ground step.
		 *
		 * Nothing else in this file measures this pair, and that is the whole
		 * reason the row exists: the chip becomes borderless, so every assertion
		 * the chip used to be adjacent to (a control's edge against its ground)
		 * stops applying — and what is left of the chip's appearance in the hover
		 * state is whether one ground is perceivably above the other at all.
		 *
		 * `elevated` on `canvas` is measured worst-case at ΔE00 4.21 (iceberg),
		 * clear of § 3's aim of 2. The floor is set at 2 rather than at the
		 * measured 4.21 because the assertion is "a human can tell these apart",
		 * not "this palette is the one we shipped" — a re-authored palette that
		 * collapsed the step toward 2 would still be a hover state, and one that
		 * collapsed it to 0 would be the picker-host D1 defect (a fill on its own
		 * ground) reproduced on the composer.
		 *
		 * `pairedWith: "canvas"` is the chip's OTHER state stated as a role rather
		 * than as an absence: at rest the chip draws no fill at all, so the colour
		 * behind it IS the ground it sits on.
		 *
		 * THE WEIGHT HALF IS A RATIO CEILING HERE, NOT A PROOF ABOUT THIS CHIP, and
		 * it is recorded rather than removed because the shape is right for a
		 * same-role ground pair and because deleting half an assertion to fix its
		 * prose hides the next reader from the mechanism. What it actually asserts:
		 * the loop computes `Math.max(a / b, b / a)` with `b = ratio(canvas,
		 * canvas) = 1.0`, so it collapses to `ratio(elevated, canvas) <= 2.0`. A
		 * ground step measures ~1.05-1.3 in every palette, so the ceiling is
		 * structurally satisfied and a `hover:bg-elevated` -> `hover:bg-surface`
		 * swap does not move it either. That swap is caught, but by the
		 * `STRUCTURAL_CALL_SITES` pin below - whose `must` spans `variant="ghost"`
		 * plus the class list - not by this half. Read the row as: the ΔE00 half is
		 * the guarantee (it is the only thing in this file measuring
		 * `canvas` <-> `elevated`), and the weight half is a ceiling that says the
		 * hover step must not stop being a step.
		 */
		name: "suggestion chip hover ground step",
		role: "elevated",
		on: ["canvas"],
		minDeltaE: 2.0,
		pairedWith: "canvas",
		maxWeightChange: 2.0,
		against: "canvas",
	},
	{
		/*
		 * THE MENTION CHIP'S FILL STEP, and why it is here rather than in `CONTROLS`.
		 *
		 * A chip inside the composer is a fill behind text the user wrote: it is not a
		 * control, it is not the sole boundary of one, and `CONTROLS` asserts the
		 * opposite shape - a control's fill OR border must clear 3:1 against its
		 * ground. A ground step between two ADJACENT GROUNDS cannot: `surface` ->
		 * `sunken` measures 3.75 ΔE00 at its worst and 1.03-1.30 as a luminance ratio,
		 * and `sunken` is deliberately the role the app already uses for recessed
		 * small objects (the neutral badge, the tabs track, the table header, the
		 * skeleton bar). What the chip owes is being SEEN as one object, which is this
		 * table's own question, so the row states that and nothing else.
		 *
		 * THE PAIRING DEPENDS ON THE BOX KEEPING `bg-elevated`, which is why
		 * `STRUCTURAL_CALL_SITES` pins that call site: against `canvas` the same fill
		 * step collapses to 1.23 in `obsidian`, because `sunken` on `canvas` is the
		 * weak step the loading bars already document.
		 *
		 * The two states are ONE WEIGHT, which is the other half: the outside-workspace
		 * fill is a HUE step near this one, so a reader who cannot separate the two
		 * hues must still read them as one kind of object rather than as two controls of
		 * different importance. `maxWeightChange` 2.0 states exactly that.
		 *
		 * AND IT CANNOT SEE THE PAIR, which is design round 1's D1 stated where the
		 * next person will read it. `maxWeightChange` is a CEILING on how far one
		 * state's weight may move from the other's, so by construction it passes
		 * hardest exactly when the two fills are identical - a pair with no weight
		 * difference at all is the most comfortable input this half of the row can be
		 * handed. The two `PERCEPTIBLE` rows therefore looked at the one pair their
		 * own constraint is blind to and said nothing about it. The row below answers
		 * the pair directly, by naming the other chip's ground in its own `on` list.
		 */
		name: "mention chip fill step",
		role: "sunken",
		on: ["elevated"],
		minDeltaE: 2.0,
		pairedWith: "warningWash",
		maxWeightChange: 2.0,
		against: "elevated",
	},
	{
		/*
		 * THE OUTSIDE-WORKSPACE CHIP'S FILL, and it is a row of its own rather than a
		 * second `on` in the row above because the two FILLS differ, not the ground:
		 * sharing one row would measure `warningWash` against `surface` under a name
		 * that says `sunken`.
		 *
		 * Its separation IS chromatic, which is the one place ΔE00's chroma axis does
		 * work a contrast ratio cannot - the luminance ratio for the same pair is
		 * 1.06:1 and would fail a floor of 1.1. The chip asserts nothing about the
		 * approval DECISION itself: the gate stays where it is, at submit, and the fill
		 * says which references will be judged OUTSIDE THE WORKSPACE, which is the
		 * containment question the renderer can answer (`at-mention-overlay.tsx`'s
		 * `MENTION_CHIP_OUTSIDE_ROLE`, named for that fact rather than for the decision
		 * - design round 1, D8).
		 *
		 * `on` NAMES THE OTHER CHIP'S GROUND, and that is the whole point of the row
		 * (design round 1, D1). The pair a reader has to tell apart is
		 * `warning-wash` against `sunken`, because those are the two fills that appear
		 * side by side in one sentence - and the pair had never been measured: the two
		 * rows above measured each fill against `surface`, the ground UNDER them. The
		 * floor is the file's own `FIELD_SEPARATION_FLOOR`, the value it already calls
		 * "a step the eye can see".
		 *
		 * THREE PALETTES DO NOT CLEAR IT TODAY and are pinned in `EXCEPTIONS` with
		 * their measured values rather than hidden: `kanagawaLotus` at 0.72, `sage` at
		 * 1.44 and `paper` at 1.61. The user-visible defect those three share is
		 * answered everywhere by the SECOND channel the component ships - the
		 * `border-warning-border` edge, ΔE00 23.4 or more from its own fill and from
		 * `sunken` in every palette - which is why the fill pair can be pinned with a
		 * measured exception list instead of holding the fix for a palette round.
		 * Re-authoring those three washes is that round's work, not this one's.
		 */
		name: "mention chip outside-workspace fill step",
		role: "warningWash",
		on: ["elevated", "sunken"],
		minDeltaE: 2.0,
		pairedWith: "sunken",
		maxWeightChange: 2.0,
		against: "elevated",
	},
	{
		/*
		 * THE OUTSIDE-WORKSPACE CHIP'S EDGE, which is the state's ONLY signal in the
		 * three palettes whose washes do not separate (review round 2, R2).
		 *
		 * The row above pins the fill pair, and in `kanagawaLotus` (0.72), `sage`
		 * (1.44) and `paper` (1.61) it passes on a pinned exception, because those
		 * three washes are within the perceptual floor of `sunken`. What carries the
		 * state there is the 1px `border-warning-border` the chip paints as its second
		 * channel - and until this row existed, nothing asserted it: the numbers were
		 * in the component's comment and the call site was pinned as a string, so a
		 * palette re-authoring that flattened `warningBorder` toward `warningWash`
		 * kept every gate green while the state disappeared in exactly the palettes
		 * the exception list exists for.
		 *
		 * Measured over the 59 palettes: ΔE00(edge, its own fill) is **23.40** at
		 * worst (`catppuccinMocha`) and ΔE00(edge, `sunken`) **28.06** at worst
		 * (`sage`), against the **4.0** floor this row sets - branding § 3's floor for
		 * a 1px rule, which is the same floor the D1 remedy cites for this edge.
		 *
		 * THE FLOOR IS ΔE00 RATHER THAN A CONTRAST RATIO, and that is a measurement
		 * rather than a preference: measured over the same 59 palettes, the edge clears
		 * 3:1 against its own fill in only **34** of them (1.78:1 at worst,
		 * `catppuccinMocha`) and against `sunken` in **55** (2.75:1 at worst, `sage`). So a
		 * 3:1 non-text floor would fail on twenty-five palettes for a hairline whose job
		 * is to be *seen* beside its own wash rather than to be a control's boundary. The
		 * chip is not a control, and `CONTROLS`' shape — a fill OR a border clearing 3:1
		 * against the ground behind it, with an ink on the fill — would assert a quota
		 * this edge was never drawn to meet.
		 *
		 * NO `pairedWith`: this row has no second state to weigh against. The parity
		 * half of this table is about ONE component in two states, and a rule that
		 * exists only in the outside state has nothing to be parity with - inventing a
		 * ceiling here would be an assertion that cannot bind. The loop below states
		 * that shape explicitly instead of skipping a row whose parity fields are
		 * absent, which is what it used to do silently.
		 */
		name: "mention chip outside-workspace edge",
		role: "warningBorder",
		on: ["warningWash", "sunken"],
		minDeltaE: 4.0,
	},
	{
		/*
		 * THE LINK TOOLBAR'S OWN GROUND STEP, and why it is HERE rather than in
		 * `CONTROLS`.
		 *
		 * The toolbar (the transcript's link actions, `link-toolkit.tsx`) is a
		 * floating strip with its own fill and its own border, which the section
		 * above says means a row - and it cannot have a `CONTROLS` row, for the
		 * reason the browser-tab hover fill above cannot: `elevated` on the grounds
		 * it floats over measures 1.03-1.40:1 against `canvas` and `surface`, and a
		 * fill step between adjacent grounds is under the 3:1 floors by construction.
		 * Listing it there would either fail on a property the design deliberately
		 * does not have, or force a heavier edge onto a strip whose whole look IS the
		 * lightness step - and `hairline`, the edge it actually wears, is capped below
		 * 2:1 by design (see the "usage bar track boundary" pin, which exists because
		 * `hairline` was the tempting weight there too).
		 *
		 * What the strip owes is being SEEN against what is behind it, which is this
		 * table's question. TWO measurements are quoted, because they answer different
		 * questions and round 1 (design D5) found only the wider one here: this gate
		 * measures the WORST of all fifty-nine palettes - `elevated` against `surface`
		 * is ΔE00 2.09 at worst (catppuccinMacchiato) and against `canvas` 3.90
		 * (rosePineDawn), which is why the floor is 2.0 - while the rows the design
		 * actually judged are the twelve the evidence set paints, where the rendered
		 * step from the canvas it floats over measures 4.52 (iceberg) to 12.00
		 * (radient). The floor is the wider reading (§ 3's "a human can tell these
		 * apart"); the narrower one is what the review round looked at, and quoting it
		 * here is what stops the two numbers looking like a contradiction.
		 *
		 * § 9.8 says a component with its own fill and its own border goes into
		 * `CONTROLS`, and this row plus the browser-tab hover fill above are its two
		 * worked exceptions. Named HERE, beside the row, rather than only in the row's
		 * comment: a reader comparing the two is looking at this table, and an
		 * exception a reader has to reconstruct from prose is one nobody can check.
		 *
		 * BOTH GROUNDS, because both are reachable and one of them is new here: the
		 * strip floats over the assistant's `canvas` column AND over a user turn's
		 * `surface` bubble (the row it is pinned to contains both). The weight half is
		 * a ratio ceiling against `canvas` for the reason the chip row records about
		 * its own - a hover step measures ~1.05-1.4 either way - so read it as "the
		 * step must not stop being a step", not as a proof about this strip.
		 */
		name: "link toolbar ground step (a § 9.8 exception - see this row's comment)",
		role: "elevated",
		on: ["canvas", "surface"],
		minDeltaE: 2.0,
		pairedWith: "canvas",
		maxWeightChange: 2.0,
		against: "canvas",
	},
	{
		/*
		 * The checkpoint jump's landing wash (`reveal-record.ts` and the
		 * `[data-jump-highlight]` rules in `styles/index.css`, design §D7): the
		 * row a tick jump landed on holds a transient `accentWash` ground for
		 * ~1.4 s. Here rather than in `CONTROLS` because it is not a control -
		 * no border, no interaction, a state of the reader's own view - and its
		 * question is this table's: the wash must be SEEN against the ground a
		 * transcript row sits on (`canvas`), or the flash is a no-op - worst of
		 * all for a reduced-motion reader, whom the stylesheet deliberately
		 * keeps on the static wash and nothing else.
		 *
		 * The pair is one this file already measures (the reading buttons' hover
		 * row above: `accentWash` against `canvas` is ΔE00 13.33 dark / 6.75
		 * light); the floor is the wide "a human can tell these apart" reading
		 * (2.0), and the row exists so a component that now DEPENDS on the pair
		 * keeps it asserted rather than borrowing it silently.
		 */
		name: "checkpoint jump landing wash",
		role: "accentWash",
		on: ["canvas"],
		minDeltaE: 2.0,
	},
];

/**
 * Boundaries whose ROLE IN THE SOURCE is part of the contract, not just the
 * colour behind it.
 *
 * The contrast rows above prove a colour pairing across twelve palettes. They
 * are blind to the one edit most likely to undo the work: swapping the class
 * at the call site from `border-control` (3:1 floor) to `border-hairline` (no
 * floor). That edit keeps every palette assertion green while returning the
 * element to the 1.32:1 it was fixed from, so the guarantee people read into
 * a green run has to be made real here rather than implied.
 *
 * Each entry names a file, the element it is about, and a pattern that must
 * appear in it. Deliberately a substring check on the shipped source: this
 * script has no parser and does not need one to answer "does this component
 * still declare a structural edge".
 *
 * Two entries are not edges at all. The chat list panel's ground and the
 * working surface's ground are a palette-only fact on the other half of this
 * file (`surface` against `canvas` is asserted there as an adjacent pair, and
 * either colour clears every floor wherever it is used), so the one place the
 * relationship can be undone is at the call sites - and it can be undone from
 * EITHER side. Repaint the column `surface`, or the panel `canvas`, and the two
 * merge into one slab with no rule between them (the divider is `w-0` and draws
 * nothing) while every palette assertion stays green. Both panes are pinned to
 * their own composed class string rather than to a bare ground token, so a bare
 * `bg-canvas` in a comment cannot satisfy the column's row (mutation-tested).
 *
 * HOW THESE PINS MATCH, AND WHAT THAT COSTS. Every `must` is a plain
 * `source.includes(...)` over the whole file, comments included: there is no
 * parser here, deliberately (see the section above on why a substring is enough
 * to answer "does this component still declare the role"). Two consequences are
 * known, accepted, and should not be changed without their own verification
 * round:
 *
 *   - A comment that quotes the pinned string EXACTLY re-arms that row, so
 *     documenting a pin in prose inside the file it pins can silently disable
 *     it. Keep the pinned string out of comments in that file, or pin something
 *     narrower than the prose contains.
 *   - The pins are class-order-sensitive: a behaviour-identical reorder
 *     (`bg-canvas rounded-none` for `rounded-none bg-canvas`) fails the gate.
 *     That direction fails CLOSED - it costs a reviewer a minute, it does not
 *     let a merged slab through - which is why it is acceptable rather than
 *     worth a parser.
 */

/**
 * Roles that must clear the structural 3:1 floor on all four grounds.
 *
 * `borderControl` is the control's own edge; `accent` is the focus ring
 * (`outline: 2px solid var(--color-accent)`, authored unlayered in
 * `styles/index.css`) and the `border-accent` marker; the four `*Border` roles
 * are the edges of the semantic callouts. SC 1.4.11 asks 3:1 of all of them.
 *
 * The four tone roles joined this list because their edges were only ever
 * measured on `canvas`, `surface` and `sunken` - which is exactly why three
 * `danger` pins and eight `dangerBorder` pins stood in for a floor on
 * `elevated` (a dialog's required-mark and a danger control's only boundary on
 * a dialog). A pin records a measured ratio, so a ground move breaks it and
 * re-recording it is a decision to KEEP a defect whose fix is available: the
 * edge is re-authored here instead, and the pin is deleted in the same commit.
 */
export const STRUCTURAL = [
	"borderControl",
	"accent",
	"successBorder",
	"warningBorder",
	"dangerBorder",
	"infoBorder",
];

/**
 * Roles that must clear the text floor as text, on ALL SIX grounds.
 *
 * `sunken` is in the list because it is the editor's own ground: every syntax
 * colour is painted on it, and the code-mirror theme rejected `inkDisabled` for
 * comments on exactly the grounds it failed 4.5:1 there. `elevated` and
 * `accentWash` are in it because each is a ground a tone role is genuinely
 * drawn on - a dialog's required-mark and a danger button's label (`elevated`),
 * the ask-option card and the find-match tint (`accentWash`) - and
 * `messageSurface` is in it because the block renders arbitrary user prose,
 * links and markdown included, the likeliest carrier of tone text in a
 * transcript - and the old list stopped at `sunken`, which is how `danger`
 * came to be drawn at 3.76:1 on `elevated` in `monokai` behind a green gate.
 */
export const AS_TEXT = ["accent", "success", "warning", "danger", "info"];

/**
 * The console terminal's colour pairs that no other table states (design 9.3).
 *
 * WHY ONLY ONE PAIR IS HERE. §9.3's list is mostly already asserted elsewhere by
 * accident of the app's own structure: the terminal ground is `sunken`, which is
 * one of the four `GROUNDS`, so `ink`/`inkMuted`/`inkDim` on it are in the INKS
 * loop and the four hue roles are in `AS_TEXT` at the stricter 4.5:1 - which is
 * the point of naming roles rather than inventing a second palette for the
 * terminal. What is left is the one pair only a terminal has: the character the
 * block cursor reverses into, i.e. `cursorAccent` (`surface`) sitting ON `cursor`
 * (`accent`).
 *
 * `surface` rather than `onAccent` is the design's mapping (§9.1) and it is
 * measured rather than assumed: the worst palette is 4.98:1 (`tokyoNight`), so the
 * role the mapping names clears the text floor without an exception pin.
 */
export const TERMINAL_PAIRS = [
	{
		fg: "surface",
		on: "accent",
		floor: FLOOR.text,
		name: "the console terminal's cursor ink on its own cursor (9.1)",
	},
];

/**
 * The terminal's ANSI slots, as `terminal-theme.ts` maps them.
 *
 * HELD HERE FOR THE HONEST GAP, not for a floor: §9.2 states that six chromatic
 * slots cannot be sourced one-for-one from four gated hue roles, so two pairs are
 * deliberately the same role. This table is what makes that MEASURED - the run
 * prints how many distinct colours the sixteen slots resolve to, per palette - and
 * `scripts/console-theme.test.mjs` pins it to the module itself, so the two cannot
 * drift into disagreeing about what the terminal shows.
 */
export const TERMINAL_ANSI = [
	["black", "inkDim"],
	["red", "danger"],
	["green", "success"],
	["yellow", "warning"],
	["blue", "info"],
	["magenta", "danger"],
	["cyan", "info"],
	["white", "ink"],
	["brightBlack", "inkMuted"],
	["brightRed", "danger"],
	["brightGreen", "success"],
	["brightYellow", "warning"],
	["brightBlue", "info"],
	["brightMagenta", "danger"],
	["brightCyan", "info"],
	["brightWhite", "ink"],
];

/**
 * Sub-floor pairs accepted with a reason, pinned to their measured ratio.
 *
 * A pin is a decision, not a mute: if the token moves, the recorded ratio stops
 * matching and the exemption fails until a human re-approves it. Keep this list
 * as short as the design allows — it is the only part of this file that
 * encodes an opinion rather than a measurement.
 *
 * @type {{theme: string, fg: string, bg: string, got: number, why: string}[]}
 */
/*
 * EMPTY, and the emptiness is the point rather than an oversight. It held
 * ELEVEN pins, all on `elevated` and all in the `danger` family: eight
 * `dangerBorder` edges (monokai 2.49, dracula 2.51, radient 2.58, synth 2.60,
 * obsidian 2.65, tokyoNight 2.66, neon 2.78, dune 2.88) and three `danger` text
 * pairs (monokai 3.76, dracula 3.81, neon 4.43). Every one of them existed
 * because `danger` and `dangerBorder` were measured only on `canvas`, `surface`
 * and `sunken`, so the pair that failed was the one on the dialog's `elevated`
 * - a pair a user really meets, since the dialog required-mark and the
 * danger-variant button's label are both drawn there.
 *
 * The legibility pass retires them by RE-AUTHORING THE TOKEN rather than by
 * re-recording the pin. A pin records a measured ratio, so the ground lift
 * breaks all eleven of these regardless - `elevated` rises, and the edge and the
 * text both get LESS contrast against it - and re-recording them at the new
 * (lower) values would be eleven separate decisions to KEEP a defect whose fix
 * is available. Instead `elevated`, `accentWash` and `highlight` joined the
 * ground lists of `AS_TEXT` and `STRUCTURAL` in the same change, so the floor
 * those pins stood in for is now asserted for every palette and every tone role,
 * and the deletions are what proves the re-authoring happened: a pair that no
 * longer clears its floor fails, with no pin left to explain it away.
 */
export const EXCEPTIONS = [
	/*
	 * EMPTY AGAIN since the darker-grounds pass (2026-11-03). It held four entries,
	 * all one pairing: the model-access band's `text-accent` link on `warningWash`
	 * in catppuccinMocha (4.01), nord (3.6), oneDark (3.46) and tokyoNightStorm
	 * (3.67), whose warm washes sat close to their dark grounds. Lowering the dark
	 * band re-lit those washes downward by the same `L*` as their grounds, while
	 * the accent stayed put, so all four pairs now clear 4.5:1 and the
	 * never-consulted guard required the pins to go. A future ground move
	 * re-measures; add an entry only with its measured ratio and its reason.
	 *
	 * THE TABLE WAS EMPTY BEFORE that earlier pass too, and that emptiness had
	 * its own lesson, kept here because the mechanism depends on it: an entry for
	 * `catppuccinMacchiato`'s `inkDim` on `rowSelected` survived after its fill
	 * was re-authored, because `assertPair` returns as soon as `raw >= floor`, so
	 * a pin that has stopped being needed is never CONSULTED. The guard the three
	 * sibling pin tables already had is what closed it: an entry that is never
	 * asked about fails the run with "delete the pin, the palette clears it now".
	 * A pin is a DECISION, not a mute.
	 */
];

/**
 * Sub-floor `PERCEPTIBLE` pairs accepted with a reason, pinned to their ΔE00.
 *
 * The same idea as `EXCEPTIONS` one table up, for the other instrument: a pin is
 * a DECISION, not a mute. Each entry records the measured ΔE00, so a palette move
 * makes the entry stop matching and the gate fails until a human re-approves it —
 * and an entry that is never consulted is itself a failure (see the staleness
 * check beside the run's exit), which is what stops a fixed palette from leaving
 * a permanent hole behind it.
 *
 * ONE PAIR LIVES HERE: the mention chip's two fills, `warningWash` against
 * `sunken` — the pair the composer draws side by side in one sentence, measured
 * for the first time in design round 1's D1. Three palettes cannot clear the
 * 2.0 floor today because their ordinary and warning washes are the same warm
 * near-white: the fills are within a couple of ΔE00 of each other, and no
 * re-authoring of them belongs in this change. What ships INSTEAD of a palette
 * round is the second channel that makes the state readable regardless — the
 * outside chip's `border-warning-border` edge, which measures ΔE00 23.4 or more
 * from its own fill and from `sunken` in all 59 palettes — so these entries
 * document a known, bounded gap rather than the defect the round is about.
 *
 * RE-MEASURED ON THE FOLD ONTO `origin/main` (`10926b782`): this branch lifted
 * `sunken` on every palette it touched, and the step this entry records is
 * measured between two fills on that ground, so `sage` moved 1.44 -> 1.45. The
 * move is a re-measurement of the SAME pair with the same verdict (still under
 * the floor, still the same two near-white washes), so the entry is re-recorded
 * at the precision the gate matches on rather than the palette being re-authored
 * for a hundredth of a ΔE00 — which is the maintenance the paragraph above asks
 * for, not an exemption granted to a new defect.
 *
 * @type {{theme: string, role: string, ground: string, got: number, why: string}[]}
 */
export const PERCEPTIBLE_EXCEPTIONS = [
	{
		theme: "kanagawaLotus",
		role: "warningWash",
		ground: "sunken",
		got: 0.72,
		why: "worst of the three: the two washes are one colour to the eye, and the edge is the only signal in this palette",
	},
	{
		theme: "sage",
		role: "warningWash",
		ground: "sunken",
		got: 1.45,
		why: "the palette design round 1 measured it in, and the reason the outside chip takes an edge at all",
	},
	{
		theme: "paper",
		role: "warningWash",
		ground: "sunken",
		got: 1.61,
		why: "0.39 under the floor; same warm near-white pair",
	},
];

/*
 * THE TOOL ROW'S TWO IDENTITY PAIRS, and why each is asked where it is.
 *
 * The trace's settled ledger draws TWO inks as text in ONE column: the tool's
 * CATEGORY ink (`read` -> `info`, `meta` -> `accentAlt`) and, on a running row,
 * the LIVENESS ink (`accent`). Both pairs are new SITES for roles whose floors
 * were written for other ones, and each pair is named with the bound its own
 * site needs.
 *
 * 1. `accentAlt` vs `info`, at 15 and not the reduced 8 the pair was previously
 *    asserted at. The 8 was argued for the sites the role HAD - a 1px bar in a
 *    40px miniature, a 6px mark in a diagram - where recall at a size too small
 *    to resolve is the question. This site is the opposite one: two ~12px inks a
 *    line apart in one column, which is the "difference of category, not of
 *    shade" case the 15 exists for. A reader scanning the ledger has to tell
 *    "this call read" from "this call was meta", and at 8 the two take the same
 *    name.
 *
 *    FIVE PALETTES CANNOT REACH IT, and they are RECORDED rather than silently
 *    exempted, with the constraint that refuses each named on the pin. Re-seating
 *    was measured first and refused, and the SEARCH SPACE is named here because
 *    this figure has been mis-quoted twice: on `catppuccinMocha` - the binding
 *    value, and the palette whose second hue sits 2.68 degrees off `info`'s -
 *    lifting `L*` to the ground the row paints the ink on (the 4.5:1 text floor
 *    on `elevated`, which lands on the hex `#7AA3DD` at the held hue 272.6 and
 *    `C*` 33.97) walks the value into `info`: it reads ΔE00 6.08 there, BELOW
 *    the 8 it already held. Every value that clears both is instead drained to
 *    the chroma floor (C* 15 at L* 89-90), which is the one way
 *    `ALT_ACCENT_CHROMA_FLOOR`'s own comment says the role stops being a hue.
 *    So the palette cannot move and the assertion keeps its bound; the five are
 *    pinned at their measured ΔE00 with the reason, and the pins are ACCEPTED
 *    RESIDUALS rather than fixes. RECOMPUTED ONCE, because the two records
 *    disagreed: 6.00 was the crossing read one stop too far (`L*` 66.4, the
 *    shipped value's own lightness) and 6.24 was a read on unquantized `Lab`
 *    values (which recompute to 6.22); 6.08 is the hex read at the crossing,
 *    reproducible with this file's own `deltaE`, and it is what both records
 *    now state.
 *
 * 2. `info` vs `accent`, at 8: the settled `read` ink against the ink a RUNNING
 *    row wears. The bound is the file's "reliably take different names rather
 *    than scraping the side-by-side threshold" floor and not the 15, because this
 *    pair is NOT the ledger's side-by-side comparison - the two inks are never in
 *    one row, and the state they disagree about is carried three other ways at
 *    once (the running row's raised ground, its live clock where a settled row
 *    has its outcome mark, and the mark's own shape). What it catches is the
 *    direction the palette file already recorded in prose: `info` IS `accent` in
 *    `dune`, `neon`, `radient` and `obsidian`, so a settled `read` row and a
 *    running row wore the same ink. Pinned for the same reason as above: on those
 *    palettes the second hue IS the role, and moving `info` there is a different
 *    change - `info` is also what the port mapped the TUI's `signal` onto.
 *
 * Both are declared HERE rather than beside the constants they equal, because
 * `const` does not hoist and `PAIR_PINS` below is written against them; the
 * check that they still ARE those constants is at the foot of the run, beside the
 * fleet figure, so a change to either canonical floor cannot leave these two
 * behind.
 */
export const IDENTITY_PAIR_FLOOR = 15; /* == SEPARATION_FLOOR */

export const LIVENESS_PAIR_FLOOR = 8; /* == SYNTAX_COMMENT_FLOOR */

/**
 * Identity PAIRS accepted below their floor, pinned to their measured ΔE00.
 *
 * The same instrument as `PERCEPTIBLE_EXCEPTIONS` one table up and the same
 * contract: a pin is a DECISION with a measurement attached, not a mute. The
 * palette moving makes the recorded ΔE00 stop matching and the gate fails until
 * a human re-approves it, and an entry the walk never reaches is itself a failure
 * (the staleness check at the foot of the run), so a palette that stops needing
 * its pin cannot leave a hole behind.
 *
 * BOTH ENTRY FAMILIES LIVE HERE because they are the same question asked of two
 * pairs the tool row newly draws as TEXT: the category ink against its sibling
 * category (`accentAlt` vs `info`, floor `IDENTITY_PAIR_FLOOR`) and the settled
 * category ink against the LIVENESS ink (`info` vs `accent`, floor
 * `LIVENESS_PAIR_FLOOR`). See the floors' own comment for why each bound is what
 * it is. `a`/`b` are palette roles, `got` is the measured ΔE00, and `why` names
 * the constraint that REFUSES the palette rather than restating the number.
 *
 * @type {{theme: string, a: string, b: string, floor: number, got: number, why: string}[]}
 */
export const PAIR_PINS = [
	/*
	 * The five palettes whose second hue IS the `info` family. Every one of the
	 * three `catppuccin*` palettes took its `accentAlt` from the TUI's `label`
	 * token, and on those the scheme's lavender and its blue are two steps of one
	 * ramp: the shipped values sit 2.68, 19.42 and 17.02 degrees off `info`'s hue.
	 * `localOperatorDark` and `ayuLight` have no `label` token to port - they are
	 * desktop-only, and their second hue is a rotation of their own `accent` - so
	 * the rotation lands where the floors put it, which is beside `info`.
	 */
	{
		theme: "catppuccinMocha",
		a: "accentAlt",
		b: "info",
		floor: IDENTITY_PAIR_FLOOR,
		got: 8.58,
		why: "the second hue sits 2.68 degrees off `info`'s; re-seating was measured and refused - lifting `L*` to the ground the row paints it on (the 4.5:1 text floor on `elevated`, hex `#7AA3DD`) drops it to ΔE00 6.08 from `info` (below the 8 it already held) and every value clearing both AT THIS HUE is at C* 15, the chroma floor that makes the role a second grey",
	},
	{
		theme: "catppuccinMacchiato",
		a: "accentAlt",
		b: "info",
		floor: IDENTITY_PAIR_FLOOR,
		got: 8.58,
		why: "the second hue sits 19.42 degrees off `info`'s, in its own family by construction",
	},
	{
		theme: "catppuccinFrappe",
		a: "accentAlt",
		b: "info",
		floor: IDENTITY_PAIR_FLOOR,
		got: 8.6,
		why: "the second hue sits 17.02 degrees off `info`'s, in its own family by construction",
	},
	{
		theme: "localOperatorDark",
		a: "accentAlt",
		b: "info",
		floor: IDENTITY_PAIR_FLOOR,
		got: 12.57,
		why: "desktop-only palette with no `label` to port: its second hue is a rotation of `accent`, and the rotation that clears every other floor lands 12.57 from `info`",
	},
	{
		theme: "ayuLight",
		a: "accentAlt",
		b: "info",
		floor: IDENTITY_PAIR_FLOOR,
		got: 13.57,
		why: "desktop-only palette with no `label` to port; the rotation lands 13.57 from `info`",
	},
	/*
	 * And the four palettes whose `info` IS their `accent`, plus the light one whose
	 * two Primer blues are 5.87 apart. Three of the four are already recorded in
	 * this file's prose (`COMMAND_TOKEN`'s note: "`info` is the accent's twin in
	 * dune, neon and radient (0.0) and the ink's twin in obsidian (0.0)"); what
	 * changes here is that the recording is now ASSERTED, so a palette edit that
	 * moves either role re-litigates the pin instead of quietly re-opening the
	 * state confusion. Pinned rather than re-authored because on these palettes the
	 * second hue IS the role: moving `info` there is a different change, and `info`
	 * is the TUI's `signal` mapping on top of that.
	 */
	{
		theme: "dune",
		a: "info",
		b: "accent",
		floor: LIVENESS_PAIR_FLOOR,
		got: 0,
		why: "`info` IS `accent` (`#FF8C38`), the palette's single warm hue; a settled `read` row and a running row separate by their ground, their mark and their clock",
	},
	{
		theme: "neon",
		a: "info",
		b: "accent",
		floor: LIVENESS_PAIR_FLOOR,
		got: 0,
		why: "`info` IS `accent` (`#00EFFF`), the palette's single cyan",
	},
	{
		theme: "obsidian",
		a: "info",
		b: "accent",
		floor: LIVENESS_PAIR_FLOOR,
		got: 0,
		why: "the app's recorded MONOCHROME palette: `info` IS `ink` IS `accent` (`#FAFAFA`), which `code-mirror-theme.ts` and the command-token pins already state; hue is not the channel here and never was",
	},
	{
		theme: "radient",
		a: "info",
		b: "accent",
		floor: LIVENESS_PAIR_FLOOR,
		got: 0,
		why: "`info` IS `accent` (`#91B7E9`), the palette's single steel blue",
	},
	{
		theme: "githubLight",
		a: "info",
		b: "accent",
		floor: LIVENESS_PAIR_FLOOR,
		got: 5.87,
		why: "two Primer blues: `accent` is 0969DA deepened to clear its own text floor and `info` is 0550AE kept as the scheme's factual chrome tone, so the two sit one shade apart by construction; separating them means re-authoring one of them, which is a palette round and not this change",
	},
];

/*
 * The step between a CONTROL's ink and a READOUT's ink, measured in one row.
 *
 * A session's row has always put live chips (`inkMuted`) beside inert readings
 * (`inkDim`), and a draft's row does now too: the two chips that open, next to
 * the context reading that does not. That pair is the only at-rest colour cue
 * separating a control from a readout, and in five palettes it is a smaller step
 * than this file already demands of a comment against the code beside it
 * (`SYNTAX_COMMENT_FLOOR`, 8).
 *
 * Pinned rather than fixed, deliberately. Lifting `inkDim` in those five
 * palettes changes EVERY dim string in the app, because the pairing is the app's
 * own vocabulary rather than this row's - so that fix is a palette-wide visual
 * change owned by the design review for those palettes, not by the PR that made
 * two draft readings clickable. What this file can do meanwhile is stop the
 * numbers being a matter of opinion: each pin must still measure what it says,
 * and a palette that has been lifted out of the floor FAILS until its pin is
 * deleted, so the list cannot outlive the defect it records.
 *
 * It is a pin and not a blocker because the cue is not colour-only in the
 * artifact: a control takes the pointer, carries a hover step, and is a plain
 * button in the accessibility tree, while the inert label form is a button with
 * `aria-disabled` and no hover step. The ink step is what a mouse user sees
 * BEFORE approaching, and those are the measured facts this list records.
 */
/*
 * EMPTY NOW, and its own rule is what emptied it: "a palette that has been
 * lifted out of the floor FAILS until its pin is deleted, so the list cannot
 * outlive the defect it records."
 *
 * The legibility pass lifted `inkDim` in every palette that needed it - which is
 * the fix this comment declined to make in the two-draft-readings change,
 * deliberately and for the reason stated above: it is a palette-wide visual
 * change, and it is the change this pass IS. The step is paid on lightness, so
 * `inkMuted` rose with `inkDim`, and all 59 palettes now clear the 8 floor
 * (`SYNTAX_COMMENT_FLOOR`). The five entries this list carried - tokyoNight
 * 5.74, obsidian 5.80, iceberg 6.03, neon 7.17, localOperatorLight 7.93 - were
 * therefore deleted rather than re-derived against the new inks: a re-derived
 * pin would record a step that already satisfies the floor, which is exactly the
 * dead weight the rule above exists to refuse.
 */
export const INK_STEP_PINNED = [];

/*
 * THE LIST IS EMPTY TODAY, and what it held is kept here because the machinery
 * is not specific to the control that needed it.
 *
 * WHAT IT HELD LAST: twelve entries for the pane's state pills (built spec §3),
 * whose `infoBorder` (open), `successBorder` (merged) and `borderControl`
 * (draft) edges measured 2.949-2.998:1 against the 3:1 floor on the row's old
 * `rowHover` ground. Remediation round 1 moved the row's hover to the
 * run-detail rows' `surface` step (UX D1/U4), and on that ground every pill
 * edge clears the floor in all fifty-nine palettes - so the pins were DELETED,
 * not re-pointed, by the run's own rule that an unconsulted pin is a lie (its
 * stale check reported all twelve the moment the ground moved). A design round
 * that wants a floored boundary instead has a role change to make, and a pin
 * here is what makes such a decision visible rather than silent.
 *
 * WHAT IT HELD BEFORE THAT, AND WHAT THIS MACHINERY DOES NOT OUTLIVE:
 *
 * It held three entries: the attention badge's `borderControl` edge on the `highlight`
 * ground, in catppuccinMocha (2.85), duskfox (2.91) and gruvbox (2.81), all under the
 * 3:1 floor. `highlight` was reached by that badge through one surface only — the
 * sidebar's per-row browser mark, which drew `Badge variant="attention"` on a
 * conversation row including the current one. The mark is DELETED (operator ask,
 * 2026-09-18), and with it the last surface where this badge sits on `highlight`: the
 * defect those three pins recorded has no surface left to occur on, so they would be
 * dead weight in exactly the sense the stale check below exists to refuse. The
 * header's Globe badge keeps its own `CONTROLS` row on `canvas`, which is where it is
 * drawn.
 *
 * WHAT A PIN HERE NEEDS, because that part is the value of the list rather than of its
 * entries: it is keyed BY THE CONTROL AND THE GROUND IT WAS MEASURED ON, not by the
 * theme alone (review round 3, A-2). A `(theme, got)` key could excuse a DIFFERENT
 * control's sub-floor edge that happened to land within 0.01 of the pinned ratio - the
 * gate would stay green, the stale check would be satisfied, and the summary would still
 * report the pin as used with no way to tell which row it excused. `EXCEPTIONS` is
 * keyed `(theme, fg, bg)` for the same reason. `control` is the control's own
 * `name`, which is the identity `CONTROLS` carries; a pin that names a control or
 * ground nothing measures fails the stale check below rather than passing quietly.
 *
 * @type {{control: string, ground: string, theme: string, got: number}[]}
 */
export const CONTROL_EDGE_PINNED = [];

export const REQUIRED_ROLES = [
	"mode",
	...GROUNDS,
	/* The two STATES of a list row, and not a fifth STEP on the elevation ladder:
	   a row wears them and a container does not. Required rather than optional for
	   the same reason every other role here is: a palette that omits one falls
	   silently through to MUI's stock palette, and each is read by a Tailwind
	   utility (`bg-row-hover`, `bg-row-selected`) that would then resolve to
	   nothing at all. They replace `highlight`, which is retired: keeping the name
	   would have left the tree's most-documented role describing a value that no
	   longer obeys its own doc. */
	"rowHover",
	"rowSelected",
	/* The user message block's own fill. Not a fifth ground - one object's
	   surface, split off `surface` so its boundary can carry its own ΔE00 floor
	   without moving every panel in the app (see its doc in the palette
	   contract). Required for the same reason every role here is: a palette that
	   omitted it would fall silently through to a utility that resolves to
	   nothing at all. */
	"messageSurface",
	/* The media tile's own fill. Not a fifth ground either - one object's surface,
	   split off `sunken` so the borderless tile's only resting extent can carry
	   its own ΔE00 floor without deepening every well in the app (see its doc in
	   the palette contract). Required for the same reason every role here is: a
	   palette that omitted it would fall silently through to a utility that
	   resolves to nothing at all. */
	"mediaSurface",
	"ink",
	"inkMuted",
	"inkDim",
	"inkDisabled",
	"hairline",
	"borderControl",
	"accent",
	"accentHover",
	"accentActive",
	"accentWash",
	"onAccent",
	/* The second decorative hue and its wash. Required for the same reason every
	   other role here is: a palette that omitted one would fall silently through
	   to a Tailwind utility that resolves to nothing at all. Both are read by
	   utilities now (`bg-accent-alt`, `bg-accent-alt-wash`), and `accentAltWash`
	   is also the index-1 entry of mermaid's categorical ramp. */
	"accentAlt",
	"accentAltWash",
	"chartBarHover",
	"tokenCommand",
	"success",
	"successWash",
	"successBorder",
	"warning",
	"warningWash",
	"warningBorder",
	"danger",
	"dangerWash",
	"dangerBorder",
	"info",
	"infoWash",
	"infoBorder",
	"overlayShadow",
	"scrim",
];

/**
 * Semantics a reader has to tell apart, and how far apart they must be.
 *
 * `accent` is deliberately absent, and in four of the twelve palettes it would
 * fail: localOperatorLight 2.19, localOperatorDark 5.07, sage 8.35, and monokai
 * at 0.00 — where `accent` and `success` are the same hex. In the brand pair
 * that is the point, because the brand has one hue and "it worked" is the state
 * it is happiest to own; in monokai and sage it follows from palettes built
 * around a single signature green.
 *
 * THAT USED TO REST ON "nothing in the product asks a user to distinguish an
 * accent from a success", AND THE STATUS CHANNEL NOW ASKS IT (design round 1,
 * D1): the projects detail page renders `active` (accent) and `done` (success)
 * as chips SIDE BY SIDE in one Status column, at the numbers above - 2.22 in
 * localOperatorLight and 5.07 in localOperatorDark, whose washes are
 * byte-identical, and 0.00 in monokai. The answer is not a palette change:
 * `ProjectStatusBadge` carries a check glyph on `done`, so the difference the
 * channel asks for is made by SHAPE in every palette, and this family stays as
 * it is - there is no chromatic step left for a user to read. The acceptance is
 * recorded here rather than re-litigated per palette, the same way
 * `accentAlt`/`info` records its own below. A gate that fails by design teaches
 * people to silence gates, so accent is out of the family rather than pinned as
 * an exception in every palette.
 *
 * The floor is 15 and it is a judgement about *recall*, not comparison. A
 * ΔE00 around 2.3 is where a difference becomes visible with both colours
 * side by side; nobody reads callouts that way. A user meets one callout,
 * alone, and has to categorise it against a memory of what green meant last
 * week — and that needs a difference of category, not of shade. 15 is roughly
 * six times the side-by-side threshold, which is the region where two colours
 * reliably take different names.
 *
 * It is not calibrated to the tree. The closest legitimate pair in the twelve
 * is dune's `danger`/`info` at 18.4 (a red-orange beside an orange), which
 * clears 15 by 23 percent; the three pairs that ever failed this — the two
 * brand palettes at 2.2 and 5.1, and sage at 8.4, each of which had defined
 * `info` as its accent's triple — failed it by three to seven times over.
 */
export const SEPARABLE = ["success", "warning", "danger", "info"];

/*
 * Syntax highlighting, the pairs the editor distinguishes by HUE.
 *
 * The code editor maps keyword/string/number to three of the four gated
 * semantics, function names to `info`, comments to `inkDim` and names to
 * `ink`. The semantics-vs-semantics floor above therefore already covers
 * keyword vs string vs number vs function. What it cannot see is the editor's
 * other adjacency: every token sits next to comments and names.
 *
 * Two exclusions, both deliberate and both carried by weight rather than
 * hue, so a hue gate would assert something the design does not promise:
 * `accent` never appears in syntax at all (it measures dE00 0.00 against
 * success on monokai, info on dune and ink on obsidian), and obsidian's
 * `info` IS its `ink`, so function and class names separate from variable
 * names by a heavier weight, not a different colour.
 *
 * The floor is 8: the previous mapping's worst case was 0.00, this one's is
 * 8.87 (radient, info vs inkDim), and 8 is the point where a token and the
 * comment beside it reliably take different names rather than scraping the
 * side-by-side threshold.
 */
/*
 * `ink` is in this list because the editor paints identifiers in it - names,
 * properties, the base text - directly beside comments in `inkDim`. It is the
 * most common adjacency in any file and it was the one pair the gate did not
 * measure while it did measure `danger` vs `inkDim` from a mapping that had
 * drifted out of the theme.
 */
export const SYNTAX_HUE_ROLES = ["success", "warning", "danger", "info", "ink"];

export const SYNTAX_COMMENT_FLOOR = 8;

/* The composer's structured-token ink: the leading `/word` a user typed.
 *
 * Its own constant rather than a member of `SYNTAX_HUE_ROLES`, because the
 * ADJACENCY differs: a syntax token sits beside `inkDim` (the comment it is
 * distinguished from), while this run sits inside a sentence the user is typing
 * — beside prose `ink`, beside `accent` (which the same box already spends three
 * times: focus ring, send button, popup selection) and beside `success` (the
 * resolved roster NAME on the same line). The floor is the syntax block's own 8,
 * for the same reason: a tint the eye cannot separate from the text beside it is
 * not structure.
 *
 * Why a role and not a pair of existing inks — measured, by the design round,
 * over every ordered pair of the app's text roles: exactly one pair clears 8
 * from `ink`, 8 from `accent` and 8 from each other in all twelve palettes then
 * shipping (`warning` + `danger`), and painting the composer's two most ordinary
 * tokens amber and red is a different design rather than a cheaper one. `info`
 * is the accent's twin in dune, neon and radient (0.0) and the ink's twin in
 * obsidian (0.0), which is why `tokenCommand` exists.
 */
export const COMMAND_TOKEN = "tokenCommand";

/* The syntax block's floor, used here as a ΔE00 separation between two inks. */
export const COMMAND_TOKEN_FLOOR = SYNTAX_COMMENT_FLOOR;

/*
 * The field it is painted in, the popup that opens over it, and the user message
 * block, where the same role inks a `$skill` in a sent turn
 * (`markdown.css`'s `.lo-skill-token`). `messageSurface` is a different fill from
 * `surface`, so the floor is asserted on it rather than inherited from the
 * composer's.
 */
export const COMMAND_TOKEN_GROUNDS = ["surface", "elevated", "messageSurface"];

/*
 * Obsidian is the one pinned exception, and it is the app's recorded monochrome
 * case rather than a mute button: `info` IS its `ink` IS its `accent`
 * (`#FAFAFA`), so `code-mirror-theme.ts` already separates tokens there by
 * WEIGHT ("function and class names cannot be separated by hue there;
 * `functionName` takes a heavier weight instead"). `tokenCommand` is bound to
 * `ink` and the run's semibold is the channel. Both numbers are recorded so an
 * edit to obsidian's `ink` or `accent` re-litigates the pin instead of silently
 * keeping it. The `success` separation has NO pin, which is what keeps the
 * command and the resolved name from collapsing into one read anywhere.
 */
/*
 * AND THREE IDENTITIES ARE RECORDED RATHER THAN ASSERTED, in the idiom the
 * name's accent numbers already use above: `tokenCommand` IS `warning` in dune
 * (`#E8C15A`), neon (`#FFA500`) and radient (`#E3B457`) — ΔE00 0.00 each,
 * recomputed by the design round and visible in the frames as the same amber.
 * Nothing asserts a separation here because there is none: those three palettes
 * spend their own second hue on this run, which is what the role was asked to do
 * (their `info` IS their accent, so a cool role was not available to them). The
 * design round's reading is that the tint still reads as STRUCTURE rather than as
 * an alarm — a bare word mid-sentence, with no icon, rule or ground — and that
 * `warning` is far from those palettes' accents (ΔE00 50.3 and 43.3 in neon and
 * radient). Recorded so the next palette edit meets the decision instead of
 * re-filing it, and so a future `warning` change knows what it is also changing.
 */
/*
 * THE TUI PORT'S FIVE ARE RECORDED THE SAME WAY, and they are lifts rather than
 * identities: githubLight, gruvbox, nord, oneDark and solarizedDark each author
 * their own `info` lifted in L* with hue and chroma held — the smallest lift that
 * clears this block's floors — at a measured cost of ΔE00 2.77, 1.79, 2.86, 1.12
 * and 3.31 from the signal itself. They are listed here because the script cannot
 * see a lift: it measures the value each palette authors, and the reason the five
 * are not their palette's `info` is a decision made once, in the palette file,
 * with its numbers. Re-measure there before moving `info`.
 */
export const COMMAND_TOKEN_PINNED = [
	{
		theme: "obsidian",
		against: ["ink", "accent"],
		got: 0.0,
		why: "monochrome: accent = ink = #FAFAFA. The run is separated by the semibold step, exactly as `functionName`/`className` are in code-mirror-theme.ts. Re-measure if ink or accent move.",
	},
];

export const SEPARATION_FLOOR = 15;

/*
 * The second accent's own chroma floor, and the reason it is a floor rather than
 * a preference: every separation assertion below can be satisfied by draining a
 * hue toward the ink, which is how a second accent becomes a second grey. It is
 * the same failure `highlight` recorded on the lightness axis - a step that buys
 * its ΔE00 on the wrong axis - so the axis is asserted, not just the distance.
 */
export const ALT_ACCENT_CHROMA_FLOOR = 15;

/*
 * `IDENTITY_PAIR_FLOOR` and `LIVENESS_PAIR_FLOOR` are declared beside
 * `PAIR_PINS`, above, because `const` does not hoist; the check that they are
 * still this file's `SEPARATION_FLOOR` and `SYNTAX_COMMENT_FLOOR` sits at the
 * foot of the run.
 */
/* The ink step's floor is the comment floor: see `INK_STEP_PINNED` for why it is
   the same number and for why five palettes are recorded below it instead of
   being moved. Declared here rather than beside the list because `const` does
   not hoist and the floor it names is declared at this point in the file. */
export const INK_STEP_FLOOR = SYNTAX_COMMENT_FLOOR;

/*
 * Two perceptual floors, because a field and a line are not the same problem.
 *
 * 2.0 was measured on adjacent ground FIELDS: sage's canvas/surface at 1.9
 * renders a visible card boundary and localOperatorLight's at 1.5 did not.
 * A 1px rule has almost no area for the eye to integrate over, so the same
 * distance vanishes - localOperatorDark's separator at 2.10 came out
 * byte-identical to the panel around it in the captured frame. 4.0 is the
 * point where every palette's rule reads as a rule while every hairline stays
 * between 1.16:1 and 1.92:1 against its grounds, which is what keeps it from
 * becoming a border - and that ceiling is asserted, not just described.
 *
 * `LINE_SEPARATION_FLOOR`'s 4.0 and `HIGHLIGHT_SEPARATION_FLOOR` below are the
 * same number for DIFFERENT reasons and are deliberately not collapsed into
 * one: a rule is a 1px line the eye has to find at all, and the selection ground
 * is a large plane the reader has to find while the pointer is somewhere else.
 * They are declared separately because they move for different measurements - a
 * change to either is a change to one job - and the numbers agree today by
 * coincidence of scale rather than by derivation. Raising the line floor must
 * not move the selection band, and vice versa.
 */
export const FIELD_SEPARATION_FLOOR = 2.0;

export const LINE_SEPARATION_FLOOR = 4.0;

/*
 * THE PANEL SEAM, and why it is measured with the FIELD floor on both sides.
 *
 * `shared/components/common/panel-edge.tsx` draws one 1px `hairline` at 75% on the
 * edge where a full-height panel meets the plane beside it - the operator's
 * 2026-10-30 report that neither sidebar has a readable edge in light themes.
 *
 * The seam is the EDGE OF A FIELD, not a rule across one. That is why it does not
 * take `LINE_SEPARATION_FLOOR`: the mark the reader reads is the boundary, and the
 * eye receives it as two stacked steps (panel to seam, seam to neighbour), each of
 * which has to be perceptible on its own. The seam is also deliberately quieter
 * than a section rule - that is what the alpha is for - while `hairline`'s own
 * 4.0 against every ground is asserted separately above and is untouched by a
 * composited copy at 75%. So both sides use `FIELD_SEPARATION_FLOOR` (2.0), the
 * same floor the ladder's adjacent steps answer to.
 *
 * MEASURED over the 59 palettes at 75%: the tightest own-ground pair is 2.92
 * (`ocean`, seam over `elevated`) and the tightest facing pair 2.29 (`gruvbox`'s
 * rail against an open pane). 70% failed the facing floor (`gruvbox`, 1.96), and
 * 75% is the lowest tenth that clears both. The alpha is pinned here, and the
 * shipped class is read back from `panel-edge.tsx` after the palette loop: this
 * file is the authority for the number, and the class must carry it (QA round 1,
 * Q-3).
 */
export const PANEL_SEAM_ALPHA = 0.75;

/*
 * THE BAND THE NOTIFICATION CLICK PAINTS (`styles/index.css`,
 * `.lo-team-bridge-target::after`): the `accent` role at `ARRIVAL_BAND_ALPHA`
 * over the surface, up for 1400 ms and then gone. It had no row here, which
 * meant a palette edit could put an 11-12 px `ink-dim`/`ink-muted` timestamp
 * under the AA floor, or invert the arrival against the row states it lands
 * beside, with every suite green (design review round 2, D6).
 *
 * TWO PROPERTIES, both of them measured facts about this surface rather than
 * taste:
 *
 *  - THE WASHED ROW'S INK. The row's metadata sits on the band, so it is
 *    measured on the band. `inkDim` was the round-1 candidate and it is NOT
 *    legal here: on the 12 % mix it is under 4.5:1 in ten of the fifty-nine
 *    palettes (cyberpunk 4.05:1, from 5.59:1 on the plain pane) — which is why
 *    the stylesheet lifts the washed row's dim utilities to `inkMuted` for the
 *    band's lifetime. This row is what holds that lift: `inkMuted` on the band
 *    clears the text floor in all fifty-nine (floor 5.21:1, nightfox).
 *
 *    BODY INK IS HELD AT THE TEXT FLOOR HERE, NOT THE STRONG-TEXT ONE, and that
 *    is a decision rather than a relaxation: the band is up for 1400 ms and then
 *    gone, while `ink`'s 7.0 ranking is written for the permanent grounds. On
 *    the band, 7.0 fails in four palettes (ayuDark 6.58, ayuMirage 6.49,
 *    catppuccinFrappe 6.58, solarizedDark 6.86) — all above AA, none of them a
 *    legibility defect — so the honest floor for a transient tint is the one
 *    that governs text at this size anywhere: 4.5. A palette that dropped body
 *    ink under THAT would fail here.
 *  - THE HIERARCHY. Arrival > the row the reader is ON > the row the pointer is
 *    over, in every palette. The bar is a DESIGN rank, so it is an inequality
 *    between two measured ratios, not a floor on one: a palette that raised
 *    `rowSelected` past the band would fail here even though every one of its
 *    own pairs still cleared its floor.
 *
 * THE ALPHA IS PINNED HERE AND READ BACK FROM THE STYLESHEET by the contract
 * (section 5a), the `PANEL_SEAM_ALPHA` pattern: this file is the authority for
 * the number, `evaluatePalette` asserts with it (so the composition engine's
 * solvers honour the band's rank), and the gate fails when `index.css` paints
 * another one.
 */
export const ARRIVAL_BAND_ALPHA = 0.12;

/** The (drawn-on, faces) pair each panel seam can produce, per palette. */
export const SEAM_PAIRS = [
	["surface", "canvas"],
	["surface", "elevated"],
	["elevated", "canvas"],
];

/*
 * THE REGION FLOOR, for two planes of the same kind meeting with no rule between
 * them. Declared separately from the two above for the reason the pair above is:
 * they move for different measurements, and a change to either is a change to one
 * job.
 *
 * 2.0 was calibrated on adjacent ground FIELDS "like a card sitting on a canvas"
 * - a small object with corners, where SHAPE does most of the work. Two
 * full-height regions of one window - the conversation and the drawer beside it -
 * have only the tone step and no shape cue, which is the same integration
 * argument the line floor below is built on, one step less severe: hence 4.0, the
 * number that argument already produced for a mark with almost no area to
 * integrate over.
 *
 * WHICH PAIR THIS IS FOR, and only that pair: the conversation's `canvas` against
 * the drawer's `elevated` (`pane-slot-ground`'s claim 1 reads the same two roles
 * out of the lane's own stops). The two candidate rungs it rules out are recorded
 * in `canvas/index.tsx`: `surface` merges with the sidebar and measures 2.05-6.76
 * against `canvas` itself - 31 of 59 palettes under 3.0 - and `sunken` is the
 * field floor with 0.0028 of headroom AND the pane's own recessed content ground.
 */
export const REGION_SEPARATION_FLOOR = 4.0;

/*
 * THE TWO ROW STATES, and the retirement of `highlight`.
 *
 * A list row wore two values that could not be told apart. Its hover was
 * `elevated` - a GROUND (dialogs, sheets, popovers, menus, tooltips, 57 files) -
 * which therefore could not be raised to meet a hover and on the dark family was
 * already at its ceiling: a hue-faithful raised fill cannot rise past `inkDim` at
 * its floor plus the headroom below, which is worth ΔE00 1.49-4.54 across the 41
 * dark palettes, while the app's own hover floor is ΔE00 2.0. The two states
 * therefore had a legal window of 0.53 ΔE00 on the median dark palette and a
 * CLOSED one on 19 of 41. Its selection was `highlight`, the panel's own cast,
 * which measured 4.01-6.05 ΔE00 off the panel with a separation of 2.02-5.35
 * from the hover - and on `neon` the two marks sat 1.80 ΔE apart while each was
 * ~6.2 ΔE off the panel, so the reader saw *a* state and could not see *which*.
 *
 * The replacement spends the axis the lightness budget does not consume. Both
 * roles are the smallest chroma at their own band floor in the palette's own
 * `accent` hue - the hue the theme already spends on its primary action, its
 * links and its focus ring - so a state can never be a colour the theme does not
 * have, and the fleet stops sharing one grey. The chroma is a TINT at BOTH ends:
 * below the band floor the mark is invisible, and past the outer bound it is a
 * saturated plane beside the panel (the 3.60x over-cast an earlier port shipped).
 *
 * THE FIVE BOUNDS, all asserted per palette and per role:
 *
 * 1. the ΔE00 band OFF `surface` - 4.0 for the hover, 6.0 for the selection;
 * 2. the separation between the two - 6.0, which is the half the operator's
 *    second report is about, and the light family (the one he accepted) ran
 *    5.59-8.44 so the floor sits just under behaviour he has already approved;
 * 3. the `L*` step off `surface` in the mode's raised direction - 1.5 for the
 *    hover, 3.0 for the selection and at least 0.5 beyond the hover's, because
 *    ΔE00 is a budget a chroma-only step can spend while moving the wrong way;
 * 4. the hue, within 12 degrees of `accent` (of the PANEL where the accent is
 *    greyscale - `obsidian` alone);
 * 5. the chroma ceiling, min(k x C*(accent), 24) with k = 0.6 for the hover and
 *    0.75 for the selection. These are the OUTER bounds the assertion holds; the
 *    WORKING TARGET a new value is authored to is min(0.5 x C*, 24) for the
 *    hover and min(0.6 x C*, 24) for the selection, which is what the values in
 *    the palettes mostly sit at after a first pass to the smaller chroma.
 *
 * Both roles must also stay ΔE00 2.0 clear of every GROUND they can be painted
 * beside (`canvas`, `sunken`, `elevated`, `accentWash`) - a state that reads as
 * another state is not a state - and every ink on the fill keeps its own floor,
 * which `GROUNDS6` above now measures for both of them.
 *
 * NO RATIO FLOOR IS ASSERTED ON EITHER FILL, deliberately. WCAG contrast is
 * luminance-only, and the axis this design spends is hue and chroma: the default
 * palette once PASSED a ΔE00 7.14 separation band while reading 1.003:1. The one
 * ratio here is on the non-colour mark - the 2px `accent` bar the selected row
 * carries - where SC 1.4.11 applies to a 2px graphic and the accent clears it on
 * every palette.
 */
/*
 * The hovered RUNG's own floor off the panel, which the ladder never asserted
 * directly - it measured only the 1.03 ratio - so a rung could sit 2.5 `L*` up
 * and still be ΔE00 1.58 from the panel (`rosewood`): a hover nobody can see, on
 * the one ground the row/hover ordering is about. The number is the app's
 * existing hover floor (`HOVER_DELTA_E`, stated for `accentWash`), because the
 * pointer's two marks are the same kind of signal.
 */
export const ELEVATED_PANEL_DELTA_E = 2.0;

/*
 * WHICH CHANNEL CARRIES WHAT, and it is the whole of this relaxation.
 *
 * `rowHover` is the POINTER's mark and it is LOAD-BEARING: it is the only
 * signal a hovered row gets, so it keeps the field floor.
 *
 * `rowSelected` IS RANKABLE NOW, and that is the refinement round's change of
 * contract. It used to be SUPPORTING: what said "you are here" was the 2px
 * `accent` bar on the row's leading edge plus `font-medium`, so the selection's
 * fill only had to be FINDABLE. The bar is GONE from the chat sidebar's rows -
 * the operator asked for it, and it also squared the row's leading edge, since
 * its square overlay painted over `rowStyle`'s `rounded-md` - so the FILL carries
 * the ranking, on the two axes a reader has: an `L*` rank (`ROW_STATE_HOVER_RANK`)
 * and a `C*` rank (`ROW_STATE_CHROMA_RANK`). `font-medium` stays as the one
 * non-colour mark, and the two POPUP bars (`slash-commands.tsx`,
 * `at-picker.tsx`) stay: their row is the one Enter applies, in a transient
 * popup where the keyboard has no other mark, and neither is a list a reader
 * scans for a persistent "you are here".
 *
 * THE BAND OFF `surface` IS WITHDRAWN RATHER THAN LOWERED, and it is a
 * measurement rather than a relaxation. With the hue and the chroma held at the
 * panel's own, the band the role was written for (ΔE00 4.0) is UNREACHABLE on
 * lightness: at the largest step the three ink floors allow it reaches 4.0 on 40
 * of the 59 palettes and bottoms at 2.08. The shipped rule only met its own band
 * by leaving the panel's colour family - the hue was the `accent`'s, and on 25
 * of the 59 that is more than 45 degrees off the panel - which is the operator's
 * report restated. What replaces it is the file's own field floor, ΔE00 >= 2.0
 * off `surface` (`FIELD_SEPARATION_FLOOR`, so a fill indistinguishable from its
 * own panel still fails), plus the two step floors and the two rank floors.
 *
 * THE CONSEQUENCE, stated so it is not discovered later: the achieved band's
 * median falls from 6.50 to 3.81 on the hover and from 10.95 to 4.26 on the
 * selection, and the pair's separation median from 6.78 to 6.01 - because 6.78
 * was bought by hue rotation. What rises with the withdrawal is what a reader
 * actually scans by: the `L*` rank goes from a median 1.30 to 1.62 and the `C*`
 * rank from an often-INVERTED sign to 2.50-11.46.
 */
export const ROW_PAIR_SEPARATION = 2.0;

/* How much further out the selection must sit than the hover, in `L*`. */
export const ROW_STATE_HOVER_RANK = 1.0;

/* ... and in `C*`, the axis the lightness budget cannot spend. */
export const ROW_STATE_CHROMA_RANK = 2.0;

export const ROW_STATE_WASH_FLOOR = 2.0;

/*
 * How much of the selection's step the hover has to spend, as a SHARE. Clause 2
 * of the operator's ask ("more should be a brightening against the backdrop") is
 * a relationship, not an absolute, and the measurement is why: the hover's step
 * is bounded by the budget the ink floors leave the SELECTION, so an absolute
 * floor high enough to state the clause would force the pair's rank under
 * `ROW_STATE_HOVER_RANK` on `catppuccinMacchiato`, `rosePine` and `palenight`
 * rather than buy anything. Today's hover spends 30% of its own available
 * headroom; the rule spends 65% of the selection's step, and the fleet's
 * achieved minimum is 0.56.
 */
export const ROW_HOVER_STEP_SHARE_FLOOR = 0.5;

/*
 * The hover's step is AUTHORED one 0.02 grid step above this floor, and the
 * relationship is stated because authoring AT the floor does not survive the
 * measurement: this file asserts the step on the AUTHORED HEX, and the 8-bit
 * round trip can land a value authored at exactly 1.50 at 1.49 - a value that
 * satisfies the rule and fails the gate that measures it. So § 4 authors
 * `step_hover` at `max(1.5 + 0.02, 0.65 x step_selected)`, the floor stays 1.5
 * here, and a rule-faithful value cannot land under it. The alternative (slack
 * on the floor assertion, the way the cast floors carry it) was refused: the
 * step is what a reader scans by, so the assertion stays sharp and the authoring
 * rule carries the grid rather than the gate carrying the slack. The fleet's
 * achieved hover minimum is 1.53, one grid step above this floor, which is what
 * that rule produces.
 */
export const ROW_HOVER_STEP_FLOOR = 1.5;

/*
 * The hover's floor, and now the selection's too. The selection sat at 3.0
 * while it had to out-rank the hover ON THE L* AXIS; the fill ranks it on BOTH
 * axes now, so the only floors left are the two that make the fill findable at
 * all, plus the share floor above. This is the constant that moves the row
 * window (above).
 */
export const ROW_SELECTED_STEP_FLOOR = 1.5;

export const ROW_SELECTED_STEP_CEILING = 5.0;

/*
 * THE CAST, and both halves of it are now asserted - which is the defect this
 * round inherits and fixes. Both floors below were declared and asserted
 * NOWHERE before it: the only chroma assertion on a row role was the ceiling,
 * so a state could desaturate to zero and pass every check. `tokyoNight`
 * measured it: `C*` 4.79 against a panel of 13.44 - 64% of the panel's cast
 * removed - and the ΔE00 7.05 the old band was scored on *was* that removal
 * (ΔL* +1.72 against ΔC* -8.65). A row less saturated than the surface it sits
 * on reads as a grey wash of that surface, which is the operator's report.
 *
 * BOTH HALVES ARE PANEL-RELATIVE, and the reference is the whole rule: the row
 * sits ON the surface, so the backdrop is what a reader compares it to. The
 * hover takes a FRACTION of the panel's cast and never more than the panel's;
 * the selection takes the panel's cast and up to 4 MORE - the one axis on which
 * a row may be more coloured than its backdrop, bounded, and what buys the
 * pair's rank where the ink floors leave no `L*` room. The absolute terms are the
 * cast-less panel's case and only that case: a panel with no cast to hold has no
 * hue to be faithful to (§ THE HUE below) and takes the rule's own floor.
 *
 * The accent's chroma is NOT a reference for either half any more. It was, and
 * `min(0.6 x C*(accent), 24)` permitted C* 24 on `tokyoNightStorm` (accent C*
 * 48.1 against a panel of 16.3) where the shipped hover sat at 22.4 - 1.4x its
 * own panel's cast, the loudest fill in the fleet, bought entirely on the chroma
 * axis so the band could be met without lighting the row.
 */
export const ROW_HOVER_CHROMA_FLOOR = 2.5;

/*
 * The hover's cast as a SHARE of the panel's: the rule authors it at 0.60 of the
 * panel's own cast, and this is the floor it may not fall below. Stated as the
 * fraction rather than as a chroma because the panel is the reference: a fill
 * less saturated than the surface it sits on reads as a grey wash of that surface
 * (`fix/row-state-cast-floor` measured exactly that at C* 4.79 on a panel of
 * 13.44, with the ΔE00 7.05 the old band was scored on *being* that removal).
 * Authored at 0.60 and floored at 0.50 is the margin the ink floors cannot eat:
 * the gap is worth 0.1 x C*(surface) of chroma, and the hex round trip's own
 * error is the slack beside it below.
 */
export const ROW_HOVER_CAST_FLOOR_SHARE = 0.5;

export const ROW_SELECTED_CHROMA_FLOOR = 5.0;

export const ROW_SELECTED_CHROMA_RISE = 4.0;

export const ROW_STATE_CHROMA_CAP = 24;

export const ROW_STATE_HUE_LIMIT = 12;

/*
 * THE HEX ROUND TRIP'S OWN SLACK, one term per side, because the authored value
 * is the hex the rule's triple RESOLVES to and 8-bit quantisation is not a
 * no-op. Measured over the 118 values this round authors:
 *
 *   - the FLOOR loses at most 0.40 of chroma (tokyoNightDay's hover, target 2.50
 *     measured 2.10, where the panel has no cast and the whole cast is the rule's
 *     own floor, so the grid is coarse relative to it);
 *   - the CAP gains at most 0.69 (highContrastLight's selection, target 4.00
 *     measured 4.69), and the same term covers the four palettes whose selection
 *     sits at the flat 24 (outrun 24.47);
 *   - the STEP ceiling gains at most 0.16 `L*` on the 15 palettes whose selection
 *     target is the whole 5.0.
 *
 * These are SLACK, not floors: a state that desaturates past the floor by more
 * than the grid can (the probe in the round's tests takes one to zero) still
 * fails, and the desaturations this round exists to fix - 60-77% below the panel's
 * own cast, measured across 39 of the 59 themes before it - fail by an order of
 * magnitude.
 */
export const ROW_STATE_CHROMA_FLOOR_SLACK = 0.45;

export const ROW_STATE_CHROMA_CAP_SLACK = 0.75;

export const ROW_STATE_STEP_SLACK = 0.25;

/*
 * THE AUTHORING HEADROOM, recorded rather than asserted.
 *
 * A new value is authored to leave this much room above the binding ink's floor
 * on the fill, at this file's own 0.15 of headroom, exactly as the retired role
 * did for the retired role. It is NOT a floor in this file, and the measurement
 * is why: the search that reaches the roles' bands consumes the fill's headroom
 * before it consumes the chroma ceiling, so a headroom floor would drop the
 * rule's reach below what the checks above reach at all. The floors that ARE
 * asserted on the fills are the system's own three ink weights, in the
 * `GROUNDS6` loop above.
 */
/*
 * THE NEUTRAL CLASS, and it is a class rather than a ledger of exemptions.
 *
 * A palette whose PANEL carries less chroma than `ROW_STATE_NEUTRAL_PANEL` has no
 * cast of its own for a state to be a state OF: the cast floors and ceilings
 * measure quantisation noise rather than a colour, and there is no panel hue to
 * be faithful to, so the fill takes the ACCENT's hue and the rule's own absolute
 * floors. That is the class, and it is the refinement round's re-keying: the
 * class used to be keyed on the ACCENT's chroma, which is a different question -
 * `obsidian` was its one member (an accent of #FAFAFA at C* 0) while its panel
 * carries C* 2.08, so obsidian is on the colour rule now and the class has seven
 * members, all by derivation rather than by name: `githubLight`, `gruvbox`,
 * `highContrastLight`, `iceberg`, `linen`, `oneLight`, `tokyoNightDay`.
 *
 * KEYS THE HUE AND THE WASH EXEMPTION, and nothing else any more. The chroma
 * floors and ceilings are absolute at the bottom of the range for every palette
 * (`max(2.5, ...)`, `max(C*(surface), 2.5)`), the step ceiling is asserted on
 * all 59 (the rule authors to it), and the band is the same field floor
 * everywhere. What the class still carries is exactly what a cast-less palette
 * cannot do:
 *
 *   - the HUE falls back to the accent's, which is the reference the operator's
 *     clause 3 asks for and the only one this palette has;
 *   - the WASH proximity is not asserted, because a palette with no cast has no
 *     cast with which to be a different colour from its own wash - the class no
 *     longer covers `obsidian`, and that is a ledger row below rather than a
 *     widening here.
 *
 * THE PAIR FLOOR IS NO LONGER RELAXED FOR THE CLASS. It was: the class's pair
 * floor was a collision floor (1.0) where the fleet asserts `ROW_PAIR_SEPARATION`
 * (2.0), and the seven members' pairs run 2.15-3.71 - every one of them clear of
 * the fleet's own floor, so the relaxation was DEAD CODE that a future cast-less
 * palette would have landed in as a silent escape rather than as a failure. It is
 * retired rather than left standing (design D8): the pair floor is the fleet's
 * for every palette, and a cast-less palette that cannot hold it is a ledger row
 * with a reading, which is the shape this file uses for every other bound a
 * palette genuinely cannot hold.
 *
 * THERE IS STILL NO PIN TABLE FOR A PALETTE THAT MERELY MISSES A BOUND, and the
 * thirteen rows the earlier round carried are why: they reconciled as four
 * separation-only, three chroma-ceiling breaches, one step-ceiling overshoot,
 * four `obsidian`'s and one `nightfox`'s band, and every one of them dissolved
 * into this rule. What exists below is not that: it is the two ledgers for what
 * the rule genuinely CANNOT hold, each row re-measured every run so a row cannot
 * outlive its cause (see `pinClaims`).
 */
export const ROW_STATE_NEUTRAL_PANEL = 2.0;

/* An accent below this chroma has no hue to speak with either. */
export const ROW_STATE_ACCENTLESS = 2.0;

/*
 * THE TWO LEDGERS, and they are LEDGERS rather than exemptions: every row names
 * the bound a palette cannot hold, and the assertion that would have failed
 * FAILS anyway unless the row is there - so a palette in this position cannot
 * arrive silently, and a row whose cause has gone is a failure too (the fleet
 * section at the end reads `pinClaims` for exactly that).
 *
 * THE FIRST TABLE IS GEOMETRY: the role's cast floor is ABOVE its cast ceiling,
 * so no value can hold both and the ceiling is the closest reachable. One row:
 * `synth`'s panel carries C* 26.83 against the rule's FLAT cap of 24, because a
 * panel can be louder than a row is allowed to be.
 *
 * THE SECOND TABLE IS A MEASURED SHORTFALL: the palette holds every bound the
 * rule states except ONE, and the row carries the reading. Three of the six are
 * the light family's `S_l` compression - CIEDE2000 divides a step at L* 90+ by
 * ~1.67, so a legal 2.8 `L*` step is worth ΔE00 1.67-1.95 off the panel - and
 * each one's row says which floor refuses it.
 */
export const ROW_STATE_FLOOR_UNREACHABLE = [
	{
		id: "synth",
		role: "rowSelected",
		reason:
			"the panel carries C* 26.83 against the rule's FLAT cap of 24, so the selection's cast floor (the panel's own cast) is above its ceiling and no authored value can hold both. The value sits at the cap, 3.45 chroma under the floor, and the ceiling is the constraint that refuses it - this palette's cast is louder than a row is allowed to be",
	},
];

export const ROW_STATE_MEASURED_SHORTFALL = [
	{
		id: "catppuccinMacchiato",
		role: "rowSelected",
		bound: "rank",
		measured: 0.94,
		reason:
			"the INK FLOORS are what refuse the rank: this palette's whole legal step is 2.68 L*, so the selection cannot rise past it and the hover cannot fall without putting `inkDim` under its floor on the hover instead. The pair still separates by ΔE00 6.96 and ranks 4.9 C*, so this is the one palette in the fleet whose pair is ranked by cast rather than by lightness - which is the point of adding the C* rank at all",
	},
	{
		id: "rosePineDawn",
		role: "rowHover",
		bound: "band",
		measured: 1.67,
		reason:
			"the fleet's minimum band, and it is the light family's compression at its worst: C* 2.7 puts the fill at the rule's own floor of 2.5, and at L* 94 the S_l term divides the 2.79 L* step down to 1.67. ITS CEILING IS 1.88, measured on this rule's own window: with the hover's cast held at the panel's own (C* 2.70, the rule's 2.5 floor), the largest hover the rule can author is bounded by its own clamp (`step_selected - 1.15` = 2.99 at the shipped selection step of 4.14, where `inkDim` is 5.02), and both that target and the looser rank bound above it (`step_selected - 1.0` = 3.14) resolve to the SAME 8-bit rung, `#F0EBE7` - a measured step of 3.14 and ΔE00 1.880 off `surface`. Raising the selection does not widen it either, because this palette's largest ink-legal step and the whole 4.10-4.30 band below it also resolve to one hex, `#F3E7DD`. Clearing the 2.0 field floor here needs the hover's cast OUTSIDE the window the rule names, and that is reachable at EITHER end, which is why this row's cause is not the ceiling alone: past it (C* 3.23 at step 2.99 measures ΔE00 2.03, 0.53 over the ceiling) or under its floor (C* 2.31 at step 2.94 is `#EFECE8`, ΔE00 2.01, 0.19 under the 2.5 floor) - both inside the slack the cap carries, which is the hex round trip's error and not a licence to sit outside the bound. So the class's floor on this palette is 1.9 and not 2.0, and if 2.0 is to hold here what changes is the floor's statement, not the value. The band's frame is committed and the disposition is a look judgement: at 1.67 it still reads as a mark",
	},
	{
		id: "gruvboxLight",
		role: "rowSelected",
		bound: "wash",
		measured: 1.44,
		reason:
			"the wash proximity: this palette's `accentWash` is accent-derived and carries C* 20.6 at L* 93, which is inside the window the selection's own cast (the panel's 15.5 plus 4) may occupy. The palette has a cast in both the panel and the accent, so it is not in the neutral class, and the two fills are the same kind of thing at the same depth",
	},
	{
		id: "obsidian",
		role: "rowHover",
		bound: "wash",
		measured: 1.38,
		reason:
			"the wash proximity on the palette the class was written for and no longer covers: `obsidian`'s panel carries C* 2.08, one hair INSIDE the colour rule where the class's threshold is 2.0, while its accent is #FAFAFA at C* 0 and its wash C* 1.36. There is no cast anywhere in this palette with which to separate two near-neutral fills, which is the class's own argument arriving at a palette the class's key no longer names - recorded here rather than widened there",
	},
];

export const CHART_HOVER_SEPARATION_FLOOR = 10;

export const CHART_HOVER_GROUND = "surface";

/*
 * And the other end. A hairline that clears the line floor by enough stops
 * being a hairline: `borderControl` is the role for an edge that asserts
 * itself, and this one is for an edge that merely divides. 2.0:1 is where the
 * twelve sit today - radient's 1.16:1 against `elevated` at the quietest,
 * tokyoNight's 1.92:1 against `sunken` at the loudest - so it fences the range
 * without moving anything.
 */
export const HAIRLINE_RATIO_CEILING = 2.0;

/*
 * And a floor on the same axis as the ceiling, because ΔE00 alone can be paid
 * in chroma and a 1px line cannot spend it.
 *
 * ΔE00 credits lightness, chroma and hue together, which is right for two
 * large fields: a blue plane beside a grey one of equal luminance is plainly
 * two planes. A rule one pixel wide is a different instrument - the display
 * resamples it, subpixel rendering and any compression in between attenuate
 * chroma far harder than lightness, and what survives is the luminance step.
 * radient's hairline cleared the ΔE00 floor at 5.60 with 40% to spare while
 * being 1.107:1 against `elevated`, and rendered at less than half the
 * strength of every other palette's.
 *
 * 1.15:1 is where the other eleven already sat (1.165 at the tightest), so
 * this fenced the axis while moving only the pair that failed it: radient's
 * hairline #313544 -> #343847, which takes it to 1.158:1 and ΔL* 4.56.
 */
export const HAIRLINE_RATIO_FLOOR = 1.15;
