import { openConversation } from "@features/chat/open-conversation";
/**
 * The Notifications page (`/notifications`, `/notifications/:id`): one reel of
 * open asks and agent-raised updates across every conversation, with a detail
 * pane (design.md § 2-§ 7, contract § 8).
 *
 * THE PAGE'S JOB IS "WHAT STILL NEEDS ME". So the default filter is Unread,
 * opening the page does not zero the badge (design § 11), and Mark all read is
 * bounded by the high-water mark the list answered with, so an item that lands
 * after the click survives it (contract § 5.2 R10 binding).
 *
 * WHY THE LIST STAYS WHEN A REFRESH FAILS. A list the reader is working through
 * must never blank under them (design § 5): the last good answer stays, a
 * notice says when it was read, and writes pause until the server is back.
 *
 * GATED ON `features.notifications` like the Library: below it the route is not
 * mounted at all (`app.tsx`), and this component repeats the gate for a story
 * or a hand-typed URL that reaches it anyway.
 *
 * Pages arrive by the route's cursor, 100 rows at a time, as the list approaches
 * its lower edge. Keyed repeats collapse server-side. Rows are not virtualised
 * yet: high-volume DOM performance remains a measured limitation, not a claim
 * that an arbitrary truncation is the whole inbox.
 */
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { PageHeader } from "@shared/components/common/page-header";
import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	Badge,
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogTitle,
	Skeleton,
	countLabel,
} from "@shared/components/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { useMediaQuery } from "@shared/hooks/use-media-query";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { formatNumber, formatTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	showErrorToast,
	showInfoToast,
	showSuccessToast,
} from "@shared/utils/toast-manager";
import {
	Bell,
	Check,
	CheckCheck,
	ChevronDown,
	ChevronUp,
	Circle,
	RefreshCw,
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
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
	DesktopNotificationItem,
	DesktopNotificationsList,
	DesktopNotificationsWriteResult,
} from "../../../../../shared/desktop-control-contract";
import {
	type NotificationSnapshot,
	type OperationProgress,
	applyNotificationOperation,
	inverseNotificationVerb,
	isCompleteInverse,
	observeNotificationScope,
	receiptProgress,
} from "../notification-operations";
import {
	type NotificationsTarget,
	type NotificationsVerb,
	notificationKeys,
	tokensOf,
	useNotificationDetail,
	useNotificationsList,
	useNotificationsWrite,
	writeNotifications,
} from "../notifications-api";
import {
	DEFAULT_FILTERS,
	type NotificationFilters,
	type NotificationGroup,
	type NotificationGrouping,
	dismissPlan,
	filterItems,
	filtersActive,
	groupItems,
	isLiveAsk,
	rangeSelect,
	rowOrder,
	sessionDismissCount,
} from "../notifications-model";
import { NotificationDetail } from "./notification-detail";
import { NotificationRow } from "./notification-row";

/** The design's Undo window (§ 0.8): 6 s, after which the toast leaves. */
export const UNDO_WINDOW_MS = 6_000;
const operationText = (progress: OperationProgress) =>
	t("ui.notifications.operation.progress", progress);

/** The read-state choice persists per device (design § 2). */
const READ_STATE_KEY = "notifications-read-state";
const GROUPING_KEY = "notifications-grouping";

const readStored = <T extends string>(
	key: string,
	allowed: readonly T[],
	fallback: T,
): T => {
	try {
		const value = localStorage.getItem(key);
		return allowed.includes(value as T) ? (value as T) : fallback;
	} catch {
		return fallback;
	}
};
const writeStored = (key: string, value: string) => {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* a preference that cannot persist still applies for this visit */
	}
};

export type NotificationsPageProps = {
	/** Pinned by stories so frames do not churn; the app reads the clock. */
	nowMs?: number;
};

