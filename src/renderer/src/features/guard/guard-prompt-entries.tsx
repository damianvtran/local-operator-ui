/**
 * The passive Guard entries: one quiet row per pending consent prompt, and the
 * dialog a person opens from one.
 *
 * WHERE THIS LIVES, AND WHY NOT THE MESH TRAY. The desktop's approvals plane
 * (`GET /v1/desktop/approvals`) is one list, but its only on-screen reader is the
 * Mesh tray, and the Mesh row exists only for a device that belongs to a mesh
 * network. A Guard consent is a Team member's privacy choice and has nothing to do
 * with the mesh, so tying it to that tray would hide it from exactly the members
 * it is for. The entry therefore sits in Settings → Radient account (the account
 * surface that owns the rest of Guard) and the rail announces it with a count on
 * the Settings gear. The Mesh tray never draws it (`useMeshApprovals` drops guard
 * rows), so a prompt is never answerable from a surface that is about devices.
 *
 * NEVER A GENERIC APPROVE. This component builds no request itself: the Share
 * request comes from `guardShareRequest` and is sent only by the dialog's Share
 * button; Decline is `approvals.deny`. Nothing here reads an auto-approval mode,
 * the chat approval flow or a "approve all" action, so none of them can answer.
 *
 * NO FOCUS MOVES ON ARRIVAL. A prompt appearing changes the list this renders and
 * nothing else. The dialog opens only from the Review button's own click handler.
 *
 * WHAT AN ANSWER CAME TO IS READ FROM THE HOST (security review U1 r1):
 * - S-1: a typed accept answers `200 {signed, applied}`; only both-ok is "Sharing".
 *   A signed accept the host could not SEND stays on screen in `not_applied` with the
 *   host's sentence and a "Try again" that re-applies the signed card (never a second
 *   signature), and keeps a row in the list so closing the dialog does not lose it;
 * - S-4: when an answer fails, the host's record is re-read BEFORE the failure is
 *   worded: "nothing changed" is said only when the card is still waiting; if the
 *   re-read fails too the dialog says it could not confirm, not that nothing changed;
 * - S-5: one answer in flight at a time (a ref, because `disabled` only lands after
 *   a re-render and two clicks in one tick would both send);
 * - S-6: a card whose window has ended sends nothing and says the request changed.
 *
 * FOCUS (UX U2): the dialog is unmounted when it closes, so Radix has nothing to return
 * focus to once the card has left the list. The opener is remembered and focus goes
 * back to it; when it is gone, to the Guard heading (`data-guard-heading`).
 */

import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useQueryClient } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import {
	type FC,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type GuardAnswerOutcome,
	guardCardExpired,
} from "../../../../shared/guard-consent";
import { meshApprovalKeys } from "../mesh/mesh-approvals";
import {
	GuardConsentDialog,
	type GuardDialogPhase,
	type GuardUnsent,
} from "./guard-consent-dialog";
import {
	guardKeys,
	useGuardAnswer,
	useGuardPrompts,
	useGuardStatus,
} from "./guard-hooks";
import { ORG_MARK } from "./guard-org-mark";
import { OrgText } from "./guard-org-text";
import {
	type GuardPromptView,
	guardApplyRequest,
	guardWaitingViews,
} from "./guard-prompt-model";

/** Where focus goes when the control that opened a dialog is gone (UX U2). */
export const GUARD_HEADING_SELECTOR = '[data-guard-heading="true"]';

/**
 * One passive row. Presentational: the Storybook state and the live list share it.
 * `summary` replaces the prompt sentences for a card that is already SIGNED but not
 * sent, where "Share Guard stats with Acme?" would ask a question already answered.
 */
export const GuardPromptEntry: FC<{
	view: GuardPromptView;
	onReview: (opener: HTMLElement) => void;
	summary?: { title: string; line: string };
}> = ({ view, onReview, summary }) => {
	useI18nLocale();
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			data-testid="guard-entry"
			// D7: wrap, so at a narrow width the Review button drops below the text
			// instead of squeezing it into a ~120 px column.
			className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-sm border border-hairline bg-surface p-3"
		>
			<Shield
				className="mt-0.5 size-4 shrink-0 text-ink-muted"
				aria-hidden="true"
			/>
			<div className="flex min-w-40 flex-1 flex-col gap-0.5 break-words">
				<p id={headingId} className="text-body-sm text-ink">
					{summary ? (
						summary.title
					) : (
						<OrgText text={view.title} org={view.org} />
					)}
				</p>
				<p className="text-meta text-ink-muted">
					{summary ? (
						summary.line
					) : (
						<OrgText text={view.reasonLine} org={view.org} />
					)}
				</p>
			</div>
			<Button
				variant="secondary"
				size="sm"
				data-testid="guard-review"
				onClick={(event) => onReview(event.currentTarget)}
			>
				{t("ui.guard.entry_review")}
			</Button>
		</section>
	);
};

