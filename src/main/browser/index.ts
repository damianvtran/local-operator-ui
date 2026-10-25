import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
	type BrowserWindow,
	type DidCreateWindowDetails,
	type Event,
	Menu,
	WebContentsView,
	type WebFrameMain,
	app,
	clipboard,
	shell,
	webContents,
} from "electron";
import {
	type BrowserChord,
	browserChordIntent,
} from "../../shared/browser-chord";
import { startConsoleHost } from "../console";
import type { ConsoleCompletionNotifier } from "../console/completion";
import { isConsoleDispatchMethod } from "../console/dispatch";
import { ConsoleError } from "../console/errors";
import {
	type AddressOverlayProbeAction,
	DEV_DRIVER_ADDRESS_OVERLAY_EVENT,
} from "../dev-driver";
import type { UserShellPath } from "../shell-path";
import {
	WebauthnChooser,
	type WebauthnRequestSource,
	attachWebauthnChooser,
	installWebauthn,
} from "../webauthn";
import {
	type RaiseReport,
	focusBrowserChordTarget,
	presentPopupWindow,
} from "../window-raise";
import {
	AddressOverlayController,
	type AddressOverlayFacts,
} from "./address-overlay";
import { ApprovalStore, type ConsentDecision } from "./approvals";
import {
	ApprovalsOverlayController,
	approvalsExpiryDelay,
	approvalsOverlayEnabled,
} from "./approvals-overlay";
import {
	browserChromeOwnsChord,
	browserPageOwnsChord,
	createBrowserChordRouter,
} from "./browser-chord";
import { CdpPool } from "./cdp";
import {
	type ConsentAttentionPayload,
	consentClickHandler,
} from "./consent-click";
import { ConsentNotifier } from "./consent-notifier";
import { DownloadArmer } from "./downloads";
import type { DriveableView } from "./electron-types";
import {
	BrowserHost,
	isReportableLoadFailure,
	sessionRequesterOf,
} from "./host";
import {
	PRODUCT_ADDRESS_OVERLAY_EVENT,
	type RegisterBrowserIpcOptions,
	registerBrowserIpc,
	unregisterBrowserIpc,
} from "./ipc";
import {
	type BrowserAvailability,
	MAX_START_ATTEMPTS,
	StartupRollback,
	startWithRetries,
} from "./lifecycle";
import { startLogCapture, stopLogCapture } from "./log-capture";
import { paneNavigationDirection } from "./navigation-chord";
import { OwnershipLedger } from "./ownership";
import { buildPageContextMenuItems } from "./page-context-menu";
import { decidePopup, effectivePresentation } from "./popups";
import {
	BROWSER_PARTITION,
	type ClearWhat,
	type HistoryClearer,
	browserStoragePath,
	browserUserAgent,
	clearBrowsingData,
	clearOriginData,
	flushBrowserStorage,
	installBrowserSessionHandlers,
	resolveBrowserSession,
} from "./profile";
import { BACKGROUND_VIEWPORT, TabRegistry, surfaceToken } from "./registry";
import { type RpcServer, startRpcServer } from "./rpc";
import {
	type RestoreReport,
	SessionCookieVault,
	sessionCookiePaths,
} from "./session-cookies";
import {
	HIDDEN_COOKIE_JAR_WEB_PREFERENCES,
	browserProfileCipher,
	createHiddenCookieJarTarget,
} from "./session-cookies-electron";
import {
	BrowserSessionStore,
	SESSION_FILENAME,
	captureTabs,
	readSession,
} from "./session-store";
import { permittedScheme } from "./settle";
import {
	BrowserStateWriter,
	mintSessionKey,
	stateFilePath,
} from "./state-file";
import {
	configurePslRules,
	domainScopeAvailable,
} from "./vendor/driver/origin-policy";
import { PSL_RULES } from "./vendor/driver/psl.gen";

/**
 * The browser host: wiring, lifecycle, and the per-view security handlers.
 * Design: docs/design/ui-browser-tab.md 5.1 (the session), 11.1-11.6 (views,
 * layout, focus, session wiring, navigation/popups/permissions/downloads), 11.7
 * (the trust boundary), 3(a) (the loopback endpoint).
 *
 * WHY one entry point: the pieces have a strict order — the partition must exist
 * before any view, the user agent must be set before any view, the RPC port must
 * be bound before the state file names it — and every one of them must be torn
 * down together when the app quits. Spread across call sites, one of them ends up
 * half-applied.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it never shows, raises or activates
 * anything (see the repo's window-mode guard, which scans this directory) — a
 * popup's presentation goes through `window-raise.ts`'s `presentPopupWindow`,
 * the same way a consent banner's click comes forward. It also never attaches a
 * view to `session.defaultSession`, and it never exposes CDP on a socket. The
 * driven views are children of the window's content view and nothing else.
 */

/**
 * Whether a navigation must be refused: http(s) only, `about:blank` the one
 * allowed `about:` URL, compared on a PARSED url — design 11.6 is explicit that
 * a `startsWith` comparison is not a check. `file:`, `javascript:`, `data:`,
 * `blob:`, `chrome:`, `devtools:` and every `about:` other than `about:blank`
 * are refused. Shared by the driven views and by the windows they open, because
 * a popup enforces the same scheme rule as the view it came from.
 */
function refusesNavigation(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		if (url.protocol === "about:") return url.href !== "about:blank";
		return !permittedScheme(url);
	} catch {
		return true;
	}
}

export interface StartBrowserHostOptions {
	/** The app's main window: the surface the browser views are added to. */
	window: BrowserWindow;
	/** The trusted renderer URL, for the IPC sender check. */
	expectedUrl: string;
	appVersion: string;
	/** `userData` — where the approvals store, `session.json` and the extensions
	 * directory live. */
	userDataDir: string;
	/**
	 * The launch plan's own answer to "would this window be brought forward?".
	 *
	 * Passed in rather than read here so this module never has to decide whether a
	 * window may come up: `window-raise.ts` is the only module that does, and the
	 * one thing the value is used for is the OPPOSITE direction — suppressing a
	 * consent banner when nobody is at the screen (design 11.4).
	 */
	windowShow: "focus" | "inactive" | "never";
	/**
	 * The launch plan's `backgroundThrottling`, forwarded for the same reason
	 * `windowShow` is: a hidden popup must render like a shown one (a capture of it
	 * is evidence), so `headless`/`inactive` runs hold the page at full rate and
	 * `normal` keeps the platform's own throttling — one decision, made in
	 * `window-mode.ts`, applied here rather than re-derived.
	 */
	backgroundThrottling: boolean;
	/**
	 * Where a raise reports its one line, so a consent banner's click is
	 * attributable the way every other raise is.
	 *
	 * OPTIONAL, and it is the app's own logger that supplies it: the raise itself is
	 * `window-raise.ts`'s decision, and this module's only part in it is to say that
	 * the OPERATOR asked — which is what the `banner-click` trigger records.
	 */
	reportRaise?: RaiseReport;
	/**
	 * Where a consent click goes when the window it was raised for is GONE.
	 *
	 * A banner outlives its window (macOS keeps it in Notification Center) and the
	 * click then arrives with nothing to deliver to — the operator's own reported
	 * state, since the app stays alive in the Dock. Window creation is the app's
	 * business, so this module does not make one: it hands the request up, exactly as
	 * `window-raise.ts` owns the raise and `desktop-notifier.ts` owns the completion
	 * banner's recreate path. Absent, the click reports the no-window line and
	 * returns — the behaviour the app had before the guard, minus the throw.
	 */
	reopenConsent?: (payload: ConsentAttentionPayload) => void;
	/**
	 * The app's notifier, forwarded verbatim to the console host so a console
	 * surface's completion can be raised as a banner (design 12.3). The console rides
	 * this endpoint (design 10.1) but NOT this notifier's opinions: the notifier owns
	 * the delivery gate, the claim and the click, and this module only hands it over.
	 */
	notifier?: ConsoleCompletionNotifier;
	/**
	 * The console's offscreen capture document and the preload it needs (design
	 * 13.2/13.3). Both come from the app because only the app knows where its own
	 * bundle lives: the console host is handed URLs, never paths it guesses.
	 *
	 * Absent means no capture view, which the host reports as the typed
	 * `capture_unavailable` refusal rather than as a blank frame.
	 */
	consoleCaptureUrl?: string;
	preloadPath?: string;
	/**
	 * The user's own login-shell PATH (`../shell-path`), forwarded to the console
	 * host so a surface behaves like the user's terminal. The app builds ONE of
	 * these and hands it here and to the backend, so the two consumers cannot
	 * answer "what is this user's PATH" differently.
	 */
	userShellPath?: UserShellPath;
	/**
	 * S1's inert address overlay, resolved by the app from its launch gate.
	 *
	 * Absent means off, which is every ordinary launch: the host then owns no
	 * controller at all, registers no probe channel and adds no native child. The
	 * document URL is the app's own trusted packaged document, derived from the
	 * same renderer URL the sender checks use — never a caller-supplied path.
	 */
	addressOverlay?: {
		enabled: boolean;
		list?: boolean;
		/** S3: the launch gate's visible-probe fact, forwarded to facts only. */
		visible?: boolean;
		/**
		 * S4b: the launch's PRODUCT chrome. True on darwin for an ordinary launch;
		 * false when a probe gate armed instead, so the probe keeps its own channel
		 * and the product never writes to the dev-driver's event stream.
		 */
		product?: boolean;
		documentUrl: string;
	};
	/**
	 * S6a's inert approvals card. Absent means off: no controller, no child, no
	 * product path. The document URL is the app's trusted packaged sibling.
	 */
	approvalsOverlay?: {
		enabled: boolean;
		documentUrl: string;
		/** S6b's purpose-built preload for the card document. */
		preloadPath: string;
	};
	log: (message: string) => void;
}

export interface BrowserHostHandle {
	chords: ReturnType<typeof createBrowserChordRouter>;
	host: BrowserHost;
	port: number;
	profileDir: string;
	agentTabs: () => number;
	/** What the last restore of session-only cookies did. Exposed so an evidence
	 * run can report it without reading the log, and so a test can assert the
	 * restore ran before any page loaded. */
	sessionCookies: () => RestoreReport | null;
	/** The S1 probe, internal to this host: present only when the launch gate
	 * passed. It is deliberately NOT a browser-tool wire method — the agent-facing
	 * protocol is unchanged, and this surface takes an exact enum action and no
	 * arguments. */
	addressOverlay?: (
		action: AddressOverlayProbeAction,
		argument?: unknown,
	) => Promise<AddressOverlayFacts>;
	stop: () => Promise<void>;
}

