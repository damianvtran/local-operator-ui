import React, { useState } from 'react';
import type { FC } from 'react';
import { 
  Box, 
  Drawer, 
  IconButton, 
  List, 
  ListItemButton, 
  ListItemIcon, 
  ListItemText, 
  Tooltip, 
  alpha, 
  useTheme 
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faChevronLeft, 
  faChevronRight, 
  faCode, 
  faGear, 
  faRobot 
} from '@fortawesome/free-solid-svg-icons';
import { CollapsibleAppLogo } from '@components/navigation/collapsible-app-logo';
import { UserProfileSidebar } from '@components/navigation/user-profile-sidebar';

type SidebarNavigationProps = {
  currentView: string;
  onNavigate: (view: string) => void;
};

/**
 * SidebarNavigation component that provides a collapsible sidebar for application navigation
 * 
 * @param currentView - The current active view/page
 * @param onNavigate - Function to handle navigation between views
 */
export const SidebarNavigation: FC<SidebarNavigationProps> = ({ 
  currentView, 
  onNavigate 
}) => {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(true);

  const toggleSidebar = () => {
    setExpanded(!expanded);
  };

  // Navigation items configuration
  const navItems = [
    { 
      icon: faCode, 
      label: 'Chat', 
      view: 'chat', 
      isActive: currentView === 'chat' 
    },
    { 
      icon: faRobot, 
      label: 'Agents', 
      view: 'agents', 
      isActive: currentView === 'agents' 
    },
    { 
      icon: faGear, 
      label: 'Settings', 
      view: 'settings', 
      isActive: currentView === 'settings' 
    }
  ];

  const drawerWidth = expanded ? 240 : 72;

  // Render a navigation item with or without tooltip based on sidebar state
  const renderNavItem = (item: typeof navItems[0]) => {
    const navButton = (
      <ListItemButton
        onClick={() => onNavigate(item.view)}
        sx={{
          borderRadius: 2,
          mb: 0.5,
          py: 1.2,
          minHeight: 48,
          justifyContent: expanded ? 'initial' : 'center',
          color: item.isActive ? 'primary.main' : 'text.primary',
          backgroundColor: item.isActive ? alpha('#38C96A', 0.08) : 'transparent',
          transition: 'all 0.3s ease',
          '&:hover': {
            backgroundColor: item.isActive ? alpha('#38C96A', 0.12) : 'rgba(255,255,255,0.05)',
            transform: 'translateX(5px)',
          },
          ...(item.isActive && {
            '&::before': {
              content: '""',
              position: 'absolute',
              left: -4,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 4,
              height: '60%',
              backgroundColor: 'primary.main',
              borderRadius: '0 4px 4px 0',
            }
          })
        }}
      >
        <ListItemIcon
          sx={{
            minWidth: expanded ? 36 : 0,
            width: 24,
            mr: expanded ? 2 : 'auto',
            justifyContent: 'center',
            color: item.isActive ? 'primary.main' : 'inherit',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <FontAwesomeIcon icon={item.icon} fixedWidth />
        </ListItemIcon>
        {expanded && (
          <ListItemText 
            primary={item.label} 
            primaryTypographyProps={{
              fontWeight: item.isActive ? 500 : 400,
            }}
          />
        )}
      </ListItemButton>
    );

    // If sidebar is collapsed, use custom tooltip
    if (!expanded) {
      return (
        // @ts-ignore - MUI Tooltip requires children but we're providing it
        <Tooltip
          key={item.view}
          title={item.label}
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
          <Box sx={{ position: 'relative' }}>
            {navButton}
          </Box>
        </Tooltip>
      );
    }

    // Otherwise return just the button
    return <Box key={item.view}>{navButton}</Box>;
  };

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          background: 'rgba(10,10,10,0.85)',
          backdropFilter: 'blur(12px)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 4px 30px rgba(0,0,0,0.1)',
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        },
      }}
    >
      <Box>
        {/* App Logo */}
        <Box 
          sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            padding: theme.spacing(2),
            mb: 2
          }}
        >
          <CollapsibleAppLogo expanded={expanded} />
        </Box>

        {/* Navigation Items */}
        <List sx={{ px: 1 }}>
          {navItems.map(renderNavItem)}
        </List>
      </Box>

      {/* User Profile and Toggle Button at Bottom */}
      <Box>
        {/* User Profile */}
        <UserProfileSidebar 
          expanded={expanded} 
          onNavigate={onNavigate} 
        />
        
        {/* Toggle Button - Now positioned below user profile */}
        <Box 
          sx={{ 
            display: 'flex', 
            justifyContent: 'center',
            mt: 1,
            mb: 2
          }}
        >
          <IconButton 
            onClick={toggleSidebar}
            size="small"
            sx={{
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              width: 28,
              height: 28,
              transition: 'all 0.2s ease',
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.1)',
                transform: 'scale(1.05)',
              },
            }}
            title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          >
            <FontAwesomeIcon 
              icon={expanded ? faChevronLeft : faChevronRight} 
              size="xs" 
            />
          </IconButton>
        </Box>
      </Box>
    </Drawer>
  );
};
