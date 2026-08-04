import { FloatingAlert } from "@shared/components/common/floating-alert";
import { Button, Progress } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	UpdateType,
	useDeferredUpdatesStore,
} from "@shared/store/deferred-updates-store";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import parse from "html-react-parser";
import {
	type HTMLAttributes,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

const RELEASE_ARTIFACT_ERROR_REGEX =
	/cannot find .* in the latest release artifacts/i;

type BackendUpdateInfo = {
	currentVersion: string;
	latestVersion: string;
	updateCommand: string;
	canManageUpdate?: boolean;
	startupMode?: string;
};

/**
 * The notification panel itself.
 *
 * It leaves the flow, so it takes `elevated` plus the one shadow rather than a
 * border. The `[&_a]` rule is the only descendant selector kept from the MUI
 * version: release notes arrive as HTML from GitHub, so their anchors cannot be
 * given a class at the call site.
 */
export const UpdateContainer = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"fixed top-4 right-4 z-50 w-100 max-w-[calc(100vw-2rem)]",
			"rounded-lg bg-elevated p-4 shadow-overlay",
			"[&_a]:text-accent [&_a]:underline-offset-4 [&_a]:hover:underline",
			className,
		)}
		{...props}
	/>
);

export const UpdateActions = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("mt-6 flex justify-end gap-3", className)} {...props} />
);

