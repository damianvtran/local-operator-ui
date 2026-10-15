import { type RefObject, useEffect, useRef, useState } from "react";
import {
	type BrowserChordMessage,
	browserChordIntent,
} from "../../../../../shared/browser-chord";
import { browserBridge } from "../model/browser-projection-store";
import { chordTarget } from "../model/tab-index-model";
import type { BrowserChrome, BrowserTabView } from "./use-browser-chrome";

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
	const latest = useRef({ chrome, tabs, sessionId });
	latest.current = { chrome, tabs, sessionId };
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
		const execute = async ({ intent, origin }: BrowserChordMessage) => {
			if (!alive) return;
			const current = latest.current;
			const c = current.chrome;
			const projected = c.state?.activeTabId ?? null;
			if (projected !== projectedCursor) {
				cursor = projected;
				projectedCursor = projected;
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
					const closed = await c.closeTab(id);
					// Closing the last visible tab preserves the browser surface, with a
					// fresh user blank in its own scope, never a window-close fallback.
					if (closed && current.tabs.length === 1)
						await c.newTab(current.sessionId);
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
			const platform = /Mac|iPhone|iPad/.test(navigator.platform)
				? "darwin"
				: "linux";
			const intent = browserChordIntent(
				{
					type: "keyDown",
					key: event.key,
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
				!(event.relatedTarget instanceof Node) ||
				!root.contains(event.relatedTarget)
			)
				report(false);
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
	}, [root, address]);
	return setRoot;
}
