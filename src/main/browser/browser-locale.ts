import type { BrowserWindow } from "electron";
import { subscribeLocale } from "../../i18n/locale";

/**
 * Untitled tab names are resolved by main in chromeState(), but the renderer
 * retains that projection between browser events. Notify only AFTER main's
 * authoritative locale moves: renderer renegotiation may finish before main's
 * capabilities read, and an earlier refresh would cache the old title again.
 *
 * This is projection invalidation only. Do not navigate, reload, persist a
 * translated title, or capture session state for a language change. The normal
 * host teardown/rollback owns the returned unsubscribe, just like IPC handlers.
 */
export function observeBrowserLocale(window: BrowserWindow): () => void {
	return subscribeLocale(() => {
		if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
			window.webContents.send("browser-state-changed");
		}
	});
}
