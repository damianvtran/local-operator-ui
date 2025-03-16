import { Alert, Box, Snackbar, Typography } from "@mui/material";
import { Button } from "@mui/material";
import { useDeferredUpdatesStore } from "@renderer/store/deferred-updates-store";
import { useEffect, useState } from "react";

/**
 * Type definition for backend update information
 */
type BackendUpdateInfo = {
	currentVersion: string;
	latestVersion: string;
	updateCommand: string;
};

/**
 * Component that shows a button to manually check for updates
 */
export const CheckForUpdatesButton = () => {
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [snackbarOpen, setSnackbarOpen] = useState(false);
	const [noUpdateAvailable, setNoUpdateAvailable] = useState(false);
	const [devModeMessage, setDevModeMessage] = useState<string | null>(null);
	const [npxUpdateInfo, setNpxUpdateInfo] = useState<BackendUpdateInfo | null>(
		null,
	);
	const [backendUpdateInfo, setBackendUpdateInfo] =
		useState<BackendUpdateInfo | null>(null);
	const [backendUpdateCompleted, setBackendUpdateCompleted] = useState(false);
	const [updatingBackend, setUpdatingBackend] = useState(false);

	// Access the deferred updates store to clear deferred updates when manually checking
	const { clearDeferredUpdate } = useDeferredUpdatesStore();

	// Check for UI updates
	const checkForUpdates = async () => {
		try {
			setChecking(true);
			setError(null);
			setDevModeMessage(null);
			setNpxUpdateInfo(null);
			setBackendUpdateInfo(null);
			setBackendUpdateCompleted(false);

			// Clear any deferred updates to ensure we see all available updates
			clearDeferredUpdate();

			// Check for all updates (UI and backend)
			await window.api.updater.checkForAllUpdates();

			// If no update event is fired, default to "no update available"
			setNoUpdateAvailable(true);
			setSnackbarOpen(true);
		} catch (err) {
			setError(
				`Error checking for updates: ${err instanceof Error ? err.message : String(err)}`,
			);
			setSnackbarOpen(true);
		} finally {
			setChecking(false);
		}
	};

	// Update the backend
	const updateBackend = async () => {
		try {
			setUpdatingBackend(true);
			setError(null);
			await window.api.updater.updateBackend();
		} catch (err) {
			setError(
				`Error updating backend: ${err instanceof Error ? err.message : String(err)}`,
			);
			setSnackbarOpen(true);
		} finally {
			setUpdatingBackend(false);
		}
	};

	// Set up event listeners for update events
	useEffect(() => {
		// Update not available
		const removeUpdateNotAvailableListener =
			window.api.updater.onUpdateNotAvailable(() => {
				setNoUpdateAvailable(true);
				setSnackbarOpen(true);
			});

		// Dev mode update
		const removeUpdateDevModeListener = window.api.updater.onUpdateDevMode(
			(message) => {
				setDevModeMessage(message);
				setChecking(false);
				setSnackbarOpen(true);
			},
		);

		// NPX update available
		const removeUpdateNpxAvailableListener =
			window.api.updater.onUpdateNpxAvailable((info) => {
				setNpxUpdateInfo(info);
				setChecking(false);
				setSnackbarOpen(true);
			});

		// Backend update available
		const removeBackendUpdateAvailableListener =
			window.api.updater.onBackendUpdateAvailable((info) => {
				setBackendUpdateInfo(info);
				setChecking(false);
				setSnackbarOpen(true);
			});

		// Backend update not available
		const removeBackendUpdateNotAvailableListener =
			window.api.updater.onBackendUpdateNotAvailable(() => {
				// This is handled by the general "no update available" state
			});

		// Backend update completed
		const removeBackendUpdateCompletedListener =
			window.api.updater.onBackendUpdateCompleted(() => {
				setBackendUpdateCompleted(true);
				setBackendUpdateInfo(null);
				setUpdatingBackend(false);
				setSnackbarOpen(true);
			});

		// Update error
		const removeUpdateErrorListener = window.api.updater.onUpdateError(
			(errorMessage) => {
				setError(errorMessage);
				setChecking(false);
				setUpdatingBackend(false);
				setSnackbarOpen(true);
			},
		);

		// Clean up event listeners
		return () => {
			removeUpdateNotAvailableListener();
			removeUpdateDevModeListener();
			removeUpdateNpxAvailableListener();
			removeBackendUpdateAvailableListener();
			removeBackendUpdateNotAvailableListener();
			removeBackendUpdateCompletedListener();
			removeUpdateErrorListener();
		};
	}, []);

	// Handle snackbar close
	const handleSnackbarClose = () => {
		setSnackbarOpen(false);
		setNoUpdateAvailable(false);
		setDevModeMessage(null);
		setNpxUpdateInfo(null);
		setBackendUpdateCompleted(false);
	};

	// Handle copying a command to clipboard
	const handleCopyCommand = (command: string) => {
		navigator.clipboard.writeText(command);
		// Show a temporary message that the command was copied
		setError("Command copied to clipboard!");
		setTimeout(() => {
			setError(null);
		}, 2000);
	};

	// Define snackbar content based on the current state
	let snackbarContent: JSX.Element | null = null;

	if (error) {
		snackbarContent = (
			<Alert onClose={handleSnackbarClose} severity="error">
				{error}
			</Alert>
		);
	} else if (backendUpdateCompleted) {
		snackbarContent = (
			<Alert onClose={handleSnackbarClose} severity="success">
				Backend updated successfully
			</Alert>
		);
	} else if (backendUpdateInfo) {
		snackbarContent = (
			<Alert
				onClose={handleSnackbarClose}
				severity="info"
				action={
					<>
						<Button
							color="inherit"
							size="small"
							onClick={() => handleCopyCommand(backendUpdateInfo.updateCommand)}
							sx={{ mr: 1 }}
						>
							Copy
						</Button>
						<Button
							color="primary"
							size="small"
							onClick={updateBackend}
							disabled={updatingBackend}
						>
							{updatingBackend ? "Updating..." : "Update"}
						</Button>
					</>
				}
			>
				<Typography variant="body2" sx={{ mb: 1 }}>
					Backend update available: {backendUpdateInfo.latestVersion} (current:{" "}
					{backendUpdateInfo.currentVersion})
				</Typography>
				<Typography variant="body2">
					To update manually, run:{" "}
					<code>{backendUpdateInfo.updateCommand}</code>
				</Typography>
			</Alert>
		);
	} else if (npxUpdateInfo) {
		snackbarContent = (
			<Alert
				onClose={handleSnackbarClose}
				severity="info"
				action={
					<Button
						color="inherit"
						size="small"
						onClick={() => handleCopyCommand(npxUpdateInfo.updateCommand)}
					>
						Copy
					</Button>
				}
			>
				<Typography variant="body2" sx={{ mb: 1 }}>
					UI update available: {npxUpdateInfo.latestVersion} (current:{" "}
					{npxUpdateInfo.currentVersion})
				</Typography>
				<Typography variant="body2">
					To update, run: <code>{npxUpdateInfo.updateCommand}</code>
				</Typography>
			</Alert>
		);
	} else if (devModeMessage) {
		snackbarContent = (
			<Alert onClose={handleSnackbarClose} severity="info">
				{devModeMessage}
			</Alert>
		);
	} else if (noUpdateAvailable) {
		snackbarContent = (
			<Alert onClose={handleSnackbarClose} severity="info">
				You're using the latest version
			</Alert>
		);
	}

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

			{snackbarOpen && snackbarContent && (
				<Snackbar
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={handleSnackbarClose}
					anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				>
					{snackbarContent}
				</Snackbar>
			)}
		</>
	);
};
