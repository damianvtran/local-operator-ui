/**
 * Agents Page Component
 * 
 * Main page for displaying and managing agents with enhanced UI/UX
 */

import React, { useState, useEffect } from 'react';
import type { FC } from 'react';
import { 
  Box, 
  Grid, 
  Paper, 
  Typography, 
  Divider, 
  Chip,
  IconButton,
  alpha
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
import { useAgent } from '@renderer/hooks/use-agents';

type AgentsPageProps = {
  /**
   * Optional ID of an agent to select when the page loads
   */
  initialSelectedAgentId?: string;
};

/**
 * Agents Page Component
 * 
 * Main page for displaying and managing agents with enhanced UI/UX
 */
export const AgentsPage: FC<AgentsPageProps> = ({ initialSelectedAgentId }) => {
  const [selectedAgent, setSelectedAgent] = useState<AgentDetails | null>(null);
  
  // Fetch the agent details if initialSelectedAgentId is provided
  const { data: initialAgent } = useAgent(initialSelectedAgentId);
  
  // Set the selected agent when initialAgent changes
  useEffect(() => {
    if (initialAgent) {
      setSelectedAgent(initialAgent);
    }
  }, [initialAgent]);
  
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
        p: { xs: 2, sm: 3, md: 4 },
        gap: 2
      }}
    >
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        mb: 1,
        pb: 2,
        borderBottom: '1px solid',
        borderColor: 'divider'
      }}>
        <FontAwesomeIcon 
          icon={faRobot} 
          size="lg" 
          style={{ 
            marginRight: 16, 
            color: '#f2f2f3' 
          }} 
        />
        <Typography 
          variant="h4" 
          component="h1" 
          sx={{ 
            fontWeight: 700,
            letterSpacing: '-0.02em'
          }}
        >
          Agent Management
        </Typography>
        <IconButton 
          size="small" 
          sx={{ 
            ml: 1.5,
            color: 'primary.main',
            '&:hover': {
              backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.08)
            }
          }}
          title="Manage your AI agents and view their configurations"
        >
          <FontAwesomeIcon icon={faInfoCircle} size="xs" />
        </IconButton>
      </Box>
      
      <Typography 
        variant="subtitle1" 
        color="text.secondary" 
        sx={{ 
          mb: 3,
          maxWidth: '800px',
          lineHeight: 1.5
        }}
      >
        View, configure and manage your AI agents from a central dashboard
      </Typography>
      
      <Grid container spacing={4} sx={{ flexGrow: 1, overflow: 'hidden' }}>
        {/* Agent List */}
        <Grid item xs={12} md={5} lg={4} sx={{ height: '100%' }}>
          <AgentList 
            onSelectAgent={handleSelectAgent}
            selectedAgentId={selectedAgent?.id}
          />
        </Grid>
        
        {/* Agent Details */}
        <Grid item xs={12} md={7} lg={8} sx={{ height: '100%' }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 4, 
              height: '100%', 
              borderRadius: 3,
              bgcolor: 'background.paper',
              display: 'flex',
              flexDirection: 'column',
              transition: 'all 0.25s ease',
              boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
              '&:hover': {
                boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
              },
              overflow: 'hidden'
            }}
          >
            {selectedAgent ? (
              <Box sx={{ 
                display: 'flex', 
                flexDirection: 'column', 
                height: '100%',
                overflow: 'auto',
                '&::-webkit-scrollbar': {
                  width: '8px',
                },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: 'rgba(0, 0, 0, 0.1)',
                  borderRadius: '4px',
                },
              }}>
                <Box sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  mb: 3 
                }}>
                  <Typography 
                    variant="h5" 
                    component="h2" 
                    sx={{ 
                      fontWeight: 700, 
                      letterSpacing: '-0.01em',
                      color: 'primary.main'
                    }}
                  >
                    {selectedAgent.name}
                  </Typography>
                  
                  <Chip 
                    size="small" 
                    label={selectedAgent.hosting || "Default Hosting"} 
                    color="primary" 
                    variant="outlined"
                    icon={<FontAwesomeIcon icon={faServer} />}
                    title="Agent hosting type"
                    sx={{
                      borderRadius: 2.5,
                      fontWeight: 600,
                      px: 1.5,
                      py: 0.75,
                      height: 32,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                      '& .MuiChip-label': { 
                        px: 1.5,
                        ml: 0.5,
                        letterSpacing: '0.01em'
                      },
                      '& .MuiChip-icon': {
                        ml: 1.25,
                        mr: -0.25,
                        opacity: 0.9
                      }
                    }}
                  />
                </Box>
                
                <Divider sx={{ mb: 4 }} />
                
                <Box sx={{ mb: 4 }}>
                  <Typography 
                    variant="subtitle1" 
                    sx={{ 
                      fontWeight: 600, 
                      mb: 3, 
                      display: 'flex', 
                      alignItems: 'center',
                      color: 'text.primary'
                    }}
                  >
                    <FontAwesomeIcon 
                      icon={faInfoCircle} 
                      style={{ 
                        marginRight: 10,
                        color: '#f2f2f3'
                      }} 
                    />
                    Agent Information
                  </Typography>
                  
                  <Grid container spacing={3}>
                    <Grid item xs={12} sm={6}>
                      <Box sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        mb: 2,
                        p: 2,
                        borderRadius: 2,
                        bgcolor: (theme) => alpha(theme.palette.background.default, 0.7)
                      }}>
                        <FontAwesomeIcon 
                          icon={faIdCard} 
                          style={{ 
                            marginRight: 12, 
                            opacity: 0.8,
                            color: '#f2f2f3'
                          }} 
                        />
                        <Typography variant="body2" title="Unique identifier for this agent">
                          <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>ID:</Box>
                          <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                            {selectedAgent.id}
                          </Box>
                        </Typography>
                      </Box>
                    </Grid>
                    
                    <Grid item xs={12} sm={6}>
                      <Box sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        mb: 2,
                        p: 2,
                        borderRadius: 2,
                        bgcolor: (theme) => alpha(theme.palette.background.default, 0.7)
                      }}>
                        <FontAwesomeIcon 
                          icon={faCalendarAlt} 
                          style={{ 
                            marginRight: 12, 
                            opacity: 0.8,
                            color: '#f2f2f3'
                          }} 
                        />
                        <Typography variant="body2" title="When this agent was created">
                          <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>Created:</Box>
                          <Box component="span" sx={{ fontWeight: 500 }}>
                            {new Date(selectedAgent.created_date).toLocaleString()}
                          </Box>
                        </Typography>
                      </Box>
                    </Grid>
                    
                    <Grid item xs={12} sm={6}>
                      <Box sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        mb: 2,
                        p: 2,
                        borderRadius: 2,
                        bgcolor: (theme) => alpha(theme.palette.background.default, 0.7)
                      }}>
                        <FontAwesomeIcon 
                          icon={faCodeBranch} 
                          style={{ 
                            marginRight: 12, 
                            opacity: 0.8,
                            color: '#f2f2f3'
                          }} 
                        />
                        <Typography variant="body2" title="Agent version number">
                          <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>Version:</Box>
                          <Box component="span" sx={{ fontWeight: 500 }}>
                            {selectedAgent.version}
                          </Box>
                        </Typography>
                      </Box>
                    </Grid>
                    
                    <Grid item xs={12} sm={6}>
                      <Box sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        mb: 2,
                        p: 2,
                        borderRadius: 2,
                        bgcolor: (theme) => alpha(theme.palette.background.default, 0.7)
                      }}>
                        <FontAwesomeIcon 
                          icon={faRobot} 
                          style={{ 
                            marginRight: 12, 
                            opacity: 0.8,
                            color: '#f2f2f3'
                          }} 
                        />
                        <Typography variant="body2" title="AI model powering this agent">
                          <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>Model:</Box>
                          <Box component="span" sx={{ fontWeight: 500 }}>
                            {selectedAgent.model || "Default"}
                          </Box>
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </Box>
                
                {selectedAgent.security_prompt && (
                  <Box sx={{ mt: 2 }}>
                    <Typography 
                      variant="subtitle1" 
                      sx={{ 
                        fontWeight: 600, 
                        mb: 2,
                        display: 'flex',
                        alignItems: 'center',
                        color: 'text.primary'
                      }}
                    >
                      <FontAwesomeIcon 
                        icon={faShieldAlt} 
                        style={{ 
                          marginRight: 10,
                          color: '#f2f2f3'
                        }} 
                      />
                      Security Prompt
                      <IconButton 
                        size="small" 
                        sx={{ 
                          ml: 1,
                          color: 'primary.main',
                          '&:hover': {
                            backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.08)
                          }
                        }}
                        title="Security instructions that guide the agent's behavior and limitations"
                      >
                        <FontAwesomeIcon icon={faInfoCircle} size="xs" />
                      </IconButton>
                    </Typography>
                    <Paper 
                      variant="outlined" 
                      sx={{ 
                        p: 3, 
                        bgcolor: (theme) => alpha(theme.palette.background.default, 0.5),
                        maxHeight: '250px',
                        overflow: 'auto',
                        borderRadius: 2,
                        borderColor: (theme) => alpha(theme.palette.primary.main, 0.2),
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                          borderColor: 'primary.main',
                        },
                        '&::-webkit-scrollbar': {
                          width: '6px',
                        },
                        '&::-webkit-scrollbar-thumb': {
                          backgroundColor: 'rgba(0, 0, 0, 0.1)',
                          borderRadius: '3px',
                        },
                      }}
                    >
                      <Typography 
                        variant="body2" 
                        component="pre" 
                        sx={{ 
                          whiteSpace: 'pre-wrap',
                          fontFamily: '"Roboto Mono", monospace',
                          fontSize: '0.875rem',
                          lineHeight: 1.6
                        }}
                      >
                        {selectedAgent.security_prompt}
                      </Typography>
                    </Paper>
                  </Box>
                )}
              </Box>
            ) : (
              <Box 
                sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  flexGrow: 1,
                  p: 4,
                  opacity: 0.8
                }}
              >
                <FontAwesomeIcon 
                  icon={faRobot} 
                  size="4x" 
                  style={{ 
                    opacity: 0.3, 
                    marginBottom: 24,
                    color: '#f2f2f3'
                  }} 
                />
                <Typography 
                  variant="h6" 
                  color="text.secondary" 
                  sx={{ 
                    textAlign: 'center', 
                    mb: 2,
                    fontWeight: 600
                  }}
                >
                  No Agent Selected
                </Typography>
                <Typography 
                  variant="body1" 
                  color="text.secondary" 
                  sx={{ 
                    textAlign: 'center',
                    maxWidth: '400px'
                  }}
                >
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
