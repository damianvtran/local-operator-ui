import { t } from "../i18n/messages";
import type { DesktopMediaResponse } from "./desktop-media";

const IMAGE_CAP = 5 * 1024 * 1024;
/*
 * The FILE lane's ceiling: the hub's largest file class (`container`/`other`,
 * 25 MiB) and core's own bound on both byte routes (`_FILE_MAX_BYTES` on the
 * member route, `OWNER_AUDIT_FILE_MAX_BYTES` on the audit one). A bound file can
 * never be larger than the upload that created it, so anything bigger is not one.
 */
export const TEAM_BRIDGE_FILE_MAX_BYTES = 25 * 1024 * 1024;
const DECIMAL_LENGTH = /^\d+$/;
/* An error envelope is a sentence and a code; a few KiB holds it with room. */
const ERROR_BODY_CAP = 4096;

/*
 * WHICH BYTES MAIN WILL BUFFER FOR THE RENDERER, by lane. Both lanes demand the
 * headers core sets on these routes (`nosniff`, a sandboxing CSP, `no-store`):
 * an answer missing any of them is not one of core's, whatever its type says.
 *
 * The FILE lane exists for decision a-fdf0 (save a generic file). Its one type
 * is the hub's one served file type, so an image, HTML or SVG answer on the
 * file lane is refused rather than written to disk under a name the reader
 * chose for something else. The lane is selected ONLY by the exact string
 * `"file"`: a stale boolean or any other value keeps the image lane, so no
 * caller can drift into opaque bytes by accident.
 */
type Lane = {
	types: ReadonlySet<string>;
	cap: number;
	/** Read the refusal's declared code (bounded) to tell "too large" apart. */
	declared: boolean;
	/**
	 * Whether a zero-byte body is a valid answer. A picture with no bytes cannot
	 * be decoded, so the image lane refuses it (422) rather than handing the
	 * renderer a broken `<img>`. A FILE may legitimately be empty - core #3521
	 * serves a bound empty upload in file mode - and refusing it left the Save
	 * permanently "unavailable" for a file that exists (agent review round 1,
	 * R1 / QA Q1). The owner-audit route's own empty-body refusal is core's to
	 * fix; main does not special-case either authority.
	 */
	allowsEmpty: boolean;
};
const IMAGE_LANE: Lane = {
	types: new Set(["image/png", "image/jpeg"]),
	cap: IMAGE_CAP,
	declared: false,
	allowsEmpty: false,
};
const FILE_LANE: Lane = {
	types: new Set(["application/octet-stream"]),
	cap: TEAM_BRIDGE_FILE_MAX_BYTES,
	declared: true,
	allowsEmpty: true,
};

/*
 * Core answers an over-bound file as `502 {code: "attachment_too_large"}`, the
 * same status as an unreachable hub. Only the declared code tells the reader
 * "this file cannot be saved here" from "try again", so the file lane reads it
 * - bounded, and only the code - and restates it as main's own over-ceiling
 * status (413, as the stream cap below does). Any read failure keeps the
 * original status: cleanup can never turn a refusal into something else.
 */
async function declaresTooLarge(response: Response): Promise<boolean> {
	if (!response.body) return false;
	const type = response.headers.get("content-type") ?? "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		if (!type.includes("application/json")) {
			await reader.cancel();
			return false;
		}
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > ERROR_BODY_CAP) {
				await reader.cancel();
				return false;
			}
			chunks.push(value);
		}
		const text = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			text.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const parsed = JSON.parse(new TextDecoder().decode(text)) as {
			detail?: { code?: unknown };
		};
		return parsed?.detail?.code === "attachment_too_large";
	} catch {
		return false;
	} finally {
		reader.releaseLock();
	}
}

async function readGuardedBytes(
	response: Response,
	lane: Lane,
): Promise<DesktopMediaResponse> {
	const refusal = (status: number): DesktopMediaResponse => ({
		status,
		kind: "error",
		detail: t("ui.teamBridge.attachmentCard.unavailable"),
	});
	const mime = (response.headers.get("content-type") ?? "")
		.split(";")[0]
		.trim()
		.toLowerCase();
	const cacheControl = response.headers.get("cache-control") ?? "";
	const csp = response.headers.get("content-security-policy") ?? "";
	const approved = lane.types.has(mime);
	const cap = lane.cap;
	const length = response.headers.get("content-length");
	let refused = response.status !== 200 ? response.status : 422;
	if (length && DECIMAL_LENGTH.test(length) && Number(length) > cap)
		refused = 413;
	if (
		response.status !== 200 ||
		!approved ||
		!response.body ||
		!cacheControl.includes("no-store") ||
		!csp.includes("sandbox") ||
		!csp.includes("default-src 'none'") ||
		response.headers.get("x-content-type-options")?.toLowerCase() !==
			"nosniff" ||
		(length !== null && (!DECIMAL_LENGTH.test(length) || Number(length) > cap))
	) {
		if (lane.declared && response.status !== 200)
			return refusal((await declaresTooLarge(response)) ? 413 : refused);
		// Preserve the refusal even if cancelling its unread body fails: cleanup
		// cannot turn an authenticated denial into a retriable successful read.
		try {
			await response.body?.cancel();
		} catch {
			return refusal(refused);
		}
		return refusal(refused);
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let oversized = false;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > cap) {
				oversized = true;
				await reader.cancel();
				return refusal(413);
			}
			chunks.push(value);
		}
		if (size === 0 && !lane.allowsEmpty) return refusal(422);
		const data = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			data.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return { status: 200, kind: "bytes", mimeType: mime, data, cacheControl };
	} catch {
		return refusal(oversized ? 413 : 503);
	} finally {
		reader.releaseLock();
	}
}

/** Owner-audit bytes: png/jpeg up to 5 MiB, or - only for the exact `"file"`
 * mode - one generic file (octet-stream, up to 25 MiB) for the owner's Save. */
export async function readOwnerAuditAttachment(
	response: Response,
	mode?: unknown,
): Promise<DesktopMediaResponse> {
	return readGuardedBytes(response, mode === "file" ? FILE_LANE : IMAGE_LANE);
}

/**
 * A member's generic file (core #3521's `?mode=file`), for the signed-in
 * person's Save. Core serves it under exactly the audit route's headers, so it
 * shares this reader rather than growing a second copy of the same guard; the
 * member IMAGE lane is untouched and keeps its own path in `desktop-media.ts`.
 */
export async function readMemberFileAttachment(
	response: Response,
): Promise<DesktopMediaResponse> {
	return readGuardedBytes(response, FILE_LANE);
}
