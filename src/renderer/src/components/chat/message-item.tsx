import type { FC } from 'react';
import { Box, Typography, Avatar, Paper } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faRobot } from '@fortawesome/free-solid-svg-icons';
import { MarkdownRenderer } from './markdown-renderer';
import type { Message } from './types';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { styled } from '@mui/material/styles';

type MessageItemProps = {
  message: Message;
}

interface StyledComponentProps {
  isUser: boolean;
}

const MessageContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isUser'
})<StyledComponentProps>(({ isUser }) => ({
  display: 'flex',
  flexDirection: isUser ? 'row-reverse' : 'row',
  alignItems: 'flex-start',
  gap: 16,
  marginBottom: 16
}));

const UserAvatar = styled(Avatar, {
  shouldForwardProp: (prop) => prop !== 'isUser'
})<StyledComponentProps>(({ isUser, theme }) => ({
  backgroundColor: isUser 
    ? 'rgba(66, 133, 244, 0.9)' 
    : 'rgba(56, 201, 106, 0.2)',
  color: isUser 
    ? 'white' 
    : theme.palette.primary.main,
  boxShadow: isUser ? '0 2px 8px rgba(66, 133, 244, 0.25)' : 'none'
}));

// Create a Paper component with custom styling
const StyledPaper = styled(Paper)(({ theme }) => ({
  [theme.breakpoints.down('sm')]: {
    maxWidth: '85%',
  },
  [theme.breakpoints.between('sm', 'md')]: {
    maxWidth: '75%',
  },
  [theme.breakpoints.up('md')]: {
    maxWidth: '65%',
  },
  width: 'auto',
  padding: 16,
  borderRadius: 16,
  wordBreak: 'break-word',
  overflowWrap: 'break-word',
  position: 'relative',
}));

// Create a wrapper component to handle the isUser prop
const MessagePaper: FC<{isUser: boolean; elevation: number; children: React.ReactNode}> = ({ 
  isUser, 
  elevation, 
  children 
}) => {
  return (
    <StyledPaper 
      elevation={elevation}
      sx={{
        backgroundColor: isUser 
          ? 'rgba(66, 133, 244, 0.15)' 
          : theme => theme.palette.background.paper,
        border: isUser 
          ? '1px solid rgba(66, 133, 244, 0.3)'
          : '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: isUser 
          ? '0 4px 12px rgba(0, 0, 0, 0.15)' 
          : '0 2px 8px rgba(0, 0, 0, 0.1)',
        color: isUser 
          ? theme => theme.palette.text.primary 
          : 'inherit',
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
        } : undefined
      }}
    >
      {children}
    </StyledPaper>
  );
};

const AttachmentImage = styled('img')({
  maxWidth: '100%', 
  maxHeight: 200, 
  borderRadius: 8,
  marginBottom: 8,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)'
});

const SectionLabel = styled(Typography)({
  display: 'block', 
  marginBottom: 4, 
  color: 'text.secondary'
});

const CodeContainer = styled(Box)({
  marginBottom: 16, 
  width: '100%'
});

const OutputContainer = styled(Box)({
  fontFamily: '"Roboto Mono", monospace',
  fontSize: '0.85rem',
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  borderRadius: '8px',
  padding: 12,
  maxHeight: '300px',
  overflow: 'auto',
  whiteSpace: 'pre',
  width: '100%',
  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
  color: 'inherit',
  overflowX: 'auto',
  '&::-webkit-scrollbar': {
    width: '6px',
    height: '6px',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '3px',
  },
  '&::-webkit-scrollbar-corner': {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
});

const ErrorContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isUser'
})<StyledComponentProps>(({ isUser }) => ({
  fontFamily: '"Roboto Mono", monospace',
  fontSize: '0.85rem',
  backgroundColor: 'rgba(255, 0, 0, 0.1)',
  borderRadius: '8px',
  padding: 12,
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
}));

const LogContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isUser'
})<StyledComponentProps>(({ isUser }) => ({
  fontFamily: '"Roboto Mono", monospace',
  fontSize: '0.85rem',
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  borderRadius: '8px',
  padding: 12,
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
}));

const StatusIndicator = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'status'
})<{ status?: string }>(({ status }) => ({
  marginTop: 8,
  display: 'inline-block',
  paddingLeft: 8,
  paddingRight: 8,
  paddingTop: 4,
  paddingBottom: 4,
  borderRadius: '4px',
  fontSize: '0.75rem',
  backgroundColor: status === 'error' 
    ? 'error.dark' 
    : status === 'success'
      ? 'success.dark'
      : 'info.dark',
  color: 'white',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
}));

const Timestamp = styled(Typography, {
  shouldForwardProp: (prop) => prop !== 'isUser'
})<StyledComponentProps>(({ isUser }) => ({
  display: 'block', 
  marginTop: 8, 
  textAlign: isUser ? 'left' : 'right',
  color: 'text.secondary',
  fontSize: '0.7rem'
}));

export const MessageItem: FC<MessageItemProps> = ({ message }) => {
  const isUser = message.role === 'user';
  
  return (
    <MessageContainer isUser={isUser}>
      <UserAvatar isUser={isUser}>
        <FontAwesomeIcon 
          icon={isUser ? faUser : faRobot} 
          size="sm" 
        />
      </UserAvatar>
      
      <MessagePaper elevation={isUser ? 2 : 1} isUser={isUser}>
        {/* Render attachments if any */}
        {message.attachments && message.attachments.length > 0 && (
          <Box sx={{ mb: 2 }}>
            {message.attachments.map((attachment) => (
              <AttachmentImage 
                key={`${message.id}-${attachment}`} 
                src={attachment}
                alt="Attachment"
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
          <CodeContainer sx={{ mb: message.stdout || message.stderr || message.logging ? 2 : 0 }}>
            <SectionLabel variant="caption">
              Code
            </SectionLabel>
            <SyntaxHighlighter
              language="python"
              style={atomOneDark}
              customStyle={{
                borderRadius: '8px',
                fontSize: '0.85rem',
                width: '100%',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
                padding: '0.75rem'
              }}
              wrapLines={true}
              wrapLongLines={true}
            >
              {message.code}
            </SyntaxHighlighter>
          </CodeContainer>
        )}
        
        {/* Render stdout */}
        {message.stdout && (
          <CodeContainer sx={{ mb: message.stderr || message.logging ? 2 : 0 }}>
            <SectionLabel variant="caption">
              Output
            </SectionLabel>
            <OutputContainer>
              {message.stdout}
            </OutputContainer>
          </CodeContainer>
        )}
        
        {/* Render stderr */}
        {message.stderr && message.stderr !== "[No error output]" && (
          <CodeContainer sx={{ mb: message.logging ? 2 : 0 }}>
            <SectionLabel variant="caption" sx={{ color: isUser ? 'error.main' : 'error.light' }}>
              Error
            </SectionLabel>
            <ErrorContainer isUser={isUser}>
              {message.stderr}
            </ErrorContainer>
          </CodeContainer>
        )}
        
        {/* Render logging */}
        {message.logging && message.logging !== "[No logger output]" && (
          <CodeContainer sx={{ mb: message.formatted_print ? 2 : 0 }}>
            <SectionLabel variant="caption">
              Logs
            </SectionLabel>
            <LogContainer isUser={isUser}>
              {message.logging}
            </LogContainer>
          </CodeContainer>
        )}
        
        {/* Status indicator if present */}
        {message.status && (
          <StatusIndicator status={message.status}>
            {message.status}
          </StatusIndicator>
        )}
        
        {/* Message timestamp */}
        <Timestamp variant="caption" isUser={isUser}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Timestamp>
      </MessagePaper>
    </MessageContainer>
  );
};
