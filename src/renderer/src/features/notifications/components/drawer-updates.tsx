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
import { replaceErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
	type MouseEvent,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import type { DesktopNotificationItem } from "../../../../../shared/desktop-control-contract";
import { useDrawerBackToTop, useNotificationReveal } from "../drawer-tab-store";
import {
	notificationKeys,
	readSessionUnreadCount,
	tokensOf,
	useNotificationDetail,
	useNotificationsWrite,
	useSessionNotifications,
} from "../notifications-api";
import { UNDO_WINDOW_MS, rowTimeOf, seenMarkOf } from "../notifications-model";
import {
	NotificationDetail,
	copyNotificationLink,
	notificationPath,
	refreshAfterAskSettled,
	useOpenedDetailRead,
} from "./notification-detail";
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
		placeholderData: (previous, previousQuery) =>
			enabled && sessionId && previousQuery?.queryKey[3] === sessionId
				? previous
				: undefined,
	});
	/* Unknown while the walk settles: the page's own rows would under-count. */
	return enabled && sessionId ? (count.data ?? 0) : 0;
}

/**
 * Unread is the inbox, Read the history (operator report: "it was never clear
 * what was read and what was unread"). One list holding both, split by two
 * headings, made a mark-read look like nothing happened - the row only changed
 * groups a few rows away. With the split as a view, marking read takes the row
 * out of the Unread view, which is the visible receipt of the click.
 */
export type DrawerReadView = "unread" | "read";

/**
 * ONE REFUSAL CARD PER PRESS, SUPERSEDED IN PLACE (design round 1, D1; UX round 2,
 * U1). `showErrorToast` dedupes one sentence per five seconds - right for a refusal
 * nobody asked for, wrong for the answer to a press, since a press refused inside
 * that window said nothing at all. `replaceErrorToast` skips the dedupe, but its
 * replacement IS the `id` it is handed: called without one it publishes a fresh
 * card beside the refusal already on screen, so a refused Undo printed the same
 * sentence twice and only the lower card carried "Try again". One id for the whole
 * surface, not one per verb: the person is looking at one list, and two refused
 * presses are one sentence at a time rather than two identical ones.
 */
const REFUSAL_TOAST_ID = "drawer-refusal";

/**
 * The sentence a refused write answers with, chosen by the verb that was refused
 * (design round 1, D2; UX round 2, U3). Every refusal used to speak the mark-read
 * sentence, so a refused dismiss said "Couldn't mark read" - while
 * `ui.notifications.error.dismiss` sat in all eight catalogues referenced nowhere.
 * `undismiss` keeps the mark sentence: the catalogue has two refusal forms and no
 * restore form, and a third form is a translation round, not a one-line fix.
 */
const refusalCopy = (verb: "read" | "unread" | "dismiss" | "undismiss") =>
	verb === "dismiss"
		? t("ui.notifications.error.dismiss")
		: t("ui.notifications.error.mark");

