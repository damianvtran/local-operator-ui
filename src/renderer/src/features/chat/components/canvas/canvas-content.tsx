import { type FC, memo } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { isHtmlFile } from "../../utils/is-html-file";
import { isMarkdownFile } from "../../utils/is-markdown-file";
import { CodeEditor } from "./code-editor";
import { HtmlPreview } from "./html-preview";
import { WysiwygMarkdownEditor } from "./wysiwyg-markdown-editor";

type CanvasContentProps = {
	/**
	 * The document to display
	 */
	document: CanvasDocument;
	/**
	 * The conversation ID for the current chat context
	 */
	conversationId?: string;
	/**
	 * The agent ID for the current chat context
	 */
	agentId?: string;
};

/**
 * Content component for the canvas
 * Displays content based on file type - markdown preview, HTML preview, or code editor
 */
const CanvasContentComponent: FC<CanvasContentProps> = ({ document, conversationId, agentId }) => {
	if (isMarkdownFile(document.title)) {
		return <WysiwygMarkdownEditor document={document} conversationId={conversationId} agentId={agentId} />;
	}

	if (isHtmlFile(document.title)) {
		return <HtmlPreview document={document} />;
	}

	return <CodeEditor document={document} conversationId={conversationId} agentId={agentId} />;
};

export const CanvasContent = memo(CanvasContentComponent);
