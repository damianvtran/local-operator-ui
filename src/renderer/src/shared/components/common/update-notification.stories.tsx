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
			onBackendUpdateProgress: (
				callback: (progress: {
					phase: "installing" | "restarting";
					sourceRebuild?: boolean;
				}) => void,
			) => {
				backendUpdateProgressListeners.push(callback);
				return () => {
					const index = backendUpdateProgressListeners.indexOf(callback);
					if (index >= 0) backendUpdateProgressListeners.splice(index, 1);
				};
			},
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
 * The operator's own `lop-update`, refusing, as the producer now selects it.
 *
 * Captured by driving the REAL script (`~/.local/bin/lop-update`, the operator's)
 * in an isolated repository - `LOCAL_OPERATOR_REPO` pointing at a throwaway
 * checkout whose `main` is one commit behind its `origin/main`, so it refuses
 * BEFORE it builds anything and nothing on this machine is touched - and then put
 * through `installDiagnosisLines`. The last line of the raw output tells the reader
 * to run `lop-update main --skip-remote-check`, i.e. to disable the guard that just
 * refused them; that line is deliberately absent here, because handing it over as
 * the remedy is the defect review round 2 filed (U7). The sentence before the blank
 * line is the producer's, and the block below it is the installer's own words.
 */
/*
 * The offer's plan copy, as `resolveGlobalInstallPlan` emits it for a source build.
 *
 * Shared between the two offer stories below because the two arms differ only in who
 * would be restarted, and the cost sentence is the same: the app rebuilds the checkout
 * in place. The adopted variant is the arm users other than the operator meet, and it
 * had no frame at all until round 4 (design D3).
 */
const SOURCE_BUILD_REMEDY =
	"Rebuilds this checkout with `lop-update`. The rebuild happens in place, so sessions on this machine can be interrupted while it runs, and it can take up to half an hour. This install keeps reporting the checkout's version, not the release the app offered.";

/** The classification line, a machine fact in the ribbon rather than app prose. */
const OFFER_DETAIL =
	"local-operator resolves to /Users/operator/.local/bin/local-operator (/Users/operator/.local/share/uv/tools/local-operator/bin/local-operator), classified as uv-tool. source build of this machine's checkout; an in-place rebuild.";

/** The by-hand arm's classification line: the script is absent, so the app does not rebuild. */
const BY_HAND_DETAIL =
	"local-operator resolves to /Users/operator/.local/bin/local-operator (/Users/operator/.local/share/uv/tools/local-operator/bin/local-operator), classified as uv-tool. source build of this machine's checkout; `lop update` would install the published release over it.";

/*
 * The app-owned arm's copy, verbatim from `resolveBackendUpdatePlan`.
 *
 * Shared with the fixture so the frame cannot drift from the producer: this is the exact
 * remedy and detail the managed arm returns, including the sentence that says no terminal
 * command can update the environment correctly.
 */
const APP_OWNED_REMEDY =
	"This server is running from Local Operator's own managed environment, which no package manager owns - so there is no terminal command that can update it correctly. The app can only update a server it started itself: stop this one, then start Local Operator again and let it start its own.";

const APP_OWNED_DETAIL =
	'The server serving this app runs from Local Operator\'s own managed environment at /Users/operator/Library/Application Support/Local Operator/managed-python/3.13, which the app owns rather than a package manager (the backend reports it as install kind "managed-venv"), at version 0.56.10.';

const SOURCE_BUILD_REFUSAL_SENTENCE =
	"The server update did not install: `lop-update` exited 1. This checkout is behind its remote, which is what `lop-update` refused to build from: bring the checkout up to date, and the next press here will build it. The installer's own output is below. You can also run `lop-update` yourself in a terminal.";

/**
 * The installer's OWN words for that refusal, in the field the producer fills.
 *
 * Captured by driving the real `~/.local/bin/lop-update` in an isolated repository
 * whose `main` is one commit behind its `origin/main`, so it refuses before it builds,
 * with the producer's own selection applied: the diagnosis at the head, and never the
 * line that advises going around the refusal. A tail selection would have handed over
 * that last line instead, which is the defect review round 2 filed (U7).
 *
 * It is a FIELD rather than a paragraph of the sentence because the two are different
 * voices: welded together they exceeded the copy module's authored-sentence limit and
 * the panel replaced both, so the frame below could not show the diagnosis at all
 * (review round 3, D1).
 */
const SOURCE_BUILD_REFUSAL_OUTPUT = [
	"lop-update: warning: could not fetch origin (offline?); comparing against the last known state of origin/main",
	"lop-update: REFUSING to release a stale ref.",
	"local  main          = 2a0b473",
	"remote origin/main = 4b32d95  (1 commit(s) ahead)",
	"Local main is BEHIND origin/main, so installing it would publish code",
	"older than what is merged -- and would report success while doing it.",
].join("\n");

/**
 * The sentence this pass added for a stopped updater that left something running.
 *
 * The app stops an updater's whole process group when its budget expires, and a
 * descendant that ignores the stop can still be writing into the install tree after
 * the verdict - so the panel says so, and says that nothing else will be started
 * until it exits.
 */
const ORPHANED_UPDATER_SENTENCE =
	"The server update did not finish: the installer could not be run to a verdict. The updater was stopped; something it started may still be replacing the install. Nothing was restarted: the build that was serving is the build still serving. The installer's own output is below.";

/**
 * The CHILD's output for that frame, not the app's log line.
 *
 * The fixture used to put the producer's own `logger.error` sentence here - "The
 * updater did not finish within 900000ms; stopping the process group this run
 * started..." - which no installer writes and which the app writes to its log rather
 * than to this field, so the frame asserted copy the producer cannot emit (review
 * round 3, MINOR-2). These lines are the tool's own, taken from the isolated rebuild
 * transcript in docs/evidence/server-update-source-build/README.md, cut where the stop
 * landed.
 *
 * THEY ARE STDERR, WHICH IS THE STREAM THE PRODUCER READS FIRST. `runGlobalUpdateAttempt`
 * selects `run.stderr.length > 0 ? run.stderr : run.stdout`, so a fixture drawn from the
 * tool's stdout would be a frame of a stream the panel only shows when stderr is empty -
 * real output, real provenance, wrong field. uv writes its resolver and build progress to
 * stderr, which is what these are (QA round 4, NOTE).
 */
const ORPHANED_UPDATER_OUTPUT = [
	"lop-update: mobile web bundle: built",
	"Resolved 55 packages in 1.25s",
	"   Building local-operator @ file:///tmp/lop-update.jegEuB",
	"Downloading cryptography (3.8MiB)",
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
 * The listeners `onBackendUpdateProgress` has registered for the current story.
 *
 * It exists because the RUNNING state has two sentences now and only one of them can
 * be photographed from the offer: the phase event carries `sourceRebuild`, and the
 * rebuild's copy is the only place a reader is told that the install is being
 * rewritten in place - the fact the offer names before the press and the run has to
 * keep naming while the press is being paid (review round 3, D2 = U3). A registry
 * for the same reason the error listeners have one: the mock is re-installed on every
 * decorator effect while the component's subscription survives it.
 */
const backendUpdateProgressListeners: Array<
	(progress: {
		phase: "installing" | "restarting";
		sourceRebuild?: boolean;
	}) => void
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
				// The phase the producer announces first, so the frame shows the release
				// path's own sentence rather than the fallback both routes share.
				for (const listener of [...backendUpdateProgressListeners]) {
					listener({ phase: "installing" });
				}
				return new Promise<boolean>(() => {});
			}
			if (window.triggerBackendUpdateSourceBuildInFlight) {
				/*
				 * AND THE REBUILD ANNOUNCES ITSELF AS ONE. Without this the two running
				 * frames are the same panel: the offer that carried the cost sentence has
				 * already unmounted, so the only place left to say that the install is
				 * being rewritten in place is this phase event.
				 */
				for (const listener of [...backendUpdateProgressListeners]) {
					listener({ phase: "installing", sourceRebuild: true });
				}
				return new Promise<boolean>(() => {});
			}
			if (window.triggerBackendUpdateError) {
				for (const listener of [...backendUpdateErrorListeners]) {
					listener({ message: SERVER_UPDATE_FAILURE_MESSAGE, phase: "update" });
				}
				return false;
			}
			/*
			 * THE FAILURE THAT CARRIES A DIAGNOSIS, and the two shapes this pass added.
			 *
			 * `SOURCE_BUILD_REFUSAL_OUTPUT` is the operator's OWN `lop-update` output -
			 * captured by driving the real script in an isolated repository whose `main`
			 * is one commit behind its `origin/main`, so it refuses before it builds -
			 * with the producer's own selection applied: the diagnosis at the head, never
			 * the line that advises going around the refusal (review round 2, U7). The
			 * tail of that message is what a tail selection would have handed over,
			 * which is exactly the defect.
			 *
			 * `ORPHANED_UPDATER_SENTENCE` is the other new sentence: an updater stopped on
			 * its budget while a process it started is still alive. It belongs in a frame
			 * because it is the one copy this pass added to a shipped panel.
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
				/**
				 * Whether the app started the server the panel is about. The producer
				 * sends it on this event (`update-service.ts`'s `backend-update-available`)
				 * and `managedCostSentence` reads it to choose between the app-owned cost
				 * sentence and the adopted-server one, so the fixture's type has to carry
				 * it or the frame cannot show the branch the real payload takes.
				 */
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
			/*
			 * THE SOURCE-BUILD ROUTE, as the main process now sends it: the install is a
			 * uv-tool build of THIS machine's checkout (`.lop-source` names a commit), the
			 * machine has `lop-update`, and the app runs it rather than handing over a
			 * command. The payload is the plan's own (`resolveGlobalInstallPlan` with a
			 * resolved rebuild tool), so the frame shows the copy the producer emits and
			 * not a sentence a fixture invented.
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
					// The one field the two arms differ in: who would be restarted, and therefore
					// whether the reassurance is the restart's or the install's.
					restartable: !window.triggerBackendUpdateSourceBuildAdopted,
					remedy: SOURCE_BUILD_REMEDY,
					detail: OFFER_DETAIL,
					sourceBuild: true,
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
		onBackendUpdateCompleted: (
			callback: (completion: BackendUpdateCompletion | null) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateCompleted) {
				// Immediately trigger the callback. Null is the plain success payload;
				// the shaped ones are what the skew stories drive.
				callback(null);
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
				/**
				 * Whether the app owns the environment the server runs from, which is the
				 * reading `ManualRemedyNote` gates on: no package manager owns that tree, so
				 * the panel names no command and this arm had no fixture until round 5.
				 */
				appOwned?: boolean;
			}) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateManualRequired) {
				/*
				 * A source build on a machine with NO `lop-update`, which is the only
				 * shape that reaches the by-hand panel now: the app runs the checkout
				 * rebuild itself when that tool resolves (the offer above), so this
				 * fixture carries the producer's own refusal for the arm that is left -
				 * `plan.remedy` and `plan.updateCommand` exactly as the service sends
				 * them, including the sentence that says `lop update` installs the
				 * published release over a checkout build. It used to name
				 * `lop-update` as the command and a remedy no producer emits, which is
				 * how the frame came to show a state that could not occur (round 2,
				 * Q-5).
				 */
				callback({
					message:
						"This install predates the non-disruptive installer, so update it once from your terminal. This install's updater rewrites the shared environment in place, which can interrupt sessions mid-turn; the app manages updates after that.",
					command: "lop update",
					detail: BY_HAND_DETAIL,
					latestVersion: "0.54.20",
					currentVersion: "0.54.14",
					sourceBuild: true,
				});
			}
			/*
			 * THE APP-OWNED ARM, which had no fixture and therefore no frame until round 5.
			 * `ManualRemedyNote` returns null for `appOwned`, and the two fixtures here
			 * never set it, so the state this fold's re-shoot was ABOUT was the one state
			 * with no photograph (design D1 = UX U2 = QA Q-2). The payload is the producer's
			 * own - the managed-arm remedy and detail verbatim from `resolveBackendUpdatePlan`,
			 * with `updateCommand: ""` and `appOwned: true` - so the frame shows copy a real
			 * machine can produce.
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
		/*
		 * THE REGISTRATION HAS TO BE ON **THIS** OBJECT, not on
		 * `createEmptyUpdaterMethods`. The mock below assigns `window.api.updater` this
		 * literal wholesale, so a registration added to the empty object is thrown away
		 * with it: zero listeners, no phase, and the panel paints the phase-null fallback -
		 * which is why `backend-update-in-flight-source-build` was byte-identical to the
		 * release route in 12/12 themes even after the copy it claimed to show existed
		 * (QA Q-3 = design D1 = UX U2, round 4). Two streams executed that, and this is the
		 * one-line cause.
		 */
		onBackendUpdateProgress: (
			callback: (progress: {
				phase: "installing" | "restarting";
				sourceRebuild?: boolean;
			}) => void,
		) => {
			backendUpdateProgressListeners.push(callback);
			return () => {
				const index = backendUpdateProgressListeners.indexOf(callback);
				if (index >= 0) backendUpdateProgressListeners.splice(index, 1);
			};
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
		triggerBackendUpdateSourceBuild?: boolean;
		/**
		 * The same offer on a machine where the app did NOT start the server. The arm users
		 * other than the operator meet, and until round 4 it had no frame anywhere in the
		 * tree, so the cost sentence claimed for it could not be judged from pixels (design
		 * D3).
		 */
		triggerBackendUpdateSourceBuildAdopted?: boolean;
		triggerBackendUpdateSourceBuildInFlight?: boolean;
		triggerBackendUpdateSourceBuildFailed?: boolean;
		triggerBackendUpdateFailedOrphan?: boolean;
		triggerBackendUpdateInFlight?: boolean;
		triggerBackendUpdateDevMode?: boolean;
		triggerBackendUpdateManualRequired?: boolean;
		triggerBackendUpdateManualRequiredExistingServer?: boolean;
		/** The app-owned arm: `ManualRemedyNote` returns null for it, so it needs its own frame. */
		triggerBackendUpdateManualRequiredAppOwned?: boolean;
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
				window.triggerBackendUpdateManualRequiredAppOwned =
					context.parameters.triggerBackendUpdateManualRequiredAppOwned;
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
				context.parameters.triggerBackendUpdateManualRequiredAppOwned,
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
	| "triggerUpdateInstallFailed"
	| "triggerUpdateInstallFailedCancelledByRelaunch"
	| "triggerUpdateInstallInFlight"
	| "triggerBackendUpdateManualRequired"
	| "triggerBackendUpdateManualRequiredExistingServer"
	| "triggerBackendUpdateManualRequiredAppOwned"
	| "triggerBackendUpdateNonManaged"
	| "triggerBackendUpdateError"
	| "triggerBackendUpdateSourceBuild"
	| "triggerBackendUpdateSourceBuildAdopted"
	| "triggerBackendUpdateSourceBuildInFlight"
	| "triggerBackendUpdateSourceBuildFailed"
	| "triggerBackendUpdateFailedOrphan";

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
const PressUpdateServer = ({
	outcome,
	variant = "default",
}: {
	outcome: "inflight" | "failed";
	/**
	 * WHICH OFFER the press is made on. `default` is main's release-install payload
	 * (the entry-point route); `source-build` is the checkout rebuild, whose offer
	 * carries a different consequence sentence and a different provenance line while
	 * the state - a press, and the panel that answers it - is the same one.
	 */
	variant?: "default" | "source-build" | "orphan";
}) => {
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		if (variant === "source-build") {
			/*
			 * THE OFFER IS RAISED FOR BOTH OUTCOMES. The press this fixture makes is
			 * only possible when a managed offer is on screen - "Update server" is the
			 * button the source-build payload renders - so the failure variant has to
			 * raise it too and then let the press fail, which is the sequence the app
			 * produces. (Raising it only for the in-flight variant left the failure
			 * story with no button to press, so its `capturePending` gate never
			 * cleared and the frame timed out: measured, 3 elements drawn, 60s.)
			 */
			window.triggerBackendUpdateSourceBuild = true;
			window.triggerBackendUpdateSourceBuildInFlight = outcome === "inflight";
			window.triggerBackendUpdateSourceBuildFailed = outcome === "failed";
		} else if (variant === "orphan") {
			// The DEFAULT offer, whose failure is the timeout that left something
			// running: the state differs only in the sentence the main process sends.
			window.triggerBackendUpdateAvailable = true;
			window.triggerBackendUpdateFailedOrphan = outcome === "failed";
		} else {
			window.triggerBackendUpdateAvailable = true;
			window.triggerBackendUpdateInFlight = outcome === "inflight";
			window.triggerBackendUpdateError = outcome === "failed";
		}
		setReady(true);
	}, [outcome, variant]);
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

