import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url"; // Added pathToFileURL
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
	BrowserWindow,
	Menu,
	app,
	dialog,
	globalShortcut, // Added globalShortcut
	ipcMain,
	nativeImage,
	shell,
} from "electron";
import { PostHog } from "posthog-node";
import icon from "../../resources/icon.png?asset";
import type { Agent, PaginatedAgentList, RadientApiResponse } from "../renderer/src/shared/api/radient/types";
import {
	BackendInstaller,
	BackendServiceManager,
	LocalOperatorStartupMode,
} from "./backend";
import { backendConfig } from "./backend/config";
import { LogFileType, logger } from "./backend/logger";
import { OAuthService } from "./oauth-service";
import { Store, type StoreData } from "./store";
import { UpdateService } from "./update-service";

export type ReadFileResponse =
	| { success: true; data: string }
	| { success: false; error: unknown }; // or use `string` if you always send error.message

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
			preload: is.dev 
				? join(__dirname, "../../out/preload/index.js") 
				: join(__dirname, "../preload/index.js"), // Revised dev path using __dirname
			sandbox: false,
			// Only enable devTools when running with 'pnpm dev'
			// Disable for 'pnpm start' and production builds
			devTools: Boolean(process.env.ELECTRON_RENDERER_URL),
			// Security settings
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
		},
	});

	mainWindow.on("ready-to-show", () => {
		mainWindow.show();
	});

	mainWindow.webContents.setWindowOpenHandler((details) => {
		// Allow popups from authentication providers
		const url = new URL(details.url);

		// Expanded list of trusted authentication domains
		const trustedAuthDomains = [
			// Google auth domains
			"accounts.google.com",
			"oauth.googleusercontent.com",
			"content.googleapis.com",
			"ssl.gstatic.com",

			// Microsoft auth domains
			"login.microsoftonline.com",
			"login.live.com",
			"login.windows.net",
			"login.microsoft.com",
			"microsoftonline.com",
			"msauth",
			"msftauth",

			// Auth relay domains
			"storagerelay",

			// Special case for initial blank page
			"about:blank",
		];

		// Check if the URL is from a trusted authentication provider
		const isTrustedAuthDomain =
			// Special case for about:blank which is used by MSAL to initialize the popup
			details.url === "about:blank" ||
			// Check other trusted domains
			trustedAuthDomains.some(
				(domain) =>
					url.hostname.includes(domain) ||
					url.protocol.includes(domain) ||
					// Special case for storage relay URLs
					details.url.startsWith("storagerelay:") ||
					details.url.includes("storagerelay"),
			);

		if (isTrustedAuthDomain) {
			// Allow the popup for authentication with improved features
			return {
				action: "allow",
				features: {
					width: 800,
					height: 700, // Increased height for better visibility
					minWidth: 600,
					minHeight: 500,
					center: true,
					frame: true,
					autoHideMenuBar: false,
					backgroundColor: "#FFFFFF",
					webPreferences: {
						contextIsolation: true,
						nodeIntegration: false,
						webSecurity: true,
						allowRunningInsecureContent: false,
						sandbox: true, // Enable sandbox for additional security
						// Disable various features that aren't needed for auth
						enableWebSQL: false,
						navigateOnDragDrop: false,
						spellcheck: false,
					},
				},
			};
		}

		// For all other URLs, open in external browser and deny the popup
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

// Initialize session store (used by OAuthService and session handlers)
// Wrap initialization in try-catch to handle potential cache corruption
let sessionStore: Store<StoreData>;
try {
	sessionStore = new Store<StoreData>({
		name: "session",
		defaults: {
			// Radient token fields
			radient_access_token: undefined,
			radient_refresh_token: undefined,
			radient_token_expiry: undefined,

			// OAuth fields
			oauth_provider: undefined,
			oauth_access_token: undefined,
			oauth_id_token: undefined,
			oauth_expiry: undefined,

			// Global hotkey
			global_hotkey: "CommandOrControl+Shift+O", // Default hotkey
		},
	});
	logger.info("Session store initialized successfully.", LogFileType.BACKEND);
} catch (error) {
	logger.error(
		"Initial session store initialization failed.",
		LogFileType.BACKEND,
		error,
	);
	// The Store constructor now handles recovery from JSON parsing errors.
	// If an error reaches this point, it's likely unrecoverable or a different type.
	dialog.showErrorBox(
		"Application Error",
		`Failed to initialize application settings. Please restart the application. Error: ${error instanceof Error ? error.message : "Unknown error"}`,
	);
	app.quit();
	// Re-throw the error to prevent further execution
	throw error;
}

// Critical check: Ensure sessionStore is initialized before proceeding.
// The logic above should either succeed, quit, or throw, making this mostly a safeguard.
if (!sessionStore) {
	// Use error instead of fatal
	logger.error(
		"Session store could not be initialized. Quitting.",
		LogFileType.BACKEND,
	);
	dialog.showErrorBox(
		"Fatal Error",
		"Application could not initialize critical settings. Quitting.",
	);
	app.quit();
	// Throw to prevent any further execution in this unlikely scenario
	throw new Error("Session store initialization failed critically.");
}

// Initialize OAuth service (now guaranteed to have a valid sessionStore)
// Moved declaration outside the try-catch block to avoid redeclaration issues
const oauthService = new OAuthService(sessionStore);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// Define mainWindow at a higher scope to be accessible in event handlers
let mainWindow: BrowserWindow | null = null;
let popupWindow: BrowserWindow | null = null; // Added popupWindow


// --- Popup Window Creation ---
function createPopupWindow(): void {
	if (popupWindow && !popupWindow.isDestroyed()) {
		popupWindow.focus();
		return;
	}

	popupWindow = new BrowserWindow({
		width: 480, // Increased width for MessageInput
		height: 420, // Increased height for MessageInput
    frame: false,
		alwaysOnTop: true,
    resizable: false, // Keep non-resizable for now, can be changed
		movable: true, // Allow moving the window
		show: false, // Start hidden
		
		skipTaskbar: true, // Don't show in taskbar
		webPreferences: {
			nodeIntegration: false, 
			contextIsolation: true, 
			preload: is.dev 
				? join(__dirname, "../../out/preload/index.js") // Use main preload (index.js)
				: join(__dirname, "../preload/index.js"),       // Use main preload (index.js)
			sandbox: false, 
			webSecurity: true, 
		},
	});

	// Load popup.html from dev server in development, or from file in production
	if (is.dev && process.env.ELECTRON_RENDERER_URL) {
		// Open DevTools for the popup window in development for debugging
		if (popupWindow && popupWindow.webContents && !popupWindow.webContents.isDevToolsOpened()) {
			popupWindow.webContents.openDevTools({ mode: 'detach' });
		}
		// Ensure ELECTRON_RENDERER_URL is treated as a base URL
		const devServerBaseUrl = process.env.ELECTRON_RENDERER_URL.endsWith('/')
			? process.env.ELECTRON_RENDERER_URL
			: `${process.env.ELECTRON_RENDERER_URL}/`;
		const popupDevUrl = new URL("popup.html", devServerBaseUrl).href;
		popupWindow.loadURL(popupDevUrl);
		logger.info(`Popup window loading from dev server: ${popupDevUrl}`, LogFileType.BACKEND);
	} else {
		const popupHtmlPath = join(__dirname, "../renderer/popup.html");
		const popupFileUrl = pathToFileURL(popupHtmlPath).href;
		popupWindow.loadURL(popupFileUrl);
		logger.info(`Popup window loading from file: ${popupFileUrl}`, LogFileType.BACKEND);
	}

	popupWindow.on("closed", () => {
		popupWindow = null;
	});

	// Hide the popup window when it loses focus
	popupWindow.on("blur", () => {
		if (popupWindow && popupWindow.isVisible()) {
			popupWindow.hide();
		}
	});
}

// --- Global Shortcut Registration ---
function registerGlobalShortcut(hotkeyToRegister = "CommandOrControl+Shift+O"): void {
	globalShortcut.unregisterAll(); // Unregister any existing shortcuts

	const success = globalShortcut.register(hotkeyToRegister, () => {
		if (!popupWindow || popupWindow.isDestroyed()) {
			createPopupWindow();
		}

		// This check is important because createPopupWindow is async in nature with loadFile
		// We need to ensure popupWindow is valid before interacting
		if (popupWindow && !popupWindow.isDestroyed()) {
			if (popupWindow.isVisible()) {
				popupWindow.hide();
			} else {
				// Ensure the window is ready before showing, especially if newly created
				if (popupWindow.webContents.isLoading()) {
					popupWindow.once("ready-to-show", () => {
						popupWindow?.show();
						popupWindow?.focus();
					});
				} else {
					popupWindow.show();
					popupWindow.focus();
				}
			}
		} else {
			// Fallback if popupWindow is still not available (e.g. creation failed)
			// This might happen if createPopupWindow() was called but didn't complete successfully
			// or if it was destroyed right after creation.
			logger.warn("Popup window not available to show/hide.", LogFileType.BACKEND);
			// Attempt to create it again, then show.
			createPopupWindow(); 
			if (popupWindow && !popupWindow.isDestroyed()) {
				if (popupWindow.webContents.isLoading()) {
					popupWindow.once("ready-to-show", () => {
						popupWindow?.show();
						popupWindow?.focus();
					});
				} else {
					popupWindow.show();
					popupWindow.focus();
				}
			}
		}
	});

	if (!success) {
		logger.error(
			`Failed to register global shortcut: ${hotkeyToRegister}`,
			LogFileType.BACKEND,
		);
		dialog.showErrorBox(
			"Hotkey Registration Failed",
			`Could not register the hotkey "${hotkeyToRegister}". It might be in use by another application or an invalid combination.`,
		);
	} else {
		logger.info(
			`Global shortcut registered: ${hotkeyToRegister}`,
			LogFileType.BACKEND,
		);
	}
}

// --- Single Instance Lock ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	logger.warn("Another instance is already running. Quitting this instance.");
	app.quit();
} else {
	app.on("second-instance", (_event, commandLine) => {
		// Someone tried to run a second instance, we should focus our window.
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();

			// Handle protocol URL if passed via command line (Windows/Linux)
			const url = commandLine.find((arg) => arg.startsWith("radient://"));
			if (url) {
				logger.info(
					`Received URL via second-instance: ${url}`,
					LogFileType.OAUTH,
				);
				oauthService.completeAuthorizationRequest(url);
			}
		}
	});
}

