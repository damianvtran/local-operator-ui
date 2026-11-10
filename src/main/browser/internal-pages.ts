import { randomBytes } from "node:crypto";
/**
 * Main's half of the browser's own pages (see src/shared/internal-pages.ts for
 * why they are virtual URLs painted by the desktop renderer).
 *
 * HOW A TAB "IS ON" lop://extensions. The tab's WebContents loads
 * `about:blank#lop-<nonce>:<virtual url>` through main's own `loadURL`. That
 * gives the page a real session-history entry, so Back, Forward and the
 * back/forward buttons behave exactly as on any page, with no parallel history
 * model to keep in sync. The document itself is an empty, opaque-origin
 * about:blank: nothing runs in it, and the renderer hides the view anyway.
 *
 * WHY THE NONCE. A per-process random secret only main holds, so a restored
 * session from a previous process (old nonce) maps to nothing rather than to a
 * privileged page, and nothing outside main can NAME an internal document: every
 * projection (`chromeState`, agent `tabs`/action results via `pageOf`, and the
 * extension adapter's `chrome.tabs` details via `assignTabDetails`) goes through
 * `displayUrlFor`/`displayUrlOf`, never the raw document URL.
 *
 * WHY A URL IS NOT ENOUGH (QA Q5, round 2). Measured: a web page's
 * `location.href = "about:blank#lop-…"` commits WITHOUT `will-navigate` firing,
 * so `refusesNavigation` in index.ts never sees it, and an extension's
 * `chrome.tabs.update` is a browser-initiated `loadURL` that bypasses it too. So
 * the URL alone never makes a tab "on" an internal page. Main AUTHORIZES each
 * commit: `armInternalNavigation` is called immediately before main's own
 * `loadURL` of an internal document or a user's own Back/Forward (toolbar,
 * chord, page context menu), and `trackInternalPages` records, at the commit,
 * whether that commit was armed. An unarmed commit of an internal document — a
 * page script, `history.back()` from page script (Q6), an extension, an agent's
 * CDP traversal — is projected as plain `about:blank` and the renderer paints
 * nothing. The arm is consumed by the next main-frame commit of any kind, so a
 * stale arm cannot authorize a later forged commit.
 *
 * Agents never see the document URL, and `registry.requireSurface` refuses an
 * agent handle whose tab holds ANY `about:blank#lop-` document, authorized or
 * not.
 */
import type { WebContents } from "electron";
import {
	type InternalPage,
	internalUrlOf,
	parseInternalUrl,
} from "../../shared/internal-pages";

const NONCE = randomBytes(16).toString("hex");
const PREFIX = `about:blank#lop-${NONCE}:`;

/** The document URL main loads to put a tab on `page`. */
export function internalDocumentUrl(page: InternalPage): string {
	return `${PREFIX}${internalUrlOf(page)}`;
}

/** The internal page a tab's real document URL stands for, or null. */
export function internalPageOfDocument(url: string): InternalPage | null {
	return url.startsWith(PREFIX)
		? parseInternalUrl(url.slice(PREFIX.length))
		: null;
}

/** Any document shaped like an internal page, whatever its nonce. Used by the
 * agent boundary (refuse) and by masking (never show a `#lop-` fragment). */
export function isInternalDocument(url: string): boolean {
	return url.startsWith("about:blank#lop-");
}

/** The URL anything outside main's own bookkeeping may see for a document URL
 * with no tab context: never a nonce. A wrong-nonce document (QA Q7) is just
 * `about:blank`. Prefer `displayUrlFor`, which also applies authorization. */
export function displayUrlOf(url: string): string {
	const page = internalPageOfDocument(url);
	if (page) return internalUrlOf(page);
	return isInternalDocument(url) ? "about:blank" : url;
}

/* Per-WebContents authorization (see the header). WeakMaps: a destroyed tab's
 * bookkeeping goes with it. */
/** The part of a WebContents projections read (agent actions hold a narrowed
 * view type). */
type DocumentView = Pick<WebContents, "isDestroyed" | "getURL" | "getTitle">;
/** How long an arm waits for its commit. Bounded so an arm whose navigation
 * never commits (a Back with nothing behind it, an aborted load) cannot
 * authorize some LATER, unrelated commit. A local internal load commits in
 * milliseconds; history traversal of a cached entry likewise. */
const ARM_TTL_MS = 5_000;
const armed = new WeakMap<object, number>();
const presented = new WeakMap<object, string>();
const tracked = new WeakSet<object>();

/** Called by main IMMEDIATELY before it loads an internal document itself or
 * performs a USER's Back/Forward on `contents`. Never from an agent path. */
export function armInternalNavigation(contents: object): void {
	armed.set(contents, Date.now() + ARM_TTL_MS);
}

function committed(contents: object, url: string): void {
	const until = armed.get(contents);
	armed.delete(contents);
	const wasArmed = until !== undefined && Date.now() <= until;
	if (wasArmed && internalPageOfDocument(url)) presented.set(contents, url);
	else presented.delete(contents);
}

/** Install the commit observer once per tab WebContents. Both cross-document
 * and same-document (fragment: list ⇄ details) main-frame commits count. */
export function trackInternalPages(
	contents: DocumentView & {
		on(event: string, listener: (...args: never[]) => void): unknown;
	},
): void {
	if (tracked.has(contents)) return;
	// Fail closed: a view that cannot report commits (a test double without
	// events) can never show an internal page, only about:blank.
	if (typeof contents.on !== "function") return;
	tracked.add(contents);
	contents.on("did-navigate", (_event: unknown, url: string) =>
		committed(contents, url),
	);
	contents.on(
		"did-navigate-in-page",
		(_event: unknown, url: string, isMainFrame: boolean) => {
			if (isMainFrame) committed(contents, url);
		},
	);
}

/** The internal page `contents` is AUTHORIZED to show right now, or null. */
export function internalPageOf(contents: DocumentView): InternalPage | null {
	if (contents.isDestroyed()) return null;
	const url = contents.getURL();
	return presented.get(contents) === url ? internalPageOfDocument(url) : null;
}

/** What every projection shows for a tab's document. */
export function displayUrlFor(contents: DocumentView): string {
	if (contents.isDestroyed()) return "";
	const page = internalPageOf(contents);
	if (page) return internalUrlOf(page);
	const url = contents.getURL();
	return isInternalDocument(url) ? "about:blank" : url;
}

/** The title projections may show: blank for any internal-shaped document,
 * because Chromium falls back to the URL (nonce included) for a titleless one. */
export function displayTitleFor(contents: DocumentView): string {
	if (contents.isDestroyed()) return "";
	return isInternalDocument(contents.getURL()) ? "" : contents.getTitle();
}
