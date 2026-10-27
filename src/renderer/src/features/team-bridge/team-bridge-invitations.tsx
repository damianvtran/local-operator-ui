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
 * the three facts the owner is agreeing to: the agent can read the
 * conversation's messages from now on, it joins muted, and it is woken only by
 * @-mentions unless its owner chooses otherwise. Accepting never changes the
 * notification register.
 *
 * Split container/view like Scheduled, so stories render every state without a
 * transport: the container owns the mutation, the view owns presentation.
 */
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Hash, Users } from "lucide-react";
import { useRef, useState } from "react";
import {
	type InvitationFailureKind,
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
				{t("ui.teamBridge.invitations.consent")}
			</p>
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
	const agent =
		invitation.agentName ?? t("ui.teamBridge.invitations.agent_fallback");
	const pending = state.phase === "pending";
	/*
	 * The action row keeps ONE height across every phase: the buttons are
	 * replaced by an outcome line of the same `min-h-8`, so answering does not
	 * shrink the card and move the rows below it (the no-jitter rule).
	 */
	const showActions =
		state.phase === "idle" ||
		pending ||
		(state.phase === "failed" && invitationRetryable(state.kind));
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
				{t("ui.teamBridge.invitations.agent_line", { agent })}
			</p>
			{inviter && <p className="text-meta text-ink-dim">{inviter}</p>}
			{state.phase === "failed" && (
				<p role="alert" className="text-sm text-danger">
					{invitationFailureCopy(state.kind)}
				</p>
			)}
			<div className="flex min-h-8 flex-wrap items-center gap-2">
				{showActions ? (
					<>
						<Button
							size="sm"
							variant="primary"
							disabled={readOnly || pending}
							aria-busy={pending && state.decision === "accept"}
							onClick={() => onAnswer("accept")}
						>
							{pending && state.decision === "accept"
								? t("ui.teamBridge.invitations.accepting")
								: t("ui.teamBridge.invitations.accept")}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={readOnly || pending}
							aria-busy={pending && state.decision === "decline"}
							onClick={() => onAnswer("decline")}
						>
							{pending && state.decision === "decline"
								? t("ui.teamBridge.invitations.declining")
								: t("ui.teamBridge.invitations.decline")}
						</Button>
					</>
				) : state.phase === "done" ? (
					<p aria-live="polite" className="text-sm text-ink-muted">
						{state.decision === "accept"
							? t("ui.teamBridge.invitations.accepted", { agent })
							: t("ui.teamBridge.invitations.declined")}
					</p>
				) : null}
			</div>
		</li>
	);
}
