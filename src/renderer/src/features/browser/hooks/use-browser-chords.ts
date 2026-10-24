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
import {
	subscribeBrowserView,
	suppressedOverlayIdsSnapshot,
} from "../../../shared/browser-view-policy";
import { chordPlatform } from "../../../shared/navigation-gesture";
import { browserBridge } from "../model/browser-projection-store";
import { browserOverlaySuppressing } from "../model/self-suppression";
import { chordTarget } from "../model/tab-index-model";
import type { BrowserChrome, BrowserTabView } from "./use-browser-chrome";

const STANDALONE_BROWSER_ROUTE = /^#\/browser(?:[/?]|$)/;

// A document can mount more than one scoped browser. Resolve ONE owner before
// consuming an event or a main-process broadcast; a global listener per surface
// without this arbitration would create two tabs for one physical press.
const chordRoots = new Set<HTMLDivElement>();

/**
 * Stand a browser surface up as a chord root, and hand back its disposer.
 *
 * The registry is a module-level Set rather than render state, so the ONE
 * question every other surface has to ask it - "is the browser the keyboard
 * owner right now?" - is answerable without a component: this export is what
 * `scripts/session-switcher.test.mjs` registers a root with, and the hook below
 * is its only other caller. Extracted rather than duplicated because the
 * alternative is a second, drifted copy of the ownership rule in whatever
 * surface needs the answer next.
 */
export function registerBrowserChordRoot(root: HTMLDivElement): () => void {
	chordRoots.add(root);
	return () => {
		chordRoots.delete(root);
	};
}

/**
 * Whether the keyboard is inside the in-app browser panel, i.e. whether Ctrl+Tab
 * and Ctrl+Shift+Tab are the BROWSER's tab chords rather than the app's.
 *
 * THE RULE, in one sentence. When keyboard focus is inside the in-app browser
 * panel - its tab strip, address bar/popout, start page, or the web page itself -
 * Ctrl+Tab and Ctrl+Shift+Tab switch browser tabs; everywhere else, the console
 * included, they open the session switcher, except while Tab is already claimed
 * for a list: the composer's slash list, or the canvas editor's list item it
 * nests. (docs/session-switcher.md carries the same sentence.)
 *
 * The console half is code, not a sentence: its xterm key handler hands the chord
 * back to the page (`console-mirror.tsx`), because xterm otherwise consumes it as
 * a plain tab before this predicate is ever asked. The two lists claim Tab with
 * `preventDefault` on a press they own, which the switcher's own listener reads.
 *
 * It wraps `chordOwner`, which is the arbitration the browser's own DOM door
 * already does, so the two surfaces cannot disagree: if the browser would take
 * the press, it says so here, and the switcher stays out of the way. This
 * function is the ARBITER and not a hint - the switcher checks it on both keys
 * and bails on true. `event.defaultPrevented` is not part of the decision: the
 * press has to be claimed by one door or the other regardless of which listener
 * happens to run first.
 *
 * A press that reaches a NATIVE `WebContentsView` never arrives in this DOM at
 * all - the view's own `before-input-event` hook in main answers it - so the
 * page case this returns false for is a pane whose focus is logical (the strip,
 * the start page) and never the driven page itself.
 */
export function browserOwnsTabChord(
	document: Document,
	target?: Node | null,
): boolean {
	return chordOwner(document, target ?? document.activeElement) !== null;
}

const reportedFocus = new WeakMap<Document, boolean>();
function availableRoots(document: Document): HTMLDivElement[] {
	// THE VIEW BEING HIDDEN IS NOT THE SAME FACT AS AN OVERLAY COVERING THE
	// BROWSER (S4a). The surface registers its own start page and load-failure
	// panel in this registry so the native view stops painting over their DOM;
	// those two states are still the browser, and their keyboard belongs to it.
	// `browserOverlaySuppressing` filters exactly those self-registrations (the
	// one list lives in the model module, shared with the surface). Only a real
	// overlay - dialog, menu, picker - takes the chords away.
	if (browserOverlaySuppressing(suppressedOverlayIdsSnapshot())) return [];
	return [...chordRoots].filter((root) => {
		if (
			root.ownerDocument !== document ||
			!root.isConnected ||
			root.closest('[hidden], [inert], [aria-hidden="true"]')
		)
			return false;
		for (let node: HTMLElement | null = root; node; node = node.parentElement) {
			const style = document.defaultView?.getComputedStyle(node);
			if (
				style?.display === "none" ||
				style?.visibility === "hidden" ||
				style?.visibility === "collapse"
			)
				return false;
		}
		return true;
	});
}
function chordOwner(
	document: Document,
	target: Node | null = document.activeElement,
): HTMLDivElement | null {
	const roots = availableRoots(document);
	const direct = roots.filter(
		(root) =>
			root.contains(target) ||
			root.closest('[data-tour-tag="browser-pane"]')?.contains(target),
	);
	if (direct.length) return direct.length === 1 ? direct[0] : null;
	// Stage A actual CDP reached BODY on #/browser with the correct key, but
	// root-only listeners/focus reports dropped it. BODY is a browser rest-stop
	// ONLY on the standalone route and ONLY for its sole visible surface. A
	// chat BODY, sidebar control, dialog or ambiguous pair never inherits it.
	return target === document.body &&
		roots.length === 1 &&
		roots[0].dataset.tourTag === "browser-route" &&
		STANDALONE_BROWSER_ROUTE.test(document.defaultView?.location.hash ?? "")
		? roots[0]
		: null;
}

