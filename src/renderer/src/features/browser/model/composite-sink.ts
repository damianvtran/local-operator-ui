/**
 * The renderer half of the live composite (main: `src/main/browser/composite-bridge.ts`).
 *
 * While an app overlay hides the native page, main forwards the page's full
 * compositor frames and this side paints them into a display-only canvas under
 * the overlay. This module is the part that decides WHETHER a frame may be
 * drawn, kept free of React and the DOM so it is unit-testable
 * (`scripts/browser-composite-bridge.test.mjs`).
 *
 * THE RULE IS HONESTY: once main has cleared a generation (overlay closed, tab
 * switched, navigation, crash, teardown) no frame of that generation — or an
 * older one — may be drawn, even one that was already decoded and waiting for
 * the next animation frame. A stale picture shown as "the page" is worse than
 * the paused note, so the caller re-checks `current()` immediately before
 * drawing.
 */

export interface CompositeFrameMeta {
	generation: number;
	frameSeq: number;
	width: number;
	height: number;
	pixels: { byteLength: number };
}

const positiveInt = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value > 0;

export class CompositeSink {
	/** Every generation at or below this has been cleared. */
	private floor = 0;
	private drawnGeneration = 0;
	private drawnSeq = 0;

	/** Whether a frame from a live generation is on the canvas. */
	get hasFrame(): boolean {
		return this.drawnGeneration > this.floor;
	}

	/** Shape and freshness check on arrival. */
	accept(frame: CompositeFrameMeta | null | undefined): boolean {
		if (!frame || typeof frame !== "object") return false;
		if (
			!positiveInt(frame.generation) ||
			!positiveInt(frame.frameSeq) ||
			!positiveInt(frame.width) ||
			!positiveInt(frame.height) ||
			frame.pixels?.byteLength !== frame.width * frame.height * 4
		)
			return false;
		return this.current(frame);
	}

	/** The draw-time re-check: still newer than any clear and any drawn frame. */
	current(frame: CompositeFrameMeta): boolean {
		if (frame.generation <= this.floor) return false;
		if (frame.generation < this.drawnGeneration) return false;
		if (
			frame.generation === this.drawnGeneration &&
			frame.frameSeq <= this.drawnSeq
		)
			return false;
		return true;
	}

	markDrawn(frame: CompositeFrameMeta): void {
		this.drawnGeneration = frame.generation;
		this.drawnSeq = frame.frameSeq;
	}

	/** Main ended `generation`. Returns true when the canvas must be wiped. */
	clear(generation: number): boolean {
		if (!positiveInt(generation)) return false;
		const hadFrame = this.hasFrame && this.drawnGeneration <= generation;
		if (generation > this.floor) this.floor = generation;
		return hadFrame;
	}
}

/**
 * BGRA (Skia's native N32 order, what `NativeImage.toBitmap()` yields) to the
 * RGBA `ImageData` wants, written into `out`. One pass over 32-bit words.
 */
export function bgraToRgba(source: Uint8Array, out: Uint8ClampedArray): void {
	const length = Math.min(source.byteLength, out.byteLength) >>> 2;
	const aligned = source.byteOffset % 4 === 0;
	if (aligned && out.byteOffset % 4 === 0) {
		const src = new Uint32Array(source.buffer, source.byteOffset, length);
		const dst = new Uint32Array(out.buffer, out.byteOffset, length);
		for (let i = 0; i < length; i++) {
			const p = src[i];
			// Little-endian word: 0xAARRGGBB as bytes B,G,R,A -> want R,G,B,A,
			// i.e. 0xAABBGGRR: swap the R and B bytes, keep G and A.
			dst[i] =
				(p & 0xff00ff00) | ((p & 0x000000ff) << 16) | ((p >>> 16) & 0x000000ff);
		}
		return;
	}
	for (let i = 0; i < length * 4; i += 4) {
		out[i] = source[i + 2];
		out[i + 1] = source[i + 1];
		out[i + 2] = source[i];
		out[i + 3] = source[i + 3];
	}
}
