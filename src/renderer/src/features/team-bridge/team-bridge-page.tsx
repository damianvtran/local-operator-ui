import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { TEAM_BRIDGE_ENABLED_SETTING_KEY } from "@features/settings/promoted-setting-sections";
import {
	type DesktopFeatureState,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { Spinner } from "@shared/components/common/spinner";
import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { Button } from "@shared/components/ui/button";
import { ScrollArea } from "@shared/components/ui/scroll-area";
import {
	observedRadientAuthority,
	radientAuthoritySignedOut,
	subscribeRadientAuthority,
} from "@shared/hooks/radient-account-authority";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { formatRelativeTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import {
	Archive,
	ArrowUp,
	Bot,
	Clock,
	Hash,
	MailPlus,
	Pencil,
	Plus,
	Users,
} from "lucide-react";
import type { FC, ReactNode } from "react";
import {
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
	TeamBridgeAttachmentCapability,
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
	TeamBridgeNotify,
} from "../../../../shared/team-bridge-contract";
import { rowCurrent } from "../chat/components/chat-sidebar";
import {
	TeamBridgeArchiveDialog,
	TeamBridgeArchivedBanner,
	TeamBridgeArchivedChannelsView,
	TeamBridgeDeleteDialog,
	archiveChannelName,
} from "./team-bridge-archive";
import {
	teamBridgeOpenEmptyArrivals,
	teamBridgeSuspendArrivals,
} from "./team-bridge-arrival-model";
import {
	TeamBridgeAttachButton,
	TeamBridgeAttachmentStrip,
	attachmentPasteHandlers,
} from "./team-bridge-attachments";
import {
	attachmentCapability,
	isAttachmentNotFound,
} from "./team-bridge-attachments-model";
import { TeamBridgeComposeBar } from "./team-bridge-compose-bar";
import { TeamBridgeConversationMenu } from "./team-bridge-conversation-menu";
import { TeamBridgeCreateDialog } from "./team-bridge-create-dialog";
import { TeamBridgeDefaultOnBanner } from "./team-bridge-default-on-banner";
import { draftTargetKey } from "./team-bridge-drafts";
import { TeamBridgeHeldAttempt } from "./team-bridge-held-attempt";
import { TeamBridgeInvitations } from "./team-bridge-invitations";
import {
	pendingAgentInvitations,
	railInvitationsEntryShown,
} from "./team-bridge-invitations-model";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import {
	type ChiefLabels,
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeEligibility,
	type TeamBridgeOrganization,
	type TeamBridgeRecipient,
	type TeamBridgeScope,
	type TeamBridgeTarget,
	archivedChannelRows,
	asTeamBridgeTenantId,
	canArchiveConversation,
	canManageArchivedConversation,
	chiefsOfStaff,
	composeChiefLabel,
	conversationMemberCount,
	conversationMembershipCounts,
	conversationOrganizationName,
	conversationTitle,
	directoryFailureKind,
	dmWithAgent,
	dmWithPerson,
	draftCreateInput,
	hubTenantList,
	isNotAMemberRefusal,
	isPreviewConversation,
	landingAfterRemoval,
	notifyFailureIsVisible,
	organizationOptions,
	organizationsReadState,
	participantLabel,
	personDisplayLabel,
	preferredScope,
	railSections,
	recipientCandidates,
	recipientKey,
	selectableConversations,
	targetConversation,
	teamBridgeEligibility,
	unmatchedDirects,
	visibleConversationRows,
} from "./team-bridge-model";
import { TeamBridgeOrgSwitcher } from "./team-bridge-org-switcher";
import { useBridgeOwner, useTeamBridgeAccount } from "./team-bridge-owner";
import {
	TeamBridgeAvatar,
	TeamBridgeProfileCard,
} from "./team-bridge-profile-card";
import {
	ChiefRailRow,
	ConversationRailRow,
	PersonRailRow,
	RailLoading,
	RailSection,
	isTargetRow,
} from "./team-bridge-rail";
import { teamBridgeReactionsAvailable } from "./team-bridge-reaction-gate";
import {
	TeamBridgeScheduleDialog,
	TeamBridgeScheduledList,
} from "./team-bridge-scheduled";
import {
	canResetScheduleAttempt,
	scheduleTeamBridgeDraft,
	scheduledTargetAfterSuccess,
} from "./team-bridge-scheduling";
import type { TeamBridgeLocalRowPresentation } from "./team-bridge-send-presentation";
import {
	TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD,
	teamBridgeThreadsAvailable,
} from "./team-bridge-thread-gate";
import { TeamBridgeThreadPane } from "./team-bridge-thread-pane";
import {
	type ThreadTarget,
	threadTargetFromSearch,
} from "./team-bridge-thread-read";
import { useReportTeamBridgeViewing } from "./team-bridge-viewing";
import { useComposerAutoGrow } from "./use-composer-autogrow";
import { useStickToBottom } from "./use-stick-to-bottom";
import {
	useArchiveTeamBridgeConversation,
	useArchivedTeamBridgeConversations,
	useCreateTeamBridgeConversation,
	useDeleteTeamBridgeConversation,
	useJoinTeamBridgeConversation,
	useLoadMoreArchivedTeamBridgeConversations,
	useMarkTeamBridgeRead,
	useSetTeamBridgeNotify,
	useTeamBridgeConversations,
	useTeamBridgeDirectories,
	useTeamBridgeDirectory,
	useTeamBridgeMessages,
	useTeamBridgeStatus,
	useTeamBridgeUnread,
	useUnarchiveTeamBridgeConversation,
} from "./use-team-bridge";
import {
	type AttachmentChip,
	useTeamBridgeAttachments,
} from "./use-team-bridge-attachments";
import { useTeamBridgeDrafts } from "./use-team-bridge-drafts";
import {
	outboxTargetKey,
	teamBridgePurgeAccount,
	useTeamBridgeOutbox,
} from "./use-team-bridge-outbox";

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
 * THE THREAD SURFACE IS HELD CLOSED IN THIS BUILD. The pane and the
 * reply-in-thread affordance mount only when `teamBridgeThreadsAvailable` says
 * so, which requires BOTH the shipped-in-this-build constant and a
 * `team_bridge_threads` capability answer of exactly `enabled`. The reason and
 * the fail-closed rule live in `team-bridge-thread-gate.ts`; the short version
 * is that the thread cache/retry paths inherit the #1304 cross-account
 * isolation defects, so a runtime advertising the route is not clearance to
 * run them. `unknown` (no answer yet, or the read failed), `below-version` and
 * `unpaired` hide the surface too - never infer `enabled` from the absence of
 * an error.
 *
 * REACTIONS ARE HELD IN THIS BUILD. The shipped runtime serves no reaction
 * path, and the old reaction path is not reviewed for account/retry safety, so
 * the reaction context is withheld even when `team_bridge_reactions` answers
 * `enabled`: no chips, no toolbar react button and no picker, rather than
 * controls that fail. The constant dominates the capability
 * (`team-bridge-reaction-gate.ts`); enabling reactions is a deliberate flip.
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

/** The localized forms shared by every chief label and storage decision. */
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
 *
 * THE ONE EXCEPTION IS `off` (design round 1, D1). The member turned Team
 * Bridge off themselves, so there IS a way forward, and a gate that only says
 * "turning it on again is possible" is a dead end. The panel names the product
 * the member just pressed Turn off on (Team Bridge, never the older "Agent
 * messages"), says what being off means, and links to the Settings control
 * that turns it back on. The link is NAVIGATION, not an Enable: it lands on
 * Settings -> Team Bridge with the way-back control focused, and that control
 * keeps its own consent semantics (the served text above "Turn on again").
 * It reuses the promoted `?setting=team_bridge.enabled` deep link, which
 * already resolves to that section (`promoted-setting-sections.ts`).
 *
 * `off_local` (review R2-2) is the same gate for a member who turned off only
 * "Enabled on this machine": the account stays enrolled and the way back is
 * that switch, which collects no consent. Its copy says so; reusing the
 * account-level "off for this account ... asks for your consent" text would
 * misdescribe both the scope and the step.
 */
export const TeamBridgeEligibilityPanel: FC<{
	reason: TeamBridgeEligibility;
}> = ({ reason }) => {
	useI18nLocale();
	const copy = {
		// Member opt-out is a plain state, not an organization-plan upsell.
		off: {
			title: "ui.agentMessages.page_off.title", // i18n: ignore catalogue key for t(); the gate's key pattern is lower-case only
			reason: "ui.agentMessages.page_off.body",
		},
		off_local: {
			title: "ui.agentMessages.page_off.local_title", // i18n: ignore catalogue key for t(); the gate's key pattern is lower-case only
			reason: "ui.agentMessages.page_off.local_body",
		},
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
					{reason !== "off" && reason !== "off_local" && (
						<p className="text-pretty text-[13px] leading-relaxed text-ink-muted">
							{t("ui.teamBridge.plan.body")}
						</p>
					)}
					<p className="mt-4 text-[12px] leading-snug text-ink-dim">
						{t(copy[reason].reason)}
					</p>
					{(reason === "off" || reason === "off_local") && (
						<Button asChild variant="secondary" size="sm" className="mt-4">
							<Link
								to={`/settings?setting=${TEAM_BRIDGE_ENABLED_SETTING_KEY}`}
								data-team-bridge-off-action="settings"
							>
								{t("ui.agentMessages.page_off.action")}
							</Link>
						</Button>
					)}
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

type OwnedDraft = {
	body: string;
	pending: { body: string; clientRef: string } | null;
};

export type TeamBridgePageViewProps = {
	/** Page-lifetime data journal; no live mutation closure survives an auth epoch. */
	draftJournal?: OwnedDraft;
	isDraftCurrent?: () => boolean;
	/** Presentation-only fixtures can render pane states without dispatching live queries. */
	renderThreadPane?: (target: ThreadTarget, close: () => void) => ReactNode;
	threadLink?: ThreadTarget | null;
	onCloseThread?: () => void;
	listState: "loading" | "error" | "ready";
	/**
	 * `forbidden`: the server answered `not_a_member` for the history of an ARCHIVED
	 * channel the caller can administer but never joined (an org owner/admin). It is
	 * its own state because "you may manage this but not read it" is neither a load
	 * failure nor an empty channel.
	 */
	messageState: "idle" | "loading" | "error" | "ready" | "forbidden";
	conversations: TeamBridgeConversation[];
	/**
	 * What the rail has selected. The view resolves the conversation it shows
	 * (if any) from this and `conversations`, so the page and the stories share
	 * one rule for "which thread is open".
	 */
	target: TeamBridgeTarget | null;
	messages: TeamBridgeMessage[];
	/** One shared outbox projection for existing and not-yet-created threads. */
	sendRows?: ReadonlyMap<string, TeamBridgeLocalRowPresentation>;
	/** A compose group resolves from its create receipt without changing the target/key. */
	resolvedConversation?: TeamBridgeConversation | null;
	/**
	 * Take a failed send out of the journal and hand its payload back, so the
	 * composer that authored it can restore the text and images. Returns null
	 * when the row is no longer the caller's to take (owner, tenant or state).
	 */
	onTakeBackSend?: (
		clientRef: string,
		tenantId: string,
	) => { body: string; attachments: readonly AttachmentChip[] } | null;
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
	/**
	 * ARCHIVE / PERMANENT DELETE. Each is optional so a mount that does not wire
	 * them (a story, an older container) simply draws none of the controls.
	 * `onArchive` is optimistic and fire-and-forget; `onDelete` resolves only when
	 * the server has erased the channel, because the dialog stays open on it.
	 */
	onArchive?: (conversation: TeamBridgeConversation) => void;
	onUnarchive?: (conversation: TeamBridgeConversation) => void;
	onDelete?: (conversation: TeamBridgeConversation) => Promise<unknown>;
	unarchiveFailed?: boolean;
	/** The Archived channels view's read (loaded the first time it is opened). */
	archivedState?: "loading" | "error" | "ready";
	archivedConversations?: TeamBridgeConversation[];
	/** More archived pages exist (the server's `has_more`); "Load more" appends the next. */
	archivedHasMore?: boolean;
	archivedLoadingMore?: boolean;
	archivedLoadMoreFailed?: boolean;
	onLoadMoreArchived?: () => void;
	onOpenArchived?: () => void;
	onRetryArchived?: () => void;
	/** Story/test seeds: open the view, or a confirm dialog, in its resting state. */
	initialQuickView?: "archived";
	initialDialog?: { kind: "archive" | "delete"; conversationId: string };
	/**
	 * The `team_bridge_threads` capability answer, computed by the container from
	 * `useDesktopCapabilities()`. Defaults to `unknown` so a caller that has not
	 * asked - a story, a test, a mount without a capabilities provider - gets the
	 * held, fail-closed surface rather than an assumed one.
	 */
	threadsCapabilityState?: DesktopFeatureState;
	/**
	 * The `team_bridge_reactions` capability answer, computed by the container.
	 * Defaults to `unknown`, so a surface that has not asked gets no reaction
	 * controls rather than an assumed one.
	 */
	reactionsCapabilityState?: DesktopFeatureState;
	/** Story/test seed only: opens the header menu so its rows are visible. */
	defaultMenuOpen?: boolean;
	/** Story/test seed only: the page's real draft is user-owned state. */
	initialDraft?: string;
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
	/**
	 * A band above the thread pane (the default-on first-run notice). A slot
	 * rather than a prop bag so the pure view stays ignorant of the notice's
	 * reads and writes, which live in its container.
	 */
	notice?: ReactNode;
	onTarget: (target: TeamBridgeTarget | null) => void;
	/**
	 * Send `body`. For a target with no conversation yet the container creates
	 * it first; the view does not know or care which.
	 */
	onSend: (
		body: string,
		clientRef: string,
		attachments?: {
			/* Ids already staged in the selected conversation. */
			ids: readonly string[];
			/** Snapshot transferred to the outbox only after synchronous acceptance. */
			chips?: readonly AttachmentChip[];
			/* Stage held images into a just-created conversation; throws on failure. */
			stageHeld?: (
				conversationId: string,
				tenantId: string | undefined,
			) => Promise<string[]>;
		},
	) => Promise<unknown> | { queued: true } | undefined;
	/*
	 * The hub's image capability (`status.attachments`), or null/absent when it
	 * has none: every attach affordance is then hidden and a pasted image gets
	 * the "not supported" note instead of a chip.
	 */
	attachmentCapability?: TeamBridgeAttachmentCapability | null;
	/** Open the channel form (Channels' "+" and its empty line). */
	onSchedule?: (
		body: string,
		clientRef: string,
		sendAt: string,
		conversationId: string | undefined,
		onCreated: (id: string) => void,
		attachments?: {
			ids: readonly string[];
			stageHeld?: (
				conversationId: string,
				tenantId: string,
			) => Promise<string[]>;
		},
	) => Promise<unknown>;
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
	sendRows,
	resolvedConversation,
	onTakeBackSend,
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
	onArchive,
	onUnarchive,
	onDelete,
	unarchiveFailed = false,
	archivedState = "ready",
	archivedConversations = [],
	archivedHasMore = false,
	archivedLoadingMore = false,
	archivedLoadMoreFailed = false,
	onLoadMoreArchived,
	onOpenArchived,
	onRetryArchived,
	initialQuickView,
	initialDialog,
	threadsCapabilityState = "unknown",
	reactionsCapabilityState = "unknown",
	defaultMenuOpen = false,
	initialDraft = "",
	draftJournal,
	isDraftCurrent = () => true,
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
	notice = null,
	onTarget,
	onSend,
	onSchedule,
	attachmentCapability: imageCapability = null,
	onNewChannel,
	onRetry,
	onScopeChange,
	onRetryMemberships,
}) => {
	const locale = useI18nLocale();
	const [quickView, setQuickView] = useState<
		"drafts" | "scheduled" | "invitations" | "archived" | null
	>(initialQuickView ?? null);
	/* The confirm dialogs name the conversation they were opened for, not "the
	   selected one": the selection can change under an open dialog. */
	const [dialog, setDialog] = useState<{
		kind: "archive" | "delete";
		conversationId: string;
	} | null>(initialDialog ?? null);
	const [deleting, setDeleting] = useState(false);
	const [deleteFailed, setDeleteFailed] = useState<"error" | "gone" | null>(
		null,
	);
	/*
	 * Pending invitations for the reader's own agent, derived from the list the
	 * rail already holds (no second read). The rail entry exists only while this
	 * is non-empty or the view is open, so a reader with nothing to answer sees
	 * no new row at all.
	 */
	const invitations = pendingAgentInvitations(conversations, selfAccountId);
	/* Held while the pointer is over the rail (review round 1, N1), so the
	   entry appearing or leaving never moves the list under a pending click. */
	const [pointerInRail, setPointerInRail] = useState(false);
	const invitationsEntry = useRef(false);
	invitationsEntry.current = railInvitationsEntryShown(
		invitationsEntry.current,
		invitations.length > 0 || quickView === "invitations",
		pointerInRail,
	);
	const [scheduleOpen, setScheduleOpen] = useState(false);
	const [scheduling, setScheduling] = useState(false);
	const [scheduledSuccess, setScheduledSuccess] = useState(false);
	const [scheduleFailed, setScheduleFailed] = useState(false);
	const writing = useRef(false);
	/* Escape from the schedule dialog must land back on the clock (D33). */
	const clockRef = useRef<HTMLButtonElement>(null);
	const composerRef = useRef<HTMLTextAreaElement>(null);
	const composerColumnRef = useRef<HTMLElement>(null);
	const composerBlockRef = useRef<HTMLDivElement>(null);
	const heldReasonId = useId();
	const draftTenant =
		scope === TEAM_BRIDGE_ALL_SCOPE && target?.type === "conversation"
			? (conversations.find((row) => row.id === target.id)?.tenant_id ?? scope)
			: scope;
	/* THE DRAFT OWNER. This branch's durable store supersedes main's per-mount
	   `draftJournal.body`: it survives a remount and a restart, which the map
	   cannot, and it carries the SAME account fence main added in
	   `team-bridge-owner.ts` — its `authorized()` epoch check replaces
	   `isDraftCurrent()` for the body, so state from a previous account can
	   never be read or written through this composer. */
	const draftState = useTeamBridgeDrafts(
		selfAccountId,
		draftTenant,
		target,
		/* The journal first: the parent KEYS this view by draft key, so a switch
		   back to A remounts a fresh hook, and the durable store may be absent
		   (storage unavailable). Main's in-memory journal is what makes A's text
		   come back in every environment; the hook adds persistence across
		   restarts. Both name the same draft. */
		draftJournal?.body ?? initialDraft,
		eligibility === "signed_out",
		scope === TEAM_BRIDGE_ALL_SCOPE,
	);
	const heldAttempt =
		Boolean(draftState.current?.sendAt) &&
		!draftState.current?.createUncertain &&
		!scheduling;

	const { body: draft, setBody: setDraftState } = draftState;
	/* ONE value, two stores: every keystroke lands in the durable hook AND in
	   main's journal, so the remount path and the restart path see the same
	   text. `isDraftCurrent()` stays the outermost fence, exactly as main had
	   it — the hook's epoch check is not a substitute for it at this seam. */
	const setDraft = (value: string) => {
		if (!isDraftCurrent()) return;
		setDraftState(value);
		if (draftJournal) draftJournal.body = value;
		// "Message scheduled" describes ONE message; a fresh edit is not it
		// (review round 12, n1).
		if (scheduledSuccess) setScheduledSuccess(false);
	};
	/*
	 * The composer's staged images. Keyed to the same draft identity as the
	 * text, so switching conversations swaps both together; uploads go straight
	 * to an existing conversation and are HELD in memory for a draft whose
	 * conversation the first send will create.
	 *
	 * The conversation is the RESOLVED one (`targetConversation`, the same
	 * resolution the pane and the send use), not just a `conversation` target:
	 * a People/Chiefs row or a one-recipient To: draft whose DM already exists
	 * IS that DM, and treating it as "no conversation yet" held its images
	 * while the send posted the text alone (review round 1, R1-01).
	 */
	const resolvedForImages = targetConversation(
		target,
		conversations,
		selfAccountId,
	);
	const images = useTeamBridgeAttachments({
		scopeKey: `${draftTenant}|${target ? draftTargetKey(target) : ""}`,
		accountId: selfAccountId,
		tenantId:
			resolvedForImages?.tenant_id ??
			(draftTenant === TEAM_BRIDGE_ALL_SCOPE ? undefined : draftTenant),
		conversationId:
			resolvedForImages?.id ?? draftState.current?.conversationId ?? null,
		capability: imageCapability,
		persisted: draftState.current?.attachments,
		onPersist: (next) => {
			/*
			 * While a send or schedule is in flight its idempotency key is already
			 * on the wire, and staging held images INSIDE that request must not
			 * rotate it, or the settled request can no longer clear its own draft
			 * (review round 1, R1-02).
			 */
			draftState.setAttachments(next, { keepClientRef: writing.current });
		},
	});
	const [imagesBlocked, setImagesBlocked] = useState(false);
	const [submitRejected, setSubmitRejected] = useState(false);
	/* Text OR at least one staged image; image-only messages are allowed. */
	const hasContent = Boolean(draft.trim()) || images.count > 0;
	const imagesSettled = !images.busy && !images.blocked;
	const selectTarget = (next: TeamBridgeTarget | null) => {
		setQuickView(null);
		onTarget(next);
	};
	/* THE HOLD. Both halves must agree before any thread state exists, so a deep
	   link or a reply handler cannot leave a selection behind that a later
	   render would mount. See `team-bridge-thread-gate.ts`. */
	const threadsAvailable = teamBridgeThreadsAvailable(threadsCapabilityState);
	/* THE REACTIONS HOLD. The build constant dominates the capability: the
	   context is withheld in this build whatever the runtime advertises, so the
	   message list mounts no reaction state and neither chips nor the toolbar's
	   react button exist. See `team-bridge-reaction-gate.ts`. */
	const reactionsAvailable = teamBridgeReactionsAvailable(
		reactionsCapabilityState,
	);
	// Thread identity is checked against the current selection before mounting.
	const [threadSelection, setThreadSelection] = useState<ThreadTarget | null>(
		threadsAvailable ? (threadLink ?? null) : null,
	);
	useEffect(() => {
		if (threadsAvailable && threadLink) setThreadSelection(threadLink);
	}, [threadLink, threadsAvailable]);
	const mergedView = scope === TEAM_BRIDGE_ALL_SCOPE;
	const identityKnown = selfAccountId !== undefined;

	const listRows = useMemo(
		() => visibleConversationRows(conversations, scope, organizations),
		[conversations, scope, organizations],
	);
	/*
	 * ARCHIVED CHANNELS LEAVE THE SIDEBAR. The server's default list is `open`
	 * only, but a server that predates the `status` parameter still returns
	 * archived rows in it, so the rail filters too: one rule, whichever server
	 * answered. `listRows` stays whole for selection, because a deep link or a
	 * notification can still name an archived conversation.
	 */
	const sidebarRows = useMemo(
		() => listRows.filter((row) => row.status !== "archived"),
		[listRows],
	);
	const sections = useMemo(() => railSections(sidebarRows), [sidebarRows]);
	/* Everything a selection may resolve against: the live list plus the archived view's rows. */
	const selectable = useMemo(
		() => selectableConversations(listRows, archivedConversations),
		[listRows, archivedConversations],
	);
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
	const profileFor = (sender: TeamBridgeMessage["sender"], tenantId: string) =>
		rosterFor(tenantId).find(
			(member) => member.account_id === sender.account_id,
		);
	const messageTarget = (
		sender: TeamBridgeMessage["sender"],
		tenantId: string,
	) => {
		const member = profileFor(sender, tenantId);
		if (
			!identityKnown ||
			!member ||
			member.account_id === selfAccountId ||
			!member.bridge_enabled ||
			!["active", "paused"].includes(member.bridge_state) ||
			(sender.kind === "agent" && !member.agent)
		)
			return null;
		return profileMessageTarget(
			sender,
			tenantId,
			listRows,
			selfAccountId,
			readOnly,
			mergedView,
		);
	};
	const messagePerson = (
		sender: TeamBridgeMessage["sender"],
		tenantId: string,
	) => {
		const next = messageTarget(sender, tenantId);
		if (!next) return;
		// Existing history remains available in read-only mode; a new draft
		// switches scope first so its send cannot inherit the merged tenant.
		if (next.type !== "conversation" && mergedView)
			onScopeChange(asTeamBridgeTenantId(tenantId));
		selectTarget(next);
	};
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

	const selected =
		resolvedConversation ??
		targetConversation(target, selectable, selfAccountId);
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
	const membershipCounts = shown
		? conversationMembershipCounts(shown)
		: { active: 0, invited: 0 };
	/*
	 * A quick view (Drafts / Scheduled) REPLACES the conversation in the main
	 * region, so the thread belonging to that conversation closes with it, the
	 * same way the pane's own Close does. Below 1024px the open thread overlays
	 * the whole region and `threadIsOpen` hides the section, so leaving the
	 * thread open made the Drafts/Scheduled buttons change nothing visible
	 * (review round 4, R4-02).
	 */
	const openQuickView = (
		next: "drafts" | "scheduled" | "invitations" | "archived",
	) => {
		if (threadSelection) {
			setThreadSelection(null);
			onCloseThread?.();
		}
		setQuickView(next);
	};
	const threadIsOpen = Boolean(
		threadsAvailable &&
			threadSelection &&
			shown &&
			threadSelection.conversationId === shown.id &&
			threadSelection.tenantId === shown.tenant_id &&
			!previewSelected &&
			!selectedOrganizationUnknown,
	);
	// A focused window is quiet only for the conversation actually on screen.
	useReportTeamBridgeViewing(shown?.id);
	/* The reply route: only ever handed to the timeline while the hold permits
	   it (see the `onReply` site), never mounted from stale state. */
	const openThreadFor = (message: TeamBridgeMessage) => {
		if (!shown) return;
		setThreadSelection({
			tenantId: shown.tenant_id,
			conversationId: shown.id,
			rootId: message.id,
		});
	};
	const canCompose =
		!readOnly &&
		!previewSelected &&
		shown?.status !== "archived" &&
		!selectedOrganizationUnknown &&
		(shown !== null ||
			(target?.type === "compose" && composeRecipients.length > 0) ||
			((target?.type === "person" || target?.type === "chief") &&
				draftPerson !== null));
	/* One reaction context for the timeline AND the thread pane, so a reply can
	   be reacted to under exactly the rules its root is. WITHHELD - not passed
	   disabled - when the runtime does not advertise reactions: a chip or picker
	   that cannot work is the dead end the fail-closed rule forbids. */
	const reactionContext =
		reactionsAvailable && selfAccountId && selected
			? {
					accountId: selfAccountId,
					tenantId: selected.tenant_id,
					disabled: !canCompose || selected.status !== "open",
				}
			: undefined;

	/*
	 * Records which ids a send/schedule actually put on the wire: the staged
	 * ids taken at submit, or (for held images) what the upload inside the
	 * request bound. Settle paths clear only these.
	 */
	const carriedIds = (staged: readonly string[]) => {
		let bound: readonly string[] = staged;
		return {
			ids: () => bound,
			stageHeld: async (conversationId: string, tenant: string | undefined) => {
				bound = await images.uploadHeld(conversationId, tenant);
				return [...bound];
			},
		};
	};
	// Capture the original entry and scope: navigation while a request is in
	// flight must not clear the next target's text, even if it is identical.
	// Opens at the newest message and follows new ones while the reader is at
	// the bottom (F9). Keyed by conversation; content key = the newest message.
	/*
	 * `quickView` is part of the key because Drafts and Scheduled UNMOUNT the
	 * timeline's ScrollArea (it is the last branch of the quick-view ternary).
	 * Re-selecting the same conversation afterwards mounts a NEW viewport while
	 * tenant, conversation and message state are all unchanged; without it the
	 * hook's scroll/load/ResizeObserver listeners stay bound to the dead
	 * viewport and the timeline reopens at scrollTop 0 (review round 6, F1).
	 */
	// A draft adopting its real conversation is the SAME displayed stream. Keep
	// the viewport and arrival lifetime keyed to the user's selection, not a
	// server id that is absent on the first frame.
	const timelineArrivalKey = JSON.stringify([
		selfAccountId,
		draftTenant,
		/*
		 * In the merged view a person/chief target carries no tenant of its own
		 * and `draftTenant` is the account-wide sentinel, so this tuple used to be
		 * identical for the same person messaged in two organizations - one
		 * arrival watermark for two streams (review round 1, F5). The resolved
		 * conversation's tenant is what actually separates them.
		 */
		shown?.tenant_id ?? "",
		target,
	]);
	/*
	 * AN EMPTY CONVERSATION IS OPEN WHILE IT IS ON SCREEN, AND ONLY THEN
	 * (review round 1, A3). This branch renders the empty paragraph instead of
	 * the list, so no list unmount ever suspends the stream: without the cleanup
	 * below, a conversation visited once stayed "open" in the journal forever and
	 * its whole history animated on the next visit - the "someone replied to the
	 * DM I opened earlier" path. The second effect suspends on a KEY CHANGE or
	 * unmount rather than on this one, because the first message to arrive in an
	 * open empty conversation must still animate, and that render is exactly when
	 * `messages.length` leaves 0.
	 */
	useLayoutEffect(() => {
		if (messageState === "ready" && shown && messages.length === 0)
			teamBridgeOpenEmptyArrivals(timelineArrivalKey);
	}, [messageState, shown, messages.length, timelineArrivalKey]);
	useLayoutEffect(
		() => () => teamBridgeSuspendArrivals(timelineArrivalKey),
		[timelineArrivalKey],
	);
	const timeline = useStickToBottom({
		resetKey: `${timelineArrivalKey}:${quickView ?? ""}`,
		contentKey: `${messages.length}:${messages.at(-1)?.id ?? ""}`,
	});
	/*
	 * The composer grows with what is in it (up to ten lines or 40% of the
	 * COLUMN it shares with the timeline, counted over the whole composer block)
	 * and shrinks when the draft empties - after a send, or when Return to draft
	 * is undone. Growing is the reader's own act, so it only re-follows the
	 * bottom if the timeline was already following it. The cap is derived from
	 * the COLUMN because its height does not change as the composer grows; the
	 * earlier attempt to solve it from the timeline's height oscillated one step
	 * per keystroke (design round 2, D9).
	 */
	useComposerAutoGrow(composerRef, draft, {
		onGrow: timeline.repin,
		columnRef: composerColumnRef,
		blockRef: composerBlockRef,
	});
	// The retry's idempotency key: a failed send is retried with the SAME
	// `client_ref`, so an ambiguous failure (request landed, answer lost) cannot
	// post the message twice. A genuinely different draft gets a fresh key.
	const pendingSend = useRef<{ body: string; clientRef: string } | null>(
		draftJournal?.pending ?? null,
	);
	const draftRef = useRef(draft);
	draftRef.current = draft;
	/*
	 * RETURN TO DRAFT (operator, 2026-10-28). A failed send's text and images go
	 * back into the composer that authored them, and the row leaves the thread.
	 * NOTHING TYPED SINCE IS LOST: the restored body is placed before whatever is
	 * in the box now, and if the box already holds exactly that body (a second
	 * click, or an earlier restore) it is left alone. Images come back with their
	 * staged ids, so a resend does not upload them twice.
	 */
	const returnToDraft = (clientRef: string) => {
		const taken = onTakeBackSend?.(clientRef, draftTenant);
		if (!taken) return;
		if (taken.attachments.length > 0) images.restore(taken.attachments);
		const restored = taken.body;
		const typed = draftRef.current;
		if (restored.trim())
			setDraft(
				!typed.trim()
					? restored
					: typed.trim() === restored.trim()
						? typed
						: `${restored}\n\n${typed}`,
			);
		setSubmitRejected(false);
		composerRef.current?.focus({ preventScroll: true });
	};
	/*
	 * The row actions call this through a REF (review round 1, F3): the memo then
	 * depends only on the row data and the container's handler, and a profession
	 * of stability cannot go stale - the handler that runs is always this render's
	 * one, with the live draft, images and tenant.
	 */
	const returnToDraftRef = useRef(returnToDraft);
	returnToDraftRef.current = returnToDraft;

	/* The rows the composer can act on carry BOTH the journal's own actions and
	 * this view's return-to-draft, which only the composer can perform. The
	 * handler reads the CURRENT box through a ref, so a keystroke cannot
	 * rebuild every row's actions. */
	const decoratedSendRows = useMemo(() => {
		if (!sendRows || !onTakeBackSend) return sendRows;
		return new Map(
			[...sendRows].map(
				([id, row]) =>
					[
						id,
						{
							...row,
							onReturnToDraft: () => returnToDraftRef.current(row.clientRef),
						},
					] as const,
			),
		);
	}, [sendRows, onTakeBackSend]);

	const submit = () => {
		const body = draft.trim();
		if (images.blocked) {
			setImagesBlocked(true);
			return;
		}
		if (
			!isDraftCurrent() ||
			!hasContent ||
			images.busy ||
			sending ||
			scheduling ||
			writing.current ||
			draftState.current?.createUncertain ||
			draftState.current?.sendAt ||
			!canCompose ||
			!target
		)
			return;
		const clientRef = draftState.current?.clientRef ?? crypto.randomUUID();
		const entryKey = draftTargetKey(target);
		if (!draftState.update({ clientRef })) return;
		setImagesBlocked(false);
		const sentIds = images.readyIds();
		/*
		 * Exactly the ids THIS request carried. Paste and drop stay live while a
		 * send is in flight, so re-reading the strip on settle would clear an
		 * image added mid-send as "sent" when it never left (review round 2,
		 * R2-01). Held images report their bound ids through the wrapper.
		 */
		const carried = carriedIds(sentIds);
		// ONE attempt, named in both stores: the page's draft bookkeeping and
		// this branch's durable row must carry the same `client_ref`, or a retry
		// after a remount could post the message twice.
		const entry = { body, clientRef };
		pendingSend.current = entry;
		if (draftJournal) draftJournal.pending = entry;
		// Fenced BEFORE the call: held images stage inside it (R1-02).
		writing.current = true;
		// The author's own send lands in view when it arrives (F9).
		timeline.pin();
		let result: ReturnType<TeamBridgePageViewProps["onSend"]>;
		try {
			setSubmitRejected(false);
			result = onSend(body, clientRef, {
				ids: sentIds,
				chips: images.chips,
				...(images.held ? { stageHeld: carried.stageHeld } : {}),
			});
		} catch {
			// Admission failed before ownership transferred: the entire draft and
			// strip remain editable, and a later eligible attempt may send them.
			writing.current = false;
			setSubmitRejected(true);
			return;
		}
		if (!(result instanceof Promise)) writing.current = false;
		const settle = () => {
			if (!isDraftCurrent()) return;
			if (pendingSend.current === entry) {
				pendingSend.current = null;
				if (draftJournal) draftJournal.pending = null;
			}
		};
		/*
		 * THE CLEAR IS DELEGATED TO THE STORES, NEVER DECIDED FROM THIS RENDER.
		 * `draft` and `body` both come from the submit render, so comparing them
		 * here is a tautology that wrote "" over text typed while the request was
		 * in flight (review round 12, B1). `clearSent` re-reads the DURABLE row,
		 * so a mid-flight edit keeps that row and the box keeps its text.
		 */
		const finish = (bound: readonly string[] = []) => {
			// The journal lives ABOVE the keyed view, so a body left there reseeds
			// the sent text on remount (review round 12, M1). Clear it under the
			// same condition the durable store uses: still exactly what was sent.
			if (draftJournal && draftJournal.body.trim() === body)
				draftJournal.body = "";
			// Chips first (still fenced by `writing`, so the key holds), then the
			// draft entry, which by then carries no bound ids (R1-02). A text-only
			// send passes no ids, so this is the single clear path for both.
			images.clearSent(bound);
			draftState.clearSent(entryKey, body, clientRef, bound);
			settle();
		};
		if (result && "queued" in result) {
			// The outbox now owns the body AND these image URLs/bytes. Detach,
			// never revoke or delete staged uploads, and immediately free the next
			// draft. Background settlement cannot erase text typed after this send.
			images.detachForSend();
			draftState.clearSent(entryKey, body, clientRef, sentIds);
			if (draftJournal) draftJournal.body = "";
			settle();
			writing.current = false;
			composerRef.current?.focus({ preventScroll: true });
		} else if (result instanceof Promise) {
			void result
				.then(() => finish(carried.ids()))
				.catch((error) => {
					// The hub's uniform 404 for a staged id that no longer binds (72 h
					// TTL, or bound elsewhere): the chips flip to "expired" so the
					// author re-adds or removes them; the text is kept.
					if (carried.ids().length > 0 && isAttachmentNotFound(error))
						images.markExpired(carried.ids());
				})
				.finally(() => {
					writing.current = false;
					composerRef.current?.focus({ preventScroll: true });
				});
		} else {
			// A synchronous send has already resolved: the journal must not keep
			// naming an attempt that is over.
			finish();
			composerRef.current?.focus({ preventScroll: true });
		}
	};
	const schedule = async (sendAt: string) => {
		if (
			!target ||
			!onSchedule ||
			writing.current ||
			draftState.current?.createUncertain ||
			!hasContent ||
			!imagesSettled ||
			!canCompose ||
			sending ||
			scheduling
		)
			throw new Error("schedule unavailable");
		if (draftState.current?.sendAt && draftState.current.sendAt !== sendAt)
			throw new Error("retry requires original time");
		const body = draft.trim();
		const clientRef = draftState.current?.sendAt
			? draftState.current.clientRef
			: crypto.randomUUID();
		const entryKey = draftTargetKey(target);
		const creatingGroup =
			target.type === "compose" &&
			target.recipients.length > 1 &&
			!shown &&
			!draftState.current?.conversationId;
		if (
			!draftState.update({
				clientRef,
				sendAt,
				...(creatingGroup ? { createUncertain: true } : {}),
			})
		)
			throw new Error("draft persistence unavailable");
		writing.current = true;
		setScheduling(true);
		setScheduledSuccess(false);
		setScheduleFailed(false);
		const scheduledIds = images.readyIds();
		// The schedule's own reserved set, not the strip at settle (R2-01); the
		// 404 path below expires only these too (R3-02).
		const carried = carriedIds(scheduledIds);
		try {
			await onSchedule(
				body,
				clientRef,
				sendAt,
				draftState.current?.conversationId,
				(conversationId) => {
					if (
						!draftState.update({
							conversationId,
							clientRef,
							sendAt,
							createUncertain: false,
						})
					)
						throw new Error("draft persistence unavailable");
				},
				{
					ids: scheduledIds,
					...(images.held ? { stageHeld: carried.stageHeld } : {}),
				},
			);
			const reserved = carried.ids();
			// Same two-store clear as a send, in the same order: the journal first
			// (it lives above the keyed view, round 12 M1), then the chips, then the
			// durable row with exactly the ids this request reserved (R1-02).
			if (draftJournal && draftJournal.body.trim() === body)
				draftJournal.body = "";
			images.clearSent(reserved);
			draftState.clearSent(entryKey, body, clientRef, reserved);
			setScheduledSuccess(true);
		} catch (error) {
			setScheduleFailed(true);
			if (carried.ids().length > 0 && isAttachmentNotFound(error))
				images.markExpired(carried.ids());
			// A definitive client refusal cannot have created a group. A lost response
			// can: require a deliberate Groups check before another create attempt.
			const status = (error as { status?: number | null })?.status;
			if (canResetScheduleAttempt(draftState.current?.sendAt, status))
				draftState.update({ createUncertain: false, sendAt: undefined });
			throw error;
		} finally {
			writing.current = false;
			setScheduling(false);
		}
	};

	if (gatePending) return <TeamBridgeGateLoading />;
	if (eligibility) return <TeamBridgeEligibilityPanel reason={eligibility} />;

	const isSelectedConversation = (conversation: TeamBridgeConversation) =>
		target?.type === "conversation" && target.id === conversation.id;
	const startGroup = (recipient: TeamBridgeRecipient) =>
		selectTarget({ type: "compose", recipients: [recipient] });
	const createDisabled = mergedView || readOnly;
	const createHint = readOnly
		? t("ui.teamBridge.read_only.note")
		: t("ui.teamBridge.scope.create_needs_org");

	const draftLabel = (draftTarget: TeamBridgeTarget): string => {
		if (draftTarget.type === "compose")
			return (
				draftTarget.recipients.map((row) => row.label).join(", ") ||
				t("ui.teamBridge.compose.label")
			);
		if (draftTarget.type === "conversation") {
			const row = conversations.find((row) => row.id === draftTarget.id);
			return (
				(row ? conversationTitle(row, selfAccountId) : null) ??
				t("ui.teamBridge.list.untitled")
			);
		}
		const label =
			people.find((row) => row.account_id === draftTarget.accountId)
				?.display_label ?? t("ui.teamBridge.list.untitled");
		// A chief draft carries the agent's own name when the directory has one,
		// so the Drafts view agrees with the rail ("Aida (Ben)", review R1-4).
		return draftTarget.type === "chief"
			? composeChiefLabel(
					chiefs.find(
						(chief) => chief.person.account_id === draftTarget.accountId,
					)?.agentName ?? "",
					label,
					chiefLabelCopy(),
				)
			: label;
	};

	const conversationRows = (rows: TeamBridgeConversation[]) => (
		<ul className="flex flex-col">
			{rows.map((conversation) => (
				<ConversationRailRow
					hasDraft={draftState.entries.some(
						({ entry, tenantId }) =>
							tenantId === conversation.tenant_id &&
							(Boolean(entry.body.trim()) ||
								(entry.attachments?.length ?? 0) > 0) &&
							targetConversation(entry.target, [conversation], selfAccountId)
								?.id === conversation.id,
					)}
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
						selectTarget({ type: "conversation", id: conversation.id })
					}
					onArchive={
						onArchive && !readOnly && canArchiveConversation(conversation)
							? () =>
									setDialog({
										kind: "archive",
										conversationId: conversation.id,
									})
							: undefined
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
				onPointerEnter={() => setPointerInRail(true)}
				onPointerLeave={() => setPointerInRail(false)}
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
								selectTarget(
									draftState.drafts.compose?.target ?? {
										type: "compose",
										recipients: [],
									},
								);
						}}
					>
						<Plus size={16} />
					</Button>
				</header>
				<nav
					aria-label={t("ui.teamBridge.drafts.navigation")}
					className="flex flex-col px-3 pb-2"
				>
					<button
						type="button"
						aria-current={quickView === "drafts" ? "page" : undefined}
						onClick={() => openQuickView("drafts")}
						className="flex h-[30px] items-center gap-2 rounded-md px-2 text-sm text-ink-muted hover:bg-row-hover"
					>
						<Pencil size={14} aria-hidden="true" />
						{t("ui.teamBridge.drafts.title")}
					</button>
					<button
						type="button"
						disabled={!selfAccountId}
						aria-current={quickView === "scheduled" ? "page" : undefined}
						onClick={() => openQuickView("scheduled")}
						className="flex h-[30px] items-center gap-2 rounded-md px-2 text-sm text-ink-muted hover:bg-row-hover disabled:text-ink-disabled"
					>
						<Clock size={14} aria-hidden="true" />
						{t("ui.teamBridge.schedule.list")}
					</button>
					{invitationsEntry.current && (
						<button
							type="button"
							aria-current={quickView === "invitations" ? "page" : undefined}
							onClick={() => openQuickView("invitations")}
							className="flex h-[30px] items-center gap-2 rounded-md px-2 text-sm text-ink-muted hover:bg-row-hover"
						>
							<MailPlus size={14} aria-hidden="true" />
							<span className="min-w-0 flex-1 truncate text-start">
								{t("ui.teamBridge.invitations.title")}
							</span>
							{invitations.length > 0 && (
								/* Pending invitations wait on the reader's answer: an
								   attention count, so the shared accent badge (2026-10-28). */
								<AttentionBadge
									count={invitations.length}
									/* ONE BADGE COLUMN (design round 1, D3): nav rows sit
									   8px further in than conversation rows (px-3 vs px-1),
									   so the count pulls back out to their x=276 edge. */
									className="-me-2 shrink-0"
									aria-label={t("ui.teamBridge.invitations.count", {
										count: invitations.length,
									})}
								/>
							)}
						</button>
					)}
					{/* DESIGN ROUND 1, D3: the Channels "..." is hover-only, so in a resting
					    rail the Archived view did not exist. This is its resting door, drawn
					    only for a reader who has something to look for (an administrator, or
					    anyone with an archived channel loaded) and carrying the same
					    aria-current as Drafts and Scheduled while the view is open. */}
					{onOpenArchived &&
						(quickView === "archived" ||
							archivedChannelRows(archivedConversations).length > 0 ||
							sidebarRows.some(canArchiveConversation)) && (
							<button
								type="button"
								aria-current={quickView === "archived" ? "page" : undefined}
								onClick={() => {
									onOpenArchived();
									openQuickView("archived");
								}}
								className={cn(
									"flex h-[30px] items-center gap-2 rounded-md px-2 text-sm",
									/* The selected-row role every sidebar shares; Drafts and Scheduled
									   mark `aria-current` only, so this is the one entry that is also
									   visibly current while its view is open (design round 1, D3). */
									quickView === "archived"
										? rowCurrent
										: "text-ink-muted hover:bg-row-hover",
								)}
							>
								<Archive size={14} aria-hidden="true" />
								{t("ui.teamBridge.archive.section.archived")}
							</button>
						)}
				</nav>
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
						menu={
							onOpenArchived
								? {
										label: t("ui.teamBridge.archive.section.menu"),
										items: [
											{
												key: "archived",
												label: t("ui.teamBridge.archive.section.archived"),
												icon: <Archive size={14} aria-hidden="true" />,
												onSelect: () => {
													onOpenArchived();
													openQuickView("archived");
												},
											},
										],
									}
								: undefined
						}
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
										onAdd: () =>
											selectTarget(
												draftState.drafts.compose?.target ?? {
													type: "compose",
													recipients: [],
												},
											),
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
											: () =>
													selectTarget(
														draftState.drafts.compose?.target ?? {
															type: "compose",
															recipients: [],
														},
													),
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
												hasDraft={Boolean(
													draftState.drafts[
														`person:${member.account_id}`
													]?.body.trim(),
												)}
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
													selectTarget({
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
												hasDraft={Boolean(
													draftState.drafts[
														`chief:${chief.person.account_id}`
													]?.body.trim(),
												)}
												key={chief.person.account_id}
												chief={chief}
												label={composeChiefLabel(
													chief.agentName,
													personDisplayLabel(chief.person),
													chiefLabelCopy(),
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
													selectTarget({
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
				ref={composerColumnRef}
				className={cn(
					"panel-top-pad flex min-w-0 flex-1 flex-col bg-surface",
					threadIsOpen && "@max-[1024px]/bridge:invisible",
				)}
			>
				{notice}
				{quickView === "invitations" ? (
					<TeamBridgeInvitations
						invitations={invitations}
						listState={listState}
						onRetry={onRetry}
						readOnly={readOnly}
						organizationNames={
							mergedView
								? Object.fromEntries(
										organizations.map((row) => [row.tenantId, row.name]),
									)
								: undefined
						}
					/>
				) : quickView === "scheduled" && selfAccountId ? (
					<TeamBridgeScheduledList
						accountId={selfAccountId}
						organizationNames={Object.fromEntries(
							organizations.map((row) => [row.tenantId, row.name]),
						)}
						/* A destructive cancel names its destination (design round 1,
						   D32); the list already holds the titles the rail uses. */
						conversationNames={Object.fromEntries(
							conversations.flatMap((row) => {
								const title = conversationTitle(row, selfAccountId);
								return title ? [[row.id, title]] : [];
							}),
						)}
						tenantIds={
							mergedView ? organizations.map((row) => row.tenantId) : [scope]
						}
						readOnly={readOnly}
					/>
				) : quickView === "archived" ? (
					<TeamBridgeArchivedChannelsView
						state={archivedState}
						conversations={archivedChannelRows(archivedConversations)}
						hasMore={archivedHasMore}
						loadingMore={archivedLoadingMore}
						loadMoreFailed={archivedLoadMoreFailed}
						onLoadMore={onLoadMoreArchived}
						organizationName={
							mergedView
								? (conversation) =>
										conversationOrganizationName(conversation, organizations)
								: undefined
						}
						onRetry={onRetryArchived}
						onOpen={(conversation) => {
							/* Opening a row leaves the list for the channel, read-only. */
							setQuickView(null);
							selectTarget({ type: "conversation", id: conversation.id });
						}}
					/>
				) : quickView === "drafts" ? (
					<section
						className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-5"
						aria-label={t("ui.teamBridge.drafts.title")}
					>
						<h2 className="text-lg font-medium text-ink">
							{t("ui.teamBridge.drafts.title")}
						</h2>
						{draftState.entries.filter(
							({ entry }) =>
								entry.body.trim() ||
								(entry.attachments?.length ?? 0) > 0 ||
								(entry.target.type === "compose" &&
									entry.target.recipients.length > 0),
						).length === 0 && (
							<p className="text-ink-muted">
								{t("ui.teamBridge.drafts.empty")}
							</p>
						)}
						{draftState.entries
							.filter(
								({ entry }) =>
									entry.body.trim() ||
									(entry.attachments?.length ?? 0) > 0 ||
									(entry.target.type === "compose" &&
										entry.target.recipients.length > 0),
							)
							.map(({ key, tenantId, entry }) => (
								<button
									type="button"
									key={key}
									onClick={() => {
										if (tenantId !== scope)
											onScopeChange(asTeamBridgeTenantId(tenantId));
										selectTarget(entry.target);
									}}
									className="rounded-md bg-surface p-3 text-left text-ink hover:bg-row-hover"
								>
									<span className="block text-sm font-medium">
										{draftLabel(entry.target)}
									</span>
									<span className="block truncate text-sm text-ink-muted">
										{entry.body}
									</span>
								</button>
							))}
					</section>
				) : target === null ? (
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
								profileFor={(recipient) =>
									people.find(
										(member) => member.account_id === recipient.accountId,
									)
								}
								onChange={(recipients) =>
									selectTarget({ type: "compose", recipients })
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
									<span className="flex shrink-0 flex-col text-meta-sm text-ink-dim">
										{/* A current invitation is membership, not active access, so
										    with invitees the headline says "active" outright and the
										    invited count sits beneath it (design review D2 on #1336:
										    "1 member" over "1 active · 3 invited" repeated the active
										    count and left "member" unqualified). Never infer the
										    breakdown from a preview's aggregate `member_count`:
										    a preview has no rows, so `invited` is 0 there. */}
										{membershipCounts.invited > 0 ? (
											<>
												{/* The headline takes the stronger ink and the invited line
												    the subordinate one: the invited count qualifies the
												    headline and must not outrank it (design review D1 on
												    #1441). The single-line count below keeps its ink. */}
												<span className="text-ink-muted">
													{t("ui.teamBridge.member.active_count", {
														count: membershipCounts.active,
													})}
												</span>
												<span className="text-ink-dim">
													{t("ui.teamBridge.member.invited_count", {
														count: membershipCounts.invited,
													})}
												</span>
											</>
										) : (
											t("ui.teamBridge.member.count", {
												count: conversationMemberCount(shown),
											})
										)}
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
								<div className="ms-auto flex items-center gap-1">
									{shown && !previewSelected && !readOnly && onNotifyChange && (
										<TeamBridgeConversationMenu
											conversation={shown}
											onNotifyChange={onNotifyChange}
											onArchive={
												onArchive && canArchiveConversation(shown)
													? () =>
															setDialog({
																kind: "archive",
																conversationId: shown.id,
															})
													: undefined
											}
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
						{shown?.status === "archived" && (
							<TeamBridgeArchivedBanner
								conversation={shown}
								canManage={
									!readOnly &&
									Boolean(onUnarchive && onDelete) &&
									canManageArchivedConversation(shown)
								}
								error={unarchiveFailed}
								onUnarchive={() => onUnarchive?.(shown)}
								onDelete={() => {
									setDeleteFailed(null);
									setDialog({ kind: "delete", conversationId: shown.id });
								}}
							/>
						)}
						{shown?.builtin && (
							<p className="px-5 pb-1 text-[12px] text-ink-dim">
								{shown.builtin === "agents"
									? t("ui.teamBridge.builtin.agents_topic")
									: t("ui.teamBridge.builtin.humans_topic")}
							</p>
						)}

						<ScrollArea
							ref={timeline.rootRef}
							className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:block! [&_[data-radix-scroll-area-viewport]>div]:h-full"
						>
							{/* Intrinsic transcript height must remain scrollable when localized recovery controls claim more composer space. */}
							<div className="flex min-h-full flex-col">
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
												{draftPerson ? (
													<TeamBridgeProfileCard
														member={draftPerson}
														label={paneTitle ?? ""}
														agentName={
															target.type === "chief"
																? (paneTitle ?? "")
																: undefined
														}
														onMessage={() => {}}
														canMessage={false}
													>
														{/* `self-start`, not the column's default stretch: a
														    stretched <button> spans the pane, and the UA's
														    `text-align: center` for buttons then centred the
														    56px mark over left-aligned name and intro lines
														    (operator report 2026-10-27, regressed when #1433
														    wrapped the plate in this profile-card trigger).
														    The mark shares the text block's left edge,
														    Slack-style, and the hit target is the mark only. */}
														<button
															type="button"
															data-draft-avatar=""
															className="self-start rounded-xl"
														>
															<TeamBridgeAvatar
																member={draftPerson}
																label={paneTitle ?? ""}
																size={56}
																className="rounded-xl text-[22px]"
																fallback={
																	target.type === "chief" ? (
																		<Bot size={26} />
																	) : undefined
																}
															/>
														</button>
													</TeamBridgeProfileCard>
												) : (
													<span
														aria-hidden="true"
														className={cn(
															"flex size-14 items-center justify-center overflow-hidden rounded-xl font-semibold text-[22px]",
															// The same borderless fill pair as the message
															// rows' plates, so one person reads alike everywhere.
															target.type === "chief"
																? "bg-media-surface text-accent"
																: "bg-media-surface text-ink-muted",
														)}
													>
														{target.type === "chief" ? (
															<Bot size={26} />
														) : (
															(paneTitle ?? "")
																.trim()
																.charAt(0)
																.toUpperCase() || "?"
														)}
													</span>
												)}
												<p
													data-draft-name=""
													className="font-semibold text-[17px] text-ink"
												>
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
								) : messageState === "forbidden" ? (
									/* An administrator opening an archived channel they never joined:
									   the server lets them manage it but not read it (agent-server
									   S4). Not an error to retry and not an empty channel. */
									<p className="px-5 py-8 text-[13px] text-ink-muted">
										{t("ui.teamBridge.archive.thread.forbidden")}
									</p>
								) : messages.length === 0 ? (
									<p className="mt-auto px-5 pb-4 text-[13px] text-ink-muted">
										{/* Design round 1, D5: "Say hello" invites a post the line below
										    refuses. An archived channel's empty state is a plain fact. */}
										{shown?.status === "archived"
											? t("ui.teamBridge.archive.thread.empty")
											: t("ui.teamBridge.thread.empty")}
									</p>
								) : (
									<TeamBridgeMessageList
										messages={messages}
										sendRows={decoratedSendRows}
										profileFor={(sender) =>
											profileFor(sender, shown?.tenant_id ?? "")
										}
										canMessagePerson={(sender) =>
											messageTarget(sender, shown?.tenant_id ?? "") !== null
										}
										onMessagePerson={
											identityKnown
												? (sender) =>
														messagePerson(sender, shown?.tenant_id ?? "")
												: undefined
										}
										arrivalKey={timelineArrivalKey}
										tenantId={shown?.tenant_id}
										accountId={selfAccountId}
										labelFor={(sender) =>
											labelFor(sender, shown?.tenant_id ?? "")
										}
										reactionContext={reactionContext}
										/* HIDDEN, not inert, while the thread surface is held: the toolbar's
										   reply button and the "N replies" summary are both rendered from this
										   prop, and a visible Reply that opens nothing is the dead end the
										   fail-closed rule forbids. */
										onReply={threadsAvailable ? openThreadFor : undefined}
									/>
								)}
							</div>
						</ScrollArea>

						{/* THE AGENT COMPOSER'S SHAPE: one borderless box on `elevated`,
						    the field and its tools inside, Send in the bottom-right. The
						    focus ring is promoted from the textarea to the box via `:has`.
						    No composer in a preview (a non-member cannot write) and none
						    on surface F, where the reason replaces it. */}
						{!previewSelected &&
							(shown?.status === "archived" ? (
								/* Nobody can post: the server refuses it too (`conversation_archived`). */
								<p className="shrink-0 px-5 pb-4 text-[12px] text-ink-dim leading-snug">
									{t("ui.teamBridge.archive.composer.note")}
								</p>
							) : readOnly ? (
								<p className="shrink-0 px-5 pb-4 text-[12px] text-ink-dim leading-snug">
									{t("ui.teamBridge.read_only.composer")}
								</p>
							) : (
								/* Bound localized recovery controls without consuming the whole timeline.
								   `pt-1` is the focus ring's room: the box below draws its ring
								   OUTSIDE itself (2px outline at a 2px offset = 4px), and this
								   overflow container clips at its padding box, so with no top
								   padding the ring's top edge was cut off while the sides and
								   bottom (inside px-4/pb-4) drew whole. It is the container's
								   own padding so the room holds whichever alert or box is first;
								   pinned by scripts/team-bridge-composer-ring.test.mjs. */
								<div
									ref={composerBlockRef}
									className="min-h-0 max-h-[60%] shrink-0 overflow-y-auto px-4 pt-1 pb-4"
								>
									{scheduleFailed && (
										<p role="alert" className="text-sm text-danger">
											{t("ui.teamBridge.schedule.failed")}
										</p>
									)}
									{scheduledSuccess && (
										<p aria-live="polite" className="text-sm text-ink-muted">
											{t("ui.teamBridge.schedule.success")}
										</p>
									)}
									{draftState.current?.createUncertain && !scheduling && (
										<div role="alert" className="text-sm text-danger">
											<p id={`${heldReasonId}-group`}>
												{t("ui.teamBridge.schedule.create_uncertain")}
											</p>
											<Button
												variant="ghost"
												onClick={() =>
													draftState.update({ createUncertain: false })
												}
											>
												{t("ui.teamBridge.schedule.create_retry")}
											</Button>
										</div>
									)}
									{draftState.storageFailed && (
										<p role="alert" className="text-sm text-danger">
											{t("ui.teamBridge.drafts.storage_failed")}
										</p>
									)}
									{(sendFailed || submitRejected) && (
										<p
											role="alert"
											className="px-2 pb-1 text-[12px] text-danger"
										>
											{t("ui.teamBridge.composer.error")}
										</p>
									)}
									{/* A hub that cannot take images is already explained by the strip's
									   unsupported note; this alert is only for error-marked chips (R2-02). */}
									{imagesBlocked && images.blocked && !images.unsupported && (
										<p
											role="alert"
											className="px-2 pb-1 text-[12px] text-danger"
										>
											{t("ui.teamBridge.attachments.send_blocked")}
										</p>
									)}
									<div
										className={cn(
											"rounded-xl bg-elevated transition-colors duration-fast ease-out-quart",
											"has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-solid",
										)}
										{...(canCompose ? attachmentPasteHandlers(images) : {})}
									>
										{heldAttempt && (
											<TeamBridgeHeldAttempt
												reasonId={heldReasonId}
												busy={sending || scheduling}
												onRetry={
													onSchedule
														? () => {
																const at = draftState.current?.sendAt;
																if (at)
																	void schedule(at).catch(() =>
																		setScheduleFailed(true),
																	);
															}
														: undefined
												}
												onDiscard={() => {
													if (writing.current || scheduling || sending) return;
													// This releases only the local attempt; the explicit acknowledgement asks
													// the reader to check/cancel any server schedule before minting a fresh key.
													if (
														draftState.update({
															sendAt: undefined,
															clientRef: crypto.randomUUID(),
														})
													)
														setScheduleFailed(false);
												}}
											/>
										)}
										<TeamBridgeAttachmentStrip state={images} />
										<textarea
											ref={composerRef}
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
											/* No `max-h-40`: the cap is measured in the auto-grow
											   hook, which needs the box free to read `scrollHeight`.
											   `min-h-10` is the resting height, so an empty
											   composer never starts shorter than one row. */
											className="block min-h-10 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] text-ink outline-none placeholder:text-ink-dim disabled:cursor-not-allowed"
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
													"min-w-0 flex-1 truncate ps-1.5 text-meta-sm text-ink-dim transition-opacity duration-fast",
													hasContent ? "opacity-100" : "opacity-0",
												)}
												aria-hidden={!hasContent}
											>
												{t("ui.teamBridge.composer.hint")}
											</span>
											<TeamBridgeAttachButton
												state={images}
												disabled={!canCompose || sending || scheduling}
											/>
											{onSchedule && (
												<Button
													ref={clockRef}
													variant="ghost"
													size="icon"
													aria-label={t("ui.teamBridge.schedule.title")}
													aria-describedby={
														draftState.current?.createUncertain && !scheduling
															? `${heldReasonId}-group`
															: heldAttempt
																? heldReasonId
																: undefined
													}
													disabled={
														Boolean(draftState.current?.sendAt) ||
														Boolean(draftState.current?.createUncertain) ||
														!hasContent ||
														!imagesSettled ||
														sending ||
														scheduling ||
														!canCompose
													}
													onClick={() => setScheduleOpen(true)}
												>
													<Clock size={16} aria-hidden="true" />
												</Button>
											)}
											<TeamBridgeScheduleDialog
												open={scheduleOpen}
												returnFocus={clockRef}
												onOpenChange={setScheduleOpen}
												busy={scheduling}
												onSchedule={schedule}
											/>
											<Button
												size="icon-sm"
												variant="primary"
												/* A rounded square, the avatar's shape (design round 1,
												   D11), not the pill the size's default radius gave. */
												className="rounded-md"
												disabled={
													Boolean(draftState.current?.sendAt) ||
													Boolean(draftState.current?.createUncertain) ||
													!hasContent ||
													images.busy ||
													sending ||
													scheduling ||
													!canCompose
												}
												aria-label={t("ui.teamBridge.composer.send")}
												aria-describedby={
													draftState.current?.createUncertain && !scheduling
														? `${heldReasonId}-group`
														: heldAttempt
															? heldReasonId
															: undefined
												}
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
			{/* Threads: a ground-separated sibling; no rail or compose routing changes.
			    THE HOLD IS THE FIRST TERM: `threadsAvailable` is false in this
			    build whatever the runtime advertises, so no selection - deep link,
			    reply click, story fixture - can mount the pane. */}
			{threadsAvailable &&
				threadSelection &&
				shown &&
				threadSelection.conversationId === shown.id &&
				threadSelection.tenantId === shown.tenant_id &&
				!previewSelected &&
				!selectedOrganizationUnknown && (
					/* At the supported 800px minimum a second flex column leaves only
					   152px for the timeline. Take over its whole region below 1024px,
					   rather than shrinking either reading measure. The 288px rail stays. */
					<div className="absolute inset-y-0 end-0 start-72 z-20 min-w-0 @min-[1024px]/bridge:static @min-[1024px]/bridge:w-[min(26rem,45%)] @min-[1024px]/bridge:min-w-72 @min-[1024px]/bridge:shrink-0">
						{renderThreadPane ? (
							renderThreadPane(threadSelection, () => {
								setThreadSelection(null);
								onCloseThread?.();
							})
						) : (
							<TeamBridgeThreadPane
								key={`${threadSelection.tenantId}:${threadSelection.conversationId}:${threadSelection.rootId}`}
								target={threadSelection}
								canMessagePerson={(sender) =>
									messageTarget(sender, threadSelection.tenantId) !== null
								}
								profileFor={(sender) =>
									profileFor(sender, threadSelection.tenantId)
								}
								onMessagePerson={
									identityKnown
										? (sender) =>
												messagePerson(sender, threadSelection.tenantId)
										: undefined
								}
								initialRoot={messages.find(
									(message) => message.id === threadSelection.rootId,
								)}
								labelFor={(sender) =>
									labelFor(sender, threadSelection.tenantId)
								}
								readOnly={readOnly}
								reactionContext={reactionContext}
								accountId={selfAccountId}
								attachmentCapability={imageCapability}
								onClose={() => {
									setThreadSelection(null);
									onCloseThread?.();
								}}
							/>
						)}
					</div>
				)}
			{(() => {
				/* The dialogs name the conversation they were opened for. A row that left
				   the cache (archived, or deleted by someone else) closes its own dialog. */
				const subject = dialog
					? selectable.find((row) => row.id === dialog.conversationId)
					: undefined;
				if (!dialog || !subject) return null;
				const name = archiveChannelName(subject);
				/* Only a selection ON the removed channel has to move: archiving a
				   channel from another row's menu leaves the reader where they are. */
				const wasShown =
					target?.type === "conversation" && target.id === subject.id;
				return dialog.kind === "archive" ? (
					<TeamBridgeArchiveDialog
						open
						name={name}
						onClose={() => setDialog(null)}
						onConfirm={() => {
							setDialog(null);
							onArchive?.(subject);
							/* LEAVE THE CHANNEL THE WAY SLACK DOES (design round 1, D2): the row
							   is already gone from the rail, so land on the next channel in it
							   (else the previous one, else the default). Leaving the target on
							   the archived id painted "Untitled conversation" over a dead composer. */
							if (wasShown)
								selectTarget(landingAfterRemoval(sidebarRows, subject.id));
						}}
					/>
				) : (
					<TeamBridgeDeleteDialog
						open
						name={name}
						pending={deleting}
						error={deleteFailed}
						onClose={() => setDialog(null)}
						onConfirm={() => {
							if (!onDelete || deleting) return;
							setDeleting(true);
							setDeleteFailed(null);
							onDelete(subject).then(
								() => {
									setDeleting(false);
									setDialog(null);
									/* An erased channel cannot stay selected. Move the selection off it
									   (never onto it: it is archived, so it is not in `sidebarRows`) and
									   return to the Archived channels view, where the reader came from and
									   where the rest of the clean-up is. */
									if (wasShown) {
										onTarget(landingAfterRemoval(sidebarRows, subject.id));
										onOpenArchived?.();
										openQuickView("archived");
									}
								},
								(failure: unknown) => {
									setDeleting(false);
									/* The server's 404 is opaque: "already gone" and "you may no longer
									   delete this" look the same. Say exactly that, not "deleted". */
									setDeleteFailed(
										(failure as { code?: string } | null)?.code ===
											"conversation_not_found"
											? "gone"
											: "error",
									);
								},
							);
						}}
					/>
				);
			})()}
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
 * The container. It owns the queries, the rail target, and the ONE write path a
 * message takes - the shared send journal, which creates the conversation when
 * there is none, stages the images, posts, and keeps the row on screen whether
 * it lands or fails.
 *
 * Reading a thread marks it read at the newest seq the reader has been shown;
 * the server applies `$max`, so a re-render cannot move the cursor backwards.
 */
export const TeamBridgePage: FC<{ selfAccountId?: string }> = () => {
	const account = useTeamBridgeAccount();
	const drafts = useRef(new Map<string, OwnedDraft>());
	const receipts = useRef(
		new Map<
			string,
			Map<string, { id: string; tenantId: string | undefined }>
		>(),
	);
	/*
	 * THE ACCOUNT BOUNDARY IS ENFORCED HERE, ABOVE THE KEYED SUBTREE (review round
	 * 1, F1; corrected in round 2).
	 *
	 * `key={account.token}` destroys the outgoing instance, so nothing INSIDE it
	 * can ever observe a different `accountId` - this component can, because an
	 * account change does not remount it. Two things are easy to get wrong here,
	 * and both were:
	 *
	 * 1. THE MARKER MUST NOT FOLLOW A PENDING FRAME. `account.accountId` is
	 *    `undefined` while a transition is in flight, so a marker written from
	 *    render is cleared on the very frame every real switch passes through, and
	 *    the later settle then sees "no previous account" and purges nothing. The
	 *    marker only ever advances to a DEFINED account, here and in the listener.
	 * 2. THE PURGE MUST NOT RUN INSIDE THE ANNOUNCEMENT. It notifies this journal's
	 *    subscribers, which re-enters the listener before the marker is written -
	 *    an endless render loop (measured: the account-switch case never settled).
	 *    So: claim the new account FIRST, then purge in a microtask.
	 *
	 * A refresh that merely goes pending is not a replacement; a deliberate
	 * sign-out (the authority's own `signedOut` absence) is, and it purges too.
	 */
	const queryClient = useQueryClient();
	const settledAccount = useRef<string | undefined>(account.accountId);
	if (account.accountId) settledAccount.current = account.accountId;
	useEffect(() => {
		if (account.accountId) settledAccount.current = account.accountId;
		return subscribeRadientAuthority(queryClient, () => {
			const live = observedRadientAuthority(queryClient);
			const previous = settledAccount.current;
			if (!previous) return;
			if (live.accountId === previous) return;
			/*
			 * `undefined` here means one of two things, and only one is a purge:
			 * the transition is still pending (nothing to do yet), or the account is
			 * settled-absent because someone signed out. `observedRadientAuthority`
			 * reports both as `undefined`, so ask the authority directly rather than
			 * inventing a field on that projection.
			 */
			const settledSignOut =
				live.accountId === undefined && radientAuthoritySignedOut(queryClient);
			if (live.accountId === undefined && !settledSignOut) return;
			settledAccount.current = live.accountId;
			queueMicrotask(() => teamBridgePurgeAccount(queryClient, previous));
		});
	}, [account.accountId, queryClient]);

	// Remount immediately at the real auth transition, before stale TB status can
	// render. Retain only original-owner data; never carry an A callback into B.
	return (
		<TeamBridgeOwnedPage
			key={account.token}
			accountId={account.accountId}
			drafts={drafts.current}
			receipts={receipts.current}
		/>
	);
};

const TeamBridgeOwnedPage: FC<{
	accountId?: string;
	drafts: Map<string, OwnedDraft>;
	receipts: Map<
		string,
		Map<string, { id: string; tenantId: string | undefined }>
	>;
}> = ({ accountId, drafts, receipts }) => {
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
		/* THE HOLD: a `?thread=` deep link (a notification click, a shared link)
		   must not become a thread target in this build. The conversation still
		   opens - that is the click's other half - and no selection is left
		   behind for a later render to mount. */
		TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD
			? threadTargetFromSearch(searchParams)
			: null,
	);
	const [scope, setScope] = useState<TeamBridgeScope>(() =>
		requestedTenant
			? asTeamBridgeTenantId(requestedTenant)
			: TEAM_BRIDGE_ALL_SCOPE,
	);
	const scopeChosen = useRef(Boolean(requestedTenant));
	// THE GATE IS THE FIRST READ (round-1 U-6): until it answers, every other
	// read is disabled, so an ineligible account issues no refused requests.
	const status = useTeamBridgeStatus();
	const auth = useRadientAuth();
	const capabilities = useDesktopCapabilities();
	const ownerGuard =
		(capabilities.data?.features?.team_bridge_conversation_owner_guard ?? 0) >=
		1;
	const eligibility =
		(status.data ? teamBridgeEligibility(status.data) : null) ??
		(!accountId && auth.accountRead === "signed-out"
			? "signed_out"
			: auth.unavailable
				? "update_required"
				: auth.error || status.isError || capabilities.isError
					? "unavailable"
					: capabilities.data && !ownerGuard
						? "update_required"
						: null);
	const gatePending =
		eligibility === null &&
		(!accountId || status.isPending || capabilities.isPending);
	const readsEnabled =
		!gatePending &&
		eligibility === null &&
		status.data?.account_id === accountId;
	const selfAccountId = readsEnabled ? accountId : undefined;
	const readOnly = status.data?.read_only === true || !ownerGuard;
	const owner = useBridgeOwner(accountId);
	const isCurrentOwner = () => owner.isCurrent() && ownerGuard;
	/*
	 * THE THREAD CAPABILITY, ASKED AND THEN HELD. The key is read here so the
	 * plumbing the feature returns on exists and is exercised; the build's own
	 * hold (`team-bridge-thread-gate.ts`) is what keeps the surface closed
	 * whatever this answers. An absent or failed capabilities read answers
	 * `unknown`, which the view treats as hidden.
	 */
	// The hub's status `tenants[]` is the switcher's and the merged filter's
	// authoritative source; memberships only label it (and stand in when the
	// status has no tenant list). Filtering by memberships alone dropped every
	// row of a hub tenant the memberships read lacked (F6 on #1314). The
	// account aggregate is the ONE unread read — the same cache entry the
	// sidebar badge spends. Per-org counts are joined from that payload, never
	// fetched per org.
	const memberships = useMembershipsQuery({ enabled: readsEnabled });
	const unread = useTeamBridgeUnread(readsEnabled, TEAM_BRIDGE_ALL_SCOPE, {
		accountId,
	});
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
	const list = useTeamBridgeConversations(scope, readsEnabled, accountId);
	const directory = useTeamBridgeDirectory(
		scope === TEAM_BRIDGE_ALL_SCOPE ? null : scope,
		readsEnabled,
		accountId,
	);
	const mergedView = scope === TEAM_BRIDGE_ALL_SCOPE;
	// Names only (see `useTeamBridgeDirectories`): the merged view lists no
	// roster, but its threads and DM rows still need their senders named.
	const directories = useTeamBridgeDirectories(
		mergedView
			? organizations.map((organization) => organization.tenantId)
			: [],
		readsEnabled,
		accountId,
	);
	// The reader's own name for their own messages; `user` is null until the
	// account read answers, never the user store's placeholder name.
	const selfName = auth.user?.name ?? undefined;
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
	const outbox = useTeamBridgeOutbox(accountId);
	const [channelFormOpen, setChannelFormOpen] = useState(false);

	useEffect(() => {
		if (!requestedConversation || !requestedTenant) return;
		scopeChosen.current = true;
		setScope(asTeamBridgeTenantId(requestedTenant));
		setTarget({ type: "conversation", id: requestedConversation });
		setThreadLink(
			TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD
				? threadTargetFromSearch(
						new URLSearchParams({
							tenant: requestedTenant,
							conversation: requestedConversation,
							...(requestedRoot ? { thread: requestedRoot } : {}),
						}),
					)
				: null,
		);
		setChannelFormOpen(false);
		setSearchParams({}, { replace: true });
	}, [requestedConversation, requestedTenant, requestedRoot, setSearchParams]);

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
	}, [organizations]);

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

	/*
	 * ARCHIVE / UNARCHIVE / DELETE. The archived read stays OFF until the
	 * Archived channels view is first opened (`archivedOpened`), so a reader who
	 * never looks never spends it; once opened it stays warm and every write
	 * refreshes it through the shared conversations prefix. It also turns on for
	 * a selection the live list does not hold (a deep link or a notification
	 * naming an archived channel), so that selection can resolve.
	 */
	const [archivedOpened, setArchivedOpened] = useState(false);
	const selectionOutsideLive =
		list.isSuccess &&
		target?.type === "conversation" &&
		!visibleConversations.some((row) => row.id === target.id);
	const archivedList = useArchivedTeamBridgeConversations(
		scope,
		readsEnabled && (archivedOpened || selectionOutsideLive),
		accountId,
	);
	const archivedRows = archivedList.data?.conversations ?? [];
	/*
	 * THE SELECTION RESOLVES AGAINST LIVE + ARCHIVED, through the SAME helper the
	 * view uses (review round 1, U1/D1). This used the live list alone, so an
	 * archived channel opened from the Archived channels view had no `selected`
	 * here: its history read stayed disabled (`messageState` "idle") and the banner
	 * sat over "No messages yet. Say hello.", which contradicted the confirm's
	 * promise that members keep read access.
	 */
	const selected =
		targetConversation(
			target,
			selectableConversations(visibleConversations, archivedRows),
			selfAccountId,
		) ?? outbox.conversation(scope, outboxTargetKey(target));
	const previewSelected = selected !== null && isPreviewConversation(selected);
	// Every thread read and write names the SELECTED conversation's tenant, not
	// the rail scope, so a merged-view row can never be read under another org.
	const messages = useTeamBridgeMessages(
		previewSelected ? null : (selected?.id ?? null),
		selected?.tenant_id,
		readsEnabled,
		accountId,
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
	const loadMoreArchived = useLoadMoreArchivedTeamBridgeConversations(
		scope,
		accountId,
	);
	const archive = useArchiveTeamBridgeConversation();
	const unarchive = useUnarchiveTeamBridgeConversation();
	const deleteConversation = useDeleteTeamBridgeConversation();

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

	// Scheduling and immediate sends share already-created receipts. The outbox's
	// per-target in-flight promise coalesces rapid sends before that receipt exists.
	const receiptOwner = accountId ?? "unresolved-owner";
	const receiptMap =
		receipts.get(receiptOwner) ??
		new Map<string, { id: string; tenantId: string | undefined }>();
	receipts.set(receiptOwner, receiptMap);
	const createdForDraft = { current: receiptMap };
	const targetRef = useRef(target);
	targetRef.current = target;
	const recipients = draftRecipients();
	const input = draftCreateInput(recipients);
	const sendTenant = selected?.tenant_id ?? scope;
	const sendContext = {
		accountId: accountId ?? "",
		// The guard below already refused the account-wide sentinel; brand it here,
		// where the compiler can see the check that makes it a real tenant.
		tenantId: asTeamBridgeTenantId(sendTenant),
		targetKey: outboxTargetKey(target),
		conversationId: selected?.id,
		input,
		remembered: receiptMap,
		receiptKey: `${sendTenant}|${input?.kind ?? "existing"}|${recipients.map(recipientKey).sort().join(",")}`,
	};
	const projected =
		accountId && target && sendTenant !== TEAM_BRIDGE_ALL_SCOPE
			? outbox.project(sendContext, messages.data?.messages ?? [])
			: { messages: messages.data?.messages ?? [], sendRows: undefined };

	/*
	 * A COMPOSE DRAFT BECOMES ITS NEW GROUP once the create lands, as before, so
	 * the reader sees the group they just made. A PERSON or CHIEF target is never
	 * moved: its DM is drawn on the row the reader is already on, which is what
	 * keeps that row selected and the composer focused. The local rows survive
	 * either way - the journal aliases the draft's lane to the new conversation
	 * the moment its receipt exists, so moving the target changes no row.
	 */
	const composedReceipt =
		target?.type === "compose" && sendTenant !== TEAM_BRIDGE_ALL_SCOPE
			? outbox.conversation(sendTenant, outboxTargetKey(target))
			: null;
	useEffect(() => {
		if (target?.type !== "compose" || !composedReceipt) return;
		setTarget({ type: "conversation", id: composedReceipt.id });
	}, [target, composedReceipt]);

	// Record canonical arrivals after commit, never during React render. The
	// journal's display slots are shared with pending rows, so a POST answer
	// replaces its slot rather than sorting the thread by its newly assigned seq.
	useLayoutEffect(() => {
		if (accountId && target && sendTenant !== TEAM_BRIDGE_ALL_SCOPE)
			outbox.journal.observe(
				accountId,
				sendTenant,
				outboxTargetKey(target),
				selected?.id,
				messages.data?.messages ?? [],
			);
	}, [
		accountId,
		sendTenant,
		target,
		selected?.id,
		messages.data,
		outbox.journal,
	]);

	const sendBody: TeamBridgePageViewProps["onSend"] = (
		body,
		clientRef,
		attachments,
	) => {
		if (
			!isCurrentOwner() ||
			!accountId ||
			sendTenant === TEAM_BRIDGE_ALL_SCOPE ||
			(!selected && !input)
		)
			throw new Error("Team Bridge write authority or destination unavailable");
		// Synchronous journal append, then return: the view clears/focuses in this
		// event. Create, staging and POST are serialized off the critical path for
		// BOTH existing and new conversations. Never wait for list.refetch here.
		outbox.enqueue(sendContext, body, clientRef, attachments?.chips ?? [], {
			account_id: accountId,
			kind: "human",
			display_label: selfName?.trim() || accountId,
		});
		return { queued: true };
	};

	const scheduleBody = async (
		body: string,
		clientRef: string,
		sendAt: string,
		conversationId: string | undefined,
		onCreated: (id: string) => void,
		attachments?: {
			ids: readonly string[];
			stageHeld?: (
				conversationId: string,
				tenantId: string,
			) => Promise<string[]>;
		},
	) => {
		if (readOnly || (mergedView && !selected) || target === null)
			throw new Error("schedule requires organization");
		const startedOn = target;
		return scheduleTeamBridgeDraft({
			tenantId: selected?.tenant_id ?? scope,
			conversationId: selected?.id ?? conversationId,
			recipients: draftRecipients(),
			body,
			clientRef,
			sendAt,
			attachmentIds: attachments?.ids,
			stageHeld: attachments?.stageHeld,
			remembered: createdForDraft.current,
			onCreated,
			onScheduled: (id) => {
				const next = scheduledTargetAfterSuccess(
					startedOn,
					targetRef.current,
					id,
				);
				if (next) setTarget(next);
				void list.refetch();
			},
			create: (input) =>
				create.mutateAsync(input) as Promise<{
					id?: string;
					tenant_id?: string;
				}>,
			schedule: TeamBridgeApi.scheduledCreate,
		});
	};

	// A refusal belongs to the conversation it happened in.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the selection changes.
	useEffect(() => {
		join.reset();
		notify.reset();
	}, [selected?.id, target]);

	const newest = messages.data?.messages.reduce<number | undefined>(
		(max, message) =>
			max === undefined || message.seq > max ? message.seq : max,
		undefined,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: advance the cursor only when the conversation or its newest seq changes.
	useEffect(() => {
		if (!isCurrentOwner() || selected === null || newest === undefined) return;
		// An archived channel carries no unread and is read-only: advancing its cursor
		// is a write the server has no reason to accept.
		if (selected.status === "archived") return;
		if (newest <= selected.last_read_seq) return;
		markRead.mutate({ seq: newest });
	}, [selected?.id, newest]);

	const draftKey = JSON.stringify([
		accountId,
		selected?.tenant_id ?? scope,
		target,
	]);
	const draftJournal = drafts.get(draftKey) ?? { body: "", pending: null };
	drafts.set(draftKey, draftJournal);
	return (
		<>
			<TeamBridgePageView
				key={draftKey}
				draftJournal={draftJournal}
				isDraftCurrent={isCurrentOwner}
				threadLink={threadLink}
				threadsCapabilityState={desktopFeatureState(
					capabilities.data,
					"team_bridge_threads",
				)}
				reactionsCapabilityState={desktopFeatureState(
					capabilities.data,
					"team_bridge_reactions",
				)}
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
								? isNotAMemberRefusal(messages.error)
									? "forbidden"
									: "error"
								: "ready"
				}
				conversations={conversations}
				target={target}
				messages={projected.messages}
				sendRows={projected.sendRows}
				onTakeBackSend={(clientRef, tenantId) => {
					const row = outbox.takeBack(clientRef, tenantId);
					return row ? { body: row.body, attachments: row.attachments } : null;
				}}
				resolvedConversation={selected}
				organizations={organizations}
				scope={scope}
				totalUnread={unread.data?.total ?? 0}
				membershipsLoading={organizationsPending}
				organizationsFailed={organizationsFailed}
				selfAccountId={selfAccountId}
				joining={join.isPending}
				joinFailed={join.isError}
				notifyFailed={notifyFailureIsVisible(notify, selected?.id ?? null)}
				onJoin={() => {
					if (isCurrentOwner()) join.mutate();
				}}
				onArchive={(conversation) => {
					if (!isCurrentOwner()) return;
					archive.mutate(
						{
							conversationId: conversation.id,
							tenantId: conversation.tenant_id,
						},
						{
							/* THE ROLLBACK MUST BE ANNOUNCED (review round 1, U5). The row left the
							   rail the moment the person confirmed; if the server refuses, it
							   quietly reappears. A person archiving from a row's menu is not looking
							   at that channel's header, so an inline line there is never seen:
							   a toast names the channel and says it is back. */
							onError: () =>
								showErrorToast(
									t("ui.teamBridge.archive.toast.archive_failed", {
										name: archiveChannelName(conversation),
									}),
								),
						},
					);
				}}
				onUnarchive={(conversation) => {
					if (!isCurrentOwner()) return;
					unarchive.mutate({
						conversationId: conversation.id,
						tenantId: conversation.tenant_id,
					});
				}}
				onDelete={(conversation) => {
					if (!isCurrentOwner())
						return Promise.reject(
							new Error("Team Bridge write authority changed"),
						);
					return deleteConversation.mutateAsync({
						conversationId: conversation.id,
						tenantId: conversation.tenant_id,
					});
				}}
				unarchiveFailed={notifyFailureIsVisible(
					unarchive,
					selected?.id ?? null,
				)}
				archivedState={
					archivedList.isPending
						? "loading"
						: archivedList.isError
							? "error"
							: "ready"
				}
				archivedConversations={archivedRows}
				archivedHasMore={archivedList.data?.has_more === true}
				archivedLoadingMore={loadMoreArchived.isPending}
				archivedLoadMoreFailed={loadMoreArchived.isError}
				onLoadMoreArchived={() => {
					if (isCurrentOwner()) loadMoreArchived.mutate();
				}}
				onOpenArchived={() => setArchivedOpened(true)}
				onRetryArchived={() => {
					void archivedList.refetch();
				}}
				onNotifyChange={(next) => {
					if (!isCurrentOwner() || selected === null) return;
					notify.mutate({
						conversationId: selected.id,
						tenantId: selected.tenant_id,
						notify: next,
					});
				}}
				onTarget={(next) => {
					setThreadLink(null);
					setChannelFormOpen(false);
					/* `null` is a landing with nothing left to land on: the default-landing
					   effect above then picks #humans (or the first row) once, as at load. */
					setTarget(next);
				}}
				onSend={sendBody}
				attachmentCapability={attachmentCapability(status.data)}
				onSchedule={
					scope === TEAM_BRIDGE_ALL_SCOPE && !selected
						? undefined
						: scheduleBody
				}
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
				notice={<TeamBridgeDefaultOnBanner status={status.data} />}
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
				open={channelFormOpen}
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

/** The existing DM resolver remains the authority, scoped before looking up an
 * account shared by several organizations. Read-only permits history, not drafts. */
export function profileMessageTarget(
	sender: TeamBridgeMessage["sender"],
	tenantId: string,
	conversations: readonly TeamBridgeConversation[],
	selfAccountId: string | undefined,
	readOnly: boolean,
	mergedView = true,
): TeamBridgeTarget | null {
	const next: TeamBridgeTarget = {
		type: sender.kind === "agent" ? "chief" : "person",
		accountId: sender.account_id,
	};
	const existing = targetConversation(
		next,
		conversations.filter((row) => row.tenant_id === tenantId),
		selfAccountId,
	);
	// The single-tenant rail owns this DM through its person/chief target.
	// In merged scope only an exact conversation target preserves tenant identity.
	return existing
		? mergedView
			? { type: "conversation", id: existing.id }
			: next
		: readOnly
			? null
			: next;
}
