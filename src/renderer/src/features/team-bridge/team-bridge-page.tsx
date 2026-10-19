import { Spinner } from "@shared/components/common/spinner";
import { Badge, countLabel } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { ScrollArea } from "@shared/components/ui/scroll-area";
import { t } from "@shared/i18n";
import { formatRelativeTime } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { AtSign, Bot, Hash, Plus, Send, Users } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeCreateDialog } from "./team-bridge-create-dialog";
import {
	chronological,
	conversationGlyph,
	conversationTitle,
	orderedMembers,
} from "./team-bridge-model";
import {
	useCreateTeamBridgeConversation,
	useMarkTeamBridgeRead,
	useSendTeamBridgeMessage,
	useTeamBridgeConversations,
	useTeamBridgeIdentity,
	useTeamBridgeMessages,
} from "./use-team-bridge";

/**
 * The Team Bridge page: conversation list, thread and composer.
 *
 * WHY A PAGE AND NOT A DIALOG. The settings section explains a capability; a
 * conversation is a place a person returns to, reads a history in and types in.
 * A dialog would put the inbox in front of the work and close on the first
 * outside click, which is the opposite of what a messaging surface is for.
 *
 * LAYOUT. One 288px list column and a flexible thread, matching the app's own
 * docked-sidebar geometry (30px rows, 13px labels) rather than importing a
 * second set of metrics. Every surface colour is a token role (`bg-surface`,
 * `border-hairline`, `text-ink-muted`, `bg-row-hover`) so light, dark and every
 * palette resolve without a per-theme branch, and the page root opts into the
 * desktop's glass regions (`data-glass-region="canvas"`) so a glass setting is
 * not defeated by an opaque layer.
 *
 * THE VIEW IS PURE. `TeamBridgePageView` takes its state as props; the
 * container below is the only place that knows about queries. That split is
 * what lets the stories render loading, empty, error and populated states
 * without a backend, and it keeps the visual review honest.
 */

const ConversationRow: FC<{
	conversation: TeamBridgeConversation;
	selected: boolean;
	selfAccountId?: string;
	onSelect: () => void;
}> = ({ conversation, selected, selfAccountId, onSelect }) => {
	const locale = useI18nLocale();
	const glyph = conversationGlyph(conversation);
	const Icon = glyph === "hash" ? Hash : glyph === "users" ? Users : AtSign;
	const title =
		conversationTitle(conversation, selfAccountId) ??
		t("ui.teamBridge.list.untitled");
	const unread = conversation.unread_count;
	const lastMessage = conversation.last_message_at
		? relative(conversation.last_message_at, locale)
		: "";

	return (
		<li>
			<button
				type="button"
				onClick={onSelect}
				aria-current={selected ? "page" : undefined}
				data-conversation-id={conversation.id}
				className={cn(
					"flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left",
					"transition-colors duration-fast ease-out-quart",
					selected
						? "bg-row-selected text-ink"
						: "text-ink-muted hover:bg-row-hover hover:text-ink",
				)}
			>
				<Icon size={16} aria-hidden="true" className="shrink-0" />
				<span className="min-w-0 flex-1 truncate text-[13px]">{title}</span>
				{lastMessage && (
					<span className="shrink-0 text-meta-sm text-ink-dim">
						{lastMessage}
					</span>
				)}
				{unread > 0 && (
					<span className="ml-1 inline-flex shrink-0">
						<Badge
							variant="attentionQuiet"
							shape="pill"
							size="count"
							aria-label={t("ui.teamBridge.unread.count", {
								count: unread,
							})}
						>
							{countLabel(unread, 99)}
						</Badge>
					</span>
				)}
			</button>
		</li>
	);
};

function relative(iso: string, locale: string): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	const minutes = Math.round((then - Date.now()) / 60_000);
	if (Math.abs(minutes) < 60) {
		return formatRelativeTime(minutes, "minute", { numeric: "auto" }, locale);
	}
	const hours = Math.round(minutes / 60);
	if (Math.abs(hours) < 24) {
		return formatRelativeTime(hours, "hour", { numeric: "auto" }, locale);
	}
	return formatRelativeTime(
		Math.round(hours / 24),
		"day",
		{ numeric: "auto" },
		locale,
	);
}

