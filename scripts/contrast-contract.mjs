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
import {
	deltaE,
	isHex,
	labToHex,
	lum,
	over,
	r2,
	ratio,
	toLab,
} from "../src/shared/theme-engine/color.mjs";
import {
	ADJACENT,
	ALT_ACCENT_CHROMA_FLOOR,
	ARRIVAL_BAND_ALPHA,
	AS_TEXT,
	CHART_HOVER_GROUND,
	CHART_HOVER_SEPARATION_FLOOR,
	COMMAND_TOKEN,
	COMMAND_TOKEN_FLOOR,
	COMMAND_TOKEN_GROUNDS,
	COMMAND_TOKEN_PINNED,
	CONTROLS,
	CONTROL_EDGE_PINNED,
	DISABLED_CEILING,
	ELEVATED_PANEL_DELTA_E,
	EXCEPTIONS,
	EXEMPT_INK,
	FIELD_SEPARATION_FLOOR,
	FLOOR,
	GRAPHICS,
	GROUNDS,
	GROUNDS6,
	GROUND_RATIO,
	GROUND_STEP_DELTA_E,
	HAIRLINE_RATIO_CEILING,
	HAIRLINE_RATIO_FLOOR,
	HOVER_DELTA_E,
	IDENTITY_PAIR_FLOOR,
	INKS,
	INK_CANVAS_FLOOR,
	INK_STEP_DELTA_E,
	INK_STEP_FLOOR,
	INK_STEP_PINNED,
	KEYCAP_DELTA_E,
	LIFT,
	LINE_SEPARATION_FLOOR,
	LIVENESS_PAIR_FLOOR,
	MEDIA_SURFACE_DELTA_E,
	MEDIA_SURFACE_LIGHTNESS_STEP,
	MESSAGE_SURFACE_DELTA_E,
	MESSAGE_SURFACE_LIGHTNESS_STEP,
	PAIR_PINS,
	PANEL_SEAM_ALPHA,
	PERCEPTIBLE,
	PERCEPTIBLE_EXCEPTIONS,
	REGION_SEPARATION_FLOOR,
	REQUIRED_ROLES,
	ROW_HOVER_CAST_FLOOR_SHARE,
	ROW_HOVER_CHROMA_FLOOR,
	ROW_HOVER_STEP_FLOOR,
	ROW_HOVER_STEP_SHARE_FLOOR,
	ROW_PAIR_SEPARATION,
	ROW_SELECTED_CHROMA_FLOOR,
	ROW_SELECTED_CHROMA_RISE,
	ROW_SELECTED_STEP_CEILING,
	ROW_SELECTED_STEP_FLOOR,
	ROW_STATE_ACCENTLESS,
	ROW_STATE_CHROMA_CAP,
	ROW_STATE_CHROMA_CAP_SLACK,
	ROW_STATE_CHROMA_FLOOR_SLACK,
	ROW_STATE_CHROMA_RANK,
	ROW_STATE_FLOOR_UNREACHABLE,
	ROW_STATE_HOVER_RANK,
	ROW_STATE_HUE_LIMIT,
	ROW_STATE_MEASURED_SHORTFALL,
	ROW_STATE_NEUTRAL_PANEL,
	ROW_STATE_STEP_SLACK,
	ROW_STATE_WASH_FLOOR,
	SEAM_PAIRS,
	SELECTION_DELTA_E,
	SELECTION_LIGHTNESS_STEP,
	SEPARABLE,
	SEPARATION_FLOOR,
	STEP,
	STRUCTURAL,
	SYNTAX_COMMENT_FLOOR,
	SYNTAX_HUE_ROLES,
	TERMINAL_ANSI,
	TERMINAL_PAIRS,
} from "../src/shared/theme-engine/contract-tables.mjs";
import { applyContrast } from "../src/shared/theme-engine/contrast.mjs";
import {
	createRun,
	evaluatePalette,
} from "../src/shared/theme-engine/evaluate.mjs";
import {
	BACKDROP_GRAY,
	GLASS_BLOCK_VEIL_STEP,
	GLASS_EDGE_FLOOR,
	GLASS_INKS,
	GLASS_INK_FLOOR,
	GLASS_LANE_STEP,
	GLASS_OVERLAY_INKS,
	GLASS_ROLES,
	GLASS_STATE_DIM_FLOOR,
	LANE_ALPHA_CEILING,
	derive as deriveGlassFloors,
	deriveOverlayEdgeMix,
	deriveOverlayInkMix,
	composite as glassComposite,
	glassEdge,
	gray as glassGray,
	ratio as glassRatio,
	schemeOf as glassSchemeOf,
} from "./derive-glass-floors.mjs";
import { contrastPresetFromEnv, loadPalettes } from "./palette-source.mjs";

/* ---- 1-4. the floors and what the system permits ------------------------
 *
 * The tables (`FLOOR`, `INKS`, `GROUNDS6`, `LIFT`, `STEP`, `CONTROLS`,
 * `PERCEPTIBLE`, `AS_TEXT`, the pins and the ΔE00 floors) live in
 * `src/shared/theme-engine/contract-tables.mjs`, imported above, so the
 * renderer's theme composition engine holds a composed palette to exactly the
 * floors this gate holds the shipped ones to. The colour maths is in
 * `src/shared/theme-engine/color.mjs` for the same reason, and palette loading
 * lives in palette-source.mjs so this gate and the CSS generator cannot read the
 * same files differently. What stays here is the run: the consulted-pin sets,
 * the pin lookups and `STRUCTURAL_CALL_SITES`, which pins SOURCE text rather
 * than colours and reads files.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/*
 * `LO_CONTRAST_PRESET` runs this gate over the 59 palettes COMPOSED at a contrast
 * value (-100..100; `pnpm check-themes` runs Soft, Gentle, Strong and High after
 * the authored pass) instead of the authored sources. They are composed right
 * after loading (`palettes` below), so every assertion reads the same shape
 * either way; `palette-source.mjs` stays a pure parser, so the evidence gate that
 * also imports it does not pull the engine into its closure. What changes on a
 * composed run is only what is a claim about the AUTHORED values: the L* band
 * (`LIFT`), the §5b fleet rules, the ledger and pin staleness checks and the
 * kit pins. A preset leaves the band by design and is not a member of the fleet;
 * every legibility and perceptibility floor still applies, unrelaxed.
 */
const COMPOSED = contrastPresetFromEnv() !== 0;
const PALETTE_DIR = join(ROOT, "src/renderer/src/shared/themes/palettes");

