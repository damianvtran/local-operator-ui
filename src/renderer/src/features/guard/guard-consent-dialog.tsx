/**
 * The Guard consent prompt, as a dialog the person OPENS (RFC §5.2.3, §15.4' C4).
 *
 * THE ARRIVAL OF A PROMPT NEVER OPENS THIS. `GuardPromptEntry` is the passive
 * row; this dialog mounts only after the person presses its "Review" button, so
 * a prompt that lands while someone is typing, mid-turn or on another route
 * changes no focus and covers nothing. That is the desktop's half of "never
 * inside a turn, never steals focus".
 *
 * PRESENTATION SAFETY, each pinned by `scripts/guard-consent-dom.test.mjs`:
 * - focus starts on the NON-SHARING choice ("Don't share" / "Keep current"), not
 *   on the dialog's first tab stop and never on Share;
 * - Esc (and the scrim) mean "Decide later": the dialog closes, the card stays
 *   pending in the store and nothing is sent - it is NOT a decline;
 * - a button pressed within `GUARD_DEBOUNCE_MS` of the dialog opening is ignored,
 *   so a typed-ahead Enter meant for the composer cannot answer it. A UX
 *   debounce, not a security bound;
 * - the three answers carry EQUAL weight: no fill, no primary variant, so the
 *   interface does not lean toward sharing. The one coloured control in the
 *   Guard surface is "Stop sharing", which only goes the safe way;
 * - Share is drawn only when the host says it may sign this exact card
 *   (`GuardPromptView.shareRequest`); a decline never needs that.
 *
 * WHAT THE DIALOG REPORTS IS WHAT THE HOST SAID (security review U1 r1, S-1/S-4;
 * UX review U2/U3/U6):
 * - "Sharing with <Org>" is drawn only for a grant the host both signed and sent. A
 *   signed accept the host could not SEND (`not_applied`) says so in the host's own
 *   words and offers "Try again" (the apply retry, which never signs again);
 * - an outcome this window could not confirm is never worded "nothing changed";
 * - a card whose window ended before Share was pressed sends nothing and says the
 *   request changed (`expired`);
 * - the disclosure scrolls inside the dialog while the header and the three answers
 *   stay pinned, so no viewport can push a button off-screen (design D1);
 * - failures are `role="alert"`, outcomes `role="status"`, and focus moves to a
 *   control the person can act on, never to the document root.
 *
 * ALL-OR-NOTHING. The buttons grant exactly what the lines above them list. There
 * is no per-scope control because the host's accept body has no scope field
 * (RFC §5.2.2): a member who wants less declines and tells the admin, who can
 * narrow the ceiling.
 */

