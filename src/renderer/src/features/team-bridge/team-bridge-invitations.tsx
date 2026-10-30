/**
 * The Invitations quick view: your agent's pending channel/group invitations.
 *
 * WHY. An agent a teammate adds to a conversation stays `invited` until its
 * OWNER accepts (agent-server `Consent`, by design: an agent never consents for
 * itself). Before this view no surface called the consent op and nothing said
 * an invitation was waiting, so agents sat invited forever. The rail shows a
 * quiet count only when there is something to answer (`TeamBridgePageView`).
 *
 * The consent copy is LOCAL because agent-server does not serve the
 * participation text yet (`TEAM_BRIDGE_AGENT_PARTICIPATION_VERSION`). It states
 * what the owner is agreeing to: the agent can read and post in the
 * conversation from now on, it is woken for every message and decides itself
 * whether to reply (an @-mention means it should), and the owner can narrow it
 * to @-mentions or mute it from the conversation menu ("Your agent"). The hub
 * sets the accepted agent's level to `all`; this view never writes it.
 *
 * Split container/view like Scheduled, so stories render every state without a
 * transport: the container owns the mutation, the view owns presentation.
 */
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Hash, Users } from "lucide-react";
import { useRef, useState } from "react";
import {
	type InvitationFailureKind,
	TEAM_BRIDGE_AGENT_PARTICIPATION_CONSENT_KEY,
	type TeamBridgeInvitation,
	invitationFailureKind,
	stableInvitationRows,
} from "./team-bridge-invitations-model";
import { useAnswerTeamBridgeInvitation } from "./use-team-bridge";

/** Where one row stands: untouched, in flight, answered, or refused. */
export type TeamBridgeInvitationRowState =
	| { phase: "idle" }
	| { phase: "pending"; decision: "accept" | "decline" }
	| { phase: "done"; decision: "accept" | "decline" }
	| { phase: "failed"; kind: InvitationFailureKind };

const FAILURE_COPY: Record<InvitationFailureKind, () => string> = {
	agent_unavailable: () =>
		t("ui.teamBridge.invitations.failed.agent_unavailable"),
	already_answered: () =>
		t("ui.teamBridge.invitations.failed.already_answered"),
	gone: () => t("ui.teamBridge.invitations.failed.gone"),
	outdated: () => t("ui.teamBridge.invitations.failed.outdated"),
	runtime_outdated: () =>
		t("ui.teamBridge.invitations.failed.runtime_outdated"),
	not_available: () => t("ui.teamBridge.invitations.failed.not_available"),
	sign_in: () => t("ui.teamBridge.invitations.failed.sign_in"),
	unreachable: () => t("ui.teamBridge.invitations.failed.unreachable"),
	unconfirmed: () => t("ui.teamBridge.invitations.failed.unconfirmed"),
};

/** A refusal that a second press cannot change: the row offers no retry. */
const FINAL_FAILURES: ReadonlySet<InvitationFailureKind> = new Set([
	"already_answered",
	"gone",
	"outdated",
	"runtime_outdated",
]);

/** The sentence a failed row shows, exposed for the copy tests. */
export function invitationFailureCopy(kind: InvitationFailureKind): string {
	return FAILURE_COPY[kind]();
}

/** Whether a failed row may be answered again. */
export function invitationRetryable(kind: InvitationFailureKind): boolean {
	return !FINAL_FAILURES.has(kind);
}

/** The "who" line, or null when the server names nobody. */
export function invitationInviterLine(
	inviter: TeamBridgeInvitation["inviter"],
): string | null {
	if (!inviter) return null;
	if (inviter.self)
		return inviter.role === "added"
			? t("ui.teamBridge.invitations.added_by_you")
			: t("ui.teamBridge.invitations.created_by_you");
	return inviter.role === "added"
		? t("ui.teamBridge.invitations.added_by", { name: inviter.name })
		: t("ui.teamBridge.invitations.created_by", { name: inviter.name });
}