/**
 * The running host, for the app's quit path.
 *
 * Module-level because the quit path is registered at the bottom of
 * `src/main/index.ts`, where the host handle is not in scope. A single slot is
 * honest about the fact that this app runs one host.
 */
let activeHost: BrowserHostHandle | null = null;

/**
 * The quit path's history flush.
 *
 * REGISTERED ONCE, at module load, and it reads `activeHost` at the moment the
 * event fires: an `app.on` per host would accumulate a listener per restart,
 * each holding a dead host. The stop path ALSO flushes (`stop()` above): a
 * window close is not a quit, and the history the user just visited must be on
 * disk either way. `before-quit` is kept because a quit can begin before the
 * stop's async work reaches the host.
 */
app.on("before-quit", () => {
	activeHost?.host.flushHistory();
});

/** Explicit menu clicks use the same owner decision as keys. Outside the browser
 * the caller retains its original app-window action, never a global tab binding. */
/** The pre-existing app zoom listener is registered before the browser hook.
 * Route its browser-owned zoom keys here FIRST, including rejected repeats/IME,
 * so they cannot change the app before our hook sees the same input. */
export function routeBrowserZoomInput(
	event: { preventDefault(): void },
	input: import("../../shared/browser-chord").BrowserChordInput,
): boolean {
	const candidate = browserChordIntent(
		{ ...input, isAutoRepeat: false, isComposing: false },
		process.platform,
	);
	if (!candidate?.startsWith("zoom-") || !activeHost) return false;
	return activeHost.chords.chromeInput(event, input);
}

export function routeBrowserMenu(intent: BrowserChord): boolean {
	return activeHost?.chords.menu(intent) ?? false;
}

/** The in-flight stop, so a second caller waits for the first instead of
 * returning while the first is still writing the session-cookie snapshot. */
let stopping: Promise<void> | null = null;

/** Whether a stop is still owed: a running host, or a stop that has not settled.
 * Read by the app's quit path, which has to hold the quit until the
 * session-cookie snapshot the stop writes is on disk. */
export function browserHostStopPending(): boolean {
	return activeHost !== null || stopping !== null || starting !== null;
}

/**
 * Stop the host if one is running.
 *
 * Safe to call when nothing started (a disabled host, a failed start) and safe to
 * call twice. What it is NOT relied on for is discovery: if the process dies
 * without this running, the leftover state file names a dead pid, which the
 * Python side classifies as ABSENT without probing — a crash leaves a harmless
 * record rather than a phantom host.
 *
 * Idempotent AND awaitable: a second caller gets the first call's promise rather
 * than an immediate return. The session-cookie snapshot runs inside this stop, so
 * a quit path that awaited a no-op second call could exit before the snapshot was
 * on disk while reporting that it had stopped cleanly.
 */
export async function stopBrowserHost(): Promise<void> {
	if (stopping) return stopping;
	if (starting) {
		cancelStartup = true;
		stopping = starting
			.catch(() => null)
			.then(async () => {
				const current = activeHost;
				activeHost = null;
				if (current) await current.stop();
				else unregisterBrowserIpc();
			})
			.finally(() => {
				stopping = null;
			});
		return stopping;
	}
	const handle = activeHost;
	activeHost = null;
	if (!handle) {
		unregisterBrowserIpc();
		return;
	}
	stopping = handle.stop().finally(() => {
		stopping = null;
	});
	return stopping;
}

/**
 * Is the browser host enabled for this run?
 *
 * On by default, which is a decision rather than an oversight: the state file is
 * how a session DISCOVERS the host, so a host that only starts behind a setting
 * is invisible until the user finds the setting. The environment variable exists
 * for isolated runs (QA, the evidence script) that must be able to assert "no
 * host, no state file" without going through the UI.
 */
export function browserHostEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const flag = env.LOCAL_OPERATOR_UI_BROWSER_HOST?.trim().toLowerCase();
	return !(flag === "0" || flag === "false" || flag === "off");
}

// Stable across same-process window reattachment, different after an app restart.
// This labels a transport generation only; tabs still require their durable proof.
const hostInstanceId = randomUUID();
let starting: Promise<BrowserHostHandle> | null = null;
let startingWindow: BrowserWindow | null = null;
let cancelStartup = false;

export function startBrowserHost(
	options: StartBrowserHostOptions,
): Promise<BrowserHostHandle> {
	if (starting) {
		if (startingWindow === options.window) return starting;
		return starting
			.catch(() => null)
			.then(async () => {
				await stopBrowserHost();
				return startBrowserHost(options);
			});
	}
	if (stopping) return stopping.then(() => startBrowserHost(options));
	if (activeHost) return Promise.resolve(activeHost);
	cancelStartup = false;
	startingWindow = options.window;
	let availability: BrowserAvailability = {
		status: "starting",
		attempt: 1,
		maxAttempts: MAX_START_ATTEMPTS,
		message: null,
		canRetry: false,
	};
	const bindings: Partial<RegisterBrowserIpcOptions> = {};
	const notify = (): void => {
		if (!options.window.isDestroyed())
			options.window.webContents.send("browser-state-changed");
	};
	// Install handlers synchronously, before an initializer can await anything.
	// They belong to the window lifecycle, not to one attempt; retries replace
	// only the ready bindings, so a renderer never sees a missing read handler.
	// Clear any handlers a PREVIOUS invocation of this window left behind (an
	// exhausted startup keeps them live on purpose, because the window is still
	// open and the renderer must read the typed `unavailable` projection rather
	// than a missing-handler error) so a later start re-registers idempotently
	// instead of hitting Electron's "Attempted to register a second handler"
	// throw. Synchronous, with no await between remove and register, so no read
	// can interleave and observe the gap.
	unregisterBrowserIpc();
	registerBrowserIpc({
		window: () => options.window,
		expectedUrl: options.expectedUrl,
		host: () => bindings.host?.() ?? null,
		webauthn: () => bindings.webauthn?.() ?? null,
		focusPage: () => {
			const record = bindings.host?.()?.registry.activeTab;
			const target = record?.presented
				? webContents.fromId(record.view.webContents.id)
				: null;
			if (target)
				focusBrowserChordTarget(options.window, target, options.windowShow);
		},
		availability: () => availability,
		clearData: async (what) => {
			if (!bindings.clearData)
				throw new Error("browser_unavailable: The browser is not ready.");
			return bindings.clearData(what);
		},
		revealDownloads: async () => {
			if (!bindings.revealDownloads)
				throw new Error("browser_unavailable: The browser is not ready.");
			return bindings.revealDownloads();
		},
		// The recovery click on the `unavailable` state (round 1, D1a). It restarts
		// THIS module's host for the same window — the same call `createWindow`
		// makes — so the retry travels the one lifecycle path rather than a second,
		// parallel start. A doubled click needs no guard of its own:
		// `startBrowserHost` is already single-flight (a second call for the same
		// window returns the in-flight `starting` promise), which QA's concurrent
		// probe confirmed — three simultaneous retries produced ONE startup
		// sequence. Adding a local guard beside that would be a second mechanism
		// for a rule the module already owns (round 2, Q-R2-2).
		retry: async () => {
			await startBrowserHost(options).catch(() => {});
		},
		/*
		 * S1's probe channel is registered ONLY when this launch's gate passed, and
		 * then it reads the current attempt's callback through `bindings` (a retry
		 * replaces it) rather than capturing a controller here.
		 */
		...(options.addressOverlay?.product === true
			? {
					addressOverlayProduct: (payload: unknown): Promise<unknown> => {
						const project = bindings.addressOverlayProject;
						if (!project) {
							throw new Error(
								"address_overlay_unavailable: the overlay controller is not running.",
							);
						}
						return project(payload);
					},
				}
			: {}),
		...(options.addressOverlay?.enabled
			? {
					addressOverlayProbe: (
						action: AddressOverlayProbeAction,
						argument?: unknown,
					): Promise<AddressOverlayFacts> => {
						const probe = bindings.addressOverlayProbe;
						if (!probe) {
							throw new Error(
								"address_overlay_unavailable: the overlay controller is not running.",
							);
						}
						return probe(action, argument);
					},
					/* S2's projection. Registered only with the S1 probe, because the
					 * projection can only drive a child the probe's gate also armed. The
					 * current attempt's handler is read through `bindings` per call, like
					 * the probe above, so a retry cannot leave a stale controller. */
					...(options.addressOverlay.list === true
						? {
								addressOverlayProject: (payload: unknown): Promise<unknown> => {
									const project = bindings.addressOverlayProject;
									if (!project) {
										throw new Error(
											"address_overlay_unavailable: the overlay controller is not running.",
										);
									}
									return project(payload);
								},
							}
						: {}),
				}
			: {}),
		log: options.log,
	});
	starting = startWithRetries({
		cancelled: () => cancelStartup || options.window.isDestroyed(),
		publish: (next) => {
			availability = next;
			notify();
		},
		log: options.log,
		start: async () => {
			const handle = await initializeBrowserHost(options, bindings);
			availability = {
				...availability,
				status: "ready",
				message: null,
				canRetry: false,
			};
			notify();
			return handle;
		},
	}).finally(() => {
		starting = null;
		startingWindow = null;
	});
	return starting;
}

