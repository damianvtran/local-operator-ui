/**
 * The embedded browser's own pages (`lop://extensions`, `lop://extensions?id=<id>`).
 *
 * WHY A VIRTUAL URL AND NOT A REGISTERED PROTOCOL. A `lop:` scheme handled by the
 * browser session would be a real origin that web content can link to, frame,
 * `window.open` or `fetch`, and any page served from it would run inside a
 * WebContentsView that agents can attach CDP to. The management UI instead lives
 * in the trusted desktop renderer (the same process and IPC the old manage dialog
 * used): main records the virtual URL on the tab, hides the tab's view, and the
 * renderer paints the page in the tab's content rect. No web document ever has
 * this URL, so nothing web-reachable can navigate to, frame or script it.
 *
 * Shared by main (address-bar parsing, projection) and the renderer (deciding
 * which page to paint). Parsing is a strict regex over the whole string, never a
 * `startsWith`: `lop://extensionsX` or `lop://extensions/../x` is not a page.
 */
import { isExtensionId } from "./browser-extensions";

export interface InternalPage {
	page: "extensions";
	/** Details view for one extension; null = the list. */
	id: string | null;
}

/** What the address bar shows for the extensions list. */
export const EXTENSIONS_PAGE_URL = "lop://extensions";

/* `chrome://extensions` is accepted as a typed alias because that is the address
 * a Chrome user's fingers know; it canonicalises to `lop://` and is never shown. */
const INTERNAL_URL = /^(?:lop|chrome):\/\/extensions\/?(?:\?id=([a-p]{32}))?$/i;

export function parseInternalUrl(raw: unknown): InternalPage | null {
	if (typeof raw !== "string") return null;
	const match = INTERNAL_URL.exec(raw.trim());
	if (!match) return null;
	const id = match[1]?.toLowerCase() ?? null;
	if (id !== null && !isExtensionId(id)) return null;
	return { page: "extensions", id };
}

/** Canonical display URL for a page. */
export function internalUrlOf(page: InternalPage): string {
	return page.id ? `${EXTENSIONS_PAGE_URL}?id=${page.id}` : EXTENSIONS_PAGE_URL;
}
