/**
 * The conversation column's drag affordance: one handle per edge of the shared
 * measure, and the cue that makes it discoverable without putting it on screen
 * at rest.
 *
 * WHAT THIS IS MODELLED ON, named so the next reader does not have to infer it:
 * `deepseek-harness`'s conversation-width controls. Three of its decisions are
 * taken here and two are deliberately not, and the differences are the
 * interesting part:
 *
 *  - **The cue is a short fade bar on the measure's real edge, and it has been
 *    through two revisions - this is the second, and the history is the point.**
 *    It began as `deepseek-harness`'s 72px bar centred on the pointer's Y; the
 *    operator's report (issue #848, 2026-10-06) was that a mark floating in the
 *    transcript's empty margin reads as "a mistake" rather than as the column's
 *    boundary, so the first revision moved it onto that boundary as the divider
 *    family's full-height 2px state line. A full-height rule reports the EDGE at
 *    every Y and does read as a boundary - which is what #848 asked for - but it
 *    also draws a hard rule down the whole transcript for as long as a hover
 *    lasts, and the operator's follow-up is that this is too much ink for a
 *    hint. So the cue is the reference's own TEXTURE again -
 *    `ConversationWidthControls.tsx`'s `.widthHandle::after`: a 2px bar, a solid
 *    core fading to transparent each side (`CUE_BAR_PX`, the one number the
 *    operator's "taller" swaps) - placed where the line went, on the measure's
 *    real edge, rather than where the reference puts its strip. The two roles come with it unchanged -
 *    `control` while grabbable, `accent` while moving after the same
 *    `HOVER_INTENT_MS` intent delay (imported, not restated) - which are the
 *    divider family's own steps, so no new colour enters the system, and the
 *    contract already carries their floors (3:1 on every ground).
 *  - **The core follows the hand during a drag, and rests where the hand
 *    arrived.** The reference publishes the pointer's Y for the length of the
 *    gesture, so the bar's core travels with the reader's own hand and the mark
 *    reads as "you are moving this". `--lo-chat-measure-cue-y` is that
 *    publication, restored from the bar's first cut and written as PAINT rather
 *    than as React state - the discipline the width preview already uses
 *    (`preview()`), because a `mousemove`-rate render is a cost this component
 *    has already decided not to pay. The reference's hold-last-drag-Y is
 *    deliberately NOT taken: the property is REMOVED on release, and the bar
 *    returns to the seat the gesture began on - the same Y the panel anchors to
 *    - because a mark left where a previous gesture ended would report a hand
 *    that is no longer there. That seat is also what keeps the resting bar
 *    inside the pane: resting it on the COLUMN's own middle put it hundreds of
 *    pixels off-screen on any transcript taller than the pane (round 1's
 *    blocker), where the panel's seat - the hand's, or the visible band's -
 *    cannot.
 *  - **Drawn immediately OUTSIDE the measure's edge, not inside it.** The
 *    divider draws its line on the sized panel's leading/trailing edge, and it
 *    can, because every panel it sizes carries its own inset. The chat column
 *    carries none - its inset is the scroller's `p-4` plus the 8px gutter - so
 *    its edge is exactly where the first glyph starts, and a rule drawn inside
 *    would cross the text. The 2px line therefore sits with its inner edge ON
 *    the boundary and its whole width in the gutter beside it, which is what
 *    makes the column's edge legible as an edge.
 *  - **The handle is OUTSIDE the column, hugging the edge the cue is drawn on.**
 *    The 10px band occupies the gutter the measure already reserves (`p-4` + the
 *    8px scrollbar gutter = 24px per side in `chat-measure.ts`), its INNER edge
 *    on the column's own edge, so a press anywhere on the 2px rule starts the
 *    drag and the band never reaches inward past the text - the guarantee is
 *    geometric rather than something a z-index or a hit-test has to keep true.
 *    The band used to sit 24px out (the reference's own offset for its strip),
 *    which left a 22px dead zone between the only thing on screen that promised
 *    adjustability and the only place that responded, and the flush variant this
 *    first shipped with DID swallow a click: design round 1's D2 measured it
 *    over the fold-row button's hit box by 8x20px, which is why the band's side
 *    of the edge is part of the design, not decoration.
 *  - **`deepseek-harness` has no reset, and this one does.** Double-click (or
 *    Enter on the focused handle) goes back to the shipped measure. That is a
 *    deliberate difference: without it, one drag makes the product's own choice
 *    unreachable except by clearing `localStorage` by hand. The gesture is
 *    detected from the press's own click count rather than from a `dblclick`
 *    listener - see `onMouseDown` for what that cost when it was not.
 *
 *  - **What is NOT taken: its keyboard story, because it has none.** The width
 *    there is mouse-only. Here the handle is a real `separator` widget -
 *    focusable, arrow keys move it, Home/End go to the bounds, Enter restores the
 *    default - so the feature is reachable without a pointer. It follows the
 *    divider in `shared/components/common/resizable-divider.tsx`, including its
 *    full-viewport cursor overlay, which is imported rather than re-written.
 *    The reset matches the app's other five dividers, so parity is kept
 *    consciously.
 *
 *    DISCOVERABILITY has two channels, and the pointer half was the gap the
 *    issue named: the keys and the reset are ANNOUNCED - the separator's
 *    `aria-keyshortcuts` and the mounts' labels - rather than drawn (UX round
 *    1's U2), while the strip carries a tooltip naming the drag and the reset
 *    (`TOOLTIP` below). It names the reset for BOTH readers, because focus opens
 *    it too and a double-click is the one thing a keyboard reader cannot do
 *    (design round 1's D1). The POINTER's channel is deliberately slow to arrive
 *    (`MEASURE_PANEL_DWELL_MS`), because a panel that opens under a hand merely
 *    sweeping past the gutter is the thing the operator complained about; the
 *    keyboard's is instant and stays the loudest state, because focus is a
 *    decision a reader has already made. The parts are the app's own (`ui/tooltip.tsx` exports
 *    them for the unusual case, which this is: the first tooltip in the tree
 *    whose anchor would be taller than the pane clipping it), and the OPEN state
 *    is this component's own, driven by the strip's hover and focus - see the
 *    anchor's comment in the render block for why the trigger cannot be the
 *    strip itself.
 *
 * THE KEY MAP IS THE DIVIDER'S OWN, via `keyboardTarget`, with two register
 * choices rather than a second implementation (agent review round 1's R1-2):
 * `side: "right"` makes the arrows value-relative - Right widens on BOTH
 * handles - where the divider's edge-relative arrows would make the same key
 * mean opposite things depending on which handle holds focus, with TWO handles
 * for ONE value; and `homeEnd: "value"` puts Home/End at the value's own
 * extremes rather than at the divider's axis extremes. Both are parameters the
 * shared map already carries.
 *
 * THE HANDLES EXIST ONLY WHERE THE OVERRIDE CAN ACT (agent review round 1's
 * R1-1). The measure's own application is gated behind `@min-[750px]/chatcol:`,
 * and below that gate the column takes the whole pane - there is no cap to
 * resize. The wrapper carries the same gate, so a sub-750 pane renders no
 * strip, no cue and no dead tab stop: the band is reachable in ordinary use
 * (the app's 800px minimum window, and windows with a docked right-hand pane),
 * and an affordance that silently stores values nothing applies is worse than
 * an absent one. This is the same principle as `measurePx === null`, one gate
 * later.
 */

