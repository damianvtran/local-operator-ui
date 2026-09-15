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
import {
	ensureVenvBytecodeGuard,
	withPythonBytecodeCache,
} from "../python-bytecode-cache";
import { LogFileType, logger } from "./logger";
import {
	type ManagedPythonOptions,
	inspectManagedSelection,
	managedSelectionReady,
	prepareManagedPython,
} from "./managed-python";
import {
	linuxInstallScript,
	macosInstallScript,
	windowsInstallScript,
} from "./scripts";
import { VENV_PATH_ENV, managedVenvPath } from "./venv-paths";
/**
 * The three failure classes a user can act on, matched on the error's own words.
 *
 * Ordered, and that order is the decision: a full disk is the one cause whose
 * remedy is the user's (`free space`), and it can look like a missing file, so
 * it is tested first.
 */
const SETUP_FAILURE_CAUSES: Array<[RegExp, string]> = [
	[
		/ENOSPC|No space left|not enough (?:free )?space/i,
		"This Mac ran out of disk space while setting up the backend. Free some space and retry.",
	],
	[
		/Another Local Operator instance is preparing/i,
		"Another copy of Local Operator is setting up its backend right now. Retry in a moment.",
	],
	[
		/*
		 * The smoke arm only. `did not complete` used to be in here, and it is the
		 * phrase `prepareManagedPython` throws when the install callback returns
		 * false - a pip or network failure, where nothing was installed at all - so
		 * the user read "The backend was installed but did not start correctly" about
		 * an install that never happened (review round 2, N6). It now falls through
		 * to the generic cause, which is true of it, and the app's own sentence still
		 * follows under `The app recorded:`.
		 */
		/did not become healthy|Backend smoke|exited with/i,
		"The backend was installed but did not start correctly.",
	],
	[
		/ENOENT|no such file or directory|could not find|did not match its signed seed/i,
		"A file the setup needed was missing, which usually means the download or the copy did not finish.",
	],
];

/**
 * The failure dialog's detail line: what happened, then what was recorded.
 *
 * Why not `error.message` directly, which is what this used to be: several of
 * those strings name internals rather than the user's situation - "Runtime
 * directory escaped its managed root", "Could not allocate backend smoke port",
 * "Invalid managed Python selection" - and a raw `ENOENT: no such file or
 * directory, lstat ...` is the line a user actually reads (design D4). The plain
 * sentence comes first because that is the part that is actionable; the app's own
 * message follows under a label, because a support conversation needs the handle
 * and the log needs the cause. The support root is named rather than a file, so
 * the line does not send anyone to an internal path that may no longer exist.
 *
 * Exported so the copy is pinned by a test rather than only being visible in a
 * dialog that, on this host, cannot be rendered at all.
 */
export function backendSetupFailureDetail(
	error: unknown,
	support: string,
): string {
	const raw = error instanceof Error ? error.message : String(error);
	const cause =
		SETUP_FAILURE_CAUSES.find(([pattern]) => pattern.test(raw))?.[1] ??
		"The backend could not be set up on this Mac.";
	return [
		`What happened: ${cause}`,
		`The app recorded: ${raw}`,
		`Where its environment lives: ${support}/managed-python`,
	].join("\n\n");
}

/**
 * Backend Installer class
 * Manages the installation of the Local Operator backend
 */
export class BackendInstaller {
	private appDataPath = app.getPath("userData");
	private venvPath: string;
	private resourcesPath: string;
	private pythonPath: string | null = null;
	private preparationWindow: BrowserWindow | null = null;

