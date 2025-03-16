import { useState, useEffect, useCallback } from "react";
import { styled } from "styled-components";
import {
	Button,
	Typography,
	LinearProgress,
	Box,
	Alert,
	Snackbar,
} from "@mui/material";
import type { UpdateInfo, ProgressInfo } from "electron-updater";

// Styled components
const UpdateContainer = styled.div`
  padding: 16px;
  border-radius: 8px;
  background-color: ${(props) => props.theme.palette.background.paper};
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  margin-bottom: 16px;
`;

const UpdateActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
`;

const ProgressContainer = styled.div`
  margin-top: 16px;
  margin-bottom: 8px;
`;

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
	const [_checking, setChecking] = useState(false);
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
	const [downloading, setDownloading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState<ProgressInfo | null>(
		null,
	);
	const [updateDownloaded, setUpdateDownloaded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [snackbarOpen, setSnackbarOpen] = useState(false);

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
						version {process.env.npm_package_version || "unknown"}.
					</Typography>
					{updateInfo.releaseNotes && (
						<Typography variant="body2" sx={{ mt: 1 }}>
							Release Notes:{" "}
							{typeof updateInfo.releaseNotes === "string"
								? updateInfo.releaseNotes
								: "See release notes on GitHub"}
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
						Version {updateInfo.version} has been downloaded and is ready to
						install.
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
 * Component that shows a button to manually check for updates
 */
export const CheckForUpdatesButton = () => {
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [snackbarOpen, setSnackbarOpen] = useState(false);
	const [noUpdateAvailable, setNoUpdateAvailable] = useState(false);

	// Check for updates
	const checkForUpdates = async () => {
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
	};

	// Set up event listeners for update events
	useEffect(() => {
		// Update not available
		const removeUpdateNotAvailableListener =
			window.api.updater.onUpdateNotAvailable(() => {
				setNoUpdateAvailable(true);
				setSnackbarOpen(true);
			});

		// Update error
		const removeUpdateErrorListener = window.api.updater.onUpdateError(
			(errorMessage) => {
				setError(errorMessage);
				setChecking(false);
				setSnackbarOpen(true);
			},
		);

		// Clean up event listeners
		return () => {
			removeUpdateNotAvailableListener();
			removeUpdateErrorListener();
		};
	}, []);

	// Handle snackbar close
	const handleSnackbarClose = () => {
		setSnackbarOpen(false);
		setNoUpdateAvailable(false);
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

			{error && (
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
			)}

			{noUpdateAvailable && (
				<Snackbar
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={handleSnackbarClose}
					anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				>
					<Alert onClose={handleSnackbarClose} severity="info">
						You're using the latest version
					</Alert>
				</Snackbar>
			)}
		</>
	);
};
