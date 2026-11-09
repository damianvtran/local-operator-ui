/**
 * The session-singleton electron-chrome-extensions adapter (design §4.1
 * "adapter.ts"), generalized from the earlier 1Password-only binding.
 *
 * Constraints carried over unchanged:
 * - Native messaging and notifications stay denied GLOBALLY (constructor flags
 *   backed by patches/electron-chrome-extensions@4.10.0.patch). There is no
 *   per-extension toggle: the patch is constructor-global and nothing needs one.
 * - `chrome.permissions.request` always answers false: optional permissions
 *   would grow access past what the native install dialog showed.
 * - An extension-requested tab is never activated (an extension's
 *   `active:true` is not an app user action), and an extension may not close
 *   the app's browser window.
 * - The library is session-singleton with no dispose API, so there is ONE
 *   adapter per persistent Session; a re-attached host swaps the hooks, and a
 *   detached host's registry/window is never retained in the callbacks.
 */
import type { BrowserWindow, Session, WebContents } from "electron";
import { ElectronChromeExtensions } from "electron-chrome-extensions";
import { displayTitleFor, displayUrlFor } from "../internal-pages";

export interface AdapterHooks {
	window: BrowserWindow;
	createTab: (url: string, active: boolean) => Promise<WebContents>;
	selectTab: (contents: WebContents) => void;
	activeTab: () => WebContents | null;
	removeTab: (contents: WebContents) => void;
}

export interface AdapterBinding {
	adapter: ElectronChromeExtensions;
	hooks: AdapterHooks | null;
	/** Open an extension page of a loaded, enabled extension in its extension
	 * window (manager-owned). `large`: a page-sized window, for requests that
	 * are not the toolbar popup (review U1a). */
	openExtension:
		| ((url: string, large: boolean) => Promise<BrowserWindow>)
		| null;
	/** Open an extension's own page as a background USER tab (U1). */
	openExtensionTab: ((url: string) => Promise<WebContents>) | null;
	/** Whether `id` is installed AND enabled in the manager right now. */
	isActiveExtension: ((id: string) => boolean) | null;
	mayActivateTab: (() => boolean) | null;
}

const adapters = new WeakMap<Session, AdapterBinding>();

/**
 * What `chrome.tabs.update({url})` may load into a tab (reviewer R2-1
 * out-of-scope note, folded in round 2). The adapter performs it as a
 * browser-initiated `loadURL`, which the views' `will-navigate` scheme rule
 * never sees, so without this an extension could put `file:`, `data:` or an
 * internal `about:blank#lop-…` document into any tab, agent tabs included.
 * Same rule as the views: http(s), the bare about:blank, or the calling
 * extension's OWN pages.
 */
export function extensionMayNavigateTab(
	url: string,
	extensionId: string,
): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "http:" || parsed.protocol === "https:")
			return true;
		if (parsed.protocol === "about:") return parsed.href === "about:blank";
		return extensionIdOfUrl(parsed.href) === extensionId;
	} catch {
		return false;
	}
}

/** The tab fields an extension may see: never main's internal-page nonce
 * (reviewer R2-1). Mutates the adapter's details object in place, which is the
 * library's `assignTabDetails` contract. */
export function maskTabDetails(
	details: { url?: string; title?: string },
	tab: Parameters<typeof displayUrlFor>[0],
): void {
	details.url = displayUrlFor(tab);
	details.title = displayTitleFor(tab);
}

/* The library marks these private, but they are exactly Chrome's toolbar
 * semantics (per-tab popup resolution, onClicked dispatch) and the version is
 * pinned by the patch; a reimplementation would drift from its state. */
interface BrowserActionInternals {
	getPopupUrl(extensionId: string, tabId: number): string | undefined;
	activateClick(details: { extensionId: string; tabId: number }): void;
}
function browserAction(binding: AdapterBinding): BrowserActionInternals {
	return (
		binding.adapter as unknown as {
			api: { browserAction: BrowserActionInternals };
		}
	).api.browserAction;
}

/** The runtime popup of `extensionId` for `tabId`, as the extension last set
 * it with `action.setPopup` (falling back to the manifest): `{url: null}` when
 * it has none — 1Password sets `""` while no account is signed in, so a
 * toolbar click must dispatch `action.onClicked` instead (review U1) — and
 * null when the adapter cannot answer (the caller keeps the manifest popup). */
export function runtimePopupUrl(
	binding: AdapterBinding,
	extensionId: string,
	tabId: number,
): { url: string | null } | null {
	try {
		return {
			url: browserAction(binding).getPopupUrl(extensionId, tabId) || null,
		};
	} catch {
		return null;
	}
}

/** Chrome's toolbar click with no popup: `action.onClicked(tab)` to the
 * extension. Only from the app's own sender-checked "Open" command. */
export function dispatchActionClick(
	binding: AdapterBinding,
	extensionId: string,
	tabId: number,
): boolean {
	try {
		browserAction(binding).activateClick({ extensionId, tabId });
		return true;
	} catch {
		return false;
	}
}

interface RouterLike {
	listeners: Map<string, { extensionId: string }[]>;
	sendEvent(id: string, event: string, ...args: unknown[]): void;
}

