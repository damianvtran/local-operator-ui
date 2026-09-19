import type { ElectronAPI } from "@electron-toolkit/preload";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { UpdateCheckVerdict } from "../main/update-check-verdict";
import type {
	BackendUpdateCompletion,
	BackendUpdateErrorReport,
} from "../main/update-service";
import type { DaemonStatusSnapshot } from "../shared/backend-status";
import type {
	DesktopAPI,
	DirectoryListing,
	FileActionOutcome,
	ProbedFile,
	ReadFileBytesResponse,
} from "../shared/desktop-contract";
import type { DevDriverBridge } from "./dev-driver";

// Matching same type in `src/main/index.ts`
type ReadFileResponse =
	| { success: true; data: string }
	| { success: false; error: unknown }; // or use `string` if you always send error.message

declare global {
	interface Window {
		electron: ElectronAPI;
		/**
		 * The renderer dev driver, present ONLY in an armed launch.
		 *
		 * Optional on purpose: it is absent in every normal run, and typing it as
		 * always-present would invite renderer code to call it without asking.
		 * `docs/agent-driver.md` says what arming requires.
		 */
		__loDevDriver?: DevDriverBridge;
		api: {
			desktop: DesktopAPI;
			/**
			 * The browser feature's chrome controls. Shapes are `unknown` because
			 * main owns the projection: the renderer renders what it is given, and a
			 * mirrored interface here would be a second copy of a shape that can
			 * drift from the one main actually sends.
			 */
			browser: {
				state: () => Promise<unknown>;
				/** `sessionId` attributes the new tab to the conversation it was opened
				 * from; `null` (and absent) mean it belongs to no conversation. */
				newTab: (sessionId?: string | null) => Promise<unknown>;
				closeTab: (tabId: number) => Promise<unknown>;
				/** A bulk close. `{ mode: "ids", tabIds }`, or `{ mode: "conversation",
				 * sessionId }` which main resolves against the live registry. */
				closeTabs: (intent: unknown) => Promise<unknown>;
				activateTab: (tabId: number) => Promise<unknown>;
				navigate: (url: string) => Promise<unknown>;
				reload: () => Promise<unknown>;
				stop: () => Promise<unknown>;
				history: (direction: "back" | "forward") => Promise<unknown>;
				setContentRect: (
					rect: { x: number; y: number; width: number; height: number } | null,
				) => Promise<unknown>;
				setViewVisible: (visible: boolean) => Promise<unknown>;
				handOver: (tabId: number, sessionId: string) => Promise<unknown>;
				revokeHandOver: (tabId: number) => Promise<unknown>;
				respondToConsent: (
					entryId: string,
					decision: "once" | "session" | "site" | "domain" | "deny",
				) => Promise<unknown>;
				revokeApproval: (origin: string) => Promise<unknown>;
				revokeAllApprovals: () => Promise<unknown>;
				forgetSite: (origin: string) => Promise<unknown>;
				clearData: (
					what: "cookies" | "cache" | "everything",
				) => Promise<unknown>;
				/**
				 * Answer a surfaced passkey chooser: an offered credential id, or `null` for a
				 * dismissal. Main validates the id against the accounts it offered.
				 */
				respondToWebauthn: (
					requestId: string,
					credentialId: string | null,
				) => Promise<unknown>;
				/**
				 * A `navigator.credentials.get()` matched more than one passkey. The renderer
				 * has to ask which one; an unanswered request is cancelled with
				 * `NotAllowedError` once the chooser's own timeout expires.
				 *
				 * `tabId`/`pageTitle` name the PAGE that asked when main could resolve it from
				 * the event's frame, and are null otherwise — the view is suppressed while the
				 * chooser is up, so the page is the one thing the user cannot see for
				 * themselves.
				 */
				onWebauthnRequest: (
					callback: (payload: {
						requestId: string;
						relyingPartyId: string;
						accounts: Array<{
							credentialId: string;
							name: string | null;
							displayName: string | null;
						}>;
						tabId: number | null;
						pageTitle: string | null;
					}) => void,
				) => () => void;
				/**
				 * The choosers still waiting, oldest first, as main holds them.
				 *
				 * The pull half of the queue: a request raised while nothing was mounted was
				 * pushed to nobody, so the surface asks main rather than assuming it saw every
				 * event.
				 */
				pendingWebauthnRequests: () => Promise<
					Array<{
						requestId: string;
						relyingPartyId: string;
						accounts: Array<{
							credentialId: string;
							name: string | null;
							displayName: string | null;
						}>;
						tabId: number | null;
						pageTitle: string | null;
					}>
				>;
				/**
				 * A chooser main has settled. `outcome` is `chosen` or `dismissed` for the
				 * user's own answers; anything else means the request ended without them and
				 * the surface has to say so rather than leave a dead dialog up.
				 */
				onWebauthnSettled: (
					callback: (payload: {
						requestId: string;
						outcome:
							| "chosen"
							| "dismissed"
							| "expired"
							| "host-stopped"
							| "credential-not-offered";
					}) => void,
				) => () => void;
				/** Reveal the host's own download directory (§16.4). Takes no path, and
				 * ANSWERS whether it opened: `shell.openPath` returns its failure rather than
				 * throwing, so the answer is what a caller needs to show one. */
				revealDownloads: () => Promise<{ opened: boolean; message: string }>;
				onStateChanged: (callback: () => void) => () => void;
				onConsentChanged: (callback: () => void) => () => void;
				onConsentAttention: (
					callback: (payload: { entryId: string }) => void,
				) => () => void;
				onPopupBlocked: (
					callback: (payload: { tabId: number; url: string }) => void,
				) => () => void;
			};
			/**
			 * The server-status signal, from the MAIN process.
			 *
			 * Not a health probe made by the renderer: main sends no Origin and holds
			 * the bearer, so this answer cannot be turned into "server down" by a CORS
			 * or allowlist decision (see `shared/backend-status.ts`).
			 *
			 * `reconnect` asks main to re-discover NOW (the connectivity banner's
			 * Retry) and answers with the snapshot it ended on.
			 */
			backend: {
				getStatus: () => Promise<DaemonStatusSnapshot>;
				reconnect: () => Promise<DaemonStatusSnapshot>;
				onStatusChange: (
					callback: (snapshot: DaemonStatusSnapshot) => void,
				) => () => void;
			};
			/**
			 * Open a path in the OS's own application. Answers with an outcome rather
			 * than `void`: `shell.openPath` RETURNS its failure as a string rather
			 * than throwing, so a caller that ignores the answer cannot tell an
			 * opened file from one that opened nothing.
			 */
			openFile: (filePath: string) => Promise<FileActionOutcome>;
			readFile: (
				filePath: string,
				encoding?: BufferEncoding,
			) => Promise<ReadFileResponse>;
			/**
			 * Bytes for the in-app viewers (PDF, image, audio). The failure case is a
			 * discriminant rather than an `Error`, because structured clone strips a
			 * custom Error's prototype and `instanceof` would never be true here.
			 */
			readFileBytes: (
				filePath: string,
				maxBytes?: number,
			) => Promise<ReadFileBytesResponse>;
			/**
			 * Resolve and stat a batch of paths, returning the RESOLVED path each one
			 * maps to. That resolved path is the Files panel's identity for a file.
			 */
			probeFiles: (paths: string[], cwd?: string) => Promise<ProbedFile[]>;
			/**
			 * One directory's listable entries, sorted by name, at most
			 * `DIRECTORY_ENTRY_LIMIT` of them per call.
			 */
			listDirectory: (dir: string, cwd?: string) => Promise<DirectoryListing>;
			openExternal: (url: string) => Promise<void>;
			/**
			 * Reveal a path in the OS file manager. The main process stats the path
			 * first, because `showItemInFolder` returns nothing and will happily
			 * reveal the parent of a path that does not exist.
			 */
			showItemInFolder: (filePath: string) => Promise<FileActionOutcome>;
			systemInfo: {
				getAppVersion: () => Promise<string>;
				getPlatformInfo: () => Promise<{
					platform: string;
					arch: string;
					nodeVersion: string;
					electronVersion: string;
					chromeVersion: string;
				}>;
			};
			updater: {
				/** `manual` marks a check the user asked for (see the preload note). */
				checkForUpdates: (options?: { manual?: boolean }) => Promise<{
					updateInfo: UpdateInfo;
					// biome-ignore lint/suspicious/noExplicitAny: Complex type from electron-updater
					cancellationToken: any;
				}>;
				checkForBackendUpdates: () => Promise<{
					currentVersion: string;
					latestVersion: string;
					updateCommand: string;
					canManageUpdate?: boolean;
					remedy?: string;
				} | null>;
				// The aggregate check's own answer, and the ONLY source of the "up to
				// date" affirmation: a value that says the whole check proved both
				// channels current, never merely that one of them had nothing to
				// offer. See `src/main/update-check-verdict.ts`. `silent` is the
				// caller's own flag for suppressing this check's per-channel
				// `*-not-available` events.
				checkForAllUpdates: (options?: {
					manual?: boolean;
					silent?: boolean;
				}) => Promise<UpdateCheckVerdict>;
				/** The last install that did not complete, if the app recorded one. */
				getLastInstallAttempt: () => Promise<{
					targetVersion: string;
					runningVersion: string;
					startedAt: string | null;
					detectedAt: string;
					detail: string;
					attempts: number;
				} | null>;
				updateBackend: (targetVersion?: string) => Promise<boolean>;
				// biome-ignore lint/suspicious/noExplicitAny: Return type from electron-updater is complex
				downloadUpdate: () => Promise<any[]>;
				quitAndInstall: () => Promise<boolean>;
				/**
				 * Quit so an install that is already running can finish, rather than
				 * starting a new one: Squirrel cancels an install while an instance of
				 * the app is running, and this is the app getting out of its way.
				 */
				quitForUpdateInstall: () => Promise<boolean>;
				onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
				onUpdateNotAvailable: (
					callback: (info: UpdateInfo) => void,
				) => () => void;
				onUpdateDevMode: (callback: (message: string) => void) => () => void;
				onUpdateNpxAvailable: (
					callback: (info: {
						currentVersion: string;
						latestVersion: string;
						updateCommand: string;
					}) => void,
				) => () => void;
				onBackendUpdateAvailable: (
					callback: (info: {
						currentVersion: string;
						latestVersion: string;
						updateCommand: string;
						canManageUpdate?: boolean;
						remedy?: string;
						startupMode?: string;
						/**
						 * How the install was classified, for the details line. Never carries
						 * the running/install skew: the two readings are structured fields so
						 * the panel can say both in prose (review D3).
						 */
						detail?: string;
						/** True when the install follows a source tree, not the release. */
						sourceBuild?: boolean;
						/**
						 * The version the daemon SERVING this app reports, when it was
						 * readable. `currentVersion` above is the install on disk, which an
						 * update is what moves; the two differ between a landed install and
						 * the restart, and on every daemon this app did not start.
						 */
						runningVersion?: string | null;
						/**
						 * True when this event answers a check the user asked for, as
						 * opposed to the periodic or start-up check. The by-hand panel
						 * is only dismissed by the user's own check (review U12).
						 */
						manual?: boolean;
						/**
						 * Whether the app may restart the daemon serving this app.
						 *
						 * The reading that decides the managed arm's consequence sentence: the plan
						 * states it from the INSTALL's layout and cannot know who started the
						 * server, so an adopted daemon's offer used to promise a restart that
						 * cannot happen (UX U9). False means the server keeps running the old
						 * build until it restarts on its own, and nothing in flight is dropped.
						 */
						restartable?: boolean;
						/**
						 * Whether the environment `update-backend` would move is the app's own.
						 *
						 * The second ownership reading (design D5): `restartable` answers who
						 * started the DAEMON, which is also true in GLOBAL_INSTALL mode, while
						 * this answers whose INSTALL the press would move - so it is what lets
						 * the skew panel offer its restart control only where that press is the
						 * restart the label promises.
						 */
						appOwnedEnvironment?: boolean;
					}) => void,
				) => () => void;
				onBackendUpdateDevMode: (
					callback: (message: string) => void,
				) => () => void;
				onBackendUpdateNotAvailable: (
					callback: (info: {
						/** The version the INSTALL on disk reports. */
						version: string;
						/**
						 * The version the daemon serving this app reports, when readable.
						 *
						 * Carried on this state because it is the one QA Q-1 found: an
						 * install already at the published version whose daemon still serves
						 * the old build makes no offer, so the offer's own detail was never
						 * rendered and the user was told nothing at all.
						 */
						runningVersion?: string | null;
						/** Whether the app may restart the daemon that is behind. */
						restartable?: boolean;
						/**
						 * Whether the check that sent this pair READ the published release.
						 *
						 * False is the network-unavailable pass (QA round 3, Q3-1): the
						 * install/running pair is measured locally, so an offline machine can
						 * still be told its daemon trails the install - but nothing on that
						 * pass compared the install against a release, so the renderer's
						 * sentence may not call it current. Absent means it was read.
						 */
						releaseRead?: boolean;
						/**
						 * Whether the INSTALL this check read is the app's own environment.
						 *
						 * Carried on this state too because it is where the skew panel actually
						 * appears (install current, daemon behind) - the panel's control takes
						 * both ownership readings (design D5).
						 */
						appOwnedEnvironment?: boolean;
					}) => void,
				) => () => void;
				onBackendUpdateCompleted: (
					callback: (completion: BackendUpdateCompletion | null) => void,
				) => () => void;
				/**
				 * Which phase the running update is in, announced as it changes.
				 *
				 * The install and the restart are one unchanging panel otherwise, and on a
				 * cold cache they are ~47 s and ~15 s of it (UX U4).
				 */
				onBackendUpdateProgress: (
					callback: (progress: {
						phase: "installing" | "restarting";
						/** True when the run is the checkout REBUILD rather than the release path. */
						sourceRebuild?: boolean;
					}) => void,
				) => () => void;
				/**
				 * A server update that failed: the reason from the main process, and the
				 * phase that wrote it (`check` for a version check the user may have
				 * pressed, `update` for the update attempt itself).
				 */
				onBackendUpdateError: (
					callback: (report: BackendUpdateErrorReport) => void,
				) => () => void;
				onBackendUpdateManualRequired: (
					callback: (info: {
						message: string;
						command: string;
						detail?: string;
						/** The version the panel is waiting for, and what is running. */
						latestVersion?: string | null;
						currentVersion?: string | null;
						/** The version the INSTALL reports, when it is not the running one. */
						installVersion?: string | null;
						runningVersion?: string | null;
						sourceBuild?: boolean;
						/** Whether the install is one of the app's own - see the panel's copy. */
						appOwned?: boolean;
					}) => void,
				) => () => void;
				onUpdateDownloaded: (
					callback: (info: UpdateInfo) => void,
				) => () => void;
				onUpdateError: (callback: (error: string) => void) => () => void;
				/** Reasons the app refused to start an install, with the remedy. */
				onUpdateInstallBlocked: (
					callback: (info: {
						code: string;
						version: string | null;
						message: string;
						remedy: { text: string; url?: string; command?: string };
						detail?: string;
					}) => void,
				) => () => void;
				/** A previous install that never completed, reported on the next start. */
				onUpdateInstallFailed: (
					callback: (info: {
						targetVersion: string;
						message: string;
						remedy: { text: string; url?: string; command?: string };
						detail: string;
						/** How many times this target has failed here. */
						attempts?: number;
						/** True when opening the app is what cancelled the install. */
						cancelledByRelaunch?: boolean;
					}) => void,
				) => () => void;
				/** An install that is still running right now, found on this start. */
				onUpdateInstallInFlight: (
					callback: (info: {
						targetVersion: string;
						message: string;
						detail: string;
					}) => void,
				) => () => void;
				onUpdateProgress: (
					callback: (progressObj: ProgressInfo) => void,
				) => () => void;
				onBeforeQuitForUpdate: (callback: () => void) => () => void;
			};
			ipcRenderer: {
				send: (channel: string, ...args: unknown[]) => void;
				on: (
					channel: string,
					func: (...args: unknown[]) => void,
				) => (() => void) | undefined;
			};
			/** Opens a native dialog to select a directory */
			selectDirectory: () => Promise<string | undefined>;
			/** Opens a native dialog to select a file and returns its path and content */
			selectFile: () => Promise<{ path: string; content: string } | undefined>;
			/** Gets the user's home directory path */
			getHomeDirectory: () => Promise<string>;
			/** Saves a file to the specified path */
			saveFile: (
				filePath: string,
				content: string,
				encoding?: BufferEncoding,
			) => Promise<void>;
			/** Checks if a file exists at the specified path */
			fileExists: (filePath: string) => Promise<boolean>;
			/** Checks that a path exists and is a directory, not a regular file */
			directoryExists: (dirPath: string) => Promise<boolean>;
		};
	}
}
