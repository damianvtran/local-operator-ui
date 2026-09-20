import { join } from "node:path";
import {
	type BrowserWindow,
	type Event,
	WebContentsView,
	type WebFrameMain,
	app,
	shell,
	webContents,
} from "electron";
import { startConsoleHost } from "../console";
import { isConsoleDispatchMethod } from "../console/dispatch";
import { ConsoleError } from "../console/errors";
import {
	WebauthnChooser,
	type WebauthnRequestSource,
	attachWebauthnChooser,
	installWebauthn,
} from "../webauthn";
import { ApprovalStore } from "./approvals";
import { CdpPool } from "./cdp";
import { ConsentNotifier } from "./consent-notifier";
import { DownloadArmer } from "./downloads";
import type { DriveableView } from "./electron-types";
import { BrowserHost, isReportableLoadFailure } from "./host";
import { registerBrowserIpc, unregisterBrowserIpc } from "./ipc";
import { startLogCapture, stopLogCapture } from "./log-capture";
import { OwnershipLedger } from "./ownership";
import {
	BROWSER_PARTITION,
	type ClearWhat,
	browserStoragePath,
	browserUserAgent,
	clearBrowsingData,
	clearOriginData,
	flushBrowserStorage,
	installBrowserSessionHandlers,
	resolveBrowserSession,
} from "./profile";
import { TabRegistry, surfaceToken } from "./registry";
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
 * anything (see the repo's window-mode guard, which scans this directory), it
 * never attaches a view to `session.defaultSession`, and it never exposes CDP on
 * a socket. The driven views are children of the window's content view and
 * nothing else.
 */

/** A popup a driven page asked for. Only http(s) URLs are offered to the user;
 * anything else is logged and dropped. Module scope: the linter's rule. */
const HTTP_SCHEME = /^https?:/i;

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
	log: (message: string) => void;
}

