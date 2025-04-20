import { exec } from "node:child_process";
import * as https from "node:https";
import * as path from "node:path";
import { join } from "node:path";
import { promisify } from "node:util";
import { type BrowserWindow, app, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import type { BackendServiceManager } from "./backend/backend-service";

import { LocalOperatorStartupMode } from "./backend/backend-service";
import { apiConfig } from "./backend/config";
import { LogFileType, logger } from "./backend/logger";

// Regex constants for performance (moved to top-level)
const VERSION_LINE_REGEX = /Version:\s*([^\n]+)/;
const BETA_VERSION_REGEX = /v\d+\.\d+\.\d+\.beta\.\d+/;

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
	/** Whether the update can be managed by the update service */
	canManageUpdate: boolean;
	/** The startup mode of the backend service */
	startupMode?: LocalOperatorStartupMode;
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
			LogFileType.UPDATE_SERVICE,
		);

		// Configure logging for autoUpdater
		autoUpdater.logger = {
			info: (message: string) =>
				logger.info(message, LogFileType.UPDATE_SERVICE),
			warn: (message: string) =>
				logger.warn(message, LogFileType.UPDATE_SERVICE),
			error: (message: string) =>
				logger.error(message, LogFileType.UPDATE_SERVICE),
			debug: (message: string) =>
				logger.debug(message, LogFileType.UPDATE_SERVICE),
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
				LogFileType.UPDATE_SERVICE,
			);
			this.checkForAllUpdates(true);
		}, 300000);

		logger.info(
			"Periodic update checks scheduled (every 5 minutes)",
			LogFileType.UPDATE_SERVICE,
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

		// Ensure backend service is stopped if it's running
		if (this.backendService && !this.backendService.isUsingExternalBackend()) {
			logger.info(
				"Stopping backend service during dispose...",
				LogFileType.UPDATE_SERVICE,
			);
			// Use false for isRestart to indicate this is a final shutdown, not a restart
			this.backendService.stop(false).catch((error) => {
				logger.error(
					"Error stopping backend service during dispose:",
					LogFileType.UPDATE_SERVICE,
					error,
				);

				// If normal shutdown fails, try a more aggressive approach
				this.forceTerminateBackendProcess().catch((forceError) => {
					logger.error(
						"Error force terminating backend service during dispose:",
						LogFileType.UPDATE_SERVICE,
						forceError,
					);
				});
			});
		}
	}

	/**
	 * Register the backend service for proper shutdown when app quits
	 * This ensures that restarted backend services are properly shut down
	 */
	private registerBackendShutdown(): void {
		if (!this.backendService || this.backendService.isUsingExternalBackend()) {
			return;
		}

		// We'll use a more direct approach to ensure the backend is shut down
		// Register a handler for the 'before-quit' event which is supported in Electron's type definitions
		const shutdownHandler = async () => {
			logger.info(
				"Shutting down backend service before app quit...",
				LogFileType.UPDATE_SERVICE,
			);
			try {
				// Use false for isRestart to indicate this is a final shutdown, not a restart
				await this.backendService?.stop(false);
				logger.info(
					"Backend service successfully shut down before app quit",
					LogFileType.UPDATE_SERVICE,
				);
			} catch (error) {
				logger.error(
					"Error shutting down backend service before app quit:",
					LogFileType.UPDATE_SERVICE,
					error,
				);

				// If normal shutdown fails, try a more aggressive approach
				try {
					logger.info(
						"Attempting forced shutdown of backend service...",
						LogFileType.UPDATE_SERVICE,
					);
					await this.forceTerminateBackendProcess();
					logger.info(
						"Forced shutdown of backend service completed",
						LogFileType.UPDATE_SERVICE,
					);
				} catch (forceError) {
					logger.error(
						"Error during forced shutdown of backend service:",
						LogFileType.UPDATE_SERVICE,
						forceError,
					);
				}
			}
		};

		// Remove any existing handlers to avoid duplicates
		// biome-ignore lint/suspicious/noExplicitAny: Needed for compatibility with Electron's type system
		(app as any).removeAllListeners("before-quit");

		// Register the handler for app quit
		// biome-ignore lint/suspicious/noExplicitAny: Needed for compatibility with Electron's type system
		(app as any).once("before-quit", shutdownHandler);

		// Also register a handler for the will-quit event as a backup
		// biome-ignore lint/suspicious/noExplicitAny: Needed for compatibility with Electron's type system
		(app as any).once("will-quit", shutdownHandler);

		logger.info(
			"Registered backend service for proper shutdown on app quit",
			LogFileType.UPDATE_SERVICE,
		);
	}

	/**
	 * Force terminate the backend process using platform-specific commands
	 * This is a last resort method when normal termination fails
	 */
	private async forceTerminateBackendProcess(): Promise<void> {
		if (!this.backendService) {
			return;
		}

		const execAsync = promisify(exec);

		try {
			if (process.platform === "win32") {
				// On Windows, use taskkill to forcefully terminate processes with "local-operator serve" in the command line
				await execAsync('taskkill /f /im "local-operator serve" /t');
				await execAsync(
					"wmic process where \"commandline like '%local-operator serve%'\" call terminate",
				);
			} else {
				// On Unix systems (macOS/Linux), use pkill to forcefully terminate processes with "local-operator serve" in the command line
				await execAsync('pkill -f "local-operator serve"');
				// Give processes a moment to terminate gracefully before force killing
				await new Promise((resolve) => setTimeout(resolve, 1000));
				// Force kill any remaining processes
				await execAsync('pkill -9 -f "local-operator serve"');
			}
		} catch (error) {
			// Ignore errors, as the process might not exist
			logger.warn(
				"Error during force termination (this may be normal if process was already terminated):",
				LogFileType.UPDATE_SERVICE,
				error,
			);
		}
	}

	/**
	 * Set up event handlers for the autoUpdater
	 */
	private setupUpdateEvents(): void {
		// When an update is available
		autoUpdater.on("update-available", (info) => {
			logger.info("Update available:", LogFileType.UPDATE_SERVICE, info);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-available", info);
			}
		});

		// When no update is available
		autoUpdater.on("update-not-available", (info) => {
			logger.info("No update available:", LogFileType.UPDATE_SERVICE, info);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-not-available", info);
			}
		});

		// When an update has been downloaded
		autoUpdater.on("update-downloaded", (info) => {
			logger.info("Update downloaded:", LogFileType.UPDATE_SERVICE, info);
			if (this.mainWindow) {
				this.mainWindow.webContents.send("update-downloaded", info);
			}
		});

		// When there's an error with the update
		autoUpdater.on("error", (err) => {
			logger.error("Update error:", LogFileType.UPDATE_SERVICE, err);

			// Check if the error should be filtered based on our requirements
			const shouldFilter = this.shouldFilterUpdateError(err);

			if (shouldFilter) {
				logger.info(
					"Error filtering result: Reporting as no updates available",
				);
				// Send update-not-available instead of the error
				if (this.mainWindow) {
					this.mainWindow.webContents.send("update-not-available", {
						version: app.getVersion(),
					});
				}
			} else {
				// Only send the error to the renderer if it shouldn't be filtered
				if (this.mainWindow) {
					this.mainWindow.webContents.send("update-error", err.message);
				}
			}
		});

		// When update download progress changes
		autoUpdater.on("download-progress", (progressObj) => {
			logger.info(
				"Download progress:",
				LogFileType.UPDATE_SERVICE,
				progressObj,
			);
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
				LogFileType.UPDATE_SERVICE,
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
			logger.info("Checking for UI updates...", LogFileType.UPDATE_SERVICE);
			try {
				return await autoUpdater.checkForUpdates();
			} catch (error) {
				logger.error(
					"Error checking for UI updates:",
					LogFileType.UPDATE_SERVICE,
					error,
				);

				// Apply the same error filtering logic here as in the autoUpdater error event
				const shouldFilter = this.shouldFilterUpdateError(error as Error);

				if (shouldFilter) {
					logger.info(
						"Error filtering result in IPC handler: Reporting as no updates available",
						LogFileType.UPDATE_SERVICE,
					);
					// Return a "no update available" result instead of throwing the error
					return {
						updateInfo: {
							version: app.getVersion(),
						},
						versionInfo: {
							version: app.getVersion(),
						},
						cancellationToken: null,
					};
				}

				// Only throw the error if it shouldn't be filtered
				throw error;
			}
		});

		// Check for backend updates
		ipcMain.handle("check-for-backend-updates", async () => {
			logger.info(
				"Checking for backend updates...",
				LogFileType.UPDATE_SERVICE,
			);
			try {
				return await this.checkForBackendUpdates();
			} catch (error) {
				logger.error(
					"Error checking for backend updates:",
					LogFileType.UPDATE_SERVICE,
					error,
				);
				throw error;
			}
		});

		// Check for all updates (UI and backend)
		ipcMain.handle("check-for-all-updates", async () => {
			logger.info(
				"Checking for all updates (UI and backend)...",
				LogFileType.UPDATE_SERVICE,
			);
			try {
				return await this.checkForAllUpdates();
			} catch (error) {
				logger.error(
					"Error checking for all updates:",
					LogFileType.UPDATE_SERVICE,
					error,
				);

				// Apply the same error filtering logic here
				const shouldFilter = this.shouldFilterUpdateError(error as Error);

				if (shouldFilter) {
					logger.info(
						"Error filtering result in check-for-all-updates: Reporting as no updates available",
						LogFileType.UPDATE_SERVICE,
					);
					// Return a "no update available" result instead of throwing the error
					return {
						updateInfo: {
							version: app.getVersion(),
						},
						versionInfo: {
							version: app.getVersion(),
						},
						cancellationToken: null,
					};
				}

				throw error;
			}
		});

		// Update backend
		ipcMain.handle("update-backend", async () => {
			logger.info("Updating backend...", LogFileType.UPDATE_SERVICE);
			try {
				return await this.updateBackend();
			} catch (error) {
				logger.error(
					"Error updating backend:",
					LogFileType.UPDATE_SERVICE,
					error,
				);
				throw error;
			}
		});

		// Download update
		ipcMain.handle("download-update", async () => {
			logger.info("Downloading update...", LogFileType.UPDATE_SERVICE);
			try {
				return await autoUpdater.downloadUpdate();
			} catch (error) {
				logger.error(
					"Error downloading update:",
					LogFileType.UPDATE_SERVICE,
					error,
				);

				// Apply the same error filtering logic here
				const shouldFilter = this.shouldFilterUpdateError(error as Error);

				if (shouldFilter) {
					logger.info(
						"Error filtering result in download-update: Reporting as no updates available",
						LogFileType.UPDATE_SERVICE,
					);
					// Return a "no update available" result instead of throwing the error
					if (this.mainWindow) {
						this.mainWindow.webContents.send("update-not-available", {
							version: app.getVersion(),
						});
					}
					// Return a minimal result to avoid breaking the promise chain
					return {
						cancellationToken: null,
					};
				}

				throw error;
			}
		});

		// Quit and install update
		ipcMain.handle("quit-and-install", () => {
			logger.info(
				"Quitting and installing update...",
				LogFileType.UPDATE_SERVICE,
			);
			this.backendService?.setAutoUpdating(true);
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
			LogFileType.UPDATE_SERVICE,
		);

		try {
			// Handle dev mode case
			if (this.isDevMode) {
				logger.info(
					"Skip checkForUpdates because application is not packed and dev update config is not forced",
					LogFileType.UPDATE_SERVICE,
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
					LogFileType.UPDATE_SERVICE,
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
							LogFileType.UPDATE_SERVICE,
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
							LogFileType.UPDATE_SERVICE,
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
						LogFileType.UPDATE_SERVICE,
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
			logger.error(
				"Error checking for updates:",
				LogFileType.UPDATE_SERVICE,
				error,
			);
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
								LogFileType.UPDATE_SERVICE,
								error,
							);
							resolve(null);
						}
					});
				})
				.on("error", (error) => {
					logger.error(
						"Error fetching from npm registry:",
						LogFileType.UPDATE_SERVICE,
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
				LogFileType.UPDATE_SERVICE,
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
					LogFileType.UPDATE_SERVICE,
				);
				return null;
			}

			const healthData = (await response.json()) as HealthCheckResponse;

			// Check if the response has version information
			if (healthData.result?.version) {
				logger.info(
					`Backend version from health API: ${healthData.result.version}`,
					LogFileType.UPDATE_SERVICE,
				);
				return healthData.result.version;
			}

			// For older server versions that don't have the version information
			logger.info(
				"Backend version not available in health response",
				LogFileType.UPDATE_SERVICE,
			);
			return "Unknown";
		} catch (error) {
			logger.error(
				"Error getting backend version from health API:",
				LogFileType.UPDATE_SERVICE,
				error,
			);

			// Try alternative URL with localhost if the first attempt failed with 127.0.0.1
			if (this.backendUrl.includes("127.0.0.1")) {
				try {
					const altUrl = this.backendUrl.replace("127.0.0.1", "localhost");
					logger.info(
						`Trying alternative URL: ${altUrl}/health`,
						LogFileType.UPDATE_SERVICE,
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
							LogFileType.UPDATE_SERVICE,
						);
						return null;
					}

					const healthData = (await response.json()) as HealthCheckResponse;

					// Check if the response has version information
					if (healthData.result?.version) {
						logger.info(
							`Backend version from alternative health API: ${healthData.result.version}`,
							LogFileType.UPDATE_SERVICE,
						);
						return healthData.result.version;
					}
				} catch (altError) {
					logger.error(
						"Error checking alternative backend URL:",
						LogFileType.UPDATE_SERVICE,
						altError,
					);
				}
			}

			// If we're in dev mode, try to get the version using pip as a fallback
			if (this.isDevMode) {
				try {
					logger.info(
						"Trying to get backend version using pip as fallback",
						LogFileType.UPDATE_SERVICE,
					);
					const execAsync = promisify(exec);
					const { stdout } = await execAsync("pip show local-operator");
					const match = stdout.match(VERSION_LINE_REGEX);
					if (match) {
						const version = match[1].trim();
						logger.info(
							`Backend version from pip: ${version}`,
							LogFileType.UPDATE_SERVICE,
						);
						return version;
					}
				} catch (pipError) {
					logger.error(
						"Error getting backend version from pip:",
						LogFileType.UPDATE_SERVICE,
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
								LogFileType.UPDATE_SERVICE,
								error,
							);
							resolve(null);
						}
					});
				})
				.on("error", (error) => {
					logger.error(
						"Error fetching from PyPI:",
						LogFileType.UPDATE_SERVICE,
						error,
					);
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
			LogFileType.UPDATE_SERVICE,
		);

		try {
			// Handle dev mode case
			if (this.isDevMode) {
				logger.info(
					"Skip backend update check in dev mode unless forced",
					LogFileType.UPDATE_SERVICE,
				);

				if (!silent && this.mainWindow) {
					this.mainWindow.webContents.send(
						"backend-update-dev-mode",
						"Backend updates are disabled in development mode.",
					);
				}
				return null;
			}

			// Check if we have a backend service and get its startup mode
			const startupMode =
				this.backendService?.getStartupMode() ||
				LocalOperatorStartupMode.NOT_STARTED;

			// If the server is not started, there's nothing to update
			if (startupMode === LocalOperatorStartupMode.NOT_STARTED) {
				logger.info(
					"No python server is available, nothing to check or update",
					LogFileType.UPDATE_SERVICE,
				);
				return null;
			}

			const installedVersion = await this.getInstalledBackendVersion();
			const latestVersion = await this.getLatestPypiVersion();

			if (!installedVersion || !latestVersion) {
				logger.error(
					"Unable to determine backend versions.",
					LogFileType.UPDATE_SERVICE,
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
				`Installed backend version: ${installedVersion}, Latest: ${latestVersion}, Update needed: ${shouldUpdate}, Startup mode: ${startupMode}`,
				LogFileType.UPDATE_SERVICE,
			);

			if (shouldUpdate) {
				logger.info(
					`New backend version available: ${latestVersion} (installed: ${installedVersion})`,
					LogFileType.UPDATE_SERVICE,
				);

				// Determine if we can manage the update based on startup mode
				const canManageUpdate =
					startupMode !== LocalOperatorStartupMode.EXISTING_SERVER;

				// Determine the appropriate update command based on startup mode
				let updateCommand = "pip install --upgrade local-operator";
				if (startupMode === LocalOperatorStartupMode.EXISTING_SERVER) {
					updateCommand = "pip install --upgrade local-operator";
				}

				const updateInfo: BackendUpdateInfo = {
					currentVersion: installedVersion,
					latestVersion,
					updateCommand,
					canManageUpdate,
					startupMode,
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
				LogFileType.UPDATE_SERVICE,
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
				LogFileType.UPDATE_SERVICE,
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
		logger.info("Updating backend...", LogFileType.UPDATE_SERVICE);

		try {
			// Check if we have a backend service and get its startup mode
			if (!this.backendService) {
				logger.error(
					"No backend service reference available, cannot update",
					LogFileType.UPDATE_SERVICE,
				);
				if (this.mainWindow) {
					this.mainWindow.webContents.send(
						"backend-update-error",
						"No backend service reference available, cannot update.",
					);
				}
				return false;
			}

			const startupMode = this.backendService.getStartupMode();

			// Handle different startup modes
			switch (startupMode) {
				case LocalOperatorStartupMode.NOT_STARTED:
					logger.info(
						"No python server is available, nothing to update",
						LogFileType.UPDATE_SERVICE,
					);
					if (this.mainWindow) {
						this.mainWindow.webContents.send(
							"backend-update-error",
							"No python server is available, nothing to update.",
						);
					}
					return false;

				case LocalOperatorStartupMode.EXISTING_SERVER:
					// For existing server, we can't manage the update
					logger.info(
						"Cannot manage update for existing server. User must update manually.",
						LogFileType.UPDATE_SERVICE,
					);
					if (this.mainWindow) {
						this.mainWindow.webContents.send("backend-update-manual-required", {
							message:
								"Please update the local-operator package manually using pip.",
							command: "pip install --upgrade local-operator",
						});
					}
					return false;

				case LocalOperatorStartupMode.GLOBAL_INSTALL:
				case LocalOperatorStartupMode.APP_BUNDLED_VENV:
					// Continue with update process for these modes
					break;

				default:
					logger.error(
						`Unknown startup mode: ${startupMode}`,
						LogFileType.UPDATE_SERVICE,
					);
					return false;
			}

			// First, stop the backend service if we have a reference to it
			if (!this.backendService.isUsingExternalBackend()) {
				logger.info(
					"Stopping backend service before update...",
					LogFileType.UPDATE_SERVICE,
				);
				// Set the auto-updating flag to prevent error dialogs during shutdown
				this.backendService.setAutoUpdating(true);
				await this.backendService.stop(true);
				logger.info(
					"Backend service stopped successfully",
					LogFileType.UPDATE_SERVICE,
				);
			}

			// Update the backend using pip
			const execAsync = promisify(exec);
			let pythonPath = "";
			let pipCommand = "";

			// Determine the appropriate Python/pip command based on startup mode
			if (startupMode === LocalOperatorStartupMode.APP_BUNDLED_VENV) {
				// For APP_BUNDLED_VENV, use the bundled Python binary
				try {
					// First try to get Python path from virtual environment path
					if (app.isPackaged) {
						if (process.platform === "darwin") {
							pythonPath = join(
								this.backendService?.getVenvPath(),
								"bin",
								"python3",
							);
						} else if (process.platform === "win32") {
							pythonPath = join(
								this.backendService?.getVenvPath(),
								"Scripts",
								"python.exe",
							);
						} else if (process.platform === "linux") {
							pythonPath = join(
								this.backendService?.getVenvPath(),
								"bin",
								"python3",
							);
						}

						// Check if the Python path exists
						if (pythonPath) {
							logger.info(
								`Using bundled Python at: ${pythonPath}`,
								LogFileType.UPDATE_SERVICE,
							);
							pipCommand = `"${pythonPath}" -m pip install --upgrade local-operator`;
						}
					}
				} catch (error) {
					logger.warn(
						"Error finding bundled Python path:",
						LogFileType.UPDATE_SERVICE,
						error,
					);
					pythonPath = "";
				}
			} else if (startupMode === LocalOperatorStartupMode.GLOBAL_INSTALL) {
				// For GLOBAL_INSTALL, use the system Python that has local-operator installed
				try {
					// Try to find the Python that has local-operator installed
					const { stdout } = await execAsync("which python3 || which python");
					pythonPath = stdout.trim();
					logger.info(
						`Using system Python at: ${pythonPath}`,
						LogFileType.UPDATE_SERVICE,
					);
					pipCommand = `"${pythonPath}" -m pip install --upgrade local-operator`;
				} catch (error) {
					logger.warn(
						"Could not find system Python:",
						LogFileType.UPDATE_SERVICE,
						error,
					);
				}
			}

			// If we couldn't determine a specific pip command, use a fallback
			if (!pipCommand) {
				logger.warn("Using fallback pip command", LogFileType.UPDATE_SERVICE);
				pipCommand = "pip install --upgrade local-operator";
			}

			// Execute the pip command
			logger.info(
				`Executing pip command: ${pipCommand}`,
				LogFileType.UPDATE_SERVICE,
			);
			await execAsync(pipCommand);

			logger.info(
				"Backend package updated successfully via pip",
				LogFileType.UPDATE_SERVICE,
			);

			// Restart the backend service
			logger.info(
				"Restarting backend service after update...",
				LogFileType.UPDATE_SERVICE,
			);

			// Ensure the backend is fully stopped before attempting to restart
			// Wait a bit to ensure any cleanup processes have completed
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Verify the backend is actually stopped
			const isHealthy = await this.checkBackendHealth();
			if (isHealthy) {
				logger.warn(
					"Backend service is still running after stop command, attempting force termination",
					LogFileType.UPDATE_SERVICE,
				);

				// Try force termination
				await this.forceTerminateBackendProcess();

				// Wait again to ensure termination
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}

			// Use the dedicated restart method which properly handles the restart process
			const restartSuccess = await this.backendService.restart();

			if (restartSuccess) {
				logger.info(
					"Backend service restarted successfully after update",
					LogFileType.UPDATE_SERVICE,
				);

				// Reset the auto-updating flag
				this.backendService.setAutoUpdating(false);

				// Verify the backend is actually running after restart
				const isRunningAfterRestart = await this.checkBackendHealth();
				if (!isRunningAfterRestart) {
					logger.error(
						"Backend service reported successful restart but health check failed",
						LogFileType.UPDATE_SERVICE,
					);

					// Try one more time to start the service
					logger.info(
						"Attempting to start backend service again...",
						LogFileType.UPDATE_SERVICE,
					);
					await this.backendService.start();

					// Final health check
					const finalHealthCheck = await this.checkBackendHealth();
					if (!finalHealthCheck) {
						logger.error(
							"Backend service failed to start after multiple attempts",
							LogFileType.UPDATE_SERVICE,
						);
						if (this.mainWindow) {
							this.mainWindow.webContents.send(
								"backend-update-error",
								"Backend was updated but failed to restart properly. Please restart the application.",
							);
						}
						return false;
					}
				}

				// Register the backend service for proper shutdown when app quits
				this.registerBackendShutdown();
			} else {
				logger.error(
					"Failed to restart backend service after update",
					LogFileType.UPDATE_SERVICE,
				);

				// Reset the auto-updating flag even if restart failed
				this.backendService.setAutoUpdating(false);

				if (this.mainWindow) {
					this.mainWindow.webContents.send(
						"backend-update-error",
						"Backend was updated but failed to restart. Please restart the application.",
					);
				}
				return false;
			}

			logger.info(
				"Backend update and restart completed successfully",
				LogFileType.UPDATE_SERVICE,
			);

			if (this.mainWindow) {
				this.mainWindow.webContents.send("backend-update-completed");
			}

			return true;
		} catch (error) {
			logger.error(
				"Error updating backend:",
				LogFileType.UPDATE_SERVICE,
				error,
			);

			// Try to restart the backend service if it was stopped
			if (
				this.backendService &&
				!this.backendService.isUsingExternalBackend()
			) {
				try {
					logger.info(
						"Attempting to restart backend service after update failure...",
						LogFileType.UPDATE_SERVICE,
					);
					await this.backendService.start();
				} catch (restartError) {
					logger.error(
						"Failed to restart backend service after update failure:",
						LogFileType.UPDATE_SERVICE,
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
	 * Check if the backend service is healthy
	 * @returns Promise resolving to true if the backend is healthy, false otherwise
	 */
	private async checkBackendHealth(): Promise<boolean> {
		try {
			// Set a timeout for the fetch request
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

			const response = await fetch(`${this.backendUrl}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			logger.info(
				`Backend health check response status: ${response.status}`,
				LogFileType.UPDATE_SERVICE,
			);

			return response.ok;
		} catch (error) {
			logger.error(
				"Error checking backend health:",
				LogFileType.UPDATE_SERVICE,
				error,
			);
			return false;
		}
	}

	/**
	 * Determines if an update error should be filtered (not shown to the user)
	 * @param err The error object from autoUpdater
	 * @returns True if the error should be filtered, false if it should be shown to the user
	 */
	private shouldFilterUpdateError(err: Error): boolean {
		const errorMessage = err.message || "";
		logger.info(
			`Checking if error should be filtered: ${errorMessage}`,
			LogFileType.UPDATE_SERVICE,
		);

		// Filter errors related to missing latest*.yml files
		if (
			(errorMessage.includes("latest") && errorMessage.includes(".yml")) ||
			errorMessage.includes("Cannot find latest-mac.yml")
		) {
			logger.info(
				"Filtering error: Missing latest*.yml file",
				LogFileType.UPDATE_SERVICE,
			);
			return true;
		}

		// Filter errors related to GitHub releases that don't exist or aren't ready
		if (
			errorMessage.includes("GitHub") &&
			(errorMessage.includes("release") || errorMessage.includes("tag"))
		) {
			logger.info(
				"Filtering error: GitHub release issue",
				LogFileType.UPDATE_SERVICE,
			);
			return true;
		}

		// Filter errors related to beta versions
		if (
			errorMessage.includes("beta") ||
			errorMessage.match(BETA_VERSION_REGEX)
		) {
			logger.info("Filtering error: Beta version", LogFileType.UPDATE_SERVICE);
			return true;
		}

		// Filter network errors that might be temporary
		if (
			errorMessage.includes("ENOTFOUND") ||
			errorMessage.includes("ETIMEDOUT") ||
			errorMessage.includes("ECONNREFUSED") ||
			errorMessage.includes("HttpError: 404")
		) {
			logger.info("Filtering error: Network issue", LogFileType.UPDATE_SERVICE);
			return true;
		}

		// Don't filter other errors
		return false;
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
					LogFileType.UPDATE_SERVICE,
				);
				logger.info(
					`Update executable path: ${updateExe}`,
					LogFileType.UPDATE_SERVICE,
				);

				// Wait a bit before checking for updates to avoid file lock issues
				setTimeout(() => {
					this.checkForUpdates(true);
				}, 10000); // 10 seconds delay

				return;
			}

			// Log Windows update configuration
			logger.info(
				`Windows update configuration: ${exeName} will use ${updateExe} for updates`,
				LogFileType.UPDATE_SERVICE,
			);
		}

		// For macOS, ensure the app is signed
		if (process.platform === "darwin") {
			// macOS requires the app to be signed for auto-updates
			// This is handled by the build process, but we can log it for clarity
			logger.info(
				"macOS auto-update requires app signing",
				LogFileType.UPDATE_SERVICE,
			);
		}
	}
}
