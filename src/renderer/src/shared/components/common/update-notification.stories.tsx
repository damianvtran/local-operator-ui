import { Button, Progress } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import parse from "html-react-parser";
import { useEffect, useLayoutEffect, useState } from "react";
import { updateCheckVerdict } from "../../../../../main/update-check-verdict";
import { FloatingAlert } from "./floating-alert";
import {
	ProgressContainer,
	RELEASE_NOTES_PROSE,
	UpdateActions,
	UpdateContainer,
	UpdateNotification,
} from "./update-notification";

// Initialize window.api if it doesn't exist
if (typeof window.api === "undefined") {
	// @ts-ignore - Ignore type errors for window.api assignment in storybook context
	window.api = {};
}

// Mock process.env for Storybook
if (typeof process === "undefined" || !process.env) {
	// @ts-ignore - Ignore process assignment for Storybook context
	window.process = { env: { npm_package_version: "1.0.0" } };
}

// Mock update info for stories
const mockUpdateInfo: UpdateInfo = {
	version: "2.0.0",
	releaseNotes: "Bug fixes and performance improvements",
	files: [],
	path: "",
	sha512: "",
	releaseDate: new Date().toISOString(),
};

// Create empty updater methods to prevent errors
const createEmptyUpdaterMethods = () => {
	const noop = () => () => {};
	if (!window.api.updater) {
		window.api.updater = {
			checkForUpdates: async () =>
				Promise.resolve({ updateInfo: mockUpdateInfo, cancellationToken: {} }),
			checkForBackendUpdates: async () => Promise.resolve(null),
			checkForAllUpdates: async () =>
				updateCheckVerdict({ app: "current", server: "current" }),
			getLastInstallAttempt: async () => null,
			updateBackend: async () => Promise.resolve(true),
			downloadUpdate: async () => Promise.resolve([]),
			quitAndInstall: async () => true,
			quitForUpdateInstall: async () => true,
			onUpdateDevMode: () => () => {},
			onUpdateNpxAvailable: () => () => {},
			onBackendUpdateAvailable: () => () => {},
			onBackendUpdateDevMode: () => () => {},
			onBackendUpdateNotAvailable: () => () => {},
			onBackendUpdateCompleted: () => () => {},
			/*
			 * A failed server update, which the panel now leaves its in-flight state on.
			 * The stub has to exist or the panel's own subscription throws before the
			 * story renders.
			 */
			onBackendUpdateError: () => () => {},
			onUpdateAvailable: noop,
			onUpdateNotAvailable: noop,
			onUpdateDownloaded: noop,
			onUpdateError: noop,
			onUpdateProgress: noop,
			onBeforeQuitForUpdate: noop,
			onBackendUpdateManualRequired: noop,
			onUpdateInstallBlocked: noop,
			onUpdateInstallFailed: noop,
			onUpdateInstallInFlight: noop,
		};
	}
};

// Initialize empty updater methods
createEmptyUpdaterMethods();

/**
 * The main process's own sentence for the operator's case.
 *
 * The update ran, pip exited 0 and nothing was installed. It names the release the
 * attempt was for and the version still running, because that is the pair a reader
 * can check - and it is copied from `UpdateService.updateBackend`'s failing branch
 * rather than invented, since the frame is a picture of that sentence.
 */
const SERVER_UPDATE_FAILURE_MESSAGE =
	"The server update to 0.55.10 did not take effect: the server is still on 0.55.9. See the update service log for pip's output, then try again.";

/**
 * The listeners `onBackendUpdateError` has registered for the current story.
 *
 * Module scope rather than inside `mockUpdaterApi`, because the mock is
 * re-installed on every decorator effect while the component's subscription
 * survives it - a registry rebuilt per install would leave an event fired at a
 * stale set of listeners with nothing to deliver to.
 */
const backendUpdateErrorListeners: Array<(message: string) => void> = [];

/**
 * Mock implementation of the window.api.updater methods
 */
