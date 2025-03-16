import { join } from "node:path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
	BrowserWindow,
	Menu,
	app,
	ipcMain,
	nativeImage,
	shell,
} from "electron";
import icon from "../../resources/icon-180x180-dark.png?asset";
import { BackendInstaller, BackendServiceManager } from "./backend";
import { UpdateService } from "./update-service";

// Set application name
app.setName("Local Operator");
const image = nativeImage.createFromPath(icon);
// Set dock icon on macOS only
if (process.platform === "darwin" && app.dock) {
	app.dock.setIcon(image);
}

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
			// Only enable devTools when running with 'yarn dev'
			// Disable for 'yarn start' and production builds
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
				// If installation was cancelled, quit the app
				if (!installSuccess) {
					console.log("Backend installation cancelled by user, quitting app");
					app.quit();
					return; // Exit early to prevent window creation
				}
			}

			// Start our backend service
			await backendService.start();
		}
	}

	// Create custom application menu
	createApplicationMenu();

	// Create the main window
	const mainWindow = createWindow();

	// Initialize the update service
	const updateService = new UpdateService(mainWindow);

	// Set up IPC handlers for the update service
	updateService.setupIpcHandlers();

	// Handle platform-specific setup for the updater
	updateService.handlePlatformSpecifics();

	// Check for updates after a short delay to ensure the app is fully loaded
	setTimeout(() => {
		updateService.checkForUpdates(true);
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
	if (process.platform !== "darwin") {
		app.quit();
	}
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
			console.log("App is quitting, stopping our backend service...");
			// Stop the backend service and wait for it to fully terminate
			await backendService.stop();
			console.log("Backend service successfully stopped");

			// Add an additional targeted cleanup as a failsafe
			console.log(
				"Performing additional cleanup to ensure complete termination",
			);

			if (process.platform === "win32") {
				// On Windows, look for processes with "local-operator serve" in the command line
				try {
					require("node:child_process").execSync(
						`wmic process where "commandline like '%local-operator serve%'" call terminate`,
						{ stdio: "ignore" },
					);
				} catch (err) {
					// Ignore errors, this is a best-effort cleanup
				}
			} else {
				// On Unix systems, look for processes with "local-operator serve" in the command line
				try {
					require("node:child_process").execSync(
						`ps aux | grep "local-operator serve" | grep -v grep | awk '{print $2}' | xargs -r kill -15`,
						{ stdio: "ignore" },
					);
				} catch (err) {
					// Ignore errors, this is a best-effort cleanup
				}
			}
		} catch (error) {
			console.error("Error stopping backend service:", error);

			// If the normal stop failed, try the targeted approach
			console.log("Trying alternative termination approach");

			if (process.platform === "win32") {
				// On Windows, look for processes with "local-operator serve" in the command line
				try {
					require("node:child_process").execSync(
						`wmic process where "commandline like '%local-operator serve%'" call terminate`,
						{ stdio: "ignore" },
					);
				} catch (err) {
					// Ignore errors, this is a best-effort cleanup
				}
			} else {
				// On Unix systems, look for processes with "local-operator serve" in the command line
				try {
					require("node:child_process").execSync(
						`ps aux | grep "local-operator serve" | grep -v grep | awk '{print $2}' | xargs -r kill -15`,
						{ stdio: "ignore" },
					);

					// Give processes a moment to terminate gracefully before force killing
					require("node:child_process").execSync(
						`sleep 1 && ps aux | grep "local-operator serve" | grep -v grep | awk '{print $2}' | xargs -r kill -9`,
						{ stdio: "ignore" },
					);
				} catch (err) {
					// Ignore errors, this is a best-effort cleanup
				}
			}
		} finally {
			// Ensure app quits even if there was an error stopping the service
			// Use a longer timeout to ensure the process has time to fully terminate
			console.log("Exiting application...");
			setTimeout(() => {
				console.log("Forcing app exit");
				app.exit(0);
			}, 1000); // Increased timeout to 1 second
		}
	} else if (
		!isBackendManagerDisabled &&
		backendService.isUsingExternalBackend()
	) {
		console.log("Using external backend, skipping termination on app quit");
	}
});

// Handle before-quit event to ensure proper cleanup
app.on("before-quit", () => {
	console.log("App is about to quit");
});

// Add a failsafe to ensure child processes are terminated when the app exits
process.on("exit", () => {
	console.log("Process exit event detected, ensuring backend is terminated");
	// This is a synchronous event, so we can't use async/await here
	try {
		// Force kill any remaining child processes, but ONLY if we started our own backend
		// and not if we're using an external backend
		if (
			!process.env.VITE_DISABLE_BACKEND_MANAGER &&
			!backendService.isUsingExternalBackend()
		) {
			console.log("Forcing termination of our backend process");

			// Use a more targeted approach to avoid affecting other services
			// We'll only try to find and terminate processes that look like our backend
			console.log(
				"Performing final cleanup of any remaining backend processes",
			);

			if (process.platform === "win32") {
				// On Windows, look for processes with "local-operator serve" in the command line
				try {
					// First try a more targeted approach that won't affect other services
					require("node:child_process").spawnSync("cmd.exe", [
						"/c",
						`wmic process where "commandline like '%local-operator serve%'" call terminate`,
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
			console.log("Using external backend, skipping force termination");
		}
	} catch (error) {
		console.error("Error in exit handler:", error);
	}
});

// Handle uncaught exceptions to ensure backend is terminated
process.on("uncaughtException", (error) => {
	console.error("Uncaught exception:", error);

	// Only attempt to stop the backend service if we started it ourselves
	if (
		backendService &&
		!process.env.VITE_DISABLE_BACKEND_MANAGER &&
		!backendService.isUsingExternalBackend()
	) {
		console.log(
			"Attempting to stop our backend service due to uncaught exception",
		);

		// First try the normal stop method
		backendService
			.stop()
			.catch((stopError) => {
				console.error("Error stopping backend service:", stopError);

				// If normal stop fails, try the more targeted approach
				console.log("Trying alternative termination approach");

				if (process.platform === "win32") {
					// On Windows, look for processes with "local-operator serve" in the command line
					try {
						require("node:child_process").spawnSync("cmd.exe", [
							"/c",
							`wmic process where "commandline like '%local-operator serve%'" call terminate`,
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
					console.log("Forcing app exit after uncaught exception");
					process.exit(1);
				}, 1000);
			});
	} else if (
		backendService &&
		!process.env.VITE_DISABLE_BACKEND_MANAGER &&
		backendService.isUsingExternalBackend()
	) {
		console.log(
			"Using external backend, skipping termination on uncaught exception",
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
