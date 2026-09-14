import { Alert, type AlertProps, Button } from "@shared/components/ui";
import { X } from "lucide-react";
import { type FC, type ReactNode, useEffect } from "react";

/**
 * A semantic message that leaves the flow: fixed to the bottom-right corner,
 * optionally dismissing itself after a delay.
 *
 * It replaces MUI's `Snackbar` rather than routing through the app's sonner
 * toaster (`themed-toast-container.tsx`), because a sonner toast only appears
 * if that container is mounted — it is not, in Storybook, which is the only
 * harness some of these callers have.
 *
 * Two deliberate differences from `Snackbar`. There is no entrance animation,
 * for the reason written out at the top of `ui/tooltip.tsx`: a play-pending
 * `from: opacity 0` keyframe can strand the element invisible, and a message
 * you cannot see is worse than one that simply appears. And it does not close
 * on click-away, because the thing most worth clicking while it is up is
 * usually the panel behind it.
 *
 * This is not the top-of-window connectivity banner; that one is full-bleed,
 * square-cornered and persists on its own condition rather than a timer.
 */
export type FloatingAlertProps = {
	open: boolean;
	/** Fired by the dismiss button and by `autoHideDuration` elapsing. */
	onClose: () => void;
	/** Milliseconds before it dismisses itself. Omit to leave it up. */
	autoHideDuration?: number;
	variant?: AlertProps["variant"];
	/**
	 * How assistive tech is told. `Snackbar` was a live region, so dropping it
	 * silently would make every one of these messages invisible to a screen
	 * reader. Defaults to `alert` — interrupting — for `danger` and `warning`,
	 * and to the polite `status` for everything else.
	 */
	role?: "alert" | "status";
	/** Buttons rendered below the message, right-aligned. */
	action?: ReactNode;
	children: ReactNode;
};

export const FloatingAlert: FC<FloatingAlertProps> = ({
	open,
	onClose,
	autoHideDuration,
	variant = "info",
	role,
	action,
	children,
}) => {
	useEffect(() => {
		if (!open || autoHideDuration === undefined) return;
		const timer = window.setTimeout(onClose, autoHideDuration);
		// Cleared on unmount as well as on close, so a caller that unmounts mid
		// countdown cannot have `onClose` fire into a tree that is gone.
		return () => window.clearTimeout(timer);
	}, [open, autoHideDuration, onClose]);

	if (!open) return null;

	const liveRole =
		role ??
		(variant === "danger" || variant === "warning" ? "alert" : "status");

	return (
		<div className="fixed right-4 bottom-4 z-50 w-100 max-w-[calc(100vw-2rem)]">
			<Alert
				variant={variant}
				role={liveRole}
				className="relative pr-10 shadow-overlay"
			>
				{children}
				{action ? (
					<div className="flex justify-end gap-2 pt-1">{action}</div>
				) : null}
			</Alert>
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={onClose}
				aria-label="Dismiss"
				className="absolute top-1.5 right-1.5"
			>
				<X />
			</Button>
		</div>
	);
};

FloatingAlert.displayName = "FloatingAlert";