async function initializeBrowserHost(
	options: StartBrowserHostOptions,
	bindings: Partial<RegisterBrowserIpcOptions>,
): Promise<BrowserHostHandle> {
	const { log } = options;
	const rollback = new StartupRollback();
	let published = false;
	const checkpoint = (): void => {
		if (cancelStartup || options.window.isDestroyed())
			throw new Error("The browser window closed during startup.");
	};
	try {
		// The session is resolved ONCE, before any view exists. `session
		// .fromPartition` returns the same object for the same `persist:` name, so
		// "one jar shared by every tab" is Chromium's mechanism rather than this
		// host's bookkeeping (design 5.1).
		const browserSession = resolveBrowserSession();
		/**
		 * The per-tab download arm (§8), created BEFORE the session handlers because the
		 * `will-download` hook installed with them must have somewhere to ask from the
		 * first download this process sees.
		 *
		 * Its view of the registry is a DEFERRED lookup rather than a reference: the
		 * registry is built a few lines below, and the lookup only ever runs inside a
		 * download, which cannot happen before a tab exists. The alternative — moving
		 * the session handlers after the registry — would break the ordering rule those
		 * handlers exist for (the user agent must be set before any view exists).
		 */
		let registryForDownloads: TabRegistry | null = null;
		const downloads = new DownloadArmer({
			tabForWebContents: (webContentsId) =>
				registryForDownloads?.byWebContents(webContentsId)?.tabId ?? null,
			// WHO OWNED THE TAB, recorded on the decision (review round 2, U10). Read from
			// the registry at the moment the note is written, because the row may render it
			// after the tab is closed — and "· on another tab" about a tab that no longer
			// exists is a marker pointing at nothing. `null` when the lookup cannot answer
			// (a tab already gone), which the row renders the old way rather than guessing.
			ownerKindFor: (tabId) => registryForDownloads?.get(tabId)?.owner ?? null,
			// The human download destination (LOH-13 slice C): the person's
			// own downloads folder, read from the app at decision time. Main
			// composes it here for the same reason the reveal channel takes
			// no path: no renderer or page string ever becomes a directory.
			humanDownloadDir: () => app.getPath("downloads"),
			// NO `humanDeadlineMs` WIRING (review round 2, MAJOR): the wall-clock
			// budget this used to pass settled — and cancelled, discarding the
			// partial — a legitimate in-flight human download at 120 s. A human
			// capture now ends only on a guard, the quiet window, or the tab.
			// `COMMAND_TIMEOUTS_S.download` remains the AGENT call's own budget,
			// passed by its caller and unchanged.
			log,
			onActivity: () => {
				// The project is the ONE projection: `chromeState` carries the activity and
				// the strip re-reads on the same event a tab change uses, which is the rule
				// `browser-projection-store.ts` states for the consent band — one event, one
				// read, no second projection that can disagree.
				if (options.window.isDestroyed()) return;
				options.window.webContents.send("browser-state-changed");
			},
		});
		// Set before the first view: Electron documents that `setUserAgent` "doesn't
		// affect existing WebContents", so a later call would leave the first tab
		// presenting the default Electron UA.
		const detachSessionHandlers = installBrowserSessionHandlers(
			browserSession,
			{
				onPermissionRequested: (details) => {
					// The handler denies; this log is what makes a page that needs a
					// permission produce a visible trace rather than a silent failure.
					log(
						`[browser] denied a ${details.permission} permission request from ${details.origin || "(unknown origin)"}`,
					);
				},
				onDownload: (item, webContentsId) =>
					downloads.decide(item, webContentsId),
				onDownloadDecided: (outcome) => {
					// ONE line per decision, and only the ACCEPTED half here: a cancelled
					// download's line is written where the cancellation happened (`profile.ts`),
					// which is where its reason is read from.
					if (outcome.savePath) {
						log(
							`[browser] saved a download from ${outcome.url} to ${outcome.savePath}`,
						);
					}
				},
				log,
			},
		);

		rollback.add(detachSessionHandlers);
		// Policy and data share one immutable vendoring pin. A writable userData
		// file must not silently redefine which public suffixes admit broad grants.
		configurePslRules(PSL_RULES);

		/*
		 * Passkeys: the platform authenticator, and the chooser behind a request that
		 * matches more than one discoverable credential.
		 *
		 * INSTALLED HERE rather than per tab: the authenticator is a property of the
		 * process (Electron's `app.configureWebAuthn`), so a per-tab call would be the
		 * same answer repeated. `installWebauthn` is inert unless the running app is a
		 * team-signed bundle whose signature carries the matching
		 * `keychain-access-groups` entitlement — see that module for the measurement
		 * that makes the gate load-bearing (an unentitled authenticator leaves the
		 * page's `credentials.create()` promise hanging), and for the single log line
		 * naming why it is off.
		 *
		 * THE SESSION LISTENER IS REGISTERED EVEN WHEN THE AUTHENTICATOR IS OFF. The
		 * event is not macOS-only: Electron also fires it when a roaming FIDO2
		 * authenticator returns several discoverable credentials, and with no listener
		 * at all the request is cancelled with `NotAllowedError` — so the listener is
		 * the difference between "the user chose" and a failure nobody can explain.
		 */
		await installWebauthn({ log });
		checkpoint();
		/*
		 * WHICH TAB ASKED, resolved from the event's own frame (UX round 1, U3).
		 *
		 * The chooser is a modal over a surface whose page is suppressed while it is
		 * up, so naming the site is not the same as naming the page the decision is
		 * about. Electron hands the initiating frame with the event, `fromFrame` is the
		 * documented route from a frame to its webContents, and this host's registry is
		 * the only thing that maps that to a tab id and the title both surfaces already
		 * show. Called lazily (one event at a time, long after startup), which is why it
		 * may close over `registry` declared further down.
		 */
		const describeSource = (frame: unknown): WebauthnRequestSource => {
			/*
			 * THE NULL GUARD IS LOAD-BEARING, and it is measured rather than defensive:
			 * Electron documents `frame` as "may be null if accessed after the frame has
			 * either navigated or been destroyed", and `webContents.fromFrame(null)` does
			 * not return undefined for it — it throws `Invalid value used as weak map key`
			 * from inside Electron, which the `select-webauthn-account` listener would then
			 * propagate out of Electron's own emit. The passkey arm reaches this with a
			 * synthetic emit (its `frame` is null on purpose), which is how the throw was
			 * found; the same null arrives in production from a frame that navigated while
			 * the request was in flight.
			 */
			if (!frame || typeof frame !== "object") {
				return { tabId: null, pageTitle: null };
			}
			const contents = webContents.fromFrame(frame as WebFrameMain);
			const record =
				contents === undefined
					? undefined
					: registry.byWebContentsId(contents.id);
			if (!record) return { tabId: null, pageTitle: null };
			const title = record.view.webContents.isDestroyed()
				? ""
				: record.view.webContents.getTitle();
			// A page that has not been titled yet reports its URL as its title; both are
			// honest, and an empty string is not a title at all.
			return { tabId: record.tabId, pageTitle: title || null };
		};
		const webauthn = new WebauthnChooser({
			notify: (request) => {
				// A window torn down while a chooser was open is the ordinary race: the
				// request has nowhere to go, and the chooser's own timeout settles the
				// page rather than leaving it hanging.
				if (options.window.isDestroyed()) return;
				options.window.webContents.send("browser-webauthn-request", request);
			},
			/*
			 * AND THE OTHER DIRECTION: every settle is pushed, not only every arrival.
			 *
			 * Without this the renderer cannot tell a live request from one main has
			 * already cancelled, so a chooser whose request expired while the user was
			 * away stays on screen offering rows that can no longer do anything (design
			 * round 1, D2) — and the click is then discarded silently. The outcome travels
			 * with the push because the two cases differ for the user: their own answer is
			 * already off the screen, an expiry has to be explained.
			 */
			onSettled: (requestId, outcome) => {
				if (options.window.isDestroyed()) return;
				options.window.webContents.send("browser-webauthn-settled", {
					requestId,
					outcome,
				});
			},
			describeSource,
			log,
		});
		/*
		 * ONE LISTENER PER SESSION, for the life of the host that owns it.
		 *
		 * `attachWebauthnChooser` replaces any listener a previous host start left on
		 * this session and returns the detach the stop path calls (reviewer round 1,
		 * finding 2, MAJOR): a macOS window close followed by a Dock click starts a
		 * second host, and a listener registered per start would leave two choosers
		 * answering one Electron callback — whose contract is to be invoked exactly
		 * once.
		 */
		rollback.add(() => webauthn.dispose());
		const detachWebauthn = attachWebauthnChooser(browserSession, webauthn, log);
		rollback.add(detachWebauthn);

		/**
		 * The suggestion history's clear entry points, handed to the session's
		 * clear paths BELOW the host is built. A holder rather than a direct
		 * reference because `SessionCookieVault` is constructed first and its
		 * `clearSessionData` callback runs long after this function returns; by then
		 * the slot names the live host's store.
		 */
		const historyClearer: { current: HistoryClearer | null } = {
			current: null,
		};

		/*
		 * Session-only cookie persistence, restored BEFORE anything can load a page.
		 *
		 * This is the only moment at which the jar holds nothing but what the previous
		 * run stored: a restore that ran after a tab had navigated would race the
		 * site's own cookie writes and lose to whichever came second, and the point is
		 * to put the previous session's cookies back the way the site left them. The
		 * jar channel is a CDP attachment to a hidden `WebContentsView` in the same
		 * partition — the only in-process channel that carries a CHIPS partition key
		 * (see `session-cookies.ts` for the measurements) — and that view is never
		 * attached to a window, so it is never laid out, painted or focused.
		 */
		const cookieJar = createHiddenCookieJarTarget(
			new WebContentsView({
				webPreferences: { ...HIDDEN_COOKIE_JAR_WEB_PREFERENCES },
			}),
		);
		rollback.add(() => cookieJar.dispose());
		const sessionCookies = new SessionCookieVault({
			jar: cookieJar.jar,
			cipher: browserProfileCipher(),
			...sessionCookiePaths(options.userDataDir),
			flushStore: () => browserSession.cookies.flushStore(),
			clearSessionData: (what) =>
				clearBrowsingData(browserSession, what, historyClearer.current),
			log,
		});
		let restoreReport: RestoreReport | null = null;
		try {
			restoreReport = await sessionCookies.restore();
		} catch (error) {
			// A restore that throws must not stop the browser starting: the user loses
			// session cookies they were going to lose anyway, and the vault has already
			// failed closed on its own paths.
			log(`[browser] session cookies: the restore failed (${String(error)})`);
		}
		checkpoint();
		const cdp = new CdpPool({ log });
		rollback.add(() => cdp.close());
		/** Child views by tab id, so close and quit can release each one, and a
		 * webContents that dies on its own can be matched back to its tab. */
		const views = new Map<number, WebContentsView>();
		const releases = new Set<Promise<unknown>>();
		let stateWriter: BrowserStateWriter | null = null;

		/**
		 * Where the address-overlay controller's health pushes land. Declared before
		 * the controller because the controller is constructed first and only the
		 * host knows how to broadcast; assigned once `notifyChanged` exists. A
		 * failure can only arrive after a layout pass, which is after that
		 * assignment, so the placeholder never swallows a real change.
		 */
		let notifyAddressOverlayHealth: () => void = () => {};

		/**
		 * S1's child, created only when the launch gate passed. The controller is
		 * lightweight here: no native child exists until an explicit probe show
		 * (`AddressOverlayController.show`). It is declared before the registry
		 * because the registry's post-layout observer is the only source of page
		 * geometry it trusts.
		 */
		const addressOverlay =
			options.addressOverlay?.enabled === true
				? new AddressOverlayController({
						window: options.window,
						documentUrl: options.addressOverlay.documentUrl,
						javascript: options.addressOverlay.list === true,
						visible: options.addressOverlay.visible === true,
						product: options.addressOverlay.product === true,
						// The only consumer of a validated row click: the owner window's own
						// renderer. Guarded because a stop can race a queued mouse event.
						onEvent: (event) => {
							if (options.window.isDestroyed()) return;
							options.window.webContents.send(
								options.addressOverlay?.product === true
									? PRODUCT_ADDRESS_OVERLAY_EVENT
									: DEV_DRIVER_ADDRESS_OVERLAY_EVENT,
								event,
							);
						},
						// The renderer reads Tier 1 out of the projection, so a child that
						// fails while the field is already raised must push one.
						onHealthChange: () => notifyAddressOverlayHealth(),
						log,
						appMetrics: () =>
							app.getAppMetrics().map((metric) => ({
								pid: metric.pid,
								type: metric.type,
							})),
					})
				: null;

		/*
		 * S6a's card child. It reads the registry's post-layout snapshot for the
		 * same reason the address overlay does: the snapshot is the only trusted
		 * statement of the page's rectangle and presentation. It is declared before
		 * the registry so the observer can call it, and before `approvals` so the
		 * store's change hook can push the live count into it.
		 */
		/*
		 * The host is constructed after this controller, and `respondToConsent`
		 * lives on it; the indirection keeps ONE decision implementation (the
		 * store's `respond` + `onChanged`) instead of a second copy here.
		 */
		let respondToConsent:
			| ((entryId: string, decision: ConsentDecision) => unknown)
			| null = null;
		const approvalsOverlay =
			options.approvalsOverlay?.enabled === true &&
			approvalsOverlayEnabled(process.env)
				? new ApprovalsOverlayController({
						window: options.window,
						documentUrl: options.approvalsOverlay.documentUrl,
						preloadPath: options.approvalsOverlay.preloadPath,
						opaque: process.platform !== "darwin",
						// The projection is the renderer's only view of the shield; a
						// dismissal from the card itself must push it (F1).
						onChanged: () => notifyChanged(),
						log,
						respond: (entryId, decision) => {
							if (!respondToConsent) {
								throw new Error("browser_unavailable");
							}
							return respondToConsent(entryId, decision);
						},
						// The registry narrows its page handle to the fields the action
						// context uses; the underlying object is an Electron WebContents,
						// whose `focus()` is what the gated helper needs.
						pageWebContents: () =>
							(registry.activeTab?.view.webContents ?? null) as unknown as {
								isDestroyed(): boolean;
								focus(): void;
							} | null,
						focusTarget: (target) =>
							focusBrowserChordTarget(
								options.window,
								target,
								options.windowShow,
							),
					})
				: null;

		/**
		 * The tab-restore file (design 7.2): the hand-over of session state between two
		 * runs of the app.
		 *
		 * Declared BEFORE the registry, because the registry's change hook captures a
		 * snapshot on every create, close and navigation. Owning it here also puts it
		 * beside the approvals store and outside the Chromium profile, so "clear
		 * browsing data" and "forget my tabs" stay separate actions.
		 */
		const sessionStore = new BrowserSessionStore({
			dir: join(options.userDataDir, "browser"),
			log,
		});

		/**
		 * One banner per INCREASE in the live request count (design 9.2; the notifier's
		 * own header states the rule). Not per pending ENTRY: with a real queue, a busy
		 * minute of arrivals would otherwise raise one banner per request. Declared here
		 * because the approvals store's change hook raises it, and `windowShow` is the
		 * plan the CLICK comes forward under — this module still never decides whether a
		 * window comes forward (design 11.4), it hands the plan to `window-raise.ts`.
		 */
		const consentNotifier = new ConsentNotifier({
			show: options.windowShow,
			/*
			 * The click's own rule lives in `consentClickHandler` (see it: the delivered
			 * payload, the order, and the raise are all asserted there), and this is the
			 * wiring that gives it the real window and the real plan. `windowShow` is the
			 * plan the click comes forward under — this module still never decides whether a
			 * window comes forward (design 11.4), it hands the plan to `window-raise.ts`.
			 */
			onAttention: consentClickHandler({
				/*
				 * THE WINDOW IS ASKED FOR, NOT CAPTURED, and the difference is the U2 fix:
				 * this host is stopped the moment its window closes (`src/main/index.ts`'s
				 * `closed` hook), but a banner already raised is still in Notification
				 * Center and its click still lands here. A captured window would be a
				 * destroyed one by then, and reading it throws.
				 */
				window: () => options.window,
				show: options.windowShow,
				report: options.reportRaise,
				reopen: options.reopenConsent,
			}),
			log,
		});

		/**
		 * The snapshot every change writes, debounced by the store.
		 *
		 * NOT GATED ON A "the process is stopping" FLAG ANY MORE (review round 3,
		 * B2's MAJOR). The gate was a function-local boolean set inside `stop()`, and
		 * the ordering that defeats the stop decision is the one where the views are
		 * already destroyed when `stop()` runs: each `destroyed` handler fires
		 * `notifyChanged` while that boolean is still false, so the short capture was
		 * staged, the stop decision refused it - and the store's own `flush()` wrote
		 * it anyway. The binding part of that rule is the store's `seal()`, which is
		 * what no longer accepts a capture after the stop decision; a flag that has to
		 * be set first only covers the orderings that happen to run through `stop()`.
		 * One mechanism, at the only writer, instead of two that can disagree.
		 */
		const captureSession = (): void => {
			// Startup and rollback are not user tab edits. Never persist a partial
			// restore (or the empty teardown) over the saved tab history.
			if (!published) return;
			sessionStore.record(
				captureTabs(
					registry.list(),
					registry.activeTab?.tabId ?? null,
					host.failedTabIds(),
				),
			);
		};

		const notifyChanged = (): void => {
			stateWriter?.publishNow();
			// A WINDOW CLOSE DESTROYS ITS WEB CONTENTS BEFORE `closed` REACHES THIS
			// HOST. `stop()` then tears tabs down, and each teardown notifies; reading
			// `webContents` from a destroyed `BrowserWindow` throws "Object has been
			// destroyed". Guarding both objects keeps the quit-time teardown silent,
			// which is the S1 acceptance row's "no destroyed-object callbacks".
			if (
				!options.window.isDestroyed() &&
				!options.window.webContents.isDestroyed()
			) {
				options.window.webContents.send("browser-state-changed");
			}
			// The tab list is durable state now (design 7.2): a create, a close and a
			// navigation are what changes it, and every one of those paths ends here.
			// Teardown fires it too; what keeps a teardown capture out of the file is
			// the store's own seal, not a check here.
			captureSession();
		};
		notifyAddressOverlayHealth = notifyChanged;
		const registry = new TabRegistry(
			(_createOptions, tabId) => {
				const view = buildView(options.window);
				views.set(tabId, view);
				wireView(view, tabId);
				return view as unknown as DriveableView;
			},
			releaseTab,
			notifyChanged,
			(snapshot) => {
				addressOverlay?.onLayout(snapshot);
				approvalsOverlay?.onLayout(snapshot);
			},
		);
		registryForDownloads = registry;
		rollback.add(async () => {
			published = false;
			sessionStore.discard();
			registry.destroyAll();
			await Promise.allSettled([...releases]);
		});
		// Added AFTER the registry's rollback entry, so reverse-order rollback runs
		// this FIRST: the overlay's webContents must be closed before the pages it
		// sits above are destroyed, or a teardown can call into a destroyed view.
		rollback.add(() => addressOverlay?.dispose("startup-rollback"));
		rollback.add(() => approvalsOverlay?.dispose("startup-rollback"));

		/**
		 * Release everything one tab holds: its child view, its debugger session and
		 * (through `cdp.detach`) its CDP subscribers and log ring buffer.
		 *
		 * THE one removal path. The registry's `onRemove` calls it for every close it
		 * drives, and the `destroyed` handler calls it for a death this process did
		 * not ask for, because a second copy of this sequence is exactly how one of
		 * the three leaks: the destroyed path used to skip the debugger release, so a
		 * renderer crash retained the `CdpPool` entry, its subscriber set and the
		 * per-tab ring buffer until host stop while the ordinary close released all
		 * three (R5).
		 */
		function releaseTab(tabId: number, webContentsId: number): void {
			// Before the page's own release: the overlay's child is bound to this tab's
			// geometry, and a later explicit show must lazily create a fresh one.
			addressOverlay?.onTabReleased(tabId);
			const view = views.get(tabId);
			views.delete(tabId);
			// A CLOSED TAB MUST NOT STAY ARMED: the capture writes into a directory the
			// harness composed for a call that is now over, and the arm exists only as long
			// as the tab it belongs to (see `DownloadArmer`'s one-arm-per-tab rule).
			downloads.forget(tabId);
			const release = cdp
				.detach(webContentsId)
				.finally(() => releaseView(options.window, view));
			releases.add(release);
			void release.catch(() => {}).finally(() => releases.delete(release));
		}

		const ownership = new OwnershipLedger({
			mayAdopt: (token, requester) => {
				const record = registry.requireSurface(token);
				return (
					record.handedTo === requester.slice("session:".length) &&
					!record.allocationId
				);
			},
			closeTab: async (token) => {
				try {
					const record = registry.requireSurface(token);
					approvals.forgetDocument(token);
					registry.destroy(record.tabId);
				} catch {
					// Already gone is the finished state, not a pending obligation.
				}
				return true;
			},
			isLive: (token) => {
				try {
					registry.requireSurface(token);
					return true;
				} catch {
					return false;
				}
			},
		});

		/*
		 * The card must leave when the LAST live request expires, not only when a
		 * request/respond/tab event happens to call back. Arm one timer at the
		 * earliest live `expiresAt`; `pendingEntries()` filters by `now`, so the
		 * callback re-pushes the expiry-aware count with no extra traffic.
		 */
		let approvalsExpiryTimer: ReturnType<typeof setTimeout> | null = null;
		let syncApprovalsOverlay = (): void => {};
		const approvals = new ApprovalStore({
			dir: join(options.userDataDir, "browser"),
			onChanged: () => {
				// The same destroyed-window ordering `notifyChanged` documents: this
				// fires from `resetPending()` inside the stop path.
				if (
					!options.window.isDestroyed() &&
					!options.window.webContents.isDestroyed()
				) {
					options.window.webContents.send("browser-consent-changed");
				}
				// One banner per pending request, raised HERE rather than from the renderer:
				// the renderer is exactly what may be behind another window, which is the
				// case the banner exists for (design 9.2).
				consentNotifier.announce(approvals.pendingEntries());
				// S6a's card is auto-presented from the same live queue the shield
				// counts. It is unfocused and has no decision path; this is the only
				// producer of its visibility.
				syncApprovalsOverlay();
			},
			log,
		});
		syncApprovalsOverlay = () => {
			// An ordinary launch has no card at all: no read, no timer, no clock.
			if (!approvalsOverlay) return;
			if (approvalsExpiryTimer) {
				clearTimeout(approvalsExpiryTimer);
				approvalsExpiryTimer = null;
			}
			// The queue's `requester` is an authority boundary; the card gets the
			// session id so the renderer-pushed display label can name WHO asked
			// (F2), never the requested site's host.
			const entries = approvals.pendingEntries().map((entry) => ({
				...entry,
				requesterSessionId: sessionRequesterOf(entry.requester),
			}));
			approvalsOverlay?.setModel({ entries });
			if (entries.length === 0) return;
			const delay = approvalsExpiryDelay(entries);
			// A small positive margin lets the store's own `now` pass the boundary
			// before the count is read, rather than racing the same millisecond.
			if (delay !== null) {
				approvalsExpiryTimer = setTimeout(syncApprovalsOverlay, delay + 25);
				approvalsExpiryTimer.unref?.();
			}
		};
		syncApprovalsOverlay();

		const profileDir = browserStoragePath(browserSession) ?? "";
		const facts = {
			proto: 1,
			appVersion: options.appVersion,
			profileDir,
			profilePersistent: browserSession.isPersistent(),
			userAgent: browserUserAgent(),
			domainScope: domainScopeAvailable(),
		};

		const host = new BrowserHost({
			registry,
			cdp,
			approvals,
			ownership,
			downloads,
			log,
			onChanged: notifyChanged,
			facts: () => facts,
			forgetSiteData: (origin) =>
				clearOriginData(browserSession, origin, historyClearer.current),
			historyFilePath: join(options.userDataDir, "browser-history.json"),
			addressOverlayMode: () =>
				addressOverlay
					? addressOverlay.mode()
					: {
							mode: "suspend",
							reason:
								options.addressOverlay?.product === true
									? "unavailable"
									: "platform",
						},
			approvalsCard: approvalsOverlay
				? {
						open: (input) => approvalsOverlay.open({ focus: true, ...input }),
						close: () => approvalsOverlay.close("shield"),
						setContext: (context) => approvalsOverlay.setContext(context),
						state: () => approvalsOverlay.state(),
					}
				: undefined,
		});
		respondToConsent = (entryId, decision) =>
			host.respondToConsent(entryId, decision);
		// The store exists from here on; every later clear reaches it. Assigned
		// together with `historyFilePath`, so a host without a store leaves the
		// slot null and the clear paths simply do not touch history.
		historyClearer.current = {
			clear: () => host.clearHistory(),
			clearOrigin: (origin) => host.clearOriginHistory(origin),
		};

		// Logical ownership includes the standalone BODY / pane header. Native
		// commands still require the real foreground window and visible chrome;
		// a renderer report is never a substitute for those main-owned facts.
		const ownsChrome = () =>
			browserChromeOwnsChord({
				logicalFocus: host.chordFocus,
				chromeVisible: registry.chromeVisible,
				window: options.window,
			});
		const chords = createBrowserChordRouter({
			platform: process.platform,
			ownsChrome,
			ownsPage: () => {
				const record = registry.activeTab;
				return browserPageOwnsChord({
					activeTab: record
						? {
								tabId: record.tabId,
								webContentsId: record.view.webContents.id,
								presented: record.presented,
							}
						: null,
					// Read lazily after the window/presented floor: a startup or test host
					// may carry a webContents slice without the getter.
					focusedContents: () =>
						webContents.getFocusedWebContents()?.id ?? null,
					focusedViewTabId: host.focusedPageTabId,
					window: options.window,
				});
			},
			reload: (hard) => {
				host.reloadActive(hard);
			},
			zoom: (command) => {
				const tabId = registry.activeTab?.tabId;
				if (tabId !== undefined)
					void host
						.controlPage(tabId, command)
						.catch((error) =>
							log(
								`Page zoom refused: ${error instanceof Error ? error.message : "unavailable"}`,
							),
						);
			},
			history: (direction) => {
				host.historyActive(direction);
			},
			send: (message) =>
				options.window.webContents.send("browser-chord", message),
			focusChrome: () =>
				focusBrowserChordTarget(
					options.window,
					options.window.webContents,
					options.windowShow,
				),
		});
		const onChromeInput = (event: Event, input: Electron.Input): void => {
			// The app zoom listener may already have routed this through our menu
			// door. Do not execute it twice; no timing/debounce heuristic is needed.
			if (event.defaultPrevented) return;
			const handled = chords.chromeInput(event, input);
			// Per-input suppression, NOT a 150ms command debounce. Key-up or any
			// unrelated key restores menu shortcuts. Focus departure resets too.
			options.window.webContents.setIgnoreMenuShortcuts(handled);
		};
		const resetChordFocus = (): void => {
			host.setChordFocus(false);
		};
		const resetPageFocus = (): void => {
			host.clearPageFocus();
		};
		const resetMenuShortcutSuppression = () => {
			// `webContents` itself throws on a destroyed window (see `notifyChanged`).
			if (options.window.isDestroyed()) return;
			if (!options.window.webContents.isDestroyed())
				options.window.webContents.setIgnoreMenuShortcuts(false);
		};
		host.onChordFocusChanged = (focused) => {
			if (!focused) resetMenuShortcutSuppression();
		};
		options.window.webContents.on("before-input-event", onChromeInput);
		// The window's own renderer taking focus means the user is in chrome or chat,
		// not a driven page. A view's own `blur` covers the same move; this is the
		// belt for a focus change that never emits one (destroyed/restored views).
		options.window.webContents.on("focus", resetPageFocus);
		// OS blur is not departure from the browser's DOM owner. Native guards
		// above refuse inactive windows; retaining the logical owner removes the
		// reactivation/menu race against an asynchronous renderer focus report.
		options.window.on("blur", resetMenuShortcutSuppression);
		options.window.on("closed", resetChordFocus);
		// A renderer that reloads (HMR, Cmd+R on a non-browser route) or crashes runs
		// no unmount cleanup, so its `focusout`/`report(false)` never arrives and the
		// flag would stay true while the window keeps focus: chat would then have
		// Cmd+R/W/T/L claimed and sent to a renderer with no listener (review R7).
		// Only a MAIN-FRAME, cross-document navigation counts; an in-page route
		// change keeps the same renderer and its own focus reports.
		const resetOnNavigation = (details: {
			isMainFrame: boolean;
			isSameDocument: boolean;
		}): void => {
			if (details.isMainFrame && !details.isSameDocument) resetChordFocus();
		};
		options.window.webContents.on("did-start-navigation", resetOnNavigation);
		options.window.webContents.on("render-process-gone", resetChordFocus);
		const detachChords = (): void => {
			host.clearChordState();
			// A WINDOW CLOSE DESTROYS THE WINDOW BEFORE THIS HOST STOPS: the `closed`
			// hook calls `stop()`, and every `webContents` access below then throws
			// "Object has been destroyed". Nothing is left to detach from in that case;
			// the listeners died with the renderer. S1's clean-stop row is what made
			// this ordering visible.
			if (options.window.isDestroyed()) return;
			options.window.webContents.removeListener(
				"before-input-event",
				onChromeInput,
			);
			options.window.webContents.removeListener("focus", resetPageFocus);
			options.window.removeListener("blur", resetMenuShortcutSuppression);
			options.window.removeListener("closed", resetChordFocus);
			options.window.webContents.removeListener(
				"did-start-navigation",
				resetOnNavigation,
			);
			options.window.webContents.removeListener(
				"render-process-gone",
				resetChordFocus,
			);
		};
		// An initialization failure after wiring must not leave an old input
		// router beside the next attempt's router or keep menu suppression alive.
		rollback.add(detachChords);

		// Restore BEFORE any interaction is possible, and after the session handlers
		// exist (the user agent must already be set: Electron documents that
		// `setUserAgent` does not affect existing WebContents, so a restore that beat
		// it would leave the first tab presenting the default Electron UA).
		//
		// NOT awaited. The call allocates every view and settles the active tab
		// synchronously, so the strip is correct on the first paint; the pages then load
		// under the host's own bounded background budget, which is what stops a file full
		// of rows — or one page that never answers — from withholding the browser until
		// the RPC server exists (review round 1, R5).
		const recorded = readSession(sessionStore.filePath, log);
		host.restoreTabs(recorded);
		if (recorded.length) {
			log(
				`[browser] restored ${recorded.length} tab(s) from ${SESSION_FILENAME}; every restored tab is user-owned and holds no handle (design 7.3)`,
			);
		}

		/*
		 * The console rides THIS endpoint, THIS record and THIS key (design 10.1), so it
		 * starts beside the server rather than behind one of its own. Two consequences
		 * worth naming:
		 *
		 *  - the dispatch below is the only place the two namespaces meet, and it routes
		 *    by the console's own predicate rather than by a prefix match, so a browser
		 *    method can never be answered by a console result;
		 *  - a console that is off (the kill switch, or node-pty failing to load) is
		 *    still a TYPED answer to a console method — `console_unavailable` naming
		 *    which of the conditions failed — rather than a transport error, because the
		 *    tool's gate and the record's `console` field are what keep the agent from
		 *    calling in the first place, and a caller that got through anyway deserves
		 *    the reason.
		 */
		const consoleStartup = await startConsoleHost({
			window: options.window,
			expectedUrl: options.expectedUrl,
			appVersion: options.appVersion,
			notifier: options.notifier,
			/*
			 * The capture view's document and preload, forwarded rather than re-derived:
			 * only the app knows where its own bundle lives, and a console host that
			 * guessed would answer a screenshot with a blank frame rather than with its
			 * own typed refusal. WITHOUT THESE TWO the host builds no capture view at all,
			 * which the live proof rig caught as `capture_unavailable` on a surface with
			 * no displayed pane — the exact shape of a seam that is wired in tests and
			 * forgotten in the one call site that matters.
			 */
			consoleCaptureUrl: options.consoleCaptureUrl,
			preloadPath: options.preloadPath,
			userShellPath: options.userShellPath,
			log,
		});

		rollback.add(() => consoleStartup.stop());
		checkpoint();
		const sessionKey = mintSessionKey();
		const server: RpcServer = await startRpcServer({
			key: sessionKey,
			instanceId: hostInstanceId,
			dispatch: async (method, params, requestId) => {
				if (!isConsoleDispatchMethod(method)) {
					return host.dispatch(method, params, requestId);
				}
				if (!consoleStartup.ok) {
					throw new ConsoleError(
						"console_unavailable",
						`this app's console is not available (${consoleStartup.reason}): ${consoleStartup.detail}`,
						{ reason: consoleStartup.reason },
					);
				}
				return consoleStartup.dispatch(method, params);
			},
			log,
			capabilities: () => ({ console: consoleStartup.ok }),
		});

		rollback.add(() => server.close());
		checkpoint();
		stateWriter = new BrowserStateWriter(
			stateFilePath(),
			() => {
				const consoleCounts = consoleStartup.ok
					? consoleStartup.counts()
					: {
							total: 0,
							agent: 0,
							live: 0,
							archived: 0,
							maxLive: 0,
							hostEpoch: undefined,
							startedAt: undefined,
							generation: undefined,
							sampledAt: undefined,
						};
				return {
					tabs: registry.count(),
					agentTabs: registry.agentTabCount(),
					profileDir,
					console: consoleStartup.ok,
					consoleSurfaces: consoleCounts.total,
					consoleAgentSurfaces: consoleCounts.agent,
					consoleLive: consoleCounts.live,
					consoleArchived: consoleCounts.archived,
					consoleMaxLive: consoleCounts.maxLive,
					// Console recreation and a window rebind are distinct lifecycle events.
					// Never infer the former from the app's stable process instance alone.
					...(consoleStartup.ok && {
						consoleHostEpoch: consoleCounts.hostEpoch,
						consoleStartedAt: consoleCounts.startedAt,
						consoleGeneration: consoleCounts.generation,
						consoleSampledAt: consoleCounts.sampledAt,
					}),
				};
			},
			{
				appVersion: options.appVersion,
				instanceId: hostInstanceId,
				onError: (error) => log(`[browser] state file: ${String(error)}`),
			},
		);
		rollback.add(() => stateWriter?.clear());
		stateWriter.start(server.port, sessionKey);

		/**
		 * The probe's answer, enriched with the ACTIVE PAGE's structural facts from
		 * the registry this host owns. The controller deliberately has no registry
		 * reference; the matrix's "page bounds and visibility identical before/show/
		 * after" is a claim about the page, so the host merges it here rather than
		 * teaching the child about its sibling.
		 */
		const probeAddressOverlay = async (
			action: AddressOverlayProbeAction,
			argument?: unknown,
		): Promise<AddressOverlayFacts> => {
			if (!addressOverlay) {
				throw new Error(
					"address_overlay_unavailable: this host owns no controller.",
				);
			}
			const facts = await addressOverlay.probe(action, argument);
			const record = registry.activeTab;
			const page = record
				? {
						tabId: record.tabId,
						presented: record.presented,
						bounds: record.view.getBounds?.() ?? null,
						visible: record.view.getVisible?.() ?? false,
					}
				: null;
			return { ...facts, page };
		};
		/**
		 * S2's projection entry. The controller revalidates every field against its
		 * own layout snapshot; this function only proves the host still owns one.
		 * It returns the controller's decision, never a fabricated acceptance.
		 */
		const projectAddressOverlay = (payload: unknown): Promise<unknown> => {
			if (!addressOverlay) {
				throw new Error(
					"address_overlay_unavailable: this host owns no controller.",
				);
			}
			return addressOverlay.project(payload);
		};
		if (addressOverlay) {
			// Reads the CURRENT controller through the bindings slot per call. A retry
			// replaces the slot and no handler can keep a stale attempt's controller.
			bindings.addressOverlayProbe = probeAddressOverlay;
			if (options.addressOverlay?.list === true) {
				bindings.addressOverlayProject = projectAddressOverlay;
			}
		}

		Object.assign(bindings, {
			window: () => options.window,
			expectedUrl: options.expectedUrl,
			host: () => host,
			webauthn: () => webauthn,
			clearData: (what: ClearWhat) => sessionCookies.clearBrowsingData(what),
			// THE REVEAL TAKES NO PATH FROM THE RENDERER (§16.4): it opens the directory the
			// host is actually writing into, so the one place a page-derived string could
			// have become a path stays out of the IPC surface as well. `shell.openPath`
			// answers "" on success and a message on failure, which is returned rather than
			// thrown: a reveal that fails is a Finder problem, not a fault in the agent's
			// download.
			revealDownloads: async () => {
				// `downloadDir` rather than the chrome projection's own `dir`: this button is
				// about the FOLDER the host writes into, not about the tab the user happens to be
				// looking at, so it must not go blank when the active tab has no download of its
				// own (review round 1, U2 scoped the strip per tab and this is the other half of
				// that decision).
				const dir = downloads.downloadDir();
				if (!dir) return "no download directory yet";
				return shell.openPath(dir);
			},
			log,
		});

		log(
			`[browser] host on ${server.address}:${server.port} (proto ${facts.proto}), profile ${profileDir || "(in-memory)"}, agent tabs ${registry.agentTabCount()}/${8}, console ${consoleStartup.ok ? `on (${consoleStartup.counts().total} surface(s))` : `off (${consoleStartup.reason})`}`,
		);

		const handle: BrowserHostHandle = {
			chords,
			host,
			port: server.port,
			profileDir,
			agentTabs: () => registry.agentTabCount(),
			sessionCookies: () => restoreReport,
			...(addressOverlay ? { addressOverlay: probeAddressOverlay } : {}),
			stop: async () => {
				detachChords();
				host.flushHistory();
				/*
				 * The quit-time capture, taken BEFORE the views are destroyed
				 * (`captureTabs` reads each view's live navigation history and a destroyed
				 * view has none) - and the one place a capture may be REFUSED.
				 *
				 * A capture taken while the process is coming down can be short for a reason
				 * that is not the user's doing: the views may already be gone (SIGTERM, an
				 * update restart, a renderer crash). Measured: a SIGTERM quit left
				 * `{"version":1,"tabs":[]}` in 8 of 8 runs while a window close kept the
				 * tabs. `stopSnapshotDecision` refuses a capture shorter than the record
				 * already on disk, so the worst case is a tab the user had just closed
				 * coming back rather than a session disappearing. This is also why the flush
				 * lives here rather than in `before-quit`: stopping the host is what happens
				 * on a quit AND on a window close, so one call site covers both instead of a
				 * quit-only hook that a window close would skip.
				 *
				 * THE DECISION AND THE WRITE ARE ONE CALL, on the store
				 * (`commitStopCapture`), because splitting them was round 3's MAJOR: the
				 * refusal has to take back what is staged and stop accepting more, or the
				 * `flush()` two lines down writes the capture the decision just refused.
				 */
				const atStop = captureTabs(
					registry.list(),
					registry.activeTab?.tabId ?? null,
					host.failedTabIds(),
				);
				const decision = sessionStore.commitStopCapture(atStop);
				if (!decision.write) {
					log(
						`[browser] not overwriting ${SESSION_FILENAME} at stop: ${decision.reason}`,
					);
				}
				// Nothing durable is written after this point: the store is sealed with the
				// decision, and the per-view `destroyed` handlers below still fire a capture
				// each (a strip that no longer exists is another way to lose the session).
				sessionStore.flush();
				// The overlay child goes before the page views: its webContents is a
				// child of the same window, and disposal is idempotent with rollback.
				addressOverlay?.dispose("host-stop");
				if (approvalsExpiryTimer) {
					clearTimeout(approvalsExpiryTimer);
					approvalsExpiryTimer = null;
				}
				approvalsOverlay?.dispose("host-stop");
				registry.destroyAll();
				await Promise.allSettled([...releases]);
				await cdp.close();
				await server.close();
				// Before the browser namespace's own teardown, and after the socket is
				// closed: no new command can arrive, so every pty this stops is one nobody
				// is mid-call on. The console flushes retained history inside its own stop.
				await consoleStartup.stop();
				unregisterBrowserIpc();
				detachSessionHandlers();
				// Before the views go: a pending chooser's callback is the page's promise,
				// and the page is about to stop existing. The listener goes with it, so a
				// second host start in this process cannot find two of them.
				detachWebauthn();
				webauthn.dispose();
				stateWriter?.clear();
				approvals.resetPending();
				ownership.clear();
				flushBrowserStorage(browserSession);
				// The snapshot reads the jar through the hidden view, so it has to happen
				// BEFORE that view is released. It is also what removes the marker that
				// tells the next start whether this shutdown was clean, so it is the last
				// thing this feature writes.
				try {
					await sessionCookies.snapshot();
				} catch (error) {
					log(
						`[browser] session cookies: the snapshot failed (${String(error)})`,
					);
				}
				cookieJar.dispose();
				log("[browser] host stopped");
			},
		};
		checkpoint();
		published = true;
		activeHost = handle;
		rollback.commit();
		return handle;

		/**
		 * Build one driven view. These webPreferences are the security contract
		 * (design 11.5): the shared persistent partition, `sandbox: true`,
		 * `contextIsolation: true`, `nodeIntegration: false`, and NO preload at all.
		 * The app's own renderer is `sandbox: false` only because it carries the
		 * preload and the desktop IPC surface — which is exactly what a driven page
		 * must never reach, so the two are configured in opposite directions on
		 * purpose rather than by inheritance.
		 */
		function buildView(window: BrowserWindow): WebContentsView {
			const view = new WebContentsView({
				webPreferences: {
					partition: BROWSER_PARTITION,
					contextIsolation: true,
					nodeIntegration: false,
					webSecurity: true,
					allowRunningInsecureContent: false,
					sandbox: true,
					// No `preload`: a driven page has no bridge to anything.
				},
			});
			// Native isolated zoom is per WebContents, not Chromium's origin-wide
			// default. Cookies/policy still use the same persistent partition.
			view.webContents.setZoomMode("isolated");
			view.webContents.setZoomFactor(1);
			window.contentView.addChildView(view);
			// SIZED BEFORE THE FIRST HIDE, and the order is load-bearing: measured on
			// Electron 44, a WebContentsView that is hidden first and sized afterwards
			// keeps a 0×0 layout viewport — its renderer reads `innerWidth === 0` and
			// every point query (`document.elementsFromPoint`, the primitive behind the
			// `hit_test` action) answers an empty stack. The registry's layout pass
			// re-applies this same rect on creation, but too late to matter. The rect is
			// its `BACKGROUND_VIEWPORT`, the size a tab that never becomes the surface
			// is promised by design 11.4/6.4.
			view.setBounds(BACKGROUND_VIEWPORT);
			// Hidden until the registry's layout pass decides otherwise: only the active
			// tab occupies the content rect, so a tab created in the background paints
			// nothing over the app's own UI while it loads.
			view.setVisible(false);
			return view;
		}

		/** Per-webContents handlers. Session-level handlers were installed once,
		 * above; these are per view because that is where Electron puts them. */
		function wireView(view: WebContentsView, tabId: number): void {
			const contents = view.webContents;
			// The view's own focus is the native fact the menu/accelerator route needs:
			// `getFocusedWebContents()` can stay null while a WebContentsView holds focus
			// (measured on Electron 44.3.0), and a menu click may arrive with no callback
			// window. `ownsPage` combines this with the active/presented check.
			contents.on("focus", () => {
				host.setPageFocused(tabId, true);
				// Main owns "the user clicked into the page": a parent DOM blur cannot
				// see it (S3 V-FOCUS-CLICK is blocked), and the native focus event is
				// the fact itself. This lowers the product popout for that tab only.
				addressOverlay?.dismissForTab(tabId, "page_focus");
			});
			contents.on("blur", () => host.setPageFocused(tabId, false));
			/*
			 * A PAGE PRESS IS A DISMISSAL EVEN WHEN THE PAGE ALREADY HAS FOCUS
			 * (operator report, 2026-10-24). The focus handler above fires once,
			 * when focus ARRIVES; a second click into an already-focused page
			 * produces no focus event, and the owner input's blur then carries the
			 * null `relatedTarget` the row deliberately keeps (that value is also a
			 * window deactivation). The page's own input pipeline sees every press,
			 * so it is the one fact that can lower the field in that case.
			 * `dismissForTab` is scoped to the bound/active tab. It performs one
			 * idempotent hide (and one log line) per page press even when no child
			 * is shown: the press is the edit-session dismissal, so it must not
			 * wait for a projection (the pending-first-answer case has none). The
			 * renderer's abandonment is a no-op when there is no edit. The
			 * suggestion child's row-commit observer is a different WebContents
			 * and is not involved.
			 */
			contents.on("before-mouse-event", (_event, mouse) => {
				if (mouse.type === "mouseDown")
					addressOverlay?.dismissForTab(tabId, "page_pointer");
			});
			// The user's own navigation starts here; a page/agent-initiated one shares
			// the event, which is why the design scopes "navigating dismisses" to the
			// bound tab's main frame and not to a background tab's load.
			contents.on(
				"did-start-navigation",
				(_event, _url, isInPlace, isMainFrame) => {
					// A SAME-DOCUMENT NAVIGATION IS NOT A NAVIGATION the user made: a SPA
					// route change or a hash rewrite while the field is raised must not
					// discard the draft. The owner-level listener excludes it for the same
					// reason (nit round 1, NIT-1 / UX U4).
					if (isMainFrame && !isInPlace)
						addressOverlay?.dismissForTab(tabId, "navigation");
				},
			);

			// Popups: `about:blank` and http(s) open as real child windows, everything
			// else is refused with a log line (docs/design/browser-oauth-popups.md 1.1).
			// The deny-all that used to live here was measured against a real page whose
			// sign-in legitimately uses `window.open` — the console's MSAL `loginPopup` —
			// and lost: a denied `window.open` returns `null`, and the opener/postMessage
			// contract cannot be rebuilt from the URL. The main window's own handler is
			// still deliberately not copied: its trusted-auth-domain allowlist exists for
			// the app's own OAuth popup, while a driven page is arbitrary web content, so
			// the boundary here is the hardened window plus the per-view cap — not a
			// domain list that would have to name every IdP a page may meet.
			const popupChildren = new Set<BrowserWindow>();
			contents.setWindowOpenHandler((details) => {
				const decision = decidePopup(
					{ url: details.url, disposition: details.disposition },
					{ mode: options.windowShow, live: popupChildren.size },
				);
				if (!decision.allow) {
					log(
						`[browser] refused a popup from a driven page: ${details.url} (${decision.reason})`,
					);
					return { action: "deny" };
				}
				log(
					`[browser] tab ${tabId} opened a popup: ${details.url} ` +
						`(disposition=${details.disposition}, presentation=${decision.presentation})`,
				);
				return {
					action: "allow",
					overrideBrowserWindowOptions: {
						width: 640,
						height: 720,
						minWidth: 480,
						minHeight: 560,
						center: true,
						frame: true,
						autoHideMenuBar: true,
						// Nothing shows itself: presentation happens only through
						// `presentPopupWindow` (window-raise.ts), under the launch plan's own
						// gate. Under `never` the window exists hidden and drivable over CDP.
						show: false,
						// Defence in depth beside the plan gate: a window that will never be
						// shown must also not be focusable — the same pairing `window-mode.ts`
						// applies to the main window in `headless`.
						focusable: decision.presentation !== "never",
						backgroundColor: "#FFFFFF",
						webPreferences: {
							/*
							 * EXPLICIT, and load-bearing (design 2.3): `partition` is NOT among the
							 * security-related prefs Electron merges from the parent, and a popup
							 * created in a different session is not RELATED to its opener —
							 * Chromium severs `window.opener`, which is the entire contract a
							 * popup-based sign-in needs. The `about:blank` case lands in this same
							 * session by prefs-copy instead of by this line.
							 */
							partition: BROWSER_PARTITION,
							sandbox: true,
							contextIsolation: true,
							nodeIntegration: false,
							webSecurity: true,
							allowRunningInsecureContent: false,
							spellcheck: false,
							navigateOnDragDrop: false,
							// Not security-inherited either: a hidden popup must render like a
							// shown one so a capture of it is evidence (design 2.5).
							backgroundThrottling: options.backgroundThrottling,
							// No `preload` — a popup has no bridge to anything, like the view.
						},
					},
				};
			});
			contents.on("did-create-window", (child, details) => {
				wirePopup(child, details, popupChildren);
			});

			// Navigation limits, shared with every popup this view opens: http(s) only,
			// compared on a PARSED url — design 11.6 is explicit that a `startsWith`
			// comparison is not a check.
			const onWillNavigate = (event: Event, rawUrl: string): void => {
				if (refusesNavigation(rawUrl)) {
					event.preventDefault();
					log(`[browser] refused a navigation to ${rawUrl}`);
				}
			};
			contents.on("will-navigate", onWillNavigate);
			contents.on("will-redirect", onWillNavigate);

			// THE PAGE CONTEXT MENU (LOH-13 slice A, gap 3). A driven page is a
			// native view above all renderer DOM, so this `context-menu` event
			// is the only place a right-click over the page exists. The item
			// RULE lives in `page-context-menu.ts` (pure, tested); this block
			// only turns it into a native menu for THIS view - back/forward
			// walk this contents' own history, not the active tab's, so a
			// menu can never steer a tab it was not opened on. Navigation and
			// editing only: no downloads, no devtools, no consent actions.
			contents.on("context-menu", (_event, params) => {
				const navigation = contents.navigationHistory;
				const items = buildPageContextMenuItems({
					linkUrl: params.linkURL ?? "",
					pageUrl: contents.getURL(),
					canGoBack: navigation ? navigation.canGoBack() : false,
					canGoForward: navigation ? navigation.canGoForward() : false,
					isEditable: params.isEditable,
					selectionText: params.selectionText ?? "",
					editFlags: params.editFlags,
				});
				const menu = Menu.buildFromTemplate(
					items.map((item) => {
						if (item.id === "separator") return { type: "separator" as const };
						return {
							label: item.label,
							enabled: item.enabled,
							click: () => {
								if (item.id === "back") navigation?.goBack();
								else if (item.id === "forward") navigation?.goForward();
								else if (item.id === "reload") contents.reload();
								else if (item.id === "copy-link")
									clipboard.writeText(params.linkURL ?? "");
								else if (item.id === "copy-page")
									clipboard.writeText(contents.getURL());
								else if (item.id === "undo") contents.undo();
								else if (item.id === "redo") contents.redo();
								else if (item.id === "cut") contents.cut();
								else if (item.id === "copy") contents.copy();
								else if (item.id === "paste") contents.paste();
								else if (item.id === "select-all") contents.selectAll();
								else if (item.id === "open-link")
									void host
										.openLinkInNewTab(params.linkURL ?? "")
										.catch(() => {});
							},
						};
					}),
				);
				menu.popup({ window: options.window });
			});

			/*
			 * THE NAVIGATION CHORDS (issue #675), answered for the PANE's own history
			 * while THIS view's webContents has focus. The window-level half — the
			 * app's router — is renderer-owned (`@shared/navigation-gesture`), because
			 * a run-details reader and canvas editors may already claim Cmd/Ctrl+[;
			 * this hook fires before the driven page sees the key at all, so the pane
			 * is the page's single owner, the way a browser answers the chord with
			 * its own history (the same movement as its toolbar's back/forward,
			 * `host.historyActive`).
			 *
			 * MOUSE side-buttons are deliberately NOT wired here: Electron's only mouse
			 * input event carries left/middle/right (`MouseInputEvent`), so a
			 * side-button press over a driven page has no event to answer; where
			 * Chromium itself claims those buttons it walks this webContents' stack,
			 * and otherwise the driven page receives them as DOM events we do not own
			 * by design (no preload). The app's own windows answer them in the
			 * renderer.
			 */
			contents.on("before-input-event", (event, input) => {
				const record = registry.get(tabId);
				const owns =
					record === registry.activeTab && record?.presented === true;
				const handled = chords.input(event, input, "page", owns);
				contents.setIgnoreMenuShortcuts(handled);
			});

			// THE CHROME'S OWN FEEDBACK, and the reason it is wired per view rather than
			// read on demand: the URL bar shows the tab's LIVE url, "updated from
			// navigation events, never from what was requested" (design 6.1). Without
			// these listeners the strip and the bar would only move when an ACTION ran —
			// so a redirect, a client-side route change, a load that never finishes and a
			// page that sets its own title would all leave the chrome showing the state
			// from the last click. Measured: the loading frame in
			// `scripts/browser-chrome-proof.mjs` showed a Reload control while main's own
			// `loading` read true, and the field was empty through a whole slow load.
			//
			// Deliberately NOT `notifyChanged`, which also publishes the state file and
			// re-captures the session: a load emits start/stop pairs and a page emits
			// title changes as it runs scripts, and none of those change what is durable.
			// One event, so the renderer re-reads the projection it already owns.
			const notifyChrome = (): void => {
				options.window.webContents.send("browser-state-changed");
			};
			contents.on("did-start-loading", () => {
				// A navigation is under way, so the last refusal is stale — otherwise the
				// failure panel would outlive the retry the user just pressed.
				host.clearLoadFailure(tabId);
				notifyChrome();
			});
			contents.on("did-stop-loading", notifyChrome);
			contents.on("page-title-updated", (_event, title) => {
				// The title belongs to the document that just announced it, so the URL
				// is read from the view at this moment rather than remembered from the
				// last navigation: a title event that races a commit must not attach a
				// page's title to the URL it just left.
				host.recordHistoryTitle(contents.getURL(), title);
				notifyChrome();
			});
			// A crashed page keeps its webContents (unlike a closed tab), so the
			// `destroyed` handler below never runs for it. The S1 overlay is bound to
			// this tab's rectangle and must go with the renderer it was covering.
			contents.on("render-process-gone", () => {
				addressOverlay?.onPageGone(tabId);
			});
			contents.on(
				"did-fail-load",
				(_event, code, description, url, isMainFrame) => {
					// Sub-frame failures are ordinary (an ad iframe), and this run's own error
					// frame is a main-frame refusal, which is the one that changes the state the
					// chrome shows.
					if (!isMainFrame) return;
					// The remote document CANNOT report this: a refused main-frame load leaves
					// Chromium's own blank surface in the view, so the reason travels in the
					// projection and the chrome paints it (design round 1, D1).
					if (isReportableLoadFailure(code)) {
						host.recordLoadFailure(tabId, {
							code,
							description,
							url,
						});
					}
					notifyChrome();
				},
			);

			// A driven page must never be able to embed one.
			contents.on("will-attach-webview", (event) => {
				event.preventDefault();
				log("[browser] refused a webview attachment inside a driven page");
			});

			// Any top-level navigation bumps the tab's epoch, so refs taken before it
			// are refused rather than pushed against a document that no longer exists
			// (design 6.4). One place, so agent navigations, the user's own and
			// page-initiated ones are all covered.
			contents.on("did-navigate", (_event, url) => {
				registry.bumpEpoch(tabId);
				// The tab is on a document now, so whatever the last navigation was refused
				// for no longer describes what is on screen.
				host.clearLoadFailure(tabId);
				// Returning to an approved site must not expose logs buffered while
				// an autonomous unapproved document occupied this same WebContents.
				stopLogCapture(contents.id);
				startLogCapture(contents.id);
				log(`[browser] tab ${tabId} navigated to ${url}`);
				// The suggestion history records every committed top-level navigation;
				// the store drops anything that is not HTTP(S), so `about:blank` and a
				// refused scheme never enter it. This is a user-visible memory, not
				// agent telemetry: it is the same URL the chrome already shows.
				host.recordHistoryVisit(url);
				// A real navigation is durable state (the session file records the URL), so
				// this is the full path rather than the light notification above.
				notifyChanged();
			});
			contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
				if (!isMainFrame) return;
				registry.bumpEpoch(tabId, false);
				log(`[browser] tab ${tabId} navigated in page to ${url}`);
				// A same-document route change is still a destination the user reached
				// (a dashboard's `/settings` tab), and it is what they will retype.
				host.recordHistoryVisit(url);
				notifyChanged();
			});

			// A webContents that dies on its own (a renderer crash, a close from
			// elsewhere) must not leave a tab record pointing at nothing: the handle has
			// to fail closed, which means the record has to go. The document receipt the
			// record's token was granted goes with it — this is the third path that ends a
			// token (the ownership close and the chrome's close button are the others),
			// and a receipt outliving its token is unbounded growth in a long-lived app
			// (review round 1, N1). Read both BEFORE `forget`, which is what clears them.
			contents.on("destroyed", () => {
				const record = registry.get(tabId);
				if (record) {
					const token = surfaceToken(record);
					if (token) approvals.forgetDocument(token);
					registry.forget(tabId);
				}
				// A focus fact must not outlive the view whose focus it recorded.
				host.setPageFocused(tabId, false);
				// A failure recorded against a tab whose view died describes nothing.
				host.clearLoadFailure(tabId);
				// The same release the registry's own close performs. A view that is
				// already destroyed makes the detach's own `try` a no-op and the child-view
				// removal a no-op too, so this is safe to run on a death we did not ask for.
				releaseTab(tabId, contents.id);
			});
		}

		/**
		 * Everything a popup child gets, attached synchronously in
		 * `did-create-window` — during creation, before the child's first response or
		 * script runs, so every later navigation and redirect is covered. The initial
		 * URL was vetted by the open handler one event earlier, which is why
		 * `will-navigate`'s documented blind spot (it is for renderer-initiated
		 * navigations; the browser-side initial load is not covered) is acceptable
		 * here: the first hop IS the vetted one, and every hop after it walks through
		 * these listeners.
		 *
		 * NO grandchildren: a child opens with its own deny-all handler, because no
		 * known auth flow nests popups and unbounded nesting is what the per-view cap
		 * would otherwise have to chase.
		 *
		 * NO registry, tab id, state file, CDP driver attachment or change
		 * notification: the popup is not a tab and must not become one — the proof
		 * asserts the tab count does not move. It appears nowhere in `session.json`
		 * either; closing the app ends it.
		 *
		 * The child closes when its opener does (Electron's documented default —
		 * `outlivesOpener` is deliberately absent), which is what covers the tab-close
		 * path: `releaseView` destroys the view's webContents, and the popup goes with
		 * it.
		 */
		function wirePopup(
			child: BrowserWindow,
			details: DidCreateWindowDetails,
			popupChildren: Set<BrowserWindow>,
		): void {
			popupChildren.add(child);
			child.on("closed", () => popupChildren.delete(child));
			const childContents = child.webContents;
			childContents.setWindowOpenHandler((childDetails) => {
				log(`[browser] refused a popup from a popup: ${childDetails.url}`);
				return { action: "deny" };
			});
			const onWillNavigate = (event: Event, rawUrl: string): void => {
				if (refusesNavigation(rawUrl)) {
					event.preventDefault();
					log(`[browser] refused a popup navigation to ${rawUrl}`);
				}
			};
			childContents.on("will-navigate", onWillNavigate);
			childContents.on("will-redirect", onWillNavigate);
			// A driven page must never be able to embed one — the same rule the view
			// enforces above, for the same reason.
			childContents.on("will-attach-webview", (event) => {
				event.preventDefault();
				log("[browser] refused a webview attachment inside a popup");
			});
			/*
			 * THE NAVIGATION CHORDS, answered for the POPUP's own history (issue
			 * #675's round-1 review, M2). A popup is where an auth flow actually runs —
			 * several hops deep — so back/forward there is the same gesture the driven
			 * view answers with ITS history; the reading is the popup's OWN
			 * `navigationHistory` rather than `host.historyActive`, which speaks for
			 * the active TAB and would walk a different surface than the one in front
			 * of the user.
			 *
			 * MOUSE side-buttons stay absent for the reason the view's hook states:
			 * Electron's only mouse input event carries left/middle/right, so there is
			 * no event to answer.
			 */
			childContents.on("before-input-event", (event, input) => {
				const direction = paneNavigationDirection(input);
				if (!direction) return;
				event.preventDefault();
				const navigation = childContents.navigationHistory;
				if (direction === "back") navigation.goBack();
				else navigation.goForward();
			});
			// The post-creation call covers the `about:blank` children whose
			// `WebPreferences` are copied from the opener rather than taken from our
			// options: a hidden popup must still render like a shown one, so a capture
			// of it is a full-fidelity frame (`webContents.setBackgroundThrottling` is
			// the documented way to say so after creation).
			if (!options.backgroundThrottling) {
				childContents.setBackgroundThrottling(false);
			}
			presentPopupWindow(
				child,
				effectivePresentation(options.windowShow, details.disposition),
				{ trigger: "popup-open", report: options.reportRaise },
			);
		}
	} catch (error) {
		published = false;
		for (const key of Object.keys(bindings))
			delete bindings[key as keyof RegisterBrowserIpcOptions];
		await rollback.run(log);
		throw error;
	}
}

/**
 * Release a view's resources.
 *
 * `close()` on the webContents is required on EVERY path: with
 * `WebContentsView`, Electron documents that the webContents is NOT destroyed
 * for you and that the consequence is a leak, so a tab close that only removed
 * the child view would leak a whole renderer process (design 11.1, probe P10).
 */
function releaseView(
	window: BrowserWindow,
	view: WebContentsView | undefined,
): void {
	if (!view) return;
	try {
		if (!view.webContents.isDestroyed()) view.webContents.close();
	} catch {
		// Already gone.
	}
	try {
		window.contentView.removeChildView(view);
	} catch {
		// The window itself may be closing; nothing to detach from.
	}
}

/** The app version the state file publishes, read here so `src/main/index.ts`
 * stays the only module that decides when the host starts. */
export function browserHostAppVersion(): string {
	return app.getVersion();
}
