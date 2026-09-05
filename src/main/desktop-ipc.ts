import {
	type BrowserWindow,
	type IpcMainInvokeEvent,
	ipcMain,
	shell,
} from "electron";
import type { DesktopResponse } from "../shared/desktop-contract";
import type { DesktopMediaResponse } from "./desktop-media";
import type { DesktopStreamRelay } from "./desktop-stream";
import { trustedDesktopFrame } from "./desktop-transport";

const OPERATION_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function registerDesktopIPC(
	window: () => BrowserWindow | null,
	expectedUrl: string,
	request: (input: unknown) => Promise<DesktopResponse>,
	streams?: DesktopStreamRelay,
	media?: (
		input: unknown,
		bytes: Uint8Array | null,
	) => Promise<DesktopMediaResponse>,
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
	ipcMain.handle("desktop-request", (event, input: unknown) => {
		authorize(event);
		return request(input);
	});
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
			const handle = streams.subscribe(
				{
					sessionId: input.sessionId,
					epoch: input.epoch as string | undefined,
					afterSeq: input.afterSeq as number | undefined,
				},
				(frame) => {
					if (sender.isDestroyed()) {
						streams.unsubscribe(handle.streamId);
						return;
					}
					sender.send("desktop-stream-event", frame);
				},
			);
			return handle;
		});
		ipcMain.handle("desktop-stream-unsubscribe", (event, streamId: unknown) => {
			authorize(event);
			if (typeof streamId === "string") streams.unsubscribe(streamId);
		});
	}
}
