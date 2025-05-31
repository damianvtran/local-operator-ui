import { getIconElement } from "@features/command-palette/components/command-palette-utils";
import { DEFAULT_SETTINGS_SECTIONS } from "@features/settings/components/settings-sidebar";
import {
	Box,
	Chip,
	Dialog,
	DialogContent,
	IconButton,
	InputAdornment,
	List,
	ListItem,
	ListItemButton,
	ListItemIcon,
	ListItemText,
	TextField,
	Typography,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { useTheme } from "@mui/material/styles";
import type { AgentListResult } from "@shared/api/local-operator/types";
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { CreateAgentDialog } from "@shared/components/common/create-agent-dialog";
import { useAgents } from "@shared/hooks/use-agents";
import { useClearAgentConversation } from "@shared/hooks/use-clear-agent-conversation";
import { useDebounce } from "@shared/hooks/use-debounce";
import { useAgentRouteParam } from "@shared/hooks/use-route-params";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	Calendar,
	FileText,
	Search as LucideSearch,
	MessageSquare,
	PanelRightClose,
	PanelRightOpen,
	Plus,
	Settings,
	Store,
	Trash2,
	Users,
	X,
} from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const StyledDialog = styled(Dialog)(({ theme }) => ({
	"& .MuiDialog-paper": {
		width: "600px",
		maxWidth: "90vw",
		borderRadius: theme.shape.borderRadius * 2,
		backgroundColor: theme.palette.background.default,
		backgroundImage: "none",
		boxShadow: theme.shadows[8],
		border: `1px solid ${theme.palette.divider}`,
	},
}));

const SearchInputContainer = styled("div")(({ theme }) => ({
	padding: theme.spacing(2, 3),
	borderBottom: `1px solid ${theme.palette.divider}`,
}));

const ResultsListContainer = styled(List)(({ theme }) => ({
	maxHeight: "400px",
	overflowY: "auto",
	padding: 0,
	// Custom scrollbar styles
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-track": {
		background: "transparent",
	},
	"&::-webkit-scrollbar-thumb": {
		background:
			theme.palette.mode === "dark"
				? "rgba(255, 255, 255, 0.2)"
				: "rgba(0, 0, 0, 0.2)",
		borderRadius: "4px",
		"&:hover": {
			background:
				theme.palette.mode === "dark"
					? "rgba(255, 255, 255, 0.3)"
					: "rgba(0, 0, 0, 0.3)",
		},
	},
	// Firefox scrollbar styles
	scrollbarWidth: "thin",
	scrollbarColor:
		theme.palette.mode === "dark"
			? "rgba(255, 255, 255, 0.2) transparent"
			: "rgba(0, 0, 0, 0.2) transparent",
}));

const ResultItemStyled = styled(ListItemButton)(({ theme }) => ({
	padding: theme.spacing(0.5, 2),
	borderRadius: 8,
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
	},
}));

const ActionChip = styled(Chip)(() => ({
	fontSize: "0.7rem",
	height: "20px",
	marginLeft: "auto",
}));

type CommandPaletteItemType =
	| "page"
	| "agent-chat"
	| "agent-settings"
	| "settings-section"
	| "create-agent"
	| "clear-conversation"
	| "toggle-canvas";

interface CommandPaletteItem {
	id: string;
	type: CommandPaletteItemType;
	name: string;
	category: string;
	path?: string;
	icon?: JSX.Element;
	action?: () => void;
}

const PAGE_DEFINITIONS: Omit<CommandPaletteItem, "id" | "type">[] = [
	{
		name: "Chat",
		path: "/chat",
		category: "Navigation",
		icon: <MessageSquare size={16} />,
	},
	{
		name: "My Agents",
		path: "/agents",
		category: "Navigation",
		icon: <Users size={16} />,
	},
	{
		name: "Agent Hub",
		path: "/agent-hub",
		category: "Navigation",
		icon: <Store size={16} />,
	},
	{
		name: "Schedules",
		path: "/schedules",
		category: "Navigation",
		icon: <Calendar size={16} />,
	},
	{
		name: "Settings",
		path: "/settings",
		category: "Navigation",
		icon: <Settings size={16} />,
	},
];

const MAX_SUGGESTIONS = 15;

