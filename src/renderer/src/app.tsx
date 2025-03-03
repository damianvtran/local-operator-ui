import { useState } from 'react';
import type { FC } from 'react';
import { Box, CssBaseline } from '@mui/material';
import { library } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { fab } from '@fortawesome/free-brands-svg-icons';

import { NavigationBar } from '@renderer/components/navigation/navigation-bar';
import { ChatSidebar } from '@components/chat/chat-sidebar';
import { ChatPage } from '@components/chat/chat-page';
import { SettingsPage } from '@renderer/components/settings/settings-page';

library.add(fas, fab);

const App: FC = () => {
  const [currentView, setCurrentView] = useState<'chat' | 'settings'>('chat');
  const [selectedConversation, setSelectedConversation] = useState('1');
  
  // Handle navigation between views
  const handleNavigate = (view: string) => {
    if (view === 'chat' || view === 'settings') {
      setCurrentView(view);
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
        
        {/* Main Content (Chat or Settings) */}
        {currentView === 'chat' ? (
          <ChatPage conversationId={selectedConversation} />
        ) : (
          <SettingsPage />
        )}
      </Box>
    </Box>
  );
};

export default App;
