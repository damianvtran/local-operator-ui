/**
 * The community channel pane's timeline and thread (RFC v2.4 §5.3, §5.10;
 * frames D4, D20).
 *
 * STATES ARE THE PANE'S, THE RAIL STAYS USABLE (D20): loading is a skeleton
 * with "Loading #help…", an empty channel invites the first post with the
 * channel's own purpose, offline says nothing typed is sent until reconnect,
 * and a failed read says "Couldn't load #help" with Retry and keeps drafts.
 *
 * HISTORY PAGES OLDER ON DEMAND. The hub returns newest first with
 * viewer-bound cursors; "Load older messages" fetches the next page and the
 * model merges by id and orders by `seq` (`mergeHistory`).
 *
 * OWN MESSAGES. Edit and delete are offered on messages the reader is known to
 * have authored. The member projection carries no "mine" flag and the local
 * door has no own-profile read yet, so "known" means a `public_id` match when
 * the caller has one, or a message id this app posted in this session. A later
 * lane that adds the own-profile read only has to pass `selfPublicId`.
 *
 * Message text is rendered through the Team Bridge markdown renderer (no raw
 * HTML, links through its external-href guard), which is the same trust level
 * as private Team Bridge messages: content from other people.
 */
import { TeamBridgeEmojiPicker } from "@features/team-bridge/team-bridge-emoji-picker";
import { TeamBridgeMarkdown } from "@features/team-bridge/team-bridge-markdown";
import type { CommunityMessage } from "@shared/api/local-operator/community-api";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@shared/components/ui/alert";
import { Button } from "@shared/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui/popover";
import { Skeleton } from "@shared/components/ui/skeleton";
import { Textarea } from "@shared/components/ui/textarea";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	Hash,
	MessageSquare,
	Pencil,
	RefreshCw,
	SmilePlus,
	Trash2,
	WifiOff,
	X,
} from "lucide-react";
import { type FC, type ReactNode, useState } from "react";
import { CommunityOutcomeNotice } from "./community-composer";
import { initialsFor } from "./community-join-dialog";
import type { ComposerPhase } from "./community-model";

export type CommunityPaneState = "loading" | "error" | "ready";

const time = (iso: string) => {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? ""
		: date.toLocaleTimeString(undefined, {
				hour: "numeric",
				minute: "2-digit",
			});
};

const AuthorName: FC<{ message: CommunityMessage }> = ({ message }) => {
	const author = message.author;
	const name =
		author.kind === "former_member"
			? t("ui.community.message.former_member")
			: author.display_name;
	return (
		<span className="flex min-w-0 items-center gap-1.5">
			<span className="truncate text-[13px] font-medium text-ink">{name}</span>
			{author.kind === "agent" && (
				<span className="rounded-sm border border-hairline px-1 text-meta-sm text-ink-muted">
					{t("ui.community.message.agent_badge")}
				</span>
			)}
			{author.role && author.role !== "member" && (
				<span className="rounded-sm border border-hairline px-1 text-meta-sm text-ink-muted">
					{t(
						(
							{
								staff: "ui.community.role.staff",
								moderator: "ui.community.role.moderator",
								community_admin: "ui.community.role.community_admin",
							} as const
						)[author.role],
					)}
				</span>
			)}
			<span className="shrink-0 text-meta-sm text-ink-dim">
				{time(message.created_at)}
			</span>
			{message.edited && (
				<span className="shrink-0 text-meta-sm text-ink-dim">
					{t("ui.community.message.edited")}
				</span>
			)}
		</span>
	);
};

export type CommunityMessageHandlers = {
	accountId?: string;
	isOwn: (message: CommunityMessage) => boolean;
	onReact: (messageId: string, emoji: string) => void;
	/** Resolves to the edit's phase; `idle` means it was published. */
	onEdit: (messageId: string, text: string) => Promise<ComposerPhase>;
	onDelete: (messageId: string) => void;
	onOpenThread?: (messageId: string) => void;
	/** No reactions, edits or replies (read-only community, offline). */
	readOnly?: boolean;
};

