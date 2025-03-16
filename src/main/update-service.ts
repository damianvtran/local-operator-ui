import { type BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import log from "electron-log";
import * as path from "node:path";

/**
 * Service to handle application updates using electron-updater
 */
export class UpdateService {
	private mainWindow: BrowserWindow | null = null;

	/**
	 * Initialize the update service
	 * @param mainWindow - The main application window
	 */
	constructor(mainWindow: BrowserWindow) {
		this.mainWindow = mainWindow;

		// Configure logging for autoUpdater
		log.transports.file.level = "info";
		autoUpdater.logger = log;

		// Configure autoUpdater
		autoUpdater.autoDownload = false;
		autoUpdater.autoInstallOnAppQuit = true;

		// Set up event handlers
		this.setupUpdateEvents();
	}

	/**
	 * Set up event handlers for the autoUpdater
	 */
	private setupUpdateEvents(): void {
		// When an update is available
		autoUpdater.on("update-available", (info) => {
			log.info("Update available:", info);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-available", info);
			}
		});

		// When no update is available
		autoUpdater.on("update-not-available", (info) => {
			log.info("No update available:", info);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-not-available", info);
			}
		});

		// When an update has been downloaded
		autoUpdater.on("update-downloaded", (info) => {
			log.info("Update downloaded:", info);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-downloaded", info);
			}
		});

		// When there's an error with the update
		autoUpdater.on("error", (err) => {
			log.error("Update error:", err);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-error", err.message);
			}
		});

		// When update download progress changes
		autoUpdater.on("download-progress", (progressObj) => {
			log.info("Download progress:", progressObj);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-progress", progressObj);
			}
		});

		// When the app is about to quit and install the update
		// Using type assertion to handle the event that might not be in the type definitions
		// biome-ignore lint/suspicious/noExplicitAny: This event is documented but not in the type definitions
		(autoUpdater as any).on("before-quit-for-update", () => {
			log.info("Application will quit and install update");
			if (this.mainWindow) {
				this.mainWindow.webContents.send("before-quit-for-update");
			}
		});
	}

	/**
	 * Set up IPC handlers for update-related actions
	 */
	public setupIpcHandlers(): void {
		// Check for updates
		ipcMain.handle("check-for-updates", async () => {
			log.info("Checking for updates...");
			try {
				return await autoUpdater.checkForUpdates();
			} catch (error) {
				log.error("Error checking for updates:", error);
				throw error;
			}
		});

		// Download update
		ipcMain.handle("download-update", async () => {
			log.info("Downloading update...");
			try {
				return await autoUpdater.downloadUpdate();
			} catch (error) {
				log.error("Error downloading update:", error);
				throw error;
			}
		});

		// Quit and install update
		ipcMain.handle("quit-and-install", () => {
			log.info("Quitting and installing update...");
			autoUpdater.quitAndInstall(false, true);
		});
	}

	/**
	 * Check for updates
	 * @param silent - Whether to show a notification if no update is available
	 */
	public async checkForUpdates(silent = false): Promise<void> {
		log.info(`Checking for updates... (silent mode: ${silent})`);
		try {
			// Set silent mode for the autoUpdater
			autoUpdater.autoDownload = false;

			// Configure the autoUpdater to handle silent mode
			const originalNotAvailableHandler = autoUpdater.listeners(
				"update-not-available",
			)[0];

			if (silent) {
				// Temporarily remove the update-not-available handler to prevent notifications
				autoUpdater.removeAllListeners("update-not-available");
				autoUpdater.once("update-not-available", (info) => {
					log.info("No update available (silent mode):", info);
					// Don't send notification to renderer in silent mode
				});
			}

			// Check for updates
			await autoUpdater.checkForUpdates();

			// Restore original handler if we're in silent mode and modified it
			if (silent && originalNotAvailableHandler) {
				autoUpdater.removeAllListeners("update-not-available");
				autoUpdater.on(
					"update-not-available",
					originalNotAvailableHandler as (info: unknown) => void,
				);
			}
		} catch (error) {
			log.error("Error checking for updates:", error);
			if (this.mainWindow && !silent) {
				this.mainWindow.webContents.send(
					"update-error",
					(error as Error).message,
				);
			}
		}
	}

	/**
	 * Handle platform-specific setup for the updater
	 */
	public handlePlatformSpecifics(): void {
		// Handle Windows Squirrel events
		if (process.platform === "win32") {
			const appFolder = path.dirname(process.execPath);
			const updateExe = path.resolve(appFolder, "..", "Update.exe");
			const exeName = path.basename(process.execPath);

			// Handle Squirrel.Windows startup events
			if (process.argv.includes("--squirrel-firstrun")) {
				// This is the first run after installation
				log.info(`First run after installation for ${exeName}`);
				log.info(`Update executable path: ${updateExe}`);

				// Wait a bit before checking for updates to avoid file lock issues
				setTimeout(() => {
					this.checkForUpdates(true);
				}, 10000); // 10 seconds delay

				return;
			}

			// Log Windows update configuration
			log.info(
				`Windows update configuration: ${exeName} will use ${updateExe} for updates`,
			);
		}

		// For macOS, ensure the app is signed
		if (process.platform === "darwin") {
			// macOS requires the app to be signed for auto-updates
			// This is handled by the build process, but we can log it for clarity
			log.info("macOS auto-update requires app signing");
		}
	}
}
