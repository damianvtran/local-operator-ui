import { useState, useRef, type KeyboardEvent } from 'react';
import type { FC, FormEvent, ChangeEvent } from 'react';
import { 
  Box, 
  TextField, 
  Button, 
  IconButton, 
  Typography,
  alpha,
  Tooltip,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faPaperclip, faTimes } from '@fortawesome/free-solid-svg-icons';

type MessageInputProps = {
  onSendMessage: (content: string, file: File | null) => void;
  isLoading: boolean;
}

const FormContainer = styled('form')(({ theme }) => ({
  padding: theme.spacing(3),
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.4),
  minHeight: 100,
}));

const AttachmentButton = styled(IconButton)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.primary.main, 0.08),
  width: 52,
  height: 52,
  borderRadius: theme.shape.borderRadius * 1.5,
  marginRight: theme.spacing(1),
  transition: 'all 0.2s ease-in-out',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.15),
    transform: 'translateY(-2px)'
  },
  '&:active': {
    transform: 'translateY(0px)'
  }
}));

const StyledTextField = styled(TextField)(({ theme }) => ({
  flex: 1,
  '& .MuiOutlinedInput-root': {
    borderRadius: theme.shape.borderRadius * 1.5,
    backgroundColor: alpha(theme.palette.background.paper, 0.6),
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    transition: 'all 0.2s ease-in-out',
    '&.Mui-focused': {
      backgroundColor: alpha(theme.palette.background.paper, 0.8),
      boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.15)}`
    },
    '&:hover': {
      backgroundColor: alpha(theme.palette.background.paper, 0.7),
    },
    padding: '14px 18px',
    fontSize: '1rem',
    minHeight: 48,
    display: 'flex',
    alignItems: 'center'
  }
}));

const FilePreviewContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: alpha(theme.palette.primary.main, 0.08),
  borderRadius: theme.shape.borderRadius,
  padding: theme.spacing(1, 2),
  border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
  height: 48,
  margin: theme.spacing(0, 1)
}));

const FileNameText = styled(Typography)({
  maxWidth: 150,
  fontWeight: 500,
  color: 'primary.main',
  display: 'flex',
  alignItems: 'center'
});

const RemoveFileButton = styled(IconButton)(({ theme }) => ({
  marginLeft: theme.spacing(1),
  color: 'primary.main',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.15)
  }
}));

const SendButton = styled(Button)(({ theme }) => ({
  borderRadius: theme.shape.borderRadius * 1.5,
  minWidth: 'auto',
  width: 48,
  height: 48,
  padding: 0,
  marginLeft: theme.spacing(1),
  boxShadow: theme.shadows[2],
  transition: 'all 0.2s ease-in-out',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  '&:not(:disabled):hover': {
    transform: 'translateY(-2px)',
    boxShadow: theme.shadows[4]
  },
  '&:not(:disabled):active': {
    transform: 'translateY(0px)'
  },
  '&.Mui-disabled': {
    backgroundColor: alpha(theme.palette.action.disabled, 0.2)
  }
}));

export const MessageInput: FC<MessageInputProps> = ({ onSendMessage, isLoading }) => {
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    
    if (!newMessage.trim() && !selectedFile) return;
    
    onSendMessage(newMessage, selectedFile);
    setNewMessage('');
    setSelectedFile(null);
  };
  
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };
  
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };
  
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (newMessage.trim() || selectedFile) {
        handleSubmit(e as unknown as FormEvent);
      }
    }
  };
  
  return (
    <FormContainer onSubmit={handleSubmit}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        accept="image/*,.pdf,.doc,.docx,.txt"
      />
      
      <Tooltip title="Attach file">
        <AttachmentButton 
          onClick={triggerFileInput}
          color="primary"
          size="medium"
          aria-label="Attach file"
        >
          <FontAwesomeIcon icon={faPaperclip} />
        </AttachmentButton>
      </Tooltip>
      
      <StyledTextField
        fullWidth
        placeholder="✨ Type to Chat! Press ↵ to send, Shift+↵ for new line 📝"
        value={newMessage}
        onChange={(e) => setNewMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        multiline
        maxRows={4}
        variant="outlined"
      />
      
      {selectedFile && (
        <FilePreviewContainer>
          <FileNameText variant="caption" noWrap>
            {selectedFile.name}
          </FileNameText>
          <RemoveFileButton 
            size="small" 
            onClick={() => setSelectedFile(null)}
            aria-label="Remove file"
          >
            <FontAwesomeIcon icon={faTimes} size="xs" />
          </RemoveFileButton>
        </FilePreviewContainer>
      )}
      
      <Tooltip title="Send message">
        <span>
          <SendButton
            type="submit"
            variant="contained"
            color="primary"
            disabled={isLoading || (!newMessage.trim() && !selectedFile)}
            aria-label="Send message"
          >
            <FontAwesomeIcon icon={faPaperPlane} />
          </SendButton>
        </span>
      </Tooltip>
    </FormContainer>
  );
};
