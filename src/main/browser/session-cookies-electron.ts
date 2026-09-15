import type { WebContentsView } from "electron";
import { safeStorage } from "electron";
import { BROWSER_PARTITION } from "./profile";
import {
	type CookieJarTransport,
	type VaultCipher,
	createDebuggerCookieJar,
	createSafeStorageCipher,
} from "./session-cookies";

/**
 * The Electron-side adapters for the session-cookie vault.
 *
 * Split out so `session-cookies.ts` stays free of runtime `electron` imports: it
 * is the module the desktop suite bundles in memory and drives with a fake jar,
 * and an import of the real `electron` package there would make that impossible.
 * Everything Electron-shaped lives here, and `index.ts` is the only caller.
 *
 * WHAT THE HIDDEN VIEW IS, AND IS NOT: it is a `WebContentsView` in the browser
 * partition that is NEVER added to a window's content view, so it is never laid
 * out, painted or shown — it exists only to give the debugger a target in the
 * right partition. It is not the app's renderer, it has no preload and no bridge,
 * and it is not reachable from the agent RPC surface. Its webPreferences are the
 * same ones a driven tab gets (sandbox, context isolation, no node integration),
 * because the reason for them is the same: a page must never reach the app.
 */
export interface HiddenCookieJarTarget {
	jar: CookieJarTransport;
	/** Release the view's renderer. Safe to call twice or after a failure. */
	dispose(): void;
}

/** The keychain-backed cipher, over Electron's `safeStorage`. */
export function browserProfileCipher(): VaultCipher {
	return createSafeStorageCipher(safeStorage);
}

/**
 * The webPreferences for the hidden view. Exported as data so the module that
 * builds it needs no Electron import here, and so the policy has one definition.
 */
export const HIDDEN_COOKIE_JAR_WEB_PREFERENCES = {
	partition: BROWSER_PARTITION,
	contextIsolation: true,
	nodeIntegration: false,
	webSecurity: true,
	allowRunningInsecureContent: false,
	sandbox: true,
	// No `preload`: nothing here should ever have a bridge to the app.
} as const;

/**
 * Build the CDP jar over a hidden view the caller created with
 * `HIDDEN_COOKIE_JAR_WEB_PREFERENCES`.
 *
 * `WebContentsView` is used rather than a `BrowserWindow` because a window can be
 * shown, focused and raised, and this feature must be able to promise it does
 * none of those: a view that is never attached to a window has no surface at all.
 * The webContents is closed explicitly on dispose — Electron does not destroy a
 * `WebContentsView`'s webContents for you, and the leak is a whole renderer
 * process (the same rule `releaseView` in `index.ts` follows).
 */
export function createHiddenCookieJarTarget(
	view: WebContentsView,
): HiddenCookieJarTarget {
	const jar = createDebuggerCookieJar({
		debugger: view.webContents.debugger,
		loadAboutBlank: () =>
			view.webContents.loadURL("about:blank").then(() => undefined),
	});
	return {
		jar,
		dispose() {
			try {
				if (!view.webContents.isDestroyed()) view.webContents.close();
			} catch {
				// Already gone.
			}
		},
	};
}
