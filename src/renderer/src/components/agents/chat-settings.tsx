/**
 * Chat Settings Component
 * 
 * Component for displaying and editing chat-specific agent settings
 */

import type { FC } from 'react';
import { 
  Box, 
  Typography, 
  Tooltip, 
  IconButton,
  alpha,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { toast } from 'react-toastify';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faInfoCircle, 
  faGear,
  faComments
} from '@fortawesome/free-solid-svg-icons';
import type { AgentDetails, AgentUpdate } from '@renderer/api/local-operator/types';
import type { useUpdateAgent } from '@renderer/hooks/use-update-agent';
import { EditableField } from '../common/editable-field';
import { SliderSetting } from '../common/slider-setting';

type ChatSettingsProps = {
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

const InfoButton = styled(IconButton)(({ theme }) => ({
  marginLeft: theme.spacing(1),
  color: theme.palette.primary.main,
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.08)
  }
}));

/**
 * Chat Settings Component
 * 
 * Component for displaying and editing chat-specific agent settings
 */
export const ChatSettings: FC<ChatSettingsProps> = ({ 
  selectedAgent, 
  savingField, 
  setSavingField, 
  updateAgentMutation, 
  refetchAgent, 
  initialSelectedAgentId 
}) => {
  return (
    <Box sx={{ mt: 4, mb: 3 }}>
      <SectionTitle variant="subtitle1">
        <TitleIcon icon={faComments} />
        Chat Settings
        {/* @ts-ignore - Tooltip has issues with TypeScript but works fine */}
        <Tooltip title="Settings that control how the agent generates responses" arrow placement="top">
          <InfoButton size="small">
            <FontAwesomeIcon icon={faInfoCircle} size="xs" />
          </InfoButton>
        </Tooltip>
      </SectionTitle>
      
      <SliderSetting
        value={selectedAgent.temperature ?? 0.8}
        label="Temperature"
        description="Controls randomness in responses (0.0-1.0). Higher values make output more random."
        min={0}
        max={1}
        step={0.01}
        isSaving={savingField === 'temperature'}
        onChange={async (value) => {
          setSavingField('temperature');
          try {
            const update: AgentUpdate = { temperature: value };
            await updateAgentMutation.mutateAsync({ 
              agentId: selectedAgent.id, 
              update 
            });
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
      
      <SliderSetting
        value={selectedAgent.top_p ?? 0.9}
        label="Top P"
        description="Controls cumulative probability of tokens to sample from (0.0-1.0)."
        min={0}
        max={1}
        step={0.01}
        isSaving={savingField === 'top_p'}
        onChange={async (value) => {
          setSavingField('top_p');
          try {
            const update: AgentUpdate = { top_p: value };
            await updateAgentMutation.mutateAsync({ 
              agentId: selectedAgent.id, 
              update 
            });
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
      
      <SliderSetting
        value={selectedAgent.top_k ?? 40}
        label="Top K"
        description="Limits tokens to sample from at each step."
        min={1}
        max={100}
        step={1}
        isSaving={savingField === 'top_k'}
        onChange={async (value) => {
          setSavingField('top_k');
          try {
            const update: AgentUpdate = { top_k: value };
            await updateAgentMutation.mutateAsync({ 
              agentId: selectedAgent.id, 
              update 
            });
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
      
      <SliderSetting
        value={selectedAgent.max_tokens ?? 4096}
        label="Max Tokens"
        description="Maximum tokens to generate in response."
        min={1}
        max={8192}
        step={1}
        isSaving={savingField === 'max_tokens'}
        onChange={async (value) => {
          setSavingField('max_tokens');
          try {
            const update: AgentUpdate = { max_tokens: value };
            await updateAgentMutation.mutateAsync({ 
              agentId: selectedAgent.id, 
              update 
            });
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
      
      <EditableField
        value={selectedAgent.stop?.join('\n') || ""}
        label="Stop Sequences"
        placeholder="Enter stop sequences (one per line)..."
        icon={<FontAwesomeIcon icon={faGear} />}
        multiline
        rows={3}
        isSaving={savingField === 'stop'}
        onSave={async (value) => {
          setSavingField('stop');
          try {
            // Split by newlines and filter out empty lines
            const stopSequences = value
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0);
            
            const update: AgentUpdate = { 
              stop: stopSequences.length > 0 ? stopSequences : undefined 
            };
            
            await updateAgentMutation.mutateAsync({ 
              agentId: selectedAgent.id, 
              update 
            });
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
      
      <SliderSetting
        value={selectedAgent.frequency_penalty ?? 0}
        label="Frequency Penalty"
        description="Reduces repetition by lowering likelihood of repeated tokens (-2.0 to 2.0)."
        min={-2}
        max={2}
        step={0.01}
        isSaving={savingField === 'frequency_penalty'}
        onChange={async (value) => {
          setSavingField('frequency_penalty');
          try {
            const update: AgentUpdate = { frequency_penalty: value };
            await updateAgentMutation.mutateAsync({ 
              agentId: selectedAgent.id, 
              update 
            });
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
      
      <SliderSetting
        value={selectedAgent.presence_penalty ?? 0}
        label="Presence Penalty"
        description="Increases diversity by lowering likelihood of prompt tokens (-2.0 to 2.0)."
        min={-2}
        max={2}
        step={0.01}
        isSaving={savingField === 'presence_penalty'}
        onChange={async (value) => {
          setSavingField('presence_penalty');
          try {
            const update: AgentUpdate = { presence_penalty: value };
            await updateAgentMutation.mutateAsync({ 
              agentId: selectedAgent.id, 
              update 
            });
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
      
      <EditableField
        value={selectedAgent.seed?.toString() || ""}
        label="Seed"
        placeholder="Random number seed for deterministic generation"
        icon={<FontAwesomeIcon icon={faGear} />}
        isSaving={savingField === 'seed'}
        onSave={async (value) => {
          setSavingField('seed');
          try {
            const seedValue = value.trim() ? Number.parseInt(value, 10) : undefined;
            
            // Validate that the seed is a valid number if provided
            if (value.trim() && Number.isNaN(seedValue as number)) {
              toast.error('Seed must be a valid number');
              return;
            }
            
            const update: AgentUpdate = { seed: seedValue };
            await updateAgentMutation.mutateAsync({ 
              agentId: selectedAgent.id, 
              update 
            });
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
  );
};
