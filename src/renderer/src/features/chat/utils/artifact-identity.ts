/**
 * The identity of a session ARTIFACT: media the harness generated and filed in
 * its attachment store, which has bytes and a digest but no path on the user's
 * disk.
 *
 * ## Why this exists
 *
 * `generate_image` and `generate_video` register their output with
 * `cache_media(...)` (local-operator `session/attachments.py`) and the
 * transcript carries only the content digest: `record.images[].attachment` on
 * an image result, and `digest <hex>` / `attached: digest <hex>` in the result
 * text of an image or video one. Nothing in the transcript is a path. The
 * Files view was built on paths, so every generated picture and clip was
 * invisible to it.
 *
 * An artifact therefore needs an identity that is not a filesystem path but
 * can still sit in the places the Files view keeps paths: the canvas store's
 * `mentionedFiles` (deduped by `CanvasDocument.id`) and `CanvasDocument.path`
 * (read by about a dozen consumers). The identity chosen is
 * `artifact:<digest>`:
 *
 * - **Content-addressed, so dedupe is free.** The same image mentioned by a
 *   result's block, its text and a later `read` is one id.
 * - **Never a valid path.** It has no leading `/` or `~` and no extension, so
 *   `classifyImageSource`, the file bridge and `probeFiles` all refuse to treat
 *   it as one; a consumer that forgets to branch on it fails closed (no open,
 *   no reveal) rather than probing the cwd for a file called `artifact:...`.
 *   The `data:` document is the precedent for a non-disk identity in this
 *   field.
 * - **Persistence-safe.** The canvas store is persisted to `localStorage` with
 *   no `partialize`; a digest is stable across restarts where a `blob:` URL is
 *   not (see `image-actions.ts` on why a blob-keyed document is a dead tab).
 *
 * Pure and dependency-free so both the transcript scanner (a node-bundled
 * module) and the canvas components can import it.
 */

/** The scheme-ish prefix of an artifact document's `id`/`path`. */
export const ARTIFACT_PATH_PREFIX = "artifact:";

/** A store digest: 32 lowercase hex characters (`cache_media`'s key). */
export const DIGEST_PATTERN = "[0-9a-f]{32}";

const DIGEST_ONLY = /^[0-9a-f]{32}$/;

/**
 * `<anything>/attachments/<digest>.bin`: a read path into the attachment store.
 *
 * Matched on the file's SHAPE rather than on the configured config directory
 * because the renderer does not know where the daemon's config root is (it can
 * be relocated), and a 32-hex `.bin` directly under a directory named
 * `attachments` is the store's own layout and nothing a person names by hand.
 */
const ATTACHMENT_BIN = /(?:^|\/)attachments\/([0-9a-f]{32})\.bin$/;

export function artifactPath(digest: string): string {
	return `${ARTIFACT_PATH_PREFIX}${digest}`;
}

export function isArtifactPath(path: string): boolean {
	return (
		path.startsWith(ARTIFACT_PATH_PREFIX) &&
		DIGEST_ONLY.test(path.slice(ARTIFACT_PATH_PREFIX.length))
	);
}

/** The digest of an artifact path, or `null` for anything else. */
export function digestOfArtifactPath(path: string): string | null {
	return isArtifactPath(path) ? path.slice(ARTIFACT_PATH_PREFIX.length) : null;
}

/**
 * The digest a read path into the attachment store names, or `null`.
 *
 * The scanner used to admit these paths as `other`-typed tiles for a `.bin`
 * nothing can open (34 of them in one real session, from `read` of pasted
 * screenshots). The digest is right there in the file name, so the scanner maps
 * the path to the artifact it IS rather than to a junk tile.
 */
export function digestOfAttachmentBinPath(path: string): string | null {
	return ATTACHMENT_BIN.exec(path)?.[1] ?? null;
}

/**
 * What an artifact is called when the producer gave it no name: the kind and
 * the head of the digest, which is the only thing that tells two nameless ones
 * apart.
 */
export function fallbackArtifactName(
	kind: "image" | "video",
	digest: string,
): string {
	return `${kind === "video" ? "Video" : "Image"} ${digest.slice(0, 8)}`;
}

/**
 * The extension a content type is saved under. Only the types the attachment
 * route serves (`SUPPORTED_IMAGE_MIME_TYPES`, `SUPPORTED_VIDEO_MIME_TYPES`)
 * matter: anything else is `bin`, which is honest about not knowing.
 */
const EXTENSION_FOR_TYPE: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/bmp": "bmp",
	"image/svg+xml": "svg",
	"video/mp4": "mp4",
	"video/webm": "webm",
	"video/quicktime": "mov",
};

const HAS_EXTENSION = /\.[A-Za-z0-9]{2,5}$/;

/**
 * The file name "Save as..." proposes.
 *
 * The producer's name when it has an extension (`flux-dev-01.jpg`), otherwise a
 * name built from the kind, the digest head and the extension the content type
 * implies - so the saved file opens in the right application even when the
 * producer's name was a bare label, and two saves of different artifacts do not
 * both propose `Image`. Path separators are stripped: the name is a suggestion
 * to a save dialog, but a producer-supplied string should never be able to
 * propose a directory.
 */
export function artifactFileName(artifact: {
	digest: string;
	kind: "image" | "video";
	name?: string;
	contentType?: string;
}): string {
	const extension =
		(artifact.contentType && EXTENSION_FOR_TYPE[artifact.contentType]) ||
		(artifact.kind === "video" ? "mp4" : "png");
	const given = artifact.name?.replace(/[\\/]/g, "-").trim();
	if (given && HAS_EXTENSION.test(given)) return given;
	const stem = given || fallbackArtifactName(artifact.kind, artifact.digest);
	return `${stem}-${artifact.digest.slice(0, 8)}.${extension}`;
}
