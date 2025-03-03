import { useState, useRef } from 'react';
import type { FC, FormEvent, ChangeEvent } from 'react';
import { 
  Box, 
  TextField, 
  Button, 
  IconButton, 
  Typography 
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faPaperclip } from '@fortawesome/free-solid-svg-icons';

interface MessageInputProps {
  onSendMessage: (content: string, file: File | null) => void;
  isLoading: boolean;
}

const MessageInput: FC<MessageInputProps> = ({ onSendMessage, isLoading }) => {
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
  
  return (
    <Box 
      component="form" 
      onSubmit={handleSubmit}
      sx={{ 
        p: 2, 
        display: 'flex', 
        alignItems: 'center',
        gap: 1
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
      <IconButton 
        onClick={triggerFileInput}
        color="primary"
        sx={{ 
          bgcolor: 'rgba(255, 255, 255, 0.05)',
          '&:hover': {
            bgcolor: 'rgba(255, 255, 255, 0.1)'
          }
        }}
      >
        <FontAwesomeIcon icon={faPaperclip} />
      </IconButton>
      
      {/* Text input */}
      <TextField
        fullWidth
        placeholder="Type a message..."
        value={newMessage}
        onChange={(e) => setNewMessage(e.target.value)}
        multiline
        maxRows={4}
        variant="outlined"
        InputProps={{
          sx: {
            borderRadius: 2,
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            '&.Mui-focused': {
              backgroundColor: 'rgba(255, 255, 255, 0.07)'
            }
          }
        }}
      />
      
      {/* Selected file preview */}
      {selectedFile && (
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          bgcolor: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 1,
          px: 1,
          py: 0.5
        }}>
          <Typography variant="caption" noWrap sx={{ maxWidth: 100 }}>
            {selectedFile.name}
          </Typography>
          <IconButton 
            size="small" 
            onClick={() => setSelectedFile(null)}
            sx={{ ml: 0.5 }}
          >
            &times;
          </IconButton>
        </Box>
      )}
      
      {/* Send button */}
      <Button
        type="submit"
        variant="contained"
        color="primary"
        disabled={isLoading || (!newMessage.trim() && !selectedFile)}
        sx={{ 
          borderRadius: 2,
          minWidth: 'auto',
          width: 40,
          height: 40,
          p: 0
        }}
      >
        <FontAwesomeIcon icon={faPaperPlane} />
      </Button>
    </Box>
  );
};

export default MessageInput;
