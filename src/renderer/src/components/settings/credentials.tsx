import { useState } from 'react';
import type { FC } from 'react';
import { 
  Typography, 
  TextField, 
  Button, 
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Box,
  styled,
  List,
  ListItem,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  IconButton,
  Tooltip,
  Grid,
  Paper
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faEdit, 
  faPlus, 
  faInfoCircle,
  faLock
} from '@fortawesome/free-solid-svg-icons';
import { useCredentials } from '@renderer/hooks/use-credentials';
import { useUpdateCredential } from '@renderer/hooks/use-update-credential';
import type { CredentialUpdate } from '@renderer/api/local-operator/types';

const StyledCard = styled(Card)(() => ({
  marginBottom: 32,
  backgroundColor: 'background.paper',
  borderRadius: 8,
  boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
}));

const StyledCardContent = styled(CardContent)(({ theme }) => ({
  [theme.breakpoints.down('sm')]: {
    padding: 16,
  },
  [theme.breakpoints.up('sm')]: {
    padding: 24,
  },
}));

const LoadingContainer = styled(Box)(() => ({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: 240,
}));

const StyledListItem = styled(ListItem)(() => ({
  borderRadius: 8,
  marginBottom: 8,
  backgroundColor: 'rgba(0, 0, 0, 0.03)',
  '&:hover': {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
}));

const CredentialName = styled(Typography)(() => ({
  fontWeight: 500,
}));

const AddButtonContainer = styled(Box)(() => ({
  display: 'flex',
  justifyContent: 'center',
  marginTop: 16,
}));

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  marginBottom: theme.spacing(2),
  backgroundColor: 'rgba(0, 0, 0, 0.02)',
}));

/**
 * Credential manifest defining available credentials with descriptions
 */
const CREDENTIAL_MANIFEST = [
  {
    key: 'OPENAI_API_KEY',
    name: 'OpenAI API Key',
    description: 'API key for accessing OpenAI models like GPT-4, GPT-3.5-Turbo, and DALL-E.',
    url: 'https://platform.openai.com/api-keys'
  },
  {
    key: 'OPENROUTER_API_KEY',
    name: 'OpenRouter API Key',
    description: 'API key for OpenRouter, which provides access to various AI models from different providers.',
    url: 'https://openrouter.ai/keys'
  },
  {
    key: 'DEEPSEEK_API_KEY',
    name: 'DeepSeek API Key',
    description: 'API key for DeepSeek AI models, specialized in code generation and understanding.',
    url: 'https://platform.deepseek.com/'
  },
  {
    key: 'MISTRAL_API_KEY',
    name: 'Mistral API Key',
    description: 'API key for Mistral AI models, known for efficient and powerful language processing.',
    url: 'https://console.mistral.ai/api-keys/'
  },
  {
    key: 'SERP_API_KEY',
    name: 'SERP API Key',
    description: 'API key for Search Engine Results Page API, allowing access to search engine data.',
    url: 'https://serpapi.com/dashboard'
  },
  {
    key: 'TAVILY_API_KEY',
    name: 'Tavily API Key',
    description: 'API key for Tavily, a search API designed specifically for AI applications.',
    url: 'https://tavily.com/#api'
  }
];

/**
 * Find credential info from the manifest
 */
const getCredentialInfo = (key: string) => {
  return CREDENTIAL_MANIFEST.find(cred => cred.key === key) || {
    key,
    name: key,
    description: 'Custom credential',
    url: ''
  };
};

/**
 * Dialog for adding or editing a credential
 */
type CredentialDialogProps = {
  open: boolean;
  onClose: () => void;
  onSave: (update: CredentialUpdate) => void;
  initialKey?: string;
  existingKeys: string[];
  isSaving: boolean;
};

