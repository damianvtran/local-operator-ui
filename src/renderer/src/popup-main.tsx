import React from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import { ThemeProvider } from '@shared/themes/theme-provider'; // Assuming this is the correct path
import { MessageInput } from '@features/chat/components/message-input'; // Assuming this is the correct path
import type { Message } from '@features/chat/types/message'; // Assuming this is the correct path
import '@assets/fonts/fonts.css'; // Ensure fonts are loaded, similar to main.tsx

console.log('[popup-main.tsx] Script executing. Checking for window.api...'); // Debug log

// The global type for window.api (including sendHotkey and sendPopupMessage)
// is now expected to be defined in a central .d.ts file (e.g., src/preload/index.d.ts).
// Removed local re-declaration of window.api to avoid type conflicts.

const PopupApp: React.FC = () => {
  // Log the api object once the component mounts to see its structure
  React.useEffect(() => {
    console.log('[popup-main.tsx] PopupApp mounted. window.api:', window.api);
    if (window.api) {
      console.log('[popup-main.tsx] window.api.sendPopupMessage type:', typeof window.api.sendPopupMessage);
      console.log('[popup-main.tsx] window.api.sendHotkey type:', typeof window.api.sendHotkey);
    }
  }, []);

  const handleSendMessage = (content: string, attachments: string[]) => {
    console.log('Popup Message Sent from UI:', { content, attachments });
    if (window.api && typeof window.api.sendPopupMessage === 'function') {
      window.api.sendPopupMessage({ content, attachments });
    } else {
      console.warn('window.api.sendPopupMessage is not available. Message not sent to main process.');
      alert(`Message (not sent to main process): ${content}`);
    }
  };

  // Simplified props for MessageInput in the popup context
  const messages: Message[] = []; // No message history in this simple popup view

  return (
    <ThemeProvider>
      <CssBaseline />
      {/* 
        The MessageInput component is designed to be part of a larger chat interface.
        Rendering it standalone like this might require careful consideration of its props
        and how it behaves without the full chat context.
        The height of the popup window (300px) might also be restrictive for MessageInput,
        which includes an input area, attachment previews, and buttons.
      */}
      <MessageInput
        onSendMessage={handleSendMessage}
        isLoading={false} // Assuming not initially loading
        conversationId="popup-chat" // A unique ID for this context
        messages={messages}
        currentJobId={null}
        onCancelJob={() => console.log('Cancel job clicked in popup')}
        isFarFromBottom={false}
        scrollToBottom={() => {}}
        initialSuggestions={['Quick action...', 'Draft email to...', 'Summarize:']}
        isChatUtilitiesExpanded={false} // Assuming not expanded by default
      />
      {/* 
        Optionally, add the hotkey configuration UI back here as a React component
        if it's still desired in the popup. For example:
        <HotkeyConfiguration /> 
      */}
    </ThemeProvider>
  );
};

document.addEventListener('DOMContentLoaded', () => {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <PopupApp />
      </React.StrictMode>
    );
  } else {
    console.error('Failed to find the root element for React popup app.');
  }
});
