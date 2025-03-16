import {
	Alert,
	Box,
	Button,
	LinearProgress,
	Link,
	Snackbar,
	Typography,
	styled,
} from "@mui/material";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import { useCallback, useEffect, useState } from "react";
import parse from "html-react-parser";

// Styled components
const UpdateContainer = styled("div")(({ theme }) => ({
	padding: 16,
	borderRadius: 8,
	backgroundColor: theme.palette.background.paper,
	boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
	position: "fixed",
	top: 20,
	right: 20,
	zIndex: 1300, // Higher than most components but below modal dialogs
	maxWidth: 400,
	width: "calc(100% - 40px)", // Responsive width with margins
}));

const UpdateActions = styled("div")({
	display: "flex",
	justifyContent: "flex-end",
	gap: 8,
	marginTop: 16,
});

const ProgressContainer = styled("div")({
	marginTop: 16,
	marginBottom: 8,
});

/**
 * Props for the UpdateNotification component
 */
type UpdateNotificationProps = {
	/** Whether to automatically check for updates on mount */
	autoCheck?: boolean;
};

/**
 * Component that handles application update notifications
 */
export const UpdateNotification = ({
	autoCheck = true,
}: UpdateNotificationProps) => {
	// State for update status
	const [checking, setChecking] = useState(false);
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
	const [downloading, setDownloading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState<ProgressInfo | null>(
		null,
	);
	const [updateDownloaded, setUpdateDownloaded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [snackbarOpen, setSnackbarOpen] = useState(false);
	const [appVersion, setAppVersion] = useState<string>("unknown");

	// Get app version on mount
	useEffect(() => {
		window.api.systemInfo
			.getAppVersion()
			.then((version) => setAppVersion(version))
			.catch(() => setAppVersion("unknown"));
	}, []);

	// Check for updates
	const checkForUpdates = useCallback(async () => {
		try {
			setChecking(true);
			setError(null);
			await window.api.updater.checkForUpdates();
		} catch (err) {
			setError(
				`Error checking for updates: ${err instanceof Error ? err.message : String(err)}`,
			);
			setSnackbarOpen(true);
		} finally {
			setChecking(false);
		}
	}, []);

	// Download the update
	const downloadUpdate = useCallback(async () => {
		try {
			setDownloading(true);
			setError(null);
			await window.api.updater.downloadUpdate();
		} catch (err) {
			setError(
				`Error downloading update: ${err instanceof Error ? err.message : String(err)}`,
			);
			setDownloading(false);
			setSnackbarOpen(true);
		}
	}, []);

	// Install the update
	const installUpdate = useCallback(() => {
		window.api.updater.quitAndInstall();
	}, []);

	// Set up event listeners for update events
	useEffect(() => {
		// Update available
		const removeUpdateAvailableListener = window.api.updater.onUpdateAvailable(
			(info) => {
				setUpdateAvailable(true);
				setUpdateInfo(info);
				setSnackbarOpen(true);
			},
		);

		// Update not available
		const removeUpdateNotAvailableListener =
			window.api.updater.onUpdateNotAvailable(() => {
				setUpdateAvailable(false);
				setUpdateInfo(null);
			});

		// Update downloaded
		const removeUpdateDownloadedListener =
			window.api.updater.onUpdateDownloaded((info) => {
				setDownloading(false);
				setUpdateDownloaded(true);
				setUpdateInfo(info);
				setSnackbarOpen(true);
			});

		// Update error
		const removeUpdateErrorListener = window.api.updater.onUpdateError(
			(errorMessage) => {
				setError(errorMessage);
				setChecking(false);
				setDownloading(false);
				setSnackbarOpen(true);
			},
		);

		// Update progress
		const removeUpdateProgressListener = window.api.updater.onUpdateProgress(
			(progressObj) => {
				setDownloadProgress(progressObj);
			},
		);

		// Check for updates on mount if autoCheck is true
		if (autoCheck) {
			checkForUpdates();
		}

		// Clean up event listeners
		return () => {
			removeUpdateAvailableListener();
			removeUpdateNotAvailableListener();
			removeUpdateDownloadedListener();
			removeUpdateErrorListener();
			removeUpdateProgressListener();
		};
	}, [autoCheck, checkForUpdates]);

	// Handle snackbar close
	const handleSnackbarClose = () => {
		setSnackbarOpen(false);
	};

	// If checking for updates, show a loading indicator
	if (checking) {
		return (
			<UpdateContainer>
				<Typography variant="h6">Checking for Updates</Typography>
				<Typography variant="body1">
					Please wait while we check for available updates...
				</Typography>
				<ProgressContainer>
					<LinearProgress />
				</ProgressContainer>
			</UpdateContainer>
		);
	}

	// If there's an error, show a snackbar
	if (error) {
		return (
			<Snackbar
				open={snackbarOpen}
				autoHideDuration={6000}
				onClose={handleSnackbarClose}
				anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
			>
				<Alert onClose={handleSnackbarClose} severity="error">
					{error}
				</Alert>
			</Snackbar>
		);
	}

	// If an update is available but not downloaded yet
	if (updateAvailable && !updateDownloaded && updateInfo) {
		return (
			<>
				<UpdateContainer>
					<Typography variant="h6">Update Available</Typography>
					<Typography variant="body1">
						Version {updateInfo.version} is available. You are currently using
						version {appVersion}.
					</Typography>
					{updateInfo.releaseNotes && (
						<Typography variant="body2" sx={{ mt: 1 }}>
							Release Notes:{" "}
							{typeof updateInfo.releaseNotes === "string" ? (
								<>
									{parse(truncateText(updateInfo.releaseNotes, 400))}
									{updateInfo.releaseNotes.length > 400 && (
										<Link
											href={getReleaseUrl(updateInfo)}
											target="_blank"
											rel="noopener noreferrer"
											sx={{ ml: 1 }}
										>
											View full release notes
										</Link>
									)}
								</>
							) : (
								<Link
									href={getReleaseUrl(updateInfo)}
									target="_blank"
									rel="noopener noreferrer"
								>
									See release notes on GitHub
								</Link>
							)}
						</Typography>
					)}

					{downloading && downloadProgress && (
						<ProgressContainer>
							<Typography variant="body2">
								Downloading: {Math.round(downloadProgress.percent)}%
							</Typography>
							<LinearProgress
								variant="determinate"
								value={downloadProgress.percent}
								sx={{ mt: 1 }}
							/>
							<Typography variant="caption" sx={{ mt: 0.5, display: "block" }}>
								{Math.round(downloadProgress.transferred / 1024)} KB of{" "}
								{Math.round(downloadProgress.total / 1024)} KB
							</Typography>
						</ProgressContainer>
					)}

					<UpdateActions>
						{!downloading && (
							<Button
								variant="contained"
								color="primary"
								onClick={downloadUpdate}
								disabled={downloading}
							>
								Download Update
							</Button>
						)}
					</UpdateActions>
				</UpdateContainer>

				<Snackbar
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={handleSnackbarClose}
					anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				>
					<Alert onClose={handleSnackbarClose} severity="info">
						A new update is available: v{updateInfo.version}
					</Alert>
				</Snackbar>
			</>
		);
	}

	// If an update has been downloaded
	if (updateDownloaded && updateInfo) {
		return (
			<>
				<UpdateContainer>
					<Typography variant="h6">Update Ready to Install</Typography>
					<Typography variant="body1">
						Version {updateInfo.version} is available. You are currently using
						version {appVersion}.
					</Typography>
					<Typography variant="body2" sx={{ mt: 1 }}>
						The application will restart to apply the update.
					</Typography>

					<UpdateActions>
						<Button variant="contained" color="primary" onClick={installUpdate}>
							Install Now
						</Button>
						<Button variant="outlined" onClick={() => setSnackbarOpen(false)}>
							Install Later
						</Button>
					</UpdateActions>
				</UpdateContainer>

				<Snackbar
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={handleSnackbarClose}
					anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				>
					<Alert onClose={handleSnackbarClose} severity="success">
						Update downloaded and ready to install
					</Alert>
				</Snackbar>
			</>
		);
	}

	// If checking for updates or no update is available, don't render anything
	return null;
};

/**
 * Truncates text to a specified length and adds an ellipsis if needed
 * @param text The text to truncate
 * @param maxLength The maximum length of the text
 * @returns The truncated text with an ellipsis if needed
 */
const truncateText = (text: string, maxLength: number): string => {
	if (text.length <= maxLength) return text;
	return `${text.substring(0, maxLength)}...`;
};

/**
 * Gets the URL to the release notes
 * @param updateInfo The update information
 * @returns The URL to the release notes
 */
const getReleaseUrl = (updateInfo: UpdateInfo): string => {
	// Extract the repository URL from the update info if available
	if (updateInfo.releaseNotes && typeof updateInfo.releaseNotes !== "string") {
		// Handle the case where releaseNotes might be an object with a path property
		const releaseNotesObj = updateInfo.releaseNotes as { path?: string };
		const defaultUrl = `https://github.com/local-operator/local-operator-ui/releases/tag/v${updateInfo.version}`;
		return releaseNotesObj.path || defaultUrl;
	}

	// Default to GitHub releases page with the version tag
	return `https://github.com/local-operator/local-operator-ui/releases/tag/v${updateInfo.version}`;
};

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

	// Check for UI updates
	const checkForUpdates = async () => {
		try {
			setChecking(true);
			setError(null);
			setDevModeMessage(null);
			setNpxUpdateInfo(null);
			setBackendUpdateInfo(null);
			setBackendUpdateCompleted(false);

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
