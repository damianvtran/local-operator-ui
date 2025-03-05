import type { FC, ReactNode } from 'react';
import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Typography,
  Box,
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';

type ConfirmationModalProps = {
  /**
   * Whether the modal is open
   */
  open: boolean;
  /**
   * Title of the confirmation modal
   */
  title: string;
  /**
   * Message to display in the confirmation modal
   */
  message: ReactNode;
  /**
   * Text for the confirm button
   */
  confirmText?: string;
  /**
   * Text for the cancel button
   */
  cancelText?: string;
  /**
   * Whether the action is dangerous (will style the confirm button as error)
   */
  isDangerous?: boolean;
  /**
   * Callback when the confirm button is clicked
   */
  onConfirm: () => void;
  /**
   * Callback when the cancel button is clicked or the modal is closed
   */
  onCancel: () => void;
};

/**
 * A reusable confirmation modal component
 * 
 * Used for confirming potentially destructive actions like deleting items
 */
export const ConfirmationModal: FC<ConfirmationModalProps> = ({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDangerous = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby="confirmation-dialog-title"
      aria-describedby="confirmation-dialog-description"
      PaperProps={{
        sx: {
          borderRadius: 2,
          bgcolor: 'background.paper',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          maxWidth: '400px',
          width: '100%',
        },
      }}
    >
      <DialogTitle id="confirmation-dialog-title" sx={{ pb: 1 }}>
        {isDangerous && (
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <FontAwesomeIcon
              icon={faExclamationTriangle}
              style={{
                color: 'error.main',
                marginRight: '8px',
                fontSize: '1.2rem',
              }}
            />
            <Typography variant="h6" component="span" color="error">
              {title}
            </Typography>
          </Box>
        )}
        {!isDangerous && (
          <Typography variant="h6" component="span">
            {title}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="confirmation-dialog-description">
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button
          onClick={onCancel}
          variant="outlined"
          color="inherit"
          sx={{
            borderRadius: 1.5,
            textTransform: 'none',
            fontWeight: 500,
          }}
        >
          {cancelText}
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color={isDangerous ? 'error' : 'primary'}
          autoFocus
          sx={{
            borderRadius: 1.5,
            textTransform: 'none',
            fontWeight: 500,
            ml: 1,
          }}
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
