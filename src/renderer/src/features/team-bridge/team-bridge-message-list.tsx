import { Spinner } from "@shared/components/common/spinner";
import { Skeleton } from "@shared/components/ui/skeleton";
import { formatDate, formatTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot, UserRound } from "lucide-react";
import {
	Fragment,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { FC, ReactNode, RefObject } from "react";
import type {
	TeamBridgeDirectoryMember,
	TeamBridgeEvent,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeMessageAttachments } from "./attachments/member-attachments";
import { InlineDataBody } from "./inline-data-receipt";
import { TeamBridgeMessageLinkPreviews } from "./link-preview/team-bridge-message-link-previews";
import { useMessageMentions } from "./mentions/use-message-mentions";
import {
	type TeamBridgeArrivalIdentity,
	teamBridgeArrivalStreamKey,
	teamBridgeLiveArrivals,
	teamBridgeObserveArrivals,
	teamBridgeSuspendArrivals,
} from "./team-bridge-arrival-model";
import { TEAM_BRIDGE_PAGE_SIZE } from "./team-bridge-channel-cache";
import { TeamBridgeDeliveryAnnotation } from "./team-bridge-delivery-annotation";
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
import {
	type ThreadItem,
	chronological,
	threadItems,
} from "./team-bridge-model";
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
import { TeamBridgeThreadRow } from "./team-bridge-thread-row";
import { threadSummary } from "./team-bridge-threads-model";
import { windowEntryKey } from "./team-bridge-window";
import { useTimelineWindow } from "./use-team-bridge-timeline-window";

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
	messages: readonly TeamBridgeArrivalIdentity[],
	enabled: boolean,
): { has: (id: string) => boolean; end: () => void } {
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
	const has = useCallback((id: string) => ids.has(id), [ids]);
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

/**
 * How the page wants one row drawn when it is not simply the server's.
 *
 * `key` is the row's identity for React AND for the arrival journal: an optimistic
 * send keeps its local id after its server row replaces it, so the replacement is
 * the same list item - no remount, no second arrival motion, no flicker
 * (`team-bridge-pending-sends.ts`). `local` marks a row this client drew: its seq
 * is a display order, not the hub's, so it never raises the arrival watermark, and
 * it has no server id to react to or reply on yet. `delivery` is the send's state
 * while it is not confirmed.
 */
export type TeamBridgeRowPresentation = {
	key: string;
	local: boolean;
	delivery?: {
		status: "pending" | "failed";
		onRetry?: () => void;
		onEdit?: () => void;
	};
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
	/**
	 * The message a notification click named. Its row (the existing
	 * `data-message-id` root) wears a brief accent wash that fades out; see
	 * `.lo-team-bridge-target` for the motion and its reduced-motion form. The
	 * scroll to it belongs to the timeline's owner, which also owns the
	 * stick-to-bottom pin it has to override. The caller clears it after the fade.
	 */
	highlightId?: string | null;
	/** Optimistic rows: identity and delivery state (see `TeamBridgeRowPresentation`). */
	presentationOf?: (message: TeamBridgeMessage) => TeamBridgeRowPresentation;
	/*
	 * The reader's read watermark AS IT WAS WHEN THEY OPENED the conversation
	 * (the page freezes it on entry, because reading advances the live one).
	 * The "N new messages" divider sits above the first message past it that
	 * someone else sent. Absent = no divider (the thread pane, the audit).
	 */
	unreadAfterSeq?: number;
	/*
	 * WINDOWING, OPT-IN, and off wherever this list is not the page's timeline.
	 *
	 * `scrollRootRef` is the ScrollArea root the timeline lives in; passing it
	 * turns on the strip (`use-team-bridge-timeline-window.ts`) so only the
	 * visible rows plus overscan are mounted. The thread pane, the owner audit
	 * and every story leave it out and keep the full render they have today -
	 * their histories are already bounded (`use-thread-reply-window.ts`), and a
	 * second virtualization lane there would be a change nobody asked for.
	 *
	 * `hasOlder` / `loadingOlder` / `onLoadOlder` are the paging half: the strip
	 * decides WHEN from scroll position, so the page never has to listen to a
	 * scroll event itself.
	 */
	scrollRootRef?: RefObject<HTMLElement | null>;
	hasOlder?: boolean;
	loadingOlder?: boolean;
	onLoadOlder?: () => void;
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
	highlightId = null,
	presentationOf,
	unreadAfterSeq,
	scrollRootRef,
	hasOlder = false,
	loadingOlder = false,
	onLoadOlder,
}) => {
	const locale = useI18nLocale();
	/* A stable identity: the window's item keys are built from this row identity, so
	   a new closure per render would rebuild the strip's key list on every render
	   and re-run the layout it is memoized against. */
	const present = useCallback(
		(message: TeamBridgeMessage): TeamBridgeRowPresentation =>
			presentationOf?.(message) ?? { key: message.id, local: false },
		[presentationOf],
	);
	/* The journal sees ROW identity. A local row offers no seq: its display order
	   is not the hub's numbering and must not hide a peer's message at that seq. */
	const identities = useMemo(
		() =>
			messages.map((message) => {
				const row = presentationOf?.(message);
				return row?.local
					? { id: row.key }
					: { id: row?.key ?? message.id, seq: message.seq };
			}),
		[messages, presentationOf],
	);
	const arriving = useArrivingRows(arrivalKey, identities, arrivalsEnabled);
	const items = threadItems(messages, new Date());
	const listRef = useRef<HTMLOListElement>(null);
	/* WINDOWING IS OFF unless the caller names the scroll root (see the prop's
	   note). When it is on, only `range` is mounted and two spacers stand in for
	   the rest; when it is off, `range` covers every item and both spacers are
	   zero, so the markup below stays one shape. */
	const windowed = scrollRootRef !== undefined;
	const entries = useMemo(
		() =>
			items.map((item) => ({
				item,
				key: windowEntryKey(
					item,
					item.type === "message" ? present(item.message).key : undefined,
				),
			})),
		// Keys follow the ROW identity (`present`), never the message id: an
		// optimistic row keeps its key through the server replacement, and a strip
		// keyed on the stored id would remount it at the moment it settles.
		[items, present],
	);
	const { range, spacers, stickyDay } = useTimelineWindow({
		entries,
		listRef,
		scrollRootRef,
		resetKey: arrivalKey,
		hasOlder,
		loadingOlder,
		onLoadOlder,
		enabled: windowed,
	});
	/*
	 * THE UNREAD DIVIDER (visual refresh D10) - Slack's and Discord's strongest
	 * orientation cue. Only the hub's rows count (a local row's seq is a display
	 * order) and only other people's: what the reader sent themselves is not news.
	 */
	const unseen =
		unreadAfterSeq === undefined
			? []
			: messages.filter(
					(message) =>
						message.seq > unreadAfterSeq &&
						message.sender.account_id !== accountId &&
						!present(message).local,
				);
	/* The OLDEST unseen message, by seq, never by array position: the hub's
	   timeline page arrives newest-first and only `threadItems` sorts it, so
	   `unseen[0]` was the newest - the divider sat above the last of three
	   (agent review round 1, M1). */
	const firstUnreadId = chronological(unseen)[0]?.id;
	const eventLabel: TeamBridgeEventLabel = (party) =>
		labelFor(party) ??
		(party.kind === "agent"
			? t("ui.teamBridge.sender.unknown_agent")
			: t("ui.teamBridge.sender.unknown_person"));
	/*
	 * ANCHORS COME FROM SERVER ROWS ONLY (review round 5, M1). A local row carries a
	 * NUMERIC DISPLAY seq so the thread can order it against the page, which defeats
	 * `teamBridgeEventAnchors`' own guard (that guard reads "not a number" as
	 * "optimistic"). In a new conversation the first draft's display seq is 0 - the
	 * creation events' `after_seq` - so "You invited Sana" drew UNDER the draft and
	 * jumped above it on confirm; a failed draft kept it underneath forever. The rows
	 * reaching the anchor map are therefore the hub's, which is what its contract
	 * always meant: an event belongs to history, never to a draft.
	 */
	const eventsAt = teamBridgeEventAnchors(
		messages.filter((message) => !present(message).local),
		events,
	);
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
	/*
	 * ONE ROW, BUILT ONCE FOR BOTH PATHS.
	 *
	 * ROW IDENTITY, NOT MESSAGE IDENTITY (the optimistic row). `present` answers
	 * the row this message is drawn as: the server row's own id until an
	 * optimistic sibling exists, then the local key that SURVIVES the replacement,
	 * so reconciliation is a prop change on one mounted subtree rather than an
	 * unmount. The event lines stay keyed by the STORED message id, because an
	 * event belongs to the hub's history and never to a draft.
	 *
	 * `windowItem` is set only by the windowed path: it tags the item's FIRST
	 * element (the unread divider when there is one) so the measure pass knows
	 * where the item starts. Both elements of an item carry it - the divider and
	 * the row are one item's worth of height.
	 */
	const rowFor = (
		item: Extract<ThreadItem, { type: "message" }>,
		windowItem?: string,
	) => {
		const row = present(item.message);
		const divider =
			item.message.id === firstUnreadId ? (
				<UnreadDivider count={unseen.length} windowItem={windowItem} />
			) : null;
		return (
			<Fragment key={row.key}>
				{divider}
				<MessageRow
					key={row.key}
					rowKey={row.key}
					local={row.local}
					delivery={row.delivery}
					message={item.message}
					/* The divider restarts the run: the first message under "N new
							 messages" always shows its author, as Slack and Discord do
						  (agent review round 1, m1). */
					continuation={item.continuation && item.message.id !== firstUnreadId}
					label={labelFor(item.message.sender)}
					member={profileFor?.(item.message.sender)}
					profileFor={profileFor}
					onMessagePerson={onMessagePerson}
					canMessagePerson={canMessagePerson}
					locale={locale}
					reactionContext={reactionContext}
					onReply={onReply}
					forceToolbar={forceToolbar}
					tenantId={tenantId}
					accountId={accountId}
					density={density}
					/* TWO IDENTITIES, TWO QUESTIONS. `arriving` follows the ROW key, which
								survives an optimistic row's replacement; `highlighted` follows the
								STORED message id, because a notification names a hub message and a
								local row can never be one - so a pending row never wears the wash. */
					arriving={arriving.has(row.key)}
					highlighted={highlightId === item.message.id}
					onArrivalEnd={arriving.end}
					decoration={decorate?.(item.message)}
					windowItem={windowItem}
				/>
			</Fragment>
		);
	};
	/* The grouped path's row map. `rows[i]` is `items[i]`'s element by
							   construction (a day item's slot is null), which is what `groupedByDay`
							   indexes by. */
	const rows = items.map((item) => (item.type === "day" ? null : rowFor(item)));
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
		<ol
			ref={listRef}
			/* NO `relative` HERE (QA round 1, Q-3): the floating day pill is
			   `sticky`, positioned by the browser against the scroll viewport, so the
			   list root needs no containing block - and the owner-audit render pin
			   keeps the list byte-identical to the surface it has always drawn. */
			className="mt-auto flex w-full min-w-0 flex-col pt-4 pb-2"
		>
			{eventSlot(TEAM_BRIDGE_EVENTS_LEADING)}
			{windowed && stickyDay !== null && !stickyDay.hidden && (
				<DayPillOverlay day={stickyDay.day} locale={locale} />
			)}
			{/* ABOVE THE LEADING SPACER on purpose: the edge of history belongs to
			    the top of the conversation, not to whichever row is mounted first. */}
			{windowed && (
				<HistoryEdge
					loading={loadingOlder}
					hasOlder={hasOlder}
					/* A conversation shorter than one page has no history to have
					   reached: the line would be a headstone over the first message. */
					showStart={messages.length >= TEAM_BRIDGE_PAGE_SIZE}
				/>
			)}
			{windowed && spacers.before > 0 && (
				<li
					aria-hidden="true"
					data-window-spacer="before"
					className="shrink-0"
					style={{ height: spacers.before }}
				/>
			)}
			{windowed
				? entries.slice(range.start, range.end).map(({ key, item }) => {
						/* The day's pill is an ITEM in the strip (see `DayHeading`), keyed on
						   its calendar day like every other entry. */
						if (item.type === "day")
							return (
								<DayHeading
									key={key}
									item={item}
									locale={locale}
									windowItem={key}
								/>
							);
						/* One item, then its membership lines: the event slot is a SIBLING
						   slot (it keys itself in the `events:` namespace), exactly as the
						   grouped path places it. */
						return (
							<Fragment key={key}>
								{rowFor(item, key)}
								{eventSlot(item.message.id)}
							</Fragment>
						);
					})
				: groupedByDay(items, eventSlot, locale, rows)}
			{windowed && (
				<li
					aria-hidden="true"
					data-window-spacer="after"
					className="shrink-0"
					style={{ height: spacers.after }}
				/>
			)}
		</ol>
	);
};

