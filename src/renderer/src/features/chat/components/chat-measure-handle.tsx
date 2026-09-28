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
 *  - **The cue is a short bar centred on the pointer's Y, not a full-height
 *    line.** A full-height rule at the column edge reads as chrome and is visible
 *    in a way "subtle" is supposed to mean it is not. `deepseek-harness` draws a
 *    2px bar with a 16px solid core fading over 28px each side, and this is that
 *    bar at this app's own tokens.
 *  - **Hover alone never moves the bar.** `:hover` shows it at the Y the pointer
 *    was at when it entered; only a DRAG publishes a new Y. That is the answer to
 *    "must not flicker": a bar that chased the pointer along the edge would
 *    twitch on every pass, and the cue would be reporting the hand rather than
 *    the edge. The pointer's Y is written once on entry rather than per move.
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
 *
 * THE TWO KEYS DEVIATE FROM THE DIVIDER, deliberately. The divider's arrows are
 * edge-relative (on a right-anchored pane ArrowRight widens it), which is right
 * for a boundary between two panes. Here there are TWO handles for ONE value, so
 * edge-relative keys would make the same physical key mean opposite things
 * depending on which handle happens to hold focus - the reader could not learn
 * it. ArrowRight widens and ArrowLeft narrows on both edges.
 */

import {
	HOVER_INTENT_MS,
	addResizeCursorOverlay,
	removeResizeCursorOverlay,
} from "@shared/components/common/resizable-divider";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { useRef, useState } from "react";
import { CHAT_MEASURE_OVERRIDE_VAR } from "../chat-measure";
import {
	CHAT_MEASURE_MAX_PX,
	CHAT_MEASURE_MIN_PX,
	draggedChatMeasureWidth,
	releasedChatMeasureWidth,
} from "../chat-measure-drag";

/** Arrow-key resize step, and the coarse step Shift selects. */
const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_COARSE = 64;

/**
 * The cue's mask geometry: the full bar, the solid core inside it, and the fade
 * each side. 72 = 28 + 16 + 28 exactly - the reference's own proportions, which
 * the file comment claims, so the three move together or the claim is wrong.
 * See the stops in the render block: they sit at the FADE, not the core.
 */
