import type { FC, FormEvent } from 'react';
import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  CircularProgress,
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot } from '@fortawesome/free-solid-svg-icons';
import { useCreateAgent } from '@renderer/hooks/use-agent-mutations';
import type { AgentCreate } from '@renderer/api/local-operator/types';

type CreateAgentDialogProps = {
  /**
   * Whether the dialog is open
   */
  open: boolean;
  /**
   * Callback when the dialog is closed
   */
  onClose: () => void;
  /**
   * Optional callback when an agent is successfully created
   */
  onAgentCreated?: (agentId: string) => void;
};

/**
 * Dialog for creating a new agent
 * 
 * Reusable component that can be used in different parts of the application
 */
export const CreateAgentDialog: FC<CreateAgentDialogProps> = ({
  open,
  onClose,
  onAgentCreated,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  
  const createAgentMutation = useCreateAgent();
  
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      return;
    }
    
    const newAgent: AgentCreate = {
      name: name.trim(),
      description: description.trim() || undefined,
    };
    
    try {
      const result = await createAgentMutation.mutateAsync(newAgent);
      // Reset form and close dialog on success
      setName('');
      setDescription('');
      
      // Call the onAgentCreated callback if provided
      if (onAgentCreated && result?.id) {
        onAgentCreated(result.id);
      }
      
      onClose();
    } catch (error) {
      // Error is handled in the mutation
      console.error('Failed to create agent:', error);
    }
  };
  
  const isLoading = createAgentMutation.isPending;
  const isSubmitDisabled = isLoading || !name.trim();
  
  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          borderRadius: 2,
          bgcolor: 'background.paper',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          maxWidth: '500px',
          width: '100%',
        },
      }}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <FontAwesomeIcon
              icon={faRobot}
              style={{
                color: 'primary.main',
                marginRight: '12px',
                fontSize: '1.2rem',
              }}
            />
            <Typography variant="h6">Create New Agent</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            <TextField
              autoFocus
              margin="dense"
              id="name"
              label="Agent Name"
              type="text"
              fullWidth
              variant="outlined"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isLoading}
              sx={{ mb: 2 }}
            />
            <TextField
              margin="dense"
              id="description"
              label="Description (optional)"
              type="text"
              fullWidth
              variant="outlined"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
              multiline
              rows={3}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={onClose}
            variant="outlined"
            color="inherit"
            disabled={isLoading}
            sx={{
              borderRadius: 1.5,
              textTransform: 'none',
              fontWeight: 500,
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={isSubmitDisabled}
            sx={{
              borderRadius: 1.5,
              textTransform: 'none',
              fontWeight: 500,
              ml: 1,
            }}
            startIcon={
              isLoading ? <CircularProgress size={20} color="inherit" /> : null
            }
          >
            Create Agent
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
