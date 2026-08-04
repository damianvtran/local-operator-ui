import { getIconElement } from "@features/command-palette/components/command-palette-utils";
import { DEFAULT_SETTINGS_SECTIONS } from "@features/settings/components/settings-sidebar";
import type { AgentListResult } from "@shared/api/local-operator/types";
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { CreateAgentDialog } from "@shared/components/common/create-agent-dialog";
import {
	Button,
	Dialog,
	DialogContent,
	DialogTitle,
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
import { type FC, Fragment } from "react";
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
	/**
	 * The section this row is filed under, and part of what the query matches.
	 * Rendered once as a heading above its run of rows rather than repeated on
	 * every row, which is how Raycast and Linear keep a mixed result list
	 * readable without a metadata column.
	 */
	category: string;
	/**
	 * Dim text after the name, for rows whose name alone is ambiguous. Every
	 * agent produces two rows with identical names; without this the list shows
	 * the same word twice and the only difference is a 16px glyph.
	 */
	hint?: string;
	path?: string;
	icon?: JSX.Element;
	action?: () => void;
}

/*
 * Sentence case, matching the sidebar: `sidebar-navigation.tsx` already says
 * "My agents" and "Agent hub", and the palette was the only surface still
 * shouting them in Title Case.
 */
const PAGE_DEFINITIONS: Omit<CommandPaletteItem, "id" | "type">[] = [
	{
		name: "Chat",
		path: "/chat",
		category: "Navigation",
		icon: <MessageSquare size={16} />,
	},
	{
		name: "My agents",
		path: "/agents",
		category: "Navigation",
		icon: <Users size={16} />,
	},
	{
		name: "Agent hub",
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
 * What Enter does, shown on the active row only.
 *
 * It used to be a bordered badge on all fifteen rows, which turned the right
 * edge into a column of chips restating information the section heading now
 * carries. On one row it is an instruction; on every row it is wallpaper.
 *
 * A static table rather than a switch: the row renders it, nothing branches on
 * it, and the seven cases are the seven item types.
 */
const ACTION_LABELS: Record<CommandPaletteItemType, string> = {
	page: "Go",
	"agent-chat": "Open",
	"agent-settings": "Open",
	"settings-section": "Open",
	"create-agent": "Create",
	"clear-conversation": "Clear",
	"toggle-canvas": "Toggle",
};

/**
 * A key on the footer bar and on the active row.
 *
 * Monospace because a key legend is machine voice, and `sunken` because a key
 * is a recessed thing — no border, since the ground change already bounds it
 * and this shape repeats five times on one bar.
 */
const Key: FC<{ children: string }> = ({ children }) => (
	<kbd className="rounded-xs bg-sunken px-1 py-0.5 font-mono text-ink-dim text-mono-sm">
		{children}
	</kbd>
);

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
			category: "Settings",
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
			name: "Create agent",
			category: "Actions",
			icon: <Plus size={16} />,
			action: handleCreateAgent,
		});

		// Clear Conversation - only available on chat page with agent ID
		if (isOnChatPage && effectiveAgentId) {
			items.push({
				id: "clear-conversation",
				type: "clear-conversation",
				name: "Clear conversation",
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
				name: isCanvasOpen ? "Close canvas" : "Open canvas",
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
				/*
				 * Two rows per agent, and until now they were the same word twice.
				 * The hint is what tells them apart at a glance, and it is matched
				 * by the query too, so typing "settings ada" finds the right one.
				 */
				agentItems.push({
					id: `agent-chat-${agent.id}`,
					type: "agent-chat",
					name: agent.name,
					hint: "Open chat",
					category: "Agents",
					path: `/chat/${agent.id}`,
					icon: <MessageSquare size={16} />,
				});
				agentItems.push({
					id: `agent-settings-${agent.id}`,
					type: "agent-settings",
					name: agent.name,
					hint: "Agent settings",
					category: "Agents",
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
				item.category.toLowerCase().includes(lowerCaseQuery) ||
				item.hint?.toLowerCase().includes(lowerCaseQuery),
		);

		return filtered.slice(0, MAX_SUGGESTIONS);
	}, [allItems, debouncedLocalQuery]);

	/*
	 * Go back to the top when the query changes or the palette reopens — and
	 * only then.
	 *
	 * This used to key off `filteredItems`, which is a fresh array on every
	 * agents refetch. React Query refetches in the background, so the
	 * selection jumped back to the first row underneath the user at arbitrary
	 * moments: hold Down and it walks two rows and snaps home. On a surface
	 * whose whole purpose is the keyboard, that is the defect.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the triggers, not values the body reads
	useEffect(() => {
		setSelectedIndex(0);
	}, [debouncedLocalQuery, isCommandPaletteOpen]);

	/*
	 * Keep the index inside the list. The list can shrink without the query
	 * changing — an agent is deleted, a chat-only action disappears when the
	 * route changes — and an index past the end selects nothing at all.
	 */
	useEffect(() => {
		setSelectedIndex((prev) =>
			prev >= filteredItems.length
				? Math.max(filteredItems.length - 1, 0)
				: prev,
		);
	}, [filteredItems.length]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!isCommandPaletteOpen) return;
			/*
			 * Stand down while a dialog of our own is in front. Both of these
			 * render above the palette, and the listener is on `window`, so
			 * without this Up and Down walked a list the user could not see and
			 * Enter fired the row they landed on.
			 */
			if (isClearConfirmationOpen || isCreateAgentDialogOpen) return;

			// Modulo by zero is NaN, and a NaN index makes every row unselected
			// with no way back — reachable simply by typing a query that matches
			// nothing and pressing Down.
			const count = filteredItems.length;

			if (event.key === "ArrowDown") {
				event.preventDefault();
				if (count > 0) setSelectedIndex((prev) => (prev + 1) % count);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				if (count > 0) setSelectedIndex((prev) => (prev - 1 + count) % count);
			} else if (event.key === "Home") {
				event.preventDefault();
				setSelectedIndex(0);
			} else if (event.key === "End") {
				event.preventDefault();
				if (count > 0) setSelectedIndex(count - 1);
			} else if (event.key === "Enter") {
				event.preventDefault();
				if (filteredItems[selectedIndex]) {
					handleItemClick(filteredItems[selectedIndex]);
				}
			} else if (event.key === "Escape") {
				event.preventDefault();
				closeCommandPalette();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [
		isCommandPaletteOpen,
		isClearConfirmationOpen,
		isCreateAgentDialogOpen,
		filteredItems,
		selectedIndex,
		closeCommandPalette,
		handleItemClick,
	]);

	/*
	 * Keep the active row on screen.
	 *
	 * The list scrolls at ten rows and the selection is driven by
	 * `aria-activedescendant` rather than by focus, so nothing moved the
	 * viewport for it: holding Down walked the selection straight out of sight
	 * and the palette looked frozen. `nearest` rather than `center` so the list
	 * only moves when it has to.
	 */
	useEffect(() => {
		if (!isCommandPaletteOpen) return;
		const activeId = filteredItems[selectedIndex]?.id;
		if (!activeId) return;
		document
			.getElementById(activeId)
			?.scrollIntoView({ block: "nearest", behavior: "auto" });
	}, [isCommandPaletteOpen, filteredItems, selectedIndex]);

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
					className="w-160 max-w-[90vw] gap-0 overflow-hidden p-0"
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

					{/*
					 * The query field is drawn from parts rather than from `Input`.
					 * A bordered control immediately inside a bordered panel is two
					 * boxes for one thing, so the panel's own edge is the field's
					 * edge — the pattern Raycast, Linear and Spotlight all use. The
					 * glyph is a flex sibling rather than an absolutely positioned
					 * overlay, which is what keeps it on the same 16px left margin as
					 * every row icon below it.
					 */}
					<div className="flex h-13 shrink-0 items-center gap-3 border-hairline border-b px-4">
						<LucideSearch
							size={16}
							aria-hidden="true"
							className="shrink-0 text-ink-dim"
						/>
						<input
							id={INPUT_ID}
							type="text"
							role="combobox"
							aria-expanded={true}
							aria-controls={LIST_ID}
							aria-activedescendant={activeItem?.id}
							aria-autocomplete="list"
							autoComplete="off"
							placeholder="Search actions, agents and pages"
							value={localQuery}
							onChange={(event) => setLocalQuery(event.target.value)}
							/*
							 * No focus ring on this one field. Focus is placed here when
							 * the palette opens and never leaves it — Up and Down move
							 * `aria-activedescendant`, not focus — so the ring would be a
							 * permanent 2px rectangle drawn around a borderless input,
							 * marking the one thing on screen that could not be anywhere
							 * else. The caret and the active row carry the state instead.
							 * The Clear button beside it keeps its ring.
							 *
							 * `!` is load-bearing and not laziness: the app's ring is
							 * re-asserted by an Emotion-injected `html :focus-visible`
							 * rule from the MUI baseline, which is unlayered and so beats
							 * every Tailwind utility in `@layer utilities` regardless of
							 * specificity. An important declaration inside a layer is the
							 * only thing that outranks an unlayered normal one. See
							 * docs/branding.md § 8, "MUI wins specificity fights".
							 */
							className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none! placeholder:text-ink-dim"
						/>
						{localQuery && (
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Clear search"
								onClick={() => setLocalQuery("")}
							>
								<X aria-hidden="true" />
							</Button>
						)}
					</div>

					{filteredItems.length === 0 ? (
						/*
						 * An empty state that says what to do next. "Nothing matches"
						 * is a status; the second line is the part that gets the user
						 * moving again, and it names the three things this palette
						 * actually searches.
						 */
						<div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
							<p className="text-body-sm text-ink">
								{debouncedLocalQuery
									? `No matches for "${debouncedLocalQuery}"`
									: "Nothing to show yet"}
							</p>
							<p className="text-ink-dim text-meta">
								Search for an agent by name, a page such as Schedules, or an
								action such as "create agent".
							</p>
						</div>
					) : (
						<div
							// biome-ignore lint/a11y/useSemanticElements: `select`/`option` is a native popup control, not a listbox whose rows are browsed by aria-activedescendant while focus stays in a text field.
							role="listbox"
							id={LIST_ID}
							aria-label="Results"
							/* Focusable only programmatically: the query field keeps focus,
							   and this is here so the container can be scrolled into view. */
							tabIndex={-1}
							className="max-h-96 overflow-y-auto p-2"
						>
							{filteredItems.map((item, index) => {
								const isActive = selectedIndex === index;
								const isDestructive = item.type === "clear-conversation";
								/*
								 * A heading whenever the run changes. Grouping is what
								 * lets the rows drop their own category column: the
								 * answer to "what kind of thing is this" is two rows up,
								 * written once, instead of fifteen times down the right
								 * edge.
								 */
								const startsSection =
									index === 0 ||
									filteredItems[index - 1].category !== item.category;

								return (
									<Fragment key={item.id}>
										{startsSection && (
											<div
												role="presentation"
												className={cn(
													"px-2 pb-1 text-ink-dim text-meta",
													index === 0 ? "pt-1" : "pt-3",
												)}
											>
												{item.category}
											</div>
										)}
										<button
											id={item.id}
											type="button"
											// biome-ignore lint/a11y/useSemanticElements: an `option` element is only valid inside `select`/`datalist`; these rows carry an icon, a name, a hint and a key legend.
											role="option"
											aria-selected={isActive}
											/* Out of the tab order on purpose: focus belongs to
											   the query field, and Up/Down walks the list. */
											tabIndex={-1}
											onClick={() => handleItemClick(item)}
											onMouseMove={() => setSelectedIndex(index)}
											className={cn(
												"flex h-9 w-full items-center gap-3 rounded-sm px-2 text-left",
												"transition-colors duration-fast ease-out-quart",
												isActive ? "bg-accent-wash" : "bg-transparent",
											)}
										>
											<span
												className={cn(
													"flex size-4 shrink-0 items-center justify-center",
													/* The only colour in the list. Red on the one row
													   that destroys something is information; a hue per
													   category taught the eye nothing. */
													isDestructive ? "text-danger" : "text-ink-dim",
												)}
											>
												{item.icon || <FileText size={16} aria-hidden="true" />}
											</span>
											<span
												className={cn(
													"shrink-0 truncate text-body-sm",
													isDestructive ? "text-danger" : "text-ink",
												)}
											>
												{item.name}
											</span>
											{item.hint && (
												<span className="min-w-0 flex-1 truncate text-ink-dim text-meta">
													{item.hint}
												</span>
											)}
											{!item.hint && <span className="flex-1" />}
											{/* What Enter does, on the active row only. */}
											{isActive && (
												<span className="flex shrink-0 items-center gap-1.5 text-ink-dim text-meta">
													{ACTION_LABELS[item.type]}
													<Key>↵</Key>
												</span>
											)}
										</button>
									</Fragment>
								);
							})}
						</div>
					)}

					{/*
					 * The key legend. Every keyboard-first palette worth copying puts
					 * one here — it is how a mouse user finds out the surface is meant
					 * to be driven from the keyboard, and it costs one 32px bar.
					 */}
					<div className="flex shrink-0 items-center gap-4 border-hairline border-t px-4 py-2 text-ink-dim text-meta">
						<span className="flex items-center gap-1.5">
							<Key>↑</Key>
							<Key>↓</Key>
							to move
						</span>
						<span className="flex items-center gap-1.5">
							<Key>↵</Key>
							to run
						</span>
						<span className="flex items-center gap-1.5">
							<Key>esc</Key>
							to close
						</span>
					</div>
				</DialogContent>
			</Dialog>
			<CreateAgentDialog
				open={isCreateAgentDialogOpen} // Controlled by global state
				onClose={closeCreateAgentDialog} // Controlled by global state
				onAgentCreated={handleAgentCreated}
			/>
			<ConfirmationModal
				open={isClearConfirmationOpen}
				title="Clear this conversation?"
				message="Every message in it is deleted from this computer, and there is no undo. The agent itself is not affected."
				confirmText="Clear"
				cancelText="Cancel"
				isDangerous
				onConfirm={confirmActualClearConversation}
				onCancel={cancelClearConversation}
			/>
		</>
	);
};
