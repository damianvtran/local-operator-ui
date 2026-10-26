import { openConversation } from "@features/chat/open-conversation";
import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
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
import { useQuery } from "@tanstack/react-query";
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
	readSessionDismissCounts,
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
	coveredByWrite,
	dismissPlan,
	filterItems,
	filtersActive,
	groupItems,
	isLiveAsk,
	mergeConfirmedReads,
	rangeSelect,
	rowOrder,
	scopeCountBoundary,
	sessionScopeCountsEnabled,
} from "../notifications-model";
import { NotificationDetail } from "./notification-detail";
import { NotificationRow } from "./notification-row";
import { NotificationRowExit } from "./notification-row-exit";
import { OperationProgressLine } from "./operation-progress-line";

/** The design's Undo window (§ 0.8): 6 s, after which the toast leaves. */
/*
 * From the model, where it lives so the reel and the transcript drawer's Updates
 * tab share one window (design audit OD3); re-exported for the suites that read
 * it from this module.
 */
import { UNDO_WINDOW_MS } from "../notifications-model";

export { UNDO_WINDOW_MS };
/*
 * THE INLINE STATUS LINE IS NOT A PERMANENT RECORD (code round 2, minor 1).
 * It reports work in flight and rows still without a conclusive answer; once
 * the operation settles with nothing unconfirmed the toast is the receipt, and
 * a strip that stayed on screen would read as an action still running. Anything
 * unresolved stays visible, because a lost response is exactly the case where
 * clearing it would imply the rows were untouched.
 */
const settleOperationProgress = (
	receipt: { pending: unknown[]; error?: unknown } | null,
	setProgress: (next: OperationProgress | null) => void,
) => {
	if (receipt && (receipt.pending.length > 0 || receipt.error !== undefined))
		return;
	setProgress(null);
};

/*
 * The conversation-header counts, and WHEN they are worth asking for (code audit
 * DC4). This ran on every mount and re-ran on every `high_water` change, which
 * every notify/read/dismiss bumps: a wake loop posting every few minutes turned
 * one screen into a steady N/100-page walk of the whole store, one walk per frame.
 *
 * Two structural answers instead of a cache tweak:
 *  - it is only read in CONVERSATION grouping, the one view that draws the
 *    header the number belongs to;
 *  - the boundary is fixed when the walk STARTS and is re-derived when that
 *    scope actually moves, rather than on every frame.
 * The walk itself stays complete: the number is a promise the confirm dialog
 * has to keep, and a cap would under-promise the largest conversations.
 */
