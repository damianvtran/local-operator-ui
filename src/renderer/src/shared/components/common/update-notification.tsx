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
	/** Sentence introducing the manual command, chosen by how the server is installed. */
	remedy?: string;
};

/** A remedy the main process can spell out in the user's own terms. */
type UpdateRemedy = {
	text: string;
	url?: string;
	command?: string;
};

/**
 * An install the app refused to start.
 *
 * Deliberately its own state rather than an entry in `error`: the app is still
 * running and nothing has failed yet, and the refusal needs the remedy on
 * screen next to it - the operator's report was an install that vanished with
 * no message at all.
 */
type InstallBlockedInfo = {
	code: string;
	version: string | null;
	message: string;
	remedy: UpdateRemedy;
	detail?: string;
};

/** A previous install Squirrel never completed, reported on the next start. */
type InstallFailedInfo = {
	targetVersion: string;
	message: string;
	remedy: UpdateRemedy;
	detail?: string;
};

/** Headings for the refusal states, sentence case, one line each. */
const INSTALL_BLOCK_HEADINGS: Record<string, string> = {
	"installed-bundle-not-sealed": "This app can't update itself",
	"download-verification-failed": "The update couldn't be verified",
	"artifact-metadata-missing": "The update couldn't be verified",
	"insufficient-disk-space": "Not enough disk space to update",
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

/**
 * Prose semantics for the one place in the app that injects third-party HTML.
 *
 * Preflight resets `h1-h6` to inherited size and weight and strips list
 * markers, indent and margins, so a GitHub release note - headings and bullet
 * lists essentially always - rendered as a wall of identical lines. The
 * markdown editor carries the same set for the same reason.
 *
 * Exported because the Storybook story draws its own copy of this panel, and
 * a fixture that has drifted from the component is how a defect stays
 * invisible in a set of 420 pictures.
 */
export const RELEASE_NOTES_PROSE = [
	"[&_:is(h1,h2,h3,h4,h5,h6)]:mt-3 [&_:is(h1,h2,h3,h4,h5,h6)]:mb-1 [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:text-ink",
	"[&_h1]:text-heading [&_h2]:text-heading [&_h3]:text-body [&_h4]:text-body [&_h5]:text-body-sm [&_h6]:text-body-sm",
	"[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
	"[&_:is(ul,ol)]:my-1.5 [&_:is(ul,ol)]:pl-5 [&_ul_li]:list-disc [&_ol_li]:list-decimal [&_li]:my-0.5",
	/* No link rule here: `UpdateContainer` above already carries
	   `[&_a]:hover:underline`, and the copy that lived here was written
	   `hover:[&_a]:underline` - which compiles to `.cls:hover a`, so hovering
	   anywhere in the body underlined every link in the panel at once. */
	"[&_code]:rounded-xs [&_code]:bg-sunken [&_code]:px-1 [&_code]:font-mono [&_code]:text-mono-sm",
].join(" ");

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

	// Install refusals and a failed install detected on this start. Kept apart
	// from each other because only one of them has an installed app to talk about.
	const [installBlocked, setInstallBlocked] =
		useState<InstallBlockedInfo | null>(null);
	const [installFailed, setInstallFailed] = useState<InstallFailedInfo | null>(
		null,
	);

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

	/** Open a remedy's page in the user's browser. */
	const openRemedyUrl = useCallback((url: string) => {
		void window.api.openExternal(url);
	}, []);

	// Update the backend
	const updateBackend = useCallback(async () => {
		try {
			setChecking(true);
			setUpdatingBackend(true);
			setError(null);
			// The target version travels with the request so the main process can
			// confirm the restarted server actually reports it.
			await window.api.updater.updateBackend(
				backendUpdateInfoRef.current?.latestVersion,
			);
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

		// Backend update requires a manual command (a server the app does not own)
		const removeBackendManualRequiredListener =
			window.api.updater.onBackendUpdateManualRequired((info) => {
				setManualUpdateRequired(true);
				setManualUpdateInfo(info);
				setChecking(false);
				setUpdatingBackend(false);
				setBackendUpdateAvailable(false);
				setBackendUpdateInfo(null);
			});

		// The app refused to start an install, or a previous one never finished
		const removeInstallBlockedListener =
			window.api.updater.onUpdateInstallBlocked((info) => {
				setInstallBlocked(info);
				setChecking(false);
				setUpdatingBackend(false);
				setDownloading(false);
			});
		const removeInstallFailedListener =
			window.api.updater.onUpdateInstallFailed((info) => {
				setInstallFailed(info);
			});

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
						// Trust the flag the main process sent: it is the side that
						// knows how the server was installed (a uv tool and a pipx
						// install cannot be updated from here at all). The old
						// substring test guessed from the word "manually" in a
						// legacy string, which reads `uv tool upgrade
						// local-operator` - a command we deliberately never run -
						// as one we do, and offers a button that always fails.
						canManageUpdate:
							info.canManageUpdate ?? !info.updateCommand.includes("manually"),
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
			removeBackendManualRequiredListener();
			removeInstallBlockedListener();
			removeInstallFailedListener();
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

	// An install the app refused to start. A panel rather than a toast: the app is
	// still running, the update is still staged, and the remedy is the point.
	if (installBlocked) {
		return (
			<UpdateContainer>
				<h2 className="mb-3 text-heading text-ink">
					{INSTALL_BLOCK_HEADINGS[installBlocked.code] ??
						"The update wasn't installed"}
				</h2>
				<p className="mb-2 text-body text-ink-muted">
					{installBlocked.message}
				</p>
				<p className="mt-2 text-body-sm text-ink-muted">
					{installBlocked.remedy.text}
				</p>
				{installBlocked.detail && (
					<p className="mt-1 text-mono-sm text-ink-dim">
						{installBlocked.detail}
					</p>
				)}
				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setInstallBlocked(null)}
					>
						Dismiss
					</Button>
					{installBlocked.remedy.url ? (
						<Button
							variant="primary"
							size="sm"
							onClick={() => openRemedyUrl(installBlocked.remedy.url as string)}
						>
							Open download page
						</Button>
					) : (
						<Button variant="primary" size="sm" onClick={checkForUpdates}>
							Check for updates
						</Button>
					)}
				</UpdateActions>
			</UpdateContainer>
		);
	}

	// A previous install that ShipIt never completed. The user saw the app quit
	// and come back on the old version, so this is that explanation.
	if (installFailed) {
		return (
			<UpdateContainer>
				<h2 className="mb-3 text-heading text-ink">
					The last update didn't finish
				</h2>
				<p className="mb-2 text-body text-ink-muted">{installFailed.message}</p>
				<p className="mt-2 text-body-sm text-ink-muted">
					{installFailed.remedy.text}
				</p>
				{installFailed.detail && (
					<p className="mt-1 text-mono-sm text-ink-dim">
						{installFailed.detail}
					</p>
				)}
				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setInstallFailed(null)}
					>
						Dismiss
					</Button>
					{installFailed.remedy.url && (
						<Button
							variant="primary"
							size="sm"
							onClick={() => openRemedyUrl(installFailed.remedy.url as string)}
						>
							Open download page
						</Button>
					)}
				</UpdateActions>
			</UpdateContainer>
		);
	}

	// A manual backend update: a server the app does not own, so the command is
	// the whole answer and it has to stay on screen long enough to be read.
	if (manualUpdateRequired && manualUpdateInfo) {
		return (
			<UpdateContainer>
				<h2 className="mb-3 text-heading text-ink">
					The server needs updating by hand
				</h2>
				<p className="mb-2 text-body text-ink-muted">
					{manualUpdateInfo.message}
				</p>
				<code className="mt-2 block rounded-sm bg-sunken p-2 text-mono-sm text-ink">
					{manualUpdateInfo.command}
				</code>
				<p className="mt-2 text-body-sm text-ink-muted">
					Run this in a terminal, then check for updates again to pick up the
					new server version.
				</p>
				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							setManualUpdateRequired(false);
							setManualUpdateInfo(null);
						}}
					>
						Dismiss
					</Button>
					<Button variant="primary" size="sm" onClick={checkForUpdates}>
						Check for updates
					</Button>
				</UpdateActions>
			</UpdateContainer>
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
						//
						// The prose utilities are not decoration. Preflight resets
						// h1-h6 to inherited size and weight and strips list markers,
						// indent and margins, and this is the one place in the app
						// that injects third-party HTML - so without them a release
						// note, which is headings and bullets essentially always,
						// renders as a wall of identical lines. The markdown editor
						// carries the same set for the same reason.
						<div
							className={cn(
								"mt-2 text-body text-ink-muted",
								RELEASE_NOTES_PROSE,
							)}
						>
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
								{/* Dismiss first, commit last - the order every other
								    footer in the release uses, and the one a user's
								    hand learns. This component put the committing
								    button first in all three of its footers. */}
								<Button
									variant="outline"
									size="sm"
									onClick={handleDeferUpdate}
									disabled={downloading}
								>
									Update later
								</Button>
								<Button
									variant="primary"
									size="sm"
									onClick={downloadUpdate}
									disabled={downloading}
								>
									Download update
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
					{/* "has been downloaded", not "is available": this is the state
					    AFTER the download, and reusing the available state's
					    sentence told the user nothing had happened. The version
					    they are on stays, because that is the comparison the
					    heading does not make. */}
					<p className="mb-2 text-body text-ink-muted">
						Version {updateInfo.version} has been downloaded. You are currently
						using version {appVersion}.
					</p>
					<p className="mt-2 text-body-sm text-ink-muted">
						The application will restart to apply the update.
					</p>

					<UpdateActions>
						<Button variant="outline" size="sm" onClick={handleDeferUpdate}>
							Update later
						</Button>
						<Button variant="primary" size="sm" onClick={installUpdate}>
							Install now
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
								variant="outline"
								size="sm"
								onClick={handleDeferBackendUpdate}
								disabled={checking}
							>
								Update later
							</Button>
							<Button
								variant="primary"
								size="sm"
								onClick={updateBackend}
								disabled={checking}
							>
								{checking ? "Updating..." : "Update server"}
							</Button>
						</UpdateActions>
					) : (
						<>
							<p className="mt-4 text-body-sm text-warning">
								{backendUpdateInfo.remedy ??
									"The server is installed outside the app, so update it from your terminal:"}
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
