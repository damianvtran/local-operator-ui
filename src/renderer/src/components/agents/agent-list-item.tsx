/**
 * Agent List Item Component
 * 
 * Displays a single agent in the list with basic information
 */

import React from 'react';
import type { FC } from 'react';
import { Box, Typography, Card, CardContent, Chip, alpha } from '@mui/material';
import { AgentOptionsMenu } from '@renderer/components/common/agent-options-menu';
import type { AgentDetails } from '@renderer/api/local-operator/types';

type AgentListItemProps = {
  /** Agent data to display */
  agent: AgentDetails;
  /** Whether this agent is selected */
  isSelected?: boolean;
  /** Click handler for the agent item */
  onClick?: () => void;
  /** Optional callback when an agent is deleted */
  onAgentDeleted?: (agentId: string) => void;
};

/**
 * Agent List Item Component
 * 
 * Displays a single agent in the list with basic information
 */
export const AgentListItem: FC<AgentListItemProps> = ({ 
  agent, 
  isSelected = false,
  onClick,
  onAgentDeleted
}) => {
  const createdDate = new Date(agent.created_date).toLocaleDateString();
  
  return (
    <Card 
      onClick={onClick}
      data-testid={`agent-item-${agent.id}`}
      sx={{
        marginBottom: 2.5,
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        borderRadius: 2,
        backgroundColor: (theme) => isSelected 
          ? alpha(theme.palette.primary.main, 0.08)
          : theme.palette.background.paper,
        border: isSelected 
          ? (theme) => `1px solid ${theme.palette.primary.main}` 
          : '1px solid transparent',
        '&:hover': {
          boxShadow: (theme) => `0 8px 16px ${alpha(theme.palette.common.black, 0.08)}`,
          transform: 'translateY(-3px)',
          backgroundColor: (theme) => !isSelected 
            ? alpha(theme.palette.background.default, 0.7)
            : alpha(theme.palette.primary.main, 0.12),
        },
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <CardContent sx={{ p: 2.5 }}>
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          mb: 1.5 
        }}>
          <Typography 
            variant="h6" 
            component="h3" 
            sx={{ 
              fontWeight: 600,
              fontSize: '1.1rem',
              lineHeight: 1.2,
              color: (theme) => isSelected ? theme.palette.primary.main : 'inherit'
            }}
          >
            {agent.name}
          </Typography>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {agent.model && (
              <Chip 
                label={agent.model} 
                size="small" 
                color="primary" 
                variant="outlined"
                title="AI model powering this agent"
                sx={{ 
                  fontWeight: 500,
                  borderRadius: 1,
                  '& .MuiChip-label': { px: 1 }
                }}
              />
            )}
            
            {/* Agent Options Menu */}
            <AgentOptionsMenu
              agentId={agent.id}
              agentName={agent.name}
              onAgentDeleted={onAgentDeleted}
              buttonSx={{
                '.MuiListItem-root:hover &': {
                  opacity: 0.6,
                },
                '.MuiCard-root:hover &': {
                  opacity: 0.6,
                },
              }}
            />
          </Box>
        </Box>
        
        <Typography 
          variant="body2" 
          sx={{ 
            mb: 2,
            lineHeight: 1.5,
            color: 'text.primary',
            backgroundColor: (theme) => alpha(theme.palette.background.default, 0.5),
            p: 1.5,
            borderRadius: 1,
            borderLeft: (theme) => `3px solid ${alpha(theme.palette.primary.main, 0.6)}`,
            maxHeight: '80px',
            overflow: 'auto',
            '&::-webkit-scrollbar': {
              width: '4px',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
            },
            fontStyle: agent.description ? 'normal' : 'italic',
            opacity: agent.description ? 1 : 0.7,
          }}
        >
          {agent.description || 'No description available'}
        </Typography>
        
        <Box sx={{ 
          display: 'flex', 
          flexWrap: 'wrap',
          gap: 2, 
          mb: 2,
          opacity: 0.8
        }}>
          <Typography 
            variant="body2" 
            color="text.secondary"
            title="Unique identifier for this agent"
            sx={{ fontSize: '0.8rem' }}
          >
            ID: {agent.id}
          </Typography>
          <Typography 
            variant="body2" 
            color="text.secondary"
            title="When this agent was created"
            sx={{ fontSize: '0.8rem' }}
          >
            Created: {createdDate}
          </Typography>
        </Box>
        
        <Box sx={{ 
          display: 'flex', 
          gap: 1.5,
          flexWrap: 'wrap'
        }}>
          <Chip 
            label={`v${agent.version}`} 
            size="small" 
            color="secondary" 
            variant="outlined"
            title="Agent version number"
            sx={{ 
              borderRadius: 1,
              height: 24,
              '& .MuiChip-label': { px: 1 }
            }}
          />
          {agent.hosting && (
            <Chip 
              label={agent.hosting} 
              size="small" 
              color="info" 
              variant="outlined"
              title="Where this agent is hosted"
              sx={{ 
                borderRadius: 1,
                height: 24,
                '& .MuiChip-label': { px: 1 }
              }}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  );
};
