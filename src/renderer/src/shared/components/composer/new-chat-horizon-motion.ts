const MAX_X = 4;
const MAX_Y = 2;

const axisOffset = (value: number, start: number, size: number, max: number) =>
	Math.max(-1, Math.min(1, (2 * (value - start)) / size - 1)) * max;

export function trackNewChatHorizon(splash: HTMLElement, paint: SVGSVGElement) {
	const view = splash.ownerDocument.defaultView;
	if (!view) return;

	const reduced = view.matchMedia("(prefers-reduced-motion: reduce)");
	const forced = view.matchMedia("(forced-colors: active)");
	let frame: number | undefined;
	let bounds: DOMRect | undefined;
	let x = 0;
	let y = 0;
	let observer: ResizeObserver | undefined;

	const draw = () => {
		frame = undefined;
		bounds ??= splash.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return;
		const dx = axisOffset(x, bounds.left, bounds.width, MAX_X);
		const dy = axisOffset(y, bounds.top, bounds.height, MAX_Y);
		paint.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`;
	};
	const move = (event: PointerEvent) => {
		if (event.pointerType !== "mouse") return;
		x = event.clientX;
		y = event.clientY;
		// Input bursts share one frame. Cache layout until the pointer exits or
		// the splash resizes, and let CSS ease the transform without an idle loop.
		frame ??= view.requestAnimationFrame(draw);
	};
	const reset = () => {
		if (frame !== undefined) view.cancelAnimationFrame(frame);
		frame = undefined;
		bounds = undefined;
		paint.style.removeProperty("transform");
	};
	const exit = (event: PointerEvent) => {
		if (event.pointerType === "mouse") reset();
	};
	const detach = () => {
		if (!observer) return;
		observer.disconnect();
		observer = undefined;
		splash.removeEventListener("pointermove", move);
		splash.removeEventListener("pointerleave", exit);
		splash.removeEventListener("pointercancel", exit);
		reset();
	};
	const sync = () => {
		if (reduced.matches || forced.matches) {
			detach();
			return;
		}
		if (observer) return;
		observer = new view.ResizeObserver(() => {
			bounds = undefined;
		});
		observer.observe(splash);
		splash.addEventListener("pointermove", move, { passive: true });
		splash.addEventListener("pointerleave", exit, { passive: true });
		splash.addEventListener("pointercancel", exit, { passive: true });
	};

	reduced.addEventListener("change", sync);
	forced.addEventListener("change", sync);
	sync();
	return () => {
		reduced.removeEventListener("change", sync);
		forced.removeEventListener("change", sync);
		detach();
	};
}
