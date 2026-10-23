import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { ScrollArea } from "@shared/components/ui/scroll-area";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { formatRelativeTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bot, Hash, Plus, Users } from "lucide-react";
import type { Dispatch, FC, ReactNode, SetStateAction } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
	TeamBridgeNotify,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeComposeBar } from "./team-bridge-compose-bar";
import { TeamBridgeConversationMenu } from "./team-bridge-conversation-menu";
import { TeamBridgeCreateDialog } from "./team-bridge-create-dialog";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import {
	type ChiefLabels,
	type PendingSend,
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeEligibility,
	type TeamBridgeOrganization,
	type TeamBridgeRecipient,
	type TeamBridgeScope,
	type TeamBridgeTarget,
	asTeamBridgeTenantId,
	chiefsOfStaff,
	composeChiefLabel,
	conversationMemberCount,
	conversationOrganizationName,
	conversationTitle,
	directoryFailureKind,
	dmWithAgent,
	dmWithPerson,
	draftCreateInput,
	hubTenantList,
	isPreviewConversation,
	notifyFailureIsVisible,
	openPending,
	organizationOptions,
	organizationsReadState,
	participantLabel,
	pendingForThread,
	performSend,
	personDisplayLabel,
	preferredScope,
	railSections,
	recipientCandidates,
	recipientKey,
	targetConversation,
	teamBridgeEligibility,
	threadWithPending,
	unmatchedDirects,
	visibleConversationRows,
} from "./team-bridge-model";
import { TeamBridgeOrgSwitcher } from "./team-bridge-org-switcher";
import {
	ChiefRailRow,
	ConversationRailRow,
	PersonRailRow,
	RailLoading,
	RailSection,
	isTargetRow,
} from "./team-bridge-rail";
import { TeamBridgeThreadPane } from "./team-bridge-thread-pane";
import {
	type ThreadTarget,
	threadTargetFromSearch,
} from "./team-bridge-thread-read";
import { useReportTeamBridgeViewing } from "./team-bridge-viewing";
import {
	refreshAfterSend,
	teamBridgeKeys,
	useCreateTeamBridgeConversation,
	useJoinTeamBridgeConversation,
	useMarkTeamBridgeRead,
	useSetTeamBridgeNotify,
	useTeamBridgeConversations,
	useTeamBridgeDirectories,
	useTeamBridgeDirectory,
	useTeamBridgeMessages,
	useTeamBridgeStatus,
	useTeamBridgeUnread,
} from "./use-team-bridge";

/**
 * The Team Bridge page: a Slack-shaped rail, a thread and a composer.
 *
 * WHY A PAGE AND NOT A DIALOG. A conversation is a place a person returns to,
 * reads a history in and types in; a dialog would put the inbox in front of
 * the work and close on the first outside click.
 *
 * THE RAIL IS SLACK'S (operator review, 2026-10-21): Channels (the built-in
 * #humans and #agents first), Groups, People and Chiefs of staff, each with a
 * header that stays when the section is empty. A person's row IS their DM, so
 * there is never a second "@ Ben" row; see `team-bridge-rail.tsx`.
 *
 * NOTHING IS CREATED BY A CLICK. Selecting a person, a chief of staff or a
 * compose draft shows the thread if it exists and an empty, addressed draft
 * if it does not. The FIRST SEND creates the conversation (find-or-create for
 * a DM) and then posts the message with the same idempotency key, so a
 * double click, a second window or a retried send all converge on one thread.
 * This is the "consistent layer" the operator asked for: every conversation
 * the rail shows exists because someone said something in it.
 *
 * THE VIEW IS PURE. `TeamBridgePageView` takes its state as props; the
 * container below is the only place that knows about queries, which is what
 * lets the stories render every state without a backend.
 *
 * LAYOUT. Panels run the full height of the window and are separated by
 * ground (`canvas` rail, `surface` thread), never by a rule; the top inset is
 * padding inside each panel (`--panel-top-pad`), not an offset of the panel.
 */

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

/** The catalogue strings `composeChiefLabel` composes a chief's name from. */
const chiefLabelCopy = (): ChiefLabels => ({
	named: (agent, person) => t("ui.teamBridge.chief.label", { agent, person }),
	unnamed: (person) => t("ui.teamBridge.chief.unnamed", { person }),
});

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

export function absolute(
	iso: string | null | undefined,
	locale: string,
): string {
	if (!iso) return "";
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(then));
}

