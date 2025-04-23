/**
 * Agents Sidebar Component
 *
 * Displays a list of agents with search, create, and delete functionality
 */

import { faClock, faRobot } from "@fortawesome/free-solid-svg-icons";
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
	ListItemText,
	Paper,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { queryClient } from "@shared/api/query-client";
import { AgentOptionsMenu } from "@shared/components/common/agent-options-menu";
import { CompactPagination } from "@shared/components/common/compact-pagination";
import { CreateAgentDialog } from "@shared/components/common/create-agent-dialog";
import { ImportAgentDialog } from "@shared/components/common/import-agent-dialog";
import { SidebarHeader } from "@shared/components/common/sidebar-header";
import { apiConfig } from "@shared/config";
import { useExportAgent } from "@shared/hooks/use-agent-mutations";
import { useAgents } from "@shared/hooks/use-agents";
import { usePaginationParams } from "@shared/hooks/use-pagination-params";
import type { ChangeEvent, FC } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

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
	overflowY: "auto",
	flexGrow: 1,
	padding: "8px 0px", // Match chat sidebar padding
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
	margin: "0 8px 8px", // Match chat sidebar margin
	borderRadius: 8,
	// marginBottom: 4, // Removed, handled by margin bottom
	// marginBottom: 4, // Removed, handled by margin bottom
	paddingRight: 12, // Match chat sidebar padding (now that secondaryAction is removed)
	paddingTop: 6, // Match chat sidebar padding
	paddingBottom: 6, // Match chat sidebar padding
	paddingLeft: 12, // Match chat sidebar padding
	position: "relative", // Add relative positioning like chat sidebar
	"&.Mui-selected": {
		backgroundColor: alpha(theme.palette.sidebar.itemActive, 0.1), // Match chat sidebar alpha
		color: theme.palette.sidebar.itemActiveText,
		"&:hover": {
			backgroundColor: alpha(theme.palette.sidebar.itemActiveHover, 0.15), // Match chat sidebar alpha
		},
	},
	"&:hover": {
		backgroundColor: alpha(theme.palette.sidebar.itemHover, 0.1), // Match chat sidebar alpha
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
	width: 42, // Match chat sidebar avatar size
	height: 42, // Match chat sidebar avatar size
}));

// Agent name styling (similar to chat sidebar)
const AgentName = styled(Typography)(() => ({
	fontWeight: 600, // Match chat sidebar
	fontSize: "0.9rem", // Match chat sidebar
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	flex: 1,
}));

// Description text styling (similar to message preview)
const DescriptionText = styled("div")(({ theme }) => ({
	fontSize: "0.8rem", // Match chat sidebar message preview
	color:
		theme.palette.mode === "dark"
			? "rgba(255, 255, 255, 0.7)"
			: "rgba(0, 0, 0, 0.6)", // Match chat sidebar message preview
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	width: "100%",
	minHeight: "18px", // Match chat sidebar message preview
}));

// Creation date text styling (similar to timestamp)
const CreationDateText = styled("div")(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	fontSize: "0.7rem", // Match chat sidebar timestamp
	color:
		theme.palette.mode === "dark"
			? "rgba(255, 255, 255, 0.5)"
			: "rgba(0, 0, 0, 0.5)", // Match chat sidebar timestamp
	marginTop: 2, // Add small margin like chat sidebar name/preview spacing
	gap: 4,
}));

// Options button container (similar to chat sidebar)
const OptionsButtonContainer = styled(Box)({
	position: "absolute",
	right: -8, // Position relative to the container it will be placed in
	top: "50%", // Center vertically
	transform: "translateY(-50%) translateX(100%)", // Center vertically and position off-screen horizontally
	opacity: 0,
	transition: "opacity 0.2s ease, transform 0.2s ease",
	// Target hover on the parent ListItemButton to trigger the effect
	".MuiListItemButton-root:hover &": {
		opacity: 1,
		transform: "translateY(-50%) translateX(0)", // Center vertically and slide in horizontally on hover
		visibility: "visible",
	},
	zIndex: 2,
	pointerEvents: "none", // Container doesn't block clicks
	"& > *": {
		pointerEvents: "auto", // Button inside is clickable
	},
});

/**
 * Props for the AgentsSidebar component
 */
type AgentsSidebarProps = {
	/** Currently selected agent ID */
	selectedAgentId?: string;
	/** Callback for when an agent is selected */
	onSelectAgent: (agent: AgentDetails) => void;
};

/**
 * Formats a date string into a more readable format
 */
const formatDate = (dateString: string): string => {
	if (!dateString) return "Unknown date";
	const date = new Date(dateString);
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
};

/**
 * Agents Sidebar Component
 *
 * Displays a list of agents with search, create, and delete functionality
 */
