/**
 * Agents Page Component
 *
 * Main page for displaying and managing agents with enhanced UI/UX
 * Uses React Router for navigation and state management
 */

import { faRobot } from "@fortawesome/free-solid-svg-icons";
import { Box, Grid } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { AgentDetails } from "@renderer/api/local-operator/types";
import { useAgent } from "@renderer/hooks/use-agents";
import { useAgentRouteParam } from "@renderer/hooks/use-route-params";
import { useEffect, useState, useRef } from "react";
import type { FC } from "react";
import { PageHeader } from "../common/page-header";
import { AgentList } from "./agent-list";
import { AgentSettings } from "./agent-settings";

/**
 * Props for the AgentsPage component
 * No props needed as we use React Router hooks internally
 */
type AgentsPageProps = Record<string, never>;

const PageContainer = styled(Box)(({ theme }) => ({
	flexGrow: 1,
	height: "100%",
	overflow: "hidden",
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

/**
 * Agents Page Component
 *
 * Main page for displaying and managing agents with enhanced UI/UX
 * Uses React Router for navigation and state management
 */
export const AgentsPage: FC<AgentsPageProps> = () => {
	const { agentId, navigateToAgent } = useAgentRouteParam();
	// Use a ref to track the previous agent ID to prevent unnecessary renders
	const prevAgentIdRef = useRef<string | undefined>(agentId);
	
	// Maintain stable agent state to prevent flickering during transitions
	const [selectedAgent, setSelectedAgent] = useState<AgentDetails | null>(null);

	// Fetch the agent details if agentId is provided from URL
	const { data: initialAgent, refetch: refetchAgent } = useAgent(agentId);

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
				setSelectedAgent(prev => {
					if (!prev || prev.id !== initialAgent.id) return initialAgent;
					return { ...prev, ...initialAgent };
				});
			}
		}
	}, [initialAgent, agentId]);

	const handleSelectAgent = (agent: AgentDetails) => {
		// First update local state to prevent flickering
		setSelectedAgent(agent);
		// Then update URL (this will trigger a re-render, but our useEffect will handle it properly)
		navigateToAgent(agent.id, 'agents');
	};

	return (
		<PageContainer>
			<PageHeader
				title="Agent Management"
				icon={faRobot}
				subtitle="View, configure and manage your AI agents from a central dashboard"
			/>

			<Grid container spacing={4} sx={{ flexGrow: 1, overflow: "hidden" }}>
				{/* Agent List */}
				<Grid item xs={12} md={5} lg={4} sx={{ height: "100%" }}>
					<AgentList
						onSelectAgent={handleSelectAgent}
						selectedAgentId={selectedAgent?.id}
					/>
				</Grid>

				{/* Agent Details */}
				<Grid item xs={12} md={7} lg={8} sx={{ height: "100%" }}>
					<Box sx={{ 
						height: "100%", 
						transition: "opacity 0.15s ease-in-out",
						opacity: selectedAgent ? 1 : 0.7
					}}>
						<AgentSettings
							selectedAgent={selectedAgent}
							refetchAgent={refetchAgent}
							initialSelectedAgentId={agentId}
						/>
					</Box>
				</Grid>
			</Grid>
		</PageContainer>
	);
};
