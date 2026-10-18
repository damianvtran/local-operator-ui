export type CanvasDocumentType =
	| "image"
	| "video"
	| "pdf"
	| "markdown"
	| "html"
	| "archive"
	| "text"
	| "code"
	| "document"
	| "spreadsheet"
	| "presentation"
	| "audio"
	| "other";

/**
 * The identity of a session ARTIFACT: media the harness generated and filed in
 * the attachment store (`generate_image`, `generate_video`), which has bytes and
 * a content digest but no path on the user's disk.
 *
 * Carried on a `CanvasDocument` so the Files list, the canvas viewers and the
 * actions menu can all reach the bytes through the attachment route
 * (`sessions.attachment`, scoped by `sessionId` + `digest`) without a path. See
 * `utils/artifact-identity.ts` for why the document's `id`/`path` is
 * `artifact:<digest>` and not a filesystem path.
 *
 * Every field is a fact the transcript stated; none is a URL. The canvas store
 * persists to `localStorage` with no `partialize`, so a `blob:` URL must never
 * live here - it would be a dead tab after a restart. The digest is the stable
 * handle and the viewers resolve it to a URL per mount.
 */
export type CanvasArtifact = {
	/** The attachment store's key: 32 lowercase hex characters. */
	digest: string;
	/** Images/videos paint by digest. A sound paints nothing by digest — its
	 * player resolves the same bytes and draws the stored peaks — but the kind is
	 * still the fact that routes it to the audio seat (`mediaOf`, the Finder
	 * band's compact player, the row's media block) rather than the generic file
	 * glyph. An opaque file keeps its MIME/type and is materialised only by an
	 * explicit action needing a path-backed viewer. */
	kind: "image" | "video" | "audio" | "file";
	/**
	 * The conversation the bytes are served through. The attachment route is
	 * scoped to the transcript that REFERENCES a digest, so a bare digest cannot be
	 * fetched; the session that mentioned it can.
	 */
	sessionId: string;
	/** Child attachment scope supplied by the authoritative family index. */
	childId?: string | null;
	/** From the artifact block, when the row carried one; absent on a text-only mention. */
	contentType?: string;
	/** The producer's display handle ("flux-dev-01.jpg"). Never a filesystem path. */
	name?: string;
	sizeBytes?: number;
	width?: number;
	height?: number;
	/** Seconds; video only. */
	durationS?: number;
};

/**
 * Represents a markdown document in the canvas
 */
export type CanvasDocument = {
	/**
	 * Unique identifier for the document
	 */
	id: string;
	/** Backend inventory row identity, distinct from the canonical artifact tab
	 * digest. Only explicit materialisation may use this opaque service handle. */
	indexedFileId?: string;

	/**
	 * Title of the document (usually the filename)
	 */
	title: string;

	/**
	 * Full path to the document
	 */
	path: string;

	/**
	 * Content of the document
	 */
	content: string;

	/**
	 * Timestamp when the document was last modified by an agent
	 *
	 * Also the blob cache's key for the viewers that read their own bytes
	 * (`file:<path>:<mtime>`), so a document whose bytes were re-read is served
	 * under a new key. Written by paths that are NOT probes (`file-attachment`
	 * stamps `Date.now()`), which is why it is not the freshness baseline - see
	 * `readMtimeMs`.
	 */
	lastAgentModified?: number;

	/**
	 * The file's mtime, ms since epoch, at the moment `content` was read from
	 * disk - the baseline the canvas's freshness check compares a probe against
	 * (`canvas/file-freshness.ts`).
	 *
	 * ABSENT means "never read through a path that took a probe", not "zero":
	 * a document created in the panel, opened through the OS dialog, or restored
	 * from a persisted store written before this field existed. The check ADOPTS
	 * the file's current mtime for those rather than re-reading them, so an
	 * upgrade cannot rewrite every restored buffer on the first tick.
	 *
	 * Only ever written from a probe answer, which is what keeps it a fact about
	 * the file rather than about this process's clock.
	 */
	readMtimeMs?: number;

	/**
	 * Type of the document/file
	 */
	type?: CanvasDocumentType;

	/**
	 * Whether the bytes are actually on disk, as last reported by the probe.
	 *
	 * ABSENT is not the same as `"present"`: it means nothing has checked yet,
	 * which is the normal state for the frame between a tile being added and
	 * `probe-files` answering. The tile renders normally until a probe says
	 * otherwise, and a document that says `"missing"` keeps its place in the grid
	 * with the `No longer on disk` receipt rather than being quietly dropped.
	 */
	availability?: "present" | "missing";

	/**
	 * Size in bytes, when the probe reported one. Used to state "too large to
	 * preview" before a read is attempted, rather than after it fails.
	 */
	sizeBytes?: number;

	/**
	 * Present when this document is a session artifact rather than a file: its
	 * bytes live in the attachment store and its `id`/`path` is
	 * `artifact:<digest>`. Absent means a file on disk (or a `data:` document),
	 * which is every document that existed before this field.
	 *
	 * Optional and additive on purpose: documents already persisted in
	 * `localStorage` carry no such field and keep working unchanged. Every
	 * consumer that probes, reads or reveals `path` must branch on this first -
	 * `artifact:<digest>` is not a path and a probe of it would report the
	 * artifact "no longer on disk".
	 */
	artifact?: CanvasArtifact;
};

/**
 * Export format options for markdown documents
 */
export type ExportFormat = "pdf" | "docx";