const CredentialDialog: FC<CredentialDialogProps> = ({
  open,
  onClose,
  onSave,
  initialKey = '',
  existingKeys,
  isSaving
}) => {
  const [key, setKey] = useState(initialKey);
  const [value, setValue] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [useCustomKey, setUseCustomKey] = useState(false);
  
  // Reset state when dialog opens
  useState(() => {
    if (open) {
      setKey(initialKey);
      setValue('');
      setCustomKey('');
      setUseCustomKey(!CREDENTIAL_MANIFEST.some(cred => cred.key === initialKey) && initialKey !== '');
    }
  });
  
  const handleSave = () => {
    const finalKey = useCustomKey ? customKey : key;
    if (!finalKey) return;
    
    onSave({
      key: finalKey,
      value
    });
  };
  
  const isExistingKey = (k: string) => existingKeys.includes(k) && k !== initialKey;
  const isValidKey = useCustomKey 
    ? customKey.trim() !== '' && !isExistingKey(customKey)
    : key !== '' && !isExistingKey(key);
  
  const selectedCredential = CREDENTIAL_MANIFEST.find(cred => cred.key === key);
  
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {initialKey ? 'Update Credential' : 'Add New Credential'}
      </DialogTitle>
      <DialogContent>
        {!initialKey && (
          <>
            <FormControl fullWidth margin="normal">
              <InputLabel id="credential-key-label">Credential Type</InputLabel>
              <Select
                labelId="credential-key-label"
                value={useCustomKey ? '_custom_' : key}
                label="Credential Type"
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '_custom_') {
                    setUseCustomKey(true);
                  } else {
                    setUseCustomKey(false);
                    setKey(value);
                  }
                }}
              >
                {CREDENTIAL_MANIFEST.map((cred) => (
                  <MenuItem 
                    key={cred.key} 
                    value={cred.key}
                    disabled={isExistingKey(cred.key)}
                  >
                    {cred.name} {isExistingKey(cred.key) && '(already exists)'}
                  </MenuItem>
                ))}
                <MenuItem value="_custom_">Custom Credential</MenuItem>
              </Select>
            </FormControl>
            
            {useCustomKey && (
              <TextField
                margin="normal"
                label="Custom Credential Key"
                fullWidth
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                error={isExistingKey(customKey)}
                helperText={isExistingKey(customKey) ? 'This credential already exists' : ''}
              />
            )}
            
            {selectedCredential && (
              <Box mt={2} mb={2}>
                <Typography variant="body2" color="text.secondary">
                  {selectedCredential.description}
                </Typography>
                {selectedCredential.url && (
                  <Typography variant="body2" mt={1}>
                    <a href={selectedCredential.url} target="_blank" rel="noopener noreferrer">
                      Get your {selectedCredential.name}
                    </a>
                  </Typography>
                )}
              </Box>
            )}
          </>
        )}
        
        <TextField
          margin="normal"
          label="Credential Value"
          fullWidth
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button 
          onClick={handleSave} 
          variant="contained" 
          color="primary"
          disabled={!isValidKey || !value || isSaving}
        >
          {isSaving ? <CircularProgress size={24} /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/**
 * Credentials component
 * Displays and allows management of API credentials
 */
export const Credentials: FC = () => {
  const { data: credentialsData, isLoading, error, refetch } = useCredentials();
  const updateCredentialMutation = useUpdateCredential();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [currentCredential, setCurrentCredential] = useState<string | null>(null);
  
  const handleEditCredential = (key: string) => {
    setCurrentCredential(key);
    setEditDialogOpen(true);
  };
  
  const handleAddCredential = () => {
    setCurrentCredential(null);
    setAddDialogOpen(true);
  };
  
  const handleSaveCredential = async (update: CredentialUpdate) => {
    try {
      await updateCredentialMutation.mutateAsync(update);
      setEditDialogOpen(false);
      setAddDialogOpen(false);
      await refetch();
    } catch (error) {
      console.error('Error saving credential:', error);
    }
  };
  
  // Loading state
  if (isLoading) {
    return (
      <StyledCard>
        <StyledCardContent>
          <LoadingContainer>
            <CircularProgress />
          </LoadingContainer>
        </StyledCardContent>
      </StyledCard>
    );
  }
  
  // Error state
  if (error || !credentialsData) {
    return (
      <StyledCard>
        <StyledCardContent>
          <Alert severity="error">
            Failed to load credentials. Please try again later.
          </Alert>
        </StyledCardContent>
      </StyledCard>
    );
  }
  
  const existingKeys = credentialsData.keys || [];
  const availableCredentials = CREDENTIAL_MANIFEST.filter(
    cred => !existingKeys.includes(cred.key)
  );
  
  return (
    <StyledCard>
      <StyledCardContent>
        
        {/* Current Credentials */}
        {existingKeys.length > 0 ? (
          <List>
            {existingKeys.map((key) => {
              const credInfo = getCredentialInfo(key);
              return (
                <StyledListItem
                  key={key}
                  secondaryAction={
                    <IconButton 
                      edge="end" 
                      aria-label="edit"
                      onClick={() => handleEditCredential(key)}
                    >
                      <FontAwesomeIcon icon={faEdit} />
                    </IconButton>
                  }
                >
                  <ListItemText
                    primary={
                      <Box display="flex" alignItems="center" gap={1}>
                        <FontAwesomeIcon icon={faLock} />
                        <CredentialName>{credInfo.name}</CredentialName>
                        <Tooltip title={credInfo.description}>
                          <IconButton size="small">
                            <FontAwesomeIcon icon={faInfoCircle} size="xs" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    }
                    secondary={`Key: ${key}`}
                  />
                </StyledListItem>
              );
            })}
          </List>
        ) : (
          <Alert severity="info" sx={{ mb: 2 }}>
            No credentials configured yet. Add your first credential to get started.
          </Alert>
        )}
        
        {/* Available Credentials */}
        {availableCredentials.length > 0 && (
          <>
            <Typography variant="h6" sx={{ mt: 4, mb: 2 }}>
              Available Credentials
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              These are common API credentials you can add to enhance functionality.
            </Typography>
            
            <Grid container spacing={2}>
              {availableCredentials.map((cred) => (
                <Grid item xs={12} md={6} key={cred.key}>
                  <StyledPaper>
                    <Typography variant="subtitle1" fontWeight="500">
                      {cred.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                      {cred.description}
                    </Typography>
                    <Button 
                      variant="outlined" 
                      size="small"
                      startIcon={<FontAwesomeIcon icon={faPlus} />}
                      onClick={() => {
                        setCurrentCredential(cred.key);
                        setAddDialogOpen(true);
                      }}
                    >
                      Add Credential
                    </Button>
                  </StyledPaper>
                </Grid>
              ))}
            </Grid>
          </>
        )}
        
        <AddButtonContainer>
          <Button
            variant="contained"
            color="primary"
            startIcon={<FontAwesomeIcon icon={faPlus} />}
            onClick={handleAddCredential}
          >
            Add Custom Credential
          </Button>
        </AddButtonContainer>
        
        {/* Edit Credential Dialog */}
        <CredentialDialog
          open={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          onSave={handleSaveCredential}
          initialKey={currentCredential || ''}
          existingKeys={existingKeys}
          isSaving={updateCredentialMutation.isPending}
        />
        
        {/* Add Credential Dialog */}
        <CredentialDialog
          open={addDialogOpen}
          onClose={() => setAddDialogOpen(false)}
          onSave={handleSaveCredential}
          initialKey={currentCredential || ''}
          existingKeys={existingKeys}
          isSaving={updateCredentialMutation.isPending}
        />
      </StyledCardContent>
    </StyledCard>
  );
};
