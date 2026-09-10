/**
 * Bound a pasted or attached image before it reaches the wire.
 *
 * Why this exists: the composer stored whatever the clipboard handed it and
 * sent it verbatim. A macOS Retina screenshot is 8.4-8.5 MB on the pasteboard
 * (the measurement is `local_operator/imaging.py`'s own, recorded at its
 * module docstring) and 0.28 MB once bounded, so a single screenshot exceeded
 * every budget between here and the session owner. The TUI has always bounded
 * its pastes; this surface did not, which is the actual defect behind the
 * "request is too large" refusals - raising the transport budget alone still
 * leaves an 8.5 MB payload against a 1 MiB socket frame.
 *
 * The ladder mirrors `bound_image_for_model` (`local_operator/imaging.py:449`)
 * deliberately. The invariant the backend states for its own two call sites -
 * both have to bound identically or the unbounded one wedges the session for
 * both - applies across surfaces too: a session that accepts a TUI paste and
 * rejects the same screenshot from the desktop app is one image pipeline with
 * two answers.
 *
 * Constraint: a canvas re-encode is LOSSY and re-encoding is not free, so an
 * image is only touched when it is actually out of bounds. PNG round-tripping
 * routinely grows a file, so a candidate is kept only when it is smaller than
 * what it replaces.
 */

/**
 * Longest edge an image may have on the wire.
 *
 * Pinned to `IMAGE_INGEST_MAX_EDGE = 1024` at
 * `local_operator/imaging.py:154`, the bound the TUI applies to everything
 * entering a model's context. Matching the number is the point: the two
 * surfaces feed the same session.
 */
export const IMAGE_MAX_EDGE = 1024;

/**
 * Byte ceiling above which a single bounded image is re-encoded as JPEG.
 *
 * `IMAGE_MAX_BYTES = 1024 * 1024` at `local_operator/imaging.py:206`.
 */
export const IMAGE_MAX_BYTES = 1024 * 1024;

/**
 * JPEG quality for the lossy rung.
 *
 * `IMAGE_JPEG_QUALITY = 85` at `local_operator/imaging.py:209`, expressed here
 * on the 0-1 scale `convertToBlob` takes.
 */
export const IMAGE_JPEG_QUALITY = 0.85;

export type WireImageMime =
	| "image/png"
	| "image/jpeg"
	| "image/gif"
	| "image/webp";

export type WireImage = {
	data_b64: string;
	mime_type: WireImageMime;
};

/**
 * GIF is exempt from every rung. A canvas draws one frame, so re-encoding an
 * animation silently destroys it - a worse outcome than a payload the budget
 * check refuses with copy the user can act on.
 */
const RE_ENCODABLE: ReadonlySet<WireImageMime> = new Set<WireImageMime>([
	"image/png",
	"image/jpeg",
	"image/webp",
]);

/**
 * Steps applied to ALL images when the per-image ladder left the message over
 * budget - several individually legal screenshots that do not collectively
 * fit.
 *
 * Each step re-encodes from the ORIGINAL bytes rather than from the previous
 * step's output: recompressing an already-lossy JPEG compounds the artefacts
 * without buying back a proportional number of bytes.
 *
 * The ladder deliberately ends rather than looping to nothing. If the smallest
 * step still does not fit, the images are returned as they are and the caller
 * refuses with the sizes named. Silently shedding an attachment the user
 * chose - the other way to guarantee a fit - would send a message that is not
 * the one they composed, and would contradict the refusal copy that asks them
 * to remove an image themselves.
 */
const OVERFLOW_LADDER: ReadonlyArray<{ maxEdge: number; quality: number }> = [
	{ maxEdge: IMAGE_MAX_EDGE, quality: 0.8 },
	{ maxEdge: 768, quality: 0.7 },
	{ maxEdge: 512, quality: 0.6 },
];

/** Bytes a base64 string decodes to, without decoding it. */
export function base64ByteLength(data: string): number {
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.floor((data.length * 3) / 4) - padding;
}

function toBytes(data_b64: string): Uint8Array {
	const binary = atob(data_b64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1)
		bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function toBase64(bytes: Uint8Array): string {
	// Chunked because `String.fromCharCode(...bytes)` on a multi-hundred-KB
	// image overflows the argument stack.
	let binary = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk)
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	return btoa(binary);
}

/**
 * Re-encode `bitmap` at `maxEdge` and return the smallest acceptable result,
 * or null when the platform cannot draw or every candidate grew.
 */
