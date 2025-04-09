import { join } from "node:path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
	BrowserWindow,
	Menu,
	app,
	dialog,
	ipcMain,
	nativeImage,
	shell,
} from "electron";
import icon from "../../resources/icon.png?asset";
import {
	BackendInstaller,
	BackendServiceManager,
	LocalOperatorStartupMode,
} from "./backend";
import { LogFileType, logger } from "./backend/logger";
import { UpdateService } from "./update-service";
import { backendConfig } from "./backend/config";
import { PostHog } from "posthog-node";

// Set application name
app.setName("Local Operator");
const image = nativeImage.createFromPath(icon);
// Set dock icon on macOS only
if (process.platform === "darwin" && app.dock) {
	app.dock.setIcon(image);
}

// Initialize PostHog
const posthogClient = new PostHog(backendConfig.VITE_PUBLIC_POSTHOG_KEY, {
	host: backendConfig.VITE_PUBLIC_POSTHOG_HOST,
	enableExceptionAutocapture: true,
});

// Create application menu without developer tools in production
function createApplicationMenu(): void {
	// Check if we're in development mode
	const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

	// Create menu template
	const template: Electron.MenuItemConstructorOptions[] = [
		{
			label: "File",
			submenu: [{ role: "quit" }],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" as const },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "delete" },
				{ type: "separator" as const },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ type: "separator" as const },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" as const },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: "Window",
			submenu: [
				{ role: "minimize" },
				{ role: "zoom" },
				...(process.platform === "darwin"
					? ([
							{ type: "separator" as const },
							{ role: "front" },
							{ type: "separator" as const },
							{ role: "window" },
						] as Electron.MenuItemConstructorOptions[])
					: ([{ role: "close" }] as Electron.MenuItemConstructorOptions[])),
			],
		},
		{
			role: "help",
			submenu: [
				{
					label: "Learn More",
					click: async () => {
						await shell.openExternal("https://local-operator.com");
					},
				},
			],
		},
	];

	// Add developer tools option only in development mode
	if (isDev) {
		const viewMenu = template.find((menu) => menu.label === "View");
		if (viewMenu?.submenu && Array.isArray(viewMenu.submenu)) {
			viewMenu.submenu.push(
				{ type: "separator" as const },
				{ role: "toggleDevTools" },
			);
		}
	}

	// Add macOS specific menu items
	if (process.platform === "darwin") {
		template.unshift({
			label: app.name,
			submenu: [
				{ role: "about" },
				{ type: "separator" as const },
				{ role: "services" },
				{ type: "separator" as const },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" as const },
				{ role: "quit" },
			],
		});
	}

	// Build and set the menu
	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function createWindow(): BrowserWindow {
	// Create the browser window.
	const mainWindow = new BrowserWindow({
		width: 1380,
		height: 900,
		show: false,
		autoHideMenuBar: true,
		title: "Local Operator",
		icon,
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			sandbox: false,
			// Only enable devTools when running with 'pnpm dev'
			// Disable for 'pnpm start' and production builds
			devTools: Boolean(process.env.ELECTRON_RENDERER_URL),
		},
	});

	mainWindow.on("ready-to-show", () => {
		mainWindow.show();
	});

	mainWindow.webContents.setWindowOpenHandler((details) => {
		shell.openExternal(details.url);
		return { action: "deny" };
	});

	// HMR for renderer base on electron-vite cli.
	// Load the remote URL for development or the local html file for production.
	if (is.dev && process.env.ELECTRON_RENDERER_URL) {
		mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}

	return mainWindow;
}

