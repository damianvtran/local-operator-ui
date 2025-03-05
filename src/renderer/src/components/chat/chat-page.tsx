import React, { useState, useMemo } from 'react';
import type { FC } from 'react';
import { Box, Paper, Divider, CircularProgress, Typography, Tabs, Tab, styled } from '@mui/material';
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
import { useAgent } from '@hooks/use-agents';
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
  /** Callback for navigating to agent settings */
  onNavigateToAgentSettings?: (agentId: string) => void;
}

const Container = styled(Box)({
  display: 'flex',
  height: '100%',
  width: '100%',
  overflow: 'hidden'
});

const SidebarContainer = styled(Box)({
  flexShrink: 0,
  width: 280,
  height: '100%'
});

const ContentContainer = styled(Box)({
  flexGrow: 1,
  height: '100%',
  overflow: 'hidden'
});

const PlaceholderContainer = styled(Paper)({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  flexGrow: 1,
  borderRadius: 0,
  justifyContent: 'center',
  alignItems: 'center',
  padding: 24
});

const PlaceholderIcon = styled(FontAwesomeIcon)({
  fontSize: '3rem',
  marginBottom: '1rem',
  opacity: 0.5
});

const DirectionIndicator = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  color: theme.palette.primary.main,
  opacity: 0.7
}));

const ErrorContainer = styled(Paper)({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  flexGrow: 1,
  borderRadius: 0,
  justifyContent: 'center',
  alignItems: 'center'
});

const ChatContainer = styled(Paper)({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  flexGrow: 1,
  borderRadius: 0
});

const StyledTabs = styled(Tabs)(() => ({
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  minHeight: '42px',
  '& .MuiTabs-indicator': {
    height: 2,
    borderRadius: '2px 2px 0 0'
  }
}));

const StyledTab = styled(Tab, {
  shouldForwardProp: (prop) => prop !== 'isActive'
})<{ isActive?: boolean }>(({ isActive }) => ({
  minHeight: '42px',
  padding: '4px 0',
  textTransform: 'none',
  fontSize: '0.85rem',
  fontWeight: 500,
  transition: 'all 0.2s ease',
  opacity: isActive ? 1 : 0.7,
  '&:hover': {
    opacity: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  },
  '& .MuiTab-iconWrapper': {
    marginRight: 6,
    fontSize: '0.9rem'
  }
}));

const MessagesContainer = styled(Box)({
  flexGrow: 1,
  overflow: 'auto',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  '&::-webkit-scrollbar': {
    width: '8px',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '4px',
  }
});

const LoadingMoreIndicator = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  color: 'rgba(255, 255, 255, 0.7)'
});

const LoadingBox = styled(Box)({
  display: 'flex',
  justifyContent: 'center',
  padding: 32
});

const EmptyMessagesBox = styled(Box)({
  textAlign: 'center',
  color: 'text.secondary',
  padding: 32
});

const RawInfoContainer = styled(Box)({
  flexGrow: 1,
  overflow: 'auto',
  padding: 24,
  backgroundColor: 'rgba(0, 0, 0, 0.2)',
  '&::-webkit-scrollbar': {
    width: '8px',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '4px',
  }
});

const RawInfoContent = styled(Box)({
  padding: 16,
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  borderRadius: 4,
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  overflow: 'auto'
});

const StyledDivider = styled(Divider)({
  opacity: 0.1
});

/**
 * Chat Page Component
 * 
 * Displays the chat interface with a sidebar for agent selection and a main area for messages
 */