export function TeamBridgeInvitations({
	invitations,
	listState,
	onRetry,
	readOnly = false,
	organizationNames,
}: {
	invitations: readonly TeamBridgeInvitation[];
	listState: "loading" | "error" | "ready";
	onRetry?: () => void;
	readOnly?: boolean;
	organizationNames?: Readonly<Record<string, string>>;
}) {
	const answer = useAnswerTeamBridgeInvitation();
	const [states, setStates] = useState<
		Record<string, TeamBridgeInvitationRowState>
	>({});
	/*
	 * Rows stay where they were while the view is open (see
	 * `stableInvitationRows`): the optimistic patch drops an answered row from
	 * the pending set at once, and the list must not slide under the pointer.
	 */
	const shown = useRef<TeamBridgeInvitation[]>([]);
	const answered = new Set(
		Object.entries(states)
			.filter(([, state]) => state.phase !== "idle")
			.map(([key]) => key),
	);
	shown.current = stableInvitationRows(shown.current, invitations, answered);
	const respond = (
		invitation: TeamBridgeInvitation,
		decision: "accept" | "decline",
	) => {
		setStates((prev) => ({
			...prev,
			[invitation.key]: { phase: "pending", decision },
		}));
		/*
		 * The PROMISE, not `mutate`'s per-call callbacks: React Query fires those
		 * only for the observer's latest call, so answering a second row while
		 * the first is in flight would strand the first one on "Accepting".
		 */
		answer
			.mutateAsync({
				conversationId: invitation.conversationId,
				tenantId: invitation.tenantId,
				decision,
			})
			.then(
				() =>
					setStates((prev) => ({
						...prev,
						[invitation.key]: { phase: "done", decision },
					})),
				(error: unknown) =>
					setStates((prev) => ({
						...prev,
						[invitation.key]: {
							phase: "failed",
							kind: invitationFailureKind(error),
						},
					})),
			);
	};
	return (
		<TeamBridgeInvitationsView
			invitations={shown.current}
			rowStates={states}
			listState={listState}
			onRetry={onRetry}
			readOnly={readOnly}
			organizationNames={organizationNames}
			onAnswer={respond}
		/>
	);
}

