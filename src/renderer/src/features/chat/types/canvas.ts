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
 * Represents a markdown document in the canvas
 */
export type CanvasDocument = {
	/**
	 * Unique identifier for the document
	 */
	id: string;

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
};

/**
 * Export format options for markdown documents
 */
export type ExportFormat = "pdf" | "docx";
