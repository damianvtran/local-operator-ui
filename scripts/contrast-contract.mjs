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
 * The six grounds an ink can sit on.
 *
 * `GROUNDS` above is the ELEVATION LADDER - four alternative grounds of one
 * panel, which is what every control's own row is measured against. This one
 * adds the two grounds that carry text as a STATE rather than as a surface:
 * `accentWash` (the selection/hover tint, callouts, chips, find-match) and
 * `highlight` (the sidebar's and the settings rail's current row). Both are
already in `REQUIRED_ROLES`; neither was in the ink loop, which is how a
keycap on a selected row and a reading button on a hover could fail with every
assertion in this file green. Measured at the old scope, the sharpest failures
in the whole tree lived here: `inkDim` was under 5.0:1 on `accentWash` in 17
dark and 11 light palettes, and on `highlight` in 36 dark and 14 light.
 */
const GROUNDS6 = [
	"canvas",
	"surface",
	"elevated",
	"sunken",
	"accentWash",
	"highlight",
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
	surfaceElevated: [2.5, 6.0],
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
		 * THE SAME BADGE, ON A CONVERSATION ROW (design R2; review round 1, D3).
		 *
		 * The row above says the quiet part out loud: when a badge lands on another
		 * ground, "its ground is a row this file would have to grow rather than quietly
		 * inherit". PR 2 put an identical `Badge variant="attention"` on the sidebar's
		 * conversation rows — the mark's approvals badge, which is the one state that
		 * means "an agent here is blocked on you" — and no row covered it, so the twelve
		 * palettes were asserting the badge against `canvas` alone.
		 *
		 * FOUR GROUNDS, because this control is drawn on all four:
		 *   - `surface`, the sidebar panel: the mark at rest;
		 *   - `elevated`, the row's hover step, which a ROW that is not current paints
		 *     under the pointer;
		 *   - `highlight`, the CURRENT row's ground (`chat-sidebar.tsx`'s `rowCurrent`,
		 *     this app's role for it) - and the ground the `browser-conversation-mark`
		 *     row specimen paints since design round 3's D17 moved it off the retired
		 *     `sunken`, so the frames reviewers judge cover the state that ships;
		 *   - `sunken`, kept in this list rather than dropped with the specimen that
		 *     used to paint it: a palette step can put this control back on a recessed
		 *     ground, and a ground dropped in the same commit that moves a specimen is a
		 *     silent shrink of this row's asserted set - the coverage gap this entry
		 *     exists to close, one turn of the same screw. Dropping it is a deliberate
		 *     decision for whoever takes the next palette pass, not a side effect of a
		 *     story edit.
		 * Measured across the twelve palettes when this row was added: `ink` on
		 * `warningWash` 8.39:1 at worst (tokyoNight) and `borderControl` on the ground
		 * 3.13:1 at worst (iceberg on `sunken`) — a coverage gap rather than a violation
		 * (the badge's own `ring-canvas`, added the same round for D4, is a `canvas` ring
		 * on these grounds and is not part of this triple).
		 */
		name: "conversation browser mark badge",
		on: ["surface", "elevated", "highlight", "sunken"],
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
		 * this round: ΔE00 5.85 at worst (iceberg), so the floor is 5.0 and the worst
		 * palette clears it by 0.85. The weight-parity half compares the hovered fill
		 * with the resting one, whose role IS the ground (`sunken`): the step is
		 * 1.20-1.55x either way, so `maxWeightChange` 2.0 states that hover is a step
		 * in one ramp rather than a different control.
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
		 * >= 2 L* step from `elevated`, measured 5.85-16.70 across all 59); this pin
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
		 * WHY `highlight` AND NOT A PALETTE ROW FOR THE WASH. `accent-wash` is not
		 * invisible everywhere: the app rail paints it on `sunken`, where it
		 * measures 9.6 in tokyoNight, and the settings rail is the OTHER `surface`
		 * panel and is fixed with this one (the pin below). Strengthening the role
		 * would make every hover tint in the app louder to fix the two panels that
		 * draw it on `surface`. A role of their own was the alternative, and it is
		 * what shipped: `highlight`, a step off `surface` in the direction the mode
		 * runs, asserted against `surface` at its own band floor and against `elevated`
		 * and `sunken` at the field floor in the loop above.
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
		 * Reverting this line to a wash, or to `sunken`, fails here and nowhere
		 * else in THIS file (`scripts/chat-sidebar-selection.test.mjs` catches it
		 * too, by resolving the row's own class expression through the shipped
		 * `cn`); a palette edit that collapsed `highlight` onto `surface`,
		 * `elevated` or `sunken` fails the `highlight` loop above.
		 *
		 * AND WHY `font-medium` IS IN THIS PIN, NOT JUST THE ROLE. The rows around a
		 * current one carry `hover:bg-elevated`, which on eight of the twelve palettes
		 * is still the LARGER step off `surface` than the row's own mark — and that is
		 * a bound no palette value can lift, since `elevated` is also every menu,
		 * popover and tooltip ground in the app. The weight is the non-colour step
		 * against the pointer's mark, and it is the whole of that second step: the 1px
		 * `outline-control` boundary an earlier round put beside the ground is RETIRED
		 * (it is § 2's *sole boundary of a control* and rendered as the search field
		 * above the list — design round 1, D3), so the pin below is what holds this
		 * half of the mark now. The operator's second report on this row — having
		 * asked first for a SUBTLE selection and then seen the rendered result — is
		 * why the ground itself rose from the 2.18-2.28 band to the 4.0-4.4 one, on
		 * the lightness axis rather than the chroma one.
		 *
		 * The `hover:` half is part of the ground, not decoration: `rowStyle`
		 * carries `hover:bg-elevated`, and the hover variant outranks a bare
		 * background in the cascade, so without it the pointer REPLACED the
		 * selection ground on the row the user is on — in obsidian those two
		 * grounds are ΔE00 0.77 apart, so hovering the current row erased it.
		 * The class is one shared constant for all four current-row states in
		 * this panel (the selected conversation, the All chats filter, the New
		 * chat row and the entity row staging a draft), so pinning the
		 * declaration is what holds all four. It is EXPORTED since round 5
		 * (design D22, agent A-7) and the settings rail and the mark's story
		 * specimen import it rather than restating it, which is why the pin is
		 * here and the rail's own entry below names the symbol. The pinned text
		 * carries the formatter's line break as well as the four terms, on
		 * purpose: a term REMOVED is a term that fits back on one line, so the
		 * pin fails on either direction of change, which is the whole point of
		 * it - a term change has to fail this file until the palette half is
		 * re-measured.
		 */
		what: "chat sidebar current-row ground",
		file: "src/renderer/src/features/chat/components/chat-sidebar.tsx",
		must: 'export const rowCurrent =\n\t"bg-highlight font-medium text-ink hover:bg-highlight";',
		why: "the panel's ground is `surface`, where a wash selection is invisible in tokyoNight (ΔE00 1.05) and `sunken` is a 3.75-14.94 recessed box; `highlight` is the role authored for the current row, `font-medium` is one non-colour step against the pointer's mark, and a bare background loses to `rowStyle`'s hover step on the row the user is already on; no palette assertion can see a class, so this is the only place in this file that can catch the wrong ground or a lost second signal arriving",
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
const EXCEPTIONS = [];

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
		got: 1.44,
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
const inkStepSeen = new Set();

