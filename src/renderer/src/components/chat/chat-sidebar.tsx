import { faCommentSlash, faRobot } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
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
import { AgentOptionsMenu } from "@renderer/components/common/agent-options-menu";
import { CompactPagination } from "@renderer/components/common/compact-pagination";
import { CreateAgentDialog } from "@renderer/components/common/create-agent-dialog";
import { ImportAgentDialog } from "@renderer/components/common/import-agent-dialog";
import { SidebarHeader } from "@renderer/components/common/sidebar-header";
import { useExportAgent } from "@renderer/hooks/use-agent-mutations";
import { useAgents } from "@renderer/hooks/use-agents";
import { usePaginationParams } from "@renderer/hooks/use-pagination-params";
import { format } from "date-fns";
import type { ChangeEvent, FC } from "react";
import React, { useState, useCallback } from "react";

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
	position: "relative", // Ensure proper positioning context
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
	// Ensure the message bubble maintains its layout
	isolation: "isolate", // Create a new stacking context
});

// Agent name container with timestamp
const AgentNameContainer = styled(Box)({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	width: "100%",
	position: "relative",
	// Ensure the container maintains its position
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
	// Ensure the container doesn't affect layout when clicked
	pointerEvents: "none",
	"& > *": {
		pointerEvents: "auto", // Allow clicks on children (the button itself)
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

				// Get the agent name for the filename
				const agent = agents.find((a) => a.id === agentId);
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
		[agents, exportAgentMutation],
	);

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
					const createdAgent = updatedAgents.find(
						(agent) => agent.id === agentId,
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

	// Format date/time based on when the message was sent
	const formatDateTime = (dateTimeString?: string) => {
		if (!dateTimeString) return "";
		try {
			const messageDate = new Date(dateTimeString);
			const now = new Date();
			const yesterday = new Date(now);
			yesterday.setDate(now.getDate() - 1);

			// Check if the message was sent today
			if (messageDate.toDateString() === now.toDateString()) {
				return format(messageDate, "h:mm a"); // Today: just time
			}

			// Check if the message was sent yesterday
			if (messageDate.toDateString() === yesterday.toDateString()) {
				return "Yesterday"; // Yesterday
			}

			// Check if the message was sent this week (within the last 7 days)
			const oneWeekAgo = new Date(now);
			oneWeekAgo.setDate(now.getDate() - 7);
			if (messageDate > oneWeekAgo) {
				return format(messageDate, "EEEE"); // Day of week
			}

			// Otherwise, show the full date
			return format(messageDate, "yyyy-MM-dd");
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

	// Sort agents by last_message_datetime in descending order
	const sortedAgents = [...agents].sort((a, b) => {
		// If both have last_message_datetime, compare them
		if (a.last_message_datetime && b.last_message_datetime) {
			return (
				new Date(b.last_message_datetime).getTime() -
				new Date(a.last_message_datetime).getTime()
			);
		}
		// If only a has last_message_datetime, a comes first
		if (a.last_message_datetime) return -1;
		// If only b has last_message_datetime, b comes first
		if (b.last_message_datetime) return 1;
		// If neither has last_message_datetime, maintain original order
		return 0;
	});

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
			) : sortedAgents.length === 0 ? (
				<EmptyStateContainer>
					<Typography variant="body2" color="text.secondary">
						No agents found
					</Typography>
				</EmptyStateContainer>
			) : (
				<AgentsList>
					{sortedAgents.map((agent) => (
						<ListItem key={agent.id} disablePadding>
							<AgentListItemButton
								selected={selectedConversation === agent.id}
								onClick={() => handleSelectConversation(agent.id)}
							>
								<ListItemAvatar>
									<AgentAvatar selected={selectedConversation === agent.id}>
										<FontAwesomeIcon icon={faRobot} />
									</AgentAvatar>
								</ListItemAvatar>
								<MessageBubble>
									<AgentNameContainer>
										<Tooltip title={agent.name} arrow placement="top-start">
											<AgentName>{agent.name}</AgentName>
										</Tooltip>
										{agent.last_message_datetime && (
											<TimeStampContainer>
												<TimeStampText
													title={new Date(
														agent.last_message_datetime,
													).toLocaleString()}
												>
													{formatDateTime(agent.last_message_datetime)}
												</TimeStampText>
											</TimeStampContainer>
										)}
										<OptionsButtonContainer>
											<Tooltip title="Agent Options" arrow placement="top">
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
											enterDelay={1000}
											leaveDelay={200}
										>
											{/* @ts-ignore - MUI Tooltip type issue */}
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

			{/* Compact pagination at the bottom of the sidebar */}
			<CompactPagination
				page={page}
				count={Math.max(1, Math.ceil(sortedAgents.length / perPage))}
				onChange={(newPage) =>
					handlePageChange({} as ChangeEvent<unknown>, newPage)
				}
			/>
		</SidebarContainer>
	);
};
