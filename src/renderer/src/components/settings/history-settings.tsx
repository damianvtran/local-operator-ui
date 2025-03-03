import type { FC, ChangeEvent } from 'react';
import { 
  Box, 
  Typography, 
  Switch, 
  FormControlLabel,
  Slider,
  Card,
  CardContent
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHistory } from '@fortawesome/free-solid-svg-icons';

interface HistorySettingsProps {
  maxConversationHistory: number;
  maxLearningsHistory: number;
  detailedHistoryMode: boolean;
  onSliderChange: (name: string) => (_: Event, value: number | number[]) => void;
  onSwitchChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

export const HistorySettings: FC<HistorySettingsProps> = ({
  maxConversationHistory,
  maxLearningsHistory,
  detailedHistoryMode,
  onSliderChange,
  onSwitchChange
}) => {
  return (
    <Card sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 2 }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <FontAwesomeIcon icon={faHistory} />
          History Settings
        </Typography>
        
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" gutterBottom>
            Maximum Conversation History
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Slider
              value={maxConversationHistory}
              onChange={onSliderChange('maxConversationHistory')}
              min={10}
              max={200}
              step={10}
              valueLabelDisplay="auto"
              sx={{ flexGrow: 1 }}
            />
            <Typography variant="body2" sx={{ minWidth: '40px', textAlign: 'right' }}>
              {maxConversationHistory}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            Number of messages to keep in conversation history
          </Typography>
        </Box>
        
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" gutterBottom>
            Maximum Learnings History
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Slider
              value={maxLearningsHistory}
              onChange={onSliderChange('maxLearningsHistory')}
              min={10}
              max={500}
              step={10}
              valueLabelDisplay="auto"
              sx={{ flexGrow: 1 }}
            />
            <Typography variant="body2" sx={{ minWidth: '40px', textAlign: 'right' }}>
              {maxLearningsHistory}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            Number of learnings to retain for context
          </Typography>
        </Box>
        
        <FormControlLabel
          control={
            <Switch
              checked={detailedHistoryMode}
              onChange={onSwitchChange}
              name="detailedHistoryMode"
              color="primary"
            />
          }
          label="Detailed Conversation History Mode"
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 2 }}>
          When enabled, Local Operator will retain more detailed context from your conversations
        </Typography>
      </CardContent>
    </Card>
  );
};
