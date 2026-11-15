import { useEffect, useLayoutEffect, useRef } from "react";
import { browserBridge } from "../model/browser-projection-store";
import {
	COMPOSITE_GAP_NOTE_DELAY_MS,
	CompositeSink,
	bgraToRgba,
	clearDisposition,
	holdLiveCompositeRoot,
} from "../model/composite-sink";

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
 * Mounted while the page is overlay-suppressed, and kept mounted after the
 * overlay closes only while a picture is drawn, until main's CLEAR (UX U3).
 * The canvas buffer is wiped on every clear that drops the picture and on
 * unmount, so no picture of the page outlives the page main says is live; a
 * rect-only "resized" clear keeps the last frame, which is still this page and
 * this document (`clearDisposition`). Pixels never leave this component.
 */
/**
 * What the canvas shows, for the surface's paused note:
 * - "picture": a frame of the page is drawn (live, or kept across a resize);
 * - "gap": no picture yet, but one is expected shortly (fresh open, tab switch,
 *   navigation) — the plain ground, no note, for at most
 *   `COMPOSITE_GAP_NOTE_DELAY_MS`;
 * - "none": no picture and none coming in time — the note is the honest state.
 */
export type LiveCompositeView = "picture" | "gap" | "none";

/**
 * After the overlay closes, a held picture waits for main's CLEAR, which comes
 * from the same layout pass that re-presents the native view. QA measured that
 * pass 72 ms after the renderer's close (PR #1929 round 1, A3, n=1: canvas gone
 * at +217 ms, CLEAR at +289 ms). If no CLEAR comes within 1000 ms (>10x that),
 * the picture is dropped anyway, so a lost message can never leave old pixels
 * under whatever the surface shows next.
 */
const CLOSE_HANDOFF_FALLBACK_MS = 1000;

/**
 * The colour space the compositor's frame is in, for tagging the ImageData
 * (design D2). The frame arrives already in the DISPLAY's space; an untagged
 * `ImageData` is read as sRGB and converted to the display a second time. On a
 * P3 panel that dulled the fixture red from (177,68,52) on the page to
 * (164,75,58) on the picture, ΔE00 3.14 (design round 1, head-06 vs head-07).
 * `(color-gamut: p3)` is the renderer-visible proxy for "this window's display
 * is wide-gamut"; it is re-read per frame so moving the window to an sRGB
 * screen re-tags the next frame.
 */
const frameColorSpace = (gamut: MediaQueryList | null): PredefinedColorSpace =>
	gamut?.matches ? "display-p3" : "srgb";

export function BrowserLiveComposite({
	suppressing,
	onViewChange,
}: {
	/** The overlay is still open. False while a picture is held for the close
	 * hand-off (U3): no new gap is started, and a dropped picture is final. */
	suppressing: boolean;
	onViewChange: (view: LiveCompositeView) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const onViewChangeRef = useRef(onViewChange);
	onViewChangeRef.current = onViewChange;
	const suppressingRef = useRef(suppressing);
	suppressingRef.current = suppressing;
	/** Drops the picture for the close hand-off's fallback (set by the effect). */
	const dropRef = useRef<(() => void) | null>(null);

	// A LAYOUT effect so the first "gap" reaches the surface before paint: a
	// passive effect would paint one frame of the paused note on every open.
	useLayoutEffect(() => {
		const bridge = browserBridge();
		if (!bridge?.onCompositeFrame) return;
		const sink = new CompositeSink();
		let pending: CompositeFrame | null = null;
		let raf: number | null = null;
		let view: LiveCompositeView = "none";
		let gapTimer: ReturnType<typeof setTimeout> | null = null;
		let releaseRoot: (() => void) | null = null;
		// One context and one ImageData for the canvas's life, reallocated only
		// when the frame's size or colour space changes (review F2: a fresh
		// ~14 MB ImageData per frame at 2240x1588 was GC churn at frame rate).
		let context: CanvasRenderingContext2D | null = null;
		let image: ImageData | null = null;
		const gamut =
			typeof matchMedia === "function" ? matchMedia("(color-gamut: p3)") : null;
		const setView = (next: LiveCompositeView) => {
			if (next !== "gap" && gapTimer !== null) {
				clearTimeout(gapTimer);
				gapTimer = null;
			}
			// The opaque-panel flag (design D1) follows the picture exactly.
			if (next === "picture" && !releaseRoot)
				releaseRoot = holdLiveCompositeRoot(document.documentElement);
			if (next !== "picture" && releaseRoot) {
				releaseRoot();
				releaseRoot = null;
			}
			if (view === next) return;
			view = next;
			onViewChangeRef.current(next);
		};
		const enterGap = () => {
			setView("gap");
			if (gapTimer !== null) return;
			gapTimer = setTimeout(() => {
				gapTimer = null;
				if (view === "gap") setView("none");
			}, COMPOSITE_GAP_NOTE_DELAY_MS);
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
			// A display-p3 backing store holds either tag losslessly; the
			// ImageData's own tag tells Chromium what the bytes are (D2).
			context ??= canvas.getContext("2d", { colorSpace: "display-p3" });
			if (!context) return;
			if (canvas.width !== frame.width) canvas.width = frame.width;
			if (canvas.height !== frame.height) canvas.height = frame.height;
			const colorSpace = frameColorSpace(gamut);
			if (
				!image ||
				image.width !== frame.width ||
				image.height !== frame.height ||
				image.colorSpace !== colorSpace
			)
				image = context.createImageData(frame.width, frame.height, {
					colorSpace,
				});
			bgraToRgba(frame.pixels, image.data);
			context.putImageData(image, 0, 0);
			sink.markDrawn(frame);
			setView("picture");
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
			if (sink.clear(clear.generation, clear.reason)) wipe();
			// A "hold" keeps the last frame: still this page, still "picture".
			if (sink.hasPicture) return;
			// The overlay is gone: no new picture is coming here, so the surface
			// may unmount this canvas now that the native page is back.
			if (
				!suppressingRef.current ||
				clearDisposition(clear.reason) === "paused"
			)
				setView("none");
			else enterGap();
		});
		dropRef.current = () => {
			pending = null;
			wipe();
			setView("none");
		};
		// A fresh open: a frame normally follows; show the ground, not the note.
		enterGap();
		void bridge.setCompositeConsumer(true).catch(() => {});
		return () => {
			offFrame();
			offClear();
			if (raf !== null) cancelAnimationFrame(raf);
			pending = null;
			dropRef.current = null;
			wipe();
			setView("none");
			void bridge.setCompositeConsumer(false).catch(() => {});
		};
	}, []);

	// The close hand-off's fallback (see CLOSE_HANDOFF_FALLBACK_MS).
	useEffect(() => {
		if (suppressing) return;
		const timer = setTimeout(
			() => dropRef.current?.(),
			CLOSE_HANDOFF_FALLBACK_MS,
		);
		return () => clearTimeout(timer);
	}, [suppressing]);

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
