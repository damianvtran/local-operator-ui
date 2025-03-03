import { useState } from 'react';
import type { FC } from 'react';
import { 
  Box, 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemText, 
  ListItemAvatar, 
  Avatar, 
  Typography, 
  TextField, 
  InputAdornment,
  Divider,
  Paper
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faSearch, 
  faRobot, 
  faClock
} from '@fortawesome/free-solid-svg-icons';

// Mock data for conversations
// In a real app, this would come from the backend
type Conversation = {
  id: string;
  agentName: string;
  lastMessage: string;
  timestamp: string;
}

const mockConversations: Conversation[] = [
  {
    id: '1',
    agentName: 'Local Operator',
    lastMessage: 'How can I help you today?',
    timestamp: '10:30 AM'
  },
  {
    id: '2',
    agentName: 'Code Assistant',
    lastMessage: 'Here\'s the solution to your problem...',
    timestamp: 'Yesterday'
  },
  {
    id: '3',
    agentName: 'Research Agent',
    lastMessage: 'I found several papers on that topic.',
    timestamp: 'Mar 1'
  }
];

type ChatSidebarProps = {
  selectedConversation: string;
  onSelectConversation: (id: string) => void;
}

export const ChatSidebar: FC<ChatSidebarProps> = ({ 
  selectedConversation, 
  onSelectConversation 
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filter conversations based on search query
  const filteredConversations = mockConversations.filter(
    conversation => 
      conversation.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conversation.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Paper 
      elevation={0}
      sx={{ 
        width: 280, 
        height: '100%',
        borderRight: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 500 }}>
          Agents
        </Typography>
        
        <TextField
          fullWidth
          size="small"
          placeholder="Search conversations"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <FontAwesomeIcon icon={faSearch} size="sm" />
              </InputAdornment>
            ),
          }}
          sx={{ 
            mb: 2,
            '& .MuiOutlinedInput-root': {
              borderRadius: 2,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            }
          }}
        />
      </Box>
      
      <Divider sx={{ opacity: 0.1 }} />
      
      <List sx={{ 
        overflow: 'auto',
        flexGrow: 1,
        '&::-webkit-scrollbar': {
          width: '8px',
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
        },
      }}>
        {filteredConversations.length > 0 ? (
          filteredConversations.map((conversation) => (
            <ListItem key={conversation.id} disablePadding>
              <ListItemButton 
                selected={selectedConversation === conversation.id}
                onClick={() => onSelectConversation(conversation.id)}
                sx={{ 
                  mx: 1,
                  borderRadius: 2,
                  mb: 0.5,
                  '&.Mui-selected': {
                    backgroundColor: 'rgba(56, 201, 106, 0.1)',
                    '&:hover': {
                      backgroundColor: 'rgba(56, 201, 106, 0.15)',
                    }
                  }
                }}
              >
                <ListItemAvatar>
                  <Avatar 
                    sx={{ 
                      bgcolor: 'rgba(56, 201, 106, 0.2)',
                      color: 'primary.main'
                    }}
                  >
                    <FontAwesomeIcon icon={faRobot} />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText 
                  primary={conversation.agentName}
                  secondary={
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          color: 'text.secondary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '120px'
                        }}
                      >
                        {conversation.lastMessage}
                      </Typography>
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: 'text.secondary',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          fontSize: '0.7rem'
                        }}
                      >
                        <FontAwesomeIcon icon={faClock} size="xs" />
                        {conversation.timestamp}
                      </Typography>
                    </Box>
                  }
                  primaryTypographyProps={{
                    fontWeight: 500,
                    variant: 'body1',
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))
        ) : (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No conversations found
            </Typography>
          </Box>
        )}
      </List>
    </Paper>
  );
};
