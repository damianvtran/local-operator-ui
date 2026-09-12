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
import { deltaE, r2 } from "./color.mjs";
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
const isHex = (v) => typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v);

/* ---- 3. loading the palettes ------------------------------------------- */

/* Palette loading lives in palette-source.mjs so this gate and the CSS
   generator cannot read the same files differently. */

/* ---- 4. what the system permits ---------------------------------------- */

/** The four grounds every ink must be legible on. */
const GROUNDS = ["canvas", "surface", "elevated", "sunken"];

/** Ink roles and the floor each must clear on every ground. */
const INKS = [
	["ink", FLOOR.strongText],
	["inkMuted", FLOOR.text],
	["inkDim", FLOOR.text],
];

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
		name: "accent wash chip",
		on: ["canvas", "surface"],
		fill: "accentWash",
		border: "accent",
		ink: "accent",
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
		 * The empty wheel, which is a reachable state and not a loading
		 * placeholder: a session that has not reported a reading yet renders
		 * the track ALONE. With no arc over it the track is the control's sole
		 * boundary, which is what puts it on `borderControl` rather than
		 * `hairline` and what this row pins.
		 */
		name: "context wheel, no reading yet",
		on: ["surface"],
		fill: null,
		border: "borderControl",
		ink: "inkMuted",
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
];

/** Roles that must clear the structural 3:1 floor on all four grounds. */
const STRUCTURAL = ["borderControl"];

/** Roles that must clear the text floor as text on canvas, surface and sunken. */
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
const EXCEPTIONS = [];

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
const SEPARATION_FLOOR = 15;

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
 */
const FIELD_SEPARATION_FLOOR = 2.0;
const LINE_SEPARATION_FLOOR = 4.0;

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

	/* Ink on every ground. */
	for (const [inkRole, floor] of INKS) {
		if (EXEMPT_INK.has(inkRole)) continue;
		for (const g of GROUNDS) {
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

	/* Structural borders. */
	for (const role of STRUCTURAL) {
		for (const g of GROUNDS) {
			assertPair(id, p, role, g, FLOOR.nonText, "structural border");
		}
	}

	/* Semantic and accent colours used as text.
	 *
	 * `sunken` is in this list because it is the editor's own ground: every
	 * syntax colour is painted on it, and the code-mirror theme rejected
	 * `inkDisabled` for comments on exactly the grounds that it failed 4.5:1
	 * there. Asserting only canvas and surface left the one ground where the
	 * argument was made unmeasured. */
	for (const role of AS_TEXT) {
		for (const g of ["canvas", "surface", "sunken"]) {
			assertPair(id, p, role, g, FLOOR.text, "colour as text");
		}
	}

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
			if (Math.max(fillEdge, borderEdge) < FLOOR.nonText) {
				fail(
					`${id}: ${c.name} on ${g} has no perceivable edge — fill ${fillEdge}:1, border ${borderEdge}:1, need one at ${FLOOR.nonText}:1`,
				);
			}
		}
	}

	/* Graphic objects against the ground they are drawn on. */
	for (const g of GRAPHICS) {
		for (const ground of g.on) {
			assertPair(id, p, g.fg, ground, FLOOR.nonText, g.name);
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

console.log(
	`Contrast contract holds: ${assertions} assertions across ${themeCount} themes, ${EXCEPTIONS.length} pinned exception(s).`,
);
