import { type BrowserWindow, ipcMain, app } from "electron";
import { autoUpdater } from "electron-updater";
import log from "electron-log";
import * as path from "node:path";
import * as https from "node:https";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { apiConfig } from "./backend/config";
import type { BackendServiceManager } from "./backend/backend-service";

/**
 * Health check result containing version information
 */
type HealthCheckResult = {
	/** API server version */
	version: string;
};

/**
 * Response from health check endpoint.
 */
type HealthCheckResponse = {
	/** HTTP status code */
	status: number;
	/** Health check message */
	message: string;
	/** Health check result containing version information (may be undefined in older server versions) */
	result?: HealthCheckResult;
};

/**
 * Type definition for backend update information
 */
export type BackendUpdateInfo = {
	currentVersion: string;
	latestVersion: string;
	updateCommand: string;
};

/**
 * Service to handle application updates using electron-updater
 * and backend updates using pip
 */
export class UpdateService {
	private mainWindow: BrowserWindow | null = null;
	private isDevMode: boolean;
	private isNpxInstall: boolean;
	private backendUrl: string;
	private updateCheckInterval: NodeJS.Timeout | null = null;
	private backendService: BackendServiceManager | null = null;

	/**
	 * Initialize the update service
	 * @param mainWindow - The main application window
	 * @param backendService - Optional backend service manager for restarting the backend after updates
	 */
	constructor(
		mainWindow: BrowserWindow,
		backendService?: BackendServiceManager,
	) {
		this.mainWindow = mainWindow;
		this.backendService = backendService || null;

		// Determine if we're in dev mode
		this.isDevMode =
			!app.isPackaged || Boolean(process.env.ELECTRON_RENDERER_URL);

		// Determine if this is an npx installation
		// Check if the app is running from a node_modules/.bin directory which is typical for npx
		const execPath = process.execPath;
		this.isNpxInstall =
			execPath.includes("node_modules/.bin") ||
			execPath.includes("node_modules\\.bin");

		// Get the backend URL from config
		this.backendUrl = apiConfig.baseUrl;

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

		// Start periodic update checks (every 5 minutes)
		this.startPeriodicUpdateChecks();
	}

	/**
	 * Start periodic update checks
	 * Checks for updates every 5 minutes
	 */
	private startPeriodicUpdateChecks(): void {
		// Clear any existing interval
		if (this.updateCheckInterval) {
			clearInterval(this.updateCheckInterval);
		}

		// Set up new interval (5 minutes = 300000 ms)
		this.updateCheckInterval = setInterval(() => {
			log.info("Running scheduled update check (every 5 minutes)");
			this.checkForAllUpdates(true);
		}, 300000);

		log.info("Periodic update checks scheduled (every 5 minutes)");
	}