export const ChatPage: FC<ChatProps> = ({ 
  conversationId, 
  onSelectConversation, 
  selectedConversation,
  onNavigateToAgentSettings
}) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'raw'>('chat');
  
  // Initialize the API client (memoized to prevent recreation on every render)
  const apiClient = useMemo(() => createLocalOperatorClient(apiConfig.baseUrl), []);
  
  // Get the chat store functions
  const { getMessages } = useChatStore();
  
  // Fetch agent details for the current conversation
  const {
    data: agentData,
  } = useAgent(conversationId);

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
      if (jobDetails.result?.id) {
        setCurrentJobId(jobDetails.result.id);
      } else {
        console.error('Job details missing ID:', jobDetails);
        throw new Error('Failed to get job ID from response');
      }
      
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
    <Container>
      {/* Chat Sidebar - fixed width */}
      <SidebarContainer>
        <ChatSidebar 
          selectedConversation={selectedConversation}
          onSelectConversation={onSelectConversation}
          onNavigateToAgentSettings={onNavigateToAgentSettings}
        />
      </SidebarContainer>
      
      {/* Chat Content Area */}
      <ContentContainer>
        {/* Show placeholder when no conversation is selected */}
        {!conversationId ? (
          <PlaceholderContainer elevation={0}>
            <PlaceholderIcon icon={faRobot} />
            <Typography variant="h6" sx={{ mb: 1, fontWeight: 500 }}>
              No Agent Selected
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 2, maxWidth: 500 }}>
              Select an agent from the sidebar to start a conversation.
            </Typography>
            <DirectionIndicator>
              <FontAwesomeIcon icon={faArrowRight} style={{ transform: 'rotate(180deg)', marginRight: '0.5rem' }} />
              <Typography variant="body2">
                Choose an agent from the list
              </Typography>
            </DirectionIndicator>
          </PlaceholderContainer>
        ) : isError ? (
          // Show error state if there was an error loading messages
          <ErrorContainer elevation={0}>
            <Typography variant="h6" color="error">
              Error loading messages
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {error?.message || 'An unknown error occurred'}
            </Typography>
          </ErrorContainer>
        ) : (
          // Show chat content when a conversation is selected and there are no errors
          <ChatContainer elevation={0}>
            {/* Chat header */}
            <ChatHeader 
              agentName={agentData?.name || ""} 
              description={agentData?.description || "Conversation with this agent"} 
            />
            
            {/* Tabs for chat and raw */}
            <StyledTabs 
              value={activeTab} 
              onChange={(_, newValue) => setActiveTab(newValue)}
              variant="fullWidth"
              TabIndicatorProps={{
                style: {
                  transition: 'all 0.3s ease'
                }
              }}
            >
              <StyledTab 
                icon={<FontAwesomeIcon icon={faCommentDots} />}
                iconPosition="start"
                label="Chat" 
                value="chat" 
                isActive={activeTab === 'chat'}
              />
              <StyledTab 
                icon={<FontAwesomeIcon icon={faCode} />}
                iconPosition="start"
                label="Raw" 
                value="raw" 
                isActive={activeTab === 'raw'}
              />
            </StyledTabs>
            
            {activeTab === 'chat' ? (
              /* Messages container */
              <MessagesContainer ref={messagesContainerRef}>
                {/* Loading more messages indicator */}
                {isFetchingMore && (
                  <LoadingMoreIndicator>
                    <CircularProgress size={20} sx={{ mr: 1 }} />
                    Loading more messages...
                  </LoadingMoreIndicator>
                )}
                
                {/* Show loading indicator when initially loading messages */}
                {isLoadingMessages && !messages.length ? (
                  <LoadingBox>
                    <CircularProgress />
                  </LoadingBox>
                ) : (
                  <>
                    {/* Render messages */}
                    {messages.length > 0 ? (
                      messages.map((message) => (
                        <MessageItem key={message.id} message={message} />
                      ))
                    ) : (
                      <EmptyMessagesBox>
                        <Typography variant="body1">
                          No messages yet. Start a conversation!
                        </Typography>
                      </EmptyMessagesBox>
                    )}
                    
                    {/* Loading indicator for new message */}
                    {isLoading && <LoadingIndicator status={jobStatus} agentName={agentData?.name} />}
                    
                    {/* Invisible element to scroll to */}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </MessagesContainer>
            ) : (
              /* Raw information tab */
              <RawInfoContainer>
                <Typography variant="h6" gutterBottom sx={{ color: 'primary.main' }}>
                  Raw Information
                </Typography>
                <RawInfoContent>
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
                </RawInfoContent>
              </RawInfoContainer>
            )}
            
            <StyledDivider />
            
            {/* Message input */}
            <MessageInput 
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
            />
          </ChatContainer>
        )}
      </ContentContainer>
    </Container>
  );
};
