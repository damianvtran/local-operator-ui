/**
 * Backend Service Manager
 *
 * This module is responsible for managing the Local Operator backend service.
 * It handles starting, stopping, and monitoring the health of the backend service.
 */

import { type ChildProcess, exec, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { app, dialog as electronDialog } from "electron";
import { backendConfig } from "./config";
import { LogFileType, logger } from "./logger";

const execPromise = promisify(exec);

/**
 * Backend Service Manager class
 * Manages the Local Operator backend service
 */
export class BackendServiceManager {
	private process: ChildProcess | null = null;
	private isRunning = false;
	private isExternalBackend = false;
	private isDisabled = backendConfig.VITE_DISABLE_BACKEND_MANAGER === "true";
	private port: number;
	private backendUrl: string;
	private appDataPath = app.getPath("userData");
	private venvPath: string;
	private healthCheckInterval: NodeJS.Timeout | null = null;
	private exitPromise: Promise<void> | null = null;
	private exitResolve: (() => void) | null = null;
	private shellEnv: Record<string, string | undefined> = {};

	/**
	 * Constructor
	 */
	constructor() {
		// Extract port from API URL
		try {
			const apiUrl = new URL(backendConfig.VITE_LOCAL_OPERATOR_API_URL);
			this.port = Number.parseInt(apiUrl.port, 10) || 1111; // Default to 1111 if port is not specified

			// Use explicit IPv4 address instead of localhost for better compatibility
			this.backendUrl = `http://127.0.0.1:${this.port}`;

			logger.info(
				`Backend service configured with port ${this.port} and URL ${this.backendUrl}`,
				LogFileType.BACKEND,
			);
		} catch (error) {
			// Fallback to default values if URL parsing fails
			this.port = 1111;
			this.backendUrl = `http://127.0.0.1:${this.port}`;

			logger.error(
				`Error parsing API URL, using default port ${this.port}`,
				LogFileType.BACKEND,
				error,
			);
		}

		// Set platform-specific virtual environment path
		if (process.platform === "win32") {
			this.venvPath = join(this.appDataPath, "local-operator-venv");
		} else if (process.platform === "darwin") {
			this.venvPath = join(
				app.getPath("home"),
				"Library",
				"Application Support",
				"Local Operator",
				"local-operator-venv",
			);
		} else {
			// Linux
			this.venvPath = join(
				app.getPath("home"),
				".config",
				"local-operator",
				"local-operator-venv",
			);
		}

		// Load shell environment variables
		this.loadShellEnvironment();

		// Log initialization status
		logger.info(
			`Backend Service Manager initialized. Disabled: ${this.isDisabled}`,
			LogFileType.BACKEND,
		);
		logger.info(
			`Virtual environment path: ${this.venvPath}`,
			LogFileType.BACKEND,
		);
	}

	/**
	 * Load shell environment variables from user's shell configuration files
	 * This ensures that programs like gh and brew that are in the PATH are available to the backend service
	 */
	private async loadShellEnvironment(): Promise<void> {
		try {
			// Start with current process environment
			this.shellEnv = { ...process.env };

			// Platform-specific shell environment loading
			if (process.platform === "darwin") {
				// macOS: Source .zshrc or .bash_profile
				await this.loadMacOSEnvironment();
			} else if (process.platform === "linux") {
				// Linux: Source .bashrc or .zshrc
				await this.loadLinuxEnvironment();
			} else if (process.platform === "win32") {
				// Windows: Load from registry and user profile
				await this.loadWindowsEnvironment();
			} else {
				logger.error(
					"Unsupported platform for shell environment loading",
					LogFileType.BACKEND,
				);
			}

			// Log the PATH environment variable to verify it's loaded correctly
			logger.info(
				`Shell environment variables loaded successfully. PATH: ${this.shellEnv.PATH || this.shellEnv.Path || "(not set)"}`,
				LogFileType.BACKEND,
			);
		} catch (error) {
			logger.error(
				"Error loading shell environment variables:",
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * Load environment variables from macOS shell configuration files
	 */
	private async loadMacOSEnvironment(): Promise<void> {
		const home = os.homedir();
		const possibleFiles = [
			join(home, ".zshrc"),
			join(home, ".bash_profile"),
			join(home, ".bashrc"),
			join(home, ".profile"),
		];

		// Find the first shell config file that exists
		let shellConfigFile: string | null = null;
		for (const file of possibleFiles) {
			if (fs.existsSync(file)) {
				shellConfigFile = file;
				break;
			}
		}

		if (!shellConfigFile) {
			logger.info(
				"No shell configuration file found on macOS",
				LogFileType.BACKEND,
			);
			return;
		}

		try {
			// Execute a command that sources the shell config file and prints the environment
			const { stdout } = await execPromise(
				`source "${shellConfigFile}" && env`,
				{ shell: "/bin/bash" },
			);

			// Parse the environment variables
			const envVars = stdout.split("\n");
			for (const line of envVars) {
				const match = line.match(/^([^=]+)=(.*)$/);
				if (match) {
					const [, key, value] = match;
					this.shellEnv[key] = value;
				}
			}

			logger.info(
				`Loaded environment variables from ${shellConfigFile}`,
				LogFileType.BACKEND,
			);
		} catch (error) {
			logger.error(
				`Error loading environment from ${shellConfigFile}:`,
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * Load environment variables from Linux shell configuration files
	 */
	private async loadLinuxEnvironment(): Promise<void> {
		const home = os.homedir();
		const possibleFiles = [
			join(home, ".bashrc"),
			join(home, ".zshrc"),
			join(home, ".profile"),
		];

		// Find the first shell config file that exists
		let shellConfigFile: string | null = null;
		for (const file of possibleFiles) {
			if (fs.existsSync(file)) {
				shellConfigFile = file;
				break;
			}
		}

		if (!shellConfigFile) {
			logger.info(
				"No shell configuration file found on Linux",
				LogFileType.BACKEND,
			);
			return;
		}

		try {
			// Execute a command that sources the shell config file and prints the environment
			const { stdout } = await execPromise(
				`bash -c "source \\"${shellConfigFile}\\" && env"`,
				{ shell: "/bin/bash" },
			);

			// Parse the environment variables
			const envVars = stdout.split("\n");
			for (const line of envVars) {
				const match = line.match(/^([^=]+)=(.*)$/);
				if (match) {
					const [, key, value] = match;
					this.shellEnv[key] = value;
				}
			}

			logger.info(
				`Loaded environment variables from ${shellConfigFile}`,
				LogFileType.BACKEND,
			);
		} catch (error) {
			logger.error(
				`Error loading environment from ${shellConfigFile}:`,
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * Load environment variables from Windows user profile
	 */
	private async loadWindowsEnvironment(): Promise<void> {
		try {
			// On Windows, we can use the 'set' command to get environment variables
			const { stdout } = await execPromise("set", { shell: "cmd.exe" });

			// Parse the environment variables
			const envVars = stdout.split("\r\n");
			for (const line of envVars) {
				const match = line.match(/^([^=]+)=(.*)$/);
				if (match) {
					const [, key, value] = match;
					this.shellEnv[key] = value;
				}
			}

			logger.info(
				"Loaded environment variables from Windows user profile",
				LogFileType.BACKEND,
			);
		} catch (error) {
			logger.error(
				"Error loading environment from Windows user profile:",
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * Check if the local-operator command exists globally
	 * @returns Promise resolving to true if the command exists, false otherwise
	 */
	async checkLocalOperatorExists(): Promise<boolean> {
		try {
			const command =
				process.platform === "win32"
					? "where local-operator"
					: "which local-operator";

			logger.info(
				`Checking if local-operator command exists: ${command}`,
				LogFileType.BACKEND,
			);

			const { stdout } = await execPromise(command);

			if (stdout.trim()) {
				logger.info(
					`local-operator command found at: ${stdout.trim()}`,
					LogFileType.BACKEND,
				);
				return true;
			}
		} catch (error) {
			logger.info(
				"local-operator command not found globally",
				LogFileType.BACKEND,
			);
		}

		return false;
	}

	/**
	 * Check if an external backend is already running
	 * @returns Promise resolving to true if an external backend is running, false otherwise
	 */
	async checkExistingBackend(): Promise<boolean> {
		if (this.isDisabled) {
			logger.info(
				"Backend Service Manager is disabled. Assuming external backend is available.",
				LogFileType.BACKEND,
			);
			return true;
		}

		try {
			logger.info(
				`Checking for external backend at ${this.backendUrl}/health`,
				LogFileType.BACKEND,
			);

			// Set a shorter timeout for the fetch request
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

			const response = await fetch(`${this.backendUrl}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			logger.info(
				`External backend health check response status: ${response.status}`,
				LogFileType.BACKEND,
			);

			if (response.ok) {
				logger.info(
					"External backend detected and healthy",
					LogFileType.BACKEND,
				);
				this.isExternalBackend = true;
				return true;
			}
		} catch (error) {
			// Try alternative URL with localhost if the first attempt failed
			try {
				if (this.backendUrl.includes("127.0.0.1")) {
					const altUrl = "http://localhost:1111";
					logger.info(
						`Trying alternative URL: ${altUrl}/health`,
						LogFileType.BACKEND,
					);

					const controller = new AbortController();
					const timeoutId = setTimeout(() => controller.abort(), 5000);

					const response = await fetch(`${altUrl}/health`, {
						method: "GET",
						headers: { Accept: "application/json" },
						signal: controller.signal,
					});

					clearTimeout(timeoutId);

					logger.info(
						`Alternative URL health check response status: ${response.status}`,
						LogFileType.BACKEND,
					);

					if (response.ok) {
						// Update the URL for future requests
						this.backendUrl = altUrl;
						logger.info(
							"External backend detected and healthy using alternative URL",
							LogFileType.BACKEND,
						);
						this.isExternalBackend = true;
						return true;
					}
				}
			} catch (altError) {
				logger.error(
					"Error checking alternative backend URL:",
					LogFileType.BACKEND,
					altError,
				);
			}

			logger.error(
				"Error checking external backend:",
				LogFileType.BACKEND,
				error,
			);
			logger.info(
				"No external backend detected or backend is not healthy",
				LogFileType.BACKEND,
			);
		}

		return false;
	}

	/**
	 * Start the backend service
	 * @returns Promise resolving to true if the backend was started successfully, false otherwise
	 */
	async start(): Promise<boolean> {
		if (this.isDisabled) {
			logger.info(
				"Backend Service Manager is disabled. Skipping backend start.",
				LogFileType.BACKEND,
			);
			return true;
		}

		// First check if an external backend is already running
		if (await this.checkExistingBackend()) {
			this.isRunning = true;
			this.startHealthCheck();
			return true;
		}

		// No external backend, start our own
		try {
			// Check if local-operator command exists globally
			if (await this.checkLocalOperatorExists()) {
				logger.info(
					"Using globally installed local-operator command",
					LogFileType.BACKEND,
				);

				// Run local-operator serve directly
				const cmd = process.platform === "win32" ? "cmd.exe" : "bash";
				const args =
					process.platform === "win32"
						? ["/c", `local-operator serve --port ${this.port}`]
						: ["-c", `local-operator serve --port ${this.port}`];

				logger.info(
					`Starting backend service with global command: ${cmd} ${args.join(" ")}`,
					LogFileType.BACKEND,
				);

				// Create the process with proper options to ensure it terminates with the parent
				this.process = spawn(cmd, args, {
					detached: false, // Ensure process is not detached from parent
					stdio: "pipe",
					env: this.shellEnv, // Use shell environment variables
					// On Windows, we need to create a new process group to ensure proper termination
					...(process.platform === "win32" ? { windowsHide: true } : {}),
				});
			} else {
				// Local-operator not found globally, use virtual environment
				logger.info(
					"Global local-operator not found, using virtual environment",
					LogFileType.BACKEND,
				);

				// Platform-specific activation of virtual environment
				let cmd: string;
				let args: string[];

				if (process.platform === "win32") {
					const activateScript = join(this.venvPath, "Scripts", "activate.bat");
					cmd = "cmd.exe";
					args = [
						"/c",
						`"${activateScript}" && local-operator serve --port ${this.port}`,
					];
				} else {
					// macOS or Linux
					const activateScript = join(this.venvPath, "bin", "activate");
					cmd = "bash";
					args = [
						"-c",
						`. "${activateScript}" && local-operator serve --port ${this.port}`,
					];
				}

				logger.info(
					`Starting backend service with venv: ${cmd} ${args.join(" ")}`,
					LogFileType.BACKEND,
				);

				// Create the process with proper options to ensure it terminates with the parent
				this.process = spawn(cmd, args, {
					detached: false, // Ensure process is not detached from parent
					stdio: "pipe",
					env: this.shellEnv, // Use shell environment variables
					// On Windows, we need to create a new process group to ensure proper termination
					...(process.platform === "win32" ? { windowsHide: true } : {}),
				});
			}

			// Log output
			if (this.process.stdout) {
				this.process.stdout.on("data", (data) => {
					logger.info(`Backend stdout: ${data}`, LogFileType.BACKEND);
				});
			}

			if (this.process.stderr) {
				this.process.stderr.on("data", (data) => {
					logger.error(`Backend stderr: ${data}`, LogFileType.BACKEND);
				});
			}

			// Handle process exit
			this.process.on("exit", (code) => {
				logger.info(
					`Backend process exited with code ${code}`,
					LogFileType.BACKEND,
				);
				this.isRunning = false;
				this.process = null;

				// Resolve the exit promise if it exists
				if (this.exitResolve) {
					this.exitResolve();
					this.exitResolve = null;
				}

				// Show error dialog if the process exited unexpectedly
				if (code !== 0 && code !== null) {
					electronDialog.showErrorBox(
						"Backend Error",
						`The Local Operator backend service exited unexpectedly with code ${code}. Please restart the application.`,
					);
				}
			});

			// Wait for backend to be healthy
			let attempts = 0;
			const maxAttempts = 30; // 30 seconds timeout

			while (attempts < maxAttempts) {
				if (await this.checkHealth()) {
					this.isRunning = true;
					this.startHealthCheck();
					return true;
				}

				// Wait 1 second before next attempt
				await new Promise((resolve) => setTimeout(resolve, 1000));
				attempts++;
			}

			logger.error(
				"Failed to start backend service after multiple attempts",
				LogFileType.BACKEND,
			);

			// Show error dialog
			electronDialog.showErrorBox(
				"Backend Error",
				"Failed to start the Local Operator backend service. Please check the logs for more information.",
			);

			return false;
		} catch (error) {
			logger.error(
				"Error starting backend service:",
				LogFileType.BACKEND,
				error,
			);

			// Show error dialog
			electronDialog.showErrorBox(
				"Backend Error",
				`Error starting the Local Operator backend service: ${error}`,
			);

			return false;
		}
	}

	/**
	 * Stop the backend service
	 * @returns Promise resolving when the backend has been stopped
	 */
	async stop(): Promise<void> {
		// Stop health check
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
			this.healthCheckInterval = null;
		}

		if (this.isDisabled || this.isExternalBackend) {
			logger.info(
				"Skipping backend stop (disabled or external backend)",
				LogFileType.BACKEND,
			);
			return;
		}

		if (this.process && this.isRunning) {
			logger.info("Stopping backend service...", LogFileType.BACKEND);

			// Create a promise that resolves when the process exits
			// Store this promise so it can be awaited from outside
			this.exitPromise = new Promise<void>((resolve) => {
				this.exitResolve = resolve;

				if (!this.process) {
					if (this.exitResolve) {
						this.exitResolve();
						this.exitResolve = null;
					}
					return;
				}

				this.process.once("exit", () => {
					logger.info("Backend process exited", LogFileType.BACKEND);
					this.process = null;
					this.isRunning = false;

					// Resolve the exit promise
					if (this.exitResolve) {
						this.exitResolve();
						this.exitResolve = null;
					}
				});
			});

			// Gracefully terminate the process
			try {
				if (process.platform === "win32") {
					// Windows: send CTRL+C signal via taskkill
					if (this.process.pid) {
						logger.info(
							`Terminating Windows process with PID ${this.process.pid}`,
							LogFileType.BACKEND,
						);
						spawn("taskkill", [
							"/pid",
							this.process.pid.toString(),
							"/f",
							"/t",
						]);
					}
				} else {
					// Unix: send SIGTERM
					logger.info(
						"Sending SIGTERM to backend process",
						LogFileType.BACKEND,
					);
					this.process.kill("SIGTERM");
				}

				// Wait for process to exit with timeout
				const timeoutPromise = new Promise<void>((resolve) => {
					setTimeout(() => {
						if (this.process) {
							logger.info(
								"Backend process did not exit in time, force killing",
								LogFileType.BACKEND,
							);
							try {
								// Force kill the process
								if (process.platform === "win32" && this.process.pid) {
									// On Windows, use taskkill with /F for force
									spawn("taskkill", [
										"/pid",
										this.process.pid.toString(),
										"/f",
										"/t",
									]);
								} else if (this.process) {
									// On Unix, use SIGKILL
									this.process.kill("SIGKILL");
								}
							} catch (error) {
								logger.error(
									"Error force killing process:",
									LogFileType.BACKEND,
									error,
								);
							}

							// Even if force kill fails, mark process as stopped
							this.process = null;
							this.isRunning = false;

							// Resolve the exit promise
							if (this.exitResolve) {
								this.exitResolve();
								this.exitResolve = null;
							}
						}
						resolve();
					}, 5000); // Increased timeout to 5 seconds to give more time for graceful exit
				});

				// Wait for either the process to exit or the timeout
				await Promise.race([this.exitPromise, timeoutPromise]);
			} catch (error) {
				logger.error(
					"Error stopping backend process:",
					LogFileType.BACKEND,
					error,
				);
				// Ensure process is marked as stopped even if there was an error
				this.process = null;
				this.isRunning = false;

				// Resolve the exit promise
				if (this.exitResolve) {
					this.exitResolve();
					this.exitResolve = null;
				}
			}

			logger.info("Backend service stopped", LogFileType.BACKEND);
		}
	}

	/**
	 * Check if backend is healthy
	 * @returns Promise resolving to true if the backend is healthy, false otherwise
	 */
	async checkHealth(): Promise<boolean> {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 3000);

			const response = await fetch(`${this.backendUrl}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			logger.info(
				`Backend health check response status: ${response.status}`,
				LogFileType.BACKEND,
			);

			return response.ok;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Start health check interval
	 * Periodically checks the health of the backend service
	 */
	private startHealthCheck(): void {
		// Clear existing interval if any
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
		}

		// Start new interval
		this.healthCheckInterval = setInterval(async () => {
			const isHealthy = await this.checkHealth();

			if (!isHealthy) {
				logger.info("Backend health check failed", LogFileType.BACKEND);

				if (this.isExternalBackend) {
					// External backend is no longer healthy
					this.isExternalBackend = false;
					this.isRunning = false;

					// Try to start our own backend
					await this.start();
				} else if (this.process) {
					// Our backend is no longer healthy, try to restart it
					await this.stop();
					await this.start();
				}
			}
		}, 30000); // Check every 30 seconds
	}

	/**
	 * Get the port number used by the backend service
	 * @returns The port number
	 */
	getPort(): number {
		return this.port;
	}

	/**
	 * Check if the backend service is using an external backend
	 * @returns True if using an external backend, false if we started our own
	 */
	isUsingExternalBackend(): boolean {
		return this.isExternalBackend;
	}
}

/**
 * Helper function to show error dialog
 * @param title Dialog title
 * @param message Dialog message
 */
export function showErrorDialog(title: string, message: string): void {
	electronDialog.showErrorBox(title, message);
}
