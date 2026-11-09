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
 * WHY THE NONCE. Renderer-initiated navigations to any `about:` URL other than
 * the bare `about:blank` are already refused (`refusesNavigation` in index.ts),
 * so web content cannot produce this URL today. The per-process random nonce is
 * defence in depth: even a future path that let a page load an about:blank
 * fragment could not name an internal page without knowing a secret that only
 * main holds, and a restored session from a previous process (old nonce) maps to
 * nothing rather than to a privileged page.
 *
 * Agents never see the document URL: every projection (`chromeState`, `tabs`,
 * action results) goes through `displayUrlOf`, and `registry.requireSurface`
 * refuses an agent handle whose tab is on an internal page.
 */
import { randomBytes } from "node:crypto";
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

/** The URL anything outside main's own bookkeeping may see for a document. */
export function displayUrlOf(url: string): string {
	const page = internalPageOfDocument(url);
	return page ? internalUrlOf(page) : url;
}
