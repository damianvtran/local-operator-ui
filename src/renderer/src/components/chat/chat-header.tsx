import type { FC } from 'react';
import { Box, Typography, Avatar } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot } from '@fortawesome/free-solid-svg-icons';

type ChatHeaderProps = {
  agentName?: string;
  description?: string;
}

const ChatHeader: FC<ChatHeaderProps> = ({ 
  agentName = 'Local Operator',
  description = 'Your on-device AI assistant'
}) => {
  return (
    <Box sx={{ 
      p: 2, 
      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      display: 'flex',
      alignItems: 'center'
    }}>
      <Avatar 
        sx={{ 
          bgcolor: 'rgba(56, 201, 106, 0.2)',
          color: 'primary.main',
          mr: 2
        }}
      >
        <FontAwesomeIcon icon={faRobot} />
      </Avatar>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 500 }}>
          {agentName}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      </Box>
    </Box>
  );
};

export default ChatHeader;
