import { useState } from 'react';
import { useUserStore } from '@renderer/store/user-store';
import type React from 'react';
import type { FC } from 'react';
import { 
  Avatar, 
  Box, 
  Divider, 
  Menu, 
  MenuItem, 
  Tooltip, 
  Typography, 
  alpha 
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faGear, 
  faUser, 
  faSignOut, 
  faShield 
} from '@fortawesome/free-solid-svg-icons';

type UserProfileSidebarProps = {
  expanded: boolean;
  onNavigate: (view: string) => void;
  useAuth?: boolean;
};

/**
 * UserProfileSidebar component displays user information at the bottom of the sidebar
 * Shows only the avatar when collapsed, and user details when expanded
 * 
 * @param expanded - Whether the sidebar is expanded or collapsed
 * @param onNavigate - Function to handle navigation between views
 * @param useAuth - Whether to display authentication-related menu items (default: false)
 */
export const UserProfileSidebar: FC<UserProfileSidebarProps> = ({ 
  expanded, 
  onNavigate, 
  useAuth = false 
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  
  // Get user profile from the store
  const { profile } = useUserStore();
  const userName = profile.name;
  const userEmail = profile.email;
  
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };
  
  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleNavigate = (view: string) => {
    handleClose();
    onNavigate(view);
  };

  // Avatar component that will be wrapped in a tooltip if sidebar is collapsed
  const avatarComponent = (
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
  );

  return (
    <Box>
      <Divider sx={{ 
        my: 1, 
        borderColor: 'rgba(255,255,255,0.08)',
        mx: expanded ? 2 : 1
      }} />
      
      <Box 
        sx={{ 
          display: 'flex', 
          alignItems: 'center',
          px: 2,
          py: 1,
          cursor: 'pointer',
          borderRadius: 2,
          mx: expanded ? 1 : 'auto',
          transition: 'all 0.2s ease',
          '&:hover': {
            backgroundColor: 'rgba(255,255,255,0.05)',
          }
        }}
        onClick={handleClick}
      >
        {!expanded ? (
          // @ts-ignore - MUI Tooltip requires children but we're providing it
          <Tooltip
            title="Account Settings"
            placement="right"
            arrow
            sx={{
              '& .MuiTooltip-tooltip': {
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                color: 'white',
                fontSize: 12,
                borderRadius: 1,
                padding: '5px 10px',
              },
              '& .MuiTooltip-arrow': {
                color: 'rgba(0, 0, 0, 0.8)',
              },
            }}
          >
            <Box>{avatarComponent}</Box>
          </Tooltip>
        ) : (
          avatarComponent
        )}
        
        {expanded && userName && (
          <Box sx={{ ml: 1.5, overflow: 'hidden' }}>
            <Typography 
              variant="subtitle2" 
              sx={{ 
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {userName}
            </Typography>
            {userEmail && (
              <Typography 
                variant="caption" 
                sx={{ 
                  color: 'text.secondary',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'block'
                }}
              >
                {userEmail}
              </Typography>
            )}
          </Box>
        )}
      </Box>
      
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
