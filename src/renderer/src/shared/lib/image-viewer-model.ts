/**
 * The image viewer's arithmetic, as one module: which picture a left/right step
 * lands on, the zoom ladder a zoom press walks, and what a pan is allowed to
 * reach. Pure functions, for the same reason `trace-fold-model` is one: the
 * rules the viewer must obey are what a test can hold, and a rule kept inside a
 * JSX event handler is a rule nobody can exercise without a DOM.
 *
 * The two halves are one module because they are one surface's rules — the
 * lightbox is the only consumer — and splitting them would put the wrap rule in
 * `canonical/` and the ladder in `shared/`, which is how a second copy of one
 * of them eventually appears.
 *
 * WHAT IS DELIBERATELY ABSENT. No animation curve, no timing: zoom steps SNAP
 * (a step is a state change, and the motion budget `branding.md` § 5 spends on
 * entrances is not spent here), and the pan is bounded per pointermove rather
 * than eased. No inertia: rubber-banding past the bound is exactly the feel the
 * viewer's own note refuses, so the clamp is a hard wall with zero slack —
 * the picture's edge may reach the frame's, and no more.
 */

import { t } from "@shared/i18n";

/**
 * The zoom ladder, in multiples of the fitted size.
 *
 * `1` IS FIT, and it is the only member that does not enlarge: the fitted
 * picture is what `max-w`/`max-h` renders, and 2/3/4 are multiples of THAT
 * (not of the source), so a 240x180 picture and a 2760-wide screenshot walk the
 * same four states. The ceiling is 4 because a screenshot read at 4x is about
 * as far as a 1:1 inspect goes on the displays this app runs on; the floor is 1
 * because zooming OUT below fit would shrink the picture inside its own box
 * for no reader's benefit.
 */
export const VIEWER_ZOOM_MIN = 1;
export const VIEWER_ZOOM_MAX = 4;

/** One step along the ladder, clamped at both ends. */
export const stepZoom = (zoom: number, delta: number): number =>
	Math.min(VIEWER_ZOOM_MAX, Math.max(VIEWER_ZOOM_MIN, zoom + delta));

/** A pan offset in CSS pixels, from the frame's centred position. */
export type ViewerPan = { x: number; y: number };

/**
 * A fresh view: fitted and centred. Frozen because it is handed to `useState`
 * and an accidental mutation of it would edit every future reset's origin.
 */
export const VIEWER_PAN_ORIGIN: ViewerPan = Object.freeze({ x: 0, y: 0 });

/**
 * Clamp an index into a group of `count`.
 *
 * This is the READ-side clamp, not the walk: it answers for an index that has
 * gone stale because the group changed under it — a windowed transcript can
 * unmount the rows behind a group while its carousel is open, so a position the
 * reader already chose may name a picture that no longer exists.
 */
export const clampGroupIndex = (index: number, count: number): number => {
	if (count <= 0) return 0;
	return Math.min(count - 1, Math.max(0, Math.trunc(index)));
};

/**
 * Walk `delta` pictures through a group of `count`, WRAPPING at both ends.
 *
 * The wrap is the viewer's own choice and it is argued rather than assumed: the
 * alternative (disabled arrows at the ends) drops keyboard focus the moment a
 * press lands on the end arrow — a disabled control cannot hold focus, so the
 * reader is dumped on `<body>` inside a modal — and for the small groups this
 * carousel exists for (a run's 2-5 pictures) a ring is easier to read than a
 * dead control. The filmstrip marks the current picture, so position is never
 * lost to the wrap.
 */
export const wrapGroupIndex = (
	index: number,
	count: number,
	delta: number,
): number => {
	if (count <= 0) return 0;
	return (((index + delta) % count) + count) % count;
};

/**
 * The position sentence a reader hears on a switch, e.g. "Image 2 of 3".
 *
 * One noun, the one `fold-media.tsx` established up the tree (`the count in the
 * condensed header, the name in each tile's accessible label`): a run's
 * artifacts are images, and the viewer speaks it here so the strip, the tiles
 * and the announcement cannot drift apart.
 */
export const groupPositionLabel = (index: number, count: number): string =>
	t("ui.common.viewer.position", {
		kind: "image",
		index: index + 1,
		count,
	});

/**
 * Clamp a pan so the picture never shows a gap between its edge and the frame's.
 *
 * The bound, derived rather than tuned: at zoom `z` the picture's visual size is
 * `size * z` and the frame stays `size`, so the picture overhangs by
 * `size * (z - 1)` in total — `size * (z - 1) / 2` per side — and that overhang
 * is exactly the pan range that keeps the picture covering the frame. At
 * `z = 1` the range is zero, which is the "pan only when zoomed beyond fit" rule
 * expressed as arithmetic rather than as a guard the handlers have to remember.
 *
 * `size` is the FITTED box (the frame the picture was laid out into), read from
 * the live element; a size that has not been measured yet (0) clamps to centre,
 * because a pan without a frame to bound it has no honest value to take.
 */
export const clampViewerPan = (
	pan: ViewerPan,
	size: { width: number; height: number },
	zoom: number,
): ViewerPan => {
	const margin = Math.max(0, zoom - 1) / 2;
	const limitX = size.width * margin || 0;
	const limitY = size.height * margin || 0;
	return {
		x: Math.min(limitX, Math.max(-limitX, pan.x)),
		y: Math.min(limitY, Math.max(-limitY, pan.y)),
	};
};