const STRUCTURAL_CALL_SITES = [
	{
		/*
		 * THE REACTION PILLS WEAR THE FILLS THEIR CONTRACT ROWS MEASURE.
		 *
		 * The CONTROLS rows "team bridge reaction pill" (+ hover) and "team
		 * bridge own reaction pill" (+ hover) prove the VALUES on every palette;
		 * only this pin can see the edit that moves a pill to another role,
		 * which would leave every ratio above green. (The ring the operator asked
		 * to remove is held by the base-class pin below.)
		 *
		 * This REPLACES design round 1's D5 pin ("add-reaction control extent is
		 * its fill", `bg-media-surface` at rest). The operator reversed that design
		 * in the same round: the `+` is now a ghost revealed with its message row,
		 * so its rest state has no fill by decision, and the pin below holds its
		 * hover fill instead.
		 */
		what: "team bridge reaction pills wear their measured fills",
		file: "src/renderer/src/features/team-bridge/team-bridge-reactions.tsx",
		must: '? "bg-accent-wash font-semibold text-accent hover:text-accent-hover"\n\t\t\t\t\t\t\t\t: "bg-elevated text-ink-muted hover:bg-sunken hover:text-ink",',
		why: "the pill rows assert `elevated`/`sunken` for the others' pill and `accent`/`accentHover` on `accentWash` for the reader's own; a pill moved to another role would leave those rows green about a component that no longer wears them",
	},
	{
		what: "the tonal button wears its measured ramp",
		file: "src/renderer/src/shared/components/ui/button.tsx",
		must: '"bg-sunken text-ink",\n\t\t\t\t\t"hover:bg-surface active:bg-hairline",',
		why: "the `tonal button` rows assert `ink` on `sunken`/`surface`/`hairline` on the `elevated` panel; a variant moved to other fills would leave those rows green about a button that no longer wears them",
	},
	{
		what: "team bridge reaction pills stay borderless",
		file: "src/renderer/src/features/team-bridge/team-bridge-reactions.tsx",
		must: '"inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] leading-none transition-colors duration-fast ease-out-quart disabled:text-ink-dim",',
		why: "the operator asked for the `border-control` ring to go (polish round, 2026-10-30); the pill rows declare `edge: false` on that basis, so a ring added back would be a boundary no row measures (agent review round 1, R3)",
	},
	{
		what: "team bridge reaction add takes the pill fill on hover",
		file: "src/renderer/src/features/team-bridge/team-bridge-reactions.tsx",
		must: '"hover:bg-elevated hover:text-ink disabled:text-ink-dim",',
		why: 'the ghost `+` has no fill at rest by design; its hover is the one state with an extent, and the row "team bridge reaction add (hover)" measures `ink` on `elevated` only while the button still names that fill',
	},
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
		 * The download row's own edge, in the state that carries a fill.
		 *
		 * The SAVED state is the consent band's pairing and the band's row covers it. The
		 * REFUSED state is a `dangerWash` row in the same strip, and its edge is what
		 * separates two stacked rows of chrome that are otherwise the same shape: this
		 * row, and the error line under it, are both washes above the page's area. The
		 * palette row above proves `borderControl` clears its floor on the wash's
		 * neighbours; only this pin sees the edit that drops the row's edge to `hairline`
		 * (no floor at all) and lets two washes read as one band.
		 */
		what: "browser file-transfer row edge",
		file: "src/renderer/src/features/browser/components/browser-file-transfer-row.tsx",
		must: "border-control border-b bg-danger-wash",
		why: "the refused row's edge is the only boundary between it and the row below it, both washes; `hairline` has no floor and removing it merges them, and no palette assertion can see either edit",
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
		 * The active tab's three edges. The tab takes the page's own ground - `elevated`
		 * since the drawer's-rung remediation moved the fill and its notch with the
		 * page - whose step away from the strip's `sunken` is a depth cue rather than a
		 * marker (1.18-1.55:1 across the palettes), so the `border-control` edge is what
		 * makes the selected tab survive a glance (design round 3, D18; spec §6).
		 * Reverting it to `border-transparent` (what the tab looked like as a button) or
		 * to `hairline` keeps the palette rows green.
		 */
		what: "browser active tab edges",
		file: "src/renderer/src/features/browser/components/browser-tab-strip.tsx",
		must: "border-control border-x border-t bg-elevated text-ink",
		why: "the active tab's only marker a glance can find is its `border-control` edge; the fill step to the strip is 1.18-1.55:1 across the palettes - a depth cue, not a boundary - so the edge is the whole marker",
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
		 * THE AGENT MARK'S CLASS STRING, at its call site (design review round 2,
		 * D3). The palette row above measures accent against `mediaSurface`; only
		 * this pin can see the edit that stops the plate painting it — swapping the
		 * notch for `bg-hairline`, a ring on the perimeter (which is the app's
		 * FOCUS channel and was round 2's D1 major), or dropping the element
		 * altogether. It is the one part of an agent plate a future endpoint
		 * picture cannot cover, so losing it silently re-opens the visual half of
		 * 2026-10-30's defect with every ratio still green.
		 */
		what: "team bridge agent mark corner notch",
		file: "src/renderer/src/features/team-bridge/team-bridge-profile-card.tsx",
		must: "const AGENT_MARK_SHAPE =",
		/* Pin the shape's VALUE too, not only that the constant exists: the
		   dog-ear, its mirror and its logical anchoring are the mark. */
		also: [
			"[clip-path:polygon(100%_100%,0_100%,100%_0)] rtl:[clip-path:polygon(0_100%,100%_100%,0_0)]",
		],
		why: "the notch is the only agent signal that survives a picture; `data-agent-mark` plus the accent fill and the shape are what make it one, and no palette row can see a plate that stops drawing it",
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
		 *
		 * THE EDGE IS GONE AND THE GROUND MOVED ONE STEP UP (chat redesign §G1,
		 * design round 1 D12). The box used to be `border border-control bg-surface`,
		 * and on the dark brand palette `control` is the accent's own green - so the
		 * composer wore a resting accent ring and was the brightest thing on a screen
		 * whose subject is the transcript. §G1 spends the accent on READY (the send
		 * control's fill) and on FOCUS (the ring the box paints for its textarea), and
		 * separates the panel from its column with the lightness step the system
		 * already has: `elevated` over `canvas`, the pair every menu, popover and
		 * dialog in the app uses.
		 *
		 * The step is FLOORED HERE as well as useful, which is why this row is not
		 * merely a rename: `elevated` against `canvas` is asserted by the palette rows
		 * below at the 1.23 ΔE00 the note above names as the floor's own failure case,
		 * and the mention chip's fill is now measured against `elevated`.
		 */
		what: "composer box ground",
		file: "src/renderer/src/shared/components/composer/message-input.tsx",
		must: '"mx-auto flex w-full flex-col bg-elevated"',
		why: "the mention chip's fill step is measured against the box's own ground and the box's separation from the column is that ground step, not an edge: repainting it `canvas` merges the composer into the transcript and takes the chip's step below its floor in obsidian, and neither is visible in any single file",
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
		/*
		 * THE BUBBLE'S BOUNDARY IS ITS FILL, NOT A RULE (design amendment D10, §L).
		 *
		 * This row used to require `border border-control bg-surface` on the argument
		 * that the border was the edge distinguishing the two speakers, because the
		 * agent side has no bubble at all. That argument was right about the NEED and
		 * wrong about the CHANNEL: the bubble sits on the `canvas` working surface and
		 * takes its own `messageSurface` fill - the role exists because the fill is
		 * this block's ONLY boundary (D10), and the shared `surface` step it first
		 * took measures as low as ΔE00 2.05 across the palettes - and `max-w-[85%]` of
		 * the 640 column makes it an aside by its own width as well. Two channels,
		 * and the rule on top of them was the third and loudest mark on the quietest
		 * object in the transcript: on the palettes where `control` is dark, a settled
		 * turn read as an outlined drawing rather than as a message.
		 *
		 * The pin now takes the fill-form this inventory already supports for a chip
		 * ("the fill IS the chip's boundary"): the two halves of the step are pinned
		 * from both sides - `chat working surface ground` above holds `bg-canvas`, and
		 * this row holds `bg-message-surface` beside it - so repainting either half
		 * still fails, and dropping the fill entirely fails here. The LEGACY twin is
		 * pinned by the next entry: both components render the same block, so pinning
		 * only the canonical half would let `message-paper.tsx` keep the old class.
		 */
		what: "user message bubble fill",
		file: "src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		must: "rounded-frame bg-message-surface text-ink",
		why: "the bubble's ground step against the canvas working surface IS its boundary (§L's D10 amendment), and the fill now carries the role's own ΔE00 4.0 floor - the edge it used to draw was the third and loudest channel on the quietest object in the transcript, and the other half of this pair is pinned by `chat working surface ground`",
	},
	{
		/*
		 * The legacy half of the same block. `message-paper.tsx` renders user turns on
		 * whatever still mounts the legacy path, and its own comment requires the two
		 * components to AGREE on the block's shape - "whichever surface renders, the
		 * turn must not change shape". The fill is part of that agreement now that it
		 * IS the boundary, so it is pinned here rather than left to two comments to
		 * stay in step.
		 */
		what: "legacy user message bubble fill",
		file: "src/renderer/src/features/chat/components/message-item/message-paper.tsx",
		must: "rounded-frame bg-message-surface text-ink break-words",
		why: "the legacy twin renders the same user block with the same fill-by-boundary rule, so a change that moves only the canonical class would leave the two surfaces painting different shapes; no palette assertion can see a class string",
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
		/*
		 * `!option.disabled` joined the condition in review round 1 (U2): a refused
		 * row keeps its `cursor: not-allowed` and its reason but NOT the wash -
		 * the wash is this picker's "you may click this" signal, and painting it on
		 * a row that cannot be picked gave the pointer two contradictory answers.
		 * The pin follows the expression rather than the old spelling: the ROLE the
		 * entry exists for is that a SETTABLE row paints this ground, and the
		 * disabled gate is exactly what the round asked for.
		 */
		must: 'isHovered && !isActive && !option.disabled && "bg-accent-wash"',
		why: "the pointer's mark is deliberately a different ground from the selection's, so the two states are distinguishable and a highlight left by the pointer cannot read as the keyboard's; cleared by the listbox's own onMouseLeave (design D2), and withheld from a refused row (review round 1, U2)",
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
		/* `!option.disabled` joined this arm in review round 1 too (U2); see the
		 * tint entry above for why the gate is the point rather than a drift. */
		must: 'isPicked || (isHovered && !isActive && !option.disabled)) &&\n\t\t\t\t\t\t"outline-solid outline-1 -outline-offset-1 outline-control"',
		why: "the pointer's mark and the in-flight mark must be perceivable in every theme, which a wash-based mark is not: the role it needs is asserted as `picker row pointer mark` above, and this pin is what proves the row renders it (design D12) - for settable rows; a refused row carries neither half (review round 1, U2)",
	},
	{
		what: "turn answer rail role",
		file: "src/renderer/src/features/chat/canonical/turn-answer-rail.ts",
		must: '"-ml-[13px] border-hairline border-l pl-3"',
		why: "PERCEPTIBLE measures hairline against canvas as `turn answer rail`; nothing otherwise proves the rail renders that role, and a swap to a louder or fainter ink would keep the gate green",
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
		 * The SETTINGS SEARCH panel's active row, the same role and the same
		 * ground. Round 1 shipped `bg-action-hover` — a token no palette defines
		 * — so the row Enter would take was invisible in every theme, and a
		 * palette assertion could not see it because the class resolved to
		 * nothing (design round 1, D1). This pin is what makes a dropped class
		 * fail the gate instead of the frame.
		 */
		what: "settings search option active mark",
		file: "src/renderer/src/features/settings/components/settings-search.tsx",
		must: '"bg-accent-wash outline-solid outline-1 -outline-offset-1 outline-control"',
		why: "the active row must be perceivable in every theme; the role is `combobox option active mark`, and this pin proves the panel paints it",
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
		 * measures 9.6 in tokyoNight. Settings now intentionally keeps one flat
		 * resting surface and pins its separate current-page cues below. Strengthening the role
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
		must: '"min-w-0 grow text-start",',
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
		must: 'className={cn(rowStyle, "flex-1 text-start", staged && rowCurrent)}',
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
	/* Settings is intentionally flat at rest, unlike selected conversations.
	 * Pin the roles actually painted so the gate cannot reject the correct tree
	 * or silently accept a return of the retired selected plate. Palette floors
	 * and every chat-row pin remain unchanged; these checks only bind this rail. */
	{
		what: "settings rail continuous resting surface",
		file: "src/renderer/src/features/settings/components/settings-sidebar.tsx",
		must: '"relative flex h-8 w-full items-center rounded-sm bg-transparent text-start text-body-sm hover:bg-row-hover hover:text-ink"',
		why: "Current and inactive Settings destinations intentionally reveal the same surface; persistent selected fill belongs to chat, not this local navigation exception.",
	},
	{
		what: "settings rail current-page ink and weight",
		file: "src/renderer/src/features/settings/components/settings-sidebar.tsx",
		must: 'isActive ? "font-semibold text-ink" : "text-ink-muted"',
		why: "Weight and the stronger ink preserve the current-page cue without reintroducing a filled plate.",
	},
	{
		what: "settings rail current-page accent glyph",
		file: "src/renderer/src/features/settings/components/settings-sidebar.tsx",
		must: 'isActive ? "text-accent" : "text-ink-dim"',
		why: "The glyph must remain legible on both surface and rowHover; the existing global ink and accent floors still apply.",
	},
	{
		what: "settings rail decorative gutter marker",
		file: "src/renderer/src/features/settings/components/settings-sidebar.tsx",
		must: '"absolute start-1 top-1/2 size-1 -translate-y-1/2 rounded-full bg-accent"',
		why: "The absolute dot is a shape cue when collapsed labels disappear, not a new boundary or a flex item that moves its neighbours.",
	},
	{
		what: "settings rail current-only marker",
		file: "src/renderer/src/features/settings/components/settings-sidebar.tsx",
		must: '{isActive && (\n\t\t\t\t\t<span\n\t\t\t\t\t\taria-hidden="true"',
		why: "The gutter cue belongs only to the current page and is decorative, leaving the native button as the sole target and accessible name.",
	},
	{
		what: "settings rail accessible current page",
		file: "src/renderer/src/features/settings/components/settings-sidebar.tsx",
		must: 'aria-current={isActive ? "page" : undefined}',
		why: "A flat resting ground must not remove the nonvisual current-page state.",
	},
	{
		what: "settings rail collapsed accessible name",
		file: "src/renderer/src/features/settings/components/settings-sidebar.tsx",
		must: "aria-label={labelled ? undefined : section.label}",
		why: "Collapsed glyphs need the destination name even while their tooltip is closed.",
	},
	{
		what: "settings rail collapsed tooltip",
		file: "src/renderer/src/features/settings/components/settings-sidebar.tsx",
		must: '<Tooltip content={section.label} side="right">',
		why: "The collapsed rail keeps the existing visible name on pointer and keyboard focus; no interaction handler is changed.",
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
		what: "floating toolbar shell (quote, link, selection and row clusters)",
		file: "src/renderer/src/shared/components/common/floating-toolbar.tsx",
		/*
		 * Verbatim, so it tracks the shell as written. The shell used to live
		 * inline in `quote-toolkit.tsx` and this row pinned that copy; the
		 * operator's "they seem to be slightly different styles" report moved
		 * it here so the quote strip, the link strip, the shared selection
		 * strip and the row's own clusters cannot drift apart again. The
		 * boundary this row protects is the `bg-elevated` ground, and it is
		 * unchanged - only its address is, and (2026-11-06) the stroke that sat
		 * on top of it. A future edit that repaints the shell on the
		 * transcript's canvas now fails here even though it would leave every
		 * palette row green.
		 *
		 * THE HAIRLINE IS GONE ON PURPOSE, not by drift. The operator reported
		 * bordered floating surfaces (tooltip, menus, popovers, dialogs), and
		 * this shell was one of them - wearing the same 1px stroke as the
		 * team-bridge message toolbar, which already separated with
		 * `bg-floating` + `shadow-overlay` and no border at all. So
		 * `shadow-overlay` is now part of the class list this row pins:
		 * elevation, not a line, is what keeps the shell an object over prose.
		 * Dropping the shadow while keeping the ground would leave it edgeless,
		 * and this row is where that fails.
		 */
		must: "flex h-8 items-center gap-1 rounded-md bg-elevated px-1 shadow-overlay",
		why: "the toolkit floats over prose and over a user bubble, so `elevated` plus the one shadow is the whole of what makes it read as an object rather than as text that drifted; repainting it on the transcript's own canvas leaves it invisible against the reading column, and dropping `shadow-overlay` leaves it without the contact layer that darkens its own edge, with every palette row still green",
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
	{
		/*
		 * THE ASIDE PANEL'S FILL AND EDGE, and why this is a call-site pin rather
		 * than a `CONTROLS` row.
		 *
		 * The panel is a SURFACE, not a control: `bg-sunken` with a `hairline`, and
		 * the hairline is the correct weight rather than a shortcut - § 2 makes a
		 * decorative rule owe perceptibility, not 3:1, and a component with no
		 * analogue boundary must not be pushed onto the control floor. A `CONTROLS`
		 * row cannot express that: it requires `max(fillEdge, borderEdge) >= 3:1`
		 * against the ground, and this panel's ground is the chat column's, one
		 * rung away from `sunken` by design (`elevated` -> `surface` -> `sunken` is
		 * a ladder, not a boundary). Listing it there would either fail the floor or
		 * force the panel onto `border-control`, which is the conflation § 2 exists
		 * to prevent.
		 *
		 * WHAT THIS PIN ACTUALLY GUARDS is the merge, and it is the same class of
		 * edit the neighbouring composer-box row guards from the other side: the
		 * panel sits DIRECTLY ABOVE the composer box, which IS `bg-surface`. Delete
		 * the edge or repaint the fill `surface` and the two become one slab, while
		 * every ratio in this file stays green - the panel's inks on `sunken` are
		 * already asserted by the INKS loop, so nothing else here can see it.
		 */
		what: "aside panel fill and edge",
		file: "src/renderer/src/features/chat/components/aside-panel.tsx",
		must: "flex flex-col border border-hairline bg-sunken",
		why: "the panel is a surface above the composer box and reads as one only while its fill steps away from that box's `surface` and its decorative edge is drawn; `CONTROLS` cannot hold this row (it demands a 3:1 edge on a boundary that is deliberately not one), so the class list is the only place the relationship can be undone unseen",
	},
	{
		/*
		 * The condensed action group's media tile: THE EDGE RETURNS WHERE THE TILE IS
		 * A CONTROL (design review round 1, D2; re-decided by the operator's "drop the
		 * ring" change, where the design round's D1 recorded the trade).
		 *
		 * The tile IS a focusable `<button>`, so when its edge is drawn it is a control
		 * boundary and answers to 3:1 (SC 1.4.11) rather than to taste. The palette
		 * rows above already prove the COLOUR clears the floor - "outline control"
		 * measures `borderControl` on all four grounds - and what only this pin can
		 * see is the edit that puts the returning edge on the decorative `hairline`
		 * (1.25:1 against the light transcript, no floor) or drops the focus half: a
		 * keyboard reader has NO other resting boundary on a borderless tile: the
		 * tile's resting EXTENT is the fill role pinned below, but the edge is still
		 * the only CONTROL boundary the focus state draws, so the `focus-visible` arm
		 * is the one that must not be deleted unseen.
		 */
		what: "condensed group media tile edge (hover and keyboard focus)",
		file: "src/renderer/src/features/chat/components/message-item/attachment-frame.tsx",
		must: '"group-hover/tile:border-control group-focus-visible/tile:border-control"',
		why: "a media tile is a button whose edge now appears only on hover and keyboard focus; dropping either arm, or moving it to `hairline`, leaves the pair green in every palette row while the tile loses the boundary of the state in which it is a control, which no ratio in this file can see",
	},
	{
		/*
		 * THE TILE'S RESTING EXTENT IS THE FILL ROLE, and this pin is what keeps
		 * the class wearing it. The `mediaSurface` palette rows prove the VALUE
		 * clears the floor on every palette; nothing there can see which class the
		 * component renders, so a `bg-media-surface` -> `bg-sunken` (or to a ground
		 * role) edit would leave every ratio green while the borderless tile goes
		 * back to an extent a page-toned picture does not have (2.00 ΔE00 at its
		 * worst). The reserved `border-transparent` is pinned with it because the
		 * two are one decision: the fill carries the resting extent BECAUSE the
		 * edge's pixel is reserved, not drawn, at rest.
		 */
		what: "condensed group media tile fill",
		file: "src/renderer/src/features/chat/components/message-item/attachment-frame.tsx",
		must: '"bg-media-surface",\n\t\t\t\t\t\t"border border-transparent",',
		why: "the borderless tile's only resting extent is its fill, floored by `mediaSurface` (ΔE00 >= 4.0 off `canvas` on every palette); swapping the fill back to the shared `sunken` well or onto a ground role leaves every palette assertion green while the tile loses the extent the fill role exists for, and un-reserving the border pixel takes the no-reflow property with it",
	},
	{
		/*
		 * The failed receipt keeps the edge AT REST: a card in a state keeps its edge
		 * because the state is the information, and with no picture the receipt has no
		 * other extent (branding section 2). It also keeps the shared `sunken` well
		 * while a working tile wears `mediaSurface`: its boundary is the edge, so the
		 * fill role's trade does not apply, and the glyph's ink floors are asserted
		 * on `sunken`.
		 */
		what: "condensed group failed-tile receipt edge",
		file: "src/renderer/src/features/chat/components/message-item/attachment-frame.tsx",
		must: "rounded-sm border border-control bg-sunken",
		why: "the compact receipt has no picture to give it an extent, so its `border-control` is its only boundary; removing it with the working tile's edge (which the operator asked to drop) would leave a bare glyph in a well",
	},
	{
		/*
		 * THE SUPPLEMENT GRID'S GLYPH RECEIPT (operator decision 2026-10-16): the
		 * tile whose thumbnail cannot load keeps its slot as the file-kind glyph on
		 * the receipt triple — `border-control` + `sunken` — for the same reason
		 * `attachment-frame.tsx`'s compact receipt does, and it is a SEPARATE pin
		 * because that one greps a different file: an edit here could drop the edge
		 * or move the glyph onto the `mediaSurface` fill (whose ink floors the
		 * receipt deliberately does not wear; the glyph's `ink-dim` falls under its
		 * 5.0:1 floor on several light palettes there) and leave every palette
		 * assertion green.
		 */
		what: "supplement image grid glyph receipt edge",
		file: "src/renderer/src/features/chat/canonical/supplement-image-grid.tsx",
		must: "flex h-[78px] w-[117px] items-center justify-center rounded-sm border border-control bg-sunken text-ink-dim",
		why: "a failed thumbnail keeps its slot as the receipt triple; dropping the edge or the `sunken` well leaves every palette ratio computed for the working tile green while the receipt loses its only boundary and its glyph slides under its floor on the media fill",
	},
	{
		/*
		 * THE SUPPLEMENT GRID'S WORKING TILE wears the SAME control-boundary recipe
		 * the condensed group's strip does (`AttachmentFrame boundary="control"`,
		 * whose classes the two pins above and the `mediaSurface` palette rows
		 * assert) — this pin is what keeps THIS call site from quietly falling back
		 * to the default `hairline` frame, which would repaint the tile `sunken`
		 * with a decorative edge and read as a different object in the app.
		 */
		what: "supplement image tile wears the control-boundary recipe",
		file: "src/renderer/src/features/chat/canonical/supplement-image-grid.tsx",
		must: 'boundary="control"',
		why: "the tile's fill and returning edge live in `AttachmentFrame`'s `control` boundary; a call site that drops to the default `hairline` frame repaints the well and swaps the control edge for decoration with no palette assertion able to see which boundary a caller chose",
	},
	{
		/*
		 * THE SUPPLEMENT TILE'S MENU TRIGGER (the overlay half of
		 * `supplement-file-actions.tsx`): a menu that floats over picture pixels
		 * wears the `accentWash` chip `image-actions-menu.tsx` measured and set — the
		 * bare ellipsis failed the 3:1 icon floor over a dark picture (1.63:1). The
		 * palette row "image actions trigger" asserts the pair (`inkMuted` on
		 * `accentWash`); only this pin can see that THIS call site keeps the chip.
		 */
		what: "supplement file menu trigger chip over picture pixels",
		file: "src/renderer/src/features/chat/canonical/supplement-file-actions.tsx",
		must: 'className="bg-accent-wash"',
		why: "the overlay trigger exists so the glyph reads against a token on every surface; removing the chip returns it to whatever pixels the picture paints, under the 3:1 icon floor, with no palette assertion able to see which class a component renders",
	},
	{
		/*
		 * THE STATUS BAND'S REMEDY, the same class of pin as the failure alert's
		 * above and mirrored from it deliberately: the palette rows
		 * ("primary button on the danger wash", "primary remedy on the warning
		 * wash") prove a filled control is legal on each wash the band paints,
		 * and only this pin can see the edit that moves the strip's Retry back to
		 * `secondary` - whose sole boundary is `border-control` against those
		 * washes, 2.09:1 worst on `warningWash` and 2.98:1 worst on `dangerWash`,
		 * both under the 3:1 floor (measured over all fifty-nine palettes by the
		 * design pass; the twelve-name sweep carries the same figures).
		 */
		what: "the status strip's remedy is a filled control on its wash",
		file: "src/renderer/src/features/chat/components/chat-status-strip.tsx",
		must: 'variant="primary"',
		why: "a secondary control's only boundary is its own edge against the band's wash, which is below the 3:1 floor on both severities in the worst palettes; no palette assertion can see which variant a component renders, so green output about the pair would outlive the fix",
	},
	{
		/*
		 * The compatibility banner's remedy, for the same reason: the band is one
		 * grammar on both surfaces now, and a divergence in the CONTROL is what a
		 * reader would see first - the banner's `Update backend` must stay a filled
		 * control where it is offered, with `Retry` demoted to `ghost` beside it
		 * rather than given a second edge.
		 */
		what: "the compatibility banner's remedy is a filled control on its wash",
		file: "src/renderer/src/shared/components/common/backend-compatibility-banner.tsx",
		must: 'variant="primary"',
		why: "the banner's band draws the same washes as the strip's; an outlined or secondary primary control collapses into them below the 3:1 floor, and the palette rows cannot see which variant the component renders",
	},
	{
		/*
		 * The checkpoint rail tick's fill, at its call site.
		 *
		 * The GRAPHICS row of the same name proves `inkDim` clears the floor on
		 * `canvas`; only this pin can see the edit that repaints the rest mark in
		 * a role nothing floors — `inkDisabled` (exempt from every floor by `§ 6`,
		 * the role the usage mark above actually shipped in) or `hairline` (capped
		 * below 2:1 by design). Either edit keeps every palette assertion green
		 * while the rail's ticks stop being findable. The class string lives in
		 * `checkpoint-model.ts`'s role map (the dsh rework extracted it from the
		 * component); the pin follows the string, not the file it used to sit in.
		 */
		what: "checkpoint rail tick fill",
		file: "src/renderer/src/features/chat/canonical/checkpoint-model.ts",
		must: "bg-ink-dim",
		why: "the tick's fill is its whole visible affordance — a mark with no label and no edge — so repainting it to a floor-exempt role erases the rail's navigation with no palette assertion able to see it",
	},
	{
		/*
		 * The search overlay's ACTIVE result row, at its call site.
		 *
		 * The row Enter opens is the one the reader is deciding about, and the
		 * family's own history is why this pin exists: a selection carried by
		 * `accent-wash` alone is ΔE00 0.77 on `elevated` in obsidian (1.014:1) —
		 * the defect D12 records for the picker and the slash popup — so the wash
		 * is paired with a 2px `accent` bar on the leading edge, the same second
		 * signal `slash-commands.tsx` and `at-picker.tsx` draw. The bar is the
		 * non-luminance mark, so the pin holds the composed class: dropping the
		 * bar leaves every palette row green while the row Enter will open stops
		 * being distinguishable in the themes the wash collapses in.
		 */
		what: "search result row active mark",
		file: "src/renderer/src/features/chat/canonical/thread-search-overlay.tsx",
		must: "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent",
		why: "the active row's fill is a wash that collapses onto the panel's own ground in four of twelve themes; the 2px accent bar is its second, non-luminance signal, and only this pin can see the class string that draws it",
	},
	{
		/*
		 * The marked runs inside a result's snippet.
		 *
		 * `bg-accent-wash text-ink` is the app's find-match idiom (the WYSIWYG
		 * editor's `FIND_MATCH_CLASS`), and the ink half is what keeps it legal:
		 * the INKS loop asserts `ink` on `accentWash` at the strong-text floor.
		 * The rest of the string is deliberately pinned too, because the frames
		 * proved the fill cannot carry the mark alone: on the panel's `elevated`
		 * ground the wash measures ΔE00 0.77 in obsidian (2 mentions of the
		 * matched word, no mark), so the ACCENT UNDERLINE is the signal that
		 * cannot collapse — `accent` is asserted at the 3:1 structural floor on
		 * every ground by this file's `STRUCTURAL` list — and `font-medium` is
		 * what keeps the mark readable on the two row states whose fill is the
		 * same wash. A repaint that keeps the fill but drops the underline or
		 * the weight keeps every palette assertion green while the match stops
		 * being findable in four of twelve themes.
		 */
		what: "search match mark in a snippet",
		file: "src/renderer/src/features/chat/canonical/thread-search-overlay.tsx",
		must: "bg-accent-wash font-medium text-ink underline decoration-accent decoration-2 underline-offset-2",
		why: "the match mark is the one place the query's own characters are shown, and a wash-only mark is invisible on the panel's own ground in the themes the neighbour pin lists; the accent underline is the non-luminance half and the weight covers the row states that share the wash",
	},
	{
		/*
		 * The setup rail's two working marks - one pin per site, because a substring
		 * check cannot see WHICH occurrence of a shared class string survived and a
		 * single pin would stay green while the other site regressed (design round
		 * 2, D7). Under `hairline` the two measured 1.22-1.50:1 against the waiting
		 * rings' 3.13-3.42:1: the mark that says "working" was the faintest object
		 * in the column, and no palette row can see which token the class picked.
		 * The palette half of the pair is the `installer rail ring markers` row.
		 */
		what: "the installer rail's running mark stroke",
		file: "src/renderer/src/features/installer/components/installer-panel.tsx",
		must: "size-3 animate-install-turn rounded-full border-2 border-control border-t-accent",
		why: "the running mark is a stroke with no fill, so this token is its only boundary; `hairline` here was 1.22:1 against the waiting rings' 3.13-3.42:1, and only this pin sees the class edit the palette row cannot",
	},
	{
		what: "the installer rail's head mark stroke",
		file: "src/renderer/src/features/installer/components/installer-panel.tsx",
		must: "animate-install-turn absolute -top-2.5 left-0.5 size-3 rounded-full border-2 border-control border-t-accent",
		why: "the head mark is the running mark at the rail's head - the same object in the same stroke - and a single pin would stay green while this site regressed",
	},
];

/* ---- 5. the run --------------------------------------------------------- */

/* The per-palette run state and the assertion loop live in
 * src/shared/theme-engine/evaluate.mjs (see its header): the composition engine
 * evaluates one palette at a time with the same code. This file holds the
 * fleet, the stylesheet-reading sections and the report, on the same run. */
const run = createRun({ composed: COMPOSED });
const {
	log,
	fail,
	exceptionSeen,
	perceptibleSeen,
	pairPinSeen,
	inkStepSeen,
	inkStepPinSeen,
	controlEdgeSeen,
	controlEdgeKey,
	pinClaims,
} = run;

const CONTRAST = contrastPresetFromEnv();
const palettes =
	CONTRAST === 0
		? loadPalettes()
		: loadPalettes().map((e) => ({
				...e,
				palette: applyContrast(e.palette, CONTRAST, { id: e.id }).palette,
			}));

if (palettes.length === 0) {
	console.error(`No palettes found in ${PALETTE_DIR}`);
	process.exit(1);
}

for (const entry of palettes) evaluatePalette(run, entry);

/*
 * THE ALPHA THE GATE MEASURES MUST BE THE ALPHA THE PRODUCT PAINTS (QA round 1,
 * Q-3). `PANEL_SEAM_ALPHA` above is what every assertion in the palette loop used,
 * but the shipped colour is the class string in `panel-edge.tsx`. While the two
 * were separate literals, a class edit to `bg-hairline/40` left all of these
 * assertions green (measured by QA: the full 187,924, no failure). Reading the
 * class back here makes the gate measure the pixel that ships; exactly one
 * `bg-hairline/<number>` in that file, carrying this percentage, or the gate
 * fails.
 */
{
	const source = readFileSync(
		join(ROOT, "src/renderer/src/shared/components/common/panel-edge.tsx"),
		"utf8",
	);
	const alphas = [...source.matchAll(/\bbg-hairline\/(\d+)\b/g)].map((m) =>
		Number(m[1]),
	);
	run.assertions++;
	const shipped = alphas.length === 1 ? alphas[0] : null;
	if (shipped !== Math.round(PANEL_SEAM_ALPHA * 100)) {
		fail(
			`panel-edge.tsx paints ${
				alphas.length === 0
					? "no `bg-hairline/<alpha>` class"
					: `\`bg-hairline/${alphas.join(", ")}\``
			} but this gate measures \`PANEL_SEAM_ALPHA ${PANEL_SEAM_ALPHA}\` - the class that ships and the number every seam assertion used must be one value`,
		);
	}
}

/* ---- 5a. the Team Bridge arrival band ----------------------------------- */

/*
 * The band's per-palette assertions (its washed-row inks and its rank over
 * `rowSelected`/`rowHover`) live in `evaluatePalette`, at
 * `ARRIVAL_BAND_ALPHA` from `contract-tables.mjs` (agent review round 1, M1
 * on #1674): the composition engine's solvers use that evaluator as their
 * oracle, so a rank asserted only here let a custom accent through that this
 * gate rejects (nightfox + #FF0000 at Standard). What stays here is the part
 * that reads the stylesheet, which the renderer-safe evaluator cannot:
 *
 * THE ALPHA IS READ FROM THE STYLESHEET, NOT MIRRORED (agent review round 3,
 * n1). A constant kept in step by a comment is a claim, not a gate: the mix could
 * be retuned in `index.css` and the evaluator would keep measuring last week's
 * band. The rule below is parsed and must carry `ARRIVAL_BAND_ALPHA`, and it
 * FAILS CLOSED - an unreadable alpha means the band is unmeasured, which is the
 * state this section exists to prevent. The lift rule is checked the same way,
 * because the ink floor is only true while the stylesheet actually lifts the
 * washed row's dim utilities. (Neither check counts an assertion, as before the
 * move, so the Standard count is unchanged.)
 */
{
	const source = readFileSync(
		join(ROOT, "src/renderer/src/styles/index.css"),
		"utf8",
	);
	const rule =
		source.match(/\.lo-team-bridge-target::after\s*\{[^}]*\}/)?.[0] ?? "";
	const mix = rule.match(
		/color-mix\(in srgb, var\(--color-accent\)\s+([\d.]+)%, transparent\)/,
	);
	if (!mix) {
		fail(
			"the arrival band's mix could not be read from `.lo-team-bridge-target::after` in `src/renderer/src/styles/index.css`, so the band is unmeasured — keep the rule readable (`color-mix(in srgb, var(--color-accent) N%, transparent)`) or teach this section its new spelling",
		);
	} else if (Number(mix[1]) / 100 !== ARRIVAL_BAND_ALPHA) {
		fail(
			`\`.lo-team-bridge-target::after\` paints the arrival band at ${mix[1]}% but the evaluator measures \`ARRIVAL_BAND_ALPHA ${ARRIVAL_BAND_ALPHA}\` - the rule that ships and the number every band assertion used must be one value`,
		);
	}
	/*
	 * The lift is matched by its DECLARATION, not its selector (agent review round
	 * 4, m1): the reduced-motion block repeats the same selector with only
	 * `animation: none`, so a selector-only test kept passing with the lift itself
	 * deleted. A rule body that sets `color: var(--color-ink-muted)` is the only
	 * thing that actually puts `ink-muted` on the band.
	 */
	if (
		!/\.lo-team-bridge-target \[class~="text-ink-dim"\]\s*\{[^}]*color:\s*var\(--color-ink-muted\)/.test(
			source,
		)
	) {
		fail(
			'the washed row\'s ink lift is gone from `index.css` (`.lo-team-bridge-target [class~="text-ink-dim"]`), so `inkDim` would be read on the band at the floor below — restore the lift or re-measure this section',
		);
	}
}

