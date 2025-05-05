/**
 * Add Agent Step Component
 *
 * Sixth step in the onboarding process that allows the user to add recommended AI agents
 * from a curated list.
 */

import { faDownload } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	CircularProgress,
	Grid,
	Typography,
	styled,
	Chip,
} from "@mui/material";
import type { Agent } from "@shared/api/radient/types";
import { AgentCard } from "@features/agent-hub/components/agent-card";
import { useDownloadAgentMutation } from "@features/agent-hub/hooks/use-download-agent-mutation";
import { usePublicAgentsQuery } from "@features/agent-hub/hooks/use-public-agents-query";
import { useAgents } from "@shared/hooks/use-agents";
import { CheckCircle } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import {
	EmojiContainer,
	SectionContainer,
	SectionDescription,
	SectionTitle,
} from "../onboarding-styled";

const RECOMMENDED_AGENT_COUNT = 8;

const StyledGridContainer = styled(Grid)(({ theme }) => ({
	overflowY: "auto",
	padding: theme.spacing(2, 0), 
	height: 400,
  maxHeight: 400,
	flexGrow: 1,
	width: "100%", 
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor:
			theme.palette.mode === "dark"
				? "rgba(255, 255, 255, 0.1)"
				: "rgba(0, 0, 0, 0.2)",
		borderRadius: "4px",
	},
}));

type CreateAgentStepProps = {
	/** Callback to inform the parent modal about the step's validity */
	onValidityChange: (isValid: boolean) => void;
};

/**
 * Add agent step in the onboarding process. Displays recommended agents to add.
 */
