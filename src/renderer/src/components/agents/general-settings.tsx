/**
 * General Settings Component
 * 
 * Component for displaying and editing general agent settings
 */

import type { FC } from 'react';
import { 
  Box, 
  Grid, 
  Typography, 
  Divider, 
  alpha,
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
  faIdCard,
  faTag,
} from '@fortawesome/free-solid-svg-icons';
import type { AgentDetails, AgentUpdate } from '@renderer/api/local-operator/types';
import type { useUpdateAgent } from '@renderer/hooks/use-update-agent';
import { EditableField } from '../common/editable-field';

type GeneralSettingsProps = {
  /**
   * The selected agent to display settings for
   */
  selectedAgent: AgentDetails;
  
  /**
   * Currently saving field
   */
  savingField: string | null;
  
  /**
   * Function to set the saving field
   */
  setSavingField: (field: string | null) => void;
  
  /**
   * Agent update mutation
   */
  updateAgentMutation: ReturnType<typeof useUpdateAgent>;
  
  /**
   * Function to refetch agent data after updates
   */
  refetchAgent?: () => Promise<unknown>;
  
  /**
   * Initial selected agent ID
   */
  initialSelectedAgentId?: string;
};

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

/**
 * General Settings Component
 * 
 * Component for displaying and editing general agent settings
 */
export const GeneralSettings: FC<GeneralSettingsProps> = ({ 
  selectedAgent, 
  savingField, 
  setSavingField, 
  updateAgentMutation, 
  refetchAgent, 
  initialSelectedAgentId 
}) => {
  return (
    <>
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
    </>
  );
};
