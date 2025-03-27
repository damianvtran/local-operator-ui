/**
 * Backend Service Manager
 *
 * This module is responsible for managing the Local Operator backend service.
 * It handles starting, stopping, and monitoring the health of the backend service.
 */

/**
 * Enum representing the different startup modes for the Local Operator server
 */
export enum LocalOperatorStartupMode {
	/** An existing server was detected, not managed by the backend service */
	EXISTING_SERVER = "EXISTING_SERVER",
	/** Server started using globally installed local-operator entrypoint */
	GLOBAL_INSTALL = "GLOBAL_INSTALL",
	/** Server started from the virtual environment created with bundled python */
	APP_BUNDLED_VENV = "APP_BUNDLED_VENV",
	/** Initial state before server has been started */
	NOT_STARTED = "NOT_STARTED",
}

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
	private startupMode: LocalOperatorStartupMode =
		LocalOperatorStartupMode.NOT_STARTED;
	private port: number;
	private backendUrl: string;
	private appDataPath = app.getPath("userData");
	private venvPath: string;
	private healthCheckInterval: NodeJS.Timeout | null = null;
	private exitPromise: Promise<void> | null = null;
	private exitResolve: (() => void) | null = null;
	private shellEnv: Record<string, string | undefined> = {};
	private isAppClosing = false; // Flag to track when the app is being closed
	private isAutoUpdating = false; // Flag to track when an autoupdate is in progress

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

			// Explicitly check for and add pyenv-win paths
			// These might not be in the current process environment yet if they were just set
			const userProfile = process.env.USERPROFILE || os.homedir();
			const pyenvDir = join(userProfile, ".pyenv");
			const pyenvBinPath = join(pyenvDir, "pyenv-win", "bin");
			const pyenvShimsPath = join(pyenvDir, "pyenv-win", "shims");

			// Check if these directories exist
			if (fs.existsSync(pyenvBinPath) && fs.existsSync(pyenvShimsPath)) {
				logger.info(
					`Found pyenv-win directories at ${pyenvBinPath} and ${pyenvShimsPath}`,
					LogFileType.BACKEND,
				);

				// Add to PATH if not already there
				const currentPath = this.shellEnv.PATH || "";
				if (!currentPath.includes(pyenvBinPath)) {
					this.shellEnv.PATH = `${pyenvBinPath};${currentPath}`;
				}
				if (!currentPath.includes(pyenvShimsPath)) {
					this.shellEnv.PATH = `${pyenvShimsPath};${this.shellEnv.PATH}`;
				}

				// Set PYENV and PYENV_HOME environment variables
				const pyenvWinPath = join(pyenvDir, "pyenv-win");
				this.shellEnv.PYENV = pyenvWinPath;
				this.shellEnv.PYENV_HOME = pyenvWinPath;

				logger.info(
					`Added pyenv-win paths to environment. PATH now includes: ${pyenvBinPath} and ${pyenvShimsPath}`,
					LogFileType.BACKEND,
				);
			} else {
				logger.info(
					`pyenv-win directories not found at ${pyenvBinPath} or ${pyenvShimsPath}`,
					LogFileType.BACKEND,
				);
			}

			// Add the virtual environment Scripts directory to PATH
			// This ensures we can find the local-operator executable
			const venvScriptsPath = join(this.venvPath, "Scripts");
			if (fs.existsSync(venvScriptsPath)) {
				const currentPath = this.shellEnv.PATH || "";
				if (!currentPath.includes(venvScriptsPath)) {
					this.shellEnv.PATH = `${venvScriptsPath};${currentPath}`;
					logger.info(
						`Added virtual environment Scripts directory to PATH: ${venvScriptsPath}`,
						LogFileType.BACKEND,
					);
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
		// Reset the isAppClosing flag when starting the service
		this.isAppClosing = false;

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
			this.startupMode = LocalOperatorStartupMode.EXISTING_SERVER;
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

				// Set startup mode to global install
				this.startupMode = LocalOperatorStartupMode.GLOBAL_INSTALL;

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

				// Set startup mode to app bundled venv
				this.startupMode = LocalOperatorStartupMode.APP_BUNDLED_VENV;

				// Platform-specific activation of virtual environment
				let cmd: string;
				let args: string[];

				if (process.platform === "win32") {
					// Windows - try direct executable first
					const localOperatorExe = join(
						this.venvPath,
						"Scripts",
						"local-operator.exe",
					);
					if (fs.existsSync(localOperatorExe)) {
						cmd = localOperatorExe;
						args = ["serve", "--port", this.port.toString()];
					} else {
						// Fallback to Python module execution
						const pythonExe = join(this.venvPath, "Scripts", "python.exe");
						if (fs.existsSync(pythonExe)) {
							cmd = pythonExe;
							args = [
								"-m",
								"local_operator",
								"serve",
								"--port",
								this.port.toString(),
							];
						} else {
							// Last resort - use PowerShell activation
							const activateScript = join(
								this.venvPath,
								"Scripts",
								"Activate.ps1",
							);
							cmd = "powershell.exe";
							args = [
								"-ExecutionPolicy",
								"Bypass",
								"-Command",
								`"& '${activateScript}'; local-operator serve --port ${this.port}"`,
							];
						}
					}
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
				// Skip showing the dialog if:
				// 1. We're on Windows AND the app is closing AND the exit code is 1 (expected on Windows)
				// 2. OR if the code is 0 or null (normal exit)
				// 3. OR if we're in the middle of an autoupdate operation
				const isExpectedWindowsExit =
					process.platform === "win32" &&
					(this.isAppClosing || this.isAutoUpdating) &&
					code === 1;

				if (code !== 0 && code !== null && !isExpectedWindowsExit) {
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
	 * @param isRestart - Whether this stop is part of a restart operation
	 * @returns Promise resolving when the backend has been stopped
	 */
	async stop(isRestart = false): Promise<void> {
		// Mark that we're closing the app if this is not a restart
		if (!isRestart) {
			this.isAppClosing = true;
		}
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
			logger.info(
				`Stopping backend service... (isRestart: ${isRestart})`,
				LogFileType.BACKEND,
			);

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
				// Store the process ID before attempting to terminate
				const pid = this.process.pid;

				if (process.platform === "win32") {
					// Windows: send CTRL+C signal via taskkill
					if (pid) {
						logger.info(
							`Terminating Windows process with PID ${pid}`,
							LogFileType.BACKEND,
						);
						spawn("taskkill", ["/pid", pid.toString(), "/t"]);
					}
				} else {
					// Unix: send SIGTERM
					logger.info(
						"Sending SIGTERM to backend process",
						LogFileType.BACKEND,
					);
					this.process.kill("SIGTERM");
				}

				// Create a variable to store the timeout ID so we can clear it if needed
				let forceKillTimeoutId: NodeJS.Timeout | null = null;

				// Wait for process to exit with timeout
				const timeoutPromise = new Promise<void>((resolve) => {
					forceKillTimeoutId = setTimeout(
						() => {
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

										// Also try to kill any child processes by process name
										try {
											// Use taskkill to find and kill python processes that might be running the backend
											execPromise(
												'taskkill /f /im python.exe /fi "WINDOWTITLE eq *local-operator*" /t',
											).catch((error) => {
												logger.warn(
													"Error terminating python processes:",
													LogFileType.BACKEND,
													error,
												);
											});

											// Also try to kill any local-operator.exe processes directly
											execPromise(
												"taskkill /f /im local-operator.exe /t",
											).catch((error) => {
												logger.warn(
													"Error terminating local-operator processes:",
													LogFileType.BACKEND,
													error,
												);
											});
										} catch (taskkillError) {
											logger.warn(
												"Error executing taskkill command:",
												LogFileType.BACKEND,
												taskkillError,
											);
										}
									} else if (this.process) {
										// On Unix, use SIGKILL
										this.process.kill("SIGKILL");

										// Also try to kill any processes with the same command line pattern
										try {
											execPromise('pkill -f "local-operator serve"').catch(
												(error) => {
													logger.warn(
														"Error killing processes by pattern:",
														LogFileType.BACKEND,
														error,
													);
												},
											);
										} catch (pkillError) {
											logger.warn(
												"Error executing pkill command:",
												LogFileType.BACKEND,
												pkillError,
											);
										}
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
						},
						isRestart ? 10000 : 5000,
					); // Use longer timeout for restart operations, but not too long
				});

				// Wait for either the process to exit or the timeout
				await Promise.race([this.exitPromise, timeoutPromise]);

				// Clear the timeout if it's still active
				if (forceKillTimeoutId) {
					clearTimeout(forceKillTimeoutId);
					forceKillTimeoutId = null;
				}

				// For final shutdowns (not restarts), perform additional cleanup to ensure all related processes are terminated
				if (!isRestart) {
					logger.info(
						"Performing additional cleanup for final shutdown",
						LogFileType.BACKEND,
					);

					try {
						if (process.platform === "win32") {
							// On Windows, use taskkill to find and kill python and local-operator processes
							await execPromise(
								'taskkill /f /im python.exe /fi "WINDOWTITLE eq *local-operator*" /t',
							).catch(() => {
								// Ignore errors, this is a best-effort cleanup
							});

							await execPromise("taskkill /f /im local-operator.exe /t").catch(
								() => {
									// Ignore errors, this is a best-effort cleanup
								},
							);
						} else {
							// On Unix systems, look for processes with "local-operator serve" in the command line
							await execPromise('pkill -f "local-operator serve"').catch(() => {
								// Ignore errors, this is a best-effort cleanup
							});

							// Give processes a moment to terminate gracefully before force killing
							await new Promise((resolve) => setTimeout(resolve, 1000));

							// Force kill any remaining processes
							await execPromise('pkill -9 -f "local-operator serve"').catch(
								() => {
									// Ignore errors, this is a best-effort cleanup
								},
							);
						}
					} catch (cleanupError) {
						logger.warn(
							"Error during additional cleanup (this may be normal if processes were already terminated):",
							LogFileType.BACKEND,
							cleanupError,
						);
					}
				}
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

	/**
	 * Get the startup mode of the Local Operator server
	 * @returns The current startup mode
	 */
	getStartupMode(): LocalOperatorStartupMode {
		return this.startupMode;
	}

	/**
	 * Get the virtual environment path used by the backend service
	 * @returns The path to the virtual environment
	 */
	getVenvPath(): string {
		return this.venvPath;
	}

	/**
	 * Check if the backend service is auto-updating
	 * @returns True if auto-updating, false otherwise
	 */
	checkIsAutoUpdating(): boolean {
		return this.isAutoUpdating;
	}

	/**
	 * Set the auto-updating flag
	 * @param isAutoUpdating True if auto-updating, false otherwise
	 */
	setAutoUpdating(isAutoUpdating: boolean): void {
		this.isAutoUpdating = isAutoUpdating;
	}

	/**
	 * Restart the backend service
	 * This method properly handles the restart process to ensure that any pending
	 * timeouts from the stop operation don't affect the newly started process
	 * @returns Promise resolving to true if the restart was successful, false otherwise
	 */
	async restart(): Promise<boolean> {
		logger.info("Restarting backend service...", LogFileType.BACKEND);

		// Reset the isAppClosing flag since we're restarting, not closing
		this.isAppClosing = false;

		// Stop the service with the isRestart flag to use a longer timeout
		await this.stop(true);

		// Wait a bit to ensure any cleanup processes have completed
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// Verify the process is actually stopped
		if (this.process) {
			logger.warn(
				"Process still exists after stop, attempting to force terminate",
				LogFileType.BACKEND,
			);

			// Force terminate the process
			try {
				if (process.platform === "win32" && this.process.pid) {
					// On Windows, use taskkill with /F for force
					await promisify(exec)(`taskkill /pid ${this.process.pid} /f /t`);
				} else if (this.process) {
					// On Unix, use SIGKILL
					this.process.kill("SIGKILL");
				}

				// Wait for the process to exit
				await new Promise((resolve) => {
					if (!this.process) {
						resolve(null);
						return;
					}

					this.process.once("exit", () => {
						resolve(null);
					});

					// Timeout in case the process doesn't exit
					setTimeout(resolve, 1000);
				});

				// Clear the process reference
				this.process = null;
				this.isRunning = false;
			} catch (error) {
				logger.error(
					"Error force killing process during restart:",
					LogFileType.BACKEND,
					error,
				);
			}
		}

		// Start the service again
		const success = await this.start();

		if (success) {
			logger.info(
				"Backend service restarted successfully",
				LogFileType.BACKEND,
			);
		} else {
			logger.error("Failed to restart backend service", LogFileType.BACKEND);
		}

		return success;
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
