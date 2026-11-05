/**
 * An image's size, read from its own header - never measured by decoding it.
 *
 * WHY THIS IS A SECURITY RULE, NOT PERFORMANCE. Decoding is the expensive,
 * memory-amplifying half of image handling, and doing it in the main process to
 * learn two integers would mean a hostile 20 KB PNG claiming 40000x40000 pixels
 * could ask for a 6 GB allocation merely to be measured. Every format below
 * states its dimensions in the first few dozen bytes, so the header is enough -
 * and when the header is truncated, `null` is the answer. A card with no
 * dimensions still renders; a main process killed by a decompression bomb does
 * not.
 *
 * The parsers are total: any input, including empty, returns `null` rather than
 * throwing, because the bytes came from the internet.
 */

export interface ImageDimensions {
	width: number;
	height: number;
}

function readU16BE(bytes: Uint8Array, offset: number): number | null {
	if (bytes.length < offset + 2) return null;
	return ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number);
}

function readU16LE(bytes: Uint8Array, offset: number): number | null {
	if (bytes.length < offset + 2) return null;
	return ((bytes[offset + 1] as number) << 8) | (bytes[offset] as number);
}

function readU24LE(bytes: Uint8Array, offset: number): number | null {
	if (bytes.length < offset + 3) return null;
	return (
		((bytes[offset + 2] as number) << 16) |
		((bytes[offset + 1] as number) << 8) |
		(bytes[offset] as number)
	);
}

function readU32BE(bytes: Uint8Array, offset: number): number | null {
	if (bytes.length < offset + 4) return null;
	return (
		((bytes[offset] as number) << 24) |
		((bytes[offset + 1] as number) << 16) |
		((bytes[offset + 2] as number) << 8) |
		(bytes[offset + 3] as number)
	);
}

/** A width/height pair is only reported when both are non-zero: a zero side is a
 * malformed header, not a picture of nothing. */
function pair(
	width: number | null,
	height: number | null,
): ImageDimensions | null {
	if (width === null || height === null) return null;
	if (width <= 0 || height <= 0) return null;
	return { width, height };
}

/** PNG: IHDR is the first chunk, so the size is at a fixed offset (bytes 16-23). */
function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
	if (bytes.length < 24) return null;
	if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
	return pair(readU32BE(bytes, 16), readU32BE(bytes, 20));
}

/** GIF: the logical screen descriptor's first four bytes, little-endian. */
function gifDimensions(bytes: Uint8Array): ImageDimensions | null {
	if (bytes.length < 10) return null;
	return pair(readU16LE(bytes, 6), readU16LE(bytes, 8));
}

/**
 * JPEG: walk the marker segments until a start-of-frame.
 *
 * SOF0/1/2/3, SOF5/6/7, SOF9/10/11, SOF13/14/15 all carry the frame size at the
 * same offsets; the two "reserved" markers in between (SOF4, SOF8, SOF12) are not
 * frames and are skipped like any other segment.
 */
function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
	if (bytes.length < 4) return null;
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;
	// Bounded by the segment lengths, which always move forward; the length of a
	// segment is at most 65535, so this cannot spin on a fixed offset.
	while (offset + 3 < bytes.length) {
		if (bytes[offset] !== 0xff) return null;
		const marker = bytes[offset + 1] as number;
		// Standalone markers: RSTn and TEM have no length field.
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
			offset += 2;
			continue;
		}
		const length = readU16BE(bytes, offset + 2);
		if (length === null || length < 2) return null;
		const isFrame =
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf);
		if (isFrame) {
			// SOFn: length(2) precision(1) height(2) width(2)
			return pair(readU16BE(bytes, offset + 7), readU16BE(bytes, offset + 5));
		}
		offset += 2 + length;
	}
	return null;
}

/**
 * WebP: three flavours, three headers.
 *
 * VP8X states the canvas as two 24-bit values minus one (the format stores
 * size-1). VP8 (lossy) carries 14-bit dimensions after its start code, VP8L
 * (lossless) packs both minus-one values into 28 bits.
 */
function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
	if (bytes.length < 30) return null;
	const chunk = String.fromCharCode(...bytes.subarray(12, 16));
	if (chunk === "VP8X") {
		const width = readU24LE(bytes, 24);
		const height = readU24LE(bytes, 27);
		if (width === null || height === null) return null;
		return pair(width + 1, height + 1);
	}
	if (chunk === "VP8 ") {
		// Start code 9d 01 2a, then the two 14-bit sizes.
		if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a)
			return null;
		const width = readU16LE(bytes, 26);
		const height = readU16LE(bytes, 28);
		if (width === null || height === null) return null;
		return pair(width & 0x3fff, height & 0x3fff);
	}
	if (chunk === "VP8L") {
		if (bytes[20] !== 0x2f) return null;
		if (bytes.length < 25) return null;
		const bits =
			(bytes[21] as number) |
			((bytes[22] as number) << 8) |
			((bytes[23] as number) << 16) |
			((bytes[24] as number) << 24);
		const width = (bits & 0x3fff) + 1;
		const height = ((bits >> 14) & 0x3fff) + 1;
		return pair(width, height);
	}
	return null;
}

/**
 * The dimensions of an image whose format has already been sniffed.
 *
 * `null` covers every "cannot say": truncated header, a segment that does not
 * parse, a zero side. The caller stores it as an unknown size, which the card
 * renders as an image with its natural aspect once it has the bytes.
 */
export function parseImageDimensions(
	kind: "png" | "jpeg" | "gif" | "webp" | "ico",
	bytes: Uint8Array,
): ImageDimensions | null {
	switch (kind) {
		case "png":
			return pngDimensions(bytes);
		case "jpeg":
			return jpegDimensions(bytes);
		case "gif":
			return gifDimensions(bytes);
		case "webp":
			return webpDimensions(bytes);
		case "ico":
			// An ICO directory's first image entry states its size, but the format
			// allows 0 for "256 pixels", which is a rule rather than a measurement -
			// and a favicon's size is not rendered anywhere. Unknown on purpose.
			return null;
	}
}
