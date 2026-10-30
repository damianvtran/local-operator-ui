/**
 * What an agent profile picture is: the file types and size it may arrive as,
 * where its square is cut from, and what counts as a stored avatar.
 *
 * PROOF OF CONCEPT, AND WHERE IT IS STORED. The backend has no image field on
 * an agent (`AgentCreate`/`AgentUpdate` in
 * `local_operator/server/models/schemas.py` carry none), so a picture is kept
 * on THIS machine, keyed by agent id, in `shared/store/agent-avatar-store.ts`.
 * That module is the seam: the display and edit surfaces reach it, never
 * `localStorage` directly, so the day a backend field exists this file's
 * readers swap and no call site moves.
 *
 * PURE ON PURPOSE. The rules here decide whether a picked file may become an
 * avatar and which square of it is kept, and they are asserted in Node by
 * `scripts/agent-avatar.test.mjs`, where there is no canvas. The drawing is
 * `downscale-image.ts` and does nothing else.
 */

/**
 * The stored image's edge in CSS pixels.
 *
 * 256 is four times the largest place a picture is drawn (the settings
 * preview, 40px) and covers a 2x display, so a retina preview is still sharp;
 * anything larger is bytes the surfaces cannot show.
 */
export const AGENT_AVATAR_EDGE = 256;

/**
 * The largest file the picker will read, before the downscale.
 *
 * An 8 MB photo is a phone camera's full frame; the downscale throws almost
 * all of it away, so the ceiling exists to refuse the pathological case (a
 * 200 MB RAW export) rather than to bound the usual one.
 */
export const AGENT_AVATAR_MAX_BYTES = 8 * 1024 * 1024;

/**
 * What the file picker offers, and the list the type gate enforces. One value,
 * so the dialog and the refusal cannot disagree.
 *
 * THE ORDER IS THE SENTENCE'S ORDER. The refusal copy spells these out in every
 * locale ("Choose a JPEG, PNG, WebP, GIF or AVIF file"), and the picker's own
 * `accept` is built from this list, so the order a user reads and the order the
 * dialog offers are the same one. `scripts/agent-avatar.test.mjs` fails if the
 * two drift apart.
 *
 * SVG IS DELIBERATELY ABSENT. Chromium refuses SVG in `createImageBitmap`, and
 * an SVG avatar would be a document (with its own external references) where
 * the surfaces expect a picture.
 */
export const AGENT_AVATAR_MIME_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"image/avif",
] as const;

/** The picker's `accept`: one string, derived from the gate's list. */
export const AGENT_AVATAR_ACCEPT = AGENT_AVATAR_MIME_TYPES.join(",");

/**
 * The most avatars one machine keeps.
 *
 * `localStorage` is a few megabytes and a 256px WebP is around 8-20 KB; this
 * bound is what stops a long-lived profile with many deleted agents from
 * growing without limit. Beyond it the OLDEST keys are dropped (see
 * `sanitizeAvatarImages`), because the newest picture is the one being edited.
 */
export const AGENT_AVATAR_LIMIT = 64;

/**
 * The largest number of pixels a picked file may decode to.
 *
 * The 8 MB ceiling above bounds BYTES, and a flat-colour PNG of 40,000 px per
 * edge compresses into a few hundred kilobytes while decoding to 1.6 gigapixels
 * in the renderer process. This bound is the decode's own ceiling: 64 MP is
 * above any camera frame a user would pick as a profile picture (a 35 MP frame
 * decoded in 162 ms in the round-1 QA run) and far below the sizes where a
 * renderer allocation is the difference between a slow pick and a dead tab.
 *
 * It has no copy of its own: a file this large is refused with the same
 * "could not be read" sentence as an undecodable one, because to every surface
 * that is what it is.
 */
export const AGENT_AVATAR_MAX_PIXELS = 64_000_000;

/**
 * The longest data URL an avatar may store, in characters. The base64 body is
 * ~4/3 of the bytes, so this is a ceiling of about 300 KB per picture — an
 * order of magnitude over what a 256px WebP costs, and small enough that a
 * hand-edited blob cannot wedge the profile's storage.
 */
export const AGENT_AVATAR_MAX_DATA_URL_CHARS = 400_000;

/**
 * The most characters every stored avatar may add up to, across all agents.
 *
 * `AGENT_AVATAR_LIMIT` x the per-entry ceiling would accept 25.5 MB in a store
 * whose own comment says it shares a few megabytes of `localStorage` with every
 * other UI preference — enough that a hand-edited or imported blob could fill
 * the quota and make every later write fail (see the save-failure arm in
 * `shared/store/agent-avatar-store.ts`). Four million characters is roughly ten
 * times what 64 real 256px WebP pictures cost, so it never bites a user who
 * picks pictures, and it caps the damage a tampered blob can do.
 */
export const AGENT_AVATAR_MAX_TOTAL_CHARS = 4_000_000;

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

/** The square of the source image that a cover-crop keeps, centred. */
export type AvatarSourceRect = {
	/** Left edge in source pixels. */
	sx: number;
	/** Top edge in source pixels. */
	sy: number;
	/** The square's edge in source pixels. */
	side: number;
};

/**
 * The centre square of a `width` x `height` image, which is what
 * `object-cover` would have shown: the shorter edge decides the side, and the
 * longer one is cut evenly from both ends.
 */
export function coverSourceRect(
	width: number,
	height: number,
): AvatarSourceRect {
	/* A degenerate bitmap (a zero or fractional dimension) still resolves to a
	 * drawable one-pixel square rather than a negative origin. */
	const safeWidth = Math.max(1, Math.floor(width));
	const safeHeight = Math.max(1, Math.floor(height));
	const side = Math.min(safeWidth, safeHeight);
	return {
		sx: Math.floor((safeWidth - side) / 2),
		sy: Math.floor((safeHeight - side) / 2),
		side,
	};
}

/**
 * A hydrated blob's `images`, filtered rather than trusted.
 *
 * `localStorage` can be hand-edited, left half-written by a dying process, or
 * written by a build that stored something else, and the result is read
 * straight into `<img src>`. Anything that is not a `webp`/`png`/`jpeg` data
 * URL of the right shape is dropped, and entries beyond `AGENT_AVATAR_LIMIT` or
 * the `AGENT_AVATAR_MAX_TOTAL_CHARS` budget go oldest-first.
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
		if (entry.length > AGENT_AVATAR_MAX_DATA_URL_CHARS) continue;
		if (!AVATAR_DATA_URL.test(entry)) continue;
		kept[key] = entry;
	}
	/*
	 * THE BUDGET IS PER PROFILE, so it is applied newest-first and stops at the
	 * first entry that does not fit: a store over either bound keeps the pictures
	 * most recently written and drops the oldest, which are the ones the user has
	 * to scroll furthest to notice missing.
	 */
	const keys = Object.keys(kept);
	const trimmed: Record<string, string> = {};
	let totalChars = 0;
	let keptCount = 0;
	for (let index = keys.length - 1; index >= 0; index--) {
		const key = keys[index];
		const entry = kept[key];
		if (keptCount >= AGENT_AVATAR_LIMIT) break;
		if (totalChars + entry.length > AGENT_AVATAR_MAX_TOTAL_CHARS) break;
		trimmed[key] = entry;
		totalChars += entry.length;
		keptCount += 1;
	}
	return trimmed;
}
