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
import { useEffect, useState } from "react";
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
	const [selectedAgent, setSelectedAgent] = useState<AgentDetails | null>(null);

	// Fetch the agent details if agentId is provided from URL
	const { data: initialAgent, refetch: refetchAgent } = useAgent(agentId);

	// Set the selected agent when initialAgent changes, but only if it's not already selected
	// This prevents unnecessary re-renders during refetches
	useEffect(() => {
		if (
			initialAgent &&
			(!selectedAgent || selectedAgent.id !== initialAgent.id)
		) {
			setSelectedAgent(initialAgent);
		} else if (
			initialAgent &&
			selectedAgent &&
			selectedAgent.id === initialAgent.id
		) {
			// If the same agent is already selected, just update its properties
			// This maintains UI consistency during refetches
			setSelectedAgent((prevAgent) => {
				if (!prevAgent) return initialAgent;
				return {
					...prevAgent,
					...initialAgent,
				};
			});
		}
	}, [initialAgent, selectedAgent]);

	const handleSelectAgent = (agent: AgentDetails) => {
		setSelectedAgent(agent);
		// Update URL to reflect selected agent
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
					<AgentSettings
						selectedAgent={selectedAgent}
						refetchAgent={refetchAgent}
						initialSelectedAgentId={agentId}
					/>
				</Grid>
			</Grid>
		</PageContainer>
	);
};
