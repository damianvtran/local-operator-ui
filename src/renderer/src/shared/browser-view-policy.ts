import { useCallback, useEffect, useId, useSyncExternalStore } from "react";

/**
 * The overlay/view-visibility policy. Design: docs/design/ui-browser-tab.md
 * 11.3 — "the single most important UI constraint".
 *
 * WHY IT LIVES IN `shared/` AND NOT UNDER `features/browser/`: what it describes
 * is not the browser's UI but the native view's relationship to every OTHER
 * surface in the app — the command palette, every dialog, the toaster. A feature
 * module cannot be the thing a shared component imports without inverting the
 * layering, and `base-dialog.tsx` is one of the registrants precisely because
 * every dialog must register.
 *
 * THE FACT THIS FILE EXISTS FOR: a native `WebContentsView` paints above ALL
 * DOM. It is a sibling of the window's own webContents in the view tree, so no
 * `z-index`, no portal and no overlay in the renderer can draw over it. Every
 * overlay the app paints over the content area is therefore INVISIBLE while the
 * browser tab is showing, unless the view itself goes away.
 *
 * The design's rule is one derived boolean: an overlay that covers the content
 * area hides the view on open and restores it on close. This module is that
 * boolean, and the reason it is a registry rather than a scan is that "does it
 * cover the content area" is a question about intent, not geometry:
 *
 * - The app-level overlays the design names (`CommandPalette`, `OnboardingModal`,
 *   `LowCreditsDialog`, `CreateAgentDialog`, `UpdateNotification`) register from
 *   `app.tsx` off the store flags they are already driven by.
 * - EVERY dialog registers itself, in `BaseDialog` — one funnel, so a dialog
 *   added next year does not silently become invisible over the browser.
 * - The browser feature's own menus and pickers register when they open.
 *
 * TWO THINGS DELIBERATELY DO NOT REGISTER, and both would be visible as bugs if
 * they did:
 *
 * - **Tooltips and menus in the chrome band.** The band is outside the view's
 *   rect, so nothing there is occluded, and hiding the view every time a pointer
 *   rested on a tab would flash the page for no reason.
 * - **The in-flow banners.** They occupy their own space in the shell rather
 *   than painting over the content area.
 *
 * WHAT IS NOT SOLVED HERE, and is measured rather than assumed: whether a
 * `setVisible(false)`/`(true)` pair around a modal produces a visible flash on
 * macOS at Electron 44. The design flags that as a genuine unknown (probe P11)
 * precisely because a still frame cannot show it.
 */

/** The ids currently suppressing the view. */
const active = new Map<string, number>();
const listeners = new Set<() => void>();

/**
 * The ids, as one string, recomputed only when the set changes.
 *
 * Cached rather than assembled on read because it is the snapshot a
 * `useSyncExternalStore` subscriber compares: a fresh string every call is a new
 * object identity every render, which React treats as a change and re-renders on
 * forever. It is also what the paused state publishes as `data-suppressed-by`, so a
 * run — or a support session — can read WHY the page is hidden instead of inferring
 * it from whatever happens to be on screen. That attribute is how the cause of a
 * paused page was found while building this.
 */
let snapshot = "";

export function suppressedOverlayIdsSnapshot(): string {
	return snapshot;
}

function notify(): void {
	snapshot = [...active.keys()].sort().join(",");
	for (const listener of listeners) listener();
}

/**
 * Register an overlay by id, ref-counted.
 *
 * Ref-counted because the same id can legitimately be live twice — two dialogs
 * open at once, a nested one over its parent — and a boolean keyed by id would
 * let the inner close clear the outer's suppression.
 */
export function suppressBrowserView(id: string): () => void {
	active.set(id, (active.get(id) ?? 0) + 1);
	notify();
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const count = (active.get(id) ?? 1) - 1;
		if (count > 0) active.set(id, count);
		else active.delete(id);
		notify();
	};
}

/** Whether anything is currently covering the content area. */
export function browserViewSuppressed(): boolean {
	return active.size > 0;
}

export function subscribeBrowserView(callback: () => void): () => void {
	listeners.add(callback);
	return () => {
		listeners.delete(callback);
	};
}

/** The ids suppressing the view. Exported for the policy's own unit test. */
export function suppressedOverlayIds(): string[] {
	return [...active.keys()].sort();
}

/**
 * Register while `on` is true.
 *
 * `useId`-suffixed so two instances of one overlay are two registrations rather
 * than one ref count that outlives the first: a component that mounts, opens,
 * closes and re-mounts must release as many times as it registered.
 */
export function useSuppressBrowserView(on: boolean, name: string): void {
	const id = `${name}:${useId()}`;
	useEffect(() => {
		if (!on) return;
		return suppressBrowserView(id);
	}, [id, on]);
}

/** Subscribe to the policy: true when the native view must be hidden. */
export function useBrowserViewSuppressed(): boolean {
	return useSyncExternalStore(
		useCallback(subscribeBrowserView, []),
		browserViewSuppressed,
		browserViewSuppressed,
	);
}

/** The ids suppressing the view, as a comma-separated snapshot. Published by the
 * paused state so the reason is readable rather than inferred. */
export function useSuppressedOverlayIds(): string {
	return useSyncExternalStore(
		useCallback(subscribeBrowserView, []),
		suppressedOverlayIdsSnapshot,
		() => "",
	);
}

/*
 * WHAT IS NOT REGISTERED, AND THE MEASUREMENT THAT DECIDED IT
 * ----------------------------------------------------------
 *
 * **Toasts.** sonner paints a toast in the bottom-right corner, which overlaps the
 * content area, so a first version of this module watched the toast host and hid
 * the view while any toast was on screen. Measured in
 * `scripts/browser-chrome-proof.mjs`, that produced the worst outcome available:
 * the run has no backend, the app raises "List agents request failed: 503" toasts
 * on every failed poll, and the browser page stayed hidden for the whole run —
 * behind a note that says "Paused while a dialog is open — close it to bring the
 * page back", which was false in both halves. An overlay the user cannot see and
 * cannot dismiss, holding the page away from them, is worse than a corner card
 * that is partly covered.
 *
 * The design's rule is about FULL-WINDOW overlays (11.3), and a toast is not one.
 * So the trade is recorded here rather than hidden: while the browser route is
 * showing, a toast that lands in the view's corner is partially occluded. The
 * browser feature answers that where it can — its own notices (the consent band,
 * the blocked-popup line, its errors) all render in the chrome band, which is never
 * occluded — and `scripts/browser-chrome-proof.mjs` measures the overlap and
 * records it, so the limitation is a number in the PR rather than a surprise.
 * A follow-up worth having: route app-wide notices into the chrome band while the
 * browser route is the active one.
 *
 * **Menus, selects, popovers and tooltips** are not registered either, and for a
 * different reason: the ones this feature opens are anchored in the chrome band,
 * which is outside the view's rectangle, so nothing there is occluded and hiding
 * the view for a hover hint would flash the page for nothing. A menu opened from a
 * PAGE is page content, not app DOM.
 */
