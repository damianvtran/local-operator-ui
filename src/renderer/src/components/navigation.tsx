import React from 'react';
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  Button, 
  Avatar, 
  Box, 
  IconButton,
  Menu,
  MenuItem,
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faGear, 
  faUser, 
  faMessage, 
  faEllipsisVertical 
} from '@fortawesome/free-solid-svg-icons';
import localOperatorIcon from '@assets/icon.png'

type NavigationProps = {
  currentView: string;
  onNavigate: (view: string) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ currentView, onNavigate }) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };
  
  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <AppBar position="static" elevation={0}>
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        {/* Logo and App Name */}
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <img 
            src={localOperatorIcon} 
            alt="Local Operator Logo"
            style={{
              height: 32,
              marginRight: 12,
              transition: 'transform 0.3s ease',
            }}
            onMouseOver={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
            onMouseOut={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            onFocus={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
            onBlur={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
          />
          <Typography variant="gradientTitle">
            Local Operator
          </Typography>
        </Box>

        {/* Navigation Buttons */}
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
            startIcon={<FontAwesomeIcon icon={faGear} />}
            onClick={() => onNavigate('settings')}
            sx={{ 
              backgroundColor: currentView === 'settings' ? 'rgba(255,255,255,0.05)' : 'transparent'
            }}
          >
            Settings
          </Button>
        </Box>

        {/* User Profile */}
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton
            onClick={handleClick}
            size="small"
            aria-controls={open ? 'account-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={open ? 'true' : undefined}
          >
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
              <FontAwesomeIcon icon={faUser} size="sm" />
            </Avatar>
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            id="account-menu"
            open={open}
            onClose={handleClose}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          >
            <MenuItem onClick={() => { handleClose(); onNavigate('settings'); }}>
              <FontAwesomeIcon icon={faGear} style={{ marginRight: 8 }} /> Settings
            </MenuItem>
          </Menu>

          {/* Mobile Menu */}
          <Box sx={{ display: { xs: 'flex', md: 'none' } }}>
            <IconButton
              size="large"
              aria-label="menu"
              onClick={handleClick}
            >
              <FontAwesomeIcon icon={faEllipsisVertical} />
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={open}
              onClose={handleClose}
            >
              <MenuItem onClick={() => { handleClose(); onNavigate('chat'); }}>
                <FontAwesomeIcon icon={faMessage} style={{ marginRight: 8 }} /> Chat
              </MenuItem>
              <MenuItem onClick={() => { handleClose(); onNavigate('settings'); }}>
                <FontAwesomeIcon icon={faGear} style={{ marginRight: 8 }} /> Settings
              </MenuItem>
            </Menu>
          </Box>
        </Box>
      </Toolbar>
    </AppBar>
  );
};
