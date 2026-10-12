/**
 * The image viewer's zoom controls and the in-group carousel: the states this
 * change adds, photographed.
 *
 * WHY THIS FILE EXISTS BESIDE `image-expand.stories.tsx`. That set is the record
 * of the overlay's first life — one picture, one close button, the size rule —
 * and its frames are the BEFORE generation for everything here. This file is the
 * AFTER half: the same press, now with chrome. The two live in separate files
 * because a frame's directory is derived from the story TITLE (the capture rig
 * and the manifest both read it), so a set that pairs before/after under one
 * name needs its own title; the sibling's shapes (`Column`, the shutter latch)
 * are re-stated here at their smallest rather than imported, the way every
 * stories file in this tree carries its own scaffold.
 *
 * THE STATES, and what each answers:
 *
 * - `viewer` is the single picture as the transcript draws it; the rig presses
 *   it and photographs FIT (the controls at rest over the scrim), ZOOMED (2x,
 *   the centre of the picture), ZOOMED-PANNED (a real drag after the zoom, the
 *   pan clamped to the picture's own edge) and RESET (fit again after a zoom —
 *   the frame is the SEQUENCE that matters, and the transform's return to
 *   nothing is asserted in `scripts/chat-image-expand.test.mjs`, because a
 *   still of the reset state alone is a still of the fit state).
 * - `group` is a condensed group's strip — three pictures, one of them bytes
 *   the store cannot serve — and the rig presses its first tile: the carousel
 *   opens ON the pressed picture, the strip shows what is known (two tiles and
 *   a receipt), and `carousel-next` steps onto the second picture while
 *   `carousel-leftwrap` presses ArrowLeft from the first — the walk wraps, so
 *   that frame lands on the set's LAST picture and carries two facts at once:
 *   left works, and an end is not a dead end.
 *
 * WHAT IS NOT COVERED, stated here rather than implied: the controls' FADE (a
 * still photographs the awake state; after `SCROLLBAR_HOLD_MS` of idle they dim
 * to 45% and return on pointer, key or focus activity, which is behaviour the
 * jsdom suite mounts and no still can carry); the pan's clamp arithmetic (a
 * jsdom unit case holds it); and a real relay fetch — the pictures here are
 * inline `data:` URIs and the receipt is an image with no bytes at all, which is
 * the one not-loaded state a story can stage honestly without a backend.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useEffect } from "react";
import "../../../../styles/index.css";
import { FoldMedia } from "../../canonical/fold-media";
import { ImageAttachment } from "./image-attachment";

/**
 * A wide invoice-shaped view, 1600x600 — the same fixture family as
 * `image-expand.stories.tsx` (LARGER than the box the overlay offers a picture,
 * so the fit is real, and flat bands so the frame's dominant colour stays the
 * scrim, which `check-evidence` reads as "the story painted"). Eight bands
 * rather than the sibling's twelve because the bands are also this set's ruler:
 * a zoom crops to the picture's centre and a pan walks it, and WHICH bands are
 * on screen is what a reader checks the crop against.
 */
const BANDS_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAABkAAAAJYBAMAAADI6DdxAAAAGFBMVEWWYFp4jKhAUnjSvJbEzNhgSGC8jG4kLEK0ODTCAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAJRUlEQVR42u3TAQ2AMBAAsbcwC1jAwixgAQuzj4tLSFoPnRO4AiuwA3fgDUzgCYwggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIIIIogggggiiCCCCCKIIIII8rcgH0ee4/7YsV36AAAAAElFTkSuQmCC";

const bands = `data:image/png;base64,${BANDS_PNG_BASE64}`;

/**
 * The strip's own portrait fixture — 2x6, the sibling set's `PORTRAIT_BASE64`,
 * kept identical so the second tile of the carousel is the same phone-aspect
 * shape every other strip frame in the evidence tree shows.
 */
const PORTRAIT_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAIAAAAGCAIAAABmRdhlAAAAEElEQVR42mMIqDgBRAyEKQCEWRLBtZF+SAAAAABJRU5ErkJggg==";

