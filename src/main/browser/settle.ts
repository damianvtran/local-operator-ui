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

/**
 * The subset of `WebContents` this module needs.
 *
 * Structural, so the settle logic is testable with a fake event emitter rather
 * than a real browser — but the listeners are declared PER EVENT, with the real
 * Electron 44 argument lists (`node_modules/electron/electron.d.ts`,
 * Electron 44.3.0: `did-navigate-in-page` at :16907-16911, `did-fail-load` at
 * :16863-16883), rather than as one widened `(event: string, ...args: never[])`
 * pair. The widening was a real defect: under it every listener had to be cast
 * `as never` at its registration site, which type-erased the argument list and
 * hid a mis-ordered `did-navigate-in-page` handler for a whole review round
 * (R1). With the real signatures written down, a handler that names the URL it
 * receives where Electron passes `isMainFrame` is a compile error.
 */
export interface SettleableContents {
	on(event: "did-finish-load", listener: () => void): unknown;
	on(
		event: "did-fail-load",
		listener: (
			event: unknown,
			errorCode: number,
			errorDescription: string,
			url: string,
			isMainFrame: boolean,
		) => void,
	): unknown;
	on(
		event: "did-navigate-in-page",
		listener: (
			event: unknown,
			url: string,
			isMainFrame: boolean,
			frameProcessId: number,
			frameRoutingId: number,
		) => void,
	): unknown;
	on(event: "destroyed", listener: () => void): unknown;
	removeListener(event: "did-finish-load", listener: () => void): unknown;
	removeListener(
		event: "did-fail-load",
		listener: (
			event: unknown,
			errorCode: number,
			errorDescription: string,
			url: string,
			isMainFrame: boolean,
		) => void,
	): unknown;
	removeListener(
		event: "did-navigate-in-page",
		listener: (
			event: unknown,
			url: string,
			isMainFrame: boolean,
			frameProcessId: number,
			frameRoutingId: number,
		) => void,
	): unknown;
	removeListener(event: "destroyed", listener: () => void): unknown;
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
			contents.removeListener("did-finish-load", onFinish);
			contents.removeListener("did-fail-load", onFail);
			contents.removeListener("did-navigate-in-page", onInPage);
			contents.removeListener("destroyed", onDestroyed);
			if (error) reject(error);
			else resolve();
		};
		const onFinish = (): void => finish();
		// `did-navigate-in-page` fires "in ANY frame" (electron.d.ts:16901), so the
		// guard is on the THIRD argument. Naming the second argument here instead
		// was the R1 bug: it binds the url string, `url === false` is never true,
		// and a sub-frame hash change settled a navigation whose main frame was
		// still loading — the caller then reported a half-loaded page.
		const onInPage = (
			_event: unknown,
			_url: string,
			isMainFrame: boolean,
		): void => {
			if (!isMainFrame) return;
			finish();
		};
		const onFail = (
			_event: unknown,
			errorCode: number,
			errorDescription: string,
			_url: string,
			isMainFrame: boolean,
		): void => {
			if (!isMainFrame) return;
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
		contents.on("did-finish-load", onFinish);
		contents.on("did-fail-load", onFail);
		contents.on("did-navigate-in-page", onInPage);
		contents.on("destroyed", onDestroyed);
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
