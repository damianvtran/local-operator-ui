import {
	type AgentAvatarRefusal,
	avatarFileRejection,
	avatarPixelRefusal,
} from "./avatar-image";

/**
 * Turns a picked file into a decoded bitmap the cropper can frame.
 *
 * WHAT CHANGED FROM #1517. The proof of concept cropped a centre square and
 * stored a 256px WebP data URL in `localStorage`, so this module also encoded.
 * Now the person frames the square themselves (the cropper) and core stores
 * and re-normalises the result, so this module's job ends at a decoded,
 * orientation-corrected bitmap - and keeps every refusal it had, in the order
 * that matters: type and size before a byte is read, then the pixel bound
 * before (where the runtime can say) and after the decode.
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
 * Decodes `file` for the cropper, or throws `AgentAvatarError` with the
 * refusal that owns the failure, so the editor can say which one happened.
 *
 * THE PIXEL BOUND MAY BE CHECKED TWICE, and the order is the point. Where the
 * runtime states a track size, the metadata read answers the source's
 * dimensions from the container header, so a 40,000 x 40,000 flat PNG is
 * refused before a bitmap exists; the decoded bitmap is then measured again,
 * which is the check that always runs (Electron 44 reports no track size). A
 * refused bitmap is closed before the throw; an accepted one belongs to the
 * caller, which closes it when the cropper lets go of it.
 */
export async function decodeAgentAvatar(file: File): Promise<ImageBitmap> {
	const rejection = avatarFileRejection(file);
	if (rejection !== null) throw new AgentAvatarError(rejection);

	const source = await readSourceDimensions(file);
	if (source !== null) {
		const pixelRefusal = avatarPixelRefusal(source.width, source.height);
		if (pixelRefusal !== null) throw new AgentAvatarError(pixelRefusal);
	}

	let bitmap: ImageBitmap;
	try {
		// `from-image` applies EXIF orientation, so a portrait phone photo is
		// framed upright - the same rotation core applies before it re-encodes.
		bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
	} catch {
		throw new AgentAvatarError("decode");
	}
	const decodedRefusal = avatarPixelRefusal(bitmap.width, bitmap.height);
	if (decodedRefusal !== null) {
		bitmap.close();
		throw new AgentAvatarError(decodedRefusal);
	}
	return bitmap;
}