/**
 * The carousel's group: two pictures with bytes and one the store cannot serve.
 * The third has NO `data` and NO `attachment`, which resolves `missing` on the
 * first render — the one "not loaded" state that is a fact rather than a race,
 * so the strip's receipt and the viewer's fallback are stable in a still.
 */
const groupImages = [
	{
		id: "viewer-controls:bands",
		data: BANDS_PNG_BASE64,
		attachment: null,
		mimeType: "image/png",
	},
	{
		id: "viewer-controls:portrait",
		data: PORTRAIT_BASE64,
		attachment: null,
		mimeType: "image/png",
	},
	{
		id: "viewer-controls:absent",
		data: null,
		attachment: null,
		mimeType: "image/png",
	},
];

/**
 * The overlay's own picture, which the latch waits for: the viewer's frame is
 * named so the strip's thumbnails (also `<img>`s, also inside the dialog) can
 * never satisfy the wait — a release on the wrong element was the sibling set's
 * "Checking whether this machine can speak aloud…" class of defect, where the
 * shutter photographed a state the story had not reached.
 */
const VIEWER_PICTURE = '[role="dialog"] [data-image-viewport] img';

/**
 * The message view's shape: the agent's prose at reading weight, then the
 * attachment in the wrapper `message-item/index.tsx` gives it, in the shared
 * 810px column the contract caps agent output at. Re-stated from the sibling
 * file so both sets photograph the same world.
 */
const Column = ({ children }: { children: ReactNode }) => (
	<div className="min-h-screen bg-canvas p-8">
		<div className="mx-auto flex w-full max-w-[810px] flex-col gap-4">
			<p className="text-body text-ink">
				March is reconciled. The screenshots are below; the totals are in the
				table that follows.
			</p>
			<div className="mb-2 flex flex-col gap-2">{children}</div>
			<p className="text-body text-ink">
				Nothing else needs your attention today.
			</p>
		</div>
	</div>
);

/**
 * Hold the shutter until the claim is on screen. `data-capture-pending` is the
 * rig's latch convention: the capture waits on it and THROWS if it never
 * clears, so a frame of a layer whose picture merely had not decoded yet cannot
 * ship under a name that claims the open state.
 */
const useShutterLatch = (until: () => boolean) => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let frame = 0;
		let cancelled = false;
		const tick = () => {
			if (cancelled) return;
			if (until()) {
				document.documentElement.removeAttribute("data-capture-pending");
				return;
			}
			if (frame++ < 600) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return () => {
			cancelled = true;
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, [until]);
};

const viewerDecoded = () => {
	const image = document.querySelector<HTMLImageElement>(VIEWER_PICTURE);
	return image?.complete === true && image.naturalWidth > 0;
};

const carouselReady = () =>
	viewerDecoded() && document.querySelector("[data-image-filmstrip]") !== null;

/** The single picture, where the conversation puts it, with the shutter latch. */
const ViewerThread = () => {
	useShutterLatch(viewerDecoded);
	return (
		<Column>
			<ImageAttachment
				file={bands}
				src={bands}
				conversationId="image-viewer-controls"
			/>
		</Column>
	);
};

/**
 * The condensed group's strip, with the carousel's own latch: the overlay's
 * picture decoded AND the strip mounted, because "the carousel is open" is a
 * claim about both and a frame with either half missing would understate the
 * state the tuples press into.
 */
const GroupStrip = () => {
	useShutterLatch(carouselReady);
	return (
		<Column>
			<FoldMedia
				images={groupImages}
				scope={null}
				onRevealMore={() => {}}
				indent="flush"
			/>
		</Column>
	);
};

const meta: Meta = {
	title: "Image viewer controls",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/*
 * Both stories mount the surface AT REST; the rig presses it (a real pointer
 * press through CDP's input pipeline) and presses the controls the frames are
 * about, so every overlay still is the result of a real gesture rather than of
 * a state hand-mounted into the camera — the rule `image-expand.stories.tsx`
 * learned in design round 2 (D2-4) and this set inherits.
 */

/** The transcript's picture; the rig opens the overlay and drives the controls. */
export const Viewer: Story = {
	render: () => <ViewerThread />,
};

/** A condensed group's strip; the rig presses its first tile. */
export const Group: Story = {
	render: () => <GroupStrip />,
};
