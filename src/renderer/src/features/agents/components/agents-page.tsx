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
import { useAgent } from "@shared/hooks/use-agents";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useAgentRouteParam } from "@shared/hooks/use-route-params";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import { Bot, CloudUpload, FileUp, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";
import { AgentSettings } from "./agent-settings";
import { AgentsSidebar } from "./agents-sidebar";
import { UploadAgentDialog } from "./upload-agent-dialog";

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
	const { agentId, navigateToAgent } = useAgentRouteParam();
	const navigate = useNavigate();
	const { isAuthenticated } = useRadientAuth(); // Get auth status
	const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false); // State for dialog
	const [uploadValidationIssues, setUploadValidationIssues] = useState<
		string[]
	>([]);

	// Export agent mutation
	const exportAgentMutation = useExportAgent();
	// Upload agent mutation
	const uploadAgentMutation = useUploadAgentToRadientMutation();

	// Get agent selection store functions
	const { setLastAgentsPageAgentId, getLastAgentId } = useAgentSelectionStore();

	// Use the agent ID from URL or the last selected agent ID
	const effectiveAgentId = agentId || getLastAgentId("agents");

	// Fetch the agent details if agentId is provided from URL
	const { data: selectedAgent, refetch: refetchAgent } = useAgent(
		effectiveAgentId || undefined,
	);

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

	// Validation for agent upload
	const getAgentUploadValidationIssues = (
		agent: AgentDetails | null,
	): string[] => {
		if (!agent) return ["No agent selected."];
		const issues: string[] = [];
		if (!agent.name || agent.name.trim() === "")
			issues.push("Name is required.");
		if (!agent.description || agent.description.trim() === "")
			issues.push("Description is required.");
		// Accept both category and categories (array or string), but require at least one
		const hasCategory = agent.categories && agent.categories.length > 0;
		if (!hasCategory) issues.push("At least one category is required.");
		return issues;
	};

	// Handlers for the Upload Dialog
	const handleOpenUploadDialog = () => {
		const issues = getAgentUploadValidationIssues(selectedAgent ?? null);
		setUploadValidationIssues(issues);
		setIsUploadDialogOpen(true);
	};

	const handleCloseUploadDialog = () => {
		setIsUploadDialogOpen(false);
		setUploadValidationIssues([]);
	};

	const handleConfirmUpload = () => {
		if (!selectedAgent || !isAuthenticated) return;

		// Call the actual upload mutation
		uploadAgentMutation.mutateAsync(selectedAgent.id);
		handleCloseUploadDialog(); // Close dialog after initiating upload
	};

	const handleSelectAgent = (agent: AgentDetails) => {
		setLastAgentsPageAgentId(agent.id);
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
										startIcon={<FileUp size={16} strokeWidth={2} />}
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
										data-tour-tag="upload-to-hub-header-button"
										variant="outlined"
										size="small"
										startIcon={<CloudUpload size={16} strokeWidth={2} />}
										onClick={handleOpenUploadDialog}
										disabled={uploadAgentMutation.isPending}
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
							selectedAgent={selectedAgent ?? null}
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
					agentName={selectedAgent?.name ?? ""}
					isAuthenticated={isAuthenticated}
					onConfirmUpload={handleConfirmUpload}
					validationIssues={uploadValidationIssues}
				/>
			)}
		</Container>
	);
};
