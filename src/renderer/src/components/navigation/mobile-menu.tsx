import React from 'react';
import { Box, IconButton, Menu, MenuItem } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear, faMessage, faEllipsisVertical, faRobot } from '@fortawesome/free-solid-svg-icons';

type MobileMenuProps = {
  onNavigate: (view: string) => void;
};

/**
 * MobileMenu component displays a menu icon and dropdown for mobile navigation
 * Only visible on small screens
 */
export const MobileMenu: React.FC<MobileMenuProps> = ({ onNavigate }) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };
  
  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
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
        <MenuItem onClick={() => { handleClose(); onNavigate('agents'); }}>
          <FontAwesomeIcon icon={faRobot} style={{ marginRight: 8 }} /> Agents
        </MenuItem>
        <MenuItem onClick={() => { handleClose(); onNavigate('settings'); }}>
          <FontAwesomeIcon icon={faGear} style={{ marginRight: 8 }} /> Settings
        </MenuItem>
      </Menu>
    </Box>
  );
};
