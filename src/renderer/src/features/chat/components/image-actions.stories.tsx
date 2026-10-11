/**
 * The image actions menu, on every surface that draws a picture.
 *
 * The operator's ask of 2026-10-11 ("images on hover have controls ... open
 * file location, open file in OS, open in canvas, copy to clipboard") lands on
 * six surfaces, and this set is the half of the evidence pixels carry: the
 * durable picture the canonical transcript draws from a digest (the kind that
 * had NO menu at all before this change), the live one a turn carries inline, a
 * path-backed legacy attachment, the condensed strip's thumbnail, a markdown
 * image, and the canvas viewer's own chrome. The other half — the ACTIONS
 * really happening (clipboard, OS, canvas) — is the live pass the set's README
 * records; a still cannot carry a paste.
 *
 * WHAT EACH FIXTURE IS, because the menu's contents are the claim: the durable
 * states fetch their bytes over the media relay this file stubs (`sessions
 * .attachment` for one digest), so their pictures are real `blob:` URLs and
 * their menu is the two-entry set a digest-backed picture gets; the live state
 * is an inline `data:` payload; the legacy state is a path plus a painted
 * source, the shape `image-attachment.tsx` serves both spellings of; the strip
 * is `FoldMedia` over three durable digests; the markdown state is the real
 * `MarkdownRenderer` over an absolute-path image. Each wrapper carries a
 * `data-shot` stamp so the capture rig's hovers name a surface rather than a
 * coincidence of DOM order.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useEffect } from "react";
import { CanonicalImage } from "../canonical/canonical-image";
import { FoldMedia } from "../canonical/fold-media";
import type { TranscriptImage } from "../canonical/transcript-reducer";
import { ImagePreview } from "./canvas/image-preview";
import { MarkdownRenderer } from "./markdown-renderer";
import { ImageAttachment } from "./message-item/image-attachment";

/* A real 360x240 PNG and a 200x360 portrait: the same bytes the trace-fold and
   media-slot sets carry, inlined so a frame needs no asset loader. */
const SHOT_LANDSCAPE_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAAC/0lEQVR42u3UsQnAIBRFUacJVs6RgTKLjbUOaRo3CPwiksCBM8HjcdORC0BIMgEgHIBwAMIBCAcgHADCAQgHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcwAfCUVsHCBEOQDiADeGY8wYIEQ5AOADhAIQDEA5AOACEAxAOQDgA4QCEA0A4AOEAhAMQDkA4AIQDEA5AOADhAIQDEA4rAMIBCAcgHIBwAMIB8KdwnNcAngmHcIBwCAcIh3CAcAgHCIdwgHAIh3CAcAgHCIdwgHAIBwiHcIBwCAcgHMIBwiEcIBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcIBwCIdwgHAIBwiHcIBwCAcIh3CAcAiHT4BwCAcIh3CAcAgHCIdwgHAIByAcwgHCIRwgHMIBwiEcIBzCAQiHcIBwCAcIh3CAcAgHCIdwgHAIh3CAcAgHCIdwgHAIBwiHcIBwCAcgHMIBwiEcIBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcADCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIhHCAcwgHCIRwgHMIBCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAIBwiHcIBwCAcIh3AIBwiHcIBwCAcIh3CAcAgHCIdwAMIhHCAcwgHCIRwgHMIBwiEcgHAIBwiHcIBwCAcIh3CAcAgHCIdwCAcIh3CAcAgHCIdwgHAIBwiHcAgHCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIByAcgHAAwgEgHIBwAMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcADCASAcwCsWE+1fusL0MMsAAAAASUVORK5CYII=";
const SHOT_PORTRAIT_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAMgAAAFoCAIAAACdUSOTAAADD0lEQVR42u3SsQ2AIBRFUaYxVszhNIxjYy1DfhpXoPgJkpzkTvDeKcdZpfSKCQSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYGk1rPt5pfTAEljaCFbEkNIDS2AJLIFlBYElsASWBJbAElgSWAJLYElgCSyBJYElsASWBJbAElgSWAJLYElgCSyBJYElsASWBJbAElgSWAJLYElgCSyBJYElsATWVL1d2jewBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwPINWGAJLIElsMASWAJLYIElsASWwAJLYAksgQWWwBJYAgssgSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAElnvAAktgCSyBBZbAElgCCyyBJbAEFlgCS2AJLLAElsASWGCBBZbAElhggQWWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElsAygcASWAJLAktgCSwJLIElsCSwBJbAksASWAJLAktgCSwJLP20D2a4hLjaytrlAAAAAElFTkSuQmCC";
const SHOT = `data:image/png;base64,${SHOT_LANDSCAPE_B64}`;

/** The one digest the relay answers, as a durable artifact carries it. */
const DURABLE_DIGEST = "b7d1c2e3f4a5968778695a4b3c2d1e0f";
const STRIP_DIGESTS = [
	"11d4c5e6f7a8b9c0d1e2f3a4b5c6d7e8",
	"22d4c5e6f7a8b9c0d1e2f3a4b5c6d7e8",
	"33d4c5e6f7a8b9c0d1e2f3a4b5c6d7e8",
];

const durableImage: TranscriptImage = {
	id: "image-actions:durable",
	data: null,
	attachment: DURABLE_DIGEST,
	mimeType: "image/png",
	width: 360,
	height: 240,
};

const stripImage = (digest: string, index: number): TranscriptImage => ({
	id: `image-actions:strip:${index}`,
	data: null,
	attachment: digest,
	mimeType: "image/png",
	width: 360,
	height: 240,
});