/*
 * A CONTROL's edge on the SELECTION ground, three palettes that cannot reach 3:1
 * there.
 *
 * The attention badge this branch's conversation mark draws is a SHARED control
 * (`Badge variant="attention"`), and its sole boundary is `borderControl` against
 * whatever ground it is painted on. On `highlight` - the row a reader is currently
 * on, which is a real state for the mark, since the mark is drawn on every
 * conversation's row including the current one - `borderControl` measures 2.81 to
 * 2.91:1 in these three palettes and the badge's `warningWash` fill measures 1.09
 * to 1.59:1, so neither edge reaches the floor. WHAT THAT IS AND IS NOT, at the
 * precision it was measured at: the edge is PAINTED and faint rather than absent - it is
 * 0.09 to 0.19 under the floor, which is the SMALLEST of the three falls this badge's
 * surfaces take there (the fill and `ring-canvas` fall 1.4 to 1.9 under it: `ring-canvas`
 * measures 1.27 cat, 1.38 duskfox, 1.39 gruvbox) - so the edge is the TALLEST of the
 * three surfaces the badge paints there and is still under the floor, and no surface of
 * the badge clears the contract's number.
 *
 * THIS PIN IS THE MINIMUM THE PALETTE SET ALLOWS, and that is a measurement rather
 * than a preference (design round 3, D18). The obvious local fix - the badge's own
 * semantic border, `warningBorder`, in place of `borderControl` - MISSES 3:1 on
 * `highlight` in 12 of 59 palettes against 3 of 59 for `borderControl` (miss counts both,
 * so the swap clears in 47 of 59 where the pin clears in 56; worst `warningBorder` 2.69 in
 * `dracula` and `monokai`), so the swap would pin MORE palettes rather than fewer. Re-derived on the tree this comment ships in, with
 * the palettes read through `scripts/palette-source.mjs`, so the pair is a
 * measurement of the registry rather than a remembered number.
 *
 * PINNED RATHER THAN FIXED, deliberately, and for the reason the `danger` pairs
 * above are pinned: both available fixes are app-wide visual changes owned by the
 * palettes' own design review rather than by a rebase. Lifting `borderControl`
 * moves every control's edge in the palette, and re-authoring `highlight` moves
 * the whole selection band that `main` re-authored in #281 - and either one would
 * invalidate the `HIGHLIGHT_STEP_PINS` and `HIGHLIGHT_WASH_PINS` above, which are
 * measurements of those same two roles. What this list records meanwhile is the
 * defect, at the precision it was measured at: a pin must still measure what it
 * says, and a palette re-authored out of the floor FAILS until its pin is deleted,
 * so the list cannot outlive the defect it records.
 *
 * KEYED BY THE CONTROL AND THE GROUND IT WAS MEASURED ON, not by the theme alone
 * (review round 3, A-2). A `(theme, got)` key could excuse a DIFFERENT control's
 * sub-floor edge that happened to land within 0.01 of the pinned ratio - the gate
 * would stay green, the stale check would be satisfied, and the summary would still
 * report the pin as used with no way to tell which row it excused. `EXCEPTIONS` is
 * keyed `(theme, fg, bg)` for the same reason. `control` is the control's own
 * `name`, which is the identity `CONTROLS` carries; a pin that names a control or
 * ground nothing measures fails the stale check below rather than passing quietly.
 *
 * @type {{control: string, ground: string, theme: string, got: number}[]}
 */
const CONTROL_EDGE_PINNED = [
	{
		control: "conversation browser mark badge",
		ground: "highlight",
		theme: "catppuccinMocha",
		got: 2.85,
	},
	{
		control: "conversation browser mark badge",
		ground: "highlight",
		theme: "duskfox",
		got: 2.91,
	},
	{
		control: "conversation browser mark badge",
		ground: "highlight",
		theme: "gruvbox",
		got: 2.81,
	},
];
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

const findException = (theme, fg, bg, got) =>
	EXCEPTIONS.find(
		(e) =>
			e.theme === theme &&
			e.fg === fg &&
			e.bg === bg &&
			Math.abs(e.got - got) < 0.01,
	);

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