import {
	HOVER_INTENT_MS,
	addResizeCursorOverlay,
	removeResizeCursorOverlay,
} from "@shared/components/common/resizable-divider";
import { keyboardTarget } from "@shared/components/common/resizable-divider-geometry";
import {
	TooltipContent,
	TooltipPortal,
	TooltipProvider,
	TooltipRoot,
	TooltipTrigger,
} from "@shared/components/ui/tooltip";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import { CHAT_MEASURE_OVERRIDE_VAR } from "../chat-measure";
import {
	CHAT_MEASURE_MAX_PX,
	CHAT_MEASURE_MIN_PX,
	draggedChatMeasureWidth,
	releasedChatMeasureWidth,
	renderedChatMeasureWidth,
} from "../chat-measure-drag";

/**
 * What the strip says when the pointer comes to rest on it - and when the
 * separator takes focus, which is the same panel.
 *
 * Sentence case, the app's own voice (`"Click to set the working directory"`,
 * `"Fork from this message"`), and TWO sentences rather than a middot-separated
 * clause: the app has 84 tooltip strings and not one of them uses `·` (the
 * transcript footer's separator), while two-clause tooltips are already a shape
 * here (`"Runs on this computer. Nothing is uploaded."`). The family's own
 * separators read the same way (`"Resize canvas. Double-click resets the shared
 * pane width."`), so this now says it in the register a reader has already met
 * (design round 1's D4, UX round 1's U4).
 *
 * It names BOTH ways to reset because BOTH readers get it: focus opens this
 * panel, and a keyboard reader - who has no double-click - is the one person for
 * whom the reset is otherwise unnamed (design round 1's D1, UX round 1's U2).
 * `Enter` is the key the separator's own key map binds, so the panel and the
 * widget cannot disagree about it. The rest of the keys stay on
 * `aria-keyshortcuts` and the mounts' labels, which is the channel that carries
 * them.
 */
const TOOLTIP = "Drag to resize. Double-click or Enter to reset.";

/**
 * The panel's dwell on the POINTER's channel, and why it is not `TOOLTIP_DELAY_MS`.
 *
 * The operator's complaint is that hovering "parks a box over prose". The box is
 * the reset's only mouse channel (design round 1's D1, UX round 1's U2), so it
 * cannot simply go - but it should not arrive during a casual sweep past the
 * gutter, which is what the app's 400ms tooltip beat does. 1200ms is
 * `agents-sidebar.tsx`'s `ROW_TOOLTIP_DELAY_MS`, the app's existing answer to
 * "only once the pointer has decided to stay", so this borrows a dwell the tree
 * already carries rather than inventing a third one. The property is exported
 * nowhere: it is this panel's beat, and the family's 400ms is still the right one
 * for the 200 tooltips that are not standing next to the reader's prose.
 *
 * It gates the MOUSE channel only. Keyboard focus still opens the panel at once
 * (`onFocus` below), which is deliberate and is the one thing not to "simplify":
 * focus is a decision the reader has already made, and a keyboard reader has no
 * double-click with which to discover the reset, so their channel is the loudest
 * state on purpose (design round 1's D1).
 */
const MEASURE_PANEL_DWELL_MS = 1200;

/**
 * The panel's anchor: a 16px-tall box at the hand's own Y.
 *
 * A POINT, not the separator, and that is the fix for M1/D3/U3 rather than a
 * preference - see `publishAnchorY` for what the separator's own rect did on a
 * scrolling transcript. 16px is the band's own width, so the box is square-ish
 * and reads as "here", not as a second control.
 */
const ANCHOR_HEIGHT_PX = 16;

/**
 * The bar's height, as ONE number.
 *
 * The reference's texture is a 2px bar whose ink is a solid core with a fade each
 * side - 16px of core and 28px of fade, 72px in all. The operator's follow-up
 * asks for that same texture TALLER ("something similar to the previous bar but
 * just taller so that it's a bit more visible and indicative of the
 * constraint"), and the settled answer is 160: the whole shape scaled x2.22,
 * chosen against rendered frames of 72 and 160 side by side rather than by
 * argument. The operator ruled out the two other registers explicitly - a
 * full-height rule, and (by "similar to the previous bar") a mark that is not a
 * bar at all.
 *
 * The TOTAL is named on its own and the split is named separately, because "a
 * longer core" and "longer fades" are different asks at the same height; the
 * fade is DERIVED so the three numbers cannot disagree, and moving the height
 * again is a TWO-number swap (`CUE_BAR_PX` and `CUE_CORE_PX` together; the fade
 * follows), because a longer bar at the reference's proportions scales the core
 * as well - see the block below.
 *
 * Whatever this holds, the cue is never a full-height rule: the ink stays a
 * fraction of the column, and `docs/evidence/chat-measure-hover/`'s README
 * records the extent the committed pair actually paints.
 */
