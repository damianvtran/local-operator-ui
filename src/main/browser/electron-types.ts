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

/** The subset of Electron's `DownloadItem` the download path reads and drives.
 *
 * Structural, like everything else in this file, so `scripts/browser-host.test.mjs`
 * can drive the arm-gated save path with a fake item and a real temp directory —
 * the save path, the uniquifier, the name refusal and the read-back comparison
 * are the parts worth testing, and none of them need Chromium's download stack.
 *
 * `once` rather than `on`: the capture attaches exactly one `done` listener per
 * item and the item is discarded with it. `updated` is the exception and gets a
 * real `on`: a response that declares no length is bounded from that event (design
 * §10.3, review round 1 B1), and a bound that can fire once is not a bound. */
export interface DownloadItemLike {
	getFilename(): string;
	getURL(): string;
	getMimeType(): string;
	/** Total size, or -1 when the response declares none. The cap is enforced
	 * BEFORE the write when this is known and WHILE it is written when it is not. */
	getTotalBytes(): number;
	getReceivedBytes(): number;
	setSavePath(path: string): void;
	getSavePath(): string;
	cancel(): void;
	/** `progressing` | `completed` | `cancelled` | `interrupted`. Read by the
	 * cancel paths: only a `progressing` item is one this host can still stop. */
	getState(): string;
	once(
		event: "done",
		listener: (event: unknown, state: string) => void,
	): unknown;
	/** Fired as the bytes arrive, with the state as the second argument. */
	on(
		event: "updated",
		listener: (event: unknown, state: string) => void,
	): unknown;
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
	/** Human page controls only; never exposed through the agent protocol. */
	findInPage?(
		text: string,
		options: { forward: boolean; findNext: boolean },
	): number;
	stopFindInPage?(action: "clearSelection"): void;
	setZoomMode?(mode: "isolated"): void;
	setZoomFactor?(factor: number): void;
	getZoomFactor?(): number;
	/** Per-tab audio (LOH-13 slice C). Optional for the same reason as the
	 * zoom members: a fake view in a test need not model sound. Real
	 * Electron signatures: `isCurrentlyAudible(): boolean`,
	 * `isAudioMuted(): boolean`, `setAudioMuted(muted: boolean): void`, plus
	 * the `audio-state-changed` event carrying `{ audible: boolean }`. */
	isCurrentlyAudible?(): boolean;
	isAudioMuted?(): boolean;
	setAudioMuted?(muted: boolean): void;
	/** Human print (LOH-13 slice C). Electron's
	 * `print(options?: WebContentsPrintOptions, callback?: (success,
	 * failureReason) => void)`. `silent` must stay false on the human path:
	 * the person printing expects the OS print dialog. */
	print?(
		options: { silent?: boolean; printBackground?: boolean },
		callback?: (success: boolean, failureReason: string) => void,
	): void;
	reload(): void;
	reloadIgnoringCache?(): void;
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
	/** Indexed read, required where the full stack is not. Address suggestions
	 * read a bounded window around the active index instead of allocating
	 * `getAllEntries()` for a history that may be arbitrarily deep (the same reason
	 * Electron exposes it). Test fakes that define `navigationHistory` supply it;
	 * a view that has none keeps `navigationHistory` absent altogether. */
	getEntryAtIndex(index: number): NavigationEntryLike | undefined;
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
	/** Optional for the same reason as `getBounds`. Production is a
	 * `WebContentsView`, whose native visibility is what the S1 probe reports. */
	getVisible?(): boolean;
	readonly webContents: DriveableWebContents;
}

/** The subset of `Session` the profile module uses beyond its own typings. */
export interface PermissionDetailsLike {
	requestingUrl?: string;
}
