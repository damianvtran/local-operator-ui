/**
 * Team Bridge image attachments: the pure half (no React, no DOM tree).
 *
 * WHY THIS EXISTS. Humans paste screenshots into chat; the bridge carried text
 * only. The hub stores png/jpeg ONLY (it sniffs the bytes and refuses
 * everything else with 415 - manager decision D3), so every other clipboard
 * format has to become png/jpeg HERE, before upload, and every image is
 * bounded to a hard 1024px edge (`boundImageForWire` with `edgeIsHard`) and
 * the agent composer's byte ladder, so it is <= 1 MiB in practice. The HARD
 * byte limit is the capability cap (`maxBytes` below, then the hub's 413);
 * the hub's 5 MiB is headroom rather than the normal path.
 *
 * CONSTRAINTS this module owns:
 * - The type is SNIFFED from the bytes, never read from `File.type` or the
 *   name: a clipboard can label anything anything, and the hub ignores the
 *   client's claim anyway, so trusting it here would only produce chips that
 *   fail later with a worse sentence.
 * - Nothing here logs, and no error carries bytes, ids, digests or file names
 *   (D9). Failures are a closed set of reasons the chip maps to its own copy.
 * - Bytes live in memory only. A draft persists the hub's descriptor (id,
 *   size, dimensions, expiry) and never base64 (D9): see `draftAttachment`.
 */

import type {
	TeamBridgeAttachment,
	TeamBridgeAttachmentCapability,
} from "../../../../shared/team-bridge-contract";
import { teamBridgeAttachmentCapabilitySchema } from "../../../../shared/team-bridge-contract";
import { onDraftRevocation } from "../../shared/store/team-bridge-draft-account";
import {
	IMAGE_JPEG_QUALITY,
	IMAGE_MAX_EDGE,
	type WireImageMime,
	boundImageForWire,
} from "../chat/utils/bound-image";

/** The hub's per-message ceiling (D3). The capability may lower it, never raise it. */
export const TEAM_BRIDGE_MAX_ATTACHMENTS = 4;

/** What the hub accepts. Everything else is converted before upload. */
export type UploadMime = "image/png" | "image/jpeg";

/**
 * The capability the composer gates on, or `null` when this hub cannot take
 * images. Absence is the old-server signal: an old hub answers an unknown
 * `attachment_ids` field with 400, so the UI must not offer what it cannot
 * send. A block that does not list both png and jpeg is also treated as off -
 * the client converts to exactly those two, so a narrower server is one this
 * client cannot serve honestly.
 */
export function attachmentCapability(
	status: unknown,
): TeamBridgeAttachmentCapability | null {
	const block =
		status && typeof status === "object"
			? (status as { status?: { attachments?: unknown } | null }).status
					?.attachments
			: undefined;
	const parsed = teamBridgeAttachmentCapabilitySchema.safeParse(block);
	if (!parsed.success || !parsed.data.enabled) return null;
	const types = new Set(parsed.data.mime_types);
	if (!types.has("image/png") || !types.has("image/jpeg")) return null;
	return parsed.data;
}

/** The effective per-message count: the smaller of the hub's and ours. */
export function maxAttachments(
	capability: TeamBridgeAttachmentCapability | null,
): number {
	return capability
		? Math.min(capability.max_count, TEAM_BRIDGE_MAX_ATTACHMENTS)
		: 0;
}

/** Magic-number sniff. `null` is "not a picture this client can handle". */
export type SniffedMime = WireImageMime | "image/heic";
export function sniffImage(bytes: Uint8Array): SniffedMime | null {
	const at = (index: number) => bytes[index];
	if (
		bytes.length >= 8 &&
		at(0) === 0x89 &&
		at(1) === 0x50 &&
		at(2) === 0x4e &&
		at(3) === 0x47
	)
		return "image/png";
	if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff)
		return "image/jpeg";
	if (bytes.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46)
		return "image/gif";
	const ascii = (start: number, end: number) =>
		String.fromCharCode(...bytes.subarray(start, end));
	if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
		return "image/webp";
	// ISO-BMFF `ftyp` with an HEIF brand: what an iPhone photo is.
	if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
		const brand = ascii(8, 12);
		if (
			["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)
		)
			return "image/heic";
	}
	return null;
}

