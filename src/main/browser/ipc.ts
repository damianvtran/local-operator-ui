import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { t } from "../../i18n";
import {
	ADDRESS_HISTORY_MAX_LIMIT,
	ADDRESS_HISTORY_MAX_QUERY_LENGTH,
	type AddressHistoryRequest,
} from "../../shared/browser-address-history";
import { trustedDesktopFrame } from "../desktop-transport";
import {
	DEV_DRIVER_ADDRESS_OVERLAY,
	DEV_DRIVER_ADDRESS_OVERLAY_PROJECT,
} from "../dev-driver";
import type { WebauthnChooser } from "../webauthn";
import type { AddressOverlayFacts } from "./address-overlay";
import type { BrowserHost, CloseTabsIntent } from "./host";
import { type BrowserAvailability, MAX_START_ATTEMPTS } from "./lifecycle";
import type { ClearWhat } from "./profile";
import type { ContentRect } from "./registry";
import { numberOrThrow, tabIdOrThrow } from "./request-guards";

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
	availability?: () => BrowserAvailability;
	/**
	 * The passkey chooser, which is what `browser-webauthn-respond` answers.
	 *
	 * A getter rather than the instance, like `host`: the chooser is built by the
	 * host's own startup, and main registers this namespace while that startup is
	 * still running. It is NULL only when no host is running, which is the same
	 * condition `authorize` already refuses.
	 */
	webauthn: () => WebauthnChooser | null;
	/**
	 * The passkey notice's two user actions. Both take the notice's `at` as its
	 * identity and return a boolean/outcome; neither takes a URL (the open reads the
	 * tab's own URL in main) - see `passkey-notice.ts`.
	 */
	passkeyNotice?: {
		dismiss: (tabId: number, at: number) => boolean;
		openInSystemBrowser: (
			tabId: number,
			at: number,
		) => Promise<{ ok: true } | { ok: false; reason: string }>;
	};
	/** The clear-data affordances (design 5.4). Injected so this module does not
	 * depend on the session object. */
	clearData: (what: ClearWhat) => Promise<void>;
	/** Reveal the quarantine directory the host is writing into (§16.4).
	 *
	 * WHY IT TAKES NO ARGUMENT, which is the whole design of this channel: the
	 * directory is composed by the HARNESS (`browser_files.session_dir`) and this
	 * host must never open a path a caller named — a renderer-supplied path in an
	 * IPC handler is a disclosure primitive, and the download root is the one place in
	 * this feature where a string could have become a directory. The renderer asks
	 * for "the download directory"; the host answers with the one it used.
	 *
	 * It returns `shell.openPath`'s own contract — "" on success, a message
	 * otherwise — so a failure is shown rather than thrown: a reveal that fails is a
	 * Finder problem, not a fault in the agent's download. */
	revealDownloads: () => Promise<string>;
	/**
	 * S1's probe-only overlay channel, present ONLY when the launch gate passed
	 * (see `StartBrowserHostOptions.addressOverlay`). It is registered under a
	 * dev-driver channel rather than a `browser-*` one on purpose: the browser
	 * namespace is the agent/tool protocol and its trust boundary is unchanged,
	 * while this experimental surface exists for the armed headless probe alone.
	 *
	 * The callback reads the host's CURRENT controller per call; a retry replaces
	 * it, so no handler holds a stale attempt's controller.
	 */
	addressOverlayProbe?: (
		action: "show" | "hide" | "facts" | "click" | "measure" | "key",
		argument?: unknown,
	) => Promise<AddressOverlayFacts>;
	/**
	 * S2's projection handler, same lifetime and sender rules as the probe above.
	 * Its argument is revalidated in the controller (`sanitizeProjection`), so a
	 * renderer cannot widen what reaches the child document; absent means the
	 * channel is not registered at all and the renderer's port latches off.
	 */
	addressOverlayProject?: (payload: unknown) => Promise<unknown>;
	/**
	 * S4b's product projection handler. Registered whenever the launch built a
	 * product controller, independently of the probe gate: the product has no
	 * environment variable to turn it on, so this channel is the only door.
	 */
	addressOverlayProduct?: (payload: unknown) => Promise<unknown>;
	/** Ask the host to start again for this window (design round 1, D1a). Injected
	 * rather than imported so this module does not reach back into `index.ts`'s
	 * lifecycle; `index.ts` supplies the same `startBrowserHost` the app already
	 * calls. It is authorized like every other channel and is a no-op when a host
	 * is already running, so a stray click cannot start a second one. */
	retry?: () => Promise<void>;
	/** Move DOM focus into the presented page after a chord that came from the page.
	 * Optional because only a launch mode that may focus a window supplies it; the
	 * helper behind it refuses an unfocused or hidden window and never raises one. */
	focusPage?: () => void;
	log: (message: string) => void;
}

