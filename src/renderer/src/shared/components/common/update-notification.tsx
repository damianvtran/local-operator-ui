import { FloatingAlert } from "@shared/components/common/floating-alert";
import { Button, Progress } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	UpdateType,
	useDeferredUpdatesStore,
} from "@shared/store/deferred-updates-store";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import parse from "html-react-parser";
import { AlertTriangle, Check, Copy } from "lucide-react";
import {
	type HTMLAttributes,
	type ReactNode,
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
	/** How many times this target has failed on this machine. */
	attempts?: number;
};

/** The by-hand server state: what to run, and what installation it was read from. */
type ManualUpdateInfo = {
	message: string;
	command: string;
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
 *
 * `tone` is what assistive technology is told, and it is the same split
 * `FloatingAlert` uses: these panels are the ones a user most needs to notice -
 * an update was refused, an install failed - and they were announced to nobody
 * while every transient message in this file went out as a live region
 * (review U6).
 */
export const UpdateContainer = ({
	className,
	tone = "notice",
	...props
}: HTMLAttributes<HTMLDivElement> & { tone?: "notice" | "failed" }) => (
	<div
		role={tone === "failed" ? "alert" : "status"}
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
 * A panel heading, with the marker that says this one failed.
 *
 * Why an icon and not `text-danger` on the words: the two failure states were
 * typographically identical to the informational one - same 16px `text-ink`
 * heading, same body, same right-aligned buttons - so a user who had learned
 * "top-right panel = an update is available" read a broken install as one more
 * notice (review D1). `danger` as TEXT on `elevated` measures 3.76:1 in monokai
 * and 3.81:1 in dracula, under the 4.5:1 text floor `check-themes` asserts for
 * every theme, while the same ink as a graphical mark clears the 3:1 non-text
 * floor everywhere. So the colour is spent on the glyph and the distinction is
 * carried by the glyph's shape plus the words themselves.
 */
export const UpdateHeading = ({
	children,
	tone = "notice",
}: {
	children: ReactNode;
	tone?: "notice" | "failed";
}) => (
	<h2 className={cn("mb-3 flex items-center gap-2 text-heading text-ink")}>
		{tone === "failed" && (
			<AlertTriangle
				className="size-4 shrink-0 text-danger"
				aria-hidden={true}
			/>
		)}
		{children}
	</h2>
);

/**
 * Machine voice at the bottom of a panel, labelled and copyable.
 *
 * It used to sit directly above the buttons, unlabelled and at 12px mono, so the
 * last thing the eye crossed before the primary action was an OSStatus code -
 * and the only way to get that code into a support report was to hand-select a
 * wrapped path (reviews D2, D6, U11). It is below the actions now, it says what
 * it is, and one click copies it, which is the affordance the rest of the app
 * already has for the same job.
 */
export const PanelDetails = ({ detail }: { detail: string }) => {
	const [copied, setCopied] = useState(false);
	return (
		<div className="mt-4 flex items-start gap-2">
			<span className="shrink-0 text-meta text-ink-dim">Details:</span>
			<span className="min-w-0 flex-1 break-words text-mono-sm text-ink-dim">
				{detail}
			</span>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => {
					void navigator.clipboard
						.writeText(detail)
						.then(() => setCopied(true))
						.catch(() => undefined);
				}}
			>
				{copied ? <Check /> : <Copy />}
				{copied ? "Copied" : "Copy"}
			</Button>
		</div>
	);
};

/**
 * A command the user has to run themselves, with a way to take it with them.
 *
 * The app already had this pattern (MCP setup prompts, provider details), and a
 * bare `<code>` block floating over the app made the user hand-select a command
 * out of a panel (review U7).
 */
export const CommandBlock = ({ command }: { command: string }) => {
	const [copied, setCopied] = useState(false);
	return (
		<div className="mt-2 flex items-start gap-2">
			<code className="min-w-0 flex-1 rounded-sm bg-sunken p-2 text-mono-sm break-all text-ink">
				{command}
			</code>
			<Button
				variant="outline"
				size="sm"
				onClick={() => {
					void navigator.clipboard
						.writeText(command)
						.then(() => setCopied(true))
						.catch(() => undefined);
				}}
			>
				{copied ? <Check /> : <Copy />}
				{copied ? "Copied" : "Copy"}
			</Button>
		</div>
	);
};

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
	const [manualUpdateInfo, setManualUpdateInfo] =
		useState<ManualUpdateInfo | null>(null);
	/**
	 * The server version the by-hand panel is waiting for.
	 *
	 * Held so the panel can clear itself when /health reports it: the panel's own
	 * copy says to run the command and check again, and it used to stay up
	 * afterwards until the user pressed Dismiss (review U2). Read from the backend
	 * info the update attempt was made against, because the manual-required event
	 * itself carries no version.
	 */
	const manualUpdateTargetRef = useRef<string | null>(null);

	/** True while `Install now` has been pressed and the pre-flight is running. */
	const [installing, setInstalling] = useState(false);

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

	/**
	 * Check for updates.
	 *
	 * `manual` marks a check the user asked for. It travels to the main process so
	 * an explicit check can re-offer a release whose artifact failed verification:
	 * two of the refusal panels tell the user to free space or re-download and
	 * then check again, and with the suppression applied to every check that
	 * remedy was inert for the rest of the session (reviews R3, U3).
	 */
	const checkForUpdates = useCallback(
		async (options?: { manual?: boolean }) => {
			try {
				setChecking(true);
				setError(null);
				await window.api.updater.checkForUpdates(options);
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
		},
		[],
	);

	/**
	 * Re-check the *server*, for the panel whose copy says to.
	 *
	 * That panel's button used to call the UI-only check, so the action it named
	 * could not observe the thing it was about, and after the user did upgrade the
	 * server the panel stayed up anyway (review U2).
	 */
	const checkForAllUpdates = useCallback(async () => {
		try {
			setChecking(true);
			setError(null);
			await window.api.updater.checkForAllUpdates({ manual: true });
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

	/**
	 * Install the update.
	 *
	 * The pre-flight behind this call can run `codesign` over a 1 GiB bundle and
	 * hash a 350 MB artifact, and the panel used to look untouched with its
	 * primary button still live for those seconds - so the natural response to
	 * "nothing happened" was a second click, which re-entered the pre-flight and
	 * could spawn a second watchdog (review U5). The panel now shows a pending
	 * state, and the main process holds the concurrency guard.
	 */
	const installUpdate = useCallback(async () => {
		setInstalling(true);
		setError(null);
		try {
			const started = await window.api.updater.quitAndInstall();
			if (!started) {
				// Refused or already in flight: the refusal panel is the messenger, and
				// the app is still here to show it.
				setInstalling(false);
			}
		} catch (err) {
			setInstalling(false);
			setError(
				`Error starting the update: ${err instanceof Error ? err.message : String(err)}`,
			);
			setSnackbarOpen(true);
		}
	}, []);

	/** Open a remedy's page in the user's browser. */
	const openRemedyUrl = useCallback((url: string | undefined) => {
		if (!url) return;
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
					// The offer supersedes the failure notice: the panel that explains an
					// install that did not finish would otherwise sit over the update it is
					// asking for. The durable record survives in Settings -> App updates.
					setInstallFailed(null);
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
					setInstallFailed(null);
					setUpdateDownloaded(true);
					setUpdateInfo(info);
					setSnackbarOpen(true);
				}
			});

		// Frontend update error - also handle manual update requirements
		const removeUpdateErrorListener = window.api.updater.onUpdateError(
			(errorMessage) => {
				if (errorMessage.includes("manually")) {
					// Legacy wording from a main process that named pip for every
					// unmanaged server. No command is offered here any more: the app
					// cannot tell which installer owns an environment from a string it
					// was handed, and naming the wrong one is the defect this whole change
					// exists to fix (reviews U4, D4).
					setManualUpdateRequired(true);
					setManualUpdateInfo({
						message:
							"The server is installed outside the app, so use the tool you installed it with - uv, pipx or pip.",
						command: "",
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
				// The event carries no version, and this panel has to know which one it
				// is waiting for so it can clear itself once the server reaches it.
				manualUpdateTargetRef.current =
					backendUpdateInfoRef.current?.latestVersion ?? null;
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
				/*
				 * The notice explains why the app came back on the old version, and it used
				 * to be queued behind this component's own start-up check: a user watching
				 * their app reappear saw "Checking for updates..." for the whole check and
				 * nothing at all if the check never settled (review U8). The failure is not
				 * a function of the check, so it takes the panel and the check steps aside.
				 */
				setChecking(false);
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
				// The by-hand panel's own instruction is "run this, then check again".
				// When the server that answers is the version it was waiting for, the
				// panel has been satisfied and clears itself - it used to stay up until
				// the user pressed Dismiss, which made a successful upgrade look like a
				// failed one (review U2).
				const target = manualUpdateTargetRef.current;
				if (target == null || target === info.version) {
					setManualUpdateRequired(false);
					setManualUpdateInfo(null);
				}
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

	/*
	 * The failure notice comes before the check's own progress panel.
	 *
	 * It explains why the app came back on the old version, and it used to be
	 * queued behind this component's start-up check - so a user watching their app
	 * reappear saw "Checking for updates..." for the whole check, and nothing at
	 * all if the check never settled, because this path has no timeout (review
	 * U8). The failure is not a function of the check.
	 */
	if (installFailed) {
		return (
			<UpdateContainer tone="failed">
				<UpdateHeading tone="failed">
					The last update didn't finish
				</UpdateHeading>
				<p className="mb-2 text-body text-ink-muted">{installFailed.message}</p>
				{/* The actionable sentence at the panel's reading weight: it was set one
				    step below the explanation, so the thing to DO lost to the thing that
				    happened (review D2). */}
				<p className="mt-2 text-body text-ink">{installFailed.remedy.text}</p>
				{(installFailed.attempts ?? 1) > 1 && (
					<p className="mt-1 text-body-sm text-ink-muted">
						Version {installFailed.targetVersion} has failed to install{" "}
						{installFailed.attempts} times on this machine. Downloading a fresh
						copy is the reliable way out.
					</p>
				)}
				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setInstallFailed(null)}
					>
						Update later
					</Button>
					{/* One click at the retry the copy names, and it has to be a check the
					    main process can tell apart from its own periodic one, or the
					    suppression keeps the release away (reviews D3, R3). */}
					<Button
						variant="outline"
						size="sm"
						onClick={() => void checkForUpdates({ manual: true })}
						disabled={checking}
					>
						{checking ? "Checking..." : "Check for updates"}
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => openRemedyUrl(installFailed.remedy.url)}
					>
						Open download page
					</Button>
				</UpdateActions>
				{installFailed.detail && <PanelDetails detail={installFailed.detail} />}
			</UpdateContainer>
		);
	}

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
			<UpdateContainer tone="failed">
				<UpdateHeading tone="failed">
					{INSTALL_BLOCK_HEADINGS[installBlocked.code] ??
						"The update wasn't installed"}
				</UpdateHeading>
				<p className="mb-2 text-body text-ink-muted">
					{installBlocked.message}
				</p>
				<p className="mt-2 text-body text-ink">{installBlocked.remedy.text}</p>
				{installBlocked.remedy.command && (
					<CommandBlock command={installBlocked.remedy.command} />
				)}
				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setInstallBlocked(null)}
					>
						Update later
					</Button>
					{installBlocked.remedy.url ? (
						<Button
							variant="primary"
							size="sm"
							onClick={() => openRemedyUrl(installBlocked.remedy.url)}
						>
							Open download page
						</Button>
					) : (
						<Button
							variant="primary"
							size="sm"
							onClick={() => void checkForUpdates({ manual: true })}
							disabled={checking}
						>
							{checking ? "Checking..." : "Check for updates"}
						</Button>
					)}
				</UpdateActions>
				{installBlocked.detail && (
					<PanelDetails detail={installBlocked.detail} />
				)}
			</UpdateContainer>
		);
	}

	// A manual backend update: a server the app does not own, so the command is
	// the whole answer and it has to stay on screen long enough to be read.
	if (manualUpdateRequired && manualUpdateInfo) {
		return (
			<UpdateContainer>
				<UpdateHeading>The server needs updating by hand</UpdateHeading>
				{/* Same emphasis as the other producer of this state
				    (`backend-update-non-managed`, which used a warning hue): one sentence,
				    the same weight, and the words carry which one needs the user
				    (review D5). */}
				<p className="mb-2 text-body text-ink">{manualUpdateInfo.message}</p>
				{manualUpdateInfo.command ? (
					<>
						<CommandBlock command={manualUpdateInfo.command} />
						<p className="mt-2 text-body text-ink">
							Run this in a terminal, then check for updates again to pick up
							the new server version.
						</p>
					</>
				) : (
					<p className="mt-2 text-body text-ink">
						Then check for updates again to pick up the new server version.
					</p>
				)}
				<UpdateActions>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							setManualUpdateRequired(false);
							setManualUpdateInfo(null);
						}}
					>
						Update later
					</Button>
					{/* This button's own copy says "check again to pick up the new server
					    version", so it has to re-read the SERVER: it used to call the
					    UI-only check, which could not observe the thing the panel is about
					    (review U2). */}
					<Button
						variant="primary"
						size="sm"
						onClick={() => void checkForAllUpdates()}
						disabled={checking}
					>
						{checking ? "Checking..." : "Check for updates"}
					</Button>
				</UpdateActions>
				{manualUpdateInfo.detail && (
					<PanelDetails detail={manualUpdateInfo.detail} />
				)}
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
						<Button
							variant="outline"
							size="sm"
							onClick={handleDeferUpdate}
							disabled={installing}
						>
							Update later
						</Button>
						{/* One click, then a panel that says it heard: the pre-flight behind this
						    button can take seconds over a 1 GiB bundle. */}
						<Button
							variant="primary"
							size="sm"
							onClick={() => void installUpdate()}
							disabled={installing}
						>
							{installing ? "Preparing to install..." : "Install now"}
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
							{/* The same treatment as the manual-required panel's sentence - one
							    weight, no hue swap. It used to be `text-warning` here and 13px
							    `text-ink-muted` there, for the same sentence, so the only thing
							    marking "this one needs you" was a colour (review D5). */}
							<p className="mt-4 text-body text-ink">
								{backendUpdateInfo.remedy ??
									"The server is installed outside the app, so use the tool you installed it with - uv, pipx or pip:"}
							</p>
							{backendUpdateInfo.updateCommand && (
								<CommandBlock command={backendUpdateInfo.updateCommand} />
							)}
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
									onClick={() => void checkForAllUpdates()}
									disabled={checking}
								>
									{checking ? "Checking..." : "Check for updates"}
								</Button>
							</UpdateActions>
						</>
					)}
				</UpdateContainer>

				{/*
				 * The panel IS the notification here, so the toast that used to sit in the
				 * opposite corner saying the same sentence is gone - and it is gone for the
				 * state that never raised one, rather than being raised twice or not at
				 * all depending on the branch (review D8).
				 */}
				{backendUpdateInfo.canManageUpdate && (
					<FloatingAlert
						open={snackbarOpen}
						autoHideDuration={6000}
						onClose={handleSnackbarClose}
						variant="info"
					>
						A new server update is available: v{backendUpdateInfo.latestVersion}
					</FloatingAlert>
				)}
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
