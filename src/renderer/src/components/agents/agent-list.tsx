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
  Paper
} from '@mui/material';
import { useAgents } from '@renderer/hooks/useAgents';
import { AgentListItem } from './agent-list-item';
import type { AgentDetails } from '@renderer/api/local-operator/types';

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
  
  return (
    <Paper 
      elevation={0} 
      sx={{ 
        p: 2, 
        height: '100%', 
        display: 'flex', 
        flexDirection: 'column',
        borderRadius: 2,
        bgcolor: 'background.paper'
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" component="h2" sx={{ fontWeight: 'bold' }}>
          Agents
        </Typography>
        
        <Button 
          variant="outlined" 
          color="primary" 
          onClick={() => refetch()} 
          disabled={isLoading || isFetching}
          size="small"
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Box>
      
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
          <CircularProgress />
        </Box>
      ) : isError ? (
        <Alert 
          severity="error" 
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
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
            p: 3
          }}
        >
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
            No agents found. Create a new agent to get started.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ 
          flexGrow: 1, 
          overflow: 'auto',
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '4px',
          },
        }}>
          {agents.map((agent) => (
            <AgentListItem 
              key={agent.id}
              agent={agent}
              isSelected={agent.id === selectedAgentId}
              onClick={() => handleSelectAgent(agent)}
            />
          ))}
          
          {agents.length > perPage && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination 
                count={Math.ceil(agents.length / perPage)} 
                page={page} 
                onChange={handlePageChange} 
                color="primary" 
              />
            </Box>
          )}
        </Box>
      )}
    </Paper>
  );
};
