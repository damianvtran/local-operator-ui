/**
 * The conversation picture, expanded: the state the operator asked for.
 *
 * The report was a screenshot in a transcript that could not be read at the size
 * the transcript gives it, and a click on a canonical row that did nothing at
 * all. Three frames carry the answer, and each answers a different question:
 *
 * - `in-thread` is the state the click acts on — the picture as the message view
 *   draws it, at `max-h-[240px]`, with its new "Click to expand" title.
 * - `expanded` is the overlay: the picture fitted into the viewport at 90vw/90vh
 *   (measured 1152x432 in a 1280x900 frame — the width binds, so the 5% side
 *   margin is exact and the top and bottom bare 234px because the picture's aspect
 *   is wider than the viewport's), on the theme's own scrim, with the app still
 *   visible behind it and the close button in the corner.
 * - `expanded-small-image` is the size rule. `max-w`/`max-h` and no width means a
 *   24x18 PNG stays 24x18 rather than being blown up 40x into a blur, and this is
 *   the frame that says so; the design round owns the call, not this file.
 *
 * FOUR MORE STATES, added for the round-1 review rather than for the operator's
 * report, each naming the frame that closes a finding:
 *
 * - `expanded-near-viewport` is a picture at the VIEWPORT'S OWN aspect (1.42),
 *   which is the one band where the close button's focus ring and the picture's
 *   corner can collide: the ring reaches 48px from the top and right edges and a
 *   picture fitted to a bare 90vh leaves 45px. Design round 1 filed it as D1-3
 *   from arithmetic and QA round 1 as Q-5, both asking for the frame.
 * - `expanded-portrait` is the phone-aspect capture (828x1792) that
 *   `image-attachment.tsx` already names as a real input, so the height-capped
 *   composition is photographed rather than implied.
 * - `expanded-failed` is the overlay's failure state (review R1-4, QA Q-1): a
 *   picture that will not decode draws the transcript's own `BrokenAttachment`
 *   inside a reserved box instead of collapsing the layer to a strip of label
 *   text. Its latch waits for that copy to appear, so the capture FAILS rather
 *   than photographing the wrong state — this is the assertion for that state,
 *   because jsdom cannot dispatch an image error without leaving a failing task
 *   behind (the note in `scripts/chat-image-expand.test.mjs` has the measurement).
 * - `legacy` is the surface the file-actions menu lives on, and the rig drives it
 *   four ways: at rest, under a real pointer (`legacy-hovered`), focused by real
 *   Tab presses (`legacy-tabbed`), and ACTIVATED by Enter (`legacy-tabbed-open`,
 *   whose capture fails if the menu's items never appear) — the keyboard half of
 *   review R1-1.
 *
 * WHAT IS REAL HERE. The picture is the production `ImageAttachment`, mounted the
 * way `message-item/index.tsx` mounts it (the same `flex flex-col gap-2` wrapper,
 * the same props), and `expanded` gets there by PRESSING the picture's own button
 * rather than by rendering an overlay open — a story that hand-mounted
 * `ImageLightbox` would prove the overlay draws and not that anything reaches it.
 * The shutter is held through the press with `data-capture-pending`, the
 * convention `run-details.stories.tsx` uses, so a frame of the closed state
 * cannot be photographed and shipped as the open one.
 *
 * WHAT IS NOT. The column behind the scrim is the message view's shape rather
 * than a mounted `MessageItem`: this surface's subject is the overlay, and
 * mounting the whole message would drag in the backend client the transcript's
 * attachment URLs resolve through (`getAttachmentUrl`), which no fixture answers.
 * The picture is a `data:` URI for the same reason — real bytes, no request. The
 * canonical surface (`CanonicalImage`) differs from this one only in where `src`
 * comes from; the expansion lives inside `ImageAttachment`, which both call.
 */

import { ImageLightbox } from "@shared/components/common/image-lightbox";
import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useEffect } from "react";
import "../../../../styles/index.css";
import {
	ATTACHMENT_UNAVAILABLE_COPY,
	BrokenAttachment,
} from "./attachment-frame";
import { ImageAttachment } from "./image-attachment";

