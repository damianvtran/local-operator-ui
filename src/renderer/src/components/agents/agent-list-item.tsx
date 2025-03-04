/**
 * Agent List Item Component
 * 
 * Displays a single agent in the list with basic information
 */

import type { FC } from 'react';
import { Box, Typography, Card, CardContent, Chip } from '@mui/material';
import type { AgentDetails } from '@renderer/api/local-operator/types';

type AgentListItemProps = {
  /** Agent data to display */
  agent: AgentDetails;
  /** Whether this agent is selected */
  isSelected?: boolean;
  /** Click handler for the agent item */
  onClick?: () => void;
};

/**
 * Agent List Item Component
 * 
 * Displays a single agent in the list with basic information
 */
export const AgentListItem: FC<AgentListItemProps> = ({ 
  agent, 
  isSelected = false,
  onClick 
}) => {
  const createdDate = new Date(agent.created_date).toLocaleDateString();
  
  return (
    <Card 
      onClick={onClick}
      data-testid={`agent-item-${agent.id}`}
      sx={{
        marginBottom: 2,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        border: isSelected 
          ? (theme) => `2px solid ${theme.palette.primary.main}` 
          : '2px solid transparent',
        '&:hover': {
          boxShadow: 3,
          transform: 'translateY(-2px)',
        },
      }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
          <Typography variant="h6" component="h3" sx={{ fontWeight: 'bold' }}>
            {agent.name}
          </Typography>
          <Chip 
            label={agent.model} 
            size="small" 
            color="primary" 
            variant="outlined"
          />
        </Box>
        
        <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            ID: {agent.id}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Created: {createdDate}
          </Typography>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Chip 
            label={`v${agent.version}`} 
            size="small" 
            color="secondary" 
            variant="outlined"
          />
          <Chip 
            label={agent.hosting} 
            size="small" 
            color="info" 
            variant="outlined"
          />
        </Box>
      </CardContent>
    </Card>
  );
};
