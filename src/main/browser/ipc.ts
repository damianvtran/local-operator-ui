import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { trustedDesktopFrame } from "../desktop-transport";
import type { WebauthnChooser } from "../webauthn";
import type { BrowserHost, CloseTabsIntent } from "./host";
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
	/**
	 * The passkey chooser, which is what `browser-webauthn-respond` answers.
	 *
	 * A getter rather than the instance, like `host`: the chooser is built by the
	 * host's own startup, and main registers this namespace while that startup is
	 * still running. It is NULL only when no host is running, which is the same
	 * condition `authorize` already refuses.
	 */
	webauthn: () => WebauthnChooser | null;
	/** The clear-data affordances (design 5.4). Injected so this module does not
	 * depend on the session object. */
	clearData: (what: ClearWhat) => Promise<void>;
	log: (message: string) => void;
}

/** The channels this namespace owns, in one place so a test can enumerate them. */
export const BROWSER_IPC_CHANNELS = [
	"browser-state",
	"browser-new-tab",
	"browser-close-tab",
	"browser-close-tabs",
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
	"browser-webauthn-respond",
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

	ipcMain.handle("browser-state", (event) => authorize(event).chromeState());

	ipcMain.handle("browser-new-tab", async (event, sessionId: unknown) => {
		const host = authorize(event);
		return host.newTab(optionalConversationOrThrow(sessionId));
	});

	ipcMain.handle("browser-close-tab", (event, tabId: unknown) => {
		const host = authorize(event);
		return host.closeTab(numberOrThrow(tabId, "tabId"));
	});

	ipcMain.handle("browser-close-tabs", (event, intent: unknown) => {
		const host = authorize(event);
		return host.closeTabs(closeTabsIntentOrThrow(intent));
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

	/*
	 * The passkey chooser's answer.
	 *
	 * Sender-checked like every channel here, and addressed by a REQUEST ID main
	 * minted: the renderer never names a credential the chooser did not offer, and a
	 * request id that is unknown (or already answered) is refused by the chooser
	 * rather than answered a second time. `credentialId: null` is the dismissal, and
	 * it is a legal answer rather than a missing argument — the page's pending
	 * promise has to be settled with nothing in that case, so refusing it here would
	 * turn "the user said no" into a dead end.
	 */
	ipcMain.handle(
		"browser-webauthn-respond",
		(event, requestId: unknown, credentialId: unknown) => {
			authorize(event);
			const chooser = options.webauthn();
			if (!chooser) throw new Error("The browser host is not running.");
			if (typeof requestId !== "string" || !requestId) {
				throw new Error("A pending passkey request id is required.");
			}
			if (credentialId !== null && typeof credentialId !== "string") {
				throw new Error("A passkey choice must name a credential or nothing.");
			}
			return chooser.respond(requestId, credentialId);
		},
	);

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

/**
 * A bulk close, validated at the boundary.
 *
 * WHY THIS IS NOT A TYPE CHECK OF A SHARED DECLARATION: the renderer's intent is
 * untrusted input like every other argument on this namespace (rule 1 of the module's
 * own header), and `ids` and `conversation` are two different authorities — one names
 * tabs the user could see, the other names a conversation and lets MAIN resolve it
 * against the live registry. So each mode is checked for its own shape: `ids` needs a
 * non-empty list of integers, and `conversation` needs a real session id (the same
 * validator `browser-new-tab` uses), never an empty one. An intent that is neither is
 * refused rather than coerced into the closer-looking one.
 */
function closeTabsIntentOrThrow(value: unknown): CloseTabsIntent {
	if (!value || typeof value !== "object") {
		throw new Error("A close request is required.");
	}
	const intent = value as {
		mode?: unknown;
		tabIds?: unknown;
		sessionId?: unknown;
	};
	if (intent.mode === "ids") {
		if (!Array.isArray(intent.tabIds) || intent.tabIds.length === 0) {
			throw new Error("Closing tabs by id needs at least one tab id.");
		}
		const tabIds = intent.tabIds.map((tabId) =>
			numberOrThrow(tabId, "each tab id"),
		);
		return { mode: "ids", tabIds };
	}
	if (intent.mode === "conversation") {
		const sessionId = optionalConversationOrThrow(intent.sessionId);
		if (sessionId === null) {
			throw new Error("Closing a conversation's tabs needs a conversation id.");
		}
		return { mode: "conversation", sessionId };
	}
	throw new Error("Unsupported close request.");
}

/**
 * The conversation a new tab should belong to, or null for none.
 *
 * THE BOUNDARY VALIDATES RATHER THAN TRUSTS, which is why this exists at all:
 * the renderer's `sessionId` is a string it derived from the session list, and
 * main has no reason to accept anything else as a name for a conversation.
 * `null`/absent is a REAL and common value — the route, and the pane on a draft,
 * open tabs that belong to no conversation — while an empty or blank string is a
 * mistake rather than a value: it would be stored as an attribution that matches
 * no scope's comparison and reads to a human as "a conversation with no name".
 * Refusing it here is what keeps `sessionId` a name or nothing.
 */
function optionalConversationOrThrow(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "string") {
		throw new Error("A conversation id must be a string.");
	}
	const sessionId = value.trim();
	if (!sessionId) throw new Error("A conversation id cannot be empty.");
	return sessionId;
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
