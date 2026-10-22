import { canonicalHistoryUrl, historyTitle } from "./address-history";
import { readJson, writeJsonAtomic } from "./atomic-json";

/**
 * A persistent, session-agnostic record of the pages this browser has visited.
 *
 * WHY THIS EXISTS AT ALL, given `address-history.ts` can already read every live
 * tab's stack: a stack dies with its tab, and a restore row dies with the
 * session. Suggestions that only remember what is open are useless the moment
 * the user closes the tab they came from — which is exactly when they retype
 * that host. This store is the memory that survives a restart.
 *
 * PRIVACY IS THE DESIGN, not a footnote: this document lives under the app's
 * own userData directory (0600 in a 0700 directory, written by
 * `writeJsonAtomic`), nothing in this module opens a socket, there is no
 * telemetry, no analytics and no logging of URLs — not even a count at debug
 * level. The only reader is `suggest()`, in this process, for the user's own
 * address field. "Clear everything" and "forget this site" both delete from it
 * (see `profile.ts`), because a history a user cannot clear is a privacy bug.
 *
 * NOT CHROMIUM'S HISTORY: this is a local suggestion index, not a second
 * browser. It stores only canonical HTTP(S) URLs, a plain-text title, the host,
 * a visit count and a timestamp; it never stores page state, credentials, form
 * values or non-web schemes. `canonicalHistoryUrl` is the one gate and it
 * rejects all of those.
 *
 * INDEXED, NOT SCANNED: `suggest()` is called on a typing debounce, so a
 * `Map`-values walk per keystroke is the wrong shape at 5000 entries. Three
 * in-memory indexes answer a prefix query without touching the rest of the
 * table:
 *   - `byUrl`: the canonical URL -> entry, for upsert and dedup;
 *   - `byHost`: host -> canonical URLs, for `clearOrigin`;
 *   - `prefix`: the first three characters of the scheme-less lowercase URL ->
 *     canonical URLs. Three is the shortest useful bucket: a one- or two-letter
 *     bucket would hold most of the table, and the remaining `startsWith` runs
 *     only over the bucket the query actually names.
 * The number of candidates examined before ranking is capped
 * (`SUGGEST_MAX_CANDIDATES`), so a pathological bucket cannot turn one
 * keystroke into a full sort.
 */

/** The document is versioned so a future shape can migrate rather than guess. */
export const HISTORY_STORE_VERSION = 1;

/** Hard ceilings. Eviction runs until BOTH are satisfied. */
export const HISTORY_STORE_MAX_ENTRIES = 5000;
export const HISTORY_STORE_MAX_BYTES = 2 * 1024 * 1024;

/** Writes are coalesced: a browsing session commits pages faster than a disk
 * should. `flush()` is the synchronous escape hatch (quit, clear). */
export const HISTORY_STORE_WRITE_DEBOUNCE_MS = 500;

/** How many prefix candidates one `suggest()` call examines. */
export const HISTORY_STORE_MAX_CANDIDATES = 200;

/** The scheme-less prefix width. See the module note. */
const PREFIX_WIDTH = 3;

/** Recency half-life for the ranking score, in days. */
const RECENCY_HALF_LIFE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BrowserHistoryEntry {
	/** Canonical HTTP(S) URL with the fragment stripped. */
	url: string;
	/** Plain display text, bounded by `historyTitle`. Empty is legal. */
	title: string;
	/** `URL.host` (hostname plus a non-default port), for `clearOrigin`. */
	host: string;
	/** Monotonic count of recorded visits. */
	visitCount: number;
	/** Epoch milliseconds of the most recent visit. */
	lastVisitedAt: number;
}

interface HistoryDocument {
	version: number;
	entries: BrowserHistoryEntry[];
}

export interface BrowserHistoryStore {
	/** Upsert one visit. Invalid URLs are ignored, never stored. */
	record(url: string, title: string, now?: number): void;
	/** Replace the title of an EXISTING entry without counting a visit.
	 * `page-title-updated` arrives after the commit, sometimes repeatedly. */
	updateTitle(url: string, title: string): void;
	/** The top `limit` matches for `query`, best first. */
	suggest(query: string, limit: number): BrowserHistoryEntry[];
	/** Entry count (tests and diagnostics). */
	size(): number;
	/** Delete every entry and make the deletion durable. */
	clear(): void;
	/** Delete every entry whose origin equals `origin`. */
	clearOrigin(origin: string): void;
	/** Write any pending change now. */
	flush(): void;
}

