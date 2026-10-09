import { readFileSync, writeFileSync } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	Menu,
	app,
	dialog,
	globalShortcut,
	ipcMain,
	nativeImage,
	session,
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
	EXTERNAL_OPEN_REFUSED_CHANNEL,
	type ExternalOpenOutcome,
	type FileActionOutcome,
	MAX_FILE_READ_BYTES,
	MAX_PROBE_PATHS,
	type ProbedFile,
	type ReadFileBytesResponse,
} from "../shared/desktop-contract";
import type { DesktopFeedState } from "../shared/desktop-contract";
import type { DesktopFeedFrame } from "../shared/desktop-session-contract";
import {
	MINI_VIEW_DIALOG,
	MINI_VIEW_REGISTRATION,
	MINI_VIEW_REGISTRATION_GET,
	type MiniViewDialogPayload,
} from "../shared/mini-view";
import {
	OPEN_CATALOGUE_FLAG,
	OPEN_SESSION_FLAG,
	readLaunchTarget,
} from "../shared/open-session";
import {
	type WindowChromeMode,
	windowChromeArgumentFor,
} from "../shared/window-chrome";
import {
	BackendInstaller,
	BackendServiceManager,
	INTERPRETER_RESOLUTION_WORST_MS,
	LAUNCHER_PROBE_WORST_MS,
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
import {
	CONSENT_ATTENTION_CHANNEL,
	type ConsentAttentionPayload,
} from "./browser/consent-click";
import { createSessionCookieQuitHold } from "./browser/session-cookie-quit-hold";
import { consoleCaptureUrlFor } from "./console/capture-url";
import { guardForegroundReceipts, registerDesktopIPC } from "./desktop-ipc";
import { DesktopNotifier } from "./desktop-notifier";
import {
	describeDevDriverArming,
	devDriverArgument,
	headlessExerciserAllowed,
	resolveDevDriverArming,
} from "./dev-driver";
import { registerDevDriverIPC } from "./dev-driver-ipc";
import {
	listDirectory,
	outsideWorkspace,
	realPathOrNull,
	resolveUserPath as resolveUserPathWith,
} from "./directory-listing";
import { type MiniViewRegistrar, createRegistrar } from "./hotkey-registration";
import { isProcessAlive, startLauncherWatch } from "./launcher-watch";
import type { LauncherWatch } from "./launcher-watch";
import {
	type QuickSendWatcher,
	readQuickSendValue,
	watchQuickSend,
} from "./local-config";
import { type MiniView, createMiniView, miniViewUrlFor } from "./mini-view";
import { paletteDoorChannel } from "./palette-door";
import {
	rememberPickedDirectory,
	withRememberedDirectory,
} from "./picker-directory";
import { createQuitState } from "./quit-state";
import { createRelaunchPending } from "./relaunch-pending";
import { createUserShellPath } from "./shell-path";
import {
	describeTelemetryLaunch,
	resolveTelemetryLaunch,
	telemetryArgument,
} from "./telemetry-launch";
import { titlebarOptions } from "./titlebar-options";
import { UpdateService, holdLaunchForLiveInstall } from "./update-service";
import { ViewerEndpoint } from "./viewer-endpoint";
import { ViewerRecordPublisher } from "./viewer-record";
import { attachWindowChrome, resolveLaunchWindowChrome } from "./window-chrome";
import { openVettedExternal, popupVerdict } from "./window-guards";
import {
	guardDownloads,
	guardNavigation,
	guardPermissions,
	guardPreviewResponses,
	guardWindowOpen,
} from "./window-guards-electron";
import {
	LAUNCHER_EXIT_DEADLINE_MS,
	LAUNCHER_POLL_INTERVAL_MS,
	WINDOW_MIN_HEIGHT,
	WINDOW_MIN_WIDTH,
	type WindowShow,
	describeWindowLaunch,
	hotkeysAllowed,
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
	reportSkippedWhileQuitting,
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
		/*
		 * REVIEW F2: this forced exit is a terminal too — the bounded way a quit
		 * that cannot finish ends — so a reopen refused during that teardown is
		 * completed here exactly as at the `will-quit` sites (the one helper below:
		 * idempotent, an empty call is a no-op). Without it, a record whose refusal
		 * line already said `reopen=deferred` could die on this exit.
		 */
		scheduleReopenAtQuitTerminal();
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
 *
 * AND A NON-HIDDEN LAUNCH ASSERTS THE TILE RATHER THAN ASSUMING IT. The mode
 * table says a `normal` launch is NOT launcher-bound and its window is a
 * person's to close, which is only true if the app participates in the Dock —
 * and measured on the operator's machine (2026-09-30) a `normal` launch can
 * still come up in the ACCESSORY policy: the auto-update relaunch left pid
 * 32713 (v0.31.24) with no Dock tile, its menu reading "app not running",
 * while its own log said `window mode normal is not launcher-bound` and its
 * window was on screen. The chain that produced it is not the mode resolver —
 * two byte-identical relaunches came up regular and accessory — so the policy
 * is asserted here, where the mode is already known, instead of trusted from
 * whatever the launch context handed the process. The dock-policy show call is
 * idempotent for an app that is already regular, and it is NOT a window raise:
 * the dock show/hide pair sets the app's DOCK participation, which is the policy
 * `windowLaunch.hideDock` already decides — the raise-family ban in
 * `scripts/window-mode.test.mjs` is about windows (show/focus/maximize), so its
 * one-line allow for this call is line-narrow and documented there.
 *
 * WHAT THIS CANNOT DO, stated where the assertion is: a detach that happens
 * after startup is not prevented by it. It guarantees the tile EXISTS at
 * launch; whether the record keeps presenting it is the OS's. The mid-life case
 * belongs to `reassertDockParticipation` below, and the probe is what says which
 * call heals it: a PLAIN activation does not clear the detach, the explicit
 * dock-policy show call does.
 */
const image = nativeImage.createFromPath(icon);
if (process.platform === "darwin" && app.dock) {
	if (windowLaunch.hideDock) {
		app.dock.hide();
	} else {
		app.dock.show();
		app.dock.setIcon(image);
	}
}

/**
 * Re-assert this process's Dock participation when the user touches the app.
 *
 * WHY IT EXISTS BESIDE THE STARTUP ASSERT: the startup assert guarantees a tile
 * at launch and CANNOT heal a detach that happens later — measured on the
 * operator's machine (2026-09-30) instance A lost its tile (record
 * `ApplicationType=UIElement`, no Dock tile, the tile's menu reading "app not
 * running") HOURS after a regular launch, with its window on screen, and kept it
 * until the process was replaced. A Dock click is the one moment macOS is already
 * asking this app to present, so it is where the policy is re-asserted.
 *
 * THE GUARD IS THE POINT: a `headless` run must never gain a tile from a stray
 * activate, so the re-assert is impossible when `windowLaunch.hideDock` is set —
 * the SAME fact the startup branch above reads, so the two cannot disagree. The
 * mini-view/popup surfaces exist only in `normal` launches, which is why one
 * guard covers them.
 *
 * The dock-policy show call is idempotent for an app that is already regular
 * and is NOT a window raise (see the startup block above for the same
 * argument; the raise-family scan's one-line allow covers this call too).
 *
 * WHAT THE PROBE SHOWED ABOUT THE ALTERNATIVE: a PLAIN activation does not clear
 * the detach — measured, `open -a` and `osascript … activate` both left a
 * forced-accessory instance accessory, while an explicit dock-policy show call
 * restored it. So the healing has to be this call, not a hope that macOS
 * restores the tile on its own.
 */
function reassertDockParticipation(): void {
	if (process.platform !== "darwin" || !app.dock) return;
	if (windowLaunch.hideDock) return;
	app.dock.show();
}

/*
 * PostHog, or nothing at all.
 *
 * WHY THIS IS A DECISION RATHER THAN A CONSTRUCTOR CALL. A test, harness, QA or
 * CI run boots this real app, and until this switch existed every one of them
 * registered as a user and as a session replay in the "Local Operator Usage"
 * project: the shipped build carries the live project key by default, so a run
 * that simply omitted the variable still had one, and an explicitly empty one
 * threw in the constructor at module load (before `app.whenReady()`, surfacing
 * as an error dialog). `resolveTelemetryLaunch` owns the two ways this becomes
 * "off" — the launch's switch, and a build with no key — and reads the switch
 * from `launchEnv`, the environment this process was LAUNCHED with, so a `.env`
 * in the checkout can neither silence a real user nor speak for a rig.
 *
 * `null` rather than a client with a no-op configuration, because the point is
 * that nothing is constructed: no client, no queue, no flush, and nothing to
 * shut down (see the `process.on("exit")` handler below, which is the other half
 * of this decision). An ordinary launch is unaffected: no switch, a key, and
 * `posthogClient` is the same client it was.
 */
const telemetryLaunch = resolveTelemetryLaunch({
	env: launchEnv,
	projectKey: backendConfig.VITE_PUBLIC_POSTHOG_KEY,
});
const telemetryLine = describeTelemetryLaunch(telemetryLaunch);
if (telemetryLine) console.log(telemetryLine);
const posthogClient = telemetryLaunch.enabled
	? new PostHog(backendConfig.VITE_PUBLIC_POSTHOG_KEY, {
			host: backendConfig.VITE_PUBLIC_POSTHOG_HOST,
			enableExceptionAutocapture: true,
		})
	: null;

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

/**
 * The ONE trusted renderer URL: the dev server while developing, the packaged
 * document otherwise. Module scope because `createWindow` (which installs the
 * navigation guard) lives here while `registerDesktopIPC` (which checks the same
 * value against a sender's frame) lives inside `whenReady`; two spellings of "the
 * trusted frame" is how one of them drifts.
 */
const rendererDocumentUrl = (): string =>
	process.env.ELECTRON_RENDERER_URL ||
	pathToFileURL(join(__dirname, "../renderer/index.html")).href;

/**
 * Every document of this app's own renderer that the main window's session may
 * show: the app and the Quick send mini view (a second document of the same
 * bundle with the same preload, whose composer asks for the microphone).
 */
const trustedRendererDocuments = (): readonly string[] => [
	rendererDocumentUrl(),
	miniViewUrlFor(rendererDocumentUrl()),
];

/**
 * The single door from a renderer-reachable code path to the OS's URL handlers
 * (`window.open` and the `open-external` IPC both land here). The scheme and
 * shape rules are `window-guards.ts`'s; this binds them to `shell`, and the
 * outcome travels to whoever asked (round-2 R-4).
 */
const openExternalVetted = (raw: unknown): Promise<ExternalOpenOutcome> =>
	openVettedExternal(
		raw,
		(url) => shell.openExternal(url),
		(message) => logger.warn(message, LogFileType.BACKEND),
	);

/**
 * The sign-in popup's window options, supplied to `guardWindowOpen` at every
 * install site - the main window and the mini view. ONE spelling, because the
 * two guards must create the same window; the values are the pre-guard
 * handler's, plus `disableDialogs` (round-2 S-7).
 */
const authPopupWindowOptions: BrowserWindowConstructorOptions = {
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
		/*
		 * A JS dialog in a popup must not be able to wedge it (round-2 S-7): a
		 * renderer-reached `confirm()`/`alert()` needs no permission and blocks
		 * every later evaluation on the page behind its modal.
		 */
		disableDialogs: true,
	},
};

function createWindow(
	initialSession: string | null = null,
	openCatalogue = false,
	request: RaiseRequest = ownLaunchRequest(),
): BrowserWindow {
	/*
	 * THE WINDOW'S CHROME, resolved before the window exists because two of its
	 * halves are constructor-only: `titleBarStyle` has no setter, and
	 * `backgroundColor` is what the OS paints before the renderer's first frame - a
	 * dark palette that gets Electron's default `#FFF` there flashes white on every
	 * launch. The colours come from the PERSISTED file rather than from the renderer
	 * for the obvious reason: the renderer does not exist yet, and the theme it would
	 * report lives in its `localStorage`.
	 *
	 * `launchEnv`, not `process.env`, for the reason the window mode is read that way:
	 * `./backend/config` has already folded a `.env` from the working directory over
	 * `process.env`, and a file in the checkout must not be able to decide how the
	 * window is framed.
	 *
	 * A problem here is a warning and never a refusal. The mode is recoverable from
	 * inside the app (Settings > Appearance), and the launch that reached for
	 * `--window-chrome=native` because the integrated frame had made its window
	 * impossible to move is exactly the case the switch exists for - refusing to
	 * start would be the worst answer available to the one launch that needs help.
	 */
	const chrome = resolveLaunchWindowChrome({
		argv: process.argv,
		env: launchEnv,
		userDataDir: app.getPath("userData"),
		platform: process.platform,
	});
	for (const problem of chrome.problems) {
		logger.warn(`[window-chrome] ${problem}`, LogFileType.BACKEND);
		console.log(`[window-chrome] ${problem}`);
	}

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
		/*
		 * The frame, per platform, from a pure function so the matrix is exercised on
		 * any host (`scripts/titlebar-options.test.mjs`). macOS hides its title bar
		 * and keeps the native traffic lights, which is why the renderer reserves their
		 * 32px lane at the top of the shell (`chat-layout.tsx`) - the lane exists
		 * because this line does, and shipping one without the other is either 32px of
		 * blank space under a native title bar or lights drawn over the app's own row.
		 */
		...titlebarOptions(process.platform, {
			mode: chrome.mode,
			colors: chrome.colors,
		}),
		/*
		 * The ground the OS paints before the renderer's first frame. Without it
		 * Electron's default is `#FFF`, so every launch on a dark palette opened with a
		 * white flash - the same defect `INSTALL_WINDOW_CANVAS` fixed for the installer
		 * window, and a hard-coded palette value that a test keeps honest.
		 */
		backgroundColor: chrome.colors.ground,
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
			...rendererArgumentFlags(initialSession, openCatalogue, chrome.mode),
		},
	});

	/*
	 * The live half of the chrome: the palette's colours on every theme change, the
	 * reported corner ground, the three state pushes and the app-menu popup. Attached
	 * AFTER construction because it needs the window, and disposed on `closed` so a
	 * second window (the auth popup is one) does not inherit the handlers and a
	 * closed one leaves no `ipcMain` handler pointing at a destroyed object.
	 *
	 * It contains no `show`, `showInactive`, `focus`, `maximize` or `setFullScreen`
	 * call, which is what keeps this window's chrome work compatible with the
	 * `headless` mode an agent run uses - `maximize()` on a hidden window SHOWS it,
	 * so a style change that reached for one would put a window on the operator's
	 * screen. `scripts/window-mode.test.mjs` scans for that family and names this
	 * module among the ones that must not contain one.
	 */
	const chromeController = attachWindowChrome({
		window: mainWindow,
		mode: chrome.mode,
		colors: chrome.colors,
		userDataDir: app.getPath("userData"),
		headless: windowLaunch.mode === "headless",
		log: (line) => logger.info(line, LogFileType.BACKEND),
	});
	mainWindow.on("closed", () => chromeController.dispose());
	/*
	 * THE MINI VIEW MUST NOT DEFEAT THE WINDOWS/LINUX QUIT CONTRACT (quick-send
	 * design §C.5's platform note, read against this app's existing behaviour).
	 * On macOS closing the main window leaves the app running, so the hidden mini
	 * view simply stays and the hotkey keeps working — the Dock-only case the
	 * feature is built for. On Windows and Linux, closing every window is how the
	 * app quits (`window-all-closed`), and a hidden window that nothing closes is
	 * an app that never reaches it: a process with no visible surface and no way
	 * back. So the mini view is torn down with the main window THERE, and only
	 * there — the window-all-closed handler is untouched.
	 */
	if (process.platform !== "darwin") {
		mainWindow.on("closed", () => miniView?.dispose());
	}

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

	/*
	 * THE MAIN WINDOW'S HOST-POWER GUARDS (UI security lane U-a; the rules and
	 * their rationale are `window-guards.ts`, the wiring is `window-guards-
	 * electron.ts`). Navigation, `window.open` and permissions were all unguarded
	 * for renderer-side content, which includes agent-generated HTML in the canvas
	 * preview. Registered BEFORE the first load below so the initial navigation is
	 * already under the rule.
	 *
	 * The popup branch keeps the sandboxed sign-in window exactly as it was; what
	 * changed is WHICH urls reach it (host match, not substring) and that every
	 * other url is scheme-gated before `shell.openExternal` instead of passed
	 * through as a raw string.
	 */
	guardNavigation(mainWindow.webContents, trustedRendererDocuments, (m) =>
		logger.warn(m, LogFileType.BACKEND),
	);
	guardWindowOpen(
		mainWindow.webContents,
		popupVerdict,
		openExternalVetted,
		authPopupWindowOptions,
		(m) => logger.warn(m, LogFileType.BACKEND),
		(url, reason) =>
			mainWindow.webContents.send(EXTERNAL_OPEN_REFUSED_CHANNEL, {
				url,
				reason,
			}),
	);

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
//
// The one resolver for the user's own PATH, built HERE because this is the only
// file that owns both consumers: the backend manager below, and the browser host
// that starts the console. Handing the same instance to both is what keeps "what
// is this user's PATH" a single answer in this process - see `./shell-path` for
// the measurement (a launchd-started app sees `/usr/bin:/bin:/usr/sbin:/sbin`,
// so neither a console surface nor `execute_bash` could find Homebrew). Started
// lazily on the first ask, so a run that needs neither starts no shell.
const userShellPath = createUserShellPath({
	log: (message) => logger.info(message, LogFileType.BACKEND),
});
const backendService = new BackendServiceManager({ userShellPath });
/*
 * WHETHER THIS PROCESS HAS BEGUN QUITTING, and has not been cancelled since.
 *
 * Read by every site that must not answer a request with a window once a quit
 * is under way - the `second-instance` target, the macOS `activate` handler and
 * the window-create path - and set at `before-quit`'s FIRST entry, ahead of the
 * session-cookie hold, which can wait while the window is already doomed (the
 * operator's #636 report is exactly that state: a relaunch answered by a
 * process whose window is gone but whose lock and teardown are not). The ONE
 * release is the setup window's declined "Quit without setup?" - the one
 * cancellation a running quit has - wired through `BackendInstaller` below; a
 * cancelled quit that left the state set refused every later second launch and
 * Dock click for the process's life (round-1 review, F-1). `./quit-state`
 * carries the full contract and the sweep of the other close guards;
 * `scripts/window-mode.test.mjs` pins the setter/release wiring and
 * `scripts/python-bytecode-cache.test.mjs` drives the declined answer against
 * the shipped installer.
 */
