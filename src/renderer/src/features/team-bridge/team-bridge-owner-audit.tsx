import type { OwnerAuditScope } from "@shared/api/local-operator/team-bridge-owner-audit-api";
import { Button } from "@shared/components/ui/button";
import { formatDateTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { type ReactNode, useState } from "react";
import type {
	OwnerAuditConversation,
	OwnerAuditMessage,
} from "../../../../shared/team-bridge-owner-audit-contract";
import {
	ownerAuditChronology,
	ownerAuditDelivery,
	ownerAuditTitle,
} from "./team-bridge-owner-audit-model";
import {
	useOwnerAuditConversations,
	useOwnerAuditMessages,
	useOwnerAuditReplies,
} from "./use-team-bridge-owner-audit";

type ReadState = "loading" | "error" | "ready";
const title = (conversation: OwnerAuditConversation) =>
	ownerAuditTitle(conversation, t("ui.ownerAudit.unnamed"));

function AuditFailure({ retry }: { retry: () => void }) {
	return (
		<div role="alert" className="space-y-2 text-sm text-ink-muted">
			<p>{t("ui.ownerAudit.error")}</p>
			<Button variant="ghost" onClick={retry}>
				{t("ui.ownerAudit.retry")}
			</Button>
		</div>
	);
}

export function OwnerAuditRailView({
	conversations,
	state,
	selectedId,
	onSelect,
	retry,
	hasMore = false,
	loadingMore = false,
	loadMore,
}: {
	conversations: OwnerAuditConversation[];
	state: ReadState;
	selectedId?: string;
	onSelect: (conversation: OwnerAuditConversation) => void;
	retry: () => void;
	hasMore?: boolean;
	loadingMore?: boolean;
	loadMore?: () => void;
}) {
	useI18nLocale();
	if (state === "loading")
		return (
			<output className="px-3 py-2 text-sm text-ink-muted">
				{t("ui.ownerAudit.loading")}
			</output>
		);
	if (state === "error") return <AuditFailure retry={retry} />;
	return (
		<>
			{conversations.length === 0 && (
				<p className="px-3 py-2 text-sm text-ink-muted">
					{t("ui.ownerAudit.empty_list")}
				</p>
			)}
			<ul>
				{conversations.map((conversation) => (
					<li key={conversation.id}>
						<button
							type="button"
							aria-current={selectedId === conversation.id ? "page" : undefined}
							className={cn(
								"w-full rounded-md px-3 py-2 text-start text-sm text-ink",
								selectedId === conversation.id
									? "bg-row-selected"
									: "hover:bg-row-hover",
							)}
							onClick={() => onSelect(conversation)}
						>
							<span className="block truncate">{title(conversation)}</span>
							<span className="block truncate text-xs text-ink-muted">
								{conversation.agent.display_label || t("ui.ownerAudit.agent")}
							</span>
						</button>
					</li>
				))}
			</ul>
			{hasMore && (
				<Button variant="ghost" disabled={loadingMore} onClick={loadMore}>
					{t("ui.ownerAudit.more")}
				</Button>
			)}
		</>
	);
}

function OwnerAuditRail({
	scope,
	selectedId,
	onSelect,
}: {
	scope: OwnerAuditScope;
	selectedId?: string;
	onSelect: (conversation: OwnerAuditConversation) => void;
}) {
	const query = useOwnerAuditConversations(scope);
	const conversations = [
		...new Map(
			query.data?.pages
				.flatMap((page) => page.conversations)
				.map((row) => [row.id, row]) ?? [],
		).values(),
	];
	return (
		<OwnerAuditRailView
			conversations={conversations}
			selectedId={selectedId}
			onSelect={onSelect}
			state={query.isPending ? "loading" : query.isError ? "error" : "ready"}
			retry={() => void query.refetch()}
			hasMore={query.hasNextPage}
			loadingMore={query.isFetchingNextPage}
			loadMore={() => void query.fetchNextPage()}
		/>
	);
}

function AuditMessage({
	message,
	agentAccountId,
	renderReplies,
}: {
	message: OwnerAuditMessage;
	agentAccountId: string;
	renderReplies?: (message: OwnerAuditMessage) => ReactNode;
}) {
	const locale = useI18nLocale();
	const delivery = ownerAuditDelivery(message, agentAccountId);
	const collapsed = delivery !== "admitted" && delivery !== "own";
	const copy = {
		admitted: "ui.ownerAudit.admitted",
		rejected: "ui.ownerAudit.rejected",
		not_screened: "ui.ownerAudit.not_screened",
		unknown: "ui.ownerAudit.unknown_status",
		own: "ui.ownerAudit.own",
	} as const;
	const created = new Date(message.created_at);
	// Never invoke markdown, previews, remote images, attachment loaders or any
	// agent action. Even admitted audit text stays on this human-only surface.
	const body = (
		<div className="space-y-2 pt-2">
			<p
				dir="auto"
				className="whitespace-pre-wrap break-words text-sm text-ink"
			>
				{message.body ?? t("ui.ownerAudit.body_unavailable")}
			</p>
			{(message.attachments?.length ?? message.attachment_count ?? 0) > 0 && (
				<ul className="text-xs text-ink-muted">
					{message.attachments?.length ? (
						message.attachments.map((attachment) => (
							<li key={attachment.id}>
								{attachment.state === "expired"
									? t("ui.ownerAudit.attachment_expired")
									: t("ui.ownerAudit.attachment_unavailable")}
							</li>
						))
					) : (
						<li>{t("ui.ownerAudit.attachment_unavailable")}</li>
					)}
				</ul>
			)}
		</div>
	);
	return (
		<article className="py-3">
			<header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-muted">
				<span className="font-medium text-ink">
					{message.sender.display_label || t("ui.ownerAudit.unknown_sender")}
				</span>
				{Number.isFinite(created.getTime()) && (
					<time dateTime={message.created_at}>
						{formatDateTime(
							created,
							{ dateStyle: "medium", timeStyle: "short" },
							locale,
						)}
					</time>
				)}
				<span>{t(copy[delivery])}</span>
			</header>
			{collapsed ? (
				<details className="mt-2">
					<summary className="cursor-pointer text-sm text-ink-muted">
						{t("ui.ownerAudit.reveal")}
					</summary>
					{body}
				</details>
			) : (
				body
			)}
			{renderReplies &&
				(message.reply_count ?? 0) > 0 &&
				renderReplies(message)}
		</article>
	);
}

export function OwnerAuditPanelView({
	conversation,
	messages,
	state,
	retry,
	hasMore = false,
	loadingMore = false,
	loadMore,
	renderReplies,
}: {
	conversation: OwnerAuditConversation;
	messages: OwnerAuditMessage[];
	state: ReadState;
	retry: () => void;
	hasMore?: boolean;
	loadingMore?: boolean;
	loadMore?: () => void;
	renderReplies?: (message: OwnerAuditMessage) => ReactNode;
}) {
	useI18nLocale();
	const membership =
		conversation.agent.state === "active"
			? "ui.ownerAudit.active"
			: conversation.agent.state === "left"
				? "ui.ownerAudit.left"
				: conversation.agent.state === "removed"
					? "ui.ownerAudit.removed"
					: "ui.ownerAudit.unknown_status";
	return (
		<section
			className="flex min-h-0 flex-1 flex-col"
			aria-label={t("ui.ownerAudit.title")}
		>
			<header className="shrink-0 space-y-2 px-5 py-4">
				<h2 className="text-base font-medium text-ink">
					{title(conversation)}
				</h2>
				<p className="text-sm text-ink-muted">{t("ui.ownerAudit.read_only")}</p>
				<p className="text-xs text-ink-muted">{t(membership)}</p>
				<p className="text-xs text-ink-muted">
					{t("ui.ownerAudit.disclosure")}
				</p>
				{conversation.viewers?.map((viewer, index) => (
					<p
						key={`${viewer.account_id}:${viewer.agent_member_key}:${index}`}
						className="text-xs text-ink-muted"
					>
						{t("ui.ownerAudit.viewer", {
							name: viewer.display_label || t("ui.ownerAudit.unknown_sender"),
						})}
					</p>
				))}
				<Button variant="ghost" onClick={retry}>
					{t("ui.ownerAudit.refresh")}
				</Button>
			</header>
			<div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
				{state === "loading" ? (
					<output className="text-sm text-ink-muted">
						{t("ui.ownerAudit.loading")}
					</output>
				) : state === "error" ? (
					<AuditFailure retry={retry} />
				) : (
					<>
						{hasMore && (
							<Button variant="ghost" onClick={loadMore} disabled={loadingMore}>
								{t("ui.ownerAudit.older")}
							</Button>
						)}
						{messages.length === 0 && (
							<p className="text-sm text-ink-muted">
								{t("ui.ownerAudit.empty_history")}
							</p>
						)}
						{messages.map((message) => (
							<AuditMessage
								key={message.id}
								message={message}
								agentAccountId={conversation.agent.account_id}
								renderReplies={renderReplies}
							/>
						))}
					</>
				)}
			</div>
		</section>
	);
}

function AuditReplies({
	scope,
	conversation,
	root,
}: {
	scope: OwnerAuditScope;
	conversation: OwnerAuditConversation;
	root: OwnerAuditMessage;
}) {
	const query = useOwnerAuditReplies(scope, conversation.id, root.id);
	if (query.isPending) return <output>{t("ui.ownerAudit.loading")}</output>;
	if (query.isError) return <AuditFailure retry={() => void query.refetch()} />;
	return (
		<div className="ps-5">
			{ownerAuditChronology(query.data.pages.map((page) => page.replies)).map(
				(message) => (
					<AuditMessage
						key={message.id}
						message={message}
						agentAccountId={conversation.agent.account_id}
					/>
				),
			)}
			{query.hasNextPage && (
				<Button
					variant="ghost"
					disabled={query.isFetchingNextPage}
					onClick={() => void query.fetchNextPage()}
				>
					{t("ui.ownerAudit.more")}
				</Button>
			)}
		</div>
	);
}

function ReplyDisclosure({
	scope,
	conversation,
	root,
}: {
	scope: OwnerAuditScope;
	conversation: OwnerAuditConversation;
	root: OwnerAuditMessage;
}) {
	const [open, setOpen] = useState(false);
	return (
		<details onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary className="cursor-pointer text-sm text-ink-muted">
				{t("ui.ownerAudit.replies")}
			</summary>
			{open && (
				<AuditReplies scope={scope} conversation={conversation} root={root} />
			)}
		</details>
	);
}

function OwnerAuditPanel({
	scope,
	conversation,
}: { scope: OwnerAuditScope; conversation: OwnerAuditConversation }) {
	const query = useOwnerAuditMessages(scope, conversation.id);
	return (
		<OwnerAuditPanelView
			conversation={conversation}
			messages={ownerAuditChronology(
				query.data?.pages.map((page) => page.messages) ?? [],
			)}
			state={query.isPending ? "loading" : query.isError ? "error" : "ready"}
			retry={() => void query.refetch()}
			hasMore={query.hasNextPage}
			loadingMore={query.isFetchingNextPage}
			loadMore={() => void query.fetchNextPage()}
			renderReplies={(message) => (
				<ReplyDisclosure
					scope={scope}
					conversation={conversation}
					root={message}
				/>
			)}
		/>
	);
}

export type OwnerAuditSlot = {
	active: boolean;
	clear: () => void;
	panel: ReactNode;
	rail: (beforeSelect: () => void) => ReactNode;
};

/** The selected audit row never enters TeamBridgeTarget or the member list.
 * Account remount + scope identity remove stale selection before a new tenant
 * can render. The caller clears human selection to suppress its read marker. */
export function useOwnerAuditSurface({
	accountId,
	enabled,
	scopeKey,
	organizations,
	onSelect,
}: {
	accountId?: string;
	enabled: boolean;
	scopeKey: string;
	organizations: { tenantId: string; name: string }[];
	onSelect: () => void;
}): OwnerAuditSlot | undefined {
	const [selection, setSelection] = useState<{
		scopeKey: string;
		conversation: OwnerAuditConversation;
	} | null>(null);
	const selected =
		selection?.scopeKey === scopeKey &&
		organizations.some(
			(org) => org.tenantId === selection.conversation.tenant_id,
		)
			? selection.conversation
			: null;
	if (!enabled || !accountId) return undefined;
	return {
		active: selected !== null,
		clear: () => setSelection(null),
		panel: selected && (
			<OwnerAuditPanel
				key={`${accountId}:${selected.tenant_id}:${selected.id}`}
				scope={{ accountId, tenantId: selected.tenant_id }}
				conversation={selected}
			/>
		),
		rail: (beforeSelect) => (
			<section className="mt-4" aria-label={t("ui.ownerAudit.title")}>
				<h2 className="px-3 py-2 text-xs font-medium text-ink-muted">
					{t("ui.ownerAudit.title")}
				</h2>
				<p className="px-3 pb-2 text-xs text-ink-muted">
					{t("ui.ownerAudit.read_only")}
				</p>
				{organizations.map((organization) => (
					<div key={`${accountId}:${organization.tenantId}`}>
						{organizations.length > 1 && (
							<h3 className="px-3 py-1 text-xs text-ink-muted">
								{organization.name}
							</h3>
						)}
						<OwnerAuditRail
							scope={{ accountId, tenantId: organization.tenantId }}
							selectedId={
								selected?.tenant_id === organization.tenantId
									? selected.id
									: undefined
							}
							onSelect={(conversation) => {
								beforeSelect();
								onSelect();
								setSelection({ scopeKey, conversation });
							}}
						/>
					</div>
				))}
			</section>
		),
	};
}