export const NotificationsPage: FC<NotificationsPageProps> = ({
	nowMs: pinnedNow,
}) => {
	useI18nLocale();
	const { notificationId } = useParams<{ notificationId?: string }>();
	const navigate = useNavigate();
	const capabilities = useDesktopCapabilities();
	const gate = desktopFeatureState(capabilities.data, "notifications", 1);
	const enabled = gate === "enabled";
	const nowMs = pinnedNow ?? Date.now();
	const narrow = !useMediaQuery("(min-width: 1100px)");
	const { client } = useOptionalQueryClient();

	const [readState, setReadState] = useState<"unread" | "all">(() =>
		readStored(READ_STATE_KEY, ["unread", "all"] as const, "unread"),
	);
	const [grouping, setGrouping] = useState<NotificationGrouping>(() =>
		readStored(GROUPING_KEY, ["time", "conversation"] as const, "time"),
	);
	/*
	 * `?from=<session>` presets the From filter: the asks drawer's footer link
	 * opens the reel scoped to the conversation it came from (design § 18).
	 */
	const [searchParams] = useSearchParams();
	const [filters, setFilters] = useState<NotificationFilters>(() => ({
		...DEFAULT_FILTERS,
		from: searchParams.get("from") || null,
	}));
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [anchorId, setAnchorId] = useState<string | null>(null);
	const [focusId, setFocusId] = useState<string | null>(null);
	const [confirmSession, setConfirmSession] = useState<{
		sessionId: string;
		title: string;
		count: number;
		snapshot: NotificationSnapshot;
	} | null>(null);
	const [operationProgress, setOperationProgress] =
		useState<OperationProgress | null>(null);
	const [operationBusy, setOperationBusy] = useState(false);
	const operationLock = useRef(false);
	/*
	 * ROWS MARKED READ STAY ON THE UNREAD FILTER until the next navigation or
	 * refresh (design § 7.3, the Gmail/Linear rule): they do not vanish under
	 * the cursor, and U stays reversible in place.
	 */
	const [stickyRead, setStickyRead] = useState<
		Map<string, DesktopNotificationItem>
	>(() => new Map());
	const [lastGoodAt, setLastGoodAt] = useState<number | null>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const list = useNotificationsList(readState, enabled);
	const write = useNotificationsWrite();
	const detail = useNotificationDetail(notificationId ?? null, enabled);

	useEffect(() => {
		if (list.isSuccess && !list.isFetching) setLastGoodAt(list.dataUpdatedAt);
	}, [list.isSuccess, list.isFetching, list.dataUpdatedAt]);

	const loaded = list.data;
	const observedIds = useRef<Set<string> | null>(null);
	const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
	useEffect(() => {
		if (!loaded) return;
		const next = new Set(
			[...(loaded.waiting ?? []), ...loaded.items].map((item) => item.id),
		);
		const previous = observedIds.current;
		observedIds.current = next;
		if (!previous || (listRef.current?.scrollTop ?? 0) < 24) {
			setNewIds(new Set());
			return;
		}
		const arrivals = [...next].filter((id) => !previous.has(id));
		if (arrivals.length)
			setNewIds((current) => new Set([...current, ...arrivals]));
	}, [loaded]);
	const items = useMemo(() => {
		const base = loaded?.items ?? [];
		if (readState !== "unread" || stickyRead.size === 0) return base;
		const present = new Set(base.map((item) => item.id));
		return [
			...base,
			...[...stickyRead.values()].filter((item) => !present.has(item.id)),
		];
	}, [loaded, readState, stickyRead]);
	const waiting = loaded?.waiting ?? [];
	const filtered = useMemo(() => filterItems(items, filters), [items, filters]);
	const filteredWaiting = useMemo(
		() => filterItems(waiting, filters),
		[waiting, filters],
	);
	const groups = useMemo(
		() => groupItems(filtered, filteredWaiting, grouping, nowMs),
		[filtered, filteredWaiting, grouping, nowMs],
	);
	const order = useMemo(() => rowOrder(groups), [groups]);
	const byId = useMemo(() => {
		const map = new Map<string, DesktopNotificationItem>();
		for (const item of [...waiting, ...items]) map.set(item.id, item);
		return map;
	}, [items, waiting]);
	/* The From menu's conversations, sorted by count (design § 5 "high volume"). */
	const sources = useMemo(() => {
		const counts = new Map<string, [string, string, number]>();
		for (const item of [...waiting, ...items]) {
			const entry = counts.get(item.session.id) ?? [
				item.session.id,
				item.session.title || t("ui.notifications.group.untitled"),
				0,
			];
			entry[2] += 1;
			counts.set(item.session.id, entry);
		}
		return [...counts.values()].sort((a, b) => b[2] - a[2]);
	}, [items, waiting]);

	/*
	 * WRITES PAUSE WHILE A REFRESH IS FAILING WITH DATA HELD (design § 5): a
	 * token from a list the server can no longer confirm is a write against a
	 * render nobody can vouch for.
	 */
	const refreshFailed = list.isError && Boolean(loaded);
	const writesPaused = refreshFailed || operationBusy;
	const openItem = notificationId
		? (byId.get(notificationId) ?? detail.data?.item ?? null)
		: null;

	/*
	 * OPENING A DETAIL IS AN EXPLICIT READ (contract § 6.4, design § 17.3),
	 * token-bound to the revision the detail rendered. Once per detail opening,
	 * NOT per revision: a keyed update arriving while the pane is open is not
	 * proof the new content was seen. It stays unread until a fresh explicit
	 * action or an item-specific transcript receipt (presence refinement).
	 */
	const explicitRead = useRef<string | null>(null);
	useEffect(() => {
		if (!notificationId) {
			explicitRead.current = null;
			return;
		}
		const item = detail.data?.item;
		if (!item || item.id !== notificationId || explicitRead.current === item.id)
			return;
		explicitRead.current = item.id;
		if (item.read || item.dismissed || writesPaused) return;
		write.mutate({ verb: "read", target: { items: tokensOf([item]) } });
	}, [notificationId, detail.data, write, writesPaused]);

	const clearSelection = useCallback(() => {
		setSelected(new Set());
		setAnchorId(null);
	}, []);

	/*
	 * ONE WRITE PATH with its receipt and Undo (design § 0.8, 6 s). The Undo is
	 * the inverse verb over EXACTLY the ids the server reported as changed, at
	 * the revisions the client sent: undismiss/unread are permissive on the
	 * server (contract § 12 "undo within a window"), so the toast's window is the
	 * UI's promise, not a server deadline.
	 */
	const lastUndo = useRef<{
		verb: NotificationsVerb;
		items: { id: string; revision: number }[];
		at: number;
	} | null>(null);

	const writeUndo = useCallback(
		async (
			verb: NotificationsVerb,
			undoItems: { id: string; revision: number }[],
		) => {
			if (operationLock.current) return;
			operationLock.current = true;
			setOperationBusy(true);
			lastUndo.current = null;
			try {
				const receipt = await applyNotificationOperation(
					writeNotifications,
					verb,
					undoItems,
					undefined,
					setOperationProgress,
				);
				const progress = receiptProgress(receipt);
				if (verb === "unread")
					setStickyRead((current) => {
						const next = new Map(current);
						for (const token of receipt.changed) next.delete(token.id);
						return next;
					});
				// "Restored" is reserved for a complete, confirmed inverse. Zero or
				// partial inversions keep the actual three-way receipt visible (R3).
				if (isCompleteInverse(receipt, undoItems.length))
					showSuccessToast(t("ui.notifications.toast.undone"));
				else showInfoToast(operationText(progress));
			} finally {
				operationLock.current = false;
				setOperationBusy(false);
				void client.invalidateQueries({ queryKey: notificationKeys.all });
			}
		},
		[client],
	);

	const runWrite = useCallback(
		async (
			verb: NotificationsVerb,
			target: NotificationsTarget,
			sent: { id: string; revision: number }[],
			message: (
				result: Pick<DesktopNotificationsWriteResult, "changed" | "skipped">,
			) => string | null,
			ownsLock = false,
		) => {
			if (operationLock.current && !ownsLock) return;
			operationLock.current = true;
			setOperationBusy(true);
			// A failed original operation cannot leave a keyboard Undo for work
			// that was never confirmed. Populate only from actual changed receipts.
			lastUndo.current = null;
			try {
				const snapshot =
					"items" in target
						? undefined
						: {
								scope:
									"sessionId" in target
										? { sessionId: target.sessionId }
										: { all: true as const },
								throughSeq: target.throughSeq,
								tokens: sent,
							};
				const receipt = await applyNotificationOperation(
					writeNotifications,
					verb,
					sent,
					snapshot,
					setOperationProgress,
				);
				const progress = receiptProgress(receipt);
				if (verb === "read") {
					const changed = new Set(receipt.changed.map((token) => token.id));
					setStickyRead((current) => {
						const next = new Map(current);
						for (const item of byId.values())
							if (changed.has(item.id))
								next.set(item.id, {
									...item,
									read: true,
									read_via: "explicit",
								});
						return next;
					});
				} else if (verb === "unread") {
					setStickyRead((current) => {
						const next = new Map(current);
						for (const token of receipt.changed) next.delete(token.id);
						return next;
					});
				}
				const undo = receipt.changed.length
					? {
							verb: inverseNotificationVerb(verb),
							items: receipt.changed,
							at: Date.now(),
						}
					: null;
				lastUndo.current = undo;
				const summary = message({
					changed: receipt.changed.map((token) => token.id),
					skipped: receipt.skipped,
				});
				showInfoToast(
					[summary, operationText(progress)].filter(Boolean).join(". "),
					{
						duration: UNDO_WINDOW_MS,
						action: undo
							? {
									label: t("ui.notifications.toast.undo"),
									onClick: () => {
										if (
											lastUndo.current === undo &&
											Date.now() - undo.at <= UNDO_WINDOW_MS
										)
											void writeUndo(undo.verb, undo.items);
									},
								}
							: undefined,
					},
				);
			} finally {
				operationLock.current = false;
				setOperationBusy(false);
				void client.invalidateQueries({ queryKey: notificationKeys.all });
			}
		},
		[client, byId, writeUndo],
	);

	const toggleRead = useCallback(
		(targets: DesktopNotificationItem[]) => {
			if (targets.length === 0 || writesPaused) return;
			const anyUnread = targets.some((item) => !item.read);
			const verb: NotificationsVerb = anyUnread ? "read" : "unread";
			const subject = targets.filter((item) =>
				anyUnread ? !item.read : item.read,
			);
			const tokens = tokensOf(subject);
			runWrite(verb, { items: tokens }, tokens, (result) =>
				verb === "read"
					? t("ui.notifications.toast.marked_read", {
							count: formatNumber(result.changed.length),
						})
					: t("ui.notifications.toast.marked_unread", {
							count: formatNumber(result.changed.length),
						}),
			);
		},
		[runWrite, writesPaused],
	);

	/*
	 * Dismiss ONE row, or a selection. Live asks are filtered out BEFORE the
	 * request (design § 6), and the server's own `skipped` list is still the
	 * receipt's authority for anything it refused (`live_ask`, `stale_revision`).
	 */
	const dismiss = useCallback(
		(targets: DesktopNotificationItem[]) => {
			if (writesPaused) return;
			const { dismissable, asksStaying } = dismissPlan(targets);
			if (dismissable.length === 0) {
				if (asksStaying > 0) showInfoToast(t("ui.notifications.ask.stays"));
				return;
			}
			const tokens = tokensOf(dismissable);
			/* Focus walks to the next row so `E E E` works down the list (§ 7.3). */
			const ids = new Set(dismissable.map((item) => item.id));
			const position = order.findIndex((item) => ids.has(item.id));
			const next =
				order.slice(position + 1).find((item) => !ids.has(item.id)) ??
				[...order.slice(0, position)]
					.reverse()
					.find((item) => !ids.has(item.id));
			setFocusId(next?.id ?? null);
			if (notificationId && ids.has(notificationId)) navigate("/notifications");
			clearSelection();
			runWrite("dismiss", { items: tokens }, tokens, (result) => {
				const skippedAsks = result.skipped.filter(
					(entry) => entry.reason === "live_ask",
				).length;
				const message = t("ui.notifications.toast.dismissed", {
					count: result.changed.length,
				});
				const stays = asksStaying + skippedAsks;
				return stays > 0
					? `${message}. ${t("ui.notifications.select.asks_stay", { count: stays })}`
					: message;
			});
		},
		[clearSelection, navigate, notificationId, order, runWrite, writesPaused],
	);

	/*
	 * DISMISS ALL FROM A CONVERSATION: confirm first (design § 7.2 Shift+E), then
	 * one `sessionId` + `throughSeq` write bounded by the list's high-water mark,
	 * so an update landing after the confirm is not swept.
	 */
	const requestDismissSession = useCallback(
		async (sessionId: string, title: string) => {
			if (!loaded || writesPaused || operationLock.current) return;
			operationLock.current = true;
			setOperationBusy(true);
			try {
				const snapshot = await observeNotificationScope(
					(request) =>
						desktopResult<DesktopNotificationsList>({
							op: "notifications.list",
							...request,
						}),
					{
						scope: { sessionId },
						throughSeq: loaded.high_water,
						waiting: [],
						verb: "dismiss",
					},
				);
				// Nothing in this confirmation reads the mutable query again. Refresh,
				// filters and paging cannot replace its count, boundary or revisions.
				if (snapshot.tokens.length)
					setConfirmSession({
						sessionId,
						title,
						count: snapshot.tokens.length,
						snapshot,
					});
			} catch {
				showErrorToast(t("ui.notifications.error.load.title"));
			} finally {
				operationLock.current = false;
				setOperationBusy(false);
			}
		},
		[loaded, writesPaused],
	);
	const confirmDismissSession = useCallback(() => {
		if (!confirmSession) return;
		const { snapshot } = confirmSession;
		setConfirmSession(null);
		void runWrite(
			"dismiss",
			{
				...snapshot.scope,
				throughSeq: snapshot.throughSeq,
				observed: [...snapshot.tokens],
			},
			[...snapshot.tokens],
			(result) =>
				t("ui.notifications.toast.dismissed", { count: result.changed.length }),
		);
	}, [confirmSession, runWrite]);

	/* Mark ALL is global, independent of the From/Kind/Priority display filters.
	 * Read every notify page under the first rendered boundary, retain the first
	 * unread waiting set, and never manufacture observations for later arrivals. */
	const markAllRead = useCallback(async () => {
		if (!loaded || writesPaused || operationLock.current) return;
		operationLock.current = true;
		setOperationBusy(true);
		try {
			const unreadAsks = new Set(
				(loaded.waiting ?? [])
					.filter((item) => !item.read)
					.map((item) => item.id),
			);
			const snapshot = await observeNotificationScope(
				(request) =>
					desktopResult<DesktopNotificationsList>({
						op: "notifications.list",
						...request,
					}),
				{
					scope: { all: true },
					throughSeq: loaded.high_water,
					waiting: loaded.observed.filter((token) => unreadAsks.has(token.id)),
					verb: "read",
				},
			);
			await runWrite(
				"read",
				{
					all: true,
					throughSeq: snapshot.throughSeq,
					observed: [...snapshot.tokens],
				},
				[...snapshot.tokens],
				(result) =>
					t("ui.notifications.toast.marked_read", {
						count: formatNumber(result.changed.length),
					}),
				true,
			);
		} catch {
			showErrorToast(t("ui.notifications.error.load.title"));
		} finally {
			operationLock.current = false;
			setOperationBusy(false);
		}
	}, [loaded, runWrite, writesPaused]);

	const openDetail = useCallback(
		(item: DesktopNotificationItem) => {
			setFocusId(item.id);
			navigate(`/notifications/${encodeURIComponent(item.id)}`);
		},
		[navigate],
	);
	const closeDetail = useCallback(() => {
		const id = notificationId;
		navigate("/notifications");
		if (id) setFocusId(id);
	}, [navigate, notificationId]);
	const openSource = useCallback(
		(sessionId: string) => {
			void openConversation(navigate, sessionId);
		},
		[navigate],
	);
	const toggleSelect = useCallback(
		(item: DesktopNotificationItem, shift: boolean) => {
			setSelected((current) => {
				if (shift) return rangeSelect(order, anchorId, item.id, current);
				const next = new Set(current);
				if (next.has(item.id)) next.delete(item.id);
				else next.add(item.id);
				return next;
			});
			setAnchorId(item.id);
		},
		[anchorId, order],
	);
	const answer = useCallback(
		(item: DesktopNotificationItem) => {
			openDetail(item);
			showInfoToast(t("ui.notifications.ask.stays"));
		},
		[openDetail],
	);

	/* The roving tab stop follows focus, and defaults to the first row. */
	const focusedId =
		focusId && order.some((item) => item.id === focusId)
			? focusId
			: (order[0]?.id ?? null);
	useEffect(() => {
		if (!focusId) return;
		const node = listRef.current?.querySelector<HTMLElement>(
			`[data-notification-row="${CSS.escape(focusId)}"]`,
		);
		if (node && listRef.current?.contains(document.activeElement)) node.focus();
	}, [focusId]);

	/* The keyboard map (design § 7.2). Single keys never fire in a text field. */
	const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement;
		if (target.closest("input, textarea, [contenteditable='true']")) return;
		const index = order.findIndex((item) => item.id === focusedId);
		const current = index >= 0 ? order[index] : undefined;
		const move = (to: number) => {
			const clamped = Math.max(0, Math.min(order.length - 1, to));
			const next = order[clamped];
			if (!next) return;
			if (event.shiftKey && current)
				setSelected((selection) =>
					rangeSelect(order, current.id, next.id, selection),
				);
			setFocusId(next.id);
		};
		const primary = event.metaKey || event.ctrlKey;
		const selection = order.filter((item) => selected.has(item.id));
		const subject = selection.length > 0 ? selection : current ? [current] : [];
		switch (event.key) {
			case "ArrowDown":
			case "j":
			case "J":
				if (primary) return;
				event.preventDefault();
				move(index + 1);
				return;
			case "ArrowUp":
			case "k":
			case "K":
				if (primary) return;
				event.preventDefault();
				move(index - 1);
				return;
			case "Home":
				event.preventDefault();
				move(0);
				return;
			case "End":
				event.preventDefault();
				move(order.length - 1);
				return;
			case "Enter":
				if (current) {
					event.preventDefault();
					openDetail(current);
				}
				return;
			case "o":
			case "O":
				if (current && !primary) {
					event.preventDefault();
					openSource(current.session.id);
				}
				return;
			case "x":
			case "X":
				if (current && !primary) {
					event.preventDefault();
					toggleSelect(current, false);
				}
				return;
			case "a":
			case "A":
				if (primary) {
					event.preventDefault();
					setSelected(new Set(order.map((item) => item.id)));
					return;
				}
				if (current) {
					event.preventDefault();
					const ask = order.find(
						(item) => item.session.id === current.session.id && isLiveAsk(item),
					);
					openDetail(ask ?? current);
				}
				return;
			case "e":
			case "E":
				if (primary || !current) return;
				event.preventDefault();
				if (event.shiftKey) {
					requestDismissSession(
						current.session.id,
						current.session.title || t("ui.notifications.group.untitled"),
					);
					return;
				}
				if (selection.length === 0 && isLiveAsk(current)) {
					answer(current);
					return;
				}
				dismiss(subject);
				return;
			case "u":
			case "U":
				if (primary) return;
				event.preventDefault();
				toggleRead(subject);
				return;
			case "z":
			case "Z":
				if (primary && lastUndo.current) {
					event.preventDefault();
					const undo = lastUndo.current;
					lastUndo.current = null;
					if (Date.now() - undo.at <= UNDO_WINDOW_MS && undo.items.length > 0)
						writeUndo(undo.verb, undo.items);
				}
				return;
			case "Escape":
				if (selected.size > 0) {
					event.preventDefault();
					clearSelection();
					return;
				}
				if (notificationId) {
					event.preventDefault();
					closeDetail();
				}
				return;
		}
	};

	if (!enabled) {
		return (
			<div className="flex h-full flex-col gap-8 p-6">
				<PageHeader title={t("ui.notifications.page.title")} icon={Bell} />
				{capabilities.isLoading ? (
					<div className="flex justify-center py-16">
						<Spinner label={t("ui.notifications.page.checking")} />
					</div>
				) : (
					<Alert variant="warning">
						{t("ui.notifications.page.unavailable")}
					</Alert>
				)}
			</div>
		);
	}

	const selection = order.filter((item) => selected.has(item.id));
	const showDetail = Boolean(notificationId && openItem);
	const listHidden = narrow && showDetail;
	const emptyKind: "caught_up" | "none" | "filtered" | null =
		loaded && order.length === 0
			? filtersActive(filters)
				? "filtered"
				: readState === "unread"
					? "caught_up"
					: "none"
			: null;

	return (
		<div className="flex h-full min-h-0 flex-col" data-notifications-page="">
			<div className="flex shrink-0 flex-col gap-4 px-6 pt-6">
				<PageHeader
					title={t("ui.notifications.page.title")}
					icon={Bell}
					subtitle={t("ui.notifications.page.subtitle")}
				>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("ui.notifications.page.refresh")}
						title={t("ui.notifications.page.refresh")}
						aria-busy={list.isFetching || undefined}
						disabled={list.isFetching}
						onClick={() => {
							setStickyRead(new Map());
							void client.invalidateQueries({ queryKey: notificationKeys.all });
						}}
					>
						<RefreshCw />
					</Button>
				</PageHeader>
				<Toolbar
					loaded={loaded}
					readState={readState}
					onReadState={(next) => {
						setReadState(next);
						setStickyRead(new Map());
						writeStored(READ_STATE_KEY, next);
					}}
					filters={filters}
					setFilters={setFilters}
					grouping={grouping}
					setGrouping={setGrouping}
					sources={sources}
					writesPaused={writesPaused}
					markAllRead={markAllRead}
					selection={selection}
					visibleCount={order.length}
					onSelectAll={() =>
						setSelected(
							selection.length === order.length
								? new Set()
								: new Set(order.map((item) => item.id)),
						)
					}
					onClearSelection={clearSelection}
					onBulkRead={(verb) =>
						toggleRead(
							verb === "read"
								? selection.filter((item) => !item.read)
								: selection.filter((item) => item.read),
						)
					}
					onBulkDismiss={() => dismiss(selection)}
				/>
			</div>

			{refreshFailed && (
				<div className="px-6 pt-3">
					<Alert
						variant="danger"
						role="alert"
						data-notifications-refresh-error=""
					>
						<span className="font-medium">
							{t("ui.notifications.error.refresh.title")}
						</span>{" "}
						{t("ui.notifications.error.refresh.body", {
							time: lastGoodAt
								? formatTime(lastGoodAt, { hour: "2-digit", minute: "2-digit" })
								: "",
						})}
					</Alert>
				</div>
			)}

			<div className="mt-3 flex min-h-0 flex-1">
				{!listHidden && (
					<div
						className={cn(
							"flex min-h-0 flex-col",
							showDetail || !narrow ? "w-[min(560px,46%)] shrink-0" : "flex-1",
							narrow && "w-full",
						)}
					>
						{list.isError && !loaded ? (
							<div
								className="flex flex-col items-start gap-3 px-6 py-6"
								role="alert"
							>
								<p className="text-body text-ink">
									{t("ui.notifications.error.load.title")}
								</p>
								<Button variant="secondary" onClick={() => void list.refetch()}>
									{t("ui.notifications.error.retry")}
								</Button>
							</div>
						) : !loaded ? (
							<SkeletonRows />
						) : emptyKind ? (
							<EmptyState
								kind={emptyKind}
								onShowAll={() => {
									setReadState("all");
									writeStored(READ_STATE_KEY, "all");
								}}
								onClearFilters={() => setFilters(DEFAULT_FILTERS)}
							/>
						) : (
							<div
								ref={listRef}
								// biome-ignore lint/a11y/useSemanticElements: a reel row is a grid row with roving tabindex and in-row action buttons (design.md section 14); a native table cannot host that keyboard contract
								role="grid"
								aria-multiselectable="true"
								aria-label={t("ui.notifications.page.list_label")}
								onKeyDown={onListKeyDown}
								onScroll={(event) => {
									const box = event.currentTarget;
									if (box.scrollTop < 24) setNewIds(new Set());
									if (
										list.hasNextPage &&
										!list.isFetchingNextPage &&
										box.scrollHeight - box.scrollTop - box.clientHeight < 160
									)
										void list.fetchNextPage();
								}}
								className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pb-6 [scrollbar-gutter:stable]"
								data-notifications-list=""
							>
								{newIds.size > 0 && (
									<div className="sticky top-0 z-[2] flex shrink-0 justify-center bg-canvas py-1">
										<Button
											size="sm"
											variant="secondary"
											onClick={() => {
												listRef.current?.scrollTo({
													top: 0,
													behavior: "smooth",
												});
												setNewIds(new Set());
											}}
										>
											{t("ui.notifications.new_pill", {
												count: formatNumber(newIds.size),
											})}
										</Button>
									</div>
								)}
								{groups.map((group) => (
									<GroupBlock
										key={group.key}
										group={group}
										nowMs={nowMs}
										openId={notificationId ?? null}
										selected={selected}
										focusedId={focusedId}
										writesPaused={writesPaused}
										onOpen={openDetail}
										onToggleSelect={toggleSelect}
										onToggleRead={(item) => toggleRead([item])}
										onDismiss={(item) => dismiss([item])}
										onAnswer={answer}
										onFocusRow={(item) => setFocusId(item.id)}
										onDismissSession={requestDismissSession}
										sessionCount={(sessionId) =>
											sessionDismissCount([...waiting, ...items], sessionId)
										}
									/>
								))}
							</div>
						)}
					</div>
				)}
				{!narrow || showDetail ? (
					<div
						className={cn(
							"flex min-h-0 flex-1 flex-col bg-surface",
							narrow && "w-full",
						)}
					>
						{showDetail && openItem ? (
							<NotificationDetail
								key={openItem.id}
								item={openItem}
								detail={detail.data}
								loading={detail.isLoading}
								error={detail.isError}
								nowMs={nowMs}
								narrow={narrow}
								writesPaused={writesPaused}
								sessionDismissCount={sessionDismissCount(
									[...waiting, ...items],
									openItem.session.id,
								)}
								onClose={closeDetail}
								onOpenConversation={openSource}
								onToggleRead={(item) => toggleRead([item])}
								onDismiss={(item) => dismiss([item])}
								onDismissSession={requestDismissSession}
								onCopyLink={(item) => {
									void navigator.clipboard
										?.writeText(`/notifications/${item.id}`)
										.then(() =>
											showSuccessToast(t("ui.notifications.toast.copied")),
										);
								}}
								onOpenProject={(key) =>
									navigate(`/projects/${encodeURIComponent(key)}`)
								}
								onAsksSettled={() =>
									void client.invalidateQueries({
										queryKey: notificationKeys.all,
									})
								}
							/>
						) : (
							<DetailEmpty />
						)}
					</div>
				) : null}
			</div>

			{operationBusy && !operationProgress && (
				<Spinner label={t("ui.notifications.page.loading")} />
			)}
			{operationProgress && (
				<output
					className="shrink-0 px-6 py-1 text-meta text-ink-muted"
					data-notification-operation=""
				>
					{t("ui.notifications.operation.progress", operationProgress)}
				</output>
			)}
			{confirmSession && (
				<ConfirmDismissSession
					title={confirmSession.title}
					count={confirmSession.count}
					onConfirm={confirmDismissSession}
					onCancel={() => setConfirmSession(null)}
				/>
			)}
		</div>
	);
};

