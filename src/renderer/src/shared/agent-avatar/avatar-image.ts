/**
 * What an agent profile picture may arrive as, and what #1517's stored entries
 * look like.
 *
 * WHERE A PICTURE LIVES NOW. Core owns it (`<agents_dir>/<id>/avatar.png`,
 * recorded in `agent.yml`), and `agent-avatar.ts` is the seam every surface
 * reads through. This file keeps the client's INPUT gate - the same limits
 * core enforces (10 MiB in, 40 MP decoded), checked here first so a person is
 * told before a crop rather than after an upload - and the filter for #1517's
 * `localStorage` entries, which the one-time migration reads.
 *
 * PURE ON PURPOSE. Asserted in Node by `scripts/agent-avatar.test.mjs`, where
 * there is no canvas; the drawing is `decode-image.ts` and the cropper.
 */

/**
 * The largest file the picker will read, before the downscale.
 *
 * Core's own input ceiling (contract: <=10 MiB in), so a file the backend would
 * refuse is refused here before the crop step rather than after an upload. A
 * phone camera's full frame fits; a RAW export does not.
 */
export const AGENT_AVATAR_MAX_BYTES = 10 * 1024 * 1024;

/**
 * The formats a picked file may be: the contract's browser path.
 *
 * JPEG, PNG, WebP and GIF (its first frame) are the four a browser decodes
 * through `createImageBitmap`, and they are the four the type refusal names -
 * the list and that sentence are one claim, and `scripts/agent-avatar.test.mjs`
 * fails when they drift.
 *
 * WHAT IS NOT HERE, and neither is an oversight. HEIC is accepted by the
 * BACKEND when its image decoder is installed, but this renderer cannot decode
 * it, so offering it would be a refusal made after the person picked instead of
 * before. AVIF left the list with the proof of concept: core's sniffing gate is
 * the authority for what it stores, and a format the backend then refuses only
 * moves the refusal later. SVG is a different case - a document that can carry
 * external references, and one Chromium refuses in `createImageBitmap` anyway.
 */
export const AGENT_AVATAR_MIME_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;

/** The picker's `accept`: one string, derived from the gate's list. */
export const AGENT_AVATAR_ACCEPT = AGENT_AVATAR_MIME_TYPES.join(",");

/**
 * The largest number of pixels a picked file may decode to.
 *
 * The byte ceiling above bounds BYTES, and a flat-colour PNG of 40,000 px per
 * edge compresses into a few hundred kilobytes while decoding to 1.6 gigapixels
 * in the renderer process. This bound is the decode's own ceiling and core's
 * (contract: <=40 MP decoded): 40 MP is above any camera frame a user would pick as a profile picture (a 35 MP frame
 * decoded in 162 ms in the round-1 QA run) and far below the sizes where a
 * renderer allocation is the difference between a slow pick and a dead tab.
 *
 * It has no copy of its own: a file this large is refused with the same
 * "could not be read" sentence as an undecodable one, because to every surface
 * that is what it is.
 */
export const AGENT_AVATAR_MAX_PIXELS = 40_000_000;

/** Why a picked file cannot become an avatar. */
export type AgentAvatarRefusal = "type" | "size" | "decode" | "encode";

const AVATAR_DATA_URL =
	/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * The type/size gate, before a byte is decoded.
 *
 * Takes the two fields it reads rather than a `File`, so the rule is callable
 * from a test: `avatarFileRejection({ type: "image/svg+xml", size: 10 })`.
 *
 * AN EMPTY FILE IS A DECODE REFUSAL, not a size one (QA round 1, Q-1): zero
 * bytes is not "larger than 8 MB", and saying so named the wrong limit. There
 * is nothing to decode, which is what the existing "could not be read"
 * sentence already means.
 */
export function avatarFileRejection(file: {
	type: string;
	size: number;
}): AgentAvatarRefusal | null {
	if (!(AGENT_AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
		return "type";
	}
	if (file.size <= 0) return "decode";
	if (file.size > AGENT_AVATAR_MAX_BYTES) return "size";
	return null;
}

/**
 * The pixel gate, applied to a source's dimensions before it is cropped.
 *
 * Pure for the same reason as the byte gate: the bound is the rule a reader
 * checks, and Node can assert it without a canvas. `null` means the image may
 * be drawn.
 */
export function avatarPixelRefusal(
	width: number,
	height: number,
): AgentAvatarRefusal | null {
	if (!Number.isFinite(width) || !Number.isFinite(height)) return "decode";
	if (width <= 0 || height <= 0) return "decode";
	return width * height > AGENT_AVATAR_MAX_PIXELS ? "decode" : null;
}

/**
 * #1517's `localStorage` entries, filtered rather than trusted.
 *
 * READ BY THE ONE-TIME MIGRATION ONLY (`agent-avatar.ts`). That store can be
 * hand-edited, left half-written by a dying process, or written by a build that
 * stored something else, and every surviving entry is then UPLOADED to the
 * backend - so the shape check matters more here than it did when the same
 * bytes were merely painted. Anything that is not a `webp`/`png`/`jpeg` data URL
 * is dropped before it can become an agent's stored picture.
 */
export function sanitizeAvatarImages(value: unknown): Record<string, string> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	const kept: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof key !== "string" || key.length === 0 || key.length > 200) {
			continue;
		}
		if (typeof entry !== "string") continue;
		if (!AVATAR_DATA_URL.test(entry)) continue;
		kept[key] = entry;
	}
	return kept;
}
