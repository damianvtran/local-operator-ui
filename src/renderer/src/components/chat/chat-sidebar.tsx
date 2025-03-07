import {
	faClock,
	faCommentSlash,
	faPlus,
	faRobot,
	faSearch,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Avatar,
	Box,
	Button,
	CircularProgress,
	InputAdornment,
	List,
	ListItem,
	ListItemAvatar,
	ListItemButton,
	ListItemText,
	Paper,
	TextField,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { AgentOptionsMenu } from "@renderer/components/common/agent-options-menu";
import { CompactPagination } from "@renderer/components/common/compact-pagination";
import { CreateAgentDialog } from "@renderer/components/common/create-agent-dialog";
import { useAgents } from "@renderer/hooks/use-agents";
import { usePaginationParams } from "@renderer/hooks/use-pagination-params";
import { format } from "date-fns";
import type { ChangeEvent, FC } from "react";
import React, { useState, useCallback } from "react";

const SidebarContainer = styled(Paper)(() => ({
	width: "100%",
	height: "100%",
  borderRight: "1px solid rgba(255, 255, 255, 0.08)",
	backgroundColor: "background.paper",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
}));

const SidebarHeader = styled(Box)(({ theme }) => ({
	padding: theme.spacing(3),
	borderBottom: "1px solid rgba(255,255,255,0.08)",
}));

const HeaderRow = styled(Box)({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: 16,
});

const SidebarTitle = styled(Typography)({
	fontWeight: 600,
	fontSize: "1rem",
});

const NewAgentButton = styled(Button)(({ theme }) => ({
	borderRadius: 8,
	textTransform: "none",
	fontWeight: 600,
	paddingLeft: 16,
	paddingRight: 16,
	paddingTop: 6.4,
	paddingBottom: 6.4,
	transition: "all 0.2s ease-in-out",
	"&:hover": {
		boxShadow: `0 2px 8px ${theme.palette.primary.main}33`,
		transform: "translateY(-1px)",
	},
	"&:active": {
		transform: "translateY(0)",
	},
}));

const SearchField = styled(TextField)(({ theme }) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: theme.shape.borderRadius * 1.5,
		backgroundColor: alpha(theme.palette.background.paper, 0.6),
		border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
		transition: "all 0.2s ease-in-out",
		"&.Mui-focused": {
			backgroundColor: alpha(theme.palette.background.paper, 0.8),
			boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.15)}`,
		},
		"&:hover": {
			backgroundColor: alpha(theme.palette.background.paper, 0.7),
		},
		padding: "8px 12px",
		fontSize: "0.875rem",
	},
	"& .MuiInputBase-input": {
		fontSize: "0.875rem",
	},
	"& .MuiInputAdornment-root": {
		color: alpha(theme.palette.text.primary, 0.6),
	},
}));

const LoadingContainer = styled(Box)({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	flexGrow: 1,
});

const ErrorAlert = styled(Alert)({
	marginBottom: 16,
	borderRadius: 16,
	boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
});

const EmptyStateContainer = styled(Box)({
	padding: 24,
	textAlign: "center",
});

const AgentsList = styled(List)({
	overflow: "auto",
	flexGrow: 1,
	padding: "8px",
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		borderRadius: "4px",
	},
});

const AgentListItemButton = styled(ListItemButton)({
	margin: "0 8px",
	borderRadius: 8,
	marginBottom: 4,
	paddingRight: 40,
	"&.Mui-selected": {
		backgroundColor: "rgba(56, 201, 106, 0.1)",
		"&:hover": {
			backgroundColor: "rgba(56, 201, 106, 0.15)",
		},
	},
});

const AgentAvatar = styled(Avatar)(({ theme }) => ({
	backgroundColor: "rgba(56, 201, 106, 0.2)",
	color: theme.palette.primary.main,
}));

const MessagePreview = styled(Typography)({
	display: "block",
	color: "text.secondary",
	maxWidth: "100%",
	marginBottom: 4,
  fontSize: "0.75rem",
});

const TimeStampContainer = styled("span")({
	display: "flex",
	alignItems: "center",
	color: "rgba(255, 255, 255, 0.5)",
	fontSize: "0.75rem",
});

const TimeStampText = styled("span")({
	cursor: "help",
});

const NoMessagesContainer = styled("span")({
	display: "flex",
	alignItems: "center",
	color: "rgba(255, 255, 255, 0.5)",
	fontSize: "0.75rem",
	fontStyle: "italic",
});

/**
 * Props for the ChatSidebar component
 */
type ChatSidebarProps = {
	/** Currently selected conversation ID */
	selectedConversation?: string;
	/** Callback for when a conversation is selected */
	onSelectConversation: (id: string) => void;
	/** Callback for navigating to agent settings */
	onNavigateToAgentSettings?: (agentId: string) => void;
};

/**
 * Chat Sidebar Component
 *
 * Displays a list of agents with search, create, and delete functionality
 * Uses React Router for navigation
 */
export const ChatSidebar: FC<ChatSidebarProps> = ({
	selectedConversation,
	onSelectConversation,
	onNavigateToAgentSettings,
}) => {
	const [searchQuery, setSearchQuery] = useState("");
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const perPage = 50;
	
	// Use the pagination hook to get and set the page from URL
	const { page, setPage } = usePaginationParams();
	
	// Set up periodic refetch every 5 seconds to check for new messages
	// Pass the search query as the name parameter
	const {
		data: agents = [],
		isLoading,
		isError,
		refetch,
	} = useAgents(page, perPage, 5000, searchQuery); // 5000ms = 5 seconds

	const handlePageChange = useCallback(
		(_event: ChangeEvent<unknown>, value: number) => {
			setPage(value);
		},
		[setPage],
	);

	const handleSelectConversation = useCallback(
		(agentId: string) => {
			onSelectConversation(agentId);
		},
		[onSelectConversation],
	);

	const handleOpenCreateDialog = useCallback(() => {
		setIsCreateDialogOpen(true);
	}, []);

	const handleCloseCreateDialog = useCallback(() => {
		setIsCreateDialogOpen(false);
	}, []);

	const handleAgentCreated = useCallback(
		(agentId: string) => {
			// Fetch the agent details to get the full agent object
			const fetchAndSelectAgent = async () => {
				try {
					// Refetch the agents list to update the UI
					const result = await refetch();
					
					// Get the updated agents list from the refetch result
					const updatedAgents = result.data || [];
					
					// Find the newly created agent in the updated list
					const createdAgent = updatedAgents.find(agent => agent.id === agentId);
					
					// Select the newly created agent if found
					if (createdAgent) {
						onSelectConversation(agentId);
					} else {
						// If the agent wasn't found in the updated list, still select it
						// The agent details will be fetched when needed
						onSelectConversation(agentId);
					}
				} catch (error) {
					console.error("Error fetching agent details:", error);
					// Still select the agent even if there was an error
					onSelectConversation(agentId);
				}
			};

			fetchAndSelectAgent();
		},
		[onSelectConversation, refetch],
	);

	// No need for client-side filtering since we're using the server-side filter
	const formatDateTime = (dateTimeString?: string) => {
		if (!dateTimeString) return "";
		try {
			const date = new Date(dateTimeString);
			return format(date, "MMM d, h:mm a");
		} catch (error) {
			return "";
		}
	};

	const truncateMessage = (message?: string, maxLength = 60) => {
		if (!message) return "";
		return message.length > maxLength
			? `${message.substring(0, maxLength)}...`
			: message;
	};

	return (
		<SidebarContainer elevation={0}>
			<SidebarHeader>
				<HeaderRow>
					<SidebarTitle variant="subtitle1">Agents</SidebarTitle>
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
			</SidebarHeader>

			{isLoading ? (
				<LoadingContainer>
					<CircularProgress size={40} thickness={4} />
				</LoadingContainer>
			) : isError ? (
				<ErrorAlert
					severity="error"
					action={
						<Button
							color="inherit"
							size="small"
							onClick={() => refetch()}
							sx={{ fontWeight: 500 }}
						>
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
					{agents.map((agent) => (
						<ListItem
							key={agent.id}
							disablePadding
							secondaryAction={
								<AgentOptionsMenu
									agentId={agent.id}
									agentName={agent.name}
									isAgentsPage={false}
									onViewAgentSettings={
										onNavigateToAgentSettings
											? () => onNavigateToAgentSettings(agent.id)
											: undefined
									}
									onAgentDeleted={(deletedAgentId) => {
										// Check if the deleted agent is the currently selected one
										if (selectedConversation === deletedAgentId) {
											// If so, clear the selection by calling the parent's onSelectConversation with null
											onSelectConversation("");
										}
										// Refetch the agents list
										refetch();
									}}
									buttonSx={{
										mr: 0.5,
										width: 32,
										height: 32,
										borderRadius: "8px",
										display: "flex",
										justifyContent: "center",
										alignItems: "center",
										".MuiListItem-root:hover &": {
											opacity: 0.6,
										},
										".MuiListItemButton-root.Mui-selected + .MuiListItemSecondaryAction-root &":
											{
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
										<span style={{ display: "block", marginTop: "4px" }}>
											{agent.last_message ? (
												<>
													<Tooltip title={truncateMessage(agent.last_message, 500)} arrow placement="bottom-start">
														<MessagePreview variant="body2">
															{truncateMessage(agent.last_message, 60)}
														</MessagePreview>
													</Tooltip>
													{agent.last_message_datetime && (
														<TimeStampContainer>
															<FontAwesomeIcon
																icon={faClock}
																size="xs"
																style={{ marginRight: "4px" }}
															/>
															<TimeStampText
																title={new Date(
																	agent.last_message_datetime,
																).toLocaleString()}
															>
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
														style={{ marginRight: "4px" }}
													/>
													<span>No messages yet</span>
												</NoMessagesContainer>
											)}
										</span>
									}
									primaryTypographyProps={{
										fontWeight: 500,
										variant: "body1",
									}}
								/>
							</AgentListItemButton>
						</ListItem>
					))}
				</AgentsList>
			)}

			<CreateAgentDialog
				open={isCreateDialogOpen}
				onClose={handleCloseCreateDialog}
				onAgentCreated={handleAgentCreated}
			/>
			
			{/* Compact pagination at the bottom of the sidebar */}
			<CompactPagination
				page={page}
				count={Math.max(1, Math.ceil(agents.length / perPage))}
				onChange={(newPage) => handlePageChange({} as ChangeEvent<unknown>, newPage)}
			/>
		</SidebarContainer>
	);
};
