import { BaseDialog } from "@shared/components/common/base-dialog";
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { type FC, useId } from "react";
import {
	type WebauthnAccountChoice,
	accountChoiceDetail,
	accountChoiceLabel,
	accountChoiceVoice,
	chooserLead,
	chooserPageNote,
	chooserQueueNote,
} from "../model/webauthn-chooser";
import type { WebauthnPanel } from "../model/webauthn-panel";

/**
 * The passkey chooser.
 *
 * Design: docs/design/browser-challenges-and-passkeys.md.
 *
 * WHY IT IS A DIALOG IN THIS APP rather than a browser-native prompt: there is no
 * native prompt to fall back on. Electron surfaces multiple matching discoverable
 * credentials through the session event `select-webauthn-account`, and answering
 * it is the app's job — with no answer the request is cancelled with
 * `NotAllowedError`. So this dialog is the difference between the user choosing a
 * passkey and the site seeing a failure.
 *
 * THE COPY NAMES THE MECHANISM twice over, because both facts surprise people: the
 * choice is about which credential, and the OS sheet that follows is Touch ID —
 * the app cannot fingerprint for the user and does not pretend to. It stays
 * honest about the second one too: this app has no passkey provider sheet, so a
 * credential stored in a third-party manager will not appear here.
 *
 * EVERY SENTENCE IS DERIVED FROM THE REQUEST (the model's own header states why):
 * the lead says which case the user is in, the page note answers "which page is
 * this about" while the view is suppressed, and the queue note names the requests
 * waiting behind this one instead of letting a newer request replace it silently.
 *
 * WHAT IT RENDERS WHEN THE REQUEST IS ALREADY GONE: `panel.kind === "ending"`. A
 * request that expired or was cancelled left a live-looking dialog with
 * live-looking rows whose click was discarded in silence (design round 1, D2), so
 * the same panel reports the ending in words and offers nothing to press but
 * Close. That branch holds NO request, which is what makes the ending's Close
 * unable to answer anything — the round-1 shape kept a `notice` beside a live
 * request and its Close cancelled the request the user had never been shown
 * (agent review round 2, R1).
 */

export interface BrowserWebauthnDialogProps {
	open: boolean;
	/** What the panel is showing. One value rather than a request plus a notice
	 * slot, so the two cannot disagree about what the user is looking at. */
	panel: WebauthnPanel;
	/** Answers with the chosen credential id, echoed verbatim from the offer.
	 * Only ever called from the request branch. */
	onChoose: (credentialId: string) => void;
	/** Cancels the live request (main answers Electron's callback with nothing).
	 * Only ever called from the request branch. */
	onCancelRequest: () => void;
	/** Acknowledges an ending. Carries no request id: there is nothing left to
	 * settle by the time this panel is on screen. */
	onDismissEnding: () => void;
	/** Radix's own close hook, where focus is handed back to where it was. */
	onCloseAutoFocus: (event: Event) => void;
}

