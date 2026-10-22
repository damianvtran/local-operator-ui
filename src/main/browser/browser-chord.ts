import {
	type BrowserChord,
	type BrowserChordInput,
	type BrowserChordMessage,
	browserChordIntent,
} from "../../shared/browser-chord";

/** The one native window floor both ownership predicates share: a destroyed,
 * hidden or unfocused window authorizes nothing. Kept in one function so the
 * chrome and page doors cannot drift into two opinions about the same facts. */
export function browserWindowForeground(window: {
	isDestroyed(): boolean;
	isVisible(): boolean;
	isFocused(): boolean;
}): boolean {
	return !window.isDestroyed() && window.isVisible() && window.isFocused();
}

/** Logical DOM ownership survives OS deactivation; it must never itself authorize
 * an inactive/hidden window or a browser covered by a real overlay. Keeping these
 * native facts separate avoids losing the owner before a menu accelerator can
 * arrive on reactivation, while retaining the actual window-focus security floor.
 * This is a predicate, not focus emulation: callers read real Electron facts. */
export function browserChromeOwnsChord(facts: {
	logicalFocus: boolean;
	/** `registry.chromeVisible`: the browser's chrome band is the presented UI.
	 * Deliberately NOT "the native view is visible": the browser's own start page
	 * and load-failure panel hide that view so their DOM can paint, and they still
	 * own the browser's keys. A real overlay is the only hide that clears this. */
	chromeVisible: boolean;
	window: {
		isDestroyed(): boolean;
		isVisible(): boolean;
		isFocused(): boolean;
	};
}): boolean {
	return (
		facts.logicalFocus &&
		facts.chromeVisible &&
		browserWindowForeground(facts.window)
	);
}

/** Whether the presented browser page is the native input owner.
 *
 * TWO NATIVE FACTS, ORed rather than one assumed: Electron's
 * `webContents.getFocusedWebContents()` is the documented answer, but a
 * `WebContentsView` can hold focus while that getter answers null (measured on
 * Electron 44.3.0: the view emits its own `focus` event while
 * `getFocusedWebContents()` stays null in a window that is not itself
 * activated). That event is therefore tracked by the host and
 * accepted as the second fact. Both are refused unless the ACTIVE tab is the
 * one presented, so a stale focus on a hidden/background view cannot route an
 * accelerator into a page the user cannot see; and the shared window floor
 * refuses a destroyed, hidden or unfocused window even when the focus facts are
 * stale. */
export function browserPageOwnsChord(facts: {
	activeTab: {
		tabId: number;
		webContentsId: number;
		presented: boolean;
	} | null;
	/** Read lazily: the getter is asked only after the window floor and the
	 * presented-tab check pass, so a startup/test host without it never throws. */
	focusedContents: () => number | null;
	focusedViewTabId: number | null;
	window: {
		isDestroyed(): boolean;
		isVisible(): boolean;
		isFocused(): boolean;
	};
}): boolean {
	const active = facts.activeTab;
	return Boolean(
		active?.presented &&
			browserWindowForeground(facts.window) &&
			(facts.focusedContents() === active.webContentsId ||
				facts.focusedViewTabId === active.tabId),
	);
}

/** Dependency-injected because listener logic must be falsifiable without a
 * focused OS window. Emitting before-input-event tests this router, NOT physical
 * key delivery. The event source must already have passed the ownership check. */
/** A menu's target is Electron's callback window, not the app's global main
 * window. OAuth/mini windows must retain their own reload/close even if chrome
 * has a stale focus report. A missing target is NOT automatically "no action":
 * a focused WebContentsView can reach an accelerator without one, so the
 * browser's native owner predicate is asked first. Only when that declines does
 * a missing target mean nothing happens. */
export function runBrowserMenuAction<
	T extends {
		webContents?: { reload(): void; reloadIgnoringCache(): void };
		close(): void;
	},
