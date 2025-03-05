import React, { useState, useMemo } from 'react';
import type { FC } from 'react';
import { Box, Paper, Divider, CircularProgress, Typography, Tabs, Tab } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot, faArrowRight, faCode, faCommentDots } from '@fortawesome/free-solid-svg-icons';
import { v4 as uuidv4 } from 'uuid';
import { ChatHeader } from './chat-header';
import { MessageItem } from './message-item';
import { MessageInput } from './message-input';
import { LoadingIndicator } from './loading-indicator';
import { ChatSidebar } from './chat-sidebar';
import { useScrollToBottom } from '@hooks/use-scroll-to-bottom';
import { useConversationMessages } from '@hooks/use-conversation-messages';
import { useJobPolling } from '@hooks/use-job-polling';
import { useChatStore } from '@store/chat-store';
import type { Message } from './types';
import { createLocalOperatorClient } from '@renderer/api/local-operator';
import { apiConfig } from '@renderer/config';

/**
 * Props for the ChatPage component
 */
type ChatProps = {
  /** ID of the current conversation */
  conversationId?: string;
  /** Callback for when a conversation is selected */
  onSelectConversation: (id: string) => void;
  /** Currently selected conversation ID */
  selectedConversation?: string;
}

/**
 * Chat Page Component
 * 
 * Displays the chat interface with a sidebar for agent selection and a main area for messages
 */