export const BrowserWebauthnDialog: FC<BrowserWebauthnDialogProps> = ({
	open,
	panel,
	onChoose,
	onCancelRequest,
	onDismissEnding,
	onCloseAutoFocus,
}) => {
	// The lead sentence is the dialog's description rather than decoration: it
	// carries what asked and what follows, and without it a screen reader
	// announces "Choose a passkey, dialog" and none of that (design round 1, D10).
	const describedById = useId();
	const request = panel.kind === "request" ? panel.request : null;
	// Narrowed once, because the JSX below reads it inside a branch TypeScript
	// cannot follow into the mapping closure.
	const answering = panel.kind === "request" ? panel.answering : false;
	const lead = request ? chooserLead(request) : "";
	const pageNote = request ? chooserPageNote(request) : null;
	const queueNote = chooserQueueNote(
		panel.kind === "request" ? panel.waitingBehind : 0,
	);
	/*
	 * The close path is chosen by what is on screen, not by what happens to be in
	 * the queue: the ending's close acknowledges an ending (and cancels nothing),
	 * the live request's cancels. The prompt's handlers re-check the same thing, so
	 * neither can reach the other's subject even if this resolution changes.
	 */
	const onClose =
		panel.kind === "ending" ? onDismissEnding : () => onCancelRequest();

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={panel.kind === "ending" ? panel.title : "Choose a passkey"}
			dataTourTag="browser-webauthn-dialog"
			// A stable width rather than shrink-to-fit, so the same dialog is the same
			// size for every site (design round 1, D7): `w-auto` followed the content
			// until the window or the cap bound it, which made a chooser whose content
			// varies most between instances the one that resized most.
			fullWidth
			maxWidth="xs"
			dialogProps={{
				"aria-describedby": describedById,
				onCloseAutoFocus,
			}}
			actions={
				// The Touch ID note is pinned HERE rather than left as the last child of
				// the scrolling body (design round 1, D8): with a long list it sat below
				// the fold, so the one sentence that says what happens next was the
				// sentence the state that needs it most could not see. The answering cue
				// is pinned with it for the same reason (design round 2, N1): it is the
				// only thing that explains the frozen rows, and it used to be the body's
				// last child — off the fold in exactly the long-list case.
				<div className="flex w-full flex-col gap-3">
					{panel.kind === "request" && (
						<p className="text-meta text-ink-dim">
							Your Mac will ask for Touch ID after you choose. This app can only
							use passkeys stored on this Mac — a passkey kept in another
							manager will not appear here.
						</p>
					)}
					<div className="flex items-center justify-end gap-3">
						{panel.kind === "request" && answering && (
							<p className="text-meta text-ink-muted">Answering…</p>
						)}
						<Button variant="ghost" size="sm" onClick={onClose}>
							{panel.kind === "ending" ? "Close" : "Cancel"}
						</Button>
					</div>
				</div>
			}
		>
			<div className="flex flex-col gap-3">
				{panel.kind === "ending" ? (
					<p className="text-body text-ink-muted" id={describedById}>
						{panel.body}
					</p>
				) : (
					<>
						<p className="text-body text-ink-muted" id={describedById}>
							{lead}
						</p>
						{pageNote && <p className="text-meta text-ink-dim">{pageNote}</p>}
						<div className="flex flex-col gap-1.5">
							{request?.accounts.map(
								(account: WebauthnAccountChoice, index: number) => {
									const detail = accountChoiceDetail(account, index);
									const voice = accountChoiceVoice(account);
									return (
										<Button
											key={account.credentialId}
											variant="outline"
											size="sm"
											disabled={answering}
											// `whitespace-normal` and `text-left` override the button
											// primitive's `whitespace-nowrap` and centred label: a long
											// display name was cut mid-character at the panel edge with no
											// ellipsis and no wrap, so the tail that tells two logins
											// apart — the part this dialog exists to show — was the part
											// that was lost (design round 1, D1).
											//
											// `disabled:[&>span]:text-ink-disabled` is the second half of
											// that fix: the spans now declare their own colours, so they
											// overrode the primitive's disabled colour and the Answering
											// state painted enabled-looking text inside a disabled button
											// (design round 2, N1).
											className={cn(
												"h-auto w-full flex-col items-start gap-0.5 py-2 text-left whitespace-normal disabled:[&>span]:text-ink-disabled",
											)}
											onClick={() => onChoose(account.credentialId)}
											data-tour-tag="browser-webauthn-account"
										>
											<span
												className={cn(
													"w-full text-left break-words",
													// A label that IS the login is set in the machine voice, so a
													// row identified by an address does not read as a person's
													// name (design round 1, D4); the positional fallback is
													// neither a person nor a machine string, so it leads the
													// row in the app's own voice (design round 2, N2).
													voice === "login"
														? "font-mono text-mono-sm text-ink-dim"
														: "text-body text-ink",
												)}
											>
												{accountChoiceLabel(account, index)}
											</span>
											{detail && (
												<span
													// A machine string that is still longer than the row truncates
													// with an ellipsis and carries its full value as a title, so the
													// tail is reachable instead of painted off the panel.
													className={cn(
														"w-full min-w-0 truncate font-mono text-mono-sm text-ink-dim",
													)}
													title={detail}
												>
													{detail}
												</span>
											)}
										</Button>
									);
								},
							)}
						</div>
						{queueNote && <p className="text-meta text-ink-dim">{queueNote}</p>}
					</>
				)}
			</div>
		</BaseDialog>
	);
};