/**
 * The SAME offer, for the install the report is about: a uv-tool build of this
 * machine's own checkout, whose maintenance tool is `lop-update`.
 *
 * Every field differs from the release case above even though the panel is the
 * same one: the consequence sentence says a REBUILD is coming and that the version
 * afterwards is the checkout's rather than the release the app offered, and the
 * provenance line says the app rebuilds the checkout rather than installing the
 * published release over it. The step-function this frame shows is the one the
 * panel used to be unable to take at all - the app refused and handed over a
 * command, on the install whose own report asked for the app to run it.
 */
export const BackendUpdateOfferSourceBuild: Story = {
	args: { autoCheck: false },
	parameters: { triggerBackendUpdateSourceBuild: true },
	render: () => <Triggered flag="triggerBackendUpdateSourceBuild" />,
};

/**
 * The by-hand panel on the arm where the app OWNS the environment.
 *
 * `ManualRemedyNote` returns null here, so this state is the one where the panel says
 * nothing can move the install from a terminal - and until round 5 no fixture set
 * `appOwned`, so it had no frame anywhere in the tree while two frames claimed to be
 * about it (design D1 = QA Q-2). The body names the restart the app can do and the hand
 * action it cannot, which is what the review asked to see judged from pixels.
 */
export const BackendManualRequiredAppOwned: Story = {
	args: { autoCheck: false },
	parameters: { triggerBackendUpdateManualRequiredAppOwned: true },
	render: () => <Triggered flag="triggerBackendUpdateManualRequiredAppOwned" />,
};

