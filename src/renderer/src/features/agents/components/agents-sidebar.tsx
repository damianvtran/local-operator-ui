/**
 * Agents Sidebar Component
 *
 * Displays a list of agents with search, create, and delete functionality
 */

import { faClock } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Avatar,
	Box,
	Button,
	CircularProgress,
	List,
	ListItem,
	ListItemAvatar,
	ListItemButton,
	ListItemText,
	Paper,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { AgentOptionsMenu } from "@shared/components/common/agent-options-menu";
import { CompactPagination } from "@shared/components/common/compact-pagination";
import { ImportAgentDialog } from "@shared/components/common/import-agent-dialog";
import { SidebarHeader } from "@shared/components/common/sidebar-header";
import {
	useAgent,
	useAgents,
	useExportAgent,
	usePaginationParams,
} from "@shared/hooks";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store"; // Import store
import { Bot } from "lucide-react";
import type { ChangeEvent, FC } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadAgentDialog } from "./upload-agent-dialog";

const SidebarContainer = styled(Paper)(({ theme }) => ({
	width: "100%",
	height: "100%",
	borderRight: `1px solid ${theme.palette.sidebar.border}`,
	backgroundColor: theme.palette.sidebar.secondaryBackground,
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
}));

const LoadingContainer = styled(Box)({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	flexGrow: 1,
});

const ErrorAlert = styled(Alert)({
	marginBottom: 16,
	borderRadius: 16,
	boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
});

const EmptyStateContainer = styled(Box)({
	padding: 24,
	textAlign: "center",
});

const AgentsList = styled(List)(({ theme }) => ({
	overflowY: "auto",
	flexGrow: 1,
	padding: "8px 0px", // Match chat sidebar padding
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor:
			theme.palette.mode === "dark"
				? "rgba(255, 255, 255, 0.1)"
				: "rgba(0, 0, 0, 0.1)",
		borderRadius: "4px",
	},
}));

const AgentListItemButton = styled(ListItemButton)(({ theme }) => ({
	margin: "0 8px 8px",
	borderRadius: 8,
	paddingRight: 12,
	paddingTop: 6,
	paddingBottom: 6,
	paddingLeft: 12,
	position: "relative",
	"&.Mui-selected": {
		backgroundColor: alpha(theme.palette.sidebar.itemActive, 0.1),
		color: theme.palette.sidebar.itemActiveText,
		"&:hover": {
			backgroundColor: alpha(theme.palette.sidebar.itemActiveHover, 0.15),
		},
	},
	"&:hover": {
		backgroundColor: alpha(theme.palette.sidebar.itemHover, 0.1),
	},
}));

const AgentAvatar = styled(Avatar, {
	shouldForwardProp: (prop) => prop !== "selected",
})<{ selected?: boolean }>(({ theme, selected }) => ({
	backgroundColor: selected
		? theme.palette.sidebar.itemActive
		: theme.palette.icon.background,
	color: selected
		? theme.palette.sidebar.itemActiveText
		: theme.palette.icon.text,
	boxShadow: `0 2px 4px ${alpha(theme.palette.common.black, 0.15)}`,
	width: 42,
	height: 42,
}));

// Agent name styling (similar to chat sidebar)
const AgentName = styled(Typography)(() => ({
	fontWeight: 600,
	fontSize: "0.9rem",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	flex: 1,
}));

// Description text styling (similar to message preview)
const DescriptionText = styled("div")(({ theme }) => ({
	fontSize: "0.8rem",
	color:
		theme.palette.mode === "dark"
			? "rgba(255, 255, 255, 0.7)"
			: "rgba(0, 0, 0, 0.6)",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	width: "100%",
	minHeight: "18px",
}));

// Creation date text styling (similar to timestamp)
const CreationDateText = styled("div")(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	fontSize: "0.7rem",
	color:
		theme.palette.mode === "dark"
			? "rgba(255, 255, 255, 0.5)"
			: "rgba(0, 0, 0, 0.5)",
	marginTop: 2,
	gap: 4,
}));

