import { BrowserHostError } from "./errors";
import {
	hasLogCapture,
	routeDebuggerEvent,
	startLogCapture,
	stopLogCapture,
} from "./log-capture";
import { WEB_CONTENTS_DEADLINE_MS } from "./policy/adapter";
import {
	CDP_ATTACH_DEADLINE_MS,
	CDP_DEADLINE_MS,
	deadline,
} from "./vendor/driver/deadline";

/**
 * The CDP driver: one `webContents.debugger` attachment per driven view.
 * Design: docs/design/ui-browser-tab.md 4 (the capability matrix), 12.1 (the
 * substitution table), 11.5.
 *
 * WHY the debugger rather than the app's own APIs: the design's matrix assigns
 * every action to CDP for a reason in each row, and the two load-bearing ones are
 * - `read` uses `executeJavaScriptInIsolatedWorld`, not `executeJavaScript`: the
 *   main world would let a page observe and interfere with the agent's reads,
 *   and the isolated world is the closest Electron equivalent of the extension's
 *   `ISOLATED` world injection;
 * - `screenshot` uses `Page.captureScreenshot`, not `capturePage`: `capturePage`
 *   has visibility-forcing semantics ("the page is considered visible when its
 *   browser window is hidden and the capturer count is non-zero"), which would
 *   make a hidden-tab capture change what the page renders. CDP capture sidesteps
 *   the question entirely and returns the same base64 shape Python already
 *   validates with `PNG_MAGIC`.
 *
 * THE THREE FAILURE SHAPES THIS MODULE OWNS, all copied from the extension's
 * `cdp.ts` because the semantics differ but the traps do not:
 *
 * 1. DevTools attaching to a driven view DETACHES our session (Electron's
 *    documented behaviour), where the extension's equivalent REFUSES the attach.
 *    So the conflict arrives asynchronously, as a `detach` event, and every
 *    later command must fail with `debugger_conflict` rather than a mystery
 *    stall on a session that no longer exists.
 * 2. A second `attach` on a view we already hold throws "Another debugger is
 *    already attached", which is indistinguishable by string from a foreign
 *    attachment. The resolution is the extension's: probe with a real CDP
 *    command; if it answers, the surviving attachment is ours and we adopt it
 *    silently.
 * 3. A view that closed under us must fail the action as `tab_closed` (the
 *    handle is gone) rather than as an internal error, because the session's
 *    recovery differs: `tab_closed` means "re-open".
 */

/** The subset of Electron's `Debugger` this module uses. Structural, so the
 * driver is testable without a real Chromium. */
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

/** The subset of `WebContents` this module uses. */
export interface CdpContents {
	id: number;
	debugger: DebuggerLike;
	isDestroyed(): boolean;
	getURL(): string;
	loadURL(url: string): Promise<void>;
}

/** The debugger event handlers for ONE attachment.
 *
 * Held on the record rather than left anonymous in `attach()` because
 * `Debugger` is the SAME object across a detach/re-attach cycle (the design's
 * 10.6 DevTools case, which this PR's own evidence transcript contains): a
 * second `attach()` that registered a second pair without removing the first
 * left both live, so `logs` returned every console line twice and every
 * `CdpPool.subscribe` consumer — the origin gate's `Fetch.requestPaused`
 * handler included — was invoked once per stale listener (R2). */
interface AttachmentListeners {
	message: (event: unknown, method: string, params?: object) => void;
	detach: (event: unknown, reason: string) => void;
}

interface Attachment {
	contents: CdpContents;
	/** Set when Electron detached us (DevTools took the target). `null` while the
	 * attachment is ours and live. */
	detachedReason: string | null;
	/** The pair registered on this view's debugger, removed before the record is
	 * replaced or dropped so the count never grows. */
	listeners: AttachmentListeners;
}

const PROTOCOL_VERSION = "1.3";

/** Chromium's refusal when a debugger is already attached to the target. Electron
 * surfaces it as an exception whose message contains one of these; matched
 * because that is the only signal the API gives. */
const ALREADY_ATTACHED = /another debugger|already attached/i;

export interface CdpPoolOptions {
	/** Called for anything worth putting in the app log. */
	log?: (message: string) => void;
}

/**
 * The pool of debugger attachments, keyed by webContents id.
 *
 * One instance per host (not module-global state): the registry's tabs and these
 * attachments must be creatable and destroyable together, and a module-level map
 * is how a test or a second host instance inherits a stale attachment.
 */
export class CdpPool {
	private readonly attachments = new Map<number, Attachment>();
	/** Per-view CDP event subscribers, by webContents id. See `subscribe`. */
	private readonly subscribers = new Map<
		number,
		Set<(method: string, params: Record<string, unknown>) => void>
	>();

	constructor(private readonly options: CdpPoolOptions = {}) {}

