import type { FC } from 'react';
import { Box, Typography, Avatar, CircularProgress } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot } from '@fortawesome/free-solid-svg-icons';

const LoadingIndicator: FC = () => {
  return (
    <Box 
      sx={{ 
        display: 'flex',
        alignItems: 'center',
        gap: 2
      }}
    >
      <Avatar 
        sx={{ 
          bgcolor: 'rgba(56, 201, 106, 0.2)',
          color: 'primary.main'
        }}
      >
        <FontAwesomeIcon icon={faRobot} size="sm" />
      </Avatar>
      
      <Box 
        sx={{ 
          bgcolor: 'background.paper',
          p: 2,
          borderRadius: 2,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: 1
        }}
      >
        <CircularProgress size={16} color="primary" />
        <Typography variant="body2">
          Local Operator is thinking...
        </Typography>
      </Box>
    </Box>
  );
};

export default LoadingIndicator;
