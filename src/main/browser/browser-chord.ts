import {
	type BrowserChord,
	type BrowserChordInput,
	type BrowserChordMessage,
	browserChordIntent,
} from "../../shared/browser-chord";

/** Dependency-injected because listener logic must be falsifiable without a
 * focused OS window. Emitting before-input-event tests this router, NOT physical
 * key delivery. The event source must already have passed the ownership check. */
export function createBrowserChordRouter(options: {
	platform: string;
	ownsChrome: () => boolean;
	ownsPage: () => boolean;
	reload: (hard: boolean) => void;
	history: (direction: "back" | "forward") => void;
	send: (message: BrowserChordMessage) => void;
	focusChrome: () => void;
}) {
	function dispatch(intent: BrowserChord, origin: "page" | "chrome"): void {
		if (intent === "reload" || intent === "hard-reload")
			options.reload(intent === "hard-reload");
		else if (intent === "back" || intent === "forward") options.history(intent);
		else {
			// Moving DOM focus never shows or activates a window. The helper refuses
			// an unfocused/hidden launch; the renderer still receives the intent.
			options.focusChrome();
			options.send({ intent, origin });
		}
	}
	return {
		input(
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
		},
		menu(intent: BrowserChord): boolean {
			const page = options.ownsPage();
			if (!page && !options.ownsChrome()) return false;
			dispatch(intent, page ? "page" : "chrome");
			return true;
		},
	};
}