	/**
	 * Observe this view's CDP events for as long as the returned function has not
	 * been called.
	 *
	 * Needed because the driver has exactly ONE event source (`debugger`'s
	 * `message`) and two things want to read it: the log ring buffer, which wants
	 * everything for the tab's whole life, and a per-navigation gate, which wants
	 * `Fetch.requestPaused` only while an agent navigation is in flight. A second
	 * `on('message')` registration per use would leak listeners on a view that is
	 * driven for hours; this is a set that is emptied by the caller.
	 */
	subscribe(
		webContentsId: number,
		handler: (method: string, params: Record<string, unknown>) => void,
	): () => void {
		let listeners = this.subscribers.get(webContentsId);
		if (!listeners) {
			listeners = new Set();
			this.subscribers.set(webContentsId, listeners);
		}
		listeners.add(handler);
		return () => {
			listeners.delete(handler);
			if (listeners.size === 0) this.subscribers.delete(webContentsId);
		};
	}

	private routeEvent(
		webContentsId: number,
		method: string,
		params: Record<string, unknown>,
	): void {
		routeDebuggerEvent(webContentsId, method, params);
		for (const listener of [...(this.subscribers.get(webContentsId) ?? [])]) {
			listener(method, params);
		}
	}

	/** Whether this view currently has a live attachment. */
	isAttached(webContentsId: number): boolean {
		const attachment = this.attachments.get(webContentsId);
		return !!attachment && attachment.detachedReason === null;
	}

	/**
	 * Attach to a view, or adopt the attachment we already hold.
	 *
	 * Enables `Runtime` and `Log` on the way in. That is part of attach rather
	 * than of `logs` because `logs` is defined as "everything since the surface
	 * opened" — enabling lazily would silently lose exactly the early console
	 * error that a debugging session is looking for.
	 */
	async attach(contents: CdpContents): Promise<void> {
		if (contents.isDestroyed()) {
			throw new BrowserHostError("tab_closed", "that browser tab is gone");
		}
		const existing = this.attachments.get(contents.id);
		if (existing && existing.detachedReason === null) return;
		// A detached record is being replaced: its listeners are still registered on
		// this same `Debugger`, so they go first (see `AttachmentListeners`).
		if (existing) this.releaseListeners(existing);

		// Give the view a document BEFORE attaching.
		//
		// Measured, not assumed: Chromium does not create a renderer process for a
		// fresh `WebContents` until it navigates, and CDP commands to a target with no
		// renderer never get a reply — `Runtime.enable` on a brand-new view timed out
		// at 8 s and answered in 9 s only because the load finally happened. So a view
		// that has never navigated is not drivable, and `about:blank` is the
		// pre-navigation document the design already specifies for `open`
		// (`commands/nav.ts:179` does the same in the extension). `getURL()` is empty
		// exactly until the first navigation.
		if (!contents.getURL()) {
			await deadline(
				contents.loadURL("about:blank"),
				WEB_CONTENTS_DEADLINE_MS,
				"loadURL(about:blank)",
			);
		}

		try {
			contents.debugger.attach(PROTOCOL_VERSION);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!ALREADY_ATTACHED.test(message)) {
				throw new BrowserHostError(
					"internal",
					`could not attach to the page: ${message}`,
				);
			}
			// Someone is attached. Probe: only OUR surviving attachment answers a
			// trivial command, and adopting it is what makes a re-driven view work
			// after a detach/attach cycle instead of reporting a conflict that does
			// not exist.
			const ours = await this.probeOwnAttachment(contents);
			if (!ours) {
				throw new BrowserHostError(
					"debugger_conflict",
					"DevTools is attached to the driven tab; close it and retry",
				);
			}
		}

		const messageListener: AttachmentListeners["message"] = (
			_event,
			method,
			params,
		) => {
			this.routeEvent(
				contents.id,
				method,
				(params ?? {}) as Record<string, unknown>,
			);
		};
		const detachListener: AttachmentListeners["detach"] = (_event, reason) => {
			// Deliberately does NOT delete the attachment: the entry is what lets a
			// later command explain itself ("DevTools took the target") instead of
			// reporting a generic stall. It is removed by `detach`/`forget`.
			attachment.detachedReason = reason || "detached";
			this.options.log?.(
				`[browser] debugger detached from view ${contents.id}: ${reason}`,
			);
		};
		const attachment: Attachment = {
			contents,
			detachedReason: null,
			listeners: { message: messageListener, detach: detachListener },
		};
		this.attachments.set(contents.id, attachment);
		contents.debugger.on("message", messageListener);
		contents.debugger.on("detach", detachListener);

