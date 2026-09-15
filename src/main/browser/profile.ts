import { type Session, app, session } from "electron";

/**
 * The persistent browsing profile, and the session-level handlers that go with
 * it. Design: docs/design/ui-browser-tab.md 5 (R1), 11.5 (wiring), 11.6
 * (navigation, popups, permissions, downloads).
 *
 * WHY a shared persistent partition and not one per tab: a login performed once
 * must be usable by every later tab, and must survive an app restart — that is
 * the whole point of R1. `session.fromPartition` returns the SAME Session object
 * for the same `persist:` name, so "shared" is Chromium's own mechanism rather
 * than something this host maintains. It is also a precondition of the
 * extensions work (Electron refuses to load an extension into an in-memory
 * session), so there is exactly one correct name here, not two policies.
 *
 * WHY the app's own renderer is NOT in this session: it sets no partition
 * (`src/main/index.ts`), so it keeps the default session. That difference is
 * load-bearing rather than incidental — it is the second structural barrier
 * between the app's UI code and the browser jar (design 11.7), behind the
 * no-CORS rule that keeps the page from calling the agent's RPC.
 */

/** The one partition name for every browser tab any actor opens. */
export const BROWSER_PARTITION = "persist:local-operator-browser";

/**
 * The browser session's user agent.
 *
 * The design (16.4) is explicit that this is a judgement call with a real
 * hazard: sites sniff, and a jar that persists logins is worse than useless if
 * a bank refuses it. This follows the design's recommendation (c) — Chromium's
 * own Chrome-shaped string from the running runtime, with the `Electron/` token
 * dropped and a `LocalOperator/<app version>` product token kept, so the host
 * identifies itself honestly without presenting as a stock browser it is not.
 *
 * Composed from `process.versions.chrome` rather than hardcoded: a frozen Chrome
 * version in a UA advertises a browser that shipped years ago, which is its own
 * compatibility problem on sites that gate features by version.
 */
