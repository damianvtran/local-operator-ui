/**
 * Agents sidebar.
 *
 * Search, a paginated agent list, a per-row options menu, and the import and
 * upload-to-hub dialogs.
 */

import { createLocalOperatorClient } from "@shared/api/local-operator";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { AgentOptionsMenu } from "@shared/components/common/agent-options-menu";
import { CompactPagination } from "@shared/components/common/compact-pagination";
import { ImportAgentDialog } from "@shared/components/common/import-agent-dialog";
import { SidebarHeader } from "@shared/components/common/sidebar-header";
import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	AlertDescription,
	Avatar,
	AvatarFallback,
	Button,
	Tooltip,
	TooltipProvider,
} from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import {
	useAgent,
	useAgents,
	useExportAgent,
	usePaginationParams,
} from "@shared/hooks";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { Bot } from "lucide-react";
import type { FC } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadAgentDialog } from "./upload-agent-dialog";

/**
 * The rows truncate, so a tooltip is the only way to read a long name or
 * description — but at the pointer's resting speed they would flash constantly
 * while scanning forty rows. The MUI version bought the quiet with `enterDelay`
 * plus an equal `enterNextDelay`; the equivalent here is one provider for the
 * whole list with a zero skip window, so sweeping from row to row waits the
 * full delay again instead of re-showing instantly.
 */
const ROW_TOOLTIP_DELAY_MS = 1200;

/**
 * Props for the AgentsSidebar component
 */
type AgentsSidebarProps = {
	/** Currently selected agent ID */
	selectedAgentId?: string;
	/** Callback for when an agent is selected */
	onSelectAgent: (agent: AgentDetails) => void;
};

type AgentsSidebarItemProps = {
	agent: AgentDetails;
	isSelected: boolean;
	onSelectAgent: (agent: AgentDetails) => void;
	onChatWithAgent: (agentId: string) => void;
	onExportAgent: (agentId: string) => void;
	onAgentDeleted: (deletedAgentId: string) => void;
	onUploadAgentToHub: (agent: AgentDetails) => void;
};

/**
 * One agent row.
 *
 * ## Why the row has no border
 *
 * Forty rows with an edge each is forty boxes of chrome around a single list.
 * The rows are separated by the gap and, when pointed at or selected, by a
 * ground step — hover takes `elevated`, selection takes the accent wash. That
 * wash is the row's *only* accent spend: the avatar and the name stay neutral,
 * because tinting three things to say one thing spends the screen's accent
 * budget on a state the ground already carries.
 *
 * ## Two lines, not three
 *
 * The row used to carry a third line — a clock glyph and the creation date, on
 * every agent. That is 20px and a second icon per row, repeated down the whole
 * list, for a fact nobody scans a list by; it made a 72px row out of a 52px
 * one and cut the number of agents visible at once by a third. The date is
 * still one click away, in the agent's own information grid, which is where a
 * detail you look up rather than scan belongs.
 *
 * Name at 13px medium over description at 12px dim: two steps apart, so the
 * name leads without needing semibold. A list row is a dense surface, and
 * `text-body-sm` is the step the branding scale names for one.
 *
 * ## Why the options menu is a sibling of the row button
 *
 * It used to be nested inside the `ListItemButton`, which is a button inside a
 * button — invalid, and the menu's clicks had to be stopped from selecting the
 * row. As a sibling positioned over the row's right edge it is a real,
 * independently focusable control. It stays hidden until the row is hovered or
 * something inside it takes focus, so keyboard users can reach it by tabbing
 * (`pointer-events` gates the mouse, never the tab order).
 */
