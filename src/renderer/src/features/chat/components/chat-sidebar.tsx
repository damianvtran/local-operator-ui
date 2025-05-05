import { faCommentSlash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Bot } from "lucide-react";
import {
	Alert,
	Avatar,
	Box,
	Button,
	CircularProgress,
	List,
	ListItem,
	ListItemAvatar,
	ListItemButton,
	Paper,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type { AgentDetails } from "@shared/api/local-operator/types";
import {
	AgentOptionsMenu,
	CompactPagination,
	CreateAgentDialog,
	ImportAgentDialog,
	SidebarHeader,
} from "@shared/components/common";
import {
	useAgent,
	useAgents,
	useClearAgentConversation,
	useExportAgent,
	usePaginationParams,
} from "@shared/hooks";
import {
	formatMessageDateTime,
	getFullDateTime,
} from "@shared/utils/date-utils";
import type { ChangeEvent, FC } from "react";
import { useCallback, useMemo, useState } from "react";

const SidebarContainer = styled(Paper)(({ theme }) => ({
	width: "100%",
	height: "100%",
	borderRight: `1px solid ${theme.palette.sidebar.border}`,
	backgroundColor: theme.palette.sidebar.secondaryBackground,
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
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

const AgentsList = styled(List)(({ theme }) => ({
	overflow: "auto",
	flexGrow: 1,
	padding: "8px 0px",
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor:
			theme.palette.mode === "dark"
				? "rgba(255, 255, 255, 0.1)"
				: "rgba(0, 0, 0, 0.1)",
		borderRadius: "4px",
	},
}));

const AgentListItemButton = styled(ListItemButton)(({ theme }) => ({
	margin: "0 8px 8px",
	borderRadius: 8,
	paddingRight: 12,
	paddingTop: 6,
	paddingBottom: 6,
	paddingLeft: 12,
	position: "relative",
	"&.Mui-selected": {
		backgroundColor: alpha(theme.palette.sidebar.itemActive, 0.1),
		color: theme.palette.sidebar.itemActiveText,
		"&:hover": {
			backgroundColor: alpha(theme.palette.sidebar.itemActiveHover, 0.15),
		},
	},
	"&:hover": {
		backgroundColor: alpha(theme.palette.sidebar.itemHover, 0.1),
	},
}));

const AgentAvatar = styled(Avatar, {
	shouldForwardProp: (prop) => prop !== "selected",
})<{ selected?: boolean }>(({ theme, selected }) => ({
	backgroundColor: selected
		? theme.palette.sidebar.itemActive
		: theme.palette.icon.background,
	color: selected
		? theme.palette.sidebar.itemActiveText
		: theme.palette.icon.text,
	boxShadow: `0 2px 4px ${alpha(theme.palette.common.black, 0.15)}`,
	width: 42,
	height: 42,
}));

// Message bubble styling
const MessageBubble = styled("div")({
	display: "flex",
	flexDirection: "column",
	width: "100%",
	overflow: "hidden",
	position: "relative",
	isolation: "isolate",
});

// Agent name container with timestamp
const AgentNameContainer = styled(Box)({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	width: "100%",
	position: "relative",
	overflow: "hidden",
});

// Agent name styling
const AgentName = styled(Typography)(() => ({
	fontWeight: 600,
	fontSize: "0.9rem",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	marginBottom: 2,
	flex: 1,
}));

// Message preview with truncation
const MessagePreview = styled("div")(({ theme }) => ({
	fontSize: "0.8rem",
	color:
		theme.palette.mode === "dark"
			? "rgba(255, 255, 255, 0.7)"
			: "rgba(0, 0, 0, 0.6)",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	width: "100%",
	minHeight: "18px",
}));

// Time stamp styling
const TimeStampContainer = styled("div")(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	color:
		theme.palette.mode === "dark"
			? "rgba(255, 255, 255, 0.5)"
			: "rgba(0, 0, 0, 0.5)",
	fontSize: "0.7rem",
	marginLeft: 8,
	flexShrink: 0,
	transition: "transform 0.2s ease",
	".MuiListItemButton-root:hover &": {
		transform: "translateX(-24px)",
	},
	// Ensure the timestamp doesn't get affected by menu clicks
	pointerEvents: "none",
}));

const TimeStampText = styled("span")({
	cursor: "help",
});

// Options button container
const OptionsButtonContainer = styled(Box)({
	position: "absolute",
	right: -8,
	top: 0,
	opacity: 0,
	transform: "translateX(100%)",
	transition: "opacity 0.2s ease, transform 0.2s ease",
	".MuiListItemButton-root:hover &": {
		opacity: 1,
		transform: "translateX(0)",
		visibility: "visible",
	},
	zIndex: 2,
	pointerEvents: "none",
	"& > *": {
		pointerEvents: "auto",
	},
});

// No messages styling
const NoMessagesContainer = styled("div")(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	color:
		theme.palette.mode === "dark"
			? "rgba(255, 255, 255, 0.5)"
			: "rgba(0, 0, 0, 0.5)",
	fontSize: "0.8rem",
	fontStyle: "italic",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
}));

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
	const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
	const perPage = 50;

	// Export agent mutation
	const exportAgentMutation = useExportAgent();

	// Clear conversation mutation
	const clearConversationMutation = useClearAgentConversation();

	// Use the pagination hook to get and set the page from URL
	const { page, setPage } = usePaginationParams();

	// Set up periodic refetch every 5 seconds to check for new messages
	// Pass the search query, sort, and direction parameters
	const {
		data: agentListResult, // Rename data to agentListResult
		isLoading,
		isError,
		refetch,
	} = useAgents(
		page,
		perPage,
		5000,
		searchQuery,
		"last_message_datetime",
		"desc",
	);

	// Extract agents and total count from the result
	const agents = agentListResult?.agents || [];
	const totalAgents = agentListResult?.total || 0;

	// Fetch details for the selected agent if it's not in the current list
	const { data: selectedAgentDetails } = useAgent(
		// Only fetch if selectedConversation exists and is not found in the current agents list
		selectedConversation && !agents.find((a) => a.id === selectedConversation)
			? selectedConversation
			: undefined,
	);

	// Memoize combinedAgents to stabilize its reference for hook dependencies
	const combinedAgents = useMemo(() => {
		const combined = [...agents];
		if (
			selectedAgentDetails &&
			!combined.find((a) => a.id === selectedAgentDetails.id)
		) {
			// Add the selected agent if it's not already in the list
			combined.push(selectedAgentDetails);
		}
		return combined;
	}, [agents, selectedAgentDetails]);

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

	const handleOpenImportDialog = useCallback(() => {
		setIsImportDialogOpen(true);
	}, []);

	const handleCloseImportDialog = useCallback(() => {
		setIsImportDialogOpen(false);
	}, []);

	const handleExportAgent = useCallback(
		async (agentId: string) => {
			try {
				const blob = await exportAgentMutation.mutateAsync(agentId);

				// Get the agent name for the filename (check combined list)
				const agent = combinedAgents.find((a) => a.id === agentId);
				const agentName = agent
					? agent.name.replace(/\s+/g, "-").toLowerCase()
					: agentId;

				// Create a download link
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = `${agentName}-export.zip`;
				document.body.appendChild(a);
				a.click();

				// Clean up
				URL.revokeObjectURL(url);
				document.body.removeChild(a);
			} catch (error) {
				console.error("Failed to export agent:", error);
			}
		},
		[combinedAgents, exportAgentMutation], // Use combinedAgents
	);

	const handleAgentCreated = useCallback(
		(agentId: string) => {
			// Fetch the agent details to get the full agent object
			const fetchAndSelectAgent = async () => {
				try {
					// Refetch the agents list to update the UI
					const result = await refetch();

					// Get the updated agents list from the refetch result
					const updatedAgentList = result.data?.agents || [];

					// Find the newly created agent in the updated list
					const createdAgent = updatedAgentList.find(
						(agent: AgentDetails) => agent.id === agentId,
					);

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

	const truncateMessage = (message?: string, maxLength = 60) => {
		if (!message) return "";
		return message.length > maxLength
			? `${message.substring(0, maxLength)}...`
			: message;
	};

	return (
		<SidebarContainer elevation={0}>
			<SidebarHeader
				title="Agents"
				searchQuery={searchQuery}
				onSearchChange={(query) => setSearchQuery(query)}
				onNewAgentClick={handleOpenCreateDialog}
				onImportAgentClick={handleOpenImportDialog}
				importAgentTooltip="Import an agent from a ZIP file"
			/>

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
			) : combinedAgents.length === 0 && !isLoading ? ( // Check combinedAgents and isLoading
				<EmptyStateContainer>
					<Typography variant="body2" color="text.secondary">
						{searchQuery ? "No agents match your search" : "No agents found"}
					</Typography>
				</EmptyStateContainer>
			) : (
				<AgentsList>
					{combinedAgents.map((agent) => (
						<ListItem key={agent.id} disablePadding>
							<AgentListItemButton
								selected={
									selectedConversation === agent.id ||
									selectedAgentDetails?.id === agent.id
								}
								onClick={() => handleSelectConversation(agent.id)}
							>
								<ListItemAvatar>
									<AgentAvatar selected={selectedConversation === agent.id}>
										<Bot size={22} strokeWidth={2.1} aria-label="Agent" />
									</AgentAvatar>
								</ListItemAvatar>
								<MessageBubble>
									<AgentNameContainer>
										<Tooltip
											enterDelay={1200}
											enterNextDelay={1200}
											title={agent.name}
											arrow
											placement="top-start"
										>
											<AgentName>{agent.name}</AgentName>
										</Tooltip>
										{agent.last_message_datetime && (
											<TimeStampContainer>
												<TimeStampText
													title={getFullDateTime(agent.last_message_datetime)}
												>
													{formatMessageDateTime(agent.last_message_datetime)}
												</TimeStampText>
											</TimeStampContainer>
										)}
										<OptionsButtonContainer>
											<Tooltip
												enterDelay={1200}
												enterNextDelay={1200}
												title="Agent Options"
												arrow
												placement="top"
											>
												<span>
													<AgentOptionsMenu
														agentId={agent.id}
														agentName={agent.name}
														isAgentsPage={false}
														onViewAgentSettings={
															onNavigateToAgentSettings
																? () => onNavigateToAgentSettings(agent.id)
																: undefined
														}
														onExportAgent={() => handleExportAgent(agent.id)}
														onClearConversation={() => {
															clearConversationMutation.mutate({
																agentId: agent.id,
															});
														}}
														onAgentDeleted={(deletedAgentId) => {
															if (selectedConversation === deletedAgentId) {
																onSelectConversation("");
															}
															refetch();
														}}
														buttonSx={{
															width: 24,
															height: 24,
															borderRadius: "4px",
															display: "flex",
															justifyContent: "center",
															alignItems: "center",
															opacity: 1,
														}}
													/>
												</span>
											</Tooltip>
										</OptionsButtonContainer>
									</AgentNameContainer>

									{agent.last_message ? (
										<Tooltip
											title={truncateMessage(agent.last_message, 500)}
											arrow
											placement="bottom-start"
											enterDelay={1200}
											enterNextDelay={1200}
										>
											<MessagePreview>
												{truncateMessage(agent.last_message, 40)}
											</MessagePreview>
										</Tooltip>
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
								</MessageBubble>
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

			<ImportAgentDialog
				open={isImportDialogOpen}
				onClose={handleCloseImportDialog}
				onAgentImported={handleAgentCreated}
			/>

			{totalAgents > 0 && (
				<CompactPagination
					page={page}
					count={Math.max(1, Math.ceil(totalAgents / perPage))}
					onChange={(newPage) =>
						handlePageChange({} as ChangeEvent<unknown>, newPage)
					}
				/>
			)}
		</SidebarContainer>
	);
};
