/**
 * Read one link-preview artifact off the daemon's own response.
 *
 * WHY A DEDICATED READER rather than the generic media path: every other byte op
 * on this plane accepts one of a handful of declared types and hands the bytes
 * straight to its consumer. This one is the ONLY reader of an image body that main
 * will then KEEP ON DISK, so it is the only place that enforces a hard byte
 * ceiling before anything is written — a bounded read here is what stops one
 * hostile response from filling the 64 MB artifact cache.
 *
 * WHAT IT DOES NOT DO. It does not sniff, decode, resize or re-encode: the peer
 * is this machine's own daemon, core already sniffed the bytes and returns the
 * media type it found, and a second opinion here could only disagree with the
 * authority. It does not follow redirects (the transport refuses them outright).
 * It never holds a URL: the only identifier this path knows is the artifact id.
 *
 * THE MEDIA TYPE IS AN ALLOWLIST, NOT `image/*`. These bytes cross IPC as bare
 * bytes and are drawn by a renderer `<img>`; core's `nosniff` and
 * `content-security-policy` headers do not survive that hop. `image/svg+xml` is
 * the type that matters — an SVG is a document that can carry script — and
 * {@link ARTIFACT_ALLOWED_MIMES} is exactly the set core's sniffer can produce, so
 * accepting anything broader would let a future format (or a hand-edited cache
 * index) become a document this app hands the renderer unguarded.
 */

import type { DesktopMediaResponse } from "../desktop-media";
import {
	ARTIFACT_ALLOWED_MIMES,
	ARTIFACT_MAX_BLOB_BYTES,
} from "./artifact-cache";

/** Decimal-only `Content-Length`, so `"12abc"` and a `+12` are refusals rather
 * than numbers `Number()` would happily accept. */
const DECIMAL_LENGTH = /^\d+$/;

/** No refusal body is worth more than this; the one this route sends is a few
 * bytes of JSON. */
const MAX_REFUSAL_BODY_BYTES = 4096;

/**
 * The refusal a caller can act on, with a sentence that names no page.
 *
 * `code` is carried when the daemon's own body said one, because the two 404s this
 * route can produce mean opposite things to a card: `artifact_not_found` (this
 * scope does not name the id — the bytes are gone, drop the card) versus a router
 * 404 (the route is absent on a daemon that predates it — keep the card and retry
 * after `io`). Shape, not status, is the discriminator, and this is where the body
 * is still in hand.
 */
function failure(status: number, code?: string): DesktopMediaResponse {
	return {
		status,
		kind: "error",
		detail: "That preview image is not available.",
		...(code === undefined ? {} : { refusal: { code } }),
	};
}

/**
 * The machine-readable code in a refusal body, if it has one.
 *
 * FastAPI wraps an `HTTPException` detail as `{"detail": …}`, so the route's own
 * refusal is `{"detail":{"code":"artifact_not_found"}}` while the router's is
 * `{"detail":"Not Found"}`. A string detail is the shape this deliberately reports
 * as "no code" rather than guessing at one.
 */
async function refusalCode(response: Response): Promise<string | undefined> {
	if (!response.body) return undefined;
	let text: string;
	try {
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_REFUSAL_BODY_BYTES) {
				await reader.cancel().catch(() => {});
				return undefined;
			}
			chunks.push(value);
		}
		reader.releaseLock();
		const data = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			data.set(chunk, offset);
			offset += chunk.byteLength;
		}
		text = new TextDecoder().decode(data);
	} catch {
		return undefined;
	}
	try {
		const body = JSON.parse(text) as { detail?: unknown };
		const detail = body?.detail;
		if (typeof detail !== "object" || detail === null) return undefined;
		const code = (detail as { code?: unknown }).code;
		// Bounded because this string crosses into a typed slot: a body that said
		// something enormous is not a code this build has a branch for, and the
		// service compares against one known value.
		return typeof code === "string" && code.length <= 64 ? code : undefined;
	} catch {
		return undefined;
	}
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
	if (response.status !== 200) {
		// Only the 404 family carries a code worth reading — 422 and 5xx are decided
		// by status alone, and buffering their bodies would buy nothing.
		const code =
			response.status === 404 ? await refusalCode(response) : undefined;
		return failure(response.status, code);
	}
	const mime = (response.headers.get("content-type") ?? "")
		.split(";")[0]
		.trim()
		.toLowerCase();
	if (!ARTIFACT_ALLOWED_MIMES.has(mime)) {
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
