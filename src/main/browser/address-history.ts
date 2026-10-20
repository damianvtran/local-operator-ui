import type {
	AddressHistoryEntry,
	AddressHistoryResponse,
	AddressHistoryScope,
} from "../../shared/browser-address-history";
import {
	ADDRESS_HISTORY_MAX_ENTRIES,
	ADDRESS_HISTORY_MAX_ENTRIES_PER_TAB,
	ADDRESS_HISTORY_MAX_TABS,
	ADDRESS_HISTORY_MAX_TITLE_LENGTH,
	ADDRESS_HISTORY_MAX_URL_LENGTH,
} from "../../shared/browser-address-history";
import type {
	DriveableWebContents,
	NavigationEntryLike,
} from "./electron-types";

/**
 * Bounded collection of the URLs this browser session already knows.
 *
 * WHY A DERIVED SNAPSHOT rather than a visited-URL ledger: the host already keeps
 * every tab's Chromium history (and the restore row that survives a restart), so
 * a second persisted source would be a copy that can drift, with retention and
 * clearing semantics nobody asked for. The trade-off is stated rather than
 * hidden: a closed tab's entries leave with it, and there is no cross-tab visit
 * timestamp because `lastUsedAt` is agent-touch recency (`registry.ts`), not a
 * human visit time.
 *
 * WHAT THIS MODULE IS NOT: a permission check. The IPC handler authorizes the
 * sender and the host checks the expected tab; this module only applies the
 * display scope the user's surface already shows, then bounds the work.
 *
 * EVERY ENTRY IS A NEW OBJECT built field-by-field from the source. Chromium's
 * `pageState` (scroll position and form values) must never be projected, and
 * constructing DTOs explicitly is what keeps a future source field from leaking
 * by spread.
 */

/** The slice of a live tab this module reads. Structural, so the host and the
 * test fakes can both supply it without a Chromium. */
export interface AddressHistoryTab {
	tabId: number;
	sessionId: string | null;
	webContents: DriveableWebContents;
	/** The restore row, used only when no usable live history exists. `pageState`
	 * is never copied out (see the module note). */
	restoreRow?: {
		entries: Array<{ url: string; title?: string }>;
		activeIndex: number;
	} | null;
}

/** One tab's usable stack, read either live or from the restore fallback. */
interface StackWindow {
	entries: Array<{ url: string; title?: string }>;
	activeIndex: number;
	/** The history index of `entries[0]`. */
	startIndex: number;
}

const CONTROL_CHARS = /[\p{Cc}]/u;

/**
 * A bounded window around the tab's current index.
 *
 * WHY CENTERED rather than "the first 50": back/forward distance is the only
 * ordering the source actually has, and the entries a user is most likely to
 * retype are the ones they just left. A centered window also keeps the current
 * page's neighbours when a tab has years of history.
 */
function windowAround(
	entries: Array<{ url: string; title?: string }>,
	activeIndexRaw: number,
	max: number,
): StackWindow {
	const activeIndex = Math.min(
		Math.max(0, Number.isSafeInteger(activeIndexRaw) ? activeIndexRaw : 0),
		Math.max(0, entries.length - 1),
	);
	const start = Math.min(
		Math.max(0, activeIndex - Math.floor(max / 2)),
		Math.max(0, entries.length - max),
	);
	return {
		entries: entries.slice(start, start + max),
		activeIndex,
		startIndex: start,
	};
}

function readStack(tab: AddressHistoryTab): StackWindow | null {
	const contents = tab.webContents;
	if (!contents || contents.isDestroyed()) return null;
	const history = contents.navigationHistory;
	if (
		history?.getEntryAtIndex &&
		typeof history.length === "function" &&
		typeof history.getActiveIndex === "function"
	) {
		try {
			const total = history.length();
			if (total > 0) {
				const activeIndex = Math.max(0, history.getActiveIndex());
				const max = ADDRESS_HISTORY_MAX_ENTRIES_PER_TAB;
				const start = Math.min(
					Math.max(0, activeIndex - Math.floor(max / 2)),
					Math.max(0, total - max),
				);
				const end = Math.min(total, start + max);
				const entries: NavigationEntryLike[] = [];
				for (let index = start; index < end; index += 1) {
					const entry = history.getEntryAtIndex(index);
					if (entry) entries.push(entry);
				}
				return {
					entries,
					activeIndex,
					startIndex: start,
				};
			}
		} catch {
			// A view can be destroyed between the guard and the read. The restore row
			// is the honest fallback, and an empty stack is the honest absence of one.
		}
	}
	const row = tab.restoreRow;
	if (!row || row.entries.length === 0) return null;
	return windowAround(
		row.entries,
		row.activeIndex,
		ADDRESS_HISTORY_MAX_ENTRIES_PER_TAB,
	);
}

