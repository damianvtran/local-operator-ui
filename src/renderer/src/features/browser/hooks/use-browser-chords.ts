import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	type BrowserChordMessage,
	browserChordIntent,
} from "../../../../../shared/browser-chord";
import { browserBridge } from "../model/browser-projection-store";
import { chordTarget } from "../model/tab-index-model";
import type { BrowserChrome, BrowserTabView } from "./use-browser-chrome";

const MAC_PLATFORM = /Mac|iPhone|iPad/;

/** Main owns physical key/menu arbitration; this surface owns scope and DOM
 * focus. The DOM door also answers scripted KeyboardEvents (which never pass
 * Electron's hook). It claims the event before app navigation bubbles to window.
 * Commands are queued, not debounced: legitimate rapid tab cycling is retained. */
export function useBrowserChords(
	chrome: BrowserChrome,
	tabs: BrowserTabView[],
	sessionId: string | null,
	address: RefObject<HTMLInputElement>,
) {
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const findReturnToPage = useRef(false);
	const latest = useRef({ chrome, tabs, sessionId });
	latest.current = { chrome, tabs, sessionId };
	const rootRef = useRef<HTMLDivElement | null>(null);
	rootRef.current = root;
	/**
	 * Close one tab; the strip button and the keyboard command share it, so the
	 * last-visible-tab replacement and a refusal cannot depend on HOW a tab was
	 * closed. Reports whether a replacement blank tab was opened so the keyboard
	 * path can put the caret in its address bar (UX r1 U2, last-tab case).
	 *
	 * WHY FOCUS IS MOVED BEFORE THE CLOSE (UX r1 U2). A keyboard close with focus on
	 * the closing tab's own button removes the focused element. Chromium then fires
	 * `focusout` with a null `relatedTarget`, the surface reports "focus left the
	 * browser", main stops claiming the chords, and the NEXT Cmd+W falls through to
	 * the application menu and closes the whole app window. Handing the caret to the
	 * surface root (a `tabIndex={-1}` holder that outlives every tab) BEFORE the node
	 * goes means the focus move stays inside the surface, so no leave is ever
	 * reported. Only a focus that is inside the closing tab's own row moves: a caret
	 * in the address bar or on another control is not ours to take.
	 */
	const closeAndReplace = useCallback(
		async (tabId: number): Promise<{ closed: boolean; replaced: boolean }> => {
			const current = latest.current;
			if (!current.tabs.some((tab) => tab.tabId === tabId))
				return { closed: false, replaced: false };
			const surface = rootRef.current;
			const focused = document.activeElement;
			if (
				surface &&
				focused instanceof Element &&
				surface.contains(focused) &&
				focused.closest(`[data-tab-id="${tabId}"]`)
			)
				surface.focus({ preventScroll: true });
			const closed = await current.chrome.closeTab(tabId);
			const replaced = closed && current.tabs.length === 1;
			if (replaced) await current.chrome.newTab(current.sessionId);
			return { closed, replaced };
		},
		[],
	);
	const closeTab = useCallback(
		async (tabId: number): Promise<boolean> =>
			(await closeAndReplace(tabId)).closed,
		[closeAndReplace],
	);
	useEffect(() => {
		if (!root) return;
		const api = browserBridge();
		if (!api) return;
		let alive = true;
		let chain = Promise.resolve();
		let cursor: number | null =
			latest.current.chrome.state?.activeTabId ?? null;
		let projectedCursor = cursor;
		const report = (focused: boolean) => {
			void api.setChordFocus(focused).catch(() => {});
		};
		const focusAddress = () => {
			address.current?.focus();
			address.current?.select();
		};
		const projectionDropped = async (tabId: number): Promise<void> => {
			for (let waited = 0; waited < 1000; waited += 5) {
				if (!latest.current.tabs.some((tab) => tab.tabId === tabId)) return;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
		};
		const execute = async ({ intent, origin }: BrowserChordMessage) => {
			if (!alive) return;
			const current = latest.current;
			const c = current.chrome;
			const projected = c.state?.activeTabId ?? null;
			if (projected !== projectedCursor) {
				cursor = projected;
				projectedCursor = projected;
			}
			if (projected !== null && intent === "find-page") {
				findReturnToPage.current = origin === "page";
				await c.pageControl(projected, "open");
				// Repeating Cmd+F while the row is already open must return its caret
				// too; the mount effect alone would only handle the first opening.
				const field = rootRef.current?.querySelector<HTMLInputElement>(
					"[data-tour-tag=browser-find-row] input",
				);
				field?.focus({ preventScroll: true });
				field?.select();
				return;
			}
			if (projected !== null && intent.startsWith("zoom-")) {
				await c.pageControl(
					projected,
					intent === "zoom-in" ? "in" : intent === "zoom-out" ? "out" : "reset",
				);
				return;
			}
			if (intent === "focus-address") {
				focusAddress();
				return;
			}
			if (intent === "new-tab") {
				await c.newTab(current.sessionId);
				focusAddress();
				return;
			}
			if (intent === "reopen-tab") {
				await c.reopenTab(current.sessionId);
				return;
			}
			if (intent === "reload" || intent === "hard-reload") {
				await c.reload(intent === "hard-reload");
				return;
			}
			if (intent === "back" || intent === "forward") {
				await c.history(intent);
				return;
			}
			// Reset the queue's cursor only when the last target is no longer in this
			// projection. A delayed projection must not collapse two rapid cycles.
			if (!current.tabs.some((tab) => tab.tabId === cursor))
				cursor = c.state?.activeTabId ?? null;
			if (intent === "close-tab") {
				const id = c.state?.activeTabId;
				if (id != null && current.tabs.some((tab) => tab.tabId === id)) {
					const { closed, replaced } = await closeAndReplace(id);
					// Queued presses must not read the pre-close projection: a second
					// Cmd+W would otherwise target the tab that is already gone. This
					// waits for the projection (a bound, not a debounce: it ends the
					// moment the tab leaves the list), so rapid presses stay ordered.
					if (closed) await projectionDropped(id);
					if (replaced) focusAddress();
				}
			} else {
				const target = chordTarget(current.tabs, cursor, intent);
				if (target !== null) {
					cursor = target;
					await c.activateTab(target);
				}
			}
			if (origin === "page" && alive) await api.focusPage();
		};
		const enqueue = (message: BrowserChordMessage) => {
			// Hook-to-renderer messages are internal main output, not an agent door.
			chain = chain.then(() => execute(message)).catch(() => {});
		};
		const key = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const platform = MAC_PLATFORM.test(navigator.platform)
				? "darwin"
				: "linux";
			const intent = browserChordIntent(
				{
					type: "keyDown",
					key: event.key,
					// Backs up the tab digits only, for layouts whose digit row types a
					// symbol (AZERTY): the physical key is the ordinal there too.
					code: event.code,
					meta: event.metaKey,
					control: event.ctrlKey,
					alt: event.altKey,
					shift: event.shiftKey,
					isAutoRepeat: event.repeat,
					isComposing: event.isComposing,
				},
				platform,
			);
			if (!intent) return;
			event.preventDefault();
			event.stopPropagation();
			enqueue({ intent, origin: "chrome" });
		};
		const focusIn = () => report(true);
		const focusOut = (event: FocusEvent) => {
			if (
				event.relatedTarget instanceof Node &&
				root.contains(event.relatedTarget)
			)
				return;
			const target = event.target;
			// A focused node that is REMOVED (a tab closed by the agent, by the strip's
			// own path, or by anything that does not go through `closeAndReplace`)
			// fires `focusout` with a null `relatedTarget` too, and is not the user
			// leaving. Decided one microtask later, when the removal has landed: a node
			// that is gone while the surface is still mounted keeps the owner, and the
			// caret is parked on the root so the next chord is still heard.
			queueMicrotask(() => {
				if (
					target instanceof Node &&
					!target.isConnected &&
					root.isConnected &&
					!root.contains(document.activeElement)
				) {
					root.focus({ preventScroll: true });
					return;
				}
				if (!root.contains(document.activeElement)) report(false);
			});
		};
		root.addEventListener("keydown", key);
		root.addEventListener("focusin", focusIn);
		root.addEventListener("focusout", focusOut);
		report(root.contains(document.activeElement));
		const unsubscribe = api.onChord(enqueue);
		return () => {
			alive = false;
			report(false);
			unsubscribe();
			root.removeEventListener("keydown", key);
			root.removeEventListener("focusin", focusIn);
			root.removeEventListener("focusout", focusOut);
		};
	}, [root, address, closeAndReplace]);
	return { root: setRoot, closeTab, findReturnToPage };
}
