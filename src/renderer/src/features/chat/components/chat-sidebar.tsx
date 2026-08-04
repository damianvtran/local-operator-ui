import { UploadAgentDialog } from "@features/agents/components/upload-agent-dialog";
import type { AgentDetails } from "@shared/api/local-operator/types";
import {
	AgentOptionsMenu,
	CompactPagination,
	ImportAgentDialog,
	SidebarHeader,
} from "@shared/components/common";
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
import {
	useAgent,
	useAgents,
	useClearAgentConversation,
	useExportAgent,
	usePaginationParams,
} from "@shared/hooks";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	formatMessageDateTime,
	getFullDateTime,
} from "@shared/utils/date-utils";
import { Bot, MessageCircleOff } from "lucide-react";
import type { ChangeEvent, FC } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * The rows truncate, so a tooltip is the only way to read a long name or
 * message preview. The delay keeps them quiet while the pointer merely
 * crosses the list.
 */
const ROW_TOOLTIP_DELAY_MS = 1200;

/**
 * Props for the ChatSidebar component
 */
type ChatSidebarProps = {
	/** Currently selected conversation ID */
	selectedConversation?: string;
	/** Callback for when a conversation is selected */
	onSelectConversation: (id: string) => void;
	/** Callback for navigating to agent settings */
	onNavigateToAgentSettings?: (agentId: string) => void;
};

type ChatSidebarItemProps = {
	agent: AgentDetails;
	isSelected: boolean;
	onSelectConversation: (agentId: string) => void;
	onNavigateToAgentSettings?: (agentId: string) => void;
	onExportAgent: (agentId: string) => void;
	onClearAgentConversation: (agentId: string) => void;
	onAgentDeleted: (deletedAgentId: string) => void;
	onUploadAgentToHub: (agent: AgentDetails) => void;
	getFullDateTime: (date: string) => string;
	formatMessageDateTime: (date: string) => string;
	truncateMessage: (message?: string, maxLength?: number) => string;
	index: number;
};

