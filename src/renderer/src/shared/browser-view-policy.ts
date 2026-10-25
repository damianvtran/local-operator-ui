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
 * THE RULE IS A KIND TABLE, NOT A PER-COMPONENT JUDGEMENT (S5, LOH-13). "Does
 * this overlay cover the content area" is a question of intent, answered once
 * per KIND below, so a registrant added next year inherits the answer instead of
 * re-deriving it. The table is the only place a new overlay kind is classified;
 * `useSuppressBrowserView` accepts only kinds whose class pauses, so
 * `useSuppressBrowserView(open, "tooltip")` does not compile.
 *
 * | kind                      | class          | rule                                             |
 * |---------------------------|----------------|--------------------------------------------------|
 * | dialog, sheet,            | pause-modal    | registers whenever open; a modal's scrim covers   |
 * | command-palette,          |                | the window, so the extent that must intersect is  |
 * | onboarding, lightbox      |                | panel ∪ scrim (always intersects)                 |
 * | menu, popover, select,    | pause-measured | registers only while the PAINTED PANEL intersects |
 * | context-menu, notice-card |                | a mounted view's rect, plus RELEASE_HOLD_FRAMES   |
 * | browser-state             | own-state      | the browser replacing its own page (start page,   |
 * |                           |                | load failure) — not an overlay, not a pause cause |
 * | tooltip, hover-card,      | never          | never pauses, even when it overlaps. Placement    |
 * | toast                     |                | must keep it off the page (see below)             |
 * | address-suggestions-native| never          | the native child paints above a LIVE page         |
 * | address-suggestions-dom   | pause-measured | only if a DOM-painted suggestion list ever ships  |
 *
 * WHY TOOLTIPS ARE `never` AND NOT MEASURED (S5, the fix this table was added
 * for). Measuring made the page FLASH — hide, then restore — every time the
 * pointer rested on a sidebar row with the Browser route open, and then, once
 * the page was hidden, the tooltip was visible over a blank page. Both halves
 * were wrong: a hover hint is transient and is not worth taking a page away, and
 * a hint that must take the page away to be readable is a placement defect. So
 * tooltips never register, and placement is the channel: the conversation
 * flyout opens BELOW its row (inside the sidebar), and a label that cannot fit
 * in its own rail column drops the tooltip and keeps its `aria-label`. Toasts
 * keep the trade recorded below. `data-suppressed-by` can therefore never name
 * a tooltip — enforced by the type above, by `suppressBrowserView`'s raw guard,
 * and by `scripts/browser-view-policy-kinds.test.mjs`.
 *
 * WHAT `pause-modal` IS FOR. `BaseDialog` registers for every dialog; the
 * app-level overlays (`CommandPalette`, `OnboardingModal`, `LowCreditsDialog`,
 * `CreateAgentDialog`, the image lightbox) register from `app.tsx` off the
 * store flags they are already driven by, and `Sheet` registers from itself.
 *
 * WHAT `pause-measured` COSTS. The four shared primitives that produce a
 * floating panel (dropdown menu, context menu, popover, select) did not register
 * before this table existed: a generic app menu opened over a mounted browser
 * page was simply occluded. They now measure their own painted panel against the
 * rect the browser surface reports to main (`registerBrowserViewRect`), so a
 * menu fully inside the chrome band does nothing and a panel that crosses into
 * the page hides it. A chrome-band menu that stays in band — the tab-strip
 * actions menu opened near the row — is the negative control for the rule.
 *
 * TWO THINGS DELIBERATELY DO NOT REGISTER, and both would be visible as bugs:
 *
 * - **In-flow banners.** They occupy their own space in the shell rather than
 *   covering the page; the content rect narrows and main re-bounds the view.
 * - **The chrome band's own controls.** Nothing there overlaps the view, and a
 *   band-anchored overlay that does overlap is now measured rather than assumed.
 */

