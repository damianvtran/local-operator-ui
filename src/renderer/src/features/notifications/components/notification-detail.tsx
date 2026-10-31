import {
	answerQueuedAsk,
	declineQueuedAsk,
	dismissQueuedAsk,
	reviseQueuedAsk,
} from "@features/chat/ask-answer";
import type { AskDismissReason, AskDraft } from "@features/chat/ask-queue";
import { askQueueView } from "@features/chat/ask-queue";
/**
 * The detail pane (design.md § 2 "Detail", contract § 5.2 `GET …/{id}`).
 *
 * WHAT IT SHOWS, top to bottom: priority and kind, the title, the source line
 * and repeat count, the actions (Open conversation, Mark read/unread, Dismiss,
 * the ⋯ menu), the body and metrics as markdown, that conversation's open asks
 * answerable inline through the EXISTING ask panel (no second answer UI), the
 * source conversation card with "Dismiss all n", related projects, and the
 * collapsed repeats under "Earlier updates".
 *
 * OPENING IS AN EXPLICIT READ (contract § 6.4 "Relay/native", design § 17.3):
 * the reader chose this item, so the page marks it read with the revision it
 * rendered when the detail opens. That is the page's job, not this pane's; the
 * pane draws.
 *
 * A VANISHED ITEM STAYS READABLE (design § 5 "Item vanished"): if the detail
 * read answers `dismissed`, the content stays on screen with a notice and the
 * actions disabled, rather than the pane closing under the reader.
 */
import { AskPanel } from "@features/chat/components/asks/ask-panel";
import { FLEET_ASKS_QUERY_KEY, useFleetAsks } from "@features/chat/fleet-asks";
import { useAskOutcomes } from "@features/chat/use-ask-outcomes";
import { ProjectMarkdown } from "@features/projects/project-markdown";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { Alert, Button, Skeleton } from "@shared/components/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { formatNumber, formatTime, t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import {
	ArrowLeft,
	Check,
	Circle,
	ExternalLink,
	FolderKanban,
	MessageCircleQuestion,
	MoreHorizontal,
	X,
} from "lucide-react";
import { type FC, useMemo, useState } from "react";
import type {
	DesktopNotificationDetail,
	DesktopNotificationItem,
} from "../../../../../shared/desktop-control-contract";
import type { PendingAsk } from "../../../../../shared/desktop-session-contract";
import { isLiveAsk } from "../notifications-model";
import { rowTimeOf } from "../notifications-model";
import { priorityName, rowTimeText } from "./notification-row";
import { PriorityBars } from "./priority-bars";

export type NotificationDetailProps = {
	/** The row as the list rendered it: the fallback while the detail loads. */
	item: DesktopNotificationItem;
	detail: DesktopNotificationDetail | undefined;
	loading: boolean;
	error: boolean;
	nowMs: number;
	/** Narrow window: the detail replaces the list and draws a back link. */
	narrow: boolean;
	writesPaused: boolean;
	/** How many items "Dismiss all from this conversation" would name. */
	/*
	 * `null` while the scope walk for the current boundary is pending or failed
	 * (code round 4, R4-1). An unknown count renders NO number: the loaded page's
	 * count was the lie QA measured, and 0 would say the conversation is clear.
	 */
	sessionDismissCount: number | null;
	onClose: () => void;
	onOpenConversation: (sessionId: string) => void;
	onToggleRead: (item: DesktopNotificationItem) => void;
	onDismiss: (item: DesktopNotificationItem) => void;
	onDismissSession: (sessionId: string, title: string) => void;
	onCopyLink: (item: DesktopNotificationItem) => void;
	onOpenProject: (key: string) => void;
	onAsksSettled: (
		askId: string,
		status: "answered" | "declined" | "dismissed",
	) => void;
	/** Focus the first live ask's answer field on mount (`A`, `E` on an ask). */
	focusAnswer?: boolean;
};

/** No drafts, one stable object: a fresh `{}` per render re-keys every card. */
const EMPTY_DRAFTS: Record<string, AskDraft> = {};

