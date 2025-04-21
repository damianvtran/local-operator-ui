import { Alert, Box, Button, Snackbar, Typography } from "@mui/material";
import { useDeferredUpdatesStore } from "@shared/store/deferred-updates-store";
import { useEffect, useState } from "react";

/**
 * Component that shows a button to manually check for updates.
 *
 * This component only provides the button UI and triggers the update check process.
 * It does not display any notifications itself - those are handled by the UpdateNotification
 * component at the app level to avoid duplicate notifications.
 */
export const CheckForUpdatesButton = () => {
	const [checking, setChecking] = useState(false);
	const [snackbarOpen, setSnackbarOpen] = useState(false);
	const [manualUpdateInfo, setManualUpdateInfo] = useState<{
		message: string;
		command: string;
	} | null>(null);

	// Access the deferred updates store to clear deferred updates when manually checking
	const { clearDeferredUpdate } = useDeferredUpdatesStore();

	// Listen for manual update required events
	useEffect(() => {
		const removeManualUpdateListener = window.api.updater.onUpdateError(
			(message) => {
				if (message.includes("manually")) {
					setManualUpdateInfo({
						message:
							"Please update the local-operator package manually using pip.",
						command: "pip install --upgrade local-operator",
					});
					setSnackbarOpen(true);
				}
			},
		);

		return () => {
			removeManualUpdateListener();
		};
	}, []);

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

	// Handle snackbar close
	const handleSnackbarClose = () => {
		setSnackbarOpen(false);
	};

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

			{/* Snackbar for manual update instructions */}
			{manualUpdateInfo && (
				<Snackbar
					open={snackbarOpen}
					autoHideDuration={10000}
					onClose={handleSnackbarClose}
					anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				>
					<Alert
						onClose={handleSnackbarClose}
						severity="warning"
						sx={{ width: "100%" }}
					>
						<Typography variant="body2">{manualUpdateInfo.message}</Typography>
						<Typography
							variant="body2"
							sx={{
								mt: 1,
								p: 1,
								backgroundColor: "background.default",
								borderRadius: 1,
								fontFamily: "monospace",
							}}
						>
							{manualUpdateInfo.command}
						</Typography>
					</Alert>
				</Snackbar>
			)}
		</>
	);
};