const useSessionScopeCounts = (
	throughId: number | undefined,
	enabled: boolean,
	scopeKey: string,
): {
	counts: Record<string, number> | undefined;
	/** `true` until an answer for THIS boundary exists; `false` once one does. */
	pending: boolean;
} => {
	/*
	 * COUNT UNDER THE BOUNDARY THE CONFIRM WILL USE (code round 4, R4-1).
	 *
	 * The confirm enumerates under the CURRENT `high_water`, and core bumps a
	 * row's `seq` on every read or dismiss - including the read that opening this
	 * detail performs. An earlier version recorded one boundary at first use and
	 * never moved it, so the button drifted from the dialog it opens: 129 against
	 * 130 after the detail's own read, 129 against 131 after a late arrival, and a
	 * vanished button while the confirm still showed 131 after mark-all-read.
	 *
	 * The cost that motivated freezing (one whole-store walk per frame) is instead
	 * paid only where the number is printed - an open detail or the conversation
	 * header - and `staleTime` keeps a repeat within the same boundary from
	 * re-walking. Correctness of a number the operator agrees to beats a walk that
	 * only happens while that number is on screen.
	 */
	/*
	 * ONE WALK PER CHANGE OF THIS CONVERSATION (code round 5, R5-2). Keying the query
	 * on the store's high-water mark re-walked the whole store whenever anything
	 * anywhere moved: 3 marks over 900 rows cost 30 page reads, and every frame cost
	 * the same again. `scopeKey` is this conversation's own rows, so a foreign mark
	 * leaves the cached number alone - while the boundary the walk uses is still the
	 * live one, read at fetch time, which is what the confirm enumerates under.
	 */
	const boundaryRef = useRef(throughId);
	boundaryRef.current = throughId;
	const query = useQuery({
		queryKey: ["desktop", "notifications", "session-scope-counts", scopeKey],
		enabled: enabled && throughId !== undefined,
		queryFn: () =>
			readSessionDismissCounts(
				scopeCountBoundary(boundaryRef.current) as number,
			),
		retry: retryDesktopQuery,
		staleTime: 5_000,
		refetchOnWindowFocus: false,
	});
	return {
		counts: query.data,
		pending: throughId === undefined || query.data === undefined,
	};
};

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
	/*
	 * Confirmed read tokens whose row is not currently loaded (code audit DC7).
	 * They carry no title/time/session, so they are never drawn as synthetic rows;
	 * they merge into the real row the moment the list supplies it, and Undo
	 * removes them. `confirmedReadVersion` is their invalidation signal.
	 */
	const confirmedReadTokens = useRef(new Map<string, number>());
	const [confirmedReadVersion, setConfirmedReadVersion] = useState(0);
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: confirmedReadVersion is the invalidation signal for the ref-held token map; its identity never changes
	const items = useMemo(() => {
		/* The receipt is newer evidence than the list (DC7): one rule, in the model. */
		const base = mergeConfirmedReads(
			loaded?.items ?? [],
			confirmedReadTokens.current,
		);
		if (readState !== "unread" || stickyRead.size === 0) return base;
		const present = new Set(base.map((item) => item.id));
		return [
			...base,
			...[...stickyRead.values()].filter((item) => !present.has(item.id)),
		];
	}, [loaded, readState, stickyRead, confirmedReadVersion]);
	const waiting = loaded?.waiting ?? [];
	const filtered = useMemo(() => filterItems(items, filters), [items, filters]);
	const filteredWaiting = useMemo(
		() => filterItems(waiting, filters),
		[waiting, filters],
	);
	/*
	 * THE UNREAD CHIP COUNTS WHAT THE UNREAD FILTER SHOWS (decisions D16, design
	 * audit OD2). It printed `loaded.unread_count`, which excludes the waiting asks
	 * the reel draws: the rail read 4 while the chip beside it read 3, one click
	 * apart, over one list. So it counts the UNREAD rows the filter would draw -
	 * the notify rows it holds plus the pending asks that are themselves unread -
	 * which is the same number the rail's `unread_count + waiting_unread_count`
	 * resolves to when the store and the list agree.
	 *
	 * IT IS NOT `filtered.length`: with the All filter selected, every row is on
	 * screen and a chip reading "Unread 7" over four read rows would be a new
	 * version of the same defect pointing the other way.
	 */
	const visibleUnread =
		filtered.filter((item) => !item.read).length +
		filteredWaiting.filter((item) => !item.read).length;
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
	/*
	 * THE DETAIL'S NUMBER COMES FROM THE SAME ENUMERATION THE CONFIRM USES (QA round
	 * 3). It was bought only while the reel was grouped by CONVERSATION, so under
	 * Time grouping the detail counted the LOADED page: QA reproduced the button
	 * saying 93 then 92 while its own confirm enumerated 130 then 131, on the same
	 * click. The write is right in both cases (frozen `through_seq` over the whole
	 * conversation, complete observed set, exact Undo); only the advertised number
	 * was wrong, and that is the number the operator agrees to.
	 *
	 * So the walk is bought whenever anything PRINTS it: the conversation-grouped
	 * header, or an open detail - hence `openItem`/`notificationId` here rather than
	 * the grouping alone.
	 */
	const scopeCount = useSessionScopeCounts(
		loaded?.high_water,
		Boolean(loaded) &&
			sessionScopeCountsEnabled(grouping, Boolean(notificationId)),
		/*
		 * The detail's own row identity: its id, revision and read state, plus its
		 * pending asks. Whatever a frame elsewhere in the store says, this string only
		 * moves when a row of THIS conversation does.
		 */
		[
			detail.data?.item.id ?? "",
			detail.data?.item.revision ?? 0,
			detail.data?.item.read ? "r" : "u",
			detail.data?.item.dismissed ? "d" : "",
			detail.data?.asks.length ?? 0,
			notificationId ?? "",
			grouping,
		].join("|"),
	);
	const scopeCounts = scopeCount.counts;
	const writesPaused = refreshFailed || operationBusy;
	const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());
	/*
	 * DISMISS EXIT MOTION (design §7.3, design audit OD8). Ids stay in the reel
	 * for a bounded 120ms fade/slide + 180ms height collapse; the write and its
	 * Undo path do not wait. A failed write clears the exit immediately, so a
	 * refused dismiss never makes a row disappear. Reduced motion skips it.
	 */
	const beginExit = useCallback((ids: ReadonlySet<string>) => {
		setExitingIds((current) => new Set([...current, ...ids]));
	}, []);
	const clearExit = useCallback((ids: ReadonlySet<string>) => {
		setExitingIds((current) => {
			const next = new Set(current);
			for (const id of ids) next.delete(id);
			return next;
		});
	}, []);
	const finishExit = useCallback((id: string) => {
		setExitingIds((current) => {
			const next = new Set(current);
			next.delete(id);
			return next;
		});
	}, []);

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
			let settled: { pending: unknown[]; error?: unknown } | null = null;
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
				settled = receipt;
			} finally {
				operationLock.current = false;
				setOperationBusy(false);
				settleOperationProgress(settled, setOperationProgress);
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
			let settled: { pending: unknown[]; error?: unknown } | null = null;
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
					setStickyRead((current) => {
						const next = new Map(current);
						/*
						 * CARRY THE CONFIRMED TOKEN, not only rows already loaded (code audit
						 * DC7). A mark-all/Undo can confirm ids outside `byId`; a synthetic row
						 * from the receipt alone is NOT enough to draw (it has no title, time or
						 * session), so it is kept as a read TOKEN and merged into the real row
						 * when the list next supplies it. That way a confirmed read never flips
						 * back to unread just because the row was off-page.
						 */
						for (const token of receipt.changed) {
							const item = byId.get(token.id);
							if (item)
								next.set(item.id, {
									...item,
									read: true,
									read_via: "explicit",
								});
							else confirmedReadTokens.current.set(token.id, token.revision);
						}
						return next;
					});
					setConfirmedReadVersion((version) => version + 1);
				} else if (verb === "unread") {
					setStickyRead((current) => {
						const next = new Map(current);
						for (const token of receipt.changed) {
							next.delete(token.id);
							confirmedReadTokens.current.delete(token.id);
						}
						return next;
					});
					setConfirmedReadVersion((version) => version + 1);
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
				/*
				 * THE TALLY IS FOR PARTIAL RESULTS ONLY (design audit OD4). Every
				 * routine receipt read "Dismissed 1 update. 1 changed · 0 skipped · 0 not
				 * confirmed" - an engineering count in the way of a one-row action. It
				 * now appears only when the write did not go entirely as asked (a skip,
				 * or a count that never resolved), which is what the
				 * `OperationProgressLine` stories photograph.
				 */
				const partial = progress.pending > 0 || progress.skipped > 0;
				showInfoToast(
					[summary, partial ? operationText(progress) : null]
						.filter(Boolean)
						.join(". "),
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
				settled = receipt;
			} finally {
				operationLock.current = false;
				setOperationBusy(false);
				/*
				 * A refused/failed write restores its row's exit state (OD8): the
				 * gesture started the fade, but nothing was confirmed, so the row must
				 * come back rather than stay half-gone or disappear with no receipt.
				 */
				if (settled?.error) clearExit(new Set(sent.map((token) => token.id)));
				settleOperationProgress(settled, setOperationProgress);
				void client.invalidateQueries({ queryKey: notificationKeys.all });
			}
		},
		[client, byId, clearExit, writeUndo],
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
			const ids = new Set(dismissable.map((item) => item.id));
			/*
			 * The exit starts with the GESTURE, not with the server response: the
			 * row fades/slides and its height collapses while the write is in flight,
			 * so the list does not jump when the response arrives. A refused write
			 * clears the exit and restores the row (see `runWrite`'s error path).
			 */
			beginExit(ids);
			/* Focus walks to the next row so `E E E` works down the list (§ 7.3). */
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
		[
			beginExit,
			clearSelection,
			navigate,
			notificationId,
			order,
			runWrite,
			writesPaused,
		],
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
		/*
		 * THE OPEN DETAIL LEAVES WHEN THIS WINDOW REMOVED ITS ROW (design audit
		 * OD1). `dismiss()` already navigates away for the single-row case; this
		 * bulk path did not, so the pane stayed open on a row that had just been
		 * removed HERE and rendered "This was dismissed on another device" - the
		 * truth for a remote dismissal and a lie for a local one - under a toast
		 * saying it had just been dismissed here.
		 */
		if (
			notificationId &&
			snapshot.tokens.some((token) => token.id === notificationId)
		)
			navigate("/notifications");
		void runWrite(
			"dismiss",
			{
				...snapshot.scope,
				throughSeq: snapshot.throughSeq,
				observed: [...snapshot.tokens],
			},
			[...snapshot.tokens],
			/*
			 * Q12 (QA round 3): rows this window KEPT on screen after mark-all are read,
			 * not gone - `serverLists` no longer returns them once they are dismissed, so
			 * leaving them drawn showed ~101 rows against a conversation the server lists
			 * as empty. The ids the server confirmed leave through the same exit the
			 * gesture path uses.
			 */
			(result) => {
				const drawn = new Set(order.map((item) => item.id));
				const leaving = coveredByWrite(drawn, result.changed);
				if (leaving.size > 0) beginExit(leaving);
				return t("ui.notifications.toast.dismissed", {
					count: result.changed.length,
				});
			},
		);
	}, [confirmSession, navigate, notificationId, runWrite, order, beginExit]);

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
					visibleUnread={visibleUnread}
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
								{(newIds.size > 0 || list.hiddenNewer > 0) && (
									/*
									 * BACK TO TOP (code round 5, R5-1). While the operator is scrolled
									 * deep the page window slides: older pages stay reachable and the
									 * rows just above the viewport leave memory. This pill says how
									 * many, and pressing it is the way back - page one refetches, so
									 * the counts and the waiting asks on it are fresh.
									 */
									<div className="sticky top-0 z-[2] flex shrink-0 justify-center bg-canvas py-1">
										<Button
											size="sm"
											variant="secondary"
											data-notifications-back-to-top=""
											onClick={() => {
												listRef.current?.scrollTo({
													top: 0,
													behavior: "smooth",
												});
												setNewIds(new Set());
												list.resetToTop();
											}}
										>
											{t("ui.notifications.new_pill", {
												count: formatNumber(newIds.size + list.hiddenNewer),
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
										exitingIds={exitingIds}
										onExitFinished={finishExit}
										onOpen={openDetail}
										onToggleSelect={toggleSelect}
										onToggleRead={(item) => toggleRead([item])}
										onDismiss={(item) => dismiss([item])}
										onAnswer={answer}
										onFocusRow={(item) => setFocusId(item.id)}
										onDismissSession={requestDismissSession}
										/*
										 * Unknown renders NOTHING (code round 4, R4-1): the loaded
										 * page's number is the lie QA measured, and 0 would claim
										 * the conversation is already clear. While the walk for the
										 * current boundary is in flight or has failed, the header
										 * omits the number and its Dismiss-all control.
										 */
										sessionCount={(sessionId) =>
											scopeCounts?.[sessionId] ?? null
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
								/* Unknown — pending or failed — renders no number at all. */
								sessionDismissCount={scopeCounts?.[openItem.session.id] ?? null}
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
				<OperationProgressLine progress={operationProgress} />
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
	exitingIds: ReadonlySet<string>;
	onExitFinished: (id: string) => void;
	onOpen: (item: DesktopNotificationItem) => void;
	onToggleSelect: (item: DesktopNotificationItem, shift: boolean) => void;
	onToggleRead: (item: DesktopNotificationItem) => void;
	onDismiss: (item: DesktopNotificationItem) => void;
	onAnswer: (item: DesktopNotificationItem) => void;
	onFocusRow: (item: DesktopNotificationItem) => void;
	onDismissSession: (sessionId: string, title: string) => void;
	sessionCount: (sessionId: string) => number | null;
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
							/*
							 * A 24px MINIMUM TARGET (design audit OD7; WCAG 2.5.8). The
							 * disclosure measured 59x17 - the only failing target on the page.
							 * The height sits on the button so the 32px header band keeps its
							 * rhythm.
							 */
							className="inline-flex min-h-6 items-center gap-1 hover:text-ink"
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
				{group.kind === "conversation" && count !== null && count > 0 && (
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
					<NotificationRowExit
						key={item.id}
						exiting={row.exitingIds.has(item.id)}
						onExited={() => row.onExitFinished(item.id)}
					>
						<NotificationRow
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
					</NotificationRowExit>
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
	/** Rows the Unread filter draws, so its chip cannot disagree with the rail. */
	visibleUnread: number;
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
	visibleUnread,
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
								{value === "unread" && visibleUnread > 0 && (
									<Badge variant="neutral" size="count">
										{countLabel(visibleUnread, 99)}
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