/** How a kind relates to a mounted native view. */
export type OverlayClass =
	| "pause-modal"
	| "pause-measured"
	| "own-state"
	| "never";

/**
 * THE TABLE. One entry per kind; the `as const` is what lets `PausingKind` be a
 * type of the keys whose class is not `never`, so the compiler enforces the
 * tooltip rule at every call site.
 */
export const OVERLAY_KIND_CLASS = {
	// modal / full-window: the box is the whole viewport (scrim included)
	dialog: "pause-modal",
	sheet: "pause-modal",
	"command-palette": "pause-modal",
	onboarding: "pause-modal",
	lightbox: "pause-modal",
	// Upstream's full-window session switcher still registers by its own id;
	// the S5 kind table is where that id is classified (main e9c6c1de73).
	"session-switcher": "pause-modal",
	// anchored, interactive, user-opened: the box is the painted panel
	menu: "pause-measured",
	popover: "pause-measured",
	select: "pause-measured",
	"context-menu": "pause-measured",
	"notice-card": "pause-measured",
	// the browser replacing its own page with DOM (not an overlay)
	"browser-state": "own-state",
	// never, by kind, even when overlapping
	tooltip: "never",
	"hover-card": "never",
	toast: "never",
	"address-suggestions-native": "never",
	// only if a DOM-painted suggestion list ever exists
	"address-suggestions-dom": "pause-measured",
} as const satisfies Record<string, OverlayClass>;

export type OverlayKind = keyof typeof OVERLAY_KIND_CLASS;

/**
 * The kinds a registrant may pass to `useSuppressBrowserView`: everything except
 * the `never` class. A tooltip therefore cannot take the page away by accident;
 * the only way back would be to add a pause class here, which is a deliberate
 * edit to the table above.
 */
export type PausingKind = {
	[K in OverlayKind]: (typeof OVERLAY_KIND_CLASS)[K] extends "never"
		? never
		: K;
}[OverlayKind];

/** The class of a registered id's kind, or null for an unknown prefix. */
export function overlayClassOfId(id: string): OverlayClass | null {
	const kind = id.slice(0, id.indexOf(":"));
	if (kind === "") return null;
	const found = (OVERLAY_KIND_CLASS as Record<string, OverlayClass>)[kind];
	return found ?? null;
}

/** Whether an id names a kind that is allowed to suppress the view. */
export function isPausingOverlayId(id: string): boolean {
	const klass = overlayClassOfId(id);
	return (
		klass === "pause-modal" ||
		klass === "pause-measured" ||
		klass === "own-state"
	);
}

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
 *
 * THE GUARD IS THE BELT TO THE TYPE'S BRACES. Every id this module creates is
 * `${kind}:…`, and the kind is a `PausingKind`; a raw call with a `never` kind
 * (a stale call site, a future hand-written id) throws in development and tests
 * and no-ops in production rather than silently pausing a page for a tooltip.
 */
