/**
 * Agent List Component
 * 
 * Displays a list of agents with loading, error, and empty states
 */

import React, { useState } from 'react';
import type { FC, ChangeEvent } from 'react';
import { 
  Box, 
  Typography, 
  CircularProgress, 
  Button, 
  Alert, 
  Pagination,
  Paper,
  alpha
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { useAgents } from '@renderer/hooks/use-agents';
import { AgentListItem } from './agent-list-item';
import { CreateAgentDialog } from '@renderer/components/common/create-agent-dialog';
import type { AgentDetails } from '@renderer/api/local-operator/types';
import { createLocalOperatorClient } from '@renderer/api/local-operator';
import { apiConfig } from '@renderer/config';

type AgentListProps = {
  /** Handler for when an agent is selected */
  onSelectAgent?: (agent: AgentDetails) => void;
  /** Currently selected agent ID */
  selectedAgentId?: string;
};

/**
 * Agent List Component
 * 
 * Displays a list of agents with loading, error, and empty states
 */
export const AgentList: FC<AgentListProps> = ({ 
  onSelectAgent,
  selectedAgentId
}) => {
  const [page, setPage] = useState(1);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const perPage = 10;
  
  const { 
    data: agents = [], 
    isLoading, 
    isError, 
    refetch,
    isFetching
  } = useAgents(page, perPage);
  
  const handlePageChange = (_event: ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };
  
  const handleSelectAgent = (agent: AgentDetails) => {
    if (onSelectAgent) {
      onSelectAgent(agent);
    }
  };
  
  // Handler for opening the create agent dialog
  const handleOpenCreateDialog = () => {
    setIsCreateDialogOpen(true);
  };
  
  // Handler for closing the create agent dialog
  const handleCloseCreateDialog = () => {
    setIsCreateDialogOpen(false);
  };
  
  // Handler for when an agent is created
  const handleAgentCreated = (agentId: string) => {
    // Fetch the agent details to get the full agent object
    const fetchAndSelectAgent = async () => {
      try {
        // Create a client to fetch the agent details directly
        const client = createLocalOperatorClient(apiConfig.baseUrl);
        const response = await client.agents.getAgent(agentId);
        
        if (response.status >= 400) {
          throw new Error(response.message || `Failed to fetch agent ${agentId}`);
        }
        
        // Select the newly created agent if a selection handler is provided
        if (response.result && onSelectAgent) {
          onSelectAgent(response.result);
        }
        
        // Then refetch the agents list to update the UI
        refetch();
      } catch (error) {
        console.error('Error fetching agent details:', error);
        // Still refetch the list even if there was an error
        refetch();
      }
    };
    
    fetchAndSelectAgent();
  };
  
  return (
    <Paper 
      elevation={0} 
      sx={{ 
        p: { xs: 2, sm: 3 }, 
        height: '100%', 
        display: 'flex', 
        flexDirection: 'column',
        borderRadius: 3,
        bgcolor: 'background.paper',
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
        transition: 'box-shadow 0.3s ease-in-out',
        '&:hover': {
          boxShadow: '0 6px 25px rgba(0,0,0,0.08)',
        },
      }}
    >
      <Box 
        sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          mb: 3,
          pb: 2,
          borderBottom: '1px solid',
          borderColor: 'divider'
        }}
      >
        <Typography 
          variant="h5" 
          component="h2" 
          sx={{ 
            fontWeight: 700,
            fontSize: { xs: '1.25rem', sm: '1.5rem' },
            letterSpacing: '-0.01em'
          }}
        >
          Agents
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button 
            variant="contained" 
            color="primary" 
            size="small"
            startIcon={<FontAwesomeIcon icon={faPlus} />}
            onClick={handleOpenCreateDialog}
            sx={{
              borderRadius: 2,
              textTransform: 'none',
              px: 2,
              fontWeight: 500,
              transition: 'all 0.2s',
              '&:hover': {
                transform: 'translateY(-2px)',
              }
            }}
          >
            New Agent
          </Button>
          
          <Button 
            variant="outlined" 
            color="primary" 
            onClick={() => refetch()} 
            disabled={isLoading || isFetching}
            size="small"
            sx={{
              borderRadius: 2,
              textTransform: 'none',
              px: 2,
              fontWeight: 500,
              transition: 'all 0.2s',
              '&:hover': {
                transform: 'translateY(-2px)',
              }
            }}
          >
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </Button>
        </Box>
      </Box>
      
      <Box sx={{ 
        flexGrow: 1, 
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        minHeight: '300px' // Ensure minimum height to prevent layout shifts
      }}>
        {/* Loading overlay that doesn't affect layout */}
        {(isLoading || isFetching) && (
          <Box 
            sx={{ 
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center',
              backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.7),
              zIndex: 1,
              borderRadius: 2
            }}
          >
            <CircularProgress size={40} thickness={4} />
          </Box>
        )}
        
        {isError ? (
          <Alert 
            severity="error" 
            sx={{ 
              mb: 2,
              borderRadius: 2,
              boxShadow: '0 2px 10px rgba(0,0,0,0.08)'
            }}
            action={
              <Button 
                color="inherit" 
                size="small" 
                onClick={() => refetch()}
                sx={{ fontWeight: 500 }}
              >
                Retry
              </Button>
            }
          >
            Failed to load agents. Please try again.
          </Alert>
        ) : agents.length === 0 ? (
          <Box 
            sx={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center',
              flexGrow: 1,
              p: 4,
              my: 4,
              borderRadius: 3,
              bgcolor: 'background.default'
            }}
          >
            <Typography 
              variant="body1" 
              color="text.secondary" 
              sx={{ 
                mb: 2, 
                textAlign: 'center',
                maxWidth: '80%',
                lineHeight: 1.6
              }}
            >
              No agents found. Create a new agent to get started.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ 
            flexGrow: 1, 
            overflow: 'auto',
            px: 0.5,
            py: 1,
            mx: -0.5,
            '&::-webkit-scrollbar': {
              width: '6px',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(0, 0, 0, 0.1)',
              borderRadius: '10px',
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
              }
            },
          }}>
            {agents.map((agent) => (
              <AgentListItem 
                key={agent.id}
                agent={agent}
                isSelected={agent.id === selectedAgentId}
                onClick={() => handleSelectAgent(agent)}
                onAgentDeleted={(deletedId) => {
                  // If the deleted agent was selected, clear the selection
                  if (deletedId === selectedAgentId && onSelectAgent) {
                    // Set selected agent to null
                    // Using undefined here since the function expects AgentDetails
                    // but we want to clear the selection
                    onSelectAgent(undefined as unknown as AgentDetails);
                  }
                  refetch();
                }}
              />
            ))}
            
            {agents.length > perPage && (
              <Box sx={{ 
                display: 'flex', 
                justifyContent: 'center', 
                mt: 3,
                pt: 2,
                borderTop: '1px solid',
                borderColor: 'divider'
              }}>
                <Pagination 
                  count={Math.ceil(agents.length / perPage)} 
                  page={page} 
                  onChange={handlePageChange} 
                  color="primary" 
                  size="medium"
                  shape="rounded"
                  sx={{
                    '& .MuiPaginationItem-root': {
                      borderRadius: 1.5,
                      mx: 0.5
                    }
                  }}
                />
              </Box>
            )}
          </Box>
        )}
      </Box>
      
      {/* Create Agent Dialog */}
      <CreateAgentDialog
        open={isCreateDialogOpen}
        onClose={handleCloseCreateDialog}
        onAgentCreated={handleAgentCreated}
      />
    </Paper>
  );
};