/**
 * The SAME OFFER, on a machine where the app did not start the server.
 *
 * WHY THIS FRAME EXISTS. The adopted arm (`restartable: false`) is where users other than
 * the operator meet the reconstruction cost, because it is the arm that swaps the
 * app-owned sentence for the reassurance - and the swap is where the cost clause went
 * missing until it was fixed to append the plan's later sentences rather than replace them
 * (round 3, U2). A claim about what that arm SHOWS could not be judged from pixels while
 * no frame showed it (round 4, D3), so this is its frame: the reassurance about the restart
 * and the cost about the rebuild now sit in one paragraph with their own referents, and
 * only a still can show whether a reader can tell them apart.
 */
export const BackendUpdateOfferSourceBuildAdopted: Story = {
	args: { autoCheck: false },
	parameters: { triggerBackendUpdateSourceBuildAdopted: true },
	render: () => <Triggered flag="triggerBackendUpdateSourceBuildAdopted" />,
};

/**
 * The rebuild RUNNING, from the same offer: the button is pressed and the invoke
 * never settles.
 *
 * THIS FRAME USED TO CLAIM SOMETHING IT COULD NOT SHOW. The note here said the panel
 * "keeps the state that carried the cost sentence the reader agreed to" - but that
 * state IS the offer, which unmounts the moment the button is pressed, and the running
 * panel it gave way to was the release path's, byte for byte: no rebuild, no
 * interruption, and a sentence that promised the server kept serving (review round 3,
 * D2 = U3). The phase event now carries `sourceRebuild`, so this frame shows the run's
 * OWN copy - the install rewritten in place, sessions that can be interrupted, and the
 * allowance this route really has - and that is what the capture asserts. The retired
 * claim is worth keeping in the record because the frame it was attached to looked
 * right: a still cannot tell two sentences apart.
 */
