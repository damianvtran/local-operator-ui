import React, { useState, useMemo } from 'react';
import type { FC } from 'react';
import { Box, Paper, Divider, CircularProgress, Typography } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot, faArrowRight } from '@fortawesome/free-solid-svg-icons';

import { ChatHeader } from './chat-header';
import { MessageItem } from './message-item';
import { MessageInput } from './message-input';
import { LoadingIndicator } from './loading-indicator';
import { useScrollToBottom } from '@hooks/use-scroll-to-bottom';
import { useConversationMessages } from '@hooks/use-conversation-messages';
import { useChatStore } from '@store/chat-store';
import type { Message } from './types';
import { createLocalOperatorClient } from '@renderer/api/local-operator';
import { apiConfig } from '@renderer/config';

type ChatProps = {
  conversationId?: string;
}

export const ChatPage: FC<ChatProps> = ({ conversationId }) => {
  const [isLoading, setIsLoading] = useState(false);
  
  // Initialize the API client (memoized to prevent recreation on every render)
  const apiClient = useMemo(() => createLocalOperatorClient(apiConfig.baseUrl), []);
  
  // Get the chat store functions
  const { getMessages } = useChatStore();
  
  // Only fetch messages if we have a valid conversation ID
  const {
    messages,
    isLoading: isLoadingMessages,
    isError,
    error,
    isFetchingMore,
    hasMoreMessages,
    messagesContainerRef,
  } = useConversationMessages(conversationId);

  // We no longer need to directly fetch messages from the API
  // The useConversationMessages hook handles this for us
  
  // Get the addMessage function from the chat store
  const { addMessage } = useChatStore();
  
  // Use custom hook to scroll to bottom when messages change
  const messagesEndRef = useScrollToBottom([messages.length]);
  
  // Handle sending a new message
  const handleSendMessage = async (content: string, file: File | null) => {
    if (!conversationId) return;
    
    // Create a new user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
      attachments: file ? [URL.createObjectURL(file)] : undefined
    };
    
    // Add user message to chat store
    addMessage(conversationId, userMessage);
    
    // Set loading state
    setIsLoading(true);
    
    try {
      // Send message to the API
      const response = await apiClient.chat.processChat(apiConfig.baseUrl, {
        hosting: 'openrouter', // Default hosting
        model: 'openai/gpt-4o-mini', // Default model
        prompt: content,
        context: messages.map(msg => ({
          content: msg.content,
          role: msg.role === 'user' ? 'user' : 'assistant',
          timestamp: msg.timestamp.toISOString(),
        })),
      });
      
      // Create assistant message from response
      const assistantMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: response.response,
        timestamp: new Date(),
      };
      
      // Add assistant message to chat store
      addMessage(conversationId, assistantMessage);
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Add error message
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'Sorry, there was an error processing your request. Please try again.',
        timestamp: new Date(),
      };
      
      // Add error message to chat store
      addMessage(conversationId, errorMessage);
    } finally {
      // Clear loading state
      setIsLoading(false);
    }
  };
  
  // Show placeholder when no conversation is selected
  if (!conversationId) {
    return (
      <Paper 
        elevation={0} 
        sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          height: '100%',
          flexGrow: 1,
          borderRadius: 0,
          justifyContent: 'center',
          alignItems: 'center',
          p: 4,
        }}
      >
        <FontAwesomeIcon 
          icon={faRobot} 
          style={{ 
            fontSize: '4rem', 
            marginBottom: '1.5rem',
            opacity: 0.5,
          }} 
        />
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 500 }}>
          No Agent Selected
        </Typography>
        <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 3, maxWidth: 500 }}>
          Select an agent from the sidebar to start a conversation.
        </Typography>
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          color: 'primary.main',
          opacity: 0.7,
        }}>
          <FontAwesomeIcon icon={faArrowRight} style={{ transform: 'rotate(180deg)', marginRight: '0.5rem' }} />
          <Typography variant="body2">
            Choose an agent from the list
          </Typography>
        </Box>
      </Paper>
    );
  }
  
  // Show error state if there was an error loading messages
  if (isError) {
    return (
      <Paper 
        elevation={0} 
        sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          height: '100%',
          flexGrow: 1,
          borderRadius: 0,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Typography variant="h6" color="error">
          Error loading messages
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {error?.message || 'An unknown error occurred'}
        </Typography>
      </Paper>
    );
  }
  
  return (
    <Paper 
      elevation={0} 
      sx={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%',
        flexGrow: 1,
        borderRadius: 0
      }}
    >
      {/* Chat header */}
      <ChatHeader agentName={`Agent ${conversationId}`} description="Conversation with this agent" />
      
      {/* Messages container */}
      <Box 
        ref={messagesContainerRef}
        sx={{ 
          flexGrow: 1, 
          overflow: 'auto', 
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '4px',
          },
        }}
      >
        {/* Loading more messages indicator */}
        {isFetchingMore && (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            padding: 2,
            color: 'rgba(255, 255, 255, 0.7)'
          }}>
            <CircularProgress size={20} sx={{ mr: 1 }} />
            Loading more messages...
          </Box>
        )}
        
        {/* Show loading indicator when initially loading messages */}
        {isLoadingMessages && !messages.length ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* Debug info */}
            {process.env.NODE_ENV !== 'production' && (
              <Box sx={{ 
                p: 2, 
                mb: 2, 
                bgcolor: 'rgba(0, 0, 0, 0.2)', 
                borderRadius: 1,
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                overflow: 'auto',
                maxHeight: '200px'
              }}>
                <Typography variant="subtitle2" gutterBottom>
                  Debug Info:
                </Typography>
                <Typography variant="body2" component="pre" sx={{ fontSize: '0.7rem' }}>
                  {`Conversation ID: ${conversationId}
Messages count: ${messages.length}
Has more messages: ${hasMoreMessages ? 'Yes' : 'No'}
Loading more: ${isFetchingMore ? 'Yes' : 'No'}
Store messages: ${JSON.stringify(getMessages(conversationId || ''), null, 2)}`}
                </Typography>
              </Box>
            )}
            
            {/* Render messages */}
            {messages.length > 0 ? (
              messages.map((message) => (
                <MessageItem key={message.id} message={message} />
              ))
            ) : (
              <Box sx={{ textAlign: 'center', color: 'text.secondary', p: 4 }}>
                <Typography variant="body1">
                  No messages yet. Start a conversation!
                </Typography>
              </Box>
            )}
            
            {/* Loading indicator for new message */}
            {isLoading && <LoadingIndicator />}
            
            {/* Invisible element to scroll to */}
            <div ref={messagesEndRef} />
          </>
        )}
      </Box>
      
      <Divider sx={{ opacity: 0.1 }} />
      
      {/* Message input */}
      <MessageInput 
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
      />
    </Paper>
  );
};