/** Why a chip could not be staged or sent. A closed set: copy is per reason. */
export type AttachmentFailure =
	| "unsupported"
	| "too_large"
	| "invalid"
	| "rate_limited"
	| "limit"
	| "expired"
	| "offline"
	| "signed_out"
	/* The captured owner is no longer the signed-in one (409 `account_mismatch`).
	   Its own reason because the ONLY truthful account sentence is "who you are
	   changed", not "you are signed out" and not a quota (review round 1, R1-01). */
	| "account_mismatch"
	| "failed";

/**
 * Map a refused upload onto a reason. The statuses are the contract's
 * (§2-3, D3): 413 oversize, 415 type, 422 corrupt/pixel bomb, 429 rate,
 * 400 count/quota, 404 the uniform "not yours / gone" answer. `null` is "the
 * request never reached anything" (no daemon, no credential, transport).
 *
 * `code` matters where a status is ambiguous: the captured-owner guard answers
 * 409 `account_mismatch`, and reading that as the 400 quota refusal told a user
 * whose account changed that they had too many images (review round 1, R1-01).
 * The declared code wins; a bare 409 is a generic conflict, never a quota.
 */
export function uploadFailure(
	status: number | null | undefined,
	code?: string | null,
): AttachmentFailure {
	if (code === "account_mismatch") return "account_mismatch";
	switch (status) {
		case 413:
			return "too_large";
		case 415:
			return "unsupported";
		case 422:
			return "invalid";
		case 429:
			return "rate_limited";
		case 400:
			return "limit";
		case 409:
			/* Any other conflict: retryable, and not a claim about quota. */
			return "failed";
		case 404:
			return "expired";
		// 401 `bridge_signin_required`: the runtime lost its sign-in while the
		// composer was open (the page gate hides it once status catches up).
		// A sign-in cue, not "upload failed", which reads as retryable (QA Q3).
		case 401:
			return "signed_out";
		case null:
		case undefined:
		case 502:
		case 503:
			return "offline";
		default:
			return "failed";
	}
}

/**
 * A send refused because a staged id no longer binds (D2: 72 h staged TTL).
 * Only the DECLARED code counts: a bare 404 can be the conversation itself
 * (the author was removed), and reading that as "your images expired" would
 * drop descriptors that are still good (review round 1, R1-05). The runtime
 * proxy forwards the hub's `attachment_not_found` code on this path.
 */
export function isAttachmentNotFound(error: unknown): boolean {
	return (error as { code?: unknown })?.code === "attachment_not_found";
}

/**
 * A send refused because its `client_ref` was already used by a DIFFERENT message.
 *
 * The hub answers 409 here and it is right to: the key is an idempotency key, so
 * seeing it twice with different content means two distinct messages are claiming
 * one identity. The defect this detects is on our side - a key reused across
 * messages instead of across retries of one message - and it is recoverable: the
 * payload is new, so it needs a NEW key rather than another press of Send.
 *
 * Matched on the DECLARED code when the proxy forwards it, and otherwise on the
 * hub's own sentence, because the refusal arrives through the runtime proxy and
 * older builds of it do not forward the code. The sentence fallback is deliberately
 * narrow (`client_ref`), so it cannot swallow an unrelated 409 such as a
 * conversation-level conflict, which must keep its own error.
 */
const CLIENT_REF_MENTION = /client_ref/i;

export function isClientRefConflict(error: unknown): boolean {
	const coded = (error as { code?: unknown })?.code;
	if (coded === "client_ref_conflict" || coded === "conflict_client_ref")
		return true;
	const message = (error as { message?: unknown })?.message;
	return typeof message === "string" && CLIENT_REF_MENTION.test(message);
}

/**
 * The ids a send or schedule carries into `conversationId`: held images are
 * staged there FIRST (a failure throws, so the request never goes out
 * text-only), otherwise the already-staged ids. One helper for every send
 * path, so no branch can forget the held set again (review round 1, R1-01).
 */
