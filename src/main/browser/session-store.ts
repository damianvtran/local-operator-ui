import { rmSync } from "node:fs";
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
	try {
		const url = new URL(entry.url);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/** Sanitise one persisted tab, or null when nothing about it is restorable.
 *
 * Two things can shrink an entry list (a refused scheme, a malformed entry), so
 * the active index is RE-DERIVED rather than trusted: an index recorded against
 * a longer list would point past the end of the shorter one and Electron answers
 * `getEntryAtIndex` out of bounds with null. The entry the user was on is the one
 * worth keeping, so the index is mapped by counting the surviving entries at or
 * before it. */
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
		.filter(restorable);
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
	return {
		owner: candidate.owner === "agent" ? "agent" : "user",
		active: candidate.active === true,
		entries,
		activeIndex: Math.min(survivorsBefore, entries.length - 1),
	};
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
		const file = readJson<BrowserSessionFile>(path);
		if (!file) return [];
		if (file.version !== 1) {
			log(
				`[browser] ignoring ${path}: version ${String(file.version)} is not one this build writes`,
			);
			return [];
		}
		if (!Array.isArray(file.tabs)) return [];
		return file.tabs
			.map(saneTab)
			.filter((tab): tab is PersistedTab => tab !== null);
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
