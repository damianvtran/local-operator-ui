import type { ElectronAPI } from "@electron-toolkit/preload";
import type { ProgressInfo, UpdateInfo } from "electron-updater";

declare global {
	interface Window {
		electron: ElectronAPI;
		api: {
			openFile: (filePath: string) => Promise<void>;
			openExternal: (url: string) => Promise<void>;
			session: {
				getSession: () => Promise<{
					jwt: string | undefined;
					expiry: number | undefined;
				}>;
				storeSession: (jwt: string, expiry: number) => Promise<void>;
				clearSession: () => Promise<void>;
			};
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
				// Add function to check if provider auth is configured in the backend
				checkProviderAuthEnabled: () => Promise<boolean>;
			};
			oauth: {
				login: (
					provider: "google" | "microsoft",
				) => Promise<{ success: boolean; error?: string }>;
				logout: () => Promise<{ success: boolean; error?: string }>;
				getStatus: () => Promise<{
					success: boolean;
					status?: {
						loggedIn: boolean;
						provider: "google" | "microsoft" | null;
						accessToken?: string; // Consider removing if not needed by renderer
						idToken?: string;
						expiry?: number;
						error?: string;
					};
					error?: string;
				}>;
				onStatusUpdate: (
					callback: (status: {
						loggedIn: boolean;
						provider: "google" | "microsoft" | null;
						accessToken?: string;
						idToken?: string;
						expiry?: number;
						error?: string;
					}) => void,
				) => () => void; // Returns a cleanup function
			};
		};
	}
}