/*
 * THE FLEET RULES AND THE WINDOW GLASS ARE AUTHORED-ONLY. Both sections below
 * assert claims about the AUTHORED palettes: the fleet rules are relations
 * BETWEEN the 59 shipped canvases (a preset moves every one of them on purpose,
 * and a user's composed theme is nobody's fleet member), and the glass alpha
 * floors in `window-glass-floors.json` are DERIVED from the authored palettes
 * (`derive-glass-floors.mjs`). On a composed run (`LO_CONTRAST_PRESET`) their
 * assertions go to a discarded run instead of this one, so the sections still
 * execute - a crash in them still fails the leg - but neither their count nor
 * their verdict is reported as if it were about composed palettes. The
 * authored-table scope is deliberate: live compositions now derive their OWN
 * table through `src/shared/glass-derivation.mjs`, shared with this tool's
 * authored solver. `scripts/composed-glass.test.mjs` separately drives the actual
 * renderer paint inputs against composed values, state overlays and sticky
 * backgrounds; the authored fleet table below is not a composed-glass claim.
 */
const authoredRun = COMPOSED ? createRun({ composed: true }) : run;

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
/*
 * THE DARK REGISTER WAS RE-BASELINED WHEN THE BAND MOVED (2026-11-03, the
 * darker-grounds pass, `docs/branding.md` § 2). The dark canvas band went from
 * [12, 22] to [9, 15], and every canvas was re-lit by ONE proportional map,
 * `L*_new = 9 + 0.6 x (L*_old - 12)`, rather than clamped into the new band. A
 * clamp would have stacked every palette above L* 15 on the ceiling, which is
 * the "everything went the same grey" report this section exists for. The map
 * itself preserves each palette's order and multiplies every gap by 0.6; the
 * hand re-solves then move 34 canvases off it by up to +-1.04 L* (radient
 * +1.04, gruvbox +0.89, rosePine +0.82), which inverts 45 of the 820 dark
 * pairs, the widest by 0.96 L* (radient/outrun). Every inverted pair is held
 * at least ΔE00 1.0 apart, except the counted sub-1.0 pairs below.
 *
 * So the dark rules below are the old rules read through the same map, not new
 * targets: an `L*` WIDTH scales by 0.6 (the 1.5 window is 0.9, the 9.5 spread
 * floor is 5.7), an `L*` POSITION maps through the formula (13.5 is 9.9), and a
 * COUNT keeps its ceiling, because the map preserves which palettes share a
 * window. Measured at the darker-grounds head: 14 in the widest 0.9 window (max
 * 14), 13 below L* 9.9 (max 14), spread 5.87, 6 in the mapped upper register. The identity rules that are about pairs
 * of colours rather than altitude (sub-1.0 pairs, byte-identical pairs, the
 * near-neutral ladder, the chroma guard on moved values) are unchanged and hold
 * at their old ceilings, so "two themes became the same grey" is still red.
 */
