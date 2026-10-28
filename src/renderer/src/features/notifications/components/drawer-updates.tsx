import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
/**
 * The asks drawer's Updates tab and its tab strip (decisions D9, design.md
 * § 18, contract § 6.5).
 *
 * RECONCILE, DON'T ADD. The rail keeps one ask door; its panel gains three
 * tabs, Asks | Updates | All conversations, so "what does this conversation
 * need from me?" stays one question behind one door. All conversations is the
 * existing fleet scope moved into the strip, so scope and kind are one control.
 *
 * THE DRAWER'S LIST IS NOT AN ANCHOR. It overlays part of the transcript, so
 * a flag line under it is covered (design § 17.3), and a row here becomes
 * read only by an explicit action.
 *
 * GATED: without `features.notifications` the strip is absent and the drawer
 * renders exactly as before (contract § 6.5).
 */
import { Badge, Button } from "@shared/components/ui";
import { Tooltip } from "@shared/components/ui/tooltip";
import { formatNumber, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import { useQuery } from "@tanstack/react-query";
import {
	Check,
	ChevronUp,
	ChevronsUp,
	Circle,
	ExternalLink,
	X,
} from "lucide-react";
import {
	type FC,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import type { DesktopNotificationItem } from "../../../../../shared/desktop-control-contract";
import { useDrawerBackToTop } from "../drawer-tab-store";
import {
	notificationKeys,
	readSessionUnreadCount,
	tokensOf,
	useNotificationsWrite,
	useSessionNotifications,
} from "../notifications-api";
import { UNDO_WINDOW_MS, rowTimeOf, seenMarkOf } from "../notifications-model";
import { RowAction, rowTimeText } from "./notification-row";
import { PriorityBars } from "./priority-bars";

export type DrawerTab = "asks" | "updates" | "all";

/**
 * The default tab (design § 18): Asks if a live ask exists, else Updates.
 * In fleet scope the strip opens on All conversations.
 */
export const defaultDrawerTab = (
	scope: "session" | "fleet",
	liveAsks: number,
): DrawerTab => (scope === "fleet" ? "all" : liveAsks > 0 ? "asks" : "updates");

export const DrawerTabs: FC<{
	tab: DrawerTab;
	onTab: (tab: DrawerTab) => void;
	asks: number;
	unreadUpdates: number;
	/** No conversation is open: only All conversations applies. */
	sessionless: boolean;
}> = ({ tab, onTab, asks, unreadUpdates, sessionless }) => {
	useI18nLocale();
	const tabs: { id: DrawerTab; label: string; count: number }[] = [
		{ id: "asks", label: t("ui.notifications.drawer.tab.asks"), count: asks },
		{
			id: "updates",
			label: t("ui.notifications.drawer.tab.updates"),
			count: unreadUpdates,
		},
		{ id: "all", label: t("ui.notifications.drawer.tab.all"), count: 0 },
	];
	const shown = sessionless ? tabs.filter((entry) => entry.id === "all") : tabs;
	/* Ctrl+Tab / Ctrl+Shift+Tab and the arrows cycle (design § 18). */
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const step =
			event.key === "ArrowRight" ||
			(event.key === "Tab" && event.ctrlKey && !event.shiftKey)
				? 1
				: event.key === "ArrowLeft" ||
						(event.key === "Tab" && event.ctrlKey && event.shiftKey)
					? -1
					: 0;
		if (step === 0) return;
		event.preventDefault();
		const index = shown.findIndex((entry) => entry.id === tab);
		const next = shown[(index + step + shown.length) % shown.length];
		onTab(next.id);
		(
			event.currentTarget.querySelector(
				`[data-drawer-tab="${next.id}"]`,
			) as HTMLElement | null
		)?.focus();
	};
	return (
		<div
			className="flex shrink-0 flex-col gap-1 border-hairline border-b px-2 pb-1"
			onKeyDown={onKeyDown}
		>
			{/* Scope is its own full-width control: long translations cannot
			    squeeze three unrelated labels into one 360px line (D1/U1). */}
			<button
				type="button"
				aria-pressed={tab === "all"}
				data-drawer-tab="all"
				onClick={() => onTab("all")}
				className={cn(
					"min-h-8 w-full whitespace-normal rounded-sm px-2 py-1 text-start text-body-sm",
					tab === "all"
						? "bg-row-selected text-ink"
						: "text-ink-muted hover:bg-row-hover",
				)}
			>
				{t("ui.notifications.drawer.tab.all")}
			</button>
			{!sessionless && (
				<div
					role="tablist"
					aria-label={t("ui.notifications.drawer.tabs_label")}
					className="flex min-w-0 gap-1"
				>
					{tabs
						.filter((entry) => entry.id !== "all")
						.map((entry) => (
							<button
								key={entry.id}
								type="button"
								role="tab"
								aria-selected={tab === entry.id}
								tabIndex={
									tab === entry.id || (tab === "all" && entry.id === "asks")
										? 0
										: -1
								}
								data-drawer-tab={entry.id}
								onClick={() => onTab(entry.id)}
								className={cn(
									"flex min-h-8 min-w-0 flex-1 flex-wrap items-center justify-center gap-1 border-b-2 px-2 py-1 text-body-sm",
									tab === entry.id
										? "border-accent text-ink"
										: "border-transparent text-ink-muted hover:text-ink",
								)}
							>
								<span className="min-w-0 whitespace-normal break-words">
									{entry.label}
								</span>
								{entry.count > 0 && (
									<Badge
										variant="neutral"
										size="count"
										className="h-auto max-w-full whitespace-normal break-words text-center"
									>
										{entry.id === "updates"
											? t("ui.notifications.drawer.unread_count", {
													count: formatNumber(entry.count),
												})
											: formatNumber(entry.count)}
									</Badge>
								)}
							</button>
						))}
				</div>
			)}
		</div>
	);
};

/**
 * The drawer's back-to-top chip, for the drawer's chrome bar (design round 6, D2).
 *
 * IN THE FIXED 40 PX BAR, NOT THE LIST OR THE TAB ROW. A band above the list, then an
 * overlay on it, cost the narrow drawer most of its 47 px scroll port at 200 % text;
 * the tab row is already full at 360 px, so a chip there wraps onto a new line and
 * the list shrinks by that line. The chrome bar has a fixed height and a truncating
 * scope label, so the chip takes the label's room and none of the list's. The
 * Updates list publishes the count and the action (`useDrawerBackToTop`); this only
 * draws them, and only on the Updates tab. The chevron says "up, to the top"
 * without new copy (D4 deferred).
 */
export const DrawerBackToTop: FC<{ tab: DrawerTab }> = ({ tab }) => {
	useI18nLocale();
	const newerCount = useDrawerBackToTop((state) => state.count);
	const backToTop = useDrawerBackToTop((state) => state.backToTop);
	if (tab !== "updates" || !backToTop || newerCount === 0) return null;
	return (
		<Button
			size="sm"
			variant="secondary"
			className="shrink-0"
			data-drawer-back-to-top=""
			onClick={backToTop}
		>
			<ChevronUp aria-hidden="true" />
			{t("ui.notifications.new_pill", { count: formatNumber(newerCount) })}
		</Button>
	);
};

/**
 * This conversation's unread count, for the tab and the rail door - FROM THE SERVER
 * (code round 4, R4-6). It counted the rows the drawer had loaded, and the drawer
 * pages on scroll, so a conversation with 450 unread showed 100: the badge stopped
 * at one page. The walk is bounded by the unread set itself and stops at the last
 * cursor, so its cost follows the unread count rather than the conversation.
 */
export function useSessionUnreadUpdates(
	sessionId: string | null,
	enabled: boolean,
): number {
	const list = useSessionNotifications(sessionId, enabled);
	const boundary = list.data?.high_water;
	const count = useQuery({
		/* Under the shared key, so an optimistic write moves this with the rows. */
		queryKey: [...notificationKeys.sessionUnread(sessionId), boundary],
		enabled: enabled && Boolean(sessionId) && boundary !== undefined,
		queryFn: () => readSessionUnreadCount(sessionId as string),
		retry: retryDesktopQuery,
		staleTime: 5_000,
		/*
		 * KEEP THE LAST COUNT ACROSS A BOUNDARY MOVE. Every write moves the boundary,
		 * so the key changes and the walk restarts; without the previous answer the
		 * tab's count blinked to nothing between the click and the walk's answer.
		 */
		placeholderData: (previous) => previous,
	});
	/* Unknown while the walk settles: the page's own rows would under-count. */
	return count.data ?? 0;
}

/**
 * Unread is the inbox, Read the history (operator report: "it was never clear
 * what was read and what was unread"). One list holding both, split by two
 * headings, made a mark-read look like nothing happened - the row only changed
 * groups a few rows away. With the split as a view, marking read takes the row
 * out of the Unread view, which is the visible receipt of the click.
 */
export type DrawerReadView = "unread" | "read";

export const DrawerUpdates: FC<{
	sessionId: string;
	nowMs?: number;
	/** Stories and evidence pin the opening view; the operator always starts on Unread. */
	initialView?: DrawerReadView;
}> = ({ sessionId, nowMs: pinnedNow, initialView = "unread" }) => {
	useI18nLocale();
	const navigate = useNavigate();
	const [view, setView] = useState<DrawerReadView>(initialView);
	/* The server's count, the same figure the Updates tab prints (R4-6). */
	const unreadCount = useSessionUnreadUpdates(sessionId, true);
	const [isAtTop, setIsAtTop] = useState(true);
	const list = useSessionNotifications(sessionId, true, { atTop: isAtTop });
	const write = useNotificationsWrite();
	const nowMs = pinnedNow ?? Date.now();
	/*
	 * THE DRAWER GETS THE SAME BACK-TO-TOP AS THE REEL (QA round 4, R6-2). Its list
	 * pages under the same window, so rows that arrive while it is scrolled deep are
	 * not drawn above the viewport; without this the only way back to the newest
	 * update was closing the drawer. The chip itself is drawn by `DrawerTabs` (D2).
	 * The ref keeps the published callback stable, so publishing cannot re-render
	 * this list.
	 */
	const publishBackToTop = useDrawerBackToTop((state) => state.publish);
	const resetRef = useRef(list.resetToTop);
	resetRef.current = list.resetToTop;
	const backToTop = useCallback(() => {
		document
			.querySelector<HTMLElement>("[data-drawer-updates]")
			?.scrollTo({ top: 0, behavior: "smooth" });
		setIsAtTop(true);
		void resetRef.current();
	}, []);
	useEffect(() => {
		publishBackToTop(list.newerCount, list.newerCount > 0 ? backToTop : null);
	}, [list.newerCount, backToTop, publishBackToTop]);
	useEffect(() => () => publishBackToTop(0, null), [publishBackToTop]);
	const rows = useMemo(
		() =>
			(list.data?.items ?? [])
				.filter((item) => !item.dismissed)
				.sort((a, b) => b.updated_at - a.updated_at),
		[list.data],
	);
	const unread = rows.filter((item) => !item.read);
	const read = rows.filter((item) => item.read);
	const showInConversation = (item: DesktopNotificationItem) => {
		const line = document.querySelector<HTMLElement>(
			`[data-notification-flag="${CSS.escape(item.id)}"]`,
		);
		line?.scrollIntoView({ block: "center", behavior: "smooth" });
		line?.animate?.(
			[
				{ backgroundColor: "var(--color-accent-wash)" },
				{ backgroundColor: "transparent" },
			],
			{ duration: 900, easing: "ease-out" },
		);
	};
	if (list.isLoading)
		return (
			<p className="p-3 text-body-sm text-ink-muted">
				{t("ui.notifications.page.loading")}
			</p>
		);
	if (list.isError && !list.data)
		return (
			<div className="p-3 text-body-sm text-ink-muted">
				<p>{t("ui.notifications.error.load.title")}</p>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => void list.refetch()}
				>
					{t("ui.notifications.error.retry")}
				</Button>
			</div>
		);
	/*
	 * ONE WRITE PATH FOR THE TAB, WITH ITS RECEIPT (design audit OD3).
	 *
	 * Every row action - `R`/`U`/`E` and the new pointer controls - goes through
	 * here. Before this, the keyboard wrote straight through `write.mutate` with
	 * only an `onError`: a dismiss from this tab was silent on success and could
	 * not be undone, which contradicted design § 0.8 ("every destructive action
	 * can be undone for 6 s") and made the tab the one surface where a mis-key
	 * lost a row without a word. The inverse is the same operation in the other
	 * direction, so Undo is one more write rather than a special case.
	 */
	const applyWrite = (
		item: DesktopNotificationItem,
		verb: "read" | "unread" | "dismiss",
	) => {
		const inverse =
			verb === "dismiss" ? "undismiss" : verb === "read" ? "unread" : "read";
		write.mutate(
			{ verb, target: { items: tokensOf([item]) } },
			{
				onSuccess: () => {
					showInfoToast(
						verb === "dismiss"
							? t("ui.notifications.toast.dismissed", { count: 1 })
							: verb === "read"
								? t("ui.notifications.toast.marked_read", {
										count: formatNumber(1),
									})
								: t("ui.notifications.toast.marked_unread", {
										count: formatNumber(1),
									}),
						{
							duration: UNDO_WINDOW_MS,
							action: {
								label: t("ui.notifications.toast.undo"),
								onClick: () =>
									write.mutate({
										verb: inverse as "read" | "unread" | "undismiss",
										target: { items: tokensOf([item]) },
									}),
							},
						},
					);
				},
				onError: () => showErrorToast(t("ui.notifications.error.mark")),
			},
		);
	};
	/*
	 * MARK ALL READ GETS THE SAME RECEIPT AND UNDO AS ONE ROW (design § 0.8). It
	 * names the rendered rows by revision, so the inverse is exactly the ids the
	 * server confirmed at the revisions the click saw - a row revised since stays
	 * out of the Undo, as the reel's ledger does.
	 */
	const markAllRead = () => {
		const tokens = tokensOf(unread);
		write.mutate(
			{ verb: "read", target: { items: tokens } },
			{
				onSuccess: (result) => {
					const changed = new Set(result.changed);
					const undo = tokens.filter((token) => changed.has(token.id));
					if (undo.length === 0) return;
					showInfoToast(
						t("ui.notifications.toast.marked_read", {
							count: formatNumber(undo.length),
						}),
						{
							duration: UNDO_WINDOW_MS,
							action: {
								label: t("ui.notifications.toast.undo"),
								onClick: () =>
									write.mutate({ verb: "unread", target: { items: undo } }),
							},
						},
					);
				},
				onError: () => showErrorToast(t("ui.notifications.error.mark")),
			},
		);
	};
	const shown = view === "unread" ? unread : read;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<DrawerReadViews
				view={view}
				onView={setView}
				unreadCount={unreadCount}
				action={
					view === "unread" && unread.length > 0 ? (
						<Button
							variant="ghost"
							size="sm"
							className="shrink-0"
							data-drawer-mark-all-read=""
							disabled={list.isError}
							onClick={markAllRead}
						>
							{t("ui.notifications.drawer.mark_read")}
						</Button>
					) : null
				}
			/>
			<div
				data-drawer-updates=""
				className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 py-2"
				onScroll={(event) => {
					/*
					 * PAGED, NOT FIRST-100-ONLY (code audit DC6): older rows in a loud
					 * session become reachable by scrolling, exactly as the reel's list
					 * already does. The query keys the pages on the first boundary, so
					 * this cannot skip or duplicate rows as the session keeps writing.
					 */
					const box = event.currentTarget;
					setIsAtTop(box.scrollTop <= 24);
					if (
						list.hasNextPage &&
						!list.isFetchingNextPage &&
						box.scrollHeight - box.scrollTop - box.clientHeight < 160
					)
						void list.fetchNextPage();
				}}
				onKeyDown={(event) => {
					const target = event.target as HTMLElement;
					const row = target.closest<HTMLElement>("[data-drawer-update]");
					if (!row) return;
					const index = shown.findIndex(
						(item) => item.id === row.dataset.drawerUpdate,
					);
					const item = shown[index];
					if (!item) return;
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						const next =
							shown[
								Math.max(
									0,
									Math.min(
										shown.length - 1,
										index + (event.key === "ArrowDown" ? 1 : -1),
									),
								)
							];
						event.currentTarget
							.querySelector<HTMLElement>(
								`[data-drawer-update="${CSS.escape(next.id)}"] button`,
							)
							?.focus();
					} else if (
						["r", "u", "e"].includes(event.key.toLowerCase()) &&
						!list.isError
					) {
						event.preventDefault();
						applyWrite(
							item,
							event.key.toLowerCase() === "e"
								? "dismiss"
								: event.key.toLowerCase() === "u"
									? "unread"
									: "read",
						);
					}
				}}
			>
				{shown.length === 0 ? (
					<p
						className="px-3 py-8 text-center text-body-sm text-ink-muted"
						data-drawer-empty={view}
					>
						{/* Nothing at all is one sentence; an empty inbox is "caught up". */}
						{rows.length === 0
							? t("ui.notifications.drawer.empty")
							: view === "unread"
								? t("ui.notifications.empty.caught_up.title")
								: t("ui.notifications.drawer.empty")}
					</p>
				) : (
					<ul className="flex flex-col" data-drawer-view-list={view}>
						{shown.map((item) => (
							<DrawerRow
								key={item.id}
								item={item}
								nowMs={nowMs}
								onShow={showInConversation}
								onToggleRead={() =>
									applyWrite(item, item.read ? "unread" : "read")
								}
								onDismiss={() => applyWrite(item, "dismiss")}
								paused={list.isError}
							/>
						))}
					</ul>
				)}
			</div>
			<div className="flex shrink-0 items-center justify-between gap-2 border-hairline border-t px-3 py-2 text-meta">
				{/* Wraps rather than truncates: at the drawer's 320-360px widths the
				    note lost its last word, and the button beside it never shrinks. */}
				<span className="min-w-0 text-ink-dim">
					{t("ui.notifications.drawer.footer")}
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="shrink-0"
					onClick={() =>
						navigate(`/notifications?from=${encodeURIComponent(sessionId)}`)
					}
				>
					{t("ui.notifications.drawer.open_notifications")}
					<ExternalLink aria-hidden="true" className="rtl:-scale-x-100" />
				</Button>
			</div>
		</div>
	);
};

