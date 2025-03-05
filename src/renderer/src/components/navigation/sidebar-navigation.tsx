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
        <Box 
          key={item.view}
          sx={{ position: 'relative' }}
          className="custom-tooltip"
          data-tooltip={item.label}
        >
          <style jsx>{`
            .custom-tooltip {
              position: relative;
            }
            .custom-tooltip:hover::after {
              content: attr(data-tooltip);
              position: absolute;
              left: 100%;
              top: 50%;
              transform: translateY(-50%);
              margin-left: 10px;
              padding: 5px 10px;
              background-color: rgba(0, 0, 0, 0.8);
              color: white;
              border-radius: 4px;
              font-size: 12px;
              white-space: nowrap;
              z-index: 1000;
            }
            .custom-tooltip:hover::before {
              content: '';
              position: absolute;
              left: 100%;
              top: 50%;
              transform: translateY(-50%);
              border-width: 5px;
              border-style: solid;
              border-color: transparent rgba(0, 0, 0, 0.8) transparent transparent;
              margin-left: 0px;
              z-index: 1000;
            }
          `}</style>
          {navButton}
        </Box>
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
            justifyContent: expanded ? 'space-between' : 'center',
            padding: theme.spacing(2),
            mb: 2
          }}
        >
          <CollapsibleAppLogo expanded={expanded} />
          
          {/* Toggle Button */}
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
              ...(expanded ? {} : { mx: 'auto', mt: 1 }),
            }}
          >
            <FontAwesomeIcon 
              icon={expanded ? faChevronLeft : faChevronRight} 
              size="xs" 
            />
          </IconButton>
        </Box>

        {/* Navigation Items */}
        <List sx={{ px: 1 }}>
          {navItems.map(renderNavItem)}
        </List>
      </Box>

      {/* User Profile at Bottom */}
      <Box sx={{ mt: 'auto', mb: 2 }}>
        <UserProfileSidebar 
          expanded={expanded} 
          onNavigate={onNavigate} 
        />
      </Box>
    </Drawer>
  );
};
