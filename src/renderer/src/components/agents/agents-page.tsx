/**
 * Agents Page Component
 * 
 * Main page for displaying and managing agents with enhanced UI/UX
 */

import React, { useState } from 'react';
import type { FC } from 'react';
import { 
  Box, 
  Grid, 
  Paper, 
  Typography, 
  Divider, 
  Chip,
  IconButton
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faInfoCircle, 
  faCalendarAlt, 
  faCodeBranch, 
  faRobot, 
  faServer,
  faShieldAlt,
  faIdCard
} from '@fortawesome/free-solid-svg-icons';
import { AgentList } from './agent-list';
import type { AgentDetails } from '@renderer/api/local-operator/types';

/**
 * Agents Page Component
 * 
 * Main page for displaying and managing agents with enhanced UI/UX
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
        p: { xs: 1, sm: 2, md: 3 }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <FontAwesomeIcon icon={faRobot} size="lg" style={{ marginRight: 12 }} />
        <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold' }}>
          Agent Management
        </Typography>
        <IconButton 
          size="small" 
          sx={{ ml: 1, mt: 1 }}
          title="Manage your AI agents and view their configurations"
        >
          <FontAwesomeIcon icon={faInfoCircle} size="xs" />
        </IconButton>
      </Box>
      
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
        View, configure and manage your AI agents from a central dashboard
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
              flexDirection: 'column',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
              '&:hover': {
                boxShadow: '0 6px 16px rgba(0,0,0,0.1)',
              },
            }}
          >
            {selectedAgent ? (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h5" component="h2" sx={{ fontWeight: 'bold', mr: 2 }}>
                    {selectedAgent.name}
                  </Typography>
                  <Chip 
                    size="small" 
                    label={selectedAgent.hosting} 
                    color="primary" 
                    variant="outlined"
                    icon={<FontAwesomeIcon icon={faServer} />}
                    title="Agent hosting type"
                  />
                </Box>
                
                <Divider sx={{ mb: 3 }} />
                
                <Box sx={{ mb: 3 }}>
                  <Typography 
                    variant="subtitle1" 
                    sx={{ 
                      fontWeight: 'medium', 
                      mb: 2, 
                      display: 'flex', 
                      alignItems: 'center' 
                    }}
                  >
                    <FontAwesomeIcon icon={faInfoCircle} style={{ marginRight: 8 }} />
                    Agent Information
                  </Typography>
                  
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <FontAwesomeIcon icon={faIdCard} style={{ marginRight: 8, opacity: 0.7 }} />
                        <Typography variant="body2" color="text.secondary" title="Unique identifier for this agent">
                          ID: <Box component="span" sx={{ fontFamily: 'monospace' }}>{selectedAgent.id}</Box>
                        </Typography>
                      </Box>
                    </Grid>
                    
                    <Grid item xs={12} sm={6}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <FontAwesomeIcon icon={faCalendarAlt} style={{ marginRight: 8, opacity: 0.7 }} />
                        <Typography variant="body2" color="text.secondary" title="When this agent was created">
                          Created: {new Date(selectedAgent.created_date).toLocaleString()}
                        </Typography>
                      </Box>
                    </Grid>
                    
                    <Grid item xs={12} sm={6}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <FontAwesomeIcon icon={faCodeBranch} style={{ marginRight: 8, opacity: 0.7 }} />
                        <Typography variant="body2" color="text.secondary" title="Agent version number">
                          Version: {selectedAgent.version}
                        </Typography>
                      </Box>
                    </Grid>
                    
                    <Grid item xs={12} sm={6}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <FontAwesomeIcon icon={faRobot} style={{ marginRight: 8, opacity: 0.7 }} />
                        <Typography variant="body2" color="text.secondary" title="AI model powering this agent">
                          Model: {selectedAgent.model}
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </Box>
                
                {selectedAgent.security_prompt && (
                  <Box>
                    <Typography 
                      variant="subtitle1" 
                      sx={{ 
                        fontWeight: 'medium', 
                        mb: 1,
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      <FontAwesomeIcon icon={faShieldAlt} style={{ marginRight: 8 }} />
                      Security Prompt
                      <IconButton 
                        size="small" 
                        sx={{ ml: 1 }}
                        title="Security instructions that guide the agent's behavior and limitations"
                      >
                        <FontAwesomeIcon icon={faInfoCircle} size="xs" />
                      </IconButton>
                    </Typography>
                    <Paper 
                      variant="outlined" 
                      sx={{ 
                        p: 2, 
                        bgcolor: 'background.default',
                        maxHeight: '200px',
                        overflow: 'auto',
                        borderRadius: 1,
                        '&:hover': {
                          boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                        },
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
                  flexGrow: 1,
                  p: 3
                }}
              >
                <FontAwesomeIcon icon={faRobot} size="3x" style={{ opacity: 0.3, marginBottom: 16 }} />
                <Typography variant="h6" color="text.secondary" sx={{ textAlign: 'center', mb: 1 }}>
                  No Agent Selected
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                  Select an agent from the list to view its configuration and details
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
