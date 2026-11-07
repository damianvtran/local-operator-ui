import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { TEAM_BRIDGE_ENABLED_SETTING_KEY } from "@features/settings/promoted-setting-sections";
import {
	type DesktopFeatureState,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	TeamBridgeApi,
	requireBridgeWriteAccount,
} from "@shared/api/local-operator/team-bridge-api";
import { Spinner } from "@shared/components/common/spinner";
import { useLeftSidebarHosted } from "@shared/components/navigation/left-sidebar-host";
import { SIDEBAR_INSET } from "@shared/components/navigation/sidebar-inset";
import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { Button } from "@shared/components/ui/button";
import { ScrollArea } from "@shared/components/ui/scroll-area";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { JUMP_HIGHLIGHT_MS } from "@shared/lib/jump-highlight";
import { cn } from "@shared/lib/utils";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import {
	forgetBridgeComposerRows,
	teamBridgeComposerKey,
} from "@shared/store/team-bridge-composer-rows";
import { onDraftRevocation } from "@shared/store/team-bridge-draft-account";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import {
	Archive,
	Bot,
	Clock,
	CloudOff,
	Hash,
	MailPlus,
	MessagesSquare,
	Pencil,
	Plus,
	UserPlus,
	Users,
} from "lucide-react";
import type { FC, ReactNode } from "react";
import {
	Fragment,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { TeamBridgeFilesCapability } from "../../../../shared/team-bridge-contract";
import type {
	TeamBridgeAttachmentCapability,
	TeamBridgeConversation,
	TeamBridgeConversationList,
	TeamBridgeDirectoryMember,
	TeamBridgeEvent,
	TeamBridgeMemberInput,
	TeamBridgeMessage,
	TeamBridgeNotify,
} from "../../../../shared/team-bridge-contract";
import { browserDraftStorage } from "../../shared/store/team-bridge-draft-account";
import { rowCurrent } from "../chat/components/chat-sidebar";
import { TeamBridgeTrialEmpty } from "../team-bridge-trial/team-bridge-trial-empty";
import {
	teamBridgeReadOnly,
	trialEndedOrg,
	trialReplacesPanel,
} from "../team-bridge-trial/team-bridge-trial-model";
import {
	TeamBridgeTrialEndedPanel,
	useTeamBridgeTrialNote,
} from "../team-bridge-trial/team-bridge-trial-paused";
import { TeamBridgeMentionProvider } from "./mentions";
import { clearStagedMentions, stagedMentions } from "./mentions/mention-outbox";
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
	isClientRefConflict,
	sendAttachmentIds,
} from "./team-bridge-attachments-model";
import {
	TEAM_BRIDGE_MAX_RETAINED_MESSAGES,
	TEAM_BRIDGE_PAGE_SIZE,
} from "./team-bridge-channel-cache";
import { TeamBridgeComposeBar } from "./team-bridge-compose-bar";
import {
	TeamBridgeComposer,
	type TeamBridgeComposerProps,
} from "./team-bridge-composer";
import {
	TeamBridgeConversationMenu,
	type TeamBridgeConversationMenuHandlers,
	TeamBridgeMenuConfirmDialog,
	type TeamBridgeMenuConfirmError,
	type TeamBridgeMenuConfirmSubject,
} from "./team-bridge-conversation-menu";
import {
	type TeamBridgeConversationMenuItem,
	type TeamBridgeLeaveOutcome,
	type TeamBridgeOwnAgentRequest,
	conversationMenuSections,
	generalRejoinRefused,
	isMemberNotFound,
	landingAfterLeave,
	leaveWithAgentCascade,
	ownAgentRequest,
	withdrawAlreadyDone,
} from "./team-bridge-conversation-menu-model";
import { TeamBridgeCreateDialog } from "./team-bridge-create-dialog";
import { teamBridgeTargetFromSearch } from "./team-bridge-deep-link";
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
import { TeamBridgeMembersPanel } from "./team-bridge-members-panel";
import {
	TeamBridgeMessageList,
	TeamBridgeMessageSkeleton,
} from "./team-bridge-message-list";
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
	builtinTopicKey,
	canArchiveConversation,
	canManageArchivedConversation,
	chiefsOfStaff,
	composeChiefLabel,
	conversationMemberCount,
	conversationMembershipCounts,
	conversationOrganizationName,
	conversationTitle,
	defaultLandingConversation,
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
	ownActiveAgent,
	ownAgentMenuState,
	participantLabel,
	personDisplayLabel,
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
import {
	looseDirectsFor,
	orgGroupHeadingId,
	orgGroupsVisible,
	orgRosters,
	orgRowKey,
} from "./team-bridge-org-rosters";
import { TeamBridgeOrgSwitcher } from "./team-bridge-org-switcher";
import { useBridgeOwner, useTeamBridgeAccount } from "./team-bridge-owner";
import {
	type OwnerAuditSlot,
	useOwnerAuditSurface,
} from "./team-bridge-owner-audit";
import {
	type PendingSend,
	conversationLaneKey,
	enqueueOnLane,
	mergeOptimisticMessages,
	nextPendingOrder,
	pendingForView,
	resolveLane,
	serverRowOf,
	usePendingSends,
} from "./team-bridge-pending-sends";
import {
	TeamBridgeAvatar,
	TeamBridgeProfileCard,
} from "./team-bridge-profile-card";
import {
	ChiefRailRow,
	ConversationRailRow,
	PersonRailRow,
	RailGroupHeader,
	RailLoading,
	RailQuietLine,
	RailSection,
	isTargetRow,
} from "./team-bridge-rail";
import { useHeldRailScroll } from "./team-bridge-rail-scroll";
import { teamBridgeReactionsAvailable } from "./team-bridge-reaction-gate";
import {
	TeamBridgeEarlyColumn,
	TeamBridgeRouteColumn,
} from "./team-bridge-route-column";
import {
	TeamBridgeScheduleDialog,
	TeamBridgeScheduledList,
} from "./team-bridge-scheduled";
import {
	canResetScheduleAttempt,
	scheduleTeamBridgeDraft,
	scheduledTargetAfterSuccess,
} from "./team-bridge-scheduling";
import {
	readScopePreference,
	resolveOpeningScope,
	snapshotForScope,
	writeScopePreference,
} from "./team-bridge-scope-preference";
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
import {
	useTeamBridgeUnreadView,
	withSharedUnread,
} from "./team-bridge-unread-sync";
import {
	type TeamBridgeQuickView,
	type TeamBridgeScrollAnchor,
	type TeamBridgeViewMemory,
	readLastScope,
	readViewMemory,
	rememberedScroll,
	rememberedThread,
	writeLastScope,
	writeViewMemory,
} from "./team-bridge-view-memory";
import { useReportTeamBridgeViewing } from "./team-bridge-viewing";
import { useStickToBottom } from "./use-stick-to-bottom";
import {
	refreshAfterSend,
	teamBridgeKeys,
	teamBridgeMessagesQueryOptions,
	useAddTeamBridgeMembers,
	useAnswerTeamBridgeInvitation,
	useArchiveTeamBridgeConversation,
	useArchivedTeamBridgeConversations,
	useCreateTeamBridgeConversation,
	useDeleteTeamBridgeConversation,
	useJoinTeamBridgeConversation,
	useLeaveTeamBridgeConversation,
	useLoadMoreArchivedTeamBridgeConversations,
	useMarkTeamBridgeRead,
	useRemoveTeamBridgeMember,
	useSendTeamBridgeMessage,
	useSetTeamBridgeAgentNotify,
	useSetTeamBridgeNotify,
	useTeamBridgeConversations,
	useTeamBridgeDirectories,
	useTeamBridgeDirectory,
	useTeamBridgeMessages,
	useTeamBridgeStatus,
	useTeamBridgeUnread,
	useUnarchiveTeamBridgeConversation,
	useWithdrawTeamBridgeAgent,
} from "./use-team-bridge";
import { useTeamBridgeDrafts } from "./use-team-bridge-drafts";
import { type FileSend, filesCapability } from "./use-team-bridge-files";

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

/*
 * THE FAILED-SEND RECORD LIVES AT MODULE SCOPE (round 4 retrospective, R4-02).
 *
 * A send whose answer never arrived may still have landed, so pressing Send on the
 * same text must reuse its `client_ref` or the hub posts it twice. That record used
 * to sit in a `useRef` (and the container's `drafts` map), both of which die when
 * `/team-bridge` unmounts - so leaving Team Bridge and coming back turned the retry
 * into a new key and a visible duplicate. A module map survives the route change and
 * still dies with the renderer: a restart is the one remaining case, accepted on
 * purpose because the only key a restart could recover is the persisted draft key,
 * and that one may already be spent (see `submit`).
 *
 * Keyed by `teamBridgeComposerKey` - account, authored scope and target - the same
 * name the composer's text lives under, so a record is only ever read by the draft
 * that wrote it. It is account-owned in-memory state, so it registers with the same
 * fence that erases the draft journal and the composer rows: sign-out and account
 * switch drop every record.
 */
type SendAttempt = {
	body: string;
	clientRef: string;
	/**
	 * The optimistic row this attempt drew, when it drew one. A picture send keeps
	 * the awaited path and has no row; a text send does, and the row - not the body
	 * comparison - is what decides whether a press is a retry (B1).
	 */
	localId?: string;
};
const sendAttempts = new Map<string, SendAttempt>();
onDraftRevocation(() => sendAttempts.clear());

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
 * #general, #humans and #agents first), Groups, People and Chiefs of staff, each with a
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

/**
 * Where a background (optimistic) send goes, decided when it RUNS rather than when
 * the view rendered: a message queued behind a first send posts into the
 * conversation that send created (`into`), and the container reports a create the
 * moment it lands (`onCreated`) so the view and the rail move before the post.
 */
export type TeamBridgeDelivery = {
	into?: { conversationId: string; tenantId: string | undefined };
	onCreated?: (conversationId: string, tenantId: string | undefined) => void;
	/**
	 * The `mentions[]` captured onto the optimistic row at the press
	 * (`PendingSend.mentions`). Carried here rather than read from the outbox at
	 * delivery because this send runs later than the press, possibly as a Retry
	 * long after the outbox entry was evicted or cleared.
	 */
	mentions?: PendingSend["mentions"];
};