const mockUpdaterApi = () => {
	// Mock API methods
	const updaterMethods = {
		checkForUpdates: async () =>
			Promise.resolve({
				updateInfo: mockUpdateInfo,
				cancellationToken: {},
			}),
		checkForBackendUpdates: async () => Promise.resolve(null),
		checkForAllUpdates: async () =>
			updateCheckVerdict({ app: "current", server: "current" }),
		getLastInstallAttempt: async () => null,
		updateBackend: async () => {
			/*
			 * The two server-update outcomes this file has stories for, produced in the
			 * order the main process produces them.
			 *
			 * An update that is still RUNNING never settles here, because a resolved answer
			 * would replace exactly the state that frame exists for. A FAILED update sends
			 * its reason on `backend-update-error` first and then RESOLVES false - which is
			 * the shape the renderer had to be fixed for, and the reason the failure frame
			 * is not a state the fixture can assemble without it.
			 */
			if (window.triggerBackendUpdateInFlight) {
				return new Promise<boolean>(() => {});
			}
			if (window.triggerBackendUpdateError) {
				for (const listener of [...backendUpdateErrorListeners]) {
					listener(SERVER_UPDATE_FAILURE_MESSAGE);
				}
				return false;
			}
			return true;
		},
		downloadUpdate: async () => Promise.resolve([]),
		quitAndInstall: async () => true,
		quitForUpdateInstall: async () => true,
		onUpdateDevMode: (callback: (message: string) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateDevMode) {
				// Immediately trigger the callback
				callback("Dev mode is active");
			}
			return () => {};
		},
		onUpdateNpxAvailable: (
			callback: (info: {
				currentVersion: string;
				latestVersion: string;
				updateCommand: string;
			}) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateNpxAvailable) {
				// Immediately trigger the callback
				callback({
					currentVersion: "1.0.0",
					latestVersion: "2.0.0",
					updateCommand: "npx local-operator-ui@latest",
				});
			}
			return () => {};
		},
		onBackendUpdateAvailable: (
			callback: (info: {
				currentVersion: string;
				latestVersion: string;
				updateCommand: string;
				canManageUpdate?: boolean;
				startupMode?: string;
				remedy?: string;
				detail?: string;
				sourceBuild?: boolean;
			}) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateAvailable) {
				// Immediately trigger the callback
				callback({
					currentVersion: "1.0.0",
					latestVersion: "2.0.0",
					updateCommand: "pip install --upgrade local-operator",
				});
			}
			// The operator's own case: a server installed as a uv tool, which the
			// app must not pip into, with the remedy named for that install.
			if (window.triggerBackendUpdateNonManaged) {
				callback({
					currentVersion: "0.54.17",
					latestVersion: "0.55.0",
					updateCommand: "uv tool upgrade local-operator",
					canManageUpdate: false,
					startupMode: "GLOBAL_INSTALL",
					remedy:
						"The server is a uv tool install, so update it from your terminal:",
					// Both producers of this state render the same details line and the
					// same closing sentence now, so the fixture carries what the main
					// process sends rather than the thinner payload this path used to
					// have (review U15).
					detail:
						"local-operator resolves to /Users/operator/.local/bin/local-operator (/Users/operator/.local/share/uv/tools/local-operator/bin/local-operator), classified as uv-tool",
					sourceBuild: false,
				});
			}
			return () => {};
		},
		onBackendUpdateDevMode: (callback: (message: string) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateDevMode) {
				// Immediately trigger the callback
				callback("Backend updates are disabled in development mode.");
			}
			return () => {};
		},
		onBackendUpdateNotAvailable: (
			callback: (info: { version: string }) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateNotAvailable) {
				// Immediately trigger the callback
				callback({ version: "1.0.0" });
			}
			return () => {};
		},
		onBackendUpdateCompleted: (callback: () => void) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateCompleted) {
				// Immediately trigger the callback
				callback();
			}
			return () => {};
		},
		onBackendUpdateError: (callback: (message: string) => void) => {
			/*
			 * Registered rather than fired at subscribe time, unlike the other triggers
			 * here: this channel reports the outcome of an ATTEMPT, and the panel only
			 * treats it as one while an attempt is in flight - which is the property the
			 * shipped listener has to have, because `checkForBackendUpdates` sends the
			 * same channel for the check's own failures. So the event is delivered by
			 * `updateBackend` above, where the main process delivers it.
			 */
			backendUpdateErrorListeners.push(callback);
			return () => {
				const at = backendUpdateErrorListeners.indexOf(callback);
				if (at >= 0) backendUpdateErrorListeners.splice(at, 1);
			};
		},
		onUpdateAvailable: (callback: (info: UpdateInfo) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateAvailable) {
				// Immediately trigger the callback instead of using setTimeout
				callback(mockUpdateInfo);
			}
			// Return a no-op cleanup function that won't reset the state
			return () => {};
		},
		onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateNotAvailable) {
				// Immediately trigger the callback
				callback(mockUpdateInfo);
			}
			return () => {};
		},
		onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateDownloaded) {
				// Immediately trigger the callback
				callback(mockUpdateInfo);
			}
			return () => {};
		},
		onUpdateError: (callback: (message: string) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateError) {
				// Immediately trigger the callback
				callback("Failed to check for updates: Network error");
			}
			return () => {};
		},
		onUpdateProgress: (callback: (progressObj: ProgressInfo) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateProgress) {
				// Immediately send initial progress
				callback({
					percent: 50,
					transferred: 50 * 1024 * 10,
					total: 1024 * 1024,
					bytesPerSecond: 1024 * 50,
					delta: 50 * 1024,
				});

				// No need for interval that might get cleared too soon
			}
			return () => {};
		},
		onBackendUpdateManualRequired: (
			callback: (info: {
				message: string;
				command: string;
				detail?: string;
				latestVersion?: string | null;
				currentVersion?: string | null;
				sourceBuild?: boolean;
			}) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateManualRequired) {
				// The operator's own machine: a uv tool whose `lop-update` is on PATH,
				// so the remedy is the source build's and the panel says its ceiling.
				// It is the case that could never clear itself on an exact version
				// match, because `lop-update` reports the checkout's version rather
				// than the published one (review U12).
				callback({
					message:
						"The server is a uv tool install built from source on this machine, so update it from your terminal:",
					command: "lop-update",
					detail:
						"local-operator resolves to /Users/operator/.local/bin/local-operator (/Users/operator/.local/share/uv/tools/local-operator/bin/local-operator), classified as uv-tool, built from source on this machine, so it follows the checkout rather than the published release",
					latestVersion: "0.54.20",
					currentVersion: "0.54.14",
					sourceBuild: true,
				});
			}
			// The same state reached the other way: the app attached to a server
			// started in a terminal (`EXISTING_SERVER`) rather than one it installed
			// itself. That path used to send a hardcoded `pip install --upgrade
			// local-operator` three lines below the code that had already learned
			// better, and this release promoted the notice from a toast into a
			// standing panel - so the wrong command would have stayed on screen
			// (review D4). This payload is a pipx-owned server, which is what that
			// path has to name now.
			if (window.triggerBackendUpdateManualRequiredExistingServer) {
				callback({
					message:
						"The server is a pipx install, so update it from your terminal:",
					command: "pipx upgrade local-operator",
					detail:
						"local-operator resolves to /Users/operator/.local/bin/local-operator (/Users/operator/.local/pipx/venvs/local-operator/bin/local-operator), classified as pipx",
					latestVersion: "0.54.20",
					currentVersion: "0.54.17",
					sourceBuild: false,
				});
			}
			return () => {};
		},
		onUpdateInstallBlocked: (
			callback: (info: {
				code: string;
				version: string | null;
				message: string;
				remedy: { text: string; url?: string; command?: string };
				// Both optional and both over the wire: the panel's heading map is keyed
				// by `code`, and one code covers the update-time refusal and the start-up
				// one, which are not the same news (design D2, D3).
				heading?: string | null;
				dismissLabel?: string | null;
				detail?: string;
			}) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateInstallBlocked) {
				callback({
					code: "installed-bundle-not-sealed",
					version: "0.18.0",
					message:
						"This install of Local Operator can't be updated in place, so the update to version 0.18.0 was stopped before the app quit.",
					remedy: {
						text: "Quit Local Operator, then download a fresh copy and replace the app in Applications.",
						url: "https://local-operator.com/download",
					},
					detail:
						"/Applications/Local Operator.app: errSecCSBadBundleFormat: a sealed resource is missing or invalid",
				});
			}
			// The start-up variant: the same code and remedy, no version, and a
			// message that says what actually happened. Production builds this one in
			// `installedBundleSealBlock(..., "startup")`; the drift guard in
			// `scripts/update-robustness.test.mjs` asserts this string equals that one.
			if (window.triggerUpdateInstallBlockedAtStartup) {
				callback({
					code: "installed-bundle-not-sealed",
					version: null,
					// The fact only; the remedy line below owns the instruction, and the
					// heading says what the state is rather than answering an update
					// question this user never asked (design D1, D2, D3). All three are
					// asserted against `installedBundleSealBlock(..., "startup")` by the
					// drift guard in `scripts/update-robustness.test.mjs`.
					heading: "This copy of Local Operator needs replacing",
					dismissLabel: "Not now",
					message:
						"This copy of Local Operator did not pass its integrity check, so it can't repair itself.",
					remedy: {
						text: "Quit Local Operator, then download a fresh copy and replace the app in Applications.",
						url: "https://local-operator.com/download",
					},
					detail:
						"/Applications/Local Operator.app: errSecCSBadBundleFormat: a sealed resource is missing or invalid",
				});
			}
			return () => {};
		},
		onUpdateInstallFailed: (
			callback: (info: {
				targetVersion: string;
				message: string;
				remedy: { text: string; url?: string; command?: string };
				detail: string;
				attempts?: number;
				cancelledByRelaunch?: boolean;
			}) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateInstallFailed) {
				callback({
					targetVersion: "0.18.0",
					message:
						"The update to version 0.18.0 didn't finish, so version 0.17.0 is still running.",
					remedy: {
						text: "Quit Local Operator and replace it in Applications with a fresh copy, or update again from the app.",
						url: "https://local-operator.com/download",
					},
					detail:
						"Install started 11/09/2026, 22:36:48 from /Users/operator/Library/Caches/local-operator-ui-updater/pending/local-operator-ui-0.18.0-universal.zip. Squirrel's own log is at /Users/operator/Library/Caches/com.local-operator.ShipIt/ShipIt_stderr.log.",
					attempts: 2,
				});
			}
			// The same failure with the cause this app can attest to: the app was
			// opened while the install was running, which is what cancels Squirrel's
			// install (the 2026-09-13 report). It is the state that has to name the
			// real cause rather than "the update didn't finish".
			if (window.triggerUpdateInstallFailedCancelledByRelaunch) {
				callback({
					targetVersion: "0.19.5",
					message:
						"The update to version 0.19.5 was cancelled because Local Operator was opened while the update was installing. Version 0.19.4 is still running.",
					remedy: {
						// The em dash, verbatim from `installFailurePayload`: this fixture is the
						// payload the main process sends, not a paraphrase of it, and a plain
						// hyphen here put copy into the committed frame that the app cannot
						// produce (reviews R6, D9). `update-robustness.test.mjs` asserts both
						// new states' fixture strings against their producers so it cannot
						// drift again.
						text: "Quit Local Operator and replace it in Applications with a fresh copy, or update again from the app — and leave it closed until the update finishes.",
						url: "https://local-operator.com/download",
					},
					detail:
						"Install started 13/09/2026, 09:39:00 from /Users/operator/Library/Caches/local-operator-ui-updater/pending/local-operator-ui-0.19.5-universal.zip. Squirrel cancels an install when an instance of the app is running. Squirrel's own log is at /Users/operator/Library/Caches/com.local-operator.ShipIt/ShipIt_stderr.log.",
					attempts: 1,
					cancelledByRelaunch: true,
				});
			}
			return () => {};
		},
		/**
		 * An install that is still running, found when the app came back mid-install.
		 *
		 * The state the incident needed and the app did not have: it says the update
		 * is alive, that the app being open is what stops it finishing, and offers
		 * the one action that can still save it.
		 */
		onUpdateInstallInFlight: (
			callback: (info: {
				targetVersion: string;
				message: string;
				detail: string;
			}) => void,
		) => {
			if (window.triggerUpdateInstallInFlight) {
				callback({
					targetVersion: "0.19.5",
					message:
						"Version 0.19.5 can't finish installing while Local Operator is open — keeping it open cancels the install. Quit and leave it closed until the app opens again by itself.",
					// The locale form `installStartedText` produces, not the marker's raw
					// ISO-8601 stamp: this fixture has to be the payload the main process
					// actually sends, and the raw stamp was the copy the app shipped by
					// mistake - it wrapped mid-token in the panel's details block (R1).
					detail:
						"Install started 13/09/2026, 09:39:00 from /Users/operator/Library/Caches/local-operator-ui-updater/pending/local-operator-ui-0.19.5-universal.zip, while version 0.19.4 was running.",
				});
			}
			return () => {};
		},
		onBeforeQuitForUpdate: () => {
			return () => {};
		},
	};

	// Apply mock API
	window.api.updater = updaterMethods;

	// Return cleanup function that does nothing to prevent state reset
	return () => {
		// No cleanup needed - we want to maintain the state for stories
	};
};

