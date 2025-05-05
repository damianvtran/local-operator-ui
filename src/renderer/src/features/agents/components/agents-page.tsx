/**
 * Agents Page Component
 *
 * Main page for displaying and managing agents with enhanced UI/UX
 * Uses React Router for navigation and state management
 * Layout follows the pattern of other pages with a sidebar and content area
 */

import { Box, Button, Tooltip } from "@mui/material";
import { styled, useTheme } from "@mui/material/styles";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { PageHeader } from "@shared/components/common/page-header";
import {
	useExportAgent,
	useUploadAgentToRadientMutation,
} from "@shared/hooks/use-agent-mutations";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useAgent, useAgents } from "@shared/hooks/use-agents";
import { useAgentRouteParam } from "@shared/hooks/use-route-params";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";
import { AgentSettings } from "./agent-settings";
import { AgentsSidebar } from "./agents-sidebar";
import { UploadAgentDialog } from "./upload-agent-dialog";
import { Bot, CloudUpload, MessageCircle, FileUp } from "lucide-react";

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
	const theme = useTheme(); // Get theme for button styles
	const { agentId, navigateToAgent, clearAgentId } = useAgentRouteParam();
	const navigate = useNavigate();
	const { isAuthenticated } = useRadientAuth(); // Get auth status
	const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false); // State for dialog

	// Use a ref to track the previous agent ID to prevent unnecessary renders
	const prevAgentIdRef = useRef<string | undefined>(agentId);

	// Export agent mutation
	const exportAgentMutation = useExportAgent();
	// Upload agent mutation
	const uploadAgentMutation = useUploadAgentToRadientMutation();

	// Get agent selection store functions
	const { setLastAgentsPageAgentId, getLastAgentId, clearLastAgentId } =
		useAgentSelectionStore();

	// Fetch all agents to check if the selected agent exists
	// Correctly destructure the agents array from the result object
	const { data: agentListResult } = useAgents();
	const agents = agentListResult?.agents || []; // Extract the agents array

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
		// Include cleanup functions in dependencies, matching chat-page.tsx pattern
	}, [effectiveAgentId, agents, clearLastAgentId, clearAgentId]);

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
			a.download = `${selectedAgent.name.replace(/\s+/g, "-").toLowerCase()}-lo-agent.zip`;
			document.body.appendChild(a);
			a.click();

			URL.revokeObjectURL(url);
			document.body.removeChild(a);
		} catch (error) {
			console.error("Failed to export agent:", error);
		}
	};

	// Handlers for the Upload Dialog
	const handleOpenUploadDialog = () => {
		// Reset agreement state inside the dialog component now
		setIsUploadDialogOpen(true);
	};

	const handleCloseUploadDialog = () => {
		setIsUploadDialogOpen(false);
	};

	const handleConfirmUpload = () => {
		if (!selectedAgent || !isAuthenticated) return;

		// Call the actual upload mutation
		uploadAgentMutation.mutateAsync(selectedAgent.id);
		handleCloseUploadDialog(); // Close dialog after initiating upload
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

	const buttonSx = {
		textTransform: "none",
		fontSize: "0.8125rem",
		padding: theme.spacing(0.5, 1.5),
		borderRadius: theme.shape.borderRadius * 0.75,
	};

	const secondaryButtonSx = {
		...buttonSx,
		borderColor: theme.palette.divider,
		color: theme.palette.text.secondary,
		"&:hover": {
			backgroundColor: theme.palette.action.hover,
			borderColor: theme.palette.divider,
		},
	};

	const primaryButtonSx = {
		...buttonSx,
		"&:hover": {
			backgroundColor: theme.palette.action.hover,
			borderColor: theme.palette.divider,
		},
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
					{/* Page Header with Action Buttons as Children */}
					<PageHeader
						title="Agent Management"
						icon={Bot}
						subtitle="View, configure and manage your AI agents from a central dashboard"
					>
						{/* Action buttons passed as children */}
						{selectedAgent && (
							<Box sx={{ display: "flex", gap: 1 }}>
								<Tooltip title="Export Agent">
									<Button
										variant="outlined"
										size="small"
										startIcon={
											<FileUp size={16} strokeWidth={2} />
										}
										onClick={handleExportAgent}
										disabled={exportAgentMutation.isPending}
										sx={secondaryButtonSx} 
									>
										Export
									</Button>
								</Tooltip>

								{/* Upload to Agent Hub Button */}
								<Tooltip title="Upload Agent to Hub">
									<Button
										variant="outlined"
										size="small"
										startIcon={
											<CloudUpload size={16} strokeWidth={2} />
										}
										onClick={handleOpenUploadDialog}
										disabled={uploadAgentMutation.isPending} // Disable button while uploading
										sx={secondaryButtonSx}
									>
										{uploadAgentMutation.isPending
											? "Uploading..."
											: "Upload to Hub"}
									</Button>
								</Tooltip>

								<Tooltip
									title={`Chat with ${selectedAgent?.name || "this Agent"}`}
								>
									<Button
										variant="outlined"
										color="primary"
										size="small"
										startIcon={<MessageCircle size={16} strokeWidth={2} />}
										onClick={() => navigate(`/chat/${selectedAgent.id}`)}
										sx={primaryButtonSx}
									>
										Chat
									</Button>
								</Tooltip>
							</Box>
						)}
					</PageHeader>

					{/* Agent Details Section */}
					<AgentDetailsContainer sx={{ opacity: selectedAgent ? 1 : 0.7 }}>
						<AgentSettings
							selectedAgent={selectedAgent}
							refetchAgent={refetchAgent}
							initialSelectedAgentId={agentId}
						/>
					</AgentDetailsContainer>
				</ContentInnerContainer>
			</ContentContainer>

			{/* Render the Upload Confirmation Dialog */}
			{selectedAgent && (
				<UploadAgentDialog
					open={isUploadDialogOpen}
					onClose={handleCloseUploadDialog}
					agentName={selectedAgent.name}
					isAuthenticated={isAuthenticated}
					onConfirmUpload={handleConfirmUpload}
					// Optional: Add handler if sign-in inside dialog needs specific action
					// onSignInSuccess={() => { /* Maybe refetch auth status or close dialog */ }}
				/>
			)}
		</Container>
	);
};
