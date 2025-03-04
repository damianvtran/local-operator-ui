import React, { useState } from 'react';
import type { FC } from 'react';
import { Box, CssBaseline } from '@mui/material';
import { library } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { fab } from '@fortawesome/free-brands-svg-icons';

import { NavigationBar } from '@renderer/components/navigation/navigation-bar';
import { ChatSidebar } from '@components/chat/chat-sidebar';
import { ChatPage } from '@components/chat/chat-page';
import { SettingsPage } from '@renderer/components/settings/settings-page';
import { AgentsPage } from '@renderer/components/agents/agents-page';

library.add(fas, fab);

const App: FC = () => {
  const [currentView, setCurrentView] = useState<'chat' | 'settings' | 'agents'>('chat');
  const [selectedConversation, setSelectedConversation] = useState<string | undefined>(undefined);
  
  // Handle navigation between views
  const handleNavigate = (view: string) => {
    if (view === 'chat' || view === 'settings' || view === 'agents') {
      setCurrentView(view as 'chat' | 'settings' | 'agents');
    }
  };
  
  // Handle selecting a conversation
  const handleSelectConversation = (id: string) => {
    setSelectedConversation(id);
    setCurrentView('chat'); // Switch to chat view when selecting a conversation
  };
  
  return (
    <Box sx={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100vh',
      overflow: 'hidden'
    }}>
      <CssBaseline />
      
      {/* Top Navigation Bar */}
      <NavigationBar 
        currentView={currentView} 
        onNavigate={handleNavigate} 
      />
      
      {/* Main Content Area */}
      <Box sx={{ 
        display: 'flex', 
        flexGrow: 1,
        overflow: 'hidden'
      }}>
        {/* Left Sidebar (always visible) */}
        <ChatSidebar 
          selectedConversation={selectedConversation}
          onSelectConversation={handleSelectConversation}
        />
        
        {/* Main Content (Chat, Settings, or Agents) */}
        {currentView === 'chat' ? (
          <ChatPage conversationId={selectedConversation} />
        ) : currentView === 'settings' ? (
          <SettingsPage />
        ) : (
          <AgentsPage />
        )}
      </Box>
    </Box>
  );
};

export default App;
