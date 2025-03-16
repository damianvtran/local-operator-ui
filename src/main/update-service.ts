import { type BrowserWindow, ipcMain, app } from "electron";
import { autoUpdater } from "electron-updater";
import log from "electron-log";
import * as path from "node:path";
import * as https from "node:https";

/**
 * Service to handle application updates using electron-updater
 */
export class UpdateService {
	private mainWindow: BrowserWindow | null = null;
	private isDevMode: boolean;
	private isNpxInstall: boolean;

	/**
	 * Initialize the update service
	 * @param mainWindow - The main application window
	 */
	constructor(mainWindow: BrowserWindow) {
		this.mainWindow = mainWindow;

		// Determine if we're in dev mode
		this.isDevMode =
			!app.isPackaged || Boolean(process.env.ELECTRON_RENDERER_URL);

		// Determine if this is an npx installation
		// Check if the app is running from a node_modules/.bin directory which is typical for npx
		const execPath = process.execPath;
		this.isNpxInstall =
			execPath.includes("node_modules/.bin") ||
			execPath.includes("node_modules\\.bin");

		log.info(
			`Update service initialized. Dev mode: ${this.isDevMode}, NPX install: ${this.isNpxInstall}`,
		);

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
			// Handle dev mode case
			if (this.isDevMode) {
				log.info(
					"Skip checkForUpdates because application is not packed and dev update config is not forced",
				);

				if (!silent && this.mainWindow) {
					this.mainWindow.webContents.send(
						"update-dev-mode",
						"Application is running in development mode. Updates are disabled.",
					);
				}
				return;
			}

			// Handle npx installation case
			if (this.isNpxInstall) {
				log.info(
					"Application was installed via npx. Checking npm registry for updates...",
				);

				if (!silent) {
					// Check npm registry for the latest version
					const currentVersion = app.getVersion();
					const latestVersion = await this.getLatestNpmVersion();

					if (
						latestVersion &&
						this.isNewerVersion(latestVersion, currentVersion)
					) {
						log.info(
							`Newer version available: ${latestVersion} (current: ${currentVersion})`,
						);

						if (this.mainWindow) {
							this.mainWindow.webContents.send("update-npx-available", {
								currentVersion,
								latestVersion,
								updateCommand: "npx local-operator-ui@latest",
							});
						}
					} else {
						log.info(
							`No newer version available. Current: ${currentVersion}, Latest: ${latestVersion || "unknown"}`,
						);

						if (this.mainWindow) {
							this.mainWindow.webContents.send("update-not-available", {
								version: currentVersion,
							});
						}
					}
				}
				return;
			}

			// Regular update flow for packaged app
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
	 * Get the latest version from npm registry
	 * @returns The latest version string or null if unable to fetch
	 */
	private getLatestNpmVersion(): Promise<string | null> {
		return new Promise((resolve) => {
			const packageName = "local-operator-ui";
			const url = `https://registry.npmjs.org/${packageName}`;

			https
				.get(url, (res) => {
					let data = "";

					res.on("data", (chunk) => {
						data += chunk;
					});

					res.on("end", () => {
						try {
							const packageInfo = JSON.parse(data);
							const latestVersion = packageInfo["dist-tags"]?.latest;
							resolve(latestVersion || null);
						} catch (error) {
							log.error("Error parsing npm registry response:", error);
							resolve(null);
						}
					});
				})
				.on("error", (error) => {
					log.error("Error fetching from npm registry:", error);
					resolve(null);
				});
		});
	}

	/**
	 * Compare version strings to determine if version1 is newer than version2
	 * @param version1 First version string
	 * @param version2 Second version string
	 * @returns True if version1 is newer than version2
	 */
	private isNewerVersion(version1: string, version2: string): boolean {
		const v1Parts = version1.split("-")[0].split(".").map(Number);
		const v2Parts = version2.split("-")[0].split(".").map(Number);

		// Compare major, minor, patch
		for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
			const v1Part = v1Parts[i] || 0;
			const v2Part = v2Parts[i] || 0;

			if (v1Part > v2Part) return true;
			if (v1Part < v2Part) return false;
		}

		// If we get here and versions have pre-release tags, compare those
		const v1PreRelease = version1.split("-")[1];
		const v2PreRelease = version2.split("-")[1];

		// No pre-release is newer than any pre-release
		if (!v1PreRelease && v2PreRelease) return true;
		if (v1PreRelease && !v2PreRelease) return false;

		// If both have pre-release tags, compare them lexicographically
		// This is a simplification - in reality you might want more sophisticated semver comparison
		return v1PreRelease > v2PreRelease;
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
