import { useState, useRef, useEffect } from 'react';
import type { FC, RefObject } from 'react';
import { 
  Paper, 
  Box, 
  Typography, 
  Card, 
  CardContent, 
  CircularProgress,
  Alert,
  Grid,
  Container
} from '@mui/material';
import { SettingsSidebar, DEFAULT_SETTINGS_SECTIONS } from './settings-sidebar';
import { SystemPrompt } from './system-prompt';
import { Credentials } from './credentials';
import { styled } from '@mui/material/styles';
import { 
  faGear, 
  faServer, 
  faRobot, 
  faHistory, 
  faDatabase,
  faCloudUploadAlt,
  faInfoCircle,
  faSave,
  faListAlt,
  faUser,
  faEnvelope,
  faKey
} from '@fortawesome/free-solid-svg-icons';
import { useUserStore } from '@renderer/store/user-store';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { PageHeader } from '../common/page-header';
import { EditableField } from '../common/editable-field';
import { SliderSetting } from '../common/slider-setting';
import { ToggleSetting } from '../common/toggle-setting';
import { useConfig } from '@renderer/hooks/use-config';
import { useUpdateConfig } from '@renderer/hooks/use-update-config';
import type { ConfigUpdate } from '@renderer/api/local-operator/types';

const StyledPaper = styled(Paper)(({ theme }) => ({
  height: '100%',
  width: '100%',
  overflow: 'auto',
  [theme.breakpoints.down('sm')]: {
    padding: 16,
  },
  [theme.breakpoints.up('sm')]: {
    padding: 24,
  },
  [theme.breakpoints.up('md')]: {
    padding: 32,
  },
  '&::-webkit-scrollbar': {
    width: '8px',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '4px',
  },
}));

const LoadingContainer = styled(Box)(() => ({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100%',
}));

const ErrorContainer = styled(Box)(() => ({
  padding: 24,
}));

const StyledContainer = styled(Container)(() => ({
  marginTop: 16,
}));

const StyledCard = styled(Card)(() => ({
  marginBottom: 32,
  backgroundColor: 'background.paper',
  borderRadius: 8,
  boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
}));

const CardTitle = styled(Typography)(() => ({
  marginBottom: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}));

const CardDescription = styled(Typography)(() => ({
  marginBottom: 24,
  color: 'text.secondary',
}));

const FieldsContainer = styled(Box)(() => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}));

const InfoBox = styled(Box)(() => ({
  padding: 16,
  borderRadius: 8,
  backgroundColor: 'background.default',
  height: '100%',
}));

const InfoLabel = styled(Typography)(() => ({
  color: 'text.secondary',
  marginBottom: 8,
}));

const InfoValue = styled(Typography)(() => ({
  fontWeight: 500,
}));

const StyledCardContent = styled(CardContent)(({ theme }) => ({
  [theme.breakpoints.down('sm')]: {
    padding: 16,
  },
  [theme.breakpoints.up('sm')]: {
    padding: 24,
  },
}));

