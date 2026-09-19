#!/usr/bin/env node
/**
 * The theme contrast contract, executable.
 *
 *     node scripts/contrast-contract.mjs
 *
 * Loads every palette this app ships, recomputes each foreground x ground pair
 * the design system permits, and asserts the floors in `docs/branding.md` § 3.
 * Exits non-zero on a violation. No dependencies, plain `node` >= 18.
 *
 * ## Why this file exists
 *
 * With twelve user-selectable themes and no floor, unreadable colour is not an
 * oversight, it is the expected outcome. Measured against the light theme as it
 * shipped before this contract existed:
 *
 *   | Pair                                            | Ratio  |
 *   |-------------------------------------------------|--------|
 *   | `primary.main` #2BA458 as text on paper #FFFFFF | 3.20:1 |
 *   | a contained button's own label on its own fill  | 3.20:1 |
 *   | active sidebar item text on the sidebar ground  | 2.74:1 |
 *   | an input's only border against its own field    | 1.25:1 |
 *
 * None of those are adversarial cases. They are the default light theme's own
 * values, and they were invisible because nothing measured them. This measures
 * them, on every palette, on every run.
 *
 * ## What it asserts that a token-pair checker does not
 *
 *   1. **Component triples** (ground + fill + border + ink), not just pairs. A
 *      control's boundary is legal if EITHER its fill or its border clears 3:1
 *      against the ground behind it. That is what catches "the fill is 1.06:1
 *      and the border is 1.20:1, so the control has no perceivable edge".
 *   2. A colour used as a **background is treated as a ground**, so pointing a
 *      hover-fill token at a saturated accent fails here instead of shipping.
 *   3. Every accepted sub-floor pair is **pinned to its measured ratio**. An
 *      exemption is not a mute button: change the token and the pinned value
 *      stops matching, and the exemption is re-litigated.
 *
 * ## What it does not do, because a check's scope is itself a claim
 *
 * It asserts over the pairs and triples enumerated below. That enumeration is a
 * human judgement about what the system permits and is the part most likely to
 * be wrong — a pair nobody listed passes silently, which in the output is
 * indistinguishable from a pair that passes because it is legible.
 *
 *   - Adding a component means adding a row to `CONTROLS`. Green output on an
 *     unlisted component is not evidence about that component.
 *   - It computes sRGB ratios from flat hexes. It cannot see an alpha
 *     composite, a gradient, text over an image, or a colour a third-party
 *     widget (ag-grid, CodeMirror, mermaid) picked for itself. Those need a
 *     human and a screenshot.
 *
 * Do not read a clean run as "the app is accessible". Read it as "every
 * pairing we have written down still holds, on all twelve themes".
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deltaE, labToHex, r2, toLab } from "./color.mjs";
import { loadPalettes } from "./palette-source.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PALETTE_DIR = join(ROOT, "src/renderer/src/shared/themes/palettes");

/* ---- 1. the floors, from docs/branding.md § 3 -------------------------- */

const FLOOR = { strongText: 7.0, text: 4.5, nonText: 3.0 };

/* `inkDisabled` is the only exempt foreground: SC 1.4.3 exempts inactive
   controls, and a disabled control that meets 4.5:1 does not read as
   disabled. Every other ink is in scope on every ground. */
const EXEMPT_INK = new Set(["inkDisabled"]);

/* ---- 2. colour maths --------------------------------------------------- */

