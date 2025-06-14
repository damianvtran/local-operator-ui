import {
	Alert,
	Button,
	LinearProgress,
	Link,
	Snackbar,
	Typography,
	styled,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
	UpdateType,
	useDeferredUpdatesStore,
} from "@shared/store/deferred-updates-store";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import parse from "html-react-parser";
import { useCallback, useEffect, useRef, useState } from "react";

const RELEASE_ARTIFACT_ERROR_REGEX =
	/cannot find .* in the latest release artifacts/i;

// Define types for backend update info
type BackendUpdateInfo = {
	currentVersion: string;
	latestVersion: string;
	updateCommand: string;
	canManageUpdate?: boolean;
	startupMode?: string;
};

// Styled components following shadcn design patterns
export const UpdateContainer = styled("div")(({ theme }) => ({
	padding: theme.spacing(2.5),
	borderRadius: 8,
	backgroundColor: theme.palette.background.paper,
	border: `1px solid ${theme.palette.divider}`,
	boxShadow:
		"0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
	position: "fixed",
	top: theme.spacing(2.5),
	right: theme.spacing(2.5),
	zIndex: 1300,
	width: 400,
	maxWidth: "calc(100vw - 40px)",
	backgroundImage: "none",
	"& .update-title": {
		fontSize: "1.125rem",
		fontWeight: 600,
		lineHeight: 1.4,
		marginBottom: theme.spacing(1.5),
		color: theme.palette.text.primary,
	},
	"& .update-description": {
		fontSize: "0.875rem",
		lineHeight: 1.5,
		color: theme.palette.text.secondary,
		marginBottom: theme.spacing(1),
	},
	"& .update-notes": {
		fontSize: "0.8125rem",
		lineHeight: 1.4,
		color: theme.palette.text.secondary,
	},
	"& a": {
		color: theme.palette.primary.main,
		textDecoration: "none",
		fontWeight: 500,
		"&:hover": {
			textDecoration: "underline",
		},
	},
	[theme.breakpoints.down("sm")]: {
		width: "calc(100vw - 32px)",
		left: theme.spacing(2),
		right: theme.spacing(2),
		top: theme.spacing(2),
		padding: theme.spacing(2),
	},
}));

export const UpdateActions = styled("div")(({ theme }) => ({
	display: "flex",
	justifyContent: "flex-end",
	gap: theme.spacing(1.5),
	marginTop: theme.spacing(3),
}));