/** Main owns physical key/menu arbitration; this surface owns scope and DOM
 * focus. The DOM door also answers scripted KeyboardEvents (which never pass
 * Electron's hook). It claims the event before app navigation bubbles to window.
 * Commands are queued, not debounced: legitimate rapid tab cycling is retained. */
/**
 * The address row's own door. S5 made the field permanent, so a raise is a focus
 * request rather than a mount: the surface bumps a nonce and the row applies it.
 * There is no `close()` — nothing is ever raised to lower; a new tab's start
 * state focuses the same row, and a tab switch is main's own dismissal.
 */
export interface AddressController {
	raise: (options?: { origin?: "page" | "chrome"; seed?: string }) => void;
}

export function useBrowserChords(
	chrome: BrowserChrome,
	tabs: BrowserTabView[],
	sessionId: string | null,
	address: RefObject<AddressController>,
	/** The surface's own-state fact, shared with the page menu (see surface). */
	browserOwnState: boolean,
) {
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const findReturnToPage = useRef(false);
	const latest = useRef({ chrome, tabs, sessionId, browserOwnState });
	latest.current = { chrome, tabs, sessionId, browserOwnState };
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
	const findSession = useRef<number | null>(null);
	const findTabId = chrome.state?.pageControls?.find?.tabId ?? null;
	useEffect(() => {
		if (findTabId === null) findSession.current = null;
	}, [findTabId]);
	/** One door for toolbar and chords. Re-focus must not replace the ORIGINAL
	 * native-page return ownership with the app document's stale activeElement.
	 * Reserve synchronously too: a second press can precede IPC projection. */
	const openFind = useCallback(async (origin: "page" | "chrome" = "chrome") => {
		const c = latest.current.chrome;
		const tabId = c.state?.activeTabId;
		if (tabId == null) return;
		/* The surface's one own-state fact, shared with the disabled menu
		   (Q4-3/Q5 U27): start and failure pages refuse controls; an empty URL is
		   start, while `about:blank` during a submitted load is a real page. */
		if (latest.current.browserOwnState) return;
		if (
			c.state?.pageControls?.find?.tabId !== tabId &&
			findSession.current !== tabId
		) {
			findReturnToPage.current = origin === "page";
			findSession.current = tabId;
		}
		await c.pageControl(tabId, "open");
		if (latest.current.chrome.state?.activeTabId !== tabId) return;
		const field = rootRef.current?.querySelector<HTMLInputElement>(
			"[data-tour-tag=browser-find-row] input",
		);
		field?.focus({ preventScroll: true });
		field?.select();
	}, []);
	useEffect(() => {
		if (!root) return;
		const api = browserBridge();
		if (!api) return;
		const document = root.ownerDocument;
		const releaseChordRoot = registerBrowserChordRoot(root);
		let alive = true;
		let chain = Promise.resolve();
		let cursor: number | null =
			latest.current.chrome.state?.activeTabId ?? null;
		let projectedCursor = cursor;
		const report = (focused: boolean, force = false) => {
			if (!force && reportedFocus.get(document) === focused) return;
			reportedFocus.set(document, focused);
			void api.setChordFocus(focused).catch(() => {});
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
				await openFind(origin);
				return;
			}
			if (projected !== null && intent.startsWith("zoom-")) {
				if (latest.current.browserOwnState) return;
				await c.pageControl(
					projected,
					intent === "zoom-in" ? "in" : intent === "zoom-out" ? "out" : "reset",
				);
				return;
			}
			if (intent === "focus-address") {
				address.current?.raise({ origin });
				return;
			}
			if (intent === "new-tab") {
				await c.newTab(current.sessionId);
				// The new tab is its start page; the surface focuses the permanent
				// row when that state becomes current, so there is no second field to
				// send focus to and nothing to lower.
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
					const { closed } = await closeAndReplace(id);
					// Queued presses must not read the pre-close projection: a second
					// Cmd+W would otherwise target the tab that is already gone. This
					// waits for the projection (a bound, not a debounce: it ends the
					// moment the tab leaves the list), so rapid presses stay ordered.
					if (closed) await projectionDropped(id);
					// A replacement blank tab is a start page; the surface focuses the row
					// when that state becomes current (the close result's own `replaced`
					// stays for the strip's caret restore, which is its other consumer).
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
			if (
				event.defaultPrevented ||
				!(event.target instanceof Node) ||
				chordOwner(document) !== root ||
				chordOwner(document, event.target) !== root
			)
				return;
			// `chordPlatform()` already answers the QUESTION ("mac" | "linux"); the
			// intent model names the same fact "darwin". Deriving darwin from
			// truthiness read every non-Mac host as mac, so a Linux user lost Ctrl+L/F/T/
			// R/W and the digits (agent review round 2, MAJOR-3).
			const platform = chordPlatform() === "mac" ? "darwin" : "linux";
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
			if (!intent) {
				/*
				 * THE PRINTABLE-KEY SEED (design §4, entry 2). A single character typed
				 * while the browser's own root owns focus — and the target is not
				 * editable — opens the popout with that character. This must NEVER run
				 * for a key that reached the driven page: that is a separate native
				 * view with no DOM target here. Space/Enter on a real control are
				 * activations, and a modifier combination is not typing.
				 */
				// CODE POINTS, not UTF-16 units (nit round 1, NIT-2): `event.key.length`
				// is 2 for every astral character, so an emoji or a CJK character
				// outside the BMP could not seed the field. A spread counts the
				// character the user actually pressed.
				if (
					[...event.key].length !== 1 ||
					event.metaKey ||
					event.ctrlKey ||
					event.altKey ||
					event.repeat ||
					event.isComposing
				)
					return;
				if (event.key === " ") {
					// Space activates a focused button/tab; only text fields take it as
					// a character, and those are excluded below.
					const focused = event.target;
					if (
						focused instanceof Element &&
						focused.closest("button, [role=tab], [role=menuitem], a[href]")
					)
						return;
				}
				const target = event.target;
				if (target instanceof Element) {
					if (
						target.closest(
							'input, textarea, [contenteditable="true"], [contenteditable=""], [role=menu], [role=dialog], [role=combobox]',
						)
					)
						return;
				} else if (!(target instanceof Node)) return;
				event.preventDefault();
				event.stopPropagation();
				report(true, true);
				address.current?.raise({ origin: "chrome", seed: event.key });
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			// Main clears its report on restart/teardown; a real accepted DOM press
			// reasserts the derived owner, never an OS/window focus override.
			report(true, true);
			enqueue({ intent, origin: "chrome" });
		};
		const reconcile = (force = false) =>
			report(chordOwner(document) !== null, force);
		const focusIn = () => reconcile();
		const focusOut = (event: FocusEvent) => {
			const target = event.target;
			const wasOwned =
				target instanceof Node && chordOwner(document, target) === root;
			queueMicrotask(() => {
				if (!alive) return;
				// Keep the existing removed-tab caret guarantee, but never park focus
				// for a CHAT node removed outside this browser's ownership boundary.
				if (
					wasOwned &&
					target instanceof Node &&
					!target.isConnected &&
					availableRoots(document).includes(root) &&
					document.activeElement === document.body &&
					chordOwner(document) === null
				)
					root.focus({ preventScroll: true });
				reconcile();
			});
		};
		const refresh = () => reconcile();
		const regainFocus = () => reconcile(true);
		// Listen in bubble phase: a child/portal that already consumed the chord
		// keeps it. One derived owner arbitrates all surfaces, including Pane's
		// existing header ancestor, before an event can reach app/window handlers.
		document.addEventListener("keydown", key);
		document.addEventListener("focusin", focusIn);
		document.addEventListener("focusout", focusOut);
		window.addEventListener("hashchange", refresh);
		window.addEventListener("resize", refresh);
		window.addEventListener("focus", regainFocus);
		const stopPolicy = subscribeBrowserView(refresh);
		const observer = new MutationObserver(refresh);
		for (let node: HTMLElement | null = root; node; node = node.parentElement)
			observer.observe(node, {
				attributes: true,
				attributeFilter: ["hidden", "inert", "aria-hidden", "class", "style"],
			});
		reconcile();
		const unsubscribe = api.onChord((message) => {
			const owner = chordOwner(document);
			const candidates = availableRoots(document);
			// Main already authenticated a real presented page for page-origin
			// output. Its native focus may leave no DOM owner; only the sole visible
			// surface containing the active tab may receive that fallback. Never
			// broadcast the same invocation into two scoped panes.
			if (
				message.origin === "page" &&
				!latest.current.tabs.some(
					(tab) => tab.tabId === latest.current.chrome.state?.activeTabId,
				)
			)
				return;
			if (
				owner === root ||
				(message.origin === "page" &&
					owner === null &&
					candidates.length === 1 &&
					candidates[0] === root)
			)
				enqueue(message);
		});
		return () => {
			alive = false;
			releaseChordRoot();
			reconcile(); // removing hidden B must not clear the still-focused A
			unsubscribe();
			stopPolicy();
			observer.disconnect();
			document.removeEventListener("keydown", key);
			document.removeEventListener("focusin", focusIn);
			document.removeEventListener("focusout", focusOut);
			window.removeEventListener("hashchange", refresh);
			window.removeEventListener("resize", refresh);
			window.removeEventListener("focus", regainFocus);
		};
	}, [root, address, closeAndReplace, openFind]);
	return { root: setRoot, closeTab, findReturnToPage, openFind };
}