// Add custom properties to window for story control
declare global {
	interface Window {
		triggerUpdateAvailable?: boolean;
		triggerUpdateNotAvailable?: boolean;
		triggerUpdateDownloaded?: boolean;
		triggerUpdateError?: boolean;
		triggerUpdateProgress?: boolean;
		triggerUpdateDevMode?: boolean;
		triggerUpdateNpxAvailable?: boolean;
		triggerBackendUpdateAvailable?: boolean;
		triggerBackendUpdateNotAvailable?: boolean;
		triggerBackendUpdateCompleted?: boolean;
		triggerBackendUpdateError?: boolean;
		triggerBackendUpdateInFlight?: boolean;
		triggerBackendUpdateDevMode?: boolean;
		triggerBackendUpdateManualRequired?: boolean;
		triggerBackendUpdateManualRequiredExistingServer?: boolean;
		triggerBackendUpdateNonManaged?: boolean;
		triggerUpdateInstallBlocked?: boolean;
		triggerUpdateInstallBlockedAtStartup?: boolean;
		triggerUpdateInstallFailed?: boolean;
		triggerUpdateInstallFailedCancelledByRelaunch?: boolean;
		triggerUpdateInstallInFlight?: boolean;
		triggerNpxUpdate?: boolean;
		triggerDevMode?: boolean;
	}
}