/** The scheme-less spelling used by the prefix index, lowercase. */
function schemeLess(url: string): string {
	if (url.startsWith("https://")) return url.slice("https://".length);
	if (url.startsWith("http://")) return url.slice("http://".length);
	return url;
}

/** The bucket key for a URL, and for a query once its scheme is removed. */
function prefixKey(schemeLessUrl: string): string {
	return schemeLessUrl.slice(0, PREFIX_WIDTH).toLowerCase();
}

/**
 * The ranking score, and the operator's "recency and frequency" requirement in
 * one formula:
 *
 *   score = log2(1 + visitCount) + 0.5 ** (ageDays / 7)
 *
 * WHY THIS SHAPE: frequency alone buries a site the user visited twice this
 * morning under one they opened fifty times last year, and recency alone lets a
 * single accidental click outrank a daily habit. The log keeps the tenth visit
 * worth more than the second without letting a hundred visits drown everything;
 * the exponential is a 7-day half-life, so a visit a week old is worth 0.5 and
 * one a month old is worth ~0.05. Both terms are on the order of 1–10, so
 * neither dominates by construction.
 *
 * Tie-break in `compareEntries`: `lastVisitedAt` descending, then URL, so the
 * order is total and stable across reloads.
 */
export function historyScore(entry: BrowserHistoryEntry, now: number): number {
	const ageDays = Math.max(0, now - entry.lastVisitedAt) / DAY_MS;
	return (
		Math.log2(1 + entry.visitCount) + 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS)
	);
}

function compareEntries(now: number) {
	return (a: BrowserHistoryEntry, b: BrowserHistoryEntry): number => {
		const scoreDiff = historyScore(b, now) - historyScore(a, now);
		if (scoreDiff !== 0) return scoreDiff;
		if (a.lastVisitedAt !== b.lastVisitedAt)
			return b.lastVisitedAt - a.lastVisitedAt;
		return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
	};
}

/** The canonical stored URL: HTTP(S), no credentials, no fragment. */
function storageUrl(raw: unknown): string | null {
	const canonical = canonicalHistoryUrl(raw);
	if (!canonical) return null;
	const hash = canonical.indexOf("#");
	return hash < 0 ? canonical : canonical.slice(0, hash);
}

function isEntry(value: unknown): value is BrowserHistoryEntry {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.url === "string" &&
		typeof record.title === "string" &&
		typeof record.host === "string" &&
		Number.isSafeInteger(record.visitCount) &&
		(record.visitCount as number) > 0 &&
		typeof record.lastVisitedAt === "number" &&
		Number.isFinite(record.lastVisitedAt)
	);
}

/**
 * One store over one file.
 *
 * `filePath` is the JSON document. It is injected rather than derived from
 * `app.getPath` here because that import would make this module untestable
 * without an Electron runtime; the host constructs it with
 * `<userData>/browser-history.json` once per host.
 */
