import type { FC } from 'react';
import { Box, Button } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSave } from '@fortawesome/free-solid-svg-icons';

type SaveButtonProps = {
  isSaved: boolean;
  onSave: () => void;
}

export const SaveButton: FC<SaveButtonProps> = ({ isSaved, onSave }) => {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Button
        variant="contained"
        color="primary"
        startIcon={<FontAwesomeIcon icon={faSave} />}
        onClick={onSave}
        sx={{ px: 3 }}
      >
        {isSaved ? 'Saved!' : 'Save Settings'}
      </Button>
    </Box>
  );
};
