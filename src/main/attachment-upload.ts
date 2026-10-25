/**
 * The composer's upload transport: one file, bounded, to the daemon's
 * attachment route (attachment contract v1 §1.1).
 *
 * WHY THIS LIVES IN MAIN. The renderer has no `fs` and no raw `fetch` worth
 * trusting for a 32 MB body: the bytes would have to be base64'd through IPC
 * (a third again the size), held as a string in the renderer, and posted from a
 * context whose only other network door is the desktop op plane. Main already
 * reads files for the viewers (`read-file-bytes`) and already holds the
 * daemon's URL and bearer token (`backendService`), so the upload reuses both
 * and the renderer receives a small JSON record.
 *
 * THE ONE THING THIS MODULE MUST NOT DO is succeed quietly on a bad answer.
 * The send is refused before admission when any staged file fails, so every
 * path out of here is either a validated `UploadedAttachment` or a typed
 * failure carrying a sentence the composer can show. A response missing a
 * digest or a size is a failure, not a record with holes.
 */

import { readFileSync, statSync } from "node:fs";
import {
	type AttachmentUploadResult,
	type AttachmentUploadSource,
	MAX_ATTACHMENT_UPLOAD_BYTES,
	type UploadedAttachment,
} from "../shared/attachment-upload";

/**
 * How long one upload may take before this process gives up.
 *
 * Sized to the payload rather than to the control plane's per-op deadline: 32
 * MB over a slow link is minutes, and an abort here is a file the user was told
 * could be attached. The daemon's own read timeout is the real bound on the
 * other side; this only stops a wedged socket from holding the composer's
 * refusal forever.
 */
const UPLOAD_DEADLINE_MS = 5 * 60_000;

/** 32 lowercase hex: the attachment store's content address. */
const DIGEST_SHAPE = /^[0-9a-f]{32}$/;

/** Both separators a path may use; the basename is the last segment. */
const PATH_SEPARATOR = /[/\\]/;

type UploadAttachmentInput = {
	/**
	 * The bytes' source. A path is resolved by the caller (main/index owns that
	 * rule); a data URL is decoded here, because a pasted file never had one.
	 */
	source: AttachmentUploadSource;
	backendUrl: string;
	token: string | null;
	/** Injectable for the test that proves the cap is enforced pre-read. */
	maxBytes?: number;
	fetchImpl?: typeof fetch;
};

const basenameOf = (filePath: string): string =>
	filePath.split(PATH_SEPARATOR).pop() || filePath;

/** Decode a `data:` URL into bytes, or null when it is not a usable one. */
function bytesFromDataUrl(dataUrl: string): Uint8Array | null {
	const comma = dataUrl.indexOf(",");
	if (comma < 0 || !dataUrl.startsWith("data:")) return null;
	const header = dataUrl.slice(5, comma);
	const payload = dataUrl.slice(comma + 1);
	try {
		if (header.endsWith(";base64"))
			return new Uint8Array(Buffer.from(payload, "base64"));
		return new Uint8Array(Buffer.from(decodeURIComponent(payload), "utf8"));
	} catch {
		return null;
	}
}

/**
 * Read a JSON answer without assuming a shape the route has not promised.
 *
 * `CRUDResponse[StoredFile]` is the contract's name for the envelope, and this
 * harness's CRUD routes have answered both bare records and `{result: record}`
 * across versions. Reading both is not defensive guessing: it is the one place
 * the two documented spellings meet, and the field validation below is what
 * keeps the tolerance from becoming a silent success.
 */
function readRecord(payload: unknown): Record<string, unknown> | null {
	if (payload === null || typeof payload !== "object") return null;
	const body = payload as Record<string, unknown>;
	const inner = body.result;
	if (inner !== null && typeof inner === "object")
		return inner as Record<string, unknown>;
	return body;
}

function toAttachment(payload: unknown): UploadedAttachment | null {
	const record = readRecord(payload);
	if (!record) return null;
	const digest = record.digest;
	const mime = record.mime_type;
	const bytes = record.bytes;
	if (typeof digest !== "string" || !DIGEST_SHAPE.test(digest)) return null;
	if (typeof mime !== "string" || mime.length === 0) return null;
	if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0)
		return null;
	return {
		digest,
		name: typeof record.name === "string" ? record.name : null,
		mime_type: mime,
		bytes,
		path: typeof record.path === "string" ? record.path : null,
		stored_path:
			typeof record.stored_path === "string" ? record.stored_path : null,
	};
}

