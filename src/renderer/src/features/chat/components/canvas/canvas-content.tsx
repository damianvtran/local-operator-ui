import type { FC } from "react";
import { isMarkdownFile } from "../../utils/is-markdown-file";
import { CodeEditor } from "./code-editor";
import { MarkdownPreview } from "./markdown-preview";
import type { CanvasDocument } from "./types";

type CanvasContentProps = {
	/**
	 * The document to display
	 */
	document: CanvasDocument;
};

/**
 * Content component for the markdown canvas
 * Displays the markdown content with syntax highlighting
 */
export const CanvasContent: FC<CanvasContentProps> = ({ document }) => {
	if (isMarkdownFile(document.title)) {
		return <MarkdownPreview document={document} />;
	}

	return <CodeEditor document={document} />;
};