const FLEET_DARK_LIFT_SCALE = 0.6;
/** 1.5 x 0.6: the same register, read through the proportional map. */
const FLEET_DARK_WINDOW = FLEET_WINDOW * FLEET_DARK_LIFT_SCALE;
/** Measured 14 in a 0.9 window at the re-lit head (14 in 1.5 before); no headroom. */
const FLEET_DARK_WINDOW_CEILING = 14;
/** 13.5 mapped: 9 + 0.6 x (13.5 - 12). The register the identity pass emptied. */
const FLEET_DARK_DEEP_L = 9 + FLEET_DARK_LIFT_SCALE * (13.5 - 12);
/** Measured 13 below L* 9.9 at the re-lit head; the ceiling stays the old 14. */
const FLEET_DARK_DEEP_CEILING = 14;
/** Measured 5 (`origin/main` 7); the spec's target is 0. */
const FLEET_DARK_SUB1_CEILING = 5;
/** Measured 2 (`origin/main` 3); the spec's target is 0. */
const FLEET_DARK_IDENTICAL_CEILING = 2;
/*
 * The register the near-neutral palettes' identity is carried by, read through
 * the same map as every rule above: the old L* 18-22 maps to
 * 9 + 0.6 x (18 - 12) = 12.6 and 9 + 0.6 x (22 - 12) = 15.0, which is the top of
 * the new band. The map preserves which palettes share a register, so the four
 * that held it before (catppuccinFrappe, everforest, nord, palenight) still do,
 * now joined by oneDark and rosePine: measured 6 at the darker-grounds head.
 * The floor stays at 4 (the spec's target is 5), because the count ceilings
 * and the spread floor cannot see this register draining: with at most 14 per
 * 0.9 window and a 5.7 spread, the top could fall to one canvas and stay green.
 */
