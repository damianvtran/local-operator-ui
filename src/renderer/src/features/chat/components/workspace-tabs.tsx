import { USER_CONTENT_CLASS } from "@shared/analytics/autocapture-privacy";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@shared/components/ui";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@shared/components/ui/context-menu";
import { Skeleton } from "@shared/components/ui/skeleton";
import { t } from "@shared/i18n";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { ChevronDown, Ellipsis, Pin, X } from "lucide-react";
import {
	type DragEvent,
	Fragment,
	type KeyboardEvent,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type WorkspaceBulkClose,
	type WorkspaceTab,
	displayedWorkspaceTabs,
	resolveWorkspaceTabTitle,
	workspaceBulkCloseKeys,
} from "../workspace-tabs-model";

import { WORKSPACE_INACTIVE_MINUTES } from "../workspace-tab-cleanup";
import { ChatRowTitle } from "./chat-row-title";
import { createWorkspaceTabReveal } from "./workspace-tab-reveal";

const WORKSPACE_DRAG = "application/x-lo-workspace-tab";

type Props = {
	viewport: { pinned: number; regular: number };
	activeKey?: string;
	/** The open conversation's REAL name, or null while it has none (never a placeholder). */
	activeTitle: string | null;
	tabs: WorkspaceTab[];
	autoClose: boolean;
	onAutoCloseChange: (enabled: boolean) => void;
	titles: Record<string, string>;
	/** Records a real name a tab has shown, so it is kept and saved (`useWorkspaceTabs`). */
	onTitleSeen: (key: string, title: string | null) => void;
	focusRequested: boolean;
	onFocusHandled: () => void;
	onOpen: (tab: WorkspaceTab) => void;
	onClose: (tab: WorkspaceTab) => void;
	onCloseMany: (keys: string[]) => void;
	onPin: (key: string) => void;
	onMove: (from: string, to: string) => void;
};

/** A separator goes before the first entry of each group after the first (D3). */
function startsGroup(entries: readonly { group: string }[], index: number) {
	return index > 0 && entries[index - 1].group !== entries[index].group;
}