/**
 * The Unread | Read switch, under the Asks | Updates strip. A segmented control
 * like the reel's Unread | All (one visual language for read state), with the
 * Unread count beside its label so the inbox's size is visible from either view.
 */
const DrawerReadViews: FC<{
	view: DrawerReadView;
	onView: (view: DrawerReadView) => void;
	unreadCount: number;
	action: React.ReactNode;
}> = ({ view, onView, unreadCount, action }) => (
	<div className="flex shrink-0 flex-wrap items-center justify-between gap-1 px-2 pt-2">
		<div
			role="radiogroup"
			aria-label={t("ui.notifications.filter.read_state")}
			className="flex items-center gap-0.5 rounded-sm bg-sunken p-0.5"
		>
			{(["unread", "read"] as const).map((value) => (
				<button
					key={value}
					type="button"
					// biome-ignore lint/a11y/useSemanticElements: the reel's segmented control; native radios cannot carry the count badge inside the segment
					role="radio"
					aria-checked={view === value}
					data-drawer-read-view={value}
					onClick={() => onView(value)}
					className={cn(
						"flex h-7 items-center gap-1.5 rounded-xs px-2.5 text-body-sm",
						view === value
							? "bg-elevated text-ink"
							: "text-ink-muted hover:text-ink",
					)}
				>
					{value === "unread"
						? t("ui.notifications.drawer.group.unread")
						: t("ui.notifications.drawer.group.read")}
					{value === "unread" && unreadCount > 0 && (
						<Badge variant="neutral" size="count">
							{formatNumber(unreadCount)}
						</Badge>
					)}
				</button>
			))}
		</div>
		{action}
	</div>
);