export const SettingsPage: FC = () => {
  const { data: config, isLoading, error, refetch } = useConfig();
  const updateConfigMutation = useUpdateConfig();
  const [savingField, setSavingField] = useState<string | null>(null);
  const userStore = useUserStore();
  const [activeSection, setActiveSection] = useState<string>('general');
  
  // Refs for scrolling to sections
  const generalSectionRef = useRef<HTMLDivElement>(null);
  const credentialsSectionRef = useRef<HTMLDivElement>(null);
  
  // Map of section IDs to their refs - memoized to avoid recreation on each render
  const sectionRefs = useRef<Record<string, RefObject<HTMLDivElement>>>({
    general: generalSectionRef,
    credentials: credentialsSectionRef
  }).current;
  
  // Handle section selection
  const handleSelectSection = (sectionId: string) => {
    setActiveSection(sectionId);
    const ref = sectionRefs[sectionId];
    ref?.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  // Update active section based on scroll position
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 100; // Add offset for header
      
      // Find the section that is currently in view
      for (const [sectionId, ref] of Object.entries(sectionRefs)) {
        if (ref.current) {
          const { offsetTop, offsetHeight } = ref.current;
          if (scrollPosition >= offsetTop && scrollPosition < offsetTop + offsetHeight) {
            setActiveSection(sectionId);
            break;
          }
        }
      }
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [sectionRefs]);
  
  // Handle updating a specific field
  const handleUpdateField = async (field: keyof ConfigUpdate, value: string | number | boolean) => {
    setSavingField(field);
    try {
      const update: ConfigUpdate = {
        [field]: value
      };
      
      await updateConfigMutation.mutateAsync(update);
      // Explicitly refetch to update the UI
      await refetch();
    } catch (error) {
      // Error is already handled in the mutation
      console.error(`Error updating ${field}:`, error);
    } finally {
      setSavingField(null);
    }
  };

  if (isLoading) {
    return (
      <LoadingContainer>
        <CircularProgress />
      </LoadingContainer>
    );
  }

  if (error || !config) {
    return (
      <ErrorContainer>
        <Alert severity="error">
          Failed to load configuration. Please try again later.
        </Alert>
      </ErrorContainer>
    );
  }

  return (
    <StyledPaper elevation={0}>
      <PageHeader
        title="Settings"
        icon={faGear}
        subtitle="Configure your application preferences and settings"
      />
      
      <StyledContainer maxWidth="lg" disableGutters>
        <Grid container spacing={4}>
          {/* Settings Sidebar */}
          <Grid item xs={12} md={3}>
            <SettingsSidebar
              activeSection={activeSection}
              onSelectSection={handleSelectSection}
              sections={DEFAULT_SETTINGS_SECTIONS}
            />
          </Grid>
          
          {/* Settings Content */}
          <Grid item xs={12} md={9}>
            {/* General Settings Section */}
            <Box ref={generalSectionRef}>
              <Grid container spacing={4}>
                {/* Left Column */}
                <Grid item xs={12} md={6}>
                  {/* User Profile Settings */}
                  <StyledCard>
                    <StyledCardContent>
                      <CardTitle variant="h6">
                        <FontAwesomeIcon icon={faUser} />
                        User Profile
                      </CardTitle>
                      
                      <CardDescription variant="body2">
                        Update your user profile information displayed in the application.
                      </CardDescription>
                      
                      <FieldsContainer>
                        <EditableField
                          value={userStore.profile.name}
                          label="Display Name"
                          placeholder="Enter your name..."
                          icon={<FontAwesomeIcon icon={faUser} />}
                          isSaving={savingField === 'user_name'}
                          onSave={async (value) => {
                            setSavingField('user_name');
                            try {
                              userStore.updateName(value);
                            } finally {
                              setSavingField(null);
                            }
                          }}
                        />
                        
                        <EditableField
                          value={userStore.profile.email}
                          label="Email Address"
                          placeholder="Enter your email..."
                          icon={<FontAwesomeIcon icon={faEnvelope} />}
                          isSaving={savingField === 'user_email'}
                          onSave={async (value) => {
                            setSavingField('user_email');
                            try {
                              userStore.updateEmail(value);
                            } finally {
                              setSavingField(null);
                            }
                          }}
                        />
                      </FieldsContainer>
                    </StyledCardContent>
                  </StyledCard>
                  {/* Model Settings */}
                  <StyledCard>
                    <StyledCardContent>
                      <CardTitle variant="h6">
                        <FontAwesomeIcon icon={faRobot} />
                        Model Settings
                      </CardTitle>
                      
                      <CardDescription variant="body2">
                        Configure the AI model and hosting provider used for generating responses.
                      </CardDescription>
                      
                      <FieldsContainer>
                        <EditableField
                          value={config.values.hosting}
                          label="Hosting Provider"
                          placeholder="Enter hosting provider..."
                          icon={<FontAwesomeIcon icon={faServer} />}
                          isSaving={savingField === 'hosting'}
                          onSave={async (value) => {
                            await handleUpdateField('hosting', value);
                          }}
                        />
                        
                        <EditableField
                          value={config.values.model_name}
                          label="Model Name"
                          placeholder="Enter model name..."
                          icon={<FontAwesomeIcon icon={faRobot} />}
                          isSaving={savingField === 'model_name'}
                          onSave={async (value) => {
                            await handleUpdateField('model_name', value);
                          }}
                        />
                      </FieldsContainer>
                    </StyledCardContent>
                  </StyledCard>
                  
                  {/* System Prompt Settings */}
                  <SystemPrompt />
                  
                  {/* Auto-Save Settings */}
                  <StyledCard>
                    <StyledCardContent>
                      <CardTitle variant="h6">
                        <FontAwesomeIcon icon={faSave} />
                        Auto-Save Settings
                      </CardTitle>
                      
                      <CardDescription variant="body2">
                        Control whether conversations are automatically saved for future reference.
                      </CardDescription>
                      
                      <ToggleSetting
                        value={config.values.auto_save_conversation}
                        label="Auto-Save Conversations"
                        description="When enabled, all conversations will be automatically saved to your history"
                        icon={faCloudUploadAlt}
                        isSaving={savingField === 'auto_save_conversation'}
                        onChange={async (value) => {
                          await handleUpdateField('auto_save_conversation', value);
                        }}
                      />
                    </StyledCardContent>
                  </StyledCard>
                </Grid>
                
                {/* Right Column */}
                <Grid item xs={12} md={6}>
                  {/* History Settings */}
                  <StyledCard>
                    <StyledCardContent>
                      <CardTitle variant="h6">
                        <FontAwesomeIcon icon={faHistory} />
                        History Settings
                      </CardTitle>
                      
                      <CardDescription variant="body2">
                        Configure how much conversation history is retained and displayed.
                      </CardDescription>
                      
                      <SliderSetting
                        value={config.values.conversation_length}
                        label="Maximum Conversation History"
                        description="Number of messages to keep in conversation history for context.  More messages will make the agents have longer memory but more expensive to run."
                        min={10}
                        max={200}
                        step={10}
                        unit="msgs"
                        icon={faHistory}
                        isSaving={savingField === 'conversation_length'}
                        onChange={async (value) => {
                          await handleUpdateField('conversation_length', value);
                        }}
                      />
                      
                      <SliderSetting
                        value={config.values.detail_length}
                        label="Detail View Length"
                        description="Maximum number of messages to show in the detailed conversation view.  Messages beyond this limit will be summarized.  Shortening this will decrease costs but some important details could get lost from earlier messages."
                        min={10}
                        max={100}
                        step={5}
                        unit="msgs"
                        icon={faListAlt}
                        isSaving={savingField === 'detail_length'}
                        onChange={async (value) => {
                          await handleUpdateField('detail_length', value);
                        }}
                      />
                      
                      <SliderSetting
                        value={config.values.max_learnings_history}
                        label="Maximum Learnings History"
                        description="Number of learning items to retain for context and personalization.  More items will make the agents acquire a longer history of knowledge from your conversations but more expensive to run."
                        min={10}
                        max={100}
                        step={10}
                        unit="items"
                        icon={faDatabase}
                        isSaving={savingField === 'max_learnings_history'}
                        onChange={async (value) => {
                          await handleUpdateField('max_learnings_history', value);
                        }}
                      />
                    </StyledCardContent>
                  </StyledCard>
                  
                  {/* Configuration Metadata */}
                  <StyledCard>
                    <StyledCardContent>
                      <CardTitle variant="h6">
                        <FontAwesomeIcon icon={faInfoCircle} />
                        Configuration Information
                      </CardTitle>
                      
                      <CardDescription variant="body2">
                        System information about the current configuration.
                      </CardDescription>
                      
                      <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                          <InfoBox>
                            <InfoLabel variant="subtitle2">Version</InfoLabel>
                            <InfoValue variant="body1">{config.version}</InfoValue>
                          </InfoBox>
                        </Grid>
                        
                        <Grid item xs={12} sm={6}>
                          <InfoBox>
                            <InfoLabel variant="subtitle2">Created At</InfoLabel>
                            <InfoValue variant="body1">{new Date(config.metadata.created_at).toLocaleString()}</InfoValue>
                          </InfoBox>
                        </Grid>
                        
                        <Grid item xs={12} sm={6}>
                          <InfoBox>
                            <InfoLabel variant="subtitle2">Last Modified</InfoLabel>
                            <InfoValue variant="body1">{new Date(config.metadata.last_modified).toLocaleString()}</InfoValue>
                          </InfoBox>
                        </Grid>
                        
                        <Grid item xs={12} sm={6}>
                          <InfoBox>
                            <InfoLabel variant="subtitle2">Description</InfoLabel>
                            <InfoValue variant="body1">{config.metadata.description || "No description available"}</InfoValue>
                          </InfoBox>
                        </Grid>
                      </Grid>
                    </StyledCardContent>
                  </StyledCard>
                </Grid>
              </Grid>
            </Box>
            
            {/* API Credentials Section */}
            <Box mt={6} mb={4} ref={credentialsSectionRef}>
              <Typography variant="h5" fontWeight="500" display="flex" alignItems="center" gap={2}>
                <FontAwesomeIcon icon={faKey} />
                API Credentials
              </Typography>
              <Typography variant="body1" color="text.secondary" mt={1} mb={3}>
                Manage your API keys for various services and integrations
              </Typography>
              <Credentials />
            </Box>
          </Grid>
        </Grid>
      </StyledContainer>
    </StyledPaper>
  );
};
