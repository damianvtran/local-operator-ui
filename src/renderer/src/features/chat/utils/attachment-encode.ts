/**
 * Composer attachments -> the wire's image half.
 *
 * LIFTED FROM `chat-page.tsx` UNCHANGED when the mini restyle needed the same
 * encoding: the mini view consumes the shared composer, whose attach button and
 * paste path produce the same `attachments` list the chat's send receives, and a
 * second copy of this pipeline beside the first is how the two surfaces would
 * come to accept different files or bound them differently. The chat's send
 * imports `encodeImageAttachments` from here now; the mini's send calls it
 * directly.
 */

import {
	DESKTOP_MESSAGE_BUDGET_BYTES,
	DESKTOP_MESSAGE_MAX_IMAGES,
} from "../../../../../shared/desktop-contract";
import { boundImagesForBudget } from "./bound-image";
import type { WireImage } from "./bound-image";
import { messageBodyBytes } from "./message-budget";

const IMAGE_DATA_URL = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/;
const FILE_SCHEME = /^file:\/\//;

/**
 * Which extensions map to which mime, for the four image types the runtime
 * accepts (`CanonicalContentBlock`'s encoder). Anything else is left out of the
 * body by design, for every send - see the unreadable list's note below for the
 * two skips this is NOT allowed to report.
 */
export const IMAGE_MIME_BY_EXT: Record<
	string,
	"image/png" | "image/jpeg" | "image/gif" | "image/webp"
> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

/**
 * Canonical admission carries images inline as `{data_b64, mime_type}`. The
 * composer holds attachments as paths or data URLs; only image types the
 * runtime accepts are encoded, anything else is left out rather than refused.
 *
 * The JSON transport budget for a message is 880,000 bytes - headroom under
 * the backend's real 900,000-byte control-frame limit, enforced by
 * `Prompt.nonempty` at
 * `local_operator/server/routes/desktop_sessions.py:101`. The earlier note
 * here claimed 256 KiB "see the backend contract", which the backend contract
 * contradicted: that number was an arbitrary transport literal 3.4x stricter
 * than what the server accepts, and one Retina screenshot exceeded it.
 *
 * Images are bounded CLIENT-SIDE before encoding, to the same 1024px long edge
 * the TUI applies (`bound-image.ts` cites the constants). Raising the budget
 * alone would not have been enough: unbounded screenshots are ~8.5 MB each, so
 * none of them fit at any budget this transport can offer.
 */
export async function encodeImageAttachments(
	attachments: string[],
	text: string,
) {
	const images: WireImage[] = [];
	/*
	 * The paths this send identified as images but could NOT read.
	 *
	 * Returned rather than dropped, because a dropped one is a file the user
	 * believes is in the message and is not - and on a draft restored from a
	 * refusal that file is one they already sent once. The send refuses before
	 * admission on a non-empty list (`unreadableAttachmentRefusal`), where the
	 * chip is still removable (code review round 8, MINOR-1).
	 */
	const unreadable: string[] = [];
	for (const attachment of attachments) {
		const dataUrl = IMAGE_DATA_URL.exec(attachment);
		if (dataUrl) {
			images.push({
				data_b64: dataUrl[3],
				mime_type: dataUrl[1] as (typeof IMAGE_MIME_BY_EXT)[string],
			});
			continue;
		}
		const ext = attachment.split(".").pop()?.toLowerCase() ?? "";
		const mime = IMAGE_MIME_BY_EXT[ext];
		// Two skips that are NOT this send's failure, so neither is reported here: a
		// path that is not one of the four image types the runtime accepts is left
		// out of the body by design, for every send; and a renderer with no
		// `window.api.readFile` bridge cannot read any file at all, which is a fact
		// about the context rather than about this attachment (`attachment-read.ts`
		// states both limits where the sentence is built).
		if (!mime || !window.api?.readFile) continue;
		const read = await window.api.readFile(
			attachment.replace(FILE_SCHEME, ""),
			"base64",
		);
		if (read.success) images.push({ data_b64: read.data, mime_type: mime });
		else unreadable.push(attachment);
	}
	/*
	 * More images than the wire carries are REPORTED, not silently dropped: the
	 * count the slice below leaves behind travels out as `overflow` so every
	 * send can refuse before admission with a sentence that names it
	 * (`imageOverflowRefusal`) - the same reason `unreadable` is a list rather
	 * than a silent skip one arm up (design round 1 on issue #790, D1). The
	 * slice still bounds the body to the schema for a caller that forgets to
	 * read the report.
	 */
	const overflow = Math.max(0, images.length - DESKTOP_MESSAGE_MAX_IMAGES);
	// Bound per image first, then check the TOTAL and step the whole set down
	// until the message fits. Several individually legal screenshots that do not
	// collectively fit is the common case, and it is not visible to a per-image
	// rule.
	return {
		images: await boundImagesForBudget(
			images.slice(0, DESKTOP_MESSAGE_MAX_IMAGES),
			DESKTOP_MESSAGE_BUDGET_BYTES,
			(candidate) => messageBodyBytes(text, candidate),
		),
		unreadable,
		overflow,
	};
}
