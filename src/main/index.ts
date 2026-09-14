import { readFileSync, writeFileSync } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
	BrowserWindow,
	Menu,
	app,
	dialog,
	globalShortcut,
	ipcMain,
	nativeImage,
	shell,
} from "electron";
import { PostHog } from "posthog-node";
import icon from "../../resources/icon.png?asset";
import {
	MAX_FILE_READ_BYTES,
	MAX_PROBE_PATHS,
	type ProbedFile,
	type ReadFileBytesResponse,
} from "../shared/desktop-contract";
import {
	BackendInstaller,
	BackendServiceManager,
	LocalOperatorStartupMode,
} from "./backend";
import { backendConfig } from "./backend/config";
import { LogFileType, logger } from "./backend/logger";
import {
	browserHostEnabled,
	startBrowserHost,
	stopBrowserHost,
} from "./browser";
import { guardForegroundReceipts, registerDesktopIPC } from "./desktop-ipc";
import { DesktopNotifier } from "./desktop-notifier";
import {
	rememberPickedDirectory,
	withRememberedDirectory,
} from "./picker-directory";
import { UpdateService } from "./update-service";
import {
	WINDOW_MIN_HEIGHT,
	WINDOW_MIN_WIDTH,
	describeWindowLaunch,
	resolveWindowLaunchPlan,
} from "./window-mode";
import { presentWindow, raiseWindow } from "./window-raise";

const BASE64_FILE_EXTENSIONS = ["csv", "tsv", "xls", "xlsx", "ods"];

/**
 * The ONE path-resolution rule for every local-file IPC handler.
 *
 * Four handlers used to spell it themselves (`read-file`, `save-file`,
 * `file-exists`, and `directory-exists` with a third variant that also accepted
 * a bare `~`), and a fifth spelling is exactly how the panel would end up
 * disagreeing with the editor about which file a path names. `~` is expanded
 * here because this is the only process that has `app.getPath("home")`; the
 * renderer deliberately never guesses a home directory.
 *
 * `cwd` is for the one caller that has one — `probe-files` — where a relative
 * candidate from a tool argument is resolvable against the session's working
 * directory. It is applied only to a relative path, so an absolute path is
 * always taken literally.
 */
const resolveUserPath = (filePath: string, cwd?: string): string => {
	if (filePath === "~") return app.getPath("home");
	if (filePath.startsWith("~/"))
		return join(app.getPath("home"), filePath.slice(2));
	if (cwd && !filePath.startsWith("/"))
		return join(cwd.startsWith("~/") ? resolveUserPath(cwd) : cwd, filePath);
	return filePath;
};

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
/**
 * Where a picker opens when this session has nothing to remember yet: the
 * directory Electron used before 43 made Downloads the default. Read at call
 * time rather than cached at import, because these handlers only ever run after
 * `app.whenReady()` and `app.getPath` is not safe before that.
 */
function pickerFallbackDirectory(): string {
	return app.getPath("home");
}

