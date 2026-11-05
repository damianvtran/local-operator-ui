/**
 * The two IPC channels the renderer's cards use, and the one place the module
 * meets Electron.
 *
 * WHY DEDICATED CHANNELS rather than the desktop-request proxy: this is not a
 * request to the managed backend, it is a request to a THIRD PARTY from the user's
 * own machine, and it must be gated by its own rules (SSRF, caps, sniffing) rather
 * than by a backend route table. Naming the channels `link-preview:*` keeps that
 * visible in a stack trace.
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
 * NO URL IS EVER LOGGED. The logger callback receives the service's own lines, which
 * are built from the opaque preview id and a state only (`resolve.ts`, invariant 2).
 */

import * as dns from "node:dns/promises";
import { join } from "node:path";
import { type BrowserWindow, ipcMain } from "electron";
import type {
	LinkPreviewArtifactKind,
	LinkPreviewImageResult,
	LinkPreviewResolveResult,
} from "../../shared/link-preview";
import { LogFileType, logger } from "../backend/logger";
import { isAdmittedSender } from "../desktop-ipc";
import { createLinkPreviewCache } from "./cache";
import { nodeHop } from "./http-transport";
import { createLinkPreviewService } from "./resolve";
import type { LookupAll, ResolvedAddress } from "./ssrf";

export const LINK_PREVIEW_RESOLVE_CHANNEL = "link-preview:resolve";
export const LINK_PREVIEW_IMAGE_CHANNEL = "link-preview:image";

/** `dns.promises.lookup` in the all-addresses form `ssrf.ts` consumes. The cast is
 * the shape of Node's overloads, not a widening of what is asked for: the options
 * below are exactly `{ all: true, verbatim: true }`. */
const lookupAll: LookupAll = async (hostname) =>
	(await dns.lookup(hostname, {
		all: true,
		verbatim: true,
	})) as ResolvedAddress[];

let registered = false;

/**
 * Where the cache lives. `userData/cache/link-previews`, app-controlled: never a
 * user-chosen directory and never shared with another app's data.
 */
export function linkPreviewCacheDirectory(userDataDir: string): string {
	return join(userDataDir, "cache", "link-previews");
}

/** The resolved command wire is validated here rather than trusted: `index` is a
 * position in a message and `url` is a string the renderer assembled. */
function isResolveRequest(
	value: unknown,
): value is { url: string; index: number } {
	if (typeof value !== "object" || value === null) return false;
	const request = value as { url?: unknown; index?: unknown };
	return typeof request.url === "string" && typeof request.index === "number";
}

function isImageRequest(
	value: unknown,
): value is { previewId: string; which: LinkPreviewArtifactKind } {
	if (typeof value !== "object" || value === null) return false;
	const request = value as { previewId?: unknown; which?: unknown };
	return (
		typeof request.previewId === "string" &&
		(request.which === "favicon" || request.which === "image")
	);
}

export interface LinkPreviewIpcOptions {
	/** The window the channels answer, resolved late like every other surface. */
	window: () => BrowserWindow | null;
	/** That window's trusted document URL. */
	expectedUrl: string;
	userDataDir: string;
}

/**
 * Register both channels. Idempotent (`ipcMain.handle` throws for a channel that
 * already has a handler, and a reload must replace rather than fail).
 */
export function registerLinkPreviewIpc(options: LinkPreviewIpcOptions): void {
	if (registered) return;
	registered = true;
	const cache = createLinkPreviewCache({
		directory: linkPreviewCacheDirectory(options.userDataDir),
	});
	// Startup sweep: adopt what a previous run left, drop what has expired, and
	// apply the byte/count bounds before the first card asks for anything.
	void cache.sweep().catch(() => {
		// A cache directory that cannot be read is an empty cache, not a failure to
		// start: every resolve then simply fetches.
	});
	const service = createLinkPreviewService({
		cache,
		hop: nodeHop,
		lookup: lookupAll,
		log: (line) => logger.warn(line, LogFileType.BACKEND),
	});

	const admitted = (event: Parameters<typeof isAdmittedSender>[0]): boolean =>
		isAdmittedSender(event, [
			{ window: options.window(), url: options.expectedUrl },
		]);

	ipcMain.removeHandler(LINK_PREVIEW_RESOLVE_CHANNEL);
	ipcMain.handle(
		LINK_PREVIEW_RESOLVE_CHANNEL,
		async (event, request: unknown): Promise<LinkPreviewResolveResult> => {
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
	);

	ipcMain.removeHandler(LINK_PREVIEW_IMAGE_CHANNEL);
	ipcMain.handle(
		LINK_PREVIEW_IMAGE_CHANNEL,
		async (event, request: unknown): Promise<LinkPreviewImageResult> => {
			if (!admitted(event) || !isImageRequest(request)) {
				return { kind: "error", code: "invalid-request", status: 400 };
			}
			try {
				return await service.image(request);
			} catch {
				return { kind: "error", code: "io", status: 500 };
			}
		},
	);
}
