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
  styled,
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

const StyledDialog = styled(Dialog)({
  '& .MuiPaper-root': {
    borderRadius: 16,
    backgroundColor: 'background.paper',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
    maxWidth: '500px',
    width: '100%',
  },
});

const IconContainer = styled(Box)({
  display: 'flex',
  alignItems: 'center',
});

const StyledIcon = styled(FontAwesomeIcon)(({ theme }) => ({
  color: theme.palette.primary.main,
  marginRight: '12px',
  fontSize: '1.2rem',
}));

const FormContainer = styled(Box)({
  marginTop: 8,
});

const NameField = styled(TextField)({
  marginBottom: 16,
});

const ActionButton = styled(Button)({
  borderRadius: 12,
  textTransform: 'none',
  fontWeight: 500,
});

const CancelButton = styled(ActionButton)({});

const CreateButton = styled(ActionButton)({
  marginLeft: 8,
});

const DialogActionsStyled = styled(DialogActions)({
  padding: '0 24px 24px 24px',
});

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
    <StyledDialog
      open={open}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          <IconContainer>
            <StyledIcon icon={faRobot} />
            <Typography variant="h6">Create New Agent</Typography>
          </IconContainer>
        </DialogTitle>
        <DialogContent>
          <FormContainer>
            <NameField
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
          </FormContainer>
        </DialogContent>
        <DialogActionsStyled>
          <CancelButton
            onClick={onClose}
            variant="outlined"
            color="inherit"
            disabled={isLoading}
          >
            Cancel
          </CancelButton>
          <CreateButton
            type="submit"
            variant="contained"
            color="primary"
            disabled={isSubmitDisabled}
            startIcon={
              isLoading ? <CircularProgress size={20} color="inherit" /> : null
            }
          >
            Create Agent
          </CreateButton>
        </DialogActionsStyled>
      </form>
    </StyledDialog>
  );
};