/**
 * The UpdateNotification component displays notifications about available updates,
 * download progress, and installation options. It also provides a button to manually
 * check for updates.
 */
const meta = {
	title: "Common/UpdateNotification",
	component: UpdateNotification,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story, context) => {
			// Setup mock API
			useEffect(() => {
				const cleanup = mockUpdaterApi();
				return cleanup;
			}, []);

			// Set trigger flags based on story parameters
			useEffect(() => {
				window.triggerUpdateAvailable =
					context.parameters.triggerUpdateAvailable;
				window.triggerUpdateNotAvailable =
					context.parameters.triggerUpdateNotAvailable;
				window.triggerUpdateDownloaded =
					context.parameters.triggerUpdateDownloaded;
				window.triggerUpdateError = context.parameters.triggerUpdateError;
				window.triggerUpdateProgress = context.parameters.triggerUpdateProgress;
				window.triggerUpdateInstallBlocked =
					context.parameters.triggerUpdateInstallBlocked;
				window.triggerUpdateInstallBlockedAtStartup =
					context.parameters.triggerUpdateInstallBlockedAtStartup;
				window.triggerUpdateInstallFailed =
					context.parameters.triggerUpdateInstallFailed;
				window.triggerBackendUpdateManualRequired =
					context.parameters.triggerBackendUpdateManualRequired;
				window.triggerBackendUpdateManualRequiredExistingServer =
					context.parameters.triggerBackendUpdateManualRequiredExistingServer;
				window.triggerBackendUpdateNonManaged =
					context.parameters.triggerBackendUpdateNonManaged;
			}, [
				context.parameters.triggerUpdateAvailable,
				context.parameters.triggerUpdateNotAvailable,
				context.parameters.triggerUpdateDownloaded,
				context.parameters.triggerUpdateError,
				context.parameters.triggerUpdateProgress,
				context.parameters.triggerUpdateInstallBlocked,
				context.parameters.triggerUpdateInstallBlockedAtStartup,
				context.parameters.triggerUpdateInstallFailed,
				context.parameters.triggerBackendUpdateManualRequired,
				context.parameters.triggerBackendUpdateManualRequiredExistingServer,
				context.parameters.triggerBackendUpdateNonManaged,
			]);

			return (
				<div className="w-150 p-5">
					<Story />
				</div>
			);
		},
	],
	tags: ["autodocs"],
} satisfies Meta<typeof UpdateNotification>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default state of the UpdateNotification component.
 * This story doesn't trigger any update events, so we need to force a render.
 */