/* ----------------------------------------------------------------- groups */

const groupTitle = (group: NotificationGroup): string => {
	switch (group.kind) {
		case "waiting":
			return t("ui.notifications.group.waiting");
		case "conversation":
			return group.title || t("ui.notifications.group.untitled");
		case "time":
			return group.key === "today"
				? t("ui.notifications.group.today")
				: group.key === "yesterday"
					? t("ui.notifications.group.yesterday")
					: group.key === "week"
						? t("ui.notifications.group.week")
						: t("ui.notifications.group.older");
	}
};

const GroupBlock: FC<{
	group: NotificationGroup;
	nowMs: number;
	openId: string | null;
	selected: ReadonlySet<string>;
	focusedId: string | null;
	writesPaused: boolean;
	onOpen: (item: DesktopNotificationItem) => void;
	onToggleSelect: (item: DesktopNotificationItem, shift: boolean) => void;
	onToggleRead: (item: DesktopNotificationItem) => void;
	onDismiss: (item: DesktopNotificationItem) => void;
	onAnswer: (item: DesktopNotificationItem) => void;
	onFocusRow: (item: DesktopNotificationItem) => void;
	onDismissSession: (sessionId: string, title: string) => void;
	sessionCount: (sessionId: string) => number;
}> = ({ group, onDismissSession, sessionCount, ...row }) => {
	/*
	 * THE OLDER GROUP STARTS COLLAPSED (design § 5 "very high volume"): the
	 * reader's job is the recent end of the reel.
	 */
	const [collapsed, setCollapsed] = useState(
		group.kind === "time" && group.key === "older",
	);
	const count =
		group.kind === "conversation" ? sessionCount(group.sessionId) : 0;
	return (
		<div
			// biome-ignore lint/a11y/useSemanticElements: a rowgroup of the reel's grid; group rows are not a table section
			role="rowgroup"
			data-notification-group={group.key}
		>
			{/*
			 * The group's header row. `tabIndex={-1}`: reachable programmatically
			 * but never a tab stop and never walked by the arrow keys (design.md
			 * section 14: group headers cannot be focused).
			 */}
			<div
				// biome-ignore lint/a11y/useSemanticElements: a grid's group header row; a native <tr> cannot sit in this flex column
				role="row"
				tabIndex={-1}
				className="sticky top-0 z-[1] flex h-8 items-center gap-2 bg-canvas px-3 text-ink-muted text-meta"
			>
				<span
					// biome-ignore lint/a11y/useSemanticElements: the group's header cell inside the grid's header row
					role="rowheader"
					className="flex min-w-0 items-center gap-1.5"
				>
					{group.kind === "time" && group.key === "older" ? (
						<button
							type="button"
							className="inline-flex items-center gap-1 hover:text-ink"
							aria-expanded={!collapsed}
							onClick={() => setCollapsed((value) => !value)}
						>
							{groupTitle(group)}
							<span className="text-ink-dim tabular-nums">
								{group.items.length}
							</span>
							{collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
						</button>
					) : (
						<>
							<span className="truncate">{groupTitle(group)}</span>
							<span className="text-ink-dim tabular-nums">
								{group.items.length}
							</span>
						</>
					)}
				</span>
				{group.kind === "conversation" && count > 0 && (
					<>
						<span aria-hidden="true" className="h-px flex-1 bg-hairline" />
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onDismissSession(group.sessionId, group.title)}
						>
							{t("ui.notifications.group.dismiss_session", {
								count: formatNumber(count),
							})}
						</Button>
					</>
				)}
			</div>
			{!collapsed &&
				group.items.map((item) => (
					<NotificationRow
						key={item.id}
						item={item}
						nowMs={row.nowMs}
						open={row.openId === item.id}
						picked={row.selected.has(item.id)}
						selecting={row.selected.size > 0}
						focused={row.focusedId === item.id}
						writesPaused={row.writesPaused}
						onOpen={row.onOpen}
						onToggleSelect={row.onToggleSelect}
						onToggleRead={row.onToggleRead}
						onDismiss={row.onDismiss}
						onAnswer={row.onAnswer}
						onFocusRow={row.onFocusRow}
					/>
				))}
		</div>
	);
};

