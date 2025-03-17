import { Alert, Box, Button, styled } from "@mui/material";
import { useConnectivityStatus } from "@renderer/hooks/use-connectivity-status";
import { useEffect, useState } from "react";

// Styled components
const BannerContainer = styled(Box)(() => ({
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	zIndex: 2200, // High z-index to ensure it's above other content
	width: "100%",
}));

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

	// Update banner visibility when connectivity status changes
	useEffect(() => {
		// Always show banner if there's a connectivity issue, even during initial loading
		setShowBanner(hasConnectivityIssue);
	}, [hasConnectivityIssue]);

	// Also check navigator.onLine directly to immediately show banner when offline
	useEffect(() => {
		const handleOffline = () => {
			if (shouldCheckInternet) {
				setShowBanner(true);
			}
		};

		const handleOnline = () => {
			setShowBanner(false);
		};

		window.addEventListener("offline", handleOffline);
		window.addEventListener("online", handleOnline);

		return () => {
			window.removeEventListener("offline", handleOffline);
			window.removeEventListener("online", handleOnline);
		};
	}, [shouldCheckInternet]);

	// Auto-check connectivity on mount if enabled
	useEffect(() => {
		if (autoCheck) {
			// Initial check
			refetchServerStatus();
			if (shouldCheckInternet) {
				refetchInternetStatus();
			}

			// Set up interval for continuous checking with a more frequent check
			const intervalId = setInterval(() => {
				refetchServerStatus();
				if (shouldCheckInternet) {
					refetchInternetStatus();
				}
			}, 3000); // Check every 3 seconds for faster detection

			// Clean up interval on unmount
			return () => clearInterval(intervalId);
		}

		return undefined;
	}, [
		autoCheck,
		refetchServerStatus,
		refetchInternetStatus,
		shouldCheckInternet,
	]);

	// Force a check when shouldCheckInternet changes
	useEffect(() => {
		if (shouldCheckInternet) {
			refetchInternetStatus();
		}
	}, [shouldCheckInternet, refetchInternetStatus]);

	// Handle retry button click
	const handleRetry = () => {
		// Refetch both server and internet status
		refetchServerStatus();
		if (shouldCheckInternet) {
			refetchInternetStatus();
		}
	};

	// If no connectivity issues or still loading, don't show anything
	if (!showBanner) {
		return null;
	}

	return (
		<BannerContainer>
			<Alert
				severity="error"
				action={
					<Button color="inherit" size="small" onClick={handleRetry}>
						Retry
					</Button>
				}
				sx={{ borderRadius: 0 }}
			>
				{connectivityIssue === "server_offline" ? (
					<>
						The server is offline. The interface will not function properly
						until the server is back online.
					</>
				) : connectivityIssue === "internet_offline" ? (
					<>
						You are offline. Your configured hosting provider ({hostingProvider}
						) requires an internet connection.
					</>
				) : (
					<>A connectivity issue has been detected.</>
				)}
			</Alert>
		</BannerContainer>
	);
};