// Initialize backend service manager and installer
const backendService = new BackendServiceManager();
const backendInstaller = new BackendInstaller();

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
	// Set app user model id for windows
	electronApp.setAppUserModelId("com.local-operator");

	// Default open or close DevTools by F12 in development
	// and ignore CommandOrControl + R in production.
	// see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
	app.on("browser-window-created", (_, window) => {
		optimizer.watchWindowShortcuts(window);
	});

	// Add IPC handlers for opening files and URLs
	ipcMain.handle("open-file", async (_, filePath) => {
		try {
			await shell.openPath(filePath);
		} catch (error) {
			console.error("Error opening file:", error);
		}
	});

	ipcMain.handle("open-external", async (_, url) => {
		try {
			await shell.openExternal(url);
		} catch (error) {
			console.error("Error opening URL:", error);
		}
	});

	// Add IPC handlers for system information
	ipcMain.handle("get-app-version", () => {
		return app.getVersion();
	});

	ipcMain.handle("get-platform-info", () => {
		return {
			platform: process.platform,
			arch: process.arch,
			nodeVersion: process.versions.node,
			electronVersion: process.versions.electron,
			chromeVersion: process.versions.chrome,
		};
	});

	// Check if backend manager is disabled via environment variable
	const isBackendManagerDisabled =
		process.env.VITE_DISABLE_BACKEND_MANAGER === "true";

	if (!isBackendManagerDisabled) {
		// Check if an external backend is already running
		const hasExternalBackend = await backendService.checkExistingBackend();

		if (!hasExternalBackend) {
			// Check if local-operator command exists globally
			const hasGlobalCommand = await backendService.checkLocalOperatorExists();

			// If local-operator doesn't exist globally and our backend is not installed
			if (!hasGlobalCommand && !(await backendInstaller.isInstalled())) {
				// Install backend
				const installSuccess = await backendInstaller.install();
				// If installation was cancelled or failed, quit the app
				if (!installSuccess) {
					logger.error(
						"Backend installation cancelled or failed, quitting app",
						LogFileType.INSTALLER,
					);
					app.quit();
					return; // Exit early to prevent window creation
				}

				// After successful installation, attempt to start the backend with retries
				logger.info(
					"Attempting to start backend service after installation",
					LogFileType.INSTALLER,
				);
				let startAttempts = 0;
				const maxStartAttempts = 3;
				let backendStarted = false;

				while (startAttempts < maxStartAttempts && !backendStarted) {
					try {
						backendStarted = await backendService.start();
						if (!backendStarted) {
							logger.error(
								`Backend start attempt ${startAttempts + 1} failed`,
								LogFileType.INSTALLER,
							);
							// Wait before retrying
							await new Promise((resolve) => setTimeout(resolve, 2000));
						}
					} catch (error) {
						logger.error(
							`Error starting backend (attempt ${startAttempts + 1}):`,
							LogFileType.INSTALLER,
							error,
						);
					}
					startAttempts++;
				}

				if (!backendStarted) {
					logger.error(
						"Failed to start backend after installation, quitting app",
						LogFileType.INSTALLER,
					);
					dialog.showErrorBox(
						"Backend Error",
						"Failed to start the Local Operator backend service after installation. Please restart the application.",
					);
					app.quit();
					return;
				}
			} else {
				// Start our backend service (for existing installations)
				const backendStarted = await backendService.start();
				if (!backendStarted) {
					logger.error(
						"Failed to start backend with existing installation, quitting app",
						LogFileType.BACKEND,
					);
					dialog.showErrorBox(
						"Backend Error",
						"Failed to start the Local Operator backend service. Please restart the application.",
					);
					app.quit();
					return;
				}
			}
		}
	}

	// Create custom application menu
	createApplicationMenu();

	// Create the main window
	const mainWindow = createWindow();

	// Initialize the update service with a reference to the backend service
	const updateService = new UpdateService(mainWindow, backendService);

	// Set up IPC handlers for the update service
	updateService.setupIpcHandlers();

	// Handle platform-specific setup for the updater
	updateService.handlePlatformSpecifics();

	// Check for all updates (UI and backend) after a short delay to ensure the app is fully loaded
	setTimeout(() => {
		updateService.checkForAllUpdates(true);
	}, 3000);

	app.on("activate", () => {
		// On macOS it's common to re-create a window in the app when the
		// dock icon is clicked and there are no other windows open.
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
	// On macOS, keep the app active in the dock
	if (process.platform === "darwin") {
		logger.info(
			"All windows closed, but keeping app active (macOS platform)",
			LogFileType.BACKEND,
		);
		return;
	}

	// For Windows and Linux, we need to check if we're in the installation process,
	// auto-update process, or if the user has explicitly closed all windows

	// Check if we're in the installation process by looking at the backendInstaller state
	// If the backend service is not yet started, we're likely in the installation process
	if (
		backendService.getStartupMode() === LocalOperatorStartupMode.NOT_STARTED
	) {
		logger.info(
			"All windows closed during startup/installation, exit will not be handled by window-all-closed event",
			LogFileType.BACKEND,
		);
		return;
	}

	// If we get here, the user has explicitly closed all windows, so quit the app
	logger.info(
		"All windows closed by user, quitting app via window-all-closed event (non-macOS platform)",
		LogFileType.BACKEND,
	);
	app.quit();
});