export const ProgressContainer = styled("div")(({ theme }) => ({
	marginTop: theme.spacing(2),
	marginBottom: theme.spacing(1),
}));

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
	const theme = useTheme();

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
			const errorMessage = err instanceof Error ? err.message : String(err);
			// If the error is because the release artifact is not found, don't show an error
			if (RELEASE_ARTIFACT_ERROR_REGEX.test(errorMessage)) {
				setUpdateAvailable(false);
				setUpdateInfo(null);
				console.warn(`Error checking for updates: ${errorMessage}`);
				return;
			}

			setError(`Error checking for updates: ${errorMessage}`);
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
				if (shouldShowUpdate(UpdateType.UI, info.version)) {
					setUpdateDownloaded(true);
					setUpdateInfo(info);
					setSnackbarOpen(true);
				}
			});

		// Frontend update error - also handle manual update requirements
		const removeUpdateErrorListener = window.api.updater.onUpdateError(
			(errorMessage) => {
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
				const currentInfo = backendUpdateInfoRef.current;
				setBackendUpdateAvailable((prev) => {
					if (currentInfo && currentInfo.latestVersion === info.version) {
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

	// Button styling to match agent header buttons
	const buttonSx = {
		textTransform: "none",
		fontSize: "0.8125rem",
		padding: theme.spacing(0.5, 1.5),
		borderRadius: theme.shape.borderRadius * 0.75,
	};

	const secondaryButtonSx = {
		...buttonSx,
		borderColor: theme.palette.divider,
		color: theme.palette.text.secondary,
		"&:hover": {
			backgroundColor: theme.palette.action.hover,
			borderColor: theme.palette.divider,
		},
	};

	// If checking for updates or updating backend, show a loading indicator
	if (checking) {
		return (
			<UpdateContainer>
				<Typography className="update-title">
					{updatingBackend ? "Updating Server" : "Checking for Updates"}
				</Typography>
				<Typography className="update-description">
					{updatingBackend
						? "Please wait while the server is being updated. The server will temporarily go offline while it restarts to apply the update."
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
					<Typography className="update-title">Update Available</Typography>
					<Typography className="update-description">
						Version {updateInfo.version} is available. You are currently using
						version {appVersion}.
					</Typography>
					{updateInfo.releaseNotes && (
						<Typography className="update-notes" sx={{ mt: 1 }}>
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
							<Typography variant="body2" sx={{ fontSize: "0.8125rem" }}>
								Downloading: {Math.round(downloadProgress.percent)}%
							</Typography>
							<LinearProgress
								variant="determinate"
								value={downloadProgress.percent}
								sx={{ mt: 1 }}
							/>
							<Typography
								variant="caption"
								sx={{ mt: 0.5, display: "block", fontSize: "0.75rem" }}
							>
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
									size="small"
									onClick={downloadUpdate}
									disabled={downloading}
									sx={buttonSx}
								>
									Download Update
								</Button>
								<Button
									variant="outlined"
									size="small"
									onClick={handleDeferUpdate}
									disabled={downloading}
									sx={secondaryButtonSx}
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
					<Typography className="update-title">
						Update Ready to Install
					</Typography>
					<Typography className="update-description">
						Version {updateInfo.version} is available. You are currently using
						version {appVersion}.
					</Typography>
					<Typography className="update-notes" sx={{ mt: 1 }}>
						The application will restart to apply the update.
					</Typography>

					<UpdateActions>
						<Button
							variant="contained"
							size="small"
							onClick={installUpdate}
							sx={buttonSx}
						>
							Install Now
						</Button>
						<Button
							variant="outlined"
							size="small"
							onClick={handleDeferUpdate}
							sx={secondaryButtonSx}
						>
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
					<Typography className="update-title">
						Server Update Available
					</Typography>
					<Typography className="update-description">
						Server version {backendUpdateInfo.latestVersion} is available. You
						are currently using version {backendUpdateInfo.currentVersion}.
					</Typography>
					<Typography className="update-notes" sx={{ mt: 1 }}>
						Updating the server will improve AI functionality, improve security,
						and fix bugs.
					</Typography>

					{backendUpdateInfo.canManageUpdate ? (
						<UpdateActions>
							<Button
								variant="contained"
								size="small"
								onClick={updateBackend}
								disabled={checking}
								sx={buttonSx}
							>
								{checking ? "Updating..." : "Update Server"}
							</Button>
							<Button
								variant="outlined"
								size="small"
								onClick={handleDeferBackendUpdate}
								disabled={checking}
								sx={secondaryButtonSx}
							>
								Update Later
							</Button>
						</UpdateActions>
					) : (
						<>
							<Typography
								variant="body2"
								sx={{ mt: 2, color: "warning.main", fontSize: "0.8125rem" }}
							>
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
									fontSize: "0.8125rem",
								}}
							>
								{backendUpdateInfo.updateCommand}
							</Typography>
							<UpdateActions>
								<Button
									variant="outlined"
									size="small"
									onClick={handleDeferBackendUpdate}
									disabled={checking}
									sx={secondaryButtonSx}
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
						<Typography variant="body2" sx={{ fontSize: "0.8125rem" }}>
							{manualUpdateInfo.message}
						</Typography>
						<Typography
							variant="body2"
							sx={{
								mt: 1,
								p: 1,
								backgroundColor: "background.default",
								borderRadius: 1,
								fontFamily: "monospace",
								fontSize: "0.8125rem",
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

	return null;
};

/**
 * Truncates text to a specified length and adds an ellipsis if needed
 */
const truncateText = (text: string, maxLength: number): string => {
	if (text.length <= maxLength) return text;
	return `${text.substring(0, maxLength)}...`;
};

/**
 * Gets the URL to the release notes
 */
const getReleaseUrl = (updateInfo: UpdateInfo): string => {
	if (updateInfo.releaseNotes && typeof updateInfo.releaseNotes !== "string") {
		const releaseNotesObj = updateInfo.releaseNotes as { path?: string };
		const defaultUrl = `https://github.com/damianvtran/local-operator-ui/releases/tag/v${updateInfo.version}`;
		return releaseNotesObj.path || defaultUrl;
	}

	return `https://github.com/damianvtran/local-operator-ui/releases/tag/v${updateInfo.version}`;
};