const ReactionPicker: FC<{
	accountId?: string;
	onPick: (emoji: string) => void;
	children: ReactNode;
}> = ({ accountId, onPick, children }) => {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent
				className="w-auto p-3"
				align="end"
				side="top"
				collisionPadding={8}
			>
				<TeamBridgeEmojiPicker
					accountId={accountId ?? ""}
					onSelect={(emoji) => {
						onPick(emoji);
						setOpen(false);
					}}
					onClose={() => setOpen(false)}
				/>
			</PopoverContent>
		</Popover>
	);
};

export const CommunityMessageRow: FC<
	{ message: CommunityMessage; inThread?: boolean } & CommunityMessageHandlers
> = ({
	message,
	inThread = false,
	accountId,
	isOwn,
	onReact,
	onEdit,
	onDelete,
	onOpenThread,
	readOnly = false,
}) => {
	useI18nLocale();
	const [editing, setEditing] = useState(false);
	const [editText, setEditText] = useState(message.text ?? "");
	const [editPhase, setEditPhase] = useState<ComposerPhase>({ kind: "idle" });
	const [confirmDelete, setConfirmDelete] = useState(false);
	const own = isOwn(message);
	const name =
		message.author.kind === "former_member"
			? t("ui.community.message.former_member")
			: message.author.display_name;
	const replies = message.reply_count ?? 0;
	return (
		<li
			data-community-message={message.id}
			className="group relative flex gap-3 rounded-md px-3 py-2 hover:bg-surface"
		>
			<span
				aria-hidden="true"
				className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-elevated text-[12px] font-medium text-ink-muted"
			>
				{initialsFor(name)}
			</span>
			<div className="min-w-0 flex-1">
				<AuthorName message={message} />
				{editing ? (
					<div className="mt-1 flex flex-col gap-2">
						<CommunityOutcomeNotice
							phase={editPhase}
							now={Date.now()}
							onDismiss={() => setEditPhase({ kind: "idle" })}
						/>
						<Textarea
							value={editText}
							rows={2}
							aria-label={t("ui.community.message.edit")}
							onChange={(event) => setEditText(event.target.value)}
						/>
						<div className="flex gap-2">
							<Button
								size="sm"
								variant="primary"
								disabled={!editText.trim() || editPhase.kind === "checking"}
								onClick={async () => {
									setEditPhase({
										kind: "checking",
										key: "",
										cancelling: false,
									});
									const phase = await onEdit(message.id, editText);
									setEditPhase(phase);
									if (phase.kind === "idle") setEditing(false);
								}}
							>
								{editPhase.kind === "checking"
									? t("ui.community.composer.checking")
									: t("ui.community.message.save")}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setEditing(false);
									setEditText(message.text ?? "");
									setEditPhase({ kind: "idle" });
								}}
							>
								{t("ui.community.message.cancel_edit")}
							</Button>
						</div>
					</div>
				) : (
					message.text && (
						<div className="text-[13px] text-ink">
							<TeamBridgeMarkdown>{message.text}</TeamBridgeMarkdown>
						</div>
					)
				)}
				{(message.asset_ids?.length ?? 0) > 0 && (
					<p className="mt-1 text-meta-sm text-ink-muted">
						{t("ui.community.message.images", {
							count: message.asset_ids?.length ?? 0,
						})}
					</p>
				)}
				{confirmDelete && (
					<div
						role="alert"
						className="mt-2 flex flex-wrap items-center gap-2 text-meta-sm text-ink"
					>
						{t("ui.community.message.delete_confirm")}
						<Button
							size="sm"
							variant="danger"
							onClick={() => {
								setConfirmDelete(false);
								onDelete(message.id);
							}}
						>
							{t("ui.community.message.delete_confirm_action")}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setConfirmDelete(false)}
						>
							{t("ui.community.message.cancel_edit")}
						</Button>
					</div>
				)}
				{((message.reactions?.length ?? 0) > 0 ||
					(!inThread && replies > 0)) && (
					<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
						{message.reactions?.map((reaction) => (
							<button
								type="button"
								key={reaction.emoji}
								disabled={readOnly}
								aria-pressed={Boolean(reaction.mine)}
								aria-label={t("ui.community.message.reaction_label", {
									emoji: reaction.emoji,
									count: reaction.count,
								})}
								onClick={() => onReact(message.id, reaction.emoji)}
								className={cn(
									"inline-flex h-6 items-center gap-1 rounded-full border px-2 text-meta-sm tabular-nums",
									reaction.mine
										? "border-accent bg-accent-wash text-ink"
										: "border-hairline bg-surface text-ink-muted hover:bg-elevated",
								)}
							>
								<span aria-hidden="true">{reaction.emoji}</span>
								<span aria-hidden="true">{reaction.count}</span>
							</button>
						))}
						{!inThread && replies > 0 && onOpenThread && (
							<Button
								variant="link"
								size="sm"
								className="h-6 px-1"
								onClick={() => onOpenThread(message.id)}
							>
								{t("ui.community.message.replies", { count: replies })}
							</Button>
						)}
					</div>
				)}
			</div>
			{!readOnly && !editing && (
				<div
					className="absolute end-2 -top-3 hidden items-center gap-0.5 rounded-md border border-hairline bg-elevated p-0.5 group-focus-within:flex group-hover:flex"
					data-community-toolbar=""
				>
					<ReactionPicker
						accountId={accountId}
						onPick={(emoji) => onReact(message.id, emoji)}
					>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.community.message.react")}
						>
							<SmilePlus size={14} aria-hidden="true" />
						</Button>
					</ReactionPicker>
					{!inThread && onOpenThread && (
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.community.message.reply")}
							onClick={() => onOpenThread(message.id)}
						>
							<MessageSquare size={14} aria-hidden="true" />
						</Button>
					)}
					{own && (
						<>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.community.message.edit")}
								onClick={() => {
									setEditText(message.text ?? "");
									setEditing(true);
								}}
							>
								<Pencil size={14} aria-hidden="true" />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.community.message.delete")}
								onClick={() => setConfirmDelete(true)}
							>
								<Trash2 size={14} aria-hidden="true" />
							</Button>
						</>
					)}
				</div>
			)}
		</li>
	);
};