const DrawerRow: FC<{
	item: DesktopNotificationItem;
	nowMs: number;
	onShow: (item: DesktopNotificationItem) => void;
	onToggleRead: () => void;
	onDismiss: () => void;
	paused: boolean;
}> = ({ item, nowMs, onShow, onToggleRead, onDismiss, paused }) => {
	const seen = seenMarkOf(item);
	return (
		<li
			className="group/drawer-row flex h-12 items-center gap-2 rounded-sm px-2 hover:bg-row-hover"
			data-drawer-update={item.id}
			data-unread={item.read ? undefined : ""}
		>
			<span
				aria-hidden="true"
				className={cn(
					"size-1.5 shrink-0 rounded-full bg-accent forced-colors:bg-[CanvasText]",
					item.read && "invisible",
				)}
			/>
			<PriorityBars priority={item.priority} />
			<div className="flex min-w-0 flex-1 flex-col">
				<span
					className={cn(
						"truncate text-body-sm",
						item.read ? "text-ink-muted" : "font-semibold text-ink",
					)}
				>
					{item.title}
				</span>
				<span className="truncate text-ink-dim text-meta">
					{seen === "live"
						? t("ui.notifications.seen.live")
						: seen === "in_view"
							? t("ui.notifications.seen.in_view")
							: rowTimeText(rowTimeOf(item.updated_at, nowMs))}
				</span>
			</div>
			{/*
			 * POINTER PARITY WITH THE REEL (design audit OD3): the row's own
			 * mark-read and dismiss controls, revealed on hover/focus exactly as the
			 * reel's are, so triaging one loud conversation does not require knowing
			 * the letter keys. `E` and the buttons run the same `applyWrite`.
			 */}
			<span className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/drawer-row:opacity-100 group-hover/drawer-row:opacity-100">
				<RowAction
					label={
						item.read
							? t("ui.notifications.row.mark_unread")
							: t("ui.notifications.row.mark_read")
					}
					disabled={paused}
					onPress={onToggleRead}
					data-row-action="read"
				>
					{item.read ? <Circle size={14} /> : <Check size={14} />}
				</RowAction>
				<RowAction
					label={t("ui.notifications.row.dismiss")}
					disabled={paused}
					onPress={onDismiss}
					data-row-action="dismiss"
				>
					<X size={14} />
				</RowAction>
			</span>
			<Tooltip content={t("ui.notifications.drawer.show_in_conversation")}>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("ui.notifications.drawer.show_in_conversation")}
					onClick={() => onShow(item)}
				>
					<ChevronsUp aria-hidden="true" />
				</Button>
			</Tooltip>
		</li>
	);
};
