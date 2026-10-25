import { Spinner } from "@shared/components/common/spinner";
import { Badge, countLabel } from "@shared/components/ui/badge";
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
	personInitial,
	personRowState,
	showsMutedGlyph,
} from "./team-bridge-model";

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

const ROW =
	"group/row relative flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-start text-[13px] transition-colors duration-fast ease-out-quart";

/** The unread pill every row shares, the sidebar's quiet attention badge. */
const Unread: FC<{ count: number; yieldsToMenu?: boolean }> = ({
	count,
	yieldsToMenu = false,
}) =>
	count > 0 ? (
		<Badge
			variant="attentionQuiet"
			shape="pill"
			size="count"
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
		>
			{countLabel(count, 99)}
		</Badge>
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
}> = ({ id, title, children, empty, add }) => {
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
}> = ({
	hasDraft = false,
	conversation,
	selected,
	selfAccountId,
	title,
	organizationName,
	onSelect,
}) => {
	const locale = useI18nLocale();
	const Icon =
		conversation.kind === "group"
			? Users
			: conversation.kind === "dm"
				? AtSign
				: Hash;
	const name =
		title ??
		conversationTitle(conversation, selfAccountId) ??
		t("ui.teamBridge.list.untitled");
	const preview = isPreviewConversation(conversation);
	const unread = conversation.unread_count;
	const lastActive = lastActiveTooltip(conversation.last_message_at, locale);
	return (
		<li>
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
					ROW,
					organizationName && "h-auto min-h-[38px] py-1",
					selected
						? rowCurrent
						: unread > 0
							? "font-medium text-ink hover:bg-row-hover"
							: "text-ink-muted hover:bg-row-hover hover:text-ink",
				)}
			>
				<Icon size={15} aria-hidden="true" className="shrink-0" />
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
				<Unread count={unread} />
			</button>
		</li>
	);
};

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
 * them); nothing is created until the first message is sent.
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
		<span
			aria-hidden="true"
			className={cn(
				"flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-sunken font-medium text-[10px]",
				state === "unavailable" ? "text-ink-disabled" : "text-ink-muted",
			)}
		>
			{personInitial(label)}
		</span>
	);

	if (state === "self") {
		return (
			<li>
				<div className={cn(ROW, "cursor-default text-ink-muted")}>
					{avatar}
					<span className="min-w-0 flex-1 truncate">
						{t("ui.teamBridge.people.self_named", { name: label })}
					</span>
				</div>
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
						ROW,
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
			</li>
		);
	}

	const unread = dm?.unread_count ?? 0;
	const canStartGroup = !readOnly && state !== "unavailable";
	return (
		<li className="group/row relative flex items-center">
			<button
				type="button"
				onClick={onSelect}
				aria-current={selected ? "page" : undefined}
				data-team-bridge-person={member.account_id}
				aria-label={t("ui.teamBridge.people.message", { name: label })}
				className={cn(
					ROW,
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
			<button
				type="button"
				onClick={onSelect}
				aria-current={selected ? "page" : undefined}
				data-team-bridge-chief={chief.person.account_id}
				aria-label={t("ui.teamBridge.people.message", { name: label })}
				className={cn(
					ROW,
					selected
						? rowCurrent
						: unread > 0
							? "font-medium text-ink hover:bg-row-hover"
							: "text-ink-muted hover:bg-row-hover hover:text-ink",
				)}
			>
				<span
					aria-hidden="true"
					className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-accent-wash text-accent"
				>
					<Bot size={12} />
				</span>
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
