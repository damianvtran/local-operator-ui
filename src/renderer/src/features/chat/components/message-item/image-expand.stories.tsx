/**
 * The conversation picture, expanded: the state the operator asked for.
 *
 * The report was a screenshot in a transcript that could not be read at the size
 * the transcript gives it, and a click on a canonical row that did nothing at
 * all. Three frames carry the answer, and each answers a different question:
 *
 * - `in-thread` is the state the click acts on — the picture as the message view
 *   draws it, at `max-h-[240px]`, with its new "Click to expand" title.
 * - `expanded` is the overlay: the picture fitted to the viewport, on the theme's
 *   own scrim, with the app still visible behind it.
 * - `expanded-small-image` is the size rule. `max-w`/`max-h` and no width means a
 *   24x18 PNG stays 24x18 rather than being blown up 40x into a blur, and this is
 *   the frame that says so; the design round owns the call, not this file.
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

import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useEffect } from "react";
import "../../../../styles/index.css";
import { ImageAttachment } from "./image-attachment";

/**
 * An invoice view, 960x600, as a screenshot in a conversation would be.
 *
 * Real bytes rather than a flat swatch, so a reader can tell "the picture
 * rendered" from "the box rendered" — the failure `run-details.stories.tsx`
 * names for the same reason. 12 colours and no anti-aliasing keep the literal
 * small enough to sit in a source file (3.8 KB).
 */
const SCREENSHOT_PNG_BASE64 =
	"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";

/** 24x18. The frame that would be a 90vw blur under a fit-to-viewport rule. */
const SMALL_IMAGE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAABgAAAASAQMAAAB7IozdAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURU98/////7nwLFsAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gkQERwiCPFyVAAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOS0xNlQxNzoyODozNCswMDowMKUePuMAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDktMTZUMTc6Mjg6MzQrMDA6MDDUQ4ZfAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA5LTE2VDE3OjI4OjM0KzAwOjAwg1angAAAABJJREFUCNdjYMABmP8/wImxAAC6aA0v9s+QOQAAAABJRU5ErkJggg==";

const screenshot = `data:image/png;base64,${SCREENSHOT_PNG_BASE64}`;
const smallImage = `data:image/png;base64,${SMALL_IMAGE_PNG_BASE64}`;

/**
 * The picture's own button, which is the only control that opens the overlay.
 *
 * Anchored on the title rather than a `data-` hook: the title is production
 * markup this change introduces and a reader can check it, and a rig that cannot
 * find it leaves `data-capture-pending` set and makes the capture throw instead
 * of photographing whatever happened to be on screen.
 */
const PICTURE = 'button[title^="Click to expand"]';
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
const usePressToExpand = () => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let frame = 0;
		let pressed = false;
		let cancelled = false;
		const tick = () => {
			if (cancelled) return;
			const button = document.querySelector<HTMLButtonElement>(PICTURE);
			if (button && !pressed) {
				pressed = true;
				button.click();
			}
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

/** The same column, with the picture pressed once on mount. */
const PressedThread = ({ src }: { src: string }) => {
	usePressToExpand();
	return <Thread src={src} />;
};

const meta: Meta = {
	title: "Chat/Image expand",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The state the click acts on. */
export const InThread: Story = {
	render: () => <Thread src={screenshot} />,
};

/** The overlay, reached by pressing the picture. */
export const Expanded: Story = {
	render: () => <PressedThread src={screenshot} />,
};

/** The size rule, on the smallest picture that can carry it. */
export const ExpandedSmallImage: Story = {
	render: () => <PressedThread src={smallImage} />,
};
