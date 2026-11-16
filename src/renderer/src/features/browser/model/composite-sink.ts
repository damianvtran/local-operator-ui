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

/**
 * What a CLEAR means for the picture, by main's reason (`composite-bridge.ts`).
 *
 * - "hold": a rect-only change on the same tab and document ("resized"). The old
 *   frame is still this page, so it stays on the canvas, stretched by CSS to
 *   the new rect, until the next generation's first frame (UX U2: a resize drag
 *   used to flash the paused note).
 * - "gap": a different page or document ("changed": tab switch or epoch bump;
 *   "navigation": a cross-document start). The old pixels must go (honesty),
 *   but the next picture normally follows within a few hundred ms, so the
 *   surface shows its plain ground and NOT the paused note, which would blink
 *   "Paused" between two live pictures (QA Q2, design D3). The note appears
 *   only if no frame arrives within `COMPOSITE_GAP_NOTE_DELAY_MS`.
 * - "paused": everything else (overlay closed, crash, destroyed, disposed, a
 *   failed subscription, an unknown reason): drop the picture; no frame is
 *   coming, so the honest state is the note, at once.
 */
export type CompositeClearDisposition = "hold" | "gap" | "paused";

export function clearDisposition(reason: unknown): CompositeClearDisposition {
	if (reason === "resized") return "hold";
	if (reason === "changed" || reason === "navigation") return "gap";
	return "paused";
}

/**
 * How long a picture-less gap may last before the paused note is shown.
 *
 * Set above the measured worst clear→next-frame gap with an overlay open, from
 * PR #1929 round 1 (n=2 tab switches/navigations, 16 ms canvas sampling): QA
 * saw ~130-250 ms; UX derived 316-139 = 177 ms (tab switch) and 319-71 =
 * 248 ms (navigation). 500 ms is twice that maximum, and it is the same bound
 * for a fresh open (mount to first frame), which no row measured. A headless
 * launch composites nothing, so there the note simply arrives 500 ms late.
 */
export const COMPOSITE_GAP_NOTE_DELAY_MS = 500;

export class CompositeSink {
	/** Every generation at or below this has been cleared. */
	private floor = 0;
	private drawnGeneration = 0;
	private drawnSeq = 0;
	/** A frame of a cleared generation is deliberately kept ("hold"). */
	private held = false;

	/** Whether a frame from a live generation is on the canvas. */
	get hasFrame(): boolean {
		return this.drawnGeneration > this.floor;
	}

	/** Whether ANY picture of the page is on the canvas: a live frame, or the
	 * last frame kept across a rect-only change. */
	get hasPicture(): boolean {
		return this.hasFrame || this.held;
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
		this.held = false;
	}

	/**
	 * Main ended `generation` for `reason`. Returns true when the canvas must be
	 * wiped; a "hold" clear keeps the drawn picture (see `clearDisposition`).
	 */
	clear(generation: number, reason?: unknown): boolean {
		if (!positiveInt(generation)) return false;
		const hadFrame = this.hasFrame && this.drawnGeneration <= generation;
		if (generation > this.floor) this.floor = generation;
		if (clearDisposition(reason) === "hold") {
			if (hadFrame) this.held = true;
			return false;
		}
		const wipe = hadFrame || this.held;
		this.held = false;
		return wipe;
	}
}

/**
 * BGRA (Skia's native N32 order, what `NativeImage.toBitmap()` yields) to the
 * RGBA `ImageData` wants, written into `out`. One pass over 32-bit words.
 *
 * PREMULTIPLIED ALPHA IS PASSED THROUGH, knowingly (review F5): Electron's
 * bitmap is premultiplied N32 (`native_image.cc` `MakeN32Premul`) while
 * `ImageData` is unpremultiplied, so a TRANSLUCENT page pixel would draw a
 * little dark. The composited page is opaque (alpha 255, where premultiplied
 * and straight are identical), so unpremultiplying would cost a divide per
 * pixel on every frame for no visible change.
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

/**
 * The document-root flag that makes floating panels opaque while a live page
 * picture is drawn (design D1).
 *
 * WHY. On glass, menus, popovers and the update card are translucent
 * (`--lo-glass-a-overlay` in `styles/index.css`), at a floor derived against the
 * app's own translucent column underneath. Over an opaque live PAGE there is no
 * such column: over a white page the muted ink fell to 3.36:1 (design round 1,
 * from the measured 0.75 alpha and inks), under the 4.5:1 text floor. While
 * this flag is on the root, `index.css` scopes `--lo-glass-a-overlay: 1`, the
 * opaque plate, which branding.md already names as what sits over "web pages in
 * the browser view". It is window-wide rather than per-panel: telling which
 * panel crosses the page would need layout reads per frame, and an opaque
 * panel elsewhere for the life of an overlay is the safe direction.
 *
 * Ref-counted per root so two surfaces (or a remount racing an unmount) cannot
 * clear each other's flag.
 */
export const LIVE_COMPOSITE_ROOT_ATTRIBUTE = "data-browser-live-composite";

interface FlaggableRoot {
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
}

const rootHolds = new WeakMap<FlaggableRoot, number>();

/** Set the flag while held; the returned release is idempotent. */
export function holdLiveCompositeRoot(root: FlaggableRoot): () => void {
	const count = (rootHolds.get(root) ?? 0) + 1;
	rootHolds.set(root, count);
	if (count === 1) root.setAttribute(LIVE_COMPOSITE_ROOT_ATTRIBUTE, "");
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const left = (rootHolds.get(root) ?? 1) - 1;
		rootHolds.set(root, left);
		if (left <= 0) root.removeAttribute(LIVE_COMPOSITE_ROOT_ATTRIBUTE);
	};
}