const FLEET_DARK_UPPER_LO = 9 + FLEET_DARK_LIFT_SCALE * (18 - 12);
const FLEET_DARK_UPPER_HI = 9 + FLEET_DARK_LIFT_SCALE * (22 - 12);
/** Measured 6 at the darker-grounds head (4 in L* 18-22 before it); the spec's target is `>= 5`. */
const FLEET_DARK_UPPER_FLOOR = 4;
/** 9.5 x 0.6, measured 5.87 at the darker-grounds head (9.95 before); a floor, not a target. */
const FLEET_DARK_SPREAD_FLOOR = 9.5 * FLEET_DARK_LIFT_SCALE;
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
	darkWindow: widestRegister(darkFleet, FLEET_DARK_WINDOW),
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
authoredRun.assertions++;
if (state.darkWindow > FLEET_DARK_WINDOW_CEILING) {
	authoredRun.fail(
		`the fleet: ${state.darkWindow} dark canvases sit inside one ${r2(FLEET_DARK_WINDOW)} L* window (max ${FLEET_DARK_WINDOW_CEILING}; it was 25 in a 1.5 window before the identity re-solve) - the fleet has been flattened toward one grey band again, which every per-palette assertion above will still pass`,
	);
}
authoredRun.assertions++;
if (state.darkDeep > FLEET_DARK_DEEP_CEILING) {
	authoredRun.fail(
		`the fleet: ${state.darkDeep} dark canvases are below L* ${r2(FLEET_DARK_DEEP_L)} (max ${FLEET_DARK_DEEP_CEILING}, was 25 before the identity re-solve) - the deep register is the one the pass emptied, and refilling it is how the operator's "a lot more grey now" comes back`,
	);
}
authoredRun.assertions++;
if (state.darkSpread < FLEET_DARK_SPREAD_FLOOR) {
	authoredRun.fail(
		`the fleet: the dark canvases span ${r2(state.darkSpread)} L* (floor ${r2(FLEET_DARK_SPREAD_FLOOR)}, measured 5.87 at the darker-grounds head, against 9.95 before it) - the spread is the fleet's depth, and a per-palette gate cannot see it narrowing`,
	);
}
authoredRun.assertions++;
if (state.darkSub1.length > FLEET_DARK_SUB1_CEILING) {
	authoredRun.fail(
		`the fleet: ${state.darkSub1.length} dark canvas pairs are under ΔE00 1.0 (max ${FLEET_DARK_SUB1_CEILING}, was 7 before the identity re-solve; the spec's target is 0): ${state.darkSub1.map((pair) => `${pair.a}/${pair.b} ${r2(pair.got)}`).join(", ")} - two themes whose page grounds are the same colour read as one theme with a different accent`,
	);
}
authoredRun.assertions++;
if (state.darkIdenticalPairs.length > FLEET_DARK_IDENTICAL_CEILING) {
	authoredRun.fail(
		`the fleet: ${state.darkIdenticalPairs.length} dark canvas pairs are BYTE-IDENTICAL (max ${FLEET_DARK_IDENTICAL_CEILING}, was 3 before the identity re-solve; the spec's target is 0): ${state.darkIdenticalPairs.map((pair) => `${pair.a}/${pair.b} ${pair.hex}`).join(", ")} - a palette that ships another palette's exact canvas has no depth of its own`,
	);
}

authoredRun.assertions++;
if (state.darkUpper < FLEET_DARK_UPPER_FLOOR) {
	authoredRun.fail(
		`the fleet: ${state.darkUpper} dark canvases sit in the L* ${r2(FLEET_DARK_UPPER_LO)}-${r2(FLEET_DARK_UPPER_HI)} register (floor ${FLEET_DARK_UPPER_FLOOR}, measured 6 at the darker-grounds head; the spec's target is 5) - this is the register the near-neutral palettes' identity is carried by, and losing recruits to it is the same flattening seen from the other end`,
	);
}

/*
 * The light mirror, and it is not exempt (D14). The ceiling at L* 94 clamped the
 * light family and left it compressed against a wall, which is the dark fleet's
 * problem at the other end of the ramp.
 */