// --- Protocol Handling ---
// Register the custom protocol
if (process.defaultApp) {
	if (process.argv.length >= 2) {
		app.setAsDefaultProtocolClient("radient", process.execPath, [
			join(process.cwd(), process.argv[1]),
		]);
	}
} else {
	app.setAsDefaultProtocolClient("radient");
}

app
	.whenReady()
	.then(async () => {
		// Set app user model id for windows
		electronApp.setAppUserModelId("com.local-operator");

		// Handle 'open-url' event (macOS)
		app.on("open-url", (event, url) => {
			event.preventDefault(); // Prevent default handling
			if (url.startsWith("radient://")) {
				logger.info(
					`Received URL via open-url (macOS): ${url}`,
					LogFileType.OAUTH,
				);
				if (mainWindow) {
					// Bring window to front
					if (mainWindow.isMinimized()) mainWindow.restore();
					mainWindow.focus();
					oauthService.completeAuthorizationRequest(url);
				} else {
					// Handle case where app was launched via URL before window was ready
					// Store the URL and process it once the window is created?
					// For now, log a warning. This might need refinement.
					logger.warn(
						"Received open-url event before mainWindow was ready.",
						LogFileType.OAUTH,
					);
				}
			}
		});

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

		ipcMain.handle(
			"read-file",
			async (_, filePath: string): Promise<ReadFileResponse> => {
				try {
					const data = readFileSync(filePath, "utf-8");
					return { success: true, data };
				} catch (error) {
					logger.error("Error reading file:", LogFileType.BACKEND, error);
					return { success: false, error };
				}
			},
		);

		ipcMain.handle("open-external", async (_, url) => {
			try {
				await shell.openExternal(url);
			} catch (error) {
				console.error("Error opening URL:", error);
			}
		});

		// --- Directory Selection IPC Handler ---
		ipcMain.handle("select-directory", async () => {
			// Ensure mainWindow is available
			if (!mainWindow) {
				logger.error(
					"Cannot show select directory dialog: mainWindow is not available.",
					LogFileType.BACKEND,
				);
				return undefined;
			}
			const result = await dialog.showOpenDialog(mainWindow, {
				properties: ["openDirectory"],
				title: "Select Working Directory", // More appropriate title
				buttonLabel: "Select Folder", // Correct button label
			});

			if (!result.canceled && result.filePaths.length > 0) {
				return result.filePaths[0]; // Return the selected path
			}
			return undefined; // Return undefined if canceled or no path selected
		});

		// --- Session storage handlers (using the already initialized sessionStore) ---
		ipcMain.handle("get-session", () => {
			const accessToken = sessionStore.get("radient_access_token");
			const refreshToken = sessionStore.get("radient_refresh_token");
			const expiry = sessionStore.get("radient_token_expiry");
			return { accessToken, refreshToken, expiry };
		});

		ipcMain.handle(
			"store-session",
			(_event, accessToken: string, expiry: number, refreshToken?: string) => {
				sessionStore.set("radient_access_token", accessToken);
				sessionStore.set("radient_token_expiry", expiry);

				// Only set refresh token if provided
				if (refreshToken) {
					sessionStore.set("radient_refresh_token", refreshToken);
				}

				return true;
			},
		);

		ipcMain.handle("clear-session", () => {
			sessionStore.delete("radient_access_token");
			sessionStore.delete("radient_refresh_token");
			sessionStore.delete("radient_token_expiry");
			sessionStore.delete("oauth_access_token");
			sessionStore.delete("oauth_id_token");
			sessionStore.delete("oauth_expiry");
			sessionStore.delete("oauth_provider");
			return true;
		});

		// Add IPC handlers for system information
		ipcMain.handle("get-app-version", () => {
			return app.getVersion();
		});

		// Add IPC handler to get the user's home directory
		ipcMain.handle("get-home-directory", () => {
			return app.getPath("home");
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

		// --- Check Provider Auth IPC Handler ---
		ipcMain.handle("ipc-check-provider-auth", () => {
			// Check if any provider credentials are set beyond the default placeholders
			const googleConfigured =
				backendConfig.VITE_GOOGLE_CLIENT_ID &&
				backendConfig.VITE_GOOGLE_CLIENT_ID !== "REPL_VITE_GOOGLE_CLIENT_ID" &&
				backendConfig.VITE_GOOGLE_CLIENT_SECRET &&
				backendConfig.VITE_GOOGLE_CLIENT_SECRET !==
					"REPL_VITE_GOOGLE_CLIENT_SECRET";

			const microsoftConfigured =
				backendConfig.VITE_MICROSOFT_CLIENT_ID &&
				backendConfig.VITE_MICROSOFT_CLIENT_ID !==
					"REPL_VITE_MICROSOFT_CLIENT_ID" &&
				backendConfig.VITE_MICROSOFT_TENANT_ID &&
				backendConfig.VITE_MICROSOFT_TENANT_ID !==
					"REPL_VITE_MICROSOFT_TENANT_ID";

			// Return true if either Google or Microsoft credentials are configured
			return googleConfigured || microsoftConfigured;
		});

		// --- OAuth IPC Handlers ---
		ipcMain.handle(
			"oauth-login",
			async (_event, provider: "google" | "microsoft") => {
				logger.info(
					`IPC: Received oauth-login request for ${provider}`,
					LogFileType.OAUTH,
				);
				try {
					// Input validation (simple check for known providers)
					if (provider !== "google" && provider !== "microsoft") {
						throw new Error(`Invalid OAuth provider: ${provider}`);
					}
					await oauthService.initiateLogin(provider);
					return { success: true };
				} catch (error) {
					const errorMsg =
						error instanceof Error
							? error.message
							: "Unknown error during login initiation";
					logger.error(
						`IPC: Error during oauth-login for ${provider}: ${errorMsg}`,
						LogFileType.OAUTH,
						error,
					);
					return { success: false, error: errorMsg };
				}
			},
		);

		ipcMain.handle("oauth-logout", async () => {
			logger.info("IPC: Received oauth-logout request", LogFileType.OAUTH);
			try {
				await oauthService.logout();
				return { success: true };
			} catch (error) {
				const errorMsg =
					error instanceof Error
						? error.message
						: "Unknown error during logout";
				logger.error(
					`IPC: Error during oauth-logout: ${errorMsg}`,
					LogFileType.OAUTH,
					error,
				);
				return { success: false, error: errorMsg };
			}
		});

		ipcMain.handle("oauth-get-status", async () => {
			logger.info("IPC: Received oauth-get-status request", LogFileType.OAUTH);
			try {
				const status = await oauthService.getStatus();
				return { success: true, status };
			} catch (error) {
				const errorMsg =
					error instanceof Error
						? error.message
						: "Unknown error getting status";
				logger.error(
					`IPC: Error during oauth-get-status: ${errorMsg}`,
					LogFileType.OAUTH,
					error,
				);
				return { success: false, error: errorMsg };
			}
		});

		// Check if backend manager is disabled via environment variable
		const isBackendManagerDisabled =
			process.env.VITE_DISABLE_BACKEND_MANAGER === "true";

		if (!isBackendManagerDisabled) {
			// Check if an external backend is already running
			const hasExternalBackend = await backendService.checkExistingBackend();

			if (!hasExternalBackend) {
				// Check if local-operator command exists globally
				const hasGlobalCommand =
					await backendService.checkLocalOperatorExists();

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

		// --- Helper to manage main window and update service lifecycle ---
		let updateService: UpdateService | null = null;

		function setupMainWindowWithUpdateService() {
			mainWindow = createWindow();

			// Pass window reference to OAuthService
			oauthService.setMainWindow(mainWindow);

			// Clean up any previous update service
			if (updateService) {
				updateService.dispose();
				updateService = null;
			}

			// Initialize the update service with a reference to the backend service
			updateService = new UpdateService(mainWindow, backendService);

			// Clean up update service and mainWindow reference when the window is closed
			mainWindow.on("closed", () => {
				if (updateService) {
					updateService.dispose();
					updateService = null;
				}
				mainWindow = null;
			});

			// Set up IPC handlers for the update service
			updateService.setupIpcHandlers();

			// Handle platform-specific setup for the updater
			updateService.handlePlatformSpecifics();

			// Check for all updates (UI and backend) after a short delay to ensure the app is fully loaded
			setTimeout(() => {
				updateService?.checkForAllUpdates(true);
			}, 3000);
		}

		// Initial window + update service setup
		setupMainWindowWithUpdateService();

		// Create the popup window (it starts hidden) and register the global shortcut
		// Deferring popup creation until first hotkey press is also an option
		// createPopupWindow(); // Create it initially but hidden
		
		// Load saved hotkey or use default, then register
		const OLD_DEFAULT_HOTKEY = "CommandOrControl+Shift+P";
		const NEW_DEFAULT_HOTKEY = "CommandOrControl+Shift+O";

		let currentHotkeySetting = sessionStore.get("global_hotkey") as string | undefined;

		// Migration: If the stored hotkey is the old default, update it to the new default.
		if (currentHotkeySetting === OLD_DEFAULT_HOTKEY) {
			logger.info(
				`Migrating stored hotkey from old default "${OLD_DEFAULT_HOTKEY}" to new default "${NEW_DEFAULT_HOTKEY}".`,
				LogFileType.BACKEND,
			);
			sessionStore.set("global_hotkey", NEW_DEFAULT_HOTKEY);
			currentHotkeySetting = NEW_DEFAULT_HOTKEY;
		} else if (!currentHotkeySetting) {
			// If no hotkey is stored at all (e.g. very first run or cleared store),
			// ensure it's initialized to the new default.
			// The store defaults should handle this, but this is an explicit safeguard.
			logger.info(
				`No hotkey stored, ensuring it is set to default "${NEW_DEFAULT_HOTKEY}".`,
				LogFileType.BACKEND,
			);
			// sessionStore.set("global_hotkey", NEW_DEFAULT_HOTKEY); // This is already handled by store defaults.
			currentHotkeySetting = NEW_DEFAULT_HOTKEY;
		}
		// If currentHotkeySetting was a user-customized value (neither old default nor empty), it remains as is.
		
		registerGlobalShortcut(currentHotkeySetting || NEW_DEFAULT_HOTKEY); // Use stored/migrated/new default, with a final fallback.


		// IPC handler for setting a new hotkey from renderer process
		ipcMain.on("set-hotkey", (_event, hotkey: string) => {
			if (typeof hotkey === "string" && hotkey.length > 0) {
				logger.info(`Received set-hotkey event with hotkey: ${hotkey}`, LogFileType.BACKEND);
				sessionStore.set("global_hotkey", hotkey);
				registerGlobalShortcut(hotkey);
			} else {
				logger.warn(`Received invalid hotkey value: ${hotkey}`, LogFileType.BACKEND);
			}
		});

		// IPC handler for messages sent from the popup's MessageInput
		ipcMain.on('popup-send-message', async (_event, message: { content: string; attachments: string[] }) => {
			logger.info(
				`Received message from popup: Content="${message.content}", Attachments=${message.attachments.length}`,
				LogFileType.BACKEND
			);

			try {
				// 1. Fetch agents

				logger.info('1', LogFileType.BACKEND);
				const agentsApiUrl = `${backendConfig.VITE_LOCAL_OPERATOR_API_URL}/v1/agents`; // Corrected path
				logger.info(`Fetching agents from: ${agentsApiUrl}`, LogFileType.BACKEND);
				const agentsResponse = await fetch(agentsApiUrl);
				if (!agentsResponse.ok) {
					throw new Error(`Failed to fetch agents: ${agentsResponse.status} ${agentsResponse.statusText}`);
				}
				// Assuming the response is a JSON array of agent objects
				// const agents = (await agentsResponse.json()) as Agent[];
				const result = await agentsResponse.json()
        const agents = result.result.agents
        console.log({1:result, 2: result.result, 3: result.result.agents})
				logger.info(`Fetched ${agents.length} agents.`, LogFileType.BACKEND);

				if (agents.length === 0) {
					logger.warn("No agents available to send message to.", LogFileType.BACKEND);
					dialog.showErrorBox("No Agents", "There are no agents available to send the message to.");
					return;
				}

				const firstAgent = agents[0];
				logger.info(`Selected first agent: ID=${firstAgent.id}`, LogFileType.BACKEND);

				// 2. Send message to the first agent
				logger.info('2', LogFileType.BACKEND);
				// Assuming an endpoint like /api/v1/jobs or /api/v1/agents/{agent_id}/chat
				// 2. Send message to the first agent using /v1/chat/agents/{agentId}/async
				const sendMessageApiUrl = `${backendConfig.VITE_LOCAL_OPERATOR_API_URL}/v1/chat/agents/${firstAgent.id}/async`;
				
				// Construct payload according to AgentChatRequest type
				const messagePayload: {
					hosting: string;
					model: string;
					prompt: string;
					stream?: boolean;
					persist_conversation?: boolean;
					attachments?: string[];
					// options?: ChatOptions; // Not including options for simplicity now
				} = {
					hosting: firstAgent.hosting || "",
					model: firstAgent.model || "",
					prompt: message.content,
					attachments: message.attachments.length > 0 ? message.attachments : undefined,
					stream: false, // Default, can be omitted
					persist_conversation: true, // Assuming we want to save this message
				};

				if (!firstAgent.hosting) {
					logger.warn(
						`Agent ${firstAgent.id} is missing 'hosting' information. Defaulting to empty string.`,
						LogFileType.BACKEND,
					);
				}
				if (!firstAgent.model) {
					logger.warn(
						`Agent ${firstAgent.id} is missing 'model' information. Defaulting to empty string.`,
						LogFileType.BACKEND,
					);
				}

				logger.info(`Sending message to agent ${firstAgent.id} via: ${sendMessageApiUrl} with payload: ${JSON.stringify(messagePayload)}`, LogFileType.BACKEND);
				const sendMessageResponse = await fetch(sendMessageApiUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(messagePayload),
				});

				if (!sendMessageResponse.ok) {
					const errorBody = await sendMessageResponse.text();
					throw new Error(`Failed to send message to agent: ${sendMessageResponse.status} ${sendMessageResponse.statusText} - ${errorBody}`);
				}

				const jobResult = await sendMessageResponse.json();
				logger.info(`Message sent successfully to agent ${firstAgent.id}. Job ID: ${jobResult.id || 'N/A'}`, LogFileType.BACKEND);
				
				// Notify the main window's renderer about the new message/job
				if (mainWindow) {
					mainWindow.webContents.send('message-sent-from-popup', {
						agentId: firstAgent.id,
						jobId: jobResult.id || null, // Or however the job ID is returned
						message, // The original message content and attachments
					});
				}

			} catch (error) {
				logger.error("Error processing message from popup:", LogFileType.BACKEND, error);
				const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
				dialog.showErrorBox("Error Sending Message", `Could not send message from popup: ${errorMessage}`);
			} finally {
				// Focus main window and hide popup regardless of success/failure of sending
				if (mainWindow) {
					if (mainWindow.isMinimized()) mainWindow.restore();
					mainWindow.focus();
				}
				if (popupWindow && popupWindow.isVisible()) {
					popupWindow.hide();
				}
			}
		});

		app.on("activate", () => {
			// On macOS it's common to re-create a window in the app when the
			// dock icon is clicked and there are no other windows open.
			if (BrowserWindow.getAllWindows().length === 0) {
				setupMainWindowWithUpdateService();
			}
		});
	})
	.catch((error) => {
		logger.error("Error initializing app:", LogFileType.BACKEND, error);
		app.quit();
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
	// Unregister all shortcuts when the application is about to quit.
	globalShortcut.unregisterAll();
	logger.info("Unregistered all global shortcuts.", LogFileType.BACKEND);

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
				} catch (_err) {
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
				} catch (_err) {
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
				} catch (_err) {
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
				} catch (_err) {
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
					} catch (_err) {
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
					} catch (_err) {
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