export const Default: Story = {
	args: {
		autoCheck: false,
	},
	render: () => {
		// Create a component that forces a render even in default state
		const DefaultComponent = () => {
			// Override the component to show something in default state
			return (
				<div className="rounded-lg border border-hairline border-dashed p-4">
					<h2 className="text-heading text-ink">Default state</h2>
					<p className="text-body text-ink-muted">
						This is the default state of the UpdateNotification component.
						Normally it doesn't render anything when no updates are available.
					</p>
				</div>
			);
		};

		return <DefaultComponent />;
	},
};

/**
 * Shows the component when it's checking for updates.
 */
export const Checking: Story = {
	args: {
		autoCheck: false,
	},
	parameters: {
		checking: true,
	},
	render: () => {
		// Create a component that forces the checking state to be true
		const CheckingComponent = () => {
			// Use useState to directly control the checking state
			const [isChecking, setIsChecking] = useState(true);

			// Override the checkForUpdates function to never resolve
			useEffect(() => {
				// Replace with a function that never resolves
				window.api.updater.checkForUpdates = async () => {
					// Set checking state directly
					setIsChecking(true);
					// Return a promise that never resolves to keep checking state true
					return new Promise<never>(() => {});
				};

				// Call checkForUpdates immediately
				window.api.updater.checkForUpdates();

				// Cleanup function that doesn't actually clean up
				// to maintain the state for the story
				return () => {
					// No cleanup needed - we want to maintain the state for stories
				};
			}, []);

			// If checking, render the checking UI directly
			if (isChecking) {
				return (
					<UpdateContainer>
						<h2 className="mb-3 text-heading text-ink">Checking for updates</h2>
						<p className="mb-2 text-body text-ink-muted">
							Please wait while we check for available updates...
						</p>
						<ProgressContainer>
							<Progress />
						</ProgressContainer>
					</UpdateContainer>
				);
			}

			// Fallback, should never reach here
			return <UpdateNotification autoCheck={true} />;
		};

		return <CheckingComponent />;
	},
};

/**
 * Shows the notification when an update is available.
 */