const CUE_BAR_PX = 160;
/**
 * The solid core, and the fade each side, of `CUE_BAR_PX`'s total ink.
 *
 * THE EXTRA LENGTH GOES INTO BOTH, PROPORTIONALLY. The reference texture is 16px
 * of core in 72px of ink (a 1:1.75 core-to-fade split); 72 -> 160 is a scale of
 * 2.22, so the core goes 16 -> 36 and each fade 28 -> 62. Scaling the whole shape
 * is what keeps this "the previous bar, taller" rather than a different mark: a
 * fixed 16px core stretched to 160px reads as a long faint smear with a dot in
 * it (less indicative of the constraint, not more), and growing only the core
 * reads as a rule with soft ends (the register the operator ruled out). Measured
 * on the rendered story, and against the committed frames: the gradient declares
 * `CUE_BAR_PX`, and the frames paint 148px of the mark in the dark palette and
 * 152px in the light - 148..152 across the two, a figure that survives a
 * re-shoot, where naming one palette's row count does not (the outermost stops
 * are fully transparent, so what the camera catches is a couple of rows short of
 * the declared span). Against those frames it is 17% of a
 * realistic 911px column and 52% of the story's own 307px one - never a
 * full-height rule.
 *
 * THE ONE BOUND WORTH KNOWING: the length is a FIXED px, so the ink is only a
 * fraction while the column is taller than it. Measured bounds, both ends: 17% of
 * a realistic 911px column (a full window's transcript), and 52% of this
 * component's own story column (307px) - which is SHORTER than the app's minimum
 * pane (a 600px window is a 572px CSS viewport), so the story's share is the
 * conservative end, not a case a user reaches. The ink is never a full-height
 * rule in any of them. If a future pane can be shorter than `CUE_BAR_PX`, cap it
 * against the column height rather than raising this number.
 */
const CUE_CORE_PX = 36;
const CUE_FADE_PX = (CUE_BAR_PX - CUE_CORE_PX) / 2;

/**
 * The custom property the core is centred on DURING A GESTURE, and the length
 * it falls back to when nothing has seated it.
 *
 * `--lo-chat-measure-cue-y` is the FIRST cut of this cue's own property, a
 * pointer-Y publication on the wrapper that the full-height rule retired along
 * with the bar. It comes back under the same name on purpose: the mechanism is
 * the same one, and a second name for it would be a second thing to keep in step.
 * What differs is the shape it feeds - a gradient stop rather than a mark's `top`
 * - and the fact that it is written and REMOVED per gesture rather than held.
 *
 * THE FALLBACK IS NOT `50%`, and that is the fix for round 1's blocker (design
 * D1-1, UX U1). `50%` is the middle of the COLUMN, and the column is the whole
 * transcript: on any conversation taller than the pane it is hundreds of pixels
 * outside the visible band, so the cue painted off-screen while its `opacity`
 * read 1. The rest seat is the SAME Y the tooltip panel anchors to (`anchorY` -
 * the hand's entry Y on the pointer's path, `visibleAnchorY()` on the keyboard's)
 * and the render hands that in as this fallback, so the resting bar is inside
 * the pane by construction rather than by luck. `50%` survives only as the
 * degenerate fallback for a handle that is not inside a transcript at all.
 */
const CUE_Y_VAR = "--lo-chat-measure-cue-y";
const CUE_Y_REST = "50%";

/**
 * Keep the core's own span inside the element it is painted on.
 *
 * THE GESTURE IS THE ONLY SEAT THAT NEEDS THIS (agent review round 1's R1-4,
 * reproduced in the story rather than taken as derived). The stops are `y ± 80`
 * and `y ± 18`; once the published Y is more than `CUE_BAR_PX / 2` outside the
 * box, every stop clamps past the end of the gradient line and - because the
 * first and last stops are `transparent` - the element paints NOTHING while
 * `dragging` is still true and the cue's `opacity` is still 1. The hand only has
 * to leave the column by more than half the bar (e.g. up toward the title bar,
 * or below a short pane) for the "you are moving this" mark to disappear.
 *
 * The CORE is what is held in, not the whole bar: the core is the part that has
 * to stay visible for the mark to read as a mark, and letting the fades be
 * clipped at the element's edge keeps the bar pinned to the boundary the hand
 * has left, which is the honest reading - rather than sliding it fully inboard,
 * which would detach it from the hand altogether.
 *
 * AND IT IS HELD IN THE VISIBLE PART OF THE ELEMENT TOO (agent round 2's R2-5,
 * which asked for the choice to be made rather than left implicit). The element
 * is the COLUMN, and on a conversation taller than the pane the column's top is
 * hundreds of pixels above the scroller - so a core held in the column alone can
 * still sit behind the clip on a tall transcript, which is R1-4's disappearance
 * one box further out. The mark is held in the intersection instead: it still
 * tracks the hand (this is what the fades clipping at a boundary buys), and it
 * stops at the pane's edge rather than vanishing behind it. A drag is the one
 * seat the reader is MOVING, so hand-truth is what its clamp protects.
 */
const clampCueY = (y: number, height: number): number => {
	const core = CUE_CORE_PX / 2;
	if (height <= CUE_CORE_PX) return Math.round(height / 2);
	return Math.round(Math.min(Math.max(y, core), height - core));
};

/** The wrapper's own coordinates of the part of it a reader can see. */
type Band = { top: number; bottom: number };

/**
 * The slice of the wrapper that is actually on screen, in the wrapper's own
 * coordinates - the intersection of the column's box with the scroller's.
 *
 * WHY NOT THE WRAPPER'S OWN BOX (round 1's blocker, design D1-1 / UX U1). The
 * wrapper IS the column: on a conversation taller than the pane its top is
 * hundreds of pixels above the scroller (the transcript is bottom-anchored), so a
 * seat taken from the wrapper alone paints off-screen while the mark's `opacity`
 * reads 1. Everything that has to land in front of the reader - the panel's
 * anchor and the mark's seat - is measured against this intersection instead.
 * `null` (no transcript ancestor, e.g. a story that mounts the handle bare)
 * leaves the caller in its own coordinate space, which is the pre-existing
 * behaviour rather than a new failure.
 */
const visibleBand = (el: HTMLElement | null): Band | null => {
	const scroller = el?.closest("[data-lo-canonical-transcript]");
	if (!el || !scroller) return null;
	const own = el.getBoundingClientRect();
	const pane = scroller.getBoundingClientRect();
	const top = Math.max(own.top, pane.top) - own.top;
	const bottom = Math.min(own.bottom, pane.bottom) - own.top;
	return bottom > top ? { top, bottom } : null;
};

/**
 * Hold a point `half` px clear of the band's edges, so a mark of that half-size
 * seated on it fits on screen.
 *
 * THE MARK'S HALF, not the core's, for the seat: it is a value the reader did
 * not steer (design round 2's D2-1 - entering the gutter 6px below the pane's
 * top painted 80 of the mark's 160 rows, "a bar sliced off at the pane's
 * boundary with no upper fade"), so it is the whole mark that has to read. A
 * band too short to hold it centres rather than inverting, which is the answer
 * `clampCueY` gives for an element shorter than the core.
 */
