import { Spinner } from "@shared/components/common/spinner";
import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { Badge } from "@shared/components/ui/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { formatRelativeTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	Archive,
	AtSign,
	BellOff,
	Bot,
	Hash,
	MoreHorizontal,
	Pencil,
	Plus,
	Users,
} from "lucide-react";
import type { FC, ReactNode } from "react";
import { useId } from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
} from "../../../../shared/team-bridge-contract";
import { rowCurrent } from "../chat/components/chat-sidebar";
import {
	type TeamBridgeChiefOfStaff,
	type TeamBridgeRecipient,
	type TeamBridgeTarget,
	conversationTitle,
	isPreviewConversation,
	personDisplayLabel,
	personRowState,
	showsMutedGlyph,
} from "./team-bridge-model";

import {
	TeamBridgeAvatar,
	TeamBridgeProfileCard,
} from "./team-bridge-profile-card";

/**
 * The single-organization rail, Slack's sidebar in Local Operator's chrome.
 *
 * FIVE SECTIONS, ALWAYS DRAWN (operator review, 2026-10-21): Channels, Groups,
 * People, Chiefs of staff. A section with nothing in it keeps its header and
 * says so in one quiet line, and that line IS the create action ("No channels
 * yet. Create one"). A missing header would hide where channels live from a
 * new organization, which is exactly when the reader needs to learn the rail.
 *
 * A PERSON'S ROW IS THEIR DM. There is no separate "@ Ben" conversation row
 * beside Ben's People row: selecting Ben highlights Ben, the thread pane shows
 * the DM (or an empty draft addressed to him), and his unread count sits on
 * his row. The same holds for a chief of staff. A DM no directory row can
 * paint (the person left the organization) is still listed under Direct
 * messages so its history stays reachable.
 *
 * HOVER MENU. Each reachable row reveals a "…" on hover/focus with "Start a
 * group conversation", which opens the compose bar seeded with that row's
 * recipient. A right-click is deliberately NOT bound: the desktop shell owns
 * the native context menu, and a second one would fight it.
 *
 * Geometry is the docked sidebar's (30px rows, 20px marks, 13px labels) and
 * every colour is a token role, so no section draws its own frame.
 */

export const RAIL_ROW =
	"group/row relative flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-start text-[13px] transition-colors duration-fast ease-out-quart";

/**
 * THE ORGANIZATION SUBHEADER OF THE UNION RAIL.
 *
 * When one account spans several organizations, People, Chiefs of staff and the
 * chief-of-staff audit group their rows under the organization each row would
 * act in. The rows themselves carry NO organization caption in that case: the
 * organization is stated ONCE, at the nearest enclosing level, and a caption
 * under a header would repeat it and cost 8px of row height. The one invariant
 * is therefore "caption iff no enclosing group header".
 *
 * TWO VOICES, ONE SIZE. The section header is chrome - `text-meta`, medium,
 * `ink-dim`, tracked. This is a proper noun - `text-xs` (the same 12px),
 * normal weight, `ink-muted`, untracked - so the eye reads a name inside a
 * section rather than a second section. It is the treatment the auth/archive
 * panels already ship for their grouped rows, which is why it is reused rather
 * than retuned here.
 *
 * `inset` is the parent's horizontal inset, and it is the reason this is not a
 * copied `px-3`: a `RailSection` already pads its children by `px-1` and its
 * header by `ps-2`, so a group header inside it must use `ps-2` (12px from the
 * rail edge, on the section header's axis) rather than `px-3` (16px, visibly
 * indented). A section that carries no inset of its own passes `bare`.
 */
export const RailGroupHeader: FC<{
	id: string;
	name: string;
	/** "rail" = inside a RailSection (which carries px-1); "bare" = no inset. */
	inset?: "rail" | "bare";
}> = ({ id, name, inset = "rail" }) => (
	<h3
		id={id}
		className={cn(
			// Truncation, never wrapping: a wrapped name breaks the 4px rhythm.
			"truncate py-1 text-xs font-normal text-ink-muted",
			inset === "bare" ? "px-3" : "ps-2 pe-1",
		)}
	>
		{name}
	</h3>
);