authoredRun.assertions++;
if (state.lightWindow > FLEET_LIGHT_WINDOW_CEILING) {
	authoredRun.fail(
		`the fleet: ${state.lightWindow} light canvases sit inside one ${FLEET_WINDOW} L* window (max ${FLEET_LIGHT_WINDOW_CEILING}; the spec's ceiling is 8) - the light family is compressed against the L* 94 wall and has to be counted as carefully as the dark one`,
	);
}
authoredRun.assertions++;
if (state.lightHigh > FLEET_LIGHT_HIGH_CEILING) {
	authoredRun.fail(
		`the fleet: ${state.lightHigh} light canvases sit at L* ${FLEET_LIGHT_HIGH_L} or above (max ${FLEET_LIGHT_HIGH_CEILING}; the spec's ceiling is 9) - the ceiling is what squeezed them here, so this is the number to watch before moving it`,
	);
}
authoredRun.assertions++;
if (state.lightSub1 > FLEET_LIGHT_SUB1_CEILING) {
	authoredRun.fail(
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
authoredRun.assertions++;
if (neutralPairs.length > FLEET_NEAR_NEUTRAL_PAIRS_CEILING) {
	authoredRun.fail(
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
	authoredRun.assertions++;
	if (!palette) {
		authoredRun.fail(
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
		authoredRun.assertions++;
		movedValuesSeen++;
		if (!isHex(pre)) {
			authoredRun.fail(
				`the fleet: \`${role}\`'s pre value ${pre} in \`REGISTER_MOVES\` is not an 8-bit colour - the table has to carry the hex the palette shipped before the move`,
			);
			continue;
		}
		if (!isHex(post)) {
			authoredRun.fail(
				`the fleet: \`${role}\` is in \`REGISTER_MOVES\`' pre-values and has no colour value on the palette (\`${post}\`) - the move this entry records no longer exists, so neither does the value it holds`,
			);
			continue;
		}
		if (post.toLowerCase() === pre.toLowerCase()) {
			authoredRun.fail(
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
		authoredRun.assertions++;
		if (gotHue > pin) {
			authoredRun.fail(
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
			authoredRun.assertions++;
			if (!MOVED_BEYOND_LIGHTNESS.has(role)) {
				authoredRun.fail(
					`the fleet: \`${role}\` ${post} has no in-gamut pure-L* re-solve at L* ${r2(postL)} on ${pre}'s cast, and it is not named in \`MOVED_BEYOND_LIGHTNESS\` - name it with its reason or re-author the value`,
				);
			} else {
				movedBeyondLightnessSeen.add(role);
			}
			continue;
		}
		const step = channelStep(post, reSolved);
		authoredRun.assertions++;
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
				authoredRun.fail(
					`the fleet: \`${role}\` ${pre} -> ${post} sits ${step} 8-bit channel step(s) from its pure-L* re-solve ${reSolved} (max ${MOVED_CHANNEL_STEP_TOLERANCE}) - the role's own file says only lightness moved, so a value past one step has been re-authored in hue or chroma as well`,
				);
			}
		}

		/* Chroma may be scaled by quantisation, but it may not be spent. */
		authoredRun.assertions++;
		if (postChroma < MOVED_CHROMA_FLOOR * preChroma) {
			authoredRun.fail(
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
	authoredRun.fail(
		`the fleet: \`MOVED_BEYOND_LIGHTNESS\` names ${staleBeyondLightness.join(", ")} and the walk never consulted ${staleBeyondLightness.length === 1 ? "it" : "them"} - the pure-L* re-solve is back inside sRGB, or the role is no longer a moved value; delete the entry rather than carrying an exemption nothing needs`,
	);
}

/*
 * And the population the walk above claims to hold. "0 outside the envelope over
 * the whole move set" is a claim about a population, so the population itself is
 * asserted rather than assumed: a table that has quietly lost a value is a rule
 * covering less than the fleet line says it covers.
 */
authoredRun.assertions++;
if (movedValuesSeen !== MOVED_VALUE_COUNT) {
	authoredRun.fail(
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
	authoredRun.assertions++;
	if (!pinClaims.has(`${row.id}:${row.role}:floor`)) {
		authoredRun.fail(
			`the fleet: the floor row for \`${row.id}\`'s \`${row.role}\` is stale — the cast floor is no longer above the ceiling there, so the row is excusing a bound the palette now holds. Re-author the value to the floor, or delete the row (${row.reason})`,
		);
	}
}
for (const row of ROW_STATE_MEASURED_SHORTFALL) {
	authoredRun.assertions++;
	if (!pinClaims.has(`${row.id}:${row.role}:${row.bound}`)) {
		authoredRun.fail(
			`the fleet: the ${row.bound} row for \`${row.id}\`'s \`${row.role}\` is stale — it records ${row.measured} and the palette no longer misses that bound (${row.reason})`,
		);
	}
}

/* ---- 5b. the window glass (optional translucency), asserted before the report so a violation FAILS the run ---- */

/*
 * THE WINDOW GLASS'S ALPHA FLOORS (`src/shared/window-glass-floors.json`).
 *
 * Everything above measures FLAT hexes, and the file's own header says it "cannot
 * see an alpha composite". The optional translucent window is exactly that: a role
 * painted at alpha A over an OS material nobody here controls. So the one thing
 * this contract can say about it is the floor - the smallest alpha at which ink
 * still clears AA on every palette over the worst MEASURED backdrop of each
 * material - and the committed table must not sit below it. A palette added or
 * edited so that its ink needs more alpha than the table grants fails HERE, not on
 * somebody's wallpaper. The derivation, and the backdrop measurements it rests on,
 * are in `scripts/derive-glass-floors.mjs`; it prints the replacement table.
 */
{
	const committed = JSON.parse(
		readFileSync(join(ROOT, "src/shared/window-glass-floors.json"), "utf8"),
	).alphaFloor;
	const derived = deriveGlassFloors();
	for (const tier of Object.keys(derived)) {
		for (const scheme of ["dark", "light"]) {
			for (const role of GLASS_ROLES) {
				authoredRun.assertions++;
				const have = committed?.[tier]?.[scheme]?.[role];
				const need = derived[tier][scheme][role];
				if (typeof have !== "number" || have < need) {
					authoredRun.fail(
						`window glass floor ${tier}/${scheme}/${role} is ${have} but the ${scheme} palettes need ${need} for AA ink over the worst measured backdrop - run \`node scripts/derive-glass-floors.mjs\` and commit the table (never hand-lower it)`,
					);
				}
			}
		}
	}
}

/*
 * THE GLASS STATES AND CONTROLS, as COMPONENT TRIPLES on the composite (this
 * file's own rule: ground + fill + border + ink, not token pairs). For every
 * palette, each glass tier, at the COMMITTED floors, over the worst measured
 * backdrop, on each ground a control can sit on (`surface`, `canvas`):
 *
 *   - "glass text field": the field overlay (ink at `stateAlpha.field`) over the
 *     ground composite, `ink` and `inkMuted` AA and `inkDim` (placeholder) at the
 *     stated relaxed floor on the fill, and the glass edge (`borderControl` mixed
 *     toward `ink` by `controlMix`) 3:1 against the GROUND it is drawn on.
 *   - "glass row hover" / "glass row selected": the overlay at its alpha, the same
 *     ink floors on the result, and the step ΔE00 off the ground at its floor, so a
 *     state cannot vanish over a bright desktop.
 *   - "glass focus ring": `accent` 3:1 against the composite ground (an outline is
 *     drawn straight over the glass).
 * The flat controls' own rows above are unchanged and still hold: glass only
 * applies inside `html[data-glass]`.
 */
{
	const committed = JSON.parse(
		readFileSync(join(ROOT, "src/shared/window-glass-floors.json"), "utf8"),
	);
	const STEP = { hover: 1.5, selected: 2.5, field: 1.5 };
	const stepMin = {
		hover: Number.POSITIVE_INFINITY,
		selected: Number.POSITIVE_INFINITY,
		field: Number.POSITIVE_INFINITY,
	};
	for (const { id, palette } of palettes) {
		const scheme = glassSchemeOf(palette);
		for (const [tier, byScheme] of Object.entries(BACKDROP_GRAY)) {
			const floors = committed.alphaFloor[tier][scheme];
			const mix = committed.controlMix[tier][scheme];
			const backdrop = glassGray(byScheme[scheme]);
			for (const ground of ["surface", "canvas"]) {
				const groundHex = glassComposite(
					palette[ground],
					floors[ground],
					backdrop,
				);
				for (const [state, label] of [
					["hover", "glass row hover"],
					["selected", "glass row selected"],
					["field", "glass text field"],
				]) {
					const fill = glassComposite(
						palette.ink,
						committed.stateAlpha[state],
						groundHex,
					);
					for (const ink of GLASS_INKS) {
						authoredRun.assertions++;
						const floor =
							ink === "inkDim" ? GLASS_STATE_DIM_FLOOR : GLASS_INK_FLOOR;
						const r = glassRatio(palette[ink], fill);
						if (r < floor)
							authoredRun.fail(
								`${id}: ${label} (${tier}/${scheme}) ${ink} on the fill over ${ground} is ${r2(r)}:1, floor ${floor}`,
							);
					}
					authoredRun.assertions++;
					const step = deltaE(fill, groundHex);
					stepMin[state] = Math.min(stepMin[state], step);
					if (step < STEP[state])
						authoredRun.fail(
							`${id}: ${label} (${tier}/${scheme}) over ${ground} is ΔE00 ${r2(step)} off its ground, floor ${STEP[state]}: the state would vanish`,
						);
				}
				authoredRun.assertions++;
				const edge = glassRatio(glassEdge(palette, mix), groundHex);
				if (edge < GLASS_EDGE_FLOOR)
					authoredRun.fail(
						`${id}: glass text field (${tier}/${scheme}) border-control against ${ground} glass is ${r2(edge)}:1, floor ${GLASS_EDGE_FLOOR} - re-derive controlMix`,
					);
				authoredRun.assertions++;
				const ring = glassRatio(palette.accent, groundHex);
				if (ring < GLASS_EDGE_FLOOR)
					authoredRun.fail(
						`${id}: glass focus ring (${tier}/${scheme}) accent against ${ground} glass is ${r2(ring)}:1, floor ${GLASS_EDGE_FLOOR}`,
					);
			}
		}
	}
	console.log(
		`Window glass states: tightest step ΔE00 off the ground - hover ${r2(stepMin.hover)}, selected ${r2(stepMin.selected)}, field ${r2(stepMin.field)}.`,
	);
}

/*
 * THE GLASS BLOCK VEIL, THE RUNNING ROW AND THE CHROME BAND, as component
 * triples over the composite (the same method as the block above):
 *
 *   - "glass block veil": a text-bearing block (a user message bubble, a project
 *     card, a hub card) painted as `ink` at `blockVeil[scheme]` over the canvas
 *     glass at its floor. The step is the block's ONLY boundary, so it is held
 *     at ΔE00 4.0 on every palette and every material tier - the flat
 *     `messageSurface` floor's own promise, which no role alpha could keep. Inks
 *     on the veil: `ink`/`inkMuted` AA; `inkDim` at the states' stated 3.5
 *     relaxation (captions ride a block the way they ride a field).
 *   - "glass running row": the work overlay (`stateAlpha.work`, the selected
 *     step's alias) over the canvas glass. An in-flight row is the subject; its
 *     step is held at the selected floor (ΔE00 2.5) with AA inks.
 *   - "glass chrome band": the Browser route's tab strip and URL row wear
 *     `surface` at its floor RAW over the desktop - the app sidebar's own paint,
 *     so the two measure equal. Inks on the band are held to AA, `inkDim`
 *     included (this is a ground, not a state: the 3.5 relaxation does not
 *     apply). The active tab is the band plus the selected overlay, and that
 *     pair is the SHIPPED stack: the strip's field layer was withdrawn because
 *     the tab's `inkDim` mark fell under its floor on 18 palettes (review round
 *     2, F1). A future layer here has to come back through this row.
 *
 * The composer is a field on the CANVAS ground, which the block above already
 * asserts ("glass text field" over canvas); it needs no separate row, and its
 * edge is the derived `controlMix` already held at 3:1 there.
 */
{
	const committed = JSON.parse(
		readFileSync(join(ROOT, "src/shared/window-glass-floors.json"), "utf8"),
	);
	const veilMin = {
		dark: Number.POSITIVE_INFINITY,
		light: Number.POSITIVE_INFINITY,
	};
	const workMin = {
		step: Number.POSITIVE_INFINITY,
		inkMuted: 4.5,
		inkDim: 3.5,
	};
	const chromeMin = {
		ink: Number.POSITIVE_INFINITY,
		inkMuted: Number.POSITIVE_INFINITY,
		inkDim: Number.POSITIVE_INFINITY,
		tabStep: Number.POSITIVE_INFINITY,
	};
	for (const { id, palette } of palettes) {
		const scheme = glassSchemeOf(palette);
		for (const [tier, byScheme] of Object.entries(BACKDROP_GRAY)) {
			const floors = committed.alphaFloor[tier][scheme];
			const backdrop = glassGray(byScheme[scheme]);
			const canvasGlass = glassComposite(
				palette.canvas,
				floors.canvas,
				backdrop,
			);

			/* The block veil over the canvas glass. */
			const veilAlpha = committed.blockVeil[scheme];
			const veil = glassComposite(palette.ink, veilAlpha, canvasGlass);
			for (const ink of GLASS_INKS) {
				authoredRun.assertions++;
				const floor =
					ink === "inkDim" ? GLASS_STATE_DIM_FLOOR : GLASS_INK_FLOOR;
				const r = glassRatio(palette[ink], veil);
				if (r < floor)
					authoredRun.fail(
						`${id}: glass block veil (${tier}/${scheme}) ${ink} on the veil is ${r2(r)}:1, floor ${floor}`,
					);
			}
			authoredRun.assertions++;
			const veilStep = deltaE(veil, canvasGlass);
			veilMin[scheme] = Math.min(veilMin[scheme], veilStep);
			if (veilStep < GLASS_BLOCK_VEIL_STEP)
				authoredRun.fail(
					`${id}: glass block veil (${tier}/${scheme}) is ΔE00 ${r2(veilStep)} off the canvas glass, floor ${GLASS_BLOCK_VEIL_STEP} - a block would vanish`,
				);

			/* The running row's work overlay, the selected step under its own name. */
			const work = glassComposite(
				palette.ink,
				committed.stateAlpha.work,
				canvasGlass,
			);
			for (const ink of GLASS_INKS) {
				authoredRun.assertions++;
				const floor =
					ink === "inkDim" ? GLASS_STATE_DIM_FLOOR : GLASS_INK_FLOOR;
				const r = glassRatio(palette[ink], work);
				if (r < floor)
					authoredRun.fail(
						`${id}: glass running row (${tier}/${scheme}) ${ink} on the work overlay is ${r2(r)}:1, floor ${floor}`,
					);
			}
			authoredRun.assertions++;
			const workStep = deltaE(work, canvasGlass);
			if (workStep < 2.5)
				authoredRun.fail(
					`${id}: glass running row (${tier}/${scheme}) is ΔE00 ${r2(workStep)} off the canvas glass, floor 2.5: the row would not read as live`,
				);
			workMin.step = Math.min(workMin.step, workStep);

			/* The chrome band: surface at its floor, the sidebar's own paint. */
			const chrome = glassComposite(palette.surface, floors.surface, backdrop);
			for (const ink of GLASS_INKS) {
				authoredRun.assertions++;
				const r = glassRatio(palette[ink], chrome);
				if (r < GLASS_INK_FLOOR)
					authoredRun.fail(
						`${id}: glass chrome band (${tier}/${scheme}) ${ink} on the band is ${r2(r)}:1, floor ${GLASS_INK_FLOOR}`,
					);
				chromeMin[ink] = Math.min(chromeMin[ink], r);
			}
			/*
			 * THE ACTIVE TAB IS THE REAL STACK: selected over chrome, nothing else.
			 * A field layer under it was tried and withdrawn (review round 2, F1) - its
			 * 5% ink put this row's `inkDim` (the tab's globe / loading spinner) at
			 * 3.21:1 on cyberpunk and below 3.5 on 18 dark palettes, on both tiers.
			 * A re-added LAYER is invisible to this row (it models alphas, not the
			 * background-image): the CDP guard's `backgroundImage === "none"` assert
			 * is the tripwire, and this row is the model a layer must be re-derived
			 * through before it may sit under the tab.
			 */
			{
				const label = "glass chrome tab";
				const fill = glassComposite(
					palette.ink,
					committed.stateAlpha.selected,
					chrome,
				);
				for (const ink of GLASS_INKS) {
					authoredRun.assertions++;
					const floor =
						ink === "inkDim" ? GLASS_STATE_DIM_FLOOR : GLASS_INK_FLOOR;
					const r = glassRatio(palette[ink], fill);
					if (r < floor)
						authoredRun.fail(
							`${id}: ${label} (${tier}/${scheme}) ${ink} on the fill is ${r2(r)}:1, floor ${floor}`,
						);
				}
				authoredRun.assertions++;
				const step = deltaE(fill, chrome);
				chromeMin.tabStep = Math.min(chromeMin.tabStep, step);
				if (step < 2.5)
					authoredRun.fail(
						`${id}: glass chrome tab (${tier}/${scheme}) is ΔE00 ${r2(step)} off the band, floor 2.5`,
					);
			}
		}
	}
	/*
	 * THE ISOLATING BAND, which is the one band whose ground is MOVING.
	 *
	 * Every other band in the glass model sits on a STATIC ground - the pane's
	 * own fill - so the published alpha is right for them and the rows above
	 * cover it. A band that rows scroll UNDER has a ground that is whatever is
	 * passing beneath it, and its alpha is therefore a CONTRACT: the count
	 * beside the section label has to clear the 4.5 text floor against it,
	 * whatever that content is.
	 *
	 * The contract asserts the floor's own claim, over EVERY palette and at
	 * the WORST content colour (the extreme the scheme's ink contrasts
	 * against: a white thumbnail under a dark band, a black one under a light
	 * band), and it asserts the floor is not BELOW what the palettes need -
	 * the same "re-derive, never hand-lower it" rule the alpha floors carry.
	 */
	for (const { id, palette } of palettes) {
		const scheme = glassSchemeOf(palette);
		const floor = committed.bandFloor?.[scheme];
		if (floor === undefined) {
			authoredRun.fail(
				`${id}: the isolating band's alpha floor is missing for ${scheme}`,
			);
			continue;
		}
		const backdrop = scheme === "dark" ? "#ffffff" : "#000000";
		const band = glassComposite(palette.elevated, floor, backdrop);
		for (const ink of GLASS_INKS) {
			authoredRun.assertions++;
			const needed = ink === "inkDim" ? GLASS_STATE_DIM_FLOOR : GLASS_INK_FLOOR;
			const r = glassRatio(palette[ink], band);
			if (r < needed)
				authoredRun.fail(
					`${id}: the isolating band (${scheme}) ${ink} on the band is ${r2(r)}:1, floor ${needed}`,
				);
		}
	}
	/*
	 * THE FLOATING OVERLAY (popups, menus, tooltips, dialogs, the update notice).
	 *
	 * A floating surface has no ground of its own to be measured against: it is
	 * painted at the document root and floats over whatever the app happened to
	 * render beneath it. That is the band's problem one layer further out, with one
	 * important difference - a portalled panel is always over SOMETHING THE APP
	 * PAINTED, never over the raw desktop, so the column beneath it already
	 * contributes its alpha and the panel's own alpha can be materially lower than
	 * the band's floor while still holding the text floor.
	 *
	 * The row therefore asserts what `overlayFloor` claims, over EVERY palette and at
	 * BOTH ENDS OF THE SLIDER: at the default (80) and at MAX TRANSPARENCY (the floor
	 * itself). The clearest end is the worst case for the fill, but the panel has to be
	 * legible everywhere the user can put the slider, so both ends are measured rather
	 * than the floor alone standing in for the travel.
	 *
	 * THE REGISTERS ARE THE ONES THAT RENDER, and the third one is measured where it
	 * lands rather than where the palette authors it. The panel carries three text
	 * registers - `ink` and `inkMuted`, which the derivation holds at the floor, and
	 * `inkDim` for a menu label, an item's shortcut and a select's group heading. Inside
	 * a marked panel `index.css` REBINDS `--color-ink-dim` to `--color-ink-muted`, so
	 * the dim rows draw in the muted ink: measured as `inkDim` this register is 3.62:1
	 * (dark) / 3.59:1 (light) at the floor, under the 4.5 text floor on 57 of the 59
	 * palettes - the round-1 MAJOR. So the dim line is asserted as the muted role it
	 * renders in, and the rebinding itself is held by `scripts/glass-overlay.test.mjs`,
	 * which reads the declaration out of the rule: a row that measured the palette's
	 * dim hex would be measuring a colour the panel never paints.
	 *
	 * The button face and the highlighted row are separately-covered pairs: a row's
	 * `accentWash` is an OPAQUE role that replaces this ground, so it is measured as
	 * its own fill and never as a stack on the alpha here.
	 */
	const OVERLAY_ENDS = [
		{ label: "at the default 80", intensity: 80 },
		{ label: "at max transparency", intensity: 100 },
	];
	const overlayMin = {};
	let overlayPalettes = 0;
	for (const { id, palette } of palettes) {
		const scheme = glassSchemeOf(palette);
		const floor = committed.overlayFloor?.[scheme];
		if (floor === undefined) {
			fail(
				`${id}: the floating overlay's alpha floor is missing for ${scheme}`,
			);
			continue;
		}
		overlayPalettes++;
		/* The least opaque column the app can present: the derivation's worst case. */
		let backing = 1;
		for (const tier of Object.keys(committed.alphaFloor))
			backing = Math.min(
				backing,
				committed.alphaFloor[tier][scheme]?.canvas ?? 1,
			);
		const backdrop = scheme === "dark" ? "#ffffff" : "#000000";
		const beneath = glassComposite(palette.canvas, backing, backdrop);
		const registers = [
			["ink", palette.ink],
			["inkMuted", palette.inkMuted],
			/* The dim register, as the panel paints it (rebound to muted in the rule). */
			["inkDim (rendered as inkMuted)", palette.inkMuted],
		];
		for (const end of OVERLAY_ENDS) {
			/* `glassOverlayAlpha`'s own arithmetic, the shape § 5c already uses for the lane. */
			const top = Math.max(LANE_ALPHA_CEILING, floor);
			const alpha =
				Math.round((top - (end.intensity / 100) * (top - floor)) * 100) / 100;
			const panel = glassComposite(palette.elevated, alpha, beneath);
			for (const [role, ink] of registers) {
				authoredRun.assertions++;
				const r = glassRatio(ink, panel);
				const key = `${end.label.split(" ").pop()} ${scheme} ${role}`;
				if (overlayMin[key] === undefined || r < overlayMin[key])
					overlayMin[key] = r;
				if (r < GLASS_INK_FLOOR) {
					overlayMin.failures = (overlayMin.failures ?? 0) + 1;
					authoredRun.fail(
						`${id}: the floating overlay (${scheme}) ${role} on the panel ${end.label} is ${r2(r)}:1, floor ${GLASS_INK_FLOOR}`,
					);
				}
			}
		}
	}
	const overlayAlphaAt = (floor, intensity) =>
		Math.round(
			(Math.max(LANE_ALPHA_CEILING, floor) -
				(intensity / 100) * (Math.max(LANE_ALPHA_CEILING, floor) - floor)) *
				100,
		) / 100;
	/*
	 * THE SEMANTIC INKS AND THE PANEL'S OWN BOUNDARY (design round 1, D1 and D2).
	 *
	 * The body inks above are only half of what a marked panel carries. A destructive
	 * menu item is `text-danger`, a result link is `text-accent`: five meaning colours
	 * the flat contract already floors at 4.5:1 as inks, and none of which the fill can
	 * carry on this tier (the solve needs alpha 1.00 dark / 0.82 light - the opaque
	 * plate). So each is measured AS THE RULE PAINTS IT: the palette's role mixed
	 * toward `ink` by the committed `overlayInkMix`, held to the text floor at both
	 * ends of the slider, over every palette.
	 *
	 * The boundary is NOT measured in this loop any more; it is the painted-contact row
	 * just below, which says why the old stroke row was retired.
	 *
	 * BOTH MIXES MUST BE THE DERIVED ONES, not merely enough: a hand-picked mix is the
	 * drift this table exists to make impossible, so the committed value is compared to
	 * the solver's own answer for the same palettes.
	 *
	 * `accent` IS MEASURED NOWHERE HERE, and that is a recorded deferral rather than an
	 * oversight: it is the palette's one dual-use role (an ink and the primary action's
	 * fill), so a subtree rebind cannot lift its text case without recolouring every
	 * primary button face inside a panel. The numbers and the two ways to close it are
	 * on the PR; nothing in this gate should read as clearing it.
	 */
	const derivedInkMix = deriveOverlayInkMix(
		committed.alphaFloor,
		committed.overlayFloor,
	);
	const derivedEdgeMix = deriveOverlayEdgeMix(
		committed.alphaFloor,
		committed.overlayFloor,
	);
	for (const [key, derived] of [
		["overlayInkMix", derivedInkMix],
		["overlayEdgeMix", derivedEdgeMix],
	])
		for (const scheme of ["dark", "light"])
			if (committed[key]?.[scheme] !== derived[scheme])
				fail(
					`the floating overlay's ${key} for ${scheme} is ${committed[key]?.[scheme]} but the palettes derive ${derived[scheme]} - re-derive, never hand-pick a mix`,
				);
	const semanticMin = {};
	for (const { id, palette } of palettes) {
		const scheme = glassSchemeOf(palette);
		const inkMix = committed.overlayInkMix[scheme];
		let backing = 1;
		for (const tier of Object.keys(committed.alphaFloor))
			backing = Math.min(
				backing,
				committed.alphaFloor[tier][scheme]?.canvas ?? 1,
			);
		const beneath = glassComposite(
			palette.canvas,
			backing,
			scheme === "dark" ? "#ffffff" : "#000000",
		);
		for (const end of OVERLAY_ENDS) {
			const panel = glassComposite(
				palette.elevated,
				overlayAlphaAt(committed.overlayFloor[scheme], end.intensity),
				beneath,
			);
			for (const role of GLASS_OVERLAY_INKS) {
				/* Counted like every other row in this run: a measurement the total
				 * does not include is a measurement a reader cannot audit (agent
				 * review round 4, N4-1). */
				authoredRun.assertions++;
				/* The rule's own `color-mix`: `ink` at `inkMix` over the palette's role. */
				const painted = glassComposite(palette.ink, inkMix, palette[role]);
				const r = glassRatio(painted, panel);
				const key = `${role} ${scheme}`;
				if (semanticMin[key] === undefined || r < semanticMin[key])
					semanticMin[key] = r;
				if (r < GLASS_INK_FLOOR)
					authoredRun.fail(
						`${id}: the floating overlay (${scheme}) ${role} on the panel ${end.label} is ${r2(r)}:1 after the derived ink mix, floor ${GLASS_INK_FLOOR}`,
					);
			}
		}
	}
	console.log(
		`Window glass round 3: the floating overlay's semantic inks after the derived mix (${committed.overlayInkMix.dark} dark / ${committed.overlayInkMix.light} light) - worst ${GLASS_OVERLAY_INKS.map((role) => `${role} ${r2(Math.min(semanticMin[`${role} dark`] ?? 0, semanticMin[`${role} light`] ?? 0))}`).join(", ")}.`,
	);
	/*
	 * THE PANEL'S BOUNDARY ON GLASS, MEASURED AS IT IS PAINTED (2026-11-06).
	 *
	 * This row used to hold `overlayEdgeMix` - the hairline stepped toward ink - to
	 * `GLASS_OVERLAY_EDGE_FLOOR` (1.5:1) as an opaque 1px line against the panel. That
	 * line is gone: floating surfaces separate by ground and elevation, never by a
	 * stroke (branding § 2; operator report 2026-11-06). Holding a colour nothing
	 * paints to a floor is a gate that passes while the screen fails, so the stroke
	 * row is RETIRED, not lowered (agent review round 1, R2). What reaches the screen
	 * is the shadow's contact layer, and that is what this row measures.
	 *
	 * THE MODEL. Each contact layer of `--shadow-overlay` (`0 0 2px -1px` and
	 * `0 2px 6px -3px`) is a Gaussian blur with sigma = blur / 2, so its coverage at a
	 * pixel `d` outside the panel edge is Phi((offset + spread - d) / sigma). Measured
	 * at d = 0.5px, on the bottom side (the drop's offset toward it) and the top (away
	 * from it), over BOTH desktop extremes - the designer's glow (design round 1, D2)
	 * was over a black desktop, the opposite extreme from the ink rows above - and at
	 * both ends of the slider. Same arithmetic as the scratch model posted with the
	 * round-1 remediation on PR #1736: the ink-step contact this change first shipped painted a
	 * worst corner of 1.00:1 against the panel and was LIGHTER than the column beneath
	 * in 164 palette x case corners. A blurred shadow of no colour clears 1.5:1 in
	 * every corner, because the worst corners are the ground step itself.
	 *
	 * TWO ASSERTIONS, neither looser than what ships:
	 *  - DIRECTION: the painted contact is never lighter than the column beneath it.
	 *    A light rim is a stroke drawn with a shadow - the operator's complaint.
	 *  - RATCHET: per scheme x desktop x side, the painted edge against the panel is at
	 *    least the measured worst of this composition over the authored palettes,
	 *    rounded down to 2 dp (like every `authoredRun` row, the contrast presets print
	 *    it but do not gate it). It cannot get worse than this PR ships; raise a number
	 *    when a change improves it, never lower one to pass.
	 *
	 * WHY 50% BLACK. At 30% the contact stayed darker than the column on the authored
	 * palettes but painted a faint rim on the near-black canvases the +50/+100 contrast
	 * presets produce (4 and 6 corners); 50% is the first step measured clean at both.
	 *
	 * `overlayEdgeMix` is still derived and solver-checked above because the runtime
	 * still publishes it (`--lo-glass-overlay-edge-mix`); nothing paints it now.
	 */
	const CONTACT_LAYERS = [
		/* [offset toward the bottom side, blur, spread] */
		[0, 2, -1],
		[2, 6, -3],
	];
	/* Mirror the glass rule's `--lo-shadow-contact` in `styles/index.css`;
	 * `glass-overlay.test.mjs` O-3 pins the CSS to the same two numbers. */
	const CONTACT_SHARE = 0.45;
	const CONTACT_BLACK = 0.5;
	const OVERLAY_CONTACT_RATCHET = {
		"dark #000000 bottom": 1.16,
		"dark #000000 top": 1.15,
		"dark #ffffff bottom": 1.9,
		"dark #ffffff top": 2.25,
		"light #000000 bottom": 2.24,
		"light #000000 top": 1.95,
		"light #ffffff bottom": 1.29,
		"light #ffffff top": 1.09,
	};
	/* Abramowitz-Stegun 26.2.17: |error| < 7.5e-8, far under one 8-bit step. */
	const phi = (x) => {
		const t = 1 / (1 + 0.2316419 * Math.abs(x));
		const d = 0.3989423 * Math.exp((-x * x) / 2);
		const p =
			d *
			t *
			(0.3193815 +
				t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
		return x > 0 ? 1 - p : p;
	};
	/* `rgb(r g b / a)` (how the palettes author scrim) or a bare hex. */
	const scrimOf = (value) => {
		const m = /rgba?\(([^)]+)\)/.exec(value);
		if (!m) return { rgb: value.slice(0, 7), alpha: 1 };
		const [r, g, b, a = 1] = m[1]
			.split(/[\s,/]+/)
			.filter(Boolean)
			.map(Number);
		const hex = [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
		return { rgb: `#${hex}`, alpha: a };
	};
	const lighterThan = (a, b) =>
		glassRatio(a, "#000000") > glassRatio(b, "#000000");
	const contactMin = {};
	let contactLight = 0;
	for (const { id, palette } of palettes) {
		const scheme = glassSchemeOf(palette);
		const scrim = scrimOf(palette.scrim);
		/* The rule's `color-mix(in srgb, black 50%, scrim)`, premultiplied as CSS
		 * mixes alpha, then taken at the 45% share. */
		const mixedAlpha = CONTACT_BLACK + (1 - CONTACT_BLACK) * scrim.alpha;
		const contactRgb = glassComposite(
			scrim.rgb,
			((1 - CONTACT_BLACK) * scrim.alpha) / mixedAlpha,
			"#000000",
		);
		const contactAlpha = mixedAlpha * CONTACT_SHARE;
		let backing = 1;
		for (const tier of Object.keys(committed.alphaFloor))
			backing = Math.min(
				backing,
				committed.alphaFloor[tier][scheme]?.canvas ?? 1,
			);
		for (const desktop of ["#000000", "#ffffff"]) {
			const beneath = glassComposite(palette.canvas, backing, desktop);
			for (const end of OVERLAY_ENDS) {
				const panel = glassComposite(
					palette.elevated,
					overlayAlphaAt(committed.overlayFloor[scheme], end.intensity),
					beneath,
				);
				for (const side of ["bottom", "top"]) {
					let edge = beneath;
					for (const [offset, blur, spread] of CONTACT_LAYERS) {
						const toward = side === "bottom" ? offset : -offset;
						const coverage = phi((toward + spread - 0.5) / (blur / 2));
						edge = glassComposite(contactRgb, contactAlpha * coverage, edge);
					}
					const key = `${scheme} ${desktop} ${side}`;
					authoredRun.assertions += 2;
					if (lighterThan(edge, beneath)) {
						contactLight++;
						authoredRun.fail(
							`${id}: the floating overlay's contact (${key}) ${end.label} paints ${edge} over ${beneath} - lighter than the column beneath it, i.e. a glow ring, not elevation`,
						);
					}
					const r = glassRatio(edge, panel);
					if (contactMin[key] === undefined || r < contactMin[key])
						contactMin[key] = r;
					if (r < OVERLAY_CONTACT_RATCHET[key])
						authoredRun.fail(
							`${id}: the floating overlay's painted edge (${key}) ${end.label} is ${r2(r)}:1 against the panel, under the ratchet ${OVERLAY_CONTACT_RATCHET[key]} this composition shipped at`,
						);
				}
			}
		}
	}
	console.log(
		`Window glass round 3: the floating overlay's painted contact edge - ${Object.entries(
			contactMin,
		)
			.map(([key, r]) => `${key} ${r.toFixed(3)}`)
			.join(", ")}; ${contactLight} corners lighter than the column beneath.`,
	);
	const ends = OVERLAY_ENDS.map((end) => end.label).join(" and ");
	console.log(
		`Window glass round 3: the floating overlay over ${overlayPalettes} palettes ${ends} - worst ink/muted dark ${r2(overlayMin["80 dark ink"] ?? 0)}/${r2(overlayMin["80 dark inkMuted"] ?? 0)} and ${r2(overlayMin["transparency dark ink"] ?? 0)}/${r2(overlayMin["transparency dark inkMuted"] ?? 0)}, light ${r2(overlayMin["80 light ink"] ?? 0)}/${r2(overlayMin["80 light inkMuted"] ?? 0)} and ${r2(overlayMin["transparency light ink"] ?? 0)}/${r2(overlayMin["transparency light inkMuted"] ?? 0)}; ${overlayMin.failures ?? 0} palette-end-register measurements under ${GLASS_INK_FLOOR}.`,
	);
	console.log(
		`Window glass round 2: tightest block veil ΔE00 off canvas glass - dark ${r2(veilMin.dark)}, light ${r2(veilMin.light)}; work row step ${r2(workMin.step)}; chrome inks ${r2(chromeMin.ink)}/${r2(chromeMin.inkMuted)}/${r2(chromeMin.inkDim)}, tab step ${r2(chromeMin.tabStep)}.`,
	);
}

/*
 * ---- 5c. the window glass lane wash (round 3, re-derived round 1) ----
 *
 * A LANE is the Projects board's well and its column strip: a well that must read
 * on a translucent page while the cards above it already carry the block veil.
 * It cannot be an ink overlay (ink 5% under the veil measured `inkMuted` 4.03:1
 * on synthwave), so it is a palette role at an alpha that TRACKS the page.
 *
 * THE ROUND-1 FAILURE this asserts against: a FIXED alpha was derived at the
 * default (80) on the claim that 80 was the binding position, "because the page is
 * most opaque there". The page is most opaque at 0, not 80 - its alpha runs
 * 0.66 -> 0.96 as intensity falls - so the lane's step collapsed exactly where the
 * window was most frosted (measured ΔE00 0.59 dark at 25, 0.99 light at 0).
 *
 * THE SHIPPED MODEL: `laneAlpha = round2(pageAlpha * scale)`, with the role and
 * scale derived by `derive-glass-floors.mjs` at EVERY slider position and every
 * material tier. The role is scheme-dependent because a role's distance from
 * `canvas` bounds the step at the opaque end: dark `surface` cannot clear at any
 * alpha, light `sunken` cannot. Every position is asserted here rather than the
 * five the review sampled, because 8-bit compositing is not monotone.
 *
 * What each position asserts, over every palette and material tier:
 *
 *   - "glass lane wash": the lane steps ΔE00 `GLASS_LANE_STEP` off the page. This
 *     is the field/well floor: below it the lane is not structure.
 *   - "glass lane inks": ink and inkMuted on the lane keep AA, inkDim keeps the
 *     stated 3.5 relaxation - the board's column header and count are read there.
 *   - "glass card on lane": the card's veil still steps ΔE00 4.0 off the LANE
 *     (the block's own boundary) and its inks keep the same floors. This is the
 *     row that would have caught the easy wrong answer - raising the lane until
 *     the card's text lost AA.
 */
{
	const committed = JSON.parse(
		readFileSync(join(ROOT, "src/shared/window-glass-floors.json"), "utf8"),
	);
	const at = (floor, intensity) =>
		Math.round(
			(LANE_ALPHA_CEILING - (intensity / 100) * (LANE_ALPHA_CEILING - floor)) *
				100,
		) / 100;
	const minStep = {
		lane: Number.POSITIVE_INFINITY,
		card: Number.POSITIVE_INFINITY,
	};
	let worstLane = null;
	let worstCard = null;
	let worstInk = Number.POSITIVE_INFINITY;
	/* The 5x2 matrix the round-1 review asked for: minima over palettes/tiers. */
	const matrix = {};
	for (const intensity of Array.from({ length: 101 }, (_, i) => i)) {
		const row = {
			dark: Number.POSITIVE_INFINITY,
			light: Number.POSITIVE_INFINITY,
		};
		for (const { palette } of palettes) {
			const scheme = glassSchemeOf(palette);
			const wash = committed.laneWash[scheme];
			for (const [tier, byScheme] of Object.entries(BACKDROP_GRAY)) {
				const floors = committed.alphaFloor[tier][scheme];
				const pageAlpha = at(floors.canvas, intensity);
				const page = glassComposite(
					palette.canvas,
					pageAlpha,
					glassGray(byScheme[scheme]),
				);
				const lane = glassComposite(
					palette[wash.role],
					Math.round(pageAlpha * wash.scale * 100) / 100,
					page,
				);
				const card = glassComposite(
					palette.ink,
					committed.blockVeil[scheme],
					lane,
				);
				authoredRun.assertions += 2;
				const laneStep = deltaE(lane, page);
				const cardStep = deltaE(card, lane);
				row[scheme] = Math.min(row[scheme], laneStep);
				if (laneStep < GLASS_LANE_STEP)
					authoredRun.fail(
						`glass lane wash (${tier}/${scheme} at ${intensity}): ΔE00 ${r2(laneStep)} off the page, floor ${GLASS_LANE_STEP} - the lane is not structure`,
					);
				if (cardStep < GLASS_BLOCK_VEIL_STEP)
					authoredRun.fail(
						`glass card on lane (${tier}/${scheme} at ${intensity}): ΔE00 ${r2(cardStep)} off the lane, floor ${GLASS_BLOCK_VEIL_STEP} - the card would vanish`,
					);
				if (laneStep < minStep.lane) {
					minStep.lane = laneStep;
					worstLane = `${tier}/${scheme}@${intensity}`;
				}
				if (cardStep < minStep.card) {
					minStep.card = cardStep;
					worstCard = `${tier}/${scheme}@${intensity}`;
				}
				for (const [ground, label] of [
					[lane, "glass lane inks"],
					[card, "glass card on lane"],
				]) {
					for (const ink of GLASS_INKS) {
						authoredRun.assertions++;
						const floor =
							ink === "inkDim" ? GLASS_STATE_DIM_FLOOR : GLASS_INK_FLOOR;
						const r = glassRatio(palette[ink], ground);
						if (r < floor)
							authoredRun.fail(
								`${label} (${tier}/${scheme} at ${intensity}) ${ink} is ${r2(r)}:1, floor ${floor}`,
							);
						if (ink !== "inkDim") worstInk = Math.min(worstInk, r);
					}
				}
			}
		}
		if ([0, 25, 50, 70, 80, 100].includes(intensity)) matrix[intensity] = row;
	}
	console.log(
		`Window glass round 3: lane roles ${committed.laneWash.dark.role}/${committed.laneWash.light.role} at scales ${committed.laneWash.dark.scale}/${committed.laneWash.light.scale}; tightest lane step ΔE00 ${r2(minStep.lane)} (${worstLane}), card off lane ${r2(minStep.card)} (${worstCard}), tightest ink ${r2(worstInk)}:1.`,
	);
	for (const [intensity, row] of Object.entries(matrix))
		console.log(
			`  lane ΔE00 at ${intensity}: dark ${r2(row.dark)} / light ${r2(row.light)}`,
		);
}

/* ---- 6. report ---------------------------------------------------------- */

for (const line of log) console.log(line);

const themeCount = palettes.length;
if (run.failures > 0) {
	console.error(
		`\nContrast contract FAILED: ${run.failures} violation(s) over ${run.assertions} assertions across ${themeCount} themes.`,
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
	/* `also` pins the VALUE of a constant the site names, for the cases where the
	   name surviving is not the claim - a flipped direction or a dropped mirror
	   keeps `const NAME =` intact (design review round 3, D1). */
	for (const fragment of [site.must, ...(site.also ?? [])]) {
		run.assertions += 1;
		if (!source.includes(fragment)) {
			callSiteFailures += 1;
			console.error(
				`FAIL  ${site.what}: ${site.file} no longer contains \`${fragment}\`\n      ${site.why}`,
			);
		}
	}
}
if (callSiteFailures > 0) {
	console.error(
		`\nContrast contract FAILED: ${callSiteFailures} structural boundary/boundaries no longer declare a floored role at their call site.`,
	);
	process.exit(1);
}

/* A pin for a palette that is gone is the same dead weight. */
/* The "never consulted" checks below are AUTHORED-only: a preset can clear a
   pinned shortfall outright, so the pin is not consulted on that run - which is
   an improvement in the composed palette, not a dead pin in the table. The
   authored pass of `check-themes` keeps every one of them. */
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
if (!COMPOSED && staleControlEdge.length > 0) {
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
if (!COMPOSED && staleConsulted.length > 0) {
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
if (!COMPOSED && stalePerceptible.length > 0) {
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
if (!COMPOSED && stalePairPins.length > 0) {
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

/*
 * AND DESIGN 9.2's HONEST GAP, MEASURED RATHER THAN PROSE.
 *
 * Six chromatic ANSI slots cannot come from four gated hue roles, so the terminal
 * maps blue and cyan to `info`, magenta to `danger`, and every bright variant to
 * its base role. That is a decision the design states; this line is what makes it
 * countable, so a reader can see how many colours a program actually gets on each
 * palette instead of taking the prose's word for it. A palette where the number
 * drops is a palette where more of the program's vocabulary collapsed.
 */
const ansiDistinct = palettes.map(({ id, palette: p }) => ({
	id,
	n: new Set(TERMINAL_ANSI.map(([, role]) => p[role]).filter((v) => isHex(v)))
		.size,
}));
console.log(
	`Console terminal: ${TERMINAL_ANSI.length} ANSI slots resolve to ${Math.min(...ansiDistinct.map((e) => e.n))}-${Math.max(...ansiDistinct.map((e) => e.n))} distinct colours across ${palettes.length} palettes (design 9.2's stated gap, measured); fewest in ${ansiDistinct
		.sort((a, b) => a.n - b.n)
		.slice(0, 3)
		.map((e) => `${e.id} ${e.n}`)
		.join(", ")}.`,
);

console.log(
	`Contrast contract holds: ${run.assertions} assertions across ${themeCount} themes, ${exceptionSeen.size} consulted exception(s), ${perceptibleSeen.size} ΔE00 exception(s) consulted, ${inkStepPinSeen.size} pinned ink step(s), ${controlEdgeSeen.size} pinned control edge(s), ${pairPinSeen.size} pinned identity pair(s).`,
);
/*
 * And the FLEET's own line, because these are the numbers that ran in prose and a
 * prose number cannot go red. `over the 1 degree pin` is reported rather than
 * hidden: it is the measure the hue assertion actually uses (one 8-bit channel
 * step at the shipped chroma), and a reader who sees it move knows which clause
 * moved.
 */
console.log(
	`Fleet: ${state.darkWindow} dark canvas(es) in a ${r2(FLEET_DARK_WINDOW)} L* window (max ${FLEET_DARK_WINDOW_CEILING}), ${state.darkDeep} below L* ${r2(FLEET_DARK_DEEP_L)}, spread ${r2(state.darkSpread)} L*; ${state.darkSub1.length} sub-1.0 and ${state.darkIdenticalPairs.length} identical dark canvas pair(s); light ${state.lightWindow} in a ${FLEET_WINDOW} L* window, ${state.lightHigh} at or above L* ${FLEET_LIGHT_HIGH_L}, ${state.lightSub1} sub-1.0 pair(s); ${hueOverPinByLattice} moved value(s) over the ${HUE_PIN_DEGREES} degree hue pin and inside the 8-bit envelope.`,
);
