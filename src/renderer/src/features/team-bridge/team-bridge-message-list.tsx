import { formatDate, formatTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot, UserRound } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { FC, ReactNode } from "react";
import type {
	TeamBridgeDirectoryMember,
	TeamBridgeEvent,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { useMessageMentions } from "./mentions/use-message-mentions";
import {
	teamBridgeArrivalStreamKey,
	teamBridgeLiveArrivals,
	teamBridgeObserveArrivals,
	teamBridgeSuspendArrivals,
} from "./team-bridge-arrival-model";
import { TeamBridgeMessageAttachments } from "./team-bridge-attachments";
import { EMOJI_ENTRIES } from "./team-bridge-emoji-model";
import { warmEmojiProbeCache } from "./team-bridge-emoji-support";
import { TeamBridgeMarkdown } from "./team-bridge-markdown";
import {
	type TeamBridgeEventLabel,
	TeamBridgeMemberEvents,
} from "./team-bridge-member-events";
import {
	TEAM_BRIDGE_EVENTS_LEADING,
	teamBridgeEventAnchors,
} from "./team-bridge-member-events-model";
import { TeamBridgeMessageToolbar } from "./team-bridge-message-toolbar";
import { type ThreadItem, threadItems } from "./team-bridge-model";
import {
	TeamBridgeAvatar,
	TeamBridgeProfileCard,
} from "./team-bridge-profile-card";
import { TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD } from "./team-bridge-reaction-gate";
import {
	TeamBridgeReactionChips,
	useTeamBridgeReactionState,
} from "./team-bridge-reactions";
import { TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD } from "./team-bridge-thread-gate";
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
 *
 * NULL MEANS UNKNOWN, AND LOOKS IT. When nothing names the sender (directory
 * still loading or failed, a member who left, the legacy "Member" label the
 * hub stored), the row says "Unknown person" / "Unknown agent" in a muted
 * italic with a neutral glyph. An initial avatar under a plausible word is what
 * made "Member" read as somebody's name (operator report, 2026-10-22).
 */
/**
 * The rows that must animate, held for the length of the motion.
 *
 * Deriving the class per render meant any unrelated update during the 240ms
 * window (a label resolving, a reaction, a parent re-render) dropped it and the
 * row snapped to its final state mid-motion. The ids persist instead, and they
 * are cleared DETERMINISTICALLY - review round 1, A1: `animationend` alone is
 * not enough, because it never fires when the row unmounts mid-motion (the
 * reader switches conversation inside 240ms) and never fires at all under
 * `prefers-reduced-motion`, so a leftover id went on to light up a row in the
 * next conversation.
 *
 * Three locks, in order of certainty:
 *   1. the ids are scoped to the stream - a state whose key does not match the
 *      current one reads as EMPTY, so a conversation switch cannot carry them;
 *   2. `animationend` clears them the moment the motion finishes;
 *   3. a timer bounded above the animation token clears them whatever happens.
 *
 * The list always OBSERVES the page (the journal must learn which ids exist,
 * including a page this list is not allowed to animate), but only the enabled
 * read may tokenise them.
 */
const ARRIVAL_CLEAR_MS = 600;

function useArrivingRows(
	key: string,
	messages: readonly TeamBridgeMessage[],
	enabled: boolean,
): { has: (message: TeamBridgeMessage) => boolean; end: () => void } {
	const [held, setHeld] = useState<{ key: string; ids: ReadonlySet<string> }>(
		() => ({ key, ids: new Set() }),
	);
	useLayoutEffect(() => {
		const fresh = enabled
			? teamBridgeLiveArrivals(key, messages, { commit: false })
			: new Set<string>();
		// Observe AFTER reading, and before the browser paints: React may run this
		// tree twice, so the journal must be written by an effect, not a render.
		teamBridgeObserveArrivals(key, messages);
		if (fresh.size > 0)
			setHeld((current) => ({
				key,
				ids: new Set([...(current.key === key ? current.ids : []), ...fresh]),
			}));
	}, [key, enabled, messages]);
	// Suspend on UNMOUNT only. A dependency-change cleanup would suspend the
	// stream on every unrelated re-render and turn the next live message into a
	// "restore" that never animates.
	useEffect(() => () => teamBridgeSuspendArrivals(key), [key]);
	const ids = held.key === key ? held.ids : EMPTY_IDS;
	useEffect(() => {
		if (ids.size === 0) return;
		const timer = setTimeout(
			() => setHeld({ key, ids: new Set() }),
			ARRIVAL_CLEAR_MS,
		);
		return () => clearTimeout(timer);
	}, [key, ids]);
	const has = useCallback(
		(message: TeamBridgeMessage) => ids.has(message.id),
		[ids],
	);
	const end = useCallback(() => {
		setHeld((current) =>
			current.ids.size === 0 ? current : { key: current.key, ids: new Set() },
		);
	}, []);
	return { has, end };
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * What a READ-ONLY caller adds to a row, and nothing else.
 *
 * WHY THIS EXISTS (owner audit, 2026-10-30). The owner-audit transcript used to
 * draw its own rows (wip slice c766a8c2daa): a raw pre-wrap paragraph, no
 * avatar, a medium date on every row, no runs, the stored label as the name. The
 * same chief-of-staff message therefore looked like two products depending on
 * which door the owner came in by. It now renders through this list, and the
 * few things only an audit has travel in through this ONE optional, per-message
 * hook rather than a second renderer.
 *
 * THE CONTRACT: every field is optional and its absence is the channel
 * behaviour, byte for byte (`scripts/team-bridge-owner-audit-render.test.mjs`
 * pins a channel's markup against a golden captured before this existed). None
 * of the fields can add a write: the toolbar, reactions, thread button and
 * "Message" action stay governed by `reactionContext` / `onReply` /
 * `onMessagePerson`, which a read-only caller simply does not pass.
 */
export type TeamBridgeRowDecoration = {
	/*
	 * A status mark beside the clock (on a run's continuation rows, which have
	 * no header, it opens the body column instead, so EVERY message carries its
	 * own mark: the audit's verdict is per message, not per run).
	 */
	badge?: ReactNode;
	/*
	 * Copy for a null body. The default ("Waiting for the agent to admit this
	 * message") is the MEMBER view's truth; an audit has no admission to wait
	 * for, only text the hub did not send, so it says that instead. Setting it
	 * also covers a BLANK body with nothing attached: a caller that names its own
	 * absence copy is reading stored history, where `""` means no text reached
	 * the reader, and an empty prose block there reads as a rendering fault
	 * (agent review round 1, R1-2). Unset, a blank body keeps the channel
	 * behaviour byte for byte.
	 *
	 * Every body WITH text renders inline. The audit once collapsed unadmitted
	 * text behind a disclosure here; that was a presentation choice taken from
	 * the hub contract (v2 m4), not an isolation guard, and it was dropped at the
	 * owner's request. The verdict chip (`badge`) is what tells the owner the
	 * agent refused or never saw that text.
	 */
	withheldCopy?: string;
	/*
	 * Replaces the attachment component for this row. The shared component
	 * FETCHES BYTES; a caller that must never load a private attachment (the
	 * audit) drops `attachments` from the message and states what was there
	 * through this slot. It also counts as "has attachments" for the
	 * image-only-message rule, so an empty body beside it is not drawn as an
	 * empty prose block.
	 */
	attachments?: ReactNode;
	/* Rendered last in the content column (the audit's thread-reply disclosure). */
	after?: ReactNode;
};

export const TeamBridgeMessageList: FC<{
	messages: readonly TeamBridgeMessage[];
	labelFor: (sender: TeamBridgeMessage["sender"]) => string | null;
	profileFor?: (
		sender: TeamBridgeMessage["sender"],
	) => TeamBridgeDirectoryMember | undefined;
	onMessagePerson?: (sender: TeamBridgeMessage["sender"]) => void;
	canMessagePerson?: (sender: TeamBridgeMessage["sender"]) => boolean;
	reactionContext?: ReactionContext;
	onReply?: (message: TeamBridgeMessage) => void;
	/** Story/capture seed only: show every row's toolbar without hover. */
	forceToolbar?: boolean;
	/*
	 * The organization the messages belong to: an image fetch is member-gated
	 * per tenant on the hub, so the tenant travels with the request. Omitted by
	 * callers with no images to fetch (and then images render as unavailable
	 * rather than guessing a tenant).
	 */
	tenantId?: string;
	/*
	 * The account this subtree was RENDERED under: the attachment byte route now
	 * carries `expected_account_id` (the captured-owner guard), and passing the
	 * render-time prop is what makes it a receipt rather than a lookup of
	 * whoever happens to be signed in when the fetch runs.
	 */
	accountId?: string;
	/* `compact`: the thread pane's narrow column (see `boxFor`). */
	density?: "regular" | "compact";
	/** Stable stream identity; a conversation/thread switch is a new stream. */
	arrivalKey?: string;
	/** A paged read restores history; it never introduces a live arrival. */
	arrivalsEnabled?: boolean;
	/** Read-only per-row additions; see `TeamBridgeRowDecoration`. */
	decorate?: (
		message: TeamBridgeMessage,
	) => TeamBridgeRowDecoration | undefined;
	/*
	 * Membership events (invited / joined / left ...), drawn as quiet lines
	 * between the rows by `after_seq`. A SIBLING SLOT, not a `decorate` field:
	 * an event is not a property of the message it follows, and the owner-audit
	 * and thread-pane callers must never receive it (they simply do not pass
	 * this). Absent = no event lines, byte for byte.
	 */
	events?: readonly TeamBridgeEvent[];
}> = ({
	messages,
	labelFor,
	profileFor,
	onMessagePerson,
	canMessagePerson,
	reactionContext,
	onReply,
	forceToolbar,
	tenantId,
	density,
	accountId,
	arrivalKey = teamBridgeArrivalStreamKey(
		tenantId,
		messages[0]?.conversation_id,
	),
	arrivalsEnabled = true,
	decorate,
	events,
}) => {
	const locale = useI18nLocale();
	const arriving = useArrivingRows(arrivalKey, messages, arrivalsEnabled);
	const items = threadItems(messages, new Date());
	const eventLabel: TeamBridgeEventLabel = (party) =>
		labelFor(party) ??
		(party.kind === "agent"
			? t("ui.teamBridge.sender.unknown_agent")
			: t("ui.teamBridge.sender.unknown_person"));
	const eventsAt = teamBridgeEventAnchors(messages, events);
	const eventSlot = (anchor: string) => {
		const at = eventsAt.get(anchor);
		return at ? (
			<TeamBridgeMemberEvents
				key={`events:${anchor}`}
				events={at}
				labelFor={eventLabel}
				locale={locale}
			/>
		) : null;
	};
	/* Warm the emoji font probe while the reader is reading, so opening the
	   reaction picker is a cache lookup rather than canvas readbacks inside its
	   click handler. GATED ON THE HOLD (agent review round 1, m1): while
	   reactions do not ship, no toolbar, picker or chip renders, so the walk
	   buys this build nothing and would spend the operator's first load on it.
	   Mounted on the list because the row's toolbar - the only door to the
	   picker - lives here; the helper itself is once-per-module, so the thread
	   pane's extra lists do not each take a slice. */
	useEffect(() => {
		if (!TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD) return;
		return warmEmojiProbeCache(EMOJI_ENTRIES.map((entry) => entry.emoji));
	}, []);
	return (
		/* THE SHARED WIDTH CONSTRAINT (operator report 2026-10-27: the hover
		   band and the action row ran past the visible column). The list is
		   exactly the scroll viewport's width, never its content's: `w-full
		   min-w-0` here and on every row means a long unbroken token, a code
		   block or a table can only wrap or scroll inside the row's content
		   column (`lo-markdown` breaks words; `pre` and tables scroll in their
		   own box), so the row-hover ground and the toolbar float, which is the
		   last thing at the column's end edge, stay inside what the reader sees.
		   Both scroll hosts (the page timeline and the thread pane) also lay
		   Radix's content wrapper out as a block, not its default shrink-to-fit
		   `display: table`; see their ScrollArea class names. */
		<ol className="mt-auto flex w-full min-w-0 flex-col pt-4 pb-2">
			{eventSlot(TEAM_BRIDGE_EVENTS_LEADING)}
			{withEventsAfterRows(
				items,
				eventSlot,
				items.map((item) =>
					item.type === "day" ? (
						<DayDivider key={`day:${item.key}`} item={item} locale={locale} />
					) : (
						<MessageRow
							key={item.message.id}
							message={item.message}
							continuation={item.continuation}
							label={labelFor(item.message.sender)}
							member={profileFor?.(item.message.sender)}
							onMessagePerson={onMessagePerson}
							canMessagePerson={canMessagePerson}
							locale={locale}
							reactionContext={reactionContext}
							onReply={onReply}
							forceToolbar={forceToolbar}
							tenantId={tenantId}
							accountId={accountId}
							density={density}
							arriving={arriving.has(item.message)}
							onArrivalEnd={arriving.end}
							decoration={decorate?.(item.message)}
						/>
					),
				),
			)}
		</ol>
	);
};

/*
 * The row map's output with each message's event lines placed right after it.
 *
 * WHY A WRAPPER RATHER THAN A FRAGMENT IN THE MAP: the row map (and its React
 * keys) is shared with other in-flight changes; leaving it byte-identical keeps
 * every rebase textual. `rows[i]` is `items[i]`'s element by construction.
 * Event slots key in their own `events:` namespace (each line inside keys as
 * `event:<id>`), so they can never collide with a message or day key.
 */
function withEventsAfterRows(
	items: readonly ThreadItem[],
	slot: (anchor: string) => ReactNode,
	rows: ReactNode[],
): ReactNode[] {
	const out: ReactNode[] = [];
	rows.forEach((row, index) => {
		out.push(row);
		const item = items[index];
		if (item?.type === "message") {
			const after = slot(item.message.id);
			if (after) out.push(after);
		}
	});
	return out;
}

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

type ReactionContext = {
	accountId: string;
	tenantId: string;
	disabled?: boolean;
};

/*
 * A row with reactions keys its reaction state on the account (the parent's
 * `key` on this component), so a pending projection from one account can never
 * render under another after a switch.
 */
const MessageRow: FC<{
	message: TeamBridgeMessage;
	continuation: boolean;
	label: string | null;
	member?: TeamBridgeDirectoryMember;
	onMessagePerson?: (sender: TeamBridgeMessage["sender"]) => void;
	canMessagePerson?: (sender: TeamBridgeMessage["sender"]) => boolean;
	locale: string;
	reactionContext?: ReactionContext;
	onReply?: (message: TeamBridgeMessage) => void;
	forceToolbar?: boolean;
	tenantId?: string;
	accountId?: string;
	density?: "regular" | "compact";
	arriving?: boolean;
	onArrivalEnd?: () => void;
	decoration?: TeamBridgeRowDecoration;
}> = ({ reactionContext, ...props }) =>
	reactionContext && props.message.body !== null ? (
		<ReactableMessageRow
			key={`${reactionContext.accountId}:${props.message.id}`}
			reactionContext={reactionContext}
			{...props}
		/>
	) : (
		<MessageRowView {...props} />
	);

const ReactableMessageRow: FC<
	Omit<MessageRowProps, "reactions"> & { reactionContext: ReactionContext }
> = ({ reactionContext, ...props }) => {
	const reactions = useTeamBridgeReactionState({
		conversationId: props.message.conversation_id,
		messageId: props.message.id,
		...reactionContext,
		reactions: props.message.reactions,
	});
	return <MessageRowView {...props} reactions={reactions} />;
};

type MessageRowProps = {
	message: TeamBridgeMessage;
	continuation: boolean;
	label: string | null;
	member?: TeamBridgeDirectoryMember;
	onMessagePerson?: (sender: TeamBridgeMessage["sender"]) => void;
	canMessagePerson?: (sender: TeamBridgeMessage["sender"]) => boolean;
	locale: string;
	reactions?: ReturnType<typeof useTeamBridgeReactionState>;
	onReply?: (message: TeamBridgeMessage) => void;
	forceToolbar?: boolean;
	tenantId?: string;
	accountId?: string;
	density?: "regular" | "compact";
	arriving?: boolean;
	onArrivalEnd?: () => void;
	decoration?: TeamBridgeRowDecoration;
};

const MessageRowView: FC<MessageRowProps> = ({
	message,
	continuation,
	label: known,
	member,
	onMessagePerson,
	canMessagePerson,
	locale,
	reactions,
	onReply,
	forceToolbar,
	tenantId,
	accountId,
	density,
	arriving = false,
	onArrivalEnd,
	decoration,
}) => {
	const summary = threadSummary(message);
	// @-mentions in the body: `message.mentions` when the hub sends it, else
	// `@Name` matching (mentions/message-mentions.ts says why both).
	const mentionRuns = useMessageMentions(message);
	/* One-level threads: only a timeline root can open a thread - and none can
	   while the thread surface is held. `canReply` is therefore the ONE term the
	   toolbar button and the "N replies" summary both read, so the affordance
	   does not render rather than rendering inert. */
	const canReply =
		TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD &&
		onReply !== undefined &&
		!message.thread_root_id;
	const agent = message.sender.kind === "agent";
	const label =
		known ??
		(agent
			? t("ui.teamBridge.sender.unknown_agent")
			: t("ui.teamBridge.sender.unknown_person"));
	const at = new Date(message.created_at);
	const valid = !Number.isNaN(at.getTime());
	const clock = valid
		? formatTime(at, { hour: "numeric", minute: "2-digit" }, locale)
		: "";
	const full = valid
		? formatDate(at, { dateStyle: "full", timeStyle: "short" }, locale)
		: "";
	const canMessage = Boolean(
		member &&
			onMessagePerson &&
			(canMessagePerson?.(message.sender) ?? true) &&
			member.account_id !== accountId &&
			member.bridge_enabled &&
			["active", "paused"].includes(member.bridge_state) &&
			(!agent || member.agent),
	);
	const messagePerson = () => onMessagePerson?.(message.sender);
	const avatar = member ? (
		<TeamBridgeProfileCard
			member={member}
			label={label}
			agentName={agent ? label : undefined}
			onMessage={messagePerson}
			canMessage={canMessage}
		>
			<button
				type="button"
				className="mt-0.5 block size-9 shrink-0 rounded-md text-start"
			>
				<TeamBridgeAvatar
					member={member}
					label={label}
					size={36}
					className="size-9 rounded-md bg-media-surface text-ink-muted text-[14px]"
					fallback={
						agent ? (
							<Bot size={18} />
						) : known === null ? (
							<UserRound size={18} />
						) : (
							known.trim().charAt(0).toUpperCase() || "?"
						)
					}
				/>
			</button>
		</TeamBridgeProfileCard>
	) : null;
	return (
		<li
			data-message-id={message.id}
			onAnimationEnd={arriving ? onArrivalEnd : undefined}
			className={cn(
				"group/message relative flex w-full min-w-0 gap-3 px-5 transition-colors duration-fast ease-out-quart hover:bg-row-hover",
				// Transform/opacity only: the row reserves its final layout box
				// immediately, so arrival cannot move the scroll geometry.
				arriving && "lo-team-bridge-arrival",
				continuation ? "py-0.5" : "mt-2 pt-1.5 pb-0.5",
			)}
		>
			{/* The 36px gutter holds the avatar on a run's first message and the
			    hover clock on its continuations, so bodies share one left edge. */}
			<div className="w-9 shrink-0">
				{continuation
					? valid && (
							<time
								dateTime={message.created_at}
								title={full}
								className="block pt-0.5 text-right text-[11px] text-ink-dim opacity-0 group-hover/message:opacity-100"
							>
								{clock}
							</time>
						)
					: (avatar ?? (
							<span
								aria-hidden="true"
								data-sender-avatar={
									agent ? "agent" : known === null ? "unknown" : "initial"
								}
								className={cn(
									// A rounded SQUARE, as the operator's reference draws it:
									// Slack's people are squares, and a circle here would read as
									// the app's own account avatar.
									// Fixed box, clipped: an account picture can replace the
									// initial later without moving a pixel of the row.
									"mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md font-medium text-[14px]",
									/* BORDERLESS, SEPARATED BY VALUE (operator ask, 2026-10-26).
							   The plate used to need a `border-control` ring because
							   `sunken` lands on the row-hover rung on some palettes
							   (ΔE00 1.86 on iceberg) and vanished into a hovered row.
							   `media-surface` is the app's borderless-tile fill: it
							   deepens AWAY from the ground, so it clears `canvas`
							   (ΔE00 >= 4.0, its contract floor), `surface` (>= 5.96)
							   AND `row-hover` (>= 3.70) on all 59 palettes. Agents use
							   the SAME fill with an accent Bot glyph: `accent-wash` is
							   not a safe substitute, since it sits within ΔE00 1.38 of
							   row-hover on obsidian and 1.56 on oneLight. The fill and
							   glyph pair is registered in `scripts/contrast-contract.mjs`. */
									agent
										? "bg-media-surface text-accent"
										: "bg-media-surface text-ink-muted",
								)}
							>
								{agent ? (
									<Bot size={18} />
								) : known === null ? (
									<UserRound size={18} />
								) : (
									known.trim().charAt(0).toUpperCase() || "?"
								)}
							</span>
						))}
			</div>
			<div className="min-w-0 flex-1">
				{/* First in the column so it floats beside the first line; see
				    `team-bridge-message-toolbar.tsx` for why one toolbar exists. */}
				<TeamBridgeMessageToolbar
					reactions={reactions}
					onReply={canReply ? () => onReply(message) : undefined}
					forceVisible={forceToolbar}
				/>
				{!continuation && (
					<div className="flex items-baseline gap-2">
						{member ? (
							<TeamBridgeProfileCard
								member={member}
								label={label}
								agentName={agent ? label : undefined}
								onMessage={messagePerson}
								canMessage={canMessage}
							>
								<button
									type="button"
									data-sender={known === null ? "unknown" : "known"}
									className="min-w-0 truncate rounded-sm text-start font-semibold text-[14px] text-ink"
								>
									{label}
								</button>
							</TeamBridgeProfileCard>
						) : (
							<span
								data-sender={known === null ? "unknown" : "known"}
								className={cn(
									"truncate text-[14px]",
									known === null
										? "text-ink-muted italic"
										: "font-semibold text-ink",
								)}
							>
								{label}
							</span>
						)}
						{valid && (
							<time
								dateTime={message.created_at}
								title={full}
								className="shrink-0 text-[12px] text-ink-dim"
							>
								{clock}
							</time>
						)}
						{decoration?.badge}
					</div>
				)}
				{continuation && decoration?.badge && (
					<div className="flex pb-0.5">{decoration.badge}</div>
				)}
				{/* A null body is an agent member's unadmitted message: say so
				    rather than rendering an empty row. A caller with its own absence
				    copy (the audit) gets the same placeholder for a BLANK body with
				    nothing attached; see `withheldCopy`. */}
				{message.body === null ||
				(decoration?.withheldCopy !== undefined &&
					message.body.trim() === "" &&
					(message.attachments?.length ?? 0) === 0 &&
					decoration.attachments === undefined) ? (
					<p className="text-[14px] text-ink-dim italic">
						{decoration?.withheldCopy ?? t("ui.teamBridge.thread.withheld")}
					</p>
				) : message.body.trim() === "" &&
					((message.attachments?.length ?? 0) > 0 ||
						decoration?.attachments !== undefined) ? null : (
					/* An image-only message has an empty body: no empty prose block. */
					<TeamBridgeMarkdown
						className="team-bridge-message-body text-[14px] text-ink"
						mentions={mentionRuns}
					>
						{message.body}
					</TeamBridgeMarkdown>
				)}
				{/* Images come ONLY from the structured list, never from the body. */}
				{(message.attachments?.length ?? 0) > 0 && (
					<TeamBridgeMessageAttachments
						message={message}
						tenantId={tenantId ?? null}
						density={density}
						accountId={accountId}
					/>
				)}
				{decoration?.attachments}
				{reactions && <TeamBridgeReactionChips state={reactions} />}
				{canReply && summary.count > 0 && (
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
				{decoration?.after}
			</div>
		</li>
	);
};
