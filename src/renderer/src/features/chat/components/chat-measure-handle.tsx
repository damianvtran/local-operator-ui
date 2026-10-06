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
 *    1's U2), while the strip now carries a tooltip naming the drag and the
 *    double-click reset (`TOOLTIP` below). The tooltip is the app's own
 *    `Tooltip` over the same trigger element, so it composes with this
 *    component's own hover/focus handlers instead of replacing them; Radix
 *    closes it on `pointerdown`, so a drag does not carry a panel over the
 *    column it is resizing.
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
import { Tooltip } from "@shared/components/ui/tooltip";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { useRef, useState } from "react";
import { CHAT_MEASURE_OVERRIDE_VAR } from "../chat-measure";
import {
	CHAT_MEASURE_MAX_PX,
	CHAT_MEASURE_MIN_PX,
	draggedChatMeasureWidth,
	releasedChatMeasureWidth,
	renderedChatMeasureWidth,
} from "../chat-measure-drag";

/**
 * What the strip says when the pointer comes to rest on it.
 *
 * Sentence case, the app's own voice (`"Click to set the working directory"`,
 * `"Fork from this message"`), and it names exactly the two gestures a POINTER
 * has here: the drag, and the double-click reset. The keys are not repeated -
 * they are the separator's announced channel (`aria-keyshortcuts` and the
 * mounts' labels), which is where a screen reader reads them.
 */
const TOOLTIP = "Drag to resize · double-click to reset";

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
		 *  - **The state line belongs on the measure's real edge and the hit target
		 *    belongs 24px out in the gutter** (design round 1's D2: the strip must
		 *    never sit over text, or it swallows a click meant for the row
		 *    underneath). One 10px box cannot be both, so the box is the column and
		 *    each child is placed against it.
		 *  - **This box's own edge IS the measure's edge.** It is mounted inside
		 *    `data-lo-transcript-content`, the centred
		 *    `max-w-[var(--lo-chat-measure)]` column `chat-measure.ts` owns, so
		 *    `left-0`/`right-0` here is the boundary the issue asks the line to read
		 *    as - and `100%` of this box is the column's width, which is what the
		 *    strip's own clamp is written against.
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
					"pointer-events-none absolute top-0 h-full w-0.5",
					"transition-[opacity,background-color] duration-fast ease-out-quart",
					edge === "left" ? "-left-0.5" : "-right-0.5",
					dragging ? "bg-accent" : "bg-control",
					lit ? "opacity-100" : "opacity-0",
				)}
			/>
			{/*
			 * The widget, wrapped in the app's `Tooltip` so the pointer is told what
			 * the strip does (the drag) and what the reset is. Radix wraps the
			 * SEPARATOR itself (`asChild`), so this adds the tooltip without adding a
			 * node, and it composes with the handlers below rather than replacing them.
			 *
			 * The band: 10px wide, full height, `touch-none` so a trackpad drag sizes
			 * the column instead of scrolling the transcript underneath, and
			 * `pointer-events-auto` because the wrapper above is transparent to the
			 * pointer by design.
			 *
			 * THE CLASS IS THE FALLBACK AND THE STYLE IS THE CLAMP. `deepseek-harness`
			 * can hold a fixed 24px offset because its cap is dynamic (content <= column
			 * minus its edge budget), so side room always exists; this app's cap is
			 * fixed, and at the widest the room is smaller than 34px - the strip would
			 * slide off the pane and the handle would become unreachable (measured:
			 * box -18..-8, `elementFromPoint` null). So the inset is `max(-34px, (100%
			 * - 100cqw) / 2)`: 34px out while the pane's own side space allows it,
			 * sliding flush at the widths where it does not. If `cqw` ever fails to
			 * resolve the declaration is invalid and the class above still holds the
			 * 34px offset.
			 *
			 * The strip floats 24px OUT from the content edge - the reference's own
			 * offset - so the target never covers text. The flush variant this first
			 * shipped with sat on the fold-row button's hit box by 8x20px (design round
			 * 1's D2); the offset is part of the design, not decoration.
			 *
			 * AT THE CLAMP the strip shares the pane's outermost 10px with the 8px
			 * scrollbar gutter the app reserves at that edge (UX round 1's U3): with no
			 * side room there is no other 10px on that edge that is not over text, so
			 * the share is a bounded consequence of the flush case rather than a
			 * separate choice. WHAT A READER MEETS IN THAT 10px, stated so this record
			 * stands on its own (UX round 2's U5): a press there starts a measure drag
			 * rather than reaching the scrollbar underneath, while SCROLLING IS
			 * UNTOUCHED - the wheel and the keyboard are not pointer presses, so the
			 * strip cannot intercept either.
			 */}
			<Tooltip content={TOOLTIP}>
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
						"absolute top-0 h-full w-2.5 cursor-col-resize touch-none pointer-events-auto",
						edge === "left" ? "-left-[34px]" : "-right-[34px]",
					)}
					style={{
						[edge === "left" ? "left" : "right"]:
							"max(-34px, calc((100% - 100cqw) / 2))",
					}}
					onMouseEnter={() => {
						if (hoverTimer.current) clearTimeout(hoverTimer.current);
						hoverTimer.current = setTimeout(
							() => setHovering(true),
							HOVER_INTENT_MS,
						);
					}}
					onMouseLeave={() => {
						if (hoverTimer.current) clearTimeout(hoverTimer.current);
						if (!draggingRef.current) setHovering(false);
					}}
					onFocus={() => setHovering(true)}
					onBlur={() => {
						if (!draggingRef.current) setHovering(false);
					}}
					onKeyDownCapture={onKeyDown}
					onMouseDown={onMouseDown}
				/>
			</Tooltip>
		</div>
	);
};
