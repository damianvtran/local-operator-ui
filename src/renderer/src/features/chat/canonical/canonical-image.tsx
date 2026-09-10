/**
 * One image on a canonical transcript row.
 *
 * A thin wrapper, deliberately: `ImageAttachment` already draws every state an
 * attachment can be in — reserved box, `opacity-0` until decode, no spinner,
 * `BrokenAttachment` with a named failure — and a second image component beside
 * an established one is the defect docs/branding.md § 9 opens with. All this
 * adds is where the `src` comes from, which is the only thing that differs
 * between a legacy message (a file path on disk) and a canonical one (base64 on
 * the wire, or a digest in the attachment store).
 *
 * The unavailable state is `BrokenAttachment` rather than an empty gap, and
 * that is the same argument the TUI makes for its own `▨ image unavailable`
 * receipt (`tui/widgets/image_block.py:24-29`): "the reader learns an image WAS
 * here, which is the fact the empty space would have hidden."
 *
 * Sizing follows the TUI's ledger rule — one shared height ceiling with the
 * width following each image's own aspect — so a column of mixed screenshots
 * reads as rows rather than as a scrapbook. The ceiling is `ImageAttachment`'s
 * existing `max-h-[240px] object-contain`, taken as-is rather than re-derived
 * from the TUI's 18 rows x 16px = 288px: consistency with the legacy view beside
 * it is worth more than matching a number from a surface with different cells.
 */

import { cn } from "@shared/lib/utils";
import { BrokenAttachment } from "../components/message-item/attachment-frame";
import { ImageAttachment } from "../components/message-item/image-attachment";
import type { TranscriptImage } from "./transcript-reducer";
import { useAttachmentUrl } from "./use-attachment-url";

export type CanonicalImageProps = {
	image: TranscriptImage;
	sessionId: string | null;
	/**
	 * What to call this attachment when it cannot be shown. The row above
	 * already names the action, so this is a position rather than a filename —
	 * a canonical image has no filename to give.
	 */
	label: string;
};

export const CanonicalImage = ({
	image,
	sessionId,
	label,
}: CanonicalImageProps) => {
	const src = useAttachmentUrl(image, sessionId);
	if (!src) return <BrokenAttachment name={label} />;
	return (
		<div className={cn("inline-block max-w-full")}>
			<ImageAttachment
				// `file` is what the component names the attachment and what its
				// file-actions menu would act on. A `data:`/blob URL fails its
				// `isLocalFile` guard, so the menu correctly never appears: there is
				// no file on disk for it to reveal.
				file={src}
				src={src}
				// Canonical images have no on-disk path, so there is nothing for a
				// click to open. The affordance is left inert rather than wired to a
				// no-op that would look broken.
				onClick={() => undefined}
				conversationId={sessionId ?? ""}
			/>
		</div>
	);
};
