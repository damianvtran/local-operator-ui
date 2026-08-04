import { getIconElement } from "@features/command-palette/components/command-palette-utils";
import { DEFAULT_SETTINGS_SECTIONS } from "@features/settings/components/settings-sidebar";
import type { AgentListResult } from "@shared/api/local-operator/types";
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { CreateAgentDialog } from "@shared/components/common/create-agent-dialog";
import {
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogTitle,
	Input,
} from "@shared/components/ui";
import { useAgents } from "@shared/hooks/use-agents";
import { useClearAgentConversation } from "@shared/hooks/use-clear-agent-conversation";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { useAgentRouteParam } from "@shared/hooks/use-route-params";
import { cn } from "@shared/lib/utils";
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

const LIST_ID = "command-palette-results";
const INPUT_ID = "command-palette-input";

/**
 * The verb each row performs, shown on its right edge.
 *
 * A static table rather than a switch: the row renders it, nothing branches on
 * it, and the seven cases are the seven item types.
 */
const ACTION_LABELS: Record<CommandPaletteItemType, string> = {
	page: "Navigate",
	"agent-chat": "Chat",
	"agent-settings": "Configure",
	"settings-section": "Configure",
	"create-agent": "Create",
	"clear-conversation": "Clear",
	"toggle-canvas": "Toggle",
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
		isCreateAgentDialogOpen,
		openCreateAgentDialog,
		closeCreateAgentDialog,
	} = useUiPreferencesStore();

	const { agentId: currentAgentIdFromRoute } = useAgentRouteParam();
	const { getLastAgentId } = useAgentSelectionStore();
	const [localQuery, setLocalQuery] = useState(commandPaletteQuery);
	const debouncedLocalQuery = useDebouncedValue(localQuery, 200);
	const { data: agentsData } = useAgents(1, 10, 0, debouncedLocalQuery) as {
		data?: AgentListResult;
	};
	const clearConversationMutation = useClearAgentConversation();

	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false);

	// Use the agent ID from URL or the last selected agent ID
	const effectiveAgentId = currentAgentIdFromRoute || getLastAgentId("chat");
	const isOnChatPage = location.pathname.startsWith("/chat");

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

	const activeItem = filteredItems[selectedIndex];

	return (
		<>
			<Dialog
				open={isCommandPaletteOpen}
				onOpenChange={(open) => {
					if (!open) closeCommandPalette();
				}}
			>
				<DialogContent
					data-tour-tag="command-palette-dialog"
					showClose={false}
					className="w-150 max-w-[90vw] gap-0 overflow-hidden p-0"
					/*
					 * Focus goes to the query field and stays there. The rows are
					 * driven by `aria-activedescendant` rather than by moving focus,
					 * which is what lets Up/Down browse the list while every keystroke
					 * still reaches the input — the reason this surface exists.
					 */
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						document.getElementById(INPUT_ID)?.focus();
					}}
				>
					{/* The palette announces itself; the title is not drawn, because the
					    field's placeholder already says what to do. */}
					<DialogTitle className="sr-only">Command palette</DialogTitle>

					<div className="relative border-hairline border-b p-3">
						<LucideSearch
							size={16}
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-6 -translate-y-1/2 text-ink-dim"
						/>
						<Input
							id={INPUT_ID}
							inputSize="lg"
							role="combobox"
							aria-expanded={true}
							aria-controls={LIST_ID}
							aria-activedescendant={activeItem?.id}
							aria-autocomplete="list"
							autoComplete="off"
							placeholder="Search actions, agents, and pages"
							value={localQuery}
							onChange={(event) => setLocalQuery(event.target.value)}
							className={cn(
								"border-0 bg-transparent pl-9",
								localQuery && "pr-9",
							)}
						/>
						{localQuery && (
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Clear search"
								onClick={() => setLocalQuery("")}
								className="absolute top-1/2 right-4 -translate-y-1/2"
							>
								<X aria-hidden="true" />
							</Button>
						)}
					</div>

					{filteredItems.length === 0 ? (
						<p className="p-6 text-center text-body-sm text-ink-muted">
							{debouncedLocalQuery
								? `Nothing matches "${debouncedLocalQuery}".`
								: "Nothing to show."}
						</p>
					) : (
						<div
							// biome-ignore lint/a11y/useSemanticElements: `select`/`option` is a native popup control, not a listbox whose rows are browsed by aria-activedescendant while focus stays in a text field.
							role="listbox"
							id={LIST_ID}
							aria-label="Results"
							/* Focusable only programmatically: the query field keeps focus,
							   and this is here so the container can be scrolled into view. */
							tabIndex={-1}
							className="max-h-100 overflow-y-auto p-2"
						>
							{filteredItems.map((item, index) => (
								<button
									key={item.id}
									id={item.id}
									type="button"
									// biome-ignore lint/a11y/useSemanticElements: an `option` element is only valid inside `select`/`datalist`; these rows carry icons, a category and a verb badge.
									role="option"
									aria-selected={selectedIndex === index}
									/* Out of the tab order on purpose: focus belongs to the
									   query field, and Up/Down is how the list is walked. */
									tabIndex={-1}
									onClick={() => handleItemClick(item)}
									onMouseMove={() => setSelectedIndex(index)}
									className={cn(
										"flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left",
										"transition-colors duration-fast ease-out-quart",
										selectedIndex === index
											? "bg-accent-wash"
											: "bg-transparent",
									)}
								>
									<span className="flex size-4 shrink-0 items-center justify-center text-ink-dim">
										{item.icon || <FileText size={16} aria-hidden="true" />}
									</span>
									<span className="min-w-0 flex-1 truncate text-body-sm text-ink">
										{item.name}
									</span>
									<span className="shrink-0 text-ink-dim text-meta">
										{item.category}
									</span>
									{/*
									 * Only the destructive row is coloured. Seven categories in
									 * seven hues taught the eye nothing — the verb is written
									 * out — while red on "Clear" is information.
									 */}
									<Badge
										variant={
											item.type === "clear-conversation" ? "danger" : "neutral"
										}
										className="shrink-0"
									>
										{ACTION_LABELS[item.type]}
									</Badge>
								</button>
							))}
						</div>
					)}
				</DialogContent>
			</Dialog>
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
