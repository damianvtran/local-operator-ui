/**
 * Agent List Component
 *
 * Displays a list of agents with loading, error, and empty states
 */

import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	Pagination,
	Paper,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { createLocalOperatorClient } from "@renderer/api/local-operator";
import type { AgentDetails } from "@renderer/api/local-operator/types";
import { CreateAgentDialog } from "@renderer/components/common/create-agent-dialog";
import { apiConfig } from "@renderer/config";
import { useAgents } from "@renderer/hooks/use-agents";
import React, { useState, useRef, useEffect } from "react";
import type { ChangeEvent, FC } from "react";
import { AgentListItem } from "./agent-list-item";

type AgentListProps = {
	/** Handler for when an agent is selected */
	onSelectAgent?: (agent: AgentDetails) => void;
	/** Currently selected agent ID */
	selectedAgentId?: string;
};

const StyledPaper = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(3),
	[theme.breakpoints.down("sm")]: {
		padding: theme.spacing(2),
	},
	height: "100%",
	display: "flex",
	flexDirection: "column",
	borderRadius: 8,
	backgroundColor: theme.palette.background.paper,
	boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
	transition: "box-shadow 0.3s ease-in-out",
	"&:hover": {
		boxShadow: "0 6px 25px rgba(0,0,0,0.08)",
	},
}));

const HeaderContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: theme.spacing(3),
	paddingBottom: theme.spacing(2),
	borderBottom: "1px solid",
	borderColor: theme.palette.divider,
}));

const HeaderTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 700,
	fontSize: "1.5rem",
	[theme.breakpoints.down("sm")]: {
		fontSize: "1.25rem",
	},
	letterSpacing: "-0.01em",
}));

const ButtonsContainer = styled(Box)({
	display: "flex",
	gap: 8,
});

const CreateButton = styled(Button)(({ theme }) => ({
	borderRadius: 8,
	textTransform: "none",
	paddingLeft: theme.spacing(2),
	paddingRight: theme.spacing(2),
	fontWeight: 500,
	minWidth: "110px",
	transition: "all 0.2s",
	"&:hover": {
		transform: "translateY(-2px)",
	},
}));

const RefreshButton = styled(Button, {
	shouldForwardProp: (prop) => prop !== "isFetching",
})<{ isFetching?: boolean }>(({ theme, isFetching }) => ({
	borderRadius: 8,
	textTransform: "none",
	paddingLeft: theme.spacing(2),
	paddingRight: theme.spacing(2),
	fontWeight: 500,
	minWidth: "80px",
	position: "relative",
	transition: "all 0.2s",
	"&:hover": {
		transform: "translateY(-2px)",
	},
	...(isFetching
		? {
				backgroundColor: alpha(theme.palette.primary.main, 0.04),
			}
		: {}),
}));

const LoadingIndicator = styled(Box)(({ theme }) => ({
	width: "100%",
	height: 2,
	position: "absolute",
	bottom: 0,
	left: 0,
	backgroundColor: theme.palette.primary.main,
	animation: "pulse 1.5s infinite",
	"@keyframes pulse": {
		"0%": { opacity: 0.4 },
		"50%": { opacity: 0.8 },
		"100%": { opacity: 0.4 },
	},
}));

const ContentContainer = styled(Box)({
	flexGrow: 1,
	display: "flex",
	flexDirection: "column",
	position: "relative",
	minHeight: "300px",
});

const LoadingOverlay = styled(Box)(({ theme }) => ({
	position: "absolute",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	backgroundColor: alpha(theme.palette.background.paper, 0.7),
	zIndex: 1,
	borderRadius: 16,
}));

const StyledAlert = styled(Alert)(({ theme }) => ({
	marginBottom: theme.spacing(2),
	borderRadius: 16,
	boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
}));

const EmptyStateContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	flexGrow: 1,
	padding: theme.spacing(4),
	marginTop: theme.spacing(4),
	marginBottom: theme.spacing(4),
	borderRadius: 24,
	backgroundColor: theme.palette.background.default,
}));

const EmptyStateText = styled(Typography)(({ theme }) => ({
	marginBottom: theme.spacing(2),
	textAlign: "center",
	maxWidth: "80%",
	lineHeight: 1.6,
}));

const AgentListContainer = styled(Box)({
	flexGrow: 1,
	overflow: "auto",
	paddingLeft: 4,
	paddingRight: 4,
	paddingTop: 8,
	paddingBottom: 8,
	marginLeft: -4,
	marginRight: -4,
	"&::-webkit-scrollbar": {
		width: "6px",
	},
	"&::-webkit-scrollbar-track": {
		backgroundColor: "transparent",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: "rgba(0, 0, 0, 0.1)",
		borderRadius: "10px",
		"&:hover": {
			backgroundColor: "rgba(0, 0, 0, 0.2)",
		},
	},
});

const PaginationContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "center",
	marginTop: theme.spacing(3),
	paddingTop: theme.spacing(2),
	borderTop: "1px solid",
	borderColor: theme.palette.divider,
}));

const StyledPagination = styled(Pagination)({
	"& .MuiPaginationItem-root": {
		borderRadius: 12,
		marginLeft: 4,
		marginRight: 4,
	},
});

/**
 * Agent List Component
 *
 * Displays a list of agents with loading, error, and empty states
 */
export const AgentList: FC<AgentListProps> = ({
	onSelectAgent,
	selectedAgentId,
}) => {
	const [page, setPage] = useState(1);
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const perPage = 10;

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

	const handlePageChange = (_event: ChangeEvent<unknown>, value: number) => {
		setPage(value);
	};

	const handleSelectAgent = (agent: AgentDetails) => {
		if (onSelectAgent) {
			onSelectAgent(agent);
		}
	};

	// Handler for opening the create agent dialog
	const handleOpenCreateDialog = () => {
		setIsCreateDialogOpen(true);
	};

	// Handler for closing the create agent dialog
	const handleCloseCreateDialog = () => {
		setIsCreateDialogOpen(false);
	};

	// Handler for when an agent is created
	const handleAgentCreated = (agentId: string) => {
		// Fetch the agent details to get the full agent object
		const fetchAndSelectAgent = async () => {
			try {
				// Create a client to fetch the agent details directly
				const client = createLocalOperatorClient(apiConfig.baseUrl);
				const response = await client.agents.getAgent(agentId);

				if (response.status >= 400) {
					throw new Error(
						response.message || `Failed to fetch agent ${agentId}`,
					);
				}

				// Select the newly created agent if a selection handler is provided
				if (response.result && onSelectAgent) {
					onSelectAgent(response.result);
				}

				// Then refetch the agents list to update the UI
				refetch();
			} catch (error) {
				console.error("Error fetching agent details:", error);
				// Still refetch the list even if there was an error
				refetch();
			}
		};

		fetchAndSelectAgent();
	};

	return (
		<StyledPaper elevation={0}>
			<HeaderContainer>
				<HeaderTitle variant="h5">Agents</HeaderTitle>

				<ButtonsContainer>
					<CreateButton
						variant="contained"
						color="primary"
						size="small"
						startIcon={<FontAwesomeIcon icon={faPlus} />}
						onClick={handleOpenCreateDialog}
					>
						New Agent
					</CreateButton>

					<RefreshButton
						variant="outlined"
						color="primary"
						onClick={() => refetch()}
						disabled={isLoading || isFetching}
						size="small"
						isFetching={isFetching}
					>
						Refresh
						{/* Inline loading indicator that doesn't affect layout */}
						{isFetching && (
							<Box
								sx={{
									position: "absolute",
									top: 0,
									left: 0,
									right: 0,
									bottom: 0,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									pointerEvents: "none",
								}}
							>
								<LoadingIndicator />
							</Box>
						)}
					</RefreshButton>
				</ButtonsContainer>
			</HeaderContainer>

			<ContentContainer>
				{/* Loading overlay that doesn't affect layout - only show full overlay on initial load */}
				{(isLoading || (isFetching && stableAgents.length === 0)) && (
					<LoadingOverlay>
						<CircularProgress size={40} thickness={4} />
					</LoadingOverlay>
				)}

				{isError ? (
					<StyledAlert
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
					</StyledAlert>
				) : displayAgents.length === 0 ? (
					<EmptyStateContainer>
						<EmptyStateText variant="body1" color="text.secondary">
							No agents found. Create a new agent to get started.
						</EmptyStateText>
					</EmptyStateContainer>
				) : (
					<AgentListContainer>
						{displayAgents.map((agent) => (
							<AgentListItem
								key={agent.id}
								agent={agent}
								isSelected={agent.id === selectedAgentId}
								onClick={() => handleSelectAgent(agent)}
								onAgentDeleted={(deletedId) => {
									// If the deleted agent was selected, clear the selection
									if (deletedId === selectedAgentId && onSelectAgent) {
										// Set selected agent to null
										// Using undefined here since the function expects AgentDetails
										// but we want to clear the selection
										onSelectAgent(undefined as unknown as AgentDetails);
									}
									refetch();
								}}
							/>
						))}

						{displayAgents.length > perPage && (
							<PaginationContainer>
								<StyledPagination
									count={Math.ceil(displayAgents.length / perPage)}
									page={page}
									onChange={handlePageChange}
									color="primary"
									size="medium"
									shape="rounded"
								/>
							</PaginationContainer>
						)}
					</AgentListContainer>
				)}
			</ContentContainer>

			{/* Create Agent Dialog */}
			<CreateAgentDialog
				open={isCreateDialogOpen}
				onClose={handleCloseCreateDialog}
				onAgentCreated={handleAgentCreated}
			/>
		</StyledPaper>
	);
};
