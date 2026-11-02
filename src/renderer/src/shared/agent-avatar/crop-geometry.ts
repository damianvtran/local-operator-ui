/**
 * The square crop's geometry, as pure functions.
 *
 * Ported from the Radient console's hand-rolled cropper
 * (`radient-ml/user-console/src/components/account/avatar-cropper.tsx`), which
 * the operator named as the behaviour to match: a "cover" fit times a zoom
 * multiplier in 1-4x, with the offset clamped so the square viewport is never
 * left with empty space. Lifted out of the component so the rules a reviewer
 * cares about - no gaps at any zoom, zoom pivots on the centre, recenter really
 * centres - are asserted in Node (`scripts/agent-avatar.test.mjs`) rather than
 * only eyeballed in a frame.
 *
 * All coordinates are in VIEWPORT pixels: `offset` is where the scaled image's
 * top-left corner sits relative to the viewport's, so it is always <= 0.
 */

export const CROP_MIN_ZOOM = 1;
export const CROP_MAX_ZOOM = 4;
/** One button press or `+`/`-` key: sixteen steps across the whole range. */
export const CROP_ZOOM_STEP = 0.25;
/** One arrow key, in viewport pixels. */
export const CROP_KEYBOARD_PAN = 16;
/** The stored edge (contract: always a 512x512 square). */
export const CROP_OUTPUT_EDGE = 512;

export type CropSize = { width: number; height: number };
export type CropOffset = { x: number; y: number };

export function clampZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return CROP_MIN_ZOOM;
	return Math.min(CROP_MAX_ZOOM, Math.max(CROP_MIN_ZOOM, zoom));
}

/** The scale at which the image's SHORT side exactly fills the viewport. */
export function coverScale(image: CropSize, viewport: number): number {
	return Math.max(viewport / image.width, viewport / image.height);
}

/**
 * The offset pulled back inside the image, so the viewport is covered on both
 * axes at this zoom. Every write of an offset goes through this.
 */
export function clampOffset(
	image: CropSize,
	viewport: number,
	zoom: number,
	offset: CropOffset,
): CropOffset {
	const scale = coverScale(image, viewport) * clampZoom(zoom);
	const minX = viewport - image.width * scale;
	const minY = viewport - image.height * scale;
	return {
		x: Math.min(0, Math.max(minX, offset.x)),
		y: Math.min(0, Math.max(minY, offset.y)),
	};
}

/** The offset that centres the image at this zoom. */
export function centredOffset(
	image: CropSize,
	viewport: number,
	zoom = CROP_MIN_ZOOM,
): CropOffset {
	const scale = coverScale(image, viewport) * clampZoom(zoom);
	return {
		x: (viewport - image.width * scale) / 2,
		y: (viewport - image.height * scale) / 2,
	};
}

/**
 * Zoom to `next` while the point under the viewport's centre stays put, which
 * is what keeps a face from sliding out of frame as it grows. Both zooms are
 * clamped first: a floor below 1 would shrink the image under its cover fit and
 * bake transparent gaps into the saved square.
 */
export function zoomAround(
	image: CropSize,
	viewport: number,
	current: number,
	next: number,
	offset: CropOffset,
): { zoom: number; offset: CropOffset } {
	const from = clampZoom(current);
	const zoom = clampZoom(next);
	const ratio = zoom / from;
	const centre = viewport / 2;
	return {
		zoom,
		offset: clampOffset(image, viewport, zoom, {
			x: centre - (centre - offset.x) * ratio,
			y: centre - (centre - offset.y) * ratio,
		}),
	};
}

/**
 * The image's draw rectangle on a square target of `target` pixels, for the
 * same crop the viewport shows. One function for the viewport, every preview
 * and the saved output, so none of them can disagree about the framing.
 */
export function drawRect(
	image: CropSize,
	viewport: number,
	zoom: number,
	offset: CropOffset,
	target: number,
): { dx: number; dy: number; dw: number; dh: number } {
	const k = target / viewport;
	const scale = coverScale(image, viewport) * clampZoom(zoom);
	const clamped = clampOffset(image, viewport, zoom, offset);
	return {
		dx: clamped.x * k,
		dy: clamped.y * k,
		dw: image.width * scale * k,
		dh: image.height * scale * k,
	};
}