type OwnedDraft = {
	body: string;
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
	/**
	 * Older-history paging, for the timeline's windowed strip. The strip asks when
	 * the reader nears the top; the page owns neither the trigger nor the read.
	 */
	olderPaging?: {
		hasOlder: boolean;
		loadingOlder: boolean;
		onLoadOlder: () => void;
	};
	/** Membership events for the timeline only; see `TeamBridgeMessageList`. */
	events?: readonly TeamBridgeEvent[];
	/**
	 * The message a notification click named, once `messages` holds it. The
	 * timeline scrolls it to the centre and the row wears a brief highlight.
	 */
	highlightMessageId?: string | null;
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
	/** The reader's own agent's wake-level write was refused (this conversation). */
	agentNotifyFailed?: boolean;
	onJoin?: () => void;
	onNotifyChange?: (notify: TeamBridgeNotify) => void;
	/** Sets the reader's own agent's wake level; absent, the control is not drawn. */
	onAgentNotifyChange?: (notify: TeamBridgeNotify) => void;
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
	 * The members panel's self-scoped writes: leave (own human row), withdraw
	 * or decline (own agent row). Removing ANOTHER person still goes through
	 * `onRemoveMember`. Absent, those rows draw no control.
	 */
	onMemberSelfAction?: (
		conversation: TeamBridgeConversation,
		action: "leave" | "withdraw" | "decline",
		endpointId?: string,
	) => Promise<unknown>;
	/** Story/test seed only: opens the members panel on mount. */
	initialMembersPanelOpen?: boolean;
	/**
	 * THE CONVERSATION MENU'S WRITES (header "…", rail row "…", right-click).
	 * Each names the conversation it acts on: a row's menu acts on THAT row,
	 * which is not necessarily the selection. Absent, the item is not drawn.
	 *
	 * `onMenuLeave` resolves with the cascade's outcome (see
	 * `leaveWithAgentCascade`): "partial" means the reader left but the
	 * follow-up withdraw of their agent failed, and the page says so.
	 */
	onMenuJoin?: (conversation: TeamBridgeConversation) => void;
	onMenuLeave?: (
		conversation: TeamBridgeConversation,
	) => Promise<TeamBridgeLeaveOutcome>;
	/**
	 * THE TRUE STATE AFTER A PARTIAL LEAVE: the reader left, their agent did
	 * not. Owned by the CONTAINER, not this view: leaving the selected room
	 * moves the selection, which remounts this view and would drop any state
	 * held here. Drawn as an alert line with Retry (the withdraw only) and
	 * Dismiss until the reader acts on it.
	 */
	partialLeave?: { name: string; retrying: boolean; retryFailed: boolean };
	onRetryPartialLeave?: () => void;
	onDismissPartialLeave?: () => void;
	/**
	 * Open the members panel (or the add-members dialog) for a row that is NOT
	 * the selection. Selecting remounts this view, so the open intent has to
	 * outlive it: the container holds it and hands it back as
	 * `initialMembersPanelOpen` / `initialMembersOpen` on the new mount.
	 */
	onOpenMembersFor?: (
		conversation: TeamBridgeConversation,
		surface: "panel" | "add",
	) => void;
	onMenuOwnAgent?: (
		conversation: TeamBridgeConversation,
		request: TeamBridgeOwnAgentRequest,
	) => Promise<unknown>;
	onMenuNotifyChange?: (
		conversation: TeamBridgeConversation,
		notify: TeamBridgeNotify,
	) => void;
	/** Story/test seed only: open the menu confirm for this conversation. */
	initialMenuConfirm?: {
		conversationId: string;
		subject: TeamBridgeMenuConfirmSubject;
	};

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
	/**
	 * Opens the view in a quick view: a story/test seed, and the container's
	 * restore of the quick view the reader left open (`team-bridge-view-memory`).
	 */
	initialQuickView?: TeamBridgeQuickView | null;
	/**
	 * The reading position to restore once the timeline has its rows; `null`
	 * opens at the newest message as before. Applied once per mount.
	 */
	initialScroll?: TeamBridgeScrollAnchor | null;
	/**
	 * Reports the view-local parts of "where the reader is" (thread pane, quick
	 * view, reading position) so the container can persist them: this view
	 * unmounts when the reader leaves the page, and that unmount is exactly what
	 * used to lose them.
	 */
	onViewMemory?: (
		view: Partial<TeamBridgeViewMemory> & { target: TeamBridgeTarget },
	) => void;
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
	/**
	 * The `team_bridge_send_mentions` capability answer. Only `enabled` puts
	 * `mentions[]` on a send; any other answer keeps the readable `@Name` text
	 * and sends no field an older backend would refuse.
	 */
	sendMentionsCapabilityState?: DesktopFeatureState;
	/**
	 * The `team_bridge_agent_notify` capability answer, computed by the
	 * container. Anything but `enabled` hides the "Wake your agent for" group:
	 * a runtime without the route would refuse every pick, and an error that
	 * invites a retry nothing can satisfy is worse than no control (R1-3).
	 */
	agentNotifyCapabilityState?: DesktopFeatureState;
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
	/**
	 * Each organization's directory error, so a failed roster in the union view
	 * names its own cause (signed out, plan, transport) under its own header
	 * instead of a generic line.
	 */
	directoryErrors?: Readonly<Record<string, unknown>>;
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
	/** Replaces the plan-required panel for an account in no Team organization
	 * (the Team trial empty state, `features/team-bridge-trial`). */
	noOrgPanel?: ReactNode;
	/**
	 * The `notice` slot already explains why the page is read-only (the ended
	 * Team trial band), so the composer's generic read-only line is dropped
	 * rather than said twice (design review D7).
	 */
	readOnlyExplained?: boolean;
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
			files?: readonly string[];
			/* Stage held images into a just-created conversation; throws on failure. */
			stageHeld?: (
				conversationId: string,
				tenantId: string | undefined,
			) => Promise<string[]>;
		},
		delivery?: TeamBridgeDelivery,
	) => Promise<unknown> | undefined;
	/*
	 * The hub's image capability (`status.attachments`), or null/absent when it
	 * has none: every attach affordance is then hidden and a pasted image gets
	 * the "not supported" note instead of a chip.
	 */
	attachmentCapability?: TeamBridgeAttachmentCapability | null;
	filesCapability?: TeamBridgeFilesCapability | null;
	/*
	 * The speech capability for the composer's microphone, read by the OWNED
	 * page (`useRadientCredentialProbe`). It is threaded rather than read in the
	 * composer for the reason the shared chat composer states on its own `recordingProbe`:
	 * the probe is a react-query read, and this view is mounted without a
	 * QueryClient by the desktop suites and the stories. Absent, the composer
	 * fails closed (mic disabled, the neutral "could not be checked" reason).
	 */
	recordingProbe?: TeamBridgeComposerProps["recordingProbe"];
	/** Open the channel form (Channels' "+" and its empty line). */
	onSchedule?: (
		body: string,
		clientRef: string,
		sendAt: string,
		conversationId: string | undefined,
		onCreated: (id: string) => void,
		attachments?: {
			ids: readonly string[];
			files?: readonly string[];
			stageHeld?: (
				conversationId: string,
				tenantId: string,
			) => Promise<string[]>;
		},
	) => Promise<unknown>;
	onNewChannel: () => void;
	onRetry?: () => void;
	onScopeChange: (scope: TeamBridgeScope) => void;
	/**
	 * The reader's EXPLICIT switcher pick, kept distinct from `onScopeChange`
	 * because this is the one choice that is persisted and the one that counts as
	 * "the reader chose" (`team-bridge-scope-preference`). A scope adopted at
	 * opening, and the implicit switch a union row makes to reach its own
	 * organization, are consequences and must not rewrite the stored default.
	 */
	onChooseOrganization?: (scope: TeamBridgeScope) => void;
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
	olderPaging,
	events,
	highlightMessageId = null,
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
	agentNotifyFailed = false,
	onJoin,
	onNotifyChange,
	onAgentNotifyChange,
	onAddMembers,
	onRemoveMember,
	memberMutationKey = null,
	initialMembersOpen = false,
	onMemberSelfAction,
	initialMembersPanelOpen = false,
	onMenuJoin,
	onMenuLeave,
	onMenuOwnAgent,
	onMenuNotifyChange,
	initialMenuConfirm,
	partialLeave,
	onRetryPartialLeave,
	onDismissPartialLeave,
	onOpenMembersFor,
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
	initialScroll = null,
	onViewMemory,
	initialDialog,
	threadsCapabilityState = "unknown",
	reactionsCapabilityState = "unknown",
	sendMentionsCapabilityState = "unknown",
	agentNotifyCapabilityState = "unknown",
	defaultMenuOpen = false,
	initialDraft = "",
	draftJournal,
	isDraftCurrent = () => true,
	people = [],
	directories,
	directoryStates,
	directoryErrors,
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
	noOrgPanel,
	readOnlyExplained = false,
	onTarget,
	onSend,
	onSchedule,
	attachmentCapability: imageCapability = null,
	filesCapability: fileCapability = null,
	recordingProbe,
	onNewChannel,
	onRetry,
	onScopeChange,
	onChooseOrganization,
	onRetryMemberships,
}) => {
	useI18nLocale();
	/* Whether the rail is drawn in the shell's column; see the thread takeover. */
	const railHosted = useLeftSidebarHosted();
	const [quickView, setQuickView] = useState<TeamBridgeQuickView | null>(
		initialQuickView ?? null,
	);
	/* The confirm dialogs name the conversation they were opened for, not "the
	   selected one": the selection can change under an open dialog. */
	const [dialog, setDialog] = useState<{
		kind: "archive" | "delete";
		conversationId: string;
	} | null>(initialDialog ?? null);
	const [membersOpen, setMembersOpen] = useState(initialMembersOpen);
	/* The members panel shares the thread pane's slot; one closes the other. */
	const [membersPanelOpen, setMembersPanelOpen] = useState(
		initialMembersPanelOpen,
	);
	const [memberActionFailed, setMemberActionFailed] = useState(false);
	/* The conversation menu's confirm (leave / remove or add your agent), named
	   by conversation id like `dialog`: a row's menu acts on that row. */
	const [menuConfirm, setMenuConfirm] = useState<{
		conversationId: string;
		subject: TeamBridgeMenuConfirmSubject;
		item?: Extract<
			TeamBridgeConversationMenuItem,
			{ id: "remove_agent" | "add_agent" }
		>;
	} | null>(initialMenuConfirm ?? null);
	const [menuPending, setMenuPending] = useState(false);
	const [menuError, setMenuError] = useState<TeamBridgeMenuConfirmError | null>(
		null,
	);

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
	const [stagedFileCount, setStagedFileCount] = useState(0);
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
	/*
	 * A LANE IS ONE DRAFT, NOT ONE KIND OF DRAFT (review round 1, B2).
	 *
	 * `draftTargetKey` answers `"compose"` for EVERY compose draft, so a lane keyed
	 * by it remembered the first group it created and posted a later group's message
	 * into it - the message went to people the author never addressed. The lane is
	 * therefore the composer key (account, scope and target) PLUS the addressees, in
	 * a stable order: the account keeps two accounts' drafts apart, and the recipient
	 * list keeps two compose drafts apart.
	 */
	const laneIdentity = `${composerKey}|${
		target?.type === "compose"
			? target.recipients.map(recipientKey).sort().join(",")
			: ""
	}`;
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
	/* Both the build/capability gate and a resolved account are required before
	   any thread state exists. Reads and replies need that captured owner, so a
	   deep link or reply handler cannot mount an unidentified thread surface. */
	const threadsAvailable =
		teamBridgeThreadsAvailable(threadsCapabilityState) &&
		selfAccountId !== undefined;
	/* The reactions lane is gated by the build and the capability here; the
	 * captured account is required one step later, where `reactionContext` is
	 * built (`reactionsAvailable && selfAccountId`). Both terms have to hold: a
	 * capability-only gate would mount chips under an unresolved account. */
	const reactionsAvailable = teamBridgeReactionsAvailable(
		reactionsCapabilityState,
	);
	// Thread identity is checked against the current selection before mounting.
	const [threadSelection, setThreadSelection] = useState<ThreadTarget | null>(
		threadsAvailable ? (threadLink ?? null) : null,
	);
	useEffect(() => {
		if (threadsAvailable && threadLink) {
			setMembersPanelOpen(false);
			setThreadSelection(threadLink);
		}
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
	/* The switcher's org order: the built-ins' secondary sort key in the merged
	   view (design round 1, D1), shared by the rail and the after-removal landing. */
	const organizationOrder = useMemo(
		() => organizations.map((row) => row.tenantId as string),
		[organizations],
	);
	const sections = useMemo(
		() => railSections(sidebarRows, organizationOrder),
		[sidebarRows, organizationOrder],
	);
	/* Everything a selection may resolve against: the live list plus the archived view's rows. */
	const selectable = useMemo(
		() => selectableConversations(listRows, archivedConversations),
		[listRows, archivedConversations],
	);
	const chiefs = useMemo(
		() => (mergedView ? [] : chiefsOfStaff(people, selfAccountId)),
		[mergedView, people, selfAccountId],
	);
	/*
	 * THE UNION VIEW'S ROSTERS (operator ask: every single-org capability works in
	 * "All organizations"). One slice per organization, in the switcher's order,
	 * built from the per-organization reads `useTeamBridgeDirectories` already
	 * runs - no read is added here, and the shell's cached answers paint at once.
	 *
	 * The single-org view does not use this: `people` is its one roster, and the
	 * shipped sections below stay exactly as they were.
	 */
	const orgGroups = useMemo(
		() =>
			mergedView
				? orgRosters({
						organizations,
						directories,
						directoryStates,
						directs: sections.directs,
						selfAccountId,
					})
				: [],
		[
			mergedView,
			organizations,
			directories,
			directoryStates,
			sections,
			selfAccountId,
		],
	);
	/* One predicate for subheaders, shared with the audit rail (see
	 * `orgGroupsVisible`): several organizations to disambiguate, or the shipped
	 * flat list. */
	const groupedUnion = orgGroupsVisible(mergedView, organizations.length);
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
	// owns is listed on its own. The union view folds them the same way, one
	// organization at a time, so a person who is in two organizations cannot
	// produce two rows for one DM (the single-org invariant, kept here).
	const looseDirects = mergedView
		? looseDirectsFor(orgGroups)
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
	/*
	 * THE READ WATERMARK AS IT WAS ON ENTRY, for the "N new messages" divider
	 * (visual refresh D10). Opening a conversation marks it read, which moves the
	 * live `last_read_seq` past everything on screen within a poll - so the
	 * divider reads a copy taken the first render this conversation is shown,
	 * and drops it when the reader leaves (a new id takes a new copy). A
	 * conversation with nothing unread on entry gets no divider at all.
	 */
	const [entryWatermark, setEntryWatermark] = useState<{
		id: string;
		seq: number | undefined;
	} | null>(null);
	if (shown && entryWatermark?.id !== shown.id)
		setEntryWatermark({
			id: shown.id,
			seq: shown.unread_count > 0 ? shown.last_read_seq : undefined,
		});
	/* Leaving for an empty pane is a leave too: coming back to the same
	   conversation takes a fresh copy (agent review round 1, m5). */
	if (!shown && entryWatermark !== null) setEntryWatermark(null);
	const unreadAfterSeq =
		shown && entryWatermark?.id === shown.id ? entryWatermark.seq : undefined;
	const shownTopicKey = builtinTopicKey(shown?.builtin);
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
		setMembersPanelOpen(false);
		ownerAudit?.clear();
		setQuickView(next);
	};
	/*
	 * THE PANEL BELONGS TO THE ROOM IT WAS OPENED FOR (review round 1, R1). The
	 * panel is keyed by conversation, so a selection change while it is open
	 * would remount it, and its mount moves focus to Close - every rail click
	 * would pull the reader's focus into the drawer. Focus may move only on an
	 * explicit open from the count, so a new room closes the panel instead.
	 * Adjusted DURING RENDER, not in an effect: a child's effects run before
	 * the parent's, so an effect here would let the remounted panel take focus
	 * first. Keyed on the room, not the object, so a refetch of the same room
	 * leaves it open.
	 */
	const shownRoomKey = shown ? `${shown.tenant_id}:${shown.id}` : null;
	const [membersPanelRoom, setMembersPanelRoom] = useState(shownRoomKey);
	if (membersPanelRoom !== shownRoomKey) {
		setMembersPanelRoom(shownRoomKey);
		if (membersPanelOpen) setMembersPanelOpen(false);
	}
	/* The panel needs a listed room: not a preview, not an unknown org. */
	const membersPanelShown =
		membersPanelOpen &&
		shown !== null &&
		!previewSelected &&
		!selectedOrganizationUnknown;
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
		setMembersPanelOpen(false);
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
	const stagedForSend = (paths: readonly string[], files?: FileSend) => {
		const staged: {
			ids: readonly string[];
			files?: readonly string[];
			stageHeld: (
				conversationId: string,
				tenant: string | undefined,
			) => Promise<string[]>;
		} = {
			ids: [],
			stageHeld: async (conversationId, tenant) => {
				const uploaded = await uploadStagedImages({
					paths,
					accountId: selfAccountId ?? "",
					tenantId:
						tenant ??
						(draftTenant === TEAM_BRIDGE_ALL_SCOPE ? "" : draftTenant),
					conversationId,
					capability: imageCapability,
				});
				if (uploaded.failures.length > 0)
					setSendRefusal({ kind: "upload", failure: uploaded.failures[0] });
				if (uploaded.ids.length !== paths.length)
					throw new Error("attachment staging refused");
				// File receipts own a synchronous scope/generation fence. Await
				// both stores BEFORE the bind; never fall back to text-only.
				if (files?.count)
					staged.files = await files.stageInto(conversationId, tenant);
				if (uploaded.ids.length + (staged.files?.length ?? 0) > 10)
					throw new Error("Too many attachments");
				return uploaded.ids;
			},
		};
		return staged;
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
	/*
	 * THE ROWS THIS VIEW DRAWS, AND THE ONES THIS CLIENT IS STILL CARRYING.
	 *
	 * The thread page stays the server's; the optimistic sends
	 * (`team-bridge-pending-sends.ts`) are merged over it at render time, for the
	 * account and the lane the reader is looking at - the person or chief target a
	 * FIRST message is typed into, before any conversation exists for it. A poll, a
	 * focus refetch or a paged read therefore cannot drop a row this client is
	 * carrying: the cache never held it.
	 */
	const pendingEntries = usePendingSends((state) => state.entries);
	/* One lane name per draft: the same string the send writes and a row is matched by
	   (`laneIdentity`), never the coarser target kind. */
	const viewLane = laneIdentity;
	const targetedConversationId =
		target?.type === "conversation" ? target.id : undefined;
	const viewSends = useMemo(
		() =>
			pendingForView(pendingEntries, {
				owner: selfAccountId,
				lane: viewLane,
				/*
				 * THE CONVERSATION THIS PANE ADDRESSES, not only the one the list has
				 * resolved. A group's create moves the target onto the new conversation
				 * one round trip before the list carries it (`shown` is still null), and
				 * matching on `shown` alone dropped the author's own row from the pane
				 * they had just been moved into.
				 */
				conversationId: shown?.id ?? targetedConversationId,
			}),
		[
			pendingEntries,
			selfAccountId,
			viewLane,
			shown?.id,
			targetedConversationId,
		],
	);
	/* The author, as a message row names a sender: the roster resolves the label,
	   so the optimistic row and its server replacement read identically. */
	/*
	 * THE AUTHOR'S OWN NAME, TAKEN FROM THE BEST SOURCE THAT HAS ONE.
	 *
	 * A server row names its sender in `display_label`: the hub stamps it when the
	 * message is stored. An optimistic row has no hub to ask, so it carries what this
	 * client knows - the organization's roster for the signed-in account first (the
	 * same row `labelFor` resolves a peer through, so the author reads the same in
	 * their own message as in the rail), then the name the shell holds. The account id
	 * is the last resort, because a row tagged with somebody's id still reads as a
	 * person; "" would read as "Unknown person" (operator report, 2026-10-30, caught
	 * on the first frame of a first message).
	 */
	const selfSender = useMemo<TeamBridgeMessage["sender"] | null>(() => {
		if (!selfAccountId) return null;
		const mine = people.find((row) => row.account_id === selfAccountId);
		const label = mine
			? personDisplayLabel(mine)
			: (selfName?.trim() ?? "") || selfAccountId;
		return { account_id: selfAccountId, kind: "human", display_label: label };
	}, [selfAccountId, selfName, people]);
	const merged = useMemo(
		() => mergeOptimisticMessages(messages, viewSends, selfSender, shown?.id),
		[messages, viewSends, selfSender, shown?.id],
	);
	/*
	 * A CONVERSATION THIS CLIENT JUST CREATED IS NOT "NOT OPEN TO YOU" (review round
	 * 1, M2). The view moves onto the new group the moment its create answers, one
	 * line before the list refetch that will contain it - so for one round trip the
	 * target named a conversation the list did not have, and the thread said the
	 * reader may not be a member of a room they had just made. The ids are kept for
	 * the session: once the list carries the row the branch is moot anyway, and a
	 * conversation that never arrives still draws the reader's own rows.
	 */
	const createdHere = useRef(new Set<string>());
	const unlistedCreation =
		target?.type === "conversation" &&
		createdHere.current.has(target.id) &&
		shown === null;
	/** The highest seq the thread page holds: a fallback match must sit above it. */
	const timelineTop = useMemo(
		() => messages.reduce((max, row) => Math.max(max, row.seq), -1),
		[messages],
	);
	const timelineResetKey = `${shown?.tenant_id ?? ""}:${shown?.id ?? ""}:${messageState}:${quickView ?? ""}`;
	const timeline = useStickToBottom({
		resetKey: timelineResetKey,
		/* The DRAWN rows, not the server page: the author's own message is on screen
	   before the page carries it, and pinning must count it as content or the row
	   lands just below the fold of a view the press had already pinned. */
		contentKey: `${merged.messages.length}:${merged.messages.at(-1)?.id ?? ""}`,
	});
	/*
	 * A NOTIFICATION CLICK LANDS ON ITS MESSAGE. Declared AFTER the
	 * stick-to-bottom hook on purpose: layout effects run in declaration order
	 * within a component (and a child's before its parent's), so this is the
	 * last scroll before paint and the pin cannot pull the reader back to the
	 * bottom. `hold()` then unpins, so a resize re-pin or the next arrival does
	 * not yank them off the message either - the same rule as a reader who
	 * scrolled up by hand.
	 */
	useLayoutEffect(() => {
		if (!highlightMessageId) return;
		// Compared, not interpolated into a selector: the id came from a URL.
		const row = Array.from(
			timeline.rootRef.current?.querySelectorAll<HTMLElement>(
				"[data-message-id]",
			) ?? [],
		).find((element) => element.dataset.messageId === highlightMessageId);
		if (!row) return;
		timeline.hold();
		row.scrollIntoView?.({ block: "center" });
	}, [highlightMessageId, timeline.hold, timeline.rootRef]);
	/*
	 * THE READING POSITION THE READER LEFT AT (`team-bridge-view-memory`).
	 *
	 * Declared after both scrolls above for the same reason the highlight is: the
	 * stick-to-bottom reset has already put the timeline at the newest message, so
	 * this is the last scroll before paint. It runs ONCE per mount, when the
	 * remembered row is on screen, then `hold()`s like a reader who scrolled up by
	 * hand so the next arrival or resize does not yank them down. A remembered row
	 * the loaded page no longer holds leaves the timeline at the newest message,
	 * which is the default. A notification's highlight outranks it.
	 */
	const scrollRestored = useRef(false);
	// Captured at mount: the container stops passing it once the restore resolves,
	// which can be before this conversation's history has answered.
	const restoreScroll = useRef(initialScroll);
	useLayoutEffect(() => {
		const initialScroll = restoreScroll.current;
		if (scrollRestored.current || !initialScroll || highlightMessageId) return;
		if (messageState !== "ready" || merged.messages.length === 0) return;
		scrollRestored.current = true;
		const viewport = timeline.rootRef.current?.querySelector<HTMLElement>(
			"[data-radix-scroll-area-viewport]",
		);
		const row = Array.from(
			viewport?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [],
		).find((element) => element.dataset.messageId === initialScroll.messageId);
		if (!viewport || !row) return;
		timeline.hold();
		viewport.scrollTop +=
			row.getBoundingClientRect().top -
			viewport.getBoundingClientRect().top -
			initialScroll.offset;
	}, [
		highlightMessageId,
		messageState,
		merged.messages.length,
		timeline.hold,
		timeline.rootRef,
	]);
	/*
	 * REPORT WHERE THE READER IS, so the container can persist it. The view owns
	 * the thread pane, the quick view and the scroll offset, and it unmounts when
	 * the reader leaves the page - that unmount is what used to lose all three.
	 *
	 * The reading position is the first visible message and its offset (not a raw
	 * `scrollTop`, which a prepended page would invalidate), or `null` within the
	 * stick-to-bottom threshold so a reader at the newest message returns to the
	 * newest message. Scroll reports are coalesced (one write per idle burst) and
	 * flushed on unmount, because leaving the page is exactly the moment the last
	 * position matters. The seed is the restored position, so the mount report
	 * cannot overwrite a position this mount has not applied yet.
	 */
	const scrollAnchor = useRef<TeamBridgeScrollAnchor | null>(
		restoreScroll.current,
	);
	const reportView = useRef<() => void>(() => {});
	reportView.current = () => {
		if (!onViewMemory || target === null) return;
		onViewMemory({
			target,
			/* The selection, not `threadIsOpen`: before the account resolves the
			   pane cannot open yet, and reporting "closed" then would erase a
			   restored thread the reader never closed. */
			thread: threadSelection ?? threadLink ?? null,
			quickView,
			scroll: scrollAnchor.current
				? { ...scrollAnchor.current, targetKey: draftTargetKey(target) }
				: null,
		});
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers; the report reads them through `reportView`.
	useEffect(() => {
		reportView.current();
	}, [target, threadSelection, threadLink, quickView]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the reset key re-binds the listener - a new conversation can mount a new viewport.
	useEffect(() => {
		const viewport = timeline.rootRef.current?.querySelector<HTMLElement>(
			"[data-radix-scroll-area-viewport]",
		);
		if (!viewport) return;
		/* Measured on every scroll event (the browser already coalesces those to
		   one per frame, and this reads a handful of rects), WRITTEN on a short
		   idle and flushed on cleanup - by then the viewport is detached, so the
		   cleanup cannot measure. The view is keyed by its target, so one mount
		   only ever measures one conversation. */
		let pending: ReturnType<typeof setTimeout> | undefined;
		const flush = () => {
			pending = undefined;
			reportView.current();
		};
		const onScroll = () => {
			const box = viewport.getBoundingClientRect();
			const atNewest =
				viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
				48;
			const row = atNewest
				? undefined
				: Array.from(
						viewport.querySelectorAll<HTMLElement>("[data-message-id]"),
					).find((element) => element.getBoundingClientRect().bottom > box.top);
			scrollAnchor.current = row?.dataset.messageId
				? {
						messageId: row.dataset.messageId,
						offset: row.getBoundingClientRect().top - box.top,
					}
				: null;
			if (pending !== undefined) clearTimeout(pending);
			pending = setTimeout(flush, 250);
		};
		viewport.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			viewport.removeEventListener("scroll", onScroll);
			if (pending !== undefined) {
				clearTimeout(pending);
				flush();
			}
		};
	}, [timelineResetKey, timeline.rootRef]);
	/*
	 * ONE AUTO-RETRY PER ATTEMPT, never one per reader gesture. A manual retry of an
	 * attempt that already spent its automatic retry keeps the key that retry minted (so
	 * the pair stays idempotent end to end) and surfaces the failure, instead of minting a
	 * third key behind the reader's back - otherwise every press silently burns two keys.
	 * Reset when the message changes, because that is a different message.
	 */
	const autoRetried = useRef(false);
	/*
	 * SEND IN THE BACKGROUND, WITH THE ROW ALREADY ON SCREEN.
	 *
	 * One job per message, queued per lane (`enqueueOnLane`) so the hub numbers them
	 * in press order however the network answers, and so a second message sent while
	 * the first is still CREATING its conversation lands in that conversation rather
	 * than creating another. Every transition writes back to the row: `pending` ->
	 * `sent` with the stored message the hub answered with, or `failed`, which is the
	 * row's own retry surface.
	 */
	/*
	 * THE ATTEMPT IS OVER, WHICHEVER WAY IT ENDED.
	 *
	 * RETIRED BY IDENTITY, NEVER BY CURRENTNESS (PR #1532 review round 1, and the same
	 * rule #1528 settled for the foreground path). The attempt record lives in a module
	 * map that outlives this page; gating the delete on `isDraftCurrent()` would leave
	 * a LANDED key behind for the next identical message to replay, and would let this
	 * job delete a NEWER attempt that a later press put on the same draft. The key
	 * check is what makes the delete this job's own.
	 *
	 * Only the draft's own key rotation needs the live page: it is an edit to a form
	 * the reader may no longer be looking at.
	 */
	const settleAttempt = (
		row: PendingSend,
		clientKey: string,
		rekeyed: boolean,
	) => {
		const current = sendAttempts.get(composerKey);
		const mine =
			current !== undefined &&
			(current.clientRef === clientKey || current.clientRef === row.clientRef);
		if (!mine) return;
		/*
		 * A LANDED ATTEMPT RETIRES ITS KEY; A FAILED ONE KEEPS IT (review round 2, m1).
		 * On the failure side the record's whole purpose is that the next attempt is the
		 * SAME message: the row's Retry uses the row's own key, and Edit-then-Send comes
		 * back through `submit`, where keeping the record is what makes those words a
		 * retry rather than a new message. Retiring it there mints a second key and posts
		 * a duplicate of anything the first request actually landed.
		 */
		if (rekeyed) sendAttempts.delete(composerKey);
		if (
			rekeyed &&
			isDraftCurrent() &&
			draftState.current?.clientRef === clientKey
		)
			draftState.update({ clientRef: crypto.randomUUID() });
	};
	const deliverOptimistic = (row: PendingSend) => {
		/*
		 * ONE LANE KEY, COMPUTED ONCE (review round 1, m3). Two copies of this
		 * expression is how a re-key diverges between the enqueue and the job.
		 */
		const laneKey = row.conversationId
			? conversationLaneKey(row.conversationId)
			: row.lane;
		return enqueueOnLane(laneKey, async (lane) => {
			const into = row.conversationId
				? { conversationId: row.conversationId, tenantId: row.tenantId }
				: lane.resolved;
			const patch = (change: Partial<PendingSend>) =>
				usePendingSends.getState().patch(row.localId, change);
			const send = (clientRef: string) =>
				onSend(row.body, clientRef, undefined, {
					into,
					/* The row's own captured mentions, on the first attempt, the 409
					   re-key and a Retry alike: one message, one recipient list. */
					mentions: row.mentions,
					/*
					 * THE VIEW MOVES ONTO THE CONVERSATION AS SOON AS IT EXISTS. The row
					 * was drawn in the lane the reader is looking at; the create answering
					 * is what makes the same row reachable from the conversation's own
					 * view and puts its rail row up, without waiting for the post.
					 */
					onCreated: (conversationId, tenantId) => {
						resolveLane(laneKey, conversationLaneKey(conversationId), {
							conversationId,
							tenantId,
						});
						/* The list cannot know this id yet; the thread must not claim the
							   reader may not be a member of their own new conversation (M2). */
						createdHere.current.add(conversationId);
						patch({ conversationId, tenantId });
					},
				});
			let clientRef = row.clientRef;
			let result: unknown;
			try {
				try {
					result = await send(clientRef);
				} catch (error) {
					/*
					 * A BURNT KEY IS RETRIED ONCE (PR #1512's rule, carried into the
					 * background send). The row FOLLOWS the new key: leaving it on the
					 * spent one would leave an orphan beside the retried message.
					 */
					if (!isClientRefConflict(error) || row.autoRetried) throw error;
					clientRef = crypto.randomUUID();
					patch({ clientRef, autoRetried: true });
					/*
					 * THE ATTEMPT RECORD MOVES WITH THE ROW (review round 3, m2). The row now
					 * names the fresh key while the record still named the burnt one, so a
					 * later Edit-then-Send re-derived the spent key from the record: the hub
					 * refused it again, a THIRD key was minted, and the message the retry had
					 * already landed came back as a duplicate. Only the record that is this
					 * attempt's own is re-keyed - a newer press on the same draft keeps its own.
					 */
					const own = sendAttempts.get(composerKey);
					if (own && own.clientRef === row.clientRef)
						sendAttempts.set(composerKey, { ...own, clientRef });
					result = await send(clientRef);
				}
				/*
				 * THE HUB ANSWERS WITH THE STORED MESSAGE, and that is what the row
				 * becomes: same list item, same place, now the server's. `client_ref` is
				 * not on message rows (the hub stores it but never serialises it), so the
				 * response id is the binding, with the page's own copy as the fallback.
				 */
				const serverRow = serverRowOf(result);
				patch({
					status: "sent",
					serverId: serverRow?.id,
					serverRow,
					/* Only when the answer names it: `onCreated` already moved the row onto
						   the conversation its draft CREATED, and overwriting that with the
						   conversation the READER was looking at would send the row back to
						   the wrong pane (and, for a group, to the wrong conversation). */
					...(serverRow?.conversation_id
						? { conversationId: serverRow.conversation_id }
						: {}),
				});
				settleAttempt(row, clientRef, true);
			} catch (error) {
				/* THE ROW IS THE FAILURE SURFACE (operator ask): it stays where the
					   message was typed, marked failed, with Retry on its own key and Edit
					   to put the text back in the box. */
				patch({ status: "failed" });
				settleAttempt(row, clientRef, false);
				if (isAttachmentNotFound(error)) setSendRefusal({ kind: "expired" });
			}
		});
	};

	/*
	 * THE COMPOSER'S SEND, BOUND HERE.
	 *
	 * The bar, the field, the chips and the typing are `TeamBridgeComposer`'s; what
	 * stays in this page is what a composer cannot know - the destination, the
	 * create-or-reuse decision for a person or a group, the idempotency key and the
	 * hub's attachment binding. `false` is a REFUSAL and it is returned before
	 * anything is retired, so a refused send leaves the text and chips where the
	 * reader can retry them (R6b); `true` lets the box clear itself, which is the
	 * only clear a transcriptless host gets.
	 */
	const submit = async (
		content: string,
		attachments: string[],
		files?: FileSend,
	) => {
		/*
		 * A MESSAGE CAN BE THE PICTURE (UX round 1, U1). The shared composer enables and
		 * admits an attachment-only payload, so refusing `!body` here made an enabled Send
		 * do nothing at all - no request, no error, chips kept. The upload guards below are
		 * unchanged, so an image that cannot be read or bound still refuses.
		 */
		const body = content.trim();
		if (
			(!body && attachments.length === 0 && !files?.count) ||
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
		/*
		 * THE IDEMPOTENCY KEY BELONGS TO A MESSAGE, NOT TO A DRAFT.
		 *
		 * It used to be read straight off `draftState.current.clientRef`, and the draft is
		 * persisted per account and per target and is NOT discarded by a successful send
		 * (the text lives in `conversation-input-store`, so the draft's own body stays empty
		 * and nothing rotates the key). The result was that the SECOND message into a
		 * conversation carried the first message's key, and the hub - correctly - refused it
		 * with 409 `client_ref` conflict: "already used for a different conversation message".
		 * Every retry of that second message reused the same burnt key, so it could never land.
		 *
		 * The rule now: a RETRY of the attempt that just failed reuses that attempt's key (the
		 * ambiguous-failure protection this ref exists for - request landed, answer lost - must
		 * never post twice), and ANY other send mints a fresh one. `sendAttempts` holds the attempt
		 * record, and the body comparison is what keeps a retry a retry: edit the text and it is
		 * a different message, so it gets a different key.
		 */
		const attempt = sendAttempts.get(composerKey);
		/*
		 * A PRESS IS A RETRY ONLY WHEN ITS ROW SAYS IT FAILED (review round 1, B1).
		 *
		 * The body comparison alone was enough while a send was awaited (`writing`
		 * fenced the second press out). Now the press returns at once, so typing the
		 * same words again - "ok", "yes", "+1", the messages most likely to be sent
		 * twice - found the attempt record still naming the IN-FLIGHT key and reused
		 * it. The hub answers a spent key carrying the same body by replaying the
		 * stored message, so the second press produced a 200 and no new row: the
		 * swallowed send this whole attempt-record machinery exists to prevent.
		 *
		 * So a row this attempt drew has to be `failed` before its key may be reused,
		 * and a picture send (no row, awaited, its text handed back) keeps the body
		 * rule #1528 settled.
		 */
		const attemptRow = attempt?.localId
			? pendingEntries.find((row) => row.localId === attempt.localId)
			: undefined;
		/*
		 * A ROW THAT IS GONE IS ITSELF A RETRY (review round 2, m1). Edit takes a failed
		 * message out of the store and puts its text back in the box; pressing Send
		 * with that text unchanged used to look like a brand-new message and mint a new
		 * key - so a request that had actually landed (answer lost) was posted a second
		 * time and duplicated. An attempt whose row no longer exists cannot be in flight
		 * or confirmed by THIS client, so the words it names are still its own: keep the
		 * key. A row that exists must still be `failed` (round 1, B1).
		 */
		const retriesFailedAttempt = Boolean(
			attempt &&
				attempt.body === body &&
				(!attempt.localId ||
					attemptRow === undefined ||
					attemptRow.status === "failed"),
		);
		/*
		 * ONLY A LIVE FAILED ATTEMPT IS A RETRY. Its key is reused so an ambiguous failure
		 * (request landed, answer lost) cannot post twice; every other send is a new
		 * message and mints a new key.
		 *
		 * The persisted draft key is deliberately NOT trusted. A draft written by a build
		 * before this fix holds a key that was already spent, and the hub answers a spent
		 * key carrying the same text by REPLAYING the stored message: 200, the composer
		 * clears, and no new row exists - the "swallowed" sends seen in production
		 * (three 200s, no rows, no wake for the recipient). Nothing on the client can tell
		 * a spent key from an in-flight one after a restart, so the only safe reading of
		 * a bare draft key is "maybe spent".
		 *
		 * The cost, accepted on purpose: if the app restarts between a send landing and
		 * its answer arriving, and the reader then presses Send on the same text, the hub
		 * sees a new key and posts a visible duplicate. A visible, deletable duplicate in
		 * that rare case beats an invisible swallow in the common one. Leaving Team Bridge
		 * and coming back does NOT pay this cost: the attempt record is module-scoped.
		 * Signing out or switching account does, because the record is erased with the
		 * drafts.
		 */
		const clientRef = retriesFailedAttempt
			? (attempt as SendAttempt).clientRef
			: crypto.randomUUID();
		// A new message starts with a clean slate; a retry of the same attempt keeps
		// whatever the auto-retry below already spent on it.
		if (attempt?.body !== body) autoRetried.current = false;
		if (!draftState.update({ clientRef })) return false;
		/*
		 * THE PRESS PUTS THE MESSAGE ON SCREEN (operator ask, 2026-10-30: "make sure
		 * that it optimistically sends messages and those appear instantly with no
		 * delay and then that's reconciled on the server side once available
		 * seamlessly"). This returns `true` WITHOUT awaiting the wire, so the box
		 * clears in the same commit the row appears - which is the echo this
		 * transcriptless host never had. The row and its request are handled by
		 * `deliverOptimistic`; nothing waits for it.
		 *
		 * A picture keeps the old, awaited path: the upload must bind to a
		 * conversation that may not exist yet, and a failed upload has to hand the
		 * FILES back to the box, which an already-cleared composer cannot do.
		 */
		if (attachments.length === 0 && !files?.count && selfSender && target) {
			const held = pendingEntries.find(
				(row) =>
					row.status === "failed" &&
					row.clientRef === clientRef &&
					row.owner === (selfAccountId ?? ""),
			);
			/*
			 * @-MENTIONS ARE CAPTURED AT THE PRESS. The composer staged this text's
			 * `mentions[]` in the outbox a moment ago (`useComposerMentions().stage`),
			 * but this lane never reaches the selected conversation's mutation, the
			 * only other reader of that outbox - so without this capture a text-only
			 * send went out with NO wire `mentions` and the receivers fell back to
			 * matching names (regressed when the optimistic lane bypassed the mutation).
			 * The row keeps them so a Retry sends the same list. A message with no
			 * conversation yet has no mention source, so nothing is staged for it.
			 */
			const mentions = selected ? stagedMentions(selected.id, body) : undefined;
			/* A press that retries a FAILED row is that row, not a second one: same
			   key, same place, same mentions, back to pending. */
			const row: PendingSend = held
				? { ...held, body, status: "pending" }
				: {
						localId: crypto.randomUUID(),
						clientRef,
						body,
						createdAt: new Date().toISOString(),
						order: nextPendingOrder(),
						owner: selfAccountId ?? "",
						lane: laneIdentity,
						conversationId: selected?.id,
						tenantId:
							selected?.tenant_id ??
							(draftTenant === TEAM_BRIDGE_ALL_SCOPE ? undefined : draftTenant),
						baselineSeq: timelineTop,
						status: "pending",
						mentions,
					};
			if (held)
				usePendingSends.getState().patch(row.localId, { status: "pending" });
			else usePendingSends.getState().add(row);
			/*
			 * THE ATTEMPT NAMES THE ROW IT DREW. `sendAttempts` is the one record of
			 * "this draft has a send out" (#1528); the row id is what makes the next
			 * press able to tell a retry of a FAILED message from a second press on a
			 * message that is still in flight (B1).
			 */
			sendAttempts.set(composerKey, { body, clientRef, localId: row.localId });
			timeline.pin();
			void deliverOptimistic(row);
			return true;
		}
		// ONE attempt, named in both stores: main's optimistic-row journal and
		// this branch's durable row must carry the same `client_ref`, or a retry
		// after a remount could post the message twice.
		const entry = { body, clientRef };
		sendAttempts.set(composerKey, entry);
		// Fenced BEFORE the call: the upload inside it stages into a conversation
		// this request may be creating (R1-02).
		writing.current = true;
		// The author's own send lands in view when it arrives (F9).
		timeline.pin();
		try {
			await onSend(body, clientRef, stagedForSend(attachments, files));
			/*
			 * THE BOX CLEARS ITSELF on an accepted send (`transcriptless`): it compares the
			 * row it sent against the row it holds now, so text typed during the request
			 * survives while the sent text goes. Computing that comparison from THIS
			 * render was the tautology of round 12's B1; all this side retires is its own
			 * attempt record, which names a request that is over.
			 */
			/*
			 * RETIRED BY IDENTITY, NOT BY CURRENCY (PR #1528 review round 1, R1-01). The
			 * record is module-scoped and outlives this page, while `isDraftCurrent()` is
			 * false once the reader has left: fencing the delete on it left a LANDED key
			 * behind, and the next identical message reused it and was replayed into
			 * nothing. Only the draft write below needs the page; the identity check alone
			 * keeps a newer attempt on the same draft from being retired by this one.
			 */
			const ownRecord = sendAttempts.get(composerKey) === entry;
			if (ownRecord) sendAttempts.delete(composerKey);
			if (ownRecord && isDraftCurrent()) {
				// THE SPENT KEY IS RETIRED WITH THE ATTEMPT. This is the actual fix: the
				// draft outlives a successful send, so without this the next message reads
				// the key this one just used and the hub refuses it with 409.
				draftState.update({ clientRef: crypto.randomUUID() });
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
			/*
			 * A BURNT KEY IS RETRIED ONCE WITH A FRESH ONE (hotfix). A `client_ref` conflict
			 * means a DIFFERENT message already used this key - behind a proxy that retried,
			 * a second window, or a stale persisted draft - so the payload on screen is new and
			 * must be sent under a key nobody has used. Asking the reader to press Send again
			 * cannot work: the retry reuses the same key and earns the same 409. Exactly ONE
			 * retry, never a loop: if the fresh key also conflicts, that is a real defect and the
			 * error stands (the text and chips are kept either way).
			 */
			if (isClientRefConflict(error) && !autoRetried.current) {
				autoRetried.current = true;
				const freshRef = crypto.randomUUID();
				const retryEntry = { body, clientRef: freshRef };
				sendAttempts.set(composerKey, retryEntry);
				if (draftState.update({ clientRef: freshRef })) {
					try {
						await onSend(body, freshRef, stagedForSend(attachments, files));
						// Same rule as the first arm: retire by identity, rotate only if current.
						const ownRetry = sendAttempts.get(composerKey) === retryEntry;
						if (ownRetry) sendAttempts.delete(composerKey);
						if (ownRetry && isDraftCurrent())
							draftState.update({ clientRef: crypto.randomUUID() });
						return true;
					} catch (retryError) {
						if (isAttachmentNotFound(retryError))
							setSendRefusal({ kind: "expired" });
						return false;
					}
				}
			}
			if (isAttachmentNotFound(error)) setSendRefusal({ kind: "expired" });
			return false;
		} finally {
			writing.current = false;
		}
	};
	const schedule = async (sendAt: string) => {
		// Core #3363 intentionally supports files on send, not scheduled rows.
		// A schedule must never silently omit this separate in-memory queue.
		if (stagedFileCount > 0) return;
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

	/*
	 * THE RAIL'S SCROLL OUTLIVES THIS VIEW. The view is keyed by its target (see
	 * `viewKeyFor`), so every selection remounts the rail and its viewport used
	 * to restart at scrollTop 0 - measured 640 -> 0 on a click below the fold.
	 * `useHeldRailScroll` carries the offset across that remount, per account
	 * and scope; the why and the reveal rule live in `team-bridge-rail-scroll`.
	 * Above the early returns below: it is a hook. No hold until the account is
	 * known (review R3): a `[null, scope]` key would be one entry shared by
	 * every account, and its flip to the real account could move a rail the
	 * reader is already scrolling.
	 */
	const railScroll = useHeldRailScroll(
		selfAccountId ? JSON.stringify([selfAccountId, scope]) : null,
		target ? draftTargetKey(target) : null,
	);

	/*
	 * THE EARLY STATES STILL OWN THE COLUMN. On this route the shell has already
	 * unmounted the app navigation, so a hold or a gate that drew only its
	 * centre panel would leave an empty `surface` slab on the left and no way out
	 * but ⌘[ - a signed-out or plan-required reader could not see how to leave.
	 * Each therefore portals the back row (and the foot) into the column, with a
	 * quiet title naming where the reader is. Outside the shell the inline copy is
	 * nothing: the page alone renders exactly the panel it always did.
	 */
	const earlyColumn = <TeamBridgeEarlyColumn />;
	if (gatePending)
		return (
			<>
				{earlyColumn}
				<TeamBridgeGateLoading />
			</>
		);
	if (trialReplacesPanel(eligibility) && noOrgPanel)
		return (
			<>
				{earlyColumn}
				{noOrgPanel}
			</>
		);
	if (eligibility)
		return (
			<>
				{earlyColumn}
				<TeamBridgeEligibilityPanel reason={eligibility} />
			</>
		);

	const isSelectedConversation = (conversation: TeamBridgeConversation) =>
		target?.type === "conversation" && target.id === conversation.id;
	const startGroup = (recipient: TeamBridgeRecipient) =>
		selectTarget({ type: "compose", recipients: [recipient] });
	const createDisabled = mergedView || readOnly;
	const createHint = readOnly
		? t("ui.teamBridge.read_only.note")
		: t("ui.teamBridge.scope.create_needs_org");
	/*
	 * THE ORGANIZATION LIST'S OWN STATES, shared by the union view's People and
	 * Chiefs sections, and drawn BEFORE any organization header: until the list
	 * answers there is nothing to name, so a header would be an invention. One
	 * line each, and a failing list never replaces a roster that did answer.
	 *
	 * CHIEFS GETS THE QUIET COPY (design round 1, D1). Both sections read the same
	 * organization list, so two "Organizations could not be loaded." blocks with
	 * two Try again buttons would retry one read and read as two different
	 * failures. People owns the statement and the button; Chiefs states the same
	 * fact in the section's quiet line and offers no action of its own.
	 */
	const unionSectionNotice = membershipsLoading ? (
		<RailLoading label={t("ui.teamBridge.scope.loading")} />
	) : organizationsFailed ? (
		<div className="flex flex-col items-start gap-2 px-2 py-1">
			<p className="text-[12px] leading-snug text-ink-muted">
				{t("ui.teamBridge.scope.error")}
			</p>
			{onRetryMemberships && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={onRetryMemberships}
				>
					{t("ui.teamBridge.list.retry")}
				</Button>
			)}
		</div>
	) : null;
	// An account with no organizations at all: the section's own quiet line, in
	// the shipped `RailSection.empty` style, rather than N empty headers.
	const unionSectionNoticeQuiet = membershipsLoading ? (
		<RailLoading label={t("ui.teamBridge.scope.loading")} />
	) : organizationsFailed ? (
		<RailQuietLine>{t("ui.teamBridge.scope.error")}</RailQuietLine>
	) : null;
	const unionSectionEmpty =
		unionSectionNotice || organizations.length > 0
			? undefined
			: { text: t("ui.teamBridge.scope.empty") };

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

	/*
	 * ONE MENU PER CONVERSATION, for every opener (header "…", row "…",
	 * right-click): the sections come from `conversationMenuSections`, so the
	 * same conversation draws the same items wherever it is opened. Only the
	 * SELECTED conversation offers "Wake your agent for": that write is
	 * serialised per selected conversation (`useSetTeamBridgeAgentNotify`), so
	 * a non-selected row would race it. A read-only bridge draws no menu at all
	 * (the header count still opens the members panel).
	 */
	const selfPersonFor = (tenantId: string) =>
		selfAccountId
			? rosterFor(tenantId).find((row) => row.account_id === selfAccountId)
			: undefined;
	const menuFor = (conversation: TeamBridgeConversation) => {
		const selectedRow = isSelectedConversation(conversation);
		const notifyWrite =
			onMenuNotifyChange ??
			(selectedRow && onNotifyChange
				? (_row: TeamBridgeConversation, next: TeamBridgeNotify) =>
						onNotifyChange(next)
				: undefined);
		const agentNotify =
			selectedRow && agentNotifyCapabilityState === "enabled"
				? ownAgentMenuState(conversation, selfAccountId)
				: undefined;
		const sections = readOnly
			? []
			: conversationMenuSections({
					conversation,
					selfAccountId,
					selfPerson: selfPersonFor(conversation.tenant_id),
					readOnly,
					agentNotifyEnabled: agentNotify !== undefined,
					archivable: canArchiveConversation(conversation),
					wiring: {
						viewMembers: true,
						addMembers: Boolean(onAddMembers),
						join: Boolean(onMenuJoin ?? (selectedRow && onJoin)),
						notify: Boolean(notifyWrite),
						agentNotify: Boolean(onAgentNotifyChange) && selectedRow,
						ownAgent: Boolean(onMenuOwnAgent),
						leave: Boolean(onMenuLeave),
						archive: Boolean(onArchive),
					},
				});
		const handlers: TeamBridgeConversationMenuHandlers = {
			onNotifyChange: notifyWrite
				? (next) => notifyWrite(conversation, next)
				: undefined,
			onAgentNotifyChange,
			onViewMembers: () => {
				if (!selectedRow) {
					onOpenMembersFor?.(conversation, "panel");
					return;
				}
				if (threadSelection) {
					setThreadSelection(null);
					onCloseThread?.();
				}
				setMembersPanelOpen(true);
			},
			onAddMembers: () => {
				if (!selectedRow) {
					onOpenMembersFor?.(conversation, "add");
					return;
				}
				setMemberActionFailed(false);
				setMembersOpen(true);
			},
			onJoin: () => {
				if (onMenuJoin) onMenuJoin(conversation);
				else onJoin?.();
			},
			onOwnAgent: (item) => {
				setMenuError(null);
				setMenuConfirm({
					conversationId: conversation.id,
					subject: {
						kind: item.id,
						agentName: item.agentName,
						action: item.action,
					},
					item,
				});
			},
			onLeave: () => {
				setMenuError(null);
				setMenuConfirm({
					conversationId: conversation.id,
					subject: {
						kind: "leave",
						conversationKind:
							conversation.kind === "group" ? "group" : "channel",
						agentStays: conversation.builtin === "agents",
					},
				});
			},
			onArchive: () =>
				setDialog({ kind: "archive", conversationId: conversation.id }),
		};
		return {
			sections,
			conversation,
			agentNotify: agentNotify?.notify ?? null,
			handlers,
		};
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
					menu={menuFor(conversation)}
				/>
			))}
		</ul>
	);

	/*
	 * THE RAIL'S CONTENTS, drawn by whichever `<aside>` the placement below
	 * picks (one is ever mounted). The pointer hold and `aria-busy` ride the
	 * aside in both placements: React's synthetic pointer events follow the React
	 * tree through the portal, so the hold keeps working in the shell column.
	 */
	const railEvents = {
		"aria-busy": refreshingRows || refreshingUnread || undefined,
		onPointerEnter: () => setPointerInRail(true),
		onPointerLeave: () => setPointerInRail(false),
	};
	const railBody = (
		<>
			<h1 className="sr-only">{t("ui.teamBridge.page.title")}</h1>
			{/* ONE LEADING LINE (design D2 on #1660): the header, the quick rows and
			    the sections all inset `px-2`, and each control pads its own `px-2`,
			    so Back's arrow, the org tile, the Drafts glyph and every row's mark
			    start at x=16. It was 16 / 20 / 20 / 12 - three lines in one column. */}
			<header
				className={cn("flex h-12 shrink-0 items-center gap-1", SIDEBAR_INSET)}
			>
				<TeamBridgeOrgSwitcher
					organizations={organizations}
					scope={scope}
					onScopeChange={onChooseOrganization ?? onScopeChange}
					totalUnread={totalUnread}
					membershipsLoading={membershipsLoading}
					organizationsFailed={organizationsFailed}
					unreadRefreshing={refreshingUnread}
					onRetry={onRetryMemberships}
				/>
				{/*
				 * STALE-WHILE-REVALIDATE, VISIBLY (tb-instant-open). Cached rows stay
				 * on screen while the reads behind them settle, so the rail says they
				 * are being re-read rather than presenting a stale list as a current
				 * one. The slot is always in the flow and only its colour role changes,
				 * so a poll cannot reflow the rail under the reader. `data-rail-refreshing`
				 * names which read is behind it.
				 *
				 * BEFORE THE "+", NOT AFTER IT (operator, 2026-11-04): the header's last
				 * item ends on the rail's trailing line (16px from the edge, where every
				 * badge and bell ends), and an always-present 6px slot after the "+"
				 * pushed that glyph to 26px. No new copy: this is a state of the
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
				{/* "New message" opens an empty To: draft: a DM or a group is
				    decided by how many people the reader adds, as in Slack. */}
				<Button
					size="icon"
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
				className={cn("flex flex-col pb-1", SIDEBAR_INSET)}
			>
				<button
					type="button"
					aria-current={quickView === "drafts" ? "page" : undefined}
					onClick={() => openQuickView("drafts")}
					className="flex h-8 items-center gap-2 rounded-md px-2 text-[14px] text-ink-muted hover:bg-row-hover hover:text-ink"
				>
					<Pencil size={16} aria-hidden="true" />
					{t("ui.teamBridge.drafts.title")}
				</button>
				<button
					type="button"
					disabled={!selfAccountId}
					aria-current={quickView === "scheduled" ? "page" : undefined}
					onClick={() => openQuickView("scheduled")}
					className="flex h-8 items-center gap-2 rounded-md px-2 text-[14px] text-ink-muted hover:bg-row-hover hover:text-ink disabled:text-ink-disabled"
				>
					<Clock size={16} aria-hidden="true" />
					{t("ui.teamBridge.schedule.list")}
				</button>
				{invitationsEntry.current && (
					<button
						type="button"
						aria-current={quickView === "invitations" ? "page" : undefined}
						onClick={() => openQuickView("invitations")}
						className="flex h-8 items-center gap-2 rounded-md px-2 text-[14px] text-ink-muted hover:bg-row-hover hover:text-ink"
					>
						<MailPlus size={16} aria-hidden="true" />
						<span className="min-w-0 flex-1 truncate text-start">
							{t("ui.teamBridge.invitations.title")}
						</span>
						{invitations.length > 0 && (
							/* Pending invitations wait on the reader's answer: an
							   attention count, so the shared accent badge (2026-10-28). */
							<AttentionBadge
								count={invitations.length}
								/* ONE BADGE COLUMN (design round 1, D3): nav rows and
								   conversation rows now share the `px-2` inset, so the
								   count already ends on the rows' badge edge. */
								className="shrink-0"
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
								"flex h-8 items-center gap-2 rounded-md px-2 text-[14px]",
								/* The selected-row role every sidebar shares; Drafts and Scheduled
								   mark `aria-current` only, so this is the one entry that is also
								   visibly current while its view is open (design round 1, D3). */
								quickView === "archived"
									? rowCurrent
									: "text-ink-muted hover:bg-row-hover hover:text-ink",
							)}
						>
							<Archive size={16} aria-hidden="true" />
							{t("ui.teamBridge.archive.section.archived")}
						</button>
					)}
			</nav>
			<ScrollArea
				ref={railScroll.ref}
				data-team-bridge-rail-scroll=""
				onClickCapture={railScroll.onClickCapture}
				className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:block!"
			>
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
						<div className="space-y-1 px-4 py-3 text-[12px] text-ink-muted">
							<p>{t("ui.teamBridge.list.error_stale")}</p>
							{onRetry && (
								<button type="button" className="underline" onClick={onRetry}>
									{t("ui.teamBridge.list.retry")}
								</button>
							)}
						</div>
					) : (
						/* ONE COPY OF A FAILURE (visual refresh N4). With no conversation
						   open, the pane states it and holds Try again, so the rail
						   says nothing more. With one open (a deep link into a failed
						   list), or with a quick view or the owner audit in the pane
						   (they take precedence over the empty pane), the pane is busy
						   with something else, so the rail keeps a single quiet line and
						   the retry (agent review round 1, m3). */
						(target !== null || quickView !== null || ownerAudit?.active) && (
							<div className="flex flex-col items-start gap-1 px-4 py-3">
								<p className="text-meta text-ink-dim">
									{t("ui.teamBridge.list.error")}
								</p>
								{onRetry && (
									<button
										type="button"
										className="min-h-6 rounded-sm font-medium text-meta text-accent hover:underline"
										onClick={onRetry}
									>
										{t("ui.teamBridge.list.retry")}
									</button>
								)}
							</div>
						)
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
					<>
						{/*
						 * THE UNION'S PEOPLE AND CHIEFS-OF-STAFF SECTIONS.
						 *
						 * One body per organization, in the switcher's order. The organization is
						 * named ONCE - by the subheader - so its rows carry no caption, and a
						 * failing roster keeps its header: knowing WHICH organization failed is
						 * the point of the header here. No account-wide error path may replace the
						 * section: one organization's failure never blanks another's rows.
						 */}
						<RailSection
							id="team-bridge-people-heading"
							title={t("ui.teamBridge.people.title")}
							empty={unionSectionEmpty}
						>
							{unionSectionNotice ??
								orgGroups.map((group, index) => {
									const headingId = orgGroupHeadingId("people", group.tenantId);
									return (
										<Fragment key={group.tenantId}>
											{groupedUnion && (
												<RailGroupHeader
													id={headingId}
													name={group.name}
													first={index === 0}
												/>
											)}
											{group.state === "loading" ? (
												<RailLoading
													label={t("ui.teamBridge.people.loading")}
												/>
											) : group.state === "error" ? (
												<PeopleFailure
													error={directoryErrors?.[group.tenantId]}
													onRetry={() => onRetryMembers?.(group.tenantId)}
												/>
											) : group.members.length === 0 ? (
												/* An organization that draws an empty line is an
												   organization that was CHECKED. */
												<RailQuietLine>
													{t("ui.teamBridge.people.empty")}
												</RailQuietLine>
											) : (
												<ul
													className="flex flex-col"
													aria-labelledby={groupedUnion ? headingId : undefined}
												>
													{group.members.map((member) => (
														<PersonRailRow
															hasDraft={Boolean(
																draftTextAt(
																	group.tenantId,
																	`person:${member.account_id}`,
																).trim(),
															)}
															key={orgRowKey(group.tenantId, member.account_id)}
															member={member}
															selfAccountId={selfAccountId}
															identityKnown={identityKnown}
															selected={false}
															dm={dmWithPerson(
																group.directs,
																member.account_id,
																selfAccountId,
															)}
															readOnly={readOnly}
															onSelect={() => {
																/*
																 * A SELECTION NEVER CO-EXISTS WITH THE UNION, which is why the row
																 * is always unselected here: reaching a person moves the rail into
																 * their organization, where their row resolves as shipped.
																 *
																 * THE SCOPE SWITCH IS MANDATORY, as on a thread's message row:
																 * `draftTenant` and the send payload both read the scope, so a
																 * person selected in the union without the switch would compose
																 * against no organization at all.
																 */
																onScopeChange(
																	asTeamBridgeTenantId(group.tenantId),
																);
																selectTarget({
																	type: "person",
																	accountId: member.account_id,
																});
															}}
															onStartGroup={(recipient) => {
																onScopeChange(
																	asTeamBridgeTenantId(group.tenantId),
																);
																startGroup(recipient);
															}}
														/>
													))}
												</ul>
											)}
										</Fragment>
									);
								})}
						</RailSection>
						<RailSection
							id="team-bridge-chiefs-heading"
							title={t("ui.teamBridge.section.chiefs")}
							empty={unionSectionEmpty}
						>
							{unionSectionNoticeQuiet ??
								orgGroups.map((group, index) => {
									const headingId = orgGroupHeadingId("chiefs", group.tenantId);
									return (
										<Fragment key={group.tenantId}>
											{groupedUnion && (
												<RailGroupHeader
													id={headingId}
													name={group.name}
													first={index === 0}
												/>
											)}
											{group.state === "loading" ? (
												<RailLoading
													label={t("ui.teamBridge.people.loading")}
												/>
											) : group.state === "error" ? (
												/* CHIEFS DERIVES FROM PEOPLE'S READ, so it states the
												   failure once, without a reason or a second retry
												   (design D1): People's Try again repaints both. */
												<RailQuietLine>
													{t("ui.teamBridge.people.error")}
												</RailQuietLine>
											) : group.chiefs.length === 0 ? (
												<RailQuietLine>
													{t("ui.teamBridge.section.chiefs_empty")}
												</RailQuietLine>
											) : (
												<ul
													className="flex flex-col"
													aria-labelledby={groupedUnion ? headingId : undefined}
												>
													{group.chiefs.map((chief) => (
														<ChiefRailRow
															hasDraft={Boolean(
																draftTextAt(
																	group.tenantId,
																	`chief:${chief.person.account_id}`,
																).trim(),
															)}
															key={orgRowKey(
																group.tenantId,
																chief.person.account_id,
															)}
															chief={chief}
															label={composeChiefLabel(
																chief.agentName,
																personDisplayLabel(chief.person),
																chiefLabels,
															)}
															selected={false}
															dm={dmWithAgent(
																group.directs,
																chief.person.account_id,
																selfAccountId,
															)}
															readOnly={readOnly}
															onSelect={() => {
																onScopeChange(
																	asTeamBridgeTenantId(group.tenantId),
																);
																selectTarget({
																	type: "chief",
																	accountId: chief.person.account_id,
																});
															}}
															onStartGroup={(recipient) => {
																onScopeChange(
																	asTeamBridgeTenantId(group.tenantId),
																);
																startGroup(recipient);
															}}
														/>
													))}
												</ul>
											)}
										</Fragment>
									);
								})}
						</RailSection>
					</>
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
		</>
	);

	const pageBody = (
		<div
			data-glass-split=""
			data-glass-region="canvas"
			className="panel-flush @container/bridge relative flex min-h-0 flex-1 w-full overflow-hidden bg-canvas"
		>
			{/*
			 * THE RAIL, IN WHICHEVER COLUMN IS ITS (operator, 2026-11-03: one
			 * sidebar, not two). In the app it is portaled into the shell's left
			 * column - the one `SidebarNavigation` vacates on this route - which owns
			 * the width, the `surface` ground, the top pad and the glass region, so the
			 * hosted `<aside>` paints none of them (a `page-sidebar` alpha inside the
			 * shell's `sidebar` region would double the glass). Outside the shell (a
			 * story, a static-markup test) the inline `<aside>` below is the page's
			 * own column, exactly as it was before the swap.
			 */}
			<TeamBridgeRouteColumn
				inline={
					<aside
						data-glass-region="page-sidebar"
						/* BORDERLESS CHROME: the column is separated by its own ground, not a
						   rule; the top inset is padding inside the full-height panel.
						   `bg-surface` is the ground every page sidebar paints (Settings,
						   Agents, Library) and the one `rowCurrent`'s fill is tuned against:
						   on the canvas ground the selected row measured 1.06:1 on `paper`
						   (design round 1, D2). */
						className="panel-top-pad flex w-72 shrink-0 flex-col bg-surface"
						{...railEvents}
					>
						{railBody}
					</aside>
				}
			>
				<aside
					data-team-bridge-rail="hosted"
					className="flex min-h-0 flex-1 flex-col"
					{...railEvents}
				>
					{railBody}
				</aside>
			</TeamBridgeRouteColumn>

			{/* THREE PLANES, NO RULES (design spec D2, 2026-11-04). The rail paints
			    `surface` (the app sidebar's ground, which it replaces), the message
			    pane paints `canvas` - the same reading ground as the chat
			    transcript - and the composer is a raised `elevated` card. Before
			    this the rail and pane were both `surface` (ΔE00 0.00), so the only
			    visible step on screen was the hover band. The pane paints its own
			    `canvas` rather than inheriting the root's because it wears
			    `panel-top-pad`, and the box that pads must be the box that paints
			    (AGENTS.md "Panels run to the window edge"). */}
			<section
				/* The reading column alone owns the canvas alpha. The rail/thread
				 * own their surface alpha directly, never over a canvas backing. */
				data-glass-region="canvas-content"
				className={cn(
					"panel-top-pad flex min-w-0 flex-1 flex-col bg-canvas",
					(threadIsOpen || membersPanelShown) &&
						"@max-[1024px]/bridge:invisible",
				)}
			>
				{notice}
				{partialLeave && (
					/* "You left. Your agent is still in this conversation." - the true
					   state after the cascade's second write failed, never "Left". */
					<div
						role="alert"
						data-partial-leave=""
						className="mx-5 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-danger-wash px-3 py-2 text-[13px] text-ink"
					>
						<span className="min-w-0 flex-1">
							{partialLeave.retryFailed
								? t(
										"ui.teamBridge.conversation_menu.partial_leave.retry_failed",
										{
											conversation: partialLeave.name,
										},
									)
								: t("ui.teamBridge.conversation_menu.partial_leave.body", {
										conversation: partialLeave.name,
									})}
						</span>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={partialLeave.retrying}
							onClick={onRetryPartialLeave}
						>
							{t("ui.teamBridge.conversation_menu.partial_leave.retry")}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={partialLeave.retrying}
							onClick={onDismissPartialLeave}
						>
							{t("ui.common.actions.dismiss")}
						</Button>
					</div>
				)}
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
					/*
					 * THE PANE'S THREE RESTING STATES (visual refresh §3.2 States).
					 * Loading draws the timeline's own skeleton rows, so the pane has
					 * its shape before the read lands. Empty and error are one
					 * centred block - a 40px glyph, a 15px title, one line, one action
					 * - and the ERROR carries the only Try again on screen (N4): the
					 * rail used to say the same sentence and offer its own button, two
					 * copies of one failure. A failed read never claims emptiness
					 * (design round 1, D7).
					 */
					listState === "loading" ? (
						<div className="flex min-h-0 flex-1 flex-col">
							<TeamBridgeMessageSkeleton
								label={t("ui.teamBridge.list.loading")}
							/>
						</div>
					) : (
						<div className="flex flex-1 items-center justify-center px-6">
							{listState === "error" ? (
								<div
									role="alert"
									className="flex max-w-sm flex-col items-center text-center"
								>
									<CloudOff
										size={40}
										aria-hidden="true"
										className="text-ink-dim"
									/>
									<p className="mt-3 font-semibold text-[15px] text-ink">
										{t("ui.teamBridge.list.error")}
									</p>
									{onRetry && (
										<button
											type="button"
											onClick={onRetry}
											className="mt-2 min-h-6 rounded-sm px-1.5 font-medium text-[13px] text-accent hover:underline"
										>
											{t("ui.teamBridge.list.retry")}
										</button>
									)}
								</div>
							) : (
								<div className="flex max-w-sm flex-col items-center text-center">
									<MessagesSquare
										size={40}
										aria-hidden="true"
										className="text-ink-dim"
									/>
									<p className="mt-3 font-semibold text-[15px] text-ink">
										{t("ui.teamBridge.list.empty.title")}
									</p>
									<p className="mt-1 text-[13px] text-ink-muted">
										{createDisabled
											? createHint
											: t("ui.teamBridge.list.empty.body")}
									</p>
									{!createDisabled && (
										<Button
											size="md"
											variant="primary"
											className="mt-4"
											onClick={() =>
												selectTarget(
													draftState.drafts.compose?.target ?? {
														type: "compose",
														recipients: [],
													},
												)
											}
										>
											<Plus size={16} aria-hidden="true" />
											{t("ui.teamBridge.compose.new")}
										</Button>
									)}
								</div>
							)}
						</div>
					)
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
							/* Static chrome continues the column's ground. A second canvas
							 * fill would mask glass; this is outside the scroller, so no
							 * sticky-content isolation band is needed. */
							<header className="flex h-12 shrink-0 items-center gap-2 px-5">
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
								{/*
								 * ONE QUIET LINE OF FACTS (visual refresh D8, with #1670's count
								 * button). After the name come a 1px `hairline` tick, the member
								 * count (a button that opens the members panel, below), and then the
								 * topic: a user-set topic first, else the built-in channel's. The
								 * relative "· 4 minutes ago" is gone; the rail row's tooltip carries
								 * it. With invitees the count says "N active" and the invited count
								 * lives in the members panel it opens and in its accessible name.
								 * Never infer membership from a preview's aggregate `member_count`
								 * beyond the plain count: a preview has no rows, so `invited` is 0.
								 */}
								{shown && shown.kind !== "dm" && (
									<>
										<span
											aria-hidden="true"
											className="h-4 w-px shrink-0 bg-hairline"
										/>
										{/*
										 * THE COUNT OPENS THE ROOM (operator 2026-11-04: the count was
										 * inert, and there was "no great way to see all the members").
										 * A real button so it is in the tab order with the outline focus
										 * ring; hover is a colour step only. The visible text stays the
										 * count, and the accessible name says what pressing it does.
										 * A preview has no member rows to list, so it stays text there.
										 */}
										<button
											type="button"
											disabled={previewSelected}
											aria-expanded={membersPanelShown}
											aria-label={
												membershipCounts.invited > 0
													? t(
															"ui.teamBridge.members_panel.open_label_invited",
															{
																active: membershipCounts.active,
																invited: membershipCounts.invited,
															},
														)
													: t("ui.teamBridge.members_panel.open_label", {
															count: conversationMemberCount(shown),
														})
											}
											onClick={() => {
												if (membersPanelOpen) {
													setMembersPanelOpen(false);
													return;
												}
												if (threadSelection) {
													setThreadSelection(null);
													onCloseThread?.();
												}
												setMembersPanelOpen(true);
											}}
											className={cn(
												"shrink-0 rounded-sm px-1 py-0.5 text-start text-[13px] text-ink-muted transition-colors duration-fast",
												/* A FILL ON HOVER, not only ink (design review round 1, D1): an ink
												   change alone left the count looking inert, the operator's original
												   complaint. #1668 moved this header onto the pane's `canvas`
												   ground, where `row-hover` (tuned against `surface`) measures
												   ~1.01:1 in light themes; `surface` is one role step up from
												   `canvas` on every palette, the same reasoning as the members
												   panel's row hover (design review round 1, D2). At rest it stays
												   quiet text, so the header does not grow a pill. */
												"enabled:hover:bg-surface enabled:hover:text-ink disabled:cursor-default",
											)}
										>
											{/* ONE LINE, as #1668's D8 header set it: with invitees the
											    headline says "active" outright (an invitation is not
											    active access, design review D2 on #1336); the invited
											    count lives in the members panel this opens and in the
											    accessible name above. Never infer the breakdown from a
											    preview's aggregate `member_count`: a preview has no rows. */}
											{/* A PEOPLE GLYPH BEFORE THE COUNT (design review round 3,
											    D1 on #1670): it marks the number as a who-is-here
											    control, not a stray statistic beside the name. */}
											<Users
												size={13}
												aria-hidden="true"
												className="me-1 inline-block align-[-2px]"
											/>
											{membershipCounts.invited > 0
												? t("ui.teamBridge.member.active_count", {
														count: membershipCounts.active,
													})
												: t("ui.teamBridge.member.count", {
														count: conversationMemberCount(shown),
													})}
										</button>
										{/* A user-set topic first, then a built-in channel's translated
									    one (#1668 design round 1, D2). It follows the count rather
									    than replacing it: the count is the members panel's opener, so
									    a channel with a topic must not lose its only way in. */}
										{(shown.topic?.trim() || shownTopicKey) && (
											<>
												<span
													aria-hidden="true"
													className="h-4 w-px shrink-0 bg-hairline"
												/>
												<span className="min-w-0 truncate text-[13px] text-ink-muted">
													{shown.topic?.trim()
														? shown.topic.trim()
														: shownTopicKey
															? t(shownTopicKey)
															: null}
												</span>
											</>
										)}
									</>
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
									{/* The header's "…" draws the same items as the row's
									    (`menuFor`). A preview is offered Join here too, so the
									    header and the row agree about a discoverable channel. */}
									{shown &&
										!readOnly &&
										(() => {
											const menu = menuFor(shown);
											return (
												<TeamBridgeConversationMenu
													sections={menu.sections}
													conversation={shown}
													agentNotify={menu.agentNotify}
													handlers={menu.handlers}
													defaultOpen={defaultMenuOpen}
												/>
											);
										})()}
								</div>
							</header>
						)}
						{notifyFailed && (
							<p role="alert" className="px-5 pb-1 text-[12px] text-danger">
								{t("ui.teamBridge.notify.error")}
							</p>
						)}
						{agentNotifyFailed && (
							<p role="alert" className="px-5 pb-1 text-[12px] text-danger">
								{t("ui.teamBridge.agentNotify.error")}
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

						<ScrollArea
							ref={timeline.rootRef}
							/* `[overflow-anchor:none]` IS LOAD-BEARING ONCE THE TIMELINE IS WINDOWED. Chrome's
							   own scroll anchoring decides what to hold steady from the DOM it can see; with
							   rows being mounted and unmounted as the window moves, it picks a different
							   anchor than the reader's row and fights `use-bridge-timeline-window`'s
							   correction - the reader ends up a few dozen pixels off after each page. One
							   anchor owner, the same call this app's other hand-anchored scrollers make
							   (`chat-sidebar.tsx`, `notifications-page.tsx`, `team-bridge-owner-audit.tsx`). */
							className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:block! [&_[data-radix-scroll-area-viewport]>div]:h-full [&_[data-radix-scroll-area-viewport]]:[overflow-anchor:none]"
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
									listState === "ready" &&
									!unlistedCreation ? (
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
								) : shown === null && merged.messages.length === 0 ? (
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
														kind={target.type === "chief" ? "agent" : "human"}
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
															className="self-start rounded-full"
														>
															<TeamBridgeAvatar
																member={draftPerson}
																kind={
																	target.type === "chief" ? "agent" : "human"
																}
																label={paneTitle ?? ""}
																size={56}
																className="text-[22px]"
															/>
														</button>
													</TeamBridgeProfileCard>
												) : (
													<span
														aria-hidden="true"
														className={cn(
															"flex size-14 items-center justify-center overflow-hidden rounded-full font-semibold text-[22px]",
															// The same borderless identity washes as the message
															// rows' plates, so one person reads alike everywhere.
															"bg-accent-alt-wash",
															target.type === "chief"
																? "text-accent"
																: "text-accent-alt",
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
								) : messageState === "loading" && merged.localCount === 0 ? (
									<TeamBridgeMessageSkeleton
										label={t("ui.teamBridge.thread.loading")}
									/>
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
								) : merged.messages.length === 0 ? (
									<p className="mt-auto px-5 pb-4 text-[13px] text-ink-muted">
										{/* Design round 1, D5: "Say hello" invites a post the line below
										    refuses. An archived channel's empty state is a plain fact. */}
										{shown?.status === "archived"
											? t("ui.teamBridge.archive.thread.empty")
											: t("ui.teamBridge.thread.empty")}
									</p>
								) : (
									<TeamBridgeMessageList
										messages={merged.messages}
										unreadAfterSeq={unreadAfterSeq}
										events={events}
										presentationOf={(message) => {
											const local = merged.localOf(message);
											/* A CONFIRMED row the page has not carried yet is drawn from
											   the send response; it is the server's, so it keeps full ink
											   and its real seq - only an unconfirmed row is "local". */
											const unconfirmed =
												local !== undefined &&
												(local.status !== "sent" ||
													local.serverRow === undefined);
											return {
												key: merged.keyOf(message),
												local: unconfirmed,
												delivery:
													local && unconfirmed
														? {
																status:
																	local.status === "failed"
																		? "failed"
																		: "pending",
																/* RETRY IS THE ROW'S OWN KEY, re-sent as the same
															   attempt: the hub dedupes a request that landed with
															   its answer lost. EDIT puts the words back in the box
															   and drops the row, which is the other thing a reader
															   wants to do with a message that did not go. */
																onRetry:
																	local.status === "failed" && isDraftCurrent()
																		? () => {
																				usePendingSends
																					.getState()
																					.patch(local.localId, {
																						status: "pending",
																						autoRetried: local.autoRetried,
																					});
																				void deliverOptimistic(local);
																			}
																		: undefined,
																onEdit:
																	local.status === "failed" && isDraftCurrent()
																		? () => {
																				useConversationInputStore
																					.getState()
																					.returnPayload(composerKey, {
																						text: local.body,
																						attachments: [],
																						replies: [],
																					});
																				usePendingSends
																					.getState()
																					.remove(local.localId);
																			}
																		: undefined,
															}
														: undefined,
											};
										}}
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
										highlightId={highlightMessageId}
										/* THE WINDOWED STRIP. Passing the timeline's own scroll root is what
										   turns on the virtualized path (see `TeamBridgeMessageList`): only
										   the visible rows plus overscan mount, and the list asks for an
										   older page when the reader nears the top. */
										scrollRootRef={timeline.rootRef}
										hasOlder={olderPaging?.hasOlder ?? false}
										loadingOlder={olderPaging?.loadingOlder ?? false}
										onLoadOlder={olderPaging?.onLoadOlder}
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

						{/* TEAM BRIDGE'S OWN COMPOSER, AND THE PANE'S OWN PADDING IS THE
						    ONLY SPACE UNDER IT. This is a messaging pane: one bar at the
						    foot, the attach and send controls inside it. It is NOT the shared
						    chat composer - that assembly carries the chat pane's measures, a
						    status row and an action row, and in a conversation pane it renders
						    a 110px card where a 46px bar belongs (operator report,
						    2026-10-30). What that adoption fixed, the field's growth, is kept
						    in `team-bridge-composer.tsx`, where it belongs.
						    NOTHING SITS BETWEEN THE BAR AND THE PANE'S EDGE: a row below the
						    box is the dead strip this layout is judged on, so the schedule
						    control rides the bar's own trailing cluster and the chord rides the
						    line it is about. The band clips nothing, because the bar draws its
						    focus ring OUTSIDE itself and a clipping ancestor eats that edge
						    (R3, pinned by scripts/team-bridge-composer-ring.test.mjs). */}
						{!previewSelected &&
							(shown?.status === "archived" ? (
								/* Nobody can post: the server refuses it too (`conversation_archived`). */
								<p className="shrink-0 px-5 pb-4 text-[12px] text-ink-dim leading-snug">
									{t("ui.teamBridge.archive.composer.note")}
								</p>
							) : readOnly ? (
								readOnlyExplained ? null : (
									<p className="shrink-0 px-5 pb-4 text-[12px] text-ink-dim leading-snug">
										{t("ui.teamBridge.read_only.composer")}
									</p>
								)
							) : (
								<div
									className="flex min-w-0 shrink-0 flex-col gap-2 px-4 pt-1 pb-4"
									/* THE BAND'S STABLE HANDLE, on the `data-lo-composer-band`
									   convention the composer rigs read (see the shared composer's
									   own attribute): this element IS the composer's band here -
									   the alerts and the restored attempt above the bar, the bar
									   itself, and the pane's own inset below it - so a control that
									   refuses the field can be asserted to render in the same band
									   the field is in, without either of them naming a class. */
									data-lo-composer-band={true}
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
									{/* A HELD OR UNCERTAIN ATTEMPT REFUSES THE BOX: the attempt already owns
									   this draft's idempotency key, and a second send would race it.
									   It sits ABOVE the bar - a reason a control will not take
									   belongs where the reader looks for it, and nothing belongs
									   between the bar and the pane's own padding. */}
									{heldAttempt ? (
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
									) : draftState.current?.createUncertain && !scheduling ? (
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
									) : null}
									{/* No destination yet. The box still renders - it is the composer
									   this host has - and states why it refuses instead of inviting
									   text it cannot send. */}
									{!canCompose && (
										<p id={composeGateId} className="text-sm text-ink-muted">
											{t("ui.teamBridge.compose.empty")}
										</p>
									)}
									<TeamBridgeComposer
										conversationId={composerKey}
										placeholder={composerPlaceholder}
										/* The hub's image capability is what offers the attach control
										   at all: an affordance that cannot work is the dead end the
										   fail-closed rule forbids, and a refused send names the
										   capability instead (see `submit`). */
										canAttach={Boolean(imageCapability)}
										onFileCountChange={setStagedFileCount}
										fileContext={{
											accountId: selfAccountId,
											tenantId:
												selected?.tenant_id ??
												(draftTenant === TEAM_BRIDGE_ALL_SCOPE
													? undefined
													: draftTenant),
											conversationId: selected?.id ?? null,
											capability: fileCapability,
										}}
										recordingProbe={recordingProbe}
										disabled={
											!canCompose ||
											Boolean(heldAttempt) ||
											Boolean(draftState.current?.createUncertain)
										}
										disabledReasonId={
											heldAttempt || draftState.current?.createUncertain
												? heldReasonId
												: !canCompose
													? composeGateId
													: undefined
										}
										sendDisabled={
											Boolean(draftState.current?.sendAt) || scheduling
										}
										sending={sending}
										/* The line at the point of typing says the chord, and says why
										   the schedule control is refusing while a send is out (UX
										   round 1, U3 + U4). It rides the bar, so it costs no row. */
										hint={
											stagedFileCount > 0
												? t("ui.teamBridge.files.no_schedule")
												: sending
													? t("ui.chat.canonical.send_failure.send_lock")
													: undefined
										}
										onSendMessage={submit}
										/* HOST CHROME WITH NO BAR SLOT. Scheduling needs the target
										   and a time, neither of which is typing. */
										trailing={
											onSchedule ? (
												<Button
													ref={clockRef}
													variant="ghost"
													size="icon-sm"
													aria-label={t("ui.teamBridge.schedule.title")}
													/* The line in the bar already says this while a send is in
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
														stagedFileCount > 0 ||
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
											) : undefined
										}
									/>
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
			{/* Threads: a ground-separated sibling. The capability and captured
			    account gate every selection source, including deep links. */}
			{threadsAvailable &&
				threadSelection &&
				shown &&
				threadSelection.conversationId === shown.id &&
				threadSelection.tenantId === shown.tenant_id &&
				!previewSelected &&
				!selectedOrganizationUnknown && (
					/* Below a 1024px conversation region a second flex column would leave
					   too little for the timeline, so the thread takes over the region
					   rather than shrinking either reading measure. Where the takeover
					   STARTS depends on where the rail is: in the app it sits in the
					   shell's column, outside this container, so the thread starts at
					   the container's edge (`start-0`; `start-72` opened a 288px canvas
					   gap there). Inline (stories, static markup) the 288px rail is
					   still inside this `relative` container and the thread starts after
					   it. `@container/bridge` then measures conversation + thread only,
					   which is why the thread docks at a narrower window than it did
					   with two sidebars. */
					<div
						className={cn(
							"absolute inset-y-0 end-0 z-20 min-w-0 @min-[1024px]/bridge:static @min-[1024px]/bridge:w-[min(26rem,45%)] @min-[1024px]/bridge:min-w-72 @min-[1024px]/bridge:shrink-0",
							railHosted ? "start-0" : "start-72",
						)}
					>
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
								filesCapability={fileCapability}
								onClose={() => {
									setThreadSelection(null);
									onCloseThread?.();
								}}
							/>
						)}
					</div>
				)}
			{/* MEMBERS: the thread pane's slot and geometry (see the comment above),
			    and mutually exclusive with it - opening either closes the other. */}
			{membersPanelShown && shown && !threadIsOpen && (
				<div
					className={cn(
						"absolute inset-y-0 end-0 z-20 min-w-0 @min-[1024px]/bridge:static @min-[1024px]/bridge:w-[min(26rem,45%)] @min-[1024px]/bridge:min-w-72 @min-[1024px]/bridge:shrink-0",
						railHosted ? "start-0" : "start-72",
					)}
				>
					<TeamBridgeMembersPanel
						key={`${shown.tenant_id}:${shown.id}`}
						conversation={shown}
						people={rosterFor(shown.tenant_id)}
						selfAccountId={selfAccountId}
						conversationName={paneTitle ?? t("ui.teamBridge.list.untitled")}
						onAddMembers={
							!readOnly &&
							onAddMembers &&
							canInviteMembers(shown, selfAccountId)
								? () => {
										setMemberActionFailed(false);
										setMembersOpen(true);
									}
								: undefined
						}
						onAction={
							readOnly
								? undefined
								: (row, action) => {
										if (action === "remove") {
											if (
												!onRemoveMember ||
												!canRemoveMembers(shown, selfAccountId)
											)
												return Promise.reject(
													new Error("Team Bridge write authority changed"),
												);
											return onRemoveMember(shown, row.member.account_id);
										}
										if (!onMemberSelfAction)
											return Promise.reject(
												new Error("Team Bridge write authority changed"),
											);
										const endpoint = (row.member as { endpoint_id?: unknown })
											.endpoint_id;
										return onMemberSelfAction(
											shown,
											action,
											typeof endpoint === "string" ? endpoint : undefined,
										).then((result) => {
											/* LEAVING MOVES THE SELECTION the way archive does: the
											   room is no longer the reader's, so land on the next
											   channel in the rail (else the previous, else the
											   default) and close the panel. */
											if (action === "leave") {
												setMembersPanelOpen(false);
												selectTarget(
													landingAfterRemoval(
														sidebarRows,
														shown.id,
														organizationOrder,
													),
												);
											}
											return result;
										});
									}
						}
						onClose={() => setMembersPanelOpen(false)}
					/>
				</div>
			)}
			{(() => {
				/* The conversation menu's confirm, for the conversation it was opened on
				   (a row's menu acts on that row, not the selection). */
				const subject = menuConfirm
					? selectable.find((row) => row.id === menuConfirm.conversationId)
					: undefined;
				if (!menuConfirm || !subject) return null;
				const name =
					conversationTitle(subject, selfAccountId) ??
					t("ui.teamBridge.list.untitled");
				const wasShown =
					target?.type === "conversation" && target.id === subject.id;
				const close = () => {
					setMenuConfirm(null);
					setMenuError(null);
				};
				const confirm = () => {
					if (menuPending) return;
					const { subject: what, item } = menuConfirm;
					let write: Promise<unknown> | undefined;
					if (what.kind === "leave") {
						write = onMenuLeave?.(subject).then((outcome) => {
							/* LEFT: the room is no longer the reader's. Land on #general
							   (the default landing) when it was the one on screen. The
							   container shows the partial state itself when the agent
							   withdraw failed. */
							if (wasShown) {
								setMembersPanelOpen(false);
								selectTarget(
									landingAfterLeave(sidebarRows, subject.id, organizationOrder),
								);
							}
							return outcome;
						});
					} else if (item) {
						const request = ownAgentRequest(
							subject,
							selfAccountId,
							selfPersonFor(subject.tenant_id),
							item,
						);
						write = request
							? onMenuOwnAgent?.(subject, request)
							: Promise.reject(
									new Error("Team Bridge write authority changed"),
								);
					}
					if (!write) return;
					setMenuPending(true);
					setMenuError(null);
					write.then(
						() => {
							setMenuPending(false);
							setMenuConfirm(null);
						},
						(failure: unknown) => {
							setMenuPending(false);
							setMenuError(
								subject.builtin !== "general"
									? "error"
									: isMemberNotFound(failure)
										? "not_in_general"
										: item?.action === "accept" && generalRejoinRefused(failure)
											? "general_rejoin_refused"
											: "error",
							);
						},
					);
				};
				return (
					<TeamBridgeMenuConfirmDialog
						subject={menuConfirm.subject}
						conversationName={name}
						pending={menuPending}
						error={menuError}
						onClose={close}
						onConfirm={confirm}
					/>
				);
			})()}
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
								selectTarget(
									landingAfterRemoval(
										sidebarRows,
										subject.id,
										organizationOrder,
									),
								);
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
										onTarget(
											landingAfterRemoval(
												sidebarRows,
												subject.id,
												organizationOrder,
											),
										);
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
	/* @-MENTIONS for both composers in this pane (channel and thread), from the
	   cached directory and the open conversation (mentions/). The provider stays
	   mounted through same-owner/tenant creation, but crossing either privacy
	   boundary deliberately discards its subtree instead of preserving old state. */
	return (
		<TeamBridgeMentionProvider
			key={JSON.stringify([selfAccountId, draftTenant])}
			conversation={shown}
			people={shown ? rosterFor(shown.tenant_id) : []}
			selfAccountId={selfAccountId}
			sendMentions={sendMentionsCapabilityState === "enabled"}
			onAddMembers={onAddMembers}
		>
			{pageBody}
		</TeamBridgeMentionProvider>
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
	/*
	 * A notification click's message target outlives an owner remount below:
	 * the route parameter is consumed on the first owned render, and an auth
	 * settlement landing just after it would otherwise drop the target. It is
	 * only an id pair - a conversation the next owner cannot read never
	 * resolves under it, and it is cleared once handled.
	 */
	const messageLink = useRef<TeamBridgeMessageLink | null>(null);
	/*
	 * The CONVERSATION a notification click named, carried across the same owner
	 * remount for the same reason: the click's parameters are consumed on the
	 * first owned render, and the remount reads the remembered view - which,
	 * before the click was written there, is the conversation the reader had
	 * BEFORE the click. Ids only; a conversation the next owner cannot resolve
	 * falls back silently like any other remembered target.
	 */
	const clickCarry = useRef<ClickCarry | null>(null);
	// Remount immediately at the real auth transition, before stale TB status can
	// render. Retain only original-owner data; never carry an A callback into B.
	return (
		<TeamBridgeOwnedPage
			key={account.token}
			accountId={account.accountId}
			drafts={drafts.current}
			receipts={receipts.current}
			messageLinkCarry={messageLink}
			clickCarry={clickCarry}
		/>
	);
};

type ClickCarry = { scope: TeamBridgeScope; view: TeamBridgeViewMemory };

type TeamBridgeMessageLink = {
	conversationId: string;
	messageId: string;
	fetched: boolean;
	/*
	 * Whether this link has spent its ONE newest-page read (agent review round 4,
	 * R4-1). Link state, not a ref: the effect below re-decides on it, and a ref
	 * flip would not re-run the effect - which is how the walk stalled in round 2.
	 */
	newestRead: boolean;
};

/**
 * How long a `?message=` target may wait for its conversation to resolve before
 * it is released (review round 1, m3). Both ordinary clearing conditions need
 * progress - a different selection, or one completed re-read - so a click for a
 * conversation this rail cannot resolve (archived, membership gone, deleted)
 * would otherwise hold the link, and the carry, for the life of the page. It is
 * a bound on the TARGET'S LIFE, not a timing for the highlight: one landing
 * costs one request, so an ordinary click finishes well inside it. A click that
 * does NOT finish inside it is released too - a first read slow enough to still
 * be running at the bound, not only a conversation the rail can never resolve -
 * which is the intended trade: a late highlight on a row the reader has moved on
 * from is worse than none.
 */
const MESSAGE_LINK_TIMEOUT_MS = 8_000;
/*
 * How far a `?message=` link may page back to find its row before it is treated
 * as unreachable.
 *
 * DERIVED, NEVER TYPED (agent review round 3, m9). The walk starts from the
 * newest page and asks for one older page at a time, so `n` reads retain
 * `(n + 1) * TEAM_BRIDGE_PAGE_SIZE` rows: at the retention cap an older read
 * trims the NEWEST rows, and the walk would be paging through a window it is
 * itself shortening - the row it wants can be dropped the moment it arrives, and
 * the next poll resets the window away from it. `floor(800/60) - 1 = 12` reads
 * keep `13 * 60 = 780` rows, strictly inside the cap. If either constant moves,
 * this expression moves with it; the over-cap case is handled by the cache's
 * `hasNewer` reset instead (a replacement, never a splice).
 */
const MESSAGE_LINK_MAX_PAGES =
	Math.floor(TEAM_BRIDGE_MAX_RETAINED_MESSAGES / TEAM_BRIDGE_PAGE_SIZE) - 1;

/** The page view's identity: one mounted view per account, tenant and target. */
const viewKeyFor = (
	accountId: string | undefined,
	tenant: string,
	target: TeamBridgeTarget | null,
) => JSON.stringify([accountId, tenant, target]);

const TeamBridgeOwnedPage: FC<{
	accountId?: string;
	messageLinkCarry: { current: TeamBridgeMessageLink | null };
	clickCarry: { current: ClickCarry | null };
	drafts: Map<string, OwnedDraft>;
	receipts: Map<
		string,
		Map<string, { id: string; tenantId: string | undefined }>
	>;
}> = ({ accountId, drafts, receipts, messageLinkCarry, clickCarry }) => {
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
	const requestedMessage = searchParams.get("message");
	/*
	 * A PERSON OR CHIEF-OF-STAFF ROW named by the link (`?tenant=&person=` or
	 * `&chief=`, the command palette's door, `team-bridge-deep-link.ts`). It opens
	 * the way a click on that rail row does - the person is selected and the pane
	 * shows their DM, or an empty draft addressed to them - so nothing is created
	 * by the link itself. Parsed by the module that builds it, and only when no
	 * conversation is named: a conversation link keeps every rule below as shipped.
	 */
	const requestedLink = teamBridgeTargetFromSearch(searchParams);
	const requestedRow =
		!requestedConversation &&
		requestedLink &&
		requestedLink.target.type !== "conversation"
			? requestedLink.target
			: null;
	const requestedRowType = requestedRow?.type ?? null;
	const requestedRowAccount = requestedRow?.accountId ?? null;
	/* Any link that names a row outranks the remembered view, as a click does. */
	const requestedAny = Boolean(requestedConversation || requestedRow);
	/*
	 * THE MESSAGE A NOTIFICATION CLICK NAMED (`?message=`), held past the param
	 * clear below until the timeline has landed on it. Timeline-only: a reply's
	 * banner also names its thread, and the thread pane opens on that thread
	 * (its cache was refreshed before the banner was raised), so a reply id is
	 * never looked for in a timeline that excludes replies by contract.
	 */
	const [messageLink, setMessageLinkState] =
		useState<TeamBridgeMessageLink | null>(() => {
			const seeded =
				requestedMessage && requestedConversation && !requestedRoot
					? {
							conversationId: requestedConversation,
							messageId: requestedMessage,
							fetched: false,
							newestRead: false,
						}
					: requestedAny
						? null
						: messageLinkCarry.current;
			/*
			 * THE CARRY IS WRITTEN THROUGH ON EVERY BRANCH, the null ones included
			 * (review round 1, m3). The carry is only ever read by a LATER owner's
			 * initializer, so a branch that leaves it holding an older click's
			 * target can re-seed a link this page has already decided against: a
			 * fresh `?conversation=` with no message would otherwise resurrect the
			 * previous click's highlight under the next account.
			 */
			messageLinkCarry.current = seeded;
			return seeded;
		});
	// Every write goes through the carry too (see `TeamBridgePage`).
	const setMessageLink = useCallback(
		(
			next:
				| TeamBridgeMessageLink
				| null
				| ((
						current: TeamBridgeMessageLink | null,
				  ) => TeamBridgeMessageLink | null),
		) =>
			setMessageLinkState((current) => {
				const value = typeof next === "function" ? next(current) : next;
				messageLinkCarry.current = value;
				return value;
			}),
		[messageLinkCarry],
	);
	/*
	 * THE READER'S LAST SCOPE seeds the first paint, synchronously, so a
	 * multi-organization account lands where it left off rather than on the union
	 * and then correcting. "Last" is the scope they were LOOKING AT when they left
	 * (`team-bridge-view-memory`), else their last switcher pick. The stored value
	 * only decides this page's START: `resolveOpeningScope` still validates it
	 * against the memberships once they answer, and only an explicit switcher pick
	 * writes the preference.
	 */
	const storedScope = useMemo(() => {
		const storage = browserDraftStorage();
		return storage && accountId
			? (readLastScope(storage, accountId) ??
					readScopePreference(storage, accountId))
			: undefined;
	}, [accountId]);
	/* A click a previous owner consumed (see `clickCarry`) opens like the click. */
	const carriedClick = useRef(requestedAny ? null : clickCarry.current).current;
	const [scope, setScope] = useState<TeamBridgeScope>(() =>
		requestedTenant
			? asTeamBridgeTenantId(requestedTenant)
			: (carriedClick?.scope ?? storedScope ?? TEAM_BRIDGE_ALL_SCOPE),
	);
	/*
	 * WHERE THE READER WAS IN THIS SCOPE (the operator's "it always defaults back
	 * to general"). This container is a route element and unmounts whenever the
	 * reader leaves Team Bridge, so its `target` used to restart at `null` and the
	 * landing effect below picked #general on every return. The record is read
	 * here, during render, so the initialisers below paint the remembered
	 * conversation in the FIRST frame - no #general flash and no request beyond
	 * the ones the page already makes. A ref, re-read whenever the scope changes:
	 * each organization, and "All organizations", keeps its own record.
	 */
	const viewMemory = useRef<{
		scope: TeamBridgeScope | null;
		view: TeamBridgeViewMemory | null;
	}>({ scope: null, view: null });
	if (viewMemory.current.scope !== scope) {
		const storage = browserDraftStorage();
		viewMemory.current = {
			scope,
			view:
				storage && accountId ? readViewMemory(storage, accountId, scope) : null,
		};
	}
	/*
	 * A notification click or deep link (`?conversation=`) outranks the memory:
	 * the reader asked for THAT conversation, and the write-through below then
	 * makes it the new remembered one.
	 */
	const restoreOnOpen = requestedAny
		? null
		: (carriedClick?.view ?? viewMemory.current.view);
	const [threadLink, setThreadLink] = useState<ThreadTarget | null>(() =>
		/* THE HOLD: a `?thread=` deep link (a notification click, a shared link)
		   must not become a thread target in this build. The conversation still
		   opens - that is the click's other half - and no selection is left
		   behind for a later render to mount. */
		requestedConversation
			? TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD
				? threadTargetFromSearch(searchParams)
				: null
			: TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD
				? rememberedThread(restoreOnOpen)
				: null,
	);
	const scopeChosen = useRef(Boolean(requestedTenant || carriedClick));
	/*
	 * Consumed once this owner can PERSIST it (review round 1, R4). Clearing it on
	 * mere existence lost the click when storage refused the write (private
	 * mode, quota): the carry was the only record, so a second auth remount
	 * restored the pre-click view. Until a write lands, the in-memory carry stays
	 * the record; it lives in the route-level container, so leaving Team Bridge
	 * still drops it.
	 */
	useEffect(() => {
		if (!carriedClick || !accountId) return;
		const storage = browserDraftStorage();
		if (
			storage &&
			writeViewMemory(storage, accountId, carriedClick.scope, carriedClick.view)
		)
			clickCarry.current = null;
	}, [carriedClick, accountId, clickCarry]);
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
	 * read. `snapshotForScope` then narrows it to the scope being painted, because
	 * the watcher's entry is ACCOUNT-scoped: it carries every organization's rows
	 * (review round 1, M1). The watcher carries no message bodies, so the selected
	 * thread's history
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
	/* The composer's speech capability; see `recordingProbe` on the view's props. */
	const recordingProbe = useRadientCredentialProbe();
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
	// An ended Team trial pauses the organization: history stays readable and
	// posting is off (the hub refuses it too, 403 `team_trial_ended`).
	const trialNote = useTeamBridgeTrialNote(
		readsEnabled ? status.data?.tenant_id : null,
	);
	// Q5: an ended trial reads surface A with no tenant; the runtime's marker
	// names the organization so the no-org branch shows its paused band.
	const trialEnded = trialEndedOrg(status.data);
	const readOnly = teamBridgeReadOnly({
		statusReadOnly: status.data?.read_only === true,
		ownerGuard,
		trialPaused: trialNote.paused,
	});
	const owner = useBridgeOwner(accountId);
	const isCurrentOwner = () => owner.isCurrent() && ownerGuard;
	/* The same fence minus "this page is still mounted": for the first-message post
	   only, which must finish after the reader leaves (see `sendBody`). */
	const isWriteAuthorityCurrent = () =>
		owner.isAuthorityCurrent() && ownerGuard;
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
	/*
	 * ONE UNREAD SOURCE (`team-bridge-unread-sync.ts`). Every row count, every
	 * organization count and the All-organizations total read the same merged
	 * view the nav badge reads, so a count the badge shows is on a row, and a
	 * read clears both in the same render.
	 */
	const unreadView = useTeamBridgeUnreadView(selfAccountId);
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
			).map((organization) => ({
				...organization,
				unread:
					unreadView.byTenant.get(organization.tenantId) ?? organization.unread,
			})),
		[memberships.memberships, unread.data, hubTenants, unreadView],
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
		resolveOpeningScope({
			organizations,
			stored: storedScope,
			requestedTenant,
			chosen: scopeChosen.current,
			current: scope,
			snapshotRows: openingRows,
		}) === scope;
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
	/*
	 * A SCOPE MAY ONLY PAINT ITS OWN ORGANIZATION'S SNAPSHOT (review M1).
	 * `openingRows` is the shell watcher's account-scoped cache entry, and
	 * `visibleConversationRows` hands a single-organization list back unchanged -
	 * so before this, a stored single-org scope painted the OTHER organizations'
	 * channels and DMs under its own switcher title, and the one-shot landing
	 * effect below could select a conversation this page never reads (which in
	 * turn made `selectionOutsideLive` spend an archived read on open). Filtering
	 * at the source keeps the rule one place: a scope stands in only its own rows.
	 */
	const openingSnapshot = useMemo(
		() => snapshotForScope(openingRows ?? [], scope),
		[openingRows, scope],
	);
	/*
	 * ...then every row takes the shared unread view, so a row and the nav badge
	 * cannot disagree. The merge is applied to whatever this scope may paint,
	 * AFTER the filter above: a row the scope does not own is never merged into
	 * view (and `withSharedUnread` would otherwise hand it a count it has no
	 * business showing).
	 */
	const conversations = useMemo(
		() =>
			(list.data?.conversations ?? openingSnapshot).map((row) =>
				withSharedUnread(row, unreadView),
			),
		[list.data?.conversations, openingSnapshot, unreadView],
	);
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
			: (requestedRow ?? restoreOnOpen?.target ?? null),
	);
	/*
	 * A REMEMBERED TARGET IS A CLAIM, NOT A FACT, until the reads confirm it: the
	 * conversation may have been deleted, archived away or had the reader removed
	 * since. While this holds the remembered target, the validation effect below
	 * falls back to the default landing - silently - when the reads that could
	 * resolve it have answered without it.
	 */
	const restoredTarget = useRef<TeamBridgeTarget | null>(
		requestedAny ? null : (restoreOnOpen?.target ?? null),
	);
	/*
	 * The scopes whose remembered view has already been offered this mount. The
	 * landing effect restores a scope's record ONCE - on the first landing after
	 * the page opens or the switcher moves to it - and lands on the default ever
	 * after: a `null` target from a removal (archive, delete, leave) must never
	 * re-land on the remembered conversation, which may be the one just removed.
	 * A scope that opened already restored, or opened on a notification click,
	 * starts spent.
	 */
	const restoredScopes = useRef(
		new Set<TeamBridgeScope>(requestedAny || restoreOnOpen ? [scope] : []),
	);
	/*
	 * A REMEMBERED LANDING STAYS ISSUED UNTIL A RENDER SHOWS IT. `setTarget` from
	 * the landing effect is a passive-effect update, and a more urgent render (a
	 * query result arriving through React Query's external store) can commit
	 * first WITHOUT it - `target` still `null` - and re-run the landing effect.
	 * Measured in the Storybook flow: that re-run found the scope already spent
	 * and landed on #general over the restore. The pending landing is re-issued
	 * instead, and cleared by the first render whose target is not `null`.
	 */
	const pendingLanding = useRef<{
		scope: TeamBridgeScope;
		target: TeamBridgeTarget;
	} | null>(null);
	// The scope this render shows, for a write from a view that is unmounting.
	const currentScope = useRef(scope);
	currentScope.current = scope;
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
		if (!(requestedConversation || requestedRowType) || !requestedTenant)
			return;
		scopeChosen.current = true;
		// The click's conversation wins; this scope's memory is not re-offered.
		restoredScopes.current.add(asTeamBridgeTenantId(requestedTenant));
		pendingLanding.current = null;
		setScope(asTeamBridgeTenantId(requestedTenant));
		/*
		 * A deep link or notification click is a HUMAN target: it must take the
		 * reader out of the audit panel the same way a rail row or a quick view
		 * does, or the audit pane keeps the window while the target changes
		 * underneath it (agent review round 1, m2).
		 */
		clearOwnerAudit.current();
		const clicked: TeamBridgeTarget = requestedConversation
			? { type: "conversation", id: requestedConversation }
			: {
					type: requestedRowType as "person" | "chief",
					accountId: requestedRowAccount as string,
				};
		// A thread and a message live in a conversation; a person row names neither.
		const clickedThread =
			TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD && requestedConversation
				? threadTargetFromSearch(
						new URLSearchParams({
							tenant: requestedTenant,
							conversation: requestedConversation,
							...(requestedRoot ? { thread: requestedRoot } : {}),
						}),
					)
				: null;
		/*
		 * THE CLICK BECOMES THE REMEMBERED VIEW NOW, not when the view next reports.
		 * The parameters are cleared below, and an auth settlement can remount this
		 * container (`key={account.token}`) before the view has reported anything:
		 * that remount reads the memory, so without this write it restored the
		 * conversation the reader had BEFORE the click (measured in
		 * `team-bridge-view-restore.test.mjs`).
		 */
		const clickedScope = asTeamBridgeTenantId(requestedTenant);
		const storage = browserDraftStorage();
		const remembered = { target: clicked, thread: clickedThread };
		if (viewMemory.current.scope === clickedScope)
			viewMemory.current.view = remembered;
		/* No account yet, or storage refused the write (R4): carry it in memory. */
		const persisted =
			storage && accountId
				? writeViewMemory(storage, accountId, clickedScope, remembered)
				: false;
		if (!persisted)
			clickCarry.current = { scope: clickedScope, view: remembered };
		/*
		 * A PERSON OR CHIEF LINK IS CHECKED LIKE A REMEMBERED TARGET (agent review
		 * round 1, m1 on #1673). The palette builds these from a roster that can be
		 * stale by the time the page reads it - a member removed, a link from the
		 * other organization - and an unchecked one lands on an "Untitled" pane
		 * with nothing to send to. Handing it to the directory validation below
		 * falls back to the default view the way a stale remembered target does. A
		 * conversation link keeps the shipped behaviour (null): a notification's
		 * conversation is one the hub just told us about.
		 */
		restoredTarget.current = requestedConversation ? null : clicked;
		setTarget(clicked);
		setThreadLink(clickedThread);
		setMessageLink(
			requestedConversation && requestedMessage && !requestedRoot
				? {
						conversationId: requestedConversation,
						messageId: requestedMessage,
						fetched: false,
						newestRead: false,
					}
				: null,
		);
		setChannelFormOpen(false);
		setSearchParams({}, { replace: true });
	}, [
		requestedConversation,
		requestedRowType,
		requestedRowAccount,
		requestedTenant,
		requestedRoot,
		requestedMessage,
		setSearchParams,
		setMessageLink,
		accountId,
		clickCarry,
	]);

	// A conversation id and a person both belong to one organization; a scope
	// change clears the target so a stale thread is never shown under a new title.
	const changeScope = (next: TeamBridgeScope) => {
		scopeChosen.current = true;
		// The new scope's own remembered conversation lands (see the landing effect).
		restoredScopes.current.delete(next);
		pendingLanding.current = null;
		const storage = browserDraftStorage();
		if (storage && accountId) writeLastScope(storage, accountId, next);
		setScope(next);
		setThreadLink(null);
		setTarget(null);
		setChannelFormOpen(false);
	};

	/*
	 * THE ONE WRITE (spec 4.3). The switcher's pick is the only place a scope
	 * becomes a stored preference: a deep link, the automatic one-organization
	 * resolution and the implicit switch a union row makes are consequences, and
	 * deriving a default from them would make the landing unpredictable from
	 * anything the reader selected.
	 */
	const chooseOrganization = (next: TeamBridgeScope) => {
		const storage = browserDraftStorage();
		if (storage && accountId) writeScopePreference(storage, accountId, next);
		changeScope(next);
	};

	// The organization list (hub tenants, or memberships without them) resolves
	// after the first paint; adopt the only one unless
	// the reader has already picked a scope. A later unread poll re-renders the
	// options array, so the equality check keeps this to the one transition.
	// Before that list exists, the watcher's snapshot stands in - and the list
	// supersedes it the moment it answers (tb-instant-open).
	useEffect(() => {
		setScope((current) =>
			resolveOpeningScope({
				organizations,
				stored: storedScope,
				requestedTenant,
				chosen: scopeChosen.current,
				current,
				snapshotRows: openingRows,
			}),
		);
	}, [organizations, openingRows, storedScope, requestedTenant]);

	const visibleConversations = useMemo(
		() => visibleConversationRows(conversations, scope, organizations),
		[conversations, scope, organizations],
	);

	// Land on the first rail row once (built-ins lead), not on every refetch:
	// a poll must not move the reader out of the thread they are reading.
	//
	// The REMEMBERED view for this scope lands first: this is the path a switcher
	// pick takes (`changeScope` clears the target), so each organization reopens
	// on its own last conversation. The default is only for a scope with no
	// record; a record that no longer resolves is caught by the validation below.
	useEffect(() => {
		if (
			!ownerAudit?.active &&
			target === null &&
			visibleConversations.length > 0
		) {
			const pending = pendingLanding.current;
			if (pending?.scope === scope) {
				setTarget(pending.target);
				return;
			}
			const remembered = restoredScopes.current.has(scope)
				? null
				: viewMemory.current.view;
			restoredScopes.current.add(scope);
			if (remembered) {
				pendingLanding.current = { scope, target: remembered.target };
				restoredTarget.current = remembered.target;
				if (remembered.quickView === "archived") setArchivedOpened(true);
				setTarget(remembered.target);
				setThreadLink(
					TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD
						? rememberedThread(remembered)
						: null,
				);
				return;
			}
			const first = defaultLandingConversation(
				visibleConversations,
				organizations.map((row) => row.tenantId),
			);
			if (first) setTarget({ type: "conversation", id: first.id });
		}
	}, [visibleConversations, organizations, target, ownerAudit?.active, scope]);
	useEffect(() => {
		if (target !== null) pendingLanding.current = null;
	}, [target]);

	/*
	 * ARCHIVE / UNARCHIVE / DELETE. The archived read stays OFF until the
	 * Archived channels view is first opened (`archivedOpened`), so a reader who
	 * never looks never spends it; once opened it stays warm and every write
	 * refreshes it through the shared conversations prefix. It also turns on for
	 * a selection the live list does not hold (a deep link or a notification
	 * naming an archived channel), so that selection can resolve.
	 */
	const [archivedOpened, setArchivedOpened] = useState(
		() => restoreOnOpen?.quickView === "archived",
	);
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
	 * A REMEMBERED TARGET THAT NO LONGER RESOLVES FALLS BACK, SILENTLY. Only once
	 * every read that could hold it has answered: the live list (and, for a
	 * conversation, the archived read `selectionOutsideLive` turns on), or the
	 * organization's directory for a person/chief. Until then the remembered
	 * target stands - it is usually right, and correcting it early would be the
	 * #general flash this restore exists to remove. Identity, not equality: a
	 * target the reader picked since is never second-guessed.
	 *
	 * "Answered" means SETTLED, not merely cached: on a return the list cache
	 * still holds the rows from before the reader left, and confirming against
	 * them would bless a channel deleted while they were away - the refetch the
	 * page already makes on mount is the answer that counts.
	 */
	useEffect(() => {
		const remembered = restoredTarget.current;
		if (
			!remembered ||
			target !== remembered ||
			!list.isSuccess ||
			list.isFetching
		)
			return;
		const archivedSettled = !archivedList.isFetching;
		let resolved: boolean | undefined;
		if (remembered.type === "conversation") {
			if (visibleConversations.some((row) => row.id === remembered.id))
				resolved = true;
			else if (archivedList.isSuccess && archivedSettled)
				resolved = archivedRows.some((row) => row.id === remembered.id);
			else if (archivedList.isError && archivedSettled) resolved = false;
		} else if (remembered.type === "person" || remembered.type === "chief") {
			if (mergedView) resolved = false;
			else if (directory.isFetching) resolved = undefined;
			else if (directory.isSuccess)
				resolved = (directory.data?.members ?? []).some(
					(row) => row.account_id === remembered.accountId,
				);
			else if (directory.isError) resolved = true;
		} else resolved = true;
		if (resolved === undefined) return;
		restoredTarget.current = null;
		if (resolved) return;
		viewMemory.current = { scope, view: null };
		setThreadLink(null);
		setTarget(null);
	}, [
		target,
		list.isSuccess,
		list.isFetching,
		visibleConversations,
		archivedList.isSuccess,
		archivedList.isError,
		archivedList.isFetching,
		archivedRows,
		directory.isFetching,
		directory.isSuccess,
		directory.isError,
		directory.data,
		mergedView,
		scope,
	]);
	/*
	 * WRITE-THROUGH. The view reports where the reader is (target, thread pane,
	 * quick view, reading position) and this persists it under the scope it was
	 * reported in - the closure's `scope`, so a view unmounting across a scope
	 * change flushes into its OWN organization's record, never the next one's.
	 */
	const rememberView = (
		patch: Partial<TeamBridgeViewMemory> & { target: TeamBridgeTarget },
	) => {
		if (!accountId) return;
		const storage = browserDraftStorage();
		const view: TeamBridgeViewMemory = {
			target: patch.target,
			thread: patch.thread ?? null,
			quickView: patch.quickView ?? null,
			scroll: patch.scroll ?? null,
		};
		/* The in-session record updates even without storage (R3): within this
		   mount the reader's place still holds; only cross-mount memory is lost. */
		if (viewMemory.current.scope === scope) viewMemory.current.view = view;
		if (storage)
			writeViewMemory(storage, accountId, scope, view, currentScope.current);
	};
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
	const leaveConversation = useLeaveTeamBridgeConversation();
	const withdrawAgent = useWithdrawTeamBridgeAgent();
	const answerInvitation = useAnswerTeamBridgeInvitation();
	/* The conversation menu's partial-leave line and its members-open intent
	   live HERE because a leave or a row's "View members" moves the selection,
	   which remounts the view (see `TeamBridgePageView`'s props). */
	const [partialLeave, setPartialLeave] = useState<{
		conversationId: string;
		tenantId: string;
		name: string;
		endpointId?: string;
		retrying: boolean;
		retryFailed: boolean;
	} | null>(null);
	const [membersIntent, setMembersIntent] = useState<{
		conversationId: string;
		surface: "panel" | "add";
	} | null>(null);
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
	const agentNotify = useSetTeamBridgeAgentNotify(
		selected?.id,
		selected?.tenant_id,
	);
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
	const createHandoff = useRef<{
		key: string;
		viewKey: string;
		arrived: boolean;
	} | null>(null);

	const sendBody = async (
		body: string,
		clientRef: string,
		attachments?: {
			ids: readonly string[];
			files?: readonly string[];
			stageHeld?: (
				conversationId: string,
				tenantId: string | undefined,
			) => Promise<string[]>;
		},
		delivery?: TeamBridgeDelivery,
	) => {
		if (!isCurrentOwner())
			throw new Error("Team Bridge write authority changed");
		/*
		 * A QUEUED SEND NAMES ITS CONVERSATION. An optimistic send runs after the
		 * render that queued it, sometimes after the conversation it belongs to was
		 * created by the send in front of it; it posts there directly unless that is
		 * the selected conversation, whose bound mutation is the ordinary path.
		 */
		const into = delivery?.into;
		/*
		 * A BACKGROUND SEND NEVER RIDES THE SELECTED CONVERSATION'S MUTATION. That
		 * mutation belongs to the selection this view rendered with, and the row may
		 * outlive it (a first message turns a person into a DM, a group draft into a
		 * conversation). It also parks `send.isPending`, which disables the box: the
		 * composer must stay usable while a row is in flight, otherwise a second
		 * message could never be sent before the first came back.
		 */
		if (into && delivery) {
			const message = await TeamBridgeApi.send(into.conversationId, {
				clientRef,
				body,
				tenantId: into.tenantId,
				expectedAccountId: requireBridgeWriteAccount(accountId),
				attachmentIds: await sendAttachmentIds(
					attachments,
					into.conversationId,
					into.tenantId,
				),
				/* Captured at the press (`PendingSend.mentions`), never re-read from
				   the outbox here: see `TeamBridgeDelivery.mentions`. */
				files: attachments?.files,
				mentions: delivery.mentions,
			});
			/* Accepted: retire the staged entry as the mutation path does, so an
			   abandoned copy does not hold one of the outbox's 32 slots. */
			clearStagedMentions(into.conversationId, body);
			await refreshAfterSend(
				client,
				into.conversationId,
				into.tenantId,
				isCurrentOwner,
			);
			return message;
		}
		if (selected !== null) {
			/*
			 * @-MENTIONS ARE CAPTURED AT THE PRESS HERE TOO (review MINOR-1 on #1663).
			 * This is the picture path: the request is built only after the upload
			 * below, and an optimistic text send of the same words that lands during
			 * that upload clears the shared outbox entry (the `into` branch above), so
			 * the mutation's own late read posted the picture without its mentions.
			 * `submit` reaches this line with no await between the Send press and it,
			 * so reading the outbox BEFORE the upload is reading it at the press, the
			 * same rule as the optimistic lane. A 409 auto-retry is a new `onSend`
			 * call and captures again at its own start.
			 */
			const mentions = stagedMentions(selected.id, body);
			return send.mutateAsync({
				clientRef,
				body,
				mentions,
				// Held images stage into the selected conversation FIRST; a failed
				// upload throws here, so the text never posts alone (R1-01).
				attachmentIds: await sendAttachmentIds(
					attachments,
					selected.id,
					selected.tenant_id,
				),
				files: attachments?.files,
			});
		}
		const recipients = draftRecipients();
		const input = draftCreateInput(recipients);
		if (input === null) return undefined;
		const draftKey = `${mergedView ? "*" : scope}|${input.kind}|${recipients
			.map(recipientKey)
			.sort()
			.join(",")}`;
		const startedOn = target;
		/*
		 * THE CREATE'S OWN "SENDING" CHROME IS FOR SENDS THAT WAIT. An optimistic send
		 * already shows its row and keeps the box usable - a second message typed while
		 * the first conversation is being created must reach that same conversation
		 * (the lane queue), not sit behind a spinner.
		 */
		if (!delivery) {
			setCreating(true);
			setFirstSendFailed(false);
		}
		/* The stored message the post answers with: an optimistic row becomes it. */
		let posted: unknown;
		/*
		 * MOVE TO A NEW GROUP AS SOON AS IT EXISTS, and only if the reader is STILL on
		 * the draft that sent it. A person or chief target needs no move: the create's
		 * own list refresh has already resolved the same target to the new DM.
		 */
		let moved = false;
		const moveToCreated = (
			conversationId: string,
			createdTenant?: string | undefined,
		) => {
			if (moved || !isCurrentOwner()) return;
			moved = true;
			if (startedOn?.type === "compose" && targetRef.current === startedOn) {
				const next: TeamBridgeTarget = {
					type: "conversation",
					id: conversationId,
				};
				/*
				 * KEEP THE COMPOSE VIEW MOUNTED THROUGH ITS OWN CREATE (#1511). The view
				 * is keyed by account, tenant and target, so following a group draft onto
				 * the conversation it created used to remount the whole pane: the
				 * optimistic row, the composer and its focus were thrown away and
				 * rebuilt mid-send. Only this one transition keeps the mounted view, and
				 * only when the create's tenant is CONCRETE and equals the single-tenant
				 * scope the draft was written in: All organizations, a missing tenant
				 * or a foreign one still remount, because inferring a tenant there is
				 * exactly how one organization's draft could be shown in another.
				 */
				if (
					!mergedView &&
					typeof createdTenant === "string" &&
					createdTenant.length > 0 &&
					createdTenant === scope
				) {
					createHandoff.current = {
						key: viewKeyFor(accountId, createdTenant, next),
						viewKey: viewKeyFor(accountId, scope, startedOn),
						arrived: false,
					};
				}
				setTarget(next);
			}
		};
		try {
			const { id: conversationId } = await sendFirstMessage({
				draftKey,
				input,
				body,
				clientRef,
				tenantId: mergedView ? undefined : scope,
				remembered: createdForDraft.current,
				// The foreign-tenant refusal lives in `sendFirstMessage`, so this send
				// and `scheduleBody` (which reaches it through
				// `scheduleTeamBridgeDraft`) share one rule (#1511 review round 7, M1).
				create: (createInput) =>
					create.mutateAsync(createInput) as Promise<{
						id?: string;
						tenant_id?: string;
					}>,
				// Only an optimistic send moves early: its message is already on screen,
				// so the view can follow the conversation while the post is out. A
				// non-optimistic send (attachments) keeps the move after its post.
				onCreated: delivery
					? (created) => {
							delivery.onCreated?.(created.id, created.tenantId);
							moveToCreated(created.id, created.tenantId);
							/* THE RAIL IS THE CREATE'S BUSINESS, not the post's (requirement 6):
							   the row can appear as soon as the conversation exists. */
							void list.refetch();
						}
					: undefined,
				// Straight to the API rather than the selected conversation's
				// mutation hook: that hook is bound to the conversation selected at
				// RENDER time, which a just-created row is not yet. Held images are
				// staged INTO the new conversation first; a failed upload throws so
				// the message is never posted text-only behind the author's back.
				/*
				 * THE POST OUTLIVES THE PAGE; THE ACCOUNT FENCE DOES NOT BEND (QA Q1 on
				 * #1531). A first message is created and then posted. Checking
				 * `isCurrentOwner` here also asked "is this page still mounted", so a reader
				 * who left Team Bridge while the create was in flight got a conversation
				 * with nothing in it and a failed row on return. A send into an existing
				 * conversation already finishes in the background; this one now does too.
				 * An account switch or sign-out still refuses the post: that is the part
				 * that keeps one account's words out of another's conversations.
				 */
				/*
				 * NO `mentions` ON A FIRST MESSAGE, by construction rather than omission:
				 * the mention source is null until a conversation exists
				 * (`TeamBridgeMentionProvider`), so nothing was staged for this text, and
				 * an optimistic row only captures mentions when it already names a
				 * conversation - which routes it through the `into` branch above instead.
				 */
				post: async (id, message) => {
					if (!isWriteAuthorityCurrent())
						throw new Error("Team Bridge write authority changed");
					posted = await TeamBridgeApi.send(id, {
						...message,
						expectedAccountId: requireBridgeWriteAccount(accountId),
						attachmentIds: await sendAttachmentIds(
							attachments,
							id,
							message.tenantId,
						),
						files: attachments?.files,
					});
					return posted;
				},
			});
			/*
			 * A page that is gone has no view to move or refresh, but the post DID land:
			 * answer with the stored message so the optimistic row settles as `sent`
			 * rather than waiting on a refetch to claim it. Only an account change
			 * answers nothing.
			 */
			if (!isCurrentOwner())
				return isWriteAuthorityCurrent()
					? (posted ?? { id: conversationId })
					: undefined;
			moveToCreated(conversationId);
			await list.refetch();
			/* The thread's own read: the optimistic row's server copy is reconciled by
			   id from `posted`, and this refetch makes the page agree. */
			await refreshAfterSend(client, conversationId, undefined, isCurrentOwner);
			return posted ?? { id: conversationId };
		} catch (error) {
			if (isCurrentOwner()) setFirstSendFailed(true);
			throw error;
		} finally {
			if (!delivery && isCurrentOwner()) setCreating(false);
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
			files?: readonly string[];
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

	const newest = messages.messages.reduce<number | undefined>(
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

	/*
	 * LAND ON THE CLICKED MESSAGE, NEVER ON A STALE PAGE. The watcher wrote the
	 * message into this exact cache entry before raising the banner, so the
	 * normal case paints it in the first frame with no request. A link can point
	 * either way, and the two directions need different reads: a message NEWER
	 * than the cached page is found by ONE re-read of that one key (the common
	 * case - a click on a recent notification), and a message OLDER than it is
	 * found by paging back (the walk below). Until one of them finds it the
	 * timeline shows its loading state rather than the stale page, and it shows
	 * whatever the server has when both are done: a message deleted in between
	 * must not hold a spinner forever.
	 */
	const linkedConversation =
		messageLink !== null && selected?.id === messageLink.conversationId;
	const linkedPresent =
		linkedConversation &&
		messages.messages.some((message) => message.id === messageLink.messageId);
	const awaitingLinkedMessage =
		linkedConversation && !linkedPresent && !messageLink.fetched;
	/*
	 * A LINK TO OLD HISTORY IS FOUND BY PAGEING BACK TO IT (agent review round 1,
	 * M3). The fallback used to re-read the NEWEST page, which cannot carry a
	 * message older than one page: `linkedPresent` stayed false, the link was
	 * dropped as "fetched", and the reader landed on the timeline with no scroll
	 * and no highlight - silently, within the 8 s bound. The window's own cursor
	 * is the right tool: ask for the page before the oldest retained row, repeat
	 * while the walk is making progress, and stop when the row appears, the
	 * history ends, or the walk has covered `MESSAGE_LINK_MAX_PAGES` pages
	 * (780 rows at the shipped page size - kept inside the retained window, see
	 * the constant).
	 */
	const linkedPages = useRef(0);
	const linkedReadFor = useRef<string | null>(null);
	/* The link id whose newest-page re-read is in flight (below). */
	const linkedNewestInFlight = useRef<string | null>(null);
	/*
	 * A POST-UNMOUNT WRITE IS THE ONLY ONE WORTH SUPPRESSING (agent review round 4,
	 * R4-1). `main` scoped this flag to the effect run, which held there because
	 * that effect's dependencies did not move mid-read; this one depends on the
	 * hook's own loading and older-page state, so a re-run while the newest read
	 * was in flight would have cleared the flag and left the completion unwritten -
	 * the walk would then never start. The flag follows the COMPONENT instead, and
	 * `linkedNewestInFlight` is what keeps the read to one per link.
	 */
	const linkedReadLive = useRef(true);
	useEffect(() => {
		linkedReadLive.current = true;
		return () => {
			linkedReadLive.current = false;
		};
	}, []);
	useEffect(() => {
		if (!messageLink || messageLink.fetched || !selected || !selfAccountId)
			return;
		if (selected.id !== messageLink.conversationId) return;
		if (messages.isPending || linkedPresent) {
			linkedReadFor.current = messageLink.messageId;
			linkedPages.current = 0;
			return;
		}
		if (linkedReadFor.current !== messageLink.messageId) {
			linkedReadFor.current = messageLink.messageId;
			linkedPages.current = 0;
		}
		/*
		 * A LINK POINTS EITHER WAY (agent review round 4, R4-1). This effect used to
		 * hold only the walk below, so a message NEWER than the cached page was never
		 * read: with `hasOlder: false` nothing was read at all, and with it the walk
		 * only pages backwards - the row arrived with the 8 s poll, which is exactly
		 * the "clicked the notification and it appeared seconds later" report of
		 * 2026-10-30. One newest-page read answers that direction, and the walk keeps
		 * the other.
		 *
		 * IT IS SEQUENCED ON ITS OWN PROMISE, not on a re-render it may never cause
		 * (agent review round 2, m5): a newest read that changes nothing - or fails -
		 * must still hand over to the walk, and must never leave the link pending.
		 * `newestRead` is link state, so flipping it re-runs this effect; a bare ref
		 * would not.
		 */
		if (!messageLink.newestRead) {
			if (linkedNewestInFlight.current === messageLink.messageId) return;
			linkedNewestInFlight.current = messageLink.messageId;
			void client
				.fetchQuery({
					...teamBridgeMessagesQueryOptions(
						client,
						selected.id,
						selected.tenant_id,
						selfAccountId,
					),
					staleTime: 0,
				})
				.catch(() => undefined)
				.finally(() => {
					if (linkedNewestInFlight.current === messageLink.messageId)
						linkedNewestInFlight.current = null;
					if (!linkedReadLive.current) return;
					setMessageLink((link: TeamBridgeMessageLink | null) =>
						link && link.messageId === messageLink.messageId
							? { ...link, newestRead: true }
							: link,
					);
				});
			return;
		}
		/*
		 * IN FLIGHT IS NOT "THE WALK IS SPENT" (agent review round 3, M3-a). The
		 * terminal branch below used to be shared with the pending state - the
		 * effect re-runs when `isLoadingOlder` flips true, the guard failed, and the
		 * link was marked `fetched` after ONE page, so a `?message=` link only
		 * resolved when the row was already inside the newest page. Waiting is the
		 * whole point of the walk: the mutation's re-render is what decides next.
		 */
		if (messages.isLoadingOlder) return;
		if (messages.hasOlder && linkedPages.current < MESSAGE_LINK_MAX_PAGES) {
			linkedPages.current += 1;
			/*
			 * A READ THAT WRITES NOTHING MUST STILL FINISH THE WALK (agent review
			 * round 2, m5). `loadOlder()` is a no-op when the conversation's entry was
			 * evicted between this render and the call: the mutation resolves without a
			 * write, no re-render follows, and a walk that waited for one kept the
			 * timeline in its "landing on the linked message" state for the life of the
			 * mount. The old `.finally()` always resolved; this restores that, without
			 * ending the walk when the page DID arrive (the merge re-renders and the
			 * effect decides again).
			 */
			void Promise.resolve(messages.loadOlder())
				.then((page) => {
					if (page === null)
						setMessageLink((link: TeamBridgeMessageLink | null) =>
							link ? { ...link, fetched: true } : link,
						);
				})
				.catch(() => undefined);
			return;
		}
		/* Nothing older to read, or the walk is spent: the link is finished. A
		   message deleted in between must not hold a spinner forever. */
		setMessageLink((link: TeamBridgeMessageLink | null) =>
			link ? { ...link, fetched: true } : link,
		);
	}, [
		messageLink,
		selected,
		selfAccountId,
		client,
		messages.isPending,
		messages.hasOlder,
		messages.isLoadingOlder,
		messages.loadOlder,
		linkedPresent,
		setMessageLink,
	]);
	// The highlight is a moment, not a state: drop it once the fade has run.
	useEffect(() => {
		if (!linkedPresent) return;
		const timer = setTimeout(() => setMessageLink(null), JUMP_HIGHLIGHT_MS);
		return () => clearTimeout(timer);
	}, [linkedPresent, setMessageLink]);
	// A link the reader navigated away from, or one that never appeared after
	// its one re-read, is finished.
	useEffect(() => {
		if (!messageLink) return;
		if (
			(selected !== null && selected.id !== messageLink.conversationId) ||
			(messageLink.fetched && !linkedPresent)
		)
			setMessageLink(null);
	}, [messageLink, selected, linkedPresent, setMessageLink]);
	/*
	 * A LINKED CONVERSATION THAT NEVER RESOLVES IS RELEASED TOO (review round 1,
	 * m3). The effect above can only clear on progress, and the fetch effect
	 * returns early while nothing is selected, so a target whose conversation the
	 * rail never resolves would sit in state - and in the carry - forever.
	 */
	useEffect(() => {
		if (!messageLink) return;
		const timer = setTimeout(
			() => setMessageLink(null),
			MESSAGE_LINK_TIMEOUT_MS,
		);
		return () => clearTimeout(timer);
	}, [messageLink, setMessageLink]);

	const draftKey = viewKeyFor(accountId, selected?.tenant_id ?? scope, target);
	const draftJournal = drafts.get(draftKey) ?? { body: "" };
	drafts.set(draftKey, draftJournal);
	/*
	 * The one-shot create handoff (see `moveToCreated`). It holds while the view is
	 * on the compose key or the exact created destination; the first render on any
	 * other key - another target, account or tenant, or leaving the destination it
	 * already reached - drops it for good, so away-and-back remounts as before.
	 *
	 * This mutates a ref DURING RENDER, so it must stay idempotent: rendering the
	 * same key twice (StrictMode, a discarded concurrent render) has to leave the
	 * ref exactly as one render would. Add no counters or order-dependent steps
	 * here (review round 7, n1).
	 */
	const handoff = createHandoff.current;
	if (handoff) {
		if (draftKey === handoff.key) handoff.arrived = true;
		else if (handoff.arrived || draftKey !== handoff.viewKey)
			createHandoff.current = null;
	}
	const rememberedTargetKey = viewMemory.current.view
		? draftTargetKey(viewMemory.current.view.target)
		: null;
	const viewKey =
		createHandoff.current?.key === draftKey
			? createHandoff.current.viewKey
			: draftKey;
	return (
		<>
			<TeamBridgePageView
				ownerAudit={ownerAudit}
				key={viewKey}
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
				sendMentionsCapabilityState={desktopFeatureState(
					capabilities.data,
					"team_bridge_send_mentions",
				)}
				agentNotifyCapabilityState={desktopFeatureState(
					capabilities.data,
					"team_bridge_agent_notify",
				)}
				onCloseThread={() => setThreadLink(null)}
				/* The remembered quick view and reading position apply only to the
				   target they were recorded on: a view mounted for any other target
				   opens as before (timeline at the newest message). */
				initialQuickView={
					rememberedTargetKey !== null &&
					target !== null &&
					rememberedTargetKey === draftTargetKey(target)
						? (viewMemory.current.view?.quickView ?? null)
						: null
				}
				initialScroll={rememberedScroll(viewMemory.current.view, target)}
				onViewMemory={rememberView}
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
						: messages.isPending || awaitingLinkedMessage
							? "loading"
							: messages.isError
								? isNotAMemberRefusal(messages.error)
									? "forbidden"
									: "error"
								: "ready"
				}
				conversations={conversations}
				target={target}
				messages={messages.messages}
				events={messages.events}
				/* PROXIMITY PAGING: the list decides WHEN from scroll position, so the
				   page hands it the state and the read rather than listening itself. */
				olderPaging={{
					hasOlder: messages.hasOlder,
					loadingOlder: messages.isLoadingOlder,
					onLoadOlder: messages.loadOlder,
				}}
				highlightMessageId={linkedPresent ? messageLink?.messageId : null}
				organizations={organizations}
				scope={scope}
				totalUnread={unread.data ? unreadView.total : 0}
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
				agentNotifyFailed={notifyFailureIsVisible(
					agentNotify,
					selected?.id ?? null,
				)}
				onJoin={() => {
					if (isCurrentOwner()) join.mutate(undefined);
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
				onAgentNotifyChange={(next) => {
					if (!isCurrentOwner() || selected === null) return;
					agentNotify.mutate({
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
				onMenuJoin={(conversation) => {
					if (!isCurrentOwner()) return;
					join.mutate({
						conversationId: conversation.id,
						tenantId: conversation.tenant_id,
					});
				}}
				onMenuNotifyChange={(conversation, next) => {
					if (!isCurrentOwner()) return;
					notify.mutate({
						conversationId: conversation.id,
						tenantId: conversation.tenant_id,
						notify: next,
					});
				}}
				onMenuLeave={(conversation) => {
					if (!isCurrentOwner())
						return Promise.reject(
							new Error("Team Bridge write authority changed"),
						);
					const input = {
						conversationId: conversation.id,
						tenantId: conversation.tenant_id,
					};
					setPartialLeave(null);
					/* THE AGENT CASCADE (hub owner contract, H4 slice): with
					   `team_bridge_leave_withdraws_agent` advertised the hub withdraws the
					   agent itself, so leave is the only call; without it the client
					   withdraws the reader's own ACTIVE agent row (read now, before the
					   leave changes the cache) as a second write. */
					return leaveWithAgentCascade({
						leave: () => leaveConversation.mutateAsync(input),
						withdraw: (endpointId) =>
							withdrawAgent.mutateAsync({
								...input,
								endpointId,
								key: `withdraw:${endpointId ?? ""}`,
							}),
						serverWithdrawsAgent:
							desktopFeatureState(
								capabilities.data,
								"team_bridge_leave_withdraws_agent",
							) === "enabled",
						ownActiveAgent: ownActiveAgent(conversation, accountId),
						builtin: conversation.builtin,
					}).then((outcome) => {
						if (outcome.status === "partial")
							setPartialLeave({
								conversationId: conversation.id,
								tenantId: conversation.tenant_id,
								name:
									conversationTitle(conversation, accountId) ??
									t("ui.teamBridge.list.untitled"),
								endpointId: outcome.endpointId,
								retrying: false,
								retryFailed: false,
							});
						return outcome;
					});
				}}
				partialLeave={partialLeave ?? undefined}
				onRetryPartialLeave={() => {
					if (!partialLeave || partialLeave.retrying || !isCurrentOwner())
						return;
					const failed = partialLeave;
					setPartialLeave({ ...failed, retrying: true, retryFailed: false });
					withdrawAgent
						.mutateAsync({
							conversationId: failed.conversationId,
							tenantId: failed.tenantId,
							endpointId: failed.endpointId,
							key: `withdraw:${failed.endpointId ?? ""}`,
						})
						.then(
							() => setPartialLeave(null),
							(error: unknown) =>
								/* Nothing left to withdraw is the state the reader asked for. */
								withdrawAlreadyDone(error)
									? setPartialLeave(null)
									: setPartialLeave({
											...failed,
											retrying: false,
											retryFailed: true,
										}),
						);
				}}
				onDismissPartialLeave={() => setPartialLeave(null)}
				onMenuOwnAgent={(conversation, request) => {
					/* Self-scoped like the members panel's: `ownAgentRequest` has already
					   refused any endpoint that is not the reader's own, and the hub
					   re-checks. */
					if (!isCurrentOwner())
						return Promise.reject(
							new Error("Team Bridge write authority changed"),
						);
					const input = {
						conversationId: conversation.id,
						tenantId: conversation.tenant_id,
					};
					switch (request.op) {
						case "withdraw":
							return withdrawAgent.mutateAsync({
								...input,
								endpointId: request.endpointId,
								key: `withdraw:${request.endpointId ?? ""}`,
							});
						case "decline":
						case "accept":
							/* `accept` re-admits a withdrawn agent to #general (consent with
							   consent_version); `decline` answers a pending invitation. */
							return answerInvitation.mutateAsync({
								...input,
								decision: request.op,
								endpointId: request.endpointId,
							});
						case "add":
							if (!canInviteMembers(conversation, accountId))
								return Promise.reject(
									new Error("Team Bridge write authority changed"),
								);
							/* The reader's own agent joins at once on invite (the hub
							   activates an owner's own endpoint without a consent step). */
							return addMembers.mutateAsync({
								...input,
								members: [request.member],
								key: "add",
							});
					}
				}}
				onOpenMembersFor={(conversation, surface) => {
					/* Selecting remounts the view; the open intent rides across it. */
					setMembersIntent({ conversationId: conversation.id, surface });
					restoredScopes.current.add(scope);
					setThreadLink(null);
					setChannelFormOpen(false);
					setTarget({ type: "conversation", id: conversation.id });
				}}
				initialMembersPanelOpen={
					membersIntent?.surface === "panel" &&
					membersIntent.conversationId === selected?.id
				}
				initialMembersOpen={
					membersIntent?.surface === "add" &&
					membersIntent.conversationId === selected?.id
				}
				onMemberSelfAction={(conversation, action, endpointId) => {
					/* Self-scoped: the hub checks the row is the caller's own, so the
					   only client fence is the captured owner. */
					if (!isCurrentOwner())
						return Promise.reject(
							new Error("Team Bridge write authority changed"),
						);
					const input = {
						conversationId: conversation.id,
						tenantId: conversation.tenant_id,
					};
					if (action === "leave") return leaveConversation.mutateAsync(input);
					if (action === "withdraw")
						return withdrawAgent.mutateAsync({
							...input,
							endpointId,
							key: `withdraw:${endpointId ?? ""}`,
						});
					return answerInvitation.mutateAsync({
						...input,
						decision: "decline",
						endpointId,
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
					/* A union row calls `changeScope` then this in one handler: the
					   reader's pick wins over the scope's remembered landing. */
					if (next) restoredScopes.current.add(scope);
					setThreadLink(null);
					setChannelFormOpen(false);
					// A members-open intent belongs to the row it was asked for only.
					setMembersIntent(null);
					/* `null` is a landing with nothing left to land on: the default-landing
					   effect above then picks #general (or #humans, or the first row) once,
					   as at load. */
					setTarget(next);
				}}
				onSend={sendBody}
				attachmentCapability={attachmentCapability(status.data)}
				filesCapability={filesCapability(status.data)}
				recordingProbe={recordingProbe}
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
				directoryErrors={directoriesRead.errors}
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
				readOnlyExplained={trialNote.paused}
				notice={
					<>
						{trialNote.note}
						<TeamBridgeDefaultOnBanner status={status.data} />
					</>
				}
				noOrgPanel={
					trialEnded ? (
						<TeamBridgeTrialEndedPanel
							tenantId={trialEnded.tenantId}
							endedAt={trialEnded.endedAt}
						/>
					) : (
						<TeamBridgeTrialEmpty
							fallback={<TeamBridgeEligibilityPanel reason="plan_required" />}
						/>
					)
				}
				onRetry={() => {
					void list.refetch();
					if (memberships.isError) void memberships.refetch();
				}}
				onScopeChange={changeScope}
				onChooseOrganization={chooseOrganization}
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
