import type { OwnerAuditScope } from "@shared/api/local-operator/team-bridge-owner-audit-api";
import { Badge } from "@shared/components/ui/badge";
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

/**
 * A FAILED LATER PAGE MUST NOT ERASE WHAT IS ALREADY SHOWN.
 *
 * `fetchNextPage` (and a background refetch) that rejects puts the whole query
 * into `status: "error"` even though its earlier pages are still in `data`, so
 * deriving the view from `isError` alone replaced a loaded transcript — or the
 * whole rail — with the failure block when "Load older messages" hit a 503
 * (agent review round 1, M1: reproduced against these components). `data` is
 * the fact that a read succeeded; the error state belongs to the reader that
 * has nothing to show. A failed later page keeps the rows and offers the retry
 * that failed-page affordance already carries.
 */
function readState(query: {
	isPending: boolean;
	isError: boolean;
	data: unknown;
}): ReadState {
	if (query.isPending) return "loading";
	if (query.isError && !query.data) return "error";
	return "ready";
}
const title = (conversation: OwnerAuditConversation) =>
	ownerAuditTitle(conversation, t("ui.ownerAudit.unnamed"));

/**
 * A refusal is NOT an empty list, and it must not LOOK like one either.
 *
 * The words already differed; the treatment did not, so an empty section and a
 * failed one were the same grey paragraph (design review round 1, D6). The
 * failure now wears the semantic danger ink the contrast contract verifies, sits
 * on its section's own inset instead of outdenting itself, and is the ONLY retry
 * in its scope — the panel header drops its Refresh while this is what the
 * reader is looking at, so one refetch does not appear twice (D7).
 */
