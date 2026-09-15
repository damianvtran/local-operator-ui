import { rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	PRIVATE_DIR_MODE,
	PRIVATE_FILE_MODE,
	readJson,
	writeJsonAtomic,
} from "./atomic-json";
import type { TabOwner, TabRecord } from "./registry";

/**
 * Tab restore across restarts: the file, and the rules for reading it back.
 * Design: docs/design/ui-browser-tab.md 7.1 (the mechanism), 7.2 (where the
 * session state is stored), 7.3 (a restored tab and a stale agent handle).
 *
 * WHY this file exists at all: the operator asked for a browser "similar to my
 * personal browser", and Electron 44 ships a real mechanism for it —
 * `navigationHistory.restore({entries, index})`, documented as a best effort to
 * restore "not just the navigation stack but also the state of the individual
 * pages — for instance including HTML form values or the scroll position". A
 * hand-rolled "remember the URL" would lose the per-tab history depth and the
 * scroll position, which are the two things a restored tab is for.
 *
 * WHY the file is NOT inside the Chromium profile: the profile is what a user
 * clears when they want to log out of everything ("clear cookies and site
 * data"), and this file is policy plus convenience. Keeping them apart is what
 * lets "clear browsing data" and "forget my tabs" stay separate actions with
 * separate consequences (design 5.4, 7.2).
 *
 * THE ONE RULE THAT MUST NOT BE GOT WRONG (design 7.3, and the reason the
 * reader below is as suspicious as it is): a surface nonce is NEVER re-issued
 * across a restart. Every restored tab is created with a fresh `tabId` and NO
 * nonce, and is `owner: "user"` regardless of what it was before. So a session
 * that survives an app restart holds `ui:<oldTabId>:<oldNonce>`, its next
 * action fails the handle check, and the existing `tab_closed` → re-`open`
 * recovery applies — with no special-case code anywhere. Reading a stale nonce
 * back off disk and re-granting drive authority to whoever wrote the file is
 * precisely the fail-open the capability model exists to prevent, and this file
 * sits in `userData` where anything on the machine can read it. That is also why
 * NOTHING here reads or writes a nonce at all: the field does not exist in the
 * schema, so it cannot be restored by accident.
 */

/** The session file, beside the approvals store and the extensions directory. */
export const SESSION_FILENAME = "session.json";

/**
 * The largest session file this reader will parse at all.
 *
 * A file this size is already ~30x the biggest honest one (twenty tabs with fifty
 * entries each of a long URL), so refusing it costs a real user nothing and stops
 * the reader before `readJson` pulls an unbounded string into memory. The check is
 * on the file's SIZE rather than on its contents because the whole point is not to
 * read it: `session.json` lives in `userData`, so whatever is in that path is an
 * input this process did not write and must not trust (review round 1, R5).
 */
export const MAX_SESSION_FILE_BYTES = 4 * 1024 * 1024;

/**
 * How many tabs one restore pass may allocate.
 *
 * A CAP EXISTS HERE AND NOWHERE ELSE ON PURPOSE. Design 6.5 leaves user tabs
 * uncapped - "a user opening a dozen tabs is their business", and the honest bound
 * there is memory the user chose to spend. A restore is the opposite case: the app
 * spends that memory *at startup*, once per entry in a file anything on the machine
 * can write, before the host has served a single request. So this bounds the one
 * path where the app, not the user, decides how many real `WebContents` and
 * offscreen raster surfaces to create. Twenty is comfortably above a real session
 * and small enough that the worst case is a bounded startup, not a slow one.
 */
export const MAX_RESTORED_TABS = 20;

/**
 * History depth kept per restored tab.
 *
 * The stack is restored for its depth and its page state (design 7.1), but depth
 * is per-tab memory the user never asked to spend twice: a single tab can carry
 * thousands of entries after a session of browsing. Fifty is deeper than a user
 * reaches by hand and still bounds one tab to fifty URLs.
 */
export const MAX_RESTORED_ENTRIES = 50;

/** The longest URL this reader will restore. Longer than any real address, short
 * enough that a stack of them cannot be the reason a file is huge. */
export const MAX_RESTORED_URL_CHARS = 2048;

/**
 * The largest `pageState` blob kept for one entry.
 *
 * Chromium's page state - scroll position and form values - is base64, and it is
 * dropped rather than truncated when it exceeds this: half a serialised state is
 * not a partial restoration, it is a corrupt one. Dropping it costs the scroll
 * position of that one entry and leaves the URL, which is the part that makes the
 * tab restorable at all.
 */
