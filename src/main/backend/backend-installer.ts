/**
 * Backend Installer
 *
 * This module is responsible for installing the Local Operator backend.
 * It handles checking if the backend is installed and installing it if needed.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { app, dialog as electronDialog } from "electron";
import fs from "node:fs";

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

			// Show installation progress dialog
			const progressDialog = electronDialog.showMessageBox({
				type: "info",
				title: "Installing Local Operator Backend",
				message:
					"Installing the Local Operator backend. This may take a few minutes...",
				buttons: ["Cancel"],
				defaultId: 0,
				cancelId: 0,
				noLink: true,
			});

			// Track if installation was cancelled
			let installationCancelled = false;

			// Run installation script
			const result = await new Promise<boolean>((resolve) => {
				const process = spawn(cmd, args, {
					detached: false,
					stdio: "pipe",
				});

				let stdout = "";
				let stderr = "";

				if (process.stdout) {
					process.stdout.on("data", (data) => {
						stdout += data.toString();
						console.log(`Installation stdout: ${data}`);
					});
				}

				if (process.stderr) {
					process.stderr.on("data", (data) => {
						stderr += data.toString();
						console.error(`Installation stderr: ${data}`);
					});
				}

				process.on("error", (error) => {
					console.error(`Installation error: ${error}`);
					resolve(false);
				});

				process.on("exit", (code) => {
					console.log(`Installation process exited with code ${code}`);
					resolve(code === 0);
				});
			});

			// Check if user cancelled from progress dialog
			const progressResponse = await progressDialog;
			if (progressResponse.response === 0) {
				// User clicked Cancel
				installationCancelled = true;
				console.log("Installation cancelled by user from progress dialog");
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
