import { Button } from "@shared/components/ui";
import { isDevelopmentMode } from "@shared/utils/env-utils";
import { RotateCw, TriangleAlert } from "lucide-react";
import type React from "react";
import type { ErrorInfo, ReactNode } from "react";
import {
	type FallbackProps,
	ErrorBoundary as ReactErrorBoundary,
} from "react-error-boundary";

/**
 * Props for the ErrorBoundary component
 */
type ErrorBoundaryProps = {
	/**
	 * The children to render
	 */
	children: ReactNode;

	/**
	 * Optional fallback component to render when an error occurs
	 */
	fallback?: ReactNode;
};

/**
 * What the user sees when a subtree has crashed.
 *
 * The panel sits directly on `canvas` rather than on its own `surface` card:
 * this fills the whole route, so there is nothing behind it for a card to be
 * raised above, and the border and radius only drew a box around an empty
 * screen. The message is the object here.
 *
 * The warning glyph was a hardcoded `#f44336`, a red belonging to no theme.
 * `text-danger` is the role for it.
 *
 * In development the message and stack are rendered as machine voice on
 * `sunken` — a code ground for code, which is the whole reason `sunken` exists
 * and is why the block needs no border to read as output.
 */
const ErrorFallback = ({ error, resetErrorBoundary }: FallbackProps) => (
	<div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
		<TriangleAlert size={48} aria-hidden="true" className="text-danger" />

		<div className="flex flex-col gap-2">
			<h2 className="text-title text-ink">Something went wrong</h2>
			<p className="max-w-150 text-body text-ink-muted">
				The application encountered an error. Try again, or contact support if
				the problem persists.
			</p>
		</div>

		<Button variant="primary" onClick={resetErrorBoundary}>
			<RotateCw aria-hidden="true" />
			Try again
		</Button>

		{isDevelopmentMode() && (
			<div className="w-full max-w-200 overflow-auto rounded-md bg-sunken p-4 text-left">
				<h3 className="mb-1 text-heading text-ink">Error details</h3>
				<pre className="mb-4 whitespace-pre-wrap text-ink-muted text-mono-sm">
					{error?.message}
				</pre>

				<h3 className="mb-1 text-heading text-ink">Stack trace</h3>
				<pre className="whitespace-pre-wrap text-ink-muted text-mono-sm">
					{error?.stack}
				</pre>
			</div>
		)}
	</div>
);

/**
 * Error boundary component that catches JavaScript errors in its child component tree
 * and displays a fallback UI instead of crashing the whole application.
 */
export const ErrorBoundary: React.FC<ErrorBoundaryProps> = ({
	children,
	fallback,
}) => {
	const onError = (error: Error, info: ErrorInfo) => {
		console.error("Error caught by ErrorBoundary:", error, info);
	};

	return (
		<ReactErrorBoundary
			FallbackComponent={fallback ? () => <>{fallback}</> : ErrorFallback}
			onError={onError}
		>
			{children}
		</ReactErrorBoundary>
	);
};