const MessageRow: FC<{
	message: TeamBridgeMessage;
	selfAccountId?: string;
}> = ({ message, selfAccountId }) => {
	const own = message.sender.account_id === selfAccountId;
	const agent = message.sender.kind === "agent";
	const time = new Date(message.created_at);
	return (
		<li className={cn("flex gap-2 px-1", own && "flex-row-reverse text-right")}>
			<span
				className={cn(
					"mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
					agent ? "bg-accent-wash text-accent" : "bg-sunken text-ink-muted",
				)}
				aria-hidden="true"
			>
				{agent ? <Bot size={14} /> : (message.sender.display_label[0] ?? "?")}
			</span>
			<div className={cn("min-w-0 max-w-[min(72ch,80%)]", own && "items-end")}>
				<div
					className={cn(
						"flex items-baseline gap-2 text-[12px] text-ink-dim",
						own && "justify-end",
					)}
				>
					<span className="truncate font-medium text-ink-muted">
						{message.sender.display_label}
					</span>
					{agent && (
						<Badge variant="accent" shape="pill" size="count">
							{t("ui.teamBridge.member.agent")}
						</Badge>
					)}
					<time dateTime={message.created_at}>
						{Number.isNaN(time.getTime())
							? ""
							: time.toLocaleTimeString(undefined, {
									hour: "2-digit",
									minute: "2-digit",
								})}
					</time>
				</div>
				<p
					className={cn(
						"mt-0.5 whitespace-pre-wrap break-words rounded-md text-[13px] leading-relaxed",
						// Own messages get the accent wash — the app's "yours" tint, soft
						// enough not to shout beside an agent's plain text but distinct in
						// every palette. Other people's messages are plain text on the
						// thread ground, which is what keeps a busy channel from turning
						// into a column of boxes.
						own ? "bg-accent-wash px-2.5 py-1.5 text-ink" : "text-ink",
					)}
				>
					{/* A null body is an agent member's unadmitted message: say so
					    rather than rendering an empty bubble. */}
					{message.body ?? (
						<span className="text-ink-dim italic">
							{t("ui.teamBridge.thread.withheld")}
						</span>
					)}
				</p>
			</div>
		</li>
	);
};

export type TeamBridgePageViewProps = {
	listState: "loading" | "error" | "ready";
	messageState: "idle" | "loading" | "error" | "ready";
	conversations: TeamBridgeConversation[];
	selected: TeamBridgeConversation | null;
	messages: TeamBridgeMessage[];
	selfAccountId?: string;
	sending?: boolean;
	sendFailed?: boolean;
	/** Story/test seed only: the page's real draft is user-owned state. */
	initialDraft?: string;
	onSelect: (conversationId: string) => void;
	onSend: (body: string, clientRef: string) => Promise<unknown> | undefined;
	onNewConversation: () => void;
	onRetry?: () => void;
};

