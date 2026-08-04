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
 * The line is information, not decoration: invisible at rest, a 2px accent
 * line on hover or drag. It is the only thing saying "this gap is grabbable",
 * and the state change is why it appears. The old version faded a
 * semi-transparent divider colour in and out and thickened 1px to 3px; a
 * constant-width accent line carries the same two states without animating
 * layout, and the 2px radius is gone with the width change.
 */

import { cn } from "@shared/lib/utils";
import { useRef, useState } from "react";

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
	const [active, setActive] = useState(false);
	const dragging = useRef(false);

	const onMouseDown = (e: React.MouseEvent) => {
		e.preventDefault();
		dragging.current = true;
		setActive(true);
		const startX = e.clientX;
		const startWidth = sidebarWidth;

		// Disable text selection and show global resize cursor overlay
		document.body.style.userSelect = "none";
		addResizeCursorOverlay();

		const onMouseMove = (moveEvent: MouseEvent) => {
			if (!dragging.current) return;
			const delta = moveEvent.clientX - startX;
			const rawWidth =
				side === "right" ? startWidth + delta : startWidth - delta;
			const newWidth = Math.max(minWidth, Math.min(maxWidth, rawWidth));
			onSidebarWidthChange(newWidth);
		};

		const onMouseUp = () => {
			if (!dragging.current) return;
			dragging.current = false;
			setActive(false);

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

	const showActive = active;

	return (
		<div className="relative z-10 h-full w-0 shrink-0">
			{/* The grabbable-state line. Opacity only: width would animate layout. */}
			<div
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute top-0 z-12 h-full w-0.5 bg-accent transition-opacity duration-fast ease-out-quart",
					side === "left" ? "left-0" : "right-0",
					showActive ? "opacity-100" : "opacity-0",
				)}
			/>
			{/* Constant-width hit area, so the cursor is stable near the edge. */}
			<div
				className={cn(
					"absolute top-0 z-11 h-full w-3 cursor-col-resize",
					side === "left" ? "-left-1.5" : "-right-1.5",
				)}
				onMouseEnter={() => setActive(true)}
				onMouseLeave={() => {
					if (!dragging.current) {
						setActive(false);
					}
				}}
				onMouseDown={onMouseDown}
				onDoubleClick={onDoubleClick}
				aria-orientation="vertical"
				tabIndex={-1}
			/>
		</div>
	);
};
