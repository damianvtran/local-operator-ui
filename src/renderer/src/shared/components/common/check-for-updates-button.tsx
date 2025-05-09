import { Alert, Box, Button, Snackbar, Typography } from "@mui/material";
import { useDeferredUpdatesStore, UpdateType } from "@shared/store/deferred-updates-store";
import { isDevelopmentMode } from "@shared/utils/env-utils";
import { useEffect, useRef, useState } from "react";

/**
 * Component that shows a button to manually check for updates.
 *
 * This component only provides the button UI and triggers the update check process.
 * It also displays confirmation and error notifications for manual update checks.
 */
export const CheckForUpdatesButton = () => {
	const [checking, setChecking] = useState(false);
	const [snackbarOpen, setSnackbarOpen] = useState(false);
	const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
	const [snackbarSeverity, setSnackbarSeverity] = useState<
		"success" | "info" | "warning" | "error"
	>("info");
	const [manualUpdateInfo, setManualUpdateInfo] = useState<{
		message: string;
		command: string;
	} | null>(null);

	// Used to track if the last check was manual (to avoid showing notifications for background checks)
	const manualCheckRef = useRef(false);

	// Access the deferred updates store to clear deferred updates when manually checking
	const { clearDeferredUpdate } = useDeferredUpdatesStore();

	useEffect(() => {
		// Listen for manual update required events and general update errors
		const removeUpdateErrorListener = window.api.updater.onUpdateError(
			(message: string) => {
				if (!manualCheckRef.current) return;
				// Only suppress known spurious errors
				const suppressedPatterns = [
					"ENOENT: no such file or directory, open", // e.g. missing update yml
					"Could not get code signature for running application", // macOS spurious
					"Cannot find latest.yml", // electron-updater
				];
				const isSuppressed = suppressedPatterns.some((pat) =>
					message.includes(pat),
				);

				if (message.includes("manually")) {
					setManualUpdateInfo({
						message:
							"Please update the local-operator package manually using pip.",
						command: "pip install --upgrade local-operator",
					});
					setSnackbarSeverity("warning");
					setSnackbarOpen(true);
				} else if (!isSuppressed) {
					setSnackbarMessage(message);
					setSnackbarSeverity("error");
					setSnackbarOpen(true);
				}
			},
		);

		// Listen for "no updates" events (frontend and backend)
		const removeUpdateNotAvailableListener =
			window.api.updater.onUpdateNotAvailable(() => {
				if (!manualCheckRef.current) return;
				setSnackbarMessage("No updates available. You are up to date!");
				setSnackbarSeverity("success");
				setSnackbarOpen(true);
			});
		const removeBackendUpdateNotAvailableListener =
			window.api.updater.onBackendUpdateNotAvailable(() => {
				if (!manualCheckRef.current) return;
				setSnackbarMessage("No server updates available. You are up to date!");
				setSnackbarSeverity("success");
				setSnackbarOpen(true);
			});

		return () => {
			removeUpdateErrorListener();
			removeUpdateNotAvailableListener();
			removeBackendUpdateNotAvailableListener();
		};
	}, []);

	// Check for updates
	const checkForUpdates = async () => {
		if (isDevelopmentMode()) {
			setSnackbarMessage(
				"Updates are not checked in development mode. This feature is only available in production builds.",
			);
			setSnackbarSeverity("info");
			setSnackbarOpen(true);
			return;
		}
		try {
			setChecking(true);
			manualCheckRef.current = true;

			// Clear any deferred updates to ensure we see all available updates
			clearDeferredUpdate(UpdateType.UI);
			clearDeferredUpdate(UpdateType.BACKEND);

			// Check for all updates (UI and backend)
			await window.api.updater.checkForAllUpdates();

			// The UpdateNotification component will handle displaying the results,
			// but we show confirmation/error for manual checks here.
		} catch (error) {
			setSnackbarMessage(
				`Error checking for updates: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			setSnackbarSeverity("error");
			setSnackbarOpen(true);
		} finally {
			setChecking(false);
			// Reset manual check flag after a short delay to allow event handlers to fire
			setTimeout(() => {
				manualCheckRef.current = false;
			}, 2000);
		}
	};

	// Handle snackbar close
	const handleSnackbarClose = () => {
		setSnackbarOpen(false);
		setSnackbarMessage(null);
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

			{/* Snackbar for general info, success, or error messages */}
			{snackbarMessage && (
				<Snackbar
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={handleSnackbarClose}
					anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				>
					<Alert
						onClose={handleSnackbarClose}
						severity={snackbarSeverity}
						sx={{ width: "100%" }}
					>
						{snackbarMessage}
					</Alert>
				</Snackbar>
			)}
		</>
	);
};
