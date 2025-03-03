import type React from 'react';
import { Box, Typography } from '@mui/material';
import localOperatorIcon from '@assets/icon.png';

/**
 * AppLogo component displays the application logo and name
 */
export const AppLogo: React.FC = () => {
  return (
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
  );
};
