import type { FC, ChangeEvent } from 'react';
import { 
  Typography, 
  TextField, 
  Button, 
  Card,
  CardContent
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot } from '@fortawesome/free-solid-svg-icons';

type SystemPromptProps = {
  systemPrompt: string;
  onInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onReset: () => void;
}

export const SystemPrompt: FC<SystemPromptProps> = ({ 
  systemPrompt, 
  onInputChange, 
  onReset 
}) => {
  return (
    <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2 }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <FontAwesomeIcon icon={faRobot} />
          System Prompt
        </Typography>
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The system prompt defines how Local Operator behaves and responds to your messages.
        </Typography>
        
        <TextField
          label="System Prompt"
          name="systemPrompt"
          value={systemPrompt}
          onChange={onInputChange}
          variant="outlined"
          multiline
          rows={6}
          fullWidth
          sx={{ mb: 2 }}
        />
        
        <Button 
          variant="outlined" 
          size="small"
          onClick={onReset}
        >
          Reset to Default
        </Button>
      </CardContent>
    </Card>
  );
};