export const BackendUpdateInFlightSourceBuild: Story = {
	args: { autoCheck: false },
	render: () => <PressUpdateServer outcome="inflight" variant="source-build" />,
};

/**
 * The rebuild FAILED, carrying `lop-update`'s own diagnosis.
 *
 * The panel's job here is the one U7 filed: the installer's output must reach the
 * user as the DIAGNOSIS - the refusal, the refs, the count of commits it is behind -
 * and never as the last line, which tells them to run the same command with
 * `--skip-remote-check` and so advises disabling the guard that just refused them.
 * The command that failed is still offered, as the escape hatch, in the sentence
 * above the installer's words.
 */
export const BackendUpdateFailedSourceBuild: Story = {
	args: { autoCheck: false },
	render: () => <PressUpdateServer outcome="failed" variant="source-build" />,
};

/**
 * The updater was stopped on its budget while something it started was still alive.
 *
 * The one sentence this pass added to a shipped panel: the app signals the run's
 * whole process group, and a descendant that ignores the stop can still be writing
 * into the install tree after the verdict - so the panel says so, and says that no
 * further update will be started until it exits.
 */
export const BackendUpdateFailedOrphan: Story = {
	args: { autoCheck: false },
	render: () => <PressUpdateServer outcome="failed" variant="orphan" />,
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
