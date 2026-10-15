import {
	type BrowserChord,
	type BrowserChordInput,
	type BrowserChordMessage,
	browserChordIntent,
} from "../../shared/browser-chord";

/** Logical DOM ownership survives OS deactivation; it must never itself authorize
 * an inactive/hidden window or a browser covered by a real overlay. Keeping these
 * native facts separate avoids losing the owner before a menu accelerator can
 * arrive on reactivation, while retaining the actual window-focus security floor.
 * This is a predicate, not focus emulation: callers read real Electron facts. */
export function browserChromeOwnsChord(facts: {
	logicalFocus: boolean;
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
		!facts.window.isDestroyed() &&
		facts.window.isVisible() &&
		facts.window.isFocused()
	);
}

/** Dependency-injected because listener logic must be falsifiable without a
 * focused OS window. Emitting before-input-event tests this router, NOT physical
 * key delivery. The event source must already have passed the ownership check. */
/** A menu's target is Electron's callback window, not the app's global main
 * window. OAuth/mini windows must retain their own reload/close even if chrome
 * has a stale focus report. No target means no action, as with Electron roles. */
export function runBrowserMenuAction<
	T extends {
		webContents?: { reload(): void; reloadIgnoringCache(): void };
		close(): void;
	},
>(
	intent: "reload" | "hard-reload" | "close-tab",
	target: T | null | undefined,
	owner: T | null,
	route: (intent: BrowserChord) => boolean,
): void {
	if (!target) return;
	if (target === owner && route(intent)) return;
	if (intent === "reload") target.webContents?.reload();
	else if (intent === "hard-reload") target.webContents?.reloadIgnoringCache();
	else target.close();
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
