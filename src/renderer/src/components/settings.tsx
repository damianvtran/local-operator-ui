import { useState } from 'react';
import type { FC, ChangeEvent } from 'react';
import { 
  Box, 
  Paper, 
  Typography, 
  TextField, 
  Button, 
  Switch, 
  FormControlLabel,
  Slider,
  Card,
  CardContent,
  Avatar,
  Stack
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faUser, 
  faSave, 
  faRobot, 
  faHistory, 
  faGear
} from '@fortawesome/free-solid-svg-icons';

// Default settings
const defaultSettings = {
  systemPrompt: 'You are Local Operator, an on-device AI assistant. You help users with their tasks, answer questions, and provide assistance. You are running locally on the user\'s device and do not send data to external servers.',
  maxConversationHistory: 50,
  detailedHistoryMode: true,
  maxLearningsHistory: 100,
  username: 'User',
  email: 'user@example.com'
};

const Settings: FC = () => {
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
      
      {/* Account Settings */}
      <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <FontAwesomeIcon icon={faUser} />
            Account Preferences
          </Typography>
          
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
            <Avatar 
              sx={{ 
                width: 64, 
                height: 64, 
                bgcolor: 'primary.dark',
                mr: 2
              }}
            >
              <FontAwesomeIcon icon={faUser} size="lg" />
            </Avatar>
            
            <Stack spacing={0.5}>
              <Typography variant="body1" fontWeight={500}>
                {settings.username}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {settings.email}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Local User Account
              </Typography>
            </Stack>
          </Box>
          
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              label="Username"
              name="username"
              value={settings.username}
              onChange={handleInputChange}
              variant="outlined"
              size="small"
              sx={{ flexGrow: 1, minWidth: '200px' }}
            />
            
            <TextField
              label="Email"
              name="email"
              value={settings.email}
              onChange={handleInputChange}
              variant="outlined"
              size="small"
              sx={{ flexGrow: 1, minWidth: '200px' }}
            />
          </Box>
        </CardContent>
      </Card>
      
      {/* System Prompt */}
      <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <FontAwesomeIcon icon={faRobot} />
            System Prompt
          </Typography>
          
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The system prompt defines how Local Operator behaves and responds to your messages.
          </Typography>
          
          <TextField
            label="System Prompt"
            name="systemPrompt"
            value={settings.systemPrompt}
            onChange={handleInputChange}
            variant="outlined"
            multiline
            rows={6}
            fullWidth
            sx={{ mb: 2 }}
          />
          
          <Button 
            variant="outlined" 
            size="small"
            onClick={() => {
              setSettings(prev => ({
                ...prev,
                systemPrompt: defaultSettings.systemPrompt
              }));
              setIsSaved(false);
            }}
          >
            Reset to Default
          </Button>
        </CardContent>
      </Card>
      
      {/* History Settings */}
      <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <FontAwesomeIcon icon={faHistory} />
            History Settings
          </Typography>
          
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" gutterBottom>
              Maximum Conversation History
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Slider
                value={settings.maxConversationHistory}
                onChange={handleSliderChange('maxConversationHistory')}
                min={10}
                max={200}
                step={10}
                valueLabelDisplay="auto"
                sx={{ flexGrow: 1 }}
              />
              <Typography variant="body2" sx={{ minWidth: '40px', textAlign: 'right' }}>
                {settings.maxConversationHistory}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Number of messages to keep in conversation history
            </Typography>
          </Box>
          
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" gutterBottom>
              Maximum Learnings History
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Slider
                value={settings.maxLearningsHistory}
                onChange={handleSliderChange('maxLearningsHistory')}
                min={10}
                max={500}
                step={10}
                valueLabelDisplay="auto"
                sx={{ flexGrow: 1 }}
              />
              <Typography variant="body2" sx={{ minWidth: '40px', textAlign: 'right' }}>
                {settings.maxLearningsHistory}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Number of learnings to retain for context
            </Typography>
          </Box>
          
          <FormControlLabel
            control={
              <Switch
                checked={settings.detailedHistoryMode}
                onChange={handleSwitchChange}
                name="detailedHistoryMode"
                color="primary"
              />
            }
            label="Detailed Conversation History Mode"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 2 }}>
            When enabled, Local Operator will retain more detailed context from your conversations
          </Typography>
        </CardContent>
      </Card>
      
      {/* Save Button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          color="primary"
          startIcon={<FontAwesomeIcon icon={faSave} />}
          onClick={handleSave}
          sx={{ px: 3 }}
        >
          {isSaved ? 'Saved!' : 'Save Settings'}
        </Button>
      </Box>
    </Paper>
  );
};

export default Settings;
