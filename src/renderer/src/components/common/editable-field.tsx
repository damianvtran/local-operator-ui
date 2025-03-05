/**
 * Editable Field Component
 * 
 * A component that allows for inline editing of text fields with explicit save
 */

import { useState, useEffect, useRef } from 'react';
import type React from 'react';
import type { FC, ChangeEvent, FocusEvent, KeyboardEvent } from 'react';
import { 
  TextField, 
  Typography, 
  Box, 
  IconButton,
  CircularProgress,
  alpha,
  Button
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPen, faCheck, faTimes, faEraser } from '@fortawesome/free-solid-svg-icons';

type EditableFieldProps = {
  /**
   * Current value of the field
   */
  value: string;
  
  /**
   * Label for the field
   */
  label: string;
  
  /**
   * Callback function when the value is saved
   * @param value - The new value
   */
  onSave: (value: string) => Promise<void>;
  
  /**
   * Whether the field is multiline
   */
  multiline?: boolean;
  
  /**
   * Number of rows for multiline fields
   */
  rows?: number;
  
  /**
   * Placeholder text when field is empty
   */
  placeholder?: string;
  
  /**
   * Optional icon to display next to the label
   */
  icon?: React.ReactNode;
  
  /**
   * Whether the field is currently being saved
   */
  isSaving?: boolean;
};

/**
 * Editable Field Component
 * 
 * A component that allows for inline editing of text fields with explicit save.
 * 
 * @param props - EditableFieldProps
 */
