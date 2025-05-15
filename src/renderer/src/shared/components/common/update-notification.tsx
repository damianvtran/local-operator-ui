import {
	Alert,
	Button,
	LinearProgress,
	Link,
	Snackbar,
	Typography,
	styled,
} from "@mui/material";
import {
	UpdateType,
	useDeferredUpdatesStore,
} from "@shared/store/deferred-updates-store";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import parse from "html-react-parser";
import { useCallback, useEffect, useState, useRef } from "react";

// Define types for backend update info
type BackendUpdateInfo = {
	currentVersion: string;
	latestVersion: string;
	updateCommand: string;
	canManageUpdate?: boolean; // Make optional to match API
	startupMode?: string;
};

// Styled components
export const UpdateContainer = styled("div")(({ theme }) => ({
	padding: 24,
	borderRadius: 8,
	backgroundColor: theme.palette.background.paper,
	boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
	position: "fixed",
	top: 20,
	right: 20,
	zIndex: 1300, // Higher than most components but below modal dialogs
	width: 560, // Responsive width with margins
	"& a": {
		color: theme.palette.primary.main,
		textDecoration: "none",
		"&:hover": {
			textDecoration: "underline",
		},
	},
}));

export const UpdateActions = styled("div")({
	display: "flex",
	justifyContent: "flex-end",
	gap: 8,
	marginTop: 24,
});

