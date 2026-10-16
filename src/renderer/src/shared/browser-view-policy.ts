import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

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
 * - EVERY TOOLTIP registers, in the shared `Tooltip` wrapper (`ui/tooltip.tsx`) -
 *   one funnel, for `BaseDialog`'s reason - for as long as it is open AND ONLY IF
 *   IT REACHES THE VIEW. The sidebar's conversation flyout (`"sidebar-row-flyout"`)
 *   opens RIGHT, into the content area, and was clipped to the sliver over the
 *   sidebar's edge before it did; a tooltip that does not name itself registers as
 *   `"tooltip"`.
 * - The panel rail's tooltips (`"panel-rail-tooltip"`, #872) were the first to
 *   register that way, and the measurement came from them. They open LEFT, into the pane,
 *   and which of them lands inside the view's rect is a MEASUREMENT, not a list:
 *   at 1280x900 with a run present only the Canvas item's tooltip does (23 of its
 *   27px), the other three end above the view's top, and on a draft none does.
 *   `useSuppressBrowserViewWhileReaching` below makes that measurement, against
 *   the rect the browser surface registers with `registerBrowserViewRect` - the
 *   very box it reports to main as the view's rect - so a consent banner that
 *   pushes the page down is accounted for without a constant to update.
 *
 * TWO THINGS DELIBERATELY DO NOT REGISTER, and both would be visible as bugs if
 * they did:
 *
 * - **Tooltips and menus in the chrome band.** The band is outside the view's
 *   rect, so nothing there is occluded, and hiding the view every time a pointer
 *   rested on a tab would flash the page for no reason. A band tooltip goes through
 *   the same `Tooltip` funnel as every other and the MEASUREMENT keeps it out: its
 *   painted box does not overlap the view's rect. One whose panel did cross the
 *   view's top edge would register, which is the point - it would otherwise be
 *   partly hidden.
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

/**
 * The view's rectangle, as the renderer knows it.
 *
 * Main owns the native view and the renderer only SENDS it a rect
 * (`useBrowserChrome.setContentRect`), so until now nothing in the renderer could
 * ask "where is the page". An overlay that must decide whether it needs the view
 * hidden - a tooltip that is sometimes over the page and sometimes not - needs
 * exactly that, and it must be the SAME box the view is told to paint, not a
 * second measurement of something nearby. The browser surface registers a getter
 * for its content element (the one it measures for main), so this module reads the
 * identical rect and cannot drift from it.
 *
 * A Set of getters rather than one slot because two surfaces can be mounted at
 * once (the route and a pane); an overlay that reaches EITHER needs the view gone.
 * Empty when no surface is mounted, which is the answer "there is no view to
 * occlude", so nothing registers.
 */
export interface ViewRect {
	x: number;
	y: number;
	width: number;
	height: number;
}
const viewRectSources = new Set<() => ViewRect | null>();

/** Register a getter for the view's rect; returns the release. */
export function registerBrowserViewRect(
	source: () => ViewRect | null,
): () => void {
	viewRectSources.add(source);
	return () => {
		viewRectSources.delete(source);
	};
}