const EmptyState: FC<{
	kind: "caught_up" | "none" | "filtered";
	onShowAll: () => void;
	onClearFilters: () => void;
}> = ({ kind, onShowAll, onClearFilters }) => (
	<div
		className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
		data-notifications-empty={kind}
	>
		{kind === "caught_up" && (
			<CheckCheck size={24} aria-hidden="true" className="text-ink-muted" />
		)}
		<p className="text-heading text-ink">
			{kind === "caught_up"
				? t("ui.notifications.empty.caught_up.title")
				: kind === "none"
					? t("ui.notifications.empty.none.title")
					: t("ui.notifications.empty.filtered.title")}
		</p>
		{kind !== "filtered" && (
			<p className="max-w-96 text-body-sm text-ink-muted">
				{kind === "caught_up"
					? t("ui.notifications.empty.caught_up.body")
					: t("ui.notifications.empty.none.body")}
			</p>
		)}
		{kind === "caught_up" && (
			<Button variant="secondary" onClick={onShowAll}>
				{t("ui.notifications.empty.caught_up.show_all")}
			</Button>
		)}
		{kind === "filtered" && (
			<Button variant="secondary" onClick={onClearFilters}>
				{t("ui.notifications.filter.clear")}
			</Button>
		)}
	</div>
);