export async function sendAttachmentIds(
	attachments:
		| {
				ids: readonly string[];
				stageHeld?: (
					conversationId: string,
					tenantId: string | undefined,
				) => Promise<string[]>;
		  }
		| undefined,
	conversationId: string,
	tenantId: string | undefined,
): Promise<string[]> {
	if (attachments?.stageHeld)
		return attachments.stageHeld(conversationId, tenantId);
	return [...(attachments?.ids ?? [])];
}

export class AttachmentPrepareError extends Error {
	readonly reason: AttachmentFailure;
	constructor(reason: AttachmentFailure) {
		super(`attachment ${reason}`);
		this.name = "AttachmentPrepareError";
		this.reason = reason;
	}
}

export type PreparedImage = {
	bytes: Uint8Array;
	mime: UploadMime;
	width: number;
	height: number;
};

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk)
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1)
		bytes[index] = binary.charCodeAt(index);
	return bytes;
}

/**
 * Re-encode a picture the hub will not take (webp, a GIF's FIRST frame, and
 * HEIC where the platform decodes it) as PNG. PNG rather than JPEG because the
 * common case is a screenshot, where JPEG rings small text; the bounding step
 * that follows falls back to JPEG on its own when the PNG is over budget.
 * A platform that cannot decode the format (Chromium has no HEIC decoder on
 * most builds) is an honest "unsupported", never a silent drop.
 */
async function convertToPng(bytes: Uint8Array, mime: SniffedMime) {
	if (
		typeof createImageBitmap !== "function" ||
		typeof OffscreenCanvas !== "function"
	)
		throw new AttachmentPrepareError("unsupported");
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(
			new Blob([bytes as BlobPart], { type: mime }),
		);
	} catch {
		throw new AttachmentPrepareError("unsupported");
	}
	try {
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext("2d");
		if (!context) throw new AttachmentPrepareError("unsupported");
		context.drawImage(bitmap, 0, 0);
		const png = await canvas.convertToBlob({ type: "image/png" });
		return new Uint8Array(await png.arrayBuffer());
	} finally {
		bitmap.close();
	}
}

/** Pixel dimensions of a png/jpeg, for the chip's reserved box. 0×0 when unknown. */
async function dimensions(bytes: Uint8Array, mime: UploadMime) {
	if (typeof createImageBitmap !== "function") return { width: 0, height: 0 };
	try {
		const bitmap = await createImageBitmap(
			new Blob([bytes as BlobPart], { type: mime }),
		);
		const size = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		return size;
	} catch {
		return { width: 0, height: 0 };
	}
}

/**
 * One clipboard/dropped/picked file → bytes the hub will accept.
 *
 * Order matters: sniff, convert non-png/jpeg to PNG, THEN bound - bounding is
 * what keeps a converted 4K webp under 1 MiB. `maxBytes` is the capability's
 * ceiling; the bounded result is normally far below it, and one that is not is
 * refused here (`too_large`) rather than uploaded to fail with a 413.
 */
export async function prepareImageForUpload(
	file: Blob,
	maxBytes: number,
): Promise<PreparedImage> {
	let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
	const sniffed = sniffImage(bytes);
	if (!sniffed) throw new AttachmentPrepareError("unsupported");
	let mime: WireImageMime;
	if (sniffed === "image/png" || sniffed === "image/jpeg") mime = sniffed;
	else {
		bytes = await convertToPng(bytes, sniffed);
		mime = "image/png";
	}
	// `edgeIsHard`: the 1024 px edge is the wire contract here (D3), so an
	// over-edge image is downscaled even when that does not shrink its bytes.
	const bounded = await boundImageForWire(
		{ data_b64: toBase64(bytes), mime_type: mime },
		IMAGE_MAX_EDGE,
		IMAGE_JPEG_QUALITY,
		{ edgeIsHard: true },
	);
	if (bounded.mime_type !== "image/png" && bounded.mime_type !== "image/jpeg")
		throw new AttachmentPrepareError("unsupported");
	const out = fromBase64(bounded.data_b64);
	if (out.byteLength > maxBytes) throw new AttachmentPrepareError("too_large");
	const size = await dimensions(out, bounded.mime_type);
	return { bytes: out, mime: bounded.mime_type, ...size };
}

