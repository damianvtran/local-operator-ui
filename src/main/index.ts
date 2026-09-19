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
	webContents,
} from "electron";
import { PostHog } from "posthog-node";
import icon from "../../resources/icon.png?asset";
import {
	BACKEND_RECONNECT_CHANNEL,
	BACKEND_STATUS_CHANNEL,
	BACKEND_STATUS_EVENT,
} from "../shared/backend-status";
import {
	type DirectoryListing,
	type FileActionOutcome,
	MAX_FILE_READ_BYTES,
	MAX_PROBE_PATHS,
	type ProbedFile,
	type ReadFileBytesResponse,
} from "../shared/desktop-contract";
import type { DesktopFeedState } from "../shared/desktop-contract";
import type { DesktopFeedFrame } from "../shared/desktop-session-contract";
import {
	OPEN_CATALOGUE_FLAG,
	OPEN_SESSION_FLAG,
	readLaunchTarget,
} from "../shared/open-session";
import {
	BackendInstaller,
	BackendServiceManager,
	INTERPRETER_RESOLUTION_WORST_MS,
	LocalOperatorStartupMode,
	OWNED_STOP_WORST_MS,
	READINESS_POLL_INTERVAL_MS,
} from "./backend";
import { backendConfig, launchEnv } from "./backend/config";
import { LogFileType, logger } from "./backend/logger";
import {
	browserHostEnabled,
	browserHostStopPending,
	startBrowserHost,
	stopBrowserHost,
} from "./browser";
import { createSessionCookieQuitHold } from "./browser/session-cookie-quit-hold";
import { guardForegroundReceipts, registerDesktopIPC } from "./desktop-ipc";
import { DesktopNotifier } from "./desktop-notifier";
import {
	describeDevDriverArming,
	devDriverArgument,
	resolveDevDriverArming,
} from "./dev-driver";
import { registerDevDriverIPC } from "./dev-driver-ipc";
import {
	listDirectory,
	outsideWorkspace,
	realPathOrNull,
	resolveUserPath as resolveUserPathWith,
} from "./directory-listing";
import { isProcessAlive, startLauncherWatch } from "./launcher-watch";
import type { LauncherWatch } from "./launcher-watch";
import {
	rememberPickedDirectory,
	withRememberedDirectory,
} from "./picker-directory";
import { UpdateService, holdLaunchForLiveInstall } from "./update-service";
import { ViewerEndpoint } from "./viewer-endpoint";
import { ViewerRecordPublisher } from "./viewer-record";
import {
	LAUNCHER_EXIT_DEADLINE_MS,
	LAUNCHER_POLL_INTERVAL_MS,
	WINDOW_MIN_HEIGHT,
	WINDOW_MIN_WIDTH,
	type WindowShow,
	describeWindowLaunch,
	resolveAboutPanelAction,
	resolveLauncherWatchPlan,
	resolveWindowLaunchPlan,
	windowIntentPayload,
} from "./window-mode";
import {
	OPERATOR_SHOW,
	type RaiseReport,
	type RaiseRequester,
	type RaiseTrigger,
	type SecondLaunchRequest,
	applySecondLaunch,
	canCreateWindowFor,
	canRetargetWindow,
	presentWindow,
	raiseWindow,
	readSecondLaunchRequest,
	reportConversationReplaced,
	reportParked,
	reportParkedDelivered,
	reportParkedEvicted,
	reportParkedInUse,
	reportParkedLeftWaiting,
	reportParksAtQuit,
} from "./window-raise";

const BASE64_FILE_EXTENSIONS = ["csv", "tsv", "xls", "xlsx", "ods"];

/**
 * The ONE path-resolution rule for every local-file IPC handler.
 *
 * The RULE itself lives in `./directory-listing` and is executed from there by
 * `scripts/directory-listing.test.mjs`, because this file boots Electron on
 * import and so cannot be exercised by a test — and the rule is load-bearing for
 * the composer's `@` picker as well as for the Files panel. What stays here is
 * the one thing only this process can supply: `app.getPath("home")`.
 *
 * `cwd` is for the two callers that have one — `probe-files` and
 * `list-directory`, the pair a picker asks per keystroke — where a relative
 * candidate is resolvable against the session's working directory. It is applied
 * only to a relative path, so an absolute path is always taken literally.
 */
const resolveUserPath = (filePath: string, cwd?: string): string =>
	resolveUserPathWith(filePath, cwd, app.getPath("home"));

export type ReadFileResponse =
	| { success: true; data: string }
	| { success: false; error: unknown }; // or use `string` if you always send error.message

/*
 * How this process wants its window to behave. Resolved at load, from
 * `LOCAL_OPERATOR_UI_WINDOW_MODE` / `--window-mode=` and `--window-size=`,
 * so every launch path is covered by one switch: `pnpm dev`, `pnpm start`,
 * `npx electron .` in a rig, and `npx local-operator-ui` (which spawns
 * Electron with this process's environment, so it inherits the value).
 *
 * Why it sits this high in the file: `app.dock` is set up below, before
 * anything is ready, and `headless` is the mode that must not take a Dock
 * tile. Resolving the plan first is what lets the Dock decision be made once,
 * from the same table the window itself is built from, rather than re-read from
 * the environment at a second call site that could disagree.
 *
 * Read from `launchEnv` — the environment this process was LAUNCHED with — and
 * not from `process.env`, because `./backend/config` has already folded a
 * `.env` from the working directory into `process.env` with dotenv
 * `override: true` by the time this runs (see the comment on `launchEnv`). A
 * window mode is a fact about the launch: a file in the checkout must not be
 * able to turn a deliberately `headless` run into one that raises a window and
 * takes the operator's focus.
 */
