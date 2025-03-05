import React, { useState, useEffect } from 'react';
import type { FC } from 'react';
import { Box, CssBaseline } from '@mui/material';
import { library } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { fab } from '@fortawesome/free-brands-svg-icons';

import { SidebarNavigation } from '@renderer/components/navigation/sidebar-navigation';
import { ChatPage } from '@components/chat/chat-page';
import { SettingsPage } from '@renderer/components/settings/settings-page';
import { AgentsPage } from '@renderer/components/agents/agents-page';

library.add(fas, fab);

const App: FC = () => {
  const [currentView, setCurrentView] = useState<'chat' | 'settings' | 'agents'>('chat');
  const [selectedConversation, setSelectedConversation] = useState<string | undefined>(undefined);
  const [selectedAgentForSettings, setSelectedAgentForSettings] = useState<string | undefined>(undefined);
  
  // Handle navigation between views
  const handleNavigate = (view: string) => {
    if (view === 'chat' || view === 'settings' || view === 'agents') {
      setCurrentView(view as 'chat' | 'settings' | 'agents');
    }
  };
  
  // Handle navigation to agent settings
  const handleNavigateToAgentSettings = (agentId: string) => {
    setSelectedAgentForSettings(agentId);
    setCurrentView('agents');
  };
  
  // Reset selectedAgentForSettings when leaving the agents page
  useEffect(() => {
    if (currentView !== 'agents') {
      setSelectedAgentForSettings(undefined);
    }
  }, [currentView]);
  
  // Handle selecting a conversation
  const handleSelectConversation = (id: string) => {
    setSelectedConversation(id);
    setCurrentView('chat'); // Switch to chat view when selecting a conversation
  };
  
  return (
    <Box sx={{ 
      display: 'flex',
      height: '100vh',
      overflow: 'hidden'
    }}>
      <CssBaseline />
      
      {/* Sidebar Navigation */}
      <SidebarNavigation 
        currentView={currentView} 
        onNavigate={handleNavigate} 
      />
      
      {/* Main Content Area */}
      <Box sx={{ 
        flexGrow: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {currentView === 'chat' ? (
          <ChatPage 
            conversationId={selectedConversation} 
            onSelectConversation={handleSelectConversation}
            selectedConversation={selectedConversation}
            onNavigateToAgentSettings={handleNavigateToAgentSettings}
          />
        ) : currentView === 'settings' ? (
          <SettingsPage />
        ) : (
          <AgentsPage 
            key={selectedAgentForSettings} 
            initialSelectedAgentId={selectedAgentForSettings}
          />
        )}
      </Box>
    </Box>
  );
};

export default App;
