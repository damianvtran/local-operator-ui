import { BaseDialog } from "@shared/components/common/base-dialog";
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { type FC, useId } from "react";
import {
	type WebauthnAccountChoice,
	type WebauthnChoiceRequest,
	accountChoiceDetail,
	accountChoiceLabel,
	accountChoiceVoice,
	chooserLead,
	chooserPageNote,
	chooserQueueNote,
} from "../model/webauthn-chooser";

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
 * WHAT IT RENDERS WHEN THE REQUEST IS ALREADY GONE: `notice`. A request that
 * expired or was cancelled left a live-looking dialog with live-looking rows
 * whose click was discarded in silence (design round 1, D2), so the same panel
 * reports the ending in words and offers nothing to press but Close.
 */

export interface BrowserWebauthnDialogProps {
	open: boolean;
	/** The request being answered, or null while none is pending. */
	request: WebauthnChoiceRequest | null;
	/** Further requests waiting behind this one, which main holds in arrival
	 * order. Named rather than hidden: replacing one request with the next would
	 * leave the first unanswered with nothing on screen to say so. */
	waitingBehind: number;
	/** True while THIS dialog's answer is in flight. Deliberately not the
	 * surface's shared busy flag: an unrelated action in flight must not freeze
	 * the one dialog whose buttons answer a request that is timing out. */
	answering: boolean;
	/** The ending to report instead of the choice, or null while it is live. */
	notice: { title: string; body: string } | null;
	/** Cancels the request (main answers Electron's callback with nothing). */
	onDismiss: () => void;
	/** Answers with the chosen credential id, echoed verbatim from the offer. */
	onChoose: (credentialId: string) => void;
}

export const BrowserWebauthnDialog: FC<BrowserWebauthnDialogProps> = ({
	open,
	request,
	waitingBehind,
	answering,
	notice,
	onDismiss,
	onChoose,
}) => {
	// The lead sentence is the dialog's description rather than decoration: it
	// carries what asked and what follows, and without it a screen reader
	// announces "Choose a passkey, dialog" and none of that (design round 1, D10).
	const describedById = useId();
	const lead = request ? chooserLead(request) : "";
	const pageNote = request ? chooserPageNote(request) : null;
	const queueNote = chooserQueueNote(waitingBehind);

	return (
		<BaseDialog
			open={open}
			onClose={onDismiss}
			title={notice ? notice.title : "Choose a passkey"}
			dataTourTag="browser-webauthn-dialog"
			// A stable width rather than shrink-to-fit, so the same dialog is the same
			// size for every site (design round 1, D7): `w-auto` followed the content
			// until the window or the cap bound it, which made a chooser whose content
			// varies most between instances the one that resized most.
			fullWidth
			maxWidth="xs"
			dialogProps={{ "aria-describedby": describedById }}
			actions={
				// The Touch ID note is pinned HERE rather than left as the last child of
				// the scrolling body (design round 1, D8): with a long list it sat below
				// the fold, so the one sentence that says what happens next was the
				// sentence the state that needs it most could not see.
				<div className="flex w-full flex-col gap-3">
					{!notice && (
						<p className="text-meta text-ink-dim">
							Your Mac will ask for Touch ID after you choose. This app can only
							use passkeys stored on this Mac — a passkey kept in another
							manager will not appear here.
						</p>
					)}
					<div className="flex justify-end">
						<Button variant="ghost" size="sm" onClick={onDismiss}>
							{notice ? "Close" : "Cancel"}
						</Button>
					</div>
				</div>
			}
		>
			<div className="flex flex-col gap-3">
				{notice ? (
					<p className="text-body text-ink-muted" id={describedById}>
						{notice.body}
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
											className={cn(
												"h-auto w-full flex-col items-start gap-0.5 py-2 text-left whitespace-normal",
											)}
											onClick={() => onChoose(account.credentialId)}
											data-tour-tag="browser-webauthn-account"
										>
											<span
												className={cn(
													"w-full text-left break-words",
													// A label that IS the login is set in the machine voice, so a
													// row identified by an address does not read as a person's
													// name (design round 1, D4).
													voice === "machine"
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
						{answering && (
							<p className="text-meta text-ink-muted">Answering…</p>
						)}
						{queueNote && <p className="text-meta text-ink-dim">{queueNote}</p>}
					</>
				)}
			</div>
		</BaseDialog>
	);
};
