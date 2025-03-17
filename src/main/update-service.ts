import { exec } from "node:child_process";
import * as https from "node:https";
import * as path from "node:path";
import { promisify } from "node:util";
import { type BrowserWindow, app, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import type { BackendServiceManager } from "./backend/backend-service";
import { apiConfig } from "./backend/config";
import { logger, type LogFileType } from "./backend/logger";

// Add update service log file type to the existing LogFileType enum
const UPDATE_SERVICE_LOG: LogFileType = "update-service.log" as LogFileType;

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

		// Get the backend URL from config.  Use 127.0.0.1 instead of localhost to avoid issues with local fetch.
		this.backendUrl = apiConfig.baseUrl.replace("localhost", "127.0.0.1");

		logger.info(
			`Update service initialized. Dev mode: ${this.isDevMode}, NPX install: ${this.isNpxInstall}`,
			UPDATE_SERVICE_LOG,
		);

		// Configure logging for autoUpdater
		autoUpdater.logger = {
			info: (message: string) => logger.info(message, UPDATE_SERVICE_LOG),
			warn: (message: string) => logger.warn(message, UPDATE_SERVICE_LOG),
			error: (message: string) => logger.error(message, UPDATE_SERVICE_LOG),
			debug: (message: string) => logger.debug(message, UPDATE_SERVICE_LOG),
		};

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
			logger.info(
				"Running scheduled update check (every 5 minutes)",
				UPDATE_SERVICE_LOG,
			);
			this.checkForAllUpdates(true);
		}, 300000);

		logger.info(
			"Periodic update checks scheduled (every 5 minutes)",
			UPDATE_SERVICE_LOG,
		);
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
			logger.info("Update available:", UPDATE_SERVICE_LOG, info);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-available", info);
			}
		});

		// When no update is available
		autoUpdater.on("update-not-available", (info) => {
			logger.info("No update available:", UPDATE_SERVICE_LOG, info);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-not-available", info);
			}
		});

		// When an update has been downloaded
		autoUpdater.on("update-downloaded", (info) => {
			logger.info("Update downloaded:", UPDATE_SERVICE_LOG, info);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-downloaded", info);
			}
		});

		// When there's an error with the update
		autoUpdater.on("error", (err) => {
			logger.error("Update error:", UPDATE_SERVICE_LOG, err);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-error", err.message);
			}
		});

		// When update download progress changes
		autoUpdater.on("download-progress", (progressObj) => {
			logger.info("Download progress:", UPDATE_SERVICE_LOG, progressObj);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-progress", progressObj);
			}
		});

		// When the app is about to quit and install the update
		// Using type assertion to handle the event that might not be in the type definitions
		// biome-ignore lint/suspicious/noExplicitAny: This event is documented but not in the type definitions
		(autoUpdater as any).on("before-quit-for-update", () => {
			logger.info(
				"Application will quit and install update",
				UPDATE_SERVICE_LOG,
			);
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
			logger.info("Checking for UI updates...", UPDATE_SERVICE_LOG);
			try {
				return await autoUpdater.checkForUpdates();
			} catch (error) {
				logger.error(
					"Error checking for UI updates:",
					UPDATE_SERVICE_LOG,
					error,
				);
				throw error;
			}
		});

		// Check for backend updates
		ipcMain.handle("check-for-backend-updates", async () => {
			logger.info("Checking for backend updates...", UPDATE_SERVICE_LOG);
			try {
				return await this.checkForBackendUpdates();
			} catch (error) {
				logger.error(
					"Error checking for backend updates:",
					UPDATE_SERVICE_LOG,
					error,
				);
				throw error;
			}
		});

		// Check for all updates (UI and backend)
		ipcMain.handle("check-for-all-updates", async () => {
			logger.info(
				"Checking for all updates (UI and backend)...",
				UPDATE_SERVICE_LOG,
			);
			try {
				return await this.checkForAllUpdates();
			} catch (error) {
				logger.error(
					"Error checking for all updates:",
					UPDATE_SERVICE_LOG,
					error,
				);
				throw error;
			}
		});

		// Update backend
		ipcMain.handle("update-backend", async () => {
			logger.info("Updating backend...", UPDATE_SERVICE_LOG);
			try {
				return await this.updateBackend();
			} catch (error) {
				logger.error("Error updating backend:", UPDATE_SERVICE_LOG, error);
				throw error;
			}
		});

		// Download update
		ipcMain.handle("download-update", async () => {
			logger.info("Downloading update...", UPDATE_SERVICE_LOG);
			try {
				return await autoUpdater.downloadUpdate();
			} catch (error) {
				logger.error("Error downloading update:", UPDATE_SERVICE_LOG, error);
				throw error;
			}
		});

		// Quit and install update
		ipcMain.handle("quit-and-install", () => {
			logger.info("Quitting and installing update...", UPDATE_SERVICE_LOG);
			autoUpdater.quitAndInstall(false, true);
		});
	}

	/**
	 * Check for updates
	 * @param silent - Whether to show a notification if no update is available
	 */
	public async checkForUpdates(silent = false): Promise<void> {
		logger.info(
			`Checking for updates... (silent mode: ${silent})`,
			UPDATE_SERVICE_LOG,
		);

		try {
			// Handle dev mode case
			if (this.isDevMode) {
				logger.info(
					"Skip checkForUpdates because application is not packed and dev update config is not forced",
					UPDATE_SERVICE_LOG,
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
				logger.info(
					"Application was installed via npx. Checking npm registry for updates...",
					UPDATE_SERVICE_LOG,
				);

				if (!silent) {
					// Check npm registry for the latest version
					const currentVersion = app.getVersion();
					const latestVersion = await this.getLatestNpmVersion();

					if (
						latestVersion &&
						this.isNewerVersion(latestVersion, currentVersion)
					) {
						logger.info(
							`Newer version available: ${latestVersion} (current: ${currentVersion})`,
							UPDATE_SERVICE_LOG,
						);

						if (this.mainWindow) {
							this.mainWindow.webContents.send("update-npx-available", {
								currentVersion,
								latestVersion,
								updateCommand: "npx local-operator-ui@latest",
							});
						}
					} else {
						logger.info(
							`No newer version available. Current: ${currentVersion}, Latest: ${latestVersion || "unknown"}`,
							UPDATE_SERVICE_LOG,
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
					logger.info(
						"No update available (silent mode):",
						UPDATE_SERVICE_LOG,
						info,
					);
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
			logger.error("Error checking for updates:", UPDATE_SERVICE_LOG, error);
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
							logger.error(
								"Error parsing npm registry response:",
								UPDATE_SERVICE_LOG,
								error,
							);
							resolve(null);
						}
					});
				})
				.on("error", (error) => {
					logger.error(
						"Error fetching from npm registry:",
						UPDATE_SERVICE_LOG,
						error,
					);
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
			logger.info(
				`Checking backend version from health API at ${this.backendUrl}/health`,
				UPDATE_SERVICE_LOG,
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
				logger.error(
					`Health API returned status ${response.status}`,
					UPDATE_SERVICE_LOG,
				);
				return null;
			}

			const healthData = (await response.json()) as HealthCheckResponse;

			// Check if the response has version information
			if (healthData.result?.version) {
				logger.info(
					`Backend version from health API: ${healthData.result.version}`,
					UPDATE_SERVICE_LOG,
				);
				return healthData.result.version;
			}

			// For older server versions that don't have the version information
			logger.info(
				"Backend version not available in health response",
				UPDATE_SERVICE_LOG,
			);
			return "Unknown";
		} catch (error) {
			logger.error(
				"Error getting backend version from health API:",
				UPDATE_SERVICE_LOG,
				error,
			);

			// Try alternative URL with localhost if the first attempt failed with 127.0.0.1
			if (this.backendUrl.includes("127.0.0.1")) {
				try {
					const altUrl = this.backendUrl.replace("127.0.0.1", "localhost");
					logger.info(
						`Trying alternative URL: ${altUrl}/health`,
						UPDATE_SERVICE_LOG,
					);

					const controller = new AbortController();
					const timeoutId = setTimeout(() => controller.abort(), 5000);

					const response = await fetch(`${altUrl}/health`, {
						method: "GET",
						headers: { Accept: "application/json" },
						signal: controller.signal,
					});

					clearTimeout(timeoutId);

					if (!response.ok) {
						logger.error(
							`Alternative health API returned status ${response.status}`,
							UPDATE_SERVICE_LOG,
						);
						return null;
					}

					const healthData = (await response.json()) as HealthCheckResponse;

					// Check if the response has version information
					if (healthData.result?.version) {
						logger.info(
							`Backend version from alternative health API: ${healthData.result.version}`,
							UPDATE_SERVICE_LOG,
						);
						return healthData.result.version;
					}
				} catch (altError) {
					logger.error(
						"Error checking alternative backend URL:",
						UPDATE_SERVICE_LOG,
						altError,
					);
				}
			}

			// If we're in dev mode, try to get the version using pip as a fallback
			if (this.isDevMode) {
				try {
					logger.info(
						"Trying to get backend version using pip as fallback",
						UPDATE_SERVICE_LOG,
					);
					const execAsync = promisify(exec);
					const { stdout } = await execAsync("pip show local-operator");
					const match = stdout.match(/Version:\s*([^\n]+)/);
					if (match) {
						const version = match[1].trim();
						logger.info(
							`Backend version from pip: ${version}`,
							UPDATE_SERVICE_LOG,
						);
						return version;
					}
				} catch (pipError) {
					logger.error(
						"Error getting backend version from pip:",
						UPDATE_SERVICE_LOG,
						pipError,
					);
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
							logger.error(
								"Error parsing PyPI response:",
								UPDATE_SERVICE_LOG,
								error,
							);
							resolve(null);
						}
					});
				})
				.on("error", (error) => {
					logger.error("Error fetching from PyPI:", UPDATE_SERVICE_LOG, error);
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
		logger.info(
			`Checking for backend updates... (silent mode: ${silent})`,
			UPDATE_SERVICE_LOG,
		);

		try {
			// Handle dev mode case
			// if (this.isDevMode) {
			// 	logger.info(
			// 		"Skip backend update check in dev mode unless forced",
			// 		UPDATE_SERVICE_LOG,
			// 	);

			// 	if (!silent && this.mainWindow) {
			// 		this.mainWindow.webContents.send(
			// 			"backend-update-dev-mode",
			// 			"Backend updates are disabled in development mode.",
			// 		);
			// 	}
			// 	return null;
			// }

			const installedVersion = await this.getInstalledBackendVersion();
			const latestVersion = await this.getLatestPypiVersion();

			if (!installedVersion || !latestVersion) {
				logger.error(
					"Unable to determine backend versions.",
					UPDATE_SERVICE_LOG,
				);
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

			logger.info(
				`Installed backend version: ${installedVersion}, Latest: ${latestVersion}, Update needed: ${shouldUpdate}`,
				UPDATE_SERVICE_LOG,
			);

			if (shouldUpdate) {
				logger.info(
					`New backend version available: ${latestVersion} (installed: ${installedVersion})`,
					UPDATE_SERVICE_LOG,
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

			logger.info(
				`No new backend version available. (installed: ${installedVersion}, latest: ${latestVersion})`,
				UPDATE_SERVICE_LOG,
			);

			if (!silent && this.mainWindow) {
				this.mainWindow.webContents.send("backend-update-not-available", {
					version: installedVersion,
				});
			}

			return null;
		} catch (error) {
			logger.error(
				"Error checking for backend updates:",
				UPDATE_SERVICE_LOG,
				error,
			);

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
		logger.info("Updating backend...", UPDATE_SERVICE_LOG);

		try {
			// First, stop the backend service if we have a reference to it
			if (
				this.backendService &&
				!this.backendService.isUsingExternalBackend()
			) {
				logger.info(
					"Stopping backend service before update...",
					UPDATE_SERVICE_LOG,
				);
				await this.backendService.stop();
				logger.info("Backend service stopped successfully", UPDATE_SERVICE_LOG);
			}

			// Update the backend using pip
			const execAsync = promisify(exec);
			await execAsync("pip install --upgrade local-operator");
			logger.info(
				"Backend package updated successfully via pip",
				UPDATE_SERVICE_LOG,
			);

			// Restart the backend service if we have a reference to it
			if (this.backendService) {
				logger.info(
					"Restarting backend service after update...",
					UPDATE_SERVICE_LOG,
				);
				const startSuccess = await this.backendService.start();

				if (startSuccess) {
					logger.info(
						"Backend service restarted successfully after update",
						UPDATE_SERVICE_LOG,
					);
				} else {
					logger.error(
						"Failed to restart backend service after update",
						UPDATE_SERVICE_LOG,
					);
					if (this.mainWindow) {
						this.mainWindow.webContents.send(
							"backend-update-error",
							"Backend was updated but failed to restart. Please restart the application.",
						);
					}
					return false;
				}
			} else {
				logger.info(
					"No backend service reference available, skipping restart",
					UPDATE_SERVICE_LOG,
				);
			}

			logger.info(
				"Backend update and restart completed successfully",
				UPDATE_SERVICE_LOG,
			);

			if (this.mainWindow) {
				this.mainWindow.webContents.send("backend-update-completed");
			}

			return true;
		} catch (error) {
			logger.error("Error updating backend:", UPDATE_SERVICE_LOG, error);

			// Try to restart the backend service if it was stopped
			if (
				this.backendService &&
				!this.backendService.isUsingExternalBackend()
			) {
				try {
					logger.info(
						"Attempting to restart backend service after update failure...",
						UPDATE_SERVICE_LOG,
					);
					await this.backendService.start();
				} catch (restartError) {
					logger.error(
						"Failed to restart backend service after update failure:",
						UPDATE_SERVICE_LOG,
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
				logger.info(
					`First run after installation for ${exeName}`,
					UPDATE_SERVICE_LOG,
				);
				logger.info(`Update executable path: ${updateExe}`, UPDATE_SERVICE_LOG);

				// Wait a bit before checking for updates to avoid file lock issues
				setTimeout(() => {
					this.checkForUpdates(true);
				}, 10000); // 10 seconds delay

				return;
			}

			// Log Windows update configuration
			logger.info(
				`Windows update configuration: ${exeName} will use ${updateExe} for updates`,
				UPDATE_SERVICE_LOG,
			);
		}

		// For macOS, ensure the app is signed
		if (process.platform === "darwin") {
			// macOS requires the app to be signed for auto-updates
			// This is handled by the build process, but we can log it for clarity
			logger.info("macOS auto-update requires app signing", UPDATE_SERVICE_LOG);
		}
	}
}
