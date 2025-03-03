import type React from 'react';
import { AppBar, Toolbar, Box } from '@mui/material';
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
 */
export const NavigationBar: React.FC<NavigationProps> = ({ currentView, onNavigate }) => {
  return (
    <AppBar position="static" elevation={0}>
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        {/* Logo and App Name */}
        <AppLogo />

        {/* Navigation Buttons */}
        <NavButtons currentView={currentView} onNavigate={onNavigate} />

        {/* User Profile and Mobile Menu */}
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <UserProfile onNavigate={onNavigate} />
          <MobileMenu onNavigate={onNavigate} />
        </Box>
      </Toolbar>
    </AppBar>
  );
};
