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

/**
 * S-5 / NIT-3: the approvals this window has an answer in flight for. It is
 * MODULE-level and keyed by approval id, not a ref on the component, because the
 * component can unmount mid-answer (leave Settings, come back) while the request
 * is still running on the host; a per-instance latch would let the returning
 * instance send a second Share for the same card. It is a plain Set written
 * synchronously (React state lands a render late, so two clicks in one tick would
 * both pass a `disabled` check) and is cleared from the mutation's own promise,
 * never from a `mutate()` callback: those are dropped when the observer unmounts,
 * which would leave the latch set for good and make the card un-answerable.
 */
const answersInFlight = new Set<string>();

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
	/** The control that opened the dialog, and whether a close is awaiting focus. */
	const opener = useRef<HTMLElement | null>(null);
	const restoreFocus = useRef(false);

	/*
	 * A CARD ANOTHER SURFACE SETTLED WHILE THIS DIALOG WAS OPEN closes with
	 * "Answered on <surface>"; a NEWER prompt for the same org replaces it with
	 * "<Org> changed this request" (RFC §5.2.3, the terminal's screen_prompt_changed).
	 * Only an idle, failed or unconfirmed dialog is reconciled: while an answer is in
	 * flight or its outcome is on screen, the row leaving the list is the answer's own
	 * effect. `unconfirmed` joins them so a later successful re-read can say what became
	 * of the answer instead of leaving "could not confirm" up for good (r3 N-1).
	 */
	useEffect(() => {
		if (
			!session ||
			(session.phase !== "idle" &&
				session.phase !== "failed" &&
				session.phase !== "unconfirmed")
		)
			return;
		if (!prompts.isSuccess) return;
		if (views.some((v) => v.approvalId === session.view.approvalId)) {
			// The list came back and the card is still waiting: nothing was answered,
			// so the S-4 rule ("nothing changed" only when the card is still waiting)
			// now holds and the unknown outcome is no longer unknown (r3 N-1).
			if (session.phase === "unconfirmed")
				setSession({ ...session, phase: "failed" });
			return;
		}
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

	/** Send one answer under the in-flight latch; `done`/`failed` run on settle. */
	const send = (
		approvalId: string,
		request: GuardPromptView["declineRequest"],
		onDone: (outcome: GuardAnswerOutcome) => void,
		onFailed: () => void,
	) => {
		answersInFlight.add(approvalId);
		answer.mutateAsync(request).then(
			(outcome) => {
				answersInFlight.delete(approvalId);
				onDone(outcome);
			},
			() => {
				answersInFlight.delete(approvalId);
				onFailed();
			},
		);
	};

	const unsentOf = (
		outcome: Extract<GuardAnswerOutcome, { kind: "not_applied" }>,
	): GuardUnsent => ({
		reason: outcome.reason,
		remedy: outcome.remedy,
		retryable: outcome.retryable,
	});

	const settle = (
		phase: GuardDialogPhase,
		request: GuardPromptView["declineRequest"],
	) => {
		if (!session || answersInFlight.has(session.view.approvalId)) return;
		const current = session;
		setSession({ ...current, phase: "working" });
		send(
			current.view.approvalId,
			request,
			(outcome) => {
				if (outcome.kind === "done") {
					setSession({ ...current, phase });
				} else if (outcome.kind === "not_applied") {
					const unsent = unsentOf(outcome);
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
			() => void confirmAfterFailure(current),
		);
	};

	/** Re-apply a signed card: the host's own retry, which never signs again. */
	const retry = () => {
		if (
			!session ||
			session.phase !== "not_applied" ||
			answersInFlight.has(session.view.approvalId)
		)
			return;
		const request = guardApplyRequest(session.view);
		if (!request) return;
		const current = session;
		const approvalId = current.view.approvalId;
		setSession({ ...current, retrying: true });
		/*
		 * Apply a result to the dialog only while it is still the one for this card:
		 * the person can press Close during a retry, and a late result must not
		 * reopen a dialog they dismissed (security r2 S-8). The row list below is
		 * updated either way.
		 */
		const ifStillOpen = (next: Session) =>
			setSession((open) =>
				open && open.view.approvalId === approvalId ? next : open,
			);
		const setUnsent = (unsent: GuardUnsent) => {
			setUnsentCards((cards) =>
				cards.map((c) =>
					c.view.approvalId === approvalId ? { ...c, unsent } : c,
				),
			);
			ifStillOpen({ ...current, retrying: false, unsent });
		};
		// Nothing readable came back (r3 M-2): the retry may or may not have landed, so
		// the host's earlier sentence cannot be repeated as fact. Say so, keep Try again.
		const unconfirmed = () =>
			setUnsent({
				...(current.unsent ?? { reason: "", remedy: "", retryable: true }),
				unconfirmed: true,
			});
		send(
			approvalId,
			request,
			(outcome) => {
				if (outcome.kind === "done") {
					setUnsentCards((cards) =>
						cards.filter((c) => c.view.approvalId !== approvalId),
					);
					ifStillOpen({ view: current.view, phase: "shared" });
				} else if (outcome.kind === "not_applied") {
					setUnsent(unsentOf(outcome));
				} else {
					unconfirmed();
				}
			},
			unconfirmed,
		);
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
						line:
							card.unsent.unconfirmed || !card.unsent.reason
								? t("ui.guard.screen_unconfirmed")
								: card.unsent.reason,
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
