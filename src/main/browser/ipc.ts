import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { trustedDesktopFrame } from "../desktop-transport";
import type { BrowserExtensionManager } from "./extensions";
import type { BrowserHost } from "./host";
import type { ClearWhat } from "./profile";
import type { ContentRect } from "./registry";

/**
 * The renderer IPC surface for the browser feature.
 * Design: docs/design/ui-browser-tab.md 11.2 (the renderer owns layout and
 * reports it), 11.7 (the trust boundary), 6.1/6.3 (the chrome controls and
 * hand-over), 11.9 (a route now, a panel later).
 *
 * WHAT THIS IS FOR, and why it is built before any chrome exists: the browser's
 * state lives in main (registry, session, approvals, RPC), and the visible strip,
 * URL bar and consent band are a presentation of it. One namespace that does not
 * assume a route is what lets a route today and a panel later be two presentations
 * of the same API rather than a rewrite — so the API is the part worth landing
 * first, and the copy on top of it is a separate, reviewable change.
 *
 * THREE RULES, all enforced here:
 *
 * 1. EVERY handler authorizes the sender: the main window's own webContents, its
 *    main frame, and a trusted renderer URL. A driven browser view is a different
 *    webContents in a different session with no preload, so it can neither reach
 *    `window.api.browser.*` nor be mistaken for the window that may.
 * 2. This namespace is NOT routed through `desktop-request`'s allowlist. That
 *    vocabulary maps to backend HTTP paths; mixing the two would give the renderer
 *    a way to name browser operations through a channel designed for backend
 *    operations (design 11.7).
 * 3. The renderer never receives a surface nonce. `chromeState` carries tab ids,
 *    titles and URLs; the capability travels to a session through `tabs`.
 */

export interface RegisterBrowserIpcOptions {
	window: () => BrowserWindow | null;
	/** The trusted renderer URL: the dev server during development, the packaged
	 * `index.html` otherwise. Same value the desktop transport is given. */
	expectedUrl: string;
	host: () => BrowserHost | null;
	extensions?: BrowserExtensionManager;
	/** The clear-data affordances (design 5.4). Injected so this module does not
	 * depend on the session object. */
	clearData: (what: ClearWhat) => Promise<void>;
	log: (message: string) => void;
}

/** The channels this namespace owns, in one place so a test can enumerate them. */
export const BROWSER_IPC_CHANNELS = [
	"browser-extensions-list",
	"browser-extensions-install",
	"browser-extensions-set-enabled",
	"browser-extensions-remove",
	"browser-extensions-popup",
	"browser-state",
	"browser-new-tab",
	"browser-close-tab",
	"browser-activate-tab",
	"browser-navigate",
	"browser-reload",
	"browser-stop",
	"browser-history",
	"browser-set-content-rect",
	"browser-set-visible",
	"browser-hand-over",
	"browser-revoke-hand-over",
	"browser-consent-respond",
	"browser-revoke-approval",
	"browser-revoke-all-approvals",
	"browser-forget-site",
	"browser-clear-data",
] as const;