export const NotificationDetail: FC<NotificationDetailProps> = ({
	item: rowItem,
	detail,
	loading,
	error,
	nowMs,
	narrow,
	writesPaused,
	sessionDismissCount,
	onClose,
	onOpenConversation,
	onToggleRead,
	onDismiss,
	onDismissSession,
	onCopyLink,
	onOpenProject,
	onAsksSettled,
}) => {
	const item = detail?.item ?? rowItem;
	const gone = item.dismissed;
	const liveAsk = isLiveAsk(item);
	const actionsDisabled = writesPaused || gone;
	const source = item.session.title || t("ui.notifications.group.untitled");
	const repeat = item.repeat_count > 1 ? item.repeat_count : 0;
	const [showAllHistory, setShowAllHistory] = useState(false);
	const history = detail?.history ?? [];
	const shownHistory = showAllHistory ? history : history.slice(0, 5);
	const projects = detail?.projects ?? item.projects ?? [];
	const body = detail?.item.body_md ?? "";

	return (
		<section
			aria-label={t("ui.notifications.detail.label")}
			data-notification-detail={item.id}
			/*
			 * NO `overflow-x-hidden` (it used to be here): it is what turned the column's
			 * overflow into a silent clip at the window edge instead of a visible defect.
			 * The column is bounded by its parent's `min-w-0` now, and long unbroken text
			 * wraps (`[overflow-wrap:anywhere]` below), so there is nothing to hide.
			 */
			className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-6 py-4 [overflow-wrap:anywhere] [scrollbar-gutter:stable]"
		>
			<div className="flex items-center justify-between gap-2">
				{narrow ? (
					<Button variant="ghost" size="sm" onClick={onClose}>
						<ArrowLeft className="rtl:-scale-x-100" aria-hidden="true" />
						{t("ui.notifications.detail.back")}
					</Button>
				) : (
					<span className="flex items-center gap-2 text-meta">
						{item.source === "ask" ? (
							<MessageCircleQuestion
								size={14}
								aria-hidden="true"
								className="text-info"
							/>
						) : (
							<PriorityBars priority={item.priority} />
						)}
						<span
							className={cn(
								item.priority === "high" ? "text-warning" : "text-ink-muted",
							)}
						>
							{priorityName(item)}
						</span>
						<span aria-hidden="true" className="text-ink-dim">
							·
						</span>
						<span className="text-ink-muted">
							{item.source === "ask"
								? t("ui.notifications.detail.kind.ask")
								: t("ui.notifications.detail.kind.update")}
						</span>
					</span>
				)}
				{!narrow && (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.notifications.detail.close")}
						title={t("ui.notifications.detail.close")}
						onClick={onClose}
					>
						<X aria-hidden="true" />
					</Button>
				)}
			</div>

			<h2
				className="mt-3 text-heading text-ink"
				data-notification-detail-title=""
				tabIndex={-1}
			>
				{item.title}
			</h2>
			<p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-ink-dim text-meta">
				<span className="text-ink-muted">{source}</span>
				<span aria-hidden="true">·</span>
				<span>{rowTimeText(rowTimeOf(item.updated_at, nowMs))}</span>
				{repeat > 0 && (
					<>
						<span aria-hidden="true">·</span>
						<span>
							{t("ui.notifications.detail.meta.updates_since", {
								count: repeat,
								time: formatTime(item.created_at, {
									hour: "2-digit",
									minute: "2-digit",
								}),
							})}
						</span>
					</>
				)}
			</p>

			{gone && (
				// biome-ignore lint/a11y/useSemanticElements: `role="status"` is a live region with no element of its own; `<output>` is a form's result, and this is a page notice
				<Alert variant="neutral" className="mt-3" role="status">
					{t("ui.notifications.detail.gone.dismissed")}
				</Alert>
			)}

			<div className="mt-4 flex flex-wrap items-center gap-2">
				<Button
					variant="primary"
					size="sm"
					onClick={() => onOpenConversation(item.session.id)}
					data-notification-open-conversation=""
				>
					<ExternalLink aria-hidden="true" className="rtl:-scale-x-100" />
					{t("ui.notifications.detail.open_conversation")}
				</Button>
				<Button
					variant="secondary"
					size="sm"
					aria-disabled={actionsDisabled || undefined}
					/*
					 * AN INERT CONTROL MUST LOOK INERT (design audit OD6). `aria-disabled`
					 * told assistive tech the button was unavailable while the button kept
					 * its full contrast and hover, so on a row dismissed a moment ago it read
					 * as live and answered a click with nothing happening.
					 */
					className={actionsDisabled ? "text-ink-disabled" : undefined}
					title={
						writesPaused ? t("ui.notifications.writes_paused_tip") : undefined
					}
					onClick={() => {
						if (actionsDisabled) return;
						onToggleRead(item);
					}}
					data-notification-toggle-read=""
				>
					{item.read ? (
						<Circle aria-hidden="true" />
					) : (
						<Check aria-hidden="true" />
					)}
					{item.read
						? t("ui.notifications.row.mark_unread")
						: t("ui.notifications.row.mark_read")}
				</Button>
				{!liveAsk && (
					<Button
						variant="secondary"
						size="sm"
						aria-disabled={actionsDisabled || undefined}
						/* See the sibling above: inert has to look inert (OD6). */
						className={actionsDisabled ? "text-ink-disabled" : undefined}
						title={
							writesPaused ? t("ui.notifications.writes_paused_tip") : undefined
						}
						onClick={() => {
							if (actionsDisabled) return;
							onDismiss(item);
						}}
						data-notification-dismiss=""
					>
						<X aria-hidden="true" />
						{/*
						 * ONE ROW, ONE DISMISSAL (design audit OD5). This said "Dismiss 6" for
						 * an item updated six times - a count of REVISIONS over a button that
						 * removes ONE row, contradicting the From card beside it ("Dismiss all
						 * 1") about the same object in the same flow. The repeat count stays
						 * where it is history: the header chip and the change log.
						 */}
						{t("ui.notifications.detail.dismiss")}
					</Button>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.notifications.row.more")}
							title={t("ui.notifications.row.more")}
						>
							<MoreHorizontal aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							disabled={
								actionsDisabled ||
								(sessionDismissCount === null
									? false
									: sessionDismissCount === 0)
							}
							onSelect={() => onDismissSession(item.session.id, source)}
						>
							{t("ui.notifications.detail.more.dismiss_session", { source })}
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => onCopyLink(item)}>
							{t("ui.notifications.detail.more.copy_link")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{error && !detail && (
				<Alert variant="danger" className="mt-4" role="alert">
					{t("ui.notifications.detail.error")}
				</Alert>
			)}

			{loading && !detail ? (
				<div
					className="mt-4 flex flex-col gap-2"
					// biome-ignore lint/a11y/useSemanticElements: `role="status"` is a live region with no element of its own; `<output>` is a form's result, and this is a page notice
					role="status"
					aria-label={t("ui.notifications.detail.loading")}
				>
					<Skeleton className="h-3 w-full bg-elevated" />
					<Skeleton className="h-3 w-5/6 bg-elevated" />
					<Skeleton className="h-3 w-2/3 bg-elevated" />
				</div>
			) : body ? (
				/*
				 * BODY AND METRICS ARE ONE MARKDOWN DOCUMENT (contract § 3.1: the
				 * `notify` tool carries `body_md`, no separate metrics field), drawn
				 * by the Projects renderer: same `.lo-markdown` rules, tables scroll
				 * inside their own box, raw HTML is not rendered.
				 */
				<ProjectMarkdown className="mt-4 text-body text-ink">
					{body}
				</ProjectMarkdown>
			) : item.excerpt ? (
				<p className="mt-4 text-body text-ink">{item.excerpt}</p>
			) : null}

			{(detail?.item.links?.length ?? 0) > 0 && (
				<DetailSection title={t("ui.notifications.detail.section.links")}>
					<ul className="flex flex-col gap-1">
						{detail?.item.links?.map((link) => (
							<li key={link.url}>
								<a
									href={link.url}
									target="_blank"
									rel="noreferrer"
									className="text-accent text-body-sm underline-offset-2 hover:underline"
								>
									{link.label || link.url}
								</a>
							</li>
						))}
					</ul>
				</DetailSection>
			)}

			{detail?.anchor?.excerpt && (
				<DetailSection title={t("ui.notifications.detail.section.context")}>
					<p className="line-clamp-4 text-body-sm text-ink-muted">
						{detail.anchor.excerpt}
					</p>
				</DetailSection>
			)}

			{(detail?.asks?.length ?? 0) > 0 && (
				<DetailSection title={t("ui.notifications.detail.section.waiting")}>
					<DetailAsks
						sessionId={item.session.id}
						asks={(detail?.asks ?? []) as PendingAsk[]}
						nowMs={nowMs}
						onSettled={onAsksSettled}
					/>
				</DetailSection>
			)}

			<DetailSection title={t("ui.notifications.detail.section.from")}>
				<div className="flex items-center justify-between gap-3 rounded-md bg-surface px-3 py-2">
					<button
						type="button"
						onClick={() => onOpenConversation(item.session.id)}
						className="min-w-0 truncate text-start text-body-sm text-ink hover:underline"
					>
						{detail?.session.title || source}
					</button>
					{/*
					 * MOUNTED WHILE COUNTING (design round 5, D3). Hiding the button until the
					 * walk answered made the From card grow 8.5 px when the number arrived,
					 * pushing the rest of the detail down. It now holds its place: the number
					 * slot shows an ellipsis (never a guessed number, never 0 - code round 4,
					 * R4-1) and the action is unavailable until the count lands. A KNOWN zero
					 * still removes it: there is nothing to dismiss. `min-w-[6.5rem]` holds
					 * room for a three-digit English count (measured 96 px for "42" at 100 %),
					 * so the right-aligned button's left edge does not move either.
					 */}
					{sessionDismissCount !== 0 && (
						<Button
							variant="ghost"
							size="sm"
							className="min-w-[6.5rem] shrink-0 tabular-nums"
							data-detail-dismiss-all={
								sessionDismissCount === null ? "counting" : "ready"
							}
							aria-busy={sessionDismissCount === null || undefined}
							aria-disabled={
								actionsDisabled || sessionDismissCount === null || undefined
							}
							onClick={() => {
								if (actionsDisabled || sessionDismissCount === null) return;
								onDismissSession(item.session.id, source);
							}}
						>
							{t("ui.notifications.detail.from.dismiss_all", {
								count:
									sessionDismissCount === null
										? "…"
										: formatNumber(sessionDismissCount),
							})}
						</Button>
					)}
				</div>
			</DetailSection>

			{projects.length > 0 && (
				<DetailSection title={t("ui.notifications.detail.section.projects")}>
					<ul className="flex flex-col gap-1">
						{projects.map((project) => (
							<li key={project.key}>
								<button
									type="button"
									onClick={() => onOpenProject(project.key)}
									className="flex items-center gap-2 rounded-sm px-2 py-1 text-start text-body-sm text-ink hover:bg-row-hover"
								>
									<FolderKanban
										size={14}
										aria-hidden="true"
										className="shrink-0 text-ink-muted"
									/>
									<span className="min-w-0 truncate">{project.name}</span>
									{project.status && (
										<span className="text-ink-dim text-meta">
											{project.status}
										</span>
									)}
								</button>
							</li>
						))}
					</ul>
				</DetailSection>
			)}

			{history.length > 0 && (
				<DetailSection title={t("ui.notifications.detail.section.history")}>
					<ol className="flex flex-col gap-2">
						{shownHistory.map((entry) => (
							<li
								key={entry.revision}
								className="flex flex-col gap-0.5"
								data-history-revision={entry.revision}
							>
								<span className="flex items-baseline justify-between gap-2 text-body-sm text-ink">
									<span className="min-w-0 truncate">{entry.title}</span>
									<span className="shrink-0 text-ink-dim text-meta tabular-nums">
										{rowTimeText(rowTimeOf(entry.at, nowMs))}
									</span>
								</span>
								{entry.excerpt && (
									<span className="truncate text-ink-dim text-meta">
										{entry.excerpt}
									</span>
								)}
							</li>
						))}
					</ol>
					{history.length > 5 && !showAllHistory && (
						<Button
							variant="ghost"
							size="sm"
							className="self-start"
							onClick={() => setShowAllHistory(true)}
						>
							{t("ui.notifications.detail.history.show_all", {
								count: formatNumber(history.length),
							})}
						</Button>
					)}
				</DetailSection>
			)}
		</section>
	);
};

const DetailSection: FC<{ title: string; children: React.ReactNode }> = ({
	title,
	children,
}) => (
	<div className="mt-6 flex flex-col gap-2">
		<h3 className="text-ink-muted text-meta">{title}</h3>
		{children}
	</div>
);

/**
 * That conversation's asks, answerable here through the EXISTING panel (design
 * § 2, contract § 5.2 `asks`). The answer, decline and dismiss doors are the
 * fleet drawer's own helpers addressed at the ask's session, so a press here
 * and a press in the drawer are the same request; one send lock per pane.
 *
 * THE OUTCOME IS THE SHARED RECORD (`useAskOutcomes`), not a local `{sending,
 * refused}` map. This pane's rows are a READ (`notifications.get`), not the live
 * session stream, so after the owner accepts an answer the rows still say
 * `open` until the detail is read again - and while the item stays selected that
 * read may not land for a while. Recording only `{sending, refused}` therefore
 * left the card on `Queued — the agent is continuing; expires in 23h` with live
 * options and `Send answer` after a successful press. The hook's `settled`
 * record is painted over the stale frame (`askWithLocalSettle`), so the card,
 * its Pending/Settled filter and counts move in the frame the owner answers.
 *
 * AND THE WIRE'S OWN ROW TAKES OVER FROM THE AGGREGATE, not from this read. Core's
 * detail route answers an `ask:<session>:<ask>` item only while that ask is
 * OUTSTANDING (`notifications/items.py::detail`, `is_outstanding`), so the refetch
 * after an answer is a 404 and the query keeps the last good - `open` - rows; even
 * an update's detail is re-read only on an explicit invalidation. Either way the
 * card's `delivered` was never read again, and it sat on `Answered — delivering`
 * for as long as the item stayed selected. The fleet aggregate (`asks.list`, the
 * same durable index this read comes from) carries settled rows with `delivered`
 * and polls while mounted, so a row it has SETTLED replaces this read's row for the
 * same ask id; the read stays the source for everything else.
 */
const DetailAsks: FC<{
	sessionId: string;
	asks: PendingAsk[];
	nowMs: number;
	onSettled: (
		askId: string,
		status: "answered" | "declined" | "dismissed",
	) => void;
}> = ({ sessionId, asks, nowMs, onSettled }) => {
	const { client } = useOptionalQueryClient();
	const { lock, outcomes, answering, run } = useAskOutcomes({
		onAccepted: (act) => {
			if (act.kind !== "changed") onSettled(act.askId, act.kind);
			/*
			 * NUDGE THE AGGREGATE, ONCE (agent review round 1, R1-3). The server's own
			 * row - with `delivered`, which moves the card from `Answered — delivering`
			 * to Settled - reaches this pane through `asks.list`, polled every 10 s.
			 * One invalidation per accepted act brings that read forward; it is the
			 * shared key's existing query, so no new loop starts.
			 */
			void client?.invalidateQueries({ queryKey: FLEET_ASKS_QUERY_KEY });
		},
	});
	const [drafts, setDrafts] = useState<Record<string, AskDraft>>(EMPTY_DRAFTS);
	const fleet = useFleetAsks().rows;
	const rows = useMemo(() => {
		const settled = new Map<string, PendingAsk>();
		for (const row of fleet ?? [])
			if (row.session_id === sessionId && row.status !== "open")
				settled.set(row.ask_id, row);
		return asks.map((ask) => settled.get(ask.ask_id) ?? ask);
	}, [asks, fleet, sessionId]);
	const view = useMemo(
		() =>
			askQueueView(
				{
					asks: rows,
					asks_open: rows.filter((ask) => ask.status === "open").length,
					asks_truncated: false,
				},
				outcomes,
			),
		[rows, outcomes],
	);
	return (
		<AskPanel
			view={view}
			nowMs={nowMs}
			answering={answering}
			outcomes={outcomes}
			drafts={drafts}
			onDraftChange={(askId, next) =>
				setDrafts((current) => ({ ...current, [askId]: next }))
			}
			onAnswer={(ask, answers) =>
				run({
					askId: ask.ask_id,
					kind: "answered",
					answers,
					questions: ask.questions,
					send: () =>
						answerQueuedAsk(
							{ taskId: ask.ask_id, answers, sessionId, lock },
							(request) => desktopResult(request),
						),
				})
			}
			onRevise={(ask, answers) =>
				run({
					askId: ask.ask_id,
					kind: "changed",
					answers,
					questions: ask.questions,
					send: () =>
						reviseQueuedAsk(
							{ taskId: ask.ask_id, answers, sessionId, lock },
							(request) => desktopResult(request),
						),
				})
			}
			onDecline={(ask) =>
				run({
					askId: ask.ask_id,
					kind: "declined",
					send: () =>
						declineQueuedAsk(
							{ taskId: ask.ask_id, sessionId, lock },
							(request) => desktopResult(request),
						),
				})
			}
			onDismiss={(ask, reason: AskDismissReason) =>
				run({
					askId: ask.ask_id,
					kind: "dismissed",
					reason,
					send: () =>
						dismissQueuedAsk(
							{ taskId: ask.ask_id, reason, sessionId, lock },
							(request) => desktopResult(request),
						),
				})
			}
		/>
	);
};
