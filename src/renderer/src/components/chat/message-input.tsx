import { useState, useRef, type KeyboardEvent } from 'react';
import type { FC, FormEvent, ChangeEvent } from 'react';
import { 
  Box, 
  TextField, 
  Button, 
  IconButton, 
  Typography,
  alpha,
  Tooltip
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faPaperclip, faTimes } from '@fortawesome/free-solid-svg-icons';

type MessageInputProps = {
  onSendMessage: (content: string, file: File | null) => void;
  isLoading: boolean;
}

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
    <Box 
      component="form" 
      onSubmit={handleSubmit}
      sx={{ 
        p: 2.5, 
        display: 'flex', 
        alignItems: 'flex-end',
        gap: 1.5,
        borderTop: (theme) => `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.4),
      }}
    >
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        accept="image/*,.pdf,.doc,.docx,.txt"
      />
      
      {/* Attachment button */}
      {/* @ts-ignore - MUI Tooltip requires children but we're providing it */}
      <Tooltip title="Attach file">
        <IconButton 
          onClick={triggerFileInput}
          color="primary"
          size="medium"
          aria-label="Attach file"
          sx={{ 
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
            width: 44,
            height: 44,
            borderRadius: 2.5,
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.15),
              transform: 'translateY(-2px)'
            },
            '&:active': {
              transform: 'translateY(0px)'
            }
          }}
        >
          <FontAwesomeIcon icon={faPaperclip} />
        </IconButton>
      </Tooltip>
      
      {/* Text input */}
      <TextField
        fullWidth
        placeholder="✨ Type to Chat! Press ↵ to send, Shift+↵ for new line 📝"
        value={newMessage}
        onChange={(e) => setNewMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        multiline
        maxRows={4}
        variant="outlined"
        InputProps={{
          sx: {
            borderRadius: 2.5,
            backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.6),
            border: (theme) => `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            transition: 'all 0.2s ease-in-out',
            '&.Mui-focused': {
              backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.8),
              boxShadow: (theme) => `0 0 0 3px ${alpha(theme.palette.primary.main, 0.15)}`
            },
            '&:hover': {
              backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.7),
            },
            padding: '12px 16px',
            fontSize: '0.95rem'
          }
        }}
      />
      
      {/* Selected file preview */}
      {selectedFile && (
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
          borderRadius: 2,
          px: 1.5,
          py: 0.75,
          border: (theme) => `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
          height: 44
        }}>
          <Typography 
            variant="caption" 
            noWrap 
            sx={{ 
              maxWidth: 120,
              fontWeight: 500,
              color: 'primary.main'
            }}
          >
            {selectedFile.name}
          </Typography>
          <IconButton 
            size="small" 
            onClick={() => setSelectedFile(null)}
            aria-label="Remove file"
            sx={{ 
              ml: 0.5,
              color: 'primary.main',
              '&:hover': {
                backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.15)
              }
            }}
          >
            <FontAwesomeIcon icon={faTimes} size="xs" />
          </IconButton>
        </Box>
      )}
      
      {/* Send button */}
      {/* @ts-ignore - MUI Tooltip requires children but we're providing it */}
      <Tooltip title="Send message">
        <span>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={isLoading || (!newMessage.trim() && !selectedFile)}
            aria-label="Send message"
            sx={{ 
              borderRadius: 2.5,
              minWidth: 'auto',
              width: 44,
              height: 44,
              p: 0,
              boxShadow: 2,
              transition: 'all 0.2s ease-in-out',
              '&:not(:disabled):hover': {
                transform: 'translateY(-2px)',
                boxShadow: 4
              },
              '&:not(:disabled):active': {
                transform: 'translateY(0px)'
              },
              '&.Mui-disabled': {
                backgroundColor: (theme) => alpha(theme.palette.action.disabled, 0.2)
              }
            }}
          >
            <FontAwesomeIcon icon={faPaperPlane} />
          </Button>
        </span>
      </Tooltip>
    </Box>
  );
};
