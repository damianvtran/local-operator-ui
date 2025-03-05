import type { FC, ChangeEvent, MouseEvent } from 'react';
import React, { useState, useCallback } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Typography,
  TextField,
  InputAdornment,
  Divider,
  Paper,
  CircularProgress,
  Alert,
  Button,
  Pagination,
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSearch,
  faRobot,
  faClock,
  faCommentSlash,
  faPlus,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { useAgents } from '@renderer/hooks/use-agents';
import { useDeleteAgent } from '@renderer/hooks/use-agent-mutations';
import { CreateAgentDialog } from './create-agent-dialog';
import { ConfirmationModal } from '@renderer/components/common/confirmation-modal';
import { format } from 'date-fns';

type ChatSidebarProps = {
  selectedConversation?: string;
  onSelectConversation: (id: string) => void;
};

export const ChatSidebar: FC<ChatSidebarProps> = ({
  selectedConversation,
  onSelectConversation,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null);
  const [deleteAgentName, setDeleteAgentName] = useState('');
  const perPage = 10;

  // Delete agent mutation
  const deleteAgentMutation = useDeleteAgent();

  const {
    data: agents = [],
    isLoading,
    isError,
    refetch,
  } = useAgents(page, perPage);

  const handlePageChange = useCallback((_event: ChangeEvent<unknown>, value: number) => {
    setPage(value);
  }, []);

  const handleSelectConversation = useCallback((agentId: string) => {
    onSelectConversation(agentId);
  }, [onSelectConversation]);
  
  // Handler for opening the create agent dialog
  const handleOpenCreateDialog = useCallback(() => {
    setIsCreateDialogOpen(true);
  }, []);
  
  // Handler for closing the create agent dialog
  const handleCloseCreateDialog = useCallback(() => {
    setIsCreateDialogOpen(false);
  }, []);
  
  // Handler for opening the delete confirmation modal
  const handleOpenDeleteConfirmation = useCallback((e: MouseEvent, agentId: string, agentName: string) => {
    e.stopPropagation(); // Prevent triggering the ListItemButton click
    setDeleteAgentId(agentId);
    setDeleteAgentName(agentName);
  }, []);
  
  // Handler for closing the delete confirmation modal
  const handleCloseDeleteConfirmation = useCallback(() => {
    setDeleteAgentId(null);
    setDeleteAgentName('');
  }, []);
  
  // Handler for confirming agent deletion
  const handleConfirmDelete = useCallback(async () => {
    if (!deleteAgentId) return;
    
    try {
      await deleteAgentMutation.mutateAsync(deleteAgentId);
      // If the deleted agent was selected, clear the selection
      if (selectedConversation === deleteAgentId) {
        onSelectConversation('');
      }
    } catch (error) {
      // Error is handled in the mutation
      console.error('Failed to delete agent:', error);
    } finally {
      // Close the confirmation modal
      handleCloseDeleteConfirmation();
    }
  }, [deleteAgentId, deleteAgentMutation, selectedConversation, onSelectConversation, handleCloseDeleteConfirmation]);

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDateTime = (dateTimeString?: string) => {
    if (!dateTimeString) return '';
    try {
      const date = new Date(dateTimeString);
      return format(date, 'MMM d, h:mm a');
    } catch (error) {
      return '';
    }
  };

  const truncateMessage = (message?: string, maxLength = 60) => {
    if (!message) return '';
    return message.length > maxLength
      ? `${message.substring(0, maxLength)}...`
      : message;
  };

  return (
    <Paper
      elevation={0}
      sx={{
        width: '100%',
        height: '100%',
        borderRight: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 500 }}>
            Agents
          </Typography>
          <Button
            variant="contained"
            color="primary"
            size="small"
            startIcon={<FontAwesomeIcon icon={faPlus} />}
            onClick={handleOpenCreateDialog}
            sx={{
              borderRadius: 1.5,
              textTransform: 'none',
              fontWeight: 500,
              px: 1.5,
            }}
          >
            New Agent
          </Button>
        </Box>

        <TextField
          fullWidth
          size="small"
          placeholder="Search agents"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <FontAwesomeIcon icon={faSearch} size="sm" />
              </InputAdornment>
            ),
          }}
          sx={{
            mb: 2,
            '& .MuiOutlinedInput-root': {
              borderRadius: 2,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            },
          }}
        />
      </Box>

      <Divider sx={{ opacity: 0.1 }} />

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
          <CircularProgress size={40} thickness={4} />
        </Box>
      ) : isError ? (
        <Alert
          severity="error"
          sx={{
            mb: 2,
            borderRadius: 2,
            boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
          }}
          action={
            <Button color="inherit" size="small" onClick={() => refetch()} sx={{ fontWeight: 500 }}>
              Retry
            </Button>
          }
        >
          Failed to load agents. Please try again.
        </Alert>
      ) : agents.length === 0 ? (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No agents found
          </Typography>
        </Box>
      ) : (
        <List
          sx={{
            overflow: 'auto',
            flexGrow: 1,
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
            },
          }}
        >
          {filteredAgents.map((agent) => (
            <ListItem 
              key={agent.id} 
              disablePadding
              secondaryAction={
                <Button
                  size="small"
                  color="error"
                  variant="text"
                  aria-label="delete agent"
                  onClick={(e) => handleOpenDeleteConfirmation(e, agent.id, agent.name)}
                  sx={{ 
                    minWidth: 'auto', 
                    opacity: 0.7,
                    '&:hover': { opacity: 1 },
                    mr: 0.5,
                  }}
                >
                  <FontAwesomeIcon icon={faTrash} size="sm" />
                </Button>
              }
            >
              <ListItemButton
                selected={selectedConversation === agent.id}
                onClick={() => handleSelectConversation(agent.id)}
                sx={{
                  mx: 1,
                  borderRadius: 2,
                  mb: 0.5,
                  pr: 5, // Make room for the delete button
                  '&.Mui-selected': {
                    backgroundColor: 'rgba(56, 201, 106, 0.1)',
                    '&:hover': {
                      backgroundColor: 'rgba(56, 201, 106, 0.15)',
                    },
                  },
                }}
              >
                <ListItemAvatar>
                  <Avatar
                    sx={{
                      bgcolor: 'rgba(56, 201, 106, 0.2)',
                      color: 'primary.main',
                    }}
                  >
                    <FontAwesomeIcon icon={faRobot} />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={agent.name}
                  secondary={
                    <span style={{ display: 'block', marginTop: '4px' }}>
                      {agent.last_message ? (
                        <>
                          <Typography
                            variant="body2"
                            component="span"
                            sx={{
                              display: 'block',
                              color: 'text.secondary',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '160px',
                              mb: 0.5,
                            }}
                          >
                            {truncateMessage(agent.last_message)}
                          </Typography>
                          {agent.last_message_datetime && (
                            <span
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center',
                                color: 'rgba(255, 255, 255, 0.5)',
                                fontSize: '0.75rem',
                              }}
                            >
                              <FontAwesomeIcon 
                                icon={faClock} 
                                size="xs" 
                                style={{ marginRight: '4px' }} 
                              />
                              <span 
                                title={new Date(agent.last_message_datetime).toLocaleString()}
                                style={{ 
                                  cursor: 'help',
                                }}
                              >
                                {formatDateTime(agent.last_message_datetime)}
                              </span>
                            </span>
                          )}
                        </>
                      ) : (
                        <span
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center',
                            color: 'rgba(255, 255, 255, 0.5)',
                            fontSize: '0.75rem',
                            fontStyle: 'italic',
                          }}
                        >
                          <FontAwesomeIcon 
                            icon={faCommentSlash} 
                            size="xs" 
                            style={{ marginRight: '4px' }} 
                          />
                          <span>No messages yet</span>
                        </span>
                      )}
                    </span>
                  }
                  primaryTypographyProps={{
                    fontWeight: 500,
                    variant: 'body1',
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
          {agents.length > perPage && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
              <Pagination
                count={Math.ceil(agents.length / perPage)}
                page={page}
                onChange={handlePageChange}
                color="primary"
                size="medium"
              />
            </Box>
          )}
        </List>
      )}
      
      {/* Create Agent Dialog */}
      <CreateAgentDialog
        open={isCreateDialogOpen}
        onClose={handleCloseCreateDialog}
      />
      
      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        open={!!deleteAgentId}
        title="Delete Agent"
        message={
          <>
            <Typography variant="body1" gutterBottom>
              Are you sure you want to delete the agent "{deleteAgentName}"?
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
    </Paper>
  );
};
