import type { FC, ChangeEvent } from 'react';
import React, { useState, useCallback } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Typography,
  TextField,
  InputAdornment,
  Divider,
  Paper,
  CircularProgress,
  Alert,
  Button,
  Pagination,
  Tooltip,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSearch,
  faRobot,
  faClock,
  faCommentSlash,
  faPlus,
} from '@fortawesome/free-solid-svg-icons';
import { useAgents } from '@renderer/hooks/use-agents';
import { CreateAgentDialog } from '@renderer/components/common/create-agent-dialog';
import { AgentOptionsMenu } from '@renderer/components/common/agent-options-menu';
import { format } from 'date-fns';

const SidebarContainer = styled(Paper)({
  width: '100%',
  height: '100%',
  borderRight: '1px solid rgba(255, 255, 255, 0.1)',
  display: 'flex',
  flexDirection: 'column',
});

const HeaderContainer = styled(Box)({
  padding: 16,
});

const HeaderRow = styled(Box)({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
});

const Title = styled(Typography)({
  fontWeight: 500,
});

const NewAgentButton = styled(Button)(({ theme }) => ({
  borderRadius: 16,
  textTransform: 'none',
  fontWeight: 600,
  paddingLeft: 16,
  paddingRight: 16,
  paddingTop: 6.4,
  paddingBottom: 6.4,
  transition: 'all 0.2s ease-in-out',
  '&:hover': {
    boxShadow: `0 2px 8px ${theme.palette.primary.main}33`,
    transform: 'translateY(-1px)',
  },
  '&:active': {
    transform: 'translateY(0)',
  },
}));

