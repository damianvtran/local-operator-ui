import {
	AGENT_AVATAR_EDGE,
	AGENT_AVATAR_MAX_DATA_URL_CHARS,
	type AgentAvatarRefusal,
	avatarFileRejection,
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
 * Reads `file`, crops it to a centred square and returns a data URL.
 *
 * Throws `AgentAvatarError` with the refusal that owns the failure, so the
 * settings row can say which one happened instead of "that did not work".
 */
export async function downscaleAgentAvatar(file: File): Promise<string> {
	const rejection = avatarFileRejection(file);
	if (rejection !== null) throw new AgentAvatarError(rejection);

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
