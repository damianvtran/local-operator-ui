import { Button, Progress } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import parse from "html-react-parser";
import { useEffect, useLayoutEffect, useState } from "react";
import { updateCheckVerdict } from "../../../../../main/update-check-verdict";
import type {
	BackendUpdateCompletion,
	BackendUpdateErrorReport,
} from "../../../../../main/update-service";
import { UpdateErrorAlert } from "./update-error-alert";
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
			onBackendUpdateProgress: () => () => {},
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
			onUpdateInstallProgress: noop,
			onUpdateInstallSucceeded: noop,
		};
	}
};

// Initialize empty updater methods
createEmptyUpdaterMethods();

const SOURCE_BUILD_REFUSAL_SENTENCE =
	"The server update did not install: `lop-update` exited 1. This checkout is behind its remote, which is what `lop-update` refused to build from: bring the checkout up to date, and the next press here will build it. The installer's own output is below. You can also run `lop-update` yourself in a terminal.";

const SOURCE_BUILD_REFUSAL_OUTPUT = [
	"lop-update: warning: could not fetch origin (offline?); comparing against the last known state of origin/main",
	"lop-update: REFUSING to release a stale ref.",
	"local  main          = 2a0b473",
	"remote origin/main = 4b32d95  (1 commit(s) ahead)",
	"Local main is BEHIND origin/main, so installing it would publish code",
	"older than what is merged -- and would report success while doing it.",
].join("\n");

const ORPHANED_UPDATER_SENTENCE =
	"The server update did not finish: the installer could not be run to a verdict. The updater was stopped; something it started may still be replacing the install. Nothing was restarted: the build that was serving is the build still serving. The installer's own output is below.";

const ORPHANED_UPDATER_OUTPUT = [
	"lop-update: mobile web bundle: built",
	"Resolved 55 packages in 1.25s",
	"   Building local-operator @ file:///tmp/lop-update.jegEuB",
	"Downloading cryptography (3.8MiB)",
].join("\n");

const SOURCE_BUILD_REMEDY =
	"Rebuilds this checkout with `lop-update`. The app waits for the turns running on this machine to finish first, and the rebuild then reinstalls this install in place - so a turn started while it runs can still be interrupted - and it can take up to half an hour. This install keeps reporting the checkout's version, not the release the app offered.";

const OFFER_DETAIL =
	"local-operator resolves to /Users/operator/.local/bin/local-operator (/Users/operator/.local/share/uv/tools/local-operator/bin/local-operator), classified as uv-tool. source build of this machine's checkout; an in-place rebuild.";

const APP_OWNED_REMEDY =
	"This server is running from Local Operator's own managed environment, which no package manager owns - so there is no terminal command that can update it correctly. The app can only update a server it started itself: stop this one, then start Local Operator again and let it start its own.";

const APP_OWNED_DETAIL =
	'The server serving this app runs from Local Operator\'s own managed environment at /Users/operator/Library/Application Support/Local Operator/managed-python/3.13, which the app owns rather than a package manager (the backend reports it as install kind "managed-venv"), at version 0.56.10.';

/*
 * THE SENTENCE MAIN COMPOSES FOR THIS STATE, not a paraphrase of it (design
 * review round 2, D2).
 *
 * WHY IT CHANGED. This fixture is a stand-in for the payload `backend-update-error`
 * carries, and the story is the only committed frame for "a genuine failure still
 * reads as a failure". It used to read "...the server is still on 0.55.9. See the
 * update service log for pip's output, then try again.", which NO arm of
 * `serverUpdateFailureSentence` can produce - so the frame a reviewer would cite
 * for that claim was a picture of wording this build cannot emit, the class the
 * alert's own comment names ("a fixture drifts from the component it stands for").
 *
 * It is now the composer's own non-rebuild, ran-true, exit-0 arm at these two
 * versions, and `scripts/update-robustness.test.mjs` composes the same facts
 * through the real module and fails if this literal drifts from it again - the
 * composer lives in the main process, so the story cannot import it and a test is
 * what holds the two together.
 */
const SERVER_UPDATE_FAILURE_MESSAGE =
	"The server update to 0.55.10 did not take effect: the install still reports 0.55.9. Nothing was restarted: the build that was serving is the build still serving. The installer's own output is below.";

/*
 * THE INSTALLER'S OWN WORDS FOR THAT ATTEMPT, and they are not decoration: the
 * sentence above points at them.
 *
 * WHY THEY HAVE TO BE HERE (review round 3, R3-1 = design D4). The composer picks
 * the "output is below" pointer only when the diagnosis is non-empty
 * (`server-update-copy.ts`), and the producer sends `installerOutput: diagnosis ||
 * undefined` from that same value (`update-service.ts`), while the panel renders
 * the block only when the payload carries it (`update-notification.tsx`). A
 * payload with that sentence and no output is therefore a pairing no shipped path
 * composes - and the twelve committed frames showed exactly that: "The installer's
 * own output is below." over nothing, on the one frame for "a genuine failure still
 * reads as a failure". The pin in `scripts/update-robustness.test.mjs` now asserts
 * the pairing, so the sentence and the block cannot part company again.
 */