async function reEncode(
	bitmap: ImageBitmap,
	original: WireImage,
	originalBytes: number,
	maxEdge: number,
	quality: number,
): Promise<WireImage | null> {
	const longest = Math.max(bitmap.width, bitmap.height);
	const scale = longest > maxEdge ? maxEdge / longest : 1;
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.drawImage(bitmap, 0, 0, width, height);
	const candidates: WireImage[] = [];
	// PNG first: screenshots are the case that matters here and PNG keeps small
	// UI text legible where JPEG rings it. JPEG is the fallback rung, taken only
	// when the PNG is still too big, exactly as `imaging.py:479-483` orders it.
	const png = await canvas.convertToBlob({ type: "image/png" });
	const pngBytes = new Uint8Array(await png.arrayBuffer());
	if (pngBytes.byteLength <= IMAGE_MAX_BYTES)
		candidates.push({ data_b64: toBase64(pngBytes), mime_type: "image/png" });
	if (pngBytes.byteLength > IMAGE_MAX_BYTES || quality < IMAGE_JPEG_QUALITY) {
		const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality });
		const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
		candidates.push({
			data_b64: toBase64(jpegBytes),
			mime_type: "image/jpeg",
		});
		if (
			pngBytes.byteLength > IMAGE_MAX_BYTES &&
			jpegBytes.byteLength > pngBytes.byteLength
		)
			candidates.push({ data_b64: toBase64(pngBytes), mime_type: "image/png" });
	}
	let best: WireImage | null = null;
	let bestBytes = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const bytes = base64ByteLength(candidate.data_b64);
		if (bytes < bestBytes) {
			best = candidate;
			bestBytes = bytes;
		}
	}
	// A re-encode that grew the file bought nothing but loss. Keep the original
	// unless we actually shrank the dimensions, in which case the smaller
	// picture is the point even if the codec was unkind about it.
	if (!best) return null;
	if (bestBytes >= originalBytes && scale === 1) return original;
	return best;
}

/**
 * Bound one image to `maxEdge` and `IMAGE_MAX_BYTES`, returning it unchanged
 * when it is already within both.
 *
 * A platform without `createImageBitmap`/`OffscreenCanvas`, or an image the
 * decoder refuses, yields the original: the budget check downstream is what
 * guarantees correctness, and a failed optimisation must never lose the
 * user's attachment.
 */
export async function boundImageForWire(
	image: WireImage,
	maxEdge: number = IMAGE_MAX_EDGE,
	quality: number = IMAGE_JPEG_QUALITY,
): Promise<WireImage> {
	if (!RE_ENCODABLE.has(image.mime_type)) return image;
	if (
		typeof createImageBitmap !== "function" ||
		typeof OffscreenCanvas !== "function"
	)
		return image;
	const originalBytes = base64ByteLength(image.data_b64);
	try {
		const bitmap = await createImageBitmap(
			new Blob([toBytes(image.data_b64) as BlobPart], {
				type: image.mime_type,
			}),
		);
		try {
			// Verbatim when already in bounds. No re-encode can improve an image
			// sent at native size, and PNG round-tripping routinely grows it
			// (`imaging.py:469-473` makes the same call for the same reason).
			if (
				Math.max(bitmap.width, bitmap.height) <= maxEdge &&
				originalBytes <= IMAGE_MAX_BYTES &&
				quality >= IMAGE_JPEG_QUALITY
			)
				return image;
			return (
				(await reEncode(bitmap, image, originalBytes, maxEdge, quality)) ??
				image
			);
		} finally {
			bitmap.close();
		}
	} catch {
		return image;
	}
}

/**
 * Bound every image, then - if the message is still over `budget` - walk the
 * overflow ladder until it fits or the ladder runs out.
 *
 * `measure` is supplied by the caller because the only honest measurement is
 * the serialized request body the transport actually weighs, which this module
 * has no business constructing.
 */
export async function boundImagesForBudget(
	images: WireImage[],
	budget: number,
	measure: (images: WireImage[]) => number,
): Promise<WireImage[]> {
	if (!images.length) return images;
	const bounded = await Promise.all(
		images.map((image) => boundImageForWire(image)),
	);
	if (measure(bounded) <= budget) return bounded;
	let best = bounded;
	for (const step of OVERFLOW_LADDER) {
		const stepped = await Promise.all(
			// From the ORIGINALS, never from the previous rung: see OVERFLOW_LADDER.
			images.map((image) =>
				boundImageForWire(image, step.maxEdge, step.quality),
			),
		);
		best = stepped;
		if (measure(stepped) <= budget) return stepped;
	}
	// Still over. The caller refuses with the real numbers rather than dropping
	// an attachment the user chose to include.
	return best;
}
