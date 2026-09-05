import {
	type BrowserWindow,
	type IpcMainInvokeEvent,
	ipcMain,
	shell,
} from "electron";
import type { DesktopResponse } from "../shared/desktop-contract";
import { trustedDesktopFrame } from "./desktop-transport";

const OPERATION_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function registerDesktopIPC(
	window: () => BrowserWindow | null,
	expectedUrl: string,
	request: (input: unknown) => Promise<DesktopResponse>,
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
}
