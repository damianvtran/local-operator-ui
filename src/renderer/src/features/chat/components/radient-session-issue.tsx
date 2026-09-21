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
 * event. The sentences this file owns are the four the backend cannot write -
 * what the issue means, what the connector does once a sign-in completes, the
 * pointer for the state this surface deliberately cannot finish, and the
 * pointer for a refusal it cannot clear either.
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
import type {
	RadientRefusal,
	RadientSessionIssue,
} from "@shared/hooks/use-radient-session-issue";
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
	/** Clear a settled refusal this surface cannot act on. */
	onDismiss: () => void;
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
			/*
			 * TWO CLAUSES THIS SENTENCE USED TO CARRY, REMOVED ON MEASUREMENT
			 * (design round 1's D3/D4, agent review round 1's MIN-3).
			 *
			 * "and remote access to this machine" promised a restoration the
			 * sign-in does not unconditionally deliver: a sign-in can leave the
			 * connector parked, which is exactly the case the remedy line below
			 * exists for. "the connector restarts on its own once the sign-in
			 * completes" moved to the in-flight sentence, where it is the next
			 * thing that will happen rather than a second prediction - the state
			 * the user is deciding in now names the step the click takes.
			 *
			 * Naming the browser is what the pre-click state was missing: the
			 * consent step lives at console.radienthq.com and the click cannot
			 * remove it, so the user met the real shape of the interaction only
			 * after pressing. It is also what makes this sentence shorter at the
			 * app's narrowest window, where the block was 44% of the pane.
			 */
			return "Radient no longer accepts the sign-in stored on this machine. Signing in again restores Radient models and opens your browser for consent.";
		case "signing-in":
			/*
			 * The second clause is what actually ends an unfinished attempt, and
			 * it is stated here rather than when it fires (UX round 1, U4): the
			 * browser leg gives up on its own after about five minutes, well
			 * before the operation's 900 s bound, and the sentence the backend
			 * then sends sends the operator to inspect a provider that is fine.
			 * "A few minutes" rather than the rig's seconds figure: the bound is
			 * the backend's, this surface does not own it, and a number written
			 * here is a number that goes stale silently.
			 */
			return "Complete the sign-in in your browser. The connector restarts on its own once the sign-in completes; an attempt left unfinished ends after a few minutes.";
		case "input-required":
			return `${issue.message} This surface cannot take the pasted code, so finish the sign-in from Settings, under Providers.`;
		case "settled":
			return issue.message;
		default:
			return null;
	}
}

/**
 * Where a refusal the surface cannot clear actually has to be cleared.
 *
 * Only `sign-in-active` has an answer, and it is the one the sentence beside it
 * lacks: the backend says "finish or cancel it first" about a flow this surface
 * can neither see nor release, and Settings, under Providers, is the section
 * that started it and does offer Cancel (UX round 1, N2). `no-browser-flow`
 * answers `null` deliberately - its sentence already says what is wrong,
 * nothing on this machine can change it, and a pointer with nowhere to point
 * would be the same class of invented instruction this surface exists to
 * remove.
 */
function refusalPointer(refusal: RadientRefusal | undefined): string | null {
	if (refusal === "sign-in-active") {
		return "Finish or cancel it in Settings, under Providers.";
	}
	return null;
}

export const RadientSessionIssueCallout: FC<
	RadientSessionIssueCalloutProps
> = ({ issue, onSignIn, onCancel, onDismiss, isSmallView = false }) => {
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
	/*
	 * A FAILED attempt and a REFUSAL are two different severities, and that is
	 * what the variant now says (UX round 1's N1). It used to key on
	 * retryability: the benign "a sign-in is already active" took `danger` while
	 * a genuine failure took `warning`, so the loudest treatment landed on the
	 * least severe message. A refusal this surface cannot clear is a state with
	 * its own remedy elsewhere - a warning - whereas a failed or expired attempt
	 * is a failure of the action the user just took, which is the band's own
	 * `danger` (the send-error alert's ink).
	 */
	const failed = issue.kind === "settled" && issue.canRetry;
	const refusing = issue.kind === "settled" && !issue.canRetry;
	const actionable = issue.kind === "needs-sign-in" || failed;
	const cancellable = signingIn || issue.kind === "input-required";
	const pointer =
		issue.kind === "settled" ? refusalPointer(issue.refusal) : null;
	/*
	 * THE ROW IS RENDERED ONLY WHEN IT HAS SOMETHING IN IT (agent review round
	 * 1's NIT-2). It used to render unconditionally with `min-h-6`, so the one
	 * state that offers no control at all - a refusal this surface cannot clear,
	 * before it had a dismissal - reserved 24px under the sentence for nothing.
	 */
	const hasActions = actionable || cancellable || refusing;

	return (
		<Alert
			variant={signingIn ? "info" : failed ? "danger" : "warning"}
			/*
			 * The kind as an attribute, in the shape this repository's other
			 * surfaces use (`data-lo-composer-band`), so a driver scene can read
			 * which state is on screen without matching prose. The copy is not a
			 * contract a scene should key on.
			 */
			data-lo-radient-issue={issue.kind}
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
			{pointer ? (
				<AlertDescription className={cn("text-ink-muted")}>
					{pointer}
				</AlertDescription>
			) : null}
			{hasActions ? (
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
					{cancellable && (
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
					{refusing && (
						/*
						 * The exit that is not "press again" (agent review round 1, M-1).
						 * A refusal keeps no retry because pressing cannot change it, and
						 * nothing else cleared the phase - so this state was a standing
						 * sentence with no control at all, reachable from Settings, which
						 * starts the same flow. Dismissing drops the operation's memory and
						 * leaves what the backend says about the login, which is where the
						 * operator's next move belongs.
						 */
						<Button
							type="button"
							variant="link"
							size="sm"
							className={cn("cursor-pointer text-body-sm underline")}
							onClick={onDismiss}
						>
							Dismiss
						</Button>
					)}
				</div>
			) : null}
			{issue.kind === "needs-sign-in" && issue.remedy?.command ? (
				/*
				 * The backend's own remedy, shown rather than run: the tunnel route
				 * is read-only by construction and its remedy is a terminal command,
				 * which is the one form this app must not execute on the user's
				 * behalf.
				 *
				 * BELOW THE ACTION, which is the whole of design round 1's D2. It used
				 * to sit between the sentence and the button, where it read as the
				 * instruction and the button as the afterthought: a command the app
				 * cannot run and the user must leave the app to perform, placed above
				 * the one action the app can take for them. It is a FALLBACK - the
				 * case where a sign-in does not clear a connector that is still
				 * parked - so it is stated after the action, in muted ink.
				 *
				 * AND THIS COMMENT NO LONGER CLAIMS A COMPARISON THE CODE DOES NOT
				 * MAKE (agent review round 1, MIN-2). It said the line renders when
				 * the remedy "DIFFERS from what the button does", while the condition
				 * was `issue.remedy?.command` alone - and in the state on screen that
				 * difference does not exist: `lop login radient` IS the terminal form
				 * of the sign-in the button starts, so the line renders the duplicate
				 * the old comment ruled out. Suppressing it means comparing the
				 * backend's command against this app's own flow, which is prose this
				 * surface does not own and cannot keep in step; demoting it is the
				 * other half of the same fix, and its own wording already makes it
				 * conditional on the sign-in not being enough.
				 */
				<AlertDescription className={cn("text-ink-muted")}>
					{`If signing in does not clear this, run ${issue.remedy.command} in a terminal.`}
				</AlertDescription>
			) : null}
		</Alert>
	);
};
