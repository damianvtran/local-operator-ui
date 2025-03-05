import type { FC } from 'react';
import { Box, Typography, Avatar, Paper } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faRobot } from '@fortawesome/free-solid-svg-icons';
import { MarkdownRenderer } from './markdown-renderer';
import type { Message } from './types';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';

type MessageItemProps = {
  message: Message;
}

export const MessageItem: FC<MessageItemProps> = ({ message }) => {
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
      
      <Paper 
        elevation={1}
        sx={{ 
          maxWidth: { xs: '85%', sm: '75%', md: '65%' },
          width: 'auto',
          bgcolor: isUser 
            ? 'primary.dark' 
            : 'background.paper',
          p: 2,
          borderRadius: 2,
          border: isUser 
            ? 'none'
            : '1px solid rgba(255, 255, 255, 0.1)',
          wordBreak: 'break-word',
          overflowWrap: 'break-word'
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
        {message.message && (
          <Box sx={{ mb: message.code || message.stdout || message.stderr || message.logging ? 2 : 0 }}>
            <MarkdownRenderer content={message.message} />
          </Box>
        )}
        
        {/* Render code with syntax highlighting */}
        {message.code && (
          <Box sx={{ mb: message.stdout || message.stderr || message.logging ? 2 : 0, width: '100%' }}>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}>
              Code
            </Typography>
            <SyntaxHighlighter
              language="javascript"
              style={atomOneDark}
              customStyle={{
                borderRadius: '8px',
                margin: 0,
                fontSize: '0.85rem',
                width: '100%',
              }}
            >
              {message.code}
            </SyntaxHighlighter>
          </Box>
        )}
        
        {/* Render stdout */}
        {message.stdout && (
          <Box sx={{ mb: message.stderr || message.logging ? 2 : 0, width: '100%' }}>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}>
              Output
            </Typography>
            <Box
              sx={{
                fontFamily: '"Roboto Mono", monospace',
                fontSize: '0.85rem',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '8px',
                p: 1.5,
                maxHeight: '200px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                width: '100%',
                '&::-webkit-scrollbar': {
                  width: '6px',
                },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '3px',
                },
              }}
            >
              {message.stdout}
            </Box>
          </Box>
        )}
        
        {/* Render stderr */}
        {message.stderr && message.stderr !== "[No error output]" && (
          <Box sx={{ mb: message.logging ? 2 : 0, width: '100%' }}>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'error.light' }}>
              Error
            </Typography>
            <Box
              sx={{
                fontFamily: '"Roboto Mono", monospace',
                fontSize: '0.85rem',
                backgroundColor: 'rgba(255, 0, 0, 0.1)',
                borderRadius: '8px',
                p: 1.5,
                maxHeight: '200px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                color: 'error.light',
                width: '100%',
                '&::-webkit-scrollbar': {
                  width: '6px',
                },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '3px',
                },
              }}
            >
              {message.stderr}
            </Box>
          </Box>
        )}
        
        {/* Render logging */}
        {message.logging && message.logging !== "[No logger output]" && (
          <Box sx={{ mb: message.formatted_print ? 2 : 0, width: '100%' }}>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}>
              Logs
            </Typography>
            <Box
              sx={{
                fontFamily: '"Roboto Mono", monospace',
                fontSize: '0.85rem',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '8px',
                p: 1.5,
                maxHeight: '200px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                color: 'info.light',
                width: '100%',
                '&::-webkit-scrollbar': {
                  width: '6px',
                },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '3px',
                },
              }}
            >
              {message.logging}
            </Box>
          </Box>
        )}
        
        {/* Status indicator if present */}
        {message.status && (
          <Box 
            sx={{ 
              mt: 1,
              display: 'inline-block',
              px: 1,
              py: 0.5,
              borderRadius: '4px',
              fontSize: '0.75rem',
              backgroundColor: message.status === 'error' 
                ? 'error.dark' 
                : message.status === 'success'
                  ? 'success.dark'
                  : 'info.dark',
              color: 'white',
            }}
          >
            {message.status}
          </Box>
        )}
        
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
      </Paper>
    </Box>
  );
};