const CUE_HEIGHT_PX = 72;
const CUE_CORE_PX = 16;
const CUE_FADE_PX = (CUE_HEIGHT_PX - CUE_CORE_PX) / 2;

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
	/** The strip the cue is positioned inside. See `publishCueY`. */
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
	 * Put the pointer's own Y on the handle, so the cue lands under the hand.
	 *
	 * The property is written on the strip's WRAPPER rather than on the separator
	 * itself, because the cue is a sibling of the separator and inherits from the
	 * wrapper: see the render block for why the two are siblings.
	 */
	const publishCueY = (clientY: number): void => {
		const el = rootRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		el.style.setProperty(
			"--lo-chat-measure-cue-y",
			`${Math.round(clientY - rect.top)}px`,
		);
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
		const step = event.shiftKey ? KEYBOARD_STEP_COARSE : KEYBOARD_STEP;
		switch (event.key) {
			case "ArrowRight":
				event.preventDefault();
				onWidthChange(width + step);
				return;
			case "ArrowLeft":
				event.preventDefault();
				onWidthChange(width - step);
				return;
			case "Home":
				event.preventDefault();
				onWidthChange(CHAT_MEASURE_MIN_PX);
				return;
			case "End":
				event.preventDefault();
				onWidthChange(CHAT_MEASURE_MAX_PX);
				return;
			case "Enter":
				event.preventDefault();
				onReset();
				return;
			default:
		}
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
		publishCueY(event.clientY);

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
			publishCueY(moveEvent.clientY);
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

			const committed = releasedChatMeasureWidth({
				startWidth,
				deltaX: lastClientX - startX,
				edge,
			});
			if (committed === null) {
				/*
				 * A press that did not travel. NOTHING is committed, and that is
				 * the point: committing here is what turns a double-click into a
				 * permanent narrowing, because the value a gesture starts from is
				 * the width the PANE allows on a small window. The preview is put
				 * back so the column does not keep a width nobody chose.
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
		 * A WRAPPER, with the widget and its cue as SIBLINGS rather than the cue
		 * inside the widget - and the reason is not cosmetic. `role="separator"`
		 * on an element with children is refused by the repo's own lint
		 * (`useSemanticElements` reads it as "this should be an `<hr>`", which is
		 * true only because an `<hr>` cannot hold a child, and an `<hr>` cannot be
		 * a focusable adjustable separator at all). Keeping the cue outside the
		 * widget makes both true instead of suppressing the check: the separator
		 * is a real, childless `separator`, and the cue is paint the widget owns.
		 * The wrapper is also what carries the pointer's Y, since the cue inherits
		 * it from there.
		 */
		<div
			ref={rootRef}
			className={cn(
				"absolute top-0 z-10 h-full w-2.5",
				/*
				 * The strip floats 24px OUT from the content edge - the reference's
				 * own offset - so the cue sits 28px from the longest glyph. The
				 * flush variant this first shipped with sat on the fold-row
				 * button's hit box by 8x20px (design round 1's D2); the offset is
				 * part of the design, not decoration.
				 *
				 * THE CLASS IS THE FALLBACK AND THE STYLE IS THE CLAMP. `deepseek-harness`
				 * can hold a fixed 24px offset because its cap is dynamic (content <= column
				 * minus its edge budget), so side room always exists; this app's cap is
				 * fixed, and at the widest the room is smaller than 34px - the strip would
				 * slide off the pane and the handle would become unreachable (measured:
				 * box -18..-8, `elementFromPoint` null). So the inset is `max(-34px, (100%
				 * - 100cqw) / 2)`: 34px out while the pane's own side space allows it, and
				 * sliding flush at the widths where it does not. If `cqw` ever fails to
				 * resolve the declaration is invalid and the class above still holds the
				 * 34px offset.
				 */
				edge === "left" ? "-left-[34px]" : "-right-[34px]",
			)}
			style={{
				[edge === "left" ? "left" : "right"]:
					"max(-34px, calc((100% - 100cqw) / 2))",
			}}
		>
			{/*
			 * The cue. `pointer-events-none` because the separator is the target
			 * and this is paint; masked at the ends rather than given a gradient,
			 * so the fade is a property of the shape and not of the colour theme.
			 * The stops sit 28px in from each end - the fade, leaving the 16px
			 * core - not at the core's own edges, which would paint a 40px
			 * plateau (design round 1's D1 measured the earlier stops at 16/56
			 * against the 28/44 the reference draws).
			 */}
			<span
				aria-hidden="true"
				data-lo-chat-measure-cue={edge}
				className={cn(
					"pointer-events-none absolute w-0.5",
					/* 4px in from the strip's inner edge: 24 + 4 = the reference's 28px. */
					edge === "left" ? "right-1" : "left-1",
					dragging ? "bg-accent" : "bg-control",
					"transition-opacity duration-fast ease-out-quart",
					lit ? "opacity-100" : "opacity-0",
				)}
				style={{
					top: "var(--lo-chat-measure-cue-y, 50%)",
					height: CUE_HEIGHT_PX,
					transform: "translateY(-50%)",
					maskImage: `linear-gradient(to bottom, transparent 0, black ${CUE_FADE_PX}px, black ${CUE_HEIGHT_PX - CUE_FADE_PX}px, transparent ${CUE_HEIGHT_PX}px)`,
					WebkitMaskImage: `linear-gradient(to bottom, transparent 0, black ${CUE_FADE_PX}px, black ${CUE_HEIGHT_PX - CUE_FADE_PX}px, transparent ${CUE_HEIGHT_PX}px)`,
				}}
			/>
			{/*
			 * The widget. `inset-0` of the wrapper, so the target is the whole 10px
			 * strip and the cursor is stable across it; `touch-none` stops a
			 * trackpad drag scrolling the transcript underneath instead of sizing
			 * the column.
			 */}
			<div
				role="separator"
				data-lo-chat-measure-handle={edge}
				aria-label={label}
				aria-orientation="vertical"
				aria-valuenow={Math.round(width)}
				aria-valuemin={CHAT_MEASURE_MIN_PX}
				aria-valuemax={CHAT_MEASURE_MAX_PX}
				tabIndex={0}
				className="absolute inset-0 cursor-col-resize touch-none"
				onMouseEnter={(event) => {
					if (hoverTimer.current) clearTimeout(hoverTimer.current);
					/*
					 * The Y is published ONCE, on entry, and not on every move: see
					 * the file comment - a bar that followed the pointer would
					 * twitch.
					 */
					publishCueY(event.clientY);
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
		</div>
	);
};
