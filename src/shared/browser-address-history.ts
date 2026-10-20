/**
 * The wire contract for local address suggestions.
 *
 * WHY THIS IS A SHARED MODULE rather than a main-only type: the renderer ranks
 * locally and the preload types the bridge, so both sides must agree on the exact
 * shape and bounds. A second hand-written copy is how one side starts accepting a
 * field the other never sends.
 *
 * WHAT DOES NOT CROSS THIS BOUNDARY, deliberately: Chromium `pageState` (scroll
 * position and form values), credentials embedded in a URL, and every non-web
 * scheme. Suggestions are a URL-plus-title projection of history that is already
 * in memory, not a second history store: there is no new persisted file, no
 * timestamps invented from `lastUsedAt` (agent-touch recency, not a visit), and
 * nothing leaves the machine.
 */

/** How many source tabs one snapshot reads. */
export const ADDRESS_HISTORY_MAX_TABS = 20;
/**
 * The per-tab window around the current history index. The same bound the
 * session-restore capture uses (`session-store.ts`), so a suggestion can never
 * offer a deeper entry than a restore would have kept.
 */
export const ADDRESS_HISTORY_MAX_ENTRIES_PER_TAB = 50;
/** The deduplicated URL cap for one response. */
export const ADDRESS_HISTORY_MAX_ENTRIES = 256;
/** The URL cap, matching the restore path's own bound. */
export const ADDRESS_HISTORY_MAX_URL_LENGTH = 2048;
/** The title cap. Titles are display text, not identity. */
export const ADDRESS_HISTORY_MAX_TITLE_LENGTH = 256;
/** The session id cap, mirroring the ids the app's routes already carry. */
export const ADDRESS_HISTORY_MAX_SESSION_ID_LENGTH = 256;

/** `"all"` is every tab this host has; a session object is that conversation's
 * tabs only. This is a DISPLAY filter over tabs the user can already see, never a
 * new permission grant. */
export type AddressHistoryScope = "all" | { sessionId: string };

export interface AddressHistoryRequest {
	/** The renderer's own monotonic id. Responses carrying an older id are
	 * discarded, so a slow read cannot overwrite a newer snapshot. */
	requestId: number;
	/** The tab the field is editing. Main refuses when it is no longer active:
	 * suggestions for another tab's history in this field is how a stale
	 * completion navigates the wrong tab. */
	expectedTabId: number;
	scope: AddressHistoryScope;
}

export interface AddressHistoryEntry {
	/** Canonical HTTP(S) destination, exact path/query/fragment bytes. */
	url: string;
	/** Plain text, bounded. Empty when Chromium has no title. */
	title: string;
	/** The live tab this entry was read from. */
	sourceTabId: number;
	/** Its index in that tab's history stack. */
	sourceIndex: number;
	/** Whether the source tab is the active one. */
	activeTab: boolean;
	/** Absolute distance from the source tab's current history index. */
	distanceFromCurrent: number;
}

export interface AddressHistoryResponse {
	requestId: number;
	/** The active tab at collection time. The renderer discards a response whose
	 * value no longer matches the tab it is editing. */
	activeTabId: number | null;
	entries: AddressHistoryEntry[];
	/** True when a bound discarded something: a tab, an entry, or a duplicate. */
	truncated: boolean;
}