		if (!hasLogCapture(contents.id)) startLogCapture(contents.id);
		try {
			await this.sendTo(contents, "Runtime.enable", {}, CDP_DEADLINE_MS);
			await this.sendTo(contents, "Log.enable", {}, CDP_DEADLINE_MS);
			// MEASURED, and the reason this line is load-bearing rather than hygiene:
			// on a view whose page has no focus — which every agent tab is, because the
			// app never raises a window — `Input.insertText` delivers the text but NEVER
			// REPLIES to the CDP command. The probe: insertText on an unfocused view
			// timed out at 8 s while the field's value still changed to "alpha"; after
			// `Emulation.setFocusEmulationEnabled(true)` the same command answered in
			// 9 ms. So without this, every `type` that reached the primary path burned
			// its whole ceiling and reported a stall for work that had actually
			// happened. Focus emulation makes the page believe it is focused, which is
			// what an interactive browser does — the alternative (driving the value
			// setter directly) stays as the fallback for fields that ignore insertText.
			await this.sendTo(
				contents,
				"Emulation.setFocusEmulationEnabled",
				{
					enabled: true,
				},
				CDP_DEADLINE_MS,
			);
		} catch (error) {
			// A view that closed between attach and enable is not an attach failure
			// worth keeping the attachment for.
			this.forget(contents.id);
			throw error;
		}
	}

	/** A bounded, catch-all probe: a view that does not answer is one we cannot
	 * drive, so `false` (⇒ a real conflict) is the answer this exists to give. */
	private async probeOwnAttachment(contents: CdpContents): Promise<boolean> {
		try {
			await deadline(
				contents.debugger.sendCommand("Runtime.evaluate", { expression: "1" }),
				CDP_ATTACH_DEADLINE_MS,
				`Runtime.evaluate probe on view ${contents.id}`,
			);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Send one CDP command on a view, with the ordinary ceiling.
	 *
	 * The refusals are the interesting part: a destroyed view is `tab_closed` (the
	 * session's recovery is `open`) and a view that was never attached is
	 * `tab_closed` too — an action that skipped `attach` is a bug in this host, and
	 * reporting it as anything the agent could act on would be a lie.
	 */
	async send<T = unknown>(
		contents: CdpContents,
		method: string,
		params: Record<string, unknown> = {},
		options: { deadlineMs?: number } = {},
	): Promise<T> {
		if (contents.isDestroyed()) {
			this.forget(contents.id);
			throw new BrowserHostError(
				"tab_closed",
				"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab",
			);
		}
		return this.sendTo<T>(
			contents,
			method,
			params,
			options.deadlineMs ?? CDP_DEADLINE_MS,
		);
	}

	private async sendTo<T>(
		contents: CdpContents,
		method: string,
		params: Record<string, unknown>,
		deadlineMs: number,
	): Promise<T> {
		const attachment = this.attachments.get(contents.id);
		if (!attachment) {
			throw new BrowserHostError(
				"tab_closed",
				"that browser tab is not being driven; use 'open' to start a new tab",
				{ reason: "not_attached" },
			);
		}
		if (attachment.detachedReason !== null) {
			throw new BrowserHostError(
				"debugger_conflict",
				"DevTools is attached to the driven tab; close it and retry",
				{ reason: attachment.detachedReason },
			);
		}
		return deadline(
			contents.debugger.sendCommand(method, params) as Promise<T>,
			deadlineMs,
			method,
		);
	}

	/** Remove this attachment's debugger listeners. Called before the record is
	 * replaced by a re-`attach` and before it is dropped, so a view is never left
	 * with a pair nobody owns — a stale one would deliver every event once per
	 * attach cycle to `routeEvent` (and so to every subscriber). */
	private releaseListeners(attachment: Attachment): void {
		// `removeListener` is optional in `DebuggerLike` only because a test double
		// need not implement it; the real `Debugger` (an EventEmitter) always does.
		attachment.contents.debugger.removeListener?.(
			"message",
			attachment.listeners.message,
		);
		attachment.contents.debugger.removeListener?.(
			"detach",
			attachment.listeners.detach,
		);
	}

	/** Drop the attachment record and its log buffer, without talking to the view.
	 * Used when the view is already gone. */
	forget(webContentsId: number): void {
		const attachment = this.attachments.get(webContentsId);
		if (attachment) this.releaseListeners(attachment);
		this.attachments.delete(webContentsId);
		this.subscribers.delete(webContentsId);
		stopLogCapture(webContentsId);
	}

	/** Detach cleanly: release the debugger session and the log buffer. */
	async detach(webContentsId: number): Promise<void> {
		const attachment = this.attachments.get(webContentsId);
		if (attachment) this.releaseListeners(attachment);
		this.attachments.delete(webContentsId);
		this.subscribers.delete(webContentsId);
		stopLogCapture(webContentsId);
		if (!attachment) return;
		try {
			if (attachment.contents.debugger.isAttached()) {
				await deadline(
					Promise.resolve(attachment.contents.debugger.detach()),
					CDP_ATTACH_DEADLINE_MS,
					`debugger detach on view ${webContentsId}`,
				);
			}
		} catch {
			// Idempotent by design: a view that closed already achieved the same
			// thing, and a detach that cannot complete must not park a close.
		}
	}

	/** Detach everything. Called on host stop and on app quit. */
	async close(): Promise<void> {
		for (const id of [...this.attachments.keys()]) await this.detach(id);
	}
}
