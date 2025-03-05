/**
 * Agents Page Component
 * 
 * Main page for displaying and managing agents with enhanced UI/UX
 */

import { useState, useEffect } from 'react';
import type { FC } from 'react';
import { 
  Box, 
  Grid, 
  Paper, 
  Typography, 
  Divider, 
  IconButton,
  alpha
} from '@mui/material';
import { PageHeader } from '../common/page-header';
import { toast } from 'react-toastify';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faInfoCircle, 
  faCalendarAlt, 
  faCodeBranch, 
  faRobot, 
  faServer,
  faShieldAlt,
  faIdCard,
  faTag
} from '@fortawesome/free-solid-svg-icons';
import { AgentList } from './agent-list';
import type { AgentDetails, AgentUpdate } from '@renderer/api/local-operator/types';
import { useAgent } from '@renderer/hooks/use-agents';
import { useUpdateAgent } from '@renderer/hooks/use-update-agent';
import { EditableField } from '../common/editable-field';

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
  const [savingField, setSavingField] = useState<string | null>(null);
  
  // Fetch the agent details if initialSelectedAgentId is provided
  const { data: initialAgent, refetch: refetchAgent } = useAgent(initialSelectedAgentId);
  const updateAgentMutation = useUpdateAgent();
  
  // Set the selected agent when initialAgent changes, but only if it's not already selected
  // This prevents unnecessary re-renders during refetches
  useEffect(() => {
    if (initialAgent && (!selectedAgent || selectedAgent.id !== initialAgent.id)) {
      setSelectedAgent(initialAgent);
    } else if (initialAgent && selectedAgent && selectedAgent.id === initialAgent.id) {
      // If the same agent is already selected, just update its properties
      // This maintains UI consistency during refetches
      setSelectedAgent(prevAgent => {
        if (!prevAgent) return initialAgent;
        return {
          ...prevAgent,
          ...initialAgent
        };
      });
    }
  }, [initialAgent, selectedAgent]);
  
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
      <PageHeader
        title="Agent Management"
        icon={faRobot}
        subtitle="View, configure and manage your AI agents from a central dashboard"
      />
      
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
                  <EditableField
                    value={selectedAgent.name}
                    label="Agent Name"
                    placeholder="Enter agent name..."
                    icon={<FontAwesomeIcon icon={faRobot} />}
                    isSaving={savingField === 'name'}
                    onSave={async (value) => {
                      if (!value.trim()) {
                        toast.error('Agent name cannot be empty');
                        return;
                      }
                      setSavingField('name');
                      try {
                        const update: AgentUpdate = { name: value };
                        await updateAgentMutation.mutateAsync({ 
                          agentId: selectedAgent.id, 
                          update 
                        });
                        // Explicitly refetch the agent data to update the UI
                        if (selectedAgent.id === initialSelectedAgentId) {
                          await refetchAgent();
                        }
                      } catch (error) {
                        // Error is already handled in the mutation
                      } finally {
                        setSavingField(null);
                      }
                    }}
                  />
                  
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <EditableField
                      value={selectedAgent.hosting || ""}
                      label="Hosting"
                      placeholder="Enter hosting..."
                      icon={<FontAwesomeIcon icon={faServer} />}
                      isSaving={savingField === 'hosting'}
                      onSave={async (value) => {
                        setSavingField('hosting');
                        try {
                          const update: AgentUpdate = { hosting: value };
                          await updateAgentMutation.mutateAsync({ 
                            agentId: selectedAgent.id, 
                            update 
                          });
                          // Explicitly refetch the agent data to update the UI
                          if (selectedAgent.id === initialSelectedAgentId) {
                            await refetchAgent();
                          }
                        } catch (error) {
                          // Error is already handled in the mutation
                        } finally {
                          setSavingField(null);
                        }
                      }}
                    />
                    
                    <EditableField
                      value={selectedAgent.model || ""}
                      label="Model"
                      placeholder="Enter model..."
                      icon={<FontAwesomeIcon icon={faRobot} />}
                      isSaving={savingField === 'model'}
                      onSave={async (value) => {
                        setSavingField('model');
                        try {
                          const update: AgentUpdate = { model: value };
                          await updateAgentMutation.mutateAsync({ 
                            agentId: selectedAgent.id, 
                            update 
                          });
                          // Explicitly refetch the agent data to update the UI
                          if (selectedAgent.id === initialSelectedAgentId) {
                            await refetchAgent();
                          }
                        } catch (error) {
                          // Error is already handled in the mutation
                        } finally {
                          setSavingField(null);
                        }
                      }}
                    />
                  </Box>
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
                  
                  <EditableField
                    value={selectedAgent.description || ""}
                    label="Description"
                    placeholder="Enter agent description..."
                    icon={<FontAwesomeIcon icon={faTag} />}
                    multiline
                    rows={3}
                    isSaving={savingField === 'description'}
                    onSave={async (value) => {
                      setSavingField('description');
                      try {
                        const update: AgentUpdate = { description: value };
                        await updateAgentMutation.mutateAsync({ 
                          agentId: selectedAgent.id, 
                          update 
                        });
                        // Explicitly refetch the agent data to update the UI
                        if (selectedAgent.id === initialSelectedAgentId) {
                          await refetchAgent();
                        }
                      } catch (error) {
                        // Error is already handled in the mutation
                      } finally {
                        setSavingField(null);
                      }
                    }}
                  />
                  
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
                  
                  <EditableField
                    value={selectedAgent.security_prompt || ""}
                    label=""
                    placeholder="Enter security prompt..."
                    multiline
                    rows={6}
                    isSaving={savingField === 'security_prompt'}
                    onSave={async (value) => {
                      setSavingField('security_prompt');
                      try {
                        const update: AgentUpdate = { security_prompt: value };
                        await updateAgentMutation.mutateAsync({ 
                          agentId: selectedAgent.id, 
                          update 
                        });
                        // Explicitly refetch the agent data to update the UI
                        if (selectedAgent.id === initialSelectedAgentId) {
                          await refetchAgent();
                        }
                      } catch (error) {
                        // Error is already handled in the mutation
                      } finally {
                        setSavingField(null);
                      }
                    }}
                  />
                </Box>
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