export const CreateAgentStep: FC<CreateAgentStepProps> = ({
	onValidityChange,
}) => {
	const { data: localAgentsData } = useAgents(); // Get local agents to check if added
	const downloadAgentMutation = useDownloadAgentMutation();

	// State to track agents added during this session
	const [addedAgentIds, setAddedAgentIds] = useState<Set<string>>(new Set());
	const [isAddingAll, setIsAddingAll] = useState(false);

	// Fetch recommended public agents (top 8)
	const {
		data: agentsData,
		isLoading: isLoadingAgents,
		error: agentsError,
	} = usePublicAgentsQuery({
		page: 1,
		perPage: RECOMMENDED_AGENT_COUNT,
	});

	const recommendedAgents: Agent[] = agentsData?.records ?? [];

	// Update addedAgentIds based on localAgentsData changes
	useEffect(() => {
		// Ensure localAgentsData and its 'agents' property exist
		if (localAgentsData?.agents) {
			const localIds = new Set(localAgentsData.agents.map((agent) => agent.id));
			// Filter recommended agents to find those already present locally
			const newlyAdded = recommendedAgents
				.filter((agent) => localIds.has(agent.id))
				.map((agent) => agent.id);

			// Update state, preserving any agents added *during this step*
			// that might not yet be reflected in localAgentsData if query hasn't refetched
			setAddedAgentIds((prev) => new Set([...prev, ...newlyAdded]));
		}

		// Add agent ID to state upon successful download
		if (downloadAgentMutation.isSuccess && downloadAgentMutation.variables?.agentId) {
			setAddedAgentIds((prev) => new Set(prev).add(downloadAgentMutation.variables.agentId));
		}
	}, [
		localAgentsData,
		recommendedAgents,
		downloadAgentMutation.isSuccess,
		downloadAgentMutation.variables?.agentId, // Depend on the specific agentId from variables
	]);

	// Removed handleAddAgent as AgentCard handles its own download click

	const handleAddRecommended = async () => {
		if (isAddingAll || downloadAgentMutation.isPending) return;
		setIsAddingAll(true);
		// Filter agents that are not already added locally or in the process of being added
		const agentsToAdd = recommendedAgents.filter(
			(agent) => !addedAgentIds.has(agent.id),
		);

		// Use Promise.all for potentially faster downloads, but process sequentially if API limits are a concern
		// For simplicity, sequential download is shown here.
		try {
			for (const agent of agentsToAdd) {
				// Check again inside the loop in case it was added individually
				if (
					!addedAgentIds.has(agent.id) &&
					downloadAgentMutation.variables?.agentId !== agent.id // Ensure not currently adding this one
				) {
					try {
						// Use the mutation from AgentCard's hook, passing the correct object
						await downloadAgentMutation.mutateAsync({
							agentId: agent.id,
							agentName: agent.name, // Pass name for potential use by mutation
						});
						// Update state immediately after successful mutation for this agent
						setAddedAgentIds((prev) => new Set(prev).add(agent.id));
					} catch (agentErr) {
						console.error(`Failed to download agent ${agent.name}:`, agentErr);
						// Optionally break or continue on individual agent failure
					}
				}
			}
		} catch (err) {
			// This catch block might be less likely to be hit with individual try/catches
			console.error("Failed to add all recommended agents:", err);
		} finally {
			setIsAddingAll(false);
		}
	};

	// Removed unused handleProceed function

	const hasAddedAgents = addedAgentIds.size > 0;

	// Effect to notify parent about validity change
	useEffect(() => {
		onValidityChange(hasAddedAgents);
	}, [hasAddedAgents, onValidityChange]);

	return (
		<SectionContainer sx={{ display: "flex", flexDirection: "column" }}>
			<SectionTitle>
				<EmojiContainer sx={{ mb: 0 }}>🤖</EmojiContainer> Add Your First AI
				Assistants
			</SectionTitle>
			<SectionDescription>
				Select from our recommended agents to get started quickly, or click the quick start button to
				have us set up a team for you from the most popular agents. You can always add more later from the Agent Hub.
			</SectionDescription>

			{/* Add Recommended Button */}
			<Box sx={{ my: 2, display: "flex", justifyContent: "center" }}>
				<Button
					variant="outlined"
					onClick={handleAddRecommended}
					disabled={
						isLoadingAgents ||
						isAddingAll ||
						recommendedAgents.every((agent) => addedAgentIds.has(agent.id))
					}
					startIcon={
						isAddingAll ? (
							<CircularProgress size={20} color="inherit" />
						) : (
							<FontAwesomeIcon icon={faDownload} />
						)
					}
				>
					{isAddingAll
						? "Adding..."
						: "Setup My Team For Me"}
				</Button>
			</Box>

			{/* Agent Grid */}
			<Box sx={{ flexGrow: 1, minHeight: 0, width: "100%" }}>
				{isLoadingAgents && (
					<Box
						display="flex"
						justifyContent="center"
						alignItems="center"
						flexGrow={1}
						sx={{ height: "300px" }} // Ensure loading takes space
					>
						<CircularProgress />
					</Box>
				)}
				{agentsError && (
					<Box
						display="flex"
						justifyContent="center"
						alignItems="center"
						flexGrow={1}
						sx={{ height: "300px" }} // Ensure error takes space
					>
						<Typography color="error">
							Failed to load recommended agents: {agentsError.message}
						</Typography>
					</Box>
				)}
				{!isLoadingAgents && !agentsError && (
					<StyledGridContainer container spacing={2}>
						{recommendedAgents.length === 0 ? (
							<Grid item xs={12}>
								<Typography variant="body1" align="center">
									No recommended agents found. You can proceed or add agents
									later.
								</Typography>
							</Grid>
						) : (
							recommendedAgents.map((agent) => (
								<Grid item key={agent.id} xs={12} sm={6} md={6} lg={4}>
									{/* Wrap AgentCard to show added state */}
									<Box
										sx={{
											position: "relative",
											opacity: addedAgentIds.has(agent.id) ? 0.6 : 1,
											pointerEvents: addedAgentIds.has(agent.id)
												? "none"
												: "auto",
											transition: "opacity 0.3s ease",
										}}
									>
										<AgentCard
											agent={agent}
											isLiked={false} 
											isFavourited={false} 
											onLikeToggle={() => {}} 
											onFavouriteToggle={() => {}} 
											showActions={false} 
										/>
										{/* Show loading spinner on the specific card being added */}
										{downloadAgentMutation.isPending &&
											downloadAgentMutation.variables?.agentId ===
												agent.id && (
												<CircularProgress
													size={24}
													sx={{
														position: "absolute",
														top: "50%",
														left: "50%",
														marginTop: "-12px",
														marginLeft: "-12px",
														zIndex: 2,
													}}
												/>
											)}
										{/* Show checkmark overlay if added */}
										{addedAgentIds.has(agent.id) && (
											<Chip
												icon={<CheckCircle size={16} />}
												label="Added"
												size="small"
												color="success"
												sx={{
													position: "absolute",
													top: 12,
													right: 12,
													zIndex: 2,
													backgroundColor: (theme) =>
														theme.palette.success.main,
													color: (theme) =>
														theme.palette.success.contrastText,
													".MuiChip-icon": {
														color: "inherit",
													},
												}}
											/>
										)}
									</Box>
								</Grid>
							))
						)}
					</StyledGridContainer>
				)}
			</Box>
		</SectionContainer>
	);
};
