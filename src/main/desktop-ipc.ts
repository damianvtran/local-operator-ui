import {
	type BrowserWindow,
	type IpcMainInvokeEvent,
	ipcMain,
	shell,
} from "electron";
import type { DesktopResponse } from "../shared/desktop-contract";
import type { DesktopMediaResponse } from "./desktop-media";
import type { DesktopNotifier } from "./desktop-notifier";
import type { DesktopStreamRelay } from "./desktop-stream";
import { trustedDesktopFrame } from "./desktop-transport";

const OPERATION_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Wrap a desktop request sender so a read receipt requires native foreground.
 *
 * Applied to the sender ITSELF rather than inside the renderer IPC handler,
 * because `DesktopNotifier` holds its own reference to the same underlying
 * sender and calls it directly. Guarding only the IPC entry would leave that
 * path unguarded — harmless while the notifier emits nothing but
 * `sessions.watch`, but it is exactly how a future main-process caller would
 * acquire an ungated `sessions.seen`.
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
			input.op === "sessions.seen"
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

export function registerDesktopIPC(
	window: () => BrowserWindow | null,
	expectedUrl: string,
	request: (input: unknown) => Promise<DesktopResponse>,
	streams?: () => DesktopStreamRelay,
	media?: (
		input: unknown,
		bytes: Uint8Array | null,
	) => Promise<DesktopMediaResponse>,
	notifier?: DesktopNotifier,
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
	// `/exit`: the window closes through the ordinary close path, so the
	// renderer's `beforeunload` guard and macOS keep-alive behaviour apply
	// unchanged. Nothing here touches the backend: a closed window detaches
	// its viewer and every session's owner keeps running.
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
			return notifier.heartbeat(event.sender.id, {
				sessionId: args.sessionId,
				subscriptionId: args.subscriptionId,
				visible: args.visible,
				focused: args.focused,
			});
		});
	}
	// Binary/multipart media relay. Bytes arrive as a structured-clone
	// Uint8Array from preload; the response's bytes go back the same way.
	if (media) {
		ipcMain.handle("desktop-media", (event, input: unknown, bytes: unknown) => {
			authorize(event);
			const payload =
				bytes instanceof Uint8Array
					? bytes
					: bytes instanceof ArrayBuffer
						? new Uint8Array(bytes)
						: null;
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
