/**
 * Read one link-preview artifact off the daemon's own response.
 *
 * WHY A DEDICATED READER rather than the generic media path: every other byte op
 * on this plane accepts one of a handful of declared types and hands the bytes
 * straight to its consumer. This one is the ONLY reader of an `image/*` body that
 * main will then KEEP ON DISK, so it is the only place that enforces a hard byte
 * ceiling before anything is written — a bounded read here is what stops one
 * hostile response from filling the 64 MB artifact cache.
 *
 * WHAT IT DOES NOT DO. It does not sniff, decode, resize or re-encode: the peer
 * is this machine's own daemon, core already sniffed the bytes and returns the
 * media type it found, and a second opinion here could only disagree with the
 * authority. It does not follow redirects (the transport refuses them outright).
 * It never holds a URL: the only identifier this path knows is the artifact id.
 */

import type { DesktopMediaResponse } from "../desktop-media";
import { ARTIFACT_MAX_BLOB_BYTES } from "./artifact-cache";

/** Decimal-only `Content-Length`, so `"12abc"` and a `+12` are refusals rather
 * than numbers `Number()` would happily accept. */
const DECIMAL_LENGTH = /^\d+$/;

/**
 * The refusal a caller can act on, with a sentence that names no page.
 *
 * A `404` is core's "your scope does not name this id — or the bytes are gone":
 * one status, because the server deliberately makes the two indistinguishable and
 * a UI that distinguished them would leak which ids exist elsewhere.
 */
function failure(status: number): DesktopMediaResponse {
	return {
		status,
		kind: "error",
		detail: "That preview image is not available.",
	};
}

/**
 * Bound, then read. Returns the bytes with the MIME the daemon declared, or a
 * refusal.
 *
 * The ceiling is checked TWICE on purpose: the declared `Content-Length` refuses
 * an oversize body before a byte is buffered, and the running total refuses a
 * body that lies about (or omits) its length. Either check alone leaves a hole -
 * a chunked response has no length header, and a declared length is not a
 * promise.
 */
export async function readLinkPreviewArtifact(
	response: Response,
): Promise<DesktopMediaResponse> {
	if (response.status !== 200) return failure(response.status);
	const mime = (response.headers.get("content-type") ?? "")
		.split(";")[0]
		.trim()
		.toLowerCase();
	// `image/*` and nothing else: this route serves a stored raster, so any other
	// type is a body no card can draw and no cache should keep.
	if (!mime.startsWith("image/")) {
		await response.body?.cancel().catch(() => {});
		return failure(422);
	}
	const length = response.headers.get("content-length");
	if (length !== null) {
		if (!DECIMAL_LENGTH.test(length)) return failure(422);
		if (Number(length) > ARTIFACT_MAX_BLOB_BYTES) {
			await response.body?.cancel().catch(() => {});
			return failure(413);
		}
	}
	if (!response.body) return failure(422);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > ARTIFACT_MAX_BLOB_BYTES) {
				await reader.cancel().catch(() => {});
				return failure(413);
			}
			chunks.push(value);
		}
	} catch {
		// A transport that broke mid-body is not a refusal of the id: `503` keeps
		// the caller's retry honest, where a 404 would tell it to forget the card.
		return failure(503);
	} finally {
		reader.releaseLock();
	}
	// An empty 200 is a body no card can draw. It is not "gone" either — the id
	// resolved and the scope owned it — so it is reported as the malformed answer
	// it is.
	if (size === 0) return failure(422);
	const data = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { status: 200, kind: "bytes", mimeType: mime, data };
}
