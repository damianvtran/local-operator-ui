import { BrowserHostError } from "./errors";

/**
 * Navigation settling against real Electron events.
 *
 * Design: docs/design/ui-browser-tab.md 12.1's substitution table. The
 * extension's `settle()` waits on `chrome.webNavigation.onCompleted` /
 * `onErrorOccurred`; Electron has no such pair, and the design is explicit that
 * the mapping is not one-to-one:
 *
 * - `did-finish-load` is NOT `onCompleted`. It fires when the load stopped
 *   being busy, which for a page whose subresources are still arriving is
 *   earlier than Chromium's own "completed".
 * - `did-fail-load` fires for SUBFRAMES too, so it must be filtered on
 *   `isMainFrame` or an ad iframe's failure aborts a navigation that in fact
 *   succeeded. `errorCode === -3` (ABORTED) is filtered as well: Chromium
 *   reports it for a navigation the page itself superseded, which is normal on
 *   any site that redirects client-side.
 * - `did-navigate-in-page` is the `onHistoryStateUpdated` analogue: a
 *   same-document route change (a SPA pushState) leaves the document in place
 *   but changes the URL, and an agent waiting on `did-finish-load` alone would
 *   hang on it.
 *
 * The failure modes are typed the same way the extension types them
 * (`nav_failed` / `nav_timeout`) so the session's existing copy applies.
 */

/** Chromium's net error for a navigation its own renderer aborted. */
const ERR_ABORTED = -3;

/** The subset of `WebContents` this module needs. Structural, so the settle
 * logic is testable with a fake event emitter rather than a real browser. */
export interface SettleableContents {
	on(event: string, listener: (...args: never[]) => void): unknown;
	removeListener(event: string, listener: (...args: never[]) => void): unknown;
	isDestroyed(): boolean;
}

/**
 * Resolve when the view's main frame finishes its next navigation.
 *
 * `timeoutMs` is a CEILING on waiting, not a prediction: a page that never
 * finishes (a hung server, an endless redirect) must fail with a typed
 * `nav_timeout` rather than park the tab's command lane forever.
 */
export function settle(
	contents: SettleableContents,
	timeoutMs = 30_000,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let done = false;
		const finish = (error?: Error): void => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			contents.removeListener("did-finish-load", onFinish as never);
			contents.removeListener("did-fail-load", onFail as never);
			contents.removeListener("did-navigate-in-page", onInPage as never);
			contents.removeListener("destroyed", onDestroyed as never);
			if (error) reject(error);
			else resolve();
		};
		const onFinish = (): void => finish();
		const onInPage = (_event: unknown, isMainFrame?: boolean): void => {
			if (isMainFrame === false) return;
			finish();
		};
		const onFail = (
			_event: unknown,
			errorCode?: number,
			errorDescription?: string,
			_url?: string,
			isMainFrame?: boolean,
		): void => {
			if (isMainFrame === false) return;
			if (errorCode === ERR_ABORTED) return;
			finish(
				new BrowserHostError(
					"nav_failed",
					errorDescription ?? "navigation failed",
					{ error_code: errorCode ?? 0 },
				),
			);
		};
		// A view closed mid-navigation is not a timeout: the handle is gone, and
		// saying so lets the session drop it and re-`open` rather than retrying
		// against a tab that cannot come back.
		const onDestroyed = (): void =>
			finish(
				new BrowserHostError(
					"tab_closed",
					"that browser tab closed while it was loading; dropped the handle. Use 'open' with a URL to get a new tab",
				),
			);
		const timer = setTimeout(
			() =>
				finish(
					new BrowserHostError("nav_timeout", "navigation timed out", {
						timeout_ms: timeoutMs,
					}),
				),
			timeoutMs,
		);
		contents.on("did-finish-load", onFinish as never);
		contents.on("did-fail-load", onFail as never);
		contents.on("did-navigate-in-page", onInPage as never);
		contents.on("destroyed", onDestroyed as never);
	});
}

/**
 * The URL schemes a driven view may be pointed at.
 *
 * A copy of the session-side rule (`_BROWSER_URL_SCHEMES`) rather than an
 * import: the two sides are separate release lines, and an independent re-check
 * is the point — the extension re-checks for the same reason. Compared on a
 * PARSED url, never with `startsWith`: a `startsWith("http")` test admits
 * `httpfoo:` and a `startsWith("https://good.com")` test admits
 * `https://good.com.evil.test`.
 */
export function permittedScheme(url: URL): boolean {
	return url.protocol === "http:" || url.protocol === "https:";
}