/*
 * The row map's output, with each message's event lines placed right after it,
 * grouped into one list item PER DAY.
 *
 * WHY A WRAPPER RATHER THAN A FRAGMENT IN THE MAP: the row map (and its React
 * keys) is shared with other in-flight changes; leaving it shaped like `items`
 * keeps every rebase textual. `rows[i]` is `items[i]`'s element by
 * construction (a day item's slot is null). Event slots key in their own
 * `events:` namespace (each line inside keys as `event:<id>`), so they can never
 * collide with a message or day key.
 *
 * WHY EACH DAY IS ITS OWN CONTAINING BLOCK (QA round 1, Q2). A sticky element
 * sticks within its containing block. With every pill a sibling in the one
 * list, every earlier pill stayed stuck at the same `top-2` under the later
 * one, and since the labels differ in width the older one's ends showed on
 * both sides ("Mor · Today · er 2"). Inside its own day's `<li>`, a pill is
 * pushed off by the end of its day, so exactly one pill is ever stuck -
 * Slack's floating date. Messages with no valid date (no day item before
 * them) render in a pill-less group.
 */
function groupedByDay(
	items: readonly ThreadItem[],
	slot: (anchor: string) => ReactNode,
	locale: string,
	rows: ReactNode[],
): ReactNode[] {
	const out: ReactNode[] = [];
	let day: Extract<ThreadItem, { type: "day" }> | null = null;
	let body: ReactNode[] = [];
	const flush = () => {
		if (day === null && body.length === 0) return;
		out.push(
			<DayGroup
				key={day ? `day:${day.key}` : "day:none"}
				item={day}
				locale={locale}
			>
				{body}
			</DayGroup>,
		);
		body = [];
	};
	rows.forEach((row, index) => {
		const item = items[index];
		if (item?.type === "day") {
			flush();
			day = item;
			return;
		}
		body.push(row);
		if (item?.type === "message") {
			const after = slot(item.message.id);
			if (after) body.push(after);
		}
	});
	flush();
	return out;
}

