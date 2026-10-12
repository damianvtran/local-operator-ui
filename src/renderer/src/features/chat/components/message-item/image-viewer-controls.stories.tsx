/**
 * The image viewer's zoom controls and the in-group carousel: the states this
 * change adds, photographed.
 *
 * WHY THIS FILE EXISTS BESIDE `image-expand.stories.tsx`. That set is the record
 * of the overlay's first life — one picture, one close button, the size rule —
 * and it remains that set's own history; the BEFORE generation for everything
 * HERE is `docs/evidence/image-viewer-controls-before/`, captured at this
 * branch's base (`7a392ecf943`) with the set's story trimmed to the base
 * components (agent review round 1, R1-6: pointing a reader at `image-expand`
 * would diff against a different base than the committed pair). This file is the
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
 *   pan clamped to the picture's own edge), RESET (fit again after a zoom —
 *   byte-identical to fit, which is the strongest form that claim takes as a
 *   still) and RESTING (the reader stops touching it: the cluster dims after
 *   `SCROLLBAR_HOLD_MS` and the frame is that quiet state — design round 1's
 *   D1-2, reachable because focus no longer parks in the cluster at open).
 * - `group` is a condensed group's strip — FOUR pictures, one of them bytes
 *   the store cannot serve — and the rig presses its middle tile: the carousel
 *   opens ON the pressed picture (which the fourth picture makes readable in
 *   the frame itself), the strip shows what is known (three tiles and a
 *   receipt, the receipt's SLOT carrying the current ring when the walk lands
 *   on it), and `carousel-next` steps forward while `carousel-leftwrap` presses
 *   ArrowLeft from the first — the walk wraps, so that frame lands on the set's
 *   LAST picture and carries two facts at once: left works, and an end is not a
 *   dead end.
 * - `group-wide` is a group LONGER than the strip's viewport (ten tiles at a
 *   1280 frame): `wide-walk` walks to the far end so the strip must scroll the
 *   current into view (design round 1, D1-5) — the behaviour no three-tile
 *   fixture can show.
 *
 * COVERED: the controls' fade landing is photographed in `resting/`; the
 * jsdom cases pin dim-after-hold, wake-on-pointer and held-awake-while-focused.
 * NOT COVERED AS PIXELS: the pan's clamp arithmetic (a jsdom unit case holds
 * it), and a real relay fetch — the pictures here are
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
 * The carousel's second picture: a 400x1200 phone-aspect strip of twelve
 * horizontal bands.
 *
 * NOT the sibling set's 2x6 `PORTRAIT_BASE64`, and the reason is a frame that
 * was taken and looked at: the overlay's fit rule keeps a small picture its OWN
 * size (see `PICTURE_BOX` — "a 240x180 picture offered nearly the whole
 * viewport stays 240x180"), so the 2x6 fixture renders in the viewer as a
 * two-by-six-pixel speck — honest, and useless as a frame for "the carousel
 * switched to the second picture". This fixture is the smallest shape that
 * FILLS the box the way a real phone capture does (~265x796 fitted), so the
 * `carousel-next` frame states its claim at a glance, and the strip's second
 * tile shows the same picture compressed into the slot the way the first does.
 */
const PORTRAIT_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAZAAAASwBAMAAAAnBQFuAAAAJFBMVEWYqsg0OEjG0OCWYFqwvtTe5O68lm5QSGB0VG7SxKBshLSAlr7mOirBAAAACXBIWXMAAAPoAAAD6AG1e1JrAAADr0lEQVR42u3PwQCAQAAEwFNIIYUUUkghhVNIIYUUkgth/9uMwYyjxBARERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERiZG1hIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIhIjuwlRERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERyBAAAAAAAAAAAAAAAAAAAAAAAAID/eEuIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiOTIU0JEREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREJEfuEiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiOXKWEBERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERHJka2EiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiEiOXCVERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERHJklhARERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERyZGlhIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIhI9AHDQnxLQg4PywAAAABJRU5ErkJggg==";

/**
 * The carousel's group: two pictures with bytes and one the store cannot serve.
 * The third has NO `data` and NO `attachment`, which resolves `missing` on the
 * first render — the one "not loaded" state that is a fact rather than a race,
 * so the strip's receipt and the viewer's fallback are stable in a still.
 */