/**
 * A wide invoice view, 1600x600 — LARGER than the 90vw/90vh box the overlay
 * offers it, so the `expanded` frame shows the picture being FITTED with the 5%
 * margin rather than sitting at its natural size inside a box it fits in anyway.
 * A picture under the box renders at its natural size (that is what `max-w`/`max-h`
 * and no width means), which is a real state but not the one the margin rule is
 * about — `expanded-small-image` is the other half, on a picture smaller than the
 * box.
 *
 * Its ASPECT is chosen, and the constraint is `check-evidence`: a picture fitted
 * to a 1280x900 viewport with a near-square aspect fills most of the frame, so the
 * picture's own white becomes the frame's dominant colour and the ground check
 * reads that as "the story did not paint" (measured: a 1200x750 fixture at the
 * same viewport failed at ΔE00 79.41 from the nearest `localOperatorDark` ground,
 * which is the same number the check's header records for the blank frame it was
 * written for). An aspect wider than the viewport is fitted by WIDTH — 1152x432 in
 * a 1280x900 frame — so the scrim still covers the most pixels while the binding
 * axis carries the margin this story exists to show.
 *
 * Real bytes rather than a flat swatch, so a reader can tell "the picture
 * rendered" from "the box rendered" — the failure `run-details.stories.tsx`
 * names for the same reason. 12 colours and no anti-aliasing keep the literal
 * small enough to sit in a source file (5.8 KB).
 */
const SCREENSHOT_PNG_BASE64 =
	"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";

/**
 * 240x180 — small next to the box the overlay offers it, and big enough to read
 * in a frame. A rule that fitted every picture to the viewport would stretch this
 * one to the whole of it, which is the blur the rule exists to avoid.
 */
const SMALL_IMAGE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAPAAAAC0BAMAAABYsrzbAAAAFVBMVEXx8vQ/QknJzNL///9PfP+LkJnm6OyMTaPPAAABx0lEQVR42u3X4U3DQAyG4Y7AKRuwQWR5AtjA8gRI7D8Ctq+U/qhQEdyFNK+jNEmR+vD10nPudKIo6iGq/aCegIGBKYoaXs8b1XawbFTAwMDAwLuDF1nXreCpide2NmnxsqxRTdZlEhxU/5aXlPN1VuKQlogtrcOtzRrj1sNeEs8a4whaYyw1xhl+2l1976C+Xupl57AAHwr+7sOBjwb/4t8Angzf/3FHgO+/+uO5+s9+ubuBWbQBAwMDAwMDAwMDAwMDAwMDAwMDAwM/PKwmFnueicc2DTYVq108ZZv3VasmrJVYZ8J2gecmDtM3gd3r5ooxnnxzMYEAAwPvE9Zzuzjvl7KrPw5oEh5lGrvlZJ0HqW6R72ULGfcEotGSI5dVs4iLc2sOPGtY4ghWcEbNLpURK2jCPhK2Sqzd7FDG7YllIBwjmXhPHGOc4+t9M7VhY3yrjAkEGBh4F/1Yz1OW9WP1ZhvSjr8WbZZzcjZi9erDUu05F3Nxnm1KdQScDSIagmpfLXoerT8JpNj78jBYE67FoqtfwT4a9v7kUYnlCpaRcG39kcM/+3Ce9athY8wEAgwMDPz/4fcJ9QZ8TJjfMTAwMDDwjfoA8ghgOAjt+lgAAAAASUVORK5CYII=";

const screenshot = `data:image/png;base64,${SCREENSHOT_PNG_BASE64}`;
const smallImage = `data:image/png;base64,${SMALL_IMAGE_PNG_BASE64}`;

/**
 * The overlay's own picture, which the latch waits for.
 *
 * The rig's press selector for these stories is the picture's production button
 * (`button[title^="Click to expand"]`, declared beside the tuples), anchored on
 * the title rather than a `data-` hook because the title is production markup a
 * reader can check.
 */
const EXPANDED_PICTURE = '[role="dialog"] img';

/**
 * Press the picture, then hold the shutter until the OVERLAY's copy has decoded.
 *
 * A frame budget rather than a clock, for `run-details.stories.tsx`'s reason: the
 * state arrives one paint after the press that causes it, and a fixed sleep is a
 * race. Only the overlay's own `<img>` releases it — the transcript's picture is
 * already decoded by then, so waiting on "any image" would release the shutter
 * before the overlay had painted at all. 600 frames is ten seconds and exhaustion
 * leaves the attribute set, which fails the run loudly.
 */
const useExpandedPictureLatch = () => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let frame = 0;
		let cancelled = false;
		const tick = () => {
			if (cancelled) return;
			const image = document.querySelector<HTMLImageElement>(EXPANDED_PICTURE);
			if (image?.complete && image.naturalWidth > 0) {
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
	}, []);
};

/**
 * The message view's shape: the agent's prose at reading weight, then the
 * attachment in the wrapper `message-item/index.tsx` gives it, in the shared
 * 900px column the contract caps agent output at.
 */
