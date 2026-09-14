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
	navigationHistory?: {
		canGoBack(): boolean;
		canGoForward(): boolean;
		goBack(): void;
		goForward(): void;
		length(): number;
	};
	reload(): void;
	stop(): void;
	isLoading(): boolean;
}

/** The subset of `WebContentsView` the tab registry uses. */
export interface DriveableView {
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
