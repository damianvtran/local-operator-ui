/**
 * Drag handle between resizable panels.
 *
 * The pointer logic is unchanged: mouse down captures, move clamps the width,
 * up (or window blur, or the pointer leaving the document) releases, and a
 * full-viewport overlay keeps `col-resize` on screen for the whole drag
 * because the cursor otherwise flickers back to whatever it crosses.
 *
 * The handle has no keyboard affordance and never had one: it is
 * `tabIndex={-1}` and out of the tab order, so there is no keyboard resize to
 * preserve. Panel sizes are not exposed to the keyboard anywhere else either
 * — that is a gap this port does not silently fix.
 *
 * The line is information, not decoration: invisible at rest, then two
 * distinct states. Hover promotes it to `control`, which means "this gap is
 * grabbable"; dragging promotes it to `accent`, which means "you are moving
 * it now". One colour for both said only "something is happening here".
 *
 * Hover is delayed 200ms. The gap between the conversation and the canvas is
 * crossed constantly on the way to the panel, and an instant accent line
 * flashed on every pass — the accent is spent about three times a screen and
 * a flicker is not one of them. Leaving is instant, because a control that
 * lingers after the pointer has gone reads as stuck.
 *
 * ## Keyboard
 *
 * The handle is a real `separator` widget: focusable, arrow keys move it by
 * 16px, Shift by 64, Home and End go to the bounds, and Enter restores the
 * default when the caller supplies one. It reports `aria-valuenow/min/max`, so
 * a screen reader can say how wide the panel is. This is a behaviour addition
 * — the old handle was `tabIndex={-1}` with no keyboard path at all, which
 * meant panel width was simply unavailable without a mouse.
 */

/** Arrow-key resize step, and the coarse step Shift selects. */
const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_COARSE = 64;

/**
 * How long the pointer must rest in the gap before the handle lights up.
 * Long enough to ignore a pass-through, short enough to feel immediate when
 * you are actually reaching for it.
 */
const HOVER_INTENT_MS = 200;

import { cn } from "@shared/lib/utils";
import { useEffect, useRef, useState } from "react";

let cursorOverlay: HTMLDivElement | null = null;

const addResizeCursorOverlay = (): void => {
	if (!cursorOverlay) {
		cursorOverlay = document.createElement("div");
		Object.assign(cursorOverlay.style, {
			position: "fixed",
			top: "0",
			left: "0",
			width: "100vw",
			height: "100vh",
			cursor: "col-resize",
			zIndex: "9999",
		});
		document.body.appendChild(cursorOverlay);
	}
};

const removeResizeCursorOverlay = (): void => {
	if (cursorOverlay) {
		document.body.removeChild(cursorOverlay);
		cursorOverlay = null;
	}
};

/**
 * Props for the ResizableDivider component
 */
export type ResizableDividerProps = {
	sidebarWidth: number;
	onSidebarWidthChange: (width: number) => void;
	minWidth?: number;
	maxWidth?: number;
	/**
	 * Which side the divider is anchored to: "left" (default) or "right"
	 * - "left": for a right panel (e.g., canvas), divider is on the left edge of the panel
	 * - "right": for a left sidebar, divider is on the right edge of the panel
	 */
	side?: "left" | "right";
	/**
	 * Optional double-click handler for restoring default width
	 */
	onDoubleClick?: () => void;
};

/**
 * Resizable divider between panels.
 * Anchored to the left or right edge, with correct drag direction.
 */