>(
	intent: "reload" | "hard-reload" | "close-tab" | "new-tab",
	target: T | null | undefined,
	owner: T | null,
	route: (intent: BrowserChord) => boolean,
): void {
	/*
	 * A MENU'S TARGET IS ELECTRON'S CALLBACK WINDOW, BUT IT IS NOT THE ONLY
	 * NATIVE FACT THAT NAMES THE OWNER. A focused `WebContentsView` can reach a
	 * menu accelerator with NO callback window at all, or with the window whose
	 * view is focused; the renderer-side focus report is not involved. So the
	 * browser route is asked FIRST when the callback window is the owner or
	 * absent, and its `ownsPage`/`ownsChrome` native facts decide. Outside the
	 * browser it returns false and the app fallback runs exactly as before.
	 *
	 * A DIFFERENT window (an OAuth/mini popup) still wins outright: its own
	 * reload/close belongs to it even if the main chrome's report is stale, and
	 * the popup is never the browser's owner.
	 */
	if (target && target !== owner) {
		if (intent === "reload") target.webContents?.reload();
		else if (intent === "hard-reload")
			target.webContents?.reloadIgnoringCache();
		else if (intent === "close-tab") target.close();
		// New tab has no other-window meaning; no window owns a browser tab.
		return;
	}
	if (route(intent)) return;
	if (!target) return;
	if (intent === "reload") target.webContents?.reload();
	else if (intent === "hard-reload") target.webContents?.reloadIgnoringCache();
	// New tab has no app fallback: outside the browser it is a deliberate no-op
	// (never a window close, which is what the old fallback would have done).
	else if (intent === "close-tab") target.close();
}

export function createBrowserChordRouter(options: {
	platform: string;
	ownsChrome: () => boolean;
	ownsPage: () => boolean;
	reload: (hard: boolean) => void;
	zoom?: (command: "in" | "out" | "reset") => void;
	history: (direction: "back" | "forward") => void;
	send: (message: BrowserChordMessage) => void;
	focusChrome: () => void;
}) {
	function dispatch(intent: BrowserChord, origin: "page" | "chrome"): void {
		if (intent === "reload" || intent === "hard-reload")
			options.reload(intent === "hard-reload");
		else if (intent === "back" || intent === "forward") options.history(intent);
		else if (intent.startsWith("zoom-") && options.zoom) {
			// Zoom does not need a DOM caret. Keep native page focus instead of
			// taking it through chrome just to send a renderer intent back to main.
			options.zoom(
				intent === "zoom-in" ? "in" : intent === "zoom-out" ? "out" : "reset",
			);
		} else {
			// Moving DOM focus never shows or activates a window. The helper refuses
			// an unfocused/hidden launch; the renderer still receives the intent.
			options.focusChrome();
			options.send({ intent, origin });
		}
	}
	function routeInput(
		event: { preventDefault(): void },
		input: BrowserChordInput,
		origin: "page" | "chrome",
		owns: boolean,
	): boolean {
		const intent = owns ? browserChordIntent(input, options.platform) : null;
		if (!intent) {
			// Rejected action-repeat/composition must not fall through into the
			// SAME menu accelerator. Consume only a recognized browser chord's
			// rejected key-down, without executing it; ordinary text still passes.
			const rejected =
				owns &&
				input.type === "keyDown" &&
				(input.isAutoRepeat || input.isComposing) &&
				browserChordIntent(
					{ ...input, isAutoRepeat: false, isComposing: false },
					options.platform,
				);
			if (rejected) {
				event.preventDefault();
				return true;
			}
			return false;
		}
		// Electron documents this also suppresses menu accelerators. Wiring adds
		// per-input ignoreMenuShortcuts as a defensive second suppression, never
		// a timestamp: rapid genuine presses must each execute exactly once.
		event.preventDefault();
		dispatch(intent, origin);
		return true;
	}
	return {
		input: routeInput,
		// Both main chrome doors must derive authorization HERE. An earlier app
		// zoom listener used the retained raw logical flag, bypassing native
		// visibility/focus checks before the later guarded listener ran (R1).
		// Keep rejected-repeat/IME consumption unchanged in the shared handler.
		chromeInput(
			event: { preventDefault(): void },
			input: BrowserChordInput,
		): boolean {
			return routeInput(event, input, "chrome", options.ownsChrome());
		},
		menu(intent: BrowserChord): boolean {
			const page = options.ownsPage();
			if (!page && !options.ownsChrome()) return false;
			dispatch(intent, page ? "page" : "chrome");
			return true;
		},
	};
}
