import type { FC, MouseEvent } from 'react';
import React, { useState } from 'react';
import {
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  Typography,
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEllipsisVertical, faTrash } from '@fortawesome/free-solid-svg-icons';
import { ConfirmationModal } from './confirmation-modal';
import { useDeleteAgent } from '@renderer/hooks/use-agent-mutations';

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
};

/**
 * Agent Options Menu Component
 * 
 * Provides a menu with options for an agent, including deletion
 */
export const AgentOptionsMenu: FC<AgentOptionsMenuProps> = ({
  agentId,
  agentName,
  onAgentDeleted,
  buttonSx = {},
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
  
  // Handler for confirming agent deletion
  const handleConfirmDelete = async () => {
    try {
      await deleteAgentMutation.mutateAsync(agentId);
      
      // Call the onAgentDeleted callback if provided
      if (onAgentDeleted) {
        onAgentDeleted(agentId);
      }
    } catch (error) {
      // Error is handled in the mutation
      console.error('Failed to delete agent:', error);
    } finally {
      // Close the confirmation modal
      handleCloseDeleteConfirmation();
    }
  };
  
  return (
    <>
      <IconButton
        size="small"
        aria-label="agent options"
        onClick={handleOpenMenu}
        sx={{
          opacity: 0,
          transition: 'opacity 0.2s',
          '&:hover': { 
            opacity: 1,
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
          },
          ...buttonSx,
        }}
      >
        <FontAwesomeIcon icon={faEllipsisVertical} size="sm" />
      </IconButton>
      
      {/* Agent Options Menu */}
      <Menu
        anchorEl={menuAnchorEl}
        open={isMenuOpen}
        onClose={handleCloseMenu}
        onClick={(e) => e.stopPropagation()} // Prevent triggering parent click events
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: {
            minWidth: 150,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
            borderRadius: 1.5,
          },
        }}
      >
        <MenuItem 
          onClick={handleOpenDeleteConfirmation}
          sx={{ 
            color: 'error.main',
            py: 1.5,
            '&:hover': {
              backgroundColor: 'rgba(211, 47, 47, 0.08)',
            },
          }}
        >
          <ListItemIcon sx={{ color: 'error.main', minWidth: 36 }}>
            <FontAwesomeIcon icon={faTrash} size="sm" />
          </ListItemIcon>
          <Typography variant="body2">Delete Agent</Typography>
        </MenuItem>
      </Menu>
      
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
              This action cannot be undone. All conversations with this agent will be permanently deleted.
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