export const AgentsSidebar: FC<AgentsSidebarProps> = ({
	selectedAgentId,
	onSelectAgent,
}) => {
	const navigate = useNavigate();
	const [searchQuery, setSearchQuery] = useState("");
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
	const perPage = 50;

	// Export agent mutation
	const exportAgentMutation = useExportAgent();

	// Use the pagination hook to get and set the page from URL
	const { page, setPage } = usePaginationParams();

	// Store previous agents data to prevent UI flicker during refetches
	const [stableAgents, setStableAgents] = useState<AgentDetails[]>([]);
	const prevFetchingRef = useRef(false);

	const {
		data: agents = [],
		isLoading,
		isError,
		refetch,
		isFetching,
	} = useAgents(page, perPage, 0, searchQuery); // Pass searchQuery as the name parameter

	// Update stable agents when data changes and not during refetches
	useEffect(() => {
		// Only update stable agents when we have data and we're not in a refetching state
		// or when we're transitioning from fetching to not fetching (completed refetch)
		if (
			agents.length > 0 &&
			(!isFetching || (prevFetchingRef.current && !isFetching))
		) {
			setStableAgents(agents);
		}

		// Store current fetching state for next render
		prevFetchingRef.current = isFetching;
	}, [agents, isFetching]);

	// Use stable agents for rendering to prevent UI flicker
	const displayAgents =
		isFetching && stableAgents.length > 0 ? stableAgents : agents;

	const handlePageChange = useCallback(
		(_event: ChangeEvent<unknown>, value: number) => {
			setPage(value);
		},
		[setPage],
	);

	const handleSelectAgent = useCallback(
		(agent: AgentDetails) => {
			onSelectAgent(agent);
		},
		[onSelectAgent],
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
					if (createdAgent && onSelectAgent) {
						onSelectAgent(createdAgent);
					} else {
						// If the agent wasn't found in the updated list, use the API directly
						// to get the agent details and select it

						// Prefetch the agent details
						await queryClient.prefetchQuery({
							queryKey: ["agents", agentId],
							queryFn: async () => {
								const client = createLocalOperatorClient(apiConfig.baseUrl);
								const response = await client.agents.getAgent(agentId);
								return response.result;
							},
						});

						// Get the agent details from the cache
						const agentDetails = queryClient.getQueryData(["agents", agentId]);

						if (agentDetails && onSelectAgent) {
							onSelectAgent(agentDetails as AgentDetails);
						}
					}
				} catch (error) {
					console.error("Error fetching agent details:", error);
					// Still refetch the list even if there was an error
					refetch();
				}
			};

			fetchAndSelectAgent();
		},
		[onSelectAgent, refetch],
	);

	// No need for client-side filtering since we're using the server-side filter
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
			) : displayAgents.length === 0 ? (
				<EmptyStateContainer>
					<Typography variant="body2" color="text.secondary">
						No agents found
					</Typography>
				</EmptyStateContainer>
			) : (
				<AgentsList>
					{displayAgents.map((agent) => (
						<ListItem key={agent.id} disablePadding>
							{/* Removed secondaryAction */}
							<AgentListItemButton
								selected={selectedAgentId === agent.id}
								onClick={() => handleSelectAgent(agent)}
							>
								<ListItemAvatar>
									<AgentAvatar selected={selectedAgentId === agent.id}>
										<FontAwesomeIcon icon={faRobot} />
									</AgentAvatar>
								</ListItemAvatar>
								<ListItemText
									// Remove primary and secondary props, render custom content
									// primary={agent.name}
									// secondary={...}
									// primaryTypographyProps={{...}}
									disableTypography // Important to allow custom content structure
								>
									{/* Custom content structure similar to chat sidebar */}
									{/* Add position: relative here */}
									<Box
										sx={{
											position: "relative",
											width: "100%",
											overflow: "hidden",
										}}
									>
										<Tooltip
											enterDelay={1200}
											enterNextDelay={1200}
											title={agent.name}
											arrow
											placement="top-start"
										>
											<AgentName>{agent.name}</AgentName>
										</Tooltip>
										<Tooltip
											title={agent.description || "No description"}
											arrow
											placement="bottom-start"
											enterDelay={1200}
											enterNextDelay={1200}
										>
											{/* @ts-ignore - MUI Tooltip type issue */}
											<DescriptionText>
												{agent.description || "No description"}
											</DescriptionText>
										</Tooltip>
										<Tooltip
											title={`Created: ${formatDate(agent.created_date)}`}
											arrow
											placement="bottom-start"
											enterDelay={1200}
											enterNextDelay={1200}
										>
											{/* @ts-ignore - MUI Tooltip type issue */}
											<CreationDateText>
												<FontAwesomeIcon icon={faClock} size="xs" />
												<span>{formatDate(agent.created_date)}</span>
											</CreationDateText>
										</Tooltip>
										{/* Move OptionsButtonContainer inside the Box */}
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
														isAgentsPage={true}
														onAgentDeleted={(deletedAgentId) => {
															if (selectedAgentId === deletedAgentId) {
																// Parent handles selection clearing
															}
															refetch();
														}}
														onChatWithAgent={() =>
															navigate(`/chat/${agent.id}`)
														}
														onExportAgent={() => handleExportAgent(agent.id)}
														buttonSx={{
															// Match chat sidebar options button style
															width: 24,
															height: 24,
															borderRadius: "4px",
															display: "flex",
															justifyContent: "center",
															alignItems: "center",
															opacity: 1, // Opacity controlled by container
														}}
													/>
												</span>
											</Tooltip>
										</OptionsButtonContainer>
									</Box>
								</ListItemText>
								{/* OptionsButtonContainer moved inside Box */}
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
				count={Math.max(1, Math.ceil(displayAgents.length / perPage))}
				onChange={(newPage) =>
					handlePageChange({} as ChangeEvent<unknown>, newPage)
				}
			/>
		</SidebarContainer>
	);
};