const clampToBand = (y: number, band: Band | null, half: number): number => {
	if (!band) return y;
	if (band.bottom - band.top <= half * 2)
		return Math.round((band.top + band.bottom) / 2);
	return Math.round(Math.min(Math.max(y, band.top + half), band.bottom - half));
};

/**
 * Publish the hand's Y to the wrapper, or take the publication back.
 *
 * Written onto the WRAPPER rather than the line element so the value and the
 * rectangle it is measured against come from the same node: the caller hands in
 * `pointerY - wrapper.top`, and a second node would be a second frame to keep in
 * step with the first. This is `preview()`'s discipline - a `mousemove`-rate
 * React render is a cost this component has already decided not to pay - and it
 * is why `cueY` is not state.
 *
 * `clientHeight` is read here rather than cached at the press because the
 * wrapper's box is the COLUMN's, and a horizontal drag reflows the prose inside
 * it: both the top the callers measure against and the height this clamps to can
 * move for the length of one gesture (the scroller is `flex-col-reverse`, so
 * growing content moves the column's top). The read is on a node the previous
 * `mousemove`'s own `preview()` write has already forced, so it costs no second
 * layout flush.
 */
const publishCueY = (
	el: HTMLElement | null,
	y: number | null,
	band: Band | null,
): number | null => {
	if (!el) return null;
	if (y === null) {
		el.style.removeProperty(CUE_Y_VAR);
		return null;
	}
	const seat = clampToBand(
		clampCueY(y, el.clientHeight),
		band,
		CUE_CORE_PX / 2,
	);
	el.style.setProperty(CUE_Y_VAR, `${seat}px`);
	return seat;
};

/**
 * The bar's paint, as one linear gradient down the line element's own height.
 *
 * The ELEMENT keeps the column's full height and 2px width - the geometry the
 * `data-lo-chat-measure-line` attribute, the placement classes and the band's
 * containment are all pinned against - and only its INK is `CUE_BAR_PX`. Sizing
 * the element to `CUE_BAR_PX` instead would animate layout on every state
 * change, which is the note `resizable-divider.tsx` carries for its own line, so
 * the cue is a gradient stop and the element's only remaining transition is
 * `opacity`.
 *
 * `role` is a CSS value, not a class: the two steps are `control` (grabbable)
 * and `accent` (moving), read as the theme's own custom properties, so the paint
 * cannot drift from the token the rest of the family uses.
 *
 * `restY` is a CSS length the core sits on when no gesture is publishing one -
 * the anchor seat the component hands in, and the reason a resting bar is inside
 * the pane on a scrolled transcript (see `CUE_Y_VAR`).
 */
const cuePaint = (role: string, restY: string): string => {
	const y = `var(${CUE_Y_VAR}, ${restY})`;
	const core = CUE_CORE_PX / 2;
	const outer = core + CUE_FADE_PX;
	return `linear-gradient(to bottom, transparent calc(${y} - ${outer}px), ${role} calc(${y} - ${core}px), ${role} calc(${y} + ${core}px), transparent calc(${y} + ${outer}px))`;
};

export type ChatMeasureHandleProps = {
	/** Which edge of the column this handle sits on. */
	edge: "left" | "right";
	/**
	 * The width the gesture starts from: the reader's own width if they have one,
	 * else the shipped measure - NOT the width on screen, which a narrow pane may
	 * have clamped. See `chat-measure-drag.ts` for why that distinction is the
	 * difference between a drag and a bug.
	 */
	width: number;
	/** Commit a width the reader chose. */
	onWidthChange: (width: number) => void;
	/** Forget the reader's width and go back to the shipped measure. */
	onReset: () => void;
	/** The separator's accessible name. Required, for the divider's own reason. */
	label: string;
};