const Column = ({ children }: { children: ReactNode }) => (
	<div className="min-h-screen bg-canvas p-8">
		<div className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
			<p className="text-body text-ink">
				March is reconciled. Three invoices are still outstanding; the totals
				are in the table below.
			</p>
			<div className="mb-2 flex flex-col gap-2">{children}</div>
			<p className="text-body text-ink">
				Nothing else needs your attention today.
			</p>
		</div>
	</div>
);

/** The picture where the conversation puts it, untouched. */
const Thread = ({ src }: { src: string }) => (
	<Column>
		<ImageAttachment file={src} src={src} conversationId="image-expand" />
	</Column>
);

/**
 * The column at rest, plus the latch — and NO press.
 *
 * The press comes from the RIG (design round 2, D2-4): the tuples dispatch a real
 * pointer press at the picture's own centre, so the overlay opens through the path
 * a mouse user's click takes and the frame shows the state a mouse user actually
 * gets. This file used to press with `button.click()`, which Blink treats as
 * keyboard-ish for `:focus-visible`, so every overlay frame carried a focus ring
 * on the close button that no mouse user sees.
 *
 * What stays here is what the latch bought in round 1: the shutter is held until
 * the overlay's picture has DECODED, so a frame of an overlay whose picture merely
 * had not arrived yet cannot ship. A story cannot press like a user, but it is
 * still the right place to say when the state is ready to photograph.
 */
const PressableThread = ({ src }: { src: string }) => {
	useExpandedPictureLatch();
	return <Thread src={src} />;
};

/**
 * 1440x1014 — the viewport's own aspect to within 0.2% (1280x900 is 1.4222), so
 * the picture is fitted on BOTH axes at once and its top-right corner lands as
 * close to the close button as the geometry allows. Twelve flat bands rather than
 * a photograph for two reasons: the picture must not become the frame's dominant
 * colour (`check-evidence` reads that as "the story did not paint" — the same
 * constraint the wide fixture above is shaped by), and equal bands are what keeps
 * any single one of them under the scrim's own share of the frame. Real pixels,
 * no anti-aliasing, 3.9 KB.
 */
const NEAR_VIEWPORT_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAABaAAAAP2BAMAAADjiScrAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAnUExURZ48PJ5tPJ48np48bZ6ePG2ePDyePDyebTyenjxtnjw8nm08nv7+/gsvuucAAAABYktHRAyBs1FjAAAAB3RJTUUH6gkQExEMYg3VuAAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOS0xNlQxOToxNzoxMSswMDowMCcMJwUAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDktMTZUMTk6MTc6MTErMDA6MDBWUZ+5AAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA5LTE2VDE5OjE3OjExKzAwOjAwAUS+ZgAAABBjYU52AAAAeAAAA/YAAAAAAAAAAL0aiVYAAA4OSURBVHja7dLREIBAAEDBU0ghhRRSSCGFU0ghhRSSC+J9NbPLsGMES7AGW7AHR3AGM7iCO3iCNyifhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUWWmihhRZaaKGFFlpooYUW+lehPzDW11BDlY6mAAAAAElFTkSuQmCC";

/**
 * 828x1792 — a phone capture, the aspect `image-attachment.tsx`'s own sizing note
 * names as a real input. It exercises the other end of the fit: the height binds,
 * the picture is 368 wide in a 1280x900 viewport, and its corners are nowhere
 * near the button — the frame that says so, beside the near-viewport one that
 * says the opposite. 3.7 KB.
 */
const PORTRAIT_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAzwAAAcABAMAAADnL1sYAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAnUExURZ48PJ5tPJ48np48bZ6ePG2ePDyePDyebTyenjxtnjw8nm08nv7+/gsvuucAAAABYktHRAyBs1FjAAAAB3RJTUUH6gkQExEMYg3VuAAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOS0xNlQxOToxNzoxMiswMDowMBbkPZgAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDktMTZUMTk6MTc6MTIrMDA6MDBnuYUkAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA5LTE2VDE5OjE3OjEyKzAwOjAwMKyk+wAAABBjYU52AAAARQAABwAAAAAAAAAAABFIHm0AAAzrSURBVHja7dFREUBAAAXAE0EFIqjgIqhwF0EFIqhABOVEeN9mditsKdEwRlM0L9Ea1S1qUd+jIzqv6I6eN8o7evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49evTo0aNHjx49P+/5AESMdfA2y7LtAAAAAElFTkSuQmCC";

