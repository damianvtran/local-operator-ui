/**
 * The composer's file-upload half of the attachment contract (v1 §1.1).
 *
 * WHY THIS IS NOT AN OP ON THE DESKTOP PLANE. A `files` reference is small and
 * JSON, but the BYTES are not: the plane's request budget is 900 kB and one
 * page of a scanned PDF exceeds it. So the bytes travel over the route the
 * contract reserves for them - `POST /v1/desktop/attachments`, multipart - and
 * only the resulting digest rides `sessions.message`. This module is the shape
 * both halves of that boundary share: the main process produces it, the
 * renderer reads it, and neither invents a second error vocabulary.
 */

/**
 * Longest file this app will upload, in bytes.
 *
 * The contract pins 32 MB because that is Anthropic's request ceiling - the
 * tightest native document limit across the providers the harness serves. A
 * file this app accepted and the provider then refused would be a send that
 * fails after the composer has already retired the chip, which is the shape
 * the refusal messages exist to prevent.
 */
export const MAX_ATTACHMENT_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * Most files one message carries (`Prompt.files`, max_length=8).
 *
 * Exported beside the image cap so the renderer's pre-flight and the wire
 * schema read the same number; a draft that staged more is refused by name
 * rather than sliced, for the reason `DESKTOP_MESSAGE_MAX_IMAGES` records.
 */
export const DESKTOP_MESSAGE_MAX_FILES = 8;

/**
 * A file on disk, or a pasted file that never had a path.
 *
 * The composer stores a real path for everything the attach button or a drag
 * from Finder adds; a `File` constructed in another page (or a clipboard blob)
 * has no path, and the drag/paste path keeps its bytes as a `data:` URL. Both
 * must upload, or a file the composer showed would be refused for a reason that
 * is not about the user's file. `origin_path` is sent only for the path form,
 * because that is the only form that has one.
 */
export type AttachmentUploadSource =
	| { kind: "path"; path: string; name?: string }
	| { kind: "dataUrl"; dataUrl: string; name: string };

/** One stored attachment, as the upload route answers it (v1 §1.1). */
export type UploadedAttachment = {
	/** Lowercase hex content address in the daemon's attachment store. */
	digest: string;
	/** The name the user's file had; display only, never a path. */
	name: string | null;
	/** Decided by CONTENT on the daemon, never by the client's claim. */
	mime_type: string;
	bytes: number;
	/** The origin absolute path this client uploaded from. */
	path: string | null;
	/** Where the daemon's retained copy lives. */
	stored_path: string | null;
};

/**
 * Why an upload did not produce an attachment.
 *
 * A discriminant rather than a thrown Error, for the reason every other
 * preload-shaped result in this app gives: structured clone strips a custom
 * Error's prototype, so the renderer would receive an object whose `message`
 * it cannot tell from any other failure. `unreadable` covers both a path that
 * moved and one this process may not read; `refused` is the daemon's own
 * answer (an empty file, an oversize one, a rejected upload) and carries its
 * sentence; `unreachable` means no HTTP answer at all.
 */
export type AttachmentUploadFailureCode =
	| "unreadable"
	| "not-found"
	| "not-a-file"
	| "too-large"
	| "refused"
	| "unreachable";

export type AttachmentUploadResult =
	| { success: true; attachment: UploadedAttachment }
	| {
			success: false;
			code: AttachmentUploadFailureCode;
			error: string;
			/** The file's size when the refusal is about it being too large. */
			sizeBytes?: number;
	  };
