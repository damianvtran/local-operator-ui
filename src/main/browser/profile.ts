import { type Session, session } from "electron";
import type { DownloadDecision } from "./downloads";
import type { DownloadItemLike } from "./electron-types";

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
 * Chromium's own Chrome-shaped string from the running runtime, with NO product
 * token: the `Electron/` suffix is dropped, and so is the
 * `LocalOperator/<version>` one this used to carry.
 *
 * WHY THE TOKEN IS GONE, and the measurement that settled it. The design
 * (`docs/design/ui-browser-tab.md` 16.4 in `damianvtran/local-operator`) framed
 * this as a judgement call with three honest options and recommended (c) — a
 * Chrome string with a `LocalOperator/` product token — naming the experiment
 * that settles it: "probing the operator's own sites". That experiment has now
 * been run on exactly the site in the operator's own report, same URL, same
 * minute-scale window, no CDP, one variable changed:
 *
 *   - plain Chrome-shaped UA: the managed challenge completes in ~2 s
 *     (title "Page not found – Muddy River News", no challenge element,
 *     rAF ~430/s);
 *   - the same string plus `LocalOperator/<version>`: the page stays on
 *     "Performing security verification" for 30 s, with the page ALIVE
 *     (rAF ~385/s, `document.visibilityState === "visible"`).
 *
 * So the stalled arm is not a frozen or throttled renderer: Cloudflare serves
 * the interstitial and then never completes it for a UA it does not trust. The
 * answer to 16.4's question is therefore (b), not (c) — and a browser that cannot
 * get past a challenge is not one a user can use, however honestly it identifies
 * itself. What is given up by dropping the token is stated plainly: this app is no
 * longer distinguishable by UA. Anything that wants to identify it must do so on
 * a channel it owns (its own requests and its own endpoints), not by a suffix on
 * a string that third-party sites read and act on.
 *
 * Composed from `process.versions.chrome` rather than hardcoded: a frozen Chrome
 * version in a UA advertises a browser that shipped years ago, which is its own
 * compatibility problem on sites that gate features by version.
 *
 * THE BUILD COMPONENT IS `0.0.0`, WHICH IS WHAT CHROME ITSELF SENDS. Chrome
 * froze `MINOR.BUILD.PATCH` in the UA string with the desktop UA reduction
 * (Chrome 101/107), so a full build number is a marker no Chrome emits — the same
 * class of artifact this change exists to remove (reviewer round 1, finding 3).
 * Measured on this machine, one command, no operator page and no screenshot:
 *
 *   Google Chrome 153.0.8010.53 presents
 *     … HeadlessChrome/153.0.0.0 Safari/537.36
 *
 * (headless branding aside, the VERSION is the reduction under test), against
 * this app's own string composed from the same runtime's build. The full
 * `process.versions.chrome` stays out of the STRING only — nothing else reads it
 * from here.
 *
 * ONE CAVEAT THE FILE HAS TO CARRY (reviewer round 1, finding 4), because the
 * section above is about a measurement this file cannot show: the plain-window
 * pair is what discriminates the UA, and the app's OWN shape was unchanged by it
 * — `--arm ua` fails 3/3 on both trees, which is why
 * `docs/design/browser-challenges-and-passkeys.md` § 2.1 says the operator's
 * symptom is not proven fixed and § 2.2 lists the discriminators still untested.
 * A reader who takes the pair above as "the app's stall was the UA" has read more
 * than was measured.
 *
 * The evidence arm that measures this is `scripts/browser-challenge-proof.mjs`'s
 * real-site arm, which asserts the UA each attempt ACTUALLY presented
 * (`navigator.userAgent`) rather than the one it asked for — an arm that sets a UA
 * on a session the page is not in reports Electron's default and passes a
 * challenge the real shape fails.
 */
export function browserUserAgent(): string {
	const chrome = process.versions.chrome ?? "0";
	// The MAJOR version only: `Chrome/<major>.0.0.0` is the shape the brand ships.
	const major = chrome.split(".")[0] || "0";
	const platform =
		process.platform === "darwin"
			? "Macintosh; Intel Mac OS X 10_15_7"
			: process.platform === "win32"
				? "Windows NT 10.0; Win64; x64"
				: "X11; Linux x86_64";
	return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
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
	/**
	 * Decide one download attempt, for EVERY download on this session.
	 *
	 * WHY THE WHOLE DECISION AND NOT A NOTIFICATION (design §8): `will-download` is
	 * session-level (Electron's split — one browser session, N views), so the one
	 * handler Electron will call cannot know which tab a download belongs to unless
	 * this module asks the thing that does know which view the WebContents is. The
	 * hook therefore receives the item AND the id of the WebContents that started
	 * it, and answers whether the attempt may proceed and where it must be written.
	 *
	 * WHY THE DEFAULT IS A REFUSAL. Before the file-transfer feature this handler
	 * called `preventDefault()` unconditionally, on the reasoning recorded at the
	 * call site below. That remains the behaviour for a download the app was not
	 * asked to make — an ABSENT hook (a test that installs handlers alone, the
	 * cookie jar's own session) must never quietly save files.
	 */
	onDownload?: (
		item: DownloadItemLike,
		webContentsId: number,
	) => DownloadDecision;
	/** What was decided, for the app log and the chrome's download row. */
	onDownloadDecided?: (outcome: DownloadOutcome) => void;
	/** A line worth putting in the app log. */
	log?: (message: string) => void;
}

/** One attempt and what the host decided about it (never model-facing). */
export interface DownloadOutcome {
	webContentsId: number;
	url: string;
	filename: string;
	/** Where it was written, or null when the attempt was cancelled. */
	savePath: string | null;
	reason: string;
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

	// Downloads. THE PRE-FEATURE RULE IS STILL THE DEFAULT — a download the app was
	// not asked to make is cancelled, because one landing in the user's own
	// Downloads folder under a page-chosen name is a worse outcome than a message
	// saying so. What changed is that a tab with an ARMED `download` call answers
	// instead: the harness composes the directory, the host writes the file there
	// under a sanitised name, and Python decides about the bytes afterwards
	// (design §5, §10). The decision itself lives in `downloads.ts`; this handler
	// owns only the two Electron facts it cannot get for itself — the item, and the
	// WebContents that started it.
	browserSession.on("will-download", (event, item, webContents) => {
		const webContentsId = webContents?.id ?? -1;
		const decision = hooks.onDownload?.(item, webContentsId) ?? {
			cancel: true,
			reason: "background downloads are not supported",
		};
		if (decision.cancel) event.preventDefault();
		const outcome: DownloadOutcome = {
			webContentsId,
			url: item.getURL(),
			filename: item.getFilename(),
			savePath: decision.cancel ? null : item.getSavePath(),
			reason: decision.reason,
		};
		if (decision.cancel) {
			hooks.log?.(
				`[browser] cancelled a download from ${outcome.url}: ${decision.reason}`,
			);
		}
		hooks.onDownloadDecided?.(outcome);
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
