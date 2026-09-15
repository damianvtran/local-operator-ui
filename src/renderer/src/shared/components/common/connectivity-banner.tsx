import { Alert, AlertDescription, Button } from "@shared/components/ui";
import { useConnectivityStatus } from "@shared/hooks/use-connectivity-status";
import { useEffect, useState } from "react";
import { serverBannerCopy } from "../../../../../shared/backend-status";

/**
 * Props for the ConnectivityBanner component
 */
type ConnectivityBannerProps = {
	/** Whether to automatically check connectivity on mount */
	autoCheck?: boolean;
};

/**
 * Component that displays a banner when there are connectivity issues
 */
export const ConnectivityBanner = ({
	autoCheck = true,
}: ConnectivityBannerProps) => {
	// Get connectivity status
	const {
		hostingProvider,
		shouldCheckInternet,
		hasConnectivityIssue,
		connectivityIssue,
		serverSnapshot,
		refetchServerStatus,
		refetchInternetStatus,
	} = useConnectivityStatus();

	// State to track if the banner should be shown
	const [showBanner, setShowBanner] = useState(false);
	// State to track if the internet connectivity banner has been dismissed
	const [internetBannerDismissed, setInternetBannerDismissed] = useState(false);

	// Update banner visibility when connectivity status changes
	useEffect(() => {
		// Always show banner if there's a connectivity issue, even during initial loading
		// For internet issues, respect the dismissed state
		if (connectivityIssue === "internet_offline") {
			setShowBanner(hasConnectivityIssue && !internetBannerDismissed);
		} else {
			// For server issues, always show
			setShowBanner(hasConnectivityIssue);
		}
	}, [hasConnectivityIssue, connectivityIssue, internetBannerDismissed]);

	// Reset dismissed state when connectivity status changes
	useEffect(() => {
		// If connectivity is restored or changes, reset the dismissed state
		if (!hasConnectivityIssue || connectivityIssue !== "internet_offline") {
			setInternetBannerDismissed(false);
		}
	}, [hasConnectivityIssue, connectivityIssue]);

	// Also check navigator.onLine directly to immediately show banner when offline
	useEffect(() => {
		const handleOffline = () => {
			if (shouldCheckInternet) {
				setShowBanner(true);
				// Reset dismissed state when going offline
				setInternetBannerDismissed(false);
			}
		};

		const handleOnline = () => {
			setShowBanner(false);
			// Reset dismissed state when going online
			setInternetBannerDismissed(false);
		};

		window.addEventListener("offline", handleOffline);
		window.addEventListener("online", handleOnline);

		return () => {
			window.removeEventListener("offline", handleOffline);
			window.removeEventListener("online", handleOnline);
		};
	}, [shouldCheckInternet]);

	// Auto-check server connectivity on mount if enabled
	useEffect(() => {
		if (autoCheck) {
			// Initial check
			refetchServerStatus();

			// Set up interval for continuous checking of server status
			const intervalId = setInterval(() => {
				refetchServerStatus();
			}, 3000); // Check every 3 seconds for faster detection

			// Clean up interval on unmount
			return () => clearInterval(intervalId);
		}

		return undefined;
	}, [autoCheck, refetchServerStatus]);

	// Handle retry button click
	const handleRetry = () => {
		/*
		 * Retry has to ASK MAIN TO TRY, not re-read main's answer.
		 *
		 * The snapshot is a report about what main already did, and re-discovery is
		 * main's own timer, so once the liveness signal moved to main a renderer
		 * that only re-read the snapshot rendered a control that could not cause
		 * anything - inert in the one state that offers it. Without a bridge
		 * (Storybook, a plain browser dev server) there is nothing to ask, and the
		 * refetch below is the whole of what a retry can do there.
		 */
		void (async () => {
			try {
				await window.api?.backend?.reconnect?.();
			} finally {
				refetchServerStatus();
				if (shouldCheckInternet) {
					refetchInternetStatus();
				}
			}
		})();
	};

	// Handle dismiss button click (only for internet connectivity issues)
	const handleDismiss = () => {
		setInternetBannerDismissed(true);
		setShowBanner(false);
	};

	// If no connectivity issues or still loading, don't show anything
	if (!showBanner) {
		return null;
	}

	const isInternetIssue = connectivityIssue === "internet_offline";
	/*
	 * The server-side sentences come from the shared contract, not from this
	 * component: `detached`, `wedged` and the three paths into them each need a
	 * different sentence, and the one this banner used to render - "The server is
	 * offline" - asserted a transport fact for a connection state that three of
	 * those paths reach while a daemon is still running.
	 *
	 * A server issue the app is expected to recover from on its own is a WARNING
	 * rather than an alarm: "not connected, reconnecting" is not the same claim as
	 * "the server stopped", and the variant is the banner's own way of saying so.
	 */
	const serverIssue = isInternetIssue ? null : serverBannerCopy(serverSnapshot);
	const isTransientServerIssue = serverSnapshot?.reconnecting === true;

	return (
		/*
		 * Fixed and full-bleed: the banner spans the window rather than sitting
		 * inside the layout, so it is square-cornered and borderless on the left,
		 * right and top edges. The z-index clears the app chrome it covers.
		 */
		<div className="fixed inset-x-0 top-0 z-2200 w-full">
			<Alert
				variant={
					isInternetIssue
						? "warning"
						: isTransientServerIssue
							? "warning"
							: "danger"
				}
				// The banner appears in response to connectivity dropping while the
				// user is working, so it interrupts rather than waits to be found.
				role="alert"
				className="items-center rounded-none border-x-0 border-t-0"
			>
				<div className="flex w-full items-center justify-between gap-4">
					<div className="flex min-w-0 flex-col gap-1">
						<AlertDescription>
							{isInternetIssue
								? `You are offline. Your configured hosting provider (${hostingProvider}) requires an internet connection.`
								: (serverIssue?.title ??
									"A connectivity issue has been detected.")}
						</AlertDescription>
						{/*
						 * Main's own sentence about what it observed, as a second line. The
						 * title says which KIND of state this is; this says which path into it
						 * was taken (a credential refused, a probe answered by another
						 * process, a spawn this app is not allowed to make), which is what
						 * makes the banner diagnosable rather than merely honest.
						 */}
						{!isInternetIssue && serverIssue?.detail ? (
							<AlertDescription>{serverIssue.detail}</AlertDescription>
						) : null}
					</div>

					<div className="flex shrink-0 items-center gap-2">
						<Button variant="ghost" size="sm" onClick={handleRetry}>
							Retry
						</Button>
						{isInternetIssue && (
							<Button
								variant="ghost"
								size="sm"
								aria-label="dismiss"
								onClick={handleDismiss}
							>
								Dismiss
							</Button>
						)}
					</div>
				</div>
			</Alert>
		</div>
	);
};