/** The daemon's own refusal sentence, when its body carries one. */
function refusalDetail(payload: unknown): string | null {
	if (payload === null || typeof payload !== "object") return null;
	const detail = (payload as Record<string, unknown>).detail;
	if (typeof detail === "string" && detail.trim()) return detail;
	if (detail !== null && typeof detail === "object") {
		const message = (detail as Record<string, unknown>).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return null;
}

export async function uploadAttachment(
	input: UploadAttachmentInput,
): Promise<AttachmentUploadResult> {
	const cap = input.maxBytes ?? MAX_ATTACHMENT_UPLOAD_BYTES;
	const source = input.source;
	const displayName =
		source.name?.trim() ||
		(source.kind === "path" ? basenameOf(source.path) : "pasted-file");
	let originPath: string | null = null;
	let size: number;
	if (source.kind === "path") {
		const filePath = source.path;
		originPath = filePath;
		try {
			const stat = statSync(filePath, { throwIfNoEntry: false });
			if (!stat) {
				return {
					success: false,
					code: "not-found",
					error: `No file at ${filePath}`,
				};
			}
			if (!stat.isFile()) {
				return {
					success: false,
					code: "not-a-file",
					error: `${filePath} is not a regular file`,
				};
			}
			size = stat.size;
		} catch (error) {
			return {
				success: false,
				code: "unreadable",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	} else {
		const decoded = bytesFromDataUrl(source.dataUrl);
		if (!decoded) {
			return {
				success: false,
				code: "unreadable",
				error: `${displayName} did not carry usable bytes`,
			};
		}
		size = decoded.byteLength;
	}
	// Checked against `stat` BEFORE the read, so a 2 GB file is refused without
	// allocating it. The route refuses the same size; catching it here makes the
	// sentence local rather than a round trip.
	if (size === 0) {
		return {
			success: false,
			code: "refused",
			error: `${displayName} is empty`,
			sizeBytes: 0,
		};
	}
	if (size > cap) {
		return {
			success: false,
			code: "too-large",
			error: `${displayName} is ${size} bytes, over the ${cap}-byte attachment limit`,
			sizeBytes: size,
		};
	}
	let bytes: Uint8Array;
	try {
		bytes =
			source.kind === "path"
				? new Uint8Array(readFileSync(source.path))
				: (bytesFromDataUrl(source.dataUrl) as Uint8Array);
	} catch (error) {
		return {
			success: false,
			code: "unreadable",
			error: error instanceof Error ? error.message : String(error),
		};
	}

	const form = new FormData();
	// The Blob copies the view; `bytes` is a fresh Uint8Array, so no pooled
	// Buffer is kept alive by the request body.
	form.append(
		"file",
		new Blob([bytes as Uint8Array<ArrayBuffer>], {
			type: "application/octet-stream",
		}),
		displayName,
	);
	form.append("name", displayName);
	if (originPath) form.append("origin_path", originPath);

	let response: Response;
	try {
		const doFetch = input.fetchImpl ?? fetch;
		response = await doFetch(
			new URL("/v1/desktop/attachments", input.backendUrl),
			{
				method: "POST",
				headers: {
					Accept: "application/json",
					...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
				},
				body: form,
				redirect: "error",
				signal: AbortSignal.timeout(UPLOAD_DEADLINE_MS),
			},
		);
	} catch (error) {
		return {
			success: false,
			code: "unreachable",
			error:
				error instanceof Error
					? error.message
					: "The daemon did not answer the upload.",
		};
	}
	let payload: unknown = null;
	try {
		payload = await response.json();
	} catch {
		// A body that is not JSON is still an answer; the status decides below.
	}
	if (response.status < 200 || response.status >= 300) {
		return {
			success: false,
			code: "refused",
			error:
				refusalDetail(payload) ??
				`The daemon refused the upload (HTTP ${response.status}).`,
			sizeBytes: size,
		};
	}
	const attachment = toAttachment(payload);
	if (!attachment) {
		return {
			success: false,
			code: "refused",
			error: `${displayName} was uploaded but the daemon's answer carried no attachment record.`,
			sizeBytes: size,
		};
	}
	return { success: true, attachment };
}
