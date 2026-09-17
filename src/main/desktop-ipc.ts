import {
	type BrowserWindow,
	type IpcMainInvokeEvent,
	ipcMain,
	shell,
} from "electron";
import type { DesktopResponse } from "../shared/desktop-contract";
import { SUBSCRIPTION_ID_PATTERN } from "../shared/desktop-contract";
import type { DesktopMediaResponse } from "./desktop-media";
import type { DesktopNotifier } from "./desktop-notifier";
import type { DesktopStreamRelay } from "./desktop-stream";
import { trustedDesktopFrame } from "./desktop-transport";

const OPERATION_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * The ops that owe a VISIBLE, FOCUSED window before they may be sent.
 *
 * A set rather than two chained comparisons, because the match is by op NAME
 * and the failure mode of a name-based gate is an op that is simply not
 * mentioned here: `attention.seen` shipped after `sessions.seen` and would
 * otherwise have been the one way to clear a pile of marks from a window the
 * user cannot see. Named individually rather than matched by prefix, since a
 * prefix would silently cover ops nobody decided to gate.
 */
const FOREGROUND_RECEIPT_OPS: ReadonlySet<string> = new Set([
	"sessions.seen",
	"attention.seen",
]);

/**
 * Wrap a desktop request sender so a read receipt requires native foreground.
 *
 * Applied to the sender ITSELF rather than inside the renderer IPC handler,
 * because `DesktopNotifier` holds its own reference to the same underlying
 * sender and calls it directly. Guarding only the IPC entry would leave that
 * path unguarded — harmless while the notifier emits nothing but
 * `sessions.watch` and `sessions.notified`, but it is exactly how a future
 * main-process caller would acquire an ungated `sessions.seen`.
 *
 * The guard is scoped to the READ-RECEIPT ops and names them individually:
 * `sessions.seen`, and `attention.seen` beside it. The bulk op rides the same
 * gate for the same reason the single one does — a receipt is a claim that a
 * human saw a result, and a hidden, occluded or minimised window has shown
 * nobody anything — and it has to be listed HERE rather than trusted to a
 * prefix or a loop, because the match is by op NAME: an op this function does
 * not name is an op that bypasses it, and the bulk op would otherwise be the
 * one way to clear a pile of marks from a window the user cannot see.
 *
 * `sessions.notified` must keep NOT being gated on it: it claims cross-surface
 * DELIVERY of a notification, which by definition fires when the window is not
 * in the foreground, so a foreground requirement there would refuse every
 * legitimate claim. The two watermarks are separate on purpose — a delivery
 * claim never marks anything read (docs/design/descriptive-notifications.md
 * 7.2).
 *
 * The renderer's own visibility test cannot establish this: an occluded,
 * hidden or minimized window still reports `visibilityState === "visible"` and
 * can hold document focus. Only main can see the real window.
 */
export function guardForegroundReceipts(
	window: () => BrowserWindow | null,
	send: (input: unknown) => Promise<DesktopResponse>,
): (input: unknown) => Promise<DesktopResponse> {
	return (input: unknown) => {
		if (
			input !== null &&
			typeof input === "object" &&
			"op" in input &&
			typeof input.op === "string" &&
			FOREGROUND_RECEIPT_OPS.has(input.op)
		) {
			const owner = window();
			if (
				!owner ||
				owner.isDestroyed() ||
				!owner.isVisible() ||
				owner.isMinimized() ||
				!owner.isFocused()
			) {
				// Not user-facing copy: the renderer treats a refusal as "not read
				// yet" and retries, so this text only ever reaches a log.
				return Promise.reject(
					new Error(
						"View this completion in the foreground before marking it read.",
					),
				);
			}
		}
		return send(input);
	};
}

/**
 * Settle the byte channel of the media relay to a view `Blob` accepts.
 *
 * Preload sends a structured-clone `Uint8Array`, but `BlobPart` admits only
 * views over a plain `ArrayBuffer` (`ArrayBufferView<ArrayBuffer>`), so the
 * ArrayBufferLike-vs-ArrayBuffer distinction the newer lib typings model has to
 * be resolved here -- at the untrusted boundary where the value arrives as
 * `unknown` -- rather than silenced with a cast at the `Blob` call site deeper
 * in, where nothing knows any more where the bytes came from. The renderer
 * cannot produce a `SharedArrayBuffer`-backed view (this app is not
 * cross-origin isolated), so one is refused as "no bytes" instead of being
 * copied into an ArrayBuffer-backed view that would misreport what was sent.
 */
function relayedBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (!(value instanceof Uint8Array)) return null;
	const { buffer, byteOffset, byteLength } = value;
	if (!(buffer instanceof ArrayBuffer)) return null;
	return new Uint8Array(buffer, byteOffset, byteLength);
}

export function registerDesktopIPC(
	window: () => BrowserWindow | null,
	expectedUrl: string,
	request: (input: unknown) => Promise<DesktopResponse>,
	streams?: () => DesktopStreamRelay,
	media?: (
		input: unknown,
		bytes: Uint8Array<ArrayBuffer> | null,
	) => Promise<DesktopMediaResponse>,
	notifier?: DesktopNotifier,
	noteLeftSession?: (sessionId: string) => void,
): void {
	const opened = new Map<string, string>();
	function authorize(event: IpcMainInvokeEvent): void {
		const owner = window();
		if (
			!owner ||
			owner.isDestroyed() ||
			event.sender !== owner.webContents ||
			event.senderFrame !== owner.webContents.mainFrame ||
			!trustedDesktopFrame(event.senderFrame.url, expectedUrl)
		) {
			throw new Error("This window cannot use desktop controls.");
		}
	}
	// Guarded here as well as at the sender: `registerDesktopIPC` is called with
	// the raw sender in some hosts (and in the contract tests), so the receipt
	// gate must not depend on the caller having wrapped it. Double application is
	// idempotent — the second check simply passes.
	const guarded = guardForegroundReceipts(window, request);
	ipcMain.handle("desktop-request", (event, input: unknown) => {
		authorize(event);
		return guarded(input);
	});
	// `/exit`: the window closes through the ordinary close path, so macOS
	// keep-alive behaviour applies unchanged in the shipped app. Nothing here
	// touches the backend: a closed window detaches its viewer and every
	// session's owner keeps running. One exception, and it is the other way
	// round from "keep alive": in a `headless` run there is exactly one window,
	// no user and nothing to reopen, so closing it ends the run (and with it the
	// backend this app owns) — see `window-all-closed` in `index.ts`. There is no
	// `beforeunload` handler in this renderer to consult either way.
	ipcMain.handle("desktop-close-window", (event) => {
		authorize(event);
		const owner = window();
		if (owner && !owner.isDestroyed()) owner.close();
	});
	// Watch-lease heartbeat. The renderer reports what it can see; main adds
	// whether it can really deliver a notification and forwards the lease.
	if (notifier) {
		ipcMain.handle("desktop-watch-heartbeat", (event, input: unknown) => {
			authorize(event);
			const args = input as {
				sessionId?: unknown;
				subscriptionId?: unknown;
				visible?: unknown;
				focused?: unknown;
			};
			if (
				typeof args?.sessionId !== "string" ||
				typeof args.subscriptionId !== "string" ||
				typeof args.visible !== "boolean" ||
				typeof args.focused !== "boolean"
			) {
				throw new Error("Invalid watch heartbeat.");
			}
			// A lease names a subscription the backend currently holds. Checked as a
			// SHAPE here, not just for being a string: this handler is the last gate
			// before an authenticated `POST .../watch`, and the backend rejects
			// anything but `[a-f0-9]{32}` with a 422. A malformed id is a lease for
			// a subscription that does not exist, so it is refused before the
			// round trip rather than earning a 422 the renderer cannot act on.
			if (!SUBSCRIPTION_ID_PATTERN.test(args.subscriptionId)) {
				throw new Error("No live event subscription to lease.");
			}
			return notifier.heartbeat(event.sender.id, {
				sessionId: args.sessionId,
				subscriptionId: args.subscriptionId,
				visible: args.visible,
				focused: args.focused,
			});
		});
		/*
		 * The renderer's pane has LEFT this conversation (review round 2, R2-4).
		 *
		 * A withdrawal, not a lease: the pane's watch stopped and its stream was
		 * unsubscribed, but the window is still open, so nothing else would ever
		 * clear the state that says this conversation is on screen. Checked as a
		 * SHAPE for the same reason the heartbeat is — this is the second entry point
		 * to the map the machine-wide presence reads.
		 *
		 * No round trip to the backend: the presence the backend sees is published by
		 * main's own feed beat, which reads this map, so clearing it here is enough
		 * and it cannot fail on a backend that is down (which is exactly when a pane
		 * navigates away to the catalogue).
		 */
		ipcMain.handle("desktop-watch-release", (event, input: unknown) => {
			authorize(event);
			const args = input as { sessionId?: unknown };
			if (typeof args?.sessionId !== "string") {
				throw new Error("Invalid watch release.");
			}
			notifier.releaseWatch(event.sender.id, args.sessionId);
			/*
			 * ...AND THE ROUTING RECORD, not only the presence (QA round 2, Q1).
			 * The presence map answers "may a banner interrupt this window"; the
			 * viewer record answers "which conversation should a click land on", and
			 * the withdrawal above only cleared the first. A click after navigating
			 * away from A was therefore answered with a raise: the record still named
			 * A, the backend read that as "already displayed", skipped
			 * `resume_session`, and reported success, so no later rung corrected it.
			 * Identity-safe and empty-id-safe on the record's side, so the deeper
			 * pane's report survives this cleanup.
			 */
			noteLeftSession?.(args.sessionId);
		});
	}
	// Binary/multipart media relay. Bytes arrive as a structured-clone
	// Uint8Array from preload; the response's bytes go back the same way.
	if (media) {
		ipcMain.handle("desktop-media", (event, input: unknown, bytes: unknown) => {
			authorize(event);
			const payload = relayedBytes(bytes);
			return media(input, payload);
		});
	}
	ipcMain.handle(
		"desktop-open-authorization",
		async (event, operationId: unknown, reopen: unknown = false) => {
			authorize(event);
			if (
				typeof operationId !== "string" ||
				!OPERATION_ID.test(operationId) ||
				typeof reopen !== "boolean"
			) {
				throw new Error("Invalid sign-in operation.");
			}
			// Fetch from the trusted backend, not a renderer-supplied URL. Even an
			// owned renderer cannot use this capability as a general shell opener.
			const response = await request({ op: "auth.status", id: operationId });
			const result = response.body as {
				result?: { auth_url?: unknown };
			} | null;
			const target = result?.result?.auth_url;
			if (response.status !== 200 || typeof target !== "string")
				throw new Error("This sign-in is no longer waiting for a browser.");
			const url = new URL(target);
			if (
				url.username ||
				url.password ||
				(url.protocol !== "https:" &&
					!(
						url.protocol === "http:" &&
						["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
					))
			) {
				throw new Error("The provider returned an invalid sign-in address.");
			}
			if (!reopen && opened.get(operationId) === target) return;
			opened.set(operationId, target);
			while (opened.size > 32)
				opened.delete(opened.keys().next().value as string);
			try {
				await shell.openExternal(target);
			} catch {
				opened.delete(operationId);
				throw new Error("The sign-in page could not be opened. Try again.");
			}
		},
	);

	// Authenticated session event streaming. Frames flow main -> the OWNED
	// window's webContents only; the renderer never sees the bearer, and a
	// stream dies with its subscription rather than leaking frames after the
	// consumer is gone.
	if (streams) {
		ipcMain.handle("desktop-stream-subscribe", (event, args: unknown) => {
			authorize(event);
			const input = args as {
				sessionId?: unknown;
				epoch?: unknown;
				afterSeq?: unknown;
			};
			if (
				typeof input?.sessionId !== "string" ||
				(input.epoch !== undefined && typeof input.epoch !== "string") ||
				(input.afterSeq !== undefined && typeof input.afterSeq !== "number")
			) {
				throw new Error("Invalid stream subscription.");
			}
			const sender = event.sender;
			const relay = streams();
			const handle = relay.subscribe(
				{
					sessionId: input.sessionId,
					epoch: input.epoch as string | undefined,
					afterSeq: input.afterSeq as number | undefined,
				},
				(frame) => {
					if (sender.isDestroyed()) {
						relay.unsubscribe(handle.streamId);
						return;
					}
					sender.send("desktop-stream-event", frame);
				},
			);
			return handle;
		});
		ipcMain.handle("desktop-stream-unsubscribe", (event, streamId: unknown) => {
			authorize(event);
			if (typeof streamId === "string") streams().unsubscribe(streamId);
		});
	}
}
