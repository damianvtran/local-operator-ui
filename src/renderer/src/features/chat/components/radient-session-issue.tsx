/**
 * @file radient-session-issue.tsx
 * @description
 * The callout that tells the operator their Radient sign-in is dead, with the
 * one action that starts it again.
 *
 * ## Why this is a callout and not a notice
 *
 * The composer band's other non-transient blocks (`heldNotice`,
 * `refusedNotice`, `abandonNotice`) are sentences: they report a state and the
 * remedy is something the user already knows how to do. This one carries an
 * ACTION, and an action is what the callout primitive exists for - it is the
 * same primitive the connectivity banner uses, which is the other place in this
 * app where a broken dependency is stated with its remedy beside it.
 *
 * ## Why it is silent in the two ways it can be
 *
 * `hidden` covers both "the backend says the login is fine" and "the backend
 * cannot say", because those have the same answer for this surface and only one
 * of them is a fact about the login. `unknown` is the backend's own word for a
 * verdict it could not reach, and it must never render as a nag: sending an
 * offline machine to a sign-in it does not need is the misdirection the whole
 * change exists to remove.
 *
 * ## Copy
 *
 * Every sentence about a FAILED or FINISHED operation is the backend's own
 * (`AuthOperation.message`), rendered verbatim: it is authored where the state
 * is decided, and a paraphrase here would be a second definition of the same
 * event. The sentences this file owns are the two the backend cannot write -
 * what the issue means, and what the connector does after a sign-in completes -
 * plus the pointer for the one state this surface deliberately cannot finish.
 *
 * ## One action, and where the other one goes
 *
 * The Radient sign-in is offered HERE and nowhere else in this surface: the
 * account section in Settings (PR #409) owns the account row's own copy, and
 * two sign-in buttons for one flow is how a user comes to press the one whose
 * state they cannot see. The Cancel offered while a flow is in flight is not a
 * second sign-in: it releases the single loopback port the backend's flow holds
 * (`DesktopAuth.start` refuses a concurrent one with 409).
 */

import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
} from "@shared/components/ui";
import type { RadientSessionIssue } from "@shared/hooks/use-radient-session-issue";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { CHAT_MEASURE } from "../chat-measure";

export type RadientSessionIssueCalloutProps = {
	/** What to say, or `hidden`. */
	issue: RadientSessionIssue;
	/** Start a Radient sign-in. */
	onSignIn: () => void;
	/** Cancel the sign-in this surface started. */
	onCancel: () => void;
	/** Whether the composer band is in its narrow-window layout. */
	isSmallView?: boolean;
};

/**
 * The issue's own sentence, per state.
 *
 * Kept as one function rather than four JSX branches so the two states that
 * differ only in tone cannot drift into saying different things about the same
 * situation.
 */
function issueProse(issue: RadientSessionIssue): string | null {
	switch (issue.kind) {
		case "needs-sign-in":
			return "Radient no longer accepts the sign-in stored on this machine. Sign in again to restore Radient models and remote access to this machine; the connector restarts on its own once the sign-in completes.";
		case "signing-in":
			return "Complete the sign-in in your browser. The connector restarts when it completes.";
		case "input-required":
			return `${issue.message} This surface cannot take the pasted code, so finish the sign-in from Settings, under Providers.`;
		case "settled":
			return issue.message;
		default:
			return null;
	}
}

export const RadientSessionIssueCallout: FC<
	RadientSessionIssueCalloutProps
> = ({ issue, onSignIn, onCancel, isSmallView = false }) => {
	if (issue.kind === "hidden") return null;

	/*
	 * The band's own horizontal inset, not the alert's `p-3`.
	 *
	 * The composer band is read as one unit with the box, which is why every
	 * block in it shares the box contents' `px-4` / `px-2` step - measured on an
	 * earlier round as a 13px ragged edge between a block at `px-1` and the text
	 * it points at. A callout whose border sits on a different edge than the
	 * sentence under it reads as unrelated chrome, and this block's whole job is
	 * to be read. `cn` routes through `tailwind-merge`, so this wins over the
	 * variant's own padding rather than fighting it.
	 */
	const frame = cn(CHAT_MEASURE, isSmallView ? "px-2 py-2" : "px-4 py-2");

	const signingIn = issue.kind === "signing-in";
	const actionable =
		issue.kind === "needs-sign-in" ||
		(issue.kind === "settled" && issue.canRetry);

	return (
		<Alert
			variant={
				signingIn
					? "info"
					: issue.kind === "settled" && !issue.canRetry
						? "danger"
						: "warning"
			}
			/*
			 * The kind as an attribute, in the shape this repository's other
			 * surfaces use (`data-lo-composer-band`), so a driver scene can read
			 * which state is on screen without matching prose. The copy is not a
			 * contract a scene should key on.
			 */
			data-lo-radient-issue={issue.kind}
			/*
			 * No `role="alert"`: this block is on the page for as long as the
			 * condition holds, and the primitive's own docblock reserves the
			 * assertive role for a callout rendered IN RESPONSE to an action -
			 * which is the composer's send-error alert, not this one. A screen
			 * reader meets it in document order, above the box.
			 */
			className={frame}
			icon={signingIn ? <Spinner size="sm" /> : undefined}
		>
			{issue.kind === "needs-sign-in" && (
				<AlertTitle>Radient needs re-authentication</AlertTitle>
			)}
			{signingIn && <AlertTitle>Signing in to Radient</AlertTitle>}
			{issue.kind === "input-required" && (
				<AlertTitle>Radient sign-in needs a pasted code</AlertTitle>
			)}
			<AlertDescription>{issueProse(issue)}</AlertDescription>
			{issue.kind === "needs-sign-in" && issue.remedy?.command ? (
				/*
				 * The backend's own remedy, shown rather than run: the tunnel route
				 * is read-only by construction and its remedy is a terminal command,
				 * which is the one form this app must not execute on the user's
				 * behalf. It is rendered when it DIFFERS from what the button does -
				 * a parked connector can name a re-enrolment the sign-in will not
				 * clear - because a second instruction that says the same thing as
				 * the button is noise.
				 */
				<AlertDescription className={cn("text-ink-muted")}>
					{`If signing in does not clear this, run ${issue.remedy.command} in a terminal.`}
				</AlertDescription>
			) : null}
			<div className={cn("flex min-h-6 flex-wrap items-center gap-3")}>
				{actionable && (
					<Button
						type="button"
						variant="link"
						size="sm"
						// `underline` at rest, matching the composer alert's own actions:
						// `link` underlines only on hover and active, so without this the
						// affordance is carried by colour alone, which is not one.
						className={cn("cursor-pointer text-body-sm underline")}
						onClick={onSignIn}
					>
						Sign in to Radient
					</Button>
				)}
				{(signingIn || issue.kind === "input-required") && (
					<Button
						type="button"
						variant="link"
						size="sm"
						className={cn("cursor-pointer text-body-sm underline")}
						onClick={onCancel}
					>
						Cancel
					</Button>
				)}
			</div>
		</Alert>
	);
};