export function registerBrowserIpc(options: RegisterBrowserIpcOptions): void {
	function authorize(event: IpcMainInvokeEvent): BrowserHost {
		const owner = options.window();
		if (
			!owner ||
			owner.isDestroyed() ||
			event.sender !== owner.webContents ||
			event.senderFrame !== owner.webContents.mainFrame ||
			!trustedDesktopFrame(event.senderFrame.url, options.expectedUrl)
		) {
			throw new Error("This window cannot use the browser controls.");
		}
		const host = options.host();
		if (!host) throw new Error("The browser host is not running.");
		return host;
	}

	function extensionManager(
		event: IpcMainInvokeEvent,
	): BrowserExtensionManager {
		authorize(event);
		if (!options.extensions)
			throw new Error("Extension management is unavailable.");
		return options.extensions;
	}
	function extensionKey(value: unknown): string {
		if (typeof value !== "string" || !value || value.length > 128)
			throw new Error("An extension registration key is required.");
		return value;
	}
	// No IPC operation accepts a filesystem path. Only the native directory
	// chooser can supply one, and loading always follows native user confirmation.
	ipcMain.handle("browser-extensions-list", (event) =>
		extensionManager(event).list(),
	);
	ipcMain.handle("browser-extensions-install", (event) =>
		extensionManager(event).install(),
	);
	ipcMain.handle(
		"browser-extensions-set-enabled",
		(event, key: unknown, enabled: unknown) => {
			const manager = extensionManager(event);
			if (typeof enabled !== "boolean")
				throw new Error("Enabled must be a boolean.");
			return manager.setEnabled(extensionKey(key), enabled);
		},
	);
	ipcMain.handle("browser-extensions-remove", (event, key: unknown) =>
		extensionManager(event).remove(extensionKey(key)),
	);
	ipcMain.handle("browser-extensions-popup", (event, key: unknown) =>
		extensionManager(event).openPopup(extensionKey(key)),
	);

	ipcMain.handle("browser-state", (event) => authorize(event).chromeState());

	ipcMain.handle("browser-new-tab", async (event) => authorize(event).newTab());

	ipcMain.handle("browser-close-tab", (event, tabId: unknown) => {
		const host = authorize(event);
		return host.closeTab(numberOrThrow(tabId, "tabId"));
	});

	ipcMain.handle("browser-activate-tab", (event, tabId: unknown) => {
		const host = authorize(event);
		return host.activateTab(numberOrThrow(tabId, "tabId"));
	});

	ipcMain.handle("browser-navigate", async (event, url: unknown) => {
		const host = authorize(event);
		if (typeof url !== "string" || !url.trim()) {
			throw new Error("A URL is required.");
		}
		return host.navigateActive(url.trim());
	});

	ipcMain.handle("browser-reload", (event) => authorize(event).reloadActive());

	ipcMain.handle("browser-stop", (event) => authorize(event).stopActive());

	ipcMain.handle("browser-history", (event, direction: unknown) => {
		const host = authorize(event);
		if (direction !== "back" && direction !== "forward") {
			throw new Error("History direction must be forward or back.");
		}
		return host.historyActive(direction);
	});

	ipcMain.handle("browser-set-content-rect", (event, rect: unknown) => {
		const host = authorize(event);
		return host.setContentRect(contentRectOrNull(rect));
	});

	ipcMain.handle("browser-set-visible", (event, visible: unknown) => {
		const host = authorize(event);
		if (typeof visible !== "boolean") {
			throw new Error("Visibility must be a boolean.");
		}
		return host.setViewVisible(visible);
	});

	ipcMain.handle(
		"browser-hand-over",
		(event, tabId: unknown, sessionId: unknown) => {
			const host = authorize(event);
			if (typeof sessionId !== "string" || !sessionId.trim()) {
				throw new Error("Handing a tab over needs a session to hand it to.");
			}
			return host.handOver(numberOrThrow(tabId, "tabId"), sessionId.trim());
		},
	);

	ipcMain.handle("browser-revoke-hand-over", (event, tabId: unknown) => {
		const host = authorize(event);
		return host.revokeHandOver(numberOrThrow(tabId, "tabId"));
	});

	ipcMain.handle(
		"browser-consent-respond",
		(event, entryId: unknown, decision: unknown) => {
			const host = authorize(event);
			if (typeof entryId !== "string" || !entryId) {
				throw new Error("A pending request id is required.");
			}
			if (
				decision !== "once" &&
				decision !== "session" &&
				decision !== "site" &&
				decision !== "domain" &&
				decision !== "deny"
			) {
				throw new Error("Unsupported consent decision.");
			}
			return host.respondToConsent(entryId, decision);
		},
	);

	// Revocation (design 9.4). Three affordances rather than one, because
	// "stop this agent", "forget this site" and "revoke everything" are three
	// different user intentions with three different consequences.
	ipcMain.handle("browser-revoke-approval", (event, origin: unknown) => {
		const host = authorize(event);
		if (typeof origin !== "string" || !origin.trim()) {
			throw new Error("An origin is required.");
		}
		return host.revokeApproval(origin.trim());
	});

	ipcMain.handle("browser-revoke-all-approvals", (event) =>
		authorize(event).revokeAllApprovals(),
	);

	ipcMain.handle("browser-forget-site", async (event, origin: unknown) => {
		const host = authorize(event);
		if (typeof origin !== "string" || !origin.trim()) {
			throw new Error("An origin is required.");
		}
		return host.forgetSite(origin.trim());
	});

	ipcMain.handle("browser-clear-data", async (event, what: unknown) => {
		authorize(event);
		if (what !== "cookies" && what !== "cache" && what !== "everything") {
			throw new Error("Unsupported clear-data request.");
		}
		await options.clearData(what);
		options.log(`[browser] cleared browsing data: ${what}`);
		return { cleared: what };
	});
}

/**
 * Remove every handler this namespace registered.
 *
 * Needed because `ipcMain.handle` throws on a second registration for the same
 * channel: without this, stopping and restarting the host (the Settings toggle
 * does exactly that, and so does an evidence run that restarts the app in
 * process) would fail on the second start rather than re-registering.
 */
export function unregisterBrowserIpc(): void {
	for (const channel of BROWSER_IPC_CHANNELS) ipcMain.removeHandler(channel);
}

function numberOrThrow(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new Error(`${name} must be an integer.`);
	}
	return value;
}

function contentRectOrNull(value: unknown): ContentRect | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "object")
		throw new Error("Content rect must be an object.");
	const rect = value as Record<string, unknown>;
	for (const key of ["x", "y", "width", "height"]) {
		if (typeof rect[key] !== "number" || !Number.isFinite(rect[key])) {
			throw new Error("Content rect needs finite x, y, width and height.");
		}
	}
	return {
		x: rect.x as number,
		y: rect.y as number,
		width: rect.width as number,
		height: rect.height as number,
	};
}
