import type React from 'react';
import { Box, Button, alpha } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear, faMessage, faRobot } from '@fortawesome/free-solid-svg-icons';

type NavButtonsProps = {
  currentView: string;
  onNavigate: (view: string) => void;
};

/**
 * NavButton component for individual navigation items
 * Extracted for better maintainability and consistent styling
 */
type NavButtonProps = {
  icon: typeof faMessage | typeof faRobot | typeof faGear;
  label: string;
  view: string;
  isActive: boolean;
  onClick: () => void;
};

const NavButton: React.FC<NavButtonProps> = ({ icon, label, isActive, onClick }) => (
  <Button
    variant="nav"
    startIcon={
      <FontAwesomeIcon 
        icon={icon} 
        style={{ 
          color: isActive ? '#38C96A' : 'inherit',
          transition: 'color 0.3s ease'
        }} 
      />
    }
    onClick={onClick}
    sx={{
      position: 'relative',
      mx: 0.5,
      px: 2.5,
      py: 1.2,
      borderRadius: 2,
      fontWeight: isActive ? 500 : 400,
      color: isActive ? 'primary.main' : 'text.primary',
      backgroundColor: isActive ? alpha('#38C96A', 0.08) : 'transparent',
      transition: 'all 0.3s ease',
      '&:hover': {
        backgroundColor: isActive ? alpha('#38C96A', 0.12) : 'rgba(255,255,255,0.05)',
        transform: 'translateY(-2px)',
      },
      '&::after': {
        content: '""',
        position: 'absolute',
        bottom: 6,
        left: '50%',
        width: isActive ? '30%' : '0%',
        height: 2,
        backgroundColor: 'primary.main',
        transform: 'translateX(-50%)',
        transition: 'width 0.3s ease',
        borderRadius: 4,
        opacity: 0.8,
      }
    }}
  >
    {label}
  </Button>
);

/**
 * NavButtons component displays the main navigation buttons
 * Only visible on medium and larger screens
 * 
 * @param currentView - The current active view/page
 * @param onNavigate - Function to handle navigation between views
 */
export const NavButtons: React.FC<NavButtonsProps> = ({ currentView, onNavigate }) => {
  return (
    <Box 
      sx={{ 
        display: { xs: 'none', md: 'flex' }, 
        alignItems: 'center',
        gap: 0.5,
        mx: 2,
        py: 1,
        borderRadius: 3,
        backdropFilter: 'blur(8px)',
      }}
    >
      <NavButton
        icon={faMessage}
        label="Chat"
        view="chat"
        isActive={currentView === 'chat'}
        onClick={() => onNavigate('chat')}
      />
      <NavButton
        icon={faRobot}
        label="Agents"
        view="agents"
        isActive={currentView === 'agents'}
        onClick={() => onNavigate('agents')}
      />
      <NavButton
        icon={faGear}
        label="Settings"
        view="settings"
        isActive={currentView === 'settings'}
        onClick={() => onNavigate('settings')}
      />
    </Box>
  );
};