/** sRGB relative luminance, WCAG 2.1 formula. */
const lum = (hex) => {
	const h = hex.replace("#", "").trim();
	const full =
		h.length === 3
			? h
					.split("")
					.map((c) => c + c)
					.join("")
			: h;
	const [r, g, b] = [0, 2, 4].map((i) => {
		const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
	const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
	return (x + 0.05) / (y + 0.05);
};

/* A palette value that is not a flat hex — an `rgb()` scrim, a shadow — cannot
   be measured against a ground and is not a colour this contract governs. */
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const isHex = (v) => typeof v === "string" && HEX.test(v);

/* ---- 3. loading the palettes ------------------------------------------- */

/* Palette loading lives in palette-source.mjs so this gate and the CSS
   generator cannot read the same files differently. */

/* ---- 4. what the system permits ---------------------------------------- */

/** The four grounds every ink must be legible on. */
const GROUNDS = ["canvas", "surface", "elevated", "sunken"];

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
const INKS = [
	["ink", FLOOR.strongText],
	["inkMuted", 5.5],
	["inkDim", 5.0],
];

/* ---- 4a. the legibility pass: the six grounds, the ladder, the inks ---- */

/**
 * The SEVEN grounds an ink can sit on.
 *
 * `GROUNDS` above is the ELEVATION LADDER - four alternative grounds of one
 * panel, which is what every control's own row is measured against. This one
 * adds the three grounds that carry text as a STATE rather than as a surface:
 * `accentWash` (the selection/hover tint, callouts, chips, find-match), and the
 * two list-row states `rowHover` and `rowSelected`, which replaced the retired
 * `highlight`. Neither of the state grounds was in the ink loop before it was
 * added, which is how a keycap on a selected row and a reading button on a hover
 * could fail with every assertion in this file green: measured at the old scope,
 * `inkDim` was under its floor on `accentWash` in 17 dark and 11 light palettes,
 * and on the row role in 36 dark and 14 light.
 */
const GROUNDS6 = [
	"canvas",
	"surface",
	"elevated",
	"sunken",
	"accentWash",
	"rowHover",
	"rowSelected",
];

/**
 * The ground contract, authored as L* offsets from the lifted canvas.
 *
 * `canvas` is the page - the furthest-back surface, and the one the operator
 * reads for hours - so it has a hard FLOOR rather than a band with discretion:
 * no page ground in this app sits below L* 12. Measured, 20 of the 41 dark
 * palettes were below L* 10 and 8 below L* 5 (`obsidian` 2.51 at the bottom),
 * which is the "background behind the main text is too dark/black" report.
 *
 * 12.0 is one rung above GitHub Dark's #0D1117 (L* 4.95) and exactly VS Code
 * Dark+'s #1E1E1E (L* 11.26) - deliberately ABOVE GitHub's default, because
 * that is the departure the operator asked for; `docs/branding.md` § 2 records
 * the cost to the near-black palettes rather than hiding it behind a "best
 * practice" claim. The ladder's own budget is why 12 and not 8: at
 * canvas 12 / surface 17 / elevated 24 the three inks solve to L* 78 / 74 / 71
 * with every floor and every step intact, and below that the ladder and the ink
 * steps stop fitting together.
 *
 * The top of the ladder is capped at `elevated` 30 because an unbounded top
 * step is what makes the ink budget unaffordable: at `elevated` L* 34 an
 * `inkDim` at 5.0:1 needs L* 85 and the ink/hover distinction disappears into
 * the top of the ramp. The light side is capped at `canvas` 94 for the same
 * arithmetic from the other end: `elevated` at L* 100 is the end of sRGB's
 * ramp (four light palettes already sit there), the minimum canvas-to-elevated
 * spread is 2.5 + 2.5, so a canvas above 95 has no room for both steps - 94
 * leaves 1 L* of headroom for 8-bit rounding. `sunken` 80 is the same floor read
 * from the recessed side, and it is what keeps a light theme's keycap from
 * being painted on a well that is not there.
 */
const LIFT = {
	dark: { canvasMin: 12.0, canvasMax: 22.0, elevatedMax: 30.0 },
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
const STEP = {
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
const GROUND_STEP_DELTA_E = 2.0;
const GROUND_RATIO = 1.03;

/**
 * `ink` on `canvas` gets 8.0:1 rather than the 7.0 it gets elsewhere.
 *
 * `canvas` is the transcript - the one surface in this app that is read for
 * hours at arm's length - so it is the surface the operator's own report is
 * about, and the extra 1.0 moves four palettes. The weakest at the old scope
 * was `rosePineDawn` at 7.53:1.
 */
const INK_CANVAS_FLOOR = 8.0;

/** The step between the three ink weights, which is what makes them a ladder. */
const INK_STEP_DELTA_E = 2.0;

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
 * measured on all six grounds and moves only when the pair itself collapses.
 * At the old values the factor ran 0.39-0.54, so 0.80 is generous by design: it
 * catches a collapse rather than policing a margin.
 */
const DISABLED_CEILING = 0.8;

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
const SELECTION_DELTA_E = 3.0;
const SELECTION_LIGHTNESS_STEP = 2.0;

/**
 * The hover tint's own floor: half a selection's, because a hover is transient
 * and is paired with the pointer.
 */
const HOVER_DELTA_E = 2.0;

/**
 * The keycap's ground against everything it can be painted on.
 *
 * `sunken` is the keycap's ground and a keycap is an annotation on the row a
 * user has just SELECTED, so the pair that decides whether it survives is
 * `sunken` against the state grounds. Measured at the old scope: 1.13 ΔE00
 * on `accentWash` in `tokyoNightDay` and 1.81 in `ayuLight` - a cap whose
 * ground disappears under it on the light themes where it is weakest.
 */
const KEYCAP_DELTA_E = 2.0;

/**
 * Component triples: the ground a control sits on, its own fill, its border,
 * and its ink. A control is legal when its ink clears the text floor against
 * its own fill, AND its edge is perceivable — fill OR border clearing 3:1
 * against the ground behind it.
 */
const CONTROLS = [
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
	{
		name: "outline control",
		on: GROUNDS,
		fill: null,
		border: "borderControl",
		ink: "ink",
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
		 * control: `message-input.tsx` paints the composer box `bg-surface` with
		 * `border-control` and, in this state, its ink `ink-disabled`
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
		 * What this asserts is therefore the control's EDGE (fill or border against
		 * each of the four grounds), which is in scope for every state, plus the
		 * claim that the ink in use IS the exempt one - `EXEMPT_INK` in the loop
		 * below. The composer keeps its boundary while it refuses, which is what
		 * keeps the box visible as a box at exactly the moment its ink goes quiet.
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
		 */
		name: "composer (read-only)",
		on: GROUNDS,
		fill: "surface",
		border: "borderControl",
		ink: "inkDisabled",
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
		 */
		name: "primary button on the danger wash",
		on: ["dangerWash"],
		fill: "accent",
		border: "accent",
		ink: "onAccent",
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
		 * `surface` is the ground the composer box paints (`COMPOSER_BOX`,
		 * `border-control` on `bg-surface`), and the rows above cover `canvas` for
		 * the same component wherever it is drawn on a bare page.
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
		on: ["canvas", "surface"],
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
		on: ["canvas", "surface"],
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
		 * renders inside the tab button, whose fills are the page's `canvas` (the active
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
		on: ["canvas", "sunken", "elevated"],
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
		on: ["canvas", "sunken", "elevated"],
		fill: null,
		border: "borderControl",
		ink: "inkMuted",
	},
	{
		name: "browser restored marker pill",
		on: ["canvas", "sunken", "elevated"],
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
		 * active tab it sits on the page's own `canvas`. It used to name `surface`,
		 * which no longer occurs beneath it — a row asserting the wrong grounds is the
		 * "green output about a component nobody listed" case.
		 */
		on: ["canvas", "sunken", "elevated"],
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
		// `canvas` (active) or the strip's `sunken` (inactive).
		on: ["canvas", "sunken", "elevated"],
		fill: "dangerWash",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The strip's ACTIVE tab: the PAGE's own ground (`canvas`) on the strip's
		 * `sunken`, bounded by `border-control` on the three edges it has (design
		 * round 3, D18; re-specified with the tab-strip grammar, spec §6). It has its
		 * own fill and edge, so by this file's first rule it has a row - and the row is
		 * the point: the ground step alone is 1.11:1 in the dark palettes, which is a
		 * depth cue rather than a marker, so `border-control` is what has to clear the
		 * 3:1 non-text floor. Measured this round: `borderControl` on `sunken` is
		 * 3.13:1 at worst (iceberg), and `ink` on `canvas` 9.66:1 at worst.
		 *
		 * `on` no longer lists `surface`: the INACTIVE tab has no fill any more, so the
		 * only ground this edge borders is the strip's own `sunken`. Keeping a stale
		 * `on` would keep measuring the component against a ground it is not drawn on,
		 * which is the failure mode a green run cannot report.
		 */
		name: "browser active tab",
		on: ["sunken"],
		fill: "canvas",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The numbered badge on the Approvals control (spec §5.1). `warningWash` is
		 * already this feature's one meaning - "an agent is blocked on you" - and
		 * `border-control` is the contract's own answer for its edge: `warningBorder`
		 * measures 2.51-2.98:1 on graded grounds in seven palettes (the sibling row
		 * above records the measurement).
		 *
		 * ONE GROUND, and finding that it was two is design round 1's D8: the second
		 * entry was `surface`, reasoned as "the chat pane header's ground when PR 2 puts
		 * the control there" - and PR 2 put it on the chat header's `canvas` and on the
		 * pane header's `sunken`, so the row was measuring the component against a
		 * ground it is never drawn on, which is the failure mode the row above this one
		 * explicitly names. Both hosts' badges are drawn on `canvas` (the URL bar row is
		 * `bg-canvas`, the chat header is the same); the pane's own header carries no
		 * badge, and if one ever lands there its ground (`sunken`) is a row this file
		 * would have to grow rather than quietly inherit. Measured this round: `ink` on
		 * `warningWash` 8.39:1 at worst (tokyoNight), `borderControl` 3.34:1 on `canvas`
		 * at worst.
		 */
		name: "browser approvals badge",
		on: ["canvas"],
		fill: "warningWash",
		border: "borderControl",
		ink: "ink",
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
		on: ["canvas"],
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
		 * The user's message bubble in the transcript.
		 *
		 * `on` names `canvas` because that is the ground the bubble is drawn on
		 * and therefore the ground its edge floor is measured against: the
		 * transcript renders inside the chat column, and that column is the
		 * working surface, `canvas` (see chat-content.tsx). It used to say
		 * `surface`, matching a surface-coloured column - a stale `on` would keep
		 * measuring this component against a ground it is no longer drawn on,
		 * which is the failure mode a green run cannot report.
		 *
		 * The bubble keeps its own `surface` fill, so it now has a lightness step
		 * against the column as well as its border. The border is still what
		 * makes the edge structural: the agent side renders no bubble at all, so
		 * this edge is the whole distinction between the two speakers. A step is
		 * not an edge, and the fill alone cannot carry it - a ground is not
		 * supposed to clear 3:1 against the next ground.
		 *
		 * NOTE what this row does and does not buy. It asserts the PALETTE
		 * pairing - that the bubble's edge clears the structural floor on the
		 * ground behind it in all twelve themes - which here resolves through
		 * `borderControl`, since `surface` on `canvas` is only a few ΔE00. It
		 * cannot see which class the component actually renders, because this
		 * script only reads palettes. The call site is asserted separately by
		 * `STRUCTURAL_CALL_SITES` below, which is what would fail if someone
		 * changed the bubble back to `hairline`.
		 */
		name: "user message bubble",
		on: ["canvas"],
		fill: "surface",
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
	 * Only `surface` is asserted, and that is not laziness: the wheel has
	 * exactly one mount site, inside `COMPOSER_BOX`, which is `bg-surface`.
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
		on: ["surface"],
		fill: null,
		border: "info",
		ink: "inkMuted",
	},
	{
		name: "context wheel, worth noticing",
		on: ["surface"],
		fill: null,
		border: "warning",
		ink: "inkMuted",
	},
	{
		name: "context wheel, compaction due",
		on: ["surface"],
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
const ADJACENT = [
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
const GRAPHICS = [
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
		on: ["canvas", "accentWash"],
		fg: role,
	})),
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
const PERCEPTIBLE = [
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
		 * THE PAIRING DEPENDS ON THE BOX KEEPING `bg-surface`, which is why
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
		on: ["surface"],
		minDeltaE: 2.0,
		pairedWith: "warningWash",
		maxWeightChange: 2.0,
		against: "surface",
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
		on: ["surface", "sunken"],
		minDeltaE: 2.0,
		pairedWith: "sunken",
		maxWeightChange: 2.0,
		against: "surface",
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
const STRUCTURAL_CALL_SITES = [
	{
		/*
		 * WHY THIS PIN EXISTS ALONGSIDE THE PALETTE ROW. The row
		 * "primary button on the danger wash" proves a filled control is legal on the
		 * wash the failure alert is painted on; only this pin can see the edit that
		 * moves the alert's retry back to `outline`, whose sole boundary would then be
		 * `border-control` against that wash - 2.98:1 in iceberg, under the 3:1 floor,
		 * with sage and localOperatorLight behind it (design round 2, D10).
		 */
		what: "the failure alert's retry is a filled control on the wash",
		file: "src/renderer/src/shared/components/common/update-error-alert.tsx",
		must: 'variant="primary"',
		why: "an outlined control's only boundary is its own edge against `dangerWash`, which is below the 3:1 floor in three palettes; the palette rows cannot see which variant a component uses, so green output about the pair would outlive the fix",
	},
	{
		/*
		 * The approvals dock's left edge. It is the sole boundary between the app's own
		 * approvals chrome and a LIVE PAGE, which is why it is `border-control` rather
		 * than the `hairline` the canvas dock uses to separate two app surfaces. The
		 * palette rows prove `borderControl` clears 3:1 on every ground; only this pin
		 * can see the edit that removes it, and that edit leaves every ratio above
		 * green while the two surfaces become one (spec §4.2).
		 */
		what: "browser approvals dock edge",
		file: "src/renderer/src/features/browser/components/browser-approvals-dock.tsx",
		must: "border-control border-l bg-surface",
		why: "the dock's edge is the only thing separating the app's approvals chrome from the page it narrows; dropping to `hairline` (no floor) or removing it merges them, and no palette assertion can see it",
	},
	{
		/*
		 * The active tab's three edges. The tab takes the page's own ground, whose step
		 * away from the strip's `sunken` is 1.11-1.4:1 - a depth cue, not a marker - so
		 * the `border-control` edge is what makes the selected tab survive a glance
		 * (design round 3, D18; spec §6). Reverting it to `border-transparent` (what the
		 * tab looked like as a button) or to `hairline` keeps the palette rows green.
		 */
		what: "browser active tab edges",
		file: "src/renderer/src/features/browser/components/browser-tab-strip.tsx",
		must: "border-control border-x border-t bg-canvas text-ink",
		why: "the active tab's only marker a glance can find is its `border-control` edge; the ground step alone is a depth cue that measures under 1.4:1 in every palette",
	},
	{
		/*
		 * The mention chip's ground, at its call site.
		 *
		 * The palette rows prove `surface` -> `sunken` is a step worth drawing; only
		 * this pin can see the edit that removes it - swapping the chip's fill for a
		 * role that IS the ground (`surface`) leaves every ratio green while the chips
		 * simply stop being visible, and the `PERCEPTIBLE` row above cannot see which
		 * role a component paints.
		 */
		what: "mention chip fill",
		file: "src/renderer/src/features/chat/components/at-mention-overlay.tsx",
		must: 'MENTION_CHIP_ROLE = "rounded-sm bg-sunken"',
		why: "the fill IS the chip's boundary - it takes no edge by design - so repainting it as the ground it sits on erases every mention in a sentence with no palette assertion able to see it",
	},
	{
		/*
		 * The outside-workspace chip's fill, pinned for the same reason from the other
		 * side: the row above proves `warningWash` is a perceivable step from
		 * `surface`, and nothing else proves the composer still USES it. An edit that
		 * dropped this state would leave a path outside the workspace looking exactly
		 * like one inside it, which is a claim about the containment question the
		 * composer would then be making silently.
		 *
		 * The pin spans the WHOLE class list, including the `border-warning-border`
		 * edge, because the edge is half of what makes the state visible in the three
		 * palettes whose two washes are one hue (design round 1, D1): dropping it
		 * would keep every palette row green while the state went back to being
		 * carried by a step those palettes do not have.
		 */
		what: "mention chip outside-workspace fill",
		file: "src/renderer/src/features/chat/components/at-mention-overlay.tsx",
		must: 'MENTION_CHIP_OUTSIDE_ROLE =\n\t"box-border rounded-sm border border-warning-border bg-warning-wash"',
		why: "the hue step plus its edge are the composer's signals that a reference will be judged outside the workspace; flattening either to the ordinary fill keeps every contrast ratio green while the state disappears",
	},
	{
		/*
		 * The composer box's own ground, which the chip's step is measured AGAINST.
		 * Two roles decide the chip's legibility and only one of them is in the chip's
		 * file: this pin closes the half a later edit could move - repainting the box
		 * `canvas` collapses the same fill step to 1.23 ΔE00 in `obsidian`, below the
		 * row's floor, and the row cannot see the box at all.
		 */
		what: "composer box ground",
		file: "src/renderer/src/features/chat/components/message-input.tsx",
		must: "border border-control bg-surface",
		why: "the mention chip's fill step is measured against `surface`; `sunken` against `canvas` is 1.23 ΔE00 in obsidian, so the box's ground is half of that assertion and no palette row can see it",
	},
	{
		what: "chat working surface ground",
		file: "src/renderer/src/features/chat/components/chat-content.tsx",
		must: "overflow-hidden rounded-none bg-canvas",
		why: "the working surface takes the PAGE ground so it steps away from the `surface` list panel beside it; repainting this column `surface` merges the two into one slab and no palette assertion can see it",
	},
	{
		what: "chat list panel ground",
		file: "src/renderer/src/features/chat/components/chat-sidebar.tsx",
		must: "flex-col bg-surface p-2 text-ink",
		why: "the list panel takes the `surface` panel ground so it steps away from the `canvas` working surface it opens; repainting this panel `canvas` produces the same merged slab from the other side, which the column's own row cannot see",
	},
	{
		what: "user message bubble edge",
		file: "src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		must: "border border-control bg-surface",
		why: "the bubble is drawn on the canvas-coloured working surface and keeps its own surface fill; the agent side has no bubble, so this border is the edge that distinguishes the speakers",
	},
	{
		what: "chat header bottom rule",
		file: "src/renderer/src/features/chat/components/chat-header.tsx",
		must: "border-control border-b",
		why: "in a packaged build this rule is the only thing separating the header from the transcript",
	},
	{
		/*
		 * The palette rows above prove `inkDim` clears 3:1 on every ground. They
		 * cannot see which class the dotted rule actually renders, and the whole
		 * defect here was the class: `border-ink-disabled`, a role deliberately
		 * exempt from every floor, on the one mark that distinguishes "reports
		 * nothing" from "at zero". Reverting that one word would keep every
		 * palette assertion green.
		 */
		what: "usage unmeasured window rule",
		file: "src/renderer/src/features/chat/pickers/usage-view.tsx",
		must: "border-ink-dim border-t border-dotted",
		why: "the dotted rule is the whole distinction between a window that reports nothing and one at zero, so it is structural and cannot ride the floor-exempt disabled role",
	},
	{
		/*
		 * The quota bar's track.
		 *
		 * `sunken` on `surface` is 1.11:1 in the dark brand palette, so the fill
		 * has no perceivable container: at 0% the row reads as blank card and at
		 * 100% as a coloured rule rather than a full meter. The track is the
		 * reference the fill is measured against, so removing it loses
		 * information — structural by § 2's own test, and therefore on the 3:1
		 * floor that only `border-control` carries.
		 *
		 * Pinned at the call site because `hairline` is the tempting weight here
		 * and it CANNOT work: the contract caps a hairline below 2:1 by design.
		 * Measured on a rendered frame, a hairline moved the track from 1.11:1 to
		 * 1.15:1 — a change that looks like a fix in the diff and is not one on
		 * screen.
		 */
		what: "usage bar track boundary",
		file: "src/renderer/src/features/chat/pickers/usage-view.tsx",
		must: "border border-control bg-sunken",
		why: "the track is the reference the fill is read against, so at 0% and 100% it is the only thing distinguishing a meter from blank card or a coloured rule",
	},
	{
		/*
		 * The install meter's track.
		 *
		 * Same defect as the quota bar's above, found from a frame rather than from
		 * the palette: the sidebar's install progress rendered as a uniform 4px rule
		 * with no fill and a `sunken` track, measured at 1.15:1 in
		 * localOperatorLight, ~1.3:1 dark and ~1.4:1 in neon — fainter than the
		 * app's own section hairline in the same frame (1.33:1), so at 0% the bar
		 * read as blank space and at 100% as a coloured rule (design round 1, D2).
		 *
		 * Pinned at the call site for the same reason as the quota bar: the palette
		 * rows prove `borderControl` clears 3:1 on every ground, and cannot see which
		 * class the bar actually renders. Pinned WITHOUT the `h-1.5` step, which is
		 * the geometry rather than the role, so a height change does not fail the
		 * assertion that matters.
		 */
		what: "install meter track boundary",
		file: "src/renderer/src/features/agents/components/install-builtin-agents.tsx",
		must: "border border-control",
		why: "the track is the reference the fill is read against, so it carries information and belongs on the 3:1 floor; the primitive's own `sunken` track measures under 1.3:1 everywhere, which is indistinguishable from a blank row",
	},
	{
		/*
		 * The rule under a scrolling picker body.
		 *
		 * It shipped as `hairline` and measured 1.08:1 dark / 1.03:1 light
		 * against the body above it and 1.01:1 against the footer below — below
		 * its own visibility floor, on the element that is the ENTIRE answer to
		 * "is there more below". By § 2's test (would removing it lose
		 * information?) that makes it structural, which is the 3:1 floor only
		 * `border-control` carries. Pinned at the call site for the same reason
		 * as the track above: `hairline` is the tempting weight here and the
		 * contract caps it below 2:1 by design, so reverting the word would keep
		 * every palette assertion green.
		 */
		what: "picker scrolling body fold",
		file: "src/renderer/src/features/chat/pickers/picker-host.tsx",
		must: "border-control border-b",
		why: "this rule is the whole signal that a scrolling body continues past the fold, so it cannot ride a decorative weight that is invisible against both neighbours",
	},
	{
		/*
		 * The picker's option-row grounds, pinned because no palette assertion can
		 * see a class and every one of them stays green either way.
		 *
		 * The row shipped as `bg-elevated` inside a dialog whose own ground is
		 * `bg-elevated` — measured 1.000:1, ΔE00 0.00, so hover, the keyboard
		 * highlight and "which row will Enter pick" were all invisible (design D1,
		 * the operator's own report). The selection ground is `sunken`, which the
		 * adjacent-ground row above already asserts as a perceptible step from
		 * `elevated` in all twelve themes. It is NOT `accent-wash`, the sibling
		 * composer popup's tint and the first candidate: `accent-wash` collapses
		 * onto `elevated` in obsidian (ΔE00 0.77, ratio 1.01), and is 3.74
		 * tokyoNight / 3.99 dracula / 4.88 dune — so it would reproduce the original
		 * defect on whichever palette the user happens to run. The wash keeps the
		 * pointer's role instead, with the structural edge below carrying the floor
		 * it cannot.
		 */
		what: "picker option row selection ground",
		file: "src/renderer/src/features/chat/pickers/picker-host.tsx",
		must: 'isActive && "bg-sunken"',
		why: "the row is drawn inside a dialog on the same ground it used to paint, so the class is the whole fix; reverting it to `bg-elevated` restores a 0.00 ΔE00 selection and keeps every palette row in this file green",
	},
	{
		/*
		 * The command palette's active row: the third sibling, and the one the
		 * operator screenshotted.
		 *
		 * `picker-host` fixed its keyboard row (design D1) and the slash popup gave
		 * its active row a 2px accent bar, both because the accent wash is not
		 * perceptible on a dialog's own ground in every palette - `obsidian` ΔE00
		 * 0.77, `everforest` 1.42, `catppuccinMocha` 1.51 - and the command
		 * palette's active row kept the wash alone. Measured on the operator's own
		 * frame, the row PASSED the separation band at ΔE00 7.14 while reading
		 * 1.003:1, so this pin is not about a threshold: it is about the row being
		 * the panel's own colour in a step, with a non-colour mark beside it.
		 *
		 * `sunken` + `outline-control` is the picker's own answer for the same
		 * gesture, so the two rows of the same family cannot drift apart again. The
		 * ground half is asserted by this file's selection row (ΔE00 >= 3.0 and a
		 * >= 2 L* step from `elevated`, measured 6.07-16.18 across all 59); this pin
		 * is the half no palette assertion can reach - the composed class string at
		 * the call site, where either token can be dropped while every palette row
		 * stays green.
		 */
		what: "palette active row mark",
		file: "src/renderer/src/features/command-palette/components/command-palette.tsx",
		must: 'isActive\n\t\t\t\t\t? "bg-sunken outline-solid outline-1 -outline-offset-1 outline-control"',
		why: "the dialog's ground and the row's ground are the same family, so the row's mark is the whole fix; reverting it to the accent wash alone restores a 1.003:1 selection on the default palette and keeps every palette assertion in this file green",
	},
	{
		what: "picker option row pointer tint",
		file: "src/renderer/src/features/chat/pickers/picker-host.tsx",
		must: 'isHovered && !isActive && "bg-accent-wash"',
		why: "the pointer's mark is deliberately a different ground from the selection's, so the two states are distinguishable and a highlight left by the pointer cannot read as the keyboard's; cleared by the listbox's own onMouseLeave (design D2)",
	},
	{
		/*
		 * The picker row's STRUCTURAL mark, and the other half of design D12.
		 *
		 * The tint above is pinned because it is a deliberate state; it is NOT
		 * enough on its own, and this pin is what says so. `accent-wash` is ΔE00
		 * 0.77 on the dialog's own ground in obsidian — no mark at all — and
		 * perceptibility is a property of the role pair, not of the class string,
		 * which is exactly how the gate stayed green while the pointer gave no
		 * feedback in four of twelve themes. `outline-control` is the structural
		 * answer: the CONTROLS entry `picker row pointer mark` asserts its 3:1 floor
		 * on this same ground, so a palette edit that collapsed the edge fails the
		 * role assertion and an edit that drops the edge fails this one. Reverting
		 * this expression to the tint alone is what the two pins catch together.
		 */
		what: "picker option row structural mark",
		file: "src/renderer/src/features/chat/pickers/picker-host.tsx",
		must: 'isPicked || (isHovered && !isActive)) &&\n\t\t\t\t\t"outline-solid outline-1 -outline-offset-1 outline-control"',
		why: "the pointer's mark and the in-flight mark must be perceivable in every theme, which a wash-based mark is not: the role it needs is asserted as `picker row pointer mark` above, and this pin is what proves the row renders it (design D12)",
	},
	{
		what: "context wheel empty track role",
		file: "src/renderer/src/features/chat/session-status/context-wheel.tsx",
		must: 'hasArc ? "stroke-sunken" : "stroke-hairline"',
		why: "PERCEPTIBLE measures hairline against sunken; nothing otherwise proves the component renders those two roles, and one token here reproduces D7 behind a green gate",
	},
	{
		/*
		 * The combobox's active row, on the same ground and for the same reason
		 * the picker's mark above carries one: `accent-wash` is dE00 0.77 on
		 * `elevated` in obsidian, so the keyboard's selected row had no visible
		 * mark there. The role lives in the CONTROLS row
		 * `combobox option active mark`; this pin is what proves the component
		 * still paints it, because a palette assertion cannot see a class that
		 * was dropped at the call site.
		 */
		what: "combobox option row structural mark",
		file: "src/renderer/src/shared/components/ui/searchable-select.tsx",
		must: '"bg-accent-wash outline-solid outline-1 -outline-offset-1 outline-control"',
		why: "the active row must be perceivable in every theme, which a wash-based mark is not: the role it needs is asserted as `combobox option active mark` above, and this pin is what proves the row renders it",
	},
	{
		/*
		 * The chat sidebar's CURRENT-ROW ground, and the operator's own report:
		 * "the sidebar doesn't visibly highlight the selected conversation".
		 *
		 * Every row in that panel is drawn on `surface`, and the ground every
		 * current-row state used was `accent-wash` — ΔE00 1.05 against it in
		 * tokyoNight (#262B3F on #24283B), which is no mark at all, while the
		 * hover step the same rows carry (`elevated`) measures 4.58 there. The
		 * pointer therefore read as the current row and the current row did not.
		 * Contrast is equally useless as an instrument here: the two colours
		 * differ in hue rather than luminance, so the pair reads 1.04:1.
		 *
		 * WHY A ROLE OF ITS OWN, AND NOT A PALETTE ROW FOR THE WASH. `accent-wash` is
		 * not invisible everywhere: the app rail paints it on `sunken`, where it
		 * measures 9.6 in tokyoNight, and the settings rail is the OTHER `surface`
		 * panel and takes the same role (the pin below). Strengthening the role
		 * would make every hover tint in the app louder to fix the panels that draw
		 * it on `surface`. A role of their own was the alternative, and it is what
		 * shipped: the ROW-STATE pair, `rowHover` and `rowSelected`, asserted against
		 * `surface` at their own band floors, against each other at the separation
		 * floor, and against `elevated`, `sunken` and the wash at the field floor in
		 * the loops above. The two roles retired the wash AND the `elevated` step the
		 * neighbouring rows used to carry — `elevated` is a ground (it is every menu,
		 * popover and tooltip in the app), so it could never be raised to meet a
		 * hover, and the operator reported it twice as a whisper.
		 *
		 * WHY NOT `sunken`, WHICH IS WHAT THIS ROW SPENT A ROUND ON. `sunken` is
		 * RECESSED — a well, not a mark — and 3.75-14.94 from `surface`, which is
		 * the dark box the operator reported. It is also the role 97 `*-sunken`
		 * utility occurrences across 66 files under `src/renderer` depend on being
		 * deep (85 live class usages and 12 inside prose, the palettes and the
		 * generated stylesheet excluded), so the row could not be quietened by moving
		 * it.
		 * What no palette assertion can see is the CLASS on the row, which is how
		 * that shipped: every row in this file stayed green while painting a ground
		 * the user could not see, and later while painting one that shouted.
		 * Reverting this line to a wash, to a ground role, or to the retired
		 * `highlight`, fails here and nowhere else in THIS file
		 * (`scripts/chat-sidebar-selection.test.mjs` catches it too, by resolving
		 * the row's own class expression through the shipped `cn`); a palette edit
		 * that collapsed `rowSelected` onto `surface`, `elevated`, `sunken` or the
		 * wash fails the row-state loops above.
		 *
		 * AND WHY THE WEIGHT AND THE BAR ARE IN THIS PIN, NOT JUST THE ROLE. The
		 * rows around a current one now carry `hover:bg-row-hover`, whose own floor
		 * (ΔE00 4.0 off `surface`) is asserted above — but the fills are one hue at
		 * two strengths, so the last increment of "which one am I on" is not a colour
		 * distance at all. It is `font-medium` plus a 2px `accent` bar on the row's
		 * leading edge, and the bar is why `relative` is in the literal too: the bar
		 * is absolutely positioned, so the element that carries the role is also its
		 * containing block. The 1px `outline-control` boundary an earlier round put
		 * beside the ground stays RETIRED (it is § 2's *sole boundary of a control*
		 * and rendered as the search field above the list — design round 1, D3), so
		 * the pin below is what holds the non-colour half of the mark now.
		 *
		 * The `hover:` half is part of the ground, not decoration: `rowStyle`
		 * carries `hover:bg-row-hover`, and the hover variant outranks a bare
		 * background in the cascade, so without it the pointer REPLACED the
		 * selection ground on the row the user is on — the two fills are both steps
		 * off `surface` on the dark family rather than opposites, so hovering the
		 * current row would erase it (in obsidian the retired pair, wash and
		 * `elevated`, were ΔE00 0.77 apart). The class is one shared constant for
		 * all four current-row states in this panel (the selected conversation, the
		 * All chats filter, the New chat row and the entity row staging a draft), so
		 * pinning the declaration is what holds all four. It is EXPORTED since round
		 * 5 (design D22, agent A-7) and imported rather than restated by the settings
		 * rail, the app rail, both agent rosters and the agent-categories sidebar,
		 * which is why the pin is here and each of those surfaces is left to the
		 * component guard. The pinned text is the literal as the formatter writes it,
		 * on ONE line: a term change has to fail this file until the palette half is
		 * re-measured, and that is the whole point of the pin.
		 */
		what: "chat sidebar current-row ground",
		file: "src/renderer/src/features/chat/components/chat-sidebar.tsx",
		must: 'export const rowCurrent =\n\t"bg-row-selected font-medium text-ink hover:bg-row-selected";',
		why: "the panel's ground is `surface`, where a wash selection is invisible in tokyoNight (ΔE00 1.05) and `sunken` is a 3.75-14.94 recessed box; `rowSelected` is the role authored for the row the reader is ON, and a bare background loses to `rowStyle`'s `hover:bg-row-hover` on the row the user is already on; no palette assertion can see a class, so this is the only place in this file that can catch the wrong ground or a lost second signal arriving. The second signal is `font-medium` ALONE since the refinement round: the 2px `accent` bar was removed from this constant (the operator asked for it, and its square leading edge was what squared the row's 6px corner), and the fill now ranks the pair on `L*` and on cast - which is what the role's own doc says and what `scripts/chat-sidebar-selection.test.mjs` resolves this literal for",
	},
	{
		/*
		 * The row the operator reported, pinned as the EXPRESSION rather than the
		 * ground: a later reader can leave the shared constant intact and still
		 * un-mark the conversation — by dropping the reference, or by weakening
		 * the predicate so the row never reaches it. Both are this substring.
		 *
		 * `!activeDraftKey` is in the pin because it is the same term the row's
		 * `aria-current` reads: the row may not paint a ground the accessibility
		 * tree does not claim, and it may not claim one it does not paint.
		 *
		 * ONE READ, THREE ELEMENTS (review round 1, A7): the predicate used to be
		 * written out at the wrapper, at the button and at the mark, which is how the
		 * mark came to paint its own hover step over the selected row's ground while
		 * the sidebar's comment claimed it dropped it. The name is the pin now — the
		 * three consumers read `current`, so they cannot disagree — and the ground's
		 * two home call sites are pinned by the entries below.
		 */
		what: "chat session row current-row predicate",
		file: "src/renderer/src/features/chat/components/chat-sidebar.tsx",
		must: "const current = selectedConversation === row.session_id && !activeDraftKey;",
		why: "the row the operator reported is marked on two terms — the ground and `aria-current` — and the predicate is named once so the two cannot drift apart. A weakened predicate un-marks the conversation in both places at once, which is why the pin is on the declaration rather than on one use",
	},
	{
		what: "chat session row current-row mark",
		file: "src/renderer/src/features/chat/components/chat-sidebar.tsx",
		must: "const current = selectedConversation === row.session_id && !activeDraftKey;",
		why: "this is the mark the operator reported missing; the predicate and the ground have to stay on the row together, which is what `aria-current` on the same two terms asserts to a screen reader, and the single read is what keeps the wrapper, the button and the mark from disagreeing about it",
	},
	{
		/*
		 * The row BUTTON's half of that pair, pinned because the ground has two home
		 * call sites on this row and a reader can delete either one: the button carries
		 * `rowStyle`, so this is the expression whose `hover:` half has to lose to the
		 * ground (the same reason the entity row's button is pinned below).
		 */
		what: "chat session row current-row ground",
		file: "src/renderer/src/features/chat/components/chat-sidebar.tsx",
		must: '"min-w-0 grow text-left",',
		why: "the button shares the wrapper with the mark and has to carry the ground as well, or the current conversation loses its mark on the element the pointer and the caret land on",
	},
	{
		/*
		 * The ENTITY row's name button, and the reason it needs its own pin rather
		 * than a share of the constant's: this element carries `rowStyle`, so its
		 * `hover:bg-elevated` painted over the wrapper's ground and the pointer
		 * replaced the mark across the row (round 1, the MAJOR the entity row was
		 * changed for). The ground therefore appears TWICE on that row — on the
		 * wrapper, which fills the gaps and corners, and on this button, where the
		 * `hover:` half is the only thing that beats the step it inherits — and a
		 * reader who deletes either one leaves a row that still looks marked in the
		 * source and is not. The pin is the button's own expression.
		 */
		what: "entity row current-row ground",
		file: "src/renderer/src/features/chat/components/chat-sidebar.tsx",
		must: 'className={cn(rowStyle, "flex-1 text-left", staged && rowCurrent)}',
		why: "the element the pointer lands on has to carry the ground as well as the wrapper: a child's background paints over its parent's, so without this the current entity row is repainted `elevated` by the pointer and is indistinguishable from a hovered one",
	},
	{
		/*
		 * The key cap's INK STEP, which is a RANK rather than a floor — and the
		 * reason it is a pin here instead of a row above.
		 *
		 * Both roles clear `docs/branding.md` § 3's 4.5:1 text floor on every ground
		 * a cap renders on, so no palette assertion in this file can tell the two
		 * apart as a decision: `inkDim` on the four grounds runs 4.51-6.90:1 and its
		 * neighbour one step up runs 5.54-6.90:1. What separates them is the rank of
		 * the thing a cap annotates, and the app prints a legend's LABELS in
		 * `ink-dim`, so a cap at the step above outranks what it explains. Measured in
		 * the committed pairs before this pin existed: the palette's legend caps read
		 * 6.76-6.83:1 against their own bar while the labels beside them read 4.55:1
		 * and 3.87:1, and on the active row the `Go` verb read 4.54:1 against its own
		 * `\u21b5` cap at 7.02:1 — an inversion of the annotation over the content, in
		 * a change whose instruction was to make the caps MORE subtle.
		 *
		 * Why a pin and not a comment: this exact move was made once already for the
		 * opposite reason (the rail's chord read as fine print at 5.76:1 against the
		 * label's 8.94:1) and reverting it costs nothing any palette row can see, so
		 * the drift that produced the inversion is one word in a class string behind a
		 * green gate. The pin names the ink step and the register it is set in, not the
		 * whole geometry constant: the box's `min-w-5`/`h-5` is the other half of the
		 * operator's report and a separate decision, and freezing it here would fail
		 * this row on a legitimate padding tweak. It fails closed on a reorder, which
		 * is the accepted cost the section above records.
		 */
		what: "key cap ink step",
		file: "src/renderer/src/shared/components/common/keyboard-shortcut.tsx",
		must: "font-mono text-ink-dim text-mono-sm",
		why: "a cap annotates rather than states, so its ink has to sit at or BELOW the label it explains; the step above (`ink-muted`) is the role this app prints legend labels in, and at that step the palette's keys measured 6.76-6.83:1 against labels at 4.55:1 and 3.87:1 (and the active row's `Go` 4.54:1 against its own `\u21b5` cap at 7.02:1) — an inversion no floor row can see, because both roles clear every floor on every ground a cap renders on",
	},
	{
		/*
		 * The settings rail's current row, which was the same defect on the same
		 * ground: the rail's root is `bg-surface` (`settings-sidebar.tsx`) and it
		 * marked its current section with `accent-wash` — ΔE00 1.05 in tokyoNight
		 * (`#262B3F` on `#24283B`), a row with no ground at all, identifiable only by
		 * its accent glyph and weight. It is here rather than in a set of its own
		 * because it is one class for one role decision (round 1, design D2).
		 * Every citation of this pair in this file and in the two panels' sources
		 * uses that palette pair; the frames' own bytes render about one step off it
		 * in both values, which `docs/evidence/chat-sidebar-selection/README.md`
		 * states where it gives the frame readings.
		 *
		 * THE RAIL NO LONGER SPELLS THE CLASS (round 5: design D22, agent A-7). It
		 * imported the chat panel's declaration after the copy that stood here — the
		 * one design round 4's D19 was raised against — turned out to be the second
		 * of two that drifted a term each. So this pin names the SYMBOL the rail
		 * applies, and the four terms themselves are pinned once, at the declaration
		 * above; a rail that stops applying the role fails here, a role whose terms
		 * change fails there, and `scripts/chat-sidebar-selection.test.mjs` resolves
		 * this very expression through the shipped `cn` and fails without the ground.
		 */
		what: "settings rail current-row ground",
		file: "src/renderer/src/features/settings/components/settings-sidebar.tsx",
		must: "? rowCurrent",
		why: "the same `surface` ground as the chat panel, where the wash measured ΔE00 1.05 and the current destination had no mark at all, and where `sunken` put a recessed box on a menu row; the `hover:` half is in the pin because this rail's inactive rows carry `hover:bg-elevated`, which would otherwise replace the mark under the pointer, and the weight is in it because the row's mark is the ground plus the weight — there is no longer an `outline-control` half in either panel (design round 1, D3): the ring is retired, because that role is § 2's sole boundary of a control and both rails drew it with the search field's own ink and geometry. The rail applies the chat panel's exported `rowCurrent` rather than a copy of its terms (round 5, D22): one role, one declaration, and no string here left to drift a term",
	},
	{
		/*
		 * The transcript's quote toolkit, and why this is a PIN rather than a row
		 * in `CONTROLS`.
		 *
		 * `CONTROLS` asserts `ink` on the control's fill AND an edge — fill or
		 * border — clearing 3:1 against the ground behind it. The toolkit is a
		 * floating surface, not a bounded control, and it fails the second term in
		 * all twelve palettes by measurement: `elevated` is 1.13-1.40:1 against
		 * `canvas` and `hairline` is 1.25-1.79:1, because § 2 caps a hairline below
		 * 2:1 by design. A row here would therefore either fail the gate or be a
		 * lie about which ground the object is read against. The ink half IS
		 * already asserted — `inkDim` on `elevated` is one of the INKS x GROUNDS
		 * pairs, 4.51-6.20:1 across the twelve — and the icons are the whole
		 * affordance, so what is left unguarded is the call site: repaint the
		 * floating shell `bg-canvas` and it stops being a floating object at all
		 * while every palette assertion stays green.
		 *
		 * The same roles are pinned on the legacy `message-controls.tsx` strip by
		 * that component's own comment rather than by a row here, which is the
		 * gap this entry closes for the canonical transcript.
		 */
		what: "transcript quote toolkit floating shell",
		file: "src/renderer/src/features/chat/canonical/quote-toolkit.tsx",
		must: "z-10 flex h-8 items-center rounded-md border border-hairline bg-elevated px-1",
		why: "the toolkit floats over prose and over a user bubble, so `elevated` plus a hairline is the whole of what makes it read as an object rather than as text that drifted; repainting it on the transcript's own canvas leaves it invisible against the reading column with every palette row still green",
	},
	{
		/*
		 * The empty-chat suggestion chip.
		 *
		 * This control deliberately has NO row in `CONTROLS`, and the reason is
		 * worth writing down so the next reader does not add one and conclude the
		 * wrong thing from its failure. The assertion loop computes
		 * `fill ? p[c.fill] : ground` and requires `max(fillEdge, borderEdge) >= 3:1`.
		 * At rest the chip has no fill and no border, so the fill collapses to the
		 * ground and the edge ratio to 1:1; hovered, the fill is `elevated`, whose
		 * ratio to `canvas` is ~1.1:1 — a ground step, deliberately far below the
		 * 3:1 that belongs to a BOUNDARY. Every existing hovered row that uses
		 * `elevated` carries `borderControl` at the same time (`ask option button
		 * (hover)`); this control has no border, and that is the point rather than
		 * the omission.
		 *
		 * So the gate this control needs is a call-site pin plus a perceivability
		 * row (`suggestion chip hover ground step` above), which is what this file
		 * provides for exactly this class of edit.
		 *
		 * The pin spans the variant AND the class list on purpose, because the
		 * class list alone would stay green through the edit that undoes the
		 * change: restoring `variant="outline"` puts `border border-control` back
		 * (`button.tsx`) without touching one character of the className. The cost
		 * of spanning the whole list is that every legitimate edit to it fails this
		 * gate once and has to visit this entry - which is what happened when the
		 * chip gained its disabled state (`disabled:text-ink-disabled
		 * disabled:hover:bg-transparent`, round 1 remediation); that is the pin
		 * working, so the answer is to update the literal, never to loosen it.
		 */
		what: "the empty-chat suggestion chip is borderless",
		file: "src/renderer/src/features/chat/components/measured-suggestion-stack.tsx",
		must: 'variant="ghost"\n\t\t\t\t\t\tsize="sm"\n\t\t\t\t\t\tclassName="h-auto max-w-full whitespace-normal break-words rounded-sm px-2 py-1 text-body-sm text-ink-muted hover:bg-elevated hover:text-ink disabled:text-ink-disabled disabled:hover:bg-transparent"',
		why: 'reverting to `variant="outline"` re-introduces seven 3:1 boundaries as the loudest thing on a screen with nothing to compete with them, and `hairline` is the tempting wrong answer here: it is the decorative role and measures 1.25:1 at its worst, which is a boundary nobody can see rather than a quiet one',
	},
];

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
const STRUCTURAL = [
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
 * comments on exactly the grounds it failed 4.5:1 there. `elevated`,
 * `accentWash` and `highlight` are in it because each is a ground a tone role
 * is genuinely drawn on - a dialog's required-mark and a danger button's label
 * (`elevated`), the ask-option card and the find-match tint (`accentWash`), the
 * selected sidebar row (`highlight`) - and the old list stopped at `sunken`,
 * which is how `danger` came to be drawn at 3.76:1 on `elevated` in `monokai`
 * behind a green gate.
 */
const AS_TEXT = ["accent", "success", "warning", "danger", "info"];

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
const EXCEPTIONS = [
	/*
	 * EMPTY - and the emptiness is a MEASURED state, not a tidy-up.
	 *
	 * This table carried one entry for most of this pass: `catppuccinMacchiato`'s
	 * `inkDim` on `rowSelected`, recorded at 4.98:1 against the 5.0 ink floor. The
	 * row/hover commit re-authored that fill #3D2E51 -> #38323E, which lifts the
	 * pair to 5.0260:1 - the floor is CLEARED - and nothing re-recorded or deleted
	 * the row, so the run kept reporting an exemption the fleet no longer takes.
	 *
	 * The stale row could not be caught by measuring it, which is why it survived:
	 * `assertPair` returns as soon as `raw >= floor`, so a pin that has stopped
	 * being needed is never CONSULTED, and the summary line counted a static
	 * `EXCEPTIONS.length`. A pin is only visible once the table counts its own
	 * consultations, which is the guard the three sibling pin tables already had
	 * and this one did not. It has it now: an entry that is never asked about
	 * fails the run with "delete the pin, the palette clears it now".
	 *
	 * So the honest headline is the stronger one: **59 of 59 palettes hold every
	 * ink floor with no exemption at all.** Add an entry only with its measured
	 * ratio and its reason, and expect the run to fail the moment the palette
	 * stops needing it.
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
const PERCEPTIBLE_EXCEPTIONS = [
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

/** Entries consulted during the run, so an exception that stops firing is caught. */
const perceptibleSeen = new Set();

const findPerceptibleException = (theme, role, ground, got) => {
	const hit = PERCEPTIBLE_EXCEPTIONS.find(
		(e) =>
			e.theme === theme &&
			e.role === role &&
			e.ground === ground &&
			Math.abs(e.got - got) < 0.01,
	);
	if (hit) perceptibleSeen.add(hit);
	return hit;
};

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
const IDENTITY_PAIR_FLOOR = 15; /* == SEPARATION_FLOOR */
const LIVENESS_PAIR_FLOOR = 8; /* == SYNTAX_COMMENT_FLOOR */

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
const PAIR_PINS = [
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

/** `PAIR_PINS` entries consulted during the run, for the same staleness guard. */
const pairPinSeen = new Set();

const findPairPin = (theme, a, b, got) => {
	const hit = PAIR_PINS.find(
		(e) =>
			e.theme === theme &&
			e.a === a &&
			e.b === b &&
			Math.abs(e.got - got) < 0.01,
	);
	if (hit) pairPinSeen.add(hit);
	return hit;
};

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
const INK_STEP_PINNED = [];
/** Every palette whose ink step was MEASURED - the stale check's theme-existence set. */
const inkStepSeen = new Set();
/**
 * The pins the run actually looked up, which is what the summary line reports. The
 * two sets are not the same thing and the difference is the whole of review round
 * 2's F1: every measured palette is added to `inkStepSeen`, so printing ITS size
 * reported 59 pinned ink steps against a table with no rows - a headline asserting
 * a pin population the tree does not have, one field to the right of the fix made
 * for exactly that. A pin whose theme is gone is never looked up, so it cannot be
 * counted here, and the stale check below fails it.
 */
const inkStepPinSeen = new Set();

/*
 * NO CONTROL EDGE IS PINNED TODAY, and what the list held is kept here because the
 * machinery is not specific to the control that needed it.
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
 * RE-MEASURED ON THE FOLD ONTO `origin/main` (`10926b782`), and this branch's own
 * re-derivation of `highlight` is what moved them: the badge's edge is measured
 * against that role, so `duskfox` went 2.91 -> 2.94 and `everforest` arrives at
 * 2.84, newly under the floor. Both are still the class this list already holds -
 * `borderControl` against a lifted `highlight` on a dark palette - and both of the
 * app-wide fixes the paragraph above refuses would invalidate the same two
 * measurement sets, so they are pinned at their measured precision. The pin is
 * still a claim the gate re-checks: a palette re-authored out of the floor fails
 * until its entry is deleted.
 *
 * @type {{control: string, ground: string, theme: string, got: number}[]}
 */
const CONTROL_EDGE_PINNED = [];
const controlEdgeSeen = new Set();

/**
 * The identity of one pinned measurement: which control, on which ground, in which
 * palette. Used for BOTH the match and the stale check so the two cannot disagree
 * about what a pin covers - the defect review round 3's A-2 named, one key along.
 */
const controlEdgeKey = (control, ground, theme) =>
	`${control} on ${ground} in ${theme}`;

/* ---- 5. the run --------------------------------------------------------- */

const log = [];
let failures = 0;
let assertions = 0;

const fail = (msg) => {
	failures++;
	log.push(`FAIL  ${msg}`);
};

/*
 * Entries consulted during the run.
 *
 * The consultation is what makes a pin removable. `assertPair` returns the
 * moment the raw ratio clears its floor, so an exception whose palette has been
 * fixed is never looked up - and a table that only checks the entry still
 * DESCRIBES something (the theme still exists, the pair still measures what the
 * row says) will keep a dead row alive for as long as nobody asks. Counted here,
 * failed below. Its siblings `perceptibleSeen`, `controlEdgeSeen` and
 * `inkStepPinSeen` are the same mechanism - each holds the entries the run
 * CONSULTED rather than the entries the table declares - and this table was the one
 * missing it. The remaining set, `inkStepSeen`, is deliberately not one of them: it
 * holds the palettes whose ink step was measured, which is the question the ink-step
 * stale check asks, and the summary line reads `inkStepPinSeen` instead precisely
 * because the two are not interchangeable.
 */
const exceptionSeen = new Set();

const findException = (theme, fg, bg, got) => {
	const hit = EXCEPTIONS.find(
		(e) =>
			e.theme === theme &&
			e.fg === fg &&
			e.bg === bg &&
			Math.abs(e.got - got) < 0.01,
	);
	if (hit) exceptionSeen.add(hit);
	return hit;
};

/*
 * Compare the raw ratio; round only to report it.
 *
 * Rounding first quietly widens every floor in this file by half a hundredth:
 * 4.4951 becomes 4.5 and clears a 4.5 floor it does not actually meet. That is
 * a gate reporting on its own rounding rather than on the palette, and it is
 * exactly how `localOperatorLight`'s 1.02666 ground separation passed a 1.03
 * requirement. The displayed value stays rounded because three decimal places
 * of a contrast ratio are noise to the person reading the failure.
 */
const assertPair = (theme, p, fg, bg, floor, label) => {
	const a = p[fg];
	const b = p[bg];
	if (!isHex(a) || !isHex(b)) return;
	assertions++;
	const raw = ratio(a, b);
	if (raw >= floor) return;
	const got = r2(raw);
	if (findException(theme, fg, bg, got)) return;
	fail(
		`${theme}: ${label} — ${fg} ${a} on ${bg} ${b} = ${got}:1, need ${floor}:1`,
	);
};

/**
 * Two ROLES that must be told apart, rather than an ink on a ground.
 *
 * The other instrument, and the one the pair floors need: `ratio` is
 * luminance-only, so two roles can be equally legible on every ground and still
 * be the same colour to a reader — which is the whole of the tool row's
 * defect. `label` comes from the floors' own constants, so a pin records the
 * FLOOR it was granted under and not just a number: a pin whose floor no longer
 * matches the assertion reaching it fails here rather than quietly relaxing a
 * bound that was raised since it was written.
 */
const assertIdentityPair = (theme, p, a, b, floor, label) => {
	const va = p[a];
	const vb = p[b];
	if (!isHex(va) || !isHex(vb)) return;
	assertions++;
	const got = r2(deltaE(va, vb));
	if (got >= floor) return;
	const pin = findPairPin(theme, a, b, got);
	if (pin) {
		if (pin.floor !== floor) {
			fail(
				`${theme}: \`${a}\`/\`${b}\` is pinned at floor ${pin.floor} but this assertion asks for ${floor} — a pin records the bound it was granted under, so the pin and the floor have to be raised together`,
			);
		}
		return;
	}
	fail(
		`${theme}: ${label} — \`${a}\` ${va} and \`${b}\` ${vb} are ΔE00 ${got} apart (need ${floor}) — two roles a reader has to tell apart at this site cannot be one colour at two weights; move the palette value, or pin the palette in \`PAIR_PINS\` with the constraint that refuses it`,
	);
};

const REQUIRED_ROLES = [
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

const palettes = loadPalettes();

if (palettes.length === 0) {
	console.error(`No palettes found in ${PALETTE_DIR}`);
	process.exit(1);
}

/**
 * Semantics a reader has to tell apart, and how far apart they must be.
 *
 * `accent` is deliberately absent, and in four of the twelve palettes it would
 * fail: localOperatorLight 2.19, localOperatorDark 5.07, sage 8.35, and monokai
 * at 0.00 — where `accent` and `success` are the same hex. In the brand pair
 * that is the point, because the brand has one hue and "it worked" is the state
 * it is happiest to own; in monokai and sage it follows from palettes built
 * around a single signature green. Either way it is a decision rather than a
 * defect: nothing in the product asks a user to distinguish an accent from a
 * success, whereas `success` against `info` is a distinction a callout exists
 * to make. A gate that fails by design teaches people to
 * silence gates, so accent is out of the family rather than pinned as an
 * exception in every palette.
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
const SEPARABLE = ["success", "warning", "danger", "info"];

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
const SYNTAX_HUE_ROLES = ["success", "warning", "danger", "info", "ink"];
const SYNTAX_COMMENT_FLOOR = 8;

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
const COMMAND_TOKEN = "tokenCommand";
/* The syntax block's floor, used here as a ΔE00 separation between two inks. */
const COMMAND_TOKEN_FLOOR = SYNTAX_COMMENT_FLOOR;
/* The field it is painted in, and the popup that opens over it. */
const COMMAND_TOKEN_GROUNDS = ["surface", "elevated"];
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
const COMMAND_TOKEN_PINNED = [
	{
		theme: "obsidian",
		against: ["ink", "accent"],
		got: 0.0,
		why: "monochrome: accent = ink = #FAFAFA. The run is separated by the semibold step, exactly as `functionName`/`className` are in code-mirror-theme.ts. Re-measure if ink or accent move.",
	},
];
const SEPARATION_FLOOR = 15;
/*
 * The second accent's own chroma floor, and the reason it is a floor rather than
 * a preference: every separation assertion below can be satisfied by draining a
 * hue toward the ink, which is how a second accent becomes a second grey. It is
 * the same failure `highlight` recorded on the lightness axis - a step that buys
 * its ΔE00 on the wrong axis - so the axis is asserted, not just the distance.
 */
const ALT_ACCENT_CHROMA_FLOOR = 15;

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
const INK_STEP_FLOOR = SYNTAX_COMMENT_FLOOR;

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
const FIELD_SEPARATION_FLOOR = 2.0;
const LINE_SEPARATION_FLOOR = 4.0;

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
const ELEVATED_PANEL_DELTA_E = 2.0;

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
const ROW_PAIR_SEPARATION = 2.0;
/* How much further out the selection must sit than the hover, in `L*`. */
const ROW_STATE_HOVER_RANK = 1.0;
/* ... and in `C*`, the axis the lightness budget cannot spend. */
const ROW_STATE_CHROMA_RANK = 2.0;
const ROW_STATE_WASH_FLOOR = 2.0;
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
const ROW_HOVER_STEP_SHARE_FLOOR = 0.5;
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
const ROW_HOVER_STEP_FLOOR = 1.5;
/*
 * The hover's floor, and now the selection's too. The selection sat at 3.0
 * while it had to out-rank the hover ON THE L* AXIS; the fill ranks it on BOTH
 * axes now, so the only floors left are the two that make the fill findable at
 * all, plus the share floor above. This is the constant that moves the row
 * window (above).
 */
const ROW_SELECTED_STEP_FLOOR = 1.5;
const ROW_SELECTED_STEP_CEILING = 5.0;
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
const ROW_HOVER_CHROMA_FLOOR = 2.5;
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
const ROW_HOVER_CAST_FLOOR_SHARE = 0.5;
const ROW_SELECTED_CHROMA_FLOOR = 5.0;
const ROW_SELECTED_CHROMA_RISE = 4.0;
const ROW_STATE_CHROMA_CAP = 24;
const ROW_STATE_HUE_LIMIT = 12;
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
const ROW_STATE_CHROMA_FLOOR_SLACK = 0.45;
const ROW_STATE_CHROMA_CAP_SLACK = 0.75;
const ROW_STATE_STEP_SLACK = 0.25;

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
const ROW_STATE_NEUTRAL_PANEL = 2.0;
/* An accent below this chroma has no hue to speak with either. */
const ROW_STATE_ACCENTLESS = 2.0;
/*
 * The same derivation the role loop reads, in a form the pair-separation check
 * (which sits outside that loop) can call for itself. Keyed on the PANEL's
 * chroma and never on a palette's name.
 */
const isNeutralClass = (palette) => {
	const [, a, b] = toLab(palette.surface);
	return Math.hypot(a, b) < ROW_STATE_NEUTRAL_PANEL;
};

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
const ROW_STATE_FLOOR_UNREACHABLE = [
	{
		id: "synth",
		role: "rowSelected",
		reason:
			"the panel carries C* 26.83 against the rule's FLAT cap of 24, so the selection's cast floor (the panel's own cast) is above its ceiling and no authored value can hold both. The value sits at the cap, 3.45 chroma under the floor, and the ceiling is the constraint that refuses it - this palette's cast is louder than a row is allowed to be",
	},
];
const ROW_STATE_MEASURED_SHORTFALL = [
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

/* A ledger row is a CLAIM, and a claim that is not needed any more is a defect:
   these read the tables above and refuse to let one outlive its cause. */
const floorUnreachablePin = (id, role) => {
	const row = ROW_STATE_FLOOR_UNREACHABLE.find(
		(r) => r.id === id && r.role === role,
	);
	return row ?? null;
};
const shortfallPin = (id, role, bound) => {
	const row = ROW_STATE_MEASURED_SHORTFALL.find(
		(r) => r.id === id && r.role === role && r.bound === bound,
	);
	return row ?? null;
};
/*
 * What the per-palette assertions CLAIM as they run: one key per ledger row,
 * `id:role:bound`. The fleet section at the end reads it, so a ledger row that
 * no longer describes anything fails the gate instead of sitting there.
 */
const pinClaims = new Set();

const CHART_HOVER_SEPARATION_FLOOR = 10;
const CHART_HOVER_GROUND = "surface";

/*
 * And the other end. A hairline that clears the line floor by enough stops
 * being a hairline: `borderControl` is the role for an edge that asserts
 * itself, and this one is for an edge that merely divides. 2.0:1 is where the
 * twelve sit today - radient's 1.16:1 against `elevated` at the quietest,
 * tokyoNight's 1.92:1 against `sunken` at the loudest - so it fences the range
 * without moving anything.
 */
const HAIRLINE_RATIO_CEILING = 2.0;

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
const HAIRLINE_RATIO_FLOOR = 1.15;

for (const { id, palette: p } of palettes) {
	/* Completeness first. A missing role is a worse defect than a low ratio,
	   because it silently falls through to MUI's stock palette — which is how
	   this app shipped a blue `info` that appeared in no theme file. */
	for (const role of REQUIRED_ROLES) {
		assertions++;
		if (!(role in p)) fail(`${id}: missing required role \`${role}\``);
	}

	/*
	 * Ink on every ground, the SIX of them.
	 *
	 * `accentWash` and `highlight` are grounds a body ink is genuinely read on
	 * - a keycap on a selected row, a reading button on its own hover fill, the
	 * selected sidebar row, the chip labels in the composer - and they were not
	 * measured here until this pass, which is exactly how `inkDim` came to sit
	 * at 3.91:1 on a selected row in `cyberpunk` with every gate green.
	 */
	for (const [inkRole, floor] of INKS) {
		if (EXEMPT_INK.has(inkRole)) continue;
		for (const g of GROUNDS6) {
			assertPair(id, p, inkRole, g, floor, "body ink");
		}
	}

	/* The four grounds must be distinguishable from each other, since
	   elevation in this system is a lightness step and not a shadow. This is a
	   separation floor rather than a contrast floor: adjacent steps only need
	   to be perceptibly different, not legible against each other. */
	for (let i = 0; i < GROUNDS.length; i++) {
		for (let j = i + 1; j < GROUNDS.length; j++) {
			const a = p[GROUNDS[i]];
			const b = p[GROUNDS[j]];
			if (!isHex(a) || !isHex(b)) continue;
			assertions++;
			if (ratio(a, b) < 1.03) {
				fail(
					`${id}: grounds \`${GROUNDS[i]}\` ${a} and \`${GROUNDS[j]}\` ${b} are indistinguishable (${r2(ratio(a, b))}:1) — elevation is a lightness step here, so they must differ`,
				);
			}
		}
	}

	/*
	 * THE TWO ROW STATES, asserted.
	 *
	 * Every bound in the constants above is applied here, per palette and per
	 * role, and every failure names the rule and the number. The order is the
	 * order a reader debugging a value needs it in: what the value IS (hue,
	 * cast), then how far it is from the panel in both channels, then how far
	 * from its sibling state, then how far from the wash it must not merge with.
	 *
	 * WHAT THIS LOOP NO LONGER ASSERTS, and why. Two of the three were collision
	 * floors, and both are the direction's structural consequence rather than a
	 * relaxation of convenience:
	 *
	 *   - the ΔE00 band off `surface` at 4.0 - withdrawn rather than lowered. A
	 *     fill at the panel's own hue and cast reaches it on 40 of the 59 palettes
	 *     and bottoms at 2.08, so it is not a floor a backdrop-relative fill can
	 *     hold; the shipped values only met it by leaving the panel's colour
	 *     family. `FIELD_SEPARATION_FLOOR` is what replaces it, plus the two step
	 *     floors and the two rank floors.
	 *   - the `canvas` / `elevated` / `sunken` collision floor (ΔE00 1.0). A fill
	 *     that is the panel's own colour one step up IS a rung of the ladder -
	 *     the sentence this contract already carried for the neutral class,
	 *     generalised to every palette - and 7 of the 59 breach it under the rule
	 *     (`alucard` 0.44 against `sunken`, `arcade` 0.0 against `elevated`,
	 *     `duskfox` 0.47, `kanagawaLotus` 0.83, `rosePine` 0.85, `tokyoNightDay`
	 *     0.51) where the shipped values escaped only by being rotated to a
	 *     different hue. THE WITHDRAWAL'S ARGUMENT USED TO BE THAT THESE PAIRS
	 *     NEVER OCCUR INSIDE ONE LIST, AND THAT SENTENCE WAS FALSE: the app rail's
	 *     own `<nav>` was `bg-sunken` and the agent-hub categories rail was on
	 *     `canvas`, and both of them are LISTS whose rows carry these two roles, so
	 *     the row sat directly on the rung - measured at ΔE00 0.44 (`alucard`, the
	 *     rail) and 0.83 (`kanagawaLotus`, categories), and on 13 of the 59 the
	 *     hovered row read at least as far off the rail's ground as the row the
	 *     reader was ON. THE FIX IS THE RULE THE DIRECTION STATES, not a value: a
	 *     surface that paints these two roles wears `surface`, so both of those
	 *     surfaces were re-grounded (`shared/components/navigation/
	 *     sidebar-navigation.tsx`, and the categories column in
	 *     `features/agent-hub/agent-hub-page.tsx`), the rail taking
	 *     `border-r border-hairline` for the boundary the tonal step used to carry.
	 *     All six `rowCurrent` surfaces are therefore on `surface`: the chat
	 *     sidebar, the settings rail, the app rail, the categories rail, the agents
	 *     sidebar and the agents page's roster.
	 *     WHAT THE WITHDRAWAL STILL ACCEPTS is the one ground class that is not a
	 *     row's backdrop at all: a SELECTED ROW CAN BE THE SAME COLOUR AS A
	 *     DIALOG'S GROUND OR AN INPUT WELL. `elevated` keeps its exemption because
	 *     a menu, popover, tooltip, dialog or drawn card is not a row's plane and
	 *     no row is painted on one; this panel's own `elevated` use is the
	 *     `· lopdev` cap and the `⋯` button, both text-sized rather than full-width
	 *     rows. The two `hover`-only sites that still ride a rung are recorded
	 *     rather than re-grounded, with their numbers, in
	 *     `scripts/chat-sidebar-selection.test.mjs`'s `HOVER_STATES_ON_A_RUNG`:
	 *     the canvas document-tab strip and the schedules page's legacy annex.
	 *   - the two `accent`-bar ratios (`ROW_STATE_BAR_FLOOR`,
	 *     `ROW_STATE_BAR_DELTA_E`) - retired with the bar. They never measured the
	 *     bar being visible; they measured the FILL being distinct enough for a bar
	 *     to sit on, and the fill now has to rank the pair itself.
	 */
	const ROW_ROLE_RULES = [
		{
			role: "rowHover",
			/*
			 * The hover's cast: a FRACTION of the panel's, floored at the rule's
			 * own 2.5 for a panel with no cast to take a fraction of. Its ceiling
			 * is the panel's own cast, with the same absolute term underneath: a
			 * hover may be lighter than its ground, it may not be a more coloured
			 * plane than it.
			 */
			castFloor: (panelChroma) =>
				Math.max(
					ROW_HOVER_CHROMA_FLOOR,
					ROW_HOVER_CAST_FLOOR_SHARE * panelChroma,
				),
			castCeiling: (panelChroma) =>
				Math.max(panelChroma, ROW_HOVER_CHROMA_FLOOR),
			stepFloor: ROW_HOVER_STEP_FLOOR,
			stepCeiling: null,
		},
		{
			role: "rowSelected",
			/*
			 * The selection's cast: the panel's own plus a bounded rise of 4 - the
			 * one axis on which a row may be more coloured than its backdrop, and
			 * what buys the pair's rank where the ink floors leave no `L*` room -
			 * floored at 5.0 for a cast-less panel and capped at the flat 24. The
			 * ceiling is the rule's own clamp rather than `C*(surface) + 4` alone:
			 * on a panel with no cast the formula yields the 5.0 FLOOR, so a
			 * ceiling written as `min(C*(surface) + 4, 24)` would sit below its own
			 * floor on two palettes (`oneLight` and `highContrastLight`, both panels
			 * at C* 0.00).
			 */
			castFloor: (panelChroma) =>
				Math.max(ROW_SELECTED_CHROMA_FLOOR, panelChroma),
			castCeiling: (panelChroma) =>
				Math.min(
					Math.max(
						panelChroma + ROW_SELECTED_CHROMA_RISE,
						ROW_SELECTED_CHROMA_FLOOR,
					),
					ROW_STATE_CHROMA_CAP,
				),
			stepFloor: ROW_SELECTED_STEP_FLOOR,
			stepCeiling: ROW_SELECTED_STEP_CEILING,
		},
	];
	for (const rowRule of ROW_ROLE_RULES) {
		const role = rowRule.role;
		const value = p[role];
		if (!isHex(value)) continue;
		const [l, a, b] = toLab(value);
		const [panelL, panelA, panelB] = toLab(p.surface);
		const [, accentA, accentB] = toLab(p.accent);
		const accentChroma = Math.hypot(accentA, accentB);
		const panelChroma = Math.hypot(panelA, panelB);
		const chroma = Math.hypot(a, b);
		const castFloor = rowRule.castFloor(panelChroma);
		const castCeiling = rowRule.castCeiling(panelChroma);
		/* The NEUTRAL CLASS, derived from the panel rather than named. */
		const neutral = panelChroma < ROW_STATE_NEUTRAL_PANEL;

		/* 1. The hue, and where it is allowed to come from. The PANEL's, because
		      a state of a row has to be a colour the row's own backdrop has; the
		      `accent`'s only where the panel has no cast of its own (C* <
		      ROW_STATE_NEUTRAL_PANEL) AND the accent has one to speak with. The
		      authored values sit at the source hue exactly; the hex round trip
		      costs up to 8.57 degrees of it (measured, `autumn`'s hover), which is
		      why the limit is not the thing the values press against. */
		assertions++;
		const hueSource =
			panelChroma >= ROW_STATE_NEUTRAL_PANEL
				? { name: "the panel's", hue: Math.atan2(panelB, panelA) }
				: accentChroma >= ROW_STATE_ACCENTLESS
					? { name: "`accent`'s", hue: Math.atan2(accentB, accentA) }
					: { name: "the panel's", hue: Math.atan2(panelB, panelA) };
		const rowHue = Math.atan2(b, a);
		const hueOff = Math.abs(
			((((rowHue - hueSource.hue) * 180) / Math.PI + 540) % 360) - 180,
		);
		if (chroma >= ROW_STATE_NEUTRAL_PANEL && hueOff > ROW_STATE_HUE_LIMIT) {
			fail(
				`${id}: \`${role}\` ${value} sits ${r2(hueOff)} degrees off ${hueSource.name} hue (the limit is ${ROW_STATE_HUE_LIMIT}) — a row state has to be the colour of the backdrop it is a state of, and the values this round replaced took the \`accent\`'s hue instead, which is more than 45 degrees off the panel on 25 of the 59 palettes and is the off-colour the operator reported. Take the hue from ${hueSource.name} and re-author the value at it`,
			);
		}

		/* 2a. The cast FLOOR - the bound this file was missing, and the reason the
		      operator's report was possible. A row state carries AT LEAST half its
		      panel's cast (and never less than the rule's own floor), so a fill can
		      no longer read as a grey wash of the surface it sits on while passing
		      the gate: the shipped hover measured C* 4.79 against `tokyoNight`'s
		      panel of 13.44, and the ΔE00 7.05 it was scored on *was* that removal
		      (ΔL* +1.72 against ΔC* -8.65). */
		assertions++;
		if (castFloor > castCeiling + 1e-9) {
			/*
			 * The floor is ABOVE the ceiling: no authored value can hold both, so
			 * the value sits at the ceiling and the row is a LEDGER entry rather
			 * than an exemption. A palette in this position with no entry is a
			 * palette that has to be re-authored.
			 */
			pinClaims.add(`${id}:${role}:floor`);
			assertions++;
			const pin = floorUnreachablePin(id, role);
			if (!pin) {
				fail(
					`${id}: \`${role}\` ${value} carries C* ${r2(chroma)}, and its cast floor ${r2(castFloor)} is ABOVE its ceiling ${r2(castCeiling)} — the panel's own cast is louder than this role is allowed to be, so the value has to sit at the ceiling and \`${id}\`'s \`${role}\` has to be in ROW_STATE_FLOOR_UNREACHABLE naming the constraint that refuses the floor (the flat cap, the rise, or the role's absolute term)`,
				);
			}
			assertions++;
			if (chroma < castCeiling - ROW_STATE_CHROMA_CAP_SLACK) {
				fail(
					`${id}: \`${role}\` ${value} carries C* ${r2(chroma)} where its cast floor ${r2(castFloor)} is above its ceiling ${r2(castCeiling)} — the floor cannot be held, but the CEILING is reachable and is what the ledger row promises this value sits at`,
				);
			}
		} else if (chroma < castFloor - ROW_STATE_CHROMA_FLOOR_SLACK) {
			fail(
				`${id}: \`${role}\` ${value} carries C* ${r2(chroma)}, under the cast floor ${r2(castFloor)} — a row state has to carry the cast of the panel it sits on, and a fill quieter than its own backdrop reads as a grey wash of that backdrop. This is the defect that was reachable because the two \`ROW_*_CHROMA_FLOOR\` constants were declared and asserted NOWHERE, and the measurement that found it was a hover at C* 4.79 on a panel of 13.44. Author the value at the panel's own hue, at the cast the rule names and the step the inks allow`,
			);
		}

		/* 2b. The cast CEILING. A tint, never a saturated plane beside the panel
		      - the 1.4x over-cast of the shipped `tokyoNightStorm`, bought
		      entirely on the chroma axis so the band could be met without
		      lighting the row. The reference is the PANEL's cast, not the
		      `accent`'s: `min(0.6 x C*(accent), 24)` permitted C* 24 against a
		      panel of 16.3. */
		assertions++;
		if (chroma > castCeiling + ROW_STATE_CHROMA_CAP_SLACK) {
			fail(
				`${id}: \`${role}\` ${value} carries C* ${r2(chroma)}, past the ${r2(castCeiling)} this file allows — ${
					role === "rowHover"
						? "the hover may be lighter than its ground, it may not be a MORE coloured plane than it"
						: `the selection may carry the panel's cast and the rule's rise of ${ROW_SELECTED_CHROMA_RISE} above it, and no more`
				}, and the flat cap is ${ROW_STATE_CHROMA_CAP}. Search the chroma back toward the panel and let the step and the pair's cast rank carry what the fill no longer can`,
			);
		}

		/* 3. The step, its DIRECTION, its ceiling, and - for the selection - its
		      rank above the hover on BOTH channels. */
		assertions++;
		const rawStep = l - panelL;
		const step = p.mode === "dark" ? rawStep : -rawStep;
		if (step < rowRule.stepFloor - 1e-9) {
			fail(
				`${id}: \`${role}\` ${value} sits ${r2(Math.abs(rawStep))} \`L*\` ${p.mode === "dark" ? "above" : "below"} \`surface\` ${p.surface}, so the step is ${p.mode === "dark" ? "LIGHTER" : "DARKER"}-by-${r2(step)} where the floor is ${rowRule.stepFloor} \`L*\` in the mode's raised direction — ΔE00 is a budget a chroma-only step can spend while moving the wrong way in lightness, and the three palettes that did exactly that were the same report answered twice`,
			);
		}
		if (rowRule.stepCeiling !== null) {
			assertions++;
			if (step > rowRule.stepCeiling + ROW_STATE_STEP_SLACK + 1e-9) {
				fail(
					`${id}: \`${role}\` ${value} sits ${r2(step)} \`L*\` from \`surface\`, past the ${rowRule.stepCeiling} \`L*\` ceiling — every L* the row rises is ink headroom spent on the caps drawn inside it, so the step is taken as far as the inks allow and no further`,
				);
			}
		}
		if (role === "rowSelected" && isHex(p.rowHover)) {
			const [hoverL, hoverA, hoverB] = toLab(p.rowHover);
			const hoverStep = p.mode === "dark" ? hoverL - panelL : panelL - hoverL;
			const hoverChroma = Math.hypot(hoverA, hoverB);
			/* 3a. The `L*` rank. The fill ranks the pair now that the bar is
			      gone, and this is the axis a reader scans by. */
			assertions++;
			if (step < hoverStep + ROW_STATE_HOVER_RANK - 1e-9) {
				const pin = shortfallPin(id, "rowSelected", "rank");
				pinClaims.add(`${id}:rowSelected:rank`);
				assertions++;
				if (!pin) {
					fail(
						`${id}: \`rowSelected\` ${value} is ${r2(step)} \`L*\` from \`surface\` where \`rowHover\` ${p.rowHover} is ${r2(hoverStep)} — the selection has to be at least ${ROW_STATE_HOVER_RANK} \`L*\` further out than the hover, or a reader scanning sees one mark at two strengths rather than two states. A palette that cannot reach it has its whole legal step consumed by the ink floors, and that is a ledger row rather than a relaxed floor`,
					);
				} else if (Math.abs(step - hoverStep - pin.measured) > 0.05) {
					fail(
						`${id}: the rank row in ROW_STATE_MEASURED_SHORTFALL is stale — it records ${pin.measured} and the pair now ranks ${r2(step - hoverStep)}. A ledger row is a claim about a value, so it is re-measured every run`,
					);
				}
			} else if (shortfallPin(id, "rowSelected", "rank")) {
				fail(
					`${id}: the rank row in ROW_STATE_MEASURED_SHORTFALL is stale — the pair ranks ${r2(step - hoverStep)} \`L*\`, clear of the ${ROW_STATE_HOVER_RANK} the row claims it misses. Remove the row`,
				);
			}
			/* 3b. The `C*` rank, and it is the axis that costs nothing: `L*`
			      determines relative luminance, so the contrast floors are blind
			      to chroma and the pair can be ranked on cast at zero ink cost. */
			assertions++;
			if (chroma < hoverChroma + ROW_STATE_CHROMA_RANK - 1e-9) {
				fail(
					`${id}: \`rowSelected\` ${value} carries C* ${r2(chroma)} where \`rowHover\` ${p.rowHover} carries ${r2(hoverChroma)} — the selection has to carry at least ${ROW_STATE_CHROMA_RANK} chroma more than the hover. This is the rank that costs nothing: a fill may be ranked on cast without spending a single L* of the ink budget, and the shipped fleet's chroma rank was INVERTED on 14 palettes because the hover desaturated while the selection did not`,
				);
			}
			/* 3c. How much of the selection's step the hover SPENDS, which is
			      clause 2 of the ask stated as the relationship it is. */
			assertions++;
			if (hoverStep < ROW_HOVER_STEP_SHARE_FLOOR * step - 1e-9) {
				fail(
					`${id}: \`rowHover\` ${p.rowHover} takes ${r2(hoverStep)} \`L*\` of the ${r2(step)} the selection takes (${Math.round((hoverStep / step) * 100)}%), under the ${Math.round(ROW_HOVER_STEP_SHARE_FLOOR * 100)}% this file requires — the operator asked for MORE of the brightening than the shipped 30%, and an absolute hover floor cannot state that on a fleet whose budgets differ by 2.5x`,
				);
			}
		}

		/* 4. The band off `surface`, at the file's own field floor now that the
		      4.0 band is withdrawn: a fill indistinguishable from its own panel
		      still fails, and a palette that cannot clear even this one is a
		      ledger row naming the floor that refuses it. */
		assertions++;
		const panelGap = deltaE(value, p.surface);
		if (panelGap < FIELD_SEPARATION_FLOOR - 1e-9) {
			const pin = shortfallPin(id, role, "band");
			pinClaims.add(`${id}:${role}:band`);
			assertions++;
			if (!pin) {
				fail(
					`${id}: \`${role}\` ${value} is ΔE00 ${r2(panelGap)} from \`surface\` ${p.surface} (the field floor is ${FIELD_SEPARATION_FLOOR}) — below this the mark is not findable while scanning, which is the operator's report restated. The band this role used to be held to was 4.0 and is WITHDRAWN because a backdrop-faithful fill cannot reach it on lightness; this floor is what is left, and a palette that misses even it needs a ledger row with the floor that refuses it`,
				);
			} else if (Math.abs(panelGap - pin.measured) > 0.05) {
				fail(
					`${id}: the band row in ROW_STATE_MEASURED_SHORTFALL is stale — it records ${pin.measured} and the palette now measures ${r2(panelGap)}. A ledger row is a claim about a value, so it is re-measured every run`,
				);
			}
		} else if (shortfallPin(id, role, "band")) {
			fail(
				`${id}: the band row in ROW_STATE_MEASURED_SHORTFALL is stale — \`${role}\` ${value} is ΔE00 ${r2(panelGap)} from \`surface\`, clear of the ${FIELD_SEPARATION_FLOOR} the row claims it misses. Remove the row`,
			);
		}

		/* 5. How far from the wash it must not merge with: a state-distinction at
		      the FIELD floor, not asserted where the palette has no cast at all. */
		assertions++;
		const washGap = deltaE(value, p.accentWash);
		if (!neutral && washGap < ROW_STATE_WASH_FLOOR) {
			const pin = shortfallPin(id, role, "wash");
			pinClaims.add(`${id}:${role}:wash`);
			assertions++;
			if (!pin) {
				fail(
					`${id}: \`${role}\` ${value} is ΔE00 ${r2(washGap)} from \`accentWash\` ${p.accentWash} (need ${ROW_STATE_WASH_FLOOR}) — a hovered row beside a hovered button would merge into one mark, and they are a row state and a control state, so they have to be two. A backdrop-relative fill and an accent-derived wash are the same kind of rung, so this can bite on a palette with a strong cast in both; that is a ledger row with the reading, not a widened floor`,
				);
			} else if (Math.abs(washGap - pin.measured) > 0.05) {
				fail(
					`${id}: the wash row in ROW_STATE_MEASURED_SHORTFALL is stale — it records ${pin.measured} and the palette now measures ${r2(washGap)}. A ledger row is a claim about a value, so it is re-measured every run`,
				);
			}
		} else if (!neutral && shortfallPin(id, role, "wash")) {
			fail(
				`${id}: the wash row in ROW_STATE_MEASURED_SHORTFALL is stale — \`${role}\` ${value} is ΔE00 ${r2(washGap)} from \`accentWash\`, clear of the ${ROW_STATE_WASH_FLOOR} the row claims it misses. Remove the row`,
			);
		}
	}

	/* 6. The separation - the half the second report is about. Measured between
	      the two SHIPPED values, so a palette cannot be ranked by its own numbers
	      on one side and another's on the other. */
	if (isHex(p.rowHover) && isHex(p.rowSelected)) {
		assertions++;
		const apart = deltaE(p.rowSelected, p.rowHover);
		/* The pair's separation is the FLEET's floor on every palette, including the
		   cast-less class: this used to be a collision floor (1.0) for that class
		   and no palette ever used it (their pairs run 2.15-3.71), so the waiver is
		   retired - see the note beside `ROW_HOVER_STEP_FLOOR`. What ranks the two
		   states is the fill's own two ranks above plus `font-medium`, so all the
		   colour has to do is not be the same mark twice. */
		const apartFloor = ROW_PAIR_SEPARATION;
		if (apart < apartFloor - 1e-9) {
			fail(
				`${id}: \`rowHover\` ${p.rowHover} and \`rowSelected\` ${p.rowSelected} are ΔE00 ${r2(apart)} apart (need ${apartFloor}) — the reader sees two marks and cannot rank them. This was the second half of the operator's report: on \`neon\` the shipped pair sat 1.80 ΔE apart while each was ~6.2 ΔE off the panel. The ranking is the fill's now, so a palette that misses this is missing because the two fills are the SAME MARK — give the selection more step or more cast than the hover`,
			);
		}
	}

	/*
	 * THE PLATE INSIDE A ROW, and the half of its guard a class cannot carry.
	 *
	 * The rail's account row hovers on `rowHover` and contains an element with a
	 * ground of its own: the avatar plate, `bg-elevated` with a `border-control`
	 * edge (`shared/components/navigation/user-profile-sidebar.tsx`). The pair
	 * under the pointer collapses on the shipped values - `elevated` against
	 * `rowHover` is byte-identical on `arcade` (ΔE00 0.00) and inside the field
	 * floor on `gruvbox` 1.14, `obsidian` 1.21 and `everforest` 1.90, so hovering
	 * the row turns the plate into a disc of the row's own hover colour - and it is
	 * not a value to re-solve, because a row state IS a step of the panel it sits
	 * on and some palette's state will always land on some rung.
	 *
	 * So the plate is legal the way a control here is: ONE OF ITS TWO EDGES
	 * PERCEIVABLE, fill or boundary. The arms are different instruments and are
	 * measured as such - the fill as a FIELD at `FIELD_SEPARATION_FLOOR` (the same
	 * floor every other "is this fill distinguishable" pair in this file uses) and
	 * the 1px boundary as a LINE at the non-text floor, because ΔE00 credits
	 * chroma that a one-pixel edge cannot spend (the argument beside
	 * `HAIRLINE_RATIO_FLOOR`). Either arm clearing is enough, and on exactly the
	 * four palettes the fill fails the boundary is what clears: `borderControl` on
	 * `rowHover` measures 3.18 (`arcade`), 3.13 (`gruvbox`), 3.27 (`obsidian`) and
	 * 3.10 (`everforest`).
	 *
	 * The class half of this - that the plate still wears `border-control` rather
	 * than a fill alone - is asserted in `scripts/chat-sidebar-selection.test.mjs`,
	 * because a palette gate cannot see which class an element paints. The pair is
	 * `rowHover` and not `rowSelected`: the account row is not a destination, so it
	 * never paints `rowCurrent` (that file asserts it), which is also why
	 * `rowSelected` may stay inside 2.0 of `elevated` on 16 palettes here without
	 * this block saying anything about them.
	 */
	if (isHex(p.elevated) && isHex(p.rowHover) && isHex(p.borderControl)) {
		assertions++;
		const plateField = deltaE(p.elevated, p.rowHover);
		const plateEdge = ratio(p.borderControl, p.rowHover);
		if (plateField < FIELD_SEPARATION_FLOOR && plateEdge < FLOOR.nonText) {
			fail(
				`${id}: the account row's plate has no perceivable edge under the pointer — \`elevated\` ${p.elevated} is ΔE00 ${r2(plateField)} from \`rowHover\` ${p.rowHover} (need ${FIELD_SEPARATION_FLOOR}) and its \`borderControl\` edge ${p.borderControl} is ${r2(plateEdge)}:1 against that same fill (need ${FLOOR.nonText}:1), so the plate the pointer reveals is a disc of the row's own hover colour. Give the plate an edge the row's fill cannot overrun, or a fill the row's own step cannot land on`,
			);
		}
	}

	/*
	 * THE SECOND PLATE INSIDE A ROW, and the state the account row's pair does not
	 * have to answer: the agents sidebar's own row IS a destination, so it paints
	 * `rowCurrent` under a selection as well as `hover:bg-row-hover` under the
	 * pointer (`features/agents/components/agents-sidebar.tsx`; both are asserted
	 * from that call site in `scripts/chat-sidebar-selection.test.mjs`). Its avatar
	 * plate is `sunken` with the same `border-control` edge, and the same two-arm
	 * pair is asked of BOTH states the row can be in — `sunken` at the field floor
	 * OR the edge at the non-text floor, per state, per palette.
	 *
	 * The pair is what makes this satisfiable rather than a flat 3:1 on the edge:
	 * `borderControl` against `rowSelected` bottoms at 2.77 (`vaporwave`, tied with
	 * `catppuccinMocha` - the two are the joint minimum, so neither is "the" worst)
	 * and against
	 * `rowHover` at 2.92 (`catppuccinMocha`), so an edge-only floor would fail 12 and
	 * 5 palettes respectively — and on every one of those the FILL clears the field
	 * floor. The other arm fails in the other direction: `sunken` misses the field
	 * floor against the selection on seven palettes (the tightest `alucard` 0.44) and
	 * against the hover on one (`iceberg` 1.86), and on every one of those the edge
	 * clears, 3.02-4.66 against the selection and 3.35 against the hover. No palette
	 * fails both arms on either state, which is what this asserts.
	 *
	 * The class half — that the plate still wears the edge, and that the class of
	 * "an object inside a row state with a ground of its own" is enumerated rather
	 * than assumed — is in `scripts/chat-sidebar-selection.test.mjs`.
	 */
	if (
		isHex(p.sunken) &&
		isHex(p.rowHover) &&
		isHex(p.rowSelected) &&
		isHex(p.borderControl)
	) {
		for (const state of ["rowHover", "rowSelected"]) {
			assertions++;
			const avatarField = deltaE(p.sunken, p[state]);
			const avatarEdge = ratio(p.borderControl, p[state]);
			if (avatarField < FIELD_SEPARATION_FLOOR && avatarEdge < FLOOR.nonText) {
				fail(
					`${id}: the agents sidebar's avatar plate has no perceivable edge against \`${state}\` — its \`sunken\` fill ${p.sunken} is ΔE00 ${r2(avatarField)} from it (need ${FIELD_SEPARATION_FLOOR}) and the plate's \`borderControl\` edge ${p.borderControl} is ${r2(avatarEdge)}:1 against that same fill (need ${FLOOR.nonText}:1), so the row's own ${state === "rowHover" ? "hover" : "selection"} turns the avatar into a disc of the row's fill. Give the plate an edge the row's state cannot overrun, or a fill that state cannot land on`,
				);
			}
		}
	}

	/* Structural edges: the control's own boundary, the focus ring, and each
	   semantic's edge, on all four grounds. */
	for (const role of STRUCTURAL) {
		for (const g of GROUNDS) {
			assertPair(id, p, role, g, FLOOR.nonText, "structural edge");
		}
	}

	/*
	 * Semantic and accent colours used as text, on all six grounds.
	 *
	 * `sunken` is in this list because it is the editor's own ground: every
	 * syntax colour is painted on it. `elevated`, `accentWash` and the two row
	 * states are in it because each is a ground a tone role is really drawn on -
	 * a dialog's required-mark and a danger button's label on `elevated`, the
	 * ask-option card's text on `accentWash`, the selected sidebar row on
	 * `rowSelected` - and the old list stopped at `sunken`, which is how `danger`
	 * came to be drawn at 3.76:1 on `elevated` in `monokai` behind three
	 * recorded pins rather than a floor. Those pins are gone; see `EXCEPTIONS`.
	 */
	/*
	 * The TONE grounds are the five, not the seven, and the two the row states
	 * add are deliberately excluded HERE while being asserted in the ink loop
	 * above. The measurement is the reason: a tone role reaches a selected row
	 * only as a badge or a dot, and on the accent-derived fills the four tones plus
	 * `accent` measure 4.45-4.50:1 in five palettes - the chroma ceiling is what
	 * caps them, so the shortfall is a property of the rule rather than of a value.
	 * What a row DOES carry is its own text, and that is the ink layer, which is
	 * asserted on both row states. So the tones stay on the five grounds the pass
	 * that added them measured, and the row states are held to the ink floors.
	 */
	const TONE_GROUNDS = [...GROUNDS, "accentWash"];
	for (const role of AS_TEXT) {
		for (const g of TONE_GROUNDS) {
			assertPair(id, p, role, g, FLOOR.text, "colour as text");
		}
	}

	/*
	 * The picker's partial-listing note, on the dialog's own ground.
	 *
	 * It is asserted here rather than left to the `AS_TEXT` loop above because
	 * the row names a CALL SITE: `models.catalogue` can answer with rows AND
	 * per-provider errors, and the note about what is missing belongs above the
	 * list rather than instead of it (design D4). `warning` is the role it
	 * renders in, so that is the pair asserted. `elevated` is now one of
	 * `AS_TEXT`'s grounds as well, so this row is the same assertion stated at
	 * the place it is rendered - which is the half a palette loop cannot see.
	 */
	assertPair(
		id,
		p,
		"warning",
		"elevated",
		FLOOR.text,
		"the picker's partial-listing note",
	);

	/*
	 * The second place, and the one that used to be invisible to this file.
	 *
	 * `danger` is drawn as TEXT on `elevated` by two surfaces: the required-mark
	 * asterisk beside every label in a dialog, and the danger-variant button's
	 * label (the delete confirmation). Asserting the pair is what makes the
	 * decision visible — three palettes are below the floor (monokai 3.76,
	 * dracula 3.81, neon 4.43) and each is pinned below with its measured ratio.
	 * The alternative was a design change to two shared components (a required
	 * mark's colour, and a destructive control's variant on dialog grounds),
	 * which is a decision for the whole app rather than for the code-memory
	 * panel that surfaced it, so it is recorded here instead of made here
	 * (design round 2, D3).
	 *
	 * The code-memory panel's OWN error sentences do not join this list: they
	 * render in `ink` precisely so the panel does not add a third user
	 * (`variable-form-dialog.tsx`).
	 */
	assertPair(
		id,
		p,
		"danger",
		"elevated",
		FLOOR.text,
		"danger as text on a dialog's ground",
	);

	/*
	 * And the border that goes with it, because it is the whole boundary of the
	 * control: the danger-variant button draws `border-danger-border` with no
	 * fill until hover (`button.tsx`), so on a dialog the edge IS the control.
	 *
	 * Eight palettes are under 3:1 here (monokai 2.49 through dune 2.88, measured
	 * from the palettes) and each is pinned below. Repainting a shared control's
	 * variant is an app-wide decision and not this PR's to take; measuring it is
	 * this PR's, because the delete-confirmation frame it adds is where the pair
	 * is now drawn (design round 2, D3).
	 */
	assertPair(
		id,
		p,
		"dangerBorder",
		"elevated",
		FLOOR.nonText,
		"the danger control's only edge on a dialog's ground",
	);

	/* Component triples. */
	for (const c of CONTROLS) {
		for (const g of c.on) {
			const ground = p[g];
			const fill = c.fill ? p[c.fill] : ground;
			const ink = p[c.ink];
			const border = c.border ? p[c.border] : null;
			if (!isHex(ground) || !isHex(fill) || !isHex(ink)) continue;

			/* The control's own label against the control's own fill. */
			assertions++;
			const inkOnFill = ratio(ink, fill);
			if (
				inkOnFill < FLOOR.text &&
				/*
				 * `EXEMPT_INK`'s own rule, applied to a CONTROL's label as well as to a
				 * bare ink: SC 1.4.3 exempts inactive controls, and a disabled control
				 * that meets 4.5:1 does not read as disabled (see the set's comment at
				 * the top of this file, and § 4 of `docs/branding.md`). This loop was
				 * the one place that still demanded the floor of that role - which no
				 * row had asked it for until the composer's refusal state needed one,
				 * and which would have made the state unlistable rather than
				 * unmeasurable. The EDGE assertion below is untouched, so the row still
				 * fails if the boundary stops being perceivable.
				 */
				!EXEMPT_INK.has(c.ink) &&
				!findException(id, c.ink, c.fill ?? g, inkOnFill)
			) {
				fail(
					`${id}: ${c.name} on ${g} — ink ${c.ink} ${ink} on fill ${fill} = ${inkOnFill}:1, need ${FLOOR.text}:1`,
				);
			}

			/* The control's edge against the ground behind it: fill OR border. */
			assertions++;
			const fillEdge = ratio(fill, ground);
			const borderEdge = isHex(border) ? ratio(border, ground) : 0;
			const edge = Math.max(fillEdge, borderEdge);
			if (edge < FLOOR.nonText) {
				/*
				 * This assertion had no pin path, which made it the one floor in this
				 * file that a shared control's colour could only satisfy by being
				 * changed where it was measured. `CONTROL_EDGE_PINNED` records the
				 * case instead, under the same rule as `INK_STEP_PINNED`: the pin is
				 * consulted only when the edge is still under the floor, and the stale
				 * check below fails a pin whose palette no longer needs it.
				 */
				const pin = CONTROL_EDGE_PINNED.find(
					(x) =>
						x.control === c.name &&
						x.ground === g &&
						x.theme === id &&
						Math.abs(x.got - r2(edge)) < 0.01,
				);
				if (pin) {
					controlEdgeSeen.add(
						controlEdgeKey(pin.control, pin.ground, pin.theme),
					);
				} else {
					fail(
						`${id}: ${c.name} on ${g} has no perceivable edge — fill ${fillEdge}:1, border ${borderEdge}:1, need one at ${FLOOR.nonText}:1`,
					);
				}
			}
		}
	}

	/* Graphic objects against the ground they are drawn on. */
	for (const g of GRAPHICS) {
		for (const ground of g.on) {
			assertPair(id, p, g.fg, ground, FLOOR.nonText, g.name);
		}
	}

	/* Foreground pairs: an edge whose two sides are both foreground roles. */
	for (const pair of ADJACENT) {
		const b = p[pair.b];
		if (!isHex(b)) continue;
		for (const roleName of pair.a) {
			const a = p[roleName];
			if (!isHex(a)) continue;
			assertions++;
			const got = ratio(a, b);
			if (got < pair.floor && !findException(id, roleName, pair.b, got)) {
				fail(
					`${id}: ${pair.name} — ${roleName} ${a} against ${pair.b} ${b} = ${got}:1, need ${pair.floor}:1`,
				);
			}
		}
	}

	/* Decorative lines: seen rather than contrasted, and stable across states. */
	for (const item of PERCEPTIBLE) {
		const role = p[item.role];
		if (!isHex(role)) continue;
		for (const g of item.on) {
			if (!isHex(p[g])) continue;
			assertions++;
			const got = deltaE(role, p[g]);
			if (
				got < item.minDeltaE &&
				!findPerceptibleException(id, item.role, g, r2(got))
			) {
				fail(
					`${id}: ${item.name} — ${item.role} ${role} on ${g} ${p[g]} is ΔE00 ${r2(got)}, need ${item.minDeltaE} to be seen at all`,
				);
			}
		}
		/*
		 * ONE COMPONENT, TWO STATES: the weight may not jump. OPT-IN, because a row
		 * can state a separation with no second state to weigh against — the mention
		 * chip's edge is the first (review round 2, R2) — and the shape it used to
		 * have was worse than either: a row missing `pairedWith`/`against` was skipped
		 * WHOLE, so a row written without them looked like an assertion and was none
		 * at all. A row that declares them gets the parity check; a row that does not
		 * says so by leaving them out.
		 */
		if (!item.pairedWith || !item.against) continue;
		const sibling = p[item.pairedWith];
		const ground = p[item.against];
		if (!isHex(sibling) || !isHex(ground)) continue;
		assertions++;
		const a = ratio(role, ground);
		const b = ratio(sibling, ground);
		const change = Math.max(a / b, b / a);
		if (change > item.maxWeightChange) {
			fail(
				`${id}: ${item.name} — ${item.role} is ${r2(change)}x the weight of ${item.pairedWith} against ${item.against}; one component must not change weight by more than ${item.maxWeightChange}x between states`,
			);
		}
	}

	/* Semantics must be distinguishable from each other, not merely legible. */
	for (let i = 0; i < SEPARABLE.length; i++) {
		for (let j = i + 1; j < SEPARABLE.length; j++) {
			const [a, b] = [SEPARABLE[i], SEPARABLE[j]];
			if (!isHex(p[a]) || !isHex(p[b])) continue;
			assertions++;
			const got = deltaE(p[a], p[b]);
			if (got < SEPARATION_FLOOR) {
				fail(
					`${id}: \`${a}\` ${p[a]} and \`${b}\` ${p[b]} are too close to tell apart (ΔE00 ${r2(got)}, need ${SEPARATION_FLOOR}) — a semantic a reader cannot distinguish from another semantic is not a semantic`,
				);
			}
		}
	}

	/*
	 * The second accent: the two accents must be two accents, and the decorative
	 * hue must never be mistakable for a semantic or for a grey.
	 *
	 * One argument in four assertions, and the argument is why `accentAlt` was
	 * worth adding rather than a muted copy of the first hue:
	 *
	 * - ΔE00 15 from `accent` is this file's own "difference of category, not of
	 *   shade" number (`SEPARATION_FLOOR`), and here it is asked at SMALL sizes - a
	 *   1px bar in a 40px miniature, a 6px mark in a diagram - so recall is the
	 *   question rather than side-by-side comparison. It is not a wall: a hue
	 *   rotation clears it on 58 of the 59 palettes, and the 59th (`obsidian`)
	 *   resolves once the chroma is searched upward rather than downward.
	 * - ΔE00 15 from `success`/`warning`/`danger` is the one that costs a reader
	 *   something real: a decorative mark read as "something broke". It is
	 *   deliberately the same constant rather than a harder one - the weakest
	 *   legitimate pair in the tree is `dune`'s `danger`/`info` at 18.4, and a new
	 *   role asked to clear more than the semantics clear against each other is a
	 *   gate that fails by design.
	 * - `info` is treated as its own family rather than as a semantic: the floors
	 *   this role holds against it are argued at the two SITES that draw the two
	 *   together, and they are different bounds for different jobs.
	 *
	 *   As the ledger's two CATEGORY inks - `accentAlt` is the settled `meta` row's
	 *   identity and `info` is `read`'s, one line apart in one column - the pair is
	 *   asked at `SEPARATION_FLOOR` (15) below, the contract's own "difference of
	 *   category, not of shade". Five palettes cannot reach it and are pinned in
	 *   `PAIR_PINS` with the constraint that refuses each: the three `catppuccin*`
	 *   palettes, whose second hue sits in `info`'s own family (2.68, 17.02 and
	 *   19.42 degrees off it), and the two desktop-only palettes whose second hue is
	 *   a rotation of their accent rather than a `label` token to port
	 *   (`localOperatorDark` 12.57, `ayuLight` 13.57).
	 *
	 *   At the role's DECORATIVE sites - a 1px bar in the 40px miniature, a 6px mark
	 *   in a diagram - the same pair takes the reduced `SYNTAX_COMMENT_FLOOR` (8),
	 *   because recall at a size too small to resolve is the question there.
	 *
	 *   NO FIGURE IS TYPED INTO THIS COMMENT, deliberately. The number that ran in
	 *   three places and disagreed in three ways is this pair's: the contract
	 *   carried 8.01, which was its value BEFORE the register re-solve moved both of
	 *   its values (measured on the pre-values `#719AD4`/`#89B4FA`, which is what
	 *   8.01 is), a PR body carried 8.19, and a reviewer's independent computation
	 *   carried 8.70. The run now PRINTS the fleet's tightest pair from the same
	 *   `deltaE` the assertion uses - the `Identity pairs:` line, beside the pin
	 *   count - so there is one number and one source, and a reader who wants it
	 *   reads the run rather than a document that cannot go red.
	 * - `ALT_ACCENT_CHROMA_FLOOR` (15) asserts the AXIS: all three floors above
	 *   can be satisfied by draining the hue toward the ink, which turns the second
	 *   accent into a second grey. See the constant.
	 *
	 * The text floor is asserted below, on the three grounds its own decorative sites
	 * paint it on PLUS the row's state ground (`elevated`), which the trace row
	 * added. It is NOT the `AS_TEXT` loop's six: the alt hue is never drawn on a
	 * dialog's `elevated`, on the selection wash or on the current row, and the
	 * ledger's settled-row hover is the ONE state ground it reaches — asserting the
	 * `rowHover`/`rowSelected` fills here would demand palette values for a pair no
	 * site paints (they are a sibling pass's roles; if the trace row's hover moves
	 * to `rowHover`, this pair moves with it, which is why the comment above the
	 * call says so). The rule that keeps the list honest is the role's own: no text
	 * is painted on `accentAlt`, and none of those pairs can arise.
	 */
	if (isHex(p.accentAlt)) {
		if (isHex(p.accent)) {
			assertions++;
			const got = deltaE(p.accentAlt, p.accent);
			if (got < SEPARATION_FLOOR) {
				fail(
					`${id}: the second accent \`accentAlt\` ${p.accentAlt} is ΔE00 ${r2(got)} from \`accent\` ${p.accent} (need ${SEPARATION_FLOOR}) — two accents have to be two accents at the sizes this one is drawn at, and a value that buys its separation by darkening is the same hue at another weight rather than a second hue`,
				);
			}
		}
		for (const semantic of ["success", "warning", "danger"]) {
			if (!isHex(p[semantic])) continue;
			assertions++;
			const got = deltaE(p.accentAlt, p[semantic]);
			if (got < SEPARATION_FLOOR) {
				fail(
					`${id}: \`accentAlt\` ${p.accentAlt} is ΔE00 ${r2(got)} from \`${semantic}\` ${p[semantic]} (need ${SEPARATION_FLOOR}) — a decorative mark a reader can mistake for "${semantic === "danger" ? "something broke" : semantic}" costs them something real, so the palette moves the hue rather than the assertion`,
				);
			}
		}
		if (isHex(p.info)) {
			assertions++;
			/*
			 * The DECORATIVE-site floor, and the ledger's own pair is asserted
			 * separately below (`assertIdentityPair`) at 15: this one is the 1px bar in
			 * the miniature and the 6px mark in the diagram, where recall at a size too
			 * small to resolve is the question. The comment above the block carries the
			 * argument for the two bounds and for why no figure is typed into it.
			 */
			const got = deltaE(p.accentAlt, p.info);
			if (got < SYNTAX_COMMENT_FLOOR) {
				fail(
					`${id}: \`accentAlt\` ${p.accentAlt} is ΔE00 ${r2(got)} from \`info\` ${p.info} (need ${SYNTAX_COMMENT_FLOOR}) — \`info\` is the family the port mapped the TUI's \`signal\` onto, so the floor here is the reduced one and not ${SEPARATION_FLOOR}; below it the two take the same name`,
				);
			}
		}
		const [, acA, acB] = toLab(p.accentAlt);
		const chroma = Math.hypot(acA, acB);
		assertions++;
		if (chroma < ALT_ACCENT_CHROMA_FLOOR) {
			fail(
				`${id}: \`accentAlt\` ${p.accentAlt} is C* ${r2(chroma)} (need ${ALT_ACCENT_CHROMA_FLOOR}) — a second accent drained toward the ink passes every separation above and stops being a hue, which is the one way this role fails while the gate stays green`,
			);
		}
		/* The three grounds its own sites paint it on. */
		for (const g of ["canvas", "surface", "sunken"]) {
			assertPair(id, p, "accentAlt", g, FLOOR.text, "second accent as text");
		}
		/*
		 * AND THE FOURTH, which is the one the tool row added and the reason this
		 * block grew a ground at all.
		 *
		 * `accentAlt` is the settled `meta` row's identity ink (`tool-row.tsx`'s
		 * `CATEGORY_INK`), and a settled row's hover paints `bg-elevated`
		 * (`tool-row.tsx:633`) — so hovering a `hub`/`task`/`todo` row draws this
		 * role as 12px TEXT on `elevated`. Neither prior site did: the theme picker's
		 * miniature is 1px-2.5px bars and mermaid's categorical fill carries `ink`
		 * labels, so the role's text floor was asserted on the three grounds a CHIP
		 * paints it on and no state ground was ever measured. That is exactly the
		 * scope gap this asserts shut, and it is asserted rather than pinned: 4.5:1
		 * on text is the floor the whole file is for, and ten palettes were below it
		 * before the palette pass beside this assertion (worst `kanagawaWave`
		 * 4.05:1).
		 *
		 * The `meta` ink's own re-seat is recorded in the palettes: where the role was
		 * seated at its floor on `surface` (catppuccinMocha 4.51:1) an added ground
		 * had no headroom to spend, so those ten values were re-seated at their own
		 * hue — measured, `elevated` 4.05-4.23:1 -> 4.55-4.60:1 — which is the
		 * palette moving rather than the floor.
		 *
		 * COORDINATION, stated because the ground is not this change's to own:
		 * `rowHover`/`rowSelected` are a sibling pass's roles (PR #386) and a row's
		 * hover is heading for `rowHover` there. This asserts the ground the row
		 * RESOLVES TO today — `elevated`, the class in `tool-row.tsx` — so if that
		 * class moves, this pair moves with it and re-measures against the new fill
		 * rather than silently asserting a ground nothing paints any more.
		 */
		assertPair(
			id,
			p,
			"accentAlt",
			"elevated",
			FLOOR.text,
			"second accent as text on a row's state ground",
		);
	}

	/*
	 * ------------------------------------------------------------------
	 * THE TOOL ROW'S TWO IDENTITY PAIRS, as text in one column.
	 *
	 * Both are new SITES for roles whose floors were written for other ones, and
	 * both are asserted here rather than left to the prose that already described
	 * the failure. See the two floors' own comment for the bound each pair takes
	 * and the argument for it; the shape below is the same for both: measure, and
	 * accept a below-floor pair ONLY through a `PAIR_PINS` entry whose recorded
	 * value still matches and whose reason names the refusing constraint.
	 */
	assertIdentityPair(
		id,
		p,
		"accentAlt",
		"info",
		IDENTITY_PAIR_FLOOR,
		"the tool row's two category inks",
	);
	assertIdentityPair(
		id,
		p,
		"info",
		"accent",
		LIVENESS_PAIR_FLOOR,
		"the settled read ink against the liveness ink",
	);

	/*
	 * And the two washes may sit adjacent in one ramp.
	 *
	 * `accentAltWash` is the index-1 entry of mermaid's categorical cycle, so it
	 * is painted directly beside `accentWash`. The floor is the file's field floor
	 * (2.0) and NOT the 4 or 8 a line and a token take: measured on the tree's own
	 * wash pairs, cross-hue washes run as low as 1.18 (`catppuccinFrappe`'s
	 * `accentWash`/`dangerWash`), so a floor of 8 would fail pairs that ship today.
	 * Where a palette genuinely cannot reach it - the wash axis is where
	 * near-neutral palettes run out of chroma - the pair is pinned in `EXCEPTIONS`
	 * with its measured ΔE00 and a reason, which is the contract's own mechanism
	 * for an accepted sub-floor pair and is not a mute: moving the token breaks the
	 * pin. Tightest measured today: `rosePine` at 2.05.
	 */
	if (isHex(p.accentAltWash) && isHex(p.accentWash)) {
		assertions++;
		const got = deltaE(p.accentAltWash, p.accentWash);
		if (got < FIELD_SEPARATION_FLOOR) {
			fail(
				`${id}: \`accentAltWash\` ${p.accentAltWash} is ΔE00 ${r2(got)} from \`accentWash\` ${p.accentWash} (need ${FIELD_SEPARATION_FLOOR}) — the two washes sit adjacent in mermaid's categorical ramp, so a step the reader cannot see is not a step`,
			);
		}
	}

	/* Syntax tokens must stand apart from the comments and names they sit
	   beside. See SYNTAX_HUE_ROLES for what is excluded and why. */
	for (const role of SYNTAX_HUE_ROLES) {
		if (!isHex(p[role]) || !isHex(p.inkDim)) continue;
		assertions++;
		const got = deltaE(p[role], p.inkDim);
		if (got < SYNTAX_COMMENT_FLOOR) {
			fail(
				`${id}: syntax \`${role}\` ${p[role]} sits at ΔE00 ${r2(got)} from comment \`${p.inkDim}\` (need ${SYNTAX_COMMENT_FLOOR}) — a token the eye cannot separate from the comment beside it is not highlighted`,
			);
		}
	}

	/*
	 * The composer's command token. Floors: 4.5:1 as TEXT on the field and on the
	 * popup's ground, and a ΔE00 separation from the three inks it is read beside
	 * in one line — prose `ink`, `accent`, and the resolved roster name.
	 *
	 * The name's own ratification is asserted here too (`success` vs `ink` only):
	 * the design round measured that no text role separates from `accent` in all
	 * twelve palettes then shipping, so the name keeps the palette's green — which
	 * is what the TUI does with `$lo-string` — and the four accent identities are
	 * recorded above as prose rather than asserted into a false floor.
	 */
	if (isHex(p[COMMAND_TOKEN]) && isHex(p.ink)) {
		const pin = COMMAND_TOKEN_PINNED.find((e) => e.theme === id);
		for (const ground of COMMAND_TOKEN_GROUNDS) {
			if (!isHex(p[ground])) continue;
			assertions++;
			const got = ratio(p[COMMAND_TOKEN], p[ground]);
			if (got < 4.5) {
				fail(
					`${id}: the command token \`tokenCommand\` ${p[COMMAND_TOKEN]} reads ${r2(got)}:1 on \`${ground}\` (need 4.5) - the leading /word is text a user is typing, not decoration`,
				);
			}
		}
		for (const against of ["ink", "accent", "success"]) {
			if (!isHex(p[against])) continue;
			assertions++;
			const got = deltaE(p[COMMAND_TOKEN], p[against]);
			const pinned = Boolean(pin?.against.includes(against));
			if (pinned) {
				if (Math.abs(pin.got - got) >= 0.01)
					fail(
						`${id}: COMMAND_TOKEN_PINNED records ${pin.got} for \`command\`/\`${against}\` but it now measures ${r2(got)} - re-measure and update the pin (${pin.why})`,
					);
				continue;
			}
			if (got < COMMAND_TOKEN_FLOOR)
				fail(
					`${id}: the command token \`tokenCommand\` ${p[COMMAND_TOKEN]} sits at ΔE00 ${r2(got)} from \`${against}\` ${p[against]} (need ${COMMAND_TOKEN_FLOOR}) - the composer paints this run in the same box as that ink, so a reader cannot tell which is which`,
				);
		}
		if (isHex(p.success)) {
			assertions++;
			const got = deltaE(p.success, p.ink);
			if (got < COMMAND_TOKEN_FLOOR)
				fail(
					`${id}: the roster NAME's ink \`success\` ${p.success} sits at ΔE00 ${r2(got)} from prose \`ink\` ${p.ink} (need ${COMMAND_TOKEN_FLOOR}) - a resolved name that reads as prose is not a run`,
				);
		}
	}

	/* The control/readout ink step: measured always, floored where it can be. */
	if (isHex(p.inkMuted) && isHex(p.inkDim)) {
		assertions++;
		inkStepSeen.add(id);
		const got = deltaE(p.inkMuted, p.inkDim);
		const pin = INK_STEP_PINNED.find((e) => e.theme === id);
		if (pin) inkStepPinSeen.add(pin);
		if (got < INK_STEP_FLOOR) {
			if (!pin)
				fail(
					`${id}: the control ink \`inkMuted\` ${p.inkMuted} sits at ΔE00 ${r2(got)} from the readout ink \`inkDim\` ${p.inkDim} (need ${INK_STEP_FLOOR}) - a chip that opens cannot be told from a reading that does not`,
				);
			else if (Math.abs(pin.got - got) >= 0.01)
				fail(
					`${id}: INK_STEP_PINNED records ${pin.got} but \`inkMuted\`/\`inkDim\` now measure ${r2(got)} - re-measure and update the pin, so the recorded number stays the one in the palette`,
				);
		} else if (pin) {
			fail(
				`${id}: the ink step is pinned at ${pin.got} but now measures ${r2(got)}, clearing the ${INK_STEP_FLOOR} floor - delete the pin rather than leaving dead weight in the contract`,
			);
		}
	}

	/* Adjacent grounds must be a perceptible step, not merely a passing ratio.
	   D21 established that 1.03:1 is a gate floor, not a human threshold -
	   sage's canvas/surface at 1.9 dE00 renders a visible card boundary and
	   localOperatorLight at 1.5 did not.

	   `canvas`/`sunken` is not in this list, and the reason it used to give -
	   "they are never adjacent on screen" - was false: `output-block.tsx` and
	   `log-block.tsx` render `bg-sunken` inside a trace that sits on `canvas`.
	   The real reason is that the pair cannot be separated by luminance in the
	   near-black palettes at all: obsidian's canvas is #09090B and its sunken
	   #030307, ΔE00 1.23, and there is no darker value left to move to that is
	   not black. So those two blocks now carry `border-hairline`. Their sibling
	   `error-block.tsx` has always been bounded too, though by a louder edge -
	   `border-danger-border` on `bg-danger-wash` - because it is reporting a
	   failure; the hairline is the neutral form of the same idea.

	   That edge is asserted here, against all four grounds it is drawn on. It
	   is NOT in `STRUCTURAL`, and an earlier version of this comment claimed it
	   was: `STRUCTURAL` holds `borderControl` and asserts a 3:1 ratio, which a
	   hairline is designed never to reach - a separator that shouted would be a
	   border. Perceptibility is the right question for it, and ΔE00 is what
	   asks it.

	   But NOT at the same floor. 2.0 was calibrated on adjacent ground FIELDS -
	   two large planes meeting - and a 1px line is not a field. The frames
	   proved the difference: at 2.10, localOperatorDark's dropdown separator
	   rendered byte-identical to the panel around it, while the same 2.0 floor
	   is plainly enough for a card sitting on a canvas. A line has almost no
	   area to integrate over, so it needs roughly twice the separation to
	   register at all. Hence two floors, and the line floor is the one that
	   moved five palettes. */
	/* The accent's three states are a ramp the user reads as one control
	   changing, so each step has to be visible for the same reason the ground
	   steps do. Nothing asserted them until now, which is how round 5's
	   pressed-fill repair could cut dracula's rest-to-pressed distance from
	   10.43 to 5.72 without a single gate noticing. These are fields - a whole
	   button fill - so they take the field floor. */
	for (const [a, b] of [
		["canvas", "surface"],
		["surface", "elevated"],
		["elevated", "sunken"],
		["accent", "accentHover"],
		["accentHover", "accentActive"],
		["accent", "accentActive"],
		/* The secondary button's ramp is the ground roles - `surface` at rest,
		   `elevated` on hover, `sunken` when pressed - and its rest-to-pressed
		   pair is the one a keyboard user holding Space actually sees. The two
		   adjacent steps were already asserted above as grounds; the end-to-end
		   distance was not, which is the same gap `accent`/`accentActive`
		   closed for the primary. */
		["surface", "sunken"],
	]) {
		if (!isHex(p[a]) || !isHex(p[b])) continue;
		assertions++;
		const got = deltaE(p[a], p[b]);
		if (got < FIELD_SEPARATION_FLOOR) {
			fail(
				`${id}: adjacent \`${a}\` and \`${b}\` are ΔE00 ${r2(got)} apart (need ${FIELD_SEPARATION_FLOOR}) — a step the eye cannot see is not a step`,
			);
		}
	}

	/*
	 * ---- the legibility pass -------------------------------------------------
	 *
	 * The operator's report was two defects that read as one - "the background
	 * behind the main text is too dark/black" and "text is a little too grey on
	 * grey" - plus a third that arrived beside them: "selections are not very
	 * appealing and look very off, and are often not well contrasted".
	 *
	 * THE LIFT AND THE INKS ARE ONE CHANGE, and this block is the reason. Lifting
	 * a dark ground raises the luminance every ink is measured against, so every
	 * ink ratio falls: simulated with the ladder preserved, `localOperatorDark`'s
	 * `inkDim` on `elevated` goes 4.61 -> 3.71 and `inkDisabled` 2.28 -> 1.83, and
	 * all 23 sub-floor dark palettes gain NEW ink-floor violations. A change that
	 * lifted the grounds without re-authoring the inks would therefore make the
	 * operator's complaint worse, which is why the grounds, the ink weights and
	 * `borderControl` - which fails 3:1 on the lifted `elevated` in eight palettes
	 * - all land in one commit. All 59 palettes satisfy this block with zero
	 * exemptions, which is why it is asserted strictly.
	 */

	/* 1. The lift. A floor on the page ground, and a ceiling at the top of the
	      ladder: both are load-bearing, and for the same reason. */
	{
		const lc = toLab(p.canvas)[0];
		const ls = toLab(p.surface)[0];
		const le = toLab(p.elevated)[0];
		const lk = toLab(p.sunken)[0];
		const dark = p.mode === "dark";

		assertions++;
		if (dark && (lc < LIFT.dark.canvasMin || lc > LIFT.dark.canvasMax)) {
			fail(
				`${id}: dark \`canvas\` ${p.canvas} sits at L* ${r2(lc)} — the band is [${LIFT.dark.canvasMin}, ${LIFT.dark.canvasMax}] in L*. Below the floor the three ink weights and the three ladder steps stop fitting above each other without one of them breaking its own floor; above the ceiling the canvas is no longer off-black, which is the whole of what the operator asked for`,
			);
		}
		assertions++;
		if (dark && le > LIFT.dark.elevatedMax) {
			fail(
				`${id}: dark \`elevated\` ${p.elevated} sits at L* ${r2(le)} — the ceiling is L* ${LIFT.dark.elevatedMax}, because at L* 34 an \`inkDim\` at its floor needs L* 85 and the ink/hover distinction disappears into the top of the ramp`,
			);
		}
		assertions++;
		if (!dark && lc > LIFT.light.canvasMax) {
			fail(
				`${id}: light \`canvas\` ${p.canvas} sits at L* ${r2(lc)} — the ceiling is L* ${LIFT.light.canvasMax}. \`elevated\` at L* 100 is the end of sRGB's ramp and the minimum canvas-to-elevated spread is 2.5 + 2.5 L*, so a canvas above 95 has no room for both steps; 94 leaves 1 L* for 8-bit rounding`,
			);
		}
		assertions++;
		if (!dark && lk < LIFT.light.sunkenMin) {
			fail(
				`${id}: light \`sunken\` ${p.sunken} sits at L* ${r2(lk)} — the floor is L* ${LIFT.light.sunkenMin}. A light theme's recessed ground is the darkest plane in it, so it is the cap for every ink there and the keycap's ground on every selected row`,
			);
		}

		/* 2. The ladder, as L* offsets from the canvas. `sunken` is measured
		      from the canvas going down, the other two going up. */
		for (const [name, from, to, [lo, hi], step] of [
			["canvas -> surface", "canvas", "surface", STEP.canvasSurface, ls - lc],
			[
				"surface -> elevated",
				"surface",
				"elevated",
				STEP.surfaceElevated,
				le - ls,
			],
			["canvas -> sunken", "canvas", "sunken", STEP.canvasSunken, lc - lk],
		]) {
			assertions++;
			if (step < lo - 1e-9 || step > hi + 1e-9) {
				fail(
					`${id}: the ${name} step is ${r2(step)} L*, outside [${lo}, ${hi}] — the bounds are both ends of the same budget: below the floor the two grounds merge, and above the ceiling the step eats the room the ink ladder needs`,
				);
			}
			/* The ratio half of every ground pair (1.03) is asserted by the
			   four-grounds loop above, which covers all six pairs; it is asserted
			   here as well for the three NAMED steps, so the ladder's own rule is
			   stated where the ladder is. */
			assertPair(id, p, from, to, GROUND_RATIO, `${name} step`);
			/* This adds the perceptual half for the two pairs no loop measured
			   before: the well under the canvas, and - since the row/hover pass -
			   the hovered rung over its panel, whose L* floor above is only a
			   proxy for it. See `ELEVATED_PANEL_DELTA_E` for why the proxy had to
			   become the looser of the two. */
			if (
				(from === "canvas" && to === "sunken") ||
				(from === "surface" && to === "elevated")
			) {
				assertions++;
				const got = deltaE(p[from], p[to]);
				const need =
					from === "canvas" ? GROUND_STEP_DELTA_E : ELEVATED_PANEL_DELTA_E;
				if (got < need) {
					fail(
						from === "canvas"
							? `${id}: \`canvas\` and \`sunken\` are ΔE00 ${r2(got)} apart (need ${need}) — a well nobody can see is not a well, and both blocks that paint one are read inside a trace that sits on the canvas`
							: `${id}: \`surface\` ${p.surface} and \`elevated\` ${p.elevated} are ΔE00 ${r2(got)} apart (need ${need}) — the hover rung is the ground a hover, a menu and a dialog are all painted on, so it cannot sit closer to the panel than this and still report the pointer; it is also the ground the current row has to outrank, so a rung at this floor is what the row/hover ordering is measured against. Place it at the lowest \`L*\` that clears this and no lower - the row's own rank against the hover is asserted in the row-state loop below, so a rung placed here is a rung the two row fills have to fit above`,
					);
				}
			}
		}
	}

	/* 3. The transcript's own floor: `ink` on `canvas` gets 8.0:1. */
	assertPair(
		id,
		p,
		"ink",
		"canvas",
		INK_CANVAS_FLOOR,
		"the transcript's body ink",
	);

	/* 4. `inkDisabled` is constrained from ABOVE, and only from above: it has no
	      floor, but it must stay weaker than `inkDim` on every ground, or a
	      disabled control stops reading as disabled. */
	for (const g of GROUNDS6) {
		if (!isHex(p.inkDisabled) || !isHex(p.inkDim) || !isHex(p[g])) continue;
		assertions++;
		const got = ratio(p.inkDisabled, p[g]);
		const reference = ratio(p.inkDim, p[g]);
		if (got > DISABLED_CEILING * reference + 1e-9) {
			fail(
				`${id}: \`inkDisabled\` on ${g} measures ${r2(got)}:1 against \`inkDim\`'s ${r2(reference)}:1 — a factor of ${r2(got / reference)}, over the ${DISABLED_CEILING} ceiling. A disabled control that meets the ink floors does not read as disabled`,
			);
		}
	}

	/* 5. The ink weights are a hierarchy, so the floors alone are not enough:
	      three inks each at their floor can be the same colour. */
	for (const [lower, upper] of [
		["inkDim", "inkMuted"],
		["inkMuted", "ink"],
	]) {
		if (!isHex(p[lower]) || !isHex(p[upper])) continue;
		assertions++;
		const got = deltaE(p[lower], p[upper]);
		if (got < INK_STEP_DELTA_E) {
			fail(
				`${id}: \`${upper}\` and \`${lower}\` are ΔE00 ${r2(got)} apart (need ${INK_STEP_DELTA_E}) — the three weights are a ladder, and a rung the eye cannot see is not a rung`,
			);
		}
	}

	/*
	 * 6. The selection row: the command palette's active row and the picker's
	 * keyboard row, both painted on a dialog's `elevated`.
	 *
	 * Both take `bg-sunken`, which is the repo's own answer and not this pass's:
	 * `picker-host.tsx` chose it for the keyboard's row because it is "the only
	 * ground role that steps perceptibly away from the dialog's own `bg-elevated`
	 * in every one of the palettes" (re-measured here: ΔE00 6.07-16.18 across all 59
	 * on the grounds this branch ships - the figure at the commit that chose the role
	 * was 5.85-16.70, measured before the legibility pass lifted 31 `sunken` and 32
	 * `elevated` values), and
	 * the command palette's active row was the sibling that kept the accent wash
	 * alone - the row the operator screenshotted, which read 1.003:1 on
	 * `localOperatorDark` while passing every threshold by hue.
	 *
	 * WHAT THIS DOES NOT ASSERT, and why - it is a RECORDED deviation rather than
	 * a passed check. The rule a purpose-authored selection step has to satisfy
	 * also includes a hue clause (within 45° of its base where the base's chroma
	 * is >= 4, else chroma within the base's plus 4). `sunken` is the palette's
	 * own recessed ground rather than a tint authored for this row, and it does not
	 * satisfy that clause in eight palettes: seven light palettes carry more chroma
	 * in `sunken` than their own near-neutral `elevated` plus the 4 the clause
	 * grants - alucard 9.98 C* against 6.56, ayuLight 4.75 against 4.00,
	 * localOperatorLight 7.54 against 5.56, mintLight 10.01 against 5.24,
	 * rosePineDawn 7.81 against 5.07, sage 9.67 against 6.56, solarizedLight 10.10
	 * against 6.06 - and `dune`'s sunken sits 49.58° from its elevated, 4.58°
	 * outside the limit. Both are the palette's own cast on a
	 * recessed plane, which is what the clause exists to catch only when it has
	 * been AUTHORED onto a selection; the two marks the clause would otherwise
	 * separate are separated here by ΔE00 6.07-16.18, the widest margin in the
	 * system. Recorded as an open question for the design round rather than
	 * silently dropped.
	 */
	{
		const got = deltaE(p.sunken, p.elevated);
		assertions++;
		if (got < SELECTION_DELTA_E) {
			fail(
				`${id}: the palette/picker active row (\`sunken\` ${p.sunken}) is ΔE00 ${r2(got)} from the dialog ground it is painted on (\`elevated\` ${p.elevated}), need ${SELECTION_DELTA_E} — a selection is a state the reader has to find while scanning, not a surface they read, and below this band it stops being findable`,
			);
		}
		assertions++;
		const step = Math.abs(toLab(p.sunken)[0] - toLab(p.elevated)[0]);
		if (step < SELECTION_LIGHTNESS_STEP) {
			fail(
				`${id}: the palette/picker active row sits ${r2(step)} L* from \`elevated\`, under the ${SELECTION_LIGHTNESS_STEP} L* floor — ΔE00 is a budget a chroma-only step can spend while the mark vanishes in a greyscale render, so the lightness half is asserted too`,
			);
		}
	}

	/*
	 * 7. The accent wash is a HOVER and CALLOUT tint - not a selection ground.
	 *
	 * It keeps every other use it has (pointer hover fills, chips, the find-match
	 * tint, the ask-option card, the browser tab-strip marker, the `border-accent`
	 * markers) and gains this one floor: half a selection's, because a hover is
	 * transient and is paired with the pointer. It fails in 11 palettes at the
	 * old scope - 7 on `surface` (`catppuccinMacchiato` 0.80, `tokyoNight` 1.05,
	 * `alucard` 1.22, `solarizedDark` 1.61, `catppuccinFrappe` 1.79, `everforest`
	 * 1.80, `kanagawaWave` 1.89), 2 on `elevated` (`obsidian` 0.77, `everforest`
	 * 1.42) and 2 on `sunken` (`tokyoNightDay` 1.13, `ayuLight` 1.81) - which is
	 * why the wash is re-authored in those 11 rather than the floor being set
	 * where the existing values happen to sit.
	 */
	for (const g of GROUNDS) {
		if (!isHex(p.accentWash) || !isHex(p[g])) continue;
		assertions++;
		const got = deltaE(p.accentWash, p[g]);
		if (got < HOVER_DELTA_E) {
			fail(
				`${id}: the accent wash on ${g} is ΔE00 ${r2(got)} (need ${HOVER_DELTA_E}) — a hover tint the reader cannot see is a hover state the pointer cannot report, and this pair reads 1.00-1.24:1, so no ratio assertion in this file can see it`,
			);
		}
	}

	/*
	 * 8. The keycap's ground, against everything it can be painted on.
	 *
	 * A keycap is an annotation on the row the user has just SELECTED, so the
	 * pair that decides whether it survives is `sunken` against the state
	 * grounds: measured at the old scope, `tokyoNightDay` rendered it at ΔE00
	 * 1.13 on `accentWash` and `ayuLight` at 1.81 - a cap whose ground disappears
	 * under it. The cap's SHAPE and its ink are other rows; this is its ground.
	 *
	 * THE TWO ROW STATES ARE NO LONGER IN THIS PAIR (row-state refinement,
	 * 2026-09-18), by the same argument that withdrew the row roles' own
	 * `canvas`/`elevated`/`sunken` collision floor: a row fill that is the panel's
	 * own colour one step up IS a rung of the ladder, and `sunken` is the rung one
	 * below it - so on the 9 palettes whose ladder is at its own 2.0 floor the
	 * measured gap runs 0.44 (`alucard`) to 1.86 (`iceberg`), and no legal fill
	 * can clear it, because clearing it would mean leaving the ladder the fill
	 * has just been put on. The premise moved too: the cap carries NO fill of its
	 * own any more (the `bg-sunken` cap was removed by the operator's report in
	 * `keyboard-shortcut.tsx`), so what a cap needs on a row is its INK against
	 * that row, which is asserted for all four ink weights where the rows are
	 * grounds in `GROUNDS6`. The risk this accepts: a `bg-sunken` box placed
	 * INSIDE a selected or hovered row would merge with it on those 9 palettes.
	 * Nothing in the tree does that today - the rail's current rows are
	 * `rowSelected` and the caps on them are fill-less text - and it is stated
	 * here rather than left for a reviewer to discover.
	 */
	for (const g of ["canvas", "surface", "elevated", "accentWash"]) {
		if (!isHex(p.sunken) || !isHex(p[g])) continue;
		assertions++;
		const got = deltaE(p.sunken, p[g]);
		if (got < KEYCAP_DELTA_E) {
			fail(
				`${id}: the keycap's ground \`sunken\` ${p.sunken} is ΔE00 ${r2(got)} from ${g} ${p[g]} (need ${KEYCAP_DELTA_E}) — the cap annotates the row the reader has just selected, so its ground has to survive being painted on that row`,
			);
		}
	}

	/* The chart's hover mark: findable among its siblings, and never closer to the
	   plot ground than the resting mark. */
	if (
		isHex(p.chartBarHover) &&
		isHex(p.accent) &&
		isHex(p[CHART_HOVER_GROUND])
	) {
		assertions++;
		const separation = deltaE(p.chartBarHover, p.accent);
		if (separation < CHART_HOVER_SEPARATION_FLOOR) {
			fail(
				`${id}: \`chartBarHover\` ${p.chartBarHover} is ΔE00 ${r2(separation)} from \`accent\` ${p.accent}, need ${CHART_HOVER_SEPARATION_FLOOR} — a mark the reader has to find among its SIBLINGS is compared with them, not with itself across two states`,
			);
		}
		assertions++;
		const hovered = ratio(p.chartBarHover, p[CHART_HOVER_GROUND]);
		const resting = ratio(p.accent, p[CHART_HOVER_GROUND]);
		if (hovered < resting) {
			fail(
				`${id}: \`chartBarHover\` is ${r2(hovered)}:1 on ${CHART_HOVER_GROUND} where \`accent\` is ${r2(resting)}:1 — the hovered mark must not recede toward the ground it is drawn on`,
			);
		}
	}

	/* Both ends of the hairline's range, because only one of them was gated.
	 *
	 * The floor doubled to 4.0 on the argument that a rule needs more than a
	 * field, and the thing that stops that argument running away - "and it
	 * still has to stay a hairline, not become a border" - was written in prose
	 * and enforced nowhere. A `#6e6e73` obsidian hairline passes at 4.06:1
	 * against canvas, sits ΔE00 2.70 from `borderControl`, and clears every
	 * other assertion in this file. So the ceiling is a rule now too.
	 */
	for (const ground of GROUNDS) {
		if (!isHex(p.hairline) || !isHex(p[ground])) continue;
		assertions++;
		const got = deltaE(p.hairline, p[ground]);
		if (got < LINE_SEPARATION_FLOOR) {
			fail(
				`${id}: \`hairline\` on \`${ground}\` is ΔE00 ${r2(got)} (need ${LINE_SEPARATION_FLOOR}) — a 1px line has no area to integrate over, so a step that reads between two fields disappears in a rule`,
			);
		}
		const luminance = ratio(p.hairline, p[ground]);
		assertions++;
		if (luminance < HAIRLINE_RATIO_FLOOR) {
			fail(
				`${id}: \`hairline\` on \`${ground}\` is ${r2(luminance)}:1 (need ${HAIRLINE_RATIO_FLOOR}) — its ΔE00 is carried in chroma, which a 1px line does not survive`,
			);
		}
		assertions++;
		if (luminance > HAIRLINE_RATIO_CEILING) {
			fail(
				`${id}: \`hairline\` on \`${ground}\` is ${r2(luminance)}:1 (max ${HAIRLINE_RATIO_CEILING}) — past this it is drawing a border, and the system already has one of those`,
			);
		}
	}
}

/* ---- 5b. the fleet: the invariants that only exist BETWEEN palettes ------ */

/*
 * WHY THIS SECTION EXISTS, and why it is not another per-palette loop.
 *
 * Every assertion above is a property of ONE palette, so a change that slides the
 * whole fleet together satisfies all of them: 59 palettes can each hold their own
 * bands while the fleet they belong to collapses into one grey band. That is
 * exactly what the operator reported - "some themes also feel a lot more grey now
 * since a lot of the tones were centrally tended" - and it is invisible to a
 * per-palette gate by construction, which is how the depth this branch restores
 * was spent in the first place.
 *
 * The numbers below therefore ran in PROSE for two rounds: the fleet's register
 * population, its collision counts and its near-neutral ladder are quoted in
 * `palette-contract.ts` and in the commit messages, and prose cannot go red. The
 * spec this pass implements asked for this section by name (SS 1.4 / D5) for that
 * reason: "a fleet section that runs once over all palettes, so nothing can
 * flatten the fleet while every per-palette gate stays green".
 *
 * HOW A RULE THAT DOES NOT HOLD ON THE SHIPPED FLEET IS HANDLED: each boundary is
 * set to the SHIPPED measurement and the comment names the target it falls short
 * of. That makes every entry a RATCHET rather than a claim - an improvement passes,
 * a regression fails - and it is why two of the spec's hard targets (zero
 * byte-identical canvases, zero sub-1.0 pairs) appear here at 2 and 5 rather than
 * being omitted until somebody can meet them.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: the canvas `L*` standard deviation. A fleet
 * that keeps its dark skew honestly has a low sd, so asserting sd above its honest
 * value would be the same mistake in the other direction (spec SS 1.4 says so).
 * The window population is the headline that replaces it.
 */

/** The width of the register window the fleet is counted in, in `L*`. */
const FLEET_WINDOW = 1.5;
/** Measured 14; the spec's ceiling is also 14, so this one has no headroom. */
const FLEET_DARK_WINDOW_CEILING = 14;
/** A dark page ground below this is the register the pass emptied. */
const FLEET_DARK_DEEP_L = 13.5;
/** Measured 14; the spec's ceiling is 14. */
const FLEET_DARK_DEEP_CEILING = 14;
/** Measured 5 (`origin/main` 7); the spec's target is 0. */
const FLEET_DARK_SUB1_CEILING = 5;
/** Measured 2 (`origin/main` 3); the spec's target is 0. */
const FLEET_DARK_IDENTICAL_CEILING = 2;
/** The register the near-neutral palette's identity is carried by. */
const FLEET_DARK_UPPER_LO = 18;
const FLEET_DARK_UPPER_HI = 22;
/** Measured 4; the spec's target is `>= 5`. */
const FLEET_DARK_UPPER_FLOOR = 4;
/** Measured 9.95 this pass, 9.99 before it; a floor, not a target. */
const FLEET_DARK_SPREAD_FLOOR = 9.5;
/** Measured 10 of 18 light canvases; the spec's ceiling is 8 (D14). */
const FLEET_LIGHT_WINDOW_CEILING = 10;
/** The light ceiling's own squeezing window. */
const FLEET_LIGHT_HIGH_L = 91.3;
/** Measured 12; the spec's ceiling is 9 (D14). */
const FLEET_LIGHT_HIGH_CEILING = 12;
/** Measured 1 (`origin/main` 1); the spec's target is 0. */
const FLEET_LIGHT_SUB1_CEILING = 1;
/** A near-neutral canvas has no cast to be told apart by, only depth. */
const FLEET_NEAR_NEUTRAL_CHROMA = 2.5;
/** The register's own spec target, in `L*`: the step a near-neutral is told apart by. */
const FLEET_NEAR_NEUTRAL_TARGET = 2.5;
/**
 * Measured 9, and the spec's target is 0 pairs: the dark register's `arcade`/
 * `obsidian` ship the SAME hex (0.000 `L*` apart) with `dune` 0.001 off both, and the
 * light family's near-whites are closer still (0.163-1.40). A floor cannot say that -
 * the minimum gap is 0.000 by construction, so the branch was unreachable while the
 * run still counted it as an assertion (review round 2, F2) - so the population is
 * carried instead, the way the identical-pair rule carries its ceiling.
 */
const FLEET_NEAR_NEUTRAL_PAIRS_CEILING = 9;

/**
 * The three movers' re-solve rules, as the values are actually held.
 *
 * `HUE_PIN_DEGREES` is the spec's R3 pin, and it does not hold - 33 of the 168
 * moved role values sit above it, the worst `ocean.canvas` at 6.057 degrees. That
 * is not drift the authoring could have avoided by trying harder and it is not a
 * forced drift either; the measurement says it is neither:
 *
 *   - `ocean.canvas` #142228 -> #1D2A31 measures |dh| 6.057, and the pure-L*
 *     re-solve of the same role - pre `a` and `b` held, post `L*` - lands at
 *     #1C2A30, 0.828 degrees. So the shipped value differs from a pure lightness
 *     move by ONE channel step on R and B, and at C* 7.14 one 8-bit step is worth
 *     up to 14.2 degrees of hue: the pin is measuring the LATTICE, not the move.
 *
 * So the assertion below asks the question the prose actually claims - "only
 * lightness moved" - in the unit the values are held in: the shipped value must be
 * within ONE 8-bit channel step of the pure-L* re-solve, and its hue must sit
 * inside the envelope its own quantisation allows. `HUE_PIN_DEGREES` is kept as the
 * second clause so a value that rotates further than a step still fails on its
 * degrees, and the reported figure is the move set's: the fleet line prints how many
 * of the 168 moved values sit above the 1 degree pin WHILE STAYING inside the
 * envelope (33 at this head, and 0 outside it), so the number that ran as "the pin
 * fails" in review is the number the gate now reports rather than one it hides.
 *
 * The hue half is DISCLOSURE, not the operative measure, and two measured facts
 * should stop the next reader treating it as one (review round 2, F3 and its NIT):
 * the pin can never bind on this move set, because `pin = max(1, envelope)` and the
 * smallest envelope over the 168 values is 1.88 degrees (`vaporwave.elevated`), so
 * the 1 degree term only ever adds strictness below the chroma where the lattice
 * allows less than a degree; and the chroma clause is exercised by no shipped value
 * either, because the move set's single spend is `tokyoNight.ink` at 0.800 x - and
 * that role has no in-gamut re-solve, so it takes the `MOVED_BEYOND_LIGHTNESS` branch
 * before the clause is reached. The channel step is the clause that decides, and the
 * two clauses beside it are kept for the spec's sake rather than as coverage.
 *
 * Where the pure-L* re-solve is outside sRGB there is no candidate to compare, so
 * the role is named with its reason instead of being waved through - the two
 * entries it did not have to walk past are asserted in both directions, so an entry nothing needs fails rather than sitting there.
 *
 * WHAT THIS RULE COVERS, because an unasserted coverage claim is how the last
 * version of it passed review while holding 44 of the 168 values (review round 2,
 * MAJOR): the walk below is over `REGISTER_MOVES`' own pre-values, which are every
 * role value this pass moved, so all 168 are held to all three clauses, and the
 * fleet line reports the count it walked. An entry whose role has left the palette,
 * or whose value is back at the pre value it names, fails rather than being skipped:
 * the population is the claim, so a table that no longer describes the move set has
 * to fail instead of quietly narrowing.
 */
const HUE_PIN_DEGREES = 1;
const MOVED_CHANNEL_STEP_TOLERANCE = 1;
const MOVED_CHROMA_FLOOR = 0.9;

/**
 * The move set's size, as the record states it. The walk asserts it rather than
 * assuming it, so "0 outside the envelope over the whole move set" is a number the
 * gate can fail on rather than a count somebody made once by hand.
 */
const MOVED_VALUE_COUNT = 168;

/**
 * The eleven palettes the identity re-solve moved, with EVERY role value each of
 * them shipped BEFORE it - the values their own file records as the previous ones
 * (`canvas #1A1B26 -> #1E1F2A -> #2A2A35`).
 *
 * 168 values across the eleven palettes, which is the move set the record names. Two
 * roles are deliberately absent: `rowHover` and `rowSelected` are NEW here (11 x 2
 * values have no predecessor on `origin/main` to hold a move against, and their
 * separation is the row-state assertions' business), and `highlight` was deleted.
 * Every value carried here is one the walk can assert three ways - hue inside the
 * lattice envelope, within one channel step of the pure-`L*` re-solve, no chroma
 * spent - where the previous table carried only the four grounds and covered 44 of
 * them (review round 2, MAJOR).
 *
 * The pre-values are carried here rather than read from git because a gate that
 * needs history cannot run in CI; they are the same values `origin/main` carries,
 * which is what makes this table checkable by a reviewer with a checkout.
 */
const REGISTER_MOVES = [
	{
		id: "autumn",
		pre: {
			canvas: "#261E1A",
			surface: "#312720",
			elevated: "#362D24",
			sunken: "#1D1815",
			inkMuted: "#CFBAA5",
			inkDim: "#B09F8A",
			hairline: "#48382F",
			borderControl: "#8B7768",
			accentWash: "#292312",
			accentAltWash: "#2B1F2F",
			successBorder: "#757F4D",
			warningBorder: "#97752C",
			dangerBorder: "#B76355",
			infoBorder: "#627E91",
		},
	},
	{
		id: "catppuccinMocha",
		pre: {
			canvas: "#1F1F2F",
			surface: "#262636",
			elevated: "#2B2B3F",
			sunken: "#191926",
			ink: "#CDD6F4",
			inkMuted: "#BAC2DE",
			inkDim: "#9CA3C0",
			hairline: "#363653",
			borderControl: "#727589",
			tokenCommand: "#89B4FA",
			accentWash: "#25253B",
			accentAlt: "#719AD4",
			accentAltWash: "#18283D",
			successBorder: "#498346",
			warningBorder: "#A6663B",
			dangerBorder: "#B75673",
			info: "#89B4FA",
			infoBorder: "#4E76B7",
		},
	},
	{
		id: "desert",
		pre: {
			canvas: "#271E13",
			surface: "#31271A",
			elevated: "#392E20",
			sunken: "#1D160C",
			inkMuted: "#CEBEA9",
			inkDim: "#B0A38A",
			hairline: "#4A3C2A",
			borderControl: "#8E7B63",
			accentWash: "#2F2E18",
			accentAltWash: "#36283B",
			successBorder: "#6C804D",
			warningBorder: "#977632",
			danger: "#F58384",
			dangerBorder: "#BD6865",
			infoBorder: "#617E8B",
		},
	},
	{
		id: "forest",
		pre: {
			canvas: "#18221B",
			surface: "#1F2C23",
			elevated: "#26322A",
			sunken: "#151A17",
			inkMuted: "#B0C4B1",
			inkDim: "#92A795",
			hairline: "#2E4033",
			borderControl: "#69806E",
			accentWash: "#1A2A1A",
			accentAltWash: "#2B2335",
			successBorder: "#55865E",
			warningBorder: "#8E793E",
			dangerBorder: "#AB695D",
			infoBorder: "#55828D",
		},
	},
	{
		id: "lavender",
		pre: {
			canvas: "#211E2B",
			surface: "#292637",
			elevated: "#302B3D",
			sunken: "#191821",
			inkMuted: "#BEB8D1",
			inkDim: "#A49CBB",
			hairline: "#3C3656",
			borderControl: "#7D749E",
			accentWash: "#1F2333",
			accentAltWash: "#2F1E2A",
			successBorder: "#578365",
			warningBorder: "#927543",
			dangerBorder: "#AE6372",
			infoBorder: "#5D7C9E",
		},
	},
	{
		id: "neonNoir",
		pre: {
			canvas: "#1D2025",
			surface: "#25282F",
			elevated: "#2A2E37",
			sunken: "#191B1E",
			inkMuted: "#B7BDCA",
			inkDim: "#98A2B0",
			hairline: "#383E48",
			borderControl: "#727A88",
			accentWash: "#1F2D34",
			accentAltWash: "#2F2932",
			successBorder: "#578271",
			warningBorder: "#887857",
			danger: "#E07A8A",
			dangerBorder: "#9D6C76",
			infoBorder: "#667C96",
		},
	},
	{
		id: "ocean",
		pre: {
			canvas: "#142228",
			surface: "#1A2C37",
			elevated: "#1E323C",
			sunken: "#131A20",
			inkMuted: "#A9C3CA",
			inkDim: "#87A8B1",
			hairline: "#254049",
			borderControl: "#5E818C",
			accentWash: "#12302C",
			accentAltWash: "#2D293A",
			successBorder: "#49876D",
			warningBorder: "#8B7A47",
			dangerBorder: "#AC6967",
			infoBorder: "#5280A0",
		},
	},
	{
		id: "rosePine",
		pre: {
			canvas: "#201e2b",
			surface: "#262436",
			elevated: "#2B283F",
			sunken: "#191822",
			inkMuted: "#c5c2dd",
			inkDim: "#9d99b7",
			hairline: "#363644",
			tokenCommand: "#9ccfd8",
			accentWash: "#2e2430",
			accentAltWash: "#2B2532",
			success: "#5f9bb8",
			successBorder: "#417d99",
			warningBorder: "#8c7241",
			danger: "#eb6f92",
			dangerBorder: "#aa5f73",
			info: "#9ccfd8",
			infoBorder: "#4f8189",
		},
	},
	{
		id: "rosewood",
		pre: {
			canvas: "#2A1C1D",
			surface: "#342526",
			elevated: "#3A2C2D",
			sunken: "#201718",
			inkMuted: "#D1B9B4",
			inkDim: "#B29D98",
			hairline: "#4B3635",
			borderControl: "#8E7571",
			accentWash: "#2B2318",
			accentAltWash: "#27222E",
			successBorder: "#6D805C",
			warningBorder: "#957543",
			dangerBorder: "#B2655D",
			infoBorder: "#657D93",
		},
	},
	{
		id: "tokyoNight",
		pre: {
			canvas: "#1E1F2A",
			surface: "#25293C",
			elevated: "#2A2E48",
			sunken: "#18181F",
			ink: "#C0CAF5",
			inkMuted: "#BBC3E8",
			inkDim: "#9FA6C6",
			hairline: "#3D4462",
			borderControl: "#757EA9",
			accent: "#7AA2F7",
			chartBarHover: "#AAC3FA",
			accentWash: "#2A2F44",
			accentAltWash: "#342C41",
			successBorder: "#6C8754",
			warningBorder: "#967A56",
			danger: "#F7768E",
			dangerBorder: "#B66779",
			infoBorder: "#5684A3",
		},
	},
	{
		id: "vaporwave",
		pre: {
			canvas: "#241B35",
			surface: "#2C2240",
			elevated: "#312749",
			sunken: "#1C152D",
			inkMuted: "#C4B6D8",
			inkDim: "#A89AC5",
			hairline: "#40355D",
			borderControl: "#8070A1",
			accentWash: "#3B2A46",
			accentAltWash: "#2D2E4C",
			successBorder: "#5A7F7B",
			warningBorder: "#897562",
			danger: "#F2808A",
			dangerBorder: "#A26779",
			infoBorder: "#587D91",
		},
	},
];

/**
 * The moved roles whose pure-`L*` re-solve leaves sRGB, so there is no lattice
 * candidate to hold them to. Both are the same palette's, both are the gamut edge
 * the record discloses, and neither is a silent exemption.
 *
 * The keys are `<palette>.<role>` and the walk below visits EVERY role the pass
 * moved, which is what makes them reachable and the set checkable in both
 * directions: a moved value whose re-solve leaves sRGB with no entry here fails the
 * walk, and an entry the walk never consults fails the check after it. That
 * consultation guard is the one this table was missing (review round 2, MAJOR): its
 * two keys were non-ground roles inside a loop that only ever built ground keys, so
 * neither could be looked up and the rule held 44 of the 168 moved values while its
 * comment claimed the whole set.
 */
const MOVED_BEYOND_LIGHTNESS = new Set([
	"tokyoNight.ink", // no in-gamut re-solve: C* 22.95 -> 18.36, as at L* 88.23 this hue sustains C* 18.37
	"tokyoNight.chartBarHover", // no in-gamut re-solve, same cast
	// A SECOND PASS, not a gamut edge: the tool row's state ground re-solved
	// `accentAlt` on the chroma axis, because the pure-L* re-solve exists and is
	// refused by a floor the same role holds (measured below).
	"catppuccinMocha.accentAlt",
]);
/** The entries above that the walk consults; a dead exemption fails the check below. */
const movedBeyondLightnessSeen = new Set();

/** Hue in degrees, in `[0, 360)`, from a Lab triple. */
const hueDeg = ([, a, b]) => {
	const h = (Math.atan2(b, a) * 180) / Math.PI;
	return h < 0 ? h + 360 : h;
};

/** The shortest angular distance between two hues, in degrees. */
const hueDelta = (h1, h2) => {
	const d = Math.abs(h1 - h2);
	return d > 180 ? 360 - d : d;
};

const rgbOf = (hex) =>
	[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb) =>
	`#${rgb.map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("")}`;

/**
 * The largest hue change one 8-bit step can produce at a colour, in degrees.
 *
 * Measured rather than derived: it walks the colour's own 26 representable
 * neighbours (±1 on each channel, in gamut) and takes the widest hue deviation
 * from it. At C* 7 that is ~14 degrees and at C* 25 it is under 2, which is the
 * whole reason the spec's flat 1 degree pin cannot be a pin on an 8-bit palette.
 */
const latticeHueEnvelope = (hex) => {
	const [r, g, b] = rgbOf(hex);
	const here = hueDeg(toLab(hex));
	let widest = 0;
	for (let dr = -1; dr <= 1; dr++) {
		for (let dg = -1; dg <= 1; dg++) {
			for (let db = -1; db <= 1; db++) {
				const c = [r + dr, g + dg, b + db];
				if (c.some((v) => v < 0 || v > 255)) continue;
				widest = Math.max(widest, hueDelta(hueDeg(toLab(hexOf(c))), here));
			}
		}
	}
	return widest;
};

/** The largest per-channel distance between two hex values, in 8-bit units. */
const channelStep = (a, b) => {
	const [ra, ga, ba] = rgbOf(a);
	const [rb, gb, bb] = rgbOf(b);
	return Math.max(Math.abs(ra - rb), Math.abs(ga - gb), Math.abs(ba - bb));
};

/*
 * The fleet itself: every canvas, split by the mode the palette declares, with the
 * Lab triple the three rules below measure against.
 */
const fleetRows = palettes
	.filter(({ palette: p }) => isHex(p.canvas))
	.map(({ id, palette: p }) => {
		const [L, a, b] = toLab(p.canvas);
		return {
			id,
			hex: p.canvas,
			L,
			chroma: Math.hypot(a, b),
			hue: hueDeg([L, a, b]),
		};
	});
const darkFleet = fleetRows.filter((r) => r.L < 50);
const lightFleet = fleetRows.filter((r) => r.L >= 50);

const pairsWithin = (rows, floor) => {
	const out = [];
	for (let i = 0; i < rows.length; i++) {
		for (let j = i + 1; j < rows.length; j++) {
			const d = deltaE(rows[i].hex, rows[j].hex);
			if (d < floor)
				out.push({ a: rows[i].id, b: rows[j].id, hex: rows[i].hex, got: d });
		}
	}
	return out.sort((x, y) => x.got - y.got);
};

/** The largest number of `rows` whose `L*` fits inside one `width`-wide window. */
const widestRegister = (rows, width) => {
	let worst = 0;
	for (const r of rows) {
		const n = rows.filter((q) => q.L >= r.L && q.L <= r.L + width).length;
		if (n > worst) worst = n;
	}
	return worst;
};

const state = {
	darkWindow: widestRegister(darkFleet, FLEET_WINDOW),
	darkDeep: darkFleet.filter((r) => r.L < FLEET_DARK_DEEP_L).length,
	darkSub1: pairsWithin(darkFleet, 1),
	darkIdenticalPairs: pairsWithin(darkFleet, Number.EPSILON),
	darkUpper: darkFleet.filter(
		(r) => r.L >= FLEET_DARK_UPPER_LO && r.L <= FLEET_DARK_UPPER_HI,
	).length,
	darkSpread:
		Math.max(...darkFleet.map((r) => r.L)) -
		Math.min(...darkFleet.map((r) => r.L)),
	lightWindow: widestRegister(lightFleet, FLEET_WINDOW),
	lightHigh: lightFleet.filter((r) => r.L >= FLEET_LIGHT_HIGH_L).length,
	lightSub1: pairsWithin(lightFleet, 1).length,
};

/*
 * The register the fleet's depth lives in. Both of these are the numbers the
 * record quotes in prose (25 -> 14, and 25 -> 14 below L* 13.5) - and they are the
 * two the spec states as a ceiling the pass actually MET, which is why they are
 * the only two here with no ratchet clause.
 */
assertions++;
if (state.darkWindow > FLEET_DARK_WINDOW_CEILING) {
	fail(
		`the fleet: ${state.darkWindow} dark canvases sit inside one ${FLEET_WINDOW} L* window (max ${FLEET_DARK_WINDOW_CEILING}; it was 25 before the identity re-solve) - the fleet has been flattened toward one grey band again, which every per-palette assertion above will still pass`,
	);
}
assertions++;
if (state.darkDeep > FLEET_DARK_DEEP_CEILING) {
	fail(
		`the fleet: ${state.darkDeep} dark canvases are below L* ${FLEET_DARK_DEEP_L} (max ${FLEET_DARK_DEEP_CEILING}, was 25 before the identity re-solve) - the deep register is the one the pass emptied, and refilling it is how the operator's "a lot more grey now" comes back`,
	);
}
assertions++;
if (state.darkSpread < FLEET_DARK_SPREAD_FLOOR) {
	fail(
		`the fleet: the dark canvases span ${r2(state.darkSpread)} L* (floor ${FLEET_DARK_SPREAD_FLOOR}, measured ${r2(state.darkSpread)} this pass against 9.99 before it) - the spread is the fleet's depth, and a per-palette gate cannot see it narrowing`,
	);
}
assertions++;
if (state.darkSub1.length > FLEET_DARK_SUB1_CEILING) {
	fail(
		`the fleet: ${state.darkSub1.length} dark canvas pairs are under ΔE00 1.0 (max ${FLEET_DARK_SUB1_CEILING}, was 7 before the identity re-solve; the spec's target is 0): ${state.darkSub1.map((pair) => `${pair.a}/${pair.b} ${r2(pair.got)}`).join(", ")} - two themes whose page grounds are the same colour read as one theme with a different accent`,
	);
}
assertions++;
if (state.darkIdenticalPairs.length > FLEET_DARK_IDENTICAL_CEILING) {
	fail(
		`the fleet: ${state.darkIdenticalPairs.length} dark canvas pairs are BYTE-IDENTICAL (max ${FLEET_DARK_IDENTICAL_CEILING}, was 3 before the identity re-solve; the spec's target is 0): ${state.darkIdenticalPairs.map((pair) => `${pair.a}/${pair.b} ${pair.hex}`).join(", ")} - a palette that ships another palette's exact canvas has no depth of its own`,
	);
}
assertions++;
if (state.darkUpper < FLEET_DARK_UPPER_FLOOR) {
	fail(
		`the fleet: ${state.darkUpper} dark canvases sit in the L* ${FLEET_DARK_UPPER_LO}-${FLEET_DARK_UPPER_HI} register (floor ${FLEET_DARK_UPPER_FLOOR}, the spec's target is 5) - this is the register the near-neutral palettes' identity is carried by, and losing recruits to it is the same flattening seen from the other end`,
	);
}

/*
 * The light mirror, and it is not exempt (D14). The ceiling at L* 94 clamped the
 * light family and left it compressed against a wall, which is the dark fleet's
 * problem at the other end of the ramp.
 */
assertions++;
if (state.lightWindow > FLEET_LIGHT_WINDOW_CEILING) {
	fail(
		`the fleet: ${state.lightWindow} light canvases sit inside one ${FLEET_WINDOW} L* window (max ${FLEET_LIGHT_WINDOW_CEILING}; the spec's ceiling is 8) - the light family is compressed against the L* 94 wall and has to be counted as carefully as the dark one`,
	);
}
assertions++;
if (state.lightHigh > FLEET_LIGHT_HIGH_CEILING) {
	fail(
		`the fleet: ${state.lightHigh} light canvases sit at L* ${FLEET_LIGHT_HIGH_L} or above (max ${FLEET_LIGHT_HIGH_CEILING}; the spec's ceiling is 9) - the ceiling is what squeezed them here, so this is the number to watch before moving it`,
	);
}
assertions++;
if (state.lightSub1 > FLEET_LIGHT_SUB1_CEILING) {
	fail(
		`the fleet: ${state.lightSub1} light canvas pairs are under ΔE00 1.0 (max ${FLEET_LIGHT_SUB1_CEILING}; the spec's target is 0) - the dark rule's mirror, and it has the same failure mode one register up`,
	);
}

/*
 * The near-neutral ladder, as a RATCHET rather than a floor. A canvas with no cast
 * is told apart by depth only, and this fleet ships FOUR near-neutrals in one 0.00-
 * 1.53 L* knot: `arcade` and `obsidian` are the same hex (#202021, 0.00 L* apart)
 * and `dune` (#21201E) is 0.0013 L* off both, against the register's 2.5 L* target.
 *
 * A floor could never state that - the minimum gap is 0.00 by construction, so the
 * branch was unreachable and the run still counted it as an assertion (review round
 * 2, F2) - so the population is carried instead, the way this file's identical-pair
 * rule carries its ceiling: the three colliding pairs are tolerated, a fourth fails,
 * and every pair it counts is named in the message rather than summarised.
 */
const neutrals = fleetRows.filter((r) => r.chroma < FLEET_NEAR_NEUTRAL_CHROMA);
const neutralPairs = [];
for (let i = 0; i < neutrals.length; i++) {
	for (let j = i + 1; j < neutrals.length; j++) {
		const gap = Math.abs(neutrals[i].L - neutrals[j].L);
		if (gap < FLEET_NEAR_NEUTRAL_TARGET)
			neutralPairs.push(
				`${neutrals[i].id}/${neutrals[j].id} ${gap.toFixed(3)}`,
			);
	}
}
assertions++;
if (neutralPairs.length > FLEET_NEAR_NEUTRAL_PAIRS_CEILING) {
	fail(
		`the fleet: ${neutralPairs.length} near-neutral canvas pair(s) (C* < ${FLEET_NEAR_NEUTRAL_CHROMA}) sit closer than the register's ${FLEET_NEAR_NEUTRAL_TARGET} L* target (max ${FLEET_NEAR_NEUTRAL_PAIRS_CEILING}): ${neutralPairs.join(", ")} - a near-neutral canvas has no cast to be recognised by, so depth is the whole of its identity, and a new collision in this register is a palette that reads as another`,
	);
}

/*
 * R3 - the lift is monotone in lightness and pure in cast - per mover and per
 * ground. Three clauses, and the middle one is the measure described above.
 */
let hueOverPinByLattice = 0;
let movedValuesSeen = 0;
for (const move of REGISTER_MOVES) {
	const palette = palettes.find(({ id }) => id === move.id);
	assertions++;
	if (!palette) {
		fail(
			`the fleet: \`${move.id}\` is in \`REGISTER_MOVES\` and no longer exists - a move that cannot be checked is worse than one that fails`,
		);
		continue;
	}
	/*
	 * Every role value this palette's re-solve moved, at its pre value - not the four
	 * grounds: the rule is about the MOVE, and 124 of the 168 values are not grounds
	 * (review round 2, MAJOR). Each entry also has to still describe a move, because
	 * the population is what the fleet line reports; an entry whose role has left the
	 * palette, or whose value is back where it started, fails rather than being
	 * skipped past.
	 */
	for (const [name, pre] of Object.entries(move.pre)) {
		const post = palette.palette[name];
		const role = `${move.id}.${name}`;
		assertions++;
		movedValuesSeen++;
		if (!isHex(pre)) {
			fail(
				`the fleet: \`${role}\`'s pre value ${pre} in \`REGISTER_MOVES\` is not an 8-bit colour - the table has to carry the hex the palette shipped before the move`,
			);
			continue;
		}
		if (!isHex(post)) {
			fail(
				`the fleet: \`${role}\` is in \`REGISTER_MOVES\`' pre-values and has no colour value on the palette (\`${post}\`) - the move this entry records no longer exists, so neither does the value it holds`,
			);
			continue;
		}
		if (post.toLowerCase() === pre.toLowerCase()) {
			fail(
				`the fleet: \`${role}\` is in \`REGISTER_MOVES\` at ${pre} and the palette still ships ${post} - the move did not happen, so the entry is dead weight and the rule's population overstates what it holds; delete it`,
			);
			continue;
		}
		const [, preA, preB] = toLab(pre);
		const [postL] = toLab(post);
		const preChroma = Math.hypot(preA, preB);
		const postChroma = Math.hypot(...toLab(post).slice(1));
		const gotHue = hueDelta(hueDeg(toLab(pre)), hueDeg(toLab(post)));
		const envelope = latticeHueEnvelope(pre);
		const reSolved = labToHex([postL, preA, preB]);

		/* The spec's pin, as an OR: one degree, or the envelope one step allows. */
		const pin = Math.max(HUE_PIN_DEGREES, envelope);
		assertions++;
		if (gotHue > pin) {
			fail(
				`the fleet: \`${role}\` ${pre} -> ${post} moves ${r2(gotHue)} degrees of hue (the pin is ${HUE_PIN_DEGREES} degree OR ${r2(envelope)}, the widest one 8-bit step can produce at this colour) - the lift may move lightness only, and rotating further than the lattice allows is a different colour rather than a lighter one`,
			);
		}
		if (gotHue > HUE_PIN_DEGREES) hueOverPinByLattice++;

		/*
		 * And the clause that actually decides: the shipped value must be the 8-bit
		 * round of the pure-L* move, plus at most one step of authoring room. A value
		 * that drifted further than that moved `a` or `b`, whatever its hue says.
		 */
		if (!reSolved) {
			assertions++;
			if (!MOVED_BEYOND_LIGHTNESS.has(role)) {
				fail(
					`the fleet: \`${role}\` ${post} has no in-gamut pure-L* re-solve at L* ${r2(postL)} on ${pre}'s cast, and it is not named in \`MOVED_BEYOND_LIGHTNESS\` - name it with its reason or re-author the value`,
				);
			} else {
				movedBeyondLightnessSeen.add(role);
			}
			continue;
		}
		const step = channelStep(post, reSolved);
		assertions++;
		/*
		 * The table is consulted HERE as well as in the no-re-solve branch above,
		 * because "the move is not a single pure-L* re-solve" has two causes and the
		 * walk can only see the second one by measurement: the re-solve may not EXIST
		 * in sRGB (`tokyoNight`), or it may exist and be REFUSED by another floor the
		 * role holds (`catppuccinMocha.accentAlt`, whose pure-`L*` lift toward the
		 * tool row's state ground drops it below the ΔE00 8 it holds against `info`,
		 * so the second pass spent chroma instead). Both are decisions with a reason,
		 * and the floors are asserted either way - what the entry buys is that the
		 * reason is written down rather than the clause being loosened.
		 */
		if (step > MOVED_CHANNEL_STEP_TOLERANCE) {
			if (MOVED_BEYOND_LIGHTNESS.has(role)) {
				movedBeyondLightnessSeen.add(role);
			} else {
				fail(
					`the fleet: \`${role}\` ${pre} -> ${post} sits ${step} 8-bit channel step(s) from its pure-L* re-solve ${reSolved} (max ${MOVED_CHANNEL_STEP_TOLERANCE}) - the role's own file says only lightness moved, so a value past one step has been re-authored in hue or chroma as well`,
				);
			}
		}

		/* Chroma may be scaled by quantisation, but it may not be spent. */
		assertions++;
		if (postChroma < MOVED_CHROMA_FLOOR * preChroma) {
			fail(
				`the fleet: \`${role}\` ${pre} -> ${post} gives up chroma (C* ${r2(preChroma)} -> ${r2(postChroma)}, floor ${MOVED_CHROMA_FLOOR} x) - a lift that neutralises a palette to satisfy a floor is a different theme, not a lighter one`,
			);
		}
	}
}

/*
 * The exemption table's own consultation guard, on the same rule `EXCEPTIONS` and
 * `CONTROL_EDGE_PINNED` are held to: an entry the walk never reached is describing
 * a re-solve that is back inside sRGB, or a role that is no longer a moved value,
 * and either way it is coverage the run cannot claim (review round 2, MAJOR).
 */
const staleBeyondLightness = [...MOVED_BEYOND_LIGHTNESS].filter(
	(r) => !movedBeyondLightnessSeen.has(r),
);
if (staleBeyondLightness.length > 0) {
	fail(
		`the fleet: \`MOVED_BEYOND_LIGHTNESS\` names ${staleBeyondLightness.join(", ")} and the walk never consulted ${staleBeyondLightness.length === 1 ? "it" : "them"} - the pure-L* re-solve is back inside sRGB, or the role is no longer a moved value; delete the entry rather than carrying an exemption nothing needs`,
	);
}

/*
 * And the population the walk above claims to hold. "0 outside the envelope over
 * the whole move set" is a claim about a population, so the population itself is
 * asserted rather than assumed: a table that has quietly lost a value is a rule
 * covering less than the fleet line says it covers.
 */
assertions++;
if (movedValuesSeen !== MOVED_VALUE_COUNT) {
	fail(
		`the fleet: the re-solve rule walked ${movedValuesSeen} moved value(s) and the move set it is written against is ${MOVED_VALUE_COUNT} - the table and the claim have parted`,
	);
}

/*
 * THE ROW-STATE LEDGER, read from outside the per-palette loop.
 *
 * The two tables above it are claims about the fleet - that these palettes, and
 * only these, cannot hold these bounds - and a claim nobody re-reads is how the
 * previous round's thirteen pins grew: each one was true when it was filed and
 * three of them were still being carried after the value that needed them had
 * moved. So every row has to be CLAIMED by the assertion it excuses, and a row
 * that is not is the failure here. The assertion count is the fleet's, not a
 * palette's, because that is the population the tables cover.
 */
for (const row of ROW_STATE_FLOOR_UNREACHABLE) {
	assertions++;
	if (!pinClaims.has(`${row.id}:${row.role}:floor`)) {
		fail(
			`the fleet: the floor row for \`${row.id}\`'s \`${row.role}\` is stale — the cast floor is no longer above the ceiling there, so the row is excusing a bound the palette now holds. Re-author the value to the floor, or delete the row (${row.reason})`,
		);
	}
}
for (const row of ROW_STATE_MEASURED_SHORTFALL) {
	assertions++;
	if (!pinClaims.has(`${row.id}:${row.role}:${row.bound}`)) {
		fail(
			`the fleet: the ${row.bound} row for \`${row.id}\`'s \`${row.role}\` is stale — it records ${row.measured} and the palette no longer misses that bound (${row.reason})`,
		);
	}
}

/* ---- 6. report ---------------------------------------------------------- */

for (const line of log) console.log(line);

const themeCount = palettes.length;
if (failures > 0) {
	console.error(
		`\nContrast contract FAILED: ${failures} violation(s) over ${assertions} assertions across ${themeCount} themes.`,
	);
	process.exit(1);
}

/*
 * The call-site half of the contract. Runs after the palette assertions so a
 * palette regression is still reported first, but before the success line, so
 * "the contract holds" covers both halves rather than only the one this
 * script can see in a colour table.
 */
let callSiteFailures = 0;
for (const site of STRUCTURAL_CALL_SITES) {
	const source = readFileSync(join(ROOT, site.file), "utf8");
	assertions += 1;
	if (!source.includes(site.must)) {
		callSiteFailures += 1;
		console.error(
			`FAIL  ${site.what}: ${site.file} no longer contains \`${site.must}\`\n      ${site.why}`,
		);
	}
}
if (callSiteFailures > 0) {
	console.error(
		`\nContrast contract FAILED: ${callSiteFailures} structural boundary/boundaries no longer declare a floored role at their call site.`,
	);
	process.exit(1);
}

/* A pin for a palette that is gone is the same dead weight. */
const staleInk = INK_STEP_PINNED.filter((e) => !inkStepSeen.has(e.theme));
if (staleInk.length > 0) {
	console.error(
		`\nContrast contract FAILED: ${staleInk.length} pinned ink step(s) reference themes that no longer exist (${staleInk.map((e) => e.theme).join(", ")}).`,
	);
	process.exit(1);
}

/*
 * A pin whose palette has been lifted out of the floor is dead weight too, and the
 * one that matters most: it would keep a fixed defect looking measured forever. This
 * is the same rule `INK_STEP_PINNED` follows, asked of the edge pins.
 */
const staleControlEdge = CONTROL_EDGE_PINNED.filter(
	(e) => !controlEdgeSeen.has(controlEdgeKey(e.control, e.ground, e.theme)),
);
if (staleControlEdge.length > 0) {
	console.error(
		`\nContrast contract FAILED: ${staleControlEdge.length} pinned control edge(s) no longer under the floor (${staleControlEdge.map((e) => controlEdgeKey(e.control, e.ground, e.theme)).join(", ")}) - delete the pin, the palette clears it now.`,
	);
	process.exit(1);
}

/* An unpinned exception is dead weight that hides a fixed defect. */
const stale = EXCEPTIONS.filter(
	(e) => !palettes.some(({ id }) => id === e.theme),
);
if (stale.length > 0) {
	console.error(
		`\nContrast contract FAILED: ${stale.length} exception(s) reference themes that no longer exist.`,
	);
	process.exit(1);
}

/*
 * And the check this table was missing, which is the one that would have caught
 * the row this pass deleted: a pin whose pair has been FIXED is never consulted,
 * because `assertPair` returns the moment the raw ratio clears the floor. Asking
 * whether the theme still exists cannot see that - the theme does exist, and the
 * row's recorded ratio simply stopped being the one the palette measures.
 *
 * So the question is whether the entry was ever ASKED ABOUT. It is not, the
 * palette clears its floor on its own and the pin is a claim about a defect that
 * no longer exists: delete it rather than refreshing its `got`, because a
 * refreshed `got` on a pair that passes is a pin that can never fire again.
 */
const staleConsulted = EXCEPTIONS.filter((e) => !exceptionSeen.has(e));
if (staleConsulted.length > 0) {
	console.error(
		`\nContrast contract FAILED: ${staleConsulted.length} exception(s) were never consulted (${staleConsulted.map((e) => `${e.theme} ${e.fg}/${e.bg} recorded ${e.got}`).join(", ")}) - the pair clears its floor now; delete the pin.`,
	);
	process.exit(1);
}

/*
 * And a ΔE00 exception that stopped firing is the same dead weight from the other
 * side: it means the pair now clears its floor and the pin is describing a defect
 * that is gone, or that the row it was written for no longer measures this pair
 * at all.
 */
const stalePerceptible = PERCEPTIBLE_EXCEPTIONS.filter(
	(e) => !perceptibleSeen.has(e),
);
if (stalePerceptible.length > 0) {
	console.error(
		`\nContrast contract FAILED: ${stalePerceptible.length} ΔE00 exception(s) were not needed (${stalePerceptible.map((e) => `${e.theme} ${e.role}/${e.ground}`).join(", ")}).`,
	);
	process.exit(1);
}

/*
 * The same guard for the identity pairs: a pin the walk never asked about is a
 * pair that clears its floor on its own now, and leaving it would keep a hole in
 * the table that the next reader would read as a live defect.
 */
const stalePairPins = PAIR_PINS.filter((e) => !pairPinSeen.has(e));
if (stalePairPins.length > 0) {
	console.error(
		`\nContrast contract FAILED: ${stalePairPins.length} identity-pair pin(s) were not needed (${stalePairPins.map((e) => `${e.theme} ${e.a}/${e.b}`).join(", ")}) - the pair clears its floor now; delete the pin.`,
	);
	process.exit(1);
}

if (
	IDENTITY_PAIR_FLOOR !== SEPARATION_FLOOR ||
	LIVENESS_PAIR_FLOOR !== SYNTAX_COMMENT_FLOOR
) {
	fail(
		`the fleet: the pair floors are declared beside \`PAIR_PINS\` (\`IDENTITY_PAIR_FLOOR\` ${IDENTITY_PAIR_FLOOR}, \`LIVENESS_PAIR_FLOOR\` ${LIVENESS_PAIR_FLOOR}) and have to equal \`SEPARATION_FLOOR\` ${SEPARATION_FLOOR} and \`SYNTAX_COMMENT_FLOOR\` ${SYNTAX_COMMENT_FLOOR}; raise them together, or the pins stop describing the bound they were granted under`,
	);
}

/*
 * AND THE NUMBER THE PROSE QUOTES, computed here rather than typed there.
 *
 * The figure that ran in three places and disagreed in three ways is this one:
 * the `accentAlt`/`info` separation the tool row's two identity inks live with.
 * The README's 8.19, the contract's 8.01 and a reviewer's independent 8.70 were
 * three instruments' answers to one question, and nothing in the run could tell
 * which one the fleet actually holds. So the number is not restated in prose any
 * more: this line IS the figure, printed from the same `deltaE` the assertion
 * above uses, and the two documents that quote it quote this line.
 *
 * The count is asserted against `PAIR_PINS` in the same breath, because a table
 * of pins is a CLAIM about the fleet: if a palette drifts under the floor with no
 * pin, or a pin survives a palette that no longer needs it, the two numbers stop
 * agreeing and the run says so rather than printing a figure nobody checks.
 */
const altInfoPairs = palettes
	.filter(({ palette }) => isHex(palette.accentAlt) && isHex(palette.info))
	.map(({ id, palette }) => ({
		id,
		d: r2(deltaE(palette.accentAlt, palette.info)),
	}))
	.sort((a, b) => a.d - b.d);
const identityFloorPins = PAIR_PINS.filter(
	(e) => e.floor === IDENTITY_PAIR_FLOOR,
);
const belowIdentityFloor = altInfoPairs.filter(
	(e) => e.d < IDENTITY_PAIR_FLOOR,
);
if (belowIdentityFloor.length !== identityFloorPins.length) {
	fail(
		`the fleet: ${belowIdentityFloor.length} palette(s) sit under the ${IDENTITY_PAIR_FLOOR} identity floor (${belowIdentityFloor.map((e) => `${e.id} ${e.d}`).join(", ") || "none"}) while \`PAIR_PINS\` records ${identityFloorPins.length} - the pinned set and the measured set are the same claim and have to agree`,
	);
}
const infoAccentPairs = palettes
	.filter(({ palette }) => isHex(palette.info) && isHex(palette.accent))
	.map(({ id, palette }) => ({
		id,
		d: r2(deltaE(palette.info, palette.accent)),
	}))
	.sort((a, b) => a.d - b.d);
console.log(
	`Identity pairs: tightest \`accentAlt\`/\`info\` (the tool row's two identity inks, floor ${IDENTITY_PAIR_FLOOR}) is ${altInfoPairs[0].d} in ${altInfoPairs[0].id}, then ${altInfoPairs
		.slice(1, 5)
		.map((e) => `${e.id} ${e.d}`)
		.join(
			", ",
		)}; ${identityFloorPins.length} palette(s) pinned below it. Tightest \`info\`/\`accent\` (settled read ink vs liveness ink, floor ${LIVENESS_PAIR_FLOOR}) is ${infoAccentPairs[0].d} in ${infoAccentPairs[0].id}, then ${infoAccentPairs
		.slice(1, 5)
		.map((e) => `${e.id} ${e.d}`)
		.join(", ")}.`,
);

console.log(
	`Contrast contract holds: ${assertions} assertions across ${themeCount} themes, ${exceptionSeen.size} consulted exception(s), ${perceptibleSeen.size} ΔE00 exception(s) consulted, ${inkStepPinSeen.size} pinned ink step(s), ${controlEdgeSeen.size} pinned control edge(s), ${pairPinSeen.size} pinned identity pair(s).`,
);
/*
 * And the FLEET's own line, because these are the numbers that ran in prose and a
 * prose number cannot go red. `over the 1 degree pin` is reported rather than
 * hidden: it is the measure the hue assertion actually uses (one 8-bit channel
 * step at the shipped chroma), and a reader who sees it move knows which clause
 * moved.
 */
console.log(
	`Fleet: ${state.darkWindow} dark canvas(es) in a ${FLEET_WINDOW} L* window (max ${FLEET_DARK_WINDOW_CEILING}), ${state.darkDeep} below L* ${FLEET_DARK_DEEP_L}, spread ${r2(state.darkSpread)} L*; ${state.darkSub1.length} sub-1.0 and ${state.darkIdenticalPairs.length} identical dark canvas pair(s); light ${state.lightWindow} in a ${FLEET_WINDOW} L* window, ${state.lightHigh} at or above L* ${FLEET_LIGHT_HIGH_L}, ${state.lightSub1} sub-1.0 pair(s); ${hueOverPinByLattice} moved value(s) over the ${HUE_PIN_DEGREES} degree hue pin and inside the 8-bit envelope.`,
);