export function relative(iso: string, locale: string): string {
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

export type TeamBridgePageViewProps = {
	/** Presentation-only fixtures can render pane states without dispatching live queries. */
	renderThreadPane?: (target: ThreadTarget, close: () => void) => ReactNode;
	threadLink?: ThreadTarget | null;
	onCloseThread?: () => void;
	listState: "loading" | "error" | "ready";
	messageState: "idle" | "loading" | "error" | "ready";
	conversations: TeamBridgeConversation[];
	/**
	 * What the rail has selected. The view resolves the conversation it shows
	 * (if any) from this and `conversations`, so the page and the stories share
	 * one rule for "which thread is open".
	 */
	target: TeamBridgeTarget | null;
	messages: TeamBridgeMessage[];
	/**
	 * The reader's sends not yet in `messages` (already drawn into it, as rows
	 * after the confirmed ones). The list marks them Sending / Not sent.
	 */
	pendingSends?: readonly PendingSend[];
	/** Re-send a failed row with the SAME `client_ref`. */
	onRetrySend?: (clientRef: string) => void;
	/** The caller's active memberships, already joined with per-org counts. */
	organizations: TeamBridgeOrganization[];
	scope: TeamBridgeScope;
	/** The account aggregate's total; the "All organizations" row shows it. */
	totalUnread: number;
	membershipsLoading?: boolean;
	organizationsFailed?: boolean;
	selfAccountId?: string;
	/** A send (or the create-then-send of a first message) is in flight. */
	sending?: boolean;
	sendFailed?: boolean;
	joining?: boolean;
	joinFailed?: boolean;
	notifyFailed?: boolean;
	onJoin?: () => void;
	onNotifyChange?: (notify: TeamBridgeNotify) => void;
	/** Story/test seed only: opens the header menu so its rows are visible. */
	defaultMenuOpen?: boolean;
	/** Story/test seed only: the page's real draft is user-owned state. */
	initialDraft?: string;
	/** Page-lifetime, owner-scoped retention; never a cross-account fallback. */
	onDraftChange?: (draft: string) => void;
	/** The organization's directory: People and Chiefs of staff both read it. */
	people?: readonly TeamBridgeDirectoryMember[];
	/**
	 * The merged view's per-organization rosters, keyed by tenant, used ONLY to
	 * name senders and DM rows (`people` is empty there: no single roster to
	 * list). A tenant whose read has not answered is absent.
	 */
	directories?: Readonly<Record<string, readonly TeamBridgeDirectoryMember[]>>;
	/**
	 * The signed-in reader's account name, so their own messages are named even
	 * when no directory lists them (merged view, directory loading or failed).
	 */
	selfName?: string;
	peopleState?: "loading" | "error" | "ready";
	peopleError?: unknown;
	peopleIncomplete?: boolean;
	onRetryPeople?: () => void;
	eligibility?: TeamBridgeEligibility | null;
	gatePending?: boolean;
	readOnly?: boolean;
	onTarget: (target: TeamBridgeTarget) => void;
	/**
	 * Send `body`. For a target with no conversation yet the container creates
	 * it first; the view does not know or care which.
	 */
	onSend: (body: string, clientRef: string) => Promise<unknown> | undefined;
	/** Open the channel form (Channels' "+" and its empty line). */
	onNewChannel: () => void;
	onRetry?: () => void;
	onScopeChange: (scope: TeamBridgeScope) => void;
	onRetryMemberships?: () => void;
};

export const TeamBridgePageView: FC<TeamBridgePageViewProps> = ({
	renderThreadPane,
	threadLink,
	onCloseThread,
	listState,
	messageState,
	conversations,
	target,
	messages,
	pendingSends = [],
	onRetrySend,
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
	onDraftChange,
	people = [],
	directories,
	selfName,
	peopleState = "ready",
	peopleError,
	peopleIncomplete = false,
	onRetryPeople,
	eligibility = null,
	gatePending = false,
	readOnly = false,
	onTarget,
	onSend,
	onNewChannel,
	onRetry,
	onScopeChange,
	onRetryMemberships,
}) => {
	const locale = useI18nLocale();
	const [draft, setDraftState] = useState(initialDraft);
	const setDraft = (next: string) => {
		setDraftState(next);
		onDraftChange?.(next);
	};
	// Thread identity is checked against the current selection before mounting.
	const [threadSelection, setThreadSelection] = useState<ThreadTarget | null>(
		threadLink ?? null,
	);
	useEffect(() => {
		if (threadLink) setThreadSelection(threadLink);
	}, [threadLink]);
	const mergedView = scope === TEAM_BRIDGE_ALL_SCOPE;
	const identityKnown = selfAccountId !== undefined;

	const listRows = useMemo(
		() => visibleConversationRows(conversations, scope, organizations),
		[conversations, scope, organizations],
	);
	const sections = useMemo(() => railSections(listRows), [listRows]);
	const chiefs = useMemo(
		() => (mergedView ? [] : chiefsOfStaff(people, selfAccountId)),
		[mergedView, people, selfAccountId],
	);
	const chiefLabels = chiefLabelCopy();
	const self = useMemo(
		() =>
			selfAccountId && selfName?.trim()
				? { accountId: selfAccountId, name: selfName }
				: null,
		[selfAccountId, selfName],
	);
	/*
	 * Which roster names a participant: the organization's own in a single-org
	 * scope, and in the merged view the roster of the conversation's own
	 * organization (an account id is only meaningful inside its tenant).
	 */
	const rosterFor = (tenantId: string) =>
		mergedView ? (directories?.[tenantId] ?? []) : people;
	const labelFor = (
		participant: {
			account_id: string;
			kind: "human" | "agent";
			display_label: string;
		},
		tenantId: string,
	) => participantLabel(participant, rosterFor(tenantId), chiefLabels, self);
	/* A title has no "Unknown person" styling to lean on, so an unnamed peer
	   keeps the same visibly-placeholder wording the thread uses. */
	const titleFor = (
		participant: Parameters<typeof labelFor>[0],
		tenantId: string,
	) =>
		labelFor(participant, tenantId) ??
		(participant.kind === "agent"
			? t("ui.teamBridge.sender.unknown_agent")
			: t("ui.teamBridge.sender.unknown_person"));
	// The single-org rail paints DMs on People / Chiefs rows; only a DM no row
	// owns is listed on its own. The merged view has no directory, so every DM
	// is listed there.
	const looseDirects = mergedView
		? sections.directs
		: unmatchedDirects(sections.directs, people, chiefs, selfAccountId);

	const selected = targetConversation(target, listRows, selfAccountId);
	const previewSelected = selected !== null && isPreviewConversation(selected);
	const selectedOrganizationName = selected
		? conversationOrganizationName(selected, organizations)
		: null;
	const selectedOrganizationUnknown =
		mergedView && selected !== null && selectedOrganizationName === null;

	/*
	 * The pane's title for a target with no conversation yet: the person or
	 * chief it is addressed to. A compose draft has no title; its To: bar is
	 * the header.
	 */
	const draftPerson =
		target?.type === "person" || target?.type === "chief"
			? (people.find((row) => row.account_id === target.accountId) ?? null)
			: null;
	const draftChief =
		target?.type === "chief"
			? (chiefs.find((chief) => chief.person.account_id === target.accountId) ??
				null)
			: null;
	const paneTitle = selected
		? selected.kind === "dm"
			? (() => {
					const other = selected.members.find(
						(member) =>
							member.state !== "removed" &&
							!(member.kind === "human" && member.account_id === selfAccountId),
					);
					return other
						? titleFor(other, selected.tenant_id)
						: t("ui.teamBridge.list.untitled");
				})()
			: (conversationTitle(selected, selfAccountId) ??
				t("ui.teamBridge.list.untitled"))
		: draftChief
			? composeChiefLabel(
					draftChief.agentName,
					personDisplayLabel(draftChief.person),
					chiefLabels,
				)
			: draftPerson
				? personDisplayLabel(draftPerson)
				: null;

	/*
	 * The compose draft's candidates: every reachable person (not you) and
	 * every chief of staff, labelled the way the rail labels them.
	 */
	const candidates = useMemo(
		() => recipientCandidates(people, selfAccountId, chiefLabelCopy()),
		[people, selfAccountId],
	);

	const composeRecipients = target?.type === "compose" ? target.recipients : [];
	// `selected` already resolves a one-recipient draft to its existing DM
	// (`targetConversation`), so the view and the container agree on it.
	const shown = selected;
	const threadIsOpen = Boolean(
		threadSelection &&
			shown &&
			threadSelection.conversationId === shown.id &&
			threadSelection.tenantId === shown.tenant_id &&
			!previewSelected &&
			!selectedOrganizationUnknown,
	);
	// A focused window is quiet only for the conversation actually on screen.
	useReportTeamBridgeViewing(shown?.id);
	const canCompose =
		!readOnly &&
		!previewSelected &&
		!selectedOrganizationUnknown &&
		(shown !== null ||
			(target?.type === "compose" && composeRecipients.length > 0) ||
			((target?.type === "person" || target?.type === "chief") &&
				draftPerson !== null));
	/* One reaction context for the timeline AND the thread pane, so a reply can
	   be reacted to under exactly the rules its root is. */
	const reactionContext =
		selfAccountId && selected
			? {
					accountId: selfAccountId,
					tenantId: selected.tenant_id,
					disabled: !canCompose || selected.status !== "open",
				}
			: undefined;

	/*
	 * OPTIMISTIC SEND. The draft is handed over and cleared at once: the
	 * container draws the message as a pending row before any round trip, and a
	 * failure becomes a failed row with Retry on that row (the retry reuses the
	 * row's `client_ref`, so an ambiguous failure cannot post it twice). Each
	 * press mints a fresh key; the composer is never locked while a send is in
	 * flight, because the message already lives in the thread.
	 */
	const submit = () => {
		const body = draft.trim();
		if (!body || sending || !canCompose) return;
		const result = onSend(body, crypto.randomUUID());
		if (result instanceof Promise) void result.catch(() => {});
		setDraft("");
	};

	if (gatePending) return <TeamBridgeGateLoading />;
	if (eligibility) return <TeamBridgeEligibilityPanel reason={eligibility} />;

	const isSelectedConversation = (conversation: TeamBridgeConversation) =>
		target?.type === "conversation" && target.id === conversation.id;
	const startGroup = (recipient: TeamBridgeRecipient) =>
		onTarget({ type: "compose", recipients: [recipient] });
	const createDisabled = mergedView || readOnly;
	const createHint = readOnly
		? t("ui.teamBridge.read_only.note")
		: t("ui.teamBridge.scope.create_needs_org");

	const conversationRows = (rows: TeamBridgeConversation[]) => (
		<ul className="flex flex-col">
			{rows.map((conversation) => (
				<ConversationRailRow
					key={conversation.id}
					conversation={conversation}
					selected={isSelectedConversation(conversation)}
					selfAccountId={selfAccountId}
					title={
						conversation.kind === "dm"
							? (() => {
									const other = conversation.members.find(
										(member) =>
											member.state !== "removed" &&
											!(
												member.kind === "human" &&
												member.account_id === selfAccountId
											),
									);
									return other
										? titleFor(other, conversation.tenant_id)
										: undefined;
								})()
							: undefined
					}
					organizationName={
						mergedView
							? (conversationOrganizationName(conversation, organizations) ??
								t("ui.teamBridge.scope.unknown"))
							: undefined
					}
					onSelect={() =>
						onTarget({ type: "conversation", id: conversation.id })
					}
				/>
			))}
		</ul>
	);

	return (
		<div
			data-glass-region="canvas"
			className="panel-flush @container/bridge relative flex min-h-0 flex-1 w-full overflow-hidden bg-canvas"
		>
			<aside
				data-glass-region="page-sidebar"
				/* BORDERLESS CHROME: the column is separated by its own ground, not a
				   rule; the top inset is padding inside the full-height panel.
				   `bg-surface` is the ground every page sidebar paints (Settings,
				   Agents, Library) and the one `rowCurrent`'s fill is tuned against:
				   on the canvas ground the selected row measured 1.06:1 on `paper`
				   (design round 1, D2). */
				className="panel-top-pad flex w-72 shrink-0 flex-col bg-surface"
			>
				<h1 className="sr-only">{t("ui.teamBridge.page.title")}</h1>
				<header className="flex h-11 shrink-0 items-center gap-2 px-3">
					<TeamBridgeOrgSwitcher
						organizations={organizations}
						scope={scope}
						onScopeChange={onScopeChange}
						totalUnread={totalUnread}
						membershipsLoading={membershipsLoading}
						organizationsFailed={organizationsFailed}
						onRetry={onRetryMemberships}
					/>
					{/* "New message" opens an empty To: draft: a DM or a group is
					    decided by how many people the reader adds, as in Slack. */}
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label={t("ui.teamBridge.compose.new")}
						aria-disabled={createDisabled || undefined}
						title={createDisabled ? createHint : undefined}
						className={
							createDisabled
								? "text-ink-disabled hover:bg-transparent"
								: undefined
						}
						onClick={() => {
							if (!createDisabled)
								onTarget({ type: "compose", recipients: [] });
						}}
					>
						<Plus size={16} />
					</Button>
				</header>
				<ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:block!">
					{listState === "error" && (
						<div className="flex flex-col items-start gap-2 px-3 py-3">
							<p className="text-[12px] text-ink-muted">
								{t("ui.teamBridge.list.error")}
							</p>
							{onRetry && (
								<Button size="sm" variant="ghost" onClick={onRetry}>
									{t("ui.teamBridge.list.retry")}
								</Button>
							)}
						</div>
					)}
					<RailSection
						id="team-bridge-channels-heading"
						title={t("ui.teamBridge.section.channels")}
						add={
							createDisabled
								? undefined
								: {
										label: t("ui.teamBridge.section.channels_add"),
										onAdd: onNewChannel,
									}
						}
						empty={
							listState === "ready" && sections.channels.length === 0
								? {
										text: createDisabled
											? t("ui.teamBridge.section.channels_none")
											: t("ui.teamBridge.section.channels_empty"),
										onCreate: createDisabled ? undefined : onNewChannel,
									}
								: undefined
						}
					>
						{listState === "loading" ? (
							<RailLoading label={t("ui.teamBridge.list.loading")} />
						) : (
							conversationRows(sections.channels)
						)}
					</RailSection>
					<RailSection
						id="team-bridge-groups-heading"
						title={t("ui.teamBridge.section.groups")}
						add={
							createDisabled
								? undefined
								: {
										label: t("ui.teamBridge.section.groups_add"),
										onAdd: () => onTarget({ type: "compose", recipients: [] }),
									}
						}
						empty={
							listState === "ready" && sections.groups.length === 0
								? {
										text: createDisabled
											? t("ui.teamBridge.section.groups_none")
											: t("ui.teamBridge.section.groups_empty"),
										onCreate: createDisabled
											? undefined
											: () => onTarget({ type: "compose", recipients: [] }),
									}
								: undefined
						}
					>
						{listState === "loading" ? (
							<RailLoading label={t("ui.teamBridge.list.loading")} />
						) : (
							conversationRows(sections.groups)
						)}
					</RailSection>
					{looseDirects.length > 0 && (
						<RailSection
							id="team-bridge-directs-heading"
							title={t("ui.teamBridge.section.directs")}
						>
							{conversationRows(looseDirects)}
						</RailSection>
					)}
					{mergedView ? (
						<RailSection
							id="team-bridge-people-heading"
							title={t("ui.teamBridge.people.title")}
							empty={{ text: t("ui.teamBridge.people.all_scope") }}
						/>
					) : (
						<>
							<RailSection
								id="team-bridge-people-heading"
								title={t("ui.teamBridge.people.title")}
								empty={
									peopleState === "ready" && people.length === 0
										? {
												text: peopleIncomplete
													? t("ui.teamBridge.people.error")
													: t("ui.teamBridge.people.empty"),
											}
										: undefined
								}
							>
								{peopleState === "loading" ? (
									<RailLoading label={t("ui.teamBridge.people.loading")} />
								) : peopleState === "error" ? (
									<PeopleFailure error={peopleError} onRetry={onRetryPeople} />
								) : (
									<ul className="flex flex-col">
										{people.map((member) => (
											<PersonRailRow
												key={member.account_id}
												member={member}
												selfAccountId={selfAccountId}
												identityKnown={identityKnown}
												selected={isTargetRow(
													target,
													"person",
													member.account_id,
												)}
												dm={dmWithPerson(
													listRows,
													member.account_id,
													selfAccountId,
												)}
												readOnly={readOnly}
												onSelect={() =>
													onTarget({
														type: "person",
														accountId: member.account_id,
													})
												}
												onStartGroup={startGroup}
											/>
										))}
									</ul>
								)}
							</RailSection>
							<RailSection
								id="team-bridge-chiefs-heading"
								title={t("ui.teamBridge.section.chiefs")}
								empty={
									peopleState === "ready" && chiefs.length === 0
										? { text: t("ui.teamBridge.section.chiefs_empty") }
										: undefined
								}
							>
								{peopleState === "loading" ? (
									<RailLoading label={t("ui.teamBridge.people.loading")} />
								) : peopleState === "error" ? null : (
									<ul className="flex flex-col">
										{chiefs.map((chief) => (
											<ChiefRailRow
												key={chief.person.account_id}
												chief={chief}
												label={composeChiefLabel(
													chief.agentName,
													personDisplayLabel(chief.person),
													chiefLabels,
												)}
												selected={isTargetRow(
													target,
													"chief",
													chief.person.account_id,
												)}
												dm={dmWithAgent(
													listRows,
													chief.person.account_id,
													selfAccountId,
												)}
												readOnly={readOnly}
												onSelect={() =>
													onTarget({
														type: "chief",
														accountId: chief.person.account_id,
													})
												}
												onStartGroup={startGroup}
											/>
										))}
									</ul>
								)}
							</RailSection>
						</>
					)}
				</ScrollArea>
			</aside>

			{/* The ONE ground split: the rail inherits the page canvas, the thread
			    carries the surface — two regions read apart without a rule. */}
			<section
				className={cn(
					"panel-top-pad flex min-w-0 flex-1 flex-col bg-surface",
					threadIsOpen && "@max-[1024px]/bridge:invisible",
				)}
			>
				{target === null ? (
					<div className="flex flex-1 items-center justify-center px-6">
						{listState === "loading" ? (
							<Spinner size="sm" label={t("ui.teamBridge.list.loading")} />
						) : listState === "error" ? (
							/* A failed read never claims emptiness (design round 1, D7):
							   the rail already states the failure and offers Try again. */
							<p className="max-w-sm text-center text-[13px] text-ink-muted">
								{t("ui.teamBridge.list.error_pane")}
							</p>
						) : (
							<div className="max-w-sm text-center">
								<p className="font-medium text-[13px] text-ink">
									{t("ui.teamBridge.list.empty.title")}
								</p>
								<p className="mt-1 text-[13px] text-ink-muted">
									{createDisabled
										? createHint
										: t("ui.teamBridge.list.empty.body")}
								</p>
							</div>
						)}
					</div>
				) : (
					<>
						{target.type === "compose" ? (
							<TeamBridgeComposeBar
								recipients={composeRecipients}
								candidates={candidates}
								onChange={(recipients) =>
									onTarget({ type: "compose", recipients })
								}
							/>
						) : (
							<header className="flex h-11 shrink-0 items-center gap-2 px-5">
								{shown?.kind === "channel" ? (
									<Hash
										size={16}
										aria-hidden="true"
										className="shrink-0 text-ink-dim"
									/>
								) : shown?.kind === "group" ? (
									<Users
										size={16}
										aria-hidden="true"
										className="shrink-0 text-ink-dim"
									/>
								) : target.type === "chief" ? (
									<Bot
										size={16}
										aria-hidden="true"
										className="shrink-0 text-accent"
									/>
								) : null}
								<h2 className="min-w-0 truncate font-semibold text-[15px] text-ink">
									{paneTitle ?? t("ui.teamBridge.list.untitled")}
								</h2>
								{mergedView && selectedOrganizationName && (
									<span className="shrink-0 rounded-sm bg-elevated px-1.5 py-0.5 text-meta-sm text-ink-dim">
										{selectedOrganizationName}
									</span>
								)}
								{shown && shown.kind !== "dm" && (
									<span className="shrink-0 text-meta-sm text-ink-dim">
										{t("ui.teamBridge.member.count", {
											count: conversationMemberCount(shown),
										})}
									</span>
								)}
								{shown?.last_message_at && shown.latest_seq > 0 && (
									<span
										className="shrink-0 text-meta-sm text-ink-dim"
										title={absolute(shown.last_message_at, locale)}
									>
										<span aria-hidden="true">·</span>{" "}
										{relative(shown.last_message_at, locale)}
									</span>
								)}
								<div className="ml-auto flex items-center gap-1">
									{shown && !previewSelected && !readOnly && onNotifyChange && (
										<TeamBridgeConversationMenu
											conversation={shown}
											onNotifyChange={onNotifyChange}
											defaultOpen={defaultMenuOpen}
										/>
									)}
								</div>
							</header>
						)}
						{notifyFailed && (
							<p role="alert" className="px-5 pb-1 text-[12px] text-danger">
								{t("ui.teamBridge.notify.error")}
							</p>
						)}
						{shown?.builtin && (
							<p className="px-5 pb-1 text-[12px] text-ink-dim">
								{shown.builtin === "agents"
									? t("ui.teamBridge.builtin.agents_topic")
									: t("ui.teamBridge.builtin.humans_topic")}
							</p>
						)}

						<ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:block! [&_[data-radix-scroll-area-viewport]>div]:h-full">
							<div className="flex h-full flex-col">
								{previewSelected ? (
									<TeamBridgePreviewBanner
										joining={joining}
										joinFailed={joinFailed}
										readOnly={readOnly}
										onJoin={onJoin}
									/>
								) : selectedOrganizationUnknown ? (
									<p className="px-5 py-8 text-[13px] text-ink-muted">
										{t("ui.teamBridge.scope.thread_unknown")}
									</p>
								) : shown === null && messages.length === 0 ? (
									/*
									 * No thread yet: an addressed, empty draft, introduced the way
									 * Slack and Discord open an empty DM (design round 1, D5): a
									 * bottom-anchored block with the person's mark, their name and
									 * one line. The copy never says "created": that nothing is
									 * written until the first send is the code's fact, not the
									 * reader's concern. A compose draft names who it will reach
									 * (D6) instead of the generic thread line.
									 */
									<div className="mt-auto flex flex-col gap-2 px-5 pb-5">
										{target.type === "compose" ? (
											<p className="text-[13px] text-ink-muted">
												{composeRecipients.length === 0
													? t("ui.teamBridge.compose.empty")
													: t("ui.teamBridge.thread.intro_group", {
															names: composeRecipients
																.map((recipient) => recipient.label)
																.join(", "),
														})}
											</p>
										) : (
											<>
												<span
													aria-hidden="true"
													className={cn(
														"flex size-14 items-center justify-center rounded-xl font-semibold text-[22px]",
														target.type === "chief"
															? "bg-accent-wash text-accent"
															: "bg-sunken text-ink-muted",
													)}
												>
													{target.type === "chief" ? (
														<Bot size={26} />
													) : (
														(paneTitle ?? "").trim().charAt(0).toUpperCase() ||
														"?"
													)}
												</span>
												<p className="font-semibold text-[17px] text-ink">
													{paneTitle}
												</p>
												<p className="text-[13px] text-ink-muted">
													{target.type === "chief"
														? t("ui.teamBridge.thread.intro_chief", {
																name: paneTitle ?? "",
															})
														: t("ui.teamBridge.thread.intro_person", {
																name: paneTitle ?? "",
															})}
												</p>
											</>
										)}
									</div>
								) : messageState === "loading" && messages.length === 0 ? (
									<div className="flex items-center justify-center py-10">
										<Spinner
											size="sm"
											label={t("ui.teamBridge.thread.loading")}
										/>
									</div>
								) : messageState === "error" && messages.length === 0 ? (
									<p className="px-5 py-8 text-[13px] text-ink-muted">
										{t("ui.teamBridge.thread.error")}
									</p>
								) : messages.length === 0 ? (
									<p className="mt-auto px-5 pb-4 text-[13px] text-ink-muted">
										{t("ui.teamBridge.thread.empty")}
									</p>
								) : (
									<>
										{/* Rows are drawn over a failed read (pending sends, or a
										    thread that loaded before the error), so the error is a
										    line above them, never hidden (review R2-2 on #1334). */}
										{messageState === "error" && (
											<p
												role="alert"
												className="px-5 pt-3 text-[12px] text-danger"
											>
												{t("ui.teamBridge.thread.error")}
											</p>
										)}
										<TeamBridgeMessageList
											messages={messages}
											pendingSends={pendingSends}
											onRetrySend={onRetrySend}
											labelFor={(sender) =>
												labelFor(sender, shown?.tenant_id ?? "")
											}
											reactionContext={reactionContext}
											onReply={(message) => {
												if (shown)
													setThreadSelection({
														tenantId: shown.tenant_id,
														conversationId: shown.id,
														rootId: message.id,
													});
											}}
										/>
									</>
								)}
							</div>
						</ScrollArea>

						{/* THE AGENT COMPOSER'S SHAPE: one borderless box on `elevated`,
						    the field and its tools inside, Send in the bottom-right. The
						    focus ring is promoted from the textarea to the box via `:has`.
						    No composer in a preview (a non-member cannot write) and none
						    on surface F, where the reason replaces it. */}
						{!previewSelected &&
							(readOnly ? (
								<p className="shrink-0 px-5 pb-4 text-[12px] text-ink-dim leading-snug">
									{t("ui.teamBridge.read_only.composer")}
								</p>
							) : (
								<div className="shrink-0 px-4 pb-4">
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
											"rounded-xl bg-elevated transition-colors duration-fast ease-out-quart",
											"has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-solid",
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
											disabled={!canCompose}
											placeholder={
												target.type === "compose" &&
												composeRecipients.length > 0
													? t("ui.teamBridge.composer.placeholder_to", {
															name: composeRecipients
																.map((recipient) => recipient.label)
																.join(", "),
														})
													: paneTitle && target.type !== "compose"
														? t("ui.teamBridge.composer.placeholder_to", {
																name: paneTitle,
															})
														: t("ui.teamBridge.composer.placeholder")
											}
											aria-label={t("ui.teamBridge.composer.placeholder")}
											className="block max-h-40 min-h-10 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] text-ink outline-none placeholder:text-ink-dim disabled:cursor-not-allowed"
										/>
										<div className="flex items-center gap-2 px-2 pb-2">
											{/*
											 * The key hint shows only while there is something to send
											 * (design round 1, D8): permanent chrome the agent composer,
											 * Slack and Discord do not carry. The slot stays, so Send
											 * does not move when the hint appears.
											 */}
											<span
												className={cn(
													"min-w-0 flex-1 truncate pl-1.5 text-meta-sm text-ink-dim transition-opacity duration-fast",
													draft.trim() ? "opacity-100" : "opacity-0",
												)}
												aria-hidden={!draft.trim()}
											>
												{t("ui.teamBridge.composer.hint")}
											</span>
											<Button
												size="icon-sm"
												variant="primary"
												/* A rounded square, the avatar's shape (design round 1,
												   D11), not the pill the size's default radius gave. */
												className="rounded-md"
												disabled={!draft.trim() || sending || !canCompose}
												aria-label={t("ui.teamBridge.composer.send")}
												onClick={submit}
											>
												{sending ? (
													<Spinner size="sm" />
												) : (
													<ArrowUp size={16} />
												)}
											</Button>
										</div>
									</div>
								</div>
							))}
					</>
				)}
			</section>
			{/* Threads: a ground-separated sibling; no rail or compose routing changes. */}
			{threadSelection &&
				shown &&
				threadSelection.conversationId === shown.id &&
				threadSelection.tenantId === shown.tenant_id &&
				!previewSelected &&
				!selectedOrganizationUnknown && (
					/* At the supported 800px minimum a second flex column leaves only
					   152px for the timeline. Take over its whole region below 1024px,
					   rather than shrinking either reading measure. The 288px rail stays. */
					<div className="absolute inset-y-0 right-0 left-72 z-20 min-w-0 @min-[1024px]/bridge:static @min-[1024px]/bridge:w-[min(26rem,45%)] @min-[1024px]/bridge:min-w-72 @min-[1024px]/bridge:shrink-0">
						{renderThreadPane ? (
							renderThreadPane(threadSelection, () => {
								setThreadSelection(null);
								onCloseThread?.();
							})
						) : (
							<TeamBridgeThreadPane
								key={`${threadSelection.tenantId}:${threadSelection.conversationId}:${threadSelection.rootId}`}
								target={threadSelection}
								initialRoot={messages.find(
									(message) => message.id === threadSelection.rootId,
								)}
								labelFor={(sender) =>
									labelFor(sender, threadSelection.tenantId)
								}
								readOnly={readOnly}
								reactionContext={reactionContext}
								onClose={() => {
									setThreadSelection(null);
									onCloseThread?.();
								}}
							/>
						)}
					</div>
				)}
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
 * The container. It owns the queries, the rail target, and the two writes a
 * first message needs (create, then send).
 *
 * Reading a thread marks it read at the newest seq the reader has been shown;
 * the server applies `$max`, so a re-render cannot move the cursor backwards.
 */
function canWriteBridge(
	status: ReturnType<typeof useTeamBridgeStatus>["data"],
) {
	return Boolean(
		status?.account_id &&
			status.tenant_id &&
			status.state === "ready" &&
			status.local.enabled &&
			!status.read_only &&
			teamBridgeEligibility(status) === null,
	);
}

export const TeamBridgePage: FC<{ selfAccountId?: string }> = () => {
	const status = useTeamBridgeStatus();
	const [searchParams] = useSearchParams();
	const requestedTenant = searchParams.get("tenant");
	const [scope, setScope] = useState<TeamBridgeScope>(() =>
		requestedTenant
			? asTeamBridgeTenantId(requestedTenant)
			: TEAM_BRIDGE_ALL_SCOPE,
	);
	const scopeChosen = useRef(Boolean(requestedTenant));
	// Retain private DATA for a returning owner, only within this mounted page.
	// Never retain executable retry closures: a new epoch must recheck authority.
	const drafts = useRef(new Map<string, string>());
	const retainedPending = useRef(new Map<string, PendingSend[]>());
	const draftOwner = JSON.stringify([
		status.data?.account_id,
		status.data?.tenant_id,
		scope,
	]);
	/*
	 * Optimistic projections, retry closures and create coalescing all belong
	 * to ONE authority lifetime. A keyed container replaces them in the
	 * identity-changing commit, not an effect after another account has painted.
	 * Ordinary polls keep this key, preserving legitimate failed-send retries.
	 * Losing resolved status/write authority ends the lifetime even if the same
	 * account later returns; an old asynchronous request cannot revive it.
	 */
	const owner = JSON.stringify([
		status.data?.account_id,
		status.data?.tenant_id,
		scope,
		canWriteBridge(status.data),
	]);
	return (
		<TeamBridgeOwnedPage
			key={owner}
			status={status}
			scope={scope}
			setScope={setScope}
			scopeChosen={scopeChosen}
			drafts={drafts.current}
			draftOwner={draftOwner}
			retainedPending={retainedPending.current}
		/>
	);
};

const TeamBridgeOwnedPage: FC<{
	status: ReturnType<typeof useTeamBridgeStatus>;
	scope: TeamBridgeScope;
	setScope: Dispatch<SetStateAction<TeamBridgeScope>>;
	scopeChosen: { current: boolean };
	drafts: Map<string, string>;
	draftOwner: string;
	retainedPending: Map<string, PendingSend[]>;
}> = ({
	status,
	scope,
	setScope,
	scopeChosen,
	drafts,
	draftOwner,
	retainedPending,
}) => {
	/*
	 * A banner click lands here with `?tenant=…&conversation=…`. The parameters
	 * seed the FIRST render so the clicked conversation wins over the landing
	 * effect below, then are cleared so a refetch cannot re-select it.
	 */
	const [searchParams, setSearchParams] = useSearchParams();
	const requestedConversation = searchParams.get("conversation");
	const requestedTenant = searchParams.get("tenant");
	const requestedRoot = searchParams.get("thread");
	const [threadLink, setThreadLink] = useState<ThreadTarget | null>(() =>
		threadTargetFromSearch(searchParams),
	);
	// THE GATE IS THE FIRST READ (round-1 U-6): until it answers, every other
	// read is disabled, so an ineligible account issues no refused requests.
	const eligibility = status.data ? teamBridgeEligibility(status.data) : null;
	const gatePending = status.isPending;
	const readsEnabled = !gatePending && eligibility === null;
	const selfAccountId = status.data?.account_id ?? undefined;
	const readOnly = !canWriteBridge(status.data);
	const client = useQueryClient();
	const mounted = useRef(true);
	useLayoutEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	// Consult the live cache too: a reply may land after status changes but
	// before React commits the replacement owner. Unmount alone is not a fence.
	const isCurrentOwner = () => {
		const current = client.getQueryData<NonNullable<typeof status.data>>(
			teamBridgeKeys.status,
		);
		return (
			mounted.current &&
			canWriteBridge(current) &&
			current?.account_id === status.data?.account_id &&
			current?.tenant_id === status.data?.tenant_id
		);
	};
	// The hub's status `tenants[]` is the switcher's and the merged filter's
	// authoritative source; memberships only label it (and stand in when the
	// status has no tenant list). Filtering by memberships alone dropped every
	// row of a hub tenant the memberships read lacked (F6 on #1314). The
	// account aggregate is the ONE unread read — the same cache entry the
	// sidebar badge spends. Per-org counts are joined from that payload, never
	// fetched per org.
	const memberships = useMembershipsQuery({ enabled: readsEnabled });
	const unread = useTeamBridgeUnread(readsEnabled, TEAM_BRIDGE_ALL_SCOPE);
	const hubTenants = hubTenantList(status.data);
	const organizations = useMemo(
		() =>
			organizationOptions(
				memberships.memberships,
				unread.data?.organizations,
				hubTenants,
			),
		[memberships.memberships, unread.data, hubTenants],
	);
	const { pending: organizationsPending, failed: organizationsFailed } =
		organizationsReadState(hubTenants, memberships);
	const list = useTeamBridgeConversations(scope, readsEnabled);
	const directory = useTeamBridgeDirectory(
		scope === TEAM_BRIDGE_ALL_SCOPE ? null : scope,
		readsEnabled,
	);
	const mergedView = scope === TEAM_BRIDGE_ALL_SCOPE;
	// Names only (see `useTeamBridgeDirectories`): the merged view lists no
	// roster, but its threads and DM rows still need their senders named.
	const directories = useTeamBridgeDirectories(
		mergedView
			? organizations.map((organization) => organization.tenantId)
			: [],
		readsEnabled,
	);
	// The reader's own name for their own messages; `user` is null until the
	// account read answers, never the user store's placeholder name.
	const selfName = useRadientAuth().user?.name ?? undefined;
	const conversations = list.data?.conversations ?? [];
	const people = directory.data?.members ?? [];
	// The channel form offers the same people and chiefs of staff as the To: bar.
	const channelCandidates = recipientCandidates(
		people,
		selfAccountId,
		chiefLabelCopy(),
	);

	const [target, setTarget] = useState<TeamBridgeTarget | null>(() =>
		requestedConversation
			? { type: "conversation", id: requestedConversation }
			: null,
	);
	const [channelFormOpen, setChannelFormOpen] = useState(false);

	useEffect(() => {
		if (!requestedConversation || !requestedTenant) return;
		scopeChosen.current = true;
		setScope(asTeamBridgeTenantId(requestedTenant));
		setTarget({ type: "conversation", id: requestedConversation });
		setThreadLink(
			threadTargetFromSearch(
				new URLSearchParams({
					tenant: requestedTenant,
					conversation: requestedConversation,
					...(requestedRoot ? { thread: requestedRoot } : {}),
				}),
			),
		);
		setChannelFormOpen(false);
		setSearchParams({}, { replace: true });
	}, [
		requestedConversation,
		requestedTenant,
		requestedRoot,
		setSearchParams,
		scopeChosen,
		setScope,
	]);

	// A conversation id and a person both belong to one organization; a scope
	// change clears the target so a stale thread is never shown under a new title.
	const changeScope = (next: TeamBridgeScope) => {
		scopeChosen.current = true;
		setScope(next);
		setThreadLink(null);
		setTarget(null);
		setChannelFormOpen(false);
	};

	// The organization list (hub tenants, or memberships without them) resolves
	// after the first paint; adopt the only one unless
	// the reader has already picked a scope. A later unread poll re-renders the
	// options array, so the equality check keeps this to the one transition.
	useEffect(() => {
		setScope((current) =>
			preferredScope(organizations, current, scopeChosen.current),
		);
	}, [organizations, scopeChosen.current, setScope]);

	const visibleConversations = useMemo(
		() => visibleConversationRows(conversations, scope, organizations),
		[conversations, scope, organizations],
	);

	// Land on the first rail row once (built-ins lead), not on every refetch:
	// a poll must not move the reader out of the thread they are reading.
	useEffect(() => {
		if (target === null && visibleConversations.length > 0) {
			const first =
				visibleConversations.find((row) => row.builtin === "humans") ??
				visibleConversations[0];
			setTarget({ type: "conversation", id: first.id });
		}
	}, [visibleConversations, target]);

	const selected = targetConversation(
		target,
		visibleConversations,
		selfAccountId,
	);
	const previewSelected = selected !== null && isPreviewConversation(selected);
	// Every thread read and write names the SELECTED conversation's tenant, not
	// the rail scope, so a merged-view row can never be read under another org.
	const messages = useTeamBridgeMessages(
		previewSelected ? null : (selected?.id ?? null),
		selected?.tenant_id,
		readsEnabled,
	);
	const create = useCreateTeamBridgeConversation(
		mergedView ? undefined : scope,
		isCurrentOwner,
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

	/*
	 * WHO A DRAFT IS ADDRESSED TO, resolved from the directory at send time so
	 * the label written into the conversation is the live name and the agent
	 * endpoint is the one the directory publishes now.
	 */
	const draftRecipients = (): TeamBridgeRecipient[] => {
		if (target === null) return [];
		if (target.type === "compose") return target.recipients;
		if (target.type === "person") {
			const person = people.find((row) => row.account_id === target.accountId);
			return person
				? [
						{
							kind: "human",
							accountId: person.account_id,
							label: personDisplayLabel(person),
						},
					]
				: [];
		}
		if (target.type === "chief") {
			const chief = chiefsOfStaff(people, selfAccountId).find(
				(row) => row.person.account_id === target.accountId,
			);
			return chief
				? [
						{
							kind: "agent",
							accountId: chief.person.account_id,
							endpointId: chief.endpointId,
							agentName: chief.agentName,
							ownerLabel: personDisplayLabel(chief.person),
							label: composeChiefLabel(
								chief.agentName,
								personDisplayLabel(chief.person),
								chiefLabelCopy(),
							),
						},
					]
				: [];
		}
		return [];
	};

	/*
	 * SEND, CREATING ON FIRST MESSAGE. With a conversation selected this is a
	 * plain send. Without one, the draft's recipients become a create request
	 * (DM for one, private group for several); the server's DM find-or-create
	 * makes a repeat land on the same row. The message is then posted to the
	 * returned id with the SAME client_ref the view minted, so a retry after an
	 * ambiguous failure cannot post it twice. The target is re-pointed at the
	 * new conversation only for a compose draft: a person/chief target already
	 * resolves to its DM once the list refetches, and keeping it keeps the
	 * person's row highlighted.
	 */
	/*
	 * THE CONVERSATION A DRAFT ALREADY CREATED, keyed by the draft's identity
	 * (review round 1, R1-2). A first send is two writes: create, then post.
	 * When the create lands and the post fails, the target is still the draft,
	 * so a retry would create AGAIN: harmless for a DM (find-or-create) but a
	 * second, duplicate GROUP, because groups are not find-or-create and the
	 * `client_ref` only dedupes inside one conversation. The retry reuses the
	 * remembered id instead, so a group draft creates at most one group however
	 * many times the post is retried. A ref, not state: nothing renders from it.
	 */
	const createdForDraft = useRef(
		new Map<string, { id: string; tenantId: string | undefined }>(),
	);
	/*
	 * The target the reader is looking at NOW, for an async send to compare
	 * against after it resolves (review round 1, R1-6): the closure's `target`
	 * is the one from the render that started the send.
	 */
	const targetRef = useRef(target);
	targetRef.current = target;

	/*
	 * OPTIMISTIC SENDS (see `PendingSend` in the model for the matching and
	 * ordering rules). `pending` is what renders; `attempts` holds, per
	 * `client_ref`, the closure that (re)runs that send, so Retry on a failed row
	 * repeats the SAME request with the SAME key and the same remembered
	 * conversation, whatever is selected by then.
	 */
	const [pending, setPendingState] = useState<PendingSend[]>(() =>
		(retainedPending.get(draftOwner) ?? []).map((row) => ({
			...row,
			// The previous epoch cannot acknowledge or continue this request. Keep
			// its body/ref for this owner without pretending it is still sending.
			status: row.status === "sending" ? "failed" : row.status,
		})),
	);
	const setPending = (update: (rows: PendingSend[]) => PendingSend[]) =>
		setPendingState((rows) => {
			const next = update(rows);
			retainedPending.set(draftOwner, next);
			return next;
		});
	const attempts = useRef(new Map<string, () => Promise<void>>());
	const patchPending = (clientRef: string, patch: Partial<PendingSend>) =>
		setPending((rows) =>
			rows.map((row) =>
				row.clientRef === clientRef ? { ...row, ...patch } : row,
			),
		);

	/* The key of the unsent draft on screen; null when a thread exists. */
	const draftKeyOf = (): string | null => {
		const recipients = draftRecipients();
		const input = draftCreateInput(recipients);
		if (input === null) return null;
		return `${mergedView ? "*" : scope}|${input.kind}|${recipients
			.map(recipientKey)
			.sort()
			.join(",")}`;
	};
	const screenDraftKey = selected === null ? draftKeyOf() : null;
	const composerKey = JSON.stringify([draftOwner, selected?.tenant_id, target]);
	const confirmed = messages.data?.messages ?? [];
	const threadPending = pendingForThread(
		pending.filter(
			(row) =>
				row.tenantId ===
				(selected?.tenant_id ?? (mergedView ? undefined : scope)),
		),
		selected?.id ?? null,
		screenDraftKey,
	);

	const sendBody = async (body: string, clientRef: string) => {
		if (!isCurrentOwner()) return;
		const recipients = selected === null ? draftRecipients() : [];
		const input = selected === null ? draftCreateInput(recipients) : null;
		if (selected === null && input === null) return undefined;
		const draftKey = selected === null ? draftKeyOf() : null;
		const startedOn = target;
		const restored = threadPending.find((row) => row.clientRef === clientRef);
		const conversationId = restored?.conversationId ?? selected?.id ?? null;
		const tenantId = selected?.tenant_id ?? (mergedView ? undefined : scope);
		setPending((rows) => [
			...rows.filter((row) => row.clientRef !== clientRef),
			{
				clientRef,
				body,
				createdAt: new Date().toISOString(),
				tenantId,
				conversationId,
				draftKey,
				baselineSeq: confirmed.reduce((max, m) => Math.max(max, m.seq), -1),
				status: "sending",
			},
		]);
		const attempt = async () => {
			if (!isCurrentOwner()) return;
			patchPending(clientRef, { status: "sending" });
			const outcome = await performSend({
				conversationId,
				tenantId,
				draftKey,
				input,
				draftTenantId: mergedView ? undefined : scope,
				body,
				clientRef,
				remembered: createdForDraft.current,
				create: async (createInput) => {
					const created = await create.mutateAsync(createInput);
					// Guard BEFORE sendFirstMessage remembers/coalesces the result,
					// not merely after its create-and-post sequence has completed.
					if (!isCurrentOwner())
						throw new Error("Team Bridge write authority changed");
					return created as { id?: string; tenant_id?: string };
				},
				// Straight to the API rather than a mutation hook bound to the
				// conversation selected at RENDER time (a just-created row is not
				// selected yet).
				post: (id, message) => {
					if (!isCurrentOwner())
						throw new Error("Team Bridge write authority changed");
					return TeamBridgeApi.send(id, message);
				},
				// Adopt the created conversation the moment it exists, so a copy
				// arriving before the POST resolves is matched to it.
				onCreated: (created) =>
					isCurrentOwner() &&
					patchPending(clientRef, {
						conversationId: created.id,
						tenantId: created.tenantId,
					}),
			});
			if (!isCurrentOwner()) return;
			if (!outcome.ok) {
				patchPending(clientRef, { status: "failed" });
				return;
			}
			patchPending(clientRef, {
				status: "sent",
				conversationId: outcome.id,
				tenantId: outcome.tenantId,
				confirmedId: outcome.confirmedId,
				sentAt: Date.now(),
			});
			/*
			 * Move to the new group only if the reader is STILL on the draft that
			 * sent it. A person or chief target needs no move: once the list
			 * refetches, the same target resolves to the new DM by itself.
			 */
			if (startedOn?.type === "compose" && targetRef.current === startedOn) {
				setTarget({ type: "conversation", id: outcome.id });
			}
			// The message is sent. A failed refresh is the next poll's to repeat,
			// never a reason to show the message as unsent.
			try {
				await refreshAfterSend(
					client,
					outcome.id,
					outcome.tenantId,
					isCurrentOwner,
				);
				if (isCurrentOwner() && conversationId === null) await list.refetch();
			} catch {
				return;
			}
		};
		attempts.current.set(clientRef, attempt);
		return attempt();
	};
	const retrySend = (clientRef: string) => {
		if (!isCurrentOwner()) return;
		const attempt = attempts.current.get(clientRef);
		if (attempt) {
			void attempt();
			return;
		}
		// A returning owner's retained row is data, not the old owner's closure.
		// Rebind only the visible owner/tenant's row, preserving idempotency.
		const restored = threadPending.find((row) => row.clientRef === clientRef);
		if (restored) void sendBody(restored.body, restored.clientRef);
	};

	// A refusal belongs to the conversation it happened in.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the selection changes.
	useEffect(() => {
		join.reset();
		notify.reset();
	}, [selected?.id, target]);

	/*
	 * Forget a pending entry once the server's copy is in the thread: it is
	 * drawn from the confirmed list from then on (`openPending` already stops
	 * drawing it; this releases the state and the retry closure).
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: run when a read lands.
	useEffect(() => {
		if (threadPending.length === 0) return;
		const open = new Set(
			openPending(confirmed, threadPending, selfAccountId).map(
				(row) => row.clientRef,
			),
		);
		// A SENT row is released once a read that started after its POST has
		// landed on its thread (the send refetches, and a refetch cancels an
		// older in-flight poll): whatever the server stored is then in
		// `confirmed`, so a pending copy must not outlive it, even if the server
		// rewrote the body and no matching rule claimed it (review R1-4/R1-6).
		const readAfter = (row: PendingSend) =>
			row.status === "sent" &&
			row.sentAt !== undefined &&
			!messages.isFetching &&
			messages.dataUpdatedAt > row.sentAt &&
			row.conversationId === selected?.id;
		const claimed = threadPending.filter(
			(row) => !open.has(row.clientRef) || readAfter(row),
		);

		if (claimed.length === 0) return;
		for (const row of claimed) attempts.current.delete(row.clientRef);
		const drop = new Set(claimed.map((row) => row.clientRef));
		setPending((rows) => rows.filter((row) => !drop.has(row.clientRef)));
	}, [messages.data, messages.isFetching]);

	const newest = messages.data?.messages.reduce<number | undefined>(
		(max, message) =>
			max === undefined || message.seq > max ? message.seq : max,
		undefined,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: advance the cursor only when the conversation or its newest seq changes.
	useEffect(() => {
		if (selected === null || newest === undefined) return;
		if (newest <= selected.last_read_seq) return;
		markRead.mutate({ seq: newest });
	}, [selected?.id, newest]);

	return (
		<>
			<TeamBridgePageView
				key={composerKey}
				initialDraft={drafts.get(composerKey) ?? ""}
				onDraftChange={(body) => {
					if (body) drafts.set(composerKey, body);
					else drafts.delete(composerKey);
				}}
				threadLink={threadLink}
				onCloseThread={() => setThreadLink(null)}
				listState={
					list.isPending || (mergedView && organizationsPending)
						? "loading"
						: list.isError || (mergedView && organizationsFailed)
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
				target={target}
				messages={threadWithPending(
					confirmed,
					threadPending,
					selfAccountId
						? { accountId: selfAccountId, label: selfName ?? "" }
						: null,
				)}
				pendingSends={threadPending}
				onRetrySend={retrySend}
				organizations={organizations}
				scope={scope}
				totalUnread={unread.data?.total ?? 0}
				membershipsLoading={organizationsPending}
				organizationsFailed={organizationsFailed}
				selfAccountId={selfAccountId}
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
				onTarget={(next) => {
					setThreadLink(null);
					setChannelFormOpen(false);
					setTarget(next);
				}}
				onSend={sendBody}
				onNewChannel={() => {
					if (readOnly || mergedView) return;
					setChannelFormOpen(true);
				}}
				people={people}
				directories={directories}
				selfName={selfName}
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
				open={
					channelFormOpen && !readOnly && !gatePending && eligibility === null
				}
				candidates={channelCandidates}
				pending={create.isPending}
				error={create.isError ? t("ui.teamBridge.create.error") : undefined}
				onClose={() => setChannelFormOpen(false)}
				onCreate={(input) => {
					if (!isCurrentOwner()) return;
					create.mutate(input, {
						onSuccess: (created) => {
							if (!isCurrentOwner()) return;
							setChannelFormOpen(false);
							const conversation = created as { id?: string };
							if (conversation.id)
								setTarget({ type: "conversation", id: conversation.id });
						},
					});
				}}
			/>
		</>
	);
};
