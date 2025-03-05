import { useState } from 'react';
import type { FC } from 'react';
import { 
  Paper, 
  Box, 
  Typography, 
  Card, 
  CardContent, 
  CircularProgress,
  Alert,
  Grid,
  Container
} from '@mui/material';
import { 
  faGear, 
  faServer, 
  faRobot, 
  faHistory, 
  faDatabase,
  faCloudUploadAlt,
  faInfoCircle,
  faSave,
  faListAlt
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { PageHeader } from '../common/page-header';
import { EditableField } from '../common/editable-field';
import { SliderSetting } from '../common/slider-setting';
import { ToggleSetting } from '../common/toggle-setting';
import { useConfig } from '@renderer/hooks/use-config';
import { useUpdateConfig } from '@renderer/hooks/use-update-config';
import type { ConfigUpdate } from '@renderer/api/local-operator/types';

export const SettingsPage: FC = () => {
  const { data: config, isLoading, error, refetch } = useConfig();
  const updateConfigMutation = useUpdateConfig();
  const [savingField, setSavingField] = useState<string | null>(null);
  
  // Handle updating a specific field
  const handleUpdateField = async (field: keyof ConfigUpdate, value: string | number | boolean) => {
    setSavingField(field);
    try {
      const update: ConfigUpdate = {
        [field]: value
      };
      
      await updateConfigMutation.mutateAsync(update);
      // Explicitly refetch to update the UI
      await refetch();
    } catch (error) {
      // Error is already handled in the mutation
      console.error(`Error updating ${field}:`, error);
    } finally {
      setSavingField(null);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !config) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Failed to load configuration. Please try again later.
        </Alert>
      </Box>
    );
  }

  return (
    <Paper 
      elevation={0} 
      sx={{ 
        height: '100%',
        width: '100%',
        overflow: 'auto',
        p: { xs: 2, sm: 3, md: 4 },
        '&::-webkit-scrollbar': {
          width: '8px',
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
        },
      }}
    >
      <PageHeader
        title="Settings"
        icon={faGear}
        subtitle="Configure your application preferences and settings"
      />
      
      <Container maxWidth="lg" disableGutters sx={{ mt: 2 }}>
        <Grid container spacing={4}>
          {/* Left Column */}
          <Grid item xs={12} md={6}>
            {/* Model Settings */}
            <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
              <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <FontAwesomeIcon icon={faRobot} />
                  Model Settings
                </Typography>
                
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Configure the AI model and hosting provider used for generating responses.
                </Typography>
                
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <EditableField
                    value={config.values.hosting}
                    label="Hosting Provider"
                    placeholder="Enter hosting provider..."
                    icon={<FontAwesomeIcon icon={faServer} />}
                    isSaving={savingField === 'hosting'}
                    onSave={async (value) => {
                      await handleUpdateField('hosting', value);
                    }}
                  />
                  
                  <EditableField
                    value={config.values.model_name}
                    label="Model Name"
                    placeholder="Enter model name..."
                    icon={<FontAwesomeIcon icon={faRobot} />}
                    isSaving={savingField === 'model_name'}
                    onSave={async (value) => {
                      await handleUpdateField('model_name', value);
                    }}
                  />
                </Box>
              </CardContent>
            </Card>
            
            {/* Auto-Save Settings */}
            <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
              <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <FontAwesomeIcon icon={faSave} />
                  Auto-Save Settings
                </Typography>
                
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Control whether conversations are automatically saved for future reference.
                </Typography>
                
                <ToggleSetting
                  value={config.values.auto_save_conversation}
                  label="Auto-Save Conversations"
                  description="When enabled, all conversations will be automatically saved to your history"
                  icon={faCloudUploadAlt}
                  isSaving={savingField === 'auto_save_conversation'}
                  onChange={async (value) => {
                    await handleUpdateField('auto_save_conversation', value);
                  }}
                />
              </CardContent>
            </Card>
          </Grid>
          
          {/* Right Column */}
          <Grid item xs={12} md={6}>
            {/* History Settings */}
            <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
              <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <FontAwesomeIcon icon={faHistory} />
                  History Settings
                </Typography>
                
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Configure how much conversation history is retained and displayed.
                </Typography>
                
                <SliderSetting
                  value={config.values.conversation_length}
                  label="Maximum Conversation History"
                  description="Number of messages to keep in conversation history for context"
                  min={10}
                  max={200}
                  step={10}
                  unit="msgs"
                  icon={faHistory}
                  isSaving={savingField === 'conversation_length'}
                  onChange={async (value) => {
                    await handleUpdateField('conversation_length', value);
                  }}
                />
                
                <SliderSetting
                  value={config.values.detail_length}
                  label="Detail View Length"
                  description="Maximum number of messages to show in the detailed conversation view"
                  min={10}
                  max={100}
                  step={5}
                  unit="msgs"
                  icon={faListAlt}
                  isSaving={savingField === 'detail_length'}
                  onChange={async (value) => {
                    await handleUpdateField('detail_length', value);
                  }}
                />
                
                <SliderSetting
                  value={config.values.max_learnings_history}
                  label="Maximum Learnings History"
                  description="Number of learning items to retain for context and personalization"
                  min={10}
                  max={500}
                  step={10}
                  unit="items"
                  icon={faDatabase}
                  isSaving={savingField === 'max_learnings_history'}
                  onChange={async (value) => {
                    await handleUpdateField('max_learnings_history', value);
                  }}
                />
              </CardContent>
            </Card>
            
            {/* Configuration Metadata */}
            <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
              <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <FontAwesomeIcon icon={faInfoCircle} />
                  Configuration Information
                </Typography>
                
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  System information about the current configuration.
                </Typography>
                
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Box sx={{ 
                      p: 2, 
                      borderRadius: 2, 
                      bgcolor: 'background.default',
                      height: '100%'
                    }}>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>Version</Typography>
                      <Typography variant="body1" fontWeight={500}>{config.version}</Typography>
                    </Box>
                  </Grid>
                  
                  <Grid item xs={12} sm={6}>
                    <Box sx={{ 
                      p: 2, 
                      borderRadius: 2, 
                      bgcolor: 'background.default',
                      height: '100%'
                    }}>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>Created At</Typography>
                      <Typography variant="body1" fontWeight={500}>{new Date(config.metadata.created_at).toLocaleString()}</Typography>
                    </Box>
                  </Grid>
                  
                  <Grid item xs={12} sm={6}>
                    <Box sx={{ 
                      p: 2, 
                      borderRadius: 2, 
                      bgcolor: 'background.default',
                      height: '100%'
                    }}>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>Last Modified</Typography>
                      <Typography variant="body1" fontWeight={500}>{new Date(config.metadata.last_modified).toLocaleString()}</Typography>
                    </Box>
                  </Grid>
                  
                  <Grid item xs={12} sm={6}>
                    <Box sx={{ 
                      p: 2, 
                      borderRadius: 2, 
                      bgcolor: 'background.default',
                      height: '100%'
                    }}>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>Description</Typography>
                      <Typography variant="body1" fontWeight={500}>{config.metadata.description || "No description available"}</Typography>
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Container>
    </Paper>
  );
};
