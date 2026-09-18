import { type FC, memo } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { viewerFor } from "../../utils/viewer-routing";
import { AudioPreview } from "./audio-preview";
import { CodeEditor } from "./code-editor";
import { HtmlPreview } from "./html-preview";
import { ImagePreview } from "./image-preview";
import { PdfPreview } from "./pdf-preview";
import { SpreadsheetPreview } from "./spreadsheet-preview";
import { VideoPreview } from "./video-preview";
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
 * Dispatches a document to the surface that can show it.
 *
 * One router, asked once. This used to be a chain of ad-hoc predicates —
 * `isMarkdownFile(title)`, `isHtmlFile(title)`, `isSpreadsheetFile(title)`, then
 * "everything else is code" — with a second, differently-ordered copy in the
 * Files grid's click handler. Two chains meant a format could be openable from
 * one place and not the other, and both asked the TITLE rather than the path.
 * `viewerFor` answers with the surface itself, so adding a format is one table
 * row in `viewer-routing.ts` and no edit here.
 *
 * The `code` branch is also the fallback for a document already open whose type
 * we do not have a viewer for. That is deliberate: something the user opened
 * should render as text rather than as an empty panel, and `null` — the OS
 * downgrade — cannot arrive here, because an unsupported file never becomes a
 * document in the first place.
 */
const CanvasContentComponent: FC<CanvasContentProps> = ({
	document,
	conversationId,
	agentId,
}) => {
	switch (viewerFor(document.path, document.type)) {
		case "markdown":
			return (
				<WysiwygMarkdownEditor
					document={document}
					conversationId={conversationId}
					agentId={agentId}
				/>
			);
		case "html":
			/* `conversationId` goes through now, because edit mode is a real editor: its
			 * saves and its dirty state are the same ones the code viewer publishes, and the
			 * store update after a save needs the conversation it belongs to. */
			return (
				<HtmlPreview document={document} conversationId={conversationId} />
			);
		case "spreadsheet":
			return (
				<SpreadsheetPreview
					document={document}
					conversationId={conversationId}
					agentId={agentId}
				/>
			);
		case "pdf":
			return <PdfPreview document={document} />;
		case "image":
			return <ImagePreview document={document} />;
		case "audio":
			return <AudioPreview document={document} />;
		case "video":
			return <VideoPreview document={document} />;
		default:
			return (
				<CodeEditor
					document={document}
					conversationId={conversationId}
					agentId={agentId}
				/>
			);
	}
};

export const CanvasContent = memo(CanvasContentComponent);