/**
 * `runtime.onInstalled` for `extensionId` (review U1b). Electron's
 * `loadExtension` never fires it, so the patched preload routes
 * `chrome.runtime.onInstalled` through the adapter's router and main
 * dispatches it here. Answers whether the extension had a listener registered
 * (a worker registers at top level, which can trail the `running` status by a
 * few IPC hops — the caller waits for one, bounded).
 */
export function dispatchInstalled(
	binding: AdapterBinding,
	extensionId: string,
	details:
		| { reason: "install" }
		| { reason: "update"; previousVersion: string },
): boolean {
	try {
		const router = (
			binding.adapter as unknown as { ctx: { router: RouterLike } }
		).ctx.router;
		const listening = (router.listeners.get("runtime.onInstalled") ?? []).some(
			(listener) => listener.extensionId === extensionId,
		);
		if (listening)
			router.sendEvent(extensionId, "runtime.onInstalled", details);
		return listening;
	} catch {
		return false;
	}
}

/** `chrome-extension://<id>/...` → id, else null. */
export function extensionIdOfUrl(raw: string): string | null {
	try {
		const url = new URL(raw);
		return url.protocol === "chrome-extension:" &&
			/^[a-p]{32}$/.test(url.hostname)
			? url.hostname
			: null;
	} catch {
		return null;
	}
}

export function isExtensionPageOf(raw: string, id: string): boolean {
	return extensionIdOfUrl(raw) === id;
}

export function extensionsAdapter(session: Session): AdapterBinding {
	const existing = adapters.get(session);
	if (existing) return existing;
	const binding = {} as AdapterBinding;
	const hooks = () => {
		if (!binding.hooks) throw new Error("Browser host unavailable");
		return binding.hooks;
	};
	const open = async (
		url: string,
		as: "tab" | "window",
	): Promise<[WebContents, BrowserWindow]> => {
		const id = extensionIdOfUrl(url);
		if (id) {
			// Only an installed+enabled extension's OWN pages. `tabs.create` opens
			// a background USER tab (review U1: 1Password's install-time welcome /
			// sign-in page must not be lost to a focus check); such a tab is never
			// agent-drivable — registry.requireSurface refuses extension documents
			// — and agent tabs refuse extension subframes (subframe-policy.ts).
			// `windows.create` keeps the extension-window path.
			if (!binding.isActiveExtension?.(id))
				throw new Error("Unsupported extension page");
			if (as === "tab") {
				const contents = await binding.openExtensionTab?.(url);
				if (!contents) throw new Error("Extension UI unavailable");
				return [contents, hooks().window];
			}
			const window = await binding.openExtension?.(url, true);
			if (!window) throw new Error("Extension UI unavailable");
			return [window.webContents, window];
		}
		const parsed = new URL(url);
		if (
			parsed.protocol !== "https:" &&
			parsed.protocol !== "http:" &&
			parsed.href !== "about:blank"
		)
			throw new Error("Unsupported extension navigation");
		const h = hooks();
		// An extension-supplied active:true is not an app user action.
		return [await h.createTab(parsed.href, false), h.window];
	};
	binding.hooks = null;
	binding.openExtension = null;
	binding.openExtensionTab = null;
	binding.isActiveExtension = null;
	binding.mayActivateTab = null;
	binding.adapter = new ElectronChromeExtensions({
		session,
		// Not a preference. Neither alias/frame/worker may discover or launch a
		// local native host (see the patch); vendor sign-in inside the extension
		// is the supported route.
		allowNativeMessaging: false,
		allowNotifications: false,
		openActionPopup: ({ extensionId, url }) => {
			if (
				!binding.isActiveExtension?.(extensionId) ||
				!isExtensionPageOf(url, extensionId)
			)
				throw new Error("Unsupported extension action");
			if (!binding.openExtension) throw new Error("Browser host unavailable");
			void binding.openExtension(url, false).catch(() => {
				/* The caller receives no vendor exception text. */
			});
		},
		createTab: (details) => open(details.url ?? "about:blank", "tab"),
		// Native destroyed/closed events can arrive after the host detached hooks.
		// They release adapter bookkeeping only; never call a dead registry.
		selectTab: (contents) => {
			if (binding.mayActivateTab?.()) binding.hooks?.selectTab(contents);
			else {
				// Correct the dependency's internal active mirror without presenting
				// a worker-requested tab in our user-owned registry.
				const selected = binding.hooks?.activeTab();
				if (selected && selected.id !== contents.id)
					binding.adapter.selectTab(selected);
			}
		},
		removeTab: (contents) => binding.hooks?.removeTab(contents),
		createWindow: async (details) => {
			const urls = Array.isArray(details.url) ? details.url : [details.url];
			if (urls.length !== 1 || typeof urls[0] !== "string")
				throw new Error("Unsupported extension window request");
			return (await open(urls[0], "window"))[1];
		},
		// An extension must not close the app's browser window.
		removeWindow: (window) => {
			if (!window.isDestroyed() && window !== binding.hooks?.window)
				window.close();
		},
		requestPermissions: async () => false,
		assignTabDetails: (details, tab) => maskTabDetails(details, tab),
		// Read by the patched `tabs.update` (see extensionMayNavigateTab).
		...({
			validateTabNavigation: (url: string, extensionId: string) =>
				extensionMayNavigateTab(url, extensionId),
		} as object),
	});
	adapters.set(session, binding);
	return binding;
}
