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
 * Progress window HTML template
 * Contains the UI for the installation progress window
 */
const progressHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #38C96A;
      --primary-dark: #16B34A;
      --primary-light: #68D88E;
      --secondary: #26BC85;
      --background: #0A0A0A;
      --card-bg: #141414;
      --text-primary: #F9FAFB;
      --text-secondary: #9CA3AF;
      --border-color: rgba(255, 255, 255, 0.1);
      --danger: #EF4444;
      --danger-hover: #DC2626;
      --box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: system-ui, Inter, -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background-color: var(--background);
      color: var(--text-primary);
      font-size: 16px;
    }
    
    .container {
      width: 100%;
      max-width: 520px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    
    .title {
      margin: 0;
      font-weight: 600;
      font-size: 1.4rem;
      text-align: center;
      margin-bottom: 16px;
      letter-spacing: 0.02em;
      background: linear-gradient(90deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-shadow: 0 0 30px rgba(255,255,255,0.1);
    }
    
    .emoji {
      font-size: 1.6rem;
      margin-right: 8px;
      vertical-align: middle;
    }
    
    p {
      margin: 0;
      color: var(--text-secondary);
      text-align: center;
      font-size: 0.875rem;
      line-height: 1.5;
      padding: 0 8px;
    }
    
    button {
      padding: 8px 16px;
      background-color: var(--danger);
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.875rem;
      transition: all 0.2s ease-in-out;
      align-self: center;
      margin-top: 24px;
      text-transform: none;
    }
    
    button:hover {
      background-color: var(--danger-hover);
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
    }
    
    .progress-container {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-top: 8px;
    }
    
    .progress {
      width: 100%;
      height: 6px;
      background-color: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
      position: relative;
      margin: 8px 0;
    }
    
    .progress-bar {
      height: 100%;
      background-color: var(--primary);
      border-radius: 4px;
      animation: progress-animation 2s infinite ease-in-out;
      position: absolute;
      top: 0;
      left: 0;
      width: 30%;
    }
    
    .card {
      background-color: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border-color);
      padding: 24px;
      box-shadow: var(--box-shadow);
      backdrop-filter: blur(8px);
    }
    
    .spinner-container {
      display: flex;
      justify-content: center;
      margin: 24px 0;
    }
    
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(56, 201, 106, 0.2);
      border-radius: 50%;
      border-top-color: var(--primary);
      animation: spin 1s ease-in-out infinite;
    }
    
    .title-container {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    @keyframes progress-animation {
      0% {
        left: -30%;
      }
      100% {
        left: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="title-container">
        <span class="title">🚀 Setting Up Your Environment</span>
      </div>
      
      <div class="progress-container">
        <p>We're preparing the magic behind the scenes! This one-time setup ensures you'll have the best experience with Local Operator.</p>
        
        <div class="progress">
          <div class="progress-bar"></div>
        </div>
      </div>
      
      <div class="spinner-container">
        <div class="spinner"></div>
      </div>
      
      <button id="cancelBtn">Cancel Setup</button>
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
				title: "First-Time Setup Required",
				message:
					"🚀 Local Operator needs to set up some components to work properly. This one-time process will take just a few moments.",
				buttons: ["Set Up Now", "Cancel"],
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
				width: 640,
				height: 480,
				resizable: false,
				minimizable: false,
				maximizable: false,
				fullscreenable: false,
				title: "Setting Up Local Operator",
				backgroundColor: "#0A0A0A", // Match app's background color
				webPreferences: {
					nodeIntegration: true,
					contextIsolation: false,
				},
			});

			// Use the HTML template defined at the top of the file

			// Load the HTML content
			progressWindow.loadURL(
				`data:text/html;charset=utf-8,${encodeURIComponent(progressHtml)}`,
			);
			progressWindow.setMenuBarVisibility(false);

			// Track installation state
			let installationCancelled = false;
			let installationCompleted = false;
			let installProcess: ReturnType<typeof spawn> | null = null;

			// Set up IPC handler for cancel button
			const { ipcMain } = require("electron");
			const cancelHandler = () => {
				installationCancelled = true;
				console.log("Installation cancelled by user from progress dialog");
				killInstallProcess();
			};

			ipcMain.on("cancel-installation", cancelHandler);

			// Handle window close as cancellation only if installation is still in progress
			progressWindow.on("close", () => {
				if (!installationCancelled && !installationCompleted) {
					installationCancelled = true;
					console.log(
						"Installation cancelled by user closing the progress window",
					);
					killInstallProcess();
				}
			});

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
					console.error("Error spawning installation process:", error);
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
				console.log("Installation was cancelled, exiting app");
				app.exit(1);
				return false;
			}

			if (result) {
				console.log("Backend installation completed successfully");

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
			console.error("Backend installation failed");

			// Show error dialog
			electronDialog.showErrorBox(
				"Setup Failed",
				"❌ We couldn't complete the setup process. Please try restarting the application or contact support if the problem persists.",
			);

			return false;
		} catch (error) {
			console.error("Error installing backend:", error);

			// Show error dialog
			electronDialog.showErrorBox(
				"Installation Error",
				`❌ Error installing the Local Operator backend: ${error}`,
			);

			return false;
		}
	}
}