/** Presentational states, shared with stories: no transport, no hidden retries. */
export function TeamBridgeInvitationsView({
	invitations,
	rowStates = {},
	listState,
	onRetry,
	readOnly = false,
	organizationNames = {},
	onAnswer,
}: {
	invitations: readonly TeamBridgeInvitation[];
	rowStates?: Readonly<Record<string, TeamBridgeInvitationRowState>>;
	listState: "loading" | "error" | "ready";
	onRetry?: () => void;
	readOnly?: boolean;
	organizationNames?: Readonly<Record<string, string>>;
	onAnswer: (
		invitation: TeamBridgeInvitation,
		decision: "accept" | "decline",
	) => void;
}) {
	useI18nLocale();
	return (
		<section
			className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-5"
			aria-label={t("ui.teamBridge.invitations.title")}
		>
			<h2 className="text-lg font-medium text-ink">
				{t("ui.teamBridge.invitations.title")}
			</h2>
			<p className="max-w-prose text-sm text-ink-muted">
				{t(TEAM_BRIDGE_AGENT_PARTICIPATION_CONSENT_KEY)}
			</p>
			{/* Disabled answers state their reason once, not per card (design D6). */}
			{readOnly && invitations.length > 0 && (
				<p className="max-w-prose text-sm text-ink-muted">
					{t("ui.teamBridge.invitations.read_only")}
				</p>
			)}
			{listState === "loading" && invitations.length === 0 ? (
				<Spinner size="sm" label={t("ui.teamBridge.invitations.loading")} />
			) : listState === "error" && invitations.length === 0 ? (
				<div role="alert" className="flex flex-col items-start gap-2">
					<p className="text-sm text-ink-muted">
						{t("ui.teamBridge.invitations.load_failed")}
					</p>
					{onRetry && (
						<Button size="sm" variant="ghost" onClick={onRetry}>
							{t("ui.teamBridge.list.retry")}
						</Button>
					)}
				</div>
			) : invitations.length === 0 ? (
				<p className="text-sm text-ink-muted">
					{t("ui.teamBridge.invitations.empty")}
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{invitations.map((invitation) => (
						<TeamBridgeInvitationRow
							key={invitation.key}
							invitation={invitation}
							state={rowStates[invitation.key] ?? { phase: "idle" }}
							readOnly={readOnly}
							organizationName={organizationNames[invitation.tenantId]}
							onAnswer={(decision) => onAnswer(invitation, decision)}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

function TeamBridgeInvitationRow({
	invitation,
	state,
	readOnly,
	organizationName,
	onAnswer,
}: {
	invitation: TeamBridgeInvitation;
	state: TeamBridgeInvitationRowState;
	readOnly: boolean;
	organizationName?: string;
	onAnswer: (decision: "accept" | "decline") => void;
}) {
	const Icon = invitation.conversationKind === "group" ? Users : Hash;
	const inviter = invitationInviterLine(invitation.inviter);
	/*
	 * The outcome sentences have their own `*_unnamed` messages (i18n audit F2):
	 * a fallback placed into {agent} capitalizes wrongly mid-sentence in en/es/
	 * fr/vi and needs a case each host may not share in hi/ur, so {agent} is
	 * only ever a real name there. The fallback still fills `agent_line`.
	 */
	const agent = invitation.agentName;
	const pending = state.phase === "pending";
	const failed = state.phase === "failed" ? state.kind : null;
	/*
	 * ONE ACTION SLOT, ONE HEIGHT (design round 1, D2). Every phase renders
	 * into the same `min-h-8` row: the buttons, the buttons plus a retryable
	 * refusal beside them, or an outcome/final refusal in their place. A
	 * refusal therefore never grows the card or moves the rows below it, and a
	 * final refusal leaves no empty band where the buttons were.
	 */
	const showActions =
		state.phase === "idle" ||
		pending ||
		(failed !== null && invitationRetryable(failed));
	return (
		<li className="flex flex-col gap-1.5 rounded-lg bg-elevated p-3 text-ink">
			<p className="flex min-w-0 items-center gap-2 text-sm font-medium">
				<Icon size={14} aria-hidden="true" className="shrink-0 text-ink-dim" />
				<span className="truncate">
					{invitation.conversationName ?? t("ui.teamBridge.list.untitled")}
				</span>
				{organizationName?.trim() && (
					<span className="truncate font-normal text-meta-sm text-ink-dim">
						{organizationName.trim()}
					</span>
				)}
			</p>
			<p className="text-sm text-ink-muted">
				{t(
					"ui.teamBridge.invitations.agent_line",
					agent
						? { agent }
						: { agent: t("ui.teamBridge.invitations.agent_fallback") },
				)}
			</p>
			{inviter && <p className="text-meta text-ink-dim">{inviter}</p>}
			<div className="flex min-h-8 flex-wrap items-center gap-2">
				{showActions && (
					<>
						<InvitationButton
							variant="primary"
							idle={t("ui.teamBridge.invitations.accept")}
							busy={t("ui.teamBridge.invitations.accepting")}
							pending={pending && state.decision === "accept"}
							inFlight={pending}
							readOnly={readOnly}
							onPress={() => onAnswer("accept")}
						/>
						<InvitationButton
							variant="ghost"
							idle={t("ui.teamBridge.invitations.decline")}
							busy={t("ui.teamBridge.invitations.declining")}
							pending={pending && state.decision === "decline"}
							inFlight={pending}
							readOnly={readOnly}
							onPress={() => onAnswer("decline")}
						/>
					</>
				)}
				{failed !== null && (
					/*
					 * The sentence is one line at EVERY width (design round 2, D8).
					 * Beside the buttons a wrapped sentence grew the slot 32 -> 76 and
					 * moved the rows below. The full reason is still available on hover
					 * on hover, and assistive tech reads the whole sentence: `truncate`
					 * clips the pixels, never the text, so no `tabIndex` is needed to
					 * reach it. `min-w-0 flex-1` makes this the slot's shrinkable child,
					 * so the buttons keep their place instead of being pushed out.
					 */
					<p
						role="alert"
						title={invitationFailureCopy(failed)}
						className="min-w-0 flex-1 truncate text-sm text-danger"
					>
						{invitationFailureCopy(failed)}
					</p>
				)}
				{state.phase === "done" && (
					<p aria-live="polite" className="text-sm text-ink-muted">
						{state.decision === "accept"
							? agent
								? t("ui.teamBridge.invitations.accepted", { agent })
								: t("ui.teamBridge.invitations.accepted_unnamed")
							: agent
								? t("ui.teamBridge.invitations.declined", { agent })
								: t("ui.teamBridge.invitations.declined_unnamed")}
					</p>
				)}
			</div>
		</li>
	);
}

/**
 * Accept or Decline, with a width that never changes (design round 1, D4).
 *
 * Both labels occupy ONE grid cell, so the button is as wide as the longer
 * label in every phase and the pressed row does not push its sibling sideways
 * (the same mechanism as the live-updates band's Reload). The hidden label is
 * `invisible` and `aria-hidden`. While in flight the button keeps its own face
 * rather than the disabled one, so the row reads as working, not unavailable:
 * `aria-disabled` plus a dropped handler makes it inert, which is the
 * live-updates band's treatment too. Read-only stays truly `disabled`.
 */
function InvitationButton({
	variant,
	idle,
	busy,
	pending,
	inFlight,
	readOnly,
	onPress,
}: {
	variant: "primary" | "ghost";
	idle: string;
	busy: string;
	/** THIS button's answer is in flight: it shows the busy label. */
	pending: boolean;
	/** Either answer for the row is in flight: the button is inert. */
	inFlight: boolean;
	readOnly: boolean;
	onPress: () => void;
}) {
	return (
		<Button
			size="sm"
			variant={variant}
			disabled={readOnly}
			aria-disabled={inFlight || undefined}
			aria-busy={pending || undefined}
			onClick={inFlight ? undefined : onPress}
			/*
			 * The global `[aria-disabled]` rule paints `cursor: not-allowed`, which
			 * says "forbidden" on the button whose request is running. This one
			 * says "working" (design round 2, D9); the inert sibling keeps it.
			 */
			className={pending ? "cursor-progress" : undefined}
		>
			<span className="grid">
				<span
					className={cn("col-start-1 row-start-1", pending && "invisible")}
					aria-hidden={pending}
				>
					{idle}
				</span>
				<span
					className={cn("col-start-1 row-start-1", !pending && "invisible")}
					aria-hidden={!pending}
				>
					{busy}
				</span>
			</span>
		</Button>
	);
}