const SERVER_UPDATE_FAILURE_OUTPUT = [
	"uv tool upgrade local-operator",
	"Resolved 55 packages in 1.02s",
	"Installed 1 package in 12ms",
	" + local-operator==0.55.10",
].join("\n");

/**
 * The listeners `onBackendUpdateError` has registered for the current story.
 *
 * Module scope rather than inside `mockUpdaterApi`, because the mock is
 * re-installed on every decorator effect while the component's subscription
 * survives it - a registry rebuilt per install would leave an event fired at a
 * stale set of listeners with nothing to deliver to.
 */
const backendUpdateErrorListeners: Array<
	(report: BackendUpdateErrorReport) => void
> = [];

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
			/*
			 * THE FAILURE THAT CARRIES A DIAGNOSIS. `SOURCE_BUILD_REFUSAL_OUTPUT` is the operator's
			 * OWN `lop-update` output - captured by driving the real script in an isolated
			 * repository whose `main` is one commit behind its `origin/main`, so it refuses before
			 * it builds - with the producer's own selection applied: the diagnosis at the head,
			 * never the line that advises going around the refusal (review round 2, U7).
			 */
			if (window.triggerBackendUpdateSourceBuildFailed) {
				for (const listener of [...backendUpdateErrorListeners]) {
					listener({
						message: SOURCE_BUILD_REFUSAL_SENTENCE,
						installerOutput: SOURCE_BUILD_REFUSAL_OUTPUT,
						phase: "update",
						logPath:
							"/Users/operator/Library/Application Support/Local Operator/logs/update-service.log",
					});
				}
				return false;
			}
			if (window.triggerBackendUpdateFailedOrphan) {
				for (const listener of [...backendUpdateErrorListeners]) {
					listener({
						message: ORPHANED_UPDATER_SENTENCE,
						installerOutput: ORPHANED_UPDATER_OUTPUT,
						phase: "update",
						logPath:
							"/Users/operator/Library/Application Support/Local Operator/logs/update-service.log",
					});
				}
				return false;
			}
			if (window.triggerBackendUpdateError) {
				for (const listener of [...backendUpdateErrorListeners]) {
					listener({
						message: SERVER_UPDATE_FAILURE_MESSAGE,
						// The diagnosis the sentence above points at, from the same value
						// the producer derives both from (review round 3, R3-1 = D4).
						installerOutput: SERVER_UPDATE_FAILURE_OUTPUT,
						phase: "update",
						logPath:
							"/Users/operator/Library/Application Support/Local Operator/logs/update-service.log",
					});
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
				/** Whether the app owns the daemon it would restart, which decides the promise. */
				restartable?: boolean;
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
			/*
			 * THE SOURCE-BUILD ROUTE, as the main process sends it: the install is a uv-tool build
			 * of THIS machine's checkout (`.lop-source` names a commit), the machine has
			 * `lop-update`, and the app runs it rather than handing over a command. The payload is
			 * the plan's own (`resolveGlobalInstallPlan` with a resolved rebuild tool), so the frame
			 * shows copy the producer emits and not a sentence a fixture invented. The adopted arm
			 * adds the one field they differ in: who would be restarted, and so whether the
			 * reassurance is the restart's or the install's.
			 */
			if (
				window.triggerBackendUpdateSourceBuild ||
				window.triggerBackendUpdateSourceBuildInFlight ||
				window.triggerBackendUpdateSourceBuildAdopted
			) {
				callback({
					currentVersion: "0.56.10",
					latestVersion: "0.56.11",
					updateCommand: "lop-update",
					canManageUpdate: true,
					startupMode: "GLOBAL_INSTALL",
					restartable: !window.triggerBackendUpdateSourceBuildAdopted,
					remedy: SOURCE_BUILD_REMEDY,
					detail: OFFER_DETAIL,
					sourceBuild: true,
				});
			}
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
			callback: (info: {
				version: string;
				runningVersion?: string | null;
				restartable?: boolean;
				/**
				 * The install's own ownership, carried on this event too (design D5).
				 *
				 * Declared here as well as forwarded below because this mock stands in for
				 * the preload bridge, and a mock whose parameter type is narrower than the
				 * bridge's is a story that cannot reach the arm its docstring describes.
				 */
				appOwnedEnvironment?: boolean;
			}) => void,
		) => {
			/*
			 * The SKEW payload is a different event on the same channel, and the difference
			 * is the whole subject of the frames the flag below exists for: this is how the
			 * app learns that the install on disk and the server SERVING it are on
			 * different builds, which main sends on the state where there is nothing to
			 * offer because the install is already the published release. The plain
			 * `{ version }` arm is the channel's other use and the notice's own funnel
			 * declines on it (no readable running reading, so no skew to state), which is
			 * why a story that wants the panel has to carry the readings rather than a
			 * placeholder.
			 */
			if (window.triggerBackendUpdateSkew && window.backendSkewReadings) {
				callback({
					version: window.backendSkewReadings.version,
					runningVersion: window.backendSkewReadings.runningVersion,
					restartable: window.backendSkewReadings.restartable,
					/*
					 * FORWARDED, not just declared. The flag on the readings is what the
					 * panel's control is gated on (design D5), so a mock that dropped it
					 * rendered the panel in its no-action state and the frame showed a
					 * different surface than the story's own docstring describes - caught
					 * by LOOKING at the re-taken frame, which is the only way this class
					 * of gap is visible.
					 */
					appOwnedEnvironment: window.backendSkewReadings.appOwnedEnvironment,
				});
			}
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateNotAvailable) {
				// Immediately trigger the callback
				callback({ version: "1.0.0" });
			}
			return () => {};
		},
		onBackendUpdateCompleted: (
			callback: (completion: BackendUpdateCompletion | null) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateCompleted) {
				// Immediately trigger the callback. Null is the plain success payload;
				// a shaped one is what a story that is about a FAILED attempt sets -
				// `backendSkewCompletion` - so the frame shows what the producer actually
				// sends on `restarted: false` rather than a thinner fixture.
				callback(window.backendSkewCompletion ?? null);
			}
			return () => {};
		},
		onBackendUpdateError: (
			callback: (report: BackendUpdateErrorReport) => void,
		) => {
			/*
			 * Registered rather than fired at subscribe time, unlike the other triggers
			 * here: this channel reports the outcome of an ATTEMPT, and the panel only
			 * treats it as one while an attempt is in flight - which is the property the
			 * shipped listener has to have, because `checkForBackendUpdates` sends the
			 * same channel for the check's own failures, tagged `phase: "check"`. So the
			 * event is delivered by `updateBackend` above, where the main process
			 * delivers it.
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
				/** The app's own managed environment: the remedy is a restart, not a command. */
				appOwned?: boolean;
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
			/*
			 * THE APP-OWNED ARM, which had no fixture and therefore no frame until round 5.
			 * `ManualRemedyNote` returns null for it, and the other fixtures never set it, so the
			 * state this pass is about was the one state with no photograph. The payload is the
			 * producer's own: the managed-arm remedy and detail verbatim, `updateCommand: ""` and
			 * `appOwned: true`.
			 */
			if (window.triggerBackendUpdateManualRequiredAppOwned) {
				callback({
					message: APP_OWNED_REMEDY,
					command: "",
					detail: APP_OWNED_DETAIL,
					latestVersion: "0.56.11",
					currentVersion: "0.56.10",
					sourceBuild: false,
					appOwned: true,
				});
			}
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
			// The 0.29.6 class: the artifact the updater downloaded carries a restricted
			// entitlement (`keychain-access-groups`) with no provisioning profile to
			// authorize it, so macOS refuses to spawn it and installing it would leave
			// the user with no app at all. Production builds this one in
			// `stagedSignatureBlock` (`src/main/update-install.ts`), and the drift guard in
			// `scripts/update-robustness.test.mjs` asserts the strings below equal that
			// builder's own - a frame captured from this fixture has to show the copy
			// the app would really send.
			if (window.triggerUpdateInstallBlockedCannotLaunch) {
				callback({
					code: "artifact-cannot-launch",
					version: "0.29.6",
					message:
						"The update to version 0.29.6 can't be launched by macOS, so it wasn't installed.",
					// No URL, and that is the point of this fixture (design round 1, D1): every
					// affordance behind the download page resolves to `releases/latest`, the
					// channel that staged this artifact, so the primary action would hand the
					// reader the bundle the app just refused. The sentence names the version to
					// avoid and says the next release arrives the ordinary way.
					remedy: {
						text: "Keep using this copy, and skip version 0.29.6 if you download one by hand — the next release will be offered here as usual.",
					},
					// "Not now" rather than the shared "Update later": this state says the
					// update cannot be installed, so a label promising it will happen later
					// contradicts the panel (design round 1, D6).
					dismissLabel: "Not now",
					detail:
						"local-operator-ui-0.29.6-arm64.zip claims keychain-access-groups and carries no Contents/embedded.provisionprofile.",
				});
			}
			// The same code, the other arm: the staged archive's signature could not be
			// READ at all and no profile is embedded, so the app refuses rather than
			// guess - and it must not paint "The update can't be launched", which is the
			// one thing this state does not know (design round 1, D3). Production builds
			// it in the same `stagedSignatureBlock`, whose `entitlementsPlist == null`
			// branch carries the heading below.
			if (window.triggerUpdateInstallBlockedCannotCheck) {
				callback({
					code: "artifact-cannot-launch",
					version: "0.29.6",
					heading: "The update couldn't be checked",
					message:
						"The update to version 0.29.6 can't be checked for launch, so it wasn't installed.",
					remedy: {
						text: "Check for updates again to re-download the release.",
					},
					dismissLabel: "Not now",
					detail:
						"local-operator-ui-0.29.6-arm64.zip carries no Contents/embedded.provisionprofile and its signature could not be read.",
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
		onBackendUpdateProgress: (
			callback: (progress: {
				phase: "draining" | "installing" | "restarting";
				sourceRebuild?: boolean;
			}) => void,
		) => {
			/*
			 * THE PHASE, as a story state (UX U6). No story drove this channel, so
			 * `backendUpdatePhase` was null in every captured frame - the `-in-flight`
			 * frame in the set is the phase-null FALLBACK - while the panel a real user
			 * watches for the install's ~85 s is one of the two phase panels. The
			 * trigger is set before mount, like every other one here, so the phase has
			 * arrived by the time the shipped listener subscribes.
			 *
			 * IT BELONGS IN THIS MOCK, and the first attempt at it did not: the same
			 * method name appears in `createEmptyUpdaterMethods` above, which these
			 * stories never take (the decorator installs this one), so a trigger written
			 * there rendered the fallback and the frame looked plausible - which is why
			 * the phase panels are checked by LOOKING at the frame and not by the
			 * capture's exit code.
			 */
			if (window.triggerBackendUpdatePhase) {
				callback({ phase: window.triggerBackendUpdatePhase });
			}
			/*
			 * AND WHICH ROUTE IS RUNNING (review round 3, D2 = U3). The release path's
			 * reassurance is false for a checkout rebuild - that run rewrites the install in
			 * place, which is what can interrupt a session here - and the event is the only
			 * place left that can say so, because the offer naming the cost unmounted the
			 * moment the press landed.
			 */
			if (window.triggerBackendUpdateSourceBuildInFlight) {
				callback({ phase: "installing", sourceRebuild: true });
			}
			return () => {};
		},
		/**
		 * The step a pre-quit install is on, as the panel reports it.
		 *
		 * A string flag rather than a boolean, like `triggerBackendUpdatePhase`:
		 * there are three phases and a story has to say which one, and the phase is
		 * exactly what the sentence on screen is derived from.
		 */
		onUpdateInstallProgress: (
			callback: (info: { phase: "verifying" | "staging" | "starting" }) => void,
		) => {
			if (window.triggerInstallProgress) {
				callback({ phase: window.triggerInstallProgress });
			}
			return () => {};
		},
		/**
		 * An install that landed, with the version it landed on.
		 *
		 * The signal only exists once the work it describes is over, so unlike the
		 * phase flags it carries no state to set up: the story says which version, and
		 * nothing else about the launch matters.
		 */
		onUpdateInstallSucceeded: (
			callback: (info: { version: string }) => void,
		) => {
			if (window.triggerInstallSucceeded) {
				callback({ version: window.triggerInstallSucceeded });
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
		triggerBackendUpdateSourceBuildFailed?: boolean;
		triggerBackendUpdateFailedOrphan?: boolean;
		triggerBackendUpdateSourceBuild?: boolean;
		triggerBackendUpdateSourceBuildAdopted?: boolean;
		triggerBackendUpdateSourceBuildInFlight?: boolean;
		triggerBackendUpdateManualRequiredAppOwned?: boolean;
		triggerBackendUpdateAvailable?: boolean;
		triggerBackendUpdateNotAvailable?: boolean;
		/**
		 * The skew notice's own readings, delivered on `backend-update-not-available`.
		 *
		 * Separate from the boolean flag above rather than another trigger name: the
		 * panel's subject is the PAIR of versions, so a story has to state both - which
		 * is why the flag only says "fire this event" and the readings say what the
		 * event carries.
		 */
		triggerBackendUpdateSkew?: boolean;
		backendSkewReadings?: {
			version: string;
			runningVersion: string;
			restartable: boolean;
			/**
			 * Whether the INSTALL this check read is the app's own environment.
			 *
			 * The second ownership reading (design D5), and the one the panel's restart
			 * control is gated on: `restartable` is true on a global install too, where
			 * the press behind that control is the install's own updater.
			 */
			appOwnedEnvironment: boolean;
		};
		/**
		 * The completion payload a story drives, instead of the plain success `null`.
		 *
		 * The failed-restart arms exist only as a COMPLETION - `restarted: false` with
		 * the readings the attempt read afterwards - so a story that has to show what
		 * the user sees after a restart that did not take has to send one. Both arms
		 * of that failure are here: the daemon still answering an older build, and the
		 * daemon that never came back at all (UX U1).
		 */
		backendSkewCompletion?: {
			installVersion: string | null;
			runningVersion: string | null;
			restarted: boolean;
			restartable?: boolean;
			appOwnedEnvironment?: boolean;
			serverDidNotComeBack?: boolean;
		};
		triggerBackendUpdateCompleted?: boolean;
		triggerBackendUpdateError?: boolean;
		triggerBackendUpdateInFlight?: boolean;
		/**
		 * The phase the main process announces while the update runs, for the two
		 * frames that show what the reader watches for the install itself (UX U6):
		 * `installing` while the environment lands, `restarting` while the daemon
		 * comes back onto it.
		 */
		triggerBackendUpdatePhase?: "draining" | "installing" | "restarting";
		triggerBackendUpdateDevMode?: boolean;
		triggerBackendUpdateManualRequired?: boolean;
		triggerBackendUpdateManualRequiredExistingServer?: boolean;
		triggerBackendUpdateNonManaged?: boolean;
		triggerUpdateInstallBlocked?: boolean;
		triggerUpdateInstallBlockedAtStartup?: boolean;
		triggerUpdateInstallBlockedCannotLaunch?: boolean;
		triggerUpdateInstallBlockedCannotCheck?: boolean;
		triggerUpdateInstallFailed?: boolean;
		triggerUpdateInstallFailedCancelledByRelaunch?: boolean;
		triggerUpdateInstallInFlight?: boolean;
		/** Which phase the pre-quit install reports, and the version that landed. */
		triggerInstallProgress?: "verifying" | "staging" | "starting";
		triggerInstallSucceeded?: string;
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
				window.triggerUpdateInstallBlockedCannotLaunch =
					context.parameters.triggerUpdateInstallBlockedCannotLaunch;
				window.triggerUpdateInstallBlockedCannotCheck =
					context.parameters.triggerUpdateInstallBlockedCannotCheck;
				window.triggerUpdateInstallFailed =
					context.parameters.triggerUpdateInstallFailed;
				window.triggerBackendUpdateManualRequired =
					context.parameters.triggerBackendUpdateManualRequired;
				window.triggerBackendUpdateManualRequiredExistingServer =
					context.parameters.triggerBackendUpdateManualRequiredExistingServer;
				window.triggerBackendUpdateNonManaged =
					context.parameters.triggerBackendUpdateNonManaged;
				window.triggerInstallProgress =
					context.parameters.triggerInstallProgress;
				window.triggerInstallSucceeded =
					context.parameters.triggerInstallSucceeded;
			}, [
				context.parameters.triggerUpdateAvailable,
				context.parameters.triggerUpdateNotAvailable,
				context.parameters.triggerUpdateDownloaded,
				context.parameters.triggerUpdateError,
				context.parameters.triggerUpdateProgress,
				context.parameters.triggerUpdateInstallBlocked,
				context.parameters.triggerUpdateInstallBlockedAtStartup,
				context.parameters.triggerUpdateInstallBlockedCannotLaunch,
				context.parameters.triggerUpdateInstallBlockedCannotCheck,
				context.parameters.triggerUpdateInstallFailed,
				context.parameters.triggerBackendUpdateManualRequired,
				context.parameters.triggerBackendUpdateManualRequiredExistingServer,
				context.parameters.triggerBackendUpdateNonManaged,
				context.parameters.triggerInstallProgress,
				context.parameters.triggerInstallSucceeded,
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
 * The alert the operator photographed, on the screen they were working on.
 *
 * WHY IT RENDERS THE SHIPPED COMPONENT AND NOT A COPY OF IT. This story used to
 * draw its own `FloatingAlert` around a hardcoded sentence, which is how a
 * fixture drifts from the component it stands for: the surface with NO frame in
 * the tree was the one whose message the operator's report is about, and the
 * message it drew was a string ("Failed to check for updates: Network error")
 * that no producer in the app ever wrote. The message below is the operator's
 * own - their `update-service.log` holds `net::ERR_INTERNET_DISCONNECTED` at
 * 09:03:12 on 2026-09-16, on a machine with continuous internet, as a red alert
 * over the chat screen.
 *
 * WHY IT IS HELD OPEN. `UpdateErrorAlert` renders through `FloatingAlert`, and
 * the app gives it a six-second lifetime - a still cannot photograph a message
 * that dismisses itself while the rig is resizing, so the frame holds it, the
 * same way the refusal story holds its own. The WIRING (event or invoke
 * rejection, one verdict, the sentence a person reads and the code beneath it)
 * is not what a still can prove; it is
 * `scripts/update-affirmation.test.mjs`, which drives the real component's
 * listeners and reads both lines of the alert.
 */
export const ErrorState: Story = {
	args: {
		autoCheck: false,
	},
	render: () => (
		<div className="min-h-screen bg-canvas">
			<div className="flex h-full flex-col gap-3 p-6">
				<h1 className="font-medium text-body text-ink">Conversations</h1>
				<ul className="flex max-w-xl flex-col gap-2">
					{[
						"Deploy the staging cluster",
						"Review the paging change",
						"Triage the support queue",
					].map((row) => (
						<li
							key={row}
							className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-2"
						>
							<span className="text-body-sm text-ink">{row}</span>
							<span className="text-meta text-ink-dim">idle</span>
						</li>
					))}
				</ul>
			</div>
			<UpdateErrorAlert
				open
				message="net::ERR_INTERNET_DISCONNECTED"
				onClose={() => {}}
				/*
				 * The retry the sentence names, exactly as the app passes it: a
				 * still of the failure without it would photograph a state no user
				 * reaches (design round 1, D3 - the copy said "then try again" and
				 * the only control was the X).
				 */
				onRetry={() => {}}
			/>
		</div>
	),
};

/**
 * The same alert for the failure the PR's own log holds, which is the one the
 * copy's prefix rule is about (design round 1, D1; UX U2).
 *
 * WHY THIS FRAME IS THE POINT OF THE RULE. electron-updater wraps a failed feed
 * fetch in 200 characters of its own parse narration - "Cannot parse releases
 * feed: Unable to find latest version on GitHub (https://...), please ensure a
 * production release exists: net::ERR_NETWORK_CHANGED" - and keeping that as the
 * sentence's prefix produced a six-line run-on with a URL in it, addressed to
 * the release owner rather than to the person reading it. The message below is
 * the string as the app receives it, and the frame is what the rule produces:
 * the sentence alone, the machine's words subordinate.
 */
export const ErrorStateWrapped: Story = {
	args: {
		autoCheck: false,
	},
	render: () => (
		<div className="min-h-screen bg-canvas">
			<div className="flex h-full flex-col gap-3 p-6">
				<h1 className="font-medium text-body text-ink">Conversations</h1>
				<ul className="flex max-w-xl flex-col gap-2">
					{[
						"Deploy the staging cluster",
						"Review the paging change",
						"Triage the support queue",
					].map((row) => (
						<li
							key={row}
							className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-2"
						>
							<span className="text-body-sm text-ink">{row}</span>
							<span className="text-meta text-ink-dim">idle</span>
						</li>
					))}
				</ul>
			</div>
			<UpdateErrorAlert
				open
				message={WRAPPED_FEED_FAILURE}
				onClose={() => {}}
				onRetry={() => {}}
			/>
		</div>
	),
};

/**
 * The wrapped shape the log actually holds, as the app receives it.
 *
 * Kept beside the story rather than imported from the test harness: a fixture
 * that reads the failure out of a test file is a fixture that can drift from
 * what main sends, and this string is a transcription of
 * `docs/evidence/update-robustness/transient-transport-log-excerpts.txt` section
 * 4 (2026-09-15 21:52).
 */
const WRAPPED_FEED_FAILURE =
	"Cannot parse releases feed: Unable to find latest version on GitHub (https://github.com/damianvtran/local-operator-ui/releases/latest), please ensure a production release exists: net::ERR_NETWORK_CHANGED";

type UpdaterTriggerFlag =
	| "triggerUpdateDownloaded"
	| "triggerUpdateInstallBlocked"
	| "triggerUpdateInstallBlockedAtStartup"
	| "triggerUpdateInstallBlockedCannotLaunch"
	| "triggerUpdateInstallBlockedCannotCheck"
	| "triggerUpdateInstallFailed"
	| "triggerUpdateInstallFailedCancelledByRelaunch"
	| "triggerUpdateInstallInFlight"
	| "triggerBackendUpdateManualRequired"
	| "triggerBackendUpdateManualRequiredExistingServer"
	| "triggerBackendUpdateNonManaged"
	| "triggerBackendUpdateError"
	| "triggerBackendUpdateSourceBuild"
	| "triggerBackendUpdateSourceBuildAdopted"
	| "triggerBackendUpdateSourceBuildInFlight"
	| "triggerBackendUpdateSourceBuildFailed"
	| "triggerBackendUpdateFailedOrphan"
	| "triggerBackendUpdateManualRequiredAppOwned";

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
 * The other refusal, and not a seal question at all: the update the app
 * downloaded would not launch once installed. macOS refuses to spawn a bundle
 * whose signature claims a restricted entitlement with no provisioning profile
 * behind it, and it does so at exec - so `codesign --verify`, `spctl` and the
 * notarization staple all pass on the artifact while the app never comes back.
 * The panel is deliberately the same shape as the seal refusal: the subject is
 * the same (an update that will not be installed), and only the mechanism and
 * the remedy differ.
 *
 * The remedy is NOT the download page (design round 1, D1). Every affordance
 * behind it resolves to `releases/latest`, which is where this artifact came
 * from, so the primary action would hand the reader the bundle the app just
 * refused; the sentence names the version to avoid instead, which is true both
 * when `latest` is broken and when it is fine.
 */
export const InstallBlockedCannotLaunch: Story = {
	args: { autoCheck: false },
	parameters: { triggerUpdateInstallBlockedCannotLaunch: true },
	render: () => <Triggered flag="triggerUpdateInstallBlockedCannotLaunch" />,
};

/**
 * The same code, the arm that knows less: the staged archive's signature could
 * not be read and no profile is embedded, so the app refuses rather than guess.
 * It carries its own heading, because the panel's heading map would paint "The
 * update can't be launched" over a body that declines to say macOS refused
 * anything (design round 1, D3) - and its remedy is a retry, since nothing was
 * established about this artifact.
 */
export const InstallBlockedCannotCheck: Story = {
	args: { autoCheck: false },
	parameters: { triggerUpdateInstallBlockedCannotCheck: true },
	render: () => <Triggered flag="triggerUpdateInstallBlockedCannotCheck" />,
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
 * THE APP-OWNED ARM OF THE SKEW, and the state this change is about.
 *
 * What the frame is: this machine's install is the published release and the daemon
 * SERVING this app is still on the previous build - which the app may restart,
 * because it started that daemon itself (`restartable`), and the install is the
 * app's own managed environment (`appOwnedEnvironment`), which is what makes the
 * press this panel offers the restart its label names (design D5). Where the two
 * digits come from, stated exactly (design D9): the `0.56.8` half is a REAL
 * reading - the live `/health` on the operator's machine, answered by the app's
 * managed environment - while the `0.56.12` half is the published RELEASE that
 * machine was offered, not a version measured on it (that box's app-owned tree held
 * 0.56.8, and its recorded preparation stamp was older still). The frame is
 * therefore the state this change produces - a landed publish whose restart has not
 * happened - and it says so rather than implying both digits were read there.
 *
 * What the pair records is the panel's ENDING. Before, the sentence described the
 * remedy and the panel's only control was "Understood" - a true fact with nothing
 * to press, which left a reader who wanted the new build to work out that quitting
 * the app was the step (UX U2). Now the panel offers the restart it has been
 * talking about and the app performs it: `update-backend` on this install publishes
 * nothing, because the install is already the release it would install, and
 * restarts the daemon onto it.
 *
 * Same story, same readings, captured on the tree before this change and on the one
 * after it; that set and its argument are under
 * `docs/evidence/server-behind-app-owned-before/`, and the after half is
 * `common-updatenotification/server-behind-app-owned/`, declared in
 * `docs/evidence/manifest.json`.
 */
const ServerBehindAppOwnedBuild = () => {
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		window.backendSkewReadings = {
			version: "0.56.12",
			runningVersion: "0.56.8",
			restartable: true,
			/*
			 * The install is the app's OWN managed environment, which is what makes the
			 * panel's control offerable at all (design D5): the press behind it is
			 * `update-backend`, and on a global install that is the install's own updater
			 * rather than the restart the label names.
			 */
			appOwnedEnvironment: true,
		};
		window.triggerBackendUpdateSkew = true;
		setReady(true);
	}, []);
	return ready ? <UpdateNotification autoCheck={false} /> : null;
};

export const ServerBehindAppOwned: Story = {
	args: { autoCheck: false },
	render: () => <ServerBehindAppOwnedBuild />,
};

/**
 * THE RESTART THAT DID NOT TAKE, in both of its outcomes - the pair design D1 and
 * UX U1 are filed against.
 *
 * These two states are reachable only as a COMPLETION: the app publishes nothing
 * (the install is already the release), restarts the daemon onto it, and reports
 * what it read afterwards. So the story drives the producer's own payload rather
 * than a trigger flag, and the two cases differ in one field - whether the daemon
 * answered at all:
 *
 * - `daemonBehind` (the D1 frame): `restartable: true` with the daemon still
 *   answering the OLD build. The panel said, before this round, "the server serving
 *   this app was started outside Local Operator, so it was left running on 0.56.8"
 *   one paragraph above "This app started that server, so it can restart it onto
 *   the new build now" - two contradictory sentences, and the first one false on
 *   the arm the app's own button leads into.
 * - `serverDown` (the U1 frame): the same restart with nothing answering afterwards
 *   (`serverDidNotComeBack`). The success toast - "Server update completed
 *   successfully" - was the whole surface for this state, about a server that is not
 *   running.
 *
 * Both are photographed on the app's own arm (`appOwnedEnvironment: true`), which
 * is the arm whose press produces them.
 */
const ServerBehindAppOwnedAfterRestart = ({
	serverDown,
}: { serverDown: boolean }) => {
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		window.backendSkewCompletion = serverDown
			? {
					installVersion: "0.56.12",
					runningVersion: null,
					restarted: false,
					restartable: true,
					appOwnedEnvironment: true,
					serverDidNotComeBack: true,
				}
			: {
					installVersion: "0.56.12",
					runningVersion: "0.56.8",
					restarted: false,
					restartable: true,
					appOwnedEnvironment: true,
					serverDidNotComeBack: false,
				};
		window.triggerBackendUpdateCompleted = true;
		setReady(true);
	}, [serverDown]);
	return ready ? <UpdateNotification autoCheck={false} /> : null;
};

export const ServerBehindAppOwnedRestartFailed: Story = {
	args: { autoCheck: false },
	render: () => <ServerBehindAppOwnedAfterRestart serverDown={false} />,
};

export const ServerBehindAppOwnedServerDown: Story = {
	args: { autoCheck: false },
	render: () => <ServerBehindAppOwnedAfterRestart serverDown />,
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
const PressUpdateServer = ({
	outcome,
	phase = null,
	variant = "default",
}: {
	outcome: "inflight" | "failed";
	/**
	 * WHICH OFFER the press is made on. `default` is the release-install payload (the entry-point
	 * route); `source-build` is the checkout rebuild, whose offer carries a different consequence
	 * sentence and provenance line while the state - a press, and the panel that answers it - is
	 * the same one; `orphan` is the default offer whose failure is the timeout that left something
	 * running, so the state differs only in the sentence the main process sends.
	 */
	variant?: "default" | "source-build" | "orphan";
	/**
	 * The phase the in-flight panel is opened on, when the story is about WHICH
	 * sentence the reader reads while the update runs (UX U6). Null is the
	 * phase-null fallback the older frame showed.
	 */
	phase?: "draining" | "installing" | "restarting" | null;
}) => {
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		if (variant === "source-build") {
			/*
			 * THE OFFER IS RAISED FOR BOTH OUTCOMES. The press this fixture makes is only possible
			 * when a managed offer is on screen - "Update server" is the button the source-build
			 * payload renders - so the failure variant has to raise it too and then let the press
			 * fail, which is the sequence the app produces.
			 */
			window.triggerBackendUpdateSourceBuild = true;
			window.triggerBackendUpdateSourceBuildInFlight = outcome === "inflight";
			window.triggerBackendUpdateSourceBuildFailed = outcome === "failed";
		} else if (variant === "orphan") {
			window.triggerBackendUpdateAvailable = true;
			window.triggerBackendUpdateFailedOrphan = outcome === "failed";
		} else {
			window.triggerBackendUpdateAvailable = true;
			window.triggerBackendUpdateInFlight = outcome === "inflight";
			window.triggerBackendUpdateError = outcome === "failed";
		}
		window.triggerBackendUpdatePhase = phase ?? undefined;
		setReady(true);
	}, [outcome, phase, variant]);
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
 * The panel WHILE THE INSTALL RUNS and WHILE THE RESTART RUNS - the two sentences a
 * reader spends most of an update on, and neither had a frame (UX U6).
 *
 * `backend-update-in-flight` above is the phase-NULL fallback: it renders
 * "Please wait while the server is being updated ...", which is a true sentence for
 * a press whose phase has not arrived YET, but it is not what the user watches for
 * the ~85 s of a publish. The sentences below are the ones design D2/R2-3 priced -
 * the install's own statement that the server keeps serving until the new build
 * lands, and the restart's that it is offline while it comes back - and a claim
 * about what a reader is told cannot be checked without the frame they are told it
 * in.
 *
 * `BackendUpdateDraining` is the third and newest: the press is waiting for the
 * turns running on this machine to finish before it touches anything, which is the
 * state the fleet gate creates and the state the old copy described as a dropped
 * turn instead.
 *
 * Driven through the press, as the shipped component reaches them: the offer is
 * raised, `Update server` is pressed, the attempt stays in flight, and the phase is
 * the one the main process announces for that step (`update-service.ts`).
 */
export const BackendUpdateDraining: Story = {
	args: { autoCheck: false },
	render: () => <PressUpdateServer outcome="inflight" phase="draining" />,
};

export const BackendUpdateInstalling: Story = {
	args: { autoCheck: false },
	render: () => <PressUpdateServer outcome="inflight" phase="installing" />,
};

export const BackendUpdateRestarting: Story = {
	args: { autoCheck: false },
	render: () => <PressUpdateServer outcome="inflight" phase="restarting" />,
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

/**
 * The retry IN FLIGHT, which is the state the reader sees for the four seconds the
 * app's own ladder runs - and which no frame showed (design round 2, D13; UX U7).
 *
 * WHY IT NEEDED ONE. The card used to unmount the moment `Try again` was pressed,
 * because the component cleared the failure before it awaited, so this state was
 * unreachable and "a check is running" was indistinguishable from "the problem is
 * fixed" - the same press reads as success for its first seconds. With the card
 * held, the pressed control is what says so: `retrying` renders "Checking..." on it
 * and disables it. This story draws exactly that pair, over the plain canvas rather
 * than the conversation list: the state under test is the card and its control, and
 * `ErrorState` above is the composed frame.
 */
export const ErrorStateRetrying: Story = {
	args: { autoCheck: false },
	render: () => (
		<div className="h-screen bg-canvas">
			<UpdateErrorAlert
				open
				message="net::ERR_CONNECTION_REFUSED"
				onClose={() => {}}
				onRetry={() => {}}
				retrying
			/>
		</div>
	),
};

/**
 * A DOWNLOAD-stage failure, which is where "then try again" told the reader to use
 * a control the box does not carry (design round 2, D9; UX U9).
 *
 * The stage is what the copy keys on: a check stands a chance of answering this
 * again, a download does not, so the sentence names the surface that owns the
 * retry - the update panel behind this alert - and the box offers no control. The
 * frame is the check on that rule, next to `ErrorState`'s, which does carry one.
 */
export const ErrorStateDownload: Story = {
	args: { autoCheck: false },
	render: () => (
		<div className="h-screen bg-canvas">
			<UpdateErrorAlert
				open
				message="Error downloading update: net::ERR_TIMED_OUT"
				onClose={() => {}}
				onRetry={() => {}}
			/>
		</div>
	),
};

/*
 * THE SERVER-UPDATE STATES THIS BRANCH OWNS, in this file's own vocabulary: a flag for a
 * state that is a payload, the press harness for a state that is an attempt. Each has a row
 * in `scripts/capture-evidence.mjs` carrying the sentence it is evidence FOR, so the rig
 * refuses the shutter when the frame paints something else.
 */

/**
 * The source-build offer: the install is a uv-tool build of this machine's checkout and the
 * app runs `lop-update` itself rather than handing over a command. The sentence the frame is
 * for is the cost it has to name before the press.
 */
export const BackendUpdateOfferSourceBuild: Story = {
	args: { autoCheck: false },
	render: () => <Triggered flag="triggerBackendUpdateSourceBuild" />,
};

/**
 * The same offer on a machine where the app did NOT start the server - the arm users other
 * than the operator meet, where the app cannot restart the daemon and says so.
 */
export const BackendUpdateOfferSourceBuildAdopted: Story = {
	args: { autoCheck: false },
	render: () => <Triggered flag="triggerBackendUpdateSourceBuildAdopted" />,
};

/**
 * The updater stopped on its budget while something it started was still alive - the one
 * sentence this branch added to a shipped panel, and the reason the verdict is taken on the
 * timer rather than on `close`.
 */
export const BackendUpdateFailedOrphan: Story = {
	args: { autoCheck: false },
	render: () => <PressUpdateServer outcome="failed" variant="orphan" />,
};

/**
 * The app-owned arm of the by-hand panel: `ManualRemedyNote` returns null for it, so it has
 * no command and no hand action - the remedy is a restart the user performs.
 */
export const BackendManualRequiredAppOwned: Story = {
	args: { autoCheck: false },
	render: () => <Triggered flag="triggerBackendUpdateManualRequiredAppOwned" />,
};
