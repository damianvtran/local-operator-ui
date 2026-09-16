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
 * here, which is the fact the empty space would have hidden." It carries
 * `ATTACHMENT_UNAVAILABLE_COPY` rather than that component's default sentence:
 * a canonical image is a digest in the app's own store, not a path on disk, so
 * the moved/renamed/deleted cause is one this row cannot know — see the copy's
 * own comment in `attachment-frame.tsx`.
 *
 * Sizing follows the TUI's ledger rule — one shared height ceiling with the
 * width following each image's own aspect — so a column of mixed screenshots
 * reads as rows rather than as a scrapbook. The ceiling is `ImageAttachment`'s
 * existing `max-h-[240px] object-contain`, taken as-is rather than re-derived
 * from the TUI's 18 rows x 16px = 288px: consistency with the legacy view beside
 * it is worth more than matching a number from a surface with different cells.
 */

import { cn } from "@shared/lib/utils";
import {
	ATTACHMENT_UNAVAILABLE_COPY,
	BrokenAttachment,
} from "../components/message-item/attachment-frame";
import { ImageAttachment } from "../components/message-item/image-attachment";
import type { TranscriptImage } from "./transcript-reducer";
import { type AttachmentScope, useAttachmentUrl } from "./use-attachment-url";

export type CanonicalImageProps = {
	image: TranscriptImage;
	/**
	 * The conversation the row was read from, as `{ sessionId, childId }`.
	 *
	 * The scope rather than a bare session id because the bytes live behind a
	 * route scoped to the transcript that references them, and a child's page is
	 * a conversation of its own — the parent's route refuses a child's digests
	 * (`use-attachment-url.ts`'s `AttachmentScope`).
	 */
	scope: AttachmentScope | null;
	/**
	 * What to call this attachment when it cannot be shown. The row above
	 * already names the action, so this is a position rather than a filename —
	 * a canonical image has no filename to give.
	 */
	label: string;
};

export const CanonicalImage = ({
	image,
	scope,
	label,
}: CanonicalImageProps) => {
	const src = useAttachmentUrl(image, scope);
	if (!src) {
		return (
			<BrokenAttachment name={label} detail={ATTACHMENT_UNAVAILABLE_COPY} />
		);
	}
	return (
		<div className={cn("inline-block max-w-full")}>
			<ImageAttachment
				// `file` is what the component names the attachment and what its
				// file-actions menu would act on. Neither shape a canonical image can
				// take is a path: `data:` and `blob:` both fail `isLocalFile`, so the
				// menu never appears and there is nothing on disk to reveal. The
				// `blob:` half of that guard exists because THIS caller needed it —
				// every durable image is a blob, and the guard originally covered
				// only `data:`, so the menu did appear and offered to show a blob
				// handle in Finder.
				file={src}
				src={src}
				// A canonical image has no on-disk path, so there is nothing here for a
				// click to open — which is why the click once did NOTHING at all on this
				// surface, the operator's own report. It expands now, and that behaviour
				// lives inside `ImageAttachment` rather than being passed in, so this
				// caller (and every future one) gets it without asking.
				//
				// `label` is also what the picture is CALLED. Left to derive itself
				// from the URL it would be the blob's UUID, which is what a screen
				// reader announced. It is also the expanded overlay's own name.
				label={label}
				conversationId={scope?.sessionId ?? ""}
			/>
		</div>
	);
};