const getActionLabel = (type: CommandPaletteItemType): string => {
	switch (type) {
		case "page":
			return "Navigate";
		case "agent-chat":
			return "Chat";
		case "agent-settings":
			return "Configure";
		case "settings-section":
			return "Configure";
		case "create-agent":
			return "Create";
		case "clear-conversation":
			return "Clear";
		case "toggle-canvas":
			return "Toggle";
		default:
			return "Open";
	}
};

const getActionColor = (
	type: CommandPaletteItemType,
):
	| "default"
	| "primary"
	| "secondary"
	| "success"
	| "warning"
	| "info"
	| "error" => {
	switch (type) {
		case "page":
			return "primary";
		case "agent-chat":
			return "success";
		case "agent-settings":
			return "warning";
		case "settings-section":
			return "info";
		case "create-agent":
			return "success";
		case "clear-conversation":
			return "error";
		case "toggle-canvas":
			return "secondary";
		default:
			return "default";
	}
};

export const CommandPalette: FC = () => {
	const navigate = useNavigate();
	const location = useLocation(); // Keep using useLocation for isOnChatPage
	const {
		isCommandPaletteOpen,
		closeCommandPalette,
		commandPaletteQuery,
		setCommandPaletteQuery,
		isCanvasOpen,
		setCanvasOpen,
		isCreateAgentDialogOpen, // Use global state
		openCreateAgentDialog, // Use global action
		closeCreateAgentDialog, // Use global action
	} = useUiPreferencesStore();

	// const navigate = useNavigate(); // Remove redeclaration
	const { agentId: currentAgentIdFromRoute } = useAgentRouteParam(); // Use hook for agentId
	const { getLastAgentId } = useAgentSelectionStore();
	const { data: agentsData } = useAgents(1, 20) as { data?: AgentListResult };
	const theme = useTheme();
	const clearConversationMutation = useClearAgentConversation();

	const [selectedIndex, setSelectedIndex] = useState(0);
	const [localQuery, setLocalQuery] = useState(commandPaletteQuery);
	const debouncedLocalQuery = useDebounce(localQuery, 200);
	const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false);

	// Use the agent ID from URL or the last selected agent ID
	const effectiveAgentId = currentAgentIdFromRoute || getLastAgentId("chat");
	const isOnChatPage = location.pathname.startsWith("/chat"); // Derive isOnChatPage correctly

	// Sync the debounced local query back to the store (but this won't cause re-renders during typing)
	useEffect(() => {
		setCommandPaletteQuery(debouncedLocalQuery);
	}, [debouncedLocalQuery, setCommandPaletteQuery]);

	// Sync store query to local query when palette opens (in case it was set externally)
	useEffect(() => {
		if (isCommandPaletteOpen) {
			setLocalQuery(commandPaletteQuery);
		}
	}, [isCommandPaletteOpen, commandPaletteQuery]);

	const handleQueryChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			setLocalQuery(event.target.value);
		},
		[],
	);

	const handleClearSearch = useCallback(() => {
		setLocalQuery("");
	}, []);

	const inputPropsStyle = useMemo(() => ({ fontSize: "1rem" }), []);

	const startAdornment = useMemo(
		() => (
			<InputAdornment position="start" sx={{ width: "28px" }}>
				<LucideSearch size={16} color={theme.palette.action.active} />
			</InputAdornment>
		),
		[theme.palette.action.active],
	);

	const endAdornment = useMemo(
		() =>
			localQuery ? (
				<InputAdornment position="end">
					<IconButton
						aria-label="clear search"
						onClick={handleClearSearch}
						edge="end"
						size="small"
					>
						<X size={16} />
					</IconButton>
				</InputAdornment>
			) : null,
		[localQuery, handleClearSearch],
	);

	const textFieldInputProps = useMemo(
		() => ({
			startAdornment,
			endAdornment,
			disableUnderline: true,
			style: inputPropsStyle,
		}),
		[startAdornment, endAdornment, inputPropsStyle],
	);

	const pages = useMemo((): CommandPaletteItem[] => {
		return PAGE_DEFINITIONS.map((p, i) => ({
			...p,
			id: `page-${i}`,
			type: "page",
		}));
	}, []);

	const settingsSectionItems = useMemo((): CommandPaletteItem[] => {
		return DEFAULT_SETTINGS_SECTIONS.map((section) => ({
			id: `settings-section-${section.id}`,
			type: "settings-section",
			name: section.label,
			category: "Settings Section",
			path: `/settings?section=${section.id}`,
			icon: getIconElement(section),
		}));
	}, []);

	const handleCreateAgent = useCallback(() => {
		closeCommandPalette();
		// Navigate to chat page first if not already there
		// This navigation logic might be better handled by the dialog itself or a dedicated service
		// For now, let's keep it simple and open the dialog.
		// Navigation to /chat if not there can be a separate concern or handled by where the dialog leads.
		openCreateAgentDialog(); // Use global action
	}, [closeCommandPalette, openCreateAgentDialog]);

	const handleClearConversation = useCallback(() => {
		// This will now open the confirmation dialog
		if (effectiveAgentId) {
			setIsClearConfirmationOpen(true);
			// Keep the command palette open until confirmation
		}
	}, [effectiveAgentId]);

	const confirmActualClearConversation = useCallback(() => {
		if (effectiveAgentId) {
			clearConversationMutation.mutate({ agentId: effectiveAgentId });
		}
		setIsClearConfirmationOpen(false);
		closeCommandPalette(); // Close palette after action
	}, [effectiveAgentId, clearConversationMutation, closeCommandPalette]);

	const cancelClearConversation = useCallback(() => {
		setIsClearConfirmationOpen(false);
		// Don't close command palette here, user might want to select another action
	}, []);

	const handleToggleCanvas = useCallback(() => {
		setCanvasOpen(!isCanvasOpen);
		closeCommandPalette();
	}, [isCanvasOpen, setCanvasOpen, closeCommandPalette]);

	const handleAgentCreated = useCallback(
		(agentId: string) => {
			// Navigate to the new agent's chat page
			navigate(`/chat/${agentId}`);
			closeCreateAgentDialog(); // Use global action
		},
		[navigate, closeCreateAgentDialog],
	);

	const actionItems = useMemo((): CommandPaletteItem[] => {
		const items: CommandPaletteItem[] = [];

		// Create Agent - always available
		items.push({
			id: "create-agent",
			type: "create-agent",
			name: "Create Agent",
			category: "Actions",
			icon: <Plus size={16} />,
			action: handleCreateAgent,
		});

		// Clear Conversation - only available on chat page with agent ID
		if (isOnChatPage && effectiveAgentId) {
			items.push({
				id: "clear-conversation",
				type: "clear-conversation",
				name: "Clear Conversation",
				category: "Actions",
				icon: <Trash2 size={16} />,
				action: handleClearConversation,
			});
		}

		// Toggle Canvas - only available on chat page
		if (isOnChatPage) {
			items.push({
				id: "toggle-canvas",
				type: "toggle-canvas",
				name: isCanvasOpen ? "Close Canvas" : "Open Canvas",
				category: "Actions",
				icon: isCanvasOpen ? (
					<PanelRightClose size={16} />
				) : (
					<PanelRightOpen size={16} />
				),
				action: handleToggleCanvas,
			});
		}

		return items;
	}, [
		isOnChatPage,
		effectiveAgentId,
		isCanvasOpen,
		handleCreateAgent,
		handleClearConversation,
		handleToggleCanvas,
	]);

	const handleItemClick = useCallback(
		(item: CommandPaletteItem) => {
			if (item.action) {
				item.action();
			} else if (item.path) {
				navigate(item.path);
				closeCommandPalette();
			}
		},
		[navigate, closeCommandPalette],
	);

	const allItems = useMemo(() => {
		const agentItems: CommandPaletteItem[] = [];
		if (agentsData?.agents) {
			for (const agent of agentsData.agents) {
				agentItems.push({
					id: `agent-chat-${agent.id}`,
					type: "agent-chat",
					name: agent.name,
					category: "Agent",
					path: `/chat/${agent.id}`,
					icon: <MessageSquare size={16} />,
				});
				agentItems.push({
					id: `agent-settings-${agent.id}`,
					type: "agent-settings",
					name: agent.name,
					category: "Agent",
					path: `/agents/${agent.id}`,
					icon: <Settings size={16} />,
				});
			}
		}
		return [...actionItems, ...pages, ...settingsSectionItems, ...agentItems];
	}, [agentsData, pages, settingsSectionItems, actionItems]);

	const filteredItems = useMemo(() => {
		if (!debouncedLocalQuery) {
			return allItems.slice(0, MAX_SUGGESTIONS);
		}

		const lowerCaseQuery = debouncedLocalQuery.toLowerCase();
		const filtered = allItems.filter(
			(item) =>
				item.name.toLowerCase().includes(lowerCaseQuery) ||
				item.category.toLowerCase().includes(lowerCaseQuery),
		);

		return filtered.slice(0, MAX_SUGGESTIONS);
	}, [allItems, debouncedLocalQuery]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selected index when filtered items change or palette opens
	useEffect(() => {
		setSelectedIndex(0);
	}, [filteredItems, isCommandPaletteOpen]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!isCommandPaletteOpen) return;

			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				setSelectedIndex(
					(prev) => (prev - 1 + filteredItems.length) % filteredItems.length,
				);
			} else if (event.key === "Enter") {
				event.preventDefault();
				if (filteredItems[selectedIndex]) {
					handleItemClick(filteredItems[selectedIndex]);
				}
			} else if (event.key === "Escape") {
				closeCommandPalette();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [
		isCommandPaletteOpen,
		filteredItems,
		selectedIndex,
		closeCommandPalette,
		handleItemClick,
	]);

	// The CreateAgentDialog is now expected to be rendered globally,
	// e.g., in App.tsx, controlled by isCreateAgentDialogOpen from the store.
	// So, we don't render it here anymore if the palette is closed.
	// We only render the command palette dialog itself.
	if (!isCommandPaletteOpen) {
		return null;
	}

	return (
		<>
			<StyledDialog
				data-tour-tag="command-palette-dialog"
				open={isCommandPaletteOpen}
				onClose={closeCommandPalette}
				aria-labelledby="command-palette-dialog-title"
				fullWidth
				disableRestoreFocus
			>
				<SearchInputContainer>
					<TextField
						autoFocus
						fullWidth
						variant="standard"
						placeholder="Search actions, agents, and pages"
						value={localQuery}
						onChange={handleQueryChange}
						InputProps={textFieldInputProps}
						autoComplete="off"
					/>
				</SearchInputContainer>
				<DialogContent sx={{ padding: 0 }}>
					{filteredItems.length === 0 && debouncedLocalQuery && (
						<Typography
							sx={{ p: 3, textAlign: "center", color: "text.secondary" }}
						>
							No results found.
						</Typography>
					)}
					<ResultsListContainer sx={{ padding: 0.5 }}>
						{filteredItems.map((item, index) => (
							<ListItem
								key={item.id}
								disablePadding
								dense
								sx={{ padding: 0.5 }}
							>
								<ResultItemStyled
									selected={selectedIndex === index}
									onClick={() => handleItemClick(item)}
									onMouseMove={() => setSelectedIndex(index)}
								>
									<ListItemIcon
										sx={{
											minWidth: "20px",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											mr: 1.5,
											color: "text.secondary",
										}}
									>
										{item.icon || <FileText size={16} />}
									</ListItemIcon>
									<ListItemText
										primary={
											<Box
												sx={{ display: "flex", alignItems: "center", gap: 1 }}
											>
												<Typography variant="body2">{item.name}</Typography>
												<Typography variant="caption" color="text.secondary">
													{item.category}
												</Typography>
											</Box>
										}
									/>
									<ActionChip
										label={getActionLabel(item.type)}
										size="small"
										color={getActionColor(item.type)}
										variant="outlined"
									/>
								</ResultItemStyled>
							</ListItem>
						))}
					</ResultsListContainer>
				</DialogContent>
			</StyledDialog>
			<CreateAgentDialog
				open={isCreateAgentDialogOpen} // Controlled by global state
				onClose={closeCreateAgentDialog} // Controlled by global state
				onAgentCreated={handleAgentCreated}
			/>
			<ConfirmationModal
				open={isClearConfirmationOpen}
				title="Clear Conversation"
				message="Are you sure you want to clear this conversation? This action cannot be undone and all messages will be permanently deleted."
				confirmText="Clear"
				cancelText="Cancel"
				isDangerous
				onConfirm={confirmActualClearConversation}
				onCancel={cancelClearConversation}
			/>
		</>
	);
};
