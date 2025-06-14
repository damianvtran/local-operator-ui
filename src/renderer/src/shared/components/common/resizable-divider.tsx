// Start of Selection
import { Box, alpha, styled } from "@mui/material";
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
 * Flex item for the divider, does not take up space but anchors the overlay
 */
const DividerFlexItem = styled(Box)({
	position: "relative",
	width: 0,
	height: "100%",
	flexShrink: 0,
	zIndex: 10,
});

/**
 * Hover/click area for the divider (constant width to ensure stable cursor)
 */
const DividerHoverArea = styled(Box, {
	shouldForwardProp: (prop) => prop !== "$active" && prop !== "$side",
})<{
	$active: boolean;
	$side: "left" | "right";
}>(({ $side }) => ({
	position: "absolute",
	top: 0,
	left: $side === "left" ? -6 : "auto",
	right: $side === "right" ? -6 : "auto",
	width: 12,
	height: "100%",
	cursor: "col-resize",
	background: "none",
	zIndex: 11,
}));

/**
 * Styled thin divider line
 */
const DividerLine = styled(Box, {
	shouldForwardProp: (prop) => prop !== "$active" && prop !== "$side",
})<{ $side: "left" | "right"; $active: boolean }>(
	({ theme, $side, $active }) => ({
		position: "absolute",
		top: 0,
		[$side]: 0,
		width: $active ? "3px" : "1px",
		height: "100%",
		background: $active
			? theme.palette.mode === "dark"
				? theme.palette.primary.light
				: theme.palette.primary.main
			: alpha(theme.palette.divider, 0.7),
		borderRadius: 2,
		pointerEvents: "none",
		zIndex: 12,
		opacity: $active ? 1 : 0,
		transition:
			"width 0.2s cubic-bezier(0.4,0,0.2,1), background 0.2s, opacity 0.2s",
	}),
);

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
		<DividerFlexItem>
			<DividerLine $side={side} $active={showActive} />
			<DividerHoverArea
				$active={showActive}
				$side={side}
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
			>
			</DividerHoverArea>
		</DividerFlexItem>
	);
};