const quitState = createQuitState();
/*
 * #755: THE RECORD OF A REOPEN REFUSED DURING THIS QUIT. The two refusals that
 * mean "the user asked for the app" (a second launch, a Dock click) record what
 * was asked for here; the quit's terminal (`will-quit`, which already names
 * itself "the completion") spends the record by scheduling ONE successor
 * instance, and the successor boots after this process exits under the
 * recorded plan. `./relaunch-pending` owns the shape, the exactly-once rule
 * and why the record is in-memory only.
 */
const relaunchPending = createRelaunchPending();
const backendInstaller = new BackendInstaller({
	// The installer's one route back from a cancelled quit: the declined dialog
	// answer (`./quit-state` owns why there is exactly one such site). The
	// refused reopen's record is let go BESIDE that release: a cancelled quit
	// must not leak a spawn into some later, unrelated exit
	// (`./relaunch-pending` owns why scheduling happens only at the terminal).
	onQuitCancelled: () => {
		quitState.cancel();
		relaunchPending.clear();
	},
});

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

/*
 * The renderer's half of the telemetry decision, ALWAYS written.
 *
 * WHY THIS ONE IS NOT CONDITIONAL, when the dev driver's entry above is. The dev
 * driver is an opt-in, so its absence can safely mean "off"; telemetry's default
 * is ON, so if silence also meant "on" then any window created by a path that
 * forgot to compose this entry would ship the events this switch exists to stop —
 * and the preload could not tell that case apart from a host that is not an app
 * window at all. Spelling the decision out on every window makes the renderer's
 * fail-closed default (`resolveTelemetryEnabled`: an explicit `true` from the
 * bridge AND a non-blank key in the build it made) safe to hold. The two words
 * are the whole vocabulary, and they live in `./telemetry-launch`, which the
 * preload reads back out of its own argv.
 */