export const UpdateAvailable: Story = {
	args: {
		autoCheck: false,
	},
	parameters: {
		triggerUpdateAvailable: true,
	},
	render: () => {
		// Create a component that directly renders the update available state
		const UpdateAvailableComponent = () => {
			// Use state to force the component to render with update available
			const [available, setAvailable] = useState(true);
			const [info, setInfo] = useState({
				...mockUpdateInfo,
				releaseNotes:
					'<h3>New Features</h3><ul><li>Improved performance</li><li>Added dark mode</li><li>Fixed critical bugs</li></ul><p>See our <a href="https://example.com">documentation</a> for more details.</p>',
			});

			useEffect(() => {
				// Set the state immediately
				setAvailable(true);
				setInfo({
					...mockUpdateInfo,
					releaseNotes:
						'<h3>New Features</h3><ul><li>Improved performance</li><li>Added dark mode</li><li>Fixed critical bugs</li></ul><p>See our <a href="https://example.com">documentation</a> for more details.</p>',
				});

				// Set the trigger flag
				window.triggerUpdateAvailable = true;
			}, []);

			// If update is available, render the UI directly
			if (available && info) {
				return (
					<UpdateContainer>
						<h2 className="mb-3 text-heading text-ink">Update available</h2>
						<p className="mb-2 text-body text-ink-muted">
							Version {info.version} is available. You are currently using
							version {process.env.npm_package_version || "1.0.0"}.
						</p>
						{info.releaseNotes && (
							/* The same prose set the component uses, imported rather
							   than retyped: this story draws its own copy of the panel,
							   and the release-notes formatting defect it exists to show
							   was invisible precisely because the copy had drifted. */
							<div
								className={cn(
									"mt-2 text-body text-ink-muted",
									RELEASE_NOTES_PROSE,
								)}
							>
								Release notes:{" "}
								{typeof info.releaseNotes === "string"
									? parse(info.releaseNotes)
									: "See release notes on GitHub"}
							</div>
						)}
						<UpdateActions>
							{/* Dismiss first, commit last - the component's order. This
							    story hand-rolls the footer, so it has to be kept in
							    step by hand; drawn the other way it photographed a
							    layout the app no longer renders. */}
							<Button
								variant="outline"
								size="sm"
								onClick={() => {}}
								disabled={false}
							>
								Update later
							</Button>
							<Button
								variant="primary"
								size="sm"
								onClick={() => {}}
								disabled={false}
							>
								Download update
							</Button>
						</UpdateActions>
					</UpdateContainer>
				);
			}

			// Fallback to the actual component
			return <UpdateNotification autoCheck={false} />;
		};

		return <UpdateAvailableComponent />;
	},
};

/**
 * Shows the notification when an update is being downloaded, with progress indication.
 */
export const Downloading: Story = {
	args: {
		autoCheck: false,
	},
	parameters: {
		triggerUpdateAvailable: true,
		triggerUpdateProgress: true,
	},
	render: () => {
		// Create a component that directly renders the downloading state
		const DownloadingComponent = () => {
			// Use state to force the component to render with downloading state
			const [available, setAvailable] = useState(true);
			const [downloading, setDownloading] = useState(true);
			const [info, setInfo] = useState(mockUpdateInfo);
			const [progress] = useState<ProgressInfo>({
				percent: 45,
				transferred: 45 * 1024 * 10,
				total: 1024 * 1024,
				bytesPerSecond: 1024 * 50,
				delta: 45 * 1024,
			});

			useEffect(() => {
				// Set the state immediately
				setAvailable(true);
				setDownloading(true);
				setInfo(mockUpdateInfo);

				// Set the trigger flags
				window.triggerUpdateAvailable = true;
				window.triggerUpdateProgress = true;
			}, []);

			// If update is available and downloading, render the UI directly
			if (available && downloading && info) {
				return (
					<UpdateContainer>
						<h2 className="mb-3 text-heading text-ink">Update available</h2>
						<p className="mb-2 text-body text-ink-muted">
							Version {info.version} is available. You are currently using
							version {process.env.npm_package_version || "1.0.0"}.
						</p>
						{info.releaseNotes && (
							<div className="mt-2 text-body text-ink-muted">
								Release notes:{" "}
								{typeof info.releaseNotes === "string"
									? info.releaseNotes
									: "See release notes on GitHub"}
							</div>
						)}

						<ProgressContainer>
							<p className="text-body-sm text-ink-muted">
								Downloading: {Math.round(progress.percent)}%
							</p>
							<Progress value={progress.percent} className="mt-2" />
							<p className="mt-1 text-mono-sm text-ink-dim">
								{Math.round(progress.transferred / 1024)} KB of{" "}
								{Math.round(progress.total / 1024)} KB
							</p>
						</ProgressContainer>
					</UpdateContainer>
				);
			}

			// Fallback to the actual component
			return <UpdateNotification autoCheck={false} />;
		};

		return <DownloadingComponent />;
	},
};