/**
 * How a rail row hosts its profile card (operator report 2026-10-26: clicking a
 * person showed the card instead of opening the conversation). A row's click is
 * its conversation, so the card never opens on click or focus. A pointer resting
 * on the row for a deliberate ~1.2 s dwell opens it, which a pass across the rail
 * on the way to a row never reaches. The avatar opens it at the message list's
 * usual 400 ms, because pointing at a face is asking about the person.
 * Keyboard readers use Shift+F10 or the context-menu key; see
 * `TeamBridgeProfileCard`.
 */
const RAIL_CARD = {
	openDelayMs: 1200,
	fastOpenDelayMs: 400,
	toggleOnClick: false,
	openOnFocus: false,
} as const;

/**
 * The unread pill every channel, group, person and chief row shares: the
 * sidebar's shared accent `AttentionBadge` (operator, 2026-10-28), because an
 * unread conversation is a request for the reader's attention, not a total.
 */
const Unread: FC<{ count: number; yieldsToMenu?: boolean }> = ({
	count,
	yieldsToMenu = false,
}) =>
	count > 0 ? (
		<AttentionBadge
			count={count}
			/*
			 * ONE BADGE COLUMN (design round 1, D4). Person and chief rows used to
			 * reserve `pr-8` for the hover "…", which pushed their counts 24px left
			 * of every channel's. Now every row ends at the same edge, and on a row
			 * that has a menu the badge yields that slot while the row is hovered or
			 * focused, Slack's pattern: the count and the menu never sit side by side.
			 */
			className={cn(
				"shrink-0",
				yieldsToMenu &&
					"group-focus-within/row:invisible group-hover/row:invisible",
			)}
			aria-label={t("ui.teamBridge.unread.count", { count })}
		/>
	) : null;