const AgentsSidebarItem: FC<AgentsSidebarItemProps> = ({
	agent,
	isSelected,
	onSelectAgent,
	onChatWithAgent,
	onExportAgent,
	onAgentDeleted,
	onUploadAgentToHub,
}) => {
	const description = agent.description || "No description";

	return (
		<li className="group relative">
			<button
				type="button"
				onClick={() => onSelectAgent(agent)}
				// The selected row is styled *and* announced: colour alone leaves a
				// screen reader with no way to tell which agent is open.
				aria-current={isSelected ? "true" : undefined}
				// Matched by `use-onboarding-tour.ts` on the bare attribute. The value
				// is fixed; changing it breaks the tour silently.
				data-tour-tag="agent-list-item-button"
				className={cn(
					"flex w-full items-center gap-2 rounded-sm py-1.5 pr-9 pl-2 text-left",
					"transition-colors duration-fast ease-out-quart",
					isSelected ? "bg-accent-wash" : "hover:bg-elevated",
				)}
			>
				<Avatar className="size-8 shrink-0">
					<AvatarFallback>
						<Bot size={16} aria-hidden={true} />
					</AvatarFallback>
				</Avatar>
				<span className="min-w-0 flex-1">
					<Tooltip content={agent.name} side="top" align="start">
						<span className="block truncate font-medium text-body-sm text-ink">
							{agent.name}
						</span>
					</Tooltip>
					<Tooltip content={description} side="bottom" align="start">
						<span className="block truncate text-meta text-ink-dim">
							{description}
						</span>
					</Tooltip>
				</span>
			</button>
			<div
				className={cn(
					"pointer-events-none absolute top-0 right-1 flex h-full items-center",
					"opacity-0 transition-opacity duration-fast ease-out-quart",
					"group-hover:pointer-events-auto group-hover:opacity-100",
					"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
				)}
			>
				<Tooltip content="Agent options">
					<span>
						<AgentOptionsMenu
							agentId={agent.id}
							agentName={agent.name}
							isAgentsPage={true}
							onAgentDeleted={() => onAgentDeleted(agent.id)}
							onChatWithAgent={() => onChatWithAgent(agent.id)}
							onExportAgent={() => onExportAgent(agent.id)}
							onUploadAgentToHub={() => onUploadAgentToHub(agent)}
							buttonSx={{
								width: 24,
								height: 24,
								borderRadius: "6px",
								display: "flex",
								justifyContent: "center",
								alignItems: "center",
							}}
						/>
					</span>
				</Tooltip>
			</div>
		</li>
	);
};

const areAgentsSidebarItemsEqual = (
	prev: Readonly<AgentsSidebarItemProps>,
	next: Readonly<AgentsSidebarItemProps>,
): boolean => {
	return (
		prev.isSelected === next.isSelected &&
		prev.agent.id === next.agent.id &&
		prev.agent.name === next.agent.name &&
		prev.agent.description === next.agent.description &&
		prev.onSelectAgent === next.onSelectAgent &&
		prev.onChatWithAgent === next.onChatWithAgent &&
		prev.onExportAgent === next.onExportAgent &&
		prev.onAgentDeleted === next.onAgentDeleted &&
		prev.onUploadAgentToHub === next.onUploadAgentToHub
	);
};

const MemoizedAgentsSidebarItem = memo(
	AgentsSidebarItem,
	areAgentsSidebarItemsEqual,
);

/**
 * Agents Sidebar Component
 *
 * Displays a list of agents with search, create, and delete functionality
 */