export const ResizableDivider = ({
	sidebarWidth,
	onSidebarWidthChange,
	minWidth = 180,
	maxWidth = 600,
	side = "right",
	onDoubleClick,
}: ResizableDividerProps) => {
	const [hovering, setHovering] = useState(false);
	const [dragging, setDragging] = useState(false);
	const draggingRef = useRef(false);
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// A pending hover timer that fires after unmount would set state on a dead
	// component; clearing it on unmount is the whole lifecycle this needs.
	useEffect(
		() => () => {
			if (hoverTimer.current) clearTimeout(hoverTimer.current);
		},
		[],
	);

	const clamp = (width: number) =>
		Math.max(minWidth, Math.min(maxWidth, width));

	const resizeBy = (delta: number) => {
		// "Wider" is away from the panel's anchored edge, so a left-anchored
		// panel grows as the divider moves left.
		onSidebarWidthChange(
			clamp(sidebarWidth + (side === "right" ? delta : -delta)),
		);
	};

	const onKeyDown = (event: React.KeyboardEvent) => {
		const step = event.shiftKey ? KEYBOARD_STEP_COARSE : KEYBOARD_STEP;
		switch (event.key) {
			case "ArrowLeft":
				event.preventDefault();
				resizeBy(-step);
				return;
			case "ArrowRight":
				event.preventDefault();
				resizeBy(step);
				return;
			case "Home":
				event.preventDefault();
				onSidebarWidthChange(side === "right" ? minWidth : maxWidth);
				return;
			case "End":
				event.preventDefault();
				onSidebarWidthChange(side === "right" ? maxWidth : minWidth);
				return;
			case "Enter":
				if (onDoubleClick) {
					event.preventDefault();
					onDoubleClick();
				}
				return;
			default:
		}
	};

	const onMouseDown = (e: React.MouseEvent) => {
		e.preventDefault();
		draggingRef.current = true;
		setDragging(true);
		const startX = e.clientX;
		const startWidth = sidebarWidth;

		// Disable text selection and show global resize cursor overlay
		document.body.style.userSelect = "none";
		addResizeCursorOverlay();

		const onMouseMove = (moveEvent: MouseEvent) => {
			if (!draggingRef.current) return;
			const delta = moveEvent.clientX - startX;
			const rawWidth =
				side === "right" ? startWidth + delta : startWidth - delta;
			onSidebarWidthChange(clamp(rawWidth));
		};

		const onMouseUp = () => {
			if (!draggingRef.current) return;
			draggingRef.current = false;
			setDragging(false);
			setHovering(false);

			// Re-enable text selection and remove cursor overlay
			document.body.style.userSelect = "";
			removeResizeCursorOverlay();

			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("blur", onMouseUp);
			document.documentElement.removeEventListener("mouseleave", onMouseUp);
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("blur", onMouseUp);
		document.documentElement.addEventListener("mouseleave", onMouseUp);
	};

	const lit = hovering || dragging;

	return (
		<div className="relative z-10 h-full w-0 shrink-0">
			{/*
			 * The state line. Opacity and colour only: animating width would
			 * animate layout, and the gap is 1px of the chat column.
			 */}
			<div
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute top-0 z-12 h-full w-0.5",
					"transition-[opacity,background-color] duration-fast ease-out-quart",
					side === "left" ? "left-0" : "right-0",
					dragging ? "bg-accent" : "bg-control",
					lit ? "opacity-100" : "opacity-0",
				)}
			/>
			{/*
			 * Constant-width hit area, so the cursor is stable near the edge, and
			 * wider than the line it operates: 12px is the target, 2px is the
			 * feedback. `touch-none` stops a trackpad drag scrolling the panel
			 * underneath instead of resizing it.
			 */}
			<div
				role="separator"
				aria-label="Resize canvas"
				aria-orientation="vertical"
				aria-valuenow={Math.round(sidebarWidth)}
				aria-valuemin={minWidth}
				aria-valuemax={maxWidth}
				tabIndex={0}
				className={cn(
					"absolute top-0 z-11 h-full w-3 cursor-col-resize touch-none",
					side === "left" ? "-left-1.5" : "-right-1.5",
				)}
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
				onKeyDown={onKeyDown}
				onMouseDown={onMouseDown}
				onDoubleClick={onDoubleClick}
			/>
		</div>
	);
};