const windowLaunch = resolveWindowLaunchPlan({
	env: launchEnv,
	argv: process.argv,
	/*
	 * The facts that let a flagless launch be recognised as a run rather than as
	 * the operator's app — see the `driven` block in window-mode.ts for why the
	 * shape is sound and why it cannot touch the shipped app.
	 *
	 * `app.isPackaged` is read here, at module load, rather than inside the
	 * resolver: it describes the LAUNCH (the installed `.app` is packaged, a
	 * checkout and the npm CLI are not), and the resolver stays free of Electron
	 * so its rules can be tested as arithmetic instead of by booting an app.
	 *
	 * `process.stdin`/`process.stdout` are read as the process was STARTED with
	 * them, for the same reason `launchEnv` exists: a terminal attached later
	 * cannot make this a person's launch.
	 */
	packaged: app.isPackaged,
	stdinIsTTY: process.stdin.isTTY,
	stdoutIsTTY: process.stdout.isTTY,
	platform: process.platform,
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

/*
 * Ending a headless run, and the one outcome it may not have: still being here.
 *
 * Every path that ends a headless run goes through these two functions, because
 * the same defect appeared on each of them separately — a window close, a
 * launcher that went away, a signal — and each time the app was left running
 * with no window and no user. The graceful path is always tried first
 * (`app.quit()`, which is what the shipped app takes), and the deadline is the
 * guarantee underneath it.
 *
 * What the deadline does NOT cover, stated because it decides what a harness
 * author may rely on: the escalation is `app.exit(0)`, whose `process.on("exit")`
 * handler runs `backendService.emergencyStopOwned()`, which can only `SIGKILL` a
 * child that was SPAWNED AND REGISTERED as the owned backend. A boot still
 * installing its managed runtime has no such field yet, and a deadline that
 * lands in that window can leave that work behind. The owned backend this repo
 * actually runs (the `serve` child) is registered long before a harness drives
 * the window, which is why 10 s is chosen deliberately over the app's own
 * `QUIT_CLEANUP_FAILSAFE_MS` (~34 s): a launcher-gone run is a run nobody is
 * watching, and the cost of waiting is another instance of exactly the kind this
 * module exists to remove. An escalated exit is still status 0 — it is a run
 * ending because its way of being watched went away, not a failure — so a
 * harness must not read the status as the signal; the `[window-mode]` line is
 * what says which path ended it.
 */
let headlessExitDeadline: NodeJS.Timeout | null = null;
function armHeadlessExitDeadline(why: string): void {
	if (headlessExitDeadline) return;
	const deadline = setTimeout(() => {
		const line = `${why}; the quit did not finish within ${LAUNCHER_EXIT_DEADLINE_MS} ms, exiting`;
		logger.error(`[window-mode] ${line}`, LogFileType.BACKEND);
		console.log(`[window-mode] ${line}`);
		app.exit(0);
	}, LAUNCHER_EXIT_DEADLINE_MS);
	// Never a reason for the process to stay alive by itself.
	deadline.unref();
	headlessExitDeadline = deadline;
}

/**
 * End this headless run. `why` is the plain sentence a person reads on stdout;
 * `detail` is the technical reading that goes to the backend log with it, so the
 * console line stays about the outcome (`pid 1` is trivia to whoever ran
 * `pnpm dev:headless`) while a post-mortem still gets the observation.
 */
function endHeadlessRun(why: string, detail?: string): void {
	logger.info(`[window-mode] ${why}; quitting`, LogFileType.BACKEND);
	console.log(`[window-mode] ${why}; quitting`);
	/*
	 * The mechanism on its OWN line, at file level.
	 *
	 * Round 2 (D7) asked for the outcome/mechanism split to reach the terminal, and
	 * round 3 (R7) caught that my first attempt only renamed the problem: the
	 * logger mirrors to stdout, so folding the observation into the message put the
	 * parenthetical beside the plain sentence anyway. `debug` is the file channel —
	 * the console transport is level `info` — so the mechanism lands in the log and
	 * the line a person reads stays about the outcome. In a `pnpm dev` run the
	 * console is at `debug` and will show this too, which is the right way round:
	 * whoever is running the dev app is the one who wants to know why it left.
	 */
	if (detail) {
		logger.debug(
			`[window-mode] launcher probe: ${detail}`,
			LogFileType.BACKEND,
		);
	}
	armHeadlessExitDeadline(why);
	app.quit();
}

/** The launcher watch, held so `before-quit` can stop it. */
let launcherWatch: LauncherWatch | null = null;

// Set application name
app.setName("Local Operator");
/*
 * The Dock tile on macOS, which a headless run must not have.
 *
 * A `headless` run is an app nobody is using: the window is never shown, so the
 * tile leads nowhere, and it accumulates — one per boot, for every harness and
 * every QA matrix. Measured on this repo, a single evidence session left ~30 of
 * them in the operator's Dock, which is how the underlying leak (instances that
 * outlived their launcher) was noticed in the first place. `app.dock.hide()` is
 * the whole fix for the visible half; `launcher-watch.ts` is the other half.
 *
 * The icon is only set where a tile exists to carry it: on a hidden dock the
 * call would say nothing, and the reason it is here at all is the shipped app.
 */
const image = nativeImage.createFromPath(icon);
if (process.platform === "darwin" && app.dock) {
	if (windowLaunch.hideDock) {
		app.dock.hide();
	} else {
		app.dock.setIcon(image);
	}
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

/**
 * The copyright line, read from the app's own manifest.
 *
 * Why read it rather than repeat it here: `build.copyright` in package.json is
 * the one place the project states this, and it is what electron-builder stamps
 * into the packaged bundle's `NSHumanReadableCopyright`. A second copy in this
 * file would drift from that silently; this cannot. The read is a few KB once at
 * startup, and a failure omits the line rather than failing the launch - an About
 * panel without a copyright is a cosmetic loss and a launch that dies is not.
 */
function bundledCopyright(): string | undefined {
	try {
		const manifest = JSON.parse(
			readFileSync(join(app.getAppPath(), "package.json"), "utf8"),
		) as { build?: { copyright?: unknown } };
		const copyright = manifest.build?.copyright;
		return typeof copyright === "string" && copyright.length > 0
			? copyright
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * The About panel's own identity, for the launches that have no bundle of ours.
 *
 * macOS fills this panel from the APP BUNDLE, and an unpackaged launch - which is
 * how every rig, QA harness and `npx electron .` boots this app - has no bundle
 * of its own: the panel is Electron.app's, so it renders "Electron / Version
 * 44.3.0 (44.3.0)" under Electron's icon while the app's real identity is
 * `productName` "Local Operator". Registering the options explicitly is what
 * makes the panel describe the app rather than the runtime hosting it, and it is
 * done for every mode that may raise the panel at all, because the label must not
 * depend on which mode asked for it.
 *
 * `applicationVersion` is the app's own version (`package.json`, the version
 * source of truth). The parenthesised `version` is a BUILD string: macOS puts it
 * in the second half of the version line, and left to itself it fills that half
 * with the same number again, so "Version 0.26.11 (0.26.11)" is a line that tells
 * a reader nothing about the run in front of them. Naming the desktop host, and
 * whether the bundle is the shipped one, is what makes a panel from an agent run
 * legible as one.
 */
function configureAboutPanel(): void {
	if (process.platform !== "darwin") return;

	const copyright = bundledCopyright();
	app.setAboutPanelOptions({
		/*
		 * The name the panel must read. It is the app's own name, not a copy of the
		 * bundle's: `app.name` resolves from `productName` in the app's package.json
		 * - the same string electron-builder writes into a packaged bundle - so the
		 * panel and the menu beside it cannot name the app differently.
		 */
		applicationName: app.name,
		applicationVersion: app.getVersion(),
		version: `Electron ${process.versions.electron}${app.isPackaged ? "" : ", unpackaged"}`,
		// Omitted entirely when there is no line to read, rather than passed as
		// undefined: the panel keeps the bundle's own for a packaged build, which is
		// the same string.
		...(copyright === undefined ? {} : { copyright }),
	});
}

/**
 * Create the application menu.
 *
 * macOS-only items are prepended below, and the About item carries a handler of
 * its own rather than Electron's `about` role: see the comment on it.
 */
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
				/*
				 * The About action is a handler of its own rather than Electron's `about`
				 * role, because a role's click goes straight to AppKit's panel and there is
				 * nothing in between to gate: `headless` must raise no window at all
				 * (`resolveAboutPanelAction`), and the panel's OWN identity is registered
				 * once at startup (`configureAboutPanel`). The label keeps the role's
				 * phrasing and takes the name from `app.name` the way the role did.
				 */
				{
					label: `About ${app.name}`,
					click: () => {
						if (resolveAboutPanelAction(windowLaunch.mode) === "suppress") {
							// A line rather than silence: an action that nothing reached and a
							// panel that failed to appear are otherwise the same absence, to the
							// operator and to a rig.
							logger.info(
								`[about-panel] suppressed by window mode ${windowLaunch.mode}: a ${windowLaunch.mode} run raises no window`,
								LogFileType.BACKEND,
							);
							return;
						}
						app.showAboutPanel();
					},
				},
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

/**
 * What a request asks of a window: how far it may come forward, which site is
 * asking, and — when the caller can say — who the requester is.
 *
 * ONE type for both branches of `openSessionInWindow`, because they have to
 * answer the same question. The existing-window branch applies it as a raise;
 * the branch that has to CREATE a window has to apply it to that window's first
 * present instead, and review round 1's MAJOR was exactly that the create branch
 * answered with this process's own plan — so a `headless` request that named a
 * conversation against an app with no window created one and SHOWED it.
 */
interface RaiseRequest {
	show: WindowShow;
	trigger: RaiseTrigger;
	requester?: RaiseRequester;
}

/** The plan this process's OWN launch presents a window under. */
const ownLaunchRequest = (): RaiseRequest => ({
	show: windowLaunch.show,
	trigger: "initial-present",
});

function createWindow(
	initialSession: string | null = null,
	openCatalogue = false,
	request: RaiseRequest = ownLaunchRequest(),
): BrowserWindow {
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
			/*
			 * The conversation this window is being created FOR, in the renderer
			 * process's own argv so preload can read it before the first paint (B3).
			 *
			 * Omitted entirely rather than set to an empty value on an ordinary
			 * launch: the preload parses a flag out of argv, and an empty one would
			 * be a value it then has to decide means "no session".
			 *
			 * `openCatalogue` is the THIRD intent (R2-1): a burst digest's click has
			 * no single conversation to name, and "no flag at all" already means
			 * "restore what you had open" — so it needs a flag of its own rather than
			 * sharing that absence.
			 *
			 * AND the renderer dev driver's arming entry, which is the other thing this
			 * app puts in a renderer's argv — usually absent, because it is present only
			 * in a launch that opted in. See `devDriverWebPreferences` above and
			 * `src/main/dev-driver.ts` for what arms a run and what the entry is read by.
			 *
			 * WHY ONE SPREAD AND NOT TWO: both sources write `additionalArguments`, so a
			 * second spread REPLACES the first's array rather than adding to it — and
			 * either one alone still produces a well-formed window, so the loss would be
			 * silent. `rendererArgumentFlags` below concatenates them, and is `{}` when
			 * neither applies, so "adds no option at all" stays literally true.
			 */
			...rendererArgumentFlags(initialSession, openCatalogue),
		},
	});

	/*
	 * A window created to show a specific conversation HOLDS its first present.
	 *
	 * Presenting on `ready-to-show` is a WINDOW milestone, not a "conversation
	 * applied" one, and the difference is visible: the renderer rehydrates its
	 * persisted active conversation and paints that first, so showing here puts
	 * the wrong conversation on screen and then swaps it — which reads as a click
	 * that landed on the wrong row (B3). The release is the renderer's own
	 * report that the conversation is up (its watch heartbeat), with a bounded
	 * fallback so a renderer that never reports cannot strand a hidden window.
	 */
	if (initialSession)
		holdPresentUntilConversation(mainWindow, initialSession, request);

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

	/*
	 * ONE PRESENT PER WINDOW, WHATEVER THE EVENT DOES. `ready-to-show` can fire more
	 * than once for the same window (a reload fires it again), and both review
	 * streams measured the cost: two identical `[window-raise]` lines and two
	 * `[window-mode] state:` lines ~80 ms apart for one window, while "one line per
	 * raise" is this feature's own promise. The first fire is when the window is
	 * ready; a later one is a page that reloaded on a window already on screen, and
	 * presenting it again would not be a raise.
	 */
	let presentHandled = false;
	mainWindow.on("ready-to-show", () => {
		if (presentHandled) return;
		presentHandled = true;
		/*
		 * `normal` raises and focuses the window: the ordinary launch, which is a
		 * person starting the app. `inactive` orders the window without
		 * activating the app, so an agent run can be watched without interrupting
		 * anyone. `headless` does not show it at all: the window still renders at
		 * its full size, so `capturePage` and CDP see a complete frame.
		 *
		 * WHICH plan, though, is the REQUEST's and not this process's: a window
		 * created because a second launch named a conversation is presented as far
		 * as THAT launch asked, so a `headless` request creates a window it never
		 * shows even here (review round 1, MAJOR).
		 *
		 * A window created for a conversation is the exception, and it is held by
		 * `holdPresentUntilConversation` above rather than presented here: see the
		 * call site for why "loaded" is not "showing the right conversation".
		 */
		if (!heldForConversation.has(mainWindow.id)) {
			presentWindow(mainWindow, request.show, {
				trigger: request.trigger,
				requester: request.requester,
				report: reportRaise,
			});
		}

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

	/*
	 * THE BROWSER HOST IS PART OF CREATING A WINDOW (review round 2, R2-2; moved
	 * here in round 3, R3-5). It used to be attached by the startup path, so every
	 * OTHER way a window comes into existence — a notification click, a viewer
	 * resume, a second instance — recreated chat without the capability, and the
	 * dock handler could not repair it because it is gated on zero windows.
	 * Attaching it here is what makes the fix unconditional: there is one place a
	 * window is built, so there is no call site left to forget, and the
	 * source-shape guard that stood in for it asserts the shape rather than a
	 * caller's diligence.
	 *
	 * Through `attachBrowserHostToWindow` rather than directly, because the host's
	 * own state lives inside `whenReady` and this factory is at module scope; the
	 * pointer is set before the first window is built. Not awaited, and it does
	 * not need to be: the host needs the window to exist, nothing after this call
	 * needs the host, and it owns its own teardown (its `closed` listener stops
	 * it). It reports its own failures and never rejects, so a browser capability
	 * that cannot start is a logged line rather than a reason the app does not
	 * come up.
	 */
	attachBrowserHostToWindow?.(mainWindow);
	return mainWindow;
}

// Initialize backend service manager and installer
const backendService = new BackendServiceManager();
const backendInstaller = new BackendInstaller();

/**
 * Report a start failure unless a shutdown is already in flight.
 *
 * `dialog.showErrorBox` is a native modal and parks the main thread, and the
 * quit path cannot proceed past a parked thread: the owned cleanup never
 * finishes, the quit's failsafe is a timer on that same thread and so never
 * fires, and the app sits windowless until something kills it (QA round 4,
 * Q-20: a SIGTERM during the first start left the app alive 50 s later). When
 * a shutdown is in flight the failure is logged instead, where the post-mortem
 * reads it. */
const reportBackendFailure = (message: string, fileType: LogFileType): void => {
	if (backendService.isShuttingDown()) {
		logger.error(
			`Backend Error (not shown; the app is shutting down): ${message}`,
			fileType,
		);
		return;
	}
	dialog.showErrorBox("Backend Error", message);
};

/*
 * The `[window-mode]` line that says what this process's window will do is
 * printed by the branch below that actually OWNS an instance, not here.
 *
 * Why it moved (UX review U1): `app.requestSingleInstanceLock` is taken a few
 * statements later, and a launch that loses it creates no window and never will.
 * Printing "window created and never shown" there — before the single-instance
 * question has even been asked — leaves the losing run with two lines that
 * disagree, and hides the one fact it needs: that its request went to the app
 * that already holds the profile, and what that app will do with it.
 */

/*
 * One line per raise, into the app's own log file, naming the trigger and what
 * the raise did (see `window-raise.ts`). The operator's report — "the app steals
 * my focus whenever a chat completes" — was unanswerable in production because
 * nothing recorded who had just raised the window; this is what makes the next
 * one attributable. `never` raises nothing and logs nothing, so a headless run
 * still leaves no trace by raising.
 *
 * THE ONE LINE THIS LOG CARRIES THAT IS NOT A RAISE is
 * `reportConversationReplaced`'s (`window-raise.ts`): under `never` a delivery
 * reaches the renderer and reports nothing at all while the panel still re-keys on
 * the session, so that line is the only account of a replacement having happened —
 * which is why it is written for EVERY delivery that replaces a conversation rather
 * than for the viewer's alone (UX round 1, U1/U2; round 2, U7).
 */
const reportRaise: RaiseReport = (line) => {
	logger.info(`[window-raise] ${line}`, LogFileType.BACKEND);
};

/**
 * What the LOSING launch prints, and the whole of it (UX review U1, and U5/U7 in
 * round 2).
 *
 * It created no window, so a `[window-mode]` line about a window would be a line
 * about something that does not exist. What a person or a rig can act on instead
 * is four facts: this run did not start, the app ALREADY OPEN is the instance
 * answering (with the profile path as the proof a rig needs), what that instance
 * will do with the request, and how to get a fresh instance of your own.
 *
 * The effect sentence is this process's OWN resolved mode, because that is the mode
 * it just handed over — and it stops short of promising anything now: a `headless`
 * request's conversation is delivered when the app has a window to deliver it to, not
 * when the request lands, which is what the mechanism can actually do (UX review
 * round 2, U5). WHICH window that is, said exactly (UX review round 2, U6): the one
 * already open, or — when that one is in use, and always when the app has none — the
 * next window the app CREATES, because a parked request is drained by a window's
 * creation and by nothing else.
 */
function describeForwardedLaunch(
	profile: string,
	session: string | null,
): string {
	/*
	 * THE CONVERSATION IT HANDED OVER IS NAMED (UX review round 3, U4). The id is
	 * the only thing that ties this sentence to a conversation, and without it a
	 * person reading their terminal cannot tell which one the app is about to open
	 * — or which one did not arrive. Named only when there is one: a launch that
	 * named nothing says so rather than leaving the reader to guess (`named no
	 * conversation`), because "no id" and "an id this line forgot" must not read
	 * alike (UX round 3, U3).
	 */
	const named =
		session === null ? null : `the conversation it named (${session})`;
	const handed =
		named === null ? "it named no conversation" : `${named} rides with it`;
	/*
	 * THE SESSION-LESS ARM IS NOT THE SAME PROMISE (review round 4, MINOR). The
	 * documented session-less agent launch (`pnpm app:headless`, and any second
	 * launch that names nothing) parks no conversation, so a sentence promising to
	 * open one — and quoting the queue's bound, which nothing is using — described a
	 * request that was never made. What is true there is that nothing is waiting to
	 * be opened and the mode's own promise about the window still holds; what is true
	 * on the named arm is unchanged, bound included, because that is where a
	 * conversation can be dropped.
	 */
	const effect =
		windowLaunch.show === "never"
			? named === null
				? `${handed}, so nothing is waiting to be opened, and it will not raise a window in the meantime`
				: `${handed}: the app will open it in the window it already has open, or in the next window it creates when that window is in use or there is none, and it will not raise a window in the meantime (up to ${PARKED_LAUNCH_LIMIT} conversations wait; an older one is dropped and logged)`
			: windowLaunch.show === "inactive"
				? `${handed}; the app may order its window forward without activating it`
				: `${handed}; the app will raise its window`;
	return `[second-instance] this launch did not start a window of its own: the app already open is the instance answering (profile: ${profile}), and this launch's window mode (${windowLaunch.mode}) was handed to it — ${effect}. Quit that app to start a fresh instance. Exiting.`;
}

/**
 * The raise plan a second launch's request maps to: the mode IT resolved, this
 * site's name for the log line, and who asked.
 *
 * A tiny adapter, but the site's name has to be applied HERE rather than inside
 * `openSessionInWindow`: that function is shared with the banner and viewer
 * requests, and naming the trigger there is what collapsed three different
 * causes into one line (review round 1, UX U2).
 */
const secondInstanceRequest = (request: SecondLaunchRequest): RaiseRequest => ({
	show: request.show,
	trigger: "second-instance",
	requester: request.requester ?? undefined,
});

/*
 * The renderer dev driver's opt-in, resolved here for the same reason the
 * window mode is: it is a fact about the LAUNCH, decided once, and a rig reads
 * it on stdout. Nothing is registered or exposed unless this says armed, so a
 * launch that did not ask for the driver has no `dev-driver-*` channel and no
 * bridge in the renderer at all — which is what
 * `node scripts/renderer-driver.mjs --gate-check` measures on a real boot
 * rather than trusting this comment. `src/main/dev-driver.ts` holds the rules
 * and `docs/agent-driver.md` is the contract for anyone using it.
 *
 * From `launchEnv`, for the reason given at the window mode above and measured
 * on real boots by `--gate-check`'s `.env` cases: the opt-in is a control
 * surface on a trusted process, so a `.env` in the working directory must not be
 * able to arm it, and an explicit `=0` at the shell must not be overridden by
 * one.
 */
const devDriverArming = resolveDevDriverArming({
	env: launchEnv,
	windowMode: windowLaunch.mode,
});
const devDriverLine = describeDevDriverArming(devDriverArming);
if (devDriverLine) console.log(devDriverLine);

/*
 * The renderer's half of that decision, as `webPreferences` for whichever window
 * is created. Empty in an unarmed launch, so a normal run's window options are
 * the options they would have had: the preload reads this entry out of its own
 * `argv` and exposes `window.__loDevDriver` only when it is there, while main
 * independently registers the `dev-driver-*` channels only when armed. Spelled as
 * a spread rather than as `additionalArguments: []` so that "unarmed adds no
 * option at all" is literally true of the object, not merely equivalent.
 */
const devDriverWebPreferences =
	devDriverArming.armed && devDriverArming.outDir
		? { additionalArguments: [devDriverArgument(devDriverArming.outDir)] }
		: {};

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
/**
 * The conversation this launch was asked to show, from `--open-session`.
 *
 * Read from argv at module load and applied to the FIRST window this process
 * creates, because that is the launch the click performed (`lop resume-click`'s
 * third rung spawns the app with the id). It reaches the renderer through
 * `webPreferences.additionalArguments` rather than through an IPC after the
 * load, so the renderer can paint THIS conversation in its first frame instead
 * of rehydrating the last one it had open and then swapping (B3).
 */
const launchTarget = readLaunchTarget(process.argv);
const launchSession =
	launchTarget.kind === "session" ? launchTarget.sessionId : null;
/**
 * Whether THIS launch asked for the catalogue rather than a conversation.
 *
 * A separate flag from `launchSession`'s absence, because the two are different
 * intents (review round 2, R2-1): no flag means "restore the last conversation",
 * and `--open-catalogue` means "open the list". The windowless half of a burst
 * digest's click is the case that needed the second one.
 */
const launchCatalogue = launchTarget.kind === "catalogue";

/**
 * The argv a renderer process is created with, resolved once for every caller.
 *
 * `{}` on an ordinary launch rather than an empty array: the preload parses a
 * flag out of argv, and a value it then has to decide means "no session" is a
 * second spelling of absence to keep in step.
 */
function launchArgumentFlags(
	initialSession: string | null,
	openCatalogue: boolean,
): { additionalArguments?: string[] } {
	if (initialSession) {
		return { additionalArguments: [`${OPEN_SESSION_FLAG}=${initialSession}`] };
	}
	if (openCatalogue) return { additionalArguments: [OPEN_CATALOGUE_FLAG] };
	return {};
}

/**
 * Everything this app puts in a renderer process's argv, in one value.
 *
 * WHY IT EXISTS. There are two sources now — the conversation or catalogue a
 * window was created for (`launchArgumentFlags`) and the dev driver's arming
 * entry (`devDriverWebPreferences`) — and both express themselves through the
 * SAME `webPreferences.additionalArguments` slot. Spreading them as two separate
 * entries at the call site does not union them: the second spread overwrites the
 * first's array, so an armed run that also names a session would carry one flag
 * and silently drop the other, with a well-formed window either way. This is the
 * one place that decides, so the two can never disagree about who wins.
 *
 * Empty means `{}` and not `additionalArguments: []`, for the reason
 * `launchArgumentFlags` gives: "this launch adds no option at all" has to be
 * true of the object, not merely equivalent to it.
 */
function rendererArgumentFlags(
	initialSession: string | null,
	openCatalogue: boolean,
): { additionalArguments?: string[] } {
	const flags = [
		...(launchArgumentFlags(initialSession, openCatalogue)
			.additionalArguments ?? []),
		...(devDriverWebPreferences.additionalArguments ?? []),
	];
	return flags.length > 0 ? { additionalArguments: flags } : {};
}

/**
 * A conversation a SECOND launch asked for before this process could open it.
 *
 * A second instance's `commandLine` can arrive while the first is still
 * starting — before `whenReady` has produced a window to send to — so the id is
 * parked here rather than dropped. Dropping it is precisely the class of silent
 * no-op the click path is being fixed for.
 *
 * The SHOW travels with it, and so does the trigger and the requester: the raise
 * that follows the delivery is the requester's to decide (`window-raise.ts`), and
 * a queued launch's decision cannot be re-derived later — by the time the queue
 * flushes, the argv and the payload it arrived with are gone. A `headless`
 * request in this state would otherwise create and present a window (review round
 * 1, MAJOR).
 */
/**
 * Requests PARKED because this app has no window and may not make one it can show.
 *
 * A QUEUE, not a slot (review round 2, MAJOR-1). With one slot, two `headless`
 * requests naming different conversations at a windowless app collapsed to the
 * last, and the first was in no log, no window and no later delivery — while its
 * losing launch had been told, in its own output, that the conversation would be
 * delivered. Every parked request waits now, and the next window drains them in
 * ARRIVAL ORDER: the first becomes that window's initial session (its first frame,
 * not a swap) and the rest are delivered to it once its renderer can hear them.
 *
 * WHO WINS WHEN A PARKED CONVERSATION MEETS A WINDOW OPENED FOR SOMETHING ELSE.
 * The request that CREATED the window, always: a catalogue click, a viewer
 * `resume_session`, a banner click or a person's launch that names a conversation
 * decides what that window opens, and every parked conversation is delivered to it
 * afterwards in arrival order. So the last parked conversation is what the operator
 * lands on, none is dropped, and parking never overrides the creator's intent and
 * never blocks a window some request needs now.
 */
export interface ParkedLaunch {
	session: string;
	request: RaiseRequest;
}

const parkedLaunches: ParkedLaunch[] = [];

/**
 * How many conversations may wait for a window at once.
 *
 * The queue is in-memory and unbounded otherwise, and an unbounded queue on a
 * long-lived app is a leak the operator pays for in memory to hold requests that
 * are, by now, stale (review round 3, NIT-3). The bound is generous against every
 * real shape of the burst it protects against — a scratch profile's worth of
 * agent launches arriving while the app has no window — and the OLDEST entry is
 * the one dropped, because the newest request is the one a person is most likely
 * still waiting on. Dropping is never silent: `reportParkedEvicted` names it, and
 * the bound is stated in AGENTS.md and in the losing launch's own sentence.
 */
const PARKED_LAUNCH_LIMIT = 16;

/**
 * Park a conversation for the next window, holding the bound above.
 *
 * `request` is the raise plan of the launch that asked, so the eventual delivery
 * raises as far as THAT launch allowed rather than as far as this process's plan
 * does — the whole point of the queue.
 *
 * `why` names WHICH rule parked it, because the two are different promises and one
 * line has to tell them apart: `unreachable` is a request that must not be shown
 * arriving where there is nothing to show it on, and `in-use` is a delivery that
 * would have taken the conversation the operator is working in. Both words go into
 * the queue identically — the reason only decides the line, so a park cannot be
 * half-applied. `reportParkedInUse` carries what the second one costs a caller.
 *
 * EVERY LINE ABOUT THIS ENTRY CARRIES THE ENTRY'S OWN PLAN (`request.show`), not
 * the `never` an ordinary park usually is: a second launch parked before the app
 * could answer it declared a mode for itself, and a log that prints `never` for a
 * `focus`-class request is the same inaccuracy the in-use path was given its own
 * plan argument to avoid (review round 1, MINOR-2).
 */
function parkLaunch(
	session: string,
	request: RaiseRequest,
	why: "unreachable" | "in-use" = "unreachable",
): void {
	parkedLaunches.push({ session, request });
	const parkLine = {
		trigger: request.trigger,
		requester: request.requester,
		report: reportRaise,
	};
	if (why === "in-use") reportParkedInUse(session, request.show, parkLine);
	else reportParked(session, parkLine, request.show);
	if (parkedLaunches.length <= PARKED_LAUNCH_LIMIT) return;
	const evicted = parkedLaunches.shift();
	if (evicted) {
		reportParkedEvicted(
			evicted.session,
			{
				trigger: evicted.request.trigger,
				requester: evicted.request.requester,
				report: reportRaise,
			},
			evicted.request.show,
		);
	}
}

/**
 * Deliver the parked conversations to a window, ONE AT A TIME, taking each out of
 * the queue only when its send has actually happened.
 *
 * WHY NOT A SPLICE UP FRONT (review round 3, MINOR-1 / QA round 3, Q-1). The
 * previous form emptied the queue into a single `did-finish-load` callback, so a
 * window that was closed — or whose renderer died — before that event took EVERY
 * claimed conversation with it: no line, no re-park, nothing left to open, while
 * each losing launch had been told the conversation is delivered by the next window
 * the app creates. The queue is the only place a conversation can wait for another window, so
 * an entry leaves it when the send happens and not when the window is created. If
 * the window dies first the entries are still in the queue and the log says so
 * (`reportParkedLeftWaiting`), so the operator's next window opens them.
 */
function claimParkedFor(
	window: BrowserWindow,
	deliver: (session: string, request: RaiseRequest) => void,
	painted?: ParkedLaunch,
): number {
	const claimed = parkedLaunches.slice(0, parkedLaunches.length);
	if (claimed.length === 0) return 0;
	window.webContents.once("did-finish-load", () => {
		for (const queued of claimed) {
			/*
			 * Still ours to deliver? A window that died can have had its claim
			 * superseded by another window that drained the same entry — delivering it
			 * twice would open the conversation twice, and the `includes` check is what
			 * makes "already delivered" and "still waiting" different states.
			 */
			const at = parkedLaunches.indexOf(queued);
			if (at === -1) continue;
			parkedLaunches.splice(at, 1);
			/*
			 * `painted` is the entry this window was CREATED for, and it is delivered
			 * like every other one — but not by `send`: the renderer was launched with
			 * it as its initial session, so this window's first frame IS the delivery,
			 * and sending it as well would open the conversation twice.
			 */
			if (queued !== painted) deliver(queued.session, queued.request);
			/*
			 * THE DELIVERED LINE FOLLOWS THE DELIVERY (QA round 1, Q-1 / review round 1,
			 * MAJOR-2). It used to be reported BEFORE `deliver` ran, which was sound only
			 * while `deliver` could not refuse: it can — the drain hands entries back to
			 * the gated `openSessionInWindow` — and the log then asserted
			 * `applied=delivered` for the same id it re-parked one line later with zero
			 * sends, so a conversation could be reported as arrived while it waited for
			 * yet another window. Reported after the send, the line is a statement about
			 * something that happened.
			 *
			 * `queued.request.show` rather than the `never` default, for the reason
			 * `parkLaunch` gives: one entry must not be described under two modes in one
			 * log.
			 */
			reportParkedDelivered(
				queued.session,
				{
					trigger: queued.request.trigger,
					requester: queued.request.requester,
					report: reportRaise,
				},
				queued.request.show,
			);
		}
	});
	window.once("closed", () => {
		/*
		 * PER ENTRY, each with its OWN requester (review round 4, NIT). One line naming
		 * several conversations could only borrow one requester's trigger, and "who
		 * asked for this one" is the whole question these lines exist to answer.
		 */
		for (const queued of claimed) {
			if (!parkedLaunches.includes(queued)) continue;
			// `queued.request.show` for the reason `parkLaunch` gives: this entry's own
			// plan, not the `never` an ordinary park usually is (review round 1, MINOR-2).
			reportParkedLeftWaiting(
				[queued.session],
				{
					trigger: queued.request.trigger,
					requester: queued.request.requester,
					report: reportRaise,
				},
				queued.request.show,
			);
		}
	});
	return claimed.length;
}

/**
 * This app's viewer record and control endpoint, created inside `whenReady`.
 *
 * Module scope so `will-quit` can clean them up: a record left behind
 * advertises a port nothing is listening on, which costs the next click its
 * whole dial timeout before it falls back to spawning a terminal. `null` means
 * the app never reached the point of creating them, not that a failure was
 * swallowed.
 */
let viewerRecord: ViewerRecordPublisher | null = null;
let viewerEndpoint: ViewerEndpoint | null = null;

/**
 * Open a conversation in a window, creating one if there is none. Assigned once
 * `whenReady` has the window-creation path in scope; `null` before that.
 */
let openConversationInWindow:
	| ((sessionId: string | null, request: RaiseRequest) => void)
	| null = null;

/**
 * Open this app's own window — the default view — for a request that arrived at
 * a windowless instance with nothing to deliver.
 *
 * The SAME SEAM AS `openConversationInWindow`, and for the same reason: the
 * window-creation path is defined inside `whenReady`, while the
 * `second-instance` handler lives at module scope. `null` before the app is
 * ready, where there is nothing to open yet — and the handler that would use it
 * cannot have fired, because the lock is taken at module scope and the app
 * creates its first window on the ready path.
 */
let openOwnWindow: ((request: RaiseRequest) => void) | null = null;

/**
 * Attach the browser host to a freshly created window. Assigned once
 * `whenReady` has the host's own state in scope; `null` before that.
 *
 * The SAME SEAM AS `openConversationInWindow` ABOVE, and for the same reason: the
 * host cannot start before the app is ready (it needs `app.getVersion()`,
 * `app.getPath("userData")` and the resolved renderer URL, all of which exist
 * only inside the ready callback), while the window is built by a module-scope
 * factory. Wiring it here rather than inside the factory's caller is what makes
 * R2-2 unconditional: every way a window comes into existence — a notification
 * click, a viewer resume, a second instance, the dock — goes through
 * `createWindow`, so none of them can forget the host (review round 3, R3-5).
 */
let attachBrowserHostToWindow: ((window: BrowserWindow) => void) | null = null;

/**
 * How long a click-created window may stay hidden waiting for the renderer to
 * report the conversation on screen.
 *
 * A BOUNDED fallback, not a timeout to tune: without it a renderer that never
 * reports (a crash loop, a backend that never answers the subscribe) would
 * strand a window the user cannot see and cannot close — strictly worse than
 * the flash the hold exists to prevent. 3 s is the launch-path budget the
 * design already names for "the app was not running", so a window shown by the
 * fallback still lands inside the target.
 */
const CONVERSATION_PAINT_FALLBACK_MS = 3_000;

/**
 * Windows whose first present is held until the renderer reports a specific
 * conversation on screen, keyed by window id.
 *
 * The report is the renderer's ordinary watch heartbeat (`desktop-watch-
 * heartbeat`, which names the conversation it is displaying) rather than a new
 * channel: that heartbeat already carries exactly this fact and is already sent
 * when the panel mounts, so a second signal would be a second thing that can
 * disagree with it.
 *
 * The REQUEST is stored with it, because the present that finally happens is
 * still the requester's to decide. A `headless` request that named a conversation
 * creates a window here, holds it, and must release it into nothing (review round
 * 1, MAJOR); by the time the release fires, the argv and the payload it arrived
 * with are gone, so the plan cannot be re-derived from them.
 */
const heldForConversation = new Map<
	number,
	{ session: string; timer: NodeJS.Timeout; request: RaiseRequest }
>();

/** Hold this window's first present until `session` is on screen. */
function holdPresentUntilConversation(
	window: BrowserWindow,
	session: string,
	request: RaiseRequest,
): void {
	const timer = setTimeout(() => {
		releaseHeldWindow(window.id);
	}, CONVERSATION_PAINT_FALLBACK_MS);
	timer.unref?.();
	heldForConversation.set(window.id, { session, timer, request });
}

/**
 * Show a window whose present was held, once its conversation is on screen.
 *
 * Idempotent, and answers whether it actually released one: both the renderer's
 * report and the fallback timer call it, and whichever arrives second must be a
 * no-op rather than a second `presentWindow`.
 */
function releaseHeldWindow(windowId: number): boolean {
	const held = heldForConversation.get(windowId);
	if (!held) return false;
	clearTimeout(held.timer);
	heldForConversation.delete(windowId);
	const window = BrowserWindow.fromId(windowId);
	if (window && !window.isDestroyed()) {
		/*
		 * The present is the REQUEST's, deferred until the conversation was on
		 * screen: the requester that created this window is what the line should
		 * name, and it is the requester's plan that decides whether anything comes
		 * forward at all — a `headless` request releases into nothing here.
		 */
		presentWindow(window, held.request.show, {
			trigger: held.request.trigger,
			requester: held.request.requester,
			report: reportRaise,
		});
	}
	return true;
}

/**
 * Release any window waiting for `session` to be reported on screen.
 *
 * Keyed on the CONVERSATION rather than on a window id, because that is what
 * the renderer reports: the heartbeat names the conversation it is displaying,
 * not the window it is running in. A held window for a different conversation
 * stays held until its own report or its fallback fires.
 */
function releaseHeldWindowFor(session: string): void {
	// EVERY window holding this conversation, not the first one found: the map is
	// keyed by window id and two windows can be waiting on the same conversation
	// (the notifier's comments describe exactly that case). Releasing one and
	// returning leaves the other to serve out the full fallback with its window
	// still off screen, which reads as a click that did nothing. The iteration is
	// safe against mutation because `releaseHeldWindow` deletes through the same
	// map, and Map iteration continues past a deletion.
	for (const [windowId, held] of heldForConversation) {
		if (held.session !== session) continue;
		releaseHeldWindow(windowId);
	}
}

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
/*
 * THE WINDOW INTENT RIDES THE REQUEST THAT LOSES. `second-instance` hands the
 * winner the loser's argv and this payload; the loser's ENVIRONMENT never
 * crosses, and the documented agent launches put the mode there
 * (`pnpm app:headless` is `LOCAL_OPERATOR_UI_WINDOW_MODE=headless electron .`) —
 * so without this, an agent's deliberately invisible run was answered as an
 * ordinary launch and raised the operator's window (the defect this change
 * fixes, measured). `--window-mode` on the losing launch's command line is read
 * as well, for the launchers that drop the environment (`open --args`), and
 * `window-raise.ts` settles which of the two wins.
 *
 * `windowLaunch` is resolved above, at module load, which is what makes the
 * resolved MODE available here rather than a re-read of a mutated `process.env`.
 */
const gotTheLock = app.requestSingleInstanceLock(
	windowIntentPayload(windowLaunch.mode, {
		// What the winner's log line names when it acts on this request (UX U2).
		// Declared by this process about itself, so it is diagnostic only: nothing
		// here is ever decided from it.
		pid: process.pid,
		cwd: process.cwd(),
	}),
);

if (!gotTheLock) {
	logger.warn("Another instance is already running. Quitting this instance.");
	/*
	 * WHAT THE LOSING LAUNCH SAYS (UX review U1).
	 *
	 * Three facts, and nothing else: no window was created here, the request went
	 * to the app that holds the profile, and what that app will do with it. The
	 * effect is this process's OWN resolved mode, because that is the mode it just
	 * handed over — a run that asked for `headless` can be told, in its own output,
	 * that nothing will be raised on its behalf. Exit code 0 and a line that
	 * disagrees with itself was the previous answer to three different outcomes.
	 */
	console.log(
		describeForwardedLaunch(
			app.getPath("userData"),
			readSecondLaunchRequest({ commandLine: process.argv }).session,
		),
	);
	app.quit();
} else {
	// This process owns the instance, so the line describes a window that will
	// exist. Quiet in `normal`, where a reader needs nothing and the shipped app's
	// stdout stays clean; the smoke-test path returns from `whenReady` later and is
	// unaffected either way.
	if (windowLaunch.mode !== "normal") {
		console.log(`[window-mode] ${describeWindowLaunch(windowLaunch)}`);
	}
	app.on(
		"second-instance",
		(_event, commandLine, workingDirectory, additionalData) => {
			/*
			 * A second launch means "recreate, then navigate" (m2), not "raise whatever
			 * is there": the same queue the banner click uses, so the two cannot
			 * disagree about what a request to open a conversation does — and the same
			 * window-raise policy, applied to the REQUESTING launch's intent rather
			 * than to this process's own plan. See `window-raise.ts` for why that
			 * distinction is the whole fix.
			 */
			applySecondLaunch(
				readSecondLaunchRequest({
					commandLine,
					additionalData,
					workingDirectory,
				}),
				{
					window: mainWindow,
					openConversation: openConversationInWindow
						? (session, request) =>
								openConversationInWindow?.(
									session,
									secondInstanceRequest(request),
								)
						: null,
					/*
					 * No window, and nothing to deliver to it: a request that may come forward
					 * opens the app's own window, exactly as the app's own launch does. It used
					 * to do nothing at all (`if (!target.window) return`), so the operator
					 * launching the app again while it ran saw nothing appear — and a
					 * conversation parked by a `headless` request was never opened by the
					 * launch that should have opened it. The window this creates consumes
					 * whatever is parked as its initial session.
					 */
					openWindow: openOwnWindow
						? (request) => openOwnWindow?.(secondInstanceRequest(request))
						: null,
					// Parked, not dropped: a second instance can arrive while the first is
					// still starting, and a discarded id is a click that silently did
					// nothing — the defect this path exists to remove. The request is parked
					// WITH it, so the flush cannot re-derive it from argv that is gone, and
					// the queue holds EVERY parked request rather than the last one
					// (review round 2, MAJOR-1).
					queue: (session, request) => {
						parkLaunch(session, secondInstanceRequest(request));
					},
					report: reportRaise,
				},
			);

			// Backend-owned OAuth completes on the backend's loopback callback;
			// the legacy radient:// deep link is no longer consumed here.
			void commandLine;
		},
	);
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

		/*
		 * A launch that finds its own install still running gets out of the way.
		 *
		 * WHY IT IS THIS EARLY, AND WHAT IT SAVES. An install four minutes into its
		 * work was aborted on 2026-09-18 (`Aborting update attempt because there are 1
		 * running instances of the target app`, `SQRLInstallerErrorDomain Code=-9`)
		 * because the app was open while it was installing: ShipIt asks whether any
		 * instance of the target app is running as its LAST check before the swap, so
		 * any instance at all spends the whole wait. Building a window and starting a
		 * backend is what makes an instance; a process that only has to raise one
		 * banner and quit is not one for the two seconds it lives, and nothing below
		 * here is started for it - no menu, no backend, no browser host, no window.
		 *
		 * WHAT IT DOES NOT TOUCH. The marker, the install's launchd job and the
		 * staging tree are left exactly as they are, because they are the install's
		 * and its own watchdog is what completes it; a marker that is stale, or one
		 * whose job is gone, is not this path at all and opens normally so recovery
		 * can explain what happened; and the notice's promise that the app returns is
		 * kept by the same watchdog ensure every other quit path uses, which happens
		 * before this process stops being able to make it.
		 *
		 * The decision and its bounds are `holdLaunchForLiveInstall` in
		 * `update-service.ts`; this is only the place in the launch that acts on it.
		 */
		if (
			holdLaunchForLiveInstall({
				log: (message) => logger.info(message, LogFileType.UPDATE_SERVICE),
			})
		) {
			return;
		}

		/*
		 * The app's own menu, installed BEFORE THIS HANDLER AWAITS ANYTHING.
		 *
		 * Why the position is load-bearing rather than tidy (code review round 1,
		 * F1): until this runs, Electron's DEFAULT application menu is live, and its
		 * first item is `About Electron` carrying Electron's own `about` role - a
		 * click with no handler of ours in the path, so the window mode cannot
		 * suppress it and a `headless` run has an un-gated About item for as long as
		 * this install has not happened. It used to sit below the backend startup in
		 * this handler, which is seconds of an agent-triggerable panel for every
		 * launch that has to install or reach a backend.
		 *
		 * Nothing below is needed to build it: the template reads `app.name`,
		 * `process.env.ELECTRON_RENDERER_URL` and the module-level `mainWindow`
		 * (through handlers that check it at click time), all of which exist here.
		 * It sits after the smoke-test branch above on purpose - that path exits the
		 * process immediately and wants no menu - and still before any `await` in
		 * this handler.
		 */
		configureAboutPanel();
		createApplicationMenu();

		/*
		 * A headless run does not outlive the process that launched it.
		 *
		 * The window is never shown and macOS keeps a windowless app alive, so an
		 * app whose harness died has nothing that would ever end it: one survivor per
		 * boot, each holding its memory and a Dock tile. Measured on this repo, a QA
		 * round's 13 boots left 13 survivors, all reparented to launchd, one of them
		 * still answering on its debugging port. `resolveLauncherWatchPlan` decides
		 * whether this run is launcher-bound at all (only `headless` with a real
		 * launcher is); the reason is printed either way, so a rig reads the policy
		 * rather than inferring it from the mode. Read from `launchEnv` for the reason
		 * the window mode above is: the `LOCAL_OPERATOR_UI_HEADLESS_KEEP_ALIVE`
		 * opt-out is a fact about the LAUNCH, so a `.env` in the checkout must not be
		 * able to make a run outlive the harness that started it.
		 */
		const launcher = resolveLauncherWatchPlan({
			mode: windowLaunch.mode,
			launcherPid: process.ppid,
			env: launchEnv,
		});
		logger.info(`[window-mode] ${launcher.reason}`, LogFileType.BACKEND);
		if (windowLaunch.mode !== "normal") {
			console.log(`[window-mode] ${launcher.reason}`);
		}
		if (launcher.watch && launcher.launcherPid !== null) {
			launcherWatch = startLauncherWatch({
				launcherPid: launcher.launcherPid,
				intervalMs: LAUNCHER_POLL_INTERVAL_MS,
				isAlive: isProcessAlive,
				parentPid: () => process.ppid,
				onLauncherGone: ({ message, detail }) =>
					endHeadlessRun(message, detail),
			});
		}
		if (windowLaunch.mode === "headless") {
			/*
			 * A signal is the case the graceful path does NOT reach on its own.
			 * Chromium's SIGTERM shutdown closes the window and then leaves the
			 * process up (macOS keeps a windowless app), and an app-initiated quit
			 * emits no `window-all-closed` at all — measured, SIGTERM to a booted
			 * headless app left it alive at 45 s and 70 s, with the quit never
			 * completing and the `will-quit` failsafe never reached. Handling the
			 * signal here turns it into the same bounded exit every other path gets
			 * and is also what makes Ctrl-C in a terminal end `pnpm dev:headless`.
			 */
			for (const signal of ["SIGTERM", "SIGINT"] as const) {
				process.on(signal, () => endHeadlessRun(`received ${signal}`));
			}
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
			{
				/*
				 * Whether a window we have a heartbeat from is still there.
				 *
				 * `forgetWindow` is called on `closed`, which covers every ordinary
				 * close — but a renderer process that dies takes its `webContents` id
				 * with it and no `closed` event reaches the notifier, and those ids
				 * are not reused. Filtering on liveness is what makes a stale
				 * `{visible: true, focused: true}` entry unable to suppress every
				 * completion for the rest of the run.
				 */
				windowAlive: (windowId) => {
					const contents = webContents.fromId(windowId);
					return Boolean(contents && !contents.isDestroyed());
				},
				// A banner click with no window recreates one and navigates it. The
				// queue lives in `openSessionInWindow` because window creation does.
				// A banner click's recreate path: the window it makes is presented as far
				// as THIS process's launch plan allows, because the click came from inside
				// this process. The trigger names the click rather than the delivery, so
				// the log tells the three conversation-carrying requests apart.
				reopen: (sessionId) =>
					openSessionInWindow(sessionId, {
						show: windowLaunch.show,
						trigger: "banner-click",
					}),
				/*
				 * The renderer's report that this conversation is on screen. Two
				 * consumers, and neither is delivery:
				 *
				 * - the viewer record's `current_session`, which is how a later click
				 *   routes here and how it skips a redundant switch;
				 * - the held first present of a click-created window, where this report
				 *   IS the "conversation applied" milestone `ready-to-show` is not
				 *   (B3).
				 */
				noteDisplayed: (sessionId) => {
					viewerRecord?.noteSession(sessionId);
					releaseHeldWindowFor(sessionId);
				},
			},
			// A clicked banner comes forward through this same raise policy, and its
			// line is what tells that trigger apart from the other four.
			reportRaise,
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
			// The feed's own gate: it reads `features.desktop_feed` and opens
			// nothing without it, so an older backend keeps the per-session path and
			// the renderer's 5 s catalogue poll verbatim. Read from the ready hook
			// for the same reason the contract read is: the token this relay needs
			// is minted inside `start()`.
			void backendService.getDesktopFeedRelay().start();
			void publishViewerPresence();
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
		/*
		 * The machine-wide feed's two consumers, and the split between them is the
		 * design: main takes the notifications (so a completion banners with no
		 * window at all — the operator's own reported case) and the window takes
		 * everything else it renders (attention merges, catalogue invalidations).
		 *
		 * A frame for a window that is not there is DROPPED, never queued: the
		 * feed is live-only with no replay, so a repainted sidebar after the window
		 * returns comes from the catalogue refetch on mount, not from a stale
		 * backlog of attention deltas.
		 */
		backendService.observeDesktopFeed(
			(frame: DesktopFeedFrame) => {
				if (frame.type === "notification") {
					desktopNotifier.observe(frame.session_id, frame);
					return;
				}
				const window = mainWindow;
				if (!window || window.isDestroyed()) return;
				window.webContents.send("desktop-feed-frame", frame);
			},
			(state: DesktopFeedState) => {
				const window = mainWindow;
				if (!window || window.isDestroyed()) return;
				window.webContents.send("desktop-feed-state", state);
			},
		);
		/*
		 * What the presence claim says about this app, read at every beat.
		 *
		 * Read through the notifier rather than recomputed here from `mainWindow`:
		 * the conversation it names is the one the completion gate uses, and a
		 * second opinion about which conversation is on screen is exactly the
		 * disagreement this lease must not have (it decides whether the backend
		 * banners a completion at all).
		 */
		backendService.providePresenceContext(() => desktopNotifier.presence());
		// A renderer that mounts after a reconnect asks for the CURRENT state, so a
		// healthy feed does not have to produce a transition before the sidebar can
		// stop saying "not connected".
		ipcMain.on("desktop-feed-watch", () => {
			const window = mainWindow;
			if (!window || window.isDestroyed()) return;
			window.webContents.send("desktop-feed-state", {
				connected: backendService.getDesktopFeedRelay().isConnected,
			});
		});

		/*
		 * The viewer record and the control endpoint that backs it: the artifact
		 * `lop resume-click` reads to decide that a click belongs HERE rather than
		 * in a new terminal. Published by MAIN, never by the renderer — a renderer
		 * reload would advertise a port that died with the document (see
		 * `viewer-record.ts`).
		 */
		const record = new ViewerRecordPublisher();
		const endpoint = new ViewerEndpoint(
			{
				resumeSession: async (sessionId) => {
					openSessionInWindow(sessionId, {
						show: windowLaunch.show,
						trigger: "viewer-resume",
					});
					return `showing ${sessionId}`;
				},
				focusWindow: async () => {
					const window = mainWindow;
					if (window && !window.isDestroyed()) {
						raiseWindow(window, windowLaunch.show, {
							trigger: "viewer-focus",
							report: reportRaise,
						});
						return "raised the window";
					}
					// No window to focus. Recreate one — the same "recreate then
					// navigate" rule the click path follows (m2), because a request to
					// bring this app forward from an app alive in the dock is exactly
					// the case that used to be a no-op.
					setupMainWindowWithUpdateService();
					return "opened a window";
				},
			},
			record.controlKey,
		);
		viewerRecord = record;
		viewerEndpoint = endpoint;

		/**
		 * Bind the endpoint and publish the record, once the backend says it reads
		 * one. Idempotent: the ready hook can fire twice in a tick.
		 */
		let viewerPublished = false;
		async function publishViewerPresence(): Promise<void> {
			if (viewerPublished) return;
			let features: Record<string, unknown> | undefined;
			try {
				const response = await backendService.requestDesktop({
					op: "capabilities",
				});
				const body = response.body as {
					result?: { features?: Record<string, unknown> };
				} | null;
				features = body?.result?.features;
			} catch {
				// No answer says nothing about what the backend supports, so nothing
				// is published. A backend old enough to need that care is also one
				// whose click falls through to the terminal rung, unchanged.
				return;
			}
			if (!(Number(features?.desktop_presence ?? 0) >= 1)) return;
			try {
				// Bind BEFORE publishing: a record advertising a port nothing
				// listens on costs a click its whole dial timeout.
				const port = await endpoint.start();
				record.setControlPort(port);
				record.start();
				viewerPublished = true;
			} catch (error) {
				logger.warn(
					`Viewer endpoint did not bind, so no record is published: ${String(error)}`,
					LogFileType.BACKEND,
				);
			}
		}
		registerDesktopIPC(
			() => mainWindow,
			rendererUrl,
			sendDesktop,
			() => backendService.getStreamRelay(),
			(input, bytes) => backendService.requestDesktopMedia(input, bytes),
			desktopNotifier,
			(sessionId) => viewerRecord?.releaseSession(sessionId),
		);

		/*
		 * The renderer dev driver's channels, present ONLY in an armed launch.
		 *
		 * Placed next to `registerDesktopIPC` because it is the same kind of
		 * thing — a main-owned surface the window may call — and registered
		 * BEFORE the first window is created, so the window cannot invoke a
		 * `dev-driver-*` channel before its handler exists and get Electron's
		 * "No handler registered" for a driver that is in fact armed. (The
		 * preload learns the frames directory from its own synchronous `argv`
		 * entry rather than from an IPC handshake — see the note on
		 * `DEV_DRIVER_ARG` in `src/main/dev-driver.ts` for why — so what the
		 * ordering protects is the capture call a scene makes later, not a
		 * handshake.) It reuses the same single trusted-renderer URL: a second
		 * spelling of "the trusted document" is how one of the two drifts.
		 */
		if (devDriverArming.armed && devDriverArming.outDir) {
			registerDevDriverIPC({
				window: () => mainWindow,
				expectedUrl: rendererUrl,
				outDir: devDriverArming.outDir,
				identity: {
					windowMode: windowLaunch.mode,
					appVersion: app.getVersion(),
					platform: process.platform,
				},
			});
		}

		/*
		 * Opening a file, and revealing one, both go through `resolveUserPath`.
		 *
		 * They used to spell the path themselves, which is how a `~/…` target
		 * failed: `shell.openPath` does not expand a tilde, so every path the
		 * transcript now renders as a link - and every path the agent writes that
		 * way, which is most of them - opened nothing at all. `read-file`,
		 * `save-file` and `file-exists` already routed through the helper; these
		 * two are the handlers that did not, and the ONE resolution rule is what
		 * keeps them agreeing with the rest of the app about which file a path
		 * names.
		 *
		 * Both answer with an OUTCOME rather than `void`, because both used to
		 * discard the half that says whether anything happened: `shell.openPath`
		 * RETURNS its error string (it does not throw), and `showItemInFolder`
		 * returns nothing at all - and reveals the parent of a path that does not
		 * exist without complaint. The transcript's link toolbar renders that
		 * answer (`No file at …`) instead of a press that looks broken.
		 */
		ipcMain.handle(
			"open-file",
			async (_, filePath: string): Promise<FileActionOutcome> => {
				const resolved = resolveUserPath(filePath);
				try {
					const failure = await shell.openPath(resolved);
					if (failure) {
						return { ok: false, resolved, error: failure };
					}
					return { ok: true, resolved };
				} catch (error) {
					console.error("Error opening file:", error);
					return {
						ok: false,
						resolved,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
		);

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
				/*
				 * The workspace root the containment verdict is measured against, resolved
				 * ONCE per batch: it is the same directory for every path asked about, and
				 * `realpath` on it per path would pay for one answer sixty-four times.
				 * `null` when no cwd was given, which is a caller that cannot get a
				 * verdict rather than a caller that gets "inside".
				 */
				const realRoot = cwd ? realPathOrNull(resolveUserPath(cwd)) : null;
				return asked.slice(0, MAX_PROBE_PATHS).map((input) => {
					let resolved = input;
					try {
						resolved = resolveUserPath(input, cwd);
						const stat = statSync(resolved, { throwIfNoEntry: false });
						const exists = stat !== undefined;
						return {
							input,
							resolved,
							exists,
							isFile: stat?.isFile() ?? false,
							sizeBytes: stat?.isFile() ? stat.size : null,
							mtimeMs: stat?.isFile() ? stat.mtimeMs : null,
							/*
							 * The containment verdict, and the reason it is asked ONLY of a path
							 * that exists: the one caller that reads it (the composer's `@` chip)
							 * asks the question about a candidate reference, so a path that is not
							 * there costs no second syscall — and a miss is the common case on the
							 * keystroke path this runs on.
							 */
							outsideWorkspace: exists
								? outsideWorkspace(realPathOrNull(resolved), realRoot)
								: undefined,
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
		 * One directory's listable entries, for a picker that offers rows from the
		 * filesystem.
		 *
		 * WHY THIS EXISTS AT ALL: the renderer cannot read a directory and
		 * `probe-files` answers existence, not membership, so a picker over the working
		 * directory has nothing to offer without it. It is ONE level by construction:
		 * a recursive walk on a keystroke path is the cost `scan_directory` in the
		 * harness spends a module docstring refusing, and deepening is the caller's
		 * business — it asks again for the directory the user typed a `/` into.
		 *
		 * The path goes through the SAME `resolveUserPath` as every other local-file
		 * handler, so `~`, a relative path and an absolute path mean here exactly what
		 * they mean to `probe-files` — the two calls a picker makes per keystroke
		 * cannot disagree about which directory they are describing.
		 */
		ipcMain.handle(
			"list-directory",
			async (_, dir: unknown, cwd?: string): Promise<DirectoryListing> => {
				const target = typeof dir === "string" && dir.length > 0 ? dir : ".";
				/*
				 * AWAITED, not returned bare, because this handler is on the ONE process
				 * that serves every other IPC in the app. `listDirectory` reads the
				 * directory asynchronously and bounds its own candidate list
				 * (`DIRECTORY_SCAN_LIMIT`), which is what keeps a pathological directory
				 * from stalling the window: a synchronous `readdir` of 200,000 entries
				 * measured 236ms of blocked main thread on a 60ms-debounced keystroke path.
				 */
				return await listDirectory(resolveUserPath(target, cwd));
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

		ipcMain.handle(
			"show-item-in-folder",
			async (_, filePath: string): Promise<FileActionOutcome> => {
				const resolved = resolveUserPath(filePath);
				/*
				 * The existence check is the handler's own, because
				 * `showItemInFolder` has no answer to give: it returns nothing and
				 * reveals the parent directory of a path that is not there, so
				 * without this the reader watches Finder open somewhere they did
				 * not ask for and reads that as the app being wrong about the path.
				 *
				 * `throwIfNoEntry: false` rather than a try/catch around the happy
				 * path, the same way `directory-exists` does it: a missing path is an
				 * ordinary `undefined`, and only a genuine fault (permission, a
				 * broken mount) reaches the catch.
				 */
				if (statSync(resolved, { throwIfNoEntry: false }) === undefined) {
					return { ok: false, resolved, error: `No file at ${resolved}` };
				}
				try {
					shell.showItemInFolder(resolved);
					return { ok: true, resolved };
				} catch (error) {
					console.error("Error showing item in folder:", error);
					return {
						ok: false,
						resolved,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
		);

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

		/*
		 * The server-status signal, answered by MAIN.
		 *
		 * The renderer used to decide "is the server online" by fetching `/health`
		 * itself, from the packaged app's `file://` document. That makes a CORS
		 * decision - and, on a claimed daemon, the origin allowlist - into a liveness
		 * signal, so a change in the backend's origin handling reports a healthy
		 * server as down. That is the reported failure. Main sends no Origin and
		 * holds the bearer, so it is the only process that can answer honestly, and
		 * the only one that knows whether the daemon it attached to is still the
		 * daemon it attached to.
		 *
		 * A pull (`backend-status`) plus a push (`backend-status-changed`): the pull
		 * so a window that opens later is not left waiting for the next transition,
		 * the push so a state change reaches the renderer within one probe interval.
		 */
		ipcMain.handle(BACKEND_STATUS_CHANNEL, () =>
			backendService.getStatusSnapshot(),
		);
		/*
		 * The banner's Retry, as a verb rather than a re-read.
		 *
		 * Re-reading the snapshot cannot cause a reconnection - main's own recovery
		 * timer is the only thing that could - so a renderer that only pulled the
		 * snapshot rendered a Retry that did nothing in the one state that offers
		 * one. This asks main to try now and answers with what it observed.
		 */
		ipcMain.handle(BACKEND_RECONNECT_CHANNEL, () =>
			backendService.reconnectNow(),
		);
		backendService.onStatusChange((snapshot) => {
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send(BACKEND_STATUS_EVENT, snapshot);
			}
		});

		// Check if backend manager is disabled via environment variable
		const isBackendManagerDisabled =
			process.env.VITE_DISABLE_BACKEND_MANAGER === "true";

		/*
		 * Discovery runs UNCONDITIONALLY, including when the manager is disabled.
		 * The flag means "do not spawn or kill a daemon", never "assume one
		 * exists": running it only in the enabled branch is why an app configured
		 * with the flag could not see the operator's own TUI-started daemon - it
		 * never looked, so it never found it, and every conversation opened empty
		 * (design §3.7).
		 */
		const hasExternalBackend = await backendService.checkExistingBackend();

		/*
		 * Only an app permitted to manage a daemon may install or start one. A
		 * disabled manager keeps looking (its probe loop re-discovers on every
		 * tick) and reports what it finds, which is what lets a daemon started
		 * after the app gets picked up without a restart.
		 */
		if (hasExternalBackend && isBackendManagerDisabled) {
			// A daemon was found with the manager disabled: nothing to install and
			// nothing to spawn, which is the whole of that flag's meaning.
			logger.info(
				"Discovered a daemon; the backend manager is configured not to spawn or kill one.",
				LogFileType.BACKEND,
			);
		} else if (!hasExternalBackend && isBackendManagerDisabled) {
			// Nothing was found and this app may not start a daemon. `start()` is
			// still the right call: with the flag set it spawns nothing - it
			// publishes the state and ARMS THE PROBE LOOP, so a daemon the operator
			// starts a minute from now is attached without restarting the app. Its
			// `false` is the honest answer here and must not quit the app.
			//
			// `reuseDiscovery` because the pass above ran in this same startup tick:
			// the verdict it recorded (nothing found, and whether a live record
			// forbids spawning) is what this call decides on, so a second sweep of
			// the record directory could only repeat it.
			await backendService.start({ reuseDiscovery: true });
		}

		if (!hasExternalBackend && !isBackendManagerDisabled) {
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
					reportBackendFailure(
						"Failed to start the Local Operator backend service after installation. Please restart the application.",
						LogFileType.INSTALLER,
					);
					app.quit();
					return;
				}
			} else {
				// Start our backend service (for existing installations).
				// `reuseDiscovery` for the reason the disabled-manager branch states,
				// and pointedly NOT on the post-install retries above: an install can
				// take minutes, and a daemon that appeared while it ran has to be found
				// rather than spawned over.
				const backendStarted = await backendService.start({
					reuseDiscovery: true,
				});
				if (!backendStarted) {
					logger.error(
						"Failed to start backend with existing installation, quitting app",
						LogFileType.BACKEND,
					);
					reportBackendFailure(
						"Failed to start the Local Operator backend service. Please restart the application.",
						LogFileType.BACKEND,
					);
					app.quit();
					return;
				}
			}
		}

		// --- Helper to manage main window and update service lifecycle ---
		let updateService: UpdateService | null = null;

		/*
		 * Create the window AND attach everything that window's lifetime owns.
		 *
		 * THE BROWSER HOST IS PART OF CREATING A WINDOW, not a step the startup path
		 * happens to take next (review round 2, R2-2). It used to be started at two
		 * call sites — the initial launch and the dock ``activate`` — while the
		 * click/viewer/second-instance path in ``openSessionInWindow`` created a
		 * window and started nothing. After the last window closed, a notification
		 * click therefore recreated chat with the browser capability silently
		 * missing, and activating the now-existing window could not repair it
		 * because the dock handler is gated on zero windows.
		 *
		 * Starting it HERE is what makes every creation path share the contract
		 * rather than duplicating #160's registration: there is one place a window
		 * comes into existence, so there is one place the host attaches to it. The
		 * host owns its own teardown (its ``closed`` listener stops it), which is why
		 * nothing here has to unwind it.
		 */
		function setupMainWindowWithUpdateService(
			initialSession: string | null = null,
			openCatalogue = false,
			request: RaiseRequest = ownLaunchRequest(),
		) {
			/*
			 * A conversation PARKED by a request that could not be shown — a `headless`
			 * launch that named one while this app had no window — rides into the window
			 * that exists now, whatever created it: the operator's own next launch, a Dock
			 * click, a banner click.
			 *
			 * As the window's INITIAL session when the creator named none, because the
			 * renderer paints that conversation in its first frame: sending it afterwards
			 * shows the previous conversation and then swaps it, which is the mis-landing
			 * B3 removed. The creator's own intent wins when it named a conversation of
			 * its own; the parked one is delivered below instead of being dropped.
			 */
			/*
			 * CLAIMED, NOT TAKEN (review round 4, MAJOR-1). This entry used to be
			 * `shift()`ed out of the queue here, before the window existed — so a window
			 * that died before its first paint destroyed it: not delivered, not
			 * re-queued, no state line, and nothing left to report at quit. It stays in
			 * the queue and leaves it on the rule every other entry follows: when it has
			 * actually reached a renderer, i.e. on this window's `did-finish-load`, which
			 * is also where the claim below removes it.
			 */
			const parked =
				initialSession === null && !openCatalogue
					? parkedLaunches[0]
					: undefined;
			mainWindow = createWindow(
				parked?.session ?? initialSession,
				openCatalogue,
				request,
			);
			// The `webContents` id this window's watch state is keyed on, captured
			// here because `mainWindow` is null by the time `closed` runs.
			const windowId = mainWindow.webContents.id;

			/*
			 * EVERY remaining parked conversation goes to this window, in arrival order.
			 * They cannot be its initial session — the creator named that (or the one
			 * above already took it) — so they are delivered once the window can hear
			 * them: a `webContents.send` before the renderer has loaded is a message with
			 * no listener, and dropping one is the silent no-op this path exists to
			 * remove. Draining the QUEUE here rather than one slot is what makes "nothing
			 * is lost" true for the second and later requests as well (review round 2,
			 * MAJOR-1).
			 */
			/*
			 * The delivery is `openSessionInWindow`, which lives inside `whenReady`:
			 * handed in rather than reached for, so the claim's rules stay testable and
			 * the queue stays where the window lifecycle can see it.
			 *
			 * AND IT IS NOT RE-GATED (`fromPark`). The entry being delivered is one this
			 * app already refused — or could not show — and this window exists to honour
			 * that promise, so asking the gate again lets the app refuse its own
			 * delivery: measured (QA round 1, Q-1 / review round 1, MAJOR-2), a drained
			 * entry against a window that was focused by the time it loaded produced
			 * `applied=delivered` and then `applied=parked+in-use` for the same id, with
			 * zero `desktop-open-conversation` sends and the entry back on the queue's
			 * tail — so a parked conversation could need more than one window, which is
			 * exactly what parking promises it will not.
			 */
			claimParkedFor(
				mainWindow,
				(session, request) =>
					openSessionInWindow(session, request, { fromPark: true }),
				parked,
			);

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
				// THE MISSING CALLER. Without it the notifier kept
				// `{visible: true, focused: true}` for this window id for the life of
				// the process, and since `webContents` ids are not reused, every
				// `when_unfocused` completion was then suppressed for good.
				desktopNotifier.forgetWindow(windowId);
				// A window that is gone is showing nothing, and the record must not
				// keep naming a conversation no window has (m2): a click for THAT
				// session would read `current_session` as a match, skip the switch,
				// and land the user on whatever the recreated window happened to
				// rehydrate.
				if (BrowserWindow.getAllWindows().length === 0)
					viewerRecord?.noteSession("");
				if (heldForConversation.has(windowId)) {
					// A held window destroyed before its conversation reported: drop the
					// fallback timer rather than let it fire against a dead id.
					const held = heldForConversation.get(windowId);
					if (held) clearTimeout(held.timer);
					heldForConversation.delete(windowId);
				}
				mainWindow = null;
			});

			// `focused_at` is the routing tiebreak when several viewers could take a
			// click, and only the GAINING edge carries that information.
			mainWindow.on("focus", () => viewerRecord?.noteFocused());

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

				/*
				 * Toggle command palette: Cmd/Ctrl + P — the palette's ORIGINAL gesture,
				 * kept for everyone who learned it from the app's own tour.
				 *
				 * Cmd/Ctrl + K, the gesture the app now teaches, is deliberately NOT here:
				 * a `before-input-event` hook fires before the renderer sees the key at all,
				 * and two surfaces in the canvas already own Cmd+K (the code editor's AI
				 * edit and the Markdown editor's link insert, which is what Cmd+K means in
				 * every editor these users have met). The renderer answers that one, so the
				 * editor that got there first keeps it — see
				 * `src/renderer/src/features/command-palette/palette-shortcut.ts`. One
				 * keystroke, one owner: binding both here would toggle twice per press and
				 * the palette would never open.
				 */
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
		 * re-created by a dock click starts a fresh one. A session holding a handle
		 * gets the ordinary `tab_closed` and re-`open`s, which is the designed
		 * recovery rather than a special case.
		 *
		 * THE TAB LIST SURVIVES it, which is the tab-restore work (design 7) and the
		 * reason the stop path captures and flushes `session.json` before it destroys
		 * anything: a window re-creation reopens the tabs the user had, and a session
		 * still holding `ui:<oldTabId>:<oldNonce>` gets the same `tab_closed` it always
		 * did, because a restored tab comes back with a fresh id and no nonce.
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
					// The launch plan's own answer, forwarded rather than re-derived: the
					// browser host uses it to suppress consent banners in a run with nobody at
					// the screen, and re-deciding it there would be a second policy beside
					// `window-mode.ts`.
					windowShow: windowLaunch.show,
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
		/*
		 * Open a conversation in this app's window, creating one if it has none.
		 *
		 * ONE function for every requester — a banner click, `resume_session` on
		 * the viewer endpoint, a second launch — because they are the same request
		 * and three implementations is how they drift into disagreeing about what
		 * "open" means. The create branch passes the id into the window's argv so
		 * the renderer can paint it in its FIRST frame, and the held present keeps
		 * the window off screen until that paint is confirmed (B3).
		 *
		 * `null` is the CATALOGUE, not a missing value: a burst digest's click
		 * names several conversations, so the window it recreates must open on the
		 * list rather than on one of them (R1-2). The CREATE branch has to say so
		 * explicitly (review round 2, R2-1): omitting the argv flag is what an
		 * ordinary launch does, and the renderer's rule for that case is "restore
		 * the last conversation" — so `null` travels to `createWindow` as the
		 * catalogue intent rather than as an absent value.
		 *
		 * `show` is the requester's, defaulting to THIS process's launch plan: a
		 * second launch may only come forward as far as IT asked, while the banner
		 * and viewer paths are requests from inside this process, where the launch
		 * plan already is the caller's intent.
		 *
		 * THE TWO BRANCHES DO NOT ASK THE SAME QUESTION about a request that must not
		 * be applied. With no window, the question is whether one may be CREATED
		 * (`canCreateWindowFor`); with one, it is whether that window's conversation
		 * may be REPLACED (`canRetargetWindow`) — which is refused for exactly one
		 * delivery, the one that would leave no trace: a `second-instance` launch under
		 * a `never` plan. A refused delivery parks on the same queue as the other. Both
		 * rules live in `window-raise.ts` with the policy they belong to; the gate
		 * itself is the existing-window branch below.
		 *
		 * `fromPark` IS THE ONE EXEMPTION, and it is not a bypass: it marks a delivery
		 * the app is making because a request was ALREADY parked — the drain below,
		 * honouring a promise this process made to the launch that asked. Asking the
		 * gate a second time lets the app refuse its own delivery, which is what was
		 * measured (QA round 1, Q-1 / review round 1, MAJOR-2): `applied=delivered`
		 * then `applied=parked+in-use` for one id, zero sends, the entry back on the
		 * queue's tail.
		 */
		function openSessionInWindow(
			sessionId: string | null,
			request: RaiseRequest,
			{ fromPark = false }: { fromPark?: boolean } = {},
		): void {
			const window = mainWindow;
			if (window && !window.isDestroyed()) {
				/*
				 * THE DELIVERY GATE — the only place a request may replace what an
				 * EXISTING window is showing.
				 *
				 * WHY IT IS HERE AND NOWHERE ELSE. This is the one function that retargets a
				 * window: a banner click, the viewer's `resume_session`, a second launch and
				 * the parked-conversation drain all arrive through it (the create branch
				 * below, and `secondInstanceRequest`, are the same request arriving where
				 * there is no window yet). Putting the rule anywhere else — the renderer's
				 * handler, the notifier, a per-caller check — is how the fourth requester
				 * ends up outside it, and the rule then holds for three quarters of the
				 * requests that can move this app's screen.
				 *
				 * WHAT IT COSTS WITHOUT THIS. A tool-spawned launch on the operator's own
				 * profile — the driven shape, which resolves `headless` — can name a
				 * conversation, find this window already up, and be applied to it. The
				 * request raises as far as it asked, which for `never` is nowhere, so the
				 * window does not move and `raiseWindow` reports NOTHING (silence is that
				 * mode's documented promise). What does move is the conversation: the
				 * renderer re-keys the panel on the session (`panelIdentityFor`), the
				 * composer subtree unmounts, and the caret dies with it. The operator's only
				 * symptom is a keystroke landing nowhere, in a window that never visibly
				 * changed, with no line in the log to explain it.
				 *
				 * SO THE RULE IS NARROW, and deliberately so (UX round 1, U1-U3): only a
				 * delivery that would LEAVE NO TRACE and is not the operator's own is PARKED
				 * — `second-instance` under a `show === "never"` plan, against a window he is
				 * using. `canRetargetWindow` carries the table and the residual (that one cell
				 * rests on the losing launch's own `--window-mode`). A `viewer-resume` and a
				 * `banner-click` are applied as they were before this gate existed, because
				 * refusing either costs more than the caret it saves: the viewer verb is what
				 * the operator's own notification click routes through, and the ladder reads
				 * any ack as "displayed", so a refusal that still answers `showing <id>` turns
				 * his own click into a silent no-op. A refused delivery still parks on the same
				 * queue the create branch uses, so nothing is applied, nothing is raised and
				 * nothing is dropped, and it opens in his next window (`reportParkedInUse`
				 * says so); what is delivered rather than refused is LOGGED below
				 * (`reportConversationReplaced`), for every delivery that replaces a conversation
				 * rather than for the viewer's alone, so a caret lost to one is attributable rather
				 * than invisible (UX round 2, U7).
				 *
				 * ONLY A NAMED conversation reaches the gate. `null` is the CATALOGUE, and
				 * it is not someone's conversation being installed over the operator's: its
				 * only source is a burst digest's banner click (`reopen(null)`), which is a
				 * person clicking, and it arrives here only from the no-window path anyway.
				 * Gating it would also mean parking an id to name — the queue is keyed by
				 * conversation, and "the list" is not one.
				 */
				if (
					!fromPark &&
					sessionId !== null &&
					!canRetargetWindow(request, window.isFocused())
				) {
					parkLaunch(sessionId, request, "in-use");
					return;
				}
				// Send before raising: naming the conversation first means whatever
				// comes forward is already correct, rather than showing the old one
				// for as long as the switch takes (B3).
				window.webContents.send("desktop-open-conversation", { sessionId });
				/*
				 * THE REPLACEMENT IS LOGGED, which is the other half of no longer refusing the
				 * viewer's delivery (UX round 1, U1/U2) — and it is logged by the SEND rather
				 * than by a `trigger` comparison (UX round 2, U7), because every delivery
				 * that reaches here replaces the window's conversation. Two of them used to
				 * leave no line at all: a `second-instance` request under `inactive` against
				 * a window on screen, whose raise line records `applied=showInactive` and
				 * nothing about the conversation, and one under `never` against a BLURRED
				 * window, which this gate APPLIES — nothing is being typed into — and which
				 * then reports nothing anywhere, since `never` raises and reports nothing.
				 * `sessionId !== null` is the guard rather than a trigger: a CATALOGUE open
				 * installs no conversation over one.
				 */
				if (sessionId !== null) {
					reportConversationReplaced(sessionId, request.show, {
						trigger: request.trigger,
						requester: request.requester,
						report: reportRaise,
					});
				}
				raiseWindow(window, request.show, {
					trigger: request.trigger,
					requester: request.requester,
					report: reportRaise,
				});
				return;
			}
			// A request that must not be shown does not create a window at all: it parks
			// its conversation for the operator's next window to open, so nothing
			// invisible is left holding a screen nobody can reach. See
			// `canCreateWindowFor` for why that is the worse of the two failures.
			if (!canCreateWindowFor(request.show)) {
				// SAID OUT LOUD, because it is the only account of a request that is
				// waiting: the winner creates no window and raises nothing, so without this
				// line "what happened to what I asked for" has no answer in the log even
				// though the losing launch was told it would be delivered (UX round 2, U5).
				// `parkLaunch` is what holds the queue's bound and reports an eviction.
				if (sessionId !== null) parkLaunch(sessionId, request);
				return;
			}
			// Otherwise the request goes to the CREATE branch too: a window this process
			// has to create for an `inactive` request must be presented by that request's
			// plan, not by this process's own (review round 1, MAJOR).
			setupMainWindowWithUpdateService(sessionId, sessionId === null, request);
		}
		openConversationInWindow = openSessionInWindow;
		/*
		 * A request that arrives at a windowless app with nothing to deliver opens the
		 * app's own window (the default view) rather than being ignored. The parked
		 * conversation — a `headless` launch that named one — rides in as that window's
		 * initial session, which is what makes "the operator's next window opens it"
		 * true on this path as well as on the Dock click.
		 */
		openOwnWindow = (request) =>
			setupMainWindowWithUpdateService(null, false, request);
		// The host's state is in scope from here, and this runs before the first
		// window is built below — as `openConversationInWindow` must be too.
		attachBrowserHostToWindow = (window) => {
			void startBrowserHostForWindow(window);
		};

		/*
		 * Initial window + update service setup. The browser host is attached by
		 * `createWindow`, because that is the one place a
		 * window comes into existence (review round 2, R2-2).
		 *
		 * NOTHING IS FLUSHED HERE ANY MORE. A launch parked by the second-instance
		 * handler — shipped before a window existed, or parked because it must not be
		 * shown — is consumed by `setupMainWindowWithUpdateService` itself, which is
		 * the one place every creation path goes through: startup, the Dock click and
		 * a click's recreate. A flush kept out here would run on one of those paths
		 * and forget the others.
		 */
		setupMainWindowWithUpdateService(launchSession, launchCatalogue);

		app.on("activate", () => {
			// On macOS it's common to re-create a window in the app when the
			// dock icon is clicked and there are no other windows open. The browser
			// host comes with the window (see `setupMainWindowWithUpdateService`),
			// so there is nothing to attach here — and attaching it a second time
			// would be the duplicate registration R2-2 ruled out.
			//
			// IT PRESENTS UNDER THE OPERATOR'S PLAN, NOT THIS PROCESS'S LAUNCH PLAN
			// (UX review round 2, U6). A Dock click is a person asking for the app, and
			// a `headless`-plan process answering it with `presentWindow(..., "never")`
			// would leave a real, invisible window holding whatever was parked — the
			// queue emptied into a screen nobody can reach. The mode governs the launch;
			// this is the other direction, and `OPERATOR_SHOW` is the plan that says so.
			if (BrowserWindow.getAllWindows().length === 0) {
				setupMainWindowWithUpdateService(null, false, {
					show: OPERATOR_SHOW,
					trigger: "initial-present",
				});
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
	/*
	 * A headless run has one window, no user, and no way back: if its window has
	 * closed the run is over. This is the WINDOW path and not the signal one —
	 * measured, a driver closing the window over CDP reaches this branch and the
	 * app is gone in about a second, while an app-initiated quit (a signal) does
	 * not emit `window-all-closed` at all, which is why the signal path handles
	 * itself above rather than leaning on this. Without either, a closed window
	 * left the process running with nothing in it: off macOS that is already
	 * `app.quit()` below, and the `darwin` branch deliberately keeps a windowless
	 * app in the Dock.
	 */
	if (windowLaunch.mode === "headless") {
		/*
		 * Prefixed like every other end path (round 2, D8): this line is how a rig
		 * learns which path ended a run, and it was the one that did not carry the
		 * prefix. Printed as well as logged, for the same reason the others are.
		 */
		logger.info(
			"[window-mode] all windows closed in a headless run; quitting",
			LogFileType.BACKEND,
		);
		console.log("[window-mode] all windows closed in a headless run; quitting");
		app.quit();
		return;
	}

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
/*
 * ...and never leave the user without a way out.
 *
 * Derived from the work the retry waits on, not asserted: `stop(false)` waits
 * for the start promise to settle, and that promise can be inside interpreter
 * resolution and the owned stop's own escalation, with the readiness poll's
 * last interval on top. Round 2's version of this constant named only the probe
 * budget and the stop escalation, which omitted the resolution execs and the
 * discovery window entirely - so the "60000 ms" it claimed could be reached
 * mid-cleanup and report a failure that had not happened (review round 3, F12).
 * Each term is the exported bound it comes from; changing any of them moves
 * this one.
 *
 * The console term is GONE rather than zeroed. It was two 5 s `where`/`which`
 * ceilings for naming the global launcher; that is now a synchronous search of
 * the installers' bin directories, so no wait is left to bound and a term for
 * one would hold this timer ten seconds past everything it actually waits on.
 *
 * What it does NOT cover, stated because a bound that only holds while the
 * thread is free is not a bound: it is a timer, so it cannot fire while the
 * main thread is parked. The one way this path parked it - a failure modal
 * raised while a quit was in flight - is removed (`reportBackendFailure`, QA
 * round 4 Q-20); any future blocking call on the quit path re-opens the hole.
 */
const QUIT_FAILSAFE_MARGIN_MS = 5_000;
const QUIT_CLEANUP_FAILSAFE_MS =
	INTERPRETER_RESOLUTION_WORST_MS +
	OWNED_STOP_WORST_MS +
	READINESS_POLL_INTERVAL_MS +
	QUIT_FAILSAFE_MARGIN_MS;
let backendQuitPending = false;
app.on("will-quit", (event) => {
	/*
	 * The viewer record and endpoint are this branch's, and they go BEFORE the
	 * owned-cleanup guard: that guard returns early when there is nothing owned to
	 * stop, and a record left behind advertises a port nothing is listening on,
	 * which costs the next click its whole dial timeout. The endpoint closes first
	 * so no dial can arrive against a removed record.
	 *
	 * Idempotent on purpose, and the main-side quit path is why: `app.quit()` in the
	 * cleanup below re-enters this handler, so both calls are reached twice. Neither
	 * is damaged by that - `ViewerEndpoint.close` null-guards its server and
	 * `ViewerRecord.stop` clears its timer - and the alternative reading, that the
	 * replaced handler's global process-killing cleanup should come back with them,
	 * is not one this rebase takes: #180 replaced that block with the owned-cleanup
	 * path deliberately (review round 4, the quit-path rebase).
	 */
	viewerEndpoint?.close();
	viewerRecord?.stop();
	if (backendService.isOwnedCleanupComplete()) return;
	event.preventDefault();
	if (backendQuitPending) return;
	backendQuitPending = true;
	const failsafe = setTimeout(() => {
		logger.error(
			`Owned backend cleanup did not finish within ${QUIT_CLEANUP_FAILSAFE_MS} ms; exiting with failure`,
			LogFileType.BACKEND,
		);
		app.exit(1);
	}, QUIT_CLEANUP_FAILSAFE_MS);
	// It must not be a reason for the process to stay alive by itself: the cleanup
	// it is watching is what holds the loop.
	failsafe.unref();
	void backendService
		.stop(false)
		.then(() => {
			clearTimeout(failsafe);
			app.quit();
		})
		.catch((error) => {
			clearTimeout(failsafe);
			logger.error(
				"Owned backend cleanup failed; exiting with failure",
				LogFileType.BACKEND,
				error,
			);
			app.exit(1);
		});
});

// Handle before-quit event to ensure proper cleanup
/*
 * The session-cookie hold: the quit waits on the browser host's stop, so the
 * snapshot that stop writes is on disk before the app goes away.
 *
 * The stop reads the cookie jar over CDP, so it is asynchronous and its duration
 * is the host's to inflate; a quit that exited mid-snapshot would leave the next
 * launch with nothing to restore, and with a marker the next start rejects.
 * EVERY quit while that stop is owed is held, including a second one the user
 * makes while the first is still waiting — the quit that releases them is the
 * hold's own, issued once the stop has settled or the budget has expired, and it
 * is the only pass that may proceed. Module scope so the mark distinguishing
 * those two survives between quits, and the decision itself lives in
 * `createSessionCookieQuitHold`, which is testable without booting the app. The
 * hold is bounded (`SESSION_COOKIE_QUIT_BUDGET_MS`); past the budget it releases
 * the quit, leaves the marker behind for the next start to reject, and says so in
 * the log — "quitting anyway" is that line, not an exit, and in a frozen teardown
 * the process can outlive it (the pre-existing stall QA's SIGSTOPped run hit 42 s
 * later, in a build without this hold's involvement).
 *
 * WHY THIS HOLDS `before-quit` AND NOT `will-quit`, where it was authored: the
 * `will-quit` listener above also owns the backend's owned cleanup, and that
 * handler has to reach its `event.preventDefault()` in the SYNCHRONOUS part of
 * the listener - Electron reads the cancelled flag when the synchronous part
 * returns, so a preventDefault that lands after an `await` cancels nothing, and
 * `scripts/owned-serve-lifecycle.test.mjs` pins that (two synchronous emits, both
 * counted as prevented). Awaiting this hold inside that listener would defer its
 * gate by a microtask and silently drop the owned cleanup. Holding here instead
 * keeps that gate synchronous AND serialises the two shutdown obligations rather
 * than racing them: the stop settles first, the re-quit it asks for then reaches
 * the owned cleanup, and only the pass with both behind it exits. The hold module
 * is unchanged and says nothing about which event it is asked from.
 */
const holdQuitForSessionCookieSnapshot = createSessionCookieQuitHold({
	isPending: browserHostStopPending,
	stop: stopBrowserHost,
	quit: () => app.quit(),
	log: (message) => logger.warn(message, LogFileType.BACKEND),
});

app.on("before-quit", async (event) => {
	/*
	 * Hold the quit for the browser host's stop, then let the ordinary pass
	 * through: the stop settles or the budget expires, the hold asks for the quit
	 * that reaches the body below. A second quit arriving while that stop is still
	 * running is held against the same stop — see the hold's own module for why a
	 * spent flag could not do that and exited with the snapshot still running.
	 *
	 * `before-quit` starts the stop and cannot await it, so the wait lives here;
	 * the `will-quit` listener owns the owned cleanup and runs once this has
	 * settled. A stop that FAILS still re-quits - see the hold's own module for why
	 * that is the difference between a shutdown and an app that refuses to close
	 * without saying so.
	 */
	if (await holdQuitForSessionCookieSnapshot(event)) return;

	logger.info("App is about to quit", LogFileType.BACKEND);

	/*
	 * A WAITING CONVERSATION DIES WITH THE PROCESS, AND SAYS SO (review round 3,
	 * NIT-3). The queue is in-memory, so a park still waiting here is gone for good
	 * — and its losing launch was told it would be delivered by the next window the
	 * app creates. The line is the only place that promise can be seen to end, which
	 * is what makes a park that never arrived distinguishable from one the log
	 * simply lost.
	 *
	 * It lives HERE rather than in `will-quit`, where it was first written, because
	 * `scripts/owned-serve-lifecycle.test.mjs` slices and runs that handler on its
	 * own: a read of this module's queue is a reference that slice cannot satisfy,
	 * and a shutdown narrative belongs on the handler that already owns one.
	 */
	if (parkedLaunches.length > 0) {
		reportParksAtQuit(
			parkedLaunches.map((parked) => parked.session),
			reportRaise,
		);
	}
	/*
	 * The bounded exit for EVERY way a headless run can be asked to quit, not
	 * only the two that arm it themselves (the launcher going, a signal). This is
	 * here rather than in the two call sites because a quit that wedges is a
	 * property of the quit path, not of whoever asked for it: measured on this
	 * head, `app.quit()` from a signal never reached `will-quit` and never
	 * completed, so a run whose launcher went would have sat there had the
	 * deadline been armed only in the watch's callback. Arming it here also makes
	 * the window-close path (a driver closing the window over CDP) bounded.
	 *
	 * The watch is stopped with it: a poll that lands mid-shutdown must not stack
	 * a second quit on the one already under way.
	 */
	if (windowLaunch.mode === "headless") {
		launcherWatch?.stop();
		armHeadlessExitDeadline("the app is quitting");
	}
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