/**
 * The Shift+E / "Dismiss all n" confirm (design § 7.2): a small modal with
 * Enter confirming. A dialog rather than a popover anchored to a row, because
 * the same confirm is reached from the detail's From card, the ⋯ menu and a
 * group header, which have no shared anchor.
 */
const ConfirmDismissSession: FC<{
	title: string;
	count: number;
	onConfirm: () => void;
	onCancel: () => void;
}> = ({ title, count, onConfirm, onCancel }) => (
	<Dialog open onOpenChange={(open) => !open && onCancel()}>
		<DialogContent className="max-w-sm">
			<DialogTitle>
				{t("ui.notifications.confirm.dismiss_session", {
					count,
					source: title,
				})}
			</DialogTitle>
			<div className="mt-4 flex justify-end gap-2">
				<Button variant="secondary" onClick={onCancel}>
					{t("ui.notifications.confirm.cancel")}
				</Button>
				<Button
					variant="primary"
					autoFocus
					onClick={onConfirm}
					data-notifications-confirm=""
				>
					{t("ui.notifications.confirm.dismiss_session_ok")}
				</Button>
			</div>
		</DialogContent>
	</Dialog>
);

/* ----------------------------------------------------------------- toolbar */

type ToolbarProps = {
	loaded: DesktopNotificationsList | undefined;
	readState: "unread" | "all";
	onReadState: (next: "unread" | "all") => void;
	filters: NotificationFilters;
	setFilters: (
		update: (current: NotificationFilters) => NotificationFilters,
	) => void;
	grouping: NotificationGrouping;
	setGrouping: (next: NotificationGrouping) => void;
	sources: [string, string, number][];
	writesPaused: boolean;
	markAllRead: () => void;
	selection: DesktopNotificationItem[];
	visibleCount: number;
	onSelectAll: () => void;
	onClearSelection: () => void;
	onBulkRead: (verb: "read" | "unread") => void;
	onBulkDismiss: () => void;
};

