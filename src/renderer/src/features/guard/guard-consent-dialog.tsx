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
import type { GuardPromptView } from "./guard-prompt-model";

/**
 * Where the prompt stands. `shared`/`declined` are the local outcome the person
 * just caused; `answered_elsewhere` is a card another surface settled while this
 * one was open (RFC §5.2.3 "Answered on <surface>").
 */
export type GuardDialogPhase =
	| "idle"
	| "working"
	| "failed"
	| "shared"
	| "declined"
	| "answered_elsewhere";

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
	/** Injected clock, so the debounce is testable without sleeping. */
	now?: () => number;
};

export const GuardConsentDialog: FC<GuardConsentDialogProps> = ({
	view,
	open,
	phase,
	answeredOn,
	notice,
	onShare,
	onDecline,
	onLater,
	onDone,
	now = Date.now,
}) => {
	useI18nLocale();
	const noRef = useRef<HTMLButtonElement>(null);
	const openedAt = useRef(0);
	useEffect(() => {
		if (open) openedAt.current = now();
	}, [open, now]);

	/** True while a press is still inside the typed-ahead window (RFC §5.2.3). */
	const tooSoon = useCallback(
		() => now() - openedAt.current < GUARD_DEBOUNCE_MS,
		[now],
	);

	const settled =
		phase === "shared" ||
		phase === "declined" ||
		phase === "answered_elsewhere";
	const busy = phase === "working";

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next) return;
				if (settled) onDone();
				else onLater();
			}}
		>
			<DialogContent
				data-testid="guard-consent-dialog"
				// Radix would focus the first tab stop; the RFC puts focus on the
				// non-sharing answer, so the dialog's own open-focus is replaced.
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					noRef.current?.focus();
				}}
				showClose={false}
			>
				<DialogHeader>
					<DialogTitle dir="auto">{view.title}</DialogTitle>
					<DialogDescription dir="auto">{view.reasonLine}</DialogDescription>
				</DialogHeader>

				{notice && !settled ? (
					<p
						className="text-body-sm text-ink"
						data-testid="guard-notice"
						dir="auto"
					>
						{notice}
					</p>
				) : null}

				{settled ? (
					<p
						className="text-body-sm text-ink"
						data-testid="guard-outcome"
						dir="auto"
					>
						{phase === "shared"
							? t("ui.guard.screen_shared", { org: view.org })
							: phase === "declined"
								? t("ui.guard.screen_declined", { org: view.org })
								: t("ui.guard.answered_on", { surface: answeredOn ?? "" })}
					</p>
				) : (
					<div className="flex flex-col gap-3" dir="auto">
						<p className="text-body-sm text-ink">{view.wouldSend}</p>
						<ul className="flex list-disc flex-col gap-1.5 ps-5 text-body-sm text-ink">
							{view.scopeLines.map((line) => (
								<li key={line.scope} data-scope={line.scope}>
									{line.text}
								</li>
							))}
						</ul>
						<p className="text-body-sm text-ink-muted">{view.neverSent}</p>
						<p className="text-body-sm text-ink-muted">{view.visibility}</p>
						<p className="text-body-sm text-ink-muted">{view.background}</p>
						{phase === "failed" ? (
							<Alert variant="warning" data-testid="guard-failed">
								{t("ui.guard.screen_failed")}
							</Alert>
						) : null}
						{busy ? (
							<output className="text-meta text-ink-dim">
								{t("ui.guard.screen_working")}
							</output>
						) : null}
					</div>
				)}

				<DialogFooter>
					{settled ? (
						<Button
							variant="secondary"
							onClick={onDone}
							data-testid="guard-done"
						>
							{t("ui.guard.screen_close")}
						</Button>
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
