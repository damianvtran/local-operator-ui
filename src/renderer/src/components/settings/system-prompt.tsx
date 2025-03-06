import { useState, useEffect } from 'react';
import type { FC } from 'react';
import { 
  Typography, 
  TextField, 
  Button, 
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Box
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot, faSave } from '@fortawesome/free-solid-svg-icons';
import { useSystemPrompt } from '@renderer/hooks/use-system-prompt';
import { useUpdateSystemPrompt } from '@renderer/hooks/use-update-system-prompt';
import type { SystemPromptUpdate } from '@renderer/api/local-operator/types';

/**
 * SystemPrompt component
 * Displays and allows editing of the system prompt
 */
export const SystemPrompt: FC = () => {
  const { data: systemPromptData, isLoading, error, refetch } = useSystemPrompt();
  const updateSystemPromptMutation = useUpdateSystemPrompt();
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isEdited, setIsEdited] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Initialize the system prompt when data is loaded
  useEffect(() => {
    if (systemPromptData) {
      setSystemPrompt(systemPromptData.content);
      setIsEdited(false);
    }
  }, [systemPromptData]);
  
  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSystemPrompt(e.target.value);
    setIsEdited(e.target.value !== systemPromptData?.content);
  };
  
  // Handle save
  const handleSave = async () => {
    if (!isEdited) return;
    
    setIsSaving(true);
    try {
      const update: SystemPromptUpdate = {
        content: systemPrompt
      };
      
      await updateSystemPromptMutation.mutateAsync(update);
      // Explicitly refetch to update the UI
      await refetch();
      setIsEdited(false);
    } catch (error) {
      // Error is already handled in the mutation
      console.error('Error updating system prompt:', error);
    } finally {
      setIsSaving(false);
    }
  };
  
  // Handle reset
  const handleReset = () => {
    if (systemPromptData) {
      setSystemPrompt(systemPromptData.content);
      setIsEdited(false);
    }
  };
  
  // Loading state
  if (isLoading) {
    return (
      <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2 }}>
        <CardContent sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}>
          <CircularProgress />
        </CardContent>
      </Card>
    );
  }
  
  // Error state
  if (error || !systemPromptData) {
    return (
      <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2 }}>
        <CardContent>
          <Alert severity="error">
            Failed to load system prompt. Please try again later.
          </Alert>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2 }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <FontAwesomeIcon icon={faRobot} />
          System Prompt
        </Typography>
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The system prompt defines how Local Operator behaves and responds to your messages.
        </Typography>
        
        <TextField
          label="System Prompt"
          name="systemPrompt"
          value={systemPrompt}
          onChange={handleInputChange}
          variant="outlined"
          multiline
          rows={6}
          fullWidth
          sx={{ mb: 2 }}
        />
        
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button 
            variant="contained" 
            color="primary"
            size="small"
            startIcon={<FontAwesomeIcon icon={faSave} />}
            onClick={handleSave}
            disabled={!isEdited || isSaving}
          >
            {isSaving ? <CircularProgress size={20} /> : 'Save Changes'}
          </Button>
          
          <Button 
            variant="outlined" 
            size="small"
            onClick={handleReset}
            disabled={!isEdited || isSaving}
          >
            Cancel
          </Button>
        </Box>
        
        {systemPromptData.last_modified && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            Last modified: {new Date(systemPromptData.last_modified).toLocaleString()}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
};