import {
	Alert,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { type FC, useCallback, useEffect, useRef } from "react";
import { GUARD_DEBOUNCE_MS } from "../../../../shared/guard-consent";
import { ORG_MARK } from "./guard-org-mark";
import { OrgText } from "./guard-org-text";
import type { GuardPromptView } from "./guard-prompt-model";

/**
 * Where the prompt stands. `shared`/`declined` are the local outcome the person
 * just caused; `answered_elsewhere` is a card another surface settled while this
 * one was open (RFC §5.2.3 "Answered on <surface>").
 *
 * - `failed`: the host refused before anything was signed (re-read: the card is still
 *   waiting), so "nothing changed" is true;
 * - `unconfirmed`: the answer may or may not have landed and a re-read could not tell;
 * - `not_applied`: the host SIGNED the accept but could not send the grant;
 * - `expired`: the card's window ended before the press; nothing was sent.
 */
export type GuardDialogPhase =
	| "idle"
	| "working"
	| "failed"
	| "unconfirmed"
	| "not_applied"
	| "shared"
	| "declined"
	| "expired"
	| "answered_elsewhere";

/** The host's account of a signed accept it could not send. */
export type GuardUnsent = {
	reason: string;
	remedy: string;
	retryable: boolean;
	/**
	 * A Try again whose result this window could not read (r3 M-2). The host's earlier
	 * `reason`/`remedy` may no longer be true (the retry may have landed), so they are
	 * not drawn: the dialog says it could not confirm, and Try again stays offered.
	 */
	unconfirmed?: boolean;
};

export type GuardConsentDialogProps = {
	view: GuardPromptView;
	open: boolean;
	phase: GuardDialogPhase;
	/** The surface an elsewhere-answer came from, already worded ("the desktop app"). */
	answeredOn?: string;
	onShare: () => void;
	onDecline: () => void;
	/** Esc, the scrim and "Decide later": close without answering. */
	onLater: () => void;
	/** Close after an outcome line has been read. */
	onDone: () => void;
	/** A line above the disclosure, e.g. "<Org> changed this request." */
	notice?: string;
	/** Present in `not_applied`: why the grant was not sent, in the host's words. */
	unsent?: GuardUnsent;
	/** Re-apply the signed card (`applyOperation`); drawn only when the host says it can work. */
	onRetry?: () => void;
	/** A retry is in flight: the retry control is held and a status line says so. */
	retrying?: boolean;
	/**
	 * The dialog has closed and Radix is about to move focus (UX U2). The owner puts
	 * it where the person can carry on: the control that opened this, or the Guard
	 * heading when that control is gone.
	 */
	onCloseFocus?: () => void;
	/** Injected clock, so the debounce is testable without sleeping. */
	now?: () => number;
};

export const GuardConsentDialog: FC<GuardConsentDialogProps> = ({
	view,
	open,
	phase,
	answeredOn,
	notice,
	unsent,
	onRetry,
	retrying = false,
	onCloseFocus,
	onShare,
	onDecline,
	onLater,
	onDone,
	now = Date.now,
}) => {
	useI18nLocale();
	const noRef = useRef<HTMLButtonElement>(null);
	const openedAt = useRef(0);
	// Re-armed when the CARD changes, not only when the dialog opens: a newer
	// prompt for the same org replaces `view` while the dialog stays open
	// (`guard-prompt-entries`), and a press aimed at the old text must not sign the
	// new one inside the typed-ahead window.
	const approvalId = view.approvalId;
	// biome-ignore lint/correctness/useExhaustiveDependencies: approvalId is a re-arm trigger, not a value read in the effect.
	useEffect(() => {
		if (open) openedAt.current = now();
	}, [open, now, approvalId]);

	/** True while a press is still inside the typed-ahead window (RFC §5.2.3). */
	const tooSoon = useCallback(
		() => now() - openedAt.current < GUARD_DEBOUNCE_MS,
		[now],
	);

	const doneRef = useRef<HTMLButtonElement>(null);
	const settled =
		phase === "shared" ||
		phase === "declined" ||
		phase === "expired" ||
		phase === "answered_elsewhere";
	const unsentShown = phase === "not_applied";
	const busy = phase === "working";

	/*
	 * FOCUS FOLLOWS THE STATE (UX U3). Pressing Share/Don't share disables the buttons
	 * for the length of the request, and a disabled element cannot hold focus, so
	 * without this the cursor drops to the dialog container and a screen reader hears
	 * nothing. An outcome moves focus to its one Close button; a failure goes back to
	 * the NON-SHARING answer (never to Share) so a stray Enter cannot grant.
	 */
	useEffect(() => {
		if (settled || unsentShown) doneRef.current?.focus();
		else if (phase === "failed" || phase === "unconfirmed")
			noRef.current?.focus();
	}, [phase, settled, unsentShown]);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next) return;
				// Esc/scrim while an answer or a retry is in flight would hide its
				// outcome, and a retry that settles after a close would reopen the
				// dialog unasked (security r2 S-8).
				if (busy || retrying) return;
				if (settled || unsentShown) onDone();
				else onLater();
			}}
		>
			<DialogContent
				data-testid="guard-consent-dialog"
				// D1: a long disclosure (ru: ~680 px) must not push the answers off a
				// 600 px window. The panel is capped to the viewport, the header and
				// footer are pinned (`shrink-0`) and the body scrolls; narrow windows
				// keep a 1 rem gutter instead of touching the edges.
				className="max-h-[calc(100dvh-2rem)] max-w-[min(32rem,calc(100vw-2rem))]"
				// Radix would focus the first tab stop; the RFC puts focus on the
				// non-sharing answer, so the dialog's own open-focus is replaced.
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					noRef.current?.focus();
				}}
				// Radix's own return-focus would aim at whatever was focused when it
				// mounted, which is gone once the card leaves the list; the owner decides.
				onCloseAutoFocus={(event) => {
					if (!onCloseFocus) return;
					event.preventDefault();
					onCloseFocus();
				}}
				showClose={false}
			>
				{/*
				 * No `dir="auto"` anywhere in Guard's translated text: auto resolves from
				 * the FIRST strong character, and an Urdu sentence that opens with the
				 * Latin word "Guard" or an org name would lay out left-to-right and
				 * reorder its own clauses (i18n audit 2, C1). The text inherits the page
				 * direction the locale store writes to <html dir>. Standalone org names
				 * keep their own <bdi> isolation (see the Settings view).
				 */}
				<DialogHeader className="shrink-0">
					<DialogTitle>
						<OrgText text={view.title} org={view.org} />
					</DialogTitle>
					<DialogDescription>
						<OrgText text={view.reasonLine} org={view.org} />
					</DialogDescription>
				</DialogHeader>

				{/*
				 * The scrolling region (D1). It is a tab stop so a keyboard user can scroll
				 * a disclosure taller than the window with the arrow keys (WCAG 2.1.1); the
				 * three answers below it stay pinned and are the next stops.
				 */}
				<div
					className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
					data-testid="guard-body"
					// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-reachable; the pinned buttons are the next stops, so the walk is not trapped.
					tabIndex={0}
				>
					{notice && !settled ? (
						<p className="text-body-sm text-ink" data-testid="guard-notice">
							<OrgText text={notice} org={view.org} />
						</p>
					) : null}

					{settled ? (
						<output
							className="block text-body-sm text-ink"
							data-testid="guard-outcome"
						>
							{phase === "shared" ? (
								<OrgText
									text={t("ui.guard.screen_shared", { org: ORG_MARK })}
									org={view.org}
								/>
							) : phase === "declined" ? (
								<OrgText
									text={t("ui.guard.screen_declined", { org: ORG_MARK })}
									org={view.org}
								/>
							) : phase === "expired" ? (
								<OrgText
									text={t("ui.guard.screen_prompt_changed", { org: ORG_MARK })}
									org={view.org}
								/>
							) : (
								t("ui.guard.answered_on", { surface: answeredOn ?? "" })
							)}
						</output>
					) : unsentShown ? (
						/*
						 * SIGNED, NOT SENT. The host's own sentences, never "Sharing with": the
						 * decision stands on this computer but Radient has not received it.
						 */
						<>
							<Alert
								variant="warning"
								role="alert"
								data-testid="guard-not-applied"
							>
								<div className="flex flex-col gap-1">
									{unsent?.unconfirmed || !unsent?.reason ? (
										<p>{t("ui.guard.screen_unconfirmed")}</p>
									) : (
										<>
											{/*
											 * The host's sentences are English whatever the locale
											 * (`approval_copy.outcome()` takes no locale), so they are
											 * isolated: in an RTL page their full stop would otherwise
											 * jump to the wrong end (design r2 D8). The catalogue text
											 * around them keeps inheriting the page direction.
											 */}
											<p>
												<bdi>{unsent.reason}</bdi>
											</p>
											{unsent.remedy ? (
												<p>
													<bdi>{unsent.remedy}</bdi>
												</p>
											) : null}
										</>
									)}
								</div>
							</Alert>
							{retrying ? (
								<output className="text-meta text-ink-dim">
									{t("ui.guard.screen_working")}
								</output>
							) : null}
						</>
					) : (
						<div className="flex flex-col gap-3">
							<p className="text-body-sm text-ink">{view.wouldSend}</p>
							<ul className="flex list-disc flex-col gap-1.5 ps-5 text-body-sm text-ink">
								{view.scopeLines.map((line) => (
									<li key={line.scope} data-scope={line.scope}>
										<OrgText text={line.text} org={view.org} />
									</li>
								))}
							</ul>
							<p className="text-body-sm text-ink-muted">{view.neverSent}</p>
							<p className="text-body-sm text-ink-muted">{view.visibility}</p>
							<p className="text-body-sm text-ink-muted">{view.background}</p>
							{phase === "failed" ? (
								<Alert
									variant="warning"
									role="alert"
									data-testid="guard-failed"
								>
									{t("ui.guard.screen_failed")}
								</Alert>
							) : null}
							{phase === "unconfirmed" ? (
								/*
								 * THE OUTCOME IS UNKNOWN, so this must not say "nothing changed"
								 * (S-4). The Settings indicator is the truth; the re-read that
								 * could have said is the thing that failed.
								 */
								<Alert
									variant="warning"
									role="alert"
									data-testid="guard-unconfirmed"
								>
									{t("ui.guard.screen_unconfirmed")}
								</Alert>
							) : null}
							{busy ? (
								<output className="text-meta text-ink-dim">
									{t("ui.guard.screen_working")}
								</output>
							) : null}
						</div>
					)}
				</div>

				<DialogFooter className="shrink-0">
					{settled || unsentShown ? (
						<>
							<Button
								ref={doneRef}
								variant="secondary"
								onClick={onDone}
								data-testid="guard-done"
							>
								{t("ui.guard.screen_close")}
							</Button>
							{unsentShown && unsent?.retryable && onRetry ? (
								<Button
									variant="secondary"
									onClick={onRetry}
									disabled={retrying}
									data-testid="guard-retry"
								>
									{t("ui.common.actions.retry_again")}
								</Button>
							) : null}
						</>
					) : (
						<>
							<Button
								ref={noRef}
								variant="secondary"
								disabled={busy}
								data-testid="guard-no"
								onClick={() => {
									if (tooSoon()) return;
									onDecline();
								}}
							>
								{view.noLabel}
							</Button>
							<Button
								variant="secondary"
								disabled={busy}
								data-testid="guard-later"
								onClick={() => {
									if (tooSoon()) return;
									onLater();
								}}
							>
								{view.laterLabel}
							</Button>
							{view.shareRequest ? (
								<Button
									variant="secondary"
									disabled={busy}
									data-testid="guard-yes"
									onClick={() => {
										if (tooSoon()) return;
										onShare();
									}}
								>
									{view.yesLabel}
								</Button>
							) : null}
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
