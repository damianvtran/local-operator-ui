import { Button } from "@shared/components/ui/button";
import { formatDate, formatTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot, MessageSquare } from "lucide-react";
import type { FC } from "react";
import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";
import { TeamBridgeMessageAttachments } from "./team-bridge-attachments";
import { TeamBridgeMarkdown } from "./team-bridge-markdown";
import { type ThreadItem, threadItems } from "./team-bridge-model";
import { threadSummary } from "./team-bridge-threads-model";

/**
 * The thread, drawn the way Slack and Discord draw a channel, not a messenger.
 *
 * WHY NO BUBBLES (operator review, 2026-10-21). A bubble per message turns a
 * busy channel into a column of boxes and halves the width a long agent
 * write-up can use: the operator's reference is Slack's list, where each
 * message is an avatar, a name, a time, and the body below it at the full
 * width of the pane. Own messages are NOT right-aligned or tinted either; in
 * a group conversation "who said it" is the name, and alignment only works for
 * two people.
 *
 * RUNS. Consecutive messages from the same sender within five minutes collapse
 * into one header (Slack's continuation rows): the avatar and name are drawn
 * once, and a continuation shows its clock time in the gutter on hover only.
 * A day divider starts each calendar day. Both decisions live in
 * `threadItems` (the model) so they are tested without a DOM.
 *
 * THE BODY IS MARKDOWN. Agents post structured write-ups (headings, lists,
 * code, links) and the operator's QA-coordination traffic is exactly that, so
 * the body goes through the app's one sanctioned prose renderer
 * (`TeamBridgeMarkdown`: GFM, external links open in the browser, images as text, nothing else
 * is a link). That renderer emits no raw HTML, so a hostile body cannot inject
 * markup.
 *
 * NAMES ARE THE CALLER'S. `labelFor` maps a sender onto the name the rail
 * shows for them (the directory's current name for a person, "Aida (Ben)" for
 * a chief of staff), so a message and the People row agree, and a stale stored
 * label never reaches the screen when a better one is known.
 */
export const TeamBridgeMessageList: FC<{
	messages: readonly TeamBridgeMessage[];
	labelFor: (sender: TeamBridgeMessage["sender"]) => string;
	onReply?: (message: TeamBridgeMessage) => void;
	/*
	 * The organization the messages belong to: an image fetch is member-gated
	 * per tenant on the hub, so the tenant travels with the request. Omitted by
	 * callers with no images to fetch (and then images render as unavailable
	 * rather than guessing a tenant).
	 */
	tenantId?: string;
	/* `compact`: the thread pane's narrow column (see `boxFor`). */
	density?: "regular" | "compact";
}> = ({ messages, labelFor, onReply, tenantId, density }) => {
	const locale = useI18nLocale();
	const items = threadItems(messages, new Date());
	return (
		<ol className="mt-auto flex flex-col pt-4 pb-2">
			{items.map((item) =>
				item.type === "day" ? (
					<DayDivider key={`day:${item.key}`} item={item} locale={locale} />
				) : (
					<MessageRow
						key={item.message.id}
						message={item.message}
						continuation={item.continuation}
						label={labelFor(item.message.sender)}
						locale={locale}
						onReply={onReply}
						tenantId={tenantId}
						density={density}
					/>
				),
			)}
		</ol>
	);
};

/*
 * A full-width hairline-free divider: the label sits in the middle of a
 * divider drawn as background value (`bg-hairline` at 1px is a ground, not a
 * border on a panel), matching Slack's centred day pill without its outline.
 */
const DayDivider: FC<{
	item: Extract<ThreadItem, { type: "day" }>;
	locale: string;
}> = ({ item, locale }) => {
	const label =
		item.relative === "today"
			? t("ui.teamBridge.thread.today")
			: item.relative === "yesterday"
				? t("ui.teamBridge.thread.yesterday")
				: formatDate(
						item.date,
						{ weekday: "long", month: "long", day: "numeric" },
						locale,
					);
	return (
		<li className="flex items-center gap-3 px-5 py-2" aria-label={label}>
			<span aria-hidden="true" className="h-px flex-1 bg-hairline" />
			<span className="shrink-0 rounded-full bg-elevated px-2.5 py-0.5 font-medium text-[12px] text-ink-muted">
				{label}
			</span>
			<span aria-hidden="true" className="h-px flex-1 bg-hairline" />
		</li>
	);
};

