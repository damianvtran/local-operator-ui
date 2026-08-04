import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query and re-renders when it changes.
 *
 * ## Why this exists at all
 *
 * Layout that only changes appearance belongs in a Tailwind variant, not in
 * JavaScript. This is for the narrower case where a breakpoint changes what is
 * *rendered*: a rail that drops its labels below a width has to grow tooltips
 * at the same width, and a tooltip is a portalled subtree rather than a style.
 * Rendering one and hiding it with `lg:hidden` would leave every row mounting
 * an overlay that can never be seen.
 *
 * A component using this owes the reader a comment naming the Tailwind class
 * that carries the same breakpoint, because the two have to move together and
 * nothing enforces it.
 *
 * ## Why `useSyncExternalStore`
 *
 * `MediaQueryList` is exactly an external store: it has a subscribe method and
 * a synchronously readable value. The `useState` + `useEffect` shape of this
 * hook reads the query one commit late, which paints one frame of the wrong
 * layout on mount and on every crossing.
 *
 * @param query a media query string, e.g. `"(min-width: 1024px)"`
 * @returns whether the query currently matches
 */
export const useMediaQuery = (query: string): boolean => {
	/* Memoised on the query: `useSyncExternalStore` tears down and re-runs the
	   subscription whenever this identity changes, which without the callback
	   is every single render. */
	const subscribe = useCallback(
		(onChange: () => void) => {
			const list = window.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => list.removeEventListener("change", onChange);
		},
		[query],
	);

	const getSnapshot = useCallback(
		() => window.matchMedia(query).matches,
		[query],
	);

	return useSyncExternalStore(
		subscribe,
		getSnapshot,
		/* Server snapshot. Electron never renders this on a server, but
		   Storybook's docs pages and any future SSR would, and the hook must
		   not throw on a missing `window`. */
		() => false,
	);
};