function AuditFailure({ retry }: { retry: () => void }) {
	return (
		<div role="alert" className="space-y-2 px-3 text-sm text-danger">
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
			state={readState(query)}
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
	/*
	 * THE VERDICT NEEDS ITS OWN CHANNEL. It used to be a third grey field beside
	 * the sender and the timestamp — same size, same ink, no mark — so the one
	 * question this surface exists to answer ("what did my chief of staff let
	 * through?") could not be answered by scanning, and the two outcomes that
	 * matter most looked identical at rest (design review round 1, D1: measured
	 * 12px/400 with no fill, no edge, no icon).
	 *
	 * These are the shipped `Badge` variants and their contrast-audited
	 * wash/ink pairs, so the mark carries meaning in every palette without a
	 * new token: admitted is quiet-positive, rejected is the refusal, not
	 * screened is informational, and the agent's own message and an unknown
	 * verdict stay neutral rather than borrowing a judgement they do not have.
	 */
	const badge = {
		admitted: "success",
		rejected: "danger",
		not_screened: "info",
		unknown: "neutral",
		own: "neutral",
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
				<Badge variant={badge[delivery]}>{t(copy[delivery])}</Badge>
			</header>
			{collapsed && !message.body ? (
				/*
				 * A DISCLOSURE MUST NOT PROMISE TEXT IT DOES NOT HAVE. Offering "Show
				 * message text" on a row whose body the hub never sent lured a click and
				 * returned "Message text unavailable.", so the two cases were
				 * indistinguishable before the press (design review round 1, D5). With no
				 * body there is nothing to collapse: say the absence.
				 */
				<p className="mt-2 text-sm text-ink-muted">
					{t("ui.ownerAudit.body_unavailable")}
				</p>
			) : collapsed ? (
				<details className="mt-2">
					{/* The target is the LABEL and its own box, not the full row width: a
					 * click far to the right of the words used to open a message (design
					 * review round 1, D9). 24px of vertical room clears the WCAG 2.5.8
					 * floor that the browser's 20px marker missed. */}
					<summary className="inline-flex min-h-[24px] w-fit cursor-pointer items-center text-sm text-ink-muted">
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

/**
 * THE AUDIT WINDOW'S END, where a reader checks whether there is more.
 *
 * A TRUNCATED HISTORY THAT READS AS A COMPLETE ONE is the failure this surface
 * exists to prevent, and it was the shape of design review round 1, D3: the
 * membership sentence was the third of four identical 12px `ink-muted` lines in
 * the header, the same size and grey as the standing disclosure, so the one line
 * saying "this list is incomplete" was indistinguishable from boilerplate. It
 * closes the message list now, at the point where a reader looks for the next
 * message and finds none, and the cut-off cases carry a `hairline` rule and the
 * reading ink (`text-sm text-ink`) so they cannot be skimmed as metadata. The
 * open-window case stays quiet (`text-meta text-ink-dim`): there is nothing cut
 * off to notice, and a complete history needs no alarm.
 *
 * The unknown case takes the CUT-OFF treatment, not the quiet one: the hub's
 * vocabulary is additive, so an unrecognised membership state means this client
 * cannot say whether the list ends where the conversation does, and the safe
 * error is to look uncertain rather than complete.
 */
function OwnerAuditWindowEnd({
	conversation,
}: { conversation: OwnerAuditConversation }) {
	useI18nLocale();
	const membership = conversation.agent.state;
	if (membership === "active") {
		return (
			<p className="mt-4 text-meta text-ink-dim">{t("ui.ownerAudit.active")}</p>
		);
	}
	return (
		<p className="mt-4 border-hairline border-t pt-3 text-ink text-sm">
			{membership === "left"
				? t("ui.ownerAudit.left")
				: membership === "removed"
					? t("ui.ownerAudit.removed")
					: t("ui.ownerAudit.window_unconfirmed")}
		</p>
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
	readerAccountId,
}: {
	conversation: OwnerAuditConversation;
	messages: OwnerAuditMessage[];
	state: ReadState;
	retry: () => void;
	hasMore?: boolean;
	loadingMore?: boolean;
	loadMore?: () => void;
	renderReplies?: (message: OwnerAuditMessage) => ReactNode;
	/**
	 * The signed-in account reading this panel, so the viewer list can name OTHER
	 * agent owners without listing the reader as an additional reader of their own
	 * audit (design review round 1, D2). Required rather than optional: with no
	 * reader the list is unanswerable, and an optional prop would let the
	 * contradiction back in silently at the next call site.
	 */
	readerAccountId: string;
}) {
	useI18nLocale();
	/*
	 * WHO ELSE CAN READ THIS. `viewers` is the server's own answer, one entry per
	 * agent owner whose agent is (or was) in the conversation. It includes the
	 * caller, so rendering it verbatim listed the reader as a second reader:
	 * "Visible only to you" followed by "Also visible to Damian Tran" (design
	 * review round 1, D2). The reader is filtered out; the label above the names
	 * carries no placeholder, so no locale has to inflect a person's name.
	 */
	const otherViewers = (conversation.viewers ?? []).filter(
		(viewer) => viewer.account_id !== readerAccountId,
	);
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
				<p className="text-xs text-ink-muted">
					{t("ui.ownerAudit.disclosure")}
				</p>
				{otherViewers.length > 0 && (
					<div className="text-xs text-ink-muted">
						<p>{t("ui.ownerAudit.viewers_label")}</p>
						<ul>
							{otherViewers.map((viewer, index) => (
								<li
									key={`${viewer.account_id}:${viewer.agent_member_key}:${index}`}
								>
									{viewer.display_label || t("ui.ownerAudit.unknown_sender")}
								</li>
							))}
						</ul>
					</div>
				)}
				{/* One retry per scope: while the body shows AuditFailure, the header's
				 * Refresh would be a second control for the same refetch. */}
				{state !== "error" && (
					<Button variant="ghost" onClick={retry}>
						{t("ui.ownerAudit.refresh")}
					</Button>
				)}
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
							<div className="pb-2">
								<p className="text-meta text-ink-dim">
									{t("ui.ownerAudit.page_cutoff")}
								</p>
								<Button
									variant="ghost"
									onClick={loadMore}
									disabled={loadingMore}
								>
									{t("ui.ownerAudit.older")}
								</Button>
							</div>
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
						<OwnerAuditWindowEnd conversation={conversation} />
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
	if (readState(query) === "error")
		return <AuditFailure retry={() => void query.refetch()} />;
	return (
		<div className="ps-5">
			{ownerAuditChronology(
				query.data?.pages.map((page) => page.replies) ?? [],
			).map((message) => (
				<AuditMessage
					key={message.id}
					message={message}
					agentAccountId={conversation.agent.account_id}
				/>
			))}
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
			state={readState(query)}
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
			readerAccountId={scope.accountId}
		/>
	);
}

/**
 * The section's own header: what this list IS, in the rail.
 *
 * Extracted so the slot and the Storybook story render the SAME chrome. The
 * story used to compose its own heading, which meant the frames showed a
 * heading the app does not ship — invisible to every other check, and exactly
 * the kind of drift a design review catches in one glance.
 */
export function OwnerAuditSectionHeader() {
	useI18nLocale();
	return (
		<>
			<h2 className="px-3 py-2 font-medium text-meta text-ink-dim tracking-wide">
				{t("ui.ownerAudit.title")}
			</h2>
			<p className="px-3 pb-2 text-meta text-ink-dim">
				{t("ui.ownerAudit.read_only")}
			</p>
		</>
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
				<OwnerAuditSectionHeader />
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