/**
 * A source no engine can decode: the base64 of the bytes "not-a-png".
 *
 * Deliberately not a path that 404s, because the failure this frame is about is
 * the decoder's, and a `data:` URI is the shape every canonical picture takes.
 * The browser raises `error` on it by itself — nothing in the story dispatches
 * anything, which is what makes this frame evidence rather than a re-render.
 */
const UNDECODABLE = "data:image/png;base64,bm90LWEtcG5n";

const nearViewport = `data:image/png;base64,${NEAR_VIEWPORT_PNG_BASE64}`;
const portrait = `data:image/png;base64,${PORTRAIT_PNG_BASE64}`;

/**
 * The legacy shape: a picture that names a PATH, so its file actions render
 * beside it, while painting from a `data:` URI the way this checkout's fixtures
 * do. `ImageAttachment` takes the two as separate props for exactly this reason,
 * and the file-actions wrapper's reveal is the one review R1-1 is about.
 */
const LEGACY_FILE = "/Users/damian/invoices/march-preview.png";

/**
 * Hold the shutter until the failure copy is on screen.
 *
 * `data-capture-pending` is the rig's own latch convention (see the header): the
 * capture waits on it and THROWS if it never clears, so this story asserts the
 * failure state rather than posing for it — a frame of the same overlay with a
 * picture that merely had not decoded yet would leave the attribute set and fail
 * the run.
 */
const useFailureLatch = () => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let frame = 0;
		let cancelled = false;
		const tick = () => {
			if (cancelled) return;
			const text = document.querySelector('[role="dialog"]')?.textContent ?? "";
			if (text.includes("could not be displayed")) {
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
	}, []);
};

/**
 * The overlay's failure state, mounted the way its own frame needs it.
 *
 * The other overlay stories arrive by PRESSING a picture, because the question
 * there is whether anything reaches the overlay. Here the question is what the
 * overlay draws when its picture cannot arrive, and no press can stage that on
 * purpose: the transcript's copy of a picture that failed is not a button at all
 * (it draws `BrokenAttachment` and nothing to press), so the state is reached by
 * a press that landed before the picture decoded, or by a source that died between
 * the press and the paint. Mounting `ImageLightbox` directly, with `open` and the
 * caller's own fallback, is that state with the noise removed.
 */
const FailedOverlay = () => {
	useFailureLatch();
	return (
		<div className="min-h-screen bg-canvas p-8">
			<ImageLightbox
				src={UNDECODABLE}
				label="Screenshot"
				open={true}
				onOpenChange={() => {}}
				fallback={
					<BrokenAttachment
						name="Screenshot"
						detail={ATTACHMENT_UNAVAILABLE_COPY}
					/>
				}
			/>
		</div>
	);
};

/** The legacy surface: the picture in the column, with its file actions hidden. */
const LegacyThread = () => (
	<Column>
		<ImageAttachment
			file={LEGACY_FILE}
			src={screenshot}
			conversationId="image-expand"
		/>
	</Column>
);

const meta: Meta = {
	title: "Chat/Image expand",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The state the click acts on. */
/*
 * The overlay stories below mount the row AT REST; the rig presses the picture.
 * Reading this file in Storybook therefore shows the picture, and the expanded
 * state is one click away — which is also the only way to see it as a mouse user
 * sees it (design round 2, D2-4).
 */
export const InThread: Story = {
	render: () => <Thread src={screenshot} />,
};

/** The overlay, reached by pressing the picture. */
export const Expanded: Story = {
	render: () => <PressableThread src={screenshot} />,
};

/** The size rule, on the smallest picture that can carry it. */
export const ExpandedSmallImage: Story = {
	render: () => <PressableThread src={smallImage} />,
};

/** The aspect band the close button's clearance depends on (design D1-3). */
export const ExpandedNearViewport: Story = {
	render: () => <PressableThread src={nearViewport} />,
};

/** The other end of the fit: a phone-aspect capture (QA Q-5). */
export const ExpandedPortrait: Story = {
	render: () => <PressableThread src={portrait} />,
};

/** The picture that never arrives, and what the overlay says instead. */
export const ExpandedFailed: Story = {
	render: () => <FailedOverlay />,
};

/**
 * A path-named picture at rest, with its file actions hidden.
 *
 * The rig drives this one story four ways (rest, pointer hover, keyboard focus,
 * keyboard activation) because the four frames are one surface in four states
 * rather than four surfaces — see the tuples in `scripts/capture-evidence.mjs`.
 */
export const Legacy: Story = {
	render: () => <LegacyThread />,
};
