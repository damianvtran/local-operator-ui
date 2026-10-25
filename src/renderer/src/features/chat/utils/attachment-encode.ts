/**
 * Composer attachments -> the wire's two halves.
 *
 * LIFTED FROM `chat-page.tsx` UNCHANGED when the mini restyle needed the same
 * encoding: the mini view consumes the shared composer, whose attach button and
 * paste path produce the same `attachments` list the chat's send receives, and a
 * second copy of this pipeline beside the first is how the two surfaces would
 * come to accept different files or bound them differently. The chat's send
 * imports `encodeAttachments` from here now; the mini's send calls it directly.
 *
 * TWO CARRIAGES, BECAUSE THE WIRE HAS TWO (attachment contract v1 §1.2/§1.3):
 * an image small enough for the inline body rides `sessionImage`, bounded
 * exactly as it always was; any other file is uploaded to the daemon's
 * attachment store and rides as a `{digest, name, mime_type, bytes, path}`
 * reference. The old pipeline admitted only the four image types and skipped
 * every other file in silence - the defect behind a PDF chip that reached
 * nobody (§Problem). A file this send cannot read or upload is now REPORTED and
 * the send refuses before admission, naming it, exactly as an unreadable image
 * already did.
 */

import {
	type AttachmentUploadSource,
	DESKTOP_MESSAGE_MAX_FILES,
} from "../../../../../shared/attachment-upload";
import {
	DESKTOP_MESSAGE_BUDGET_BYTES,
	DESKTOP_MESSAGE_MAX_IMAGES,
} from "../../../../../shared/desktop-contract";
import { boundImagesForBudget } from "./bound-image";
import type { WireImage } from "./bound-image";
import { getFileName } from "./get-file-name";
import { messageBodyBytes } from "./message-budget";

const IMAGE_DATA_URL = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/;
const FILE_SCHEME = /^file:\/\//;

/**
 * One file the send could not carry, in the terms its refusal sentence needs.
 *
 * `kind` decides the sentence: a `read` failure is the old "may have been moved
 * or deleted"; an `upload` failure carries the daemon's own reason; `remote` is
 * the contract's v1 limit - a document cannot be attached to a conversation
 * another device owns, because the upload landed in THIS machine's store.
 */
export type StagedAttachmentFailure = {
	name: string;
	kind: "read" | "upload" | "remote";
	/** The daemon's sentence for an upload refusal; never shown for `read`. */
	detail?: string;
};

/** Which extensions map to which mime, for the four image types the runtime
 * accepts (`CanonicalContentBlock`'s encoder). */
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

/** The path a `file://` attachment names, with no scheme left on it. */
const pathOf = (attachment: string): string =>
	attachment.replace(FILE_SCHEME, "");

/**
 * Encode a composer's staged attachments for one send.
 *
 * `remoteOwned` is the contract's v1 refusal (§6b.2): the upload lands in this
 * machine's store, so a conversation whose owner is another device cannot
 * resolve the digest. Images keep today's peer staging and are still encoded;
 * only files are refused, by name, before anything is uploaded.
 *
 * The image budget is the SAME one as before - 880,000 bytes under the
 * backend's 900,000-byte control frame, images bounded client-side to the 1024px
 * long edge (`bound-image.ts` cites the constants). File REFERENCES are bounded
 * by count and by the wire schema's own caps, not by that image budget: a
 * reference is a digest and a path, not bytes, so `messageBodyBytes` is not the
 * place they are weighed.
 */
export async function encodeAttachments(
	attachments: string[],
	text: string,
	options?: { remoteOwned?: boolean },
) {
	const images: WireImage[] = [];
	const files: {
		digest: string;
		name?: string;
		mime_type?: string;
		bytes?: number;
		path?: string;
	}[] = [];
	const failures: StagedAttachmentFailure[] = [];
	/*
	 * THE COUNT BEFORE THE COPIES. A draft with ten staged files must not upload
	 * ten files (up to 32 MB each) and then refuse because eight is the cap: the
	 * refusal is already decided by the staged list, so the upload loop is not
	 * allowed to run for a send that cannot be admitted. Classifying here is the
	 * same rule the loop applies below - a data-URL image or an image extension
	 * stays inline, everything else is a file.
	 */
	const stagedFiles = attachments.filter((attachment) => {
		if (IMAGE_DATA_URL.test(attachment)) return false;
		const ext = attachment.split(".").pop()?.toLowerCase() ?? "";
		return !IMAGE_MIME_BY_EXT[ext];
	});
	const fileOverflow = Math.max(
		0,
		stagedFiles.length - DESKTOP_MESSAGE_MAX_FILES,
	);
	const uploadFiles = fileOverflow === 0;
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
		if (mime) {
			/*
			 * A renderer with no `window.api.readFile` bridge cannot read any file at
			 * all, which is a fact about the context rather than about this
			 * attachment - but it is still a file the composer showed and the send
			 * would omit, so it is now reported instead of skipped (`attachment-read.ts`
			 * states both old skips where the sentence is built).
			 */
			if (!window.api?.readFile) {
				failures.push({ name: getFileName(attachment), kind: "read" });
				continue;
			}
			const read = await window.api.readFile(pathOf(attachment), "base64");
			if (read.success)
				images.push({
					data_b64: read.data,
					mime_type: mime,
					...(attachment.startsWith("data:")
						? {}
						: { origin_path: pathOf(attachment) }),
				});
			else failures.push({ name: getFileName(attachment), kind: "read" });
			continue;
		}

		const name = getFileName(attachment);
		if (options?.remoteOwned) {
			failures.push({ name, kind: "remote" });
			continue;
		}
		if (!uploadFiles) continue;
		const upload = window.api?.uploadAttachment;
		if (!upload) {
			failures.push({
				name,
				kind: "upload",
				detail: "this window cannot upload files",
			});
			continue;
		}
		const source: AttachmentUploadSource = attachment.startsWith("data:")
			? { kind: "dataUrl", dataUrl: attachment, name }
			: { kind: "path", path: pathOf(attachment), name };
		const result = await upload(source);
		if (!result.success) {
			// The daemon's own sentence is the detail - an oversize refusal names the
			// size, an unreachable daemon says so - rather than this layer guessing
			// a cause it does not know.
			failures.push({ name, kind: "upload", detail: result.error });
			continue;
		}
		const stored = result.attachment;
		files.push({
			digest: stored.digest,
			name: stored.name ?? name,
			mime_type: stored.mime_type,
			bytes: stored.bytes,
			...(stored.path ? { path: stored.path } : {}),
		});
	}
	/*
	 * More images than the wire carries are REPORTED, not silently dropped: the
	 * count the slice below leaves behind travels out as `overflow` so every
	 * send can refuse before admission with a sentence that names it
	 * (`imageOverflowRefusal`) - the same reason `failures` is a list rather
	 * than a silent skip one arm up (design round 1 on issue #790, D1). The
	 * slice still bounds the body to the schema for a caller that forgets to
	 * read the report.
	 */
	const overflow = Math.max(0, images.length - DESKTOP_MESSAGE_MAX_IMAGES);
	// `fileOverflow` is the pre-upload count above: a refused draft never
	// uploaded, so deriving it again from `files` would always read zero.
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
		files: files.slice(0, DESKTOP_MESSAGE_MAX_FILES),
		failures,
		overflow,
		fileOverflow,
	};
}