export const TeamBridgePageView: FC<TeamBridgePageViewProps> = ({
	listState,
	messageState,
	conversations,
	selected,
	messages,
	selfAccountId,
	sending = false,
	sendFailed = false,
	initialDraft = "",
	onSelect,
	onSend,
	onNewConversation,
	onRetry,
}) => {
	useI18nLocale();
	const [draft, setDraft] = useState(initialDraft);
	const threadEnd = useRef<HTMLDivElement>(null);
	const ordered = useMemo(() => chronological(messages), [messages]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the conversation or message count changes; `ordered` is a fresh array each render and must not retrigger a scroll on every keystroke.
	useEffect(() => {
		threadEnd.current?.scrollIntoView({ block: "end" });
	}, [selected?.id, ordered.length]);

	// The retry's idempotency key: a failed send is retried with the SAME
	// `client_ref`, so an ambiguous failure (request landed, answer lost) cannot
	// post the message twice. A genuinely different draft gets a fresh key.
	const pendingSend = useRef<{ body: string; clientRef: string } | null>(null);
	const submit = () => {
		const body = draft.trim();
		if (!body || sending) return;
		const clientRef =
			pendingSend.current?.body === body
				? pendingSend.current.clientRef
				: crypto.randomUUID();
		const entry = { body, clientRef };
		pendingSend.current = entry;
		// Keep the draft until the send resolves: a refused send must not erase
		// what the person wrote. Clear only if the field still holds what was
		// sent — text typed while it was in flight is not the send's to discard.
		const result = onSend(body, clientRef);
		const settle = () => {
			// Only the entry this send created may be cleared: a second send in
			// another conversation settling late must not drop the first one's key.
			if (pendingSend.current === entry) pendingSend.current = null;
			setDraft((current) => (current.trim() === body ? "" : current));
		};
		if (result instanceof Promise) {
			void result.then(settle).catch(() => {});
		} else {
			settle();
		}
	};

	return (
		<div
			data-glass-region="canvas"
			className="flex h-full min-h-0 w-full overflow-hidden"
		>
			<aside
				data-glass-region="page-sidebar"
				/* BORDERLESS CHROME: the column is separated by its own ground, not a
				   rule. A full-height border beside a 30px-row list reads as a hard
				   frame; the sunken tint does the same job and survives glass, where a
				   solid line is the one thing a translucent surface cannot hide. */
				className="flex w-72 shrink-0 flex-col"
			>
				<header className="flex h-11 shrink-0 items-center gap-2 px-3">
					<h1 className="min-w-0 flex-1 truncate font-medium text-[13px] text-ink">
						{t("ui.teamBridge.page.title")}
					</h1>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label={t("ui.teamBridge.page.new_conversation")}
						onClick={onNewConversation}
					>
						<Plus size={16} />
					</Button>
				</header>
				<ScrollArea className="min-h-0 flex-1">
					{listState === "loading" && (
						<div className="flex items-center justify-center py-8">
							<Spinner size="sm" label={t("ui.teamBridge.list.loading")} />
						</div>
					)}
					{listState === "error" && (
						<div className="flex flex-col items-start gap-2 px-3 py-6">
							<p className="text-[13px] text-ink-muted">
								{t("ui.teamBridge.list.error")}
							</p>
							{onRetry && (
								<Button size="sm" variant="outline" onClick={onRetry}>
									{t("ui.teamBridge.list.retry")}
								</Button>
							)}
						</div>
					)}
					{/* The empty state is ONE statement, in the pane. A second copy in the
					    column would say the same thing twice in the same viewport. */}
					{listState === "ready" && conversations.length > 0 && (
						<ul className="flex flex-col gap-0.5 px-1 pb-2">
							{conversations.map((conversation) => (
								<ConversationRow
									key={conversation.id}
									conversation={conversation}
									selected={selected?.id === conversation.id}
									selfAccountId={selfAccountId}
									onSelect={() => onSelect(conversation.id)}
								/>
							))}
						</ul>
					)}
				</ScrollArea>
			</aside>

			{/* The ONE ground split: the rail inherits the page canvas, the thread
			    carries the surface. In every palette `surface` sits off `canvas`, so the
			    two regons read apart in light and dark without a single rule between
			    them — which is also what survives the glass settings, where a hard
			    line is the one thing a translucent ground cannot hide. */}
			<section className="flex min-w-0 flex-1 flex-col bg-surface">
				{selected === null ? (
					listState === "ready" ? (
						<div className="flex flex-1 items-center justify-center px-6">
							<div className="max-w-sm text-center">
								<p className="font-medium text-[13px] text-ink">
									{t("ui.teamBridge.list.empty.title")}
								</p>
								<p className="mt-1 text-[13px] text-ink-muted">
									{t("ui.teamBridge.list.empty.body")}
								</p>
								<Button
									size="sm"
									variant="primary"
									className="mt-3"
									onClick={onNewConversation}
								>
									<Plus size={14} />
									{t("ui.teamBridge.page.new_conversation")}
								</Button>
							</div>
						</div>
					) : null
				) : (
					<>
						{/* No rule under the header: the thread's own ground already
						    separates it, and Slack's chrome carries no line here either. */}
						<header className="flex h-11 shrink-0 items-center gap-2 px-3">
							<h2 className="min-w-0 truncate font-medium text-[13px] text-ink">
								{conversationTitle(selected, selfAccountId) ??
									t("ui.teamBridge.list.untitled")}
							</h2>
							<span className="shrink-0 text-meta-sm text-ink-dim">
								{t("ui.teamBridge.member.count", {
									count: orderedMembers(selected).filter(
										(member) => member.state === "active",
									).length,
								})}
							</span>
							<div className="ml-auto flex items-center gap-1">
								{orderedMembers(selected)
									.slice(0, 6)
									.map((member) => (
										<span
											key={`${member.kind}:${member.account_id}`}
											className={cn(
												"flex size-5 items-center justify-center rounded-full text-[10px]",
												member.kind === "agent"
													? "bg-accent-wash text-accent"
													: "bg-sunken text-ink-muted",
											)}
											title={
												member.state === "invited"
													? `${member.display_label} — ${t("ui.teamBridge.member.invited")}`
													: member.display_label
											}
										>
											{member.kind === "agent" ? (
												<Bot size={12} aria-hidden="true" />
											) : (
												(member.display_label[0] ?? "?")
											)}
										</span>
									))}
							</div>
						</header>

						{/* Radix wraps children in an auto-height table cell; these
						    arbitrary variants make that wrapper fill the viewport so the
						    list can justify-end (Slack anchors a short history at the
						    bottom, next to the composer). */}
						<ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:block [&_[data-radix-scroll-area-viewport]>div]:h-full">
							<div className="flex h-full flex-col">
								{messageState === "loading" && (
									<div className="flex items-center justify-center py-10">
										<Spinner
											size="sm"
											label={t("ui.teamBridge.thread.loading")}
										/>
									</div>
								)}
								{messageState === "error" && (
									<p className="px-4 py-8 text-[13px] text-ink-muted">
										{t("ui.teamBridge.thread.error")}
									</p>
								)}
								{messageState === "ready" && ordered.length === 0 && (
									<p className="px-4 py-10 text-center text-[13px] text-ink-muted">
										{t("ui.teamBridge.thread.empty")}
									</p>
								)}
								{messageState === "ready" && ordered.length > 0 && (
									/* SLACK'S ANCHOR: a short history sits at the BOTTOM of the
								   pane and grows upward, so the newest message is always next to
								   the composer. `min-h-full justify-end` does that inside the
								   scroll area and collapses to plain flow once the list is
								   taller than the pane. */
									<ul className="mt-auto flex flex-col gap-3 px-4 py-4">
										{ordered.map((message) => (
											<MessageRow
												key={message.id}
												message={message}
												selfAccountId={selfAccountId}
											/>
										))}
										<div ref={threadEnd} />
									</ul>
								)}
							</div>
						</ScrollArea>

						{/* THE AGENT COMPOSER'S SHAPE (operator review, 2026-10-18): one
						    borderless box on `elevated`, the field and the tools inside it,
						    and Send in the bottom-right corner of the box rather than a
						    button floating beside a bordered field. The box uses the same
						    focus contract as `shared/components/composer/message-input.tsx`
						    — the ring is promoted from the textarea to the box via `:has`,
						    so previews and tools read as one control and there is no second
						    ring inside. Radius is 12 rather than the agent composer's 16:
						    this box is shorter, so 16 read as a pill at rest. The ground
						    (`elevated` over `surface`) does the separating, never an edge. */}
						<div className="shrink-0 px-3 pb-3">
							{sendFailed && (
								<p role="alert" className="px-2 pb-1 text-[12px] text-danger">
									{t("ui.teamBridge.composer.error")}
								</p>
							)}
							<div
								className={cn(
									"rounded-xl bg-elevated",
									"transition-colors duration-fast ease-out-quart",
									"has-[textarea:focus-visible]:outline-solid has-[textarea:focus-visible]:outline-2",
									"has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2",
								)}
							>
								<textarea
									value={draft}
									onChange={(event) => setDraft(event.target.value)}
									onKeyDown={(event) => {
										// An IME candidate confirmation is Enter too; sending on it
										// would post the half-composed text.
										if (
											event.key === "Enter" &&
											!event.shiftKey &&
											!event.nativeEvent.isComposing
										) {
											event.preventDefault();
											submit();
										}
									}}
									rows={1}
									placeholder={t("ui.teamBridge.composer.placeholder")}
									aria-label={t("ui.teamBridge.composer.placeholder")}
									className={cn(
										"block max-h-40 min-h-9 w-full resize-none bg-transparent px-3 pt-2.5 pb-1",
										"text-[13px] text-ink placeholder:text-ink-dim",
										"outline-none",
									)}
								/>
								<div className="flex items-center gap-2 px-2 pb-2">
									{/* The hint takes the tools' slot until the bridge has a tool
									    worth putting here (no attachment route exists yet, and a
									    disabled paperclip would be fake chrome). */}
									<span className="min-w-0 flex-1 truncate pl-1 text-meta-sm text-ink-dim">
										{t("ui.teamBridge.composer.hint")}
									</span>
									<Button
										size="icon-sm"
										variant="primary"
										className="rounded-full"
										disabled={!draft.trim() || sending}
										aria-label={t("ui.teamBridge.composer.send")}
										onClick={submit}
									>
										<Send size={16} />
									</Button>
								</div>
							</div>
						</div>
					</>
				)}
			</section>
		</div>
	);
};

/**
 * The container. It owns the queries, the selected conversation and the
 * read-cursor write; the view above owns nothing but what it is given.
 *
 * Reading a thread marks it read at the newest seq the reader has actually
 * been shown: the page is visible, the messages are in the DOM, and leaving the
 * cursor behind would make the badge keep counting a conversation the user is
 * looking at. The write is idempotent on the server (`$max`), so a focus
 * re-render cannot move the cursor backwards.
 */
export const TeamBridgePage: FC<{ selfAccountId?: string }> = () => {
	const list = useTeamBridgeConversations();
	// The page mounted from the route has no prop caller; identity comes from
	// the bridge status read, which is the one place the hub account is published.
	const identity = useTeamBridgeIdentity();
	const selfAccountId = identity.data ?? undefined;
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const conversations = list.data?.conversations ?? [];

	// Land on the first conversation once, not on every refetch: a poll must not
	// move the reader out of the thread they are reading.
	useEffect(() => {
		if (selectedId === null && conversations.length > 0) {
			setSelectedId(conversations[0].id);
		}
	}, [conversations, selectedId]);

	const selected =
		conversations.find((conversation) => conversation.id === selectedId) ??
		null;
	const messages = useTeamBridgeMessages(selected?.id ?? null);
	const send = useSendTeamBridgeMessage(selected?.id ?? "");
	const create = useCreateTeamBridgeConversation();
	const markRead = useMarkTeamBridgeRead(selected?.id ?? "");

	// Mark read at the newest seq actually rendered. A visible page has shown
	// these messages; leaving the cursor behind would keep the badge counting a
	// conversation the reader is looking at. The server applies `$max`, so this
	// is safe to repeat on a refetch.
	// A refusal belongs to the conversation it happened in; selecting another
	// conversation must not leave the line on screen.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the selection changes.
	useEffect(() => {
		send.reset();
	}, [selected?.id]);

	const newest = messages.data?.messages.reduce<number | undefined>(
		(max, message) =>
			max === undefined || message.seq > max ? message.seq : max,
		undefined,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: advance the cursor only when the conversation or its newest seq changes; including the mutation object or the whole conversation would re-fire on every render.
	useEffect(() => {
		if (selected === null || newest === undefined) return;
		if (newest <= selected.last_read_seq) return;
		markRead.mutate({ seq: newest });
	}, [selected?.id, newest]);

	return (
		<>
			<TeamBridgePageView
				listState={
					list.isPending ? "loading" : list.isError ? "error" : "ready"
				}
				messageState={
					selected === null
						? "idle"
						: messages.isPending
							? "loading"
							: messages.isError
								? "error"
								: "ready"
				}
				conversations={conversations}
				selected={selected}
				messages={messages.data?.messages ?? []}
				selfAccountId={selfAccountId}
				sending={send.isPending}
				sendFailed={send.isError}
				onSelect={setSelectedId}
				onSend={(body, clientRef) => {
					if (selected === null) return;
					return send.mutateAsync({ clientRef, body });
				}}
				onNewConversation={() => setCreateOpen(true)}
				onRetry={() => {
					void list.refetch();
				}}
			/>
			<TeamBridgeCreateDialog
				open={createOpen}
				pending={create.isPending}
				error={create.isError ? t("ui.teamBridge.create.error") : undefined}
				onClose={() => setCreateOpen(false)}
				onCreate={(input) => {
					create.mutate(input, {
						onSuccess: (created) => {
							setCreateOpen(false);
							const conversation = created as { id?: string };
							if (conversation.id) setSelectedId(conversation.id);
						},
					});
				}}
			/>
		</>
	);
};