// Stop backend service when app is quitting
app.on("will-quit", async (event) => {
	// Check if backend manager is disabled
	const isBackendManagerDisabled =
		process.env.VITE_DISABLE_BACKEND_MANAGER === "true";

	// Only stop the backend service if we started it ourselves
	if (!isBackendManagerDisabled && !backendService.isUsingExternalBackend()) {
		event.preventDefault();
		try {
			logger.info(
				"App is quitting, stopping the Local Operator backend service...",
				LogFileType.BACKEND,
			);

			// Use false for isRestart to indicate this is a final shutdown, not a restart
			await backendService.stop(false);
			logger.info(
				"Local Operator backend service successfully stopped",
				LogFileType.BACKEND,
			);

			// Add an additional targeted cleanup as a failsafe
			logger.info(
				"Performing additional cleanup to ensure complete termination",
				LogFileType.BACKEND,
			);

			// Use more robust cleanup approach
			if (process.platform === "win32") {
				// On Windows, use taskkill to find and kill python and local-operator processes
				try {
					// Use taskkill to find and kill python processes that might be running the backend
					require("node:child_process").execSync(
						'taskkill /f /im python.exe /fi "WINDOWTITLE eq *local-operator*" /t',
						{ stdio: "ignore" },
					);

					// Also try to kill any local-operator.exe processes directly
					require("node:child_process").execSync(
						"taskkill /f /im local-operator.exe /t",
						{ stdio: "ignore" },
					);
				} catch (err) {
					// Ignore errors, this is a best-effort cleanup
					logger.error(
						"Error during Windows process cleanup (may be normal):",
						LogFileType.BACKEND,
						err,
					);
				}
			} else {
				// On Unix systems, look for processes with "local-operator serve" in the command line
				try {
					// First try graceful termination
					require("node:child_process").execSync(
						'pkill -f "local-operator serve"',
						{ stdio: "ignore" },
					);

					// Wait a moment for graceful termination
					await new Promise((resolve) => setTimeout(resolve, 1000));

					// Then force kill any remaining processes
					require("node:child_process").execSync(
						'pkill -9 -f "local-operator serve"',
						{ stdio: "ignore" },
					);
				} catch (err) {
					// Ignore errors, this is a best-effort cleanup
					logger.error(
						"Error during Unix process cleanup (may be normal):",
						LogFileType.BACKEND,
						err,
					);
				}
			}

			// Verify all processes are terminated
			let allProcessesTerminated = true;
			try {
				if (process.platform === "win32") {
					// Use tasklist instead of wmic as it's more reliable on newer Windows versions
					const { stdout: pythonOutput } =
						require("node:child_process").execSync(
							`tasklist /fi "imagename eq python.exe" /fo csv`,
							{ encoding: "utf8" },
						);
					// If we find any python processes, check if they're related to local-operator
					const hasPythonProcesses = pythonOutput
						?.trim()
						.includes("python.exe");

					// Also check for local-operator.exe
					const { stdout: localOperatorOutput } =
						require("node:child_process").execSync(
							`tasklist /fi "imagename eq local-operator.exe" /fo csv`,
							{ encoding: "utf8" },
						);
					const hasLocalOperatorProcesses = localOperatorOutput
						?.trim()
						.includes("local-operator.exe");

					allProcessesTerminated =
						!hasPythonProcesses && !hasLocalOperatorProcesses;
				} else {
					const { stdout } = require("node:child_process").execSync(
						`pgrep -f "local-operator serve" || echo ""`,
						{ encoding: "utf8" },
					);
					// If we find any process IDs, they're not all terminated
					allProcessesTerminated = !stdout?.trim();
				}
			} catch (err) {
				// If there's an error checking, assume processes are terminated
				logger.error(
					"Error checking for remaining processes:",
					LogFileType.BACKEND,
					err,
				);
				allProcessesTerminated = true;
			}

			if (!allProcessesTerminated) {
				logger.error(
					"Some backend processes may still be running, attempting final cleanup",
					LogFileType.BACKEND,
				);

				// Final attempt at cleanup
				try {
					if (process.platform === "win32") {
						require("node:child_process").execSync(
							"taskkill /f /im python.exe /t",
							{ stdio: "ignore" },
						);
					} else {
						require("node:child_process").execSync("pkill -9 -f python", {
							stdio: "ignore",
						});
					}
				} catch (finalErr) {
					// Ignore errors in final cleanup
					logger.error(
						"Error during final cleanup (may be normal):",
						LogFileType.BACKEND,
						finalErr,
					);
				}
			}
		} catch (error) {
			logger.error(
				"Error stopping the Local Operator backend service:",
				LogFileType.BACKEND,
				error,
			);

			// If the normal stop failed, try the targeted approach
			logger.info(
				"Trying alternative termination approach",
				LogFileType.BACKEND,
			);

			if (process.platform === "win32") {
				// On Windows, use taskkill to find and kill python and local-operator processes
				try {
					// Use taskkill to find and kill python processes that might be running the backend
					require("node:child_process").execSync(
						'taskkill /f /im python.exe /fi "WINDOWTITLE eq *local-operator*" /t',
						{ stdio: "ignore" },
					);

					// Also try to kill any local-operator.exe processes directly
					require("node:child_process").execSync(
						"taskkill /f /im local-operator.exe /t",
						{ stdio: "ignore" },
					);
				} catch (err) {
					// Ignore errors, this is a best-effort cleanup
				}
			} else {
				// On Unix systems, look for processes with "local-operator serve" in the command line
				try {
					require("node:child_process").execSync(
						'pkill -f "local-operator serve"',
						{ stdio: "ignore" },
					);

					// Give processes a moment to terminate gracefully before force killing
					require("node:child_process").execSync(
						'sleep 1 && pkill -9 -f "local-operator serve"',
						{ stdio: "ignore" },
					);
				} catch (err) {
					// Ignore errors, this is a best-effort cleanup
				}
			}
		} finally {
			// Ensure app quits even if there was an error stopping the service
			// Use a longer timeout to ensure the process has time to fully terminate
			logger.info("Exiting application...", LogFileType.BACKEND);
			setTimeout(() => {
				logger.info("Forcing app exit", LogFileType.BACKEND);
				app.exit(0);
			}, 2000); // Increased timeout to 2 seconds for more reliable termination
		}
	} else if (
		!isBackendManagerDisabled &&
		backendService.isUsingExternalBackend()
	) {
		logger.info(
			"Using external backend, skipping termination on app quit",
			LogFileType.BACKEND,
		);
	}
});

