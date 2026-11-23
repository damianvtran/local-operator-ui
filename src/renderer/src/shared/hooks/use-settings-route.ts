/**
 * Where Settings came from, and how it closes.
 *
 * SETTINGS IS A ROUTE, NOT AN OVERLAY (`app.tsx`'s `<Route path="/settings">`),
 * and it fills the main column over the chat sidebar. The operator's report was
 * that it could not be closed at all: there is no browser chrome here, so a
 * route change into Settings was one-way unless the reader used the sidebar.
 *
 * WHY THE PREVIOUS ROUTE IS REMEMBERED IN MEMORY. `history.back()` is the
 * obvious wrong answer: the settings page pushes history entries of its own
 * (section links, searches), so back would step through the page's own trail and
 * a cold deep link would leave the app entirely. What "close" means is "return
 * to where you were before Settings", which is one pathname+search - not a stack
 * - and it is memory-only: a relaunch that deep-links into Settings has no
 * previous route, and the fallback below is the honest answer there.
 *
 * In-Settings navigation (a `?section=` query change) must NOT overwrite the
 * target, which is why the tracker keys on the PATHNAME and only records on the
 * way in. `/` renders `<Navigate to="/chat" replace />`, so `/chat` is the
 * fallback a cold open uses rather than a guess at a home route.
 */
import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** The route Settings is, in the app's own route table. */
export const SETTINGS_PATH = "/settings";

/** Where Close lands when Settings was opened cold: a deep link at launch. */
export const SETTINGS_CLOSE_FALLBACK = "/chat";

/** `pathname + search` of the route the reader left to enter Settings. */
let returnTarget: string | null = null;

/** The last location seen OUTSIDE Settings, kept so re-entry can pin it again. */
let lastOutsideRoute: string | null = null;

/**
 * Remember the route Settings is entered FROM. Mounted once, in `App`, so the
 * record exists before the page (or its lazy chunk) can mount.
 *
 * A pathname change is what counts as entering: while the page is open its
 * query changes every time a section is chosen, and those are the same visit.
 */
export function useSettingsReturnTracking(): void {
	const { pathname, search } = useLocation();
	/*
	 * An effect rather than a write during render: the record is module state,
	 * and a render may run twice (StrictMode) or be thrown away. The target is
	 * only read by a press, which cannot arrive before the commit that follows.
	 */
	useEffect(() => {
		if (pathname === SETTINGS_PATH) {
			// Re-pinning the SAME outside route on every in-page query change is
			// harmless by construction: `lastOutsideRoute` only moves outside Settings.
			returnTarget = lastOutsideRoute;
			return;
		}
		lastOutsideRoute = `${pathname}${search}`;
	}, [pathname, search]);
}

/**
 * The one "close Settings" action: the page's button, its Esc scope and the
 * sidebar gear all call this, so the three cannot disagree about the target.
 */
export function useCloseSettings(): () => void {
	const navigate = useNavigate();
	return useCallback(() => {
		const target = returnTarget ?? SETTINGS_CLOSE_FALLBACK;
		// Consumed, not just read: a stale target after the visit would answer a
		// later cold open with a route from an earlier one.
		returnTarget = null;
		/*
		 * `replace`, so the route the reader returns to does not grow a history
		 * entry for a page they have left. The router's own back stack is the
		 * browser's, and this app's sidebar is the way around it.
		 */
		navigate(target, { replace: true });
	}, [navigate]);
}

/** Test seam: the record is module state, and each case starts from nothing. */
export function __resetSettingsReturn(): void {
	returnTarget = null;
	lastOutsideRoute = null;
}
