import type { FC } from 'react';
import { Box, Typography, Avatar } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faRobot } from '@fortawesome/free-solid-svg-icons';
import MarkdownRenderer from './MarkdownRenderer';
import type { Message } from './types';

interface MessageItemProps {
  message: Message;
}

const MessageItem: FC<MessageItemProps> = ({ message }) => {
  const isUser = message.role === 'user';
  
  return (
    <Box 
      sx={{ 
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        gap: 2
      }}
    >
      <Avatar 
        sx={{ 
          bgcolor: isUser 
            ? 'primary.dark' 
            : 'rgba(56, 201, 106, 0.2)',
          color: isUser 
            ? 'white' 
            : 'primary.main'
        }}
      >
        <FontAwesomeIcon 
          icon={isUser ? faUser : faRobot} 
          size="sm" 
        />
      </Avatar>
      
      <Box 
        sx={{ 
          maxWidth: '70%',
          bgcolor: isUser 
            ? 'primary.dark' 
            : 'background.paper',
          p: 2,
          borderRadius: 2,
          border: isUser 
            ? 'none'
            : '1px solid rgba(255, 255, 255, 0.1)'
        }}
      >
        {/* Render attachments if any */}
        {message.attachments && message.attachments.length > 0 && (
          <Box sx={{ mb: 2 }}>
            {message.attachments.map((attachment) => (
              <Box 
                key={`${message.id}-${attachment}`} 
                component="img" 
                src={attachment}
                alt="Attachment"
                sx={{ 
                  maxWidth: '100%', 
                  maxHeight: 200, 
                  borderRadius: 1,
                  mb: 1
                }}
              />
            ))}
          </Box>
        )}
        
        {/* Render message content with markdown support */}
        <MarkdownRenderer content={message.content} />
        
        {/* Message timestamp */}
        <Typography 
          variant="caption" 
          sx={{ 
            display: 'block', 
            mt: 1, 
            textAlign: isUser ? 'left' : 'right',
            color: 'text.secondary',
            fontSize: '0.7rem'
          }}
        >
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Typography>
      </Box>
    </Box>
  );
};

export default MessageItem;
