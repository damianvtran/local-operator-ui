import type { FC, ChangeEvent } from 'react';
import { 
  Box, 
  Typography, 
  TextField, 
  Card,
  CardContent,
  Avatar,
  Stack
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser } from '@fortawesome/free-solid-svg-icons';

type AccountSettingsProps = {
  username: string;
  email: string;
  onInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

export const AccountSettings: FC<AccountSettingsProps> = ({ 
  username, 
  email, 
  onInputChange 
}) => {
  return (
    <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2 }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <FontAwesomeIcon icon={faUser} />
          Account Preferences
        </Typography>
        
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <Avatar 
            sx={{ 
              width: 64, 
              height: 64, 
              bgcolor: 'primary.dark',
              mr: 2
            }}
          >
            <FontAwesomeIcon icon={faUser} size="lg" />
          </Avatar>
          
          <Stack spacing={0.5}>
            <Typography variant="body1" fontWeight={500}>
              {username}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {email}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Local User Account
            </Typography>
          </Stack>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="Username"
            name="username"
            value={username}
            onChange={onInputChange}
            variant="outlined"
            size="small"
            sx={{ flexGrow: 1, minWidth: '200px' }}
          />
          
          <TextField
            label="Email"
            name="email"
            value={email}
            onChange={onInputChange}
            variant="outlined"
            size="small"
            sx={{ flexGrow: 1, minWidth: '200px' }}
          />
        </Box>
      </CardContent>
    </Card>
  );
};
