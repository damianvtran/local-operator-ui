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
		name: "accent wash chip",
		on: ["canvas", "surface"],
		fill: "accentWash",
		border: "accent",
		ink: "accent",
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
		 */
		name: "credential pill",
		on: ["canvas", "surface"],
		fill: "infoWash",
		border: "infoBorder",
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
		on: ["surface", "elevated"],
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
		name: "browser waiting marker chip",
		on: ["surface", "elevated"],
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
		on: ["surface", "elevated"],
		fill: "dangerWash",
		border: "borderControl",
		ink: "ink",
	},
	{
		/*
		 * The strip's ACTIVE tab: `elevated` on the strip's own `sunken`, bounded by
		 * `border-control` (design round 3, D18). It has its own fill and edge, so by
		 * this file's first rule it has a row - and the row is the point: the ground
		 * step alone is 1.11:1 in the dark palettes, which is a depth cue rather than
		 * a marker, so `border-control` is what has to clear the 3:1 non-text floor.
		 * It is asserted against BOTH grounds the edge borders: the strip's `sunken`
		 * (in the gaps) and the neighbouring tab's `surface`.
		 */
		name: "browser active tab",
		on: ["sunken", "surface"],
		fill: "elevated",
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
		on: ["surface"],
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
		 * WHY A CALL SITE AND NOT A PALETTE ROW. `accent-wash` is not invisible
		 * everywhere: the app rail paints it on `sunken`, where it measures 9.6 in
		 * tokyoNight, and the settings rail is the OTHER `surface` panel and is
		 * fixed with this one (the pin below). Strengthening the role would make
		 * every hover tint in the app louder to fix the two panels that draw it on
		 * `surface`. The replacement is `sunken`, which the field-floor loop at the
		 * bottom of this file already asserts as a perceptible step from `surface`
		 * AND from `elevated` in all twelve palettes — BOTH pairs pre-date this
		 * change; only the call-site pins are new — with a worst case of ΔE00 3.75
		 * against the 2.0 field floor. What no palette assertion can see is the
		 * CLASS on the row, which is how this shipped: every row in this file stayed
		 * green while painting a ground the user could not see. Reverting this line
		 * to a wash fails here and nowhere else in THIS file
		 * (`scripts/chat-sidebar-selection.test.mjs` catches it too, by resolving the
		 * row's own class expression through the shipped `cn`); a palette edit that
		 * collapsed `surface` against `sunken` fails the `["surface", "sunken"]`
		 * pair in that loop.
		 *
		 * The `hover:` half is part of the ground, not decoration: `rowStyle`
		 * carries `hover:bg-elevated`, and the hover variant outranks a bare
		 * background in the cascade, so without it the pointer REPLACED the
		 * selection ground on the row the user is on — in obsidian those two
		 * grounds are ΔE00 0.77 apart, so hovering the current row erased it.
		 * The class is one shared constant for all four current-row states in
		 * this panel (the selected conversation, the All chats filter, the New
		 * chat row and the entity row staging a draft), so pinning the
		 * declaration is what holds all four.
		 */
		what: "chat sidebar current-row ground",
		file: "src/renderer/src/features/chat/components/chat-sidebar.tsx",
		must: 'const rowCurrent = "bg-sunken text-ink hover:bg-sunken";',
		why: "the panel's ground is `surface`, where a wash selection is invisible in tokyoNight (ΔE00 1.05), and a bare background loses to `rowStyle`'s hover step on the row the user is already on; no palette assertion can see a class, so this is the only place in this file that can catch the invisible selection",
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
		 */
		what: "chat session row current-row mark",
		file: "src/renderer/src/features/chat/components/chat-sidebar.tsx",
		must: "selectedConversation === row.session_id &&\n\t\t\t\t\t\t!activeDraftKey &&\n\t\t\t\t\t\trowCurrent,",
		why: "this is the mark the operator reported missing; the predicate and the ground have to stay on the row together, which is what `aria-current` on the same two terms asserts to a screen reader",
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
		 */
		what: "settings rail current-row ground",
		file: "src/renderer/src/features/settings/components/settings-sidebar.tsx",
		must: '"bg-sunken font-medium text-ink hover:bg-sunken"',
		why: "the same `surface` ground as the chat panel, where the wash measured ΔE00 1.05 and the current destination had no mark at all; the `hover:` half is in the pin because this rail's inactive rows carry `hover:bg-elevated`, which would otherwise replace the mark under the pointer",
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
const EXCEPTIONS = [
	/*
	 * `danger` as text on `elevated`, the three palettes that cannot clear 4.5:1
	 * there. Measured from the shipped palettes, not argued: the pair is drawn by
	 * the dialog required-mark and the danger-variant button's label, both of
	 * which are shared components this file does not own. Every other palette
	 * clears the floor (4.66 tokyoNight up to 6.19 iceberg) and is asserted
	 * normally above.
	 */
	{
		theme: "dracula",
		fg: "danger",
		bg: "elevated",
		got: 3.81,
		why: "the dialog required-mark and the danger button's label; a shared control's colour, recorded rather than changed here (design round 2, D3)",
	},
	{
		theme: "monokai",
		fg: "danger",
		bg: "elevated",
		got: 3.76,
		why: "same pair as dracula; worst of the three",
	},
	{
		theme: "neon",
		fg: "danger",
		bg: "elevated",
		got: 4.43,
		why: "same pair as dracula; 0.07 under the floor",
	},
	/*
	 * The danger-variant control's border on a dialog ground, eight palettes
	 * under the 3:1 a control's only edge is asked to clear. Same reasoning as
	 * the text pair above: a shared control's colour, recorded where a reader
	 * can find it rather than changed in a panel's PR.
	 */
	{
		theme: "monokai",
		fg: "dangerBorder",
		bg: "elevated",
		got: 2.49,
		why: "the danger control's only edge on a dialog ground; worst of the eight",
	},
	{
		theme: "dracula",
		fg: "dangerBorder",
		bg: "elevated",
		got: 2.51,
		why: "same pair as monokai",
	},
	{
		theme: "radient",
		fg: "dangerBorder",
		bg: "elevated",
		got: 2.58,
		why: "same pair as monokai",
	},
	{
		theme: "synth",
		fg: "dangerBorder",
		bg: "elevated",
		got: 2.6,
		why: "same pair as monokai",
	},
	{
		theme: "obsidian",
		fg: "dangerBorder",
		bg: "elevated",
		got: 2.65,
		why: "same pair as monokai",
	},
	{
		theme: "tokyoNight",
		fg: "dangerBorder",
		bg: "elevated",
		got: 2.66,
		why: "same pair as monokai",
	},
	{
		theme: "neon",
		fg: "dangerBorder",
		bg: "elevated",
		got: 2.78,
		why: "same pair as monokai",
	},
	{
		theme: "dune",
		fg: "dangerBorder",
		bg: "elevated",
		got: 2.88,
		why: "same pair as monokai; 0.12 under the floor",
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
const INK_STEP_PINNED = [
	{ theme: "tokyoNight", got: 5.74 },
	{ theme: "obsidian", got: 5.8 },
	{ theme: "iceberg", got: 6.03 },
	{ theme: "neon", got: 7.17 },
	{ theme: "localOperatorLight", got: 7.93 },
];
const inkStepSeen = new Set();

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
	"chartBarHover",
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
 */
const FIELD_SEPARATION_FLOOR = 2.0;
const LINE_SEPARATION_FLOOR = 4.0;

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

	/*
	 * The picker's partial-listing note, on the dialog's own ground.
	 *
	 * It cannot join `AS_TEXT`: `elevated` is not one of that list's grounds, and
	 * it cannot be, because two of the five tone inks do not clear the text floor
	 * there (`accent` 4.22 on dracula, `danger` 3.76 on monokai) and asserting
	 * them would report failures against pairs nothing renders.
	 *
	 * This note is one of TWO places a tone ink is drawn on `elevated`:
	 * `models.catalogue` can answer with rows AND per-provider errors, and the
	 * note about what is missing belongs above the list rather than instead of it
	 * (design D4). `warning` is the role it renders in, so that is the pair
	 * asserted — the measured worst case is 5.02 (monokai). Green on the four
	 * grounds above is not evidence about this one.
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
		const sibling = p[item.pairedWith];
		const ground = p[item.against];
		if (!isHex(role) || !isHex(sibling) || !isHex(ground)) continue;
		for (const g of item.on) {
			if (!isHex(p[g])) continue;
			assertions++;
			const got = deltaE(role, p[g]);
			if (got < item.minDeltaE) {
				fail(
					`${id}: ${item.name} — ${item.role} ${role} on ${g} ${p[g]} is ΔE00 ${r2(got)}, need ${item.minDeltaE} to be seen at all`,
				);
			}
		}
		/* One component, two states: the weight may not jump. */
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
	`Contrast contract holds: ${assertions} assertions across ${themeCount} themes, ${EXCEPTIONS.length} pinned exception(s), ${INK_STEP_PINNED.length} pinned ink step(s).`,
);