const SearchField = styled(TextField)({
  marginBottom: 16,
  '& .MuiOutlinedInput-root': {
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
});

const StyledDivider = styled(Divider)({
  opacity: 0.1,
});

const LoadingContainer = styled(Box)({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  flexGrow: 1,
});

const ErrorAlert = styled(Alert)({
  marginBottom: 16,
  borderRadius: 16,
  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
});

const EmptyStateContainer = styled(Box)({
  padding: 24,
  textAlign: 'center',
});

const AgentsList = styled(List)({
  overflow: 'auto',
  flexGrow: 1,
  '&::-webkit-scrollbar': {
    width: '8px',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '4px',
  },
});

const AgentListItemButton = styled(ListItemButton)({
  margin: '0 8px',
  borderRadius: 16,
  marginBottom: 4,
  paddingRight: 40,
  '&.Mui-selected': {
    backgroundColor: 'rgba(56, 201, 106, 0.1)',
    '&:hover': {
      backgroundColor: 'rgba(56, 201, 106, 0.15)',
    },
  },
});

const AgentAvatar = styled(Avatar)(({ theme }) => ({
  backgroundColor: 'rgba(56, 201, 106, 0.2)',
  color: theme.palette.primary.main,
}));

const MessagePreview = styled(Typography)({
  display: 'block',
  color: 'text.secondary',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '160px',
  marginBottom: 4,
});

const TimeStampContainer = styled('span')({
  display: 'flex',
  alignItems: 'center',
  color: 'rgba(255, 255, 255, 0.5)',
  fontSize: '0.75rem',
});

const TimeStampText = styled('span')({
  cursor: 'help',
});

const NoMessagesContainer = styled('span')({
  display: 'flex',
  alignItems: 'center',
  color: 'rgba(255, 255, 255, 0.5)',
  fontSize: '0.75rem',
  fontStyle: 'italic',
});

const PaginationContainer = styled(Box)({
  display: 'flex',
  justifyContent: 'center',
  marginTop: 24,
});

type ChatSidebarProps = {
  selectedConversation?: string;
  onSelectConversation: (id: string) => void;
  onNavigateToAgentSettings?: (agentId: string) => void;
};

/**
 * Chat Sidebar Component
 * 
 * Displays a list of agents with search, create, and delete functionality
 */
export const ChatSidebar: FC<ChatSidebarProps> = ({
  selectedConversation,
  onSelectConversation,
  onNavigateToAgentSettings,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const perPage = 10;

  const {
    data: agents = [],
    isLoading,
    isError,
    refetch,
  } = useAgents(page, perPage);

  const handlePageChange = useCallback((_event: ChangeEvent<unknown>, value: number) => {
    setPage(value);
  }, []);

  const handleSelectConversation = useCallback((agentId: string) => {
    onSelectConversation(agentId);
  }, [onSelectConversation]);
  
  const handleOpenCreateDialog = useCallback(() => {
    setIsCreateDialogOpen(true);
  }, []);
  
  const handleCloseCreateDialog = useCallback(() => {
    setIsCreateDialogOpen(false);
  }, []);
  
  const handleAgentCreated = useCallback((agentId: string) => {
    onSelectConversation(agentId);
    refetch();
  }, [onSelectConversation, refetch]);

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDateTime = (dateTimeString?: string) => {
    if (!dateTimeString) return '';
    try {
      const date = new Date(dateTimeString);
      return format(date, 'MMM d, h:mm a');
    } catch (error) {
      return '';
    }
  };

  const truncateMessage = (message?: string, maxLength = 60) => {
    if (!message) return '';
    return message.length > maxLength
      ? `${message.substring(0, maxLength)}...`
      : message;
  };

  return (
    <SidebarContainer elevation={0}>
      <HeaderContainer>
        <HeaderRow>
          <Title variant="h6">
            Agents
          </Title>
          {/* @ts-ignore - MUI Tooltip requires children but we're providing it */}
          <Tooltip title="Create a new agent" arrow placement="top">
            <NewAgentButton
              variant="outlined"
              color="primary"
              size="small"
              startIcon={<FontAwesomeIcon icon={faPlus} />}
              onClick={handleOpenCreateDialog}
            >
              New Agent
            </NewAgentButton>
          </Tooltip>
        </HeaderRow>

        <SearchField
          fullWidth
          size="small"
          placeholder="Search agents"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <FontAwesomeIcon icon={faSearch} size="sm" />
              </InputAdornment>
            ),
          }}
        />
      </HeaderContainer>

      <StyledDivider />

      {isLoading ? (
        <LoadingContainer>
          <CircularProgress size={40} thickness={4} />
        </LoadingContainer>
      ) : isError ? (
        <ErrorAlert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()} sx={{ fontWeight: 500 }}>
              Retry
            </Button>
          }
        >
          Failed to load agents. Please try again.
        </ErrorAlert>
      ) : agents.length === 0 ? (
        <EmptyStateContainer>
          <Typography variant="body2" color="text.secondary">
            No agents found
          </Typography>
        </EmptyStateContainer>
      ) : (
        <AgentsList>
          {filteredAgents.map((agent) => (
            <ListItem 
              key={agent.id} 
              disablePadding
              secondaryAction={
                <AgentOptionsMenu
                  agentId={agent.id}
                  agentName={agent.name}
                  isAgentsPage={false}
                  onViewAgentSettings={onNavigateToAgentSettings ? () => onNavigateToAgentSettings(agent.id) : undefined}
                  onAgentDeleted={(deletedId) => {
                    if (selectedConversation === deletedId) {
                      onSelectConversation('');
                    }
                    refetch();
                  }}
                  buttonSx={{
                    mr: 0.5,
                    width: 32,
                    height: 32,
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    '.MuiListItem-root:hover &': {
                      opacity: 0.6,
                    },
                    '.MuiListItemButton-root.Mui-selected + .MuiListItemSecondaryAction-root &': {
                      opacity: 0.6,
                    },
                  }}
                />
              }
            >
              <AgentListItemButton
                selected={selectedConversation === agent.id}
                onClick={() => handleSelectConversation(agent.id)}
              >
                <ListItemAvatar>
                  <AgentAvatar>
                    <FontAwesomeIcon icon={faRobot} />
                  </AgentAvatar>
                </ListItemAvatar>
                <ListItemText
                  primary={agent.name}
                  secondary={
                    <span style={{ display: 'block', marginTop: '4px' }}>
                      {agent.last_message ? (
                        <>
                          <MessagePreview variant="body2">
                            {truncateMessage(agent.last_message)}
                          </MessagePreview>
                          {agent.last_message_datetime && (
                            <TimeStampContainer>
                              <FontAwesomeIcon 
                                icon={faClock} 
                                size="xs" 
                                style={{ marginRight: '4px' }} 
                              />
                              <TimeStampText title={new Date(agent.last_message_datetime).toLocaleString()}>
                                {formatDateTime(agent.last_message_datetime)}
                              </TimeStampText>
                            </TimeStampContainer>
                          )}
                        </>
                      ) : (
                        <NoMessagesContainer>
                          <FontAwesomeIcon 
                            icon={faCommentSlash} 
                            size="xs" 
                            style={{ marginRight: '4px' }} 
                          />
                          <span>No messages yet</span>
                        </NoMessagesContainer>
                      )}
                    </span>
                  }
                  primaryTypographyProps={{
                    fontWeight: 500,
                    variant: 'body1',
                  }}
                />
              </AgentListItemButton>
            </ListItem>
          ))}
          {agents.length > perPage && (
            <PaginationContainer>
              <Pagination
                count={Math.ceil(agents.length / perPage)}
                page={page}
                onChange={handlePageChange}
                color="primary"
                size="medium"
              />
            </PaginationContainer>
          )}
        </AgentsList>
      )}
      
      <CreateAgentDialog
        open={isCreateDialogOpen}
        onClose={handleCloseCreateDialog}
        onAgentCreated={handleAgentCreated}
      />
    </SidebarContainer>
  );
};
