import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer } from "electron";
import type { ProgressInfo, UpdateInfo } from "electron-updater";

// Custom APIs for renderer
const api = {
	// Add methods to open files and URLs
	openFile: (filePath: string) => ipcRenderer.invoke("open-file", filePath),
	openExternal: (url: string) => ipcRenderer.invoke("open-external", url),

	// Session storage methods
	session: {
		getSession: () => ipcRenderer.invoke("get-session"),
		storeSession: (jwt: string, expiry: number) =>
			ipcRenderer.invoke("store-session", jwt, expiry),
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
			ipcRenderer.on("update-available", (_event, info) => callback(info));
			return () => {
				ipcRenderer.removeAllListeners("update-available");
			};
		},
		onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => {
			ipcRenderer.on("update-not-available", (_event, info) => callback(info));
			return () => {
				ipcRenderer.removeAllListeners("update-not-available");
			};
		},
		onUpdateDevMode: (callback: (message: string) => void) => {
			ipcRenderer.on("update-dev-mode", (_event, message) => callback(message));
			return () => {
				ipcRenderer.removeAllListeners("update-dev-mode");
			};
		},
		onUpdateNpxAvailable: (
			callback: (info: {
				currentVersion: string;
				latestVersion: string;
				updateCommand: string;
			}) => void,
		) => {
			ipcRenderer.on("update-npx-available", (_event, info) => callback(info));
			return () => {
				ipcRenderer.removeAllListeners("update-npx-available");
			};
		},
		onBackendUpdateAvailable: (
			callback: (info: {
				currentVersion: string;
				latestVersion: string;
				updateCommand: string;
			}) => void,
		) => {
			ipcRenderer.on("backend-update-available", (_event, info) =>
				callback(info),
			);
			return () => {
				ipcRenderer.removeAllListeners("backend-update-available");
			};
		},
		onBackendUpdateDevMode: (callback: (message: string) => void) => {
			ipcRenderer.on("backend-update-dev-mode", (_event, message) =>
				callback(message),
			);
			return () => {
				ipcRenderer.removeAllListeners("backend-update-dev-mode");
			};
		},
		onBackendUpdateNotAvailable: (
			callback: (info: { version: string }) => void,
		) => {
			ipcRenderer.on("backend-update-not-available", (_event, info) =>
				callback(info),
			);
			return () => {
				ipcRenderer.removeAllListeners("backend-update-not-available");
			};
		},
		onBackendUpdateCompleted: (callback: () => void) => {
			ipcRenderer.on("backend-update-completed", () => callback());
			return () => {
				ipcRenderer.removeAllListeners("backend-update-completed");
			};
		},
		onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => {
			ipcRenderer.on("update-downloaded", (_event, info) => callback(info));
			return () => {
				ipcRenderer.removeAllListeners("update-downloaded");
			};
		},
		onUpdateError: (callback: (error: string) => void) => {
			ipcRenderer.on("update-error", (_event, error) => callback(error));
			return () => {
				ipcRenderer.removeAllListeners("update-error");
			};
		},
		onUpdateProgress: (callback: (progressObj: ProgressInfo) => void) => {
			ipcRenderer.on("update-progress", (_event, progressObj) =>
				callback(progressObj),
			);
			return () => {
				ipcRenderer.removeAllListeners("update-progress");
			};
		},
		onBeforeQuitForUpdate: (callback: () => void) => {
			ipcRenderer.on("before-quit-for-update", () => callback());
			return () => {
				ipcRenderer.removeAllListeners("before-quit-for-update");
			};
		},
	},

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