/** Whether a box has positive-area overlap with any registered view rect. */
export function overlapsBrowserView(box: ViewRect): boolean {
	for (const source of viewRectSources) {
		const view = source();
		if (!view || view.width <= 0 || view.height <= 0) continue;
		if (box.width <= 0 || box.height <= 0) continue;
		const overlapX =
			Math.min(box.x + box.width, view.x + view.width) -
			Math.max(box.x, view.x);
		const overlapY =
			Math.min(box.y + box.height, view.y + view.height) -
			Math.max(box.y, view.y);
		if (overlapX > 0 && overlapY > 0) return true;
	}
	return false;
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

/**
 * Frames to wait for Radix to place a tooltip before giving up on measuring it.
 *
 * A popper's wrapper sits at `translate(0, -200%)` until floating-ui has computed
 * a position (a promise, so it lands within a frame or two). Measuring before that
 * reads a rect that is nowhere near where the panel is painted. Eight frames is
 * far past what placement takes; if it is still unplaced the tooltip is not on
 * screen, so there is nothing to un-occlude and not registering is the right
 * answer.
 */
const PLACEMENT_FRAMES = 8;

/**
 * The frames a reaching tooltip's registration outlives its panel.
 *
 * WHY ANY HOLD AT ALL (review round 1, R1). Moving the pointer from one flyout to the
 * next closes the tooltip being left BEFORE its replacement is on screen: Radix closes
 * every other hover tooltip synchronously when a new one opens (its own `TOOLTIP_OPEN`),
 * and the replacement registers only once floating-ui has placed it - the
 * `PLACEMENT_FRAMES` poll above, so a frame later at the earliest. Released at once, the
 * registry empties inside that gap and reports the page SHOWN for a frame in the middle
 * of a row-to-row scan, which is a `setVisible(true)`/`(false)` pair on the native view
 * every time the pointer crosses a row. On the rail that was one item; on the sidebar
 * EVERY row's flyout opens `right` into the view, and scanning conversation rows with
 * the Browser open is the flow #1078 is about (measured on the policy's own notify log:
 * `present -> absent -> present` across the handoff, with the panel rect stated).
 *
 * FRAMES, NOT MILLISECONDS (review round 2, R7). What the hold has to cover is the
 * replacement's PLACEMENT, and placement is counted in frames - so the hold is too. A
 * timeout measured the wrong thing: a main thread that stalls over the hover that opened
 * the replacement (a heavy sidebar re-render, or GC) stops drawing frames but not the
 * clock, so the hold could expire with the replacement still unplaced and the page flash
 * - the R1 symptom, arriving on the machine least able to afford it. A frame count slows
 * down exactly when placement does, so the margin between the two is the same at every
 * frame rate and under every stall.
 *
 * THREE 60Hz FRAMES AND NO MORE: one for floating-ui to place the replacement, two of
 * slack for a frame dropped while the app is busy. It is a hold, not a second opinion -
 * the measurement already says this panel was over the view, and a replacement that
 * registers inside the window keeps the page hidden without this id, so nothing is
 * reported hidden that was not. WHAT IT COSTS WHEN NOTHING FOLLOWS: the page returns
 * three frames later than it otherwise would, below the point where a returning page
 * reads as lag.
 */
export const RELEASE_HOLD_FRAMES = 3;

/**
 * Register while an overlay is open AND its painted box reaches the native view.
 *
 * WHY MEASURED. The first cut registered for every rail tooltip, and design
 * measured what that bought (1280x900, run present): the Canvas tooltip reaches
 * the view by 23 of its 27px, the Run, Browser and Console tooltips end above its
 * top and need nothing, yet all four blanked the page; on a draft none reaches it.
 * A position list would be wrong again as soon as the content rect moved (a
 * consent banner pushes it down and makes even Canvas unnecessary), so the hook
 * reads the overlay's own rect against `registerBrowserViewRect`'s.
 *
 * WHICH OVERLAY: `getOverlay` returns the tooltip's element; it is read once open
 * and held in a ref so a fresh closure per render does not restart the measure.
 *
 * KEYBOARD FOCUS takes the same path as hover, deliberately. A focus-opened
 * tooltip is the only visible label a sighted keyboard user gets, so hover-only
 * suppression would leave exactly that user reading an occluded one. The measured
 * rule keeps the cost where the occlusion is (the Canvas item) and removes it
 * from the three whose tooltips never reach the page.
 *
 * RELEASED WITHOUT THE TOOLTIP CLOSING. Radix closes a hover tooltip on a later
 * document `pointermove` outside its grace area, not on `pointerleave`, and the
 * rail sits 5.5px from the window's trailing edge, so the likeliest exit from an
 * item is out of the window - where Chromium sends no `pointermove`. The panel
 * then stays "open", and a registration that followed it would hold the page blank
 * until the pointer came back. So the registration also ends when the pointer
 * leaves the document or the window loses focus, and is re-armed by the next
 * pointer movement inside the window while the tooltip is still open.
 */
export function useSuppressBrowserViewWhileReaching(
	open: boolean,
	name: string,
	getOverlay: () => Element | null,
): void {
	const [reaching, setReaching] = useState(false);
	const [away, setAway] = useState(false);
	const overlay = useRef(getOverlay);
	overlay.current = getOverlay;
	/*
	 * The latest measurement, as a ref: the close branch below reads it without adding it
	 * to the effect's dependencies, so the effect still runs on `open` alone - the
	 * transition the hold exists for - rather than restarting on every measure.
	 */
	const reached = useRef(reaching);
	reached.current = reaching;
	/*
	 * `away` as a ref for the same reason: the close branch reads the pointer state that
	 * was current when this tooltip closed, and `away` as a dependency would re-run the
	 * effect - entering the measure path and clearing `away` - while the tooltip is still
	 * open, which is the exit handling the branch exists to respect.
	 */
	const pointerLeft = useRef(away);
	pointerLeft.current = away;

	useLayoutEffect(() => {
		if (!open) {
			/*
			 * CLOSED OVER THE VIEW IS NOT YET DONE OCCLUDING (review round 1, R1): the
			 * registration is held for `RELEASE_HOLD_FRAMES` frames, so a tooltip that closed
			 * because its replacement opened does not un-hide the page in the gap before that
			 * replacement is placed. Held ONLY when the measurement was a reach and the
			 * pointer has not already gone (`away`) - a tooltip closed after an exit
			 * through the window edge must not re-hide the page the pointer left.
			 */
			if (reached.current && !pointerLeft.current) {
				/*
				 * Counted with the same `frame`/cleanup shape as `measure` above, but these
				 * frames are EXACT rather than a budget to give up inside: the release lands on
				 * the frame `RELEASE_HOLD_FRAMES` names and no later, so the frame count is the
				 * contract a reader - and the case that pins the hold - can count on. The two
				 * exits `away` cannot cover are the effect's own cleanup: unmount, and a reopen,
				 * where the replacement's measurement takes the registration over.
				 */
				let frame = 0;
				let left = RELEASE_HOLD_FRAMES;
				const release = (): void => {
					left -= 1;
					if (left > 0) {
						frame = requestAnimationFrame(release);
						return;
					}
					setReaching(false);
				};
				frame = requestAnimationFrame(release);
				return () => cancelAnimationFrame(frame);
			}
			setReaching(false);
			setAway(false);
			return;
		}
		/*
		 * An open starts from a clean pointer state: `away` is only ever set by an exit
		 * while a tooltip was open, and carrying a stale one into the next open would leave
		 * a keyboard-opened tooltip unregistered until the pointer happened to move.
		 */
		setAway(false);
		/*
		 * NO VIEW, NOTHING TO MEASURE. Every shared `Tooltip` runs this hook, and on
		 * every route but the browser's no surface has registered a rect, so the
		 * answer is already "does not reach": without this, each open of each of the
		 * app's tooltips would schedule up to PLACEMENT_FRAMES of polling to learn it.
		 */
		if (viewRectSources.size === 0) {
			setReaching(false);
			return;
		}
		let frame = 0;
		let waited = 0;
		const measure = (): void => {
			const element = overlay.current();
			// The popper's wrapper carries the placement transform; the panel inside it
			// is what is painted, and its rect already includes the wrapper's offset.
			const wrapper = element?.closest("[data-radix-popper-content-wrapper]");
			const placed =
				element &&
				!(
					wrapper instanceof HTMLElement &&
					wrapper.style.transform.includes("-200%")
				);
			if (!element || !placed) {
				if (waited++ < PLACEMENT_FRAMES) {
					frame = requestAnimationFrame(measure);
					return;
				}
				setReaching(false);
				return;
			}
			const rect = element.getBoundingClientRect();
			setReaching(
				overlapsBrowserView({
					x: rect.left,
					y: rect.top,
					width: rect.width,
					height: rect.height,
				}),
			);
		};
		measure();
		return () => cancelAnimationFrame(frame);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const leave = (): void => setAway(true);
		const back = (): void => setAway(false);
		const root = document.documentElement;
		root.addEventListener("pointerleave", leave);
		root.addEventListener("mouseleave", leave);
		window.addEventListener("blur", leave);
		document.addEventListener("pointermove", back, true);
		return () => {
			root.removeEventListener("pointerleave", leave);
			root.removeEventListener("mouseleave", leave);
			window.removeEventListener("blur", leave);
			document.removeEventListener("pointermove", back, true);
		};
	}, [open]);

	/*
	 * NOT `open && ...`: the close branch above holds a measurement that was over the view
	 * for `RELEASE_HOLD_FRAMES` frames past the panel, so the page stays hidden across a
	 * handoff (review round 1, R1). `reaching` is only ever true of a measured overlap,
	 * so nothing the old `open` term excluded enters through this door.
	 */
	useSuppressBrowserView(reaching && !away, name);
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
 * its error line) all render in the chrome band, which is never
 * occluded — and `scripts/browser-chrome-proof.mjs` measures the overlap and
 * records it, so the limitation is a number in the PR rather than a surprise.
 * A follow-up worth having: route app-wide notices into the chrome band while the
 * browser route is the active one.
 *
 * **Menus, selects, popovers and (until the shared-`Tooltip` funnel, above)
 * tooltips** did not register, for a different reason:
 * the ones this feature used to open were anchored in the chrome band, which is
 * outside the view's rectangle, so nothing there was occluded and hiding the view
 * for a hover hint would flash the page for nothing. A menu opened from a PAGE is
 * page content, not app DOM.
 *
 * REVISED 2026-09-28 (the tab-actions popout): a menu whose PANEL reaches into the
 * content rect registers, from its own component, exactly like a dialog — the
 * browser strip's tab-actions menu calls
 * `useSuppressBrowserView(…, "browser-tab-actions")` while it is open, so the view
 * hides and the paused note shows behind the panel. The band-anchored reasoning
 * above holds only while nothing a menu draws crosses the view's top edge; a panel
 * that floats over the page cannot be visible any other way, and a z-index cannot
 * beat a native sibling view. The pinned "All tabs" list stays a band ROW instead
 * of a menu — an in-flow list narrows the page rather than hiding it, and the two
 * mechanisms are chosen per surface (`browser-tab-strip.tsx`).
 */
