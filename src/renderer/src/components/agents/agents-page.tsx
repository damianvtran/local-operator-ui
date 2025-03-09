/**
 * Agents Page Component
 *
 * Main page for displaying and managing agents with enhanced UI/UX
 * Uses React Router for navigation and state management
 * Layout follows the pattern of other pages with a sidebar and content area
 */

import { faRobot } from "@fortawesome/free-solid-svg-icons";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { AgentDetails } from "@renderer/api/local-operator/types";
import { useAgent, useAgents } from "@renderer/hooks/use-agents";
import { useAgentRouteParam } from "@renderer/hooks/use-route-params";
import { useAgentSelectionStore } from "@renderer/store/agent-selection-store";
import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
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
	// Use a ref to track the previous agent ID to prevent unnecessary renders
	const prevAgentIdRef = useRef<string | undefined>(agentId);

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
					<PageHeader
						title="Agent Management"
						icon={faRobot}
						subtitle="View, configure and manage your AI agents from a central dashboard"
					/>

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
