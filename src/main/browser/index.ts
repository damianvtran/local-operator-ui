import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserWindow, type Event, WebContentsView, app } from "electron";
import { ApprovalStore } from "./approvals";
import { CdpPool } from "./cdp";
import type { DriveableView } from "./electron-types";
import { BrowserHost } from "./host";
import { registerBrowserIpc, unregisterBrowserIpc } from "./ipc";
import { OwnershipLedger } from "./ownership";
import {
	configurePslRules,
	domainScopeAvailable,
} from "./policy/origin-policy";
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
import { TabRegistry } from "./registry";
import { type RpcServer, startRpcServer } from "./rpc";
import { permittedScheme } from "./settle";
import {
	BrowserStateWriter,
	mintSessionKey,
	stateFilePath,
} from "./state-file";

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
 * Stop the host if one is running.
 *
 * Safe to call when nothing started (a disabled host, a failed start) and safe to
 * call twice. What it is NOT relied on for is discovery: if the process dies
 * without this running, the leftover state file names a dead pid, which the
 * Python side classifies as ABSENT without probing — a crash leaves a harmless
 * record rather than a phantom host.
 */
export async function stopBrowserHost(): Promise<void> {
	const handle = activeHost;
	activeHost = null;
	if (handle) await handle.stop();
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

	// The public-suffix rules the `domain` approval scope needs. They arrive with
	// the vendored driver bundle (design 12.2) and are absent until that lands, so
	// this reads an OPTIONAL file and reports the consequence instead of failing:
	// without rules, no broad-domain option is offered and no stored domain grant
	// is matched. Exact-origin behaviour is untouched — see
	// `policy/origin-policy.ts`'s header for why this is fail-closed.
	configurePslRules(readOptionalPslRules(options.userDataDir, log));

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
		(tabId, webContentsId) => {
			const view = views.get(tabId);
			views.delete(tabId);
			void cdp.detach(webContentsId).finally(() => {
				releaseView(options.window, view);
			});
		},
		notifyChanged,
	);

	const ownership = new OwnershipLedger({
		closeTab: async (token) => {
			try {
				const record = registry.requireSurface(token);
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
		clearData: (what: ClearWhat) => clearBrowsingData(browserSession, what),
		log,
	});

	log(
		`[browser] host on 127.0.0.1:${server.port} (proto ${facts.proto}), profile ${profileDir || "(in-memory)"}, agent tabs ${registry.agentTabCount()}/${8}`,
	);

	const handle: BrowserHostHandle = {
		host,
		port: server.port,
		profileDir,
		agentTabs: () => registry.agentTabCount(),
		stop: async () => {
			registry.destroyAll();
			await cdp.close();
			await server.close();
			unregisterBrowserIpc();
			stateWriter?.clear();
			approvals.resetPending();
			ownership.clear();
			flushBrowserStorage(browserSession);
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
		// is arbitrary web content. An auth redirect inside a driven page navigates
		// the same tab, which is what a browser does.
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
			log(`[browser] tab ${tabId} navigated to ${url}`);
		});
		contents.on("did-navigate-in-page", (_event, url) => {
			registry.bumpEpoch(tabId);
			log(`[browser] tab ${tabId} navigated in page to ${url}`);
		});

		// A webContents that dies on its own (a renderer crash, a close from
		// elsewhere) must not leave a tab record pointing at nothing: the handle has
		// to fail closed, which means the record has to go.
		contents.on("destroyed", () => {
			if (registry.get(tabId)) registry.forget(tabId);
			const dying = views.get(tabId);
			views.delete(tabId);
			if (dying) {
				try {
					options.window.contentView.removeChildView(dying);
				} catch {
					// The window itself may be closing.
				}
			}
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

/** The vendored public-suffix data, if present. Absent is a supported state: see
 * the call site and `policy/origin-policy.ts`. */
function readOptionalPslRules(
	userDataDir: string,
	log: (message: string) => void,
): string | null {
	try {
		const path = join(userDataDir, "browser", "psl.txt");
		if (!existsSync(path)) return null;
		const rules = readFileSync(path, "utf8");
		log(`[browser] loaded public-suffix rules from ${path}`);
		return rules;
	} catch (error) {
		log(`[browser] could not load public-suffix rules: ${String(error)}`);
		return null;
	}
}

/** The app version the state file publishes, read here so `src/main/index.ts`
 * stays the only module that decides when the host starts. */
export function browserHostAppVersion(): string {
	return app.getVersion();
}