// Options button container: absolutely positioned, does not take up space, fades in on hover
const OptionsButtonContainer = styled(Box)({
	position: "absolute",
	top: 0,
	right: 0,
	height: "100%",
	display: "flex",
	alignItems: "center",
	opacity: 0,
	transition: "opacity 0.2s",
	pointerEvents: "none",
	".MuiListItemButton-root:hover &": {
		opacity: 1,
		pointerEvents: "auto",
	},
	"& > *": {
		pointerEvents: "auto",
	},
});

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
	formatDate: (dateString: string) => string;
	onChatWithAgent: (agentId: string) => void;
	onExportAgent: (agentId: string) => void;
	onAgentDeleted: (deletedAgentId: string) => void;
	onUploadAgentToHub: (agent: AgentDetails) => void;
};

const AgentsSidebarItem: FC<AgentsSidebarItemProps> = ({
	agent,
	isSelected,
	onSelectAgent,
	formatDate,
	onChatWithAgent,
	onExportAgent,
	onAgentDeleted,
	onUploadAgentToHub,
}) => {
	return (
		<ListItem key={agent.id} disablePadding>
			<AgentListItemButton
				selected={isSelected}
				onClick={() => onSelectAgent(agent)}
				data-tour-tag="agent-list-item-button"
			>
				<ListItemAvatar>
					<AgentAvatar selected={isSelected}>
						<Bot size={22} strokeWidth={2.1} aria-label="Agent" />
					</AgentAvatar>
				</ListItemAvatar>
				<ListItemText disableTypography>
					<Box
						sx={{
							display: "flex",
							alignItems: "center",
							width: "100%",
							overflow: "hidden",
							gap: 1,
							position: "relative",
						}}
					>
						<Box sx={{ flex: 1, minWidth: 0 }}>
							<Tooltip
								enterDelay={1200}
								enterNextDelay={1200}
								title={agent.name}
								arrow
								placement="top-start"
							>
								<AgentName>{agent.name}</AgentName>
							</Tooltip>
							<Tooltip
								title={agent.description || "No description"}
								arrow
								placement="bottom-start"
								enterDelay={1200}
								enterNextDelay={1200}
							>
								<DescriptionText>
									{agent.description || "No description"}
								</DescriptionText>
							</Tooltip>
							<Tooltip
								title={`Created: ${formatDate(agent.created_date)}`}
								arrow
								placement="bottom-start"
								enterDelay={1200}
								enterNextDelay={1200}
							>
								<CreationDateText>
									<FontAwesomeIcon icon={faClock} size="xs" />
									<span>{formatDate(agent.created_date)}</span>
								</CreationDateText>
							</Tooltip>
						</Box>
						<OptionsButtonContainer>
							<Tooltip
								enterDelay={1200}
								enterNextDelay={1200}
								title="Agent Options"
								arrow
								placement="top"
							>
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
											borderRadius: "4px",
											display: "flex",
											justifyContent: "center",
											alignItems: "center",
										}}
									/>
								</span>
							</Tooltip>
						</OptionsButtonContainer>
					</Box>
				</ListItemText>
			</AgentListItemButton>
		</ListItem>
	);
};

const MemoizedAgentsSidebarItem = memo(AgentsSidebarItem);

/**
 * Formats a date string into a more readable format
 */
const formatDate = (dateString: string): string => {
	if (!dateString) return "Unknown date";
	const date = new Date(dateString);
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
};

/**
 * Agents Sidebar Component
 *
 * Displays a list of agents with search, create, and delete functionality
 */
