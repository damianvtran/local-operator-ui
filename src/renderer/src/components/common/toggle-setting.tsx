/**
 * Toggle Setting Component
 * 
 * A component for toggling boolean settings with a clean, modern UI
 */

import { useState } from 'react';
import type { FC } from 'react';
import { 
  Box, 
  Typography, 
  Switch, 
  alpha, 
  CircularProgress,
  Paper
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

type ToggleSettingProps = {
  /**
   * Current value of the setting
   */
  value: boolean;
  
  /**
   * Label for the setting
   */
  label: string;
  
  /**
   * Description of what the setting does
   */
  description?: string;
  
  /**
   * Callback function when the value is changed
   * @param value - The new value
   */
  onChange: (value: boolean) => Promise<void>;
  
  /**
   * Optional icon to display next to the label
   */
  icon?: IconDefinition;
  
  /**
   * Whether the setting is currently being saved
   */
  isSaving?: boolean;
};

/**
 * Toggle Setting Component
 * 
 * A component for toggling boolean settings with a clean, modern UI
 * 
 * @param props - ToggleSettingProps
 */
export const ToggleSetting: FC<ToggleSettingProps> = ({
  value,
  label,
  description,
  onChange,
  icon,
  isSaving = false,
}) => {
  const [isOn, setIsOn] = useState(value);
  
  /**
   * Handles toggling the switch
   */
  const handleToggle = async () => {
    if (isSaving) return;
    
    const newValue = !isOn;
    setIsOn(newValue);
    
    try {
      await onChange(newValue);
    } catch (error) {
      // If there's an error, revert the UI state
      setIsOn(!newValue);
      console.error('Error toggling setting:', error);
    }
  };
  
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.5,
        borderRadius: 2,
        bgcolor: (theme) => alpha(theme.palette.background.default, 0.7),
        transition: 'all 0.2s ease',
        '&:hover': {
          bgcolor: (theme) => alpha(theme.palette.background.default, 0.9),
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        },
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        mb: 2
      }}
    >
      <Box sx={{ flexGrow: 1 }}>
        <Typography 
          variant="subtitle2" 
          sx={{ 
            mb: 0.5, 
            display: 'flex', 
            alignItems: 'center',
            color: 'text.primary',
            fontWeight: 600
          }}
        >
          {icon && <Box sx={{ mr: 1.5, opacity: 0.8 }}><FontAwesomeIcon icon={icon} /></Box>}
          {label}
        </Typography>
        
        {description && (
          <Typography 
            variant="body2" 
            color="text.secondary"
            sx={{ 
              fontSize: '0.875rem',
              lineHeight: 1.5,
              maxWidth: '90%'
            }}
          >
            {description}
          </Typography>
        )}
      </Box>
      
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        {isSaving ? (
          <CircularProgress size={24} sx={{ mr: 1 }} />
        ) : (
          <Switch
            checked={isOn}
            onChange={handleToggle}
            color="primary"
            sx={{
              '& .MuiSwitch-switchBase.Mui-checked': {
                color: 'primary.main',
              },
              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                backgroundColor: 'primary.main',
              },
            }}
          />
        )}
      </Box>
    </Paper>
  );
};