const MessageRow: FC<{
	message: TeamBridgeMessage;
	continuation: boolean;
	label: string;
	locale: string;
	onReply?: (message: TeamBridgeMessage) => void;
	tenantId?: string;
	density?: "regular" | "compact";
}> = ({ message, continuation, label, locale, onReply, tenantId, density }) => {
	const summary = threadSummary(message);
	const agent = message.sender.kind === "agent";
	const at = new Date(message.created_at);
	const valid = !Number.isNaN(at.getTime());
	const clock = valid
		? formatTime(at, { hour: "numeric", minute: "2-digit" }, locale)
		: "";
	const full = valid
		? formatDate(at, { dateStyle: "full", timeStyle: "short" }, locale)
		: "";
	return (
		<li
			data-message-id={message.id}
			className={cn(
				"group/message relative flex gap-3 px-5 transition-colors duration-fast ease-out-quart hover:bg-row-hover",
				continuation ? "py-0.5" : "mt-2 pt-1.5 pb-0.5",
			)}
		>
			{/* The 36px gutter holds the avatar on a run's first message and the
			    hover clock on its continuations, so bodies share one left edge. */}
			<div className="w-9 shrink-0">
				{continuation ? (
					valid && (
						<time
							dateTime={message.created_at}
							title={full}
							className="block pt-0.5 text-right text-[11px] text-ink-dim opacity-0 group-hover/message:opacity-100"
						>
							{clock}
						</time>
					)
				) : (
					<span
						aria-hidden="true"
						className={cn(
							// A rounded SQUARE, as the operator's reference draws it:
							// Slack's people are squares, and a circle here would read as
							// the app's own account avatar.
							"mt-0.5 flex size-9 items-center justify-center rounded-md font-medium text-[14px]",
							/* `border-control` because the row's hover is a row state:
							   `sunken` sits on the hover's own rung on some palettes, and
							   the plate would vanish into the row (selection guard). */
							agent
								? "border border-control bg-accent-wash text-accent"
								: "border border-control bg-sunken text-ink-muted",
						)}
					>
						{agent ? (
							<Bot size={18} />
						) : (
							label.trim().charAt(0).toUpperCase() || "?"
						)}
					</span>
				)}
			</div>
			{onReply && !message.thread_root_id && (
				/* A row hover can equal any ladder ground on some palette. Like the
				   sibling hover tools, use a ghost control whose ink/focus outline is
				   the affordance, not a new filled plate needing its own boundary. */
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={t("ui.teamBridge.replies.action")}
					title={t("ui.teamBridge.replies.action")}
					onClick={() => onReply(message)}
					className="absolute right-4 top-0 opacity-0 focus-visible:opacity-100 group-hover/message:opacity-100"
				>
					<MessageSquare size={16} />
				</Button>
			)}
			<div className="min-w-0 flex-1">
				{!continuation && (
					<div className="flex items-baseline gap-2">
						<span className="truncate font-semibold text-[14px] text-ink">
							{label}
						</span>
						{valid && (
							<time
								dateTime={message.created_at}
								title={full}
								className="shrink-0 text-[12px] text-ink-dim"
							>
								{clock}
							</time>
						)}
					</div>
				)}
				{/* A null body is an agent member's unadmitted message: say so
				    rather than rendering an empty row. */}
				{message.body === null ? (
					<p className="text-[14px] text-ink-dim italic">
						{t("ui.teamBridge.thread.withheld")}
					</p>
				) : message.body.trim() === "" &&
					(message.attachments?.length ?? 0) > 0 ? null : (
					/* An image-only message has an empty body: no empty prose block. */
					<TeamBridgeMarkdown className="team-bridge-message-body text-[14px] text-ink">
						{message.body}
					</TeamBridgeMarkdown>
				)}
				{/* Images come ONLY from the structured list, never from the body. */}
				{(message.attachments?.length ?? 0) > 0 && (
					<TeamBridgeMessageAttachments
						message={message}
						tenantId={tenantId ?? null}
						density={density}
					/>
				)}
				{onReply && summary.count > 0 && (
					<button
						type="button"
						onClick={() => onReply(message)}
						className="mt-1 flex items-center gap-2 rounded-md py-1 text-[12px] text-accent hover:bg-row-hover"
					>
						<span aria-hidden="true" className="flex gap-0.5">
							{summary.participants.map((name, index) => (
								<span
									key={`${index}:${name}`}
									// Initials are ink, not plates: the summary button already owns
									// the row-hover state, so nesting a ladder fill loses its edge.
									className="flex size-5 items-center justify-center text-[10px] text-ink-muted"
								>
									{name.trim().charAt(0).toUpperCase()}
								</span>
							))}
						</span>
						{t("ui.teamBridge.replies.count", { count: summary.count })}
						{summary.lastReply && (
							<span className="text-ink-dim">
								·{" "}
								{t("ui.teamBridge.replies.last", {
									time: formatTime(
										summary.lastReply,
										{ hour: "numeric", minute: "2-digit" },
										locale,
									),
								})}
							</span>
						)}
					</button>
				)}
			</div>
		</li>
	);
};