export function createBrowserHistoryStore(
	filePath: string,
	options: { now?: () => number } = {},
): BrowserHistoryStore {
	const now = options.now ?? Date.now;
	const byUrl = new Map<string, BrowserHistoryEntry>();
	const byHost = new Map<string, Set<string>>();
	const prefix = new Map<string, Set<string>>();
	let writeTimer: ReturnType<typeof setTimeout> | null = null;
	// A cheap running estimate of the serialised size. The EXACT check runs only
	// when the estimate says the document might be over: `JSON.stringify` of
	// every entry on every recorded visit is O(n^2) at the 5000-entry cap, which
	// is a main-process stall for exactly the users who browse most.
	let approxBytes = 0;

	function estimate(entry: BrowserHistoryEntry): number {
		// The payload bytes plus the pretty-printed document's per-entry skeleton
		// (keys, quotes, indentation, punctuation): measured at ~150 bytes, with
		// headroom so the cheap check never reads UNDER the size the writer emits.
		return entry.url.length + entry.title.length + entry.host.length + 192;
	}

	function indexAdd(entry: BrowserHistoryEntry): void {
		let hosts = byHost.get(entry.host);
		if (!hosts) {
			hosts = new Set();
			byHost.set(entry.host, hosts);
		}
		hosts.add(entry.url);
		approxBytes += estimate(entry);
		const key = prefixKey(schemeLess(entry.url));
		let bucket = prefix.get(key);
		if (!bucket) {
			bucket = new Set();
			prefix.set(key, bucket);
		}
		bucket.add(entry.url);
	}

	function indexRemove(entry: BrowserHistoryEntry): void {
		approxBytes -= estimate(entry);
		const hosts = byHost.get(entry.host);
		hosts?.delete(entry.url);
		if (hosts?.size === 0) byHost.delete(entry.host);
		const bucket = prefix.get(prefixKey(schemeLess(entry.url)));
		bucket?.delete(entry.url);
		if (bucket?.size === 0) prefix.delete(prefixKey(schemeLess(entry.url)));
	}

	/**
	 * Evict the worst entries until both the count and the serialised byte cap
	 * hold. The byte cap is the real one: 5000 URLs can themselves exceed 2 MB,
	 * and a document that large is a write that stalls the main process on quit.
	 * Scores are computed at eviction time (not stored) so an old entry's score
	 * decays without needing a write.
	 */
	function enforceBounds(at: number): void {
		if (
			byUrl.size <= HISTORY_STORE_MAX_ENTRIES &&
			approxBytes <= HISTORY_STORE_MAX_BYTES
		)
			return;
		if (byUrl.size > HISTORY_STORE_MAX_ENTRIES) {
			const overflow = byUrl.size - HISTORY_STORE_MAX_ENTRIES;
			const victims = [...byUrl.values()]
				.sort(compareEntries(at))
				.reverse()
				.slice(0, overflow);
			for (const victim of victims) {
				byUrl.delete(victim.url);
				indexRemove(victim);
			}
		}
		// Batch the byte check: re-serialising once per removal would be O(n^2) on a
		// table that just grew past the cap. One percent (at least one entry) per
		// pass converges in a bounded number of passes and never removes more than
		// the document is over by, in the common case.
		let guard = 0;
		while (guard < 200 && byUrl.size > 0) {
			guard += 1;
			// The SAME serialisation the writer emits: pretty-printing adds ~150
			// bytes per entry, and measuring the compact form let the file cross
			// the cap while the check said it was under (measured: 2.23 MB written
			// against a 2 MB cap).
			const bytes = Buffer.byteLength(
				JSON.stringify(document(), null, 2),
				"utf8",
			);
			if (bytes <= HISTORY_STORE_MAX_BYTES) {
				// Re-anchor the estimate on the exact size so the cheap check stays
				// a slightly conservative proxy instead of drifting under the cap.
				approxBytes = bytes;
				break;
			}
			const batch = Math.max(1, Math.ceil(byUrl.size / 100));
			const victims = [...byUrl.values()]
				.sort(compareEntries(at))
				.reverse()
				.slice(0, batch);
			for (const victim of victims) {
				byUrl.delete(victim.url);
				indexRemove(victim);
			}
		}
	}

	function document(): HistoryDocument {
		return {
			version: HISTORY_STORE_VERSION,
			entries: [...byUrl.values()],
		};
	}

	function writeNow(): void {
		if (writeTimer !== null) {
			clearTimeout(writeTimer);
			writeTimer = null;
		}
		writeJsonAtomic(filePath, document());
	}

	function scheduleWrite(): void {
		if (writeTimer !== null) return;
		writeTimer = setTimeout(() => {
			writeTimer = null;
			writeJsonAtomic(filePath, document());
		}, HISTORY_STORE_WRITE_DEBOUNCE_MS);
		// A pending debounce must not be the reason a quit waits or a test process
		// stays alive; the quit path calls `flush()` for durability.
		writeTimer.unref?.();
	}

	// Load synchronously: the first keystroke may arrive before any await, and a
	// store that answers from an empty table until a microtask lands would flash
	// "no history" on focus. A corrupt or missing document is the empty store -
	// `readJson`'s contract, and the only safe direction for a cache.
	const loaded = readJson<HistoryDocument>(filePath);
	if (
		loaded &&
		loaded.version === HISTORY_STORE_VERSION &&
		Array.isArray(loaded.entries)
	) {
		for (const raw of loaded.entries) {
			if (!isEntry(raw)) continue;
			const url = storageUrl(raw.url);
			if (!url) continue;
			const host = new URL(url).host;
			const existing = byUrl.get(url);
			if (existing) {
				// A duplicate row from a hand-edited or raced document: keep the
				// stronger record rather than asserting the file is perfect.
				existing.visitCount = Math.max(existing.visitCount, raw.visitCount);
				existing.lastVisitedAt = Math.max(
					existing.lastVisitedAt,
					raw.lastVisitedAt,
				);
				if (existing.title.length === 0)
					existing.title = historyTitle(raw.title);
				continue;
			}
			const entry: BrowserHistoryEntry = {
				url,
				title: historyTitle(raw.title),
				host,
				visitCount: raw.visitCount,
				lastVisitedAt: raw.lastVisitedAt,
			};
			byUrl.set(url, entry);
			indexAdd(entry);
		}
		enforceBounds(now());
	}

	return {
		record(rawUrl, rawTitle, at = now()): void {
			const url = storageUrl(rawUrl);
			if (!url) return;
			const title = historyTitle(rawTitle);
			const existing = byUrl.get(url);
			if (existing) {
				existing.visitCount += 1;
				existing.lastVisitedAt = at;
				// An empty title never erases a known one: `page-title-updated` can
				// arrive before the document has a title, and a title is display text
				// the store should keep across visits.
				if (title.length > 0) existing.title = title;
			} else {
				const entry: BrowserHistoryEntry = {
					url,
					title,
					host: new URL(url).host,
					visitCount: 1,
					lastVisitedAt: at,
				};
				byUrl.set(url, entry);
				indexAdd(entry);
			}
			enforceBounds(at);
			scheduleWrite();
		},

		updateTitle(rawUrl, rawTitle): void {
			const url = storageUrl(rawUrl);
			if (!url) return;
			const entry = byUrl.get(url);
			if (!entry) return;
			const title = historyTitle(rawTitle);
			if (title.length === 0 || title === entry.title) return;
			entry.title = title;
			scheduleWrite();
		},

		suggest(rawQuery, limit): BrowserHistoryEntry[] {
			const wanted = Math.max(0, Math.floor(limit));
			if (wanted === 0 || byUrl.size === 0) return [];
			const at = now();
			if (rawQuery.length === 0) {
				return [...byUrl.values()].sort(compareEntries(at)).slice(0, wanted);
			}
			const needle = schemeLess(rawQuery.trim()).toLowerCase();
			if (needle.length === 0) return [];
			// The index key is three characters, so a SHORTER query names a SET of
			// buckets rather than one: iterate the bucket keys (cheap, and far fewer
			// than URLs) and let the candidate cap bound the walk inside them.
			const buckets: Array<Set<string>> = [];
			if (needle.length >= PREFIX_WIDTH) {
				const bucket = prefix.get(prefixKey(needle));
				if (bucket) buckets.push(bucket);
			} else {
				for (const [key, bucket] of prefix) {
					if (key.startsWith(needle)) buckets.push(bucket);
				}
			}
			if (buckets.length === 0) return [];
			const candidates: BrowserHistoryEntry[] = [];
			for (const bucket of buckets) {
				for (const url of bucket) {
					if (candidates.length >= HISTORY_STORE_MAX_CANDIDATES) break;
					if (!schemeLess(url).toLowerCase().startsWith(needle)) continue;
					const entry = byUrl.get(url);
					if (entry) candidates.push(entry);
				}
				if (candidates.length >= HISTORY_STORE_MAX_CANDIDATES) break;
			}
			candidates.sort(compareEntries(at));
			return candidates.slice(0, wanted);
		},

		size(): number {
			return byUrl.size;
		},

		clear(): void {
			byUrl.clear();
			byHost.clear();
			prefix.clear();
			// Immediate: "clear everything" that survives only until a crash is not a
			// clear the user can rely on.
			writeNow();
		},

		clearOrigin(rawOrigin): void {
			let parsed: URL;
			try {
				parsed = new URL(rawOrigin);
			} catch {
				return;
			}
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
			const origin = parsed.origin;
			for (const [url, entry] of [...byUrl.entries()]) {
				if (new URL(url).origin !== origin) continue;
				byUrl.delete(url);
				indexRemove(entry);
			}
			writeNow();
		},

		flush(): void {
			if (writeTimer !== null) writeNow();
		},
	};
}
