import type React from 'react';
import { Box, Button } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear, faMessage, faRobot } from '@fortawesome/free-solid-svg-icons';

type NavButtonsProps = {
  currentView: string;
  onNavigate: (view: string) => void;
};

/**
 * NavButtons component displays the main navigation buttons
 * Only visible on medium and larger screens
 */
export const NavButtons: React.FC<NavButtonsProps> = ({ currentView, onNavigate }) => {
  return (
    <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
      <Button 
        variant="nav"
        startIcon={<FontAwesomeIcon icon={faMessage} />}
        onClick={() => onNavigate('chat')}
        sx={{ 
          backgroundColor: currentView === 'chat' ? 'rgba(255,255,255,0.05)' : 'transparent'
        }}
      >
        Chat
      </Button>
      <Button 
        variant="nav"
        startIcon={<FontAwesomeIcon icon={faRobot} />}
        onClick={() => onNavigate('agents')}
        sx={{ 
          backgroundColor: currentView === 'agents' ? 'rgba(255,255,255,0.05)' : 'transparent'
        }}
      >
        Agents
      </Button>
      <Button 
        variant="nav"
        startIcon={<FontAwesomeIcon icon={faGear} />}
        onClick={() => onNavigate('settings')}
        sx={{ 
          backgroundColor: currentView === 'settings' ? 'rgba(255,255,255,0.05)' : 'transparent'
        }}
      >
        Settings
      </Button>
    </Box>
  );
};
