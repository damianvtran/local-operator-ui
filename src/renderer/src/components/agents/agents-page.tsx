/**
 * Agents Page Component
 *
 * Main page for displaying and managing agents with enhanced UI/UX
 * Uses React Router for navigation and state management
 * Layout follows the pattern of other pages with a sidebar and content area
 */

import {
	faComment,
	faFileExport,
	faRobot,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Button, Tooltip, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { AgentDetails } from "@renderer/api/local-operator/types";
import { useAgent, useAgents } from "@renderer/hooks/use-agents";
import { useExportAgent } from "@renderer/hooks/use-agent-mutations";
import { useAgentRouteParam } from "@renderer/hooks/use-route-params";
import { useAgentSelectionStore } from "@renderer/store/agent-selection-store";
import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../common/page-header";
import { AgentSettings } from "./agent-settings";
import { AgentsSidebar } from "./agents-sidebar";

/**
 * Props for the AgentsPage component
 * No props needed as we use React Router hooks internally
 */
type AgentsPageProps = Record<string, never>;

const Container = styled(Box)({
	display: "flex",
	height: "100%",
	width: "100%",
	overflow: "hidden",
});

const SidebarContainer = styled(Box)({
	flexShrink: 0,
	width: 280,
	height: "100%",
});

const ContentContainer = styled(Box)({
	flexGrow: 1,
	height: "100%",
	overflow: "hidden",
});

const ContentInnerContainer = styled(Box)(({ theme }) => ({
	height: "100%",
	display: "flex",
	flexDirection: "column",
	padding: theme.spacing(4),
	gap: theme.spacing(2),
	[theme.breakpoints.down("sm")]: {
		padding: theme.spacing(2),
	},
	[theme.breakpoints.between("sm", "md")]: {
		padding: theme.spacing(3),
	},
}));

const AgentDetailsContainer = styled(Box)({
	flexGrow: 1,
	overflow: "hidden",
	transition: "opacity 0.15s ease-in-out",
});

/**
 * Agents Page Component
 *
 * Main page for displaying and managing agents with enhanced UI/UX
 * Uses React Router for navigation and state management
 * Layout follows the pattern of other pages with a sidebar and content area
 */
export const AgentsPage: FC<AgentsPageProps> = () => {
	const { agentId, navigateToAgent, clearAgentId } = useAgentRouteParam();
	const navigate = useNavigate();
	// Use a ref to track the previous agent ID to prevent unnecessary renders
	const prevAgentIdRef = useRef<string | undefined>(agentId);

	// Export agent mutation
	const exportAgentMutation = useExportAgent();

	// Get agent selection store functions
	const { setLastAgentsPageAgentId, getLastAgentId, clearLastAgentId } =
		useAgentSelectionStore();

	// Fetch all agents to check if the selected agent exists
	const { data: agents = [] } = useAgents();

	// Use the agent ID from URL or the last selected agent ID
	const effectiveAgentId = agentId || getLastAgentId("agents");

	// Maintain stable agent state to prevent flickering during transitions
	const [selectedAgent, setSelectedAgent] = useState<AgentDetails | null>(null);

	// Fetch the agent details if agentId is provided from URL
	const { data: initialAgent, refetch: refetchAgent } = useAgent(
		effectiveAgentId || undefined,
	);

	// Check if the selected agent exists in the list of agents
	// biome-ignore lint/correctness/useExhaustiveDependencies: clearLastAgentId and clearAgentId are intentionally omitted to prevent infinite loops
	useEffect(() => {
		if (effectiveAgentId && agents.length > 0) {
			const agentExists = agents.some((agent) => agent.id === effectiveAgentId);

			if (!agentExists) {
				// If the agent doesn't exist, clear the selection and navigate to the agents page without an agent
				// Use a timeout to break the render cycle and prevent infinite loops
				setTimeout(() => {
					clearLastAgentId("agents");
					clearAgentId("agents");
					setSelectedAgent(null);
				}, 0);
			}
		}
	}, [effectiveAgentId, agents]); // Remove clearLastAgentId and clearAgentId from dependencies

	// Update the last selected agent ID when the agent ID changes
	useEffect(() => {
		if (agentId) {
			setLastAgentsPageAgentId(agentId);
		}
	}, [agentId, setLastAgentsPageAgentId]);

	// Handler for exporting the selected agent
	const handleExportAgent = async () => {
		if (!selectedAgent) return;

		try {
			const blob = await exportAgentMutation.mutateAsync(selectedAgent.id);

			// Create a download link
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${selectedAgent.name.replace(/\s+/g, "-").toLowerCase()}-export.zip`;
			document.body.appendChild(a);
			a.click();

			// Clean up
			URL.revokeObjectURL(url);
			document.body.removeChild(a);
		} catch (error) {
			console.error("Failed to export agent:", error);
		}
	};

	// Update selected agent when URL changes or when agent data is refreshed
	useEffect(() => {
		// Only update if we have agent data
		if (initialAgent) {
			// If this is a new agent selection (URL changed)
			if (agentId !== prevAgentIdRef.current) {
				// Update the ref to track the new agent ID
				prevAgentIdRef.current = agentId;
				// Set the new agent directly
				setSelectedAgent(initialAgent);
			} else {
				// Same agent, just update properties without triggering a full re-render
				setSelectedAgent((prev) => {
					if (!prev || prev.id !== initialAgent.id) return initialAgent;
					return { ...prev, ...initialAgent };
				});
			}
		}
	}, [initialAgent, agentId]);

	const handleSelectAgent = (agent: AgentDetails) => {
		// First update local state to prevent flickering
		setSelectedAgent(agent);
		// Update the last selected agent ID
		setLastAgentsPageAgentId(agent.id);
		// Then update URL (this will trigger a re-render, but our useEffect will handle it properly)
		navigateToAgent(agent.id, "agents");
	};

	return (
		<Container>
			{/* Agents Sidebar - fixed width */}
			<SidebarContainer>
				<AgentsSidebar
					selectedAgentId={selectedAgent?.id}
					onSelectAgent={handleSelectAgent}
				/>
			</SidebarContainer>

			{/* Content Area */}
			<ContentContainer>
				<ContentInnerContainer>
					<Box sx={{ position: "relative", width: "100%", mb: 2 }}>
						<PageHeader
							title="Agent Management"
							icon={faRobot}
							subtitle="View, configure and manage your AI agents from a central dashboard"
						/>

						{selectedAgent && (
							<Box
								sx={{
									position: "absolute",
									top: 0,
									right: 0,
									display: "flex",
									gap: 1,
								}}
							>
								<Tooltip title="Export Agent">
									<Button
										variant="outlined"
										color="primary"
										size="small"
										startIcon={<FontAwesomeIcon icon={faFileExport} />}
										onClick={handleExportAgent}
										disabled={exportAgentMutation.isPending}
										sx={{
											borderRadius: 2,
											textTransform: "none",
											fontWeight: 500,
											transition: "all 0.2s ease-in-out",
											"&:hover": {
												backgroundColor: alpha("#38C96A", 0.08),
												transform: "translateY(-1px)",
											},
										}}
									>
										Export
									</Button>
								</Tooltip>

								<Tooltip
									title={`Chat with ${selectedAgent?.name || "this Agent"}`}
								>
									<Button
										variant="outlined"
										color="primary"
										size="small"
										startIcon={<FontAwesomeIcon icon={faComment} />}
										onClick={() => navigate(`/chat/${selectedAgent.id}`)}
										sx={{
											borderRadius: 2,
											textTransform: "none",
											fontWeight: 500,
											transition: "all 0.2s ease-in-out",
											"&:hover": {
												backgroundColor: alpha("#38C96A", 0.08),
												transform: "translateY(-1px)",
											},
										}}
									>
										Chat
									</Button>
								</Tooltip>
							</Box>
						)}
					</Box>

					<AgentDetailsContainer sx={{ opacity: selectedAgent ? 1 : 0.7 }}>
						<AgentSettings
							selectedAgent={selectedAgent}
							refetchAgent={refetchAgent}
							initialSelectedAgentId={agentId}
						/>
					</AgentDetailsContainer>
				</ContentInnerContainer>
			</ContentContainer>
		</Container>
	);
};