const LoadingSkeleton: FC<{ channelName: string }> = ({ channelName }) => (
	<div
		data-community-pane="loading"
		aria-busy="true"
		className="flex flex-1 flex-col justify-end gap-5 px-6 py-4"
	>
		{[0, 1].map((row) => (
			<div key={row} className="flex gap-3">
				<Skeleton className="size-8 shrink-0" />
				<div className="flex flex-1 flex-col gap-2">
					<Skeleton className="h-3 w-24" />
					<Skeleton className="h-3 w-2/3" />
					<Skeleton className="h-3 w-1/3" />
				</div>
			</div>
		))}
		<output className="flex items-center gap-2 text-meta-sm text-ink-muted">
			<RefreshCw size={12} aria-hidden="true" />
			{t("ui.community.channel.loading", { channel: channelName })}
		</output>
	</div>
);

export const CommunityMessageListView: FC<
	{
		channelName: string;
		channelPurpose?: string | null;
		state: CommunityPaneState;
		offline?: boolean;
		messages: readonly CommunityMessage[];
		hasOlder: boolean;
		loadingOlder: boolean;
		onLoadOlder: () => void;
		onRetry: () => void;
	} & CommunityMessageHandlers
> = ({
	channelName,
	channelPurpose,
	state,
	offline = false,
	messages,
	hasOlder,
	loadingOlder,
	onLoadOlder,
	onRetry,
	...handlers
}) => {
	useI18nLocale();
	const offlineBanner = offline && (
		<Alert
			variant="warning"
			data-community-pane="offline"
			icon={<WifiOff size={15} aria-hidden="true" />}
			className="mx-6 mt-4"
		>
			<AlertDescription className="text-[13px] text-ink">
				{t("ui.community.channel.offline")}
			</AlertDescription>
		</Alert>
	);
	if (state === "loading" && !offline)
		return <LoadingSkeleton channelName={channelName} />;
	if (state === "error" && !offline)
		return (
			<div
				data-community-pane="error"
				className="flex flex-1 items-center justify-center px-6"
			>
				<Alert variant="danger" className="max-w-md">
					<AlertTitle>
						{t("ui.community.channel.error.title", { channel: channelName })}
					</AlertTitle>
					<AlertDescription>
						<p>{t("ui.community.channel.error.body")}</p>
						<Button
							variant="secondary"
							size="sm"
							className="mt-3"
							data-community-action="retry-channel"
							onClick={onRetry}
						>
							<RefreshCw size={13} aria-hidden="true" />
							{t("ui.community.channel.retry")}
						</Button>
					</AlertDescription>
				</Alert>
			</div>
		);
	if (messages.length === 0 && state === "ready")
		return (
			<div className="flex flex-1 flex-col">
				{offlineBanner}
				<div
					data-community-pane="empty"
					className="flex flex-1 flex-col items-center justify-center px-6 text-center"
				>
					<span
						aria-hidden="true"
						className="mb-3 flex size-9 items-center justify-center rounded-md bg-elevated text-ink-muted"
					>
						<Hash size={16} />
					</span>
					<p className="text-[15px] font-medium text-ink">
						{t("ui.community.channel.empty.title")}
					</p>
					{channelPurpose && (
						<p className="mt-2 max-w-md text-[13px] text-ink-muted">
							{channelPurpose}
						</p>
					)}
				</div>
			</div>
		);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{offlineBanner}
			<div
				data-community-pane="ready"
				className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-3"
			>
				{/* column-reverse keeps the newest row at the bottom without a scroll
				    effect; the DOM order below is oldest first for readers. */}
				<div>
					<div className="flex justify-center py-2">
						{hasOlder ? (
							<Button
								variant="ghost"
								size="sm"
								disabled={loadingOlder}
								data-community-action="load-older"
								onClick={onLoadOlder}
							>
								{loadingOlder
									? t("ui.community.channel.loading_older")
									: t("ui.community.channel.load_older")}
							</Button>
						) : (
							<p className="text-meta-sm text-ink-dim">
								{t("ui.community.channel.beginning", { channel: channelName })}
							</p>
						)}
					</div>
					<ul className="flex flex-col gap-0.5">
						{messages.map((message) => (
							<CommunityMessageRow
								key={message.id}
								message={message}
								readOnly={handlers.readOnly || offline}
								{...handlers}
							/>
						))}
					</ul>
				</div>
			</div>
		</div>
	);
};

