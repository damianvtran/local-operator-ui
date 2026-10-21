import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { Spinner } from "@shared/components/common/spinner";
import { Badge, countLabel } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { ScrollArea } from "@shared/components/ui/scroll-area";
import { t } from "@shared/i18n";
import { formatRelativeTime } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { AtSign, BellOff, Bot, Hash, Plus, Send, Users } from "lucide-react";
import type { FC } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
	TeamBridgeNotify,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeConversationMenu } from "./team-bridge-conversation-menu";
import { TeamBridgeCreateDialog } from "./team-bridge-create-dialog";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeEligibility,
	type TeamBridgeOrganization,
	type TeamBridgeScope,
	asTeamBridgeTenantId,
	chronological,
	conversationGlyph,
	conversationMemberCount,
	conversationOrganizationName,
	conversationTitle,
	directoryFailureKind,
	dmWithPerson,
	isPreviewConversation,
	notifyFailureIsVisible,
	orderedMembers,
	organizationOptions,
	personDisplayLabel,
	personInitial,
	personRowState,
	preferredScope,
	showsMutedGlyph,
	showsPersonRole,
	teamBridgeEligibility,
	visibleConversationRows,
} from "./team-bridge-model";
import { TeamBridgeOrgSwitcher } from "./team-bridge-org-switcher";
import {
	useCreateTeamBridgeConversation,
	useJoinTeamBridgeConversation,
	useMarkTeamBridgeRead,
	useSendTeamBridgeMessage,
	useSetTeamBridgeNotify,
	useTeamBridgeConversations,
	useTeamBridgeDirectory,
	useTeamBridgeMessages,
	useTeamBridgeStatus,
	useTeamBridgeUnread,
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

/**
 * The rail's People section: every active human member of the selected
 * organization, below its conversations.
 *
 * WHY BESIDE THE LIST AND NOT IN IT. A conversation is a room; a person is a
 * destination that may not have a room yet. Mixing them would make the rail's
 * unread/paging order say something about people it never meant to say, so the
 * section is its own block with its own heading and its own loading/error
 * states. A failed directory read renders HERE and leaves the conversation
 * list above it untouched — the two reads are independent on purpose.
 *
 * THE MERGED SCOPE HAS NO ROSTER. "All organizations" is not a tenant, and a
 * merged people list would have to invent which organization each person
 * belongs to; the section states that instead of guessing. The directory query
 * is not even enabled in that scope (`useTeamBridgeDirectory(null)`).
 *
 * ROWS INHERIT THE RAIL'S RHYTHM. 30px rows, a 20px initial, 13px labels, no
 * borders: the same tokens the conversation rows and the org switcher use. A
 * person whose bridge is off is still drawn — the point is that you can see who
 * is potentially reachable — but as an inert, `aria-disabled` row whose cue
 * explains why, not as a control that silently does nothing.
 */
const PersonRow: FC<{
	member: TeamBridgeDirectoryMember;
	selfAccountId?: string;
	/** Whether the status read published the signed-in account. */
	identityKnown: boolean;
	/** The conversation list's state: an unresolved DM is not a compose. */
	listState: "loading" | "error" | "ready";
	/** Surface F: the server accepts no writes, so composing is not offered. */
	readOnly: boolean;
	/** The conversation this row opens, when one already exists. */
	existingDm: TeamBridgeConversation | null;
	onOpenConversation: (conversationId: string) => void;
	onComposeToPerson?: (member: TeamBridgeDirectoryMember) => void;
}> = ({
	member,
	selfAccountId,
	identityKnown,
	listState,
	readOnly,
	existingDm,
	onOpenConversation,
	onComposeToPerson,
}) => {
	useI18nLocale();
	const cueId = useId();
	const state = identityKnown
		? personRowState(member, selfAccountId)
		: "unknown";
	const base =
		"flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px]";
	const avatar = (
		<span
			aria-hidden="true"
			className={cn(
				"flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[10px] font-medium",
				state === "unavailable" ? "text-ink-disabled" : "text-ink-muted",
			)}
		>
			{personInitial(personDisplayLabel(member))}
		</span>
	);
	const role =
		showsPersonRole(member.role) && state !== "self" ? (
			<span className="shrink-0 text-meta-sm capitalize text-ink-dim">
				{member.role}
			</span>
		) : null;

	if (state === "self") {
		/* Not a control: mailing yourself is not an action the rail offers. */
		return (
			<li>
				<div className={cn(base, "cursor-default text-ink-muted")}>
					{avatar}
					<span className="min-w-0 flex-1 truncate">
						{t("ui.teamBridge.people.self")}
					</span>
					{role}
				</div>
			</li>
		);
	}

	/*
	 * THE ROW STAYS INERT UNTIL ITS DESTINATION CAN BE RESOLVED (round-1 U-2,
	 * U-4, U-5). A click means "open the DM, or start one"; an unresolved list
	 * cannot answer the first half, an unknown identity cannot tell self from
	 * another person, and surface F refuses the second half. In those states the
	 * row is a labelled statement with a reason, not a control that guesses.
	 *
	 * `aria-disabled`, not the `disabled` attribute: a disabled button is removed
	 * from the tab order, so its explanation would be unreachable to exactly the
	 * reader who needs it. The described-by cue is the visible tooltip too.
	 */
	const inertCue =
		state === "unavailable"
			? t("ui.teamBridge.people.bridge_off")
			: !identityKnown
				? t("ui.teamBridge.people.identity_loading")
				: listState === "loading"
					? t("ui.teamBridge.people.list_loading")
					: listState === "error"
						? t("ui.teamBridge.people.list_error")
						: readOnly && !existingDm
							? t("ui.teamBridge.read_only.person")
							: null;

	if (inertCue) {
		return (
			<li>
				<button
					type="button"
					aria-disabled="true"
					aria-describedby={cueId}
					title={inertCue}
					className={cn(
						base,
						"cursor-default",
						state === "unavailable" ? "text-ink-disabled" : "text-ink-muted",
					)}
				>
					{avatar}
					<span className="min-w-0 flex-1 truncate">
						{personDisplayLabel(member)}
					</span>
					{role}
					<span id={cueId} className="sr-only">
						{inertCue}
					</span>
				</button>
			</li>
		);
	}

	const paused = state === "paused";
	return (
		<li>
			<button
				type="button"
				onClick={() =>
					existingDm
						? onOpenConversation(existingDm.id)
						: onComposeToPerson?.(member)
				}
				aria-label={
					paused
						? t("ui.teamBridge.people.message_paused", {
								name: personDisplayLabel(member),
							})
						: t("ui.teamBridge.people.message", {
								name: personDisplayLabel(member),
							})
				}
				className={cn(
					base,
					"text-ink-muted transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink",
				)}
			>
				{avatar}
				<span className="min-w-0 flex-1 truncate">
					{personDisplayLabel(member)}
				</span>
				{role}
				{paused && (
					<span className="shrink-0 text-meta-sm text-ink-dim">
						{t("ui.teamBridge.people.paused")}
					</span>
				)}
			</button>
		</li>
	);
};

/**
 * A failed directory read, with the cause named.
 *
 * The People section is the one place a reader goes to find a colleague, so a
 * generic "could not be loaded" is not actionable: a signed-out viewer must be
 * told to sign in (and not offered a Try again that cannot work), an org whose
 * plan does not include the bridge must say so, and only a transport/server
 * failure earns a retry. The status/code classification lives in the model so
 * the view does not parse errors.
 */
const PeopleFailure: FC<{
	error?: unknown;
	onRetry?: () => void;
}> = ({ error, onRetry }) => {
	useI18nLocale();
	const kind = directoryFailureKind(error);
	const rawMessage = (error as { message?: unknown } | null | undefined)
		?.message;
	const detail = typeof rawMessage === "string" ? rawMessage.trim() : "";
	const reason =
		kind === "sign_in"
			? t("ui.teamBridge.plan.sign_in_reason")
			: kind === "plan"
				? t("ui.teamBridge.plan.reason")
				: kind === "invalid"
					? detail || t("ui.teamBridge.scope.error")
					: kind === "outdated"
						? t("ui.teamBridge.plan.update_reason")
						: t("ui.teamBridge.plan.unavailable_reason");
	const retryable = kind === "unreachable" || kind === "server";
	return (
		<div className="flex flex-col items-start gap-2 px-2 py-1">
			<p className="text-[12px] leading-snug text-ink-muted">
				{t("ui.teamBridge.people.error")}
			</p>
			<p className="text-[12px] leading-snug text-ink-dim">{reason}</p>
			{retryable && onRetry && (
				<Button type="button" size="sm" variant="outline" onClick={onRetry}>
					{t("ui.teamBridge.list.retry")}
				</Button>
			)}
		</div>
	);
};

const PeopleSection: FC<{
	scope: TeamBridgeScope;
	people: readonly TeamBridgeDirectoryMember[];
	peopleState: "loading" | "error" | "ready";
	/** The failed directory read, when `peopleState` is "error". */
	peopleError?: unknown;
	/** True when the parse had to discard rows that had no stable account id. */
	peopleIncomplete?: boolean;
	selfAccountId?: string;
	identityKnown: boolean;
	listState: "loading" | "error" | "ready";
	readOnly: boolean;
	conversations: readonly TeamBridgeConversation[];
	onSelect: (conversationId: string) => void;
	onRetry?: () => void;
	onComposeToPerson?: (member: TeamBridgeDirectoryMember) => void;
}> = ({
	scope,
	people,
	peopleState,
	peopleError,
	peopleIncomplete = false,
	selfAccountId,
	identityKnown,
	listState,
	readOnly,
	conversations,
	onSelect,
	onRetry,
	onComposeToPerson,
}) => {
	useI18nLocale();
	const merged = scope === TEAM_BRIDGE_ALL_SCOPE;
	return (
		<section aria-labelledby="team-bridge-people-heading" className="px-1 pb-3">
			{/*
			 * H2, not H3 (round-1 U-7): the page's own heading is the sr-only H1
			 * and the rail has no H2 above this section, so an H3 skipped a level
			 * in heading navigation.
			 */}
			<h2
				id="team-bridge-people-heading"
				className="px-2 pb-1 pt-3 text-meta font-medium tracking-wide text-ink-dim"
			>
				{t("ui.teamBridge.people.title")}
			</h2>
			{merged ? (
				<p className="px-2 py-1 text-[12px] leading-snug text-ink-dim">
					{t("ui.teamBridge.people.all_scope")}
				</p>
			) : peopleState === "loading" ? (
				<div className="flex h-[30px] items-center px-2">
					<Spinner size="sm" label={t("ui.teamBridge.people.loading")} />
				</div>
			) : peopleState === "error" ? (
				<PeopleFailure error={peopleError} onRetry={onRetry} />
			) : people.length === 0 && peopleIncomplete ? (
				<p className="px-2 py-1 text-[12px] leading-snug text-ink-muted">
					{t("ui.teamBridge.people.error")}
				</p>
			) : people.length === 0 ? (
				<p className="px-2 py-1 text-[12px] leading-snug text-ink-dim">
					{t("ui.teamBridge.people.empty")}
				</p>
			) : (
				<ul className="flex flex-col">
					{people.map((member) => (
						<PersonRow
							key={member.account_id}
							member={member}
							selfAccountId={selfAccountId}
							identityKnown={identityKnown}
							listState={listState}
							readOnly={readOnly}
							existingDm={dmWithPerson(
								conversations,
								member.account_id,
								selfAccountId,
							)}
							onOpenConversation={onSelect}
							onComposeToPerson={onComposeToPerson}
						/>
					))}
				</ul>
			)}
		</section>
	);
};

/**
 * The first paint while the eligibility read is in flight.
 *
 * WHY A HOLD RATHER THAN THE PAGE. The status answer decides whether this
 * surface exists for the account at all; mounting the rail and firing the read
 * set before it lands showed ineligible accounts live chrome and several
 * requests the server answers with a refusal (round-1 U-6). The read is local
 * and cheap, so a calm spinner for one round trip is the cheaper mistake.
 */
const TeamBridgeGateLoading: FC = () => {
	useI18nLocale();
	return (
		<div
			data-glass-region="canvas"
			className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-canvas px-6"
		>
			<Spinner size="sm" label={t("ui.teamBridge.plan.checking")} />
		</div>
	);
};

/**
 * What a signed-in user sees when the bridge says this account or
 * organization cannot use it.
 *
 * A GATE, NOT AN ADVERTISEMENT. It names the exact reason the server gave and
 * the value in one sentence; it draws no controls, because every control this
 * page could offer (create, scope, compose) would be refused. The surface
 * capability still mounts the page, so this is the honest answer for a build
 * that can render Team Bridge but no plan can serve it.
 */
export const TeamBridgeEligibilityPanel: FC<{
	reason: TeamBridgeEligibility;
}> = ({ reason }) => {
	useI18nLocale();
	const copy = {
		plan_required: {
			title: "ui.teamBridge.plan.title",
			reason: "ui.teamBridge.plan.reason",
		},
		signed_out: {
			title: "ui.teamBridge.plan.sign_in_title",
			reason: "ui.teamBridge.plan.sign_in_reason",
		},
		update_required: {
			title: "ui.teamBridge.plan.update_title",
			reason: "ui.teamBridge.plan.update_reason",
		},
		unavailable: {
			title: "ui.teamBridge.plan.unavailable_title",
			reason: "ui.teamBridge.plan.unavailable_reason",
		},
	} as const satisfies Record<
		TeamBridgeEligibility,
		{ title: string; reason: string }
	>;
	return (
		<div
			data-glass-region="canvas"
			className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-canvas px-6"
		>
			<div className="max-w-lg text-center">
				{/* The one glyph on the panel: Team Bridge is a people surface, and the
				    mark gives the centred block an anchor without a control. */}
				<Users
					size={20}
					aria-hidden="true"
					className="mx-auto mb-3 text-ink-dim"
				/>
				<h1 className="text-balance text-[16px] font-medium text-ink">
					{t(copy[reason].title)}
				</h1>
				<div className="mt-2">
					<p className="text-pretty text-[13px] leading-relaxed text-ink-muted">
						{t("ui.teamBridge.plan.body")}
					</p>
					<p className="mt-4 text-[12px] leading-snug text-ink-dim">
						{t(copy[reason].reason)}
					</p>
				</div>
			</div>
		</div>
	);
};

const ConversationRow: FC<{
	conversation: TeamBridgeConversation;
	selected: boolean;
	selfAccountId?: string;
	/** The merged view names each row's organization; a single-org rail does not. */
	organizationName?: string | null;
	showOrganization: boolean;
	onSelect: () => void;
}> = ({
	conversation,
	selected,
	selfAccountId,
	organizationName,
	showOrganization,
	onSelect,
}) => {
	const locale = useI18nLocale();
	const glyph = conversationGlyph(conversation);
	const Icon = glyph === "hash" ? Hash : glyph === "users" ? Users : AtSign;
	const title =
		conversationTitle(conversation, selfAccountId) ??
		t("ui.teamBridge.list.untitled");
	const unread = conversation.unread_count;
	const preview = isPreviewConversation(conversation);
	const muted = showsMutedGlyph(conversation);
	const lastMessageAt = conversation.last_message_at;
	const lastMessage = lastMessageAt ? relative(lastMessageAt, locale) : "";

	return (
		<li>
			<button
				type="button"
				onClick={onSelect}
				title={
					lastMessage
						? `${lastMessage} · ${absolute(lastMessageAt, locale)}`
						: undefined
				}
				aria-current={selected ? "page" : undefined}
				data-conversation-id={conversation.id}
				data-conversation-tenant={conversation.tenant_id}
				className={cn(
					"flex w-full items-center gap-2 rounded-md px-2 text-left",
					"transition-colors duration-fast ease-out-quart",
					showOrganization ? "min-h-[38px] py-1" : "h-[30px]",
					selected
						? "bg-row-selected text-ink"
						: "text-ink-muted hover:bg-row-hover hover:text-ink",
				)}
			>
				<Icon size={16} aria-hidden="true" className="shrink-0" />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="flex min-w-0 items-center gap-2">
						<span className="min-w-0 flex-1 truncate text-[13px]">{title}</span>
						{preview && (
							<Badge variant="attentionQuiet" className="shrink-0">
								{t("ui.teamBridge.preview.chip")}
							</Badge>
						)}
						{/*
						 * The quiet bell is the row's own statement of a mute. It sits before
						 * the unread count because the count still exists on a muted row (the
						 * reader may want to look); the bell explains why it is not raising the
						 * badge. `sr-only` text keeps the glyph out of the sighted-only channel.
						 */}
						{muted && (
							<span
								className="shrink-0 text-ink-dim"
								title={t("ui.teamBridge.notify.muted")}
							>
								<BellOff size={12} aria-hidden="true" />
								<span className="sr-only">
									{t("ui.teamBridge.notify.muted")}
								</span>
							</span>
						)}
						{/*
						 * THE ROW CARRIES NAME, BADGE, MUTE AND UNREAD ONLY. The relative
						 * time used to compete with the name here and clipped to "10 hours
						 * a" at the panel edge. It now lives in the selected header (always
						 * visible, including touch/mobile) and in the row tooltip with the
						 * absolute value; the title is the only item allowed to ellipsise.
						 */}
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
					</span>
					{showOrganization && (
						<span className="mt-0.5 flex min-w-0 items-center gap-1.5">
							<span className="truncate rounded-sm border border-control bg-elevated px-1 text-meta-sm text-ink-dim">
								{organizationName ?? t("ui.teamBridge.scope.unknown")}
							</span>
						</span>
					)}
				</span>
			</button>
		</li>
	);
};

function absolute(iso: string | null | undefined, locale: string): string {
	if (!iso) return "";
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(then));
}

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
	/** The caller's active memberships, already joined with per-org counts. */
	organizations: TeamBridgeOrganization[];
	scope: TeamBridgeScope;
	/** The account aggregate's total; the "All organizations" row shows it. */
	totalUnread: number;
	membershipsLoading?: boolean;
	organizationsFailed?: boolean;
	selfAccountId?: string;
	sending?: boolean;
	sendFailed?: boolean;
	/** A join write is in flight; the banner's Join is busy. */
	joining?: boolean;
	/** The last join was refused; the banner states it above the action. */
	joinFailed?: boolean;
	/** The last notification write was refused; the line under the header says so. */
	notifyFailed?: boolean;
	/** Join the selected discoverable channel (the banner's primary action). */
	onJoin?: () => void;
	/** Write the selected conversation's notification preference. */
	onNotifyChange?: (notify: TeamBridgeNotify) => void;
	/** Story/test seed only: opens the header menu so its rows are visible. */
	defaultMenuOpen?: boolean;
	/** Story/test seed only: the page's real draft is user-owned state. */
	initialDraft?: string;
	/**
	 * The rail's People section. `peopleState` is the directory read's own
	 * state, deliberately separate from `listState`: a refused directory never
	 * blanks the conversation list, and a refused list never hides the roster.
	 */
	people?: readonly TeamBridgeDirectoryMember[];
	peopleState?: "loading" | "error" | "ready";
	/** The failed directory read, when `peopleState` is "error". */
	peopleError?: unknown;
	/** True when the parse had to discard rows that had no stable account id. */
	peopleIncomplete?: boolean;
	/** Retry the directory read behind the People section. */
	onRetryPeople?: () => void;
	/**
	 * Open the new-conversation flow pre-seeded to a DM with this person. The
	 * view resolves an existing DM itself and selects it instead; this is only
	 * the no-DM path.
	 */
	onComposeToPerson?: (member: TeamBridgeDirectoryMember) => void;
	/**
	 * The bridge's eligibility verdict. Non-null replaces the whole page with
	 * the plan/sign-in panel: an ineligible user must not see conversation or
	 * member chrome whose every action would be refused.
	 */
	eligibility?: TeamBridgeEligibility | null;
	/** The eligibility read has not answered yet: hold the whole page. */
	gatePending?: boolean;
	/**
	 * Surface F: the server accepts no writes for this organization. New
	 * conversations and the composer are withheld rather than offered and
	 * refused.
	 */
	readOnly?: boolean;
	onSelect: (conversationId: string) => void;
	onSend: (body: string, clientRef: string) => Promise<unknown> | undefined;
	onNewConversation: () => void;
	onRetry?: () => void;
	onScopeChange: (scope: TeamBridgeScope) => void;
	/** Retry the memberships read behind the switcher (its own recovery action). */
	onRetryMemberships?: () => void;
};

