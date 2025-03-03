import { useState } from 'react';
import type { FC, ChangeEvent } from 'react';
import { Paper, Typography } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear } from '@fortawesome/free-solid-svg-icons';

import { AccountSettings } from './account-settings';
import { SystemPrompt } from './system-prompt';
import { HistorySettings } from './history-settings';
import { SaveButton } from './save-button';

// Default settings
const defaultSettings = {
  systemPrompt: 'You are Local Operator, an on-device AI assistant. You help users with their tasks, answer questions, and provide assistance. You are running locally on the user\'s device and do not send data to external servers.',
  maxConversationHistory: 50,
  detailedHistoryMode: true,
  maxLearningsHistory: 100,
  username: 'User',
  email: 'user@example.com'
};

export const SettingsPage: FC = () => {
  const [settings, setSettings] = useState(defaultSettings);
  const [isSaved, setIsSaved] = useState(false);
  
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: value
    }));
    setIsSaved(false);
  };
  
  const handleSwitchChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: checked
    }));
    setIsSaved(false);
  };
  
  const handleSliderChange = (name: string) => (_: Event, value: number | number[]) => {
    setSettings(prev => ({
      ...prev,
      [name]: value as number
    }));
    setIsSaved(false);
  };
  
  const handleSave = () => {
    // In a real app, this would save to localStorage or backend
    console.log('Saving settings:', settings);
    setIsSaved(true);
    
    // Reset saved status after 3 seconds
    setTimeout(() => {
      setIsSaved(false);
    }, 3000);
  };
  
  const handleResetSystemPrompt = () => {
    setSettings(prev => ({
      ...prev,
      systemPrompt: defaultSettings.systemPrompt
    }));
    setIsSaved(false);
  };
  
  return (
    <Paper 
      elevation={0} 
      sx={{ 
        height: '100%',
        overflow: 'auto',
        p: 3,
        '&::-webkit-scrollbar': {
          width: '8px',
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
        },
      }}
    >
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>
        <FontAwesomeIcon icon={faGear} style={{ marginRight: 12 }} />
        Settings
      </Typography>
      
      <AccountSettings 
        username={settings.username}
        email={settings.email}
        onInputChange={handleInputChange}
      />
      
      <SystemPrompt 
        systemPrompt={settings.systemPrompt}
        defaultSystemPrompt={defaultSettings.systemPrompt}
        onInputChange={handleInputChange}
        onReset={handleResetSystemPrompt}
      />
      
      <HistorySettings 
        maxConversationHistory={settings.maxConversationHistory}
        maxLearningsHistory={settings.maxLearningsHistory}
        detailedHistoryMode={settings.detailedHistoryMode}
        onSliderChange={handleSliderChange}
        onSwitchChange={handleSwitchChange}
      />
      
      <SaveButton 
        isSaved={isSaved}
        onSave={handleSave}
      />
    </Paper>
  );
};
