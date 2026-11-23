import type { ContentRect } from "./hooks/use-browser-chrome";

/** The DOM host is already inside the clip. Preserve containment when rounding
 * to Electron's integer DIPs, and withdraw the native view if no box remains. */
export function measureBrowserRouteRect(
	element: HTMLElement,
): ContentRect | null {
	const rect = element.getBoundingClientRect();
	const x = Math.ceil(rect.left);
	const y = Math.ceil(rect.top);
	const width = Math.floor(rect.right) - x;
	const height = Math.floor(rect.bottom) - y;
	return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** ResizeObserver cannot see a position-only change (e.g. a rail moving while
 * the content box keeps its size). Sample the mounted route once per animation
 * frame, but only send changed integer bounds; unchanged layouts do no IPC. */
export function trackBrowserRouteRect(
	read: () => ContentRect | null,
	report: (rect: ContentRect | null) => void,
): () => void {
	let last: ContentRect | null | undefined;
	const sample = () => {
		const next = read();
		if (
			last === undefined ||
			(last === null) !== (next === null) ||
			(last !== null &&
				next !== null &&
				(last.x !== next.x ||
					last.y !== next.y ||
					last.width !== next.width ||
					last.height !== next.height))
		) {
			last = next;
			report(next);
		}
	};
	let frame: number;
	const tick = () => {
		sample();
		frame = requestAnimationFrame(tick);
	};
	tick();
	return () => {
		cancelAnimationFrame(frame);
		// Null bypasses the transport's coalescer and cancels pending delivery.
		report(null);
	};
}