export const ChatPage: FC<ChatProps> = ({ 
  conversationId, 
  onSelectConversation, 
  selectedConversation 
}) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'raw'>('chat');
  
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
  
  // Use the job polling hook
  const {
    currentJobId,
    setCurrentJobId,
    jobStatus,
    isLoading,
    setIsLoading,
  } = useJobPolling({
    conversationId,
    addMessage,
  });

  // Handle sending a new message
  const handleSendMessage = async (content: string, file: File | null) => {
    if (!conversationId) return;
    
    // Create a new user message
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      message: content,
      timestamp: new Date(),
      attachments: file ? [URL.createObjectURL(file)] : undefined
    };
    
    // Add user message to chat store
    addMessage(conversationId, userMessage);
    
    // Set loading state
    setIsLoading(true);
    
    try {
      // Send message to the API using processAgentChatAsync from AgentsApi
      const jobDetails = await apiClient.chat.processAgentChatAsync(conversationId, {
        hosting: 'openrouter', // Default hosting
        model: 'google/gemini-2.0-flash-001', // Default model
        prompt: content,
        persist_conversation: true, // Persist conversation history
        user_message_id: userMessage.id,
      });
      
      // Store the job ID for polling
      // The API returns a CRUDResponse<JobDetails> where the actual job details are in the result property
      setCurrentJobId(jobDetails.result.id);
      
      // Note: We don't add the assistant message here
      // It will be added when the job completes (in the useJobPolling hook)
    } catch (error) {
      console.error('Error sending message:', error);
      // Add error message
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        message: 'Sorry, there was an error processing your request. Please try again.',
        stderr: error instanceof Error 
          ? `${error.message}\n${error.stack || ''}` 
          : 'Unknown error occurred',
        timestamp: new Date(),
        status: 'error'
      };
      
      // Add error message to chat store
      addMessage(conversationId, errorMessage);
      
      // Clear loading state
      setIsLoading(false);
    }
  };
  
  // Create a side-by-side layout with the sidebar and chat content
  return (
    <Box sx={{ 
      display: 'flex', 
      height: '100%',
      width: '100%',
      overflow: 'hidden'
    }}>
      {/* Chat Sidebar - fixed width */}
      <Box sx={{ flexShrink: 0, width: 280, height: '100%' }}>
        <ChatSidebar 
          selectedConversation={selectedConversation}
          onSelectConversation={onSelectConversation}
        />
      </Box>
      
      {/* Chat Content Area */}
      <Box sx={{ flexGrow: 1, height: '100%', overflow: 'hidden' }}>
        {/* Show placeholder when no conversation is selected */}
        {!conversationId ? (
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
              p: 3,
            }}
          >
            <FontAwesomeIcon 
              icon={faRobot} 
              style={{ 
                fontSize: '3rem', 
                marginBottom: '1rem',
                opacity: 0.5,
              }} 
            />
            <Typography variant="h6" sx={{ mb: 1, fontWeight: 500 }}>
              No Agent Selected
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 2, maxWidth: 500 }}>
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
        ) : isError ? (
          // Show error state if there was an error loading messages
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
        ) : (
          // Show chat content when a conversation is selected and there are no errors
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
            
            {/* Tabs for chat and raw */}
            <Tabs 
              value={activeTab} 
              onChange={(_, newValue) => setActiveTab(newValue)}
              sx={{ 
                borderBottom: 1, 
                borderColor: 'divider',
                minHeight: '42px',
                '& .MuiTabs-indicator': {
                  height: 2,
                  borderRadius: '2px 2px 0 0'
                }
              }}
              variant="fullWidth"
              TabIndicatorProps={{
                style: {
                  transition: 'all 0.3s ease'
                }
              }}
            >
              <Tab 
                icon={<FontAwesomeIcon icon={faCommentDots} />}
                iconPosition="start"
                label="Chat" 
                value="chat" 
                sx={{ 
                  minHeight: '42px', 
                  py: 0.5,
                  textTransform: 'none',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  transition: 'all 0.2s ease',
                  opacity: activeTab === 'chat' ? 1 : 0.7,
                  '&:hover': {
                    opacity: 1,
                    backgroundColor: 'rgba(255, 255, 255, 0.05)'
                  },
                  '& .MuiTab-iconWrapper': {
                    mr: 0.75,
                    fontSize: '0.9rem'
                  }
                }} 
              />
              <Tab 
                icon={<FontAwesomeIcon icon={faCode} />}
                iconPosition="start"
                label="Raw" 
                value="raw" 
                sx={{ 
                  minHeight: '42px',
                  py: 0.5,
                  textTransform: 'none',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  transition: 'all 0.2s ease',
                  opacity: activeTab === 'raw' ? 1 : 0.7,
                  '&:hover': {
                    opacity: 1,
                    backgroundColor: 'rgba(255, 255, 255, 0.05)'
                  },
                  '& .MuiTab-iconWrapper': {
                    mr: 0.75,
                    fontSize: '0.9rem'
                  }
                }} 
              />
            </Tabs>
            
            {activeTab === 'chat' ? (
              /* Messages container */
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
                    {isLoading && <LoadingIndicator status={jobStatus} />}
                    
                    {/* Invisible element to scroll to */}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </Box>
            ) : (
              /* Raw information tab */
              <Box 
                sx={{ 
                  flexGrow: 1, 
                  overflow: 'auto', 
                  p: 3,
                  bgcolor: 'rgba(0, 0, 0, 0.2)',
                  '&::-webkit-scrollbar': {
                    width: '8px',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    borderRadius: '4px',
                  },
                }}
              >
                <Typography variant="h6" gutterBottom sx={{ color: 'primary.main' }}>
                  Raw Information
                </Typography>
                <Box sx={{ 
                  p: 2, 
                  bgcolor: 'rgba(0, 0, 0, 0.3)', 
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  overflow: 'auto',
                }}>
                  <Typography variant="body2" component="pre" sx={{ fontSize: '0.8rem' }}>
                    {`Conversation ID: ${conversationId}
Messages count: ${messages.length}
Has more messages: ${hasMoreMessages ? 'Yes' : 'No'}
Loading more: ${isFetchingMore ? 'Yes' : 'No'}
Current job ID: ${currentJobId || 'None'}
Job status: ${jobStatus || 'None'}
Is loading: ${isLoading ? 'Yes' : 'No'}
Store messages: ${JSON.stringify(getMessages(conversationId || ''), null, 2)}`}
                  </Typography>
                </Box>
              </Box>
            )}
            
            <Divider sx={{ opacity: 0.1 }} />
            
            {/* Message input */}
            <MessageInput 
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
            />
          </Paper>
        )}
      </Box>
    </Box>
  );
};
