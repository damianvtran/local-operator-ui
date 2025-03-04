import type React from 'react';
import { AppBar, Toolbar, Box, useTheme } from '@mui/material';
import { AppLogo } from './app-logo';
import { NavButtons } from './nav-buttons';
import { UserProfile } from './user-profile';
import { MobileMenu } from './mobile-menu';

type NavigationProps = {
  currentView: string;
  onNavigate: (view: string) => void;
}

/**
 * NavigationBar component serves as the main navigation header for the application
 * It combines smaller components for better maintainability and testing
 * 
 * @param currentView - The current active view/page
 * @param onNavigate - Function to handle navigation between views
 */
export const NavigationBar: React.FC<NavigationProps> = ({ currentView, onNavigate }) => {
  const theme = useTheme();

  return (
    <AppBar 
      position="sticky" 
      elevation={0}
      sx={{
        background: 'rgba(10,10,10,0.75)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 4px 30px rgba(0,0,0,0.1)',
        transition: 'all 0.3s ease-in-out',
      }}
    >
      <Toolbar
        sx={{
          justifyContent: 'space-between',
          padding: theme.spacing(1, 2),
          [theme.breakpoints.up('sm')]: {
            padding: theme.spacing(1, 3),
          },
          [theme.breakpoints.up('md')]: {
            padding: theme.spacing(1, 4),
          },
        }}
      >
        {/* Logo and App Name */}
        <AppLogo />

        {/* Navigation Buttons - Only visible on non-mobile screens */}
        <NavButtons currentView={currentView} onNavigate={onNavigate} />

        {/* User Profile and Mobile Menu */}
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center',
          gap: 1
        }}>
          <UserProfile onNavigate={onNavigate} />
          <MobileMenu currentView={currentView} onNavigate={onNavigate} />
        </Box>
      </Toolbar>
    </AppBar>
  );
};
