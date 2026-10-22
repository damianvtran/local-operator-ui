/**
 * The wire contract for local address suggestions.
 *
 * WHY THIS IS A SHARED MODULE rather than a main-only type: the preload types
 * the bridge and the renderer derives display text from the same entries, so
 * both sides must agree on the exact shape and bounds. A second hand-written
 * copy is how one side starts accepting a field the other never sends.
 *
 * TWO SOURCES, ONE LIST: persistent history (`history-store.ts`, survives the
 * session) and the live tabs' stacks (`address-history.ts`). Every entry says
 * which it is with `source`, because the two differ in a way the user must be
 * able to see: a history row is a page they have been to, an open-tab row is a
 * page this app still has open. The UI marks the second in words rather than
 * with a section heading (the native overlay's row protocol is uniform height
 * and S4b owns it).
 *
 * WHAT DOES NOT CROSS THIS BOUNDARY, deliberately: Chromium `pageState` (scroll
 * position and form values), credentials embedded in a URL, and every non-web
 * scheme. The query is sent, because main now ranks the stored table and the
 * renderer cannot rank a snapshot it no longer holds; it is a prefix of what
 * the user typed, it stays in this process, and it is never logged.
 */

/**
 * How many source tabs one read visits. The query bounds the response, not this
 * walk: a tab whose stack holds no match still costs a read.
 */
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
/** The query cap: a prefix longer than the URL bound cannot match anything. */
export const ADDRESS_HISTORY_MAX_QUERY_LENGTH = ADDRESS_HISTORY_MAX_URL_LENGTH;
/** How many rows one response may carry. The renderer shows at most five. */
export const ADDRESS_HISTORY_MAX_LIMIT = 20;
/** What the renderer asks for. One more than it paints, so a dedupe can lose a
 * row without leaving a gap. */
export const ADDRESS_HISTORY_DEFAULT_LIMIT = 8;

export interface AddressHistoryRequest {
	/** The renderer's own monotonic id. Responses carrying an older id are
	 * discarded, so a slow read cannot overwrite a newer one. */
	requestId: number;
	/** The tab the field is editing. Main refuses when it is no longer active:
	 * suggestions for another tab's history in this field is how a stale
	 * completion navigates the wrong tab. */
	expectedTabId: number;
	/** The text the user has typed, already debounced by the renderer. Ranked
	 * against by main; never logged. */
	query: string;
	/** The maximum number of entries main may return. */
	limit: number;
}

/** Which store answered. The UI must be able to tell the user. */
export type AddressHistorySource = "history" | "tab";

export interface AddressHistoryEntry {
	/** Canonical HTTP(S) destination. History entries have no fragment; a live
	 * tab entry keeps the fragment its stack holds. */
	url: string;
	/** Plain text, bounded. Empty when neither source has a title. */
	title: string;
	/** Visits recorded for this URL. `0` for a live-tab entry: a stack has no
	 * visit count, and inventing one would be a rank the source cannot defend. */
	visitCount: number;
	/** Epoch milliseconds of the last recorded visit. `0` for a live-tab entry,
	 * for the same reason. */
	lastVisitedAt: number;
	/** Where this row came from. Never absent. */
	source: AddressHistorySource;
	/** The live tab this entry was read from. Present only for `source: "tab"`. */
	sourceTabId?: number;
	/** Its index in that tab's history stack. Present only for `source: "tab"`. */
	sourceIndex?: number;
	/** Whether the source tab is the active one. Present only for `source: "tab"`. */
	activeTab?: boolean;
	/** Absolute distance from the source tab's current history index. Present
	 * only for `source: "tab"`. */
	distanceFromCurrent?: number;
}

export interface AddressHistoryResponse {
	requestId: number;
	/** The active tab at collection time. The renderer discards a response whose
	 * value no longer matches the tab it is editing. */
	activeTabId: number | null;
	entries: AddressHistoryEntry[];
}