export const ProgressContainer = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("mt-4 mb-2", className)} {...props} />
);

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

	// If checking for updates or updating backend, show a loading indicator
	if (checking) {
		return (
			<UpdateContainer>
				<h2 className="mb-3 text-heading text-ink">
					{updatingBackend ? "Updating server" : "Checking for updates"}
				</h2>
				<p className="mb-2 text-body text-ink-muted">
					{updatingBackend
						? "Please wait while the server is being updated. The server will temporarily go offline while it restarts to apply the update."
						: "Please wait while we check for available updates..."}
				</p>
				<ProgressContainer>
					<Progress />
				</ProgressContainer>
			</UpdateContainer>
		);
	}

	// If there's an error, show a toast
	if (error) {
		return (
			<FloatingAlert
				open={snackbarOpen}
				autoHideDuration={6000}
				onClose={handleSnackbarClose}
				variant="danger"
			>
				{error}
			</FloatingAlert>
		);
	}

	// If an update is available but not downloaded yet
	if (updateAvailable && !updateDownloaded && updateInfo) {
		return (
			<>
				<UpdateContainer>
					<h2 className="mb-3 text-heading text-ink">Update available</h2>
					<p className="mb-2 text-body text-ink-muted">
						Version {updateInfo.version} is available. You are currently using
						version {appVersion}.
					</p>
					{updateInfo.releaseNotes && (
						// A div rather than a paragraph: GitHub's release notes arrive as
						// HTML and routinely contain block elements, which a <p> cannot
						// legally hold.
						<div className="mt-2 text-body text-ink-muted">
							Release notes:{" "}
							{typeof updateInfo.releaseNotes === "string" ? (
								<>
									{parse(truncateText(updateInfo.releaseNotes, 400))}
									{updateInfo.releaseNotes.length > 400 && (
										<a
											href={getReleaseUrl(updateInfo)}
											target="_blank"
											rel="noopener noreferrer"
											className="ml-2"
										>
											View full release notes
										</a>
									)}
								</>
							) : (
								<a
									href={getReleaseUrl(updateInfo)}
									target="_blank"
									rel="noopener noreferrer"
								>
									See release notes on GitHub
								</a>
							)}
						</div>
					)}

					{downloading && downloadProgress && (
						<ProgressContainer>
							<p className="text-body-sm text-ink-muted">
								Downloading: {Math.round(downloadProgress.percent)}%
							</p>
							<Progress value={downloadProgress.percent} className="mt-2" />
							<p className="mt-1 text-mono-sm text-ink-dim">
								{Math.round(downloadProgress.transferred / 1024)} KB of{" "}
								{Math.round(downloadProgress.total / 1024)} KB
							</p>
						</ProgressContainer>
					)}

					<UpdateActions>
						{!downloading && (
							<>
								<Button
									variant="primary"
									size="sm"
									onClick={downloadUpdate}
									disabled={downloading}
								>
									Download update
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={handleDeferUpdate}
									disabled={downloading}
								>
									Update later
								</Button>
							</>
						)}
					</UpdateActions>
				</UpdateContainer>

				<FloatingAlert
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={handleSnackbarClose}
					variant="info"
				>
					A new update is available: v{updateInfo.version}
				</FloatingAlert>
			</>
		);
	}

	// If an update has been downloaded
	if (updateDownloaded && updateInfo) {
		return (
			<>
				<UpdateContainer>
					<h2 className="mb-3 text-heading text-ink">
						Update ready to install
					</h2>
					<p className="mb-2 text-body text-ink-muted">
						Version {updateInfo.version} is available. You are currently using
						version {appVersion}.
					</p>
					<p className="mt-2 text-body-sm text-ink-muted">
						The application will restart to apply the update.
					</p>

					<UpdateActions>
						<Button variant="primary" size="sm" onClick={installUpdate}>
							Install now
						</Button>
						<Button variant="outline" size="sm" onClick={handleDeferUpdate}>
							Update later
						</Button>
					</UpdateActions>
				</UpdateContainer>

				<FloatingAlert
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={handleSnackbarClose}
					variant="success"
				>
					Update downloaded and ready to install
				</FloatingAlert>
			</>
		);
	}

	// If a backend update is available
	if (backendUpdateAvailable && backendUpdateInfo) {
		return (
			<>
				<UpdateContainer>
					<h2 className="mb-3 text-heading text-ink">
						Server update available
					</h2>
					<p className="mb-2 text-body text-ink-muted">
						Server version {backendUpdateInfo.latestVersion} is available. You
						are currently using version {backendUpdateInfo.currentVersion}.
					</p>
					<p className="mt-2 text-body-sm text-ink-muted">
						Updating the server will improve AI functionality, improve security,
						and fix bugs.
					</p>

					{backendUpdateInfo.canManageUpdate ? (
						<UpdateActions>
							<Button
								variant="primary"
								size="sm"
								onClick={updateBackend}
								disabled={checking}
							>
								{checking ? "Updating..." : "Update server"}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={handleDeferBackendUpdate}
								disabled={checking}
							>
								Update later
							</Button>
						</UpdateActions>
					) : (
						<>
							<p className="mt-4 text-body-sm text-warning">
								The backend server is running externally and cannot be updated
								automatically. Please update it manually using the following
								command:
							</p>
							<code className="mt-2 block rounded-sm bg-sunken p-2 text-mono-sm text-ink">
								{backendUpdateInfo.updateCommand}
							</code>
							<UpdateActions>
								<Button
									variant="outline"
									size="sm"
									onClick={handleDeferBackendUpdate}
									disabled={checking}
								>
									Dismiss
								</Button>
							</UpdateActions>
						</>
					)}
				</UpdateContainer>

				<FloatingAlert
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={handleSnackbarClose}
					variant="info"
				>
					A new server update is available: v{backendUpdateInfo.latestVersion}
				</FloatingAlert>
			</>
		);
	}

	// If a manual update is required
	if (manualUpdateRequired && manualUpdateInfo) {
		return (
			<FloatingAlert
				open={snackbarOpen}
				autoHideDuration={10000}
				onClose={handleSnackbarClose}
				variant="warning"
			>
				<p className="text-body-sm">{manualUpdateInfo.message}</p>
				<code className="mt-2 block rounded-sm bg-sunken p-2 text-mono-sm text-ink">
					{manualUpdateInfo.command}
				</code>
			</FloatingAlert>
		);
	}

	// If a backend update has been completed
	if (backendUpdateCompleted) {
		return (
			<FloatingAlert
				open={true}
				autoHideDuration={6000}
				onClose={() => setBackendUpdateCompleted(false)}
				variant="success"
			>
				Server update completed successfully
			</FloatingAlert>
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
