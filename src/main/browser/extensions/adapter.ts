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
	/** Open an extension page of a loaded, enabled extension (manager-owned). */
	openExtension: ((url: string) => Promise<BrowserWindow>) | null;
	/** Whether `id` is installed AND enabled in the manager right now. */
	isActiveExtension: ((id: string) => boolean) | null;
	mayActivateTab: (() => boolean) | null;
}

const adapters = new WeakMap<Session, AdapterBinding>();

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
	const open = async (url: string): Promise<[WebContents, BrowserWindow]> => {
		const id = extensionIdOfUrl(url);
		if (id) {
			// Only an installed+enabled extension's OWN pages open in an extension
			// window; never as a registry tab, which would put chrome-extension://
			// documents within agent/CDP reach.
			if (!binding.isActiveExtension?.(id))
				throw new Error("Unsupported extension page");
			const window = await binding.openExtension?.(url);
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
			void binding.openExtension(url).catch(() => {
				/* The caller receives no vendor exception text. */
			});
		},
		createTab: (details) => open(details.url ?? "about:blank"),
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
			return (await open(urls[0]))[1];
		},
		// An extension must not close the app's browser window.
		removeWindow: (window) => {
			if (!window.isDestroyed() && window !== binding.hooks?.window)
				window.close();
		},
		requestPermissions: async () => false,
	});
	adapters.set(session, binding);
	return binding;
}
