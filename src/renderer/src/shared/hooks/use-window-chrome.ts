import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

/**
 * The renderer's half of the window chrome: where the OS put its controls, what
 * state the window is in, and which colour sits under the controls' corner.
 *
 * WHAT ONLY THIS PROCESS CAN DO. The chrome facts (`data-chrome-platform` and
 * `data-chrome-mode`) are written by `main.tsx` before the first render, from a
 * synchronous preload fact, because they choose between two incompatible layouts.
 * Three other things cannot be known that way:
 *
 *  - **Where the OS's controls are.** On Windows and Linux the buttons are the
 *    user's to place: GNOME defaults to a single trailing close button, Ubuntu's
 *    layout can be leading, KDE usually shows three trailing. The WCO rect is the
 *    only source, it is live, and Blink re-notifies it on resize, maximize, full
 *    screen and a button-layout change. CSS cannot branch on "is this length
 *    greater than zero", so the two derived booleans are attributes.
 *  - **Full screen.** The renderer cannot observe it; main pushes it, and the lane
 *    collapses to 0 and every inset falls with it.
 *  - **The ground under the controls.** On Linux, Electron forces the overlay
 *    colour opaque, so the buttons are painted on a colour we have to supply - the
 *    resolved background of whichever element owns that corner. On Windows the
 *    overlay is transparent and this is unused, which is the point: the app's own
 *    pixels show through and there is no colour to keep in sync.
 *
 * WHY `data-chrome-leading`/`data-chrome-trailing` ARE ATTRIBUTES. The three
 * `--chrome-*` custom properties in `styles/index.css` carry the geometry, and a
 * rule can test an attribute but not a length. Setting `--chrome-inset-start: 0px`
 * and letting a component decide whether to spend it is exactly the ambiguity the
 * attributes remove: a leading lane is a lane, and a 0px one drawn anyway is 0px of
 * nothing holding a drag region along the window's top edge.
 *
 * EVERY READ HERE ROUTES THROUGH THOSE THREE PROPERTIES, which is what lets a rig
 * simulate any platform's geometry by overriding them on `:root` (a mac host has
 * no WCO rect to measure). That is why nothing in the tree calls
 * `getTitlebarAreaRect` or reads `env(titlebar-area-*)` outside this file.
 */

/** The window state main pushes. `fullScreen` is the one the layout follows. */
type ChromeState = {
	fullScreen: boolean;
	maximized: boolean;
	focused: boolean;
};

/** The WCO geometry this process can see, or null where there is none (macOS). */
export type WindowControlsRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/**
 * The WCO rect, or null.
 *
 * Null on macOS (the lights are AppKit's, outside the client area, and macOS
 * deliberately does not enable WCO - it would add no pixels and would hand the
 * renderer a geometry main already reproduces from its own events) and null in a
 * browser without the interface, which is what a Storybook story is.
 */
function readControlsRect(): WindowControlsRect | null {
	const overlay = (
		navigator as Navigator & {
			windowControlsOverlay?: {
				visible?: boolean;
				getTitlebarAreaRect?: () => DOMRect;
			};
		}
	).windowControlsOverlay;
	if (!overlay?.getTitlebarAreaRect) return null;
	try {
		const rect = overlay.getTitlebarAreaRect();
		/*
		 * An EMPTY rect is a real state rather than a missing one: Blink removes the
		 * four `titlebar-area-*` env vars when it is empty, which is what happens in
		 * full screen, and it reports 0x0. Answering null there keeps "the OS has no
		 * controls on screen" and "this platform has no WCO" as one case for the
		 * caller, which is what the CSS needs - both mean no insets and no lane.
		 */
		if (rect.width <= 0 && rect.height <= 0) return null;
		return {
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
		};
	} catch {
		return null;
	}
}

/**
 * Which sides the controls are on, written as `data-chrome-leading` /
 * `data-chrome-trailing` on the document element.
 *
 * macOS is answered from the platform rather than from a rect: on the one platform
 * whose controls are OUTSIDE the client area the app knows where they are (a 32px
 * lane at the leading edge), so `leading=true, trailing=false` is a constant rather
 * than a measurement that does not exist. Everywhere else the rect is asked, and a
 * rect at x 0 with a width narrower than the window is a LEADING layout while one
 * that ends at the window's right edge is trailing; a both-sides layout sets both,
 * which GNOME can be configured to do.
 */
export function applyControlsRect(
	rect: WindowControlsRect | null,
	platform: string,
	viewportWidth: number,
): void {
	const root = document.documentElement;
	if (platform === "mac") {
		root.dataset.chromeLeading = "true";
		root.dataset.chromeTrailing = "false";
		return;
	}
	if (rect === null) {
		root.dataset.chromeLeading = "false";
		root.dataset.chromeTrailing = "false";
		return;
	}
	/* A 1px tolerance: the rect is a fractional CSS-pixel box, and an exact
	 * comparison puts a full-width trailing layout one rounding error away from
	 * counting as leading. */
	root.dataset.chromeLeading = rect.x <= 1 ? "true" : "false";
	root.dataset.chromeTrailing =
		Math.abs(rect.x + rect.width - viewportWidth) <= 1 ? "true" : "false";
}

