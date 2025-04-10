import {
	faComment,
	faEllipsisVertical,
	faFileExport,
	faGear,
	faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	IconButton,
	ListItemIcon,
	Menu,
	MenuItem,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { useDeleteAgent } from "@renderer/hooks/use-agent-mutations";
import { useAgentSelectionStore } from "@renderer/store/agent-selection-store";
import type { FC, MouseEvent } from "react";
import React, { useState } from "react";
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
};

const OptionsIconButton = styled(IconButton)(({ theme }) => ({
	opacity: 0,
	transition: "opacity 0.2s",
	"&:hover": {
		opacity: 1,
		backgroundColor: alpha(
			theme.palette.mode === "dark"
				? theme.palette.common.white
				: theme.palette.common.black,
			0.08,
		),
	},
}));

const OptionsMenu = styled(Menu)(({ theme }) => ({
	"& .MuiPaper-root": {
		minWidth: 150,
		boxShadow: `0 4px 20px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.4 : 0.15)}`,
		borderRadius: 12,
	},
}));

const StyledMenuItem = styled(MenuItem)(({ theme }) => ({
	padding: theme.spacing(1.5, 2),
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.08),
	},
}));

const DeleteMenuItem = styled(MenuItem)(({ theme }) => ({
	padding: theme.spacing(1.5, 2),
	color: theme.palette.error.main,
	"&:hover": {
		backgroundColor: alpha(theme.palette.error.main, 0.08),
	},
}));

const MenuItemIcon = styled(ListItemIcon)(({ theme, color }) => ({
	color:
		color === "error" ? theme.palette.error.main : theme.palette.primary.main,
	minWidth: 36,
}));

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
				size="small"
				aria-label="agent options"
				onClick={handleOpenMenu}
				sx={buttonSx}
			>
				<FontAwesomeIcon icon={faEllipsisVertical} size="sm" />
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
							<FontAwesomeIcon icon={faComment} size="sm" />
						</MenuItemIcon>
						<Typography variant="body2">Chat with Agent</Typography>
					</StyledMenuItem>
				)}

				{/* View Agent Settings option - only shown when not on the agents page */}
				{!isAgentsPage && onViewAgentSettings && (
					<StyledMenuItem
						onClick={() => {
							onViewAgentSettings();
							handleCloseMenu();
						}}
					>
						<MenuItemIcon>
							<FontAwesomeIcon icon={faGear} size="sm" />
						</MenuItemIcon>
						<Typography variant="body2">View Agent Settings</Typography>
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
							<FontAwesomeIcon icon={faFileExport} size="sm" />
						</MenuItemIcon>
						<Typography variant="body2">Export Agent</Typography>
					</StyledMenuItem>
				)}

				{/* Clear Conversation option */}
				{onClearConversation && (
					<StyledMenuItem onClick={handleOpenClearConfirmation}>
						<MenuItemIcon>
							<FontAwesomeIcon icon={faTrash} size="sm" />
						</MenuItemIcon>
						<Typography variant="body2">Clear Conversation</Typography>
					</StyledMenuItem>
				)}

				<DeleteMenuItem onClick={handleOpenDeleteConfirmation}>
					<MenuItemIcon color="error">
						<FontAwesomeIcon icon={faTrash} size="sm" />
					</MenuItemIcon>
					<Typography variant="body2">Delete Agent</Typography>
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
