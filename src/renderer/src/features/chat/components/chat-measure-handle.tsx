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
 *  - **The cue is the app's ONE resize language, and that is a REVISION.** It
 *    was a short bar centred on the pointer's Y, borrowed from
 *    `deepseek-harness`; the operator's report (issue #848, 2026-10-06) was
 *    that a 72px mark floating in the transcript's empty margin reads as "a
 *    mistake" rather than as the column's boundary. It is now the same
 *    full-height 2px state line the five panel dividers draw
 *    (`shared/components/common/resizable-divider.tsx`): invisible at rest,
 *    `control` on hover after the same `HOVER_INTENT_MS` intent delay (imported,
 *    not restated), `accent` while dragging, using the divider's own class idiom
 *    (`transition-[opacity,background-color] duration-fast ease-out-quart`). One
 *    language for every resize edge in the app is worth more than the bar's
 *    borrowed proportions, and the contract already carries the two roles'
 *    floors (`border-control`/`accent`, 3:1 on every ground).
 *  - **The line does not chase the pointer at all.** A mark that follows the
 *    hand reports the hand; a full-height rule reports the edge at every Y, and
 *    that is what lets it read as a boundary rather than as a cue. So the
 *    pointer-Y publication is gone (`--lo-chat-measure-cue-y` with it) - and
 *    with it the "must not flicker" problem the bar's fixed-on-entry Y existed
 *    to solve: there is nothing left that could twitch.
 *  - **Drawn immediately OUTSIDE the measure's edge, not inside it.** The
 *    divider draws its line on the sized panel's leading/trailing edge, and it
 *    can, because every panel it sizes carries its own inset. The chat column
 *    carries none - its inset is the scroller's `p-4` plus the 8px gutter - so
 *    its edge is exactly where the first glyph starts, and a rule drawn inside
 *    would cross the text. The 2px line therefore sits with its inner edge ON
 *    the boundary and its whole width in the gutter beside it, which is what
 *    makes the column's edge legible as an edge.
 *  - **The handle is OUTSIDE the column, floating 24px clear of it.** The strip
 *    sits in the gutter the measure already reserves (`p-4` + the 8px scrollbar
 *    gutter = 24px per side in `chat-measure.ts`), 24px out from the content
 *    edge - the reference's own offset - 10px wide, with the cue another 4px in
 *    again (28px from the longest glyph). So it can never swallow a click meant
 *    for the text underneath, because there is never text underneath it - the
 *    guarantee is geometric rather than something a z-index or a hit-test has
 *    to keep true. The flush variant this first shipped with DID swallow one:
 *    design round 1's D2 measured it over the fold-row button's hit box by
 *    8x20px, which is why the offset is part of the design, not decoration.
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
 *    (design round 1's D1). The parts are the app's own (`ui/tooltip.tsx` exports
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
	TOOLTIP_DELAY_MS,
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
 * `"Fork from this message"`), and it names both ways to reset because BOTH
 * readers get it: focus opens this panel, and a keyboard reader - who has no
 * double-click - is the one person for whom the reset is otherwise unnamed
 * (design round 1's D1, UX round 1's U2). `Enter` is the key the separator's own
 * key map binds, so the panel and the widget cannot disagree about it. The rest
 * of the keys stay on `aria-keyshortcuts` and the mounts' labels, which is the
 * channel that carries them.
 */
const TOOLTIP = "Drag to resize · double-click or Enter to reset";

/**
 * The panel's anchor: a 16px-tall box at the hand's own Y.
 *
 * A POINT, not the separator, and that is the fix for M1/D3/U3 rather than a
 * preference - see `publishAnchorY` for what the separator's own rect did on a
 * scrolling transcript. 16px is the band's own width, so the box is square-ish
 * and reads as "here", not as a second control.
 */
const ANCHOR_HEIGHT_PX = 16;

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
	 * The Y the tooltip panel is anchored to, in px from the wrapper's top: the
	 * hand's own Y published once on entry, or the middle of the column's VISIBLE
	 * slice for the keyboard path, where there is no hand. `null` before either has
	 * happened, which the render reads as the wrapper's own middle.
	 */
	const [anchorY, setAnchorY] = useState<number | null>(null);
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
		setAnchorY(Math.round(clientY - el.getBoundingClientRect().top));
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
		const el = rootRef.current;
		const scroller = el?.closest("[data-lo-canonical-transcript]");
		if (!el || !scroller) return null;
		const own = el.getBoundingClientRect();
		const pane = scroller.getBoundingClientRect();
		const top = Math.max(own.top, pane.top);
		const bottom = Math.min(own.bottom, pane.bottom);
		if (!(bottom > top)) return null;
		return Math.round((top + bottom) / 2 - own.top);
	};

	/*
	 * The panel's dwell, on the app's TOOLTIP constant rather than the divider's:
	 * it is the same panel as every other tooltip in the app and should arrive on
	 * the same beat (measured at 409ms before this change, and 400 is the number
	 * that produced it). Leaving closes it at once, for the reason the divider's
	 * own comment gives - a panel that lingers after the pointer has gone reads as
	 * stuck.
	 */
	const openPanelSoon = (): void => {
		if (panelTimer.current) clearTimeout(panelTimer.current);
		panelTimer.current = setTimeout(() => setPanelOpen(true), TOOLTIP_DELAY_MS);
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

		const onMouseMove = (moveEvent: MouseEvent) => {
			if (!draggingRef.current) return;
			lastClientX = moveEvent.clientX;
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
			 * The state line: the divider family's drawing, at the measure's real edge.
			 * Full height, 2px, `opacity-0` at rest, `control` on hover, `accent` while
			 * dragging. Opacity and colour are the only animated properties - animating
			 * width would animate layout (the same note is on
			 * `resizable-divider.tsx`'s line).
			 *
			 * IT SITS JUST OUTSIDE THE COLUMN: `-left-0.5` / `-right-0.5` puts the
			 * line's INNER edge on this wrapper's own edge - the measure's edge - so
			 * the whole 2px lands in the gutter beside the text. The divider can draw
			 * its line inside the panel's edge because every panel it sizes carries its
			 * own inset; the chat column carries none (its inset is the scroller's
			 * `p-4` and the 8px gutter), so an inside rule would cross the first glyph.
			 * See the file comment for why this reads as the boundary.
			 */}
			<div
				aria-hidden="true"
				data-lo-chat-measure-line={edge}
				className={cn(
					"pointer-events-none absolute top-0 z-12 h-full w-0.5",
					"transition-[opacity,background-color] duration-fast ease-out-quart",
					edge === "left" ? "-left-0.5" : "-right-0.5",
					dragging ? "bg-accent" : "bg-control",
					lit ? "opacity-100" : "opacity-0",
				)}
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
					if (!draggingRef.current) setHovering(false);
				}}
				onFocus={() => {
					setHovering(true);
					/* No hand on this path: anchor to what is visible. */
					setAnchorY(visibleAnchorY());
					/*
					 * Focus opens it at once, the way Radix opens on focus for every
					 * other tooltip in the app (measured `instant-open`); the dwell
					 * below is the pointer's.
					 */
					setPanelOpen(true);
				}}
				onBlur={() => {
					closePanel();
					if (!draggingRef.current) setHovering(false);
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
