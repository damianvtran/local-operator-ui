/**
 * Slider Setting Component
 * 
 * A component for adjusting numeric settings with a slider and direct input
 */

import { useState, useEffect } from 'react';
import type { FC, ChangeEvent, KeyboardEvent, SyntheticEvent } from 'react';
import { 
  Box, 
  Typography, 
  Slider, 
  TextField,
  alpha, 
  CircularProgress,
  Paper,
  InputAdornment
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

type SliderSettingProps = {
  /**
   * Current value of the setting
   */
  value: number;
  
  /**
   * Label for the setting
   */
  label: string;
  
  /**
   * Description of what the setting does
   */
  description?: string;
  
  /**
   * Minimum value for the slider
   */
  min: number;
  
  /**
   * Maximum value for the slider
   */
  max: number;
  
  /**
   * Step size for the slider
   */
  step?: number;
  
  /**
   * Unit label to display after the value (optional)
   */
  unit?: string;
  
  /**
   * Callback function when the value is changed
   * @param value - The new value
   */
  onChange: (value: number) => Promise<void>;
  
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
 * Slider Setting Component
 * 
 * A component for adjusting numeric settings with a slider and direct input
 * 
 * @param props - SliderSettingProps
 */
export const SliderSetting: FC<SliderSettingProps> = ({
  value,
  label,
  description,
  min,
  max,
  step = 1,
  unit,
  onChange,
  icon,
  isSaving = false,
}) => {
  const [sliderValue, setSliderValue] = useState<number>(value);
  const [inputValue, setInputValue] = useState<string>(value.toString());
  const [_isEditing, setIsEditing] = useState(false);
  
  // Update local state when prop value changes
  useEffect(() => {
    setSliderValue(value);
    setInputValue(value.toString());
  }, [value]);
  
  /**
   * Handles slider change events
   */
  const handleSliderChange = (_: Event, newValue: number | number[]) => {
    const numValue = newValue as number;
    setSliderValue(numValue);
    setInputValue(numValue.toString());
  };
  
  /**
   * Handles slider change completion
   */
  const handleSliderChangeCommitted = (
    _: Event | SyntheticEvent<Element, Event>,
    newValue: number | number[]
  ) => {
    if (isSaving) return;
    
    const numValue = newValue as number;
    try {
      void onChange(numValue);
    } catch (error) {
      // If there's an error, revert the UI state
      setSliderValue(value);
      setInputValue(value.toString());
      console.error('Error updating setting:', error);
    }
  };
  
  /**
   * Handles direct input changes
   */
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };
  
  /**
   * Handles input blur - commits the change
   */
  const handleInputBlur = async () => {
    setIsEditing(false);
    
    if (isSaving) return;
    
    const numValue = Number.parseInt(inputValue, 10);
    
    if (Number.isNaN(numValue)) {
      // Reset to current value if invalid
      setInputValue(value.toString());
      setSliderValue(value);
      return;
    }
    
    // Clamp value to min/max range
    const clampedValue = Math.max(min, Math.min(max, numValue));
    setSliderValue(clampedValue);
    setInputValue(clampedValue.toString());
    
    if (clampedValue !== value) {
      try {
        await onChange(clampedValue);
      } catch (error) {
        // If there's an error, revert the UI state
        setSliderValue(value);
        setInputValue(value.toString());
        console.error('Error updating setting:', error);
      }
    }
  };
  
  /**
   * Handles input focus
   */
  const handleInputFocus = () => {
    setIsEditing(true);
  };
  
  /**
   * Handles key press in the input field
   */
  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
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
        mb: 2
      }}
    >
      <Box sx={{ mb: 1 }}>
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
              mb: 2
            }}
          >
            {description}
          </Typography>
        )}
      </Box>
      
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Slider
            value={sliderValue}
            min={min}
            max={max}
            step={step}
            onChange={handleSliderChange}
            onChangeCommitted={handleSliderChangeCommitted}
            disabled={isSaving}
            sx={{
              '& .MuiSlider-thumb': {
                width: 14,
                height: 14,
                transition: '0.2s cubic-bezier(.47,1.64,.41,.8)',
                '&:before': {
                  boxShadow: '0 2px 12px 0 rgba(0,0,0,0.4)',
                },
                '&:hover, &.Mui-focusVisible': {
                  boxShadow: '0px 0px 0px 8px rgb(255 255 255 / 16%)',
                },
                '&.Mui-active': {
                  width: 20,
                  height: 20,
                },
              },
              '& .MuiSlider-rail': {
                opacity: 0.28,
              },
            }}
          />
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: unit ? '130px' : '100px' }}>
          {isSaving ? (
            <CircularProgress size={24} sx={{ mr: 1 }} />
          ) : (
            <TextField
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              onFocus={handleInputFocus}
              onKeyPress={handleKeyPress}
              variant="outlined"
              size="small"
              type="number"
              inputProps={{
                min,
                max,
                step,
                style: { 
                  textAlign: 'right',
                  paddingRight: unit ? '8px' : '0'
                }
              }}
              InputProps={{
                endAdornment: unit ? (
                  <InputAdornment position="end">
                    <Typography variant="caption" sx={{ fontSize: '0.9rem', ml: -0.5, mr: 1.5 }}>
                      {unit}
                    </Typography>
                  </InputAdornment>
                ) : undefined,
                sx: {
                  pr: unit ? 0.5 : 1
                }
              }}
              sx={{
                width: unit ? '130px' : '100px',
                '& .MuiOutlinedInput-root': {
                  borderRadius: 1.5,
                },
                '& .MuiInputAdornment-root': {
                  marginLeft: 0
                }
              }}
            />
          )}
        </Box>
      </Box>
      
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Typography variant="caption" color="text.secondary">{min}</Typography>
        <Typography variant="caption" color="text.secondary">{max}</Typography>
      </Box>
    </Paper>
  );
};