export const ProgressContainer = styled("div")({
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
	// State for frontend update status
	const [checking, setChecking] = useState(false);
	const [updatingBackend, setUpdatingBackend] = useState(false);
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

	// State for backend update status
	const [backendUpdateAvailable, setBackendUpdateAvailable] = useState(false);
	const [backendUpdateInfo, setBackendUpdateInfo] =
		useState<BackendUpdateInfo | null>(null);
	const [backendUpdateCompleted, setBackendUpdateCompleted] = useState(false);
	const [manualUpdateRequired, setManualUpdateRequired] = useState(false);
	const [manualUpdateInfo, setManualUpdateInfo] = useState<{
		message: string;
		command: string;
	} | null>(null);

	// Access the deferred updates store
	const { shouldShowUpdate, deferUpdate } = useDeferredUpdatesStore();

	// Get app version on mount
	// Keep a ref to the latest backendUpdateInfo for use in event handlers
	const backendUpdateInfoRef = useRef<BackendUpdateInfo | null>(null);
	useEffect(() => {
		backendUpdateInfoRef.current = backendUpdateInfo;
	}, [backendUpdateInfo]);

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

	// Update the backend
	const updateBackend = useCallback(async () => {
		try {
			setChecking(true);
			setUpdatingBackend(true);
			setError(null);
			await window.api.updater.updateBackend();
			// The backend update completed event will handle the UI update
		} catch (err) {
			setError(
				`Error updating server: ${err instanceof Error ? err.message : String(err)}`,
			);
			setSnackbarOpen(true);
			setChecking(false);
			setUpdatingBackend(false);
		}
	}, []);

	// Handle deferring a backend update
	const handleDeferBackendUpdate = useCallback(() => {
		if (backendUpdateInfo) {
			deferUpdate(UpdateType.BACKEND, backendUpdateInfo.latestVersion);
			setSnackbarOpen(false);
			setBackendUpdateAvailable(false);
			setBackendUpdateInfo(null);
		}
	}, [deferUpdate, backendUpdateInfo]);

	// Handle deferring an update
	const handleDeferUpdate = useCallback(() => {
		if (updateInfo) {
			deferUpdate(UpdateType.UI, updateInfo.version);
			setSnackbarOpen(false);
			setUpdateAvailable(false);
			setUpdateDownloaded(false);
		}
	}, [deferUpdate, updateInfo]);

	// Set up event listeners for update events
	useEffect(() => {
		// Frontend update available
		const removeUpdateAvailableListener = window.api.updater.onUpdateAvailable(
			(info) => {
				// Only show the update if it hasn't been deferred or the defer timeline has passed
				if (shouldShowUpdate(UpdateType.UI, info.version)) {
					setUpdateAvailable(true);
					setUpdateInfo(info);
					setSnackbarOpen(true);
				}
			},
		);

		// Frontend update not available
		const removeUpdateNotAvailableListener =
			window.api.updater.onUpdateNotAvailable(() => {
				setUpdateAvailable(false);
				setUpdateInfo(null);
			});

		// Frontend update downloaded
		const removeUpdateDownloadedListener =
			window.api.updater.onUpdateDownloaded((info) => {
				setDownloading(false);
				// Only show the update if it hasn't been deferred or the defer timeline has passed
				if (shouldShowUpdate(UpdateType.UI, info.version)) {
					setUpdateDownloaded(true);
					setUpdateInfo(info);
					setSnackbarOpen(true);
				}
			});

		// Frontend update error - also handle manual update requirements
		const removeUpdateErrorListener = window.api.updater.onUpdateError(
			(errorMessage) => {
				// Check if this is a manual update message
				if (errorMessage.includes("manually")) {
					setManualUpdateRequired(true);
					setManualUpdateInfo({
						message:
							"Please update the local-operator package manually using pip.",
						command: "pip install --upgrade local-operator",
					});
					setSnackbarOpen(true);
				} else {
					setError(errorMessage);
					setChecking(false);
					setDownloading(false);
					setSnackbarOpen(true);
				}
			},
		);

		// Frontend update progress
		const removeUpdateProgressListener = window.api.updater.onUpdateProgress(
			(progressObj) => {
				setDownloadProgress(progressObj);
			},
		);

		// Backend update available
		const removeBackendUpdateAvailableListener =
			window.api.updater.onBackendUpdateAvailable((info) => {
				if (shouldShowUpdate(UpdateType.BACKEND, info.latestVersion)) {
					const enhancedInfo: BackendUpdateInfo = {
						...info,
						canManageUpdate: !info.updateCommand.includes("manually"),
					};
					setBackendUpdateAvailable(true);
					setBackendUpdateInfo(enhancedInfo);
					setSnackbarOpen(true);
				}
			});

		// Backend update not available
		const removeBackendUpdateNotAvailableListener =
			window.api.updater.onBackendUpdateNotAvailable((info) => {
				// Only clear the notification if the backend version is up to date
				const currentInfo = backendUpdateInfoRef.current;
				setBackendUpdateAvailable((prev) => {
					if (
						currentInfo &&
						currentInfo.latestVersion === info.version
					) {
						setBackendUpdateInfo(null);
						return false;
					}
					return prev;
				});
			});

		// Backend update completed
		const removeBackendUpdateCompletedListener =
			window.api.updater.onBackendUpdateCompleted(() => {
				setBackendUpdateAvailable(false);
				setBackendUpdateInfo(null);
				setChecking(false);
				setUpdatingBackend(false);
				setBackendUpdateCompleted(true);
				setSnackbarOpen(true);

				// Auto-hide the completion notification after 6 seconds
				setTimeout(() => {
					setBackendUpdateCompleted(false);
				}, 6000);
			});

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
			removeBackendUpdateAvailableListener();
			removeBackendUpdateNotAvailableListener();
			removeBackendUpdateCompletedListener();
		};
	}, [autoCheck, checkForUpdates, shouldShowUpdate]);

	// Handle snackbar close
	const handleSnackbarClose = () => {
		setSnackbarOpen(false);
	};

	// If checking for updates or updating backend, show a loading indicator
	if (checking) {
		return (
			<UpdateContainer>
				<Typography variant="h6">
					{updatingBackend ? "Updating Server" : "Checking for Updates"}
				</Typography>
				<Typography variant="body1">
					{updatingBackend
						? "Please wait while the server is being updated.  The server will temporarily go offline while it restarts to apply the update."
						: "Please wait while we check for available updates..."}
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
							<>
								<Button
									variant="contained"
									color="primary"
									onClick={downloadUpdate}
									disabled={downloading}
								>
									Download Update
								</Button>
								<Button
									variant="outlined"
									onClick={handleDeferUpdate}
									disabled={downloading}
								>
									Update Later
								</Button>
							</>
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
						<Button variant="outlined" onClick={handleDeferUpdate}>
							Update Later
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

	// If a backend update is available
	if (backendUpdateAvailable && backendUpdateInfo) {
		return (
			<>
				<UpdateContainer>
					<Typography variant="h6">Server Update Available</Typography>
					<Typography variant="body1">
						Server version {backendUpdateInfo.latestVersion} is available. You
						are currently using version {backendUpdateInfo.currentVersion}.
					</Typography>
					<Typography variant="body2" sx={{ mt: 1 }}>
						Updating the server will improve AI functionality, improve security,
						and fix bugs.
					</Typography>

					{backendUpdateInfo.canManageUpdate ? (
						<UpdateActions>
							<Button
								variant="contained"
								color="primary"
								onClick={updateBackend}
								disabled={checking}
							>
								{checking ? "Updating..." : "Update Server"}
							</Button>
							<Button
								variant="outlined"
								onClick={handleDeferBackendUpdate}
								disabled={checking}
							>
								Update Later
							</Button>
						</UpdateActions>
					) : (
						<>
							<Typography variant="body2" sx={{ mt: 2, color: "warning.main" }}>
								The backend server is running externally and cannot be updated
								automatically. Please update it manually using the following
								command:
							</Typography>
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
								{backendUpdateInfo.updateCommand}
							</Typography>
							<UpdateActions>
								<Button
									variant="outlined"
									onClick={handleDeferBackendUpdate}
									disabled={checking}
								>
									Dismiss
								</Button>
							</UpdateActions>
						</>
					)}
				</UpdateContainer>

				<Snackbar
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={handleSnackbarClose}
					anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				>
					<Alert onClose={handleSnackbarClose} severity="info">
						A new server update is available: v{backendUpdateInfo.latestVersion}
					</Alert>
				</Snackbar>
			</>
		);
	}

	// If a manual update is required
	if (manualUpdateRequired && manualUpdateInfo) {
		return (
			<>
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
			</>
		);
	}

	// If a backend update has been completed
	if (backendUpdateCompleted) {
		return (
			<Snackbar
				open={true}
				autoHideDuration={6000}
				onClose={() => setBackendUpdateCompleted(false)}
				anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
			>
				<Alert
					onClose={() => setBackendUpdateCompleted(false)}
					severity="success"
				>
					Server update completed successfully
				</Alert>
			</Snackbar>
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
