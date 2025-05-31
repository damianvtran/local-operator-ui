import {
	IconButton,
	ListItemIcon,
	Menu,
	MenuItem,
	Tooltip,
	alpha,
	styled,
} from "@mui/material";
import {
	File as FileIcon,
	FolderOpen,
	LayoutGrid,
	MoreHorizontal,
} from "lucide-react";
import { type MouseEvent, useState } from "react";

/**
 * Props for FileActionsMenu
 */
export type FileActionsMenuProps = {
	/**
	 * The file path or URI to act on.
	 */
	filePath: string;
	/**
	 * Optional: placement for the tooltip or menu trigger.
	 */
	tooltip?: string;
	/**
	 * Optional: icon to use for the trigger (defaults to MoreHorizontal).
	 */
	icon?: React.ReactNode;
	/**
	 * Optional: aria-label for accessibility.
	 */
	"aria-label"?: string;
	/**
	 * Optional: callback to show the file in the canvas.
	 */
	onShowInCanvas?: (() => void) | undefined;
};

/**
 * Styled icon button for the file actions menu, using shadcn spacing and rounded.
 */
const FileActionsIconButton = styled(IconButton)(({ theme }) => ({
	borderRadius: "0.375rem", // rounded-md
	padding: theme.spacing(0.5),
	left: theme.spacing(1),
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	transition: "background-color 0.2s",
	background: "transparent",
	"&:hover": {
		backgroundColor:
			theme.palette.mode === "dark"
				? alpha(theme.palette.common.white, 0.08)
				: alpha(theme.palette.common.black, 0.08),
	},
}));

/**
 * Styled menu using shadcn style tokens.
 */
const StyledFileActionsMenu = styled(Menu)(({ theme }) => ({
	"& .MuiPaper-root": {
		minWidth: 180, // shadcn menus are wider
		boxShadow:
			theme.palette.mode === "dark"
				? "0px 8px 32px 0px rgba(0,0,0,0.45)"
				: "0px 8px 32px 0px rgba(0,0,0,0.15)",
		borderRadius: "0.75rem", // rounded-xl
		padding: "0.25rem", // p-1
		background: theme.palette.background.paper,
	},
}));

/**
 * Styled menu item for normal actions, using shadcn spacing and font.
 */
const StyledMenuItem = styled(MenuItem)(({ theme }) => ({
	borderRadius: "0.375rem", // rounded-md
	padding: "0.5rem 0.75rem", // py-2 px-3
	fontSize: "0.875rem", // text-sm
	fontWeight: 500,
	gap: "0.75rem", // gap-3
	minHeight: "2.25rem", // h-9
	"&:hover": {
		backgroundColor:
			theme.palette.mode === "dark"
				? alpha(theme.palette.primary.main, 0.1)
				: alpha(theme.palette.primary.main, 0.08),
	},
}));

/**
 * Styled icon for menu items, using shadcn size and color.
 */
const MenuItemIcon = styled(ListItemIcon)(({ theme }) => ({
	color: theme.palette.text.primary,
	minWidth: 0,
	marginRight: "0.75rem", // gap-3
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	"& svg": {
		width: "1.125rem", // w-4.5
		height: "1.125rem",
		strokeWidth: 1.8,
	},
}));

/**
 * FileActionsMenu provides actions to open a file, show in canvas, or its location in the OS.
 * Uses Electron's window.api.openFile and window.api.showItemInFolder.
 */
export const FileActionsMenu = ({
	filePath,
	tooltip = "File actions",
	icon,
	"aria-label": ariaLabel = "File actions",
	onShowInCanvas,
}: FileActionsMenuProps) => {
	const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

	const handleOpenMenu = (event: MouseEvent<HTMLElement>) => {
		setAnchorEl(event.currentTarget);
	};

	const handleCloseMenu = () => {
		setAnchorEl(null);
	};

	const handleOpenFile = () => {
		handleCloseMenu();
		if (filePath) {
			window.api.openFile(filePath);
		}
	};

	const handleShowInCanvas = () => {
		handleCloseMenu();
		if (onShowInCanvas) {
			onShowInCanvas();
		}
	};

	return (
		<>
			<Tooltip title={tooltip} arrow>
				<FileActionsIconButton aria-label={ariaLabel} onClick={handleOpenMenu}>
					{icon ?? (
						<MoreHorizontal style={{ width: "1.125rem", height: "1.125rem" }} />
					)}
				</FileActionsIconButton>
			</Tooltip>

			<StyledFileActionsMenu
				anchorEl={anchorEl}
				open={Boolean(anchorEl)}
				onClose={handleCloseMenu}
				onClick={(e) => e.stopPropagation()}
				anchorOrigin={{
					vertical: "bottom",
					horizontal: "right",
				}}
				transformOrigin={{
					vertical: "top",
					horizontal: "right",
				}}
			>
				{onShowInCanvas && (
					<StyledMenuItem onClick={handleShowInCanvas}>
						<MenuItemIcon>
							<LayoutGrid aria-label="Show in Canvas" />
						</MenuItemIcon>
						<span>Show in Canvas</span>
					</StyledMenuItem>
				)}
				<StyledMenuItem onClick={handleOpenFile}>
					<MenuItemIcon>
						<FileIcon aria-label="Open File" />
					</MenuItemIcon>
					<span>Open File</span>
				</StyledMenuItem>
				<StyledMenuItem
					onClick={() => {
						handleCloseMenu();
						window.api.showItemInFolder(filePath);
					}}
				>
					<MenuItemIcon>
						<FolderOpen aria-label="Open Folder" />
					</MenuItemIcon>
					<span>Open Folder</span>
				</StyledMenuItem>
			</StyledFileActionsMenu>
		</>
	);
};
