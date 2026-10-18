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
 * The artifact kinds these identity helpers name. `audio` joined the union in
 * the sound phase; every helper below is kind-GENERIC (it names, extensions and
 * cues whatever kind it is handed), so the union widened in ONE place rather
 * than in each signature - the drift a per-signature union invites is how a
 * sound would end up labelled `File c0ffee12` in one surface and `Sound
 * c0ffee12` in another.
 */
export type ArtifactIdentityKind = "image" | "video" | "audio" | "file";

/**
 * What an artifact is called when the producer gave it no name: the kind and
 * the head of the digest, which is the only thing that tells two nameless ones
 * apart. A sound says "Sound" - the one word the Files section, the filter
 * group and this fallback all use for the kind.
 */
export function fallbackArtifactName(
	kind: ArtifactIdentityKind,
	digest: string,
): string {
	switch (kind) {
		case "video":
			return `Video ${digest.slice(0, 8)}`;
		case "image":
			return `Image ${digest.slice(0, 8)}`;
		case "audio":
			return `Sound ${digest.slice(0, 8)}`;
		default:
			return `File ${digest.slice(0, 8)}`;
	}
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
	"application/pdf": "pdf",
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
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
	kind: ArtifactIdentityKind;
	name?: string;
	contentType?: string;
}): string {
	const extension =
		(artifact.contentType && EXTENSION_FOR_TYPE[artifact.contentType]) ||
		(artifact.kind === "video"
			? "mp4"
			: artifact.kind === "image"
				? "png"
				: artifact.kind === "audio"
					? "mp3"
					: "bin");
	const given = artifact.name?.replace(/[\\/]/g, "-").trim();
	if (given && HAS_EXTENSION.test(given)) return given;
	// The fallback name already ends in the digest head, so only a producer's
	// bare label needs the suffix to stay unique (`Hero-412b2a3d.png`); appending
	// it to the fallback proposed `Video 9277c383-9277c383.mp4` (UX U1 / QA Q3).
	if (!given)
		return `${fallbackArtifactName(artifact.kind, artifact.digest)}.${extension}`;
	return `${given}-${artifact.digest.slice(0, 8)}.${extension}`;
}

/** How much of a digest the UI prints as a tiebreak. Shared by the row and the tab. */
export const ARTIFACT_HEAD_LENGTH = 8;

/**
 * The sentence that says where an artifact lives.
 *
 * A path row's tooltip is its path, which tells the reader the file is on their
 * disk and why `Open folder` exists. An artifact has no path, so without this the
 * shorter menu (no Open file / Open folder) is unexplained (UX U4, design D7).
 */
export function artifactCue(kind: ArtifactIdentityKind): string {
	if (kind === "file") return "File kept in this session";
	// "Generated sound" rather than "Generated audio": the cue shares the word
	// the row's own fallback name and the Sounds section use (`artifactCue` is
	// read by the tooltip alone, but one kind should read one way).
	if (kind === "audio") return "Generated sound, kept in this session";
	return `Generated ${kind}, kept in this session`;
}

/**
 * The tooltip for an artifact's row or tab: name, digest head, where it lives.
 *
 * The digest head is what tells two same-named artifacts apart, the way a path
 * does for files. Models name outputs from a template, so one real session held
 * 69 pictures under three names.
 */
export function artifactTooltip(artifact: {
	digest: string;
	kind: ArtifactIdentityKind;
	title: string;
}): string {
	const head = artifact.digest.slice(0, ARTIFACT_HEAD_LENGTH);
	// A nameless artifact's title IS `Video <head>` (`fallbackArtifactName`), so
	// repeating the head would read `Video 9277c383 . 9277c383`.
	const named = artifact.title.includes(head)
		? artifact.title
		: `${artifact.title} \u00b7 ${head}`;
	return `${named} \u00b7 ${artifactCue(artifact.kind)}`;
}

/**
 * Tab labels for a set of open documents: an artifact whose name another open
 * artifact shares gets its digest head appended, and nothing else changes.
 *
 * On a CLASH only, for the reason the Files row draws its tiebreak on a clash
 * only: a name that is already unique is the better label. Two tabs both reading
 * `fixture-model-01.jpg` were indistinguishable, with identical tooltips (UX U2 /
 * QA Q1).
 */
export function artifactTabLabels(
	documents: ReadonlyArray<{
		id: string;
		title: string;
		artifact?: { digest: string } | undefined;
	}>,
): Map<string, string> {
	const counts = new Map<string, number>();
	for (const doc of documents)
		if (doc.artifact) counts.set(doc.title, (counts.get(doc.title) ?? 0) + 1);
	const labels = new Map<string, string>();
	for (const doc of documents) {
		const clash = doc.artifact && (counts.get(doc.title) ?? 0) > 1;
		labels.set(
			doc.id,
			clash && doc.artifact
				? `${doc.title} \u00b7 ${doc.artifact.digest.slice(0, ARTIFACT_HEAD_LENGTH)}`
				: doc.title,
		);
	}
	return labels;
}
