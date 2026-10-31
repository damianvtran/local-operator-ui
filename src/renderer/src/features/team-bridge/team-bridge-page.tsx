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
import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { Button } from "@shared/components/ui/button";
import { ScrollArea } from "@shared/components/ui/scroll-area";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { formatRelativeTime, t } from "@shared/i18n";
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
	Hash,
	MailPlus,
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
import { TeamBridgeMentionProvider } from "./mentions";
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
import { TeamBridgeComposeBar } from "./team-bridge-compose-bar";
import { TeamBridgeComposer } from "./team-bridge-composer";
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
import { useReportTeamBridgeViewing } from "./team-bridge-viewing";
import { useStickToBottom } from "./use-stick-to-bottom";
import {
	refreshAfterSend,
	teamBridgeKeys,
	teamBridgeMessagesQueryOptions,
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
	useSetTeamBridgeAgentNotify,
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

/**
 * Where a background (optimistic) send goes, decided when it RUNS rather than when
 * the view rendered: a message queued behind a first send posts into the
 * conversation that send created (`into`), and the container reports a create the
 * moment it lands (`onCreated`) so the view and the rail move before the post.
 */
export type TeamBridgeDelivery = {
	into?: { conversationId: string; tenantId: string | undefined };
	onCreated?: (conversationId: string, tenantId: string | undefined) => void;
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
		delivery?: TeamBridgeDelivery,
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
	onTarget,
	onSend,
	onSchedule,
	attachmentCapability: imageCapability = null,
	onNewChannel,
	onRetry,
	onScopeChange,
	onChooseOrganization,
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
	const timeline = useStickToBottom({
		resetKey: `${shown?.tenant_id ?? ""}:${shown?.id ?? ""}:${messageState}:${quickView ?? ""}`,
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
		if (attachments.length === 0 && selfSender && target) {
			const held = pendingEntries.find(
				(row) =>
					row.status === "failed" &&
					row.clientRef === clientRef &&
					row.owner === (selfAccountId ?? ""),
			);
			/* A press that retries a FAILED row is that row, not a second one: same
			   key, same place, back to pending. */
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
			await onSend(body, clientRef, stagedForSend(attachments));
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
						await onSend(body, freshRef, stagedForSend(attachments));
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

	const pageBody = (
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
						onScopeChange={onChooseOrganization ?? onScopeChange}
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
										const headingId = orgGroupHeadingId(
											"people",
											group.tenantId,
										);
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
														aria-labelledby={
															groupedUnion ? headingId : undefined
														}
													>
														{group.members.map((member) => (
															<PersonRailRow
																hasDraft={Boolean(
																	draftTextAt(
																		group.tenantId,
																		`person:${member.account_id}`,
																	).trim(),
																)}
																key={orgRowKey(
																	group.tenantId,
																	member.account_id,
																)}
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
										const headingId = orgGroupHeadingId(
											"chiefs",
											group.tenantId,
										);
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
														aria-labelledby={
															groupedUnion ? headingId : undefined
														}
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
											ownAgent={
												agentNotifyCapabilityState === "enabled"
													? ownAgentMenuState(shown, selfAccountId)
													: undefined
											}
											onAgentNotifyChange={onAgentNotifyChange}
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
						{shownTopicKey && (
							<p className="px-5 pb-1 text-[12px] text-ink-dim">
								{t(shownTopicKey)}
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
								) : messageState === "loading" && merged.localCount === 0 ? (
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
								<p className="shrink-0 px-5 pb-4 text-[12px] text-ink-dim leading-snug">
									{t("ui.teamBridge.read_only.composer")}
								</p>
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
											sending
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
	   cached directory and the open conversation (mentions/). Bound as a const
	   above so mounting the provider does not re-indent the page. */
	return (
		<TeamBridgeMentionProvider
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
	// Remount immediately at the real auth transition, before stale TB status can
	// render. Retain only original-owner data; never carry an A callback into B.
	return (
		<TeamBridgeOwnedPage
			key={account.token}
			accountId={account.accountId}
			drafts={drafts.current}
			receipts={receipts.current}
			messageLinkCarry={messageLink}
		/>
	);
};

type TeamBridgeMessageLink = {
	conversationId: string;
	messageId: string;
	fetched: boolean;
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

const TeamBridgeOwnedPage: FC<{
	accountId?: string;
	messageLinkCarry: { current: TeamBridgeMessageLink | null };
	drafts: Map<string, OwnedDraft>;
	receipts: Map<
		string,
		Map<string, { id: string; tenantId: string | undefined }>
	>;
}> = ({ accountId, drafts, receipts, messageLinkCarry }) => {
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
						}
					: requestedConversation
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
	const [threadLink, setThreadLink] = useState<ThreadTarget | null>(() =>
		/* THE HOLD: a `?thread=` deep link (a notification click, a shared link)
		   must not become a thread target in this build. The conversation still
		   opens - that is the click's other half - and no selection is left
		   behind for a later render to mount. */
		TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD
			? threadTargetFromSearch(searchParams)
			: null,
	);
	/*
	 * THE READER'S LAST SWITCHER PICK seeds the first paint, synchronously, so a
	 * multi-organization account lands where it left off rather than on the union
	 * and then correcting. The stored value only decides this page's START:
	 * `resolveOpeningScope` still validates it against the memberships once they
	 * answer, and only an explicit switcher pick writes it.
	 */
	const storedScope = useMemo(() => {
		const storage = browserDraftStorage();
		return storage && accountId
			? readScopePreference(storage, accountId)
			: undefined;
	}, [accountId]);
	const [scope, setScope] = useState<TeamBridgeScope>(() =>
		requestedTenant
			? asTeamBridgeTenantId(requestedTenant)
			: (storedScope ?? TEAM_BRIDGE_ALL_SCOPE),
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
		setMessageLink(
			requestedMessage && !requestedRoot
				? {
						conversationId: requestedConversation,
						messageId: requestedMessage,
						fetched: false,
					}
				: null,
		);
		setChannelFormOpen(false);
		setSearchParams({}, { replace: true });
	}, [
		requestedConversation,
		requestedTenant,
		requestedRoot,
		requestedMessage,
		setSearchParams,
		setMessageLink,
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
	useEffect(() => {
		if (
			!ownerAudit?.active &&
			target === null &&
			visibleConversations.length > 0
		) {
			const first = defaultLandingConversation(
				visibleConversations,
				organizations.map((row) => row.tenantId),
			);
			if (first) setTarget({ type: "conversation", id: first.id });
		}
	}, [visibleConversations, organizations, target, ownerAudit?.active]);

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
			});
			await refreshAfterSend(
				client,
				into.conversationId,
				into.tenantId,
				isCurrentOwner,
			);
			return message;
		}
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
		const moveToCreated = (conversationId: string) => {
			if (moved || !isCurrentOwner()) return;
			moved = true;
			if (startedOn?.type === "compose" && targetRef.current === startedOn) {
				setTarget({ type: "conversation", id: conversationId });
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
							moveToCreated(created.id);
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

	/*
	 * LAND ON THE CLICKED MESSAGE, NEVER ON A STALE PAGE. The watcher wrote the
	 * message into this exact cache entry before raising the banner, so the
	 * normal case paints it in the first frame with no request. If the entry
	 * still lacks it (evicted, or a click from a banner older than this
	 * document), the timeline shows its loading state rather than the stale
	 * page, re-reads that one key once, and then shows whatever the server has:
	 * a message deleted in between must not hold a spinner forever.
	 */
	const linkedConversation =
		messageLink !== null && selected?.id === messageLink.conversationId;
	const linkedPresent =
		linkedConversation &&
		(messages.data?.messages.some(
			(message) => message.id === messageLink.messageId,
		) ??
			false);
	const awaitingLinkedMessage =
		linkedConversation && !linkedPresent && !messageLink.fetched;
	useEffect(() => {
		if (!messageLink || messageLink.fetched || !selected || !selfAccountId)
			return;
		if (selected.id !== messageLink.conversationId) return;
		if (messages.isPending || linkedPresent) return;
		let current = true;
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
				if (current)
					setMessageLink((link: TeamBridgeMessageLink | null) =>
						link ? { ...link, fetched: true } : link,
					);
			});
		return () => {
			current = false;
		};
	}, [
		messageLink,
		selected,
		selfAccountId,
		messages.isPending,
		linkedPresent,
		client,
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

	const draftKey = JSON.stringify([
		accountId,
		selected?.tenant_id ?? scope,
		target,
	]);
	const draftJournal = drafts.get(draftKey) ?? { body: "" };
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
				sendMentionsCapabilityState={desktopFeatureState(
					capabilities.data,
					"team_bridge_send_mentions",
				)}
				agentNotifyCapabilityState={desktopFeatureState(
					capabilities.data,
					"team_bridge_agent_notify",
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
				messages={messages.data?.messages ?? []}
				events={messages.data?.events}
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
					   effect above then picks #general (or #humans, or the first row) once,
					   as at load. */
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
				notice={<TeamBridgeDefaultOnBanner status={status.data} />}
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
