/**
 * Backend Service Manager
 *
 * This module is responsible for managing the Local Operator backend service.
 * It handles starting, stopping, and monitoring the health of the backend service.
 */

import { spawn, type ChildProcess, exec } from "node:child_process";
import { join } from "node:path";
import { app, dialog as electronDialog } from "electron";
import { promisify } from "node:util";

const execPromise = promisify(exec);

/**
 * Backend Service Manager class
 * Manages the Local Operator backend service
 */
export class BackendServiceManager {
	private process: ChildProcess | null = null;
	private isRunning = false;
	private isExternalBackend = false;
	private isDisabled = process.env.VITE_DISABLE_BACKEND_MANAGER === "true";
	private port = 1111;
	private backendUrl = `http://127.0.0.1:${this.port}`; // Use explicit IPv4 address instead of localhost
	private appDataPath = app.getPath("userData");
	private venvPath: string;
	private healthCheckInterval: NodeJS.Timeout | null = null;
	private exitPromise: Promise<void> | null = null;
	private exitResolve: (() => void) | null = null;

	/**
	 * Constructor
	 */
	constructor() {
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

		// Log initialization status
		console.log(
			`Backend Service Manager initialized. Disabled: ${this.isDisabled}`,
		);
		console.log(`Virtual environment path: ${this.venvPath}`);
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

			console.log(`Checking if local-operator command exists: ${command}`);

			const { stdout } = await execPromise(command);

			if (stdout.trim()) {
				console.log(`local-operator command found at: ${stdout.trim()}`);
				return true;
			}
		} catch (error) {
			console.log("local-operator command not found globally");
		}

		return false;
	}

	/**
	 * Check if an external backend is already running
	 * @returns Promise resolving to true if an external backend is running, false otherwise
	 */
	async checkExistingBackend(): Promise<boolean> {
		if (this.isDisabled) {
			console.log(
				"Backend Service Manager is disabled. Assuming external backend is available.",
			);
			return true;
		}

		try {
			console.log(`Checking for external backend at ${this.backendUrl}/health`);

			// Set a shorter timeout for the fetch request
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

			const response = await fetch(`${this.backendUrl}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			console.log(
				`External backend health check response status: ${response.status}`,
			);

			if (response.ok) {
				console.log("External backend detected and healthy");
				this.isExternalBackend = true;
				return true;
			}
		} catch (error) {
			// Try alternative URL with localhost if the first attempt failed
			try {
				if (this.backendUrl.includes("127.0.0.1")) {
					const altUrl = "http://localhost:1111";
					console.log(`Trying alternative URL: ${altUrl}/health`);

					const controller = new AbortController();
					const timeoutId = setTimeout(() => controller.abort(), 5000);

					const response = await fetch(`${altUrl}/health`, {
						method: "GET",
						headers: { Accept: "application/json" },
						signal: controller.signal,
					});

					clearTimeout(timeoutId);

					console.log(
						`Alternative URL health check response status: ${response.status}`,
					);

					if (response.ok) {
						// Update the URL for future requests
						this.backendUrl = altUrl;
						console.log(
							"External backend detected and healthy using alternative URL",
						);
						this.isExternalBackend = true;
						return true;
					}
				}
			} catch (altError) {
				console.error("Error checking alternative backend URL:", altError);
			}

			console.error("Error checking external backend:", error);
			console.log("No external backend detected or backend is not healthy");
		}

		return false;
	}

	/**
	 * Start the backend service
	 * @returns Promise resolving to true if the backend was started successfully, false otherwise
	 */
	async start(): Promise<boolean> {
		if (this.isDisabled) {
			console.log(
				"Backend Service Manager is disabled. Skipping backend start.",
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
				console.log("Using globally installed local-operator command");

				// Run local-operator serve directly
				const cmd = process.platform === "win32" ? "cmd.exe" : "bash";
				const args =
					process.platform === "win32"
						? ["/c", `local-operator serve --port ${this.port}`]
						: ["-c", `local-operator serve --port ${this.port}`];

				console.log(
					`Starting backend service with global command: ${cmd} ${args.join(" ")}`,
				);

				// Create the process with proper options to ensure it terminates with the parent
				this.process = spawn(cmd, args, {
					detached: false, // Ensure process is not detached from parent
					stdio: "pipe",
					// On Windows, we need to create a new process group to ensure proper termination
					...(process.platform === "win32" ? { windowsHide: true } : {}),
				});
			} else {
				// Local-operator not found globally, use virtual environment
				console.log(
					"Global local-operator not found, using virtual environment",
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

				console.log(
					`Starting backend service with venv: ${cmd} ${args.join(" ")}`,
				);

				// Create the process with proper options to ensure it terminates with the parent
				this.process = spawn(cmd, args, {
					detached: false, // Ensure process is not detached from parent
					stdio: "pipe",
					// On Windows, we need to create a new process group to ensure proper termination
					...(process.platform === "win32" ? { windowsHide: true } : {}),
				});
			}

			// Log output
			if (this.process.stdout) {
				this.process.stdout.on("data", (data) => {
					console.log(`Backend stdout: ${data}`);
				});
			}

			if (this.process.stderr) {
				this.process.stderr.on("data", (data) => {
					console.error(`Backend stderr: ${data}`);
				});
			}

			// Handle process exit
			this.process.on("exit", (code) => {
				console.log(`Backend process exited with code ${code}`);
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

			console.error("Failed to start backend service after multiple attempts");

			// Show error dialog
			electronDialog.showErrorBox(
				"Backend Error",
				"Failed to start the Local Operator backend service. Please check the logs for more information.",
			);

			return false;
		} catch (error) {
			console.error("Error starting backend service:", error);

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
			console.log("Skipping backend stop (disabled or external backend)");
			return;
		}

		if (this.process && this.isRunning) {
			console.log("Stopping backend service...");

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
					console.log("Backend process exited");
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
						console.log(
							`Terminating Windows process with PID ${this.process.pid}`,
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
					console.log("Sending SIGTERM to backend process");
					this.process.kill("SIGTERM");
				}

				// Wait for process to exit with timeout
				const timeoutPromise = new Promise<void>((resolve) => {
					setTimeout(() => {
						if (this.process) {
							console.log(
								"Backend process did not exit in time, force killing",
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
								console.error("Error force killing process:", error);
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
				console.error("Error stopping backend process:", error);
				// Ensure process is marked as stopped even if there was an error
				this.process = null;
				this.isRunning = false;

				// Resolve the exit promise
				if (this.exitResolve) {
					this.exitResolve();
					this.exitResolve = null;
				}
			}

			console.log("Backend service stopped");
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

			console.log(`Backend health check response status: ${response.status}`);

			return response.ok;
		} catch (error) {
			console.error("Health check failed:", error);
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
				console.log("Backend health check failed");

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