export const ChatMeasureHandle: FC<ChatMeasureHandleProps> = ({
	edge,
	width,
	onWidthChange,
	onReset,
	label,
}) => {
	const [hovering, setHovering] = useState(false);
	const [dragging, setDragging] = useState(false);
	const draggingRef = useRef(false);
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	/**
	 * The Y the mark rests on, and the Y the tooltip panel anchors to, in px from
	 * the wrapper's top: the hand's own Y - published on entry, and ADOPTED at the
	 * release so the seat never moves while the mark is lit (UX round 2's U6) - or
	 * the middle of the column's VISIBLE slice for the keyboard path, where there
	 * is no hand. `null` before either has happened, and again once the hand has
	 * left, which the render reads as the wrapper's own middle.
	 */
	const [anchorY, setAnchorY] = useState<number | null>(null);
	/**
	 * The seat this gesture's last `mousemove` published, or `null` if it has not
	 * published one. The release adopts this rather than recomputing the hand's Y:
	 * the wrapper's own box can move under the gesture (a width change reflows the
	 * prose inside it), and a recomputed seat is a second number that can disagree
	 * with the one the mark was painting when the hand let go.
	 */
	const lastSeat = useRef<number | null>(null);
	/** Whether the panel is open. See `openPanelSoon` and the render block. */
	const [panelOpen, setPanelOpen] = useState(false);
	const panelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// A pending panel timer that fires after unmount would set state on a dead
	// component; clearing it is the whole lifecycle this needs (the divider's own
	// cleanup, one timer further over).
	useEffect(
		() => () => {
			if (panelTimer.current) clearTimeout(panelTimer.current);
		},
		[],
	);
	/**
	 * The wrapper the line and the strip are positioned inside.
	 *
	 * It reads the pane's geometry (`paneWidthPx`) and is the box both children
	 * anchor to: `inset-0` of it is the column itself, which is what lets the
	 * line land on the measure's real edge without a second measurement.
	 */
	const rootRef = useRef<HTMLDivElement>(null);

	/*
	 * The reader is looking at the cue while they drag, so it stays lit for the
	 * whole gesture; the hover timer only governs the resting case.
	 */
	const lit = hovering || dragging;

	/*
	 * WHERE THE BAR RESTS - and why it is not `50%`. `50%` is the middle of the
	 * COLUMN, and the column is the whole transcript: on a conversation taller
	 * than the pane it is hundreds of pixels off-screen, so the cue painted
	 * nothing while its `opacity` read `1` (round 1's blocker - design D1-1, UX
	 * U1, reproduced independently by both). The seat is the SAME Y the tooltip
	 * panel anchors to - the hand's entry Y on the pointer's path
	 * (`publishAnchorY`), the visible band's middle on the keyboard's
	 * (`visibleAnchorY`) - so a resting bar is inside the pane by construction
	 * rather than by luck, and a hover that becomes a drag does not jump, because
	 * both seats come from the same hand. A hand's entry near the band's own edge is
	 * held `CUE_BAR_PX / 2` clear of it, which is the other half of the same
	 * guarantee: the seat stayed on screen and the mark's ENDS did not (design round
	 * 2's D2-1).
	 *
	 * THE SEAT IS NAMED BY WHICHEVER HAND LAST CHOSE IT, and a release chooses it too:
	 * the Y the gesture ended on, adopted rather than handed back to the entry Y, so
	 * the seat does not move while the mark is lit (UX round 2's U6 - see
	 * `onMouseUp`). Leaving, and losing focus, are what clear it.
	 *
	 * `CUE_Y_REST` survives only as the degenerate fallback: a null `anchorY`
	 * means neither channel has seated the cue, which in this tree happens only on
	 * a handle that is not inside a transcript at all.
	 */
	const cueSeat = anchorY === null ? CUE_Y_REST : `${anchorY}px`;

	/**
	 * Publish the hand's Y, ONCE, as the tooltip panel's anchor.
	 *
	 * THE ANCHOR IS A POINT, NOT THE SEPARATOR, and that is a fix rather than a
	 * preference (agent review round 1's M1, UX round 1's U3, design round 1's D3).
	 * Radix places the panel against its anchor's rect, and the separator's rect is
	 * the CONTENT column's height - which for any conversation that scrolls has its
	 * top and bottom outside the pane. Measured on a scrolling transcript (1060x620
	 * window, 240px pane, 12 prose blocks): the panel landed at y 1473..1500
	 * mid-scroll and at y -49..-22 scrolled to the bottom, i.e. nowhere a reader can
	 * see it, and at y 230..257 pinned to the TOP position past the pane's own
	 * bottom edge. A 16px box at the hand keeps every placement inside the pane.
	 *
	 * ONCE, and not per pointer move: a panel that chased the hand would be the same
	 * twitch this file's cue-Y publication was written to avoid, and it is what keeps
	 * the box cheap - written on entry, read by the popper, never re-measured.
	 */
	const publishAnchorY = (clientY: number): void => {
		const el = rootRef.current;
		if (!el) return;
		const own = el.getBoundingClientRect();
		setAnchorY(
			clampToBand(
				Math.round(clientY - own.top),
				visibleBand(el),
				CUE_CORE_PX / 2 + CUE_FADE_PX,
			),
		);
	};

	/**
	 * The Y of the column's VISIBLE middle, for the keyboard path.
	 *
	 * Focus opens the panel and there is no hand to anchor it to, while the
	 * wrapper's own middle is the CONTENT's middle - the same off-pane seat M1
	 * measured. This intersects the column's box with the scroller's and takes the
	 * middle of what is actually on screen, so a keyboard reader gets the panel
	 * beside the separator they just focused. `null` (the CSS fallback, the
	 * wrapper's own middle) only if the two do not overlap at all, which a
	 * rendered handle cannot be.
	 */
	const visibleAnchorY = (): number | null => {
		const band = visibleBand(rootRef.current);
		return band === null ? null : Math.round((band.top + band.bottom) / 2);
	};

	/*
	 * The panel's dwell, on the panel's own beat rather than the app's tooltip
	 * constant: it is a tooltip, but a slow one - see `MEASURE_PANEL_DWELL_MS` for
	 * what a 400ms arrival cost beside the reader's prose. Leaving closes it at
	 * once, for the reason the divider's own comment gives - a panel that lingers
	 * after the pointer has gone reads as stuck.
	 */
	const openPanelSoon = (): void => {
		if (panelTimer.current) clearTimeout(panelTimer.current);
		panelTimer.current = setTimeout(
			() => setPanelOpen(true),
			MEASURE_PANEL_DWELL_MS,
		);
	};
	const closePanel = (): void => {
		if (panelTimer.current) clearTimeout(panelTimer.current);
		setPanelOpen(false);
	};

	/** Publish a width to the document without committing it to the store. */
	const preview = (next: number | null): void => {
		const root = document.documentElement;
		if (next === null) root.style.removeProperty(CHAT_MEASURE_OVERRIDE_VAR);
		else root.style.setProperty(CHAT_MEASURE_OVERRIDE_VAR, `${next}px`);
	};

	/**
	 * The width the pane can SHOW for the column: the content box of the
	 * transcript's scroll container, which the column is `w-full` of and which
	 * the render clamps the cap against (see `releasedChatMeasureWidth`, which
	 * asks this same question before writing).
	 *
	 * READ FROM THE SCROLLER, NOT RE-DERIVED FROM CONSTANTS. The window between
	 * the pane and the column is HOST-DEPENDENT: measured, the story host gives
	 * its scroller overlay scrollbars, the gutter reservation is zero, and the
	 * window is 32px (the `p-4` alone) - while a host with classic scrollbars
	 * reserves the 8px gutter on each edge on top, so the same pane leaves 48px.
	 * `clientWidth` minus the scroller's own computed paddings answers with the
	 * host's real numbers for both, which no fixed inset could.
	 *
	 * `null` when the host cannot answer - no scroller, no layout, no computed
	 * styles (a jsdom render) - and the release then falls back to committing,
	 * the behaviour this feature shipped with: a travelled width is only ever
	 * refused when the render is KNOWN to be unable to show it.
	 */
	const paneWidthPx = (): number | null => {
		if (typeof getComputedStyle !== "function") return null;
		const scroller = rootRef.current?.closest("[data-lo-canonical-transcript]");
		if (!scroller) return null;
		const style = getComputedStyle(scroller);
		const left = Number.parseFloat(style.paddingLeft);
		const right = Number.parseFloat(style.paddingRight);
		if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
		const pane = scroller.clientWidth - left - right;
		return pane > 0 ? pane : null;
	};

	/*
	 * THE PREVENTDEFAULT MUST LAND IN THE CAPTURE PHASE, which is why the render
	 * block binds this as `onKeyDownCapture` and not `onKeyDown`.
	 *
	 * The transcript scroller registers a NATIVE bubble-phase `keydown` listener
	 * (`use-scroll-paging.ts`), and the handles are DOM descendants of that
	 * scroller: React's delegated bubble handlers run at the root container,
	 * which is an ANCESTOR of the scroller, so a bubble-phase `preventDefault`
	 * reached the paging guard (`event.defaultPrevented`) too late - Home/End
	 * paged the transcript before this handler resized the column (review,
	 * finding 3). React's capture-phase delegation also runs at the root
	 * container, but in the capture descent, before any bubble listener on an
	 * ancestor, so the guard sees the flag this handler sets first.
	 */
	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		/*
		 * THE STEP STARTS FROM WHAT THE RENDER SHOWS WHEN THE COLUMN IS CLAMPED
		 * (UX round 3's U8; measured: judging every press from the STORED width
		 * left the first `ArrowLeft` landing at 1084 - which draws the same 968
		 * and was refused - with the next press starting over from 1100, a 132px
		 * dead zone against a 64px coarse step that no keyboard sequence could
		 * cross, while a pointer drag crosses it in one gesture). `min(width,
		 * panePx)` IS the rendered width: the first press lands at 952, visible
		 * and committed, and every following press moves the column. Roomy panes
		 * are unchanged - there `min(width, panePx)` is `width` itself - and a
		 * host that cannot answer (`null`) steps from the stored width, as the
		 * release falls back to committing.
		 */
		const panePx = paneWidthPx();
		const base =
			panePx === null ? width : renderedChatMeasureWidth(width, panePx);
		/*
		 * `undefined` is the shared map declining a key this widget does not own;
		 * `null` is Enter (the caller's own default). See the file comment for the
		 * two register choices.
		 */
		const target = keyboardTarget(event.key, {
			shiftKey: event.shiftKey,
			value: base,
			min: CHAT_MEASURE_MIN_PX,
			max: CHAT_MEASURE_MAX_PX,
			side: "right",
			homeEnd: "value",
		});
		if (target === undefined) return;
		event.preventDefault();
		if (target === null) {
			/*
			 * `Enter` is deliberately NOT under the guard below: the reset abandons
			 * the measure rather than stepping to a width.
			 */
			onReset();
			return;
		}
		/*
		 * THE NO-INVISIBLE-WRITE PROPERTY, on the release rule's own arithmetic
		 * (`renderedChatMeasureWidth`): a step whose target draws exactly the
		 * width already on screen is refused before the write - the store,
		 * `aria-valuenow` and the override property all untouched. With the
		 * rendered base above, the steps that fail this test at a clamped column
		 * are growth at the pane's edge (`ArrowRight`, `End`): there is nothing
		 * wider to show, and nothing is written for it.
		 */
		if (
			panePx !== null &&
			renderedChatMeasureWidth(target, panePx) ===
				renderedChatMeasureWidth(base, panePx)
		) {
			return;
		}
		onWidthChange(target);
	};

	const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		/*
		 * THE RESET IS DECIDED AT THE PRESS, not on `dblclick`.
		 *
		 * `resizable-divider.tsx` uses `onDoubleClick`, and that works there
		 * because nothing else happens on a press. Here a press STARTS A DRAG, so
		 * the second press of a double-click would otherwise begin a second drag
		 * and the reset would race the gesture it is meant to replace. Measured:
		 * with `onDoubleClick` the reset never ran at all - the rig
		 * (`scripts/chat-measure-drag-evidence.mjs`) read the stored width back
		 * unchanged after a full two-press sequence - which is the difference
		 * between a reset and a reset that only looks wired.
		 *
		 * `detail` is the click count the browser already maintains, so this needs
		 * no timer of its own: 2 on the second press of a double-click, and 1 on
		 * every other press.
		 */
		if (event.detail >= 2) {
			onReset();
			return;
		}
		const startX = event.clientX;
		const startWidth = width;
		/*
		 * The value the property held before this gesture, restored verbatim on a
		 * release that commits nothing. Captured rather than recomputed from the
		 * store because this component must not need the store to be correct: what
		 * it must put back is exactly what it found.
		 */
		const prior = document.documentElement.style.getPropertyValue(
			CHAT_MEASURE_OVERRIDE_VAR,
		);
		draggingRef.current = true;
		setDragging(true);
		document.body.style.userSelect = "none";
		addResizeCursorOverlay("col-resize");

		/*
		 * The release handler takes no event: it is registered on `window`, whose
		 * listener type is `Event`, and a `mouseup` that lands outside the window
		 * (a release over the desktop) arrives with no coordinates at all. The last
		 * position the pointer was SEEN at is therefore what a release is resolved
		 * against, which is also the position the column was last previewed at -
		 * so what is committed is always what the reader last saw.
		 */
		let lastClientX = startX;
		/*
		 * This gesture has published no seat yet, so a release after a press that never
		 * travelled adopts nothing (see `onMouseUp`). Cleared at the PRESS rather than
		 * after the release so a second gesture cannot inherit the first one's number.
		 */
		lastSeat.current = null;
		/*
		 * The pane's box, in VIEWPORT coordinates, read once per gesture. It is what the
		 * publication is held inside (agent round 2's R2-5), and it is stable for the
		 * length of a drag - the wrapper's own top is NOT, because a width change
		 * reflows the prose inside the scroller - so the per-move conversion below is
		 * arithmetic against the wrapper rect this handler already reads, rather than a
		 * second pair of rect reads on the pointer's path.
		 */
		const pane =
			rootRef.current
				?.closest("[data-lo-canonical-transcript]")
				?.getBoundingClientRect() ?? null;

		const onMouseMove = (moveEvent: MouseEvent) => {
			if (!draggingRef.current) return;
			lastClientX = moveEvent.clientX;
			/*
			 * The core travels with the hand for the length of the gesture. Read
			 * against the WRAPPER's top, which is the box the gradient's percentage
			 * resolves against, so "the hand's Y" means the same thing to the source
			 * and the sink.
			 */
			const wrapper = rootRef.current;
			if (wrapper) {
				const own = wrapper.getBoundingClientRect();
				lastSeat.current = publishCueY(
					wrapper,
					Math.round(moveEvent.clientY - own.top),
					pane
						? { top: pane.top - own.top, bottom: pane.bottom - own.top }
						: null,
				);
			}
			preview(
				draggedChatMeasureWidth({
					startWidth,
					deltaX: lastClientX - startX,
					edge,
				}),
			);
		};

		const onMouseUp = () => {
			if (!draggingRef.current) return;
			draggingRef.current = false;
			setDragging(false);
			setHovering(false);
			/*
			 * THE SEAT STAYS UNDER THE HAND AT THE RELEASE; the hand's LEAVE is what sends
			 * it back to rest (UX round 2's U6).
			 *
			 * Taking the gesture's publication back here - which is what this did - hands
			 * the seat straight back to the Y the hand ENTERED at, and on a drag that
			 * travelled that is a different Y: for one frame the mark was fully lit at a
			 * seat the hand had left, and the next frame put it back (measured at 60fps:
			 * core 282 -> 112 -> 282 inside ~17ms, `opacity` reading 1.000 on the first
			 * two). The release ADOPTS the seat the gesture ended on instead, so the mark
			 * never moves while it is lit; `onMouseLeave` and `onBlur` remain what retires
			 * a seat, so a stationary mark is never left on a hand that has gone.
			 */
			if (lastSeat.current !== null) setAnchorY(lastSeat.current);
			publishCueY(rootRef.current, null, null);
			document.body.style.userSelect = "";
			removeResizeCursorOverlay();
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("blur", onMouseUp);
			document.documentElement.removeEventListener("mouseleave", onMouseUp);

			/*
			 * THE RENDER CONSULTATION, before the write (UX round 2's U4; agent round
			 * 2's R2-1): the release rule refuses a width the pane cannot show, so
			 * the pane is read HERE, at the release - not captured at the press,
			 * because the question is what the render can show NOW. See
			 * `releasedChatMeasureWidth` for the rule and `paneWidthPx` for the
			 * reading; a host that cannot answer falls back to the pane that cannot
			 * clamp, which commits the travelled width as before.
			 */
			const committed = releasedChatMeasureWidth({
				startWidth,
				deltaX: lastClientX - startX,
				edge,
				panePx: paneWidthPx() ?? Number.POSITIVE_INFINITY,
			});
			if (committed === null) {
				/*
				 * NOTHING is committed, for one of two reasons - and both put the
				 * preview back so the column does not keep a width nobody chose:
				 * the press did not travel (committing here is what turns a
				 * double-click into a permanent narrowing, because the value a
				 * gesture starts from is the width the PANE allows on a small
				 * window), or the travelled width renders exactly the column already
				 * on screen (the render consultation above: no pixel would move, so
				 * the store may not move either).
				 */
				if (prior === "") preview(null);
				else preview(Number.parseFloat(prior));
				return;
			}
			onWidthChange(committed);
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("blur", onMouseUp);
		document.documentElement.addEventListener("mouseleave", onMouseUp);
	};

	return (
		/*
		 * A FULL-COLUMN WRAPPER, transparent to the pointer, holding the state
		 * line and the widget as children.
		 *
		 * The wrapper used to BE the strip - a 10px box the separator filled, with
		 * the cue nested inside it. It spans the column now, and the two reasons for
		 * that are one decision:
		 *
		 *  - **The state line belongs on the measure's real edge and the grab target
		 *    hugs it from the gutter side** (see the band's own comment: it was 24px
		 *    out, which measured as a dead zone between the mark and the only place
		 *    that responded). One box cannot be both, so the box is the column and
		 *    each child is placed against it.
		 *  - **This box's own edge IS the measure's edge.** It is mounted inside
		 *    `data-lo-transcript-content`, the centred
		 *    `max-w-[var(--lo-chat-measure)]` column `chat-measure.ts` owns, so
		 *    `left-0`/`right-0` here is the boundary the issue asks the line to read
		 *    as, and the no-offset anchor the band and the line are both placed from.
		 *
		 * IT MUST NOT TAKE THE POINTER: a full-column box that did would swallow
		 * every click and every selection in the transcript. `pointer-events-none`
		 * here and `pointer-events-auto` on the separator is the pairing that keeps
		 * the target while the box stays transparent.
		 *
		 * The line and the widget are SIBLINGS rather than one nested in the other,
		 * and that is not cosmetic: `role="separator"` on an element with children
		 * is refused by the repo's own lint (`useSemanticElements` reads it as "this
		 * should be an `<hr>`", which is true only because an `<hr>` cannot hold a
		 * child, and an `<hr>` cannot be a focusable adjustable separator at all).
		 * Keeping the line outside the widget makes both true instead of suppressing
		 * the check.
		 */
		<div
			ref={rootRef}
			className={cn(
				/*
				 * `hidden` below the same `@min-[750px]/chatcol` gate the measure's
				 * application wears: below it the column takes the pane and there is
				 * nothing to resize (agent review round 1's R1-1). The line and the
				 * separator are the wrapper's children, so one class removes the paint
				 * AND the tab stop out of the band together.
				 */
				"hidden @min-[750px]/chatcol:block absolute inset-0 z-10",
				"pointer-events-none",
			)}
		>
			{/*
			 * The state line: the reference's fade bar, at the measure's real edge.
			 * Full height and 2px WIDE, `opacity-0` at rest, `control` on hover,
			 * `accent` while dragging - but only `CUE_BAR_PX` of INK, a solid core fading
			 * out each side, which is what makes this a hint rather than the full-height
			 * rule it replaced. Opacity is the only animated property:
			 * animating the element's size would animate layout, and a gradient's
			 * stops are not interpolated, so the core snaps to the hand instead of
			 * sliding behind it (the same note is on `resizable-divider.tsx`'s line).
			 *
			 * IT SITS JUST OUTSIDE THE COLUMN: `-left-0.5` / `-right-0.5` puts the
			 * line's INNER edge on this wrapper's own edge - the measure's edge - so
			 * the whole 2px lands in the gutter beside the text. The divider can draw
			 * its line inside the panel's edge because every panel it sizes carries its
			 * own inset; the chat column carries none (its inset is the scroller's
			 * `p-4` and the 8px gutter), so an inside rule would cross the first glyph.
			 * See the file comment for why this reads as the boundary.
			 *
			 * The element is FULL HEIGHT although the ink is not, because the attribute,
			 * the placement and the band's containment are all read off this node; a
			 * bar-sized box would move every one of those readings with the pointer's Y.
			 */}
			<div
				aria-hidden="true"
				data-lo-chat-measure-line={edge}
				className={cn(
					"pointer-events-none absolute top-0 z-12 h-full w-0.5",
					"transition-opacity duration-fast ease-out-quart",
					edge === "left" ? "-left-0.5" : "-right-0.5",
					lit ? "opacity-100" : "opacity-0",
				)}
				style={{
					backgroundImage: cuePaint(
						dragging ? "var(--color-accent)" : "var(--color-control)",
						cueSeat,
					),
				}}
			/>
			{/*
			 * The widget: a 10px band that HUGS the drawn line from the gutter side.
			 *
			 * IT HUGS THE LINE, and that is the fix for UX round 1's U1, which the
			 * design round's D2 flagged and the reviewer's own reading agreed with: the
			 * band used to sit 24px out in the gutter, which left a 22px dead zone
			 * between the only thing on screen that promises adjustability and the only
			 * place that responded - a press ON the mark did nothing, where the shipped
			 * bar was grabbable. Every one of the app's five family dividers puts its
			 * band OVER its line; this does too now, on the side the line is drawn on:
			 * `-left-2.5` / `-right-2.5` spans the 10px immediately outboard of the
			 * column's edge, so a press anywhere on the 2px rule starts the drag.
			 *
			 * AND IT STILL NEVER REACHES INWARD past the column's edge, which is what
			 * the old offset existed for: the band cannot sit over text, and the
			 * fold-row corner the flush variant once overlapped by 8x20px (design round
			 * 1's D2) is untouched. The gutter it occupies is the 24px the measure
			 * itself reserves - the scroller's `p-4` plus the 8px scrollbar gutter - so
			 * the 10px is always there, which is why the `max(-34px, calc((100% -
			 * 100cqw) / 2))` clamp went with the offset it was compensating for.
			 *
			 * `touch-none` so a trackpad drag sizes the column instead of scrolling the
			 * transcript underneath, and `pointer-events-auto` because the wrapper above
			 * is transparent to the pointer by design. The `z-11` under the line's
			 * `z-12` is the family's own paint order (`resizable-divider.tsx`).
			 *
			 * WHAT A READER MEETS IN THE BAND, stated so the record stands on its own:
			 * a press starts a measure drag rather than reaching the scrollbar
			 * underneath, while SCROLLING IS UNTOUCHED - the wheel and the keyboard are
			 * not pointer presses, so the band cannot intercept either.
			 */}
			<div
				role="separator"
				data-lo-chat-measure-handle={edge}
				aria-label={label}
				/*
				 * The keys, machine-readable (UX round 1's U2): `aria-keyshortcuts` is
				 * the app's existing spelling for this (`message-input.tsx`,
				 * `sidebar-navigation.tsx`), and the mounts' labels carry the same
				 * story for screen readers in prose.
				 */
				aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Home End Enter"
				aria-orientation="vertical"
				aria-valuenow={Math.round(width)}
				aria-valuemin={CHAT_MEASURE_MIN_PX}
				aria-valuemax={CHAT_MEASURE_MAX_PX}
				tabIndex={0}
				className={cn(
					"pointer-events-auto absolute top-0 z-11 h-full w-2.5 cursor-col-resize touch-none",
					edge === "left" ? "-left-2.5" : "-right-2.5",
				)}
				onMouseEnter={(event) => {
					publishAnchorY(event.clientY);
					openPanelSoon();
					if (hoverTimer.current) clearTimeout(hoverTimer.current);
					hoverTimer.current = setTimeout(
						() => setHovering(true),
						HOVER_INTENT_MS,
					);
				}}
				onMouseLeave={() => {
					if (hoverTimer.current) clearTimeout(hoverTimer.current);
					closePanel();
					if (!draggingRef.current) {
						setHovering(false);
						/*
						 * The rest seat belongs to the hand that chose it, so it is cleared with
						 * the hand and the next entry publishes its own. This is also the event
						 * that retires a released drag's seat (see `onMouseUp`): the release
						 * adopts the seat the gesture ended on, and this is what stops a
						 * stationary mark sitting on a hand that has gone. A drag is the
						 * exception WHILE IT RUNS - the pointer leaves the band constantly
						 * mid-gesture, and the publication is the hand's for the length of it.
						 */
						setAnchorY(null);
					}
				}}
				onFocus={() => {
					setHovering(true);
					/*
					 * No hand on this path, so anchor to what is visible - but only when a hand
					 * has not already seated the mark. A press focuses this element (it is
					 * `tabIndex={0}`), and re-seating unconditionally moved the mark out from
					 * under a POINTER reader on any entry that was not the band's middle: the
					 * same "the seat moves while the mark is lit" failure as the release flash
					 * in `onMouseUp`.
					 */
					setAnchorY((current) => current ?? visibleAnchorY());
					/*
					 * Focus opens it at once, the way Radix opens on focus for every
					 * other tooltip in the app (measured `instant-open`); the dwell
					 * below is the pointer's.
					 */
					setPanelOpen(true);
				}}
				onBlur={() => {
					closePanel();
					if (!draggingRef.current) {
						setHovering(false);
						/* The keyboard's seat is the focus's, and it leaves with it. */
						setAnchorY(null);
					}
				}}
				onKeyDownCapture={onKeyDown}
				onMouseDown={(event) => {
					/* A drag owns the pointer: no panel rides over the column. */
					closePanel();
					onMouseDown(event);
				}}
			/>
			{/*
			 * The tooltip's ANCHOR and its panel.
			 *
			 * The parts are the app's own - `ui/tooltip.tsx` exports them for
			 * "anything unusual", and this is: 201 tooltips in the tree, and this is
			 * the first whose anchor box would be taller than the pane clipping it.
			 * The anchor is a bounded 16px box at the hand's Y rather than the
			 * separator, which is what keeps the panel on screen at every scroll
			 * position (see `publishAnchorY`).
			 *
			 * THE OPEN STATE IS OURS, and the anchor is `pointer-events-none` paint:
			 * the strip's own hover and focus decide when the panel exists, at the
			 * app's own dwell. A Radix trigger that the pointer never reaches cannot
			 * open anything by itself, which is exactly what we want here - the
			 * alternative (a hoverable anchor box) would take the pointer off the
			 * strip it is meant to be marking.
			 *
			 * The provider is local because a Radix root requires one and this subtree
			 * holds no other tooltip, so shadowing an app-level provider costs no
			 * shared grace period. `side="top"` is the app's default: the panel sits
			 * just above the hand, on the edge it is marking.
			 */}
			<TooltipProvider>
				<TooltipRoot open={panelOpen} onOpenChange={setPanelOpen}>
					<TooltipTrigger asChild>
						<div
							data-lo-chat-measure-anchor={edge}
							className={cn(
								"pointer-events-none absolute w-2.5",
								edge === "left" ? "-left-2.5" : "-right-2.5",
							)}
							style={{
								top: anchorY === null ? "50%" : `${anchorY}px`,
								height: ANCHOR_HEIGHT_PX,
								transform: "translateY(-50%)",
							}}
						/>
					</TooltipTrigger>
					<TooltipPortal>
						<TooltipContent side="top">{TOOLTIP}</TooltipContent>
					</TooltipPortal>
				</TooltipRoot>
			</TooltipProvider>
		</div>
	);
};