/** Session ids are names, not free text: a control character cannot appear in
 * one, and allowing it would store an attribution no scope comparison can match. */
const CONTROL_CHARS = /[\p{Cc}]/u;

/**
 * S4b's product event channel (main -> owner renderer): a validated row click or
 * a main-decided dismissal. Distinct from the dev-driver's event so a product
 * launch never depends on, or exposes, the probe bridge.
 */
export const PRODUCT_ADDRESS_OVERLAY_EVENT = "browser-address-overlay-event";

/** The channels this namespace owns, in one place so a test can enumerate them. */
export const BROWSER_IPC_CHANNELS = [
	"browser-state",
	"browser-set-chord-focus",
	"browser-page-control",
	"browser-reopen-tab",
	"browser-focus-page",
	"browser-approvals-card-open",
	"browser-approvals-card-close",
	"browser-approvals-card-context",
	"browser-new-tab",
	"browser-reorder-tabs",
	"browser-tab-action",
	"browser-close-tab",
	"browser-close-tabs",
	"browser-activate-tab",
	"browser-address-history",
	"browser-address-overlay-project",
	"browser-navigate",
	"browser-home",
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
	"browser-webauthn-pending",
	"browser-reveal-downloads",
	"browser-passkey-notice-dismiss",
	"browser-passkey-notice-open",
	/** The user's own recovery click on the `unavailable` state (round 1, D1a).
	 * Named here so the namespace stays the one place that lists its channels. */
	"browser-retry",
	/**
	 * S1's probe-only channel. Listed here for unregistration only: the handler
	 * below is registered only when the launch gate passed, and this entry makes
	 * `unregisterBrowserIpc` remove it on a stop/retry like every other channel
	 * (removing an unregistered handler is a no-op).
	 */
	DEV_DRIVER_ADDRESS_OVERLAY,
	DEV_DRIVER_ADDRESS_OVERLAY_PROJECT,
] as const;

