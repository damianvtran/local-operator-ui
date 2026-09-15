/**
 * The per-session paint cache: the rows a conversation was last seen with, so a
 * notification click can paint it instead of showing a skeleton.
 *
 * WHY IT EXISTS. The click's target is "the user can read the transcript", and
 * the transcript otherwise arrives from the backend's snapshot — a subscribe, a
 * bridge acquire, a cold attach and a 100-row history page, 0.5-1.5 s on this
 * machine. The rows are already in this window's memory for any conversation
 * the user has looked at, so the fast path paints those first and lets the
 * authoritative snapshot reconcile them underneath.
 *
 * IT CANNOT EXIST FOR A RECREATED WINDOW, and saying so is part of the design
 * rather than a limitation to work around: closing the last window destroys the
 * renderer, and this cache lives in the renderer. A click that recreates a
 * window always takes the skeleton branch. That is what makes the two click
 * cases two different latency claims instead of one averaged one.
 *
 * WHAT IS NOT CACHED, each for a reason that is about correctness rather than
 * size:
 *
 * - **In-flight rows** (`dropLiveRecords`): a streaming assistant row or a
 *   running tool row painted from a cache is a line that will never advance,
 *   because the deltas that would advance it were consumed by the previous
 *   mount. The stale caption is what stops a cached paint from reading as live
 *   state, but a caption cannot make a half-written row honest.
 * - **`argsByCall`**: the session-scale call-id -> arguments map exists to label
 *   live rows whose arguments have not landed yet, and it is rebuilt by the
 *   reconcile page. Retained rows carry their own `args` on the tool record, so
 *   dropping the map costs the stale paint nothing it can display and keeps one
 *   session's call history from dominating the byte budget.
 * - **The title and the attention state**: both belong to something other than
 *   the rows. The title is the catalogue row's, which the store already holds
 *   (the same row the sidebar marks unread), so a cached copy could only ever
 *   disagree with it. The attention state rides on `frontend`, and `frontend`
 *   is null until the owner's snapshot precisely so that
 *   `useCompletionView`'s read receipt cannot act on a state nobody published —
 *   restoring a cached `attention` would mean restoring a fabricated epoch and
 *   sequence beside it. The rows are the only thing this cache can honestly
 *   restore, and they are the only thing the click's latency claim is about.
 * - **The scroll position**: the transcript scroller is `flex-col-reverse` with
 *   `overflow-anchor: auto`, so it is anchored at the bottom. Rows reconciled in
 *   ABOVE the newest ones move the content above the viewport, not the
 *   viewport, which is what keeps the reader's place through the reconcile.
 *
 * THE BOUND IS BYTES, NOT SESSIONS. A row is not a unit of size: measured over
 * the transcripts on this machine, the largest is 256 MB across 19,930 entries
 * (12.8 KB per entry) and the heaviest per-row session averages 65 KB per
 * entry, so a 100-row page ranges from ~1.3 MB to ~6.5 MB. A "keep 8 sessions"
 * bound would therefore let one heavy conversation hold tens of megabytes while
 * a light one held kilobytes. Sizes below are measured in the same unit the
 * bound is asserted in (`TextEncoder` bytes of the retained rows).
 */

import {
	type TranscriptState,
	dropLiveRecords,
} from "@features/chat/canonical/transcript-reducer";

/**
 * Total bytes across every cached conversation.
 *
 * An order of magnitude below the ~150 MB a resident renderer costs, which is
 * the trade this cache is on the right side of: it is only ever populated for
 * conversations the user has actually opened in THIS window, and a recreated
 * window starts empty.
 */
export const PAINT_CACHE_TOTAL_BYTES = 4 * 1024 * 1024;

/**
 * Bytes any ONE conversation may hold.
 *
 * Without it a heavy session's retained rows could consume the whole budget and
 * evict every other conversation, so the conversation the user is about to
 * click would be the one with no cached paint. Trimming keeps the NEWEST rows,
 * which are the ones at the bottom of the scroller and the ones a click lands
 * looking at.
 */
export const PAINT_CACHE_SESSION_BYTES = 1024 * 1024;

/**
 * Rows any one conversation may hold, as a second ceiling.
 *
 * Two independent ceilings because neither implies the other: the byte cap
 * bounds memory, and this bounds the work of rebuilding the id index on read
 * for a transcript of many tiny rows.
 */
export const PAINT_CACHE_MAX_ROWS = 200;

export type PaintedConversation = {
	transcript: TranscriptState;
	/** `Date.now()` at write, for eviction order and for a test to read. */
	savedAt: number;
};

type Entry = PaintedConversation & { bytes: number };

const cache = new Map<string, Entry>();

