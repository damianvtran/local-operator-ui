/**
 * Backend Installer
 *
 * This module is responsible for installing the Local Operator backend.
 * It handles checking if the backend is installed and installing it if needed.
 * Includes crash logging to a persistent location.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { BrowserWindow, app, dialog as electronDialog } from "electron";
import { LogFileType, logger } from "./logger";
import {
	linuxInstallScript,
	macosInstallScript,
	windowsInstallScript,
} from "./scripts";

/**
 * Backend Installer class
 * Manages the installation of the Local Operator backend
 */
export class BackendInstaller {
	private appDataPath = app.getPath("userData");
	private venvPath: string;
	private resourcesPath: string;
	private pythonPath: string | null = null;

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

		// Set resources path
		this.resourcesPath =
			process.env.NODE_ENV === "development"
				? join(process.cwd(), "resources")
				: join(process.resourcesPath);

		// Find Python executable
		this.pythonPath = this.findPython();

		logger.info(
			`Backend Installer initialized. Virtual environment path: ${this.venvPath}`,
			LogFileType.INSTALLER,
		);
		logger.info(`Resources path: ${this.resourcesPath}`, LogFileType.INSTALLER);
		logger.info(
			`Python path: ${this.pythonPath || "Not found"}`,
			LogFileType.INSTALLER,
		);
	}

	/**
	 * Find Python executable
	 * @returns Path to Python executable or null if not found
	 */
	private findPython(): string | null {
		const possibilities = [
			// In packaged app (standalone Python)
			join(process.resourcesPath, "python", "bin", "python3"),
			// In development (standalone Python)
			join(process.cwd(), "resources", "python", "bin", "python3"),
		];

		// Add Windows-specific paths
		if (process.platform === "win32") {
			const userProfile = process.env.USERPROFILE || app.getPath("home");
			const pyenvDir = join(userProfile, ".pyenv");

			possibilities.push(
				// In packaged app (Windows)
				join(process.resourcesPath, "python", "python.exe"),
				// In development (Windows)
				join(process.cwd(), "resources", "python", "python.exe"),
				// Check for pyenv-win Python
				join(pyenvDir, "pyenv-win", "versions", "3.12.0", "python.exe"),
				// Check for pyenv-win shims
				join(pyenvDir, "pyenv-win", "shims", "python.exe"),
			);
		}

		for (const path of possibilities) {
			if (fs.existsSync(path)) {
				logger.info(`Found Python at ${path}`, LogFileType.INSTALLER);
				return path;
			}
		}

		logger.warn(
			`Could not find Python, checked: ${possibilities.join(", ")}`,
			LogFileType.INSTALLER,
		);
		return null;
	}

	/**
	 * Check if backend is installed
	 * @returns Promise resolving to true if the backend is installed, false otherwise
	 */
	async isInstalled(): Promise<boolean> {
		try {
			// Check if virtual environment exists
			if (!fs.existsSync(this.venvPath)) {
				logger.info(
					`Virtual environment not found at ${this.venvPath}`,
					LogFileType.INSTALLER,
				);
				return false;
			}

			// Check if local-operator is installed in the virtual environment
			const localOperatorPath =
				process.platform === "win32"
					? join(this.venvPath, "Scripts", "local-operator.exe")
					: join(this.venvPath, "bin", "local-operator");

			if (!fs.existsSync(localOperatorPath)) {
				logger.info(
					`local-operator executable not found at ${localOperatorPath}`,
					LogFileType.INSTALLER,
				);
				return false;
			}

			logger.info("Backend is installed", LogFileType.INSTALLER);
			return true;
		} catch (error) {
			logger.error(
				"Error checking if backend is installed:",
				LogFileType.INSTALLER,
				error,
			);
			return false;
		}
	}

	/**
	 * Install backend
	 * @returns Promise resolving to true if the backend was installed successfully, false otherwise
	 */
	async install(): Promise<boolean> {
		try {
			// Show installation dialog
			const { response } = await electronDialog.showMessageBox({
				type: "info",
				title: "First-Time Setup Required",
				message:
					"🚀 Local Operator needs to set up some components to work properly. This one-time process will take just a few moments.",
				buttons: ["Set Up Now", "Cancel"],
				defaultId: 0,
				cancelId: 1,
			});

			if (response === 1) {
				// User cancelled installation
				logger.info(
					"User cancelled backend installation",
					LogFileType.INSTALLER,
				);
				// Exit the app when installation is cancelled
				setTimeout(() => {
					app.exit(0);
				}, 500);
				return false;
			}

			// Create temporary script file based on platform
			let scriptPath: string;
			let cmd: string;
			let args: string[];
			const tempDir = tmpdir();

			// Set platform-specific script and command
			if (process.platform === "win32") {
				scriptPath = join(tempDir, "install-backend-windows.ps1");
				writeFileSync(scriptPath, windowsInstallScript);
				cmd = "powershell.exe";
				args = ["-ExecutionPolicy", "Bypass", "-File", scriptPath];
			} else if (process.platform === "darwin") {
				scriptPath = join(tempDir, "install-backend-macos.sh");
				writeFileSync(scriptPath, macosInstallScript);
				cmd = "bash";
				args = [scriptPath];
				// Make the script executable
				fs.chmodSync(scriptPath, "755");
			} else {
				// Linux
				scriptPath = join(tempDir, "install-backend-linux.sh");
				writeFileSync(scriptPath, linuxInstallScript);
				cmd = "bash";
				args = [scriptPath];
				// Make the script executable
				fs.chmodSync(scriptPath, "755");
			}

			logger.info(
				`Created and running installation script: ${scriptPath}`,
				LogFileType.INSTALLER,
			);

			// Create a progress dialog using BrowserWindow (truly non-modal)
			const progressWindow = new BrowserWindow({
				width: 1380,
				height: 800,
				resizable: false,
				minimizable: false,
				maximizable: false,
				fullscreenable: false,
				title: "Setting Up Local Operator",
				backgroundColor: "#0A0A0A", // Match app's background color
				webPreferences: {
					preload: join(__dirname, "../preload/index.js"),
					sandbox: false,
				},
			});

			// Load the installer HTML file
			if (is.dev && process.env.ELECTRON_RENDERER_URL) {
				// In development mode, use the dev server URL
				progressWindow.loadURL(
					`${process.env.ELECTRON_RENDERER_URL}/installer`,
				);
			} else {
				// In production mode, load the file directly
				progressWindow.loadFile(join(__dirname, "../renderer/installer.html"));
			}
			progressWindow.setMenuBarVisibility(false);

			// Track installation state
			let installationCancelled = false;
			let installationCompleted = false;
			let installProcess: ReturnType<typeof spawn> | null = null;

			// Set up IPC handler for cancel button
			const { ipcMain } = require("electron");
			const cancelHandler = () => {
				installationCancelled = true;
				logger.info(
					"Installation cancelled by user from progress dialog",
					LogFileType.INSTALLER,
				);
				killInstallProcess();
			};

			ipcMain.on("cancel-installation", cancelHandler);

			// Handle window close as cancellation only if installation is still in progress
			progressWindow.on("close", () => {
				if (!installationCancelled && !installationCompleted) {
					installationCancelled = true;
					logger.info(
						"Installation cancelled by user closing the progress window",
						LogFileType.INSTALLER,
					);
					killInstallProcess();
				}
			});

			// Function to kill the installation process
			const killInstallProcess = () => {
				if (installProcess && !installProcess.killed) {
					logger.info(
						"Terminating installation process",
						LogFileType.INSTALLER,
					);

					try {
						// Kill the process and its children
						if (process.platform === "win32") {
							// On Windows, use taskkill to kill the process tree
							if (installProcess.pid !== undefined) {
								spawn("taskkill", [
									"/pid",
									installProcess.pid.toString(),
									"/f",
									"/t",
								]);
							}
						} else {
							// On Unix-like systems, kill the process group
							if (installProcess.pid !== undefined) {
								process.kill(-installProcess.pid, "SIGTERM");
							}
						}
					} catch (error) {
						logger.error(
							"Error killing installation process:",
							LogFileType.INSTALLER,
							error,
						);
					}

					// Only exit the app if this was a user-initiated cancellation
					// This prevents app exit when the window is closed after successful installation
					if (installationCancelled && !installationCompleted) {
						// Force quit the app after a short delay
						setTimeout(() => {
							app.exit(1);
						}, 1000);
					}
				}
			};

			// Make sure we clean up if the app is quitting
			const appQuitHandler = () => {
				killInstallProcess();
			};

			app.once("before-quit", appQuitHandler);

			// Run installation script
			const result = await new Promise<boolean>((resolve) => {
				try {
					// Set environment variables for the installation script
					const env = { ...process.env };

					// Pass the resources path to the script for finding bundled Python
					env.ELECTRON_RESOURCE_PATH = this.resourcesPath;

					// Log the resources path for debugging
					logger.info(
						`Setting ELECTRON_RESOURCE_PATH to ${this.resourcesPath}`,
						LogFileType.INSTALLER,
					);

					// If we found Python, pass its path directly
					if (this.pythonPath) {
						env.PYTHON_BIN = this.pythonPath;
						logger.info(
							`Setting PYTHON_BIN to ${this.pythonPath}`,
							LogFileType.INSTALLER,
						);
					}

					installProcess = spawn(cmd, args, {
						detached: process.platform !== "win32", // Detach on Unix-like systems for process group
						stdio: "pipe",
						env, // Pass environment variables to the script
					});

					let stdout = "";
					let stderr = "";

					if (installProcess.stdout) {
						installProcess.stdout.on("data", (data) => {
							const output = data.toString();
							stdout += output;
							console.log(`Installation stdout: ${output}`);
							logger.info(
								`Installation stdout: ${output}`,
								LogFileType.INSTALLER,
							);
						});
					}

					if (installProcess.stderr) {
						installProcess.stderr.on("data", (data) => {
							const output = data.toString();
							stderr += output;
							console.error(`Installation stderr: ${output}`);
							logger.error(
								`Installation stderr: ${output}`,
								LogFileType.INSTALLER,
							);
						});
					}

					installProcess.on("error", (error) => {
						logger.error(
							`Installation error: ${error instanceof Error ? error.message : String(error)}`,
							LogFileType.INSTALLER,
						);
						if (error instanceof Error) {
							logger.exception(
								error,
								LogFileType.INSTALLER,
								"Installation Process",
							);
						}
						resolve(false);
					});

					installProcess.on("exit", (code) => {
						logger.info(
							`Installation process exited with code ${code}`,
							LogFileType.INSTALLER,
						);

						// Mark installation as completed
						installationCompleted = true;

						// If installation was cancelled, always return false
						if (installationCancelled) {
							resolve(false);
						} else {
							resolve(code === 0);
						}
					});
				} catch (error) {
					logger.error(
						"Error running installation script:",
						LogFileType.INSTALLER,
						error,
					);
					resolve(false);
				}
			});

			// Clean up event listeners
			ipcMain.removeListener("cancel-installation", cancelHandler);
			app.removeListener("before-quit", appQuitHandler);

			// Close the progress window if it's still open
			if (!progressWindow.isDestroyed()) {
				progressWindow.close();
			}

			// If installation was cancelled, exit the app
			if (installationCancelled) {
				logger.info(
					"Installation was cancelled, exiting app",
					LogFileType.INSTALLER,
				);
				app.exit(1);
				return false;
			}

			if (result) {
				logger.info(
					"Backend installation completed successfully",
					LogFileType.INSTALLER,
				);

				// Show success dialog
				await electronDialog.showMessageBox({
					type: "info",
					title: "Setup Complete",
					message:
						"✅ Local Operator is ready to use! Everything has been set up successfully.",
					buttons: ["Let's Go!"],
				});

				return true;
			}

			// Installation failed
			logger.error("Backend installation failed", LogFileType.INSTALLER);

			// Show error dialog
			electronDialog.showErrorBox(
				"Setup Failed",
				"❌ We couldn't complete the setup process. Please try restarting the application or contact support if the problem persists.",
			);

			return false;
		} catch (error) {
			logger.error(
				"Error installing backend:",
				LogFileType.INSTALLER,
				error instanceof Error ? error.message : String(error),
			);
			if (error instanceof Error) {
				logger.exception(error, LogFileType.INSTALLER, "Backend Installation");
			}

			// Show error dialog
			electronDialog.showErrorBox(
				"Installation Error",
				`❌ Error installing the Local Operator backend: ${error instanceof Error ? error.message : String(error)}`,
			);

			return false;
		}
	}
}