/**
 * The 44px band under the header. While anything is selected, the selection
 * bar REPLACES the toolbar in the same band so nothing reflows (design § 7.1).
 */
const Toolbar: FC<ToolbarProps> = ({
	loaded,
	readState,
	onReadState,
	filters,
	setFilters,
	grouping,
	setGrouping,
	sources,
	writesPaused,
	markAllRead,
	selection,
	visibleCount,
	onSelectAll,
	onClearSelection,
	onBulkRead,
	onBulkDismiss,
}) => {
	const { dismissable, asksStaying } = dismissPlan(selection);
	const selecting = selection.length > 0;
	const allChecked: boolean | "indeterminate" =
		selection.length === 0
			? false
			: selection.length === visibleCount
				? true
				: "indeterminate";
	return (
		<div
			className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-hairline border-b py-2"
			data-notifications-toolbar={selecting ? "selection" : "filters"}
		>
			{selecting ? (
				<>
					<Checkbox
						checked={allChecked}
						aria-label={t("ui.notifications.select.all")}
						onCheckedChange={onSelectAll}
					/>
					<span className="font-medium text-body-sm text-ink">
						{t("ui.notifications.select.count", {
							count: formatNumber(selection.length),
						})}
					</span>
					<Button
						variant="secondary"
						size="sm"
						aria-disabled={writesPaused || undefined}
						onClick={() => !writesPaused && onBulkRead("read")}
					>
						<Check />
						{t("ui.notifications.select.mark_read")}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						aria-disabled={writesPaused || undefined}
						onClick={() => !writesPaused && onBulkRead("unread")}
					>
						<Circle />
						{t("ui.notifications.select.mark_unread")}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						aria-disabled={
							writesPaused || dismissable.length === 0 || undefined
						}
						onClick={() =>
							!writesPaused && dismissable.length > 0 && onBulkDismiss()
						}
						data-notifications-bulk-dismiss={dismissable.length}
					>
						<X />
						{t("ui.notifications.select.dismiss", {
							count: formatNumber(dismissable.length),
						})}
					</Button>
					{asksStaying > 0 && (
						<span
							className="text-ink-dim text-meta"
							// biome-ignore lint/a11y/useSemanticElements: `role="status"` is a live region with no element of its own; `<output>` is a form's result, and this is a page notice
							role="status"
							data-notifications-asks-stay={asksStaying}
						>
							{t("ui.notifications.select.asks_stay", { count: asksStaying })}
						</span>
					)}
					<span className="flex-1" />
					<Button variant="ghost" size="sm" onClick={onClearSelection}>
						{t("ui.notifications.select.clear")}
						<kbd className="ms-1 text-ink-dim text-meta">
							{/* i18n: ignore key cap name printed on the physical key, not prose */}
							Esc
						</kbd>
					</Button>
				</>
			) : (
				<>
					<div
						role="radiogroup"
						aria-label={t("ui.notifications.filter.read_state")}
						className="flex items-center gap-0.5 rounded-sm bg-sunken p-0.5"
					>
						{(["unread", "all"] as const).map((value) => (
							<button
								key={value}
								type="button"
								// biome-ignore lint/a11y/useSemanticElements: a two-option segmented control; native radios cannot carry the count badge inside the segment
								role="radio"
								aria-checked={readState === value}
								onClick={() => onReadState(value)}
								className={cn(
									"flex h-7 items-center gap-1.5 rounded-xs px-2.5 text-body-sm",
									readState === value
										? "bg-elevated text-ink"
										: "text-ink-muted hover:text-ink",
								)}
							>
								{value === "unread"
									? t("ui.notifications.filter.unread")
									: t("ui.notifications.filter.all")}
								{value === "unread" && (loaded?.unread_count ?? 0) > 0 && (
									<Badge variant="neutral" size="count">
										{countLabel(loaded?.unread_count ?? 0, 99)}
									</Badge>
								)}
							</button>
						))}
					</div>
					{(
						[
							{
								label: t("ui.notifications.filter.kind"),
								value: filters.kind,
								options: ["all", "asks", "updates"] as const,
								isDefault: filters.kind === "all",
								set: (value: string) =>
									setFilters((current) => ({
										...current,
										kind: value as NotificationFilters["kind"],
									})),
								optionLabel: (value: string) =>
									value === "asks"
										? t("ui.notifications.filter.kind_asks")
										: value === "updates"
											? t("ui.notifications.filter.kind_updates")
											: t("ui.notifications.filter.kind_all"),
							},
							{
								label: t("ui.notifications.filter.priority"),
								value: filters.priority,
								options: ["any", "high", "normal_up"] as const,
								isDefault: filters.priority === "any",
								set: (value: string) =>
									setFilters((current) => ({
										...current,
										priority: value as NotificationFilters["priority"],
									})),
								optionLabel: (value: string) =>
									value === "high"
										? t("ui.notifications.filter.priority_high")
										: value === "normal_up"
											? t("ui.notifications.filter.priority_normal_up")
											: t("ui.notifications.filter.priority_any"),
							},
						] as const
					).map(({ label, value, options, isDefault, set, optionLabel }) => (
						<DropdownMenu key={label}>
							<DropdownMenuTrigger asChild>
								<Button variant="secondary" size="sm" disabled={!loaded}>
									<FilterChipText
										label={label}
										value={optionLabel(value)}
										emphasised={!isDefault}
									/>
									<ChevronDown />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start">
								<DropdownMenuRadioGroup value={value} onValueChange={set}>
									{options.map((option) => (
										<DropdownMenuRadioItem key={option} value={option}>
											{optionLabel(option)}
										</DropdownMenuRadioItem>
									))}
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					))}
					{sources.length > 0 && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="secondary" size="sm" disabled={!loaded}>
									<FilterChipText
										label={t("ui.notifications.filter.from")}
										value={
											filters.from === null
												? t("ui.notifications.filter.from_all")
												: (sources.find(([id]) => id === filters.from)?.[1] ??
													t("ui.notifications.group.untitled"))
										}
										emphasised={filters.from !== null}
									/>
									<ChevronDown />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start">
								<DropdownMenuRadioGroup
									value={filters.from ?? ""}
									onValueChange={(value) =>
										setFilters((current) => ({
											...current,
											from: value || null,
										}))
									}
								>
									<DropdownMenuRadioItem value="">
										{t("ui.notifications.filter.from_all")}
									</DropdownMenuRadioItem>
									{sources.map(([id, title, count]) => (
										<DropdownMenuRadioItem key={id} value={id}>
											<span className="min-w-0 flex-1 truncate">{title}</span>
											<span className="ms-3 text-ink-dim text-meta tabular-nums">
												{count}
											</span>
										</DropdownMenuRadioItem>
									))}
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
					{filtersActive(filters) && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setFilters(() => DEFAULT_FILTERS)}
						>
							{t("ui.notifications.filter.clear")}
						</Button>
					)}
					<span className="flex-1" />
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="secondary" size="sm">
								<FilterChipText
									label={t("ui.notifications.filter.group")}
									value={
										grouping === "time"
											? t("ui.notifications.filter.group_time")
											: t("ui.notifications.filter.group_conversation")
									}
									emphasised={grouping !== "time"}
								/>
								<ChevronDown />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuRadioGroup
								value={grouping}
								onValueChange={(value) => {
									const next =
										value === "conversation" ? "conversation" : "time";
									setGrouping(next);
									writeStored(GROUPING_KEY, next);
								}}
							>
								<DropdownMenuRadioItem value="time">
									{t("ui.notifications.filter.group_time")}
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="conversation">
									{t("ui.notifications.filter.group_conversation")}
								</DropdownMenuRadioItem>
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						variant="secondary"
						size="sm"
						/*
						 * Nothing unread is a real `disabled`: there is nothing to do, and
						 * the button should read as unavailable. A paused write stays
						 * `aria-disabled` so it keeps focus and its tooltip says why.
						 */
						disabled={
							!loaded ||
							(loaded?.unread_count ?? 0) +
								(loaded?.waiting_unread_count ?? 0) ===
								0
						}
						aria-disabled={writesPaused || undefined}
						title={
							writesPaused ? t("ui.notifications.writes_paused_tip") : undefined
						}
						onClick={() => {
							if (
								!loaded ||
								writesPaused ||
								loaded.unread_count + loaded.waiting_unread_count === 0
							)
								return;
							markAllRead();
						}}
						data-notifications-mark-all=""
					>
						<CheckCheck />
						{t("ui.notifications.action.mark_all_read")}
					</Button>
				</>
			)}
		</div>
	);
};