/**
 * The state on screen once the bundle has been downloaded and is waiting for the
 * user to commit to the restart.
 *
 * It renders the component's own markup rather than a copy of it, the way the
 * install outcomes below do: this frame is what a reviewer looks at to see the
 * footer that the install fix changed (`Install now`, and the disabled
 * `Update later` while the pre-flight runs), and a hand-copied fixture drifted
 * from the component the moment the footer changed - so the pending state had no
 * frame at all and the fix could not be seen in the set (review U16).
 */
export const Downloaded: Story = {
	args: { autoCheck: false },
	parameters: { triggerUpdateDownloaded: true },
	render: () => <Triggered flag="triggerUpdateDownloaded" />,
};

/**
 * Shows the notification when there's an error checking for updates.
 */
export const ErrorState: Story = {
	args: {
		autoCheck: false,
	},
	parameters: {
		triggerUpdateError: true,
	},
	render: () => {
		// Create a component that directly renders the error state
		const ErrorComponent = () => {
			// Use state to force the component to render with error state
			const [error, setError] = useState(
				"Failed to check for updates: Network error",
			);
			const [open, setOpen] = useState(true);

			useEffect(() => {
				// Set the state immediately
				setError("Failed to check for updates: Network error");
				setOpen(true);

				// Set the trigger flag
				window.triggerUpdateError = true;
			}, []);

			// If there's an error, render the UI directly
			if (error) {
				return (
					<FloatingAlert
						open={open}
						autoHideDuration={6000}
						onClose={() => setOpen(false)}
						variant="danger"
					>
						{error}
					</FloatingAlert>
				);
			}

			// Fallback to the actual component
			return <UpdateNotification autoCheck={false} />;
		};

		return <ErrorComponent />;
	},
};

type UpdaterTriggerFlag =
	| "triggerUpdateDownloaded"
	| "triggerUpdateInstallBlocked"
	| "triggerUpdateInstallBlockedAtStartup"
	| "triggerUpdateInstallFailed"
	| "triggerUpdateInstallFailedCancelledByRelaunch"
	| "triggerUpdateInstallInFlight"
	| "triggerBackendUpdateManualRequired"
	| "triggerBackendUpdateManualRequiredExistingServer"
	| "triggerBackendUpdateNonManaged"
	| "triggerBackendUpdateError";

/**
 * Mount the real component with one of its event triggers already set.
 *
 * The mock updater delivers each event synchronously at subscribe time, so the
 * flag has to be in place before the component mounts: a `parameters` flag set
 * by the decorator arrives too late, which is why the older stories here draw
 * their own copy of the panel. These stories render the component's own markup
 * instead - a fixture that has drifted from the component is how a defect stays
 * invisible in a set of hundreds of pictures.
 */
const Triggered = ({ flag }: { flag: UpdaterTriggerFlag }) => {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		window[flag] = true;
		setReady(true);
	}, [flag]);
	return ready ? <UpdateNotification autoCheck={false} /> : null;
};

/**
 * The app refused to install the update because the installed bundle's code
 * seal does not verify - the state behind the operator's "damaged" report,
 * caught before the app quits and with a way out on screen.
 */
export const InstallBlocked: Story = {
	args: { autoCheck: false },
	parameters: { triggerUpdateInstallBlocked: true },
	render: () => <Triggered flag="triggerUpdateInstallBlocked" />,
};

/**
 * The same refusal reached from the other side: the start-up pass found the
 * running bundle already broken, with no update in play. It is a different
 * message on purpose - telling a user an update "was stopped before the app
 * quit" when they never asked for one describes an event that did not happen
 * (review R2). Same heading, same remedy, different second clause.
 */
export const InstallBlockedAtStartup: Story = {
	args: { autoCheck: false },
	parameters: { triggerUpdateInstallBlockedAtStartup: true },
	render: () => <Triggered flag="triggerUpdateInstallBlockedAtStartup" />,
};

/**
 * The next start after a ShipIt install that never completed: the app came back
 * on the old version and now says so, instead of silently re-offering.
 */
export const InstallFailed: Story = {
	args: { autoCheck: false },
	parameters: { triggerUpdateInstallFailed: true },
	render: () => <Triggered flag="triggerUpdateInstallFailed" />,
};

/**
 * The failure state that names the real cause: the app was opened while its
 * update was installing, which is what cancels Squirrel's install. It is the
 * 2026-09-13 report, and the retry it offers is only useful if the user is told
 * to leave the app closed this time.
 */
export const InstallFailedCancelledByRelaunch: Story = {
	args: { autoCheck: false },
	parameters: { triggerUpdateInstallFailedCancelledByRelaunch: true },
	render: () => (
		<Triggered flag="triggerUpdateInstallFailedCancelledByRelaunch" />
	),
};

/**
 * The app came back while its update was still installing: not a failure, and
 * the one state where quitting is the action that saves the update.
 */