/** The images a paste/drop carried, in clipboard order. Text is not touched. */
export function imageFiles(list: DataTransfer | null | undefined): File[] {
	if (!list) return [];
	const files: File[] = [];
	// `items` before `files`: a paste from a browser exposes the image only as an
	// item, while a Finder drop exposes it in both and would otherwise double.
	if (list.items && list.items.length > 0) {
		for (const item of Array.from(list.items)) {
			if (item.kind !== "file") continue;
			const file = item.getAsFile();
			if (file && isImageCandidate(file)) files.push(file);
		}
		return files;
	}
	for (const file of Array.from(list.files ?? []))
		if (isImageCandidate(file)) files.push(file);
	return files;
}

/*
 * A cheap pre-filter only (the real decision is `sniffImage`): an empty type
 * is admitted because macOS hands HEIC and some screenshots over untyped.
 */
function isImageCandidate(file: File): boolean {
	return file.type === "" || file.type.startsWith("image/");
}

/**
 * How a BOUND attachment in a message renders. The server's `state` is read
 * fail-closed: only absent/`bound` is fetchable; `expired` is the retention
 * sweeper's terminal state (D2) and says so; every other value - `deleted`,
 * a withheld or future state - is the generic "unavailable" placeholder and is
 * NEVER fetched, so an additive server state cannot become a request.
 */
export type AttachmentView = "fetch" | "expired" | "unavailable";
export function attachmentView(
	attachment: TeamBridgeAttachment,
): AttachmentView {
	if (attachment.state === undefined || attachment.state === "bound")
		return attachment.mime === "image/png" || attachment.mime === "image/jpeg"
			? "fetch"
			: "unavailable";
	if (attachment.state === "expired") return "expired";
	return "unavailable";
}

/** The descriptor a draft keeps: what the hub said, never the bytes (D9). */
export type DraftAttachment = {
	id: string;
	conversationId: string;
	mime: string;
	size: number;
	width: number;
	height: number;
	expiresAt?: string;
};

export function draftAttachment(
	attachment: TeamBridgeAttachment,
	conversationId: string,
): DraftAttachment {
	return {
		id: attachment.id,
		conversationId,
		mime: attachment.mime,
		size: attachment.size,
		width: attachment.width,
		height: attachment.height,
		...(attachment.expires_at ? { expiresAt: attachment.expires_at } : {}),
	};
}

/** A staged id past its expiry can only 404 at send: show it as "remove". */
export function isStagedExpired(
	entry: { expiresAt?: string },
	now = Date.now(),
): boolean {
	if (!entry.expiresAt) return false;
	const at = Date.parse(entry.expiresAt);
	return Number.isFinite(at) && at <= now;
}

/*
 * PREVIEWS OF THIS SESSION'S OWN UPLOADS, by hub attachment id, so a
 * scheduled row can show the picture its author attached (a reserved image is
 * not bound to a message yet, so no byte route exists for it - the manager's
 * v1 rule: descriptor tile, or the in-memory original when we still hold it).
 * Keyed by ACCOUNT as well as id so the logout fence holds for pictures too:
 * a different (or no) account can never read another account's entries, and
 * `forgetUploadPreviews` drops them outright. Bounded (an LRU of 16) because
 * nothing else reclaims it.
 */
const PREVIEW_CAP = 16;
const previews = new Map<string, Blob>();
const previewKey = (accountId: string, id: string) => `${accountId}\u0000${id}`;
export function rememberUploadPreview(
	accountId: string | undefined,
	id: string,
	blob: Blob,
): void {
	if (!accountId) return;
	const key = previewKey(accountId, id);
	previews.delete(key);
	previews.set(key, blob);
	while (previews.size > PREVIEW_CAP) {
		const oldest = previews.keys().next().value;
		if (oldest === undefined) break;
		previews.delete(oldest);
	}
}
export function uploadPreview(
	accountId: string | undefined,
	id: string,
): Blob | null {
	return accountId ? (previews.get(previewKey(accountId, id)) ?? null) : null;
}
export function forgetUploadPreviews(): void {
	previews.clear();
}
// Registered at module load: the account fence clears previews with drafts.
onDraftRevocation(forgetUploadPreviews);