export const EditableField: FC<EditableFieldProps> = ({
  value,
  label,
  onSave,
  multiline = false,
  rows = 4,
  placeholder = 'Enter value...',
  icon,
  isSaving = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [displayValue, setDisplayValue] = useState(value);
  const [originalValue, setOriginalValue] = useState(value);
  const [isClearing, setIsClearing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const actionButtonsRef = useRef<HTMLDivElement>(null);
  
  // Update the edit value when the value prop changes
  useEffect(() => {
    setEditValue(value);
    setDisplayValue(value);
    setOriginalValue(value);
  }, [value]);
  
  // Focus the input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);
  
  /**
   * Handles entering edit mode.
   */
  const handleEdit = () => {
    setIsEditing(true);
  };
  
  /**
   * Handles changes in the text field.
   * 
   * @param e - The change event.
   */
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
  };
  
  /**
   * Cancels editing and reverts to the original value.
   */
  const handleCancel = () => {
    setEditValue(originalValue);
    setIsEditing(false);
  };
  
  /**
   * Saves the current edit value.
   */
  const handleSave = async () => {
    try {
      await onSave(editValue);
      // Update the display value immediately after successful save
      setDisplayValue(editValue);
      setOriginalValue(editValue);
      setIsEditing(false);
    } catch (error) {
      // If save fails, revert to original value
      setEditValue(originalValue);
    }
  };
  
  /**
   * Handles blur event on the text field.
   * Prevents auto-cancel if focus is moving to one of the action buttons.
   * 
   * @param e - The blur event.
   */
  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    if (
      actionButtonsRef.current &&
      e.relatedTarget &&
      actionButtonsRef.current.contains(e.relatedTarget as Node)
    ) {
      return;
    }
    if (editValue === originalValue) {
      setIsEditing(false);
    }
  };
  
  /**
   * Handles key press events in the text field.
   * Saves the value when Enter is pressed if there are changes.
   * 
   * @param e - The keyboard event.
   */
  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      if (editValue !== originalValue) {
        handleSave();
      }
    } else if (e.key === 'Enter' && e.ctrlKey && multiline) {
      e.preventDefault();
      if (editValue !== originalValue) {
        handleSave();
      }
    }
  };
  
  /**
   * Clears the field by forcing its value to empty and calling onSave.
   * This function bypasses change detection and clears regardless of current value.
   * 
   * @param e - The mouse event.
   */
  const clearField = (e: React.MouseEvent) => {
    // Prevent any event bubbling
    e.preventDefault();
    e.stopPropagation();
    
    console.log("Clear button clicked");
    setIsClearing(true);
    
    // Force the field to be empty first
    setEditValue("");
    
    // Direct API call to clear the field - using a timeout to ensure UI updates first
    setTimeout(() => {
      onSave("")
        .then(() => {
          console.log("Field cleared successfully");
          // Update all state variables
          setDisplayValue("");
          setOriginalValue("");
          setIsEditing(false);
        })
        .catch((error) => {
          console.error("Failed to clear field:", error);
        })
        .finally(() => {
          setIsClearing(false);
        });
    }, 0);
  };
  
  const hasChanged = editValue !== originalValue;
  
  return (
    <Box sx={{ mb: 3 }}>
      <Typography 
        variant="subtitle2" 
        sx={{ 
          mb: 1, 
          display: 'flex', 
          alignItems: 'center',
          color: 'text.secondary',
          fontWeight: 600
        }}
      >
        {icon && <Box sx={{ mr: 1.5, opacity: 0.8 }}>{icon}</Box>}
        {label}
      </Typography>
      
      {isEditing ? (
        <Box sx={{ position: 'relative' }}>
          <TextField
            fullWidth
            variant="outlined"
            value={editValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyPress={handleKeyPress}
            multiline={multiline}
            rows={multiline ? rows : undefined}
            placeholder={placeholder}
            inputRef={inputRef}
            size="small"
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                backgroundColor: (theme) => alpha(theme.palette.background.default, 0.7),
              }
            }}
          />
          <Box 
            ref={actionButtonsRef}
            sx={{ 
              position: 'absolute', 
              top: 8, 
              right: 8, 
              display: 'flex',
              gap: 0.5,
              zIndex: 10
            }}
          >
            {isSaving || isClearing ? (
              <CircularProgress size={20} />
            ) : (
              <>
                {hasChanged ? (
                  <>
                    <IconButton 
                      size="small" 
                      onClick={handleSave}
                      sx={{ 
                        color: 'success.main',
                        p: 0.5
                      }}
                      title="Save changes"
                    >
                      <FontAwesomeIcon icon={faCheck} size="xs" />
                    </IconButton>
                    <IconButton 
                      size="small" 
                      onClick={handleCancel}
                      sx={{ 
                        color: 'error.main',
                        p: 0.5
                      }}
                      title="Cancel"
                    >
                      <FontAwesomeIcon icon={faTimes} size="xs" />
                    </IconButton>
                  </>
                ) : (
                  <IconButton 
                    size="small" 
                    onClick={handleCancel}
                    sx={{ 
                      color: 'error.main',
                      p: 0.5
                    }}
                    title="Cancel"
                  >
                    <FontAwesomeIcon icon={faTimes} size="xs" />
                  </IconButton>
                )}
                
                <Button
                  variant="contained"
                  size="small"
                  onClick={clearField}
                  sx={{
                    backgroundColor: 'warning.main',
                    color: 'white',
                    minWidth: 'auto',
                    p: '2px 8px',
                    '&:hover': {
                      backgroundColor: 'warning.dark',
                    },
                    zIndex: 20 // Ensure it's above everything else
                  }}
                  title="Clear field"
                  startIcon={<FontAwesomeIcon icon={faEraser} size="xs" />}
                >
                  Clear
                </Button>
              </>
            )}
          </Box>
        </Box>
      ) : (
        <Box 
          onClick={handleEdit}
          sx={{ 
            p: 2,
            borderRadius: 2,
            backgroundColor: (theme) => alpha(theme.palette.background.default, 0.7),
            position: 'relative',
            minHeight: multiline ? '100px' : '40px',
            display: 'flex',
            alignItems: multiline ? 'flex-start' : 'center',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
            '&:hover': {
              backgroundColor: (theme) => alpha(theme.palette.background.default, 0.9),
              '& .edit-button': {
                opacity: 1,
              }
            }
          }}
        >
          {displayValue ? (
            <Typography 
              variant="body2" 
              component={multiline ? 'pre' : 'p'}
              sx={{ 
                whiteSpace: multiline ? 'pre-wrap' : 'normal',
                fontFamily: multiline ? '"Roboto Mono", monospace' : 'inherit',
                fontSize: '0.875rem',
                lineHeight: 1.6,
                wordBreak: 'break-word',
                pr: 4
              }}
            >
              {displayValue}
            </Typography>
          ) : (
            <Typography 
              variant="body2" 
              sx={{ 
                color: 'text.disabled',
                fontStyle: 'italic'
              }}
            >
              {placeholder}
            </Typography>
          )}
          
          <IconButton 
            className="edit-button"
            size="small" 
            onClick={handleEdit}
            sx={{ 
              position: 'absolute',
              top: 8,
              right: 8,
              color: 'primary.main',
              opacity: 0,
              transition: 'opacity 0.2s ease',
              p: 0.5
            }}
            title="Edit"
          >
            <FontAwesomeIcon icon={faPen} size="xs" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
};