/*
 * ONE DAY: a hairline across the top, the sticky pill, then the day's rows.
 * The hairline does NOT travel: a rule floating over messages would strike
 * through them, so it is absolutely positioned at the group's top, behind the
 * pill's resting position ("line - pill - line"). The pill sticks 8px under
 * the pane's top while its day scrolls beneath it, and its day's end pushes it
 * off (see `groupedByDay`). It is `elevated` (ΔE00 >= 4.17 off the `canvas`
 * pane on every palette), so it occludes the text it floats over.
 */
/** A day's label: "Today", "Yesterday", or the calendar date. */
function dayLabel(
	item: Extract<ThreadItem, { type: "day" }> | null,
	locale: string,
): string | null {
	if (item === null) return null;
	if (item.relative === "today") return t("ui.teamBridge.thread.today");
	if (item.relative === "yesterday") return t("ui.teamBridge.thread.yesterday");
	return formatDate(
		item.date,
		{ weekday: "long", month: "long", day: "numeric" },
		locale,
	);
}

/**
 * THE DAY PILL ITSELF - one markup, three places.
 *
 * The grouped list's sticky pill, the windowed strip's day row and the floating
 * overlay (`DayPillOverlay`) are the same object drawn by the same component, so
 * "which day is this" cannot look different depending on which one a reader is
 * looking at. `elevated` is the design contract: ΔE00 >= 4.17 off the `canvas`
 * pane on every palette, so the pill occludes the text it floats over.
 */
