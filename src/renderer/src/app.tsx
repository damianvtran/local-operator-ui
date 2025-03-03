import { useState } from 'react';
import type { FC } from 'react';
import { Box, CssBaseline } from '@mui/material';
import { library } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { fab } from '@fortawesome/free-brands-svg-icons';

import Navigation from '@components/navigation';
import ChatSidebar from '@components/chat-sidebar';
import Chat from '@components/chat';
import Settings from '@components/settings';

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
      <Navigation 
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
          <Chat conversationId={selectedConversation} />
        ) : (
          <Settings />
        )}
      </Box>
    </Box>
  );
};

export default App;
