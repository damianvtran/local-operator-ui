import type { ElectronAPI } from "@electron-toolkit/preload";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type {
	FileInfo,
	ListDirectoryResponse,
	ReadFileResponse,
} from "../main/ipc-handlers/file-handlers";

declare global {
	interface Window {
		electron: ElectronAPI;
		api: {
			openFile: (filePath: string) => Promise<void>;
			readFile: (filePath: string) => Promise<ReadFileResponse>;
			listDirectory: (dirPath: string) => Promise<ListDirectoryResponse>;
			getParentDirectory: (
				filePath: string,
			) => Promise<{ success: boolean; directory?: string; error?: unknown }>;
			openExternal: (url: string) => Promise<void>;
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
				checkForUpdates: () => Promise<{
					updateInfo: UpdateInfo;
					// biome-ignore lint/suspicious/noExplicitAny: Complex type from electron-updater
					cancellationToken: any;
				}>;
				checkForBackendUpdates: () => Promise<{
					currentVersion: string;
					latestVersion: string;
					updateCommand: string;
				} | null>;
				checkForAllUpdates: () => Promise<void>;
				updateBackend: () => Promise<boolean>;
				// biome-ignore lint/suspicious/noExplicitAny: Return type from electron-updater is complex
				downloadUpdate: () => Promise<any[]>;
				quitAndInstall: () => void;
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
					}) => void,
				) => () => void;
				onBackendUpdateDevMode: (
					callback: (message: string) => void,
				) => () => void;
				onBackendUpdateNotAvailable: (
					callback: (info: { version: string }) => void,
				) => () => void;
				onBackendUpdateCompleted: (callback: () => void) => () => void;
				onUpdateDownloaded: (
					callback: (info: UpdateInfo) => void,
				) => () => void;
				onUpdateError: (callback: (error: string) => void) => () => void;
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
		};
	}
}