const telemetryWebPreferences = {
	additionalArguments: [telemetryArgument(telemetryLaunch.enabled)],
};

// Radient tokens and OAuth state used to live in an electron-store session
// file here. The backend AuthStore owns provider credentials now and the
// desktop bearer is process-scoped, so main keeps no credential store.

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// Define mainWindow at a higher scope to be accessible in event handlers
let mainWindow: BrowserWindow | null = null;

/*
 * The quick-send mini view and its registration (design D6/§G.1). Module scope
 * so `before-quit` can dispose them and `window-all-closed`'s platform contract
 * can still reach the window; all three are non-null only in a `normal`
 * launch, which is the design's whole gate (`hotkeysAllowed`).
 */
let miniView: MiniView | null = null;
let miniViewRegistrar: MiniViewRegistrar | null = null;
let quickSendWatcher: QuickSendWatcher | null = null;

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
 * WHY IT EXISTS. There are three sources now — the conversation or catalogue a
 * window was created for (`launchArgumentFlags`), the dev driver's arming
 * entry, and the telemetry decision (`telemetryWebPreferences`, which is on
 * every window) — and all of them express themselves through the SAME
 * `webPreferences.additionalArguments` slot. Spreading them as separate entries
 * at the call site does not union them: a later spread overwrites the earlier
 * one's array, so an armed run that also names a session would carry one flag
 * and silently drop the other, with a well-formed window either way. This is the
 * one place that decides, so the sources can never disagree about who wins.
 *
 * Empty means `{}` and not `additionalArguments: []`, for the reason
 * `launchArgumentFlags` gives: "this launch adds no option at all" has to be
 * true of the object, not merely equivalent to it. With telemetry always
 * present that branch is unreachable from the call sites below, and it is kept
 * deliberately: this function's contract is "compose whatever applies", not
 * "there is always something".
 */