const REQUIRED_ROLES = [
	"mode",
	...GROUNDS,
	/* The selection ground, and not a fifth STEP on the elevation ladder: it is
	   the ground of the row a reader is currently ON, a step off `surface` in the
	   direction the mode runs — bought on the LIGHTNESS axis first, at the panel's
	   own hue, with chroma paying only what is left over. Required rather than
	   optional for the same reason every other role here is: a palette that omits
	   it falls silently through to MUI's stock palette, and this one is read by a
	   Tailwind utility (`bg-highlight`) that would then resolve to nothing at
	   all. */
	"highlight",
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
 * The current row's mark is a THIRD floor, and it is deliberately not
 * `FIELD_SEPARATION_FLOOR`.
 *
 * That constant gates two different jobs and they need different numbers: the
 * `highlight`-vs-`elevated` / `-vs-`sunken` assertions are "this ground is not
 * that ground" (a state-distinction at the field threshold), while the
 * `highlight`-vs-`surface` assertion is "the reader can see the mark at all".
 * Raising the shared constant for the second job would turn most palettes red
 * for the first one - several authored canvas/surface pairs sit near 2.0 - and
 * the two failures would be indistinguishable in the output.
 *
 * 4.0 is the operator's own report measured. The role was authored at ΔE00
 * 2.18-2.28, which cleared this file's 2.0 floor and every ink floor and still
 * read as no mark at all beside a hovered neighbour, so the observed threshold
 * for a selection - a large plane the reader has to find while the pointer is
 * somewhere else - is higher than for an elevation step they are comparing with
 * itself. It is where the fifty-nine now land (4.00-4.85), and it is the
 * number a porting author targets: see `HIGHLIGHT_INK_MARGIN` below and
 * `palette-contract.ts`'s `highlight` doc, which states the derivation rule in
 * full.
 *
 * The margin is the other half and is why the floor is stated with one: the
 * binding ink on this ground is `ink-dim` (the caps and the `· lopdev` binding
 * inside a current row are drawn in it), and a palette that lands exactly on
 * 4.50:1 has spent its last 0.01 of headroom on the mark.
 *
 * `HIGHLIGHT_LIGHTNESS_STEP_FLOOR` beside it is the OTHER half of the same
 * report, because ΔE00 is a budget that can be spent on the wrong axis. The
 * three palettes this floor was drawn for - tokyoNight, `localOperatorDark`,
 * `localOperatorLight` - cleared 4.0 with the whole of the gain bought on
 * chroma, at `L*` steps of 2.61, 2.82 and 2.52 in a band of ΔE00 4.0-4.4: less
 * light (on the dark themes) than the 3.26-3.47 steps he had ALREADY reported
 * as invisible, which is why the same report was answered twice. The floor is
 * stated as a magnitude and the direction is checked beside it, so a dark
 * palette can no longer land darker than its panel and a light one lighter.
 *
 * WHERE 3.0 COMES FROM, since it is not inherited from a neighbouring constant:
 * the chroma-only values above measured 2.52-2.82, and the corrected twelve land
 * 3.81-6.62 - the floor sits between the worst of the defect and the worst of
 * the fix, with the same order of margin `FIELD_SEPARATION_FLOOR` has. It is a
 * FLOOR and not a target: the derivation rule asks for the largest `L*` step the
 * ink floors allow, and the palettes that can afford more (dune 6.44, sage
 * 6.62) take it.
 */
const HIGHLIGHT_SEPARATION_FLOOR = 4.0;
const HIGHLIGHT_LIGHTNESS_STEP_FLOOR = 3.0;
const HIGHLIGHT_INK_MARGIN = 0.15;

/* Lab chroma, hue angle and the unsigned hue difference, for the continuity
   clause below. Nine lines rather than a colour library, like the rest of this
   file: `toLab` is already here and the two derived quantities are one line
   each. */
const chromaOf = (hex) => {
	const [, a, b] = toLab(hex);
	return Math.hypot(a, b);
};
const hueOf = (hex) => {
	const [, a, b] = toLab(hex);
	const h = (Math.atan2(b, a) * 180) / Math.PI;
	return h < 0 ? h + 360 : h;
};
const hueDelta = (x, y) => {
	const d = Math.abs(hueOf(x) - hueOf(y));
	return d > 180 ? 360 - d : d;
};

/*
 * The third half of the selection report: CONTINUITY WITH THE PANEL.
 *
 * The operator's first sentence about this role was "on dark mode it should be a
 * bit lighter and on light mode it should be dark enough to contrast", and the
 * round that answered it bought the lightness by spending the palette's own cast
 * - so the row that shipped read GREY on eight palettes (worst `cyberpunk` at
 * 0.62x its panel's Lab chroma, `tokyoNight` 0.76x), over-cast on thirteen
 * (`tokyoNightDay` 3.60x, `iceberg` 3.31x) and off the panel's hue by more than
 * 15 degrees on eleven (`arcade` 160 degrees, `oneLight` 155). Legibility was
 * never the problem there: every one of those rows passed the band, the field
 * floor and the ink floors. What they had lost was the panel's own colour.
 *
 * WHY THE CHROMA BOUND IS NOT A RATIO ALONE, with the measurement. A ratio band
 * cannot be satisfied on these grounds. Measured across the fifty-nine at the
 * ink cap these floors leave a row: [1.0x, 1.5x] is reachable on 42 of them with
 * the hue axis at its own bound and on 29 without it; [1.0x, 2.0x] on 50; and
 * three palettes (`catppuccinLatte`, `rosePineDawn`, `tokyoNightDay`) cannot
 * meet the band inside 2.5x at all, against `iceberg`'s and `arcade`'s 2.99 and
 * 2.92 that ship. The cause is arithmetic rather than taste: the ink floors cap
 * the lightness route at 2.0-3.3 ΔE00 (CIEDE2000's `Sl` divisor is 1.5-1.7 near
 * L* 90, so a 5 `L*` step there is worth only ~3), so the rest of the 4.0 band
 * has to be found on chroma or hue - and on a near-neutral panel the same
 * absolute cast that is 1.1x a chromatic panel's chroma is 3x a neutral one's.
 *
 * So the bound is stated the way the palette's own cast can answer it: the row
 * may ADD at most the looser of 1.5x the panel's chroma and the panel's chroma
 * plus 4 Lab units. The 1.5 is the ratio this file already treats as the onset of
 * over-cast (it is where the thirteen above were measured), the +4 is the `else`
 * branch of the clause this branch wrote for a purpose-authored selection step
 * (see the `sunken`/`elevated` block below), and which of the two is looser
 * turns over at 8 Lab units: above it the ratio binds, below it the budget does,
 * which is the only way one clause can mean something on both a near-neutral and
 * a saturated panel.
 *
 * The floor is the operator's own complaint read back: on a panel that carries a
 * cast at all, the row may not be greyer than the panel it steps off - stated
 * with the quantisation step's own tolerance, because an 8-bit sRGB triple moves
 * Lab chroma by up to ~0.25 at these levels and a floor with no tolerance would
 * fail a row that carries its panel's cast exactly. Below
 * `HIGHLIGHT_CHROMA_FLOOR` the palette is neutral to within that same
 * quantisation - `highContrastLight` and `oneLight` carry 0 - and a ratio there
 * measures the noise rather than a cast, so only the ceiling applies.
 *
 * ONE palette sits outside the floor for a measured reason rather than a
 * stylistic one: `gruvbox` carries 1.16 Lab units of cast on its panel and NO
 * value at or above that chroma clears the band inside the ink margins (the
 * derivation searched its whole cast family) - the row that clears the band and
 * the field floors carries 1.11, a difference of 0.05 that no 8-bit hex can
 * close. It is reported in the round's findings rather than pinned, because the
 * floor as stated is the one that has to hold for the other fifty-eight.
 *
 * `HIGHLIGHT_HUE_LIMIT` 15 is the operator's own threshold: the peer round
 * measured the breaks at 155-160 degrees and named 15 as the point past which the
 * row stops belonging to the panel. The clause below holds a palette's OWN
 * recessed plane to 45 degrees (a ground the palette did not author for a row);
 * this role IS authored, so the tighter number applies to it, and the fifty-nine
 * values on this branch sit at 0.0-14.65 degrees.
 */
const HIGHLIGHT_HUE_LIMIT = 15;
const HIGHLIGHT_HUE_FLOOR = 1.0;
const HIGHLIGHT_CHROMA_RATIO = 1.5;
const HIGHLIGHT_CHROMA_BUDGET = 4;
const HIGHLIGHT_CHROMA_FLOOR = 1.0;
const HIGHLIGHT_CHROMA_TOLERANCE = 0.25;

/*
 * The palettes whose OWN ink caps the lightness route below this file's step
 * floor, pinned to their measured step and the ink that binds it.
 *
 * The rule asks for the largest `L*` step the ink floors allow, and for seven of
 * the fifty-nine the ink on the row's ground reaches its floor with the 0.15 of
 * headroom within 2.0-3.25 `L*` of the panel - their `ink-dim` is only just
 * clear of the floor on the panel itself, so the row cannot rise the 3 `L*` the
 * direction floor asks for without putting text under its floor. Those seven pay
 * the band on the cast instead (measured 4.05-6.05 ΔE00) and are recorded here
 * in the same pin-not-mute shape as `EXCEPTIONS`.
 *
 * The set changed shape when the legibility pass lifted every ground, and both
 * directions of the change are measured rather than argued. `solarizedDark` and
 * `rosePineDawn` had their own ink caps move from 2.65 and 2.75 `L*` to 3.25 and
 * 3.3, so their values now run a full 3 `L*` step on the darker route -
 * `rosePineDawn` rejoins the list for the opposite reason, a 2.99 `L*` ceiling on
 * the lighter route it uses, which no 8-bit hex clears. `cyberpunk` joins because
 * its cap is exactly 3.0 `L*` and the step a shipped hex can carry is 2.9, and
 * the five palettes that were already here stay: on a lifted ground the same ink
 * floor buys a shorter route, so their caps moved down (2.75, 2.0, 2.25, 2.25,
 * 2.5 `L*` where design round 3 measured 2.75, 2.5, 2.25, 2.25, 2.75).
 *
 * WHAT THE GATE RE-DERIVES, because a pin whose reason is only prose is a number
 * that can rot (design round 3, D2): the assertion below recomputes the panel's
 * own ink cap - the largest `L*` step from `surface`'s own hue and chroma that
 * keeps every ink floor with this file's margin - and the binding ink's ratio
 * there, and fails if either has moved away from the pin's record. So a palette
 * whose inks change, or whose value drifts off the cap, re-opens its own pin.
 *
 * Why this is a pin rather than a smaller floor for everybody: on the other
 * fifty-two the step IS what carries the mark and 3 `L*` is reachable, so a
 * floor lowered to fit seven palettes would stop asserting anything about them.
 *
 * @type {{theme: string, step: number, cap: number, inkRole: string, onGround: number, capInk: number, why: string}[]}
 */
const HIGHLIGHT_STEP_PINS = [
	{
		theme: "catppuccinFrappe",
		step: 2.59,
		cap: 2.75,
		inkRole: "inkDim",
		onGround: 5.16,
		capInk: 5.15,
		why: "inkDim reaches its floor with the 0.15 of headroom at 2.75 L* on this panel, so the band is paid on the cast; the value runs the step to 2.59 L* with the cast at 1.5x the panel's chroma, which is the continuity clause's own ceiling",
	},
	{
		theme: "catppuccinMacchiato",
		step: 2,
		cap: 2,
		inkRole: "inkDim",
		onGround: 5.15,
		capInk: 5.17,
		why: "inkDim reaches its floor with the 0.15 of headroom at 2.0 L* here - the shortest route in the tree - so the band is paid on the cast at 1.46x the panel's chroma",
	},
	{
		theme: "cyberpunk",
		step: 2.9,
		cap: 3,
		inkRole: "inkDim",
		onGround: 5.15,
		capInk: 5.15,
		why: "this palette's cap is exactly 3.0 L* and the step a shipped 8-bit hex can carry from it is 2.9 - the ink floor and the quantisation are both at their edge here, which is why the value sits at 5.15:1 with no margin to spare; the band is paid on a cast of 1.2x the panel's chroma",
	},
	{
		theme: "nord",
		step: 2.51,
		cap: 2.25,
		inkRole: "inkDim",
		onGround: 5.15,
		capInk: 5.21,
		why: "inkDim reaches its floor with the 0.15 of headroom at 2.25 L* on this panel, so the band is paid on the cast; the cast is rotated 9 degrees to stay inside the continuity bound, at 1.36x the panel's chroma",
	},
	{
		theme: "palenight",
		step: 2.3,
		cap: 2.25,
		inkRole: "inkDim",
		onGround: 5.15,
		capInk: 5.16,
		why: "inkDim reaches its floor with the 0.15 of headroom at 2.25 L* here, so the band is paid on a cast of 1.45x the panel's chroma, rotated 13 degrees to stay inside the continuity bound",
	},
	{
		theme: "rosePine",
		step: 2.52,
		cap: 2.5,
		inkRole: "inkDim",
		onGround: 5.15,
		capInk: 5.17,
		why: "inkDim reaches its floor with the 0.15 of headroom at 2.5 L* on this panel, so the band is paid on the cast at 1.42x the panel's chroma",
	},
	{
		theme: "rosePineDawn",
		step: 2.99,
		cap: 3.25,
		inkRole: "inkDim",
		onGround: 5.17,
		capInk: 5.15,
		why: "this palette's ink cap is 3.25 L* on its own hue and chroma, but the row it needs is a CAST one: at 2.44x the panel's chroma the step a shipped hex clears is 2.99 L*, a hundredth under the floor. Its inkDim sits at 5.17:1, above the 5.15 the other pins run",
	},
];

/*
 * NO palette is pinned here any more, and this one is a retirement rather than a
 * loss: `rosePineDawn` was the only entry, and re-deriving the role moved it out
 * of the collision by measurement.
 *
 * `accentWash` is the app's active-row tint (`bg-accent-wash` in the agents
 * sidebar, the category rail, the spreadsheet's selected row), and `highlight`
 * is by construction a step toward the same family - so on a palette whose wash
 * already sits close to `surface` the two marks converge. The row ground is
 * held to the field floor (2.0) against that wash like any other pair this file
 * measures, and when the pin was written `rosePineDawn` could not reach it: the
 * palette's own ink capped the darker route at 2.75 `L*`, the best separation
 * available inside the band measured 1.75, and the shipped value sat at 0.93.
 * The legibility pass then lifted `surface` under it, which moved the ink cap to
 * 3.3 `L*`, and the sweep below re-derives the ceiling at 3.44 - so the floor IS
 * reachable now, and the value this branch ships measures 2.96. A pin would
 * record a ceiling the palette no longer needs, which is the mute button this
 * list exists to avoid.
 *
 * The other palettes the original finding named are clear of it too: `oneLight`
 * 0.70 -> 2.33, `rosePine` 0.98 -> 7.04, `tokyoNightDay` 1.54 -> 2.3.
 *
 * @type {{theme: string, got: number, ceiling: number, why: string}[]}
 */
/*
 * Mix `from` toward `to` by `alpha`, in 8-bit channels, the way the palettes'
 * own casts were authored. The wash pin's ceiling re-derivation walks this
 * family, so the gate and the authoring move through the same arithmetic.
 */
const mixHex = (from, to, alpha) => {
	const a = [1, 3, 5].map((i) => Number.parseInt(from.slice(i, i + 2), 16));
	const b = [1, 3, 5].map((i) => Number.parseInt(to.slice(i, i + 2), 16));
	return `#${a
		.map((v, i) =>
			Math.round(v * (1 - alpha) + b[i] * alpha)
				.toString(16)
				.padStart(2, "0")
				.toUpperCase(),
		)
		.join("")}`;
};

const HIGHLIGHT_WASH_PINS = [];

/*
 * The chart's hover mark, and why it is TWO assertions rather than one.
 *
 * Separation from `accent` is what makes the mark findable at all, and the floor
 * is **10 ΔE00**. The field floor above (2.0) is argued for a control compared
 * with ITSELF across two states in the same place; here the reader is finding ONE
 * bar among six to thirty-one by comparing it with its neighbours in SPACE, with
 * the tooltip's own box often covering the bar beside it — so the distance has to
 * carry on its own, with no state change to compare against. The role this
 * replaced measured 2.8 in monokai, 3.7 in neon and 4.3 in localOperatorDark
 * against the mark it was supposed to pick out, i.e. it sat at or under the
 * adjacent-FIELD floor that this file uses for two large planes.
 *
 * WHERE 10 COMES FROM, stated because it is not inherited from another constant:
 * the neighbouring floors measure different things. The four SEMANTIC roles take
 * `SEPARATION_FLOOR` (15) from each other, and the syntax tokens take
 * `SYNTAX_COMMENT_FLOOR` (8, used as a ΔE00 separation inside the syntax block).
 * 10 sits deliberately between them: a hovering bar is larger than a token and
 * has to be found faster, and unlike a semantic it does not have to be
 * unmistakable from every other semantic in the palette.
 *
 * The twelve authored values clear it, measured with this file's own `deltaE`:
 * 10.0 to 18.7, and the tightest is tokyoNight at 10.002 — a margin of two
 * thousandths, recorded here rather than left for the next editor to discover.
 * That pair is therefore the one a palette change must re-measure; the gate will
 * fail rather than let it slide, which is what a floor is for.
 *
 * Distance from the plot ground is what makes it a highlight rather than a
 * demotion, and it is the half no floor saw. `accentHover` — the role this used
 * to borrow — moves TOWARD the ground in obsidian (16.97:1 at rest, 13.96:1
 * hovered, the only palette of the twelve that does), so the pointed-at bar reads
 * as receding. Every palette's `chartBarHover` is authored to be at least as far
 * from the ground the chart is drawn on as `accent` is: a brighter step on a dark
 * ground, a darker one on a light ground, and — in obsidian, whose accent is
 * already its brightest value — a chroma step at the same lightness instead.
 */
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
	 * The selection ground: `highlight`, the current row's own step.
	 *
	 * `highlight` is NOT in `GROUNDS`, and must not be. `GROUNDS` is the
	 * elevation ladder every ink and every structural border is measured
	 * against, and its members are alternative states of ONE panel — a control
	 * is drawn on one of them at a time. `highlight` is a state of a ROW inside
	 * a panel whose ground is still `surface`, so listing it there would assert
	 * ink, borders and controls against pairings nothing renders, which is the
	 * mistake the browser chip's own row already records (a ground the component
	 * never sits on is a measurement of the wrong thing).
	 *
	 * What it needs instead is five facts the row depends on, and the fourth is
	 * the one an earlier round of this branch got wrong, the fifth the one the
	 * round after it got wrong.
	 *
	 * 1. That the step off `surface` is PERCEIVABLE, at its OWN floor. This is a
	 *    large plane the reader has to find while the pointer is somewhere else
	 *    - a different problem from the field floor `FIELD_SEPARATION_FLOOR`
	 *    states, which is a control compared with itself across two states in the
	 *    same place (led). The role was authored at ΔE00 2.18-2.28, cleared all
	 *    of these floors, and the operator still reported it as invisible beside
	 *    a hovered neighbour; the fifty-nine now land 4.00-4.85.
	 * 2. That the step is a LIGHTNESS step and that its DIRECTION is the one the
	 *    mode runs in - lighter than the panel on a dark palette, darker on a
	 *    light one - with a floor on the magnitude. ΔE00 alone cannot state this:
	 *    three palettes cleared 4.0 with the entire gain bought on chroma, at
	 *    `L*` steps of 2.61, 2.82 and 2.52 that were SMALLER than the 3.26-3.47
	 *    steps the operator had already reported as invisible, so the same report
	 *    was answered twice. See `HIGHLIGHT_LIGHTNESS_STEP_FLOOR` above; this is
	 *    `HIGHLIGHT_LIGHTNESS_STEP_FLOOR`'s assertion, and it is the reason the
	 *    rule is stated as an ORDER (lightness first, chroma for the remainder)
	 *    rather than as a distance.
	 * 3. That it is not the same ground as the two it is drawn against, at the
	 *    FIELD floor, because those really are state-distinctions. The rows it
	 *    marks carry `hover:bg-elevated`, so a hovered row has to stay visibly
	 *    different from the current one (worst pair now rosePine, 2.0);
	 *    and the panel's wells are `sunken`, which is the role this one replaced
	 *    and must not collapse onto (worst pair now githubLight, 2.02).
	 *
	 * The ink floors on it are the other half, and they are what makes "one ink
	 * for every cap" a claim this file holds up rather than a preference: the
	 * caps inside a current row sit on this ground at `ink-dim` (in the authored
	 * set now 5.15-5.96:1 against the 4.5:1 floor, i.e. `HIGHLIGHT_INK_MARGIN`
	 * or more of headroom everywhere), and their ground changes when the row
	 * becomes the current one. THAT floor is what caps the step on the palettes
	 * where it stops short of the band's top, so it is named in the failure below
	 * rather than left for a reader to derive. It is also the reason the step is
	 * taken on lightness to the ink cap rather than further: the caps and the
	 * `· lopdev` binding drawn inside a current row are body ink, and they are
	 * not what the mark may spend.
	 *
	 * 5. That it is still THE PANEL'S OWN COLOUR. The band can be paid on chroma,
	 *    and the field floors say nothing about which COLOUR the row ends up: a row
	 *    walked toward grey clears every floor in this file and still reads as a
	 *    plain step rather than as the panel's tinted current row, which is what
	 *    the operator reported. So the row keeps the panel's cast: it carries the
	 *    panel's chroma, may not be greyer than it, and may not add more cast than
	 *    `max(HIGHLIGHT_CHROMA_RATIO x it, it + HIGHLIGHT_CHROMA_BUDGET)`; its hue
	 *    stays within `HIGHLIGHT_HUE_LIMIT` degrees of the panel's. The constants
	 *    above carry the measurement each number comes from - this is the clause a
	 *    ratio band cannot state on a near-neutral panel, and the peer round's
	 *    1.5x band is unreachable on 17 of the 59.
	 *
	 * WHAT A FAILURE HERE MEANS. It is a statement about a palette that has not
	 * been re-authored, not a gate to relax: take the largest `L*` step the ink
	 * floors allow, at the surface's own hue, and buy only the shortfall to this
	 * floor on the chroma axis at that same hue. Where that shortfall cannot be
	 * bought inside this file's continuity clause - the ink cap leaves the band at
	 * 4.0 and the palette's own lift of its cast would run past the bound - the
	 * value takes the LEAST rotation of the panel's cast that lets the step hold
	 * inside it (branch H of the rule; eighteen palettes on this branch take it,
	 * the largest at 14.65 degrees). `palette-contract.ts`'s `highlight` doc states
	 * the rule in full for a porting author, including the palettes that still
	 * carry a partly chroma-bought step.
	 */
	for (const other of ["elevated", "sunken"]) {
		if (!isHex(p.highlight) || !isHex(p[other])) continue;
		assertions++;
		const got = deltaE(p.highlight, p[other]);
		if (got < FIELD_SEPARATION_FLOOR) {
			fail(
				`${id}: \`highlight\` ${p.highlight} is ΔE00 ${r2(got)} from \`${other}\` ${p[other]} (need ${FIELD_SEPARATION_FLOOR}) — the current row's ground must never be the same plane as the hover step above it or the well below it, because those are the two states it is read against`,
			);
		}
	}
	{
		assertions++;
		const got = deltaE(p.highlight, p.surface);
		if (got < HIGHLIGHT_SEPARATION_FLOOR) {
			/* The ink that binds the step, measured on this palette's own authored
			   ground, so the message carries the reason the value cannot simply be
			   raised. */
			const bound = INKS.map(([role]) => [
				role,
				ratio(p[role], p.highlight),
			]).sort((a, b) => a[1] - b[1])[0];
			fail(
				`${id}: \`highlight\` ${p.highlight} is ΔE00 ${r2(got)} from \`surface\` ${p.surface} (need ${HIGHLIGHT_SEPARATION_FLOOR}) — the current row's mark is invisible beside a hovered neighbour below this band. Author the LARGEST \`L*\` step the ink floors allow at the surface's own hue, and buy only the shortfall to ${HIGHLIGHT_SEPARATION_FLOOR} on the chroma axis at that hue. It must also stay ΔE00 ${FIELD_SEPARATION_FLOOR} clear of \`elevated\` and \`sunken\` (that bound, not ${HIGHLIGHT_SEPARATION_FLOOR}, is what the field loop above enforces); the binder here is \`${bound[0]}\` at ${r2(bound[1])}:1 on this ground, and the direction is asserted in the block below, because ΔE00 is a budget a chroma-only step can spend while moving the wrong way in lightness`,
			);
		}
	}
	/*
	 * The step's AXIS and its DIRECTION, which ΔE00 cannot state.
	 *
	 * The operator's sentence is "on dark mode it should be a bit lighter and on
	 * light mode it should be dark enough to contrast" - a lightness fact. ΔE00 is
	 * a budget with a chroma term in it, so at a fixed `L*` a step can be made as
	 * large as you like by warming it, and the three palettes this floor was drawn
	 * for proved it is not a hypothetical: tokyoNight, `localOperatorDark` and
	 * `localOperatorLight` all cleared the band with the whole of the gain bought
	 * on chroma at `L*` steps of 2.61, 2.82 and 2.52 - less light on the two dark
	 * themes than the 3.26 and 3.47 steps he had already reported as invisible, so
	 * the report was answered twice and the mark read as a deeper blue row rather
	 * than a lighter one.
	 *
	 * The sign is the half that matters and the magnitude is the other: a token
	 * step in the right direction is still a step a reader cannot find. See
	 * `HIGHLIGHT_LIGHTNESS_STEP_FLOOR` for where 3.0 comes from.
	 */
	{
		assertions++;
		const step = toLab(p.highlight)[0] - toLab(p.surface)[0];
		const wanted = p.mode === "dark" ? step : -step;
		const pin = HIGHLIGHT_STEP_PINS.find((x) => x.theme === id);
		if (pin) {
			/*
			 * A pinned palette, and the pin is a claim about three things rather
			 * than a note beside the value: the step it ships, the ink ratio on
			 * that ground, and - re-derived here, because prose cannot go stale
			 * but a number the gate never recomputes can - the panel's own ink
			 * cap and the binding ink's ratio at that cap.
			 */
			const [capL, capA, capB] = toLab(p.surface);
			let cap = 0;
			let capInk = null;
			for (let step = 0.25; step <= 8; step += 0.25) {
				const at = labToHex([
					capL + (p.mode === "dark" ? step : -step),
					capA,
					capB,
				]);
				if (!at) break;
				if (
					INKS.every(
						([role, floor]) =>
							ratio(p[role], at) >= floor + HIGHLIGHT_INK_MARGIN,
					)
				) {
					cap = step;
					capInk = ratio(p[pin.inkRole], at);
				}
			}
			if (
				Math.abs(wanted - pin.step) > 0.05 ||
				ratio(p[pin.inkRole], p.highlight) < pin.onGround - 0.05 ||
				Math.abs(cap - pin.cap) > 0.5 ||
				(capInk !== null && Math.abs(capInk - pin.capInk) > 0.15)
			) {
				fail(
					`${id}: the pinned highlight step no longer matches — recorded ${pin.step} L* with ${pin.inkRole} at ${pin.onGround}:1 on the row's ground and a ${pin.cap} L* cap at ${pin.capInk}:1, measured ${r2(wanted)} L* at ${r2(ratio(p[pin.inkRole], p.highlight))}:1 with a ${r2(cap)} L* cap at ${capInk === null ? "no measurable" : r2(capInk)}:1. Re-measure the cap, re-author the value if the inks moved, and update the pin`,
				);
			}
		} else if (wanted < HIGHLIGHT_LIGHTNESS_STEP_FLOOR) {
			const wrongSide =
				wanted <= 0
					? ` — and it is on the WRONG SIDE of \`surface\` for this mode, which is the half of the operator's sentence ΔE00 cannot state`
					: "";
			fail(
				`${id}: \`highlight\` ${p.highlight} sits ${r2(step)} \`L*\` from \`surface\` ${p.surface}, so the current row is ${p.mode === "dark" ? "LIGHTER" : "DARKER"} than its panel by ${r2(wanted)} — the floor is ${HIGHLIGHT_LIGHTNESS_STEP_FLOOR} \`L*\` in that direction${wrongSide}. Author the step as a LIGHTNESS step at the surface's own hue - the largest one the ink floors allow - and buy only the shortfall to ΔE00 ${HIGHLIGHT_SEPARATION_FLOOR} on the chroma axis at that hue: \`palette-contract.ts\`'s \`highlight\` doc states the rule in full`,
			);
		}
	}
	/*
	 * 5. CONTINUITY with the panel - the axis the operator's second report moved,
	 * and the one neither the band nor the lightness floor can see. See
	 * `HIGHLIGHT_HUE_LIMIT` above for the numbers and the measurements behind
	 * them.
	 */
	if (isHex(p.highlight) && isHex(p.surface)) {
		const panelChroma = chromaOf(p.surface);
		const rowChroma = chromaOf(p.highlight);
		const chromaCeiling = Math.max(
			HIGHLIGHT_CHROMA_RATIO * panelChroma,
			panelChroma + HIGHLIGHT_CHROMA_BUDGET,
		);
		assertions++;
		if (rowChroma > chromaCeiling) {
			fail(
				`${id}: \`highlight\` ${p.highlight} carries C* ${r2(rowChroma)} where \`surface\` ${p.surface} carries ${r2(panelChroma)}, past the ${r2(chromaCeiling)} the continuity clause allows (the looser of ${HIGHLIGHT_CHROMA_RATIO}x the panel's and the panel's + ${HIGHLIGHT_CHROMA_BUDGET}) — the row stops being the panel's own tint and becomes a separate saturated plane beside it. The cast may buy only the shortfall to the ΔE00 ${HIGHLIGHT_SEPARATION_FLOOR} band, which these grounds leave at 2.0-3.3 ΔE00 of lightness; take the rest on the hue axis, within the ${HIGHLIGHT_HUE_LIMIT} degrees this file allows, before lifting chroma past the bound`,
			);
		}
		if (panelChroma >= HIGHLIGHT_CHROMA_FLOOR) {
			assertions++;
			if (rowChroma < panelChroma - HIGHLIGHT_CHROMA_TOLERANCE) {
				fail(
					`${id}: \`highlight\` ${p.highlight} is measurably less chromatic than \`surface\` ${p.surface} (C* ${r2(rowChroma)} against ${r2(panelChroma)}, tolerance ${HIGHLIGHT_CHROMA_TOLERANCE}) — the row the operator reported as lost reads exactly this way: walked toward grey, with the band, the field floors and the ink floors all green while it stops being the panel's current row and becomes a plain step. Carry the panel's cast: buy the shortfall on the hue axis or on chroma ABOVE the panel's, never below it`,
				);
			}
		}
		if (panelChroma >= HIGHLIGHT_HUE_FLOOR) {
			assertions++;
			const drift = hueDelta(p.highlight, p.surface);
			if (drift > HIGHLIGHT_HUE_LIMIT) {
				fail(
					`${id}: \`highlight\` ${p.highlight} sits ${r2(drift)} degrees off \`surface\` ${p.surface}'s hue (limit ${HIGHLIGHT_HUE_LIMIT}) — the current row must read as a step off THIS panel, not as a second hue beside it. The peer round measured the shipped rows at 155-160 degrees (\`arcade\`, \`oneLight\`) and named 15 as the point the row stops belonging to the panel; the clause below holds a palette's own recessed plane to 45, because that is a ground the palette did not author for a row`,
				);
			}
		}
	}
	/*
	 * The row's ground against the app's OTHER selected-row mark.
	 *
	 * `accentWash` is what the app paints for an active or selected row elsewhere
	 * (`bg-accent-wash`), and `highlight` is a step toward the same family by
	 * construction - so on a palette whose wash sits close to `surface` the two
	 * marks describe the same state in two different panels. This file measured
	 * `highlight` against `surface`, `elevated`, `sunken` and the inks and never
	 * against the wash, which is how the port integration landed four palettes
	 * under this floor without a single assertion moving (design round 3, D3).
	 *
	 * No palette is pinned below any more: the last one, `rosePineDawn`, is moved
	 * out of the collision by the value this branch ships (2.96 against the 2.0
	 * floor), so the list is empty and every palette meets the floor. The pin
	 * shape and its ceiling sweep are kept for the next palette that cannot - a
	 * pin is a measurement kept where the floor is unreachable rather than simply
	 * missed.
	 */
	{
		assertions++;
		const pin = HIGHLIGHT_WASH_PINS.find((x) => x.theme === id);
		if (isHex(p.highlight) && isHex(p.accentWash)) {
			const got = deltaE(p.highlight, p.accentWash);
			if (pin) {
				/*
				 * The ceiling is re-derived rather than trusted, for the reason D2
				 * named for the step pins one round earlier: a hand-measured number
				 * sitting beside a value is the one number nothing recomputes. The
				 * sweep below is the claim itself - the best separation from this
				 * palette's wash that any ground inside the band, the field floors
				 * and the ink floors can reach, walking the cast from none to 0.6 of
				 * the way to `accent` at every step the inks allow.
				 */
				let ceiling = 0;
				for (let alpha = 0; alpha <= 0.6001; alpha += 0.005) {
					const cast = mixHex(p.surface, p.accent, alpha);
					const [, ca, cb] = toLab(cast);
					const base = toLab(p.surface)[0];
					for (let step = 0.25; step <= 4; step += 0.25) {
						const at = labToHex([
							base + (p.mode === "dark" ? step : -step),
							ca,
							cb,
						]);
						if (!at) continue;
						if (deltaE(at, p.surface) < HIGHLIGHT_SEPARATION_FLOOR) continue;
						if (
							deltaE(at, p.elevated) < FIELD_SEPARATION_FLOOR ||
							deltaE(at, p.sunken) < FIELD_SEPARATION_FLOOR
						)
							continue;
						if (
							!INKS.every(
								([role, floor]) =>
									ratio(p[role], at) >= floor + HIGHLIGHT_INK_MARGIN,
							)
						)
							continue;
						ceiling = Math.max(ceiling, deltaE(at, p.accentWash));
					}
				}
				if (
					Math.abs(got - pin.got) > 0.05 ||
					Math.abs(ceiling - pin.ceiling) > 0.1
				) {
					fail(
						`${id}: the pinned highlight/wash pair moved — recorded ΔE00 ${pin.got} against the ${FIELD_SEPARATION_FLOOR} field floor and a ceiling of ${pin.ceiling}, measured ${r2(got)} with a re-derived ceiling of ${r2(ceiling)}. Re-measure the ceiling and update the pin`,
					);
				}
			} else if (got < FIELD_SEPARATION_FLOOR) {
				fail(
					`${id}: \`highlight\` ${p.highlight} is ΔE00 ${r2(got)} from \`accentWash\` ${p.accentWash} (need ${FIELD_SEPARATION_FLOOR}) — the current row's ground and the app's active-row wash read as the same mark below this floor, and they are two states, so they have to be two grounds. Steer the cast away from the wash's own family or move the step, and if the palette's inks cap that route, pin the pair with its measured ceiling rather than dropping the assertion`,
				);
			}
		}
	}
	for (const [inkRole, floor] of INKS) {
		assertPair(
			id,
			p,
			inkRole,
			"highlight",
			floor + HIGHLIGHT_INK_MARGIN,
			"body ink on the selection ground",
		);
	}
	/*
	 * NO `border-control`-on-`highlight` pair here, and its absence is a
	 * decision rather than an oversight: it existed for the 1px structure
	 * boundary an earlier round drew around a current row, which is RETIRED
	 * (design round 1, D3, and § 2's definition of that role: the sole boundary
	 * of an input, select, checkbox or outlined button). `picker-host.tsx` still
	 * draws that ring on the command palette's POINTER row, where the ring means
	 * "the row under the pointer" rather than "you are here", and the pair is
	 * asserted there by that component's own rows. A row mark drawn in a role
	 * that has no floor for it should not have one asserted on its behalf.
	 */

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
	 * syntax colour is painted on it. `elevated`, `accentWash` and `highlight`
	 * are in it because each is a ground a tone role is really drawn on - a
	 * dialog's required-mark and a danger button's label on `elevated`, the
	 * ask-option card's text on `accentWash`, the selected sidebar row on
	 * `highlight` - and the old list stopped at `sunken`, which is how `danger`
	 * came to be drawn at 3.76:1 on `elevated` in `monokai` behind three
	 * recorded pins rather than a floor. Those pins are gone; see `EXCEPTIONS`.
	 */
	for (const role of AS_TEXT) {
		for (const g of GROUNDS6) {
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
	 * - `info` is EXCLUDED from that family and given the reduced
	 *   `SYNTAX_COMMENT_FLOOR` (8) instead, because `info` is the cool
	 *   counterweight the port mapped the TUI's `signal` onto: on the palettes
	 *   whose second hue is in that family the two are the same colour by
	 *   construction (`catppuccinLatte` measures 6.5, `radient` 5.9), and 15 would
	 *   fail them for being what they are rather than for a defect.
	 * - `ALT_ACCENT_CHROMA_FLOOR` (15) asserts the AXIS: all three floors above
	 *   can be satisfied by draining the hue toward the ink, which turns the second
	 *   accent into a second grey. See the constant.
	 *
	 * The text floor is asserted below, on the three grounds its sites paint it on.
	 * It is NOT the `AS_TEXT` loop's six: the alt hue is never drawn on a dialog's
	 * `elevated`, on the selection wash or on the current row, and asserting it
	 * there would demand 28 palette values this change does not need - measured,
	 * `monokai`'s alt reads 3.95:1 on `accentWash` and `oneDark`'s 3.78:1 on
	 * `elevated`. The rule that keeps it honest is the role's own: no text is
	 * painted on `accentAlt`, and none of those pairs can arise.
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
	}

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
			/* This adds the perceptual half for the one pair no loop measured
			   before. */
			if (from === "canvas" && to === "sunken") {
				assertions++;
				const got = deltaE(p.canvas, p.sunken);
				if (got < GROUND_STEP_DELTA_E) {
					fail(
						`${id}: \`canvas\` and \`sunken\` are ΔE00 ${r2(got)} apart (need ${GROUND_STEP_DELTA_E}) — a well nobody can see is not a well, and both blocks that paint one are read inside a trace that sits on the canvas`,
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
	 * in every one of the palettes" (measured ΔE00 5.85-16.70 across all 59), and
	 * the command palette's active row was the sibling that kept the accent wash
	 * alone - the row the operator screenshotted, which read 1.003:1 on
	 * `localOperatorDark` while passing every threshold by hue.
	 *
	 * WHAT THIS DOES NOT ASSERT, and why - it is a RECORDED deviation rather than
	 * a passed check. The rule a purpose-authored selection step has to satisfy
	 * also includes a hue clause (within 45° of its base where the base's chroma
	 * is >= 4, else chroma within the base's plus 4). `sunken` is the palette's
	 * own recessed ground rather than a tint authored for this row, and it does not
	 * satisfy that clause in eight palettes: seven light palettes carry more
	 * chroma than their own near-neutral `elevated` plus 4 - alucard 9.92,
	 * ayuLight 4.75, localOperatorLight 7.52, mintLight 10.00, rosePineDawn 7.77,
	 * sage 9.66, solarizedLight 10.03 - and `dune`'s sunken sits 46.09° from its
	 * elevated, 1.09° outside the limit. Both are the palette's own cast on a
	 * recessed plane, which is what the clause exists to catch only when it has
	 * been AUTHORED onto a selection; the two marks the clause would otherwise
	 * separate are separated here by ΔE00 5.85-16.70, the widest margin in the
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
	 */
	for (const g of [
		"canvas",
		"surface",
		"elevated",
		"accentWash",
		"highlight",
	]) {
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

console.log(
	`Contrast contract holds: ${assertions} assertions across ${themeCount} themes, ${EXCEPTIONS.length} pinned exception(s), ${PERCEPTIBLE_EXCEPTIONS.length} pinned ΔE00 exception(s), ${INK_STEP_PINNED.length} pinned ink step(s), ${CONTROL_EDGE_PINNED.length} pinned control edge(s), ${HIGHLIGHT_STEP_PINS.length} pinned highlight step(s), ${HIGHLIGHT_WASH_PINS.length} pinned wash separation(s).`,
);