const DayPill: FC<{ label: string }> = ({ label }) => (
	<span className="flex h-6 items-center rounded-full bg-elevated px-2.5 font-medium text-[12px] text-ink-muted">
		{label}
	</span>
);

const DayGroup: FC<{
	item: Extract<ThreadItem, { type: "day" }> | null;
	locale: string;
	children: ReactNode;
}> = ({ item, locale, children }) => {
	const label = dayLabel(item, locale);
	return (
		/* The group is the day's labelled list item (the label used to sit on the
		   pill's own `<li>`); the pill and the rule are drawing, hidden from AT. */
		<li data-day-group="" aria-label={label ?? undefined} className="relative">
			{label !== null && (
				<>
					<span
						aria-hidden="true"
						data-day-rule=""
						className="absolute inset-x-5 top-5 h-px bg-hairline"
					/>
					<div
						aria-hidden="true"
						data-day-divider=""
						className="pointer-events-none sticky top-2 z-[5] flex justify-center py-2"
					>
						<DayPill label={label} />
					</div>
				</>
			)}
			<ol className="flex w-full min-w-0 flex-col">{children}</ol>
		</li>
	);
};

/*
 * THE EDGE OF HISTORY.
 *
 * Two states, one line, at the very top of the timeline: an older page is in
 * flight (``loadingOlder``), or there is nothing older to load (``hasOlder``)
 * and the conversation is long enough that "the beginning" is information
 * (``showStart``). A conversation shorter than one page gets neither: a
 * headstone over the first message would read as a state the reader has to
 * care about, when all it means is "this channel is new".
 *
 * NOT "Load earlier messages": paging here is PROXIMITY-driven (the list asks
 * when the reader nears the top), so a button would be a second, hand-cranked
 * path to the same read - and one more control to keep disabled, focused and
 * keyboard-reachable for no benefit.
 */
const HistoryEdge: FC<{
	loading: boolean;
	hasOlder: boolean;
	showStart: boolean;
}> = ({ loading, hasOlder, showStart }) => {
	if (loading)
		return (
			<li
				data-history-edge="loading"
				/* `polite` and not `alert`: a page arriving is progress, not a demand. The
				 * list item cannot be an `<output>` (it is a child of an `<ol>`), so the
				 * live region is the text span itself. */
				className="flex h-8 shrink-0 items-center justify-center gap-2 px-5 text-ink-dim text-meta"
			>
				<Spinner size="sm" />
				<span aria-live="polite">{t("ui.teamBridge.thread.loading")}</span>
			</li>
		);
	if (hasOlder || !showStart) return null;
	/*
	 * NO COPY AT THE START OF HISTORY. The boundary is a hairline and nothing
	 * else - Slack draws the same rule and says nothing. A sentence here would be
	 * new user-facing copy, which this change cannot ship: the translation ledger
	 * pins the English catalogue's hash, so a new key invalidates the audited
	 * translations for all seven locales and needs a translator re-audit
	 * (agent review round 1, merge gate).
	 */
	return (
		<li
			aria-hidden="true"
			data-history-edge="start"
			className="mx-5 mt-2 h-px shrink-0 bg-hairline"
		/>
	);
};

