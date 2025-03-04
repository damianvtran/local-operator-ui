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
import { useAgents } from '@renderer/hooks/use-agents';
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
      
      {isLoading ? (
        <Box 
          sx={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            flexGrow: 1,
            py: 6
          }}
        >
          <CircularProgress size={40} thickness={4} />
        </Box>
      ) : isError ? (
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
    </Paper>
  );
};