/** A canonical, safe HTTP(S) destination, or null.
 *
 * The rules, in the order they reject: an over-long string (the same bound the
 * restore path uses), control characters, anything WHATWG cannot parse, every
 * scheme but HTTP(S), and any URL carrying credentials. `url.href` is the
 * canonical spelling used for dedup; path, query and fragment bytes are preserved
 * by the URL parser, so two destinations that differ only in `/A` vs `/a` stay
 * distinct.
 */
export function canonicalHistoryUrl(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	if (raw.length === 0 || raw.length > ADDRESS_HISTORY_MAX_URL_LENGTH)
		return null;
	if (CONTROL_CHARS.test(raw)) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.username !== "" || url.password !== "") return null;
	if (url.href === "about:blank") return null;
	// The RAW input bound above is not enough: WHATWG percent-encoding can expand
	// multi-byte path bytes several times over, so the canonical href needs the
	// same bound or a short-looking entry can cross the DTO cap.
	if (url.href.length > ADDRESS_HISTORY_MAX_URL_LENGTH) return null;
	return url.href;
}

/** Plain display text for a title: controls removed, whitespace collapsed, and
 * the length bound applied. An absent title is an empty string, not an invented
 * one. */
export function historyTitle(raw: unknown): string {
	if (typeof raw !== "string") return "";
	const cleaned = raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
	return cleaned.length > ADDRESS_HISTORY_MAX_TITLE_LENGTH
		? cleaned.slice(0, ADDRESS_HISTORY_MAX_TITLE_LENGTH)
		: cleaned;
}

/**
 * Collect the bounded snapshot.
 *
 * ORDER: the active tab first, then the registry's stable creation order. A
 * conversation scope filters by the tab's conversation field; the active tab is
 * only in scope when it belongs to that conversation, which is why the active-first
 * ordering is applied after the filter. No recency is invented.
 */
export function collectAddressHistory(
	tabs: readonly AddressHistoryTab[],
	scope: AddressHistoryScope,
	activeTabId: number | null,
): Omit<AddressHistoryResponse, "requestId"> {
	const inScope =
		scope === "all"
			? [...tabs]
			: tabs.filter(
					(tab) => tab.sessionId !== null && tab.sessionId === scope.sessionId,
				);
	const active = inScope.find((tab) => tab.tabId === activeTabId);
	const ordered = active
		? [active, ...inScope.filter((tab) => tab.tabId !== activeTabId)]
		: inScope;

	const seen = new Set<string>();
	const entries: AddressHistoryEntry[] = [];
	for (const tab of ordered.slice(0, ADDRESS_HISTORY_MAX_TABS)) {
		const stack = readStack(tab);
		if (!stack) continue;
		stack.entries.forEach((entry, windowIndex) => {
			const url = canonicalHistoryUrl(entry.url);
			if (!url) return;
			if (seen.has(url)) return;
			if (entries.length >= ADDRESS_HISTORY_MAX_ENTRIES) return;
			seen.add(url);
			const sourceIndex = stack.startIndex + windowIndex;
			entries.push({
				url,
				title: historyTitle(entry.title),
				sourceTabId: tab.tabId,
				sourceIndex,
				activeTab: tab.tabId === activeTabId,
				// The restore fallback's window is computed by the same policy, so this
				// distance is comparable across live and restored stacks: negative is a
				// back entry, which the absolute value deliberately discards (the
				// renderer ranks by closeness, not direction).
				distanceFromCurrent: Math.abs(sourceIndex - stack.activeIndex),
			});
		});
	}
	return { activeTabId, entries };
}