export function suppressBrowserView(id: string): () => void {
	if (!isPausingOverlayId(id)) {
		// Vite inlines `import.meta.env.DEV`; a node-side renderer test has no
		// `env` at all, so the optional chain is what keeps this guard a guard
		// rather than a crash in the harness that has to exercise it.
		const devBuild =
			(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV ===
			true;
		if (devBuild) {
			throw new Error(
				`browser-view-policy: "${id}" does not name a pausing overlay kind`,
			);
		}
		return () => {};
	}
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
 * hidden - a menu that is sometimes over the page and sometimes not - needs
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
/**
 * Subscribers that only need "is a browser surface mounted at all" — the
 * tooltip placement decision. Separate from the suppression listeners because
 * that question is about the SOURCE existing, not about an overlay being live,
 * and a surface mounting/unmounting is exactly when it changes.
 */
const presenceListeners = new Set<() => void>();

function notifyPresence(): void {
	for (const listener of presenceListeners) listener();
}

/** Register a getter for the view's rect; returns the release. */
export function registerBrowserViewRect(
	source: () => ViewRect | null,
): () => void {
	viewRectSources.add(source);
	notifyPresence();
	return () => {
		viewRectSources.delete(source);
		notifyPresence();
	};
}

/**
 * Whether a browser surface is mounted (so a native view may sit under DOM).
 *
 * WHY A TOOLTIP NEEDS THIS AND A DIALOG DOES NOT. A dialog always pauses the
 * page, so it never has to ask. A tooltip may not pause by kind, so its only
 * defence against being clipped is placement — and placement is only a problem
 * on a route where the view is mounted. On every other route the original
 * tooltip is perfectly visible and should stay: S5's first cut deleted the
 * rail and collapsed-sidebar tooltips unconditionally, which regressed names
 * and chords on chat, schedules and every screen with no browser (round-1
 * design D2 / UX U2). This is the fact those call sites read.
 */
export function browserViewPresent(): boolean {
	return viewRectSources.size > 0;
}

export function subscribeBrowserViewPresence(callback: () => void): () => void {
	presenceListeners.add(callback);
	return () => {
		presenceListeners.delete(callback);
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
 * `label` distinguishes two registrants of the same kind in `data-suppressed-by`
 * (a dialog that names itself); the `useId` suffix means two instances of one
 * overlay are two registrations rather than one ref count that outlives the
 * first: a component that mounts, opens, closes and re-mounts must release as
 * many times as it registered.
 */
export function useSuppressBrowserView(
	on: boolean,
	kind: PausingKind,
	label?: string,
): void {
	const uid = useId();
	const id = label ? `${kind}:${label}:${uid}` : `${kind}:${uid}`;
	useEffect(() => {
		if (!on) return;
		return suppressBrowserView(id);
	}, [id, on]);
}

/**
 * Frames to wait for a popper to place its panel before giving up on measuring it.
 *
 * A popper's wrapper sits at `translate(0, -200%)` until floating-ui has computed
 * a position (a promise, so it lands within a frame or two). Measuring before that
 * reads a rect that is nowhere near where the panel is painted. Eight frames is
 * far past what placement takes; if it is still unplaced the panel is not on
 * screen, so there is nothing to un-occlude and not registering is the right
 * answer.
 */
const PLACEMENT_FRAMES = 8;

/**
 * The frames a measured panel's registration outlives its close.
 *
 * WHY ANY HOLD AT ALL (S4b review round 1, R1; still right for menus). Moving from one
 * panel to the next closes the panel being left BEFORE its replacement is on screen,
 * and the replacement registers only once placed. Released at once, the registry
 * empties inside that gap and reports the page SHOWN for a frame in the middle of the
 * handoff - a `setVisible(true)`/`(false)` pair on the native view every time.
 *
 * FRAMES, NOT MILLISECONDS (review round 2, R7). What the hold covers is the
 * replacement's PLACEMENT, and placement is counted in frames - so the hold is too. A
 * timeout measured the wrong thing: a main thread that stalls stops drawing frames but
 * not the clock, so the hold could expire with the replacement still unplaced. A frame
 * count slows down exactly when placement does.
 *
 * THREE 60Hz FRAMES AND NO MORE: one for floating-ui to place the replacement, two of
 * slack for a frame dropped while the app is busy. It is a hold, not a second opinion -
 * the measurement already says this panel was over the view.
 */
const RELEASE_HOLD_FRAMES = 3;

/**
 * Register while `open` AND the panel the getter returns intersects a view.
 *
 * THE BODY IS THE REVIEWED MEASUREMENT from S4b (#872's rail tooltips): placement
 * wait, pointer-exit handling, release hold. What changed in S5 is only its role —
 * it is no longer what every tooltip does, it is what the `pause-measured` kinds
 * do. A tooltip does not call it at all.
 *
 * `getOverlay` returns the PAINTED PANEL. It is read once open and held in a ref so
 * a fresh closure per render does not restart the measure.
 */
export function useSuppressBrowserViewWhileIntersecting(
	open: boolean,
	kind: PausingKind,
	getOverlay: () => Element | null,
	label?: string,
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
	 * was current when this panel closed, and `away` as a dependency would re-run the
	 * effect - entering the measure path and clearing `away` - while the panel is still
	 * open, which is the exit handling the branch exists to respect.
	 */
	const pointerLeft = useRef(away);
	pointerLeft.current = away;

	useLayoutEffect(() => {
		if (!open) {
			/*
			 * CLOSED OVER THE VIEW IS NOT YET DONE OCCLUDING (R1): the registration is
			 * held for `RELEASE_HOLD_FRAMES` frames, so a panel that closed because its
			 * replacement opened does not un-hide the page in the gap before that
			 * replacement is placed. Held ONLY when the measurement was a reach and the
			 * pointer has not already gone (`away`) - a panel closed after an exit
			 * through the window edge must not re-hide the page the pointer left.
			 */
			if (reached.current && !pointerLeft.current) {
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
		 * while a panel was open, and carrying a stale one into the next open would leave
		 * a keyboard-opened panel unregistered until the pointer happened to move.
		 */
		setAway(false);
		/*
		 * NO VIEW, NOTHING TO MEASURE. On every route but the browser's no surface has
		 * registered a rect, so the answer is already "does not reach": without this,
		 * each open would schedule up to PLACEMENT_FRAMES of polling to learn it.
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
	 * handoff. `reaching` is only ever true of a measured overlap.
	 */
	useSuppressBrowserView(reaching && !away, kind, label);
}

/**
 * The measured registration for a Radix panel.
 *
 * WHY THIS IS A CALLBACK REF AND NOT A REFOBJECT (agent BLOCKER-1, QA Q-1).
 * `DropdownMenuContent` is a WRAPPER around `Primitive.Portal`; it mounts when
 * its parent renders, not when the menu opens, and Radix mounts the panel
 * inside it only on open. The first version returned a `RefObject` and passed
 * `open: true` to the measured hook, so the measuring layout effect ran ONCE,
 * on wrapper mount, found `ref.current === null`, waited its placement frames
 * and gave up — forever. The row's ⋯ menu therefore opened with
 * `data-suppressed-by` empty and painted under the native page. A callback ref
 * that stores the NODE in state makes "open" mean "the panel exists": the hook
 * re-arms on every mount, measures the painted panel, and releases on unmount
 * with the usual hold. Every pause-measured primitive uses it, so a call site
 * that mounts its content unconditionally is covered by construction.
 */
export function useMeasuredBrowserViewPanel<T extends Element>(
	kind: PausingKind,
	label?: string,
): (node: T | null) => void {
	const [panel, setPanel] = useState<T | null>(null);
	const ref = useCallback((node: T | null) => setPanel(node), []);
	useSuppressBrowserViewWhileIntersecting(
		panel !== null,
		kind,
		() => panel,
		label,
	);
	return ref;
}

/** Subscribe to whether a browser surface is mounted; see `browserViewPresent`. */
export function useBrowserViewPresent(): boolean {
	return useSyncExternalStore(
		useCallback(subscribeBrowserViewPresence, []),
		browserViewPresent,
		() => false,
	);
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
 * **Tooltips, hover cards, and the address-suggestion child** never register, by
 * kind. The measured rule they used to share is what made a sidebar hover blank
 * the page (#tools); the cure is placement, not a flash. `Tooltip` no longer
 * imports this module at all, and `scripts/browser-view-policy-kinds.test.mjs`
 * asserts that the id sweep contains only pausing kinds.
 *
 * **Menus, selects, popovers, context menus and the update notice** DO register
 * now, through the shared primitives themselves — measured, not blanket. Before
 * this they did not register at all, so a generic app menu over a mounted page
 * was simply occluded. The chrome band's own menus are the negative control: one
 * wholly inside the band measures no overlap and does nothing.
 */
