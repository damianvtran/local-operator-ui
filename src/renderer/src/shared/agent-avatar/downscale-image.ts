import {
	AGENT_AVATAR_EDGE,
	AGENT_AVATAR_MAX_DATA_URL_CHARS,
	type AgentAvatarRefusal,
	avatarFileRejection,
	avatarPixelRefusal,
	coverSourceRect,
} from "./avatar-image";

/**
 * Turns a picked file into the stored avatar: a centre square, 256px, WebP.
 *
 * WHY THE DOWNSCALE HAPPENS HERE rather than at the point of drawing. The
 * renderer keeps these pictures in `localStorage` beside the rest of the UI
 * preferences (see `shared/store/agent-avatar-store.ts`), which is a few
 * megabytes shared with every other preference — a 12 MP photo stored as-is is
 * a quarter of that for one row, and the surfaces draw it at 32px.
 *
 * WEBP, WITH PNG AS THE FALLBACK, and not JPEG: a picture with transparency is
 * common (a logo, a cut-out), and JPEG has no alpha — `toDataURL("image/jpeg")`
 * fills the transparent area with black, which would show through the circle as
 * a dark ring on every palette. WebP keeps the alpha. The fallback exists
 * because a canvas that cannot encode WebP silently returns a PNG data URL
 * instead; checking the prefix is how we notice rather than storing a PNG under
 * an image/png URL we labelled otherwise.
 */
export class AgentAvatarError extends Error {
	constructor(readonly code: AgentAvatarRefusal) {
		super(`agent avatar refused: ${code}`);
		this.name = "AgentAvatarError";
	}
}

/**
 * The dimensions a container header states, when the runtime offers them.
 *
 * `ImageDecoder` is WebCodecs' image arm, and this leg exists to make the pixel
 * bound above cost a header parse rather than a bitmap where that is possible.
 *
 * IT IS NOT POSSIBLE ON THE RUNTIME THIS SHIPS ON (review round 2, R2-1, and QA
 * round 2's Q2-1). WebCodecs' `ImageTrack` has only `frameCount`, `animated`,
 * `repetitionCount` and `selected` (spec section 10.7); `codedWidth` belongs to
 * `VideoFrame`. Measured in Electron 44.3.0: the decoded frame reports
 * `codedWidth`/`codedHeight`, the track reports neither, so the fields below are
 * optional and the read answers `null` there. The decoded-bitmap check below is
 * therefore the guard that always runs, and this one is a best-effort early
 * exit for a runtime that does expose a track size.
 *
 * AND IT IS OPTIONAL BY DESIGN. The constructor is read off `globalThis` behind
 * a local type because the DOM lib does not promise it on every target, and a
 * container the decoder will not parse (an older build's AVIF, say) answers
 * `null` rather than a refusal: `createImageBitmap` below is the decoder that
 * decides what this app can read. A metadata reader that failed, or that has no
 * size to report, must never look like a verdict on the file.
 */
type ImageDecoderLike = {
	tracks: {
		ready: Promise<void>;
		selectedTrack: { codedWidth?: number; codedHeight?: number } | null;
	};
	close: () => void;
};

type ImageDecoderConstructor = new (init: {
	data: BufferSource;
	type: string;
}) => ImageDecoderLike;

async function readSourceDimensions(
	file: File,
): Promise<{ width: number; height: number } | null> {
	const Decoder = (globalThis as { ImageDecoder?: ImageDecoderConstructor })
		.ImageDecoder;
	if (!Decoder) return null;
	let decoder: ImageDecoderLike | null = null;
	try {
		decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type });
		await decoder.tracks.ready;
		const track = decoder.tracks.selectedTrack;
		if (!track) return null;
		/*
		 * A MISSING SIZE IS NO ANSWER, NOT A REFUSAL. `undefined` is what every
		 * Chromium build measured here returns, and handing it to
		 * `avatarPixelRefusal` made that rule call a good image undecodable.
		 */
		const { codedWidth: width, codedHeight: height } = track;
		if (
			typeof width !== "number" ||
			!Number.isFinite(width) ||
			typeof height !== "number" ||
			!Number.isFinite(height)
		) {
			return null;
		}
		return { width, height };
	} catch {
		return null;
	} finally {
		decoder?.close();
	}
}

/**
 * Reads `file`, crops it to a centred square and returns a data URL.
 *
 * Throws `AgentAvatarError` with the refusal that owns the failure, so the
 * settings row can say which one happened instead of "that did not work".
 *
 * THE PIXEL BOUND MAY BE CHECKED TWICE, and the order is the point. Where the
 * runtime states a track size, the metadata read below answers the source's
 * dimensions from the container header, so a 40,000 x 40,000 flat PNG is
 * refused before a bitmap exists; the decoded bitmap is then measured again,
 * which is the check that always runs - for every browser whose metadata reader
 * is missing, refuses the container, or reports no size at all (which is what
 * Electron 44 does). The second one closes the bitmap in the `finally`, so even
 * the arm that had to allocate does not keep it.
 */
export async function downscaleAgentAvatar(file: File): Promise<string> {
	const rejection = avatarFileRejection(file);
	if (rejection !== null) throw new AgentAvatarError(rejection);

	const source = await readSourceDimensions(file);
	if (source !== null) {
		const pixelRefusal = avatarPixelRefusal(source.width, source.height);
		if (pixelRefusal !== null) throw new AgentAvatarError(pixelRefusal);
	}

	let bitmap: ImageBitmap;
	try {
		// `createImageBitmap` decodes the formats the transcript's own image path
		// does (see `chat/utils/bound-image.ts`); SVG is not among them and is not
		// accepted above either.
		bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
	} catch {
		throw new AgentAvatarError("decode");
	}

	try {
		const decodedRefusal = avatarPixelRefusal(bitmap.width, bitmap.height);
		if (decodedRefusal !== null) throw new AgentAvatarError(decodedRefusal);
		const { sx, sy, side } = coverSourceRect(bitmap.width, bitmap.height);
		const canvas = document.createElement("canvas");
		canvas.width = AGENT_AVATAR_EDGE;
		canvas.height = AGENT_AVATAR_EDGE;
		const context = canvas.getContext("2d");
		if (!context) throw new AgentAvatarError("decode");
		// The source is already downscaled by nearly an order of magnitude, so the
		// interpolation quality is the difference between a soft 32px disc and a
		// smeared one — the only rendering choice this path makes.
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		context.drawImage(
			bitmap,
			sx,
			sy,
			side,
			side,
			0,
			0,
			AGENT_AVATAR_EDGE,
			AGENT_AVATAR_EDGE,
		);

		const webp = canvas.toDataURL("image/webp", 0.85);
		const dataUrl = webp.startsWith("data:image/webp")
			? webp
			: canvas.toDataURL("image/png");
		if (dataUrl.length > AGENT_AVATAR_MAX_DATA_URL_CHARS) {
			throw new AgentAvatarError("encode");
		}
		return dataUrl;
	} finally {
		bitmap.close();
	}
}
