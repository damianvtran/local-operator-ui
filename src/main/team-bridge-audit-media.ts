import { t } from "../i18n/messages";
import type { DesktopMediaResponse } from "./desktop-media";

const IMAGE_CAP = 5 * 1024 * 1024;
const DECIMAL_LENGTH = /^\d+$/;

/** Audit image bytes only. Generic descriptors are metadata, not permission
 * to export opaque data; even a stale caller cannot opt into a file mode. */
export async function readOwnerAuditAttachment(
	response: Response,
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
	const approved = mime === "image/png" || mime === "image/jpeg";
	const cap = IMAGE_CAP;
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
		if (size === 0) return refusal(422);
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
