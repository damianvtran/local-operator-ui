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

/** This is an adapter inside HashRouter, not a second router. `push`/`replace`
 * must be observed synchronously: React may batch two route writes into one
 * render even though both native entries still exist. The v6 navigator context
 * is the seam shared by Link, Navigate and useNavigate. Leave its URL building,
 * state and POP notification to the original navigator. */
export function DesktopNavigationRouter({ children }: { children: ReactNode }) {
	const routing = useContext(UNSAFE_NavigationContext);
	const [history] = useState(() => {
		const tracker = new DesktopNavigationHistory();
		tracker.visit(nativeIndex(), window.location.hash, "pop");
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
			history.visit(nativeIndex(), window.location.hash, action);
			publish();
		};
		const step = (direction: HistoryDirection) => {
			const offset = history.offset(direction);
			if (offset === undefined) return false;
			pending.current = true;
			navigator.go(offset);
			return true;
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
			context: {
				...routing,
				navigator: {
					...navigator,
					push: (to, state, options) => {
						if (
							new URL(navigator.createHref(to), window.location.href).hash ===
							window.location.hash
						) {
							// Some callers attach a focus intent to an already-open page.
							// Deliver it via replace without losing the forward branch.
							if (state != null && state !== window.history.state?.usr) {
								navigator.replace(to, state, options);
								visit("replace");
							}
							return;
						}
						navigator.push(to, state, options);
						visit("push");
					},
					replace: (to, state, options) => {
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
		return () => window.removeEventListener("popstate", adapter.onPop);
	}, [adapter]);

	return (
		<UNSAFE_NavigationContext.Provider value={adapter.context}>
			<DesktopNavigationContext.Provider value={availability}>
				{children}
			</DesktopNavigationContext.Provider>
		</UNSAFE_NavigationContext.Provider>
	);
}