export interface BrowserHostHandle {
	host: BrowserHost;
	port: number;
	profileDir: string;
	agentTabs: () => number;
	/** What the last restore of session-only cookies did. Exposed so an evidence
	 * run can report it without reading the log, and so a test can assert the
	 * restore ran before any page loaded. */
	sessionCookies: () => RestoreReport | null;
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

/** The in-flight stop, so a second caller waits for the first instead of
 * returning while the first is still writing the session-cookie snapshot. */
let stopping: Promise<void> | null = null;

/** Whether a stop is still owed: a running host, or a stop that has not settled.
 * Read by the app's quit path, which has to hold the quit until the
 * session-cookie snapshot the stop writes is on disk. */
export function browserHostStopPending(): boolean {
	return activeHost !== null || stopping !== null;
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
	const handle = activeHost;
	activeHost = null;
	if (!handle) return;
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

export async function startBrowserHost(
	options: StartBrowserHostOptions,
): Promise<BrowserHostHandle> {
	const { log } = options;
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
	installBrowserSessionHandlers(browserSession, {
		onPermissionRequested: (details) => {
			// The handler denies; this log is what makes a page that needs a
			// permission produce a visible trace rather than a silent failure.
			log(
				`[browser] denied a ${details.permission} permission request from ${details.origin || "(unknown origin)"}`,
			);
		},
		onDownload: (item, webContentsId) => downloads.decide(item, webContentsId),
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
	});

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
	const detachWebauthn = attachWebauthnChooser(browserSession, webauthn, log);

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
	const sessionCookies = new SessionCookieVault({
		jar: cookieJar.jar,
		cipher: browserProfileCipher(),
		...sessionCookiePaths(options.userDataDir),
		flushStore: () => browserSession.cookies.flushStore(),
		clearSessionData: (what) => clearBrowsingData(browserSession, what),
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
	const cdp = new CdpPool({ log });
	/** Child views by tab id, so close and quit can release each one, and a
	 * webContents that dies on its own can be matched back to its tab. */
	const views = new Map<number, WebContentsView>();
	let stateWriter: BrowserStateWriter | null = null;

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
	 * ONLY permission it needs — this module never decides whether a window comes
	 * forward (design 11.4).
	 */
	const consentNotifier = new ConsentNotifier({
		show: options.windowShow,
		// A banner click NAVIGATES A ROUTE AND NOTHING ELSE. It must not raise the
		// window: "never steal focus" is the rule for every browser this project
		// starts (design 11.4), and `window-raise.ts` stays the only module that
		// decides whether a window comes forward.
		onAttention: (entryId) =>
			options.window.webContents.send("browser-consent-attention", {
				entryId,
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
		sessionStore.record(
			captureTabs(registry.list(), registry.activeTab?.tabId ?? null),
		);
	};

	const notifyChanged = (): void => {
		stateWriter?.publishNow();
		options.window.webContents.send("browser-state-changed");
		// The tab list is durable state now (design 7.2): a create, a close and a
		// navigation are what changes it, and every one of those paths ends here.
		// Teardown fires it too; what keeps a teardown capture out of the file is
		// the store's own seal, not a check here.
		captureSession();
	};

	const registry = new TabRegistry(
		(_createOptions, tabId) => {
			const view = buildView(options.window);
			views.set(tabId, view);
			wireView(view, tabId);
			return view as unknown as DriveableView;
		},
		releaseTab,
		notifyChanged,
	);
	registryForDownloads = registry;

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
		const view = views.get(tabId);
		views.delete(tabId);
		// A CLOSED TAB MUST NOT STAY ARMED: the capture writes into a directory the
		// harness composed for a call that is now over, and the arm exists only as long
		// as the tab it belongs to (see `DownloadArmer`'s one-arm-per-tab rule).
		downloads.forget(tabId);
		void cdp.detach(webContentsId).finally(() => {
			releaseView(options.window, view);
		});
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

	const approvals = new ApprovalStore({
		dir: join(options.userDataDir, "browser"),
		onChanged: () => {
			options.window.webContents.send("browser-consent-changed");
			// One banner per pending request, raised HERE rather than from the renderer:
			// the renderer is exactly what may be behind another window, which is the
			// case the banner exists for (design 9.2).
			consentNotifier.announce(approvals.pendingEntries());
		},
		log,
	});

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
		forgetSiteData: (origin) => clearOriginData(browserSession, origin),
	});

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
		log,
	});

	const sessionKey = mintSessionKey();
	const server: RpcServer = await startRpcServer({
		key: sessionKey,
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

	stateWriter = new BrowserStateWriter(
		stateFilePath(),
		() => {
			const consoleCounts = consoleStartup.ok
				? consoleStartup.counts()
				: { total: 0, agent: 0 };
			return {
				tabs: registry.count(),
				agentTabs: registry.agentTabCount(),
				profileDir,
				console: consoleStartup.ok,
				consoleSurfaces: consoleCounts.total,
				consoleAgentSurfaces: consoleCounts.agent,
			};
		},
		{
			appVersion: options.appVersion,
			onError: (error) => log(`[browser] state file: ${String(error)}`),
		},
	);
	stateWriter.start(server.port, sessionKey);

	registerBrowserIpc({
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
		host,
		port: server.port,
		profileDir,
		agentTabs: () => registry.agentTabCount(),
		sessionCookies: () => restoreReport,
		stop: async () => {
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
			registry.destroyAll();
			await cdp.close();
			await server.close();
			// Before the browser namespace's own teardown, and after the socket is
			// closed: no new command can arrive, so every pty this stops is one nobody
			// is mid-call on. The console flushes retained history inside its own stop.
			await consoleStartup.stop();
			unregisterBrowserIpc();
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
	activeHost = handle;
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
		window.contentView.addChildView(view);
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

		// Popups: DENY everything, and do not auto-open the URL. The main window's
		// own handler is deliberately not copied: its trusted-auth-domain allowlist
		// exists for the app's own OAuth popup, while a driven page's `window.open`
		// is arbitrary web content. Only same-tab HTTP(S) navigation is supported;
		// this is not popup OAuth parity. POST bodies, window.opener and postMessage
		// exchanges cannot be recreated safely from a blocked popup's URL.
		contents.setWindowOpenHandler((details) => {
			if (HTTP_SCHEME.test(details.url)) {
				log(
					`[browser] blocked a popup from a driven page: ${details.url} (offered to the user rather than opened)`,
				);
				options.window.webContents.send("browser-popup-blocked", {
					tabId,
					url: details.url,
				});
			} else {
				log(`[browser] blocked a non-http popup: ${details.url}`);
			}
			return { action: "deny" };
		});

		// Navigation limits: http(s) only, compared on a PARSED url — design 11.6 is
		// explicit that a `startsWith` comparison is not a check. `file:`,
		// `javascript:`, `data:`, `blob:`, `chrome:`, `devtools:` and every `about:`
		// other than `about:blank` are refused.
		const refuses = (rawUrl: string): boolean => {
			try {
				const url = new URL(rawUrl);
				if (url.protocol === "about:") return url.href !== "about:blank";
				return !permittedScheme(url);
			} catch {
				return true;
			}
		};
		const onWillNavigate = (event: Event, rawUrl: string): void => {
			if (refuses(rawUrl)) {
				event.preventDefault();
				log(`[browser] refused a navigation to ${rawUrl}`);
			}
		};
		contents.on("will-navigate", onWillNavigate);
		contents.on("will-redirect", onWillNavigate);

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
		contents.on("page-title-updated", notifyChrome);
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
			// A real navigation is durable state (the session file records the URL), so
			// this is the full path rather than the light notification above.
			notifyChanged();
		});
		contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
			if (!isMainFrame) return;
			registry.bumpEpoch(tabId, false);
			log(`[browser] tab ${tabId} navigated in page to ${url}`);
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
			// A failure recorded against a tab whose view died describes nothing.
			host.clearLoadFailure(tabId);
			// The same release the registry's own close performs. A view that is
			// already destroyed makes the detach's own `try` a no-op and the child-view
			// removal a no-op too, so this is safe to run on a death we did not ask for.
			releaseTab(tabId, contents.id);
		});
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