export const MAX_RESTORED_PAGE_STATE_CHARS = 256 * 1024;

/** Re-exported so a test asserts the mode this module intends rather than a
 * number copied into the test. Both files sit under the same 0700 directory. */
export const SESSION_FILE_MODE = PRIVATE_FILE_MODE;
export const SESSION_DIR_MODE = PRIVATE_DIR_MODE;

/** One entry of a restored navigation stack.
 *
 * `pageState` is Chromium's own base64 page state — the scroll position and the
 * form values — passed back verbatim. This module never interprets it. */
export interface PersistedEntry {
	url: string;
	title?: string;
	pageState?: string;
}

/** One restored tab.
 *
 * NO `nonce` and NO `handedTo` (design 7.2, 7.3). `owner` is recorded for the
 * diagnostics and for nothing else: a restore always comes back `user`-owned,
 * because re-granting drive authority to whoever's token was on disk is the
 * fail-open the capability model exists to prevent. */
export interface PersistedTab {
	owner: TabOwner;
	active: boolean;
	entries: PersistedEntry[];
	activeIndex: number;
}

export interface BrowserSessionFile {
	version: 1;
	tabs: PersistedTab[];
}

/** How long a burst of tab changes is coalesced before it hits the disk. Long
 * enough that a page's redirect chain writes once, short enough that a crash a
 * second after a navigation still restores the tab. */
export const WRITE_DEBOUNCE_MS = 500;

/** Whether an entry may be restored: http(s) only, on a PARSED url.
 *
 * Deliberately stricter than `getAllEntries()`: a stack can carry `about:blank`
 * (what a new tab starts on) and, on a hostile page, something exotic whose only
 * purpose is to be reached again after a restart. The view's own `will-navigate`
 * refuses the same set (design 11.6), so this is the same policy applied one
 * layer earlier — a restore is a navigation, and it does not get to skip the
 * scheme rule by arriving from a file. */