/**
 * The carousel's FOURTH picture: a 600x600 square of six vertical bands.
 *
 * It exists so each carousel frame can discriminate (agent review round 1,
 * R1-5): with three pictures, "opens ON the pressed tile" and "walked forward
 * from the first" land on the same picture, and a frame cannot tell the reader
 * which happened. With a fourth, `carousel-open` presses the MIDDLE tile and
 * every walk frame ends somewhere the others cannot reach.
 */
const SQUARE_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAlgAAAJYBAMAAABMSIXvAAAAElBMVEU0PFRoVGiotMiwhG7e1sRgdJa8HpuLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAADPElEQVR42u3Q0RQAIBAEwFVIIYVTSCF/lRj2tzeDMEnt1nbt1Ka2apElS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIl68+sB3qEwZ2WQGS2AAAAAElFTkSuQmCC";

/**
 * Eight solid plates for the WIDE story below: the smallest pictures that still
 * fill a tile (a 1x1 would photograph the fit rule rather than the strip), one
 * flat colour each so the strip's scroll is the only thing moving in the frame.
 */
const WIDE_PLATE_BASE64S = [
	"iVBORw0KGgoAAAANSUhEUgAAAUAAAADwBAMAAACDA6BYAAAAA1BMVEVGVG6nsBinAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPBpbwAAHhNYqoAAAAAElFTkSuQmCC",
	"iVBORw0KGgoAAAANSUhEUgAAAUAAAADwBAMAAACDA6BYAAAAA1BMVEVufqCCWSxgAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPBpbwAAHhNYqoAAAAAElFTkSuQmCC",
	"iVBORw0KGgoAAAANSUhEUgAAAUAAAADwBAMAAACDA6BYAAAAA1BMVEWWpL64Vh7+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPBpbwAAHhNYqoAAAAAElFTkSuQmCC",
	"iVBORw0KGgoAAAANSUhEUgAAAUAAAADwBAMAAACDA6BYAAAAA1BMVEXEzNzZ9gX7AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPBpbwAAHhNYqoAAAAAElFTkSuQmCC",
	"iVBORw0KGgoAAAANSUhEUgAAAUAAAADwBAMAAACDA6BYAAAAA1BMVEXOuJYJO5RRAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPBpbwAAHhNYqoAAAAAElFTkSuQmCC",
	"iVBORw0KGgoAAAANSUhEUgAAAUAAAADwBAMAAACDA6BYAAAAA1BMVEW4inT6M1eWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPBpbwAAHhNYqoAAAAAElFTkSuQmCC",
	"iVBORw0KGgoAAAANSUhEUgAAAUAAAADwBAMAAACDA6BYAAAAA1BMVEWSYlxs+0W+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPBpbwAAHhNYqoAAAAAElFTkSuQmCC",
	"iVBORw0KGgoAAAANSUhEUgAAAUAAAADwBAMAAACDA6BYAAAAA1BMVEVeSmCGfPi3AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPBpbwAAHhNYqoAAAAAElFTkSuQmCC",
];

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
	{
		id: "viewer-controls:square",
		data: SQUARE_BASE64,
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
 * Ten pictures for `group-wide`: the two real fixtures plus the eight plates.
 * Ten tiles need 117*10 + 8*9 + padding = ~1,254px against the strip's
 * `max-w-[calc(100vw-256px)]` = 1,024 at the 1280 capture viewport, so the
 * strip CANNOT fit them all and the walk has to scroll (design round 1, D1-5).
 */
const wideImages = [
	{
		id: "viewer-controls:wide-bands",
		data: BANDS_PNG_BASE64,
		attachment: null,
		mimeType: "image/png",
	},
	{
		id: "viewer-controls:wide-portrait",
		data: PORTRAIT_BASE64,
		attachment: null,
		mimeType: "image/png",
	},
	...WIDE_PLATE_BASE64S.map((data, index) => ({
		id: `viewer-controls:wide-plate-${index + 1}`,
		data,
		attachment: null,
		mimeType: "image/png",
	})),
];

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

/** The same strip, with a group the strip cannot fit — see `wideImages`. */
const WideStrip = () => {
	useShutterLatch(carouselReady);
	return (
		<Column>
			<FoldMedia
				images={wideImages}
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

/** A group longer than the strip's viewport; the walk must scroll it. */
export const GroupWide: Story = {
	render: () => <WideStrip />,
};
