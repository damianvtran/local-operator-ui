import React from 'react';
import { Avatar, Box, IconButton, Menu, MenuItem, alpha } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear, faUser, faSignOut, faShield } from '@fortawesome/free-solid-svg-icons';

type UserProfileProps = {
  onNavigate: (view: string) => void;
  useAuth?: boolean;
};

/**
 * UserProfile component displays the user avatar and profile menu
 * Enhanced with modern styling and animations
 * 
 * @param onNavigate - Function to handle navigation between views
 * @param useAuth - Whether to display authentication-related menu items (default: false)
 */
export const UserProfile: React.FC<UserProfileProps> = ({ onNavigate, useAuth = false }) => {
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
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <IconButton
        onClick={handleClick}
        size="small"
        title="Account settings"
        aria-controls={open ? 'account-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
        sx={{
          p: 0.5,
          border: '2px solid transparent',
          transition: 'all 0.2s ease',
          '&:hover': {
            borderColor: alpha('#38C96A', 0.3),
            transform: 'scale(1.05)',
          },
        }}
      >
        <Avatar 
          sx={{ 
            width: 36, 
            height: 36, 
            bgcolor: 'primary.main',
            boxShadow: '0 0 10px rgba(56, 201, 106, 0.3)',
            transition: 'all 0.3s ease',
            '&:hover': {
              boxShadow: '0 0 15px rgba(56, 201, 106, 0.5)',
            }
          }}
        >
          <FontAwesomeIcon icon={faUser} size="sm" />
        </Avatar>
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        id="account-menu"
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
            minWidth: 200,
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
          onClick={() => handleNavigate('settings')}
          sx={{ 
            py: 1.5,
            borderRadius: 1,
            mx: 1,
            my: 0.5,
            transition: 'all 0.2s ease',
            '&:hover': {
              backgroundColor: 'rgba(255,255,255,0.05)',
              transform: 'translateX(5px)',
            }
          }}
        >
          <FontAwesomeIcon 
            icon={faGear} 
            style={{ 
              marginRight: 12,
              width: 16,
              height: 16,
            }} 
          /> 
          Settings
        </MenuItem>
        {useAuth && (
          <>
            <MenuItem 
              onClick={handleClose}
              sx={{ 
                py: 1.5,
                borderRadius: 1,
                mx: 1,
                my: 0.5,
                transition: 'all 0.2s ease',
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  transform: 'translateX(5px)',
                }
              }}
            >
              <FontAwesomeIcon 
                icon={faShield} 
                style={{ 
                  marginRight: 12,
                  width: 16,
                  height: 16,
                }} 
              /> 
              Privacy & Security
            </MenuItem>
            <Box sx={{ borderTop: '1px solid rgba(255,255,255,0.08)', my: 1 }} />
            <MenuItem 
              onClick={handleClose}
              sx={{ 
                py: 1.5,
                borderRadius: 1,
                mx: 1,
                my: 0.5,
                color: alpha('#ff6b6b', 0.9),
                transition: 'all 0.2s ease',
                '&:hover': {
                  backgroundColor: alpha('#ff6b6b', 0.1),
                  transform: 'translateX(5px)',
                }
              }}
            >
              <FontAwesomeIcon 
                icon={faSignOut} 
                style={{ 
                  marginRight: 12,
                  width: 16,
                  height: 16,
                }} 
              /> 
              Sign out
            </MenuItem>
          </>
        )}
      </Menu>
    </Box>
  );
};
