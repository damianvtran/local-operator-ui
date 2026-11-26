import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import {
	type ReactNode,
	createContext,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";
import {
	type ChatSelection,
	DesktopNavigationHistory,
	type HistoryDirection,
} from "./desktop-navigation-history";

const DesktopNavigationContext = createContext({
	canBack: false,
	canForward: false,
});

export function useDesktopNavigationAvailability() {
	return useContext(DesktopNavigationContext);
}

function nativeIndex(): number | undefined {
	const index: unknown = window.history.state?.idx;
	return typeof index === "number" && Number.isSafeInteger(index)
		? index
		: undefined;
}

const BARE_CHAT = /^#\/chat\/?(?:[?#]|$)/;

// A saved-chat deep link already carries its ID. Only bare Chat addresses
// need renderer-local selection metadata; neither draft keys nor any input text
// belong in the URL or in React Router's caller-owned history state.
function selectionFor(address: string): ChatSelection | undefined {
	if (!BARE_CHAT.test(address)) return;
	const { activeDraftKey, activeSessionId } =
		useCanonicalSessionsStore.getState();
	if (activeDraftKey) return { kind: "draft", id: activeDraftKey };
	if (activeSessionId) return { kind: "session", id: activeSessionId };
	return null;
}

function restoreSelection(selection: ChatSelection) {
	const store = useCanonicalSessionsStore.getState();
	if (selection?.kind === "session") {
		if (store.activeSessionId !== selection.id || store.activeDraftKey)
			void store.openSession(selection.id);
	} else if (selection?.kind === "draft" && store.drafts[selection.id]) {
		if (store.activeDraftKey !== selection.id) store.openDraft(selection.id);
	} else if (store.activeDraftKey || store.activeSessionId) {
		// A discarded draft cannot be re-created by traversal. An absent target
		// opens the catalogue, not whichever unrelated chat we just left.
		store.setActiveSession(null);
	}
}

/** This is an adapter inside HashRouter, not a second router. `push`/`replace`
 * must be observed synchronously: React may batch two route writes into one
 * render even though both native entries still exist. The v6 navigator context
 * is the seam shared by Link, Navigate and useNavigate. Leave its URL building,
 * state and POP notification to the original navigator. */
export function DesktopNavigationRouter({ children }: { children: ReactNode }) {
	const routing = useContext(UNSAFE_NavigationContext);
	const [history] = useState(() => {
		const tracker = new DesktopNavigationHistory();
		const address = window.location.hash;
		tracker.visit(nativeIndex(), address, "pop", selectionFor(address));
		return tracker;
	});
	const [availability, setAvailability] = useState({
		canBack: false,
		canForward: false,
	});
	// Chromium's history.go is asynchronous. Recalculate each queued click from
	// the entry that actually arrived, not the index when the mouse was pressed.
	const pending = useRef(false);
	const queued = useRef<HistoryDirection[]>([]);
	const adapter = useMemo(() => {
		const { navigator } = routing;
		const publish = () => {
			const canBack = history.offset(-1) !== undefined;
			const canForward = history.offset(1) !== undefined;
			setAvailability((previous) =>
				previous.canBack === canBack && previous.canForward === canForward
					? previous
					: { canBack, canForward },
			);
		};
		const visit = (action: "push" | "replace" | "pop") => {
			const index = nativeIndex();
			const address = window.location.hash;
			const saved =
				action === "pop" ? history.selectionAt(index, address) : undefined;
			if (saved !== undefined) restoreSelection(saved);
			history.visit(
				index,
				address,
				action,
				saved !== undefined ? saved : selectionFor(address),
			);
			publish();
		};
		const step = (direction: HistoryDirection) => {
			const offset = history.offset(direction);
			if (offset === undefined) return false;
			pending.current = true;
			navigator.go(offset);
			return true;
		};
		// A write wins over unfulfilled traversal requests. Hash history can
		// supersede a pending go without emitting POP, so waiting for that POP
		// would strand the queue. A POP that does arrive is still authoritative.
		const cancelSteps = () => {
			pending.current = false;
			queued.current.length = 0;
		};
		const onPop = () => {
			pending.current = false;
			visit("pop");
			for (const direction of queued.current.splice(0)) {
				if (pending.current) queued.current.push(direction);
				else step(direction);
			}
		};
		return {
			onPop,
			syncSelection: () => {
				const address = window.location.hash;
				const selection = selectionFor(address);
				if (selection !== undefined && !history.isCurrent(address, selection)) {
					history.visit(nativeIndex(), address, "replace", selection);
					publish();
				}
			},
			context: {
				...routing,
				navigator: {
					...navigator,
					push: (to, state, options) => {
						const address = new URL(
							navigator.createHref(to),
							window.location.href,
						).hash;
						if (history.isCurrent(address, selectionFor(address))) {
							// Some callers attach a focus intent to an already-open page.
							// Deliver it via replace without losing the forward branch.
							if (state != null && state !== window.history.state?.usr) {
								cancelSteps();
								navigator.replace(to, state, options);
								visit("replace");
							}
							return;
						}
						cancelSteps();
						navigator.push(to, state, options);
						visit("push");
					},
					replace: (to, state, options) => {
						cancelSteps();
						navigator.replace(to, state, options);
						visit("replace");
					},
					go: (delta) => {
						if (delta !== -1 && delta !== 1) return navigator.go(delta);
						if (pending.current) queued.current.push(delta);
						else step(delta);
					},
				},
			} satisfies typeof routing,
		};
	}, [routing, history]);

	useLayoutEffect(() => {
		window.addEventListener("popstate", adapter.onPop);
		// Draft admission/undo can change a pane in place. Sample that settled
		// selection only if the same native entry still owns the address. A
		// normal chat open stages its target *before* the synchronous route write;
		// sampling immediately would overwrite the entry it is leaving.
		let listening = true;
		const unsubscribe = useCanonicalSessionsStore.subscribe((next, prev) => {
			if (
				next.activeDraftKey === prev.activeDraftKey &&
				next.activeSessionId === prev.activeSessionId
			)
				return;
			const entry = window.history.state;
			const address = window.location.hash;
			queueMicrotask(() => {
				if (
					listening &&
					window.history.state?.key === entry?.key &&
					nativeIndex() === entry?.idx &&
					window.location.hash === address
				)
					adapter.syncSelection();
			});
		});
		return () => {
			listening = false;
			unsubscribe();
			window.removeEventListener("popstate", adapter.onPop);
		};
	}, [adapter]);

	return (
		<UNSAFE_NavigationContext.Provider value={adapter.context}>
			<DesktopNavigationContext.Provider value={availability}>
				{children}
			</DesktopNavigationContext.Provider>
		</UNSAFE_NavigationContext.Provider>
	);
}
