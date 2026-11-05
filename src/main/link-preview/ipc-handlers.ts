/**
 * The two handlers behind the link-preview channels, and the validation they do
 * before anything is fetched.
 *
 * WHY THIS IS SEPARATE FROM `ipc.ts`. That file is the one place in the module
 * allowed to touch `electron`, and importing it evaluates the app's logger, which
 * creates and writes the operator's log directory on import (see `Logger`'s
 * constructor). A test that wants to prove "a refused sender is refused, a
 * malformed request never reaches a fetch, the channel names are the ones the
 * preload invokes" cannot import that. The decisions therefore live here, take
 * their collaborators as arguments, and import nothing at RUNTIME: `ipc.ts`
 * supplies Electron's `ipcMain`, the shared `isAdmittedSender` gate and the real
 * service.
 *
 * TWO RULES HOLD AT THIS BOUNDARY.
 *
 *  1. The sender is checked with the SAME `isAdmittedSender` every other main-owned
 *     surface uses (`desktop-ipc.ts`): main frame, the app's own window, that
 *     window's trusted document. A hostile frame that somehow acquired the preload
 *     is refused here rather than trusted because it reached an IPC channel.
 *  2. The handler ALWAYS RESOLVES. A refusal is one of the contract's states
 *     (`shared/link-preview.ts`), so the transcript renders a link with no card
 *     rather than an unhandled rejection. Only a programming error can still throw,
 *     and that is caught and turned into `{kind:"error", retryable:true}`.
 *
 * NO URL IS EVER LOGGED. These handlers log nothing; the service's lines are built
 * from the opaque preview id and a state only (`resolve.ts`, invariant 2).
 */

import type { IpcMainInvokeEvent } from "electron";
import {
	LINK_PREVIEW_IMAGE_CHANNEL,
	LINK_PREVIEW_RESOLVE_CHANNEL,
	type LinkPreviewArtifactKind,
	type LinkPreviewImageResult,
	type LinkPreviewResolveResult,
} from "../../shared/link-preview";
import type { LinkPreviewService } from "./resolve";

/**
 * Whether the event's sender may call these channels, as `ipc.ts` answers it with
 * `isAdmittedSender`. Injected rather than imported so the decision is testable
 * without an Electron module graph; the GATE ITSELF is the app-wide one and lives
 * in `desktop-ipc.ts`.
 */
export type LinkPreviewSenderGate = (
	event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">,
) => boolean;

export interface LinkPreviewHandlers {
	resolve(
		event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">,
		request: unknown,
	): Promise<LinkPreviewResolveResult>;
	image(
		event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">,
		request: unknown,
	): Promise<LinkPreviewImageResult>;
}

/** The `ipcMain` surface this module needs: Electron's, or a double in a test. */
export interface LinkPreviewIpcMain {
	handle(
		channel: string,
		listener: (event: IpcMainInvokeEvent, request: unknown) => Promise<unknown>,
	): void;
	removeHandler(channel: string): void;
}

/** The resolved command wire is validated here rather than trusted: `index` is a
 * position in a message and `url` is a string the renderer assembled. */
export function isResolveRequest(
	value: unknown,
): value is { url: string; index: number } {
	if (typeof value !== "object" || value === null) return false;
	const request = value as { url?: unknown; index?: unknown };
	return typeof request.url === "string" && typeof request.index === "number";
}

export function isImageRequest(
	value: unknown,
): value is { previewId: string; which: LinkPreviewArtifactKind } {
	if (typeof value !== "object" || value === null) return false;
	const request = value as { previewId?: unknown; which?: unknown };
	return (
		typeof request.previewId === "string" &&
		(request.which === "favicon" || request.which === "image")
	);
}

export function createLinkPreviewHandlers(options: {
	service: Pick<LinkPreviewService, "resolve" | "image">;
	admitted: LinkPreviewSenderGate;
}): LinkPreviewHandlers {
	const { service, admitted } = options;
	return {
		async resolve(event, request) {
			if (!admitted(event) || !isResolveRequest(request)) {
				// A refused sender gets the same shape a refusal gets: there is no
				// channel here for explaining who may not call it.
				return { kind: "absent", reason: "unsupported-scheme" };
			}
			try {
				return await service.resolve(request);
			} catch {
				return { kind: "error", retryable: true };
			}
		},
		async image(event, request) {
			if (!admitted(event) || !isImageRequest(request)) {
				return { kind: "error", code: "invalid-request", status: 400 };
			}
			try {
				return await service.image(request);
			} catch {
				return { kind: "error", code: "io", status: 500 };
			}
		},
	};
}

/**
 * Put both handlers on their channels, replacing whatever was there.
 *
 * `ipcMain.handle` THROWS for a channel that already has a handler, so the remove
 * comes first: that is what makes a second registration leave one handler per
 * channel rather than a duplicate or a throw.
 */
export function registerLinkPreviewHandlers(
	ipc: LinkPreviewIpcMain,
	handlers: LinkPreviewHandlers,
): void {
	ipc.removeHandler(LINK_PREVIEW_RESOLVE_CHANNEL);
	ipc.handle(LINK_PREVIEW_RESOLVE_CHANNEL, handlers.resolve);
	ipc.removeHandler(LINK_PREVIEW_IMAGE_CHANNEL);
	ipc.handle(LINK_PREVIEW_IMAGE_CHANNEL, handlers.image);
}
