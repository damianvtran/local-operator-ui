/**
 * Drag handle between resizable panels.
 *
 * The pointer logic is unchanged: mouse down captures, move clamps the width,
 * up (or window blur, or the pointer leaving the document) releases, and a
 * full-viewport overlay keeps `col-resize` on screen for the whole drag
 * because the cursor otherwise flickers back to whatever it crosses.
 *
 * The handle IS keyboard-reachable, and the paragraph that used to stand here
 * said the opposite — "no keyboard affordance and never had one: it is
 * `tabIndex={-1}` and out of the tab order". The `## Keyboard` section below
 * describes the key map that exists, and the handle has been `tabIndex={0}`
 * with that map for as long as it has existed. The DOCSTRING was the stale
 * half, not the code: corrected here rather than left beside a working key
 * map, because a file that argues with itself is where the next reader
 * believes the wrong half — and the next reader of this file is somebody
 * adding an axis to it.
 *
 * ## Two axes
 *
 * `orientation` names the axis the separator runs along and `side` the edge it
 * sits on, and they are ONE choice rather than two independent props: the
 * props type is a union, so a call site cannot ask for a vertical axis on a
 * top edge. Every axis-dependent site reads one of the two — the sign and the
 * position from `side`, the cursor, the key set, `aria-orientation` and which
 * dimension the band occupies from `orientation` — and the pair being
 * consistent is what keeps those from disagreeing silently.
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
 *
 * The keys are AXIS-MATCHED: a vertical handle owns Left/Right and a
 * horizontal one Up/Down. It must not own both. The chat sidebar's list walks
 * its rows on Up/Down and jumps to the first and last on Home/End
 * (`chat-sidebar.tsx`'s `keyDown`), and that walk checks `defaultPrevented`
 * nowhere — so a key this handle consumes has to be stopped here, and a key it
 * does not own has to be left alone rather than swallowed.
 */

/**
 * How long the pointer must rest in the gap before the handle lights up.
 * Long enough to ignore a pass-through, short enough to feel immediate when
 * you are actually reaching for it.
 *
 * EXPORTED because the chat sidebar's collapse cluster is revealed on the same
 * intent, one level up: the cluster is a sibling of this separator rather than
 * a child, so it cannot inherit the state, and a second delay written beside
 * the first is two numbers a later change can put out of step (review round 1,
 * M-1: the shipped build revealed the plate after 120ms of CSS while this line
 * waited 200ms, and the PR body claimed the delay was already there).
 */
export const HOVER_INTENT_MS = 200;

import { cn } from "@shared/lib/utils";
import { useEffect, useRef, useState } from "react";
import { dragTarget, keyboardTarget } from "./resizable-divider-geometry";

let cursorOverlay: HTMLDivElement | null = null;

/*
 * The overlay is one node for the whole document, created on the first drag and
 * removed when it ends. The CURSOR is assigned on every drag rather than on the
 * node's creation: the node is created fresh each time (its teardown nulls the
 * module reference), so the assignment is what gives the new node its cursor -
 * and stating it per drag is also what keeps a missed `mouseup` from leaving the
 * previous drag's cursor in place for the next one.
 */
const addResizeCursorOverlay = (cursor: "col-resize" | "row-resize"): void => {
	if (!cursorOverlay) {
		cursorOverlay = document.createElement("div");
		Object.assign(cursorOverlay.style, {
			position: "fixed",
			top: "0",
			left: "0",
			width: "100vw",
			height: "100vh",
			zIndex: "9999",
		});
		document.body.appendChild(cursorOverlay);
	}
	cursorOverlay.style.cursor = cursor;
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
	/**
	 * The size of the panel this separator sizes, ALONG THE SEPARATOR'S AXIS: a
	 * width for a vertical separator and a height for a horizontal one. The name
	 * predates the second axis and is kept because it already means this for a
	 * canvas dock and a run panel; renaming it would touch six call sites for no
	 * behaviour.
	 */
	sidebarWidth: number;
	onSidebarWidthChange: (width: number) => void;
	minWidth?: number;
	maxWidth?: number;
	/**
	 * Optional double-click handler for restoring default width
	 */
	onDoubleClick?: () => void;
	/**
	 * The separator's accessible name.
	 *
	 * REQUIRED rather than defaulted, because a default is how the two right-slot
	 * panes ended up sharing one hard-coded `"Resize canvas"`: the run panel's
	 * handle would have announced the canvas while the canvas's own handle sat
	 * 8px away with the same name, leaving a screen-reader user with two
	 * indistinguishable separators and no way to tell which pane each sized. A
	 * caller that cannot name what it is sizing has not finished wiring the pane.
	 */
	label: string;
} & ResizableDividerAxis;

/**
 * The axis, and the edge on it, as ONE choice.
 *
 * `side` predates the horizontal axis and its two values already name an edge;
 * `orientation` is what the axis-dependent geometry is read from. They are two
 * facts about one thing, so a flat pair of optional props could describe a
 * vertical separator on a top edge — a combination with no correct rendering,
 * because the sign and the position would read one axis while the cursor, the
 * key set and the band's dimension read the other. The union makes that a type
 * error rather than a silently half-horizontal separator.
 *
 * `horizontal` requires `side` because there is no default edge for it: the
 * vertical case defaults to `"right"` (a left sidebar), while a horizontal
 * separator with no edge would have to guess whether it sizes the region above
 * it or the one below.
 */