export function registerBrowserIpc(options: RegisterBrowserIpcOptions): void {
	function authorizeSender(event: IpcMainInvokeEvent): void {
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
	}
	function authorize(event: IpcMainInvokeEvent): BrowserHost {
		authorizeSender(event);
		const host = options.host();
		if (!host)
			throw new Error("browser_unavailable: The browser is not ready.");
		return host;
	}

	ipcMain.handle("browser-state", (event) => {
		// Sender authorization is independent of readiness: a loading host must
		// not make a driven page eligible to read even an empty projection.
		authorizeSender(event);
		const host = options.host();
		const availability = options.availability?.();
		if (host)
			return { ...host.chromeState(), ...(availability && { availability }) };
		return {
			tabs: [],
			activeTabId: null,
			url: "",
			title: "",
			loading: false,
			canGoBack: false,
			canGoForward: false,
			pendingConsent: [],
			approvals: [],
			navFailure: null,
			availability: availability ?? {
				status: "unavailable",
				attempt: 0,
				maxAttempts: MAX_START_ATTEMPTS,
				message: "The browser is not running.",
				// No host invokes this fallback (it is the pre-start projection), and
				// there is nothing to retry before a start was asked for.
				canRetry: false,
			},
		};
	});

	ipcMain.handle("browser-new-tab", async (event, sessionId: unknown) => {
		const host = authorize(event);
		return host.newTab(optionalConversationOrThrow(sessionId));
	});

	ipcMain.handle("browser-reorder-tabs", (event, ids: unknown) => {
		const host = authorize(event);
		if (
			!Array.isArray(ids) ||
			ids.length > 512 ||
			Array.from(ids).some(
				(id) => typeof id !== "number" || !Number.isSafeInteger(id) || id < 0,
			)
		)
			throw new Error(t("ui.browser.chrome.invalid_order"));
		return host.reorderChromeTabs(ids);
	});
	ipcMain.handle(
		"browser-tab-action",
		(event, tabId: unknown, action: unknown) => {
			const host = authorize(event);
			if (
				action !== "duplicate" &&
				action !== "reload" &&
				action !== "mute" &&
				action !== "unmute"
			)
				throw new Error(t("ui.browser.chrome.invalid_action"));
			return host.actOnChromeTab(numberOrThrow(tabId, "tabId"), action);
		},
	);
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

	ipcMain.handle(
		"browser-navigate",
		async (event, url: unknown, expectedTabId: unknown) => {
			const host = authorize(event);
			if (typeof url !== "string" || !url.trim()) {
				throw new Error("A URL is required.");
			}
			return host.navigateActive(
				url.trim(),
				expectedTabId === undefined || expectedTabId === null
					? undefined
					: tabIdOrThrow(expectedTabId, "expectedTabId"),
			);
		},
	);

	/**
	 * The address field's local suggestions.
	 *
	 * A READ, so it authorizes exactly like `browser-state` (the sender check is
	 * independent of host readiness) and then validates every field. The renderer
	 * is untrusted input here like everywhere else on this namespace: a request id
	 * and an expected tab are integers, and the scope is either the literal `all`
	 * or a non-empty bounded conversation id. The host owns the stale-tab refusal;
	 * this boundary owns shape.
	 */
	ipcMain.handle("browser-address-history", (event, request: unknown) => {
		const host = authorize(event);
		return host.addressHistory(addressHistoryRequestOrThrow(request));
	});

	ipcMain.handle(
		"browser-page-control",
		(
			event,
			tabId: unknown,
			action: unknown,
			query: unknown,
			forward: unknown,
			next: unknown,
		) => {
			const host = authorize(event);
			if (
				typeof action !== "string" ||
				!["open", "close", "search", "print", "in", "out", "reset"].includes(
					action,
				)
			)
				throw new Error("Invalid page control action.");
			if (
				typeof query !== "string" ||
				query.length > 4096 ||
				typeof forward !== "boolean" ||
				typeof next !== "boolean"
			)
				throw new Error("Invalid page search input.");
			return host.controlPage(
				numberOrThrow(tabId, "tabId"),
				action as
					| "open"
					| "close"
					| "search"
					| "print"
					| "in"
					| "out"
					| "reset",
				query,
				forward,
				next,
			);
		},
	);
	ipcMain.handle("browser-set-chord-focus", (event, focused: unknown) => {
		const host = authorize(event);
		if (typeof focused !== "boolean")
			throw new Error("Browser focus must be a boolean.");
		host.setChordFocus(focused);
	});
	ipcMain.handle("browser-reopen-tab", (event, sessionId: unknown) =>
		authorize(event).reopenClosed(optionalConversationOrThrow(sessionId)),
	);
	ipcMain.handle("browser-approvals-card-open", (event, input: unknown) => {
		const host = authorize(event);
		return host.openApprovalsCard(input);
	});

	ipcMain.handle("browser-approvals-card-close", (event) => {
		const host = authorize(event);
		return host.closeApprovalsCard();
	});

	ipcMain.handle("browser-approvals-card-context", (event, input: unknown) => {
		const host = authorize(event);
		host.setApprovalsCardContext(input);
	});

	ipcMain.handle("browser-focus-page", (event) => {
		authorize(event);
		options.focusPage?.();
	});
	// Home (LOH-13): the user's own press, no argument — main decides the
	// start state, so a renderer cannot aim this channel at an origin.
	ipcMain.handle("browser-home", async (event) => {
		const host = authorize(event);
		return host.goHomeActive();
	});

	ipcMain.handle("browser-reload", (event, hard: unknown) => {
		const host = authorize(event);
		if (hard !== undefined && typeof hard !== "boolean")
			throw new Error("Hard reload must be a boolean.");
		return host.reloadActive(hard === true);
	});

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

	ipcMain.handle(
		"browser-set-visible",
		(event, visible: unknown, ownPage: unknown, ownStatePage: unknown) => {
			const host = authorize(event);
			if (typeof visible !== "boolean") {
				throw new Error("Visibility must be a boolean.");
			}
			// The reason half of the report (S4a). Absent is "no reason given", which
			// keeps every pre-S4a caller's meaning: a hide with no reason is an overlay
			// hide and refuses shortcuts. A truthy non-boolean is refused rather than
			// coerced: this fact decides whether the browser consumes the user's keys.
			if (ownPage !== undefined && typeof ownPage !== "boolean") {
				throw new Error("The view-hidden reason must be a boolean.");
			}
			if (ownStatePage !== undefined && typeof ownStatePage !== "boolean") {
				throw new Error("The own-state reason must be a boolean.");
			}
			return host.setViewVisible(
				visible,
				ownPage === true,
				ownStatePage === undefined ? ownPage === true : ownStatePage,
			);
		},
	);

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

	/*
	 * The pending choosers, pulled rather than only pushed.
	 *
	 * WHY A PULL EXISTS AT ALL: a request raised while the surface that renders
	 * choosers was not mounted had nowhere to be received, and a push cannot replay
	 * it — so the renderer asks main on mount what is still waiting (UX round 1, U2:
	 * leaving the browser route and coming back left the user unable to answer a
	 * request that was still live). MAIN IS THE SOURCE OF TRUTH for that queue; the
	 * renderer only ever mirrors it, so the two cannot disagree about which request
	 * is outstanding.
	 */
	ipcMain.handle("browser-webauthn-pending", (event) => {
		authorize(event);
		// No host running is an empty queue rather than an error: the renderer asks
		// this while a host may be starting or stopped, and "nothing is waiting" is
		// the truth in both cases.
		return options.webauthn()?.pendingRequests() ?? [];
	});

	/*
	 * The passkey notice's actions. Sender-checked like every channel here; the
	 * renderer names a tab and the notice's `at` and nothing else, so there is no
	 * URL or origin for it to retarget (the open reads the tab's own URL in main).
	 */
	ipcMain.handle(
		"browser-passkey-notice-dismiss",
		(event, tabId: unknown, at: unknown) => {
			authorize(event);
			return (
				options.passkeyNotice?.dismiss(
					numberOrThrow(tabId, "tabId"),
					numberOrThrow(at, "at"),
				) ?? false
			);
		},
	);
	ipcMain.handle(
		"browser-passkey-notice-open",
		async (event, tabId: unknown, at: unknown) => {
			authorize(event);
			if (!options.passkeyNotice) {
				return { ok: false, reason: "the passkey notice is not available" };
			}
			return options.passkeyNotice.openInSystemBrowser(
				numberOrThrow(tabId, "tabId"),
				numberOrThrow(at, "at"),
			);
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
		const host = authorize(event);
		if (what !== "cookies" && what !== "cache" && what !== "everything") {
			throw new Error("Unsupported clear-data request.");
		}
		await options.clearData(what);
		// "Everything" erases what the user visited; a remembered closed tab is part
		// of that history and must not survive it (review R3).
		if (what === "everything") host.forgetClosedTabs();
		options.log(`[browser] cleared browsing data: ${what}`);
		return { cleared: what };
	});

	// The user's own click, on a human action: the agent has no way to reach this
	// channel (§11.4's "no auto-open ... from the tool"). It carries no argument, so
	// there is nothing for a caller to point somewhere else.
	ipcMain.handle("browser-reveal-downloads", async (event) => {
		authorize(event);
		const message = await options.revealDownloads();
		if (message)
			options.log(
				`[browser] could not reveal the download directory: ${message}`,
			);
		return { opened: message === "", message };
	});

	// The user's own recovery click on the `unavailable` state (round 1, D1a):
	// like the reveal above, it is a human action with no argument to retarget.
	// Authorization is the sender check only — a retry is allowed precisely while
	// NO host is running, so `authorize` (which requires a host) would be wrong.
	ipcMain.handle("browser-retry", async (event) => {
		authorizeSender(event);
		if (!options.retry)
			throw new Error("browser_unavailable: Retry is not available.");
		await options.retry();
		return { retried: true };
	});

	/*
	 * S1's probe. Registered NOTHING unless the launch gate resolved a probe
	 * callback, so an off-gate invocation reaches Electron's own
	 * "No handler registered for 'dev-driver-address-overlay'" — the same
	 * fail-closed shape the dev driver's own channels use.
	 *
	 * The ONLY accepted input is one of three exact action words. There is no
	 * URL, script, geometry, tab selection, commit, navigation, clipboard or file
	 * argument, because this surface exists to operate the real host's child, not
	 * to become a second browser API. Sender authorization is the existing owner
	 * check: the owner window's own main frame at the trusted document URL. A
	 * driven page, a popup, a foreign window or a subframe is refused before the
	 * action is read.
	 */
	if (options.addressOverlayProbe) {
		ipcMain.handle(
			DEV_DRIVER_ADDRESS_OVERLAY,
			(event, action: unknown, argument: unknown) => {
				authorizeSender(event);
				if (
					action !== "show" &&
					action !== "hide" &&
					action !== "facts" &&
					action !== "click" &&
					action !== "measure" &&
					action !== "key"
				) {
					throw new Error(
						"address_overlay_invalid_action: expected 'show', 'hide', 'facts', 'click', 'measure' or 'key'.",
					);
				}
				const probe = options.addressOverlayProbe;
				if (!probe) {
					throw new Error(
						"address_overlay_unavailable: the overlay probe is not running.",
					);
				}
				// Only the three probe-only actions read a second argument. A stray
				// payload on show/hide/facts is DROPPED rather than carried, so the
				// probe surface cannot grow a second meaning by accident.
				const readsArgument =
					action === "click" || action === "measure" || action === "key";
				return probe(action, readsArgument ? argument : undefined);
			},
		);
	}
	if (options.addressOverlayProduct) {
		ipcMain.handle(
			"browser-address-overlay-project",
			(event, payload: unknown) => {
				authorizeSender(event);
				const project = options.addressOverlayProduct;
				if (!project) {
					throw new Error(
						"address_overlay_unavailable: the overlay projection is not running.",
					);
				}
				return project(payload);
			},
		);
	}
	if (options.addressOverlayProject) {
		ipcMain.handle(
			DEV_DRIVER_ADDRESS_OVERLAY_PROJECT,
			(event, payload: unknown) => {
				authorizeSender(event);
				const project = options.addressOverlayProject;
				if (!project) {
					throw new Error(
						"address_overlay_unavailable: the overlay projection is not running.",
					);
				}
				return project(payload);
			},
		);
	}
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

/**
 * The address-history request, validated at the boundary.
 *
 * The scope is gone: the list is one list for the field, and half of it (the
 * persistent store) is session-agnostic, so a display scope would describe only
 * the tab rows and mislead about the rest. The query and limit are bounded here
 * as well as in the shared type, because the shared type is erased at runtime:
 * a query is a prefix the user typed, never a pattern, and an unbounded limit
 * is an unbounded IPC payload.
 */
function addressHistoryRequestOrThrow(value: unknown): AddressHistoryRequest {
	if (!value || typeof value !== "object") {
		throw new Error("An address history request is required.");
	}
	const request = value as {
		requestId?: unknown;
		expectedTabId?: unknown;
		query?: unknown;
		limit?: unknown;
	};
	const requestId = numberOrThrow(request.requestId, "requestId");
	const expectedTabId = tabIdOrThrow(request.expectedTabId, "expectedTabId");
	if (typeof request.query !== "string") {
		throw new Error("The address history query must be a string.");
	}
	const query = request.query;
	if (
		query.length > ADDRESS_HISTORY_MAX_QUERY_LENGTH ||
		CONTROL_CHARS.test(query)
	) {
		throw new Error("The address history query is invalid.");
	}
	if (
		typeof request.limit !== "number" ||
		!Number.isSafeInteger(request.limit) ||
		request.limit < 1 ||
		request.limit > ADDRESS_HISTORY_MAX_LIMIT
	) {
		throw new Error("The address history limit is invalid.");
	}
	return { requestId, expectedTabId, query, limit: request.limit };
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
