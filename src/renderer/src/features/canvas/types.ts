/**
 * Represents a markdown document in the canvas
 */
export interface MarkdownDocument {
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
}