export const InstallInFlight: Story = {
	args: { autoCheck: false },
	parameters: { triggerUpdateInstallInFlight: true },
	render: () => <Triggered flag="triggerUpdateInstallInFlight" />,
};

/**
 * A server the app cannot update itself (a uv tool install), with the command
 * that can - named for how that server is installed, not the bare pip guess.
 */
export const BackendManualRequired: Story = {
	args: { autoCheck: false },
	parameters: { triggerBackendUpdateManualRequired: true },
	render: () => <Triggered flag="triggerBackendUpdateManualRequired" />,
};

/**
 * The same by-hand state, reached through the other producer: the app attached
 * to a server the user started in a terminal, rather than one it installed
 * itself. That path used to hardcode `pip install --upgrade local-operator` in
 * the main process whatever owned the environment - and this release is what
 * promoted the notice from a toast into a standing panel, so a wrong command
 * would now stay on screen until dismissed (review D4). Here the server is a
 * pipx install, so the command the panel names is pipx's.
 */
export const BackendManualRequiredExistingServer: Story = {
	args: { autoCheck: false },
	parameters: { triggerBackendUpdateManualRequiredExistingServer: true },
	render: () => (
		<Triggered flag="triggerBackendUpdateManualRequiredExistingServer" />
	),
};

/**
 * A server installed as a uv tool: the app cannot update it, and the command it
 * names is the one that installer owns - not the pip line the operator was
 * shown for a uv tool install.
 */
export const BackendUpdateNonManaged: Story = {
	args: { autoCheck: false },
	parameters: { triggerBackendUpdateNonManaged: true },
	render: () => <Triggered flag="triggerBackendUpdateNonManaged" />,
};
/**
 * The panel driven the way the user drives it: raise the offer, press its own
 * "Update server", and let the main process answer.
 *
 * Two states in this file need that press and neither can be reached by a trigger
 * flag alone, because both exist only WHILE the invoked update is running or after
 * it has answered: the in-flight panel the operator was stuck on (design D2's
 * "before" half), and the failure that replaced it. The flag has to be set before
 * the component subscribes, as every `Triggered` story here does, and
 * `capturePending` holds the shutter until the press has painted - the pattern
 * `app-updates-section.stories.tsx` uses for its own press.
 */
const PressUpdateServer = ({ outcome }: { outcome: "inflight" | "failed" }) => {
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		window.triggerBackendUpdateAvailable = true;
		window.triggerBackendUpdateInFlight = outcome === "inflight";
		window.triggerBackendUpdateError = outcome === "failed";
		setReady(true);
	}, [outcome]);
	useEffect(() => {
		if (!ready) return;
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const expected =
			outcome === "inflight"
				? "Updating server"
				: "The server update didn't finish";
		const settle = async () => {
			/* The offer is raised by the mount effect, so the control exists only
			   after a pass - poll for it rather than assume the timing. */
			for (let i = 0; i < 200; i++) {
				const button = [...document.querySelectorAll("button")].find(
					(candidate) => candidate.textContent?.trim() === "Update server",
				);
				if (button) {
					button.click();
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			for (let i = 0; i < 200; i++) {
				if (document.body.textContent?.includes(expected)) break;
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			await new Promise((resolve) =>
				requestAnimationFrame(() => resolve(null)),
			);
			if (!cancelled) {
				delete document.documentElement.dataset.capturePending;
			}
		};
		void settle();
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.capturePending;
		};
	}, [ready, outcome]);
	return ready ? <UpdateNotification autoCheck={false} /> : null;
};

/**
 * The panel WHILE a server update is running: the state the operator was stuck on.
 *
 * The "before" half of the report this branch fixes, and it had no frame anywhere
 * in the repository - the in-flight panel was a state nobody had photographed,
 * which is why the hang could be described but not shown (design D2). The invoked
 * update never settles, because a resolved answer would replace exactly the state
 * under test.
 */
export const BackendUpdateInFlight: Story = {
	args: { autoCheck: false },
	render: () => <PressUpdateServer outcome="inflight" />,
};

/**
 * A server update that FAILED, as the user sees it after this branch's fix.
 *
 * This is the state the design round re-judges: a standing failed-tone panel in
 * the panel slot carrying the main process's own sentence, with both actions - try
 * it again, or defer the release. `triggerBackendUpdateError` was declared before
 * this story existed and nothing set it, so the state could not be photographed at
 * all and the design round measured it through a scratch rig instead (design D2).
 *
 * The failure arrives the way the main process sends it - the reason goes out on
 * `backend-update-error` and the invoke then resolves `false` - so the frame is of
 * the real sequence rather than of a state the fixture assembled by hand.
 */
export const BackendUpdateFailed: Story = {
	args: { autoCheck: false },
	render: () => <PressUpdateServer outcome="failed" />,
};
