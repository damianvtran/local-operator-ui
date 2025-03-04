/**
 * Agents Page Component
 * 
 * Main page for displaying and managing agents
 */

import React, { useState } from 'react';
import type { FC } from 'react';
import { Box, Container, Grid, Paper, Typography } from '@mui/material';
import { AgentList } from './agent-list';
import type { AgentDetails } from '@renderer/api/local-operator/types';

/**
 * Agents Page Component
 * 
 * Main page for displaying and managing agents
 */
export const AgentsPage: FC = () => {
  const [selectedAgent, setSelectedAgent] = useState<AgentDetails | null>(null);
  
  const handleSelectAgent = (agent: AgentDetails) => {
    setSelectedAgent(agent);
  };
  
  return (
    <Box 
      sx={{ 
        flexGrow: 1, 
        height: '100%', 
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        p: 2
      }}
    >
      <Typography variant="h4" component="h1" sx={{ mb: 3, fontWeight: 'bold' }}>
        Agent Management
      </Typography>
      
      <Grid container spacing={3} sx={{ flexGrow: 1, overflow: 'hidden' }}>
        {/* Agent List */}
        <Grid item xs={12} md={6} lg={4} sx={{ height: '100%' }}>
          <AgentList 
            onSelectAgent={handleSelectAgent}
            selectedAgentId={selectedAgent?.id}
          />
        </Grid>
        
        {/* Agent Details */}
        <Grid item xs={12} md={6} lg={8} sx={{ height: '100%' }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3, 
              height: '100%', 
              borderRadius: 2,
              bgcolor: 'background.paper',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {selectedAgent ? (
              <>
                <Typography variant="h5" component="h2" sx={{ mb: 2, fontWeight: 'bold' }}>
                  {selectedAgent.name}
                </Typography>
                
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'medium' }}>
                    Agent Details
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    ID: {selectedAgent.id}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Created: {new Date(selectedAgent.created_date).toLocaleString()}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Version: {selectedAgent.version}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Model: {selectedAgent.model}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Hosting: {selectedAgent.hosting}
                  </Typography>
                </Box>
                
                {selectedAgent.security_prompt && (
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'medium', mb: 1 }}>
                      Security Prompt
                    </Typography>
                    <Paper 
                      variant="outlined" 
                      sx={{ 
                        p: 2, 
                        bgcolor: 'background.default',
                        maxHeight: '200px',
                        overflow: 'auto'
                      }}
                    >
                      <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap' }}>
                        {selectedAgent.security_prompt}
                      </Typography>
                    </Paper>
                  </Box>
                )}
              </>
            ) : (
              <Box 
                sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  flexGrow: 1
                }}
              >
                <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center' }}>
                  Select an agent from the list to view details
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
