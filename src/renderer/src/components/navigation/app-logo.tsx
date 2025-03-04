import type React from 'react';
import { Box, Typography, keyframes, useTheme } from '@mui/material';
import localOperatorIcon from '@assets/icon.png';

/**
 * Pulse animation for the logo
 */
const pulse = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(56, 201, 106, 0.4);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(56, 201, 106, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(56, 201, 106, 0);
  }
`;

/**
 * AppLogo component displays the application logo and name
 * Enhanced with modern animations and effects
 */
export const AppLogo: React.FC = () => {
  const theme = useTheme();

  return (
    <Box 
      sx={{
        display: 'flex',
        alignItems: 'center',
        cursor: 'pointer',
        padding: theme.spacing(0.5, 1),
        borderRadius: theme.spacing(1.5),
        transition: 'all 0.3s ease',
        '&:hover': {
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
        },
      }}
    >
      <Box
        component="img"
        src={localOperatorIcon}
        alt="Local Operator Logo"
        loading="eager"
        sx={{
          height: 34,
          marginRight: theme.spacing(1.5),
          transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          filter: 'drop-shadow(0 0 8px rgba(56, 201, 106, 0.3))',
          '&:hover': {
            transform: 'scale(1.12) rotate(5deg)',
            filter: 'drop-shadow(0 0 12px rgba(56, 201, 106, 0.5))',
            animation: `${pulse} 1.5s infinite`,
          },
        }}
      />
      <Typography 
        variant="h6"
        sx={{
          fontSize: { xs: '1.2rem', sm: '1.4rem' },
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.9)',
        }}
      >
        Local Operator
      </Typography>
    </Box>
  );
};
