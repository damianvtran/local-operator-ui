import type { ElectronAPI } from "@electron-toolkit/preload";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { DesktopAPI } from "../shared/desktop-contract";

// Matching same type in `src/main/index.ts`
type ReadFileResponse =
	| { success: true; data: string }
	| { success: false; error: unknown }; // or use `string` if you always send error.message

declare global {
	interface Window {
		electron: ElectronAPI;
		api: {
			desktop: DesktopAPI;
			openFile: (filePath: string) => Promise<void>;
			readFile: (
				filePath: string,
				encoding?: BufferEncoding,
			) => Promise<ReadFileResponse>;
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