function createApplicationMenu(): void {
	// Check if we're in development mode
	const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

	// Define zoom functions
	const zoomInHandler = () => {
		if (mainWindow) {
			const webContents = mainWindow.webContents;
			const currentZoom = webContents.getZoomFactor();
			webContents.setZoomFactor(currentZoom + 0.1);
		}
	};

	const zoomOutHandler = () => {
		if (mainWindow) {
			const webContents = mainWindow.webContents;
			const currentZoom = webContents.getZoomFactor();
			webContents.setZoomFactor(currentZoom - 0.1);
		}
	};

	const actualSizeHandler = () => {
		if (mainWindow) {
			mainWindow.webContents.setZoomFactor(1.0);
		}
	};

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
				{
					role: "reload",
					accelerator: "CmdOrCtrl+R",
				},
				{
					role: "forceReload",
					accelerator: "CmdOrCtrl+Shift+R",
				},
				{ type: "separator" as const },
				{
					label: "Actual Size",
					accelerator: "CmdOrCtrl+O",
					click: actualSizeHandler,
				},
				{
					label: "Zoom In",
					accelerator: "CmdOrCtrl+Plus", // On macOS, this often requires Shift as well (Cmd+Shift+=)
					click: zoomInHandler,
				},
				{
					label: "Zoom Out",
					accelerator: "CmdOrCtrl+-",
					click: zoomOutHandler,
				},
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
							/*
							 * `close` is what gives the window the standard Cmd+W, and on macOS
							 * it is not implied by anything else here: the Window menu carried
							 * `minimize`/`zoom`/`front` and no close item, so the gesture the
							 * in-flight update panel invites ("quit and leave it closed until
							 * the app opens again by itself") resolved to nothing at all - the
							 * red button worked and the keyboard did not (UX U9). It belongs
							 * here rather than in File because the app's own File menu holds a
							 * lone `quit`, and this gesture has to reach the same
							 * `window-all-closed` path the red button takes, which is the one
							 * this change made safe for an install in flight.
							 */
							{ role: "close" },
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
	/*
	 * Resolved once, before any window exists, so an agent-driven run can say
	 * how it wants the window to behave: `headless` (created, never shown) and
	 * `inactive` (shown without activating the app) are how a QA rig or a
	 * `pnpm dev` check stops taking the operator's keyboard focus on every
	 * launch. See `window-mode.ts` for the modes and AGENTS.md for when to use
	 * which. `normal` is the shipped behaviour, unchanged.
	 */
	// Create the browser window.
	const mainWindow = new BrowserWindow({
		width: windowLaunch.width,
		height: windowLaunch.height,
		// The layout is verified down to 800x600 and not below: the app rail,
		// the per-route list pane and the canvas all have their own minimums,
		// and past this point they start taking room from each other rather
		// than from the window. The auth popup below sets its own floor the
		// same way. The floor lives in `window-mode.ts` because that is what
		// clamps a requested `--window-size` to it.
		minWidth: WINDOW_MIN_WIDTH,
		minHeight: WINDOW_MIN_HEIGHT,
		show: false,
		/*
		 * `headless` is never shown, so no key window can be made out of it; this
		 * keeps that true of the window object itself rather than of the code
		 * path. It is NOT a safety net against a stray `show()`: on macOS
		 * `NativeWindowMac::Show()` activates the app for any non-panel window
		 * whatever `focusable` says (measured — a non-focusable window, shown,
		 * made the app frontmost while `isFocused()` still read false). The guard
		 * against a window being raised is that `window-raise.ts` is the only
		 * module that raises one, and this flag is the second line of defence.
		 */
		focusable: windowLaunch.focusable,
		autoHideMenuBar: true,
		title: "Local Operator",
		icon,
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			sandbox: false,
			// Only enable devTools when running with 'pnpm dev'
			// Disable for 'pnpm start' and production builds
			devTools: Boolean(process.env.ELECTRON_RENDERER_URL),
			// Security settings
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			// Chromium throttles timers and animation frames in a window it
			// believes nobody is looking at, which would make a headless test
			// run measure a different app than the one users get. Measured on
			// Electron 35 / macOS: a `show: false` window does keep
			// `visibilityState` at "visible" and keeps rAF ticking, but that
			// comes from Electron's MacWebContentsOcclusion default rather
			// than from anything this app controls, so hold the page at full
			// rate explicitly instead of trusting the platform. `normal`
			// keeps Electron's own default.
			backgroundThrottling: windowLaunch.backgroundThrottling,
		},
	});

	// Renderer warnings and errors reach a durable file, not just devTools.
	// devTools are off outside `pnpm dev`, so a `console.warn` in a shipped
	// build previously landed nowhere a user could send us — which made the
	// receipt-backoff diagnostic unreadable on the machines where it matters.
	// Only warning (2) and error (3) are forwarded; info and debug would make
	// the log unusable for the failures it exists to explain.
	mainWindow.webContents.on("console-message", (_event, level, message) => {
		if (level < 2) return;
		const write = level >= 3 ? logger.error : logger.warn;
		write.call(logger, `[renderer] ${message}`, LogFileType.BACKEND);
	});

	mainWindow.on("ready-to-show", () => {
		/*
		 * `normal` raises and focuses the window: the ordinary launch, which is a
		 * person starting the app. `inactive` orders the window without
		 * activating the app, so an agent run can be watched without interrupting
		 * anyone. `headless` does not show it at all: the window still renders at
		 * its full size, so `capturePage` and CDP see a complete frame.
		 */
		presentWindow(mainWindow, windowLaunch.show);

		if (windowLaunch.mode === "normal") return;
		/*
		 * A non-normal run states what its window actually did, in its own
		 * output, once the frame has settled. The window server will not tell a
		 * rig this: `System Events` reports no windows for a process without
		 * Accessibility permission and none for a background process even with
		 * it, so "the app never showed anything" is otherwise unprovable from
		 * outside. One line, greppable, is what makes the claim checkable by
		 * whoever reads a QA run's log.
		 *
		 * Read `visible` and not `focused`: `focusable: false` forces
		 * `isFocused()` false, so a headless run would print `focused=false`
		 * even while it held the operator's focus. `visible=false` is the fact,
		 * and no app is activated by a window it never shows.
		 */
		setTimeout(() => {
			if (!mainWindow || mainWindow.isDestroyed()) return;
			const [width, height] = mainWindow.getSize();
			const [contentWidth, contentHeight] = mainWindow.getContentSize();
			console.log(
				`[window-mode] state: visible=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} focusable=${mainWindow.isFocusable()} size=${width}x${height} content=${contentWidth}x${contentHeight}`,
			);
		}, 1500);
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
			// Allow the popup for authentication with improved features.
			//
			// `overrideBrowserWindowOptions` is the key Electron reads here. This
			// block used to be `features`, which is a property of the handler's
			// ARGUMENT (the parsed `window.open()` feature string) and not of the
			// response, so every option below — including `sandbox: true` — was
			// silently ignored and the popup got Electron's own defaults. The
			// options are unchanged; only the key is now the one that is honoured.
			return {
				action: "allow",
				overrideBrowserWindowOptions: {
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

/*
 * How this process wants its window to behave. Resolved at load, from
 * `LOCAL_OPERATOR_UI_WINDOW_MODE` / `--window-mode=` and `--window-size=`,
 * so every launch path is covered by one switch: `pnpm dev`, `pnpm start`,
 * `npx electron .` in a rig, and `npx local-operator-ui` (which spawns
 * Electron with this process's environment, so it inherits the value).
 */
const windowLaunch = resolveWindowLaunchPlan({
	env: process.env,
	argv: process.argv,
});
for (const problem of windowLaunch.problems) {
	logger.warn(`[window-mode] ${problem}`, LogFileType.BACKEND);
	/*
	 * Also on stdout, because a rejected mode is a fact about the LAUNCH, not
	 * about the backend: `LOCAL_OPERATOR_UI_WINDOW_MODE=hedless` falling back
	 * to `normal` is exactly what turns a typo into an interruption, and the
	 * warning above only reaches a log file the rig does not read. A rig greps
	 * stdout; a person reads the terminal.
	 */
	console.log(`[window-mode] ${problem}`);
}
// Quiet in `normal`, where there is nothing a reader needs to know and the
// shipped app's stdout stays clean. The smoke-test path returns before this
// point is reached, so its single marker line is unaffected either way.
if (windowLaunch.mode !== "normal") {
	console.log(`[window-mode] ${describeWindowLaunch(windowLaunch)}`);
}

// Radient tokens and OAuth state used to live in an electron-store session
// file here. The backend AuthStore owns provider credentials now and the
// desktop bearer is process-scoped, so main keeps no credential store.

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// Define mainWindow at a higher scope to be accessible in event handlers
let mainWindow: BrowserWindow | null = null;

/*
 * The update service of the most recent window, kept here rather than in the
 * window's own scope for one reason: the two app-level decisions that need it
 * (`window-all-closed` below, and `before-quit`) run after the window's `closed`
 * handler has already disposed that service. Deliberately not nulled there - the
 * question "is an update installing" is about the machine, not about a window,
 * and it must still be answerable in the instant between the last window going
 * and the app deciding what to do about it. A new window replaces it.
 */
let activeUpdateService: UpdateService | null = null;

// Define zoom functions for before-input-event, ensuring mainWindow is available
const zoomInFromEvent = () => {
	if (mainWindow) {
		const webContents = mainWindow.webContents;
		const currentZoom = webContents.getZoomFactor();
		webContents.setZoomFactor(currentZoom + 0.1);
	}
};

const zoomOutFromEvent = () => {
	if (mainWindow) {
		const webContents = mainWindow.webContents;
		const currentZoom = webContents.getZoomFactor();
		webContents.setZoomFactor(currentZoom - 0.1);
	}
};

const actualSizeFromEvent = () => {
	if (mainWindow) {
		mainWindow.webContents.setZoomFactor(1.0);
	}
};

// --- Single Instance Lock ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	logger.warn("Another instance is already running. Quitting this instance.");
	app.quit();
} else {
	app.on("second-instance", (_event, commandLine) => {
		// Someone tried to run a second instance, we should focus our window.
		if (mainWindow) {
			// A headless or inactive run exists precisely because the operator
			// is doing something else, so a second launch must not be what
			// finally pulls focus away from them; `raiseWindow` decides.
			raiseWindow(mainWindow, windowLaunch.show);

			// Backend-owned OAuth completes on the backend's loopback callback;
			// the legacy radient:// deep link is no longer consumed here.
			void commandLine;
		}
	});
}

app
	.whenReady()
	.then(async () => {
		// Set app user model id for windows
		electronApp.setAppUserModelId("com.local-operator");

		// Smoke-test hook for the npx sanity check in CI. Reaching this point
		// proves what the old check only assumed: the main bundle actually loaded
		// and executed under the resolved Electron. Issue #88 shipped because the
		// bundle died at require time with cachedDataRejected while the node
		// wrapper stayed alive, so a liveness probe on the wrapper pid saw nothing
		// wrong. Quit immediately: the check wants the signal, not a window, and
		// on a headless runner there is nobody to close one.
		// The version rides on the SAME line as the marker on purpose. The smoke
		// test decides the moment it can, so a version printed on a second line
		// could still be in flight when the marker is matched; one line means the
		// check either has both facts or has neither.
		if (process.env.LOCAL_OPERATOR_UI_SMOKE_TEST === "true") {
			console.log(
				`LOCAL_OPERATOR_UI_READY electron=${process.versions.electron}`,
			);
			app.exit(0);
			return;
		}

		// Default open or close DevTools by F12 in development
		// and ignore CommandOrControl + R in production.
		// see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
		app.on("browser-window-created", (_, window) => {
			optimizer.watchWindowShortcuts(window);
		});

		// One guarded sender for every main-process caller, so a read receipt
		// requires a genuinely foreground window no matter which path emits it.
		// The notifier holds its own reference to this sender, so guarding only
		// the renderer IPC entry would leave that path ungated.
		const sendDesktop = guardForegroundReceipts(
			() => mainWindow,
			(input) => backendService.requestDesktop(input),
		);
		const desktopNotifier = new DesktopNotifier(
			() => mainWindow,
			sendDesktop,
			windowLaunch.show,
		);
		// Read `features.notification_contract` whenever the backend becomes
		// reachable, NOT here: the desktop token is minted inside
		// `backendService.start()` below, so a capability request issued now
		// would hit a dead port on the ordinary self-managed cold start, be
		// swallowed, and leave the notifier on its legacy path against a backend
		// that composes — two banners for one turn, which is the defect this
		// change exists to remove.
		//
		// Registering the observer (rather than calling after `start()`) is what
		// keeps it correct on every later transition too: a health-check restart
		// or external-backend discovery can put a DIFFERENT backend version
		// underneath a running app, in both directions. Re-reading is also the
		// downgrade path in docs/design/descriptive-notifications.md 4.3.
		//
		// Not awaited: a slow backend must not delay first paint. The notifier
		// defers the legacy toast until the read settles, so nothing can slip
		// through the window in between.
		backendService.onBackendReady(() => {
			void desktopNotifier.refreshNotificationContract();
		});
		backendService.observeStream((sessionId, data) => {
			try {
				desktopNotifier.observe(sessionId, JSON.parse(data));
			} catch {
				// A frame the renderer cannot parse is not a notification either.
			}
		});
		// The ONE trusted renderer URL: the dev server while developing, the packaged
		// document otherwise. Named rather than inlined because a second consumer
		// (the browser IPC namespace) checks the same value, and two spellings of
		// "the trusted frame" is how one of them drifts.
		const rendererUrl =
			process.env.ELECTRON_RENDERER_URL ||
			pathToFileURL(join(__dirname, "../renderer/index.html")).href;
		registerDesktopIPC(
			() => mainWindow,
			rendererUrl,
			sendDesktop,
			() => backendService.getStreamRelay(),
			(input, bytes) => backendService.requestDesktopMedia(input, bytes),
			desktopNotifier,
		);

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
			async (
				_,
				filePath: string,
				encoding: BufferEncoding = "utf-8",
			): Promise<ReadFileResponse> => {
				try {
					const data = readFileSync(resolveUserPath(filePath), encoding);
					return { success: true, data };
				} catch (error) {
					logger.error("Error reading file:", LogFileType.BACKEND, error);
					return { success: false, error };
				}
			},
		);

		/*
		 * Existence and identity for the Files panel, in one batched call.
		 *
		 * The renderer cannot stat (`nodeIntegration: false`,
		 * `contextIsolation: true`), and per-tile calls would be a stat storm while
		 * a turn is streaming: one probe per record delta, each carrying up to 64
		 * paths, is the shape that stays cheap. The answer carries the RESOLVED
		 * path, which is what makes it usable as the store's dedupe key —
		 * `~/a.md` and `/Users/you/a.md` are one file, and the panel must not show
		 * them as two.
		 *
		 * A path that resolves into nowhere is reported `exists: false` rather than
		 * dropped: "the agent wrote this and it is gone" is a fact the tile states,
		 * and silently filtering it would recreate the original complaint from the
		 * other side.
		 */
		ipcMain.handle(
			"probe-files",
			async (_, paths: unknown, cwd?: string): Promise<ProbedFile[]> => {
				const asked = Array.isArray(paths)
					? paths.filter((path): path is string => typeof path === "string")
					: [];
				return asked.slice(0, MAX_PROBE_PATHS).map((input) => {
					let resolved = input;
					try {
						resolved = resolveUserPath(input, cwd);
						const stat = statSync(resolved, { throwIfNoEntry: false });
						return {
							input,
							resolved,
							exists: stat !== undefined,
							isFile: stat?.isFile() ?? false,
							sizeBytes: stat?.isFile() ? stat.size : null,
							mtimeMs: stat?.isFile() ? stat.mtimeMs : null,
						};
					} catch (error) {
						// A genuine fault - permission, a stale network mount - is not the
						// same answer as "no such file", and the difference is the whole
						// diagnosis when a tile says the file is gone and it is there.
						return {
							input,
							resolved,
							exists: false,
							isFile: false,
							sizeBytes: null,
							mtimeMs: null,
							error: error instanceof Error ? error.message : String(error),
						};
					}
				});
			},
		);

		/*
		 * Bytes for the in-app viewers, capped and named.
		 *
		 * Why not `read-file`: a PDF or a PNG has no text encoding, and the
		 * alternative this replaces was base64 - a third again the size, decoded on
		 * the far side, held as a string in the renderer and (for a document the
		 * user then edited) written into `localStorage`. `Uint8Array` crosses IPC
		 * by structured clone with no encoding step at all.
		 *
		 * The cap is checked BEFORE the read, against `stat`, so a 2 GB file is
		 * refused without allocating anything. That is what makes the refusal
		 * specific enough for the viewer to say "too large to preview" and offer
		 * the OS instead of showing a spinner that never finishes.
		 */
		ipcMain.handle(
			"read-file-bytes",
			async (
				_,
				filePath: string,
				maxBytes: number = MAX_FILE_READ_BYTES,
			): Promise<ReadFileBytesResponse> => {
				const cap =
					Number.isFinite(maxBytes) && maxBytes > 0
						? Math.min(maxBytes, MAX_FILE_READ_BYTES)
						: MAX_FILE_READ_BYTES;
				try {
					const resolved = resolveUserPath(filePath);
					const stat = statSync(resolved, { throwIfNoEntry: false });
					if (!stat) {
						return {
							success: false,
							code: "not-found",
							error: `No file at ${resolved}`,
						};
					}
					if (!stat.isFile()) {
						return {
							success: false,
							code: "not-a-file",
							error: `${resolved} is not a regular file`,
						};
					}
					if (stat.size > cap) {
						return {
							success: false,
							code: "too-large",
							error: `${resolved} is ${stat.size} bytes, over the ${cap}-byte preview cap`,
							sizeBytes: stat.size,
						};
					}
					// A copy, not a view over `readFileSync`'s buffer. For a file under
					// half of `Buffer.poolSize` the returned Buffer is a slice of a shared
					// pool, so a view would describe the offset and length correctly and
					// still keep the whole pooled allocation alive on the renderer's side
					// of structured clone. The cost is one memcpy of a file the cap has
					// already held to 64 MiB.
					const buffer = readFileSync(resolved);
					return {
						success: true,
						data: new Uint8Array(buffer),
						sizeBytes: buffer.byteLength,
					};
				} catch (error) {
					logger.error("Error reading file bytes:", LogFileType.BACKEND, error);
					return {
						success: false,
						code: "unreadable",
						error: error instanceof Error ? error.message : String(error),
					};
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

		ipcMain.handle("show-item-in-folder", async (_, filePath) => {
			try {
				shell.showItemInFolder(filePath);
			} catch (error) {
				console.error("Error showing item in folder:", error);
			}
		});

		ipcMain.handle(
			"save-file",
			async (
				_,
				filePath: string,
				content: string,
				encoding: BufferEncoding = "utf-8",
			) => {
				try {
					writeFileSync(resolveUserPath(filePath), content, encoding);
				} catch (error) {
					logger.error("Error saving file:", LogFileType.BACKEND, error);
					throw error; // Re-throw the error to be caught by the renderer
				}
			},
		);

		ipcMain.handle("file-exists", async (_, filePath: string) => {
			return existsSync(resolveUserPath(filePath));
		});

		/*
		 * Distinct from `file-exists` because the working-directory chip needs
		 * "is this a directory the agent can start in", and `existsSync` answers
		 * yes for `/etc/hosts` - a regular file, which `sessions.create` then
		 * rejects much later with an error rendered far from the control that
		 * caused it. `statSync` is the only call that separates the two, and it
		 * has to run here: the renderer has no fs access by design.
		 *
		 * `throwIfNoEntry: false` rather than a try/catch around the happy path,
		 * so a missing path is an ordinary `undefined` and only a genuine fault
		 * (permission, a broken mount) reaches the catch. Both answer `false`:
		 * the caller's question is "can the agent work here", and a directory it
		 * cannot stat is not one.
		 */
		ipcMain.handle("directory-exists", async (_, dirPath: string) => {
			try {
				return (
					statSync(resolveUserPath(dirPath), {
						throwIfNoEntry: false,
					})?.isDirectory() ?? false
				);
			} catch {
				return false;
			}
		});

		ipcMain.handle("show-open-dialog", async (_, options) => {
			if (!mainWindow) {
				logger.error(
					"Cannot show open dialog: mainWindow is not available.",
					LogFileType.BACKEND,
				);
				return { canceled: true, filePaths: [] };
			}
			const result = await dialog.showOpenDialog(
				mainWindow,
				withRememberedDirectory(
					"open-file",
					options,
					pickerFallbackDirectory(),
				),
			);
			rememberPickedDirectory("open-file", result.filePaths);
			return result;
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
			const directoryOptions: Electron.OpenDialogOptions = {
				properties: ["openDirectory"],
				title: "Select Working Directory", // More appropriate title
				buttonLabel: "Select Folder", // Correct button label
			};
			const result = await dialog.showOpenDialog(
				mainWindow,
				withRememberedDirectory(
					"select-directory",
					directoryOptions,
					pickerFallbackDirectory(),
				),
			);
			rememberPickedDirectory("select-directory", result.filePaths, true);

			if (!result.canceled && result.filePaths.length > 0) {
				return result.filePaths[0]; // Return the selected path
			}
			return undefined; // Return undefined if canceled or no path selected
		});

		ipcMain.handle("select-file", async () => {
			if (!mainWindow) {
				logger.error(
					"Cannot show open file dialog: mainWindow is not available.",
					LogFileType.BACKEND,
				);
				return undefined;
			}
			const fileOptions: Electron.OpenDialogOptions = {
				properties: ["openFile"],
				title: "Select File",
				buttonLabel: "Open",
			};
			const result = await dialog.showOpenDialog(
				mainWindow,
				withRememberedDirectory(
					"select-file",
					fileOptions,
					pickerFallbackDirectory(),
				),
			);
			rememberPickedDirectory("select-file", result.filePaths);

			if (!result.canceled && result.filePaths.length > 0) {
				const filePath = result.filePaths[0];
				try {
					const extension = filePath.split(".").pop() || "";
					const isSpreadsheet = BASE64_FILE_EXTENSIONS.includes(
						extension.toLowerCase(),
					);

					const data = readFileSync(
						filePath,
						isSpreadsheet ? "base64" : "utf8",
					);
					return { path: filePath, content: data };
				} catch (error) {
					logger.error("Error reading file:", LogFileType.BACKEND, error);
					return undefined;
				}
			}
			return undefined;
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

			// Add before-input-event listener for zoom control
			if (mainWindow) {
				mainWindow.webContents.on("before-input-event", (event, input) => {
					const isCmdOrCtrl = input.control || input.meta; // Ctrl on Win/Linux, Cmd on macOS

					if (isCmdOrCtrl) {
						if (input.key === "+" || input.key === "=") {
							zoomInFromEvent();
							event.preventDefault();
						} else if (input.key === "-") {
							zoomOutFromEvent();
							event.preventDefault();
						} else if (input.key === "O") {
							actualSizeFromEvent();
							event.preventDefault();
						}
					}
				});
			}

			// Clean up any previous update service
			if (updateService) {
				updateService.dispose();
				updateService = null;
			}

			// Initialize the update service with a reference to the backend service
			updateService = new UpdateService(mainWindow, backendService);
			activeUpdateService = updateService;

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

			// Register local shortcuts for focused window
			mainWindow.webContents.on("before-input-event", (event, input) => {
				const isCmdOrCtrl = input.control || input.meta;

				// Toggle command palette: Cmd/Ctrl + P
				if (
					isCmdOrCtrl &&
					input.key.toLowerCase() === "p" &&
					input.type === "keyDown"
				) {
					if (mainWindow?.isFocused() && mainWindow?.isVisible()) {
						event.preventDefault();
						mainWindow.webContents.send("toggle-command-palette");
					}
				}

				// Start speech to text: Cmd/Ctrl + Shift + S
				if (
					isCmdOrCtrl &&
					input.shift &&
					input.key.toLowerCase() === "s" &&
					input.type === "keyDown"
				) {
					if (mainWindow?.isFocused() && mainWindow?.isVisible()) {
						event.preventDefault();
						mainWindow.webContents.send("start-speech-to-text");
					}
				}
			});
		}

		/*
		 * The browser host: the loopback endpoint a lop session drives, the tab
		 * registry it addresses, and the persistent jar both share.
		 *
		 * WHY it is tied to the WINDOW's lifetime rather than the app's: every driven
		 * view is a child of that window's content view, and `WebContentsView` does NOT
		 * take its webContents down when the window closes (Electron's own documented
		 * leak). So closing the window stops the host — which closes every view,
		 * releases every debugger session and removes the state file — and a window
		 * re-created by a dock click starts a fresh one. Tabs do not survive that, and
		 * a session holding a handle gets the ordinary `tab_closed` and re-`open`s,
		 * which is the designed recovery rather than a special case. Restoring tabs
		 * across a window re-creation is the tab-restore work (design 7), not this PR.
		 *
		 * A failure here must never be why the app does not start: the host is a
		 * capability, not a dependency of the window. It is reported and the app
		 * carries on, the same direction `state.py` takes for discovery.
		 */
		let browserHostRunning = false;
		async function startBrowserHostForWindow(
			window: BrowserWindow,
		): Promise<void> {
			if (browserHostRunning || !browserHostEnabled()) return;
			browserHostRunning = true;
			window.on("closed", () => {
				browserHostRunning = false;
				void stopBrowserHost();
			});
			try {
				await startBrowserHost({
					window,
					expectedUrl: rendererUrl,
					appVersion: app.getVersion(),
					userDataDir: app.getPath("userData"),
					log: (message) => logger.info(message, LogFileType.BACKEND),
				});
			} catch (error) {
				browserHostRunning = false;
				logger.error(
					`Could not start the browser host: ${String(error)}`,
					LogFileType.BACKEND,
				);
			}
		}

		// Initial window + update service setup
		setupMainWindowWithUpdateService();
		if (mainWindow) await startBrowserHostForWindow(mainWindow);

		app.on("activate", () => {
			// On macOS it's common to re-create a window in the app when the
			// dock icon is clicked and there are no other windows open.
			if (BrowserWindow.getAllWindows().length === 0) {
				setupMainWindowWithUpdateService();
				if (mainWindow) void startBrowserHostForWindow(mainWindow);
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
		/*
		 * One close is not an ordinary close. A window closed while an update
		 * install is in flight leaves this process running with no window, and a
		 * running instance of this app is exactly what Squirrel's last validation
		 * aborts the install on - so the user has cancelled their update by the
		 * most familiar gesture on the platform while believing the app is closed,
		 * and nothing tells them otherwise (UX U1). The panel's own button quits
		 * for the install; this makes the red button mean the same thing while an
		 * install is known, which is the only window in which it does.
		 */
		if (activeUpdateService?.quitForInFlightInstall("last window closed")) {
			app.quit();
			return;
		}
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

// Electron does not await async listeners. Prevent the first quit, await the
// same owned cleanup the updater uses, then retry without replacing any hooks.
let backendQuitPending = false;
app.on("will-quit", (event) => {
	if (backendService.isOwnedCleanupComplete()) return;
	event.preventDefault();
	if (backendQuitPending) return;
	backendQuitPending = true;
	void backendService
		.stop(false)
		.then(() => {
			app.quit();
		})
		.catch((error) => {
			logger.error(
				"Owned backend cleanup failed; exiting with failure",
				LogFileType.BACKEND,
				error,
			);
			app.exit(1);
		});
});

// Handle before-quit event to ensure proper cleanup
app.on("before-quit", () => {
	logger.info("App is about to quit", LogFileType.BACKEND);
	// Unregister all shortcuts.
	globalShortcut.unregisterAll();
	/*
	 * Any quit, not only the panel's button.
	 *
	 * The relaunch promise used to belong to one control: quitting any other way
	 * while an install was in flight left it resting on whatever watchdog the
	 * install still happened to have, and on nothing at all once that watchdog's
	 * bounds had run out (UX U2). A quit is a quit for the install either way, so
	 * the app that is going away makes sure something will bring it back - and
	 * `window-all-closed` above is the same call, which is why the work is done
	 * once per quit.
	 */
	activeUpdateService?.quitForInFlightInstall("app quit");
	// Close every driven view, release the debugger sessions and remove the state
	// file, so a session stopping at the same moment does not read a record naming
	// a process that is already gone. Not awaited: `before-quit` is synchronous,
	// and each of these steps is also safe to lose (see `stopBrowserHost`).
	void stopBrowserHost();
});

// The exit event is synchronous: only the current captured handle is eligible.
process.on("exit", () => {
	try {
		backendService.emergencyStopOwned();
	} catch (error) {
		logger.error(
			"Owned backend emergency cleanup failed",
			LogFileType.BACKEND,
			error,
		);
	}
	posthogClient.shutdown();
});

process.on("uncaughtException", (error) => {
	logger.error("Uncaught exception", LogFileType.BACKEND, error);
	void backendService
		.stop(false)
		.catch((stopError) => {
			logger.error(
				"Owned backend cleanup failed",
				LogFileType.BACKEND,
				stopError,
			);
		})
		.finally(() => process.exit(1));
});