export function browserUserAgent(): string {
	const chrome = process.versions.chrome ?? "0";
	const platform =
		process.platform === "darwin"
			? "Macintosh; Intel Mac OS X 10_15_7"
			: process.platform === "win32"
				? "Windows NT 10.0; Win64; x64"
				: "X11; Linux x86_64";
	return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36 LocalOperator/${app.getVersion()}`;
}

/** What the session handlers tell the rest of the app. */
export interface BrowserSessionHooks {
	/** A page asked for a permission (camera, geolocation, clipboard…). Reported
	 * so a consent surface can show it; the ANSWER is always deny for now. */
	onPermissionRequested?: (details: {
		webContentsId: number;
		origin: string;
		permission: string;
	}) => void;
	/** A download was attempted. Cancelled; the extension treats downloads as a
	 * non-goal and a download UI is a separate feature with its own surface. */
	onDownloadAttempted?: (details: {
		webContentsId: number;
		url: string;
	}) => void;
	/** A line worth putting in the app log. */
	log?: (message: string) => void;
}

/**
 * Resolve the one browser session. Must be called after `app.whenReady()`:
 * `session` is not usable before it.
 */
export function resolveBrowserSession(): Session {
	return session.fromPartition(BROWSER_PARTITION);
}

/** Whether a session actually got the persistence it asked for. Published by
 * `status`, because "does my login survive a restart" should be one command. */
export function browserStoragePath(browserSession: Session): string | null {
	// `getStoragePath()` returns null for an in-memory session. It is the ONE
	// correct source for this path (design 5.3): the leaf directory name
	// Chromium picks for a partition is undocumented, so a hand-constructed
	// path here would be a guess that reads like a fact.
	return browserSession.getStoragePath();
}

/**
 * Install everything that belongs to the SESSION rather than to a view.
 *
 * The split is Electron's, not a preference: `setPermissionRequestHandler`,
 * `setPermissionCheckHandler`, `setUserAgent`, `will-download` are session-level
 * (there is exactly one browser session), while `setWindowOpenHandler` and the
 * navigation events are per-webContents and are installed per view by
 * `cdp.ts`/`index.ts`. Installing a session handler per view would be N copies
 * of one policy, which is how two views end up disagreeing.
 */
export function installBrowserSessionHandlers(
	browserSession: Session,
	hooks: BrowserSessionHooks = {},
): void {
	// Set BEFORE any view exists: Electron documents that `setUserAgent` "doesn't
	// affect existing WebContents", so a later call would silently leave the
	// first tab presenting the default Electron UA.
	browserSession.setUserAgent(browserUserAgent());

	// Default-deny, both handlers. Not optional and not redundant: Electron
	// "automatically approve[s] all permission requests unless the developer has
	// manually configured a custom handler", and "most web APIs do a permission
	// check and then make a permission request if the check is denied" — so a
	// request handler alone leaves the check path auto-approving. One handler
	// without the other is a hole.
	browserSession.setPermissionRequestHandler(
		(_webContents, permission, callback, details) => {
			hooks.onPermissionRequested?.({
				webContentsId: -1,
				origin:
					typeof details?.requestingUrl === "string"
						? details.requestingUrl
						: "",
				permission,
			});
			callback(false);
		},
	);
	browserSession.setPermissionCheckHandler(
		(_webContents, permission, requestingOrigin, details) => {
			hooks.onPermissionRequested?.({
				webContentsId: -1,
				// Electron calls this handler with an empty origin during the
				// per-webContents startup probes (media, geolocation, app install), so the
				// documented `requestingUrl` is preferred when it is there: an
				// "(unknown origin)" line for a probe the PAGE caused is exactly the line
				// somebody needs when a site's permission stops working.
				origin: requestingOrigin || details?.requestingUrl || "",
				permission,
			});
			return false;
		},
	);

	// Downloads are cancelled rather than silently saved: a download the user did
	// not ask for, landing in their Downloads folder, is a worse outcome than a
	// message saying the app does not do that yet.
	browserSession.on("will-download", (event, item) => {
		event.preventDefault();
		hooks.onDownloadAttempted?.({
			webContentsId: -1,
			url: item.getURL(),
		});
		hooks.log?.(
			`[browser] cancelled a download from ${item.getURL()}: background downloads are not supported`,
		);
	});
}

/** Which of the three honest buttons was pressed (design 5.4). */
export type ClearWhat = "cookies" | "cache" | "everything";

/**
 * Clear browsing data.
 *
 * Three named operations rather than one, and the design is explicit about why:
 * "Clear cookies and site data", "Clear cache" and "Clear everything" each do
 * one thing a user can predict. `clearData` is used rather than the older
 * narrower `clearStorageData` because it is the documented "more thorough"
 * call, and `flushStorageData` is called FIRST so a just-written cookie is on
 * disk rather than in a buffer this is about to redefine.
 *
 * Deliberately NOT cleared: the approval store and `session.json`. They are
 * policy, not browsing data (design 5.4/9.4) — "clear browsing data" and "revoke
 * approvals" are different user intentions, and clearing cookies must not
 * silently restore a deny state.
 */
export async function clearBrowsingData(
	browserSession: Session,
	what: ClearWhat,
): Promise<void> {
	browserSession.flushStorageData();
	if (what === "cache") {
		await browserSession.clearCache();
		return;
	}
	if (what === "cookies") {
		await browserSession.clearData({
			dataTypes: [
				"cookies",
				"localStorage",
				"indexedDB",
				"serviceWorkers",
				"fileSystems",
				"webSQL",
				"backgroundFetch",
			],
		});
		return;
	}
	// "everything": the same call with no filter, plus the cache — `clearData`'s
	// `cache` type does not include the HTTP disk cache on every platform, and a
	// user who asked for everything should not keep it.
	await browserSession.clearData();
	await browserSession.clearCache();
}

/**
 * Clear ONE origin's browsing data, for "forget this site" (design 9.4).
 *
 * The per-origin counterpart of `clearBrowsingData`, and it is a separate
 * function rather than a parameter on it because the two answer different user
 * intentions: the three named buttons are "log me out of everything / of this
 * app's cache", while this one is "this site, gone". It clears cookies and the
 * site's own storage, and it deliberately does NOT touch the approval store —
 * `forgetSite` in the host calls this AND revokes, and the copy in the chrome
 * says both, because a user who thinks one of the two happened and got the other
 * has been misled about their privacy either way.
 *
 * `originMatchingMode: "origin-in-all-contexts"` rather than the default: the
 * default (`third-parties-included`) also removes data other sites stored in a
 * third-party context on this origin's pages, which is a broader blast radius
 * than the user asked for.
 */
export async function clearOriginData(
	browserSession: Session,
	origin: string,
): Promise<void> {
	browserSession.flushStorageData();
	await browserSession.clearData({
		origins: [origin],
		originMatchingMode: "origin-in-all-contexts",
		dataTypes: [
			"cookies",
			"localStorage",
			"indexedDB",
			"serviceWorkers",
			"fileSystems",
			"webSQL",
			"backgroundFetch",
			"cache",
		],
	});
}

/** Write any buffered DOMStorage to disk. Called on quit so a hard kill does not
 * lose storage that was just written. */ export function flushBrowserStorage(
	browserSession: Session,
): void {
	try {
		browserSession.flushStorageData();
	} catch {
		// A session torn down under us is not an error worth failing a quit over.
	}
}