/** The thread pane: the root, its loaded replies, and a reply composer. */
export const CommunityThreadPane: FC<
	{
		root: CommunityMessage;
		replies: readonly CommunityMessage[];
		onClose: () => void;
		composer: ReactNode;
	} & CommunityMessageHandlers
> = ({ root, replies, onClose, composer, ...handlers }) => {
	useI18nLocale();
	const missing = Math.max(0, (root.reply_count ?? 0) - replies.length);
	return (
		<aside
			data-community-thread={root.id}
			aria-label={t("ui.community.thread.title")}
			className="flex h-full w-[360px] shrink-0 flex-col bg-surface"
		>
			<header className="flex h-12 shrink-0 items-center justify-between px-4">
				<h2 className="text-[14px] font-medium text-ink">
					{t("ui.community.thread.title")}
				</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("ui.community.thread.close")}
					onClick={onClose}
				>
					<X size={14} aria-hidden="true" />
				</Button>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-1">
				<ul>
					<CommunityMessageRow message={root} inThread {...handlers} />
				</ul>
				{missing > 0 && (
					<p className="px-4 py-2 text-meta-sm text-ink-dim">
						{t("ui.community.thread.older_not_loaded")}
					</p>
				)}
				<ul className="border-t border-hairline pt-1">
					{replies.map((reply) => (
						<CommunityMessageRow
							key={reply.id}
							message={reply}
							inThread
							{...handlers}
						/>
					))}
				</ul>
			</div>
			<div className="shrink-0 p-3">{composer}</div>
		</aside>
	);
};
