import { type FC, memo } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { isHtmlFile } from "../../utils/is-html-file";
import { isMarkdownFile } from "../../utils/is-markdown-file";
import { CodeEditor } from "./code-editor";
import { EditableMarkdownRenderer } from "./editable-markdown-renderer";
import { HtmlPreview } from "./html-preview";

type CanvasContentProps = {
	/**
	 * The document to display
	 */
	document: CanvasDocument;
	/**
	 * The conversation ID for the current chat context
	 */
	conversationId?: string;
};

/**
 * Content component for the canvas
 * Displays content based on file type - markdown preview, HTML preview, or code editor
 */
const CanvasContentComponent: FC<CanvasContentProps> = ({ document, conversationId }) => {
	if (isMarkdownFile(document.title)) {
		return <EditableMarkdownRenderer document={document} conversationId={conversationId} />;
	}

	if (isHtmlFile(document.title)) {
		return <HtmlPreview document={document} />;
	}

	return <CodeEditor document={document} />;
};

export const CanvasContent = memo(CanvasContentComponent);
