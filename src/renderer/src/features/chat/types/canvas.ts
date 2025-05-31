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
	 * Timestamp when the document was last modified
	 */
	lastModified?: Date;

	/**
	 * Type of the document/file
	 */
	type?: CanvasDocumentType;
};

/**
 * Export format options for markdown documents
 */
export type ExportFormat = "pdf" | "docx";
