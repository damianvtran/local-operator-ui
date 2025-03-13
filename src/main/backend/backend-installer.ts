/**
 * Backend Installer
 *
 * This module is responsible for installing the Local Operator backend.
 * It handles checking if the backend is installed and installing it if needed.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import { app, dialog as electronDialog } from "electron";

/**
 * Backend Installer class
 * Manages the installation of the Local Operator backend
 */
export class BackendInstaller {
	private appDataPath = app.getPath("userData");
	private venvPath: string;
	private resourcesPath: string;

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

		console.log(
			`Backend Installer initialized. Virtual environment path: ${this.venvPath}`,
		);
		console.log(`Resources path: ${this.resourcesPath}`);
	}

	/**
	 * Check if backend is installed
	 * @returns Promise resolving to true if the backend is installed, false otherwise
	 */
	async isInstalled(): Promise<boolean> {
		try {
			// Check if virtual environment exists
			if (!fs.existsSync(this.venvPath)) {
				console.log(`Virtual environment not found at ${this.venvPath}`);
				return false;
			}

			// Check if local-operator is installed in the virtual environment
			const localOperatorPath =
				process.platform === "win32"
					? join(this.venvPath, "Scripts", "local-operator.exe")
					: join(this.venvPath, "bin", "local-operator");

			if (!fs.existsSync(localOperatorPath)) {
				console.log(
					`local-operator executable not found at ${localOperatorPath}`,
				);
				return false;
			}

			console.log("Backend is installed");
			return true;
		} catch (error) {
			console.error("Error checking if backend is installed:", error);
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
				title: "Local Operator Backend Installation",
				message:
					"The Local Operator backend needs to be installed. This may take a few minutes.",
				buttons: ["Install", "Cancel"],
				defaultId: 0,
				cancelId: 1,
			});

			if (response === 1) {
				// User cancelled installation
				console.log("User cancelled backend installation");
				// Exit the app when installation is cancelled
				setTimeout(() => {
					app.exit(0);
				}, 500);
				return false;
			}

			// Run platform-specific installation script
			let scriptPath: string;
			let cmd: string;
			let args: string[];

			// Set platform-specific script and command
			if (process.platform === "win32") {
				scriptPath = join(
					this.resourcesPath,
					"scripts",
					"install-backend-windows.ps1",
				);
				cmd = "powershell.exe";
				args = ["-ExecutionPolicy", "Bypass", "-File", scriptPath];
			} else if (process.platform === "darwin") {
				scriptPath = join(
					this.resourcesPath,
					"scripts",
					"install-backend-macos.sh",
				);
				cmd = "bash";
				args = [scriptPath];
			} else {
				// Linux
				scriptPath = join(
					this.resourcesPath,
					"scripts",
					"install-backend-linux.sh",
				);
				cmd = "bash";
				args = [scriptPath];
			}

			console.log(`Running installation script: ${scriptPath}`);

			// Create a progress dialog using BrowserWindow (truly non-modal)
			const { BrowserWindow } = require("electron");
			const progressWindow = new BrowserWindow({
				width: 500,
				height: 360,
				resizable: false,
				minimizable: false,
				maximizable: false,
				fullscreenable: false,
				title: "Installing Local Operator Backend",
				backgroundColor: "#0A0A0A", // Match app's background color
				webPreferences: {
					nodeIntegration: true,
					contextIsolation: false,
				},
			});

			// HTML content for the progress window styled to match the app's theme
			const progressHtml = `
				<!DOCTYPE html>
				<html>
				<head>
					<style>
						body {
							font-family: system-ui, Inter, -apple-system, BlinkMacSystemFont, sans-serif;
							padding: 32px;
							display: flex;
							flex-direction: column;
							align-items: center;
							justify-content: center;
							height: 100vh;
							margin: 0;
							background-color: #0A0A0A; /* Match app's background.default */
							color: #F9FAFB; /* Match app's text.primary */
						}
						.container {
							width: 100%;
							max-width: 440px;
							display: flex;
							flex-direction: column;
							gap: 24px;
						}
						h2 {
							margin: 0;
							font-weight: 600;
							font-size: 1.5rem;
							text-align: center;
						}
						p {
							margin: 0;
							color: #9CA3AF; /* Match app's text.secondary */
							text-align: center;
							font-size: 0.95rem;
						}
						button {
							padding: 10px 20px;
							background-color: #E74C3C; /* Red for danger */
							color: white;
							border: none;
							border-radius: 6px;
							cursor: pointer;
							font-weight: 500;
							font-size: 0.95rem;
							transition: all 0.2s ease-in-out;
							align-self: center;
							margin-top: 8px;
						}
						button:hover {
							background-color: #C0392B;
							box-shadow: 0 4px 12px rgba(231, 76, 60, 0.4);
						}
						.progress-container {
							width: 100%;
							display: flex;
							flex-direction: column;
							gap: 12px;
						}
						.progress {
							width: 100%;
							height: 8px;
							background-color: rgba(255, 255, 255, 0.1);
							border-radius: 4px;
							overflow: hidden;
						}
						.card {
							background-color: #141414; /* Match app's background.paper */
							border-radius: 12px;
							border: 1px solid rgba(255, 255, 255, 0.1);
							padding: 24px;
							box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
						}
						@keyframes progress {
							0% { width: 0%; }
							100% { width: 100%; }
						}
					</style>
				</head>
				<body>
					<div class="container">
						<div class="card">
							<h2>Installing Local Operator Backend</h2>
							
							<div class="progress-container">
								<p>This process may take a few minutes. Please wait while the backend is being installed.</p>
							</div>
							
							<button id="cancelBtn">Cancel Installation</button>
						</div>
					</div>
					
					<script>
						const { ipcRenderer } = require('electron');
						document.getElementById('cancelBtn').addEventListener('click', () => {
							ipcRenderer.send('cancel-installation');
						});
					</script>
				</body>
				</html>
			`;

			// Load the HTML content
			progressWindow.loadURL(
				`data:text/html;charset=utf-8,${encodeURIComponent(progressHtml)}`,
			);
			progressWindow.setMenuBarVisibility(false);

			// Track installation state
			let installationCancelled = false;
			let installProcess: ReturnType<typeof spawn> | null = null;

			// Set up IPC handler for cancel button
			const { ipcMain } = require("electron");
			const cancelHandler = () => {
				installationCancelled = true;
				console.log("Installation cancelled by user from progress dialog");
				killInstallProcess();
			};

			ipcMain.on("cancel-installation", cancelHandler);

			// Function to kill the installation process
			const killInstallProcess = () => {
				if (installProcess && !installProcess.killed) {
					console.log("Terminating installation process");

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
						console.error("Error killing installation process:", error);
					}

					// Force quit the app after a short delay
					setTimeout(() => {
						app.exit(1);
					}, 1000);
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
					installProcess = spawn(cmd, args, {
						detached: process.platform !== "win32", // Detach on Unix-like systems for process group
						stdio: "pipe",
					});

					let stdout = "";
					let stderr = "";

					if (installProcess.stdout) {
						installProcess.stdout.on("data", (data) => {
							stdout += data.toString();
							console.log(`Installation stdout: ${data}`);
						});
					}

					if (installProcess.stderr) {
						installProcess.stderr.on("data", (data) => {
							stderr += data.toString();
							console.error(`Installation stderr: ${data}`);
						});
					}

					installProcess.on("error", (error) => {
						console.error(`Installation error: ${error}`);
						resolve(false);
					});

					installProcess.on("exit", (code) => {
						console.log(`Installation process exited with code ${code}`);

						// If installation was cancelled, always return false
						if (installationCancelled) {
							resolve(false);
						} else {
							resolve(code === 0);
						}
					});
				} catch (error) {
					console.error("Error spawning installation process:", error);
					resolve(false);
				}
			});

			// Clean up event listeners
			ipcMain.removeListener("cancel-installation", cancelHandler);
			app.removeListener("before-quit", appQuitHandler);

			// Close the progress window
			progressWindow.close();

			// If installation was cancelled, exit the app
			if (installationCancelled) {
				console.log("Installation was cancelled, exiting app");
				app.exit(1);
				return false;
			}

			if (result) {
				console.log("Backend installation completed successfully");

				// Show success dialog
				await electronDialog.showMessageBox({
					type: "info",
					title: "Installation Complete",
					message: "The Local Operator backend was installed successfully.",
					buttons: ["OK"],
				});

				return true;
			}

			// Installation failed
			console.error("Backend installation failed");

			// Show error dialog
			electronDialog.showErrorBox(
				"Installation Failed",
				"Failed to install the Local Operator backend. Please check the logs for more information.",
			);

			return false;
		} catch (error) {
			console.error("Error installing backend:", error);

			// Show error dialog
			electronDialog.showErrorBox(
				"Installation Error",
				`Error installing the Local Operator backend: ${error}`,
			);

			return false;
		}
	}
}