/*
 * ONE DAY, AS A WINDOWED ITEM.
 *
 * The grouped list wraps a day in a containing block so its pill can stick
 * while that day scrolls past (`groupedByDay`). A WINDOWED strip cannot: a
 * group whose earlier rows are unmounted is only PART of its day, so a sticky
 * pill would surface mid-day under the wrong rows and then vanish. The divider
 * therefore becomes an ordinary item - same rule, same pill, same label, same
 * place in the flow - and scrolls with the rows it introduces.
 *
 * The date still FLOATS while a long day scrolls past; it is drawn once by
 * `DayPillOverlay`, which follows the viewport instead of a day group. Nothing
 * is lost from the grouped list's behaviour - only the mechanism changes.
 */
const DayHeading: FC<{
	item: Extract<ThreadItem, { type: "day" }>;
	locale: string;
	windowItem: string;
}> = ({ item, locale, windowItem }) => {
	const label = dayLabel(item, locale);
	return (
		<li
			data-window-item={windowItem}
			data-day-group=""
			aria-label={label ?? undefined}
			className="relative"
		>
			<span
				aria-hidden="true"
				data-day-rule=""
				className="absolute inset-x-5 top-5 h-px bg-hairline"
			/>
			<div
				aria-hidden="true"
				data-day-divider=""
				className="flex justify-center py-2"
			>
				{/* `dayLabel` answers a string for a day item; the null case is the
				    grouped list's pill-less group, which cannot reach this component. */}
				<DayPill label={label ?? ""} />
			</div>
		</li>
	);
};

/*
 * THE FLOATING DAY PILL, FOR THE WINDOWED STRIP.
 *
 * WHY NOT `sticky` PER DAY: a sticky element sticks inside its containing block,
 * and in a windowed list the only containing block available is the whole strip
 * (a day group would exist only around the rows that happen to be mounted). A
 * pill sticking to the strip would never hand over to the next day's divider - it
 * would sit there naming the wrong day.
 *
 * So the pill is ONE element, stuck to the viewport's top edge by the BROWSER -
 * `sticky top-2` on a zero-height row, which is the resting place the grouped
 * list's pill had. The browser positions it per frame, so it cannot trail the
 * content the way a React-positioned overlay does (agent review round 1, m2); the
 * only thing React decides is WHICH day it names (`stickyDayAt`), and a label one
 * frame late is a label nobody can see move.
 *
 * `h-0` means it takes no space in the flow; the pill overflows the empty box
 * downward, exactly where the sticky pill used to rest.
 */
const DayPillOverlay: FC<{
	day: Extract<ThreadItem, { type: "day" }>;
	locale: string;
}> = ({ day, locale }) => {
	const label = dayLabel(day, locale);
	if (label === null) return null;
	return (
		<li
			aria-hidden="true"
			data-day-pill-overlay=""
			className="pointer-events-none sticky top-2 z-[5] flex h-0 shrink-0 justify-center"
		>
			<DayPill label={label} />
		</li>
	);
};

/*
 * "N NEW MESSAGES" (visual refresh D10): a 1px accent rule above the first
 * unread message, ending in a solid accent label. Accent is spent here on
 * purpose - it is one of the screen's attention marks, beside the rail's
 * badges - and the pair (`onAccent` on `accent`, edge `accent` on `canvas`)
 * is a `CONTROLS` row. The label reuses the thread pane's translated count
 * ("3 new messages") rather than a new bare "New", so no new copy ships.
 */
const UnreadDivider: FC<{ count: number; windowItem?: string }> = ({
	count,
	windowItem,
}) => (
	<li
		data-unread-divider=""
		data-window-item={windowItem}
		className="relative mx-5 mt-3 mb-1 flex h-4 items-center"
	>
		<span aria-hidden="true" className="h-px flex-1 bg-accent" />
		<span className="shrink-0 rounded-xs bg-accent px-1.5 font-semibold text-[11px] text-on-accent leading-4">
			{t("ui.teamBridge.notify.count", { count })}
		</span>
	</li>
);

/*
 * Message rows while the read is in flight (visual refresh §3.2 States): the
 * row's own anatomy - a 36px circle, a name bar, a body bar - so the timeline
 * keeps its shape and nothing jumps when the read lands. A centred spinner in
 * an empty pane read as "nothing here". The label is the status a screen
 * reader hears.
 */
