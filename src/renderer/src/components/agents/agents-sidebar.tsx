/**
 * Agents Sidebar Component
 *
 * Displays a list of agents with search, create, and delete functionality
 */

import {
	faPlus,
	faRobot,
	faSearch,
	faClock,
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
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { AgentOptionsMenu } from "@renderer/components/common/agent-options-menu";
import { CompactPagination } from "@renderer/components/common/compact-pagination";
import { CreateAgentDialog } from "@renderer/components/common/create-agent-dialog";
import type { AgentDetails } from "@renderer/api/local-operator/types";
import { useAgents } from "@renderer/hooks/use-agents";
import { usePaginationParams } from "@renderer/hooks/use-pagination-params";
import { queryClient } from "@renderer/api/query-client";
import { createLocalOperatorClient } from "@renderer/api/local-operator";
import { apiConfig } from "@renderer/config";
import type { ChangeEvent, FC } from "react";
import React, { useState, useCallback, useRef, useEffect } from "react";

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

const SearchField = styled(TextField)({
	"& .MuiOutlinedInput-root": {
		borderRadius: 8,
		backgroundColor: "rgba(255, 255, 255, 0.05)",
	},
});

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

const CreationDateText = styled(Typography)({
	display: "flex",
	alignItems: "center",
	fontSize: "0.75rem",
	color: "rgba(255, 255, 255, 0.6)",
	marginTop: 4,
	gap: 4,
});

const DescriptionText = styled(Typography)({
	maxWidth: "100%",
	fontSize: "0.75rem",
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
	const [searchQuery, setSearchQuery] = useState("");
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const perPage = 50;
	
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
	} = useAgents(page, perPage);

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
					if (createdAgent && onSelectAgent) {
						onSelectAgent(createdAgent);
					} else {
						// If the agent wasn't found in the updated list, use the API directly
						// to get the agent details and select it
						
						// Prefetch the agent details
						await queryClient.prefetchQuery({
							queryKey: ['agents', agentId],
							queryFn: async () => {
								const client = createLocalOperatorClient(apiConfig.baseUrl);
								const response = await client.agents.getAgent(agentId);
								return response.result;
							}
						});
						
						// Get the agent details from the cache
						const agentDetails = queryClient.getQueryData(['agents', agentId]);
						
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

	const filteredAgents = displayAgents.filter((agent) =>
		agent.name.toLowerCase().includes(searchQuery.toLowerCase()),
	);

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
			) : displayAgents.length === 0 ? (
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
									isAgentsPage={true}
									onAgentDeleted={(deletedAgentId) => {
										// Check if the deleted agent is the currently selected one
										if (selectedAgentId === deletedAgentId) {
											// If the selected agent was deleted, we don't need to do anything here
											// The parent component (AgentsPage) will handle clearing the selection
											// when it detects the agent no longer exists
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
								selected={selectedAgentId === agent.id}
								onClick={() => handleSelectAgent(agent)}
							>
								<ListItemAvatar>
									<AgentAvatar>
										<FontAwesomeIcon icon={faRobot} />
									</AgentAvatar>
								</ListItemAvatar>
								<ListItemText
									primary={agent.name}
									secondary={
										<>
											<DescriptionText>
												{agent.description || "No description"}
											</DescriptionText>
											<Tooltip title="Creation date" arrow placement="bottom-start">
												<CreationDateText>
													<FontAwesomeIcon icon={faClock} size="xs" />
													{formatDate(agent.created_date)}
												</CreationDateText>
											</Tooltip>
										</>
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
				count={Math.max(1, Math.ceil(displayAgents.length / perPage))}
				onChange={(newPage) => handlePageChange({} as ChangeEvent<unknown>, newPage)}
			/>
		</SidebarContainer>
	);
};
