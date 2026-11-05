/**
 * The one place the link-preview module meets Electron.
 *
 * WHY DEDICATED CHANNELS rather than the desktop-request proxy: this is not a
 * request to the managed backend, it is a request to a THIRD PARTY from the user's
 * own machine, and it must be gated by its own rules (SSRF, caps, sniffing) rather
 * than by a backend route table. Naming the channels `link-preview:*` keeps that
 * visible in a stack trace.
 *
 * WHAT IS NOT HERE. Every decision - the sender gate, the request validation, the
 * "always resolves" envelope - lives in `ipc-handlers.ts`, which imports nothing at
 * runtime and is therefore testable. This file only supplies what Electron owns:
 * `ipcMain`, the shared `isAdmittedSender`, the real transport and the logger.
 */

import * as dns from "node:dns/promises";
import { join } from "node:path";
import { type BrowserWindow, ipcMain } from "electron";
import { LogFileType, logger } from "../backend/logger";
import { isAdmittedSender } from "../desktop-ipc";
import { createLinkPreviewCache } from "./cache";
import { nodeHop } from "./http-transport";
import {
	createLinkPreviewHandlers,
	registerLinkPreviewHandlers,
} from "./ipc-handlers";
import { createLinkPreviewService } from "./resolve";
import type { LookupAll, ResolvedAddress } from "./ssrf";

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

export interface LinkPreviewIpcOptions {
	/** The window the channels answer, resolved late like every other surface. */
	window: () => BrowserWindow | null;
	/** That window's trusted document URL. */
	expectedUrl: string;
	userDataDir: string;
}

/**
 * Register both channels, once.
 *
 * Idempotent by the `registered` flag, because there is exactly one call site and
 * it runs before the window exists; the removal inside
 * `registerLinkPreviewHandlers` is what would make a second registration replace
 * rather than throw, and it is covered by `scripts/link-preview-ipc.test.mjs`.
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
	const handlers = createLinkPreviewHandlers({
		service,
		// The same gate every other main-owned surface uses; the window is resolved
		// per call so a recreated window is admitted without re-registering.
		admitted: (event) =>
			isAdmittedSender(event, [
				{ window: options.window(), url: options.expectedUrl },
			]),
	});
	registerLinkPreviewHandlers(ipcMain, handlers);
}
