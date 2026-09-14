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

/**
 * Base64 conversion, native where the engine has it.
 *
 * `Uint8Array.fromBase64`/`toBase64` are a single memcpy-speed pass in the
 * engine; the hand-rolled loops below are a JS-level pass PER BYTE, and this
 * runs on the renderer's MAIN THREAD inside the send path - an 8.5 MB
 * screenshot spends the whole conversion with the composer frozen (review
 * round 1, F4).
 *
 * The loops stay as the fallback rather than being deleted: the shipped
 * Electron is 35.x, whose Chromium 134 predates these methods (Chrome 140), so
 * today the fallback is the path that actually runs and the native branch is
 * what an Electron bump switches on for free. Typed as optional members
 * because the DOM lib this project compiles against does not declare them yet.
 */
type Base64Capable = {
	fromBase64?: (data: string) => Uint8Array;
};
type Base64Encodable = {
	toBase64?: () => string;
};

function toBytes(data_b64: string): Uint8Array {
	const native = (Uint8Array as unknown as Base64Capable).fromBase64;
	if (typeof native === "function") return native.call(Uint8Array, data_b64);
	const binary = atob(data_b64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1)
		bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function toBase64(bytes: Uint8Array): string {
	const native = (bytes as unknown as Base64Encodable).toBase64;
	if (typeof native === "function") return native.call(bytes);
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
	// Candidates are compared as RAW bytes and only the winner is base64-encoded.
	// Encoding each candidate to compare them did the expensive conversion up to
	// three times per rung and threw all but one away, on the main thread inside
	// the send path (review round 1, F4). Base64 is a fixed 4/3 expansion, so raw
	// length orders the candidates identically to encoded length.
	const candidates: { bytes: Uint8Array; mime_type: WireImageMime }[] = [];
	// PNG first: screenshots are the case that matters here and PNG keeps small
	// UI text legible where JPEG rings it. JPEG is the fallback rung, taken only
	// when the PNG is still too big, exactly as `imaging.py:479-483` orders it.
	const png = await canvas.convertToBlob({ type: "image/png" });
	const pngBytes = new Uint8Array(await png.arrayBuffer());
	if (pngBytes.byteLength <= IMAGE_MAX_BYTES)
		candidates.push({ bytes: pngBytes, mime_type: "image/png" });
	if (pngBytes.byteLength > IMAGE_MAX_BYTES || quality < IMAGE_JPEG_QUALITY) {
		// JPEG has no alpha channel, so every transparent pixel is flattened
		// against whatever RGB sits beneath it. A fresh OffscreenCanvas backing
		// store is rgba(0,0,0,0) - transparent BLACK - so encoding the canvas
		// above straight to JPEG turns a macOS window screenshot's rounded
		// corners and drop shadow black, which is the single most common paste
		// this ladder exists to support. The backend flattens onto white for
		// exactly this reason (`imaging.py:628-636`, `flat_mode` / `fill =
		// (255, 255, 255)`); this is the port of that step, which the comment
		// above citing `imaging.py:479-483` omitted.
		//
		// A SEPARATE canvas rather than a fill on the one above: the PNG
		// candidate must keep its alpha, and filling before `drawImage` would
		// flatten it for both codecs.
		const flat = new OffscreenCanvas(width, height);
		const flatContext = flat.getContext("2d");
		if (!flatContext) return null;
		flatContext.fillStyle = "#ffffff";
		flatContext.fillRect(0, 0, width, height);
		flatContext.drawImage(bitmap, 0, 0, width, height);
		const jpeg = await flat.convertToBlob({ type: "image/jpeg", quality });
		const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
		candidates.push({ bytes: jpegBytes, mime_type: "image/jpeg" });
		if (
			pngBytes.byteLength > IMAGE_MAX_BYTES &&
			jpegBytes.byteLength > pngBytes.byteLength
		)
			candidates.push({ bytes: pngBytes, mime_type: "image/png" });
	}
	let best: { bytes: Uint8Array; mime_type: WireImageMime } | null = null;
	let bestBytes = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		if (candidate.bytes.byteLength < bestBytes) {
			best = candidate;
			bestBytes = candidate.bytes.byteLength;
		}
	}
	// A re-encode that grew the file bought nothing but loss - and a larger
	// payload can push an otherwise-sendable message into refusal, so "we shrank
	// the dimensions" is not a good enough reason to keep it. The guard is
	// therefore unconditional: the previous `&& scale === 1` conjunct disabled it
	// for every image over `maxEdge`, letting a re-encoded photo come back at up
	// to 2x its original size (review round 1, F2). This restores what the module
	// docstring already claims: "a candidate is kept only when it is smaller than
	// what it replaces".
	if (!best) return null;
	if (bestBytes >= originalBytes) return original;
	return { data_b64: toBase64(best.bytes), mime_type: best.mime_type };
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
	const decoded = await decodeForWire(image);
	if (!decoded) return image;
	try {
		return await boundDecodedImage(image, decoded, maxEdge, quality);
	} finally {
		decoded.close();
	}
}

