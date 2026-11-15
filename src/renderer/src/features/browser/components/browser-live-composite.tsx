import { useEffect, useRef } from "react";
import { browserBridge } from "../model/browser-projection-store";
import { CompositeSink, bgraToRgba } from "../model/composite-sink";

type CompositeFrame = Parameters<
	Parameters<
		NonNullable<ReturnType<typeof browserBridge>>["onCompositeFrame"]
	>[0]
>[0];

/**
 * The live picture of the page while an app overlay hides the native view.
 *
 * WHY A CANVAS: the page is a native `WebContentsView` that paints above every
 * DOM element, so it is detached while a dialog/menu/popover is open (see
 * `src/main/browser/composite-bridge.ts`). Main forwards that detached page's
 * full compositor frames; this paints them where the page was, underneath the
 * overlay, so the page visibly keeps running instead of being replaced by the
 * paused note.
 *
 * DISPLAY-ONLY, deliberately: `aria-hidden`, not focusable and
 * `pointer-events: none`. Input is not forwarded — the page is not interactive
 * while an overlay owns input, exactly as before. The backing store is the
 * frame's device pixels; CSS stretches it over the content rect, which is the
 * rect the frame was captured at.
 *
 * Mounted only while the page is overlay-suppressed. The canvas buffer is
 * wiped on every clear and on unmount, so no picture of the page outlives the
 * generation main says is live. Pixels never leave this component.
 */
export function BrowserLiveComposite({
	onLiveChange,
}: {
	/** True once a live frame is drawn, false when it is cleared/unmounted, so
	 * the surface shows its paused note only when there is no live picture. */
	onLiveChange: (live: boolean) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const onLiveChangeRef = useRef(onLiveChange);
	onLiveChangeRef.current = onLiveChange;

	useEffect(() => {
		const bridge = browserBridge();
		if (!bridge?.onCompositeFrame) return;
		const sink = new CompositeSink();
		let pending: CompositeFrame | null = null;
		let raf: number | null = null;
		let live = false;
		const setLive = (next: boolean) => {
			if (live === next) return;
			live = next;
			onLiveChangeRef.current(next);
		};
		const wipe = () => {
			const canvas = canvasRef.current;
			if (!canvas) return;
			// Resizing a canvas discards its backing store, pixels included.
			canvas.width = 0;
			canvas.height = 0;
		};
		const draw = () => {
			raf = null;
			const frame = pending;
			pending = null;
			const canvas = canvasRef.current;
			// The draw-time re-check: a clear that arrived after this frame was
			// queued must win (composite-sink.ts, "THE RULE IS HONESTY").
			if (!frame || !canvas || !sink.current(frame)) return;
			const context = canvas.getContext("2d");
			if (!context) return;
			if (canvas.width !== frame.width) canvas.width = frame.width;
			if (canvas.height !== frame.height) canvas.height = frame.height;
			const image = context.createImageData(frame.width, frame.height);
			bgraToRgba(frame.pixels, image.data);
			context.putImageData(image, 0, 0);
			sink.markDrawn(frame);
			setLive(true);
			// The ACK is what releases main's next frame (one in flight).
			void bridge
				.ackCompositeFrame({
					generation: frame.generation,
					frameSeq: frame.frameSeq,
				})
				.catch(() => {});
		};
		const offFrame = bridge.onCompositeFrame((frame) => {
			if (!sink.accept(frame)) return;
			pending = frame;
			if (raf === null) raf = requestAnimationFrame(draw);
		});
		const offClear = bridge.onCompositeClear((clear) => {
			if (pending && pending.generation <= clear.generation) pending = null;
			if (sink.clear(clear.generation)) wipe();
			if (!sink.hasFrame) setLive(false);
		});
		void bridge.setCompositeConsumer(true).catch(() => {});
		return () => {
			offFrame();
			offClear();
			if (raf !== null) cancelAnimationFrame(raf);
			pending = null;
			wipe();
			setLive(false);
			void bridge.setCompositeConsumer(false).catch(() => {});
		};
	}, []);

	return (
		<canvas
			ref={canvasRef}
			aria-hidden
			className="pointer-events-none absolute inset-0 size-full select-none"
			data-tour-tag="browser-live-composite"
			width={0}
			height={0}
		/>
	);
}