export const RailSection: FC<{
	id: string;
	title: string;
	children?: ReactNode;
	/** One quiet line when the section is empty; omitted when it has rows. */
	empty?: { text: string; onCreate?: () => void };
	/**
	 * A "+" on the header, Slack's "Add channels": the way to create one when
	 * the section is NOT empty (review round 1, R1-3 — once the built-ins exist
	 * the empty line is gone, and with it the only route to a new channel).
	 * Revealed on hover/focus of the header so a resting rail stays quiet.
	 */
	add?: { label: string; onAdd: () => void };
	/**
	 * The section header's "…" (Slack's channel-section menu). It holds the
	 * section's secondary destinations, today "Archived channels". Revealed like
	 * the "+" so a resting rail stays quiet, and it stays visible while open.
	 */
	menu?: {
		label: string;
		items: ReadonlyArray<{
			key: string;
			label: string;
			icon?: ReactNode;
			onSelect: () => void;
		}>;
	};
}> = ({ id, title, children, empty, add, menu }) => {
	useI18nLocale();
	return (
		<section aria-labelledby={id} className="px-1 pb-1">
			<div className="group/section flex items-center pt-3 pe-1 pb-1 ps-2">
				<h2
					id={id}
					className="min-w-0 flex-1 truncate font-medium text-meta text-ink-dim tracking-wide"
				>
					{title}
				</h2>
				{menu && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-label={menu.label}
								title={menu.label}
								className="flex size-5 items-center justify-center rounded-sm text-ink-dim opacity-0 transition-opacity duration-fast hover:bg-row-hover hover:text-ink focus-visible:opacity-100 group-hover/section:opacity-100 data-[state=open]:opacity-100"
							>
								<MoreHorizontal size={13} aria-hidden="true" />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							side="right"
							/* Borderless chrome, as the row menu: the menu rises on its shadow. */
							className="border-transparent shadow-lg"
						>
							{menu.items.map((item) => (
								<DropdownMenuItem key={item.key} onSelect={item.onSelect}>
									{item.icon}
									{item.label}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				{add && (
					<button
						type="button"
						onClick={add.onAdd}
						aria-label={add.label}
						title={add.label}
						className="flex size-5 items-center justify-center rounded-sm text-ink-dim opacity-0 transition-opacity duration-fast hover:bg-row-hover hover:text-ink focus-visible:opacity-100 group-hover/section:opacity-100"
					>
						<Plus size={13} aria-hidden="true" />
					</button>
				)}
			</div>
			{empty ? (
				empty.onCreate ? (
					<button
						type="button"
						onClick={empty.onCreate}
						className="w-full rounded-md px-2 py-1 text-start text-[12px] text-ink-dim leading-snug transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink-muted"
					>
						{empty.text}
					</button>
				) : (
					<p className="px-2 py-1 text-[12px] text-ink-dim leading-snug">
						{empty.text}
					</p>
				)
			) : (
				children
			)}
		</section>
	);
};

/**
 * Every conversation list, including read-only owner audit, uses these marks.
 * Unknown additive kinds stay channels rather than gaining a second visual
 * vocabulary; the rail's existing conservative fallback already made that call.
 */
export const ConversationKindIcon: FC<{ kind: string }> = ({ kind }) => {
	const Icon = kind === "group" ? Users : kind === "dm" ? AtSign : Hash;
	return <Icon size={15} aria-hidden="true" className="shrink-0" />;
};

/** A channel or group row (and an orphaned DM under Direct messages). */
export const ConversationRailRow: FC<{
	hasDraft?: boolean;
	conversation: TeamBridgeConversation;
	selected: boolean;
	selfAccountId?: string;
	title?: string;
	/**
	 * The merged "All organizations" view names each row's organization on a
	 * second line; a single-organization rail passes nothing and stays 30px.
	 */
	organizationName?: string;
	onSelect: () => void;
	/**
	 * Offered only when the caller may archive this channel (the page decides from
	 * the server's `can_administer`). Opens the confirm dialog; the row itself
	 * never archives.
	 */
	onArchive?: () => void;
}> = ({
	hasDraft = false,
	conversation,
	selected,
	selfAccountId,
	title,
	organizationName,
	onSelect,
	onArchive,
}) => {
	const locale = useI18nLocale();
	const name =
		title ??
		conversationTitle(conversation, selfAccountId) ??
		t("ui.teamBridge.list.untitled");
	const preview = isPreviewConversation(conversation);
	const unread = conversation.unread_count;
	const lastActive = lastActiveTooltip(conversation.last_message_at, locale);
	return (
		<li className="group/row relative">
			<button
				type="button"
				onClick={onSelect}
				/* The row carries no visible time (it clipped at narrow widths, #1293);
				   the relative+absolute pair lives in the tooltip and the header. */
				title={lastActive || undefined}
				aria-current={selected ? "page" : undefined}
				data-conversation-id={conversation.id}
				data-conversation-builtin={conversation.builtin}
				className={cn(
					RAIL_ROW,
					organizationName && "h-auto min-h-[38px] py-1",
					selected
						? rowCurrent
						: unread > 0
							? "font-medium text-ink hover:bg-row-hover"
							: "text-ink-muted hover:bg-row-hover hover:text-ink",
				)}
			>
				<ConversationKindIcon kind={conversation.kind} />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate">{name}</span>
					{organizationName && (
						<span className="truncate font-normal text-meta-sm text-ink-dim">
							{organizationName}
						</span>
					)}
				</span>
				{preview && (
					<Badge variant="attentionQuiet" className="shrink-0">
						{t("ui.teamBridge.preview.chip")}
					</Badge>
				)}
				{showsMutedGlyph(conversation) && (
					<span
						className="shrink-0 text-ink-dim"
						title={t("ui.teamBridge.notify.muted")}
					>
						<BellOff size={12} aria-hidden="true" />
						<span className="sr-only">{t("ui.teamBridge.notify.muted")}</span>
					</span>
				)}
				{hasDraft && (
					<span
						title={t("ui.teamBridge.drafts.indicator")}
						className="shrink-0 text-ink-dim"
					>
						<Pencil size={12} aria-hidden="true" />
						<span className="sr-only">
							{t("ui.teamBridge.drafts.indicator")}
						</span>
					</span>
				)}
				<Unread count={unread} yieldsToMenu={Boolean(onArchive)} />
			</button>
			{onArchive && <ChannelRowMenu name={name} onArchive={onArchive} />}
		</li>
	);
};

/**
 * The "…" on a channel row you may archive. Same slot, reveal and chrome as the
 * person row's menu, so the rail has one hover affordance. A right-click is not
 * bound (the desktop shell owns the native context menu), which is why the
 * request for "right-click/hover" is met by the hover/focus form only.
 */
const ChannelRowMenu: FC<{ name: string; onArchive: () => void }> = ({
	name,
	onArchive,
}) => (
	<DropdownMenu>
		<DropdownMenuTrigger asChild>
			<button
				type="button"
				aria-label={t("ui.teamBridge.row.menu", { name })}
				className="absolute end-1.5 top-[3px] flex size-6 items-center justify-center rounded-sm text-ink-dim opacity-0 transition-opacity duration-fast hover:bg-row-hover hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100"
			>
				<MoreHorizontal size={14} aria-hidden="true" />
			</button>
		</DropdownMenuTrigger>
		<DropdownMenuContent
			align="start"
			side="right"
			className="border-transparent shadow-lg"
		>
			<DropdownMenuItem onSelect={onArchive}>
				<Archive size={14} aria-hidden="true" />
				{t("ui.teamBridge.archive.menu.archive")}
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
);

/**
 * The "…" on a reachable row. It sits in the row's trailing slot, revealed by
 * hover or keyboard focus within the row, and never shifts the label.
 */
const RowMenu: FC<{ label: string; onStartGroup: () => void }> = ({
	label,
	onStartGroup,
}) => (
	<DropdownMenu>
		<DropdownMenuTrigger asChild>
			<button
				type="button"
				aria-label={t("ui.teamBridge.row.menu", { name: label })}
				className="absolute end-1.5 flex size-6 items-center justify-center rounded-sm text-ink-dim opacity-0 transition-opacity duration-fast hover:bg-row-hover hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100"
			>
				<MoreHorizontal size={14} aria-hidden="true" />
			</button>
		</DropdownMenuTrigger>
		<DropdownMenuContent
			align="start"
			side="right"
			/* Borderless chrome (design round 1, D3): the menu rises on its shadow. */
			className="border-transparent shadow-lg"
		>
			<DropdownMenuItem onSelect={onStartGroup}>
				<Users size={14} aria-hidden="true" />
				{t("ui.teamBridge.row.start_group")}
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
);

/**
 * One person. Clicking selects the person (their DM, or an empty draft to
 * them) at once; nothing is created until the first message is sent. The
 * profile card is a long hover, an avatar hover or Shift+F10 away (`RAIL_CARD`).
 * Inert rows (self, bridge off, identity loading) select nothing but keep the
 * same card affordances, so who someone is stays reachable.
 *
 * A person whose bridge is off is still drawn, dimmed and `aria-disabled`,
 * with the reason as its description: the roster says who is potentially
 * reachable, and the cue says what they need to do.
 */
export const PersonRailRow: FC<{
	hasDraft?: boolean;
	member: TeamBridgeDirectoryMember;
	selfAccountId?: string;
	identityKnown: boolean;
	selected: boolean;
	dm: TeamBridgeConversation | null;
	readOnly: boolean;
	onSelect: () => void;
	onStartGroup: (recipient: TeamBridgeRecipient) => void;
}> = ({
	hasDraft = false,
	member,
	selfAccountId,
	identityKnown,
	selected,
	dm,
	readOnly,
	onSelect,
	onStartGroup,
}) => {
	useI18nLocale();
	const cueId = useId();
	const label = personDisplayLabel(member);
	const state = identityKnown
		? personRowState(member, selfAccountId)
		: "unknown";
	const avatar = (
		<TeamBridgeAvatar
			member={member}
			label={label}
			size={20}
			selected={selected}
			className="rounded-[5px] text-[10px]"
		/>
	);

	if (state === "self") {
		return (
			<li>
				<TeamBridgeProfileCard
					member={member}
					label={label}
					onMessage={onSelect}
					canMessage={false}
					{...RAIL_CARD}
				>
					<button
						type="button"
						className={cn(RAIL_ROW, "cursor-default text-ink-muted")}
					>
						{avatar}
						<span className="min-w-0 flex-1 truncate">
							{t("ui.teamBridge.people.self_named", { name: label })}
						</span>
					</button>
				</TeamBridgeProfileCard>
			</li>
		);
	}

	/*
	 * Unreachable rows stay readable, focusable statements. An existing DM with
	 * someone who later turned the bridge off is still history the reader can
	 * open, so only a person with NO thread is inert.
	 */
	const inertCue =
		state === "unknown"
			? t("ui.teamBridge.people.identity_loading")
			: state === "unavailable" && !dm
				? t("ui.teamBridge.people.bridge_off")
				: null;
	if (inertCue) {
		return (
			<li>
				<TeamBridgeProfileCard
					member={member}
					label={label}
					onMessage={onSelect}
					canMessage={
						!readOnly && state !== "unavailable" && state !== "unknown"
					}
					{...RAIL_CARD}
				>
					<button
						type="button"
						aria-disabled="true"
						aria-describedby={cueId}
						/*
						 * THE REASON IS ON THE ROW, NOT BEHIND IT (design round 1, D1).
						 * A sighted reader got only a tooltip, and the dimmed name alone
						 * read as "broken" rather than "not yet". The cue is a second
						 * line at `ink-dim` (the muted step that still clears contrast),
						 * the name keeps `ink-muted`, and `aria-describedby` points at the
						 * same visible text so both readers get one sentence.
						 */
						className={cn(
							RAIL_ROW,
							"h-auto min-h-[30px] cursor-default py-1 text-ink-muted",
						)}
					>
						<span className="opacity-60">{avatar}</span>
						<span className="flex min-w-0 flex-1 flex-col text-start">
							<span className="truncate">{label}</span>
							<span id={cueId} className="truncate text-meta-sm text-ink-dim">
								{inertCue}
							</span>
						</span>
					</button>
				</TeamBridgeProfileCard>
			</li>
		);
	}

	const unread = dm?.unread_count ?? 0;
	const canStartGroup = !readOnly && state !== "unavailable";
	return (
		<li className="group/row relative flex items-center">
			<TeamBridgeProfileCard
				member={member}
				label={label}
				onMessage={onSelect}
				canMessage={
					(Boolean(dm) || !readOnly) &&
					state !== "unavailable" &&
					state !== "unknown"
				}
				{...RAIL_CARD}
			>
				<button
					type="button"
					onClick={onSelect}
					aria-current={selected ? "page" : undefined}
					data-team-bridge-person={member.account_id}
					aria-label={t("ui.teamBridge.people.message", { name: label })}
					className={cn(
						RAIL_ROW,
						selected
							? rowCurrent
							: unread > 0
								? "font-medium text-ink hover:bg-row-hover"
								: "text-ink-muted hover:bg-row-hover hover:text-ink",
					)}
				>
					{avatar}
					<span className="min-w-0 flex-1 truncate">{label}</span>
					{state === "paused" && (
						<span className="shrink-0 text-meta-sm text-ink-dim">
							{t("ui.teamBridge.people.paused")}
						</span>
					)}
					{hasDraft && (
						<span
							title={t("ui.teamBridge.drafts.indicator")}
							className="shrink-0 text-ink-dim"
						>
							<Pencil size={12} aria-hidden="true" />
							<span className="sr-only">
								{t("ui.teamBridge.drafts.indicator")}
							</span>
						</span>
					)}
					<Unread count={unread} yieldsToMenu />
				</button>
			</TeamBridgeProfileCard>
			{canStartGroup && (
				<RowMenu
					label={label}
					onStartGroup={() =>
						onStartGroup({ kind: "human", accountId: member.account_id, label })
					}
				/>
			)}
		</li>
	);
};

/** One chief of staff: "Aida (Ben)", opening a DM with that person's agent. */
export const ChiefRailRow: FC<{
	hasDraft?: boolean;
	chief: TeamBridgeChiefOfStaff;
	label: string;
	selected: boolean;
	dm: TeamBridgeConversation | null;
	readOnly: boolean;
	onSelect: () => void;
	onStartGroup: (recipient: TeamBridgeRecipient) => void;
}> = ({
	hasDraft = false,
	chief,
	label,
	selected,
	dm,
	readOnly,
	onSelect,
	onStartGroup,
}) => {
	useI18nLocale();
	const unread = dm?.unread_count ?? 0;
	return (
		<li className="group/row relative flex items-center">
			<TeamBridgeProfileCard
				member={chief.person}
				label={label}
				agentName={label}
				onMessage={onSelect}
				canMessage={Boolean(dm) || !readOnly}
				{...RAIL_CARD}
			>
				<button
					type="button"
					onClick={onSelect}
					aria-current={selected ? "page" : undefined}
					data-team-bridge-chief={chief.person.account_id}
					aria-label={t("ui.teamBridge.people.message", { name: label })}
					className={cn(
						RAIL_ROW,
						selected
							? rowCurrent
							: unread > 0
								? "font-medium text-ink hover:bg-row-hover"
								: "text-ink-muted hover:bg-row-hover hover:text-ink",
					)}
				>
					<TeamBridgeAvatar
						member={chief.person}
						label={label}
						size={20}
						selected={selected}
						className="rounded-[5px] text-accent"
						fallback={<Bot size={12} />}
					/>
					<span className="min-w-0 flex-1 truncate">{label}</span>
					{chief.paused && (
						<span className="shrink-0 text-meta-sm text-ink-dim">
							{t("ui.teamBridge.people.paused")}
						</span>
					)}
					{hasDraft && (
						<span
							title={t("ui.teamBridge.drafts.indicator")}
							className="shrink-0 text-ink-dim"
						>
							<Pencil size={12} aria-hidden="true" />
							<span className="sr-only">
								{t("ui.teamBridge.drafts.indicator")}
							</span>
						</span>
					)}
					<Unread count={unread} yieldsToMenu />
				</button>
			</TeamBridgeProfileCard>
			{!readOnly && (
				<RowMenu
					label={label}
					onStartGroup={() =>
						onStartGroup({
							kind: "agent",
							accountId: chief.person.account_id,
							endpointId: chief.endpointId,
							label,
						})
					}
				/>
			)}
		</li>
	);
};

/** The rail's loading line for a section whose read is in flight. */
export const RailLoading: FC<{ label: string }> = ({ label }) => (
	<div className="flex h-[30px] items-center px-2">
		<Spinner size="sm" label={label} />
	</div>
);

/** Whether a target names this row (the rail's one selection rule). */
export function isTargetRow(
	target: TeamBridgeTarget | null,
	type: "person" | "chief",
	accountId: string,
): boolean {
	return target?.type === type && target.accountId === accountId;
}

/**
 * "10 hours ago · Oct 21, 2026, 1:04 AM" for a row tooltip. Kept here rather
 * than imported from the page so the rail module has no dependency on the
 * page (the page imports the rail).
 */
function lastActiveTooltip(
	iso: string | null | undefined,
	locale: string,
): string {
	if (!iso) return "";
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	const minutes = Math.round((then - Date.now()) / 60_000);
	const hours = Math.round(minutes / 60);
	const rel =
		Math.abs(minutes) < 60
			? formatRelativeTime(minutes, "minute", { numeric: "auto" }, locale)
			: Math.abs(hours) < 24
				? formatRelativeTime(hours, "hour", { numeric: "auto" }, locale)
				: formatRelativeTime(
						Math.round(hours / 24),
						"day",
						{ numeric: "auto" },
						locale,
					);
	const abs = new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(then));
	return `${rel} · ${abs}`;
}