export type ResizableDividerAxis =
	| {
			/** Which axis the separator runs along. Defaults to `"vertical"`. */
			orientation?: "vertical";
			/**
			 * Which edge of the sized panel the divider sits on, and therefore which
			 * way "wider" runs:
			 * - `"left"`: for a right panel (e.g. the canvas), the handle is on the
			 *   panel's left edge and the panel grows leftwards;
			 * - `"right"` (default): for a left sidebar, the handle is on the panel's
			 *   right edge and the panel grows rightwards.
			 */
			side?: "left" | "right";
	  }
	| {
			/** A separator that runs horizontally, sizing a region's height. */
			orientation: "horizontal";
			/**
			 * - `"top"`: the handle is on the sized region's top edge and the region
			 *   grows upwards — the chat sidebar's list region in the default order;
			 * - `"bottom"`: the handle is on its bottom edge and the region grows
			 *   downwards — the same region once the order is inverted.
			 */
			side: "top" | "bottom";
	  };

/**
 * Resizable divider between panels.
 * Anchored to one edge of the panel it sizes, on either axis, with the correct
 * drag direction and a key map matched to that axis.
 */
export const ResizableDivider = ({
	sidebarWidth,
	onSidebarWidthChange,
	minWidth = 180,
	maxWidth = 600,
	orientation = "vertical",
	side = "right",
	onDoubleClick,
	label,
}: ResizableDividerProps) => {
	/*
	 * The axis, stated once. Every site below reads either this or `side`, and
	 * never derives one from the other: with the props narrowed to a union the
	 * two cannot disagree, and a local derivation would be a second opinion
	 * waiting to drift.
	 */
	const horizontal = orientation === "horizontal";
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

	/*
	 * The drag's arithmetic is the shared geometry module's, not this file's: the
	 * horizontal axis would otherwise be a second copy of the sign and the clamp,
	 * and a copy is what `scripts/sidebar-split.test.mjs` cannot reach. "Wider" is
	 * away from the panel's anchored edge, so a left-anchored panel grows as the
	 * divider moves left.
	 */
	const onKeyDown = (event: React.KeyboardEvent) => {
		const target = keyboardTarget(event.key, {
			shiftKey: event.shiftKey,
			value: sidebarWidth,
			min: minWidth,
			max: maxWidth,
			side,
		});
		/* Not this handle's key: leave it to whoever else is listening. */
		if (target === undefined) return;
		/* Enter with nothing to restore is not a key this handle owns either. */
		if (target === null && !onDoubleClick) return;
		event.preventDefault();
		/*
		 * `stopPropagation` because a panel's own arrow walk does not ask
		 * `defaultPrevented` before it moves focus: without this, one press would
		 * resize the region AND move the cursor to another row.
		 */
		event.stopPropagation();
		if (target === null) {
			onDoubleClick?.();
			return;
		}
		onSidebarWidthChange(target);
	};

	const onMouseDown = (e: React.MouseEvent) => {
		e.preventDefault();
		draggingRef.current = true;
		setDragging(true);
		const startX = e.clientX;
		const startY = e.clientY;
		const startWidth = sidebarWidth;

		// Disable text selection and show global resize cursor overlay
		document.body.style.userSelect = "none";
		addResizeCursorOverlay(horizontal ? "row-resize" : "col-resize");

		const onMouseMove = (moveEvent: MouseEvent) => {
			if (!draggingRef.current) return;
			/* The pointer's travel ALONG THE SEPARATOR'S AXIS. */
			const delta = horizontal
				? moveEvent.clientY - startY
				: moveEvent.clientX - startX;
			onSidebarWidthChange(
				dragTarget(startWidth, delta, side, minWidth, maxWidth),
			);
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
		<div
			className={cn(
				"relative z-10 shrink-0",
				horizontal ? "h-0 w-full" : "h-full w-0",
			)}
		>
			{/*
			 * The state line. Opacity and colour only: animating width would
			 * animate layout, and the gap is 1px of the chat column.
			 */}
			<div
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute z-12",
					horizontal ? "left-0 h-0.5 w-full" : "top-0 h-full w-0.5",
					"transition-[opacity,background-color] duration-fast ease-out-quart",
					/*
					 * The near edge, the same way the band is placed below: `side`
					 * names the edge of the SIZED PANEL the handle sits on, so
					 * `left`/`top` put the line on the box's leading edge and
					 * `right`/`bottom` on its trailing one.
					 */
					horizontal
						? side === "top"
							? "top-0"
							: "bottom-0"
						: side === "left"
							? "left-0"
							: "right-0",
					dragging ? "bg-accent" : "bg-control",
					lit ? "opacity-100" : "opacity-0",
				)}
			/>
			{/*
			 * Constant-size hit area, so the cursor is stable near the edge, and
			 * wider than the line it operates: 12px across the axis for a vertical
			 * handle and 10px for a horizontal one, against a 2px line either way.
			 * The horizontal band is narrower because it is the only one that can
			 * overlap a scroll container: the region below it carries 8px of its
			 * own padding, so 5px of band leaves every row's pixels out of the
			 * target. `touch-none` stops a trackpad drag scrolling the panel
			 * underneath instead of resizing it.
			 */}
			<div
				role="separator"
				aria-label={label}
				aria-orientation={horizontal ? "horizontal" : "vertical"}
				aria-valuenow={Math.round(sidebarWidth)}
				aria-valuemin={minWidth}
				aria-valuemax={maxWidth}
				tabIndex={0}
				className={cn(
					"absolute z-11 touch-none",
					horizontal
						? "left-0 h-2.5 w-full cursor-row-resize"
						: "top-0 h-full w-3 cursor-col-resize",
					horizontal
						? side === "top"
							? "-top-[5px]"
							: "-bottom-[5px]"
						: side === "left"
							? "-left-1.5"
							: "-right-1.5",
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
