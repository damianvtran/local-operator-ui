/**
 * Agent Settings Component
 * 
 * Component for displaying and editing agent settings
 */

import { useState } from 'react';
import type { FC } from 'react';
import { 
  Box, 
  Grid, 
  Paper, 
  Typography, 
  Divider, 
  IconButton,
  alpha,
  Tooltip,
} from '@mui/material';
import { styled } from '@mui/material/styles';
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
  faTag,
  faArrowLeft
} from '@fortawesome/free-solid-svg-icons';
import type { AgentDetails, AgentUpdate } from '@renderer/api/local-operator/types';
import { useUpdateAgent } from '@renderer/hooks/use-update-agent';
import { EditableField } from '../common/editable-field';

type AgentSettingsProps = {
  /**
   * The selected agent to display settings for
   */
  selectedAgent: AgentDetails | null;
  
  /**
   * Function to refetch agent data after updates
   */
  refetchAgent?: () => Promise<unknown>;
  
  /**
   * Initial selected agent ID
   */
  initialSelectedAgentId?: string;
};

const DetailsPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(4), 
  height: '100%', 
  borderRadius: 8,
  backgroundColor: theme.palette.background.default,
  display: 'flex',
  flexDirection: 'column',
  transition: 'all 0.25s ease',
  boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
  '&:hover': {
    boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
  },
  overflow: 'hidden'
}));

const ScrollableContent = styled(Box)({
  display: 'flex', 
  flexDirection: 'column', 
  height: '100%',
  overflow: 'auto',
  '&::-webkit-scrollbar': {
    width: '6px',
  },
  '&::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '10px',
    '&:hover': {
      backgroundColor: 'rgba(0, 0, 0, 0.2)',
    }
  },
});

const HeaderContainer = styled(Box)(({ theme }) => ({
  display: 'flex', 
  alignItems: 'center', 
  justifyContent: 'space-between',
  marginBottom: theme.spacing(2),
  gap: theme.spacing(2)
}));

const SectionTitle = styled(Typography)(({ theme }) => ({
  fontWeight: 600, 
  marginBottom: theme.spacing(2), 
  display: 'flex', 
  alignItems: 'center',
  color: theme.palette.text.primary
}));

const TitleIcon = styled(FontAwesomeIcon)({
  marginRight: 10,
  color: '#f2f2f3'
});

const InfoCard = styled(Box)(({ theme }) => ({
  display: 'flex', 
  alignItems: 'center', 
  marginBottom: theme.spacing(2),
  padding: theme.spacing(2),
  borderRadius: 16,
  backgroundColor: alpha(theme.palette.background.default, 0.7)
}));

const CardIcon = styled(FontAwesomeIcon)({
  marginRight: 12, 
  opacity: 0.8,
  color: '#f2f2f3'
});

const LabelText = styled(Box)(({ theme }) => ({
  color: theme.palette.text.secondary, 
  marginRight: theme.spacing(1)
}));

const ValueText = styled(Box)({
  fontWeight: 500
});

const MonospaceValueText = styled(ValueText)({
  fontFamily: 'monospace'
});

const InfoButton = styled(IconButton)(({ theme }) => ({
  marginLeft: theme.spacing(1),
  color: theme.palette.primary.main,
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.08)
  }
}));

const EmptyStateContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flexGrow: 1,
  padding: theme.spacing(4),
  background: `linear-gradient(180deg, ${alpha(theme.palette.background.default, 0)} 0%, ${alpha(theme.palette.background.paper, 0.05)} 100%)`,
  borderRadius: 16,
}));

const PlaceholderIcon = styled(FontAwesomeIcon)({
  fontSize: '3rem',
  marginBottom: '1rem',
  opacity: 0.5
});

const DirectionIndicator = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  color: theme.palette.primary.main,
  opacity: 0.7
}));

/**
 * Agent Settings Component
 * 
 * Component for displaying and editing agent settings
 */
export const AgentSettings: FC<AgentSettingsProps> = ({ 
  selectedAgent, 
  refetchAgent, 
  initialSelectedAgentId 
}) => {
  const [savingField, setSavingField] = useState<string | null>(null);
  const updateAgentMutation = useUpdateAgent();
  
  return (
    <DetailsPaper>
      {selectedAgent ? (
        <ScrollableContent>
          <HeaderContainer>
            <Box sx={{ width: '100%' }}>
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
                    if (selectedAgent.id === initialSelectedAgentId && refetchAgent) {
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
            
            <Box sx={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <Box sx={{ width: '220px' }}>
                <EditableField
                  value={selectedAgent.hosting || ""}
                  label="Hosting"
                  placeholder="Default"
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
                      if (selectedAgent.id === initialSelectedAgentId && refetchAgent) {
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
              
              <Box sx={{ width: '220px' }}>
                <EditableField
                  value={selectedAgent.model || ""}
                  label="Model"
                  placeholder="Default"
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
                      if (selectedAgent.id === initialSelectedAgentId && refetchAgent) {
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
          </HeaderContainer>
          
          <Divider sx={{ mb: 3 }} />
          
          <Box sx={{ mb: 3 }}>
            <SectionTitle variant="subtitle1">
              <TitleIcon icon={faInfoCircle} />
              Agent Information
            </SectionTitle>
            
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
                  if (selectedAgent.id === initialSelectedAgentId && refetchAgent) {
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
                <InfoCard>
                  <CardIcon icon={faIdCard} />
                  <Typography variant="body2" title="Unique identifier for this agent">
                    <LabelText>ID</LabelText>
                    <MonospaceValueText>
                      {selectedAgent.id}
                    </MonospaceValueText>
                  </Typography>
                </InfoCard>
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <InfoCard>
                  <CardIcon icon={faCalendarAlt} />
                  <Typography variant="body2" title="When this agent was created">
                    <LabelText>Created</LabelText>
                    <ValueText>
                      {new Date(selectedAgent.created_date).toLocaleString()}
                    </ValueText>
                  </Typography>
                </InfoCard>
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <InfoCard>
                  <CardIcon icon={faCodeBranch} />
                  <Typography variant="body2" title="Agent version number">
                    <LabelText>Version</LabelText>
                    <ValueText>
                      {selectedAgent.version}
                    </ValueText>
                  </Typography>
                </InfoCard>
              </Grid>
              
            </Grid>
          </Box>
          
          <Box sx={{ mt: 1 }}>
            <SectionTitle variant="subtitle1">
              <TitleIcon icon={faShieldAlt} />
              Security Prompt
              {/* @ts-ignore - Tooltip has issues with TypeScript but works fine */}
              <Tooltip title="Security instructions that guide the agent's behavior and limitations" arrow placement="top">
                <InfoButton size="small">
                  <FontAwesomeIcon icon={faInfoCircle} size="xs" />
                </InfoButton>
              </Tooltip>
            </SectionTitle>
            
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
                  if (selectedAgent.id === initialSelectedAgentId && refetchAgent) {
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
        </ScrollableContent>
      ) : (
        <EmptyStateContainer>
          <PlaceholderIcon icon={faRobot} />
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 500 }}>
            No Agent Selected
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 2, maxWidth: 500 }}>
            Select an agent from the list to view its configuration and details
          </Typography>
          <DirectionIndicator>
            <FontAwesomeIcon icon={faArrowLeft} style={{ marginRight: '0.5rem' }} />
            <Typography variant="body2">
              Select an Agent
            </Typography>
          </DirectionIndicator>
        </EmptyStateContainer>
      )}
    </DetailsPaper>
  );
};