// Handle before-quit event to ensure proper cleanup
app.on("before-quit", () => {
	logger.info("App is about to quit", LogFileType.BACKEND);
});

// Add a failsafe to ensure child processes are terminated when the app exits
process.on("exit", () => {
	logger.info(
		"Process exit event detected, ensuring the Local Operator backend service is terminated",
		LogFileType.BACKEND,
	);
	// This is a synchronous event, so we can't use async/await here
	try {
		// Force kill any remaining child processes, but ONLY if we started our own backend
		// and not if we're using an external backend
		if (
			!process.env.VITE_DISABLE_BACKEND_MANAGER &&
			!backendService.isUsingExternalBackend()
		) {
			logger.info(
				"Forcing termination of the Local Operator backend service",
				LogFileType.BACKEND,
			);

			// Use a more targeted approach to avoid affecting other services
			// We'll only try to find and terminate processes that look like our backend
			logger.info(
				"Performing final cleanup of any remaining backend processes",
				LogFileType.BACKEND,
			);

			if (process.platform === "win32") {
				// On Windows, use taskkill to find and kill python and local-operator processes
				try {
					// Use taskkill to find and kill python processes that might be running the backend
					require("node:child_process").spawnSync("cmd.exe", [
						"/c",
						'taskkill /f /im python.exe /fi "WINDOWTITLE eq *local-operator*" /t',
					]);

					// Also try to kill any local-operator.exe processes directly
					require("node:child_process").spawnSync("cmd.exe", [
						"/c",
						"taskkill /f /im local-operator.exe /t",
					]);
				} catch (err) {
					// Ignore errors, this is a best-effort cleanup
				}
			} else {
				// On Unix systems, look for processes with "local-operator serve" in the command line
				try {
					require("node:child_process").spawnSync("bash", [
						"-c",
						`ps aux | grep "local-operator serve" | grep -v grep | awk '{print $2}' | xargs -r kill -15`,
					]);

					// Give processes a moment to terminate gracefully before force killing
					require("node:child_process").spawnSync("bash", [
						"-c",
						`sleep 1 && ps aux | grep "local-operator serve" | grep -v grep | awk '{print $2}' | xargs -r kill -9`,
					]);
				} catch (err) {
					// Ignore errors, this is a best-effort cleanup
				}
			}
		} else if (
			!process.env.VITE_DISABLE_BACKEND_MANAGER &&
			backendService.isUsingExternalBackend()
		) {
			logger.info(
				"Using external backend, skipping force termination",
				LogFileType.BACKEND,
			);
		}
	} catch (error) {
		logger.error("Error in exit handler", LogFileType.BACKEND, error);
	}

	posthogClient.shutdown();
});

