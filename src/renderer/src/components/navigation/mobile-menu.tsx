import React from 'react';
import { Box, IconButton, Menu, MenuItem, alpha } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear, faMessage, faEllipsisVertical, faRobot } from '@fortawesome/free-solid-svg-icons';

type MobileMenuProps = {
  currentView: string;
  onNavigate: (view: string) => void;
};

/**
 * MobileMenu component displays a menu icon and dropdown for mobile navigation
 * Only visible on small screens
 * 
 * @param currentView - The current active view/page
 * @param onNavigate - Function to handle navigation between views
 */
export const MobileMenu: React.FC<MobileMenuProps> = ({ currentView, onNavigate }) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };
  
  const handleClose = () => {
    setAnchorEl(null);
  };

  /**
   * Navigate to the selected view and close the menu
   */
  const handleNavigate = (view: string) => {
    handleClose();
    onNavigate(view);
  };

  return (
    <Box sx={{ display: { xs: 'flex', md: 'none' } }}>
      <IconButton
        size="medium"
        aria-label="menu"
        onClick={handleClick}
        sx={{
          color: 'text.primary',
          transition: 'all 0.2s ease',
          '&:hover': {
            backgroundColor: 'rgba(255,255,255,0.08)',
            transform: 'scale(1.05)',
          },
        }}
      >
        <FontAwesomeIcon icon={faEllipsisVertical} />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{
          elevation: 3,
          sx: {
            mt: 1.5,
            backgroundColor: 'background.paper',
            backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.03))',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 2,
            minWidth: 180,
            overflow: 'visible',
            '&:before': {
              content: '""',
              display: 'block',
              position: 'absolute',
              top: 0,
              right: 14,
              width: 10,
              height: 10,
              bgcolor: 'background.paper',
              transform: 'translateY(-50%) rotate(45deg)',
              zIndex: 0,
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
            },
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <MenuItem 
          onClick={() => handleNavigate('chat')}
          sx={{ 
            py: 1.5,
            borderRadius: 1,
            mx: 1,
            my: 0.5,
            backgroundColor: currentView === 'chat' ? alpha('#38C96A', 0.08) : 'transparent',
            '&:hover': {
              backgroundColor: currentView === 'chat' ? alpha('#38C96A', 0.12) : 'rgba(255,255,255,0.05)',
            }
          }}
        >
          <FontAwesomeIcon 
            icon={faMessage} 
            style={{ 
              marginRight: 12,
              color: currentView === 'chat' ? '#38C96A' : 'inherit'
            }} 
          /> 
          Chat
        </MenuItem>
        <MenuItem 
          onClick={() => handleNavigate('agents')}
          sx={{ 
            py: 1.5,
            borderRadius: 1,
            mx: 1,
            my: 0.5,
            backgroundColor: currentView === 'agents' ? alpha('#38C96A', 0.08) : 'transparent',
            '&:hover': {
              backgroundColor: currentView === 'agents' ? alpha('#38C96A', 0.12) : 'rgba(255,255,255,0.05)',
            }
          }}
        >
          <FontAwesomeIcon 
            icon={faRobot} 
            style={{ 
              marginRight: 12,
              color: currentView === 'agents' ? '#38C96A' : 'inherit'
            }} 
          /> 
          Agents
        </MenuItem>
        <MenuItem 
          onClick={() => handleNavigate('settings')}
          sx={{ 
            py: 1.5,
            borderRadius: 1,
            mx: 1,
            my: 0.5,
            backgroundColor: currentView === 'settings' ? alpha('#38C96A', 0.08) : 'transparent',
            '&:hover': {
              backgroundColor: currentView === 'settings' ? alpha('#38C96A', 0.12) : 'rgba(255,255,255,0.05)',
            }
          }}
        >
          <FontAwesomeIcon 
            icon={faGear} 
            style={{ 
              marginRight: 12,
              color: currentView === 'settings' ? '#38C96A' : 'inherit'
            }} 
          /> 
          Settings
        </MenuItem>
      </Menu>
    </Box>
  );
};