const AgentsSidebarComponent: FC<AgentsSidebarProps> = ({
	selectedAgentId,
	onSelectAgent,
}) => {
	const navigate = useNavigate();
	const [searchQuery, setSearchQuery] = useState("");
	const openCreateAgentDialog = useUiPreferencesStore(
		(state) => state.openCreateAgentDialog,
	);
	const debouncedSearchQuery = useDebouncedValue(searchQuery.trim(), 250);
	const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
	const perPage = 50;

	// Upload to Hub dialog state
	const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
	const [uploadAgent, setUploadAgent] = useState<AgentDetails | null>(null);
	const [uploadValidationIssues, setUploadValidationIssues] = useState<
		string[]
	>([]);
	const { isAuthenticated } = useRadientAuth();
	const agentClient = useMemo(
		() => createLocalOperatorClient(apiConfig.baseUrl),
		[],
	);

	// Export agent mutation
	const exportAgentMutation = useExportAgent();

	// Use the pagination hook to get and set the page from URL
	const { page, setPage } = usePaginationParams();

	// Fetch agents list with total count, similar to chat sidebar
	const {
		data: agentListResult,
		isLoading,
		isError,
		refetch,
	} = useAgents(
		page,
		perPage,
		0,
		debouncedSearchQuery || undefined,
		"created_date",
		"desc",
	);

	// Extract agents and total count from the result
	const agents = agentListResult?.agents || [];
	const totalAgents = agentListResult?.total || 0;

	// Fetch details for the selected agent if it's not in the current list
	const { data: selectedAgentDetails } = useAgent(
		// Only fetch if selectedAgentId exists and is not found in the current agents list
		selectedAgentId && !agents.find((a) => a.id === selectedAgentId)
			? selectedAgentId
			: undefined,
	);

	// Memoize combinedAgents to stabilize its reference for hook dependencies
	const combinedAgents = useMemo(() => {
		const combined = [...agents];
		if (
			selectedAgentDetails &&
			!combined.find((a) => a.id === selectedAgentDetails.id)
		) {
			// Add the selected agent if it's not already in the list
			combined.push(selectedAgentDetails);
		}
		// Sort combined list client-side if needed, e.g., by name or creation date
		// For now, rely on backend sorting primarily
		combined.sort((a, b) => {
			return (
				new Date(b.created_date).getTime() - new Date(a.created_date).getTime()
			);
		});
		return combined;
	}, [agents, selectedAgentDetails]);

	const handlePageChange = useCallback(
		(value: number) => {
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

	const handleOpenImportDialog = useCallback(() => {
		setIsImportDialogOpen(true);
	}, []);

	const handleCloseImportDialog = useCallback(() => {
		setIsImportDialogOpen(false);
	}, []);

	const handleExportAgent = useCallback(
		async (agentId: string) => {
			try {
				const blob = await exportAgentMutation.mutateAsync(agentId);

				// Get the agent name for the filename (check combined list)
				const agent = combinedAgents.find((a) => a.id === agentId);
				const agentName = agent
					? agent.name.replace(/\s+/g, "-").toLowerCase()
					: agentId;

				// Create a download link
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = `${agentName}-export.zip`;
				document.body.appendChild(a);
				a.click();

				// Clean up
				URL.revokeObjectURL(url);
				document.body.removeChild(a);
			} catch (error) {
				console.error("Failed to export agent:", error);
			}
		},
		[combinedAgents, exportAgentMutation], // Use combinedAgents
	);

	const getAgentUploadValidationIssues = useCallback(
		(agent: AgentDetails | null): string[] => {
			if (!agent) return ["No agent selected."];
			const issues: string[] = [];
			if (!agent.name || agent.name.trim() === "")
				issues.push("Name is required.");
			if (!agent.description || agent.description.trim() === "")
				issues.push("Description is required.");
			const hasCategory = agent.categories && agent.categories.length > 0;
			if (!hasCategory) issues.push("At least one category is required.");
			return issues;
		},
		[],
	);

	const handleOpenUploadDialog = useCallback(
		(agent: AgentDetails) => {
			setUploadAgent(agent);
			setUploadValidationIssues(getAgentUploadValidationIssues(agent));
			setIsUploadDialogOpen(true);
		},
		[getAgentUploadValidationIssues],
	);

	const handleCloseUploadDialog = useCallback(() => {
		setIsUploadDialogOpen(false);
		setUploadAgent(null);
		setUploadValidationIssues([]);
	}, []);

	const handleConfirmUpload = useCallback(() => {
		// Implement actual upload logic here if needed
		handleCloseUploadDialog();
	}, [handleCloseUploadDialog]);

	const handleAgentCreated = useCallback(
		async (agentId: string) => {
			try {
				const result = await refetch();
				const createdAgent = (result.data?.agents || []).find(
					(agent: AgentDetails) => agent.id === agentId,
				);

				if (createdAgent) {
					onSelectAgent(createdAgent);
					return;
				}

				const detailsResponse = await agentClient.agents.getAgent(agentId);
				if (detailsResponse.status < 400 && detailsResponse.result) {
					onSelectAgent(detailsResponse.result as AgentDetails);
				}
			} catch (error) {
				console.error("Error selecting newly created agent:", error);
			}
		},
		[onSelectAgent, refetch, agentClient],
	);

	const handleChatWithAgent = useCallback(
		(agentId: string) => {
			navigate(`/chat/${agentId}`);
		},
		[navigate],
	);

	const handleAgentDeletedFromItem = useCallback(
		(deletedAgentId: string) => {
			if (selectedAgentId === deletedAgentId) {
				// The parent component (AgentsPage) is responsible for clearing
				// the selected agent details if the selected agent is deleted.
				// This could be done by passing a callback or by the parent observing
				// the agents list and selectedAgentId.
				// For now, we assume the parent handles this logic.
				// If onSelectAgent(null) or similar is needed, it should be passed as a prop.
			}
			refetch();
			navigate("/agents"); // Navigate to the main agents page
		},
		[selectedAgentId, refetch, navigate],
	);

	const handleUploadAgentToHubFromItem = useCallback(
		(agent: AgentDetails) => {
			handleOpenUploadDialog(agent);
		},
		[handleOpenUploadDialog],
	);

	return (
		<div className="flex h-full w-full flex-col overflow-hidden border-hairline border-r bg-surface">
			<SidebarHeader
				title="Agents"
				searchQuery={searchQuery}
				onSearchChange={(query) => setSearchQuery(query)}
				onNewAgentClick={openCreateAgentDialog}
				onImportAgentClick={handleOpenImportDialog}
				importAgentTooltip="Import an agent from a ZIP file"
			/>

			{isLoading ? (
				<div className="flex flex-1 items-center justify-center">
					{/* Nothing beside it says what is loading, so the spinner names itself. */}
					<Spinner size="lg" label="Loading agents" />
				</div>
			) : isError ? (
				<Alert
					variant="danger"
					// Appears in response to a failed fetch rather than sitting on the
					// panel from the start, so it announces itself.
					role="alert"
					// `w-auto` overrides the primitive's `w-full`, which would
					// overflow the column by the margin's 32px.
					className="m-4 w-auto"
				>
					<AlertDescription>
						Failed to load agents. Please try again.
					</AlertDescription>
					<Button
						variant="ghost"
						size="sm"
						className="self-start"
						onClick={() => refetch()}
					>
						Retry
					</Button>
				</Alert>
			) : combinedAgents.length === 0 && !isLoading ? ( // Check combinedAgents and isLoading
				<p className="p-6 text-center text-body-sm text-ink-muted">
					{searchQuery ? "No agents match your search" : "No agents found"}
				</p>
			) : (
				<TooltipProvider
					delayDuration={ROW_TOOLTIP_DELAY_MS}
					skipDelayDuration={0}
				>
					{/*
					 * `min-h-0` so the list scrolls inside the flex column instead of
					 * pushing the pagination out of the panel.
					 */}
					<ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
						{combinedAgents.map((agent) => (
							<MemoizedAgentsSidebarItem
								key={agent.id}
								agent={agent}
								isSelected={
									selectedAgentId === agent.id ||
									selectedAgentDetails?.id === agent.id
								}
								onSelectAgent={handleSelectAgent}
								onChatWithAgent={handleChatWithAgent}
								onExportAgent={handleExportAgent}
								onAgentDeleted={handleAgentDeletedFromItem}
								onUploadAgentToHub={handleUploadAgentToHubFromItem}
							/>
						))}
					</ul>
				</TooltipProvider>
			)}

			<ImportAgentDialog
				open={isImportDialogOpen}
				onClose={handleCloseImportDialog}
				onAgentImported={handleAgentCreated}
			/>

			{totalAgents > 0 && (
				<CompactPagination
					page={page}
					count={Math.max(1, Math.ceil(totalAgents / perPage))}
					onChange={handlePageChange}
				/>
			)}

			<UploadAgentDialog
				open={isUploadDialogOpen}
				onClose={handleCloseUploadDialog}
				agentName={uploadAgent?.name || ""}
				isAuthenticated={isAuthenticated}
				onConfirmUpload={handleConfirmUpload}
				validationIssues={uploadValidationIssues}
			/>
		</div>
	);
};

export const AgentsSidebar = memo(AgentsSidebarComponent);