const SKELETON_ROWS = [
	["28%", "64%"],
	["22%", "48%"],
	["30%", "72%"],
	["18%", "40%"],
] as const;
export const TeamBridgeMessageSkeleton: FC<{ label: string }> = ({ label }) => (
	<output
		aria-label={label}
		className="mt-auto flex w-full flex-col gap-4 px-5 pt-4 pb-2"
	>
		{SKELETON_ROWS.map(([name, body]) => (
			<div key={`${name}:${body}`} aria-hidden="true" className="flex gap-3">
				<Skeleton className="size-9 shrink-0 rounded-full" />
				<div className="flex flex-1 flex-col gap-2 pt-1">
					<Skeleton className="h-3 rounded-xs" style={{ width: name }} />
					<Skeleton className="h-3 rounded-xs" style={{ width: body }} />
				</div>
			</div>
		))}
	</output>
);

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
	/* The thread row's facepile resolves repliers through the same lookup. */
	profileFor?: (
		sender: TeamBridgeMessage["sender"],
	) => TeamBridgeDirectoryMember | undefined;
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
	highlighted?: boolean;
	rowKey?: string;
	local?: boolean;
	delivery?: TeamBridgeRowPresentation["delivery"];
	windowItem?: string;
}> = ({ reactionContext, rowKey, local = false, ...props }) => {
	const reactable = Boolean(reactionContext) && props.message.body !== null;
	/* ONE COMPONENT TYPE AND ONE KEY FOR EVERY STATE OF A ROW (#1511). Keyed on the
	   ROW identity, not the message id: an optimistic row and its server
	   replacement must be one mounted subtree. A first message is drawn while its
	   draft has no conversation, so there is no reaction context yet; switching to
	   a reaction-capable component type when the created conversation becomes the
	   selection would unmount the very row the author is watching. The account
	   stays in the key, so an account switch still discards reaction state. A local
	   row has no server id to react to, so its reactions are disabled. */
	return (
		<ReactableMessageRow
			key={`${reactionContext?.accountId ?? props.accountId ?? ""}:${rowKey ?? props.message.id}`}
			reactionContext={
				reactable && reactionContext
					? local
						? { ...reactionContext, disabled: true }
						: reactionContext
					: undefined
			}
			{...props}
			rowKey={rowKey}
			onReply={local ? undefined : props.onReply}
		/>
	);
};

/* Withheld reactions are never drawn: the inert state below has no account or
   tenant to write with, and `disabled` makes its toggle a no-op. */
const INERT_REACTIONS = { accountId: "", tenantId: "", disabled: true };

const ReactableMessageRow: FC<
	Omit<MessageRowProps, "reactions"> & { reactionContext?: ReactionContext }
> = ({ reactionContext, ...props }) => {
	const reactions = useTeamBridgeReactionState({
		conversationId: props.message.conversation_id,
		messageId: props.message.id,
		...(reactionContext ?? INERT_REACTIONS),
		reactions: props.message.reactions,
	});
	return (
		<MessageRowView
			{...props}
			reactions={reactionContext ? reactions : undefined}
		/>
	);
};

type MessageRowProps = {
	message: TeamBridgeMessage;
	continuation: boolean;
	label: string | null;
	member?: TeamBridgeDirectoryMember;
	profileFor?: (
		sender: TeamBridgeMessage["sender"],
	) => TeamBridgeDirectoryMember | undefined;
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
	highlighted?: boolean;
	delivery?: TeamBridgeRowPresentation["delivery"];
	/** The row's stable identity, which survives an optimistic row's replacement. */
	rowKey?: string;
	/** Windowed strip only: tags the row so the measure pass can find its top. */
	windowItem?: string;
};

