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
  styled,
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

const StyledDialog = styled(Dialog)({
  '& .MuiPaper-root': {
    borderRadius: 16,
    backgroundColor: 'background.paper',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
    maxWidth: '400px',
    width: '100%',
  },
});

const WarningBox = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  marginBottom: 8,
});

const WarningIcon = styled(FontAwesomeIcon)(({ theme }) => ({
  color: theme.palette.error.main,
  marginRight: 8,
  fontSize: '1.2rem',
}));

const ActionButton = styled(Button)(() => ({
  borderRadius: 12,
  textTransform: 'none',
  fontWeight: 500,
}));

const CancelButton = styled(ActionButton)({
  marginRight: 8,
});

const ConfirmButton = styled(ActionButton)({
  marginLeft: 8,
});

const DialogActionsStyled = styled(DialogActions)({
  padding: '0 24px 24px 24px',
});

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
    <StyledDialog
      open={open}
      onClose={onCancel}
      aria-labelledby="confirmation-dialog-title"
      aria-describedby="confirmation-dialog-description"
    >
      <DialogTitle id="confirmation-dialog-title" sx={{ pb: 1 }}>
        {isDangerous ? (
          <WarningBox>
            <WarningIcon icon={faExclamationTriangle} />
            <Typography variant="h6" component="span" color="error">
              {title}
            </Typography>
          </WarningBox>
        ) : (
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
      <DialogActionsStyled>
        <CancelButton
          onClick={onCancel}
          variant="outlined"
          color="inherit"
        >
          {cancelText}
        </CancelButton>
        <ConfirmButton
          onClick={onConfirm}
          variant="contained"
          color={isDangerous ? 'error' : 'primary'}
          autoFocus
        >
          {confirmText}
        </ConfirmButton>
      </DialogActionsStyled>
    </StyledDialog>
  );
};