/**
 * The corner ground, read off the element that owns it.
 *
 * A resolved colour rather than a role name, because main has no palette and the
 * renderer is the only process that can resolve one; `getComputedStyle` is also the
 * only thing that follows a theme switch, a banner appearing and a pane opening
 * without a second copy of the palette's rules. `rgba(0, 0, 0, 0)` is returned as
 * null - a transparent element has not answered the question, and main then keeps
 * the colour it already had rather than being told "transparent", which Linux would
 * paint as black.
 */
export function readResolvedGround(element: Element | null): string | null {
	if (element === null) return null;
	const background = getComputedStyle(element).backgroundColor;
	if (!background) return null;
	const match = background.match(/^rgba?\(([^)]+)\)$/);
	if (match === null) return null;
	const parts = match[1].split(",").map((part) => part.trim());
	if (parts.length === 4 && Number.parseFloat(parts[3]) === 0) return null;
	return background;
}

/**
 * Report the palette's chrome colours to main, from the variables the app paints.
 *
 * READ FROM THE DOCUMENT rather than from the palette registry, and that is the
 * point: `themes.generated.css` emits one `--lo-*` block per theme, and those are
 * the values the app's own ink and grounds actually resolve to. A report built from
 * a palette object would be a second opinion about the same fact, and the two would
 * drift the moment a role is re-authored without the chrome being told - which is
 * exactly the drift `INSTALL_WINDOW_CANVAS` exists to catch on the main side.
 *
 * MUST RUN AFTER `applyThemeToDocument`. Both live in the theme provider's
 * `useLayoutEffect`, in that order, so the caption glyphs and the app's ink change
 * in one frame - a report sent before the attribute lands would describe the
 * previous palette, and one sent from a `useEffect` would arrive a frame after the
 * screen had already changed.
 *
 * A missing variable (`--lo-canvas` in a document with no `data-theme`) sends
 * nothing rather than sending an empty string: main refuses a colour it cannot
 * parse and would log a refusal on every Storybook paint.
 */
export function reportWindowChromeColors(themeId: string): void {
	const api = window.api?.windowChrome;
	if (!api) return;
	const styles = getComputedStyle(document.documentElement);
	const ground = styles.getPropertyValue("--lo-canvas").trim();
	const symbol = styles.getPropertyValue("--lo-ink-muted").trim();
	const symbolInactive = styles.getPropertyValue("--lo-ink-dim").trim();
	if (!ground || !symbol || !symbolInactive) return;
	void api.report({
		themeId,
		colors: { ground, symbol, symbolInactive },
	});
}

/**
 * The chrome hook, mounted once by the shell.
 *
 * It writes the two derived attributes and the full-screen fact, and it re-writes
 * them on the events that change them. It renders nothing and reports nothing
 * about the theme: the colours are `theme-provider.tsx`'s to send, in the same
 * `useLayoutEffect` that applies the theme, so the caption glyphs and the app's own
 * ink change in one frame rather than two.
 */
export function useWindowChrome(): void {
	useLayoutEffect(() => {
		const api = window.api?.windowChrome;
		if (!api) return;
		const platform = document.documentElement.dataset.chromePlatform ?? "linux";
		const apply = () =>
			applyControlsRect(readControlsRect(), platform, window.innerWidth);
		apply();
		const overlay = (
			navigator as Navigator & {
				windowControlsOverlay?: EventTarget;
			}
		).windowControlsOverlay;
		overlay?.addEventListener?.("geometrychange", apply);
		window.addEventListener("resize", apply);
		return () => {
			overlay?.removeEventListener?.("geometrychange", apply);
			window.removeEventListener("resize", apply);
		};
	}, []);

	useEffect(() => {
		const api = window.api?.windowChrome;
		if (!api) return;
		return api.onState((state: ChromeState) => {
			/*
			 * The boolean is written as a string because that is what an attribute is,
			 * and the CSS tests it with `[data-chrome-fullscreen="true"]`.
			 */
			document.documentElement.dataset.chromeFullscreen = state.fullScreen
				? "true"
				: "false";
		});
	}, []);
}

/**
 * Report the ground under the controls' corner, from whichever element owns it.
 *
 * The owner is the component that RESERVES the corner - the chat header when no
 * pane is open, the open pane's toolbar otherwise - because the right slot is
 * exclusive in the store, so exactly one of them is on screen at a time. It
 * re-reports when the element changes identity, which covers a pane opening, a
 * route change and a banner appearing, and the caller re-renders on a theme change
 * anyway (its ink is a role).
 *
 * The report also carries the palette's three colours, so a mount of the owner
 * after a theme switch re-states both halves at once - the alternative is two
 * independent channels that can disagree about which palette is current.
 */
export function useCornerGround(
	ref: RefObject<HTMLElement | null>,
	deps: readonly unknown[] = [],
): void {
	/*
	 * The effect keys on a CALL-SITE-SUPPLIED list rather than on the ref, which is
	 * stable: a ref never changes identity, so an effect that keyed on it would run
	 * once and never re-report when the element under it was replaced.
	 */
	const lastReported = useRef<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the caller owns the key list.
	useEffect(() => {
		const api = window.api?.windowChrome;
		if (!api) return;
		const corner = readResolvedGround(ref.current);
		if (corner === null || corner === lastReported.current) return;
		lastReported.current = corner;
		void api.report({ cornerGround: corner });
	}, deps);
}