export const AgentsSidebar: FC<AgentsSidebarProps> = ({
	selectedAgentId,
	onSelectAgent,
}) => {
	const navigate = useNavigate();
	const [searchQuery, setSearchQuery] = useState("");
	// const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false); // Remove local state
	const { openCreateAgentDialog } = useUiPreferencesStore(); // Use global actions and state
	const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
	const perPage = 50;

	// Upload to Hub dialog state
	const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
	const [uploadAgent, setUploadAgent] = useState<AgentDetails | null>(null);
	const [uploadValidationIssues, setUploadValidationIssues] = useState<
		string[]
	>([]);
	const { isAuthenticated } = useRadientAuth();

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
	} = useAgents(page, perPage, 0, searchQuery, "created_date", "desc");

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
		(_event: ChangeEvent<unknown>, value: number) => {
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

	// const handleOpenCreateDialog = useCallback(() => { // Remove local handler
	// 	setIsCreateDialogOpen(true);
	// }, []);

	// const handleCloseCreateDialog = useCallback(() => { // Remove local handler
	// 	setIsCreateDialogOpen(false);
	// }, []);

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

	const handleCloseUploadDialog = () => {
		setIsUploadDialogOpen(false);
		setUploadAgent(null);
		setUploadValidationIssues([]);
	};

	const handleConfirmUpload = () => {
		// Implement actual upload logic here if needed
		handleCloseUploadDialog();
	};

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
						onSelectAgent(createdAgent);
					} else {
						// If the agent wasn't found in the updated list, still select it
						// The agent details will be fetched when needed by the useAgent hook
						// if it becomes the selected agent
						// We need to manually fetch here to pass the full object to onSelectAgent
						try {
							// Use the useAgent hook's underlying fetch logic or a direct client call
							// For simplicity, let's assume we can trigger selection and let the main view handle fetching if needed,
							// OR fetch it here if onSelectAgent *requires* the full object immediately.
							// Let's fetch it to be safe, similar to the original logic but simplified.
							const { data: newAgentDetails } = await refetch(); // Refetch might return the new agent
							const foundAgent = (newAgentDetails?.agents || []).find(
								(a) => a.id === agentId,
							);
							if (foundAgent) {
								onSelectAgent(foundAgent);
							} else {
								// Fallback if refetch didn't include it (e.g., pagination)
								// This part might need adjustment based on how `onSelectAgent` is used
								console.warn(
									"Newly created agent not found immediately after refetch.",
								);
								// Potentially navigate or just set the ID, letting the main view load it
								// For now, just log and don't select if not found
							}
						} catch (fetchError) {
							console.error(
								"Error fetching newly created agent details:",
								fetchError,
							);
							// Optionally select with partial data or handle error
						}
					}
				} catch (error) {
					console.error("Error refetching agents list:", error);
					// Handle error appropriately
				}
			};

			fetchAndSelectAgent();
		},
		[onSelectAgent, refetch], // Keep dependencies
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
		<SidebarContainer elevation={0}>
			<SidebarHeader
				title="Agents"
				searchQuery={searchQuery}
				onSearchChange={(query) => setSearchQuery(query)}
				onNewAgentClick={openCreateAgentDialog} // Use global action
				onImportAgentClick={handleOpenImportDialog}
				importAgentTooltip="Import an agent from a ZIP file"
			/>

			{isLoading ? (
				<LoadingContainer>
					<CircularProgress size={40} thickness={4} />
				</LoadingContainer>
			) : isError ? (
				<ErrorAlert
					severity="error"
					action={
						<Button
							color="inherit"
							size="small"
							onClick={() => refetch()}
							sx={{ fontWeight: 500 }}
						>
							Retry
						</Button>
					}
				>
					Failed to load agents. Please try again.
				</ErrorAlert>
			) : combinedAgents.length === 0 && !isLoading ? ( // Check combinedAgents and isLoading
				<EmptyStateContainer>
					<Typography variant="body2" color="text.secondary">
						{searchQuery ? "No agents match your search" : "No agents found"}
					</Typography>
				</EmptyStateContainer>
			) : (
				<AgentsList>
					{combinedAgents.map((agent) => (
						<MemoizedAgentsSidebarItem
							key={agent.id}
							agent={agent}
							isSelected={
								selectedAgentId === agent.id ||
								selectedAgentDetails?.id === agent.id
							}
							onSelectAgent={handleSelectAgent}
							formatDate={formatDate}
							onChatWithAgent={handleChatWithAgent}
							onExportAgent={handleExportAgent}
							onAgentDeleted={handleAgentDeletedFromItem}
							onUploadAgentToHub={handleUploadAgentToHubFromItem}
						/>
					))}
				</AgentsList>
			)}

			{/* CreateAgentDialog is now global, rendered in App.tsx.
			    Ensure its props are correctly passed there if they depend on this component's state/logic.
			    For now, we assume onAgentCreated in App.tsx handles navigation and closing.
			*/}
			{/* <CreateAgentDialog
				open={isCreateAgentDialogOpen} // This would now come from the global store
				onClose={closeCreateAgentDialog} // This would now come from the global store
				onAgentCreated={handleAgentCreated} // This callback might need to be passed to the global dialog if specific logic is needed here
			/> */}

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
			{/* Upload Agent Dialog */}
			<UploadAgentDialog
				open={isUploadDialogOpen}
				onClose={handleCloseUploadDialog}
				agentName={uploadAgent?.name || ""}
				isAuthenticated={isAuthenticated}
				onConfirmUpload={handleConfirmUpload}
				validationIssues={uploadValidationIssues}
			/>
		</SidebarContainer>
	);
};
