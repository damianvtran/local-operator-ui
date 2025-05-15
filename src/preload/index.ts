import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer } from "electron";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { BackendUpdateInfo } from "../main/update-service";

// Custom APIs for renderer
const api = {
	// Add methods to open files and URLs
	openFile: (filePath: string) => ipcRenderer.invoke("open-file", filePath),
	readFile: (filePath: string) => ipcRenderer.invoke("read-file", filePath),

	openExternal: (url: string) => ipcRenderer.invoke("open-external", url),

	// Session storage methods
	session: {
		getSession: () => ipcRenderer.invoke("get-session"),
		storeSession: (
			accessToken: string,
			expiry: number,
			refreshToken?: string,
		) => ipcRenderer.invoke("store-session", accessToken, expiry, refreshToken),
		clearSession: () => ipcRenderer.invoke("clear-session"),
	},

	// System information
	systemInfo: {
		getAppVersion: () => ipcRenderer.invoke("get-app-version"),
		getPlatformInfo: () => ipcRenderer.invoke("get-platform-info"),
	},

	// Add methods for auto-updater
	updater: {
		checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
		checkForBackendUpdates: () =>
			ipcRenderer.invoke("check-for-backend-updates"),
		checkForAllUpdates: () => ipcRenderer.invoke("check-for-all-updates"),
		updateBackend: () => ipcRenderer.invoke("update-backend"),
		downloadUpdate: () => ipcRenderer.invoke("download-update"),
		quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),
		onUpdateAvailable: (callback: (info: UpdateInfo) => void) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-available", handler);
			return () => {
				ipcRenderer.removeListener("update-available", handler);
			};
		},
		onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-not-available", handler);
			return () => {
				ipcRenderer.removeListener("update-not-available", handler);
			};
		},
		onUpdateDevMode: (callback: (message: string) => void) => {
			const handler = (_event, message) => callback(message);
			ipcRenderer.on("update-dev-mode", handler);
			return () => {
				ipcRenderer.removeListener("update-dev-mode", handler);
			};
		},
		onUpdateNpxAvailable: (callback: (info: BackendUpdateInfo) => void) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-npx-available", handler);
			return () => {
				ipcRenderer.removeListener("update-npx-available", handler);
			};
		},
		onBackendUpdateAvailable: (callback: (info: BackendUpdateInfo) => void) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("backend-update-available", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-available", handler);
			};
		},
		onBackendUpdateDevMode: (callback: (message: string) => void) => {
			const handler = (_event, message) => callback(message);
			ipcRenderer.on("backend-update-dev-mode", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-dev-mode", handler);
			};
		},
		onBackendUpdateNotAvailable: (
			callback: (info: { version: string }) => void,
		) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("backend-update-not-available", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-not-available", handler);
			};
		},
		onBackendUpdateCompleted: (callback: () => void) => {
			const handler = () => callback();
			ipcRenderer.on("backend-update-completed", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-completed", handler);
			};
		},
		onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-downloaded", handler);
			return () => {
				ipcRenderer.removeListener("update-downloaded", handler);
			};
		},
		onUpdateError: (callback: (error: string) => void) => {
			const handler = (_event, error) => callback(error);
			ipcRenderer.on("update-error", handler);
			return () => {
				ipcRenderer.removeListener("update-error", handler);
			};
		},
		onUpdateProgress: (callback: (progressObj: ProgressInfo) => void) => {
			const handler = (_event, progressObj) => callback(progressObj);
			ipcRenderer.on("update-progress", handler);
			return () => {
				ipcRenderer.removeListener("update-progress", handler);
			};
		},
		onBeforeQuitForUpdate: (callback: () => void) => {
			const handler = () => callback();
			ipcRenderer.on("before-quit-for-update", handler);
			return () => {
				ipcRenderer.removeListener("before-quit-for-update", handler);
			};
		},
	},

	// --- OAuth Methods ---
	oauth: {
		login: (provider: "google" | "microsoft") =>
			ipcRenderer.invoke("oauth-login", provider),
		logout: () => ipcRenderer.invoke("oauth-logout"),
		getStatus: () => ipcRenderer.invoke("oauth-get-status"),
		// Listener for status updates from the main process
		onStatusUpdate: (
			callback: (status: {
				loggedIn: boolean;
				provider: "google" | "microsoft" | null;
				accessToken?: string;
				idToken?: string;
				expiry?: number;
				error?: string;
			}) => void,
		) => {
			const handler = (_event, status) => callback(status);
			ipcRenderer.on("oauth-status-update", handler);
			// Return a cleanup function to remove the listener
			return () => {
				ipcRenderer.removeListener("oauth-status-update", handler);
			};
		},
	},

	/** Opens a native dialog to select a directory */
	selectDirectory: (): Promise<string | undefined> =>
		ipcRenderer.invoke("select-directory"),

	/** Gets the user's home directory path */
	getHomeDirectory: (): Promise<string> =>
		ipcRenderer.invoke("get-home-directory"),

	// Add methods for installer
	ipcRenderer: {
		send: (channel: string, ...args: unknown[]) => {
			const validChannels = ["cancel-installation"];
			if (validChannels.includes(channel)) {
				ipcRenderer.send(channel, ...args);
			}
		},
		on: (channel: string, func: (...args: unknown[]) => void) => {
			const validChannels = ["installation-progress"];
			if (validChannels.includes(channel)) {
				// Remove existing listeners to avoid duplicates
				ipcRenderer.removeAllListeners(channel);
				// Add the new listener
				ipcRenderer.on(channel, (_, ...args) => func(...args));
				return () => {
					ipcRenderer.removeAllListeners(channel);
				};
			}
			return undefined;
		},
		// Add function to check if provider auth is configured in the backend
		checkProviderAuthEnabled: (): Promise<boolean> =>
			ipcRenderer.invoke("ipc-check-provider-auth"),
	},
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
	try {
		contextBridge.exposeInMainWorld("electron", electronAPI);
		contextBridge.exposeInMainWorld("api", api);
	} catch (error) {
		console.error(error);
	}
} else {
	// @ts-ignore (define in dts)
	window.electron = electronAPI;
	// @ts-ignore (define in dts)
	window.api = api;
}
