import { Alert, AlertDescription, AlertTitle } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";

/**
 * Props for the ErrorView component
 */
type ErrorViewProps = {
	message: string;
	/**
	 * The backend never answered. Only then may the copy say "once the local
	 * server is running": with the server up and refusing (401, 500, ...) that
	 * clause is a false claim about the user's machine, and a not-found is
	 * handled by the page before this view is reached.
	 */
	serverUnreachable?: boolean;
};

/**
 * The conversation could not be loaded.
 *
 * This is the third of the app's three places for a failure, and the rule is
 * about *who caused it and what survives it*:
 *
 * - A **user-initiated action** that fails — opening a file, saving a
 *   variable — gets a toast: transient, because the thing it refers to was
 *   transient.
 * - A **background probe** that fails gets nothing. It reports a fact the
 *   persistent connectivity banner already owns, and a second channel for the
 *   same fact is how "Failed to fetch" ended up stacked over a conversation.
 * - A **surface that cannot render** gets this: an inline failure in the space
 *   the content would have occupied, which does not time out and cannot be
 *   missed by looking away.
 *
 * `role="alert"` is set here because this mounts in response to a failed load,
 * which is exactly the case the Alert primitive leaves to its callers. The
 * ground is `canvas`, the same as the conversation it replaces.
 */
export const ErrorView: FC<ErrorViewProps> = ({
	message,
	serverUnreachable = false,
}) => {
	const description = serverUnreachable
		? message
			? `${message} The agent's history is safe — try again once the local server is running.`
			: "The local server did not answer. The agent's history is safe — try again once it is running."
		: message
			? `${message} The agent's history is safe — try again in a moment.`
			: "The local server returned an error. The agent's history is safe — try again in a moment.";
	return (
		<div
			className={cn(
				"flex h-full grow items-center justify-center bg-canvas p-6",
			)}
		>
			<Alert variant="danger" role="alert" className={cn("max-w-[480px]")}>
				<AlertTitle>Could not load this conversation</AlertTitle>
				<AlertDescription>{description}</AlertDescription>
			</Alert>
		</div>
	);
};