/** UTF-8 bytes of the retained rows, which is the unit the bounds are stated in. */
function measure(records: TranscriptState["records"]): number {
	if (records.length === 0) return 0;
	try {
		// `TextEncoder` counts BYTES; `JSON.stringify(...).length` counts UTF-16
		// code units and undercounts every non-ASCII character — and this app is
		// used by people whose transcripts are full of them, so a bound stated in
		// code units would be a bound that silently does not hold.
		return new TextEncoder().encode(JSON.stringify(records)).length;
	} catch {
		// A cyclic or otherwise unserialisable record means this conversation
		// cannot be cached at a known size, and an unknown size is not something
		// a byte bound can admit.
		return Number.POSITIVE_INFINITY;
	}
}

/**
 * The newest rows that fit both ceilings, oldest-first.
 *
 * Trimmed from the FRONT: the newest rows are what the reader is looking at,
 * and the reconcile page that follows is authoritative for everything older.
 */
function trimRecords(records: TranscriptState["records"]): {
	records: TranscriptState["records"];
	bytes: number;
} {
	const capped = records.slice(-PAINT_CACHE_MAX_ROWS);
	let start = 0;
	let bytes = measure(capped);
	while (start < capped.length && bytes > PAINT_CACHE_SESSION_BYTES) {
		// Step in one row at a time rather than estimating: the row that crosses
		// the ceiling is not necessarily the smallest, and an estimate that
		// overshoots would drop rows the budget could afford.
		start += 1;
		bytes = measure(capped.slice(start));
	}
	return { records: capped.slice(start), bytes };
}

/**
 * Cache the painted conversation for `sessionId`.
 *
 * Called at the moment the panel stops showing it, which is the last moment its
 * rows are known to be the ones that were on screen. What is stored is the
 * DURABLE subset of that paint: see the in-flight filter below.
 */
export function writePaint(
	sessionId: string,
	input: { transcript: TranscriptState },
): void {
	// In-flight rows are dropped HERE rather than asked of the caller. The
	// invariant is the cache's, not the call site's: a streaming assistant row or
	// a running tool row painted from a cache is a line that can never advance,
	// because the deltas that would advance it were consumed by the previous
	// mount. A caller that forgot would produce a permanently half-written row
	// that no caption can make honest.
	const { records, bytes } = trimRecords(
		dropLiveRecords(input.transcript).records,
	);
	if (records.length === 0) {
		cache.delete(sessionId);
		return;
	}
	// `index` is rebuilt here rather than stored: it is a Map, so it cannot be
	// measured or serialised, and a stale index beside trimmed rows would be an
	// index into the old array — `removeRecord` would then delete the wrong row.
	const transcript: TranscriptState = {
		...input.transcript,
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		// The paging cursor is NOT cached. `oldestId`/`hasMore` describe the
		// backend's page boundaries for the rows this cache happens to hold, and a
		// trimmed or re-fetched set makes them wrong in a way that is worse than
		// absent: scrolling up during the stale window would splice the wrong
		// range. Cleared here and repopulated by the snapshot the paint is waiting
		// for.
		oldestId: null,
		hasMore: false,
		argsByCall: new Map(),
	};
	const entry: Entry = {
		transcript,
		savedAt: Date.now(),
		bytes,
	};
	// Delete before set so the re-inserted key is the newest for eviction order.
	cache.delete(sessionId);
	cache.set(sessionId, entry);
	evict();
}

/** The cached paint for `sessionId`, or null. Does not change eviction order. */
export function readPaint(sessionId: string): PaintedConversation | null {
	const entry = cache.get(sessionId);
	if (!entry) return null;
	const { bytes: _bytes, ...paint } = entry;
	return paint;
}

/** Forget one conversation. Used when the backend says it is gone (M6). */
export function dropPaint(sessionId: string): void {
	cache.delete(sessionId);
}

/**
 * Evict oldest-written first until the total fits.
 *
 * Insertion order is the eviction order (a `Map` preserves it), and every read
 * path leaves it alone: re-inserting on read would make eviction depend on
 * navigation history rather than on which paint is most likely to be wanted.
 */
function evict(): void {
	let total = 0;
	for (const entry of cache.values()) total += entry.bytes;
	while (total > PAINT_CACHE_TOTAL_BYTES && cache.size > 0) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		const entry = cache.get(oldest);
		cache.delete(oldest);
		total -= entry?.bytes ?? 0;
	}
}

/** Introspection for tests and for the byte-bound assertion. */
export function __paintCacheStats(): {
	sessions: number;
	bytes: number;
	rows: number;
} {
	let bytes = 0;
	let rows = 0;
	for (const entry of cache.values()) {
		bytes += entry.bytes;
		rows += entry.transcript.records.length;
	}
	return { sessions: cache.size, bytes, rows };
}

/** Drop everything. Test-only; nothing in the app needs to empty the cache. */
export function __resetPaintCache(): void {
	cache.clear();
}
