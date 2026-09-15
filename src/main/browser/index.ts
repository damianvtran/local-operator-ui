import { join } from "node:path";
import { type BrowserWindow, type Event, WebContentsView, app } from "electron";
import { ApprovalStore } from "./approvals";
import { CdpPool } from "./cdp";
import type { DriveableView } from "./electron-types";
import { BrowserHost } from "./host";
import { registerBrowserIpc, unregisterBrowserIpc } from "./ipc";
import { startLogCapture, stopLogCapture } from "./log-capture";
import { OwnershipLedger } from "./ownership";
import {
	BROWSER_PARTITION,
	type ClearWhat,
	browserStoragePath,
	browserUserAgent,
	clearBrowsingData,
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
	/** `userData` — where the approvals store and (later) `session.json` live. */
	userDataDir: string;
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
		onDownloadAttempted: (details) => {
			log(`[browser] refused a download from ${details.url}`);
		},
		log,
	});

	// Policy and data share one immutable vendoring pin. A writable userData
	// file must not silently redefine which public suffixes admit broad grants.
	configurePslRules(PSL_RULES);

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

	const notifyChanged = (): void => {
		stateWriter?.publishNow();
		options.window.webContents.send("browser-state-changed");
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
		log,
		onChanged: notifyChanged,
		facts: () => facts,
	});

	const sessionKey = mintSessionKey();
	const server: RpcServer = await startRpcServer({
		key: sessionKey,
		dispatch: (method, params, requestId) =>
			host.dispatch(method, params, requestId),
		log,
	});

	stateWriter = new BrowserStateWriter(
		stateFilePath(),
		() => ({
			tabs: registry.count(),
			agentTabs: registry.agentTabCount(),
			profileDir,
		}),
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
		clearData: (what: ClearWhat) => sessionCookies.clearBrowsingData(what),
		log,
	});

	log(
		`[browser] host on ${server.address}:${server.port} (proto ${facts.proto}), profile ${profileDir || "(in-memory)"}, agent tabs ${registry.agentTabCount()}/${8}`,
	);

	const handle: BrowserHostHandle = {
		host,
		port: server.port,
		profileDir,
		agentTabs: () => registry.agentTabCount(),
		sessionCookies: () => restoreReport,
		stop: async () => {
			registry.destroyAll();
			await cdp.close();
			await server.close();
			unregisterBrowserIpc();
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
			// Returning to an approved site must not expose logs buffered while
			// an autonomous unapproved document occupied this same WebContents.
			stopLogCapture(contents.id);
			startLogCapture(contents.id);
			log(`[browser] tab ${tabId} navigated to ${url}`);
		});
		contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
			if (!isMainFrame) return;
			registry.bumpEpoch(tabId, false);
			log(`[browser] tab ${tabId} navigated in page to ${url}`);
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
