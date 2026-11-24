import { USER_CONTENT_CLASS } from "@shared/analytics/autocapture-privacy";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { Ellipsis, Pin, X } from "lucide-react";
import { type DragEvent, useLayoutEffect, useRef, useState } from "react";
import {
	type WorkspaceTab,
	displayedWorkspaceTabs,
} from "../workspace-tabs-model";

import { WORKSPACE_INACTIVE_MINUTES } from "../workspace-tab-cleanup";

const WORKSPACE_DRAG = "application/x-lo-workspace-tab";

type Props = {
	activeKey?: string;
	activeTitle: string;
	tabs: WorkspaceTab[];
	autoClose: boolean;
	onAutoCloseChange: (enabled: boolean) => void;
	titles: Record<string, string>;
	focusRequested: boolean;
	onFocusHandled: () => void;
	onOpen: (tab: WorkspaceTab) => void;
	onClose: (tab: WorkspaceTab) => void;
	onPin: (key: string) => void;
	onMove: (from: string, to: string) => void;
};

export function WorkspaceTabs({
	activeKey,
	activeTitle,
	tabs,
	autoClose,
	onAutoCloseChange,
	titles,
	focusRequested,
	onFocusHandled,
	onOpen,
	onClose,
	onPin,
	onMove,
}: Props) {
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const pinnedLane = useRef<HTMLDivElement>(null);
	const regularLane = useRef<HTMLDivElement>(null);
	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const draggedKey = useRef<string | null>(null);
	const menuFocusKey = useRef<string>();
	const ordered = displayedWorkspaceTabs(tabs);
	const pinned = ordered.filter((tab) => tab.pinned);
	const regular = ordered.filter((tab) => !tab.pinned);
	const activePosition = ordered.findIndex(({ key }) => key === activeKey);
	const selected = ordered[activePosition];
	const [overflow, setOverflow] = useState(false);
	const title = ({ target, key }: WorkspaceTab) =>
		(key === activeKey && activeTitle) ||
		(target.kind === "session" &&
			sessions.find((row) => row.session_id === target.id)?.title) ||
		titles[key] ||
		t("ui.shell.sidebar_navigation.new_chat");

	useLayoutEffect(() => {
		if (activeKey && activeTitle) titles[activeKey] = activeTitle;
	}, [activeKey, activeTitle, titles]);

	useLayoutEffect(() => {
		const lanes = [pinnedLane.current, regularLane.current].filter(
			(lane) => lane !== null,
		);
		const measure = () =>
			setOverflow(
				tabs.length > 0 &&
					lanes.some((lane) => lane.scrollWidth > lane.clientWidth),
			);
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
		button?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
			container: "nearest",
		} as ScrollIntoViewOptions);
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

	const renderTab = (tab: WorkspaceTab) => {
		const { key } = tab;
		const active = key === activeKey;
		return (
			<div
				key={key}
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
					className="flex h-7 min-w-0 items-center gap-1.5 rounded-sm px-2 text-body-sm"
					aria-current={active ? "page" : undefined}
					onClick={() => onOpen(tab)}
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
					<span className="truncate">{title(tab)}</span>
				</button>
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
			{(overflow || selected) && (
				<DropdownMenu
					onOpenChange={(open) => {
						if (open) menuFocusKey.current = undefined;
					}}
				>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							data-workspace-more=""
							data-titlebar-no-drag=""
							className="relative grid size-7 shrink-0 place-items-center rounded-sm text-ink-muted"
						>
							<Ellipsis aria-hidden="true" className="size-4" />
							<span className="sr-only">
								{overflow
									? t("ui.browser.browser_surface.show_all_tabs")
									: t("ui.browser.browser_tab_strip.tab_actions", {
											title: activeTitle,
										})}
							</span>
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						data-workspace-tab-menu=""
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
										onOpen(tab);
									}}
									aria-current={tab === selected ? "page" : undefined}
								>
									{tab.pinned && (
										<Pin aria-hidden="true" className="size-3 shrink-0" />
									)}
									<span className="max-w-56 truncate">{title(tab)}</span>
								</DropdownMenuItem>
							))}
						{selected && overflow && <DropdownMenuSeparator />}
						{selected && (
							<>
								<DropdownMenuItem
									data-workspace-pin=""
									onSelect={() => {
										menuFocusKey.current = selected.key;
										onPin(selected.key);
									}}
								>
									{t(
										selected.pinned
											? "ui.chat.sidebar.pins.unpin_label"
											: "ui.chat.sidebar.pins.pin_label",
										{ title: title(selected) },
									)}
								</DropdownMenuItem>
								{([-1, 1] as const).map((delta) => {
									const rtl = document.documentElement.dir === "rtl";
									const next = physicalNeighbor(selected, delta, rtl);
									return (
										<DropdownMenuItem
											key={delta}
											disabled={!next}
											onSelect={() => next && onMove(selected.key, next.key)}
										>
											{t(
												delta === -1
													? "ui.browser.chrome.move_left"
													: "ui.browser.chrome.move_right",
											)}
										</DropdownMenuItem>
									);
								})}
								<DropdownMenuItem onSelect={() => onClose(selected)}>
									{t("ui.browser.browser_tab_strip.close_tab")}
								</DropdownMenuItem>
							</>
						)}
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