	/**
	 * Constructor
	 */
	constructor() {
		// The app-managed venv for THIS instance. A packaged install and an
		// unpackaged one must not share it: the venv is created by whatever
		// interpreter the instance resolves, so a shared one puts the installed
		// bundle's stdlib in the dev instance's import path - see `managedVenvPath`,
		// which carries the measurement.
		this.venvPath = managedVenvPath({
			platform: process.platform,
			home: app.getPath("home"),
			appDataPath: this.appDataPath,
			packaged: app.isPackaged,
		});

		// Set resources path
		this.resourcesPath = !app.isPackaged
			? join(process.cwd(), "resources")
			: join(process.resourcesPath);

		// No guard is written from the constructor, and on darwin `this.venvPath` is
		// the selection venv or the `no-environment-selected` sentinel - writing a
		// `sitecustomize.py` into the sentinel would create a directory that looks
		// like state, which is exactly what that name exists to prevent. The guard
		// goes in after the environment is built instead (see `installEnvironment`).
		if (process.platform !== "darwin") this.guardVenvBytecode();
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
		// A macOS seed is data, never an executable candidate inside the app.
		if (process.platform === "darwin") return null;
		const possibilities: string[] = [];

		// Prioritize architecture-specific paths based on current process architecture
		if (process.arch === "arm64") {
			// For Apple Silicon (arm64)
			possibilities.push(
				join(process.resourcesPath, "python_aarch64", "bin", "python3"), // Packaged app (aarch64)
				join(process.cwd(), "resources", "python_aarch64", "bin", "python3"), // Development (aarch64)
			);
		} else if (process.arch === "x64") {
			// For Intel (x86_64)
			possibilities.push(
				join(process.resourcesPath, "python", "bin", "python3"), // Packaged app (x86_64)
				join(process.cwd(), "resources", "python", "bin", "python3"), // Development (x86_64)
			);
		}

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
	 * Make the app-managed venv refuse bytecode writes for every process that
	 * uses it, whoever started it.
	 *
	 * Logged rather than silent in both directions: a guard that was already
	 * there, one this call wrote, and one that could not be written (no venv yet,
	 * or a `sitecustomize.py` the operator owns) are three different states of the
	 * same guarantee, and the field diagnosis starts from which one this machine
	 * is in. `ensureVenvBytecodeGuard` never replaces a file it did not write.
	 */
	private guardVenvBytecode(): void {
		const guard = ensureVenvBytecodeGuard(this.venvPath);
		logger.info(
			`Bytecode guard in the app-managed venv: ${guard.reason}`,
			LogFileType.INSTALLER,
		);
	}

	/**
	 * Check if backend is installed
	 * @returns Promise resolving to true if the backend is installed, false otherwise
	 */
	async isInstalled(): Promise<boolean> {
		try {
			if (process.platform === "darwin")
				return await managedSelectionReady(this.managedOptions());
			// Check if virtual environment exists
			if (!fs.existsSync(this.venvPath)) {
				logger.info(
					`Virtual environment not found at ${this.venvPath}`,
					LogFileType.INSTALLER,
				);
				return false;
			}

			// Check if local-operator is installed in the virtual environment
			let localOperatorPath: string;

			if (process.platform === "win32") {
				// Windows
				localOperatorPath = join(
					this.venvPath,
					"Scripts",
					"local-operator.exe",
				);

				if (!fs.existsSync(localOperatorPath)) {
					logger.info(
						`local-operator executable not found at ${localOperatorPath}`,
						LogFileType.INSTALLER,
					);
					return false;
				}
			} else {
				// For non-Windows platforms
				localOperatorPath = join(this.venvPath, "bin", "local-operator");

				if (!fs.existsSync(localOperatorPath)) {
					logger.info(
						`local-operator executable not found at ${localOperatorPath}`,
						LogFileType.INSTALLER,
					);
					return false;
				}
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
	private managedOptions(): ManagedPythonOptions {
		return {
			support: join(
				app.getPath("home"),
				"Library",
				"Application Support",
				"Local Operator",
			),
			resources: this.resourcesPath,
			packaged: app.isPackaged,
			arch: process.arch,
		};
	}

	async install(): Promise<boolean> {
		if (process.platform !== "darwin") return this.installEnvironment();
		// Publish only after imports and real backend health pass. A failed setup
		// preserves the previous venv and data; retry creates a fresh generation.
		for (;;) {
			try {
				// Say why, before preparing: a published environment that is gone or no
				// longer the published bytes is now recovered from rather than refused
				// (review R8), and the one place that diagnosis survives is this log -
				// the user is told what to do, not which `pyvenv.cfg` disagreed.
				const state = inspectManagedSelection(this.managedOptions());
				if (state.kind === "missing")
					logger.warn(
						`Published backend environment is not usable and will be rebuilt: ${state.detail}`,
						LogFileType.INSTALLER,
					);
				await prepareManagedPython(
					this.managedOptions(),
					async (venv, python) => {
						this.venvPath = venv;
						this.pythonPath = python;
						return this.installEnvironment();
					},
				);
				return true;
			} catch (error) {
				logger.error(
					"Backend preparation failed",
					LogFileType.INSTALLER,
					error,
				);
				const { response } = await electronDialog.showMessageBox({
					type: "error",
					title: "Backend setup could not finish",
					message:
						"Your existing environment and data were preserved. Retry setup to start this version of Local Operator.",
					detail: backendSetupFailureDetail(
						error,
						this.managedOptions().support,
					),
					buttons: ["Retry setup", "Quit"],
					defaultId: 0,
					cancelId: 1,
				});
				if (response !== 0) return false;
			} finally {
				if (this.preparationWindow && !this.preparationWindow.isDestroyed())
					this.preparationWindow.close();
				this.preparationWindow = null;
			}
		}
	}

	private async installEnvironment(): Promise<boolean> {
		try {
			/*
			 * macOS is not prompted here, and that is a deliberate, user-visible
			 * change this branch made rather than an oversight (review R9).
			 *
			 * Two surfaces used to ask one question: this consent prompt, and the
			 * progress window that opens immediately after it, which carries its own
			 * Cancel. On macOS the install now runs inside `prepareManagedPython`'s
			 * preparation lock, so the prompt also stood between a user and a lock,
			 * and a modal held open there starves any other instance waiting to
			 * prepare. The window the user actually watches owns the decision, so the
			 * prompt is not shown and there is no consent state to cancel here; the
			 * platforms that still show it keep the same flow they had.
			 *
			 * What is NOT restored: a non-blocking acknowledgement. Nothing is said
			 * after a successful macOS setup, because the window closing and the app
			 * starting is the acknowledgement - see the note on the completion path.
			 */
			if (process.platform !== "darwin") {
				const { response } = await electronDialog.showMessageBox({
					type: "info",
					title: "First-Time Setup Required",
					message:
						"Local Operator needs to set up some components to work properly. This one-time process will take just a few moments.",
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
			}

			// Create temporary script file based on platform
			let scriptPath: string;
			let cmd: string;
			let args: string[];
			const tempDir = fs.mkdtempSync(join(tmpdir(), "local-operator-install-"));

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
				/* The default dark theme's `canvas`. This is the colour Electron
				   paints before the renderer's first frame, so a mismatch is a
				   visible flash on the very first screen a new user sees. It was
				   #0A0A0A to match a palette this refactor replaced; the warm
				   near-black below is what `localOperatorDark` actually renders.
				   Hardcoded because the main process paints this window before
				   any theme module is loaded - if the palette moves again, this
				   moves with it. */
				backgroundColor: "#16130e",
				webPreferences: {
					preload: join(__dirname, "../preload/index.js"),
					sandbox: false,
				},
			});

			if (process.platform === "darwin")
				this.preparationWindow = progressWindow;

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
					// Set environment variables for the installation script.
					//
					// The install script creates the venv with our bundled interpreter,
					// which makes that interpreter - and its stdlib, inside the sealed
					// `.app` - the venv's own, so every python the script or the venv then
					// runs can write `__pycache__/*.pyc` into the bundle and break its code
					// signature.
					//
					// This prefix does not answer that on its own, and the reason is
					// structural: the app does not spawn every python that runs this
					// interpreter, and the ones it does not spawn (the operator's shell, a CLI
					// script, an agent) carry no prefix at all - measured, a venv over this
					// tree wrote 25 `.pyc` into it that way. It is set all the same, for the
					// children that do inherit this environment, and because this spawn runs
					// before the backend's own shell environment exists to inherit one from.
					// The half no spawner can evade is the seal on the tree itself, above.
					const env: Record<string, string | undefined> =
						withPythonBytecodeCache({ ...process.env }, this.appDataPath);

					// Pass the resources path to the script for finding bundled Python
					env.ELECTRON_RESOURCE_PATH = this.resourcesPath;

					/*
					 * And the environment this instance's install belongs to.
					 *
					 * The script cannot derive it: it runs as a subprocess with no view of
					 * `app.isPackaged`, so left to itself it builds the packaged name for
					 * every instance - measured by a review, which ran the shipped macOS
					 * script under a dev instance's environment and watched it create
					 * `.../local-operator-venv` while this app's own answer for the same
					 * instance was `.../local-operator-venv-dev`. That is the shared
					 * environment whose interpreter is the installed bundle's, so a dev
					 * instance would still pip into and `rm -rf` the packaged app's
					 * environment, and then fail this class's own `isInstalled()` check and
					 * quit. One path decision, handed down rather than re-made.
					 */
					env[VENV_PATH_ENV] = this.venvPath;
					// Hand down Electron's actual paths, not an assumed HOME, including
					// the scripts' hardcoded support boundary during isolated native tests.
					env.HOME = app.getPath("home");
					env.LOCAL_OPERATOR_SUPPORT_PATH =
						process.platform === "darwin"
							? this.managedOptions().support
							: this.appDataPath;
					logger.info(
						`Setting ${VENV_PATH_ENV} to ${this.venvPath}`,
						LogFileType.INSTALLER,
					);

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

					let _stdout = "";
					let _stderr = "";

					if (installProcess.stdout) {
						installProcess.stdout.on("data", (data) => {
							const output = data.toString();
							_stdout += output;
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
							_stderr += output;
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
			if (process.platform !== "darwin" && !progressWindow.isDestroyed()) {
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

				// The venv exists now, so the guard can go in with it rather than
				// waiting for the next start - on every platform. It used to be skipped
				// on darwin, on the reasoning that this venv was built on the installed
				// bundle and editing it was a favour to the pre-split world. That is no
				// longer what this venv is: it is built on a runtime outside every
				// `.app`, and the processes the app does not spawn - the operator's
				// shell, a CLI script, launchd - can still run it and write bytecode
				// into a tree whose identity we assert. The guard is the half that
				// covers them (review R13, QA Q2).
				this.guardVenvBytecode();

				// Verify the installation by checking if the local-operator executable exists
				const localOperatorPath =
					process.platform === "win32"
						? join(this.venvPath, "Scripts", "local-operator.exe")
						: join(this.venvPath, "bin", "local-operator");

				if (!fs.existsSync(localOperatorPath)) {
					logger.error(
						`Installation verification failed: ${localOperatorPath} not found`,
						LogFileType.INSTALLER,
					);
					throw new Error(
						"Installation verification failed: local-operator executable not found",
					);
				}

				logger.info(
					"Installation verified successfully",
					LogFileType.INSTALLER,
				);

				/*
				 * Same platform split as the consent prompt above, and the same reason:
				 * on macOS the acknowledgement used to be a second modal, and it is
				 * deliberately not shown any more. The setup window closing and the app
				 * starting IS the acknowledgement there, and "Let's Go!" gated the
				 * window behind a click that said nothing the state did not already say
				 * (review R9). The platforms that still show it keep their flow.
				 */
				if (process.platform !== "darwin") {
					const { response: successResponse } =
						await electronDialog.showMessageBox({
							type: "info",
							title: "Setup Complete",
							message:
								"Local Operator is ready to use. Everything has been set up successfully.",
							buttons: ["Let's Go!", "Cancel"],
							defaultId: 0,
							cancelId: 1,
						});
					if (successResponse === 1) {
						// User cancelled installation
						logger.info(
							"User ended session after successful installation",
							LogFileType.INSTALLER,
						);
						// Exit the app when installation is cancelled
						setTimeout(() => {
							app.exit(0);
						}, 500);
						return false;
					}
				}

				// A short settle before the app continues, so the window's last frame is
				// painted before it closes. Kept on every platform: it is a paint delay,
				// not a dialog's shadow.
				await new Promise((resolve) => setTimeout(resolve, 500));

				// On Windows, wait for transcript file release before continuing
				if (process.platform === "win32") {
					const transcriptPath = join(
						this.appDataPath,
						"backend-install-shell.log",
					);

					// Wait for the transcript file to be released
					await (async () => {
						logger.info(
							"Waiting for transcript file release before continuing...",
							LogFileType.INSTALLER,
						);

						const maxAttempts = 30;
						let attempts = 0;

						while (attempts < maxAttempts) {
							try {
								const fd = fs.openSync(transcriptPath, "a");
								fs.closeSync(fd);
								logger.info(
									"Transcript file released successfully",
									LogFileType.INSTALLER,
								);
								// Add a small delay after file is released to ensure all resources are freed
								await new Promise((resolve) => setTimeout(resolve, 1000));
								break;
							} catch (_error) {
								logger.info(
									`Waiting for transcript file to be released (attempt ${attempts + 1}/${maxAttempts})`,
									LogFileType.INSTALLER,
								);
								await new Promise((resolve) => setTimeout(resolve, 500));
								attempts++;
							}
						}

						if (attempts >= maxAttempts) {
							logger.warn(
								"Timed out waiting for transcript file release, continuing anyway",
								LogFileType.INSTALLER,
							);
							// Add a longer delay if we timed out
							await new Promise((resolve) => setTimeout(resolve, 2000));
						}
					})();
				}

				return true;
			}

			// Installation failed
			logger.error("Backend installation failed", LogFileType.INSTALLER);

			// Show error dialog
			electronDialog.showErrorBox(
				"Setup Failed",
				"We couldn't complete the setup process. Please try restarting the application or contact support if the problem persists.",
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
				`Error installing the Local Operator backend: ${error instanceof Error ? error.message : String(error)}`,
			);

			return false;
		}
	}
}
