/**
 * Signing in to one integration, from Settings.
 *
 * Every sentence here states only what the app KNOWS, which is the whole of
 * this component's reason to exist beside the run panel's dialog:
 *
 * - Before the press it says what WILL happen ("Local Operator opens your
 *   browser…"), not "Your browser opens to approve access" - that line was on
 *   screen before anything opened, and on the walk nothing ever did (UX N2).
 * - After it, the browser is only said to have opened when the backend's
 *   operation reports `browser_opened: true`. `false` shows the link to open by
 *   hand; absent or `null` (an older backend, or the launcher not back yet)
 *   says the sign-in is waiting, and claims nothing about the browser.
 * - A failure carries the backend's own sanitized reason when there is one, and
 *   says the server gave none when there is not - never a bare
 *   "Sign-in failed." (UX N4).
 *
 * The operation's state comes from the list document the section already
 * polls while an operation runs, so this dialog adds no timer of its own.
 */

import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import type { FC } from "react";
import type { McpCatalogOperation } from "../../../../../../shared/desktop-control-contract";

export type SignInPhase =
	/** Not started: the dialog explains, the user presses Continue. */
	| { kind: "ready" }
	/** The start request is in flight. */
	| { kind: "starting" }
	/** Started; `operation` is the backend's record, once the list has it. */
	| { kind: "running"; operation: McpCatalogOperation | null }
	/** The start request itself was refused, already worded. */
	| { kind: "refused"; message: string };

/** The sentence for a running or settled operation, and whether it is final. */
export function signInProgress(
	name: string,
	operation: McpCatalogOperation | null,
): {
	message: string;
	tone: "progress" | "success" | "failure";
	link: string | null;
} {
	if (!operation || operation.status === "running") {
		if (operation?.browser_opened === true)
			return {
				message: `Your browser opened. Approve access to ${name} there, then come back here.`,
				tone: "progress",
				link: operation.authorization_url ?? null,
			};
		if (operation?.browser_opened === false)
			return {
				message: operation.authorization_url
					? "Your browser didn't open. Open this link to approve access:"
					: "Your browser didn't open, and no link was provided. Cancel and try again.",
				tone: "progress",
				link: operation.authorization_url ?? null,
			};
		return {
			message: `Waiting for you to approve access to ${name}…`,
			tone: "progress",
			link: operation?.authorization_url ?? null,
		};
	}
	if (operation.status === "complete")
		return {
			message: `Signed in to ${name}. Agents can use it now.`,
			tone: "success",
			link: null,
		};
	if (operation.status === "cancelled")
		return { message: "Sign-in cancelled.", tone: "failure", link: null };
	return {
		message: operation.message?.trim()
			? `Sign-in didn't finish: ${operation.message.trim()}`
			: "Sign-in didn't finish, and the server didn't say why. Try again, or check the server's URL.",
		tone: "failure",
		link: null,
	};
}

export type IntegrationSignInDialogProps = {
	name: string;
	/** `reauth` replaces an existing sign-in; the copy says so. */
	action: "login" | "reauth";
	phase: SignInPhase;
	onStart: () => void;
	onCancel: (operationId: string) => void;
	onOpenLink: (url: string) => void;
	onClose: () => void;
};

export const IntegrationSignInDialog: FC<IntegrationSignInDialogProps> = ({
	name,
	action,
	phase,
	onStart,
	onCancel,
	onOpenLink,
	onClose,
}) => {
	const operation = phase.kind === "running" ? phase.operation : null;
	const progress =
		phase.kind === "running" ? signInProgress(name, operation) : null;
	const running =
		phase.kind === "starting" ||
		(phase.kind === "running" && progress?.tone === "progress");
	const settled = progress && progress.tone !== "progress";

	return (
		<BaseDialog
			open
			onClose={onClose}
			maxWidth="xs"
			title={`Sign in to ${name}`}
			actions={
				<>
					{running && operation ? (
						<SecondaryButton onClick={() => onCancel(operation.id)}>
							Cancel sign-in
						</SecondaryButton>
					) : (
						<SecondaryButton onClick={onClose}>
							{progress?.tone === "success" ? "Done" : "Close"}
						</SecondaryButton>
					)}
					{phase.kind === "ready" ? (
						<PrimaryButton onClick={onStart}>Continue in browser</PrimaryButton>
					) : null}
					{phase.kind === "refused" || progress?.tone === "failure" ? (
						<PrimaryButton onClick={onStart}>Try again</PrimaryButton>
					) : null}
				</>
			}
		>
			<div
				className="flex flex-col gap-3 p-1.5 text-body text-ink-muted"
				aria-live="polite"
			>
				{phase.kind === "ready" ? (
					<p>
						Local Operator opens your browser so you can approve access to{" "}
						{name}.
						{action === "reauth"
							? " This replaces the sign-in it has now."
							: ""}
					</p>
				) : null}
				{phase.kind === "starting" ? (
					<p className="flex items-center gap-2">
						<Spinner size="xs" />
						Starting sign-in…
					</p>
				) : null}
				{progress ? (
					<p
						className={
							progress.tone === "failure"
								? "text-danger"
								: progress.tone === "success"
									? "text-ink"
									: "flex items-center gap-2"
						}
						role={settled ? "status" : undefined}
					>
						{progress.tone === "progress" ? <Spinner size="xs" /> : null}
						<span>{progress.message}</span>
					</p>
				) : null}
				{progress?.link && progress.tone === "progress" ? (
					<div className="flex flex-col items-start gap-1">
						<span
							className="max-w-full truncate font-mono text-ink-dim text-mono-sm"
							title={progress.link}
						>
							{progress.link}
						</span>
						<Button
							variant="link"
							size="sm"
							onClick={() => onOpenLink(progress.link ?? "")}
						>
							Open the sign-in page
						</Button>
					</div>
				) : null}
				{phase.kind === "refused" ? (
					<p className="text-danger" role="alert">
						{phase.message}
					</p>
				) : null}
			</div>
		</BaseDialog>
	);
};
