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
 *
 * THE TARGET IS CLEARED WHEN THE ROUTE LEAVES, NOT WHEN IT IS READ (round 1:
 * R3). Consuming it inside `close` made a second press before the navigation
 * committed - key auto-repeat, a double click, a Suspense fallback while the
 * destination chunk loads - fall through to `/chat` from a page that had a real
 * origin. The tracker's effect is idempotent and runs once per location.
 */
import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** The route Settings is, in the app's own route table. */
export const SETTINGS_PATH = "/settings";

/** Where Close lands when Settings was opened cold: a deep link at launch. */
export const SETTINGS_CLOSE_FALLBACK = "/chat";

/**
 * The one reading of "this route is Settings".
 *
 * The gear and the tracker both ask it, so a future sub-route cannot make one
 * of them say yes while the other says no (round 1: R7).
 */
export function isSettingsPath(pathname: string): boolean {
	return pathname === SETTINGS_PATH;
}

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
		if (isSettingsPath(pathname)) {
			// Re-pinning the SAME outside route on every in-page query change is
			// harmless by construction: `lastOutsideRoute` only moves outside Settings.
			returnTarget = lastOutsideRoute;
			return;
		}
		lastOutsideRoute = `${pathname}${search}`;
		// The visit is over: a stale target must not answer a later close.
		returnTarget = null;
	}, [pathname, search]);
}

/**
 * The one "close Settings" action: the page's button, its Esc scope and the
 * sidebar gear all call this, so the three cannot disagree about the target.
 *
 * FOCUS ON THE WAY OUT (round 1: U6): the destination decides where the
 * keyboard lands when it auto-focuses something of its own (the chat draft's
 * composer does); when it leaves focus on `<body>` - a conversation, a list -
 * the gear the reader came from takes it back, so the keyboard is not restarted
 * from the top of the window.
 */
export function useCloseSettings(): () => void {
	const navigate = useNavigate();
	return useCallback(() => {
		const target = returnTarget ?? SETTINGS_CLOSE_FALLBACK;
		/*
		 * `replace`, so the route the reader returns to does not grow a history
		 * entry for a page they have left. The router's own back stack is the
		 * browser's, and this app's sidebar is the way around it.
		 */
		navigate(target, { replace: true });
		requestAnimationFrame(() => {
			const active = document.activeElement;
			if (active !== null && active !== document.body) return;
			const gear = document.querySelector<HTMLElement>(
				'[data-tour-tag="nav-item-settings"]',
			);
			gear?.focus({ preventScroll: true });
		});
	}, [navigate]);
}

/** Test seam: the record is module state, and each case starts from nothing. */
export function __resetSettingsReturn(): void {
	returnTarget = null;
	lastOutsideRoute = null;
}
