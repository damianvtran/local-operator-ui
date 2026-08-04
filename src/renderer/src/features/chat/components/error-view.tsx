import { Alert, AlertDescription, AlertTitle } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";

/**
 * Props for the ErrorView component
 */
type ErrorViewProps = {
	message: string;
};

/**
 * ErrorView Component
 *
 * Displays an error message when there's an issue loading content.
 *
 * The pane itself is only the centring ground — the failure is carried by a
 * `danger` Alert, so the colour step comes from the semantic role rather than
 * from a red-tinted heading floating on an empty surface. `role="alert"` is
 * set here because this mounts in response to a failed load, which is exactly
 * the case the Alert primitive leaves to its callers.
 */
export const ErrorView: FC<ErrorViewProps> = ({ message }) => {
	return (
		<div
			className={cn(
				"flex h-full grow items-center justify-center bg-surface p-6",
			)}
		>
			<Alert variant="danger" role="alert" className={cn("max-w-[480px]")}>
				<AlertTitle>Error loading messages</AlertTitle>
				<AlertDescription>
					{message || "An unknown error occurred"}
				</AlertDescription>
			</Alert>
		</div>
	);
};