export const TeamBridgePageView: FC<TeamBridgePageViewProps> = ({
	listState,
	messageState,
	conversations,
	selected,
	messages,
	organizations,
	scope,
	totalUnread,
	membershipsLoading = false,
	organizationsFailed = false,
	selfAccountId,
	sending = false,
	sendFailed = false,
	joining = false,
	joinFailed = false,
	notifyFailed = false,
	onJoin,
	onNotifyChange,
	defaultMenuOpen = false,
	initialDraft = "",
	people = [],
	peopleState = "ready",
	peopleError,
	peopleIncomplete = false,
	onRetryPeople,
	onComposeToPerson,
	eligibility = null,
	gatePending = false,
	readOnly = false,
	onSelect,
	onSend,
	onNewConversation,
	onRetry,
	onScopeChange,
	onRetryMemberships,
}) => {
	const locale = useI18nLocale();
	const [draft, setDraft] = useState(initialDraft);
	const threadEnd = useRef<HTMLDivElement>(null);
	const ordered = useMemo(() => chronological(messages), [messages]);

	const mergedView = scope === TEAM_BRIDGE_ALL_SCOPE;
	const selectedLastMessage = selected?.last_message_at
		? relative(selected.last_message_at, locale)
		: "";
	const previewSelected = selected !== null && isPreviewConversation(selected);
	const listRows = useMemo(
		() => visibleConversationRows(conversations, scope, organizations),
		[conversations, scope, organizations],
	);
	const selectedOrganizationName = selected
		? conversationOrganizationName(selected, organizations)
		: null;
	const selectedOrganizationUnknown =
		mergedView && selected !== null && selectedOrganizationName === null;

	/*
	 * ONE description id for the disabled New conversation affordance. Exactly
	 * one node owns it in every merged-view state: the rail hint while the list
	 * is loading or errored, or while it has rows; the empty pane's body when the
	 * list is ready and empty. The states are mutually exclusive, so the button's
	 * `aria-describedby` never dangles — including the transient states where the
	 * pane is not rendered at all.
	 */
	const createHintId = "team-bridge-create-hint";
	const createDisabled = mergedView || readOnly;
	const createHintVisible = createDisabled;
	const createHint = readOnly
		? t("ui.teamBridge.read_only.note")
		: t("ui.teamBridge.scope.create_needs_org");

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

	/*
	 * THE GATE COMES BEFORE EVERY OTHER PIECE OF CHROME. An ineligible account
	 * or organization would otherwise see a rail whose every affordance is
	 * refused; the surface capability is what mounts the page, so this panel is
	 * the honest content for that mount. While the verdict is in flight the page
	 * is held for the same reason (round-1 U-6): the container also disables the
	 * read set, so this hold costs one local read and no refused requests.
	 */
	if (gatePending) {
		return <TeamBridgeGateLoading />;
	}
	if (eligibility) {
		return <TeamBridgeEligibilityPanel reason={eligibility} />;
	}

	return (
		<div
			data-glass-region="canvas"
			className="flex h-full min-h-0 w-full overflow-hidden bg-canvas"
		>
			<aside
				data-glass-region="page-sidebar"
				/* BORDERLESS CHROME: the column is separated by its own ground, not a
				   rule. A full-height border beside a 30px-row list reads as a hard
				   frame; the sunken tint does the same job and survives glass, where a
				   solid line is the one thing a translucent surface cannot hide. */
				className="flex w-72 shrink-0 flex-col pt-[var(--panel-top-pad,0px)]"
			>
				{/* The page's heading for heading navigation. The rail's visible title is
				    the scope, which is a control rather than a document heading. */}
				<h1 className="sr-only">{t("ui.teamBridge.page.title")}</h1>
				<header className="flex h-11 shrink-0 items-center gap-2 px-3">
					{/* The scope IS the rail title: every row below belongs to the
					    organization named here, and the switcher is the rail's first
					    30px row rather than a framed field above it. */}
					<TeamBridgeOrgSwitcher
						organizations={organizations}
						scope={scope}
						onScopeChange={onScopeChange}
						totalUnread={totalUnread}
						membershipsLoading={membershipsLoading}
						organizationsFailed={organizationsFailed}
						onRetry={onRetryMemberships}
					/>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label={t("ui.teamBridge.page.new_conversation")}
						aria-disabled={createDisabled || undefined}
						aria-describedby={createHintVisible ? createHintId : undefined}
						className={
							createDisabled
								? "text-ink-disabled hover:bg-transparent"
								: undefined
						}
						onClick={() => {
							if (!createDisabled) onNewConversation();
						}}
					>
						<Plus size={16} />
					</Button>
				</header>
				{createDisabled && (listRows.length > 0 || listState !== "ready") && (
					<p id={createHintId} className="px-3 pb-2 text-[12px] text-ink-dim">
						{createHint}
					</p>
				)}
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
					{listState === "ready" && listRows.length > 0 && (
						<ul className="flex flex-col gap-0.5 px-1 pb-2">
							{listRows.map((conversation) => (
								<ConversationRow
									key={conversation.id}
									conversation={conversation}
									selected={selected?.id === conversation.id}
									selfAccountId={selfAccountId}
									showOrganization={mergedView}
									organizationName={
										mergedView
											? conversationOrganizationName(
													conversation,
													organizations,
												)
											: undefined
									}
									onSelect={() => onSelect(conversation.id)}
								/>
							))}
						</ul>
					)}
					<PeopleSection
						scope={scope}
						people={people}
						peopleState={peopleState}
						peopleError={peopleError}
						peopleIncomplete={peopleIncomplete}
						selfAccountId={selfAccountId}
						identityKnown={selfAccountId !== undefined}
						listState={listState}
						readOnly={readOnly}
						conversations={conversations}
						onSelect={onSelect}
						onRetry={onRetryPeople}
						onComposeToPerson={onComposeToPerson}
					/>
				</ScrollArea>
			</aside>

			{/* The ONE ground split: the rail inherits the page canvas, the thread
			    carries the surface. In every palette `surface` sits off `canvas`, so the
			    two regons read apart in light and dark without a single rule between
			    them — which is also what survives the glass settings, where a hard
			    line is the one thing a translucent ground cannot hide. */}
			<section className="flex min-w-0 flex-1 flex-col bg-surface pt-[var(--panel-top-pad,0px)]">
				{selected === null ? (
					listState === "ready" ? (
						<div className="flex flex-1 items-center justify-center px-6">
							<div className="max-w-sm text-center">
								<p className="font-medium text-[13px] text-ink">
									{t("ui.teamBridge.list.empty.title")}
								</p>
								<p
									id={
										createDisabled &&
										listState === "ready" &&
										listRows.length === 0
											? createHintId
											: undefined
									}
									className="mt-1 text-[13px] text-ink-muted"
								>
									{createDisabled &&
									listState === "ready" &&
									listRows.length === 0
										? createHint
										: t("ui.teamBridge.list.empty.body")}
								</p>
								<Button
									size="sm"
									variant="primary"
									className={createDisabled ? "mt-3 opacity-60" : "mt-3"}
									aria-disabled={createDisabled || undefined}
									aria-describedby={
										createHintVisible ? createHintId : undefined
									}
									onClick={() => {
										if (!createDisabled) onNewConversation();
									}}
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
							{mergedView && selectedOrganizationName && (
								<span className="shrink-0 rounded-sm bg-elevated px-1.5 py-0.5 text-meta-sm text-ink-dim">
									{selectedOrganizationName}
								</span>
							)}
							<span className="shrink-0 text-meta-sm text-ink-dim">
								{t("ui.teamBridge.member.count", {
									count: conversationMemberCount(selected),
								})}
							</span>
							{selectedLastMessage && (
								<span
									className="shrink-0 text-meta-sm text-ink-dim"
									title={absolute(selected.last_message_at as string, locale)}
								>
									<span aria-hidden="true">·</span> {selectedLastMessage}
								</span>
							)}
							<div className="ml-auto flex items-center gap-1">
								{/*
								 * The strip draws exactly what the count states: ACTIVE members. The
								 * server's member_count includes invitees, so an unfiltered strip would
								 * show three initials beside "2 members".
								 */}
								{orderedMembers(selected)
									.filter((member) => member.state === "active")
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
											title={personDisplayLabel(member)}
										>
											{member.kind === "agent" ? (
												<Bot size={12} aria-hidden="true" />
											) : (
												(personDisplayLabel(member)[0] ?? "?")
											)}
										</span>
									))}
								{!previewSelected && !readOnly && onNotifyChange && (
									<TeamBridgeConversationMenu
										conversation={selected}
										onNotifyChange={onNotifyChange}
										defaultOpen={defaultMenuOpen}
									/>
								)}
							</div>
						</header>
						{notifyFailed && (
							<p role="alert" className="px-3 pb-1 text-[12px] text-danger">
								{t("ui.teamBridge.notify.error")}
							</p>
						)}

						{/* Radix wraps children in an auto-height table cell; these
						    arbitrary variants make that wrapper fill the viewport so the
						    list can justify-end (Slack anchors a short history at the
						    bottom, next to the composer). */}
						<ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:block [&_[data-radix-scroll-area-viewport]>div]:h-full">
							<div className="flex h-full flex-col">
								{previewSelected ? (
									<TeamBridgePreviewBanner
										joining={joining}
										joinFailed={joinFailed}
										readOnly={readOnly}
										onJoin={onJoin}
									/>
								) : (
									<>
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
										{selectedOrganizationUnknown && (
											<p className="px-4 py-8 text-[13px] text-ink-muted">
												{t("ui.teamBridge.scope.thread_unknown")}
											</p>
										)}
										{!selectedOrganizationUnknown &&
											messageState === "ready" &&
											ordered.length === 0 && (
												<p className="px-4 py-10 text-center text-[13px] text-ink-muted">
													{t("ui.teamBridge.thread.empty")}
												</p>
											)}
										{!selectedOrganizationUnknown &&
											messageState === "ready" &&
											ordered.length > 0 && (
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
									</>
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
						{/* No composer in a preview: a non-member cannot write, and a
						    disabled box would be fake chrome beside a real Join action.
						    Surface F is the same rule for a member: the server refuses
						    every write, so the composer is replaced by the reason rather
						    than drawn disabled (round-1 U-5). */}
						{!previewSelected &&
							(readOnly ? (
								<p className="shrink-0 px-5 pb-4 text-[12px] leading-snug text-ink-dim">
									{t("ui.teamBridge.read_only.composer")}
								</p>
							) : (
								<div className="shrink-0 px-3 pb-3">
									{sendFailed && (
										<p
											role="alert"
											className="px-2 pb-1 text-[12px] text-danger"
										>
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
							))}
					</>
				)}
			</section>
		</div>
	);
};

/**
 * What a discoverable non-member sees INSTEAD of a thread.
 *
 * The server answers `not_a_member` for a history read, so this banner is not
 * a loading state and must never sit above message bodies that arrived from a
 * cache: the caller neither requests nor renders them, and this component is
 * the only content the pane owns in that state. The primary action is a real
 * Join (the same write the header menu's absence implies), and a refusal is
 * stated beside it rather than replacing it — a failed join is retryable.
 */
export const TeamBridgePreviewBanner: FC<{
	joining?: boolean;
	joinFailed?: boolean;
	/**
	 * Surface F: the server refuses every write, so Join is not offered. The
	 * reader still needs the reason beside the preview copy rather than a
	 * disabled button that would be fake chrome (round-2 MINOR-1).
	 */
	readOnly?: boolean;
	onJoin?: () => void;
}> = ({ joining = false, joinFailed = false, readOnly = false, onJoin }) => {
	useI18nLocale();
	return (
		<div className="flex flex-1 items-center justify-center px-6 py-10">
			<div className="flex max-w-md flex-col items-center gap-3 text-center">
				<p className="text-[13px] text-ink">
					{t("ui.teamBridge.preview.banner")}
				</p>
				{joinFailed && (
					<p role="alert" className="text-[12px] text-danger">
						{t("ui.teamBridge.preview.join_error")}
					</p>
				)}
				{readOnly ? (
					<p className="text-[12px] leading-snug text-ink-dim">
						{t("ui.teamBridge.read_only.note")}
					</p>
				) : (
					<Button
						type="button"
						size="sm"
						variant="primary"
						disabled={joining}
						onClick={onJoin}
					>
						{t("ui.teamBridge.preview.join")}
					</Button>
				)}
			</div>
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
	/*
	 * A banner click lands here with `?tenant=…&conversation=…` (the route is the
	 * app's existing navigation path). The parameters seed the FIRST render, not
	 * only an effect: the landing effect below selects the first visible row when
	 * `selectedId` is null, and a state update from an effect in the same commit
	 * would still be racing that closure. Seeding the state is what makes the
	 * clicked conversation win every time.
	 */
	const [searchParams, setSearchParams] = useSearchParams();
	const requestedConversation = searchParams.get("conversation");
	const requestedTenant = searchParams.get("tenant");
	const [scope, setScope] = useState<TeamBridgeScope>(() =>
		requestedTenant
			? asTeamBridgeTenantId(requestedTenant)
			: TEAM_BRIDGE_ALL_SCOPE,
	);
	// Whether the reader has chosen a scope themselves. Until they do, a
	// single-membership account lands in its only organization instead of the
	// account-wide view: "All organizations" is a multi-org affordance, and the
	// sole-org account should not need to pick its one org to create anything.
	const scopeChosen = useRef(Boolean(requestedTenant));
	/*
	 * THE GATE IS THE FIRST READ (round-1 U-6). Until it answers, every other
	 * read on this page is disabled and the view holds the first paint, so a
	 * signed-out or plan-ineligible account issues no conversations, unread,
	 * memberships or directory requests. A status read that FAILED is not a
	 * verdict: it enables the reads and lets the list's own error state answer.
	 *
	 * The same payload carries the signed-in account (the route
	 * `useTeamBridgeIdentity` reads), so the page parses it once instead of
	 * spending a second round trip, and surface F's `read_only` arrives with it.
	 */
	const status = useTeamBridgeStatus();
	const eligibility = status.data ? teamBridgeEligibility(status.data) : null;
	const gatePending = status.isPending;
	const readsEnabled = !gatePending && eligibility === null;
	const selfAccountId = status.data?.account_id ?? undefined;
	const readOnly = status.data?.read_only === true;
	// The memberships are the switcher's ONE source, and the account aggregate
	// is the ONE unread read — the same cache entry the sidebar badge spends.
	// Per-org counts are joined from that payload, never fetched per org.
	const memberships = useMembershipsQuery({ enabled: readsEnabled });
	const unread = useTeamBridgeUnread(readsEnabled, TEAM_BRIDGE_ALL_SCOPE);
	const organizations = useMemo(
		() =>
			organizationOptions(memberships.memberships, unread.data?.organizations),
		[memberships.memberships, unread.data],
	);
	const list = useTeamBridgeConversations(scope, readsEnabled);
	// The directory is disabled in the merged scope because there is no single
	// tenant whose people that view could show, and by the gate like the rest.
	const directory = useTeamBridgeDirectory(
		scope === TEAM_BRIDGE_ALL_SCOPE ? null : scope,
		readsEnabled,
	);
	/*
	 * The person a rail click asked to compose to, when no DM exists yet. It
	 * survives only while the create dialog is open: closing (or creating)
	 * clears it, so the next "New conversation" press starts blank.
	 */
	const [composeTo, setComposeTo] = useState<{
		accountId: string;
		displayLabel: string;
	} | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(
		() => requestedConversation,
	);
	const [createOpen, setCreateOpen] = useState(false);
	const conversations = list.data?.conversations ?? [];
	const mergedView = scope === TEAM_BRIDGE_ALL_SCOPE;

	/*
	 * Apply a click that arrives while the page is ALREADY mounted, and clear the
	 * parameters either way. The page owns its selection as local state, and a
	 * parameter left in the URL would re-select the old conversation after the
	 * reader moved on or a background refetch re-rendered this container.
	 *
	 * The scope is the target's own organization, set before the list read has
	 * answered: waiting for the memberships would paint the merged list first and
	 * then jump organizations in front of the reader.
	 */
	useEffect(() => {
		if (!requestedConversation || !requestedTenant) return;
		scopeChosen.current = true;
		setScope(asTeamBridgeTenantId(requestedTenant));
		setSelectedId(requestedConversation);
		setCreateOpen(false);
		setSearchParams({}, { replace: true });
	}, [requestedConversation, requestedTenant, setSearchParams]);

	// A conversation id belongs to exactly one organization. Clearing the
	// selection on a scope change — including "All organizations" — is what
	// keeps the thread from looking a cached message page up under the new
	// scope's title while the new list is still loading.
	const changeScope = (next: TeamBridgeScope) => {
		scopeChosen.current = true;
		setScope(next);
		setSelectedId(null);
		setCreateOpen(false);
		setComposeTo(null);
	};

	// The memberships resolve after the first paint; adopt the only one unless
	// the reader has already picked a scope. A later unread poll re-renders the
	// options array, so the equality check keeps this to the one transition.
	useEffect(() => {
		setScope((current) =>
			preferredScope(organizations, current, scopeChosen.current),
		);
	}, [organizations]);

	// The selection may only name a row the rail actually renders. The merged
	// view withholds rows whose org is unknown, and the same filter decides the
	// landing row — otherwise a first paint could open a hidden conversation.
	const visibleConversations = useMemo(
		() => visibleConversationRows(conversations, scope, organizations),
		[conversations, scope, organizations],
	);

	// Land on the first conversation once, not on every refetch: a poll must not
	// move the reader out of the thread they are reading.
	useEffect(() => {
		if (selectedId === null && visibleConversations.length > 0) {
			setSelectedId(visibleConversations[0].id);
		}
	}, [visibleConversations, selectedId]);

	const selected =
		visibleConversations.find(
			(conversation) => conversation.id === selectedId,
		) ?? null;
	// A preview is metadata only: requesting its history is the one read the
	// server refuses (`not_a_member`), so the query is disabled rather than
	// taught to tolerate an expected error.
	const previewSelected = selected !== null && isPreviewConversation(selected);
	// Every thread read and write names the SELECTED CONVERSATION's tenant, not
	// the rail scope: in the merged view the scope is "all", and a message call
	// without a tenant would fall back to whatever the server considers default
	// — the one way a merged row could be read under the wrong organization.
	const messages = useTeamBridgeMessages(
		previewSelected ? null : (selected?.id ?? null),
		selected?.tenant_id,
		readsEnabled,
	);
	const send = useSendTeamBridgeMessage(
		selected?.id ?? "",
		selected?.tenant_id,
	);
	const create = useCreateTeamBridgeConversation(
		scope === TEAM_BRIDGE_ALL_SCOPE ? undefined : scope,
	);
	const markRead = useMarkTeamBridgeRead(
		selected?.id ?? "",
		selected?.tenant_id,
	);
	const join = useJoinTeamBridgeConversation(
		selected?.id ?? "",
		selected?.tenant_id,
	);
	const notify = useSetTeamBridgeNotify();

	// Mark read at the newest seq actually rendered. A visible page has shown
	// these messages; leaving the cursor behind would keep the badge counting a
	// conversation the reader is looking at. The server applies `$max`, so this
	// is safe to repeat on a refetch.
	// A refusal belongs to the conversation it happened in; selecting another
	// conversation must not leave the line on screen.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the selection changes.
	useEffect(() => {
		send.reset();
		join.reset();
		// A refusal is about the conversation the reader was in; the next
		// selection starts with a clean line, as the next successful write does
		// (a mutation that succeeds is no longer in its error state).
		notify.reset();
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
					list.isPending || (mergedView && memberships.isLoading)
						? "loading"
						: list.isError || (mergedView && memberships.isError)
							? "error"
							: "ready"
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
				organizations={organizations}
				scope={scope}
				totalUnread={unread.data?.total ?? 0}
				membershipsLoading={memberships.isLoading}
				organizationsFailed={memberships.isError}
				selfAccountId={selfAccountId}
				sending={send.isPending}
				sendFailed={send.isError}
				joining={join.isPending}
				joinFailed={join.isError}
				notifyFailed={notifyFailureIsVisible(notify, selected?.id ?? null)}
				onJoin={() => join.mutate()}
				onNotifyChange={(next) => {
					if (selected === null) return;
					notify.mutate({
						conversationId: selected.id,
						tenantId: selected.tenant_id,
						notify: next,
					});
				}}
				onSelect={setSelectedId}
				onSend={(body, clientRef) => {
					if (selected === null) return;
					return send.mutateAsync({ clientRef, body });
				}}
				onNewConversation={() => {
					if (readOnly) return;
					setComposeTo(null);
					setCreateOpen(true);
				}}
				people={directory.data?.members ?? []}
				peopleState={
					directory.isPending
						? "loading"
						: directory.isError
							? "error"
							: "ready"
				}
				peopleError={directory.error}
				peopleIncomplete={(directory.data?.unavailable_count ?? 0) > 0}
				onRetryPeople={() => {
					void directory.refetch();
				}}
				onComposeToPerson={(member) => {
					setComposeTo({
						accountId: member.account_id,
						displayLabel: personDisplayLabel(member),
					});
					setCreateOpen(true);
				}}
				eligibility={eligibility}
				gatePending={gatePending}
				readOnly={readOnly}
				onRetry={() => {
					void list.refetch();
					if (memberships.isError) void memberships.refetch();
				}}
				onScopeChange={changeScope}
				onRetryMemberships={() => {
					void memberships.refetch();
				}}
			/>
			<TeamBridgeCreateDialog
				open={createOpen}
				seed={composeTo}
				pending={create.isPending}
				error={create.isError ? t("ui.teamBridge.create.error") : undefined}
				onClose={() => {
					setCreateOpen(false);
					setComposeTo(null);
				}}
				onCreate={(input) => {
					create.mutate(input, {
						onSuccess: (created) => {
							setCreateOpen(false);
							setComposeTo(null);
							const conversation = created as { id?: string };
							if (conversation.id) setSelectedId(conversation.id);
						},
					});
				}}
			/>
		</>
	);
};
