import { Button } from "@shared/components/ui/button";
import { formatDate, formatTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot, UserRound } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import type { FC } from "react";
import type {
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
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
import type { TeamBridgeLocalRowPresentation } from "./team-bridge-send-presentation";
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

export const TeamBridgeMessageList: FC<{
	messages: readonly TeamBridgeMessage[];
	/** Journal metadata keyed by the message id currently projected in this list. */
	sendRows?: ReadonlyMap<string, TeamBridgeLocalRowPresentation>;
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
}> = ({
	messages,
	sendRows,
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
}) => {
	const locale = useI18nLocale();
	// Local seqs reserve projection positions, not server arrival watermarks.
	// Observing one would hide a peer arrival whose real seq is below it; even
	// confirmed journal rows remain excluded because they never animate here.
	const arrivalMessages = useMemo(
		() =>
			sendRows
				? messages.filter((message) => !sendRows.has(message.id))
				: messages,
		[messages, sendRows],
	);
	const arriving = useArrivingRows(
		arrivalKey,
		arrivalMessages,
		arrivalsEnabled,
	);
	const items = threadItems(messages, new Date(), sendRows !== undefined);
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
			{items.map((item) =>
				item.type === "day" ? (
					<DayDivider key={`day:${item.key}`} item={item} locale={locale} />
				) : (
					<MessageRow
						key={sendRows?.get(item.message.id)?.clientRef ?? item.message.id}
						message={item.message}
						sendRow={sendRows?.get(item.message.id)}
						// Keep the header through confirmation so status never adds a
						// new line to a continuation or removes one at the server swap.
						continuation={
							sendRows?.has(item.message.id) ? false : item.continuation
						}
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
						arriving={
							!sendRows?.has(item.message.id) && arriving.has(item.message)
						}
						onArrivalEnd={arriving.end}
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

/**
 * THE FAILED STATE, DRAWN THE WAY A PERSON READS IT (design round 1, D1/D2/D3).
 *
 * - The status WORD carries the failure: `Not sent` is painted in `danger`, the
 *   colour its own translator-facing context note promises, instead of the muted
 *   family it shares with the timestamp one gap away.
 * - `Retry` is primary on purpose: it is the action almost everyone wants, and a
 *   filled control is the only thing that says so. `Return to draft` is a quiet
 *   text action, and `Discard` - which destroys the attempt irreversibly - drops to
 *   the danger tone with no primary weight. All three are real buttons; none of
 *   them pretends to be a link.
 * - The group sits on its OWN ground. The row steps to `rowHover` under the
 *   pointer, and accent/danger text on that step measures 4.49:1 in `tokyoNight`
 *   and 4.46:1 in `neonNoir` - just under the AA floor, at 12px, with no
 *   large-text exemption. A `canvas` strip keeps the text on a ground the
 *   contrast contract actually asserts, so hovering the row can never lower it.
 *   (The contract's own gap - `rowHover` missing from `TONE_GROUNDS` - is
 *   pre-existing and wider than this change; it is reported on the PR.)
 *
 * `min-h-6` is 24px, exactly the WCAG 2.2 2.5.8 target floor: the controls have no
 * headroom, so any change to their padding or size must raise this too. It applies
 * to the FAILED strip only - the pending strip has no controls, and a 24px pending
 * header against a 21.7px confirmed one moved the body at the swap.
 */
const SendStatus: FC<{ row: TeamBridgeLocalRowPresentation }> = ({ row }) => (
	<span
		className={cn(
			"inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-sm bg-canvas px-1 text-[12px]",
			/* The 24px target floor belongs to the CONTROLS, so only the failed
			 * strip carries it (capture round, frame 7). On a pending row it made
			 * the header 24px against a confirmed row's 21.7px, so the body jumped
			 * 2.3px at the swap - D7's reserved height, measured. */
			row.state === "failed" && "min-h-6",
		)}
	>
		<output
			className={cn("text-ink-muted", row.state === "failed" && "text-danger")}
		>
			{row.state === "failed"
				? t("ui.teamBridge.message.failed")
				: row.state === "pending"
					? t("ui.teamBridge.message.sending")
					: null}
		</output>
		{/* An image this attempt had to abandon: the hub forgot its staged id and
		 * the draft held no bytes to upload again, so Retry sends the text. The
		 * existing expired-image copy says so without a new catalogue key. */}
		{row.state === "failed" && (row.droppedAttachments ?? 0) > 0 && (
			<span className="text-ink-muted">
				{t("ui.teamBridge.attachments.expired")}
			</span>
		)}
		{/* THE CONTROLS' LABELS WRAP, AND BREAK INSIDE A WORD AT THE FLOOR (design
		 * round 3): `shrink` + `whitespace-normal` let a label wrap at spaces, but
		 * a single long word ("Abandonner" in fr) still cannot fit an 84px column
		 * and pushed the control ~6.5px past it (D18) - `min-w-0` lets the button
		 * narrow below its text and `break-words` breaks the word as a last
		 * resort. A wrapped label is CENTRED (D23): `text-start` left a filled
		 * Retry's short last line hugging one edge, which read as lopsided in
		 * `ur`; centred lines read as one label in either direction. */}
		{row.state === "failed" && row.onRetry && (
			<Button
				variant="primary"
				className="h-auto min-h-6 min-w-0 shrink whitespace-normal break-words px-2 text-center text-[12px]"
				onClick={row.onRetry}
			>
				{t("ui.common.actions.retry")}
			</Button>
		)}
		{row.state === "failed" && row.onReturnToDraft && (
			<Button
				variant="ghost"
				className="h-auto min-h-6 min-w-0 shrink whitespace-normal break-words px-2 text-center text-[12px] text-ink-muted hover:text-ink"
				onClick={row.onReturnToDraft}
			>
				{t("ui.teamBridge.message.return_to_draft")}
			</Button>
		)}
		{row.state === "failed" && row.onDiscard && (
			<Button
				variant="ghost"
				/* Every state stays red (design round 2, D14): `ghost` paints its hover
				 * and press on the ACCENT wash, so a destructive control drew a red label
				 * on the brand hue. The danger wash is its own ground - danger on
				 * danger-wash measures 4.524:1 at worst (everforestLight). */
				className="h-auto min-h-6 min-w-0 shrink whitespace-normal break-words px-2 text-center text-[12px] text-danger hover:bg-danger-wash hover:text-danger active:bg-danger-wash active:text-danger"
				onClick={row.onDiscard}
			>
				{t("ui.teamBridge.message.discard")}
			</Button>
		)}
	</span>
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
	sendRow?: TeamBridgeLocalRowPresentation;
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
}> = ({ reactionContext, ...props }) =>
	/*
	 * THE WRAPPER MOUNTS ONLY WITH A REAL REACTION CONTEXT (thread-gate suite).
	 *
	 * A journal row used to reserve it with an inert placeholder so the ACK could
	 * not remount the image tile. The gate suite is right and I was wrong: while
	 * the reaction surface is held, "a placeholder context" still means reaction
	 * state is mounted for a build the runtime cannot serve, and the suite's name
	 * is a claim about what mounts. So the reservation is gone. When reactions
	 * ship, a journal row's ACK may remount this subtree; that is the moment to
	 * re-measure it, with the surface on.
	 */
	reactionContext && props.message.body !== null ? (
		<ReactableMessageRow
			key={`${reactionContext.accountId}:${props.sendRow?.clientRef ?? props.message.id}`}
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
		disabled:
			reactionContext.disabled ||
			(props.sendRow !== undefined && props.sendRow.state !== "confirmed"),
	});
	// Keep this wrapper mounted across the ACK; switching component types at
	// confirmation would remount the image subtree even with a stable row key.
	return (
		<MessageRowView
			{...props}
			reactions={
				!props.sendRow || props.sendRow.state === "confirmed"
					? reactions
					: undefined
			}
		/>
	);
};

type MessageRowProps = {
	message: TeamBridgeMessage;
	sendRow?: TeamBridgeLocalRowPresentation;
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
};

const MessageRowView: FC<MessageRowProps> = ({
	message,
	sendRow,
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
}) => {
	const summary = threadSummary(message);
	/* One-level threads: only a timeline root can open a thread - and none can
	   while the thread surface is held. `canReply` is therefore the ONE term the
	   toolbar button and the "N replies" summary both read, so the affordance
	   does not render rather than rendering inert. */
	const canReply =
		TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD &&
		(!sendRow || sendRow.state === "confirmed") &&
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
			data-send-state={sendRow?.state}
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
					<div
						className={cn(
							"flex items-baseline gap-2",
							/* A FAILED row's header may wrap (design round 2, D13, measured in
							 * the capture round): at a 390px thread the strip took the row and
							 * the sender's name truncated to one letter, and at the 172px column
							 * floor a 140px control sat in an 84px column. Wrapping puts the
							 * strip on its own line under the name and time. Only failed rows:
							 * on any other row wrapping would break a long name onto its own
							 * line instead of truncating it. */
							sendRow?.state === "failed" && "flex-wrap gap-y-1",
						)}
					>
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
						{/* NOTHING FOR A CONFIRMED ROW (capture round, frame 7). A confirmed
						    row keeps its journal entry through the swap, and the strip used
						    to render for it as an EMPTY 8x24 canvas plate. An empty
						    inline-flex box has no text baseline, so `items-baseline` aligned
						    it by its bottom edge and the header grew 24 -> 28px: the body and
						    the image moved down 4px at the exact moment of the swap - the
						    jitter this change exists to remove - and a blank pill stayed
						    beside the time. Pending and failed are the only states with
						    anything to say. */}
						{sendRow && sendRow.state !== "confirmed" && (
							<SendStatus row={sendRow} />
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
						accountId={accountId}
						localUrls={sendRow?.previewUrls}
					/>
				)}
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
			</div>
		</li>
	);
};