/**
 * A filter chip's "Kind: All" text. The pair is ONE message (`filter.chip`) so a
 * locale owns its own punctuation and spacing (French puts a space before the
 * colon); the value alone goes bold when the filter is off its default (design
 * section 2), which is why the value is wrapped by splitting on the formatted
 * value rather than concatenating two keys.
 */
const FilterChipText: FC<{
	label: string;
	value: string;
	emphasised: boolean;
}> = ({ label, value, emphasised }) => {
	const text = t("ui.notifications.filter.chip", { label, value });
	const at = text.lastIndexOf(value);
	if (at < 0) return <span>{text}</span>;
	return (
		<span>
			{text.slice(0, at)}
			<span className={cn(emphasised && "font-semibold")}>{value}</span>
			{text.slice(at + value.length)}
		</span>
	);
};

const DetailEmpty: FC = () => (
	<div className="flex h-full items-center justify-center p-6 text-center text-ink-dim text-body-sm">
		{t("ui.notifications.detail.empty")}
	</div>
);

const SkeletonRows: FC = () => (
	<div
		// biome-ignore lint/a11y/useSemanticElements: `role="status"` is a live region with no element of its own; `<output>` is a form's result, and this is a page notice
		role="status"
		aria-label={t("ui.notifications.page.loading")}
		className="flex flex-col"
	>
		{Array.from({ length: 7 }, (_, index) => (
			<div
				// biome-ignore lint/suspicious/noArrayIndexKey: fixed skeleton slots
				key={index}
				className="flex h-14 items-center gap-3 px-3"
				data-notification-skeleton=""
			>
				<Skeleton className="size-1.5 rounded-full bg-elevated" />
				<Skeleton className="size-4 bg-elevated" />
				<div className="flex flex-1 flex-col gap-1.5">
					<Skeleton
						className={cn("h-3 bg-elevated", index % 2 ? "w-2/3" : "w-1/2")}
					/>
					<Skeleton
						className={cn("h-2.5 bg-elevated", index % 3 ? "w-1/3" : "w-2/5")}
					/>
				</div>
			</div>
		))}
	</div>
);