// Handle uncaught exceptions to ensure backend is terminated
process.on("uncaughtException", (error) => {
	logger.error("Uncaught exception", LogFileType.BACKEND, error);

	// Only attempt to stop the backend service if we started it ourselves
	if (
		backendService &&
		!process.env.VITE_DISABLE_BACKEND_MANAGER &&
		!backendService.isUsingExternalBackend()
	) {
		logger.info(
			"Attempting to stop our backend service due to uncaught exception",
			LogFileType.BACKEND,
		);

		// First try the normal stop method
		backendService
			.stop()
			.catch((stopError) => {
				logger.error(
					"Error stopping the Local Operator backend service:",
					LogFileType.BACKEND,
					stopError,
				);

				// If normal stop fails, try the more targeted approach
				logger.info(
					"Trying alternative termination approach",
					LogFileType.BACKEND,
				);

				if (process.platform === "win32") {
					// On Windows, use taskkill to find and kill python and local-operator processes
					try {
						// Use taskkill to find and kill python processes that might be running the backend
						require("node:child_process").spawnSync("cmd.exe", [
							"/c",
							'taskkill /f /im python.exe /fi "WINDOWTITLE eq *local-operator*" /t',
						]);

						// Also try to kill any local-operator.exe processes directly
						require("node:child_process").spawnSync("cmd.exe", [
							"/c",
							"taskkill /f /im local-operator.exe /t",
						]);
					} catch (err) {
						// Ignore errors, this is a best-effort cleanup
					}
				} else {
					// On Unix systems, look for processes with "local-operator serve" in the command line
					try {
						require("node:child_process").spawnSync("bash", [
							"-c",
							`ps aux | grep "local-operator serve" | grep -v grep | awk '{print $2}' | xargs -r kill -15`,
						]);

						// Give processes a moment to terminate gracefully before force killing
						require("node:child_process").spawnSync("bash", [
							"-c",
							`sleep 1 && ps aux | grep "local-operator serve" | grep -v grep | awk '{print $2}' | xargs -r kill -9`,
						]);
					} catch (err) {
						// Ignore errors, this is a best-effort cleanup
					}
				}
			})
			.finally(() => {
				// Force exit after a timeout
				setTimeout(() => {
					logger.info(
						"Forcing app exit after uncaught exception",
						LogFileType.BACKEND,
					);
					process.exit(1);
				}, 1000);
			});
	} else if (
		backendService &&
		!process.env.VITE_DISABLE_BACKEND_MANAGER &&
		backendService.isUsingExternalBackend()
	) {
		logger.info(
			"Using external backend, skipping termination on uncaught exception",
			LogFileType.BACKEND,
		);
		// Just exit without stopping the external backend
		process.exit(1);
	} else {
		// If no backend service or disabled, just exit
		process.exit(1);
	}
});

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
