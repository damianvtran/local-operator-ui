import type { ElectronAPI } from "@electron-toolkit/preload";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type {
	DesktopAPI,
	ProbedFile,
	ReadFileBytesResponse,
} from "../shared/desktop-contract";

// Matching same type in `src/main/index.ts`
type ReadFileResponse =
	| { success: true; data: string }
	| { success: false; error: unknown }; // or use `string` if you always send error.message

declare global {
	interface Window {
		electron: ElectronAPI;
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
				newTab: () => Promise<unknown>;
				closeTab: (tabId: number) => Promise<unknown>;
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
				onStateChanged: (callback: () => void) => () => void;
				onConsentChanged: (callback: () => void) => () => void;
				onConsentAttention: (
					callback: (payload: { entryId: string }) => void,
				) => () => void;
				onPopupBlocked: (
					callback: (payload: { tabId: number; url: string }) => void,
				) => () => void;
			};
			openFile: (filePath: string) => Promise<void>;
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
			openExternal: (url: string) => Promise<void>;
			showItemInFolder: (filePath: string) => Promise<void>;
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
				checkForAllUpdates: (options?: { manual?: boolean }) => Promise<void>;
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
						/** How the install was classified, for the details line. */
						detail?: string;
						/** True when the install follows a source tree, not the release. */
						sourceBuild?: boolean;
						/**
						 * True when this event answers a check the user asked for, as
						 * opposed to the periodic or start-up check. The by-hand panel
						 * is only dismissed by the user's own check (review U12).
						 */
						manual?: boolean;
					}) => void,
				) => () => void;
				onBackendUpdateDevMode: (
					callback: (message: string) => void,
				) => () => void;
				onBackendUpdateNotAvailable: (
					callback: (info: { version: string }) => void,
				) => () => void;
				onBackendUpdateCompleted: (callback: () => void) => () => void;
				onBackendUpdateManualRequired: (
					callback: (info: {
						message: string;
						command: string;
						detail?: string;
						/** The version the panel is waiting for, and what is running. */
						latestVersion?: string | null;
						currentVersion?: string | null;
						sourceBuild?: boolean;
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