function restorable(entry: PersistedEntry): boolean {
	if (typeof entry.url !== "string") return false;
	if (entry.url.length > MAX_RESTORED_URL_CHARS) return false;
	try {
		const url = new URL(entry.url);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/** Drop an entry's page state when it is too large to be worth carrying, keeping
 * the entry. See `MAX_RESTORED_PAGE_STATE_CHARS` for why it is dropped whole. */
function boundPageState(entry: PersistedEntry): PersistedEntry {
	if (
		typeof entry.pageState !== "string" ||
		entry.pageState.length <= MAX_RESTORED_PAGE_STATE_CHARS
	) {
		return entry;
	}
	const { pageState: _dropped, ...rest } = entry;
	return rest;
}

/**
 * Keep the deepest `MAX_RESTORED_ENTRIES` entries that still contain the entry the
 * tab was showing, and re-derive the index against what survives.
 *
 * A window around the active entry, not a prefix: a stack is restored so the user
 * can go BACK as well as land where they left off (design 7.1), and truncating to
 * the newest entries would leave the page they were on reachable only by typing it
 * in again. The quarter of the budget kept ahead of the active entry is what makes
 * Back work; the rest of the window is the way forward.
 */
function boundEntries(
	entries: PersistedEntry[],
	activeIndex: number,
): { entries: PersistedEntry[]; activeIndex: number } {
	if (entries.length <= MAX_RESTORED_ENTRIES) return { entries, activeIndex };
	const historyKept = Math.floor(MAX_RESTORED_ENTRIES / 4);
	const start = Math.max(
		0,
		Math.min(activeIndex - historyKept, entries.length - MAX_RESTORED_ENTRIES),
	);
	return {
		entries: entries.slice(start, start + MAX_RESTORED_ENTRIES),
		activeIndex: activeIndex - start,
	};
}

/** Sanitise one persisted tab, or null when nothing about it is restorable.
 *
 * Two things can shrink an entry list (a refused scheme, a malformed entry), so
 * the active index is RE-DERIVED rather than trusted: an index recorded against
 * a longer list would point past the end of the shorter one and Electron answers
 * `getEntryAtIndex` out of bounds with null. The entry the user was on is the one
 * worth keeping, so the index is mapped by counting the surviving entries at or
 * before it — and then bounded again by `boundEntries`, which keeps a window
 * around that entry inside the depth budget. */
function saneTab(raw: unknown): PersistedTab | null {
	if (!raw || typeof raw !== "object") return null;
	const candidate = raw as Partial<PersistedTab>;
	if (!Array.isArray(candidate.entries)) return null;
	const entries = candidate.entries
		.filter(
			(entry): entry is PersistedEntry =>
				!!entry &&
				typeof entry === "object" &&
				typeof (entry as PersistedEntry).url === "string",
		)
		.filter(restorable)
		.map(boundPageState);
	if (!entries.length) return null;
	const recorded =
		typeof candidate.activeIndex === "number" &&
		Number.isInteger(candidate.activeIndex) &&
		candidate.activeIndex >= 0
			? Math.min(
					candidate.activeIndex,
					(candidate.entries as unknown[]).length - 1,
				)
			: entries.length - 1;
	const survivorsBefore = (candidate.entries as unknown[])
		.slice(0, recorded)
		.filter(
			(entry): entry is PersistedEntry =>
				!!entry &&
				typeof entry === "object" &&
				typeof (entry as PersistedEntry).url === "string",
		)
		.filter(restorable).length;
	const bounded = boundEntries(
		entries,
		Math.min(survivorsBefore, entries.length - 1),
	);
	return {
		owner: candidate.owner === "agent" ? "agent" : "user",
		active: candidate.active === true,
		entries: bounded.entries,
		activeIndex: bounded.activeIndex,
	};
}

/**
 * Bound the SET of tabs one restore pass may allocate, keeping the tab the user
 * was looking at and the newest of the rest.
 *
 * TWO PROPERTIES, and both are the reason this is not a plain `.slice()`:
 *
 * - **The active tab survives.** Design 7.1 restores "which tab was the user
 *   looking at", so dropping it to hit a count would defeat the feature for the
 *   user with the most tabs - the one this cap can actually bite.
 * - **File order is preserved.** The strip is appended in creation order, and
 *   reordering the survivors to put the active tab first would shuffle the user's
 *   tab strip to make the arithmetic easier.
 */
function boundTabs(tabs: PersistedTab[]): {
	kept: PersistedTab[];
	dropped: number;
} {
	if (tabs.length <= MAX_RESTORED_TABS) return { kept: tabs, dropped: 0 };
	const activeIndex = tabs.findIndex((tab) => tab.active);
	// Indexes to keep: the active one when there is one, and the NEWEST of the
	// rest. `tabs` is in creation order, so the tail is the most recent.
	const keep = new Set<number>();
	if (activeIndex >= 0) keep.add(activeIndex);
	for (
		let index = tabs.length - 1;
		index >= 0 && keep.size < MAX_RESTORED_TABS;
		index -= 1
	) {
		keep.add(index);
	}
	const kept = tabs.filter((_tab, index) => keep.has(index));
	return { kept, dropped: tabs.length - kept.length };
}

/**
 * Read the restorable tabs, or an empty list.
 *
 * ONE `try`/`catch` around the whole read, and a log line rather than a throw
 * (design 7.2): "a failed restore must never block startup". A corrupt, missing
 * or future-versioned file therefore opens one blank tab, which is the same
 * state a first launch is in.
 */
export function readSession(
	path: string,
	log: (message: string) => void = () => {},
): PersistedTab[] {
	try {
		// SIZE FIRST, before `readJson` turns the file into a string. A path in
		// `userData` is writable by anything on the machine, and "how big can the
		// startup read be" must not be a number a file gets to choose (R5).
		const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
		if (size > MAX_SESSION_FILE_BYTES) {
			log(
				`[browser] ignoring ${path}: ${size} bytes is past the ${MAX_SESSION_FILE_BYTES}-byte restore budget`,
			);
			return [];
		}
		const file = readJson<BrowserSessionFile>(path);
		if (!file) return [];
		if (file.version !== 1) {
			log(
				`[browser] ignoring ${path}: version ${String(file.version)} is not one this build writes`,
			);
			return [];
		}
		if (!Array.isArray(file.tabs)) return [];
		// VALIDATE EVERY ENTRY BEFORE ANYTHING IS ALLOCATED, then bound the set. The
		// order matters: the count comes off sanitised rows, so a file of a thousand
		// unusable entries costs no view at all rather than a thousand rejects in the
		// host (R5).
		const sane = file.tabs
			.map(saneTab)
			.filter((tab): tab is PersistedTab => tab !== null);
		const { kept, dropped } = boundTabs(sane);
		if (dropped) {
			log(
				`[browser] restoring ${kept.length} of ${sane.length} recorded tabs; the newest ${kept.length} are kept, plus whichever tab was active`,
			);
		}
		return kept;
	} catch (error) {
		// Belt and braces around the belt and braces: `readJson` already swallows,
		// but a future reader added here must not be able to stop the app starting.
		log(`[browser] could not read ${path}: ${String(error)}`);
		return [];
	}
}

/**
 * Snapshot the live tabs.
 *
 * A tab whose webContents is already destroyed is SKIPPED rather than
 * substituted with an empty stack: a view between destruction and the
 * `destroyed` handler's own cleanup would otherwise be written as a blank tab,
 * which on the next launch is a tab the user never opened.
 *
 * `activeTabId` is passed in rather than read off each record because the
 * registry's active tab is one per window: "which tab was the user looking at"
 * is a property of the strip, and a per-record flag would let two records claim
 * it.
 */
export function captureTabs(
	records: readonly TabRecord[],
	activeTabId: number | null,
): PersistedTab[] {
	const captured: PersistedTab[] = [];
	for (const record of records) {
		const contents = record.view.webContents;
		if (contents.isDestroyed()) continue;
		const history = contents.navigationHistory;
		// No history API means nothing to snapshot: a fake view in a test has none,
		// and writing an empty stack for it would record a blank tab the user never
		// opened.
		if (!history?.getAllEntries || !history.getActiveIndex) continue;
		const entries = history.getAllEntries().map((entry) => ({
			url: entry.url,
			title: entry.title,
			...(entry.pageState ? { pageState: entry.pageState } : {}),
		}));
		if (!entries.some(restorable)) continue;
		captured.push({
			owner: record.owner,
			active: record.tabId === activeTabId,
			entries,
			activeIndex: Math.max(0, history.getActiveIndex()),
		});
	}
	return captured;
}

export interface BrowserSessionStoreOptions {
	/** The `userData/browser` directory: beside `approvals.json`. */
	dir: string;
	log?: (message: string) => void;
	/** The debounce, injectable so a test does not wait half a second. */
	debounceMs?: number;
	now?: () => number;
}

/**
 * The debounced writer.
 *
 * The write discipline is the one `atomic-json.ts` documents and
 * `browser_bridge/state.py:99-117` precedes (design 7.2 says to copy the pattern
 * *with its comment*): staged temp file, `rename(2)`, 0600 under a 0700
 * directory. The debounce exists because a single navigation produces several
 * events, and a redirect chain produces a dozen.
 */
export class BrowserSessionStore {
	private readonly path: string;
	private readonly log: (message: string) => void;
	private readonly debounceMs: number;
	private timer: NodeJS.Timeout | null = null;
	private pending: PersistedTab[] | null = null;

	constructor(options: BrowserSessionStoreOptions) {
		this.path = join(options.dir, SESSION_FILENAME);
		this.log = options.log ?? (() => {});
		this.debounceMs = options.debounceMs ?? WRITE_DEBOUNCE_MS;
	}

	get filePath(): string {
		return this.path;
	}

	/** Record the current tabs, to be written after the debounce. */
	record(tabs: PersistedTab[]): void {
		this.pending = tabs;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), this.debounceMs);
		// A pending write must not hold the process open: the app's lifetime is
		// decided by its window, exactly as the state file's heartbeat is.
		this.timer.unref?.();
	}

	/** Write now, if anything is pending. Called from the host's stop path, so a
	 * quit (or a window close, which stops the host) never loses the last change
	 * to a debounce that was still ticking. */
	flush(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const tabs = this.pending;
		this.pending = null;
		if (!tabs) return;
		const file: BrowserSessionFile = { version: 1, tabs };
		if (!writeJsonAtomic(this.path, file)) {
			this.log(
				`[browser] could not write the session file at ${this.path}; tabs will not be restored`,
			);
		}
	}

	/** Drop the file. Used when the restore decision is "not this time" — the
	 * session is policy, so a user who wants it gone gets it gone. */
	clear(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.pending = null;
		try {
			// `rmSync(force)` rather than `unlinkSync`: a missing file is the state
			// this asks for, not an error worth catching.
			rmSync(this.path, { force: true });
		} catch (error) {
			this.log(`[browser] could not remove ${this.path}: ${String(error)}`);
		}
	}
}
