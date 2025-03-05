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
        gap: 2,
        mb: 2
      }}
    >
      <Avatar 
        sx={{ 
          bgcolor: isUser 
            ? 'rgba(66, 133, 244, 0.9)' 
            : 'rgba(56, 201, 106, 0.2)',
          color: isUser 
            ? 'white' 
            : 'primary.main',
          boxShadow: isUser ? '0 2px 8px rgba(66, 133, 244, 0.25)' : 'none'
        }}
      >
        <FontAwesomeIcon 
          icon={isUser ? faUser : faRobot} 
          size="sm" 
        />
      </Avatar>
      
      <Paper 
        elevation={isUser ? 2 : 1}
        sx={{ 
          maxWidth: { xs: '85%', sm: '75%', md: '65%' },
          width: 'auto',
          bgcolor: isUser 
            ? 'rgba(66, 133, 244, 0.15)' 
            : 'background.paper',
          p: 2,
          borderRadius: 2,
          border: isUser 
            ? '1px solid rgba(66, 133, 244, 0.3)'
            : '1px solid rgba(255, 255, 255, 0.1)',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          boxShadow: isUser 
            ? '0 4px 12px rgba(0, 0, 0, 0.15)' 
            : '0 2px 8px rgba(0, 0, 0, 0.1)',
          color: isUser ? 'text.primary' : 'inherit',
          position: 'relative',
          '&::after': isUser ? {
            content: '""',
            position: 'absolute',
            top: '12px',
            right: '-8px',
            width: '16px',
            height: '16px',
            backgroundColor: 'rgba(66, 133, 244, 0.15)',
            borderRight: '1px solid rgba(66, 133, 244, 0.3)',
            borderTop: '1px solid rgba(66, 133, 244, 0.3)',
            transform: 'rotate(45deg)',
            zIndex: -1
          } : {}
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
                  mb: 1,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)'
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
              language="python"
              style={atomOneDark}
              customStyle={{
                borderRadius: '8px',
                margin: 0,
                fontSize: '0.85rem',
                width: '100%',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)'
              }}
              wrapLines={true}
              wrapLongLines={true}
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
                maxHeight: '300px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                width: '100%',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
                color: 'inherit',
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
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: isUser ? 'error.main' : 'error.light' }}>
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
                color: isUser ? 'error.main' : 'error.light',
                width: '100%',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
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
                color: isUser ? 'info.main' : 'info.light',
                width: '100%',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
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
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
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
