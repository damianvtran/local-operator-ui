import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer } from "electron";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { BackendUpdateInfo } from "../main/update-service";
import type {
	DesktopMediaRequest,
	DesktopRequest,
} from "../shared/desktop-contract";

// Custom APIs for renderer
const api = {
	desktop: {
		request: (request: DesktopRequest) =>
			ipcRenderer.invoke("desktop-request", request),
		openAuthorization: (operationId: string, reopen = false) =>
			ipcRenderer.invoke("desktop-open-authorization", operationId, reopen),
		media: (request: DesktopMediaRequest, bytes: Uint8Array | null) =>
			ipcRenderer.invoke("desktop-media", request, bytes),
		watchHeartbeat: (args: {
			sessionId: string;
			subscriptionId: string;
			visible: boolean;
			focused: boolean;
		}) => ipcRenderer.invoke("desktop-watch-heartbeat", args),
		closeWindow: () => ipcRenderer.invoke("desktop-close-window"),
		onOpenConversation: (callback: (sessionId: string) => void) => {
			const handler = (_event: unknown, payload: { sessionId?: unknown }) => {
				if (typeof payload?.sessionId === "string") callback(payload.sessionId);
			};
			ipcRenderer.on("desktop-open-conversation", handler);
			return () => {
				ipcRenderer.removeListener("desktop-open-conversation", handler);
			};
		},
		stream: {
			subscribe: (
				args: { sessionId: string; epoch?: string; afterSeq?: number },
				onEvent: (event: {
					streamId: string;
					kind: "data" | "error" | "end";
					data?: string;
					detail?: string;
				}) => void,
			): { streamId: Promise<string>; dispose: () => void } => {
				const streamIdPromise = ipcRenderer
					.invoke("desktop-stream-subscribe", args)
					.then((handle: { streamId: string }) => handle.streamId);
				const handler = (
					_event: unknown,
					frame: {
						streamId: string;
						kind: "data" | "error" | "end";
						data?: string;
						detail?: string;
					},
				) => {
					// Frames are scoped to their own subscription: a late frame from
					// a dead stream must not land on a new one's consumer.
					void streamIdPromise.then((streamId) => {
						if (frame.streamId === streamId) onEvent(frame);
					});
				};
				ipcRenderer.on("desktop-stream-event", handler);
				return {
					streamId: streamIdPromise,
					dispose: () => {
						ipcRenderer.removeListener("desktop-stream-event", handler);
						void streamIdPromise.then((streamId) =>
							ipcRenderer.invoke("desktop-stream-unsubscribe", streamId),
						);
					},
				};
			},
		},
	},
	// Add methods to open files and URLs
	openFile: (filePath: string) => ipcRenderer.invoke("open-file", filePath),
	readFile: (filePath: string, encoding?: BufferEncoding) =>
		ipcRenderer.invoke("read-file", filePath, encoding),

	openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
	showItemInFolder: (filePath: string) =>
		ipcRenderer.invoke("show-item-in-folder", filePath),

	// System information
	systemInfo: {
		getAppVersion: () => ipcRenderer.invoke("get-app-version"),
		getPlatformInfo: () => ipcRenderer.invoke("get-platform-info"),
	},

	// Add methods for auto-updater
	updater: {
		/**
		 * Check for a UI update.
		 *
		 * `manual` marks a check the user asked for, which the main process lets
		 * re-offer a release whose artifact failed verification - the refusal
		 * panels tell the user to make space or re-download and then check again.
		 */
		checkForUpdates: (options?: { manual?: boolean }) =>
			ipcRenderer.invoke("check-for-updates", options),
		checkForBackendUpdates: () =>
			ipcRenderer.invoke("check-for-backend-updates"),
		checkForAllUpdates: (options?: { manual?: boolean }) =>
			ipcRenderer.invoke("check-for-all-updates", options),
		/** The last install that did not complete, for Settings -> App updates. */
		getLastInstallAttempt: () => ipcRenderer.invoke("get-last-install-attempt"),
		updateBackend: (targetVersion?: string) =>
			ipcRenderer.invoke("update-backend", targetVersion),
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
		/**
		 * A server the app cannot update itself, with the command that can.
		 *
		 * The main process has always sent this; nothing subscribed to it, so the
		 * renderer guessed the command from the word "manually" in an error
		 * string instead.
		 */
		onBackendUpdateManualRequired: (
			callback: (info: {
				message: string;
				command: string;
				detail?: string;
			}) => void,
		) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("backend-update-manual-required", handler);
			return () => {
				ipcRenderer.removeListener("backend-update-manual-required", handler);
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
		/**
		 * An install the app refused to start, with the reason and the remedy.
		 *
		 * Separate from `onUpdateError`: these are deliberate refusals (the
		 * installed bundle's seal, the artifact's checksum, free disk space), not
		 * failures of a check that already happened.
		 */
		onUpdateInstallBlocked: (
			callback: (info: {
				code: string;
				version: string | null;
				message: string;
				remedy: { text: string; url?: string; command?: string };
				detail?: string;
			}) => void,
		) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-install-blocked", handler);
			return () => {
				ipcRenderer.removeListener("update-install-blocked", handler);
			};
		},
		/**
		 * A previous install that Squirrel never completed, reported on the next
		 * start because a failed install produces no error the app can observe.
		 */
		onUpdateInstallFailed: (
			callback: (info: {
				targetVersion: string;
				message: string;
				remedy: { text: string; url?: string; command?: string };
				detail: string;
				/** How many times this target has failed on this machine. */
				attempts?: number;
			}) => void,
		) => {
			const handler = (_event, info) => callback(info);
			ipcRenderer.on("update-install-failed", handler);
			return () => {
				ipcRenderer.removeListener("update-install-failed", handler);
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

	/** Opens a native dialog to select a directory */
	selectDirectory: (): Promise<string | undefined> =>
		ipcRenderer.invoke("select-directory"),

	/** Opens a native dialog to select a file and returns its path and content */
	selectFile: (): Promise<{ path: string; content: string } | undefined> =>
		ipcRenderer.invoke("select-file"),

	/** Gets the user's home directory path */
	getHomeDirectory: (): Promise<string> =>
		ipcRenderer.invoke("get-home-directory"),

	/** Saves a file to the specified path */
	saveFile: (
		filePath: string,
		content: string,
		encoding?: BufferEncoding,
	): Promise<void> =>
		ipcRenderer.invoke("save-file", filePath, content, encoding),

	/** Checks if a file exists at the specified path */
	fileExists: (filePath: string): Promise<boolean> =>
		ipcRenderer.invoke("file-exists", filePath),

	/**
	 * Checks that a path exists AND is a directory. `fileExists` cannot answer
	 * this: it says yes for a regular file, so a working directory of
	 * `/etc/hosts` passed validation and failed at session creation instead.
	 */
	directoryExists: (dirPath: string): Promise<boolean> =>
		ipcRenderer.invoke("directory-exists", dirPath),

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
