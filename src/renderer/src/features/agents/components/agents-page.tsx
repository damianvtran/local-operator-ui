/**
 * Agents Page Component
 *
 * Main page for displaying and managing agents.
 * Uses React Router for navigation and state management.
 * A fixed-width agent list sits beside the settings for the selected agent.
 */

import type { AgentDetails } from "@shared/api/local-operator/types";
import { PageHeader } from "@shared/components/common/page-header";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import {
	useExportAgent,
	useUploadAgentToRadientMutation,
} from "@shared/hooks/use-agent-mutations";
import { useAgent } from "@shared/hooks/use-agents";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useAgentRouteParam } from "@shared/hooks/use-route-params";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import {
	Bot,
	CloudUpload,
	Ellipsis,
	FileUp,
	MessageSquare,
} from "lucide-react";
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

/**
 * Agents Page Component
 *
 * Main page for displaying and managing agents.
 * Uses React Router for navigation and state management.
 * Layout follows the pattern of other pages with a sidebar and content area.
 */
export const AgentsPage: FC<AgentsPageProps> = () => {
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

	return (
		<div className="flex h-full w-full overflow-hidden">
			{/* The sidebar itself is width:100% — the 280px lives here, and the
			    pane must not shrink when the agent list has a long name in it. */}
			<div className="h-full w-70 shrink-0">
				<AgentsSidebar
					selectedAgentId={selectedAgent?.id}
					onSelectAgent={handleSelectAgent}
				/>
			</div>

			{/* `grow` rather than `flex-1`: the content pane keeps an auto basis so
			    it fills the space the sidebar leaves, and `overflow-hidden` is what
			    keeps its scrolling inside the pane instead of the window. */}
			<div className="h-full grow overflow-hidden">
				{/* `gap-8`: `PageHeader` no longer ships its own bottom margin. The
				    header sits in the same measured column as the settings below it,
				    so the page title and the fields it heads share one left edge. */}
				<div className="flex h-full flex-col gap-8 p-4 sm:p-6 lg:p-8">
					<div className="mx-auto w-full max-w-4xl">
						<PageHeader
							title="Agent management"
							icon={Bot}
							subtitle="View, configure and manage your agents"
						>
							{selectedAgent && (
								<div className="flex items-center gap-2">
									{/*
									 * The two secondary actions collapse into a menu once the
									 * header has less than 400px to work with. `PageHeader`
									 * already wraps them onto a line of their own, and the
									 * three buttons need about 360px side by side, so 400 is
									 * the width below which wrapping stops being enough and
									 * they would be clipped by the page's `overflow-hidden`.
									 * The threshold is on the header's own width because the
									 * app rail and the agent list between it and the window
									 * edge both collapse independently of the viewport.
									 *
									 * These same two actions are already in the menu on every
									 * row of the agent list, so folding them here repeats an
									 * affordance the user has met rather than inventing one.
									 */}
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												/*
												 * Carries the tour tag as well as the wide button
												 * does: exactly one of the two is rendered at any
												 * width, and the tour resolves whichever the user
												 * can actually see. Anchoring only the wide one
												 * left the spotlight attached to a `display:none`
												 * element for the whole 800-950px band the
												 * window's own minWidth floors the app to.
												 */
												data-tour-tag="upload-to-hub-header-button"
												variant="secondary"
												size="icon"
												aria-label="More agent actions"
												className="@min-[400px]:hidden"
											>
												<Ellipsis aria-hidden="true" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="min-w-45">
											<DropdownMenuItem
												disabled={exportAgentMutation.isPending}
												onSelect={handleExportAgent}
											>
												<FileUp aria-hidden="true" />
												<span>Export</span>
											</DropdownMenuItem>
											<DropdownMenuItem
												disabled={uploadAgentMutation.isPending}
												onSelect={handleOpenUploadDialog}
											>
												<CloudUpload aria-hidden="true" />
												<span>
													{uploadAgentMutation.isPending
														? "Uploading..."
														: "Upload to hub"}
												</span>
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>

									<Button
										variant="secondary"
										onClick={handleExportAgent}
										disabled={exportAgentMutation.isPending}
										className="hidden @min-[400px]:inline-flex"
									>
										<FileUp aria-hidden="true" />
										Export
									</Button>

									<Button
										data-tour-tag="upload-to-hub-header-button"
										/*
										 * A second, action-specific tag. The tour tag now sits
										 * on two controls so the spotlight can find whichever
										 * is visible, but they do different things: this one
										 * opens the upload dialog, the overflow trigger opens
										 * a menu. `click()` does not need visibility, so the
										 * tour presses THIS one for the action and anchors to
										 * the visible one for the highlight.
										 */
										data-tour-action="open-upload-dialog"
										variant="secondary"
										onClick={handleOpenUploadDialog}
										disabled={uploadAgentMutation.isPending}
										className="hidden @min-[400px]:inline-flex"
									>
										<CloudUpload aria-hidden="true" />
										{uploadAgentMutation.isPending
											? "Uploading..."
											: "Upload to hub"}
									</Button>

									{/* The only tooltip here: it names the agent, which the
								    button label cannot. */}
									<Tooltip
										content={`Chat with ${selectedAgent.name || "this agent"}`}
									>
										<Button
											variant="primary"
											onClick={() => navigate(`/chat/${selectedAgent.id}`)}
										>
											<MessageSquare aria-hidden="true" />
											Chat
										</Button>
									</Tooltip>
								</div>
							)}
						</PageHeader>
					</div>

					<div className="min-h-0 grow overflow-hidden">
						<AgentSettings
							selectedAgent={selectedAgent ?? null}
							refetchAgent={refetchAgent}
							initialSelectedAgentId={agentId}
						/>
					</div>
				</div>
			</div>

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
		</div>
	);
};