/**
 * Decode `image` once, or null when it must be passed through untouched.
 *
 * Split out of `boundImageForWire` so the overflow ladder can decode ONE time
 * per image and reuse the bitmap across every rung. Previously each rung called
 * `boundImageForWire`, which re-decoded the full-resolution original - up to
 * four `atob` + `createImageBitmap` passes over an 8.5 MB screenshot, all on
 * the renderer's main thread (review round 1, F4).
 *
 * Null covers all three pass-through cases (non-re-encodable, no canvas
 * platform, undecodable bytes) so the callers stay single-branch.
 */
async function decodeForWire(image: WireImage): Promise<ImageBitmap | null> {
	if (!RE_ENCODABLE.has(image.mime_type)) return null;
	if (
		typeof createImageBitmap !== "function" ||
		typeof OffscreenCanvas !== "function"
	)
		return null;
	try {
		return await createImageBitmap(
			new Blob([toBytes(image.data_b64) as BlobPart], {
				type: image.mime_type,
			}),
		);
	} catch {
		// A decoder that refuses yields the original: the budget check downstream
		// is what guarantees correctness, and a failed optimisation must never
		// lose the user's attachment.
		return null;
	}
}

/** Bound an already-decoded image. The caller owns `bitmap` and closes it. */
async function boundDecodedImage(
	image: WireImage,
	bitmap: ImageBitmap,
	maxEdge: number,
	quality: number,
): Promise<WireImage> {
	const originalBytes = base64ByteLength(image.data_b64);
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
			(await reEncode(bitmap, image, originalBytes, maxEdge, quality)) ?? image
		);
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
	// Decode ONCE per image and reuse the bitmaps across every rung. The ladder
	// re-encodes from the originals (see OVERFLOW_LADDER), which used to mean
	// re-decoding them too - up to four full-resolution decodes per image on the
	// renderer's main thread (review round 1, F4).
	const decoded = await Promise.all(
		images.map((image) => decodeForWire(image)),
	);
	try {
		return await walkOverflowLadder(images, decoded, budget, measure);
	} finally {
		for (const bitmap of decoded) bitmap?.close();
	}
}

/** The rung walk itself, with every image already decoded. */
async function walkOverflowLadder(
	images: WireImage[],
	decoded: (ImageBitmap | null)[],
	budget: number,
	measure: (images: WireImage[]) => number,
): Promise<WireImage[]> {
	const boundAll = (maxEdge: number, quality: number) =>
		Promise.all(
			images.map((image, index) => {
				const bitmap = decoded[index];
				return bitmap
					? boundDecodedImage(image, bitmap, maxEdge, quality)
					: Promise.resolve(image);
			}),
		);
	const bounded = await boundAll(IMAGE_MAX_EDGE, IMAGE_JPEG_QUALITY);
	if (measure(bounded) <= budget) return bounded;
	// `best` is the SMALLEST set seen, not the latest one tried. Overwriting it
	// per rung returned the last rung's output even when an earlier one (or the
	// input itself) was smaller, so an exhausted ladder could hand the caller a
	// set strictly worse than what it was given (review round 1, F3).
	//
	// The originals seed the comparison because bounding is an optimisation, not
	// an obligation: if every rung is bigger than what the user pasted, what the
	// user pasted is the right answer.
	let best = images;
	let bestBytes = measure(images);
	const consider = (candidate: WireImage[]): number => {
		const bytes = measure(candidate);
		if (bytes < bestBytes) {
			best = candidate;
			bestBytes = bytes;
		}
		return bytes;
	};
	consider(bounded);
	for (const step of OVERFLOW_LADDER) {
		// From the ORIGINALS, never from the previous rung: see OVERFLOW_LADDER.
		const stepped = await boundAll(step.maxEdge, step.quality);
		if (consider(stepped) <= budget) return stepped;
	}
	// Still over. The caller refuses with the real numbers rather than dropping
	// an attachment the user chose to include.
	return best;
}
