import {
	IconButton,
	ListItemIcon,
	Menu,
	MenuItem,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { useDeleteAgent } from "@shared/hooks/use-agent-mutations";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import {
	Eraser,
	FileOutput,
	MessageCircle,
	MoreVertical,
	Settings,
	Trash2,
	UploadCloud,
} from "lucide-react";
import type { FC, MouseEvent } from "react";
import { useState } from "react";
import { ConfirmationModal } from "./confirmation-modal";

type AgentOptionsMenuProps = {
	/**
	 * Agent ID
	 */
	agentId: string;
	/**
	 * Agent name for display in confirmation
	 */
	agentName: string;
	/**
	 * Optional callback when an agent is deleted
	 * @param agentId - The ID of the deleted agent
	 */
	onAgentDeleted?: (agentId: string) => void;
	/**
	 * Optional styles for the menu button
	 */
	buttonSx?: Record<string, unknown>;
	/**
	 * Whether the current page is the agents page
	 * If true, the "View Agent Settings" option will not be shown
	 */
	isAgentsPage?: boolean;
	/**
	 * Optional callback for navigating to agent settings
	 * This should navigate to the Agents page with this agent selected
	 */
	onViewAgentSettings?: () => void;
	/**
	 * Optional callback for navigating to chat with the agent
	 * This should navigate to the Chat page with this agent selected
	 */
	onChatWithAgent?: () => void;
	/**
	 * Optional callback for exporting the agent
	 * This should export the agent as a ZIP file
	 */
	onExportAgent?: () => void;
	/**
	 * Optional callback to clear the conversation for this agent
	 */
	onClearConversation?: () => void;
	/**
	 * Optional callback to upload the agent to the hub
	 */
	onUploadAgentToHub?: () => void;
};

/**
 * Styled icon button for the options menu, using shadcn spacing and rounded.
 */
/**
 * Styled icon button for the options menu, using shadcn spacing and rounded.
 * The button has a fixed size to prevent layout shift, and the icon is larger for prominence.
 */
const OptionsIconButton = styled(IconButton)(({ theme }) => ({
	borderRadius: "0.375rem", // rounded-md
	padding: 0,
	left: 8,
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
const OptionsMenu = styled(Menu)(({ theme }) => ({
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
 * Styled menu item for warning actions.
 */
const WarningMenuItem = styled(MenuItem)(({ theme }) => ({
	borderRadius: "0.375rem",
	padding: "0.5rem 0.75rem",
	fontSize: "0.875rem",
	fontWeight: 500,
	gap: "0.75rem",
	minHeight: "2.25rem",
	color: theme.palette.warning.main,
	"&:hover": {
		backgroundColor: alpha(theme.palette.warning.main, 0.08),
	},
}));

/**
 * Styled menu item for delete actions.
 */
const DeleteMenuItem = styled(MenuItem)(({ theme }) => ({
	borderRadius: "0.375rem",
	padding: "0.5rem 0.75rem",
	fontSize: "0.875rem",
	fontWeight: 500,
	gap: "0.75rem",
	minHeight: "2.25rem",
	color: theme.palette.error.main,
	"&:hover": {
		backgroundColor: alpha(theme.palette.error.main, 0.08),
	},
}));

/**
 * Styled icon for menu items, using shadcn size and color.
 */
const MenuItemIcon = styled(ListItemIcon)<{ color?: "error" | "warning" }>(
	({ theme, color }) => ({
		color:
			color === "error"
				? theme.palette.error.main
				: color === "warning"
					? theme.palette.warning.main
					: theme.palette.text.primary,
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
	}),
);

/**
 * Agent Options Menu Component
 *
 * Provides a menu with options for an agent, including chat, deletion and settings navigation
 */
export const AgentOptionsMenu: FC<AgentOptionsMenuProps> = ({
	agentId,
	agentName,
	onAgentDeleted,
	buttonSx = {},
	isAgentsPage = false,
	onViewAgentSettings,
	onChatWithAgent,
	onExportAgent,
	onClearConversation,
	onUploadAgentToHub,
}) => {
	const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
	const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
	const [isClearModalOpen, setIsClearModalOpen] = useState(false);

	// Whether the menu is open
	const isMenuOpen = Boolean(menuAnchorEl);

	// Delete agent mutation
	const deleteAgentMutation = useDeleteAgent();

	// Handler for opening the menu
	const handleOpenMenu = (e: MouseEvent<HTMLButtonElement>) => {
		e.stopPropagation(); // Prevent triggering parent click events
		setMenuAnchorEl(e.currentTarget);
	};

	// Handler for closing the menu
	const handleCloseMenu = () => {
		setMenuAnchorEl(null);
	};

	// Handler for opening the delete confirmation modal
	const handleOpenDeleteConfirmation = () => {
		setIsDeleteModalOpen(true);
		handleCloseMenu();
	};

	// Handler for closing the delete confirmation modal
	const handleCloseDeleteConfirmation = () => {
		setIsDeleteModalOpen(false);
	};

	// Handler for opening the clear conversation confirmation modal
	const handleOpenClearConfirmation = () => {
		setIsClearModalOpen(true);
		handleCloseMenu();
	};

	// Handler for closing the clear conversation confirmation modal
	const handleCloseClearConfirmation = () => {
		setIsClearModalOpen(false);
	};

	// Get the clearAgentFromAllPages function from the agent selection store
	const { clearAgentFromAllPages } = useAgentSelectionStore();

	// Handler for confirming agent deletion
	const handleConfirmDelete = async () => {
		try {
			await deleteAgentMutation.mutateAsync(agentId);

			// Clear the agent from all selection stores
			clearAgentFromAllPages(agentId);

			// Call the onAgentDeleted callback if provided
			if (onAgentDeleted) {
				onAgentDeleted(agentId);
			}
		} catch (error) {
			// Error is handled in the mutation
			console.error("Failed to delete agent:", error);
		} finally {
			// Close the confirmation modal
			handleCloseDeleteConfirmation();
		}
	};

	return (
		<>
			<OptionsIconButton
				aria-label="agent options"
				data-tour-tag="agent-options-button"
				onClick={handleOpenMenu}
				sx={buttonSx}
			>
				<MoreVertical
					aria-label="More options"
					style={{ width: "1rem", height: "1rem" }}
				/>
			</OptionsIconButton>

			<OptionsMenu
				anchorEl={menuAnchorEl}
				open={isMenuOpen}
				onClose={handleCloseMenu}
				onClick={(e) => e.stopPropagation()} // Prevent triggering parent click events
				anchorOrigin={{
					vertical: "top",
					horizontal: "right",
				}}
				transformOrigin={{
					vertical: "top",
					horizontal: "right",
				}}
			>
				{/* Chat with Agent option - only shown when on the agents page */}
				{isAgentsPage && onChatWithAgent && (
					<StyledMenuItem
						onClick={() => {
							onChatWithAgent();
							handleCloseMenu();
						}}
					>
						<MenuItemIcon>
							<MessageCircle aria-label="Chat with Agent" />
						</MenuItemIcon>
						<span>Chat with Agent</span>
					</StyledMenuItem>
				)}

				{/* View Agent Settings option - only shown when not on the agents page */}
				{!isAgentsPage && onViewAgentSettings && (
					<StyledMenuItem
						data-tour-tag="view-agent-settings-menu-item"
						onClick={() => {
							onViewAgentSettings();
							handleCloseMenu();
						}}
					>
						<MenuItemIcon>
							<Settings aria-label="View Agent Settings" />
						</MenuItemIcon>
						<span>View Agent Settings</span>
					</StyledMenuItem>
				)}

				{/* Export Agent option */}
				{onExportAgent && (
					<StyledMenuItem
						onClick={() => {
							onExportAgent();
							handleCloseMenu();
						}}
					>
						<MenuItemIcon>
							<FileOutput aria-label="Export Agent" />
						</MenuItemIcon>
						<span>Export Agent</span>
					</StyledMenuItem>
				)}

				{/* Upload to Hub option */}
				{onUploadAgentToHub && (
					<StyledMenuItem
						data-tour-tag="upload-to-hub-menu-item"
						onClick={() => {
							onUploadAgentToHub();
							handleCloseMenu();
						}}
					>
						<MenuItemIcon>
							<UploadCloud aria-label="Upload to Hub" />
						</MenuItemIcon>
						<span>Upload to Hub</span>
					</StyledMenuItem>
				)}

				{/* Clear Conversation option */}
				{onClearConversation && (
					<WarningMenuItem onClick={handleOpenClearConfirmation}>
						<MenuItemIcon color="warning">
							<Eraser aria-label="Clear Conversation" />
						</MenuItemIcon>
						<span>Clear Conversation</span>
					</WarningMenuItem>
				)}

				<DeleteMenuItem onClick={handleOpenDeleteConfirmation}>
					<MenuItemIcon color="error">
						<Trash2 aria-label="Delete Agent" />
					</MenuItemIcon>
					<span>Delete Agent</span>
				</DeleteMenuItem>
			</OptionsMenu>

			{/* Delete Confirmation Modal */}
			<ConfirmationModal
				open={isDeleteModalOpen}
				title="Delete Agent"
				message={
					<>
						<Typography variant="body1" gutterBottom>
							Are you sure you want to delete the agent "{agentName}"?
						</Typography>
						<Typography variant="body2" color="text.secondary">
							This action cannot be undone. All conversations with this agent
							will be permanently deleted.
						</Typography>
					</>
				}
				confirmText="Delete"
				cancelText="Cancel"
				isDangerous
				onConfirm={handleConfirmDelete}
				onCancel={handleCloseDeleteConfirmation}
			/>

			{/* Clear Conversation Confirmation Modal */}
			<ConfirmationModal
				open={isClearModalOpen}
				title="Clear Conversation"
				message="Are you sure you want to clear this conversation? This action cannot be undone and all messages will be permanently deleted."
				confirmText="Clear"
				cancelText="Cancel"
				isDangerous
				onConfirm={() => {
					if (onClearConversation) {
						onClearConversation();
					}
					handleCloseClearConfirmation();
				}}
				onCancel={handleCloseClearConfirmation}
			/>
		</>
	);
};
