import { useState } from 'react';
import type { FC } from 'react';
import { Box, Paper, Divider } from '@mui/material';

import { ChatHeader } from './chat-header';
import { MessageItem } from './message-item';
import { MessageInput } from './message-input';
import { LoadingIndicator } from './loading-indicator';
import { useScrollToBottom } from '@hooks/useScrollToBottom';
import { mockMessages, type Message } from './types';

interface ChatProps {
  conversationId: string;
}

export const ChatPage: FC<ChatProps> = ({ conversationId }) => {
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [isLoading, setIsLoading] = useState(false);
  
  // Use custom hook to scroll to bottom when messages change
  const messagesEndRef = useScrollToBottom([messages.length]);
  
  const handleSendMessage = (content: string, file: File | null) => {
    // Create a new user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
      attachments: file ? [URL.createObjectURL(file)] : undefined
    };
    
    // Add user message to chat
    setMessages(prev => [...prev, userMessage]);
    
    // Simulate sending message to backend and getting response
    setIsLoading(true);
    
    // Simulate API delay
    setTimeout(() => {
      // Create a mock response from the assistant
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `I received your message: "${content}"\n\nHow can I help you further?`,
        timestamp: new Date()
      };
      
      // Add assistant message to chat
      setMessages(prev => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1500);
  };
  
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
      <ChatHeader />
      
      {/* Messages container */}
      <Box sx={{ 
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
      }}>
        {/* Render messages */}
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
        
        {/* Loading indicator */}
        {isLoading && <LoadingIndicator />}
        
        {/* Invisible element to scroll to */}
        <div ref={messagesEndRef} />
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
