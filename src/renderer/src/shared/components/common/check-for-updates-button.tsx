import { FloatingAlert } from "@shared/components/common/floating-alert";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import {
	UpdateType,
	useDeferredUpdatesStore,
} from "@shared/store/deferred-updates-store";
import { isDevelopmentMode } from "@shared/utils/env-utils";
import { useEffect, useRef, useState } from "react";

/**
 * Component that shows a button to manually check for updates.
 *
 * This component only provides the button UI and triggers the update check process.
 * It also displays confirmation and error notifications for manual update checks.
 */
export const CheckForUpdatesButton = () => {
	/** Where a user gets a copy that installs by hand. */
	const DOWNLOAD_PAGE = "https://local-operator.com/download";
	const [checking, setChecking] = useState(false);
	const [snackbarOpen, setSnackbarOpen] = useState(false);
	const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
	const [snackbarSeverity, setSnackbarSeverity] = useState<
		"success" | "info" | "warning" | "danger"
	>("info");
	const [manualUpdateInfo, setManualUpdateInfo] = useState<{
		message: string;
		command: string;
	} | null>(null);
	/**
	 * The last install that did not complete, read from disk.
	 *
	 * This is the home of the record the failure panel points at: the panel is
	 * delivered once per process and its dismissal used to be the end of it, so a
	 * user who clicked it away - the only control it offered - had lost which
	 * version failed and when (reviews U1, D3). Reading it here means the fact
	 * survives a dismiss, a restart, and the panel never being seen at all.
	 */
	const [lastAttempt, setLastAttempt] = useState<{
		targetVersion: string;
		runningVersion: string;
		startedAt: string | null;
		detectedAt: string;
		detail: string;
		attempts: number;
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
					// Legacy wording from a main process that named pip for every
					// unmanaged server. No command is offered: the app cannot tell which
					// installer owns an environment from a string it was handed, and
					// naming the wrong one is the defect this change exists to fix.
					setManualUpdateInfo({
						message:
							"The server is installed outside the app, so use the tool you installed it with - uv, pipx or pip.",
						command: "",
					});
					setSnackbarSeverity("warning");
					setSnackbarOpen(true);
				} else if (!isSuppressed) {
					setSnackbarMessage(message);
					setSnackbarSeverity("danger");
					setSnackbarOpen(true);
				}
			},
		);

		// Listen for "no updates" events (frontend and backend)
		const removeUpdateNotAvailableListener =
			window.api.updater.onUpdateNotAvailable(() => {
				if (!manualCheckRef.current) return;
				setSnackbarMessage("You are up to date");
				setSnackbarSeverity("success");
				setSnackbarOpen(true);
			});
		const removeBackendUpdateNotAvailableListener =
			window.api.updater.onBackendUpdateNotAvailable(() => {
				if (!manualCheckRef.current) return;
				setSnackbarMessage("The server is up to date");
				setSnackbarSeverity("success");
				setSnackbarOpen(true);
			});
		const removeBackendUpdateDevModeListener =
			window.api.updater.onBackendUpdateDevMode((message) => {
				if (!manualCheckRef.current) return;
				setSnackbarMessage(message);
				setSnackbarSeverity("info");
				setSnackbarOpen(true);
			});

		return () => {
			removeUpdateErrorListener();
			removeUpdateNotAvailableListener();
			removeBackendUpdateNotAvailableListener();
			removeBackendUpdateDevModeListener();
		};
	}, []);

	// The durable record of the last failed install: read on mount, and re-read
	// when this start turns out to have one.
	useEffect(() => {
		let cancelled = false;
		const load = () => {
			window.api.updater
				.getLastInstallAttempt()
				.then((record) => {
					if (!cancelled) setLastAttempt(record);
				})
				.catch(() => undefined);
		};
		load();
		const removeInstallFailed = window.api.updater.onUpdateInstallFailed(() =>
			load(),
		);
		return () => {
			cancelled = true;
			removeInstallFailed();
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

			// Check for all updates (UI and backend). `manual` lets the main process
			// re-offer a release whose artifact failed verification: this is the check
			// the refusal panels send the user here to make.
			await window.api.updater.checkForAllUpdates({ manual: true });

			// The UpdateNotification component will handle displaying the results,
			// but we show confirmation/error for manual checks here.
		} catch (error) {
			setSnackbarMessage(
				`Error checking for updates: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			setSnackbarSeverity("danger");
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
			{lastAttempt && (
				/*
				 * The record the failure panel points at, in the place a user would look
				 * for it. It states the version, how many attempts have failed, and when
				 * the last one was detected, with the machine detail in the app's own
				 * second voice - and the action that actually resolves a failing install.
				 */
				<div className="mb-3 rounded-sm bg-sunken p-3">
					<p className="text-body-sm text-ink">
						The last update to version {lastAttempt.targetVersion} didn't finish
						{lastAttempt.attempts > 1
							? ` (${lastAttempt.attempts} attempts)`
							: ""}
						. Version {lastAttempt.runningVersion} is running.
					</p>
					<p className="mt-1 text-meta text-ink-dim">
						Detected{" "}
						{lastAttempt.detectedAt
							? new Date(lastAttempt.detectedAt).toLocaleString()
							: "at an unknown time"}
						. {lastAttempt.detail}
					</p>
					<Button
						variant="outline"
						size="sm"
						className="mt-2"
						onClick={() => void window.api.openExternal(DOWNLOAD_PAGE)}
					>
						Download a fresh copy
					</Button>
				</div>
			)}
			<Button
				variant="outline"
				onClick={() => void checkForUpdates()}
				disabled={checking}
			>
				{/* Unlabelled: the button's own caption already says what is busy. */}
				{checking ? <Spinner size="sm" /> : null}
				{checking ? "Checking..." : "Check for updates"}
			</Button>

			{/* Manual update instructions */}
			{manualUpdateInfo && (
				<FloatingAlert
					open={snackbarOpen}
					autoHideDuration={10000}
					onClose={handleSnackbarClose}
					variant="warning"
				>
					<p className="text-body-sm">{manualUpdateInfo.message}</p>
					{manualUpdateInfo.command && (
						<code className="mt-2 block rounded-sm bg-sunken p-2 text-mono-sm text-ink">
							{manualUpdateInfo.command}
						</code>
					)}
				</FloatingAlert>
			)}

			{/* General info, success, or error messages */}
			{snackbarMessage && (
				<FloatingAlert
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={handleSnackbarClose}
					variant={snackbarSeverity}
				>
					{snackbarMessage}
				</FloatingAlert>
			)}
		</>
	);
};