const MessageRowView: FC<MessageRowProps> = ({
	message,
	continuation,
	label: known,
	member,
	profileFor,
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
	highlighted = false,
	delivery,
	rowKey,
	windowItem,
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
			kind={agent ? "agent" : "human"}
			onMessage={messagePerson}
			canMessage={canMessage}
		>
			<button
				type="button"
				className="mt-0.5 block size-9 shrink-0 rounded-full text-start"
			>
				<TeamBridgeAvatar
					member={member}
					kind={agent ? "agent" : "human"}
					label={label}
					size={36}
					/* NO ink here: the plate owns it (`text-accent` for an agent,
					   `text-ink-muted` for a person), and a host that restated the
					   muted ink beat `text-accent` through tailwind-merge — one agent
					   with two inks in one frame (agent review round 2, F4). */
					className="size-9 text-[14px]"
					fallback={
						known === null ? (
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
			data-window-item={windowItem}
			data-message-target={highlighted || undefined}
			data-row-key={rowKey ?? message.id}
			data-delivery={delivery?.status}
			onAnimationEnd={arriving ? onArrivalEnd : undefined}
			className={cn(
				"group/message relative isolate flex w-full min-w-0 gap-3 px-5",
				/*
				 * THE HOVER IS AN INSET TINT, NOT A BAND (visual refresh D7). The old
				 * `row-hover` ran edge to edge of the pane and measured ΔE00 2.3-3.2 off
				 * it - the loudest thing on a resting screen. Discord's hover is a
				 * rounded box inset from the pane's edges, one ground step up. The box
				 * is a `::before` 8px in from each side (`inset-x-2`), BEHIND the row's
				 * content (`-z-10` inside the row's own `isolate` stacking context), so
				 * the row keeps its `px-5` and no text moves. The step is the pane's
				 * next ground: `surface` on the canvas timeline, `elevated` in the
				 * compact thread pane whose own ground is `surface`. Colour only.
				 */
				"before:pointer-events-none before:absolute before:inset-x-2 before:inset-y-0 before:-z-10 before:rounded-sm before:transition-colors before:duration-fast before:ease-out-quart",
				/*
				 * NO MENTION ROW TREATMENT (operator, 2026-11-04). A row that
				 * @-mentions the reader once wore an `accent-wash` box and a 2px
				 * leading accent bar (contract C3); the operator rejected both as
				 * visual noise. The inline token's viewer ink (#1656) is what says
				 * "you", so a mention row rests and hovers exactly like any other.
				 */
				density === "compact"
					? "hover:before:bg-row-hover-elevated focus-within:before:bg-row-hover-elevated"
					: "hover:before:bg-row-hover-surface focus-within:before:bg-row-hover-surface",
				// Transform/opacity only: the row reserves its final layout box
				// immediately, so arrival cannot move the scroll geometry.
				arriving && "lo-team-bridge-arrival",
				highlighted && "lo-team-bridge-target",
				/* Groups breathe, runs stay tight (Slack/Discord rhythm): 12px above a
				   sender's first message, 1px between their continuations. */
				continuation ? "py-px" : "mt-3 pt-1 pb-0.5",
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
								/* ONE LINE, END-ALIGNED, OVERHANGING THE START (UX round 1, U1).
								   "10:02 AM" is ~52px at 11px and the gutter is 36px, so a
								   wrapping clock made every one-line continuation 39px tall and
								   read "10:02 / AM". `whitespace-nowrap` plus `justify-end` on a
								   flex box lets it run leftward into the row's 20px start
								   padding instead (36 + 20 = 56px of room, and the gap to the
								   body stays 12px), so a continuation is one 24px line. 11px
								   (`text-meta-sm`) is the gutter's own register: it shows only
								   under the pointer, beside the header row's 12px clock.
								   Dropping the meridiem is not locale-safe, so it stays. */
								className="flex justify-end whitespace-nowrap pt-0.5 text-meta-sm text-ink-dim leading-5 tabular-nums opacity-0 group-hover/message:opacity-100"
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
									/* ROUND, ON THE IDENTITY WASHES - the same plate
									   `TeamBridgeAvatar` draws, for a sender the directory
									   cannot picture (visual refresh D4, contract C2). The
									   square `media-surface` plate read as a black hole beside
									   every name (L* 2.4 in the operator's radient frame).
									   One borderless wash for every identity, >= ΔE00 3.0 off
									   each ground it sits on (design round 1, D1); kind reads
									   from the ink - accent Bot vs accent-alt initial. The
									   pairs are rows in `scripts/contrast-contract.mjs`. */
									"mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-[14px]",
									"bg-accent-alt-wash",
									agent
										? "text-accent"
										: known === null
											? "text-ink-muted"
											: "text-accent-alt",
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
				{/* An overlay positioned on the row (`<li>`), not the column; see
				    `team-bridge-message-toolbar.tsx` for why one toolbar exists. */}
				<TeamBridgeMessageToolbar
					reactions={reactions}
					onReply={canReply ? () => onReply(message) : undefined}
					forceVisible={forceToolbar}
				/>
				{!continuation && (
					<div className="flex items-baseline gap-2 leading-5">
						{member ? (
							<TeamBridgeProfileCard
								member={member}
								label={label}
								kind={agent ? "agent" : "human"}
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
								className="shrink-0 text-meta text-ink-dim tabular-nums"
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
					/*
					 * PENDING IS A COLOUR, NOT A FADE (design round 1, D3). The clock at
					 * `opacity-50` measured 2.15:1 light / 2.52:1 dark - under the floor for
					 * 11-12px text - and `docs/branding.md` says a state changes ink, never
					 * opacity. The BODY carries it instead, in `ink-muted` (8.67:1 light,
					 * 7.85:1 dark), which also survives a continuation row where the clock
					 * only shows on hover. It returns to `ink` in one transition on confirm.
					 */
					/*
					 * THE INK TRAVELS THROUGH `--md-ink`, NOT A `text-*` UTILITY (design
					 * round 2, D3). `.lo-markdown { color: var(--md-ink, var(--lo-ink)) }`
					 * in `markdown.css` is UNLAYERED, and Tailwind's utilities live in
					 * `@layer utilities` - so an unlayered rule wins no matter what order the
					 * two are in. `text-ink-muted` computed as full `--lo-ink` on a live
					 * pending row (measured `rgb(56,58,66)`), which is why the state was
					 * invisible. The value is driven on the row instead, scoped to it: the
					 * stylesheet keeps styling every other markdown surface in the app.
					 */
					<InlineDataBody
						body={message.body}
						renderText={(text) => (
							<TeamBridgeMarkdown
								/* `transition-colors` is restored rather than the comment rewritten: the
						   comment describes a settle, and no rule on `.lo-markdown` competes with a
						   TRANSITION (only its `color` is unlayered). Design round 3 measured the
						   step at 1.19:1 light / 1.63:1 dark - quiet enough that the settle must
						   not read as motion, which is what a 150 ms colour fade gives. */
								className="team-bridge-message-body text-[14px] transition-colors duration-fast"
								style={{
									...(delivery?.status === "pending"
										? { "--md-ink": "var(--lo-ink-muted)" }
										: {}),
								}}
								mentions={mentionRuns}
							>
								{text}
							</TeamBridgeMarkdown>
						)}
					/>
				)}
				{/* THE STATE IN WORDS, for a reader who cannot see the ink: the row is
				    otherwise only quieter, and a screen reader announces status changes when
				    they are live. One per unconfirmed row, not per message. */}
				{delivery && (
					<p className="sr-only" aria-live="polite">
						{delivery.status === "failed"
							? t("ui.chat.canonical.send_failure.generic")
							: t("ui.agents.config.state.sending")}
					</p>
				)}
				<TeamBridgeDeliveryAnnotation message={message} />
				{/* Link previews read the same body the prose above renders, and the
				    account this subtree was rendered under as their receipt - the value
				    the attachment route below already carries, never a default. A null
				    body is a withheld message, and nothing withheld is previewed. */}
				{message.body !== null && (
					<TeamBridgeMessageLinkPreviews
						body={message.body}
						expectedAccountId={accountId}
					/>
				)}
				{/* Images and files come ONLY from the structured lists, never from
				    the body. A file-less message keeps the pre-S3b condition. */}
				{((message.attachments?.length ?? 0) > 0 ||
					(message.files?.length ?? 0) > 0 ||
					(message.file_count ?? 0) > 0) && (
					<TeamBridgeMessageAttachments
						key={JSON.stringify([
							accountId,
							tenantId,
							message.conversation_id,
							message.id,
						])}
						message={message}
						tenantId={tenantId ?? null}
						density={density}
						accountId={accountId}
					/>
				)}
				{decoration?.attachments}
				{reactions && <TeamBridgeReactionChips state={reactions} />}
				{/* A FAILED SEND STAYS WHERE IT WAS TYPED (operator ask: "the text must not
				    vanish with no trace"). Retry re-sends under the SAME client_ref, so a
				    request that landed with its answer lost is deduplicated by the hub;
				    Edit puts the text back in the box and drops the row. The copy is the
				    app's existing send-failure sentence and actions, not new strings. */}
				{delivery?.status === "failed" && (
					<div
						role="alert"
						data-delivery-failed=""
						className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
					>
						<span className="text-danger">
							{t("ui.chat.canonical.send_failure.generic")}
						</span>
						{delivery.onRetry && (
							<button
								type="button"
								onClick={delivery.onRetry}
								/* -mx-1 px-1 py-1: a 24px-tall target around a 12px glyph, with the
								   ink where it was (design round 1, D4). These are the only recovery
								   controls for a lost message. */
								className="-mx-1 rounded-sm px-1 py-1 font-medium text-accent hover:bg-row-hover hover:underline"
							>
								{t("ui.common.actions.retry")}
							</button>
						)}
						{delivery.onEdit && (
							<button
								type="button"
								onClick={delivery.onEdit}
								className="-mx-1 rounded-sm px-1 py-1 font-medium text-ink-muted hover:bg-row-hover hover:text-ink hover:underline"
							>
								{t("ui.chat.canonical.transcript.edit")}
							</button>
						)}
					</div>
				)}
				{canReply && summary.count > 0 && (
					<TeamBridgeThreadRow
						message={message}
						onOpen={() => onReply(message)}
						profileFor={profileFor}
						locale={locale}
					/>
				)}
				{decoration?.after}
			</div>
		</li>
	);
};