export function WorkspaceTabs({
	viewport,
	activeKey,
	activeTitle,
	tabs,
	autoClose,
	onAutoCloseChange,
	titles,
	onTitleSeen,
	focusRequested,
	onFocusHandled,
	onOpen,
	onClose,
	onCloseMany,
	onPin,
	onMove,
}: Props) {
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const pinnedLane = useRef<HTMLDivElement>(null);
	const regularLane = useRef<HTMLDivElement>(null);
	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const draggedKey = useRef<string | null>(null);
	const menuFocusKey = useRef<string>();
	const strip = useRef<HTMLElement>(null);
	const reveal = useRef<ReturnType<typeof createWorkspaceTabReveal>>();
	const tabMenuByKeyboard = useRef(false);
	const tabMenuActed = useRef(false);
	const ordered = displayedWorkspaceTabs(tabs);
	const pinned = ordered.filter((tab) => tab.pinned);
	const regular = ordered.filter((tab) => !tab.pinned);
	const activePosition = ordered.findIndex(({ key }) => key === activeKey);
	const activeTab = ordered[activePosition];
	// Pins survive "close all" by contract; the item disables when only pins remain.
	const closeAllKeys = workspaceBulkCloseKeys(tabs, "", "all", false);
	const [overflow, setOverflow] = useState(false);
	const savedTabs = useUiPreferencesStore((state) => state.workspaceTabs);
	/*
	 * The catalogue has SETTLED once a head answer landed (`head.at` is its
	 * stamp) or the read failed (`error`). Until then a tab with no known name
	 * is loading, not "New chat"; after it, an absent row settles to the
	 * fallback so a gone conversation never shimmers forever.
	 */
	const catalogueSettled = useCanonicalSessionsStore(
		(state) => state.head.at > 0 || state.error !== null,
	);
	const resolveTitle = ({ target, key }: WorkspaceTab) =>
		resolveWorkspaceTabTitle({
			target,
			activeTitle: key === activeKey ? activeTitle : undefined,
			catalogueTitle:
				target.kind === "session"
					? sessions.find((row) => row.session_id === target.id)?.title
					: undefined,
			sessionTitle: titles[key],
			savedTitle:
				target.kind === "session"
					? savedTabs.find((row) => row.id === target.id)?.title
					: undefined,
			catalogueSettled,
		});
	/** Plain text for labels; a loading tab reads "Loading conversation". */
	const title = (tab: WorkspaceTab) => {
		const resolved = resolveTitle(tab);
		if (resolved.kind === "title") return resolved.text;
		return resolved.kind === "loading"
			? t("ui.chat.canonical.loading.region_label")
			: t("ui.shell.sidebar_navigation.new_chat");
	};
	/*
	 * The visible title slot. A loading tab draws the shared Skeleton at a
	 * FIXED width so the strip does not reflow when names arrive in a burst;
	 * the sr-only text keeps the button's accessible name.
	 */
	const titleSlot = (tab: WorkspaceTab, placement: "strip" | "menu") => {
		const resolved = resolveTitle(tab);
		if (resolved.kind === "loading") {
			return (
				<span
					data-workspace-tab-title-loading=""
					aria-busy="true"
					className="flex items-center"
				>
					<Skeleton aria-hidden="true" className="h-2.5 w-20" />
					<span className="sr-only">{title(tab)}</span>
				</span>
			);
		}
		// Only the actual name on the strip needs hover reading. Keep menu
		// labels and placeholder names static, and never pan the tab controls.
		if (placement === "strip" && resolved.kind === "title") {
			return <ChatRowTitle text={resolved.text} variant="workspace-tab" />;
		}
		return (
			<span className={placement === "menu" ? "max-w-56 truncate" : "truncate"}>
				{title(tab)}
			</span>
		);
	};

	/*
	 * Remember every real name each tab has shown: the open conversation's
	 * header and every catalogue row the strip can see. A row that later falls
	 * off the head page (activity reorders it) then still names its tab - the
	 * operator's mid-session "New chat" tabs were exactly that fall-off.
	 */
	useLayoutEffect(() => {
		if (activeKey && activeTitle) onTitleSeen(activeKey, activeTitle);
	}, [activeKey, activeTitle, onTitleSeen]);
	useLayoutEffect(() => {
		for (const tab of tabs) {
			if (tab.target.kind !== "session") continue;
			const id = tab.target.id;
			onTitleSeen(
				tab.key,
				sessions.find((row) => row.session_id === id)?.title ?? null,
			);
		}
	}, [tabs, sessions, onTitleSeen]);

	useLayoutEffect(() => {
		if (!strip.current) return;
		const pinned = pinnedLane.current;
		const regular = regularLane.current;
		// Restore before painting or measuring the selection; revealing an
		// already visible tab must not animate from a new scrollport's zero.
		if (pinned && viewport.pinned) pinned.scrollLeft = viewport.pinned;
		if (regular && viewport.regular) regular.scrollLeft = viewport.regular;
		const controller = createWorkspaceTabReveal(strip.current);
		reveal.current = controller;
		return () => {
			// Layout cleanup can still read the outgoing scrollports. Pinning can
			// create or replace a lane without remounting the strip, so sample the
			// current refs, not the setup-time nodes or an animation's destination.
			viewport.pinned = pinnedLane.current?.scrollLeft ?? 0;
			viewport.regular = regularLane.current?.scrollLeft ?? 0;
			controller.dispose();
			reveal.current = undefined;
		};
	}, [viewport]);

	useLayoutEffect(() => {
		// The title button is only part of the painted row: the active More and
		// Close siblings must fit too. The row can remount on pin/unpin.
		const row = activeTab
			? buttons.current
					.get(activeTab.key)
					?.closest<HTMLElement>("[data-workspace-tab]")
			: null;
		reveal.current?.select(row ?? null);
	}, [activeTab]);

	useLayoutEffect(() => {
		const lanes = [pinnedLane.current, regularLane.current].filter(
			(lane) => lane !== null,
		);
		const measure = () => {
			setOverflow(
				tabs.length > 0 &&
					lanes.some((lane) => lane.scrollWidth > lane.clientWidth),
			);
			// Siblings count: a preceding title can move the active row without
			// changing its width. The same observation serves both jobs.
			reveal.current?.layoutChanged();
		};
		measure();
		const observer = new ResizeObserver(measure);
		for (const lane of lanes) {
			observer.observe(lane);
			for (const tab of lane.children) observer.observe(tab);
		}
		return () => observer.disconnect();
	}, [tabs]);

	useLayoutEffect(() => {
		const button =
			activePosition >= 0 && activeKey
				? buttons.current.get(activeKey)
				: undefined;
		if (button && focusRequested) {
			button.focus({ preventScroll: true });
			onFocusHandled();
		}
	}, [activeKey, activePosition, focusRequested, onFocusHandled]);

	const physicalNeighbor = (tab: WorkspaceTab, delta: number, rtl: boolean) => {
		const lane = tab.pinned ? pinned : regular;
		return lane[
			lane.findIndex((item) => item.key === tab.key) + (rtl ? -delta : delta)
		];
	};
	// Menus portal outside the strip, so read the direction the strip renders in.
	const stripRtl = () =>
		strip.current
			? getComputedStyle(strip.current).direction === "rtl"
			: document.documentElement.dir === "rtl";

	/**
	 * ONE action list for a tab, drawn by both openers: the right-click
	 * ContextMenu and the in-tab ellipsis DropdownMenu. The two Radix primitives
	 * need their own item components, so this returns data rather than JSX and
	 * each opener maps it onto its own item; the labels, enablement and actions
	 * cannot drift between them. Left/right follow the rendered direction.
	 *
	 * `group` is the menu's grouping, Pin | Move left, Move right | the five
	 * closes (design round 1, D3): the grouping browser tab menus use, drawn with
	 * the menu's own separator by both openers (`menuGroupBreaks`).
	 */
	const tabMenuEntries = (tab: WorkspaceTab) => {
		const rtl = stripRtl();
		const bulk = (action: WorkspaceBulkClose, label: string) => {
			const keys = workspaceBulkCloseKeys(tabs, tab.key, action, rtl);
			return {
				id: `close-${action}`,
				group: "close",
				label,
				disabled: keys.length === 0,
				run: () => onCloseMany(keys),
			};
		};
		const move = (delta: -1 | 1) => {
			const next = physicalNeighbor(tab, delta, rtl);
			return {
				id: delta === -1 ? "move-left" : "move-right",
				group: "move",
				label: t(
					delta === -1
						? "ui.browser.chrome.move_left"
						: "ui.browser.chrome.move_right",
				),
				disabled: !next,
				run: () => next && onMove(tab.key, next.key),
			};
		};
		return [
			{
				id: "pin",
				group: "pin",
				label: t(
					tab.pinned ? "ui.chat.header.unpin_tab" : "ui.chat.header.pin_tab",
				),
				disabled: false,
				run: () => onPin(tab.key),
			},
			move(-1),
			move(1),
			{
				id: "close",
				group: "close",
				label: t("ui.browser.browser_tab_strip.close_tab"),
				disabled: false,
				run: () => onClose(tab),
			},
			bulk("others", t("ui.chat.header.close_other_tabs")),
			bulk("left", t("ui.chat.header.close_tabs_left")),
			bulk("right", t("ui.chat.header.close_tabs_right")),
			bulk("all", t("ui.chat.header.close_all_tabs")),
		];
	};
	// Radix restores focus to the menu's trigger after a delay. After an act that
	// would undo the hook's focus handoff, and for the context menu the trigger
	// is the non-focusable tab row; so focus the opening tab's own button. A
	// dismissed ellipsis menu keeps Radix's default (back to the ellipsis). When
	// an act removed the opener, the hook's focus request owns the outcome.
	const restoreTabFocus = (event: Event, opener: string, row: boolean) => {
		const acted = tabMenuActed.current;
		tabMenuActed.current = false;
		tabMenuByKeyboard.current = false;
		if (!acted && !row) return;
		event.preventDefault();
		const button = buttons.current.get(opener);
		if (button?.isConnected) button.focus({ preventScroll: true });
	};
	const runTabEntry = (run: () => void) => () => {
		tabMenuActed.current = true;
		run();
	};
	/**
	 * Shift+F10 and the ContextMenu key open the same menu as a right-click.
	 * Stated rather than left to the browser (as in canonical-transcript and
	 * accent-row): Chromium only sometimes turns them into `contextmenu`, and
	 * entering Radix's own handler keeps one menu and one positioning path.
	 */
	const openTabMenuFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
			return false;
		event.preventDefault();
		tabMenuByKeyboard.current = true;
		const box = event.currentTarget.getBoundingClientRect();
		event.currentTarget.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				clientX: box.left,
				clientY: box.bottom,
			}),
		);
		return true;
	};

	const acceptDrop = (event: DragEvent, tab: WorkspaceTab) => {
		const source = ordered.find((item) => item.key === draggedKey.current);
		if (
			source &&
			source !== tab &&
			source.pinned === tab.pinned &&
			event.dataTransfer.types.includes(WORKSPACE_DRAG)
		) {
			event.preventDefault();
			return source;
		}
	};

	const menuVisibilityChanged = (open: boolean) =>
		reveal.current?.menuChanged(open);
	const openTab = (tab: WorkspaceTab) => {
		// A click on the already selected tab is still deliberate navigation,
		// including after manually scrolling it out of view.
		if (tab.key === activeKey) {
			const row = buttons.current
				.get(tab.key)
				?.closest<HTMLElement>("[data-workspace-tab]");
			if (row) reveal.current?.select(row, true);
		}
		onOpen(tab);
	};

	const renderTab = (tab: WorkspaceTab) => {
		const { key } = tab;
		const active = key === activeKey;
		const menuContentProps = {
			// Portalled outside the strip's privacy boundary; see the strip menu.
			className: `${USER_CONTENT_CLASS} max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto`,
			onCloseAutoFocus: (event: Event) => restoreTabFocus(event, key, false),
		};
		return (
			<ContextMenu key={key} onOpenChange={menuVisibilityChanged}>
				<ContextMenuTrigger asChild>
					{renderTabRow(tab, active, menuContentProps)}
				</ContextMenuTrigger>
				<ContextMenuContent
					data-workspace-tab-context-menu=""
					onCloseAutoFocus={(event) => restoreTabFocus(event, key, true)}
					className={`${USER_CONTENT_CLASS} max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto`}
					onFocus={(event) => {
						// A keyboard opener lands on the first item, as the sidebar row menu does.
						if (!tabMenuByKeyboard.current) return;
						if (event.target !== event.currentTarget) return;
						tabMenuByKeyboard.current = false;
						event.currentTarget
							.querySelector<HTMLElement>(
								'[role="menuitem"]:not([data-disabled])',
							)
							?.focus();
					}}
				>
					{tabMenuEntries(tab).map((entry, index, entries) => (
						<Fragment key={entry.id}>
							{startsGroup(entries, index) && <ContextMenuSeparator />}
							<ContextMenuItem
								data-workspace-tab-action={entry.id}
								disabled={entry.disabled}
								onSelect={runTabEntry(entry.run)}
							>
								{entry.label}
							</ContextMenuItem>
						</Fragment>
					))}
				</ContextMenuContent>
			</ContextMenu>
		);
	};

	const renderTabRow = (
		tab: WorkspaceTab,
		active: boolean,
		menuContentProps: {
			className: string;
			onCloseAutoFocus: (event: Event) => void;
		},
	) => {
		const { key } = tab;
		return (
			<div
				data-workspace-tab=""
				data-active={active ? "" : undefined}
				data-titlebar-no-drag=""
				onDragOver={(event) => {
					if (acceptDrop(event, tab)) event.dataTransfer.dropEffect = "move";
				}}
				onDrop={(event) => {
					const source = acceptDrop(event, tab);
					if (source) onMove(source.key, key);
					draggedKey.current = null;
				}}
			>
				<button
					ref={(button) => {
						if (button) buttons.current.set(key, button);
						else buttons.current.delete(key);
					}}
					type="button"
					className="flex h-8 min-w-0 items-center gap-1.5 rounded-sm px-2 text-body-sm"
					aria-current={active ? "page" : undefined}
					onClick={() => openTab(tab)}
					draggable
					onDragStart={(event) => {
						// A drag from another window/page cannot open anything or choose a source.
						draggedKey.current = key;
						event.dataTransfer.setData(WORKSPACE_DRAG, "");
						event.dataTransfer.effectAllowed = "move";
					}}
					onDragEnd={() => {
						draggedKey.current = null;
					}}
					onKeyDown={(event) => {
						if (openTabMenuFromKeyboard(event)) return;
						if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
						const rtl =
							getComputedStyle(event.currentTarget).direction === "rtl";
						const delta = event.key === "ArrowLeft" ? -1 : 1;
						if (event.metaKey || event.ctrlKey || event.shiftKey) return;
						event.preventDefault();
						if (event.altKey) {
							const next = physicalNeighbor(tab, delta, rtl);
							if (next) onMove(key, next.key);
						} else {
							const next =
								ordered[ordered.indexOf(tab) + (rtl ? -delta : delta)];
							if (next) onOpen(next);
						}
					}}
				>
					{tab.pinned && <Pin aria-hidden="true" className="size-3 shrink-0" />}
					{titleSlot(tab, "strip")}
				</button>
				{/*
				 * The tab's own actions live INSIDE the tab, beside its close button, so
				 * the control reads as this tab's and not the strip's (operator,
				 * 2026-11-24: the strip-end ellipsis looked like an all-tabs menu yet
				 * acted on the selected tab).
				 *
				 * MOUNTED ON THE ACTIVE TAB ONLY (design round 1, D2; review R2). An
				 * opacity-hidden trigger on every inactive tab kept its 24px in layout
				 * - a 42px dead gap between title and close - and added a third Tab stop
				 * per tab. Inactive tabs reach the same entries by right-click,
				 * Shift+F10 and the ContextMenu key (the ContextMenu around this row).
				 * The width it adds is the active tab's own, as a browser's active tab
				 * shows controls the others do not: the other tabs keep their widths,
				 * and the `max-width` cap means a long title truncates rather than
				 * growing the tab. `scripts/workspace-tabs.test.mjs` holds this.
				 */}
				{active && (
					<DropdownMenu onOpenChange={menuVisibilityChanged}>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								data-workspace-tab-more=""
								className="relative grid size-6 shrink-0 place-items-center rounded-sm"
							>
								<Ellipsis aria-hidden="true" className="size-3" />
								<span className="sr-only">
									{t("ui.browser.browser_tab_strip.tab_actions", {
										title: title(tab),
									})}
								</span>
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							data-workspace-tab-menu=""
							{...menuContentProps}
						>
							{tabMenuEntries(tab).map((entry, index, entries) => (
								<Fragment key={entry.id}>
									{startsGroup(entries, index) && <DropdownMenuSeparator />}
									<DropdownMenuItem
										data-workspace-tab-action={entry.id}
										disabled={entry.disabled}
										onSelect={runTabEntry(entry.run)}
									>
										{entry.label}
									</DropdownMenuItem>
								</Fragment>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				<button
					type="button"
					data-workspace-close=""
					className="relative me-0.5 grid size-6 shrink-0 place-items-center rounded-sm"
					onClick={() => onClose(tab)}
				>
					<X aria-hidden="true" className="size-3" />
					<span className="sr-only">
						{t("ui.browser.browser_tab_strip.close_named_tab", {
							title: title(tab),
						})}
					</span>
				</button>
			</div>
		);
	};
	return (
		<nav
			ref={strip}
			data-workspace-tabs=""
			className={USER_CONTENT_CLASS}
			aria-label={t("ui.command_palette.palette_search.chats")}
		>
			{pinned.length > 0 && (
				<div data-workspace-pinned="" data-titlebar-no-drag="" ref={pinnedLane}>
					{pinned.map(renderTab)}
				</div>
			)}
			{regular.length > 0 && (
				<div
					data-workspace-regular=""
					data-titlebar-no-drag=""
					ref={regularLane}
				>
					{regular.map(renderTab)}
				</div>
			)}
			{/*
			 * STRIP-LEVEL control, deliberately distinct from the per-tab ellipsis:
			 * a chevron at the strip's end (the browser "list all tabs" idiom) that
			 * holds only strip-wide things - the overflowed tab list, "Close all
			 * tabs" (reachable without a right-click) and the auto-close setting.
			 * Per-tab acts live in each tab's own menu, so nothing here acts on
			 * "the selected tab" while looking like it governs every tab.
			 */}
			{tabs.length > 0 && (
				<DropdownMenu
					onOpenChange={(open) => {
						if (open) menuFocusKey.current = undefined;
						menuVisibilityChanged(open);
					}}
				>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							data-workspace-more=""
							data-titlebar-no-drag=""
							className="relative grid size-7 shrink-0 place-items-center rounded-sm text-ink-muted"
						>
							<ChevronDown aria-hidden="true" className="size-4" />
							<span className="sr-only">
								{overflow
									? t("ui.browser.browser_surface.show_all_tabs")
									: t("ui.chat.header.all_tabs")}
							</span>
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						data-workspace-strip-menu=""
						// The portal is outside the strip's privacy boundary. Keep names
						// in text (including sr-only text), since replay masks text, not attributes.
						// One scrollport keeps Radix's full roving list and tail actions reachable.
						className={`${USER_CONTENT_CLASS} max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto`}
						onCloseAutoFocus={(event) => {
							// Radix's delayed restore otherwise undoes the tab's focus handoff.
							const key = menuFocusKey.current;
							const button = key ? buttons.current.get(key) : undefined;
							if (button?.hasAttribute("aria-current")) {
								event.preventDefault();
								button.focus({ preventScroll: true });
							}
						}}
					>
						{overflow &&
							ordered.map((tab) => (
								<DropdownMenuItem
									key={tab.key}
									onSelect={() => {
										menuFocusKey.current = tab.key;
										openTab(tab);
									}}
									aria-current={tab.key === activeKey ? "page" : undefined}
								>
									{tab.pinned && (
										<Pin aria-hidden="true" className="size-3 shrink-0" />
									)}
									{titleSlot(tab, "menu")}
								</DropdownMenuItem>
							))}
						{overflow && <DropdownMenuSeparator />}
						<DropdownMenuItem
							data-workspace-close-all=""
							disabled={closeAllKeys.length === 0}
							onSelect={() => onCloseMany(closeAllKeys)}
						>
							{t("ui.chat.header.close_all_tabs")}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuCheckboxItem
							checked={autoClose}
							onCheckedChange={onAutoCloseChange}
							data-workspace-auto-close=""
						>
							{t("ui.chat.header.auto_close_inactive_tabs", {
								minutes: WORKSPACE_INACTIVE_MINUTES,
							})}
						</DropdownMenuCheckboxItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
			<span
				aria-hidden="true"
				data-workspace-tab-spacer=""
				data-titlebar-drag=""
			/>
		</nav>
	);
}
