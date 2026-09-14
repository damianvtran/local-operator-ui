/**
 * The structural views of Electron this feature depends on.
 *
 * WHY these exist rather than importing Electron's classes directly: the driver's
 * invariants (a token that is the capability, a per-tab lane, epoch-stamped refs,
 * fail-closed handles, the origin gate) are the parts worth testing, and none of
 * them need a real Chromium. Declaring the minimum shape each module reads lets
 * `scripts/browser-host.test.mjs` drive the shipped code with a fake view built
 * from an event emitter — the same in-memory-bundle approach the repo's other
 * desktop tests use, applied to the one subsystem that would otherwise need a
 * browser to test at all.
 *
 * Type-only: nothing here is emitted at runtime, and `index.ts` is the only place
 * that constructs the real objects.
 */

/** The subset of Electron's `Debugger` the CDP pool uses. */
export interface DebuggerLike {
	attach(protocolVersion?: string): void;
	detach(): void;
	isAttached(): boolean;
	sendCommand(
		method: string,
		commandParams?: Record<string, unknown>,
	): Promise<unknown>;
	on(
		event: "message",
		listener: (event: unknown, method: string, params?: object) => void,
	): void;
	on(event: "detach", listener: (event: unknown, reason: string) => void): void;
	removeListener?(event: string, listener: (...args: never[]) => void): void;
}

/** The subset of `WebContents` the driver uses. */
export interface DriveableWebContents {
	readonly id: number;
	readonly debugger: DebuggerLike;
	isDestroyed(): boolean;
	getURL(): string;
	getTitle(): string;
	loadURL(url: string): Promise<void>;
	/** Destroy the webContents. Required on EVERY tab close: with
	 * `WebContentsView` nothing destroys it for you (design 11.1). */
	close(): void;
	/** Run a script in an ISOLATED world, so a page cannot observe or interfere
	 * with the agent's read (design 4, the `read` row). */
	executeJavaScriptInIsolatedWorld(
		worldId: number,
		scripts: Array<{ code: string }>,
		userGesture?: boolean,
	): Promise<unknown>;
	on(event: string, listener: (...args: never[]) => void): unknown;
	removeListener(event: string, listener: (...args: never[]) => void): unknown;
	/** Present on a real `WebContents`; optional so a fake view in a test does not
	 * have to model history to exercise the registry. Callers guard for it. */
	navigationHistory?: NavigationHistoryLike;
	reload(): void;
	stop(): void;
	isLoading(): boolean;
}

/** One entry of a restore-able navigation stack, structurally: Electron's
 * `NavigationEntry` (`url`, `title`, and the optional base64 `pageState`). */
export interface NavigationEntryLike {
	url: string;
	title?: string;
	pageState?: string;
}

/**
 * The subset of Electron's `NavigationHistory` this feature uses.
 *
 * The three entries-related members are OPTIONAL, and that is deliberate: the
 * back/forward controls only need the four navigation members, so a fake view in
 * a test (`scripts/browser-host.test.mjs`) can drive the registry without
 * modelling history at all. The restore path guards for their absence and falls
 * back to a plain `loadURL` of the entry the run was on, which is the honest
 * degradation: a view that cannot replay a stack can still be put back on the
 * page, and refusing to restore anything would lose the tab entirely.
 *
 * The deprecated `contents.canGoBack()`/`goBack()` pair is deliberately absent
 * (design 6.1): Electron 44 documents that these "should use the new
 * `contents.navigationHistory.…` API" instead.
 */
export interface NavigationHistoryLike {
	canGoBack(): boolean;
	canGoForward(): boolean;
	goBack(): void;
	goForward(): void;
	length(): number;
	getAllEntries?(): NavigationEntryLike[];
	getActiveIndex?(): number;
	restore?(options: {
		entries: NavigationEntryLike[];
		index?: number;
	}): Promise<void>;
}

/** The subset of `WebContentsView` the tab registry uses. */ export interface DriveableView {
	setBounds(rect: {
		x: number;
		y: number;
		width: number;
		height: number;
	}): void;
	setVisible(visible: boolean): void;
	/** Optional so a fake view in a test need not model geometry. The driver reads
	 * it to explain a capture that cannot happen (see `screenshot`). */
	getBounds?(): { x: number; y: number; width: number; height: number };
	readonly webContents: DriveableWebContents;
}

/** The subset of `Session` the profile module uses beyond its own typings. */
export interface PermissionDetailsLike {
	requestingUrl?: string;
}