function rendererArgumentFlags(
	initialSession: string | null,
	openCatalogue: boolean,
	chromeMode: WindowChromeMode,
): { additionalArguments?: string[] } {
	const flags = [
		/*
		 * The chrome facts, and they are ALWAYS written - unlike the conversation or
		 * the dev driver's arming entry, which appear only when they apply. The
		 * renderer chooses between two incompatible layouts on this value, so a reader
		 * that had to infer it from an absent entry would be guessing; see
		 * `readWindowChromeArgument` for why the guess fails towards `native`.
		 */
		windowChromeArgumentFor(process.platform, chromeMode),
		...(launchArgumentFlags(initialSession, openCatalogue)
			.additionalArguments ?? []),
		...(devDriverWebPreferences.additionalArguments ?? []),
		...(telemetryWebPreferences.additionalArguments ?? []),
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

// The quit state lives at the top of this file, beside the installer that can
// release it (`quitState`; `./quit-state` owns the contract): the handler below
// SETS it at the first `before-quit` entry, and every answer site reads it per
// request.

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
					/*
					 * Read PER REQUEST rather than captured once: this handler outlives every
					 * window, and the state is LIVE — set at each quit's first `before-quit`
					 * entry, released when the setup dialog declines to stop a run — so a
					 * request that arrives during a quit is refused instead of answered with
					 * a window the shutdown would take down, and a request after a CANCELLED
					 * quit is answered normally (`./quit-state` owns the transitions;
					 * `window-raise.ts` owns the refusal and its line).
					 */
					quitting: quitState.isQuitting(),
					/*
					 * #755: A REFUSED SECOND LAUNCH LEAVES A RECORD. The request that would have been
					 * refused whole is one the user made, so beside the refusal it is recorded and
					 * the quit's terminal completes it with one successor instance
					 * (`./relaunch-pending` owns the shape and the exactly-once rule). `commandLine`
					 * is THIS request's own, so what the successor replays cannot drift from what
					 * was refused, and the recorder's answer is what makes the refusal line say
					 * `reopen=deferred` (`window-raise.ts` owns the token).
					 */
					onRefusedWhileQuitting: (request) =>
						relaunchPending.record({
							kind: "second-instance",
							show: request.show,
							argv: commandLine,
						}),
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

		/*
		 * SESSION-LEVEL GUARDS, installed once before any window exists (UI
		 * security lane U-a). The default session is shared by the main window, the
		 * Quick send mini view and every iframe they host, so a policy set here
		 * covers the canvas preview's frame too - and the console capture window,
		 * which is created with NO `partition` (`console/capture.ts`), so these
		 * handlers DO apply to it; it is not one of the trusted renderers, so any
		 * capability it ever asked for would be refused, and nothing in that module
		 * asks today (round-2 R-5). The driven browser uses its own partition,
		 * where `browser/profile.ts` installs the same pair.
		 *
		 * - permissions: deny by default (Electron otherwise approves EVERYTHING,
		 *   for any frame), granting only what the app's own documents use.
		 * - the backend's static serve family gets a CSP and nosniff on its
		 *   RESPONSE, because the daemon serves it bare and that module is another
		 *   repository's.
		 * - downloads: deny by default (security review S-4) - an unhandled
		 *   `will-download` runs the save routine, so without this any script that
		 *   reaches an app document could start a download; the app's own export
		 *   blobs are the one class kept (they keep the ordinary save dialog).
		 */
		guardPermissions(session.defaultSession, trustedRendererDocuments, (m) =>
			logger.warn(m, LogFileType.BACKEND),
		);
		guardPreviewResponses(session.defaultSession);
		guardDownloads(session.defaultSession, trustedRendererDocuments, (m) =>
			logger.warn(m, LogFileType.BACKEND),
		);

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
		const rendererUrl = rendererDocumentUrl();
		/*
		 * The capture view's own document, derived from the trusted renderer URL rather than
		 * spelled a second time: in development it is the same dev server with a different
		 * entry, and in a packaged build it is the sibling of `index.html` in
		 * `out/renderer`. Deriving it means a dev server on another port, or a moved bundle,
		 * cannot leave the capture path pointing at a document that is not there — which
		 * would fail as a blank frame rather than as a missing file. The two shapes and the
		 * dev one that is easy to get wrong (code review round 1's B1) live, with their
		 * test, in `console/capture-url.ts`.
		 */
		const consoleCaptureUrl = consoleCaptureUrlFor(rendererUrl);
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
					// the case that used to be a no-op. The request names ITS OWN
					// trigger (round-1 review, F-3): the window this creates presents —
					// and is refused, if the app is quitting — as `viewer-focus`, where
					// the default request would have said `initial-present`, this
					// process's own launch, which this is not.
					setupMainWindowWithUpdateService(null, false, {
						show: windowLaunch.show,
						trigger: "viewer-focus",
					});
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
		/*
		 * The global hotkey's whole wiring (design §D.2/§G): the hidden mini
		 * window, the registrar over Electron's own `globalShortcut`, the config
		 * watch, and the registration state pushed to every renderer.
		 *
		 * NORMAL LAUNCHES, PLUS THE DEV DRIVER'S HEADLESS EXERCISER (M-B1). The
		 * design's §C.4 rule reads from the same launch plan every window is built
		 * from: an ordinary rig-shaped run gets no window and no registration —
		 * "an agent run never answers the operator's keyboard" is a property of
		 * the launch rather than of the code paths inside. The one exception is
		 * the armed dev driver in a `headless` run, where a window the app OWNS is
		 * what lets a rig exercise the send path at all (the desktop plane admits
		 * by frame, `desktop-ipc.ts`; a scene-built window is refused before any
		 * request leaves the app). It registers NOTHING — `hotkeysAllowed` gates
		 * the registrar and the watcher below — and it is never shown:
		 * presentation stays `presentMiniView`'s gate, which a headless plan
		 * refuses.
		 *
		 * PLACED BEFORE `registerDesktopIPC` because that registration carries
		 * this feature's write-through tap: a `keymap.*` write arriving over
		 * `desktop-request` re-applies the registration the moment the backend
		 * accepts it, without waiting for the poll (the watcher stays the
		 * mechanism of record for the TUI, `lop config edit` and hand edits).
		 *
		 * WHY THE WINDOW IS CREATED AT READY RATHER THAN ON FIRST PRESS: the
		 * hotkey must answer on the first press, and a window created at that
		 * moment would pay its renderer's whole boot inside the interaction.
		 *
		 * K6, DECIDED (manager, remediation round 1): the hidden renderer stays
		 * for the app's life. Measured cost: ≈160–172 MB working set for the mini
		 * renderer in this branch's evidence runs (QA round 1 re-measured
		 * 173–195 MB under fleet load) against the design's advisory ">150 MB ⇒
		 * switch to destroy-after-idle". The acceptance criterion that outranks
		 * the advisory is the first press: a window created on demand pays the
		 * renderer's whole boot inside the interaction the hotkey exists to make
		 * instant. If memory is ever flagged, the follow-up is lazily-created —
		 * not a lighter always-on window.
		 */
		const miniViewExerciser = headlessExerciserAllowed({
			arming: devDriverArming,
			windowMode: windowLaunch.mode,
		});
		if (hotkeysAllowed(windowLaunch.mode) || miniViewExerciser) {
			const quickSend = createMiniView({
				url: miniViewUrlFor(rendererUrl),
				preloadPath: join(__dirname, "../preload/index.js"),
				show: windowLaunch.show,
				/*
				 * The launch's chrome facts, resolved through the same function the
				 * main window called — read here rather than threaded through
				 * `createWindow`'s signature, which would touch call sites outside
				 * this feature's slice for a value that is a launch fact (argv, the
				 * launch env, the persisted file) and cannot differ between the two
				 * calls. The mini view's visible consumer of it is the platform
				 * half: the header's keycap spells ⌘⌥⇧Space against Ctrl+Alt+Shift+Space
				 * from exactly this entry.
				 */
				chromeMode: resolveLaunchWindowChrome({
					argv: process.argv,
					env: launchEnv,
					userDataDir: app.getPath("userData"),
					platform: process.platform,
				}).mode,
				report: reportRaise,
			});
			miniView = quickSend;
			/*
			 * THE MINI VIEW IS A MAIN WINDOW TOO (security review S-3): it carries
			 * the app preload and `sandbox: false` and received none of the guards
			 * above, so the next content surface mounted there - not the composer
			 * that mounts today - would inherit an unguarded window with a bridge.
			 * Navigation and popups are per-webContents; permissions and downloads
			 * are already covered because it shares `session.defaultSession`. The
			 * initial load is `createMiniView`'s own `loadURL`, which Electron does
			 * not emit navigation events for, so attaching here cannot miss it.
			 */
			guardNavigation(
				quickSend.window.webContents,
				trustedRendererDocuments,
				(m) => logger.warn(m, LogFileType.BACKEND),
			);
			guardWindowOpen(
				quickSend.window.webContents,
				popupVerdict,
				openExternalVetted,
				authPopupWindowOptions,
				(m) => logger.warn(m, LogFileType.BACKEND),
				(url, reason) =>
					quickSend.window.webContents.send(EXTERNAL_OPEN_REFUSED_CHANNEL, {
						url,
						reason,
					}),
			);
		}
		if (hotkeysAllowed(windowLaunch.mode)) {
			const initial = readQuickSendValue();
			miniViewRegistrar = createRegistrar({
				shortcut: globalShortcut,
				platform: process.platform,
				/*
				 * The LAUNCH env, like the window mode: `XDG_SESSION_TYPE` is a fact
				 * about the session this process started in, and a `.env` in the
				 * checkout must not be able to decide whether this machine gets a
				 * dead key (the Wayland refusal).
				 */
				env: launchEnv,
				onTrigger: () => miniView?.toggle(),
				onState: (state) => {
					/*
					 * THE PUSH IS THE SURFACE (design §G.3): the settings row renders
					 * the live state, so every window hears about every change — a
					 * chord that failed to register is visible without a reload.
					 */
					for (const window of BrowserWindow.getAllWindows()) {
						if (window.isDestroyed()) continue;
						window.webContents.send(MINI_VIEW_REGISTRATION, state);
					}
				},
			});
			if (initial.problem !== undefined) {
				logger.warn(
					`mini-view: ${initial.problem} — using the shipped default`,
					LogFileType.BACKEND,
				);
			}
			const applied = miniViewRegistrar.apply(initial.value);
			/*
			 * THE STARTUP LINE (§G.1/§G.5), on stdout as well as the log so a rig
			 * can read it the way it reads `[window-mode]` — the state a dead key
			 * would hide behind is exactly the state a tooling run needs to see.
			 */
			console.log(
				applied.status === "registered"
					? `mini-view: registered ${applied.accelerator} (value ${applied.value})`
					: `mini-view: not registered (${applied.status}: ${applied.reason ?? "no reason given"})`,
			);
			quickSendWatcher = watchQuickSend({
				onValue: (value) => {
					const state = miniViewRegistrar?.apply(value);
					if (state)
						logger.info(
							`mini-view: config changed, registration is ${state.status}`,
							LogFileType.BACKEND,
						);
				},
				onProblem: (message) =>
					logger.warn(`mini-view: ${message}`, LogFileType.BACKEND),
				baseline: initial.present ? initial.value : undefined,
			});
		} else {
			if (miniViewExerciser) {
				const line =
					"mini-view: exerciser window created (dev driver armed; no registration in this mode)";
				logger.info(line, LogFileType.BACKEND);
				console.log(line);
			}
			const line = `mini-view: not registered (window mode ${windowLaunch.mode})`;
			logger.info(line, LogFileType.BACKEND);
			console.log(line);
		}

		/*
		 * The registration READ (design §D.3): the settings row asks once on
		 * mount and is pushed to thereafter. Authorized like every other window
		 * channel — the app's own window, its main frame — because the answer
		 * names the chord this machine listens for.
		 */
		ipcMain.removeHandler(MINI_VIEW_REGISTRATION_GET);
		ipcMain.handle(MINI_VIEW_REGISTRATION_GET, (event) => {
			const owner = mainWindow;
			if (
				!owner ||
				owner.isDestroyed() ||
				event.sender !== owner.webContents ||
				event.senderFrame !== owner.webContents.mainFrame
			) {
				throw new Error("This window cannot read the hotkey registration.");
			}
			const state = miniViewRegistrar?.getState() ?? null;
			if (state) {
				return state;
			}
			/*
			 * A window exists and the app is running in some other mode (or the
			 * registrar has not answered yet): the honest answer is what the
			 * launch said — the registration was denied by the MODE, and the row
			 * should say so rather than showing a fabricated `registered`.
			 */
			return {
				value: "",
				accelerator: "",
				status: "unavailable" as const,
				reason: `window mode ${windowLaunch.mode} registers no global shortcuts`,
			};
		});

		registerDesktopIPC(
			() => mainWindow,
			rendererUrl,
			sendDesktop,
			() => backendService.getStreamRelay(),
			(input, bytes) => backendService.requestDesktopMedia(input, bytes),
			desktopNotifier,
			(sessionId) => viewerRecord?.releaseSession(sessionId),
			/*
			 * The hotkey's write-through tap (design §G.2): a `keymap.*` write the
			 * backend accepted re-reads the file and re-applies immediately. The
			 * callback re-reads rather than carrying a value, so the fast path
			 * and the poll share one source of truth.
			 */
			() => {
				const reading = readQuickSendValue();
				if (reading.problem !== undefined) {
					logger.warn(
						`mini-view: the settings write landed but the config re-read failed: ${reading.problem}`,
						LogFileType.BACKEND,
					);
					return;
				}
				miniViewRegistrar?.apply(reading.value);
			},
			/*
			 * The mini view's window is a SECOND trusted document (design §D.1):
			 * its composer resolves the seat and sends through the desktop plane
			 * exactly as the main window's chat does, so it passes the same gate.
			 * Its own document URL travels with it — `trustedDesktopFrame` checks
			 * the pair, so a window can never be admitted on another document's
			 * URL. Empty until the mini view exists, and empty again after
			 * `before-quit` disposes it, which is the same lifecycle the
			 * registration follows.
			 */
			() =>
				miniView === null
					? []
					: [{ window: miniView.window, url: miniViewUrlFor(rendererUrl) }],
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

		/*
		 * Vetted, not forwarded: the renderer's `window.api.openExternal` takes any
		 * string, and `shell.openExternal` launches whatever the OS maps the scheme
		 * to. Every caller in the renderer passes an http(s) link (or an update
		 * remedy's page). The outcome travels back to the caller (round-2 R-4): a
		 * refusal is what the caller's toast renders, instead of a press that
		 * resolved quietly and looked broken. The anchor path has no caller to
		 * answer - its refusals are pushed on `EXTERNAL_OPEN_REFUSED_CHANNEL` (see
		 * `guardWindowOpen`'s `notifyRefused`).
		 */
		ipcMain.handle("open-external", async (_, url) => openExternalVetted(url));

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

		ipcMain.handle("show-open-dialog", async (event, options) => {
			/*
			 * THE DIALOG BELONGS TO THE WINDOW THAT ASKED (mini restyle, risk R3).
			 * The handler used to parent every picker to `mainWindow`, so a file
			 * picker opened from the mini view sheared onto the MAIN window while
			 * the mini - which hides itself on blur by design - read the focus
			 * change as "the user left" and dismissed out from under its own
			 * dialog. Parenting to the sender's window makes the sheet part of the
			 * mini, and the broadcast latch below covers the platforms and
			 * situations where focus still moves.
			 */
			const parent = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
			if (!parent) {
				logger.error(
					"Cannot show open dialog: no window can own it.",
					LogFileType.BACKEND,
				);
				return { canceled: true, filePaths: [] };
			}
			/* The mini window, pinned in a local: `miniView` is module state and the
			   awaits below invalidate the narrowing. */
			const mini = miniView;
			const fromMini =
				mini !== null &&
				!mini.window.isDestroyed() &&
				event.sender === mini.window.webContents;
			const dialogPayload: MiniViewDialogPayload = { open: true };
			if (fromMini)
				mini.window.webContents.send(MINI_VIEW_DIALOG, dialogPayload);
			try {
				const result = await dialog.showOpenDialog(
					parent,
					withRememberedDirectory(
						"open-file",
						options,
						pickerFallbackDirectory(),
					),
				);
				rememberPickedDirectory("open-file", result.filePaths);
				return result;
			} finally {
				if (fromMini && mini !== null && !mini.window.isDestroyed())
					mini.window.webContents.send(MINI_VIEW_DIALOG, {
						open: false,
					} satisfies MiniViewDialogPayload);
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
				const installSuccess = await backendInstaller.install(
					windowLaunch.show,
				);
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
					/*
					 * THE SAME DISPOSITION AS THE EXISTING-INSTALLATION ARM BELOW, and for
					 * the same reason (review round 1, R1-1). This site used to quit
					 * unconditionally, and it is REACHABLE in exactly the state the incident
					 * was measured in: `checkLocalOperatorExists()` false and
					 * `backendInstaller.isInstalled()` false is a first launch, or an app whose
					 * managed venv was invalidated, and with both spawn addresses held
					 * `startOwned` refuses each address (`backend-service.ts`, the record arm
					 * and `resolveSpawnTarget`), returns false three times, and this arm took
					 * the window down with the modal - the twelve-minute incident one arm
					 * down from where it was fixed. The previous round judged this site
					 * unreachable on the machine it was measured on; the reachability argument
					 * above is the answer to that, and it is the reason this is fixed rather
					 * than ticketed.
					 *
					 * Falling THROUGH rather than returning is the point, as below: the early
					 * `return` on the other arms exists to skip window creation, and skipping
					 * it here would leave the operator with the same nothing, only quieter.
					 */
					if (backendService.isStartBlockedByOccupiedAddress()) {
						logger.error(
							"Failed to start backend after installation: every address this app may serve on is held by something it does not own. Continuing without quitting; the status surface names the holder and the app keeps probing.",
							LogFileType.INSTALLER,
						);
					} else {
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
					/*
					 * AN ADDRESS THIS APP DOES NOT OWN IS NOT A REASON TO TAKE THE APP DOWN.
					 *
					 * Measured 2026-09-23: the configured address was held by a different
					 * local-operator install's stray `lop serve`. The app refused it by identity
					 * (correct) and refused to spawn its own over it (also correct - the token is
					 * minted before the spawn, so minting over an occupied address overwrites
					 * that daemon's credential). Then it quit, and the operator had no app for
					 * twelve minutes while a backend they did not own held their port.
					 *
					 * Nothing about that state justifies losing the window. The backend manager
					 * has already published which holder refused it, the probe loop is armed, and
					 * a fallback daemon may be running on the other address the renderer trusts
					 * - so the app opens, says what is on the address, and keeps trying. Falling
					 * THROUGH rather than returning is the point: the early `return` on the other
					 * arms exists to skip window creation, and skipping it here would leave the
					 * operator with the same nothing, only quieter.
					 */
					if (backendService.isStartBlockedByOccupiedAddress()) {
						logger.error(
							"Failed to start backend with existing installation: every address this app may serve on is held by something it does not own. Continuing without quitting; the status surface names the holder and the app keeps probing.",
							LogFileType.BACKEND,
						);
					} else {
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
		/**
		 * Consent attentions parked because the window they were raised for is GONE.
		 *
		 * A BANNER OUTLIVES ITS WINDOW and its click still arrives: macOS keeps a raised
		 * banner in Notification Center, the notifier's `click` listener is a closure on
		 * an object main still references, and on macOS the app stays alive in the Dock
		 * after `window.on("closed")` — which is the operator's own reported state ("I
		 * click it and nothing happens"). Measured on Electron 44.3.0 (UX review round 1,
		 * U2): with the window destroyed, reading `webContents` throws
		 * `Object has been destroyed`, so the click threw in main instead of landing
		 * anywhere. `consentClickHandler` no longer captures the window and hands the
		 * request here instead.
		 *
		 * A WINDOW IS CREATED WITH THE OPERATOR'S OWN PLAN, exactly as a Dock click does
		 * (see the `activate` handler): a banner click is a person asking for the app, and
		 * answering it under a `headless` launch plan would put a real request on a screen
		 * nobody can reach. In a launch that cannot show a window no banner is raised at
		 * all (`consent-notifier.ts` gates on `show === "focus"`), so this path cannot be
		 * reached by an unattended run.
		 *
		 * THE QUEUE IS BOUNDED and the OLDEST is dropped, for `PARKED_LAUNCH_LIMIT`'s
		 * reason: an unbounded in-memory queue on a long-lived app is a leak, and the
		 * newest click is the one a person is most likely still waiting on. Sixteen is the
		 * approvals queue's own cap, so the bound cannot be reached by a real click pattern
		 * without the approvals cap having been reached first.
		 */
		const parkedConsentAttentions: ConsentAttentionPayload[] = [];
		const PARKED_CONSENT_LIMIT = 16;

		function parkConsentAttention(payload: ConsentAttentionPayload): void {
			parkedConsentAttentions.push(payload);
			while (parkedConsentAttentions.length > PARKED_CONSENT_LIMIT) {
				parkedConsentAttentions.shift();
			}
		}

		/**
		 * Deliver every parked attention to a window whose RENDERER CAN HEAR IT.
		 *
		 * `did-finish-load` and not the creation, for the reason the parked-conversation
		 * queue states one screen up: a `webContents.send` into a window that has not
		 * loaded is dropped silently, so a send at creation would turn the reported no-op
		 * into a rarer one. An entry whose window died before its first paint goes back on
		 * the queue rather than out with the window.
		 */
		function claimParkedConsentAttention(window: BrowserWindow): void {
			if (parkedConsentAttentions.length === 0) return;
			const claimed = parkedConsentAttentions.splice(
				0,
				parkedConsentAttentions.length,
			);
			window.webContents.once("did-finish-load", () => {
				for (const payload of claimed) {
					if (window.isDestroyed()) {
						parkConsentAttention(payload);
						continue;
					}
					window.webContents.send(CONSENT_ATTENTION_CHANNEL, payload);
				}
			});
		}

		function setupMainWindowWithUpdateService(
			initialSession: string | null = null,
			openCatalogue = false,
			request: RaiseRequest = ownLaunchRequest(),
		) {
			/*
			 * THE CREATE GATE for every caller (round-1 review, F-2/F-3): the consent
			 * toast's reopen, the viewer's `focusWindow` recreate when no window is
			 * up, the Dock click and any future caller — this is the one function
			 * every creation goes through, so one check covers them. A window created
			 * now would be answered by a process that is tearing down (the #636
			 * defect, one request-source further out), so the request is refused WHOLE
			 * and reported under ITS OWN trigger (`trigger=banner-click`,
			 * `viewer-focus`, ...) — the line answers who asked. Non-quitting creation
			 * is untouched: the state is false on every other path.
			 */
			if (quitState.isQuitting()) {
				reportSkippedWhileQuitting(request, request.show);
				return;
			}
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

			/*
			 * AND THE CLICK THAT COULD NOT BE DELIVERED TO THE WINDOW IT WAS RAISED FOR
			 * (UX review round 1, U2). Claimed here rather than in the click's own path,
			 * because the window this creates is created HERE: the click parks the request
			 * and asks for a window, and the delivery belongs to whatever window exists
			 * when a renderer can hear it.
			 */
			claimParkedConsentAttention(mainWindow);

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
				 * THE PALETTE'S DOOR (issues #659, #850): Cmd/Ctrl+P opens the palette on
				 * EVERYTHING, Cmd/Ctrl+Shift+P opens it on COMMANDS. WHICH press means which
				 * door — the per-platform modifier and the auto-repeat refusal included —
				 * is `paletteDoorChannel` in `./palette-door`, kept PURE so that
				 * `scripts/palette-main-door.test.mjs` can drive the whole matrix without
				 * the focused, visible window this hook is gated on (QA round 1, Q-B1/Q-B2:
				 * a `headless` lane cannot show a window, so the old branch could not be
				 * exercised there at all).
				 *
				 * What is left HERE is what is genuinely about the window. The hook lives in
				 * main rather than the renderer because it fires wherever the WINDOW has
				 * focus; what each press then DOES (open / close / switch) is the renderer's
				 * decision (`paletteDoorOutcome`), and main only says which door was pressed.
				 */
				const paletteChannel = paletteDoorChannel(process.platform, input);
				if (
					paletteChannel !== null &&
					mainWindow?.isFocused() &&
					mainWindow?.isVisible()
				) {
					event.preventDefault();
					mainWindow.webContents.send(paletteChannel);
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
					// The other half of the plan the browser host forwards to a popup's
					// `webPreferences`: a hidden popup must render like a shown one, so the
					// mode's own answer travels with the mode rather than being re-derived
					// (docs/design/browser-oauth-popups.md 2.5).
					backgroundThrottling: windowLaunch.backgroundThrottling,
					// A consent banner's click comes forward through the app's own raise policy,
					// and this is where its one line goes — the same logger every other raise
					// reports to, so `trigger=banner-click` is greppable beside them.
					reportRaise,
					/*
					 * AND WHERE IT GOES WHEN THERE IS NO WINDOW TO COME FORWARD IN. The request
					 * is parked and a window is created under the OPERATOR's plan (a banner click
					 * is a person asking for the app), and `claimParkedConsentAttention` above
					 * delivers it once that window's renderer can hear it. Without this, a click
					 * with no window reported at best — and before this round it threw on a
					 * destroyed window.
					 */
					reopenConsent: (payload: ConsentAttentionPayload) => {
						parkConsentAttention(payload);
						/*
						 * THE APP'S OWN QUESTION ABOUT ITS WINDOW, not a census of every
						 * window this process has (agent review round 2, U8): the console's
						 * offscreen capture view is a `BrowserWindow` too, so
						 * `getAllWindows().length === 0` was false while none of them could
						 * show a conversation - a banner click then parked its request with
						 * no window created, which is the no-op this path exists to remove.
						 * `mainWindow` is what every other decision in this file asks about,
						 * and `isDestroyed()` is the "still usable" half of the same test
						 * (line 780's form).
						 */
						if (!mainWindow || mainWindow.isDestroyed()) {
							setupMainWindowWithUpdateService(null, false, {
								show: OPERATOR_SHOW,
								trigger: "banner-click",
							});
						}
					},
					// The console's completion banner is raised through this app's ONE
					// notifier (design 12.3: a second raiser would duplicate the TTL dedupe,
					// the window state, the raise policy and the click path). It is still the
					// notifier that decides whether a banner is delivered: this forwards it.
					notifier: desktopNotifier,
					// The console's offscreen capture view (design 13.2/13.3): its own
					// document, and the preload every renderer in this app gets, which is what
					// lets main feed the reconstruction to it.
					consoleCaptureUrl,
					preloadPath: join(__dirname, "../preload/index.js"),
					/*
					 * The console's surfaces are handed the user's own PATH, from the same
					 * resolver the backend spawn uses (above). Without it a surface inherits
					 * this app's launchd environment, in which `brew` - and every other tool
					 * the user installed - does not exist, so the console cannot run the
					 * tooling the agent is meant to acquire through it.
					 */
					userShellPath,
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
			/*
			 * THE CREATE GATE (round-1 review, F-2). A window created here would be
			 * answered by a process already tearing down — the #636 defect, one
			 * request-source further out — so the request is refused WHOLE, and the
			 * refusal sits ahead of the park below ON PURPOSE: a park promises a next
			 * window this process will never create, so letting this branch park would
			 * trade one broken promise for another. The direct callers that create
			 * without coming through here (the consent reopen and the viewer's
			 * `focusWindow` recreate) are refused by the same gate inside
			 * `setupMainWindowWithUpdateService`, which every creation reaches.
			 */
			if (quitState.isQuitting()) {
				reportSkippedWhileQuitting(request, request.show);
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
			/*
			 * A USER TOUCH RE-ASSERTS THE DOCK TILE: a Dock click is the reported mid-life
			 * detach's own repair path (see `reassertDockParticipation`). It runs before
			 * the window logic so a click that finds a window already open — the broken
			 * state, where the tile leads nowhere — still heals the tile.
			 */
			reassertDockParticipation();
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
				/*
				 * A DOCK CLICK DURING A QUIT GETS A LINE, NOT A WINDOW — the same defect
				 * as a relaunch during teardown, arriving on the operator's own act: the
				 * click lands in the seconds between the window closing and the process
				 * going, and the window it used to open died with that shutdown. The
				 * refusal is reported like every other declined request
				 * (`applied=skipped+quitting`), because a person who clicked the Dock icon
				 * is owed the reason nothing appeared — and the NEXT click, after the
				 * process is gone, launches a window normally.
				 */
				if (quitState.isQuitting()) {
					/*
					 * #755: the click is refused and RECORDED — it is the operator asking for
					 * the app, so the quit's terminal completes it with one successor instance
					 * (`./relaunch-pending`). No argv HERE: a Dock click names nothing to
					 * replay, and what "a plain launch" then means is the shape's question —
					 * `[]` (macOS starts the bundle) for a packaged build, this process's own
					 * command line for a dev-shaped one, or the successor would be bare
					 * Electron with no app path (review F1; `relaunch-pending.ts` owns the
					 * composition). The recorder's answer is what makes the refusal line say
					 * `reopen=deferred`.
					 */
					const deferredReopen = relaunchPending.record({
						kind: "activate",
						show: OPERATOR_SHOW,
						argv: null,
					});
					reportSkippedWhileQuitting(
						{ trigger: "activate", report: reportRaise },
						OPERATOR_SHOW,
						deferredReopen,
					);
					return;
				}
				setupMainWindowWithUpdateService(null, false, {
					show: OPERATOR_SHOW,
					/*
					 * The request names itself on its raise line. It used to present as
					 * `initial-present` — this process's own launch — which is what a Dock
					 * click is not, and the log's whole job is attribution; the refusal
					 * above is the same request and must carry the same name.
					 */
					trigger: "activate",
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
		/*
		 * A CLOSE THAT ARRIVES DURING A QUIT IS THE QUIT'S OWN CLOSE, not the red
		 * button, so the keep-active contract below does not describe it. The
		 * operator's windowed first quit reaches here (measured, QA round 1 Q-1:
		 * `All windows closed, but keeping app active (macOS platform)` is the last
		 * line the first quit logs) and the completion belongs to `will-quit`'s pass,
		 * whose continuation is the terminal that exits the process. Logged apart so
		 * a post-mortem can tell the two closes apart.
		 */
		if (quitState.isQuitting()) {
			logger.info(
				"All windows closed as part of a quit in progress; will-quit owns the completion",
				LogFileType.BACKEND,
			);
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
 * The console term is no longer a `where`/`which` ceiling - naming the global
 * launcher is a synchronous search of the installers' bin directories - but the
 * launcher-USABILITY probe that replaced that question is not synchronous, and it
 * sits on this path: `startOwned` awaits `checkLocalOperatorExists`, and
 * `stop(false)` awaits the start promise that is inside it. So the term is the
 * probe's own worst case, derived from its exported ceiling (`LAUNCHER_PROBE_WORST_MS`)
 * rather than restated here.
 *
 * What it does NOT cover, stated because a bound that only holds while the
 * thread is free is not a bound: it is a timer, so it cannot fire while the
 * main thread is parked. The one way this path parked it - a failure modal
 * raised while a quit was in flight - is removed (`reportBackendFailure`, QA
 * round 4 Q-20); any future blocking call on the quit path re-opens the hole.
 */
const QUIT_FAILSAFE_MARGIN_MS = 5_000;
const QUIT_CLEANUP_FAILSAFE_MS =
	LAUNCHER_PROBE_WORST_MS +
	INTERPRETER_RESOLUTION_WORST_MS +
	OWNED_STOP_WORST_MS +
	READINESS_POLL_INTERVAL_MS +
	QUIT_FAILSAFE_MARGIN_MS;
let backendQuitPending = false;
/*
 * REVIEW F3: the install stand-down is worth exactly ONE line — it reports a
 * RECORDED reopen left for the update lane, so it may not print when no record
 * existed, nor once per terminal call when one did.
 */
let relaunchStandDownLogged = false;
/*
 * #755: THE ONE WAY A RECORDED REOPEN IS COMPLETED. Called at every terminal
 * the quit owns — the synchronous `will-quit` pass (for a refusal that landed
 * before it: during the session-cookie hold or the window close), the
 * owned-cleanup continuation and its catch, and the failsafe — because the
 * refusal that needs completing is the one that arrived DURING the teardown,
 * i.e. after the first of these already ran — AND at the exits OUTSIDE that
 * pass that can still strand a record (review F2): the headless exit deadline
 * and the `uncaughtException` crash exit. The helper is idempotent
 * (`./relaunch-pending`), so the order and repetition of the sites cannot
 * multiply the successor; each one is an exit the quit cannot be cancelled
 * from, which is why the spawn cannot leak into a later, unrelated exit.
 */
const scheduleReopenAtQuitTerminal = (): void => {
	/*
	 * #755's INSTALL GUARD (memo §1.2, ratified): when the update lane already
	 * owns this quit's return — `quitForInFlightInstall` ran for a live pending
	 * install and arranged the relaunch watchdog — a successor must not race it:
	 * a running instance is what Squirrel's last check aborts the install on. The
	 * record is left unspent and dies with the process; the update lane's own
	 * watchdog is what brings the app back. The line below prints only when a
	 * record was actually waiting, and once (review F3): with nothing recorded
	 * there is nothing to account for, and the terminal calls must not read as
	 * one event per call.
	 */
	if (activeUpdateService?.inFlightInstallOwnsRelaunch() === true) {
		if (relaunchPending.hasPending() && !relaunchStandDownLogged) {
			relaunchStandDownLogged = true;
			logger.info(
				"[relaunch] not scheduling a successor: an in-flight update install owns this quit's relaunch",
				LogFileType.BACKEND,
			);
		}
		return;
	}
	relaunchPending.scheduleOnExit({
		relaunch: (args) => {
			try {
				app.relaunch({ args: [...args] });
				logger.info(
					`[relaunch] successor scheduled to complete the deferred reopen: ${
						args.length === 0 ? "(plain reopen)" : args.join(" ")
					}`,
					LogFileType.BACKEND,
				);
			} catch (error) {
				/*
				 * WRAP IT, LOG IT, CONTINUE (memo I1): the exit that follows is the quit the
				 * user asked for whether or not the successor could be arranged, and a throw
				 * escaping a terminal is the one way this feature could cancel a quit it has
				 * no business touching.
				 */
				logger.error(
					"[relaunch] scheduling the successor failed; the quit continues",
					LogFileType.BACKEND,
					error,
				);
			}
		},
	});
};

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
	/*
	 * #755: a refusal recorded BEFORE this pass — during the session-cookie hold
	 * or the window close — is completed here; the three sites below catch the
	 * refusal that lands after it, mid-teardown, which is the common case (the
	 * helper is idempotent, `./relaunch-pending` owns why).
	 */
	scheduleReopenAtQuitTerminal();
	if (backendService.isOwnedCleanupComplete()) return;
	event.preventDefault();
	if (backendQuitPending) return;
	backendQuitPending = true;
	const failsafe = setTimeout(() => {
		logger.error(
			`Owned backend cleanup did not finish within ${QUIT_CLEANUP_FAILSAFE_MS} ms; exiting with failure`,
			LogFileType.BACKEND,
		);
		/* Even the failed exit completes a recorded reopen — no silent drops (#755). */
		scheduleReopenAtQuitTerminal();
		app.exit(1);
	}, QUIT_CLEANUP_FAILSAFE_MS);
	// It must not be a reason for the process to stay alive by itself: the cleanup
	// it is watching is what holds the loop.
	failsafe.unref();
	void backendService
		.stop(false)
		.then(() => {
			clearTimeout(failsafe);
			/*
			 * #755: THE COMMON CASE — the refusal landed mid-teardown, after the
			 * synchronous pass above already looked (`./relaunch-pending` owns why an
			 * empty call must not latch). Idempotent: a refusal caught earlier is
			 * scheduled once.
			 */
			scheduleReopenAtQuitTerminal();
			/*
			 * `app.exit(0)`, NOT `app.quit()`, AND THAT IS THE FIX.
			 *
			 * A quit that `will-quit` cancelled IS restarted by `app.quit()` from this
			 * continuation — measured on this machine (2026-09-30, Electron 44.3.0) and
			 * reproduced independently by review round 1's minimal probe: the second
			 * quit emits its own `before-quit` and reaches `will-quit` again.
			 *
			 * WHY THE TERMINAL IS UNCONDITIONAL (review round 1, M1; QA round 1, Q-1).
			 * The pass that cancelled this quit runs AGAIN after the re-quit an
			 * `app.quit()` here would provoke, and that re-entered pass can still see
			 * `isOwnedCleanupComplete()` false — a mini-view or quick-send start holding
			 * a `startPromise` is the windowed state — so it prevents again, and the
			 * `backendQuitPending` guard (already true) returns WITHOUT arming anything
			 * while the failsafe above was cleared when this continuation ran: nothing
			 * is left to finish the quit, and the process sits windowless until a second
			 * one. `app.exit` cannot be cancelled by that re-entry, which is what makes
			 * this a terminal rather than another round trip through the quit sequence.
			 *
			 * THE OPERATOR'S FIRST QUIT WEDGED EARLIER THAN THIS, and its fix is in
			 * `before-quit`'s SYNCHRONOUS part rather than here: the mini view's close
			 * refusal (a `preventDefault()` that turns a close into a hide) cancelled the
			 * whole quit before `will-quit` was reached at all, so this handler never
			 * ran on the first quit (QA round 1's Q-1 trace: `will-quit entry` appears
			 * only on the SECOND quit). This comment describes the terminal's own
			 * escape hatch, not that defect.
			 *
			 * `app.exit` still fires the process-level `exit` handler
			 * (`emergencyStopOwned`, telemetry shutdown), and the failsafe above keeps its
			 * own `app.exit(1)`, so the bound is the only difference between a clean and a
			 * failed exit.
			 */
			app.exit(0);
		})
		.catch((error) => {
			clearTimeout(failsafe);
			logger.error(
				"Owned backend cleanup failed; exiting with failure",
				LogFileType.BACKEND,
				error,
			);
			/* No silent drops on the failure path either (#755). */
			scheduleReopenAtQuitTerminal();
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
	 * THE QUIT IS RECORDED BEFORE ANYTHING CAN WAIT ON IT. A request that arrives
	 * after this line must not be answered with a window — the window is doomed
	 * from here, whether the hold below passes now or holds the quit for the
	 * session-cookie budget first — so the state is set at the FIRST entry, ahead
	 * of the hold. The only release is the setup dialog's declined answer, beside
	 * its own cancellation (`./quit-state` owns why it is the only one).
	 */
	quitState.begin();

	/*
	 * THE WINDOW-CLOSE INTERCEPTIONS ARE STOOD DOWN HERE, IN THE SYNCHRONOUS PART
	 * OF THIS HANDLER, BEFORE THE FIRST `await` (remediation round 1: QA round 1's
	 * Q-1 and the operator's own report, then reproduced on an instrumented build
	 * of this branch).
	 *
	 * ELECTRON CLOSES EVERY WINDOW THE MOMENT THIS LISTENER'S SYNCHRONOUS PART
	 * RETURNS — it does not await the listener (measured: `will-quit` fires 0-2 ms
	 * after a `before-quit` that awaits 1000 ms). The mini view's close handler
	 * turns a close into a HIDE (`event.preventDefault()`), which is right for the
	 * accidental close it was written for and fatal here: a refused close CANCELS
	 * the whole quit, so `will-quit` is never reached at all, its owned-cleanup
	 * fallback never runs, and the process sits alive with no window until the user
	 * quits a SECOND time — the operator's report, and the instrumented trace:
	 * `before-quit stop RESOLVED`, `All windows closed …`, then a hundred seconds of
	 * silence and `will-quit entry` only on the second quit.
	 *
	 * The teardown below stands the same interception down, but it runs AFTER the
	 * awaited owned-backend stop — seconds too late, and it is what the mini view's
	 * own docstring already promises (`dispose()` … sets `disposed` first).
	 * Everything in this block is synchronous, so none of it needs to wait.
	 */
	globalShortcut.unregisterAll();
	miniViewRegistrar?.dispose();
	quickSendWatcher?.stop();
	miniView?.dispose();
	if (windowLaunch.mode === "headless") {
		launcherWatch?.stop();
		armHeadlessExitDeadline("the app is quitting");
	}
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
	 * THE OWNED BACKEND'S STOP IS STARTED ON THE HANDLER THAT CAN WAIT; the
	 * `will-quit` intercept above carries it whenever it is slower than the window
	 * close.
	 *
	 * ELECTRON DOES NOT AWAIT LISTENERS. Measured (2026-09-30, Electron 44.3.0, and
	 * reproduced by review round 1's probes): a `before-quit` listener that awaits
	 * 1000 ms still saw `will-quit` fire 0-2 ms later. So what the await below buys
	 * is the stop being STARTED here and typically resolved before the quit reaches
	 * `will-quit` — not a guarantee that it has. Every stop slower than the
	 * window-close interval lands in `will-quit`'s fallback, which is why that
	 * intercept stays and why ITS completion terminal is the one that has to be
	 * reliable (review round 1, M1/M2).
	 *
	 * A REJECTED STOP MUST NOT TAKE THE REST OF THE SHUTDOWN WITH IT (review round
	 * 1, m1): there is no `unhandledRejection` handler under `src/main`, so an
	 * unconfirmed exit would reject this listener and skip the park report, the
	 * headless deadline, the mini-view teardown, the update hand-off and the
	 * browser-host stop — all of which belong to this quit however the backend's
	 * stop ended.
	 */
	if (!backendService.isOwnedCleanupComplete()) {
		try {
			await backendService.stop(false);
		} catch (error) {
			logger.error(
				"Owned backend stop rejected during quit; continuing the shutdown",
				LogFileType.BACKEND,
				error,
			);
		}
	}

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
	 * The shortcut registrations, the mini view's close interception and the
	 * launcher watch were already stood down in the SYNCHRONOUS part of this
	 * handler — see the block beside `quitState.begin()` for why they cannot wait
	 * for the stop above (a window that refuses its close cancels the whole quit,
	 * and Electron closes the windows the moment this listener's sync part ends).
	 */
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
	// Nothing was constructed when telemetry is off, so there is nothing to
	// flush or close — and a bare `posthogClient.shutdown()` here would be a
	// TypeError on the exit path of every rig-shaped run.
	posthogClient?.shutdown();
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
		.finally(() => {
			/*
			 * REVIEW F2: the crash exit is the other exit outside the `will-quit` pass,
			 * and a record CAN exist when it fires — a refusal that landed during the
			 * teardown, then a crash — so the record is spent here like at every other
			 * terminal (idempotent; an empty call is a no-op) before the process goes.
			 * The exit itself is unchanged, and the relauncher still waits for it: the
			 * spike measured `app.relaunch` + `process.exit` → successor.
			 */
			scheduleReopenAtQuitTerminal();
			process.exit(1);
		});
});
