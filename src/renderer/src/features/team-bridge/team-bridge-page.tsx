import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { TEAM_BRIDGE_ENABLED_SETTING_KEY } from "@features/settings/promoted-setting-sections";
import {
	type DesktopFeatureState,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { Spinner } from "@shared/components/common/spinner";
import {
	MessageInput,
	type MessageInputProps,
} from "@shared/components/composer";
import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { Button } from "@shared/components/ui/button";
import { ScrollArea } from "@shared/components/ui/scroll-area";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { formatRelativeTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import {
	forgetBridgeComposerRows,
	teamBridgeComposerKey,
} from "@shared/store/team-bridge-composer-rows";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import {
	Archive,
	Bot,
	Clock,
	Hash,
	MailPlus,
	Pencil,
	Plus,
	UserPlus,
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
	TeamBridgeConversationList,
	TeamBridgeDirectoryMember,
	TeamBridgeMemberInput,
	TeamBridgeMessage,
	TeamBridgeNotify,
} from "../../../../shared/team-bridge-contract";
import { rowCurrent } from "../chat/components/chat-sidebar";
import { TeamBridgeAddMembersView } from "./team-bridge-add-members";
import {
	TeamBridgeArchiveDialog,
	TeamBridgeArchivedBanner,
	TeamBridgeArchivedChannelsView,
	TeamBridgeDeleteDialog,
	archiveChannelName,
} from "./team-bridge-archive";
import {
	teamBridgeArrivalStreamKey,
	teamBridgeOpenEmptyArrivals,
	teamBridgeSuspendArrivals,
} from "./team-bridge-arrival-model";
import {
	attachmentCapability,
	isAttachmentNotFound,
	sendAttachmentIds,
} from "./team-bridge-attachments-model";
import { TeamBridgeComposeBar } from "./team-bridge-compose-bar";
import { TeamBridgeConversationMenu } from "./team-bridge-conversation-menu";
import { TeamBridgeCreateDialog } from "./team-bridge-create-dialog";
import { TeamBridgeDefaultOnBanner } from "./team-bridge-default-on-banner";
import { draftTargetKey } from "./team-bridge-drafts";
import type { TeamBridgeDraft } from "./team-bridge-drafts";
import { TeamBridgeHeldAttempt } from "./team-bridge-held-attempt";
import { TeamBridgeInvitations } from "./team-bridge-invitations";
import {
	pendingAgentInvitations,
	railInvitationsEntryShown,
} from "./team-bridge-invitations-model";
import {
	canInviteMembers,
	canRemoveMembers,
} from "./team-bridge-members-model";
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
	sendFirstMessage,
	targetConversation,
	teamBridgeEligibility,
	unmatchedDirects,
	visibleConversationRows,
} from "./team-bridge-model";
import { TeamBridgeOrgSwitcher } from "./team-bridge-org-switcher";
import { useBridgeOwner, useTeamBridgeAccount } from "./team-bridge-owner";
import {
	type OwnerAuditSlot,
	useOwnerAuditSurface,
} from "./team-bridge-owner-audit";
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
import { uploadStagedImages } from "./team-bridge-staged-upload";
import type { StagedUploadFailure } from "./team-bridge-staged-upload";
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
import { useStickToBottom } from "./use-stick-to-bottom";
import {
	teamBridgeKeys,
	useAddTeamBridgeMembers,
	useArchiveTeamBridgeConversation,
	useArchivedTeamBridgeConversations,
	useCreateTeamBridgeConversation,
	useDeleteTeamBridgeConversation,
	useJoinTeamBridgeConversation,
	useLoadMoreArchivedTeamBridgeConversations,
	useMarkTeamBridgeRead,
	useRemoveTeamBridgeMember,
	useSendTeamBridgeMessage,
	useSetTeamBridgeNotify,
	useTeamBridgeConversations,
	useTeamBridgeDirectories,
	useTeamBridgeDirectory,
	useTeamBridgeMessages,
	useTeamBridgeStatus,
	useTeamBridgeUnread,
	useUnarchiveTeamBridgeConversation,
} from "./use-team-bridge";
import { useTeamBridgeDrafts } from "./use-team-bridge-drafts";

/**
 * The shared composer draws its empty-chat splash from `messages`; a host with no
 * transcript says so with `transcriptless`, and passes the same empty list the
 * mini view does rather than a second shape of "nothing".
 */
const EMPTY_BRIDGE_MESSAGES: MessageInputProps["messages"] = [];

/**
 * Why a send was refused, in the terms the person can act on (UX round 1, U2).
 *
 * A SEND-SIDE FACT, not a chip state. The shared composer's chips are the app's own
 * and carry no failure badge and no per-file retry, so the bridge holds the refusal
 * outside them and states it in words: which hub rule refused the whole set, which
 * staged id no longer binds, or which single file failed and why.
 */
type SendRefusal =
	| { kind: "capability" }
	| { kind: "expired" }
	| { kind: "upload"; failure: StagedUploadFailure };

/**
 * The catalogue's own sentence for each upload refusal this send can produce, so
 * the reason a picture did not go is said in the words the feature already uses for
 * that failure rather than in a second phrasing written here (`error_upload` names
 * the two moves a person has: retry, or remove it).
 */
const STAGED_FAILURE_COPY = {
	read: "ui.teamBridge.attachments.error_invalid",
	unsupported: "ui.teamBridge.attachments.error_type",
	upload: "ui.teamBridge.attachments.error_upload",
} as const;

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
	/** Human-only audit never enters member targets, drafts or the agent lane. */
	ownerAudit?: OwnerAuditSlot;
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
	/** The caller's active memberships, already joined with per-org counts. */
	organizations: TeamBridgeOrganization[];
	scope: TeamBridgeScope;
	/** The account aggregate's total; the "All organizations" row shows it. */
	totalUnread: number;
	/**
	 * Rows already on screen are being re-read (`stale-while-revalidate`,
	 * tb-instant-open). The view keeps them painted and marks the rail as
	 * refreshing, so a stale list is never presented as a current one. Absent for
	 * a first load, which has its own loading state, and for the stories that do
	 * not model a refresh.
	 */
	refreshingRows?: boolean;
	/**
	 * The unread read is in flight behind painted rows. The count is the one number
	 * a reader acts on, so it is reported separately from `refreshingRows` rather
	 * than folded into it.
	 */
	refreshingUnread?: boolean;
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
	/** Membership writes, passed the selected conversation at the point of use. */
	onAddMembers?: (
		conversation: TeamBridgeConversation,
		members: TeamBridgeMemberInput[],
	) => Promise<unknown>;
	onRemoveMember?: (
		conversation: TeamBridgeConversation,
		accountId: string,
	) => Promise<unknown>;
	memberMutationKey?: string | null;
	/** Story/test seed only: opens membership administration on mount. */
	initialMembersOpen?: boolean;
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
	/** Each organization's directory read state, for the merged view's picker. */
	directoryStates?: Readonly<Record<string, "loading" | "error" | "ready">>;
	/** Re-run one organization's directory read (the merged view's retry). */
	onRetryMembers?: (tenantId: string) => void;
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
			/* Stage held images into a just-created conversation; throws on failure. */
			stageHeld?: (
				conversationId: string,
				tenantId: string | undefined,
			) => Promise<string[]>;
		},
	) => Promise<unknown> | undefined;
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
	ownerAudit,
	renderThreadPane,
	threadLink,
	onCloseThread,
	listState,
	messageState,
	conversations,
	target,
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
	onAddMembers,
	onRemoveMember,
	memberMutationKey = null,
	initialMembersOpen = false,
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
	directoryStates,
	selfName,
	peopleState = "ready",
	peopleError,
	peopleIncomplete = false,
	refreshingRows = false,
	refreshingUnread = false,
	onRetryPeople,
	onRetryMembers,
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
	const [membersOpen, setMembersOpen] = useState(initialMembersOpen);
	const [memberActionFailed, setMemberActionFailed] = useState(false);
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
		/*
		 * NO BODY SEEDED INTO THIS JOURNAL. The composer's text lives in
		 * `conversation-input-store` under `composerKey` (below) and that store is the
		 * ONE owner; this journal keeps only the facts the store cannot hold - the
		 * idempotency key, a schedule time, a create-uncertain flag and the
		 * conversation the draft became. Seeding a body here as well is how two copies
		 * come to disagree across a remount (R2).
		 */
		"",
		eligibility === "signed_out",
		scope === TEAM_BRIDGE_ALL_SCOPE,
	);
	const heldAttempt =
		Boolean(draftState.current?.sendAt) &&
		!draftState.current?.createUncertain &&
		!scheduling;

	/*
	 * THE COMPOSER'S TEXT, FROM ITS ONE OWNER.
	 *
	 * `teamBridgeComposerKey` names the account, the scope the draft was authored
	 * under and the target, so a row is unreachable from another account - the input
	 * store persists to ONE unscoped `localStorage` key, while this feature fences by
	 * account epoch (R1) - and switching between "All organizations" and a specific
	 * one does not move the text between drafts.
	 */
	const composerKey = teamBridgeComposerKey(
		selfAccountId,
		draftTenant,
		target ? draftTargetKey(target) : "",
	);
	const composerRow = useConversationInputStore(
		(state) => state.inputByConversation[composerKey],
	);
	const draft = composerRow?.currentInput ?? "";
	const stagedPaths = (composerRow?.attachments ?? []).map(
		(entry) => entry.path,
	);
	/*
	 * THE ONE-TIME HANDOVER. Earlier builds kept this draft's text in the journal and
	 * in `localStorage` under that key; the composer reads the store now, so a draft
	 * written by the version before this one is moved across once and the journal's
	 * copy cleared. Guarded on the store row being empty, so a later visit can never
	 * overwrite what the reader has typed since.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: one handover per draft key.
	useEffect(() => {
		const legacy =
			draftState.current?.body || draftJournal?.body || initialDraft;
		if (!legacy.trim()) return;
		const store = useConversationInputStore.getState();
		if (store.getCurrentInput(composerKey).trim()) return;
		store.setComposerText(composerKey, legacy);
		if (draftState.current?.body) draftState.update({ body: "" });
		if (draftJournal) draftJournal.body = "";
	}, [composerKey]);
	/*
	 * "Message scheduled" describes ONE message, and a fresh edit is not it (review
	 * round 12, n1). The edit is the composer's own now, so this watches the store
	 * instead of a keystroke handler.
	 */
	useEffect(() => {
		if (scheduledSuccess && draft.trim()) setScheduledSuccess(false);
	}, [draft, scheduledSuccess]);
	/*
	 * R1'S OTHER HALF: the drafts are DROPPED, not just unreachable. The key above
	 * carries the account, so another account cannot address these rows - but the
	 * input store persists them all to one unscoped `localStorage` entry, so without
	 * this a signed-out renderer would leave the last account's bridge text on disk.
	 * The same two facts the journal erases on are the ones watched here: sign-out,
	 * and a change of the signed-in account.
	 */
	const draftOwner = useRef(selfAccountId);
	useEffect(() => {
		const previous = draftOwner.current;
		if (
			eligibility === "signed_out" ||
			(previous && selfAccountId !== previous)
		) {
			const store = useConversationInputStore.getState();
			forgetBridgeComposerRows(store, store.clearComposer, previous);
		}
		draftOwner.current =
			eligibility === "signed_out" ? undefined : selfAccountId;
	}, [selfAccountId, eligibility]);
	/*
	 * THE INDEX FOLLOWS THE BODY (review round 1, R1-2).
	 *
	 * The journal is no longer where the text lives, but it is still the index that
	 * the rail's draft dot and the Drafts list enumerate - and the keystroke write
	 * that used to create an entry for a conversation, a person or a chief went away
	 * with the body. So an entry is created when there is something to index and none
	 * exists yet. It holds the TARGET and the idempotency key, never the text: the
	 * preview reads the store through `draftTextAt`, which is what keeps one owner
	 * for the body rather than two.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the current entry is read, not watched.
	useEffect(() => {
		if (!draft.trim() || !target || draftState.current || !isDraftCurrent())
			return;
		draftState.update({});
	}, [draft, target]);
	const [sendRefusal, setSendRefusal] = useState<SendRefusal | null>(null);
	/*
	 * Text, or at least one staged file: an attachment-only message is allowed, and
	 * the schedule control beside the composer must agree with the send about
	 * whether there is anything to take. The row is the composer's own, so this
	 * reads the one owner rather than keeping a second copy.
	 */
	const hasContent = Boolean(draft.trim()) || stagedPaths.length > 0;
	/*
	 * A DRAFT'S TEXT AND CHIPS, BY TARGET - for the rail's draft dot and the Drafts
	 * list's preview. These read the SAME owner the composer does (the row named by
	 * `teamBridgeComposerKey`); the journal no longer holds text, so reading a
	 * preview from anywhere else would be a copy that never updates. `tenantId` is
	 * the scope the entry was authored under, which is part of the key.
	 */
	const draftRows = useConversationInputStore(
		(state) => state.inputByConversation,
	);
	const draftTextAt = (tenantId: string, targetKey: string): string =>
		draftRows[teamBridgeComposerKey(selfAccountId, tenantId, targetKey)]
			?.currentInput ?? "";
	const draftStagedAt = (tenantId: string, targetKey: string): number =>
		draftRows[teamBridgeComposerKey(selfAccountId, tenantId, targetKey)]
			?.attachments.length ?? 0;
	/* Whether a draft row is worth listing at all: text, chips, or an addressed To:
	   that is waiting for its first send. `entry.attachments` is the legacy journal
	   copy, kept in the test so a draft written by the previous version still
	   lists once before the handover clears it. */
	const draftHasContent = (
		entry: TeamBridgeDraft,
		tenantId: string,
	): boolean => {
		const key = draftTargetKey(entry.target);
		return (
			Boolean(draftTextAt(tenantId, key).trim()) ||
			draftStagedAt(tenantId, key) > 0 ||
			(entry.attachments?.length ?? 0) > 0 ||
			(entry.target.type === "compose" && entry.target.recipients.length > 0)
		);
	};
	const selectTarget = (next: TeamBridgeTarget | null) => {
		ownerAudit?.clear();
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

	const selected = targetConversation(target, selectable, selfAccountId);
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
		ownerAudit?.clear();
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
	/*
	 * What the shared composer is invited to say. The same words the box had when
	 * this page drew it: a To: draft names its recipients, a conversation names
	 * itself, and a bare composer invites a message.
	 */
	const composerPlaceholder =
		target?.type === "compose" && composeRecipients.length > 0
			? t("ui.teamBridge.composer.placeholder_to", {
					name: composeRecipients
						.map((recipient) => recipient.label)
						.join(", "),
				})
			: paneTitle && target?.type !== "compose"
				? t("ui.teamBridge.composer.placeholder_to", { name: paneTitle })
				: t("ui.teamBridge.composer.placeholder");
	/* The no-destination notice's own id: distinct from the held attempt's, because
	   both arms name the box's `aria-describedby` and only one of them can be up. */
	const composeGateId = `${heldReasonId}-gate`;
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
	 * What a send or a schedule puts on the wire.
	 *
	 * THE STAGED LIST IS PATHS NOW: the composer's chips are local files until the
	 * request binds them, because the chips live in the composer's own store rather
	 * than in a strip this page draws. So EVERY request uploads inside itself, which
	 * is the arm the previous code already had for a draft whose conversation the
	 * send creates; `stageHeld` runs after the create and before the post either way
	 * (`sendAttachmentIds` prefers it over `ids`).
	 *
	 * A PARTIAL UPLOAD THROWS rather than posting the text alone - the rule the held
	 * arm has always had. A message that silently loses the picture the author
	 * staged is worse than a refusal they can act on.
	 */
	const stagedForSend = (paths: readonly string[]) => ({
		ids: [] as readonly string[],
		stageHeld: async (conversationId: string, tenant: string | undefined) => {
			const uploaded = await uploadStagedImages({
				paths,
				accountId: selfAccountId ?? "",
				tenantId:
					tenant ?? (draftTenant === TEAM_BRIDGE_ALL_SCOPE ? "" : draftTenant),
				conversationId,
				capability: imageCapability,
			});
			if (uploaded.failures.length > 0)
				setSendRefusal({ kind: "upload", failure: uploaded.failures[0] });
			if (uploaded.ids.length !== paths.length)
				throw new Error("attachment staging refused");
			return uploaded.ids;
		},
	});
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
	const timelineArrivalKey = teamBridgeArrivalStreamKey(
		shown?.tenant_id,
		shown?.id,
	);
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
		resetKey: `${shown?.tenant_id ?? ""}:${shown?.id ?? ""}:${messageState}:${quickView ?? ""}`,
		contentKey: `${messages.length}:${messages.at(-1)?.id ?? ""}`,
	});
	// The retry's idempotency key: a failed send is retried with the SAME
	// `client_ref`, so an ambiguous failure (request landed, answer lost) cannot
	// post the message twice. A genuinely different draft gets a fresh key.
	const pendingSend = useRef<{ body: string; clientRef: string } | null>(
		draftJournal?.pending ?? null,
	);
	/*
	 * THE SHARED COMPOSER'S SEND BINDING.
	 *
	 * The box, the chips and the clearing belong to `MessageInput` now; what stays
	 * here is what a composer cannot know - the target, the create-or-post
	 * resolution, the idempotency key and the hub's attachment binding. `false` is a
	 * REFUSAL and it is returned before anything is retired, so a refused send
	 * leaves the text and chips where the reader can retry them (R6b); `true` lets
	 * the box clear itself, which is the only clear a transcriptless host gets.
	 */
	const submit = async (content: string, attachments: string[]) => {
		/*
		 * A MESSAGE CAN BE THE PICTURE (UX round 1, U1). The shared composer enables and
		 * admits an attachment-only payload, so refusing `!body` here made an enabled Send
		 * do nothing at all - no request, no error, chips kept. The upload guards below are
		 * unchanged, so an image that cannot be read or bound still refuses.
		 */
		const body = content.trim();
		if (
			(!body && attachments.length === 0) ||
			!isDraftCurrent() ||
			sending ||
			scheduling ||
			writing.current ||
			draftState.current?.createUncertain ||
			draftState.current?.sendAt ||
			!canCompose ||
			!target
		)
			return false;
		/*
		 * THE HUB'S IMAGE CAPABILITY IS REFUSED HERE, not by hiding an affordance: the
		 * attach control belongs to the shared composer and accepts any file, so the
		 * refusal has to be a sentence at the only place that can act on it.
		 */
		if (attachments.length > 0 && !imageCapability) {
			setSendRefusal({ kind: "capability" });
			return false;
		}
		setSendRefusal(null);
		const clientRef = draftState.current?.clientRef ?? crypto.randomUUID();
		if (!draftState.update({ clientRef })) return false;
		// ONE attempt, named in both stores: main's optimistic-row journal and
		// this branch's durable row must carry the same `client_ref`, or a retry
		// after a remount could post the message twice.
		const entry = { body, clientRef };
		pendingSend.current = entry;
		if (draftJournal) draftJournal.pending = entry;
		// Fenced BEFORE the call: the upload inside it stages into a conversation
		// this request may be creating (R1-02).
		writing.current = true;
		// The author's own send lands in view when it arrives (F9).
		timeline.pin();
		try {
			await onSend(body, clientRef, stagedForSend(attachments));
			/*
			 * THE BOX CLEARS ITSELF on an accepted send (`transcriptless`): it compares the
			 * row it sent against the row it holds now, so text typed during the request
			 * survives while the sent text goes. Computing that comparison from THIS
			 * render was the tautology of round 12's B1; all this side retires is its own
			 * attempt record, which names a request that is over.
			 */
			if (isDraftCurrent() && pendingSend.current === entry) {
				pendingSend.current = null;
				if (draftJournal) draftJournal.pending = null;
			}
			return true;
		} catch (error) {
			/*
			 * THE RESTORE IS THE COMPOSER'S, and this is the path that finally fires it
			 * (R4): `false` hands the payload back through the store the box reads, so
			 * the text and the chips are still there for the retry. A create-uncertain
			 * outcome does NOT come through here - that is the schedule's arm, and its
			 * recovery is the held-attempt chrome beside the box.
			 */
			if (isAttachmentNotFound(error)) setSendRefusal({ kind: "expired" });
			return false;
		} finally {
			writing.current = false;
		}
	};
	const schedule = async (sendAt: string) => {
		if (
			!target ||
			!onSchedule ||
			writing.current ||
			draftState.current?.createUncertain ||
			!hasContent ||
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
		/*
		 * WHAT THIS SCHEDULE TAKES, SNAPSHOTTED AT THE PRESS (UX round 1, U5). The
		 * settle arm has to tell "the box still holds what went out" from "the person
		 * added a picture while the request was in flight", and only a snapshot taken
		 * here can answer that - a render-time read would be the same tautology the
		 * composer's own clear had to retire.
		 */
		const scheduledPaths = stagedPaths;
		/*
		 * THE SAME PATH-UPLOADING BINDING THE SEND USES, so a scheduled message carries
		 * the chips its author staged rather than the text alone. The upload runs inside
		 * the request, after the create, exactly as a plain send's does.
		 */
		const carried = stagedForSend(scheduledPaths);
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
				carried,
			);
			/*
			 * THE BOX CLEARS ON A SCHEDULED SEND TOO. The composer only clears itself for a
			 * send IT made, and this one went out through the schedule path, so the row is
			 * retired here - text and chips together, from the store that holds them.
			 */
			if (draftJournal && draftJournal.body.trim() === body)
				draftJournal.body = "";
			/*
			 * ONLY THE COPY THIS SCHEDULE RETIRED (review round 1, R1-4; UX round 1, U5).
			 * A blanket clear would eat text typed while the request was in flight, and
			 * `heldAttempt` is false while `scheduling` is true, so nothing else stands
			 * between the reader and that loss. The chips need the same test: text can
			 * still match while a picture added mid-request does not, and clearing then
			 * would retire a chip that never went anywhere. Both match -> the whole box
			 * goes; otherwise only the paths this schedule carried are removed and the
			 * scheduled text is retired, so what the person added since survives.
			 */
			const composerStore = useConversationInputStore.getState();
			const composerState = composerStore.inputByConversation[composerKey];
			const currentPaths = (composerState?.attachments ?? []).map(
				(entry) => entry.path,
			);
			const textStillScheduled =
				composerStore.getCurrentInput(composerKey).trim() === body;
			const chipsStillScheduled =
				currentPaths.length === scheduledPaths.length &&
				currentPaths.every((path, index) => path === scheduledPaths[index]);
			if (textStillScheduled && chipsStillScheduled) {
				composerStore.clearComposer(composerKey);
			} else {
				for (const entry of composerState?.attachments ?? [])
					if (scheduledPaths.includes(entry.path))
						composerStore.removeAttachment(composerKey, entry.id);
				if (textStillScheduled) composerStore.setComposerText(composerKey, "");
			}
			draftState.clearSent(entryKey, body, clientRef);
			setScheduledSuccess(true);
		} catch (error) {
			setScheduleFailed(true);
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
							(Boolean(
								draftTextAt(tenantId, draftTargetKey(entry.target)).trim(),
							) ||
								draftStagedAt(tenantId, draftTargetKey(entry.target)) > 0 ||
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
				aria-busy={refreshingRows || refreshingUnread || undefined}
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
						unreadRefreshing={refreshingUnread}
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
					{/*
					 * STALE-WHILE-REVALIDATE, VISIBLY (tb-instant-open). Cached rows stay
					 * on screen while the reads behind them settle, so the rail says they
					 * are being re-read rather than presenting a stale list as a current
					 * one. The slot is always in the flow and only its colour role changes,
					 * so a poll cannot reflow the rail under the reader. `data-rail-refreshing`
					 * names which read is behind it. No new copy: this is a state of the
					 * rail, and what a screen reader needs to hear is the affected regions'
					 * own `aria-busy`.
					 *
					 * AND NEITHER READ WEARS THE ATTENTION HUE (design round 1, D2). Green in
					 * this rail is the mark of a count the reader owes attention to: every
					 * row's `AttentionBadge` sits beside this dot, and so does the collapsed
					 * sidebar's More badge. A green dot four rows above those badges reads as
					 * a count of unread, and makes the one mark readers trust mean the
					 * opposite kind of thing. Attention is a count; liveness is plumbing. So
					 * both refresh states are `ink-dim`, and which read is behind the dot
					 * stays in `data-rail-refreshing` - for instruments and tests rather than
					 * for eyes, because a difference no reader can act on does not earn a hue.
					 */}
					<span
						data-rail-refreshing={
							refreshingUnread ? "unread" : refreshingRows ? "rows" : undefined
						}
						aria-hidden="true"
						className={cn(
							"size-1.5 shrink-0 rounded-full",
							refreshingUnread || refreshingRows
								? "bg-ink-dim"
								: "bg-transparent",
						)}
					/>
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
					{/*
					 * THE SENTENCE MUST MATCH WHAT IS UNDER IT (design round 1, D1).
					 * `listState` is "error" whenever `list.isError`, and `conversations`
					 * falls back to the watcher's cached rows, so this branch now renders
					 * above rows that are painted and usable - one failed read (an offline
					 * blip, a 5xx) after a good one. "Conversations could not be loaded."
					 * is then false about the pixels: the reader can see the conversations.
					 * What actually failed is the refresh, so with rows on screen the note
					 * says that, and takes the quiet underlined retry the chat sidebar
					 * already uses for its own stale list rather than an error panel's
					 * button. With nothing painted the old sentence is still exactly true
					 * and keeps its panel and button.
					 */}
					{listState === "error" &&
						(sidebarRows.length > 0 ? (
							<div className="space-y-1 px-3 py-3 text-[12px] text-ink-muted">
								<p>{t("ui.teamBridge.list.error_stale")}</p>
								{onRetry && (
									<button type="button" className="underline" onClick={onRetry}>
										{t("ui.teamBridge.list.retry")}
									</button>
								)}
							</div>
						) : (
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
						))}
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
													draftTextAt(
														draftTenant,
														`person:${member.account_id}`,
													).trim(),
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
													draftTextAt(
														draftTenant,
														`chief:${chief.person.account_id}`,
													).trim(),
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
					{ownerAudit?.rail(() => {
						setQuickView(null);
						setThreadSelection(null);
						onCloseThread?.();
					})}
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
				{notice}
				{ownerAudit?.active ? (
					ownerAudit.panel
				) : quickView === "invitations" ? (
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
						{draftState.entries.filter(({ entry, tenantId }) =>
							draftHasContent(entry, tenantId),
						).length === 0 && (
							<p className="text-ink-muted">
								{t("ui.teamBridge.drafts.empty")}
							</p>
						)}
						{draftState.entries
							.filter(({ entry, tenantId }) => draftHasContent(entry, tenantId))
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
										{draftTextAt(tenantId, draftTargetKey(entry.target)) ||
											entry.body}
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
								{/*
								 * THE INVITE ACTION WEARS ITS NAME, NEXT TO THE COUNT IT ACTS ON
								 * (design review round 1, D2). It shipped as a 28px unlabelled
								 * ghost glyph in the far cluster, while the membership summary -
								 * the very number the action changes - sat inert beside the title,
								 * so the affordance was the quietest mark on a header whose job
								 * here is invitation. It is a labelled ghost button now (no
								 * border, no fill: nothing lifts), placed where the count is.
								 */}
								{shown &&
									!previewSelected &&
									!readOnly &&
									onAddMembers &&
									canInviteMembers(shown, selfAccountId) && (
										<Button
											type="button"
											size="sm"
											variant="ghost"
											className="shrink-0"
											onClick={() => {
												setMemberActionFailed(false);
												setMembersOpen(true);
											}}
										>
											<UserPlus size={14} aria-hidden="true" />
											{t("ui.teamBridge.members.menu")}
										</Button>
									)}
								<div className="ms-auto flex items-center gap-1">
									{shown && !previewSelected && !readOnly && onNotifyChange && (
										<TeamBridgeConversationMenu
											conversation={shown}
											onNotifyChange={onNotifyChange}
											onAddMembers={
												onAddMembers && canInviteMembers(shown, selfAccountId)
													? () => {
															setMemberActionFailed(false);
															setMembersOpen(true);
														}
													: undefined
											}
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
								) : target?.type === "conversation" &&
									shown === null &&
									listState === "ready" ? (
									/*
									 * An addressed conversation id that is NOT in the caller's own list.
									 * This is not an empty thread. The list only carries conversations the
									 * CALLER participates in, so the honest answers are "not a member" and
									 * "archived" — and rendering the draft intro here told a reader "this is
									 * the beginning of your direct message history" about a DM of six
									 * messages (team-bridge report, 2026-10-28). Say the plain fact and leave
									 * the composer closed: `canCompose` is already false for this target.
									 */
									<p className="px-5 py-8 text-[13px] text-ink-muted">
										{t("ui.teamBridge.thread.not_available")}
									</p>
								) : shown === null ? (
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
								) : messageState === "loading" ? (
									<div className="flex items-center justify-center py-10">
										<Spinner
											size="sm"
											label={t("ui.teamBridge.thread.loading")}
										/>
									</div>
								) : messageState === "error" ? (
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

						{/* THE SHARED COMPOSER, NOT A SECOND ONE. The box, its field, its
						    chips and its Send are `MessageInput`'s - the same assembly the
						    chat pane and the mini view mount - so this page stops owning a
						    composer of its own that drifts from the app's. What a composer
						    cannot know (the target, the hub's attachment binding, a
						    schedule) travels in as props or sits BESIDE it as host chrome.
						    THE BAND CLIPS NOTHING: the composer draws its focus ring OUTSIDE
						    the box, and an ancestor that clips at its padding box eats that
						    edge (R3). The recovery alerts that used to live in that scroller
						    now sit above the box, which is also where a reader looks for
						    them; the schedule control, which has no composer slot, sits
						    below it. */}
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
								<div className="flex min-w-0 shrink-0 flex-col gap-2 px-4 pt-1">
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
									{/*
									 * WHAT THE SEND COULD NOT TAKE, AND WHAT TO DO ABOUT IT (UX round 1,
									 * U2). The shared composer's chips are the app's own and carry no
									 * failure badge and no per-file retry, so pointing at "images marked
									 * with an error" sent a person hunting for a mark that does not exist.
									 * This names the file and the reason, and each branch states a move they
									 * actually have: remove the chip, or send again.
									 */}
									{sendRefusal && (
										<p className="text-sm text-danger" role="alert">
											{sendRefusal.kind === "capability" &&
												t("ui.teamBridge.attachments.unsupported")}
											{sendRefusal.kind === "expired" &&
												t("ui.teamBridge.attachments.expired_staged_retry")}
											{sendRefusal.kind === "upload" && (
												/* The file and its reason, side by side with a GAP rather
												   than a typed separator: the sentence is a complete one
												   from the catalogue, and a literal ": " here would be
												   copy the i18n gates have to police. */
												<span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
													<span className="font-medium">
														{sendRefusal.failure.name}
													</span>
													<span>
														{t(STAGED_FAILURE_COPY[sendRefusal.failure.reason])}
													</span>
												</span>
											)}
										</p>
									)}
									{sendFailed && (
										<p role="alert" className="text-sm text-danger">
											{t("ui.teamBridge.composer.error")}
										</p>
									)}
									{draftState.storageFailed && (
										<p role="alert" className="text-sm text-danger">
											{t("ui.teamBridge.drafts.storage_failed")}
										</p>
									)}
									<MessageInput
										conversationId={composerKey}
										messages={EMPTY_BRIDGE_MESSAGES}
										isLoading={false}
										/* No transcript, no job and no Stop: the empty-chat splash
										   and the turn machinery are the chat pane's, and this host
										   clears its own accepted send (U1). */
										transcriptless
										ownGutter
										/* A SECOND LIVE COMPOSER NEEDS ITS OWN REGISTRATION, or this
										   box and the chat pane's overwrite each other's
										   push-to-talk handler in the manager's id-keyed map (R5). */
										speechRegistrationId="team-bridge-composer"
										placeholderOverride={composerPlaceholder}
										onSendMessage={submit}
										hostNotice={
											heldAttempt ||
											(draftState.current?.createUncertain && !scheduling)
												? {
														id: heldReasonId,
														node: heldAttempt ? (
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
																	if (writing.current || scheduling || sending)
																		return;
																	// This releases only the local attempt; the explicit
																	// acknowledgement asks the reader to check/cancel any
																	// server schedule before minting a fresh key.
																	if (
																		draftState.update({
																			sendAt: undefined,
																			clientRef: crypto.randomUUID(),
																		})
																	)
																		setScheduleFailed(false);
																}}
															/>
														) : (
															<div role="alert" className="text-sm text-danger">
																<p id={heldReasonId}>
																	{t("ui.teamBridge.schedule.create_uncertain")}
																</p>
																<Button
																	variant="ghost"
																	onClick={() =>
																		draftState.update({
																			createUncertain: false,
																		})
																	}
																>
																	{t("ui.teamBridge.schedule.create_retry")}
																</Button>
															</div>
														),
														/* A held or uncertain attempt refuses the box: the
														   attempt already owns this draft's idempotency key, and
														   a second send would race it. */
														blocksInput: true,
														statedByNode: true,
														placeholder: composerPlaceholder,
													}
												: !canCompose
													? {
															/* No destination yet. The box still renders - it is the
															   composer this host has - and states why it refuses
															   instead of inviting text it cannot send. */
															id: composeGateId,
															node: (
																<p
																	id={composeGateId}
																	className="text-sm text-ink-muted"
																>
																	{t("ui.teamBridge.compose.empty")}
																</p>
															),
															blocksInput: true,
															statedByNode: true,
															placeholder: composerPlaceholder,
														}
													: undefined
										}
									/>
									{/* HOST CHROME THE COMPOSER HAS NO SLOT FOR. Scheduling needs the
									   target and a time, neither of which is typing, and the
									   restored attempt above names the clock by id. */}
									{/*
									 * THE LINE UNDER THE BOX HEARS BOTH FACTS (UX round 1, U3 + U4).
									 * The shared composer shows its keyboard hints on ITS controls (the
									 * mic), not at the point of typing, so the principal chord had become
									 * undiscoverable when the bridge stopped drawing its own box. While a
									 * send is in flight the same slot says why the schedule control is
									 * refusing - the app's own sentence for that state, borrowed rather than
									 * written a second time.
									 */}
									<div className="flex items-center gap-2 px-1 pb-4">
										<span
											className={cn(
												"min-w-0 flex-1 truncate ps-1.5 text-meta-sm text-ink-dim transition-opacity duration-fast",
												sending || hasContent ? "opacity-100" : "opacity-0",
											)}
											aria-hidden={!(sending || hasContent)}
										>
											{sending
												? t("ui.chat.canonical.send_failure.send_lock")
												: t("ui.teamBridge.composer.hint")}
										</span>
										{onSchedule && (
											<Button
												ref={clockRef}
												variant="ghost"
												size="icon"
												aria-label={t("ui.teamBridge.schedule.title")}
												/* The line above already says this while a send is in
												   flight; the control says it too, so the refusal is
												   reachable from the control itself (UX round 1, U3). */
												title={
													sending
														? t("ui.chat.canonical.send_failure.send_lock")
														: undefined
												}
												aria-describedby={
													draftState.current?.createUncertain && !scheduling
														? heldReasonId
														: heldAttempt
															? heldReasonId
															: !canCompose
																? composeGateId
																: undefined
												}
												disabled={
													Boolean(draftState.current?.sendAt) ||
													Boolean(draftState.current?.createUncertain) ||
													!hasContent ||
													sending ||
													scheduling ||
													!canCompose
												}
												onClick={() => setScheduleOpen(true)}
											>
												<Clock size={16} aria-hidden="true" />
											</Button>
										)}
									</div>
									<TeamBridgeScheduleDialog
										open={scheduleOpen}
										returnFocus={clockRef}
										onOpenChange={setScheduleOpen}
										busy={scheduling}
										onSchedule={schedule}
									/>
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
			{shown && (
				<TeamBridgeAddMembersView
					open={membersOpen}
					conversation={shown}
					people={shown ? rosterFor(shown.tenant_id) : []}
					selfAccountId={selfAccountId}
					peopleState={
						mergedView
							? (directoryStates?.[shown.tenant_id] ?? "loading")
							: peopleState
					}
					canInvite={!readOnly && canInviteMembers(shown, selfAccountId)}
					canRemove={!readOnly && canRemoveMembers(shown, selfAccountId)}
					mutationError={memberActionFailed}
					pendingKey={memberMutationKey}
					onClose={() => {
						if (memberMutationKey) return;
						setMembersOpen(false);
						setMemberActionFailed(false);
					}}
					onRetryMembers={onRetryMembers}
					onAdd={(members) => {
						if (
							!onAddMembers ||
							readOnly ||
							!canInviteMembers(shown, selfAccountId)
						)
							return;
						setMemberActionFailed(false);
						void onAddMembers(shown, members).catch(() => {
							setMemberActionFailed(true);
						});
					}}
					onRemove={(accountId) => {
						if (
							!onRemoveMember ||
							readOnly ||
							!canRemoveMembers(shown, selfAccountId)
						)
							return;
						setMemberActionFailed(false);
						void onRemoveMember(shown, accountId).catch(() => {
							setMemberActionFailed(true);
						});
					}}
				/>
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
export const TeamBridgePage: FC<{ selfAccountId?: string }> = () => {
	const account = useTeamBridgeAccount();
	const drafts = useRef(new Map<string, OwnedDraft>());
	const receipts = useRef(
		new Map<
			string,
			Map<string, { id: string; tenantId: string | undefined }>
		>(),
	);
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
	/* The feature's one cache reader: the opening snapshot below is read from it, and
	   the writes that patch cached pages run through it. */
	const client = useQueryClient();
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
	/*
	 * THE OPENING SNAPSHOT (tb-instant-open, mechanism 1 as far as it honestly
	 * reaches). The shell's notification watcher has been polling this account's
	 * conversation list while this page was closed, under this account's own cache
	 * key - so on a warm open the rows the rail needs are already here, read under
	 * the same ownership this page would request them with, and no new request is
	 * added to feed this page.
	 *
	 * It is used ONLY while the scope this page reads has no data of its own: an
	 * answer that has landed always wins, so a snapshot can never shadow a current
	 * read. Every row still passes through `visibleConversationRows`, so a snapshot
	 * taken at account scope cannot show one organization's rows under another's
	 * title. The watcher carries no message bodies, so the selected thread's history
	 * is still its own read and its own loading state - nothing here implies it was
	 * already fetched.
	 */
	const openingRows = accountId
		? client.getQueryData<TeamBridgeConversationList>(
				teamBridgeKeys.conversations(TEAM_BRIDGE_ALL_SCOPE, accountId),
			)?.conversations
		: undefined;
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
	/*
	 * THE SCOPE IS DECIDED BEFORE THE LIST IS READ (tb-instant-open).
	 *
	 * The organization set comes from the status payload this container already
	 * holds, so for a single-organization account the scope is knowable in the same
	 * commit the gate opens. Reading the merged list first and replacing it once the
	 * adoption effect ran spent a round trip on every cold open: the request the
	 * reader waited behind was one this page then threw away. The list is therefore
	 * HELD until the scope state agrees with what the organizations imply; the
	 * adoption effect below then sets it, and the one list read is the one kept.
	 *
	 * A hold, not a spinner over a slow call: it adds no round trip to the path (the
	 * rows cannot be known before the organizations are) and it removes the request
	 * that would have been discarded.
	 */
	const scopeSettled =
		preferredScope(organizations, scope, scopeChosen.current, openingRows) ===
		scope;
	// `organizationsPending` is the same rule one step earlier: the answer that
	// decides the scope is still in flight, so a read now would be a read this
	// page is about to replace.
	const scopeDecided = scopeSettled && !organizationsPending;
	const list = useTeamBridgeConversations(
		scope,
		readsEnabled && scopeDecided,
		accountId,
	);
	const directory = useTeamBridgeDirectory(
		scope === TEAM_BRIDGE_ALL_SCOPE ? null : scope,
		readsEnabled,
		accountId,
	);
	const mergedView = scope === TEAM_BRIDGE_ALL_SCOPE;
	// Names only (see `useTeamBridgeDirectories`): the merged view lists no
	// roster, but its threads and DM rows still need their senders named - and
	// the member picker needs each read's own state and a retry that addresses
	// it, which is why the hook answers with more than the rosters.
	const directoriesRead = useTeamBridgeDirectories(
		mergedView
			? organizations.map((organization) => organization.tenantId)
			: [],
		readsEnabled,
		accountId,
	);
	// The reader's own name for their own messages; `user` is null until the
	// account read answers, never the user store's placeholder name.
	const selfName = auth.user?.name ?? undefined;
	const conversations = list.data?.conversations ?? openingRows ?? [];
	/*
	 * PAINT BEFORE THE VERDICT (tb-instant-open, mechanism 2). The status answer
	 * decides whether this surface exists for the account at all, so the gate used
	 * to hold a full-screen spinner until it landed - and only then did the reads
	 * the rail needs even start, which is the serial waterfall the reader sat
	 * behind. Rows this account already read under its own cache key are not a
	 * verdict: they are this account's own history, fetched by the shell's watcher.
	 *
	 * The line is drawn here and nowhere else: an ELIGIBILITY answer still wins
	 * outright (it is returned above this), and every WRITE stays shut because the
	 * owner guard has not answered yet, so `isCurrentOwner()` refuses and `readOnly`
	 * keeps the controls out of action. What a verdict adds is the surface itself,
	 * not permission to show rows the account already held.
	 */
	const paintedRows = conversations.length > 0;
	const cachedPaint = gatePending && paintedRows;
	/*
	 * WHAT THE RAIL OWES THE READER (tb-instant-open, mechanism 4). `paintedRows` is
	 * the only condition: an affordance for a read that is not on screen yet would
	 * describe a list nobody is looking at. One affordance carries one meaning - the
	 * rows on screen are NOT CONFIRMED CURRENT - which covers both halves of this
	 * change: rows still being re-read, and rows painted from the watcher's snapshot
	 * before the verdict answered. It stays up from the first painted row until the
	 * scope's own read lands. The unread read is reported separately because that
	 * count is the one number a reader acts on, and it must never go stale in
	 * silence.
	 */
	const refreshingRows =
		paintedRows &&
		(cachedPaint || list.isFetching || (mergedView && organizationsPending));
	const refreshingUnread = paintedRows && unread.isFetching;
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
	/*
	 * The slot's callbacks are recreated every render, so the deep-link effect
	 * below reaches the LATEST `clear` through a ref rather than listing an
	 * unstable function as a dependency (which would either loop or go stale).
	 */
	const clearOwnerAudit = useRef<() => void>(() => {});
	const ownerAudit = useOwnerAuditSurface({
		accountId,
		enabled:
			readsEnabled &&
			(capabilities.data?.features?.team_bridge_owner_audit ?? 0) >= 1,
		scopeKey: scope,
		organizations: mergedView
			? organizations
			: organizations.filter((row) => row.tenantId === scope),
		onSelect: () => {
			setTarget(null);
			setThreadLink(null);
		},
	});

	clearOwnerAudit.current = () => ownerAudit?.clear();

	useEffect(() => {
		if (!requestedConversation || !requestedTenant) return;
		scopeChosen.current = true;
		setScope(asTeamBridgeTenantId(requestedTenant));
		/*
		 * A deep link or notification click is a HUMAN target: it must take the
		 * reader out of the audit panel the same way a rail row or a quick view
		 * does, or the audit pane keeps the window while the target changes
		 * underneath it (agent review round 1, m2).
		 */
		clearOwnerAudit.current();
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
	// Before that list exists, the watcher's snapshot stands in - and the list
	// supersedes it the moment it answers (tb-instant-open).
	useEffect(() => {
		setScope((current) =>
			preferredScope(organizations, current, scopeChosen.current, openingRows),
		);
	}, [organizations, openingRows]);

	const visibleConversations = useMemo(
		() => visibleConversationRows(conversations, scope, organizations),
		[conversations, scope, organizations],
	);

	// Land on the first rail row once (built-ins lead), not on every refetch:
	// a poll must not move the reader out of the thread they are reading.
	useEffect(() => {
		if (
			!ownerAudit?.active &&
			target === null &&
			visibleConversations.length > 0
		) {
			const first =
				visibleConversations.find((row) => row.builtin === "humans") ??
				visibleConversations[0];
			setTarget({ type: "conversation", id: first.id });
		}
	}, [visibleConversations, target, ownerAudit?.active]);

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
	const selected = targetConversation(
		target,
		selectableConversations(visibleConversations, archivedRows),
		selfAccountId,
	);
	const previewSelected = selected !== null && isPreviewConversation(selected);
	// Every thread read and write names the SELECTED conversation's tenant, not
	// the rail scope, so a merged-view row can never be read under another org.
	const messages = useTeamBridgeMessages(
		previewSelected ? null : (selected?.id ?? null),
		selected?.tenant_id,
		readsEnabled,
		accountId,
	);
	const send = useSendTeamBridgeMessage(
		selected?.id ?? "",
		selected?.tenant_id,
	);
	const addMembers = useAddTeamBridgeMembers();
	const removeMember = useRemoveTeamBridgeMember();
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
	const [creating, setCreating] = useState(false);
	const [firstSendFailed, setFirstSendFailed] = useState(false);
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
	const receiptOwner = accountId ?? "unresolved-owner";
	const receiptMap =
		receipts.get(receiptOwner) ??
		new Map<string, { id: string; tenantId: string | undefined }>();
	receipts.set(receiptOwner, receiptMap);
	const createdForDraft = { current: receiptMap };
	/*
	 * The target the reader is looking at NOW, for an async send to compare
	 * against after it resolves (review round 1, R1-6): the closure's `target`
	 * is the one from the render that started the send.
	 */
	const targetRef = useRef(target);
	targetRef.current = target;

	const sendBody = async (
		body: string,
		clientRef: string,
		attachments?: {
			ids: readonly string[];
			stageHeld?: (
				conversationId: string,
				tenantId: string | undefined,
			) => Promise<string[]>;
		},
	) => {
		if (!isCurrentOwner())
			throw new Error("Team Bridge write authority changed");
		if (selected !== null)
			return send.mutateAsync({
				clientRef,
				body,
				// Held images stage into the selected conversation FIRST; a failed
				// upload throws here, so the text never posts alone (R1-01).
				attachmentIds: await sendAttachmentIds(
					attachments,
					selected.id,
					selected.tenant_id,
				),
			});
		const recipients = draftRecipients();
		const input = draftCreateInput(recipients);
		if (input === null) return undefined;
		const draftKey = `${mergedView ? "*" : scope}|${input.kind}|${recipients
			.map(recipientKey)
			.sort()
			.join(",")}`;
		const startedOn = target;
		setCreating(true);
		setFirstSendFailed(false);
		try {
			const { id: conversationId } = await sendFirstMessage({
				draftKey,
				input,
				body,
				clientRef,
				tenantId: mergedView ? undefined : scope,
				remembered: createdForDraft.current,
				create: (createInput) =>
					create.mutateAsync(createInput) as Promise<{
						id?: string;
						tenant_id?: string;
					}>,
				// Straight to the API rather than the selected conversation's
				// mutation hook: that hook is bound to the conversation selected at
				// RENDER time, which a just-created row is not yet. Held images are
				// staged INTO the new conversation first; a failed upload throws so
				// the message is never posted text-only behind the author's back.
				post: async (id, message) => {
					if (!isCurrentOwner())
						throw new Error("Team Bridge write authority changed");
					return TeamBridgeApi.send(id, {
						...message,
						expectedAccountId: accountId,
						attachmentIds: await sendAttachmentIds(
							attachments,
							id,
							message.tenantId,
						),
					});
				},
			});
			/*
			 * Move to the new group only if the reader is STILL on the draft that
			 * sent it. A person or chief target needs no move: once the list
			 * refetches, the same target resolves to the new DM by itself.
			 */
			if (!isCurrentOwner()) return;
			if (startedOn?.type === "compose" && targetRef.current === startedOn) {
				setTarget({ type: "conversation", id: conversationId });
			}
			await list.refetch();
			return { id: conversationId };
		} catch (error) {
			if (isCurrentOwner()) setFirstSendFailed(true);
			throw error;
		} finally {
			if (isCurrentOwner()) setCreating(false);
		}
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
		send.reset();
		join.reset();
		notify.reset();
		setFirstSendFailed(false);
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
				ownerAudit={ownerAudit}
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
						? paintedRows
							? "ready"
							: "loading"
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
				messages={messages.data?.messages ?? []}
				organizations={organizations}
				scope={scope}
				totalUnread={unread.data?.total ?? 0}
				refreshingRows={refreshingRows}
				refreshingUnread={refreshingUnread}
				membershipsLoading={organizationsPending}
				organizationsFailed={organizationsFailed}
				selfAccountId={selfAccountId}
				sending={send.isPending || creating}
				sendFailed={send.isError || firstSendFailed}
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
				onAddMembers={(conversation, members) => {
					if (!isCurrentOwner() || !canInviteMembers(conversation, accountId))
						return Promise.reject(
							new Error("Team Bridge write authority changed"),
						);
					return addMembers.mutateAsync({
						conversationId: conversation.id,
						tenantId: conversation.tenant_id,
						members,
						key: "add",
					});
				}}
				onRemoveMember={(conversation, memberAccountId) => {
					if (!isCurrentOwner() || !canRemoveMembers(conversation, accountId))
						return Promise.reject(
							new Error("Team Bridge write authority changed"),
						);
					return removeMember.mutateAsync({
						conversationId: conversation.id,
						tenantId: conversation.tenant_id,
						accountId: memberAccountId,
						key: `remove:${memberAccountId}`,
					});
				}}
				memberMutationKey={
					addMembers.isPending
						? "add"
						: removeMember.isPending
							? (removeMember.variables?.key ?? "remove")
							: null
				}
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
				directories={directoriesRead.members}
				directoryStates={directoriesRead.state}
				onRetryMembers={(tenantId) => {
					// The merged view mounts one read per organization; the single-scope
					// read is the one the rest of the page already shows and retries.
					if (mergedView) directoriesRead.retry(tenantId);
					else void directory.refetch();
				}}
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
				gatePending={gatePending && !cachedPaint}
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
