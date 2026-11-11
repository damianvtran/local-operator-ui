import { Button } from "@shared/components/ui";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { RotateCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../../../../../i18n/messages";
import { ErrorBoundary } from "./error-boundary";

type InlineErrorBoundaryProps = {
	children: ReactNode;
	/**
	 * Values that release a caught error when they change (shallow compare).
	 * Pass the identity of what the subtree renders - a skill id, a channel id -
	 * so moving to another item renders it normally instead of inheriting the
	 * previous item's crash. Prefer this over a React `key` when the subtree's
	 * own state should survive ordinary re-renders.
	 */
	resetKeys?: readonly unknown[];
	/** Extra classes for the inline panel, so it can match its host's box. */
	className?: string;
	/** Stable hook for tests and the renderer driver. */
	testId?: string;
};

/**
 * A crash in ONE item's surface becomes an inline notice in that surface.
 *
 * WHY. Without a nearer boundary, any render error in a Bridge channel or a Hub
 * skill card propagated to the route-level `ErrorBoundary`, whose fallback fills
 * the window ("Something went wrong / Try again") - one malformed payload took
 * the whole app down (v0.53.2, crash reports for Team Bridge and Agent Hub →
 * Skills). This is the scoped sibling: the rest of the page stays mounted and
 * usable, and only the failing region says so.
 *
 * CONSTRAINTS.
 * - It is a containment layer, NOT a fix: the defect that threw must still be
 *   fixed at its source. A boundary does not catch errors in event handlers,
 *   async code or effects' cleanup ordering, only render/lifecycle errors.
 * - Logging goes through the shared `ErrorBoundary`, so the shipped log keeps
 *   the bounded, value-free `formatBoundaryError` line (error + component
 *   stack) the route boundary writes - one log format for every boundary.
 * - Copy reuses the already-translated route-boundary heading and Retry action,
 *   so every supported locale is covered without a new catalogue key.
 * - Retry calls `resetErrorBoundary`, which re-renders the children once; a
 *   deterministic crash simply lands back here, never in a loop.
 */
export function InlineErrorBoundary({
	children,
	resetKeys,
	className,
	testId = "inline-error-boundary",
}: InlineErrorBoundaryProps) {
	return (
		<ErrorBoundary
			resetKeys={resetKeys}
			fallbackRender={({ resetErrorBoundary }) => (
				<InlineErrorNotice
					className={className}
					testId={testId}
					onRetry={resetErrorBoundary}
				/>
			)}
		>
			{children}
		</ErrorBoundary>
	);
}

function InlineErrorNotice({
	className,
	testId,
	onRetry,
}: {
	className?: string;
	testId: string;
	onRetry: () => void;
}) {
	// Re-render the notice's copy on a locale change while it is shown.
	useI18nLocale();
	return (
		<div
			role="alert"
			data-testid={testId}
			className={cn(
				"flex flex-wrap items-center gap-2 rounded-sm border border-danger-border p-3 text-body-sm text-ink",
				className,
			)}
		>
			<TriangleAlert
				aria-hidden="true"
				className="size-4 shrink-0 text-danger"
			/>
			<span className="min-w-0 flex-1">
				{t("ui.common.errors.error_boundary.something_went_wrong")}
			</span>
			<Button variant="outline" size="sm" onClick={onRetry}>
				<RotateCw aria-hidden="true" />
				{t("ui.common.actions.retry_again")}
			</Button>
		</div>
	);
}