const ChatSidebarItem: FC<ChatSidebarItemProps> = ({
	agent,
	isSelected,
	onSelectConversation,
	onNavigateToAgentSettings,
	onExportAgent,
	onClearAgentConversation,
	onAgentDeleted,
	onUploadAgentToHub,
	getFullDateTime,
	formatMessageDateTime,
	truncateMessage,
	index,
}) => {
	return (
		<li className="group relative">
			<button
				type="button"
				onClick={() => onSelectConversation(agent.id)}
				// Matched by `use-onboarding-tour.ts`, which also clicks it — the tag
				// must stay on the button, and the value is fixed.
				data-tour-tag={`agent-list-item-button-${index}`}
				// The selected row is styled *and* announced: colour alone leaves a
				// screen reader with no way to tell which conversation is open.
				aria-current={isSelected ? "true" : undefined}
				className={cn(
					"flex w-full items-center gap-3 rounded-md px-2 py-1 pr-9 text-left",
					"transition-colors duration-fast ease-out-quart",
					isSelected ? "bg-accent-wash" : "hover:bg-elevated",
				)}
			>
				<Avatar className="size-9 shrink-0">
					<AvatarFallback>
						<Bot size={18} aria-hidden={true} />
					</AvatarFallback>
				</Avatar>
				<span className="relative isolate min-w-0 flex-1 overflow-hidden">
					<span className="relative flex w-full items-center gap-2 overflow-hidden">
						<Tooltip content={agent.name} side="top" align="start">
							<span className="mb-0.5 min-w-0 flex-1 truncate font-semibold text-body-sm text-ink">
								{agent.name}
							</span>
						</Tooltip>
						{agent.last_message_datetime && (
							<span
								className="pointer-events-none ml-2 flex shrink-0 items-center text-meta text-ink-dim"
								title={getFullDateTime(agent.last_message_datetime)}
							>
								{formatMessageDateTime(agent.last_message_datetime)}
							</span>
						)}
					</span>

					{agent.last_message ? (
						<Tooltip
							content={truncateMessage(agent.last_message, 500)}
							side="bottom"
							align="start"
						>
							<span className="block min-h-[18px] w-full truncate text-meta text-ink-muted">
								{truncateMessage(agent.last_message, 40)}
							</span>
						</Tooltip>
					) : (
						<span className="flex min-h-[18px] items-center gap-1 truncate text-meta italic text-ink-dim">
							<MessageCircleOff size={12} aria-hidden={true} />
							<span>No messages yet</span>
						</span>
					)}
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
							isAgentsPage={false}
							onViewAgentSettings={
								onNavigateToAgentSettings
									? () => onNavigateToAgentSettings(agent.id)
									: undefined
							}
							onExportAgent={() => onExportAgent(agent.id)}
							onClearConversation={() => onClearAgentConversation(agent.id)}
							onAgentDeleted={onAgentDeleted}
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

const areChatSidebarItemsEqual = (
	prev: Readonly<ChatSidebarItemProps>,
	next: Readonly<ChatSidebarItemProps>,
): boolean => {
	return (
		prev.isSelected === next.isSelected &&
		prev.index === next.index &&
		prev.agent.id === next.agent.id &&
		prev.agent.name === next.agent.name &&
		prev.agent.last_message === next.agent.last_message &&
		prev.agent.last_message_datetime === next.agent.last_message_datetime &&
		prev.onSelectConversation === next.onSelectConversation &&
		prev.onNavigateToAgentSettings === next.onNavigateToAgentSettings &&
		prev.onExportAgent === next.onExportAgent &&
		prev.onClearAgentConversation === next.onClearAgentConversation &&
		prev.onAgentDeleted === next.onAgentDeleted &&
		prev.onUploadAgentToHub === next.onUploadAgentToHub &&
		prev.getFullDateTime === next.getFullDateTime &&
		prev.formatMessageDateTime === next.formatMessageDateTime &&
		prev.truncateMessage === next.truncateMessage
	);
};

const MemoizedChatSidebarItem = memo(ChatSidebarItem, areChatSidebarItemsEqual);

/**
 * Chat Sidebar Component
 *
 * Displays a list of agents with search, create, and delete functionality
 * Uses React Router for navigation
 */
const ChatSidebarComponent: FC<ChatSidebarProps> = ({
	selectedConversation,
	onSelectConversation,
	onNavigateToAgentSettings,
}) => {
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

	// Navigation
	const navigate = useNavigate();

	// Export agent mutation
	const exportAgentMutation = useExportAgent();

	// Clear conversation mutation
	const clearConversationMutation = useClearAgentConversation();

	// Use the pagination hook to get and set the page from URL
	const { page, setPage } = usePaginationParams();

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
		"last_message_datetime",
		"desc",
	);

	// Extract agents and total count from the result
	const agents = agentListResult?.agents || [];
	const totalAgents = agentListResult?.total || 0;

	// Fetch details for the selected agent if it's not in the current list
	const { data: selectedAgentDetails } = useAgent(
		// Only fetch if selectedConversation exists and is not found in the current agents list
		selectedConversation && !agents.find((a) => a.id === selectedConversation)
			? selectedConversation
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
		return combined;
	}, [agents, selectedAgentDetails]);

	const handlePageChange = useCallback(
		(_event: ChangeEvent<unknown>, value: number) => {
			setPage(value);
		},
		[setPage],
	);

	const handleSelectConversation = useCallback(
		(agentId: string) => {
			onSelectConversation(agentId);
		},
		[onSelectConversation],
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
	); // Empty dependency array as it doesn't rely on component scope variables that change

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
		(agentId: string) => {
			// Fetch the agent details to get the full agent object
			const fetchAndSelectAgent = async () => {
				try {
					// Refetch the agents list to update the UI
					const result = await refetch();

					// Get the updated agents list from the refetch result
					const updatedAgentList = result.data?.agents || [];

					// Find the newly created agent in the updated list
					const createdAgent = updatedAgentList.find(
						(agent: AgentDetails) => agent.id === agentId,
					);

					// Select the newly created agent if found
					if (createdAgent) {
						onSelectConversation(agentId);
					} else {
						// If the agent wasn't found in the updated list, still select it
						// The agent details will be fetched when needed
						onSelectConversation(agentId);
					}
				} catch (error) {
					console.error("Error fetching agent details:", error);
					// Still select the agent even if there was an error
					onSelectConversation(agentId);
				}
			};

			fetchAndSelectAgent();
		},
		[onSelectConversation, refetch],
	);

	const handleClearAgentConversation = useCallback(
		(agentId: string) => {
			clearConversationMutation.mutate({ agentId });
		},
		[clearConversationMutation],
	);

	const handleAgentDeleted = useCallback(
		(deletedAgentId: string) => {
			if (selectedConversation === deletedAgentId) {
				onSelectConversation(""); // Clear selection if the deleted agent was selected
			}
			refetch(); // Refetch the agent list
			navigate("/chat"); // Navigate to the main chat page
		},
		[selectedConversation, onSelectConversation, refetch, navigate],
	);

	const handleUploadAgentToHub = useCallback(
		(agent: AgentDetails) => {
			handleOpenUploadDialog(agent);
		},
		[handleOpenUploadDialog], // handleOpenUploadDialog is stable as it's not in deps array of its own useCallback
	);

	const truncateMessage = useCallback((message?: string, maxLength = 60) => {
		if (!message) return "";
		return message.length > maxLength
			? `${message.substring(0, maxLength)}...`
			: message;
	}, []);

	return (
		<div
			className="flex h-full w-full flex-col overflow-hidden border-hairline border-r bg-surface"
			data-tour-tag="agent-list-panel"
		>
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
					<ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-2">
						{combinedAgents.map((agent, index) => (
							<MemoizedChatSidebarItem
								key={agent.id}
								agent={agent}
								isSelected={
									selectedConversation === agent.id ||
									selectedAgentDetails?.id === agent.id
								}
								onSelectConversation={handleSelectConversation}
								onNavigateToAgentSettings={onNavigateToAgentSettings}
								onExportAgent={handleExportAgent}
								onClearAgentConversation={handleClearAgentConversation}
								onAgentDeleted={handleAgentDeleted}
								onUploadAgentToHub={handleUploadAgentToHub}
								getFullDateTime={getFullDateTime}
								formatMessageDateTime={formatMessageDateTime}
								truncateMessage={truncateMessage}
								index={index}
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
					onChange={(newPage) =>
						handlePageChange({} as ChangeEvent<unknown>, newPage)
					}
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

export const ChatSidebar = memo(ChatSidebarComponent);
