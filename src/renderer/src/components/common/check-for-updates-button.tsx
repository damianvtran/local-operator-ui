import { Box } from "@mui/material";
import { Button } from "@mui/material";
import { useDeferredUpdatesStore } from "@renderer/store/deferred-updates-store";
import { useState } from "react";

/**
 * Component that shows a button to manually check for updates.
 *
 * This component only provides the button UI and triggers the update check process.
 * It does not display any notifications itself - those are handled by the UpdateNotification
 * component at the app level to avoid duplicate notifications.
 */
export const CheckForUpdatesButton = () => {
	const [checking, setChecking] = useState(false);
	// We only need to track the checking state for the button UI
	// All other states are tracked by the UpdateNotification component

	// Access the deferred updates store to clear deferred updates when manually checking
	const { clearDeferredUpdate } = useDeferredUpdatesStore();

	// Check for updates
	const checkForUpdates = async () => {
		try {
			setChecking(true);

			// Clear any deferred updates to ensure we see all available updates
			clearDeferredUpdate();

			// Check for all updates (UI and backend)
			await window.api.updater.checkForAllUpdates();

			// The UpdateNotification component will handle displaying the results
		} catch (error) {
			console.error("Error checking for updates:", error);
		} finally {
			setChecking(false);
		}
	};

	// We don't need to listen to update events anymore since UpdateNotification handles that

	return (
		<>
			<Button
				variant="outlined"
				onClick={checkForUpdates}
				disabled={checking}
				startIcon={
					checking ? <Box sx={{ width: 16, height: 16 }} /> : undefined
				}
			>
				{checking ? "Checking..." : "Check for Updates"}
			</Button>
		</>
	);
};
