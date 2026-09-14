import { Alert, AlertDescription, Button } from "@shared/components/ui";
import { useConnectivityStatus } from "@shared/hooks/use-connectivity-status";
import { useEffect, useState } from "react";

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
		// Refetch both server and internet status
		refetchServerStatus();
		if (shouldCheckInternet) {
			refetchInternetStatus();
		}
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

	return (
		/*
		 * Fixed and full-bleed: the banner spans the window rather than sitting
		 * inside the layout, so it is square-cornered and borderless on the left,
		 * right and top edges. The z-index clears the app chrome it covers.
		 */
		<div className="fixed inset-x-0 top-0 z-2200 w-full">
			<Alert
				variant={isInternetIssue ? "warning" : "danger"}
				// The banner appears in response to connectivity dropping while the
				// user is working, so it interrupts rather than waits to be found.
				role="alert"
				className="items-center rounded-none border-x-0 border-t-0"
			>
				<div className="flex w-full items-center justify-between gap-4">
					<AlertDescription>
						{connectivityIssue === "server_offline"
							? "The server is offline. The interface will not function properly until the server is back online."
							: isInternetIssue
								? `You are offline. Your configured hosting provider (${hostingProvider}) requires an internet connection.`
								: "A connectivity issue has been detected."}
					</AlertDescription>

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