type Session = {
	view: GuardPromptView;
	phase: GuardDialogPhase;
	/** Marked with `ORG_MARK` where the org goes (drawn through `<OrgText>`). */
	notice?: string;
	/** Present in `not_applied`: the host's account of why the grant was not sent. */
	unsent?: GuardUnsent;
	/** A retry of the signed card is in flight. */
	retrying?: boolean;
};

/** A signed accept the host could not send, kept so closing the dialog does not lose it. */
type UnsentCard = { view: GuardPromptView; unsent: GuardUnsent };

/** "Answered on <surface>" wording for the surface the host named. */
function surfaceName(via: string): string {
	switch (via) {
		case "tui":
			return t("ui.guard.surface_tui");
		case "desktop":
			return t("ui.guard.surface_desktop");
		case "mobile":
			return t("ui.guard.surface_mobile");
		default:
			return via;
	}
}

export const GuardPromptEntries: FC = () => {
	useI18nLocale();
	const client = useQueryClient();
	const prompts = useGuardPrompts();
	const status = useGuardStatus();
	const answer = useGuardAnswer();
	const views = useMemo(
		() => guardWaitingViews(prompts.data ?? []),
		[prompts.data],
	);
	const [session, setSession] = useState<Session | null>(null);
	const [unsentCards, setUnsentCards] = useState<UnsentCard[]>([]);
	/** S-5: set synchronously, cleared when the answer settles. */
	const inFlight = useRef(false);
	/** The control that opened the dialog, and whether a close is awaiting focus. */
	const opener = useRef<HTMLElement | null>(null);
	const restoreFocus = useRef(false);

	/*
	 * A CARD ANOTHER SURFACE SETTLED WHILE THIS DIALOG WAS OPEN closes with
	 * "Answered on <surface>"; a NEWER prompt for the same org replaces it with
	 * "<Org> changed this request" (RFC §5.2.3, the terminal's screen_prompt_changed).
	 * Only an idle or failed dialog is reconciled: while an answer is in flight or
	 * its outcome is on screen, the row leaving the list is the answer's own effect.
	 */
	useEffect(() => {
		if (!session || (session.phase !== "idle" && session.phase !== "failed"))
			return;
		if (!prompts.isSuccess) return;
		if (views.some((v) => v.approvalId === session.view.approvalId)) return;
		const next = views.find((v) => v.tenant === session.view.tenant);
		if (next) {
			setSession({
				view: next,
				phase: "idle",
				notice: t("ui.guard.screen_prompt_changed", { org: ORG_MARK }),
			});
			return;
		}
		const via =
			status.data?.orgs.find((o) => o.tenant === session.view.tenant)
				?.answered_via ?? "";
		// Nothing names the surface: close quietly rather than word a guess.
		if (!via) {
			closeSession();
			return;
		}
		setSession({ ...session, phase: "answered_elsewhere", notice: via });
	}, [views, prompts.isSuccess, session, status.data]);

	/*
	 * A SIGNED CARD IS DONE WITH ONCE THE ORG SHOWS AS SHARING (the retry worked, or
	 * another surface applied it): its "not sent" row has nothing left to say.
	 */
	useEffect(() => {
		const sharing = new Set(
			(status.data?.orgs ?? [])
				.filter((o) => o.state === "sharing")
				.map((o) => o.tenant),
		);
		setUnsentCards((cards) =>
			cards.some((c) => sharing.has(c.view.tenant))
				? cards.filter((c) => !sharing.has(c.view.tenant))
				: cards,
		);
	}, [status.data]);

	const moveFocusAfterClose = useCallback(() => {
		if (!restoreFocus.current) return;
		restoreFocus.current = false;
		const target = opener.current?.isConnected
			? opener.current
			: document.querySelector<HTMLElement>(GUARD_HEADING_SELECTOR);
		opener.current = null;
		target?.focus();
	}, []);

	function closeSession() {
		restoreFocus.current = true;
		setSession(null);
	}

	// Radix's own return-focus (onCloseFocus) can lose the race with the unmount; this
	// effect is the deterministic half and both paths are idempotent.
	useEffect(() => {
		if (session === null) moveFocusAfterClose();
	}, [session, moveFocusAfterClose]);

	// An unsent card whose list row came back (the host re-queued it) is one row, not two.
	const unsentOnly = unsentCards.filter(
		(card) => !views.some((v) => v.approvalId === card.view.approvalId),
	);
	if (views.length === 0 && unsentOnly.length === 0 && !session) return null;

	/**
	 * Re-read the host's record BEFORE wording a failure (S-4). A refused or timed-out
	 * answer says nothing about whether the host signed first, so the list and status
	 * are read again: still waiting -> "nothing changed" is true (`failed`); gone ->
	 * the reconcile effect words what happened; the re-read itself failing -> the
	 * outcome is unknown and the dialog says it could not confirm.
	 */
	const confirmAfterFailure = async (current: Session) => {
		await Promise.allSettled([
			client.refetchQueries({ queryKey: meshApprovalKeys.approvals }),
			client.refetchQueries({ queryKey: guardKeys.status }),
		]);
		const reread = client.getQueryState(meshApprovalKeys.approvals);
		setSession({
			...current,
			phase: reread?.status === "success" ? "failed" : "unconfirmed",
		});
	};

	const settle = (
		phase: GuardDialogPhase,
		request: GuardPromptView["declineRequest"],
	) => {
		if (!session || inFlight.current) return;
		inFlight.current = true;
		const current = session;
		setSession({ ...current, phase: "working" });
		answer.mutate(request, {
			onSuccess: (outcome: GuardAnswerOutcome) => {
				inFlight.current = false;
				if (outcome.kind === "done") {
					setSession({ ...current, phase });
				} else if (outcome.kind === "not_applied") {
					const unsent = {
						reason: outcome.reason,
						remedy: outcome.remedy,
						retryable: outcome.retryable,
					};
					setUnsentCards((cards) => [
						...cards.filter(
							(c) => c.view.approvalId !== current.view.approvalId,
						),
						{ view: current.view, unsent },
					]);
					setSession({ ...current, phase: "not_applied", unsent });
				} else {
					// A 200 this build cannot read is not a grant.
					void confirmAfterFailure(current);
				}
			},
			onError: () => {
				inFlight.current = false;
				void confirmAfterFailure(current);
			},
		});
	};

	/** Re-apply a signed card: the host's own retry, which never signs again. */
	const retry = () => {
		if (!session || session.phase !== "not_applied" || inFlight.current) return;
		const request = guardApplyRequest(session.view);
		if (!request) return;
		inFlight.current = true;
		const current = session;
		setSession({ ...current, retrying: true });
		answer.mutate(request, {
			onSuccess: (outcome: GuardAnswerOutcome) => {
				inFlight.current = false;
				if (outcome.kind === "done") {
					setUnsentCards((cards) =>
						cards.filter((c) => c.view.approvalId !== current.view.approvalId),
					);
					setSession({ view: current.view, phase: "shared" });
				} else if (outcome.kind === "not_applied") {
					const unsent = {
						reason: outcome.reason,
						remedy: outcome.remedy,
						retryable: outcome.retryable,
					};
					setSession({ ...current, retrying: false, unsent });
				} else {
					setSession({ ...current, retrying: false });
				}
			},
			// Nothing new is known: the signed card and the host's earlier sentence stand.
			onError: () => {
				inFlight.current = false;
				setSession({ ...current, retrying: false });
			},
		});
	};

	const open = (view: GuardPromptView, from: HTMLElement) => {
		opener.current = from;
		const unsent = unsentCards.find(
			(c) => c.view.approvalId === view.approvalId,
		);
		setSession(
			unsent && !views.some((v) => v.approvalId === view.approvalId)
				? { view, phase: "not_applied", unsent: unsent.unsent }
				: { view, phase: "idle" },
		);
	};

	return (
		<div className="flex flex-col gap-3" data-testid="guard-entries">
			{views.map((view) => (
				<GuardPromptEntry
					key={view.approvalId}
					view={view}
					onReview={(from) => open(view, from)}
				/>
			))}
			{unsentOnly.map((card) => (
				<GuardPromptEntry
					key={card.view.approvalId}
					view={card.view}
					summary={{
						title: t("ui.guard.screen_title"),
						line: card.unsent.reason || t("ui.guard.screen_unavailable"),
					}}
					onReview={(from) => open(card.view, from)}
				/>
			))}
			{session ? (
				<GuardConsentDialog
					view={session.view}
					open
					phase={session.phase}
					answeredOn={
						session.phase === "answered_elsewhere"
							? surfaceName(session.notice ?? "")
							: undefined
					}
					notice={
						session.phase === "answered_elsewhere" ? undefined : session.notice
					}
					unsent={session.unsent}
					retrying={session.retrying}
					onRetry={retry}
					onCloseFocus={moveFocusAfterClose}
					onShare={() => {
						const request = session.view.shareRequest;
						// No Share request means the host did not offer one: send nothing.
						if (!request) return;
						// S-6: a card whose own window ended is not sent; the list is re-read
						// so the host's newer request, if any, takes its place.
						if (guardCardExpired(session.view.expiresAt, Date.now())) {
							setSession({ ...session, phase: "expired" });
							void client.invalidateQueries({
								queryKey: meshApprovalKeys.approvals,
							});
							return;
						}
						settle("shared", request);
					}}
					onDecline={() => settle("declined", session.view.declineRequest)}
					onLater={closeSession}
					onDone={closeSession}
				/>
			) : null}
		</div>
	);
};
