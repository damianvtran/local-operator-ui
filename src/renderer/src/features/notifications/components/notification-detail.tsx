import {
	type AnswerOutcome,
	answerQueuedAsk,
	createSendLock,
	declineQueuedAsk,
	dismissQueuedAsk,
} from "@features/chat/ask-answer";
import type {
	AskDismissReason,
	AskDraft,
	AskOutcome,
} from "@features/chat/ask-queue";
import { askQueueView, askRefusalSentence } from "@features/chat/ask-queue";
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
import { ProjectMarkdown } from "@features/projects/project-markdown";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { Alert, Button, Skeleton } from "@shared/components/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
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
import { type FC, useCallback, useMemo, useRef, useState } from "react";
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
	sessionDismissCount: number;
	onClose: () => void;
	onOpenConversation: (sessionId: string) => void;
	onToggleRead: (item: DesktopNotificationItem) => void;
	onDismiss: (item: DesktopNotificationItem) => void;
	onDismissSession: (sessionId: string, title: string) => void;
	onCopyLink: (item: DesktopNotificationItem) => void;
	onOpenProject: (key: string) => void;
	onAsksSettled: () => void;
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
			className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-6 py-4 [scrollbar-gutter:stable]"
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
						{repeat > 0
							? t("ui.notifications.detail.dismiss_repeat", {
									count: formatNumber(repeat),
								})
							: t("ui.notifications.detail.dismiss")}
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
							disabled={actionsDisabled || sessionDismissCount === 0}
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
					{sessionDismissCount > 0 && (
						<Button
							variant="ghost"
							size="sm"
							aria-disabled={actionsDisabled || undefined}
							onClick={() => {
								if (actionsDisabled) return;
								onDismissSession(item.session.id, source);
							}}
						>
							{t("ui.notifications.detail.from.dismiss_all", {
								count: formatNumber(sessionDismissCount),
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
 */
const DetailAsks: FC<{
	sessionId: string;
	asks: PendingAsk[];
	nowMs: number;
	onSettled: () => void;
}> = ({ sessionId, asks, nowMs, onSettled }) => {
	const lock = useRef(createSendLock()).current;
	const [drafts, setDrafts] = useState<Record<string, AskDraft>>(EMPTY_DRAFTS);
	const [outcomes, setOutcomes] = useState<
		Record<string, AskOutcome | undefined>
	>({});
	const [answering, setAnswering] = useState(false);
	const view = useMemo(
		() =>
			askQueueView(
				{
					asks,
					asks_open: asks.filter((ask) => ask.status === "open").length,
					asks_truncated: false,
				},
				outcomes,
			),
		[asks, outcomes],
	);
	const run = useCallback(
		(askId: string, send: () => Promise<AnswerOutcome>) => {
			if (lock.held) return;
			setAnswering(true);
			setOutcomes((current) => ({
				...current,
				[askId]: { sending: true, refused: null },
			}));
			void (async () => {
				let outcome: AnswerOutcome;
				try {
					outcome = await send();
				} finally {
					setAnswering(false);
				}
				setOutcomes((current) => ({
					...current,
					[askId]: {
						sending: false,
						refused:
							outcome.status === "failed"
								? askRefusalSentence(outcome.error)
								: null,
					},
				}));
				if (outcome.status === "sent") onSettled();
			})();
		},
		[lock, onSettled],
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
				run(ask.ask_id, () =>
					answerQueuedAsk(
						{ taskId: ask.ask_id, answers, sessionId, lock },
						(request) => desktopResult(request),
					),
				)
			}
			onDecline={(ask) =>
				run(ask.ask_id, () =>
					declineQueuedAsk({ taskId: ask.ask_id, sessionId, lock }, (request) =>
						desktopResult(request),
					),
				)
			}
			onDismiss={(ask, reason: AskDismissReason) =>
				run(ask.ask_id, () =>
					dismissQueuedAsk(
						{ taskId: ask.ask_id, reason, sessionId, lock },
						(request) => desktopResult(request),
					),
				)
			}
		/>
	);
};