/**
 * Answer the durable digests' fetches out of the story, the `installVideoRelay`
 * pattern one section over: a Storybook frame has no backend, so a digest can
 * only paint if the renderer's own seam — `desktopMedia` — is answered. ONLY
 * the digests this file declares are answered; anything else gets a 404, so a
 * scope or op regression paints the unavailable note rather than borrowing
 * bytes from a stub that answered everything. Installed during the decorator's
 * RENDER, not an effect: React runs a child's effects before its parent's, so
 * an effect here would land after the reader's own fetch had gone out.
 */
const installImageRelay = (digests: readonly string[]) => {
	/*
	 * One digest answers with the PORTRAIT bytes on purpose: the strip is where
	 * two aspects sit side by side (the media-slot set's own lesson — a column of
	 * same-shaped tiles cannot show what a letterboxed tile costs), and the
	 * portrait is a real fixture rather than a scaled copy.
	 */
	const bytesFor = (digest: string | undefined) =>
		Uint8Array.from(
			atob(
				digest === STRIP_DIGESTS[1] ? SHOT_PORTRAIT_B64 : SHOT_LANDSCAPE_B64,
			),
			(character) => character.charCodeAt(0),
		);
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.desktop = {
		...api.desktop,
		media: async (request: { op?: string; digest?: string }) =>
			request.op === "sessions.attachment" &&
			request.digest !== undefined &&
			digests.includes(request.digest)
				? {
						status: 200,
						kind: "bytes",
						mimeType: "image/png",
						data: bytesFor(request.digest),
					}
				: { status: 404, kind: "error", detail: "Not in this story." },
	};
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	(window as any).api = api;
};

/** The read door the canvas viewer uses, answered with the same real PNG. */
const installFileBytes = () => {
	const bytes = Uint8Array.from(atob(SHOT_LANDSCAPE_B64), (character) =>
		character.charCodeAt(0),
	);
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.readFileBytes = async () => ({
		success: true,
		data: bytes,
		sizeBytes: bytes.byteLength,
	});
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	(window as any).api = api;
};

/**
 * Hold the shutter until every blob-backed picture has decoded: the same
 * protocol as `useWaitForPaintedImage` (a `blob:` `<img>` that is `complete`
 * with a non-zero natural width), but ALL of them — the strip paints three, and
 * a frame that released after the first would photograph two reserved boxes.
 */
const useWaitForPaintedImages = () => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		const poll = window.setInterval(() => {
			const images = [
				...document.querySelectorAll<HTMLImageElement>("img"),
			].filter((element) => element.src.startsWith("blob:"));
			if (
				images.length === 0 ||
				images.some(
					(element) => !element.complete || element.naturalWidth === 0,
				)
			) {
				return;
			}
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		}, 40);
		return () => {
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, []);
};

const meta: Meta = {
	title: "Chat/Image actions",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const Sheet = ({ stamp, children }: { stamp: string; children: ReactNode }) => (
	<div data-shot={stamp} className="max-w-[760px] p-8">
		<p className="mb-2 text-body-sm text-ink-muted">
			Ran the suite, fixed the two failures, and pushed the branch.
		</p>
		{children}
	</div>
);

/** The durable picture: a digest over the relay, the menu this change adds. */
export const CanonicalDurable: Story = {
	decorators: [
		(Story) => {
			installImageRelay([DURABLE_DIGEST]);
			useWaitForPaintedImages();
			return <Story />;
		},
	],
	render: () => (
		<Sheet stamp="durable">
			<CanonicalImage
				image={durableImage}
				scope={{ sessionId: "image-actions", childId: null }}
				label="Generated image"
			/>
		</Sheet>
	),
};

/** The live picture: an inline payload, the shape a fresh turn carries. */
export const CanonicalLive: Story = {
	render: () => (
		<Sheet stamp="live">
			<CanonicalImage
				image={{
					id: "image-actions:live",
					data: SHOT_LANDSCAPE_B64,
					attachment: null,
					mimeType: "image/png",
				}}
				scope={{ sessionId: "image-actions", childId: null }}
				label="Attached image"
			/>
		</Sheet>
	),
};

/** A path-backed attachment: the file-shaped set, on the file spelling. */
export const Legacy: Story = {
	render: () => (
		<Sheet stamp="legacy">
			<ImageAttachment
				file="/Users/example/workspace/opoint/plots/march-preview.png"
				src={SHOT}
				conversationId="image-actions"
			/>
		</Sheet>
	),
};

/** The condensed strip: durable thumbnails inside a folded run. */
export const Thumbnail: Story = {
	decorators: [
		(Story) => {
			installImageRelay(STRIP_DIGESTS);
			useWaitForPaintedImages();
			return <Story />;
		},
	],
	render: () => (
		<Sheet stamp="thumbnail">
			<FoldMedia
				images={STRIP_DIGESTS.map((digest, index) => stripImage(digest, index))}
				scope={{ sessionId: "image-actions", childId: null }}
				onRevealMore={() => {}}
			/>
		</Sheet>
	),
};

/** A markdown image: the path an agent writes into prose. */
export const Markdown: Story = {
	render: () => (
		<Sheet stamp="markdown">
			<MarkdownRenderer
				content={
					"The capture:\n\n![dashboard render](/Users/example/workspace/dashboards/march-render.png)\n\nFixed and pushed."
				}
			/>
		</Sheet>
	),
};

/** The canvas viewer's chrome: the document half of the same actions. */
export const CanvasViewer: Story = {
	decorators: [
		(Story) => {
			installFileBytes();
			useWaitForPaintedImages();
			return <Story />;
		},
	],
	render: () => (
		<div data-shot="canvas" style={{ width: 760, height: 420 }}>
			<ImagePreview
				document={{
					id: "/Users/example/workspace/dashboards/march-render.png",
					title: "march-render.png",
					path: "/Users/example/workspace/dashboards/march-render.png",
					content: "",
					type: "image",
				}}
			/>
		</div>
	),
};
