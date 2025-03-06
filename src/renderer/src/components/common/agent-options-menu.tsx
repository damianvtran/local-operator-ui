import {
	faEllipsisVertical,
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
};

const OptionsIconButton = styled(IconButton)({
	opacity: 0,
	transition: "opacity 0.2s",
	"&:hover": {
		opacity: 1,
		backgroundColor: "rgba(255, 255, 255, 0.08)",
	},
});

const OptionsMenu = styled(Menu)({
	"& .MuiPaper-root": {
		minWidth: 150,
		boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
		borderRadius: 12,
	},
});

const SettingsMenuItem = styled(MenuItem)(({ theme }) => ({
	padding: theme.spacing(1.5, 2),
	"&:hover": {
		backgroundColor: "rgba(56, 201, 106, 0.08)",
	},
}));

const DeleteMenuItem = styled(MenuItem)(({ theme }) => ({
	padding: theme.spacing(1.5, 2),
	color: theme.palette.error.main,
	"&:hover": {
		backgroundColor: "rgba(211, 47, 47, 0.08)",
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
 * Provides a menu with options for an agent, including deletion and settings navigation
 */
export const AgentOptionsMenu: FC<AgentOptionsMenuProps> = ({
	agentId,
	agentName,
	onAgentDeleted,
	buttonSx = {},
	isAgentsPage = false,
	onViewAgentSettings,
}) => {
	const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
	const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

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
				{/* View Agent Settings option - only shown when not on the agents page */}
				{!isAgentsPage && onViewAgentSettings && (
					<SettingsMenuItem
						onClick={() => {
							onViewAgentSettings();
							handleCloseMenu();
						}}
					>
						<MenuItemIcon>
							<FontAwesomeIcon icon={faGear} size="sm" />
						</MenuItemIcon>
						<Typography variant="body2">View Agent Settings</Typography>
					</SettingsMenuItem>
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
		</>
	);
};