export const DrawerUpdates: FC<{
	sessionId: string;
	nowMs?: number;
	/** Stories and evidence pin the opening view; the operator always starts on Unread. */
	initialView?: DrawerReadView;
	/** Stories and evidence pin an open detail; the operator always starts on the list. */
	initialOpenId?: string;
}> = ({
	sessionId,
	nowMs: pinnedNow,
	initialView = "unread",
	initialOpenId,
}) => {
	useI18nLocale();
	const navigate = useNavigate();
	const client = useQueryClient();
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
	/*
	 * THE DETAIL VIEW (operator request, 2026-11-13: "there's no way to view
	 * details"). A row's title opens that update's full detail IN the drawer, the
	 * same `NotificationDetail` the Notifications page draws, in its narrow form:
	 * the detail REPLACES the list (with a back link) rather than expanding inside
	 * it. The pane is several sections deep (body, links, asks, history), so an
	 * inline expansion in a 48 px row list would push every row below it and nest
	 * one scroll region in another; replace-with-back is what the page itself does
	 * at a narrow width. The Unread | Read row and the footer stay where they are,
	 * so nothing above or below the swapped region moves.
	 *
	 * The list's scroll position and the row the press came from are kept in
	 * `openOrigin`, so Back lands where the person left (view, scroll and focus).
	 */
	const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
	const openedSnapshot = useRef<DesktopNotificationItem | null>(null);
	const openOrigin = useRef<{
		id: string;
		index: number;
		scrollTop: number;
	} | null>(null);
	/* Focus moves only on a press: a pinned story must not steal the page's focus. */
	const focusOnSwap = useRef(false);
	const detailRegion = useRef<HTMLDivElement>(null);
	/*
	 * THE PAGE'S DETAIL CACHE, ITS RULES TOO. `useNotificationDetail` is the
	 * LRU-bounded per-id cache (fix/notifications-dismiss-all-perf); passing the
	 * list row's revision makes a keyed update (same id, new body) refetch at
	 * once, and `behindLoading` shows the skeleton rather than the older body
	 * while it does (design D2) - the same contract the page's pane follows.
	 */
	const { query: detail, behindLoading: detailBehind } = useNotificationDetail(
		openId,
		Boolean(openId),
		openId
			? list.data?.items.find((item) => item.id === openId)?.revision
			: undefined,
	);
	/* The same explicit read the page makes when it opens a detail. */
	useOpenedDetailRead(openId, detail.data?.item, list.isError, (item) =>
		write.mutate({ verb: "read", target: { items: tokensOf([item]) } }),
	);
	useEffect(() => {
		/* No list behind the detail, so no "newer rows above" chip for it either. */
		const newer = openId ? 0 : list.newerCount;
		publishBackToTop(newer, newer > 0 ? backToTop : null);
	}, [openId, list.newerCount, backToTop, publishBackToTop]);
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
	/*
	 * AN OPENED ROW STAYS ON UNREAD UNTIL THE NEXT NAVIGATION (UX round 1, U4) -
	 * the page's own rule (`notifications-page.tsx`, "ROWS MARKED READ STAY ON THE
	 * UNREAD FILTER", the Gmail/Linear rule). Opening marks the item read, and it
	 * used to vanish from Unread: Back landed on a different row with nothing to
	 * say why, and an Undo of a dismiss from the detail "Restored" a row that never
	 * reappeared. Ids opened from Unread are kept (drawn as read) until the view
	 * changes or the drawer unmounts; Back lands on the SAME row (AC3) and `U`
	 * still makes it unread in place. Only openings are kept: `R`/`E` and the row's
	 * own controls keep their remove-and-hand-off behaviour.
	 */
	const [keptRead, setKeptRead] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const shown =
		view === "unread"
			? keptRead.size === 0
				? unread
				: rows.filter((item) => !item.read || keptRead.has(item.id))
			: read;
	const listElement = useRef<HTMLDivElement>(null);
	const focusedRow = useRef<{ id: string; index: number } | null>(null);
	const focusedElement = useRef<HTMLElement | null>(null);
	/*
	 * THE CONTROL THE PRESS CAME FROM, so the handoff lands on that same control in
	 * the next row (UX round 2, U5): a dismiss handed focus to the remaining row's
	 * READ control, so a second Enter marked read where the first dismissed - the
	 * meaning of Enter changed between presses in a triage run. `read` is the
	 * default because the removal is made by the read control in every other lane
	 * (the `R`/`E` keys and the row's own mark-read).
	 */
	const handoffAction = useRef<"read" | "dismiss">("read");
	/* A row a refusal put BACK, under a focus position the removal took away (U2). */
	const restoreRow = useRef<{
		id: string;
		action: "read" | "dismiss";
	} | null>(null);
	useLayoutEffect(() => {
		const active = document.activeElement;
		const hit = (selector: string) =>
			listElement.current?.querySelector<HTMLElement>(selector) ?? null;
		const restore = restoreRow.current;
		if (restore) {
			/*
			 * ROLLBACK, NOT A REFUSAL TO MOVE (UX round 2, U2). A refused write puts the
			 * row back where the optimistic removal took it from - and the empty heading
			 * that inherited the keyboard position unmounts with it, leaving focus on
			 * `document.body` and the next Tab at the top of the document. Only a focus
			 * position this list still owns is restored: if the person moved on, nothing
			 * is taken back from them.
			 *
			 * While the row is still gone the position is HELD, not cleared: `shown`
			 * changes on every render of the list, and clearing it here would drop the
			 * position on the first of them, before the refusal lands.
			 */
			const restored = hit(
				`[data-drawer-update="${CSS.escape(restore.id)}"] [data-row-action="${restore.action}"]`,
			);
			if (restored) {
				restoreRow.current = null;
				const holdsListFocus =
					active === null ||
					active === window.document.body ||
					active.hasAttribute("data-drawer-empty");
				if (holdsListFocus) {
					restored.focus();
					return;
				}
			}
		}
		const focused = focusedRow.current;
		if (!focused || shown.some((item) => item.id === focused.id)) return;
		focusedRow.current = null;
		/* Chromium can keep the removed action as activeElement through the
		 * commit's focus notification. Re-focus now, synchronously, or a later
		 * focus event on that detached action clears the row position we saved. */
		const removedOwnedFocus =
			focusedElement.current !== null &&
			!focusedElement.current.isConnected &&
			focusedElement.current === active;
		if (active !== document.body && !removedOwnedFocus) return;
		const next = shown[Math.min(focused.index, shown.length - 1)];
		const selector = next
			? `[data-drawer-update="${CSS.escape(next.id)}"] [data-row-action="${handoffAction.current}"]`
			: "[data-drawer-empty], [data-drawer-load-more]";
		/* No row left to hand off to: remember what the empty heading took over, so a
		 * refusal that restores this row can hand the position back. */
		if (!next)
			restoreRow.current = { id: focused.id, action: handoffAction.current };
		listElement.current?.querySelector<HTMLElement>(selector)?.focus();
	}, [shown]);
	/*
	 * The row as last drawn, then the detail read's row, then the row as it was
	 * pressed: a row dismissed elsewhere leaves `rows`, and the pane must keep
	 * drawing it (with its "dismissed" notice) rather than vanish under the reader.
	 */
	const openItem = openId
		? (rows.find((item) => item.id === openId) ??
			(detail.data?.item.id === openId ? detail.data.item : undefined) ??
			(openedSnapshot.current?.id === openId ? openedSnapshot.current : null))
		: null;
	/*
	 * FOCUS FOLLOWS THE SWAP. Into the detail's heading on open (it carries
	 * `tabIndex=-1` for exactly this), so a screen reader announces what opened
	 * and the next Tab walks the pane. Back to the row the press came from on
	 * close; that row is often gone from Unread by then - opening marked it read -
	 * so the row now at its position takes focus, then the empty heading. The
	 * list remounted, so its scroll position is put back first.
	 */
	useLayoutEffect(() => {
		if (!focusOnSwap.current) return;
		focusOnSwap.current = false;
		if (openId) {
			detailRegion.current
				?.querySelector<HTMLElement>("[data-notification-detail-title]")
				?.focus({ preventScroll: true });
			return;
		}
		const origin = openOrigin.current;
		openOrigin.current = null;
		const box = listElement.current;
		if (!origin || !box) return;
		box.scrollTop = origin.scrollTop;
		const nextId = shown.some((item) => item.id === origin.id)
			? origin.id
			: shown[Math.min(origin.index, shown.length - 1)]?.id;
		const target = nextId
			? box.querySelector<HTMLElement>(
					`[data-drawer-update="${CSS.escape(nextId)}"] [data-row-action="details"]`,
				)
			: box.querySelector<HTMLElement>(
					"[data-drawer-empty], [data-drawer-load-more]",
				);
		target?.focus({ preventScroll: true });
	}, [openId, shown]);
	/*
	 * A DOUBLE-CLICK DOES NOT SPAN THE SWAP (UX round 1, U1). The detail takes the
	 * list's place at the same coordinates, so the second click of a double-click
	 * on a title landed on "Back" (the detail closed, the item silently consumed),
	 * and the second click on Back opened - and marked read - whichever row now sat
	 * under the pointer. After a swap, a click whose `detail` says it continues a
	 * multi-click sequence is swallowed until a fresh press (`mousedown` with
	 * `detail` 1) starts a new one. The bound is the platform's own double-click
	 * interval (that is what resets `detail` to 1), so no timeout of ours guesses
	 * at it; keyboard activation carries `detail` 0 and is never touched.
	 */
	const swallowRepeat = useRef(false);
	const guardRepeat = {
		onMouseDownCapture: (event: MouseEvent) => {
			if (event.detail <= 1) swallowRepeat.current = false;
		},
		onClickCapture: (event: MouseEvent) => {
			if (!swallowRepeat.current || event.detail <= 1) return;
			event.preventDefault();
			event.stopPropagation();
		},
	};
	const openDetail = (item: DesktopNotificationItem) => {
		if (view === "unread" && !keptRead.has(item.id))
			setKeptRead((current) => new Set(current).add(item.id));
		swallowRepeat.current = true;
		openOrigin.current = {
			id: item.id,
			index: shown.findIndex((row) => row.id === item.id),
			scrollTop: listElement.current?.scrollTop ?? 0,
		};
		openedSnapshot.current = item;
		/* The list unmounts: no removal handoff may act on a position it held. */
		focusedRow.current = null;
		focusOnSwap.current = true;
		setOpenId(item.id);
	};
	const closeDetail = () => {
		swallowRepeat.current = true;
		focusOnSwap.current = true;
		setOpenId(null);
	};
	/*
	 * HAND THE JUMP TO THE TRANSCRIPT. It opens a collapsed turn, pages in older
	 * history and flashes the row; a `querySelector` here found nothing once the
	 * flag line's turn was collapsed, so the press did nothing.
	 */
	const reveal = useNotificationReveal((state) => state.reveal);
	const showInConversation = (item: DesktopNotificationItem) => {
		if (item.anchor_id) reveal(item.session.id, item.anchor_id);
	};
	if (list.isLoading)
		return (
			<p data-drawer-loading="" className="p-3 text-body-sm text-ink-muted">
				{t("ui.notifications.page.loading")}
			</p>
		);
	if (list.isError && !list.data)
		return (
			<div
				data-drawer-load-error=""
				className="p-3 text-body-sm text-ink-muted"
			>
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
	const undoWrite = (
		verb: "read" | "unread" | "undismiss",
		items: ReturnType<typeof tokensOf>,
	) => {
		const retry = () =>
			write.mutate(
				{ verb, target: { items } },
				{
					onSuccess: (result) => {
						/*
						 * CONFIRM THE UNDO (UX round 2, U4). Undone from the Read view, the
						 * restored rows appear in a list the person is not looking at, so a
						 * successful Undo said nothing at all where it did the most. The same
						 * key the Notifications page confirms its own undo with: no new copy.
						 * Only when rows really came back: a receipt that changed nothing is
						 * not a restore, and "Restored" would be a claim the server refused.
						 */
						if (!result.changed?.length) return;
						showInfoToast(t("ui.notifications.toast.undone"));
					},
					onError: () =>
						/*
						 * THE ANSWER TO THE PRESS, NOT AN UNSOLICITED REFUSAL. `showErrorToast`
						 * dedupes one sentence per five seconds, which is right for a failure a
						 * person did not ask for - and wrong here: a refused Undo landing inside
						 * that window after ANY earlier notification failure published nothing,
						 * so the person saw no answer and lost the retry. That is the case
						 * `replaceErrorToast` exists for (its own doc names "the answer to a
						 * press"); the hosted native scene found it when a refused dismiss, then
						 * a refused Undo, collapsed into one card with no action.
						 *
						 * `REFUSAL_TOAST_ID` is the other half of that fix: `replaceErrorToast`
						 * replaces the card NAMED BY ITS ID, so a call without one published a
						 * second identical sentence beside the refusal already on screen
						 * (design round 1, D1). The sentence is the refused verb's, not always
						 * mark's.
						 */
						replaceErrorToast(refusalCopy(verb), {
							id: REFUSAL_TOAST_ID,
							action: {
								label: t("ui.notifications.error.retry"),
								onClick: retry,
							},
						}),
				},
			);
		retry();
	};
	const applyWrite = (
		item: DesktopNotificationItem,
		verb: "read" | "unread" | "dismiss",
	) => {
		/* The handoff control in the next row is the one this press used (U5). */
		handoffAction.current = verb === "dismiss" ? "dismiss" : "read";
		const inverse =
			verb === "dismiss" ? "undismiss" : verb === "read" ? "unread" : "read";
		write.mutate(
			{ verb, target: { items: tokensOf([item]) } },
			{
				onSuccess: (result) => {
					if (!result.changed.includes(item.id)) return;
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
								onClick: () => undoWrite(inverse, tokensOf([item])),
							},
						},
					);
				},
				onError: () =>
					/*
					 * A PRESS IS ANSWERED EVERY TIME, IN THE REFUSED VERB'S OWN WORDS
					 * (R1-3, D2/U3). The deduping path swallowed a second refused
					 * dismiss inside the five-second window - the row visibly stays put
					 * and nothing says why - and it always spoke the mark-read
					 * sentence, so a refused dismiss named the wrong action while
					 * `ui.notifications.error.dismiss` sat unused in all eight
					 * catalogues.
					 */
					replaceErrorToast(refusalCopy(verb), { id: REFUSAL_TOAST_ID }),
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
		if (document.activeElement?.hasAttribute("data-drawer-mark-all-read"))
			focusedRow.current = { id: "bulk-action", index: 0 };
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
								onClick: () => undoWrite("unread", undo),
							},
						},
					);
				},
				onError: () =>
					/* The same answer-to-a-press rule as one row's refusal above. */
					replaceErrorToast(t("ui.notifications.error.mark"), {
						id: REFUSAL_TOAST_ID,
					}),
			},
		);
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<DrawerReadViews
				view={view}
				onView={(next) => {
					/* A view is a list: choosing one while a detail is open shows it. */
					openOrigin.current = null;
					setOpenId(null);
					setView(next);
					/* A view change is the navigation that releases kept rows (U4). */
					setKeptRead(new Set());
				}}
				unreadCount={unreadCount}
				action={
					/*
					 * NOT WHILE A DETAIL IS OPEN (design round 1, D5): the bulk "Mark read"
					 * marks the whole conversation, and it sat ~80 px above the detail's
					 * per-item "Mark read" - same words, different reach. The segmented
					 * control sets the row's height, so hiding it moves nothing.
					 */
					view === "unread" && unread.length > 0 && !openItem ? (
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
			{/*
			 * KEYED, so the swap is a real unmount/mount. Unkeyed, both branches are a
			 * `div` in the same slot and React reuses one node for both - the list's
			 * scroll offset, ref and handlers would ride into the detail and back.
			 */}
			{openItem ? (
				<div
					key="detail"
					ref={detailRegion}
					data-drawer-detail={openItem.id}
					/*
					 * FOCUSABLE, NOT TABBABLE (UX round 1, U2). A pointer press on the body
					 * focuses the nearest focusable ancestor; without this that was the
					 * drawer pane (`tabIndex=-1`, an ANCESTOR of this region), so the Escape
					 * below never saw the key and the pane closed the whole drawer, detail
					 * and all. The region itself takes that focus now.
					 */
					tabIndex={-1}
					className="flex min-h-0 flex-1 flex-col outline-none"
					{...guardRepeat}
					/*
					 * ESCAPE STEPS BACK ONE LEVEL. In the list Escape still closes the
					 * drawer (`ask-drawer.tsx` claims it on the pane); inside a detail it
					 * returns to the list first, the way Back does, so one Escape never
					 * throws away both the detail and the drawer. Stopped here so the
					 * pane's own close does not also run; skipped when something inside
					 * the detail (its ⋯ menu, an ask's field) already claimed the key.
					 */
					onKeyDown={(event) => {
						if (
							event.key !== "Escape" ||
							event.defaultPrevented ||
							event.nativeEvent.isComposing
						)
							return;
						event.preventDefault();
						event.stopPropagation();
						closeDetail();
					}}
				>
					<NotificationDetail
						key={openItem.id}
						item={openItem}
						detail={
							!detailBehind && detail.data?.item.id === openItem.id
								? detail.data
								: undefined
						}
						loading={detail.isLoading || detailBehind}
						error={detail.isError}
						nowMs={nowMs}
						narrow
						ground="elevated"
						writesPaused={list.isError}
						/* No conversation-wide dismiss here: see `onDismissSession`. */
						sessionDismissCount={null}
						onClose={closeDetail}
						backLabel={t("ui.notifications.drawer.back")}
						onOpenInNotifications={(item) =>
							navigate(notificationPath(item.id))
						}
						/* No `onOpenConversation`: this drawer IS that conversation (D3). */
						onToggleRead={(item) =>
							applyWrite(item, item.read ? "unread" : "read")
						}
						onDismiss={(item) => {
							/* As on the page: a dismissed item's detail closes (with Undo). */
							applyWrite(item, "dismiss");
							closeDetail();
						}}
						onCopyLink={copyNotificationLink}
						onOpenProject={(key) =>
							navigate(`/projects/${encodeURIComponent(key)}`)
						}
						onAsksSettled={() => refreshAfterAskSettled(client, openItem.id)}
					/>
				</div>
			) : (
				<div
					key="list"
					data-drawer-updates=""
					ref={listElement}
					{...guardRepeat}
					onFocusCapture={(event) => {
						const row = (event.target as HTMLElement).closest<HTMLElement>(
							"[data-drawer-update]",
						);
						/* Do not let a focus notification from a detached action erase the
						 * position saved while that action was connected. */
						if (row && !row.isConnected) return;
						focusedElement.current = row ? (event.target as HTMLElement) : null;
						focusedRow.current = row?.dataset.drawerUpdate
							? {
									id: row.dataset.drawerUpdate,
									index: shown.findIndex(
										(item) => item.id === row.dataset.drawerUpdate,
									),
								}
							: null;
					}}
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
					{shown.length === 0 && !list.hasNextPage ? (
						<h3
							tabIndex={-1}
							className="px-3 py-8 text-center text-body-sm text-ink-muted"
							data-drawer-empty={view}
						>
							{/* Nothing at all is one sentence; an empty inbox is "caught up". */}
							{rows.length === 0
								? t("ui.notifications.drawer.empty")
								: view === "unread"
									? t("ui.notifications.empty.caught_up.title")
									: /* NOT "Nothing flagged in this conversation" (design round 1,
										 * D6): the Read view can be empty while the Unread badge shows
										 * rows, and that sentence then denies what the badge says. This
										 * view IS a filter, and this is the catalogue sentence for one
										 * with no matches. */
										t("ui.notifications.empty.filtered.title")}
						</h3>
					) : (
						<ul className="flex flex-col" data-drawer-view-list={view}>
							{shown.map((item) => (
								<DrawerRow
									key={item.id}
									item={item}
									nowMs={nowMs}
									onShow={showInConversation}
									onOpen={() => openDetail(item)}
									onToggleRead={() =>
										applyWrite(item, item.read ? "unread" : "read")
									}
									onDismiss={() => applyWrite(item, "dismiss")}
									paused={list.isError}
								/>
							))}
						</ul>
					)}
					{list.hasNextPage && (
						<Button
							variant="ghost"
							size="sm"
							data-drawer-load-more=""
							disabled={list.isFetchingNextPage}
							onClick={() => void list.fetchNextPage()}
						>
							{list.isFetchingNextPage
								? t("ui.notifications.page.loading")
								: t("ui.common.forms.compact_pagination.next_page")}
						</Button>
					)}
				</div>
			)}
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
			/* The same pair as the reel's Unread | All switch, and the same glass
			 * answer: the track is a well (the field overlay) and the checked
			 * segment is the selected-row overlay, so neither is a slab in the
			 * pane this drawer lives in. Off glass both keep their classes. */
			data-glass-well=""
			className="flex items-center gap-0.5 rounded-sm bg-sunken p-0.5"
		>
			{(["unread", "read"] as const).map((value) => (
				<button
					key={value}
					type="button"
					// biome-ignore lint/a11y/useSemanticElements: the reel's segmented control; native radios cannot carry the count badge inside the segment
					role="radio"
					aria-checked={view === value}
					tabIndex={view === value ? 0 : -1}
					onKeyDown={(event) => {
						if (
							![
								"ArrowRight",
								"ArrowLeft",
								"ArrowDown",
								"ArrowUp",
								"Home",
								"End",
							].includes(event.key)
						)
							return;
						event.preventDefault();
						const next =
							event.key === "Home"
								? "unread"
								: event.key === "End"
									? "read"
									: value === "read"
										? "unread"
										: "read";
						onView(next);
						event.currentTarget.parentElement
							?.querySelector<HTMLButtonElement>(
								`[data-drawer-read-view="${next}"]`,
							)
							?.focus();
					}}
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
						<Badge
							variant="neutral"
							size="count"
							/*
							 * RESERVE TWO DIGITS, PLUS THE COUNT BADGE'S CHROME (design round 1,
							 * D4). `ch` measures the numeral's content box, not the `px-1` padding
							 * and one-pixel borders around it. Reserving only `2ch` therefore never
							 * bound: even a one-digit count badge was wider than the reservation,
							 * and Read moved by one digit when Unread went from 10 to 9.
							 * From three digits the badge grows by the digit it gained: reserving
							 * that on every load costs this control 8 px at the drawer's narrowest
							 * width for a usually single-digit count.
							 */
							style={{
								minWidth: `calc(${Math.max(2, formatNumber(unreadCount).length)}ch + 10px)`,
							}}
						>
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
	/** Open this row's detail in the drawer. */
	onOpen: () => void;
	onToggleRead: () => void;
	onDismiss: () => void;
	paused: boolean;
}> = ({ item, nowMs, onShow, onOpen, onToggleRead, onDismiss, paused }) => {
	const seen = seenMarkOf(item);
	const timeId = useId();
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
			{/*
			 * THE ROW'S WAY IN (operator request, 2026-11-13): the title and time are
			 * one real button that opens the detail. A sibling of the row's other
			 * controls, never their parent, so no button sits inside another. It is
			 * the row's Tab stop and the first button the arrow keys land on, so
			 * Enter on a focused row opens it; `R`/`U`/`E` still act on the row.
			 * Its name says what the press does; the time is its description.
			 */}
			<Tooltip content={t("ui.notifications.drawer.view_details")}>
				<button
					type="button"
					data-row-action="details"
					aria-label={t("ui.notifications.drawer.view_details_for", {
						title: item.title,
					})}
					aria-describedby={timeId}
					onClick={onOpen}
					className={cn(
						"flex min-w-0 flex-1 flex-col self-stretch justify-center rounded-sm text-start",
						"focus-visible:outline-2 focus-visible:outline-accent",
					)}
				>
					{/* Its own hover cue (design round 1, D7); resting pixels unchanged. */}
					<span
						className={cn(
							"w-full truncate text-body-sm underline-offset-2 hover:underline",
							item.read ? "text-ink-muted" : "font-semibold text-ink",
						)}
					>
						{item.title}
					</span>
					<span id={timeId} className="w-full truncate text-ink-dim text-meta">
						{seen === "live"
							? t("ui.notifications.seen.live")
							: seen === "in_view"
								? t("ui.notifications.seen.in_view")
								: rowTimeText(rowTimeOf(item.updated_at, nowMs))}
					</span>
				</button>
			</Tooltip>
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