	/**
	 * Clean up resources when the service is no longer needed
	 */
	public dispose(): void {
		// Clear the update check interval
		if (this.updateCheckInterval) {
			clearInterval(this.updateCheckInterval);
			this.updateCheckInterval = null;
		}
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
		// Check for UI updates
		ipcMain.handle("check-for-updates", async () => {
			log.info("Checking for UI updates...");
			try {
				return await autoUpdater.checkForUpdates();
			} catch (error) {
				log.error("Error checking for UI updates:", error);
				throw error;
			}
		});

		// Check for backend updates
		ipcMain.handle("check-for-backend-updates", async () => {
			log.info("Checking for backend updates...");
			try {
				return await this.checkForBackendUpdates();
			} catch (error) {
				log.error("Error checking for backend updates:", error);
				throw error;
			}
		});

		// Check for all updates (UI and backend)
		ipcMain.handle("check-for-all-updates", async () => {
			log.info("Checking for all updates (UI and backend)...");
			try {
				return await this.checkForAllUpdates();
			} catch (error) {
				log.error("Error checking for all updates:", error);
				throw error;
			}
		});

		// Update backend
		ipcMain.handle("update-backend", async () => {
			log.info("Updating backend...");
			try {
				return await this.updateBackend();
			} catch (error) {
				log.error("Error updating backend:", error);
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
		return v1PreRelease > v2PreRelease;
	}

	/**
	 * Get the installed backend version using the health API
	 * @returns Promise resolving to the installed version or null if not found
	 */
	private async getInstalledBackendVersion(): Promise<string | null> {
		try {
			log.info(
				`Checking backend version from health API at ${this.backendUrl}/health`,
			);

			// Set a timeout for the fetch request
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

			const response = await fetch(`${this.backendUrl}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				log.error(`Health API returned status ${response.status}`);
				return null;
			}

			const healthData = (await response.json()) as HealthCheckResponse;

			// Check if the response has version information
			if (healthData.result?.version) {
				log.info(
					`Backend version from health API: ${healthData.result.version}`,
				);
				return healthData.result.version;
			}

			// For older server versions that don't have the version information
			log.info("Backend version not available in health response");
			return "Unknown";
		} catch (error) {
			log.error("Error getting backend version from health API:", error);

			// Try alternative URL with localhost if the first attempt failed with 127.0.0.1
			if (this.backendUrl.includes("127.0.0.1")) {
				try {
					const altUrl = this.backendUrl.replace("127.0.0.1", "localhost");
					log.info(`Trying alternative URL: ${altUrl}/health`);

					const controller = new AbortController();
					const timeoutId = setTimeout(() => controller.abort(), 5000);

					const response = await fetch(`${altUrl}/health`, {
						method: "GET",
						headers: { Accept: "application/json" },
						signal: controller.signal,
					});

					clearTimeout(timeoutId);

					if (!response.ok) {
						log.error(
							`Alternative health API returned status ${response.status}`,
						);
						return null;
					}

					const healthData = (await response.json()) as HealthCheckResponse;

					// Check if the response has version information
					if (healthData.result?.version) {
						log.info(
							`Backend version from alternative health API: ${healthData.result.version}`,
						);
						return healthData.result.version;
					}
				} catch (altError) {
					log.error("Error checking alternative backend URL:", altError);
				}
			}

			// If we're in dev mode, try to get the version using pip as a fallback
			if (this.isDevMode) {
				try {
					log.info("Trying to get backend version using pip as fallback");
					const execAsync = promisify(exec);
					const { stdout } = await execAsync("pip show local-operator");
					const match = stdout.match(/Version:\s*([^\n]+)/);
					if (match) {
						const version = match[1].trim();
						log.info(`Backend version from pip: ${version}`);
						return version;
					}
				} catch (pipError) {
					log.error("Error getting backend version from pip:", pipError);
				}
			}

			return null;
		}
	}

	/**
	 * Get the latest version from PyPI
	 * @returns Promise resolving to the latest version string or null if unable to fetch
	 */
	private getLatestPypiVersion(): Promise<string | null> {
		return new Promise((resolve) => {
			const url = "https://pypi.org/pypi/local-operator/json";
			https
				.get(url, (res) => {
					let data = "";
					res.on("data", (chunk) => {
						data += chunk;
					});
					res.on("end", () => {
						try {
							const packageInfo = JSON.parse(data);
							const latestVersion = packageInfo.info?.version;
							resolve(latestVersion || null);
						} catch (error) {
							log.error("Error parsing PyPI response:", error);
							resolve(null);
						}
					});
				})
				.on("error", (error) => {
					log.error("Error fetching from PyPI:", error);
					resolve(null);
				});
		});
	}

	/**
	 * Check for backend updates using health API and PyPI
	 * @param silent - Whether to suppress notifications on no update
	 * @returns Promise resolving to update info or null if no update is available
	 */
	public async checkForBackendUpdates(
		silent = false,
	): Promise<BackendUpdateInfo | null> {
		log.info(`Checking for backend updates... (silent mode: ${silent})`);

		try {
			// Handle dev mode case
			if (this.isDevMode) {
				log.info("Skip backend update check in dev mode unless forced");

				if (!silent && this.mainWindow) {
					this.mainWindow.webContents.send(
						"backend-update-dev-mode",
						"Backend updates are disabled in development mode.",
					);
				}
				return null;
			}

			const installedVersion = await this.getInstalledBackendVersion();
			const latestVersion = await this.getLatestPypiVersion();

			if (!installedVersion || !latestVersion) {
				log.error("Unable to determine backend versions.");
				if (!silent && this.mainWindow) {
					this.mainWindow.webContents.send(
						"backend-update-error",
						"Unable to determine backend version.",
					);
				}
				return null;
			}

			// If installed version is "Unknown", we should recommend an update
			const shouldUpdate =
				installedVersion === "Unknown" ||
				this.isNewerVersion(latestVersion, installedVersion);

			log.info(
				`Installed backend version: ${installedVersion}, Latest: ${latestVersion}, Update needed: ${shouldUpdate}`,
			);

			if (shouldUpdate) {
				log.info(
					`New backend version available: ${latestVersion} (installed: ${installedVersion})`,
				);

				const updateInfo: BackendUpdateInfo = {
					currentVersion: installedVersion,
					latestVersion,
					updateCommand: "pip install --upgrade local-operator",
				};

				if (this.mainWindow) {
					this.mainWindow.webContents.send(
						"backend-update-available",
						updateInfo,
					);
				}

				return updateInfo;
			}

			log.info(
				`No new backend version available. (installed: ${installedVersion}, latest: ${latestVersion})`,
			);

			if (!silent && this.mainWindow) {
				this.mainWindow.webContents.send("backend-update-not-available", {
					version: installedVersion,
				});
			}

			return null;
		} catch (error) {
			log.error("Error checking for backend updates:", error);

			if (!silent && this.mainWindow) {
				this.mainWindow.webContents.send(
					"backend-update-error",
					(error as Error).message,
				);
			}

			return null;
		}
	}

	/**
	 * Update the backend using pip and restart the backend service
	 * @returns Promise resolving to true if update was successful, false otherwise
	 */
	public async updateBackend(): Promise<boolean> {
		log.info("Updating backend...");

		try {
			// First, stop the backend service if we have a reference to it
			if (
				this.backendService &&
				!this.backendService.isUsingExternalBackend()
			) {
				log.info("Stopping backend service before update...");
				await this.backendService.stop();
				log.info("Backend service stopped successfully");
			}

			// Update the backend using pip
			const execAsync = promisify(exec);
			await execAsync("pip install --upgrade local-operator");
			log.info("Backend package updated successfully via pip");

			// Restart the backend service if we have a reference to it
			if (this.backendService) {
				log.info("Restarting backend service after update...");
				const startSuccess = await this.backendService.start();

				if (startSuccess) {
					log.info("Backend service restarted successfully after update");
				} else {
					log.error("Failed to restart backend service after update");
					if (this.mainWindow) {
						this.mainWindow.webContents.send(
							"backend-update-error",
							"Backend was updated but failed to restart. Please restart the application.",
						);
					}
					return false;
				}
			} else {
				log.info("No backend service reference available, skipping restart");
			}

			log.info("Backend update and restart completed successfully");

			if (this.mainWindow) {
				this.mainWindow.webContents.send("backend-update-completed");
			}

			return true;
		} catch (error) {
			log.error("Error updating backend:", error);

			// Try to restart the backend service if it was stopped
			if (
				this.backendService &&
				!this.backendService.isUsingExternalBackend()
			) {
				try {
					log.info(
						"Attempting to restart backend service after update failure...",
					);
					await this.backendService.start();
				} catch (restartError) {
					log.error(
						"Failed to restart backend service after update failure:",
						restartError,
					);
				}
			}

			if (this.mainWindow) {
				this.mainWindow.webContents.send(
					"backend-update-error",
					(error as Error).message,
				);
			}

			return false;
		}
	}

	/**
	 * Check for all updates (UI and backend)
	 * @param silent - Whether to suppress notifications on no updates
	 */
	public async checkForAllUpdates(silent = false): Promise<void> {
		await this.checkForUpdates(silent);
		await this.checkForBackendUpdates(silent);
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
