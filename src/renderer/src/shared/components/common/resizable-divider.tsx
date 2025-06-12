import { Box, alpha, styled } from "@mui/material";
import { useRef, useState } from "react";

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
 * Hover/click area for the divider (centered, does not take up layout space)
 */
const DividerHoverArea = styled(Box, {
	shouldForwardProp: (prop) => prop !== "$active" && prop !== "$side",
})<{
	$active: boolean;
	$side: "left" | "right";
}>(({ $active, $side }) => ({
	position: "absolute",
	top: 0,
	[$side]: 0,
	transform: "none",
	width: $active ? 32 : 16,
	height: "100%",
	cursor: "col-resize",
	pointerEvents: "auto",
	background: "none",
	zIndex: 11,
	transition: "width 0.2s cubic-bezier(0.4,0,0.2,1)",
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
 * Styled drag handle (appears on hover)
 */
const DragHandle = styled(Box, {
	shouldForwardProp: (prop) => prop !== "$active",
})<{ $active: boolean }>(({ theme, $active }) => ({
	position: "absolute",
	left: "50%",
	top: "50%",
	transform: "translate(-50%, -50%)",
	width: 12,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	pointerEvents: "none",
	opacity: $active ? 1 : 0,
	transition: "opacity 0.2s",
	zIndex: 13,
	"& .grip": {
		width: 12,
		height: 36,
		borderRadius: 4,
		background: $active
			? alpha(theme.palette.primary.main, 0.18)
			: alpha(theme.palette.action.selected, 0.18),
		border: $active
			? `1px solid ${theme.palette.primary.main}`
			: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
		display: "flex",
		flexDirection: "column",
		justifyContent: "center",
		alignItems: "center",
		gap: 2,
		padding: 4,
		transition: "background 0.2s, border 0.2s, box-shadow 0.2s",
	},
	"& .grip-dot": {
		width: 2,
		height: 2,
		minHeight: 2,
		borderRadius: "50%",
		background: $active
			? theme.palette.mode === "dark"
				? theme.palette.primary.light
				: theme.palette.primary.main
			: alpha(theme.palette.text.primary, 0.32),
		margin: "1px 0",
		transition: "background 0.2s",
	},
}));

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

	// Mouse event handlers for resizing
	const onMouseDown = (e: React.MouseEvent) => {
		dragging.current = true;
		setActive(true);
		const startX = e.clientX;
		const startWidth = sidebarWidth;

		// Disable text selection while dragging
		document.body.style.userSelect = "none";

		const onMouseMove = (moveEvent: MouseEvent) => {
			if (!dragging.current) return;
			const delta = moveEvent.clientX - startX;
			let newWidth: number;
			if (side === "right") {
				// Sidebar on the left, drag right increases width
				newWidth = startWidth + delta;
			} else {
				// Canvas on the right, drag left increases width
				newWidth = startWidth - delta;
			}
			newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
			onSidebarWidthChange(newWidth);
		};

		const onMouseUp = () => {
			dragging.current = false;
			setActive(false);

			// Re-enable text selection
			document.body.style.userSelect = "";

			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	};

	// Show handle and divider on hover or while dragging
	const showActive = active;

	return (
		<DividerFlexItem>
			<DividerLine $side={side} $active={showActive} />
			<DividerHoverArea
				$active={showActive}
				$side={side}
				onMouseEnter={() => setActive(true)}
				onMouseLeave={() => !dragging.current && setActive(false)}
				onMouseDown={onMouseDown}
				onDoubleClick={onDoubleClick}
				aria-orientation="vertical"
				tabIndex={-1}
			>
				<DragHandle $active={showActive}>
					<span className="grip">
						<span className="grip-dot" />
						<span className="grip-dot" />
						<span className="grip-dot" />
					</span>
				</DragHandle>
			</DividerHoverArea>
		</DividerFlexItem>
	);
};
