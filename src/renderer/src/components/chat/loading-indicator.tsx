import type { FC } from 'react';
import { Box, Typography, Avatar, CircularProgress } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot } from '@fortawesome/free-solid-svg-icons';
import type { JobStatus } from '@renderer/api/local-operator/types';

/**
 * Loading indicator component that displays the current status of a job
 * 
 * @param status - Optional job status to display
 */
export const LoadingIndicator: FC<{ status?: JobStatus | null }> = ({ status }) => {
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
          {status ? `Local Operator is ${getStatusText(status)}...` : 'Local Operator is thinking...'}
        </Typography>
      </Box>
    </Box>
  );
};

/**
 * Get a user-friendly text representation of a job status
 * 
 * @param status - The job status
 * @returns A user-friendly text representation
 */
const getStatusText = (status: JobStatus): string => {
  switch (status) {
    case 'pending':
      return 'waiting to start';
    case 'processing':
      return 'processing your request';
    case 'completed':
      return 'finishing up';
    case 'failed':
      return 'having trouble';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'thinking';
  }
};
