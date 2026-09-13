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
	 */
	lastAgentModified?: number;

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
	 * with a `Not found` receipt rather than being quietly dropped.
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
