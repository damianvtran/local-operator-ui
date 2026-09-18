import { BaseDialog } from "@shared/components/common/base-dialog";
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import {
	type WebauthnAccountChoice,
	type WebauthnChoiceRequest,
	accountChoiceDetail,
	accountChoiceLabel,
} from "../model/webauthn-chooser";

/**
 * The passkey chooser.
 *
 * Design: docs/design/browser-challenges-and-passkeys.md.
 *
 * WHY IT IS A DIALOG IN THIS SURFACE rather than a browser-native prompt: there
 * is no native prompt to fall back on. Electron surfaces multiple matching
 * discoverable credentials through the session event
 * `select-webauthn-account`, and answering it is the app's job — with no answer
 * the request is cancelled with `NotAllowedError`. So this dialog is the
 * difference between the user choosing a passkey and the site seeing a failure.
 *
 * THE COPY NAMES THE MECHANISM twice over, because both facts surprise people:
 * the choice is about which credential, and the OS sheet that follows is Touch ID
 * — the app cannot fingerprint for the user and does not pretend to. It stays
 * honest about the second one too: this app has no passkey provider sheet, so a
 * credential stored in a third-party manager will not appear here.
 *
 * Dismissal is a real answer, not a dead end: the callback reaches main with a
 * null credential and the page's request is cancelled rather than left pending.
 */

export interface BrowserWebauthnDialogProps {
	open: boolean;
	/** The request being answered, or null while none is pending. */
	request: WebauthnChoiceRequest | null;
	busy: boolean;
	/** Cancels the request (main answers Electron's callback with nothing). */
	onDismiss: () => void;
	/** Answers with the chosen credential id, echoed verbatim from the offer. */
	onChoose: (credentialId: string) => void;
}

export const BrowserWebauthnDialog: FC<BrowserWebauthnDialogProps> = ({
	open,
	request,
	busy,
	onDismiss,
	onChoose,
}) => {
	return (
		<BaseDialog
			open={open}
			onClose={onDismiss}
			title="Choose a passkey"
			dataTourTag="browser-webauthn-dialog"
			actions={
				<Button variant="ghost" size="sm" onClick={onDismiss}>
					Cancel
				</Button>
			}
		>
			<div className="flex flex-col gap-3">
				<p className="text-body text-ink-muted">
					{request?.relyingPartyId
						? `${request.relyingPartyId} asked for a passkey.`
						: "A site asked for a passkey."}{" "}
					More than one of your passkeys matches, so pick the one to use.
				</p>
				<div className="flex flex-col gap-1.5">
					{request?.accounts.map(
						(account: WebauthnAccountChoice, index: number) => {
							const detail = accountChoiceDetail(account, index);
							return (
								<Button
									key={account.credentialId}
									variant="outline"
									size="sm"
									disabled={busy}
									className={cn(
										"h-auto w-full flex-col items-start gap-0.5 py-2",
									)}
									onClick={() => onChoose(account.credentialId)}
									data-tour-tag="browser-webauthn-account"
								>
									<span className="text-body">
										{accountChoiceLabel(account, index)}
									</span>
									{detail && (
										<span className="font-mono text-mono-sm text-ink-dim">
											{detail}
										</span>
									)}
								</Button>
							);
						},
					)}
				</div>
				<p className="text-meta text-ink-dim">
					Your Mac will ask for Touch ID after you choose. This app can only use
					passkeys stored on this Mac — a passkey kept in another manager will
					not appear here.
				</p>
			</div>
		</BaseDialog>
	);
};
